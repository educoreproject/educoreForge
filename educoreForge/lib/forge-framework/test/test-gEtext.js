#!/usr/bin/env node
'use strict';

// test-gEtext.js — G-ETEXT (PLAN-forgeEmbedText-091426 §8.3-8.5; BRIEF-P3-forgeFramework): the framework
// mints one DmeEmbedText node per distinct declared text and one EMBEDS_TEXT_OF edge per (text, node)
// pair, embeds those texts in its own pass under textEmbedding, and changes NOTHING when every
// declaration is null. Conjunct letters follow the brief:
//   a  null is a no-op (no text node, no edge, no embedText* stat, toy proxy EQUALS the frozen literal)
//   b  one node per DISTINCT trimmed text; stats carry the five counts; text nodes follow the walk's
//   c  one edge per (text, node) pair; two properties sharing a text → ONE edge, propertyNameList of 2
//   d  a text node's property set (no name / searchText / embedding)
//   e  stableId form under the toy pattern AND a CEDS-shaped pattern (one slash after a '/' root)
//   f  ordering: a walk returning COPIES still composes; a hook-minted DmeEmbedText node (R-ET-35) or
//      hook-added EMBEDS_TEXT_OF edge (R-ET-38) is refused
//   g  determinism, including under a permuted walk emission order
//   h  the legacy pass never sees a text node; the text pass sends exactly the distinct texts
//   i  skipEmbedding skips the text pass;  j  embedNodeLimit bounds the text pass
//   k  declaration refusals, and a text node without text refused by the pass
//   l  value rules: absent / empty-after-trim / padded / arrays / NUL / non-string
//   m  the proxy drops textEmbedding;  n  the pass stamps the CARRIED embeddingModelVersion
// Every conjunct has a twin observed red. Twins on the DECLARED toy (a test-only declaration, never
// shipped) are registered shippedConfig:false.
//
// Run: node lib/forge-framework/test/test-gEtext.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-ETEXT: framework-minted embed-text nodes, their edges, their pass, their refusals

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const crypto = require('crypto');
const toyScenario = require('./testSupport/toyScenario');
const moduleDouble = require('./testSupport/moduleDouble');
const { frameworkMutationTwin, scenarioTwin, refusalCase, shapedConjunct, succeeded, frameworkFile } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const censusLib = require('../census');
const { DME_ROLES, EDGE_TYPES } = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));
const expectedFingerprints = require('./acceptance/expectedFingerprints.json');

const GATE_ID = 'G-ETEXT';
const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'forge-framework.js';
const KIT_FILE = 'contractGraphKit.js';
const CONTRACT_FILE = 'forgeDeclarationContract.js';
const DERIVATION_FILE = 'embedTextDerivation.js';
const TEXT_PASS_FILE = 'embedTextPass.js';
const EMBED_FILE = 'embedPass.js';
const FINGERPRINT_FILE = 'fingerprint.js';
const FROZEN_TOY_FINGERPRINT = expectedFingerprints.byStandardKey.toy;
const TOY_WALK_EMBEDDABLE_COUNT = 15; // 16 walk nodes − the one DmeSupport
const SPY_MODEL_VERSION = 'toy-embed-1';
const SPY_DIMS = 4;
const NUL_CHARACTER = String.fromCharCode(0);
const PERSON_DESCRIPTION = 'A human being known to the toy system.';

// the DECLARED toy — test-only, never shipped (the shipped toy declares null)
const DECLARED_TOY_EMBED_TEXT_DECLARATION = Object.freeze({
	embedTextLabel: 'ToyEmbedText',
	textPropertyListByRole: Object.freeze({
		[DME_ROLES.CLASS]: Object.freeze(['name', 'description', 'synonymList']),
		[DME_ROLES.PROPERTY]: Object.freeze(['name', 'description', 'dataType']),
		[DME_ROLES.OPTION_SET]: Object.freeze(['name', 'description']),
	}),
});

// ---------------------------------------------------------------------------------------------
// scenario shaping
// ---------------------------------------------------------------------------------------------
const withDeclaredToy = (scenario) => {
	scenario.forgeDeclaration.embedTextDeclaration = toyScenario.cloneJson(DECLARED_TOY_EMBED_TEXT_DECLARATION);
};
const withSpy = (scenario, spyOptions) => {
	scenario.spyEmbedder = toyScenario.makeSpyEmbedder({ dims: SPY_DIMS, modelVersion: SPY_MODEL_VERSION, ...spyOptions });
	scenario.deps = { ...scenario.deps, embedder: scenario.spyEmbedder };
	scenario.forgeArgs = { ...scenario.forgeArgs, skipEmbedding: false };
};
// the toy walk, then `extra` with the kit, BEFORE the return; `extra` may replace the walk's result
const withWalkExtra = (scenario, extra) => {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.emitContractGraph = (context) => {
		const walkResult = baseHooks.emitContractGraph(context);
		const extraResult = extra(context, walkResult);
		return extraResult === undefined ? walkResult : extraResult;
	};
};
const mintExtraClass = (kit, { stableId, name, description, synonymList }) =>
	kit.makeNode({
		role: DME_ROLES.CLASS,
		perStandardLabel: 'ToyClass',
		stableId,
		name,
		...(description === undefined ? {} : { description }),
		structural: { parentId: kit.rootStableId, path: name },
		...(synonymList === undefined ? {} : { carriedProperties: { synonymList } }),
		origin: 'test:gEtext',
	});
const withExtraClass = (scenario, classArgs) => withWalkExtra(scenario, ({ kit }) => { mintExtraClass(kit, classArgs); });
// the toy walk over the model with its classes in REVERSED order (a permuted emission order)
const withClassesReversed = (scenario) => {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.emitContractGraph = (context) => {
		const model = context.parsed.toyModel.model;
		const reversedParsed = { ...context.parsed, toyModel: { ...context.parsed.toyModel, model: { ...model, classes: model.classes.slice().reverse() } } };
		return baseHooks.emitContractGraph({ ...context, parsed: reversedParsed });
	};
};

// a framework module, through the double when the scenario carries mutations
const frameworkModuleFor = (scenario, fileName) =>
	scenario.frameworkMutationList.length
		? moduleDouble.loadWithMutations({ modulePath: frameworkFile(fileName), mutationList: scenario.frameworkMutationList })
		: require(frameworkFile(fileName));

// ---------------------------------------------------------------------------------------------
// observation helpers and the INDEPENDENT oracle (re-derived from the walk's nodes, not from the module)
// ---------------------------------------------------------------------------------------------
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const textNodesOf = (result) => result.nodes.filter((oneNode) => oneNode.role === DME_ROLES.EMBED_TEXT);
const textEdgesOf = (result) => result.edges.filter((oneEdge) => oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF);
const textNodeWithText = (result, text) => textNodesOf(result).find((oneNode) => oneNode.properties.text === text);
const edgesFromTextNode = (result, textNode) => textEdgesOf(result).filter((oneEdge) => textNode !== undefined && oneEdge.fromRef.id === textNode.stableId);
const embedTextStatNameList = (stats) => Object.keys(stats).filter((oneName) => /^embedText/.test(oneName));

const oracleFor = (result, declaration) => {
	const textSet = {};
	const pairSet = {};
	const counts = { absent: 0, skippedEmpty: 0, trimmed: 0 };
	result.nodes.filter((oneNode) => oneNode.role !== DME_ROLES.EMBED_TEXT).forEach((oneNode) => {
		const propertyNameList = declaration.textPropertyListByRole[oneNode.role];
		if (propertyNameList === undefined) {
			return;
		}
		propertyNameList.forEach((onePropertyName) => {
			const rawValue = oneNode.properties[onePropertyName];
			if (rawValue === undefined || rawValue === null) {
				counts.absent += 1;
				return;
			}
			(Array.isArray(rawValue) ? rawValue : [rawValue]).forEach((oneValue) => {
				const text = oneValue.trim();
				if (text === '') {
					counts.skippedEmpty += 1;
					return;
				}
				if (text !== oneValue) {
					counts.trimmed += 1;
				}
				textSet[text] = true;
				pairSet[JSON.stringify([text, oneNode.stableId])] = true;
			});
		});
	});
	return { distinctTextList: Object.keys(textSet).sort(), pairCount: Object.keys(pairSet).length, ...counts };
};

// ---------------------------------------------------------------------------------------------
// the conjuncts
// ---------------------------------------------------------------------------------------------
const conjunctList = [];

// a — null is a no-op, by literal
conjunctList.push(shapedConjunct({
	conjunctId: 'a_nullIsNoOp',
	title: `null declaration (shipped toy) → zero DmeEmbedText nodes, zero EMBEDS_TEXT_OF edges, no embedText* stat, and the toy PROXY EQUALS the frozen ${FROZEN_TOY_FINGERPRINT.slice(0, 12)}…`,
	twinNameList: ['mintOneTextNodeUnderNull'],
	judge: succeeded((result) => {
		const fingerprint = require(frameworkFile(FINGERPRINT_FILE)).pureLayerFingerprint({ nodes: result.nodes, edges: result.edges });
		const statNameList = embedTextStatNameList(result.stats);
		const pass = textNodesOf(result).length === 0 && textEdgesOf(result).length === 0 && statNameList.length === 0 && fingerprint === FROZEN_TOY_FINGERPRINT;
		return { pass, detail: `text nodes ${textNodesOf(result).length}, text edges ${textEdgesOf(result).length}, embedText stats [${statNameList.join(', ')}], PROXY ${fingerprint} vs frozen ${FROZEN_TOY_FINGERPRINT}` };
	}),
}));
frameworkMutationTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'a_nullIsNoOp', twinName: 'mintOneTextNodeUnderNull', fileName: DERIVATION_FILE,
	find: '\tif (embedTextDeclaration === null) {\n\t\treturn NULL_DECLARATION_REPORT;',
	replace: "\tif (embedTextDeclaration === null) {\n\t\tkit.makeNode({ role: DME_ROLES.EMBED_TEXT, perStandardLabel: 'ToyEmbedText', stableId: `${kit.rootStableId}/embedText/twin`, structural: { parentId: kit.rootStableId, path: 'embedText/twin' }, carriedProperties: { text: 'twin' }, origin: 'twin' });\n\t\treturn NULL_DECLARATION_REPORT;",
});

// b — one node per distinct text
conjunctList.push(shapedConjunct({
	conjunctId: 'b_oneNodePerDistinctText',
	title: 'declared toy → text-node count EQUALS the oracle distinct-text count; a text on two nodes ("string") is ONE node with TWO edges; stats carry the five counts EQUAL to the oracle; text nodes follow every walk node',
	twinNameList: ['hashTextWithSourceStableId', 'alwaysConcatTextNodes', 'dropStatsCopy'],
	shape: (scenario) => withDeclaredToy(scenario),
	judge: succeeded((result) => {
		const oracle = oracleFor(result, DECLARED_TOY_EMBED_TEXT_DECLARATION);
		const textNodeList = textNodesOf(result);
		const sharedTextNode = textNodeWithText(result, 'string');
		const firstTextIndex = result.nodes.findIndex((oneNode) => oneNode.role === DME_ROLES.EMBED_TEXT);
		const lastWalkIndex = result.nodes.map((oneNode) => oneNode.role !== DME_ROLES.EMBED_TEXT).lastIndexOf(true);
		const stats = result.stats;
		const pass =
			textNodeList.length === oracle.distinctTextList.length &&
			edgesFromTextNode(result, sharedTextNode).length === 2 &&
			stats.embedTextNodeCount === textNodeList.length &&
			stats.embedTextEdgeCount === textEdgesOf(result).length &&
			stats.embedTextEdgeCount === oracle.pairCount &&
			stats.embedTextAbsentCount === oracle.absent &&
			stats.embedTextSkippedEmptyCount === oracle.skippedEmpty &&
			stats.embedTextTrimmedCount === oracle.trimmed &&
			firstTextIndex > lastWalkIndex;
		return { pass, detail: `text nodes ${textNodeList.length} vs oracle ${oracle.distinctTextList.length}; "string" edges ${edgesFromTextNode(result, sharedTextNode).length}; stats ${JSON.stringify(embedTextStatNameList(stats).reduce((soFar, oneName) => ({ ...soFar, [oneName]: stats[oneName] }), {}))} vs oracle pairs ${oracle.pairCount} absent ${oracle.absent}; first text index ${firstTextIndex}, last walk index ${lastWalkIndex}` };
	}),
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'b_oneNodePerDistinctText', twinName: 'hashTextWithSourceStableId', fileName: DERIVATION_FILE, shippedConfig: false, find: 'sha256Hex(oneOccurrence.text)}', replace: 'sha256Hex(oneOccurrence.text + oneOccurrence.sourceStableId)}' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'b_oneNodePerDistinctText', twinName: 'alwaysConcatTextNodes', fileName: FRAMEWORK_FILE, shippedConfig: false, find: '\t\t\t\tconst nodes = returnedNodes === kitInternals.nodes ? returnedNodes : returnedNodes.concat(embedTextNodeList);', replace: '\t\t\t\tconst nodes = returnedNodes.concat(embedTextNodeList);' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'b_oneNodePerDistinctText', twinName: 'dropStatsCopy', fileName: FRAMEWORK_FILE, shippedConfig: false, find: '\t\t\t\t\twalkStats[oneStatName] = embedTextReport[oneStatName];', replace: '\t\t\t\t\tvoid oneStatName;' });

// c — one edge per (text, node) pair
conjunctList.push(shapedConjunct({
	conjunctId: 'c_oneEdgePerPair',
	title: "a node whose name and description share a text ('Echo') → ONE EMBEDS_TEXT_OF edge with propertyNameList ['description','name'], and collisionCensus.duplicateEdgeTripleCount EQUALS 0",
	twinNameList: ['oneEdgePerPropertyUse'],
	shape: (scenario) => { withDeclaredToy(scenario); withExtraClass(scenario, { stableId: 'toy:class/Echo', name: 'Echo', description: 'Echo' }); },
	judge: succeeded((result) => {
		const echoEdgeList = textEdgesOf(result).filter((oneEdge) => oneEdge.toRef.id === 'toy:class/Echo' && oneEdge.fromRef.id === textNodeWithText(result, 'Echo').stableId);
		const census = censusLib.collisionCensus({ nodes: result.nodes, edges: result.edges });
		const pass = echoEdgeList.length === 1 && JSON.stringify(echoEdgeList[0].properties.propertyNameList) === JSON.stringify(['description', 'name']) && census.duplicateEdgeTripleCount === 0;
		return { pass, detail: `Echo edges ${echoEdgeList.length} ${JSON.stringify(echoEdgeList.map((oneEdge) => oneEdge.properties.propertyNameList))}; duplicateEdgeTripleCount ${census.duplicateEdgeTripleCount}` };
	}),
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'c_oneEdgePerPair', twinName: 'oneEdgePerPropertyUse', fileName: DERIVATION_FILE, shippedConfig: false, find: 'const pairIdentityText = JSON.stringify([oneOccurrence.textStableId, oneOccurrence.sourceStableId]);', replace: 'const pairIdentityText = JSON.stringify([oneOccurrence.textStableId, oneOccurrence.sourceStableId, oneOccurrence.propertyName]);' });

// d — the text node's property set
conjunctList.push(shapedConjunct({
	conjunctId: 'd_textNodeShape',
	title: "every text node: NO name / searchText / embedding; carries text, embedSourceProperty 'text', vectorPropertyName 'textEmbedding', role, parentId = root, path embedText/<sha>, _source, toyStableId = stableId, depth 1, crossRefs '[]', labels [ForgedNode, ToyEmbedText, DmeEmbedText]",
	twinNameList: ['kitBuildsSearchTextForTextRole', 'stampSearchTextOnTextNode', 'stampEmbeddingOnTextNode', 'dropVectorPropertyName'],
	shape: (scenario) => withDeclaredToy(scenario),
	judge: succeeded((result) => {
		const textNodeList = textNodesOf(result);
		const offender = textNodeList.find((oneNode) => {
			const props = oneNode.properties;
			const textHash = typeof props.text === 'string' ? sha256Hex(props.text) : '';
			return (
				Object.prototype.hasOwnProperty.call(props, 'name') ||
				Object.prototype.hasOwnProperty.call(props, 'searchText') ||
				Object.prototype.hasOwnProperty.call(props, 'embedding') ||
				oneNode.embedding !== undefined ||
				typeof props.text !== 'string' || props.text.length === 0 ||
				props.embedSourceProperty !== 'text' ||
				props.vectorPropertyName !== 'textEmbedding' ||
				props.role !== DME_ROLES.EMBED_TEXT ||
				props.parentId !== 'toy:root' ||
				props.path !== `embedText/${textHash}` ||
				oneNode.stableId !== `toy:root/embedText/${textHash}` ||
				props._source !== 'Toy' ||
				props.toyStableId !== oneNode.stableId ||
				props.depth !== 1 ||
				props.crossRefs !== '[]' ||
				JSON.stringify(oneNode.labels) !== JSON.stringify(['ForgedNode', 'ToyEmbedText', DME_ROLES.EMBED_TEXT])
			);
		});
		return { pass: textNodeList.length > 0 && offender === undefined, detail: offender === undefined ? `${textNodeList.length} text nodes shaped` : `offender ${JSON.stringify({ labels: offender.labels, properties: offender.properties }).slice(0, 400)}` };
	}),
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'd_textNodeShape', twinName: 'kitBuildsSearchTextForTextRole', fileName: KIT_FILE, shippedConfig: false, find: '\t\tif (kitNonEmbeddableRoleList.indexOf(role) === -1) {', replace: '\t\tif (nonEmbeddableRoleList.indexOf(role) === -1) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'd_textNodeShape', twinName: 'stampSearchTextOnTextNode', fileName: DERIVATION_FILE, shippedConfig: false, find: '\t\t\torigin: EMBED_TEXT_ORIGIN,\n\t\t});\n\t});', replace: "\t\t\torigin: EMBED_TEXT_ORIGIN,\n\t\t}).properties.searchText = 'twin';\n\t});" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'd_textNodeShape', twinName: 'stampEmbeddingOnTextNode', fileName: DERIVATION_FILE, shippedConfig: false, find: '\t\t\torigin: EMBED_TEXT_ORIGIN,\n\t\t});\n\t});', replace: '\t\t\torigin: EMBED_TEXT_ORIGIN,\n\t\t}).properties.embedding = [0];\n\t});' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'd_textNodeShape', twinName: 'dropVectorPropertyName', fileName: DERIVATION_FILE, shippedConfig: false, find: '\t\t\t\tvectorPropertyName: EMBED_TEXT_VECTOR.propertyName,\n', replace: '' });

// e — stableId form under the toy pattern and a CEDS-shaped pattern (direct derivation over a real kit)
const CEDS_SHAPED_ROOT = 'https://w3id.org/CEDStandards/terms/';
const derivedTextStableIdListFor = ({ scenario, forgeDeclaration, rootStableId, sourceStableId }) => {
	const kitLib = frameworkModuleFor(scenario, KIT_FILE);
	const derivationLib = frameworkModuleFor(scenario, DERIVATION_FILE);
	const { kit, kitInternals } = kitLib.contractGraphKit({ forgeDeclaration, metadata: {} });
	kitInternals.setRootStableId(rootStableId);
	kit.makeNode({ role: DME_ROLES.CLASS, perStandardLabel: 'ToyClass', stableId: sourceStableId, name: 'Student', structural: { parentId: rootStableId, path: 'Student' }, origin: 'test:e' });
	derivationLib.deriveEmbedTextGraph({ nodes: kitInternals.nodes.slice(), embedTextDeclaration: forgeDeclaration.embedTextDeclaration, kit });
	return { textStableIdList: kitInternals.nodes.filter((oneNode) => oneNode.role === DME_ROLES.EMBED_TEXT).map((oneNode) => oneNode.stableId), kit };
};
conjunctList.push({
	conjunctId: 'e_stableIdForm',
	title: `stableId = root + ('/' unless the root ends with '/') + embedText/<sha256(text)>, clean under the pattern: toy → toy:root/embedText/<64 hex>; CEDS-shaped (^https?://\\S+$, root ${CEDS_SHAPED_ROOT}) → ${CEDS_SHAPED_ROOT}embedText/<64 hex> with ONE slash`,
	twinNameList: ['standardKeyColonForm', 'alwaysSlashJoin'],
	evaluate: (scenario, callback) => {
		const declaration = { embedTextLabel: 'ToyEmbedText', textPropertyListByRole: { [DME_ROLES.CLASS]: ['name'] } };
		const toyDeclaration = { ...toyScenario.cloneJson(scenario.forgeDeclaration), embedTextDeclaration: declaration };
		const cedsShapedDeclaration = { ...toyDeclaration, stableIdPattern: { pattern: '^https?://\\S+$', trimmed: false } };
		const expectedToyStableId = `toy:root/embedText/${sha256Hex('Student')}`;
		const expectedCedsStableId = `${CEDS_SHAPED_ROOT}embedText/${sha256Hex('Student')}`;
		let observation;
		try {
			const toyObserved = derivedTextStableIdListFor({ scenario, forgeDeclaration: toyDeclaration, rootStableId: 'toy:root', sourceStableId: 'toy:class/Student' });
			const cedsObserved = derivedTextStableIdListFor({ scenario, forgeDeclaration: cedsShapedDeclaration, rootStableId: CEDS_SHAPED_ROOT, sourceStableId: `${CEDS_SHAPED_ROOT}C000001` });
			observation = { toyObserved, cedsObserved };
		} catch (derivationThrow) {
			callback('', { pass: false, detail: `derivation refused: ${String(derivationThrow.message).slice(0, 300)}` });
			return;
		}
		const { toyObserved, cedsObserved } = observation;
		const pass =
			JSON.stringify(toyObserved.textStableIdList) === JSON.stringify([expectedToyStableId]) &&
			JSON.stringify(cedsObserved.textStableIdList) === JSON.stringify([expectedCedsStableId]) &&
			toyObserved.kit.isCleanStableId({ stableId: expectedToyStableId }) &&
			cedsObserved.kit.isCleanStableId({ stableId: expectedCedsStableId });
		callback('', { pass, detail: `toy ${JSON.stringify(toyObserved.textStableIdList)}; ceds-shaped ${JSON.stringify(cedsObserved.textStableIdList)}` });
	},
});
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e_stableIdForm', twinName: 'standardKeyColonForm', fileName: DERIVATION_FILE, shippedConfig: false, find: 'textStableId: `${rootStableId}${stableIdJoinText}${EMBED_TEXT_PATH_SEGMENT}', replace: 'textStableId: `ceds:${EMBED_TEXT_PATH_SEGMENT}' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e_stableIdForm', twinName: 'alwaysSlashJoin', fileName: DERIVATION_FILE, shippedConfig: false, find: "const stableIdJoinText = rootStableId.endsWith('/') ? '' : '/';", replace: "const stableIdJoinText = '/';" });

// f — ordering (R-ET-2) and the framework's ownership of the role (R-ET-35)
conjunctList.push(shapedConjunct({
	conjunctId: 'f_copyReturningWalkComposes',
	title: 'a walk that returns COPIES (kit.nodes.slice(), kit.edges.slice()) passes the origin check, and the result carries the text nodes once each, after every walk node',
	twinNameList: ['deriveBeforeOriginCheck'],
	shape: (scenario) => { withDeclaredToy(scenario); withWalkExtra(scenario, ({ kit }, walkResult) => ({ ...walkResult, nodes: kit.nodes.slice(), edges: kit.edges.slice() })); },
	judge: succeeded((result) => {
		const oracle = oracleFor(result, DECLARED_TOY_EMBED_TEXT_DECLARATION);
		const firstTextIndex = result.nodes.findIndex((oneNode) => oneNode.role === DME_ROLES.EMBED_TEXT);
		const lastWalkIndex = result.nodes.map((oneNode) => oneNode.role !== DME_ROLES.EMBED_TEXT).lastIndexOf(true);
		const pass = textNodesOf(result).length === oracle.distinctTextList.length && new Set(result.nodes).size === result.nodes.length && firstTextIndex > lastWalkIndex;
		return { pass, detail: `text nodes ${textNodesOf(result).length} vs oracle ${oracle.distinctTextList.length}; distinct node objects ${new Set(result.nodes).size}/${result.nodes.length}` };
	}),
}));
scenarioTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'f_copyReturningWalkComposes', twinName: 'deriveBeforeOriginCheck', leverKind: 'productionMutation', shippedConfig: false,
	mutate: (scenario) => {
		const deriveLateFind = '\t\t\t\tconst embedTextReport = embedTextDerivationLib.deriveEmbedTextGraph({ nodes: returnedNodes, embedTextDeclaration, kit });\n';
		const originCheckFind = '\t\t\t\tconst mintedNodeSet = new Set(kitInternals.nodes);\n';
		moduleDouble.assertMutationApplies({ modulePath: frameworkFile(FRAMEWORK_FILE), find: deriveLateFind });
		moduleDouble.assertMutationApplies({ modulePath: frameworkFile(FRAMEWORK_FILE), find: originCheckFind });
		scenario.frameworkMutationList.push({ modulePath: frameworkFile(FRAMEWORK_FILE), find: deriveLateFind, replace: '\t\t\t\tconst embedTextReport = earlyEmbedTextReport;\n' });
		scenario.frameworkMutationList.push({ modulePath: frameworkFile(FRAMEWORK_FILE), find: originCheckFind, replace: '\t\t\t\tconst earlyEmbedTextReport = embedTextDerivationLib.deriveEmbedTextGraph({ nodes: returnedNodes, embedTextDeclaration, kit });\n' + originCheckFind });
	},
});
conjunctList.push(refusalCase({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'f_walkMintedEmbedTextRefused',
	title: 'R-ET-35: a WALK that mints a DmeEmbedText node itself is refused by name (the framework owns the role)',
	shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { kit.makeNode({ role: DME_ROLES.EMBED_TEXT, perStandardLabel: 'ToyEmbedText', stableId: 'toy:root/embedText/hook', structural: { parentId: kit.rootStableId, path: 'embedText/hook' }, carriedProperties: { text: 'hook' }, origin: 'test:hook' }); }),
	regex: /emitContractGraph minted node 'toy:root\/embedText\/hook' with role DmeEmbedText/,
	twinName: 'disableWalkMintedEmbedTextCheck', fileName: FRAMEWORK_FILE,
	find: '\t\t\t\tif (walkMintedEmbedTextNode !== undefined) {', replace: '\t\t\t\tif (false && walkMintedEmbedTextNode !== undefined) {',
}));
conjunctList.push(refusalCase({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'f_walkAddedEmbedsTextEdgeRefused',
	title: 'R-ET-38: a WALK that adds an EMBEDS_TEXT_OF edge itself (between two ordinary nodes) is refused by name (the framework owns the edge type)',
	shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { kit.addEdge({ edgeType: EDGE_TYPES.EMBEDS_TEXT_OF, fromStableId: 'toy:class/Person', toStableId: 'toy:class/School', edgeContext: 'test:hookEdge' }); }),
	regex: /emitContractGraph added an EMBEDS_TEXT_OF edge \(toy:class\/Person → toy:class\/School\)/,
	twinName: 'disableWalkAddedEmbedsTextEdgeCheck', fileName: FRAMEWORK_FILE,
	find: '\t\t\t\tif (walkAddedEmbedsTextEdge !== undefined) {', replace: '\t\t\t\tif (false && walkAddedEmbedsTextEdge !== undefined) {',
}));

// g — determinism
conjunctList.push({
	conjunctId: 'g_deterministicUnderPermutedEmission',
	title: 'declared toy: two runs are byte-identical (node array JSON and canonical text), and a run whose walk emits the classes in REVERSED order has the SAME canonical text, text nodes included',
	twinNameList: ['emissionOrderTextStableId'],
	evaluate: (scenario, callback) => {
		const firstScenario = toyScenario.cloneScenario(scenario);
		withDeclaredToy(firstScenario);
		const secondScenario = toyScenario.cloneScenario(firstScenario);
		const permutedScenario = toyScenario.cloneScenario(firstScenario);
		withClassesReversed(permutedScenario);
		const fingerprintLib = require(frameworkFile(FINGERPRINT_FILE));
		const refusalOf = (outcome) => outcome.injectionError || outcome.forgeError || outcome.thrownFromForge;
		toyScenario.runScenario(firstScenario, (firstError, firstOutcome) => {
			toyScenario.runScenario(secondScenario, (secondError, secondOutcome) => {
				toyScenario.runScenario(permutedScenario, (permutedError, permutedOutcome) => {
					const refusalText = refusalOf(firstOutcome) || refusalOf(secondOutcome) || refusalOf(permutedOutcome);
					if (refusalText) {
						callback('', { pass: false, detail: `a run refused: ${refusalText}` });
						return;
					}
					const firstCanonical = fingerprintLib.canonicalText(firstOutcome.result);
					const pass =
						textNodesOf(firstOutcome.result).length > 0 &&
						JSON.stringify(firstOutcome.result.nodes) === JSON.stringify(secondOutcome.result.nodes) &&
						firstCanonical === fingerprintLib.canonicalText(secondOutcome.result) &&
						firstCanonical === fingerprintLib.canonicalText(permutedOutcome.result);
					callback('', { pass, detail: `repeat canonical ${firstCanonical === fingerprintLib.canonicalText(secondOutcome.result) ? 'equal' : 'DIFFERS'}; permuted canonical ${firstCanonical === fingerprintLib.canonicalText(permutedOutcome.result) ? 'equal' : 'DIFFERS'}` });
				});
			});
		});
	},
});
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'g_deterministicUnderPermutedEmission', twinName: 'emissionOrderTextStableId', fileName: DERIVATION_FILE, shippedConfig: false, find: 'sha256Hex(oneOccurrence.text)}', replace: 'String(occurrenceList.indexOf(oneOccurrence))}' });

// the spy-embedder conjunct shape (h, i, j, n): declared toy + spy, then any extra shaping, judged with the spy
const spyConjunct = ({ conjunctId, title, twinNameList, shapeExtra, judgeWithSpy }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		withDeclaredToy(scenario);
		withSpy(scenario, {});
		if (shapeExtra) {
			shapeExtra(scenario);
		}
		toyScenario.runScenario(scenario, (runError, outcome) => {
			const refusalText = outcome.injectionError || outcome.forgeError || outcome.thrownFromForge;
			if (refusalText) {
				callback('', { pass: false, detail: `refused: ${refusalText}` });
				return;
			}
			callback('', judgeWithSpy(outcome.result, scenario.spyEmbedder));
		});
	},
});
// h — the legacy pass never sees a text node
conjunctList.push(spyConjunct({
	conjunctId: 'h_legacyPassExcludesTextNodes',
	title: `spy embedder on the declared toy: the legacy pass sends exactly the ${TOY_WALK_EMBEDDABLE_COUNT} walk searchTexts and no text node's text; the text pass sends exactly the distinct texts; embedCallCount EQUALS ceil(${TOY_WALK_EMBEDDABLE_COUNT}/128) + ceil(distinct/128)`,
	twinNameList: ['removeUnionInsideEmbedPass'],
	judgeWithSpy: (result, spy) => {
		const oracle = oracleFor(result, DECLARED_TOY_EMBED_TEXT_DECLARATION);
		const textSet = new Set(textNodesOf(result).map((oneNode) => oneNode.properties.text));
		const legacyTexts = spy.textsSeen.length > 0 ? spy.textsSeen[0] : [];
		const textPassTexts = spy.textsSeen.length > 1 ? spy.textsSeen[1] : [];
		const foreignLegacyCount = legacyTexts.filter((oneText) => typeof oneText !== 'string' || textSet.has(oneText)).length;
		const expectedCallCount = Math.ceil(TOY_WALK_EMBEDDABLE_COUNT / 128) + Math.ceil(oracle.distinctTextList.length / 128);
		const pass =
			spy.textsSeen.length === 2 &&
			legacyTexts.length === TOY_WALK_EMBEDDABLE_COUNT &&
			foreignLegacyCount === 0 &&
			JSON.stringify(textPassTexts.slice().sort()) === JSON.stringify(oracle.distinctTextList) &&
			result.embedCallCount === expectedCallCount;
		return { pass, detail: `batches ${spy.textsSeen.length}; legacy ${legacyTexts.length} texts (${foreignLegacyCount} foreign); text pass ${textPassTexts.length} vs oracle ${oracle.distinctTextList.length}; embedCallCount ${result.embedCallCount} vs ${expectedCallCount}` };
	},
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'h_legacyPassExcludesTextNodes', twinName: 'removeUnionInsideEmbedPass', fileName: EMBED_FILE, shippedConfig: false, find: '\t\t\tconst passNonEmbeddableRoleList = effectiveNonEmbeddableRoleList({ nonEmbeddableRoleList });', replace: '\t\t\tconst passNonEmbeddableRoleList = nonEmbeddableRoleList;' });

// i — skipEmbedding skips the text pass
conjunctList.push(spyConjunct({
	conjunctId: 'i_skipEmbeddingSkipsTextPass',
	title: 'skipEmbedding: true on the declared toy → the spy is never called, embedCallCount EQUALS 0, no text node carries textEmbedding or embeddingModelVersion, and the text-node count is unchanged',
	twinNameList: ['textPassRunsUnderSkip'],
	shapeExtra: (scenario) => { scenario.forgeArgs = { ...scenario.forgeArgs, skipEmbedding: true }; },
	judgeWithSpy: (result, spy) => {
		const oracle = oracleFor(result, DECLARED_TOY_EMBED_TEXT_DECLARATION);
		const stampedCount = textNodesOf(result).filter((oneNode) => oneNode.properties.textEmbedding !== undefined || oneNode.properties.embeddingModelVersion !== undefined).length;
		return { pass: spy.callCount === 0 && result.embedCallCount === 0 && stampedCount === 0 && textNodesOf(result).length === oracle.distinctTextList.length, detail: `spy calls ${spy.callCount}, embedCallCount ${result.embedCallCount}, stamped text nodes ${stampedCount}, text nodes ${textNodesOf(result).length}` };
	},
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'i_skipEmbeddingSkipsTextPass', twinName: 'textPassRunsUnderSkip', fileName: FRAMEWORK_FILE, shippedConfig: false, find: "\t\t\t\t\tif (skipEmbedding === true) {\n\t\t\t\t\t\tnext('', args);", replace: "\t\t\t\t\tif (false) {\n\t\t\t\t\t\tnext('', args);" });

// j — embedNodeLimit bounds the text pass
conjunctList.push(spyConjunct({
	conjunctId: 'j_embedNodeLimitBoundsTextPass',
	title: 'embedNodeLimit: 1 on the declared toy → the spy receives exactly ONE walk text and ONE text-node text, and exactly one text node carries textEmbedding (R-ET-18)',
	twinNameList: ['removeTextPassSlice'],
	shapeExtra: (scenario) => { scenario.forgeArgs = { ...scenario.forgeArgs, embedNodeLimit: 1 }; },
	judgeWithSpy: (result, spy) => {
		const batchLengthList = spy.textsSeen.map((oneBatch) => oneBatch.length);
		const vectorCount = textNodesOf(result).filter((oneNode) => oneNode.properties.textEmbedding !== undefined).length;
		return { pass: JSON.stringify(batchLengthList) === JSON.stringify([1, 1]) && vectorCount === 1, detail: `batch lengths ${JSON.stringify(batchLengthList)}, text nodes with vectors ${vectorCount}` };
	},
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'j_embedNodeLimitBoundsTextPass', twinName: 'removeTextPassSlice', fileName: TEXT_PASS_FILE, shippedConfig: false, find: '\t\t\t\tembedNodeLimit !== undefined && embedNodeLimit < textNodeList.length\n\t\t\t\t\t? textNodeList.slice(0, embedNodeLimit)\n\t\t\t\t\t: textNodeList;', replace: '\t\t\t\ttextNodeList;' });

// k — declaration refusals, each with its disable-the-check twin
const declarationRefusal = ({ conjunctId, title, shapeDeclaration, regex, twinName, find, replace, shippedConfig = false }) =>
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId, title, mode: 'inject', shippedConfig,
		shape: (scenario) => { withDeclaredToy(scenario); shapeDeclaration(scenario.forgeDeclaration); },
		regex, twinName, fileName: CONTRACT_FILE, find, replace,
	});
const byRole = (roleListMap) => (forgeDeclaration) => { forgeDeclaration.embedTextDeclaration.textPropertyListByRole = roleListMap; };
[
	{ conjunctId: 'k_declarationNotObject', title: "embedTextDeclaration 'yes' (neither null nor an object) is refused", shapeDeclaration: (forgeDeclaration) => { forgeDeclaration.embedTextDeclaration = 'yes'; }, regex: /forgeDeclaration 'embedTextDeclaration' must be null or \{ embedTextLabel, textPropertyListByRole \}/, twinName: 'disableNotObjectCheck', find: "\t\tif (!isPlainObject(value)) {\n\t\t\treturn `must be null or {", replace: "\t\tif (false && !isPlainObject(value)) {\n\t\t\treturn `must be null or {" },
	{ conjunctId: 'k_unknownInnerProperty', title: 'an unknown property inside embedTextDeclaration is refused naming it', shapeDeclaration: (forgeDeclaration) => { forgeDeclaration.embedTextDeclaration.extraSetting = 1; }, regex: /carries unknown property 'extraSetting'; the shape is exactly/, twinName: 'disableUnknownInnerCheck', find: '\t\tif (unknownInnerName !== undefined) {', replace: '\t\tif (false && unknownInnerName !== undefined) {' },
	{ conjunctId: 'k_missingEmbedTextLabel', title: 'a missing embedTextLabel is refused', shapeDeclaration: (forgeDeclaration) => { delete forgeDeclaration.embedTextDeclaration.embedTextLabel; }, regex: /embedTextLabel must be a non-empty string/, twinName: 'disableLabelCheck', find: "\t\tif (typeof value.embedTextLabel !== 'string' || value.embedTextLabel.length === 0) {", replace: "\t\tif (false && (typeof value.embedTextLabel !== 'string' || value.embedTextLabel.length === 0)) {" },
	{ conjunctId: 'k_roleMapNotObject', title: 'a textPropertyListByRole that is a list is refused', shapeDeclaration: (forgeDeclaration) => { forgeDeclaration.embedTextDeclaration.textPropertyListByRole = ['name']; }, regex: /textPropertyListByRole must be an object/, twinName: 'disableRoleMapObjectCheck', find: '\t\tif (!isPlainObject(value.textPropertyListByRole)) {', replace: '\t\tif (false && !isPlainObject(value.textPropertyListByRole)) {' },
	{ conjunctId: 'k_roleMapEmpty', title: 'an EMPTY textPropertyListByRole is refused ("declare null instead")', shapeDeclaration: byRole({}), regex: /declares no role; a bundle that embeds no text declares embedTextDeclaration: null instead/, twinName: 'disableEmptyRoleMapCheck', find: '\t\tif (declaredRoleList.length === 0) {', replace: '\t\tif (false && declaredRoleList.length === 0) {' },
	{ conjunctId: 'k_roleNotDme', title: 'a role outside DME_ROLES is refused naming it', shapeDeclaration: byRole({ DmeGadget: ['name'] }), regex: /names 'DmeGadget', which is not a DME_ROLES member/, twinName: 'disableRoleMemberCheck', find: '\t\t\tif (DME_ROLE_VALUE_LIST.indexOf(declaredRole) === -1) {', replace: '\t\t\tif (false && DME_ROLE_VALUE_LIST.indexOf(declaredRole) === -1) {' },
	{ conjunctId: 'k_embedTextRoleListed', title: 'DmeEmbedText listed as a text source is refused', shapeDeclaration: byRole({ [DME_ROLES.EMBED_TEXT]: ['text'] }), regex: /names 'DmeEmbedText', the framework's own text-node role/, twinName: 'disableFrameworkRoleCheck', find: '\t\t\tif (FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST.indexOf(declaredRole) !== -1) {', replace: '\t\t\tif (false && FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST.indexOf(declaredRole) !== -1) {' },
	{ conjunctId: 'k_emptyPropertyList', title: 'an empty property list is refused', shapeDeclaration: byRole({ [DME_ROLES.CLASS]: [] }), regex: /textPropertyListByRole\.DmeClass must be a non-empty list of property names/, twinName: 'disableEmptyListCheck', find: '\t\t\tif (!Array.isArray(propertyNameList) || propertyNameList.length === 0) {', replace: '\t\t\tif (false && (!Array.isArray(propertyNameList) || propertyNameList.length === 0)) {' },
	{ conjunctId: 'k_invalidPropertyName', title: 'an empty-string property name is refused', shapeDeclaration: byRole({ [DME_ROLES.CLASS]: ['name', ''] }), regex: /lists "", not a non-empty property name/, twinName: 'disableInvalidNameCheck', find: '\t\t\tif (invalidPropertyName !== undefined) {', replace: '\t\t\tif (false && invalidPropertyName !== undefined) {' },
	{ conjunctId: 'k_duplicatePropertyName', title: 'a duplicate property name is refused naming it', shapeDeclaration: byRole({ [DME_ROLES.CLASS]: ['name', 'name'] }), regex: /lists 'name' twice/, twinName: 'disableDuplicateNameCheck', find: '\t\t\tif (duplicatePropertyName !== undefined) {', replace: '\t\t\tif (false && duplicatePropertyName !== undefined) {' },
	{ conjunctId: 'k_forbiddenPropertyName', title: "a framework-stamped name ('searchText') as a text property is refused", shapeDeclaration: byRole({ [DME_ROLES.CLASS]: ['name', 'searchText'] }), regex: /lists 'searchText', a framework-stamped, structural or vector property/, twinName: 'disableForbiddenNameCheck', find: '\t\t\tif (forbiddenPropertyName !== undefined) {', replace: '\t\t\tif (false && forbiddenPropertyName !== undefined) {' },
	{ conjunctId: 'k_stableUriPropertyNameForbidden', title: "the bundle's stableUriPropertyName ('toyStableId') as a text property is refused", shapeDeclaration: byRole({ [DME_ROLES.CLASS]: ['toyStableId'] }), regex: /lists 'toyStableId', a framework-stamped, structural or vector property/, twinName: 'dropStableUriFromForbiddenList', find: 'const forbiddenPropertyNameList = EMBED_TEXT_FORBIDDEN_PROPERTY_NAME_LIST.concat([forgeDeclaration.stableUriPropertyName]);', replace: 'const forbiddenPropertyNameList = EMBED_TEXT_FORBIDDEN_PROPERTY_NAME_LIST;' },
	{ conjunctId: 'k_nonEmbeddableListsEmbedTextRole', title: 'a bundle whose nonEmbeddableRoleList lists DmeEmbedText is refused ("the framework owns that role")', shapeDeclaration: (forgeDeclaration) => { forgeDeclaration.embedTextDeclaration = null; forgeDeclaration.nonEmbeddableRoleList = [DME_ROLES.SUPPORT, DME_ROLES.EMBED_TEXT]; }, regex: /forgeDeclaration 'nonEmbeddableRoleList' lists 'DmeEmbedText', a role the framework owns/, twinName: 'disableFrameworkOwnedRoleCheck', find: '\t\tif (frameworkOwnedRole !== undefined) {', replace: '\t\tif (false && frameworkOwnedRole !== undefined) {', shippedConfig: true },
].forEach((oneRefusal) => conjunctList.push(declarationRefusal(oneRefusal)));
conjunctList.push({
	conjunctId: 'k_textlessTextNodeRefusedByPass',
	title: 'a DmeEmbedText node without a non-empty string text reaching embedTextNodes is refused by name (the spy is never called)',
	twinNameList: ['disableTextlessNodeCheck'],
	evaluate: (scenario, callback) => {
		const spy = toyScenario.makeSpyEmbedder({ dims: SPY_DIMS, modelVersion: SPY_MODEL_VERSION });
		const textPass = frameworkModuleFor(scenario, TEXT_PASS_FILE)({ embedder: spy, xLog: process.global.xLog });
		textPass.embedTextNodes({ nodes: [{ role: DME_ROLES.EMBED_TEXT, stableId: 'toy:root/embedText/textless', properties: {} }], standardKey: 'toy' }, (passError) => {
			const pass = /text node 'toy:root\/embedText\/textless' carries text undefined/.test(passError || '') && spy.callCount === 0;
			callback('', { pass, detail: `refusal ${JSON.stringify(passError || '').slice(0, 200)}; spy calls ${spy.callCount}` });
		});
	},
});
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'k_textlessTextNodeRefusedByPass', twinName: 'disableTextlessNodeCheck', fileName: TEXT_PASS_FILE, find: '\t\t\tif (textlessNode !== undefined) {', replace: '\t\t\tif (false && textlessNode !== undefined) {' });

// l — value rules
const valueSuccess = ({ conjunctId, title, twinName, classArgs, judge }) => shapedConjunct({
	conjunctId, title, twinNameList: [twinName],
	shape: (scenario) => { withDeclaredToy(scenario); if (classArgs) { withExtraClass(scenario, classArgs); } },
	judge: succeeded(judge),
});
const valueRefusal = ({ conjunctId, title, twinName, classArgs, regex, find, replace }) => refusalCase({
	registry: twinRegistry, gateId: GATE_ID, conjunctId, title, shippedConfig: false,
	shape: (scenario) => { withDeclaredToy(scenario); withExtraClass(scenario, classArgs); },
	regex, twinName, fileName: DERIVATION_FILE, find, replace,
});
conjunctList.push(valueSuccess({
	conjunctId: 'l_absentCounted', title: 'absent listed properties are COUNTED: seam stats.embedTextAbsentCount EQUALS the oracle (>0 on the toy)', twinName: 'disableAbsentSkip',
	judge: (result) => { const oracle = oracleFor(result, DECLARED_TOY_EMBED_TEXT_DECLARATION); return { pass: oracle.absent > 0 && result.stats.embedTextAbsentCount === oracle.absent, detail: `stats ${result.stats.embedTextAbsentCount} vs oracle ${oracle.absent}` }; },
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'l_absentCounted', twinName: 'disableAbsentSkip', fileName: DERIVATION_FILE, shippedConfig: false, find: '\t\t\tif (rawValue === undefined || rawValue === null) {', replace: '\t\t\tif (false) {' });
conjunctList.push(valueSuccess({
	conjunctId: 'l_emptyAfterTrimSkipped', title: "a whitespace-only value is SKIPPED and counted: embedTextSkippedEmptyCount EQUALS 1 and no text node carries ''", twinName: 'disableEmptySkip',
	classArgs: { stableId: 'toy:class/Blank', name: 'Blank', description: '   ' },
	judge: (result) => ({ pass: result.stats.embedTextSkippedEmptyCount === 1 && textNodeWithText(result, '') === undefined, detail: `skipped ${result.stats.embedTextSkippedEmptyCount}; empty text node ${textNodeWithText(result, '') !== undefined}` }),
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'l_emptyAfterTrimSkipped', twinName: 'disableEmptySkip', fileName: DERIVATION_FILE, shippedConfig: false, find: '\t\t\t\tif (text.length === 0) {', replace: '\t\t\t\tif (false) {' });
conjunctList.push(valueSuccess({
	conjunctId: 'l_paddedValueCollapses', title: "a whitespace-padded value collapses onto its trimmed text: ONE node for Person's description with TWO edges, embedTextTrimmedCount EQUALS 1", twinName: 'disableTrim',
	classArgs: { stableId: 'toy:class/Padded', name: 'Padded', description: `  ${PERSON_DESCRIPTION}  ` },
	judge: (result) => { const sharedNode = textNodeWithText(result, PERSON_DESCRIPTION); return { pass: edgesFromTextNode(result, sharedNode).length === 2 && result.stats.embedTextTrimmedCount === 1, detail: `edges ${edgesFromTextNode(result, sharedNode).length}; trimmed ${result.stats.embedTextTrimmedCount}` }; },
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'l_paddedValueCollapses', twinName: 'disableTrim', fileName: DERIVATION_FILE, shippedConfig: false, find: '\t\t\t\tconst text = oneValue.trim();', replace: '\t\t\t\tconst text = oneValue;' });
conjunctList.push(valueSuccess({
	conjunctId: 'l_arrayExpandedElementWise', title: "a multi-element list ['Pupil','Learner'] → one text node per element, each with an edge whose propertyNameList is ['synonymList']", twinName: 'joinArrayElements',
	classArgs: { stableId: 'toy:class/Synonyms', name: 'Synonyms', synonymList: ['Pupil', 'Learner'] },
	judge: (result) => {
		const edgeListFor = (text) => edgesFromTextNode(result, textNodeWithText(result, text)).filter((oneEdge) => oneEdge.toRef.id === 'toy:class/Synonyms' && JSON.stringify(oneEdge.properties.propertyNameList) === JSON.stringify(['synonymList']));
		return { pass: edgeListFor('Pupil').length === 1 && edgeListFor('Learner').length === 1, detail: `Pupil ${edgeListFor('Pupil').length}, Learner ${edgeListFor('Learner').length}` };
	},
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'l_arrayExpandedElementWise', twinName: 'joinArrayElements', fileName: DERIVATION_FILE, shippedConfig: false, find: '\treturn rawValue;\n};', replace: "\treturn [rawValue.join(' ')];\n};" });
conjunctList.push(valueSuccess({
	conjunctId: 'l_oneElementArrayIsOneValue', title: "a one-element list ['Solo'] is one value → one text node 'Solo'", twinName: 'refuseOneElementArray',
	classArgs: { stableId: 'toy:class/Single', name: 'Single', synonymList: ['Solo'] },
	judge: (result) => ({ pass: edgesFromTextNode(result, textNodeWithText(result, 'Solo')).length === 1, detail: `Solo edges ${edgesFromTextNode(result, textNodeWithText(result, 'Solo')).length}` }),
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'l_oneElementArrayIsOneValue', twinName: 'refuseOneElementArray', fileName: DERIVATION_FILE, shippedConfig: false, find: '\tif (rawValue.length === 0) {', replace: '\tif (rawValue.length <= 1) {' });
conjunctList.push(valueRefusal({
	conjunctId: 'l_emptyArrayRefused', title: 'an EMPTY list is refused by name', twinName: 'disableEmptyArrayCheck',
	classArgs: { stableId: 'toy:class/EmptyList', name: 'EmptyList', synonymList: [] },
	regex: /node 'toy:class\/EmptyList' property 'synonymList' is an EMPTY list/, find: '\tif (rawValue.length === 0) {', replace: '\tif (false) {',
}));
conjunctList.push(valueRefusal({
	conjunctId: 'l_nestedArrayRefused', title: 'a NESTED list element is refused by name', twinName: 'disableElementTypeCheck',
	classArgs: { stableId: 'toy:class/Nested', name: 'Nested', synonymList: ['fine', ['nested']] },
	regex: /node 'toy:class\/Nested' property 'synonymList' element 1 is a NESTED list, not a string/, find: '\tif (nonStringElementIndex !== -1) {', replace: '\tif (false) {',
}));
conjunctList.push(valueRefusal({
	conjunctId: 'l_nulRefused', title: 'a value containing NUL (U+0000) is refused by name', twinName: 'disableNulCheck',
	classArgs: { stableId: 'toy:class/Nul', name: 'Nul', description: `bad${NUL_CHARACTER}text` },
	regex: /node 'toy:class\/Nul' property 'description' contains the NUL character/, find: '\t\t\t\tif (oneValue.indexOf(NUL_CHARACTER) !== -1) {', replace: '\t\t\t\tif (false) {',
}));
conjunctList.push(valueRefusal({
	conjunctId: 'l_nonStringRefused', title: 'a non-string, non-list value (a number) is refused by name', twinName: 'disableNonStringCheck',
	classArgs: { stableId: 'toy:class/Numeric', name: 'Numeric', synonymList: 42 },
	regex: /node 'toy:class\/Numeric' property 'synonymList' is a number, not a string or a list of strings/, find: '\tif (!Array.isArray(rawValue)) {', replace: '\tif (false) {',
}));

// m — the proxy drops textEmbedding
conjunctList.push({
	conjunctId: 'm_proxyDropsTextEmbedding',
	title: 'declared toy: the PROXY of an embed run (text nodes carrying textEmbedding) EQUALS the PROXY of a skip run',
	twinNameList: ['keepTextEmbeddingInProxy'],
	evaluate: (scenario, callback) => {
		const skipScenario = toyScenario.cloneScenario(scenario);
		withDeclaredToy(skipScenario);
		const embedScenario = toyScenario.cloneScenario(skipScenario);
		withSpy(embedScenario, {});
		const fingerprintLib = frameworkModuleFor(scenario, FINGERPRINT_FILE);
		toyScenario.runScenario(skipScenario, (skipError, skipOutcome) => {
			toyScenario.runScenario(embedScenario, (embedError, embedOutcome) => {
				const refusalText = skipOutcome.forgeError || skipOutcome.injectionError || embedOutcome.forgeError || embedOutcome.injectionError;
				if (refusalText) {
					callback('', { pass: false, detail: `refused: ${refusalText}` });
					return;
				}
				const vectorCount = textNodesOf(embedOutcome.result).filter((oneNode) => Array.isArray(oneNode.properties.textEmbedding)).length;
				const skipProxy = fingerprintLib.pureLayerFingerprint(skipOutcome.result);
				const embedProxy = fingerprintLib.pureLayerFingerprint(embedOutcome.result);
				callback('', { pass: vectorCount > 0 && skipProxy === embedProxy, detail: `text nodes with vectors ${vectorCount}; skip ${skipProxy.slice(0, 12)} vs embed ${embedProxy.slice(0, 12)}` });
			});
		});
	},
});
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'm_proxyDropsTextEmbedding', twinName: 'keepTextEmbeddingInProxy', fileName: FINGERPRINT_FILE, shippedConfig: false, find: "'embeddingModelVersion', EMBED_TEXT_VECTOR.propertyName, 'stableId'", replace: "'embeddingModelVersion', 'stableId'" });

// n — the pass stamps the carried model version under the ORDINARY name
conjunctList.push(spyConjunct({
	conjunctId: 'n_stampsCarriedModelVersion',
	title: `after an embed run every text node carries embeddingModelVersion EQUAL to the spy's '${SPY_MODEL_VERSION}' and a textEmbedding of ${SPY_DIMS} dimensions; no textEmbeddingModelVersion property exists anywhere in the result`,
	twinNameList: ['stampInventedModelVersionName'],
	judgeWithSpy: (result) => {
		const textNodeList = textNodesOf(result);
		const unstampedCount = textNodeList.filter((oneNode) => oneNode.properties.embeddingModelVersion !== SPY_MODEL_VERSION || !Array.isArray(oneNode.properties.textEmbedding) || oneNode.properties.textEmbedding.length !== SPY_DIMS).length;
		const inventedCount = result.nodes.filter((oneNode) => Object.prototype.hasOwnProperty.call(oneNode, 'textEmbeddingModelVersion') || Object.prototype.hasOwnProperty.call(oneNode.properties, 'textEmbeddingModelVersion')).length;
		return { pass: textNodeList.length > 0 && unstampedCount === 0 && inventedCount === 0, detail: `text nodes ${textNodeList.length}, unstamped ${unstampedCount}, carrying the invented name ${inventedCount}` };
	},
}));
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'n_stampsCarriedModelVersion', twinName: 'stampInventedModelVersionName', fileName: TEXT_PASS_FILE, shippedConfig: false, find: '\t\t\t\t\t\toneNode.properties.embeddingModelVersion = embedResult.embeddingModelVersion;', replace: '\t\t\t\t\t\toneNode.properties.textEmbeddingModelVersion = embedResult.embeddingModelVersion;' });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'framework-minted embed-text nodes', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 37, expectedTwinCount: 43 }, () => harness.report());
