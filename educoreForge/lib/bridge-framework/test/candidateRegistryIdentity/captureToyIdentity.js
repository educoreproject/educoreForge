#!/usr/bin/env node
'use strict';

// captureToyIdentity.js — the lane C IDENTITY INSTRUMENT (DESIGN-C-candidateRegistry.md §6 P1). It runs the toy
// derived bridge through the FULL framework of ONE tree, under the debug judge, once per retrieval method shape, and
// writes everything a run produces that a judge or a reader could ever see: the frozen decision-block text, every
// match-forensics record (the rendered prompts are in there), every written edge and the run report.
//
// It exists to compare TWO trees (the base commit and the branch), so it loads that tree's framework by --treeRoot
// rather than by its own location. The one value the candidate-registry move is ALLOWED to change is the
// frameworkFingerprint, and through it every block id; both are replaced by tokens before writing, and NOTHING ELSE is
// normalised. A byte the comparison does not expect therefore shows up as a difference rather than being explained away.
//
// The embedText shapes repeat test-bgDerived.js's toy (its graph and declaration, copied, not required: that file is a
// suite, not a library). The copy is the same bytes in both trees' runs, because this file runs both.
//
// Run: node captureToyIdentity.js --treeRoot=<an educoreForge directory> --outputFilePath=<json>

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const argumentValueOf = (argumentName) => {
	const prefix = `--${argumentName}=`;
	const matched = process.argv.find((oneArgument) => oneArgument.startsWith(prefix));
	return matched === undefined ? undefined : matched.slice(prefix.length);
};
const treeRoot = argumentValueOf('treeRoot');
const outputFilePath = argumentValueOf('outputFilePath');
if (typeof treeRoot !== 'string' || !fs.existsSync(path.join(treeRoot, 'lib', 'bridge-framework', 'bridge-framework.js'))) {
	process.stderr.write(`${moduleName}: --treeRoot must name an educoreForge directory holding lib/bridge-framework (got ${JSON.stringify(treeRoot)})\n`);
	process.exit(1);
}
if (typeof outputFilePath !== 'string' || outputFilePath === '') {
	process.stderr.write(`${moduleName}: --outputFilePath is required\n`);
	process.exit(1);
}

// process.global (xLog, getConfig) bootstrapped the way every suite in THAT tree does it
require(path.join(treeRoot, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText: `${moduleName} --treeRoot=<educoreForge dir> --outputFilePath=<json>` });

const frameworkDir = path.join(treeRoot, 'lib', 'bridge-framework');
const scenarioLib = require(path.join(frameworkDir, 'test', 'testSupport', 'toyBridgeScenario'));
const toyEmbedTextBoltGraphLib = require(path.join(frameworkDir, 'test', 'testSupport', 'toyEmbedTextBoltGraph'));
const decisionBlockLib = require(path.join(frameworkDir, 'decisionBlock'));
const vocabularyLib = require(path.join(treeRoot, 'lib', 'vocabulary', 'vocabulary'));

const { DME_ROLES, EDGE_TYPES, EMBED_TEXT_VECTOR } = vocabularyLib;
const cloneJson = scenarioLib.cloneJson;
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const TOY_EMBED_MODEL = 'toy-embed-v1';

// ---------------------------------------------------------------------------------------------------------
// the shapes — derivedShape and the embedText toy, as test-bgDerived.js builds them
// ---------------------------------------------------------------------------------------------------------
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
const overrideDerivedDeclaration = (scenario, mutate) => {
	const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`));
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { ...(scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] || {}), bridgeDeclaration };
};

const EMBED_TEXT_HUB_NAME = toyEmbedTextBoltGraphLib.HUB_NAME;
const EMBED_TEXT_SOURCE_STANDARD_NAME = toyEmbedTextBoltGraphLib.SOURCE_STANDARD_NAME;
const SUBJECT_LABEL = 'ToyProperty';
const OWNER_PROPERTY_NAME = 'parentId';
const NEIGHBOUR_VOTE_DECLARATION = Object.freeze({ method: 'neighbourVote-v1', owner: { kind: 'propertyValue', property: OWNER_PROPERTY_NAME }, siblings: { kind: 'sameOwner' }, referencedObject: { kind: 'edgeTarget', edgeTypeList: [EDGE_TYPES.REFERENCES] }, earnRule: 'topShare' });
const embedTextRetrievalFor = (neighbourVote) => ({ method: 'embedTextVote-v1', hitsPerText: 3, minScore: 0.3, k: 4, embeddingModelVersion: TOY_EMBED_MODEL, neighbourVote: cloneJson(neighbourVote) });
const CARD_VECTOR_BY_CARD_STABLE_ID = Object.freeze({
	'toyhub:card/P000001.C1': [1, 0, 0, 0],
	'toyhub:card/P000002.C1': [0.2, 1, 0, 0],
	'toyhub:card/P000002.C2': [0, 1, 0, 0.3],
	'toyhub:card/P000003.C1': [0.5, 0, 0, 0.5],
	'toyhub:card/P000005.C1': [0.7, 0, 0, 0.7],
	'toyhub:card/P000005.C1.OV0001': [0.6, 0, 0, 0.8],
	'toyhub:card/P000006.C1': [0, 0, 1, 0],
	'toyhub:card/P000008.C3': [0, 0, 0.2, 1],
	'toyhub:card/P000010.C1': [0, 0.3, 1, 0],
});
const HUB_TEXT_LIST = Object.freeze([
	{ textName: 'hName', vector: [1, 0, 0, 0], describedStableIdList: ['toyhub:property/P000001', 'toyhub:property/P000005'] },
	{ textName: 'hBirthDate', vector: [0, 1, 0, 0], describedStableIdList: ['toyhub:property/P000002'] },
	{ textName: 'hCourse', vector: [0, 0, 1, 0], describedStableIdList: ['toyhub:property/P000006', 'toyhub:property/P000010'] },
	{ textName: 'hLearnerClass', vector: [0.6, 0.8, 0, 0], describedStableIdList: ['toyhub:class/C1'] },
	{ textName: 'hOrganization', vector: [0, 0, 0, 1], describedStableIdList: ['toyhub:class/C3', 'toyhub:property/P000008'] },
	{ textName: 'hEthnicity', vector: [0.7, 0, 0, 0.7], describedStableIdList: ['toyhub:optionSet/Ethnicity', 'toyhub:property/P000003'] },
	{ textName: 'hOptionValue', vector: [1, 0, 0, 0], describedStableIdList: ['toyhub:optionValue/OV0001'] },
]);
const SUBJECT_TEXT_VECTOR_BY_STABLE_ID = Object.freeze({
	'toy:property/Student.FirstName': [0.9, 0.1, 0, 0],
	'toy:property/Student.BirthDate': [0.1, 0.9, 0, 0],
	'toy:property/Student.Ethnicity': [0.6, 0, 0, 0.6],
	'toy:property/School.Name': [0.7, 0, 0, 0.6],
	'toy:property/School.Address': [0, 0, 0.1, 1],
	'toy:property/Course.Title': [0, 0, 1, 0],
	'toy:property/Course.Credits': [0, 0.2, 0.9, 0],
});
const DEFAULT_SUBJECT_TEXT_VECTOR_BY_CONSTRUCT_NAME = Object.freeze({ Student: [0.6, 0.6, 0, 0], School: [0.1, 0, 0, 1], Course: [0, 0.1, 1, 0.1] });
const OWNER_TEXT_VECTOR_BY_STABLE_ID = Object.freeze({ 'toy:construct/Student': [0.6, 0.8, 0, 0], 'toy:construct/School': [0, 0, 0, 1], 'toy:construct/Course': [0, 0, 1, 0] });
const REFERENCE_EDGE_LIST = Object.freeze([{ fromStableId: 'toy:property/Course.Level', toStableId: 'toy:construct/School' }]);

const embedTextNode = ({ stableId, standardName, vector }) => ({
	stableId,
	labels: ['ForgedNode', 'ToyEmbedText', DME_ROLES.EMBED_TEXT],
	properties: { stableId, text: `toy text ${stableId}`, role: DME_ROLES.EMBED_TEXT, _source: standardName, [EMBED_TEXT_VECTOR.propertyName]: vector.slice(), embeddingModelVersion: TOY_EMBED_MODEL, embedSourceProperty: 'text', vectorPropertyName: EMBED_TEXT_VECTOR.propertyName },
});
const embedTextEdge = ({ textStableId, describedStableId }) => ({ fromStableId: textStableId, toStableId: describedStableId, type: EDGE_TYPES.EMBEDS_TEXT_OF, properties: { propertyNameList: 'description', provenanceTier: 'structural' } });

const embedTextGraph = () => {
	const baseGraph = toyEmbedTextBoltGraphLib.embedTextBoltGraph();
	const nodeList = baseGraph.nodeList
		.filter((oneNode) => oneNode.properties.role !== DME_ROLES.EMBED_TEXT)
		.map((oneNode) => {
			const properties = { ...oneNode.properties };
			if (CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId] !== undefined) {
				properties.embedding = CARD_VECTOR_BY_CARD_STABLE_ID[oneNode.stableId].slice();
			}
			if (properties.embedding !== undefined) {
				properties.embeddingModelVersion = TOY_EMBED_MODEL;
			}
			if (oneNode.labels.indexOf(SUBJECT_LABEL) !== -1) {
				properties[OWNER_PROPERTY_NAME] = `toy:construct/${properties.owningConstructName}`;
			}
			return { ...oneNode, properties };
		});
	const edgeList = baseGraph.edgeList.filter((oneEdge) => oneEdge.type !== EDGE_TYPES.EMBEDS_TEXT_OF).concat(REFERENCE_EDGE_LIST.map((oneEdge) => ({ ...oneEdge, type: EDGE_TYPES.REFERENCES, properties: { provenanceTier: 'structural' } })));
	HUB_TEXT_LIST.forEach((oneText) => {
		const textStableId = `toyhub:root/embedText/${oneText.textName}`;
		nodeList.push(embedTextNode({ stableId: textStableId, standardName: EMBED_TEXT_HUB_NAME, vector: oneText.vector }));
		oneText.describedStableIdList.forEach((oneDescribedStableId) => edgeList.push(embedTextEdge({ textStableId, describedStableId: oneDescribedStableId })));
	});
	const sourceTextStableIdSet = new Set();
	const addSourceText = ({ textStableId, vector, describedStableId }) => {
		if (!sourceTextStableIdSet.has(textStableId)) {
			sourceTextStableIdSet.add(textStableId);
			nodeList.push(embedTextNode({ stableId: textStableId, standardName: EMBED_TEXT_SOURCE_STANDARD_NAME, vector }));
		}
		edgeList.push(embedTextEdge({ textStableId, describedStableId }));
	};
	nodeList
		.filter((oneNode) => oneNode.labels.indexOf(SUBJECT_LABEL) !== -1)
		.forEach((oneSubject) => {
			const override = SUBJECT_TEXT_VECTOR_BY_STABLE_ID[oneSubject.stableId];
			const constructName = oneSubject.properties.owningConstructName;
			addSourceText(override !== undefined ? { textStableId: `toy:root/embedText/${oneSubject.stableId}`, vector: override, describedStableId: oneSubject.stableId } : { textStableId: `toy:root/embedText/default${constructName}`, vector: DEFAULT_SUBJECT_TEXT_VECTOR_BY_CONSTRUCT_NAME[constructName], describedStableId: oneSubject.stableId });
		});
	Object.keys(OWNER_TEXT_VECTOR_BY_STABLE_ID).forEach((oneOwnerStableId) => addSourceText({ textStableId: `toy:root/embedText/${oneOwnerStableId}`, vector: OWNER_TEXT_VECTOR_BY_STABLE_ID[oneOwnerStableId], describedStableId: oneOwnerStableId }));
	return { nodeList, edgeList };
};
const embedTextShapeFor = (neighbourVote) => (scenario) => {
	derivedShape(scenario);
	scenario.graph = embedTextGraph();
	overrideDerivedDeclaration(scenario, (declaration) => {
		declaration.candidateRetrieval = embedTextRetrievalFor(neighbourVote);
	});
};
// two subjects with NO pool: one textless, one whose only text points away from every hub text
const withoutPoolShape = (scenario) => {
	const poollessStableIdList = ['toy:property/Student.Nothing', 'toy:property/Student.Nothing2'];
	scenario.graph.edgeList = scenario.graph.edgeList.filter((oneEdge) => !(oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF && poollessStableIdList.indexOf(oneEdge.toStableId) !== -1));
	const unadmittedTextStableId = 'toy:root/embedText/toy:property/Student.Nothing2';
	scenario.graph.nodeList.push(embedTextNode({ stableId: unadmittedTextStableId, standardName: EMBED_TEXT_SOURCE_STANDARD_NAME, vector: [0, 0, 0, -1] }));
	scenario.graph.edgeList.push(embedTextEdge({ textStableId: unadmittedTextStableId, describedStableId: 'toy:property/Student.Nothing2' }));
};

// the scenario list: every retrieval method and both neighbour scorings, with the empty-pool route
const SHAPE_LIST = Object.freeze([
	{ shapeName: 'cosineTopK-v1', shape: derivedShape },
	{ shapeName: 'embedTextVote-v1 neighbourVote-v1', shape: embedTextShapeFor(NEIGHBOUR_VOTE_DECLARATION) },
	{ shapeName: 'embedTextVote-v1 votesOnly', shape: embedTextShapeFor(null) },
	{ shapeName: 'embedTextVote-v1 votesOnly withoutPool', shape: (scenario) => { embedTextShapeFor(null)(scenario); withoutPoolShape(scenario); } },
	{ shapeName: 'embedTextVote-v1 neighbourVote-v1 withoutPool', shape: (scenario) => { embedTextShapeFor(NEIGHBOUR_VOTE_DECLARATION)(scenario); withoutPoolShape(scenario); } },
]);

// observedRunOf — everything one run produced that anyone could see, as plain data
const observedRunOf = (outcome) =>
	outcome === undefined
		? null
		: {
				runError: outcome.runError === undefined ? null : outcome.runError,
				constructionError: outcome.constructionError === undefined ? null : outcome.constructionError,
				thrownFromRun: outcome.thrownFromRun === undefined ? null : outcome.thrownFromRun,
				runReport: outcome.runReport === undefined ? null : cloneJson(outcome.runReport),
				frozenTextList: outcome.stores ? outcome.stores.decisionStore.rowList.map((oneRow) => oneRow.frozenText) : [],
				matchForensicsRecordList: outcome.stores ? cloneJson(outcome.stores.matchForensics.recordList) : [],
				writtenEdgeList: outcome.graphDouble ? cloneJson(outcome.graphDouble.state.writtenEdgeList) : [],
			};

const taskList = new taskListPlus();
SHAPE_LIST.forEach((oneShape) => {
	taskList.push((args, next) => {
		const scenario = scenarioLib.makeScenario();
		oneShape.shape(scenario);
		scenarioLib.runRejudgeThenMaterialise(scenario, (unusedError, pairOutcome) => {
			next('', { ...args, captureList: args.captureList.concat([{ shapeName: oneShape.shapeName, rejudge: observedRunOf(pairOutcome.first), materialise: observedRunOf(pairOutcome.second) }]) });
		});
	});
});

pipeRunner(taskList.getList(), { captureList: [] }, (pipelineError, args) => {
	if (pipelineError) {
		process.stderr.write(`${moduleName}: ${pipelineError}\n`);
		process.exit(1);
	}
	// THE NORMALISATIONS, all four named: every edge matchId that RECOMPUTES from its block id (above), the fingerprint,
// every block id (each is a hash over text that carries it), and the toy forensics double's mkdtemp directory name
	const frameworkFingerprint = decisionBlockLib.frameworkFingerprint();
	const blockIdList = [];
	const collectBlockIds = (value) => {
		if (Array.isArray(value)) {
			value.forEach(collectBlockIds);
			return;
		}
		if (value !== null && typeof value === 'object') {
			Object.keys(value).forEach((onePropertyName) => {
				if (/decisionBlockHash|decisionBlockId|blockId/i.test(onePropertyName) && typeof value[onePropertyName] === 'string' && blockIdList.indexOf(value[onePropertyName]) === -1) {
					blockIdList.push(value[onePropertyName]);
				}
				collectBlockIds(value[onePropertyName]);
			});
		}
	};
	collectBlockIds(args.captureList);
	args.captureList.forEach((oneCapture) =>
		['rejudge', 'materialise'].forEach((onePhaseName) => {
			const phase = oneCapture[onePhaseName];
			if (phase !== null) {
				phase.frozenTextList.forEach((oneFrozenText) => collectBlockIds(JSON.parse(oneFrozenText)));
			}
		}),
	);
	// an edge's matchId is sha256(decisionBlockHash, subject, predicate, object) (materialiser.js), so it moves with the
	// block id. It is replaced by a token ONLY when it RECOMPUTES from those four here; one that does not stays raw, and
	// shows up as a difference.
	let verifiedMatchIdCount = 0;
	args.captureList.forEach((oneCapture) =>
		['rejudge', 'materialise'].forEach((onePhaseName) => {
			const phase = oneCapture[onePhaseName];
			(phase === null ? [] : phase.writtenEdgeList).forEach((oneEdge) => {
				const edgeProperties = oneEdge.properties || {};
				const recomputedMatchId = crypto.createHash('sha256').update(`${edgeProperties.decisionBlockHash}\n${oneEdge.fromStableId}\n${edgeProperties.predicate}\n${oneEdge.toStableId}`, 'utf8').digest('hex');
				if (typeof edgeProperties.matchId === 'string' && edgeProperties.matchId === recomputedMatchId) {
					edgeProperties.matchId = '<MATCH_ID recomputed from the block id>';
					verifiedMatchIdCount += 1;
				}
			});
		}),
	);
	let capturedText = JSON.stringify({ captureList: args.captureList }, null, '\t');
	capturedText = capturedText.split(frameworkFingerprint).join('<FRAMEWORK_FINGERPRINT>');
	blockIdList.forEach((oneBlockId, blockIndex) => {
		capturedText = capturedText.split(oneBlockId).join(`<BLOCK_ID_${blockIndex}>`);
	});
	// and the scratch directory the toy's forensics double makes with mkdtemp (a harness path, not framework output)
	capturedText = capturedText.replace(/toyBridgeForensics-[A-Za-z0-9]{6}/g, 'toyBridgeForensics-<SCRATCH>');
	fs.writeFileSync(outputFilePath, capturedText);
	const summaryList = args.captureList.map((oneCapture) => `${oneCapture.shapeName}: rejudge ${oneCapture.rejudge && (oneCapture.rejudge.runError || oneCapture.rejudge.constructionError || oneCapture.rejudge.thrownFromRun) ? `REFUSED ${String(oneCapture.rejudge.runError || oneCapture.rejudge.constructionError || oneCapture.rejudge.thrownFromRun).slice(0, 160)}` : 'ran'}, ${oneCapture.rejudge ? oneCapture.rejudge.matchForensicsRecordList.length : 0} forensics record(s), materialise ${oneCapture.materialise === null ? 'not run' : oneCapture.materialise.runError ? 'REFUSED' : `${oneCapture.materialise.writtenEdgeList.length} edge(s)`}`);
	process.stdout.write(`${moduleName}: fingerprint ${frameworkFingerprint}; ${blockIdList.length} block id(s) tokenised; ${verifiedMatchIdCount} matchId(s) recomputed and tokenised\n${summaryList.join('\n')}\nwrote ${outputFilePath}\n`);
});
