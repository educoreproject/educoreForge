'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// promotion-evidence.js — reads a promoted graph's post-build verdicts FROM THEIR EVIDENCE FILES, for the promotion stamp
// (graphBuilder -stampPromotion; lane P, mappingProvenance 2026-10-04). A verdict is never typed by hand: each gate's
// reader parses the file its own run wrote, and every verdict is held to the graph it is stamped into by the manifest id
// the graph's passport carries. Evidence about a different manifest is REFUSED, not recorded as a failure, because it is
// not evidence about this graph at all.
//
//   EVIDENCE_READER_BY_GATE[gate]({ evidenceText, manifestRefId }) → { verdict, detail } | { error }
//   gateVerdictFor({ gate, evidencePath, manifestRefId }) → { gate, verdict, detail, evidencePath, evidenceSha256 } | { error }
// Pure but for reading the named file.

const fs = require('fs');
const crypto = require('crypto');

// goldEvalCheck's stdout: one status line 'graphBuilder: [goldEvalCheck] PASS — …', then its certificate as JSON
// ({ certification, … manifestRefId … }).
const GOLD_EVAL_STATUS_LINE_RE = /^graphBuilder: \[goldEvalCheck\] (PASS|FAIL|REFUSED)\b.*$/m;
const GOLD_EVAL_MANIFEST_RE = /"manifestRefId":\s*"([0-9a-f]{64})"/;
// a build log: the manifest the replay composed, and every bridge line that called a judge
const BUILD_MANIFEST_LINE_RE = /\[compose\] manifest ([0-9a-f]{64}) -- \d+ members/g;
const JUDGED_LINE_RE = /\bjudged: \d+/g;

const EVIDENCE_READER_BY_GATE = Object.freeze({
	goldEvalCheck: ({ evidenceText, manifestRefId }) => {
		const statusMatch = GOLD_EVAL_STATUS_LINE_RE.exec(evidenceText);
		const manifestMatch = GOLD_EVAL_MANIFEST_RE.exec(evidenceText);
		if (!statusMatch || !manifestMatch) {
			return { error: `${moduleName}: the goldEvalCheck evidence carries no status line or no manifestRefId — it is not a goldEvalCheck output` };
		}
		if (manifestMatch[1] !== manifestRefId) {
			return { error: `${moduleName} REFUSED: the goldEvalCheck evidence certifies manifest ${manifestMatch[1]}, and this graph's passport names ${manifestRefId}` };
		}
		return { verdict: statusMatch[1] === 'PASS' ? 'pass' : 'fail', detail: statusMatch[0] };
	},
	replay: ({ evidenceText, manifestRefId }) => {
		const manifestIdList = Array.from(evidenceText.matchAll(BUILD_MANIFEST_LINE_RE)).map((oneMatch) => oneMatch[1]);
		if (manifestIdList.length === 0) {
			return { error: `${moduleName}: the replay evidence composes no manifest — it is not a completed build log` };
		}
		const composedManifestRefId = manifestIdList[manifestIdList.length - 1];
		const judgedLineCount = (evidenceText.match(JUDGED_LINE_RE) || []).length;
		const reproduced = composedManifestRefId === manifestRefId && judgedLineCount === 0;
		return {
			verdict: reproduced ? 'pass' : 'fail',
			detail: `zero-judge replay composed manifest ${composedManifestRefId} (the graph's passport names ${manifestRefId}); judge calls in the log: ${judgedLineCount}`,
		};
	},
});

const gateVerdictFor = ({ gate, evidencePath, manifestRefId } = {}) => {
	const reader = EVIDENCE_READER_BY_GATE[gate];
	if (reader === undefined) {
		return { error: `${moduleName} REFUSED: no evidence reader for gate ${JSON.stringify(gate)} (known: ${Object.keys(EVIDENCE_READER_BY_GATE).join(', ')})` };
	}
	if (typeof evidencePath !== 'string' || !fs.existsSync(evidencePath)) {
		return { error: `${moduleName} REFUSED: the ${gate} evidence file ${JSON.stringify(evidencePath)} does not exist` };
	}
	if (!/^[0-9a-f]{64}$/.test(String(manifestRefId))) {
		return { error: `${moduleName} REFUSED: manifestRefId ${JSON.stringify(manifestRefId)} is not a 64-hex id; evidence cannot be tied to the graph` };
	}
	const evidenceBuffer = fs.readFileSync(evidencePath);
	const read = reader({ evidenceText: evidenceBuffer.toString('utf8'), manifestRefId });
	if (read.error) {
		return { error: read.error };
	}
	return { gate, verdict: read.verdict, detail: read.detail, evidencePath, evidenceSha256: crypto.createHash('sha256').update(evidenceBuffer).digest('hex') };
};

module.exports = { EVIDENCE_READER_BY_GATE, gateVerdictFor, moduleName };
