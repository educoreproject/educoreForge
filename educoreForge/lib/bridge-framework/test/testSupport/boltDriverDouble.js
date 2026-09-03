'use strict';

const { edgeConservationIdentityFor } = require(require('path').join(__dirname, '..', '..', '..', 'replay', 'replay-engine'))();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// boltDriverDouble.js — a neo4j-driver DOUBLE for BG-BOLT (RULING BR1): the two bolt files (graphReader.js,
// graphWriter.js) are compiled through moduleDouble with their ONE `require('neo4j-driver')` swapped for this
// module's `neo4j`, so the Cypher THEY EMIT is executed against an in-memory { nodeList, edgeList } state — the
// same state shape graphDouble.js holds — and the two halves can be compared behaviourally with no container.
//
// The interpreter recognises EXACTLY the Cypher shapes the bolt files emit today (a paged node read, the
// among-source edge read, the writer's endpoint lookup, the writer's stamp-and-MERGE). Anything else REJECTS the
// promise by name: a twin that reshapes a query beyond recognition goes red for that reason, loudly, never green.
// The double is DELIBERATELY literal about the clauses that carry the invariants under test — it applies exactly
// the label stamps the SET clause names, filters by exactly the WHERE conditions present — so removing `o:\`L\``
// or `WHERE n._source = $x` from the bolt file CHANGES what this double does.
//
//   useState(state)         → bind the in-memory graph { nodeList: [{ stableId, labels, properties }], edgeList: [{ fromStableId, toStableId, type, properties }] }
//   neo4j                   → { driver, auth: { basic }, int, isInt }  (the surface graphReader/graphWriter use)
//   cypherLog()             → every cypher text run since useState (for the conjuncts that read the text)

let currentState = null;
let cypherLog = [];

const useState = (state) => {
	currentState = state;
	cypherLog = [];
};

const refuseCypher = (cypher, why) => Promise.reject(new Error(`${moduleName} REFUSED: unrecognised cypher (${why}): ${cypher}`));

const parseParamConditionList = (whereText) => {
	// conditions of the form `<var>.<prop> = $<param>` or `type(<var>) IN $<param>` joined by AND
	if (whereText === undefined || whereText === null || whereText.trim() === '') {
		return [];
	}
	return whereText.split(/\s+AND\s+/).map((oneClause) => {
		const propertyMatch = /^(\w+)\.(\w+)\s*=\s*\$(\w+)$/.exec(oneClause.trim());
		if (propertyMatch) {
			return { kind: 'propertyEquals', variableName: propertyMatch[1], propertyName: propertyMatch[2], parameterName: propertyMatch[3] };
		}
		const typeMatch = /^type\((\w+)\)\s+IN\s+\$(\w+)$/.exec(oneClause.trim());
		if (typeMatch) {
			return { kind: 'typeIn', variableName: typeMatch[1], parameterName: typeMatch[2] };
		}
		return { kind: 'unrecognised', text: oneClause };
	});
};

const nodeMatches = (oneNode, conditionList, parameters, variableName) =>
	conditionList.filter((oneCondition) => oneCondition.variableName === variableName).every((oneCondition) => oneCondition.kind === 'propertyEquals' && oneNode.properties[oneCondition.propertyName] === parameters[oneCondition.parameterName]);

// a paged node read: MATCH (n[:Label]) [WHERE <conds>] RETURN n ORDER BY n.stableId SKIP $skip LIMIT $limit
const runNodeRead = (cypher, parameters) => {
	const match = /^MATCH \(n(?::(\w+))?\)(?: WHERE (.+?))? RETURN n ORDER BY n\.stableId SKIP \$skip LIMIT \$limit$/.exec(cypher);
	if (!match) {
		return null;
	}
	const labelName = match[1];
	const conditionList = parseParamConditionList(match[2]);
	if (conditionList.some((oneCondition) => oneCondition.kind === 'unrecognised')) {
		return refuseCypher(cypher, 'node read WHERE clause');
	}
	const skip = Number(parameters.skip);
	const limit = Number(parameters.limit);
	const matched = currentState.nodeList
		.filter((oneNode) => (labelName === undefined || oneNode.labels.indexOf(labelName) !== -1) && nodeMatches(oneNode, conditionList, parameters, 'n'))
		.slice()
		.sort((leftNode, rightNode) => (String(leftNode.stableId) < String(rightNode.stableId) ? -1 : String(leftNode.stableId) > String(rightNode.stableId) ? 1 : 0))
		.slice(skip, skip + limit);
	return Promise.resolve({ records: matched.map((oneNode) => ({ get: (name) => (name === 'n' ? { labels: oneNode.labels.slice(), properties: { ...oneNode.properties } } : undefined) })) });
};

// the among-source edge read: MATCH (a)-[r]->(b) WHERE <conds> RETURN a.stableId AS fromStableId, b.stableId AS toStableId, type(r) AS edgeType, properties(r) AS edgeProperties
const runEdgeRead = (cypher, parameters) => {
	const match = /^MATCH \(a\)-\[r\]->\(b\)(?: WHERE (.+?))? RETURN a\.stableId AS fromStableId, b\.stableId AS toStableId, type\(r\) AS edgeType, properties\(r\) AS edgeProperties$/.exec(cypher);
	if (!match) {
		return null;
	}
	const conditionList = parseParamConditionList(match[1]);
	if (conditionList.some((oneCondition) => oneCondition.kind === 'unrecognised')) {
		return refuseCypher(cypher, 'edge read WHERE clause');
	}
	const nodeByStableId = currentState.nodeList.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {});
	const typeCondition = conditionList.find((oneCondition) => oneCondition.kind === 'typeIn');
	const rowList = currentState.edgeList.filter((oneEdge) => {
		const fromNode = nodeByStableId[oneEdge.fromStableId];
		const toNode = nodeByStableId[oneEdge.toStableId];
		if (!fromNode || !toNode) {
			return false;
		}
		if (!nodeMatches(fromNode, conditionList, parameters, 'a') || !nodeMatches(toNode, conditionList, parameters, 'b')) {
			return false;
		}
		if (typeCondition && (Array.isArray(parameters[typeCondition.parameterName]) ? parameters[typeCondition.parameterName] : []).indexOf(oneEdge.type) === -1) {
			return false;
		}
		return true;
	});
	return Promise.resolve({
		records: rowList.map((oneEdge) => ({
			get: (name) => ({ fromStableId: oneEdge.fromStableId, toStableId: oneEdge.toStableId, edgeType: oneEdge.type, edgeProperties: { ...oneEdge.properties } })[name],
		})),
	});
};

// the writer's endpoint lookup
const LOOKUP_CYPHER = 'OPTIONAL MATCH (s {stableId: $subjectStableId}) WITH s OPTIONAL MATCH (o {stableId: $objectStableId}) RETURN s._source AS subjectSource, labels(s) AS subjectLabels, s IS NOT NULL AS subjectPresent, labels(o) AS objectLabels, o.referenceTier AS objectReferenceTier, o IS NOT NULL AS objectPresent';
const runLookup = (cypher, parameters) => {
	if (cypher !== LOOKUP_CYPHER) {
		return null;
	}
	const subjectNode = currentState.nodeList.find((oneNode) => oneNode.stableId === parameters.subjectStableId);
	const objectNode = currentState.nodeList.find((oneNode) => oneNode.stableId === parameters.objectStableId);
	const row = {
		subjectSource: subjectNode ? subjectNode.properties._source : null,
		subjectLabels: subjectNode ? subjectNode.labels.slice() : null,
		subjectPresent: Boolean(subjectNode),
		objectLabels: objectNode ? objectNode.labels.slice() : null,
		objectReferenceTier: objectNode ? objectNode.properties.referenceTier : null,
		objectPresent: Boolean(objectNode),
	};
	return Promise.resolve({ records: [{ get: (name) => row[name] }] });
};

// the writer's stamp-and-MERGE, JOB 5a form: MATCH (s {stableId: $subjectStableId}) MATCH (o[:Label]
// {stableId: $objectStableId}) SET <stamps> WITH s, o CALL apoc.merge.relationship(s, $edgeType,
// $edgeProperties, {}, o) YIELD rel RETURN count(rel) AS edgeCount
// ⚠ THIS DOUBLE MUST MERGE BY THE SAME RULE AS THE REAL DRIVER. It keys on the FULL edge identity —
// the same exported function the loader, the writer and graphDouble use — because apoc.merge.relationship
// matches on the identity map it is handed. Keying on (from, type, to) here, as this runner did before
// JOB 5a, would make the double collapse edges the real driver keeps, and every BG-BOLT conjunct that
// compares bolt against double would then be comparing the double against a fiction.
const runStampAndMerge = (cypher, parameters) => {
	const match = /^MATCH \(s \{stableId: \$subjectStableId\}\) MATCH \(o(?::(\w+))? \{stableId: \$objectStableId\}\)(?: SET ((?:\w+:`[^`]+`(?:, )?)+))? WITH s, o CALL apoc\.merge\.relationship\(s, \$edgeType, \$edgeProperties, \{\}, o\) YIELD rel RETURN count\(rel\) AS edgeCount$/.exec(cypher);
	if (!match) {
		return null;
	}
	const objectLabelName = match[1];
	const stampText = match[2] === undefined ? '' : match[2];
	const edgeType = parameters.edgeType; // a PARAMETER since JOB 5a, no longer interpolated into the text
	const subjectNode = currentState.nodeList.find((oneNode) => oneNode.stableId === parameters.subjectStableId);
	const objectNode = currentState.nodeList.find((oneNode) => oneNode.stableId === parameters.objectStableId && (objectLabelName === undefined || oneNode.labels.indexOf(objectLabelName) !== -1));
	if (!subjectNode || !objectNode) {
		return Promise.resolve({ records: [{ get: () => 0 }] });
	}
	const stampList = stampText === '' ? [] : stampText.split(', ').map((oneStamp) => { const stampMatch = /^(\w+):`([^`]+)`$/.exec(oneStamp); return { variableName: stampMatch[1], labelName: stampMatch[2] }; });
	const nodeByVariable = { s: subjectNode, o: objectNode };
	stampList.forEach((oneStamp) => {
		const target = nodeByVariable[oneStamp.variableName];
		if (target && target.labels.indexOf(oneStamp.labelName) === -1) {
			target.labels.push(oneStamp.labelName);
		}
	});
	const identityOf = (oneShape) => edgeConservationIdentityFor({ type: oneShape.type, fromRef: { id: oneShape.fromStableId }, toRef: { id: oneShape.toStableId }, properties: oneShape.properties });
	const incomingShape = { fromStableId: subjectNode.stableId, toStableId: objectNode.stableId, type: edgeType, properties: { ...parameters.edgeProperties } };
	const existing = currentState.edgeList.find((oneEdge) => identityOf(oneEdge) === identityOf(incomingShape));
	if (!existing) {
		currentState.edgeList.push(incomingShape);
	}
	return Promise.resolve({ records: [{ get: () => 1 }] });
};

const RUNNER_LIST = [runNodeRead, runEdgeRead, runLookup, runStampAndMerge];

const makeSession = () => ({
	run: (cypher, parameters) => {
		if (currentState === null) {
			return Promise.reject(new Error(`${moduleName} REFUSED: useState(state) was not called before the bolt file ran`));
		}
		cypherLog.push(cypher);
		for (let runnerIndex = 0; runnerIndex < RUNNER_LIST.length; runnerIndex++) {
			const outcome = RUNNER_LIST[runnerIndex](cypher, parameters === undefined ? {} : parameters);
			if (outcome !== null) {
				return outcome;
			}
		}
		return refuseCypher(cypher, 'no runner recognises this shape');
	},
	close: () => Promise.resolve(),
});

const neo4j = Object.freeze({
	driver: () => ({ session: makeSession, close: () => Promise.resolve() }),
	auth: Object.freeze({ basic: (user, password) => ({ user, password }) }),
	int: (value) => value,
	isInt: () => false, // the double hands back plain JS numbers, never neo4j Integer objects
});

module.exports = { neo4j, useState, cypherLog: () => cypherLog.slice(), LOOKUP_CYPHER, moduleName };
