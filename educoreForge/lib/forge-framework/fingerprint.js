'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// fingerprint.js — fingerprint.pureLayerFingerprint (SPEC-forgeFramework-v1.md §3.3, §9.3, §10
// G-ID-CHEAP). The PROXY: sha256 over the pure output canonicalised exactly as the write→harvest→
// serialize path would, so a unit-time gate can stand in for the block-id gate. It is labelled
// PROXY in every report line because it CANNOT see: MERGE collapse (a duplicate stableId or a
// duplicate (from,type,to) triple collapses last-writer-wins in the graph, replay-engine.js:203-205,
// :288 — here both copies are hashed), the header, the hub fold, or embeddingRef lines. A green
// proxy is not a green G-ID.
//
// Canonicalisation mirrored (code facts):
//   shape-forged-graph.js:42-69 — every property value ARRAY-WRAPPED unless already an array;
//     embedding / embeddingModelVersion dropped from properties; ref = { source: _source, id: stableId }
//   replay-engine.js shapeNode :349-357 — _id, _source, embedding, stableId dropped from properties
//   replay-engine.js harvest :709, :739 — nodes ORDER BY stableId; edges ORDER BY from, type, to
//   replay-block.js serializeNodeLine :178-200 / serializeEdgeLine :202-215 — labels sorted,
//     property keys sorted, {kind, ref, labels, stableId, properties} / {kind, type, fromRef, toRef, properties}
// Node lines carry no embedding fields (the proxy hashes an un-embedded pure output).

const crypto = require('crypto');
const refuse = require('./refuse');

const DROPPED_PROPERTY_NAME_LIST = Object.freeze(['_id', '_source', 'embedding', 'embeddingModelVersion', 'stableId']);

const canonicalProperties = (properties) => {
	const out = {};
	Object.keys(properties || {})
		.filter((oneName) => DROPPED_PROPERTY_NAME_LIST.indexOf(oneName) === -1)
		.sort()
		.forEach((oneName) => {
			const value = properties[oneName];
			out[oneName] = Array.isArray(value) ? value : [value];
		});
	return out;
};

const compareStrings = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);

const canonicalNodeLine = (oneNode) =>
	JSON.stringify({
		kind: 'node',
		ref: { source: oneNode.properties._source, id: oneNode.stableId },
		labels: (oneNode.labels || []).slice().sort(),
		stableId: oneNode.stableId,
		properties: canonicalProperties(oneNode.properties),
	});

const canonicalEdgeLine = (oneEdge) =>
	JSON.stringify({
		kind: 'edge',
		type: oneEdge.type,
		fromRef: { source: oneEdge.fromRef.source, id: oneEdge.fromRef.id },
		toRef: { source: oneEdge.toRef.source, id: oneEdge.toRef.id },
		properties: (() => {
			const out = {};
			Object.keys(oneEdge.properties || {})
				.sort()
				.forEach((oneName) => {
					out[oneName] = oneEdge.properties[oneName];
				});
			return out;
		})(),
	});

// canonicalText({ nodes, edges }) → the exact text hashed (exported so a test can diff two runs line by line)
const canonicalText = ({ nodes, edges } = {}) => {
	if (!Array.isArray(nodes) || !Array.isArray(edges)) {
		throw refuse.byName({ moduleName, what: 'nodes and edges must both be arrays', where: 'pass a pure-layer { nodes, edges } result' });
	}
	const nodeLineList = nodes
		.slice()
		.sort((leftNode, rightNode) => compareStrings(`${leftNode.stableId}`, `${rightNode.stableId}`))
		.map(canonicalNodeLine);
	const edgeLineList = edges
		.slice()
		.sort(
			(leftEdge, rightEdge) =>
				compareStrings(`${leftEdge.fromRef.id}`, `${rightEdge.fromRef.id}`) ||
				compareStrings(`${leftEdge.type}`, `${rightEdge.type}`) ||
				compareStrings(`${leftEdge.toRef.id}`, `${rightEdge.toRef.id}`),
		)
		.map(canonicalEdgeLine);
	return nodeLineList.concat(edgeLineList).join('\n') + '\n';
};

const pureLayerFingerprint = ({ nodes, edges } = {}) =>
	crypto.createHash('sha256').update(canonicalText({ nodes, edges })).digest('hex');

module.exports = { pureLayerFingerprint, canonicalText, PROXY_LABEL: 'PROXY', moduleName };
