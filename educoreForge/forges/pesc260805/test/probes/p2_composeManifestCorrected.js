#!/usr/bin/env node
'use strict';

// p2_composeManifestCorrected.js — LUNAR_PRISM (P2), 2026-08-17. RETAINED per O-7.
//
// THE CORRECTION of the four-forge manifest, under RULING P2-R3 item 2 and RULING P2-R4.
//
// WHY THIS IS A SIBLING OF p1_composeManifestFromReferences.js RATHER THAN AN EDIT OF IT — the same
// reasoning that file gives for being a sibling of p0b's, now applied to itself. That tool is the
// RETAINED EVIDENCE behind a figure that turned out to be WRONG. Editing it would make the wrong record
// unreproducible and would tidy the discrepancy out of the history, which the supervisor explicitly
// forbade: "I want the discrepancy visible in the record, not tidied out of it." So it stands untouched
// and this file supersedes it in the open.
//
// ============================ WHAT WENT WRONG, IN ONE PARAGRAPH ============================
// P1 reported c46991d1… as the PESC standardBase named mover and COMMITTED it (2f51a56, 27fa1ed). That
// id is real, was read from the store rather than a log, and every cross-check available at the time
// agreed with it. IT IS THE ID OF A VECTORLESS ARTIFACT. P1's re-forge ran `--vectorize=false` — chosen
// deliberately to make embedding spend zero BY CONSTRUCTION rather than by cache hit, which was the
// STRONGER safety guarantee — and the established lineage (db885ac4 → 045523dc) is vectorized
// throughout. THE SAFETY MEASURE CHANGED THE IDENTITY OF THE THING IT WAS PROTECTING.
//
// THE MECHANISM, which is the durable finding and outlives this phase:
//   • A block's refId is contentAddress.blockIdForText(blockText) — a content address over the block
//     TEXT, AND THE BLOCK TEXT CONTAINS THE EMBEDDINGS. [code fact] replayManager.js:297, :894
//   • pureLayerFingerprint's DROPPED_PROPERTY_NAME_LIST — which BOTH the supervisor and I cited as
//     proof that vectors cannot move an id — belongs to a DIFFERENT COMPUTATION. fingerprint.js's own
//     header says it "hashes an un-embedded pure output"; it is a change-detection proxy.
//   • TWO HASHES OVER ONE ARTIFACT ANSWERING DIFFERENT QUESTIONS. We cited the second while measuring
//     the first. They had never disagreed because nobody had ever run --vectorize=false in this order.
//   • A CONTENT ADDRESS IS ONLY COMPARABLE TO ANOTHER COMPUTED OVER THE SAME KIND OF CONTENT.
//
// ============================ RULING P2-R4, ENFORCED AND NOT MERELY DOCUMENTED ============================
// "A NAMED MOVER RECORDS THE BUILD MODE BESIDE THE ID … as a FIELD, in the same structure that carries
// the id, so a successor comparing two ids meets the flags without having to go looking."
//
// Every generation below therefore carries `buildMode` in the SAME OBJECT as its blockId — there is no
// generation entry that can exist without one. And the rule is GATED, not just recorded: composing a
// LINEAGE SUCCESSOR across two different build modes is REFUSED BY NAME (comparabilityRefusal). A
// ruling recorded as a comment is a number nobody has to read; a ruling that refuses is one nobody can
// ignore. The guard is OBSERVED FIRING on the superseded case below — it is not an unproven gate.
//
// Pure computation. No graph, no container, no store, no embedder, no network, no write.

const path = require('path');
const contentAddress = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'content-address', 'content-address'))();

const moduleName = 'p2_composeManifestCorrected';

const BUILD_MODE = { VECTORIZED: 'vectorize=true', VECTORLESS: 'vectorize=false' };

// The three non-PESC blocks. These are REFERENCES to existing immutable blocks and are all vectorized;
// their build mode is stated rather than assumed, because the whole lesson of this correction is that
// an unstated build mode is an unverifiable comparison.
const REFERENCE_BLOCK_REGISTRY = {
	ceds: { blockId: '09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9eacec765962fe487c33', position: 0, buildMode: BUILD_MODE.VECTORIZED },
	edfi: { blockId: 'aea6d8dfe7899adef57c5ac3adb6b0df2bfc7e4a4ae859c4fa3893c132c8b304', position: 1, buildMode: BUILD_MODE.VECTORIZED },
	sif: { blockId: 'd393b0406d08f613f3142711fca5a9f2b0c580e84c4bef3ffd6b18d4eaa2330a', position: 3, buildMode: BUILD_MODE.VECTORIZED },
};
const PESC_POSITION = 2;

// PESC in FOUR generations, each id written out IN FULL (an abbreviated id in a record is a number
// nobody can verify) and each carrying its BUILD MODE as a sibling field per RULING P2-R4.
const PESC_GENERATION_REGISTRY = {
	beforeReembed: {
		blockId: 'db885ac42b284135a37135a0fb95baf376547fe401530506cc321f36686a9e61',
		buildMode: BUILD_MODE.VECTORIZED,
		note: 'the frozen historical four-forge member',
	},
	afterReembed: {
		blockId: '045523dc197f4649712b74d3d6b995522106d44fa5c17c17d900205c4ee4a992',
		buildMode: BUILD_MODE.VECTORIZED,
		note: "P0b's measured member; the block P1's seat stamp actually succeeds",
	},
	afterSeatStampVECTORLESS: {
		blockId: 'c46991d127a3f36bd9bed9708c5701a12b0340497a90235372ef962913566d3f',
		buildMode: BUILD_MODE.VECTORLESS,
		note: 'SUPERSEDED AND RETAINED. Wrongly committed as the named mover in 2f51a56 and 27fa1ed. NOT a member of the vectorized lineage. Retained because it is the EVIDENCE for the mechanism, not despite being wrong.',
	},
	afterSeatStampVECTORIZED: {
		blockId: 'f139654a98cd0ef238759e6dc2bda2e532f13d5a7db00bfea94d89c3317b149d',
		buildMode: BUILD_MODE.VECTORIZED,
		note: 'THE CORRECT NAMED MOVER. Independently reproduced by THREE separate --vectorize=true runs.',
	},
};

// the historical manifests this method must reproduce before any new value it reports is believed
const FROZEN_HISTORICAL_MANIFEST = '97c618c20e07c0c612957def69164402d364a98d5dfee865faacae1deace6382';
const P0B_MEASURED_MANIFEST = '7e8372a2f342dffd5999e2e50e00bf69aa83f698ea980849f96ab568e42ab00a';
// the manifest computed from the VECTORLESS block and wrongly published. Reproducing it is the proof
// that THE TOOL WAS NEVER IN QUESTION — it was fed the wrong input and did exactly what it was asked.
const SUPERSEDED_PUBLISHED_MANIFEST = '96815028622ea722a5473fc1203654c2c8d9ac630755f08520319263300771e4';

// recipe order ceds, edfi, pesc260805, sif — positions 0-based, the convention p0b established by
// finding it is the ONLY one reproducing BOTH published ids (1-based and null each fail on both).
const membershipFor = (pescBlockId) =>
	Object.keys(REFERENCE_BLOCK_REGISTRY)
		.map((oneName) => ({ blockId: REFERENCE_BLOCK_REGISTRY[oneName].blockId, position: REFERENCE_BLOCK_REGISTRY[oneName].position }))
		.concat([{ blockId: pescBlockId, position: PESC_POSITION }])
		.sort((rowA, rowB) => rowA.position - rowB.position);

const manifestFor = (pescBlockId) => contentAddress.manifestKeyForMembership(membershipFor(pescBlockId));

// comparabilityRefusal — RULING P2-R4 AS A GATE. Returns a refusal STRING naming both build modes when
// a successor claim spans two of them, and '' when the claim is sound. It never throws and never
// silently proceeds: the caller must read the string, which is the point.
const comparabilityRefusal = ({ predecessorName, successorName }) => {
	const predecessor = PESC_GENERATION_REGISTRY[predecessorName];
	const successor = PESC_GENERATION_REGISTRY[successorName];
	if (!predecessor || !successor) {
		return `comparabilityRefusal: unknown generation '${!predecessor ? predecessorName : successorName}' — known generations: ${Object.keys(PESC_GENERATION_REGISTRY).join(', ')}. There is no default.`;
	}
	if (predecessor.buildMode !== successor.buildMode) {
		return (
			`REFUSED — INCOMPARABLE BUILD MODES. '${predecessorName}' was built ${predecessor.buildMode} and '${successorName}' was built ${successor.buildMode}. ` +
			'A block refId is a content address over block TEXT, and the text CONTAINS the embeddings, so two ids computed under different vectorisation flags ' +
			'are not two generations of one lineage — they are addresses of two different kinds of content. Naming one the successor of the other is the exact ' +
			'error this guard exists to prevent (RULING P2-R4).'
		);
	}
	return '';
};

// ---- METHOD VALIDATION. A method that cannot reproduce a KNOWN value has no business producing an
// unknown one. Three checks now, not two: the third reproduces the WRONG published value and thereby
// separates "the tool is broken" from "the tool was fed the wrong input".
const checkList = [
	{
		name: 'METHOD CHECK 1 — reproduces the FROZEN historical four-forge manifest from the pre-re-embed PESC block',
		computed: manifestFor(PESC_GENERATION_REGISTRY.beforeReembed.blockId),
		expected: FROZEN_HISTORICAL_MANIFEST,
	},
	{
		name: "METHOD CHECK 2 — reproduces P0b's MEASURED manifest from the post-re-embed PESC block",
		computed: manifestFor(PESC_GENERATION_REGISTRY.afterReembed.blockId),
		expected: P0B_MEASURED_MANIFEST,
	},
	{
		name: 'METHOD CHECK 3 — reproduces the SUPERSEDED PUBLISHED manifest from the VECTORLESS block. This is the check that exonerates the tool: the same pure function, the same membership convention, a different INPUT. The tool was never in question.',
		computed: manifestFor(PESC_GENERATION_REGISTRY.afterSeatStampVECTORLESS.blockId),
		expected: SUPERSEDED_PUBLISHED_MANIFEST,
	},
].map((oneCheck) => ({ ...oneCheck, pass: oneCheck.computed === oneCheck.expected }));

// ---- THE GUARD, OBSERVED IN BOTH STATES. An unfired gate is an unproven gate.
const guardObservation = {
	MUST_REFUSE_acrossBuildModes: comparabilityRefusal({ predecessorName: 'afterReembed', successorName: 'afterSeatStampVECTORLESS' }),
	MUST_PASS_withinVectorizedLineage: comparabilityRefusal({ predecessorName: 'afterReembed', successorName: 'afterSeatStampVECTORIZED' }),
	MUST_REFUSE_unknownGeneration: comparabilityRefusal({ predecessorName: 'afterReembed', successorName: 'noSuchGeneration' }),
};
const guardBehavedCorrectly =
	guardObservation.MUST_REFUSE_acrossBuildModes !== '' && guardObservation.MUST_PASS_withinVectorizedLineage === '' && guardObservation.MUST_REFUSE_unknownGeneration !== '';

const failedCheck = checkList.filter((oneCheck) => !oneCheck.pass)[0];

const report = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

if (failedCheck || !guardBehavedCorrectly) {
	report({
		probe: moduleName,
		verdict: 'REFUSED',
		reason: failedCheck
			? `${failedCheck.name} FAILED. No new manifest id is reported.`
			: 'THE COMPARABILITY GUARD DID NOT BEHAVE IN ALL THREE OBSERVED STATES. A guard that has not been seen refusing AND seen passing is unproven, and an unproven guard must not certify a correction.',
		checkList,
		guardObservation,
		assertionsReached: checkList.length + Object.keys(guardObservation).length,
	});
	process.exitCode = 1;
} else {
	report({
		probe: moduleName,
		verdict: 'METHOD VALIDATED ON THREE HISTORICAL VALUES AND THE COMPARABILITY GUARD OBSERVED IN BOTH STATES — the corrected id below is computed by the same pure function that reproduced all three.',
		assertionsReached: checkList.length + Object.keys(guardObservation).length,
		checkList: checkList.map((oneCheck) => ({ name: oneCheck.name, pass: oneCheck.pass })),
		guardObservation,

		CORRECTED_NAMED_MOVER: {
			cause:
				'RULING P1-R8 — the forge now stamps effectiveDescription / owningTypeName / proseSource so the MANDATORY rendering seat is reachable by a plugin declaration at all. Those properties participate in the block text, so the PESC block re-keys and the four-forge manifest follows.',
			pescBaseBlock: {
				before: { blockId: PESC_GENERATION_REGISTRY.afterReembed.blockId, buildMode: PESC_GENERATION_REGISTRY.afterReembed.buildMode },
				after: { blockId: PESC_GENERATION_REGISTRY.afterSeatStampVECTORIZED.blockId, buildMode: PESC_GENERATION_REGISTRY.afterSeatStampVECTORIZED.buildMode },
			},
			fourForgeManifest: {
				before: P0B_MEASURED_MANIFEST,
				after: manifestFor(PESC_GENERATION_REGISTRY.afterSeatStampVECTORIZED.blockId),
			},
			bothEndpointsShareABuildMode: comparabilityRefusal({ predecessorName: 'afterReembed', successorName: 'afterSeatStampVECTORIZED' }) === '',
		},

		SUPERSEDED_AND_RETAINED: {
			whatWasPublished: {
				pescBaseBlock: { blockId: PESC_GENERATION_REGISTRY.afterSeatStampVECTORLESS.blockId, buildMode: PESC_GENERATION_REGISTRY.afterSeatStampVECTORLESS.buildMode },
				fourForgeManifest: SUPERSEDED_PUBLISHED_MANIFEST,
			},
			publishedIn: ['commit 2f51a56339af6fc504c23825fbf430d6953ae10a', 'commit 27fa1ed', 'acceptanceCommands.jsonc', 'recipes/fourWithHubPescDerived.recipe.jsonc header', 'DEVLOG-P-pescBridge.md', "LUNAR_PRISM's CP-P1 report"],
			whyRetainedRatherThanDeleted:
				'Supervisor ruling P2-R3 item 4, overruling my instinct to discard. THAT ARTIFACT IS THE EVIDENCE FOR THE FINDING: its 81,517,933 bytes against the vectorized 88,551,726, and its zero embeddingRef rows, are what make the mechanism checkable by someone who trusts neither of us.',
			whyItWasNotDetectable:
				'Every cross-check available at CP-P1 agreed. The id was correct FOR THE ARTIFACT IT DESCRIBED and was read from the store rather than from a log. The lineage carries NO FIELD recording build mode, so nothing in the record could have revealed that two ids were addresses over different kinds of content. That absent field is what RULING P2-R4 adds.',
		},

		MUST_NOT_MOVE_AND_DO_NOT_BY_CONSTRUCTION: {
			...Object.keys(REFERENCE_BLOCK_REGISTRY).reduce((accumulator, oneName) => ({ ...accumulator, [oneName]: REFERENCE_BLOCK_REGISTRY[oneName] }), {}),
			why: 'These are REFERENCES to the existing immutable blocks. Exactly one membership element differs — position 2 — so nothing else CAN have moved. A construction, not an observation, and it needed no build.',
		},
	});
}
