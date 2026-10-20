'use strict';

// test-rdfShapedFixtureHub.js — ⟪ctdlHub P3 step 6⟫ the hub framework over a SYNTHETIC RDF-SHAPED HUB: the term tier
// on, ranges as meaning (rangeAsMeaning), HAS_TERM_REFERENCE between the tiers. The base (fixtures/rdfShapedHub/) is
// small enough that every expected number is derived by hand below. PURE: no forge, no graph, no I/O beyond the fixture.
//
// THE FIXTURE BASE: 3 classes, 4 properties, 1 option set (scheme) with 3 values (concepts).
//   ex:name            domains Person, Credential, Organization   range: datatype xsd:string
//   ex:holder          domain  Credential                         range: classes Person, Organization (REFERENCES)
//   ex:status          domains Credential, Organization           range: option set StatusScheme AND datatype xsd:string
//   ex:orphanProperty  NO domain                                  range: datatype xsd:date
//
// EXPECTED COUNTS, AND WHY:
//   term      11 = 3 classes + 4 properties + 1 scheme + 3 concepts. The domain-less property still gets one: a term
//                  card needs only an IRI, not a tuple.
//   property   6 = name 3 domains + holder 1 + status 2 + orphanProperty 0. ranges do NOT multiply property cards:
//                  status has two ranges and still one card per domain (rangeAsMeaning; PLAN §5 risk 4).
//   value      6 = status's 2 domains x 1 option set x 3 concepts.
//   HAS_TERM_REFERENCE 6 = one per property card; the ex:name term card receives 3 of them.
//   nodes     24 = 11 + 6 + 6 + 1 HubDefinition.
//   edges     80 = term 11 x (HAS_FIXTURE_TERM + IN_HUB) = 22
//                + property cards: DOMAIN + PROPERTY + IN_HUB + HAS_TERM_REFERENCE = 4 each, plus one RANGE per range
//                  NODE: name 3 x 4 = 12 (a datatype is not a node), holder 1 x (4 + 2) = 6, status 2 x (4 + 1) = 10
//                  -> 28
//                + value cards: DOMAIN + PROPERTY + RANGE + VALUE + IN_HUB = 5 each x 6 = 30
//   skip       1: ex:orphanProperty, reason zeroDeclaredDomains (property tier only).
//
// CONJUNCTS
//   a  the counts above, exactly
//   b  exactly one HAS_TERM_REFERENCE per property card, landing on the term card whose termIri is that card's
//      propertyUri; one hop backwards from the ex:name term card returns exactly its 3 property cards
//   c  no range in any property signature: each recomputes with an EMPTY range slot, and no property card carries a
//      singular rangeOptionSetId / rangeClassId / rangeDatatype; the range lists are present, id-sorted and parallel
//   d  the domain-less property has a term card AND exactly one skip row, reason zeroDeclaredDomains
//   e  deterministic: the same base with its nodes and edges REVERSED derives byte-identical output
//   f  every card passes cardFieldRefusal under the fixture hub's scope
//   g  CONTROL — the same base under a declaration WITHOUT the term tier mints no term card and no HAS_TERM_REFERENCE,
//      and its slotProfile carries no termAddressSignatureFieldOrder (the CEDS case, in miniature)
//   h  a base where two nodes share one IRI is REFUSED BY NAME (a term card is one per IRI)
//
// RED TWINS (each a changed COPY of the derived result, nothing re-derived): a conjunct whose twin is not observed red
// in this suite's output fails the suite.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- ctdlHub P3: the hub framework over a synthetic RDF-shaped hub (term tier, rangeAsMeaning)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hubFramework = require('../hub-framework');
const { HUB_CARD_FIELD_TABLE, cardFieldRefusal } = require('../hubCardFieldTable');
const { ADDRESS_SIGNATURE_FIELD_ORDER, HUB_TERM_REFERENCE_EDGE_TYPE, IN_HUB_EDGE_TYPE, hubEdgeType } = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'rdfShapedHub');
const FIXTURE_BASE = Object.freeze(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'rdfShapedBase.json'), 'utf8')));
const FIXTURE_DECLARATION = require(path.join(FIXTURE_DIR, 'rdfShapedHubDeclaration'));
const HUB_VERSION = '20260101';
const HUB_NAMESPACE = 'https://w3id.org/EDUcore/FIXTURE/hub/';

const EXPECTED_COUNT = Object.freeze({ termTier: 11, propertyTier: 6, valueTier: 6, termReferenceEdge: 6, nodeTotal: 24, edgeTotal: 80, skipRow: 1 });

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// derive the hub; a refusal comes back as { hubError } so a conjunct can go red instead of the suite dying
const deriveHub = ({ hubDeclaration, baseNodeEdges }) => {
	let outcome;
	hubFramework({ hubDeclaration, hooks: {}, forgeStandardSource: hubDeclaration.hubName })({ hubVersion: HUB_VERSION, hubNamespace: HUB_NAMESPACE })
		.forgeHub(baseNodeEdges, (hubError, hub) => {
			outcome = { hubError, hub };
		});
	return outcome;
};

const shipped = deriveHub({ hubDeclaration: FIXTURE_DECLARATION, baseNodeEdges: FIXTURE_BASE });
if (shipped.hubError) {
	harness.ok('the fixture hub derives', false, shipped.hubError);
	harness.report();
	return;
}

const cardsOfTier = (hub, referenceTier) => hub.nodes.filter((oneNode) => oneNode.properties.referenceTier === referenceTier);
const termReferenceEdgesOf = (hub) => hub.edges.filter((oneEdge) => oneEdge.type === HUB_TERM_REFERENCE_EDGE_TYPE);

const judgeByConjunct = {
	a_countsExactly: ({ hub }) => {
		const measured = {
			termTier: cardsOfTier(hub, 'term').length,
			propertyTier: cardsOfTier(hub, 'property').length,
			valueTier: cardsOfTier(hub, 'value').length,
			termReferenceEdge: termReferenceEdgesOf(hub).length,
			nodeTotal: hub.nodes.length,
			edgeTotal: hub.edges.length,
			skipRow: hub.skipReport.length,
		};
		const countsAgree = hub.counts.termTier === measured.termTier && hub.counts.propertyTier === measured.propertyTier && hub.counts.valueTier === measured.valueTier;
		return { pass: JSON.stringify(measured) === JSON.stringify(EXPECTED_COUNT) && countsAgree, detail: `measured ${JSON.stringify(measured)}; expected ${JSON.stringify(EXPECTED_COUNT)}; hub.counts agree: ${countsAgree}` };
	},
	b_oneTermReferencePerPropertyCard: ({ hub }) => {
		const nodeByStableId = hub.nodes.reduce((soFar, oneNode) => Object.assign(soFar, { [oneNode.stableId]: oneNode }), {});
		const termReferenceEdgeList = termReferenceEdgesOf(hub);
		const faultList = cardsOfTier(hub, 'property').map((propertyCard) => {
			const outgoingList = termReferenceEdgeList.filter((oneEdge) => oneEdge.fromRef.id === propertyCard.stableId);
			if (outgoingList.length !== 1) {
				return `${propertyCard.properties.propertyKey}@${propertyCard.properties.domainId} has ${outgoingList.length} HAS_TERM_REFERENCE edges`;
			}
			const termCard = nodeByStableId[outgoingList[0].toRef.id];
			return termCard && termCard.properties.referenceTier === 'term' && termCard.properties.termIri === propertyCard.properties.propertyUri
				? ''
				: `${propertyCard.properties.propertyKey}@${propertyCard.properties.domainId} lands on ${termCard ? termCard.properties.termIri : 'nothing'}`;
		}).filter((faultText) => faultText !== '');
		const nameTermCard = cardsOfTier(hub, 'term').find((oneCard) => oneCard.properties.termIri === 'ex:name');
		const oneHopDomainIdList = termReferenceEdgeList
			.filter((oneEdge) => nameTermCard && oneEdge.toRef.id === nameTermCard.stableId)
			.map((oneEdge) => nodeByStableId[oneEdge.fromRef.id].properties.domainId)
			.sort();
		const oneHopRight = JSON.stringify(oneHopDomainIdList) === JSON.stringify(['ex:Credential', 'ex:Organization', 'ex:Person']);
		return { pass: faultList.length === 0 && oneHopRight && termReferenceEdgeList.length === cardsOfTier(hub, 'property').length, detail: `faults [${faultList.join('; ')}]; one hop from ex:name term card -> [${oneHopDomainIdList.join(', ')}]` };
	},
	c_noRangeInAnyPropertySignature: ({ hub }) => {
		const faultList = cardsOfTier(hub, 'property').map((propertyCard) => {
			const cardProperties = propertyCard.properties;
			const signatureInputByField = {
				hubName: cardProperties.hubName,
				canonicalKey: cardProperties.canonicalKey,
				domainId: cardProperties.domainId,
				propertyKey: cardProperties.propertyKey,
				range: '',
				valueKey: '',
				qualifierKeys: cardProperties.qualifierKeys.slice().sort().join(','),
				hubVersion: cardProperties.hubVersion,
			};
			const recomputed = sha256Hex(ADDRESS_SIGNATURE_FIELD_ORDER.map((oneField) => signatureInputByField[oneField]).join('|'));
			const singularRangeName = ['rangeOptionSetId', 'rangeClassId', 'rangeDatatype'].find((fieldName) => cardProperties[fieldName] !== undefined);
			if (recomputed !== cardProperties.addressSignature || singularRangeName !== undefined) {
				return `${cardProperties.propertyKey}@${cardProperties.domainId}: signature recomputes with an empty range: ${recomputed === cardProperties.addressSignature}; singular range field: ${singularRangeName || 'none'}`;
			}
			return '';
		}).filter((faultText) => faultText !== '');
		const holderCard = cardsOfTier(hub, 'property').find((oneCard) => oneCard.properties.propertyKey === 'ex:holder');
		const statusCard = cardsOfTier(hub, 'property').find((oneCard) => oneCard.properties.propertyKey === 'ex:status');
		const listsRight = holderCard && statusCard
			&& JSON.stringify(holderCard.properties.rangeClassIdList) === JSON.stringify(['ex:Organization', 'ex:Person'])
			&& JSON.stringify(holderCard.properties.rangeClassNameList) === JSON.stringify(['Organization', 'Person'])
			&& JSON.stringify(statusCard.properties.rangeOptionSetIdList) === JSON.stringify(['ex:StatusScheme'])
			&& JSON.stringify(statusCard.properties.rangeDatatypeList) === JSON.stringify(['xsd:string'])
			&& statusCard.properties.rangeClassIdList === undefined;
		return { pass: faultList.length === 0 && Boolean(listsRight), detail: `faults [${faultList.join('; ')}]; range lists as expected: ${Boolean(listsRight)}` };
	},
	d_domainlessPropertyTermCardAndSkipRow: ({ hub }) => {
		const orphanTermCard = cardsOfTier(hub, 'term').find((oneCard) => oneCard.properties.termIri === 'ex:orphanProperty');
		const skipRowList = hub.skipReport.filter((oneRow) => oneRow.propertyKey === 'ex:orphanProperty');
		const pass = Boolean(orphanTermCard) && orphanTermCard.properties.termKind === 'property' && skipRowList.length === 1 && skipRowList[0].reason === 'zeroDeclaredDomains' && hub.skipReport.length === 1;
		return { pass, detail: `term card: ${orphanTermCard ? orphanTermCard.properties.termKind : 'ABSENT'}; skip rows ${JSON.stringify(hub.skipReport)}` };
	},
	e_deterministicUnderReorder: ({ hub, reorderedHub }) => {
		const shippedText = JSON.stringify({ nodes: hub.nodes, edges: hub.edges, skipReport: hub.skipReport });
		const reorderedText = JSON.stringify({ nodes: reorderedHub.nodes, edges: reorderedHub.edges, skipReport: reorderedHub.skipReport });
		return { pass: shippedText === reorderedText, detail: `sha256 ${sha256Hex(shippedText).slice(0, 16)} vs reordered ${sha256Hex(reorderedText).slice(0, 16)}` };
	},
	f_everyCardPassesTheFieldTable: ({ hub }) => {
		const faultList = hub.nodes
			.filter((oneNode) => oneNode.role === 'HubReference')
			.map((oneCard) => cardFieldRefusal({ fieldTable: HUB_CARD_FIELD_TABLE, referenceTier: oneCard.properties.referenceTier, cardPropertyNameList: Object.keys(oneCard.properties), tierList: FIXTURE_DECLARATION.tierList, rangeAddressing: FIXTURE_DECLARATION.rangeAddressing }))
			.filter((faultText) => faultText !== '');
		return { pass: faultList.length === 0, detail: faultList.slice(0, 3).join(' | ') || 'every card admitted' };
	},
};

const reorderedBase = { nodes: FIXTURE_BASE.nodes.slice().reverse(), edges: FIXTURE_BASE.edges.slice().reverse() };
const reordered = deriveHub({ hubDeclaration: FIXTURE_DECLARATION, baseNodeEdges: reorderedBase });
const shippedSubject = () => ({ hub: shipped.hub, reorderedHub: reordered.hub });

harness.section('BASELINE — the fixture hub passes every conjunct');
Object.keys(judgeByConjunct).forEach((conjunctRefId) => {
	const verdict = judgeByConjunct[conjunctRefId](shippedSubject());
	harness.ok(`${conjunctRefId} PASS`, verdict.pass, verdict.detail);
});

// twins: a changed COPY of the derived hub
const withHub = (hubChange) => () => ({ ...shippedSubject(), hub: hubChange(JSON.parse(JSON.stringify(shipped.hub))) });
const TWIN_LIST = [
	{ conjunctRefId: 'a_countsExactly', twinName: 'oneValueCardDropped', subject: withHub((hub) => ({ ...hub, nodes: hub.nodes.filter((oneNode, nodeIndex) => nodeIndex !== hub.nodes.findIndex((candidate) => candidate.properties.referenceTier === 'value')) })) },
	{ conjunctRefId: 'b_oneTermReferencePerPropertyCard', twinName: 'termReferenceRedirected', subject: withHub((hub) => {
		const holderTermCard = hub.nodes.find((oneNode) => oneNode.properties.termIri === 'ex:holder');
		const firstEdge = hub.edges.find((oneEdge) => oneEdge.type === HUB_TERM_REFERENCE_EDGE_TYPE);
		firstEdge.toRef.id = holderTermCard.stableId;
		return hub;
	}) },
	{ conjunctRefId: 'c_noRangeInAnyPropertySignature', twinName: 'rangeHashedIntoSignature', subject: withHub((hub) => {
		const statusCard = hub.nodes.find((oneNode) => oneNode.properties.referenceTier === 'property' && oneNode.properties.propertyKey === 'ex:status');
		statusCard.properties.rangeOptionSetId = 'ex:StatusScheme';
		return hub;
	}) },
	{ conjunctRefId: 'd_domainlessPropertyTermCardAndSkipRow', twinName: 'orphanTermCardDropped', subject: withHub((hub) => ({ ...hub, nodes: hub.nodes.filter((oneNode) => oneNode.properties.termIri !== 'ex:orphanProperty') })) },
	{ conjunctRefId: 'e_deterministicUnderReorder', twinName: 'reorderedOutputUnsorted', subject: () => ({ ...shippedSubject(), reorderedHub: { ...reordered.hub, nodes: reordered.hub.nodes.slice().reverse() } }) },
	{ conjunctRefId: 'f_everyCardPassesTheFieldTable', twinName: 'strayFieldOnATermCard', subject: withHub((hub) => {
		hub.nodes.find((oneNode) => oneNode.properties.referenceTier === 'term').properties.domainId = 'ex:Person';
		return hub;
	}) },
];

harness.section('THE TWIN SWEEP — each conjunct OBSERVED RED under a changed copy of the derived hub');
const reddenedConjunctList = [];
TWIN_LIST.forEach((oneTwin) => {
	const verdict = judgeByConjunct[oneTwin.conjunctRefId](oneTwin.subject());
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail.slice(0, 200)}`);
	if (!verdict.pass) reddenedConjunctList.push(oneTwin.conjunctRefId);
});
harness.equal('every conjunct has an observed twin', Object.keys(judgeByConjunct).filter((conjunctRefId) => reddenedConjunctList.indexOf(conjunctRefId) === -1).join(','), '');

harness.section('g — CONTROL: the same base WITHOUT the term tier (the CEDS case, in miniature)');
const withoutTermTier = deriveHub({
	hubDeclaration: { ...FIXTURE_DECLARATION, tierList: ['property', 'value'], embedTextTemplateByTier: (({ term, ...rest }) => rest)(FIXTURE_DECLARATION.embedTextTemplateByTier) },
	baseNodeEdges: FIXTURE_BASE,
});
harness.equal('g: derives', withoutTermTier.hubError, '');
harness.equal('g: no term card', cardsOfTier(withoutTermTier.hub, 'term').length, 0);
harness.equal('g: no HAS_TERM_REFERENCE edge', termReferenceEdgesOf(withoutTermTier.hub).length, 0);
harness.equal('g: no HAS_FIXTURE_TERM edge', withoutTermTier.hub.edges.filter((oneEdge) => oneEdge.type === hubEdgeType('FIXTURE', 'TERM')).length, 0);
harness.equal('g: the property and value tiers are unchanged by the term tier being off', `${cardsOfTier(withoutTermTier.hub, 'property').length}/${cardsOfTier(withoutTermTier.hub, 'value').length}`, `${EXPECTED_COUNT.propertyTier}/${EXPECTED_COUNT.valueTier}`);
const slotProfileOf = (hub) => JSON.parse(hub.nodes.find((oneNode) => oneNode.role === 'HubDefinition').properties.slotProfile);
harness.ok('g: its slotProfile carries no termAddressSignatureFieldOrder', slotProfileOf(withoutTermTier.hub).termAddressSignatureFieldOrder === undefined);
harness.ok('g: CONTROL — the term hub\'s slotProfile does carry it', Array.isArray(slotProfileOf(shipped.hub).termAddressSignatureFieldOrder));
harness.equal(
	'g: every property card of the term-less hub has the same stableId as in the term hub (the term tier adds cards and edges, it re-keys nothing)',
	cardsOfTier(withoutTermTier.hub, 'property').map((oneCard) => oneCard.stableId).join(','),
	cardsOfTier(shipped.hub, 'property').map((oneCard) => oneCard.stableId).join(','),
);
harness.equal('g: the IN_HUB count is one per card', withoutTermTier.hub.edges.filter((oneEdge) => oneEdge.type === IN_HUB_EDGE_TYPE).length, EXPECTED_COUNT.propertyTier + EXPECTED_COUNT.valueTier);

harness.section('h — a base where two nodes share one IRI is refused by name');
const sharedIriBase = JSON.parse(JSON.stringify(FIXTURE_BASE));
sharedIriBase.nodes.find((oneNode) => oneNode.stableId === 'ex:Expired').properties.uri = 'ex:Active';
const sharedIri = deriveHub({ hubDeclaration: FIXTURE_DECLARATION, baseNodeEdges: sharedIriBase });
harness.match('h: two base nodes carrying ex:Active are REFUSED BY NAME', sharedIri.hubError, /two base nodes carry the term IRI 'ex:Active'/);

harness.report();
