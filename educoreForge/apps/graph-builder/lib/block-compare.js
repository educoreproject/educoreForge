'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// block-compare.js — compare what two stores FROZE, without a graph and without a build (R0 proof kit, 2026-10-21, step 4).
// Two comparisons, both read-only:
//
//   DECISION BLOCKS, per pairKey, latest row each side (the row getDecisionBlock answers, decision-store.js). The candidate's
//   frozen text with its frameworkFingerprint replaced by the baseline's must equal the baseline's text. The fingerprint is
//   substituted because it moves with ANY lib/bridge-framework or bridge-maker edit (decisionBlock.js FINGERPRINT_ROOT_LIST)
//   while the decisions do not (plan T7): comparing block ids or sha would call every re-freeze a change. Verdicts:
//     IDENTICAL                 the frozen texts are byte-equal (same block id)
//     ONLY_FINGERPRINT_DIFFERS  equal once the fingerprint is substituted; nothing else moved
//     DIFFERENT                 something besides the fingerprint moved (the differing header names are listed)
//     BASELINE_ONLY / CANDIDATE_ONLY   the pairKey is frozen on one side only
//
//   MANIFESTS, by member: each member as (kind, subject, refId). Members of the baseline absent from the candidate by refId,
//   a subject carried under a different refId, members only the candidate holds, and the identical count.
//   (Supersedes dataStores/ctdlHub_101926/p8Runs/tools/manifestDiff.sh.)
//
// Stores are opened { readonly: true, fileMustExist: true }: a compare never creates, migrates or writes a store.
//
//   latestDecisionBlockByPairKey({ decisionStoreFilePath })            → { blockByPairKey } | { error }
//   latestFrozenHeaderByPairKey({ decisionStoreFilePath })             → { headerByPairKey } | { error }   (header only, from a prefix)
//   compareDecisionBlockStores({ baselineDecisionStoreFilePath, candidateDecisionStoreFilePath })
//                                                                     → { rowList, passed } | { error }
//   manifestMemberListFor({ standardsDatabaseFilePath, manifestRefId }) → { memberList } | { error }
//   compareManifests({ baselineStandardsDatabaseFilePath, baselineManifestRefId,
//                      candidateStandardsDatabaseFilePath, candidateManifestRefId }) → { comparison, passed } | { error }

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const VERDICT_IDENTICAL = 'IDENTICAL';
const VERDICT_ONLY_FINGERPRINT_DIFFERS = 'ONLY_FINGERPRINT_DIFFERS';
const VERDICT_DIFFERENT = 'DIFFERENT';
const VERDICT_BASELINE_ONLY = 'BASELINE_ONLY';
const VERDICT_CANDIDATE_ONLY = 'CANDIDATE_ONLY';
// the verdicts under which a pairKey's decisions are unchanged
const UNCHANGED_VERDICT_LIST = Object.freeze([VERDICT_IDENTICAL, VERDICT_ONLY_FINGERPRINT_DIFFERS]);

const openReadonly = (databaseFilePath, roleText) => {
	if (typeof databaseFilePath !== 'string' || !fs.existsSync(databaseFilePath)) {
		return { error: `${moduleName}: ${roleText} ${JSON.stringify(databaseFilePath)} is not a file on disk` };
	}
	return { database: new Database(path.resolve(databaseFilePath), { readonly: true, fileMustExist: true }) };
};

const textOf = (frozenText) => (Buffer.isBuffer(frozenText) ? frozenText.toString('utf8') : String(frozenText));

const latestDecisionBlockByPairKey = ({ decisionStoreFilePath } = {}) => {
	const opened = openReadonly(decisionStoreFilePath, 'decision store');
	if (opened.error) {
		return { error: opened.error };
	}
	const rowList = opened.database.prepare('select seq, pairKey, decisionBlockHash, frozenText from decisionBlocks order by seq').all();
	opened.database.close();
	// a later row for the same pairKey replaces the earlier one: the latest is what a materialise reads
	const blockByPairKey = rowList.reduce((soFar, oneRow) => ({ ...soFar, [oneRow.pairKey]: { decisionBlockHash: oneRow.decisionBlockHash, frozenText: textOf(oneRow.frozenText) } }), {});
	return { blockByPairKey };
};

const headerOf = (frozenText) => JSON.parse(frozenText).header;

// the frozen text opens with {"header":{…}, and the header is a few KB of a block that can be hundreds of MB: read a prefix and
// cut the header object out of it by brace depth (quotes and escapes respected), never parsing the decision records
const HEADER_PREFIX_BYTE_COUNT = 65536;
const HEADER_OPENING_TEXT = '{"header":';
const headerFromPrefix = (prefixText) => {
	if (!prefixText.startsWith(HEADER_OPENING_TEXT)) {
		return { error: `${moduleName}: a frozen text does not open with ${HEADER_OPENING_TEXT}` };
	}
	let depth = 0;
	let inString = false;
	for (let characterIndex = HEADER_OPENING_TEXT.length; characterIndex < prefixText.length; characterIndex++) {
		const character = prefixText[characterIndex];
		if (inString) {
			if (character === '\\') {
				characterIndex += 1;
			} else if (character === '"') {
				inString = false;
			}
		} else if (character === '"') {
			inString = true;
		} else if (character === '{') {
			depth += 1;
		} else if (character === '}') {
			depth -= 1;
			if (depth === 0) {
				return { header: JSON.parse(prefixText.slice(HEADER_OPENING_TEXT.length, characterIndex + 1)) };
			}
		}
	}
	return { error: `${moduleName}: a frozen header does not close within its first ${HEADER_PREFIX_BYTE_COUNT} bytes` };
};

// latestFrozenHeaderByPairKey — the header of the latest frozen block per pairKey, read without loading the decision records
const latestFrozenHeaderByPairKey = ({ decisionStoreFilePath } = {}) => {
	const opened = openReadonly(decisionStoreFilePath, 'decision store');
	if (opened.error) {
		return { error: opened.error };
	}
	const rowList = opened.database.prepare(`select seq, pairKey, decisionBlockHash, substr(frozenText, 1, ${HEADER_PREFIX_BYTE_COUNT}) as frozenPrefix from decisionBlocks order by seq`).all();
	opened.database.close();
	const headerByPairKey = {};
	for (let rowIndex = 0; rowIndex < rowList.length; rowIndex++) {
		const parsed = headerFromPrefix(textOf(rowList[rowIndex].frozenPrefix));
		if (parsed.error) {
			return { error: `${parsed.error} (pairKey ${rowList[rowIndex].pairKey} in ${decisionStoreFilePath})` };
		}
		headerByPairKey[rowList[rowIndex].pairKey] = { decisionBlockHash: rowList[rowIndex].decisionBlockHash, header: parsed.header };
	}
	return { headerByPairKey };
};

const compareOnePairKey = ({ pairKey, baselineBlock, candidateBlock }) => {
	if (baselineBlock === undefined) {
		return { pairKey, verdict: VERDICT_CANDIDATE_ONLY, candidateDecisionBlockHash: candidateBlock.decisionBlockHash };
	}
	if (candidateBlock === undefined) {
		return { pairKey, verdict: VERDICT_BASELINE_ONLY, baselineDecisionBlockHash: baselineBlock.decisionBlockHash };
	}
	const baselineHeader = headerOf(baselineBlock.frozenText);
	const candidateHeader = headerOf(candidateBlock.frozenText);
	const identityText = { pairKey, baselineDecisionBlockHash: baselineBlock.decisionBlockHash, candidateDecisionBlockHash: candidateBlock.decisionBlockHash };
	if (baselineBlock.frozenText === candidateBlock.frozenText) {
		return { ...identityText, verdict: VERDICT_IDENTICAL };
	}
	const candidateWithBaselineFingerprint = candidateBlock.frozenText.split(candidateHeader.frameworkFingerprint).join(baselineHeader.frameworkFingerprint);
	if (candidateWithBaselineFingerprint === baselineBlock.frozenText) {
		return { ...identityText, verdict: VERDICT_ONLY_FINGERPRINT_DIFFERS, fingerprintChange: `${baselineHeader.frameworkFingerprint} -> ${candidateHeader.frameworkFingerprint}` };
	}
	const differingHeaderNameList = Object.keys({ ...baselineHeader, ...candidateHeader })
		.filter((oneName) => oneName !== 'frameworkFingerprint' && JSON.stringify(baselineHeader[oneName]) !== JSON.stringify(candidateHeader[oneName]))
		.sort();
	return { ...identityText, verdict: VERDICT_DIFFERENT, differingHeaderNameList, bodyDiffers: differingHeaderNameList.length === 0 };
};

const compareDecisionBlockStores = ({ baselineDecisionStoreFilePath, candidateDecisionStoreFilePath } = {}) => {
	const baseline = latestDecisionBlockByPairKey({ decisionStoreFilePath: baselineDecisionStoreFilePath });
	if (baseline.error) {
		return { error: baseline.error };
	}
	const candidate = latestDecisionBlockByPairKey({ decisionStoreFilePath: candidateDecisionStoreFilePath });
	if (candidate.error) {
		return { error: candidate.error };
	}
	const pairKeyList = [...new Set(Object.keys(baseline.blockByPairKey).concat(Object.keys(candidate.blockByPairKey)))].sort();
	const rowList = pairKeyList.map((pairKey) => compareOnePairKey({ pairKey, baselineBlock: baseline.blockByPairKey[pairKey], candidateBlock: candidate.blockByPairKey[pairKey] }));
	// an empty comparison proves nothing and is not a pass
	const passed = rowList.length > 0 && rowList.every((oneRow) => UNCHANGED_VERDICT_LIST.indexOf(oneRow.verdict) !== -1);
	return { rowList, passed };
};

// a manifest is named by its full refId or by a prefix that names exactly one manifest in the store
const manifestMemberListFor = ({ standardsDatabaseFilePath, manifestRefId } = {}) => {
	if (typeof manifestRefId !== 'string' || !/^[0-9a-f]{6,64}$/.test(manifestRefId)) {
		return { error: `${moduleName}: manifestRefId ${JSON.stringify(manifestRefId)} is not a hex refId or prefix (at least 6 characters)` };
	}
	const opened = openReadonly(standardsDatabaseFilePath, 'standards database');
	if (opened.error) {
		return { error: opened.error };
	}
	const matchList = opened.database.prepare('select refId from manifests where refId like ?').all(`${manifestRefId}%`);
	if (matchList.length !== 1) {
		opened.database.close();
		return { error: `${moduleName}: manifestRefId '${manifestRefId}' names ${matchList.length} manifest(s) in ${standardsDatabaseFilePath}; it must name exactly one` };
	}
	const memberList = opened.database
		.prepare('select b.kind, b.subject, b.refId from manifestBlocks m join blocks b on b.refId = m.schemaBlockRefId where m.manifestRefId = ? order by b.kind, b.subject, b.refId')
		.all(matchList[0].refId)
		.map((oneRow) => ({ kind: oneRow.kind, subject: oneRow.subject, refId: oneRow.refId }));
	opened.database.close();
	return { manifestRefId: matchList[0].refId, memberList };
};

const memberText = (oneMember) => `${oneMember.kind} ${oneMember.subject} ${oneMember.refId}`;

const compareMemberLists = ({ baselineMemberList, candidateMemberList }) => {
	const candidateRefIdSet = new Set(candidateMemberList.map((oneMember) => oneMember.refId));
	const baselineRefIdSet = new Set(baselineMemberList.map((oneMember) => oneMember.refId));
	const candidateTextSet = new Set(candidateMemberList.map(memberText));
	const candidateRefIdBySubject = candidateMemberList.reduce((soFar, oneMember) => ({ ...soFar, [`${oneMember.kind} ${oneMember.subject}`]: oneMember.refId }), {});
	const comparison = {
		baselineMemberCount: baselineMemberList.length,
		candidateMemberCount: candidateMemberList.length,
		baselineOnlyList: baselineMemberList.filter((oneMember) => !candidateRefIdSet.has(oneMember.refId)),
		subjectMovedList: baselineMemberList
			.filter((oneMember) => candidateRefIdBySubject[`${oneMember.kind} ${oneMember.subject}`] !== undefined && candidateRefIdBySubject[`${oneMember.kind} ${oneMember.subject}`] !== oneMember.refId)
			.map((oneMember) => ({ ...oneMember, candidateRefId: candidateRefIdBySubject[`${oneMember.kind} ${oneMember.subject}`] })),
		candidateOnlyList: candidateMemberList.filter((oneMember) => !baselineRefIdSet.has(oneMember.refId)),
		identicalCount: baselineMemberList.filter((oneMember) => candidateTextSet.has(memberText(oneMember))).length,
	};
	return { comparison, passed: comparison.baselineOnlyList.length === 0 && comparison.subjectMovedList.length === 0 && comparison.candidateOnlyList.length === 0 && comparison.baselineMemberCount > 0 };
};

const compareManifests = ({ baselineStandardsDatabaseFilePath, baselineManifestRefId, candidateStandardsDatabaseFilePath, candidateManifestRefId } = {}) => {
	const baseline = manifestMemberListFor({ standardsDatabaseFilePath: baselineStandardsDatabaseFilePath, manifestRefId: baselineManifestRefId });
	if (baseline.error) {
		return { error: baseline.error };
	}
	const candidate = manifestMemberListFor({ standardsDatabaseFilePath: candidateStandardsDatabaseFilePath, manifestRefId: candidateManifestRefId });
	if (candidate.error) {
		return { error: candidate.error };
	}
	return compareMemberLists({ baselineMemberList: baseline.memberList, candidateMemberList: candidate.memberList });
};

module.exports = {
	latestDecisionBlockByPairKey,
	latestFrozenHeaderByPairKey,
	compareDecisionBlockStores,
	manifestMemberListFor,
	compareMemberLists,
	compareManifests,
	UNCHANGED_VERDICT_LIST,
	VERDICT_IDENTICAL,
	VERDICT_ONLY_FINGERPRINT_DIFFERS,
	VERDICT_DIFFERENT,
	VERDICT_BASELINE_ONLY,
	VERDICT_CANDIDATE_ONLY,
	moduleName,
};
