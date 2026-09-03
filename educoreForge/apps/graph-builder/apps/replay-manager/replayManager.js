'use strict';

/** @implements {ReplayManagerComponent} — formal contract declared in
 *  apps/graph-builder/interfaces.js (GraphHandle typedef there); enforced by test-interfaces. */

// replayManager — the single block<->graph boundary (targetArchitectureDesign §4). In-process
// module of graphBuilder; async callback style (err-string first, no async/await).
//
//   replayManager() -> {
//     create(spec, callback)      -> ('', handle)   handle = { graphName, containerName,
//                                                     boltUrl, user, password, boltPort, httpPort }
//        spec = { purpose?, graphName? } — graphName is minted DEV_gb_<purpose>_<pid>_<seq>
//        when not given; a GIVEN name must be DEV_* (GNC-001 scratch tier) or create REFUSES.
//     init(spec, callback)        -> ('', report)   THE ONE polymorphic loader, two payloads:
//        spec = { inGraph, nodeEdges, applyLabels }  CREATION    — freshly forged material
//        spec = { inGraph, schemaBlocks }            RESTORATION — previously harvested blocks
//        report = { nodesMerged, edgesMerged, danglingRefs, indexesBuilt } from EITHER payload
//     harvest(spec, callback)     -> ('', schemaBlock)  spec = { inGraph, selectionLabels, header }
//     delete(handle, callback)    -> ('')           removes the container; DEV_* only
//   }
//
// TODAY'S SCOPE: all four verbs are REAL. create/delete provision and destroy throwaway DEV_*
// Neo4j containers; init loads either payload through the shared write path; harvest is the
// fidelity-critical reversal (punch item 24) and is the ONLY place a schema block is born. The
// -build orchestrator drives this module directly as of 2026-07-23 — the stub-era placeholder
// behaviors in graph-builder/lib/stub-components.js are DELETED, along with the file, because a
// second set of implementations turned out to be a second contract that drifted.
//
// Provisioning mechanics (image, port-pair allocation, auth env, readiness = bolt TCP + an
// authenticated cypher round-trip) are carried from the incumbent instance-lifecycle — MINUS
// its forge-store credential registry and named volumes: a scratch graph's credential lives in
// the returned handle and nowhere else, and its data dies with the container (`docker rm -f`).
//
// HARD SAFETY LINE (GNC-001): every container this module creates or deletes is DEV_*-named.
// GOLD_* and gf_* are refused by name before any docker command runs.

const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// tree-root lib/ (five levels up: replay-manager -> apps -> graph-builder -> apps -> root)
const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', 'lib');
const replayEngine = require(path.join(TREE_LIB, 'replay', 'replay-engine'))();
const contentAddress = require(path.join(TREE_LIB, 'content-address', 'content-address'))();
const vocabulary = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));
const finishingModule = require(path.join(__dirname, 'lib', 'finishing', 'finishing'));
const passportWriterModule = require(path.join(__dirname, 'lib', 'finishing', 'passport-writer'));

// The provisioning knobs live in graphBuilder.ini, [replay-manager] section: neo4jImage,
// portSearchStart, portSearchSpan, readyTimeoutSeconds. All four are REQUIRED and all four are
// VALIDATED (Phase 4, work group 2). There is no in-code default for any of them, and there is
// deliberately nothing here to shadow a settable key: this module once claimed in its own header
// that "an unconfigured tree runs on exactly these values", which made a deleted config line and
// a mistyped one produce the same silence.
//
// NEO4J_USER is the one legitimate constant in this file — it is not settable at all, so there
// is nothing to omit and nothing to shadow (polyArch2 §6).
const NEO4J_USER = 'neo4j';

// THE DECLARED CONSERVATION EXEMPTION (WORKORDER-sifViaConservation-090226, JOB 2).
// harvest REFUSES a spec that carries no conservationExpectation at all, because an absent field
// would make "nobody threaded the loaded set" indistinguishable from "there is legitimately nothing
// to compare against" — the silent-default shape this whole order exists to correct. A caller with
// no loaded set says so, by name, and the name says WHY rather than what it skips. It is PRINTED on
// the harvest status line: an exemption nobody can see in the build log is a silent skip with
// paperwork.
//
// MEASURED 2026-09-02, which is why this exists: bridgeMaker.run does NOT write through
// writeShapedGraph/mergeEdges — it issues its own statement in lib/bridge-framework/graphWriter.js —
// so the relationship harvest has no init-captured loaded set to compare against. That seam is
// docketed separately.
const CONSERVATION_NOT_LOADED_THROUGH_INIT = 'NOT_LOADED_THROUGH_INIT';

// compareConservation — the DISTINCT-SET comparison, both directions.
// DUPLICATES ARE A NUMBER, NEVER A FAILURE. Had this gate existed on 2026-09-02 as a naive count
// check it would have refused a build over nine cosmetic duplicate emissions while missing the real
// defect entirely. Loss and invention refuse; duplication is reported and carried on.
const CONSERVATION_NAMED_SAMPLE_LIMIT = 3;
const compareConservation = ({ expectation, harvested, graphName }) => {
	if (expectation === undefined || expectation === null) {
		return {
			error:
				`replayManager.harvest '${graphName}': REFUSED — the spec carries no ` +
				`conservationExpectation. Pass the loadedConservationSummary returned by init, or ` +
				`declare '${CONSERVATION_NOT_LOADED_THROUGH_INIT}' if this material was not loaded ` +
				`through init and there is genuinely nothing to conserve against. An absent field ` +
				`would make a forgotten thread indistinguishable from a legitimate exemption, and no ` +
				`block is minted on a comparison nobody made.`,
		};
	}
	if (expectation === CONSERVATION_NOT_LOADED_THROUGH_INIT) {
		return {
			statusText:
				`conservation ${CONSERVATION_NOT_LOADED_THROUGH_INIT}: '${graphName}' harvested ` +
				`${harvested.nodeTotal} nodes, ${harvested.edgeTotal} edges with NO loaded set to ` +
				`compare against (declared, not skipped)`,
		};
	}
	if (!expectation.edgeIdentitySet || !expectation.nodeIdentitySet) {
		return {
			error:
				`replayManager.harvest '${graphName}': REFUSED — conservationExpectation is neither ` +
				`'${CONSERVATION_NOT_LOADED_THROUGH_INIT}' nor a summary carrying nodeIdentitySet and ` +
				`edgeIdentitySet. A malformed expectation must not read as a passing comparison.`,
		};
	}
	const missingEdgeList = [];
	expectation.edgeIdentitySet.forEach((oneKey) => {
		if (!harvested.edgeIdentitySet.has(oneKey)) { missingEdgeList.push(oneKey); }
	});
	const inventedEdgeList = [];
	harvested.edgeIdentitySet.forEach((oneKey) => {
		if (!expectation.edgeIdentitySet.has(oneKey)) { inventedEdgeList.push(oneKey); }
	});
	const missingNodeList = [];
	expectation.nodeIdentitySet.forEach((oneKey) => {
		if (!harvested.nodeIdentitySet.has(oneKey)) { missingNodeList.push(oneKey); }
	});
	const inventedNodeList = [];
	harvested.nodeIdentitySet.forEach((oneKey) => {
		if (!expectation.nodeIdentitySet.has(oneKey)) { inventedNodeList.push(oneKey); }
	});
	const nameSample = (oneList) =>
		oneList
			.slice(0, CONSERVATION_NAMED_SAMPLE_LIMIT)
			.map((oneKey) => oneKey.split('\u241f').slice(0, 3).join(' '))
			.join(' | ');
	if (missingEdgeList.length || inventedEdgeList.length || missingNodeList.length || inventedNodeList.length) {
		return {
			error:
				`replayManager.harvest '${graphName}': REFUSED — CONSERVATION FAILED across the ` +
				`forge-to-harvest seam. edges missing ${missingEdgeList.length}, edges invented ` +
				`${inventedEdgeList.length}, nodes missing ${missingNodeList.length}, nodes invented ` +
				`${inventedNodeList.length}. ` +
				(missingEdgeList.length ? `first missing edge(s): ${nameSample(missingEdgeList)}. ` : '') +
				(inventedEdgeList.length ? `first invented edge(s): ${nameSample(inventedEdgeList)}. ` : '') +
				(missingNodeList.length ? `first missing node(s): ${nameSample(missingNodeList)}. ` : '') +
				(inventedNodeList.length ? `first invented node(s): ${nameSample(inventedNodeList)}. ` : '') +
				`No block minted.`,
		};
	}
	const duplicateEdgeCount = expectation.edgeTotal - expectation.edgeIdentitySet.size;
	const duplicateNodeCount = expectation.nodeTotal - expectation.nodeIdentitySet.size;
	return {
		statusText:
			`conservation OK: '${graphName}' loaded ${expectation.edgeTotal} edge emission(s) / ` +
			`${expectation.edgeIdentitySet.size} distinct, harvested ${harvested.edgeIdentitySet.size} ` +
			`distinct — nothing missing, nothing invented; ${duplicateEdgeCount} duplicate edge ` +
			`emission(s), ${duplicateNodeCount} duplicate node emission(s) (reported, not a failure); ` +
			`nodes ${expectation.nodeIdentitySet.size} distinct both sides`,
	};
};

const CONFIG_SECTION = 'replay-manager';
const CONFIG_FILE = 'graphBuilder.ini';

// -----
// requiredConfigText — the ONE reading of a [replay-manager] key. polyArch2 §6: an absent key is
// a fault, and a PRESENT-but-invalid one is the worse fault, because the person who typed it
// believes it took effect. Nothing here substitutes; a refusal names the key, the section, the
// file, and — when there is one — the value that was actually given.
const requiredConfigText = (config, keyName) => {
	const rawValue = config[keyName];
	if (rawValue === undefined || rawValue === null) {
		throw new Error(
			`[replayManager] ${keyName} is not configured. Add it to the [${CONFIG_SECTION}] ` +
				`section of ${CONFIG_FILE}. There is no default.`,
		);
	}
	const value = String(rawValue).trim();
	if (value === '') {
		throw new Error(
			`[replayManager] ${keyName} is present but EMPTY in the [${CONFIG_SECTION}] section ` +
				`of ${CONFIG_FILE}. A blank value is not a value; give it one or the key is a lie.`,
		);
	}
	return value;
};

// -----
// requiredImageReference — a docker image reference cannot contain whitespace, so `neo4j: 5.26`
// (the stray space a human leaves behind) is INVALID, not something to normalize.
const requiredImageReference = (config, keyName) => {
	const value = requiredConfigText(config, keyName);
	if (/\s/.test(value)) {
		throw new Error(
			`[replayManager] ${keyName}='${value}' is not a docker image reference — it contains ` +
				`whitespace. Fix it in the [${CONFIG_SECTION}] section of ${CONFIG_FILE}. It was ` +
				`NOT corrected to a default.`,
		);
	}
	return value;
};

// -----
// requiredConfigNumber — ini values arrive as strings, so Number() is required; what is NOT
// permitted is coercing and then defaulting, which reads a typo and an absence as the same thing
// and answers with a value nobody chose. An unparseable value is refused BY NAME.
const requiredConfigNumber = (config, keyName) => {
	const value = requiredConfigText(config, keyName);
	const number = Number(value);
	if (!Number.isFinite(number)) {
		throw new Error(
			`[replayManager] ${keyName}='${value}' is not a number. Fix it in the ` +
				`[${CONFIG_SECTION}] section of ${CONFIG_FILE}. It was NOT corrected to a default.`,
		);
	}
	return number;
};

// resolve the effective settings at CALL time (process.global may not exist at require time).
// getConfig is injectable for the test suite ONLY — production callers pass nothing and get the
// frozen process.global one. Exported so the config->settings mapping is provable without a
// live container.
//
// A configuration fault THROWS rather than answering an error string: this function has no
// callback, it is the single reading of the section, and a tree whose provisioning knobs are
// wrong has nothing sensible to do next. polyArch2 §6's own example is this very key set.
const resolveSettings = (getConfig = process.global.getConfig) => {
	const config = (getConfig && getConfig(CONFIG_SECTION)) || {};
	return {
		neo4jImage: requiredImageReference(config, 'neo4jImage'),
		portSearchStart: requiredConfigNumber(config, 'portSearchStart'),
		portSearchSpan: requiredConfigNumber(config, 'portSearchSpan'),
		readyTimeoutMs: requiredConfigNumber(config, 'readyTimeoutSeconds') * 1000,
	};
};

// -----
// resolveEmbeddingDims — the DECLARED VECTOR WIDTH of a creation payload, or a refusal.
//
//   resolveEmbeddingDims(nodeEdges) -> { embeddingDims } | { error }
//
// `embeddingDims: nodeEdges.embeddingDims || null` used to sit at the init call site, and null is
// not a neutral value here: it is the engine's instruction to build NO VECTOR INDEX. So a payload
// full of vectors whose producer forgot to declare the width, and a payload that declared the
// width as 0, both loaded their vectors unindexed and said nothing — the same silence as a
// payload that genuinely carried none. A STRING width went through untouched into the index
// clause. polyArch2 §6, and the audit's B1 row for this line: the guard sat on a MODULE BOUNDARY,
// so what it swallows is the producer's error.
//
// THE ONE LEGITIMATE null: the key present and explicitly null WITH no node carrying a vector.
// That is a producer STATING "nothing was embedded" (shapeForgedGraph does exactly this when the
// vectorize spend knob is off), which is a different act from omitting the key. Absence is a
// fault; a declaration of absence is an answer.
const resolveEmbeddingDims = (nodeEdges) => {
	const nodes = (nodeEdges && nodeEdges.nodes) || [];
	const anyVectors = nodes.some(
		(oneNode) =>
			oneNode &&
			((oneNode.embedding !== undefined && oneNode.embedding !== null) ||
				(oneNode.embeddingRef !== undefined && oneNode.embeddingRef !== null)),
	);
	const given = nodeEdges ? nodeEdges.embeddingDims : undefined;

	if (given === undefined) {
		return {
			error:
				`replayManager.init: nodeEdges declares no embeddingDims. It is REQUIRED — it is the ` +
				`width the VECTOR INDEX is built at, and an absent one used to read as null, which ` +
				`is this engine's instruction to build NO INDEX. Declare the width the vectors were ` +
				`made at, or declare null to say nothing was embedded. ` +
				`(This payload carries ${anyVectors ? 'vectors' : 'no vectors'}.)`,
		};
	}

	if (given === null) {
		if (anyVectors) {
			return {
				error:
					`replayManager.init: nodeEdges declares embeddingDims null — "nothing was ` +
					`embedded" — but nodes in the payload CARRY vectors. Those vectors would be ` +
					`written with no vector index and nothing would say so. Nothing loaded.`,
			};
		}
		return { embeddingDims: null };
	}

	if (!Number.isInteger(given) || given <= 0) {
		return {
			error:
				`replayManager.init: nodeEdges declares embeddingDims ${JSON.stringify(given)}, ` +
				`which is not a positive whole number. It was NOT corrected to a default and it was ` +
				`NOT read as "no index". Nothing loaded.`,
		};
	}

	if (!anyVectors) {
		return {
			error:
				`replayManager.init: nodeEdges declares embeddingDims ${given} but no node in the ` +
				`payload carries a vector. A declared width with nothing to index is a ` +
				`contradiction, not something to reconcile quietly. Nothing loaded.`,
		};
	}

	return { embeddingDims: given };
};

let createSeq = 0;

// -----
// withAppliedLabels — add the orchestrator's labels to every node, WITHOUT mutating the caller's
// objects. Non-mutation is the point: the same nodeEdges are reused by the forger and by the
// fidelity gate, and a second use of the same objects must behave exactly like the first.
// Idempotent, because a label set is a set.
const withAppliedLabels = (nodes, applyLabels) => {
	if (!applyLabels || applyLabels.length === 0) {
		return nodes;
	}
	return nodes.map((oneNode) => {
		const existing = oneNode.labels || [];
		const additions = applyLabels.filter((oneLabel) => existing.indexOf(oneLabel) === -1);
		if (additions.length === 0) {
			return oneNode;
		}
		return { ...oneNode, labels: existing.concat(additions) };
	});
};

// -----
// schemaBlockTexts — normalize the RESTORATION payload to the ordered plain block texts that
// replay-engine.replay consumes, verifying every claimed content address on the way through.
// Returns { error, texts }: error '' means admitted, and `texts` is empty on any refusal so that
// nothing partially normalized can escape into a write.
//
// Two entry shapes exist because two kinds of caller exist. A producer holding a block it just
// harvested has the TEXT; a caller holding a block it fetched from the store has the stored
// RECORD, `{ text, refId, ... }`. Accepting both is what lets a manifest's resolved members be
// handed straight to init without a translation step whose only job would be to lose the refId.
//
// A CALLER'S refId IS NEVER TAKEN ON TRUST. harvest mints the address itself at the moment the
// block is born, manifestEditor.add recomputes it before storing, and this recomputes it before
// loading — three doors into content-addressed storage, one rule at each. A caller whose id does
// not match its text either fetched the wrong row or is holding corrupted bytes, and either way
// the graph it would build is not the graph its manifest names. The refusal states BOTH addresses
// because "these do not match" without the values is a fact you cannot act on.
//
// A block arriving with NO refId is admitted: there is no claim to verify, and the deserializer
// downstream is the authority on whether the bytes are a block. This function checks claims, not
// syntax.
const schemaBlockTexts = (schemaBlocks) => {
	const refuse = (message) => ({ error: message, texts: [] });

	if (!Array.isArray(schemaBlocks)) {
		return refuse(
			`replayManager.init: schemaBlocks must be an array of block texts or ` +
				`{ text, refId } records, got ${schemaBlocks === null ? 'null' : typeof schemaBlocks}. ` +
				`Nothing loaded.`,
		);
	}
	if (schemaBlocks.length === 0) {
		return refuse(
			`replayManager.init: REFUSED — schemaBlocks is empty. Materializing a graph from no ` +
				`blocks and reporting success is a silent failure; if there is genuinely nothing to ` +
				`restore, the caller must not call init.`,
		);
	}

	const texts = [];
	for (let blockIndex = 0; blockIndex < schemaBlocks.length; blockIndex++) {
		const oneBlock = schemaBlocks[blockIndex];

		if (typeof oneBlock === 'string') {
			if (oneBlock === '') {
				return refuse(
					`replayManager.init: schemaBlocks[${blockIndex}] is an empty string. An empty ` +
						`block is not a block. Nothing loaded.`,
				);
			}
			texts.push(oneBlock);
			continue;
		}

		if (!oneBlock || typeof oneBlock !== 'object' || Array.isArray(oneBlock)) {
			return refuse(
				`replayManager.init: schemaBlocks[${blockIndex}] is neither block text nor a ` +
					`{ text, refId } record (got ${oneBlock === null ? 'null' : typeof oneBlock}). ` +
					`Nothing loaded.`,
			);
		}

		const blockText = oneBlock.text;
		if (typeof blockText !== 'string' || blockText === '') {
			return refuse(
				`replayManager.init: schemaBlocks[${blockIndex}] carries no block text ` +
					`(refId ${oneBlock.refId || 'absent'}). Nothing loaded.`,
			);
		}

		if (oneBlock.refId) {
			const trueAddress = contentAddress.blockIdForText(blockText);
			if (oneBlock.refId !== trueAddress) {
				return refuse(
					`replayManager.init: schemaBlocks[${blockIndex}] fails content address ` +
						`verification — it CLAIMS refId '${oneBlock.refId}' but its text hashes to ` +
						`'${trueAddress}'. A caller's id is never taken on trust; the bytes are wrong, ` +
						`the id is wrong, or the wrong row was fetched. Nothing loaded.`,
				);
			}
		}

		texts.push(blockText);
	}

	return { error: '', texts };
};

// -----
// nameRefusal — the GNC-001 guard, applied before any docker command. '' = allowed.
const nameRefusal = (graphName, verb) => {
	if (!graphName) {
		return `replayManager.${verb}: no graphName`;
	}
	if (/^(GOLD_|gf_)/i.test(graphName)) {
		return `replayManager.${verb}: REFUSED — '${graphName}' matches GOLD_*/gf_* (production/live tier). This module touches only DEV_* scratch graphs.`;
	}
	if (!/^DEV_/.test(graphName)) {
		return `replayManager.${verb}: REFUSED — '${graphName}' is not a DEV_* scratch graph (GNC-001).`;
	}
	return '';
};

// -----
// defaultRunDockerCommand — the real docker executor. Injectable (second-stage dep) so the dispose
// idiom and create's failure path can be PROVEN firing with a spy, never a real container.
const defaultRunDockerCommand = (dockerArgs, callback) =>
	execFile('docker', dockerArgs, { encoding: 'utf-8' }, callback);

// -----
// disposeScratchGraph — THE ONE shared best-effort-dispose-then-report idiom (Item 4), applied in
// all three homes that provision a DEV_* container: replayManager.create's failure path (a readiness
// timeout used to leak the container it just started), replayManager.delete (the success-path
// destroy), and — through replayManager.delete — build.js's mid-pipeline failures and the
// evaluator's cleanup. The GNC-001 guard fires FIRST, so a GOLD_*/gf_* name is refused before any
// docker command could run; it NEVER disposes a production/live graph. Reports '' on success, or a
// message (a name refusal or a failed `docker rm`) that the caller decides is fatal (delete) or
// merely a note to append to an error it is already reporting (a failure path).
const disposeScratchGraph = (
	{ graphName, verb = 'dispose', runDockerCommand = defaultRunDockerCommand },
	callback,
) => {
	const refusal = nameRefusal(graphName, verb);
	if (refusal) {
		callback(refusal);
		return;
	}
	runDockerCommand(['rm', '-f', graphName], (err, stdout, stderr) => {
		if (err) {
			callback(`docker rm -f '${graphName}' failed: ${err.message}${stderr ? `\n${stderr}` : ''}`);
			return;
		}
		callback('');
	});
};

// -----
// defaultWaitForReadiness — bolt TCP open, then an authenticated cypher round-trip. Injectable so a
// create-failure test can force a readiness timeout without a real container.
const defaultWaitForReadiness = ({ boltPort, boltUrl, password, deadline, readyTimeoutMs }, callback) => {
	waitForBoltPort(boltPort, deadline, readyTimeoutMs, (portErr) => {
		if (portErr) {
			callback(portErr);
			return;
		}
		waitForAuthenticatedCypher(boltUrl, password, deadline, readyTimeoutMs, callback);
	});
};

// -----
// port-pair allocation (carried from instance-lifecycle): a (bolt, http) consecutive pair that
// is OS-bindable AND not already published by a running container.
const getDockerBoundPorts = (callback) => {
	execFile('docker', ['ps', '--format', '{{.Ports}}'], { encoding: 'utf-8' }, (err, stdout) => {
		if (err) {
			callback(`docker ps failed: ${err.message}`);
			return;
		}
		const ports = new Set();
		(stdout.match(/:(\d+)->/g) || []).forEach((oneMatch) =>
			ports.add(Number(oneMatch.replace(/[^0-9]/g, ''))),
		);
		callback('', ports);
	});
};

const isPortBindable = (port, callback) => {
	const server = net.createServer();
	server.once('error', () => callback('', false));
	server.once('listening', () => server.close(() => callback('', true)));
	server.listen(port, '0.0.0.0');
};

const findAvailablePortPair = ({ portSearchStart, portSearchSpan }, callback) => {
	getDockerBoundPorts((portsErr, dockerPorts) => {
		if (portsErr) {
			callback(portsErr);
			return;
		}
		const maxPort = portSearchStart + portSearchSpan;
		let candidate = portSearchStart;
		const tryCandidate = () => {
			if (candidate >= maxPort) {
				callback(`no available bolt/http port pair in ${portSearchStart}-${maxPort}`);
				return;
			}
			if (dockerPorts.has(candidate) || dockerPorts.has(candidate + 1)) {
				candidate += 2;
				tryCandidate();
				return;
			}
			isPortBindable(candidate, (boltErr, boltFree) => {
				if (!boltFree) {
					candidate += 2;
					tryCandidate();
					return;
				}
				isPortBindable(candidate + 1, (httpErr, httpFree) => {
					if (!httpFree) {
						candidate += 2;
						tryCandidate();
						return;
					}
					callback('', { boltPort: candidate, httpPort: candidate + 1 });
				});
			});
		};
		tryCandidate();
	});
};

// -----
// readiness: bolt TCP open, then an authenticated cypher round-trip (a container accepts TCP
// well before auth works; only the cypher proves it).
const waitForBoltPort = (boltPort, deadline, readyTimeoutMs, callback) => {
	if (Date.now() > deadline) {
		callback(`bolt port ${boltPort} did not open within ${readyTimeoutMs / 1000}s`);
		return;
	}
	const socket = new net.Socket();
	const retry = () =>
		setTimeout(() => waitForBoltPort(boltPort, deadline, readyTimeoutMs, callback), 1000);
	socket.once('connect', () => {
		socket.destroy();
		callback('');
	});
	socket.once('error', () => {
		socket.destroy();
		retry();
	});
	socket.connect(boltPort, 'localhost');
};

const waitForAuthenticatedCypher = (boltUrl, password, deadline, readyTimeoutMs, callback) => {
	const neo4j = require('neo4j-driver');
	// LATENT BUG FIXED 2026-07-22: the success path used to invoke callback INSIDE the promise
	// chain, so any exception thrown DOWNSTREAM of the callback — anywhere in the caller's entire
	// continuation — was caught by this .catch, mistaken for "not ready yet", and the whole thing
	// RETRIED. A caller bug therefore presented as a 90-second authentication timeout, and the
	// caller's continuation ran several times over. `settled` makes the callback fire exactly once
	// and the deferral takes it out of the promise chain entirely, so a downstream throw is a
	// downstream throw.
	let settled = false;
	const attempt = () => {
		if (settled) {
			return;
		}
		if (Date.now() > deadline) {
			settled = true;
			callback(`neo4j at ${boltUrl} never authenticated within ${readyTimeoutMs / 1000}s`);
			return;
		}
		const driver = neo4j.driver(boltUrl, neo4j.auth.basic(NEO4J_USER, password));
		const session = driver.session();
		session
			.run('RETURN 1 AS ok')
			.then(() =>
				session
					.close()
					.then(() => driver.close())
					.then(() => {
						if (settled) {
							return;
						}
						settled = true;
						setImmediate(() => callback(''));
					}),
			)
			.catch(() => {
				session
					.close()
					.then(() => driver.close())
					.catch(() => {})
					.then(() => {
						if (!settled) {
							setTimeout(attempt, 2000);
						}
					});
			});
	};
	attempt();
};

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(deps = {}) => {
	// The three docker/readiness seams. Production passes nothing and gets the real implementations;
	// a test injects spies so create's SUCCESS and FAILURE paths (including the disposal of a leaked
	// container) are proven without a real container, a real port, or a real neo4j.
	const runDockerCommand = deps.runDockerCommand || defaultRunDockerCommand;
	const findPortPair = deps.findAvailablePortPair || findAvailablePortPair;
	const waitForReadiness = deps.waitForReadiness || defaultWaitForReadiness;

	// -----
	// create — provision a throwaway DEV_* Neo4j container; hand back the graph handle. The
	// credential is generated here and lives ONLY in the handle (no registry, no file). No
	// docker volume: the data's lifetime IS the container's lifetime.
	//
	// FAILURE DISPOSES WHAT IT STARTED (Item 4). Once `docker run` has succeeded, the container is
	// live; if readiness then times out (the common failure on a memory-tight box, which is exactly
	// when neo4j is slow to come up), the old code returned the error and LEFT THE CONTAINER RUNNING
	// — holding its port pair and hundreds of MB, and the caller got no handle to clean it with. Now
	// a post-launch failure best-effort disposes the container it created before reporting.
	const create = (spec, callback) => {
		const { xLog } = process.global;
		createSeq += 1;
		const purpose = (spec && spec.purpose) || 'forge';
		const graphName =
			(spec && spec.graphName) || `DEV_gb_${purpose}_${process.pid}_${createSeq}`;

		const refusal = nameRefusal(graphName, 'create');
		if (refusal) {
			callback(refusal);
			return;
		}

		const settings = resolveSettings();
		const password = crypto.randomBytes(18).toString('base64url');
		let containerLaunched = false;
		const taskList = new taskListPlus();

		taskList.push((args, next) => {
			findPortPair(settings, (err, ports) => next(err, { ...args, ...ports }));
		});

		taskList.push((args, next) => {
			const dockerArgs = [
				'run',
				'-d',
				'--name',
				graphName,
				'-p',
				`${args.boltPort}:7687`,
				'-p',
				`${args.httpPort}:7474`,
				'-e',
				`NEO4J_AUTH=${NEO4J_USER}/${password}`,
				'-e',
				'NEO4J_PLUGINS=["apoc"]',
				'-e',
				'NEO4J_dbms_security_procedures_unrestricted=apoc.*',
				'-e',
				'NEO4J_dbms_security_procedures_allowlist=apoc.*',
				settings.neo4jImage,
			];
			xLog.status(
				`[replayManager] provisioning scratch graph '${graphName}' (bolt ${args.boltPort})...`,
			);
			runDockerCommand(dockerArgs, (err, stdout, stderr) => {
				if (err) {
					next(`docker run failed for '${graphName}': ${err.message}\n${stderr || ''}`);
					return;
				}
				// the container is now live; every failure past this point must dispose it
				containerLaunched = true;
				next('', args);
			});
		});

		taskList.push((args, next) => {
			const deadline = Date.now() + settings.readyTimeoutMs;
			const boltUrl = `bolt://localhost:${args.boltPort}`;
			waitForReadiness(
				{ boltPort: args.boltPort, boltUrl, password, deadline, readyTimeoutMs: settings.readyTimeoutMs },
				(readyErr) => next(readyErr, { ...args, boltUrl }),
			);
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				if (!containerLaunched) {
					// nothing was started (port search or docker run itself failed) — nothing to dispose
					callback(`replayManager.create '${graphName}': ${err}`);
					return;
				}
				// a container WAS started and then something failed — dispose it before reporting, so a
				// failed provision does not leak the DEV_* container it just launched.
				disposeScratchGraph({ graphName, verb: 'create', runDockerCommand }, (disposeErr) => {
					callback(
						disposeErr
							? `replayManager.create '${graphName}': ${err} — AND the container it launched could ` +
									`NOT be disposed (it is leaking): ${disposeErr}`
							: `replayManager.create '${graphName}': ${err} (the container it launched was disposed)`,
					);
				});
				return;
			}
			xLog.status(`[replayManager] scratch graph '${graphName}' ready at ${args.boltUrl}`);
			callback('', {
				graphName,
				containerName: graphName,
				boltUrl: args.boltUrl,
				// user rides the handle (RT-13, forge-edfi Phase 4): the handle is the ONE home of
				// a scratch graph's credentials, and the round-trip stage hands validators the full
				// bolt triple from it — a second 'neo4j' literal anywhere else would be drift.
				user: NEO4J_USER,
				password,
				boltPort: args.boltPort,
				httpPort: args.httpPort,
			});
		});
	};

	// -----
	// restore — init's RESTORATION branch (targetArchitectureDesign §4.2/§4.3). A FUNCTION
	// DECLARATION, not a const arrow: it is reached from inside init and a const defined after its
	// caller sits in the temporal dead zone, where the ReferenceError gets swallowed by surrounding
	// error handling and presents as something else entirely.
	//
	// It is thin BY DESIGN. replay-engine.replay() already is deserialize -> writeShapedGraph,
	// which is precisely what restoring a graph from harvested blocks means; everything this
	// function owns is what replay() cannot know — whether the caller's payload is honest, and
	// which graph's credentials to use. It deliberately does NOT re-check ForgedNode labels,
	// stableIds or provenance tiers: those live once, in the shared write path, and both entry
	// points reach them there.
	function restore({ inGraph, graphName, schemaBlocks, applyLabels, storeResolver }, callback) {
		const { xLog } = process.global;

		// applyLabels is REFUSED here, and this is a design decision rather than an omission. A
		// harvested schema block already carries, in its own node lines, the labels that were
		// stamped when the material was created. Stamping more on the way back in would make the
		// block and the graph restored from it disagree about what is in that graph — the block
		// would no longer describe its own materialization. If a deliberate re-labeling is ever
		// wanted, it becomes an explicit decision, not a parameter that happened to be passed along.
		if (applyLabels !== undefined) {
			callback(
				`replayManager.init: REFUSED — applyLabels ${JSON.stringify(applyLabels)} was supplied ` +
					`with the RESTORATION payload for '${graphName}'. Harvested schema blocks already ` +
					`carry the labels stamped at creation time; stamping more on the way back in would ` +
					`make the block and the graph restored from it disagree about what is in the graph. ` +
					`Nothing loaded.`,
			);
			return;
		}

		const normalized = schemaBlockTexts(schemaBlocks);
		if (normalized.error) {
			callback(normalized.error);
			return;
		}

		if (!inGraph.boltUrl || !inGraph.password) {
			callback(
				`replayManager.init: the handle for '${graphName}' carries no boltUrl/password — a ` +
					`graph handle is the capability token, and half of one is not a credential.`,
			);
			return;
		}

		xLog.status(
			`[replayManager] restoring ${normalized.texts.length} schema block(s) into '${graphName}'`,
		);

		// replay() owns its own driver and session and closes both on every path, so there is no
		// session for this verb to manage — another reason the restoration branch stays thin.
		// ⟪R-P2-2⟫ storeResolver rides through untouched: the engine's resolveNodeVectors uses it
		// to stamp each ref-carrying node's vector back onto the graph node. Absent resolver is
		// legal ONLY for legacy inline blocks (byte-compatible replay, exactly as before); a
		// REF-STYLE block without one is REFUSED by the engine naming the first offender
		// (⟪P2-review M-2⟫ — never a silently vectorless graph).
		replayEngine.replay(
			{
				manifest: normalized.texts,
				boltUri: inGraph.boltUrl,
				password: inGraph.password,
				graphName,
				storeResolver,
			},
			(err, result) => {
				if (err) {
					callback(`replayManager.init '${graphName}': ${err}`);
					return;
				}
				callback('', result);
			},
		);
	}

	// -----
	// init — the LOADER, and the creation entry point into the shared write path
	// (targetArchitectureDesign §4). It is deliberately the ONLY polymorphic verb: `create` means
	// exactly one thing forever, and everything that varies about "put something into a graph"
	// varies here. Two payloads exist because there are exactly two kinds of thing that can enter
	// a graph, and they have different histories:
	//
	//     init({ inGraph, nodeEdges,    applyLabels })   CREATION    — freshly forged material
	//     init({ inGraph, schemaBlocks })                RESTORATION — previously harvested
	//
	// The guards, the resolution-key index, the merge order and the vector index are NOT
	// reimplemented here — they live in replay-engine.writeShapedGraph, which replay() also uses.
	// Two entry points into one write path cannot disagree about what a safe write is. The
	// restoration branch below is correspondingly THIN on purpose: replay() already IS
	// deserialize -> writeShapedGraph, so this verb's whole contribution is to check the payload's
	// claims and hand over the handle's credentials. A second deserialize loop here, or a second
	// copy of the ForgedNode/stableId guards, would be a second thing to drift.
	const init = (spec, callback) => {
		const { xLog } = process.global;
		const { inGraph, nodeEdges, schemaBlocks, applyLabels, sourceLabel } = spec || {};

		// the name guard fires FIRST, before any payload is examined and before anything connects
		const graphName = inGraph && (inGraph.containerName || inGraph.graphName);
		const refusal = nameRefusal(graphName, 'init');
		if (refusal) {
			callback(refusal);
			return;
		}

		// A caller offering BOTH payloads has not decided what it is doing. Choosing one for it —
		// by precedence, by order of evaluation, by anything — would make the other half silently
		// vanish, and the caller would never learn which half ran.
		if (nodeEdges !== undefined && schemaBlocks !== undefined) {
			callback(
				`replayManager.init: REFUSED — spec carries both nodeEdges and schemaBlocks for ` +
					`'${graphName}'. Those are the CREATION and RESTORATION payloads; a caller supplying ` +
					`both has not decided which it is doing. Nothing loaded.`,
			);
			return;
		}

		if (schemaBlocks !== undefined) {
			// ⟪R-P2-2⟫ spec.storeResolver (optional) rides to the engine's vector-resolving
			// restore path. Absent is legal only for legacy INLINE blocks (byte-compatible,
			// exactly as before); the engine REFUSES a ref-style block without a resolver by
			// name (⟪P2-review M-2⟫).
			restore({ inGraph, graphName, schemaBlocks, applyLabels, storeResolver: (spec || {}).storeResolver }, callback);
			return;
		}

		// A missing array must never read as an empty one — the fail-closed rule the shared write
		// path learned the hard way. "I could not find any nodes" and "there were no nodes" are
		// different facts and must not produce the same behavior.
		if (
			!nodeEdges ||
			typeof nodeEdges !== 'object' ||
			!Array.isArray(nodeEdges.nodes) ||
			!Array.isArray(nodeEdges.edges)
		) {
			callback(
				`replayManager.init: nodeEdges must carry nodes[] and edges[] (got ` +
					`${nodeEdges === undefined ? 'nothing' : JSON.stringify(Object.keys(nodeEdges || {}))}). ` +
					`Nothing loaded.`,
			);
			return;
		}
		// applyLabels is OPTIONAL on the creation path (stamp nothing), but a supplied one must BE
		// an array — a bare string would satisfy the label machinery by accident and stamp garbage.
		const creationLabels = applyLabels === undefined ? [] : applyLabels;
		if (!Array.isArray(creationLabels)) {
			callback(
				`replayManager.init: applyLabels must be an array of label names, got ` +
					`${typeof applyLabels}. Nothing loaded.`,
			);
			return;
		}
		const declaredDims = resolveEmbeddingDims(nodeEdges);
		if (declaredDims.error) {
			callback(declaredDims.error);
			return;
		}
		if (!inGraph.boltUrl || !inGraph.password) {
			callback(
				`replayManager.init: the handle for '${graphName}' carries no boltUrl/password — a ` +
					`graph handle is the capability token, and half of one is not a credential.`,
			);
			return;
		}

		const groups = [
			{
				sourceLabel: sourceLabel || `nodeEdges loaded into ${graphName}`,
				nodes: withAppliedLabels(nodeEdges.nodes, creationLabels),
				edges: nodeEdges.edges,
			},
		];

		const driver = require('neo4j-driver').driver(
			inGraph.boltUrl,
			require('neo4j-driver').auth.basic(NEO4J_USER, inGraph.password),
			{ encrypted: false },
		);
		const session = driver.session();

		xLog.status(
			`[replayManager] loading ${nodeEdges.nodes.length} nodes, ${nodeEdges.edges.length} edges ` +
				`into '${graphName}'${creationLabels.length ? ` as [${creationLabels.join(', ')}]` : ''}`,
		);

		replayEngine.writeShapedGraph(
			{
				session,
				groups,
				embeddingDims: declaredDims.embeddingDims,
				graphName,
			},
			(err, result) => {
				session.close().then(() => driver.close());
				if (err) {
					callback(`replayManager.init '${graphName}': ${err}`);
					return;
				}
				// THE LOADED SIDE OF THE CONSERVATION GATE, CAPTURED HERE AND NOWHERE ELSE. It must be
				// taken at LOAD TIME from the payload in hand: the scratch container is destroyed
				// immediately after harvest, which is exactly why nobody could diff the two sides of
				// this seam before today. Re-querying the graph for it later would measure the graph
				// twice and the loaded set never — the wrong comparison.
				callback('', {
					...result,
					loadedConservationSummary: replayEngine.conservationSummaryFor({
						nodes: nodeEdges.nodes,
						edges: nodeEdges.edges,
					}),
				});
			},
		);
	};

	// -----
	// harvest — take a schema block OUT of a graph. THE ONLY PLACE A SCHEMA BLOCK IS BORN
	// (targetArchitectureDesign §4.3); nothing else in the system creates one.
	//
	// Selection is POSITIVE and by LABEL. The orchestrator hands the label down at init time and
	// selects with the same constant here, so the produce side and the harvest side agree by
	// PARAMETER rather than by two hardcoded literals hoping to match. There is deliberately no
	// excludeLabels: one mechanism, not two.
	//
	// harvest is READ-ONLY (a READ-mode session; the graph is unchanged). The DEV_* refusal below
	// is therefore a SCOPE decision, not a safety necessity — this module's stated invariant is
	// that it touches only scratch graphs, and reading a golden is not in its remit today.
	const harvest = (spec, callback) => {
		const { xLog } = process.global;
		// ⟪R-P2-2⟫ vectorStore (optional): the per-standard embedding sidecar. When supplied, the
		// engine's shapeNode emits embeddingRef per vectored node (declared embed-input property,
		// or the original searchText format) and persists raw vectors into the store — the block
		// text carries refs, never half a gigabyte of inline base64. Absent = the legacy inline
		// path, exactly as before.
		const { inGraph, selectionLabels, header, vectorStore, conservationExpectation } = spec || {};

		const graphName = inGraph && (inGraph.containerName || inGraph.graphName);
		const refusal = nameRefusal(graphName, 'harvest');
		if (refusal) {
			callback(refusal);
			return;
		}
		if (!inGraph.boltUrl || !inGraph.password) {
			callback(
				`replayManager.harvest: the handle for '${graphName}' carries no boltUrl/password.`,
			);
			return;
		}
		// A schema block without a header is not a schema block: the header carries the standard
		// key, the version and the embedding contract that make the bytes interpretable later.
		// Deriving it by guesswork would produce a block that deserializes and means nothing.
		if (!header || typeof header !== 'object' || !header.blockType || !header.standardKey) {
			callback(
				`replayManager.harvest: a header carrying at least blockType and standardKey is ` +
					`required — a schema block whose provenance is guessed is worse than no block.`,
			);
			return;
		}

		replayEngine.harvestBlock(
			{
				boltUri: inGraph.boltUrl,
				password: inGraph.password,
				selector: { selectionLabels },
				header,
				vectorStore,
			},
			(err, result) => {
				if (err) {
					callback(`replayManager.harvest '${graphName}': ${err}`);
					return;
				}
				// ⟪JOB 2⟫ THE CONSERVATION GATE, SITED HERE ON PURPOSE — BETWEEN THE ERROR CHECK ABOVE
				// AND THE MINT BELOW. The address is minted at the moment the block comes into existence;
				// a gate placed AFTER it would let a block with a false address exist, however briefly.
				// Refuse before the address, not after it.
				//
				// WHY IT EXISTS: this pipeline verified self-consistency thoroughly and conservation
				// nowhere. A block was guaranteed to be exactly what it said it was; nothing guaranteed it
				// was everything it should have been. The load count and the harvest count were already
				// printed on adjacent lines and no assertion related them. RT-13 cannot cover this seam:
				// MEASURED 2026-09-02, it reproduced the identical 97,888 statements before and after nine
				// relationships appeared in the graph — its verdict is blind in both directions.
				const conservationReport = compareConservation({
					expectation: conservationExpectation,
					harvested: result.harvestedConservationSummary,
					graphName,
				});
				if (conservationReport.error) {
					callback(conservationReport.error);
					return;
				}
				xLog.status(`[replayManager] ${conservationReport.statusText}`);
				// The content address is minted HERE, at the moment the block comes into existence,
				// so no caller can hold a block whose id it computed by a different rule.
				const blockId = contentAddress.blockIdForText(result.blockText);
				xLog.status(
					`[replayManager] harvested ${result.nodeCount} nodes, ${result.edgeCount} edges ` +
						`from '${graphName}' [${(selectionLabels || []).join(', ')}] -> ${blockId.slice(0, 12)}...`,
				);
				callback('', { ...result, blockId });
			},
		);
	};

	// -----
	// delete — destroy the scratch container (data dies with it). DEV_* only, same guard. It is the
	// STRICT face of the shared disposal idiom: a refusal or a failed rm is surfaced to the caller,
	// who decides (build.js's mid-pipeline failures and the evaluator's cleanup call it BEST-EFFORT,
	// reporting the delete error alongside the error they were already carrying rather than masking
	// either one).
	const deleteGraph = (handle, callback) => {
		const { xLog } = process.global;
		const graphName = handle && (handle.containerName || handle.graphName);
		disposeScratchGraph({ graphName, verb: 'delete', runDockerCommand }, (err) => {
			if (err) {
				callback(err);
				return;
			}
			xLog.status(`[replayManager] scratch graph '${graphName}' destroyed`);
			callback('');
		});
	};

	// -----
	// finish — THE FIFTH VERB. Make the graph self-documenting BY CONSTRUCTION: passport, recipe,
	// standard definitions, schema view, attestations, usage patterns.
	//
	// THE ORDER BELOW IS RULED AND LOAD-BEARING (GRANITE_ECHO, gates (g)/(h)/(i)):
	//   Channel A (the whole registry, incl. graphMeta's sweep)
	//     -> Channel B passport
	//       -> gate (h) exemplar re-verification against the FINISHED graph
	//         -> gate (i) the usagePatternVerification row
	//           -> gate (g) the XOR recheck, LAST, so it covers the row just written
	// Each step exists because the one before it changed the graph in a way the earlier verifications
	// could not have seen. Reordering any of them makes a check answer a question about a graph that
	// no longer exists.
	//
	// Channel A goes through init — the SHARED write path. That makes finish a THIRD ENTRY POINT into
	// one write path, never a bypass: the reason two entry points became the rule was that they
	// "cannot disagree about what a safe write is", and a third that agreed with neither would undo it.
	const finish = (spec, callback) => {
		const { xLog } = process.global;
		const { inGraph, manifestRefId, storeReader, gateResults, disabled } = spec || {};

		// the name guard fires FIRST, before any payload is examined and before anything connects
		const graphName = inGraph && (inGraph.containerName || inGraph.graphName);
		const refusal = nameRefusal(graphName, 'finish');
		if (refusal) {
			callback(refusal);
			return;
		}

		if (!manifestRefId) {
			callback(
				`replayManager.finish: a manifestRefId is REQUIRED for '${graphName}'. "Which manifest was ` +
					`this graph replayed from" is the passport's central claim; a graph finished without it ` +
					`would carry a build record that cannot answer the question it exists to answer.`,
			);
			return;
		}
		if (!storeReader) {
			callback(
				`replayManager.finish: a storeReader is REQUIRED for '${graphName}'. The recipe is read from ` +
					`the store and cannot be reconstructed from the graph; finishing without one would produce ` +
					`a graph that documents everything EXCEPT how it was built.`,
			);
			return;
		}
		if (!inGraph.boltUrl || !inGraph.password) {
			callback(
				`replayManager.finish: the handle for '${graphName}' carries no boltUrl/password — a graph ` +
					`handle is the capability token, and half of one is not a credential.`,
			);
			return;
		}

		const driver = require('neo4j-driver').driver(
			inGraph.boltUrl,
			require('neo4j-driver').auth.basic(NEO4J_USER, inGraph.password),
			{ encrypted: false },
		);
		const session = driver.session();
		const closeAll = () => session.close().then(() => driver.close()).catch(() => driver.close());

		const runCypher = ({ cypher }, cb) => {
			session
				.run(cypher)
				.then((result) => cb('', result))
				.catch((oneError) => cb(`${(oneError && oneError.message) || oneError}`));
		};
		// CHANNEL A — through init, the shared write path. Not a private writer.
		const writeBatch = (nodeEdges, cb) => init({ inGraph, nodeEdges }, cb);

		const finishing = finishingModule({
			readQuery: runCypher,
			runCypher,
			writeBatch,
			storeReader,
			manifestRefId,
			gateResults,
		});
		const passportWriter = passportWriterModule({ vocabulary });

		// The verb reuses THE SAME finisher instances the registry ran, found by name in the registry
		// itself. Requiring fresh copies here would give the verb a second implementation of each
		// invariant, and two copies of an invariant is how the two copies come to disagree.
		const finisherByName = (oneName) => {
			const row = finishing.REGISTRY.filter((oneRow) => oneRow.name === oneName)[0];
			return row && row.finisher;
		};
		const usagePatternFinisher = finisherByName('usagePattern');
		const graphMetaFinisher = finisherByName('graphMeta');
		if (!usagePatternFinisher || !graphMetaFinisher) {
			closeAll();
			callback(
				`replayManager.finish: the registry does not carry both 'usagePattern' and 'graphMeta'. ` +
					`Gates (h) and (g) are run BY THE VERB using those finishers' own exported checks; without ` +
					`them the verb would report a finished graph having verified nothing.`,
			);
			return;
		}

		const taskList = new taskListPlus();

		// 1 — CHANNEL A: the whole registry.
		taskList.push((args, next) => {
			finishing.applyFinishers({ disabled: disabled || [] }, (err, report) => {
				if (err) {
					next(err);
					return;
				}
				next('', { ...args, applyReport: report });
			});
		});

		// 2 — CHANNEL B: the passport. It counts what the registry produced, so it cannot run earlier.
		taskList.push((args, next) => {
			passportWriter.write(
				{ runCypher, manifestRefId, graphName, engineVersions: { replayManager: 'finish/1' } },
				(err, report) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, passportReport: report });
				},
			);
		});

		// 3 — GATE (h): re-execute every written exemplar against the FINISHED graph, passport present.
		//     A `defect`-declared exemplar returning zero rows FAILS THE VERB — the graph is NOT reported
		//     finished, and the caller's dispose-on-failure applies. Emit-time could not have caught this:
		//     a rotted exemplar and a merely-early one produce the SAME zero rows.
		taskList.push((args, next) => {
			usagePatternFinisher.verifyWritten(
				{ readQuery: runCypher, disabledFinisherList: disabled || [] },
				(err, report) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, exemplarReport: report });
				},
			);
		});

		// 4 — GATE (i): the verdict lands IN THE GRAPH, written on Channel B because it could not exist
		//     until step 2 completed. Idempotent under a second finish (MERGE on stableId).
		taskList.push((args, next) => {
			const exemplarReport = args.exemplarReport || {};
			const rowCounts = exemplarReport.rowCounts || {};
			const exemplarCount = Object.keys(rowCounts).length;
			const verifiedCount = Object.keys(rowCounts).filter((oneName) => rowCounts[oneName] > 0).length;
			passportWriter.writeVerificationAttestation(
				{
					runCypher,
					verdict: 'pass',
					detail: exemplarReport.summary || '',
					exemplarCount,
					verifiedCount,
				},
				(err, report) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, verificationAttestation: report });
				},
			);
		});

		// 5 — GATE (g): the XOR recheck, LAST. The registry's sweep ran before the passport AND before the
		//     row written in step 4; only a recheck here covers them. This is the verb's final act.
		taskList.push((args, next) => {
			graphMetaFinisher.verifyXor(
				{ runCypher, phaseLabel: 'verb-level recheck after Channel B' },
				(err, report) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, xorRecheck: report });
				},
			);
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			closeAll();
			if (err) {
				callback(`replayManager.finish '${graphName}': ${err}`);
				return;
			}
			xLog.status(
				`[replayManager] finished '${graphName}': ${args.applyReport.applied.length} finisher(s), ` +
					`${args.applyReport.writeCount} write(s), passport + ${args.xorRecheck.totalNodes} node(s) verified`,
			);
			callback('', {
				applied: args.applyReport.applied,
				writeCount: args.applyReport.writeCount,
				passportElementId: args.passportReport.passportElementId,
				passport: args.passportReport,
				exemplarVerification: args.exemplarReport,
				verificationAttestation: args.verificationAttestation,
				xorVerified: true,
				xorRecheck: args.xorRecheck,
			});
		});
	};

	return { create, init, harvest, finish, delete: deleteGraph };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.nameRefusal = nameRefusal;
module.exports.withAppliedLabels = withAppliedLabels;
module.exports.schemaBlockTexts = schemaBlockTexts;
module.exports.resolveSettings = resolveSettings;
module.exports.resolveEmbeddingDims = resolveEmbeddingDims;
module.exports.disposeScratchGraph = disposeScratchGraph;
// The declared conservation exemption, exported so a caller NAMES it rather than repeating a
// magic string that could drift from the one harvest compares against.
module.exports.CONSERVATION_NOT_LOADED_THROUGH_INIT = CONSERVATION_NOT_LOADED_THROUGH_INIT;
// Exported so a discovered suite can assert the gate's refusal LITERALS without a container.
// The exact text is the contract: a caller reading a refusal must be told what to pass instead.
module.exports.compareConservation = compareConservation;
