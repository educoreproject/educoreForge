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
//   G4-C  the merge delta BY SIGNATURE (name + resolved type + cardinality), classified ABSENT /
//         REBOUND / WIDENED, and SYMMETRIC — the 33 elements the winning member ADDS are
//         enumerated alongside what the loser lost. Rebuilt at the Phase 4 review (R-P4-5/6/7):
//         the predecessor matched by NAME over a superset of its own haystack and could not fail.
//         RED by planting a signature no member declares, and by pointing the finder at the
//         WINNING member, where a name-only checker stayed green and this one goes red.
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
	// R-P4-5 / R-P4-6: the SIGNATURE-BASED, SYMMETRIC merge delta. These four numbers REPLACE the
	// old 'lostChildElements: 8', which was misleading in three different ways at once — it counted
	// five type REBINDINGS and one WIDENING as losses, and it never counted the additions at all.
	absentChildElements: 2,
	reboundChildElements: 5,
	widenedChildElements: 1,
	addedChildElements: 33,
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
	// The delta by SIGNATURE — name|resolvedType|minOccurs|maxOccurs — and by classification.
	// The old name-only list of eight is retired: it named ContactsType.Address as lost while the
	// merged ContactsType subtree CONTAINS an Address element (rebound to AcRec:AddressType), which
	// is the precise sense in which the record actively misled (design §8f).
	absentChildElementSignatures: [
		'AcademicRecordType.AdditionalStudentAchievement|core:AdditionalStudentAchievementType|0|unbounded',
		'SponsorType.SponsorCode|core:SponsorCodeType|0|null',
	],
	reboundChildElementSignatures: [
		'ContactsRType.Address|core:AddressType|0|unbounded',
		'ContactsType.Address|core:AddressType|0|unbounded',
		'ContactsType.Email|core:EmailType|0|unbounded',
		'ContactsType.Phone|core:PhoneType|0|unbounded',
		'SchoolType.Contacts|core:ContactsType|0|unbounded',
	],
	// each rebinding's counterpart in the merged form: same name, DIFFERENT type. The presence of
	// these in the merged subtree is what makes 'lost' the wrong word for the five above.
	reboundMergedCounterpartSignatures: [
		'ContactsRType.Address|AcRec:AddressType|0|unbounded',
		'ContactsType.Address|AcRec:AddressType|0|unbounded',
		'ContactsType.Email|AcRec:EmailType|0|unbounded',
		'ContactsType.Phone|AcRec:PhoneType|0|unbounded',
		'SchoolType.Contacts|AcRec:ContactsType|0|unbounded',
	],
	widenedChildElementSignatures: [
		'AcademicSummaryBaseType.AcademicHonors|core:AcademicHonorsType|0|null',
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
	// RESTATED AT THE PHASE 4 REVIEW, and the restatement is a FINDING, not a repair.
	//
	// This assertion used to read "the merged node carries no content of its own", evidenced by the
	// synthetic view being byte-IDENTICAL after a winning-member child was renamed. That invariance
	// was an artifact of the one-sided, name-only loss record: it listed only what the LOSER had,
	// so a change on the WINNER'S side happened not to move it. R-P4-6's symmetric record enumerates
	// what the winning member ADDS, by signature — so the merged node now legitimately moves when
	// EITHER member moves, and it SHOULD. A merge record that stayed still while its inputs changed
	// would be a stale record, which is worse than a moving one.
	//
	// What survives, and is now asserted directly rather than inferred from a byte compare: the
	// merged node holds NO CHILD NODES (R-P4-3's one-hop-to-content shape is intact — measured, not
	// assumed), the change is reachable through contentFromStableId, and the published delta is a
	// SUMMARY that tracks its members.
	const mergedNodeStableIds = new Set(
		syntheticNodesOf(args.runOne)
			.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1)
			.map((oneNode) => oneNode.stableId),
	);
	const childrenClaimingAMergedParent = args.runOne.nodes.filter((oneNode) =>
		mergedNodeStableIds.has(oneNode.properties.parentId),
	);
	const deltaSummaryTracksItsMembers = probeThree.perturbedView !== shippedView;
	evidence(`THIRD CASE (recorded, not a defect): ${probeThree.mutationDescription}; merged nodes claiming children: ${childrenClaimingAMergedParent.length} of ${mergedNodeStableIds.size}; the change is reachable from the merged node's contentFromStableId: ${contentPointerReachesTheChange}; the R-P4-6 delta summary moved with its member: ${deltaSummaryTracksItsMembers}`);
	check('G4-A the merged node holds NO CHILD NODES and its contentFromStableId still reaches the changed source element', childrenClaimingAMergedParent.length === 0 && contentPointerReachesTheChange);
	check('G4-A the symmetric delta summary TRACKS its members — a winning-member change moves the merged record (R-P4-6)', deltaSummaryTracksItsMembers);

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
// G4-C — the merge delta, BY SIGNATURE and SYMMETRIC (R-P4-5, R-P4-6, R-P4-7)
// =====================================================================
// REBUILT AT THE PHASE 4 REVIEW. The predecessor of this gate COULD NOT FAIL, for two reasons that
// compounded:
//   1. it harvested with a walk (`gatherElementDecls`, all descendants) that is a strict SUPERSET
//      of the walk production used to name the losses (`childElementSignatureOf`, element decls +
//      inline types of the SAME root) — so every name it looked for was guaranteed present in its
//      own haystack, by construction;
//   2. it matched by NAME ONLY, so it would have passed just as green pointed at the WINNING
//      member, where five of the eight names are present and merely rebound.
// The rebuild fixes both by INVERTING the use of the superset walk. A superset haystack makes a
// NEGATIVE finding strong, not weak: if an ABSENT signature cannot be found anywhere in the
// winner's entire subtree, it is genuinely absent. So the load-bearing assertions here are the
// negative ones, and the levers are (a) a fabricated signature planted in neither member and
// (b) pointing the ABSENT finder at the winning member, where it must FAIL to find them.
taskList.push((args, next) => {
	console.log('\nG4-C — the merge delta by SIGNATURE, both directions (R-P4-5, R-P4-6, R-P4-7)');
	const mergeReport = args.runOne.syntheticMergeReport;

	// ---- the harness's OWN signature walker, independent of production's ------------------
	// Deliberately the FULL-descendant walk (the prototype's ElementTree .iter() shape) rather than
	// a re-implementation of production's: a gate that copied production's traversal would agree
	// with it by construction, which is the vacuity being repaired. Matching is on the full
	// four-part signature, never on the name.
	const { childrenByParentId } = args.indexOne;
	const signatureTextOf = (oneElementNode) => {
		['name', 'typeAsWritten', 'minOccurs', 'maxOccurs'].forEach((onePropertyName) => {
			if (!Object.prototype.hasOwnProperty.call(oneElementNode.properties, onePropertyName)) {
				throw new Error(
					`HARNESS FAULT (G4-C): PescElementDecl '${oneElementNode.stableId}' carries no ` +
						`'${onePropertyName}'. The signature is unmeasurable, not passing.`,
				);
			}
		});
		// template-rendered, NOT Array.join: join coerces a null maxOccurs to the empty string while
		// the delta entries render it as 'null', and the two would never match. Caught by this gate
		// going red on SponsorType.SponsorCode (maxOccurs null) and on 19 of the 33 ADDED entries.
		return `${oneElementNode.properties.name}|${oneElementNode.properties.typeAsWritten}|${oneElementNode.properties.minOccurs}|${oneElementNode.properties.maxOccurs}`;
	};
	const harvestSignatures = (containerStableId) => {
		const found = new Set();
		const foundNames = new Set();
		const visit = (oneStableId) => {
			(childrenByParentId[oneStableId] || []).forEach((oneChild) => {
				if (labelHas(oneChild, 'PescElementDecl')) {
					found.add(signatureTextOf(oneChild));
					foundNames.add(oneChild.properties.name);
				}
				visit(oneChild.stableId);
			});
		};
		visit(containerStableId);
		return { signatures: found, names: foundNames };
	};
	const harvestCache = {};
	const harvestOf = (definitionStableId) => {
		if (harvestCache[definitionStableId] === undefined) {
			const definitionNode = args.indexOne.nodeByStableId[definitionStableId];
			if (definitionNode === undefined) {
				throw new Error(
					`HARNESS FAULT (G4-C): definition '${definitionStableId}' is not in the graph. ` +
						'Unmeasurable, not passing.',
				);
			}
			if (definitionNode.properties.pescTier !== 'source') {
				throw new Error(
					`HARNESS FAULT (G4-C): '${definitionStableId}' is not a SOURCE-tier node ` +
						`(pescTier '${definitionNode.properties.pescTier}'). The delta's forwarding addresses ` +
						'must point into the source tier or they are not forwarding addresses.',
				);
			}
			harvestCache[definitionStableId] = harvestSignatures(definitionStableId);
		}
		return harvestCache[definitionStableId];
	};
	// the WINNING member's counterpart of a delta entry's definition — the subtree in which an
	// ABSENT signature must NOT be found and an ADDED one must be.
	const winningDefinitionStableIdOf = (oneEntry) => {
		const winningStableId = mergeReport.mergedDefinitionStableIdByKey[oneEntry.definitionKey];
		if (winningStableId === undefined) {
			throw new Error(
				`HARNESS FAULT (G4-C): no merged definition for key '${oneEntry.definitionKey}'.`,
			);
		}
		const mergedNode = args.indexOne.nodeByStableId[winningStableId];
		if (mergedNode === undefined || !mergedNode.properties.contentFromStableId) {
			throw new Error(
				`HARNESS FAULT (G4-C): merged '${winningStableId}' carries no contentFromStableId, so ` +
					'the winning subtree cannot be reached. Unmeasurable, not passing.',
			);
		}
		return mergedNode.properties.contentFromStableId;
	};
	const fullSignatureText = (oneEntry) =>
		`${oneEntry.definitionName}.${oneEntry.name}|${oneEntry.typeAsWritten}|${oneEntry.minOccurs}|${oneEntry.maxOccurs}`;
	const bareSignatureText = (oneEntry) =>
		`${oneEntry.name}|${oneEntry.typeAsWritten}|${oneEntry.minOccurs}|${oneEntry.maxOccurs}`;

	// ---- the census: four buckets, both directions ----------------------------------------
	const observedAbsent = mergeReport.absentChildElements.map(fullSignatureText).sort();
	const observedRebound = mergeReport.reboundChildElements.map(fullSignatureText).sort();
	const observedWidened = mergeReport.widenedChildElements.map(fullSignatureText).sort();
	evidence(`ABSENT (${observedAbsent.length}): ${observedAbsent.join('  ')}`);
	evidence(`REBOUND (${observedRebound.length}): ${observedRebound.join('  ')}`);
	evidence(`WIDENED (${observedWidened.length}): ${observedWidened.join('  ')}`);
	evidence(`ADDED by the winning member (${mergeReport.addedChildElements.length}), spread over ${new Set(mergeReport.addedChildElements.map((oneEntry) => oneEntry.definitionName)).size} conflicting types`);
	check('G4-C exactly 2 child elements are genuinely ABSENT from the merged definitions', mergeReport.absentChildElements.length === EXPECTED.absentChildElements);
	check('G4-C the 2 ABSENT entries are EXACTLY the enumerated signatures', JSON.stringify(observedAbsent) === JSON.stringify(EXPECTED.absentChildElementSignatures));
	check('G4-C exactly 5 are REBOUND (same name, different resolved type) and are NOT losses', mergeReport.reboundChildElements.length === EXPECTED.reboundChildElements && JSON.stringify(observedRebound) === JSON.stringify(EXPECTED.reboundChildElementSignatures));
	check('G4-C exactly 1 is WIDENED (same name, same type, merged cardinality admits the loser)', mergeReport.widenedChildElements.length === EXPECTED.widenedChildElements && JSON.stringify(observedWidened) === JSON.stringify(EXPECTED.widenedChildElementSignatures));
	check('G4-C R-P4-6 SYMMETRY: the record enumerates the 33 child elements the winning member ADDS, not only what the loser lost', mergeReport.addedChildElements.length === EXPECTED.addedChildElements);

	// ---- REBOUND is a rebinding, not a loss: the counterpart is REALLY THERE ---------------
	// This is the assertion the old name-only record could not even express. For each rebound
	// entry: the loser's signature is NOT in the winning subtree, the NAME is, and the merged
	// counterpart's own full signature is.
	const observedCounterparts = mergeReport.reboundChildElements
		.map((oneEntry) => `${oneEntry.definitionName}.${bareSignatureText(oneEntry.mergedCounterpart)}`)
		.sort();
	const reboundVerdicts = mergeReport.reboundChildElements.map((oneEntry) => {
		const winningHarvest = harvestOf(winningDefinitionStableIdOf(oneEntry));
		return {
			label: fullSignatureText(oneEntry),
			loserSignatureAbsentFromWinner: !winningHarvest.signatures.has(bareSignatureText(oneEntry)),
			nameStillPresentInWinner: winningHarvest.names.has(oneEntry.name),
			counterpartPresentInWinner: winningHarvest.signatures.has(
				bareSignatureText(oneEntry.mergedCounterpart),
			),
			typeGenuinelyDiffers: oneEntry.mergedCounterpart.typeAsWritten !== oneEntry.typeAsWritten,
		};
	});
	evidence(`rebound counterparts in the merged subtree: ${observedCounterparts.join('  ')}`);
	check('G4-C every REBOUND names a counterpart PRESENT in the merged subtree under the same name and a different type', JSON.stringify(observedCounterparts) === JSON.stringify(EXPECTED.reboundMergedCounterpartSignatures) && reboundVerdicts.every((oneVerdict) => oneVerdict.typeGenuinelyDiffers && oneVerdict.counterpartPresentInWinner && oneVerdict.nameStillPresentInWinner && oneVerdict.loserSignatureAbsentFromWinner));

	// ---- the WIDENED entry loses nothing: the merged cardinality admits the loser's ---------
	const widenedVerdicts = mergeReport.widenedChildElements.map((oneEntry) => ({
		label: fullSignatureText(oneEntry),
		sameType: oneEntry.mergedCounterpart.typeAsWritten === oneEntry.typeAsWritten,
		// null maxOccurs is the XSD default of 1; 'unbounded' admits it, so this is a widening
		widens:
			(oneEntry.maxOccurs === null || oneEntry.maxOccurs === undefined) &&
			oneEntry.mergedCounterpart.maxOccurs === 'unbounded',
		counterpartPresentInWinner: harvestOf(winningDefinitionStableIdOf(oneEntry)).signatures.has(
			bareSignatureText(oneEntry.mergedCounterpart),
		),
	}));
	evidence(`widened: ${widenedVerdicts.map((oneVerdict) => `${oneVerdict.label} widens: ${oneVerdict.widens}, counterpart live in winner: ${oneVerdict.counterpartPresentInWinner}`).join('; ')}`);
	check('G4-C the WIDENED entry is a widening (maxOccurs unset -> unbounded) with its counterpart live in the merged subtree', widenedVerdicts.length === EXPECTED.widenedChildElements && widenedVerdicts.every((oneVerdict) => oneVerdict.sameType && oneVerdict.widens && oneVerdict.counterpartPresentInWinner));

	// ---- ABSENT: queryable under the LOSER, and genuinely NOT under the WINNER --------------
	// The second half is the one with teeth. The winner harvest is the FULL-descendant walk, so a
	// signature not found in it is not merely outside some subset — it is nowhere in the winning
	// definition at all.
	const absentVerdicts = mergeReport.absentChildElements.map((oneEntry) => {
		const loserHarvest = harvestOf(oneEntry.survivingUnderSourceDefinitionStableId);
		const winnerHarvest = harvestOf(winningDefinitionStableIdOf(oneEntry));
		return {
			label: fullSignatureText(oneEntry),
			queryableUnderLoser: loserHarvest.signatures.has(bareSignatureText(oneEntry)),
			signatureAbsentFromWinner: !winnerHarvest.signatures.has(bareSignatureText(oneEntry)),
			nameAbsentFromWinner: !winnerHarvest.names.has(oneEntry.name),
		};
	});
	evidence(`ABSENT verdicts: ${absentVerdicts.map((oneVerdict) => `${oneVerdict.label} -> alive under loser: ${oneVerdict.queryableUnderLoser}, signature absent from winner: ${oneVerdict.signatureAbsentFromWinner}, name absent from winner: ${oneVerdict.nameAbsentFromWinner}`).join('; ')}`);
	check('G4-C every ABSENT entry is still queryable by SIGNATURE under the losing member source-tier definition', absentVerdicts.every((oneVerdict) => oneVerdict.queryableUnderLoser));
	check('G4-C and every ABSENT entry is genuinely absent from the WINNING subtree — by name AND by signature', absentVerdicts.every((oneVerdict) => oneVerdict.signatureAbsentFromWinner && oneVerdict.nameAbsentFromWinner));

	// ---- ADDED: present in the winner, absent from the loser -------------------------------
	const addedVerdicts = mergeReport.addedChildElements.map((oneEntry) => {
		const winnerHarvest = harvestOf(oneEntry.declaredUnderSourceDefinitionStableId);
		const loserDefinitionStableId = (
			mergeReport.absentChildElements
				.concat(mergeReport.reboundChildElements, mergeReport.widenedChildElements)
				.find((oneLoserEntry) => oneLoserEntry.definitionKey === oneEntry.definitionKey) || {}
		).survivingUnderSourceDefinitionStableId;
		return {
			presentInWinner: winnerHarvest.signatures.has(bareSignatureText(oneEntry)),
			absentFromLoser:
				loserDefinitionStableId === undefined
					? null
					: !harvestOf(loserDefinitionStableId).signatures.has(bareSignatureText(oneEntry)),
		};
	});
	const addedCheckedAgainstLoser = addedVerdicts.filter((oneVerdict) => oneVerdict.absentFromLoser !== null);
	evidence(`ADDED verdicts: ${addedVerdicts.filter((oneVerdict) => oneVerdict.presentInWinner).length}/${addedVerdicts.length} present in the winning subtree; ${addedCheckedAgainstLoser.filter((oneVerdict) => oneVerdict.absentFromLoser).length}/${addedCheckedAgainstLoser.length} confirmed absent from the losing subtree (the 8 types the loser-side delta also names)`);
	check('G4-C every ADDED entry is present in the WINNING subtree, and absent from the losing one wherever the loser subtree is named', addedVerdicts.every((oneVerdict) => oneVerdict.presentInWinner) && addedCheckedAgainstLoser.length > 0 && addedCheckedAgainstLoser.every((oneVerdict) => oneVerdict.absentFromLoser));

	// ---- report and graph agree, in all four buckets ---------------------------------------
	const syntheticNodes = syntheticNodesOf(args.runOne);
	const graphTotals = { absent: 0, rebound: 0, widened: 0, added: 0 };
	const nodesDeclaringDelta = [];
	syntheticNodes
		.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1)
		.forEach((oneNode) => {
			['absent', 'rebound', 'widened', 'added'].forEach((oneBucket) => {
				const countName = `${oneBucket}ChildElementCount`;
				const listName = `${oneBucket}ChildElementSignatures`;
				if (!Object.prototype.hasOwnProperty.call(oneNode.properties, countName)) {
					throw new Error(
						`HARNESS FAULT (G4-C): merged '${oneNode.stableId}' carries no '${countName}'. The ` +
							'delta cannot be read off the graph, which is the whole point of publishing it.',
					);
				}
				if (JSON.parse(oneNode.properties[listName]).length !== oneNode.properties[countName]) {
					throw new Error(
						`HARNESS FAULT (G4-C): '${oneNode.stableId}' declares ${countName} ` +
							`${oneNode.properties[countName]} but lists ` +
							`${JSON.parse(oneNode.properties[listName]).length}.`,
					);
				}
				graphTotals[oneBucket] += oneNode.properties[countName];
			});
			if (oneNode.properties.absentChildElementCount > 0) nodesDeclaringDelta.push(oneNode.properties.name);
		});
	evidence(`graph totals: absent ${graphTotals.absent}, rebound ${graphTotals.rebound}, widened ${graphTotals.widened}, added ${graphTotals.added}; types declaring an ABSENT entry: ${nodesDeclaringDelta.sort().join(', ')}`);
	check('G4-C the merged nodes publish the delta themselves and agree with the report in all four buckets', graphTotals.absent === EXPECTED.absentChildElements && graphTotals.rebound === EXPECTED.reboundChildElements && graphTotals.widened === EXPECTED.widenedChildElements && graphTotals.added === EXPECTED.addedChildElements);

	// the misleading property is GONE, not merely superseded — no downstream reader can pick it up.
	const nodesCarryingRetiredProperty = args.runOne.nodes.filter((oneNode) =>
		Object.keys(oneNode.properties).some((onePropertyName) => /^lostChildElement/.test(onePropertyName)),
	);
	const edgesCarryingRetiredProperty = args.runOne.edges.filter((oneEdge) =>
		Object.keys(oneEdge.properties).some((onePropertyName) => /^lostChildElement/.test(onePropertyName)),
	);
	evidence(`retired 'lostChildElement*' properties still in the graph: ${nodesCarryingRetiredProperty.length} node(s), ${edgesCarryingRetiredProperty.length} edge(s)`);
	check('G4-C the misleading name-only loss property is absent from the graph entirely', nodesCarryingRetiredProperty.length === 0 && edgesCarryingRetiredProperty.length === 0);

	// ---- RED LEVER 1: a signature present in NEITHER member ---------------------------------
	// The predecessor gate could not fail because its haystack was a superset of its needles. Plant
	// a needle that is in no haystack and require the finder to say so.
	const plantedEntry = {
		definitionKey: mergeReport.absentChildElements[0].definitionKey,
		definitionName: mergeReport.absentChildElements[0].definitionName,
		name: 'HarnessPlantedElement',
		typeAsWritten: 'core:HarnessPlantedType',
		minOccurs: '0',
		maxOccurs: 'unbounded',
		survivingUnderSourceDefinitionStableId:
			mergeReport.absentChildElements[0].survivingUnderSourceDefinitionStableId,
	};
	const plantedFoundUnderLoser = harvestOf(
		plantedEntry.survivingUnderSourceDefinitionStableId,
	).signatures.has(bareSignatureText(plantedEntry));
	const plantedFoundUnderWinner = harvestOf(winningDefinitionStableIdOf(plantedEntry)).signatures.has(
		bareSignatureText(plantedEntry),
	);
	evidence(`RED-1 (demonstrated): planting '${fullSignatureText(plantedEntry)}', a signature no member declares -> queryability finder reports found-under-loser: ${plantedFoundUnderLoser} (the queryability assertion would go RED), found-under-winner: ${plantedFoundUnderWinner}`);
	check('G4-C RED-1: the signature finder demonstrably FAILS to find a signature planted in neither member', plantedFoundUnderLoser === false && plantedFoundUnderWinner === false);

	// ---- RED LEVER 2: point the ABSENT finder at the WINNING member --------------------------
	// The old gate matched by NAME and searched a superset, so it would have passed pointed at
	// either member. This one must NOT: the queryability condition, evaluated against the winner,
	// has to go red for every ABSENT entry, and — the sharper half — must ALSO go red for the five
	// REBOUND entries, because their loser-side SIGNATURES are not in the winner either, even
	// though their NAMES are. A name-only checker would report 5/5 found here and stay green.
	const absentFoundInWinner = mergeReport.absentChildElements.filter((oneEntry) =>
		harvestOf(winningDefinitionStableIdOf(oneEntry)).signatures.has(bareSignatureText(oneEntry)),
	).length;
	const reboundSignaturesFoundInWinner = mergeReport.reboundChildElements.filter((oneEntry) =>
		harvestOf(winningDefinitionStableIdOf(oneEntry)).signatures.has(bareSignatureText(oneEntry)),
	).length;
	const reboundNamesFoundInWinner = mergeReport.reboundChildElements.filter((oneEntry) =>
		harvestOf(winningDefinitionStableIdOf(oneEntry)).names.has(oneEntry.name),
	).length;
	evidence(`RED-2 (demonstrated): the SAME queryability finder pointed at the WINNING member finds ${absentFoundInWinner}/${EXPECTED.absentChildElements} ABSENT signatures and ${reboundSignaturesFoundInWinner}/${EXPECTED.reboundChildElements} REBOUND signatures -> the queryability assertion inverts. A NAME-only checker would have found ${reboundNamesFoundInWinner}/${EXPECTED.reboundChildElements} of the rebound names there and stayed green — which is exactly how the predecessor gate could not fail.`);
	check('G4-C RED-2: pointed at the WINNING member the finder goes red on every ABSENT and every REBOUND signature, where a name-only checker stayed green', absentFoundInWinner === 0 && reboundSignaturesFoundInWinner === 0 && reboundNamesFoundInWinner === EXPECTED.reboundChildElements);
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
