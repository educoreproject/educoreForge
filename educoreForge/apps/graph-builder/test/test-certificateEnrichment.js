#!/usr/bin/env node
'use strict';

// test-certificateEnrichment.js — the gates for RULING R5, "validation certificates must name the
// base schema block they reference" (PLAN Phase 6; v1 Part Two, "The certificate gap").
//
// PROVES, three-state, every refusal observed RED before it was made to pass:
//   (a) ALL FOUR fields are produced from a well-formed input — baseBlockIdByToken READ from the
//       manifest's members, recipeTextHash naming its own algorithm, boltEndpoint taken from the
//       NESTED .graph.boltUrl, declaredTokens from the stage summary;
//   (b) THE FIRST REQUIRED TWIN — DROP ONE FIELD's source and the enrichment is REFUSED BY NAME and
//       enrichment is null. Run once per field, so no field can be silently optional;
//   (c) THE SECOND REQUIRED TWIN — alter the recipe file by ONE BYTE and recipeTextHash MOVES. The
//       control is that the unaltered file hashes to the same value twice, so a moving hash is a
//       measurement and not merely two different runs;
//   (d) THE THIRD REQUIRED TWIN — a manifest MEMBER MISSING for a declared token is REFUSED BY NAME,
//       never emitted as null and never omitted from the map;
//   (e) NEVER NULL-FILL — on any refusal the whole enrichment is null rather than partial, and no
//       emitted field ever holds null;
//   (f) the boltEndpoint reader reads the NESTED path and REFUSES a verdict that carries the value
//       only at the top level — the exact near-miss this phase hit while measuring;
//   (g) validators reporting DIFFERENT endpoints are refused: one certificate is a claim about ONE graph;
//   (h) an AMBIGUOUS base member (two standardBase blocks for one token) is refused, never guessed;
//   (i) the no-manifest case carries a NAMED ABSENCE, never null (a forge-only run certifies as before).
//
// Pure and hermetic: fixtures under os.tmpdir(), no store, no container, no LLM, no network.
// Run: node apps/graph-builder/test/test-certificateEnrichment.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the R5 certificate enrichment (a certificate names what it certified)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the four added certificate fields are produced from values in hand, and that each is
     REFUSED BY NAME rather than null-filled when its source is absent, ambiguous or unreadable.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const enrichmentLib = require('../lib/certificate-enrichment');

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfCertificateEnrichment-'));

// ---------------------------------------------------------------------
// fixtures — a well-formed world, and a maker so each twin alters exactly one thing
// ---------------------------------------------------------------------

const DECLARED_TOKEN_LIST = ['ceds', 'edfi'];
const BOLT_ENDPOINT_TEXT = 'bolt://localhost:7811';
const CEDS_BASE_REF_ID = '09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9eacec765962fe487c33';
const EDFI_BASE_REF_ID = 'aea6d8dfe7899adef57c5ac3adb6b0df2bfc7e4a4ae859c4fa3893c132c8b304';

const writeVerdict = (fileName, verdictObject) => {
	const filePath = path.join(scratchDir, fileName);
	fs.writeFileSync(filePath, JSON.stringify(verdictObject, null, 2));
	return filePath;
};

const recipeFilePath = path.join(scratchDir, 'wellFormed.recipe.jsonc');
fs.writeFileSync(recipeFilePath, '{ "name": "wellFormed", "bridges": [] }\n');

const cedsVerdictPath = writeVerdict('cedsVerdict.json', { graph: { boltUrl: BOLT_ENDPOINT_TEXT } });
const edfiVerdictPath = writeVerdict('edfiVerdict.json', { graph: { boltUrl: BOLT_ENDPOINT_TEXT } });

const wellFormedWorld = () => ({
	summary: { declaredTokens: DECLARED_TOKEN_LIST.slice() },
	declaredRowList: [
		{ token: 'ceds', verdictPath: cedsVerdictPath },
		{ token: 'edfi', verdictPath: edfiVerdictPath },
	],
	manifest: {
		refId: 'MANIFEST_UNDER_TEST',
		members: [
			{ schemaBlockRefId: CEDS_BASE_REF_ID, kind: 'standardBase', subject: 'ceds@14_0_0_0_base' },
			{ schemaBlockRefId: EDFI_BASE_REF_ID, kind: 'standardBase', subject: 'edfi@5_2_0_base' },
			{ schemaBlockRefId: 'RELATIONSHIP_BLOCK', kind: 'relationship', subject: 'ceds@14.0.0.0_rel_edfi@5.2.0_exact' },
		],
	},
	recipePath: recipeFilePath,
});

// ---------------------------------------------------------------------
// (a) the well-formed world — the control every twin below is measured against
// ---------------------------------------------------------------------

harness.section('SECTION 1 — a well-formed input yields ALL FOUR fields, and yields them from the right places');

const greenResult = enrichmentLib.buildCertificateEnrichment(wellFormedWorld());

harness.equal(
	'(a) a well-formed input REFUSES NOTHING',
	greenResult.refusalMessageList.join(' | '),
	'',
);
harness.equal(
	'(a) exactly the four declared fields are produced, in the registry order',
	greenResult.enrichment === null ? 'ENRICHMENT IS NULL' : Object.keys(greenResult.enrichment).join(','),
	'baseBlockIdByToken,recipeTextHash,boltEndpoint,declaredTokens',
);
harness.equal(
	'(a) baseBlockIdByToken holds the refId READ from the member, verbatim',
	greenResult.enrichment.baseBlockIdByToken.ceds,
	CEDS_BASE_REF_ID,
);
harness.equal(
	'(a) the RELATIONSHIP member contributes no token — only standardBase blocks are base blocks',
	Object.keys(greenResult.enrichment.baseBlockIdByToken).join(','),
	'ceds,edfi',
);
harness.equal(
	'(a) recipeTextHash NAMES ITS ALGORITHM in the value, so it cannot be mistaken for another digest',
	greenResult.enrichment.recipeTextHash.split(':')[0],
	enrichmentLib.RECIPE_HASH_ALGORITHM,
);
harness.equal(
	'(a) boltEndpoint is the endpoint the validators actually read',
	greenResult.enrichment.boltEndpoint,
	BOLT_ENDPOINT_TEXT,
);
harness.equal(
	'(a) declaredTokens is the stage summary list',
	greenResult.enrichment.declaredTokens.join(','),
	DECLARED_TOKEN_LIST.join(','),
);
harness.ok(
	'(e) NEVER NULL-FILL — no produced field holds null or undefined',
	Object.keys(greenResult.enrichment).every((oneFieldName) => greenResult.enrichment[oneFieldName] !== null && greenResult.enrichment[oneFieldName] !== undefined),
	JSON.stringify(greenResult.enrichment),
);

// ---------------------------------------------------------------------
// (b) TWIN ONE — drop each field's source in turn; each must be REFUSED BY NAME
// ---------------------------------------------------------------------

harness.section('SECTION 2 — TWIN ONE: DROP ONE FIELD → REFUSED BY NAME, enrichment null (run once per field)');

const dropScenarioList = [
	{
		fieldName: 'declaredTokens',
		mutate: (world) => { delete world.summary.declaredTokens; return world; },
		expectedFragment: "carries no 'declaredTokens' array",
	},
	{
		// ⟪RULING FJ-P6-1, second application⟫ the DROP that must refuse is a recipe that IS NAMED and
		// cannot be read — a defect. A recipe that was never LOCATED is a NAMED ABSENCE instead, because
		// actions.js already certifies a synthetic or foreign run directory by design; that case is
		// asserted separately in SECTION 8 rather than here.
		fieldName: 'recipeTextHash',
		mutate: (world) => { world.recipePath = path.join(scratchDir, 'thisRecipeDoesNotExist.recipe.jsonc'); return world; },
		expectedFragment: 'is not on disk',
	},
	{
		fieldName: 'boltEndpoint',
		mutate: (world) => { world.declaredRowList[0].verdictPath = path.join(scratchDir, 'thisVerdictDoesNotExist.json'); return world; },
		expectedFragment: 'has no readable verdict artifact',
	},
	{
		fieldName: 'baseBlockIdByToken',
		mutate: (world) => { world.manifest.members = world.manifest.members.filter((oneMember) => oneMember.subject.indexOf('ceds@') !== 0); return world; },
		expectedFragment: "declared token 'ceds' has NO standardBase member",
	},
];

dropScenarioList.forEach((oneScenario) => {
	const brokenResult = enrichmentLib.buildCertificateEnrichment(oneScenario.mutate(wellFormedWorld()));
	const refusalText = brokenResult.refusalMessageList.join(' | ');
	harness.ok(
		`RED-OBSERVED (b) dropping the source of '${oneScenario.fieldName}' is REFUSED BY NAME — the same input passed in SECTION 1, so this refusal is a measurement`,
		brokenResult.refusalMessageList.length > 0 && refusalText.indexOf(oneScenario.expectedFragment) !== -1,
		refusalText || 'NO REFUSAL — the field is silently optional',
	);
	harness.ok(
		`RED-OBSERVED (e) dropping '${oneScenario.fieldName}' yields enrichment NULL, never a PARTIAL object carrying the other three`,
		brokenResult.enrichment === null,
		JSON.stringify(brokenResult.enrichment),
	);
});

// ---------------------------------------------------------------------
// (c) TWIN TWO — one byte of the recipe file moves recipeTextHash
// ---------------------------------------------------------------------

harness.section('SECTION 3 — TWIN TWO: ONE ALTERED BYTE in the recipe file MOVES recipeTextHash');

const hashOfUnalteredFileFirstRead = enrichmentLib.readRecipeTextHash({ recipePath: recipeFilePath }).value;
const hashOfUnalteredFileSecondRead = enrichmentLib.readRecipeTextHash({ recipePath: recipeFilePath }).value;
harness.equal(
	'(c) CONTROL — the UNALTERED file hashes identically on two reads, so a moved hash below means the BYTES moved and not the reader',
	hashOfUnalteredFileFirstRead,
	hashOfUnalteredFileSecondRead,
);

const alteredRecipePath = path.join(scratchDir, 'alteredByOneByte.recipe.jsonc');
const originalRecipeBytes = fs.readFileSync(recipeFilePath);
const alteredRecipeBytes = Buffer.from(originalRecipeBytes);
// flip exactly one byte — 'wellFormed' becomes 'XellFormed'
alteredRecipeBytes[originalRecipeBytes.indexOf(Buffer.from('wellFormed'))] = 'X'.charCodeAt(0);
fs.writeFileSync(alteredRecipePath, alteredRecipeBytes);

harness.equal(
	'(c) CONTROL — the altered file differs from the original by EXACTLY ONE BYTE',
	String(alteredRecipeBytes.length === originalRecipeBytes.length && alteredRecipeBytes.reduce((soFar, oneByte, atIndex) => soFar + (oneByte === originalRecipeBytes[atIndex] ? 0 : 1), 0)),
	'1',
);
const hashOfAlteredFile = enrichmentLib.readRecipeTextHash({ recipePath: alteredRecipePath }).value;
harness.ok(
	'RED-OBSERVED (c) ONE altered byte MOVES recipeTextHash — a hash that did not move would certify a recipe that is not the one that ran',
	hashOfAlteredFile !== hashOfUnalteredFileFirstRead,
	`unaltered ${hashOfUnalteredFileFirstRead}\naltered   ${hashOfAlteredFile}`,
);

// ---------------------------------------------------------------------
// (d) TWIN THREE — a missing manifest member is REFUSED, not null
// ---------------------------------------------------------------------

harness.section('SECTION 4 — TWIN THREE: a MANIFEST MEMBER MISSING is REFUSED BY NAME, never null and never omitted');

const missingMemberWorld = wellFormedWorld();
missingMemberWorld.manifest.members = missingMemberWorld.manifest.members.filter((oneMember) => oneMember.subject.indexOf('edfi@') !== 0);
const missingMemberVerdict = enrichmentLib.readBaseBlockIdByToken({ manifest: missingMemberWorld.manifest, declaredTokenList: DECLARED_TOKEN_LIST });
harness.ok(
	"RED-OBSERVED (d) a declared token with no standardBase member is REFUSED BY NAME, naming the token and the manifest",
	typeof missingMemberVerdict.refusalMessage === 'string' && missingMemberVerdict.refusalMessage.indexOf("declared token 'edfi' has NO standardBase member") !== -1,
	missingMemberVerdict.refusalMessage || JSON.stringify(missingMemberVerdict),
);
harness.ok(
	'RED-OBSERVED (d) it yields NO value at all — not a map holding edfi: null, which would read as "measured and empty"',
	missingMemberVerdict.value === undefined,
	JSON.stringify(missingMemberVerdict.value),
);

harness.section('SECTION 5 — (h) an AMBIGUOUS base member is refused, never guessed');
const ambiguousManifest = {
	refId: 'AMBIGUOUS_MANIFEST',
	members: [
		{ schemaBlockRefId: CEDS_BASE_REF_ID, kind: 'standardBase', subject: 'ceds@14_0_0_0_base' },
		{ schemaBlockRefId: 'A_SECOND_CEDS_BASE', kind: 'standardBase', subject: 'ceds@13_0_0_0_base' },
	],
};
const ambiguousVerdict = enrichmentLib.readBaseBlockIdByToken({ manifest: ambiguousManifest, declaredTokenList: ['ceds'] });
harness.ok(
	'RED-OBSERVED (h) two standardBase members for one token is REFUSED — picking the first would certify a base block the build may not have used',
	typeof ambiguousVerdict.refusalMessage === 'string' && ambiguousVerdict.refusalMessage.indexOf('matches 2 standardBase members') !== -1,
	ambiguousVerdict.refusalMessage || JSON.stringify(ambiguousVerdict),
);

// ---------------------------------------------------------------------
// (f) and (g) — the boltEndpoint reader's two real hazards
// ---------------------------------------------------------------------

harness.section('SECTION 6 — (f) boltEndpoint is read NESTED at .graph.boltUrl; (g) disagreeing validators are refused');

const topLevelOnlyVerdictPath = writeVerdict('topLevelOnly.json', { boltUrl: BOLT_ENDPOINT_TEXT });
const topLevelOnlyVerdict = enrichmentLib.readBoltEndpoint({ declaredRowList: [{ token: 'ceds', verdictPath: topLevelOnlyVerdictPath }] });
harness.ok(
	'RED-OBSERVED (f) a verdict carrying boltUrl ONLY at the TOP LEVEL is REFUSED — the production artifacts nest it under .graph, and a reader that accepted either would mask a shape change',
	typeof topLevelOnlyVerdict.refusalMessage === 'string' && topLevelOnlyVerdict.refusalMessage.indexOf('carries no .graph.boltUrl') !== -1,
	topLevelOnlyVerdict.refusalMessage || JSON.stringify(topLevelOnlyVerdict),
);

const otherEndpointVerdictPath = writeVerdict('otherEndpoint.json', { graph: { boltUrl: 'bolt://localhost:7999' } });
const disagreeingVerdict = enrichmentLib.readBoltEndpoint({
	declaredRowList: [
		{ token: 'ceds', verdictPath: cedsVerdictPath },
		{ token: 'edfi', verdictPath: otherEndpointVerdictPath },
	],
});
harness.ok(
	'RED-OBSERVED (g) validators reporting DIFFERENT endpoints are REFUSED — one certificate is a claim about ONE graph and must not name several',
	typeof disagreeingVerdict.refusalMessage === 'string' && disagreeingVerdict.refusalMessage.indexOf('DIFFERENT bolt endpoints') !== -1,
	disagreeingVerdict.refusalMessage || JSON.stringify(disagreeingVerdict),
);

const unparseableVerdictPath = path.join(scratchDir, 'unparseable.json');
fs.writeFileSync(unparseableVerdictPath, '{ this is not json');
const unparseableVerdict = enrichmentLib.readBoltEndpoint({ declaredRowList: [{ token: 'ceds', verdictPath: unparseableVerdictPath }] });
harness.ok(
	'RED-OBSERVED (f) an UNPARSEABLE verdict is REFUSED BY NAME rather than throwing — unreadable evidence certifies nothing',
	typeof unparseableVerdict.refusalMessage === 'string' && unparseableVerdict.refusalMessage.indexOf('does not parse') !== -1,
	unparseableVerdict.refusalMessage || JSON.stringify(unparseableVerdict),
);

// ---------------------------------------------------------------------
// (i) the no-manifest case — a NAMED ABSENCE, never null
// ---------------------------------------------------------------------

harness.section('SECTION 7 — (i) a run that named NO MANIFEST carries a NAMED ABSENCE, never null');

const noManifestVerdict = enrichmentLib.readBaseBlockIdByToken({ manifest: null, declaredTokenList: DECLARED_TOKEN_LIST });
harness.equal(
	'(i) no manifest named → the field STATES that in words a promoter must read',
	noManifestVerdict.value,
	enrichmentLib.NO_MANIFEST_NAMED_TEXT,
);
harness.ok(
	'(i) and it is NOT null — a null would read as "there are no base blocks" rather than "they were never read"',
	noManifestVerdict.value !== null && noManifestVerdict.refusalMessage === undefined,
	JSON.stringify(noManifestVerdict),
);

harness.section('SECTION 8 — (j) an UNLOCATABLE recipe is a NAMED ABSENCE; a NAMED-but-unreadable one still REFUSES');

const unlocatableVerdict = enrichmentLib.readRecipeTextHash({ recipePath: null });
harness.equal(
	'(j) no recipe located → the field STATES that, so a synthetic or foreign run directory still certifies as actions.js documents',
	unlocatableVerdict.value,
	enrichmentLib.NO_RECIPE_LOCATED_TEXT,
);
harness.ok(
	'(j) and it is NOT a refusal — refusing here would revoke behaviour actions.js already supports by name',
	unlocatableVerdict.refusalMessage === undefined,
	JSON.stringify(unlocatableVerdict),
);
const namedButAbsentVerdict = enrichmentLib.readRecipeTextHash({ recipePath: path.join(scratchDir, 'namedButAbsent.recipe.jsonc') });
harness.ok(
	'RED-OBSERVED (j) a recipe that IS NAMED and is not on disk REFUSES BY NAME — the two absences are NOT the same, and only one of them is a defect',
	typeof namedButAbsentVerdict.refusalMessage === 'string' && namedButAbsentVerdict.refusalMessage.indexOf('is not on disk') !== -1,
	namedButAbsentVerdict.refusalMessage || JSON.stringify(namedButAbsentVerdict),
);

harness.note(`fixtures under ${scratchDir}`);
harness.report();
