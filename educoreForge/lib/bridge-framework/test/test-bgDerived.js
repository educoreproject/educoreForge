#!/usr/bin/env node
'use strict';

// test-bgDerived.js — the DERIVED families (PLAN-derivedBridge-v1.md §8; RULINGS §11.3, §11.4, §11.9,
// §11.10, §11.12). Every conjunct runs hermetically over the toy graph through toyDerivedPlugin under the
// DEBUG judge: no container, no network, no Opus, no spend.
//
//   BG-RETRIEVAL       (a) every pool is ≤ K; (b) every seat's cosine is ≥ the declared floor; (c) the pool
//                      reaches the judge in stableId order — the retrieval RANK never survives into the
//                      rendered text; (d) no rendered prompt contains a cosine or a rank; (e) a floor above
//                      the achievable maximum EMPTIES every pool and yields orphan(noCandidate) rather than
//                      an error, and the renderer is never called on an empty pool.
//   BG-BLIND-DERIVED   (a) POSITIVE — every property line of every rendered prompt names an ALLOW-LISTED
//                      property and nothing else; (b) NEGATIVE — the id-gate regex sweep over every prompt is
//                      at ZERO; (c) an allow-list naming a NEVER property is refused at declaration time.
//   BG-DERIVED-CENSUS  judged + orphan == subjectCount per subject, and `abstained` is a per-TARGET member
//                      inside a judged subject — never a subject bucket (RULING BF8 stands, §11.10).
//   BG-NOCROSSWALK     the derived producer declares no channel, opens no document, and its run reports an
//                      EMPTY sourceChannelDigestByKey — it cannot have read the authored crosswalk because it
//                      never opened a file at all.
//   BG-PARTIAL         a block frozen from a --limit WINDOW refuses to materialise under a run that is not
//                      carrying the same window (§11.12) — ten edges must never ship as a graph.
//
// Run: node lib/bridge-framework/test/test-bgDerived.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-RETRIEVAL + BG-BLIND-DERIVED + BG-DERIVED-CENSUS + BG-NOCROSSWALK + BG-PARTIAL

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, succeeded, refusalCase, frameworkMutationTwin, scenarioTwin, forensicsOf, blockOf, edgesOf } = require('./testSupport/bridgeTwinFactories');
const graphSeamRulesLib = require('../graphSeamRules');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const RETRIEVAL_FILE = 'candidateRetrieval.js';
const RENDERER_FILE = 'evidenceRenderer.js';
const FRAMEWORK_FILE = 'bridge-framework.js';
const CONTRACT_FILE = 'bridgePluginContract.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const cloneJson = scenarioLib.cloneJson;

// derivedShape — every conjunct in this file starts here. The toy graph carries embeddings but no
// embeddingModelVersion, and candidateRetrieval REFUSES a record whose model is not the declared one, so the
// declared model is stamped onto every vector-bearing node. That is a SCENARIO edit, not a fixture edit: the
// shared toyGraph is left alone so the other eleven families keep the inputs they were frozen against.
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

const declaredRetrievalOf = () => require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration.candidateRetrieval;
const declaredAllowListOf = () => require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration.renderingAllowList;

const promptListOf = (outcome) => forensicsOf(outcome).filter((oneRecord) => oneRecord.record && typeof oneRecord.record.userPrompt === 'string').map((oneRecord) => oneRecord.record.userPrompt);
const judgedRecordListOf = (outcome) => {
	const block = blockOf(outcome);
	return block && Array.isArray(block.decisionRecordList) ? block.decisionRecordList : [];
};

// THE ID GATE (§4 as amended by RULING §11.4). The pattern list is NOT defined here: it is required FROM the
// rendering-audit generator, which is the document a human signs. Two copies of this list would be two
// different audits wearing one name — the gate could pass while the document swept for something else.
const { ID_GATE_PATTERN_LIST } = require(path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'test', 'bridgeAcceptance', 'renderingAudit'));
const idGateHitList = (promptList) =>
	ID_GATE_PATTERN_LIST.reduce(
		(soFar, onePattern) => soFar.concat(promptList.filter((onePrompt) => onePattern.regex.test(onePrompt)).map((onePrompt) => `${onePattern.patternName}: ${onePrompt.slice(0, 60)}`)),
		[],
	);
// renderedPropertyNameList — the property names actually printed in a prompt's indented "name: value" lines
const renderedPropertyNameList = (onePrompt) =>
	onePrompt
		.split('\n')
		.map((oneLine) => /^\s+([A-Za-z_][A-Za-z0-9_]*):/.exec(oneLine))
		.filter((oneMatch) => oneMatch !== null)
		.map((oneMatch) => oneMatch[1]);

// ---------------------------------------------------------------------
// BG-RETRIEVAL
// ---------------------------------------------------------------------
const retrievalConjunctList = [
	runConjunct({
		conjunctId: 'a_poolNeverExceedsK',
		title: 'every retrieved pool holds at most the declared K candidates',
		twinNameList: ['ignoreKCeiling'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const { k } = declaredRetrievalOf();
			const recordList = judgedRecordListOf(outcome).filter((oneRecord) => Array.isArray(oneRecord.retrievalSeatList));
			const over = recordList.filter((oneRecord) => oneRecord.retrievalSeatList.length > k);
			return { pass: recordList.length > 0 && over.length === 0, detail: `${recordList.length} retrieved record(s), ${over.length} over K=${k}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_everySeatIsAtOrAboveTheFloor',
		title: "every seat's cosine is at or above the declared floor — the floor is a threshold, not a preference",
		twinNameList: ['ignoreFloor'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const { floor } = declaredRetrievalOf();
			const seatList = judgedRecordListOf(outcome).reduce((soFar, oneRecord) => soFar.concat(Array.isArray(oneRecord.retrievalSeatList) ? oneRecord.retrievalSeatList : []), []);
			const below = seatList.filter((oneSeat) => oneSeat.cosine < floor);
			return { pass: seatList.length > 0 && below.length === 0, detail: `${seatList.length} seat(s), ${below.length} below floor=${floor}` };
		}),
	}),
	runConjunct({
		conjunctId: 'c_poolReachesTheJudgeInStableIdOrder',
		title: 'the pool reaches the judge sorted by stableId — the retrieval RANK never survives into the rendered order',
		twinNameList: ['renderInRankOrder'],
		shape: derivedShape,
		// READ FROM FORENSICS, NOT THE BLOCK. decisionBlock canonicalises every member of
		// STABLE_ID_LIST_KEY_LIST — renderedPoolStableIdList among them — by SORTING it, precisely so the frozen
		// text is order-free. The block therefore cannot witness rendered order: it is sorted there whatever the
		// renderer did. The forensic record holds the list as the judge actually saw it.
		judge: succeeded((runReport, outcome) => {
			const orderList = forensicsOf(outcome)
				.filter((oneRecord) => oneRecord.record && Array.isArray(oneRecord.record.renderedPoolStableIdList) && oneRecord.record.renderedPoolStableIdList.length > 1)
				.map((oneRecord) => oneRecord.record.renderedPoolStableIdList);
			const unsorted = orderList.filter((oneOrder) => JSON.stringify(oneOrder) !== JSON.stringify(oneOrder.slice().sort()));
			return { pass: orderList.length > 0 && unsorted.length === 0, detail: `${orderList.length} multi-seat prompt(s), ${unsorted.length} not in stableId order` };
		}),
	}),
	runConjunct({
		conjunctId: 'd_noCosineOrRankIsEverRendered',
		title: 'no rendered prompt carries a cosine or a retrieval rank — they are forensics, never evidence',
		twinNameList: ['renderTheCosine'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const promptList = promptListOf(outcome);
			const leaked = promptList.filter((onePrompt) => /cosine|similarity score|\brank\b/i.test(onePrompt));
			return { pass: promptList.length > 0 && leaked.length === 0, detail: `${promptList.length} prompt(s), ${leaked.length} naming a cosine or rank` };
		}),
	}),
	runConjunct({
		conjunctId: 'e_floorAboveTheMaximumEmptiesEveryPoolAsNoCandidate',
		title: 'a floor above the achievable maximum empties every pool → orphan(noCandidate), and the renderer is never called',
		twinNameList: ['emptyPoolStillJudged'],
		shape: (scenario) => {
			derivedShape(scenario);
			// The floor cannot simply be raised out of reach: candidateRetrieval refuses a floor outside [-1, 1]
			// by name, and it is right to — a "floor" of 1.5 is not a strict threshold, it is a number that is not
			// a cosine. So the SUBJECTS are given the ANTIPARALLEL vector instead: cosine -1 against every card,
			// below any lawful floor, and deterministic because every other toy vector is identical.
			scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
				oneNode.labels.indexOf('ToyProperty') === -1 || oneNode.properties.embedding === undefined
					? oneNode
					: { ...oneNode, properties: { ...oneNode.properties, embedding: oneNode.properties.embedding.map((oneValue) => -oneValue) } },
			);
		},
		judge: succeeded((runReport, outcome) => {
			const recordList = judgedRecordListOf(outcome);
			const orphanList = recordList.filter((oneRecord) => oneRecord.classification === 'orphan' && oneRecord.reason === 'noCandidate');
			const promptList = promptListOf(outcome);
			return {
				pass: recordList.length > 0 && orphanList.length === recordList.length && promptList.length === 0,
				detail: `${orphanList.length}/${recordList.length} orphan(noCandidate); ${promptList.length} prompt(s) rendered (must be 0)`,
			};
		}),
	}),
];

// ---------------------------------------------------------------------
// BG-BLIND-DERIVED
// ---------------------------------------------------------------------
const blindConjunctList = [
	runConjunct({
		conjunctId: 'a_renderedPropertiesAreOnlyTheAllowListed',
		title: 'POSITIVE: every property line of every rendered prompt names an ALLOW-LISTED property and nothing else',
		twinNameList: ['renderOutsideTheAllowList'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const allowList = declaredAllowListOf();
			const permitted = new Set(allowList.subject.concat(allowList.candidate));
			const promptList = promptListOf(outcome);
			const outsideList = promptList.reduce((soFar, onePrompt) => soFar.concat(renderedPropertyNameList(onePrompt).filter((oneName) => !permitted.has(oneName))), []);
			return { pass: promptList.length > 0 && outsideList.length === 0, detail: `${promptList.length} prompt(s); outside the allow-list: ${Array.from(new Set(outsideList)).join(', ') || 'none'}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_idGateSweepIsAtZeroOverEveryPrompt',
		title: 'NEGATIVE: the id-gate regex sweep over EVERY rendered prompt is at zero',
		twinNameList: ['renderOutsideTheAllowList'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const promptList = promptListOf(outcome);
			const hitList = idGateHitList(promptList);
			return { pass: promptList.length > 0 && hitList.length === 0, detail: `${promptList.length} prompt(s), ${hitList.length} hit(s)${hitList.length ? `: ${hitList.slice(0, 2).join(' | ')}` : ''}` };
		}),
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-BLIND-DERIVED',
		conjunctId: 'c_allowListNamingANeverPropertyIsRefused',
		title: 'an allow-list naming a NEVER property is refused BY NAME at declaration time — the audit cannot be opted out of',
		shape: (scenario) => {
			derivedShape(scenario);
			overrideDerivedDeclaration(scenario, (declaration) => {
				declaration.renderingAllowList = { ...declaration.renderingAllowList, candidate: declaration.renderingAllowList.candidate.concat(['canonicalKey']) };
			});
		},
		regex: /renderingAllowList\.candidate names 'canonicalKey', which is on RENDERING_NEVER_NAME_LIST/,
		twinName: 'allowNeverNames',
		fileName: CONTRACT_FILE,
		find: '\t\t\tconst forbidden = value[oneSide].find((oneName) => RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1);',
		replace: '\t\t\tconst forbidden = undefined; void RENDERING_NEVER_NAME_LIST;',
	}),
	// ⟪H-1, adversarial review D4 2026-08-17⟫ The reviewer neutered renderedBlockRefusal and bgDerived, bgBlind
	// and bgDecl ALL STAYED GREEN. The comment beside that function says it "has to be able to catch me being
	// wrong"; nothing tested whether it could.
	//
	// The honest test is the one the function claims to be: a SECOND net. So the FIRST net — the declaration
	// validator that refuses a NEVER name in the allow-list — is DELIBERATELY BYPASSED here, a NEVER name is put
	// into the allow-list, and the RENDERER must catch the leak in the bytes it produced. A conjunct that merely
	// re-tested the first net would have left this exactly as unproven as it was.
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-BLIND-DERIVED',
		conjunctId: 'd_theSecondNetCatchesALeakTHEFIRSTNETWasBypassedFor',
		title: 'with the DECLARATION net bypassed, a NEVER property reaching the rendered bytes is refused BY THE RENDERER — the second net catches what the first net was made to miss',
		shape: (scenario) => {
			derivedShape(scenario);
			// bypass net #1 (bridgePluginContract's allow-list validation) so the leak can actually reach the renderer
			scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), find: '\t\t\tconst forbidden = value[oneSide].find((oneName) => RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1);', replace: '\t\t\tconst forbidden = undefined; void RENDERING_NEVER_NAME_LIST;' });
			overrideDerivedDeclaration(scenario, (declaration) => {
				declaration.renderingAllowList = { ...declaration.renderingAllowList, candidate: declaration.renderingAllowList.candidate.concat(['canonicalKey']) };
			});
		},
		regex: /the rendered prompt carries property 'canonicalKey', which is on RENDERING_NEVER_NAME_LIST/,
		twinName: 'secondNetRemoved',
		fileName: RENDERER_FILE,
		find: '\tconst leaked = renderedNameList.find((oneName) => RENDERING_NEVER_NAME_LIST.indexOf(oneName) !== -1);',
		replace: '\tconst leaked = undefined; void renderedNameList;',
	}),
];

// ---------------------------------------------------------------------
// BG-DERIVED-CENSUS
// ---------------------------------------------------------------------
const censusConjunctList = [
	runConjunct({
		conjunctId: 'a_judgedPlusOrphanEqualsSubjectCount',
		title: 'per SUBJECT: judged + orphan == subjectCount (RULING BF8 stands — no new subject bucket)',
		twinNameList: ['dropJudgedFromSubjectCount'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const perSubject = runReport.counts.cardinalityCensus.perSubject;
			const sum = perSubject.judgedSubjectCount + perSubject.orphanSubjectCount;
			return { pass: perSubject.subjectCount > 0 && sum === perSubject.subjectCount && perSubject.specifiedSubjectCount === 0, detail: `judged ${perSubject.judgedSubjectCount} + orphan ${perSubject.orphanSubjectCount} = ${sum} vs subjectCount ${perSubject.subjectCount}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_abstainedIsAPerTargetMemberNeverASubjectBucket',
		title: "`abstained` is counted per TARGET inside a judged subject and appears in NO subject bucket",
		twinNameList: ['abstainedAsSubjectBucket'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const census = runReport.counts.cardinalityCensus;
			const subjectBucketNameList = Object.keys(census.perSubject);
			return {
				pass: census.perTarget.abstainedCount > 0 && subjectBucketNameList.every((oneName) => !/abstain/i.test(oneName)),
				detail: `perTarget.abstainedCount ${census.perTarget.abstainedCount}; subject buckets ${subjectBucketNameList.join(', ')}`,
			};
		}),
	}),
];

// ---------------------------------------------------------------------
// BG-NOCROSSWALK
// ---------------------------------------------------------------------
const noCrosswalkConjunctList = [
	runConjunct({
		conjunctId: 'a_theProducerOpensNoDocumentAtAll',
		title: 'the derived producer declares no channel and reports an EMPTY sourceChannelDigestByKey — it cannot have read an authored crosswalk because it opened no file',
		twinNameList: ['derivedDeclaresAChannel'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const digestByKey = block && block.header ? block.header.sourceChannelDigestByKey : undefined;
			return { pass: digestByKey !== undefined && Object.keys(digestByKey).length === 0, detail: `sourceChannelDigestByKey = ${JSON.stringify(digestByKey)}` };
		}),
	}),
];

// ---------------------------------------------------------------------
// BG-PARTIAL
// ---------------------------------------------------------------------
const partialConjunctList = [
	runConjunct({
		conjunctId: 'a_windowedRunMarksItsBlockPartial',
		title: 'a --limit run marks its frozen block with the PARTIAL window, so incompleteness is legible in the block itself',
		twinNameList: ['unmarkedWindow'],
		shape: (scenario) => {
			derivedShape(scenario);
			scenario.spec.config = { ...scenario.spec.config, limit: 3, offset: 0 };
		},
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const windowMark = block && block.header ? block.header.sourceWindow : undefined;
			return { pass: typeof windowMark === 'string' && /PARTIAL_WINDOW/.test(windowMark), detail: `sourceWindow = ${JSON.stringify(windowMark)}` };
		}),
	}),
	// ⟪H-2, adversarial review D4 2026-08-17⟫ The reviewer disabled the PARTIAL guard and bgDerived stayed
	// 39/39. This family's TITLE claims a windowed block "refuses to ship as a whole graph"; conjunct (a)
	// asserts only that the block is MARKED. Marking is legibility; refusing is the guarantee, and the
	// guarantee was the untested half. With three PARTIAL blocks living in one store under one pairKey and
	// `materialise` being latest-wins, ten edges could have shipped as a graph and reported success.
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-PARTIAL',
		conjunctId: 'b_aWindowedBlockREFUSESToMaterialiseUnderADifferentWindow',
		title: 'a block frozen from a --limit WINDOW is REFUSED BY NAME when a run whose window differs tries to materialise it — the family title\'s "refuses to ship as a whole graph", asserted rather than assumed',
		mode: 'twice',
		shape: (scenario) => {
			derivedShape(scenario);
			// freeze under a window, then materialise with NO window: the guard must refuse the second run
			scenario.spec.config = { ...scenario.spec.config, limit: 3, offset: 0 };
			scenario.secondRunConfigOverride = { limit: undefined, offset: undefined };
		},
		regex: /was frozen from a PARTIAL window[\s\S]*and this run's window is/,
		twinName: 'partialGuardRemoved',
		fileName: 'materialiser.js',
		find: '\tif (blockWindowMark !== null && blockWindowMark !== currentWindowMark) {',
		replace: '\tif (false && blockWindowMark !== null && blockWindowMark !== currentWindowMark) {',
	}),
];

// ---------------------------------------------------------------------
// BG-THREE-DERIVED — the INFERRED half of the producer-conditional edge properties. BG-THREE walks the same
// disposition table for the AUTHORED half over a crosswalk scenario; this is the other direction, and both
// are needed: a table with one side untested is a table that can be half wrong for a year.
// ---------------------------------------------------------------------
const inferredEdgeConjunctList = [
	runConjunct({
		conjunctId: 'a_inferredEdgeCarriesNoProviderAndNoSubjectMatchField',
		title: 'an INFERRED edge carries NEITHER mappingProvider NOR subjectMatchField — nobody authored it and it matched on no field',
		twinNameList: ['inferredKeptTheProvider'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const edgeList = edgesOf(outcome);
			const carrying = edgeList.filter((oneEdge) => graphSeamRulesLib.PRODUCER_CONDITIONAL_EDGE_PROPERTY_NAME_LIST.some((oneName) => Object.prototype.hasOwnProperty.call(oneEdge.properties, oneName)));
			return { pass: edgeList.length > 0 && carrying.length === 0, detail: `${edgeList.length} inferred edge(s), ${carrying.length} carrying a producer-conditional property` };
		}),
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: 'BG-THREE-DERIVED',
		conjunctId: 'b_inferredEdgeCarryingAProviderIsRefusedByName',
		title: "an INFERRED edge that DOES carry a mappingProvider is refused BY NAME at the write seam — the key must be ABSENT, not null, not the tool's URL",
		shape: (scenario) => {
			derivedShape(scenario);
			// force the materialiser to stamp a provider onto every edge; the seam must then refuse the run
			scenario.frameworkMutationList.push({
				modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'materialiser.js'),
				find: '\tif (mappingProviderUrl !== null && mappingProviderUrl !== undefined) {',
				replace: '\tif (true) {\n\t\tedgeProperties[MAPPING_PROPERTIES.MAPPING_PROVIDER] = \'https://example.invalid/forced\';\n\t}\n\tif (false) {',
			});
		},
		regex: /an 'inferred' edge carries 'mappingProvider'/,
		twinName: 'providerForbiddenCheckDisabled',
		fileName: 'graphSeamRules.js',
		find: "\t\tif (disposition === 'forbidden' && Object.prototype.hasOwnProperty.call(edgeProperties, oneName)) {",
		replace: '\t\tif (false) {',
	}),
];

const gateDeclarationList = [
	{ gateId: 'BG-RETRIEVAL', title: 'the semantic candidate pool: K, the floor, neutral order, and an empty pool that is an orphan rather than an error', conjunctList: retrievalConjunctList },
	{ gateId: 'BG-BLIND-DERIVED', title: 'the bias audit: an ALLOW-list enforced by construction, with the regex sweep as the second net', conjunctList: blindConjunctList },
	{ gateId: 'BG-DERIVED-CENSUS', title: "the derived census in the framework's own vocabulary", conjunctList: censusConjunctList },
	{ gateId: 'BG-NOCROSSWALK', title: 'the truth set is unreachable because no document is opened at all', conjunctList: noCrosswalkConjunctList },
	{ gateId: 'BG-PARTIAL', title: 'a windowed block is legible as partial and refuses to ship as a whole graph', conjunctList: partialConjunctList },
	{ gateId: 'BG-THREE-DERIVED', title: 'the INFERRED half of the producer-conditional edge properties', conjunctList: inferredEdgeConjunctList },
];

// ---------------------------------------------------------------------
// TWINS — each names the ONE production row or line the conjunct depends on. Where a registered data row can
// be targeted instead of a source string it is (the supervisor's note that source-text twins are
// refactor-fragile): the K/floor twins move the DECLARATION, not the retrieval code.
// ---------------------------------------------------------------------
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'a_poolNeverExceedsK', twinName: 'ignoreKCeiling', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RETRIEVAL_FILE), find: 'for (let rankIndex = 0; rankIndex < scoredList.length && seatList.length < k; rankIndex++) {', replace: 'for (let rankIndex = 0; rankIndex < scoredList.length; rankIndex++) {' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'b_everySeatIsAtOrAboveTheFloor', twinName: 'ignoreFloor', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RETRIEVAL_FILE), find: '\t\tif (scoredList[rankIndex].cosine < floor) {\n\t\t\tbreak;\n\t\t}', replace: '\t\tif (false) {\n\t\t\tbreak;\n\t\t}' });
	// a floor no card can meet: without the break above, every seat is admitted below it
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] || {};
	const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`));
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	bridgeDeclaration.candidateRetrieval = { ...bridgeDeclaration.candidateRetrieval, floor: 1.5 };
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME].bridgeDeclaration = bridgeDeclaration;
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'c_poolReachesTheJudgeInStableIdOrder', twinName: 'renderInRankOrder', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: 'const poolCardList = classificationLib.sortByStableId(retrieved.seatList.map((oneSeat) => args.cardByStableId[oneSeat.stableId]));', replace: 'const poolCardList = retrieved.seatList.map((oneSeat) => args.cardByStableId[oneSeat.stableId]).slice().reverse();' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'd_noCosineOrRankIsEverRendered', twinName: 'renderTheCosine', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE), find: "\tlineList.push(`  [${seatIndex + 1}]`);", replace: "\tlineList.push(`  [${seatIndex + 1}] cosine ${oneSeat.cosine}`);" });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-RETRIEVAL', conjunctId: 'e_floorAboveTheMaximumEmptiesEveryPoolAsNoCandidate', twinName: 'emptyPoolStillJudged', leverKind: 'productionMutation', mutate: (scenario) => {
	// the classification row that makes an empty retrieved pool an orphan is REMOVED: the pool then falls to a
	// judged row and the renderer is called on nothing
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'classification.js'), find: "	Object.freeze({ row: 'R2', classification: 'orphan', scope: 'target', reason: 'noCandidate', condition: (context) => context.poolOrigin === 'retrieval' && context.filteredPoolSize === 0 }),", replace: '' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-BLIND-DERIVED', conjunctId: 'a_renderedPropertiesAreOnlyTheAllowListed', twinName: 'renderOutsideTheAllowList', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE), find: "\tlineList.push(...renderKeyValueLines(graphSeamRulesLib.allowListedPropertiesFor({ properties: oneSeat.card, allowNameList: renderingAllowList.candidate }), '      '));", replace: "\tlineList.push(...renderKeyValueLines({ ...graphSeamRulesLib.allowListedPropertiesFor({ properties: oneSeat.card, allowNameList: renderingAllowList.candidate }), canonicalKey: oneSeat.card.canonicalKey }, '      '));" });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-BLIND-DERIVED', conjunctId: 'b_idGateSweepIsAtZeroOverEveryPrompt', twinName: 'renderOutsideTheAllowList', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE), find: "\tlineList.push(...renderKeyValueLines(graphSeamRulesLib.allowListedPropertiesFor({ properties: oneSeat.card, allowNameList: renderingAllowList.candidate }), '      '));", replace: "\tlineList.push(...renderKeyValueLines({ ...graphSeamRulesLib.allowListedPropertiesFor({ properties: oneSeat.card, allowNameList: renderingAllowList.candidate }), canonicalKey: oneSeat.card.canonicalKey }, '      '));" });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-DERIVED-CENSUS', conjunctId: 'a_judgedPlusOrphanEqualsSubjectCount', twinName: 'dropJudgedFromSubjectCount', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'census.js'), find: '\tperSubject.subjectCount = perSubject.specifiedSubjectCount + perSubject.judgedSubjectCount + perSubject.orphanSubjectCount + perSubject.subjectCollisionCount + perSubject.sourceGapCount;', replace: '\tperSubject.subjectCount = perSubject.specifiedSubjectCount + perSubject.orphanSubjectCount + perSubject.subjectCollisionCount + perSubject.sourceGapCount;' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-DERIVED-CENSUS', conjunctId: 'b_abstainedIsAPerTargetMemberNeverASubjectBucket', twinName: 'abstainedAsSubjectBucket', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'census.js'), find: '\tconst perSubject = {\n\t\tsubjectCount: 0,', replace: '\tconst perSubject = {\n\t\tabstainedSubjectCount: 0,\n\t\tsubjectCount: 0,' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-NOCROSSWALK', conjunctId: 'a_theProducerOpensNoDocumentAtAll', twinName: 'derivedDeclaresAChannel', leverKind: 'productionMutation', mutate: (scenario) => {
	// the row-conditional emptiness refusal is disabled, and the derived plugin is given the crosswalk's own
	// document channel: the run then OPENS a document and the digest map stops being empty
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), find: '\t\tif (acquisitionRow !== undefined && acquisitionRow.walkChannelSourceKind === null) {', replace: '\t\tif (false) {' });
	const crosswalkLoaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js'));
	const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`));
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	bridgeDeclaration.sourceChannelList = cloneJson(crosswalkLoaded.bridgeDeclaration.sourceChannelList);
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { ...(scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] || {}), bridgeDeclaration };
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-THREE-DERIVED', conjunctId: 'a_inferredEdgeCarriesNoProviderAndNoSubjectMatchField', twinName: 'inferredKeptTheProvider', leverKind: 'productionMutation', mutate: (scenario) => {
	// BOTH halves are needed to observe this red: the materialiser must stamp the property AND the seam's
	// forbidden-check must be disabled, or the run refuses before an edge is ever written and the conjunct
	// would go red for the refusal rather than for the property it is about.
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'materialiser.js'), find: '\tif (mappingProviderUrl !== null && mappingProviderUrl !== undefined) {', replace: "\tif (true) {\n\t\tedgeProperties[MAPPING_PROPERTIES.MAPPING_PROVIDER] = 'https://example.invalid/forced';\n\t}\n\tif (false) {" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'graphSeamRules.js'), find: "\t\tif (disposition === 'forbidden' && Object.prototype.hasOwnProperty.call(edgeProperties, oneName)) {", replace: '\t\tif (false) {' });
} });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PARTIAL', conjunctId: 'a_windowedRunMarksItsBlockPartial', twinName: 'unmarkedWindow', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\t\tsourceWindow: args.windowMark === undefined ? null : args.windowMark,', replace: '\t\t\t\t\t\tsourceWindow: null,' });
} });

runGateFamily(
	{
		harness,
		familyName: 'BG-RETRIEVAL+BG-BLIND-DERIVED+BG-DERIVED-CENSUS+BG-NOCROSSWALK+BG-PARTIAL+BG-THREE-DERIVED',
		gateDeclarationList,
		twinRegistry,
		makeSubject: scenarioLib.makeScenario,
		cloneSubject: scenarioLib.cloneScenario,
		// LITERAL, never derived from a .length (RULING SABLE_RIVER 2026-08-17)
		// LITERAL: 5 + 3 + 2 + 1 + 1 + 2
		expectedConjunctCount: 16,
		expectedTwinCount: 16,
	},
	() => harness.report(),
);
