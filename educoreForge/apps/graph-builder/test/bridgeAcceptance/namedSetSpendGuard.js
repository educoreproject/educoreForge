'use strict';

// namedSetSpendGuard.js — the rules of the NAMED-SET spending line, as PURE functions (phase B5).
//
// It lives beside runBridgeAcceptanceCommand.js for the reason spendAuthorisationGuard.js and genesisGuard.js do:
// the runner is a CLI that exits on refusal, so a suite requiring it would RUN it. Here the runner and the suite
// call the same functions, and a twin that goes red proves the runner's own behaviour.
//
// THE LINE. `rejudgeRealNamedSet` asks the real judge about exactly one named list of subjects and nothing else.
// The entry declares, as data:
//
//     "namedSetFilePath":                    the list of record, a flat JSON array of question ids
//     "namedSetSha256":                      sha256 of that file's BYTES
//     "namedSetSubjectStableIdFilePath":     the same list as graph subject stableIds — the file the build is handed
//                                            as --subjectListFilePath
//     "namedSetSubjectStableIdPrefix":       the text that turns a question id into its subject stableId
//     "rejudgeRealNamedSetMaxJudgmentCount": the most judgments a human agreed this line may make
//
// THE SHA IS THE SPEND BOUND. The build judges only the ids in the list it is handed, so a pinned list is a pinned
// spend. The sha pins the list of record; the stableId file is pinned THROUGH it, by requiring it to be exactly
// {prefix + id} over the list of record. A stableId file that drifts from the pinned list — one id added, one
// dropped, one duplicated — is refused by name, because it is the file that actually decides what gets judged.
//
// THE MAX IS A PRE-LAUNCH REFUSAL, NOT A CEILING. The runner cannot cap a run in flight (RULING DR-6: build.js owns
// flag parsing). What it can do is refuse to launch a list longer than the max. Re-asks — the judge asked the same
// subject again after its answer failed verification — happen inside the run, so they are counted afterwards from
// the forensic trail and reported beside the max (namedSetRunReportFor).

const crypto = require('crypto');

const moduleName = 'namedSetSpendGuard';

const NAMED_SET_LINE_NAME = 'rejudgeRealNamedSet';
const MAX_JUDGMENT_COUNT_FIELD_NAME = `${NAMED_SET_LINE_NAME}MaxJudgmentCount`;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

const sha256HexOf = (fileText) => crypto.createHash('sha256').update(fileText, 'utf8').digest('hex');

// duplicatedIdOf — the first id that appears twice, or undefined
const duplicatedIdOf = (idList) => idList.find((oneId, oneIndex) => idList.indexOf(oneId) !== oneIndex);

const isNonEmptyStringList = (candidate) => Array.isArray(candidate) && candidate.length > 0 && candidate.every((oneId) => typeof oneId === 'string' && oneId.length > 0);

// namedSetRefusalFor — '' when the named set may launch; otherwise the refusal text, naming what is wrong.
//
// The caller reads the two files and passes their TEXT, or null when the file is absent, so the rule stays pure and
// a twin states its world instead of building one on disk. Checks run in the order the gates name them, so each
// twin goes red on its own check: the declaration, the sha, the max, the length, then the stableId file.
const namedSetRefusalFor = ({ entry, bridgeName, namedSetFileText, subjectStableIdFileText } = {}) => {
	const where = `the ${NAMED_SET_LINE_NAME} line for ${bridgeName}`;
	const declaredStringList = ['namedSetFilePath', 'namedSetSubjectStableIdFilePath', 'namedSetSubjectStableIdPrefix'];
	const undeclaredName = declaredStringList.find((oneFieldName) => typeof entry[oneFieldName] !== 'string' || entry[oneFieldName].length === 0);
	if (undeclaredName !== undefined) {
		return `${where} declares no ${undeclaredName} (got ${JSON.stringify(entry[undeclaredName])}) — a named set is data on the entry; there is no default`;
	}
	if (typeof entry.namedSetSha256 !== 'string' || !SHA256_HEX_RE.test(entry.namedSetSha256)) {
		return `${where} declares no namedSetSha256 as 64 lower-case hex (got ${JSON.stringify(entry.namedSetSha256)}) — the sha is what bounds the spend, so a line without one is refused`;
	}
	if (namedSetFileText === null) {
		return `${where} names a list of record that is not on disk: ${entry.namedSetFilePath}`;
	}
	const measuredSha256 = sha256HexOf(namedSetFileText);
	if (measuredSha256 !== entry.namedSetSha256) {
		return `NAMED SET SHA MISMATCH: sha256(${entry.namedSetFilePath}) is ${measuredSha256} but ${where} pins namedSetSha256 ${entry.namedSetSha256}. The list on disk is not the list that was authorised, so nothing is launched`;
	}
	const declaredMaxJudgmentCount = entry[MAX_JUDGMENT_COUNT_FIELD_NAME];
	if (!Number.isInteger(declaredMaxJudgmentCount) || declaredMaxJudgmentCount < 1) {
		return `${where} declares no ${MAX_JUDGMENT_COUNT_FIELD_NAME} as a positive integer (got ${JSON.stringify(declaredMaxJudgmentCount)}) — the max is REQUIRED on this line and is checked against the list before launch`;
	}
	const questionIdList = JSON.parse(namedSetFileText);
	if (!isNonEmptyStringList(questionIdList)) {
		return `${where}: the list of record ${entry.namedSetFilePath} is not a non-empty flat array of id strings`;
	}
	const duplicatedQuestionId = duplicatedIdOf(questionIdList);
	if (duplicatedQuestionId !== undefined) {
		return `${where}: the list of record names ${JSON.stringify(duplicatedQuestionId)} more than once — a named set is a set`;
	}
	if (questionIdList.length > declaredMaxJudgmentCount) {
		return `NAMED SET LONGER THAN ITS MAX: the list of record holds ${questionIdList.length} ids and ${MAX_JUDGMENT_COUNT_FIELD_NAME} is ${declaredMaxJudgmentCount}. Refused BEFORE LAUNCH — nothing has been spent`;
	}
	if (subjectStableIdFileText === null) {
		return `${where} names a subject stableId file that is not on disk: ${entry.namedSetSubjectStableIdFilePath}`;
	}
	const subjectStableIdList = JSON.parse(subjectStableIdFileText);
	if (!isNonEmptyStringList(subjectStableIdList)) {
		return `${where}: the subject stableId file ${entry.namedSetSubjectStableIdFilePath} is not a non-empty flat array of stableId strings`;
	}
	const mismatchText = subjectStableIdMismatchFor({ questionIdList, subjectStableIdList, subjectStableIdPrefix: entry.namedSetSubjectStableIdPrefix });
	if (mismatchText) {
		return `NAMED SET STABLEID FILE DISAGREES WITH THE LIST OF RECORD: ${mismatchText}. ${entry.namedSetSubjectStableIdFilePath} is the file the build judges from, and it must be exactly '${entry.namedSetSubjectStableIdPrefix}' + each id in the pinned ${entry.namedSetFilePath}`;
	}
	return '';
};

// subjectStableIdMismatchFor — '' when the stableId list is exactly {prefix + id} over the question ids; otherwise
// the first difference found, by name
const subjectStableIdMismatchFor = ({ questionIdList, subjectStableIdList, subjectStableIdPrefix }) => {
	const duplicatedStableId = duplicatedIdOf(subjectStableIdList);
	if (duplicatedStableId !== undefined) {
		return `the stableId ${JSON.stringify(duplicatedStableId)} appears more than once`;
	}
	const expectedStableIdList = questionIdList.map((oneQuestionId) => `${subjectStableIdPrefix}${oneQuestionId}`);
	const missingStableId = expectedStableIdList.find((oneStableId) => subjectStableIdList.indexOf(oneStableId) === -1);
	if (missingStableId !== undefined) {
		return `the stableId ${JSON.stringify(missingStableId)} is MISSING (${subjectStableIdList.length} stableIds for ${questionIdList.length} ids)`;
	}
	const extraStableId = subjectStableIdList.find((oneStableId) => expectedStableIdList.indexOf(oneStableId) === -1);
	if (extraStableId !== undefined) {
		return `the stableId ${JSON.stringify(extraStableId)} is EXTRA — it names no id in the list of record`;
	}
	return '';
};

// namedSetRunReportFor — the post-run report: judged count, re-ask count and max, side by side.
//
// `forensicFileList` is [{ filePath, fileBuffer, byteSizeAtLaunch }] for every forensic file of this named set. Only
// the bytes past byteSizeAtLaunch are read (0 for a file this run created), so records an earlier run of the same
// set appended are not counted. A record with cacheHit false is one live judgment; its reaskCount is how many extra
// times the judge was asked for that subject.
//
// The log's own "asked N" figure is read as a cross-check. If the forensic slice and the log disagree, the slice is
// the wrong slice or the trail is incomplete, and the report says so as a fault rather than printing a number that
// only looks measured. An absent "asked" line is also a fault: the count was not observed.
const LOG_ASKED_RE = /judged: \d+ \(asked (\d+),/;

const namedSetRunReportFor = ({ forensicFileList, logText, maxJudgmentCount } = {}) => {
	const recordList = forensicFileList
		.map((oneForensicFile) => oneForensicFile.fileBuffer.subarray(oneForensicFile.byteSizeAtLaunch).toString('utf8'))
		.join('\n')
		.split('\n')
		.filter((oneLine) => oneLine.trim().length > 0)
		.map((oneLine) => JSON.parse(oneLine));
	const liveRecordList = recordList.filter((oneRecord) => oneRecord.cacheHit === false);
	const judgedCount = liveRecordList.length;
	const reaskCount = liveRecordList.reduce((soFar, oneRecord) => soFar + oneRecord.reaskCount, 0);
	const askedMatch = LOG_ASKED_RE.exec(logText);
	const logAskedCount = askedMatch === null ? null : Number(askedMatch[1]);
	const faultList = [];
	if (logAskedCount === null) {
		faultList.push(`the log carries no "judged: N (asked M, …)" line, so the judged count ${judgedCount} from the forensic trail is UNMEASURED against the run's own report`);
	} else if (logAskedCount !== judgedCount) {
		faultList.push(`the log says the judge was asked ${logAskedCount} time(s) but the forensic records this run appended show ${judgedCount} live judgment(s) — the trail slice does not describe this run`);
	}
	return {
		judgedCount,
		reaskCount,
		maxJudgmentCount,
		sideBySideText: `judged ${judgedCount} · re-asks ${reaskCount} · max ${maxJudgmentCount}`,
		logAskedCount,
		servedFromCacheCount: recordList.filter((oneRecord) => oneRecord.cacheHit === true).length,
		faultList,
	};
};

module.exports = { namedSetRefusalFor, namedSetRunReportFor, sha256HexOf, NAMED_SET_LINE_NAME, MAX_JUDGMENT_COUNT_FIELD_NAME, moduleName };
