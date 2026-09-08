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
// SECTION 0B — JOB 6: THE JUDGE ENUMERATION, the pure half (G6-a, G6-e, G6-i)
// ---------------------------------------------------------------------
// ⟪JOB 6, VELVET_PRISM 2026-09-08⟫ The enumeration reads the distinct (mappingTool, mappingToolVersion) pairs
// over edges whose resolution is 'judged', per block. The population rule is the conservation audit's own:
// ENUMERATE FROM THE MANIFEST, never from a registry of what you expect to find. Nothing here consults the
// judge provider registry, and that is deliberate — a gate that asked the registry what judges exist could
// only ever confirm its own expectations, and would go blind to precisely the judge nobody declared.
//
// WHY THESE FIXTURES CARRY 'embedding-inferred' AND NOT 'invalid-debug'. A judged edge from a REAL judge takes
// its tier from the block's producerKind (MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND: inferred →
// embedding-inferred); only a DEBUG block is stamped invalid-debug, on every edge it contains (RULING 12:20).
// So a real-judge block looks like THIS, and a fixture that used invalid-debug would be refused by the
// pre-existing rule before the enumeration ever ran — measured: -goldEvalCheck against the real five-bridge
// manifest REFUSES at that gate with all five blocks named, so no artifact in this project today can exercise
// these gates. These fixtures model the post-JOB-7 world, which is the world this gate exists for.
const judgedEdgeLineFor = ({ fromStableId, toStableId, mappingTool, mappingToolVersion, provenanceTier }) => {
	const edgeProperties = { provenanceTier: [provenanceTier], matchBasis: ['derived'], resolution: ['judged'], predicate: ['closeMatch'], confidence: [0.9], decisionBlockHash: ['0'.repeat(64)] };
	// ABSENT means ABSENT, never null and never an empty list — the write seam's own rule, and the shape G6-e
	// and G6-i exist to meet. A fixture that wrote `mappingTool: [undefined]` would be testing a DIFFERENT
	// fault (a present-but-wrong value) and would leave the fabricating-a-default path unobserved.
	if (mappingTool !== undefined) { edgeProperties.mappingTool = [mappingTool]; }
	if (mappingToolVersion !== undefined) { edgeProperties.mappingToolVersion = [mappingToolVersion]; }
	return { type: 'CLOSE_MATCH', fromRef: { source: SOURCE_NAME, id: fromStableId }, toRef: { source: HUB_NAME, id: toStableId }, properties: edgeProperties };
};
// a relationship block whose edges are described as DATA, one row per edge — so a gate that needs a new edge
// shape adds a row rather than a fixture builder
const judgedBlockTextFor = ({ edgeSpecList }) => {
	const nodes = [nodeLineFor({ source: SOURCE_NAME, stableId: 'toy:property/A.one' }), nodeLineFor({ source: SOURCE_NAME, stableId: 'toy:property/A.two' }), nodeLineFor({ source: SOURCE_NAME, stableId: 'toy:property/A.three' }), nodeLineFor({ source: HUB_NAME, stableId: 'urn:toyhub:P000001' }), nodeLineFor({ source: HUB_NAME, stableId: 'urn:toyhub:P000002' }), nodeLineFor({ source: HUB_NAME, stableId: 'urn:toyhub:P000003' })];
	const edges = edgeSpecList.map((oneSpec, oneIndex) =>
		oneSpec.resolutionIsSpecified
			? edgeLineFor({ fromStableId: `toy:property/A.${['one', 'two', 'three'][oneIndex]}`, toStableId: `urn:toyhub:P00000${oneIndex + 1}`, provenanceTier: PROVENANCE_TIER.SPEC_AUTHORITATIVE })
			: judgedEdgeLineFor({ fromStableId: `toy:property/A.${['one', 'two', 'three'][oneIndex]}`, toStableId: `urn:toyhub:P00000${oneIndex + 1}`, mappingTool: oneSpec.mappingTool, mappingToolVersion: oneSpec.mappingToolVersion, provenanceTier: PROVENANCE_TIER.EMBEDDING_INFERRED }),
	);
	return replayBlockLib.serializeBlock({ header: RELATIONSHIP_HEADER, nodes, edges });
};

const ANTHROPIC_IDENTITY = 'anthropic:claude-opus-4-8';
const OLLAMA_IDENTITY = 'ollama:qwen2.5:32b@9f13ba1299af';
const RENDERER_IDENTITY = 'bridgeEvidenceRenderer-derived-v1';

harness.section('SECTION 0B — JOB 6 (G6-a) the enumeration reads the distinct (mappingTool, mappingToolVersion) pairs over JUDGED edges only');
// TWO judges, one of them twice, plus a SPECIFIED edge that must not appear in the enumeration at all —
// the specified edge is the load-bearing part: it is the read-side proof that the enumeration scopes to
// resolution==='judged' rather than to "every edge in a relationship block".
const TWO_JUDGE_TEXT = judgedBlockTextFor({ edgeSpecList: [
	{ mappingTool: ANTHROPIC_IDENTITY, mappingToolVersion: RENDERER_IDENTITY },
	{ mappingTool: OLLAMA_IDENTITY, mappingToolVersion: RENDERER_IDENTITY },
	{ resolutionIsSpecified: true },
] });
const twoJudgeAudit = sibling.auditMappingBlockText({ blockText: TWO_JUDGE_TEXT, subject: 'toy_rel_toyhub_twoJudges' });
harness.equal('G6-a: three edges in the block', twoJudgeAudit.edgeCount, 3);
harness.equal('G6-a: TWO of them are judged (the specified edge is not counted)', twoJudgeAudit.judgedEdgeCount, 2);
harness.equal('G6-a: TWO distinct identity pairs enumerated', (twoJudgeAudit.judgeIdentityPairList || []).length, 2);
harness.ok(
	'G6-a: the pairs are the two judges, each with its version and its own judged-edge count',
	JSON.stringify((twoJudgeAudit.judgeIdentityPairList || []).slice().sort((a, b) => (a.mappingTool < b.mappingTool ? -1 : 1))) ===
		JSON.stringify([
			{ mappingTool: ANTHROPIC_IDENTITY, mappingToolVersion: RENDERER_IDENTITY, judgedEdgeCount: 1 },
			{ mappingTool: OLLAMA_IDENTITY, mappingToolVersion: RENDERER_IDENTITY, judgedEdgeCount: 1 },
		]),
	JSON.stringify(twoJudgeAudit.judgeIdentityPairList),
);
harness.ok('G6-a: a block carrying judged edges is NOT refused merely for carrying them', twoJudgeAudit.refusalMessage === null, twoJudgeAudit.refusalMessage);

// the AUTHORED-ONLY block — G6-f's population-rule proof at the pure level. A block WITH edges and ZERO
// judged ones enumerates NOTHING. This is the assertion that only resolution-scoping can satisfy: a gate
// keyed on "does this block have edges" would enumerate here and demand a judge that does not exist.
const authoredOnlyAudit = sibling.auditMappingBlockText({ blockText: CLEAN_TEXT, subject: 'toy_rel_toyhub' });
harness.equal('G6-f (pure): an AUTHORED-ONLY block has 2 edges…', authoredOnlyAudit.edgeCount, 2);
harness.equal('G6-f (pure): …ZERO of them judged…', authoredOnlyAudit.judgedEdgeCount, 0);
// ⟪MY OWN VACUOUS GATE, CAUGHT BEFORE IMPLEMENTING — VELVET_PRISM 2026-09-08⟫ This first read
// `(authoredOnlyAudit.judgeIdentityPairList || []).length === 0`, which is TRUE when the module has no
// enumeration AT ALL: the `|| []` I wrote to keep the suite from crashing made ABSENT and EMPTY
// indistinguishable, and the assertion passed green against a module that enumerates nothing. That is
// AZURE_ANCHOR's "absence is not a weaker form of wrongness; it is the form a fabricator needs", committed
// by me in the gate written to catch it. The repair asserts EXISTENCE and EMPTINESS as two facts, and
// Array.isArray fails cleanly rather than throwing — a gate that detects by crashing is not a gate.
harness.ok('G6-f (pure): …the enumeration is PRESENT on the result (an absent list is not an empty one)', Array.isArray(authoredOnlyAudit.judgeIdentityPairList), typeof authoredOnlyAudit.judgeIdentityPairList);
harness.ok('G6-f (pure): …and it is EMPTY — the gate looked and found none, which is not the same as not looking', Array.isArray(authoredOnlyAudit.judgeIdentityPairList) && authoredOnlyAudit.judgeIdentityPairList.length === 0, JSON.stringify(authoredOnlyAudit.judgeIdentityPairList));

// ⟪MA5 REPAIR — VELVET_PRISM 2026-09-08⟫ A SECOND judged fixture whose judges are DIFFERENT ones. My
// mutation MA5 replaced the refusal's "every mappingTool found" list with a HAND LIST that happened to equal
// the derivation, and the suite stayed GREEN — COBALT_ANCHOR's M14 and RUBY_ANCHOR's M9 for the third time in
// this campaign: equality can only ever prove agreement, never derivation. One manifest cannot discriminate
// it. TWO manifests with DISJOINT judge sets can: no single hand list can name both sets and name neither
// the other's, so the assertions below fail for any literal while passing for the derivation.
const OTHER_ANTHROPIC_IDENTITY = 'anthropic:claude-sonnet-5';
const OTHER_OLLAMA_IDENTITY = 'ollama:llama3.3:70b@aabbccdd1122';
const OTHER_JUDGE_TEXT = judgedBlockTextFor({ edgeSpecList: [
	{ mappingTool: OTHER_ANTHROPIC_IDENTITY, mappingToolVersion: RENDERER_IDENTITY },
	{ mappingTool: OTHER_OLLAMA_IDENTITY, mappingToolVersion: RENDERER_IDENTITY },
] });

harness.section('SECTION 0B — JOB 6 (G6-e) a JUDGED edge with NO mappingTool is refused BY NAME — the read-side twin of graphSeamRules writeMappingEdge');
const MISSING_TOOL_TEXT = judgedBlockTextFor({ edgeSpecList: [{ mappingTool: ANTHROPIC_IDENTITY, mappingToolVersion: RENDERER_IDENTITY }, { mappingToolVersion: RENDERER_IDENTITY }] });
const missingToolAudit = sibling.auditMappingBlockText({ blockText: MISSING_TOOL_TEXT, subject: 'toy_rel_toyhub_missingTool' });
harness.equal('G6-e: the block has 2 judged edges', missingToolAudit.judgedEdgeCount, 2);
harness.equal('G6-e: ONE of them carries no mappingTool', missingToolAudit.judgedEdgeMissingMappingToolCount, 1);
harness.match('G6-e: refused BY NAME, naming the block', missingToolAudit.judgeEnumerationRefusalMessage || '', /toy_rel_toyhub_missingTool/);
harness.match('G6-e: …and naming the offending edge by stableId, never [object Object]', missingToolAudit.judgeEnumerationRefusalMessage || '', /toy:property\/A\.two -\[CLOSE_MATCH\]-> urn:toyhub:P000002/);
harness.match('G6-e: …and saying WHAT is missing rather than that something is wrong', missingToolAudit.judgeEnumerationRefusalMessage || '', /mappingTool/);
// THE COMPANION CASE, and it is a separate fact from the refusal: the refusal must fire ONLY when it should.
// A guard too broad would refuse the authored-only block, which carries no mappingTool on any edge BECAUSE
// none of them is judged. This is the assertion that catches a guard that forgot to scope to 'judged'.
// ⟪THE SAME VACUITY, SAME REPAIR⟫ `!result.judgeEnumerationRefusalMessage` is TRUE when the module never
// sets the field, so both of these passed green against a module with no enumeration. The field must be
// PRESENT AND EXPLICITLY NULL — the codebase's own idiom for "looked, found nothing to refuse"
// (auditMappingBlockText already returns `refusalMessage: null` rather than omitting it). Asserting the
// null distinguishes a considered no from an absent thought.
harness.ok('G6-e COMPANION: an AUTHORED-ONLY block carries the refusal field, EXPLICITLY null — not absent', authoredOnlyAudit.judgeEnumerationRefusalMessage === null, `got ${typeof authoredOnlyAudit.judgeEnumerationRefusalMessage}: ${authoredOnlyAudit.judgeEnumerationRefusalMessage}`);
harness.ok('G6-e COMPANION: …so it is NOT refused, though not one of its edges carries a mappingTool — the guard scoped to judged', authoredOnlyAudit.judgeEnumerationRefusalMessage === null, authoredOnlyAudit.judgeEnumerationRefusalMessage);
harness.ok('G6-e COMPANION: and a well-formed judged block is not refused either', twoJudgeAudit.judgeEnumerationRefusalMessage === null, `got ${typeof twoJudgeAudit.judgeEnumerationRefusalMessage}: ${twoJudgeAudit.judgeEnumerationRefusalMessage}`);

harness.section('SECTION 0B — JOB 6 (G6-i) mappingToolVersion ABSENT is enumerated as an EXPLICIT TOKEN, never substituted and never empty');
// [code fact, read from materialiser.js:99] The CURRENT WRITER CANNOT PRODUCE THIS SHAPE: it writes
// mappingToolVersion for every judged edge through a template literal
// (`${record.judge.rendererVersion === undefined ? RENDERER_VERSION : record.judge.rendererVersion}`), so the
// value is always a string. The shape is reachable only from a legacy or hand-assembled block. It is gated
// anyway, because absence is not a weaker form of wrongness — it is the form a fabricator needs, and a reader
// that quietly supplied RENDERER_VERSION here would invent a version the edge does not carry and print it in
// a certificate as though it had been measured.
const ABSENT_VERSION_TEXT = judgedBlockTextFor({ edgeSpecList: [{ mappingTool: ANTHROPIC_IDENTITY }] });
const absentVersionAudit = sibling.auditMappingBlockText({ blockText: ABSENT_VERSION_TEXT, subject: 'toy_rel_toyhub_absentVersion' });
harness.equal('G6-i: the judged edge is still enumerated — an absent VERSION is not an absent JUDGE', absentVersionAudit.judgedEdgeCount, 1);
// the token is asserted to EXIST and to be a usable string BEFORE anything is compared against it —
// ⟪VACUITY CAUGHT⟫ the equality below read `undefined === undefined` and passed green against a module
// exporting no such constant. Order matters: the observation must precede the comparison, or the
// comparison observes nothing. (RUBY_ANCHOR's ordering rule, applied to an equality rather than a mutation.)
harness.ok('G6-i: the module EXPORTS an explicit absent-version token…', typeof sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN === 'string' && sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN.trim() !== '', `got ${typeof sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN}: ${sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN}`);
harness.ok('G6-i: …which says ABSENT in words, so a certificate reader cannot mistake it for a version', typeof sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN === 'string' && /absent/i.test(sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN), sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN);
harness.ok('G6-i: …and is NOT the renderer version the writer would have substituted', typeof sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN === 'string' && sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN !== RENDERER_IDENTITY && sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN !== 'bridgeEvidenceRenderer-v1', sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN);
harness.ok('G6-i: the enumeration is PRESENT and holds exactly one pair', Array.isArray(absentVersionAudit.judgeIdentityPairList) && absentVersionAudit.judgeIdentityPairList.length === 1, JSON.stringify(absentVersionAudit.judgeIdentityPairList));
harness.ok('G6-i: the tool is named as written', Array.isArray(absentVersionAudit.judgeIdentityPairList) && absentVersionAudit.judgeIdentityPairList.length === 1 && absentVersionAudit.judgeIdentityPairList[0].mappingTool === ANTHROPIC_IDENTITY, JSON.stringify(absentVersionAudit.judgeIdentityPairList));
harness.ok(
	'G6-i: the version reads as the EXPLICIT ABSENT token — never empty, never null, never a substituted RENDERER_VERSION',
	Array.isArray(absentVersionAudit.judgeIdentityPairList) && absentVersionAudit.judgeIdentityPairList.length === 1 && typeof sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN === 'string' && absentVersionAudit.judgeIdentityPairList[0].mappingToolVersion === sibling.ABSENT_MAPPING_TOOL_VERSION_TOKEN,
	JSON.stringify(absentVersionAudit.judgeIdentityPairList),
);
harness.ok('G6-i: an absent version is NOT a refusal — an unnamed VERSION is not an unnamed JUDGE (field present, explicitly null)', absentVersionAudit.judgeEnumerationRefusalMessage === null, `got ${typeof absentVersionAudit.judgeEnumerationRefusalMessage}: ${absentVersionAudit.judgeEnumerationRefusalMessage}`);

// ---------------------------------------------------------------------
// SECTION 0C — JOB 6 (G6-g) THE DATED ALIAS TABLE: two historical debug spellings resolve to one judge
// ---------------------------------------------------------------------
// ⟪JOB 6, VELVET_PRISM 2026-09-08, ruled by DAWN_TOWER⟫ The debug judge's identity has been spelled three
// ways in eight days. The table is DATA with a dated reason per row — never a regex, never a general
// normaliser — so a graph judged before JOB 4 enumerates ONE judge rather than two or three spellings of one
// rule.
//
// WHY THE TWIN IS A FIXTURE AND NOT THE LIVE GRAPH, stated because v2 originally asked for the opposite.
// [code fact, measured read-only 2026-09-08] DEV_fiveBridgeSelfDoc_260901 holds 2,957 judged edges and ALL
// of them carry ONE spelling, the pre-JOB-1 hyphen form; the colon form has ZERO edges there and debug:first
// has ZERO. So removing an alias row on that graph changes the SPELLING the enumeration reports and NEVER
// the COUNT — "one judge too many" cannot be observed where only one spelling exists. The observation the
// amended G6-g demands requires a MIXTURE, and no artifact in the record has one. THESE ROWS ARE INVENTED
// DATA, said here in the gate's own name so no reader mistakes them for a measurement.
const aliasTableModulePath = path.join(__dirname, '..', 'lib', 'judgeIdentityAliasTable.js');
const HYPHEN_DEBUG_IDENTITY = 'debugJudge-first-v1-INVALID_DEBUG';
const COLON_DEBUG_IDENTITY = 'debugJudge:first-v1-INVALID_DEBUG';
const CURRENT_DEBUG_IDENTITY = 'debug:first';

harness.section('SECTION 0C — JOB 6 (G6-g) the alias table is DATA with a dated reason per row; it RENAMES and never admits or excludes');
const aliasTableLib = require(aliasTableModulePath);
harness.ok('G6-g: the table exports a frozen ROW LIST, so the gates enumerate FROM the data', Array.isArray(aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST) && Object.isFrozen(aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST));
harness.equal('G6-g: TWO rows — the pre-JOB-1 hyphen form and the JOB 1-to-3 colon form', (aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST || []).length, 2);
harness.ok(
	'G6-g: EVERY row carries a machine-readable retiredOn date — a date a gate can read, not one buried in prose',
	(aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST || []).length > 0 && (aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST || []).every((oneRow) => typeof oneRow.retiredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(oneRow.retiredOn)),
	JSON.stringify((aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST || []).map((oneRow) => oneRow.retiredOn)),
);
harness.ok(
	'G6-g: EVERY row carries a non-trivial reasonText — a row whose reason is a restatement of its own fields teaches nobody',
	(aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST || []).length > 0 && (aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST || []).every((oneRow) => typeof oneRow.reasonText === 'string' && oneRow.reasonText.trim().length > 40),
	JSON.stringify((aliasTableLib.JUDGE_IDENTITY_ALIAS_ROW_LIST || []).map((oneRow) => (oneRow.reasonText || '').length)),
);
harness.equal('G6-g: the HYPHEN form resolves to the current identity', aliasTableLib.currentModelIdentityFor(HYPHEN_DEBUG_IDENTITY), CURRENT_DEBUG_IDENTITY);
harness.equal('G6-g: the COLON form resolves to the current identity', aliasTableLib.currentModelIdentityFor(COLON_DEBUG_IDENTITY), CURRENT_DEBUG_IDENTITY);
harness.equal('G6-g: the CURRENT identity resolves to itself, unchanged', aliasTableLib.currentModelIdentityFor(CURRENT_DEBUG_IDENTITY), CURRENT_DEBUG_IDENTITY);
// THE LOAD-BEARING BEHAVIOUR, ruled by DAWN_TOWER: an unrecognised identity PASSES THROUGH UNTOUCHED.
// The table RENAMES; it never admits or excludes. A refusal here would make it a whitelist of judges —
// the "registry of what you expect to find" the population rule forbids — and the unknown judge is exactly
// what this gate exists to SHOW the operator.
harness.equal('G6-g: an UNKNOWN identity passes through UNTOUCHED — the table renames, it never excludes', aliasTableLib.currentModelIdentityFor('someJudgeNobodyDeclared:v9'), 'someJudgeNobodyDeclared:v9');
harness.equal('G6-g: …and a real non-debug identity is equally untouched', aliasTableLib.currentModelIdentityFor(ANTHROPIC_IDENTITY), ANTHROPIC_IDENTITY);
// EXACT, WHOLE-STRING lookup — no regex, no prefix match, no case folding, no separator rewriting.
// A near-miss must NOT be swallowed: swallowing one would silently merge two judges into a single row of a
// promotion certificate, which is the precise failure this gate exists to prevent.
harness.equal('G6-g: a NEAR-MISS (extra suffix) is NOT swallowed — the lookup is whole-string, not a prefix', aliasTableLib.currentModelIdentityFor(`${HYPHEN_DEBUG_IDENTITY}-butDifferent`), `${HYPHEN_DEBUG_IDENTITY}-butDifferent`);
harness.equal('G6-g: a NEAR-MISS (different case) is NOT swallowed — no case folding', aliasTableLib.currentModelIdentityFor(HYPHEN_DEBUG_IDENTITY.toUpperCase()), HYPHEN_DEBUG_IDENTITY.toUpperCase());
harness.equal('G6-g: a NEAR-MISS (the separator alone changed) is NOT swallowed — no general normaliser', aliasTableLib.currentModelIdentityFor('debugJudge_first-v1-INVALID_DEBUG'), 'debugJudge_first-v1-INVALID_DEBUG');
harness.ok('G6-g: the module contains NO regex — the rule is DATA, and a regex is a rule pretending to be one', !/new RegExp|\.test\(|\.match\(|\/[^/\n]+\/[gimsuy]*\.test/.test(fs.readFileSync(aliasTableModulePath, 'utf8').split('\n').filter((oneLine) => oneLine.trim().indexOf('//') !== 0).join('\n')));

harness.section('SECTION 0C — JOB 6 (G6-g) THE TWIN, on an INVENTED MIXTURE: remove EITHER row and the enumeration reports one judge too many, BY NAME');
// the mixture no real artifact has — all three spellings of ONE rule in one block
const MIXED_SPELLING_TEXT = judgedBlockTextFor({ edgeSpecList: [
	{ mappingTool: HYPHEN_DEBUG_IDENTITY, mappingToolVersion: RENDERER_IDENTITY },
	{ mappingTool: COLON_DEBUG_IDENTITY, mappingToolVersion: RENDERER_IDENTITY },
	{ mappingTool: CURRENT_DEBUG_IDENTITY, mappingToolVersion: RENDERER_IDENTITY },
] });
const mixedAudit = sibling.auditMappingBlockText({ blockText: MIXED_SPELLING_TEXT, subject: 'toy_rel_toyhub_mixedSpellings' });
harness.equal('G6-g: the INVENTED mixture holds three judged edges…', mixedAudit.judgedEdgeCount, 3);
harness.ok(
	'G6-g: …and with BOTH alias rows present they enumerate as ONE judge, the current identity',
	Array.isArray(mixedAudit.judgeIdentityPairList) && mixedAudit.judgeIdentityPairList.length === 1 && mixedAudit.judgeIdentityPairList[0].mappingTool === CURRENT_DEBUG_IDENTITY && mixedAudit.judgeIdentityPairList[0].judgedEdgeCount === 3,
	JSON.stringify(mixedAudit.judgeIdentityPairList),
);
// remove EITHER row, one at a time, through a module double of the TABLE — the production data mutated,
// not the reader. Two separate observations, because the amendment says "remove EITHER row".
const enumerationWithAliasRowRemoved = (removedHistoricalIdentity) => {
	const siblingWithRowRemoved = moduleDouble.loadWithMutations({
		modulePath: siblingModulePath,
		mutationList: [{ modulePath: aliasTableModulePath, find: `historicalModelIdentity: '${removedHistoricalIdentity}'`, replace: `historicalModelIdentity: 'ROW_REMOVED_BY_THE_TWIN_${removedHistoricalIdentity}'` }],
	});
	return siblingWithRowRemoved.auditMappingBlockText({ blockText: MIXED_SPELLING_TEXT, subject: 'toy_rel_toyhub_mixedSpellings' });
};
const withoutHyphenRow = enumerationWithAliasRowRemoved(HYPHEN_DEBUG_IDENTITY);
harness.equal('G6-g RED-OBSERVED: remove the HYPHEN row → TWO judges where there is one rule', (withoutHyphenRow.judgeIdentityPairList || []).length, 2);
harness.ok(
	'G6-g RED-OBSERVED: …and the extra judge is named — the hyphen spelling, unresolved',
	(withoutHyphenRow.judgeIdentityPairList || []).some((onePair) => onePair.mappingTool === HYPHEN_DEBUG_IDENTITY),
	JSON.stringify(withoutHyphenRow.judgeIdentityPairList),
);
const withoutColonRow = enumerationWithAliasRowRemoved(COLON_DEBUG_IDENTITY);
harness.equal('G6-g RED-OBSERVED: remove the COLON row → TWO judges', (withoutColonRow.judgeIdentityPairList || []).length, 2);
harness.ok(
	'G6-g RED-OBSERVED: …and THAT extra judge is named too — the colon spelling, unresolved',
	(withoutColonRow.judgeIdentityPairList || []).some((onePair) => onePair.mappingTool === COLON_DEBUG_IDENTITY),
	JSON.stringify(withoutColonRow.judgeIdentityPairList),
);

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
// ---------------------------------------------------------------------
// SECTION 5 — JOB 6: THE VERB NAMES ITS JUDGES AND PROMOTION NAMES THEM BACK (G6-b, G6-c, G6-d, G6-e, G6-f)
// ---------------------------------------------------------------------
// ⟪JOB 6, VELVET_PRISM 2026-09-08⟫ Driven through the REAL actions.js by driveGoldEvalCheck, the same way
// (f) and (g) are. EVERY manifest here is INVENTED DATA and says so: [code fact, measured 2026-09-08] every
// relationship block in this project carries provenanceTier invalid-debug, so -goldEvalCheck refuses every
// real artifact at a gate that runs BEFORE any of this, and no gate below could be observed on a real
// manifest today. The real-data witness is G6-j, which reports the enumeration and NOT a verdict.
const judgeNamingGates = ({ standardsDatabase, driveGoldEvalCheck, realActions, bridgedRunDirPath, mintConservationArtifacts, databaseFilePath, twoJudgeManifestRefId, missingToolManifestRefId, otherJudgeManifestRefId, cleanManifestRefId, debugManifestRefId, finish }) => {
	harness.section('SECTION 5 — JOB 6 (G6-b/c/d/e/f) the VERB: promotion must NAME every judge the manifest carries');
	harness.ok('    the two-judge manifest gets REAL-SHAPED conservation artifacts', !mintConservationArtifacts({ standardsDatabase, manifestRefId: twoJudgeManifestRefId, runDirPath: bridgedRunDirPath }));
	harness.ok('    …and so does the missing-mappingTool manifest', !mintConservationArtifacts({ standardsDatabase, manifestRefId: missingToolManifestRefId, runDirPath: bridgedRunDirPath }));
	const valuesFor = (manifestRefId, judgedByList) => {
		const values = { buildLogDirPath: [bridgedRunDirPath], manifestRefId: [manifestRefId], standardsDatabaseFilePath: [databaseFilePath] };
		if (judgedByList !== undefined) { values.judgedBy = judgedByList; }
		return values;
	};

	driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(twoJudgeManifestRefId, [ANTHROPIC_IDENTITY, OLLAMA_IDENTITY]) }, (namedError, namedVerdict) => {
		harness.ok('G6-b: BOTH present judges named with --judgedBy → PASS', !namedError && namedVerdict && namedVerdict.exitCode === 0, namedError);
		const namedPayload = namedVerdict ? JSON.parse(namedVerdict.resultText) : {};
		harness.ok('G6-b: the certificate CARRIES the enumeration — a promoter is SHOWN what judged the graph', !!namedPayload.judgeEnumeration, JSON.stringify(Object.keys(namedPayload)));
		harness.ok(
			'G6-b: …naming both judges, aggregated and sorted',
			JSON.stringify(namedPayload.judgeEnumeration && namedPayload.judgeEnumeration.judgeToolIdList) === JSON.stringify([ANTHROPIC_IDENTITY, OLLAMA_IDENTITY].slice().sort()),
			JSON.stringify(namedPayload.judgeEnumeration),
		);
		harness.equal('G6-b: …with the judged-edge total the blocks actually carry', namedPayload.judgeEnumeration && namedPayload.judgeEnumeration.judgedEdgeTotal, 2);
		harness.ok('G6-b: …and PER-BLOCK, so a promoter can see WHICH block a judge touched', !!(namedPayload.judgeEnumeration && namedPayload.judgeEnumeration.perBlockList && namedPayload.judgeEnumeration.perBlockList.length === 1), JSON.stringify(namedPayload.judgeEnumeration && namedPayload.judgeEnumeration.perBlockList));

		driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(twoJudgeManifestRefId, [ANTHROPIC_IDENTITY]) }, (unnamedError) => {
			harness.ok('G6-c: a judge PRESENT but not named → REFUSED', !!unnamedError, 'expected a refusal');
			harness.match('G6-c: …naming the unnamed tool id', unnamedError || '', /ollama:qwen2\.5:32b@9f13ba1299af/);
			harness.match('G6-c: …and naming the BLOCK it judged', unnamedError || '', /toy@1_0_rel_toyhub@1_0_twoJudges_close/);
			harness.match('G6-c: …and LISTING every mappingTool FOUND, built from the enumeration and never a hand list', unnamedError || '', /anthropic:claude-opus-4-8/);
			harness.match('G6-c: …and telling the operator what to type', unnamedError || '', /--judgedBy/);

			driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(twoJudgeManifestRefId, [ANTHROPIC_IDENTITY, OLLAMA_IDENTITY, 'anthropic:claude-opus-4-1-RETIRED']) }, (absentError) => {
				harness.ok('G6-d: --judgedBy naming an ABSENT judge → REFUSED (a stale promotion command is a defect)', !!absentError, 'expected a refusal');
				harness.match('G6-d: …naming the judge that judged nothing', absentError || '', /anthropic:claude-opus-4-1-RETIRED/);
				harness.match('G6-d: …and saying what IS present, so the command can be corrected', absentError || '', /ollama:qwen2\.5:32b@9f13ba1299af/);

				driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(twoJudgeManifestRefId, [OLLAMA_IDENTITY, ANTHROPIC_IDENTITY]) }, (reorderError, reorderVerdict) => {
					harness.ok('G6-b COMPANION: the same two judges in the OTHER order → still PASS (a SET, not a sequence)', !reorderError && reorderVerdict && reorderVerdict.exitCode === 0, reorderError);

					// ⟪MA3 REPAIR — VELVET_PRISM 2026-09-08⟫ THIS GATE WAS VACUOUS AND MY OWN MUTATION FOUND IT.
					// It used to pass [ANTHROPIC_IDENTITY, '   '] and assert only that SOME refusal mentioning
					// --judgedBy came back. Disconnecting the malformed-value check left it GREEN: the blank
					// trims to '', ollama then reads as UNNAMED, and the UNNAMED refusal satisfied the
					// assertion. RUBY_ANCHOR's M11 exactly — an assertion satisfied by the NEXT check does not
					// prove THIS one exists. The repair does two things: name EVERY present judge so no other
					// check has grounds to fire, and assert the malformed refusal's OWN sentence rather than
					// merely that a refusal happened.
					driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(twoJudgeManifestRefId, [ANTHROPIC_IDENTITY, OLLAMA_IDENTITY, '   ']) }, (blankError) => {
						harness.ok('G6-b: a BLANK --judgedBy value is REFUSED BY NAME, never silently dropped', !!blankError, 'expected a refusal');
						harness.match('G6-b: …by the MALFORMED-VALUE refusal specifically, not by some other check firing behind it', blankError || '', /empty or non-string value/);
						harness.match('G6-b: …quoting the offending value back', blankError || '', /"\s+"/);
						harness.ok('G6-b: …and NOT by the unnamed-judge refusal, which has no grounds here — every present judge IS named', !/does not name them/.test(blankError || ''), blankError);

						driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(missingToolManifestRefId, [ANTHROPIC_IDENTITY]) }, (missingToolVerbError) => {
							harness.ok('G6-e (verb): a JUDGED edge with NO mappingTool → REFUSED', !!missingToolVerbError, 'expected a refusal');
							harness.match('G6-e (verb): …by name, naming the block', missingToolVerbError || '', /toy@1_0_rel_toyhub@1_0_missingTool_close/);
							harness.match('G6-e (verb): …and naming the missing property', missingToolVerbError || '', /mappingTool/);

							driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(cleanManifestRefId, undefined) }, (authoredError, authoredVerdict) => {
								harness.ok('G6-f (verb): an AUTHORED-ONLY manifest PASSES with NO --judgedBy — the population rule holds', !authoredError && authoredVerdict && authoredVerdict.exitCode === 0, authoredError);
								const authoredPayload = authoredVerdict ? JSON.parse(authoredVerdict.resultText) : {};
								harness.equal('G6-f (verb): …it DID audit a relationship block (it LOOKED)…', authoredPayload.bridgeSibling && authoredPayload.bridgeSibling.mappingBlockList.length, 1);
								harness.equal('G6-f (verb): …carrying 2 real edges…', authoredPayload.bridgeSibling && authoredPayload.bridgeSibling.mappingBlockList[0].edgeCount, 2);
								harness.equal('G6-f (verb): …and found ZERO judged edges, which is the ONLY reason no judge was demanded', authoredPayload.judgeEnumeration && authoredPayload.judgeEnumeration.judgedEdgeTotal, 0);
								harness.ok('G6-f (verb): …and the enumeration is REPORTED as empty rather than omitted', !!authoredPayload.judgeEnumeration && Array.isArray(authoredPayload.judgeEnumeration.judgeToolIdList) && authoredPayload.judgeEnumeration.judgeToolIdList.length === 0, JSON.stringify(authoredPayload.judgeEnumeration));

								// ⟪MA5 REPAIR — VELVET_PRISM 2026-09-08⟫ THE SECOND VACUOUS GATE MY MUTATIONS FOUND.
								// G6-c asserted the refusal "lists every mappingTool found, built FROM the
								// enumeration and never a hand list" — but replacing that list with a HAND LIST
								// that happened to equal today's derivation left the suite GREEN. Equality
								// proves agreement, never derivation (COBALT_ANCHOR M14, RUBY_ANCHOR M9).
								// ONE manifest cannot discriminate it. A SECOND manifest with a DISJOINT judge
								// set can: no single literal can name both sets and name neither the other's.
								driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(otherJudgeManifestRefId, [OTHER_ANTHROPIC_IDENTITY]) }, (otherUnnamedError) => {
									harness.ok('G6-c DERIVATION: a DIFFERENT manifest s unnamed judge → REFUSED', !!otherUnnamedError, 'expected a refusal');
									harness.match('G6-c DERIVATION: …naming THIS manifest s unnamed judge', otherUnnamedError || '', /ollama:llama3\.3:70b@aabbccdd1122/);
									harness.match('G6-c DERIVATION: …and listing THIS manifest s other judge', otherUnnamedError || '', /anthropic:claude-sonnet-5/);
									// THE ASSERTION A HAND LIST CANNOT SATISFY: the other manifest's judges must
									// be ABSENT from this refusal. A literal naming the two-judge fixture's
									// identities fails here; only a list derived from THIS manifest passes.
									harness.ok('G6-c DERIVATION: …and NAMING NEITHER of the other manifest s judges — a hand list would name them', !/claude-opus-4-8/.test(otherUnnamedError || '') && !/qwen2\.5:32b/.test(otherUnnamedError || ''), otherUnnamedError);
									driveGoldEvalCheck({ actionsFactory: realActions, values: valuesFor(debugManifestRefId, ['someJudgeNobodyDeclared:v9']) }, (orderError) => {
									harness.match('ORDERING: the pre-existing invalid-debug refusal fires FIRST, UNTOUCHED by JOB 6', orderError || '', /invalid-debug/);
										harness.ok('ORDERING: …and no judge-naming refusal appears ahead of it', !/--judgedBy/.test(orderError || ''), orderError);
										finish();
									});
								});
							});
						});
					});
				});
			});
		});
	});
};

const goldEvalCheckGates = ({ standardsDatabase, cleanManifestRefId, debugManifestRefId, forgeOnlyManifestRefId, twoJudgeManifestRefId, missingToolManifestRefId, otherJudgeManifestRefId, finish }) => {
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
									judgeNamingGates({ standardsDatabase, driveGoldEvalCheck, realActions, bridgedRunDirPath, mintConservationArtifacts, databaseFilePath, twoJudgeManifestRefId, missingToolManifestRefId, otherJudgeManifestRefId, cleanManifestRefId, debugManifestRefId, finish });
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
const runGates = ({ standardsDatabase, cleanManifestRefId, debugManifestRefId, forgeOnlyManifestRefId, twoJudgeManifestRefId, missingToolManifestRefId, otherJudgeManifestRefId }) => {
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
								// =====================================================================
								// SECTION 3B — JOB 6: THE MANIFEST-LEVEL AGGREGATION (G6-a aggregate, G6-e, G6-f)
								// =====================================================================
								// The per-block enumeration is proven in SECTION 0B. THIS asserts the aggregate a promoter is
								// shown and must type back: judgeToolIdList is the DISTINCT set of aliased identities across
								// every relationship block, derived from the blocks themselves and never from a declared list.
								harness.section('SECTION 3B — JOB 6 the manifest aggregate: judges enumerated across blocks, derived from the blocks');
								sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: twoJudgeManifestRefId }, (twoJudgeAuditError, twoJudgeManifestAudit) => {
									harness.ok('G6-a (manifest): the two-judge manifest audits without error', !twoJudgeAuditError, twoJudgeAuditError);
									harness.equal('G6-a (manifest): ONE relationship block audited', twoJudgeManifestAudit && twoJudgeManifestAudit.mappingBlockList.length, 1);
									harness.equal('G6-a (manifest): the block reports 2 judged edges of its 3', twoJudgeManifestAudit && twoJudgeManifestAudit.mappingBlockList[0].judgedEdgeCount, 2);
									harness.equal('G6-a (manifest): PER-BLOCK identity pairs are carried on the block row', (twoJudgeManifestAudit && twoJudgeManifestAudit.mappingBlockList[0].judgeIdentityPairList || []).length, 2);
									harness.equal('G6-a (manifest): the AGGREGATE judged-edge total', twoJudgeManifestAudit && twoJudgeManifestAudit.judgedEdgeTotal, 2);
									harness.ok(
										'G6-a (manifest): judgeToolIdList is the DISTINCT aliased identities, sorted — this is what --judgedBy must name',
										JSON.stringify(twoJudgeManifestAudit && twoJudgeManifestAudit.judgeToolIdList) === JSON.stringify([ANTHROPIC_IDENTITY, OLLAMA_IDENTITY].slice().sort()),
										JSON.stringify(twoJudgeManifestAudit && twoJudgeManifestAudit.judgeToolIdList),
									);
									harness.equal('G6-a (manifest): no invalid-debug refusal — the pre-existing channel stays empty and UNTOUCHED', (twoJudgeManifestAudit && twoJudgeManifestAudit.refusalMessageList || ['x']).length, 0);
									harness.ok('G6-a (manifest): the judge-enumeration refusal channel is PRESENT and empty (not absent)', Array.isArray(twoJudgeManifestAudit && twoJudgeManifestAudit.judgeEnumerationRefusalMessageList) && twoJudgeManifestAudit.judgeEnumerationRefusalMessageList.length === 0, JSON.stringify(twoJudgeManifestAudit && twoJudgeManifestAudit.judgeEnumerationRefusalMessageList));
									sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: missingToolManifestRefId }, (missingToolAuditError, missingToolManifestAudit) => {
										harness.ok('G6-e (manifest): the audit COMPLETES — the refusal is a RESULT, not a crash', !missingToolAuditError, missingToolAuditError);
										harness.equal('G6-e (manifest): exactly ONE judge-enumeration refusal', (missingToolManifestAudit && missingToolManifestAudit.judgeEnumerationRefusalMessageList || []).length, 1);
										harness.match('G6-e (manifest): naming the block', (missingToolManifestAudit && missingToolManifestAudit.judgeEnumerationRefusalMessageList || [''])[0] || '', /toy@1_0_rel_toyhub@1_0_missingTool_close/);
										harness.equal('G6-e (manifest): and the invalid-debug channel is UNTOUCHED by it — separate faults, separate channels', (missingToolManifestAudit && missingToolManifestAudit.refusalMessageList || ['x']).length, 0);
										sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: cleanManifestRefId }, (authoredAuditError, authoredManifestAudit) => {
											// G6-f AT THE MANIFEST LEVEL — the population rule's proof. A manifest WITH a relationship
											// block, WITH edges, and ZERO judged edges enumerates NO judges and refuses nothing. Only a
											// gate scoped to resolution==='judged' can produce this; one keyed on 'are there blocks'
											// would demand a judge for a bridge nobody judged.
											harness.ok('G6-f (manifest): the AUTHORED-ONLY manifest audits without error', !authoredAuditError, authoredAuditError);
											harness.equal('G6-f (manifest): it HAS a relationship block…', (authoredManifestAudit && authoredManifestAudit.mappingBlockList || []).length, 1);
											harness.equal('G6-f (manifest): …carrying 2 edges…', authoredManifestAudit && authoredManifestAudit.mappingBlockList[0].edgeCount, 2);
											harness.equal('G6-f (manifest): …ZERO of them judged…', authoredManifestAudit && authoredManifestAudit.judgedEdgeTotal, 0);
											harness.ok('G6-f (manifest): …so judgeToolIdList is PRESENT and EMPTY — the gate looked and found none', Array.isArray(authoredManifestAudit && authoredManifestAudit.judgeToolIdList) && authoredManifestAudit.judgeToolIdList.length === 0, JSON.stringify(authoredManifestAudit && authoredManifestAudit.judgeToolIdList));
											harness.ok('G6-f (manifest): …and NOTHING is refused, though no edge carries a mappingTool', Array.isArray(authoredManifestAudit && authoredManifestAudit.judgeEnumerationRefusalMessageList) && authoredManifestAudit.judgeEnumerationRefusalMessageList.length === 0, JSON.stringify(authoredManifestAudit && authoredManifestAudit.judgeEnumerationRefusalMessageList));
											sibling.auditManifestMappingBlocks({ standardsDatabase, manifestRefId: forgeOnlyManifestRefId }, (forgeOnlyAuditError, forgeOnlyManifestAudit) => {
												// THE SEPARATE, WEAKER FACT, asserted separately and labelled so — a forge-only manifest
												// proves only that the gate does not fire when it looked at NOTHING. G6-f above is the
												// one that proves the population rule, because there the gate DID look.
												harness.equal('G6-f COMPANION (weaker fact): a FORGE-ONLY manifest has zero relationship blocks…', (forgeOnlyManifestAudit && forgeOnlyManifestAudit.mappingBlockList || ['x']).length, 0);
												harness.ok('G6-f COMPANION: …and enumerates no judges — but it looked at no block, which is NOT the population rule s proof', Array.isArray(forgeOnlyManifestAudit && forgeOnlyManifestAudit.judgeToolIdList) && forgeOnlyManifestAudit.judgeToolIdList.length === 0, JSON.stringify(forgeOnlyManifestAudit && forgeOnlyManifestAudit.judgeToolIdList));
												goldEvalCheckGates({ standardsDatabase, cleanManifestRefId, debugManifestRefId, forgeOnlyManifestRefId, twoJudgeManifestRefId, missingToolManifestRefId, otherJudgeManifestRefId, finish });
											});
										});
									});
								});
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
							// ⟪JOB 6⟫ TWO MORE FIXTURE MANIFESTS, both carrying REAL-JUDGE blocks (provenanceTier
							// embedding-inferred, NOT invalid-debug) so the enumeration is REACHABLE. A judged fixture
							// stamped invalid-debug would be refused by the pre-existing rule before any of this ran —
							// which is precisely what happens to every real artifact in this project today, measured.
							saveRelationship({ text: TWO_JUDGE_TEXT, subject: 'toy@1_0_rel_toyhub@1_0_twoJudges_close' }, (twoJudgeSaveError, twoJudgeSaved) => {
								harness.ok('the TWO-JUDGE relationship block saves', !twoJudgeSaveError, twoJudgeSaveError);
								saveRelationship({ text: MISSING_TOOL_TEXT, subject: 'toy@1_0_rel_toyhub@1_0_missingTool_close' }, (missingToolSaveError, missingToolSaved) => {
									harness.ok('the MISSING-mappingTool relationship block saves (the store does not police it — the sibling does)', !missingToolSaveError, missingToolSaveError);
									standardsDatabase.saveManifest({ name: 'twoJudges', description: 'two judges plus one specified edge', recipeName: 'fixture', recipeHash: 'j', recipeFileName: 'j', basedOnManifestRefId: null, members: [memberFor(baseSaved, 0), memberFor(twoJudgeSaved, 1)] }, (twoJudgeManifestError, twoJudgeManifest) => {
										harness.ok('the TWO-JUDGE manifest saves', !twoJudgeManifestError, twoJudgeManifestError);
										standardsDatabase.saveManifest({ name: 'missingTool', description: 'a judged edge carrying no mappingTool', recipeName: 'fixture', recipeHash: 'm', recipeFileName: 'm', basedOnManifestRefId: null, members: [memberFor(baseSaved, 0), memberFor(missingToolSaved, 1)] }, (missingToolManifestError, missingToolManifest) => {
											harness.ok('the MISSING-mappingTool manifest saves', !missingToolManifestError, missingToolManifestError);
											saveRelationship({ text: OTHER_JUDGE_TEXT, subject: 'toy@1_0_rel_toyhub@1_0_otherJudges_close' }, (otherJudgeSaveError, otherJudgeSaved) => {
												harness.ok('the OTHER-JUDGES relationship block saves (a DISJOINT judge set, for the MA5 repair)', !otherJudgeSaveError, otherJudgeSaveError);
												standardsDatabase.saveManifest({ name: 'otherJudges', description: 'two DIFFERENT judges', recipeName: 'fixture', recipeHash: 'o', recipeFileName: 'o', basedOnManifestRefId: null, members: [memberFor(baseSaved, 0), memberFor(otherJudgeSaved, 1)] }, (otherJudgeManifestError, otherJudgeManifest) => {
													harness.ok('the OTHER-JUDGES manifest saves', !otherJudgeManifestError, otherJudgeManifestError);
													runGates({ standardsDatabase, cleanManifestRefId: cleanManifest.refId, debugManifestRefId: debugManifest.refId, forgeOnlyManifestRefId: forgeOnlyManifest.refId, twoJudgeManifestRefId: twoJudgeManifest.refId, missingToolManifestRefId: missingToolManifest.refId, cleanBlockRefId: cleanSaved.refId, otherJudgeManifestRefId: otherJudgeManifest.refId });
												});
											});
										});
									});
								});
							});
						});
					});
				});
			});
		});
	});
});

