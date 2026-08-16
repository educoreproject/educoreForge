'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// conflictDetector.js — the cross-plugin CONFLICT detector: a STORE-SIDE SIBLING LOOKUP (SPEC-bridgeFramework-
// v1.md §5.5; RULINGS A11, BF8, SABLE_RIVER 12:05 #1). Phase C runs pairings SERIALLY on fresh dependency
// graphs, so "refuse the SECOND plugin's materialisation" is implemented as: before materialising, look up in
// the decision store the LATEST block of every OTHER (bridgeName, producerKind) on the same hub@ver::source@ver
// prefix — ANY bridge, ANY producerKind (RULING BR7; the sibling pairKeys are composed from the registry — the store's API is getDecisionBlock({ pairKey }),
// untouched); for each subjectStableId present in both with a DIFFERENT objectStableId, THIS plugin's
// materialisation of that subject is REFUSED by name (its block is recorded, that edge is NOT written), a
// conflict record naming both targets goes to the REPORT and to a MappingReview trail (matchForensics — the
// store has no queue API and is untouched; named DEVLOG deviation), and the FIRST plugin's edges STAND.
// conflictCount is a REPORT member, never a census member. HOSTED by the seam face (which composes the
// sibling list from its registry) and called by the framework before materialise; a suite hands the same
// detector a fixture registry (two toy plugins on one pairing).
//
//   detectSiblingConflicts({ decisionStore, siblingPairKeyList, thisBlock }, cb(err, { conflictList, siblingBlockCount }))

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { parseFrozenText } = require('./decisionBlock');
const { pickedRecordList } = require('./materialiser');
const { MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

// siblingPairKeyListFor — the sibling lookup SPANS THE PAIRING (RULING BR7): every registered plugin on the SAME
// standardKey (any bridgeName, this one included under a DIFFERENT producerKind) × EVERY mapping-block producerKind
// the vocabulary knows (MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND — authored, inferred), minus THIS block's own
// (bridgeName, producerKind) pairKey. Two sources disagreeing on a subject's hub card is a conflict regardless of who
// produced the other block. The store's API stays getDecisionBlock({ pairKey }); the keys are composed here.
const siblingPairKeyListFor = ({ registry, thisBridgeName, standardKey, pairKeyPrefix, producerKind } = {}) => {
	const bridgeNameList = Object.keys(registry.entryByBridgeName)
		.filter((oneName) => registry.entryByBridgeName[oneName].standardKey === standardKey)
		.sort();
	const producerKindList = Object.keys(MAPPING_EDGE_PROVENANCE_TIER_BY_PRODUCER_KIND).sort();
	const thisPairKey = `${pairKeyPrefix}::${thisBridgeName}::${producerKind}`;
	const siblingList = [];
	bridgeNameList.forEach((oneName) => {
		producerKindList.forEach((oneKind) => {
			const siblingPairKey = `${pairKeyPrefix}::${oneName}::${oneKind}`;
			if (siblingPairKey !== thisPairKey) {
				siblingList.push({ siblingBridgeName: oneName, siblingProducerKind: oneKind, siblingPairKey });
			}
		});
	});
	return siblingList;
};

const detectSiblingConflicts = ({ decisionStore, siblingPairKeyList, thisBlock } = {}, callback) => {
	if (!decisionStore || typeof decisionStore.getDecisionBlock !== 'function') {
		callback(refuse.byName({ moduleName, what: 'decisionStore is absent', where: 'the detector reads sibling blocks through decisionStore.getDecisionBlock' }).message);
		return;
	}
	if (!Array.isArray(siblingPairKeyList) || !thisBlock || !Array.isArray(thisBlock.decisionRecordList)) {
		callback(refuse.byName({ moduleName, what: 'siblingPairKeyList (a list) and thisBlock (parsed) are required', where: 'detectSiblingConflicts' }).message);
		return;
	}
	const thisObjectBySubject = {};
	pickedRecordList(thisBlock.decisionRecordList).forEach((oneRecord) => {
		(thisObjectBySubject[oneRecord.subjectStableId] = thisObjectBySubject[oneRecord.subjectStableId] || new Set()).add(oneRecord.objectStableId);
	});
	const conflictList = [];
	let siblingBlockCount = 0;
	let siblingIndex = 0;
	const nextSibling = () => {
		if (siblingIndex >= siblingPairKeyList.length) {
			callback('', { conflictList, siblingBlockCount });
			return;
		}
		const oneSibling = siblingPairKeyList[siblingIndex];
		siblingIndex += 1;
		decisionStore.getDecisionBlock({ pairKey: oneSibling.siblingPairKey }, (getError, stored) => {
			if (getError) {
				callback(`${moduleName}: sibling lookup ${oneSibling.siblingPairKey}: ${getError}`);
				return;
			}
			if (!stored || stored.frozenText === null || stored.frozenText === undefined) {
				nextSibling();
				return;
			}
			const parsed = parseFrozenText(stored.frozenText);
			if (parsed.error) {
				callback(`${moduleName}: sibling block ${oneSibling.siblingPairKey}: ${parsed.error.message}`);
				return;
			}
			siblingBlockCount += 1;
			pickedRecordList(parsed.block.decisionRecordList).forEach((oneSiblingRecord) => {
				const thisSet = thisObjectBySubject[oneSiblingRecord.subjectStableId];
				if (thisSet === undefined) {
					return;
				}
				if (!thisSet.has(oneSiblingRecord.objectStableId)) {
					conflictList.push({
						subjectStableId: oneSiblingRecord.subjectStableId,
						thisObjectStableIdList: Array.from(thisSet).sort(),
						siblingBridgeName: oneSibling.siblingBridgeName,
						siblingPairKey: oneSibling.siblingPairKey,
						siblingObjectStableId: oneSiblingRecord.objectStableId,
						siblingDecisionBlockHash: stored.decisionBlockHash,
						disposition: 'thisPluginMaterialisationRefused',
						mappingJustification: 'semapv:MappingReview',
					});
				}
			});
			nextSibling();
		});
	};
	nextSibling();
};

module.exports = { detectSiblingConflicts, siblingPairKeyListFor, moduleName };
