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

const moduleFunction =
	({ moduleName } = {}) =>
	({ storeAccess, standardDiscovery, pairBinding, vocabulary } = {}) => {
		const { xLog, commandLineParameters } = process.global;
		const { forgeStore } = storeAccess;
		const { pairSubjectText, versionKeyText, PAIR_GROUP_BLOCK_TYPE } = vocabulary;

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
			const binding = pairBinding.resolvePairBinding({
				roster,
				hubStandardName: pairMatch[1],
				spokeStandardName: pairMatch[2],
				warn: (message) => xLog.status(`[${moduleName}] ${message}`),
			});
			if (binding.error) {
				return { error: binding.error };
			}
			// the CALLER's key is authoritative for selection; discovery casing is
			// authoritative for the pair names (spec §4.1 / Q10).
			return {
				pairSubject: pairSubjectText(binding.pairA, binding.pairB),
				versionKey: versionKeyText(keyMatch[1], keyMatch[2]),
				pairA: binding.pairA,
				pairAVersion: keyMatch[1],
				pairB: binding.pairB,
				pairBVersion: keyMatch[2],
				publishedVersionA: binding.publishedVersionA,
				publishedVersionB: binding.publishedVersionB,
			};
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

		// validateMemberList — every member exists, is type 'mapping', and is filed under
		// exactly this pair@versionKey (the -validateGroup contract applied at mint time).
		const validateMemberList = ({ members, pairSubject, versionKey }, callback) => {
			const sub = new taskListPlus();
			members.forEach((oneBlockId) => {
				sub.push((a2, n2) => {
					forgeStore.getBlockMeta({ blockId: oneBlockId }, (err, blockMeta) => {
						if (err) {
							n2(err);
							return;
						}
						if (!blockMeta) {
							n2(`member ${oneBlockId} does not exist`);
							return;
						}
						if (blockMeta.type !== 'mapping') {
							n2(`member ${oneBlockId} is type '${blockMeta.type}', not 'mapping'`);
							return;
						}
						if (blockMeta.subject !== pairSubject || blockMeta.version !== versionKey) {
							n2(
								`member ${oneBlockId} is filed under '${blockMeta.subject}'@'${blockMeta.version}', ` +
									`not '${pairSubject}'@'${versionKey}'`,
							);
							return;
						}
						n2('', a2);
					});
				});
			});
			pipeRunner(sub.getList(), {}, (err) => callback(err || ''));
		};

		// composePairGroupText — the D4 canonical two-line PG-JSONL. Deterministic: fixed
		// header field order, members sorted ascending. (Composed directly — the pairGroup
		// block never enters the replay path, so it does not use replay-block's serializer.)
		const composePairGroupText = ({ parsed, members, displayName }) => {
			const headerLine = JSON.stringify({
				kind: 'header',
				blockType: PAIR_GROUP_BLOCK_TYPE,
				serializerVersion: '1',
				pairA: parsed.pairA,
				pairAVersion: parsed.pairAVersion,
				pairB: parsed.pairB,
				pairBVersion: parsed.pairBVersion,
				publishedVersionA: parsed.publishedVersionA,
				publishedVersionB: parsed.publishedVersionB,
				displayName,
			});
			const contentLine = JSON.stringify({
				kind: 'pairGroupContent',
				members: [...members].sort(),
				versionKey: parsed.versionKey,
			});
			return `${headerLine}\n${contentLine}\n`;
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
				validateMemberList({ members: args.members, ...parsed }, (err) => next(err, args));
			});

			taskList.push((args, next) => {
				// §6.3 default displayName: formal name + mint date; freely overridable.
				const displayName =
					joinedParam('displayName', null) ||
					`${parsed.pairSubject} @ ${parsed.versionKey} — minted ${new Date().toISOString().slice(0, 10)}`;
				const text = composePairGroupText({ parsed, members: args.members, displayName });
				forgeStore.saveBlock(
					{
						type: PAIR_GROUP_BLOCK_TYPE,
						subject: parsed.pairSubject,
						version: parsed.versionKey,
						requires: args.members, // a group depends on exactly its members
						text,
						producedBy: 'forgeManager:mintPairGroup',
					},
					(err, result) =>
						next(err, { ...args, groupBlockId: result ? result.blockId : null, displayName }),
				);
			});

			taskList.push((args, next) => {
				forgeStore.advancePairGroupPointer(
					{
						pairSubject: parsed.pairSubject,
						versionKey: parsed.versionKey,
						groupBlockId: args.groupBlockId,
						note: note || `mint: ${args.displayName}`,
					},
					(err) => next(err, args),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					action: 'mintPairGroup',
					pairSubject: parsed.pairSubject,
					versionKey: parsed.versionKey,
					groupBlockId: args.groupBlockId,
					displayName: args.displayName,
					memberCount: args.members.length,
					members: args.members,
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
