#!/usr/bin/env node
'use strict';

// test-derivedPlugin.js — the phase B1 gates for the PESC College Transcript 1.8.0 derived plugin
// (WORKORDER-pescForgeBridge-093026 §3 B1; DESIGN-pescBridge.md Revision 3). HERMETIC: the shipped plugin file runs,
// unmodified, on the bridge framework's graph-double path over the RELEASE'S OWN FORGE OUTPUT (forged here from the
// bundle's pinned snapshot, no embedding) beside the framework's toy hub, under the debug judge. No Docker, no network,
// no spend. Every conjunct is observed RED under its own twin before the family counts as green (gateSuiteRunner).
//
//   B1-REGISTER (a)  the registry discovers and accepts the plugin at zero spend. Twin: neighbourVote removed.
//               (a′) the id list holds 2,731 unique bare six-digit ids, sorted. Twin: the list emptied.
//               (a″) a listed bare id planted in a subject's documentation refuses the run by the identifierList pattern.
//                    Twin: the planted id dropped from the list.
//               (s)  the scope list and the section file are the forge's: the 375 declarations marked reachable, each
//                    with at least one HAS_INSTANCE, and the 22 sectionPaths the occurrences carry, at the declared sha.
//                    Twin: the scope list loses one declaration.
//   B1-UNITS    (b1) 539 units over 375 subjects, and each unit is exactly (declaration, section label) with the
//                    declaration's occurrences in that section as its instances, derived here from the forge's
//                    HAS_INSTANCE edges and the section file, not from the framework. Twins: the partition removed
//                    (units fall to 375); one byte of the section file altered (the run refuses by sha).
//               (b2) ContactsType/Address is four units whose labels are its four readable sections, holding 1, 1, 1
//                    and 4 occurrences (the hand literal). Twin: one Address occurrence moved to another section.
//               (b3) the double is live-shaped: 303 of the 375 subjects carry occurrenceSectionList as a string (the
//                    replay engine stores a one-element list as a scalar); widened, every subject's sections equal its
//                    units' labels' sections. Twin: the widening removed.
//   B1-EDGES    (c)  a debug materialise writes one edge per occurrence, 1,367, from the occurrence to its unit's card,
//                    each naming its declaration as judgedSubjectStableId. Twin: one instance skipped in the materialiser.
//               (e)  the SSSOM export passes the subject-prefix check: one row per written edge, every subject_id an
//                    occurrence stableId beginning 'pesccollegetranscript1v8v0:'. Twin: one occurrence unprefixed.
//   B1-PROMPT   (d1) every prompt carries exactly one documentSection line, equal to its own unit's label (RULING
//                    QUIET_ORBIT 2026-10-01 (1): the renderer sorts its lines, so the line is not first). Twin:
//                    sectionPath blinded (the contract refuses).
//               (d2) no prompt names the release: no '1.8.0', 'v1.8.0', 'urn:org:pesc', '.xsd' or the _source. Twin:
//                    typeQName added to the allow-list (the forge stamps no targetNamespace on an element; typeQName
//                    carries the namespace, so every typed unit's prompt names it).
//               (d3) the count of prompts carrying a codeListName or codeListDocumentation line equals the measured
//                    literal (RULING QUIET_ORBIT 2026-10-01 (2): 0 until the forge stamps them; then the number of
//                    code-list-typed units). Twin: one subject given a codeListName.
//
// THE DOUBLE. The forge's own nodes and edges, every property stored as the replay engine stores it (a one-element list
// becomes a scalar, replay-engine.js pgToStored), every text node given a fabricated vector under the plugin's declared
// model; the framework's toy hub (cards, slot edges, property base nodes) with three hub texts. Every subject's texts
// reach a hub property, so every unit's pool is non-empty and the debug rule 'first' picks for all 539.
//
// Run: node forges/pesccollegetranscript1v8v0/test/test-derivedPlugin.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase B1 gates: the PESC College Transcript 1.8.0 derived plugin registers, judges each declaration once per document section on the graph double, writes one edge per occurrence, and names no release

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FRAMEWORK_TEST_DIR = path.join(TREE_ROOT, 'lib', 'bridge-framework', 'test');
const scenarioLib = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'toyBridgeScenario'));
const toyEmbedTextBoltGraphLib = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'toyEmbedTextBoltGraph'));
const { runConjunct, pureConjunct, succeeded, nameInRefusal, scenarioTwin, frameworkMutationTwin, blockOf, edgesOf, forensicsOf } = require(path.join(FRAMEWORK_TEST_DIR, 'testSupport', 'bridgeTwinFactories'));
const { runGateFamily } = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const rosterLib = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roster'));
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));
const sssomExporterLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'sssomExporter'));
const { DME_ROLES, EDGE_TYPES, EMBED_TEXT_VECTOR } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));

const twinRegistry = makeTwinRegistry();
const cloneJson = scenarioLib.cloneJson;

// ---------------------------------------------------------------------
// the plugin under test, and the frozen literals it is measured against
// ---------------------------------------------------------------------
const PLUGIN_NAME = 'pescCollegeTranscript1v8v0CedsDerivedPlugin';
const STANDARD_KEY = 'pesccollegetranscript1v8v0';
const PLUGIN_FILE_NAME = `${PLUGIN_NAME}.js`;
const REAL_FORGES_DIR = path.join(TREE_ROOT, 'forges');
const SHIPPED_BRIDGES_DIR = path.join(BUNDLE_DIR, 'bridges');
const IDENTIFIER_LIST_FILE_NAME = 'pescCollegeTranscript1v8v0CedsIdList.json';
const SCOPE_LIST_FILE_NAME = 'pescCollegeTranscript1v8v0ReachableSubjects.json';
const SECTION_FILE_NAME = 'pescCollegeTranscript1v8v0SectionPartition.tsv';
const SUBJECT_LABEL = 'PescCollegeTranscript1v8v0Element';
const OCCURRENCE_LABEL = 'PescCollegeTranscript1v8v0Occurrence';
const MATERIALISER_FILE = 'materialiser.js';
// the SIF list copied whole (DESIGN-pescBridge §2.3): every bare id the live hub's cards carry, measured 2026-09-29
const IDENTIFIER_LIST_COUNT = 2731;
// WORKORDER §3 B1 and F3's measured literals (DEVLOG-F3 §3)
const SUBJECT_COUNT = 375;
const UNIT_COUNT = 539;
const OCCURRENCE_COUNT = 1367;
const SECTION_COUNT = 22;
// the one-element-list collapse, measured live on DEV_pescCollegeTranscript1v8v0 (DEVLOG-F5 §4) and in F3
const STRING_SHAPED_SECTION_LIST_COUNT = 303;
// RULING QUIET_ORBIT 2026-10-01 (2): the forge stamps no code-list property on an element yet; this literal becomes the
// number of code-list-typed units when it does
const CODE_LIST_PROMPT_COUNT = 0;
// the bare id planted in (a″): the first id on the shipped list
const PLANTED_BARE_ID = '000102';
// the strings that would name the release in a prompt (DESIGN-pescBridge §4.4)
const RELEASE_NAMING_TEXT_LIST = Object.freeze(['1.8.0', 'v1.8.0', 'urn:org:pesc', '.xsd', 'PESC-CollegeTranscript']);
const CODE_LIST_PROPERTY_NAME_LIST = Object.freeze(['codeListName', 'codeListDocumentation']);

// THE ADDRESS LITERAL (b2), read by hand from DEVLOG-F3 §3 and the forge design §2.2's example: ContactsType/Address is
// at 7 paths in 4 sections; the Academic Record section holds 4 of them (School, AcademicSession/School and two more)
const ADDRESS_SUBJECT = 'pesccollegetranscript1v8v0:type/urn:org:pesc:sector:AcademicRecord:v1.13.0#ContactsType/el/1:Address';
const ADDRESS_UNIT_LITERAL = Object.freeze([
	{ judgmentPartitionLabel: 'College Transcript / Student / Academic Record', instanceCount: 4 },
	{ judgmentPartitionLabel: 'College Transcript / Student / Person', instanceCount: 1 },
	{ judgmentPartitionLabel: 'College Transcript / Transmission Data / Destination', instanceCount: 1 },
	{ judgmentPartitionLabel: 'College Transcript / Transmission Data / Source', instanceCount: 1 },
]);

// ---------------------------------------------------------------------
// THE SCRATCH FORGES TREE — the harness's toy bundles plus a COPY of the shipped bridges/ folder under this bundle's
// key, so the registry discovers the real plugin next to the toy hub. A twin edits only the copy.
// ---------------------------------------------------------------------
const copyDirectory = (fromDir, toDir) => {
	fs.mkdirSync(toDir, { recursive: true });
	fs.readdirSync(fromDir, { withFileTypes: true }).forEach((oneEntry) => {
		const fromPath = path.join(fromDir, oneEntry.name);
		const toPath = path.join(toDir, oneEntry.name);
		if (oneEntry.isDirectory()) {
			copyDirectory(fromPath, toPath);
			return;
		}
		fs.copyFileSync(fromPath, toPath);
	});
};
const makePescForgesDir = (scenario) => {
	const forgesDirPath = scenarioLib.makeScratchForgesCopy();
	const bridgesDirPath = path.join(forgesDirPath, STANDARD_KEY, 'bridges');
	copyDirectory(SHIPPED_BRIDGES_DIR, bridgesDirPath);
	const transformFile = (fileName, transform) => {
		if (transform !== undefined) {
			const filePath = path.join(bridgesDirPath, fileName);
			fs.writeFileSync(filePath, transform(fs.readFileSync(filePath, 'utf8')));
		}
	};
	transformFile(PLUGIN_FILE_NAME, scenario.pluginTextTransform);
	transformFile(SECTION_FILE_NAME, scenario.sectionFileTextTransform);
	if (scenario.identifierListTransform !== undefined) {
		transformFile(IDENTIFIER_LIST_FILE_NAME, (listText) => `${JSON.stringify(scenario.identifierListTransform(JSON.parse(listText)), null, '\t')}\n`);
	}
	return forgesDirPath;
};
const shippedDeclaration = () => cloneJson(require(path.join(SHIPPED_BRIDGES_DIR, PLUGIN_FILE_NAME)).bridgeDeclaration);
const applyDeclarationEdit = (scenario) => {
	if (scenario.declarationEdit !== undefined) {
		const bridgeDeclaration = shippedDeclaration();
		scenario.declarationEdit(bridgeDeclaration);
		scenario.pluginModuleOverrides[PLUGIN_NAME] = { bridgeDeclaration };
	}
};

// ---------------------------------------------------------------------
// THE DOUBLE: the release's forge output, live-shaped, beside the toy hub
// ---------------------------------------------------------------------
const DECLARED_MODEL = shippedDeclaration().candidateRetrieval.embeddingModelVersion;
const HUB_NAME = toyEmbedTextBoltGraphLib.HUB_NAME;
const CARD_VECTOR_BY_CARD_STABLE_ID = Object.freeze({
	'toyhub:card/P000001.C1': [1, 0, 0, 0],
	'toyhub:card/P000005.C1': [0.2, 1, 0, 0],
	'toyhub:card/P000008.C3': [0, 0, 0.2, 1],
});
// each hub text describes a hub PROPERTY base node, so a hit on it admits that property's cards
const HUB_TEXT_LIST = Object.freeze([
	{ textName: 'hIdentifier', vector: [1, 0, 0, 0], describedStableIdList: ['toyhub:property/P000001'] },
	{ textName: 'hOrganization', vector: [0, 1, 0, 0], describedStableIdList: ['toyhub:property/P000005'] },
	{ textName: 'hLocation', vector: [0, 0, 0, 1], describedStableIdList: ['toyhub:property/P000008'] },
]);
// a PESC text's fabricated vector, by the first property it serves: names lean to identifiers, prose to organisations,
// readable paths to locations; every one of them clears the declared minScore against some hub text
const SUBJECT_TEXT_VECTOR_BY_PROPERTY_NAME = Object.freeze({
	name: [0.9, 0.1, 0, 0],
	documentation: [0.1, 0.9, 0, 0],
	effectiveDocumentation: [0.1, 0.9, 0, 0],
	contextText: [0.1, 0, 0, 0.9],
});
const OTHER_TEXT_VECTOR = Object.freeze([0.5, 0.5, 0, 0]);

// liveShapedProperties — the replay engine's pgToStored rule (replay-engine.js): a one-element list is stored as its one
// value. The live graph's readers see that shape, so the double carries it.
const liveShapedProperties = (properties) => Object.keys(properties).reduce((soFar, propertyName) => {
	const propertyValue = properties[propertyName];
	soFar[propertyName] = Array.isArray(propertyValue) && propertyValue.length === 1 ? propertyValue[0] : propertyValue;
	return soFar;
}, {});
// widenedList — the read rule for a live-shaped list property (NOTES-supervisor item 16): a scalar is a one-element list
const widenedList = (listOrScalar) => (Array.isArray(listOrScalar) ? listOrScalar : [listOrScalar]);

const forgedGraphToDouble = ({ forged, scopeStableIdSet }) => {
	const pescNodeList = forged.nodes.map((oneNode) => {
		const properties = liveShapedProperties({ ...oneNode.properties, stableId: oneNode.stableId });
		if (oneNode.labels.indexOf(DME_ROLES.EMBED_TEXT) !== -1) {
			properties[EMBED_TEXT_VECTOR.propertyName] = OTHER_TEXT_VECTOR.slice();
			properties.embeddingModelVersion = DECLARED_MODEL;
			properties.embedSourceProperty = 'text';
			properties.vectorPropertyName = EMBED_TEXT_VECTOR.propertyName;
		}
		return { stableId: oneNode.stableId, labels: oneNode.labels.slice(), properties };
	});
	const pescEdgeList = forged.edges.map((oneEdge) => ({ fromStableId: oneEdge.fromRef.id, toStableId: oneEdge.toRef.id, type: oneEdge.type, properties: liveShapedProperties(oneEdge.properties || {}) }));
	// a text's vector follows the first property it serves on its first edge
	const textNodeByStableId = pescNodeList.reduce((soFar, oneNode) => {
		if (oneNode.labels.indexOf(DME_ROLES.EMBED_TEXT) !== -1) {
			soFar[oneNode.stableId] = oneNode;
		}
		return soFar;
	}, {});
	pescEdgeList.filter((oneEdge) => oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF).forEach((oneEdge) => {
		const textNode = textNodeByStableId[oneEdge.fromStableId];
		const servedVector = SUBJECT_TEXT_VECTOR_BY_PROPERTY_NAME[widenedList(oneEdge.properties.propertyNameList)[0]];
		if (textNode !== undefined && servedVector !== undefined && textNode.vectorAssigned !== true) {
			textNode.properties[EMBED_TEXT_VECTOR.propertyName] = servedVector.slice();
			textNode.vectorAssigned = true;
		}
	});
	pescNodeList.forEach((oneNode) => delete oneNode.vectorAssigned);
	const baseGraph = toyEmbedTextBoltGraphLib.embedTextBoltGraph();
	const hubNodeList = baseGraph.nodeList
		.filter((oneNode) => oneNode.properties.role !== DME_ROLES.EMBED_TEXT && oneNode.properties._source === HUB_NAME)
		.map((oneNode) => {
			const properties = { ...oneNode.properties };
			if (CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId] !== undefined) {
				properties.embedding = CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId].slice();
			}
			if (properties.embedding !== undefined) {
				properties.embeddingModelVersion = DECLARED_MODEL;
			}
			return { ...oneNode, properties };
		});
	const hubStableIdSet = new Set(hubNodeList.map((oneNode) => oneNode.stableId));
	const hubEdgeList = baseGraph.edgeList.filter((oneEdge) => oneEdge.type !== EDGE_TYPES.EMBEDS_TEXT_OF && hubStableIdSet.has(oneEdge.fromStableId) && hubStableIdSet.has(oneEdge.toStableId));
	HUB_TEXT_LIST.forEach((oneText) => {
		const textStableId = `toyhub:root/embedText/${oneText.textName}`;
		hubNodeList.push({
			stableId: textStableId,
			labels: ['ForgedNode', 'ToyHubEmbedText', DME_ROLES.EMBED_TEXT],
			properties: { stableId: textStableId, text: `toy text ${textStableId}`, role: DME_ROLES.EMBED_TEXT, _source: HUB_NAME, [EMBED_TEXT_VECTOR.propertyName]: oneText.vector.slice(), embeddingModelVersion: DECLARED_MODEL, embedSourceProperty: 'text', vectorPropertyName: EMBED_TEXT_VECTOR.propertyName },
		});
		oneText.describedStableIdList.forEach((describedStableId) => hubEdgeList.push({ fromStableId: textStableId, toStableId: describedStableId, type: EDGE_TYPES.EMBEDS_TEXT_OF, properties: { propertyNameList: 'name', provenanceTier: 'structural' } }));
	});
	// THE RUN DOUBLE is the bridge's slice of the forge: the in-scope declarations, their occurrences, the texts that
	// describe them, and the two edge types a derived run reads among them. Everything else is nothing a derived run
	// reads, and graphDouble.js rebuilds its whole node map on every mapping-edge write (nodeByStableId, an O(N²)
	// spread-reduce), so a double carrying all 8,997 forged nodes cannot materialise 1,367 edges in a test's time. The
	// forge's whole graph stays the reference every forge-side literal below is read from.
	const keptPescStableIdSet = new Set(pescNodeList.filter((oneNode) => scopeStableIdSet.has(oneNode.stableId) || oneNode.labels.indexOf(OCCURRENCE_LABEL) !== -1).map((oneNode) => oneNode.stableId));
	pescEdgeList.filter((oneEdge) => oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF && keptPescStableIdSet.has(oneEdge.toStableId)).forEach((oneEdge) => keptPescStableIdSet.add(oneEdge.fromStableId));
	const RUN_EDGE_TYPE_LIST = [EDGE_TYPES.HAS_INSTANCE, EDGE_TYPES.EMBEDS_TEXT_OF];
	const runDouble = {
		nodeList: hubNodeList.concat(pescNodeList.filter((oneNode) => keptPescStableIdSet.has(oneNode.stableId))),
		edgeList: hubEdgeList.concat(pescEdgeList.filter((oneEdge) => RUN_EDGE_TYPE_LIST.indexOf(oneEdge.type) !== -1 && keptPescStableIdSet.has(oneEdge.fromStableId) && keptPescStableIdSet.has(oneEdge.toStableId))),
	};
	return { forgedGraph: { nodeList: pescNodeList, edgeList: pescEdgeList }, runDouble };
};

// ---------------------------------------------------------------------
// what the forge says the units are, read WITHOUT the framework: HAS_INSTANCE grouped by the occurrence's
// sectionPath, labelled through the shipped section file
// ---------------------------------------------------------------------
const readSectionLabelBySectionPath = (sectionFileText) =>
	sectionFileText
		.split('\n')
		.slice(1)
		.filter((oneLine) => oneLine.length > 0)
		.reduce((soFar, oneLine) => {
			const [sectionPath, documentSection] = oneLine.split('\t');
			soFar[sectionPath] = documentSection;
			return soFar;
		}, {});
const unitSortText = (oneUnit) => `${oneUnit.subjectStableId}|${oneUnit.judgmentPartitionLabel}`;
const expectedUnitListOf = (graph, scopeStableIdSet) => {
	const labelBySectionPath = readSectionLabelBySectionPath(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, SECTION_FILE_NAME), 'utf8'));
	const nodeByStableId = graph.nodeList.reduce((soFar, oneNode) => {
		soFar[oneNode.stableId] = oneNode;
		return soFar;
	}, {});
	const instanceListByUnitText = {};
	graph.edgeList
		.filter((oneEdge) => oneEdge.type === EDGE_TYPES.HAS_INSTANCE && scopeStableIdSet.has(oneEdge.fromStableId))
		.forEach((oneEdge) => {
			const unitText = `${oneEdge.fromStableId}|${labelBySectionPath[nodeByStableId[oneEdge.toStableId].properties.sectionPath]}`;
			(instanceListByUnitText[unitText] = instanceListByUnitText[unitText] || []).push(oneEdge.toStableId);
		});
	return Object.keys(instanceListByUnitText)
		.map((unitText) => ({ subjectStableId: unitText.split('|')[0], judgmentPartitionLabel: unitText.split('|')[1], instanceStableIdList: instanceListByUnitText[unitText].sort() }))
		.sort((leftUnit, rightUnit) => unitSortText(leftUnit).localeCompare(unitSortText(rightUnit)));
};
const unitListOf = (outcome) =>
	blockOf(outcome)
		.decisionRecordList.map((oneRecord) => ({ subjectStableId: oneRecord.subjectStableId, judgmentPartitionLabel: oneRecord.judgmentPartitionLabel === undefined ? null : oneRecord.judgmentPartitionLabel, instanceStableIdList: oneRecord.instanceStableIdList.slice().sort() }))
		.sort((leftUnit, rightUnit) => unitSortText(leftUnit).localeCompare(unitSortText(rightUnit)));
const pickedRecordListOf = (outcome) => blockOf(outcome).decisionRecordList.filter((oneRecord) => typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0);
const expectedEdgeLineListOf = (outcome) =>
	pickedRecordListOf(outcome)
		.reduce((soFar, oneRecord) => soFar.concat(oneRecord.instanceStableIdList.map((instanceStableId) => `${instanceStableId} → ${oneRecord.objectStableId} ⟨${oneRecord.subjectStableId}⟩`)), [])
		.sort();
const writtenEdgeLineListOf = (outcome) => edgesOf(outcome).map((oneEdge) => `${oneEdge.fromStableId} → ${oneEdge.toStableId} ⟨${oneEdge.properties.judgedSubjectStableId}⟩`).sort();
const promptListOf = (outcome) => forensicsOf(outcome).filter((oneEntry) => oneEntry.record && typeof oneEntry.record.userPrompt === 'string').map((oneEntry) => oneEntry.record);
const subjectLineListOf = (userPrompt, propertyName) => userPrompt.split('\n').filter((oneLine) => oneLine.indexOf(`  ${propertyName}: `) === 0).map((oneLine) => oneLine.slice(`  ${propertyName}: `.length));

// ---------------------------------------------------------------------
// the gates, built once the forge has run
// ---------------------------------------------------------------------
const buildGateDeclarationList = ({ forgedGraph, runDouble }) => {
	const shippedScopeList = () => JSON.parse(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, SCOPE_LIST_FILE_NAME), 'utf8'));
	const shippedIdentifierList = () => JSON.parse(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, IDENTIFIER_LIST_FILE_NAME), 'utf8'));
	const expectedUnitList = expectedUnitListOf(forgedGraph, new Set(shippedScopeList()));
	const occurrenceStableIdList = forgedGraph.nodeList.filter((oneNode) => oneNode.labels.indexOf(OCCURRENCE_LABEL) !== -1).map((oneNode) => oneNode.stableId).sort();

	// pescShape — the run: the shipped plugin (a twin's edit laid over it), the scratch forges tree, the release on the
	// toy hub, the debug judge's 'first' rule so every non-empty pool is picked
	const pescShape = (scenario) => {
		scenario.forgesDirOverride = makePescForgesDir(scenario);
		applyDeclarationEdit(scenario);
		scenario.graph = cloneJson(runDouble);
		if (scenario.graphEdit !== undefined) {
			scenario.graphEdit(scenario.graph);
		}
		scenario.judgeRule = 'first';
		scenario.spec.bridge = PLUGIN_NAME;
		scenario.spec.source = STANDARD_KEY;
		scenario.spec.config = { ...scenario.spec.config, sourceStandard: STANDARD_KEY, sourceStandardName: 'PESC-CollegeTranscript-1.8.0', sourceVersion: '1.8.0', familyStandards: [STANDARD_KEY] };
	};
	const subjectNodeOf = (graph, stableId) => graph.nodeList.find((oneNode) => oneNode.stableId === stableId);

	// ------------------------------- B1-REGISTER
	const registryOutcomeFor = (scenario) => {
		const forgesDirPath = makePescForgesDir(scenario);
		const requireModule = (pluginFilePath) => {
			const loaded = require(pluginFilePath);
			if (scenario.declarationEdit === undefined || loaded.bridgeDeclaration.bridgeName !== PLUGIN_NAME) {
				return loaded;
			}
			const edited = shippedDeclaration();
			scenario.declarationEdit(edited);
			return { bridgeDeclaration: edited, bridgeHooks: loaded.bridgeHooks };
		};
		// the registry THROWS by name on any refusal, which is its declared interface; the throw is the observation
		try {
			const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath, requireModule });
			return { looked: pluginRegistryLib.lookupPlugin({ registry, bridgeName: PLUGIN_NAME, standardKey: STANDARD_KEY }) };
		} catch (registryThrow) {
			return { thrownText: registryThrow.message };
		}
	};
	const REAL_REGISTRY_NAME_LIST = Object.keys(pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: REAL_FORGES_DIR }).entryByBridgeName).sort();
	const registerConjunctList = [
		pureConjunct({
			conjunctId: 'a_registryAcceptsThePlugin',
			title: `(a) discovery over forges/ registers '${PLUGIN_NAME}' under standardKey '${STANDARD_KEY}' at zero spend, and the same file registers from a scratch copy of its folder`,
			twinNameList: ['neighbourVoteRemoved'],
			judge: (scenario) => {
				const scratchOutcome = registryOutcomeFor(scenario);
				const realListed = REAL_REGISTRY_NAME_LIST.indexOf(PLUGIN_NAME) !== -1;
				const scratchAccepted = scratchOutcome.thrownText === undefined && scratchOutcome.looked.error === undefined;
				return { pass: realListed && scratchAccepted, detail: scratchAccepted ? `registered; real forges/ lists ${PLUGIN_NAME} ${realListed}` : `REFUSED: ${(scratchOutcome.thrownText || scratchOutcome.looked.error.message).slice(0, 360)}` };
			},
		}),
		pureConjunct({
			conjunctId: 'aPrime_identifierListShape',
			title: `(a′) the identifier list holds ${IDENTIFIER_LIST_COUNT} unique bare six-digit ids, sorted: never empty (an empty list matches every prompt), never the P-form the pattern already catches`,
			twinNameList: ['identifierListEmptied'],
			judge: (scenario) => {
				const identifierList = scenario.identifierListTransform === undefined ? shippedIdentifierList() : scenario.identifierListTransform(shippedIdentifierList());
				const allBare = identifierList.every((oneId) => typeof oneId === 'string' && /^\d{6}$/.test(oneId));
				const sortedUnique = identifierList.every((oneId, idIndex) => idIndex === 0 || identifierList[idIndex - 1] < oneId);
				return { pass: identifierList.length === IDENTIFIER_LIST_COUNT && allBare && sortedUnique, detail: `${identifierList.length} id(s); all bare six digits ${allBare}; sorted and unique ${sortedUnique}` };
			},
		}),
		runConjunct({
			conjunctId: 'aDoublePrime_listedBareIdRefused',
			title: `(a″) a listed bare id (${PLANTED_BARE_ID}) planted in ContactsType/Address's documentation refuses the run, naming the identifierList pattern`,
			twinNameList: ['plantedIdDroppedFromList'],
			shape: (scenario) => {
				scenario.graphEdit = (graph) => {
					const addressNode = subjectNodeOf(graph, ADDRESS_SUBJECT);
					addressNode.properties.effectiveDocumentation = `${addressNode.properties.effectiveDocumentation} (see ${PLANTED_BARE_ID})`;
				};
				pescShape(scenario);
			},
			judge: nameInRefusal(new RegExp(`prompt identifier scan hit for subject ${ADDRESS_SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: pattern 'identifierList' matched '${PLANTED_BARE_ID}'`)),
		}),
		pureConjunct({
			conjunctId: 's_scopeAndSectionsAreTheForges',
			title: `(s) the scope list is exactly the ${SUBJECT_COUNT} declarations the forge marks reachable, each with a HAS_INSTANCE edge; the section file is exactly the ${SECTION_COUNT} sectionPaths the ${OCCURRENCE_COUNT} occurrences carry, at the sha256 the declaration restates`,
			twinNameList: ['scopeListLosesOneDeclaration'],
			judge: (scenario) => {
				const scopeList = scenario.scopeListTransform === undefined ? shippedScopeList() : scenario.scopeListTransform(shippedScopeList());
				const markedList = forgedGraph.nodeList.filter((oneNode) => oneNode.labels.indexOf(SUBJECT_LABEL) !== -1 && oneNode.properties.reachableFromRoot === true).map((oneNode) => oneNode.stableId).sort();
				const instancedList = Array.from(new Set(forgedGraph.edgeList.filter((oneEdge) => oneEdge.type === EDGE_TYPES.HAS_INSTANCE).map((oneEdge) => oneEdge.fromStableId))).sort();
				const sectionFileText = fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, SECTION_FILE_NAME), 'utf8');
				const fileSectionList = Object.keys(readSectionLabelBySectionPath(sectionFileText)).sort();
				const carriedSectionList = Array.from(new Set(forgedGraph.nodeList.filter((oneNode) => occurrenceStableIdList.indexOf(oneNode.stableId) !== -1).map((oneNode) => oneNode.properties.sectionPath))).sort();
				const fileSha256 = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, SECTION_FILE_NAME))).digest('hex');
				const scopeEqual = JSON.stringify(scopeList.slice().sort()) === JSON.stringify(markedList) && JSON.stringify(markedList) === JSON.stringify(instancedList);
				const pass = scopeList.length === SUBJECT_COUNT && scopeEqual && occurrenceStableIdList.length === OCCURRENCE_COUNT && fileSectionList.length === SECTION_COUNT && JSON.stringify(fileSectionList) === JSON.stringify(carriedSectionList) && fileSha256 === shippedDeclaration().judgmentPartition.sha256;
				return { pass, detail: `scope ${scopeList.length}, marked ${markedList.length}, instanced ${instancedList.length}, equal ${scopeEqual}; occurrences ${occurrenceStableIdList.length}; sections file ${fileSectionList.length} carried ${carriedSectionList.length}; sha ${fileSha256.slice(0, 12)}…` };
			},
		}),
	];
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-REGISTER', conjunctId: 'a_registryAcceptsThePlugin', twinName: 'neighbourVoteRemoved', leverKind: 'inputFault', mutate: (scenario) => { scenario.declarationEdit = (bridgeDeclaration) => { delete bridgeDeclaration.candidateRetrieval.neighbourVote; }; } });
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-REGISTER', conjunctId: 'aPrime_identifierListShape', twinName: 'identifierListEmptied', leverKind: 'inputFault', mutate: (scenario) => { scenario.identifierListTransform = () => []; } });
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-REGISTER', conjunctId: 'aDoublePrime_listedBareIdRefused', twinName: 'plantedIdDroppedFromList', leverKind: 'inputFault', mutate: (scenario) => { scenario.identifierListTransform = (identifierList) => identifierList.filter((oneId) => oneId !== PLANTED_BARE_ID); } });
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-REGISTER', conjunctId: 's_scopeAndSectionsAreTheForges', twinName: 'scopeListLosesOneDeclaration', leverKind: 'inputFault', mutate: (scenario) => { scenario.scopeListTransform = (scopeList) => scopeList.slice(1); } });

	// ------------------------------- B1-UNITS
	const unitsConjunctList = [
		runConjunct({
			conjunctId: 'b1_unitsAreDeclarationBySection',
			title: `(b1) the block holds ${UNIT_COUNT} units over ${SUBJECT_COUNT} subjects, and they equal, unit for unit and instance for instance, the (declaration, section label) groups of the forge's HAS_INSTANCE edges read through the section file`,
			twinNameList: ['partitionRemoved', 'sectionFileByteAltered'],
			shape: pescShape,
			judge: succeeded((runReport, outcome) => {
				const unitList = unitListOf(outcome);
				const subjectCount = new Set(unitList.map((oneUnit) => oneUnit.subjectStableId)).size;
				const equalToForge = JSON.stringify(unitList) === JSON.stringify(expectedUnitList);
				return { pass: unitList.length === UNIT_COUNT && subjectCount === SUBJECT_COUNT && equalToForge, detail: `${unitList.length} units over ${subjectCount} subjects; equal to the forge's groups ${equalToForge} (${expectedUnitList.length} expected)` };
			}),
		}),
		runConjunct({
			conjunctId: 'b2_addressIsFourSectionUnits',
			title: "(b2) ContactsType/Address is four units whose labels are its four readable sections, holding 4, 1, 1 and 1 occurrences, each instance an Address occurrence in that unit's section",
			twinNameList: ['addressOccurrenceMovedSection'],
			shape: pescShape,
			judge: succeeded((runReport, outcome, scenario) => {
				const labelBySectionPath = readSectionLabelBySectionPath(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, SECTION_FILE_NAME), 'utf8'));
				const addressUnitList = unitListOf(outcome).filter((oneUnit) => oneUnit.subjectStableId === ADDRESS_SUBJECT);
				const shapeList = addressUnitList.map((oneUnit) => ({ judgmentPartitionLabel: oneUnit.judgmentPartitionLabel, instanceCount: oneUnit.instanceStableIdList.length }));
				const everyInstanceInItsSection = addressUnitList.every((oneUnit) =>
					oneUnit.instanceStableIdList.every((instanceStableId) => {
						const occurrenceNode = subjectNodeOf(scenario.graph, instanceStableId);
						return instanceStableId.indexOf(`${ADDRESS_SUBJECT}/at/`) === 0 && labelBySectionPath[occurrenceNode.properties.sectionPath] === oneUnit.judgmentPartitionLabel;
					}),
				);
				return { pass: JSON.stringify(shapeList) === JSON.stringify(ADDRESS_UNIT_LITERAL) && everyInstanceInItsSection, detail: `${JSON.stringify(shapeList)}; every instance in its section ${everyInstanceInItsSection}` };
			}),
		}),
		pureConjunct({
			conjunctId: 'b3_liveShapeWidened',
			title: `(b3) the double is live-shaped: ${STRING_SHAPED_SECTION_LIST_COUNT} of the ${SUBJECT_COUNT} subjects carry occurrenceSectionList as a string; widened, each subject's sections are exactly the sections of its units`,
			twinNameList: ['wideningRemoved'],
			judge: (scenario) => {
				const widen = scenario.widenOverride === undefined ? widenedList : scenario.widenOverride;
				const labelBySectionPath = readSectionLabelBySectionPath(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, SECTION_FILE_NAME), 'utf8'));
				const labelListBySubject = expectedUnitList.reduce((soFar, oneUnit) => {
					(soFar[oneUnit.subjectStableId] = soFar[oneUnit.subjectStableId] || []).push(oneUnit.judgmentPartitionLabel);
					return soFar;
				}, {});
				const subjectNodeList = forgedGraph.nodeList.filter((oneNode) => labelListBySubject[oneNode.stableId] !== undefined);
				const stringShapedCount = subjectNodeList.filter((oneNode) => typeof oneNode.properties.occurrenceSectionList === 'string').length;
				const disagreeingList = subjectNodeList.filter((oneNode) => JSON.stringify([].concat(widen(oneNode.properties.occurrenceSectionList)).map((sectionPath) => labelBySectionPath[sectionPath]).sort()) !== JSON.stringify(labelListBySubject[oneNode.stableId].slice().sort()));
				return { pass: subjectNodeList.length === SUBJECT_COUNT && stringShapedCount === STRING_SHAPED_SECTION_LIST_COUNT && disagreeingList.length === 0, detail: `${subjectNodeList.length} subjects; string-shaped ${stringShapedCount}; disagreeing ${disagreeingList.length}${disagreeingList.length ? ` (first ${disagreeingList[0].stableId})` : ''}` };
			},
		}),
	];
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-UNITS', conjunctId: 'b1_unitsAreDeclarationBySection', twinName: 'partitionRemoved', leverKind: 'inputFault', mutate: (scenario) => { scenario.declarationEdit = (bridgeDeclaration) => { delete bridgeDeclaration.judgmentPartition; }; } });
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-UNITS', conjunctId: 'b1_unitsAreDeclarationBySection', twinName: 'sectionFileByteAltered', leverKind: 'inputFault', mutate: (scenario) => { scenario.sectionFileTextTransform = (sectionFileText) => sectionFileText.replace('College Transcript / Student / Person', 'College Transcript / Student / PersoN'); } });
	scenarioTwin({
		registry: twinRegistry,
		gateId: 'B1-UNITS',
		conjunctId: 'b2_addressIsFourSectionUnits',
		twinName: 'addressOccurrenceMovedSection',
		leverKind: 'inputFault',
		mutate: (scenario) => {
			scenario.graphEdit = (graph) => {
				const personOccurrence = graph.nodeList.find((oneNode) => oneNode.stableId.indexOf(`${ADDRESS_SUBJECT}/at/`) === 0 && oneNode.properties.sectionPath === 'CollegeTranscript/Student/Person');
				personOccurrence.properties.sectionPath = 'CollegeTranscript/Student/AcademicRecord';
			};
		},
	});
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-UNITS', conjunctId: 'b3_liveShapeWidened', twinName: 'wideningRemoved', leverKind: 'inputFault', mutate: (scenario) => { scenario.widenOverride = (listOrScalar) => (typeof listOrScalar === 'string' ? listOrScalar.split('') : listOrScalar); } });

	// ------------------------------- B1-EDGES
	const INSTANCE_EXPANSION_FIND = ': oneRecord.instanceStableIdList.map((instanceStableId) => ({ record: oneRecord, fromStableId: instanceStableId, instanceStableId })),';
	const edgesConjunctList = [
		runConjunct({
			conjunctId: 'c_oneEdgePerOccurrence',
			title: `(c) every unit is picked under the debug rule, and the written edges are exactly one per occurrence (${OCCURRENCE_COUNT}), from the occurrence to its unit's card, each naming its declaration as judgedSubjectStableId`,
			twinNameList: ['oneInstanceSkipped'],
			shape: pescShape,
			judge: succeeded((runReport, outcome) => {
				const pickedCount = pickedRecordListOf(outcome).length;
				const writtenLineList = writtenEdgeLineListOf(outcome);
				const expectedLineList = expectedEdgeLineListOf(outcome);
				const fromList = Array.from(new Set(edgesOf(outcome).map((oneEdge) => oneEdge.fromStableId))).sort();
				const pass = pickedCount === UNIT_COUNT && JSON.stringify(writtenLineList) === JSON.stringify(expectedLineList) && JSON.stringify(fromList) === JSON.stringify(occurrenceStableIdList) && runReport.edgesWritten === OCCURRENCE_COUNT;
				return { pass, detail: `${pickedCount} picked; edgesWritten ${runReport.edgesWritten}; distinct from ${fromList.length}; written equals expected ${JSON.stringify(writtenLineList) === JSON.stringify(expectedLineList)}` };
			}),
		}),
		runConjunct({
			conjunctId: 'e_sssomSubjectsArePrefixedOccurrences',
			title: `(e) the run's SSSOM export passes the subject-prefix check: one row per written edge, every subject_id an occurrence stableId beginning '${STANDARD_KEY}:'`,
			twinNameList: ['unprefixedOccurrenceInGraph'],
			shape: pescShape,
			judge: succeeded((runReport, outcome) => {
				const parsed = sssomExporterLib.parseSssomTsv(fs.readFileSync(runReport.sssomExportPath, 'utf8'));
				const subjectList = parsed.error ? [] : Array.from(new Set(parsed.rowList.map((oneRow) => oneRow.subject_id))).sort();
				const rowCount = parsed.error ? 0 : parsed.rowList.length;
				const pass = !parsed.error && rowCount === edgesOf(outcome).length && JSON.stringify(subjectList) === JSON.stringify(occurrenceStableIdList);
				return { pass, detail: parsed.error || `${rowCount} row(s); ${subjectList.length} distinct subject_id, all occurrences ${JSON.stringify(subjectList) === JSON.stringify(occurrenceStableIdList)}` };
			}),
		}),
	];
	frameworkMutationTwin({ registry: twinRegistry, gateId: 'B1-EDGES', conjunctId: 'c_oneEdgePerOccurrence', twinName: 'oneInstanceSkipped', fileName: MATERIALISER_FILE, find: INSTANCE_EXPANSION_FIND, replace: INSTANCE_EXPANSION_FIND.replace('instanceStableIdList.map(', 'instanceStableIdList.slice(1).map(') });
	// the twin forges one Address occurrence WITHOUT the standard's prefix: the exporter must refuse it
	scenarioTwin({
		registry: twinRegistry,
		gateId: 'B1-EDGES',
		conjunctId: 'e_sssomSubjectsArePrefixedOccurrences',
		twinName: 'unprefixedOccurrenceInGraph',
		leverKind: 'inputFault',
		mutate: (scenario) => {
			scenario.graphEdit = (graph) => {
				const renamedFrom = graph.nodeList.find((oneNode) => oneNode.stableId.indexOf(`${ADDRESS_SUBJECT}/at/`) === 0).stableId;
				const renamed = (stableId) => (stableId === renamedFrom ? renamedFrom.replace(`${STANDARD_KEY}:`, '') : stableId);
				graph.nodeList.forEach((oneNode) => {
					oneNode.stableId = renamed(oneNode.stableId);
					oneNode.properties.stableId = renamed(oneNode.properties.stableId);
				});
				graph.edgeList.forEach((oneEdge) => {
					oneEdge.fromStableId = renamed(oneEdge.fromStableId);
					oneEdge.toStableId = renamed(oneEdge.toStableId);
				});
			};
		},
	});

	// ------------------------------- B1-PROMPT
	const promptConjunctList = [
		runConjunct({
			conjunctId: 'd1_oneSectionLinePerPrompt',
			title: `(d1) each of the ${UNIT_COUNT} prompts carries exactly one documentSection line, and the lines equal the units' own labels prompt for prompt (joined by promptHash)`,
			twinNameList: ['sectionPathBlinded'],
			shape: pescShape,
			judge: succeeded((runReport, outcome) => {
				const promptRecordList = promptListOf(outcome);
				const labelByPromptHash = blockOf(outcome).decisionRecordList.reduce((soFar, oneRecord) => {
					soFar[oneRecord.promptHash] = oneRecord.judgmentPartitionLabel;
					return soFar;
				}, {});
				const wrongList = promptRecordList.filter((oneRecord) => {
					const sectionLineList = subjectLineListOf(oneRecord.userPrompt, 'documentSection');
					return sectionLineList.length !== 1 || sectionLineList[0] !== labelByPromptHash[oneRecord.promptHash];
				});
				return { pass: promptRecordList.length === UNIT_COUNT && wrongList.length === 0, detail: `${promptRecordList.length} prompt(s); ${wrongList.length} without exactly their own documentSection line` };
			}),
		}),
		runConjunct({
			conjunctId: 'd2_noPromptNamesTheRelease',
			title: `(d2) no prompt names the release: none carries ${RELEASE_NAMING_TEXT_LIST.map((oneText) => `'${oneText}'`).join(', ')}`,
			twinNameList: ['typeQNameRendered'],
			shape: pescShape,
			judge: succeeded((runReport, outcome) => {
				const promptRecordList = promptListOf(outcome);
				const namingList = promptRecordList.filter((oneRecord) => RELEASE_NAMING_TEXT_LIST.some((oneText) => `${oneRecord.systemPrompt}\n${oneRecord.userPrompt}`.indexOf(oneText) !== -1));
				return { pass: promptRecordList.length === UNIT_COUNT && namingList.length === 0, detail: `${promptRecordList.length} prompt(s); ${namingList.length} naming the release` };
			}),
		}),
		runConjunct({
			conjunctId: 'd3_codeListLinesMeasured',
			title: `(d3) the prompts carrying a codeListName or codeListDocumentation line number ${CODE_LIST_PROMPT_COUNT} (the measured literal; RULING QUIET_ORBIT 2026-10-01 (2))`,
			twinNameList: ['codeListNamePlanted'],
			shape: pescShape,
			judge: succeeded((runReport, outcome) => {
				const promptRecordList = promptListOf(outcome);
				const codeListPromptCount = promptRecordList.filter((oneRecord) => CODE_LIST_PROPERTY_NAME_LIST.some((propertyName) => subjectLineListOf(oneRecord.userPrompt, propertyName).length > 0)).length;
				return { pass: promptRecordList.length === UNIT_COUNT && codeListPromptCount === CODE_LIST_PROMPT_COUNT, detail: `${promptRecordList.length} prompt(s); ${codeListPromptCount} carrying a code-list line` };
			}),
		}),
	];
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-PROMPT', conjunctId: 'd1_oneSectionLinePerPrompt', twinName: 'sectionPathBlinded', leverKind: 'inputFault', mutate: (scenario) => { scenario.declarationEdit = (bridgeDeclaration) => { bridgeDeclaration.blindingDeclaration.push('sectionPath'); }; } });
	scenarioTwin({ registry: twinRegistry, gateId: 'B1-PROMPT', conjunctId: 'd2_noPromptNamesTheRelease', twinName: 'typeQNameRendered', leverKind: 'inputFault', mutate: (scenario) => { scenario.declarationEdit = (bridgeDeclaration) => { bridgeDeclaration.renderingAllowList.subject.push('typeQName'); }; } });
	scenarioTwin({
		registry: twinRegistry,
		gateId: 'B1-PROMPT',
		conjunctId: 'd3_codeListLinesMeasured',
		twinName: 'codeListNamePlanted',
		leverKind: 'inputFault',
		mutate: (scenario) => {
			scenario.graphEdit = (graph) => {
				subjectNodeOf(graph, ADDRESS_SUBJECT).properties.codeListName = 'AddressPlantedCodeList';
			};
		},
	});

	return [
		{ gateId: 'B1-REGISTER', title: 'the PESC derived plugin registers at zero spend; its id list is well-formed and wired into the scan; its scope list and section file are the forge\'s', conjunctList: registerConjunctList },
		{ gateId: 'B1-UNITS', title: 'on the release\'s own forge output, each declaration is judged once per document section, its instances exactly its occurrences there', conjunctList: unitsConjunctList },
		{ gateId: 'B1-EDGES', title: 'each answer is written onto exactly its section\'s occurrences, and the SSSOM export passes the subject-prefix check', conjunctList: edgesConjunctList },
		{ gateId: 'B1-PROMPT', title: 'every prompt states its own section once, names no release, and carries the code-list lines the forge stamps', conjunctList: promptConjunctList },
	];
};

// ---------------------------------------------------------------------
// forge the release once (pinned snapshot, no embedding), then run the family
// ---------------------------------------------------------------------
const descriptorValueByName = rosterLib.readDescriptorSection(path.join(BUNDLE_DIR, rosterLib.DESCRIPTOR_FILE_NAME)).valueByName;
require(path.join(BUNDLE_DIR, descriptorValueByName.entryModule))({ embedder: null }).forge({ sourcePath: path.join(BUNDLE_DIR, 'assets', 'standardSourceData', descriptorValueByName.defaultSnapshot), owner: moduleName, skipEmbedding: true }, (forgeError, forged) => {
	if (forgeError) {
		harness.fail(`the forge of ${STANDARD_KEY} refused: ${forgeError}`);
		harness.report();
		return;
	}
	const scopeStableIdSet = new Set(JSON.parse(fs.readFileSync(path.join(SHIPPED_BRIDGES_DIR, SCOPE_LIST_FILE_NAME), 'utf8')));
	const gateDeclarationList = buildGateDeclarationList(forgedGraphToDouble({ forged, scopeStableIdSet }));
	runGateFamily(
		{ harness, familyName: 'B1-REGISTER+B1-UNITS+B1-EDGES+B1-PROMPT', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 12 },
		() => harness.report(),
	);
});
