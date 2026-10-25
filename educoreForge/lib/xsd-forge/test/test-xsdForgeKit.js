#!/usr/bin/env node
'use strict';

// test-xsdForgeKit.js — lib/xsd-forge on a SYNTHETIC schema set and a synthetic bundle (family Toy), so what is proven here is the kit's own
// contract, independent of any one standard (the test-openapiForgeKit.js form): the profile seam; one fixture construct per row of DESIGN-K3
// §2 (both prefixes, element/attribute ref=, attributeGroup, include, union, anyAttribute, identity constraints, default/fixed, an absolute
// import location, a foreign namespace, a declared enumeration repeat, excluded files); the round trip over the harness graph double with
// its twins observed RED; one refusal per declared refusal, each on a perturbed COPY of the fixture; determinism. The bundles' end-to-end
// proofs (real snapshots, measured counts) live in forges/<bundle>/test/. Writes only under os.tmpdir(); no Docker, no network.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the XSD kit (lib/xsd-forge): seam, constructs, round trip, refusals (no Docker)

SYNOPSIS
     node lib/xsd-forge/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Forges the synthetic schema set in test/fixtures/xsdKitFixture through the framework with a synthetic bundle built on the kit,
     asserts how each construct is carried, round-trips it over the harness graph double (and observes the round trip RED on perturbed
     graphs), and forges perturbed copies to observe every parser, loader, resolution, walk and profile refusal by name. Writes only
     under os.tmpdir().

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
const { STANDARD_KIND, STANDARD_FAMILY } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const { MAPPING_INSTRUCTION_KEY_ORDER } = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'forgeDeclarationContract'));
const forgeFramework = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'forge-framework'));
const roundTripHarness = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const { validateXsdProfile } = require(path.join(__dirname, '..', 'xsdProfileContract'));
const xsdIdentity = require(path.join(__dirname, '..', 'xsdIdentity'));
const xsdHooksFactory = require(path.join(__dirname, '..', 'xsdHooks'));
const xsdRoundTripPairFactory = require(path.join(__dirname, '..', 'xsdRoundTripPair'));

// -----------------------------------------------------------------
// the synthetic bundle
// -----------------------------------------------------------------
const FIXTURE_DIR_PATH = path.join(__dirname, 'fixtures', 'xsdKitFixture');
const FIXTURE_FILE_LIST = Object.freeze(['a/a.xsd', 'b/b.xsd', 'b/c.xsd', 'extra/legacy.xsd', 'service.wsdl']);
const fixtureProfile = Object.freeze(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR_PATH, 'profile.json'), 'utf8')));
const STABLE_URI_PROPERTY_NAME = 'synthxsdStableId';
const EMPTY_MAPPING_INSTRUCTION_VALUE_LIST = [{}, {}, [], STABLE_URI_PROPERTY_NAME];
const declarationFor = (xsdProfile) => Object.freeze({
	standardKey: 'synthxsd',
	standardSource: 'SynthXsd',
	standardDisplayName: 'Synthetic XSD standard (kit test)',
	standardKind: STANDARD_KIND.DATA_STANDARD,
	standardUsageTips: null,
	descriptionSource: "each node's own xs:documentation, verbatim",
	nativeIdentifierPropertyName: null,
	standardFamily: STANDARD_FAMILY.TOY,
	releaseLabel: 'SynthXsd',
	stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
	stableIdPattern: xsdIdentity.stableIdPatternFor(xsdProfile),
	rootStableIdFrom: 'declared',
	rootStableId: xsdProfile.rootStableId,
	rootLabel: 'SynthXsdRoot',
	parserVersion: '1',
	mappingInstruction: MAPPING_INSTRUCTION_KEY_ORDER.reduce((instruction, instructionPropertyName, propertyIndex) => ({ ...instruction, [instructionPropertyName]: EMPTY_MAPPING_INSTRUCTION_VALUE_LIST[propertyIndex] }), {}),
	nonEmbeddableRoleList: [],
	embedTextDeclaration: null,
	additionalSourceInputList: [{ inputName: 'sourceLocation', relativePathFromSourcePath: 'standardSourceLocation' }],
	compatibilityDeclarationList: [],
});
const bundleFor = (xsdProfile) => forgeFramework({ embedder: null }).injectStandardHooks({ forgeDeclaration: declarationFor(xsdProfile), hooks: xsdHooksFactory({ xsdProfile }) });
const validatorFor = (xsdProfile) => roundTripHarness.validatorFrom({
	forgeDeclaration: declarationFor(xsdProfile),
	...xsdRoundTripPairFactory({ xsdProfile, stableUriPropertyName: STABLE_URI_PROPERTY_NAME, ruleModulePath: 'lib/xsd-forge/xsdRoundTripPair.js' }),
	verdictVersion: 'xsdKitTestVerdict-1',
});

// the measured expectation (DESIGN-K3 §2 row by row; counted by hand from the fixture, then observed)
const EXPECTED = Object.freeze({
	nodeCountByRole: { DmeStandardRoot: 1, DmeSupport: 8, DmeClass: 4, DmeProperty: 11, DmeOptionSet: 2, DmeOptionValue: 5 },
	edgeCountByType: { HAS_SUPPORT: 3, HAS_CLASS: 3, HAS_DEFINITION: 6, HAS_PROPERTY: 11, HAS_VALUE: 5, REFERENCES_TYPE: 3, HAS_OPTION_SET: 2, REFERENCES: 3, SUBCLASS_OF: 1 },
	referenceEdgeCountByConstruct: { type: 2, elementRef: 1, groupRef: 1, attributeGroupRef: 1, base: 1, memberTypes: 1 },
	builtinReferenceCount: 11,
	externalReferenceCountByNamespace: { 'http://www.w3.org/1999/xhtml': 1 },
	describedNodeCountByRole: { DmeClass: 1, DmeProperty: 1, DmeOptionSet: 1 },
	explicitlyOmittedByKind: { excludedSchemaFile: 2 },
});
const ID = Object.freeze({
	reportType: 'synthxsd:type/example.org/a/v1#ReportType',
	title: 'synthxsd:type/example.org/a/v1#ReportType/el/Title',
	status: 'synthxsd:type/example.org/a/v1#ReportType/el/Status',
	noteReference: 'synthxsd:type/example.org/a/v1#ReportType/elRef/Note',
	itemClass: 'synthxsd:type/example.org/a/v1#ReportType/el/Item/anon',
	itemId: 'synthxsd:type/example.org/a/v1#ReportType/el/Item/anon/attr/id',
	levelSet: 'synthxsd:type/example.org/a/v1#ReportType/attr/level/anon',
	body: 'synthxsd:type/example.org/a/v1#ReportType/el/Body',
	reportElement: 'synthxsd:element/example.org/a/v1#Report',
	codeOrText: 'synthxsd:type/example.org/a/v1#CodeOrText',
	statusType: 'synthxsd:type/example.org/b/v1#StatusType',
	onHold: 'synthxsd:type/example.org/b/v1#StatusType/code/on%20hold',
	noteElement: 'synthxsd:element/example.org/b/v1#Note',
	baseType: 'synthxsd:type/example.org/b/v1#BaseType',
	trailerGroup: 'synthxsd:group/example.org/b/v1#TrailerGroup',
	commonAttributes: 'synthxsd:attributeGroup/example.org/b/v1#CommonAttributes',
	fileA: 'synthxsd:schemaFile/a/a.xsd',
	fileB: 'synthxsd:schemaFile/b/b.xsd',
});

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.map((oneEdge) => ({ ...oneEdge, properties: { ...oneEdge.properties } })) });
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'xsdForgeKitTest-'));

// snapshotOf — a snapshot directory (standardSourceData/01): the fixture files with each { fileName: [[find, replace], …] } edit applied
// (each find must occur exactly once), plus added files, the location file and SHA256SUMS
const snapshotOf = ({ caseName, fileEditByName = {}, addedFileByName = {}, droppedFileList = [] }) => {
	const snapshotDirPath = path.join(scratchRootPath, caseName, 'standardSourceData', '01');
	const fileNameList = FIXTURE_FILE_LIST.filter((oneName) => droppedFileList.indexOf(oneName) === -1).concat(Object.keys(addedFileByName));
	fileNameList.forEach((fileName) => {
		const isAdded = addedFileByName[fileName] !== undefined;
		const fileText = (fileEditByName[fileName] || []).reduce((soFar, [findText, replaceText]) => {
			if (soFar.split(findText).length !== 2) {
				throw new Error(`${moduleName}: case ${caseName}: the edit text ${JSON.stringify(findText)} does not occur exactly once in ${fileName}`);
			}
			return soFar.replace(findText, replaceText);
		}, isAdded ? addedFileByName[fileName] : fs.readFileSync(path.join(FIXTURE_DIR_PATH, fileName), 'utf8'));
		fs.mkdirSync(path.dirname(path.join(snapshotDirPath, fileName)), { recursive: true });
		fs.writeFileSync(path.join(snapshotDirPath, fileName), fileText);
	});
	fs.writeFileSync(path.join(snapshotDirPath, 'standardSourceLocation'), 'standard: synthxsd\npublishedVersion: 0.1\nupstreamUrl: https://example.invalid/synthxsd/\n');
	const checksumText = fileNameList.concat(['standardSourceLocation']).map((oneName) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshotDirPath, oneName))).digest('hex')}  ${oneName}`).join('\n');
	fs.writeFileSync(path.join(snapshotDirPath, 'SHA256SUMS'), `${checksumText}\n`);
	return snapshotDirPath;
};
const FIXTURE_SNAPSHOT_PATH = snapshotOf({ caseName: 'fixture' });
const forgeCase = ({ caseName, xsdProfile = fixtureProfile, fileEditByName, addedFileByName, droppedFileList }, callback) => bundleFor(xsdProfile).forge({ sourcePath: snapshotOf({ caseName, fileEditByName, addedFileByName, droppedFileList }), owner: 'test', skipEmbedding: true }, callback);
const validateDouble = ({ forgeResult, caseName }, callback) => {
	const outputPath = path.join(scratchRootPath, `verdict-${caseName}`);
	fs.mkdirSync(outputPath, { recursive: true });
	validatorFor(fixtureProfile).validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: FIXTURE_SNAPSHOT_PATH, outputPath }, callback);
};

const taskList = new taskListPlus();

// -----------------------------------------------------------------
// SECTION 1 — the profile seam
// -----------------------------------------------------------------
taskList.push((args, next) => {
	harness.section('SECTION 1 — the profile is the seam: every field required, unknown refused');
	const refusalOf = (candidateProfile) => {
		try {
			validateXsdProfile(candidateProfile);
			return [];
		} catch (refusalError) {
			// the contract's one channel is a thrown named refusal; the test reads its message
			return [refusalError.message];
		}
	};
	const { enumerationRepeatList, ...withoutRepeatList } = fixtureProfile;
	harness.accepts('the fixture profile validates', refusalOf(fixtureProfile));
	harness.rejects('an unknown field is refused by name', refusalOf({ ...fixtureProfile, schemaSetLsit: [] }), /carries 'schemaSetLsit'/);
	harness.rejects('an absent field is refused, never defaulted', refusalOf(withoutRepeatList), /has no 'enumerationRepeatList'/);
	harness.rejects('an empty schemaSetList is refused', refusalOf({ ...fixtureProfile, schemaSetList: [] }), /schemaSetList is not a non-empty list/);
	harness.rejects('a set entry outside the snapshot (..) is refused', refusalOf({ ...fixtureProfile, schemaSetList: [{ schemaSetName: 'X', entryFileList: ['../a.xsd'] }] }), /schemaSetList\[0\] is not/);
	harness.rejects('a set named twice is refused', refusalOf({ ...fixtureProfile, schemaSetList: [fixtureProfile.schemaSetList[0], fixtureProfile.schemaSetList[0]] }), /names set 'Report' twice/);
	harness.rejects('a location row to a non-relative path is refused', refusalOf({ ...fixtureProfile, schemaLocationTable: { x: '/abs.xsd' } }), /schemaLocationTable is not/);
	harness.rejects('a foreign namespace without a reason is refused', refusalOf({ ...fixtureProfile, foreignNamespaceList: [{ namespace: 'urn:x' }] }), /foreignNamespaceList\[0\] is not/);
	harness.rejects('an exclusion named twice is refused', refusalOf({ ...fixtureProfile, schemaFileExclusionList: [fixtureProfile.schemaFileExclusionList[0], fixtureProfile.schemaFileExclusionList[0]] }), /names 'extra\/legacy.xsd' twice/);
	harness.rejects('a repeat declaration with a stray field is refused', refusalOf({ ...fixtureProfile, enumerationRepeatList: [{ ...enumerationRepeatList[0], value: 'open' }] }), /enumerationRepeatList\[0\] is not/);
	harness.rejects('a bad prefix is refused', refusalOf({ ...fixtureProfile, stableIdPrefix: 'Synth' }), /stableIdPrefix "Synth" is not/);
	harness.rejects('a root outside the prefix is refused', refusalOf({ ...fixtureProfile, rootStableId: 'other:root' }), /rootStableId "other:root" is not 'synthxsd:root'/);
	harness.rejects('a label table missing a node kind is refused', refusalOf({ ...fixtureProfile, perStandardLabelByNodeKind: { ...fixtureProfile.perStandardLabelByNodeKind, support: undefined } }), /perStandardLabelByNodeKind is not one label per node kind/);
	next('', args);
});

// -----------------------------------------------------------------
// SECTION 2 — the fixture forged: counts, identity and the carriage of each construct
// -----------------------------------------------------------------
taskList.push((args, next) => forgeCase({ caseName: 'forge1' }, (forgeError, forgeResult) => {
	harness.section('SECTION 2 — the fixture forged: counts, identity, carriage (DESIGN-K3 §2, row by row)');
	harness.accepts('the fixture forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		next(forgeError, args);
		return;
	}
	const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
	const propertiesOf = (stableId) => (nodeById[stableId] || { properties: {} }).properties;
	const edgeText = (oneEdge) => `${oneEdge.type}|${oneEdge.fromRef.id}|${oneEdge.toRef.id}|${oneEdge.properties.referenceConstruct || ''}`;
	const edgeTextList = forgeResult.edges.map(edgeText);
	const hasEdge = (edgeType, fromStableId, toStableId, referenceConstruct) => edgeTextList.indexOf(`${edgeType}|${fromStableId}|${toStableId}|${referenceConstruct || ''}`) !== -1;
	const structureListOf = (stableId) => JSON.parse(propertiesOf(stableId).xsdStructureList || '[]');
	harness.equal('node count by role', sortedText(countBy(forgeResult.nodes.filter((oneNode) => oneNode.role !== 'DmeEmbedText'), (oneNode) => oneNode.role)), sortedText(EXPECTED.nodeCountByRole));
	harness.equal('edge count by type', sortedText(countBy(forgeResult.edges, (oneEdge) => oneEdge.type)), sortedText(EXPECTED.edgeCountByType));
	harness.equal('reference edges by construct', sortedText(forgeResult.stats.referenceEdgeCountByConstruct), sortedText(EXPECTED.referenceEdgeCountByConstruct));
	harness.equal('built-in references carried as written, no edge (11)', forgeResult.stats.builtinReferenceCount, EXPECTED.builtinReferenceCount);
	harness.equal('one EXTERNAL reference (xhtml:Flow), no edge (FBB-001)', sortedText(forgeResult.stats.externalReferenceCountByNamespace), sortedText(EXPECTED.externalReferenceCountByNamespace));
	harness.equal('the external QName is carried as written', propertiesOf(ID.body).typeQName, 'xhtml:Flow');
	harness.ok('both prefixes read (xsd: in a.xsd, xs: in b.xsd and c.xsd)', nodeById[ID.reportType] !== undefined && nodeById[ID.statusType] !== undefined && nodeById[ID.baseType] !== undefined);
	harness.ok('identity is keyed on the namespace: c.xsd (included into b) mints under example.org/b/v1', nodeById[ID.baseType] !== undefined && propertiesOf(ID.baseType).schemaFile === 'b/c.xsd');
	harness.ok('element ref= is a property named for the reference, REFERENCES the global element (elementRef)', propertiesOf(ID.noteReference).name === 'Note' && propertiesOf(ID.noteReference).refQName === 'b:Note' && hasEdge('REFERENCES', ID.noteReference, ID.noteElement, 'elementRef'));
	harness.ok('a typed element HAS_OPTION_SET its named enumeration type (type)', hasEdge('HAS_OPTION_SET', ID.status, ID.statusType, 'type') && propertiesOf(ID.status).minOccurs === '0');
	harness.ok('a group ref= REFERENCES the group from the owning class (groupRef)', hasEdge('REFERENCES', ID.reportType, ID.trailerGroup, 'groupRef'));
	harness.ok('an attributeGroup ref= REFERENCES the attribute group from the owning class (attributeGroupRef)', hasEdge('REFERENCES', ID.reportType, ID.commonAttributes, 'attributeGroupRef'));
	harness.ok('an extension base is SUBCLASS_OF with derivationVariety', forgeResult.edges.some((oneEdge) => edgeText(oneEdge) === `SUBCLASS_OF|${ID.reportType}|${ID.baseType}|base` && oneEdge.properties.derivationVariety === 'extension'));
	harness.ok('a union member is REFERENCES_TYPE from the union type (memberTypes); its built-in member has no edge', hasEdge('REFERENCES_TYPE', ID.codeOrText, ID.statusType, 'memberTypes') && forgeResult.edges.filter((oneEdge) => oneEdge.fromRef.id === ID.codeOrText && oneEdge.properties.referenceConstruct === 'memberTypes').length === 1);
	harness.ok('an anonymous complexType is its declaration\'s (REFERENCES_TYPE, …/anon), and owns its attribute', hasEdge('REFERENCES_TYPE', 'synthxsd:type/example.org/a/v1#ReportType/el/Item', ID.itemClass) && hasEdge('HAS_PROPERTY', ID.itemClass, ID.itemId) && propertiesOf(ID.itemId).use === 'required');
	harness.ok('an anonymous enumeration simpleType is its attribute\'s option set (HAS_OPTION_SET), default carried', hasEdge('HAS_OPTION_SET', 'synthxsd:type/example.org/a/v1#ReportType/attr/level', ID.levelSet) && propertiesOf('synthxsd:type/example.org/a/v1#ReportType/attr/level').defaultValue === '1');
	harness.equal('fixed= is carried (fixedValue)', propertiesOf('synthxsd:type/example.org/a/v1#AmountType/attr/currency').fixedValue, 'USD');
	harness.ok('a value outside the safe set is percent-encoded in its id, verbatim in its name', propertiesOf(ID.onHold).name === 'on hold');
	harness.equal('the declared repeat mints no second value: StatusType has 3 values', forgeResult.edges.filter((oneEdge) => oneEdge.type === 'HAS_VALUE' && oneEdge.fromRef.id === ID.statusType).length, 3);
	harness.ok('the declared repeat is kept verbatim on the option set', structureListOf(ID.statusType).some((entry) => entry.construct === 'enumeration' && entry.locator === '/schema/simpleType[1]/restriction[1]/enumeration[3]'));
	harness.ok('identity constraints are carried verbatim on the global element (unique, selector, field)', ['identityConstraint', 'identityPath'].every((oneConstruct) => structureListOf(ID.reportElement).some((entry) => entry.construct === oneConstruct)) && structureListOf(ID.reportElement).some((entry) => entry.attributeList.some((oneAttribute) => oneAttribute.attributeValue === '@id')));
	harness.ok('wildcards are carried on the owner (any, anyAttribute)', ['wildcard', 'attributeWildcard'].every((oneConstruct) => structureListOf(ID.reportType).some((entry) => entry.construct === oneConstruct)));
	harness.ok('a comment inside a sequence rides on the owner with its child index', structureListOf(ID.reportType).some((entry) => entry.construct === 'comment' && entry.commentText === ' the title comes first ' && entry.beforeChildIndex === 0));
	harness.ok('prolog and epilog comments ride on the file node', ['prolog', 'epilog'].every((onePlacement) => structureListOf(ID.fileA).some((entry) => entry.placement === onePlacement)));
	harness.equal('descriptions come from each node\'s OWN documentation only', sortedText(forgeResult.stats.describedNodeCountByRole), sortedText(EXPECTED.describedNodeCountByRole));
	harness.ok('a property carries contextText = its path (<owning type>.<field>); a class carries none', propertiesOf(ID.itemId).contextText === 'ReportType.Item.id' && propertiesOf(ID.itemId).path === 'ReportType.Item.id' && propertiesOf(ID.reportType).contextText === undefined);
	harness.ok('the documented property carries its text verbatim; the reference property borrows none', propertiesOf(ID.title).description === 'The title.' && propertiesOf(ID.noteReference).description === undefined);
	harness.ok('the file node carries its namespace, its xmlns bindings and its sets', propertiesOf(ID.fileB).targetNamespace === 'http://example.org/b/v1/' && JSON.parse(propertiesOf(ID.fileB).schemaAttributeList).some((oneAttribute) => oneAttribute.attributeName === 'xmlns:xs') && propertiesOf(ID.fileB).schemaSetNameList === '["Report"]');
	harness.ok('the excluded schema and WSDL mint nothing', forgeResult.nodes.every((oneNode) => ['extra/legacy.xsd', 'service.wsdl'].indexOf(oneNode.properties.schemaFile) === -1));
	args.forgeResult = forgeResult;
	next('', args);
}));

// -----------------------------------------------------------------
// SECTION 3 — the round trip over the graph double, and its twins RED
// -----------------------------------------------------------------
taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, caseName: 'clean' }, (validateError, verdict) => {
	harness.section('SECTION 3 — the round trip: clean on the fixture, RED on every perturbation');
	harness.accepts('the fixture round trip runs', validateError ? [validateError] : []);
	if (validateError) {
		next(validateError, args);
		return;
	}
	harness.equal('invented 0, lost 0', `${verdict.inventedTotal}|${verdict.lostTotal}`, '0|0');
	harness.equal('explicitly omitted: the two excluded files', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(EXPECTED.explicitlyOmittedByKind));
	next('', args);
}));

// each twin perturbs a COPY of the forge result and must turn the round trip red: by count, or by a fatal emission fault
const ROUND_TRIP_TWIN_LIST = Object.freeze([
	{ twinName: 'a carried attribute dropped (minOccurs)', expect: { lostTotal: 1 }, perturb: (copy) => { delete copy.nodes.find((oneNode) => oneNode.stableId === ID.status).properties.minOccurs; } },
	{ twinName: 'an invented node property', expect: { inventedTotal: 1 }, perturb: (copy) => { copy.nodes.find((oneNode) => oneNode.stableId === ID.reportType).properties.bogus = 'x'; } },
	{ twinName: 'a structure entry value changed (choice maxOccurs)', expect: { inventedTotal: 1, lostTotal: 1 }, perturb: (copy) => {
		const owner = copy.nodes.find((oneNode) => oneNode.stableId === ID.reportType);
		owner.properties.xsdStructureList = owner.properties.xsdStructureList.replace('"attributeName":"maxOccurs","attributeValue":"unbounded"', '"attributeName":"maxOccurs","attributeValue":"9"');
	} },
	{ twinName: 'a documentation text changed', expect: { inventedTotal: 1, lostTotal: 1, faultPattern: /description/ }, perturb: (copy) => {
		const owner = copy.nodes.find((oneNode) => oneNode.stableId === ID.statusType);
		owner.properties.xsdStructureList = owner.properties.xsdStructureList.replace('A status.', 'A state.');
	} },
	{ twinName: 'a description that is not the node\'s documentation', expect: { faultPattern: /description "The heading\."/ }, perturb: (copy) => { copy.nodes.find((oneNode) => oneNode.stableId === ID.title).properties.description = 'The heading.'; } },
	{ twinName: 'the SUBCLASS_OF reference edge removed', expect: { faultPattern: /reference edges disagree/ }, perturb: (copy) => { copy.edges = copy.edges.filter((oneEdge) => oneEdge.type !== 'SUBCLASS_OF'); } },
	{ twinName: 'a reference edge retargeted', expect: { faultPattern: /reference edges disagree/ }, perturb: (copy) => { copy.edges.find((oneEdge) => oneEdge.fromRef.id === ID.status && oneEdge.properties.referenceConstruct === 'type').toRef = { source: 'SynthXsd', id: ID.levelSet }; } },
	{ twinName: 'an ownership edge removed (HAS_PROPERTY Title)', expect: { faultPattern: /is not owned by exactly one edge/ }, perturb: (copy) => { copy.edges = copy.edges.filter((oneEdge) => !(oneEdge.type === 'HAS_PROPERTY' && oneEdge.toRef.id === ID.title)); } },
	{ twinName: 'a contextText that is not the path', expect: { faultPattern: /contextText "ReportType.Heading" is not its path/ }, perturb: (copy) => { copy.nodes.find((oneNode) => oneNode.stableId === ID.title).properties.contextText = 'ReportType.Heading'; } },
	{ twinName: 'a reference renamed away from its ref=', expect: { faultPattern: /not the local part of its ref=/ }, perturb: (copy) => { copy.nodes.find((oneNode) => oneNode.stableId === ID.noteReference).properties.name = 'Memo'; } },
]);
ROUND_TRIP_TWIN_LIST.forEach(({ twinName, expect, perturb }) => {
	taskList.push((args, next) => {
		const copy = copyOfForgeResult(args.forgeResult);
		perturb(copy);
		validateDouble({ forgeResult: copy, caseName: `twin-${twinName.replace(/[^A-Za-z0-9]+/g, '-')}` }, (validateError, verdict) => {
			if (expect.faultPattern !== undefined && validateError) {
				harness.match(`twin RED by fault: ${twinName}`, validateError, expect.faultPattern);
				next('', args);
				return;
			}
			const isRed = !validateError && (expect.inventedTotal === undefined || verdict.inventedTotal === expect.inventedTotal) && (expect.lostTotal === undefined || verdict.lostTotal === expect.lostTotal) && (verdict.inventedTotal + verdict.lostTotal) > 0;
			harness.ok(`twin RED by count: ${twinName}`, isRed, validateError ? `unexpected error: ${validateError}` : `invented ${verdict.inventedTotal}, lost ${verdict.lostTotal}`);
			next('', args);
		});
	});
});

// -----------------------------------------------------------------
// SECTION 4 — every declared refusal, on a perturbed copy of the fixture
// -----------------------------------------------------------------
const withProfile = (changes) => ({ ...fixtureProfile, ...changes });
const REFUSAL_CASE_LIST = Object.freeze([
	{ caseName: 'untaughtConstruct', fileEditByName: { 'b/c.xsd': [['<xs:sequence>', '<xs:all>'], ['</xs:sequence>', '</xs:all>']] }, refusalPattern: /'all' at position 'local' is not a taught construct/ },
	{ caseName: 'untaughtAttribute', fileEditByName: { 'a/a.xsd': [['<xsd:complexType name="AmountType">', '<xsd:complexType name="AmountType" mixed="true">']] }, refusalPattern: /attribute 'mixed' is not carried by construct 'globalComplexType'/ },
	{ caseName: 'markupInDocumentation', fileEditByName: { 'a/a.xsd': [['<xsd:documentation>A report.</xsd:documentation>', '<xsd:documentation>A <xhtml:b>report</xhtml:b>.</xsd:documentation>']] }, refusalPattern: /not XML Schema|documentation holds the element/ },
	{ caseName: 'nestedBinding', fileEditByName: { 'b/c.xsd': [['<xs:complexType name="BaseType" abstract="true">', '<xs:complexType name="BaseType" abstract="true" xmlns:q="urn:q">']] }, refusalPattern: /binds a prefix below the schema element/ },
	{ caseName: 'textOutsideDocumentation', fileEditByName: { 'b/c.xsd': [['<xs:element name="Created" type="xs:date"/>', 'stray<xs:element name="Created" type="xs:date"/>']] }, refusalPattern: /the element holds text "stray"/ },
	{ caseName: 'noTargetNamespace', fileEditByName: { 'b/c.xsd': [[' targetNamespace="http://example.org/b/v1/"', '']] }, refusalPattern: /whose targetNamespace is|declares no targetNamespace/ },
	{ caseName: 'unboundQNamePrefix', fileEditByName: { 'b/c.xsd': [['type="xs:date"', 'type="zz:Date"']] }, refusalPattern: /uses prefix 'zz', which the file does not bind/ },
	{ caseName: 'notABuiltin', fileEditByName: { 'b/c.xsd': [['type="xs:date"', 'type="xs:datum"']] }, refusalPattern: /is in the XML Schema namespace but is not a built-in type/ },
	{ caseName: 'namespaceNotImported', fileEditByName: { 'b/c.xsd': [['xmlns="http://example.org/b/v1/"', 'xmlns="http://example.org/b/v1/" xmlns:a="http://example.org/a/v1/"'], ['type="xs:date"', 'type="a:AmountType"']] }, refusalPattern: /which 'b\/c.xsd' neither declares nor imports/ },
	{ caseName: 'undefinedCorpusName', fileEditByName: { 'a/a.xsd': [['type="b:StatusType" minOccurs="0"', 'type="b:StateType" minOccurs="0"']] }, refusalPattern: /names type 'StateType', which namespace 'http:\/\/example.org\/b\/v1\/' does not define/ },
	{ caseName: 'duplicateDefinition', fileEditByName: { 'b/c.xsd': [['<xs:complexType name="BaseType"', '<xs:element name="Note" type="xs:string"/>\n\t<xs:complexType name="BaseType"']] }, refusalPattern: /element 'Note' of namespace 'http:\/\/example.org\/b\/v1\/' is defined in/ },
	{ caseName: 'includeOfAnotherNamespace', fileEditByName: { 'b/c.xsd': [['targetNamespace="http://example.org/b/v1/"', 'targetNamespace="http://example.org/c/v1/"']] }, refusalPattern: /whose targetNamespace is 'http:\/\/example.org\/c\/v1\/', not 'http:\/\/example.org\/b\/v1\/'/ },
	{ caseName: 'importWithoutLocation', fileEditByName: { 'a/a.xsd': [[' schemaLocation="http://example.org/b/v1/b.xsd"', '']] }, refusalPattern: /gives no schemaLocation/ },
	{ caseName: 'unmappedAbsoluteLocation', xsdProfile: withProfile({ schemaLocationTable: {} }), refusalPattern: /schemaLocation 'http:\/\/example.org\/b\/v1\/b.xsd' reaches no file of the snapshot/ },
	{ caseName: 'undeclaredForeignNamespace', xsdProfile: withProfile({ foreignNamespaceList: [] }), refusalPattern: /xhtml1-strict.xsd' reaches no file of the snapshot/ },
	{ caseName: 'unaccountedFile', xsdProfile: withProfile({ schemaFileExclusionList: [fixtureProfile.schemaFileExclusionList[1]] }), refusalPattern: /'extra\/legacy.xsd' is in the snapshot but in no set's closure and not excluded/ },
	{ caseName: 'staleExclusion', xsdProfile: withProfile({ schemaFileExclusionList: fixtureProfile.schemaFileExclusionList.concat([{ schemaFile: 'gone.xsd', reason: 'r' }]) }), refusalPattern: /names 'gone.xsd', which the snapshot does not hold/ },
	{ caseName: 'excludedButReached', xsdProfile: withProfile({ schemaFileExclusionList: fixtureProfile.schemaFileExclusionList.concat([{ schemaFile: 'b/c.xsd', reason: 'r' }]) }), refusalPattern: /reaches 'b\/c.xsd', which schemaFileExclusionList excludes/ },
	{ caseName: 'staleLocationRow', xsdProfile: withProfile({ schemaLocationTable: { ...fixtureProfile.schemaLocationTable, 'http://example.org/unused.xsd': 'b/b.xsd' } }), refusalPattern: /row 'http:\/\/example.org\/unused.xsd' is used by no import/ },
	{ caseName: 'staleForeignNamespace', xsdProfile: withProfile({ foreignNamespaceList: fixtureProfile.foreignNamespaceList.concat([{ namespace: 'http://purl.org/dc/terms/', reason: 'r' }]) }), refusalPattern: /names 'http:\/\/purl.org\/dc\/terms\/', which no forged file imports/ },
	{ caseName: 'undeclaredRepeat', xsdProfile: withProfile({ enumerationRepeatList: [] }), refusalPattern: /enumeration value "open" repeats an earlier value of its restriction/ },
	{ caseName: 'misplacedRepeatDeclaration', xsdProfile: withProfile({ enumerationRepeatList: [{ ...fixtureProfile.enumerationRepeatList[0], enumerationLocator: '/schema/simpleType[1]/restriction[1]/enumeration[1]' }] }), refusalPattern: /"open" is its first occurrence/ },
	{ caseName: 'staleRepeatDeclaration', xsdProfile: withProfile({ enumerationRepeatList: fixtureProfile.enumerationRepeatList.concat([{ schemaFile: 'b/b.xsd', enumerationLocator: '/schema/simpleType[9]/restriction[1]/enumeration[1]', reason: 'r' }]) }), refusalPattern: /enumerationRepeatList names 'b\/b.xsd \/schema\/simpleType\[9\]/ },
	{ caseName: 'enumerationInComplexType', fileEditByName: { 'a/a.xsd': [['<xsd:extension base="xsd:decimal">', '<xsd:restriction base="xsd:decimal"><xsd:enumeration value="0"/></xsd:restriction><xsd:extension base="xsd:decimal">']] }, refusalPattern: /an enumeration whose nearest minted ancestor is a globalComplexType/ },
	{ caseName: 'anonymousTypeOutsideDeclaration', fileEditByName: { 'a/a.xsd': [['<xsd:union memberTypes="b:StatusType xsd:string"/>', '<xsd:union memberTypes="b:StatusType"><xsd:simpleType><xsd:restriction base="xsd:string"/></xsd:simpleType></xsd:union>']] }, refusalPattern: /an anonymous simpleType that is not the type of an element or attribute declaration/ },
	{ caseName: 'malformedXml', fileEditByName: { 'b/c.xsd': [['</xs:schema>', '</xs:schemaa>']] }, refusalPattern: /schema file 'b\/c.xsd': .*Unmatched closing tag/ },
]);
REFUSAL_CASE_LIST.forEach(({ caseName, xsdProfile, fileEditByName, refusalPattern }) => {
	taskList.push((args, next) => forgeCase({ caseName, xsdProfile, fileEditByName }, (forgeError) => {
		if (caseName === REFUSAL_CASE_LIST[0].caseName) {
			harness.section('SECTION 4 — every declared refusal, by name, on a perturbed copy');
		}
		harness.rejects(`refused: ${caseName}`, forgeError ? [forgeError] : [], refusalPattern);
		next('', args);
	}));
});

// -----------------------------------------------------------------
// SECTION 5 — determinism: two forges of the same bytes are byte-identical
// -----------------------------------------------------------------
taskList.push((args, next) => forgeCase({ caseName: 'forge2' }, (forgeError, secondResult) => {
	harness.section('SECTION 5 — determinism');
	harness.ok('a second forge of the fixture is byte-identical (nodes and edges)', !forgeError && JSON.stringify({ nodes: secondResult.nodes, edges: secondResult.edges }) === JSON.stringify({ nodes: args.forgeResult.nodes, edges: args.forgeResult.edges }), forgeError || 'differs');
	next('', args);
}));

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	harness.report();
});
