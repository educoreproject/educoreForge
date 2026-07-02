'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// productionGuard.js — refuse any BUILD/WRITE targeting the production golden (Phase 0, N1).
//
// instance-lifecycle already guards TEARDOWN (destroyInstanceByName refuses non-ephemeral/golden
// unless force===true). It does NOT guard build-into. This closes that gap: before the apparatus
// builds/replays into a destination, assertSafeBuildTarget consults the registry row and REFUSES if
// the target is the production golden — by registry `type === 'golden'` OR by a protected-name set
// (default {golden}, extensible via config). A target with no registry row yet (e.g. a fresh
// phase0a) is safe: it cannot be the existing golden.
//
// This is a fail-LOUD safety primitive: the apparatus calls it and aborts the build on refusal. It
// is deliberately conservative — it would rather refuse a legitimate build than permit one that
// could touch production.
//
// Async style: leaf is forgeStore.getGraphByName (callback). No async/await, no try/catch for
// control flow. camelCase.
//
// @concept: [[ProductionGuard]]
// @concept: [[IsolationInvariant]]

const DEFAULT_PROTECTED_NAMES = ['golden'];
const PROTECTED_TYPE = 'golden';

const moduleFunction =
	({ moduleName } = {}) =>
	({ forgeStore, protectedNames } = {}) => {
		const { xLog } = process.global;
		const protectedNameSet = new Set(
			(protectedNames && protectedNames.length
				? protectedNames
				: DEFAULT_PROTECTED_NAMES
			).map((oneName) => `${oneName}`),
		);

		// assertSafeBuildTarget({graphName}, cb) -> cb('') if safe to build into; cb(refusalMessage)
		// if it is (or resolves to) the production golden.
		const assertSafeBuildTarget = ({ graphName } = {}, callback) => {
			if (!graphName) {
				callback('productionGuard: graphName is required');
				return;
			}
			if (protectedNameSet.has(`${graphName}`)) {
				callback(
					`productionGuard REFUSED: '${graphName}' is a protected production graph name — ` +
						`the apparatus must build only into isolated scratch graphs (N1).`,
				);
				return;
			}
			forgeStore.getGraphByName({ name: graphName }, (err, graphRow) => {
				if (err) {
					callback(`productionGuard: registry read failed: ${err}`);
					return;
				}
				if (graphRow && `${graphRow.type}`.toLowerCase() === PROTECTED_TYPE) {
					callback(
						`productionGuard REFUSED: '${graphName}' has registry type '${graphRow.type}' ` +
							`(production golden) — building into it is forbidden in Phase 0 (N1).`,
					);
					return;
				}
				xLog.verbose(
					`[productionGuard] '${graphName}' cleared as a safe (non-golden) build target`,
				);
				callback('', { safe: true, graphName });
			});
		};

		// isProtectedName — pure predicate, exposed for tests + the suite's twin (a deliberate attempt
		// to build into golden must be refused).
		const isProtectedName = (graphName) => protectedNameSet.has(`${graphName}`);

		return { assertSafeBuildTarget, isProtectedName };
	};

module.exports = moduleFunction({ moduleName });
