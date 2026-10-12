'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// goldGraphHandle.js — the gold graph's bolt address and password, resolved from the running container the way
// the DME's container-connection-resolver does it (docker inspect: the 7687/tcp host port and NEO4J_AUTH). The
// password is held in the handle and never printed or written. The harness only ever READS through this handle.

const { execFile } = require('child_process');

const resolveGoldGraphHandle = ({ containerName }, callback) => {
	if (typeof containerName !== 'string' || containerName.trim() === '') {
		callback(`${moduleName}: containerName is required (walkExperiment.json goldContainerName); there is no default graph`);
		return;
	}
	execFile('docker', ['inspect', '--format', '{{json .}}', containerName], { maxBuffer: 16 * 1024 * 1024 }, (inspectError, inspectText) => {
		if (inspectError) {
			callback(`${moduleName}: docker inspect ${containerName} failed (is it running?)`);
			return;
		}
		const inspected = JSON.parse(inspectText);
		const portBindingList = ((inspected.NetworkSettings || {}).Ports || {})['7687/tcp'];
		if (!Array.isArray(portBindingList) || portBindingList.length === 0) {
			callback(`${moduleName}: ${containerName} publishes no host port for 7687/tcp`);
			return;
		}
		const authLine = ((inspected.Config || {}).Env || []).find((oneLine) => oneLine.indexOf('NEO4J_AUTH=neo4j/') === 0);
		if (authLine === undefined) {
			callback(`${moduleName}: ${containerName} carries no NEO4J_AUTH=neo4j/... environment line`);
			return;
		}
		if (inspected.State === undefined || inspected.State.Running !== true) {
			callback(`${moduleName}: ${containerName} is not running`);
			return;
		}
		callback('', { boltUrl: `bolt://localhost:${portBindingList[0].HostPort}`, user: 'neo4j', password: authLine.slice('NEO4J_AUTH=neo4j/'.length), containerName });
	});
};

module.exports = { resolveGoldGraphHandle, moduleName };
