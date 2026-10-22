'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerRoundTrip.js — the round-trip scaffold every LAYER's roundTripValidator stands on (lane DES, campaign
// cedsRichness-101226, 2026-10-12). A layer's validator supplies two pure-ish functions and gets the RT-13 entry point:
//
//   sourceStatementsOf({ snapshotPath, layerGraph }, callback(errString, Map<statementKey, statement>)) — from the SOURCE
//       bytes; layerGraph is handed in ONLY for what the reader read of the BASE (baseEndpointByStableId, baseQueryRowListByName)
//   graphStatementsOf({ layerGraph }) -> { error } | { graphStatements: Map }               — re-emitted from the GRAPH
//
//   validatorFor({ standardSource, layerKey, verdictVersion, semanticValidationLimit, sourceStatementsOf, graphStatementsOf,
//                  sourceFileList })
//     -> { validate(boltSpec, callback), validateWithLayerGraph({ snapshotPath, layerGraph, outputPath }, callback) }
//
// validate is the uniform RT-13 entry point ({ containerName, boltUrl, user, password, snapshotPath, outputPath }); it
// verifies the snapshot's SHA256SUMS before reading a byte (RT-3), reads the layer from the MATERIALIZED graph
// (openLayerGraphReader), and writes roundTripVerdict.json where the stage expects it. validateWithLayerGraph is the same
// comparison over a graph handed in (the Docker-free path the suites drive, twins included).
//
// A statement is { kind, value }; equality is the statementKey AND the value, so a changed cell is one lost statement plus
// one invented statement, never a match. Nothing is omitted by declaration: a layer's omission declaration is empty.

const fs = require('fs');
const path = require('path');
const sourceVerificationLib = require(path.join(__dirname, '..', 'forge-framework', 'sourceVerification'));
const { assembleVerdict } = require(path.join(__dirname, '..', 'forge-framework', 'roundTripHarness', 'verdictAssembler'));
const { openLayerGraphReader } = require(path.join(__dirname, '..', 'forge-framework', 'roundTripHarness', 'graphReader'));

const VERDICT_FILE_NAME = 'roundTripVerdict.json';

// valueKeyedMapOf — a statement map whose key includes the value, so equality of keys is equality of statements
const valueKeyedMapOf = (statementMap) => {
	const keyed = new Map();
	statementMap.forEach((oneStatement, oneStatementKey) => {
		keyed.set(`${oneStatementKey}␟${JSON.stringify(oneStatement.value)}`, { ...oneStatement, statementKey: oneStatementKey });
	});
	return keyed;
};

// baseEndpointPropertyNameList (R5 S3): the base-endpoint properties this layer's validator reads, declared by the validator
const validatorFor = ({ standardSource, layerKey, verdictVersion, semanticValidationLimit, sourceStatementsOf, graphStatementsOf, sourceFileList, baseQueryList, baseEndpointPropertyNameList } = {}) => {
	const omissionDeclaration = { rule: `the '${layerKey}' layer roundTripValidator: nothing is omitted by declaration`, kindPropertyName: 'kind', kindList: [], textBearingKindList: [], textPropertyName: '', caveatText: '' };

	// graphEndpoint ({ containerName, boltUrl }) is where a MATERIALIZED layer was read; it lands at verdict.graph, where
	// -goldEvalCheck's certificate reads the endpoint the round trip actually ran against (certificate-enrichment boltEndpoint)
	const compare = ({ snapshotPath, layerGraph, outputPath, graphEndpoint }, callback) => {
		const startedAt = Date.now();
		sourceVerificationLib.verifySnapshotChecksums({ snapshotDirPath: snapshotPath, relativePathList: sourceFileList }, (verifyError) => {
			if (verifyError) {
				callback(`${moduleName} '${layerKey}': ${verifyError}`);
				return;
			}
			sourceStatementsOf({ snapshotPath, layerGraph }, (sourceError, sourceStatements) => {
				if (sourceError) {
					callback(`${moduleName} '${layerKey}' source: ${sourceError}`);
					return;
				}
				const emitted = graphStatementsOf({ layerGraph });
				if (emitted.error) {
					callback(`${moduleName} '${layerKey}' graph: ${emitted.error}`);
					return;
				}
				const assembled = assembleVerdict({
					verdictVersion,
					semanticValidationLimit,
					sourceStatements: valueKeyedMapOf(sourceStatements),
					graphStatements: valueKeyedMapOf(emitted.graphStatements),
					wallClockMs: Date.now() - startedAt,
					peakMemoryBytes: process.memoryUsage().rss,
					sourceStats: { sourceStatementCount: sourceStatements.size },
					graphStats: { graphStatementCount: emitted.graphStatements.size, layerNodeCount: layerGraph.nodes.length, layerEdgeCount: layerGraph.edges.length },
					omissionDeclaration,
				});
				if (assembled.error) {
					callback(`${moduleName} '${layerKey}': ${assembled.error}`);
					return;
				}
				const verdict = graphEndpoint === undefined ? assembled.verdict : { ...assembled.verdict, standard: standardSource, layerKey, graph: { containerName: graphEndpoint.containerName, boltUrl: graphEndpoint.boltUrl, layerNodeCount: layerGraph.nodes.length, layerEdgeCount: layerGraph.edges.length } };
				if (typeof outputPath !== 'string' || outputPath === '') {
					callback('', verdict);
					return;
				}
				fs.mkdir(outputPath, { recursive: true }, (mkdirError) => {
					if (mkdirError) {
						callback(`${moduleName} '${layerKey}': cannot create ${outputPath}: ${mkdirError.message}`);
						return;
					}
					fs.writeFile(path.join(outputPath, VERDICT_FILE_NAME), JSON.stringify(verdict, null, '\t'), (writeError) =>
						callback(writeError ? `${moduleName} '${layerKey}': cannot write the verdict: ${writeError.message}` : '', verdict),
					);
				});
			});
		});
	};

	const validate = ({ containerName, boltUrl, user, password, snapshotPath, outputPath } = {}, callback) => {
		openLayerGraphReader({ boltUrl, user, password, standardSource, layerKey, baseQueryList: baseQueryList || [], baseEndpointPropertyNameList: baseEndpointPropertyNameList || [] }, (openError, reader) => {
			if (openError) {
				callback(openError);
				return;
			}
			reader.readLayer((readError, layerGraph) => {
				reader.close((closeError) => {
					if (readError || closeError) {
						callback(readError || closeError);
						return;
					}
					compare({ snapshotPath, layerGraph, outputPath, graphEndpoint: { containerName, boltUrl } }, callback);
				});
			});
		});
	};

	const validateWithLayerGraph = ({ snapshotPath, layerGraph, outputPath } = {}, callback) => compare({ snapshotPath, layerGraph, outputPath }, callback);

	return { validate, validateWithLayerGraph };
};

// layerGraphOfStampedGraph — the Docker-free double: the layer framework's stamped output read back the way the bolt
// reader returns a materialized layer (the suites' path; base endpoints carry what the reader would read of them)
const layerGraphOfStampedGraph = ({ stampedGraph, baseNodeEdges, baseEndpointPropertyNameList = [] }) => {
	const unwrap = (propertyValue) => (Array.isArray(propertyValue) && propertyValue.length === 1 ? propertyValue[0] : propertyValue);
	const baseByStableId = {};
	(baseNodeEdges.nodes || []).forEach((oneNode) => {
		baseByStableId[oneNode.stableId] = oneNode;
	});
	const baseEndpointByStableId = {};
	const edges = stampedGraph.edges.map((oneEdge) => {
		[oneEdge.fromRef.id, oneEdge.toRef.id].forEach((oneStableId) => {
			const baseNode = baseByStableId[oneStableId];
			if (baseNode) {
				baseEndpointByStableId[oneStableId] = baseEndpointPropertyNameList.reduce((soFar, oneName) => ({ ...soFar, [oneName]: unwrap(baseNode.properties[oneName]) }), { stableId: oneStableId, role: unwrap(baseNode.properties.role), labels: baseNode.labels });
			}
		});
		return { type: oneEdge.type, fromStableId: oneEdge.fromRef.id, toStableId: oneEdge.toRef.id, properties: { ...oneEdge.properties } };
	});
	return {
		nodes: stampedGraph.nodes.map((oneNode) => ({ stableId: oneNode.stableId, labels: oneNode.labels.slice(), role: oneNode.properties.role, properties: { ...oneNode.properties, stableId: oneNode.stableId } })),
		edges,
		baseEndpointByStableId,
	};
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	() => ({ validatorFor, layerGraphOfStampedGraph, VERDICT_FILE_NAME });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
