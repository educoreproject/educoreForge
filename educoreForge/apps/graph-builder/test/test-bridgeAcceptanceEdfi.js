#!/usr/bin/env node
'use strict';

// test-bridgeAcceptanceEdfi.js — the Ed-Fi plugin's ACCEPTANCE gates over the ARTIFACTS (SPEC-bridgeFramework-v1.md §12,
// §13.1 BG-P1..P7 "against the real block", BG-CENSUS (a) "live for Ed-Fi", BG-ACCEPT (a)(c)(e); the B3 order):
// reads the PINNED B3 acceptance store (decision store + standardsDatabase under system/dataStores/bridgeAcceptance/edfi/)
// and the committed fixtures under lib/bridge-framework/test/acceptance/, and asserts EQUALITIES — never existence.
// ONE-MACHINE (the pinned store is on this machine; a clone goes red BY NAME); no container, no LLM, no Voyage; the
// heaviest read is the CEDS base block's HubReference lines (~2 s).
//
// CONJUNCTS — each with a red twin (an in-memory INPUT FAULT on a copy of the block/fixture; three-state: the real
// artifact passes, the faulted copy is red, nothing in the tree changes):
//   BG-ACCEPT (a)  the pinned decision store holds the frozen DEBUG block (debugDecisionBlockId) and, once frozen, the
//                  REAL block (decisionBlockId); each recomputes to its own content address
//   BG-CENSUS (a)  the frozen REAL block's cardinalityCensus (both tables) EQUALS the fixture, member for member; the
//                  fixture's labelTableDigest / remodelTableDigest / declarationDigest EQUAL the block's; the pinned
//                  store carries the manifest the fixture's graphId names
//   BG-CENSUS (c)  the per-subject sum invariant: specified + judged + orphan + subjectCollision + sourceGap === subjectCount
//   BG-CENSUS (e)  every subject is in EXACTLY ONE per-subject bucket (recomputed from the records + refusals)
//   BG-CENSUS (f)  sourceSideMismatchCount ≤ judgedCount and every mismatch record is `judged`
//   BG-P1 (b)      indexCollisionCount === contentionCensus.contendedKeyCount
//   BG-P2 (a)(b)   every objectStableId is a HubReference stableId present in the CEDS base block; distinct objectStableIds
//                  EQUAL distinct card tuples among them
//   BG-P3 (a)(b)(c)(d) many → judged; zero → orphan with a reason and NO objectStableId; the buckets sum
//   BG-P4 (a)(b)(c)(d) justifications: no judged ManualMappingCuration; UnspecifiedMatching NOWHERE in the block text;
//                  every justification ∈ the three; specified ⇒ ManualMappingCuration, judged ⇒ CompositeMatching
//   BG-P5 (a)(b)(c) confidence PRESENT on every picked judged record, ABSENT (key absent) on every specified, and ∈ the band table
//   BG-P6 (a)(b)(c) predicate on every mapping record ∈ SKOS and asserted by the labelTable; no `predicate` key inside
//                  record.judge; predicateAssertedBy ∈ {source, labelTable, channelAssertion}
//   BG-P7 / BG-ACCEPT (e) the SSSOM export for the REAL block exists under matchForensics/<pairKey>/<id>.sssom.tsv, parses
//                  (the framework's PROXY validator), every subject_id splits into exactly ONE declared prefix ('edfi') and
//                  a colon-free reference; and, when the sssom-py venv is present (system/dataStores/bridgeAcceptance/
//                  sssomVenv, ONE-MACHINE, labelled), `sssom validate` blesses the file
//
// Run: node apps/graph-builder/test/test-bridgeAcceptanceEdfi.js   (</dev/null in the fleet)

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the Ed-Fi bridge plugin's acceptance gates over the pinned artifacts (census EQUAL, ids, Profile §7)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Reads the pinned B3 decision store + standardsDatabase and the committed fixtures; asserts the frozen block ids,
     the census EQUALITY (both tables, every member), the per-subject invariants, Profile §7's seven gates over the REAL
     block's records, and the SSSOM export's validity (PROXY + sssom-py when its venv is present). Every conjunct has an
     in-memory input-fault twin observed red. ONE-MACHINE (pinned store); no container, no LLM, no Voyage.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const treeRoot = path.join(__dirname, '..', '..', '..');
const acceptanceDir = path.join(treeRoot, 'lib', 'bridge-framework', 'test', 'acceptance');
const pinnedDir = path.join(treeRoot, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfi');
const sssomVenvBinPath = path.join(treeRoot, '..', '..', 'dataStores', 'bridgeAcceptance', 'sssomVenv', 'bin', 'sssom');
const BRIDGE_NAME = 'edfiCedsCrosswalkPlugin';
const PAIR_KEY = 'ceds@14.0.0.0::edfi@5.2.0::edfiCedsCrosswalkPlugin::authored';
const CEDS_BASE_REF_ID = '09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9eacec765962fe487c33';
const SUBJECT_PREFIX = 'edfi';

const contentAddress = require(path.join(treeRoot, 'lib', 'content-address', 'content-address'))();
const vocabularyLib = require(path.join(treeRoot, 'lib', 'vocabulary', 'vocabulary'));
const sssomExporterLib = require(path.join(treeRoot, 'lib', 'bridge-framework', 'sssomExporter'));
const confidenceBandTable = require(path.join(treeRoot, 'lib', 'bridge-framework', 'confidenceBandTable'));

const { SKOS_PREDICATES } = vocabularyLib;
const JUSTIFICATION_LIST = ['semapv:ManualMappingCuration', 'semapv:CompositeMatching', 'semapv:MappingReview'];
const PREDICATE_ASSERTED_BY_LIST = ['source', 'labelTable', 'channelAssertion'];
const BAND_VALUE_LIST = Object.keys(confidenceBandTable.CONFIDENCE_BAND_TABLE || { strong: 0.9, moderate: 0.7, weakButReal: 0.5 }).map((oneBand) => (confidenceBandTable.CONFIDENCE_BAND_TABLE || { strong: 0.9, moderate: 0.7, weakButReal: 0.5 })[oneBand]);

const stripJsoncComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const expectedCensus = readJson(path.join(acceptanceDir, `expectedCensus.${BRIDGE_NAME}.GOLD_EVAL_260816.json`));
const expectedIds = readJson(path.join(acceptanceDir, 'expectedDecisionBlockIds.json')).byBridgeName[BRIDGE_NAME];
const acceptanceCommands = JSON.parse(stripJsoncComments(fs.readFileSync(path.join(acceptanceDir, 'acceptanceCommands.jsonc'), 'utf8')))[BRIDGE_NAME];
const fixture = expectedCensus.byBridgeName[BRIDGE_NAME];

// ---------------------------------------------------------------------
// artifacts — read ONCE, read-only
// ---------------------------------------------------------------------
harness.section('SECTION 0 — the pinned artifacts (ONE-MACHINE; absent = refused by name)');
const decisionStorePath = acceptanceCommands.decisionStoreFilePath;
const standardsDatabasePath = acceptanceCommands.storeFilePath;
harness.ok(`the pinned decision store is on disk: ${decisionStorePath}`, fs.existsSync(decisionStorePath));
harness.ok(`the pinned standardsDatabase is on disk: ${standardsDatabasePath}`, fs.existsSync(standardsDatabasePath));
if (!fs.existsSync(decisionStorePath) || !fs.existsSync(standardsDatabasePath)) {
	harness.note('the pinned artifacts are absent — every conjunct below is UNMEASURED and the suite fails by name');
	harness.report();
	return;
}
const decisionDb = new Database(decisionStorePath, { readonly: true });
const blockRowFor = (decisionBlockHash) => (decisionBlockHash ? decisionDb.prepare('SELECT decisionBlockHash, frozenText FROM decisionBlocks WHERE decisionBlockHash = ?').get(decisionBlockHash) : undefined);
const parseBlock = (row) => (row ? JSON.parse(typeof row.frozenText === 'string' ? row.frozenText : row.frozenText.toString('utf8')) : null);
const debugRow = blockRowFor(expectedIds.debugDecisionBlockId);
const realRow = blockRowFor(expectedIds.decisionBlockId);
harness.ok(`BG-ACCEPT (a) the frozen DEBUG block ${String(expectedIds.debugDecisionBlockId).slice(0, 12)}… is in the pinned decision store`, !!debugRow, expectedIds.debugDecisionBlockId);
harness.ok(`BG-ACCEPT (a) the frozen REAL block ${String(expectedIds.decisionBlockId).slice(0, 12)}… is in the pinned decision store (null-and-honest = UNMEASURED = red until frozen)`, !!realRow, `decisionBlockId ${expectedIds.decisionBlockId}`);
[['debug', debugRow], ['real', realRow]].forEach(([label, oneRow]) => {
	if (oneRow) {
		const recomputed = contentAddress.blockIdForText(typeof oneRow.frozenText === 'string' ? oneRow.frozenText : oneRow.frozenText.toString('utf8'));
		harness.equal(`    the ${label} block's text recomputes to its content address`, recomputed, oneRow.decisionBlockHash);
	}
});
const block = parseBlock(realRow || debugRow); // the REAL block when frozen; the debug block carries the same census (measured) so the invariants still run
const blockLabel = realRow ? 'REAL' : 'DEBUG (real not yet frozen)';
harness.note(`the invariants below run over the ${blockLabel} block`);
if (!block) {
	harness.report();
	return;
}
const R = block.decisionRecordList;
const SEP = String.fromCharCode(0x1f);

// the CEDS base block's HubReference cards: stableId → tuple (canonicalKey|domainId|qualifierKeys sorted)
const standardsDb = new Database(standardsDatabasePath, { readonly: true });
const manifestRow = standardsDb.prepare('SELECT refId FROM manifests WHERE refId = ?').get(expectedCensus.graphId.split('@manifest:')[1]);
harness.ok(`BG-CENSUS (a) the pinned store carries the manifest the fixture's graphId names (${expectedCensus.graphId})`, !!manifestRow);
const cedsBlockRow = standardsDb.prepare('SELECT text FROM blocks WHERE refId = ?').get(CEDS_BASE_REF_ID);
harness.ok('the CEDS hub-bearing base block reads from the pinned store', !!cedsBlockRow);
const cardTupleByStableId = {};
if (cedsBlockRow) {
	const cedsText = typeof cedsBlockRow.text === 'string' ? cedsBlockRow.text : cedsBlockRow.text.toString('utf8');
	cedsText.split('\n').forEach((oneLine) => {
		if (oneLine.indexOf('"HubReference"') === -1 || oneLine.indexOf('"kind":"node"') === -1) {
			return;
		}
		const rec = JSON.parse(oneLine);
		const p = rec.properties || {};
		const scalar = (value) => (Array.isArray(value) ? value[0] : value);
		const qualifierKeys = Array.isArray(p.qualifierKeys) ? p.qualifierKeys.slice().sort() : [];
		cardTupleByStableId[rec.stableId] = `${scalar(p.canonicalKey)}|${scalar(p.domainId)}|${qualifierKeys.join(',')}`;
	});
}
harness.ok(`    ${Object.keys(cardTupleByStableId).length} HubReference cards indexed from the CEDS block (property + value tiers)`, Object.keys(cardTupleByStableId).length > 2777);

// ---------------------------------------------------------------------
// the conjuncts as PURE functions of (block, fixture, cardTupleByStableId) — run on the real artifact, then on faulted copies
// ---------------------------------------------------------------------
const clone = (value) => JSON.parse(JSON.stringify(value));
const perSubjectBuckets = (oneBlock) => {
	const bucket = {};
	oneBlock.decisionRecordList.forEach((r) => r.assertingSubjectList.forEach((s) => { const cur = bucket[s] || { res: new Set() }; cur.res.add(r.resolution === null ? 'orphan' : r.resolution); bucket[s] = cur; }));
	const collision = new Set(); oneBlock.refusalList.filter((x) => x.kind === 'subjectCollision').forEach((x) => Object.keys(x.targetSetBySubjectKey || {}).forEach((k) => collision.add(k)));
	const gap = new Set(oneBlock.refusalList.filter((x) => x.kind === 'sourceGap').map((x) => x.subjectKey));
	const bucketOf = (k) => (collision.has(k) ? 'subjectCollision' : gap.has(k) ? 'sourceGap' : bucket[k].res.has('specified') ? 'specified' : bucket[k].res.has('judged') ? 'judged' : 'orphan');
	const allKeys = new Set([...Object.keys(bucket), ...collision, ...gap]);
	const tally = { specified: 0, judged: 0, orphan: 0, subjectCollision: 0, sourceGap: 0 };
	allKeys.forEach((k) => { tally[bucketOf(k)] += 1; });
	return { tally, subjectCount: allKeys.size };
};
const CONJUNCT_REGISTRY = [
	{ id: 'BG-CENSUS a census EQUAL', check: (b) => ({ pass: JSON.stringify(b.header.cardinalityCensus) === JSON.stringify(fixture.cardinalityCensus), detail: JSON.stringify(b.header.cardinalityCensus.perSubject) }) },
	{ id: 'BG-CENSUS a digests EQUAL (label / remodel / declaration)', check: (b) => ({ pass: b.header.labelTableDigest === fixture.labelTableDigest && b.header.remodelTableDigest === fixture.remodelTableDigest && b.header.declarationDigest === fixture.declarationDigest, detail: `${b.header.labelTableDigest.slice(0, 8)} ${b.header.remodelTableDigest.slice(0, 8)} ${b.header.declarationDigest.slice(0, 8)} vs fixture ${fixture.labelTableDigest.slice(0, 8)} ${fixture.remodelTableDigest.slice(0, 8)} ${fixture.declarationDigest.slice(0, 8)}` }) },
	{ id: 'BG-CENSUS c per-subject sum invariant', check: (b) => { const s = b.header.cardinalityCensus.perSubject; const sum = s.specifiedSubjectCount + s.judgedSubjectCount + s.orphanSubjectCount + s.subjectCollisionCount + s.sourceGapCount; return { pass: sum === s.subjectCount, detail: `${sum} vs ${s.subjectCount}` }; } },
	{ id: 'BG-CENSUS e every subject in EXACTLY ONE bucket (recomputed)', check: (b) => { const { tally, subjectCount } = perSubjectBuckets(b); const s = b.header.cardinalityCensus.perSubject; const pass = subjectCount === s.subjectCount && tally.specified === s.specifiedSubjectCount && tally.judged === s.judgedSubjectCount && tally.orphan === s.orphanSubjectCount && tally.subjectCollision === s.subjectCollisionCount && tally.sourceGap === s.sourceGapCount; return { pass, detail: JSON.stringify(tally) }; } },
	{ id: 'BG-CENSUS f mismatch ≤ judged; every mismatch record judged', check: (b) => { const t = b.header.cardinalityCensus.perTarget; const mm = b.decisionRecordList.filter((r) => r.judgedReason === 'sourceSideMismatch'); return { pass: t.sourceSideMismatchCount <= t.judgedCount && mm.length === t.sourceSideMismatchCount && mm.every((r) => r.resolution === 'judged'), detail: `${mm.length} mismatch records, ${t.judgedCount} judged` }; } },
	{ id: 'BG-P1 b indexCollisionCount === contendedKeyCount', check: (b) => ({ pass: b.header.cardinalityCensus.perTarget.indexCollisionCount === b.header.contentionCensus.contendedKeyCount, detail: `${b.header.cardinalityCensus.perTarget.indexCollisionCount} vs ${b.header.contentionCensus.contendedKeyCount}` }) },
	{ id: 'BG-P2 a every objectStableId is a HubReference card in the CEDS block', check: (b) => { const objs = b.decisionRecordList.filter((r) => r.objectStableId !== null).map((r) => r.objectStableId); const missing = objs.filter((oneId) => cardTupleByStableId[oneId] === undefined); return { pass: objs.length > 0 && missing.length === 0, detail: `${objs.length} objects, ${missing.length} missing` }; } },
	{ id: 'BG-P2 b distinct objectStableIds === distinct card tuples', check: (b) => { const objs = new Set(b.decisionRecordList.filter((r) => r.objectStableId !== null).map((r) => r.objectStableId)); const tuples = new Set(Array.from(objs).map((oneId) => cardTupleByStableId[oneId])); return { pass: objs.size === tuples.size, detail: `${objs.size} objects, ${tuples.size} tuples` }; } },
	{ id: 'BG-P3 a many → judged', check: (b) => { const many = b.decisionRecordList.filter((r) => r.filteredPoolStableIdList.length > 1); return { pass: many.length > 0 && many.every((r) => r.resolution === 'judged'), detail: `${many.length} many-pool records` }; } },
	{ id: 'BG-P3 b/c zero → orphan with a reason and NO object', check: (b) => { const zero = b.decisionRecordList.filter((r) => r.filteredPoolStableIdList.length === 0 && r.keyPoolStableIdList.length === 0); return { pass: zero.length > 0 && zero.every((r) => r.classification === 'orphan' && typeof r.reason === 'string' && r.reason.length > 0 && r.objectStableId === null), detail: `${zero.length} zero-pool records` }; } },
	{ id: 'BG-P3 d per-target buckets sum (specified + judged + orphan === targetCount)', check: (b) => { const t = b.header.cardinalityCensus.perTarget; return { pass: t.specifiedCount + t.judgedCount + t.orphanCount === t.targetCount && t.targetCount === b.decisionRecordList.length, detail: `${t.specifiedCount}+${t.judgedCount}+${t.orphanCount} vs ${t.targetCount} (${b.decisionRecordList.length} records)` }; } },
	{ id: 'BG-P4 a no judged record carries ManualMappingCuration', check: (b) => ({ pass: b.decisionRecordList.filter((r) => r.resolution === 'judged' && r.mappingJustification === 'semapv:ManualMappingCuration').length === 0, detail: '' }) },
	{ id: 'BG-P4 b UnspecifiedMatching appears NOWHERE in the block', check: (b) => ({ pass: JSON.stringify(b).indexOf('UnspecifiedMatching') === -1, detail: '' }) },
	{ id: 'BG-P4 c every justification ∈ the three', check: (b) => { const bad = b.decisionRecordList.filter((r) => r.mappingJustification !== undefined && r.mappingJustification !== null && JUSTIFICATION_LIST.indexOf(r.mappingJustification) === -1); return { pass: bad.length === 0, detail: `${bad.length} outside` }; } },
	{ id: 'BG-P4 d specified ⇒ ManualMappingCuration, judged ⇒ CompositeMatching (table walk)', check: (b) => { const table = { specified: 'semapv:ManualMappingCuration', judged: 'semapv:CompositeMatching' }; const bad = b.decisionRecordList.filter((r) => r.resolution !== null && r.mappingJustification !== table[r.resolution]); return { pass: bad.length === 0, detail: `${bad.length} off-table` }; } },
	{ id: 'BG-P5 a confidence PRESENT on every picked judged record', check: (b) => { const picked = b.decisionRecordList.filter((r) => r.resolution === 'judged' && r.abstained !== true); return { pass: picked.length > 0 && picked.every((r) => typeof r.confidence === 'number'), detail: `${picked.length} picked` }; } },
	{ id: 'BG-P5 b confidence ABSENT (key absent) on every specified record', check: (b) => { const spec = b.decisionRecordList.filter((r) => r.resolution === 'specified'); return { pass: spec.length > 0 && spec.every((r) => !Object.prototype.hasOwnProperty.call(r, 'confidence')), detail: `${spec.length} specified` }; } },
	{ id: 'BG-P5 c every confidence ∈ the band table', check: (b) => { const vals = b.decisionRecordList.filter((r) => typeof r.confidence === 'number').map((r) => r.confidence); return { pass: vals.every((v) => BAND_VALUE_LIST.indexOf(v) !== -1), detail: `values ${Array.from(new Set(vals)).join(', ')} vs bands ${BAND_VALUE_LIST.join(', ')}` }; } },
	{ id: 'BG-P6 a/c predicate ∈ SKOS on every mapping record and asserted by the label table', check: (b) => { const mapping = b.decisionRecordList.filter((r) => r.objectStableId !== null); return { pass: mapping.length > 0 && mapping.every((r) => SKOS_PREDICATES.indexOf(r.predicate) !== -1 && PREDICATE_ASSERTED_BY_LIST.indexOf(r.predicateAssertedBy) !== -1 && r.predicateAssertedBy === 'labelTable'), detail: `${mapping.length} mapping records` }; } },
	{ id: "BG-P6 b no `predicate` key inside record.judge (the judge's return never carries one)", check: (b) => ({ pass: b.decisionRecordList.filter((r) => r.judge && Object.prototype.hasOwnProperty.call(r.judge, 'predicate')).length === 0, detail: '' }) },
];
const twinFor = {
	'BG-CENSUS a census EQUAL': (b) => { b.header.cardinalityCensus.perSubject.specifiedSubjectCount -= 1; },
	'BG-CENSUS a digests EQUAL (label / remodel / declaration)': (b) => { b.header.labelTableDigest = '0'.repeat(64); },
	'BG-CENSUS c per-subject sum invariant': (b) => { b.header.cardinalityCensus.perSubject.judgedSubjectCount += 1; },
	'BG-CENSUS e every subject in EXACTLY ONE bucket (recomputed)': (b) => { b.decisionRecordList.pop(); },
	'BG-CENSUS f mismatch ≤ judged; every mismatch record judged': (b) => { const r = b.decisionRecordList.find((x) => x.judgedReason === 'sourceSideMismatch'); r.resolution = 'specified'; },
	'BG-P1 b indexCollisionCount === contendedKeyCount': (b) => { b.header.contentionCensus.contendedKeyCount += 1; },
	'BG-P2 a every objectStableId is a HubReference card in the CEDS block': (b) => { const r = b.decisionRecordList.find((x) => x.objectStableId !== null); r.objectStableId = 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/notacard'; },
	'BG-P2 b distinct objectStableIds === distinct card tuples': (b) => { const spec = b.decisionRecordList.filter((x) => x.resolution === 'specified'); spec[1].objectStableId = spec[0].objectStableId + '#dup'; cardTupleByStableId[spec[1].objectStableId] = cardTupleByStableId[spec[0].objectStableId]; },
	'BG-P3 a many → judged': (b) => { const r = b.decisionRecordList.find((x) => x.filteredPoolStableIdList.length > 1); r.resolution = 'specified'; },
	'BG-P3 b/c zero → orphan with a reason and NO object': (b) => { const r = b.decisionRecordList.find((x) => x.classification === 'orphan'); r.objectStableId = 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/bestguess'; },
	'BG-P3 d per-target buckets sum (specified + judged + orphan === targetCount)': (b) => { b.header.cardinalityCensus.perTarget.orphanCount += 1; },
	'BG-P4 a no judged record carries ManualMappingCuration': (b) => { const r = b.decisionRecordList.find((x) => x.resolution === 'judged'); r.mappingJustification = 'semapv:ManualMappingCuration'; },
	'BG-P4 b UnspecifiedMatching appears NOWHERE in the block': (b) => { b.decisionRecordList[0].mappingJustification = 'semapv:UnspecifiedMatching'; },
	'BG-P4 c every justification ∈ the three': (b) => { b.decisionRecordList[0].mappingJustification = 'semapv:LexicalMatching'; },
	'BG-P4 d specified ⇒ ManualMappingCuration, judged ⇒ CompositeMatching (table walk)': (b) => { const r = b.decisionRecordList.find((x) => x.resolution === 'specified'); r.mappingJustification = 'semapv:CompositeMatching'; },
	'BG-P5 a confidence PRESENT on every picked judged record': (b) => { const r = b.decisionRecordList.find((x) => x.resolution === 'judged' && x.abstained !== true); delete r.confidence; },
	'BG-P5 b confidence ABSENT (key absent) on every specified record': (b) => { const r = b.decisionRecordList.find((x) => x.resolution === 'specified'); r.confidence = 1.0; },
	'BG-P5 c every confidence ∈ the band table': (b) => { const r = b.decisionRecordList.find((x) => typeof x.confidence === 'number'); r.confidence = 0.7314; },
	'BG-P6 a/c predicate ∈ SKOS on every mapping record and asserted by the label table': (b) => { const r = b.decisionRecordList.find((x) => x.objectStableId !== null); r.predicate = 'relatedMatch'; r.predicateAssertedBy = 'judge'; },
	"BG-P6 b no `predicate` key inside record.judge (the judge's return never carries one)": (b) => { const r = b.decisionRecordList.find((x) => x.judge); r.judge.predicate = 'relatedMatch'; },
};

harness.section(`SECTION 1 — the conjuncts over the ${blockLabel} block (EQUALITIES), then THE TWIN SWEEP (input faults on a copy → red)`);
CONJUNCT_REGISTRY.forEach((oneConjunct) => {
	const verdict = oneConjunct.check(block);
	harness.ok(`${oneConjunct.id}${verdict.detail ? ` — ${verdict.detail}` : ''}`, verdict.pass === true, verdict.detail);
});
CONJUNCT_REGISTRY.forEach((oneConjunct) => {
	const faulted = clone(block);
	const savedTuples = { ...cardTupleByStableId };
	twinFor[oneConjunct.id](faulted);
	const verdict = oneConjunct.check(faulted);
	Object.keys(cardTupleByStableId).forEach((k) => { if (savedTuples[k] === undefined) { delete cardTupleByStableId[k]; } });
	harness.ok(`RED-OBSERVED ${oneConjunct.id}`, verdict.pass !== true, `the fault did not redden it (${verdict.detail})`);
});

// ---------------------------------------------------------------------
// SECTION 2 — BG-P7 / BG-ACCEPT (e): the SSSOM export of the REAL block
// ---------------------------------------------------------------------
harness.section('SECTION 2 — BG-P7 / BG-ACCEPT (e): the REAL block\'s SSSOM export parses, subject_id single-prefix, sssom-py when present');
const sssomPath = expectedIds.decisionBlockId ? path.join(acceptanceCommands.matchForensicsDirPath, PAIR_KEY, `${expectedIds.decisionBlockId}.sssom.tsv`) : null;
harness.ok(`the SSSOM export exists for the frozen REAL block (${sssomPath || 'no real block frozen'})`, !!sssomPath && fs.existsSync(sssomPath));
if (sssomPath && fs.existsSync(sssomPath)) {
	const text = fs.readFileSync(sssomPath, 'utf8');
	const parsed = sssomExporterLib.parseSssomTsv(text);
	harness.ok('BG-P7 a (PROXY) the TSV parses with the mandatory columns', !parsed.error, parsed.error);
	if (!parsed.error) {
		const badSubject = parsed.rowList.filter((oneRow) => { const parts = oneRow.subject_id.split(':'); return !(parts.length === 2 && parts[0] === SUBJECT_PREFIX && parts[1].length > 0) && !(oneRow.subject_id.startsWith(`${SUBJECT_PREFIX}:`) && oneRow.subject_id.slice(SUBJECT_PREFIX.length + 1).indexOf(':') === -1); });
		harness.equal(`BG-P7 h every subject_id is ONE declared prefix ('${SUBJECT_PREFIX}') + a colon-free reference (${parsed.rowList.length} rows)`, badSubject.length, 0);
		harness.ok('    the curie map declares the subject prefix', parsed.headerLineList.some((oneLine) => /curie_map/.test(oneLine)) && parsed.headerLineList.some((oneLine) => new RegExp(`\\b${SUBJECT_PREFIX}:`).test(oneLine)));
		harness.ok('    UnspecifiedMatching appears nowhere in the TSV', text.indexOf('UnspecifiedMatching') === -1);
		harness.ok('    mapping_provider is the verified provider', parsed.headerLineList.some((oneLine) => /mapping_provider: https:\/\/ceds\.ed\.gov\//.test(oneLine)));
		// RED twin (input fault): a doubled prefix on one row
		const doubled = parsed.rowList.map((oneRow) => ({ ...oneRow }));
		doubled[0].subject_id = `${SUBJECT_PREFIX}:${doubled[0].subject_id}`;
		harness.ok('RED-OBSERVED BG-P7 h — a doubled prefix on one row is caught', doubled.filter((oneRow) => oneRow.subject_id.slice(SUBJECT_PREFIX.length + 1).indexOf(':') !== -1).length === 1);
	}
	if (fs.existsSync(sssomVenvBinPath)) {
		const validated = spawnSync(sssomVenvBinPath, ['validate', sssomPath], { encoding: 'utf8' });
		harness.ok(`BG-P7 a (REAL, sssom-py ONE-MACHINE at ${sssomVenvBinPath}) \`sssom validate\` exits 0`, validated.status === 0, `${(validated.stdout || '').slice(-400)}\n${(validated.stderr || '').slice(-800)}`);
	} else {
		harness.note(`sssom-py venv absent at ${sssomVenvBinPath} — BG-P7 (a) measured by the PROXY validator only (labelled)`);
	}
}

decisionDb.close();
standardsDb.close();
harness.report();
