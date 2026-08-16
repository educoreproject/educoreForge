#!/usr/bin/env node
'use strict';

// test-goldEvalBridgeSibling.js — the gates for -goldEvalCheck's BRIDGE SIBLING (SPEC-bridgeFramework-v1.md §12
// item 7, BG-DEBUG (c) "goldEvalCheck's bridge sibling REFUSES a run whose relationship block contains an
// invalid-debug edge, naming the block"; RULING R5; B2 review ruling for B3; B3 order 2026-08-16).
//
// PROVES, three-state and with the twin as DATA:
//   (a) a manifest whose relationship block carries only lawful mapping edges AUDITS CLEAN (edge count reported,
//       zero invalid-debug, no refusal);
//   (b) THE TWIN — the same manifest with ONE edge stamped provenanceTier 'invalid-debug' (a production-INPUT
//       fault: a debug-judge block reaching the store) is REFUSED BY NAME — the block subject and the first
//       offender named — and, three-state, the SAME input against a sibling whose rule is disconnected (module
//       double: certificationCheck's refusal replaced by null) is NOT refused → the conjunct is observed RED;
//   (c) a manifest with ZERO relationship members is REPORTED (mappingBlockList []), never refused — a forge-only
//       manifest certifies as before;
//   (d) an ABSENT manifest, an ABSENT member block, and a block that does not deserialise are each REFUSED BY NAME.
//   (e) the PURE half maps a block edge's { source, id } ref to the endpoint stableId (the rule names offenders
//       by stableId, never "[object Object]").
//
// Runs against a THROWAWAY standardsDatabase under os.tmpdir(); never opens the configured support store; no
// container, no LLM, no Voyage. Run: node apps/graph-builder/test/test-goldEvalBridgeSibling.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for -goldEvalCheck's bridge sibling (invalid-debug edges never certify)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves, against a throwaway standardsDatabase, that the sibling audits a clean relationship block, REFUSES BY
     NAME a block carrying one invalid-debug edge (observed RED under a rule-disconnected module double), reports a
     manifest with no relationship blocks, and refuses absent / unreadable evidence by name.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfGoldEvalBridgeSibling-'));
const treeRoot = path.join(__dirname, '..', '..', '..');
const siblingModulePath = path.join(__dirname, '..', 'lib', 'gold-eval-bridge-sibling.js');
const certificationCheckPath = path.join(treeRoot, 'lib', 'bridge-framework', 'certificationCheck.js');

const sibling = require(siblingModulePath);
const replayBlockLib = require(path.join(treeRoot, 'lib', 'replay', 'replay-block'))();
const standardsDatabaseModule = require(path.join(treeRoot, 'lib', 'standards-database', 'standards-database'));
const moduleDouble = require(path.join(treeRoot, 'lib', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const vocabularyLib = require(path.join(treeRoot, 'lib', 'vocabulary', 'vocabulary'));

const { PROVENANCE_TIER } = vocabularyLib;

// ---------------------------------------------------------------------
// fixtures — a tiny relationship block in the harvest's own PG-JSONL shape (every property a one-element list)
// ---------------------------------------------------------------------
const SOURCE_NAME = 'ToyStd';
const HUB_NAME = 'ToyHub';
const RELATIONSHIP_HEADER = {
	blockType: 'relationship',
	pairA: 'toy',
	pairB: 'toyhub',
	pairAVersion: '1.0',
	pairBVersion: '1.0',
	stableUriPropertyName: 'stableId',
	resolutionKey: 'stableId',
	embeddingModelVersion: 'none',
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: 0,
};
const nodeLineFor = ({ source, stableId }) => ({ ref: { source, id: stableId }, labels: ['BridgedRelation_TOY_TOYHUB'], stableId, properties: { stableId: [stableId] } });
const edgeLineFor = ({ fromStableId, toStableId, provenanceTier }) => ({
	type: 'EXACT_MATCH',
	fromRef: { source: SOURCE_NAME, id: fromStableId },
	toRef: { source: HUB_NAME, id: toStableId },
	properties: { provenanceTier: [provenanceTier], matchBasis: ['crosswalk'], resolution: ['specified'], predicate: ['exactMatch'], decisionBlockHash: ['0'.repeat(64)] },
});
const relationshipBlockTextFor = ({ tierList }) => {
	const nodes = [nodeLineFor({ source: SOURCE_NAME, stableId: 'toy:property/A.one' }), nodeLineFor({ source: SOURCE_NAME, stableId: 'toy:property/A.two' }), nodeLineFor({ source: HUB_NAME, stableId: 'urn:toyhub:P000001' }), nodeLineFor({ source: HUB_NAME, stableId: 'urn:toyhub:P000002' })];
	const edges = tierList.map((oneTier, oneIndex) => edgeLineFor({ fromStableId: `toy:property/A.${oneIndex === 0 ? 'one' : 'two'}`, toStableId: `urn:toyhub:P00000${oneIndex + 1}`, provenanceTier: oneTier }));
	return replayBlockLib.serializeBlock({ header: RELATIONSHIP_HEADER, nodes, edges });
};
const STANDARD_BASE_TEXT = replayBlockLib.serializeBlock({ header: { ...RELATIONSHIP_HEADER, blockType: 'standardBase', standardKey: 'toy', version: '1.0' }, nodes: [nodeLineFor({ source: SOURCE_NAME, stableId: 'toy:property/A.one' })], edges: [] });

const CLEAN_TEXT = relationshipBlockTextFor({ tierList: [PROVENANCE_TIER.SPEC_AUTHORITATIVE, PROVENANCE_TIER.SPEC_AUTHORITATIVE] });
const DEBUG_TEXT = relationshipBlockTextFor({ tierList: [PROVENANCE_TIER.SPEC_AUTHORITATIVE, PROVENANCE_TIER.INVALID_DEBUG] });

// ---------------------------------------------------------------------
// SECTION 0 — the PURE half (e): a block edge's ref maps to the endpoint stableId
// ---------------------------------------------------------------------
harness.section('SECTION 0 — the pure half: refs map to stableIds; the debug edge is counted and named');
const cleanAudit = sibling.auditMappingBlockText({ blockText: CLEAN_TEXT, subject: 'toy_rel_toyhub' });
harness.equal('clean block: 2 edges', cleanAudit.edgeCount, 2);
harness.equal('clean block: 0 invalid-debug', cleanAudit.invalidDebugEdgeCount, 0);
harness.ok('clean block: no refusal', cleanAudit.refusalMessage === null, cleanAudit.refusalMessage);
const debugAudit = sibling.auditMappingBlockText({ blockText: DEBUG_TEXT, subject: 'toy_rel_toyhub' });
harness.equal('debug block: 1 invalid-debug counted', debugAudit.invalidDebugEdgeCount, 1);
harness.match('debug block: refused naming the block', debugAudit.refusalMessage || '', /toy_rel_toyhub/);
harness.match('debug block: the offender is named by STABLEID (from -[type]-> to), not [object Object]', debugAudit.refusalMessage || '', /toy:property\/A\.two -\[EXACT_MATCH\]-> urn:toyhub:P000002/);
harness.match('an empty block text is refused by name', sibling.auditMappingBlockText({ blockText: '', subject: 'x' }).refusalMessage || '', /has no text/);
harness.match('a block that does not deserialise is refused by name', sibling.auditMappingBlockText({ blockText: '{"kind":"header","blockType":"relationship"}\n{"kind":"mystery"}\n', subject: 'x' }).refusalMessage || '', /does not deserialise/);

// ---------------------------------------------------------------------
// SECTIONS 1–3 need a store: build the throwaway database with three manifests
// ---------------------------------------------------------------------
const databaseFilePath = path.join(scratchDir, 'sibling.standardsDatabase.sqlite3');
const finish = () => {
	harness.report();
};

// runGates is declared BEFORE open() is called: the store's callbacks fire synchronously (better-sqlite3), so a
// gate function declared after the call would still be in its temporal dead zone when the callback reaches it
const runGates = ({ standardsDatabase, cleanManifestRefId, debugManifestRefId, forgeOnlyManifestRefId }) => {
	harness.section('SECTION 1 — (a) a clean relationship block audits clean; (c) a forge-only manifest is reported, not refused');
	sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: cleanManifestRefId }, (cleanError, cleanResult) => {
		harness.ok('clean manifest: no error', !cleanError, cleanError);
		harness.equal('clean manifest: 2 members', cleanResult && cleanResult.memberCount, 2);
		harness.equal('clean manifest: ONE relationship block audited', cleanResult && cleanResult.mappingBlockList.length, 1);
		harness.equal('clean manifest: 2 edges', cleanResult && cleanResult.mappingBlockList[0].edgeCount, 2);
		harness.equal('clean manifest: 0 refusals', cleanResult && cleanResult.refusalMessageList.length, 0);
		sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: forgeOnlyManifestRefId }, (forgeOnlyError, forgeOnlyResult) => {
			harness.ok('forge-only manifest: no error', !forgeOnlyError, forgeOnlyError);
			harness.equal('forge-only manifest: ZERO relationship blocks REPORTED (mappingBlockList [])', forgeOnlyResult && forgeOnlyResult.mappingBlockList.length, 0);
			harness.equal('forge-only manifest: 0 refusals', forgeOnlyResult && forgeOnlyResult.refusalMessageList.length, 0);

			harness.section('SECTION 2 — (b) THE TWIN: one invalid-debug edge → REFUSED BY NAME; three-state RED under a rule-disconnected double');
			sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: debugManifestRefId }, (debugError, debugResult) => {
				harness.ok('debug manifest: the audit itself completes (the refusal is a RESULT, not a crash)', !debugError, debugError);
				harness.equal('debug manifest: exactly ONE refusal', debugResult && debugResult.refusalMessageList.length, 1);
				harness.match('debug manifest: the refusal names the BLOCK', (debugResult && debugResult.refusalMessageList[0]) || '', /toy@1_0_rel_toyhub@1_0_debug_exact/);
				harness.match('debug manifest: the refusal names the tier and the offender', (debugResult && debugResult.refusalMessageList[0]) || '', /invalid-debug.*toy:property\/A\.two -\[EXACT_MATCH\]-> urn:toyhub:P000002/);
				harness.equal('debug manifest: invalidDebugEdgeCount 1 on the audited block', debugResult && debugResult.mappingBlockList[0].invalidDebugEdgeCount, 1);

				// THREE-STATE: the SAME debug input through a sibling whose RULE is disconnected (production mutation of
				// certificationCheck.js compiled in memory) is NOT refused → the conjunct is observed RED, so the green
				// above is the rule biting and not the fixture failing for another reason
				const disconnectedSibling = moduleDouble.loadWithMutations({
					modulePath: siblingModulePath,
					mutationList: [{ modulePath: certificationCheckPath, find: 'if (offenderList.length === 0) {', replace: 'if (offenderList.length >= 0) {' }],
				});
				disconnectedSibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: debugManifestRefId }, (redError, redResult) => {
					harness.ok('RED-OBSERVED — with the rule disconnected the debug manifest is NOT refused (0 refusals)', !redError && redResult && redResult.refusalMessageList.length === 0, redError || (redResult && redResult.refusalMessageList.join(' | ')));
					harness.equal('  (the double still COUNTS the debug edge — only the refusal was disconnected, so the red is the rule\'s, not the reader\'s)', redResult && redResult.mappingBlockList[0].invalidDebugEdgeCount, 1);

					harness.section('SECTION 3 — (d) absent evidence is refused by name');
					sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: 'no-such-manifest' }, (absentError) => {
						harness.match('an ABSENT manifest is refused by name', absentError || '', /manifest no-such-manifest is ABSENT/);
						sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: '' }, (blankError) => {
							harness.match('a BLANK manifestRefId is refused by name', blankError || '', /manifestRefId is REQUIRED/);
							sibling.auditManifestMappingBlocks({ standardsDatabase: null, manifestRefId: cleanManifestRefId }, (noStoreError) => {
								harness.match('a missing store is refused by name', noStoreError || '', /OPEN standardsDatabase/);
								finish();
							});
						});
					});
				});
			});
		});
	});
};

standardsDatabaseModule().open({ databaseFilePath }, (openError, standardsDatabase) => {
	harness.ok('the throwaway store opens', !openError, openError);
	if (openError) {
		finish();
		return;
	}
	const saveRelationship = ({ text, subject }, callback) => standardsDatabase.saveBlock({ text, kind: 'relationship', subject, version: '1.0', requires: [], producedBy: moduleName }, callback);
	standardsDatabase.saveBlock({ text: STANDARD_BASE_TEXT, kind: 'standardBase', subject: 'toy@1_0_base', version: '1.0', requires: [], producedBy: moduleName }, (baseError, baseSaved) => {
		harness.ok('the standardBase block saves', !baseError, baseError);
		saveRelationship({ text: CLEAN_TEXT, subject: 'toy@1_0_rel_toyhub@1_0_exact' }, (cleanError, cleanSaved) => {
			harness.ok('the CLEAN relationship block saves', !cleanError, cleanError);
			saveRelationship({ text: DEBUG_TEXT, subject: 'toy@1_0_rel_toyhub@1_0_debug_exact' }, (debugError, debugSaved) => {
				harness.ok('the DEBUG relationship block saves (the store does not police tiers — the sibling does)', !debugError, debugError);
				const memberFor = (saved, position) => ({ schemaBlockRefId: saved.refId, position, description: 'fixture member' });
				standardsDatabase.saveManifest({ name: 'clean', description: 'clean fixture', recipeName: 'fixture', recipeHash: 'x', recipeFileName: 'x', basedOnManifestRefId: null, members: [memberFor(baseSaved, 0), memberFor(cleanSaved, 1)] }, (cleanManifestError, cleanManifest) => {
					harness.ok('the CLEAN manifest saves', !cleanManifestError, cleanManifestError);
					standardsDatabase.saveManifest({ name: 'debug', description: 'debug fixture', recipeName: 'fixture', recipeHash: 'y', recipeFileName: 'y', basedOnManifestRefId: null, members: [memberFor(baseSaved, 0), memberFor(debugSaved, 1)] }, (debugManifestError, debugManifest) => {
						harness.ok('the DEBUG manifest saves', !debugManifestError, debugManifestError);
						standardsDatabase.saveManifest({ name: 'forgeOnly', description: 'no relationship member', recipeName: 'fixture', recipeHash: 'z', recipeFileName: 'z', basedOnManifestRefId: null, members: [memberFor(baseSaved, 0)] }, (forgeOnlyError, forgeOnlyManifest) => {
							harness.ok('the FORGE-ONLY manifest saves', !forgeOnlyError, forgeOnlyError);
							runGates({ standardsDatabase, cleanManifestRefId: cleanManifest.refId, debugManifestRefId: debugManifest.refId, forgeOnlyManifestRefId: forgeOnlyManifest.refId, cleanBlockRefId: cleanSaved.refId });
						});
					});
				});
			});
		});
	});
});

