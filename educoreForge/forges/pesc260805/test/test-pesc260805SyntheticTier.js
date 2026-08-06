#!/usr/bin/env node
'use strict';

// test-pesc260805SyntheticTier.js — the Phase 4 gate suite for the pesc260805 SYNTHETIC tier.
// ALL PURE: no Voyage call, no Neo4j, no golden touch.
//
// WHY THIS SUITE IS SHAPED DIFFERENTLY FROM THE OTHER TWO. The source tier is validated by
// FIDELITY (does it say what the file says) and the derived tier by REGENERABILITY (delete it,
// rebuild it, byte-identical). Neither test is available here: synthetic content is by definition
// something no file says and no computation over the files can produce. R-VAL-5 supplies the
// substitute — REPRODUCIBILITY: run the rule again over the two preserved collision members and
// require the same nodes, exactly. G4-A is that gate, and it is this tier's crown jewel the way
// G3-A is the derived tier's.
//
// Gates (work order, Phase 4):
//   G4-A  REPRODUCIBILITY (replaces round-trip for synthetic content, R-VAL-5): re-run the S-1
//         merge over the preserved collision artifacts; the synthetic view must be IDENTICAL.
//         RED by perturbing ONE input element declaration.
//   G4-B  the union is 109, split 42 college-only / 36 test-score-only / 31 shared, and in every
//         one of the 14 conflicts the COLLEGE-TRANSCRIPT definition is the one whose content the
//         merged node takes. RED by flipping the conflict winner (production probe).
//   G4-C  the 8 lost child elements are enumerated BY NAME, and every one of them is still present
//         under the LOSING member's own source-tier definition — the loss is queryable, not merely
//         documented. RED by asserting a wrong count (expectation probe).
//   G4-D  CONSUMER SATISFACTION — the point of the whole exercise. All SIX external consumers of
//         the contested namespace now resolve; TestScoreReport 1.0.0's single reference
//         AcRec:TestScoreReportType resolves (it was 100% unresolvable before) AND the transcript
//         consumers' RequestType/ResponseType resolve; neither member ALONE could have served
//         both, asserted explicitly from the source tier.
//   G4-E  S-2: all 205 recorded references (129 distinct local names) from AcademicRecord_v1.5.0
//         resolve through the alias into CoreMain 1.8.0; CollegeTranscript 1.2.0 and
//         HighSchoolTranscript 1.1.0 now fully resolve. RED by removing the alias's serving
//         artifact and observing the REFUSAL, in the shipped configuration.
//   G4-F  TIER HYGIENE: every synthetic node and edge carries pescTier:'synthetic' AND a
//         syntheticRule; ZERO synthetic content is reachable by the source-tier predicate; the
//         derived tier is unchanged.
//   G4-G  G3-A STILL PASSES: strip derived AND synthetic, regenerate the derived tier, require it
//         identical at 14,600,360 canonical bytes. A CHANGE IS A FINDING, NOT A NUMBER TO UPDATE.
//   DET   two full forge() runs produce identical complete outputs.
//   LEDGER every shipped assertion carries recorded red evidence and the lever that produced it.
//
// Run: node forges/pesc260805/test/test-pesc260805SyntheticTier.js

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
const syntheticTier = require(path.join(BUNDLE_DIR, 'lib', 'syntheticTier'))();
const {
	buildDerivedTier,
	applyDerivedTier,
	canonicalizeDerivedView,
	DERIVED_ANNOTATION_PROPERTY_NAMES,
} = derivedTier;
const {
	buildSyntheticTier,
	canonicalizeSyntheticView,
	S2_ABSENT_NAMESPACE,
	S2_SERVING_NAMESPACE,
} = syntheticTier;

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

// ---- EVERY EXPECTED NUMBER, IN ONE PLACE -------------------------------------------------
// Deliberately one object: the red probe for every census assertion in this suite is a single
// perturbation of this block, so the lever is unambiguous and recordable in the ledger.
const EXPECTED = {
	mergedDefinitions: 109,
	collegeOnly: 42,
	testScoreOnly: 36,
	shared: 31,
	conflicts: 14,
	collegeSupersetConflicts: 8,
	lostChildElements: 8,
	mergedFromEdges: 140,
	heldReferences: 201,
	heldTypeSpaceReferences: 195,
	heldImportDeclarations: 6,
	aliasReferences: 205,
	aliasDistinctLocalNames: 129,
	syntheticNodes: 110,
	syntheticEdges: 549,
	derivedNamespaces: 63,
	// LITERALS, deliberately not the module's own constants. G4-E's first draft compared the alias
	// against S2_SERVING_NAMESPACE imported from lib/syntheticTier.js, so repointing the alias
	// repointed the expectation with it and the assertion could never notice — proven by the
	// alias-repointing probe, which left it green. An expectation that reads the value it is
	// checking is not an expectation.
	aliasNamespace: 'urn:org:pesc:core:CoreMain:v1.6.0',
	aliasServingNamespace: 'urn:org:pesc:core:CoreMain:v1.8.0',
	g3aCanonicalBytes: 14600360,
	collegeMemberSha12: '948d88f32069',
	testScoreMemberSha12: 'e12830fc86a3',
	externalConsumers: [
		'CollegeTranscript_v1.3.0.xsd',
		'HighSchoolTranscript_v1.2.0.xsd',
		'TestScoreReport_v1.0.0.xsd',
		'TranscriptAcknowledgment_v1.1.0.xsd',
		'TranscriptRequest_v1.1.0.xsd',
		'TranscriptResponse_v1.1.0.xsd',
	],
	lostChildElementFullNames: [
		'AcademicRecordType.AdditionalStudentAchievement',
		'AcademicSummaryBaseType.AcademicHonors',
		'ContactsRType.Address',
		'ContactsType.Address',
		'ContactsType.Email',
		'ContactsType.Phone',
		'SchoolType.Contacts',
		'SponsorType.SponsorCode',
	],
	// the prototype's own published conflict table (researchArtifacts/syntheticAlterations.md).
	// Asserting against it is what proves the Node port of readChildElementSignature faithful.
	prototypeConflictTable: {
		AcademicRecordType: [9, 9],
		AcademicSessionType: [10, 8],
		AcademicSummaryBaseType: [9, 7],
		AcademicSummaryFType: [9, 3],
		AcknowledgmentPersonType: [16, 13],
		ContactsRType: [2, 2],
		ContactsType: [6, 5],
		CourseType: [42, 41],
		K12PersonType: [20, 15],
		OrganizationType: [5, 4],
		PersonType: [18, 15],
		SchoolType: [6, 6],
		SponsorType: [4, 4],
		TransmissionDataType: [12, 11],
	},
};

// ---- harness helpers ----------------------------------------------------

const cloneGraph = ({ nodes, edges }) => ({
	nodes: nodes.map((oneNode) => ({
		...oneNode,
		labels: [...oneNode.labels],
		properties: { ...oneNode.properties },
	})),
	edges: edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })),
});

// stripSynthetic — the input buildSyntheticTier is contracted to take: source + derived + meta,
// with every synthetic node and edge removed. The synthetic tier writes no annotations onto other
// nodes (by design — see lib/syntheticTier.js header), so unlike the derived strip there is
// nothing to un-stamp, and this gate ASSERTS that rather than assuming it.
const stripSynthetic = (forged) => {
	const stripped = cloneGraph(forged);
	stripped.nodes = stripped.nodes.filter((oneNode) => oneNode.properties.pescTier !== 'synthetic');
	stripped.edges = stripped.edges.filter((oneEdge) => oneEdge.properties.pescTier !== 'synthetic');
	return stripped;
};

// stripDerivedAndSynthetic — the Gate 3 DELETE as it must now be written: derived content is
// deleted for regeneration, and synthetic content goes with it because the derived tier is a
// function of the SOURCE tier alone and refuses synthetic input by name.
const stripDerivedAndSynthetic = (forged) => {
	const stripped = cloneGraph(forged);
	stripped.nodes = stripped.nodes.filter(
		(oneNode) => oneNode.properties.pescTier !== 'derived' && oneNode.properties.pescTier !== 'synthetic',
	);
	stripped.nodes.forEach((oneNode) => {
		DERIVED_ANNOTATION_PROPERTY_NAMES.forEach((oneAnnotationName) => {
			delete oneNode.properties[oneAnnotationName];
		});
	});
	stripped.edges = stripped.edges.filter(
		(oneEdge) => oneEdge.properties.pescTier !== 'derived' && oneEdge.properties.pescTier !== 'synthetic',
	);
	return stripped;
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

const labelHas = (oneNode, label) => oneNode.labels.indexOf(label) !== -1;

// indexGraph — the lookups the gates share. Built here rather than imported so a gate measures
// with its own machinery and cannot inherit a production indexing bug.
const indexGraph = ({ nodes, edges }) => {
	const nodeByStableId = {};
	const childrenByParentId = {};
	nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
		const parentId = oneNode.properties.parentId;
		if (parentId) (childrenByParentId[parentId] = childrenByParentId[parentId] || []).push(oneNode);
	});
	const artifactNodes = nodes.filter((oneNode) => labelHas(oneNode, 'PescArtifact'));
	const artifactByFilename = {};
	const artifactBySha256 = {};
	artifactNodes.forEach((oneNode) => {
		artifactByFilename[oneNode.properties.filename] = oneNode;
		artifactBySha256[oneNode.properties.sha256] = oneNode;
	});
	const edgesFrom = {};
	const edgesTo = {};
	edges.forEach((oneEdge) => {
		(edgesFrom[oneEdge.fromRef.id] = edgesFrom[oneEdge.fromRef.id] || []).push(oneEdge);
		(edgesTo[oneEdge.toRef.id] = edgesTo[oneEdge.toRef.id] || []).push(oneEdge);
	});
	return { nodeByStableId, childrenByParentId, artifactNodes, artifactByFilename, artifactBySha256, edgesFrom, edgesTo };
};

const syntheticNodesOf = (forged) =>
	forged.nodes.filter((oneNode) => oneNode.properties.pescTier === 'synthetic');
const syntheticEdgesOf = (forged) =>
	forged.edges.filter((oneEdge) => oneEdge.properties.pescTier === 'synthetic');

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
		next('', { ...args, runOne: forged, indexOne: indexGraph(forged) });
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
// DET — determinism over the COMPLETE output (source + derived + synthetic + meta)
// =====================================================================
taskList.push((args, next) => {
	console.log('\nDET — two full forge() runs identical (complete outputs, all four tiers)');
	const canonicalOne = canonicalizeWholeGraph(args.runOne);
	const canonicalTwo = canonicalizeWholeGraph(args.runTwo);

	// RED first: prove the comparator can fail — flip one SYNTHETIC property in a clone, so the
	// liveness demonstration lands on this suite's own subject matter rather than anywhere.
	const mutated = cloneGraph(args.runOne);
	const mutatedSyntheticNode = mutated.nodes.find(
		(oneNode) => oneNode.properties.pescTier === 'synthetic',
	);
	if (mutatedSyntheticNode === undefined) {
		throw new Error(
			'HARNESS FAULT (DET): the forge emitted NO synthetic node, so the comparator liveness ' +
				'lever has nothing to perturb. Unmeasurable, not passing.',
		);
	}
	mutatedSyntheticNode.properties.name = `${mutatedSyntheticNode.properties.name}-CONTAMINATED`;
	const comparatorCatches = canonicalizeWholeGraph(mutated) !== canonicalOne;
	evidence(`RED (demonstrated): one contaminated synthetic property ('${mutatedSyntheticNode.stableId}') -> comparator detects: ${comparatorCatches}`);
	check('DET RED: whole-graph comparator demonstrably able to go red on synthetic content', comparatorCatches);

	evidence(`GREEN: run one ${args.runOne.nodes.length} nodes / ${args.runOne.edges.length} edges; canonical forms equal: ${canonicalOne === canonicalTwo}`);
	check('DET two full runs byte-identical under canonical serialization', canonicalOne === canonicalTwo);
	next('', args);
});

// =====================================================================
// G4-A — REPRODUCIBILITY (R-VAL-5). THE gate for this tier.
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG4-A — reproducibility (R-VAL-5: the substitute for round-trip on decided content)');
	const shippedView = canonicalizeSyntheticView(args.runOne);
	const syntheticInput = stripSynthetic(args.runOne);
	evidence(`deleted: ${args.runOne.nodes.length - syntheticInput.nodes.length} synthetic nodes, ${args.runOne.edges.length - syntheticInput.edges.length} synthetic edges; ${syntheticInput.nodes.length} source+derived+meta nodes retained`);

	let rerunError = '';
	let rerunOutput = null;
	try {
		rerunOutput = buildSyntheticTier({ nodes: syntheticInput.nodes, edges: syntheticInput.edges });
	} catch (thrownError) {
		rerunError = thrownError.message;
	}
	if (rerunError) {
		evidence(`REFUSED: ${rerunError}`);
	}
	check('G4-A re-run over the preserved collision members completed without refusal', rerunError === '');
	const rerunView = rerunError
		? ''
		: canonicalizeSyntheticView({ nodes: rerunOutput.nodes, edges: rerunOutput.edges });
	evidence(`GREEN: re-run synthetic view identical to the emitted one: ${rerunView === shippedView} (${shippedView.length} canonical bytes)`);
	check('G4-A the re-run reproduces the synthetic nodes and edges EXACTLY', rerunView === shippedView);

	// RED — PERTURB EXACTLY ONE INPUT, at each of the two places the merge rule is sensitive.
	// A merge indifferent to its inputs is not reproducing them, it is reciting a constant.
	//
	// P1 renames ONE child element declaration inside the LOSING member's conflicting ContactsType.
	//    The lost-element enumeration is the merge's own subject matter, so the view must change.
	// P2 renames ONE top-level definition in the WINNING member. The union then lacks a name a
	//    consumer needs, and the tier must REFUSE rather than ship a merge that does not serve.
	//
	// AND THE HONEST THIRD CASE, recorded rather than hidden (found by this gate on its first run,
	// when its original lever perturbed the winner's child and the reproduction did not budge):
	// renaming a child of the WINNING member changes NOTHING in the synthetic view — correctly. The
	// merged node carries no content of its own, so a content change lives, and is gated, at the
	// SOURCE node its contentFromStableId points to. Asserting it makes the insensitivity a known
	// property with a stated reason instead of an unexamined silence.
	const perturbAndRebuild = (mutate) => {
		const perturbedInput = stripSynthetic(args.runOne);
		const mutationDescription = mutate(perturbedInput);
		let perturbedView = '';
		let perturbedError = '';
		try {
			const perturbedOutput = buildSyntheticTier({
				nodes: perturbedInput.nodes,
				edges: perturbedInput.edges,
			});
			perturbedView = canonicalizeSyntheticView({
				nodes: perturbedOutput.nodes,
				edges: perturbedOutput.edges,
			});
		} catch (thrownError) {
			perturbedError = thrownError.message;
		}
		return { mutationDescription, perturbedView, perturbedError, perturbedInput };
	};
	// the LEVERS ask PRODUCTION which member is which (the ASSERTIONS about that identification
	// live in G4-B against literals). Reading the expectation here instead made the sha12 constants
	// harness machinery as well as expectations, so a probe that corrupted them aborted the suite
	// with a HARNESS FAULT instead of producing the red it was after.
	const winningMemberSha12 = args.runOne.stats.synthetic.collegeTranscriptMemberSha256.substring(0, 12);
	const losingMemberSha12 = args.runOne.stats.synthetic.testScoreMemberSha256.substring(0, 12);
	const findOne = (graph, predicate, leverLabel) => {
		const found = graph.nodes.find(predicate);
		if (found === undefined) {
			throw new Error(
				`HARNESS FAULT (G4-A ${leverLabel}): the perturbation target is not in the graph. The ` +
					'lever is unmeasurable, not passing.',
			);
		}
		return found;
	};

	const probeOne = perturbAndRebuild((oneGraph) => {
		const targetNode = findOne(
			oneGraph,
			(oneNode) =>
				labelHas(oneNode, 'PescElementDecl') &&
				oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#complexType/ContactsType@${losingMemberSha12}`) === 0 &&
				oneNode.properties.name === 'Email',
			'P1',
		);
		targetNode.properties.name = 'EmailPerturbed';
		return `renamed the LOSING member's ContactsType child 'Email' -> 'EmailPerturbed'`;
	});
	const probeOneDetected = probeOne.perturbedError !== '' || probeOne.perturbedView !== shippedView;
	evidence(`RED P1 (demonstrated): ${probeOne.mutationDescription}; reproduction ${probeOneDetected ? 'BREAKS as it must' : 'DID NOT NOTICE'}`);
	check('G4-A RED P1: perturbing ONE element declaration in the losing member breaks reproduction', probeOneDetected);

	// P2's target is COMPUTED, not named: the first definition (in sorted order) that is unique to
	// one member, is named by at least one held reference, and is NOT one of the branch marker
	// types. The marker exclusion is load-bearing — P2's first draft renamed RequestType, which IS
	// a marker, so the tier refused about BRANCH IDENTIFICATION and the assertion would have passed
	// on a refusal about something else entirely. That is the exact "red for the wrong reason"
	// failure the ledger exists to catch, caught here by reading the refusal text.
	const heldReferenceLocalNames = new Set();
	args.runOne.nodes.forEach((oneNode) => {
		if (oneNode.properties.ambiguousPendingSynthesis) {
			JSON.parse(oneNode.properties.ambiguousPendingSynthesis).forEach((oneEntry) => {
				if (oneEntry.localName) heldReferenceLocalNames.add(oneEntry.localName);
			});
		}
	});
	const markerNames = new Set([
		...syntheticTier.S1_COLLEGE_BRANCH_MARKER_NAMES,
		...syntheticTier.S1_TEST_SCORE_BRANCH_MARKER_NAMES,
	]);
	const uniqueReferencedNames = [
		...args.runOne.syntheticMergeReport.collegeOnlyKeys,
		...args.runOne.syntheticMergeReport.testScoreOnlyKeys,
	]
		.map((oneKey) => oneKey.split('|')[1])
		.filter((oneName) => heldReferenceLocalNames.has(oneName) && !markerNames.has(oneName))
		.sort();
	if (uniqueReferencedNames.length === 0) {
		throw new Error(
			'HARNESS FAULT (G4-A P2): no single-member definition is named by a held reference, so the ' +
				'unserved-consumer lever is unmeasurable, not passing.',
		);
	}
	const probeTwoTargetName = uniqueReferencedNames[0];
	const probeTwo = perturbAndRebuild((oneGraph) => {
		const targetNode = findOne(
			oneGraph,
			(oneNode) =>
				labelHas(oneNode, 'PescNamedDefinition') &&
				oneNode.properties.name === probeTwoTargetName &&
				oneNode.stableId.indexOf(CONTESTED_NAMESPACE) === 0,
			'P2',
		);
		targetNode.properties.name = `${probeTwoTargetName}Perturbed`;
		return `renamed the single-member definition '${probeTwoTargetName}' -> '${probeTwoTargetName}Perturbed' (chosen by computation from ${uniqueReferencedNames.length} candidates; marker types excluded)`;
	});
	const probeTwoRefuses =
		probeTwo.perturbedError.indexOf('HELD REFERENCE STILL UNRESOLVED after S-1') !== -1 &&
		probeTwo.perturbedError.indexOf(`:${probeTwoTargetName}'`) !== -1;
	evidence(`RED P2 (demonstrated): ${probeTwo.mutationDescription}; tier ${probeTwoRefuses ? 'REFUSES BY NAME' : 'DID NOT REFUSE'}: ${probeTwo.perturbedError.substring(0, 150)}`);
	check('G4-A RED P2: perturbing ONE definition name leaves a consumer unserved and the tier REFUSES', probeTwoRefuses);

	const probeThree = perturbAndRebuild((oneGraph) => {
		const targetNode = findOne(
			oneGraph,
			(oneNode) =>
				labelHas(oneNode, 'PescElementDecl') &&
				oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#complexType/ContactsType@${winningMemberSha12}`) === 0,
			'P3',
		);
		targetNode.properties.name = `${targetNode.properties.name}Perturbed`;
		return `renamed a WINNING-member ContactsType child ('${targetNode.properties.name}')`;
	});
	const contentPointerNode = syntheticNodesOf(args.runOne).find(
		(oneNode) => oneNode.properties.name === 'ContactsType',
	);
	const contentPointerReachesTheChange =
		contentPointerNode !== undefined &&
		probeThree.perturbedInput.nodes.some(
			(oneNode) =>
				oneNode.properties.parentId === contentPointerNode.properties.contentFromStableId &&
				/Perturbed$/.test(`${oneNode.properties.name}`),
		);
	evidence(`THIRD CASE (recorded, not a defect): ${probeThree.mutationDescription}; synthetic view unchanged: ${probeThree.perturbedView === shippedView}; the change is reachable from the merged node's contentFromStableId: ${contentPointerReachesTheChange}`);
	check('G4-A the merged node carries no content of its own, and its contentFromStableId still reaches the changed source element', probeThree.perturbedView === shippedView && contentPointerReachesTheChange);

	// the purity guard: re-synthesis must refuse a graph that already carries synthesis, or a
	// re-run would compound its own output instead of reproducing it.
	let puritySyntheticRefusal = '';
	try {
		buildSyntheticTier({ nodes: args.runOne.nodes, edges: args.runOne.edges });
	} catch (thrownError) {
		puritySyntheticRefusal = thrownError.message;
	}
	evidence(`purity guard: re-synthesis over an already-synthesized graph -> ${puritySyntheticRefusal.substring(0, 130)}`);
	check('G4-A the tier REFUSES to synthesize from a graph that already carries synthetic content', puritySyntheticRefusal.indexOf('input carries synthetic node') !== -1);
	next('', args);
});

// =====================================================================
// G4-B — the union is 109, and the college-transcript branch wins every conflict
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG4-B — the union (R-P3-1: 42 unique + 36 unique + 31 shared = 109)');
	const syntheticStats = args.runOne.stats.synthetic;
	const mergeReport = args.runOne.syntheticMergeReport;
	const mergedDefinitionNodes = syntheticNodesOf(args.runOne).filter((oneNode) =>
		labelHas(oneNode, 'PescNamedDefinition'),
	);

	evidence(`split: ${syntheticStats.collegeTranscriptOnlyDefinitions} college-only + ${syntheticStats.testScoreOnlyDefinitions} test-score-only + ${syntheticStats.sharedDefinitions} shared = ${syntheticStats.mergedDefinitions} merged definition nodes (${mergedDefinitionNodes.length} emitted)`);
	check('G4-B the merged set is the UNION: 109 named definitions', syntheticStats.mergedDefinitions === EXPECTED.mergedDefinitions);
	check('G4-B 42 definitions are unique to the college-transcript member', syntheticStats.collegeTranscriptOnlyDefinitions === EXPECTED.collegeOnly);
	check('G4-B 36 definitions are unique to the test-score member', syntheticStats.testScoreOnlyDefinitions === EXPECTED.testScoreOnly);
	check('G4-B 31 definitions are declared by BOTH members', syntheticStats.sharedDefinitions === EXPECTED.shared);
	check('G4-B the arithmetic closes: 42 + 36 + 31 = the emitted node count', EXPECTED.collegeOnly + EXPECTED.testScoreOnly + EXPECTED.shared === mergedDefinitionNodes.length);
	check('G4-B the branches were identified by MARKER TYPES and the college member is 948d88f32069', syntheticStats.collegeTranscriptMemberSha256.indexOf(EXPECTED.collegeMemberSha12) === 0);
	check('G4-B the test-score member is e12830fc86a3', syntheticStats.testScoreMemberSha256.indexOf(EXPECTED.testScoreMemberSha12) === 0);

	evidence(`conflicts: ${syntheticStats.conflictingSharedDefinitions} of the ${syntheticStats.sharedDefinitions} shared names; college is the superset in ${syntheticStats.collegeSupersetConflicts} and the subset in 0 (a subset REFUSES in production)`);
	check('G4-B 14 of the 31 shared names genuinely conflict', syntheticStats.conflictingSharedDefinitions === EXPECTED.conflicts);
	check('G4-B the college definition is the superset in 8 of the 14 conflicts', syntheticStats.collegeSupersetConflicts === EXPECTED.collegeSupersetConflicts);

	// THE WINNER RULE, ASSERTED ON THE EMITTED NODES rather than on the stats that describe them:
	// every conflicting merged definition takes its content from the COLLEGE member. This is the
	// assertion the winner-flip production probe inverts.
	const conflictingMergedNodes = mergedDefinitionNodes.filter(
		(oneNode) => oneNode.properties.conflicting === true,
	);
	const collegeFullSha = syntheticStats.collegeTranscriptMemberSha256;
	const testScoreFullSha = syntheticStats.testScoreMemberSha256;
	const contentFromCollegeCount = conflictingMergedNodes.filter(
		(oneNode) => oneNode.properties.contentFromStableId.indexOf(`@${collegeFullSha.substring(0, 12)}`) !== -1,
	).length;
	const supersededIsTestScoreCount = conflictingMergedNodes.filter(
		(oneNode) => oneNode.properties.supersededStableId.indexOf(`@${testScoreFullSha.substring(0, 12)}`) !== -1,
	).length;
	evidence(`winner rule: ${contentFromCollegeCount}/${conflictingMergedNodes.length} conflicting merged definitions take content from the COLLEGE member; ${supersededIsTestScoreCount} name the test-score definition as superseded`);
	check('G4-B every conflicting merged definition takes its content from the college-transcript member', conflictingMergedNodes.length === EXPECTED.conflicts && contentFromCollegeCount === EXPECTED.conflicts);
	check('G4-B every conflicting merged definition names the superseded test-score definition', supersededIsTestScoreCount === EXPECTED.conflicts);

	// FIDELITY OF THE PORT: the per-type child counts must match the prototype's published table
	// (researchArtifacts/syntheticAlterations.md). If the Node signature walk drifted from the
	// Python .iter(), this is where it shows — and drift would silently change WHICH names are lost.
	const tableMismatches = mergeReport.conflictRecords.filter((oneRecord) => {
		const expectedCounts = EXPECTED.prototypeConflictTable[oneRecord.name];
		return (
			expectedCounts === undefined ||
			expectedCounts[0] !== oneRecord.collegeChildCount ||
			expectedCounts[1] !== oneRecord.testScoreChildCount
		);
	});
	evidence(`prototype conflict table: ${mergeReport.conflictRecords.length} conflicts compared, ${tableMismatches.length} mismatched${tableMismatches.length ? ` (${tableMismatches.map((oneRecord) => `${oneRecord.name} ${oneRecord.collegeChildCount}/${oneRecord.testScoreChildCount}`).join(', ')})` : ''}`);
	check('G4-B the Node signature port reproduces the prototype conflict table exactly (14 types, child counts)', tableMismatches.length === 0 && mergeReport.conflictRecords.length === EXPECTED.conflicts);

	// MERGED_FROM provenance: 78 single-member merges + 31 shared merges carrying two edges each.
	const mergedFromEdges = syntheticEdgesOf(args.runOne).filter((oneEdge) => oneEdge.type === 'MERGED_FROM');
	const mergedFromBySource = {};
	mergedFromEdges.forEach((oneEdge) => {
		mergedFromBySource[oneEdge.fromRef.id] = (mergedFromBySource[oneEdge.fromRef.id] || 0) + 1;
	});
	const everyMergedNodeHasProvenance = mergedDefinitionNodes.every(
		(oneNode) => mergedFromBySource[oneNode.stableId] >= 1,
	);
	const sharedNodesHaveTwo = mergedDefinitionNodes.filter(
		(oneNode) => mergedFromBySource[oneNode.stableId] === 2,
	).length;
	evidence(`MERGED_FROM: ${mergedFromEdges.length} edges; every merged definition has provenance: ${everyMergedNodeHasProvenance}; ${sharedNodesHaveTwo} carry two (the shared names)`);
	check('G4-B every merged definition carries MERGED_FROM provenance to its source definitions', everyMergedNodeHasProvenance && mergedFromEdges.length === EXPECTED.mergedFromEdges);
	check('G4-B the 31 shared names each carry TWO MERGED_FROM edges (kept and superseded)', sharedNodesHaveTwo === EXPECTED.shared);
	next('', args);
});

// =====================================================================
// G4-C — the 8 lost child elements, by name, and QUERYABLE
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG4-C — the price of the merge: 8 child element declarations, enumerated');
	const mergeReport = args.runOne.syntheticMergeReport;
	const observedFullNames = mergeReport.lostChildElements
		.map((oneLoss) => `${oneLoss.definitionName}.${oneLoss.elementName}`)
		.sort();
	evidence(`lost (${observedFullNames.length}): ${observedFullNames.join(', ')}`);
	check('G4-C exactly 8 child element declarations are lost', mergeReport.lostChildElements.length === EXPECTED.lostChildElements);
	check('G4-C the 8 lost elements are EXACTLY the enumerated names', JSON.stringify(observedFullNames) === JSON.stringify(EXPECTED.lostChildElementFullNames));

	// THE LOSS IS QUERYABLE, NOT MERELY DOCUMENTED (design §3.3). Every lost element must still be
	// present in the graph, as a source-tier PescElementDecl under the LOSING member's own
	// definition. A report that says a thing is gone, in a graph where it is genuinely gone, is a
	// eulogy; this asserts it is a forwarding address.
	const { childrenByParentId } = args.indexOne;
	const gatherElementDecls = (containerStableId) => {
		const found = [];
		const visit = (oneStableId) => {
			(childrenByParentId[oneStableId] || []).forEach((oneChild) => {
				if (labelHas(oneChild, 'PescElementDecl')) found.push(oneChild);
				visit(oneChild.stableId);
			});
		};
		visit(containerStableId);
		return found;
	};
	const unqueryableLosses = mergeReport.lostChildElements.filter((oneLoss) => {
		const losingDefinitionNode = args.indexOne.nodeByStableId[oneLoss.survivingUnderSourceDefinitionStableId];
		if (losingDefinitionNode === undefined) return true;
		if (losingDefinitionNode.properties.pescTier !== 'source') return true;
		return !gatherElementDecls(oneLoss.survivingUnderSourceDefinitionStableId).some(
			(oneElementNode) => oneElementNode.properties.name === oneLoss.elementName,
		);
	});
	evidence(`queryability: ${mergeReport.lostChildElements.length - unqueryableLosses.length}/${mergeReport.lostChildElements.length} lost elements found alive under the LOSING member's source-tier definition`);
	check('G4-C every lost element is still present under the losing variant SOURCE-tier node', unqueryableLosses.length === 0);

	// and the merged node itself names its own loss, so a consumer holding only the merged
	// definition can still discover what it cost.
	const mergedNodesWithLosses = syntheticNodesOf(args.runOne).filter(
		(oneNode) => oneNode.properties.lostChildElementCount > 0,
	);
	const declaredLossTotal = mergedNodesWithLosses.reduce(
		(runningTotal, oneNode) => runningTotal + oneNode.properties.lostChildElementCount,
		0,
	);
	evidence(`merged nodes declaring a loss: ${mergedNodesWithLosses.length} (${mergedNodesWithLosses.map((oneNode) => oneNode.properties.name).sort().join(', ')}); declared total ${declaredLossTotal}`);
	check('G4-C the merged nodes themselves declare the 8 losses (report and graph agree)', declaredLossTotal === EXPECTED.lostChildElements);

	// RED — the enumeration checker must be able to fail. Drop one name from the observed list and
	// require both the count and the name-set assertions to invert.
	const shortenedNames = observedFullNames.slice(1);
	const countInverts = shortenedNames.length !== EXPECTED.lostChildElements;
	const namesInvert = JSON.stringify(shortenedNames) !== JSON.stringify(EXPECTED.lostChildElementFullNames);
	evidence(`RED (demonstrated): dropping '${observedFullNames[0]}' from the observed list -> count assertion inverts: ${countInverts}, name-set assertion inverts: ${namesInvert}`);
	check('G4-C RED: the loss enumeration checker demonstrably detects a missing name', countInverts && namesInvert);
	next('', args);
});

// =====================================================================
// G4-D — CONSUMER SATISFACTION: the reason S-1 exists at all
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG4-D — consumer satisfaction (the point of the whole exercise)');
	const syntheticStats = args.runOne.stats.synthetic;
	const syntheticResolvesTo = syntheticEdgesOf(args.runOne).filter(
		(oneEdge) => oneEdge.type === 'RESOLVES_TO' && oneEdge.properties.syntheticRule === 'S-1',
	);
	const heldEdgesByVariety = {};
	syntheticResolvesTo.forEach((oneEdge) => {
		heldEdgesByVariety[oneEdge.properties.referenceVariety] =
			(heldEdgesByVariety[oneEdge.properties.referenceVariety] || 0) + 1;
	});
	const importEdgeCount = heldEdgesByVariety.import || 0;
	evidence(`held references answered: ${syntheticResolvesTo.length} (${JSON.stringify(heldEdgesByVariety)}) against ${syntheticStats.heldReferencesResolved} recorded by Phase 3`);
	check('G4-D all 201 held references now carry a synthetic RESOLVES_TO edge', syntheticResolvesTo.length === EXPECTED.heldReferences);
	check('G4-D the 201 split as 195 type-space references + 6 import declarations', syntheticResolvesTo.length - importEdgeCount === EXPECTED.heldTypeSpaceReferences && importEdgeCount === EXPECTED.heldImportDeclarations);

	// the six consumers, named, each with at least one answered reference.
	const consumerFilenamesAnswered = [...new Set(
		syntheticResolvesTo
			.filter((oneEdge) => oneEdge.properties.intraMember === false || oneEdge.properties.referenceVariety === 'import')
			.map((oneEdge) => {
				const fromNode = args.indexOne.nodeByStableId[oneEdge.fromRef.id];
				let cursor = fromNode;
				while (cursor !== undefined && !labelHas(cursor, 'PescArtifact')) {
					cursor = args.indexOne.nodeByStableId[cursor.properties.parentId];
				}
				return cursor === undefined ? '(unrooted)' : cursor.properties.filename;
			}),
	)]
		.filter((oneFilename) => oneFilename.indexOf('AcademicRecord_v1.6.0') !== 0)
		.sort();
	evidence(`external consumers answered: ${consumerFilenamesAnswered.join(', ')}`);
	check('G4-D all SIX external consumers of the contested namespace are answered', JSON.stringify(consumerFilenamesAnswered) === JSON.stringify(EXPECTED.externalConsumers));

	// TestScoreReport 1.0.0 — the specimen. Its ENTIRE file makes exactly one type reference, and
	// before S-1 that reference was 100% unresolvable against the college member.
	const testScoreReportArtifact = args.indexOne.artifactByFilename['TestScoreReport_v1.0.0.xsd'];
	if (testScoreReportArtifact === undefined) {
		throw new Error('HARNESS FAULT (G4-D): TestScoreReport_v1.0.0.xsd is not in the corpus.');
	}
	const isUnderArtifact = (oneStableId, artifactNode) => {
		let cursor = args.indexOne.nodeByStableId[oneStableId];
		while (cursor !== undefined && !labelHas(cursor, 'PescArtifact')) {
			cursor = args.indexOne.nodeByStableId[cursor.properties.parentId];
		}
		return cursor !== undefined && cursor.stableId === artifactNode.stableId;
	};
	const testScoreReportTypeEdges = syntheticResolvesTo.filter(
		(oneEdge) =>
			oneEdge.properties.writtenAs === 'AcRec:TestScoreReportType' &&
			isUnderArtifact(oneEdge.fromRef.id, testScoreReportArtifact),
	);
	const testScoreReportTarget = testScoreReportTypeEdges.length === 1
		? args.indexOne.nodeByStableId[testScoreReportTypeEdges[0].toRef.id]
		: undefined;
	evidence(`TestScoreReport 1.0.0: ${testScoreReportTypeEdges.length} edge for 'AcRec:TestScoreReportType' -> ${testScoreReportTarget === undefined ? 'NOTHING' : `${testScoreReportTarget.stableId} (pescTier ${testScoreReportTarget.properties.pescTier}, rule ${testScoreReportTarget.properties.syntheticRule}, from ${testScoreReportTarget.properties.mergeDisposition})`}`);
	check("G4-D TestScoreReport 1.0.0's single reference AcRec:TestScoreReportType now resolves", testScoreReportTypeEdges.length === 1 && testScoreReportTarget !== undefined && testScoreReportTarget.properties.pescTier === 'synthetic');
	check('G4-D and it resolves to a definition the TEST-SCORE member alone contributed', testScoreReportTarget !== undefined && testScoreReportTarget.properties.mergeDisposition === 'testScoreOnly');

	// the transcript consumers' RequestType / ResponseType, from the OTHER member.
	const transcriptTargets = ['AcRec:RequestType', 'AcRec:ResponseType'].map((oneWritten) => {
		const matchingEdges = syntheticResolvesTo.filter((oneEdge) => oneEdge.properties.writtenAs === oneWritten);
		return {
			writtenAs: oneWritten,
			edgeCount: matchingEdges.length,
			targetNode: matchingEdges.length > 0 ? args.indexOne.nodeByStableId[matchingEdges[0].toRef.id] : undefined,
		};
	});
	evidence(`transcript consumers: ${transcriptTargets.map((oneTarget) => `${oneTarget.writtenAs} -> ${oneTarget.targetNode === undefined ? 'NOTHING' : `${oneTarget.targetNode.properties.mergeDisposition}`} (${oneTarget.edgeCount} edge)`).join('; ')}`);
	check("G4-D the transcript consumers' RequestType and ResponseType resolve, from the COLLEGE member alone", transcriptTargets.every((oneTarget) => oneTarget.edgeCount > 0 && oneTarget.targetNode !== undefined && oneTarget.targetNode.properties.mergeDisposition === 'collegeTranscriptOnly'));

	// THE EXPLICIT CLAIM: neither member alone could have served both. Measured from the SOURCE
	// tier — not from the merge's own bookkeeping, which would be circular.
	const definitionNamesOfMember = (memberSha256) =>
		new Set(
			args.runOne.nodes
				.filter(
					(oneNode) =>
						labelHas(oneNode, 'PescNamedDefinition') &&
						oneNode.properties.pescTier === 'source' &&
						oneNode.properties.declaringArtifactSha256 === memberSha256,
				)
				.map((oneNode) => oneNode.properties.name),
		);
	const collegeNames = definitionNamesOfMember(syntheticStats.collegeTranscriptMemberSha256);
	const testScoreNames = definitionNamesOfMember(syntheticStats.testScoreMemberSha256);
	const collegeCannotServeTestScore = !collegeNames.has('TestScoreReportType');
	const testScoreCannotServeTranscripts = !testScoreNames.has('RequestType') && !testScoreNames.has('ResponseType');
	evidence(`partition proof: college member declares TestScoreReportType: ${collegeNames.has('TestScoreReportType')}; test-score member declares RequestType/ResponseType: ${testScoreNames.has('RequestType')}/${testScoreNames.has('ResponseType')}`);
	check('G4-D NEITHER member alone could serve both populations (measured from the source tier)', collegeCannotServeTestScore && testScoreCannotServeTranscripts);
	next('', args);
});

// =====================================================================
// G4-E — S-2, the CoreMain v1.6.0 alias
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG4-E — S-2: the CoreMain v1.6.0 alias and the 129 references that travel it');
	const syntheticStats = args.runOne.stats.synthetic;
	const aliasNamespaceNode = args.indexOne.nodeByStableId[`pescNamespace:${EXPECTED.aliasNamespace}`];
	const servedByEdges = syntheticEdgesOf(args.runOne).filter((oneEdge) => oneEdge.type === 'SERVED_BY');
	evidence(`alias node: ${aliasNamespaceNode === undefined ? 'ABSENT' : `${aliasNamespaceNode.stableId} (pescTier ${aliasNamespaceNode.properties.pescTier}, rule ${aliasNamespaceNode.properties.syntheticRule}, servedBy ${aliasNamespaceNode.properties.servedByNamespace})`}; SERVED_BY edges: ${servedByEdges.length}`);
	check('G4-E a synthetic PescNamespace node stands in for the absent CoreMain v1.6.0', aliasNamespaceNode !== undefined && aliasNamespaceNode.properties.pescTier === 'synthetic' && aliasNamespaceNode.properties.syntheticRule === 'S-2' && aliasNamespaceNode.properties.servedByNamespace === EXPECTED.aliasServingNamespace);
	check('G4-E it carries exactly one SERVED_BY edge to the real v1.8.0 namespace', servedByEdges.length === 1 && servedByEdges[0].fromRef.id === `pescNamespace:${EXPECTED.aliasNamespace}` && servedByEdges[0].toRef.id === `pescNamespace:${EXPECTED.aliasServingNamespace}`);

	const aliasEdges = syntheticEdgesOf(args.runOne).filter(
		(oneEdge) => oneEdge.type === 'RESOLVES_TO' && oneEdge.properties.syntheticRule === 'S-2',
	);
	const aliasDefinitionEdges = aliasEdges.filter((oneEdge) => oneEdge.properties.referenceVariety !== 'import');
	const servingArtifactNode = args.indexOne.artifactByFilename['CoreMain_v1.8.0.xsd'];
	const targetsNotInServingArtifact = aliasDefinitionEdges.filter((oneEdge) => {
		const targetNode = args.indexOne.nodeByStableId[oneEdge.toRef.id];
		return (
			targetNode === undefined ||
			targetNode.properties.declaringArtifactSha256 !== servingArtifactNode.properties.sha256
		);
	});
	const distinctLocalNames = new Set(
		aliasDefinitionEdges.map((oneEdge) => oneEdge.properties.writtenAs.split(':').pop()),
	);
	evidence(`alias traffic: ${aliasDefinitionEdges.length} reference edges over ${distinctLocalNames.size} distinct local names; targets NOT declared by CoreMain_v1.8.0: ${targetsNotInServingArtifact.length}`);
	check('G4-E all 205 recorded references resolve through the alias', aliasDefinitionEdges.length === EXPECTED.aliasReferences && syntheticStats.aliasReferencesResolved === EXPECTED.aliasReferences);
	check("G4-E they cover the prototype's 129 distinct core: names, all of them", distinctLocalNames.size === EXPECTED.aliasDistinctLocalNames && syntheticStats.aliasDistinctLocalNames === EXPECTED.aliasDistinctLocalNames);
	check('G4-E every alias reference lands on a definition CoreMain_v1.8.0 actually declares', targetsNotInServingArtifact.length === 0);

	// the import itself travels the alias, and the artifact gains the IMPORTS edge the derived tier
	// could not compute.
	const aliasImportEdges = aliasEdges.filter((oneEdge) => oneEdge.properties.referenceVariety === 'import');
	const syntheticImportsEdges = syntheticEdgesOf(args.runOne).filter((oneEdge) => oneEdge.type === 'IMPORTS');
	evidence(`import: ${aliasImportEdges.length} RESOLVES_TO onto the alias namespace, ${syntheticImportsEdges.length} synthetic IMPORTS edge to ${syntheticImportsEdges.length ? args.indexOne.nodeByStableId[syntheticImportsEdges[0].toRef.id].properties.filename : 'NOTHING'}`);
	check("G4-E AcademicRecord_v1.5.0's unresolved import now resolves onto the alias namespace", aliasImportEdges.length === 1 && aliasImportEdges[0].toRef.id === `pescNamespace:${EXPECTED.aliasNamespace}`);
	check('G4-E and the artifact gains a synthetic IMPORTS edge to CoreMain_v1.8.0', syntheticImportsEdges.length === 1 && syntheticImportsEdges[0].toRef.id === servingArtifactNode.stableId);

	// CollegeTranscript 1.2.0 and HighSchoolTranscript 1.1.0 — the two roots that depend on
	// AcademicRecord 1.5.0 — now FULLY resolve. Measured as a reference accounting over their whole
	// reachable closure: every written reference has exactly one disposition, and none is left
	// recorded-but-unanswered.
	const closureRoots = ['CollegeTranscript_v1.2.0.xsd', 'HighSchoolTranscript_v1.1.0.xsd'];
	const closureVerdicts = closureRoots.map((oneFilename) => {
		const rootArtifactNode = args.indexOne.artifactByFilename[oneFilename];
		if (rootArtifactNode === undefined) {
			throw new Error(`HARNESS FAULT (G4-E): '${oneFilename}' is not in the corpus.`);
		}
		const visitedArtifactStableIds = new Set();
		const artifactQueue = [rootArtifactNode.stableId];
		while (artifactQueue.length > 0) {
			const oneArtifactStableId = artifactQueue.shift();
			if (visitedArtifactStableIds.has(oneArtifactStableId)) continue;
			visitedArtifactStableIds.add(oneArtifactStableId);
			(args.indexOne.edgesFrom[oneArtifactStableId] || [])
				.filter((oneEdge) => oneEdge.type === 'IMPORTS')
				.forEach((oneEdge) => artifactQueue.push(oneEdge.toRef.id));
		}
		const closureFilenames = [...visitedArtifactStableIds]
			.map((oneStableId) => args.indexOne.nodeByStableId[oneStableId].properties.filename)
			.sort();
		// every node in the closure that RECORDED an unanswered question must now have an answer.
		let recordedQuestions = 0;
		let answeredQuestions = 0;
		args.runOne.nodes.forEach((oneNode) => {
			let cursor = oneNode;
			while (cursor !== undefined && !labelHas(cursor, 'PescArtifact')) {
				cursor = args.indexOne.nodeByStableId[cursor.properties.parentId];
			}
			if (cursor === undefined || !visitedArtifactStableIds.has(cursor.stableId)) return;
			const recorded =
				(oneNode.properties.unresolvedNamespaceReferences
					? JSON.parse(oneNode.properties.unresolvedNamespaceReferences).length
					: 0) +
				(oneNode.properties.ambiguousPendingSynthesis
					? JSON.parse(oneNode.properties.ambiguousPendingSynthesis).length
					: 0);
			if (recorded === 0) return;
			recordedQuestions += recorded;
			answeredQuestions += (args.indexOne.edgesFrom[oneNode.stableId] || []).filter(
				(oneEdge) => oneEdge.properties.pescTier === 'synthetic' && oneEdge.type === 'RESOLVES_TO',
			).length;
		});
		return { filename: oneFilename, closureFilenames, recordedQuestions, answeredQuestions };
	});
	closureVerdicts.forEach((oneVerdict) => {
		evidence(`${oneVerdict.filename}: import closure ${oneVerdict.closureFilenames.length} files (${oneVerdict.closureFilenames.join(', ')}); recorded questions ${oneVerdict.recordedQuestions}, answered ${oneVerdict.answeredQuestions}`);
	});
	check('G4-E the two dependent roots actually reach AcademicRecord_v1.5.0 (the claim is not vacuous)', closureVerdicts.every((oneVerdict) => oneVerdict.closureFilenames.indexOf('AcademicRecord_v1.5.0.xsd') !== -1 && oneVerdict.recordedQuestions > 0));
	check('G4-E CollegeTranscript 1.2.0 and HighSchoolTranscript 1.1.0 now FULLY resolve (every recorded question answered)', closureVerdicts.every((oneVerdict) => oneVerdict.answeredQuestions === oneVerdict.recordedQuestions));

	// RED — REMOVE THE ALIAS'S SERVING ARTIFACT and observe the refusal, in the SHIPPED
	// configuration. An alias that resolves most of its references is a forgery that also does not
	// work, so the tier must refuse BY NAME rather than ship a partial substitution.
	const aliasRemovalInput = stripSynthetic(args.runOne);
	const removedServingArtifactStableId = servingArtifactNode.stableId;
	const belongsToServingArtifact = (oneStableId) =>
		oneStableId.indexOf(removedServingArtifactStableId) === 0 ||
		oneStableId === `pescNamespace:${S2_SERVING_NAMESPACE}`;
	aliasRemovalInput.nodes = aliasRemovalInput.nodes.filter(
		(oneNode) =>
			!belongsToServingArtifact(oneNode.stableId) &&
			oneNode.properties.declaringArtifactSha256 !== servingArtifactNode.properties.sha256,
	);
	aliasRemovalInput.edges = aliasRemovalInput.edges.filter(
		(oneEdge) => !belongsToServingArtifact(oneEdge.fromRef.id) && !belongsToServingArtifact(oneEdge.toRef.id),
	);
	let aliasRemovalRefusal = '';
	try {
		buildSyntheticTier({ nodes: aliasRemovalInput.nodes, edges: aliasRemovalInput.edges });
	} catch (thrownError) {
		aliasRemovalRefusal = thrownError.message;
	}
	const refusalNamesTheAlias =
		aliasRemovalRefusal.indexOf(S2_SERVING_NAMESPACE) !== -1 &&
		aliasRemovalRefusal.indexOf(S2_ABSENT_NAMESPACE) !== -1;
	evidence(`RED (demonstrated): removed the serving artifact CoreMain_v1.8.0 -> ${aliasRemovalRefusal.substring(0, 190)}`);
	check('G4-E RED: with the alias unservable the tier REFUSES BY NAME, naming both namespaces', refusalNamesTheAlias);
	next('', args);
});

// =====================================================================
// G4-F — tier hygiene
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG4-F — tier hygiene (design §2: the emitter reads ONE predicate)');
	const syntheticNodes = syntheticNodesOf(args.runOne);
	const syntheticEdges = syntheticEdgesOf(args.runOne);
	const nodesWithoutRule = syntheticNodes.filter(
		(oneNode) => oneNode.properties.syntheticRule !== 'S-1' && oneNode.properties.syntheticRule !== 'S-2',
	);
	const edgesWithoutRule = syntheticEdges.filter(
		(oneEdge) => oneEdge.properties.syntheticRule !== 'S-1' && oneEdge.properties.syntheticRule !== 'S-2',
	);
	evidence(`synthetic census: ${syntheticNodes.length} nodes, ${syntheticEdges.length} edges; missing a syntheticRule: ${nodesWithoutRule.length} nodes, ${edgesWithoutRule.length} edges`);
	check('G4-F the synthetic tier emits exactly 110 nodes and 549 edges', syntheticNodes.length === EXPECTED.syntheticNodes && syntheticEdges.length === EXPECTED.syntheticEdges);
	check('G4-F every synthetic node and edge carries a syntheticRule naming the decision', nodesWithoutRule.length === 0 && edgesWithoutRule.length === 0);

	// THE EMITTER'S PREDICATE. The round-trip emitter reads pescTier === 'source' and nothing else,
	// so a single synthetic node reachable by that predicate would put a fabricated statement into
	// a re-emitted PESC file. This is the assertion with the largest blast radius in the suite.
	const syntheticStableIds = new Set(syntheticNodes.map((oneNode) => oneNode.stableId));
	const syntheticReachableAsSource = args.runOne.nodes.filter(
		(oneNode) => oneNode.properties.pescTier === 'source' && syntheticStableIds.has(oneNode.stableId),
	);
	const sourcePredicateNodes = args.runOne.nodes.filter((oneNode) => oneNode.properties.pescTier === 'source');
	const sourceNodesWithSyntheticRule = sourcePredicateNodes.filter(
		(oneNode) => oneNode.properties.syntheticRule !== undefined,
	);
	const sourcePredicateEdges = args.runOne.edges.filter((oneEdge) => oneEdge.properties.pescTier === 'source');
	const sourceEdgesWithSyntheticRule = sourcePredicateEdges.filter(
		(oneEdge) => oneEdge.properties.syntheticRule !== undefined,
	);
	evidence(`source predicate: ${sourcePredicateNodes.length} nodes / ${sourcePredicateEdges.length} edges, of which synthetic-bearing: ${syntheticReachableAsSource.length + sourceNodesWithSyntheticRule.length} nodes, ${sourceEdgesWithSyntheticRule.length} edges`);
	check("G4-F ZERO synthetic content is reachable by the emitter's source predicate", syntheticReachableAsSource.length === 0 && sourceNodesWithSyntheticRule.length === 0 && sourceEdgesWithSyntheticRule.length === 0);

	// resolution-by-decision is never disguised as resolution-by-computation (design §3.3): every
	// RESOLVES_TO edge into the contested namespace or the alias namespace is SYNTHETIC.
	const contestedOrAliasResolutions = args.runOne.edges.filter((oneEdge) => {
		if (oneEdge.type !== 'RESOLVES_TO') return false;
		const targetNode = args.indexOne.nodeByStableId[oneEdge.toRef.id];
		if (targetNode === undefined) return false;
		return (
			oneEdge.toRef.id.indexOf(`${CONTESTED_NAMESPACE}#`) === 0 ||
			oneEdge.toRef.id === `pescNamespace:${CONTESTED_NAMESPACE}` ||
			oneEdge.toRef.id === `pescNamespace:${S2_ABSENT_NAMESPACE}` ||
			oneEdge.properties.viaAliasNamespace === S2_ABSENT_NAMESPACE
		);
	});
	const decidedButUnmarked = contestedOrAliasResolutions.filter(
		(oneEdge) => oneEdge.properties.pescTier !== 'synthetic',
	);
	evidence(`decided resolutions: ${contestedOrAliasResolutions.length} edges into the contested or aliased namespaces; marked anything other than synthetic: ${decidedButUnmarked.length}`);
	check('G4-F resolution-by-decision is NEVER disguised as resolution-by-computation', decidedButUnmarked.length === 0 && contestedOrAliasResolutions.length === EXPECTED.heldReferences + EXPECTED.aliasReferences + 1);

	// THE DERIVED TIER IS UNCHANGED: it carries no synthetic content and its census is what Phase 3
	// emitted. (G4-G proves the stronger claim — that it still regenerates byte-identically.)
	const derivedNodes = args.runOne.nodes.filter((oneNode) => oneNode.properties.pescTier === 'derived');
	const derivedNodesWithSyntheticRule = derivedNodes.filter(
		(oneNode) => oneNode.properties.syntheticRule !== undefined,
	);
	evidence(`derived tier: ${derivedNodes.length} nodes (${args.runOne.stats.derived.namespaces} namespaces per Phase 3 stats); carrying a syntheticRule: ${derivedNodesWithSyntheticRule.length}`);
	check('G4-F the derived tier is untouched by synthesis (63 namespaces, no synthetic marks)', derivedNodes.length === EXPECTED.derivedNamespaces && derivedNodesWithSyntheticRule.length === 0);

	// RED — the hygiene checkers must be able to fail. Retier one synthetic node as 'source' in a
	// clone and require BOTH the predicate check and the rule check to invert.
	const hygieneProbeGraph = cloneGraph(args.runOne);
	const hygieneProbeNode = hygieneProbeGraph.nodes.find(
		(oneNode) => oneNode.properties.pescTier === 'synthetic',
	);
	hygieneProbeNode.properties.pescTier = 'source';
	const probeSyntheticStableIds = new Set(
		hygieneProbeGraph.nodes
			.filter((oneNode) => oneNode.properties.syntheticRule !== undefined)
			.map((oneNode) => oneNode.stableId),
	);
	const probeLeak = hygieneProbeGraph.nodes.filter(
		(oneNode) => oneNode.properties.pescTier === 'source' && probeSyntheticStableIds.has(oneNode.stableId),
	);
	evidence(`RED (demonstrated): retiering '${hygieneProbeNode.stableId}' as pescTier:'source' -> the predicate check now finds ${probeLeak.length} leak(s), condition inverts: ${probeLeak.length !== 0}`);
	check('G4-F RED: the source-predicate leak checker demonstrably detects a retiered node', probeLeak.length === 1);
	next('', args);
});

// =====================================================================
// G4-G — G3-A STILL PASSES (a change here is a FINDING, not a number to update)
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG4-G — the Phase 3 regeneration gate, re-run against the four-tier graph');
	const viewOriginal = canonicalizeDerivedView(args.runOne);
	const stripped = stripDerivedAndSynthetic(args.runOne);
	evidence(`deleted: ${args.runOne.nodes.length - stripped.nodes.length} derived+synthetic nodes, ${args.runOne.edges.length - stripped.edges.length} derived+synthetic edges`);

	let regenerationError = '';
	let regeneratedView = '';
	try {
		const derivedOutput = buildDerivedTier({ nodes: stripped.nodes, edges: stripped.edges });
		const regenerated = applyDerivedTier({
			nodes: stripped.nodes,
			edges: stripped.edges,
			derivedOutput,
		});
		regeneratedView = canonicalizeDerivedView(regenerated);
	} catch (thrownError) {
		regenerationError = thrownError.message;
	}
	if (regenerationError) {
		evidence(`REFUSED: ${regenerationError}`);
	}
	check('G4-G the derived tier regenerates from the stripped four-tier graph without refusal', regenerationError === '');
	evidence(`GREEN: regenerated derived view identical: ${regeneratedView === viewOriginal} (${viewOriginal.length} canonical bytes, Phase 3 recorded ${EXPECTED.g3aCanonicalBytes})`);
	check('G4-G the regenerated derived tier is IDENTICAL to the emitted one', regeneratedView === viewOriginal);
	check('G4-G G3-A still measures 14,600,360 canonical bytes (a change is a FINDING)', viewOriginal.length === EXPECTED.g3aCanonicalBytes);

	// AND THE SEAM: the derived tier must refuse synthetic input outright, so no future strip can
	// forget synthetic content and let a DECIDED definition seed a COMPUTED resolution.
	const contaminatedInput = stripDerivedAndSynthetic(args.runOne);
	contaminatedInput.nodes.push(
		args.runOne.nodes.find((oneNode) => oneNode.properties.pescTier === 'synthetic'),
	);
	let seamRefusal = '';
	try {
		buildDerivedTier({ nodes: contaminatedInput.nodes, edges: contaminatedInput.edges });
	} catch (thrownError) {
		seamRefusal = thrownError.message;
	}
	evidence(`seam: derived tier handed one synthetic node -> ${seamRefusal.substring(0, 150)}`);
	check('G4-G the derived tier REFUSES synthetic input by name (a decision may never seed a computation)', seamRefusal.indexOf('input carries synthetic-tier node') !== -1);
	next('', args);
});

// =====================================================================
// LEDGER — every shipped assertion must carry recorded red evidence
// =====================================================================
taskList.push((args, next) => {
	console.log('\nLEDGER — red evidence for every shipped assertion');
	const ledger = require(path.join(__dirname, 'redEvidenceLedger.json'));
	const suiteLedger = ledger.suites.synthetic;
	if (suiteLedger === undefined) {
		throw new Error(
			'HARNESS FAULT (LEDGER): redEvidenceLedger.json carries no "synthetic" suite. Run ' +
				'test/buildRedEvidenceLedger.js. A missing ledger is unmeasurable, not passing.',
		);
	}
	// the gate's own three assertions are added to the shipped set BEFORE the comparison, or it
	// would exempt itself by computing the label list before its own checks ran (the vacuity the
	// derived suite's first draft shipped with).
	const LEDGER_GATE_LABELS = [
		'LEDGER every shipped assertion has a red-evidence entry',
		'LEDGER carries no stale entries for assertions this suite no longer runs',
		'LEDGER the entry count matches the assertions actually run',
	];
	const ledgeredLabels = new Set(suiteLedger.assertions.map((oneEntry) => oneEntry.label));
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
