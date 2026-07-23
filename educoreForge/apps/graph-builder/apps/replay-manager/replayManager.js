'use strict';

/** @implements {ReplayManagerComponent} — formal contract declared in
 *  apps/graph-builder/interfaces.js (GraphHandle typedef there); enforced by test-interfaces. */

// replayManager — the single block<->graph boundary (targetArchitectureDesign §4). In-process
// module of graphBuilder; async callback style (err-string first, no async/await).
//
//   replayManager() -> {
//     create(spec, callback)      -> ('', handle)   handle = { graphName, containerName,
//                                                     boltUrl, password, boltPort, httpPort }
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
const replayEngine = require(path.join(TREE_LIB, 'replay', 'replay-engine'));
const contentAddress = require(path.join(TREE_LIB, 'content-address', 'content-address'))();

// The provisioning knobs live in graphBuilder.ini, [replay-manager] section (neo4jImage,
// portSearchStart, portSearchSpan, readyTimeoutSeconds). They are being converted one at a time
// from in-code defaults to REQUIRED keys (Phase 4, work group 2); the DEFAULT_ constants below
// are what remains of the old behavior and die with their own commits.
const NEO4J_USER = 'neo4j';
const DEFAULT_PORT_SEARCH_START = 7801;
const DEFAULT_PORT_SEARCH_SPAN = 200;
const DEFAULT_READY_TIMEOUT_SECONDS = 90;

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
		portSearchStart: Number(config.portSearchStart) || DEFAULT_PORT_SEARCH_START,
		portSearchSpan: Number(config.portSearchSpan) || DEFAULT_PORT_SEARCH_SPAN,
		readyTimeoutMs:
			(Number(config.readyTimeoutSeconds) || DEFAULT_READY_TIMEOUT_SECONDS) * 1000,
	};
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

// START OF moduleFunction() ============================================================

const replayManager = () => {
	// -----
	// create — provision a throwaway DEV_* Neo4j container; hand back the graph handle. The
	// credential is generated here and lives ONLY in the handle (no registry, no file). No
	// docker volume: the data's lifetime IS the container's lifetime.
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
		const taskList = new taskListPlus();

		taskList.push((args, next) => {
			findAvailablePortPair(settings, (err, ports) => next(err, { ...args, ...ports }));
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
			execFile('docker', dockerArgs, { encoding: 'utf-8' }, (err, stdout, stderr) => {
				if (err) {
					next(`docker run failed for '${graphName}': ${err.message}\n${stderr}`);
					return;
				}
				next('', args);
			});
		});

		taskList.push((args, next) => {
			const deadline = Date.now() + settings.readyTimeoutMs;
			const boltUrl = `bolt://localhost:${args.boltPort}`;
			waitForBoltPort(args.boltPort, deadline, settings.readyTimeoutMs, (portErr) => {
				if (portErr) {
					next(portErr);
					return;
				}
				waitForAuthenticatedCypher(
					boltUrl,
					password,
					deadline,
					settings.readyTimeoutMs,
					(authErr) => next(authErr, { ...args, boltUrl }),
				);
			});
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				callback(`replayManager.create '${graphName}': ${err}`);
				return;
			}
			xLog.status(`[replayManager] scratch graph '${graphName}' ready at ${args.boltUrl}`);
			callback('', {
				graphName,
				containerName: graphName,
				boltUrl: args.boltUrl,
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
	function restore({ inGraph, graphName, schemaBlocks, applyLabels }, callback) {
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
		replayEngine.replay(
			{
				manifest: normalized.texts,
				boltUri: inGraph.boltUrl,
				password: inGraph.password,
				graphName,
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
			restore({ inGraph, graphName, schemaBlocks, applyLabels }, callback);
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
				embeddingDims: nodeEdges.embeddingDims || null,
				graphName,
			},
			(err, result) => {
				session.close().then(() => driver.close());
				if (err) {
					callback(`replayManager.init '${graphName}': ${err}`);
					return;
				}
				callback('', result);
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
		const { inGraph, selectionLabels, header } = spec || {};

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
			},
			(err, result) => {
				if (err) {
					callback(`replayManager.harvest '${graphName}': ${err}`);
					return;
				}
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
	// delete — destroy the scratch container (data dies with it). DEV_* only, same guard.
	const deleteGraph = (handle, callback) => {
		const { xLog } = process.global;
		const graphName = handle && (handle.containerName || handle.graphName);
		const refusal = nameRefusal(graphName, 'delete');
		if (refusal) {
			callback(refusal);
			return;
		}
		execFile('docker', ['rm', '-f', graphName], { encoding: 'utf-8' }, (err, stdout, stderr) => {
			if (err) {
				callback(`replayManager.delete '${graphName}': docker rm failed: ${err.message}\n${stderr}`);
				return;
			}
			xLog.status(`[replayManager] scratch graph '${graphName}' destroyed`);
			callback('');
		});
	};

	return { create, init, harvest, delete: deleteGraph };
};

// END OF moduleFunction() ============================================================

module.exports = replayManager;
module.exports.nameRefusal = nameRefusal;
module.exports.withAppliedLabels = withAppliedLabels;
module.exports.schemaBlockTexts = schemaBlockTexts;
module.exports.resolveSettings = resolveSettings;
