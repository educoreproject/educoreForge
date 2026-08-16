'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// moduleDouble.js — TEST SUPPORT: compile a framework module IN MEMORY with named textual mutations
// applied, so a productionMutation twin can fault the FRAMEWORK'S OWN CODE (remove the adapter, drop
// a refusal, rename the pure export) without writing a file into the tree. Nothing regenerated is
// tracked (Profile §12) because nothing is written at all.
//
//   loadWithMutations({ modulePath, mutationList: [{ modulePath, find, replace }] }) → the module's exports
//
// A mutated module is compiled with Node's own wrapper and given a `require` that resolves RELATIVE
// requires: every RELATIVE sibling is compiled through the same double (mutated or not), so a mutation
// anywhere in the framework's require graph is reached; absolute requires (tree libs, node_modules)
// load for real. Every `find` MUST match exactly once, or the double refuses: a mutation that matched
// nothing would silently prove nothing.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');

const loadWithMutations = ({ modulePath, mutationList } = {}) => {
	if (typeof modulePath !== 'string' || !fs.existsSync(modulePath)) {
		throw new Error(`${moduleName} REFUSED: modulePath '${modulePath}' is not on disk`);
	}
	if (!Array.isArray(mutationList) || mutationList.length === 0) {
		throw new Error(`${moduleName} REFUSED: mutationList must be a non-empty list of { modulePath, find, replace }`);
	}
	const mutationsByPath = {};
	mutationList.forEach((oneMutation) => {
		const absolutePath = path.resolve(oneMutation.modulePath);
		(mutationsByPath[absolutePath] = mutationsByPath[absolutePath] || []).push(oneMutation);
	});
	const compiledByPath = {};

	const compileMutated = (absolutePath) => {
		if (compiledByPath[absolutePath] !== undefined) {
			return compiledByPath[absolutePath];
		}
		let sourceText = fs.readFileSync(absolutePath, 'utf8');
		(mutationsByPath[absolutePath] || []).forEach((oneMutation) => {
			const matchCount = sourceText.split(oneMutation.find).length - 1;
			if (matchCount !== 1) {
				throw new Error(`${moduleName} REFUSED: mutation find-text matched ${matchCount} times in ${path.basename(absolutePath)} (must match exactly once): ${JSON.stringify(oneMutation.find).slice(0, 160)}`);
			}
			sourceText = sourceText.replace(oneMutation.find, () => oneMutation.replace);
		});
		const doubleModule = new Module(absolutePath, module);
		doubleModule.filename = absolutePath;
		doubleModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
		const doubleRequire = (requestPath) => {
			if (requestPath.startsWith('.')) {
				// a RELATIVE require is a framework sibling: compiled through the double too, so a
				// mutation two levels down (registry ← contract ← framework) is reached
				return compileMutated(require.resolve(path.resolve(path.dirname(absolutePath), requestPath)));
			}
			if (requestPath.startsWith('/')) {
				const resolvedPath = require.resolve(requestPath);
				return mutationsByPath[resolvedPath] !== undefined ? compileMutated(resolvedPath) : require(resolvedPath);
			}
			return doubleModule.require(requestPath);
		};
		const wrapped = Module.wrap(sourceText);
		const compiledWrapper = vm.runInThisContext(wrapped, { filename: absolutePath });
		compiledWrapper.call(doubleModule.exports, doubleModule.exports, doubleRequire, doubleModule, absolutePath, path.dirname(absolutePath));
		compiledByPath[absolutePath] = doubleModule.exports;
		return doubleModule.exports;
	};

	const rootPath = path.resolve(modulePath);
	if (mutationsByPath[rootPath] === undefined) {
		// the root itself is unmutated but must see mutated siblings — compile it too
		mutationsByPath[rootPath] = [];
	}
	return compileMutated(rootPath);
};

module.exports = { loadWithMutations, moduleName };
