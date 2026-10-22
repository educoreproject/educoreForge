'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// containerBolt.js — a running graph container's bolt endpoint and credential, read from the container itself (R5 S6, 2026-10-21).
//
//   resolveContainerBolt({ containerName, runDockerCommand? }, callback(errString, { containerName, boltUrl, user, password }))
//
// Moved here VERBATIM from forges/ceds/lib/roundTripCompiler.js, where every graph-builder tool that opens a graph by name had to
// borrow it from one standard's forge. It names no standard: `docker inspect`, the 7687/tcp host port and NEO4J_AUTH. The
// bolt port and the credential are FACTS ABOUT THE RUNNING CONTAINER, so they are read from the container rather than restated
// on a command line where they could drift. runDockerCommand is injectable so a test can prove the parsing without Docker.
// A directory of its own on purpose: under lib/bridge-framework/ it would move every re-frozen block's frameworkFingerprint.
// (Near-copies remain in forges/sif, forges/edfi and forges/pesc260805 round-trip compilers; untouched, listed in DEVLOG-R5.)

const { execFile } = require('child_process');

const defaultRunDockerCommand = (dockerArgs, callback) =>
	execFile('docker', dockerArgs, { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }, callback);

const resolveContainerBolt = (
	{ containerName, runDockerCommand = defaultRunDockerCommand } = {},
	callback,
) => {
	if (typeof containerName !== 'string' || containerName.trim() === '') {
		callback(
			`${moduleName}.resolveContainerBolt: containerName is REQUIRED and has no default.`,
		);
		return;
	}
	runDockerCommand(['inspect', containerName], (inspectError, stdout, stderr) => {
		if (inspectError) {
			callback(
				`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' failed: ` +
					`${inspectError.message}${stderr ? `\n${stderr}` : ''}`,
			);
			return;
		}
		let inspected;
		try {
			inspected = JSON.parse(stdout);
		} catch (parseError) {
			callback(
				`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' returned ` +
					`unparseable JSON: ${parseError.message}`,
			);
			return;
		}
		const record = Array.isArray(inspected) ? inspected[0] : inspected;
		if (!record) {
			callback(
				`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' returned no ` +
					`record. The container does not exist under that name.`,
			);
			return;
		}
		const portBindings =
			(record.NetworkSettings && record.NetworkSettings.Ports && record.NetworkSettings.Ports['7687/tcp']) ||
			[];
		const boltPort = (portBindings.find((oneBinding) => oneBinding && oneBinding.HostPort) || {})
			.HostPort;
		if (!boltPort) {
			callback(
				`${moduleName}.resolveContainerBolt: container '${containerName}' publishes no host ` +
					`port for 7687/tcp. There is no bolt endpoint to read and one is not guessed at.`,
			);
			return;
		}
		const authEntry = ((record.Config && record.Config.Env) || []).find((oneEntry) =>
			String(oneEntry).startsWith('NEO4J_AUTH='),
		);
		if (!authEntry) {
			callback(
				`${moduleName}.resolveContainerBolt: container '${containerName}' declares no ` +
					`NEO4J_AUTH in its environment. The credential is read from the container, never ` +
					`assumed.`,
			);
			return;
		}
		const authValue = authEntry.slice('NEO4J_AUTH='.length);
		const slashAt = authValue.indexOf('/');
		if (slashAt === -1) {
			callback(
				`${moduleName}.resolveContainerBolt: container '${containerName}' has NEO4J_AUTH ` +
					`'${authValue}', which is not the '<user>/<password>' shape.`,
			);
			return;
		}
		callback('', {
			containerName,
			boltUrl: `bolt://localhost:${boltPort}`,
			user: authValue.slice(0, slashAt),
			password: authValue.slice(slashAt + 1),
		});
	});
};

module.exports = { resolveContainerBolt, moduleName };
