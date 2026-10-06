'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// embedding-coverage-gate.js — the embeddingCoverage BuildAttestation row (campaign P2, W-A-11 / V1-C44, PLAN B1/G4).
//
// Until P2 the only check that every node had a vector was integration-forge.js asserting EVERY ForgedNode carries a
// 1024-dim embedding — false by design for declared non-embeddable roles and DmeEmbedText — and no build-time gate counted
// anything. Stated for today's graphs, coverage is four counts over the materialised graph, each of which must be 0:
//   searchTextWithoutVector — a node with searchText (its embed input) lacking an embedding of the run's model and width
//   cardWithoutVector       — a hub card with embedText lacking an embedding of the run's width
//   textWithoutVector       — a DmeEmbedText with text lacking a textEmbedding of the run's width
//   vectorWithoutSearchText — an embedding on a non-card node that has no searchText (a vector of nothing declared)
// THE RUN'S EMBEDDER IDENTITY is read from the manifest's own block headers (embeddingModelVersion, embeddingDims): the
// blocks are what the graph was made from, for a -build and a -replay alike. Blocks carrying no embedder identity mean a
// --vectorize=false manifest: the row reads notRun with that reason, never pass. Two identities refuse by name.
//
//   embeddingIdentityFor(schemaBlockTextList) → { embeddingModelVersion, embeddingDims } | { vectorless: true } | { error }
//   embeddingCoverageRowFor({ censusRow, embeddingIdentity }) → the BuildAttestation row (pure)
//   runEmbeddingCoverageGate({ containerHandle, schemaBlockTextList }, callback(err, row)) → reads the graph (READ session)
//
// Async style: callback(errString, result). No async/await, no try/catch-for-control-flow.

const neo4j = require('neo4j-driver');
const path = require('path');
const vocabulary = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const GATE_NAME = 'embeddingCoverage';
const COUNT_NAME_LIST = Object.freeze(['searchTextWithoutVector', 'cardWithoutVector', 'textWithoutVector', 'vectorWithoutSearchText']);
const EMBEDDING_COVERAGE_CENSUS_CYPHER = `
	CALL { MATCH (n:ForgedNode) WHERE n.searchText IS NOT NULL AND (n.embedding IS NULL OR size(n.embedding) <> $embeddingDims OR n.embeddingModelVersion IS NULL OR n.embeddingModelVersion <> $embeddingModelVersion) RETURN count(n) AS searchTextWithoutVector }
	CALL { MATCH (h:HubReference) WHERE h.embedText IS NOT NULL AND (h.embedding IS NULL OR size(h.embedding) <> $embeddingDims) RETURN count(h) AS cardWithoutVector }
	CALL { MATCH (t:\`${vocabulary.EMBED_TEXT_VECTOR.label}\`) WHERE t.text IS NOT NULL AND (t.\`${vocabulary.EMBED_TEXT_VECTOR.propertyName}\` IS NULL OR size(t.\`${vocabulary.EMBED_TEXT_VECTOR.propertyName}\`) <> $embeddingDims) RETURN count(t) AS textWithoutVector }
	CALL { MATCH (n:ForgedNode) WHERE n.embedding IS NOT NULL AND n.searchText IS NULL AND NOT n:HubReference RETURN count(n) AS vectorWithoutSearchText }
	RETURN searchTextWithoutVector, cardWithoutVector, textWithoutVector, vectorWithoutSearchText`;

// embeddingIdentityFor — the manifest blocks' header identities, which must be one (or none, a vectorless manifest)
// a header line that is not a JSON object — refused by name, never thrown (the caller is a callback chain)
const headerOf = (headerText) => (/^\{.*\}$/.test(headerText) ? JSON.parse(headerText) : null);
const embeddingIdentityFor = (schemaBlockTextList) => {
	const identityTextSet = new Set();
	const unreadableList = [];
	// a manifest member resolves to a block text OR a { text, refId } store row (replayManager.schemaBlockTexts takes both)
	(schemaBlockTextList || []).forEach((oneBlock, blockIndex) => {
		const header = headerOf(`${typeof oneBlock === 'string' ? oneBlock : (oneBlock || {}).text}`.split('\n', 1)[0]);
		if (header === null) {
			unreadableList.push(blockIndex);
			return;
		}
		// a vectorless block's header carries embeddingDims null and no model: that is no identity, not a malformed one
		const declaresIdentity = [header.embeddingModelVersion, header.embeddingDims].some((oneValue) => oneValue !== undefined && oneValue !== null);
		if (declaresIdentity) {
			identityTextSet.add(JSON.stringify({ embeddingModelVersion: header.embeddingModelVersion, embeddingDims: header.embeddingDims }));
		}
	});
	if (unreadableList.length) {
		return { error: `${moduleName} REFUSED: block(s) at position ${unreadableList.join(', ')} carry no JSON header line, so the manifest's embedder identity cannot be read` };
	}
	if (identityTextSet.size === 0) {
		return { vectorless: true };
	}
	const onlyIdentity = identityTextSet.size === 1 ? JSON.parse(Array.from(identityTextSet)[0]) : null;
	if (onlyIdentity && (typeof onlyIdentity.embeddingModelVersion !== 'string' || !Number.isInteger(onlyIdentity.embeddingDims))) {
		return { error: `${moduleName} REFUSED: the manifest's embedder identity ${JSON.stringify(onlyIdentity)} names no model or no integer width` };
	}
	if (identityTextSet.size > 1) {
		return { error: `${moduleName} REFUSED: the manifest's blocks declare ${identityTextSet.size} embedder identities (${Array.from(identityTextSet).join(', ')}) — one graph is embedded by one model at one width` };
	}
	return JSON.parse(Array.from(identityTextSet)[0]);
};

// embeddingCoverageRowFor — the row from the census: pass only when all four counts are 0
const embeddingCoverageRowFor = ({ censusRow, embeddingIdentity }) => {
	if (embeddingIdentity.vectorless) {
		return { gate: GATE_NAME, verdict: vocabulary.BUILD_ATTESTATION_VERDICT.NOT_RUN, detail: 'vectorize=false: the manifest\'s blocks carry no embedder identity, so no vectors were made and none are counted' };
	}
	const countByName = COUNT_NAME_LIST.reduce((soFar, oneName) => ({ ...soFar, [oneName]: Number(censusRow[oneName]) }), {});
	const missingVectorTotal = COUNT_NAME_LIST.reduce((runningTotal, oneName) => runningTotal + countByName[oneName], 0);
	return {
		gate: GATE_NAME,
		verdict: missingVectorTotal === 0 ? vocabulary.BUILD_ATTESTATION_VERDICT.PASS : vocabulary.BUILD_ATTESTATION_VERDICT.FAIL,
		detail: `${COUNT_NAME_LIST.map((oneName) => `${oneName} ${countByName[oneName]}`).join(', ')} (model ${embeddingIdentity.embeddingModelVersion} x ${embeddingIdentity.embeddingDims})`,
		missingVectorTotal,
	};
};

const runEmbeddingCoverageGate = ({ containerHandle, schemaBlockTextList } = {}, callback) => {
	const embeddingIdentity = embeddingIdentityFor(schemaBlockTextList);
	if (embeddingIdentity.error) {
		callback(embeddingIdentity.error);
		return;
	}
	if (embeddingIdentity.vectorless) {
		callback('', embeddingCoverageRowFor({ censusRow: {}, embeddingIdentity }));
		return;
	}
	if (!containerHandle || !containerHandle.boltUrl || !containerHandle.password) {
		callback(`${moduleName}: the container handle carries no boltUrl/password — the census reads the materialised graph`);
		return;
	}
	const driver = neo4j.driver(containerHandle.boltUrl, neo4j.auth.basic('neo4j', containerHandle.password), { encrypted: false });
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const closeAll = () => session.close().then(() => driver.close(), () => driver.close());
	// two-armed then (not .catch): a throw inside the caller's callback must not re-enter it as a census failure
	session.run(EMBEDDING_COVERAGE_CENSUS_CYPHER, { embeddingDims: neo4j.int(embeddingIdentity.embeddingDims), embeddingModelVersion: embeddingIdentity.embeddingModelVersion }).then(
		(result) => {
			const record = result.records[0];
			const censusRow = COUNT_NAME_LIST.reduce((soFar, oneName) => ({ ...soFar, [oneName]: record.get(oneName).toNumber() }), {});
			closeAll();
			callback('', embeddingCoverageRowFor({ censusRow, embeddingIdentity }));
		},
		(censusError) => {
			closeAll();
			callback(`${moduleName}: the census failed: ${censusError.message}`);
		},
	);
};

module.exports = { GATE_NAME, COUNT_NAME_LIST, EMBEDDING_COVERAGE_CENSUS_CYPHER, embeddingIdentityFor, embeddingCoverageRowFor, runEmbeddingCoverageGate, moduleName };
