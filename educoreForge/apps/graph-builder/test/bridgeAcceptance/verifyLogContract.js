'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// verifyLogContract.js — the PURE contract check behind runBridgeAcceptanceCommand -verify (RULING BR3-3).
//
//   verifyLogContract({ logText, entry, lineName, expectedIds }) → { verdict, faultList, refusal }
//
//   refusal   — a string when the INPUT cannot be verified at all (an absent / empty expectedBaseBlockIdBySubject:
//               a pin table with nothing in it verifies nothing — REFUSED BY NAME, never a vacuous VERIFIED)
//   faultList — every contract fault found in the log: a pinned base id not seen / differing; an observed base
//               subject outside the pin table; the decision block id differing from the frozen one for the line;
//               and (BR3-3) a `graphBuilder -build failed:` line — a run that died after freezing its blocks is a
//               FAULT, never a NOTE on a success line
//   verdict   — the run's ids as scraped from the log (base ids, decision block, manifest, container, goldEvalCheck)
//
// Pure: no fs, no process — the runner reads the log and prints; this module decides. Gated by
// apps/graph-builder/test/test-bridgeAcceptanceEdfi.js SECTION 4 (the real cp2replay6 log + input-fault twins).

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const verifyLogContract = ({ logText, entry, lineName, expectedIds } = {}) => {
	if (typeof logText !== 'string') {
		return { refusal: `${moduleName}: logText must be a string (got ${typeof logText})`, verdict: null, faultList: [] };
	}
	const expectedBySubject = isPlainObject(entry) ? entry.expectedBaseBlockIdBySubject : undefined;
	if (!isPlainObject(expectedBySubject) || Object.keys(expectedBySubject).length === 0) {
		return { refusal: `${moduleName}: the acceptance entry carries no expectedBaseBlockIdBySubject (absent or empty) — a pin table with nothing in it verifies nothing; -verify is REFUSED by name, not VERIFIED over 0 subjects (RULING BR3-3)`, verdict: null, faultList: [] };
	}
	const ids = isPlainObject(expectedIds) ? expectedIds : {};
	const baseLinePattern = /\[A\] (REUSED|forge) (\S+) -> standardBase ([0-9a-f]{64})/g;
	const observedBySubject = {};
	let match = baseLinePattern.exec(logText);
	while (match !== null) {
		observedBySubject[match[2]] = { how: match[1], refId: match[3] };
		match = baseLinePattern.exec(logText);
	}
	const faultList = [];
	Object.keys(expectedBySubject).forEach((oneSubject) => {
		const observed = observedBySubject[oneSubject];
		if (!observed) {
			faultList.push(`base ${oneSubject}: NOT SEEN in the log (expected ${expectedBySubject[oneSubject]})`);
		} else if (observed.refId !== expectedBySubject[oneSubject]) {
			faultList.push(`base ${oneSubject}: ${observed.how} ${observed.refId} ≠ pinned ${expectedBySubject[oneSubject]} — the pinned store's bytes are NOT what this run built on`);
		}
	});
	Object.keys(observedBySubject).forEach((oneSubject) => {
		if (expectedBySubject[oneSubject] === undefined) {
			faultList.push(`base ${oneSubject}: ${observedBySubject[oneSubject].refId} is not among the pinned subjects (${Object.keys(expectedBySubject).join(', ')})`);
		}
	});
	const decisionMatch = logText.match(/froze decision block ([0-9a-f]{64}) \((saved|already present — idempotent)\)/);
	const replayMatch = logText.match(/replay(?:ed|ing) frozen block ([0-9a-f]{64})/);
	const manifestMatch = logText.match(/\[compose\] manifest ([0-9a-f]{64}) -- (\d+) members/);
	const materializeMatch = logText.match(/scratch graph '(DEV_gb_materialize_\d+_\d+)' ready at (bolt:\/\/localhost:\d+)/);
	const failedMatch = logText.match(/graphBuilder -build failed: (.*)/);
	const goldEvalMatch = logText.match(/\[goldEvalCheck\] (PASS|REFUSED)/);
	const censusMatch = logText.match(/census per subject (\{[^\n]*\})/);
	// the materialise line replays a frozen block and says so with a 12-hex PREFIX ("materialised N edge(s) … from block
	// e15acd6b5a43…") — the prefix is asserted against the frozen id when no full id is printed
	const materialisedFromMatch = logText.match(/materialised (\d+) edge\(s\) under (\S+) from block ([0-9a-f]{12})…/);
	const decisionBlockId = decisionMatch ? decisionMatch[1] : replayMatch ? replayMatch[1] : null;
	const decisionBlockIdPrefix = materialisedFromMatch ? materialisedFromMatch[3] : decisionBlockId ? decisionBlockId.slice(0, 12) : null;
	if (lineName !== 'rejudgeDebug' && !decisionBlockId && decisionBlockIdPrefix && ids.decisionBlockId && ids.decisionBlockId.slice(0, 12) !== decisionBlockIdPrefix) {
		faultList.push(`materialised from block ${decisionBlockIdPrefix}… ≠ the frozen decisionBlockId ${ids.decisionBlockId} (prefix)`);
	}
	if (lineName === 'rejudgeDebug' && decisionBlockId && ids.debugDecisionBlockId && decisionBlockId !== ids.debugDecisionBlockId) {
		faultList.push(`debug decision block ${decisionBlockId} ≠ the frozen debugDecisionBlockId ${ids.debugDecisionBlockId}`);
	}
	if (lineName !== 'rejudgeDebug' && decisionBlockId && ids.decisionBlockId && decisionBlockId !== ids.decisionBlockId) {
		faultList.push(`decision block ${decisionBlockId} ≠ the frozen decisionBlockId ${ids.decisionBlockId}`);
	}
	const buildFailed = failedMatch ? failedMatch[1] : null;
	if (buildFailed !== null) {
		faultList.push(`the build REPORTED A FAILURE: ${buildFailed.slice(0, 200)} — a run that died is a contract FAULT, never a note on a VERIFIED line (RULING BR3-3)`);
	}
	const verdict = {
		lineName,
		baseBlockIdBySubject: observedBySubject,
		decisionBlockId,
		decisionBlockIdPrefix,
		materialisedEdgeCount: materialisedFromMatch ? Number(materialisedFromMatch[1]) : null,
		decisionBlockDisposition: decisionMatch ? decisionMatch[2] : replayMatch ? 'replayed' : materialisedFromMatch ? 'materialised' : null,
		censusPerSubject: censusMatch ? JSON.parse(censusMatch[1]) : null,
		manifestId: manifestMatch ? manifestMatch[1] : null,
		manifestMemberCount: manifestMatch ? Number(manifestMatch[2]) : null,
		materializeContainer: materializeMatch ? materializeMatch[1] : null,
		boltUrl: materializeMatch ? materializeMatch[2] : null,
		buildFailed,
		goldEvalCheckInLog: goldEvalMatch ? goldEvalMatch[1] : null,
		pinnedSubjectCount: Object.keys(expectedBySubject).length,
	};
	return { refusal: '', verdict, faultList };
};

module.exports = { verifyLogContract };
