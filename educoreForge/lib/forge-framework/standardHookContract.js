'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// standardHookContract.js — STANDARD_HOOK_CONTRACT and its table-driven validator
// (SPEC-forgeFramework-v1.md §5). The hook set is the METHODS a forge author injects:
//   sourceLoaderList   H2 — N loaders run serially; parsed = { [loaderName]: loaded }
//   describeSource     PURE — ({ parsed }) → { version, selfDescribedVersion, sourceFormat, sourceFiles, sourceUrl }
//   emitContractGraph  H3 — PURE walk ({ parsed, metadata, kit }) → { nodes, edges, stats, sequenceGroups?, ...reports }
//   describeRoot       PURE — ({ parsed, metadata }) → { description?, extraProperties? }
// The round-trip pair (H4) is validated by the HARNESS's validatorFrom, not here (SPEC §5.4).
//
// Refused BY NAME at injection, before any I/O (SPEC §5.2): missing required hook; unknown hook
// name (a typo must not become a silently ignored hook); wrong kind; wrong arity (load 2, the
// pure hooks 1); a sourceLoaderList entry missing loaderName or load; duplicate loaderName;
// loaderName 'metadata' (it would shadow the framework's). Validation is a table walk.

const refuse = require('./refuse');

const RESERVED_LOADER_NAME_LIST = Object.freeze(['metadata']);
// the loader-name CONVENTION (uniform across bundles; the NAMES are each forge's own): lowerCamelCase,
// letters and digits only. Refused by name below.
const LOADER_NAME_RE = /^[a-z][A-Za-z0-9]*$/;

const STANDARD_HOOK_CONTRACT = Object.freeze({
	sourceLoaderList: Object.freeze({
		required: true,
		kind: 'loaderList',
		calledFrom: 'orchestration',
		signature: 'load({ sourcePath, additionalSourceInputPathByName, xLog }, callback(errString, loaded))',
		returns: 'loaded (assembled as parsed[loaderName])',
	}),
	describeSource: Object.freeze({
		required: true,
		kind: 'function',
		arity: 1,
		calledFrom: 'orchestration (pure)',
		signature: '({ parsed }) => { version, selfDescribedVersion, sourceFormat, sourceFiles, sourceUrl }',
		returns: 'the five source-read keys (P2 adds the stamp triple)',
	}),
	emitContractGraph: Object.freeze({
		required: true,
		kind: 'function',
		arity: 1,
		calledFrom: 'pure layer (inside the adapter)',
		signature: '({ parsed, metadata, kit }) => { nodes, edges, stats, sequenceGroups?, ...standardSpecificReports }',
		returns: "the kit's collected arrays in emission order",
	}),
	describeRoot: Object.freeze({
		required: true,
		kind: 'function',
		arity: 1,
		calledFrom: 'pure layer',
		signature: '({ parsed, metadata }) => { description?, extraProperties? }',
		returns: 'the per-standard root description; extraProperties only under an allowance',
	}),
});

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const KIND_CHECKER_REGISTRY = Object.freeze({
	function: (value, { contractEntry }) => {
		if (typeof value !== 'function') {
			return `must be a function (got ${value === null ? 'null' : typeof value})`;
		}
		if (value.length !== contractEntry.arity) {
			return `must have arity ${contractEntry.arity} (got ${value.length}); the signature is ${contractEntry.signature}`;
		}
		return '';
	},
	loaderList: (value) => {
		if (!Array.isArray(value) || value.length === 0) {
			return `must be a non-empty list of { loaderName, load } (got ${JSON.stringify(value)})`;
		}
		const seenNames = {};
		for (let entryIndex = 0; entryIndex < value.length; entryIndex++) {
			const oneEntry = value[entryIndex];
			if (!isPlainObject(oneEntry)) {
				return `entry ${entryIndex} is not an object`;
			}
			if (typeof oneEntry.loaderName !== 'string' || oneEntry.loaderName.length === 0) {
				return `entry ${entryIndex} is missing loaderName`;
			}
			if (!LOADER_NAME_RE.test(oneEntry.loaderName)) {
				return `loaderName '${oneEntry.loaderName}' is not lowerCamelCase (the convention across every bundle: letters and digits, first letter lower — e.g. metaEdModel)`;
			}
			if (RESERVED_LOADER_NAME_LIST.indexOf(oneEntry.loaderName) !== -1) {
				return `loaderName '${oneEntry.loaderName}' is reserved (it would shadow the framework's ${oneEntry.loaderName})`;
			}
			if (seenNames[oneEntry.loaderName]) {
				return `loaderName '${oneEntry.loaderName}' is declared twice`;
			}
			seenNames[oneEntry.loaderName] = true;
			if (typeof oneEntry.load !== 'function') {
				return `entry '${oneEntry.loaderName}' is missing load (a function)`;
			}
			if (oneEntry.load.length !== 2) {
				return `entry '${oneEntry.loaderName}' load must have arity 2 — load({ sourcePath, additionalSourceInputPathByName, xLog }, callback) (got ${oneEntry.load.length})`;
			}
			const unknownEntryNames = Object.keys(oneEntry).filter((oneName) => oneName !== 'loaderName' && oneName !== 'load');
			if (unknownEntryNames.length) {
				return `entry '${oneEntry.loaderName}' carries unknown property '${unknownEntryNames[0]}'`;
			}
		}
		return '';
	},
});

// validateHooks({ hooks }) → Error | null
const validateHooks = ({ hooks } = {}) => {
	if (!isPlainObject(hooks)) {
		return refuse.byName({
			moduleName,
			what: `hooks is ${hooks === null ? 'null' : Array.isArray(hooks) ? 'an array' : `a ${typeof hooks}`}`,
			where: 'injectStandardHooks({ forgeDeclaration, hooks }) needs the H2–H4 hook set object',
		});
	}
	const contractNames = Object.keys(STANDARD_HOOK_CONTRACT);
	const unknownName = Object.keys(hooks).find((oneName) => contractNames.indexOf(oneName) === -1);
	if (unknownName !== undefined) {
		return refuse.byName({
			moduleName,
			what: `hooks carries unknown hook '${unknownName}'`,
			where: `STANDARD_HOOK_CONTRACT names ${contractNames.join(', ')}; remove or rename it`,
		});
	}
	for (let nameIndex = 0; nameIndex < contractNames.length; nameIndex++) {
		const hookName = contractNames[nameIndex];
		const contractEntry = STANDARD_HOOK_CONTRACT[hookName];
		const value = hooks[hookName];
		if (value === undefined) {
			if (contractEntry.required) {
				return refuse.byName({
					moduleName,
					what: `hooks is missing required hook '${hookName}'`,
					where: `inject ${hookName}: ${contractEntry.signature}`,
				});
			}
			continue;
		}
		const reason = KIND_CHECKER_REGISTRY[contractEntry.kind](value, { contractEntry });
		if (reason !== '') {
			return refuse.byName({
				moduleName,
				what: `hook '${hookName}' ${reason}`,
				where: `fix ${hookName} in the hook set`,
			});
		}
	}
	return null;
};

module.exports = { STANDARD_HOOK_CONTRACT, RESERVED_LOADER_NAME_LIST, validateHooks, moduleName };
