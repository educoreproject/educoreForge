#!/usr/bin/env node
'use strict';

// p1_composeManifestFromReferences.js — LUNAR_PRISM (P1), 2026-08-17. RETAINED per O-7.
//
// THE RE-KEY, BY REFERENCE COMPOSITION — SABLE_RIVER's condition 2 on RULING P1-R8, which restates
// TQ's ruling of 2026-08-09: to certify a change in ONE standard, do NOT re-forge the others. Compose
// a manifest from REFERENCES to the existing blocks. Blocks are immutable and dedup on content
// address, so the unchanged standards are byte-identical to the blocks that produced their certified
// figures, and cross-standard regression becomes IMPOSSIBLE BY CONSTRUCTION rather than merely
// unobserved. A re-forge OBSERVES cleanliness; this CONSTRUCTS it — the stronger claim and the
// cheaper one. (The supervisor's own recorded correction: "I mistook expense for rigour.")
//
// manifestEditor's header, first paragraph — read the header, not the help text: the manifest refId
// IS contentAddress.manifestKeyForMembership over the membership, which "hashes schemaBlockRefId +
// position and NOTHING ELSE". So the id is a pure function and needs no build at all. THE REAL
// MODULE IS CALLED, never a reimplementation of its rule.
//
// WHY THIS IS A SIBLING OF p0b_composeManifestFromReferences.js RATHER THAN AN EDIT OF IT: that tool
// is the retained evidence behind figures already on the record. Editing it would make the record it
// supports unreproducible. It established the 0-based position convention; this inherits that result
// and adds ONE new member value.
//
// THE DISCIPLINE THAT MAKES THE ANSWER TRUSTWORTHY: it reproduces TWO HISTORICAL IDS FIRST — the
// frozen four-forge manifest from the OLD PESC block, and P0b's measured manifest from P0b's block —
// and REFUSES BY NAME if either fails. A method that cannot reproduce a known value has no business
// producing an unknown one.

const path = require('path');
const contentAddress = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'content-address', 'content-address'))();

const BLOCK = {
	ceds: '09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9eacec765962fe487c33',
	edfi: 'aea6d8dfe7899adef57c5ac3adb6b0df2bfc7e4a4ae859c4fa3893c132c8b304',
	sif: 'd393b0406d08f613f3142711fca5a9f2b0c580e84c4bef3ffd6b18d4eaa2330a',
	// PESC, in three generations. All three written out IN FULL: an abbreviated id in a record is a
	// number nobody can verify (P0b's own lesson, and SABLE_RIVER's condition 3).
	pescBeforeReembed: 'db885ac42b284135a37135a0fb95baf376547fe401530506cc321f36686a9e61',
	pescAfterReembed: '045523dc197f4649712b74d3d6b995522106d44fa5c17c17d900205c4ee4a992',
	pescAfterSeatStamp: 'c46991d127a3f36bd9bed9708c5701a12b0340497a90235372ef962913566d3f',
};

// the two historical manifests this method must reproduce before it is believed
const FROZEN_HISTORICAL_MANIFEST = '97c618c20e07c0c612957def69164402d364a98d5dfee865faacae1deace6382';
const P0B_MEASURED_MANIFEST = '7e8372a2f342dffd5999e2e50e00bf69aa83f698ea980849f96ab568e42ab00a';

// recipe order ceds, edfi, pesc260805, sif — positions 0-based, the convention p0b established by
// finding it is the ONLY one reproducing BOTH published ids (1-based and null each fail on both).
const membershipFor = (pescBlockId) => [
	{ blockId: BLOCK.ceds, position: 0 },
	{ blockId: BLOCK.edfi, position: 1 },
	{ blockId: pescBlockId, position: 2 },
	{ blockId: BLOCK.sif, position: 3 },
];

const manifestFor = (pescBlockId) => contentAddress.manifestKeyForMembership(membershipFor(pescBlockId));

const reproducedFrozen = manifestFor(BLOCK.pescBeforeReembed);
const reproducedP0b = manifestFor(BLOCK.pescAfterReembed);
const computedP1 = manifestFor(BLOCK.pescAfterSeatStamp);

const checkList = [
	{ name: 'METHOD CHECK 1 — reproduces the FROZEN historical four-forge manifest from the pre-re-embed PESC block', pass: reproducedFrozen === FROZEN_HISTORICAL_MANIFEST, computed: reproducedFrozen, expected: FROZEN_HISTORICAL_MANIFEST },
	{ name: "METHOD CHECK 2 — reproduces P0b's MEASURED manifest from the post-re-embed PESC block", pass: reproducedP0b === P0B_MEASURED_MANIFEST, computed: reproducedP0b, expected: P0B_MEASURED_MANIFEST },
];
const methodFailure = checkList.find((oneCheck) => !oneCheck.pass);

if (methodFailure) {
	process.stdout.write(`${JSON.stringify({
		probe: 'p1_composeManifestFromReferences',
		verdict: 'REFUSED',
		reason: `${methodFailure.name} FAILED. A method that cannot reproduce a KNOWN manifest id must not be trusted to produce an unknown one. No new id is reported.`,
		checkList,
	}, null, 2)}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write(`${JSON.stringify({
		probe: 'p1_composeManifestFromReferences',
		verdict: 'METHOD VALIDATED ON TWO HISTORICAL VALUES — the new id below is computed by the same pure function',
		checkList: checkList.map((oneCheck) => ({ name: oneCheck.name, pass: oneCheck.pass })),
		namedMover: {
			cause: 'RULING P1-R8 — the forge now stamps effectiveDescription / owningTypeName / proseSource so the MANDATORY rendering seat is reachable by a plugin declaration at all. New properties participate in the fingerprint (fingerprint.js:25 drops only _id, _source, embedding, embeddingModelVersion, stableId), so the PESC block re-keys and the four-forge manifest follows.',
			pescBaseBlock: { before: BLOCK.pescAfterReembed, after: BLOCK.pescAfterSeatStamp },
			fourForgeManifest: { before: P0B_MEASURED_MANIFEST, after: computedP1 },
		},
		MUST_NOT_MOVE_AND_DO_NOT_BY_CONSTRUCTION: {
			ceds: BLOCK.ceds,
			edfi: BLOCK.edfi,
			sif: BLOCK.sif,
			why: 'These are REFERENCES to the existing immutable blocks. Exactly one membership element differs — position 2 — so nothing else CAN have moved. This is a construction, not an observation, and it needed no build.',
		},
		historicalRecord: { pescBeforeReembed: BLOCK.pescBeforeReembed, frozenHistoricalManifest: FROZEN_HISTORICAL_MANIFEST },
	}, null, 2)}\n`);
}
