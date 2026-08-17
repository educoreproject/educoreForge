'use strict';

// p2_blockContentDiffVectorised.js — LUNAR_PRISM (P2), 2026-08-17. READ-ONLY. RETAINED per O-7 and
// per RULING P2-R2 step 5: this is exactly the figure a successor will need to re-derive.
//
// **RULING P2-R2 STEP 1: DO NOT COMPARE IDS. COMPARE THE BLOCK CONTENT AND NAME THE FIELDS THAT
// DIFFER.** Two ids differing tells you only THAT something differs; it does not tell you WHAT, and
// the what is the whole question.
//
// THE QUESTION. The same PESC forge, over the same snapshot, in the same tree, produced two different
// standardBase block ids:
//     c46991d1…  from `--vectorize=false`  (P1's re-forge; reported as the named mover and COMMITTED)
//     f139654a…  from `--vectorize=true`   (both P2 census runs, independently)
// A block's refId is contentAddress.blockIdForText(blockText) ([code fact] replayManager.js:297, :894)
// — a content address over the block TEXT. `pureLayerFingerprint`'s DROPPED_PROPERTY_NAME_LIST, which
// I cited as proof that vectors cannot move an id, is a DIFFERENT COMPUTATION: fingerprint.js's own
// header says it "hashes an un-embedded pure output". Two hashes over one artifact answering
// different questions.
//
// THE THREE OUTCOMES, PRE-COMMITTED so the answer cannot be shaped after the fact (P2-R2 steps 2-4):
//   (A) THE ONLY DIFFERING PROPERTIES ARE `embedding` / `embeddingModelVersion` → reading (ii): my
//       committed id is simply the id of a VECTORLESS artifact, not a member of the vectorised
//       lineage. My error, no framework defect.
//   (B) SOMETHING ELSE DIFFERS TOO → name it, and say whether it SHOULD have been dropped. A third
//       field riding along with vectorisation would be a defect in the dropped-property list.
//   (C) NOTHING IN THE CONTENT DIFFERS AND THE IDS STILL DIFFER → the id is not a pure function of
//       the content it claims to cover. **That is a framework finding of the first order. Report and
//       stop.**
//
// Reads two sqlite stores read-only. No graph, no container, no embedder, no write.
// Run with a large heap: node --max-old-space-size=8000 <thisFile>

const { spawnSync } = require('child_process');

const moduleName = 'p2_blockContentDiffVectorised';
const NON_VECTORISED_STORE = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/p1_pesc260805_seat.standardsDatabase.sqlite3';
const VECTORISED_STORE = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/pescDerived/pescDerived.standardsDatabase.sqlite3';
const SUBJECT = 'pesc260805@aggregate_01_base';
const DROPPED_BY_FINGERPRINT = ['_id', '_source', 'embedding', 'embeddingModelVersion', 'stableId'];
// row-level keys are compared too (see the flatten note below) and are reported with a ROWKEY: prefix
// so a reader can see WHICH NESTING LEVEL a difference lives at rather than having to guess.
const DROPPED_ROW_KEY_EQUIVALENT = DROPPED_BY_FINGERPRINT.map((oneName) => `ROWKEY:${oneName}`);

const readBlock = (storePath) => {
	const ran = spawnSync('sqlite3', [storePath, `SELECT refId FROM blocks WHERE subject = '${SUBJECT}';`], { encoding: 'utf8' });
	if (ran.status !== 0) {
		return { error: `refId read failed on ${storePath}: exit ${ran.status} ${ran.stderr}` };
	}
	const refId = String(ran.stdout || '').trim();
	if (!refId) {
		return { error: `no block with subject '${SUBJECT}' in ${storePath} — a REAL absence, not a parse miss (the query succeeded)` };
	}
	const textRan = spawnSync('sqlite3', [storePath, `SELECT text FROM blocks WHERE subject = '${SUBJECT}';`], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
	if (textRan.status !== 0) {
		return { error: `text read failed on ${storePath}: exit ${textRan.status} ${textRan.stderr}` };
	}
	return { refId, text: String(textRan.stdout || '') };
};

const report = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const withoutVectors = readBlock(NON_VECTORISED_STORE);
const withVectors = readBlock(VECTORISED_STORE);
if (withoutVectors.error || withVectors.error) {
	report({ probe: moduleName, verdict: 'REFUSED', reason: withoutVectors.error || withVectors.error });
	process.exitCode = 1;
} else {
	// the block text is line-oriented node/edge rows. Index BOTH sides by stableId and compare the
	// property bags directly — this is a CONTENT comparison, never an id comparison.
	const indexOf = (text) => {
		const byStableId = {};
		let rowCount = 0;
		text.split('\n').forEach((oneLine) => {
			if (oneLine.indexOf('"stableId"') === -1) {
				return;
			}
			let parsed = null;
			try {
				parsed = JSON.parse(oneLine);
			} catch (parseError) {
				return;
			}
			const stableId = parsed && (parsed.stableId || (parsed.properties && parsed.properties.stableId));
			if (typeof stableId !== 'string') {
				return;
			}
			rowCount += 1;
			// ⚠️ FLATTEN ROW-LEVEL KEYS ALONGSIDE THE PROPERTY BAG. My first version compared ONLY
			// parsed.properties and returned a confident "(A) only dropped properties differ" — and it
			// was WRONG, because `embeddingRef` and `embeddingModelVersion` sit at ROW level, beside
			// `properties`, not inside it. THE BYTE COUNT IS WHAT CAUGHT IT: one differing field cannot
			// explain 7,033,793 bytes over 42,372 rows (~166 each), and two of my own measurements
			// disagreeing is the only reason I looked again. A diff that examines one nesting level and
			// reports on the whole artifact is the same genus of empty measurement as a gate that never
			// fires: a confident answer to a narrower question than the one asked.
			const flattened = { ...(parsed.properties || {}) };
			Object.keys(parsed).forEach((oneRowKey) => {
				if (oneRowKey !== 'properties') {
					flattened[`ROWKEY:${oneRowKey}`] = parsed[oneRowKey];
				}
			});
			byStableId[stableId] = flattened;
		});
		return { byStableId, rowCount };
	};

	const leftIndex = indexOf(withoutVectors.text);
	const rightIndex = indexOf(withVectors.text);

	if (leftIndex.rowCount === 0 || rightIndex.rowCount === 0) {
		report({
			probe: moduleName,
			verdict: 'REFUSED — NOT A CLEAN NEGATIVE',
			reason: `parsed ${leftIndex.rowCount} rows from the non-vectorised block and ${rightIndex.rowCount} from the vectorised one. A parse that finds nothing is NOT a measurement that nothing differs — fix the reader before concluding.`,
		});
		process.exitCode = 1;
	} else {
		const differingNameTally = {};
		const onlyOnOneSideTally = {};
		let comparedNodeCount = 0;
		let identicalNodeCount = 0;
		const exampleList = [];

		Object.keys(leftIndex.byStableId).forEach((oneStableId) => {
			const leftProperties = leftIndex.byStableId[oneStableId];
			const rightProperties = rightIndex.byStableId[oneStableId];
			if (rightProperties === undefined) {
				onlyOnOneSideTally.MISSING_FROM_VECTORISED = (onlyOnOneSideTally.MISSING_FROM_VECTORISED || 0) + 1;
				return;
			}
			comparedNodeCount += 1;
			const nameSet = [...new Set(Object.keys(leftProperties).concat(Object.keys(rightProperties)))];
			const differingNameList = nameSet.filter((oneName) => JSON.stringify(leftProperties[oneName]) !== JSON.stringify(rightProperties[oneName]));
			if (differingNameList.length === 0) {
				identicalNodeCount += 1;
				return;
			}
			differingNameList.forEach((oneName) => {
				differingNameTally[oneName] = (differingNameTally[oneName] || 0) + 1;
			});
			const unexpected = differingNameList.filter((oneName) => DROPPED_BY_FINGERPRINT.indexOf(oneName) === -1 && DROPPED_ROW_KEY_EQUIVALENT.indexOf(oneName) === -1);
			if (unexpected.length > 0 && exampleList.length < 4) {
				exampleList.push({ stableId: oneStableId, unexpectedDifferingNames: unexpected });
			}
		});

		const differingNameList = Object.keys(differingNameTally).sort();
		const unexpectedNameList = differingNameList.filter((oneName) => DROPPED_BY_FINGERPRINT.indexOf(oneName) === -1 && DROPPED_ROW_KEY_EQUIVALENT.indexOf(oneName) === -1);

		const verdict =
			differingNameList.length === 0
				? '(C) NOTHING IN THE CONTENT DIFFERS AND THE IDS STILL DIFFER — the block id is NOT a pure function of the content it covers. FRAMEWORK FINDING OF THE FIRST ORDER. Report and stop.'
				: unexpectedNameList.length === 0
					? '(A) THE ONLY DIFFERING PROPERTIES ARE ONES fingerprint.js DROPS — so the two blocks differ ONLY by vectorisation. READING (ii) IS TRUE BY MEASUREMENT: the committed id c46991d1 is the id of a VECTORLESS artifact and is NOT a member of the vectorised lineage. MY ERROR; NO FRAMEWORK DEFECT.'
					: `(B) SOMETHING BEYOND THE DROPPED PROPERTIES DIFFERS: [${unexpectedNameList.join(', ')}]. Name it and rule whether it SHOULD be dropped — a third field riding along with vectorisation would be a defect in the dropped-property list.`;

		report({
			probe: moduleName,
			method: 'RULING P2-R2 step 1 — CONTENT compared property-by-property over matched stableIds. Ids are reported for identification only and are NOT the comparison.',
			nonVectorised: { store: NON_VECTORISED_STORE, refId: withoutVectors.refId, bytes: withoutVectors.text.length, rowsParsed: leftIndex.rowCount },
			vectorised: { store: VECTORISED_STORE, refId: withVectors.refId, bytes: withVectors.text.length, rowsParsed: rightIndex.rowCount },
			comparedNodeCount,
			identicalNodeCount,
			nodesPresentOnOneSideOnly: onlyOnOneSideTally,
			DIFFERING_PROPERTY_NAMES: differingNameTally,
			droppedByFingerprint: DROPPED_BY_FINGERPRINT,
			differingNamesNOTdroppedByFingerprint: unexpectedNameList,
			exampleNodesWithUnexpectedDifferences: exampleList,
			VERDICT: verdict,
		});
		process.exitCode = unexpectedNameList.length === 0 && differingNameList.length > 0 ? 0 : 1;
	}
}
