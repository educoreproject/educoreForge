'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sequenceGroups.js — the ordering groups the walk hands the framework (DESIGN-pescForge.md §4.4;
// gate F22). The framework calls lib/sequence-contract finalizeSequence on them, which stamps
// sequenceOrdinal, siblingCount and orderSemantics on every member and nothing else.
//
//   makeSequenceGroupCollector() → { addGroup({ groupKey, members, compositor }), sequenceGroups() }
//     compositor is the owner's top compositor ('sequence', 'choice'), or GROUP_KIND.DOCUMENT_ORDER
//     for a list whose order is only the file's (a code list's codes, a schema file's definitions)
//
// orderSemantics is looked up in ORDER_SEMANTICS_BY_COMPOSITOR: 'normative' only for xs:sequence,
// where the schema makes reordering the children invalid; 'document' otherwise. The sequence
// contract cannot know which compositor a group came from (code fact, sequence-contract.js accepts
// either value from any caller), so THIS module holds the line: a group the table marks 'normative'
// whose compositor is not 'sequence' is refused by name. That refusal is what gate F22's twin
// observes when the table is altered to mark a choice group normative.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const GROUP_KIND = Object.freeze({ DOCUMENT_ORDER: 'documentOrder' });
const NORMATIVE = 'normative';
const DOCUMENT = 'document';
const ORDER_SEMANTICS_BY_COMPOSITOR = Object.freeze({
	sequence: NORMATIVE,
	choice: DOCUMENT,
	[GROUP_KIND.DOCUMENT_ORDER]: DOCUMENT,
});
// the one compositor under which order is schema-normative
const NORMATIVE_COMPOSITOR = 'sequence';

const makeSequenceGroupCollector = () => {
	const orderingByParent = {};
	const addGroup = ({ groupKey, members, compositor }) => {
		const orderSemantics = ORDER_SEMANTICS_BY_COMPOSITOR[compositor];
		if (orderSemantics === undefined) {
			throw refuse.byName({ moduleName, what: `group '${groupKey}' has compositor '${compositor}'`, where: `ordering is known for ${Object.keys(ORDER_SEMANTICS_BY_COMPOSITOR).join(', ')}` });
		}
		if (orderSemantics === NORMATIVE && compositor !== NORMATIVE_COMPOSITOR) {
			throw refuse.byName({ moduleName, what: `group '${groupKey}' would be marked '${NORMATIVE}' under compositor '${compositor}'`, where: `only an xs:${NORMATIVE_COMPOSITOR} owner makes element order normative (the sequence contract cannot check this; this module does)` });
		}
		if (orderingByParent[groupKey] !== undefined) {
			throw refuse.byName({ moduleName, what: `group '${groupKey}' is added twice`, where: 'one ordering group per owner' });
		}
		orderingByParent[groupKey] = { members, orderSemantics };
	};
	const sequenceGroups = () => ({ orderingByParent });
	return { addGroup, sequenceGroups };
};

module.exports = { makeSequenceGroupCollector, GROUP_KIND, ORDER_SEMANTICS_BY_COMPOSITOR, moduleName };
