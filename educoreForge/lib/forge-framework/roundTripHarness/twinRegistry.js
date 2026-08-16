'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// twinRegistry.js — the twin registry CONTRACT (SPEC-forgeFramework-v1.md §10.3; RULING 23:12 #8;
// RISK §7.3), DATA keyed by gateId + conjunctId. Reused by the framework's own unit suite and by
// every forge's round-trip gates.
//
// Each entry: { gateId, conjunctId, twinName, leverKind, shippedConfig, run }
//   leverKind    'productionMutation' | 'inputFault' | 'expectationLever' — only the first two count
//                toward "every conjunct observed red"; an expectationLever twin is RECORDED and does
//                not satisfy the requirement (the PESC ledger's expectationLeverOnly lesson).
//   shippedConfig false → the twin needs a test-only override (MIGRATING_BUNDLE_LIST); reported as
//                such, and a sibling conjunct asserts the override is absent from shipped config.
//   run          (subject) → mutatedSubject — the injected fault, applied to a CLONE of the gate's
//                subject (production input or configuration), never to the gate's own expectation.
//
// auditRegistryAgainst({ gateDeclarationList }) → { missingList, orphanList } — a declared conjunct
// naming a twin (twinNameList) that is not registered is MISSING; a registered twin whose
// gateId+conjunctId no gate declares is ORPHANED (dead proof-code). Both are failures of the
// REQUIRED audit gate (G-SWEEP's twin: delete one implementation → missing).
//
// PURE registry: no I/O; the SWEEP that runs twins lives in gateEvaluator.js.

const LEVER_KIND_LIST = Object.freeze(['productionMutation', 'inputFault', 'expectationLever']);
const COUNTING_LEVER_KIND_LIST = Object.freeze(['productionMutation', 'inputFault']);

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const twinRefIdFor = ({ gateId, conjunctId, twinName }) => `${gateId}::${conjunctId}::${twinName}`;

const makeTwinRegistry = () => {
	const entryByRefId = {};

	const register = ({ gateId, conjunctId, twinName, leverKind, shippedConfig, run } = {}) => {
		if (typeof gateId !== 'string' || gateId.length === 0) {
			throw new Error(`${moduleName} REFUSED: twin registration lacks gateId — every twin names the gate it turns red`);
		}
		if (typeof conjunctId !== 'string' || conjunctId.length === 0) {
			throw new Error(`${moduleName} REFUSED: twin for ${gateId} lacks conjunctId — twins are keyed gateId + conjunct (G-SWEEP counts observed-red PER CONJUNCT)`);
		}
		if (typeof twinName !== 'string' || twinName.length === 0) {
			throw new Error(`${moduleName} REFUSED: twin for ${gateId}/${conjunctId} lacks twinName`);
		}
		if (LEVER_KIND_LIST.indexOf(leverKind) === -1) {
			throw new Error(`${moduleName} REFUSED: twin '${twinName}' (${gateId}/${conjunctId}) leverKind '${leverKind}' is not one of ${LEVER_KIND_LIST.join(', ')}`);
		}
		if (typeof shippedConfig !== 'boolean') {
			throw new Error(`${moduleName} REFUSED: twin '${twinName}' (${gateId}/${conjunctId}) shippedConfig must be a boolean — say whether the twin needs a test-only override`);
		}
		if (typeof run !== 'function') {
			throw new Error(`${moduleName} REFUSED: twin '${twinName}' (${gateId}/${conjunctId}) has no run(subject) implementation`);
		}
		const twinRefId = twinRefIdFor({ gateId, conjunctId, twinName });
		if (entryByRefId[twinRefId] !== undefined) {
			throw new Error(`${moduleName} REFUSED: twin '${twinName}' (${gateId}/${conjunctId}) is registered twice`);
		}
		entryByRefId[twinRefId] = Object.freeze({ gateId, conjunctId, twinName, leverKind, shippedConfig, run, twinRefId });
		return entryByRefId[twinRefId];
	};

	const entries = () => Object.keys(entryByRefId).map((oneRefId) => entryByRefId[oneRefId]);

	const entriesFor = ({ gateId, conjunctId }) =>
		entries().filter((oneEntry) => oneEntry.gateId === gateId && oneEntry.conjunctId === conjunctId);

	const auditRegistryAgainst = ({ gateDeclarationList } = {}) => {
		if (!Array.isArray(gateDeclarationList)) {
			throw new Error(`${moduleName} REFUSED: auditRegistryAgainst needs gateDeclarationList (an array)`);
		}
		const declaredConjunctRefIdSet = new Set();
		const missingList = [];
		gateDeclarationList.forEach((oneGate) => {
			(oneGate.conjunctList || []).forEach((oneConjunct) => {
				declaredConjunctRefIdSet.add(`${oneGate.gateId}::${oneConjunct.conjunctId}`);
				(oneConjunct.twinNameList || []).forEach((oneTwinName) => {
					if (entryByRefId[twinRefIdFor({ gateId: oneGate.gateId, conjunctId: oneConjunct.conjunctId, twinName: oneTwinName })] === undefined) {
						missingList.push(`${oneGate.gateId}/${oneConjunct.conjunctId}: '${oneTwinName}'`);
					}
				});
			});
		});
		const orphanList = entries()
			.filter((oneEntry) => !declaredConjunctRefIdSet.has(`${oneEntry.gateId}::${oneEntry.conjunctId}`))
			.map((oneEntry) => `${oneEntry.gateId}/${oneEntry.conjunctId}: '${oneEntry.twinName}'`);
		return { missingList, orphanList };
	};

	return { register, entries, entriesFor, auditRegistryAgainst };
};

module.exports = { makeTwinRegistry, LEVER_KIND_LIST, COUNTING_LEVER_KIND_LIST, twinRefIdFor, isPlainObject, moduleName };
