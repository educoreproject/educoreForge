'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifCardTuple.js — the card label list with FULL TUPLES (phase C6b). Pure and synchronous: the live export tool
// (evidence/C6b/liveHubCardTupleExport.js) reads the hub's property-tier cards and its option values and hands the
// rows to buildCardTupleList; the review page (sifReviewPage.js) reads the list this writes.
//
//   buildCardTupleList({ cardRowList, optionValueRowList }) → { cardLabelByStableId, optionValueLabelByRefId } | { error }
//     cardRowList:        [{ cardStableId, domainId, domainName, propertyId, propertyName, qualifierRefIdList,
//                            the range: exactly ONE of { rangeOptionSetId, rangeOptionSetName } (an option set),
//                            { rangeDatatype } (a scalar datatype) or { rangeClassId, rangeClassName } (a class),
//                            and optionally domainDefinition, propertyDefinition, rangeOptionSetDefinition,
//                            rangeClassDefinition, valueNotation, valueName }]
//     optionValueRowList: [{ optionValueRefId, optionValueName, optionSetId, optionSetName }]
//
// A card entry keeps C6's two fields (domainName, propertyName) and adds the ids and the optional slots. A slot the
// card does not have is ABSENT from its entry, never null. THE RANGE has three source shapes (the class shape is the
// third; EBONY_DREAM's pointer): an option set, a scalar datatype, a class. A card carrying none, or more than one, is
// refused by name, so an absent option set can never read as 'no range'. On the live hub every one of the 2,777
// property-tier cards carries exactly one (1,207 option set, 1,085 datatype, 485 class; measured 2026-09-29). Each qualifier is carried as its option value's id in
// qualifierRefIdList, and its human label (option set name, option value name) sits once in optionValueLabelByRefId.
// A qualifier no option value row resolves to both names is refused by name: a raw id is never carried alone.

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'forge-framework', 'refuse'));

const RANGE_SHAPE_LIST = Object.freeze([['rangeOptionSetId', 'rangeOptionSetName'], ['rangeDatatype'], ['rangeClassId', 'rangeClassName']]);
const OPTIONAL_SLOT_NAME_LIST = Object.freeze(['domainDefinition', 'propertyDefinition', 'rangeOptionSetId', 'rangeOptionSetName', 'rangeOptionSetDefinition', 'rangeDatatype', 'rangeClassId', 'rangeClassName', 'rangeClassDefinition', 'valueNotation', 'valueName']);
const isPresent = (slotValue) => slotValue !== undefined && slotValue !== null;

const buildCardTupleList = ({ cardRowList, optionValueRowList }) => {
	const optionValueLabelByRefId = {};
	optionValueRowList.forEach((oneRow) => {
		optionValueLabelByRefId[oneRow.optionValueRefId] = { optionSetId: oneRow.optionSetId, optionSetName: oneRow.optionSetName, optionValueName: oneRow.optionValueName };
	});
	const cardLabelByStableId = {};
	for (let cardIndex = 0; cardIndex < cardRowList.length; cardIndex++) {
		const oneCard = cardRowList[cardIndex];
		const unresolvedRefId = oneCard.qualifierRefIdList.find((oneRefId) => optionValueLabelByRefId[oneRefId] === undefined || !optionValueLabelByRefId[oneRefId].optionValueName || !optionValueLabelByRefId[oneRefId].optionSetName);
		if (unresolvedRefId !== undefined) {
			return { error: refuse.byName({ moduleName, what: `card ${oneCard.cardStableId} carries qualifier ${unresolvedRefId}, and no option value row resolves it to an option value name and an option set name`, where: 'every qualifier a card carries must resolve to its option value name in the hub; the tuple list never carries a raw id alone' }) };
		}
		const carriedRangeShapeList = RANGE_SHAPE_LIST.filter((oneShape) => isPresent(oneCard[oneShape[0]]));
		if (carriedRangeShapeList.length !== 1) {
			return { error: refuse.byName({ moduleName, what: `card ${oneCard.cardStableId} carries ${carriedRangeShapeList.length} range shapes (${carriedRangeShapeList.map((oneShape) => oneShape[0]).join(', ') || 'none'})`, where: 'a card\'s range is exactly one of an option set, a scalar datatype or a class; the tuple list never leaves a range unstated' }) };
		}
		const cardLabel = { domainId: oneCard.domainId, domainName: oneCard.domainName, propertyId: oneCard.propertyId, propertyName: oneCard.propertyName };
		OPTIONAL_SLOT_NAME_LIST.filter((oneSlotName) => isPresent(oneCard[oneSlotName])).forEach((oneSlotName) => {
			cardLabel[oneSlotName] = oneCard[oneSlotName];
		});
		cardLabel.qualifierRefIdList = oneCard.qualifierRefIdList.slice();
		cardLabelByStableId[oneCard.cardStableId] = cardLabel;
	}
	return { cardLabelByStableId, optionValueLabelByRefId };
};

module.exports = { buildCardTupleList, OPTIONAL_SLOT_NAME_LIST, RANGE_SHAPE_LIST, moduleName };
