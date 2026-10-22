#!/usr/bin/env node
'use strict';

// test-termTierStability.js — ⟪zeroBacklog lane A, P9 step 1b⟫ the term tier on THIS hub's real base re-keys nothing.
//
// The only earlier proof (lib/hub-framework/test/test-rdfShapedFixtureHub.js conjunct g) covers PROPERTY stableIds on a
// fixture under rangeAsMeaning. This hub addresses ranges by singleRangeSlot, and its value cards were never checked. So
// this suite forges the REAL base (local asset, no embedding, no graph), derives the hub twice through the framework —
// once under the SHIPPED declaration and once under the same declaration with the term tier TOGGLED (removed when the
// declaration carries it, added when it does not) — and compares the two.
//
// The toggle makes the suite symmetric: it is green before the P9 flip (shipped = off, toggled = on) and after it
// (shipped = on, toggled = off). Before the flip the toggled-on template is the one below; after the flip it is unused.
//
// CONJUNCTS (on = the derivation WITH the term tier, off = WITHOUT)
//   a  both derive
//   b  every PROPERTY card is identical on and off: the same stableId set, and per card the same addressSignature,
//      embedText and every other property value
//   c  every VALUE card likewise
//   d  off mints no term card, no HAS_TERM_REFERENCE, no HAS_<HUB>_TERM edge, and its slotProfile carries no
//      termAddressSignatureFieldOrder
//   e  on mints exactly one term card per base node of the four term roles (counted HERE from the base), one
//      HAS_<HUB>_TERM and one IN_HUB per term card, and exactly one HAS_TERM_REFERENCE per property card landing on
//      the term card whose termIri is that card's propertyUri
//   f  the edge sets differ by exactly the term edges: off is a subset of on, and on minus off is only edges leaving a
//      term card or HAS_TERM_REFERENCE
//   g  the HubDefinition slotProfile differs by exactly the term tier's own share: on carries
//      termAddressSignatureFieldOrder, and its fieldList restricted to the off tiers (each row's tierList trimmed to
//      them, a row left with no tier dropped) is the off fieldList. The fieldList change is by design: a hub's profile
//      is its VIEW of the field table, trimmed to its declared tiers (lib/hub-framework/hubCardFieldTable.js header).
//
// RED TWINS (each a changed COPY of a derived hub, nothing re-derived): a conjunct whose twin is not observed red in
// this suite's output fails the suite.

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the term tier on the real base re-keys no property or value card

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Forges the local asset (no embedding), derives the hub with and without the term tier through the
     framework, and evaluates conjuncts a-g with the twin discipline: every conjunct is OBSERVED going
     RED under a changed copy of a derived hub before its green counts.

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const forgeBundle = require('../forgeCeds')({ embedder: null });
const hubFramework = require(path.join(__dirname, '..', '..', '..', 'lib', 'hub-framework', 'hub-framework'));
const shippedHubDeclaration = require('../lib/cedsHubDeclaration');
const hubHooks = require('../lib/cedsHubHooks')();
const forgeDeclaration = require('../lib/cedsForgeDeclaration');
const { DME_ROLES, HUB_TERM_REFERENCE_EDGE_TYPE, IN_HUB_EDGE_TYPE, hubEdgeType } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const SOURCE_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01', 'CEDS-Ontology.rdf');
const HUB_NAMESPACE = require(path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'forger', 'forger')).resolveBundle({ standard: forgeDeclaration.standardKey }).hubNamespace;

// used ONLY when the shipped declaration lacks the term tier (before the P9 flip); the shape BRONZE_CROWN ruled
// 2026-10-22 (the term template of every hub that declares one)
const TERM_TEMPLATE_WHEN_TOGGLED_ON = [['termName'], ['termDefinition']];
const TERM_TIER_NAME = 'term';
// the base roles the framework mints a term card for (hub-framework TERM_KIND_BY_ROLE), counted here independently
const TERM_ROLE_LIST = [DME_ROLES.CLASS, DME_ROLES.PROPERTY, DME_ROLES.OPTION_SET, DME_ROLES.OPTION_VALUE];

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

const declarationWithoutTermTier = (hubDeclaration) => ({
	...hubDeclaration,
	tierList: hubDeclaration.tierList.filter((oneTier) => oneTier !== TERM_TIER_NAME),
	embedTextTemplateByTier: (({ [TERM_TIER_NAME]: omittedTemplate, ...restTemplateMap }) => restTemplateMap)(hubDeclaration.embedTextTemplateByTier),
});
const declarationWithTermTier = (hubDeclaration) => ({
	...hubDeclaration,
	tierList: [TERM_TIER_NAME].concat(hubDeclaration.tierList),
	embedTextTemplateByTier: { [TERM_TIER_NAME]: TERM_TEMPLATE_WHEN_TOGGLED_ON, ...hubDeclaration.embedTextTemplateByTier },
});

const shippedCarriesTermTier = shippedHubDeclaration.tierList.includes(TERM_TIER_NAME);
const onDeclaration = shippedCarriesTermTier ? shippedHubDeclaration : declarationWithTermTier(shippedHubDeclaration);
const offDeclaration = shippedCarriesTermTier ? declarationWithoutTermTier(shippedHubDeclaration) : shippedHubDeclaration;

const deriveHub = ({ hubDeclaration, hubVersion, baseNodeEdges }) => {
	let outcome;
	hubFramework({ hubDeclaration, hooks: hubHooks, forgeStandardSource: forgeDeclaration.standardSource })({ hubVersion, hubNamespace: HUB_NAMESPACE })
		.forgeHub(baseNodeEdges, (hubError, hub) => {
			outcome = { hubError: hubError ? String(hubError) : '', hub };
		});
	return outcome;
};

const cardsOfTier = (hub, referenceTier) => hub.nodes.filter((oneNode) => oneNode.properties.referenceTier === referenceTier);
const slotProfileOf = (hub) => JSON.parse(hub.nodes.find((oneNode) => oneNode.role === 'HubDefinition').properties.slotProfile);
const edgeTextOf = (oneEdge) => `${oneEdge.fromRef.id}|${oneEdge.type}|${oneEdge.toRef.id}|${JSON.stringify(oneEdge.properties)}`;

// conjuncts b and c: the same stableId set, and per card the same properties (addressSignature and embedText among them)
const cardsIdentical = ({ onHub, offHub, referenceTier }) => {
	const onCardByStableId = new Map(cardsOfTier(onHub, referenceTier).map((oneCard) => [oneCard.stableId, oneCard]));
	const offCardList = cardsOfTier(offHub, referenceTier);
	if (offCardList.length === 0) {
		return { pass: false, detail: `no ${referenceTier} card in the off hub; the comparison would be vacuous` };
	}
	if (onCardByStableId.size !== offCardList.length) {
		return { pass: false, detail: `${referenceTier} card count on ${onCardByStableId.size} vs off ${offCardList.length}` };
	}
	const differingList = offCardList.filter((offCard) => {
		const onCard = onCardByStableId.get(offCard.stableId);
		return !onCard || JSON.stringify(onCard.properties) !== JSON.stringify(offCard.properties) || JSON.stringify(onCard.labels) !== JSON.stringify(offCard.labels);
	});
	const firstDiffering = differingList[0];
	return {
		pass: differingList.length === 0,
		detail: firstDiffering
			? `${differingList.length} ${referenceTier} card(s) differ; first ${firstDiffering.stableId} (addressSignature ${firstDiffering.properties.addressSignature})`
			: `${offCardList.length} ${referenceTier} cards identical (stableId, addressSignature, embedText, every property)`,
	};
};

const judgeByConjunct = {
	a_bothDerive: ({ onOutcome, offOutcome }) => ({
		pass: onOutcome.hubError === '' && offOutcome.hubError === '' && Boolean(onOutcome.hub) && Boolean(offOutcome.hub),
		detail: `on '${onOutcome.hubError}' off '${offOutcome.hubError}'`,
	}),
	b_propertyCardsIdentical: ({ onOutcome, offOutcome }) => cardsIdentical({ onHub: onOutcome.hub, offHub: offOutcome.hub, referenceTier: 'property' }),
	c_valueCardsIdentical: ({ onOutcome, offOutcome }) => cardsIdentical({ onHub: onOutcome.hub, offHub: offOutcome.hub, referenceTier: 'value' }),
	d_offMintsNoTermArtefact: ({ offOutcome, hubName }) => {
		const offHub = offOutcome.hub;
		const termCardCount = cardsOfTier(offHub, TERM_TIER_NAME).length;
		const termReferenceCount = offHub.edges.filter((oneEdge) => oneEdge.type === HUB_TERM_REFERENCE_EDGE_TYPE).length;
		const termSlotEdgeCount = offHub.edges.filter((oneEdge) => oneEdge.type === hubEdgeType(hubName, 'TERM')).length;
		const carriesTermOrder = slotProfileOf(offHub).termAddressSignatureFieldOrder !== undefined;
		return {
			pass: termCardCount === 0 && termReferenceCount === 0 && termSlotEdgeCount === 0 && !carriesTermOrder,
			detail: `term cards ${termCardCount}, ${HUB_TERM_REFERENCE_EDGE_TYPE} ${termReferenceCount}, ${hubEdgeType(hubName, 'TERM')} ${termSlotEdgeCount}, termAddressSignatureFieldOrder ${carriesTermOrder ? 'PRESENT' : 'absent'}`,
		};
	},
	e_onMintsExactlyTheTermTier: ({ onOutcome, expectedTermCardCount, hubName }) => {
		const onHub = onOutcome.hub;
		const termCardList = cardsOfTier(onHub, TERM_TIER_NAME);
		const termCardStableIdSet = new Set(termCardList.map((oneCard) => oneCard.stableId));
		const termCardStableIdByTermIri = new Map(termCardList.map((oneCard) => [oneCard.properties.termIri, oneCard.stableId]));
		const termSlotEdgeCount = onHub.edges.filter((oneEdge) => oneEdge.type === hubEdgeType(hubName, 'TERM') && termCardStableIdSet.has(oneEdge.fromRef.id)).length;
		const termInHubCount = onHub.edges.filter((oneEdge) => oneEdge.type === IN_HUB_EDGE_TYPE && termCardStableIdSet.has(oneEdge.fromRef.id)).length;
		const propertyCardByStableId = new Map(cardsOfTier(onHub, 'property').map((oneCard) => [oneCard.stableId, oneCard]));
		const termReferenceList = onHub.edges.filter((oneEdge) => oneEdge.type === HUB_TERM_REFERENCE_EDGE_TYPE);
		const misdirectedList = termReferenceList.filter((oneEdge) => {
			const propertyCard = propertyCardByStableId.get(oneEdge.fromRef.id);
			return !propertyCard || termCardStableIdByTermIri.get(propertyCard.properties.propertyUri) !== oneEdge.toRef.id;
		});
		const propertyCardsWithReference = new Set(termReferenceList.map((oneEdge) => oneEdge.fromRef.id));
		const pass =
			termCardList.length === expectedTermCardCount &&
			termSlotEdgeCount === expectedTermCardCount &&
			termInHubCount === expectedTermCardCount &&
			termReferenceList.length === propertyCardByStableId.size &&
			propertyCardsWithReference.size === propertyCardByStableId.size &&
			misdirectedList.length === 0;
		return {
			pass,
			detail:
				`term cards ${termCardList.length} (expected ${expectedTermCardCount}), ${hubEdgeType(hubName, 'TERM')} ${termSlotEdgeCount}, ` +
				`IN_HUB from term cards ${termInHubCount}, ${HUB_TERM_REFERENCE_EDGE_TYPE} ${termReferenceList.length} over ${propertyCardsWithReference.size} ` +
				`of ${propertyCardByStableId.size} property cards, misdirected ${misdirectedList.length}`,
		};
	},
	f_edgesDifferOnlyByTermEdges: ({ onOutcome, offOutcome }) => {
		const termCardStableIdSet = new Set(cardsOfTier(onOutcome.hub, TERM_TIER_NAME).map((oneCard) => oneCard.stableId));
		const onEdgeTextSet = new Set(onOutcome.hub.edges.map(edgeTextOf));
		const offEdgeTextSet = new Set(offOutcome.hub.edges.map(edgeTextOf));
		const missingFromOnCount = [...offEdgeTextSet].filter((oneText) => !onEdgeTextSet.has(oneText)).length;
		const strayAddedList = onOutcome.hub.edges.filter(
			(oneEdge) => !offEdgeTextSet.has(edgeTextOf(oneEdge)) && oneEdge.type !== HUB_TERM_REFERENCE_EDGE_TYPE && !termCardStableIdSet.has(oneEdge.fromRef.id),
		);
		return {
			pass: missingFromOnCount === 0 && strayAddedList.length === 0 && offEdgeTextSet.size === offOutcome.hub.edges.length,
			detail: `off edges absent from on: ${missingFromOnCount}; added edges that are not term edges: ${strayAddedList.length}${strayAddedList[0] ? ` (first ${edgeTextOf(strayAddedList[0])})` : ''}`,
		};
	},
	g_slotProfileDiffersOnlyByTermShare: ({ onOutcome, offOutcome }) => {
		const onProfile = slotProfileOf(onOutcome.hub);
		const offProfile = slotProfileOf(offOutcome.hub);
		const offTierList = offDeclaration.tierList;
		const { termAddressSignatureFieldOrder, ...onProfileWithoutTermOrder } = onProfile;
		const restrictedOnProfile = {
			...onProfileWithoutTermOrder,
			fieldList: onProfileWithoutTermOrder.fieldList
				.map((oneRow) => ({ ...oneRow, tierList: oneRow.tierList.filter((oneTier) => offTierList.includes(oneTier)) }))
				.filter((oneRow) => oneRow.tierList.length > 0),
		};
		const termShareRowCount = onProfile.fieldList.filter((oneRow) => oneRow.tierList.includes(TERM_TIER_NAME)).length;
		const restrictedEqualsOff = JSON.stringify(restrictedOnProfile) === JSON.stringify(offProfile);
		return {
			pass: Array.isArray(termAddressSignatureFieldOrder) && restrictedEqualsOff,
			detail:
				`termAddressSignatureFieldOrder ${JSON.stringify(termAddressSignatureFieldOrder)}; ${termShareRowCount} fieldList rows carry the term tier; ` +
				`restricted to [${offTierList.join(',')}] the profile is ${restrictedEqualsOff ? 'identical to off' : 'DIFFERENT from off'}`,
		};
	},
};

forgeBundle.forge({ sourcePath: SOURCE_PATH, skipEmbedding: true }, (forgeError, base) => {
	if (forgeError) {
		harness.ok('the forge succeeded (local asset, no embedding)', false, String(forgeError));
		harness.report();
		return;
	}
	const rootNode = base.nodes.find((oneNode) => v1(oneNode.properties.role) === DME_ROLES.STANDARD_ROOT);
	const hubVersion = rootNode ? v1(rootNode.properties.version) : undefined;
	const hubName = shippedHubDeclaration.hubName;
	const expectedTermCardCount = base.nodes.filter((oneNode) => TERM_ROLE_LIST.includes(v1(oneNode.properties.role))).length;

	harness.section(`THE DERIVATIONS — shipped declaration ${shippedCarriesTermTier ? 'CARRIES' : 'LACKS'} the term tier; the toggled one ${shippedCarriesTermTier ? 'lacks' : 'carries'} it`);
	harness.note(`hubVersion ${hubVersion}; base nodes ${base.nodes.length}; term-role base nodes ${expectedTermCardCount}`);
	const onOutcome = deriveHub({ hubDeclaration: onDeclaration, hubVersion, baseNodeEdges: base });
	const offOutcome = deriveHub({ hubDeclaration: offDeclaration, hubVersion, baseNodeEdges: base });
	const shippedSubject = { onOutcome, offOutcome, expectedTermCardCount, hubName };

	const bothDerived = judgeByConjunct.a_bothDerive(shippedSubject);
	harness.ok('a_bothDerive PASS', bothDerived.pass, bothDerived.detail);
	if (!bothDerived.pass) {
		harness.report();
		return;
	}

	harness.section('BASELINE — every conjunct passes on the real derivations');
	Object.keys(judgeByConjunct).forEach((conjunctRefId) => {
		const verdict = judgeByConjunct[conjunctRefId](shippedSubject);
		harness.ok(`${conjunctRefId} PASS`, verdict.pass, verdict.detail);
		harness.note(`${conjunctRefId}: ${verdict.detail}`);
	});

	const copyOf = (outcome) => ({ hubError: outcome.hubError, hub: JSON.parse(JSON.stringify(outcome.hub)) });
	const withOn = (hubChange) => () => ({ ...shippedSubject, onOutcome: { ...onOutcome, hub: hubChange(copyOf(onOutcome).hub) } });
	const withOff = (hubChange) => () => ({ ...shippedSubject, offOutcome: { ...offOutcome, hub: hubChange(copyOf(offOutcome).hub) } });
	const firstIndexOfTier = (hub, referenceTier) => hub.nodes.findIndex((oneNode) => oneNode.properties.referenceTier === referenceTier);
	const setSlotProfile = (hub, profileChange) => {
		const hubDefinition = hub.nodes.find((oneNode) => oneNode.role === 'HubDefinition');
		hubDefinition.properties.slotProfile = JSON.stringify(profileChange(JSON.parse(hubDefinition.properties.slotProfile)));
		return hub;
	};
	const TWIN_LIST = [
		{ conjunctRefId: 'a_bothDerive', twinName: 'onDerivationRefused', subject: () => ({ ...shippedSubject, onOutcome: { hubError: 'REFUSED (twin)', hub: onOutcome.hub } }) },
		{ conjunctRefId: 'b_propertyCardsIdentical', twinName: 'onePropertyEmbedTextPerturbed', subject: withOn((hub) => {
			hub.nodes[firstIndexOfTier(hub, 'property')].properties.embedText += ' · term';
			return hub;
		}) },
		{ conjunctRefId: 'c_valueCardsIdentical', twinName: 'oneValueAddressSignaturePerturbed', subject: withOn((hub) => {
			hub.nodes[firstIndexOfTier(hub, 'value')].properties.addressSignature = '0'.repeat(64);
			return hub;
		}) },
		{ conjunctRefId: 'd_offMintsNoTermArtefact', twinName: 'termOrderLeakedIntoOffSlotProfile', subject: withOff((hub) => setSlotProfile(hub, (profile) => ({ ...profile, termAddressSignatureFieldOrder: ['hubName', 'termIri', 'hubVersion'] }))) },
		{ conjunctRefId: 'e_onMintsExactlyTheTermTier', twinName: 'oneTermReferenceRedirected', subject: withOn((hub) => {
			const termReferenceList = hub.edges.filter((oneEdge) => oneEdge.type === HUB_TERM_REFERENCE_EDGE_TYPE);
			termReferenceList[0].toRef = { ...termReferenceList[0].toRef, id: termReferenceList[1].toRef.id === termReferenceList[0].toRef.id ? termReferenceList[termReferenceList.length - 1].toRef.id : termReferenceList[1].toRef.id };
			return hub;
		}) },
		{ conjunctRefId: 'f_edgesDifferOnlyByTermEdges', twinName: 'strayNonTermEdgeAdded', subject: withOn((hub) => {
			const propertyCard = cardsOfTier(hub, 'property')[0];
			hub.edges.push({ type: IN_HUB_EDGE_TYPE, fromRef: { source: hubName, id: propertyCard.stableId }, toRef: { source: hubName, id: `${propertyCard.stableId}#stray` }, properties: {} });
			return hub;
		}) },
		{ conjunctRefId: 'g_slotProfileDiffersOnlyByTermShare', twinName: 'onSlotProfileExtraKey', subject: withOn((hub) => setSlotProfile(hub, (profile) => ({ ...profile, strayProfileField: true }))) },
	];
	const extraTwinList = [
		{ conjunctRefId: 'd_offMintsNoTermArtefact', twinName: 'termCardLeakedIntoOff', subject: withOff((hub) => {
			hub.nodes.push(JSON.parse(JSON.stringify(cardsOfTier(onOutcome.hub, TERM_TIER_NAME)[0])));
			return hub;
		}) },
		{ conjunctRefId: 'd_offMintsNoTermArtefact', twinName: 'termReferenceLeakedIntoOff', subject: withOff((hub) => {
			hub.edges.push(JSON.parse(JSON.stringify(onOutcome.hub.edges.find((oneEdge) => oneEdge.type === HUB_TERM_REFERENCE_EDGE_TYPE))));
			return hub;
		}) },
		{ conjunctRefId: 'e_onMintsExactlyTheTermTier', twinName: 'oneTermCardDropped', subject: withOn((hub) => {
			hub.nodes.splice(firstIndexOfTier(hub, TERM_TIER_NAME), 1);
			return hub;
		}) },
	];

	harness.section('THE TWIN SWEEP — each conjunct OBSERVED RED under a changed copy of a derived hub');
	const reddenedConjunctSet = new Set();
	TWIN_LIST.concat(extraTwinList).forEach((oneTwin) => {
		const verdict = judgeByConjunct[oneTwin.conjunctRefId](oneTwin.subject());
		harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
		harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail.slice(0, 200)}`);
		if (!verdict.pass) {
			reddenedConjunctSet.add(oneTwin.conjunctRefId);
		}
	});
	harness.equal('every conjunct has an observed twin', Object.keys(judgeByConjunct).filter((conjunctRefId) => !reddenedConjunctSet.has(conjunctRefId)).join(','), '');

	harness.report();
});
