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
//       by stableId, never "[object Object]");
//   (f) THE VERB — -goldEvalCheck itself (actions.js, in-process with a replaced process.global): a run directory
//       whose RECIPE DECLARES bridges[] and no --manifestRefId → REFUSED BY NAME (SABLE_RIVER's tightening at the B3
//       freeze: a bridged build never certifies on the forge round trip alone); the same directory WITH
//       --manifestRefId naming a manifest whose relationship block is clean → PASS with scope
//       forgeRoundTripAndMappingEdges; naming the DEBUG manifest → REFUSED naming the block.
//       ⟪CHANGED JOB 6b⟫ this header used to continue: "a forge-only recipe → PASS with scope
//       forgeRoundTripOnly and the bridge declaration stated; … the declared-bridges check disconnected
//       answers PASS on the bridged directory → RED". BOTH ARE NOW FALSE. --manifestRefId is REQUIRED
//       and its absence refuses, so there is no forge-only PASS and no 'forgeRoundTripOnly' scope; and
//       (f)/(g) are reframed TWO-SIDED — cutting a check removes ITS fingerprint while conservation
//       refuses behind it, rather than yielding a PASS. Corrected in place; this copy was found only by
//       grepping the fact's phrases across the tree, after the same sentence had been fixed in help.js
//       and actions.js and twice declared fully found.
//   (g) RULING BR3-5: a recipe whose `bridges` key is present and NOT an array → REFUSED by name; disconnected → PASS/0 → RED.
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
const bridgeTwinFactories = require(path.join(treeRoot, 'lib', 'bridge-framework', 'test', 'testSupport', 'bridgeTwinFactories'));
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

// ---------------------------------------------------------------------
// SECTION 4 — (f) the VERB: -goldEvalCheck through actions.js in-process (process.global replaced per drive)
// ---------------------------------------------------------------------
const actionsModulePath = path.join(__dirname, '..', 'lib', 'actions.js');
const roundTripStageStatics = require(path.join(__dirname, '..', 'lib', 'round-trip-stage'));
// a synthetic run directory named for a recipe: <recipeName>_<stamp>, carrying a clean stage summary (one declared
// validator, ran, inventedTotal 0, verdict present) — the forge half PASSES so the bridge half is what decides
// ⟪JOB 6b RESTORE⟫ the count a recipe DECLARES, read through the HOUSE loader — the same module and
// call actions.js makes — so a literal can never drift from the recipe and a second jsonc parser never
// exists to disagree with the first.
const recipeLibForCounts = require(path.join(__dirname, '..', 'lib', 'recipe'))();
const declaredBridgeCountOf = (recipeName) => {
	const loaded = recipeLibForCounts.loadRecipe(path.join(__dirname, '..', '..', '..', 'recipes', `${recipeName}.recipe.jsonc`));
	if (loaded.error) { throw new Error(`declaredBridgeCountOf('${recipeName}'): ${loaded.error}`); }
	return (loaded.recipe.bridges || []).length;
};

const runDirFor = ({ recipeName }) => {
	const runDirPath = path.join(scratchDir, `${recipeName}_20260816-140000`);
	const stageDirPath = path.join(runDirPath, roundTripStageStatics.STAGE_SUBDIR_NAME);
	const verdictDirPath = path.join(stageDirPath, 'toy');
	fs.mkdirSync(verdictDirPath, { recursive: true });
	const verdictPath = path.join(verdictDirPath, roundTripStageStatics.VERDICT_FILE_NAME);
	// ⟪PHASE 6, R5⟫ `graph.boltUrl` is part of the REAL verdict artifact's shape — measured present in
	// every roundTripVerdict.json in the build record back to the R4 anchor (2026-08-16), all four
	// tokens. This fixture omitted it, which made it a MODEL OF THE ARTIFACT THAT THE ARTIFACT DOES NOT
	// MATCH; -goldEvalCheck now reads the endpoint from there so the certificate can name where the
	// round trip ran. Added to the FIXTURE rather than softened in the reader: no real build dir in the
	// record lacks the field, so tolerating its absence would only ever excuse a synthetic one.
	fs.writeFileSync(verdictPath, JSON.stringify({ roundTripClean: true, inventedTotal: 0, lostTotal: 0, graph: { boltUrl: 'bolt://localhost:7999' } }));
	fs.writeFileSync(path.join(stageDirPath, roundTripStageStatics.STAGE_SUMMARY_FILE_NAME), JSON.stringify({ stageRan: true, disposition: 'ran', containerName: 'DEV_fixture', declaredTokens: ['toy'], absentTokens: [], standards: [{ token: 'toy', standardName: 'Toy', disposition: 'declared', ran: true, roundTripClean: true, inventedTotal: 0, lostTotal: 0, contentGapTotal: 0, explicitlyOmittedTotal: 0, semanticValidationLimit: 'fixture', snapshotDirPath: scratchDir, verdictPath }] }));
	return runDirPath;
};
// ⟪JOB 6b⟫ mintConservationArtifacts — give a FIXTURE run directory the conservation artifacts a real
// build would have written, so -goldEvalCheck's conservation audit has something to read.
//
// REAL-SHAPED, NOT A STUB THAT ALWAYS READS PASS. Every field is read from the block the manifest
// ACTUALLY names: the refId is the stored block's own content address, the subject is its stored
// subject, and the counts come from counting the block text's node and edge lines. A fixture that
// fabricated a PASS against invented ids would pass no matter what the gate did — which is the defect
// this campaign documents, installed in the place meant to detect it.
//
// SYNCHRONOUS, and deliberately so: this file already depends on better-sqlite3's callbacks firing
// synchronously (see the note above runGates), and taking a callback here would nest three more levels
// into an already deep chain for no gain. Returns a refusal string, or null.
const mintConservationArtifacts = ({ standardsDatabase, manifestRefId, runDirPath }) => {
	let refusal = null;
	standardsDatabase.getManifest({ refId: manifestRefId }, (manifestError, manifest) => {
		if (manifestError || !manifest) {
			refusal = `mintConservationArtifacts: getManifest ${manifestRefId}: ${manifestError || 'absent'}`;
			return;
		}
		const conservationDirPath = path.join(runDirPath, 'conservation');
		fs.mkdirSync(conservationDirPath, { recursive: true });
		(manifest.members || []).forEach((oneMember) => {
			standardsDatabase.getBlock({ refId: oneMember.schemaBlockRefId }, (blockError, blockRow) => {
				if (blockError || !blockRow) {
					refusal = `mintConservationArtifacts: getBlock ${oneMember.schemaBlockRefId}: ${blockError || 'absent'}`;
					return;
				}
				const lineList = String(blockRow.text).split('\n').filter((oneLine) => oneLine.trim() !== '');
				const countOfKind = (kindName) => lineList.filter((oneLine) => oneLine.indexOf(`"kind":"${kindName}"`) !== -1 || oneLine.indexOf(`"kind": "${kindName}"`) !== -1).length;
				const nodeCount = countOfKind('node');
				const edgeCount = countOfKind('edge');
				fs.writeFileSync(path.join(conservationDirPath, `${oneMember.schemaBlockRefId}.json`), `${JSON.stringify({
					verdict: 'PASS', graphName: 'DEV_fixture',
					loadedEdgeTotal: edgeCount, loadedEdgeDistinct: edgeCount, harvestedEdgeDistinct: edgeCount,
					loadedNodeDistinct: nodeCount, harvestedNodeDistinct: nodeCount,
					duplicateEdgeCount: 0, duplicateNodeCount: 0,
					blockRefId: oneMember.schemaBlockRefId, blockSubject: oneMember.subject,
				}, null, 2)}\n`);
			});
		});
	});
	return refusal;
};

const driveGoldEvalCheck = ({ actionsFactory, values }, callback) => {
	const originalGlobal = process.global;
	const replacement = { xLog: originalGlobal.xLog, getConfig: () => ({}), commandLineParameters: { switches: {}, values, fileList: [] }, rawConfig: {} };
	delete process.global;
	process.global = replacement;
	actionsFactory().goldEvalCheck((verdictError, verdict) => {
		delete process.global;
		process.global = originalGlobal;
		callback(verdictError, verdict);
	});
};
const goldEvalCheckGates = ({ standardsDatabase, cleanManifestRefId, debugManifestRefId, forgeOnlyManifestRefId, finish }) => {
	harness.section('SECTION 4 — (f) the VERB -goldEvalCheck: a bridged recipe without the sibling REFUSES BY NAME; with it, PASS/REFUSED by the audit');
	const bridgedRunDirPath = runDirFor({ recipeName: 'fourWithHubEdfiBridge' }); // recipes/fourWithHubEdfiBridge.recipe.jsonc declares ONE bridge
	const forgeOnlyRunDirPath = runDirFor({ recipeName: 'fourWithHub' }); // recipes/fourWithHub.recipe.jsonc declares bridges: []
	// ⟪JOB 6b⟫ the fixtures get the conservation artifacts a real build writes. BOTH manifests driven
	// against the bridged directory are minted; the forge-only manifest is minted into its OWN directory.
	// An artifact for a member of a manifest not under audit is simply never looked up.
	harness.ok('    the bridged fixture run dir is given REAL-SHAPED conservation artifacts (CLEAN manifest)', !mintConservationArtifacts({ standardsDatabase, manifestRefId: cleanManifestRefId, runDirPath: bridgedRunDirPath }));
	// the clean manifest itself, held for the negative below (better-sqlite3 callbacks are synchronous)
	let cleanManifestForNegative = null;
	standardsDatabase.getManifest({ refId: cleanManifestRefId }, (readError, readManifest) => { cleanManifestForNegative = readManifest; });
	harness.ok('    …and for the DEBUG manifest', !mintConservationArtifacts({ standardsDatabase, manifestRefId: debugManifestRefId, runDirPath: bridgedRunDirPath }));
	harness.ok('    …and the forge-only run dir for the FORGE-ONLY manifest', !mintConservationArtifacts({ standardsDatabase, manifestRefId: forgeOnlyManifestRefId, runDirPath: forgeOnlyRunDirPath }));
	const realActions = () => require(actionsModulePath)();
	driveGoldEvalCheck({ actionsFactory: realActions, values: { buildLogDirPath: [bridgedRunDirPath] } }, (bridgedError) => {
		harness.match('(f) a run dir whose recipe DECLARES bridges[] and no --manifestRefId → REFUSED BY NAME (bridges declared; mapping edges uncertified)', bridgedError || '', /DECLARES 1 bridge\(s\); mapping edges UNCERTIFIED/);
		// the OTHER side of the two-sided pair: with the check CONNECTED the bridge refusal fires FIRST,
		// so the conservation message must NOT appear. Without this the disconnected assertion below could
		// pass while both messages were present all along.
		harness.ok('(f) … and the CONSERVATION message is absent while the bridge check is connected (it refuses first)', !/CONSERVATION UNCERTIFIED without --manifestRefId/.test(bridgedError || ''), bridgedError);
		driveGoldEvalCheck({ actionsFactory: realActions, values: { buildLogDirPath: [forgeOnlyRunDirPath] } }, (forgeOnlyError, forgeOnlyVerdict) => {
			// ⟪CHANGED BY JOB 6b — the CONTRACT moved, so the assertion moved with it, and is not deleted.⟫
			// These three formerly asserted that a forge-only recipe WITHOUT --manifestRefId answers PASS
			// with scope 'forgeRoundTripOnly'. That was honest for the BRIDGE sibling — a forge-only build
			// has no mapping edges to certify — but the CONSERVATION audit has no such honest partial scope:
			// EVERY build harvests blocks. So the check REFUSES rather than narrows. Kept as a refusal
			// assertion rather than removed, because a deleted assertion leaves no record that the contract
			// ever said otherwise.
			harness.match(
				'    a forge-only recipe (bridges: []) without --manifestRefId → REFUSED BY NAME (JOB 6b replaced the forgeRoundTripOnly narrowing)',
				forgeOnlyError || '',
				/CONSERVATION UNCERTIFIED without --manifestRefId/,
			);
			driveGoldEvalCheck({ actionsFactory: realActions, values: { buildLogDirPath: [bridgedRunDirPath], manifestRefId: [cleanManifestRefId], standardsDatabaseFilePath: [databaseFilePath] } }, (cleanError, cleanVerdict) => {
				harness.ok('    the bridged run dir WITH --manifestRefId naming a CLEAN manifest → PASS', !cleanError && cleanVerdict && cleanVerdict.exitCode === 0, cleanError);
				const cleanPayload = cleanVerdict ? JSON.parse(cleanVerdict.resultText) : {};
				harness.equal('    … with scope forgeRoundTripAndMappingEdges', cleanPayload.scope, 'forgeRoundTripAndMappingEdges');
				harness.equal('    … one relationship block audited, 2 edges', cleanPayload.bridgeSibling && cleanPayload.bridgeSibling.mappingBlockList[0] && cleanPayload.bridgeSibling.mappingBlockList[0].edgeCount, 2);
				// ⟪JOB 6b RESTORE⟫ THE BRIDGE-DECLARATION WITNESS, lost at 243c3c9 and restored here.
				// The removed assertion ('… and the bridge declaration stated (0 bridges, recipe known)')
				// rode on the forge-only PASS that JOB 6b deleted, and NOTHING replaced it — the suite's
				// total rose 45 → 54 while this witness vanished, which is how a healthy aggregate hides a
				// missing member. Restored on BOTH surviving PASS payloads, counts READ from the recipes.
				harness.ok('    … and the bridge declaration is STATED on the payload (recipe known)', cleanPayload.bridgeDeclaration && cleanPayload.bridgeDeclaration.known === true, JSON.stringify(cleanPayload.bridgeDeclaration));
				harness.equal('    … with the count the BRIDGED recipe actually declares (read from the recipe, not a literal)', cleanPayload.bridgeDeclaration && cleanPayload.bridgeDeclaration.bridgeCount, declaredBridgeCountOf('fourWithHubEdfiBridge'));
				// ⟪JOB 6b NEGATIVE⟫ WITHOUT THIS, THE PASS ABOVE IS A SILENCE. Strip ONE artifact and the same
				// CLEAN manifest must refuse BY NAME — proof the audit reads these files rather than passing
				// because nothing looked. Restored immediately so later assertions see the fixture intact.
				// ⟪JOB 6b NEGATIVE⟫ WITHOUT THIS, THE PASS ABOVE IS A SILENCE. Strip ONE artifact and the same
				// CLEAN manifest must refuse BY NAME — proof the audit reads these files rather than passing
				// because nothing looked. Driven against the AUDIT MODULE rather than re-entering
				// driveGoldEvalCheck: that helper swaps process.global and restores it in its callback, so
				// re-entering it from inside another of its callbacks corrupts the state the outer chain
				// depends on (measured — it looped). The audit is the thing under test here either way.
				const strippedDirPath = path.join(bridgedRunDirPath, 'conservation');
				const strippedPath = path.join(strippedDirPath, fs.readdirSync(strippedDirPath)[0]);
				const strippedText = fs.readFileSync(strippedPath);
				fs.unlinkSync(strippedPath);
				const strippedAudit = require(path.join(__dirname, '..', 'lib', 'gold-eval-conservation')).auditConservationForManifest({ manifest: cleanManifestForNegative, buildLogDirPath: bridgedRunDirPath });
				harness.equal('    … and with ONE artifact REMOVED the same CLEAN manifest REFUSES (so the PASS above is a measurement)', strippedAudit.refusalMessageList.length, 1);
				harness.match('    … refusing BY NAME, naming the member and the missing path', strippedAudit.refusalMessageList[0] || '', /has NO conservation artifact at/);
				fs.writeFileSync(strippedPath, strippedText);
				harness.equal('    … and restored byte-for-byte the same manifest certifies again', require(path.join(__dirname, '..', 'lib', 'gold-eval-conservation')).auditConservationForManifest({ manifest: cleanManifestForNegative, buildLogDirPath: bridgedRunDirPath }).refusalMessageList.length, 0);
				driveGoldEvalCheck({ actionsFactory: realActions, values: { buildLogDirPath: [bridgedRunDirPath], manifestRefId: [debugManifestRefId], standardsDatabaseFilePath: [databaseFilePath] } }, (debugError) => {
					harness.match('    the bridged run dir naming the DEBUG manifest → REFUSED naming the block and the tier', debugError || '', /invalid-debug/);
					driveGoldEvalCheck({ actionsFactory: realActions, values: { buildLogDirPath: [forgeOnlyRunDirPath], manifestRefId: [forgeOnlyManifestRefId], standardsDatabaseFilePath: [databaseFilePath] } }, (zeroError, zeroVerdict) => {
						const zeroPayload = zeroVerdict ? JSON.parse(zeroVerdict.resultText) : {};
						harness.ok('    a manifest with ZERO relationship blocks → PASS, mappingBlockList [] REPORTED', !zeroError && zeroPayload.bridgeSibling && zeroPayload.bridgeSibling.mappingBlockList.length === 0, zeroError);
						// ⟪JOB 6b RESTORE⟫ the ZERO-BRIDGE half of the lost witness, in the only form the new
						// contract permits: the forge-only recipe reaches a real PASS payload because it is
						// driven WITH --manifestRefId naming the manifest minted into its own run directory.
						harness.ok('    … and the bridge declaration is STATED for the FORGE-ONLY recipe (recipe known)', zeroPayload.bridgeDeclaration && zeroPayload.bridgeDeclaration.known === true, JSON.stringify(zeroPayload.bridgeDeclaration));
						harness.equal('    … with bridgeCount 0, read from fourWithHub rather than written as a literal', zeroPayload.bridgeDeclaration && zeroPayload.bridgeDeclaration.bridgeCount, declaredBridgeCountOf('fourWithHub'));
						// THREE-STATE: the declared-bridges check disconnected in an in-memory double of actions.js → the bridged
						// directory without the sibling answers PASS → the conjunct is observed RED
						// actions.js writes `new require(...)`, which moduleDouble's arrow require cannot serve — the bridge suite's
						// loadBuildJsDouble (a CONSTRUCTIBLE require; only the named file is mutated, every require loads for real) is
						// the idiom for exactly this shape (BG-DEBUG (d) uses it on build.js)
						const disconnectedActions = () => bridgeTwinFactories.loadBuildJsDouble({ buildJsPath: actionsModulePath, mutationList: [{ find: 'if (!manifestRefId && bridgeDeclaration.known && bridgeDeclaration.bridgeCount > 0) {', replace: 'if (!manifestRefId && bridgeDeclaration.known && bridgeDeclaration.bridgeCount > 1e9) {' }] })();
						driveGoldEvalCheck({ actionsFactory: disconnectedActions, values: { buildLogDirPath: [bridgedRunDirPath] } }, (redError, redVerdict) => {
							// ⟪REFRAMED BY RULING (TWILIGHT_ARROW 2026-09-02)⟫ This conjunct USED TO assert that
							// disconnecting the declared-bridges check makes the bridged directory answer PASS on
							// the forge round trip alone. JOB 6b REMOVED THAT VERDICT PATH — without
							// --manifestRefId the check now refuses for conservation — so the outcome this twin
							// once observed no longer exists and cannot be reached by cutting anything. It is
							// reframed, not deleted, and this note is its provenance: a reframed twin with no
							// record of what it used to assert reads as though it was always this weak.
							//
							// TWO-SIDED, because a one-sided assertion on an error string passes on ANY error.
							// CONNECTED the bridge fingerprint is present and the conservation one absent;
							// DISCONNECTED the bridge fingerprint is gone and conservation refuses BEHIND it.
							// That proves three things at once: the bridge check runs FIRST, it was doing WORK,
							// and cutting it opens NO HOLE because conservation still refuses.
							harness.ok('(f) RED-OBSERVED — with the declared-bridges check disconnected the run STILL refuses, but no longer with the bridge fingerprint', !!redError, 'expected a refusal');
							harness.ok('(f) … the bridge fingerprint is ABSENT once its check is cut', !/DECLARES 1 bridge\(s\); mapping edges UNCERTIFIED/.test(redError || ''), redError);
							harness.match('(f) … and CONSERVATION refuses behind it, so the cut opens no hole', redError || '', /CONSERVATION UNCERTIFIED without --manifestRefId/);
							// (g) RULING BR3-5: a recipe whose `bridges` key is PRESENT and NOT AN ARRAY is REFUSED by name — it must never
							// read as "0 bridges" and disarm (f) (REVIEW-B3 §I B3-5: loadRecipe LOADS such a recipe; only validateRecipe
							// at -build refuses it, and -goldEvalCheck reads the run dir's recipe after the fact)
							const nonArrayRecipePath = path.join(scratchDir, 'fourWithHubNonArrayBridges.recipe.jsonc');
							fs.writeFileSync(nonArrayRecipePath, fs.readFileSync(path.join(__dirname, '..', '..', '..', 'recipes', 'fourWithHub.recipe.jsonc'), 'utf8').replace('"bridges": []', '"bridges": { "a": { "source": "edfi", "hub": "ceds", "bridge": "edfiCedsCrosswalkPlugin", "dependencies": ["edfi", "ceds"] } }'));
							driveGoldEvalCheck({ actionsFactory: realActions, values: { buildLogDirPath: [forgeOnlyRunDirPath], recipePath: [nonArrayRecipePath] } }, (nonArrayError) => {
								harness.match("(g) a recipe whose `bridges` is PRESENT and NOT AN ARRAY → REFUSED BY NAME (never '0 bridges')", nonArrayError || '', /'bridges' key that is not an array/);
								const nonArrayDisarmedActions = () => bridgeTwinFactories.loadBuildJsDouble({ buildJsPath: actionsModulePath, mutationList: [{ find: "if (loadedRecipe && Object.prototype.hasOwnProperty.call(loadedRecipe.recipe, 'bridges') && !Array.isArray(loadedRecipe.recipe.bridges)) {", replace: "if (loadedRecipe && Object.prototype.hasOwnProperty.call(loadedRecipe.recipe, 'bridges') && !Array.isArray(loadedRecipe.recipe.bridges) && false) {" }] })();
								driveGoldEvalCheck({ actionsFactory: nonArrayDisarmedActions, values: { buildLogDirPath: [forgeOnlyRunDirPath], recipePath: [nonArrayRecipePath] } }, (disarmedError, disarmedVerdict) => {
									const disarmedPayload = disarmedVerdict ? JSON.parse(disarmedVerdict.resultText) : {};
									// ⟪REFRAMED BY THE SAME RULING⟫ (g) used to assert that cutting the non-array check
									// lets the recipe answer PASS forgeRoundTripOnly with bridgeCount 0 — the silent
									// disarm RULING BR3-5 closes. JOB 6b removed the forge-only PASS path, so that
									// outcome is unreachable. Reframed TWO-SIDED against the non-array check's own
									// fingerprint, keeping the provenance: cutting the check must remove ITS message
									// while conservation still refuses behind it, so the disarm is still visible as a
									// CHANGE IN WHICH GATE SPEAKS rather than as a pass.
									harness.ok('(g) RED-OBSERVED — with the non-array check disconnected the run STILL refuses, but not with the non-array fingerprint', !!disarmedError, 'expected a refusal');
									harness.ok('(g) … the non-array fingerprint is ABSENT once its check is cut', !/carries a 'bridges' key that is not an array/.test(disarmedError || ''), disarmedError);
									harness.match('(g) … and CONSERVATION refuses behind it, so the disarm opens no hole', disarmedError || '', /CONSERVATION UNCERTIFIED without --manifestRefId/);
									finish();
								});
							});
						});
					});
				});
			});
		});
	});
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
								goldEvalCheckGates({ standardsDatabase, cleanManifestRefId, debugManifestRefId, forgeOnlyManifestRefId, finish });
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

