#!/usr/bin/env node
'use strict';

// test-openapiDereferencedKit.js — the OpenAPI kit's dereferencedMultiFile layout (nextStandards-102326 K1) on SYNTHETIC documents shaped
// like lane B's measured JEDx constructs and LIF's single-file inline model (the real bytes are HR Open Work excerpts and are not committed;
// SILVER_SPIRE's real cuts live in dataStores/nextStandards_102326/laneA/k1fixtures/fromLaneB and are run by the lane, not here). One fixture
// per construct the K1 design names: a reference recovered by CONTENT (not title) with the site's description kept, an items copy, a content
// tie broken by name = title, a code-list component with enumNames and a member that needs encoding, a datatype component, a schema-level
// allOf supplying a required name, an anonymous inline object nested two deep, an anonymous enum-only site, definitions, the keyword rows,
// two files sharing a component, and a LIF-shaped single file of nested inline objects with no components to recover. The round trip over
// the harness graph double, its twins observed RED, and one refusal per declared refusal. Writes only under os.tmpdir(); no Docker.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the OpenAPI kit's dereferenced layout: constructs, round trip, refusals (no Docker)

SYNOPSIS
     node lib/openapi-forge/test/${moduleName}.js [-verbose] [-help]

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
const openapiLayout = require(path.join(__dirname, '..', 'openapiLayout'));

// -----------------------------------------------------------------
// the synthetic bundle (family Toy)
// -----------------------------------------------------------------
const STABLE_URI_PROPERTY_NAME = 'synthkStableId';
const profileFor = (sourceFileNameList) => Object.freeze({
	profileNote: 'A synthetic dereferenced OpenAPI profile for the K1 kit test.',
	sourceLayout: 'dereferencedMultiFile',
	sourceFileNameList,
	sourceFormat: 'json',
	stableIdPrefix: 'synthk:',
	rootStableId: 'synthk:root',
	perStandardLabelByRole: { [DME_ROLES.CLASS]: 'SynthKSchema', [DME_ROLES.PROPERTY]: 'SynthKProperty', [DME_ROLES.OPTION_SET]: 'SynthKEnum', [DME_ROLES.OPTION_VALUE]: 'SynthKEnumValue' },
	schemaExclusionList: [],
});
const declarationFor = (openapiProfile) => Object.freeze({
	standardKey: 'synthk',
	standardSource: 'SynthK',
	standardDisplayName: 'Synthetic dereferenced OpenAPI standard (K1 kit test)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardUsageTips: null,
	descriptionSource: 'each schema and property OpenAPI description, verbatim',
	nativeIdentifierPropertyName: null,
	standardFamily: STANDARD_FAMILY.TOY,
	releaseLabel: 'SynthK',
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: openapiIdentity.stableIdPatternFor(openapiProfile),
	rootStableIdFrom: 'declared',
	rootStableId: openapiProfile.rootStableId,
	rootLabel: 'SynthKRoot',
	parserVersion: '1',
	mappingInstruction: MAPPING_INSTRUCTION_KEY_ORDER.reduce((instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: [{}, {}, [], STABLE_URI_PROPERTY_NAME][propertyIndex] }), {}),
	nonEmbeddableRoleList: [],
	embedTextDeclaration: null,
	additionalSourceInputList: [{ inputName: 'sourceLocation', relativePathFromSourcePath: 'standardSourceLocation' }],
	compatibilityDeclarationList: [],
});

// -----------------------------------------------------------------
// the fixtures: JEDx-shaped constructs (every copy inline, with $schema / version / title as the bundles write them)
// -----------------------------------------------------------------
const HEADER = Object.freeze({ $schema: 'http://json-schema.org/draft-04/schema#', version: '4.3.0' });
const DATE_TIME = Object.freeze({ ...HEADER, title: 'DateTimeType', description: 'A date and time.', type: 'string', format: 'date-time' });
const CURRENCY_CODE_LIST = Object.freeze({ ...HEADER, title: 'CurrencyCodeList', description: 'Currencies.', type: 'string', enum: ['USD', 'EUR', 'Euro Zone/Other'], enumNames: ['US dollar', 'Euro', 'Other euro'], links: [{ rel: 'describedby', href: 'https://example.invalid/iso4217' }] });
const AMOUNT = Object.freeze({ ...HEADER, title: 'AmountType', description: 'An amount.', type: 'object', properties: { value: { type: 'number', description: 'The figure.' }, currency: { ...CURRENCY_CODE_LIST, description: 'The currency of the amount.' } }, required: ['value'] });
const OPEN_PERIOD = Object.freeze({ ...HEADER, title: 'OpenPeriodType', description: 'A period, end optional.', type: 'object', properties: { start: { ...DATE_TIME }, end: { ...DATE_TIME, description: 'When it ends.' } } });
const CONFIRM = Object.freeze({ ...HEADER, title: 'ConfirmMessageType', description: 'A confirmation.', type: 'object', properties: { code: { type: 'string', description: 'The code.' } } });
const DERIVED_DOCUMENT = Object.freeze({
	openapi: '3.1.0',
	info: { title: 'SynthK', description: 'A synthetic dereferenced data model', version: '1.0.0' },
	paths: { '/messages': { get: { responses: { 200: { description: 'ok' } } } } },
	tags: [{ name: 'messages' }],
	components: {
		schemas: {
			DateTimeType: DATE_TIME,
			CurrencyCodeList: CURRENCY_CODE_LIST,
			AmountType: AMOUNT,
			OpenPeriodType: OPEN_PERIOD,
			PeriodType: { ...HEADER, title: 'PeriodType', description: 'A period, end required.', type: 'object', allOf: [{ ...OPEN_PERIOD }], required: ['end'] },
			confirmMessageType: CONFIRM,
			ConfirmMessageType: CONFIRM,
			PositiveCountType: { ...HEADER, title: 'PositiveCountType', description: 'A count.', type: 'integer', minimum: 0, exclusiveMinimum: true, hropenFormat: 'count' },
			MessageType: {
				...HEADER,
				title: 'MessageType',
				description: 'A message.',
				type: 'object',
				minProperties: 1,
				properties: {
					confirm: { ...CONFIRM, description: 'The confirmation this message carries.' },
					amounts: { type: 'array', description: 'Its amounts.', minItems: 1, items: { ...AMOUNT, description: 'One amount.' } },
					policy: { type: 'object', description: 'An untitled policy.', properties: { rules: { type: 'object', description: 'Its rules.', properties: { code: { type: 'string', description: 'A rule code.' } } } } },
					kind: { type: 'string', description: 'An untitled kind.', enum: ['a', 'b'], enumNames: ['Alpha', 'Beta'] },
					when: { ...DATE_TIME, description: 'When it was sent (the site overrides the type text).' },
					count: { type: 'integer', minimum: 1, maximum: 9 },
				},
				required: ['confirm', 'when'],
				definitions: { Local: { ...AMOUNT }, Other: { type: 'object', description: 'An untitled definition.', properties: { note: { type: 'string' } } } },
			},
		},
		responses: { NotFound: { description: 'not found' } },
	},
});
// LIF's shape: ONE file, nested inline objects, no copies to recover and few titles
const LIF_SHAPED_DOCUMENT = Object.freeze({
	openapi: '3.0.0',
	info: { title: 'LifShaped', version: '1.0' },
	paths: {},
	components: {
		schemas: {
			Person: { type: 'object', description: 'A learner.', properties: { name: { type: 'object', properties: { given: { type: 'string' }, family: { type: 'string' }, parts: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, deep: { type: 'object', properties: { leaf: { type: 'boolean' } } } } } } } }, identifier: { type: 'string' } } },
			Organization: { type: 'object', properties: { name: { type: 'string', description: 'Its name.' } } },
		},
	},
});
const TWO_FILE_A = Object.freeze({ openapi: '3.1.0', info: { version: '1.0.0' }, paths: {}, components: { schemas: { CurrencyCodeList: CURRENCY_CODE_LIST, AmountType: AMOUNT, ReportA: { ...HEADER, title: 'ReportA', type: 'object', properties: { total: { ...AMOUNT } } } } } });
const TWO_FILE_B = Object.freeze({ openapi: '3.1.0', info: { version: '1.0.0' }, paths: {}, components: { schemas: { CurrencyCodeList: CURRENCY_CODE_LIST, AmountType: AMOUNT, ReportB: { ...HEADER, title: 'ReportB', type: 'object', properties: { owed: { ...AMOUNT, description: 'What is owed.' } } } } } });

const copyOf = (jsonValue) => JSON.parse(JSON.stringify(jsonValue));
const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openapiDereferencedKitTest-'));

// snapshotOf — a snapshot directory holding the documents, the location file and SHA256SUMS
const snapshotOf = ({ caseName, documentByFileName }) => {
	const snapshotDirPath = path.join(scratchRootPath, caseName, 'standardSourceData', '01');
	fs.mkdirSync(snapshotDirPath, { recursive: true });
	Object.keys(documentByFileName).forEach((fileName) => fs.writeFileSync(path.join(snapshotDirPath, fileName), JSON.stringify(documentByFileName[fileName], null, '\t')));
	fs.writeFileSync(path.join(snapshotDirPath, 'standardSourceLocation'), 'standard: synthk\npublishedVersion: 1.0.0\nupstreamUrl: https://example.invalid/synthk\n');
	fs.writeFileSync(path.join(snapshotDirPath, 'SHA256SUMS'), `${Object.keys(documentByFileName).concat(['standardSourceLocation']).map((oneName) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshotDirPath, oneName))).digest('hex')}  ${oneName}`).join('\n')}\n`);
	return snapshotDirPath;
};
// forgeCase — forge documents through a bundle over their own profile; callback(err, { forgeResult, snapshotPath, validator })
const forgeCase = ({ caseName, documentByFileName, profileChange }, callback) => {
	const openapiProfile = { ...profileFor(Object.keys(documentByFileName)), ...(profileChange || {}) };
	const forgeDeclaration = declarationFor(openapiProfile);
	const snapshotPath = snapshotOf({ caseName, documentByFileName });
	const bundle = forgeFramework({ embedder: null }).injectStandardHooks({ forgeDeclaration, hooks: openapiHooksFactory({ openapiProfile }) });
	bundle.forge({ sourcePath: snapshotPath, owner: 'test', skipEmbedding: true }, (forgeError, forgeResult) => {
		if (forgeError) {
			callback(forgeError);
			return;
		}
		const roundTripPair = openapiLayout.roundTripPairFor({ openapiProfile, stableUriPropertyName: STABLE_URI_PROPERTY_NAME, ruleModulePath: 'lib/openapi-forge/openapiDereferencedRoundTripPair.js' });
		callback('', { forgeResult, snapshotPath, validator: roundTripHarness.validatorFrom({ forgeDeclaration, ...roundTripPair, verdictVersion: 'openapiDereferencedKitTestVerdict-1' }) });
	});
};
const validateDouble = ({ forged, forgeResult, caseName }, callback) => {
	const outputPath = path.join(scratchRootPath, `verdict-${caseName}`);
	fs.mkdirSync(outputPath, { recursive: true });
	forged.validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: forged.snapshotPath, outputPath }, callback);
};

const taskList = new taskListPlus();

// -----------------------------------------------------------------
// SECTION 1 — the layout is part of the seam
// -----------------------------------------------------------------
taskList.push((args, next) => {
	harness.section('SECTION 1 — sourceLayout: required, closed, and it decides which file fields belong');
	const refusalOf = (candidateProfile) => {
		try {
			validateOpenapiProfile(candidateProfile);
			return [];
		} catch (refusalError) {
			return [refusalError.message]; // test boundary: the contract's refusal IS a throw
		}
	};
	const dereferencedProfile = profileFor(['a.json', 'b.json']);
	harness.accepts('a dereferencedMultiFile profile with sourceFileNameList validates', refusalOf(dereferencedProfile));
	const { sourceLayout, ...withoutLayout } = dereferencedProfile;
	harness.rejects('an absent sourceLayout is refused, never defaulted', refusalOf(withoutLayout), /required field 'sourceLayout' is undefined/);
	harness.rejects('an unknown sourceLayout is refused', refusalOf({ ...dereferencedProfile, sourceLayout: 'scattered' }), /'sourceLayout' is "scattered", not one of referencedSingleFile, dereferencedMultiFile/);
	harness.rejects('sourceFileName is refused under dereferencedMultiFile', refusalOf({ ...dereferencedProfile, sourceFileName: 'a.json' }), /field 'sourceFileName' does not belong to sourceLayout 'dereferencedMultiFile'/);
	harness.rejects('a repeated file is refused', refusalOf({ ...dereferencedProfile, sourceFileNameList: ['a.json', 'a.json'] }), /field 'sourceFileNameList' is \["a.json","a.json"\], not a valid distinctNonEmptyStringList/);
	harness.rejects('sourceFileNameList is refused under referencedSingleFile', refusalOf({ ...dereferencedProfile, sourceLayout: 'referencedSingleFile' }), /field 'sourceFileNameList' does not belong to sourceLayout 'referencedSingleFile'/);
	next('', args);
});

// -----------------------------------------------------------------
// SECTION 2 — the JEDx-shaped fixture: every construct carried as ruled
// -----------------------------------------------------------------
taskList.push((args, next) => forgeCase({ caseName: 'derived', documentByFileName: { 'synth_bundle.json': DERIVED_DOCUMENT } }, (forgeError, forged) => {
	harness.section('SECTION 2 — the JEDx-shaped fixture: references by content, code lists, datatypes, inline classes, keywords');
	harness.accepts('the fixture forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	const { forgeResult } = forged;
	const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	const referenceTextList = forgeResult.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES').map((oneEdge) => `${oneEdge.fromRef.id}|${oneEdge.properties.referenceConstruct}|${oneEdge.properties.locator}|${oneEdge.toRef.id}`);
	const expectReference = (referenceText, label) => harness.ok(label, referenceTextList.indexOf(referenceText) !== -1, referenceTextList.join('\n'));
	expectReference('synthk:AmountType/currency|inline||synthk:codeList/CurrencyCodeList', 'a code-list copy at a property is a reference to the root-owned code list');
	expectReference('synthk:MessageType/when|inline||synthk:DateTimeType', 'a datatype copy is a reference to its class (by content: the site\'s description differs)');
	expectReference('synthk:MessageType/amounts|inlineItems|/items|synthk:AmountType', 'an items copy is a reference (construct inlineItems)');
	expectReference('synthk:MessageType/confirm|inline||synthk:ConfirmMessageType', 'a content tie (confirmMessageType = ConfirmMessageType) is broken by name = title');
	expectReference('synthk:PeriodType|allOf|/allOf/0|synthk:OpenPeriodType', 'a schema-level allOf branch copy is a class-to-class reference');
	expectReference('synthk:MessageType|definitions|/definitions/Local|synthk:AmountType', 'a definitions entry copy is a reference');
	expectReference('synthk:MessageType/policy|inlineObject||synthk:MessageType/policy/inline', 'an untitled inline object is a class at its site');
	expectReference('synthk:MessageType/policy/inline/rules|inlineObject||synthk:MessageType/policy/inline/rules/inline', 'a nested inline object recurses (two deep)');
	expectReference('synthk:MessageType|definitions|/definitions/Other|synthk:MessageType/definitions/Other', 'an untitled definition is a class');
	harness.equal('the site keeps its own description; the body is the component\'s', `${nodeById['synthk:MessageType/when'].properties.description}|${nodeById['synthk:MessageType/when'].properties.dataType}|${nodeById['synthk:DateTimeType'].properties.description}`, 'When it was sent (the site overrides the type text).|undefined|A date and time.');
	harness.equal('the code list: a root-owned option set, encoded member id, enumName aligned, links as JSON', `${nodeById['synthk:codeList/CurrencyCodeList'].properties.enumLocator}|${nodeById['synthk:codeList/CurrencyCodeList/Euro%20Zone%2FOther'].properties.name}|${nodeById['synthk:codeList/CurrencyCodeList/Euro%20Zone%2FOther'].properties.enumName}|${nodeById['synthk:codeList/CurrencyCodeList'].properties.linkDescriptions}`, '/enum|Euro Zone/Other|Other euro|[{"rel":"describedby","href":"https://example.invalid/iso4217"}]');
	harness.equal('a datatype component is a class with its scalars (integer, minimum, exclusiveMinimum as written, hropenFormat)', ['dataType', 'minimum', 'exclusiveMinimum', 'hropenFormat'].map((oneName) => JSON.stringify(nodeById['synthk:PositiveCountType'].properties[oneName])).join('|'), '"integer"|0|true|"count"');
	harness.equal('a required name a composition supplies is carried on the class', nodeById['synthk:PeriodType'].properties.requiredNamesFromComposition, '["end"]');
	harness.equal('an anonymous enum-only site is the property\'s own option set, enumNames per value', `${nodeById['synthk:MessageType/kind/enum'].properties.enumLocator}|${nodeById['synthk:MessageType/kind/enum/b'].properties.enumName}`, '/enum|Beta');
	harness.equal('an untitled inline class is named for where it sits; its description stays with the property', `${nodeById['synthk:MessageType/policy/inline'].properties.name}|${nodeById['synthk:MessageType/policy/inline'].properties.description}|${nodeById['synthk:MessageType/policy'].properties.description}`, 'MessageType.policy.inline|undefined|An untitled policy.');
	harness.equal('an items copy keeps its own description as itemsDescription; referencedSchemaNames names the target', `${nodeById['synthk:MessageType/amounts'].properties.itemsDescription}|${nodeById['synthk:MessageType/amounts'].properties.referencedSchemaNames}`, 'One amount.|AmountType');
	harness.equal('stats: references by construct', sortedText(forgeResult.stats.referenceRecoveredCountByConstruct), sortedText({ inline: 5, inlineItems: 1, allOf: 1, definitions: 1 }));
	harness.equal('stats: components, classes, code lists, ties, inline classes (anonymous), local enums', ['componentCount', 'classComponentCount', 'codeListCount', 'referenceRecoveredByTieCount', 'inlineClassCount', 'inlineClassAnonymousCount', 'localEnumCount'].map((statName) => forgeResult.stats[statName]).join(','), '9,8,1,1,3,3,1');
	next('', { ...args, derived: forged });
}));

// -----------------------------------------------------------------
// SECTION 3 — the round trip, and its twins RED
// -----------------------------------------------------------------
taskList.push((args, next) => validateDouble({ forged: args.derived, forgeResult: args.derived.forgeResult, caseName: 'clean' }, (validateError, verdict) => {
	harness.section('SECTION 3 — the round trip of the compressed form: clean');
	harness.accepts('the validator runs', validateError ? [validateError] : []);
	harness.equal('inventedTotal 0, lostTotal 0, roundTripClean', verdict && `${verdict.inventedTotal}|${verdict.lostTotal}|${verdict.roundTripClean}`, '0|0|true');
	harness.equal('omitted by declaration: openapi, info, paths, tags, components.responses.NotFound', verdict && sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText({ outOfScopeByDeclaration: 5 }));
	next('', args);
}));
const nodeChange = (stableId, change) => (graph) => ({ ...graph, nodes: graph.nodes.map((oneNode) => (oneNode.stableId === stableId ? { ...oneNode, properties: { ...oneNode.properties, ...change } } : oneNode)) });
const ROUND_TRIP_TWIN_LIST = [
	{ twinName: 'siteDescriptionAltered', expectation: 'both', perturb: nodeChange('synthk:MessageType/when', { description: 'edited' }) },
	{ twinName: 'referenceRetargeted', expectation: 'both', perturb: (graph) => ({ ...graph, edges: graph.edges.map((oneEdge) => (oneEdge.fromRef.id === 'synthk:MessageType/when' && oneEdge.type === 'REFERENCES' ? { ...oneEdge, toRef: { ...oneEdge.toRef, id: 'synthk:PositiveCountType' } } : oneEdge)) }) },
	{ twinName: 'codeListValueDropped', expectation: 'lost', perturb: (graph) => ({ ...graph, edges: graph.edges.filter((oneEdge) => oneEdge.toRef.id !== 'synthk:codeList/CurrencyCodeList/USD') }) },
	{ twinName: 'enumNameAltered', expectation: 'both', perturb: nodeChange('synthk:codeList/CurrencyCodeList/EUR', { enumName: 'Euros' }) },
	{ twinName: 'requiredFromCompositionDropped', expectation: 'lost', perturb: nodeChange('synthk:PeriodType', { requiredNamesFromComposition: '[]' }) },
	{ twinName: 'inlineClassScalarInvented', expectation: 'invented', perturb: nodeChange('synthk:MessageType/policy/inline/rules/inline', { minProperties: 2 }) },
	{ twinName: 'membershipAltered', expectation: 'both', perturb: nodeChange('synthk:AmountType', { bundleMembership: '["other.json"]' }) },
	{ twinName: 'inlineClassMoved', expectation: 'fault', faultPattern: /says it sits at MessageType\/properties\/elsewhere, its REFERENCES edge says MessageType\/properties\/policy/, perturb: nodeChange('synthk:MessageType/policy/inline', { sitePointer: '/properties/elsewhere' }) },
];
ROUND_TRIP_TWIN_LIST.forEach((oneTwin) => taskList.push((args, next) => validateDouble({ forged: args.derived, forgeResult: oneTwin.perturb(copyOfForgeResult(args.derived.forgeResult)), caseName: oneTwin.twinName }, (validateError, verdict) => {
	if (oneTwin === ROUND_TRIP_TWIN_LIST[0]) {
		harness.section('SECTION 3b — round-trip twins, each observed RED');
	}
	const isRed = oneTwin.expectation === 'fault' ? oneTwin.faultPattern.test(`${validateError}`) : !validateError && verdict.roundTripClean === false
		&& (oneTwin.expectation === 'invented' ? verdict.inventedTotal >= 1 : true)
		&& (oneTwin.expectation === 'lost' ? verdict.lostTotal >= 1 : true)
		&& (oneTwin.expectation === 'both' ? verdict.lostTotal >= 1 && verdict.inventedTotal >= 1 : true);
	harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → lost ${verdict && verdict.lostTotal}, invented ${verdict && verdict.inventedTotal}`, isRed, validateError);
	next('', args);
})));

// -----------------------------------------------------------------
// SECTION 4 — two files, one model; and LIF's shape
// -----------------------------------------------------------------
taskList.push((args, next) => forgeCase({ caseName: 'twoFiles', documentByFileName: { 'a.json': TWO_FILE_A, 'b.json': TWO_FILE_B } }, (forgeError, forged) => {
	harness.section('SECTION 4 — two files sharing components; LIF-shaped single file');
	harness.accepts('two files forge as one model', forgeError ? [forgeError] : []);
	if (forgeError) {
		next('', args);
		return;
	}
	const nodeById = forged.forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	harness.equal('a shared component is ONE node naming both files; a single-file one names its file', `${nodeById['synthk:AmountType'].properties.bundleMembership}|${nodeById['synthk:ReportB'].properties.bundleMembership}`, '["a.json","b.json"]|["b.json"]');
	validateDouble({ forged, forgeResult: forged.forgeResult, caseName: 'twoFiles' }, (validateError, verdict) => {
		harness.equal('the round trip per file is clean', verdict && `${verdict.inventedTotal}|${verdict.lostTotal}|${verdict.roundTripClean}`, '0|0|true');
		next('', args);
	});
}));
taskList.push((args, next) => forgeCase({ caseName: 'lifShaped', documentByFileName: { 'lif-schema.json': LIF_SHAPED_DOCUMENT } }, (forgeError, forged) => {
	harness.accepts('a LIF-shaped single file of nested inline objects forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next('', args);
		return;
	}
	const nodeById = forged.forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	harness.equal('no reference to recover; the nesting is inline classes three deep', `${forged.forgeResult.stats.referenceRecoveredCount}|${forged.forgeResult.stats.inlineClassCount}|${Boolean(nodeById['synthk:Person/name/inline/parts/items/deep/inline/leaf'])}`, '0|3|true');
	validateDouble({ forged, forgeResult: forged.forgeResult, caseName: 'lifShaped' }, (validateError, verdict) => {
		harness.equal('its round trip is clean', verdict && `${verdict.inventedTotal}|${verdict.lostTotal}|${verdict.roundTripClean}`, '0|0|true');
		next('', args);
	});
}));

// -----------------------------------------------------------------
// SECTION 5 — every declared refusal, by name
// -----------------------------------------------------------------
const withSchemas = (change) => (documentByFileName) => {
	change(documentByFileName['synth_bundle.json'].components.schemas);
	return documentByFileName;
};
const REFUSAL_CASE_LIST = [
	{ caseName: 'componentDiffersBetweenFiles', documentByFileName: () => ({ 'a.json': copyOf(TWO_FILE_A), 'b.json': { ...copyOf(TWO_FILE_B), components: { schemas: { ...copyOf(TWO_FILE_B.components.schemas), AmountType: { ...copyOf(AMOUNT), title: 'AmountTypeV2' } } } } }), refusalPattern: /component 'AmountType' differs between 'a.json' and 'b.json'/ },
	{ caseName: 'unbrokenTie', documentByFileName: withSchemas((schemaByName) => { schemaByName.MessageType.properties.confirm.title = 'SomethingElse'; schemaByName.confirmMessageType.title = 'SomethingElse'; schemaByName.ConfirmMessageType.title = 'SomethingElse'; }), refusalPattern: /the inline copy equals 2 components \(confirmMessageType, ConfirmMessageType\) and its title "SomethingElse" names none of them/ },
	{ caseName: 'reservedComponentName', documentByFileName: withSchemas((schemaByName) => { schemaByName.codeList = copyOf(DATE_TIME); }), refusalPattern: /component 'codeList' is named after a reserved id segment/ },
	{ caseName: 'undeclaredKeyword', documentByFileName: withSchemas((schemaByName) => { schemaByName.MessageType.properties.count.multipleOf = 3; }), refusalPattern: /keyword 'multipleOf' at the top \(position 'site'\) is not carried/ },
	{ caseName: 'enumNamesMisaligned', documentByFileName: withSchemas((schemaByName) => { schemaByName.MessageType.properties.kind.enumNames = ['Alpha']; }), refusalPattern: /'\/enumNames' is not a list of 2 non-empty strings aligned with its enum/ },
	{ caseName: 'requiredWithoutSupplier', documentByFileName: withSchemas((schemaByName) => { schemaByName.OpenPeriodType.required = ['middle']; }), refusalPattern: /'\/required' names 'middle', which neither its properties nor a composition can supply/ },
	{ caseName: 'typeNotAllowed', documentByFileName: withSchemas((schemaByName) => { schemaByName.PositiveCountType.type = 'null'; }), refusalPattern: /'\/type' is "null", not one of object, string, number, integer, boolean, array/ },
	{ caseName: 'unknownExclusion', documentByFileName: () => ({ 'synth_bundle.json': copyOf(DERIVED_DOCUMENT) }), profileChange: { schemaExclusionList: ['Phantom'] }, refusalPattern: /schemaExclusionList names 'Phantom', which no file's components.schemas holds/ },
	{ caseName: 'versionsDiffer', documentByFileName: () => ({ 'a.json': copyOf(TWO_FILE_A), 'b.json': { ...copyOf(TWO_FILE_B), info: { version: '2.0.0' } } }), refusalPattern: /the profile's files state 2 different info.version values \(1.0.0, 2.0.0\)/ },
];
REFUSAL_CASE_LIST.forEach((oneCase) => taskList.push((args, next) => {
	if (oneCase === REFUSAL_CASE_LIST[0]) {
		harness.section('SECTION 5 — each declared refusal observed by name');
	}
	const documentByFileName = typeof oneCase.documentByFileName === 'function' && oneCase.documentByFileName.length === 1
		? oneCase.documentByFileName({ 'synth_bundle.json': copyOf(DERIVED_DOCUMENT) })
		: oneCase.documentByFileName();
	forgeCase({ caseName: oneCase.caseName, documentByFileName, profileChange: oneCase.profileChange }, (forgeError) => {
		harness.rejects(`REFUSED: ${oneCase.caseName}`, forgeError ? [forgeError] : [], oneCase.refusalPattern);
		next('', args);
	});
}));

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	fs.rmSync(scratchRootPath, { recursive: true, force: true });
	harness.report();
});
