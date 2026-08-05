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
//   G3-D  ambiguity honesty: every contested reference RECORDED, ZERO RESOLVES_TO into the
//         contested namespace, consumer set exactly the six roots. RED by removing one
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
const check = (label, condition) => {
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
const stripDerived = (forged) => {
	const stripped = cloneGraph(forged);
	stripped.nodes = stripped.nodes.filter((oneNode) => oneNode.properties.pescTier !== 'derived');
	stripped.nodes.forEach((oneNode) => {
		DERIVED_ANNOTATION_PROPERTY_NAMES.forEach((oneAnnotationName) => {
			delete oneNode.properties[oneAnnotationName];
		});
	});
	stripped.edges = stripped.edges.filter((oneEdge) => oneEdge.properties.pescTier !== 'derived');
	return stripped;
};

// assertPristineSourceGraph — the HARNESS's own purity contract, enforced rather than assumed.
//
// applyDerivedTier stamps annotations onto its input nodes IN PLACE (documented at its
// definition: "the gate feeds clones"). G3-A fed it the harness's shared `stripped` graph and
// then passed that same object downstream, so every later RED lever received a graph carrying
// 23,233 annotated nodes. buildDerivedTier's purity guard correctly refused it — FIRST, before
// the guard each lever was actually testing could run. That is how G3-F came to report
// "a drifted shape is REFUSED" on the strength of a refusal about `sameDefinitionClusterId`:
// the shape guard it names had never once been observed firing.
//
// A RED lever must therefore prove its fixture pristine BEFORE pulling the lever. This throws
// rather than returning a verdict: a contaminated fixture is a fault in the test, not a finding
// about the code, and it must never be reportable as a pass.
const assertPristineSourceGraph = ({ nodes }, leverLabel) => {
	const contaminatedNodes = nodes.filter(
		(oneNode) =>
			oneNode.properties.pescTier === 'derived' ||
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

const namedDefinitionNodes = (forged) =>
	forged.nodes.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1);

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

	let regenerationError = '';
	let regeneratedView = '';
	try {
		const regeneratedOutput = buildDerivedTier({ nodes: stripped.nodes, edges: stripped.edges });
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
	// Downstream gates get a FUNCTION, not a shared graph. `stripped` above has just been mutated
	// in place by applyDerivedTier, and sharing it silently fed every later RED lever a fixture
	// the purity guard rejects. Handing out a fresh strip per call eliminates the shared mutable
	// state rather than merely detecting it; assertPristineSourceGraph then proves each fixture.
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
	check('G3-C ApplicationFeeAmountType has NO chain edge across the boundary', boundaryChainEdges.every((oneEdge) => oneEdge.fromRef.id.indexOf('/ApplicationFeeAmountType') === -1));

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

	// AccreditationTypeType (the order's named specimen) is measured NOT fully stable: it
	// changed once at v1.16.0->v1.17.0, so it chains across every version it appears UNCHANGED —
	// two clusters, eight edges, the break exactly at the change. Asserted as found.
	const accreditationChainEdges = args.runOne.edges.filter(
		(oneEdge) => oneEdge.type === 'SAME_DEFINITION' && oneEdge.fromRef.id.indexOf('/AccreditationTypeType') !== -1,
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

	const contestedTargetEdges = args.runOne.edges.filter(
		(oneEdge) => oneEdge.type === 'RESOLVES_TO' && oneEdge.toRef.id.indexOf(`${CONTESTED_NAMESPACE}#`) === 0,
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

	evidence(`recorded: ${ambiguousEntries.length} entries (${derivedStats.ambiguousIntraMemberRecorded} intra-member, ${ambiguousEntries.length - derivedStats.ambiguousIntraMemberRecorded} external); RESOLVES_TO into contested: ${contestedTargetEdges.length}`);
	check('G3-D ambiguous entries exist and all name the contested namespace', ambiguousEntries.length > 0 && everyEntryContested);
	check('G3-D annotation entries and stats agree', ambiguousEntries.length === derivedStats.ambiguousPendingSynthesisRecorded);
	check('G3-D ZERO RESOLVES_TO edges target a contested-namespace definition', contestedTargetEdges.length === 0);
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
	const plantedContestedTargetEdges = plantedGraph.edges.filter(
		(oneEdge) => oneEdge.type === 'RESOLVES_TO' && oneEdge.toRef.id.indexOf(`${CONTESTED_NAMESPACE}#`) === 0,
	);
	evidence(`RED-1 (demonstrated): one planted RESOLVES_TO into '${contestedDefinitionNode.stableId}' -> the checker now counts ${plantedContestedTargetEdges.length}, condition inverts: ${plantedContestedTargetEdges.length !== 0}`);
	check('G3-D RED-1: the zero-edges checker demonstrably detects a planted edge', plantedContestedTargetEdges.length === 1);

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
	const resolvesToTargetsByFrom = {};
	args.runOne.edges.forEach((oneEdge) => {
		if (oneEdge.type === 'RESOLVES_TO') {
			(resolvesToTargetsByFrom[oneEdge.fromRef.id] = resolvesToTargetsByFrom[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
		}
	});
	const harnessBfs = (extraEdgesByFrom) => {
		const reached = new Set();
		const queue = [...args.runOne.stats.derived.messageRootDefinitionStableIds];
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
	const rootStableIdForRed = args.runOne.stats.derived.messageRootDefinitionStableIds[0];
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
	check('G3-E reachable count nonzero and less than total definitions', annotatedReachable.size > 0 && annotatedReachable.size < definitionNodes.length);
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
	check('CENSUS reference accounting closes: resolved + builtin + ambiguous-refs + absent-ns = all references', derivedStats.resolvesToEdges + derivedStats.builtinReferenceMarkers + (derivedStats.ambiguousPendingSynthesisRecorded - 6) + derivedStats.unresolvedNamespaceReferencesRecorded === 17299 + 9921 + 195 + 205);
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
