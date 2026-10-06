'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// capturedGenerationDelta.js — TEST SUPPORT: campaign P3's W-B-11 change (2026-10-06), applied to artifacts CAPTURED before
// it (never re-captured: that would compare the code with itself — the rule capturedEdgeProvenanceDelta.js states). W-B-11
// inserts '+<declarationDigest12>' after the pluginVersion in the generation, and after the declared tool version in the
// SSSOM set header's mapping_tool. Both are derived from the declaration the caller names, read through the same
// canonical text and sha256 the framework uses.
//
//   generationWithDeclarationDigest({ capturedGeneration, bridgeDeclaration }) → generation | throws by name
//   sssomWithMappingToolDigest({ capturedSssomText, bridgeDeclaration })       → SSSOM text | throws by name

const path = require('path');
const crypto = require('crypto');
const bridgePluginContractLib = require(path.join(__dirname, '..', '..', 'bridgePluginContract'));

const declarationDigest12For = (bridgeDeclaration) => crypto.createHash('sha256').update(bridgePluginContractLib.canonicalJsonText(bridgeDeclaration), 'utf8').digest('hex').slice(0, 12);
const PRE_P3_GENERATION_PATTERN = /^([^:]+:[A-Za-z0-9]+@[^+:]+)(:.+)$/;

const generationWithDeclarationDigest = ({ capturedGeneration, bridgeDeclaration }) => {
	const matched = PRE_P3_GENERATION_PATTERN.exec(capturedGeneration);
	if (matched === null || capturedGeneration.indexOf(`@${bridgeDeclaration.pluginVersion}:`) === -1) {
		throw new Error(`${moduleName} REFUSED: captured generation ${JSON.stringify(capturedGeneration)} is not the pre-P3 '<gen>:<bridgeName>@<pluginVersion>:<renderer>' form for ${bridgeDeclaration.bridgeName}`);
	}
	return `${matched[1]}+${declarationDigest12For(bridgeDeclaration)}${matched[2]}`;
};

const sssomWithMappingToolDigest = ({ capturedSssomText, bridgeDeclaration }) => {
	const capturedToolLine = `#mapping_tool: "${bridgeDeclaration.mappingTool.name} ${bridgeDeclaration.mappingTool.version}"`;
	if (capturedSssomText.split(capturedToolLine).length !== 2) {
		throw new Error(`${moduleName} REFUSED: the captured SSSOM does not carry exactly one ${capturedToolLine}`);
	}
	return capturedSssomText.replace(capturedToolLine, `#mapping_tool: "${bridgeDeclaration.mappingTool.name} ${bridgeDeclaration.mappingTool.version}+${declarationDigest12For(bridgeDeclaration)}"`);
};

module.exports = { generationWithDeclarationDigest, sssomWithMappingToolDigest, declarationDigest12For, moduleName };
