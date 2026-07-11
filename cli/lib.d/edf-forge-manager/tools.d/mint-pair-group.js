'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// mint-pair-group.js — forgeManager's PAIR-GROUP MINTING + RESOLUTION verbs (BINDING spec
// §5.5/§5.6/§7.2, pairwiseVersionSwitching Phase C work item 4).
//
//   -mintPairGroup    --pair=CEDS::SIF --versionKey=(01,01) [--members=<id>,...]
//                     [--displayName=<text>] [--note=<text>]
//   -resolvePairGroup --pair=CEDS::SIF --versionKey=(01,01) [--history]
//
// MINT-AND-REPOINT (TQ's overwrite semantics, §5.6): minting saves the canonical pairGroup
// block (dedup by content address) and ADVANCES the currentPairGroup pointer — a logical
// overwrite. Prior generations stay in the blocks table but are INVISIBLE: symbolic
// resolution returns ONLY the current group; --history (the one door) shows the pointer
// log's generations with their notes.
//
// MEMBERSHIP (§5.4): all of the pair's mapping-tier blocks at that version key — default
// = the store query (type='mapping', subject=pair, version=versionKey); an explicit
// --members list overrides (it is validated to the same contract). Provenance is never
// merged; members stay distinct blocks.
//
// This is store BOOKKEEPING in forgeManager's publish/rollback class — no component CLI
// owns the pointer. No domain logic; no LLM anywhere near this path.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// the ONE mint-and-repoint code path (Phase D ruling D-D1) — shared with manifestEditor
// -defineGroup; validate/compose/save/advance all live there, never here.
const pairGroupMintFactory = require('../../../../npm/qtools-graph-forge-core/lib/pair-group-mint/pair-group-mint');

const moduleFunction =
	({ moduleName } = {}) =>
	({ storeAccess, standardDiscovery, pairBinding, vocabulary } = {}) => {
		const { xLog, commandLineParameters } = process.global;
		const { forgeStore } = storeAccess;
		const { mintPairGroupIntoStore } = pairGroupMintFactory({});

		const strParam = (name, dflt) => {
			const values = commandLineParameters.values[name];
			return values && values.length ? values[0] : dflt;
		};
		// joinedParam — for free-text values that may legitimately CONTAIN commas
		// (displayName, note): qtools-parse-command-line splits comma values into array
		// elements; rejoin so the operator's text survives intact.
		const joinedParam = (name, dflt) => {
			const values = commandLineParameters.values[name];
			return values && values.length ? values.join(',') : dflt;
		};
		const listParam = (name) => {
			const values = commandLineParameters.values[name];
			if (!values || !values.length) return [];
			return values
				.flatMap((oneValue) => `${oneValue}`.split(','))
				.map((oneValue) => oneValue.trim())
				.filter((oneValue) => oneValue.length > 0);
		};

		// parsePairAndKey — '--pair=A::B' + '--versionKey=(a,b)' -> the four components,
		// validated against discovery (loud, never a guess).
		// NOTE: qtools-parse-command-line splits comma-separated values into array elements,
		// so '(01,01)' arrives as ['(01','01)'] — rejoined here before parsing.
		const parsePairAndKey = () => {
			const pairText = strParam('pair', null);
			const versionKeyValues = commandLineParameters.values.versionKey;
			const versionKeyRaw =
				versionKeyValues && versionKeyValues.length ? versionKeyValues.join(',') : null;
			if (!pairText || !versionKeyRaw) {
				return { error: `--pair=A::B and --versionKey=(a,b) are both required` };
			}
			const pairMatch = `${pairText}`.match(/^([^:]+)::([^:]+)$/);
			if (!pairMatch) {
				return { error: `--pair '${pairText}' is not canonical A::B form` };
			}
			const keyMatch = `${versionKeyRaw}`.match(/^\(([^,()]+),([^,()]+)\)$/);
			if (!keyMatch) {
				return { error: `--versionKey '${versionKeyRaw}' is not canonical (a,b) form` };
			}
			const roster = standardDiscovery.roster({ includeSynthetic: true });
			// the CALLER's key is authoritative for selection; discovery casing is
			// authoritative for the pair names (spec §4.1 / Q10); each side's
			// publishedVersion stamps from the CHOSEN snapshot's provenance (Phase D —
			// a non-default snapshot must never inherit the default's version string).
			// --hubBundleDir (optional, D-D5 rider 3): the synthetic flows pass it so a
			// p6hub-derived group header stamps p6hub's own provenance.
			const binding = pairBinding.resolvePairBindingAtVersions({
				roster,
				hubStandardName: pairMatch[1],
				spokeStandardName: pairMatch[2],
				aVersion: keyMatch[1],
				bVersion: keyMatch[2],
				preferredHubBundleDir: strParam('hubBundleDir', null),
				warn: (message) => xLog.status(`[${moduleName}] ${message}`),
			});
			if (binding.error) {
				return { error: binding.error };
			}
			return binding;
		};

		// memberRowsForPair — the §5.4 default membership: every type='mapping' block filed
		// under the pair at the version key (store query, deterministic order by blockId).
		const memberRowsForPair = ({ pairSubject, versionKey }, callback) => {
			storeAccess.listBlocks((err, rows) => {
				if (err) {
					callback(err);
					return;
				}
				const members = (rows || [])
					.filter(
						(oneRow) =>
							oneRow.type === 'mapping' &&
							oneRow.subject === pairSubject &&
							oneRow.version === versionKey,
					)
					.map((oneRow) => oneRow.blockId)
					.sort();
				callback('', members);
			});
		};

		// --- ACTION: -mintPairGroup --------------------------------------------------------
		const mintPairGroup = (callback) => {
			const parsed = parsePairAndKey();
			if (parsed.error) {
				callback(`-mintPairGroup: ${parsed.error}`);
				return;
			}
			const explicitMembers = listParam('members');
			const note = joinedParam('note', null);

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				storeAccess.open((err) => next(err, args));
			});

			taskList.push((args, next) => {
				if (explicitMembers.length > 0) {
					next('', { ...args, members: [...explicitMembers].sort() });
					return;
				}
				memberRowsForPair(parsed, (err, members) =>
					next(err, { ...args, members }),
				);
			});

			taskList.push((args, next) => {
				if (args.members.length === 0) {
					next(
						`-mintPairGroup: no mapping blocks are filed under ${parsed.pairSubject}@${parsed.versionKey} ` +
							`— produce or transform the pair's blocks first (§7.2); an empty group is never minted`,
					);
					return;
				}
				// the ONE mint-and-repoint path (D-D1): validate → compose → save → advance.
				mintPairGroupIntoStore(
					{
						forgeStore,
						...parsed,
						members: args.members,
						displayName: joinedParam('displayName', null),
						note,
						producedBy: 'forgeManager:mintPairGroup',
					},
					(err, minted) => next(err, { ...args, minted }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					action: 'mintPairGroup',
					...args.minted,
				});
			});
		};

		// --- ACTION: -resolvePairGroup -----------------------------------------------------
		// the symbolic pair@versionKey face: CURRENT only; --history is the one door to
		// superseded generations (§5.6). Resolution failures are LOUD (G-C5) — the store
		// primitive names a corrupt pointer and never silently recovers.
		const resolvePairGroup = (callback) => {
			const parsed = parsePairAndKey();
			if (parsed.error) {
				callback(`-resolvePairGroup: ${parsed.error}`);
				return;
			}
			const wantHistory = !!commandLineParameters.switches.history;

			const taskList = new taskListPlus();
			taskList.push((args, next) => {
				storeAccess.open((err) => next(err, args));
			});
			taskList.push((args, next) => {
				forgeStore.resolveCurrentPairGroup(
					{ pairSubject: parsed.pairSubject, versionKey: parsed.versionKey },
					(err, resolved) => next(err, { ...args, resolved }),
				);
			});
			taskList.push((args, next) => {
				if (!wantHistory) {
					next('', { ...args, history: null });
					return;
				}
				forgeStore.pairGroupHistory(
					{ pairSubject: parsed.pairSubject, versionKey: parsed.versionKey },
					(err, history) => next(err, { ...args, history }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const groupContentLine = `${args.resolved.block.text}`.split('\n')[1];
				callback('', {
					action: 'resolvePairGroup',
					pairSubject: parsed.pairSubject,
					versionKey: parsed.versionKey,
					currentGroupBlockId: args.resolved.groupBlockId,
					group: JSON.parse(groupContentLine),
					...(args.history ? { history: args.history } : {}),
				});
			});
		};

		return { mintPairGroup, resolvePairGroup };
	};

module.exports = moduleFunction({ moduleName });
