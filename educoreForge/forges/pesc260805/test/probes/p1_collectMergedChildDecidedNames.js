'use strict';

// p1_collectMergedChildDecidedNames.js — LUNAR_PRISM (P1), 2026-08-17.
//
// THE COLLECTOR the registry lever drives. Runs the REAL forge in-memory (skipEmbedding, no Docker,
// no embedder, no store) and emits, for every S-1c merged child, the two things the lever compares:
//   decidedNonSignaturePropertyNames — the STAMPED property that companion edit 2 could move
//   owningTypeName / effectiveDescription / proseSource — the seat values, so the lever can also say
//     whether the VALUES moved, separately from whether the DECIDED-NAMES tally moved
//
// It is a separate file, and run in a CHILD PROCESS by the lever, because Node caches a module after
// require(): mutating syntheticTier.js in the parent process would change the bytes on disk and
// change NOTHING about the already-loaded module. A lever that mutated and re-ran in-process would
// report "no difference" every time, greenly, forever — the same genus of empty measurement this
// order keeps finding.
//
// Emits ONE JSON object on stdout and nothing else, so the parent can parse it without scraping.

const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const SYNTHETIC_TIER = 'synthetic';

const entryBundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

entryBundle.forge({ sourcePath: SNAPSHOT_DIR, owner: 'p1_collectMergedChildDecidedNames', skipEmbedding: true }, (forgeError, forged) => {
	if (forgeError) {
		process.stdout.write(`${JSON.stringify({ collectorError: `${forgeError}` })}\n`);
		process.exitCode = 1;
		return;
	}
	const mergedChildRecordList = forged.nodes
		.filter(
			(oneNode) =>
				oneNode.properties.pescTier === SYNTHETIC_TIER &&
				typeof oneNode.properties.copiedFromStableId === 'string' &&
				oneNode.properties.decidedNonSignaturePropertyNames !== undefined,
		)
		.map((oneNode) => ({
			stableId: oneNode.stableId,
			decidedNonSignaturePropertyNames: oneNode.properties.decidedNonSignaturePropertyNames,
			owningTypeName: oneNode.properties.owningTypeName === undefined ? null : oneNode.properties.owningTypeName,
			effectiveDescription:
				oneNode.properties.effectiveDescription === undefined ? null : oneNode.properties.effectiveDescription,
			proseSource: oneNode.properties.proseSource === undefined ? null : oneNode.properties.proseSource,
		}))
		.sort((leftRecord, rightRecord) => (leftRecord.stableId < rightRecord.stableId ? -1 : leftRecord.stableId > rightRecord.stableId ? 1 : 0));

	process.stdout.write(
		`${JSON.stringify({
			nodeCount: forged.nodes.length,
			mergedChildCount: mergedChildRecordList.length,
			mergedChildRecordList,
		})}\n`,
	);
});
