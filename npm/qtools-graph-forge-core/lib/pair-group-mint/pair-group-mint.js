#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pair-group-mint — THE ONE mint-and-repoint code path (BINDING spec §5.5/§5.6; Phase D
// ruling D-D1): validate the member list to the §5.4 contract, compose the canonical
// two-line pairGroup text (vocabulary.composePairGroupText — the D4 form), save the block
// (choke-validated by forge-store), and ADVANCE the CURRENT pointer. Both group-creating
// verbs — forgeManager -mintPairGroup and manifestEditor -defineGroup — consume THIS
// function; divergent advance logic is structurally impossible.
//
// The caller supplies a RESOLVED pair binding (pair names in discovery casing, version
// key components, published versions) and an EXPLICIT member list; member defaulting
// (the store query) stays with the caller that wants it. producedBy stamps the honest
// emitting tool per caller — one path, honest authorship.
//
// forgeStore is INJECTED already-init'd (the manifest-editor DI precedent): this module
// holds no db handle and owns no table/file names.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const {
	composePairGroupText,
	PAIR_GROUP_BLOCK_TYPE,
	PAIR_GROUP_MEMBER_TYPES,
	isPairGroupMemberType,
} = require('../vocabulary/vocabulary');

const moduleFunction =
	({ moduleName } = {}) =>
	({ unused } = {}) => {
		// validateMemberList — every member exists, is a pair-group member type
		// (vocabulary.isPairGroupMemberType: mapping ∪ structuralBridge — S1.2,
		// forgeArchitectureRefactor), and is filed under exactly this pair@versionKey
		// (the -validateGroup contract applied at mint time).
		const validateMemberList = (
			{ forgeStore, members, pairSubject, versionKey },
			callback,
		) => {
			const taskList = new taskListPlus();
			members.forEach((oneBlockId) => {
				taskList.push((args, next) => {
					forgeStore.getBlockMeta({ blockId: oneBlockId }, (err, blockMeta) => {
						if (err) {
							next(err, args);
							return;
						}
						if (!blockMeta) {
							next(`member ${oneBlockId} does not exist`, args);
							return;
						}
						if (!isPairGroupMemberType(blockMeta.type)) {
							next(
								`member ${oneBlockId} is type '${blockMeta.type}', not a pair-group ` +
									`member type [${PAIR_GROUP_MEMBER_TYPES.join(', ')}]`,
								args,
							);
							return;
						}
						if (
							blockMeta.subject !== pairSubject ||
							blockMeta.version !== versionKey
						) {
							next(
								`member ${oneBlockId} is filed under '${blockMeta.subject}'@'${blockMeta.version}', ` +
									`not '${pairSubject}'@'${versionKey}'`,
								args,
							);
							return;
						}
						next('', args);
					});
				});
			});
			pipeRunner(taskList.getList(), {}, (err) => callback(err || ''));
		};

		// mintPairGroupIntoStore — the working function. An empty group is NEVER minted.
		const mintPairGroupIntoStore = (
			{
				forgeStore,
				pairA,
				pairAVersion,
				pairB,
				pairBVersion,
				publishedVersionA,
				publishedVersionB,
				pairSubject,
				versionKey,
				members = [],
				displayName,
				note,
				producedBy,
			},
			callback,
		) => {
			if (!members.length) {
				callback(
					`${moduleName}: no members supplied for ${pairSubject}@${versionKey} ` +
						`— produce or transform the pair's blocks first (§7.2); an empty group is never minted`,
				);
				return;
			}

			const sortedMembers = [...members].sort();
			// §6.3 default displayName: formal name + mint date; freely overridable.
			const effectiveDisplayName =
				displayName ||
				`${pairSubject} @ ${versionKey} — minted ${new Date().toISOString().slice(0, 10)}`;

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				validateMemberList(
					{ forgeStore, members: sortedMembers, pairSubject, versionKey },
					(err) => next(err, args),
				);
			});

			taskList.push((args, next) => {
				const text = composePairGroupText({
					pairA,
					pairAVersion,
					pairB,
					pairBVersion,
					publishedVersionA,
					publishedVersionB,
					displayName: effectiveDisplayName,
					members: sortedMembers,
					versionKey,
				});
				forgeStore.saveBlock(
					{
						type: PAIR_GROUP_BLOCK_TYPE,
						subject: pairSubject,
						version: versionKey,
						requires: sortedMembers, // a group depends on exactly its members
						text,
						producedBy,
					},
					(err, result) =>
						next(err, {
							...args,
							groupBlockId: result ? result.blockId : null,
						}),
				);
			});

			taskList.push((args, next) => {
				forgeStore.advancePairGroupPointer(
					{
						pairSubject,
						versionKey,
						groupBlockId: args.groupBlockId,
						note: note || `mint: ${effectiveDisplayName}`,
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
					pairSubject,
					versionKey,
					groupBlockId: args.groupBlockId,
					displayName: effectiveDisplayName,
					memberCount: sortedMembers.length,
					members: sortedMembers,
				});
			});
		};

		return { mintPairGroupIntoStore, validateMemberList };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
