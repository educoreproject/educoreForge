#!/usr/bin/env node
'use strict';

// phaseC-gate-verifier.js — READ-ONLY verification of gates G-C1, G-C3, G-C6
// (pairwiseVersionSwitching Phase C). Opens the store read-only (better-sqlite3, the
// Phase-0 census pattern) and reconciles against the FROZEN baselines/mappingInventory-
// preC.json (supervisor note 2: the gate's numbers come from the frozen file, never
// fresh counting).
//
//   node baselines/phaseC-gate-verifier.js [--db=<path>]
//
// G-C1: every source block untouched — sha256(text) === blockId (the content address
//       re-verifies) and row subject/version/producedBy equal the frozen values.
// G-C3: for every frozen inventory member, EXACTLY ONE transformed twin exists
//       (producedBy 'edf-rekey', header.sourceBlockId = the member); its edge-line
//       region digests IDENTICALLY to the frozen edgeRegionDigest (D13 convention);
//       counts reconcile per-block and in total (24,926); row subject/version and
//       header tierScope equal the disposition table's pre-declared values. An
//       undispositioned member is a phase failure.
// G-C6: exactly the 13 expected pairs have a CURRENT pair-group; none empty; every
//       member exists, is type 'mapping', and is filed under the pair@versionKey;
//       __TEST_ residue appears nowhere (F8).
//
// Exit 0 = ALL GREEN; exit 1 = any failure (each named).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const CODE = path.join(__dirname, '..');
const Database = require(path.join(CODE, 'node_modules', 'better-sqlite3'));

const dbArg = process.argv.find((oneArg) => oneArg.startsWith('--db='));
const dbPath = dbArg
	? dbArg.slice('--db='.length)
	: path.join(CODE, '..', 'dataStores', 'forgeStore.sqlite3');

const frozen = JSON.parse(
	fs.readFileSync(path.join(__dirname, 'mappingInventory-preC.json'), 'utf8'),
);

const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex');
// D13: the frozen digest convention — lines 2..N, empties dropped, '\n'-joined, no trailer.
const edgeRegionDigest = (text) =>
	sha256Hex(
		`${text}`
			.split('\n')
			.slice(1)
			.filter((oneLine) => oneLine.trim().length > 0)
			.join('\n'),
	);

// the disposition table's pre-declared pair + tierScope per source block (DEVLOG §5;
// D10 EduAPI casing, D12 CIP::SOC crosswalk ruling).
const EXPECTED_BY_SOURCE_PREFIX = {
	'5388a1576b23': { pair: 'CEDS::CASE', tierScope: 'property' },
	'172bfa58cfff': { pair: 'CEDS::CLR', tierScope: 'property' },
	a5b9e462d857: { pair: 'CEDS::CTDL', tierScope: 'property' },
	'0b0218d0e8ca': { pair: 'CEDS::CTDL', tierScope: 'value' },
	'4cd14d66d130': { pair: 'CEDS::CTDL', tierScope: 'value' },
	'907f73dcfd02': { pair: 'CEDS::EdFi', tierScope: 'property' },
	'6b8046f17f74': { pair: 'CEDS::JEDx', tierScope: 'property' },
	adc6f313184a: { pair: 'CEDS::LIF', tierScope: 'property' },
	dcfccc2f1aec: { pair: 'CEDS::LIF', tierScope: 'value' },
	'5570d920edc5': { pair: 'CEDS::MedBiquitous', tierScope: 'property' },
	a397a721cf95: { pair: 'CEDS::OpenBadges', tierScope: 'property' },
	d5e3338b62ca: { pair: 'CEDS::PESC', tierScope: 'property' },
	'9e5c49a07d34': { pair: 'CEDS::SEDM', tierScope: 'property' },
	'8acb9de57277': { pair: 'CEDS::SEDM', tierScope: 'value' },
	'07f0b78a19cc': { pair: 'CEDS::SIF', tierScope: 'property' },
	b28e9c7136a7: { pair: 'CEDS::SIF', tierScope: 'property' },
	'23890153b369': { pair: 'CEDS::SIF', tierScope: 'value' },
	'21cbdda40fef': { pair: 'CIP::SOC', tierScope: 'crosswalk' },
	'6d5d3272e6ea': { pair: 'CEDS::EduAPI', tierScope: 'property' },
	a7c3ec6fb2ec: { pair: 'CEDS::EduAPI', tierScope: 'value' },
};
const EXPECTED_PAIRS = [
	'CEDS::CASE',
	'CEDS::CLR',
	'CEDS::CTDL',
	'CEDS::EdFi',
	'CEDS::EduAPI',
	'CEDS::JEDx',
	'CEDS::LIF',
	'CEDS::MedBiquitous',
	'CEDS::OpenBadges',
	'CEDS::PESC',
	'CEDS::SEDM',
	'CEDS::SIF',
	'CIP::SOC',
];
const VERSION_KEY = '(01,01)';

const problems = [];
const note = (gate, message) => problems.push(`${gate}: ${message}`);

const db = new Database(dbPath, { readonly: true });

// ---- G-C1: originals untouched --------------------------------------------------
frozen.inventory.forEach((oneFrozen) => {
	const row = db
		.prepare('SELECT blockId, type, subject, version, producedBy, text FROM blocks WHERE blockId=?')
		.get(oneFrozen.blockId);
	if (!row) {
		note('G-C1', `source block ${oneFrozen.blockId} MISSING from the store`);
		return;
	}
	if (sha256Hex(row.text) !== row.blockId) {
		note('G-C1', `source block ${oneFrozen.blockId} content digest MOVED`);
	}
	if (row.subject !== oneFrozen.subject || row.producedBy !== oneFrozen.producedBy) {
		note('G-C1', `source block ${oneFrozen.blockId} row metadata changed (${row.subject}/${row.producedBy})`);
	}
});

// ---- G-C3: the transform keystone ------------------------------------------------
const rekeyRows = db
	.prepare("SELECT blockId, type, subject, version, producedBy, text FROM blocks WHERE producedBy='edf-rekey'")
	.all();
const twinsBySource = {};
rekeyRows.forEach((oneRow) => {
	let header;
	try {
		header = JSON.parse(`${oneRow.text}`.split('\n')[0]);
	} catch (parseErr) {
		note('G-C3', `transformed block ${oneRow.blockId} header unparseable`);
		return;
	}
	(twinsBySource[header.sourceBlockId] = twinsBySource[header.sourceBlockId] || []).push({
		row: oneRow,
		header,
	});
});

let edgeTotal = 0;
frozen.inventory.forEach((oneFrozen) => {
	// the disposition table's RULED-OUT-BY-NAME members (DEVLOG §5 rows 21-37): the
	// reference block (hub scaffold, spec §4.3 — fresh emissions only) is in the frozen
	// inventory but is NOT transformed; assert it has NO transformed twin.
	if (oneFrozen.type === 'reference') {
		if ((twinsBySource[oneFrozen.blockId] || []).length > 0) {
			note('G-C3', `ruled-out reference block ${oneFrozen.blockId.slice(0, 12)} HAS a transformed twin — the ruling was violated`);
		}
		return;
	}
	const expected = EXPECTED_BY_SOURCE_PREFIX[oneFrozen.blockId.slice(0, 12)];
	if (!expected) {
		note('G-C3', `UNDISPOSITIONED member ${oneFrozen.blockId} (${oneFrozen.subject}) — phase failure`);
		return;
	}
	const twins = twinsBySource[oneFrozen.blockId] || [];
	if (twins.length !== 1) {
		note('G-C3', `${oneFrozen.subject} ${oneFrozen.blockId.slice(0, 12)}: ${twins.length} transformed twins (want 1)`);
		return;
	}
	const { row, header } = twins[0];
	const digest = edgeRegionDigest(row.text);
	if (digest !== oneFrozen.edgeRegionDigest) {
		note('G-C3', `${oneFrozen.subject}: edge-region digest MISMATCH (${digest.slice(0, 12)} vs frozen ${oneFrozen.edgeRegionDigest.slice(0, 12)})`);
	}
	const edgeCount = `${row.text}`.split('\n').slice(1).filter((l) => l.trim().length > 0).length;
	if (edgeCount !== oneFrozen.edgeLineCount) {
		note('G-C3', `${oneFrozen.subject}: edge count ${edgeCount} vs frozen ${oneFrozen.edgeLineCount}`);
	}
	edgeTotal += edgeCount;
	if (row.subject !== expected.pair || row.version !== VERSION_KEY) {
		note('G-C3', `${oneFrozen.subject}: transformed row filed under '${row.subject}'@'${row.version}' (want '${expected.pair}'@'${VERSION_KEY}')`);
	}
	if (header.tierScope !== expected.tierScope) {
		note('G-C3', `${oneFrozen.subject}: tierScope '${header.tierScope}' (want '${expected.tierScope}')`);
	}
	if (header.originalProducedBy !== oneFrozen.producedBy) {
		note('G-C3', `${oneFrozen.subject}: originalProducedBy '${header.originalProducedBy}' (want '${oneFrozen.producedBy}')`);
	}
});
if (edgeTotal !== frozen.mappingEdgeTotal) {
	note('G-C3', `edge total ${edgeTotal} vs frozen ${frozen.mappingEdgeTotal}`);
}

// ---- G-C6: exactly one CURRENT group per pair ------------------------------------
const pointerRows = db.prepare('SELECT pairSubject, versionKey, currentGroupBlockId FROM currentPairGroup ORDER BY pairSubject').all();
const pointerPairs = pointerRows.map((oneRow) => oneRow.pairSubject).sort();
if (JSON.stringify(pointerPairs) !== JSON.stringify([...EXPECTED_PAIRS].sort())) {
	note('G-C6', `CURRENT pair set mismatch: [${pointerPairs.join(', ')}]`);
}
pointerRows.forEach((oneRow) => {
	if (oneRow.versionKey !== VERSION_KEY) {
		note('G-C6', `${oneRow.pairSubject}: versionKey '${oneRow.versionKey}'`);
	}
	const groupRow = db.prepare('SELECT type, subject, text FROM blocks WHERE blockId=?').get(oneRow.currentGroupBlockId);
	if (!groupRow || groupRow.type !== 'pairGroup') {
		note('G-C6', `${oneRow.pairSubject}: CURRENT pointer aims at ${groupRow ? `type '${groupRow.type}'` : 'NOTHING'}`);
		return;
	}
	const content = JSON.parse(`${groupRow.text}`.split('\n')[1]);
	if (!Array.isArray(content.members) || content.members.length === 0) {
		note('G-C6', `${oneRow.pairSubject}: group is EMPTY`);
		return;
	}
	content.members.forEach((oneMemberId) => {
		const memberRow = db.prepare('SELECT type, subject, version FROM blocks WHERE blockId=?').get(oneMemberId);
		if (!memberRow) {
			note('G-C6', `${oneRow.pairSubject}: member ${oneMemberId} does not exist`);
			return;
		}
		if (memberRow.type !== 'mapping' || memberRow.subject !== oneRow.pairSubject || memberRow.version !== VERSION_KEY) {
			note('G-C6', `${oneRow.pairSubject}: member ${oneMemberId.slice(0, 12)} filed as ${memberRow.type}/${memberRow.subject}/${memberRow.version}`);
		}
		if (`${memberRow.subject}`.includes('__TEST_')) {
			note('G-C6', `${oneRow.pairSubject}: TEST residue member ${oneMemberId.slice(0, 12)} (F8 exclusion violated)`);
		}
	});
});

db.close();

const verdict = problems.length === 0 ? 'GREEN' : 'RED';
console.log(
	JSON.stringify(
		{
			verdict,
			dbPath,
			gates: { 'G-C1': 'sources untouched', 'G-C3': 'transform keystone', 'G-C6': 'CURRENT groups' },
			sourceCount: frozen.inventory.length,
			transformedTwinCount: Object.keys(twinsBySource).length,
			edgeTotal,
			currentPairGroups: pointerRows.length,
			problems,
		},
		null,
		2,
	),
);
process.exit(problems.length === 0 ? 0 : 1);
