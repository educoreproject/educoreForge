'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// hubBridgingLoader.js — finds and loads a hub's bridging declaration (hubBridgingContract.js) by the hub bundle's DECLARED
// location: forges/<hubToken>/parserDescriptor.ini [parserDescriptor] hubBridgingModule. Never by a hub-name switch: the token
// names a bundle directory, and the bundle says where its declaration lives. R2 of the hub-neutral bridge lane (2026-10-21);
// R3's composer is the reader.
//
//   loadHubBridging({ forgesDirPath, hubToken }) → { hubBridging, hubBridgingFilePath } | { error }
//     refused by name: no such bundle; a descriptor whose hub keys fail the hub descriptor contract; a hub that declares no
//     hubBridgingModule; a module that does not export exactly { hubBridging }; a declaration the contract refuses; a
//     declaration whose hubToken is not its bundle's

const fs = require('fs');
const path = require('path');
const configFileProcessor = require('qtools-config-file-processor');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { validateHubDescriptor } = require(path.join(__dirname, '..', 'hub-framework', 'hubDeclarationContract'));
const hubBridgingContractLib = require('./hubBridgingContract');

const DESCRIPTOR_FILE_NAME = 'parserDescriptor.ini';
const DESCRIPTOR_SECTION_NAME = 'parserDescriptor';
const BRIDGING_MODULE_DESCRIPTOR_KEY = 'hubBridgingModule';
const BRIDGING_EXPORT_NAME = 'hubBridging';

const loadHubBridging = ({ forgesDirPath, hubToken } = {}) => {
	const descriptorPath = path.join(forgesDirPath, String(hubToken), DESCRIPTOR_FILE_NAME);
	if (typeof hubToken !== 'string' || !fs.existsSync(descriptorPath)) {
		return { error: refuse.byName({ moduleName, what: `there is no forge bundle '${hubToken}' (no ${descriptorPath})`, where: 'a hub token names a bundle directory under forges/ whose parserDescriptor.ini declares it a hub' }) };
	}
	// the same reader the forger uses for the same file (forger.resolveBundle)
	const descriptor = (configFileProcessor.getConfig(descriptorPath) || {})[DESCRIPTOR_SECTION_NAME];
	const descriptorError = validateHubDescriptor({ descriptor, descriptorPath });
	if (descriptorError) {
		return { error: descriptorError };
	}
	if (descriptor[BRIDGING_MODULE_DESCRIPTOR_KEY] === undefined) {
		return { error: refuse.byName({ moduleName, what: `forge bundle '${hubToken}' declares no ${BRIDGING_MODULE_DESCRIPTOR_KEY} in ${descriptorPath}`, where: `a bridge toward a hub reads the hub half of its declaration from the file the hub's descriptor names (${BRIDGING_MODULE_DESCRIPTOR_KEY}=lib/<hub>HubBridging.js)` }) };
	}
	const hubBridgingFilePath = path.join(forgesDirPath, hubToken, descriptor[BRIDGING_MODULE_DESCRIPTOR_KEY]);
	if (!fs.existsSync(hubBridgingFilePath)) {
		return { error: refuse.byName({ moduleName, what: `${descriptorPath} names ${BRIDGING_MODULE_DESCRIPTOR_KEY}=${descriptor[BRIDGING_MODULE_DESCRIPTOR_KEY]}, which is not a file`, where: 'the descriptor names a kit-relative module that exists' }) };
	}
	const loadedModule = require(hubBridgingFilePath);
	const exportNameList = loadedModule !== null && typeof loadedModule === 'object' ? Object.keys(loadedModule) : [];
	if (exportNameList.length !== 1 || exportNameList[0] !== BRIDGING_EXPORT_NAME) {
		return { error: refuse.byName({ moduleName, what: `${hubBridgingFilePath} exports [${exportNameList.join(', ')}], not exactly { ${BRIDGING_EXPORT_NAME} }`, where: 'a hub bridging file is pure data' }) };
	}
	const hubBridging = loadedModule[BRIDGING_EXPORT_NAME];
	const contractError = hubBridgingContractLib.validateHubBridging({ hubBridging });
	if (contractError) {
		return { error: new Error(`${contractError.message} [${hubBridgingFilePath}]`) };
	}
	if (hubBridging.hubToken !== hubToken) {
		return { error: refuse.byName({ moduleName, what: `${hubBridgingFilePath} declares hubToken '${hubBridging.hubToken}' but sits in bundle '${hubToken}'`, where: 'hubToken MUST equal the bundle directory, as a plugin\'s standardKey must (BR-009)' }) };
	}
	return { hubBridging, hubBridgingFilePath };
};

module.exports = { loadHubBridging, BRIDGING_MODULE_DESCRIPTOR_KEY, moduleName };
