'use strict';

// instance-lifecycle-test.js — Phase 1B test gate. Runs with `node`. Requires Docker.
//
// Uses an IN-MEMORY fake forgeStore (upsertGraph/getGraphByName/dropGraph) and an in-memory
// fake credentialAccessor (generateCredential/storeForGraph/resolveForGraph) conforming to the
// contract §1A signatures, so this builds/tests in parallel with 1A.
//
// Gating assertions (ALL must pass):
//   A. create -> waitForNeo4jReady -> resolveAccessByName -> trivial cypher (RETURN 1) ->
//      destroy -> container + volume gone, fake registry row dropped.
//   B. port-pair allocation avoids already-bound ports (bind a port first; assert allocator skips it).
//   C. credential generated, stored in the (fake) registry row, retrieved by name; NEVER written to
//      any file (assert no gf_*.ini / credential file created anywhere in the package dir).
//   D. teardown guard: refuses a graph typed golden/non-ephemeral without force; succeeds with force.
//
// Teardown is guaranteed in a finally-equivalent so no stray containers/volumes are left.

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const instanceLifecycleModule = require('../instance-lifecycle.js');

const TEST_GRAPH = '__TEST_phase1b';
const CONTAINER_NAME = `gf_${TEST_GRAPH}`;
const VOLUME_NAME = `gf_${TEST_GRAPH}_data`;
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');

let passCount = 0;
let failCount = 0;
const failures = [];

const assert = (label, condition) => {
	if (condition) {
		passCount += 1;
		console.log(`  PASS: ${label}`);
	} else {
		failCount += 1;
		failures.push(label);
		console.log(`  FAIL: ${label}`);
	}
};

// =====================================================================
// IN-MEMORY FAKES (§1A signatures)
// =====================================================================

const makeFakeForgeStore = () => {
	const rows = {}; // name -> row
	return {
		_rows: rows,
		upsertGraph: ({ name, location, type, credentialReference, credentialValue }, cb) => {
			rows[name] = { graphId: name, name, location, type, credentialReference, credentialValue };
			cb('', { name });
		},
		getGraphByName: ({ name }, cb) => {
			cb('', rows[name] || null);
		},
		dropGraph: ({ name }, cb) => {
			delete rows[name];
			cb('', { name });
		}
	};
};

const makeFakeCredentialAccessor = (fakeStore) => {
	// stores reference/value alongside the graph; resolves by graphName. In-memory only — NEVER a file.
	const store = {}; // graphName -> {reference, value}
	return {
		_store: store,
		generateCredential: (cb) => {
			const value = crypto.randomBytes(24).toString('hex');
			const reference = `cred_${crypto.randomBytes(6).toString('hex')}`;
			cb('', { reference, value });
		},
		storeForGraph: ({ graphName, reference, value }, cb) => {
			store[graphName] = { reference, value };
			cb('', { graphName });
		},
		resolveForGraph: ({ graphName }, cb) => {
			// resolve from the registry row (the storage IS the graphs row per §1A); fall back to
			// the accessor's own store if present.
			const row = fakeStore._rows[graphName];
			if (row && row.credentialValue) {
				cb('', { reference: row.credentialReference, value: row.credentialValue });
				return;
			}
			cb('', store[graphName] || null);
		}
	};
};

// =====================================================================
// HELPERS
// =====================================================================

const dockerContainerExists = (name) => {
	const out = execFileSync('docker', ['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], { encoding: 'utf-8' }).trim();
	return out === name;
};

const dockerVolumeExists = (name) => {
	const out = execFileSync('docker', ['volume', 'ls', '--filter', `name=^${name}$`, '--format', '{{.Name}}'], { encoding: 'utf-8' }).trim();
	return out === name;
};

const forceCleanup = () => {
	try { execFileSync('docker', ['rm', '-f', CONTAINER_NAME], { encoding: 'utf-8' }); } catch (e) { /* ignore */ }
	try { execFileSync('docker', ['volume', 'rm', VOLUME_NAME], { encoding: 'utf-8' }); } catch (e) { /* ignore */ }
};

// Live host-side ports published by running docker containers — the set the allocator must skip.
const getDockerBoundPortSet = () => {
	const bound = new Set();
	let out = '';
	try { out = execFileSync('docker', ['ps', '--format', '{{.Ports}}'], { encoding: 'utf-8' }); } catch (e) { return bound; }
	const matches = out.matchAll(/:(\d+)->/g);
	for (const match of matches) { bound.add(parseInt(match[1], 10)); }
	return bound;
};

// Recursively find any credential ARTIFACT files the module might have written at runtime.
// Deliberately narrow: matches the prototype's per-graph credential-file shapes
// (gf_<name>.ini, *.secret, *.credential, *.cred, *.pem, *.key) — NOT source modules. The 1A
// credential-accessor.js SOURCE file is not a written credential and must not trip this.
const findCredentialFiles = (dir) => {
	const hits = [];
	const walk = (d) => {
		let entries = [];
		try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
		entries.forEach((entry) => {
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'node_modules' || entry.name === '.git') return;
				walk(full);
				return;
			}
			if (/^gf_.*\.ini$/.test(entry.name) || /\.(secret|credential|cred|pem|key)$/i.test(entry.name)) {
				hits.push(full);
			}
		});
	};
	walk(dir);
	return hits;
};

// =====================================================================
// TEST B (pure, no docker) — port-pair allocation avoids a bound port.
// We bind a port in the search range, then drive a fresh lifecycle through resolve/run paths is
// not enough; instead we exercise the allocator indirectly by binding 7700 and 7701 and asserting
// the created container does NOT land on them (checked in Test A's port). Here we additionally do a
// direct allocator check by requiring the internal function via a fresh create against bound ports.
// =====================================================================

// =====================================================================
// MAIN
// =====================================================================

const run = () => {
	// Pre-clean any stray state from a prior aborted run.
	forceCleanup();

	const fakeStore = makeFakeForgeStore();
	const fakeCred = makeFakeCredentialAccessor(fakeStore);

	// Bind a port within the allocator's search range as a deterministic collision, then ALSO
	// capture the live docker-bound port set. The allocator must avoid BOTH. We bind upward from
	// the search start until one binds, so we always hold at least one real in-range collision.
	const blocker = net.createServer();
	let blockedPort = null;

	const finishUp = (exitCode) => {
		// finally-equivalent: ALWAYS clean up docker + the blocker socket.
		forceCleanup();
		try { blocker.close(); } catch (e) { /* ignore */ }
		console.log('\n=====================================================');
		console.log(`RESULT: ${failCount === 0 ? 'GREEN' : 'RED'}  (${passCount} passed, ${failCount} failed)`);
		if (failCount > 0) {
			console.log('Failing assertions:');
			failures.forEach((f) => console.log(`  - ${f}`));
		}
		console.log('=====================================================');
		process.exit(exitCode);
	};

	let lifecycle = null;

	const proceed = () => {
		const dockerBoundBeforeCreate = getDockerBoundPortSet();
		console.log(`  Held collision port: ${blockedPort}. Docker-bound ports: [${[...dockerBoundBeforeCreate].sort((a, b) => a - b).join(', ')}]`);
		instanceLifecycleModule({ forgeStore: fakeStore, credentialAccessor: fakeCred })((moduleErr, api) => {
			if (moduleErr) {
				console.log(`  FATAL: module init failed: ${moduleErr}`);
				finishUp(1);
				return;
			}
			lifecycle = api;
			runScenario(lifecycle, fakeStore, blockedPort, dockerBoundBeforeCreate, finishUp);
		});
	};

	// Try to bind a candidate in-range port; on collision step to the next even slot and retry.
	const tryBind = (candidate) => {
		if (candidate >= 7700 + 400) {
			// Could not hold an in-range port; proceed using only the docker-bound set as the proof.
			console.log('  NOTE: no in-range port free to hold as a collision; relying on docker-bound set.');
			proceed();
			return;
		}
		const onError = () => { blocker.removeListener('listening', onListening); blocker.removeAllListeners('error'); tryBind(candidate + 2); };
		const onListening = () => { blocker.removeListener('error', onError); blockedPort = candidate; console.log(`  Bound port ${candidate} as an in-range collision blocker.`); proceed(); };
		blocker.once('error', onError);
		blocker.once('listening', onListening);
		blocker.listen(candidate, '0.0.0.0');
	};

	tryBind(7700);
};

const runScenario = (lifecycle, fakeStore, blockedPort, dockerBoundBeforeCreate, finishUp) => {
	console.log('\n--- TEST A/B/C: create -> ready -> resolve -> cypher -> destroy ---');

	lifecycle.createInstanceByName({ graphName: TEST_GRAPH, type: 'bronze' }, (createErr, created) => {
		if (createErr) {
			console.log(`  FAIL: createInstanceByName errored: ${createErr}`);
			failCount += 1;
			failures.push('createInstanceByName succeeds');
			finishUp(1);
			return;
		}
		assert('createInstanceByName returns location', !!(created && created.location));

		// Test B: the allocated bolt port (and its http neighbor) must avoid BOTH the port we hold
		// AND every port docker already published. This exercises both skip paths in the allocator.
		const boltPort = parseInt((created.location.match(/:(\d+)$/) || [])[1], 10);
		const httpPort = boltPort + 1;
		const avoidsHeld = blockedPort === null || (boltPort !== blockedPort && httpPort !== blockedPort);
		const avoidsDocker = !dockerBoundBeforeCreate.has(boltPort) && !dockerBoundBeforeCreate.has(httpPort);
		assert('port allocator skipped the held in-range collision port', avoidsHeld);
		assert('port allocator skipped all docker-bound ports', avoidsDocker);

		// container + volume now exist (waitForNeo4jReady already passed inside create).
		assert('container exists after create', dockerContainerExists(CONTAINER_NAME));
		assert('volume exists after create', dockerVolumeExists(VOLUME_NAME));

		// Test C: credential stored in the (fake) registry row.
		const row = fakeStore._rows[TEST_GRAPH];
		assert('registry row carries credentialReference', !!(row && row.credentialReference));
		assert('registry row carries credentialValue', !!(row && row.credentialValue));

		// Test C: NO credential file written anywhere in the package.
		const credFiles = findCredentialFiles(PACKAGE_ROOT);
		assert('no gf_*.ini / credential file written', credFiles.length === 0);
		if (credFiles.length > 0) {
			console.log(`    offending files: ${credFiles.join(', ')}`);
		}

		// resolveAccessByName from the registry.
		lifecycle.resolveAccessByName({ graphName: TEST_GRAPH }, (resolveErr, access) => {
			assert('resolveAccessByName returns location', !resolveErr && !!(access && access.location));
			assert('resolveAccessByName returns credential value', !!(access && access.credential && access.credential.value));
			assert('resolved credential matches stored row', !!(access && row && access.credential.value === row.credentialValue));

			// trivial cypher round-trip.
			lifecycle.runCypher({ graphName: TEST_GRAPH, cypher: 'RETURN 1 AS n' }, (cypherErr, cypherResult) => {
				const n = cypherResult && cypherResult.records && cypherResult.records[0] && cypherResult.records[0].n;
				// neo4j returns Integer objects; toNumber() or toString compare.
				const nValue = n && typeof n.toNumber === 'function' ? n.toNumber() : n;
				assert('cypher RETURN 1 round-trip yields 1', !cypherErr && Number(nValue) === 1);

				runGuardThenDestroy(lifecycle, fakeStore, finishUp);
			});
		});
	});
};

const runGuardThenDestroy = (lifecycle, fakeStore, finishUp) => {
	console.log('\n--- TEST D: teardown guard (golden/non-ephemeral) ---');

	// Flip the registry row type to a protected 'golden' to exercise the guard WITHOUT destroying
	// the real container yet. Then assert refusal without force.
	fakeStore._rows[TEST_GRAPH].type = 'golden';

	lifecycle.destroyInstanceByName({ graphName: TEST_GRAPH, force: false }, (guardErr) => {
		assert('teardown guard refuses golden without force', !!guardErr);
		assert('container still present after refused teardown', dockerContainerExists(CONTAINER_NAME));

		// now succeed WITH force — this also performs the real Test A teardown.
		lifecycle.destroyInstanceByName({ graphName: TEST_GRAPH, force: true }, (destroyErr) => {
			assert('teardown succeeds with force===true', !destroyErr);

			console.log('\n--- TEST A (continued): post-destroy state ---');
			assert('container gone after destroy', !dockerContainerExists(CONTAINER_NAME));
			assert('volume gone after destroy', !dockerVolumeExists(VOLUME_NAME));
			assert('fake registry row dropped after destroy', !fakeStore._rows[TEST_GRAPH]);

			finishUp(failCount === 0 ? 0 : 1);
		});
	});
};

run();
