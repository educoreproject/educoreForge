'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// subjectGrouping.js — group-by-subject, the subjectStableIdFor orchestration helpers, remodel application,
// the many-to-one census and the BR-136/BR-138 refusals (SPEC-bridgeFramework-v1.md §5.3; RULINGS P2, P11;
// BR-035, BR-036, BR-136, BR-138). PURE — no I/O, no clock; the hook CALL itself is orchestration in
// bridge-framework.js (ONCE per run with the distinct subject list, D-S6).
//
//   subjectKeyFor({ subjectIdentity, assertion })       the CARDINALITY UNIT key (identity values joined)
//   groupBySubject({ assertionList, subjectIdentity })  → { subjectGroupList } | { error } (path-blind key refused)
//   verifyResolutionAndMerge({ subjectGroupList, resolutionBySubjectKey, subjectNodeStableIdSet })
//        → { leafList, sourceGapList, subjectCollisionList, manyToOneSubjectCount }
//   applyRemodel({ target, remodelTable, hubName, hubVersion, classSideRemodelTable })  → the rewritten target

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const SUBJECT_KEY_SEPARATOR = '\u001f'; // the unit separator — never inside a cell value

const subjectKeyFor = ({ subjectIdentity, assertion } = {}) => {
	if (subjectIdentity.kind === 'forgedNode') {
		return String(assertion.subjectIdentity[subjectIdentity.property]);
	}
	return subjectIdentity.columnList.map((oneColumn) => String(assertion.subjectIdentity[oneColumn])).join(SUBJECT_KEY_SEPARATOR);
};

// groupBySubject — REFUSES a walk yielding two assertions with equal subject key and unequal identity
// values (a path-blind key, BR-136); assertions keep walk order inside a group (the freeze sorts later)
const groupBySubject = ({ assertionList, subjectIdentity } = {}) => {
	const identityNameList = subjectIdentity.kind === 'forgedNode' ? [subjectIdentity.property] : subjectIdentity.columnList;
	const groupByKey = {};
	const subjectGroupList = [];
	for (let assertionIndex = 0; assertionIndex < assertionList.length; assertionIndex++) {
		const oneAssertion = assertionList[assertionIndex];
		const missingName = identityNameList.find((oneName) => oneAssertion.subjectIdentity === undefined || oneAssertion.subjectIdentity[oneName] === undefined || oneAssertion.subjectIdentity[oneName] === '');
		if (missingName !== undefined) {
			return { error: refuse.byName({ moduleName, what: `assertion ${assertionIndex} (${JSON.stringify(oneAssertion.sourceLocator)}) lacks subject identity value '${missingName}'`, where: 'every assertion carries the declared subjectIdentity values; an empty identity cell is a malformed row' }) };
		}
		const identityText = JSON.stringify(identityNameList.map((oneName) => [oneName, oneAssertion.subjectIdentity[oneName]]));
		const subjectKey = subjectKeyFor({ subjectIdentity, assertion: oneAssertion });
		const existing = groupByKey[subjectKey];
		if (existing !== undefined) {
			if (existing.identityText !== identityText) {
				return { error: refuse.byName({ moduleName, what: `subject key ${JSON.stringify(subjectKey)} is shared by assertions with UNEQUAL identity values (${existing.identityText} vs ${identityText})`, where: 'the subject key is path-blind (BR-136); the framework refuses so no plugin can forget it' }) };
			}
			existing.assertionList.push(oneAssertion);
			continue;
		}
		const group = { subjectKey, subjectIdentity: { ...oneAssertion.subjectIdentity }, identityText, assertionList: [oneAssertion] };
		groupByKey[subjectKey] = group;
		subjectGroupList.push(group);
	}
	return { subjectGroupList };
};

// targetSetTextFor — the DISTINCT target set of a subject group as canonical text (for collision detection)
const targetSetTextFor = (subjectGroup) =>
	JSON.stringify(
		Array.from(new Set(subjectGroup.assertionList.reduce((soFar, oneAssertion) => soFar.concat(oneAssertion.targetKeyList || []), []))).sort(),
	);

// verifyResolutionAndMerge — every subject's resolution verified against the declared subject nodes (else
// sourceGap); many-to-one counted; a merged subjectStableId whose subjects carry DIFFERENT target sets →
// subjectCollision (all targets named with their asserting subjects)
const verifyResolutionAndMerge = ({ subjectGroupList, resolutionBySubjectKey, subjectNodeStableIdSet } = {}) => {
	const leafBySubjectStableId = {};
	const leafList = [];
	const sourceGapList = [];
	subjectGroupList.forEach((oneGroup) => {
		const resolution = resolutionBySubjectKey[oneGroup.subjectKey];
		if (resolution === undefined || resolution === null || typeof resolution !== 'object') {
			sourceGapList.push({ subjectKey: oneGroup.subjectKey, subjectIdentity: oneGroup.subjectIdentity, reason: 'noResolutionReturned', detail: 'subjectStableIdFor returned nothing for this subject', assertionList: oneGroup.assertionList });
			return;
		}
		if (resolution.unresolvable !== undefined) {
			sourceGapList.push({ subjectKey: oneGroup.subjectKey, subjectIdentity: oneGroup.subjectIdentity, reason: String(resolution.unresolvable), detail: resolution.detail === undefined ? '' : String(resolution.detail), assertionList: oneGroup.assertionList });
			return;
		}
		if (typeof resolution.subjectStableId !== 'string' || !subjectNodeStableIdSet.has(resolution.subjectStableId)) {
			sourceGapList.push({ subjectKey: oneGroup.subjectKey, subjectIdentity: oneGroup.subjectIdentity, reason: 'subjectStableIdNotADeclaredSubjectNode', detail: `subjectStableId ${JSON.stringify(resolution.subjectStableId)} is not among the source standard's forged subject nodes`, assertionList: oneGroup.assertionList });
			return;
		}
		const leaf = leafBySubjectStableId[resolution.subjectStableId];
		if (leaf === undefined) {
			const newLeaf = { subjectStableId: resolution.subjectStableId, subjectGroupList: [oneGroup], assertingSubjectList: [oneGroup.subjectKey] };
			leafBySubjectStableId[resolution.subjectStableId] = newLeaf;
			leafList.push(newLeaf);
			return;
		}
		leaf.subjectGroupList.push(oneGroup);
		leaf.assertingSubjectList.push(oneGroup.subjectKey);
	});
	const subjectCollisionList = [];
	const mergedLeafList = [];
	let manyToOneSubjectCount = 0;
	leafList.forEach((oneLeaf) => {
		if (oneLeaf.subjectGroupList.length > 1) {
			manyToOneSubjectCount += oneLeaf.subjectGroupList.length;
			const targetSetTextList = oneLeaf.subjectGroupList.map(targetSetTextFor);
			if (new Set(targetSetTextList).size > 1) {
				subjectCollisionList.push({
					subjectStableId: oneLeaf.subjectStableId,
					assertingSubjectList: oneLeaf.assertingSubjectList.slice().sort(),
					targetSetBySubjectKey: oneLeaf.subjectGroupList.reduce((soFar, oneGroup) => ({ ...soFar, [oneGroup.subjectKey]: JSON.parse(targetSetTextFor(oneGroup)) }), {}),
					subjectGroupList: oneLeaf.subjectGroupList,
				});
				return;
			}
		}
		mergedLeafList.push({ subjectStableId: oneLeaf.subjectStableId, assertingSubjectList: oneLeaf.assertingSubjectList.slice().sort(), assertionList: oneLeaf.subjectGroupList.reduce((soFar, oneGroup) => soFar.concat(oneGroup.assertionList), []) });
	});
	return { leafList: mergedLeafList, sourceGapList, subjectCollisionList, manyToOneSubjectCount };
};

// applyRemodel — the HUB-owned property-side table (keyed hubName@hubVersion, entries rawCanonicalKey →
// { canonicalKey, qualifierKeys?, domainId?, propertyKey? } — a specific TUPLE) is applied BEFORE direct
// resolution; the class-side table then rewrites a supplied domainId for that key. Returns
// { target, remodelApplied, sourceDomainSuperseded }.
const applyRemodel = ({ target, remodelTable, hubName, hubVersion, classSideRemodelTable } = {}) => {
	let rewritten = { ...target };
	let remodelApplied = null;
	let sourceDomainSuperseded = null;
	if (remodelTable !== null && remodelTable !== undefined) {
		const tableForHub = remodelTable[`${hubName}@${hubVersion}`];
		const entry = tableForHub === undefined ? undefined : tableForHub[target.canonicalKey];
		if (entry !== undefined) {
			const from = { canonicalKey: target.canonicalKey };
			rewritten = { ...rewritten, canonicalKey: entry.canonicalKey };
			Object.keys(entry).forEach((oneField) => {
				if (oneField !== 'canonicalKey') {
					if (oneField === 'domainId' && target.domainId !== undefined && target.domainId !== entry.domainId) {
						sourceDomainSuperseded = { from: target.domainId, to: entry.domainId };
					}
					rewritten[oneField] = entry[oneField];
				}
			});
			remodelApplied = { side: 'property', from, to: { ...entry } };
		}
	}
	if (Array.isArray(classSideRemodelTable) && rewritten.domainId !== undefined) {
		const classEntry = classSideRemodelTable.find((oneEntry) => oneEntry.canonicalKey === rewritten.canonicalKey && oneEntry.sourceDomainId === rewritten.domainId);
		if (classEntry !== undefined) {
			remodelApplied = { side: remodelApplied === null ? 'class' : 'propertyAndClass', from: { ...(remodelApplied === null ? {} : remodelApplied.from), domainId: rewritten.domainId }, to: { ...(remodelApplied === null ? {} : remodelApplied.to), domainId: classEntry.targetDomainId } };
			rewritten = { ...rewritten, domainId: classEntry.targetDomainId };
		}
	}
	return { target: rewritten, remodelApplied, sourceDomainSuperseded };
};

module.exports = { subjectKeyFor, groupBySubject, verifyResolutionAndMerge, applyRemodel, targetSetTextFor, SUBJECT_KEY_SEPARATOR, moduleName };
