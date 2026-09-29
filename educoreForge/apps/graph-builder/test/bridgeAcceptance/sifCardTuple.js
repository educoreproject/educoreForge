'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sifCardTuple.js — the card label list with FULL TUPLES (phase C6b). Pure and synchronous: the live export tool
// (evidence/C6b/liveHubCardTupleExport.js) reads the hub's property-tier cards and its option values and hands the
// rows to buildCardTupleList; the review page (sifReviewPage.js) reads the list this writes.
//
//   buildCardTupleList({ cardRowList, optionValueRowList }) → { cardLabelByStableId, optionValueLabelByRefId } | { error }
//     cardRowList:        [{ cardStableId, domainId, domainName, propertyId, propertyName, rangeOptionSetId?,
//                            rangeOptionSetName?, valueNotation?, valueName?, qualifierRefIdList }]
//     optionValueRowList: [{ optionValueRefId, optionValueName, optionSetId, optionSetName }]
//
// A card entry keeps C6's two fields (domainName, propertyName) and adds the ids and the optional slots. A slot the
// card does not have is ABSENT from its entry, never null. Each qualifier is carried as its option value's id in
// qualifierRefIdList, and its human label (option set name, option value name) sits once in optionValueLabelByRefId.
// A qualifier no option value row resolves to both names is refused by name: a raw id is never carried alone.

const path = require('path');
const refuse = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'forge-framework', 'refuse'));

const OPTIONAL_SLOT_NAME_LIST = Object.freeze(['rangeOptionSetId', 'rangeOptionSetName', 'valueNotation', 'valueName']);

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
		const cardLabel = { domainId: oneCard.domainId, domainName: oneCard.domainName, propertyId: oneCard.propertyId, propertyName: oneCard.propertyName };
		OPTIONAL_SLOT_NAME_LIST.filter((oneSlotName) => oneCard[oneSlotName] !== undefined && oneCard[oneSlotName] !== null).forEach((oneSlotName) => {
			cardLabel[oneSlotName] = oneCard[oneSlotName];
		});
		cardLabel.qualifierRefIdList = oneCard.qualifierRefIdList.slice();
		cardLabelByStableId[oneCard.cardStableId] = cardLabel;
	}
	return { cardLabelByStableId, optionValueLabelByRefId };
};

module.exports = { buildCardTupleList, OPTIONAL_SLOT_NAME_LIST, moduleName };
