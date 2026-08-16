'use strict';

// toyGraph.js — the toy dependency graph the Bridge Framework's gate suite runs over (SPEC-bridgeFramework-
// v1.md §13 "the suite runs hermetically"): a tiny HUB DOUBLE (property-tier cards with real tuple fields, two
// contended keys, one qualified card whose qualifierKeys arrives as a SCALAR string, one value-tier card) and a
// tiny forged TOY STANDARD (property nodes carrying the blinded anchor triple, one option-value node). Handed to
// graphDouble.graphDoubleFrom({ nodeList, edgeList }). DATA — every gate reads it fresh (cloneJson inside the double).
//
// hub    ToyHub @ 1.0 (recipe token 'toyhub')      source  Toy @ 1.2.3 (recipe token 'toy', _source 'Toy')

const HUB_NAME = 'ToyHub';
const HUB_VERSION = '1.0';
const SOURCE_STANDARD_NAME = 'Toy';
const SOURCE_VERSION = '1.2.3';
const EMBEDDING = Object.freeze([0.1, 0.2, 0.3, 0.4]);

const card = ({ canonicalKey, domainId, qualifierKeys, name, referenceTier, propertyNotation, rangeDatatype }) => ({
	stableId: `toyhub:card/${canonicalKey}${domainId ? `.${domainId}` : ''}${qualifierKeys ? `.${Array.isArray(qualifierKeys) ? qualifierKeys.join('+') : qualifierKeys}` : ''}`,
	labels: ['HubReference'],
	properties: {
		stableId: `toyhub:card/${canonicalKey}${domainId ? `.${domainId}` : ''}${qualifierKeys ? `.${Array.isArray(qualifierKeys) ? qualifierKeys.join('+') : qualifierKeys}` : ''}`,
		uri: `urn:toyhub:${canonicalKey}${domainId ? `#${domainId}` : ''}${qualifierKeys ? `?q=${Array.isArray(qualifierKeys) ? qualifierKeys.join('+') : qualifierKeys}` : ''}`,
		name,
		canonicalKey,
		domainId: domainId === undefined ? '' : domainId,
		propertyKey: canonicalKey,
		valueKey: '',
		// the golden stores a one-element PG-JSON list as a SCALAR (replay-engine pgToStored) — the toy mirrors that
		qualifierKeys: qualifierKeys === undefined ? '' : qualifierKeys,
		referenceTier: referenceTier === undefined ? 'property' : referenceTier,
		hubName: HUB_NAME,
		hubVersion: HUB_VERSION,
		addressSignature: `${HUB_NAME}|${canonicalKey}|${domainId === undefined ? '' : domainId}|${canonicalKey}||${qualifierKeys === undefined ? '' : qualifierKeys}|${HUB_VERSION}`,
		domainName: domainId === undefined ? '' : `Domain ${domainId}`,
		domainDefinition: domainId === undefined ? '' : `The ${domainId} domain of the toy hub.`,
		propertyDefinition: `${name} — a toy hub property.`,
		propertyNotation: propertyNotation === undefined ? name.replace(/\s+/g, '') : propertyNotation,
		rangeDatatype: rangeDatatype === undefined ? 'xsd:string' : rangeDatatype,
		_source: HUB_NAME,
		embedding: EMBEDDING.slice(),
	},
});

const HUB_CARD_LIST = Object.freeze([
	card({ canonicalKey: 'P000001', domainId: 'C1', name: 'First Name' }),
	card({ canonicalKey: 'P000002', domainId: 'C1', name: 'Birth Date' }),
	card({ canonicalKey: 'P000002', domainId: 'C2', name: 'Birth Date (staff)' }),
	card({ canonicalKey: 'P000003', domainId: 'C1', name: 'Ethnicity' }),
	card({ canonicalKey: 'P000005', domainId: 'C1', name: 'Organization Name' }),
	card({ canonicalKey: 'P000005', domainId: 'C1', qualifierKeys: 'OV0001', name: 'Organization Name (school)' }),
	card({ canonicalKey: 'P000006', domainId: 'C1', name: 'Course Title' }),
	card({ canonicalKey: 'P000008', domainId: 'C3', name: 'Address' }),
	card({ canonicalKey: 'P000010', domainId: 'C1', name: 'Course Credits' }),
	card({ canonicalKey: 'OV000001', domainId: 'C1', name: 'Female', referenceTier: 'value' }),
]);

const propertyNode = ({ entity, element, description, hubAnchorId, crossRefs }) => ({
	stableId: `toy:property/${entity}.${element}`,
	labels: ['DmeProperty', 'ToyProperty'],
	properties: {
		stableId: `toy:property/${entity}.${element}`,
		name: element,
		description,
		role: 'property',
		owningConstructName: entity,
		_source: SOURCE_STANDARD_NAME,
		// the blinded triple every property node of the two v1 forges carries (BR-090)
		hubAnchorId: hubAnchorId === undefined ? '' : hubAnchorId,
		crossRefs: JSON.stringify(hubAnchorId === undefined ? [] : [{ hub: HUB_NAME, id: hubAnchorId }]),
		hubAnchorOriginalPropertyName: hubAnchorId === undefined ? '' : 'Hub Global Id',
		embedding: EMBEDDING.slice(),
	},
});

const SOURCE_NODE_LIST = Object.freeze([
	{ stableId: 'toy:construct/Student', labels: ['DmeConstruct'], properties: { stableId: 'toy:construct/Student', name: 'Student', role: 'domainEntity', _source: SOURCE_STANDARD_NAME, embedding: EMBEDDING.slice() } },
	{ stableId: 'toy:construct/School', labels: ['DmeConstruct'], properties: { stableId: 'toy:construct/School', name: 'School', role: 'domainEntity', _source: SOURCE_STANDARD_NAME, embedding: EMBEDDING.slice() } },
	{ stableId: 'toy:construct/Course', labels: ['DmeConstruct'], properties: { stableId: 'toy:construct/Course', name: 'Course', role: 'domainEntity', _source: SOURCE_STANDARD_NAME, embedding: EMBEDDING.slice() } },
	propertyNode({ entity: 'Student', element: 'FirstName', description: 'The given name of the student.', hubAnchorId: 'P000006' }), // the standard's OWN anchor disagrees with the crosswalk (P000001) → the conflict fixture
	propertyNode({ entity: 'Student', element: 'BirthDate', description: 'The birth date of the student.', hubAnchorId: 'P000002' }),
	propertyNode({ entity: 'Student', element: 'Gender', description: 'The gender of the student.' }),
	propertyNode({ entity: 'Student', element: 'Ethnicity', description: 'The ethnicity of the student.' }),
	propertyNode({ entity: 'Student', element: 'Missing', description: 'An element the hub does not carry.' }),
	propertyNode({ entity: 'Student', element: 'Extra', description: 'An extra element.' }),
	propertyNode({ entity: 'Student', element: 'BadUri', description: 'A row whose property URI disagrees.' }),
	propertyNode({ entity: 'Student', element: 'Weight', description: 'The weight of the student.' }),
	propertyNode({ entity: 'School', element: 'Code', description: 'The code of the school.' }),
	propertyNode({ entity: 'School', element: 'Ghost', description: 'Remodelled to an absent target.' }),
	propertyNode({ entity: 'Student', element: 'Nothing', description: 'Nothing here.' }),
	propertyNode({ entity: 'Student', element: 'Nothing2', description: 'Nothing here either.' }),
	propertyNode({ entity: 'School', element: 'Name', description: 'The name of the school.', hubAnchorId: 'P000005' }),
	propertyNode({ entity: 'School', element: 'Address', description: 'The address of the school.' }),
	propertyNode({ entity: 'Course', element: 'Title', description: 'The title of the course.', hubAnchorId: 'P000006' }),
	propertyNode({ entity: 'Course', element: 'Credits', description: 'Credits for the course.', hubAnchorId: 'P000010' }),
	propertyNode({ entity: 'Course', element: 'Level', description: 'The level of the course.' }),
	{ stableId: 'toy:optionValue/Student.Gender.F', labels: ['DmeOptionValue'], properties: { stableId: 'toy:optionValue/Student.Gender.F', name: 'F', role: 'optionValue', _source: SOURCE_STANDARD_NAME, hubOptionCode: 'OV000001', hubOptionOriginalPropertyName: 'Hub Option Id', embedding: EMBEDDING.slice() } },
]);

const SOURCE_EDGE_LIST = Object.freeze([
	{ fromStableId: 'toy:construct/Student', toStableId: 'toy:property/Student.FirstName', type: 'HAS_PROPERTY', properties: { provenanceTier: 'structural' } },
	{ fromStableId: 'toy:construct/Student', toStableId: 'toy:property/Student.BirthDate', type: 'HAS_PROPERTY', properties: { provenanceTier: 'structural' } },
	{ fromStableId: 'toy:construct/Course', toStableId: 'toy:property/Course.Credits', type: 'HAS_PROPERTY', properties: { provenanceTier: 'structural' } },
	{ fromStableId: 'toy:construct/Course', toStableId: 'toy:construct/School', type: 'REFERENCES', properties: { provenanceTier: 'structural' } },
]);

const toyGraph = () => ({ nodeList: HUB_CARD_LIST.concat(SOURCE_NODE_LIST).map((oneNode) => JSON.parse(JSON.stringify(oneNode))), edgeList: SOURCE_EDGE_LIST.map((oneEdge) => JSON.parse(JSON.stringify(oneEdge))) });

module.exports = { toyGraph, HUB_CARD_LIST, SOURCE_NODE_LIST, SOURCE_EDGE_LIST, HUB_NAME, HUB_VERSION, SOURCE_STANDARD_NAME, SOURCE_VERSION, EMBEDDING };
