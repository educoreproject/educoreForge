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
// ⟪lane REFORGE, forgeClean R3⟫ the reforgeCompare -summarize evidence: JSON, its format named by the tool's own library
const reforgeEvidenceFormat = require('./reforge-compare').REFORGE_EVIDENCE_FORMAT;
const parsedSummaryOf = (evidenceText) => {
	try {
		return JSON.parse(evidenceText);
	} catch (parseError) {
		return null;
	}
};

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
	// THE ONE READER THAT DOES NOT REFUSE A FOREIGN MANIFEST, and why: the reforge run proves the FORGE CODE AT ITS HEAD is
	// repeatable (two from-scratch builds, identical). A gold built later from the same code inherits that claim without being
	// one of the two builds (work order R3: "the attestation may cite the reforgeCompare run by id and the head it ran on").
	// So the detail SAYS whether this graph's manifest is one the run composed, and the head, rather than refusing.
	reforgeDeterminism: ({ evidenceText, manifestRefId }) => {
		const summary = parsedSummaryOf(evidenceText);
		if (!summary || summary.summaryFormat !== reforgeEvidenceFormat || ['pass', 'fail'].indexOf(summary.verdict) === -1 || typeof summary.detail !== 'string' || !Array.isArray(summary.manifestRefIdList)) {
			return { error: `${moduleName}: the reforgeDeterminism evidence is not a ${reforgeEvidenceFormat} summary (apps/graph-builder/tools/reforgeCompare.js -summarize writes one)` };
		}
		const composedByRun = summary.manifestRefIdList.indexOf(manifestRefId) !== -1;
		return { verdict: summary.verdict, detail: `${summary.detail}; this graph's manifest ${manifestRefId.slice(0, 12)} ${composedByRun ? 'IS one the reforge run composed' : "is NOT one the reforge run composed: the run attests the forge code at its head, not this graph's blocks"}` };
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
