'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// declaredTargetResolution.js — ⟪ctdlHub P6, WORKORDER-P6 step 3; ruling R-7⟫ how a DECLARED bridge resolves a raw target the
// source wrote (a CURIE such as <prefix>:000113#Label, or <prefix>:keyword) to a BASE node of the target standard. PURE: no graph,
// no I/O, and no standard named anywhere in it: every namespace is the plugin's declared data.
//
// The rule is the plugin's DATA (declaredTargetRuleList), never guessed: an ordered list of rules, each one row of
// DECLARED_TARGET_RULE_KIND_REGISTRY. The FIRST rule whose pattern matches the raw target decides it; a raw target no rule
// matches, or one whose rule names no node, resolves to nothing and becomes an orphan record (named in the frozen block).
//
//   stableIdTemplate   { ruleKind, pattern, stableIdTemplate }   the target IS the node whose stableId is the template with
//                      the pattern's groups filled in ({1}, {2}, …)
//   memberByNotation   { ruleKind, pattern, containerStableIdTemplate, memberEdgeType, memberMatchProperty, memberMatchGroup }
//                      the target is the ONE node reached from the container (the template filled in) by memberEdgeType whose
//                      memberMatchProperty equals the pattern's group memberMatchGroup (e.g. an option value under its option
//                      set, matched on notation). Two members carrying the same value make the target AMBIGUOUS: both are
//                      returned, and the framework's classification decides (never a silent pick)
//
//   declaredTargetRuleListRefusal(ruleList) → '' | the reason, by name     (the contract's kind checker)
//   resolveDeclaredTarget({ ruleList, rawTarget, targetIndex }) → { stableIdList, ruleIndex }   ruleIndex -1 when no rule matched
//   targetIndexFor({ targetRecordList, targetEdgeList }) → the index the resolvers read

const GROUP_REFERENCE_PATTERN = /\{(\d+)\}/g;

const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.trim() !== '';
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const filledTemplate = ({ template, matchGroupList }) => template.replace(GROUP_REFERENCE_PATTERN, (wholeReference, groupNumberText) => matchGroupList[Number(groupNumberText)]);
const highestGroupReferenceOf = (template) => (template.match(GROUP_REFERENCE_PATTERN) || []).reduce((soFar, oneReference) => Math.max(soFar, Number(oneReference.slice(1, -1))), 0);
const compiledPatternOf = (patternText) => new RegExp(patternText);
const groupCountOf = (patternText) => new RegExp(`${patternText}|`).exec('').length - 1;

const DECLARED_TARGET_RULE_KIND_REGISTRY = Object.freeze({
	stableIdTemplate: Object.freeze({
		memberNameList: Object.freeze(['ruleKind', 'pattern', 'stableIdTemplate']),
		refusal: (oneRule) => (!isNonEmptyString(oneRule.stableIdTemplate) ? 'stableIdTemplate must be a non-empty string' : highestGroupReferenceOf(oneRule.stableIdTemplate) > groupCountOf(oneRule.pattern) ? `stableIdTemplate '${oneRule.stableIdTemplate}' names a group the pattern does not capture` : ''),
		resolve: ({ oneRule, matchGroupList, targetIndex }) => {
			const stableId = filledTemplate({ template: oneRule.stableIdTemplate, matchGroupList });
			return targetIndex.recordByStableId[stableId] === undefined ? [] : [stableId];
		},
	}),
	memberByNotation: Object.freeze({
		memberNameList: Object.freeze(['ruleKind', 'pattern', 'containerStableIdTemplate', 'memberEdgeType', 'memberMatchProperty', 'memberMatchGroup']),
		refusal: (oneRule) => {
			if (!isNonEmptyString(oneRule.containerStableIdTemplate) || !isNonEmptyString(oneRule.memberEdgeType) || !isNonEmptyString(oneRule.memberMatchProperty)) {
				return 'containerStableIdTemplate, memberEdgeType and memberMatchProperty must be non-empty strings';
			}
			if (!Number.isInteger(oneRule.memberMatchGroup) || oneRule.memberMatchGroup < 1 || oneRule.memberMatchGroup > groupCountOf(oneRule.pattern)) {
				return `memberMatchGroup must name a group the pattern captures (1..${groupCountOf(oneRule.pattern)})`;
			}
			return highestGroupReferenceOf(oneRule.containerStableIdTemplate) > groupCountOf(oneRule.pattern) ? `containerStableIdTemplate '${oneRule.containerStableIdTemplate}' names a group the pattern does not capture` : '';
		},
		resolve: ({ oneRule, matchGroupList, targetIndex }) => {
			const containerStableId = filledTemplate({ template: oneRule.containerStableIdTemplate, matchGroupList });
			const memberStableIdList = (targetIndex.memberStableIdListByContainerAndEdgeType[`${containerStableId}\u001f${oneRule.memberEdgeType}`] || []);
			const wantedValue = matchGroupList[oneRule.memberMatchGroup];
			return memberStableIdList.filter((oneStableId) => targetIndex.recordByStableId[oneStableId].properties[oneRule.memberMatchProperty] === wantedValue).sort();
		},
	}),
});

// declaredTargetRuleListRefusal — the contract's kind checker: a non-empty ordered list, each rule a registered kind with
// exactly its members and a pattern that compiles and is anchored (a rule never matches a fragment of a raw target)
const declaredTargetRuleListRefusal = (ruleList) => {
	if (!Array.isArray(ruleList) || ruleList.length === 0) {
		return `must be a non-empty ordered list of rules (${Object.keys(DECLARED_TARGET_RULE_KIND_REGISTRY).join(', ')})`;
	}
	for (let ruleIndex = 0; ruleIndex < ruleList.length; ruleIndex++) {
		const oneRule = ruleList[ruleIndex];
		if (!isPlainObject(oneRule)) {
			return `rule ${ruleIndex} is not an object`;
		}
		const kindRow = DECLARED_TARGET_RULE_KIND_REGISTRY[oneRule.ruleKind];
		if (kindRow === undefined) {
			return `rule ${ruleIndex} ruleKind ${JSON.stringify(oneRule.ruleKind)} is not one of ${Object.keys(DECLARED_TARGET_RULE_KIND_REGISTRY).join(', ')}`;
		}
		const unknownMember = Object.keys(oneRule).find((oneName) => kindRow.memberNameList.indexOf(oneName) === -1);
		if (unknownMember !== undefined) {
			return `rule ${ruleIndex} (${oneRule.ruleKind}) carries unknown member '${unknownMember}'; its members are ${kindRow.memberNameList.join(', ')}`;
		}
		if (!isNonEmptyString(oneRule.pattern) || oneRule.pattern[0] !== '^' || oneRule.pattern[oneRule.pattern.length - 1] !== '$') {
			return `rule ${ruleIndex} pattern must be a non-empty regular expression anchored with ^ and $`;
		}
		// RegExp throws on a pattern that does not compile; the throw is translated ONCE, here, into a refusal by name (the same
		// single-site boundary dispensation sifCedsStandardPlugin's crossRefsFrom takes for JSON.parse), never control flow
		let compileFault = '';
		try {
			compiledPatternOf(oneRule.pattern);
		} catch (compileError) {
			compileFault = compileError.message;
		}
		if (compileFault !== '') {
			return `rule ${ruleIndex} pattern does not compile (${compileFault})`;
		}
		const kindFault = kindRow.refusal(oneRule);
		if (kindFault !== '') {
			return `rule ${ruleIndex} (${oneRule.ruleKind}): ${kindFault}`;
		}
	}
	return '';
};

// targetIndexFor — the target standard's base records by stableId, and each container's members by (container, edge type)
const targetIndexFor = ({ targetRecordList, targetEdgeList }) => {
	const recordByStableId = targetRecordList.reduce((soFar, oneRecord) => Object.assign(soFar, { [oneRecord.stableId]: oneRecord }), {});
	const memberStableIdListByContainerAndEdgeType = {};
	targetEdgeList
		.filter((oneEdge) => recordByStableId[oneEdge.fromStableId] !== undefined && recordByStableId[oneEdge.toStableId] !== undefined)
		.forEach((oneEdge) => {
			const containerRefId = `${oneEdge.fromStableId}\u001f${oneEdge.type}`;
			(memberStableIdListByContainerAndEdgeType[containerRefId] = memberStableIdListByContainerAndEdgeType[containerRefId] || []).push(oneEdge.toStableId);
		});
	return { recordByStableId, memberStableIdListByContainerAndEdgeType };
};

// resolveDeclaredTarget — the first matching rule decides; a match that names no node is an empty list, never a later rule's
const resolveDeclaredTarget = ({ ruleList, rawTarget, targetIndex }) => {
	for (let ruleIndex = 0; ruleIndex < ruleList.length; ruleIndex++) {
		const oneRule = ruleList[ruleIndex];
		const matchGroupList = compiledPatternOf(oneRule.pattern).exec(rawTarget);
		if (matchGroupList !== null) {
			return { stableIdList: DECLARED_TARGET_RULE_KIND_REGISTRY[oneRule.ruleKind].resolve({ oneRule, matchGroupList, targetIndex }), ruleIndex };
		}
	}
	return { stableIdList: [], ruleIndex: -1 };
};

module.exports = { DECLARED_TARGET_RULE_KIND_REGISTRY, declaredTargetRuleListRefusal, targetIndexFor, resolveDeclaredTarget, moduleName };
