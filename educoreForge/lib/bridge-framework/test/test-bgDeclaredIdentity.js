'use strict';

// test-bgDeclaredIdentity.js — ⟪ctdlHub-101926 P6 steps 2 and 4⟫ the DECLARED-IDENTITY basis over its fixture proof: the 16 REAL
// PESC_LD v0.0.2 Transcript application-profile rows whose propertyID is a ceterms: IRI, as a test spoke (fixtures/declaredBridge,
// never a PESC forge), joined on termIri to the REAL CTDL hub TERM cards (993, exported from DEV_p5TwoHubs). PURE: graphDouble.
//
// CONJUNCTS
//   a  the fixture holds every ceterms: row of the source file, counted from the file itself (16), one subject node per row
//   b  every row resolves: 16 specified records, 0 orphan, 16 EXACT_MATCH edges, each landing on the term card whose termIri is
//      the row's IRI; zero edges of any other type
//   c  every edge carries matchBasis 'declaredIdentity', mappingKind authored, mappingSource declared-<bridge>
//   d  zero judge calls: no judged task, the judgment cache never consulted, judgeSpend.asked 0
//   e  an IRI with no term card (a term the 20260327 release does not carry) is an ORPHAN record that names it; nothing is dropped
//   f  a target resolving to TWO term cards is refused by name (admitsJudgment false) rather than handed to a judge
//   g  the contract: a declaredIdentity tupleFieldColumnMap must name termIri, and may not name canonicalKey; a standard plugin may
//      not name termIri
//   ⟪zeroBacklog lane C, 2026-10-22: the hub's rules decide scope and key form⟫
//   h  a subject whose key no rule of the hub matches (a pesc: row) is OUT OF SCOPE: no record, no orphan; counted and listed in the
//      run report's counts.outOfHubScopeList, with the 16 in-scope rows still specified
//   i  the contract: a declaredIdentity bridge REQUIRES declaredTargetRuleList, and admits only stableIdTemplate rules (a
//      memberByNotation rule addresses a base node's member, never a term card: refused by name)
//   j  the composer composes a declaredIdentity facet: bridgeName <stem><Hub>DeclaredIdentity, the hub's rules 'fromHub'
//   k  a rule maps the subject key to the card key: a rule whose template rewrites the key (a CURIE to a full IRI) is what is joined
// RED TWINS: (b) under 'termIriIndexJoinsOnCanonicalKey' (the pool keyed by the wrong field) every row orphans; (d)/(f) under
// 'admitsJudgmentGuardRemoved' the two-card target reaches the judge; (h) under 'outOfScopeFallsThroughToOrphan' an out-of-scope
// key reaches the join and orphans; (i) under 'memberByNotationAdmitted' the rule-kind admission no longer refuses.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- ctdlHub P6: declared identity (termIriIndex, EXACT_MATCH, matchBasis declaredIdentity) over the PESC_LD fixture

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const toyBridgeScenario = require('./testSupport/toyBridgeScenario');
const pluginRegistryLib = require('../pluginRegistry');
const decisionBlockLib = require('../decisionBlock');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'declaredBridge');
const FORGES_DIR = path.join(FIXTURE_DIR, 'forges');
const PLUGIN_PATH = path.join(FORGES_DIR, 'pescldfixture', 'bridges', 'pescLdFixtureCtdlDeclaredIdentityPlugin.js');
const PESC_LD_TAP_PATH = '/Users/tqwhite/Downloads/JSON-LD College Transcript_v0.0.2/Application Profile/PESC Transcript TAP_v0.0.1.json';
const ROW_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'pescLdCetermsRows.json'), 'utf8'));
const TERM_CARD_FIXTURE = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'ctdlTermCards.json'), 'utf8'));
const SOURCE_STANDARD_NAME = 'PESCLDFixture';
const HUB_NAME = 'CTDL';
const HUB_VERSION = TERM_CARD_FIXTURE.cardList[0].properties.hubVersion;
const BRIDGE_NAME = 'pescLdFixtureCtdlDeclaredIdentityPlugin';
const FRAMEWORK_FILE_PATH = path.join(__dirname, '..', 'bridge-framework.js');

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

// one subject node per row: stableId names the shape and the property, termIri is the row's propertyID VERBATIM
const rowNodeFor = (oneRow) => ({
	stableId: `pescldfixture:row/${oneRow.shape}.${oneRow.propertyID}`,
	labels: ['ForgedNode', 'DmeProperty'],
	properties: { stableId: `pescldfixture:row/${oneRow.shape}.${oneRow.propertyID}`, name: oneRow.propertyLabel, role: 'DmeProperty', termIri: oneRow.propertyID, _source: SOURCE_STANDARD_NAME },
});
const fixtureGraph = ({ extraRowList = [], extraCardList = [] } = {}) => ({
	nodeList: TERM_CARD_FIXTURE.cardList.map(cloneJson).concat(extraCardList).concat(ROW_FIXTURE.rowList.concat(extraRowList).map(rowNodeFor)),
	edgeList: [],
});
const scenarioFor = ({ graph, frameworkMutationList = [] }) => {
	const scenario = toyBridgeScenario.makeScenario();
	scenario.forgesDirOverride = FORGES_DIR;
	scenario.frameworkMutationList = frameworkMutationList;
	scenario.graph = graph;
	scenario.spec = {
		inGraph: { graphName: 'DEV_declaredIdentityDouble' },
		bridge: BRIDGE_NAME,
		source: 'pescldfixture',
		hub: 'ctdl',
		applyLabel: 'BridgedRelation',
		rebridge: true,
		config: { limit: undefined, offset: undefined, sourceStandard: 'pescldfixture', sourceStandardName: SOURCE_STANDARD_NAME, sourceVersion: '0.0.2', hubVersion: HUB_VERSION, hubStandardName: HUB_NAME, pairWith: undefined, pairWithVersion: undefined, familyStandards: ['pescldfixture'] },
	};
	return scenario;
};
const frozenBlockOf = (result) => {
	const row = result.stores.decisionStore.rowList[result.stores.decisionStore.rowList.length - 1];
	return row === undefined ? null : decisionBlockLib.parseFrozenText(row.frozenText).block;
};
const failureTextOf = (result) => String(result.runError || result.constructionError || result.thrownFromRun || '');

// the twin mutations
const POOL_JOIN_FIND = "const cardListByCanonicalKey = classificationLib.makeCardListByJoinField({ cardList: termCardList, joinFieldName: acquisitionRow.targetKeyTupleField });";
const POOL_JOIN_REPLACE = "const cardListByCanonicalKey = classificationLib.makeCardListByJoinField({ cardList: termCardList.filter((oneCard) => typeof oneCard.canonicalKey === 'string'), joinFieldName: 'canonicalKey' });";
const JUDGMENT_GUARD_FIND = 'if (acquisitionRow.admitsJudgment === false && args.judgedTaskList.length > 0) {';
const JUDGMENT_GUARD_REPLACE = 'if (false && args.judgedTaskList.length > 0) {';
// ⟪zeroBacklog lane C⟫ the scope gate removed: a key no rule matches falls through to the join, and orphans
const SCOPE_GATE_FIND = 'if (resolved.ruleIndex === -1) {\n\t\t\t\t\t\t\t\toutOfScopeRawTargetSet.add(rawTarget);';
const SCOPE_GATE_REPLACE = 'if (false) {\n\t\t\t\t\t\t\t\toutOfScopeRawTargetSet.add(rawTarget);';
// ⟪zeroBacklog lane C⟫ the rule-kind admission removed: a memberByNotation rule is admitted on declared identity
const CONTRACT_FILE_PATH = path.join(__dirname, '..', 'bridgePluginContract.js');
const RULE_KIND_GATE_FIND = 'bridgeDeclaration.declaredTargetRuleList.findIndex((oneRule) => admittedRuleKindList.indexOf(oneRule.ruleKind) === -1);';
const RULE_KIND_GATE_REPLACE = 'bridgeDeclaration.declaredTargetRuleList.findIndex((oneRule) => false && admittedRuleKindList.indexOf(oneRule.ruleKind) === -1);';

const judgeResolution = (result) => {
	const text = failureTextOf(result);
	if (text) {
		return { pass: false, detail: text };
	}
	const block = frozenBlockOf(result);
	const writtenEdgeList = result.graphDouble.state.writtenEdgeList;
	const termIriByCardStableId = TERM_CARD_FIXTURE.cardList.reduce((soFar, oneCard) => ({ ...soFar, [oneCard.stableId]: oneCard.properties.termIri }), {});
	const termIriBySubjectStableId = ROW_FIXTURE.rowList.reduce((soFar, oneRow) => ({ ...soFar, [rowNodeFor(oneRow).stableId]: oneRow.propertyID }), {});
	const specifiedList = block.decisionRecordList.filter((oneRecord) => oneRecord.resolution === 'specified');
	const orphanList = block.decisionRecordList.filter((oneRecord) => oneRecord.classification === 'orphan');
	const wrongLanding = writtenEdgeList.filter((oneEdge) => termIriByCardStableId[oneEdge.toStableId] !== termIriBySubjectStableId[oneEdge.fromStableId]);
	const nonExact = writtenEdgeList.filter((oneEdge) => oneEdge.type !== 'EXACT_MATCH');
	return {
		pass: specifiedList.length === ROW_FIXTURE.rowCount && orphanList.length === 0 && writtenEdgeList.length === ROW_FIXTURE.rowCount && wrongLanding.length === 0 && nonExact.length === 0,
		detail: `specified ${specifiedList.length}, orphan ${orphanList.length} (${orphanList.map((oneRecord) => oneRecord.targetCanonicalKeyList.join('|')).join(', ')}), edges ${writtenEdgeList.length}, wrong landing ${wrongLanding.length}, non-EXACT_MATCH ${nonExact.length}; expected ${ROW_FIXTURE.rowCount} / 0 / ${ROW_FIXTURE.rowCount} / 0 / 0`,
	};
};

const conjunctList = [];
const conjunct = (refId, judge) => conjunctList.push({ refId, judge });

conjunct('a_fixtureHoldsEveryCetermsRowOfTheSource', (done) => {
	if (!fs.existsSync(PESC_LD_TAP_PATH)) {
		done({ pass: false, detail: `the PESC_LD source file is not at ${PESC_LD_TAP_PATH}; the fixture's row count cannot be re-derived from it` });
		return;
	}
	const sourceDocument = JSON.parse(fs.readFileSync(PESC_LD_TAP_PATH, 'utf8'));
	const sourceRowList = Object.keys(sourceDocument).reduce((soFar, oneShape) => soFar.concat(Object.keys(sourceDocument[oneShape]).map((onePropertyName) => ({ shape: oneShape, row: sourceDocument[oneShape][onePropertyName] }))), []).filter((oneEntry) => String(oneEntry.row.propertyID).indexOf('ceterms:') === 0);
	const fixtureKeyList = ROW_FIXTURE.rowList.map((oneRow) => `${oneRow.shape}|${oneRow.propertyID}`).sort();
	const sourceKeyList = sourceRowList.map((oneEntry) => `${oneEntry.shape}|${oneEntry.row.propertyID}`).sort();
	done({ pass: ROW_FIXTURE.rowCount === 16 && JSON.stringify(fixtureKeyList) === JSON.stringify(sourceKeyList), detail: `source ${sourceKeyList.length} ceterms: row(s), fixture ${fixtureKeyList.length} (declared rowCount ${ROW_FIXTURE.rowCount})` });
});

conjunct('b_everyRowResolvesToItsTermCard', (done) => toyBridgeScenario.runScenario(scenarioFor({ graph: fixtureGraph() }), (unusedError, result) => done(judgeResolution(result))));

conjunct('c_everyEdgeIsDeclaredIdentity', (done) => toyBridgeScenario.runScenario(scenarioFor({ graph: fixtureGraph() }), (unusedError, result) => {
	const writtenEdgeList = result.graphDouble ? result.graphDouble.state.writtenEdgeList : [];
	const bad = writtenEdgeList.filter((oneEdge) => oneEdge.properties.matchBasis !== 'declaredIdentity' || oneEdge.properties.mappingKind !== 'authored' || oneEdge.properties.mappingSource !== `declared-${BRIDGE_NAME}` || oneEdge.properties.resolution !== 'specified');
	done({ pass: failureTextOf(result) === '' && writtenEdgeList.length > 0 && bad.length === 0, detail: `${failureTextOf(result)} ${bad.length} bad of ${writtenEdgeList.length}${bad.length ? `: ${JSON.stringify(bad[0].properties)}` : ''}` });
}));

conjunct('d_zeroJudgeCalls', (done) => toyBridgeScenario.runScenario(scenarioFor({ graph: fixtureGraph() }), (unusedError, result) => {
	const block = failureTextOf(result) ? null : frozenBlockOf(result);
	const judgedList = block ? block.decisionRecordList.filter((oneRecord) => oneRecord.resolution === 'judged') : [];
	done({
		pass: block !== null && judgedList.length === 0 && result.stores.judgmentCache.getCallCount === 0 && block.header.judgeKind === 'none',
		detail: `${failureTextOf(result)} judged records ${judgedList.length}; judgment cache get() ${result.stores ? result.stores.judgmentCache.getCallCount : '(no run)'}; header.judgeKind ${block ? block.header.judgeKind : '?'}`,
	});
}));

conjunct('e_unresolvedIriIsANamedOrphan', (done) => {
	const absentRow = { shape: 'Synthetic', shapeID: 'SyntheticShape', propertyID: 'ceterms:termAddedAfter20260327', propertyLabel: 'Absent term', valueClass: '' };
	toyBridgeScenario.runScenario(scenarioFor({ graph: fixtureGraph({ extraRowList: [absentRow] }) }), (unusedError, result) => {
		const block = failureTextOf(result) ? null : frozenBlockOf(result);
		const orphanList = block ? block.decisionRecordList.filter((oneRecord) => oneRecord.classification === 'orphan') : [];
		const named = orphanList.length === 1 && JSON.stringify(orphanList[0].targetCanonicalKeyList) === JSON.stringify(['ceterms:termAddedAfter20260327']) && orphanList[0].subjectStableId === rowNodeFor(absentRow).stableId && orphanList[0].reason === 'noCardUnderKey';
		const specifiedCount = block ? block.decisionRecordList.filter((oneRecord) => oneRecord.resolution === 'specified').length : 0;
		done({ pass: named && specifiedCount === ROW_FIXTURE.rowCount, detail: `${failureTextOf(result)} orphans ${JSON.stringify(orphanList.map((oneRecord) => ({ subject: oneRecord.subjectStableId, target: oneRecord.targetCanonicalKeyList, reason: oneRecord.reason })))}; specified ${specifiedCount}` });
	});
});

const twoCardScenario = (frameworkMutationList) => {
	const duplicateCard = cloneJson(TERM_CARD_FIXTURE.cardList.find((oneCard) => oneCard.properties.termIri === 'ceterms:name'));
	duplicateCard.stableId = `${duplicateCard.stableId}-duplicate`;
	duplicateCard.properties.stableId = duplicateCard.stableId;
	return scenarioFor({ graph: fixtureGraph({ extraCardList: [duplicateCard] }), frameworkMutationList });
};
const judgeTwoCardRefusal = (result) => {
	const text = failureTextOf(result);
	return { pass: /matchBasis 'declaredIdentity' produced \d+ judged task\(s\)/.test(text) && result.stores !== undefined && result.stores.judgmentCache.getCallCount === 0, detail: `${text || 'NOT REFUSED'}; judgment cache get() ${result.stores ? result.stores.judgmentCache.getCallCount : '(no run)'}` };
};
conjunct('f_twoCardTargetRefusedNotJudged', (done) => toyBridgeScenario.runScenario(twoCardScenario([]), (unusedError, result) => done(judgeTwoCardRefusal(result))));

conjunct('g_contractJoinFieldByBasis', (done) => {
	const loaded = require(PLUGIN_PATH);
	const register = (bridgeDeclaration) => pluginRegistryLib.registerPlugin({ pluginModule: { ...loaded, bridgeDeclaration }, pluginFilePath: PLUGIN_PATH, bundleDirPath: path.dirname(path.dirname(PLUGIN_PATH)) });
	const good = register(loaded.bridgeDeclaration);
	const withCanonicalKey = register({ ...loaded.bridgeDeclaration, tupleFieldColumnMap: { canonicalKey: { column: 'termIri', transform: 'identity' } } });
	const bothKeys = register({ ...loaded.bridgeDeclaration, tupleFieldColumnMap: { termIri: { column: 'termIri', transform: 'identity' }, canonicalKey: { column: 'termIri', transform: 'identity' } } });
	const standardWithTermIri = register({ ...loaded.bridgeDeclaration, matchBasis: 'standard', tupleFieldColumnMap: { canonicalKey: { column: 'termIri', transform: 'identity' }, termIri: { column: 'termIri', transform: 'identity' } } });
	const textOf = (outcome) => (outcome.error ? outcome.error.message : 'ADMITTED');
	done({
		pass: !good.error && /MUST name termIri/.test(textOf(withCanonicalKey)) && /names 'canonicalKey', the join key of another basis/.test(textOf(bothKeys)) && /names 'termIri', the join key of another basis/.test(textOf(standardWithTermIri)),
		detail: `good: ${textOf(good)} | canonicalKey only: ${textOf(withCanonicalKey)} | both: ${textOf(bothKeys)} | standard naming termIri: ${textOf(standardWithTermIri)}`,
	});
});

const outOfScopeConjunct = (frameworkMutationList) => (done) => {
	const outOfScopeRowList = [
		{ shape: 'CollegeTranscript', shapeID: 'CollegeTranscriptShape', propertyID: 'pesc:createdDateTime', propertyLabel: 'Created Date Time', valueClass: '' },
		{ shape: 'Note', shapeID: 'NoteShape', propertyID: 'elm:noteLiteral', propertyLabel: 'Note literal', valueClass: '' },
	];
	toyBridgeScenario.runScenario(scenarioFor({ graph: fixtureGraph({ extraRowList: outOfScopeRowList }), frameworkMutationList }), (unusedError, result) => {
		const block = failureTextOf(result) ? null : frozenBlockOf(result);
		const recordList = block ? block.decisionRecordList : [];
		const outOfScopeSubjectSet = new Set(outOfScopeRowList.map((oneRow) => rowNodeFor(oneRow).stableId));
		const recordsOnOutOfScope = recordList.filter((oneRecord) => outOfScopeSubjectSet.has(oneRecord.subjectStableId));
		const listed = result.runReport && result.runReport.counts && Array.isArray(result.runReport.counts.outOfHubScopeList) ? result.runReport.counts.outOfHubScopeList : null;
		const listedKeyList = listed === null ? [] : listed.map((oneEntry) => `${oneEntry.rawTarget}:${oneEntry.subjectCount}`).sort();
		const specifiedCount = recordList.filter((oneRecord) => oneRecord.resolution === 'specified').length;
		done({
			pass: block !== null && recordsOnOutOfScope.length === 0 && specifiedCount === ROW_FIXTURE.rowCount && JSON.stringify(listedKeyList) === JSON.stringify(['elm:noteLiteral:1', 'pesc:createdDateTime:1']),
			detail: `${failureTextOf(result)} records on out-of-scope subjects ${recordsOnOutOfScope.length}; specified ${specifiedCount}; outOfHubScopeList ${JSON.stringify(listed)}`,
		});
	});
};
conjunct('h_outOfScopeSubjectCountedNotOrphaned', outOfScopeConjunct([]));

conjunct('i_contractRulesRequiredAndTemplateOnly', (done) => {
	const loaded = require(PLUGIN_PATH);
	const register = (bridgeDeclaration) => pluginRegistryLib.registerPlugin({ pluginModule: { ...loaded, bridgeDeclaration }, pluginFilePath: PLUGIN_PATH, bundleDirPath: path.dirname(path.dirname(PLUGIN_PATH)) });
	const textOf = (outcome) => (outcome.error ? outcome.error.message : 'ADMITTED');
	const { declaredTargetRuleList, ...withoutRules } = loaded.bridgeDeclaration;
	void declaredTargetRuleList;
	const noRules = register(withoutRules);
	const memberRule = register({ ...loaded.bridgeDeclaration, declaredTargetRuleList: [{ ruleKind: 'memberByNotation', pattern: '^ceterms:(\\w+)#(.+)$', containerStableIdTemplate: 'ceterms:{1}', memberEdgeType: 'HAS_VALUE', memberMatchProperty: 'notation', memberMatchGroup: 2 }] });
	done({
		pass: /is missing declaredTargetRuleList, which matchBasis 'declaredIdentity' REQUIRES/.test(textOf(noRules)) && /rule 0 ruleKind 'memberByNotation', which matchBasis 'declaredIdentity' does not admit/.test(textOf(memberRule)),
		detail: `no rules: ${textOf(noRules)} | memberByNotation: ${textOf(memberRule)}`,
	});
});

conjunct('j_composerComposesADeclaredIdentityFacet', (done) => {
	const bridgeComposerLib = require('../bridgeComposer');
	const ctdlHubBridging = require('../../../forges/ctdl/lib/ctdlHubBridging').hubBridging;
	const loaded = require(PLUGIN_PATH);
	const { bridgeName, blindingDeclaration, remodelTableRef, declaredTargetRuleList, ...declarationTemplate } = loaded.bridgeDeclaration;
	void bridgeName; void blindingDeclaration; void remodelTableRef; void declaredTargetRuleList;
	const standardBridging = {
		standardKey: 'pescldfixture',
		bridgeNameStem: 'pescldfixture',
		facetList: [{ facetName: '', declarationTemplate, subjectRenderingAllowList: null, pairByHubToken: { ctdl: { candidateRetrieval: null, candidateRenderingAllowList: null, promptIdentifierScan: null, blindingOrder: { standardBlindingNameList: ['termIri'], pairedHubAnchors: 'union' }, hubAnchorListLength: null, declaredTargetRuleList: 'fromHub', remodelTableRef: null, hubRemodelTableListLength: null } } }],
	};
	const composed = bridgeComposerLib.composePluginModuleList({ standardBridging, bridgeHooksByFacetName: { '': loaded.bridgeHooks }, hubBridgingByToken: { ctdl: ctdlHubBridging }, bundleDirName: 'pescldfixture' });
	const pluginModule = composed.pluginModuleList ? composed.pluginModuleList[0] : null;
	const registered = pluginModule === null ? { error: new Error(String(composed.error && composed.error.message)) } : pluginRegistryLib.registerPlugin({ pluginModule, pluginFilePath: PLUGIN_PATH, bundleDirPath: path.dirname(path.dirname(PLUGIN_PATH)) });
	done({
		pass: pluginModule !== null && pluginModule.bridgeDeclaration.bridgeName === 'pescldfixtureCtdlDeclaredIdentity' && JSON.stringify(pluginModule.bridgeDeclaration.declaredTargetRuleList) === JSON.stringify(ctdlHubBridging.declaredTargetRuleList) && !registered.error,
		detail: pluginModule === null ? `NOT COMPOSED: ${composed.error && composed.error.message}` : `bridgeName ${pluginModule.bridgeDeclaration.bridgeName}; rules ${JSON.stringify(pluginModule.bridgeDeclaration.declaredTargetRuleList)}; registers: ${registered.error ? registered.error.message : 'yes'}`,
	});
});

conjunct('k_ruleTemplateRewritesTheKeyBeforeTheJoin', (done) => {
	// the cards carry termIri as a FULL IRI here, the rows a CURIE: only a template that rewrites one into the other can join them
	const fullIriCardList = TERM_CARD_FIXTURE.cardList.map(cloneJson).map((oneCard) => ({ ...oneCard, properties: { ...oneCard.properties, termIri: oneCard.properties.termIri.replace(/^ceterms:/, 'https://purl.org/ctdl/terms/') } }));
	const scenario = scenarioFor({ graph: { nodeList: fullIriCardList.concat(ROW_FIXTURE.rowList.map(rowNodeFor)), edgeList: [] } });
	const loaded = require(PLUGIN_PATH);
	scenario.pluginModuleOverrides = { [BRIDGE_NAME]: { bridgeDeclaration: { ...loaded.bridgeDeclaration, declaredTargetRuleList: [{ ruleKind: 'stableIdTemplate', pattern: '^ceterms:([A-Za-z][A-Za-z0-9_]*)$', stableIdTemplate: 'https://purl.org/ctdl/terms/{1}' }] } } };
	toyBridgeScenario.runScenario(scenario, (unusedError, result) => {
		const block = failureTextOf(result) ? null : frozenBlockOf(result);
		const specifiedCount = block ? block.decisionRecordList.filter((oneRecord) => oneRecord.resolution === 'specified').length : 0;
		done({ pass: specifiedCount === ROW_FIXTURE.rowCount, detail: `${failureTextOf(result)} specified ${specifiedCount} of ${ROW_FIXTURE.rowCount}` });
	});
});

const runTwinSweep = () => {
	harness.section('THE TWIN SWEEP');
	const ruleKindVerdictUnderMutation = () => {
		// the contract module is read through the module double only inside a scenario run, so the admission twin edits a COPY of the
		// declaration check by registering through a framework double built with the mutation
		const mutatedScenario = scenarioFor({ graph: fixtureGraph(), frameworkMutationList: [{ modulePath: CONTRACT_FILE_PATH, find: RULE_KIND_GATE_FIND, replace: RULE_KIND_GATE_REPLACE }] });
		const loaded = require(PLUGIN_PATH);
		mutatedScenario.pluginModuleOverrides = { [BRIDGE_NAME]: { bridgeDeclaration: { ...loaded.bridgeDeclaration, declaredTargetRuleList: [{ ruleKind: 'memberByNotation', pattern: '^ceterms:(\\w+)#(.+)$', containerStableIdTemplate: 'ceterms:{1}', memberEdgeType: 'HAS_VALUE', memberMatchProperty: 'notation', memberMatchGroup: 2 }] } } };
		return mutatedScenario;
	};
	toyBridgeScenario.runScenario(scenarioFor({ graph: fixtureGraph(), frameworkMutationList: [{ modulePath: FRAMEWORK_FILE_PATH, find: POOL_JOIN_FIND, replace: POOL_JOIN_REPLACE }] }), (unusedError, joinTwin) => {
		const joinVerdict = judgeResolution(joinTwin);
		harness.ok("(b) observed RED under 'termIriIndexJoinsOnCanonicalKey'", !joinVerdict.pass, joinVerdict.detail);
		harness.note(`RED-OBSERVED b twin='termIriIndexJoinsOnCanonicalKey' → ${joinVerdict.detail.slice(0, 240)}`);
		toyBridgeScenario.runScenario(twoCardScenario([{ modulePath: FRAMEWORK_FILE_PATH, find: JUDGMENT_GUARD_FIND, replace: JUDGMENT_GUARD_REPLACE }]), (unusedTwinError, guardTwin) => {
			const guardVerdict = judgeTwoCardRefusal(guardTwin);
			harness.ok("(f) observed RED under 'admitsJudgmentGuardRemoved'", !guardVerdict.pass, guardVerdict.detail);
			harness.note(`RED-OBSERVED f twin='admitsJudgmentGuardRemoved' → ${guardVerdict.detail.slice(0, 240)}`);
			outOfScopeConjunct([{ modulePath: FRAMEWORK_FILE_PATH, find: SCOPE_GATE_FIND, replace: SCOPE_GATE_REPLACE }])((scopeVerdict) => {
				harness.ok("(h) observed RED under 'outOfScopeFallsThroughToOrphan'", !scopeVerdict.pass, scopeVerdict.detail);
				harness.note(`RED-OBSERVED h twin='outOfScopeFallsThroughToOrphan' → ${scopeVerdict.detail.slice(0, 240)}`);
				toyBridgeScenario.runScenario(ruleKindVerdictUnderMutation(), (unusedKindError, kindTwin) => {
					const kindText = failureTextOf(kindTwin);
					const refusedByName = /ruleKind 'memberByNotation', which matchBasis 'declaredIdentity' does not admit/.test(kindText);
					harness.ok("(i) observed RED under 'memberByNotationAdmitted'", !refusedByName, kindText || 'ADMITTED (no refusal)');
					harness.note(`RED-OBSERVED i twin='memberByNotationAdmitted' → ${(kindText || 'ADMITTED (no refusal)').slice(0, 240)}`);
					harness.report();
				});
			});
		});
	});
};

harness.section('BASELINE — every conjunct');
const runConjunctAt = (conjunctIndex) => {
	if (conjunctIndex >= conjunctList.length) {
		runTwinSweep();
		return;
	}
	const oneConjunct = conjunctList[conjunctIndex];
	oneConjunct.judge((verdict) => {
		harness.ok(`${oneConjunct.refId} PASS`, verdict.pass, verdict.detail);
		runConjunctAt(conjunctIndex + 1);
	});
};
runConjunctAt(0);
