#!/usr/bin/env node
'use strict';

// test-cedsEmbedTextOracle.js — PHASE P6 ORACLE EQUALITY for CEDS (PLAN-forgeEmbedText-091426 §8.3 R-ET-1
// revised, R-ET-17; §8.4 R-ET-28/29; BRIEF-P6-declarations task 4). Forges the REAL CEDS bundle over the
// local CEDS-Ontology.rdf snapshot 01 with skipEmbedding true (no Docker, no Voyage, no network). The
// forge result carries NO hub (the forger folds hub cards after forge() returns), which is why it is
// comparable to the oracle, whose census excluded HubReference/HubDefinition nodes. Asserts:
//   ORACLE   stats.embedTextNodeCount / EdgeCount / AbsentCount / SkippedEmptyCount / TrimmedCount, the
//            counted text nodes and EMBEDS_TEXT_OF edges, and single- vs multi-name edges EQUAL the
//            P1 census (literals below, copied from evidence/P1-textListCensus-v2.log; NEVER edited to
//            match a measurement — a difference is a finding for the supervisor)
//   HYGIENE  every text node carries exactly the labels [CedsEmbedText, DmeEmbedText, ForgedNode],
//            embedSourceProperty 'text', vectorPropertyName 'textEmbedding', and none of name /
//            searchText / embedding / textEmbedding / embeddingModelVersion
//   PREFIX   every text stableId is the literal 'https://w3id.org/CEDStandards/terms/embedText/' + 64 hex
//            (ONE slash: the sourceUrl root already ends with '/')
//   ARRAY    decision 1b: exactly the oracle's ONE multi-element declared value (a description of 2
//            elements) exists, and it yields 2 EMBEDS_TEXT_OF edges naming 'description' on that node
//   DECLARED the shipped embedTextDeclaration is exactly TQ decisions 1 and 1b (no 'alternative')
// Every conjunct has a TWIN run in memory (nothing written into the tree) and observed RED:
//   perturbedDeclarationList  a clone drops 'comment' from DmeProperty → ORACLE and DECLARED red
//   doubleSlashJoin           embedTextDerivation.js compiled to join '/' after a '/' root → PREFIX red
//   carriedForbiddenProperty  embedTextDerivation.js compiled to carry embeddingModelVersion → HYGIENE red
//   arrayFirstElementOnly     embedTextDerivation.js compiled to keep a list's first element → ARRAY red
//
// Run: node forges/ceds/test/test-cedsEmbedTextOracle.js [-verbose]

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- P6 oracle equality: CEDS embed-text counts vs the P1 census, with red twins

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every twin was observed RED;  1 otherwise.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);
const { xLog } = process.global;
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const FRAMEWORK_DIR_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework');
const moduleDouble = require(path.join(FRAMEWORK_DIR_PATH, 'test', 'testSupport', 'moduleDouble'));
const forgeFrameworkLib = require(path.join(FRAMEWORK_DIR_PATH, 'forge-framework'));
const { DME_ROLES, EDGE_TYPES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const cedsForgeDeclaration = require('../lib/cedsForgeDeclaration');
const cedsHooks = require('../lib/cedsHooks')();

const SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const DERIVATION_FILE_PATH = path.join(FRAMEWORK_DIR_PATH, 'embedTextDerivation.js');
const FORGE_FRAMEWORK_FILE_PATH = path.join(FRAMEWORK_DIR_PATH, 'forge-framework.js');

// THE ORACLE — evidence/P1-textListCensus-v2.log, section "=== ceds" (R-ET-17). absent = prefLabel 2,724 +
// comment 3,285 + definition 3 + description 1; emptyAfterTrim none; whitespaceDiffers = definition 35 +
// description 30 + name 9 + prefLabel 5 + comment 2; arrayExpanded description 1, arrayElements 2.
const EMBED_TEXT_ORACLE = Object.freeze({
	embedTextNodeCount: 6684,
	embedTextEdgeCount: 7823,
	singleNameEdgeCount: 3204,
	multiNameEdgeCount: 4619,
	embedTextAbsentCount: 6013,
	embedTextSkippedEmptyCount: 0,
	embedTextTrimmedCount: 81,
});
const ARRAY_ORACLE = Object.freeze({ propertyName: 'description', arrayValuedSourceCount: 1, elementCount: 2 });
const TEXT_NODE_STABLE_ID_PREFIX = 'https://w3id.org/CEDStandards/terms/embedText/';
const TEXT_NODE_LABEL_LIST = Object.freeze(['CedsEmbedText', 'DmeEmbedText', 'ForgedNode']);
const TEXT_NODE_FORBIDDEN_PROPERTY_NAME_LIST = Object.freeze(['name', 'searchText', 'embedding', 'textEmbedding', 'embeddingModelVersion']);
// TQ decisions 1 and 1b, verbatim (PLAN §8.2); the shipped declaration must equal it byte for byte as JSON
const RULED_EMBED_TEXT_DECLARATION = Object.freeze({
	embedTextLabel: 'CedsEmbedText',
	textPropertyListByRole: {
		DmeClass: ['name', 'definition', 'description', 'prefLabel', 'comment'],
		DmeProperty: ['name', 'definition', 'description', 'prefLabel', 'comment'],
		DmeOptionSet: ['name', 'definition', 'description', 'prefLabel', 'comment'],
	},
});

// -----------------------------------------------------------------
// judges — each returns a list of { label, pass, detail }; pure, over one forge result
// -----------------------------------------------------------------
const textNodeListOf = (forgeResult) => forgeResult.nodes.filter((oneNode) => oneNode.role === DME_ROLES.EMBED_TEXT);
const embedsTextEdgeListOf = (forgeResult) => forgeResult.edges.filter((oneEdge) => oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF);

const judgeOracle = ({ forgeResult }) => {
	const embedsTextEdgeList = embedsTextEdgeListOf(forgeResult);
	const multiNameEdgeCount = embedsTextEdgeList.filter((oneEdge) => oneEdge.properties.propertyNameList.length > 1).length;
	const measuredByName = {
		embedTextNodeCount: forgeResult.stats.embedTextNodeCount,
		embedTextEdgeCount: forgeResult.stats.embedTextEdgeCount,
		singleNameEdgeCount: embedsTextEdgeList.length - multiNameEdgeCount,
		multiNameEdgeCount,
		embedTextAbsentCount: forgeResult.stats.embedTextAbsentCount,
		embedTextSkippedEmptyCount: forgeResult.stats.embedTextSkippedEmptyCount,
		embedTextTrimmedCount: forgeResult.stats.embedTextTrimmedCount,
	};
	const checkList = Object.keys(EMBED_TEXT_ORACLE).map((oneName) => ({
		label: `ORACLE ${oneName}: measured ${measuredByName[oneName]} vs oracle ${EMBED_TEXT_ORACLE[oneName]}`,
		pass: measuredByName[oneName] === EMBED_TEXT_ORACLE[oneName],
	}));
	checkList.push({ label: `ORACLE counted text nodes ${textNodeListOf(forgeResult).length} vs oracle ${EMBED_TEXT_ORACLE.embedTextNodeCount}`, pass: textNodeListOf(forgeResult).length === EMBED_TEXT_ORACLE.embedTextNodeCount });
	checkList.push({ label: `ORACLE counted EMBEDS_TEXT_OF edges ${embedsTextEdgeList.length} vs oracle ${EMBED_TEXT_ORACLE.embedTextEdgeCount}`, pass: embedsTextEdgeList.length === EMBED_TEXT_ORACLE.embedTextEdgeCount });
	return checkList;
};

const judgeHygiene = ({ forgeResult }) => {
	const textNodeList = textNodeListOf(forgeResult);
	const offenderListFor = (predicate) => textNodeList.filter(predicate).map((oneNode) => oneNode.stableId);
	const checkList = [
		{ label: 'HYGIENE text nodes exist to judge', pass: textNodeList.length > 0 },
		{ label: `HYGIENE labels exactly ${TEXT_NODE_LABEL_LIST.join(',')}`, offenderList: offenderListFor((oneNode) => (oneNode.labels || []).slice().sort().join(',') !== TEXT_NODE_LABEL_LIST.join(',')) },
		{ label: "HYGIENE embedSourceProperty === 'text'", offenderList: offenderListFor((oneNode) => oneNode.properties.embedSourceProperty !== 'text') },
		{ label: "HYGIENE vectorPropertyName === 'textEmbedding'", offenderList: offenderListFor((oneNode) => oneNode.properties.vectorPropertyName !== 'textEmbedding') },
	];
	TEXT_NODE_FORBIDDEN_PROPERTY_NAME_LIST.forEach((onePropertyName) => {
		checkList.push({ label: `HYGIENE no text node carries ${onePropertyName} (skipEmbedding)`, offenderList: offenderListFor((oneNode) => Object.prototype.hasOwnProperty.call(oneNode.properties, onePropertyName)) });
	});
	return checkList.map((oneCheck) =>
		oneCheck.offenderList === undefined ? oneCheck : { label: oneCheck.label, pass: oneCheck.offenderList.length === 0, detail: `${oneCheck.offenderList.length} offender(s), e.g. ${oneCheck.offenderList.slice(0, 2).join(' ')}` },
	);
};

const judgePrefix = ({ forgeResult }) => {
	const textNodeList = textNodeListOf(forgeResult);
	const offenderList = textNodeList
		.filter((oneNode) => !oneNode.stableId.startsWith(TEXT_NODE_STABLE_ID_PREFIX) || !/^[0-9a-f]{64}$/.test(oneNode.stableId.slice(TEXT_NODE_STABLE_ID_PREFIX.length)))
		.map((oneNode) => oneNode.stableId);
	return [{ label: `PREFIX every text stableId is '${TEXT_NODE_STABLE_ID_PREFIX}' + 64 hex`, pass: textNodeList.length > 0 && offenderList.length === 0, detail: `${offenderList.length} offender(s), e.g. ${offenderList.slice(0, 2).join(' ')}` }];
};

const judgeArray = ({ forgeResult, forgeDeclaration }) => {
	const textPropertyListByRole = forgeDeclaration.embedTextDeclaration.textPropertyListByRole;
	const arrayValuedSourceNodeList = forgeResult.nodes.filter((oneNode) => {
		const declaredPropertyNameList = textPropertyListByRole[oneNode.role] || [];
		return declaredPropertyNameList.some((onePropertyName) => Array.isArray(oneNode.properties[onePropertyName]) && oneNode.properties[onePropertyName].length > 1);
	});
	const checkList = [
		{ label: `ARRAY exactly ${ARRAY_ORACLE.arrayValuedSourceCount} source node carries a multi-element declared value (oracle arrayExpanded)`, pass: arrayValuedSourceNodeList.length === ARRAY_ORACLE.arrayValuedSourceCount, detail: arrayValuedSourceNodeList.map((oneNode) => oneNode.stableId).join(' ') },
	];
	arrayValuedSourceNodeList.forEach((oneSourceNode) => {
		const namingEdgeList = embedsTextEdgeListOf(forgeResult).filter((oneEdge) => oneEdge.toRef.id === oneSourceNode.stableId && oneEdge.properties.propertyNameList.indexOf(ARRAY_ORACLE.propertyName) !== -1);
		checkList.push({ label: `ARRAY ${oneSourceNode.stableId} '${ARRAY_ORACLE.propertyName}' of ${ARRAY_ORACLE.elementCount} elements yields ${ARRAY_ORACLE.elementCount} EMBEDS_TEXT_OF edges naming it`, pass: namingEdgeList.length === ARRAY_ORACLE.elementCount, detail: `measured ${namingEdgeList.length}` });
	});
	return checkList;
};

const judgeDeclared = ({ forgeDeclaration }) => [
	{ label: "DECLARED embedTextDeclaration equals TQ decisions 1 and 1b (label, roles, list order, no 'alternative')", pass: JSON.stringify(forgeDeclaration.embedTextDeclaration) === JSON.stringify(RULED_EMBED_TEXT_DECLARATION), detail: JSON.stringify(forgeDeclaration.embedTextDeclaration) },
];

const JUDGE_BY_CONJUNCT_NAME = Object.freeze({ ORACLE: judgeOracle, HYGIENE: judgeHygiene, PREFIX: judgePrefix, ARRAY: judgeArray, DECLARED: judgeDeclared });

// -----------------------------------------------------------------
// twins — each names the conjuncts it must turn RED and those it must leave GREEN
// -----------------------------------------------------------------
const perturbedDeclaration = Object.freeze({
	...cedsForgeDeclaration,
	embedTextDeclaration: {
		embedTextLabel: cedsForgeDeclaration.embedTextDeclaration.embedTextLabel,
		textPropertyListByRole: { ...cedsForgeDeclaration.embedTextDeclaration.textPropertyListByRole, DmeProperty: ['name', 'definition', 'description', 'prefLabel'] },
	},
});
const DERIVATION_JOIN_FIND = "const stableIdJoinText = rootStableId.endsWith('/') ? '' : '/';";
const DERIVATION_CARRIED_FIND = 'vectorPropertyName: EMBED_TEXT_VECTOR.propertyName,';
const DERIVATION_ARRAY_RETURN_FIND = 'return rawValue;';

const TWIN_LIST = Object.freeze([
	{ twinName: 'perturbedDeclarationList', forgeDeclaration: perturbedDeclaration, mutationList: [], redConjunctNameList: ['ORACLE', 'DECLARED'], greenConjunctNameList: ['PREFIX', 'HYGIENE', 'ARRAY'] },
	{ twinName: 'doubleSlashJoin', forgeDeclaration: cedsForgeDeclaration, mutationList: [{ modulePath: DERIVATION_FILE_PATH, find: DERIVATION_JOIN_FIND, replace: "const stableIdJoinText = rootStableId.endsWith('/') ? '/' : '//';" }], redConjunctNameList: ['PREFIX'], greenConjunctNameList: ['ORACLE', 'HYGIENE', 'ARRAY'] },
	{ twinName: 'carriedForbiddenProperty', forgeDeclaration: cedsForgeDeclaration, mutationList: [{ modulePath: DERIVATION_FILE_PATH, find: DERIVATION_CARRIED_FIND, replace: `${DERIVATION_CARRIED_FIND} embeddingModelVersion: 'twin-carried',` }], redConjunctNameList: ['HYGIENE'], greenConjunctNameList: ['ORACLE', 'PREFIX', 'ARRAY'] },
	// the first-element-only twin also moves the counts by the one lost text, so ORACLE is not in its green list
	{ twinName: 'arrayFirstElementOnly', forgeDeclaration: cedsForgeDeclaration, mutationList: [{ modulePath: DERIVATION_FILE_PATH, find: DERIVATION_ARRAY_RETURN_FIND, replace: 'return rawValue.slice(0, 1);' }], redConjunctNameList: ['ARRAY'], greenConjunctNameList: ['PREFIX', 'HYGIENE'] },
]);

// forgeWith — the real hooks, a (possibly cloned) declaration, a (possibly compiled-with-mutations) framework
const forgeWith = ({ forgeDeclaration, mutationList }, callback) => {
	const frameworkFactory = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: FORGE_FRAMEWORK_FILE_PATH, mutationList }) : forgeFrameworkLib;
	const bundle = frameworkFactory({ embedder: null }).injectStandardHooks({ forgeDeclaration, hooks: cedsHooks });
	bundle.forge({ sourcePath: SNAPSHOT_PATH, owner: moduleName, skipEmbedding: true }, callback);
};

const failingCheckListFor = ({ conjunctName, forgeResult, forgeDeclaration }) =>
	JUDGE_BY_CONJUNCT_NAME[conjunctName]({ forgeResult, forgeDeclaration }).filter((oneCheck) => !oneCheck.pass);

// -----------------------------------------------------------------
// the run
// -----------------------------------------------------------------
const taskList = new taskListPlus();

taskList.push((args, next) => {
	harness.section('REAL: the shipped CEDS bundle declaration, forged with skipEmbedding true');
	forgeWith({ forgeDeclaration: cedsForgeDeclaration, mutationList: [] }, (forgeError, forgeResult) => {
		harness.accepts('the real CEDS forge succeeds', forgeError ? [forgeError] : []);
		if (forgeError) {
			next(`real forge refused: ${forgeError}`);
			return;
		}
		Object.keys(JUDGE_BY_CONJUNCT_NAME).forEach((conjunctName) =>
			JUDGE_BY_CONJUNCT_NAME[conjunctName]({ forgeResult, forgeDeclaration: cedsForgeDeclaration }).forEach((oneCheck) => harness.ok(oneCheck.label, oneCheck.pass, oneCheck.detail)),
		);
		next('', args);
	});
});

TWIN_LIST.forEach((oneTwin) => {
	taskList.push((args, next) => {
		harness.section(`TWIN ${oneTwin.twinName}: must turn ${oneTwin.redConjunctNameList.join(', ')} RED and leave ${oneTwin.greenConjunctNameList.join(', ')} green`);
		oneTwin.mutationList.forEach((oneMutation) => moduleDouble.assertMutationApplies(oneMutation));
		forgeWith(oneTwin, (forgeError, forgeResult) => {
			// a twin the forge REFUSES proved nothing about the judge: the red must come from the judge
			harness.accepts(`twin ${oneTwin.twinName} forges (its red is the judge's, not a refusal)`, forgeError ? [forgeError] : []);
			if (forgeError) {
				next('', args);
				return;
			}
			oneTwin.redConjunctNameList.forEach((conjunctName) => {
				const failingCheckList = failingCheckListFor({ conjunctName, forgeResult, forgeDeclaration: oneTwin.forgeDeclaration });
				harness.ok(`twin ${oneTwin.twinName} observed ${conjunctName} RED`, failingCheckList.length > 0, 'no check of the conjunct failed under the twin');
				xLog.verbose(`       red because: ${failingCheckList.map((oneCheck) => `${oneCheck.label}${oneCheck.detail ? ` [${oneCheck.detail}]` : ''}`).join(' | ')}`);
			});
			oneTwin.greenConjunctNameList.forEach((conjunctName) => {
				const failingCheckList = failingCheckListFor({ conjunctName, forgeResult, forgeDeclaration: oneTwin.forgeDeclaration });
				harness.ok(`twin ${oneTwin.twinName} leaves ${conjunctName} green (the red is specific)`, failingCheckList.length === 0, failingCheckList.map((oneCheck) => oneCheck.label).join(' | '));
			});
			next('', args);
		});
	});
});

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to completion', false, pipeError);
	}
	harness.report();
});
