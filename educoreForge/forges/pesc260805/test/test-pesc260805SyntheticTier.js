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
	verifyMergedChildrenWereDeclared,
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
	// PHASE 4.6a moved these. 110 -> 632 is +522 duplicated child declarations (S-1c); 549 -> 1114
	// is +522 HAS_PROPERTY, +38 HAS_RESTRICTION and +5 HAS_SUPPORT. Written as sums so a future
	// drift names WHICH part moved rather than only that something did.
	syntheticNodes: 109 + 522 + 1,
	syntheticEdges: 549 + 522 + 38 + 5,
	// ---- PHASE 4.6a: R-P4-3 / R-P4-10 / R-P4-11 / R-P4-12 --------------------------------
	mergedChildNodes: 522,
	// the union's two decompositions, both of which must close on 522. The supervisor's own
	// independent walk produced 757 branch children and 235 both-branch names: 757 - 235 = 522.
	winnerTakesAllChildCount: 520,
	losingBranchContributedChildCount: 2,
	bothBranchDeclaredNameCount: 235,
	// bothBranchesAgree fell 229 -> 226 at the review remediation: three children matched on
	// signature while the union CHOSE the college member's documentation over an empty string, so
	// they moved to their own disposition rather than claiming nothing was decided (GAP 3).
	mergedChildDispositionCounts: {
		bothBranchesAgree: 226,
		bothBranchesAgreeSignatureContentDecided: 3,
		soleBranchDeclaration: 285,
		losingBranchContributed: 2,
		winnerChosenOverLoser: 6,
	},
	mergedChildrenWithContentDecided: 3,
	// ACCEPTANCE 1, restated so it can fail: of 109 merged definitions, 75 have child declarations
	// in at least one branch. Those 75 are the population the criterion speaks about; the other 34
	// have nothing to render and render nothing.
	mergedDefinitionsWithBranchChildren: 75,
	// GAP 2 — the number a consumer actually meets. Two referrer scopes, both pinned, because they
	// differ by one simpleType reached only by a non-element reference and an undocumented
	// granularity difference is how a correct number becomes a contradiction later.
	reachedTargetsAnyReferrer: 96,
	emptyRenderAnyReferrer: 30,
	reachedTargetsElementDeclReferrer: 94,
	emptyRenderElementDeclReferrer: 29,
	// R-P4-11: ONE classification naming the contributing branch, on the MATERIALIZED basis. NOT
	// summable with rebound/widened — those describe a SUBSET of the college contributions (the 6
	// winnerChosenOverLoser), not entries additional to them.
	contributedChildElements: 35,
	collegeContributedChildElements: 33,
	testScoreContributedChildElements: 2,
	absentChildElementsAfterUnion: 0,
	// R-P4-12 residue: referenced by REAL EDGES, never duplicated. A named number, not a silence.
	inlineTypeReferenceEdges: 5,
	derivationReferenceEdges: 38,
	// the exemplar R-P4-3 named: out-degree was 2, both MERGED_FROM, and the type rendered empty
	personTypeChildElementCount: 18,
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
	// SPLIT AND RE-STATED AT PHASE 4.6a, on the precedent set when Phase 4 legitimately changed
	// what G3-D asserted: RE-STATE, never delete. The retired assertion bundled two claims —
	// "the merged node holds NO CHILD NODES" and "its contentFromStableId still reaches the changed
	// source element". R-P4-3 ORDERED the first reversed, so it becomes its positive form below.
	// The second is untouched by this phase and is asserted here verbatim, on its own label, so it
	// keeps its own red evidence instead of being carried along by a neighbour.
	check('G4-A the merged node contentFromStableId still reaches the changed source element', contentPointerReachesTheChange);

	// THE POSITIVE FORM. It gets its OWN red lever below and does NOT inherit the retired
	// assertion's receipt: the old claim's red proof demonstrated that a node could be made to
	// HOLD children, which is now the expected state and proves nothing about this claim. An
	// assertion carrying a predecessor's evidence is precisely how this campaign's genuine-gap
	// residue was created; this one is demonstrated on its own terms.
	const mergedChildNodes = args.runOne.nodes.filter(
		(oneNode) => oneNode.properties.syntheticRule === 'S-1c',
	);
	const mergedChildNodesNotSynthetic = mergedChildNodes.filter(
		(oneNode) => oneNode.properties.pescTier !== 'synthetic',
	);
	const mergedChildNodesNotClaimingAMergedParent = mergedChildNodes.filter(
		(oneNode) => !mergedNodeStableIds.has(oneNode.properties.parentId),
	);
	evidence(`merged nodes now hold children: ${childrenClaimingAMergedParent.length} nodes claim a merged parent, of which ${mergedChildNodes.length} carry syntheticRule S-1c; not marked synthetic: ${mergedChildNodesNotSynthetic.length}; not claiming a merged parent: ${mergedChildNodesNotClaimingAMergedParent.length}`);
	check('G4-A RE-STATED: the merged nodes hold EXACTLY their union of children, every one marked synthetic and parented to a merged definition', childrenClaimingAMergedParent.length === EXPECTED.mergedChildNodes && mergedChildNodes.length === EXPECTED.mergedChildNodes && mergedChildNodesNotSynthetic.length === 0 && mergedChildNodesNotClaimingAMergedParent.length === 0);

	// RED for the re-stated assertion, on its own lever: re-parent ONE duplicated child away from
	// its merged definition in a clone. The predicate must notice, which proves it is reading
	// parentage rather than counting nodes that happen to exist.
	const reparentProbeGraph = cloneGraph(args.runOne);
	const reparentProbeChild = reparentProbeGraph.nodes.find(
		(oneNode) => oneNode.properties.syntheticRule === 'S-1c',
	);
	const reparentProbeOriginalParentId = reparentProbeChild.properties.parentId;
	reparentProbeChild.properties.parentId = 'harness:orphanedByProbe';
	const reparentProbeClaimants = reparentProbeGraph.nodes.filter((oneNode) =>
		mergedNodeStableIds.has(oneNode.properties.parentId),
	);
	evidence(`RED (demonstrated): re-parented '${reparentProbeChild.stableId}' away from '${reparentProbeOriginalParentId}' -> nodes claiming a merged parent falls ${EXPECTED.mergedChildNodes} -> ${reparentProbeClaimants.length}, condition inverts: ${reparentProbeClaimants.length !== EXPECTED.mergedChildNodes}`);
	check('G4-A RED: the re-stated child-parentage assertion demonstrably detects one orphaned child', reparentProbeClaimants.length === EXPECTED.mergedChildNodes - 1);
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
	// RESTATED AT PHASE 4.6a. The 'added' bucket is retired: R-P4-11 ruled that what the college
	// member contributes and what the test-score member contributes are the same phenomenon in
	// opposite directions, and naming them differently re-created in the vocabulary the asymmetry
	// R-P4-6 removed from the record. 'contributed' carries both, each entry naming its branch.
	// 'absent' is RETAINED AND ZERO rather than deleted (standing rule 4) — R-P4-10's union carries
	// every loser-only name, so the bucket is structurally empty and says so.
	const graphTotals = { absent: 0, rebound: 0, widened: 0, contributed: 0 };
	const nodesDeclaringDelta = [];
	syntheticNodes
		.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1)
		.forEach((oneNode) => {
			['absent', 'rebound', 'widened', 'contributed'].forEach((oneBucket) => {
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
	evidence(`graph totals: absent ${graphTotals.absent}, rebound ${graphTotals.rebound}, widened ${graphTotals.widened}, contributed ${graphTotals.contributed}; types declaring an ABSENT entry: ${nodesDeclaringDelta.sort().join(', ') || '(none — R-P4-10 zeroed the bucket)'}`);
	check('G4-C the merged nodes publish the delta themselves and agree with the report in all four buckets', graphTotals.absent === EXPECTED.absentChildElementsAfterUnion && graphTotals.rebound === EXPECTED.reboundChildElements && graphTotals.widened === EXPECTED.widenedChildElements && graphTotals.contributed === EXPECTED.contributedChildElements);

	// THE OVERLAP IS ASSERTED, NOT ONLY DOCUMENTED (supervisor condition, 2026-08-06). rebound and
	// widened describe a SUBSET of the college contributions — the 6 winnerChosenOverLoser children
	// — so a reader summing 33 + 2 + 5 + 1 = 41 gets a false total from four true figures. This
	// pins the relationship, so a future change that made them genuinely disjoint would fail here
	// rather than quietly turning the published note into a lie.
	// REBUILT AFTER THE INDEPENDENT REVIEW. This asserted CARDINALITY ONLY — 6 === 6 and 6 < 33 —
	// which two entirely disjoint sets would satisfy. The claim was verified true in fact, so only
	// the GATE was weak, but a gate that would pass on disjoint sets is not testing the claim it
	// names. Asserted by SET MEMBERSHIP now: the rebound and widened entries must BE the
	// winnerChosenOverLoser children, identified by (owning type, child name).
	const winnerChosenOverLoserChildKeys = new Set(
		args.runOne.nodes
			.filter((oneNode) => oneNode.properties.childUnionDisposition === 'winnerChosenOverLoser')
			.map((oneNode) => {
				const owningMergedNode = args.runOne.nodes.find(
					(oneCandidate) => oneCandidate.stableId === oneNode.properties.mergedDefinitionStableId,
				);
				if (owningMergedNode === undefined) {
					throw new Error(
						`HARNESS FAULT (G4-C): child '${oneNode.stableId}' names a merged definition that is ` +
							'not in the graph.',
					);
				}
				return `${owningMergedNode.properties.name}.${oneNode.properties.name}`;
			}),
	);
	const reboundAndWidenedChildKeys = new Set();
	syntheticNodes
		.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1)
		.forEach((oneNode) => {
			['rebound', 'widened'].forEach((oneBucket) => {
				JSON.parse(oneNode.properties[`${oneBucket}ChildElementSignatures`]).forEach((oneEntry) => {
					reboundAndWidenedChildKeys.add(`${oneNode.properties.name}.${oneEntry.name}`);
				});
			});
		});
	const inReboundWidenedNotDecided = [...reboundAndWidenedChildKeys].filter(
		(oneChildKey) => !winnerChosenOverLoserChildKeys.has(oneChildKey),
	);
	const inDecidedNotReboundWidened = [...winnerChosenOverLoserChildKeys].filter(
		(oneChildKey) => !reboundAndWidenedChildKeys.has(oneChildKey),
	);
	evidence(`overlap BY SET: rebound+widened {${[...reboundAndWidenedChildKeys].sort().join(', ')}}; winnerChosenOverLoser {${[...winnerChosenOverLoserChildKeys].sort().join(', ')}}; symmetric difference ${inReboundWidenedNotDecided.length + inDecidedNotReboundWidened.length}. Naive sum 33+2+5+1 = ${33 + 2 + 5 + 1} is NOT a child count — these 6 are counted INSIDE the ${EXPECTED.collegeContributedChildElements} college contributions`);
	check('G4-C the rebound+widened entries ARE the winnerChosenOverLoser children — asserted by SET MEMBERSHIP, not by cardinality', inReboundWidenedNotDecided.length === 0 && inDecidedNotReboundWidened.length === 0 && reboundAndWidenedChildKeys.size === graphTotals.rebound + graphTotals.widened && reboundAndWidenedChildKeys.size < EXPECTED.collegeContributedChildElements);

	// RED for the set-membership form: swap ONE member of the decided set for a name that is not in
	// it. Cardinality is unchanged, so the predecessor gate would still have passed; this one must not.
	const disjointProbeKeys = new Set([...winnerChosenOverLoserChildKeys]);
	const disjointProbeVictim = [...disjointProbeKeys][0];
	disjointProbeKeys.delete(disjointProbeVictim);
	disjointProbeKeys.add('HarnessType.HarnessChildNotInEitherSet');
	const disjointProbeDifference = [...reboundAndWidenedChildKeys].filter(
		(oneChildKey) => !disjointProbeKeys.has(oneChildKey),
	);
	evidence(`RED (demonstrated): swapped '${disjointProbeVictim}' for a name in neither set — cardinality UNCHANGED at ${disjointProbeKeys.size}, so a cardinality-only gate stays green; set membership finds ${disjointProbeDifference.length} mismatch(es), condition inverts: ${disjointProbeDifference.length !== 0}`);
	check('G4-C RED: the SET form detects a swap that leaves cardinality identical (the predecessor gate could not)', disjointProbeDifference.length === 1 && disjointProbeKeys.size === winnerChosenOverLoserChildKeys.size);

	// GAP 3 — THE UNDECLARED CONTENT CHOICE, NOW DECLARED. Three children match on signature (name,
	// resolved type, cardinality) while the two branches DISAGREE about documentation: the college
	// member carries prose, the test-score member an empty string, and the union takes the winner's.
	// They were stamped 'bothBranchesAgree' — asserting that nothing was decided while a choice was
	// being made silently. That is §8f's sin: a record a reader consults and is misled by.
	const contentDecidedChildren = args.runOne.nodes.filter(
		(oneNode) =>
			oneNode.properties.childUnionDisposition === 'bothBranchesAgreeSignatureContentDecided',
	);
	const contentDecidedNamingNothing = contentDecidedChildren.filter(
		(oneNode) => JSON.parse(oneNode.properties.decidedNonSignaturePropertyNames).length === 0,
	);
	const agreeingChildrenClaimingADecision = args.runOne.nodes
		.filter((oneNode) => oneNode.properties.childUnionDisposition === 'bothBranchesAgree')
		.filter(
			(oneNode) => JSON.parse(oneNode.properties.decidedNonSignaturePropertyNames).length !== 0,
		);
	evidence(`GAP 3: ${contentDecidedChildren.length} children matched on SIGNATURE while the union chose between their CONTENT — ${contentDecidedChildren.map((oneNode) => `${oneNode.properties.name}(${JSON.parse(oneNode.properties.decidedNonSignaturePropertyNames).join('+')})`).sort().join(', ')}; declaring nothing: ${contentDecidedNamingNothing.length}; children claiming agreement while carrying a decision: ${agreeingChildrenClaimingADecision.length}`);
	check('G4-C GAP 3: every child whose content the union chose says SO, and names which properties the choice covered', contentDecidedChildren.length === EXPECTED.mergedChildrenWithContentDecided && contentDecidedNamingNothing.length === 0 && agreeingChildrenClaimingADecision.length === 0);

	// RED: strip the decided-property record from one such child and require the detector to notice
	// a child claiming a decision it does not describe.
	const contentDecidedProbeGraph = cloneGraph(args.runOne);
	const contentDecidedProbeChild = contentDecidedProbeGraph.nodes.find(
		(oneNode) =>
			oneNode.properties.childUnionDisposition === 'bothBranchesAgreeSignatureContentDecided',
	);
	contentDecidedProbeChild.properties.decidedNonSignaturePropertyNames = JSON.stringify([]);
	const contentDecidedProbeSilent = contentDecidedProbeGraph.nodes
		.filter(
			(oneNode) =>
				oneNode.properties.childUnionDisposition === 'bothBranchesAgreeSignatureContentDecided',
		)
		.filter(
			(oneNode) => JSON.parse(oneNode.properties.decidedNonSignaturePropertyNames).length === 0,
		);
	evidence(`RED (demonstrated): emptied the decided-property record on '${contentDecidedProbeChild.stableId}' -> children declaring a decision without naming it: ${contentDecidedProbeSilent.length}, condition inverts: ${contentDecidedProbeSilent.length !== 0}`);
	check('G4-C GAP 3 RED: a child that claims a content decision without naming it IS detected', contentDecidedProbeSilent.length === 1);

	// BOTH BASES ARE PUBLISHED AND LABELLED (supervisor condition). A reader who recomputes at
	// signature granularity gets 8 where the classification says 2; without both figures on the
	// node they would conclude one is wrong rather than that they answer different questions.
	const nodesMissingABasis = syntheticNodes
		.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1)
		.filter(
			(oneNode) =>
				!Object.prototype.hasOwnProperty.call(oneNode.properties, 'signatureLevelCollegeContributedCount') ||
				!Object.prototype.hasOwnProperty.call(oneNode.properties, 'signatureLevelTestScoreDroppedCount') ||
				!Object.prototype.hasOwnProperty.call(oneNode.properties, 'childElementRecordBasisNote') ||
				!Object.prototype.hasOwnProperty.call(oneNode.properties, 'contributedChildElementOverlapNote'),
		);
	const signatureLevelTestScoreDroppedTotal = syntheticNodes
		.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1)
		.reduce((runningTotal, oneNode) => runningTotal + oneNode.properties.signatureLevelTestScoreDroppedCount, 0);
	evidence(`both bases on every merged node: missing ${nodesMissingABasis.length}; signature-level test-score dropped total ${signatureLevelTestScoreDroppedTotal} (materialized basis says ${EXPECTED.testScoreContributedChildElements})`);
	check('G4-C every merged node publishes BOTH bases and states the overlap in words', nodesMissingABasis.length === 0 && signatureLevelTestScoreDroppedTotal === EXPECTED.absentChildElements + EXPECTED.reboundChildElements + EXPECTED.widenedChildElements);

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
	// RESTATED AT PHASE 4.6a: 'S-1c' joins the ratified rule set. It is a SUB-RULE of S-1 — the
	// merge decides which branch each child publishes, S-1c materialises that decision — and it
	// carries its own id so the census can count merged DEFINITIONS apart from merged CHILDREN.
	const RATIFIED_SYNTHETIC_RULES = ['S-1', 'S-1c', 'S-2'];
	const nodesWithoutRule = syntheticNodes.filter(
		(oneNode) => RATIFIED_SYNTHETIC_RULES.indexOf(oneNode.properties.syntheticRule) === -1,
	);
	const edgesWithoutRule = syntheticEdges.filter(
		(oneEdge) => RATIFIED_SYNTHETIC_RULES.indexOf(oneEdge.properties.syntheticRule) === -1,
	);
	evidence(`synthetic census: ${syntheticNodes.length} nodes, ${syntheticEdges.length} edges; missing a syntheticRule: ${nodesWithoutRule.length} nodes, ${edgesWithoutRule.length} edges`);
	check('G4-F the synthetic tier emits exactly 632 nodes and 1114 edges (RESTATED at Phase 4.6a from 110/549)', syntheticNodes.length === EXPECTED.syntheticNodes && syntheticEdges.length === EXPECTED.syntheticEdges);
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
// G4.6a — R-P4-3 DUPLICATE THE CHILDREN: the four named levers, plus R-P4-12's pointer lever
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG4.6a — the child union (R-P4-3 / R-P4-10 / R-P4-11 / R-P4-12)');

	// the source+derived input the synthetic tier is a pure function of. Built by REMOVING synthetic
	// content from the shipped graph rather than by re-running the forge, so every lever below
	// perturbs exactly one thing against a fixed baseline.
	const sourceAndDerivedInputOf = (oneGraph) => ({
		nodes: oneGraph.nodes.filter((oneNode) => oneNode.properties.pescTier !== 'synthetic'),
		edges: oneGraph.edges.filter((oneEdge) => oneEdge.properties.pescTier !== 'synthetic'),
	});
	const baselineInput = sourceAndDerivedInputOf(args.runOne);
	const baselineOutput = buildSyntheticTier(baselineInput);

	// ---- the union closes, by both decompositions -------------------------------------------
	const dispositionCounts = baselineOutput.stats.mergedChildrenByDisposition;
	// a name is BOTH-BRANCH DECLARED under every disposition that means "the loser declared it too":
	// the two agreement forms plus the collision the winner won. The content-decided form was added
	// at the review remediation and belongs here — it is agreement on signature, not sole declaration.
	const bothBranchDeclaredFromDisposition =
		dispositionCounts.bothBranchesAgree +
		dispositionCounts.bothBranchesAgreeSignatureContentDecided +
		dispositionCounts.winnerChosenOverLoser;
	evidence(`union: ${baselineOutput.stats.mergedChildNodes} children; dispositions ${JSON.stringify(dispositionCounts)}; winner-takes-all ${EXPECTED.winnerTakesAllChildCount} + losing-branch ${dispositionCounts.losingBranchContributed} = ${EXPECTED.winnerTakesAllChildCount + dispositionCounts.losingBranchContributed}; both-branch names from dispositions ${bothBranchDeclaredFromDisposition} (supervisor's independent walk: ${EXPECTED.bothBranchDeclaredNameCount})`);
	check('G4.6a the child union is EXACTLY 522 and closes by both decompositions independently', baselineOutput.stats.mergedChildNodes === EXPECTED.mergedChildNodes && EXPECTED.winnerTakesAllChildCount + dispositionCounts.losingBranchContributed === EXPECTED.mergedChildNodes && bothBranchDeclaredFromDisposition === EXPECTED.bothBranchDeclaredNameCount);

	// compared KEY BY KEY rather than by JSON.stringify. The stringify form was order-sensitive and
	// failed on the insertion order of a newly added disposition while every value was correct — a
	// gate that reports a difference that is not there is as untrustworthy as one that misses one.
	const dispositionNames = [
		...new Set([
			...Object.keys(dispositionCounts),
			...Object.keys(EXPECTED.mergedChildDispositionCounts),
		]),
	].sort();
	const dispositionMismatches = dispositionNames.filter(
		(oneDispositionName) =>
			dispositionCounts[oneDispositionName] !==
			EXPECTED.mergedChildDispositionCounts[oneDispositionName],
	);
	evidence(`dispositions compared key-by-key over ${dispositionNames.length} names; mismatches: ${dispositionMismatches.map((oneName) => `${oneName} ${dispositionCounts[oneName]}!=${EXPECTED.mergedChildDispositionCounts[oneName]}`).join(', ') || 'none'}`);
	check('G4.6a every disposition count is exactly as measured', dispositionMismatches.length === 0 && dispositionNames.length === Object.keys(EXPECTED.mergedChildDispositionCounts).length);

	// ---- acceptance 1: the 187 traversals need no MERGED_FROM hop to render ------------------
	const mergedDefinitionStableIds = new Set(
		syntheticNodesOf(args.runOne)
			.filter((oneNode) => oneNode.properties.syntheticRule === 'S-1')
			.map((oneNode) => oneNode.stableId),
	);
	const hasPropertyChildCountByParent = {};
	args.runOne.edges
		.filter((oneEdge) => oneEdge.type === 'HAS_PROPERTY')
		.forEach((oneEdge) => {
			hasPropertyChildCountByParent[oneEdge.fromRef.id] =
				(hasPropertyChildCountByParent[oneEdge.fromRef.id] || 0) + 1;
		});
	const elementDeclReferencesIntoMerged = args.runOne.edges.filter(
		(oneEdge) => oneEdge.type === 'RESOLVES_TO' && mergedDefinitionStableIds.has(oneEdge.toRef.id),
	);
	const mergedTargetsReached = new Set(
		elementDeclReferencesIntoMerged.map((oneEdge) => oneEdge.toRef.id),
	);
	// ================================================================================
	// REBUILT AFTER THE INDEPENDENT REVIEW — THE PREDECESSOR WAS STRUCTURALLY VACUOUS
	// ================================================================================
	// What stood here filtered for targets that had ZERO HAS_PROPERTY children AND had child
	// records. Those are mutually exclusive by construction: a target with child records HAS
	// children. The filtered set was therefore empty for ANY input, correct or corrupt, and the
	// gate printed "targets that carry children yet render empty: 0" while asserting nothing at
	// all. THIRTY OF NINETY-SIX reached targets do render empty. It also used `|| 0`, the silent
	// default this campaign forbids, in the same expression.
	//
	// This is R-P4-7's defect one gate over — a filter walking a set that cannot be non-empty — and
	// it was written by the same hand that quoted R-P4-7 in the module comments. Knowing a
	// defect's shape is not the same as having checked your own work against it.
	//
	// THE REAL CRITERION, stated so it can fail: no merged definition that HAS child declarations
	// in either branch may render empty. Measured from the SHIPPED GRAPH with the harness's own
	// walk (MERGED_FROM to each branch, then that branch's HAS_PROPERTY children) rather than from
	// the production stats, so the gate does not read the answer off the thing it is judging.
	const requiredChildCount = (countsByStableId, oneStableId) => {
		if (!Object.prototype.hasOwnProperty.call(countsByStableId, oneStableId)) {
			throw new Error(
				`HARNESS FAULT (G4.6a): no child count was computed for '${oneStableId}'. Reading an ` +
					'absent count as zero is how the predecessor of this gate became unable to fail.',
			);
		}
		return countsByStableId[oneStableId];
	};
	const mergedDefinitionNodes = syntheticNodesOf(args.runOne).filter(
		(oneNode) => oneNode.properties.syntheticRule === 'S-1',
	);
	const ownChildCountByMerged = {};
	const branchChildCountByMerged = {};
	mergedDefinitionNodes.forEach((oneMergedNode) => {
		ownChildCountByMerged[oneMergedNode.stableId] = 0;
		branchChildCountByMerged[oneMergedNode.stableId] = 0;
	});
	args.runOne.edges
		.filter((oneEdge) => oneEdge.type === 'HAS_PROPERTY')
		.forEach((oneEdge) => {
			if (Object.prototype.hasOwnProperty.call(ownChildCountByMerged, oneEdge.fromRef.id)) {
				ownChildCountByMerged[oneEdge.fromRef.id]++;
			}
		});
	const hasPropertyChildCountByAnyParent = {};
	args.runOne.edges
		.filter((oneEdge) => oneEdge.type === 'HAS_PROPERTY')
		.forEach((oneEdge) => {
			hasPropertyChildCountByAnyParent[oneEdge.fromRef.id] =
				(hasPropertyChildCountByAnyParent[oneEdge.fromRef.id] || 0) + 1;
		});
	args.runOne.edges
		.filter((oneEdge) => oneEdge.type === 'MERGED_FROM')
		.forEach((oneEdge) => {
			branchChildCountByMerged[oneEdge.fromRef.id] +=
				hasPropertyChildCountByAnyParent[oneEdge.toRef.id] === undefined
					? 0
					: hasPropertyChildCountByAnyParent[oneEdge.toRef.id];
		});

	const mergedDefinitionsWithBranchChildrenButNoOwn = mergedDefinitionNodes
		.filter(
			(oneMergedNode) =>
				requiredChildCount(branchChildCountByMerged, oneMergedNode.stableId) > 0 &&
				requiredChildCount(ownChildCountByMerged, oneMergedNode.stableId) === 0,
		)
		.map((oneMergedNode) => oneMergedNode.stableId);
	const mergedDefinitionsWithBranchChildren = mergedDefinitionNodes.filter(
		(oneMergedNode) => requiredChildCount(branchChildCountByMerged, oneMergedNode.stableId) > 0,
	);
	evidence(`ACCEPTANCE 1, measured over the shipped graph: ${mergedDefinitionNodes.length} merged definitions, of which ${mergedDefinitionsWithBranchChildren.length} have child declarations in at least one branch; of THOSE, rendering empty: ${mergedDefinitionsWithBranchChildrenButNoOwn.length}`);
	check('G4.6a ACCEPTANCE 1: every merged definition with child declarations in either branch renders them directly — none renders empty', mergedDefinitionsWithBranchChildrenButNoOwn.length === 0 && mergedDefinitionsWithBranchChildren.length === EXPECTED.mergedDefinitionsWithBranchChildren);

	// RED, biting on the BRANCH-CHILDREN conjunct specifically. The predecessor's receipt reddened
	// only the PersonType pin beside it, which is how a half-proven conjunction got recorded whole.
	const acceptanceProbeGraph = cloneGraph(args.runOne);
	const acceptanceProbeMergedStableId = mergedDefinitionsWithBranchChildren[0].stableId;
	acceptanceProbeGraph.edges = acceptanceProbeGraph.edges.filter(
		(oneEdge) =>
			!(oneEdge.type === 'HAS_PROPERTY' && oneEdge.fromRef.id === acceptanceProbeMergedStableId),
	);
	const acceptanceProbeOwnCount = acceptanceProbeGraph.edges.filter(
		(oneEdge) =>
			oneEdge.type === 'HAS_PROPERTY' && oneEdge.fromRef.id === acceptanceProbeMergedStableId,
	).length;
	const acceptanceProbeOffenders = mergedDefinitionNodes.filter((oneMergedNode) => {
		const ownCount =
			oneMergedNode.stableId === acceptanceProbeMergedStableId
				? acceptanceProbeOwnCount
				: requiredChildCount(ownChildCountByMerged, oneMergedNode.stableId);
		return requiredChildCount(branchChildCountByMerged, oneMergedNode.stableId) > 0 && ownCount === 0;
	});
	evidence(`RED (demonstrated): stripped every HAS_PROPERTY edge from '${acceptanceProbeMergedStableId}' (which HAS ${requiredChildCount(branchChildCountByMerged, acceptanceProbeMergedStableId)} branch children) -> offenders ${mergedDefinitionsWithBranchChildrenButNoOwn.length} -> ${acceptanceProbeOffenders.length}, condition inverts: ${acceptanceProbeOffenders.length !== 0}`);
	check('G4.6a ACCEPTANCE 1 RED: a merged definition stripped of its children IS caught, proving the branch-children conjunct bites', acceptanceProbeOffenders.length === 1);

	// ================================================================================
	// THE DATA-MUTATION LEVER FOR THE PRODUCTION ACCEPTANCE REFUSAL
	// ================================================================================
	// STANDING RULE, ruled 2026-08-06 after this phase produced the same vacuous gate TWICE: every
	// gate and every production refusal must have at least one lever that MUTATES PRODUCTION DATA —
	// the input, the corpus, or the graph — and not only a test expectation. The reason is
	// mechanical, not moral. An expectation lever changes a pinned number and watches an assertion
	// go red; that reddens it whether or not its predicate can ever be satisfied by real data, which
	// is exactly how both vacuous versions of this check were certified "proven". A DATA lever
	// cannot pass a vacuous check, because a vacuous check does not respond to data at all.
	//
	// This lever drops ONE HAS_PROPERTY edge from the INPUT graph. The union walks the `parentId`
	// property and is unaffected; the refusal recomputes the expected count from the EDGES and now
	// expects one fewer than the union produces. The two bases disagree and the tier refuses. Under
	// the predecessor — which compared two counts from the same pass — this mutation changed nothing.
	const dataLeverInput = cloneGraph(baselineInput);
	const dataLeverMergedRecord = baselineOutput.mergeReport.mergedChildDeclarationRecords.find(
		(oneRecord) => oneRecord.childUnionDisposition === 'soleBranchDeclaration',
	);
	const dataLeverVictimEdgeIndex = dataLeverInput.edges.findIndex(
		(oneEdge) =>
			oneEdge.type === 'HAS_PROPERTY' && oneEdge.toRef.id === dataLeverMergedRecord.copiedFromStableId,
	);
	if (dataLeverVictimEdgeIndex === -1) {
		throw new Error(
			`HARNESS FAULT (G4.6a): no HAS_PROPERTY edge reaches '${dataLeverMergedRecord.copiedFromStableId}', ` +
				'so the data lever has nothing to drop and would prove nothing by staying silent.',
		);
	}
	const dataLeverVictimEdge = dataLeverInput.edges[dataLeverVictimEdgeIndex];
	dataLeverInput.edges.splice(dataLeverVictimEdgeIndex, 1);
	let dataLeverRefusal = '';
	try {
		buildSyntheticTier(dataLeverInput);
	} catch (thrownError) {
		dataLeverRefusal = thrownError.message;
	}
	const dataLeverRefusesByName =
		dataLeverRefusal.indexOf('FAILED ITS OWN ACCEPTANCE CRITERION') !== -1 &&
		dataLeverRefusal.indexOf('HAS_PROPERTY edges') !== -1;
	evidence(`RED (demonstrated) BY DATA MUTATION, not by expectation: dropped the HAS_PROPERTY edge '${dataLeverVictimEdge.fromRef.id}' -> '${dataLeverVictimEdge.toRef.id}' from the INPUT graph (the parentId the union walks is untouched) -> ${dataLeverRefusesByName ? 'REFUSES BY NAME' : 'DID NOT REFUSE'}: ${dataLeverRefusal.substring(0, 200)}`);
	check('G4.6a ACCEPTANCE RED, BY DATA: the production refusal fires when the input\'s HAS_PROPERTY edges and its parentId containment disagree', dataLeverRefusesByName);

	// THE CONTROL THAT STOOD HERE IS DELETED, NOT REWRITTEN — supervisor closing order, 2026-08-06.
	//
	// It was the FOURTH vacuous check this phase produced, and it was inside the fix for the third.
	// Its 'predecessor form' compared controlPredecessorBranchCount > 0 against
	// controlPredecessorEmittedCount === 0, where the emitted count was the LENGTH of the very array
	// the branch count filtered against — so an empty array forces the branch count to zero and the
	// conjunction is UNSATISFIABLE. It reported 'SILENT' because it could not report anything else.
	// It was also a STRAW MODEL: it reimplemented a predicate the retired version never used, so it
	// never ran the code it claimed to discriminate against.
	//
	// FOUR ROUNDS, FOUR INSTANCES, EACH INSIDE THE FIX FOR THE LAST. The common factor is structural
	// rather than behavioural: every one compared a PURE FUNCTION's output against a quantity derived
	// from the SAME computation, and in that shape "the two agree" is a THEOREM, not a measurement.
	// A theorem dressed as an assertion always passes and always looks like diligence.
	//
	// A fifth attempt was NOT ordered and is not made. A deleted check that asserts nothing is
	// HONEST; a check that makes a false claim is not. The row is recorded genuineGap in the ledger
	// with that reason. The DATA LEVER above stands on its own and was verified by the third review
	// firing it in BOTH directions against a mutated forge input.


	// GAP 2 — THE NUMBER A CONSUMER ACTUALLY MEETS, DECLARED. 30 of 96 reached merged targets
	// render no child elements. That is NOT a defect and nothing was dropped: 27 are simpleTypes,
	// which have no element children by definition, and 3 are complexTypes whose content comes from
	// an extension BASE rather than local declarations. Published because a consumer who is not told
	// this will read an empty merged type as a failure of this phase.
	const emptyRenderCensus = baselineOutput.stats.emptyRenderCensus;
	evidence(`GAP 2 DECLARED — reached merged targets rendering EMPTY: ${emptyRenderCensus.anyReferrer.rendersEmpty} of ${emptyRenderCensus.anyReferrer.reachedTargets} (any referrer) = ${JSON.stringify(emptyRenderCensus.anyReferrer.emptyCountByKind)}; ${emptyRenderCensus.elementDeclReferrer.rendersEmpty} of ${emptyRenderCensus.elementDeclReferrer.reachedTargets} (element-declaration referrers, the acceptance-1 population) = ${JSON.stringify(emptyRenderCensus.elementDeclReferrer.emptyCountByKind)}. Nothing was dropped — see the assertion above.`);
	// SPLIT BY REFERRER SCOPE AND BY KIND. Written first as ONE assertion joining six conditions,
	// which made it the largest conjunction in the whole suite — in the same session that reported
	// the conjunction-evidence gap as a class. Filing that finding while adding its worst instance
	// is hypocrisy with a footnote. Three claims, three labels, each independently reddenable.
	check('G4.6a GAP 2: across ALL referrers, exactly 30 of 96 reached merged targets render empty', emptyRenderCensus.anyReferrer.rendersEmpty === EXPECTED.emptyRenderAnyReferrer && emptyRenderCensus.anyReferrer.reachedTargets === EXPECTED.reachedTargetsAnyReferrer);
	check('G4.6a GAP 2: scoped to element-declaration referrers (the acceptance-1 population), exactly 29 of 94 render empty', emptyRenderCensus.elementDeclReferrer.rendersEmpty === EXPECTED.emptyRenderElementDeclReferrer && emptyRenderCensus.elementDeclReferrer.reachedTargets === EXPECTED.reachedTargetsElementDeclReferrer);
	check('G4.6a GAP 2: the empty ones are 27 simpleTypes and 3 complexTypes — the explanation, not just the count', emptyRenderCensus.anyReferrer.emptyCountByKind.complexType === 3 && emptyRenderCensus.anyReferrer.emptyCountByKind.simpleType === 27);

	// THE TWO PUBLICATIONS OF ONE FIGURE MUST AGREE. The contribution counts are published twice —
	// on every merged NODE (read by a graph consumer) and in STATS (read by the build report) — and
	// they are computed by two separate accumulators. They diverged: a fix applied to one and not
	// the other made the build say 36 college contributions while the graph said 33. Nothing failed,
	// because the only stats use of that figure was an upper bound, and a number used only as a
	// loose bound is not being checked. Reconciled here so the two can never drift apart silently.
	const nodePublishedCollegeContributions = mergedDefinitionNodes
		.reduce(
			(runningTotal, oneNode) => runningTotal + oneNode.properties.collegeContributedChildElementCount,
			0,
		);
	const nodePublishedTestScoreContributions = mergedDefinitionNodes
		.reduce(
			(runningTotal, oneNode) =>
				runningTotal + oneNode.properties.testScoreContributedChildElementCount,
			0,
		);
	const statsCollegeContributions = args.runOne.stats.synthetic.collegeContributedChildElements;
	const statsTestScoreContributions = args.runOne.stats.synthetic.testScoreContributedChildElements;
	evidence(`one figure, two publications: college — nodes ${nodePublishedCollegeContributions} vs stats ${statsCollegeContributions}; test-score — nodes ${nodePublishedTestScoreContributions} vs stats ${statsTestScoreContributions}`);
	check('G4-C the contribution counts published on the NODES and in STATS agree exactly (they are computed by separate accumulators and once diverged)', nodePublishedCollegeContributions === statsCollegeContributions && nodePublishedTestScoreContributions === statsTestScoreContributions && statsCollegeContributions === EXPECTED.collegeContributedChildElements && statsTestScoreContributions === EXPECTED.testScoreContributedChildElements);

	// the named exemplar, on its OWN label so its receipt is its own (GAP 1b's lesson)
	const personTypeNode = mergedDefinitionNodes.find(
		(oneNode) => oneNode.properties.name === 'PersonType',
	);
	evidence(`the named exemplar PersonType now has ${requiredChildCount(ownChildCountByMerged, personTypeNode.stableId)} HAS_PROPERTY children (it had 0, out-degree 2, both MERGED_FROM); reached merged targets ${mergedTargetsReached.size} from ${elementDeclReferencesIntoMerged.length} element-declaration references`);
	check('G4.6a the named exemplar PersonType renders exactly 18 children', requiredChildCount(ownChildCountByMerged, personTypeNode.stableId) === EXPECTED.personTypeChildElementCount);

	// ---- acceptance 5: MERGED_FROM survives untouched ----------------------------------------
	const mergedFromEdgeCount = syntheticEdgesOf(args.runOne).filter(
		(oneEdge) => oneEdge.type === 'MERGED_FROM',
	).length;
	evidence(`MERGED_FROM edges after duplication: ${mergedFromEdgeCount} (Phase 4 emitted ${EXPECTED.mergedFromEdges}) — duplication SUPPLEMENTS provenance, it does not replace it`);
	check('G4.6a MERGED_FROM survives untouched at 140 edges', mergedFromEdgeCount === EXPECTED.mergedFromEdges);

	// ---- R-P4-12 residue, stated as a number rather than a silence --------------------------
	const inlineTypeEdges = syntheticEdgesOf(args.runOne).filter(
		(oneEdge) => oneEdge.type === 'HAS_SUPPORT' && oneEdge.properties.syntheticRule === 'S-1c',
	);
	const derivationEdges = syntheticEdgesOf(args.runOne).filter(
		(oneEdge) => oneEdge.type === 'HAS_RESTRICTION' && oneEdge.properties.syntheticRule === 'S-1c',
	);
	evidence(`R-P4-12 RESIDUE, OPEN AND NUMBERED: ${inlineTypeEdges.length} element declarations whose inline anonymous type is REFERENCED not duplicated, and ${derivationEdges.length} merged definitions whose derivation wrapper is REFERENCED not duplicated. Element declarations are complete; walking INTO those ${inlineTypeEdges.length} still takes a hop into the contributing branch.`);
	check('G4.6a the referenced-not-duplicated residue is exactly 5 inline types and 38 derivation wrappers', inlineTypeEdges.length === EXPECTED.inlineTypeReferenceEdges && derivationEdges.length === EXPECTED.derivationReferenceEdges);

	// =================================================================
	// LEVER 1 — INVENTION
	// =================================================================
	// The production path builds children by COPYING branch declarations, so it has no route to
	// invention and the checker cannot fail against real data. That is exactly why the checker is
	// exported as a pure function: the lever hands the SHIPPED checker the SHIPPED population with
	// ONE fabricated record appended. A checker only ever run on correct-by-construction input has
	// demonstrated nothing, however green it looks.
	const declaredKeySet = new Set(baselineOutput.mergeReport.declaredChildDeclarationKeys);
	let inventionGreenError = '';
	try {
		verifyMergedChildrenWereDeclared({
			mergedChildDeclarationRecords: baselineOutput.mergeReport.mergedChildDeclarationRecords,
			declaredChildDeclarationKeys: declaredKeySet,
		});
	} catch (thrownError) {
		inventionGreenError = thrownError.message;
	}
	check('G4.6a INVENTION: the shipped population passes the shipped declaration check', inventionGreenError === '');

	const fabricatedChildRecord = {
		mergedDefinitionStableId: `${CONTESTED_NAMESPACE}#complexType/PersonType`,
		definitionKey: 'complexType|PersonType',
		name: 'HarnessInventedChild',
		typeAsWritten: 'core:HarnessInventedType',
		minOccurs: '0',
		maxOccurs: 'unbounded',
	};
	let inventionRefusal = '';
	try {
		verifyMergedChildrenWereDeclared({
			mergedChildDeclarationRecords: [
				...baselineOutput.mergeReport.mergedChildDeclarationRecords,
				fabricatedChildRecord,
			],
			declaredChildDeclarationKeys: declaredKeySet,
		});
	} catch (thrownError) {
		inventionRefusal = thrownError.message;
	}
	const inventionRefusesByName =
		inventionRefusal.indexOf('S-1c INVENTION') !== -1 &&
		inventionRefusal.indexOf('HarnessInventedChild') !== -1;
	evidence(`RED (demonstrated): appended one child whose signature no member declares -> ${inventionRefusesByName ? 'REFUSES BY NAME' : 'DID NOT REFUSE'}: ${inventionRefusal.substring(0, 190)}`);
	check('G4.6a INVENTION RED: a child declared by NEITHER member is refused BY NAME', inventionRefusesByName);

	// a same-name child under the WRONG owning type must also be refused — the declaration key
	// carries the owning definition precisely so a name cannot be vouched for by a stranger.
	const wrongOwnerRecord = {
		mergedDefinitionStableId: `${CONTESTED_NAMESPACE}#complexType/SponsorType`,
		definitionKey: 'complexType|SponsorType',
		name: 'HighSchool',
		typeAsWritten: 'AcRec:HighSchoolType',
		minOccurs: '0',
		maxOccurs: null,
	};
	let wrongOwnerRefusal = '';
	try {
		verifyMergedChildrenWereDeclared({
			mergedChildDeclarationRecords: [
				...baselineOutput.mergeReport.mergedChildDeclarationRecords,
				wrongOwnerRecord,
			],
			declaredChildDeclarationKeys: declaredKeySet,
		});
	} catch (thrownError) {
		wrongOwnerRefusal = thrownError.message;
	}
	evidence(`RED (demonstrated): a REAL child signature attached to the WRONG owning type -> ${wrongOwnerRefusal.indexOf('S-1c INVENTION') !== -1 ? 'REFUSES BY NAME' : 'DID NOT REFUSE'}: ${wrongOwnerRefusal.substring(0, 150)}`);
	check('G4.6a INVENTION RED: a real signature under the WRONG owning type is refused (the key is not name-only)', wrongOwnerRefusal.indexOf('S-1c INVENTION') !== -1);

	// =================================================================
	// LEVER 2 — SHORTFALL
	// =================================================================
	// Remove ONE branch's contribution from the INPUT and require the union to come back short by
	// an exact enumerated count. This lever bites at the input, not at a checker's argument.
	const shortfallInput = cloneGraph(baselineInput);
	const shortfallVictimStableId = baselineOutput.mergeReport.mergedChildDeclarationRecords.find(
		(oneRecord) => oneRecord.childUnionDisposition === 'losingBranchContributed',
	).copiedFromStableId;
	shortfallInput.nodes = shortfallInput.nodes.filter(
		(oneNode) => oneNode.stableId !== shortfallVictimStableId,
	);
	shortfallInput.edges = shortfallInput.edges.filter(
		(oneEdge) => oneEdge.fromRef.id !== shortfallVictimStableId && oneEdge.toRef.id !== shortfallVictimStableId,
	);
	const shortfallOutput = buildSyntheticTier(shortfallInput);
	const shortfallDelta = baselineOutput.stats.mergedChildNodes - shortfallOutput.stats.mergedChildNodes;
	// SPLIT AFTER THE INDEPENDENT REVIEW (GAP 8). This was ONE assertion joining two claims — that
	// the union shortens by exactly one, and that the contribution count follows it — and its
	// retained receipt reddened only the second. A conjunction whose evidence covers one half is
	// half-proven and was recorded whole. Each half now carries its own label and its own lever.
	evidence(`RED (demonstrated): removed the losing-branch declaration '${shortfallVictimStableId}' -> union ${baselineOutput.stats.mergedChildNodes} -> ${shortfallOutput.stats.mergedChildNodes} (short by exactly ${shortfallDelta}); test-score contributions ${baselineOutput.stats.testScoreContributedChildElements} -> ${shortfallOutput.stats.testScoreContributedChildElements}`);
	check('G4.6a SHORTFALL RED: removing ONE branch contribution shortens the union by EXACTLY one', shortfallDelta === 1);
	check('G4.6a SHORTFALL RED: the R-P4-11 contribution count follows the removal', shortfallOutput.stats.testScoreContributedChildElements === EXPECTED.testScoreContributedChildElements - 1);

	// GAP 8's own lever, isolating the DELTA conjunct: remove a WINNER child instead. The union
	// still shortens by exactly one, but the test-score contribution count does NOT move — so this
	// reddens a mutation of the delta claim while leaving the contribution claim untouched, which
	// is what makes the two independently evidenced rather than jointly asserted.
	const winnerShortfallInput = cloneGraph(baselineInput);
	const winnerShortfallVictimStableId = baselineOutput.mergeReport.mergedChildDeclarationRecords.find(
		(oneRecord) => oneRecord.childUnionDisposition === 'soleBranchDeclaration',
	).copiedFromStableId;
	winnerShortfallInput.nodes = winnerShortfallInput.nodes.filter(
		(oneNode) => oneNode.stableId !== winnerShortfallVictimStableId,
	);
	winnerShortfallInput.edges = winnerShortfallInput.edges.filter(
		(oneEdge) =>
			oneEdge.fromRef.id !== winnerShortfallVictimStableId &&
			oneEdge.toRef.id !== winnerShortfallVictimStableId,
	);
	const winnerShortfallOutput = buildSyntheticTier(winnerShortfallInput);
	const winnerShortfallDelta =
		baselineOutput.stats.mergedChildNodes - winnerShortfallOutput.stats.mergedChildNodes;
	evidence(`RED (demonstrated), DELTA CONJUNCT ISOLATED: removed the winning-branch declaration '${winnerShortfallVictimStableId}' -> union short by exactly ${winnerShortfallDelta}, while test-score contributions stay ${winnerShortfallOutput.stats.testScoreContributedChildElements} (unchanged) — the delta claim moves and the contribution claim does not`);
	check('G4.6a SHORTFALL RED: the delta claim is evidenced INDEPENDENTLY of the contribution claim', winnerShortfallDelta === 1 && winnerShortfallOutput.stats.testScoreContributedChildElements === EXPECTED.testScoreContributedChildElements);

	// =================================================================
	// GAP 5 — THE NAME-KEYED UNION'S WARRANT, NOW SHIPPED
	// =================================================================
	// The union is keyed by NAME, and that was warranted only by an untracked probe: measured once,
	// asserted nowhere, free to stop being true unnoticed. Production now REFUSES a container that
	// declares one child name twice. Asserted here, and demonstrated red, because a refusal nobody
	// has seen fire is an unenforced claim.
	const childNameCollisionsInGraph = [];
	const childNamesByMergedParent = {};
	args.runOne.nodes
		.filter((oneNode) => oneNode.properties.syntheticRule === 'S-1c')
		.forEach((oneNode) => {
			const parentStableId = oneNode.properties.mergedDefinitionStableId;
			(childNamesByMergedParent[parentStableId] =
				childNamesByMergedParent[parentStableId] || []).push(oneNode.properties.name);
		});
	Object.keys(childNamesByMergedParent).forEach((oneParentStableId) => {
		const childNames = childNamesByMergedParent[oneParentStableId];
		if (childNames.length !== new Set(childNames).size) {
			childNameCollisionsInGraph.push(oneParentStableId);
		}
	});
	evidence(`GAP 5: merged definitions whose duplicated children repeat a name: ${childNameCollisionsInGraph.length} (a name-keyed union would have silently collapsed them)`);
	check('G4.6a GAP 5: no merged definition carries two duplicated children of the same name', childNameCollisionsInGraph.length === 0);

	const nameCollisionInput = cloneGraph(baselineInput);
	const nameCollisionVictim = nameCollisionInput.nodes.find(
		(oneNode) =>
			oneNode.properties.pescTier === 'source' &&
			oneNode.labels.indexOf('PescElementDecl') !== -1 &&
			oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#`) === 0,
	);
	const nameCollisionSibling = nameCollisionInput.nodes.find(
		(oneNode) =>
			oneNode.stableId !== nameCollisionVictim.stableId &&
			oneNode.properties.parentId === nameCollisionVictim.properties.parentId &&
			oneNode.labels.indexOf('PescElementDecl') !== -1,
	);
	nameCollisionSibling.properties.name = nameCollisionVictim.properties.name;
	let nameCollisionRefusal = '';
	try {
		buildSyntheticTier(nameCollisionInput);
	} catch (thrownError) {
		nameCollisionRefusal = thrownError.message;
	}
	evidence(`RED (demonstrated): renamed '${nameCollisionSibling.stableId}' to collide with its sibling '${nameCollisionVictim.properties.name}' -> ${nameCollisionRefusal.indexOf('union the children') !== -1 ? 'REFUSES BY NAME' : 'DID NOT REFUSE'}: ${nameCollisionRefusal.substring(0, 170)}`);
	check('G4.6a GAP 5 RED: a repeated child name in one container is REFUSED by name, so the union cannot silently collapse two declarations', nameCollisionRefusal.indexOf('union the children') !== -1 && nameCollisionRefusal.indexOf(nameCollisionVictim.properties.name) !== -1);

	// =================================================================
	// GAP 7 — PER-CHILD PROVENANCE MUST RESOLVE
	// =================================================================
	// copiedFromStableId is a bare stableId PROPERTY with no backing edge — the exact hazard
	// R-P4-12 condition 1 names, and it arrived on the per-child provenance while I was busy
	// converting the residue pointers to edges. All 522 resolve today and NOTHING asserted it.
	// Asserted now, with a lever. (Whether it should become an edge is a supervisor question; the
	// assertion closes the unenforced-claim half either way.)
	const graphNodeStableIds = new Set(args.runOne.nodes.map((oneNode) => oneNode.stableId));
	const duplicatedChildren = args.runOne.nodes.filter(
		(oneNode) => oneNode.properties.syntheticRule === 'S-1c',
	);
	const unresolvableProvenance = duplicatedChildren.filter(
		(oneNode) => !graphNodeStableIds.has(oneNode.properties.copiedFromStableId),
	);
	const provenanceNamingASyntheticNode = duplicatedChildren.filter((oneNode) => {
		const sourceNode = args.runOne.nodes.find(
			(oneCandidate) => oneCandidate.stableId === oneNode.properties.copiedFromStableId,
		);
		return sourceNode !== undefined && sourceNode.properties.pescTier !== 'source';
	});
	evidence(`GAP 7: ${duplicatedChildren.length} duplicated children; copiedFromStableId not resolving to a live node: ${unresolvableProvenance.length}; resolving to something that is not a SOURCE node: ${provenanceNamingASyntheticNode.length}`);
	check('G4.6a GAP 7: every copiedFromStableId resolves to a live SOURCE-tier node', unresolvableProvenance.length === 0 && provenanceNamingASyntheticNode.length === 0 && duplicatedChildren.length === EXPECTED.mergedChildNodes);

	const provenanceProbeGraph = cloneGraph(args.runOne);
	const provenanceProbeChild = provenanceProbeGraph.nodes.find(
		(oneNode) => oneNode.properties.syntheticRule === 'S-1c',
	);
	provenanceProbeChild.properties.copiedFromStableId = 'harness:noSuchSourceDeclaration';
	const provenanceProbeStableIds = new Set(
		provenanceProbeGraph.nodes.map((oneNode) => oneNode.stableId),
	);
	const provenanceProbeDangling = provenanceProbeGraph.nodes
		.filter((oneNode) => oneNode.properties.syntheticRule === 'S-1c')
		.filter((oneNode) => !provenanceProbeStableIds.has(oneNode.properties.copiedFromStableId));
	evidence(`RED (demonstrated): repointed '${provenanceProbeChild.stableId}' provenance at a name no node carries -> dangling provenance detected: ${provenanceProbeDangling.length}, condition inverts: ${provenanceProbeDangling.length !== 0}`);
	check('G4.6a GAP 7 RED: a dangling copiedFromStableId IS detected (a bare stableId property has no other protection)', provenanceProbeDangling.length === 1);

	// and the union does NOT silently complete: the child is gone, not quietly sourced elsewhere
	const shortfallSurvivors = shortfallOutput.nodes.filter(
		(oneNode) => oneNode.properties.copiedFromStableId === shortfallVictimStableId,
	);
	evidence(`survivors copied from the removed declaration: ${shortfallSurvivors.length} (a nonzero here would mean the union found the child somewhere it was not declared)`);
	check('G4.6a SHORTFALL RED: the union does not silently complete — no child survives the removed declaration', shortfallSurvivors.length === 0);

	// =================================================================
	// LEVER 3 — TIER LEAKAGE
	// =================================================================
	// Asserting "the source predicate sees zero synthetic children" against a projection that never
	// could have contained them proves nothing. Plant a child that WOULD leak and observe the catch.
	const sourcePredicateChildLeaks = args.runOne.nodes.filter(
		(oneNode) => oneNode.properties.pescTier === 'source' && oneNode.properties.syntheticRule === 'S-1c',
	);
	const sourcePredicateChildEdgeLeaks = args.runOne.edges.filter(
		(oneEdge) => oneEdge.properties.pescTier === 'source' && oneEdge.properties.syntheticRule === 'S-1c',
	);
	evidence(`source predicate over the shipped graph: ${sourcePredicateChildLeaks.length} duplicated-child node leak(s), ${sourcePredicateChildEdgeLeaks.length} edge leak(s)`);
	check('G4.6a TIER-LEAKAGE: zero duplicated children are reachable by the source-tier predicate', sourcePredicateChildLeaks.length === 0 && sourcePredicateChildEdgeLeaks.length === 0);

	const leakProbeGraph = cloneGraph(args.runOne);
	const leakProbeChild = leakProbeGraph.nodes.find(
		(oneNode) => oneNode.properties.syntheticRule === 'S-1c',
	);
	leakProbeChild.properties.pescTier = 'source';
	const leakProbeEdge = leakProbeGraph.edges.find(
		(oneEdge) => oneEdge.toRef.id === leakProbeChild.stableId && oneEdge.type === 'HAS_PROPERTY',
	);
	leakProbeEdge.properties.pescTier = 'source';
	const leakProbeNodeHits = leakProbeGraph.nodes.filter(
		(oneNode) => oneNode.properties.pescTier === 'source' && oneNode.properties.syntheticRule === 'S-1c',
	);
	const leakProbeEdgeHits = leakProbeGraph.edges.filter(
		(oneEdge) => oneEdge.properties.pescTier === 'source' && oneEdge.properties.syntheticRule === 'S-1c',
	);
	evidence(`RED (demonstrated): retiered duplicated child '${leakProbeChild.stableId}' and its HAS_PROPERTY edge as pescTier:'source' -> the source predicate now finds ${leakProbeNodeHits.length} node leak(s) and ${leakProbeEdgeHits.length} edge leak(s), condition inverts: ${leakProbeNodeHits.length !== 0}`);
	check('G4.6a TIER-LEAKAGE RED: a duplicated child retiered as source IS caught by the source predicate', leakProbeNodeHits.length === 1 && leakProbeEdgeHits.length === 1);

	// the derived tier's annotations must NOT ride along on a duplicated child. This one is not
	// hypothetical: the first build of this phase leaked 'ambiguousPendingSynthesis' onto 134
	// children via the bulk property copy and moved Gate 3's compare by 94,051 canonical bytes.
	const derivedAnnotationNames = [
		'sameDefinitionClusterId',
		'reachableFromLatestRoot',
		'resolvesToBuiltinXsd',
		'ambiguousPendingSynthesis',
		'unresolvedImportFact',
		'unresolvedNamespaceReferences',
	];
	const childrenCarryingADerivedAnnotation = args.runOne.nodes
		.filter((oneNode) => oneNode.properties.syntheticRule === 'S-1c')
		.filter((oneNode) =>
			derivedAnnotationNames.some((oneAnnotationName) =>
				Object.prototype.hasOwnProperty.call(oneNode.properties, oneAnnotationName),
			),
		);
	evidence(`duplicated children carrying a DERIVED annotation: ${childrenCarryingADerivedAnnotation.length} (the first build of this phase produced 134 before the strip was added)`);
	check('G4.6a TIER-LEAKAGE: no duplicated child carries a derived-tier annotation', childrenCarryingADerivedAnnotation.length === 0);

	const annotationLeakProbe = cloneGraph(args.runOne);
	const annotationLeakChild = annotationLeakProbe.nodes.find(
		(oneNode) => oneNode.properties.syntheticRule === 'S-1c',
	);
	annotationLeakChild.properties.ambiguousPendingSynthesis = '[]';
	const annotationLeakHits = annotationLeakProbe.nodes
		.filter((oneNode) => oneNode.properties.syntheticRule === 'S-1c')
		.filter((oneNode) =>
			derivedAnnotationNames.some((oneAnnotationName) =>
				Object.prototype.hasOwnProperty.call(oneNode.properties, oneAnnotationName),
			),
		);
	evidence(`RED (demonstrated): staged 'ambiguousPendingSynthesis' onto one duplicated child -> detector finds ${annotationLeakHits.length}, condition inverts: ${annotationLeakHits.length !== 0}`);
	check('G4.6a TIER-LEAKAGE RED: a derived annotation planted on a duplicated child IS detected', annotationLeakHits.length === 1);

	// =================================================================
	// LEVER 4 — REGENERATION
	// =================================================================
	// Synthetic content that cannot be reproduced from preserved inputs cannot satisfy R-VAL-5.
	// Delete every duplicated child and regenerate from source+derived; the S-1c portion must come
	// back byte-identical.
	const s1cViewOf = (oneOutput) =>
		JSON.stringify({
			nodes: oneOutput.nodes
				.filter((oneNode) => oneNode.properties.syntheticRule === 'S-1c')
				.map((oneNode) => ({
					stableId: oneNode.stableId,
					labels: [...oneNode.labels].sort(),
					properties: sortedKeyObject(oneNode.properties),
				}))
				.sort((viewA, viewB) => (viewA.stableId < viewB.stableId ? -1 : 1)),
			edges: oneOutput.edges
				.filter((oneEdge) => oneEdge.properties.syntheticRule === 'S-1c')
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
	const shippedS1cView = s1cViewOf({
		nodes: args.runOne.nodes,
		edges: args.runOne.edges,
	});
	const regeneratedS1cView = s1cViewOf(baselineOutput);
	evidence(`GREEN: regenerated the S-1c portion from source+derived: identical ${regeneratedS1cView === shippedS1cView} (${shippedS1cView.length} canonical bytes)`);
	check('G4.6a REGENERATION: every duplicated child regenerates byte-identically from preserved inputs', regeneratedS1cView === shippedS1cView);

	// RED — perturb ONE source child's cardinality and require the regenerated view to move. A
	// regeneration compare that stays still when its input changes is measuring nothing.
	const regenerationProbeInput = cloneGraph(baselineInput);
	const regenerationProbeChild = regenerationProbeInput.nodes.find(
		(oneNode) =>
			oneNode.stableId ===
			baselineOutput.mergeReport.mergedChildDeclarationRecords[0].copiedFromStableId,
	);
	const regenerationProbeOriginalMaxOccurs = regenerationProbeChild.properties.maxOccurs;
	regenerationProbeChild.properties.maxOccurs = 'unbounded';
	const regenerationProbeView = s1cViewOf(buildSyntheticTier(regenerationProbeInput));
	evidence(`RED (demonstrated): changed '${regenerationProbeChild.stableId}' maxOccurs ${JSON.stringify(regenerationProbeOriginalMaxOccurs)} -> 'unbounded' => regenerated S-1c view differs: ${regenerationProbeView !== shippedS1cView}`);
	check('G4.6a REGENERATION RED: perturbing ONE source declaration moves the regenerated child view', regenerationProbeView !== shippedS1cView);

	// =================================================================
	// LEVER 5 — THE REFERENCED RESIDUE (R-P4-12 condition 2)
	// =================================================================
	// The residue is carried by REAL EDGES rather than stableId-valued properties precisely so it
	// cannot dangle unseen. That protection is worth nothing unless a broken reference is caught.
	const residueEdges = [...inlineTypeEdges, ...derivationEdges];
	const shippedNodeStableIds = new Set(args.runOne.nodes.map((oneNode) => oneNode.stableId));
	const danglingResidueEdges = residueEdges.filter(
		(oneEdge) =>
			!shippedNodeStableIds.has(oneEdge.fromRef.id) || !shippedNodeStableIds.has(oneEdge.toRef.id),
	);
	evidence(`residue edges with both endpoints present: ${residueEdges.length - danglingResidueEdges.length}/${residueEdges.length}`);
	check('G4.6a RESIDUE: every referenced-not-duplicated edge has both endpoints in the graph', danglingResidueEdges.length === 0);

	const residueProbeGraph = cloneGraph(args.runOne);
	const residueProbeTargetStableId = inlineTypeEdges[0].toRef.id;
	residueProbeGraph.nodes = residueProbeGraph.nodes.filter(
		(oneNode) => oneNode.stableId !== residueProbeTargetStableId,
	);
	const residueProbeNodeStableIds = new Set(
		residueProbeGraph.nodes.map((oneNode) => oneNode.stableId),
	);
	const residueProbeDangling = residueProbeGraph.edges
		.filter(
			(oneEdge) =>
				oneEdge.properties.syntheticRule === 'S-1c' &&
				(oneEdge.type === 'HAS_SUPPORT' || oneEdge.type === 'HAS_RESTRICTION'),
		)
		.filter(
			(oneEdge) =>
				!residueProbeNodeStableIds.has(oneEdge.fromRef.id) ||
				!residueProbeNodeStableIds.has(oneEdge.toRef.id),
		);
	evidence(`RED (demonstrated): removed the inline-type target '${residueProbeTargetStableId}' -> dangling residue edges detected: ${residueProbeDangling.length}, condition inverts: ${residueProbeDangling.length !== 0}`);
	check('G4.6a RESIDUE RED: a broken residue reference IS detected as dangling', residueProbeDangling.length === 1);

	// CORRECTED AFTER OBSERVING IT FAIL — and the correction is the finding, not the repair.
	//
	// This first asserted that the tier REFUSES at emission when a residue endpoint is absent. It
	// does not, and it cannot: the inline-type reference is derived by looking the anonymous type up
	// in the live node index, so an absent node yields NO EDGE rather than a dangling one. Absence
	// produces a SHORTFALL, not a dangle. Shipping the original assertion would have shipped a true
	// green whose stated reason was false.
	//
	// What IS true, and is asserted instead: the residue count follows its input exactly. The
	// edge-over-property choice still stands on its own merit — a stableId STRING copied onto a node
	// can point at nothing and no gate would see it, whereas an edge is constructed from a live
	// reference at emission and is checked by conservation and by the dangling detector above.
	const residueShortfallInput = cloneGraph(baselineInput);
	residueShortfallInput.nodes = residueShortfallInput.nodes.filter(
		(oneNode) => oneNode.stableId !== residueProbeTargetStableId,
	);
	const residueShortfallOutput = buildSyntheticTier(residueShortfallInput);
	const residueShortfallEdgeCount = residueShortfallOutput.edges.filter(
		(oneEdge) => oneEdge.type === 'HAS_SUPPORT' && oneEdge.properties.syntheticRule === 'S-1c',
	).length;
	const residueShortfallDangling = residueShortfallOutput.edges
		.filter((oneEdge) => oneEdge.properties.syntheticRule === 'S-1c')
		.filter((oneEdge) => oneEdge.toRef.id === residueProbeTargetStableId);
	evidence(`RED (demonstrated): removing the inline-type node at BUILD time -> inline-type reference edges ${EXPECTED.inlineTypeReferenceEdges} -> ${residueShortfallEdgeCount} (exact shortfall of ${EXPECTED.inlineTypeReferenceEdges - residueShortfallEdgeCount}), and ${residueShortfallDangling.length} edges point at the removed node — absence yields a SHORTFALL, never a dangle`);
	check('G4.6a RESIDUE RED: an absent residue endpoint produces an EXACT shortfall and never a dangling edge', residueShortfallEdgeCount === EXPECTED.inlineTypeReferenceEdges - 1 && residueShortfallDangling.length === 0);

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
		'LEDGER every proven row carries at least one lever that MUTATES PRODUCTION DATA',
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

	// ==========================================================================================
	// THE STANDING RULE, NOW ENFORCED (JADE_PORTAL ruling, 2026-08-07, on SCARLET_GARDEN's sweep):
	// EVERY `proven` ROW MUST CARRY AT LEAST ONE LEVER THAT MUTATES PRODUCTION DATA.
	//
	// Mechanically: an expectation lever reddens an assertion whether or not its predicate can ever
	// be satisfied by real data, so it certifies a VACUOUS gate as proven. A data lever cannot,
	// because a vacuous check does not respond to data at all. A row whose only receipt is an
	// expectation perturbation proves the assertion is WIRED UP, not that it can catch a defect.
	//
	// THE CLASSIFIER IS IMPORTED, NOT REIMPLEMENTED. p7_expectationLeverSweep.js owns the declared
	// LEVER_CLASS_REGISTRY and refuses by name on an undeclared opening token; a second copy here
	// would be two derivations of one judgment held against each other, which is DESIGN 8h's failure.
	//
	// THIS GATE'S FIRST RUN WAS RED AGAINST 65 SHIPPED ROWS and that red is retained at
	// test/test-artifacts/p7/p7RED_provenImpliesDataLever.log. Those rows were then re-stated
	// `expectationLeverOnly` — a status added for them, because the ledger DEFINES `genuineGap` as
	// "never demonstrated able to fail, by anyone" and these rows HAVE failed, just not under a data
	// lever. Re-labelling them genuineGap would have bought an honest number with a dishonest
	// vocabulary.
	// ==========================================================================================
	const { classifyOneLever } = require(path.join(__dirname, 'probes', 'p7_expectationLeverSweep.js'));
	const provenRowsWithoutADataLever = suiteLedger.assertions
		.filter((oneEntry) => oneEntry.status === 'proven')
		.filter(
			(oneEntry) =>
				!(Array.isArray(oneEntry.redEvidence) ? oneEntry.redEvidence : []).some((oneLever) => {
					const classified = classifyOneLever(oneLever.lever);
					return classified !== null && classified.mutatesProductionData;
				}),
		);
	if (provenRowsWithoutADataLever.length > 0) {
		evidence(
			`PROVEN WITHOUT A DATA LEVER (${provenRowsWithoutADataLever.length}): ` +
				provenRowsWithoutADataLever.map((oneEntry) => oneEntry.label).join(' | '),
		);
	}
	check(LEDGER_GATE_LABELS[3], provenRowsWithoutADataLever.length === 0);
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
