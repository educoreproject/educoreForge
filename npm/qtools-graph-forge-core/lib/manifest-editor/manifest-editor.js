#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const qt = require('qtools-functional-library');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// pair-group member vocabulary (forgeArchitectureRefactor S1.2): the group-swap
// removes BOTH member kinds (mapping ∪ structuralBridge) under a re-selected pair —
// the shared predicate closes the silent-stale-structural-bridge hazard.
const {
	isPairGroupMemberType,
	STRUCTURAL_BRIDGE_BLOCK_TYPE,
} = require('../vocabulary/vocabulary');

// START OF moduleFunction() ============================================================
//
// manifest-editor — the compose-by-selection layer over forge-store (schemas.md §3,
// helpSpec.md). forge-store gives the immutable, content-addressed STORE primitives
// (saveBlock/saveManifest/getManifest/validateManifestClosure/deriveBuildOrder, all
// dedup-by-content); manifest-editor adds the SEMANTICS the store does not have:
//
//   - saveSchemaBlock : persist a schemaBlock, return its content-addressed blockId
//                       (idempotent; delegates to forge-store's dedup-on-blockId).
//   - combine         : compose a NEW immutable manifest from a base + a selection.
//                       Each --set block SUPERSEDES the base's block for its SUBJECT
//                       (a new standard version, a re-extracted relationships block)
//                       or ADDS a new subject. Nothing is mutated; the manifestKey is
//                       ALWAYS derived (content hash over canonical membership), so
//                       identical membership dedups for free and prior manifests are
//                       never destroyed. There is no swap operation — add-a-standard,
//                       re-extract-relationships, and version selection are all this
//                       one compose.
//   - validate        : bridge-closure law (delegates to forge-store).
//   - show            : a manifest's membership in derived build order.
//   - diff            : the block-membership delta between two manifests.
//
// SUPERSEDE IDENTITY. A --set block supersedes the base member sharing its
// (type, subject) pair — "for its subject", scoped by type so a standard block can
// never supersede a relationships block and vice versa. The default consolidated
// relationships block carries subject NULL, so re-extraction (type 'relationships',
// subject NULL) supersedes the single prior relationships block; future per-pair
// relationships blocks carry distinct subjects and supersede independently. When a
// set block supersedes an existing slot it INHERITS that slot's explicit position
// (a pin stays pinned); a brand-new subject takes derived order (position null).
//
// forge-store is INJECTED already-init'd (mirrors credential-accessor's DI): the
// responsible app opens + inits the store, then hands it here. manifest-editor holds
// no db handle and owns no table/file names — those live ONLY in forge-store.

const moduleFunction =
	({ moduleName } = {}) =>
	(injectedDeps = {}) => {
		const { forgeStore } = injectedDeps;

		// -----
		// supersedeKey — the (type, subject) identity a --set block supersedes on.
		//   NUL-delimited via the \x00 ESCAPE (addendum A2/BR1-2, 2026-07-16: the delimiter
		//   was a LITERAL NUL byte — binary-to-git, invisible in review — and this comment
		//   falsely claimed space-joining; the escape is byte-identical at runtime, and
		//   supersedeKey is an ephemeral in-memory Map key, never persisted). NUL is an
		//   unambiguous boundary: no block type or subject can contain it, so a subject
		//   cannot spoof a different (type, subject) pair.

		const supersedeKey = (blockMeta) =>
			`${blockMeta.type}\x00${blockMeta.subject == null ? '' : blockMeta.subject}`;

		// =====================================================================
		// SAVE — persist a schemaBlock, return its content-addressed blockId.
		// Pure delegation to forge-store (idempotent dedup-on-blockId lives there).
		// =====================================================================

		const saveSchemaBlock = (
			{ type, subject, version, requires, text, producedBy },
			callback,
		) => {
			forgeStore.saveBlock(
				{ type, subject, version, requires, text, producedBy },
				(err, result) => callback(err, err ? undefined : result),
			);
		};

		// =====================================================================
		// COMBINE — compose-by-selection into a NEW immutable manifest.
		// =====================================================================

		// groups (Phase D, spec §5.2/§8, ruling D-D2): each entry is a RESOLVED pair-group
		// descriptor { pairSubject, versionKey, groupBlockId, displayName, members:[blockIds] }.
		// Expansion enters the members EXPLICITLY (bypassing the (type,subject) supersede
		// map — a group's members share one (mapping, pairSubject) identity and would
		// otherwise collapse to a single survivor, the RECIPE §0B defect). A group's arrival
		// SWAPS its pair: base members of type 'mapping' filed under the group's pairSubject
		// are removed first (§11.7 — members selected together, never partially). Pair-subject
		// inferredDecision members are DELIBERATELY not swapped out (audit records, not
		// relationship content — supervisor rider of record). The manifest note gains a
		// provenance line naming each expanded group; the manifest records only the explicit
		// member blockIds, never the symbolic form (§5.6).
		const combine = ({ base, set = [], groups = [], label, note }, callback) => {
			const hasBase = base != null && base !== '';

			const taskList = new taskListPlus();

			// ---- load the base manifest membership (empty when composing a genesis manifest)
			taskList.push((args, next) => {
				if (!hasBase) {
					next('', { ...args, baseManifest: null, baseMembers: [] });
					return;
				}
				forgeStore.getManifest({ manifestKey: base }, (err, manifest) => {
					if (err) {
						next(err, args);
						return;
					}
					if (!manifest) {
						next(`combine: no base manifest '${base}' [${moduleName}]`, args);
						return;
					}
					next('', {
						...args,
						baseManifest: manifest,
						baseMembers: manifest.members || [],
					});
				});
			});

			// ---- load (type, subject) meta for every base member + every set block
			//      + every group member (unknown group members must surface loudly)
			taskList.push((args, next) => {
				const neededIds = [
					...args.baseMembers.map((oneMember) => oneMember.blockId),
					...set,
					...groups.flatMap((oneGroup) => oneGroup.members),
				];
				const uniqueIds = [...new Set(neededIds)];

				const blockTaskList = new taskListPlus();
				const blockMetaById = {};

				uniqueIds.forEach((blockId) => {
					blockTaskList.push((blockArgs, blockNext) => {
						forgeStore.getBlock({ blockId }, (err, row) => {
							if (err) {
								blockNext(err, blockArgs);
								return;
							}
							blockMetaById[blockId] = row; // null when the blockId is unknown
							blockNext('', blockArgs);
						});
					});
				});

				pipeRunner(blockTaskList.getList(), {}, (err) =>
					next(err, { ...args, blockMetaById }),
				);
			});

			// ---- compose: base members keyed by supersedeKey, then apply the selection
			taskList.push((args, next) => {
				const { baseMembers, blockMetaById } = args;

				const unknownSetBlocks = set.filter(
					(blockId) => !blockMetaById[blockId],
				);
				if (unknownSetBlocks.length > 0) {
					next(
						`combine: unknown blockId(s) in --set: ${unknownSetBlocks.join(', ')} [${moduleName}]`,
						args,
					);
					return;
				}

				const unknownGroupMembers = groups.flatMap((oneGroup) =>
					oneGroup.members.filter((blockId) => !blockMetaById[blockId]),
				);
				if (unknownGroupMembers.length > 0) {
					next(
						`combine: group member blockId(s) missing from the store: ${unknownGroupMembers.join(', ')} [${moduleName}]`,
						args,
					);
					return;
				}

				// a stored manifest referencing a vanished block is corrupt — fail loudly,
				// but collect every offender first so the pipeline callback fires exactly
				// once (a forEach that calls next() per offender can double-fire it).
				const missingBaseBlockIds = baseMembers
					.filter((oneMember) => !blockMetaById[oneMember.blockId])
					.map((oneMember) => oneMember.blockId);

				if (missingBaseBlockIds.length > 0) {
					next(
						`combine: base manifest references missing block(s): ${missingBaseBlockIds.join(', ')} [${moduleName}]`,
						args,
					);
					return;
				}

				const memberByKey = new Map();

				baseMembers.forEach((oneMember) => {
					const blockMeta = blockMetaById[oneMember.blockId];
					memberByKey.set(supersedeKey(blockMeta), {
						blockId: oneMember.blockId,
						position: oneMember.position == null ? null : oneMember.position,
					});
				});

				set.forEach((blockId) => {
					const key = supersedeKey(blockMetaById[blockId]);
					const existingSlot = memberByKey.get(key);
					memberByKey.set(key, {
						blockId,
						// inherit the superseded slot's explicit position; new subject => derived order
						position: existingSlot ? existingSlot.position : null,
					});
				});

				// ---- group swap + explicit expansion (D-D2; widened S1.2): remove each
				// swapped pair's member-kind blocks (mapping AND structuralBridge — the
				// shared isPairGroupMemberType predicate; §11.7 members selected together,
				// never partially) from the composed map, then append the groups' members
				// explicitly (never through the supersede map — same-(type,subject) members
				// must coexist). Pair-subject inferredDecision members are DELIBERATELY not
				// swapped out (audit records — the standing supervisor rider). Dedup by
				// blockId keeps a member listed once even when a --set entry or two groups
				// name it.
				const swappedPairSubjects = new Set(
					groups.map((oneGroup) => oneGroup.pairSubject),
				);
				if (swappedPairSubjects.size > 0) {
					[...memberByKey.entries()].forEach(([oneKey, oneSlot]) => {
						const blockMeta = blockMetaById[oneSlot.blockId];
						if (
							blockMeta &&
							isPairGroupMemberType(blockMeta.type) &&
							swappedPairSubjects.has(blockMeta.subject)
						) {
							memberByKey.delete(oneKey);
						}
					});
				}

				const members = [...memberByKey.values()];
				const presentBlockIds = new Set(members.map((oneSlot) => oneSlot.blockId));
				groups.forEach((oneGroup) => {
					oneGroup.members.forEach((oneBlockId) => {
						if (presentBlockIds.has(oneBlockId)) {
							return;
						}
						presentBlockIds.add(oneBlockId);
						members.push({ blockId: oneBlockId, position: null });
					});
				});

				next('', { ...args, members });
			});

			// ---- mint the new immutable manifest (manifestKey ALWAYS derived; dedup free)
			taskList.push((args, next) => {
				const effectiveLabel =
					label != null
						? label
						: args.baseManifest
							? args.baseManifest.label
							: null;

				// group provenance lines (§5.2): the manifest stores explicit members; the
				// note names the group(s) they were expanded from.
				const groupNoteLines = groups.map(
					(oneGroup) =>
						`group: ${oneGroup.pairSubject}@${oneGroup.versionKey} -> ${oneGroup.groupBlockId}` +
						(oneGroup.displayName ? ` (${oneGroup.displayName})` : ''),
				);
				const effectiveNote = [
					...(note != null && note !== '' ? [note] : []),
					...groupNoteLines,
				].join('\n');

				forgeStore.saveManifest(
					{
						label: effectiveLabel,
						basedOn: hasBase ? base : null,
						note: effectiveNote === '' ? note : effectiveNote,
						members: args.members,
					},
					(err, result) =>
						next(err, {
							...args,
							manifestKey: result ? result.manifestKey : undefined,
						}),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				callback(
					err,
					err
						? undefined
						: {
								manifestKey: args.manifestKey,
								memberCount: args.members.length,
							},
				);
			});
		};

		// =====================================================================
		// VALIDATE — bridge-closure law (delegates to forge-store).
		// =====================================================================

		const validate = ({ manifest }, callback) => {
			forgeStore.validateManifestClosure({ manifestKey: manifest }, callback);
		};

		// =====================================================================
		// SHOW — a manifest's membership in derived build order.
		// =====================================================================

		const show = ({ manifest }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				forgeStore.getManifest({ manifestKey: manifest }, (err, manifestRow) => {
					if (err) {
						next(err, args);
						return;
					}
					if (!manifestRow) {
						next(`show: no manifest '${manifest}' [${moduleName}]`, args);
						return;
					}
					next('', { ...args, manifestRow });
				});
			});

			// load each member block's meta so we can derive build order
			taskList.push((args, next) => {
				const blockTaskList = new taskListPlus();
				const memberBlocks = [];

				(args.manifestRow.members || []).forEach((oneMember) => {
					blockTaskList.push((blockArgs, blockNext) => {
						forgeStore.getBlock(
							{ blockId: oneMember.blockId },
							(err, blockRow) => {
								if (err) {
									blockNext(err, blockArgs);
									return;
								}
								memberBlocks.push({
									blockId: oneMember.blockId,
									position: oneMember.position,
									type: blockRow ? blockRow.type : null,
									subject: blockRow ? blockRow.subject : null,
									version: blockRow ? blockRow.version : null,
									requires:
										blockRow && blockRow.requires ? blockRow.requires : [],
								});
								blockNext('', blockArgs);
							},
						);
					});
				});

				pipeRunner(blockTaskList.getList(), {}, (err) =>
					next(err, { ...args, memberBlocks }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}

				const ordered = forgeStore.deriveBuildOrder(args.memberBlocks);
				if (ordered.cycle) {
					callback(
						`show: requires graph has a cycle among: ${ordered.cycleMembers.join(', ')} [${moduleName}]`,
					);
					return;
				}

				const { manifestRow } = args;
				callback('', {
					manifestKey: manifestRow.manifestKey,
					label: manifestRow.label,
					basedOn: manifestRow.basedOn,
					note: manifestRow.note,
					members: ordered.list,
				});
			});
		};

		// =====================================================================
		// DIFF — block-membership delta between two manifests.
		// =====================================================================

		const diff = ({ from, to }, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				forgeStore.getManifest({ manifestKey: from }, (err, manifestRow) => {
					if (err) {
						next(err, args);
						return;
					}
					if (!manifestRow) {
						next(`diff: no manifest '${from}' [${moduleName}]`, args);
						return;
					}
					next('', { ...args, fromMembers: manifestRow.members || [] });
				});
			});

			taskList.push((args, next) => {
				forgeStore.getManifest({ manifestKey: to }, (err, manifestRow) => {
					if (err) {
						next(err, args);
						return;
					}
					if (!manifestRow) {
						next(`diff: no manifest '${to}' [${moduleName}]`, args);
						return;
					}
					next('', { ...args, toMembers: manifestRow.members || [] });
				});
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const fromIds = new Set(
					args.fromMembers.map((oneMember) => oneMember.blockId),
				);
				const toIds = new Set(
					args.toMembers.map((oneMember) => oneMember.blockId),
				);

				const added = [...toIds].filter((blockId) => !fromIds.has(blockId));
				const removed = [...fromIds].filter((blockId) => !toIds.has(blockId));
				const common = [...toIds].filter((blockId) => fromIds.has(blockId));

				callback('', { from, to, added, removed, common });
			});
		};

		// =====================================================================
		// LIST BLOCKS — catalog blocks visible to callers (standard/reference/mapping/
		// structuralBridge — S1.4). Legacy 'bridge' and inferredDecision blocks are
		// internal/derived artifacts, not part of the block catalog surfaced here.
		// Pure delegation + shape to forge-store's generic listBlocks (mirrors
		// show()/diff()'s thin-wrapper style).
		// =====================================================================

		const listableBlockTypes = [
			'standard',
			'reference',
			'mapping',
			STRUCTURAL_BRIDGE_BLOCK_TYPE,
		];

		const listBlocks = (callback) => {
			forgeStore.listBlocks((err, rows) => {
				if (err) {
					callback(err);
					return;
				}
				const filtered = rows
					.filter((oneRow) => listableBlockTypes.includes(oneRow.type))
					.map((oneRow) => ({
						blockId: oneRow.blockId,
						type: oneRow.type,
						subject: oneRow.subject,
						version: oneRow.version,
						requires: oneRow.requires,
					}));
				callback('', filtered);
			});
		};

		// =====================================================================
		// LIST MANIFESTS — all manifests (membership omitted; use show/diff for that).
		// =====================================================================

		const listManifests = (callback) => {
			forgeStore.listManifests((err, rows) => {
				if (err) {
					callback(err);
					return;
				}
				const shaped = rows.map((oneRow) => ({
					manifestKey: oneRow.manifestKey,
					label: oneRow.label,
					note: oneRow.note,
					basedOn: oneRow.basedOn,
					createdAt: oneRow.createdAt,
				}));
				callback('', shaped);
			});
		};

		// =====================================================================
		// FROM RECIPE — recipe → manifest (spec §2.1 / §2.1.1). FORGE-FREE resolution:
		// resolve every DECLARED member to a RESIDENT blockId via the store's subject/
		// version keys and the CURRENT pair-group pointer, then compose via combine().
		// THROWS (never forges) on any missing block or ambiguous generation.
		// =====================================================================
		//
		// The resolution contract (§2.1.1 — the crux) yields EXACTLY ONE blockId per
		// (standard, version, role):
		//   - standards  : the recipe names a lowercase standardKey; resolve the unique
		//                  type='standard' block whose subject matches (case-insensitive).
		//   - references : {kind:'hubReference', standard, hubVersion}; resolve the unique
		//                  type='reference' block at that subject+version.
		//   - crosswalks : 'A__B' → pairSubject 'A::B'; the CURRENT pair-group pointer
		//                  (resolveCurrentPairGroup) names the explicit member set (mapping
		//                  ∪ structuralBridge blockIds) — the SAME version-keyed pointer
		//                  discipline used for family bridges. These enter combine() as
		//                  GROUPS (explicit expansion — never through the (type,subject)
		//                  supersede collapse, which would collapse a pair's several mapping
		//                  members to one survivor, the RECIPE §0B defect).
		//   - blockIdMembers : the §2.1.1 escape hatch for authored authority blocks with no
		//                  reproducible stable ref — referenced directly by blockId; validated
		//                  resident (P2's curation producer will make these stable-ref'd).
		//
		// UNIQUENESS / AMBIGUITY (§2.1.1(a,b)): standard and reference blocks have NO
		// CURRENT-pointer discipline (only pair-scoped mapping/structuralBridge blocks carry
		// currentPairGroup pointers). When more than one resident generation matches a
		// standard/reference ref, or a crosswalk's pair has more than one CURRENT version key
		// and the recipe names no version, resolution THROWS rather than binding a stale
		// generation. Preparing a single-winner store for the acceptance run (or minting the
		// intended pair-group pointer BEFORE this resolution) is the caller's responsibility.
		const resolveUniqueBlock = ({ role, ref, rows }) => {
			if (!rows || rows.length === 0) {
				return {
					error:
						`fromRecipe: no resident ${role} block for '${ref}' — forge-free resolution ` +
						`THROWS on a missing block (produce it before composing) [${moduleName}]`,
				};
			}
			if (rows.length > 1) {
				return {
					error:
						`fromRecipe: ${role} '${ref}' is AMBIGUOUS — ${rows.length} resident ` +
						`generations [${rows.map((oneRow) => `${oneRow.blockId}`.slice(0, 8)).join(', ')}] ` +
						`and no CURRENT-pointer discipline exists for ${role} blocks; refusing to bind a ` +
						`stale generation (§2.1.1(b)) [${moduleName}]`,
				};
			}
			return { blockId: rows[0].blockId };
		};

		const parseGroupBlock = ({ blockRow, crosswalkName }) => {
			const lines = `${blockRow.text}`.split('\n');
			let header;
			let content;
			try {
				header = JSON.parse(lines[0]);
				content = JSON.parse(lines[1]);
			} catch (parseErr) {
				return {
					error:
						`fromRecipe: crosswalk '${crosswalkName}': pair-group block ${blockRow.blockId} ` +
						`is not valid two-line PG-JSONL (${parseErr.message}) [${moduleName}]`,
				};
			}
			const members = Array.isArray(content.members) ? content.members : [];
			if (members.length === 0) {
				return {
					error:
						`fromRecipe: crosswalk '${crosswalkName}': pair-group ${blockRow.blockId} has no ` +
						`members [${moduleName}]`,
				};
			}
			return { members, displayName: header.displayName };
		};

		const fromRecipe = ({ recipe, recipeFilePath }, callback) => {
			if (!recipe || typeof recipe !== 'object') {
				callback(`fromRecipe: recipe is not an object [${moduleName}]`);
				return;
			}

			const standards = Array.isArray(recipe.standards) ? recipe.standards : [];
			const references = Array.isArray(recipe.references) ? recipe.references : [];
			const crosswalks = Array.isArray(recipe.crosswalks) ? recipe.crosswalks : [];
			const blockIdMembers = Array.isArray(recipe.blockIdMembers)
				? recipe.blockIdMembers
				: [];

			if (
				standards.length === 0 &&
				references.length === 0 &&
				crosswalks.length === 0 &&
				blockIdMembers.length === 0
			) {
				callback(
					`fromRecipe: recipe declares no members (standards/crosswalks/references/` +
						`blockIdMembers all empty) [${moduleName}]`,
				);
				return;
			}

			const setBlockIds = [];
			const groups = [];
			const resolution = {
				standards: [],
				references: [],
				crosswalks: [],
				blockIdMembers: [],
			};

			const taskList = new taskListPlus();

			// ---- STANDARDS: unique type='standard' subject match, or THROW
			standards.forEach((oneKey) => {
				taskList.push((args, next) => {
					forgeStore.findBlocksMeta(
						{ type: 'standard', subject: oneKey },
						(err, rows) => {
							if (err) {
								next(err, args);
								return;
							}
							const resolved = resolveUniqueBlock({
								role: 'standard',
								ref: oneKey,
								rows,
							});
							if (resolved.error) {
								next(resolved.error, args);
								return;
							}
							setBlockIds.push(resolved.blockId);
							resolution.standards.push({ standard: oneKey, blockId: resolved.blockId });
							next('', args);
						},
					);
				});
			});

			// ---- REFERENCES: unique type='reference' subject+version match, or THROW
			references.forEach((oneRef) => {
				taskList.push((args, next) => {
					if (oneRef && oneRef.kind && oneRef.kind !== 'hubReference') {
						next(
							`fromRecipe: reference kind '${oneRef.kind}' not supported (only ` +
								`'hubReference') [${moduleName}]`,
							args,
						);
						return;
					}
					const standardName = oneRef && oneRef.standard;
					const hubVersion = oneRef && oneRef.hubVersion;
					if (!standardName || !hubVersion) {
						next(
							`fromRecipe: hubReference requires standard + hubVersion, got ` +
								`${JSON.stringify(oneRef)} [${moduleName}]`,
							args,
						);
						return;
					}
					forgeStore.findBlocksMeta(
						{ type: 'reference', subject: standardName, version: hubVersion },
						(err, rows) => {
							if (err) {
								next(err, args);
								return;
							}
							const resolved = resolveUniqueBlock({
								role: 'reference',
								ref: `${standardName}@${hubVersion}`,
								rows,
							});
							if (resolved.error) {
								next(resolved.error, args);
								return;
							}
							setBlockIds.push(resolved.blockId);
							resolution.references.push({
								standard: standardName,
								hubVersion,
								blockId: resolved.blockId,
							});
							next('', args);
						},
					);
				});
			});

			// ---- CROSSWALKS: load the CURRENT pointer rows ONCE, then resolve each pair
			//      via the pointer discipline (unique version key per pair, or THROW).
			taskList.push((args, next) => {
				if (crosswalks.length === 0) {
					next('', { ...args, pointerRows: [] });
					return;
				}
				forgeStore.listCurrentPairGroups((err, rows) =>
					next(err, { ...args, pointerRows: rows || [] }),
				);
			});

			crosswalks.forEach((oneName) => {
				taskList.push((args, next) => {
					const wantSubject = `${oneName}`.replace(/__/g, '::');
					const matches = (args.pointerRows || []).filter(
						(oneRow) =>
							`${oneRow.pairSubject}`.toLowerCase() === wantSubject.toLowerCase(),
					);
					if (matches.length === 0) {
						next(
							`fromRecipe: crosswalk '${oneName}' (pair '${wantSubject}') has NO current ` +
								`pair-group in the store — forge-free resolution cannot bind it; produce the ` +
								`pair's mapping/structuralBridge blocks and mint the pair-group first ` +
								`[${moduleName}]`,
							args,
						);
						return;
					}
					// GAP-1 hardening (§2.1.1): the case-insensitive pairSubject filter can admit
					// two case-variant CURRENT pointers (e.g. `CEDS::CTDL` and `ceds::ctdl`) at the
					// SAME versionKey; keying ambiguity on versionKey alone would silently bind the
					// first. Any distinct pairSubject among the matches is genuine ambiguity → THROW.
					const distinctPairSubjects = [
						...new Set(matches.map((oneRow) => `${oneRow.pairSubject}`)),
					];
					if (distinctPairSubjects.length > 1) {
						next(
							`fromRecipe: crosswalk '${oneName}' (pair '${wantSubject}') is ` +
								`AMBIGUOUS — ${distinctPairSubjects.length} distinct CURRENT pairSubject ` +
								`rows [${distinctPairSubjects.join(', ')}] differ only by case; refusing to ` +
								`bind a generation (§2.1.1(b)) [${moduleName}]`,
							args,
						);
						return;
					}
					const distinctKeys = [
						...new Set(matches.map((oneRow) => oneRow.versionKey)),
					];
					if (distinctKeys.length > 1) {
						next(
							`fromRecipe: crosswalk '${oneName}' (pair '${matches[0].pairSubject}') is ` +
								`AMBIGUOUS — ${distinctKeys.length} CURRENT version keys ` +
								`[${distinctKeys.join(', ')}] and the recipe names no version; refusing to ` +
								`bind a generation (§2.1.1(b)) [${moduleName}]`,
							args,
						);
						return;
					}
					const row = matches[0];
					forgeStore.resolveCurrentPairGroup(
						{ pairSubject: row.pairSubject, versionKey: row.versionKey },
						(err, resolved) => {
							if (err) {
								next(err, args);
								return;
							}
							const parsed = parseGroupBlock({
								blockRow: resolved.block,
								crosswalkName: oneName,
							});
							if (parsed.error) {
								next(parsed.error, args);
								return;
							}
							groups.push({
								pairSubject: row.pairSubject,
								versionKey: row.versionKey,
								groupBlockId: row.currentGroupBlockId,
								displayName: parsed.displayName,
								members: parsed.members,
							});
							resolution.crosswalks.push({
								crosswalk: oneName,
								pairSubject: row.pairSubject,
								versionKey: row.versionKey,
								groupBlockId: row.currentGroupBlockId,
								memberCount: parsed.members.length,
							});
							next('', args);
						},
					);
				});
			});

			// ---- BLOCKID MEMBERS (§2.1.1 authored-authority escape hatch): validate resident.
			blockIdMembers.forEach((oneEntry) => {
				taskList.push((args, next) => {
					const blockId =
						typeof oneEntry === 'string' ? oneEntry : oneEntry && oneEntry.blockId;
					if (!blockId || !/^[0-9a-f]{64}$/.test(`${blockId}`)) {
						next(
							`fromRecipe: blockIdMembers entry is not a 64-hex blockId: ` +
								`${JSON.stringify(oneEntry)} [${moduleName}]`,
							args,
						);
						return;
					}
					forgeStore.getBlockMeta({ blockId }, (err, meta) => {
						if (err) {
							next(err, args);
							return;
						}
						if (!meta) {
							next(
								`fromRecipe: blockIdMembers references blockId ${blockId} which is NOT ` +
									`resident — forge-free resolution throws on a missing block [${moduleName}]`,
								args,
							);
							return;
						}
						setBlockIds.push(blockId);
						resolution.blockIdMembers.push({
							blockId,
							type: meta.type,
							subject: meta.subject,
						});
						next('', args);
					});
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				const label = recipe.goldenName != null ? `${recipe.goldenName}` : null;
				const note =
					`recipe->manifest` +
					`${recipeFilePath ? ` from ${recipeFilePath}` : ''}` +
					`${recipe.goldenName ? ` (${recipe.goldenName})` : ''}`;
				combine(
					{ set: setBlockIds, groups, label, note },
					(combineErr, result) => {
						if (combineErr) {
							callback(combineErr);
							return;
						}
						callback('', {
							manifestKey: result.manifestKey,
							memberCount: result.memberCount,
							resolution,
						});
					},
				);
			});
		};

		return {
			saveSchemaBlock,
			combine,
			validate,
			show,
			diff,
			listBlocks,
			listManifests,
			fromRecipe,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
