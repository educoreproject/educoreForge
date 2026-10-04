'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// certificationCheck.js — the goldEvalCheck BRIDGE SIBLING's rule (SPEC-bridgeFramework-v1.md §5.6 step 5 (e),
// §12 item 7, BG-DEBUG (c); RULING R5; Profile v1.0.6 §4.6): a DEBUG block MUST NOT reach a certified graph. PURE:
//   debugEdgeRefusal({ harvestedEdgeList, blockLabel }) → Error | null
// refuses by name any harvested mapping edge whose mappingSource (scalar or the harvest's one-element list) names the
// DEBUG judge ('bridge-debug'), naming the block and the first offender; and any edge with NO mappingSource, which cannot
// be classified (it predates lane P, 2026-10-04, when the debug marker moved off provenanceTier onto mappingSource, with
// mappingConfidence 0) and so cannot be certified either way. B3 wires this into the -goldEvalCheck sibling that
// reads the run's relationship blocks; the framework's own suite proves the rule on the graph double.

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const { MAPPING_SOURCE_FAMILY, composeMappingSource } = vocabularyLib;
const { DEBUG_JUDGE_PROVIDER_NAME } = require(path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'judgeProviderRegistry'));
// the debug judge's mappingSource, composed from the registry's name for it, never a literal
const DEBUG_MAPPING_SOURCE = composeMappingSource({ family: MAPPING_SOURCE_FAMILY.BRIDGE, sourceName: DEBUG_JUDGE_PROVIDER_NAME });

const scalarOf = (value) => (Array.isArray(value) ? value[0] : value);

const debugEdgeRefusal = ({ harvestedEdgeList, blockLabel } = {}) => {
	if (!Array.isArray(harvestedEdgeList)) {
		return refuse.byName({ moduleName, what: 'harvestedEdgeList must be a list', where: 'debugEdgeRefusal({ harvestedEdgeList, blockLabel })' });
	}
	const unkindedList = harvestedEdgeList.filter((oneEdge) => !oneEdge || !oneEdge.properties || scalarOf(oneEdge.properties.mappingSource) === undefined || scalarOf(oneEdge.properties.mappingSource) === null);
	if (unkindedList.length > 0) {
		const firstUnkinded = unkindedList[0] || {};
		return refuse.byName({
			moduleName,
			what: `relationship block '${blockLabel === undefined ? '(unnamed)' : blockLabel}' carries ${unkindedList.length} edge(s) with NO mappingSource (first: ${firstUnkinded.fromStableId} -[${firstUnkinded.type}]-> ${firstUnkinded.toStableId})`,
			where: 'every mapping edge carries mappingSource since lane P (2026-10-04); an edge without one cannot be told from a debug edge, so it certifies nothing. Re-judge on the current framework',
		});
	}
	const offenderList = harvestedEdgeList.filter((oneEdge) => scalarOf(oneEdge.properties.mappingSource) === DEBUG_MAPPING_SOURCE);
	if (offenderList.length === 0) {
		return null;
	}
	const first = offenderList[0];
	return refuse.byName({
		moduleName,
		what: `relationship block '${blockLabel === undefined ? '(unnamed)' : blockLabel}' carries ${offenderList.length} edge(s) with mappingSource '${DEBUG_MAPPING_SOURCE}' (first: ${first.fromStableId} -[${first.type}]-> ${first.toStableId})`,
		where: 'a DEBUG-JUDGE block never reaches a certified graph (Profile v1.0.6 §4.6, RULING R5); re-judge with the real judge before promotion',
	});
};

module.exports = { debugEdgeRefusal, DEBUG_MAPPING_SOURCE, moduleName };
