#!/usr/bin/env node
'use strict';

// test-openapiForgeKit.js — lib/openapi-forge on a SYNTHETIC OpenAPI document and a synthetic bundle (family Toy), so what is
// proven here is the kit's own contract, independent of any one standard (the ctdl-family-forge test's form): the profile seam,
// one fixture per construct the design names (direct $ref, items $ref, oneOf / anyOf / allOf branch $ref, items-level oneOf, a
// direct enum and an enum inside an anyOf branch, x- extensions, required), the round trip over the harness graph double with its
// twins observed RED, and one refusal per declared refusal, each on a perturbed COPY of the fixture. The bundles' end-to-end
// proofs (real snapshots, measured counts) live in forges/<bundle>/test/. Writes only under os.tmpdir(); no Docker, no network.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the OpenAPI kit (lib/openapi-forge): seam, constructs, round trip, refusals (no Docker)

SYNOPSIS
     node lib/openapi-forge/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges a synthetic OpenAPI 3 document through the framework with a synthetic bundle built on the kit, asserts how each
     construct is carried, round-trips it over the harness graph double (and observes the round trip RED on perturbed graphs),
     and forges perturbed copies to observe every walk, loader and profile refusal by name. Writes only under os.tmpdir().

EXIT STATUS
     0 every assertion passed;  1 otherwise.
`;

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const { DME_ROLES, STANDARD_KIND, STANDARD_FAMILY } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'forgeDeclarationContract'));
const forgeFramework = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'forge-framework'));
const roundTripHarness = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const { validateOpenapiProfile } = require(path.join(__dirname, '..', 'openapiProfileContract'));
const openapiIdentity = require(path.join(__dirname, '..', 'openapiIdentity'));
const openapiHooksFactory = require(path.join(__dirname, '..', 'openapiHooks'));
const openapiRoundTripPairFactory = require(path.join(__dirname, '..', 'openapiRoundTripPair'));

// -----------------------------------------------------------------
// the synthetic bundle
// -----------------------------------------------------------------
const SOURCE_FILE_NAME = 'synth_oas.json';
const syntheticProfile = Object.freeze({
	profileNote: 'A synthetic OpenAPI profile for the kit test.',
	sourceFileName: SOURCE_FILE_NAME,
	sourceFormat: 'json',
	stableIdPrefix: 'synthapi:',
	rootStableId: 'synthapi:root',
	perStandardLabelByRole: { [DME_ROLES.CLASS]: 'SynthApiSchema', [DME_ROLES.PROPERTY]: 'SynthApiProperty', [DME_ROLES.OPTION_SET]: 'SynthApiEnum', [DME_ROLES.OPTION_VALUE]: 'SynthApiEnumValue' },
	schemaExclusionList: ['Envelope'],
});
const STABLE_URI_PROPERTY_NAME = 'synthapiStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = [{}, {}, [], STABLE_URI_PROPERTY_NAME];
const syntheticDeclaration = Object.freeze({
	standardKey: 'synthapi',
	standardSource: 'SynthApi',
	standardDisplayName: 'Synthetic OpenAPI standard (kit test)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardUsageTips: null,
	descriptionSource: 'each schema and property OpenAPI description, verbatim',
	nativeIdentifierPropertyName: null,
	standardFamily: STANDARD_FAMILY.TOY,
	releaseLabel: 'SynthApi',
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: openapiIdentity.stableIdPatternFor(syntheticProfile),
	rootStableIdFrom: 'declared',
	rootStableId: syntheticProfile.rootStableId,
	rootLabel: 'SynthApiRoot',
	parserVersion: '1',
	mappingInstruction: MAPPING_INSTRUCTION_KEY_ORDER.reduce((instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }), {}),
	nonEmbeddableRoleList: [],
	embedTextDeclaration: null,
	additionalSourceInputList: [{ inputName: 'sourceLocation', relativePathFromSourcePath: 'standardSourceLocation' }],
	compatibilityDeclarationList: [],
});
const bundleFor = (openapiProfile) => forgeFramework({ embedder: null }).injectStandardHooks({ forgeDeclaration: syntheticDeclaration, hooks: openapiHooksFactory({ openapiProfile }) });
const bundle = bundleFor(syntheticProfile);
const roundTripPair = openapiRoundTripPairFactory({ openapiProfile: syntheticProfile, stableUriPropertyName: STABLE_URI_PROPERTY_NAME, ruleModulePath: 'lib/openapi-forge/openapiRoundTripPair.js' });
const validator = roundTripHarness.validatorFrom({ forgeDeclaration: syntheticDeclaration, ...roundTripPair, verdictVersion: 'openapiKitTestVerdict-1' });

// -----------------------------------------------------------------
// the fixture: one schema per construct the design names
// -----------------------------------------------------------------
const FIXTURE_DOCUMENT = Object.freeze({
	openapi: '3.0.1',
	info: { title: 'Synth', description: 'A synthetic data model', version: '9.9' },
	paths: { '/things': { get: { responses: { 200: { description: 'ok' } } } } },
	components: {
		schemas: {
			Thing: {
				type: 'object',
				description: 'A thing.',
				required: ['name', 'kind'],
				additionalProperties: false,
				'x-class-pid': 'org.synth.thing.class',
				properties: {
					name: { type: 'string', description: 'The name.', 'x-srcprop-pid': 'org.synth.primitive.string.class' },
					status: { type: 'string', description: 'A closed status.', enum: ['Open', 'Closed'] },
					kind: { description: 'An extensible kind.', anyOf: [{ type: 'string', enum: ['Alpha', 'Beta', 'ns:Gamma'] }, { type: 'string', pattern: '(ext:)[a-z]+' }] },
					owner: { $ref: '#/components/schemas/Party' },
					parts: { type: 'array', minItems: 0, description: 'Its parts.', items: { $ref: '#/components/schemas/Part' } },
					issuer: { description: 'A URI or a party.', oneOf: [{ type: 'string', description: 'A URI.' }, { $ref: '#/components/schemas/Party' }] },
					'@context': { type: 'array', minItems: 1, description: 'Contexts.', items: { description: 'A context.', oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/Part' }] } },
					both: { description: 'All of a part.', allOf: [{ $ref: '#/components/schemas/Part' }] },
					when: { type: 'string', format: 'date-time' },
				},
			},
			Party: { type: 'object', description: 'A party.', additionalProperties: true, properties: { id: { type: 'string', description: 'Its id.' } } },
			Part: { type: 'object', description: 'A part.', additionalProperties: true, properties: { label: { type: 'string' } } },
			Envelope: { type: 'object', description: 'API plumbing, excluded.', additionalProperties: true, properties: { code: { type: 'string', enum: ['ok'] } } },
		},
		securitySchemes: { oauth: { type: 'oauth2' } },
	},
});
const EXPECTED = Object.freeze({
	nodeCountByRole: { DmeStandardRoot: 1, DmeClass: 3, DmeProperty: 11, DmeOptionSet: 2, DmeOptionValue: 5 },
	edgeCountByType: { HAS_CLASS: 3, HAS_PROPERTY: 11, REFERENCES: 5, HAS_OPTION_SET: 2, HAS_VALUE: 5 },
	referenceList: [
		'synthapi:Thing/owner|$ref|/$ref|synthapi:Party',
		'synthapi:Thing/parts|items|/items/$ref|synthapi:Part',
		'synthapi:Thing/issuer|oneOf|/oneOf/1/$ref|synthapi:Party',
		'synthapi:Thing/@context|oneOf|/items/oneOf/1/$ref|synthapi:Part',
		'synthapi:Thing/both|allOf|/allOf/0/$ref|synthapi:Part',
	],
	// paths, info, openapi, securitySchemes.oauth; Envelope's seven leaves (declared, its property declared, type, description,
	// additionalProperties, the property's type, its one enum member)
	explicitlyOmittedByKind: { outOfScopeByDeclaration: 4, excludedSchema: 7 },
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const copyOf = (jsonValue) => JSON.parse(JSON.stringify(jsonValue));
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openapiForgeKitTest-'));

// snapshotOf — a snapshot directory (standardSourceData/01) holding the document, its location file and SHA256SUMS
const snapshotOf = ({ caseName, document }) => {
	const snapshotDirPath = path.join(scratchRootPath, caseName, 'standardSourceData', '01');
	fs.mkdirSync(snapshotDirPath, { recursive: true });
	fs.writeFileSync(path.join(snapshotDirPath, SOURCE_FILE_NAME), JSON.stringify(document, null, '\t'));
	fs.writeFileSync(path.join(snapshotDirPath, 'standardSourceLocation'), 'standard: synth\npublishedVersion: 9.9\nupstreamUrl: https://example.invalid/synth_oas.json\n');
	const checksumText = [SOURCE_FILE_NAME, 'standardSourceLocation'].map((oneName) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshotDirPath, oneName))).digest('hex')}  ${oneName}`).join('\n');
	fs.writeFileSync(path.join(snapshotDirPath, 'SHA256SUMS'), `${checksumText}\n`);
	return snapshotDirPath;
};
const FIXTURE_SNAPSHOT_PATH = snapshotOf({ caseName: 'fixture', document: FIXTURE_DOCUMENT });
const forgeDocument = ({ caseName, document }, callback) => bundle.forge({ sourcePath: path.join(snapshotOf({ caseName, document }), SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, callback);
const validateDouble = ({ forgeResult, caseName }, callback) => {
	const outputPath = path.join(scratchRootPath, `verdict-${caseName}`);
	fs.mkdirSync(outputPath, { recursive: true });
	validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: FIXTURE_SNAPSHOT_PATH, outputPath }, callback);
};

const taskList = new taskListPlus();

// -----------------------------------------------------------------
// SECTION 1 — the profile seam
// -----------------------------------------------------------------
taskList.push((args, next) => {
	harness.section('SECTION 1 — the profile is the seam: every field required, unknown refused, yaml refused by name');
	const refusalOf = (candidateProfile) => {
		try {
			validateOpenapiProfile(candidateProfile);
			return [];
		} catch (refusalError) {
			// test boundary: the contract's refusal IS a throw, read here as data
			return [refusalError.message];
		}
	};
	harness.accepts('the synthetic profile validates', refusalOf(syntheticProfile));
	harness.rejects('an unknown field is refused by name', refusalOf({ ...syntheticProfile, schemaExclusionLsit: [] }), /field 'schemaExclusionLsit' is not in the contract/);
	const { schemaExclusionList, ...withoutExclusion } = syntheticProfile;
	harness.rejects('an absent field is refused, never defaulted', refusalOf(withoutExclusion), /required field 'schemaExclusionList' is absent/);
	harness.rejects('sourceFormat yaml is refused BY NAME', refusalOf({ ...syntheticProfile, sourceFormat: 'yaml' }), /sourceFormat 'yaml' is not read by the K0 kit/);
	harness.rejects('an unknown sourceFormat is refused', refusalOf({ ...syntheticProfile, sourceFormat: 'xml' }), /field 'sourceFormat' is "xml", not a valid sourceFormat/);
	harness.rejects('a rootStableId outside the prefix is refused', refusalOf({ ...syntheticProfile, rootStableId: 'other:root' }), /does not begin with stableIdPrefix/);
	harness.rejects('a label table missing a role is refused', refusalOf({ ...syntheticProfile, perStandardLabelByRole: { DmeClass: 'A', DmeProperty: 'B', DmeOptionSet: 'C' } }), /perStandardLabelByRole/);
	next('', args);
});

// -----------------------------------------------------------------
// SECTION 2 — the fixture forged: one carriage per construct
// -----------------------------------------------------------------
taskList.push((args, next) => forgeDocument({ caseName: 'fixtureForge', document: FIXTURE_DOCUMENT }, (forgeError, forgeResult) => {
	harness.section('SECTION 2 — the fixture forged: every construct carried as designed');
	harness.accepts('the fixture forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	harness.equal('node count by role (Envelope excluded)', sortedText(countBy(forgeResult.nodes, (oneNode) => oneNode.role)), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('edge count by type', sortedText(countBy(forgeResult.edges, (oneEdge) => oneEdge.type)), sortedText(EXPECTED.edgeCountByType));
	const referenceTextList = forgeResult.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES')
		.map((oneEdge) => `${oneEdge.fromRef.id}|${oneEdge.properties.referenceConstruct}|${oneEdge.properties.locator}|${oneEdge.toRef.id}`);
	EXPECTED.referenceList.forEach((referenceText) => harness.ok(`REFERENCES ${referenceText}`, referenceTextList.indexOf(referenceText) !== -1, referenceTextList.join('\n')));
	const thing = nodeById['synthapi:Thing'].properties;
	harness.equal('schema description, dataType, additionalPropertiesAllowed, x-class-pid as xClassPid', `${thing.description}|${thing.dataType}|${thing.additionalPropertiesAllowed}|${thing.xClassPid}`, 'A thing.|object|false|org.synth.thing.class');
	const nameNode = nodeById['synthapi:Thing/name'].properties;
	harness.equal('property x-srcprop-pid carried verbatim as xSrcpropPid; isRequired true', `${nameNode.xSrcpropPid}|${nameNode.isRequired}`, 'org.synth.primitive.string.class|true');
	harness.equal('a property not in required carries isRequired false', nodeById['synthapi:Thing/when'].properties.isRequired, false);
	harness.equal('format carried as dataFormat', nodeById['synthapi:Thing/when'].properties.dataFormat, 'date-time');
	harness.equal('items scalars carried under items names; minItems an integer', `${nodeById['synthapi:Thing/@context'].properties.itemsDescription}|${nodeById['synthapi:Thing/@context'].properties.minItems}`, 'A context.|1');
	harness.equal('the direct enum: option set at /enum, two values', `${nodeById['synthapi:Thing/status/enum'].properties.enumLocator}|${Boolean(nodeById['synthapi:Thing/status/enum/Open'])}|${Boolean(nodeById['synthapi:Thing/status/enum/Closed'])}`, '/enum|true|true');
	harness.equal('the anyOf enum branch: option set at /anyOf/0/enum, a CURIE member admitted', `${nodeById['synthapi:Thing/kind/enum'].properties.enumLocator}|${Boolean(nodeById['synthapi:Thing/kind/enum/ns:Gamma'])}`, '/anyOf/0/enum|true');
	harness.equal('the anyOf branch scalars carried in compositionBranches (the pattern branch whole)', nodeById['synthapi:Thing/kind'].properties.compositionBranches,
		JSON.stringify([{ locator: '/anyOf/0', construct: 'anyOf', dataType: 'string' }, { locator: '/anyOf/1', construct: 'anyOf', dataType: 'string', valuePattern: '(ext:)[a-z]+' }]));
	harness.equal('a bare $ref property carries no description', nodeById['synthapi:Thing/owner'].properties.description, undefined);
	harness.equal('referencedSchemaNames: the referenced schema named as text (bare $ref, items, and a oneOf with one $ref branch)', ['owner', 'parts', 'issuer', 'name'].map((propertyName) => nodeById[`synthapi:Thing/${propertyName}`].properties.referencedSchemaNames).join('|'), 'Party|Part|Party|');
	harness.equal('stats: references by construct', sortedText(forgeResult.stats.referenceEdgeCountByConstruct), sortedText({ $ref: 1, items: 1, oneOf: 2, allOf: 1 }));
	harness.equal('stats: schemas, excluded, properties, required, enums, values, branches, vendor', ['schemaCount', 'excludedSchemaCount', 'propertyCount', 'requiredPropertyCount', 'enumCount', 'enumValueCount', 'compositionBranchCount', 'vendorExtensionCount'].map((statName) => forgeResult.stats[statName]).join(','), '3,1,11,2,2,5,7,2');
	harness.equal('the root states info.description', nodeById['synthapi:root'].properties.description, 'A synthetic data model');
	next('', { ...args, forgeResult });
}));

// -----------------------------------------------------------------
// SECTION 3 — the round trip over the graph double, and its twins RED
// -----------------------------------------------------------------
taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, caseName: 'clean' }, (validateError, verdict) => {
	harness.section('SECTION 3 — the round trip: clean on the forged graph');
	harness.accepts('the validator runs', validateError ? [validateError] : []);
	if (validateError) {
		next(validateError, args);
		return;
	}
	harness.equal('inventedTotal 0, lostTotal 0, roundTripClean', `${verdict.inventedTotal}|${verdict.lostTotal}|${verdict.roundTripClean}`, '0|0|true');
	harness.equal('explicitly omitted, by declared kind (paths, info, openapi, securitySchemes.oauth; Envelope)', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(EXPECTED.explicitlyOmittedByKind));
	next('', args);
}));
// a vectorised graph's reader returns each content node's 'embedding' (the harness double drops it, so it is put back by hand here):
// the vector is not a statement and must not count as invented
taskList.push((args, next) => {
	const outputPath = path.join(scratchRootPath, 'verdict-vectorised');
	fs.mkdirSync(outputPath, { recursive: true });
	const vectorisedReader = { readAll: (callback) => roundTripHarness.graphDoubleFrom({ forgeResult: args.forgeResult }).readAll((readError, graph) => callback(readError, readError ? graph : { ...graph, nodes: graph.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties, embedding: [0.25, -0.5] } })) })), close: (callback) => callback('') };
	validator.validateWithReader({ reader: vectorisedReader, snapshotPath: FIXTURE_SNAPSHOT_PATH, outputPath }, (validateError, verdict) => {
		harness.equal('a node vector (embedding) read back is not an invented statement', validateError ? `${validateError}` : `${verdict.inventedTotal}|${verdict.lostTotal}`, '0|0');
		next('', args);
	});
});

const ROUND_TRIP_TWIN_LIST = [
	// a dropped REFERENCES edge no longer agrees with the property's derived referencedSchemaNames, so the emitter refuses it by name
	{ twinName: 'oneOfReferenceEdgeDropped', expectation: 'fault', faultPattern: /synthapi:Thing\/issuer' carries referencedSchemaNames "Party" but its REFERENCES edges reach ""/, perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.properties.locator !== '/oneOf/1/$ref') }) },
	{ twinName: 'itemsReferenceLocatorMoved', expectation: 'both', perturb: (graph) => ({ ...graph, edges: graph.edges.map((oneEdge) => (oneEdge.properties.locator === '/items/$ref' ? { ...oneEdge, properties: { ...oneEdge.properties, locator: '/items/oneOf/0/$ref', referenceConstruct: 'oneOf' } } : oneEdge)) }) },
	{ twinName: 'propertyInvented', expectation: 'invented', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'synthapi:Thing/name' ? { ...oneNode, properties: { ...oneNode.properties, maxLength: 9 } } : oneNode)) }) },
	{ twinName: 'enumLocatorMoved', expectation: 'both', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'synthapi:Thing/kind/enum' ? { ...oneNode, properties: { ...oneNode.properties, enumLocator: '/enum' } } : oneNode)) }) },
	{ twinName: 'branchPatternDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'synthapi:Thing/kind' ? { ...oneNode, properties: { ...oneNode.properties, compositionBranches: JSON.stringify([{ locator: '/anyOf/0', construct: 'anyOf', dataType: 'string' }, { locator: '/anyOf/1', construct: 'anyOf', dataType: 'string' }]) } } : oneNode)) }) },
	{ twinName: 'requiredFlagFlipped', expectation: 'lost', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'synthapi:Thing/kind' ? { ...oneNode, properties: { ...oneNode.properties, isRequired: false } } : oneNode)) }) },
	{ twinName: 'referencedSchemaNamesDisagreesWithEdges', expectation: 'fault', faultPattern: /carries referencedSchemaNames "Part" but its REFERENCES edges reach "Party"/, perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'synthapi:Thing/owner' ? { ...oneNode, properties: { ...oneNode.properties, referencedSchemaNames: 'Part' } } : oneNode)) }) },
	{ twinName: 'vendorExtensionAltered', expectation: 'both', perturb: (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === 'synthapi:Thing' ? { ...oneNode, properties: { ...oneNode.properties, xClassPid: 'org.synth.other' } } : oneNode)) }) },
];
ROUND_TRIP_TWIN_LIST.forEach((oneTwin) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(copyOfForgeResult(args.forgeResult)), caseName: oneTwin.twinName }, (validateError, verdict) => {
	if (oneTwin === ROUND_TRIP_TWIN_LIST[0]) {
		harness.section('SECTION 3b — round-trip twins, each observed RED');
	}
	// a 'fault' twin is refused by the emitter (an emission fault is FATAL in the harness): red is the named refusal
	const isRed = oneTwin.expectation === 'fault' ? oneTwin.faultPattern.test(`${validateError}`) : !validateError && verdict.roundTripClean === false
		&& (oneTwin.expectation === 'invented' ? verdict.inventedTotal >= 1 : true)
		&& (oneTwin.expectation === 'lost' ? verdict.lostTotal >= 1 : true)
		&& (oneTwin.expectation === 'both' ? verdict.lostTotal >= 1 && verdict.inventedTotal >= 1 : true);
	harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → lost ${verdict && verdict.lostTotal}, invented ${verdict && verdict.inventedTotal}`, isRed, validateError);
	next('', args);
})));

// -----------------------------------------------------------------
// SECTION 4 — every declared refusal, by name, on a perturbed copy
// -----------------------------------------------------------------
const withThingProperty = (propertyName, shapeObject) => (document) => {
	document.components.schemas.Thing.properties[propertyName] = shapeObject;
	return document;
};
const REFUSAL_CASE_LIST = [
	{ caseName: 'nonLocalReference', perturb: withThingProperty('far', { $ref: 'https://example.invalid/other.json#/Party' }), refusalPattern: /'\/\$ref' is "https:\/\/example.invalid\/other.json#\/Party", not '#\/components\/schemas\/<name>'/ },
	{ caseName: 'danglingReference', perturb: withThingProperty('lost', { $ref: '#/components/schemas/Nowhere' }), refusalPattern: /names 'Nowhere', which is not in components.schemas/ },
	{ caseName: 'excludedReference', perturb: withThingProperty('envelope', { $ref: '#/components/schemas/Envelope' }), refusalPattern: /names 'Envelope', which is excluded by the profile/ },
	{ caseName: 'schemaLevelComposition', perturb: (document) => { document.components.schemas.Party.allOf = [{ $ref: '#/components/schemas/Part' }]; return document; }, refusalPattern: /keyword 'allOf' at the top \(position 'schema'\) is not carried/ },
	{ caseName: 'nestedComposition', perturb: withThingProperty('nested', { oneOf: [{ anyOf: [{ type: 'string' }] }] }), refusalPattern: /keyword 'anyOf' at '\/oneOf\/0' \(position 'branch'\) is not carried/ },
	{ caseName: 'undeclaredKeyword', perturb: withThingProperty('sized', { type: 'object', maxProperties: 3 }), refusalPattern: /keyword 'maxProperties' at the top \(position 'property'\) is not carried/ },
	{ caseName: 'inlineObject', perturb: withThingProperty('inline', { type: 'object', properties: { a: { type: 'string' } } }), refusalPattern: /keyword 'properties' at the top \(position 'property'\) is not carried/ },
	{ caseName: 'twoEnums', perturb: withThingProperty('twice', { enum: ['a'], items: { enum: ['b'] } }), refusalPattern: /states 2 enums \(\/enum, \/items\/enum\)/ },
	{ caseName: 'requiredNameWithoutProperty', perturb: (document) => { document.components.schemas.Thing.required.push('ghost'); return document; }, refusalPattern: /required names 'ghost', which its properties do not hold/ },
	{ caseName: 'emptyRequired', perturb: (document) => { document.components.schemas.Party.required = []; return document; }, refusalPattern: /Party.required is not a non-empty list of names/ },
	{ caseName: 'vendorExtensionNotString', perturb: (document) => { document.components.schemas.Party['x-class-pid'] = 7; return document; }, refusalPattern: /vendor extension 'x-class-pid' holds 7, not a string/ },
	{ caseName: 'vendorExtensionNotInvertible', perturb: (document) => { document.components.schemas.Party['x-ClassPid'] = 'a'; return document; }, refusalPattern: /vendor extension 'x-ClassPid' is not lower-case words joined by hyphens/ },
	{ caseName: 'schemaTypeNotObject', perturb: (document) => { document.components.schemas.Party.type = 'string'; return document; }, refusalPattern: /'\/type' is "string", not "object"/ },
	{ caseName: 'emptyBranch', perturb: withThingProperty('empty', { anyOf: [{}] }), refusalPattern: /'\/anyOf\/0' is an empty schema/ },
	{ caseName: 'enumMemberRepeated', perturb: withThingProperty('again', { enum: ['a', 'a'] }), refusalPattern: /'\/enum' lists 'a' twice/ },
	{ caseName: 'unknownExclusion', bundleProfile: { ...syntheticProfile, schemaExclusionList: ['Envelope', 'Phantom'] }, perturb: (document) => document, refusalPattern: /schemaExclusionList names 'Phantom'/ },
	{ caseName: 'noComponentsSchemas', perturb: (document) => { delete document.components.schemas; return document; }, refusalPattern: /has no components.schemas object/ },
	{ caseName: 'notOpenapiThree', perturb: (document) => { document.openapi = '2.0'; return document; }, refusalPattern: /states no OpenAPI 3 version/ },
];
REFUSAL_CASE_LIST.forEach((oneCase) => taskList.push((args, next) => {
	if (oneCase === REFUSAL_CASE_LIST[0]) {
		harness.section('SECTION 4 — each declared refusal observed by name');
	}
	const caseBundle = oneCase.bundleProfile === undefined ? bundle : bundleFor(oneCase.bundleProfile);
	caseBundle.forge({ sourcePath: path.join(snapshotOf({ caseName: oneCase.caseName, document: oneCase.perturb(copyOf(FIXTURE_DOCUMENT)) }), SOURCE_FILE_NAME), owner: 'test', skipEmbedding: true }, (forgeError) => {
		harness.rejects(`REFUSED: ${oneCase.caseName}`, forgeError ? [forgeError] : [], oneCase.refusalPattern);
		next('', args);
	});
}));

// -----------------------------------------------------------------
// SECTION 5 — determinism: the fixture forged twice is byte-identical
// -----------------------------------------------------------------
taskList.push((args, next) => forgeDocument({ caseName: 'fixtureAgain', document: FIXTURE_DOCUMENT }, (forgeError, forgeResult) => {
	harness.section('SECTION 5 — determinism');
	const textOf = (result) => JSON.stringify({ nodes: result.nodes.map((oneNode) => [oneNode.stableId, oneNode.labels, oneNode.properties]), edges: result.edges });
	harness.ok('a second forge is identical', !forgeError && textOf(forgeResult) === textOf(args.forgeResult), forgeError);
	next('', args);
}));

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	fs.rmSync(scratchRootPath, { recursive: true, force: true });
	harness.report();
});
