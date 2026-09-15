#!/usr/bin/env node
'use strict';

// test-sifEmbedTextOracle.js — PHASE P9 ORACLE EQUALITY for SIF (PLAN-forgeEmbedText-091426 §8.3 R-ET-17,
// §8.4 R-ET-29; BRIEF-P9-sifPescDeclarations task 3). Forges the REAL SIF bundle over the committed
// Implementation-Specification snapshot 01 with skipEmbedding true (no Docker, no Voyage, no network) and
// asserts:
//   ORACLE   stats.embedTextNodeCount / EdgeCount / AbsentCount / SkippedEmptyCount / TrimmedCount, the
//            counted text nodes and EMBEDS_TEXT_OF edges, single- vs multi-name edges, and per role the
//            nodes, nodes with text and uses by property name EQUAL the P1 census (literals below, copied
//            from evidence/P1-textListCensus-v2.log; NEVER edited to match a measurement — a difference is
//            a finding for the supervisor)
//   HYGIENE  every text node carries exactly the labels [DmeEmbedText, ForgedNode, SifEmbedText],
//            embedSourceProperty 'text', vectorPropertyName 'textEmbedding', and none of name /
//            searchText / embedding / textEmbedding / embeddingModelVersion
//   PREFIX   every text stableId is the literal 'sif:root/embedText/' + 64 hex (ONE slash); the root is
//            the declared literal 'sif:root' (sifForgeDeclaration rootStableIdFrom 'declared'), checked
//            against the SifRoot node the forge actually minted
//   DECLARED the shipped embedTextDeclaration is exactly TQ decision 1 (label, roles, list order)
// The oracle found NO multi-element declared value in SIF (COUNTS arrayExpanded {}), so there is no ARRAY
// conjunct (as Ed-Fi); an expansion would move the per-role uses, which ORACLE asserts.
// Every conjunct has a TWIN run in memory (nothing written into the tree) and observed RED:
//   perturbedDeclarationList  a clone of the declaration drops 'description' from DmeProperty → ORACLE
//                             and DECLARED red
//   doubleSlashJoin           embedTextDerivation.js compiled with a '//' join → PREFIX red (ORACLE green:
//                             the twin moves the id, not the counts)
//   carriedForbiddenProperty  embedTextDerivation.js compiled to carry embeddingModelVersion → HYGIENE red
//
// Run: node forges/sif/test/test-sifEmbedTextOracle.js [-verbose]

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- P9 oracle equality: SIF embed-text counts vs the P1 census, with red twins

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
const sifForgeDeclaration = require('../lib/sifForgeDeclaration');
const sifHooks = require('../lib/sifHooks')();

const SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const DERIVATION_FILE_PATH = path.join(FRAMEWORK_DIR_PATH, 'embedTextDerivation.js');
const FORGE_FRAMEWORK_FILE_PATH = path.join(FRAMEWORK_DIR_PATH, 'forge-framework.js');

// THE ORACLE — evidence/P1-textListCensus-v2.log, section "=== sif" (R-ET-17). absent none; emptyAfterTrim
// = 5,929 description; whitespaceDiffers none; arrayExpanded none.
const EMBED_TEXT_ORACLE = Object.freeze({
	embedTextNodeCount: 3855,
	embedTextEdgeCount: 27700,
	singleNameEdgeCount: 27697,
	multiNameEdgeCount: 3,
	embedTextAbsentCount: 0,
	embedTextSkippedEmptyCount: 5929,
	embedTextTrimmedCount: 0,
});
// the same log's per-role lines: nodes | with text | uses by property name
const ROLE_CENSUS_ORACLE = Object.freeze({
	DmeClass: Object.freeze({ nodes: 1056, withText: 1056, usesByPropertyName: Object.freeze({ name: 1056 }) }),
	DmeProperty: Object.freeze({ nodes: 15620, withText: 15620, usesByPropertyName: Object.freeze({ description: 10887, name: 15620 }) }),
	DmeOptionSet: Object.freeze({ nodes: 140, withText: 140, usesByPropertyName: Object.freeze({ name: 140 }) }),
});
// the root is DECLARED (sifForgeDeclaration.rootStableId 'sif:root'), so the text-id prefix is that literal
// + '/embedText/' — frozen here as a string, and the minted root is checked against it
const ROOT_STABLE_ID = 'sif:root';
const ROOT_LABEL = 'SifRoot';
const TEXT_NODE_STABLE_ID_PREFIX = 'sif:root/embedText/';
const TEXT_NODE_LABEL_LIST = Object.freeze(['DmeEmbedText', 'ForgedNode', 'SifEmbedText']);
const TEXT_NODE_FORBIDDEN_PROPERTY_NAME_LIST = Object.freeze(['name', 'searchText', 'embedding', 'textEmbedding', 'embeddingModelVersion']);
// TQ decision 1, verbatim (PLAN §8.2); the shipped declaration must equal it byte for byte as JSON
const RULED_EMBED_TEXT_DECLARATION = Object.freeze({
	embedTextLabel: 'SifEmbedText',
	textPropertyListByRole: {
		DmeClass: ['name', 'description'],
		DmeProperty: ['name', 'description'],
		DmeOptionSet: ['name', 'description'],
	},
});

// -----------------------------------------------------------------
// judges — each returns a list of { label, pass, detail }; pure, over one forge result
// -----------------------------------------------------------------
const textNodeListOf = (forgeResult) => forgeResult.nodes.filter((oneNode) => oneNode.role === DME_ROLES.EMBED_TEXT);
const embedsTextEdgeListOf = (forgeResult) => forgeResult.edges.filter((oneEdge) => oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF);

// sortedCountText — a count table as JSON with its names in order, so two tables compare by content
const sortedCountText = (countByName) => JSON.stringify(Object.keys(countByName).sort().map((oneName) => [oneName, countByName[oneName]]));

// measuredRoleCensusOf — per oracle role: nodes of the role, those an EMBEDS_TEXT_OF edge reaches, and the
// uses by property name read back from the edges' propertyNameList (the census's "uses")
const measuredRoleCensusOf = (forgeResult) => {
	const roleByStableId = {};
	forgeResult.nodes.forEach((oneNode) => {
		roleByStableId[oneNode.stableId] = oneNode.role;
	});
	const roleCensusByRole = {};
	Object.keys(ROLE_CENSUS_ORACLE).forEach((oneRole) => {
		roleCensusByRole[oneRole] = { nodes: forgeResult.nodes.filter((oneNode) => oneNode.role === oneRole).length, withTextStableIdSet: new Set(), usesByPropertyName: {} };
	});
	embedsTextEdgeListOf(forgeResult).forEach((oneEdge) => {
		const roleCensus = roleCensusByRole[roleByStableId[oneEdge.toRef.id]];
		if (roleCensus === undefined) {
			return;
		}
		roleCensus.withTextStableIdSet.add(oneEdge.toRef.id);
		oneEdge.properties.propertyNameList.forEach((onePropertyName) => {
			roleCensus.usesByPropertyName[onePropertyName] = (roleCensus.usesByPropertyName[onePropertyName] || 0) + 1;
		});
	});
	return roleCensusByRole;
};

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
	const measuredRoleCensusByRole = measuredRoleCensusOf(forgeResult);
	Object.keys(ROLE_CENSUS_ORACLE).forEach((oneRole) => {
		const oracleRole = ROLE_CENSUS_ORACLE[oneRole];
		const measuredRole = measuredRoleCensusByRole[oneRole];
		checkList.push({ label: `ORACLE ${oneRole} nodes: measured ${measuredRole.nodes} vs oracle ${oracleRole.nodes}`, pass: measuredRole.nodes === oracleRole.nodes });
		checkList.push({ label: `ORACLE ${oneRole} with text: measured ${measuredRole.withTextStableIdSet.size} vs oracle ${oracleRole.withText}`, pass: measuredRole.withTextStableIdSet.size === oracleRole.withText });
		checkList.push({
			label: `ORACLE ${oneRole} uses by property name: measured ${sortedCountText(measuredRole.usesByPropertyName)} vs oracle ${sortedCountText(oracleRole.usesByPropertyName)}`,
			pass: sortedCountText(measuredRole.usesByPropertyName) === sortedCountText(oracleRole.usesByPropertyName),
		});
	});
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
	const rootNodeList = forgeResult.nodes.filter((oneNode) => (oneNode.labels || []).includes(ROOT_LABEL));
	const offenderList = textNodeList
		.filter((oneNode) => !oneNode.stableId.startsWith(TEXT_NODE_STABLE_ID_PREFIX) || !/^[0-9a-f]{64}$/.test(oneNode.stableId.slice(TEXT_NODE_STABLE_ID_PREFIX.length)))
		.map((oneNode) => oneNode.stableId);
	return [
		{ label: `PREFIX the forge minted exactly one ${ROOT_LABEL}, stableId '${ROOT_STABLE_ID}', and the frozen prefix is it + '/embedText/'`, pass: rootNodeList.length === 1 && rootNodeList[0].stableId === ROOT_STABLE_ID && `${ROOT_STABLE_ID}/embedText/` === TEXT_NODE_STABLE_ID_PREFIX, detail: rootNodeList.map((oneNode) => oneNode.stableId).join(' ') },
		{ label: `PREFIX every text stableId is '${TEXT_NODE_STABLE_ID_PREFIX}' + 64 hex`, pass: textNodeList.length > 0 && offenderList.length === 0, detail: `${offenderList.length} offender(s), e.g. ${offenderList.slice(0, 2).join(' ')}` },
	];
};

const judgeDeclared = ({ forgeDeclaration }) => [
	{ label: 'DECLARED embedTextDeclaration equals TQ decision 1 (label, roles, list order)', pass: JSON.stringify(forgeDeclaration.embedTextDeclaration) === JSON.stringify(RULED_EMBED_TEXT_DECLARATION), detail: JSON.stringify(forgeDeclaration.embedTextDeclaration) },
];

const JUDGE_BY_CONJUNCT_NAME = Object.freeze({ ORACLE: judgeOracle, HYGIENE: judgeHygiene, PREFIX: judgePrefix, DECLARED: judgeDeclared });

// -----------------------------------------------------------------
// twins — each names the conjuncts it must turn RED and those it must leave GREEN
// -----------------------------------------------------------------
const perturbedDeclaration = Object.freeze({
	...sifForgeDeclaration,
	embedTextDeclaration: {
		embedTextLabel: sifForgeDeclaration.embedTextDeclaration.embedTextLabel,
		textPropertyListByRole: { ...sifForgeDeclaration.embedTextDeclaration.textPropertyListByRole, DmeProperty: ['name'] },
	},
});
const DERIVATION_JOIN_FIND = "const stableIdJoinText = rootStableId.endsWith('/') ? '' : '/';";
const DERIVATION_CARRIED_FIND = 'vectorPropertyName: EMBED_TEXT_VECTOR.propertyName,';

const TWIN_LIST = Object.freeze([
	{ twinName: 'perturbedDeclarationList', forgeDeclaration: perturbedDeclaration, mutationList: [], redConjunctNameList: ['ORACLE', 'DECLARED'], greenConjunctNameList: ['PREFIX', 'HYGIENE'] },
	{ twinName: 'doubleSlashJoin', forgeDeclaration: sifForgeDeclaration, mutationList: [{ modulePath: DERIVATION_FILE_PATH, find: DERIVATION_JOIN_FIND, replace: "const stableIdJoinText = rootStableId.endsWith('/') ? '/' : '//';" }], redConjunctNameList: ['PREFIX'], greenConjunctNameList: ['ORACLE', 'HYGIENE'] },
	{ twinName: 'carriedForbiddenProperty', forgeDeclaration: sifForgeDeclaration, mutationList: [{ modulePath: DERIVATION_FILE_PATH, find: DERIVATION_CARRIED_FIND, replace: `${DERIVATION_CARRIED_FIND} embeddingModelVersion: 'twin-carried',` }], redConjunctNameList: ['HYGIENE'], greenConjunctNameList: ['ORACLE', 'PREFIX'] },
]);

// forgeWith — the real hooks, a (possibly cloned) declaration, a (possibly compiled-with-mutations) framework
const forgeWith = ({ forgeDeclaration, mutationList }, callback) => {
	const frameworkFactory = mutationList.length ? moduleDouble.loadWithMutations({ modulePath: FORGE_FRAMEWORK_FILE_PATH, mutationList }) : forgeFrameworkLib;
	const bundle = frameworkFactory({ embedder: null }).injectStandardHooks({ forgeDeclaration, hooks: sifHooks });
	bundle.forge({ sourcePath: SNAPSHOT_PATH, owner: moduleName, skipEmbedding: true }, callback);
};

const failingCheckListFor = ({ conjunctName, forgeResult, forgeDeclaration }) =>
	JUDGE_BY_CONJUNCT_NAME[conjunctName]({ forgeResult, forgeDeclaration }).filter((oneCheck) => !oneCheck.pass);

// -----------------------------------------------------------------
// the run
// -----------------------------------------------------------------
const taskList = new taskListPlus();

taskList.push((args, next) => {
	harness.section('REAL: the shipped SIF bundle declaration, forged with skipEmbedding true');
	forgeWith({ forgeDeclaration: sifForgeDeclaration, mutationList: [] }, (forgeError, forgeResult) => {
		harness.accepts('the real SIF forge succeeds', forgeError ? [forgeError] : []);
		if (forgeError) {
			next(`real forge refused: ${forgeError}`);
			return;
		}
		Object.keys(JUDGE_BY_CONJUNCT_NAME).forEach((conjunctName) =>
			JUDGE_BY_CONJUNCT_NAME[conjunctName]({ forgeResult, forgeDeclaration: sifForgeDeclaration }).forEach((oneCheck) => harness.ok(oneCheck.label, oneCheck.pass, oneCheck.detail)),
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
