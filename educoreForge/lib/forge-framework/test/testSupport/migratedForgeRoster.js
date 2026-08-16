'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// migratedForgeRoster.js — TEST SUPPORT DATA: which of the four MIGRATING bundles (SPEC-forgeFramework-v1.md
// §7.1 MIGRATING_BUNDLE_LIST) are ALREADY on the framework, and which of their files are the H1/H2/H3
// hook files the static gates read (G-SHARE's "no re-implementation in a hook file", G-NOSUB's lexical
// sweeps) and which directories hold their tests (G-SHARE's ≥1-caller corpus, FR20 / FA6). ONE list, so
// two gates cannot disagree about what "a hook file" is. Each migration commit adds its row:
//   F3b edfi (AMBER_TRAIL, 2026-08-16); F3c sif; F3d pesc260805 / ceds.
//
// The round-trip validator file is NOT listed as a hook file until a forge's validator is expressed
// behind the harness's validatorFrom (Ed-Fi's is not, F3b — SABLE_RIVER ruling 03:20 #4: "the
// migration is the forge, not the validator"); its loaders / parsers are loader code the hooks require,
// not hook files (FR14: C7/E5 live there and are NOT discharged by migration).

const fs = require('fs');
const path = require('path');

const FORGES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'forges');

const MIGRATED_FORGE_ROSTER = Object.freeze([
	Object.freeze({
		standardKey: 'edfi',
		migratedBy: 'F3b AMBER_TRAIL 2026-08-16',
		declarationRelativePath: 'lib/edfiForgeDeclaration.js', // H1 — G-COMPAT's live count reader (FB3)
		hookFileRelativePathList: Object.freeze([
			'forgeEdfi.js', // the one-line entry
			'lib/edfiForgeDeclaration.js', // H1
			'lib/edfiHooks.js', // H2/H3
			'lib/forgeEdfiContractGraph.js', // the walk (H3)
		]),
		testDirRelativePathList: Object.freeze(['test']),
	}),
]);

const readTextList = ({ standardKey, hookFileRelativePathList }) =>
	hookFileRelativePathList.map((oneRelative) => {
		const filePath = path.join(FORGES_DIR, standardKey, oneRelative);
		if (!fs.existsSync(filePath)) {
			throw new Error(`${moduleName} REFUSED: migrated forge '${standardKey}' hook file '${oneRelative}' is not on disk at ${filePath} — the roster and the tree disagree`);
		}
		return { fileName: `forges/${standardKey}/${oneRelative}`, text: fs.readFileSync(filePath, 'utf8') };
	});

// migratedForgeHookSourceList() → [{ fileName, text }] for every migrated forge's hook files
const migratedForgeHookSourceList = () => MIGRATED_FORGE_ROSTER.reduce((soFar, oneForge) => soFar.concat(readTextList(oneForge)), []);

// migratedForgeCallerCorpusPathList() → every .js under each migrated forge's bundle (entry, lib, tests)
const migratedForgeCallerCorpusPathList = () => {
	const pathList = [];
	const walk = (dirPath) =>
		fs.readdirSync(dirPath, { withFileTypes: true }).forEach((oneEntry) => {
			const fullPath = path.join(dirPath, oneEntry.name);
			if (oneEntry.isDirectory()) {
				if (oneEntry.name === 'assets' || oneEntry.name === 'node_modules') {
					return;
				}
				walk(fullPath);
				return;
			}
			if (/\.js$/.test(oneEntry.name)) {
				pathList.push(fullPath);
			}
		});
	MIGRATED_FORGE_ROSTER.forEach((oneForge) => walk(path.join(FORGES_DIR, oneForge.standardKey)));
	return pathList;
};

// migratedForgeDeclarationFor(standardKey) → the REAL H1 declaration object of a migrated forge (required fresh from the tree)
const migratedForgeDeclarationFor = (standardKey) => {
	const oneForge = MIGRATED_FORGE_ROSTER.find((candidate) => candidate.standardKey === standardKey);
	if (!oneForge) {
		throw new Error(`${moduleName} REFUSED: '${standardKey}' is not a migrated forge in the roster (${MIGRATED_FORGE_ROSTER.map((candidate) => candidate.standardKey).join(', ')})`);
	}
	return require(path.join(FORGES_DIR, standardKey, oneForge.declarationRelativePath));
};

module.exports = { MIGRATED_FORGE_ROSTER, FORGES_DIR, migratedForgeHookSourceList, migratedForgeCallerCorpusPathList, migratedForgeDeclarationFor, moduleName };
