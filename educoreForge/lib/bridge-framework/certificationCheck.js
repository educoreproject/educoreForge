'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// certificationCheck.js — the goldEvalCheck BRIDGE SIBLING's rule (SPEC-bridgeFramework-v1.md §5.6 step 5 (e),
// §12 item 7, BG-DEBUG (c); RULING R5; Profile v1.0.6 §4.6): a DEBUG block MUST NOT reach a certified graph. PURE:
//   debugEdgeRefusal({ harvestedEdgeList, blockLabel }) → Error | null
// refuses by name any harvested mapping edge whose provenanceTier (scalar or the harvest's one-element list) is
// 'invalid-debug', naming the block and the first offender. B3 wires this into the -goldEvalCheck sibling that
// reads the run's relationship blocks; the framework's own suite proves the rule on the graph double.

const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const { PROVENANCE_TIER } = vocabularyLib;

const scalarOf = (value) => (Array.isArray(value) ? value[0] : value);

const debugEdgeRefusal = ({ harvestedEdgeList, blockLabel } = {}) => {
	if (!Array.isArray(harvestedEdgeList)) {
		return refuse.byName({ moduleName, what: 'harvestedEdgeList must be a list', where: 'debugEdgeRefusal({ harvestedEdgeList, blockLabel })' });
	}
	const offenderList = harvestedEdgeList.filter((oneEdge) => oneEdge && oneEdge.properties && scalarOf(oneEdge.properties.provenanceTier) === PROVENANCE_TIER.INVALID_DEBUG);
	if (offenderList.length === 0) {
		return null;
	}
	const first = offenderList[0];
	return refuse.byName({
		moduleName,
		what: `relationship block '${blockLabel === undefined ? '(unnamed)' : blockLabel}' carries ${offenderList.length} edge(s) with provenanceTier '${PROVENANCE_TIER.INVALID_DEBUG}' (first: ${first.fromStableId} -[${first.type}]-> ${first.toStableId})`,
		where: 'a DEBUG-JUDGE block never reaches a certified graph (Profile v1.0.6 §4.6, RULING R5); re-judge with the real judge before promotion',
	});
};

module.exports = { debugEdgeRefusal, moduleName };
