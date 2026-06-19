'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// mapping-instruction.js — the generic reader for a standard's declarative mappingInstruction.
//
// The forge DECLARES mappingInstruction on the standard's DmeStandardRoot; the bridgeMakers
// RESOLVE it (DECISIONS-firstApp §12, DESIGN §F). This is the ONLY place per-standard behavior
// enters the bridge layer, and it does so as DATA, never as code — there is no per-standard branch
// anywhere in edf-bridge.
//
// The six declarative fields (DESIGN §F):
//   cedsOriginalAnchorPropertyName        [array]  native property holding the element-level CEDS ref
//   cedsOptionOriginalAnchorPropertyName  [array]  native property holding the value-level CEDS ref
//   crosswalkPrefix                       [array]  external aliases by which crosswalks name this std
//   crosswalkResolveProperty              string   default 'stableUriPropertyName'
//   includeInImplied                      bool     default true
//   impliedTargets                        [array]  default ['CEDS']
//
// The forge stores mappingInstruction as a JSON string property on DmeStandardRoot (crossRefs is a
// JSON property too, §9). We parse it; absence yields documented defaults. The maker resolves on the
// canonical cedsId/cedsOptionId the forge wrote (NOT the native anchor property) — the anchor
// property names are read only to KNOW the origin, per DESIGN §F.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// pure: apply documented defaults over whatever the forge declared.
const withDefaults = (raw) => {
	const instruction = raw && typeof raw === 'object' ? raw : {};
	return {
		cedsOriginalAnchorPropertyName: Array.isArray(instruction.cedsOriginalAnchorPropertyName)
			? instruction.cedsOriginalAnchorPropertyName
			: [],
		cedsOptionOriginalAnchorPropertyName: Array.isArray(
			instruction.cedsOptionOriginalAnchorPropertyName,
		)
			? instruction.cedsOptionOriginalAnchorPropertyName
			: [],
		crosswalkPrefix: Array.isArray(instruction.crosswalkPrefix)
			? instruction.crosswalkPrefix
			: [],
		crosswalkResolveProperty:
			typeof instruction.crosswalkResolveProperty === 'string'
				? instruction.crosswalkResolveProperty
				: 'stableUriPropertyName',
		includeInImplied:
			instruction.includeInImplied === undefined ? true : !!instruction.includeInImplied,
		impliedTargets: Array.isArray(instruction.impliedTargets)
			? instruction.impliedTargets
			: ['CEDS'],
	};
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		// readForScope — { graphName, scope } -> { instruction, rootFound }. Reads the
		// mappingInstruction JSON property off the scope standard's DmeStandardRoot. A missing root
		// or missing/blank property is NOT an error: it yields the documented defaults (a standard
		// the forge has not yet given a mappingInstruction simply bridges with default behavior).
		const readForScope = ({ graphName, scope }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (root:DmeStandardRoot)
							WHERE root._source = $scope OR root.standardKey = $scope OR root.name = $scope
							RETURN root.mappingInstruction AS mappingInstruction
							LIMIT 1
						`,
						params: { scope },
					},
					(err, result) => {
						if (err) {
							next(`mapping-instruction readForScope: ${err}`);
							return;
						}
						next('', { ...args, records: result.records });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const rootFound = args.records.length > 0;
				let raw = null;
				if (rootFound) {
					const value = args.records[0].mappingInstruction;
					if (typeof value === 'string' && value.trim().length > 0) {
						// JSON.parse can throw on malformed data; this is a genuine data-integrity
						// fault (a forge wrote bad JSON), so surface it as an error rather than
						// swallowing it — consistent with the no-silent-drop discipline.
						let parsed = null;
						let parseError = null;
						try {
							parsed = JSON.parse(value);
						} catch (jsonErr) {
							parseError = jsonErr;
						}
						if (parseError) {
							callback(
								`mapping-instruction readForScope: DmeStandardRoot for '${scope}' has malformed mappingInstruction JSON: ${parseError.message}`,
							);
							return;
						}
						raw = parsed;
					} else if (value && typeof value === 'object') {
						raw = value;
					}
				}
				callback('', { instruction: withDefaults(raw), rootFound });
			});
		};

		return { readForScope, withDefaults };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
