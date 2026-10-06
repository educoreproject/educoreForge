'use strict';

// match-forensics.js — the append-only FORENSIC MATCH LOG (p9-judgmentPersistence scope amendment;
// ⟪TQ RULING, 2026-07-31⟫ "make sure that you have a good log so that we can review and diagnose the
// processing details to support forensic examination to improve quality later... organize them so
// you can examine and answer questions in the context of the standards").
//
// WHAT IT HOLDS: one JSON object per line (JSONL), ONE RECORD PER JUDGMENT, written AT DECISION TIME
// — the same moment the judgment-cache row lands — so a killed run leaves a complete forensic trail
// up to the exact judgment it died on. Cache hits and dedupe fan-outs get records too (judgedVia
// says which), so the forensic story is COMPLETE per source element, never just the live spend.
//
// ORGANIZED BY STANDARD: one file per pair+generation,
//   <baseDirPath>/<pairKey>/<generation>.jsonl        (pairKey e.g. 'CEDS::SIF')
// The directory-per-pair layout IS the organize-by-standard requirement: "what did the SIF run
// judge, and why" is one directory; "what changed between generations" is two files side by side.
//
// CRASH-SAFE, APPEND-ONLY: every record is ONE fs.appendFile call of serialized-object + newline —
// no buffering across judgments, nothing held in memory to lose. This writer PREPARES its own
// directories (mkdir -p of the per-pair dir on first append): it is an evidence log, not a
// datastore — a forensic trail that refused to exist because a directory was missing would defeat
// the very crash it exists to explain. (Contrast judgment-cache/decision-store, which refuse an
// unprepared directory: THOSE hold replayed truth; this holds testimony.)
//
// FORENSICS ARE EVIDENCE, NOT A GATE: this module reports an append failure through its callback
// like everything else, but the CALLER (the judgment seam) is contractually loud-but-nonfatal about
// it — a forensics write failure must never kill a run that is spending real judgment credit.
//
// No sqlite, no process.global, no construction-time side effects — safe to require anywhere.
// Async style: callback(errString, result); camelCase only; no async/await.

const path = require('path');
const fs = require('fs');

// THE RECORD CONTRACT (W-B-8, V1-C15 / V1-S83/S88/S89; campaign P3 2026-10-06). The writer owns the shape: three kinds
// of record reach this trail, each with ONE declared key set, and appendRecord refuses any other by name, listing the
// extra and the missing keys. Before this, the only reader (retrieval-metrics, now retired) read a pre-framework shape
// none of today's records carried, and nothing noticed.
//   judgment        one accepted judgment (judgeComponent deliver); 'predicate' is present only under a rule with a slot
//   refusedAttempt  a first attempt refused for its rationale's form, written before the one bounded re-ask
//   mappingReview   a conflict review (bridge-framework, kind 'MappingReview')
// attempts: the number of provider HTTP requests this judgment cost, retries and second questions included (Jev: pick +
// relation). usage: null, or exactly JUDGE_USAGE_FIELD_LIST, each a non-negative integer (Jev answers in snake_case;
// its client converts at the wire).
const JUDGE_USAGE_FIELD_LIST = Object.freeze(['inputTokens', 'outputTokens']);
const MATCH_FORENSICS_RECORD_FIELD_LIST = Object.freeze([
	'promptHash', 'rendererVersion', 'judgeModel', 'decisionAlgorithm', 'systemPrompt', 'userPrompt', 'reaskUserPrompt',
	'renderedPoolStableIdList', 'choice', 'chosenCardStableId', 'category', 'reportedCategoryOnAbstain', 'sourceElementIdeaList',
	'candidateIdeaList', 'sortedCandidateList', 'ideaCoverage', 'rationale', 'judgeSummary', 'confidence', 'cacheHit', 'attempts', 'usage',
	'discardedPredicateKeyCount', 'reaskCount',
]);
const MATCH_FORENSICS_REFUSED_ATTEMPT_FIELD_LIST = Object.freeze([
	'promptHash', 'rendererVersion', 'judgeModel', 'decisionAlgorithm', 'systemPrompt', 'userPrompt', 'renderedPoolStableIdList',
	'choice', 'chosenCardStableId', 'category', 'rationale', 'confidence', 'cacheHit', 'attempts', 'usage', 'refusedAttempt', 'reaskFollows',
]);
const MATCH_FORENSICS_MAPPING_REVIEW_FIELD_LIST = Object.freeze(['kind', 'conflictList']);
const MATCH_FORENSICS_RECORD_SHAPE_BY_KIND = Object.freeze({
	judgment: Object.freeze({ requiredFieldList: MATCH_FORENSICS_RECORD_FIELD_LIST, optionalFieldList: Object.freeze(['predicate']) }),
	refusedAttempt: Object.freeze({ requiredFieldList: MATCH_FORENSICS_REFUSED_ATTEMPT_FIELD_LIST, optionalFieldList: Object.freeze([]) }),
	mappingReview: Object.freeze({ requiredFieldList: MATCH_FORENSICS_MAPPING_REVIEW_FIELD_LIST, optionalFieldList: Object.freeze([]) }),
});
// recordKindOf — the discriminator: a mappingReview names its kind, a refused attempt carries refusedAttempt, else a judgment
const recordKindOf = (record) => (record.kind === 'MappingReview' ? 'mappingReview' : Object.prototype.hasOwnProperty.call(record, 'refusedAttempt') ? 'refusedAttempt' : 'judgment');
const usageViolation = (usage) => {
	if (usage === null) {
		return '';
	}
	const usageKeyList = usage !== null && typeof usage === 'object' && !Array.isArray(usage) ? Object.keys(usage).sort() : null;
	if (usageKeyList === null || JSON.stringify(usageKeyList) !== JSON.stringify(JUDGE_USAGE_FIELD_LIST.slice().sort()) || !JUDGE_USAGE_FIELD_LIST.every((oneName) => Number.isInteger(usage[oneName]) && usage[oneName] >= 0)) {
		return `usage ${JSON.stringify(usage)} is neither null nor exactly { ${JUDGE_USAGE_FIELD_LIST.join(', ')} } of non-negative integers`;
	}
	return '';
};
// recordShapeViolation — '' when the record is exactly one declared kind's key set (and its usage is declared), else why not
const recordShapeViolation = (record) => {
	const recordKind = recordKindOf(record);
	const shape = MATCH_FORENSICS_RECORD_SHAPE_BY_KIND[recordKind];
	const keyList = Object.keys(record);
	const extraList = keyList.filter((oneName) => shape.requiredFieldList.indexOf(oneName) === -1 && shape.optionalFieldList.indexOf(oneName) === -1);
	const missingList = shape.requiredFieldList.filter((oneName) => keyList.indexOf(oneName) === -1);
	if (extraList.length || missingList.length) {
		return `matchForensics.appendRecord: a '${recordKind}' record must carry exactly its declared fields (MATCH_FORENSICS_RECORD_SHAPE_BY_KIND); extra [${extraList.join(', ')}], missing [${missingList.join(', ')}]`;
	}
	const usageFault = recordKind === 'mappingReview' ? '' : usageViolation(record.usage);
	return usageFault ? `matchForensics.appendRecord: ${usageFault} (JUDGE_USAGE_FIELD_LIST)` : '';
};

// START OF moduleFunction() ============================================================

const matchForensics = () => {
	// -----
	// open — baseDirPath is required; there is no default here (the documented default lives in the
	// caller, graphBuilder's actions.js, exactly the vectorCache/embedding-client split).
	const open = ({ baseDirPath }, callback) => {
		if (!baseDirPath || typeof baseDirPath !== 'string' || baseDirPath.trim() === '') {
			callback(
				`matchForensics.open: baseDirPath is REQUIRED and has no default. A caller that does ` +
					`not say where the forensic trail lives is a caller that can write anywhere.`,
			);
			return;
		}
		if (fs.existsSync(baseDirPath) && !fs.statSync(baseDirPath).isDirectory()) {
			callback(
				`matchForensics.open: '${baseDirPath}' exists and is not a directory. Refusing to ` +
					`append forensic records into a non-directory.`,
			);
			return;
		}
		callback('', makeApi({ baseDirPath }));
	};

	return { open };
};

// pathSegmentViolation — pairKey/generation become FILESYSTEM names; a path separator (or a blank)
// inside either would silently scatter one pair's trail across directories. Refused by name.
const pathSegmentViolation = (value, name, who) => {
	if (typeof value !== 'string' || value.trim() === '') {
		return `matchForensics.${who}: ${name} is required and must be a non-empty string`;
	}
	if (value.indexOf('/') !== -1 || value.indexOf('\\') !== -1 || value.indexOf('\u0000') !== -1) {
		return (
			`matchForensics.${who}: ${name} '${value}' contains a path separator (or NUL) — it becomes ` +
			`a filesystem name and must not smuggle directory structure. There is no sanitized default.`
		);
	}
	return '';
};

// -----
const makeApi = ({ baseDirPath }) => {
	// -----
	// appendRecord — ONE judgment record onto the pair+generation trail. One appendFile call,
	// serialized object + newline, no buffering. The per-pair directory is prepared on demand.
	const appendRecord = ({ pairKey, generation, record } = {}, callback) => {
		const pairViolation = pathSegmentViolation(pairKey, 'pairKey', 'appendRecord');
		if (pairViolation) {
			callback(pairViolation);
			return;
		}
		const generationViolation = pathSegmentViolation(generation, 'generation', 'appendRecord');
		if (generationViolation) {
			callback(generationViolation);
			return;
		}
		if (!record || typeof record !== 'object' || Array.isArray(record)) {
			callback('matchForensics.appendRecord: record is required and must be a plain object');
			return;
		}
		const shapeViolation = recordShapeViolation(record);
		if (shapeViolation) {
			callback(shapeViolation);
			return;
		}

		const pairDir = path.join(baseDirPath, pairKey);
		let mkdirFault = '';
		const attempt = () => {
			fs.mkdirSync(pairDir, { recursive: true });
		};
		try {
			attempt();
		} catch (mkdirError) {
			mkdirFault = mkdirError.message;
		}
		if (mkdirFault) {
			callback(`matchForensics.appendRecord: preparing '${pairDir}': ${mkdirFault}`);
			return;
		}

		const filePath = path.join(pairDir, `${generation}.jsonl`);
		fs.appendFile(filePath, `${JSON.stringify(record)}\n`, (appendError) => {
			if (appendError) {
				callback(`matchForensics.appendRecord: appending to '${filePath}': ${appendError.message}`);
				return;
			}
			callback('', { filePath });
		});
	};

	return {
		baseDirPath,
		appendRecord,
	};
};

// END OF moduleFunction() ============================================================

matchForensics.JUDGE_USAGE_FIELD_LIST = JUDGE_USAGE_FIELD_LIST;
matchForensics.MATCH_FORENSICS_RECORD_FIELD_LIST = MATCH_FORENSICS_RECORD_FIELD_LIST;
matchForensics.MATCH_FORENSICS_REFUSED_ATTEMPT_FIELD_LIST = MATCH_FORENSICS_REFUSED_ATTEMPT_FIELD_LIST;
matchForensics.MATCH_FORENSICS_MAPPING_REVIEW_FIELD_LIST = MATCH_FORENSICS_MAPPING_REVIEW_FIELD_LIST;
matchForensics.MATCH_FORENSICS_RECORD_SHAPE_BY_KIND = MATCH_FORENSICS_RECORD_SHAPE_BY_KIND;
matchForensics.recordShapeViolation = recordShapeViolation;

module.exports = matchForensics;
