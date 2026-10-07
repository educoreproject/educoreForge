#!/usr/bin/env node
'use strict';

// test-integerValuedProperties.js — gate for W-A-2 (V1-C04; campaign P2): a property the graph contract declares
// integer-valued (graph-contract §2, INTEGER_VALUED_PROPERTY_NAME_LIST) is written as a Neo4j INTEGER, and a non-integer
// value under a declared name is refused by name before any row is built.
//
// PROVES:
//   (a) every declared name: pgToStored({ [name]: [3] })[name] is a Neo4j Integer (neo4j.isInt) equal to 3
//   (b) an undeclared numeric stays a JS number (mappingConfidence 0.9 is a genuine FLOAT)
//   (c) validateShapedGraph refuses a node whose declared integer carries 3.5, naming the property; integerDeclaration
//       ViolationOf answers '' for integers and null
//   (e) ⟪campaign P3, VIOLET_VALLEY ruling B on W-C-17⟫ a STRING under a declared-integer name (a block produced before
//       the name joined §2 — CEDS maxLength "80") is ADMITTED, written through UNCHANGED (never converted), and COUNTED per
//       source (legacyStringIntegerCountBySource); a non-integer NUMBER beside it is still refused (c)
//   (d) harvest byte-stability: the engine's own harvest conversion (pgArray over neoToJs) turns neo4j.int(402) and the
//       FLOAT 402 into the same JSON text '[402]', so no block moves
// RED TWINS (in memory, loadBuildJsDouble on replay-engine.js):
//   integerWrapSkipped — storedNumber returns the raw value -> (a) red
//   guardFiveRemoved — the validate refusal never collects -> (c) red
//   everyArrayMapped — the pass-through branch removed, every array copied -> (d) red (d: a non-integer array is stored BY
//   REFERENCE — the fleet finding that the copy doubled replay's heap)
//
// Run: node lib/replay/test/test-integerValuedProperties.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate: declared integer-valued properties are written as Neo4j INTEGER

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const neo4j = require('neo4j-driver');
const harness = require('../../../test/testLib/harness')(moduleName);
const { loadBuildJsDouble } = require('../../bridge-framework/test/testSupport/bridgeTwinFactories');
const { INTEGER_VALUED_PROPERTY_NAME_LIST } = require('../../vocabulary/vocabulary');

const ENGINE_PATH = path.join(__dirname, '..', 'replay-engine.js');
const engineFor = (mutationList) => (mutationList.length === 0 ? require(ENGINE_PATH) : loadBuildJsDouble({ buildJsPath: ENGINE_PATH, mutationList }))();

const toyGroupWith = (properties) => [{
	sourceLabel: 'toy integer group',
	nodes: [{ ref: { source: 'TOY', id: 'toy:1' }, stableId: 'toy:1', labels: ['ForgedNode'], properties }],
	edges: [],
}];

const conjunctJudgeByRefId = {
	a_declaredIntegerIsNeo4jInteger: (mutationList) => {
		const { pgToStored } = engineFor(mutationList);
		const notIntegerList = INTEGER_VALUED_PROPERTY_NAME_LIST.filter((oneName) => {
			const stored = pgToStored({ [oneName]: [3] })[oneName];
			return !(neo4j.isInt(stored) && stored.toNumber() === 3);
		});
		return { pass: notIntegerList.length === 0, detail: notIntegerList.length ? `not INTEGER: ${notIntegerList.join(', ')}` : `${INTEGER_VALUED_PROPERTY_NAME_LIST.length} declared name(s) written as INTEGER` };
	},
	b_undeclaredNumberStaysANumber: (mutationList) => {
		const stored = engineFor(mutationList).pgToStored({ mappingConfidence: [0.9] });
		return { pass: stored.mappingConfidence === 0.9, detail: JSON.stringify(stored) };
	},
	c_nonIntegerRefusedByName: (mutationList) => {
		const engine = engineFor(mutationList);
		const verdict = engine.validateShapedGraph(toyGroupWith({ depth: [3.5] }));
		const cleanVerdict = engine.validateShapedGraph(toyGroupWith({ depth: [3], valueCount: [null] }));
		const pass = /integer declaration enforcement/.test(verdict.error) && /'depth'/.test(verdict.error) && cleanVerdict.error === '';
		return { pass, detail: `refusal: ${(verdict.error || '(none)').slice(0, 160)} | clean: ${cleanVerdict.error || '(none)'}` };
	},
	e_legacyStringAdmittedAndCounted: (mutationList) => {
		const engine = engineFor(mutationList);
		const verdict = engine.validateShapedGraph(toyGroupWith({ maxLength: ['80'], minLength: [1] }));
		const stored = engine.pgToStored({ maxLength: ['80'] });
		const countBySource = verdict.legacyStringIntegerCountBySource || {};
		const pass = verdict.error === '' && stored.maxLength === '80' && countBySource['toy integer group'] === 1 && Object.keys(countBySource).length === 1;
		return { pass, detail: `error ${JSON.stringify(verdict.error)}; stored ${JSON.stringify(stored.maxLength)}; counted ${JSON.stringify(countBySource)}` };
	},
	d_otherArraysPassByReference: (mutationList) => {
		// campaign P2 fleet finding: mapping EVERY array copied every 1024-float embedding and doubled replay's heap
		const embedding = Array.from({ length: 1024 }, (unused, position) => position / 1024);
		const stored = engineFor(mutationList).pgToStored({ embedding, sourceFiles: ['a.xsd'] });
		return { pass: stored.embedding === embedding, detail: stored.embedding === embedding ? 'the embedding array is the same object (no copy)' : 'the embedding array was COPIED' };
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_declaredIntegerIsNeo4jInteger', twinName: 'integerWrapSkipped', find: '	return neo4j.int(oneValue);\n};', replace: '	return oneValue;\n};' },
	{ conjunctRefId: 'c_nonIntegerRefusedByName', twinName: 'guardFiveRemoved', find: 'integerViolations.push(`${sourceLabel}', replace: 'void (`${sourceLabel}' },
	// the pre-ruling engine: a string is refused like a float (historical blocks stop replaying)
	{ conjunctRefId: 'e_legacyStringAdmittedAndCounted', twinName: 'stringRefusedLikeAFloat', find: "oneValue !== null && typeof oneValue !== 'string' && (typeof oneValue", replace: "oneValue !== null && (typeof oneValue" },
	// the string admitted but not counted: a legacy value would pass silently
	{ conjunctRefId: 'e_legacyStringAdmittedAndCounted', twinName: 'legacyCountDropped', find: '			legacyStringIntegerCountBySource[sourceLabel] = sourceLegacyStringIntegerCount;', replace: '			void sourceLegacyStringIntegerCount;' },
	{ conjunctRefId: 'd_otherArraysPassByReference', twinName: 'everyArrayMapped', find: '		if (!INTEGER_VALUED_PROPERTY_NAME_SET.has(onePropertyName)) {\n			out[onePropertyName] = collapsedValue;\n			return;\n		}\n', replace: '' },
];

harness.section('BASELINE — the real engine passes every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});

harness.section('(d) HARVEST BYTE-STABILITY — an INTEGER and a FLOAT of one value harvest to the same text');
const { pgArray } = engineFor([]);
harness.equal('neo4j.int(402) harvests as [402]', JSON.stringify(pgArray(neo4j.int(402))), '[402]');
harness.equal('the FLOAT 402.0 harvests as [402]', JSON.stringify(pgArray(402.0)), '[402]');
harness.equal('a stored list of one INTEGER harvests as [3]', JSON.stringify(pgArray([neo4j.int(3)])), '[3]');

harness.section('THE TWIN SWEEP — each twin OBSERVED RED under an engine double (in memory)');
TWIN_LIST.forEach((oneTwin) => {
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }]);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});

harness.report();
