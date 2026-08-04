'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripGraphDouble.js — forge-edfi Phase 3 (RT-7): the hermetic reader double. Replays a
// forge's { nodes, edges } output AS IF it had been materialized, presenting the EXACT reader
// contract makeNeo4jEdfiReader produces ({ readAll, close }), so the compiler's emitter, the
// diff, and the gate twins can run with no container, no bolt, no network.
//
// STATED LIMIT (pesc precedent, kept verbatim in spirit): the double replays the forge's
// output as if it had been materialized — it does NOT audit the loader. That proof belongs to
// the real-container run (the RT-13 validator against DEV_edfiRoundTrip_080326). The fixture
// must not look stronger than it is.
//
// The projection lists are REQUIRED from the compiler module so the double can never drift
// from what the real reader reads — one list, two readers.
//
// adjustGraphRows (optional) mutates the assembled rows before they are handed back — the
// fault-injection seam for the RT-10 twins (delete a fact -> LOST must fire; inject a fact ->
// INVENTED must fire).

const roundTripEdfiCompiler = require('./roundTripEdfiCompiler')();

const ITEM_CARRIER_CONSTRUCT_TYPES = ['domain', 'subdomain', 'interchange', 'interchangeExtension'];
const CONSTRUCT_ROLES = ['DmeClass', 'DmeOptionSet', 'DmeSupport'];

const projectRow = ({ nodeProperties, projectionList }) => {
	const row = {};
	projectionList.forEach((onePropertyName) => {
		if (nodeProperties[onePropertyName] !== undefined) {
			row[onePropertyName] = nodeProperties[onePropertyName];
		}
	});
	return row;
};

const moduleFunction = () => {
	// makeGraphDouble({ forgeResult, adjustGraphRows? }) -> { readAll, close }
	//   forgeResult = { nodes, edges } in the universal forge property contract
	const makeGraphDouble = ({ forgeResult, adjustGraphRows }) => {
		if (!forgeResult || !Array.isArray(forgeResult.nodes) || !Array.isArray(forgeResult.edges)) {
			throw new Error(
				`${moduleName}.makeGraphDouble: forgeResult with nodes[] and edges[] is REQUIRED and has no default.`,
			);
		}

		const readAll = (callback) => {
			const nodeByStableId = {};
			forgeResult.nodes.forEach((oneNode) => {
				nodeByStableId[oneNode.stableId] = oneNode;
			});

			const rowsByFamily = {
				rootRow: undefined,
				constructRowList: [],
				propertyRowList: [],
				optionValueRowList: [],
				itemEdgeRowList: [],
				nodeCountByRole: {},
				edgeCountByType: {},
			};

			forgeResult.nodes.forEach((oneNode) => {
				const role = oneNode.role;
				rowsByFamily.nodeCountByRole[role] = (rowsByFamily.nodeCountByRole[role] || 0) + 1;
				if (role === 'DmeStandardRoot') {
					rowsByFamily.rootRow = projectRow({
						nodeProperties: oneNode.properties,
						projectionList: roundTripEdfiCompiler.ROOT_READ_PROPERTY_LIST,
					});
					return;
				}
				if (CONSTRUCT_ROLES.includes(role)) {
					rowsByFamily.constructRowList.push(
						projectRow({
							nodeProperties: oneNode.properties,
							projectionList: roundTripEdfiCompiler.CONSTRUCT_READ_PROPERTY_LIST,
						}),
					);
					return;
				}
				if (role === 'DmeProperty') {
					rowsByFamily.propertyRowList.push(
						projectRow({
							nodeProperties: oneNode.properties,
							projectionList: roundTripEdfiCompiler.PROPERTY_READ_PROPERTY_LIST,
						}),
					);
					return;
				}
				if (role === 'DmeOptionValue') {
					rowsByFamily.optionValueRowList.push(
						projectRow({
							nodeProperties: oneNode.properties,
							projectionList: roundTripEdfiCompiler.OPTION_VALUE_READ_PROPERTY_LIST,
						}),
					);
				}
			});

			forgeResult.edges.forEach((oneEdge) => {
				rowsByFamily.edgeCountByType[oneEdge.type] =
					(rowsByFamily.edgeCountByType[oneEdge.type] || 0) + 1;
				if (oneEdge.type !== 'REFERENCES') {
					return;
				}
				const fromNode = nodeByStableId[oneEdge.fromRef.id];
				const toNode = nodeByStableId[oneEdge.toRef.id];
				if (!fromNode || !toNode) {
					return;
				}
				if (
					fromNode.role === 'DmeSupport' &&
					ITEM_CARRIER_CONSTRUCT_TYPES.includes(fromNode.properties.constructType) &&
					['DmeClass', 'DmeOptionSet', 'DmeSupport'].includes(toNode.role)
				) {
					rowsByFamily.itemEdgeRowList.push({
						fromStableId: fromNode.stableId,
						fromConstructType: fromNode.properties.constructType,
						fromName: fromNode.properties.name,
						toName: toNode.properties.name,
						toConstructType: toNode.properties.constructType,
					});
				}
			});

			const graphRows = adjustGraphRows ? adjustGraphRows(rowsByFamily) || rowsByFamily : rowsByFamily;
			callback('', graphRows);
		};

		const close = (callback) => callback('');

		return { readAll, close };
	};

	return { makeGraphDouble };
};

module.exports = moduleFunction;
