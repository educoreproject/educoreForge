#!/usr/bin/env node
'use strict';

// test-pesc260805DerivedTier.js — the Phase 3 gate suite for the pesc260805 DERIVED tier.
// ALL PURE: no Voyage call, no Neo4j, no golden touch. Every gate demonstrates RED first —
// either by feeding the checker deliberately broken data (proving the checker can fail) or by
// loosening in the HARNESS what production keeps strict (proving the discipline is load-bearing)
// — then GREEN against the real bundle output. Evidence lines print for retention.
//
// Gates (work order, Phase 3):
//   G3-A  THE definition of the tier: delete everything pescTier:'derived' (nodes, edges, AND
//         the derived annotations on source nodes), regenerate from the retained source data,
//         require the regenerated derived view IDENTICAL. "Derived content that cannot be
//         regenerated is synthetic in the wrong tier" — executable.
//   G3-B  resolution correctness: the worked example (CollegeTranscript 1.8 Student ->
//         AcademicRecord v1.13.0 StudentType), RED by resolving with a WRONG artifact's
//         prefix table.
//   G3-C  sameness discipline: the 846/50 split vs Phase 0's measurement; ApplicationFeeAmount-
//         Type does NOT chain 1.19.0->1.19.1; ClassRankType chains 14/14; RED levers measured.
//   G3-D  ambiguity honesty: every contested reference RECORDED; ZERO of them resolved by
//         COMPUTATION (RESTATED at Phase 4 — the 201 are now answered, but every answer is
//         synthetic and rule-tagged); consumer set exactly the six roots. RED by removing one
//         collision member (contested-ness is computed, not configured).
//   G3-E  latest view: isLatest exact; reachableFromLatestRoot nonzero and partial; the
//         PerkinsType orphan; harness BFS independently reproduces the annotation set.
//   G3-F  R-P2-5 guard: contentModelShape <-> PescElementDecl children 1:1; RED by mutating
//         one shape.
//   DET   two full forge() runs produce identical complete outputs.
//
// Run: node forges/pesc260805/test/test-pesc260805DerivedTier.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const BUNDLE_DIR = path.join(__dirname, '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');

const bundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });
const derivedTier = require(path.join(BUNDLE_DIR, 'lib', 'derivedTier'))();
const {
	buildDerivedTier,
	applyDerivedTier,
	canonicalizeDerivedView,
	makeFingerprintKit,
	DERIVED_ANNOTATION_PROPERTY_NAMES,
	STRICT_COMPARISON,
} = derivedTier;

let pass = 0;
let fail = 0;
// every label check() is called with, in run order — the LEDGER gate at the foot of this file
// reconciles this list against test/redEvidenceLedger.json so a new assertion cannot arrive
// without red evidence recorded for it.
const shippedAssertionLabels = [];
const check = (label, condition) => {
	shippedAssertionLabels.push(label);
	if (condition) {
		pass++;
		console.log(`  ok    ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};
const evidence = (line) => console.log(`        ${line}`);

const CONTESTED_NAMESPACE = 'urn:org:pesc:sector:AcademicRecord:v1.6.0';
const NS_CORE_1190 = 'urn:org:pesc:core:CoreMain:v1.19.0';
const NS_CORE_1191 = 'urn:org:pesc:core:CoreMain:v1.19.1';

// ---- harness helpers ----------------------------------------------------

// cloneGraph — one-level-deep clone: node/edge objects and their properties objects are fresh,
// property VALUES are shared (scalars and JSON strings — never mutated in place by any gate).
const cloneGraph = ({ nodes, edges }) => ({
	nodes: nodes.map((oneNode) => ({
		...oneNode,
		labels: [...oneNode.labels],
		properties: { ...oneNode.properties },
	})),
	edges: edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })),
});

// stripDerived — the Gate 3 DELETE: drop every derived node and edge, strip every derived
// annotation off the retained nodes. What remains is exactly the source+meta tier.
//
// PHASE 4 AMENDMENT: the strip now removes SYNTHETIC content too. The derived tier is a function of
// the SOURCE tier alone and refuses synthetic input by name (lib/derivedTier.js purity guard), so a
// strip that left the merged AcademicRecord 1.6.0 definitions in place would not be feeding the
// regeneration its own input — it would be handing a computation a set of DECIDED definitions and
// asking it to pretend it derived them.
const stripDerived = (forged) => {
	const stripped = cloneGraph(forged);
	stripped.nodes = stripped.nodes.filter(
		(oneNode) =>
			oneNode.properties.pescTier !== 'derived' && oneNode.properties.pescTier !== 'synthetic',
	);
	stripped.nodes.forEach((oneNode) => {
		DERIVED_ANNOTATION_PROPERTY_NAMES.forEach((oneAnnotationName) => {
			delete oneNode.properties[oneAnnotationName];
		});
	});
	stripped.edges = stripped.edges.filter(
		(oneEdge) =>
			oneEdge.properties.pescTier !== 'derived' && oneEdge.properties.pescTier !== 'synthetic',
	);
	return stripped;
};

// assertPristineSourceGraph — the HARNESS's own purity contract, enforced rather than assumed.
//
// HISTORICAL — applyDerivedTier USED TO stamp annotations onto its input nodes in place, with a
// comment merely asking callers to feed clones. G3-A fed it the harness's shared `stripped` graph
// and then passed that same object downstream, so every later RED lever received a graph carrying
// 23,233 annotated nodes. buildDerivedTier's purity guard correctly refused it — FIRST, before
// the guard each lever was actually testing could run. That is how G3-F came to report
// "a drifted shape is REFUSED" on the strength of a refusal about `sameDefinitionClusterId`:
// the shape guard it names had never once been observed firing.
//
// AS SHIPPED, applyDerivedTier no longer mutates its input at all (GAP 7) — annotations land on
// copies and the caller's nodes are untouched. This helper is therefore belt-and-braces rather
// than the sole defence, and it is kept deliberately: it guards against ANY future gate handing a
// lever a fixture that carries derived content, from whatever source.
//
// A RED lever must therefore prove its fixture pristine BEFORE pulling the lever. This throws
// rather than returning a verdict: a contaminated fixture is a fault in the test, not a finding
// about the code, and it must never be reportable as a pass.
const assertPristineSourceGraph = ({ nodes }, leverLabel) => {
	const contaminatedNodes = nodes.filter(
		(oneNode) =>
			oneNode.properties.pescTier === 'derived' ||
			// PHASE 4: synthetic content is contamination here for the same reason derived content is
			// — buildDerivedTier refuses it FIRST, so a lever fed it would trip the purity guard
			// rather than the guard it means to test.
			oneNode.properties.pescTier === 'synthetic' ||
			DERIVED_ANNOTATION_PROPERTY_NAMES.some((oneAnnotationName) =>
				Object.prototype.hasOwnProperty.call(oneNode.properties, oneAnnotationName),
			),
	);
	if (contaminatedNodes.length > 0) {
		throw new Error(
			`HARNESS FAULT (${leverLabel}): the RED lever's fixture carries ${contaminatedNodes.length} ` +
				`node(s) holding derived content (first: '${contaminatedNodes[0].stableId}'). The lever ` +
				`would trip the purity guard, not the guard under test.`,
		);
	}
};

const sortedKeyObject = (sourceObject) => {
	const result = {};
	Object.keys(sourceObject)
		.sort()
		.forEach((oneKey) => {
			result[oneKey] = sourceObject[oneKey];
		});
	return result;
};

// canonicalizeWholeGraph — for the determinism gate: EVERYTHING, sorted.
const canonicalizeWholeGraph = ({ nodes, edges }) =>
	JSON.stringify({
		nodes: nodes
			.map((oneNode) => ({
				stableId: oneNode.stableId,
				labels: [...oneNode.labels].sort(),
				properties: sortedKeyObject(oneNode.properties),
			}))
			.sort((viewA, viewB) => (viewA.stableId < viewB.stableId ? -1 : 1)),
		edges: edges
			.map((oneEdge) => ({
				type: oneEdge.type,
				from: oneEdge.fromRef.id,
				to: oneEdge.toRef.id,
				properties: sortedKeyObject(oneEdge.properties),
			}))
			.sort((viewA, viewB) => {
				const keyA = `${viewA.type} ${viewA.from} ${viewA.to} ${JSON.stringify(viewA.properties)}`;
				const keyB = `${viewB.type} ${viewB.from} ${viewB.to} ${JSON.stringify(viewB.properties)}`;
				return keyA < keyB ? -1 : 1;
			}),
	});

// PHASE 4 SCOPING: the SOURCE-tier named definitions, which is what this suite has always meant by
// "the definitions" — every census, cluster and reachability number here is about what the files
// declare. Phase 4 emits 109 merged PescNamedDefinition nodes carrying pescTier:'synthetic'; an
// unscoped filter silently folded them into the derived tier's counts (12,909 became 13,018) and
// into the reachability walk. The scope is stated rather than assumed.
const namedDefinitionNodes = (forged) =>
	forged.nodes.filter(
		(oneNode) =>
			oneNode.labels.indexOf('PescNamedDefinition') !== -1 &&
			oneNode.properties.pescTier === 'source',
	);

const taskList = new taskListPlus();

// =====================================================================
// two full forge runs
// =====================================================================
taskList.push((args, next) => {
	bundle.forge({ sourcePath: SNAPSHOT_DIR, owner: 'test', skipEmbedding: true }, (err, forged) => {
		if (err) {
			next(`run one failed: ${err}`);
			return;
		}
		next('', { ...args, runOne: forged });
	});
});
taskList.push((args, next) => {
	bundle.forge({ sourcePath: SNAPSHOT_DIR, owner: 'test', skipEmbedding: true }, (err, forged) => {
		if (err) {
			next(`run two failed: ${err}`);
			return;
		}
		next('', { ...args, runTwo: forged });
	});
});

// =====================================================================
// DET — determinism over the COMPLETE output (source + derived + meta)
// =====================================================================
taskList.push((args, next) => {
	console.log('\nDET — two full forge() runs identical (complete outputs)');
	const canonicalOne = canonicalizeWholeGraph(args.runOne);
	const canonicalTwo = canonicalizeWholeGraph(args.runTwo);

	// RED first: prove the comparator can fail — flip one property in a clone.
	const mutated = cloneGraph(args.runOne);
	mutated.nodes[100].properties.name = `${mutated.nodes[100].properties.name}-CONTAMINATED`;
	const comparatorCatches = canonicalizeWholeGraph(mutated) !== canonicalOne;
	evidence(`RED (demonstrated): one contaminated property -> comparator detects: ${comparatorCatches}`);
	check('DET RED: whole-graph comparator demonstrably able to go red', comparatorCatches);

	evidence(`GREEN: run one ${args.runOne.nodes.length} nodes / ${args.runOne.edges.length} edges; canonical forms equal: ${canonicalOne === canonicalTwo}`);
	check('DET two runs byte-identical under canonical serialization', canonicalOne === canonicalTwo);
	next('', args);
});

// =====================================================================
// G3-A — delete the derived tier, regenerate, require IDENTICAL
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG3-A — the regeneration gate (THE definition of the tier)');
	const viewOriginal = canonicalizeDerivedView(args.runOne);

	const stripped = stripDerived(args.runOne);
	const derivedNodeCount = args.runOne.nodes.length - stripped.nodes.length;
	const derivedEdgeCount = args.runOne.edges.length - stripped.edges.length;
	evidence(`deleted: ${derivedNodeCount} derived nodes, ${derivedEdgeCount} derived edges, all annotations on retained nodes`);

	// GAP 1 — G3-A's demonstrated blind spot. DERIVED_ANNOTATION_PROPERTY_NAMES drives three
	// separate mechanisms (the input purity guard, the Gate-3 strip, the regeneration compare),
	// and an annotation staged under an UNDECLARED name is invisible to all three at once: the
	// compare never looks at it, the strip never removes it, the purity guard never objects to
	// the residue. The Phase 3 adversarial review stamped one onto 12,909 source nodes and this
	// gate STAYED GREEN. Two assertions close it, on top of the two production refusals now
	// standing in stageAnnotation and applyDerivedTier.
	//
	// (1) applyDerivedTier REFUSES an undeclared annotation name. Exercised against the real
	// exported function with a hand-built derivedOutput — no test seam, no monkey-patch.
	const undeclaredProbeGraph = stripDerived(args.runOne);
	const undeclaredProbeTargetNode = undeclaredProbeGraph.nodes.find(
		(oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1,
	);
	if (undeclaredProbeTargetNode === undefined) {
		throw new Error(
			'HARNESS FAULT (G3-A GAP1): no PescNamedDefinition to stamp — the refusal lever is ' +
				'unmeasurable, not passing.',
		);
	}
	let undeclaredRefusal = '';
	let undeclaredReturnedGraph = null;
	try {
		undeclaredReturnedGraph = applyDerivedTier({
			nodes: undeclaredProbeGraph.nodes,
			edges: undeclaredProbeGraph.edges,
			derivedOutput: {
				nodes: [],
				edges: [],
				nodeAnnotations: {
					[undeclaredProbeTargetNode.stableId]: { undeclaredDriftMarker: 'planted' },
				},
			},
		});
	} catch (thrownError) {
		undeclaredRefusal = thrownError.message;
	}
	// N1 — WATCH THE RETURNED GRAPH, NOT THE CALLER'S NODES.
	//
	// This assertion used to read undeclaredProbeTargetNode.properties, i.e. the CALLER'S node.
	// GAP 7's clone made that vacuous: applyDerivedTier now writes only to copies, so the
	// caller's node can never receive an annotation whether the refusal fires or not. The second
	// adversarial review proved it by neutralising ONLY the applier refusal — the assertion kept
	// passing while the marker landed live on the RETURNED graph. Worse, its recorded RED had
	// been obtained against a probe that ALSO reverted GAP 7, so it had never been red in the
	// configuration actually shipped.
	//
	// The lesson, and the reason this comment is long: a RED obtained under a configuration you
	// do not ship proves nothing about what you do ship. A fix to one gate (GAP 7) silently
	// hollowed out another (GAP 1), and only a probe built against the SHIPPED code could see it.
	// The escape route is the returned graph, so that is what is watched.
	const undeclaredEscapedToReturnedGraph =
		undeclaredReturnedGraph !== null &&
		undeclaredReturnedGraph.nodes.some(
			(oneNode) => oneNode.properties.undeclaredDriftMarker !== undefined,
		);
	evidence(`RED (observed refusal): ${undeclaredRefusal || 'NO REFUSAL — the blind spot is open'}`);
	evidence(`N1: applyDerivedTier returned ${undeclaredReturnedGraph === null ? 'NOTHING (refused)' : 'a graph'}; undeclared marker present on the RETURNED graph: ${undeclaredEscapedToReturnedGraph}`);
	check('G3-A GAP1: applyDerivedTier REFUSES an undeclared annotation name, naming it', undeclaredRefusal.indexOf('undeclaredDriftMarker') !== -1 && undeclaredRefusal.indexOf('not declared in DERIVED_ANNOTATION_PROPERTY_NAMES') !== -1);
	check('G3-A GAP1/N1: the undeclared annotation reached NO node in the RETURNED graph', undeclaredEscapedToReturnedGraph === false);

	// GAP 7 — applyDerivedTier's no-mutation contract, asserted rather than trusted. This is the
	// hazard that masked five gate failures for a whole phase: a documented request that callers
	// feed clones, with nothing enforcing it. Snapshot a fixture, apply a real derivedOutput to
	// it, and require the caller's own nodes to come back untouched.
	const noMutationFixture = stripDerived(args.runOne);
	const noMutationProbeNode = noMutationFixture.nodes.find(
		(oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1,
	);
	if (noMutationProbeNode === undefined) {
		throw new Error(
			'HARNESS FAULT (G3-A GAP7): no PescNamedDefinition in the fixture — the no-mutation ' +
				'contract is UNMEASURABLE, not satisfied.',
		);
	}
	const noMutationPropertyNamesBefore = Object.keys(noMutationProbeNode.properties).sort().join(',');
	const noMutationOutput = buildDerivedTier({
		nodes: noMutationFixture.nodes,
		edges: noMutationFixture.edges,
	});
	const noMutationCombined = applyDerivedTier({
		nodes: noMutationFixture.nodes,
		edges: noMutationFixture.edges,
		derivedOutput: noMutationOutput,
	});
	const noMutationPropertyNamesAfter = Object.keys(noMutationProbeNode.properties).sort().join(',');
	const returnedProbeNode = noMutationCombined.nodes.find(
		(oneNode) => oneNode.stableId === noMutationProbeNode.stableId,
	);
	evidence(`GAP7: caller's node property set ${noMutationPropertyNamesBefore === noMutationPropertyNamesAfter ? 'UNCHANGED' : 'MUTATED'} by applyDerivedTier; returned copy carries the annotations: ${returnedProbeNode.properties.sameDefinitionClusterId !== undefined}`);
	check('G3-A GAP7: applyDerivedTier does NOT mutate the caller\'s nodes', noMutationPropertyNamesBefore === noMutationPropertyNamesAfter);
	check('G3-A GAP7: the annotations DO land on the returned graph (the clone is not a no-op)', returnedProbeNode !== undefined && returnedProbeNode.properties.sameDefinitionClusterId !== undefined);

	let regenerationError = '';
	let regeneratedView = '';
	let regeneratedOutput = null;
	try {
		regeneratedOutput = buildDerivedTier({ nodes: stripped.nodes, edges: stripped.edges });
		const regeneratedGraph = applyDerivedTier({
			nodes: stripped.nodes,
			edges: stripped.edges,
			derivedOutput: regeneratedOutput,
		});
		regeneratedView = canonicalizeDerivedView(regeneratedGraph);

		// RED first: contaminate ONE derived property in a clone of the regenerated graph —
		// the compare MUST fail there or the gate is theater.
		const contaminated = cloneGraph(regeneratedGraph);
		const contaminatedNamespaceNode = contaminated.nodes.find(
			(oneNode) => oneNode.stableId === `pescNamespace:${NS_CORE_1191}`,
		);
		contaminatedNamespaceNode.properties.isLatest = false;
		const contaminationDetected = canonicalizeDerivedView(contaminated) !== viewOriginal;
		evidence(`RED (demonstrated): isLatest flipped on ${contaminatedNamespaceNode.stableId} -> compare fails: ${contaminationDetected}`);
		check('G3-A RED: a contaminated derived property is detected by the compare', contaminationDetected);
	} catch (thrownError) {
		regenerationError = thrownError.message;
	}
	check(`G3-A regeneration ran without refusal${regenerationError ? ` (${regenerationError})` : ''}`, regenerationError === '');
	evidence(`GREEN: regenerated derived view identical to the original: ${regeneratedView === viewOriginal} (${viewOriginal.length} canonical bytes)`);
	check('G3-A regenerated derived tier IDENTICAL to the emitted one', regeneratedView === viewOriginal && regeneratedView !== '');

	// GAP 1 (2) — every annotation the tier ACTUALLY writes is a declared one, measured against
	// the real production output rather than assumed. This is what keeps the declaration list
	// from drifting away from practice: a new stageAnnotation call under a fresh name now fails
	// here as well as refusing at the writer.
	if (regeneratedOutput === null) {
		throw new Error(
			'HARNESS FAULT (G3-A GAP1): regeneration produced no output, so the written-annotation ' +
				'names are UNMEASURABLE. Refusing to report them as clean.',
		);
	}
	const writtenAnnotationNames = new Set();
	Object.keys(regeneratedOutput.nodeAnnotations).forEach((oneStableId) => {
		Object.keys(regeneratedOutput.nodeAnnotations[oneStableId]).forEach((oneAnnotationName) =>
			writtenAnnotationNames.add(oneAnnotationName),
		);
	});
	const undeclaredWrittenNames = [...writtenAnnotationNames].filter(
		(oneAnnotationName) => DERIVED_ANNOTATION_PROPERTY_NAMES.indexOf(oneAnnotationName) === -1,
	);
	evidence(`annotation names actually written: ${[...writtenAnnotationNames].sort().join(', ')}`);
	check('G3-A GAP1: every annotation the tier writes is DECLARED (none invisible to strip/compare)', undeclaredWrittenNames.length === 0 && writtenAnnotationNames.size > 0);
	// Downstream gates get a FUNCTION, not a shared graph. Historically `stripped` was mutated in
	// place by applyDerivedTier, and sharing it silently fed every later RED lever a fixture the
	// purity guard rejects. AS SHIPPED that mutation is gone (GAP 7), so `stripped` survives this
	// task clean — but handing out a fresh strip per call is kept anyway: it removes the shared
	// mutable object entirely, so no future gate can contaminate a later one by any route.
	next('', { ...args, freshStripped: () => stripDerived(args.runOne) });
});

// =====================================================================
// G3-B — resolution correctness: the worked example, per-artifact bindings
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG3-B — the worked example (design §5)');
	const expectedTargetStableId = 'urn:org:pesc:sector:AcademicRecord:v1.13.0#complexType/StudentType';
	const studentEdges = args.runOne.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'RESOLVES_TO' &&
			oneEdge.fromRef.id.indexOf('urn:org:pesc:message:CollegeTranscript:v1.8.0#element/CollegeTranscript') === 0 &&
			/:Student$/.test(oneEdge.fromRef.id),
	);

	// RED first: resolve the same written reference with a WRONG artifact's prefix table —
	// AcademicEportfolio v1.0.0 binds AcRec to AcademicRecord v1.10.0, so the byte-identical
	// string 'AcRec:StudentType' denotes a DIFFERENT type there. Per-artifact bindings are the
	// difference between resolution and resolution-by-guess.
	const artifactNodes = args.runOne.nodes.filter((oneNode) => oneNode.labels.indexOf('PescArtifact') !== -1);
	const wrongArtifactNode = artifactNodes.find(
		(oneNode) => oneNode.properties.filename === 'AcademicEportfolio_v1.0.0.xsd',
	);
	const wrongBindings = JSON.parse(wrongArtifactNode.properties.prefixBindings);
	const wrongNamespace = wrongBindings.AcRec;
	const wrongTargetStableId = `${wrongNamespace}#complexType/StudentType`;
	const wrongTargetExists = args.runOne.nodes.some((oneNode) => oneNode.stableId === wrongTargetStableId);
	evidence(`RED (demonstrated): 'AcRec:StudentType' under ${wrongArtifactNode.properties.filename}'s table -> ${wrongTargetStableId} (exists: ${wrongTargetExists}) — a PLAUSIBLE and WRONG target`);
	check('G3-B RED: the wrong artifact\'s prefix table produces a different target', wrongTargetExists && wrongTargetStableId !== expectedTargetStableId);

	evidence(`GREEN: ${studentEdges.length} Student edge(s): ${studentEdges.map((oneEdge) => `${oneEdge.fromRef.id} -> ${oneEdge.toRef.id}`).join(' | ')}`);
	check('G3-B exactly one Student RESOLVES_TO edge from the CT 1.8 root subtree', studentEdges.length === 1);
	check('G3-B Student resolves to AcademicRecord v1.13.0 StudentType (exact stableId)', studentEdges.length === 1 && studentEdges[0].toRef.id === expectedTargetStableId);
	check('G3-B the edge carries the written form verbatim', studentEdges.length === 1 && studentEdges[0].properties.writtenAs === 'AcRec:StudentType');
	next('', args);
});

// =====================================================================
// G3-C — sameness discipline: strict comparison, the 846/50 split, chains
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG3-C — sameness discipline vs Phase 0\'s measurement');
	const definitionNodes = namedDefinitionNodes(args.runOne);
	const kit = makeFingerprintKit({ nodes: args.freshStripped().nodes });

	// the shared-name census on the 1.19.0/1.19.1 boundary
	const kindNamesOf = (oneNamespace) =>
		new Set(
			definitionNodes
				.filter((oneNode) => oneNode.stableId.indexOf(`${oneNamespace}#`) === 0)
				.map((oneNode) => `${oneNode.properties.kind}/${oneNode.properties.name}`),
		);
	const names1190 = kindNamesOf(NS_CORE_1190);
	const names1191 = kindNamesOf(NS_CORE_1191);
	const sharedKindNames = [...names1190].filter((oneKindName) => names1191.has(oneKindName));
	check('G3-C name census matches Phase 0: 896 names in each, all shared', names1190.size === 896 && names1191.size === 896 && sharedKindNames.length === 896);

	const splitOf = (comparisonOptions) => {
		let stable = 0;
		const changedNames = [];
		sharedKindNames.forEach((oneKindName) => {
			const fingerprintA = kit.fingerprintOf(`${NS_CORE_1190}#${oneKindName}`, comparisonOptions);
			const fingerprintB = kit.fingerprintOf(`${NS_CORE_1191}#${oneKindName}`, comparisonOptions);
			if (fingerprintA === fingerprintB) {
				stable++;
			} else {
				changedNames.push(oneKindName);
			}
		});
		return { stable, changed: changedNames.length, changedNames };
	};

	// RED lever 1 (ordered): whitespace-collapse. Measured: it flips NONE of the 50 — their
	// differences are STRUCTURAL (facet removal), which no text-normalization can manufacture.
	// SAYING SO (as the order requires) and proving the lever is live elsewhere: family-wide it
	// flips adjacent-pair verdicts (documentation whitespace differences), so the strict
	// comparator's refusal to collapse is load-bearing — just not on these 50.
	const strictSplit = splitOf(STRICT_COMPARISON);
	const collapseSplit = splitOf({ includeDocumentation: true, collapseWhitespace: true });
	const noDocumentationSplit = splitOf({ includeDocumentation: false, collapseWhitespace: false });
	evidence(`RED lever measurements on the 1.19.0->1.19.1 boundary: strict ${strictSplit.stable}/${strictSplit.changed}; collapseWhitespace ${collapseSplit.stable}/${collapseSplit.changed}; noDocumentation ${noDocumentationSplit.stable}/${noDocumentationSplit.changed}`);
	evidence('STATED PLAINLY (per the work order): neither whitespace-collapse nor documentation-participation flips ANY of the 50 — the 50 differ by facet REMOVAL, a structural change.');

	// RED lever 2 (the honest one for the 50): remove the facet bytes in the HARNESS — strip
	// totalDigits/fractionDigits off the 1.19.0 ApplicationFeeAmountType derivation node — and
	// the pair WRONGLY chains. The facets ARE the difference; the incumbent forge discarded
	// exactly this layer.
	const harnessNodes = args.freshStripped().nodes;
	const facetCarrierStableId = `${NS_CORE_1190}#simpleType/ApplicationFeeAmountType/restriction/1`;
	const facetCarrierNode = harnessNodes.find((oneNode) => oneNode.stableId === facetCarrierStableId);
	delete facetCarrierNode.properties.totalDigits;
	delete facetCarrierNode.properties.fractionDigits;
	const facetBlindKit = makeFingerprintKit({ nodes: harnessNodes });
	const facetBlindEqual =
		facetBlindKit.fingerprintOf(`${NS_CORE_1190}#simpleType/ApplicationFeeAmountType`, STRICT_COMPARISON) ===
		facetBlindKit.fingerprintOf(`${NS_CORE_1191}#simpleType/ApplicationFeeAmountType`, STRICT_COMPARISON);
	evidence(`RED (demonstrated): facets stripped in harness -> ApplicationFeeAmountType 1.19.0/1.19.1 WRONGLY chains: ${facetBlindEqual}`);
	check('G3-C RED: a facet-blind comparison wrongly chains ApplicationFeeAmountType', facetBlindEqual);

	// ... and the loosened levers ARE live family-wide (they change verdicts somewhere), so
	// keeping them out of production is a decision with observable consequences.
	const coreVersionsAscending = ['v1.0.0','v1.2.0','v1.4.0','v1.7.0','v1.8.0','v1.10.0','v1.12.0','v1.13.0','v1.14.0','v1.16.0','v1.17.0','v1.18.0','v1.19.0','v1.19.1'];
	const adjacentFlipCount = (comparisonOptions) => {
		let flips = 0;
		for (let versionIndex = 0; versionIndex + 1 < coreVersionsAscending.length; versionIndex++) {
			const namespaceA = `urn:org:pesc:core:CoreMain:${coreVersionsAscending[versionIndex]}`;
			const namespaceB = `urn:org:pesc:core:CoreMain:${coreVersionsAscending[versionIndex + 1]}`;
			const namesA = kindNamesOf(namespaceA);
			kindNamesOf(namespaceB).forEach((oneKindName) => {
				if (!namesA.has(oneKindName)) {
					return;
				}
				const strictEqual =
					kit.fingerprintOf(`${namespaceA}#${oneKindName}`, STRICT_COMPARISON) ===
					kit.fingerprintOf(`${namespaceB}#${oneKindName}`, STRICT_COMPARISON);
				const looseEqual =
					kit.fingerprintOf(`${namespaceA}#${oneKindName}`, comparisonOptions) ===
					kit.fingerprintOf(`${namespaceB}#${oneKindName}`, comparisonOptions);
				if (strictEqual !== looseEqual) {
					flips++;
				}
			});
		}
		return flips;
	};
	const collapseFlips = adjacentFlipCount({ includeDocumentation: true, collapseWhitespace: true });
	const noDocumentationFlips = adjacentFlipCount({ includeDocumentation: false, collapseWhitespace: false });
	evidence(`family-wide adjacent-pair verdict flips: collapseWhitespace ${collapseFlips}, noDocumentation ${noDocumentationFlips}`);
	check('G3-C the strict levers are live family-wide (collapseWhitespace flips > 0)', collapseFlips > 0);
	check('G3-C documentation participation is load-bearing family-wide (flips > 0)', noDocumentationFlips > 0);

	// GREEN: the split and the emitted chain edges independently reproduce Phase 0.
	evidence(`GREEN: strict split ${strictSplit.stable} stable / ${strictSplit.changed} changed — Phase 0 measured 896 names, 50 changed`);
	check('G3-C strict comparison reproduces Phase 0: 846 stable', strictSplit.stable === 846);
	check('G3-C strict comparison reproduces Phase 0: 50 changed', strictSplit.changed === 50);
	const boundaryChainEdges = args.runOne.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'SAME_DEFINITION' &&
			oneEdge.fromRef.id.indexOf(`${NS_CORE_1190}#`) === 0 &&
			oneEdge.toRef.id.indexOf(`${NS_CORE_1191}#`) === 0,
	);
	check('G3-C exactly 846 SAME_DEFINITION edges cross the 1.19.0->1.19.1 boundary', boundaryChainEdges.length === 846);
	check('G3-C ApplicationFeeAmountType among the strict-changed', strictSplit.changedNames.indexOf('simpleType/ApplicationFeeAmountType') !== -1);
	// GAP 5 residual — the third and last bare-substring edge filter. Safe-DIRECTION today (a
	// broader match makes this every(...) check stricter, not weaker) but it is the same pattern
	// that produced the phantom 17-vs-13, so it goes the way of the other two: discriminate on the
	// edge's own declared property rather than on a stableId substring.
	check('G3-C ApplicationFeeAmountType has NO chain edge across the boundary', boundaryChainEdges.every((oneEdge) => oneEdge.properties.definitionName !== 'ApplicationFeeAmountType'));

	// the verified-stable specimen: ClassRankType — all 14 CoreMain versions, one cluster.
	const classRankMembers = definitionNodes.filter(
		(oneNode) =>
			oneNode.properties.name === 'ClassRankType' && oneNode.stableId.indexOf(':CoreMain:') !== -1,
	);
	// The edge filter MUST be scoped to the same population as the member filter above. It
	// previously matched the bare stableId substring '/ClassRankType' with no family restriction,
	// which also swept in the FIVE sector:AdmissionsRecord complexType/ClassRankType definitions
	// and their 4 chain edges: 13 + 4 = the 17 that read as "four too many". A chain over 14
	// members can emit AT MOST 13 edges, so 17 could never have come from CoreMain at all — the
	// builder was correct and the assertion was comparing two different populations. Measured
	// confirmation: zero duplicate (from,to) pairs and zero nodes with out-degree > 1 across all
	// 10,400 SAME_DEFINITION edges. The AdmissionsRecord family becomes its own D-4 gate below.
	// GAP 6 / R-P3-2 — assert the discriminating properties are PRESENT before filtering on them.
	// A filter on an absent property matches nothing and reports zero, which reads identically to
	// a clean result: the very failure mode that makes 'zero cross-family edges' able to pass
	// vacuously. Presence first, then filter.
	const sameDefinitionEdgesForNameFilters = args.runOne.edges.filter(
		(oneEdge) => oneEdge.type === 'SAME_DEFINITION',
	);
	const nameFilterStarvedEdges = sameDefinitionEdgesForNameFilters.filter(
		(oneEdge) =>
			typeof oneEdge.properties.familyKey !== 'string' ||
			typeof oneEdge.properties.definitionName !== 'string',
	);
	check('G3-C GAP6: familyKey and definitionName are PRESENT on every edge these filters read', nameFilterStarvedEdges.length === 0 && sameDefinitionEdgesForNameFilters.length > 0);

	const classRankChainEdges = args.runOne.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'SAME_DEFINITION' &&
			oneEdge.properties.familyKey === 'core:CoreMain' &&
			oneEdge.properties.definitionName === 'ClassRankType',
	);
	const classRankClusterIds = new Set(
		classRankMembers.map((oneNode) => oneNode.properties.sameDefinitionClusterId),
	);
	// D-7 says CHAIN. A chain has out-degree at most 1 at every member; a clique does not. Assert
	// the TOPOLOGY, not merely the edge count — 13 edges over 14 members could in principle still
	// be mis-shaped, and the count alone would not notice.
	const classRankOutDegreeByMember = {};
	classRankChainEdges.forEach((oneEdge) => {
		classRankOutDegreeByMember[oneEdge.fromRef.id] =
			(classRankOutDegreeByMember[oneEdge.fromRef.id] || 0) + 1;
	});
	const classRankOutDegrees = Object.values(classRankOutDegreeByMember);
	if (classRankOutDegrees.length === 0) {
		// an absent measurement is a fault, never a plausible zero
		throw new Error(
			'HARNESS FAULT (G3-C): no CoreMain ClassRankType chain edges were found, so out-degree ' +
				'is UNMEASURABLE. Refusing to report it as 0.',
		);
	}
	const classRankMaxOutDegree = Math.max(...classRankOutDegrees);
	const classRankHops = classRankChainEdges
		.map((oneEdge) => `${oneEdge.properties.fromVersion}->${oneEdge.properties.toVersion}`)
		.sort();
	evidence(`GREEN: ClassRankType (core:CoreMain) ${classRankMembers.length} occurrences, ${classRankChainEdges.length} chain edges, ${classRankClusterIds.size} cluster (representative ${[...classRankClusterIds][0]}); max out-degree ${classRankMaxOutDegree}`);
	evidence(`chain hops: ${classRankHops.join(' ')}`);
	check('G3-C ClassRankType appears in all 14 CoreMain versions', classRankMembers.length === 14);
	check('G3-C ClassRankType chains across every version (13 edges, one cluster)', classRankChainEdges.length === 13 && classRankClusterIds.size === 1);
	check('G3-C ClassRankType topology is a CHAIN not a clique (D-7: max out-degree 1)', classRankMaxOutDegree === 1);
	check('G3-C ClassRankType cluster representative is the NEWEST member', [...classRankClusterIds][0] === `${NS_CORE_1191}#simpleType/ClassRankType`);

	// D-4 GATE — surfaced by the mis-scoped filter repaired above, and worth keeping as a gate in
	// its own right. AdmissionsRecord declares its OWN complexType/ClassRankType: the same name,
	// a different kind, a different library family. D-4 rules that a byte-identical type in a
	// different family is a COPY, not a survival — so the two populations must chain separately
	// and must never be joined. If they were joined, the churn query would lie.
	const admissionsClassRankMembers = definitionNodes.filter(
		(oneNode) =>
			oneNode.properties.name === 'ClassRankType' &&
			oneNode.stableId.indexOf(':AdmissionsRecord:') !== -1,
	);
	const admissionsClassRankEdges = args.runOne.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'SAME_DEFINITION' &&
			oneEdge.properties.familyKey === 'sector:AdmissionsRecord' &&
			oneEdge.properties.definitionName === 'ClassRankType',
	);
	const crossFamilyClassRankEdges = args.runOne.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'SAME_DEFINITION' &&
			oneEdge.properties.definitionName === 'ClassRankType' &&
			(oneEdge.fromRef.id.indexOf(':CoreMain:') !== -1) !==
				(oneEdge.toRef.id.indexOf(':CoreMain:') !== -1),
	);
	const admissionsClusterIds = new Set(
		admissionsClassRankMembers.map((oneNode) => oneNode.properties.sameDefinitionClusterId),
	);
	evidence(`D-4 specimen: AdmissionsRecord declares its OWN complexType/ClassRankType — ${admissionsClassRankMembers.length} members, ${admissionsClassRankEdges.length} chain edges, ${crossFamilyClassRankEdges.length} edges crossing the family boundary`);
	check('G3-C D-4: AdmissionsRecord ClassRankType chains inside its OWN family (5 members, 4 edges)', admissionsClassRankMembers.length === 5 && admissionsClassRankEdges.length === 4);
	check('G3-C D-4: ZERO SAME_DEFINITION edges join the CoreMain and AdmissionsRecord ClassRankTypes', crossFamilyClassRankEdges.length === 0);
	check('G3-C D-4: the two same-named clusters are DISJOINT', admissionsClusterIds.has(`${NS_CORE_1191}#simpleType/ClassRankType`) === false);

	// GAP 3 — D-7 topology asserted GLOBALLY, not on one specimen. The comment above used to
	// CLAIM cleanliness across all 10,400 edges; a comment is not an assertion, and a clique in
	// any family other than CoreMain/ClassRankType passed unnoticed. Four properties define the
	// D-7 chain and all four are now measured over every SAME_DEFINITION edge in the graph:
	// out-degree <= 1 per member, in-degree <= 1 per member, no duplicate (from,to) pair, no
	// cross-family edge (D-4), and every hop strictly ascending in version order.
	const allSameDefinitionEdges = args.runOne.edges.filter(
		(oneEdge) => oneEdge.type === 'SAME_DEFINITION',
	);
	if (allSameDefinitionEdges.length === 0) {
		throw new Error(
			'HARNESS FAULT (G3-C GAP3): no SAME_DEFINITION edges found, so the topology is ' +
				'UNMEASURABLE. Refusing to report an empty graph as a clean chain.',
		);
	}
	const globalOutDegree = {};
	const globalInDegree = {};
	const globalPairCounts = {};
	const crossFamilyEdges = [];
	const nonAscendingEdges = [];
	const propertyStarvedEdges = [];
	// version comparison, harness-local and independent of production's comparator
	const compareVersionsForGate = (versionA, versionB) => {
		const partsA = versionA.replace(/^v/, '').split('.').map(Number);
		const partsB = versionB.replace(/^v/, '').split('.').map(Number);
		for (let partIndex = 0; partIndex < Math.max(partsA.length, partsB.length); partIndex++) {
			const valueA = partsA[partIndex] === undefined ? 0 : partsA[partIndex];
			const valueB = partsB[partIndex] === undefined ? 0 : partsB[partIndex];
			if (valueA !== valueB) {
				return valueA < valueB ? -1 : 1;
			}
		}
		return 0;
	};
	const SAME_DEFINITION_EDGE_PROPERTY_NAMES = [
		'familyKey',
		'definitionKind',
		'definitionName',
		'fromVersion',
		'toVersion',
	];
	allSameDefinitionEdges.forEach((oneEdge) => {
		// R-P3-2: the edge property contract, asserted PRESENT before anything filters on it
		const missingProperties = SAME_DEFINITION_EDGE_PROPERTY_NAMES.filter(
			(onePropertyName) =>
				typeof oneEdge.properties[onePropertyName] !== 'string' ||
				oneEdge.properties[onePropertyName] === '',
		);
		if (missingProperties.length > 0) {
			propertyStarvedEdges.push(`${oneEdge.fromRef.id} (missing ${missingProperties.join(',')})`);
			return;
		}
		globalOutDegree[oneEdge.fromRef.id] = (globalOutDegree[oneEdge.fromRef.id] || 0) + 1;
		globalInDegree[oneEdge.toRef.id] = (globalInDegree[oneEdge.toRef.id] || 0) + 1;
		const pairLabel = `${oneEdge.fromRef.id} => ${oneEdge.toRef.id}`;
		globalPairCounts[pairLabel] = (globalPairCounts[pairLabel] || 0) + 1;
		if (compareVersionsForGate(oneEdge.properties.fromVersion, oneEdge.properties.toVersion) >= 0) {
			nonAscendingEdges.push(`${pairLabel} (${oneEdge.properties.fromVersion} -> ${oneEdge.properties.toVersion})`);
		}
		// D-4: both endpoints must sit in the family the edge declares. Compare the FULL familyKey
		// (layer AND token). An earlier form took .split(':').pop(), discarding the layer — which
		// is non-vacuous today only because the three family tokens happen to be unique across
		// layers, and would go blind the day a corpus carries both core:Foo and sector:Foo.
		if (
			oneEdge.fromRef.id.indexOf(`:${oneEdge.properties.familyKey}:`) === -1 ||
			oneEdge.toRef.id.indexOf(`:${oneEdge.properties.familyKey}:`) === -1
		) {
			crossFamilyEdges.push(`${pairLabel} declares family ${oneEdge.properties.familyKey}`);
		}
	});
	const maxGlobalOutDegree = Math.max(...Object.values(globalOutDegree));
	const maxGlobalInDegree = Math.max(...Object.values(globalInDegree));
	const duplicateGlobalPairs = Object.keys(globalPairCounts).filter(
		(onePair) => globalPairCounts[onePair] > 1,
	);
	evidence(`GAP3 global D-7 over ${allSameDefinitionEdges.length} SAME_DEFINITION edges: max out-degree ${maxGlobalOutDegree}, max in-degree ${maxGlobalInDegree}, duplicate pairs ${duplicateGlobalPairs.length}, cross-family ${crossFamilyEdges.length}, non-ascending ${nonAscendingEdges.length}, property-starved ${propertyStarvedEdges.length}`);
	check('G3-C GAP3/R-P3-2: EVERY SAME_DEFINITION edge carries the full declared property contract', propertyStarvedEdges.length === 0);
	check('G3-C GAP3: D-7 chain GLOBALLY — max out-degree 1 across all 10,400 edges', maxGlobalOutDegree === 1);
	check('G3-C GAP3: D-7 chain GLOBALLY — max in-degree 1 (no member is two versions\' successor)', maxGlobalInDegree === 1);
	check('G3-C GAP3: ZERO duplicate (from,to) pairs across the whole graph', duplicateGlobalPairs.length === 0);
	check('G3-C GAP3: D-4 GLOBALLY — ZERO edges cross a library family boundary', crossFamilyEdges.length === 0);
	check('G3-C GAP3: D-7 GLOBALLY — every hop strictly ASCENDS in version order', nonAscendingEdges.length === 0);
	check('G3-C GAP3: the global measurement covered all 10,400 edges', allSameDefinitionEdges.length === 10400);

	// AccreditationTypeType (the order's named specimen) is measured NOT fully stable: it
	// changed once at v1.16.0->v1.17.0, so it chains across every version it appears UNCHANGED —
	// two clusters, eight edges, the break exactly at the change. Asserted as found.
	// GAP 5 — this used the same bare-substring filter ('/AccreditationTypeType') that produced
	// the phantom 17-vs-13 ClassRankType discrepancy. Benign here only by accident of the corpus:
	// no other family happens to declare that name today. Scoped to the edges' own declared
	// properties, like its neighbours.
	const accreditationChainEdges = args.runOne.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'SAME_DEFINITION' &&
			oneEdge.properties.familyKey === 'core:CoreMain' &&
			oneEdge.properties.definitionName === 'AccreditationTypeType',
	);
	const accreditationBreakSpansChange = accreditationChainEdges.every(
		(oneEdge) => !(oneEdge.properties.fromVersion === 'v1.16.0' && oneEdge.properties.toVersion === 'v1.17.0'),
	);
	evidence(`AccreditationTypeType: ${accreditationChainEdges.length} chain edges; no edge spans v1.16.0->v1.17.0 (its one change): ${accreditationBreakSpansChange}`);
	check('G3-C AccreditationTypeType chains within its unchanged runs (8 edges, break at its one change)', accreditationChainEdges.length === 8 && accreditationBreakSpansChange);
	next('', args);
});

// =====================================================================
// G3-D — ambiguity honesty: the contested namespace is quarantined, recorded, computed
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG3-D — contested-namespace honesty (D-7)');
	const derivedStats = args.runOne.stats.derived;
	const ambiguousEntries = [];
	args.runOne.nodes.forEach((oneNode) => {
		if (oneNode.properties.ambiguousPendingSynthesis) {
			JSON.parse(oneNode.properties.ambiguousPendingSynthesis).forEach((oneEntry) =>
				ambiguousEntries.push(oneEntry),
			);
		}
	});

	// RESTATED AT PHASE 4 (supervisor ruling). This gate used to assert ZERO RESOLVES_TO edges into
	// the contested namespace, which was correct while Phase 3 held all 201 references pending
	// synthesis. Phase 4 legitimately answers them, so the world the old assertion described is
	// gone — but the invariant it was PROTECTING is not, and deleting it would have thrown that
	// away with it. The invariant that survives: no reference into the contested namespace is ever
	// resolved BY COMPUTATION. Every such edge must be synthetic, carry a syntheticRule, and be
	// traceable to the decision that authorized it; the DERIVED count must still be zero.
	const contestedTargetEdges = args.runOne.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'RESOLVES_TO' &&
			(oneEdge.toRef.id.indexOf(`${CONTESTED_NAMESPACE}#`) === 0 ||
				oneEdge.toRef.id === `pescNamespace:${CONTESTED_NAMESPACE}`),
	);
	const computedContestedEdges = contestedTargetEdges.filter(
		(oneEdge) => oneEdge.properties.pescTier !== 'synthetic',
	);
	const decidedContestedEdges = contestedTargetEdges.filter(
		(oneEdge) => oneEdge.properties.pescTier === 'synthetic' && oneEdge.properties.syntheticRule,
	);
	const decidedImportEdges = decidedContestedEdges.filter(
		(oneEdge) => oneEdge.properties.referenceVariety === 'import',
	);
	const everyEntryContested = ambiguousEntries.every((oneEntry) => oneEntry.namespace === CONTESTED_NAMESPACE);
	const externalConsumers = [
		...new Set(ambiguousEntries.filter((oneEntry) => !oneEntry.intraMember).map((oneEntry) => oneEntry.declaringFilename)),
	].sort();
	const expectedConsumers = [
		'CollegeTranscript_v1.3.0.xsd',
		'HighSchoolTranscript_v1.2.0.xsd',
		'TestScoreReport_v1.0.0.xsd',
		'TranscriptAcknowledgment_v1.1.0.xsd',
		'TranscriptRequest_v1.1.0.xsd',
		'TranscriptResponse_v1.1.0.xsd',
	];

	evidence(`recorded: ${ambiguousEntries.length} entries (${derivedStats.ambiguousIntraMemberRecorded} intra-member, ${ambiguousEntries.length - derivedStats.ambiguousIntraMemberRecorded} external); RESOLVES_TO into contested: ${contestedTargetEdges.length} total = ${decidedContestedEdges.length} DECIDED (synthetic, rule-tagged) + ${computedContestedEdges.length} COMPUTED`);
	check('G3-D ambiguous entries exist and all name the contested namespace', ambiguousEntries.length > 0 && everyEntryContested);
	check('G3-D annotation entries and stats agree', ambiguousEntries.length === derivedStats.ambiguousPendingSynthesisRecorded);
	check('G3-D ZERO references into the contested namespace are resolved by COMPUTATION', computedContestedEdges.length === 0);
	check('G3-D every resolution into the contested namespace is synthetic and rule-tagged, and they number exactly the 201 held references', decidedContestedEdges.length === ambiguousEntries.length && decidedContestedEdges.length === 201);
	check('G3-D the 201 decided resolutions split as 195 type-space references + 6 import declarations', decidedImportEdges.length === 6 && decidedContestedEdges.length - decidedImportEdges.length === 195);
	evidence(`GREEN: external consumers observed: ${externalConsumers.join(', ')}`);
	check('G3-D the consumer set is EXACTLY the six expected roots', JSON.stringify(externalConsumers) === JSON.stringify(expectedConsumers));
	check('G3-D every entry carries candidates for Phase 4 (none empty)', ambiguousEntries.every((oneEntry) => oneEntry.candidateStableIds.length > 0));

	// RED-1 — CHECKER LIVENESS. The headline assertion above is an assertion of ABSENCE
	// ("zero RESOLVES_TO edges target the contested namespace"), and an absence assertion is
	// worthless until the checker has been seen detecting a presence. Plant one such edge in a
	// clone and require the same condition to go red.
	const plantedGraph = cloneGraph(args.runOne);
	const contestedDefinitionNode = plantedGraph.nodes.find(
		(oneNode) =>
			oneNode.labels.indexOf('PescNamedDefinition') !== -1 &&
			oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#`) === 0,
	);
	if (contestedDefinitionNode === undefined) {
		throw new Error(
			'HARNESS FAULT (G3-D): no contested-namespace definition exists to plant an edge at. ' +
				'The liveness lever is unmeasurable, not passing.',
		);
	}
	plantedGraph.edges.push({
		type: 'RESOLVES_TO',
		fromRef: { source: 'PESC260805', id: 'harness:plantedReference' },
		toRef: { source: 'PESC260805', id: contestedDefinitionNode.stableId },
		properties: { provenanceTier: 'structural', pescTier: 'derived' },
	});
	// RESTATED AT PHASE 4 with the assertion it guards: the planted edge is pescTier:'derived', so
	// it is a COMPUTED resolution into the contested namespace — exactly what must never exist —
	// and the checker must pick it out from among the 201 legitimate synthetic ones.
	const plantedContestedTargetEdges = plantedGraph.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'RESOLVES_TO' &&
			oneEdge.properties.pescTier !== 'synthetic' &&
			(oneEdge.toRef.id.indexOf(`${CONTESTED_NAMESPACE}#`) === 0 ||
				oneEdge.toRef.id === `pescNamespace:${CONTESTED_NAMESPACE}`),
	);
	evidence(`RED-1 (demonstrated): one planted COMPUTED RESOLVES_TO into '${contestedDefinitionNode.stableId}' -> the checker now counts ${plantedContestedTargetEdges.length} computed edge(s) among ${contestedTargetEdges.length} total, condition inverts: ${plantedContestedTargetEdges.length !== 0}`);
	check('G3-D RED-1: the no-computed-resolution checker demonstrably detects a planted edge', plantedContestedTargetEdges.length === 1);

	// RED-2 — CONTESTED-NESS IS COMPUTED, NOT CONFIGURED. Remove one collision member and the
	// namespace stops being contested, so the builder must STOP RECORDING and START RESOLVING.
	//
	// The previous form of this lever asserted that references would then resolve cleanly
	// (ambiguous 0, edges appear). That premise is FALSE for this corpus, and the repair of the
	// harness-contamination bug is what finally let the truth through: the two collision members
	// PARTITION the type set their consumers need. 948d88f32069 alone declares RequestType and
	// ResponseType; e12830fc86a3 alone declares TestScoreReportType. NEITHER member alone can
	// serve the six external consumers, so removing EITHER leaves a reference with no target and
	// the tier refuses by name — symmetrically, and for a different reference each way.
	//
	// That refusal IS the demonstration, and a sharper one than the original: a reference into
	// that namespace can only be found unresolvable if the quarantine has LIFTED. While both
	// members are present the same references are recorded, never resolved, and no such refusal
	// is possible. So the lever now asserts the refusal, its reason, and its symmetry.
	//
	// (Phase 4 consequence, reported to the supervisor: S-1's merged AcademicRecord 1.6.0 must be
	// the UNION of both members. This measurement makes union a requirement, not a preference.)
	const removalProbes = [
		{ removedMemberSha12: '948d88f32069', expectedUnservedReference: 'AcRec:RequestType' },
		{ removedMemberSha12: 'e12830fc86a3', expectedUnservedReference: 'AcRec:TestScoreReportType' },
	];
	const removalVerdicts = removalProbes.map((oneProbe) => {
		const survivingGraph = args.freshStripped();
		assertPristineSourceGraph(survivingGraph, `G3-D removal of ${oneProbe.removedMemberSha12}`);
		const removedArtifactNode = survivingGraph.nodes.find(
			(oneNode) =>
				oneNode.labels.indexOf('PescArtifact') !== -1 &&
				oneNode.properties.sha256.indexOf(oneProbe.removedMemberSha12) === 0,
		);
		if (removedArtifactNode === undefined) {
			throw new Error(
				`HARNESS FAULT (G3-D): collision member '${oneProbe.removedMemberSha12}' is not in the ` +
					'corpus. The removal lever is unmeasurable, not passing.',
			);
		}
		const removedFullSha = removedArtifactNode.properties.sha256;
		const belongsToRemovedMember = (oneStableId) =>
			oneStableId.indexOf(`pescArtifact:${removedFullSha}`) === 0 ||
			oneStableId.indexOf(`@${oneProbe.removedMemberSha12}`) !== -1;
		survivingGraph.nodes = survivingGraph.nodes.filter(
			(oneNode) => !belongsToRemovedMember(oneNode.stableId),
		);
		survivingGraph.edges = survivingGraph.edges.filter(
			(oneEdge) =>
				!belongsToRemovedMember(oneEdge.fromRef.id) && !belongsToRemovedMember(oneEdge.toRef.id),
		);
		let removalError = '';
		try {
			buildDerivedTier({ nodes: survivingGraph.nodes, edges: survivingGraph.edges });
		} catch (thrownError) {
			removalError = thrownError.message;
		}
		// the quarantine lifted if and only if the builder ATTEMPTED resolution into that
		// namespace — visible as an unresolved-reference refusal naming it.
		const quarantineLifted =
			removalError.indexOf(CONTESTED_NAMESPACE) !== -1 &&
			removalError.indexOf(oneProbe.expectedUnservedReference) !== -1 &&
			removalError.indexOf('but no complexType/simpleType') !== -1;
		evidence(`RED-2 (demonstrated): remove ${oneProbe.removedMemberSha12} -> quarantine lifts, resolution attempted, tier REFUSES: ${removalError.substring(0, 165)}`);
		return { ...oneProbe, quarantineLifted };
	});
	check('G3-D RED-2: removing EITHER collision member lifts the quarantine and provokes an unresolved-reference refusal naming the namespace', removalVerdicts.length === 2 && removalVerdicts.every((oneVerdict) => oneVerdict.quarantineLifted));
	check('G3-D RED-2: the two members PARTITION the consumers\' type set (each removal strands a DIFFERENT reference)', removalVerdicts[0].expectedUnservedReference !== removalVerdicts[1].expectedUnservedReference);
	next('', args);
});

// =====================================================================
// G3-E — the latest view: isLatest, reachability, the orphan
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG3-E — latest view');
	const namespaceNodes = args.runOne.nodes.filter((oneNode) => oneNode.labels.indexOf('PescNamespace') !== -1);
	const latestNamespaces = namespaceNodes
		.filter((oneNode) => oneNode.properties.isLatest === true)
		.map((oneNode) => oneNode.properties.name)
		.sort();
	const expectedLatest = [
		'urn:org:pesc:codes:iso_3166-1:v1.0.0',
		'urn:org:pesc:core:CoreMain:v1.19.1',
		'urn:org:pesc:message:AcademicEportfolio:v1.0.0',
		'urn:org:pesc:message:AdmissionsApplication:v1.3.0',
		'urn:org:pesc:message:CollegeTranscript:v1.8.0',
		'urn:org:pesc:message:DocumentRequest:v1.0.0',
		'urn:org:pesc:message:DocumentResponse:v1.0.0',
		'urn:org:pesc:message:EducationCourseInventory:v1.0.0',
		'urn:org:pesc:message:HighSchoolTranscript:v1.6.0',
		'urn:org:pesc:message:LearningRecord:v1.0.0',
		'urn:org:pesc:message:TestScoreReport:v1.1.0',
		'urn:org:pesc:message:TranscriptAcknowledgment:v1.1.0',
		'urn:org:pesc:message:TranscriptRequest:v1.1.0',
		'urn:org:pesc:message:TranscriptResponse:v1.1.0',
		'urn:org:pesc:sector:AcademicRecord:v1.14.0',
		'urn:org:pesc:sector:AdmissionsRecord:v1.4.0',
	].sort();
	evidence(`isLatest namespaces (${latestNamespaces.length}): ${latestNamespaces.join(', ')}`);
	check('G3-E isLatest marks EXACTLY the expected sixteen namespaces', JSON.stringify(latestNamespaces) === JSON.stringify(expectedLatest));
	check('G3-E CoreMain v1.19.0 is NOT latest', namespaceNodes.find((oneNode) => oneNode.properties.name === NS_CORE_1190).properties.isLatest === false);

	// reachability — recompute the BFS INDEPENDENTLY in the harness and require set equality
	// with the annotations (the check that can fail; then the orphan is a spot assertion).
	const childrenByParentId = {};
	args.runOne.nodes.forEach((oneNode) => {
		const parentId = oneNode.properties.parentId;
		if (parentId) {
			(childrenByParentId[parentId] = childrenByParentId[parentId] || []).push(oneNode.stableId);
		}
	});
	// PHASE 4 SCOPING: DERIVED resolution edges only. reachableFromLatestRoot is a DERIVED
	// annotation, computed by a tier that cannot see synthetic edges, so a harness walk that
	// traverses them is not reproducing the annotation — it is measuring a different reachability
	// and calling the difference a defect. (The synthetic-aware reachability is a real and separate
	// question; it would be a synthetic-tier annotation, and no one has ruled on it. PROVISIONAL.)
	const resolvesToTargetsByFrom = {};
	args.runOne.edges.forEach((oneEdge) => {
		if (oneEdge.type === 'RESOLVES_TO' && oneEdge.properties.pescTier !== 'synthetic') {
			(resolvesToTargetsByFrom[oneEdge.fromRef.id] = resolvesToTargetsByFrom[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
		}
	});
	// GAP 4 — the BFS was seeded from production's OWN messageRootDefinitionStableIds, so a wrong
	// root set would reproduce in both the walk and the annotations and stay green. The roots are
	// now derived here and production's set must MATCH.
	//
	// BE PRECISE ABOUT WHAT THAT BUYS, because the first version of this comment overstated it
	// and the second adversarial review was right to say so:
	//
	//   INDEPENDENT: the artifact-to-root-element mapping. This walks stableId PREFIXES against
	//   the latest message namespaces; production walks declaringArtifactSha256. Genuinely
	//   different code over genuinely different properties — a bug in either is visible here.
	//
	//   NOT INDEPENDENT: the isLatest verdict itself. It is read off the derived namespace nodes,
	//   and production computed it with familyKeyOfArtifact + compareVersionTokens. A wrong
	//   latest-version verdict would reproduce on BOTH sides of this comparison and stay green.
	//
	//   WHAT ACTUALLY PINS isLatest: the hardcoded sixteen-namespace expectedLatest literal in
	//   G3-E below — PRE-EXISTING work, not this gap's. A literal is a sufficient pin and is
	//   cheaper than a second version comparator, which is why one was deliberately NOT built.
	const latestMessageNamespaceUris = args.runOne.nodes
		.filter(
			(oneNode) =>
				oneNode.labels.indexOf('PescNamespace') !== -1 &&
				oneNode.properties.isLatest === true &&
				oneNode.properties.layer === 'message',
		)
		.map((oneNode) => {
			// the namespace URI lives in `name`. Read it explicitly and REFUSE if absent — an
			// alternative-value expression here would silently seed the walk from a wrong set.
			if (typeof oneNode.properties.name !== 'string' || oneNode.properties.name === '') {
				throw new Error(
					`HARNESS FAULT (G3-E GAP4): PescNamespace '${oneNode.stableId}' carries no 'name' ` +
						'to read a namespace URI from. Refusing to substitute one.',
				);
			}
			return oneNode.properties.name;
		});
	if (latestMessageNamespaceUris.length === 0) {
		throw new Error(
			'HARNESS FAULT (G3-E GAP4): no latest message-layer namespaces found, so the root set is ' +
				'UNMEASURABLE. Refusing to treat an empty seed as agreement.',
		);
	}
	const harnessDerivedRootStableIds = namedDefinitionNodes(args.runOne)
		.filter(
			(oneNode) =>
				oneNode.properties.kind === 'element' &&
				latestMessageNamespaceUris.some(
					(oneNamespaceUri) => oneNode.stableId.indexOf(`${oneNamespaceUri}#`) === 0,
				),
		)
		.map((oneNode) => oneNode.stableId)
		.sort();
	const productionRootStableIds = [...args.runOne.stats.derived.messageRootDefinitionStableIds].sort();
	evidence(`GAP4 roots derived independently: ${harnessDerivedRootStableIds.length} (production says ${productionRootStableIds.length}); ${latestMessageNamespaceUris.length} latest message namespaces`);
	check('G3-E GAP4: the harness derives the SAME message-root set production used (12 roots)', harnessDerivedRootStableIds.length === 12 && JSON.stringify(harnessDerivedRootStableIds) === JSON.stringify(productionRootStableIds));

	const harnessBfs = (extraEdgesByFrom) => {
		const reached = new Set();
		const queue = [...harnessDerivedRootStableIds];
		while (queue.length > 0) {
			const currentStableId = queue.shift();
			if (reached.has(currentStableId)) {
				continue;
			}
			reached.add(currentStableId);
			const subtree = [currentStableId];
			for (let cursorIndex = 0; cursorIndex < subtree.length; cursorIndex++) {
				(childrenByParentId[subtree[cursorIndex]] || []).forEach((oneChildId) => subtree.push(oneChildId));
			}
			subtree.forEach((oneSubtreeId) => {
				(resolvesToTargetsByFrom[oneSubtreeId] || []).forEach((oneTargetId) => queue.push(oneTargetId));
				((extraEdgesByFrom && extraEdgesByFrom[oneSubtreeId]) || []).forEach((oneTargetId) => queue.push(oneTargetId));
			});
		}
		return reached;
	};

	const orphanStableId = `${NS_CORE_1191}#complexType/PerkinsType`;
	// RED first: inject a fake resolution edge root->PerkinsType in the HARNESS walk — the
	// comparison against the annotations must then fail, proving the recomputation is live.
	const rootStableIdForRed = harnessDerivedRootStableIds[0];
	const redReached = harnessBfs({ [rootStableIdForRed]: [orphanStableId] });
	const definitionNodes = namedDefinitionNodes(args.runOne);
	const annotatedReachable = new Set(
		definitionNodes.filter((oneNode) => oneNode.properties.reachableFromLatestRoot === true).map((oneNode) => oneNode.stableId),
	);
	const redDiffers = redReached.size !== annotatedReachable.size;
	evidence(`RED (demonstrated): harness BFS with one injected edge reaches ${redReached.size} vs annotated ${annotatedReachable.size} -> mismatch detected: ${redDiffers}`);
	check('G3-E RED: the independent BFS comparison demonstrably able to go red', redDiffers);

	const greenReached = harnessBfs(null);
	const setsEqual = greenReached.size === annotatedReachable.size && [...greenReached].every((oneId) => annotatedReachable.has(oneId));
	evidence(`GREEN: harness BFS reaches ${greenReached.size}; annotations say ${annotatedReachable.size}; equal: ${setsEqual}`);
	check('G3-E independent BFS reproduces the annotation set exactly', setsEqual);
	// GAP 4 — the count was asserted only as ">0 and <total", a band so wide that a large drift
	// passes. Pinned exactly; 2,282 of 12,909 is the measured latest-view closure.
	check('G3-E GAP4: reachableFromLatestRoot is EXACTLY 2,282 of 12,909 definitions', annotatedReachable.size === 2282 && definitionNodes.length === 12909);
	check('G3-E GAP4: production stats agree with the annotations on the nodes', args.runOne.stats.derived.reachableFromLatestRoot === annotatedReachable.size);
	const orphanNode = definitionNodes.find((oneNode) => oneNode.stableId === orphanStableId);
	evidence(`orphan specimen: ${orphanStableId} reachableFromLatestRoot=${orphanNode && orphanNode.properties.reachableFromLatestRoot}`);
	check('G3-E the financial-aid orphan (PerkinsType, CoreMain 1.19.1) is NOT reachable', !!orphanNode && orphanNode.properties.reachableFromLatestRoot === false && !greenReached.has(orphanStableId));
	next('', args);
});

// =====================================================================
// G3-F — the R-P2-5 guard: contentModelShape <-> element children, refused on drift
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG3-F — R-P2-5 consistency guard');
	const containersChecked = args.runOne.stats.derived.contentModelShapeContainersChecked;
	evidence(`containers checked in the production run: ${containersChecked}`);
	check('G3-F every shape-carrying container was checked (3,079 measured)', containersChecked === 3079);

	// RED: mutate ONE shape in a pristine fixture — swap the first two element positions — and
	// the SHAPE guard must refuse BY NAME.
	//
	// This lever was previously fed the harness's shared (and by then annotation-contaminated)
	// graph, so buildDerivedTier's PURITY guard refused before the shape guard ever ran. The
	// gate reported "a drifted shape is REFUSED" on the strength of a refusal about
	// `sameDefinitionClusterId`: the R-P2-5 guard it names had never been observed firing at all.
	// Three defences now stand between that and a repeat — a pristine fixture, a CONTROL proving
	// the unmutated fixture provokes NO refusal, and an assertion that the refusal came from the
	// shape guard specifically rather than from any other guard that happens to be upstream.
	const mutatedGraph = args.freshStripped();
	assertPristineSourceGraph(mutatedGraph, 'G3-F shape drift');

	// CONTROL — without this, ANY refusal from ANY source satisfies the RED lever and the gate
	// passes for the wrong reason. The fixture must be provably innocent before it is framed.
	const controlGraph = args.freshStripped();
	let controlError = '';
	try {
		buildDerivedTier({ nodes: controlGraph.nodes, edges: controlGraph.edges });
	} catch (thrownError) {
		controlError = thrownError.message;
	}
	evidence(`CONTROL: the UNMUTATED fixture builds ${controlError === '' ? 'with NO refusal' : `but REFUSED — ${controlError.substring(0, 140)}`}`);
	check('G3-F CONTROL: the unmutated fixture provokes no refusal', controlError === '');

	const mutationTargetNode = mutatedGraph.nodes.find((oneNode) => {
		if (!oneNode.properties.contentModelShape) {
			return false;
		}
		const elementPositions = [];
		const walkParticles = (oneShape) => {
			(oneShape.particles || []).forEach((oneParticle) => {
				if (oneParticle.element !== undefined) {
					elementPositions.push(oneParticle);
				} else if (oneParticle.compositor !== undefined) {
					walkParticles(oneParticle);
				}
			});
		};
		walkParticles(JSON.parse(oneNode.properties.contentModelShape));
		return elementPositions.length >= 2;
	});
	const mutatedShape = JSON.parse(mutationTargetNode.properties.contentModelShape);
	const flatParticleRefs = [];
	const collectElementParticles = (oneShape) => {
		(oneShape.particles || []).forEach((oneParticle) => {
			if (oneParticle.element !== undefined) {
				flatParticleRefs.push(oneParticle);
			} else if (oneParticle.compositor !== undefined) {
				collectElementParticles(oneParticle);
			}
		});
	};
	collectElementParticles(mutatedShape);
	const swappedPosition = flatParticleRefs[0].element;
	flatParticleRefs[0].element = flatParticleRefs[1].element;
	flatParticleRefs[1].element = swappedPosition;
	mutationTargetNode.properties.contentModelShape = JSON.stringify(mutatedShape);

	let guardError = '';
	try {
		buildDerivedTier({ nodes: mutatedGraph.nodes, edges: mutatedGraph.edges });
	} catch (thrownError) {
		guardError = thrownError.message;
	}
	evidence(`RED (observed refusal): ${guardError ? guardError : 'NO REFUSAL — defect'}`);
	check('G3-F a drifted shape is REFUSED', guardError !== '');
	check('G3-F the refusal names R-P2-5', guardError.indexOf('R-P2-5') !== -1);
	check('G3-F the refusal names the container', guardError.indexOf(mutationTargetNode.stableId) !== -1);
	// The assertion that closes the loop: the refusal must come from the SHAPE guard, identified
	// by its own wording, and must NOT be the purity guard wearing the shape guard's credit.
	check(
		'G3-F the refusal is the SHAPE guard itself, not another guard firing first',
		guardError.indexOf('contentModelShape enumerates') !== -1 &&
			guardError.indexOf('derived annotation') === -1,
	);
	next('', args);
});

// =====================================================================
// derived census (for the report; assertions pin the headline numbers)
// =====================================================================
taskList.push((args, next) => {
	console.log('\nCENSUS — derived tier');
	const derivedStats = args.runOne.stats.derived;
	evidence(JSON.stringify({
		namespaces: derivedStats.namespaces,
		isLatestNamespaces: derivedStats.isLatestNamespaces,
		inNamespaceEdges: derivedStats.inNamespaceEdges,
		importsEdges: derivedStats.importsEdges,
		unresolvedImportsRecorded: derivedStats.unresolvedImportsRecorded,
		resolvesToEdges: derivedStats.resolvesToEdges,
		builtinReferenceMarkers: derivedStats.builtinReferenceMarkers,
		ambiguousPendingSynthesisRecorded: derivedStats.ambiguousPendingSynthesisRecorded,
		ambiguousIntraMemberRecorded: derivedStats.ambiguousIntraMemberRecorded,
		unresolvedNamespaceReferencesRecorded: derivedStats.unresolvedNamespaceReferencesRecorded,
		sameDefinitionEdges: derivedStats.sameDefinitionEdges,
		reachableFromLatestRoot: derivedStats.reachableFromLatestRoot,
		definitionsTotal: derivedStats.definitionsTotal,
	}));
	check('CENSUS 63 namespaces (the contested one is ONE node)', derivedStats.namespaces === 63);
	check('CENSUS 64 IN_NAMESPACE edges (two artifacts share the contested node)', derivedStats.inNamespaceEdges === 64);
	check('CENSUS the CoreMain v1.6.0 gap is the ONE unresolved import', derivedStats.unresolvedImportsRecorded === 1);
	// GAP 2 — this assertion closed NOTHING. It compared four stats to four hardcoded constants
	// that were simply those same four stats written down, so two compensating errors passed and
	// the '- 6' was undocumented magic. Real accounting: count the references the SOURCE TIER
	// actually carries, then require the four derived dispositions to account for every one.
	//
	// The 6: ambiguousPendingSynthesis holds entries of two different kinds. Most are TYPE-space
	// references (a typeAsWritten/base/substitutionGroup/group-ref string on a source node). Six
	// carry referenceVariety 'import' — they are ambiguous xs:import DECLARATIONS, not references
	// into the type space, and they are already accounted for on the IMPORTS side. Subtracting
	// them here is correct; leaving it as a bare '- 6' was not. It is now COMPUTED from the
	// entries themselves, so if the corpus ever grows a seventh the arithmetic follows it.
	const ambiguousEntriesForAccounting = [];
	args.runOne.nodes.forEach((oneNode) => {
		if (oneNode.properties.ambiguousPendingSynthesis) {
			JSON.parse(oneNode.properties.ambiguousPendingSynthesis).forEach((oneEntry) =>
				ambiguousEntriesForAccounting.push(oneEntry),
			);
		}
	});
	const ambiguousImportDeclarationCount = ambiguousEntriesForAccounting.filter(
		(oneEntry) => oneEntry.referenceVariety === 'import',
	).length;
	const ambiguousTypeSpaceReferenceCount =
		ambiguousEntriesForAccounting.length - ambiguousImportDeclarationCount;

	// the independent denominator: every type-space reference written in the source tier.
	const REFERENCE_BEARING_PROPERTY_NAMES = ['typeAsWritten', 'baseAsWritten', 'substitutionGroupAsWritten'];
	let sourceTierReferenceCount = 0;
	args.runOne.nodes
		.filter((oneNode) => oneNode.properties.pescTier === 'source')
		.forEach((oneNode) => {
			REFERENCE_BEARING_PROPERTY_NAMES.forEach((onePropertyName) => {
				const writtenValue = oneNode.properties[onePropertyName];
				if (typeof writtenValue === 'string' && writtenValue !== '') {
					sourceTierReferenceCount++;
				}
			});
			// group refs are carried inside contentModelShape, not as a scalar property.
			//
			// N5 — LATENT, DOCUMENTED, DELIBERATELY NOT FIXED (supervisor ruling, second review).
			// This counts every groupRef OCCURRENCE. Production DEDUPS group refs per node, so the
			// two sides balance only because no node in this corpus currently carries the SAME
			// group ref twice. WHAT WOULD BREAK IT: one repeated group ref inside a single
			// container in a future corpus. This gate would then go RED on a non-bug — the
			// denominator would exceed the dispositions by exactly the number of repeats. If that
			// happens, dedup per node here to match production rather than doubting the tier.
			if (oneNode.properties.contentModelShape) {
				const countGroupRefs = (oneShape) => {
					(oneShape.particles || []).forEach((oneParticle) => {
						if (oneParticle.groupRef !== undefined) {
							sourceTierReferenceCount++;
						} else if (oneParticle.compositor !== undefined) {
							countGroupRefs(oneParticle);
						}
					});
				};
				countGroupRefs(JSON.parse(oneNode.properties.contentModelShape));
			}
		});
	const dispositionTotal =
		derivedStats.resolvesToEdges +
		derivedStats.builtinReferenceMarkers +
		ambiguousTypeSpaceReferenceCount +
		derivedStats.unresolvedNamespaceReferencesRecorded;
	evidence(`GAP2 accounting: source tier writes ${sourceTierReferenceCount} type-space references; dispositions = resolved ${derivedStats.resolvesToEdges} + builtin ${derivedStats.builtinReferenceMarkers} + ambiguous ${ambiguousTypeSpaceReferenceCount} (of ${ambiguousEntriesForAccounting.length}, less ${ambiguousImportDeclarationCount} import decls) + absent-ns ${derivedStats.unresolvedNamespaceReferencesRecorded} = ${dispositionTotal}`);
	if (sourceTierReferenceCount === 0) {
		throw new Error(
			'HARNESS FAULT (CENSUS GAP2): counted ZERO source-tier references, so the accounting is ' +
				'UNMEASURABLE. Refusing to report a vacuous balance.',
		);
	}
	check('CENSUS GAP2: every source-tier reference has EXACTLY one derived disposition (computed, not hardcoded)', dispositionTotal === sourceTierReferenceCount);
	check('CENSUS GAP2: the ambiguous-import subtraction is the 6 import declarations, computed from the entries', ambiguousImportDeclarationCount === 6);
	next('', args);
});

// =====================================================================
// LEDGER — every shipped assertion must carry recorded red evidence
// =====================================================================
// The third adversarial review observed that 34 of this suite's 66 assertions had never appeared
// in any retained FAIL log. Not false — "every gate observed red" was true of every gate anyone
// had checked — but UNEVIDENCED for half the suite, and an unevidenced claim decays into an
// assumed one. test/redEvidenceLedger.json now records, per assertion label, the log that caught
// it failing and the LEVER that produced that red. The lever is the load-bearing half: G3-F
// proved an assertion can go red for a reason other than the one it names, so "it failed once"
// is not evidence unless we know WHY.
//
// This gate generalizes the round-2 reconciliation, which covered only NEW assertions. A new
// assertion arriving with no ledger entry FAILS the suite. Bucket (b) — genuine gaps, never
// demonstrated able to fail by anyone — is REPORTED, not enforced: closing it is Phase 6's
// mutation suite, and this gate exists to keep the number visible and falling, not to block on it.
taskList.push((args, next) => {
	console.log('\nLEDGER — red evidence for every shipped assertion');
	const ledger = require(path.join(__dirname, 'redEvidenceLedger.json'));
	const suiteLedger = ledger.suites.derived;
	const ledgeredLabels = new Set(suiteLedger.assertions.map((oneEntry) => oneEntry.label));
	// THE GATE MUST NOT EXEMPT ITSELF. On its first run this reconciliation computed the label
	// set BEFORE its own three check() calls had executed, so its own assertions were absent from
	// the set and never had to be ledgered — it passed by excusing itself. Caught and fixed the
	// same hour it was written. The labels are declared here ONCE and used both to seed the set
	// and to make the calls, so the two can never drift apart.
	const LEDGER_GATE_LABELS = [
		'LEDGER every shipped assertion has a red-evidence entry',
		'LEDGER carries no stale entries for assertions this suite no longer runs',
		'LEDGER the entry count matches the assertions actually run',
	];
	const uniqueShippedLabels = [...new Set([...shippedAssertionLabels, ...LEDGER_GATE_LABELS])];
	const unledgeredLabels = uniqueShippedLabels.filter((oneLabel) => !ledgeredLabels.has(oneLabel));
	const staleLedgerLabels = [...ledgeredLabels].filter(
		(oneLabel) => uniqueShippedLabels.indexOf(oneLabel) === -1,
	);
	const statusCounts = { proven: 0, recordsGap: 0, genuineGap: 0 };
	suiteLedger.assertions.forEach((oneEntry) => {
		statusCounts[oneEntry.status]++;
	});
	evidence(`ledger: ${uniqueShippedLabels.length} shipped assertions; proven-red ${statusCounts.proven}, records-gap ${statusCounts.recordsGap}, GENUINE GAP ${statusCounts.genuineGap}`);
	if (unledgeredLabels.length > 0) {
		evidence(`UNLEDGERED (new assertion without red evidence): ${unledgeredLabels.join(' | ')}`);
	}
	if (staleLedgerLabels.length > 0) {
		evidence(`STALE ledger entries (assertion removed or renamed): ${staleLedgerLabels.join(' | ')}`);
	}
	check(LEDGER_GATE_LABELS[0], unledgeredLabels.length === 0);
	check(LEDGER_GATE_LABELS[1], staleLedgerLabels.length === 0);
	check(LEDGER_GATE_LABELS[2], suiteLedger.assertions.length === uniqueShippedLabels.length);
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nSUITE ABORTED: ${err}`);
		process.exit(1);
	}
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail === 0 ? 0 : 1);
});
