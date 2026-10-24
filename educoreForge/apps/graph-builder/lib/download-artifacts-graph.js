'use strict';

// download-artifacts-graph.js — the parts of the standard downloads that touch the golden (tools/downloadArtifacts.js).
//
//   installReadOnlyDriverGuard({ neo4jDriverModule }) -> { readGuard }
//     Wraps the one neo4j-driver module every validator in this tree resolves (code fact, 2026-10-15: each requires it
//     lazily, at call time, from the tree's node_modules), so EVERY session any of them opens is a READ session. The
//     server then refuses a write in that session (Neo.ClientError.Statement.AccessMode) instead of performing it. The
//     forge and its validators are not changed: the wrap lives in this process only. readGuard.sessionCount says how many
//     sessions went through it, so a run can show the guard was in the path.
//
//   statementListingEmitterByBundleToken[<bundleToken>]({ treeRootPath, boltTriple }, callback(err, { statementMap }))
//     For a bundle whose validator writes no file of its emission (SIF260928, Ed-Fi, PESC_LD, the CTDL family), the graph side of its own round trip,
//     run again over the golden through the validator's own libraries, so the listing holds exactly the statements the
//     verdict compared. A bundle of kind statementListing with no emitter here is refused by the tool, by name.
//
// The driver's promises end at their leaf ('.then(success, failure)' into the callback): DOCTRINE.md's dispensation.

const path = require('path');

const installReadOnlyDriverGuard = ({ neo4jDriverModule }) => {
	if (!neo4jDriverModule || typeof neo4jDriverModule.driver !== 'function' || !neo4jDriverModule.session || !neo4jDriverModule.session.READ) {
		return { error: 'installReadOnlyDriverGuard: the neo4j-driver module given exposes no driver() or session.READ' };
	}
	if (neo4jDriverModule.driver.isReadOnlyGuard === true) {
		return { error: 'installReadOnlyDriverGuard: the guard is already installed in this process' };
	}
	const readGuard = { sessionCount: 0 };
	const unguardedDriverFactory = neo4jDriverModule.driver;
	const guardedDriverFactory = (...driverArgumentList) => {
		const realDriver = unguardedDriverFactory(...driverArgumentList);
		const unguardedSession = realDriver.session.bind(realDriver);
		realDriver.session = (sessionConfig = {}) => {
			readGuard.sessionCount += 1;
			return unguardedSession({ ...sessionConfig, defaultAccessMode: neo4jDriverModule.session.READ });
		};
		return realDriver;
	};
	guardedDriverFactory.isReadOnlyGuard = true;
	neo4jDriverModule.driver = guardedDriverFactory;
	return { readGuard };
};

const sif260928ListingEmitter = ({ treeRootPath, boltTriple }, callback) => {
	const bundleDirPath = path.join(treeRootPath, 'forges', 'sif260928');
	const rosterLib = require(path.join(treeRootPath, 'lib', 'forge-framework', 'roster'));
	const descriptorRead = rosterLib.readDescriptorSection(path.join(bundleDirPath, rosterLib.DESCRIPTOR_FILE_NAME));
	const sourceFileName = descriptorRead.valueByName && descriptorRead.valueByName.sourceFile;
	if (typeof sourceFileName !== 'string' || sourceFileName === '') {
		callback('sif260928 listing: its parserDescriptor.ini declares no sourceFile');
		return;
	}
	const forgeDeclaration = require(path.join(bundleDirPath, 'lib', 'sif260928ForgeDeclaration'));
	const roundTripPair = require(path.join(bundleDirPath, 'lib', 'sif260928RoundTripPair'))({ sourceFileName });
	const { openGraphReader } = require(path.join(treeRootPath, 'lib', 'forge-framework', 'roundTripHarness', 'graphReader'));
	openGraphReader({ boltUrl: boltTriple.boltUrl, user: boltTriple.user, password: boltTriple.password, standardSource: forgeDeclaration.standardSource }, (openError, reader) => {
		if (openError) {
			callback(`sif260928 listing: ${openError}`);
			return;
		}
		roundTripPair.emitFromGraph({ reader }, (emitError, emitted) => {
			reader.close((closeError) => {
				if (emitError || (emitted && emitted.fault !== undefined)) {
					callback(`sif260928 listing: ${emitError || JSON.stringify(emitted.fault)}`);
					return;
				}
				if (closeError) {
					callback(`sif260928 listing: ${closeError}`);
					return;
				}
				callback('', { statementMap: emitted.statements });
			});
		});
	});
};

// ⟪zeroBacklog lane C1, 2026-10-22⟫ PESC_LD reads a snapshot DIRECTORY (no sourceFile), so its pair needs no file name
const pescldListingEmitter = ({ treeRootPath, boltTriple }, callback) => {
	const bundleDirPath = path.join(treeRootPath, 'forges', 'pescld');
	const forgeDeclaration = require(path.join(bundleDirPath, 'lib', 'pescldForgeDeclaration'));
	const roundTripPair = require(path.join(bundleDirPath, 'lib', 'pescldRoundTripPair'))({ ruleModulePath: 'forges/pescld/lib/pescldRoundTripPair.js' });
	const { openGraphReader } = require(path.join(treeRootPath, 'lib', 'forge-framework', 'roundTripHarness', 'graphReader'));
	openGraphReader({ boltUrl: boltTriple.boltUrl, user: boltTriple.user, password: boltTriple.password, standardSource: forgeDeclaration.standardSource }, (openError, reader) => {
		if (openError) {
			callback(`pescld listing: ${openError}`);
			return;
		}
		roundTripPair.emitFromGraph({ reader }, (emitError, emitted) => {
			reader.close((closeError) => {
				if (emitError || (emitted && emitted.fault !== undefined)) {
					callback(`pescld listing: ${emitError || JSON.stringify(emitted.fault)}`);
					return;
				}
				if (closeError) {
					callback(`pescld listing: ${closeError}`);
					return;
				}
				callback('', { statementMap: emitted.statements });
			});
		});
	});
};

const edfiListingEmitter = ({ treeRootPath, boltTriple }, callback) => {
	const edfiLibDirPath = path.join(treeRootPath, 'forges', 'edfi', 'lib');
	const roundTripEdfiCompiler = require(path.join(edfiLibDirPath, 'roundTripEdfiCompiler'))();
	const roundTripMetaEdCanonical = require(path.join(edfiLibDirPath, 'roundTripMetaEdCanonical'))();
	const reader = roundTripEdfiCompiler.makeNeo4jEdfiReader({ boltUrl: boltTriple.boltUrl, user: boltTriple.user, password: boltTriple.password });
	reader.readAll((readError, graphRows) => {
		reader.close((closeError) => {
			if (readError || closeError) {
				callback(`edfi listing: ${readError || closeError}`);
				return;
			}
			const emission = roundTripEdfiCompiler.emitGraphStatements({ graphRows });
			if (emission.fault) {
				callback(`edfi listing: emission fault ${typeof emission.fault === 'string' ? emission.fault : JSON.stringify(emission.fault)}`);
				return;
			}
			callback('', { statementMap: roundTripMetaEdCanonical.assembleStatementMap({ statementList: emission.statementList }).statementMap });
		});
	});
};

// ⟪zeroBacklog A4, 2026-10-23⟫ the CTDL family: three bundles, ONE round-trip pair (lib/ctdl-family-forge/jsonLdRoundTripPair.js),
// each built over its own vocabulary profile exactly as that bundle's roundTripValidator.js builds it. What differs per bundle is
// data, so it lives in this table rather than in three copies of the emitter.
const JSON_LD_FAMILY_LISTING_RULE_BY_BUNDLE_TOKEN = Object.freeze({
	ctdl: Object.freeze({ forgeDeclarationModuleName: 'ctdlForgeDeclaration', vocabularyProfileFileName: 'ctdlVocabularyProfile.json' }),
	ctdlasn: Object.freeze({ forgeDeclarationModuleName: 'ctdlasnForgeDeclaration', vocabularyProfileFileName: 'ctdlasnVocabularyProfile.json' }),
	ctdlqdata: Object.freeze({ forgeDeclarationModuleName: 'ctdlqdataForgeDeclaration', vocabularyProfileFileName: 'ctdlqdataVocabularyProfile.json' }),
});

const jsonLdFamilyListingEmitterFor = ({ bundleToken }) => {
	const listingRule = JSON_LD_FAMILY_LISTING_RULE_BY_BUNDLE_TOKEN[bundleToken];
	if (!listingRule) {
		throw new Error(`download-artifacts-graph: no JSON-LD family listing rule for bundle '${bundleToken}'`);
	}
	return ({ treeRootPath, boltTriple }, callback) => {
		const bundleLibDirPath = path.join(treeRootPath, 'forges', bundleToken, 'lib');
		const forgeDeclaration = require(path.join(bundleLibDirPath, listingRule.forgeDeclarationModuleName));
		const vocabularyProfile = require(path.join(bundleLibDirPath, listingRule.vocabularyProfileFileName));
		const roundTripPair = require(path.join(treeRootPath, 'lib', 'ctdl-family-forge', 'jsonLdRoundTripPair'))({ vocabularyProfile, ruleModulePath: 'lib/ctdl-family-forge/jsonLdRoundTripPair.js' });
		const { openGraphReader } = require(path.join(treeRootPath, 'lib', 'forge-framework', 'roundTripHarness', 'graphReader'));
		openGraphReader({ boltUrl: boltTriple.boltUrl, user: boltTriple.user, password: boltTriple.password, standardSource: forgeDeclaration.standardSource }, (openError, reader) => {
			if (openError) {
				callback(`${bundleToken} listing: ${openError}`);
				return;
			}
			roundTripPair.emitFromGraph({ reader }, (emitError, emitted) => {
				reader.close((closeError) => {
					if (emitError || (emitted && emitted.fault !== undefined)) {
						callback(`${bundleToken} listing: ${emitError || JSON.stringify(emitted.fault)}`);
						return;
					}
					if (closeError) {
						callback(`${bundleToken} listing: ${closeError}`);
						return;
					}
					callback('', { statementMap: emitted.statements });
				});
			});
		});
	};
};

// ⟪nextStandards-102326 A3, 2026-10-23⟫ the OpenAPI kit's standards: ONE round-trip pair (lib/openapi-forge/openapiRoundTripPair.js) over each
// bundle's own openapi profile, built exactly as that bundle's roundTripValidator.js builds it; what differs per bundle is this table
const OPENAPI_KIT_LISTING_RULE_BY_BUNDLE_TOKEN = Object.freeze({
	openbadges: Object.freeze({ forgeDeclarationModuleName: 'openbadgesForgeDeclaration', openapiProfileFileName: 'openbadgesOpenapiProfile.json' }),
});

const openapiKitListingEmitterFor = ({ bundleToken }) => {
	const listingRule = OPENAPI_KIT_LISTING_RULE_BY_BUNDLE_TOKEN[bundleToken];
	if (!listingRule) {
		throw new Error(`download-artifacts-graph: no OpenAPI kit listing rule for bundle '${bundleToken}'`);
	}
	return ({ treeRootPath, boltTriple }, callback) => {
		const bundleLibDirPath = path.join(treeRootPath, 'forges', bundleToken, 'lib');
		const forgeDeclaration = require(path.join(bundleLibDirPath, listingRule.forgeDeclarationModuleName));
		const openapiProfile = require(path.join(bundleLibDirPath, listingRule.openapiProfileFileName));
		const roundTripPair = require(path.join(treeRootPath, 'lib', 'openapi-forge', 'openapiLayout')).roundTripPairFor({ openapiProfile, stableUriPropertyName: forgeDeclaration.stableUriPropertyName, ruleModulePath: 'lib/openapi-forge/openapiLayout.js' });
		const { openGraphReader } = require(path.join(treeRootPath, 'lib', 'forge-framework', 'roundTripHarness', 'graphReader'));
		openGraphReader({ boltUrl: boltTriple.boltUrl, user: boltTriple.user, password: boltTriple.password, standardSource: forgeDeclaration.standardSource }, (openError, reader) => {
			if (openError) {
				callback(`${bundleToken} listing: ${openError}`);
				return;
			}
			roundTripPair.emitFromGraph({ reader }, (emitError, emitted) => {
				reader.close((closeError) => {
					if (emitError || (emitted && emitted.fault !== undefined)) {
						callback(`${bundleToken} listing: ${emitError || JSON.stringify(emitted.fault)}`);
						return;
					}
					if (closeError) {
						callback(`${bundleToken} listing: ${closeError}`);
						return;
					}
					callback('', { statementMap: emitted.statements });
				});
			});
		});
	};
};

const statementListingEmitterByBundleToken = Object.freeze({
	sif260928: sif260928ListingEmitter,
	edfi: edfiListingEmitter,
	pescld: pescldListingEmitter,
	ctdl: jsonLdFamilyListingEmitterFor({ bundleToken: 'ctdl' }),
	ctdlasn: jsonLdFamilyListingEmitterFor({ bundleToken: 'ctdlasn' }),
	ctdlqdata: jsonLdFamilyListingEmitterFor({ bundleToken: 'ctdlqdata' }),
	openbadges: openapiKitListingEmitterFor({ bundleToken: 'openbadges' }),
});

module.exports = { installReadOnlyDriverGuard, statementListingEmitterByBundleToken };
