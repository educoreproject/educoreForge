#!/usr/bin/env node
'use strict';

// test-restoreConservation.js — ⟪lane FIX, 2026-10-09⟫ gate for the RESTORE side of conservation. A build's conservation
// compared what a forge loaded with what its harvest read back; a restore (every -replay, and every build's final
// materialize) compared nothing, and the engine's dangling edges were returned and never read. replayManager.restore now
// counts the graph right after the restore and refuses by name unless it holds exactly the blocks' distinct nodes and
// edges with none dangling; -stampPromotion's -replay evidence reader requires that verdict's PASS line.
//
// PROVES:
//   (a) conserved counts pass, and the status line names every number (pure)
//   (b) a node the graph lacks is refused, naming both counts (pure)
//   (c) an edge the graph lacks is refused (pure)
//   (d) a dangling edge is refused even when the counts happen to agree (pure)
//   (e) a comparison with no graph counts is refused, never read as conserved (pure)
//   (f) LIVE: a real restore of a small block into a scratch graph prints the PASS line; a block whose edge names a node no
//       block holds (it dangles) FAILS the restore by name (Docker; both scratch graphs are disposed)
// RED TWINS: (b) nodeCountUncompared; (c) edgeCountUncompared; (d) danglingIgnored; (e) countsUnchecked; (a) passTextDropped;
// (f) restoreUncounted (the restore reports success without counting, as before).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: a restore holds exactly its blocks (restore conservation)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Pure conjuncts over compareRestoreConservation, then a LIVE conjunct that restores into two scratch graphs (Docker).
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../test/testLib/harness')(moduleName);

const path = require('path');
const { loadBuildJsDouble } = require('../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const replayBlock = require('../../../../../lib/replay/replay-block')();
const { conservationSummaryFor } = require('../../../../../lib/replay/replay-engine')();

const REPLAY_MANAGER_PATH = path.join(__dirname, '..', 'replayManager.js');
const managerModuleFor = (mutationList) => (mutationList.length === 0 ? require(REPLAY_MANAGER_PATH) : loadBuildJsDouble({ buildJsPath: REPLAY_MANAGER_PATH, mutationList }));

const GOOD_TIER = replayBlock.PROVENANCE_TIERS[0];
const nodeFor = (stableId) => ({ ref: { source: 'LIF', id: stableId }, labels: ['ForgedNode', 'DmeClass'], stableId, properties: { name: [`name of ${stableId}`] } });
const edgeFor = (fromId, toId) => ({ type: 'HAS_PROPERTY', fromRef: { source: 'LIF', id: fromId }, toRef: { source: 'LIF', id: toId }, properties: { provenanceTier: [GOOD_TIER] } });
const HEADER = { blockType: 'standardBase', standardKey: 'LIF', version: '1', stableUriPropertyName: 'uri', resolutionKey: 'uri' };
const blockTextFor = (nodeList, edgeList) => replayBlock.serializeBlock({ header: HEADER, nodes: nodeList, edges: edgeList });

// three nodes, two edges (one emitted twice: the duplicate merges, so the distinct count is what the graph must hold)
const SUMMARY = conservationSummaryFor({ nodes: ['urn:a', 'urn:b', 'urn:c'].map(nodeFor), edges: [edgeFor('urn:a', 'urn:b'), edgeFor('urn:b', 'urn:c'), edgeFor('urn:b', 'urn:c')] });
const compareWith = (mutationList, overrideMap) => managerModuleFor(mutationList).compareRestoreConservation({ graphName: 'DEV_gb_restoreCheck_1_1', loadedConservationSummary: SUMMARY, graphNodeCount: 3, graphEdgeCount: 2, danglingRefCount: 0, ...overrideMap });

const pureJudgeByRefId = {
	a_conservedPasses: (mutationList) => {
		const verdict = compareWith(mutationList, {});
		return { pass: verdict.error === '' && /restore conservation PASS: 'DEV_gb_restoreCheck_1_1': the blocks hold 3 distinct node\(s\) \(3 emitted\) and 2 distinct edge\(s\) \(3 emitted\); the graph holds 3 node\(s\) and 2 edge\(s\); 0 edge\(s\) dangling/.test(String(verdict.statusText)), detail: verdict.statusText || verdict.error };
	},
	b_lostNodeRefused: (mutationList) => {
		const verdict = compareWith(mutationList, { graphNodeCount: 2 });
		return { pass: /REFUSED — RESTORE CONSERVATION FAILED: the blocks hold 3 distinct node\(s\).*the graph holds 2 node\(s\)/.test(verdict.error), detail: verdict.error || verdict.statusText };
	},
	c_lostEdgeRefused: (mutationList) => {
		const verdict = compareWith(mutationList, { graphEdgeCount: 1 });
		return { pass: /RESTORE CONSERVATION FAILED: .*the graph holds 3 node\(s\) and 1 edge\(s\)/.test(verdict.error), detail: verdict.error || verdict.statusText };
	},
	d_danglingRefused: (mutationList) => {
		const verdict = compareWith(mutationList, { danglingRefCount: 1 });
		return { pass: /RESTORE CONSERVATION FAILED: .*1 edge\(s\) dangling/.test(verdict.error), detail: verdict.error || verdict.statusText };
	},
	e_noCountsRefused: (mutationList) => {
		const verdict = compareWith(mutationList, { graphNodeCount: undefined, graphEdgeCount: undefined });
		return { pass: /REFUSED — the restore conservation has no loaded summary or no graph counts to compare/.test(verdict.error), detail: verdict.error || verdict.statusText };
	},
};

// (f) LIVE: create → init({ schemaBlocks }) → delete, twice; the status line is captured from xLog
const restoreLive = (mutationList, blockText, callback) => {
	const statusLineList = [];
	const realStatus = process.global.xLog.status;
	process.global.xLog.status = (lineText) => {
		statusLineList.push(String(lineText));
		realStatus(lineText);
	};
	const manager = managerModuleFor(mutationList)();
	manager.create({ purpose: 'restoreCheck' }, (createErr, handle) => {
		if (createErr) {
			process.global.xLog.status = realStatus;
			callback({ initErr: `create failed: ${createErr}`, statusLineList });
			return;
		}
		manager.init({ inGraph: handle, schemaBlocks: [blockText] }, (initErr) => {
			manager.delete(handle, () => {
				process.global.xLog.status = realStatus;
				callback({ initErr: initErr || '', statusLineList });
			});
		});
	});
};
const liveJudge = (mutationList, done) => {
	restoreLive(mutationList, blockTextFor(['urn:a', 'urn:b', 'urn:c'].map(nodeFor), [edgeFor('urn:a', 'urn:b'), edgeFor('urn:b', 'urn:c'), edgeFor('urn:b', 'urn:c')]), (conservedRun) => {
		restoreLive(mutationList, blockTextFor(['urn:a', 'urn:b'].map(nodeFor), [edgeFor('urn:a', 'urn:b'), edgeFor('urn:b', 'urn:nowhere')]), (danglingRun) => {
			const passLine = conservedRun.statusLineList.find((oneLine) => /restore conservation PASS/.test(oneLine)) || '';
			done({
				pass: conservedRun.initErr === '' && /the graph holds 3 node\(s\) and 2 edge\(s\); 0 edge\(s\) dangling/.test(passLine) && /REFUSED — RESTORE CONSERVATION FAILED: the blocks hold 2 distinct node\(s\) \(2 emitted\) and 2 distinct edge\(s\) \(2 emitted\); the graph holds 2 node\(s\) and 1 edge\(s\); 1 edge\(s\) dangling/.test(danglingRun.initErr),
				detail: `conserved: ${conservedRun.initErr || passLine} | dangling: ${danglingRun.initErr || 'init SUCCEEDED'}`,
			});
		});
	});
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_conservedPasses', twinName: 'passTextDropped', find: "return { error: '', statusText: `restore conservation PASS: '${graphName}': ${countText}` };", replace: "return { error: '', statusText: '' };" },
	{ conjunctRefId: 'b_lostNodeRefused', twinName: 'nodeCountUncompared', find: 'if (graphNodeCount !== blockNodeCount || graphEdgeCount !== blockEdgeCount', replace: 'if (graphEdgeCount !== blockEdgeCount' },
	{ conjunctRefId: 'c_lostEdgeRefused', twinName: 'edgeCountUncompared', find: 'if (graphNodeCount !== blockNodeCount || graphEdgeCount !== blockEdgeCount', replace: 'if (graphNodeCount !== blockNodeCount' },
	{ conjunctRefId: 'd_danglingRefused', twinName: 'danglingIgnored', find: ' || danglingRefCount !== 0) {', replace: ') {' },
	{ conjunctRefId: 'e_noCountsRefused', twinName: 'countsUnchecked', find: ' || !Number.isInteger(graphNodeCount) || !Number.isInteger(graphEdgeCount)', replace: '' },
];
const LIVE_TWIN = { twinName: 'restoreUncounted', find: 'const verdict = compareRestoreConservation({', replace: "const verdict = { error: '', statusText: 'restore conservation PASS: uncounted' } || compareRestoreConservation({" };

harness.section('BASELINE — the real comparison passes every pure conjunct');
Object.keys(pureJudgeByRefId).forEach((oneRefId) => {
	const verdict = pureJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.section('THE PURE TWIN SWEEP — each conjunct OBSERVED RED under a module double (in memory)');
harness.equal('every pure conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), Object.keys(pureJudgeByRefId).sort().join(','));
TWIN_LIST.forEach((oneTwin) => {
	const verdict = pureJudgeByRefId[oneTwin.conjunctRefId]([{ modulePath: REPLAY_MANAGER_PATH, find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
harness.section('LIVE — a real restore conserves, and a dangling edge fails it (Docker)');
liveJudge([], (liveVerdict) => {
	harness.ok('f_liveRestoreConserved PASS', liveVerdict.pass, liveVerdict.detail);
	liveJudge([{ modulePath: REPLAY_MANAGER_PATH, find: LIVE_TWIN.find, replace: LIVE_TWIN.replace }], (twinVerdict) => {
		harness.ok(`f_liveRestoreConserved observed RED under '${LIVE_TWIN.twinName}'`, !twinVerdict.pass, twinVerdict.detail);
		harness.note(`RED-OBSERVED f_liveRestoreConserved twin='${LIVE_TWIN.twinName}' → ${twinVerdict.pass ? 'STILL PASSING' : 'FAIL'}: ${twinVerdict.detail}`);
		harness.report();
	});
});
