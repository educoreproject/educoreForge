'use strict';

// instance-lifecycle.js — shared docker/Neo4j instance-lifecycle library (Phase 1B).
//
// Adapted from trackB containerManager.js: docker/neo4j mechanics, port-pair allocation,
// waitForNeo4jReady. ADAPTED AWAY: the prototype's per-graph gf_<name>.ini credential files.
// Credentials come from the registry row via the INJECTED credentialAccessor; the bolt URI +
// resolved credential are stored in the graphs row through forgeStore. NO credential file is
// ever written.
//
// Async style (TQ-ruled): qtools taskListPlus/pipeRunner for orchestration; neo4j-driver
// promises are resolved at the leaf with .then().catch(err => next(err)). No async/await, no
// try/catch for control flow, no Promises/EventEmitter surfaced to callers.
//
// DI: built parallel to 1A — accepts forgeStore + credentialAccessor injected; never requires
// forge-store directly.
//
// @concept: [[InstanceLifecycle]]
// @concept: [[ContainerLifecycle]]
// @concept: [[DynamicPortAssignment]]
// @concept: [[TeardownGuard]]

const net = require('net');
const { execFile, execFileSync } = require('child_process');
const neo4j = require('neo4j-driver');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const CONTAINER_PREFIX = 'gf_';
// neo4j 5.26 (5.x LTS): vector indexes are GA in Community Edition (>=5.13), which the
// replay engine's phase-3 CREATE VECTOR INDEX (1024-dim cosine) requires. 5.5 had no
// vector-index support, which would have skipped that index on every graph we build.
const NEO4J_IMAGE = 'neo4j:5.26';
const NEO4J_USER = 'neo4j';
const PORT_SEARCH_START = 7700;
const PORT_SEARCH_SPAN = 400;
const READY_TIMEOUT_MS = 120000;
const READY_POLL_MS = 2000;

// =====================================================================
// NAME HELPERS — pure
// =====================================================================

const containerNameForGraph = (graphName) => `${CONTAINER_PREFIX}${graphName}`;
const volumeNameForGraph = (graphName) => `${CONTAINER_PREFIX}${graphName}_data`;

// A graph is ephemeral (freely tearable) when its type is bronze/ephemeral. golden and any
// other named/published type is protected — teardown of it requires force===true.
const isEphemeralType = (type) => {
	const normalized = (type || '').toLowerCase();
	return normalized === 'bronze' || normalized === 'ephemeral';
};

// =====================================================================
// DOCKER PORT SCANNING + PORT-PAIR ALLOCATION
// =====================================================================

// Ports already published by running docker containers (host side).
const getDockerBoundPorts = (callback) => {
	execFile(
		'docker',
		['ps', '--format', '{{.Ports}}'],
		{ encoding: 'utf-8' },
		(err, stdout) => {
			const bound = new Set();
			if (err) {
				callback('', bound);
				return;
			}
			const matches = (stdout || '').matchAll(/:(\d+)->/g);
			for (const match of matches) {
				bound.add(parseInt(match[1], 10));
			}
			callback('', bound);
		}
	);
};

// True if the OS will let us bind `port` right now (i.e. nothing is listening on it).
const isPortBindable = (port, callback) => {
	const server = net.createServer();
	server.once('error', () => {
		callback('', false);
	});
	server.once('listening', () => {
		server.close(() => {
			callback('', true);
		});
	});
	server.listen(port, '0.0.0.0');
};

// Allocate a (boltPort, httpPort) consecutive pair that is bindable AND not already published
// by a running container. Adapted from trackB findAvailablePortPair.
const findAvailablePortPair = (startPort, callback) => {
	getDockerBoundPorts((portsErr, dockerPorts) => {
		const maxPort = startPort + PORT_SEARCH_SPAN;
		let candidate = startPort;

		const tryNext = () => {
			if (candidate >= maxPort) {
				callback(`No available bolt/http port pair found in range ${startPort}-${maxPort}`);
				return;
			}

			if (dockerPorts.has(candidate) || dockerPorts.has(candidate + 1)) {
				candidate += 2;
				tryNext();
				return;
			}

			isPortBindable(candidate, (boltErr, boltFree) => {
				if (!boltFree) {
					candidate += 2;
					tryNext();
					return;
				}
				isPortBindable(candidate + 1, (httpErr, httpFree) => {
					if (!httpFree) {
						candidate += 2;
						tryNext();
						return;
					}
					callback('', { boltPort: candidate, httpPort: candidate + 1 });
				});
			});
		};

		tryNext();
	});
};

// =====================================================================
// DOCKER STATE HELPERS — synchronous inspects (cheap, no control-flow throw)
// =====================================================================

const containerExists = (containerName) => {
	const result = execFileSync(
		'docker',
		['ps', '-a', '--filter', `name=^${containerName}$`, '--format', '{{.Names}}'],
		{ encoding: 'utf-8' }
	).trim();
	return result === containerName;
};

const volumeExists = (volumeName) => {
	const result = execFileSync(
		'docker',
		['volume', 'ls', '--filter', `name=^${volumeName}$`, '--format', '{{.Name}}'],
		{ encoding: 'utf-8' }
	).trim();
	return result === volumeName;
};

// =====================================================================
// waitForNeo4jReady — bolt TCP probe AND a verifying cypher round-trip.
// =====================================================================

// Phase 1: wait for the bolt port to accept TCP connections.
const waitForBoltPort = (boltPort, deadline, callback) => {
	const poll = () => {
		if (Date.now() > deadline) {
			callback(`Neo4j bolt port ${boltPort} did not open within ${READY_TIMEOUT_MS / 1000}s`);
			return;
		}
		const socket = new net.Socket();
		socket.setTimeout(1000);
		socket.once('connect', () => {
			socket.destroy();
			callback('');
		});
		socket.once('error', () => {
			socket.destroy();
			setTimeout(poll, READY_POLL_MS);
		});
		socket.once('timeout', () => {
			socket.destroy();
			setTimeout(poll, READY_POLL_MS);
		});
		socket.connect(boltPort, 'localhost');
	};
	poll();
};

// Phase 2: wait until the driver can actually authenticate + run a trivial cypher. The bolt port
// opening precedes auth-readiness, so we retry the round-trip until it succeeds or we time out.
const waitForCypherReady = (boltUri, credentialValue, deadline, callback) => {
	const attempt = () => {
		const driver = neo4j.driver(
			boltUri,
			neo4j.auth.basic(NEO4J_USER, credentialValue)
		);
		const session = driver.session();
		session
			.run('RETURN 1 AS readyProbe')
			.then(() => session.close())
			.then(() => driver.close())
			.then(() => callback(''))
			.catch((err) => {
				session.close().then(() => driver.close()).catch(() => {});
				if (Date.now() > deadline) {
					callback(`Neo4j did not become query-ready: ${err.message}`);
					return;
				}
				setTimeout(attempt, READY_POLL_MS);
			});
	};
	attempt();
};

const waitForNeo4jReady = (boltPort, boltUri, credentialValue, callback) => {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	waitForBoltPort(boltPort, deadline, (portErr) => {
		if (portErr) {
			callback(portErr);
			return;
		}
		waitForCypherReady(boltUri, credentialValue, deadline, callback);
	});
};

// =====================================================================
// runCypher helper — open driver, run, close; neo4j promise wrapped to callback.
// =====================================================================

const runCypherAgainst = (boltUri, credentialValue, cypher, params, callback) => {
	const driver = neo4j.driver(
		boltUri,
		neo4j.auth.basic(NEO4J_USER, credentialValue)
	);
	const session = driver.session();
	session
		.run(cypher, params || {})
		.then((result) => {
			const records = result.records.map((record) => record.toObject());
			session
				.close()
				.then(() => driver.close())
				.then(() => callback('', { records, summary: result.summary }));
		})
		.catch((err) => {
			session.close().then(() => driver.close()).catch(() => {});
			callback(`runCypher failed: ${err.message}`);
		});
};

// =====================================================================
// MODULE — curried with DI (forgeStore, credentialAccessor)
// =====================================================================

const moduleFunction = ({ moduleName } = {}) => ({ forgeStore, credentialAccessor } = {}) => (callback) => {
	// -----------------------------------------------------------------
	// createInstanceByName({graphName, type}, cb) -> {graphName, location}
	// -----------------------------------------------------------------
	const createInstanceByName = ({ graphName, type } = {}, cb) => {
		const containerName = containerNameForGraph(graphName);
		const volumeName = volumeNameForGraph(graphName);
		const taskList = new taskListPlus();

		// generate a per-graph credential (never written to a file).
		taskList.push((args, next) => {
			credentialAccessor.generateCredential((err, credential) => {
				if (err) { next(err); return; }
				next('', { ...args, credential });
			});
		});

		// allocate a non-colliding bolt/http port pair.
		taskList.push((args, next) => {
			findAvailablePortPair(PORT_SEARCH_START, (err, ports) => {
				if (err) { next(err); return; }
				next('', { ...args, ...ports });
			});
		});

		// docker run neo4j:5.5 + apoc with that credential, using a named docker volume.
		taskList.push((args, next) => {
			const { boltPort, httpPort, credential } = args;
			const dockerArgs = [
				'run', '-d',
				'--name', containerName,
				'-p', `${boltPort}:7687`,
				'-p', `${httpPort}:7474`,
				'-e', `NEO4J_AUTH=${NEO4J_USER}/${credential.value}`,
				'-e', 'NEO4J_PLUGINS=["apoc"]',
				'-e', 'NEO4J_dbms_security_procedures_unrestricted=apoc.*',
				'-e', 'NEO4J_dbms_security_procedures_allowlist=apoc.*',
				'-v', `${volumeName}:/data`,
				NEO4J_IMAGE
			];
			execFile('docker', dockerArgs, { encoding: 'utf-8' }, (err, stdout, stderr) => {
				if (err) {
					next(`docker run failed: ${err.message}\n${stderr}`);
					return;
				}
				next('', { ...args });
			});
		});

		// await readiness: bolt port open, then an authenticated cypher round-trip.
		taskList.push((args, next) => {
			const { boltPort } = args;
			const boltUri = `bolt://localhost:${boltPort}`;
			waitForNeo4jReady(boltPort, boltUri, args.credential.value, (err) => {
				if (err) { next(err); return; }
				next('', { ...args, boltUri });
			});
		});

		// store the credential in the registry row via the injected accessor, and upsert the graph
		// row (location = boltUri, credential reference + resolved value). NO file written.
		taskList.push((args, next) => {
			const { boltUri, credential } = args;
			forgeStore.upsertGraph(
				{
					name: graphName,
					location: boltUri,
					type,
					credentialReference: credential.reference,
					credentialValue: credential.value
				},
				(err) => {
					if (err) { next(err); return; }
					next('', { ...args });
				}
			);
		});

		// store the credential through the accessor as well (so the scheme is honored end-to-end).
		taskList.push((args, next) => {
			const { credential } = args;
			credentialAccessor.storeForGraph(
				{ graphName, reference: credential.reference, value: credential.value },
				(err) => {
					if (err) { next(err); return; }
					next('', { ...args });
				}
			);
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				cb(err);
				return;
			}
			cb('', { graphName, location: args.boltUri });
		});
	};

	// -----------------------------------------------------------------
	// resolveAccessByName({graphName}, cb) -> {location, credential}
	// Resolved from the registry by name — never from a file.
	// -----------------------------------------------------------------
	const resolveAccessByName = ({ graphName } = {}, cb) => {
		const taskList = new taskListPlus();

		taskList.push((args, next) => {
			forgeStore.getGraphByName({ name: graphName }, (err, graphRow) => {
				if (err) { next(err); return; }
				if (!graphRow) { next(`resolveAccessByName: no graph named '${graphName}'`); return; }
				next('', { ...args, graphRow });
			});
		});

		taskList.push((args, next) => {
			credentialAccessor.resolveForGraph({ graphName }, (err, credential) => {
				if (err) { next(err); return; }
				if (!credential) { next(`resolveAccessByName: no credential for '${graphName}'`); return; }
				next('', { ...args, credential });
			});
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				cb(err);
				return;
			}
			cb('', { location: args.graphRow.location, credential: args.credential });
		});
	};

	// -----------------------------------------------------------------
	// runCypher({graphName, cypher, params}, cb) -> {records, summary}
	// -----------------------------------------------------------------
	const runCypher = ({ graphName, cypher, params } = {}, cb) => {
		resolveAccessByName({ graphName }, (err, access) => {
			if (err) { cb(err); return; }
			runCypherAgainst(access.location, access.credential.value, cypher, params, cb);
		});
	};

	// -----------------------------------------------------------------
	// destroyInstanceByName({graphName, force}, cb)
	// Teardown guard: refuse a non-ephemeral/golden graph unless force===true.
	// On success: remove container + volume AND drop the registry row.
	// Never called on an error path — only acts when explicitly invoked.
	// -----------------------------------------------------------------
	const destroyInstanceByName = ({ graphName, force } = {}, cb) => {
		const containerName = containerNameForGraph(graphName);
		const volumeName = volumeNameForGraph(graphName);
		const taskList = new taskListPlus();

		// guard: consult the registry row's type; refuse non-ephemeral unless force===true.
		taskList.push((args, next) => {
			forgeStore.getGraphByName({ name: graphName }, (err, graphRow) => {
				if (err) { next(err); return; }
				const graphType = graphRow ? graphRow.type : null;
				if (!isEphemeralType(graphType) && force !== true) {
					next(`destroyInstanceByName refused: graph '${graphName}' is type '${graphType}' (non-ephemeral); pass force===true to override`);
					return;
				}
				next('', { ...args, graphRow });
			});
		});

		// remove container (stop+rm via -f), idempotent.
		taskList.push((args, next) => {
			if (!containerExists(containerName)) {
				next('', { ...args });
				return;
			}
			execFile('docker', ['rm', '-f', containerName], { encoding: 'utf-8' }, (err, stdout, stderr) => {
				if (err) { next(`docker rm failed: ${err.message}\n${stderr}`); return; }
				next('', { ...args });
			});
		});

		// remove the named volume, idempotent.
		taskList.push((args, next) => {
			if (!volumeExists(volumeName)) {
				next('', { ...args });
				return;
			}
			execFile('docker', ['volume', 'rm', volumeName], { encoding: 'utf-8' }, (err, stdout, stderr) => {
				if (err) { next(`docker volume rm failed: ${err.message}\n${stderr}`); return; }
				next('', { ...args });
			});
		});

		// drop the registry row.
		taskList.push((args, next) => {
			forgeStore.dropGraph({ name: graphName }, (err) => {
				if (err) { next(err); return; }
				next('', { ...args });
			});
		});

		pipeRunner(taskList.getList(), {}, (err) => {
			if (err) {
				cb(err);
				return;
			}
			cb('', { graphName, destroyed: true });
		});
	};

	callback('', {
		createInstanceByName,
		resolveAccessByName,
		runCypher,
		destroyInstanceByName
	});
};

module.exports = moduleFunction({ moduleName: 'instance-lifecycle' });
