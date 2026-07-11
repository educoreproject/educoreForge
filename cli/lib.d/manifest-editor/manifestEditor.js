#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const qt = require('qtools-functional-library');
const os = require('os');
const path = require('path');
const fs = require('fs');

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// the store + the compose layer (the only place table/db names live is forge-store)
const forgeStoreFactory = require('../../../npm/qtools-graph-forge-core/lib/forge-store/forge-store');
const manifestEditorFactory = require('../../../npm/qtools-graph-forge-core/lib/manifest-editor/manifest-editor');

// pair/group machinery (Phase D, spec §5/§6.5/§8): the vocabulary registry, the shared
// mint-and-repoint path (ruling D-D1 — ONE code path with forgeManager -mintPairGroup),
// and pair-binding for discovery-casing + chosen-snapshot version stamps.
const vocabulary = require('../../../npm/qtools-graph-forge-core/lib/vocabulary/vocabulary');
const pairGroupMintFactory = require('../../../npm/qtools-graph-forge-core/lib/pair-group-mint/pair-group-mint');
const pairBindingFactory = require('../../../npm/qtools-graph-forge-core/lib/pair-binding/pair-binding');

// standard-discovery is required LAZILY (inside the verbs that need the roster): its
// cedsHubStandardName IIFE eagerly scans the parser tree at require time, and the
// store-only verbs (-show, -listBlocks, …) must not acquire that dependency.
const discoveryModule = () => require('../forger/lib/standard-discovery');

// START OF moduleFunction() ============================================================
//
// manifestEditor CLI — the bb2-style control surface for the SQL-persistence app
// (helpSpec.md is the contract). Three layers:
//   (1) THIS orchestrator: bootstrap, db resolution, action dispatch (registry, not
//       a switch statement), single final callback.
//   (2) shared resource: the manifest-editor lib (compose-by-selection) over the
//       forge-store (immutable content-addressed SQLite), instantiated once.
//   (3) command handlers: one workingFunction per action switch, registered into a
//       dispatch map and selected by the single action switch on the command line.
//
// Action flags take a SINGLE hyphen (-save -combine -validate -show -diff); parameter
// flags take a DOUBLE hyphen (--block= --base= --set= ...); parameter values arrive
// as arrays (qtools-parse-command-line). A manifestKey is ALWAYS derived, never
// supplied.

const moduleFunction =
	({ moduleName } = {}) =>
	({ unused } = {}) => {
		const { xLog, getConfig, commandLineParameters } = process.global;
		const localConfig = getConfig(moduleName) || {};

		const helpText = `
manifestEditor — the SQL-persistence app; sole canonicalizing writer of manifests.

USAGE
  manifestEditor -save     --block=<path|-> [--producedBy=<text>]
  manifestEditor -combine  [--base=<manifestKey>] [--set=<blockId>[,<blockId>...]]
                           [--group=<groupBlockId|pair@(a,b)>[,...]]
                           [--label=<text>] [--note=<text>]
  manifestEditor -show     --manifest=<manifestKey>
  manifestEditor -validate --manifest=<manifestKey>
  manifestEditor -diff     --from=<manifestKey> --to=<manifestKey>
  manifestEditor -listBlocks
  manifestEditor -listManifests

  manifestEditor -defineGroup   --pair=CEDS::SIF --versionKey=(a,b) --members=<blockId>[,...]
                                [--displayName=<text>] [--note=<text>]
  manifestEditor -showGroup     --group=<groupBlockId|pair@(a,b)>
  manifestEditor -validateGroup --group=<groupBlockId|pair@(a,b)>
  manifestEditor -listVersions  --standard=<name>
  manifestEditor -listGroups    --standard=<name> [--version=<snapshotKey>]
  manifestEditor -offerGroups   --manifest=<manifestKey> --standard=<name>@<snapshotKey>

  [--db=<sqlitePath>]   override the store location (else config, else the canonical
                        <projectRoot>/dataStores/forgeStore.sqlite3 shared by all forge CLIs)

  -save     Persist a schemaBlock (PG-JSONL) to the blocks table; returns its blockId
            (= sha256 of the block text). Idempotent. type/subject/version/requires are
            read from the block's PG-JSONL header (the header is authoritative).
  -combine  Compose a NEW immutable manifest from a base + a selection. Each --set block
            SUPERSEDES the base's block for its (type,subject) or ADDS a new subject.
            Nothing is mutated; the manifestKey is derived. With no --base, composes a
            genesis manifest from --set alone.
  -show     Print a manifest's membership in derived build order.
  -validate Bridge-closure check: every relationships/overlay block's required subjects
            are present AND ordered earlier.
  -diff     Block-membership delta between two manifests.
  -listBlocks     List catalog blocks (type standard/reference/mapping — bridge and
                  inferredDecision blocks are excluded) as blockId/type/subject/version/requires.
  -listManifests  List all manifests as manifestKey/label/note/basedOn/createdAt.

  PAIR-GROUP VERBS (BINDING spec §5/§6.5/§8). Every human surface LEADS with
  publishedVersion + displayName; snapshot numbers trail as technical detail (§6.5).

  -defineGroup    Mint a pair-group over an explicit member list and ADVANCE the CURRENT
                  pointer (mint-and-repoint, §5.6 — one code path with forgeManager
                  -mintPairGroup). Members must be mapping blocks filed under the
                  pair@versionKey.
  -showGroup      A group's displayName, published versions, members (with tierScope).
                  --group accepts a group blockId or the symbolic pair@(a,b) form, which
                  resolves via the CURRENT pointer.
  -validateGroup  Every member exists, is a mapping block of that pair, version keys agree.
                  Collects ALL problems (a report, not a choke).
  -listVersions   The snapshots discovery knows for a standard — "what versions could I
                  choose" (publishedVersion/displayName lead; snapshotKey trails).
  -listGroups     The CURRENT pair-groups involving a standard (optionally at one version)
                  — "what mappings exist for it."
  -offerGroups    The selection assist (§8): given a manifest and a chosen standard
                  version, DETECT and OFFER the compatible pair-groups; a pair with no
                  group at the requested key is NAMED explicitly, never omitted.
  -combine --group=…  expands each group (via the CURRENT pointer for symbolic refs) into
                  its explicit member blockIds. A group's arrival SWAPS the pair: the
                  base's mapping members for that pair subject are removed first (§11.7);
                  inferredDecision audit records are deliberately NOT swapped out.
`;

		// -----
		// parameter helpers — values arrive as arrays; first() takes index 0,
		// list() flattens comma-or-multi-flag selections.

		const first = (name) => {
			const values = commandLineParameters.values[name];
			return values && values.length ? values[0] : undefined;
		};

		const list = (name) => {
			const values = commandLineParameters.values[name];
			if (!values || !values.length) {
				return [];
			}
			return values
				.flatMap((oneValue) => `${oneValue}`.split(','))
				.map((oneValue) => oneValue.trim())
				.filter((oneValue) => oneValue.length > 0);
		};

		// -----
		// COMMA GUARDS (the Phase-C disclosure-3 pin — FROM BIRTH on every new verb).
		// qtools-parse-command-line splits comma-containing values into array elements.

		// joinedParam — free-text values that may legitimately CONTAIN commas
		// (displayName, note, label, versionKey): rejoin so the operator's text survives.
		const joinedParam = (name) => {
			const values = commandLineParameters.values[name];
			return values && values.length ? values.join(',') : undefined;
		};

		// parenAwareList — list values whose ENTRIES carry parenthesized commas
		// ('--group=CEDS::SIF@(01,01),CEDS::EdFi@(01,01)'): rejoin the qtools-split
		// fragments, then split ONLY on commas outside parentheses.
		const parenAwareList = (name) => {
			const values = commandLineParameters.values[name];
			if (!values || !values.length) {
				return [];
			}
			return values
				.join(',')
				.split(/,(?![^(]*\))/)
				.map((oneValue) => oneValue.trim())
				.filter((oneValue) => oneValue.length > 0);
		};

		// -----
		// PAIR-GROUP MACHINERY (Phase D)

		const HEX64_RE = /^[0-9a-f]{64}$/;

		const pairBinding = pairBindingFactory({});
		const { mintPairGroupIntoStore } = pairGroupMintFactory({});

		// parseSymbolicGroupRef — 'PAIR@(a,b)' -> { pairText, aVersion, bVersion } | null
		const parseSymbolicGroupRef = (refText) => {
			const match = `${refText}`.match(/^(.+?)@\(([^,()]+),([^,()]+)\)$/);
			if (!match) {
				return null;
			}
			return { pairText: match[1], aVersion: match[2], bVersion: match[3] };
		};

		// parsePairText — 'A::B' -> { aName, bName } | null
		const parsePairText = (pairText) => {
			const match = `${pairText}`.match(/^([^:]+)::([^:]+)$/);
			if (!match) {
				return null;
			}
			return { aName: match[1], bName: match[2] };
		};

		// canonicalPairNames — casing resolution ONLY (the read verbs): discovery casing
		// wins (Q10); no snapshot validation, no stamping.
		const canonicalPairNames = ({ aName, bName }) => {
			const roster = discoveryModule().roster({ includeSynthetic: true });
			const aFound = pairBinding.findRosterEntry({ roster, standardName: aName });
			if (aFound.error) {
				return { error: aFound.error };
			}
			const bFound = pairBinding.findRosterEntry({ roster, standardName: bName });
			if (bFound.error) {
				return { error: bFound.error };
			}
			return { aName: aFound.entry.standardName, bName: bFound.entry.standardName };
		};

		// resolveGroupRef — a '--group' value (group blockId | symbolic pair@(a,b)) ->
		// { groupBlockId, header, content, pairSubject, versionKey }. Symbolic refs resolve
		// via the CURRENT pointer (§5.6); every degraded state is LOUD (G-C5 contract).
		const resolveGroupRef = (forgeStore, refText, callback) => {
			const finishWithBlock = (groupBlockId, blockRow) => {
				const lines = `${blockRow.text}`.split('\n');
				let header;
				let content;
				try {
					header = JSON.parse(lines[0]);
					content = JSON.parse(lines[1]);
				} catch (parseErr) {
					callback(
						`--group ${refText}: pairGroup block ${groupBlockId} text is not valid ` +
							`two-line PG-JSONL (${parseErr.message}) [${moduleName}]`,
					);
					return;
				}
				callback('', {
					groupBlockId,
					header,
					content,
					pairSubject: blockRow.subject,
					versionKey: blockRow.version,
				});
			};

			if (HEX64_RE.test(`${refText}`)) {
				forgeStore.getBlock({ blockId: refText }, (err, blockRow) => {
					if (err) {
						callback(err);
						return;
					}
					if (!blockRow) {
						callback(`--group ${refText}: no such block [${moduleName}]`);
						return;
					}
					if (blockRow.type !== vocabulary.PAIR_GROUP_BLOCK_TYPE) {
						callback(
							`--group ${refText}: block is type '${blockRow.type}', not ` +
								`'${vocabulary.PAIR_GROUP_BLOCK_TYPE}' [${moduleName}]`,
						);
						return;
					}
					finishWithBlock(`${refText}`, blockRow);
				});
				return;
			}

			const symbolic = parseSymbolicGroupRef(refText);
			if (!symbolic) {
				callback(
					`--group '${refText}' is neither a 64-hex blockId nor the symbolic ` +
						`pair@(a,b) form [${moduleName}]`,
				);
				return;
			}
			const pairNames = parsePairText(symbolic.pairText);
			if (!pairNames) {
				callback(
					`--group '${refText}': pair '${symbolic.pairText}' is not canonical A::B form [${moduleName}]`,
				);
				return;
			}
			const canonical = canonicalPairNames(pairNames);
			if (canonical.error) {
				callback(`--group '${refText}': ${canonical.error}`);
				return;
			}
			const pairSubject = vocabulary.pairSubjectText(canonical.aName, canonical.bName);
			const versionKey = vocabulary.versionKeyText(symbolic.aVersion, symbolic.bVersion);
			forgeStore.resolveCurrentPairGroup({ pairSubject, versionKey }, (err, resolved) => {
				if (err) {
					callback(err);
					return;
				}
				finishWithBlock(resolved.groupBlockId, resolved.block);
			});
		};

		// displayVersionKey — §5.3 display form: hub pairs prefix h/s; non-hub pairs bare.
		const displayVersionKey = ({ pairA, aVersion, bVersion }) => {
			const hubName = discoveryModule().cedsHubStandardName;
			return pairA === hubName
				? `(h${aVersion}, s${bVersion})`
				: `(${aVersion}, ${bVersion})`;
		};

		// scalarProp — PG-JSON single-element array or scalar (the replay-engine acceptance).
		const scalarProp = (propValue) =>
			Array.isArray(propValue) ? propValue[0] : propValue;

		// standardBlockVersionStamp — the D-D4 LAYERED READ of a standard block's snapshot
		// binding: the DmeStandardRoot node line's Phase-A stamp when present (every fresh
		// forge carries it); otherwise honestly 'unknown' (pre-provenance block) — NEVER
		// inferred, never defaulted (fabricated provenance is the disease this build cures).
		const standardBlockVersionStamp = (blockText) => {
			// the root label is the DME ROLE 'DmeStandardRoot' (parsers stamp it as a label;
			// vocabulary.NODE_LABELS holds only the scope/passport labels)
			const rootLabel = vocabulary.DME_ROLES.STANDARD_ROOT;
			const lines = `${blockText}`.split('\n');
			for (let lineIndex = 1; lineIndex < lines.length; lineIndex++) {
				const oneLine = lines[lineIndex];
				if (!oneLine || oneLine.indexOf('"node"') === -1 || oneLine.indexOf(rootLabel) === -1) {
					continue;
				}
				let parsed;
				try {
					parsed = JSON.parse(oneLine);
				} catch (parseErr) {
					continue;
				}
				if (parsed.kind !== 'node' || (parsed.labels || []).indexOf(rootLabel) === -1) {
					continue;
				}
				const properties = parsed.properties || {};
				const snapshotKey = scalarProp(properties.snapshotKey);
				const publishedVersion = scalarProp(properties.publishedVersion);
				return {
					snapshotKey: snapshotKey != null ? `${snapshotKey}` : 'unknown',
					publishedVersion: publishedVersion != null ? `${publishedVersion}` : 'unknown',
					stamped: snapshotKey != null,
				};
			}
			return { snapshotKey: 'unknown', publishedVersion: 'unknown', stamped: false };
		};

		// -----
		// dbPath resolution: --db override, else config, else the canonical shared store
		// (created if missing). forge-store owns the table names; this picks the file.
		// forger/replay/bridge/gate all HARDCODE <projectRoot>/dataStores/forgeStore.sqlite3;
		// manifestEditor now defaults to that SAME store so a bare invocation reads/writes the
		// one canonical file. (repoRoot is code/; the store lives one level up under system/.)

		const projectRoot = path.join(__dirname, '../../../..');
		const resolveDbPath = () => {
			const override = first('db');
			if (override) {
				return override;
			}
			if (localConfig.dbPath) {
				return localConfig.dbPath;
			}
			return path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3');
		};

		// -----
		// readBlockText — file path, or '-' for stdin

		const readBlockText = (blockSource) => {
			if (blockSource === '-') {
				return fs.readFileSync(0, 'utf8');
			}
			return fs.readFileSync(blockSource, 'utf8');
		};

		// -----
		// blockMetaFromHeader — type/subject/version/requires are a PROJECTION of the
		// PG-JSONL header (schemas.md §2: the header is authoritative). subject is the
		// standardKey; a consolidated relationships block has none (=> null); a per-pair
		// relationships block (future) projects pairA::pairB.

		//
		// L9: the header parse is guarded — a malformed first line returns { error } for the
		// caller's error channel (named, explicit), never a raw JSON.parse stack. The guard is
		// isolated to the parse itself (the sanctioned local exception).

		const blockMetaFromHeader = (text) => {
			const firstLine = `${text}`.split('\n')[0];
			let header;
			try {
				header = JSON.parse(firstLine);
			} catch (parseErr) {
				return {
					error:
						`block header (first line) is not valid JSON (${parseErr.message}): ` +
						`${firstLine.slice(0, 120)}`,
				};
			}
			const subject =
				header.standardKey != null
					? header.standardKey
					: header.pairA != null && header.pairB != null
						? `${header.pairA}::${header.pairB}`
						: null;
			return {
				type: header.blockType,
				subject,
				version: header.version != null ? header.version : null,
				requires: Array.isArray(header.requires) ? header.requires : [],
			};
		};

		// =====================================================================
		// COMMAND HANDLERS — each (manifestEditor, callback)
		// =====================================================================

		const handleSave = ({ manifestEditor }, callback) => {
			const blockSource = first('block');
			if (!blockSource) {
				callback(`-save requires --block=<path|->`);
				return;
			}
			const text = readBlockText(blockSource);
			const meta = blockMetaFromHeader(text);
			if (meta.error) {
				callback(`-save: ${meta.error} [${moduleName}]`);
				return;
			}
			if (!meta.type) {
				callback(`-save: block header has no blockType [${moduleName}]`);
				return;
			}
			manifestEditor.saveSchemaBlock(
				{
					type: meta.type,
					subject: meta.subject,
					version: meta.version,
					requires: meta.requires,
					text,
					producedBy: first('producedBy'),
				},
				(err, result) =>
					callback(err, err ? undefined : { blockId: result.blockId }),
			);
		};

		const handleCombine = ({ manifestEditor, forgeStore }, callback) => {
			const set = list('set');
			const groupRefs = parenAwareList('group'); // comma-guard: entries carry '(a,b)'
			if (set.length === 0 && groupRefs.length === 0) {
				callback(
					`-combine requires --set=<blockId>[,...] and/or --group=<groupBlockId|pair@(a,b)>[,...]`,
				);
				return;
			}
			// resolve each --group (symbolic refs via the CURRENT pointer, §5.6), then hand
			// the compose to the manifest-editor lib with explicit group descriptors: the
			// lib swaps the pair's mapping members and enters the group's members
			// EXPLICITLY, bypassing the (type,subject) supersede collapse (ruling D-D2).
			const resolveTaskList = new taskListPlus();
			const groups = [];
			groupRefs.forEach((oneRef) => {
				resolveTaskList.push((args, next) => {
					resolveGroupRef(forgeStore, oneRef, (err, group) => {
						if (err) {
							next(err, args);
							return;
						}
						groups.push({
							pairSubject: group.pairSubject,
							versionKey: group.versionKey,
							groupBlockId: group.groupBlockId,
							displayName: group.header.displayName,
							members: group.content.members || [],
						});
						next('', args);
					});
				});
			});
			pipeRunner(resolveTaskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				manifestEditor.combine(
					{
						base: first('base'),
						set,
						groups,
						label: joinedParam('label'),
						note: joinedParam('note'),
					},
					(combineErr, result) =>
						callback(combineErr, combineErr ? undefined : result),
				);
			});
		};

		const handleValidate = ({ manifestEditor, forgeStore }, callback) => {
			const manifest = first('manifest');
			if (!manifest) {
				callback(`-validate requires --manifest=<manifestKey>`);
				return;
			}
			manifestEditor.validate({ manifest }, (err, verdict) => {
				if (err) {
					callback(err);
					return;
				}
				// version-key presence joins -validate's checks (spec §8): mapping-content
				// members are classified pair-keyed vs legacy. Legacy (standardKey-headed)
				// members are REPORTED, not failed — retain-all means pre-Phase-C manifests
				// must keep validating; the store's saveBlock choke point makes a half-keyed
				// pair block impossible, so presence-of-pair-key IS completeness.
				forgeStore.getManifest({ manifestKey: manifest }, (manifestErr, manifestRow) => {
					if (manifestErr) {
						callback(manifestErr);
						return;
					}
					if (!manifestRow) {
						callback(`-validate: no manifest '${manifest}' [${moduleName}]`);
						return;
					}
					const memberTaskList = new taskListPlus();
					const pairKeyedMappingMembers = [];
					const legacyMappingMembers = [];
					(manifestRow.members || []).forEach((oneMember) => {
						memberTaskList.push((args, next) => {
							forgeStore.getBlockMeta(
								{ blockId: oneMember.blockId },
								(metaErr, blockMeta) => {
									if (metaErr) {
										next(metaErr, args);
										return;
									}
									if (!blockMeta || !vocabulary.isMappingBlockType(blockMeta.type)) {
										next('', args);
										return;
									}
									const versionKeyed = /^\([^,()]+,[^,()]+\)$/.test(
										`${blockMeta.version}`,
									);
									(versionKeyed ? pairKeyedMappingMembers : legacyMappingMembers).push(
										oneMember.blockId,
									);
									next('', args);
								},
							);
						});
					});
					pipeRunner(memberTaskList.getList(), {}, (memberErr) => {
						if (memberErr) {
							callback(memberErr);
							return;
						}
						callback('', {
							...verdict,
							versionKeyReport: {
								pairKeyedMappingMemberCount: pairKeyedMappingMembers.length,
								legacyMappingMembers,
							},
						});
					});
				});
			});
		};

		const handleShow = ({ manifestEditor }, callback) => {
			const manifest = first('manifest');
			if (!manifest) {
				callback(`-show requires --manifest=<manifestKey>`);
				return;
			}
			manifestEditor.show({ manifest }, (err, shown) =>
				callback(err, err ? undefined : shown),
			);
		};

		const handleDiff = ({ manifestEditor }, callback) => {
			const from = first('from');
			const to = first('to');
			if (!from || !to) {
				callback(`-diff requires --from=<manifestKey> --to=<manifestKey>`);
				return;
			}
			manifestEditor.diff({ from, to }, (err, delta) =>
				callback(err, err ? undefined : delta),
			);
		};

		const handleListBlocks = ({ manifestEditor }, callback) => {
			manifestEditor.listBlocks((err, blocks) =>
				callback(err, err ? undefined : blocks),
			);
		};

		const handleListManifests = ({ manifestEditor }, callback) => {
			manifestEditor.listManifests((err, manifests) =>
				callback(err, err ? undefined : manifests),
			);
		};

		// =====================================================================
		// PAIR-GROUP COMMAND HANDLERS (Phase D — spec §5.6/§6.5/§8). Every output
		// object LEADS with displayName/publishedVersion; snapshot keys and blockIds
		// trail (§6.5 — JSON field order IS the presentation order here).
		// =====================================================================

		const handleDefineGroup = ({ forgeStore }, callback) => {
			const pairText = joinedParam('pair');
			const versionKeyRaw = joinedParam('versionKey'); // comma-guard: '(01,01)' arrives split
			const members = list('members');
			if (!pairText || !versionKeyRaw || members.length === 0) {
				callback(
					`-defineGroup requires --pair=A::B --versionKey=(a,b) --members=<blockId>[,...]`,
				);
				return;
			}
			const pairNames = parsePairText(pairText);
			if (!pairNames) {
				callback(`-defineGroup: --pair '${pairText}' is not canonical A::B form`);
				return;
			}
			const keyMatch = `${versionKeyRaw}`.match(/^\(([^,()]+),([^,()]+)\)$/);
			if (!keyMatch) {
				callback(`-defineGroup: --versionKey '${versionKeyRaw}' is not canonical (a,b) form`);
				return;
			}
			const roster = discoveryModule().roster({ includeSynthetic: true });
			// --hubBundleDir (optional, D-D5 rider 3): synthetic flows stamp the synthetic
			// hub bundle's own provenance, never the real hub's.
			const binding = pairBinding.resolvePairBindingAtVersions({
				roster,
				hubStandardName: pairNames.aName,
				spokeStandardName: pairNames.bName,
				aVersion: keyMatch[1],
				bVersion: keyMatch[2],
				preferredHubBundleDir: joinedParam('hubBundleDir') || null,
				warn: (message) => xLog.status(`[${moduleName}] ${message}`),
			});
			if (binding.error) {
				callback(`-defineGroup: ${binding.error}`);
				return;
			}
			// the ONE mint-and-repoint path (ruling D-D1): validate → compose → save → ADVANCE.
			mintPairGroupIntoStore(
				{
					forgeStore,
					...binding,
					members,
					displayName: joinedParam('displayName'),
					note: joinedParam('note'),
					producedBy: 'manifestEditor:defineGroup',
				},
				(err, minted) => {
					if (err) {
						callback(err);
						return;
					}
					callback('', {
						action: 'defineGroup',
						displayName: minted.displayName,
						publishedVersionA: binding.publishedVersionA,
						publishedVersionB: binding.publishedVersionB,
						pair: minted.pairSubject,
						display: `${minted.pairSubject} @ ${displayVersionKey({
							pairA: binding.pairA,
							aVersion: binding.pairAVersion,
							bVersion: binding.pairBVersion,
						})}`,
						memberCount: minted.memberCount,
						members: minted.members,
						versionKey: minted.versionKey,
						groupBlockId: minted.groupBlockId,
					});
				},
			);
		};

		const handleShowGroup = ({ forgeStore }, callback) => {
			const refText = joinedParam('group');
			if (!refText) {
				callback(`-showGroup requires --group=<groupBlockId|pair@(a,b)>`);
				return;
			}
			resolveGroupRef(forgeStore, refText, (err, group) => {
				if (err) {
					callback(err);
					return;
				}
				const memberTaskList = new taskListPlus();
				const memberDetails = [];
				(group.content.members || []).forEach((oneBlockId) => {
					memberTaskList.push((args, next) => {
						forgeStore.getBlock({ blockId: oneBlockId }, (memberErr, blockRow) => {
							if (memberErr) {
								next(memberErr, args);
								return;
							}
							if (!blockRow) {
								next(`-showGroup: group member ${oneBlockId} does not exist`, args);
								return;
							}
							// header parse guarded (the L9 precedent) — tierScope/originalSubject
							// are display enrichments; a member with an unreadable header still lists.
							let memberHeader = {};
							try {
								memberHeader = JSON.parse(`${blockRow.text}`.split('\n')[0]);
							} catch (parseErr) {
								memberHeader = {};
							}
							memberDetails.push({
								tierScope: memberHeader.tierScope != null ? memberHeader.tierScope : null,
								producedBy: blockRow.producedBy,
								originalSubject:
									memberHeader.originalSubject != null ? memberHeader.originalSubject : null,
								blockId: oneBlockId,
							});
							next('', args);
						});
					});
				});
				pipeRunner(memberTaskList.getList(), {}, (memberErr) => {
					if (memberErr) {
						callback(memberErr);
						return;
					}
					callback('', {
						action: 'showGroup',
						displayName: group.header.displayName,
						publishedVersionA: group.header.publishedVersionA,
						publishedVersionB: group.header.publishedVersionB,
						pair: group.pairSubject,
						display: `${group.pairSubject} @ ${displayVersionKey({
							pairA: group.header.pairA,
							aVersion: group.header.pairAVersion,
							bVersion: group.header.pairBVersion,
						})}`,
						memberCount: memberDetails.length,
						members: memberDetails,
						versionKey: group.versionKey,
						groupBlockId: group.groupBlockId,
					});
				});
			});
		};

		const handleValidateGroup = ({ forgeStore }, callback) => {
			const refText = joinedParam('group');
			if (!refText) {
				callback(`-validateGroup requires --group=<groupBlockId|pair@(a,b)>`);
				return;
			}
			resolveGroupRef(forgeStore, refText, (err, group) => {
				if (err) {
					callback(err);
					return;
				}
				// a REPORT, not a choke: collect ALL problems (the store's saveBlock choke
				// point remains the enforcement; this is the inspection face, spec §8).
				const problems = [];
				const headerKeyComplete = vocabulary.VERSION_KEY_HEADER_FIELDS.every(
					(oneField) =>
						group.header[oneField] != null && `${group.header[oneField]}`.length > 0,
				);
				if (!headerKeyComplete) {
					problems.push(
						`header version key incomplete (requires ${vocabulary.VERSION_KEY_HEADER_FIELDS.join('/')})`,
					);
				} else {
					const headerKeyText = vocabulary.versionKeyText(
						group.header.pairAVersion,
						group.header.pairBVersion,
					);
					if (headerKeyText !== group.versionKey) {
						problems.push(
							`header version key ${headerKeyText} disagrees with row version ${group.versionKey}`,
						);
					}
					const headerSubject = vocabulary.pairSubjectText(
						group.header.pairA,
						group.header.pairB,
					);
					if (headerSubject !== group.pairSubject) {
						problems.push(
							`header pair ${headerSubject} disagrees with row subject ${group.pairSubject}`,
						);
					}
				}
				if (group.content.versionKey !== group.versionKey) {
					problems.push(
						`content versionKey ${group.content.versionKey} disagrees with row version ${group.versionKey}`,
					);
				}
				const members = group.content.members || [];
				if (!members.length) {
					problems.push('group has no members (an empty group is never valid)');
				}
				const memberTaskList = new taskListPlus();
				members.forEach((oneBlockId) => {
					memberTaskList.push((args, next) => {
						forgeStore.getBlockMeta({ blockId: oneBlockId }, (metaErr, blockMeta) => {
							if (metaErr) {
								next(metaErr, args);
								return;
							}
							if (!blockMeta) {
								problems.push(`member ${oneBlockId} does not exist`);
								next('', args);
								return;
							}
							if (blockMeta.type !== 'mapping') {
								problems.push(
									`member ${oneBlockId} is type '${blockMeta.type}', not 'mapping'`,
								);
							}
							if (
								blockMeta.subject !== group.pairSubject ||
								blockMeta.version !== group.versionKey
							) {
								problems.push(
									`member ${oneBlockId} is filed under '${blockMeta.subject}'@'${blockMeta.version}', ` +
										`not '${group.pairSubject}'@'${group.versionKey}'`,
								);
							}
							next('', args);
						});
					});
				});
				pipeRunner(memberTaskList.getList(), {}, (memberErr) => {
					if (memberErr) {
						callback(memberErr);
						return;
					}
					callback('', {
						action: 'validateGroup',
						displayName: group.header.displayName,
						pair: group.pairSubject,
						valid: problems.length === 0,
						problems,
						memberCount: members.length,
						versionKey: group.versionKey,
						groupBlockId: group.groupBlockId,
					});
				});
			});
		};

		const handleListVersions = (ignoredContext, callback) => {
			const standardText = joinedParam('standard');
			if (!standardText) {
				callback(`-listVersions requires --standard=<name>`);
				return;
			}
			const roster = discoveryModule().roster({ includeSynthetic: true });
			const found = pairBinding.findRosterEntry({ roster, standardName: standardText });
			if (found.error) {
				callback(`-listVersions: ${found.error}`);
				return;
			}
			const entry = found.entry;
			const versions = entry.snapshots.map((oneSnapshotKey) => {
				const stamped = pairBinding.stampForSnapshot({
					entry,
					snapshotKey: oneSnapshotKey,
					warn: (message) => xLog.status(`[${moduleName}] ${message}`),
				});
				return {
					publishedVersion: stamped.error ? 'unknown' : stamped.stamp.publishedVersion,
					displayName: entry.displayName,
					isDefault: oneSnapshotKey === entry.defaultSnapshot,
					snapshotKey: oneSnapshotKey,
				};
			});
			callback('', {
				action: 'listVersions',
				displayName: entry.displayName,
				standard: entry.standardName,
				synthetic: entry.synthetic === true,
				versions,
			});
		};

		const handleListGroups = ({ forgeStore }, callback) => {
			const standardText = joinedParam('standard');
			if (!standardText) {
				callback(`-listGroups requires --standard=<name> [--version=<snapshotKey>]`);
				return;
			}
			const wantedVersion = joinedParam('version');
			const roster = discoveryModule().roster({ includeSynthetic: true });
			const found = pairBinding.findRosterEntry({ roster, standardName: standardText });
			if (found.error) {
				callback(`-listGroups: ${found.error}`);
				return;
			}
			const standardName = found.entry.standardName;
			forgeStore.listCurrentPairGroups((err, pointerRows) => {
				if (err) {
					callback(err);
					return;
				}
				const relevantRows = (pointerRows || []).filter((oneRow) => {
					const pairNames = parsePairText(oneRow.pairSubject);
					if (!pairNames) {
						return false;
					}
					const side =
						pairNames.aName === standardName
							? 'a'
							: pairNames.bName === standardName
								? 'b'
								: null;
					if (!side) {
						return false;
					}
					if (!wantedVersion) {
						return true;
					}
					const keyMatch = `${oneRow.versionKey}`.match(/^\(([^,()]+),([^,()]+)\)$/);
					if (!keyMatch) {
						return false;
					}
					return (side === 'a' ? keyMatch[1] : keyMatch[2]) === wantedVersion;
				});
				const groupTaskList = new taskListPlus();
				const groups = [];
				relevantRows.forEach((oneRow) => {
					groupTaskList.push((args, next) => {
						forgeStore.getBlock(
							{ blockId: oneRow.currentGroupBlockId },
							(blockErr, blockRow) => {
								if (blockErr) {
									next(blockErr, args);
									return;
								}
								if (!blockRow) {
									next(
										`-listGroups: POINTER CORRUPT — currentPairGroup for ` +
											`${oneRow.pairSubject}@${oneRow.versionKey} aims at blockId ` +
											`${oneRow.currentGroupBlockId} which does not exist`,
										args,
									);
									return;
								}
								let header;
								let content;
								try {
									const lines = `${blockRow.text}`.split('\n');
									header = JSON.parse(lines[0]);
									content = JSON.parse(lines[1]);
								} catch (parseErr) {
									next(
										`-listGroups: pairGroup block ${oneRow.currentGroupBlockId} text is ` +
											`not valid two-line PG-JSONL (${parseErr.message})`,
										args,
									);
									return;
								}
								groups.push({
									displayName: header.displayName,
									publishedVersionA: header.publishedVersionA,
									publishedVersionB: header.publishedVersionB,
									pair: oneRow.pairSubject,
									display: `${oneRow.pairSubject} @ ${displayVersionKey({
										pairA: header.pairA,
										aVersion: header.pairAVersion,
										bVersion: header.pairBVersion,
									})}`,
									memberCount: (content.members || []).length,
									versionKey: oneRow.versionKey,
									groupBlockId: oneRow.currentGroupBlockId,
								});
								next('', args);
							},
						);
					});
				});
				pipeRunner(groupTaskList.getList(), {}, (groupErr) => {
					if (groupErr) {
						callback(groupErr);
						return;
					}
					callback('', {
						action: 'listGroups',
						standard: standardName,
						...(wantedVersion ? { version: wantedVersion } : {}),
						groupCount: groups.length,
						groups,
					});
				});
			});
		};

		// handleOfferGroups — THE SELECTION ASSIST (TQ requirement, spec §8): the user
		// chooses a version; the version's mappings are DETECTED and OFFERED. A pair with
		// no group at the requested key is NAMED with the §8 wording, never omitted.
		const handleOfferGroups = ({ forgeStore }, callback) => {
			const manifestKey = joinedParam('manifest');
			const standardText = joinedParam('standard');
			if (!manifestKey || !standardText) {
				callback(
					`-offerGroups requires --manifest=<manifestKey> --standard=<name>@<snapshotKey>`,
				);
				return;
			}
			const atMatch = `${standardText}`.match(/^(.+?)@(.+)$/);
			if (!atMatch) {
				callback(
					`-offerGroups: --standard '${standardText}' must be <name>@<snapshotKey> — ` +
						`the user chooses a VERSION (§8)`,
				);
				return;
			}
			const roster = discoveryModule().roster({ includeSynthetic: true });
			const found = pairBinding.findRosterEntry({ roster, standardName: atMatch[1] });
			if (found.error) {
				callback(`-offerGroups: ${found.error}`);
				return;
			}
			const chosenEntry = found.entry;
			const chosenName = chosenEntry.standardName;
			const chosenKey = atMatch[2];
			if (chosenEntry.snapshots.indexOf(chosenKey) === -1) {
				callback(
					`-offerGroups: bundle '${chosenEntry.bundleDir}' has no snapshot '${chosenKey}' ` +
						`(known: ${chosenEntry.snapshots.join(', ')})`,
				);
				return;
			}
			const hubName = discoveryModule().cedsHubStandardName;

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				forgeStore.getManifest({ manifestKey }, (manifestErr, manifestRow) => {
					if (manifestErr) {
						next(manifestErr, args);
						return;
					}
					if (!manifestRow) {
						next(`-offerGroups: no manifest '${manifestKey}' [${moduleName}]`, args);
						return;
					}
					next('', { ...args, manifestRow });
				});
			});

			// the manifest's standard blocks -> version stamps (the D-D4 layered read)
			taskList.push((args, next) => {
				const memberTaskList = new taskListPlus();
				const standardStamps = {};
				(args.manifestRow.members || []).forEach((oneMember) => {
					memberTaskList.push((memberArgs, memberNext) => {
						forgeStore.getBlock({ blockId: oneMember.blockId }, (blockErr, blockRow) => {
							if (blockErr) {
								memberNext(blockErr, memberArgs);
								return;
							}
							if (!blockRow) {
								memberNext(
									`-offerGroups: manifest references missing block ${oneMember.blockId}`,
									memberArgs,
								);
								return;
							}
							if (blockRow.type === 'standard') {
								standardStamps[`${blockRow.subject}`.toLowerCase()] = {
									subject: blockRow.subject,
									...standardBlockVersionStamp(blockRow.text),
								};
							}
							memberNext('', memberArgs);
						});
					});
				});
				pipeRunner(memberTaskList.getList(), {}, (memberErr) =>
					next(memberErr, { ...args, standardStamps }),
				);
			});

			taskList.push((args, next) => {
				forgeStore.listCurrentPairGroups((pointerErr, pointerRows) =>
					next(pointerErr, { ...args, pointerRows: pointerRows || [] }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const { standardStamps, pointerRows } = args;

				// candidate pairs: every CURRENT pair involving the chosen standard whose
				// counterpart standard is present in the manifest — PLUS the catalog hub
				// pair (hub::chosen) when the hub is present, so a pair with no groups AT
				// ALL still gets its gap named.
				const candidateByPair = {};
				pointerRows.forEach((oneRow) => {
					const pairNames = parsePairText(oneRow.pairSubject);
					if (!pairNames) {
						return;
					}
					const side =
						pairNames.aName === chosenName
							? 'a'
							: pairNames.bName === chosenName
								? 'b'
								: null;
					if (!side) {
						return;
					}
					const counterpartName = side === 'a' ? pairNames.bName : pairNames.aName;
					const counterpartStamp = standardStamps[counterpartName.toLowerCase()];
					if (!counterpartStamp) {
						return; // counterpart not in this manifest — not this manifest's business
					}
					if (!candidateByPair[oneRow.pairSubject]) {
						candidateByPair[oneRow.pairSubject] = {
							pairSubject: oneRow.pairSubject,
							side,
							counterpartStamp,
							rows: [],
						};
					}
					candidateByPair[oneRow.pairSubject].rows.push(oneRow);
				});
				if (chosenName !== hubName && standardStamps[hubName.toLowerCase()]) {
					const catalogPair = vocabulary.pairSubjectText(hubName, chosenName);
					if (!candidateByPair[catalogPair]) {
						candidateByPair[catalogPair] = {
							pairSubject: catalogPair,
							side: 'b',
							counterpartStamp: standardStamps[hubName.toLowerCase()],
							rows: [],
						};
					}
				}

				const offers = [];
				const gaps = [];
				const disclosures = [];
				const offeredPairs = new Set();
				const offerFetchList = new taskListPlus();

				Object.keys(candidateByPair).forEach((onePairSubject) => {
					const candidate = candidateByPair[onePairSubject];
					candidate.rows.forEach((oneRow) => {
						const keyMatch = `${oneRow.versionKey}`.match(/^\(([^,()]+),([^,()]+)\)$/);
						if (!keyMatch) {
							return;
						}
						const chosenComponent = candidate.side === 'a' ? keyMatch[1] : keyMatch[2];
						const counterpartComponent =
							candidate.side === 'a' ? keyMatch[2] : keyMatch[1];
						if (chosenComponent !== chosenKey) {
							return; // a different version of the chosen standard
						}
						const counterpartVerifiable = candidate.counterpartStamp.stamped;
						if (
							counterpartVerifiable &&
							counterpartComponent !== candidate.counterpartStamp.snapshotKey
						) {
							return; // incompatible with the manifest's counterpart version
						}
						offerFetchList.push((fetchArgs, fetchNext) => {
							forgeStore.getBlock(
								{ blockId: oneRow.currentGroupBlockId },
								(blockErr, blockRow) => {
									if (blockErr) {
										fetchNext(blockErr, fetchArgs);
										return;
									}
									if (!blockRow) {
										fetchNext(
											`-offerGroups: POINTER CORRUPT — currentPairGroup for ` +
												`${oneRow.pairSubject}@${oneRow.versionKey} aims at blockId ` +
												`${oneRow.currentGroupBlockId} which does not exist`,
											fetchArgs,
										);
										return;
									}
									let header;
									let content;
									try {
										const lines = `${blockRow.text}`.split('\n');
										header = JSON.parse(lines[0]);
										content = JSON.parse(lines[1]);
									} catch (parseErr) {
										fetchNext(
											`-offerGroups: pairGroup block ${oneRow.currentGroupBlockId} text ` +
												`is not valid two-line PG-JSONL (${parseErr.message})`,
											fetchArgs,
										);
										return;
									}
									offeredPairs.add(oneRow.pairSubject);
									offers.push({
										displayName: header.displayName,
										publishedVersionA: header.publishedVersionA,
										publishedVersionB: header.publishedVersionB,
										pair: oneRow.pairSubject,
										display: `${oneRow.pairSubject} @ ${displayVersionKey({
											pairA: header.pairA,
											aVersion: header.pairAVersion,
											bVersion: header.pairBVersion,
										})}`,
										memberCount: (content.members || []).length,
										versionKey: oneRow.versionKey,
										groupBlockId: oneRow.currentGroupBlockId,
									});
									if (!counterpartVerifiable) {
										disclosures.push(
											`${oneRow.pairSubject}: the ${candidate.counterpartStamp.subject} side is ` +
												`unverifiable (pre-provenance standard block carries no snapshot stamp); ` +
												`offered on the ${chosenName} component only`,
										);
									}
									fetchNext('', fetchArgs);
								},
							);
						});
					});
				});

				pipeRunner(offerFetchList.getList(), {}, (fetchErr) => {
					if (fetchErr) {
						callback(fetchErr);
						return;
					}
					// the named-gap contract (§8, asserted literally by G-D4): a candidate
					// pair with no offer at the requested key is NAMED, never omitted.
					Object.keys(candidateByPair)
						.sort()
						.forEach((onePairSubject) => {
							if (offeredPairs.has(onePairSubject)) {
								return;
							}
							const candidate = candidateByPair[onePairSubject];
							const pairNames = parsePairText(onePairSubject);
							const requiredA =
								candidate.side === 'a'
									? chosenKey
									: candidate.counterpartStamp.snapshotKey;
							const requiredB =
								candidate.side === 'b'
									? chosenKey
									: candidate.counterpartStamp.snapshotKey;
							const requiredDisplay =
								pairNames && pairNames.aName === hubName
									? `(h${requiredA}, s${requiredB})`
									: `(${requiredA}, ${requiredB})`;
							gaps.push(
								`no ${onePairSubject} mappings exist at ${requiredDisplay}; produce them via §7.2`,
							);
						});
					callback('', {
						action: 'offerGroups',
						chosen: `${chosenName}@${chosenKey}`,
						manifest: manifestKey,
						offerCount: offers.length,
						offers,
						gaps,
						...(disclosures.length ? { disclosures } : {}),
					});
				});
			});
		};

		// dispatch map (registry pattern — the single action switch selects a handler)
		const dispatchMap = {
			save: handleSave,
			combine: handleCombine,
			validate: handleValidate,
			show: handleShow,
			diff: handleDiff,
			listBlocks: handleListBlocks,
			listManifests: handleListManifests,
			defineGroup: handleDefineGroup,
			showGroup: handleShowGroup,
			validateGroup: handleValidateGroup,
			listVersions: handleListVersions,
			listGroups: handleListGroups,
			offerGroups: handleOfferGroups,
		};

		// =====================================================================
		// ORCHESTRATION — help, select action, open store, dispatch
		// =====================================================================

		if (commandLineParameters.switches.help || commandLineParameters.switches.h) {
			xLog.status(helpText);
			return {};
		}

		const selectedActions = Object.keys(dispatchMap).filter(
			(oneAction) => commandLineParameters.switches[oneAction],
		);

		if (selectedActions.length === 0) {
			xLog.error(
				`no action: one of -save -combine -validate -show -diff -listBlocks -listManifests ` +
					`-defineGroup -showGroup -validateGroup -listVersions -listGroups -offerGroups ` +
					`is required (use --help)`,
			);
			return {};
		}
		if (selectedActions.length > 1) {
			xLog.error(
				`one action at a time, got: ${selectedActions.map((oneAction) => `-${oneAction}`).join(' ')}`,
			);
			return {};
		}

		const actionName = selectedActions[0];
		const dbPath = resolveDbPath();

		const taskList = new taskListPlus();

		// ensure the store directory exists
		taskList.push((args, next) => {
			const storeDir = path.dirname(dbPath);
			if (!fs.existsSync(storeDir)) {
				fs.mkdirSync(storeDir, { recursive: true });
			}
			next('', args);
		});

		// open + init the store
		taskList.push((args, next) => {
			const forgeStore = forgeStoreFactory();
			forgeStore.init({ dbPath }, (err) =>
				next(err, { ...args, forgeStore }),
			);
		});

		// instantiate the compose layer + dispatch the selected action. Handlers receive
		// a CONTEXT ({ manifestEditor, forgeStore }): the compose verbs speak to the lib;
		// the pair-group verbs additionally reach the store's pointer primitives (§5.6).
		taskList.push((args, next) => {
			const manifestEditor = manifestEditorFactory({
				forgeStore: args.forgeStore,
			});
			dispatchMap[actionName](
				{ manifestEditor, forgeStore: args.forgeStore },
				(err, result) => next(err, { ...args, result }),
			);
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				xLog.error(`manifestEditor -${actionName} failed: ${err}`);
				process.exitCode = 1;
				return;
			}
			xLog.result(JSON.stringify(args.result, null, 2));
		});

		return {};
	};

// END OF moduleFunction() ============================================================

// prettier-ignore
{
	process.global = {};
	process.global.xLog = fs.existsSync('./lib/x-log')
		? require('./lib/x-log')
		: { status: console.error, error: console.error, result: console.log };
	process.global.getConfig = typeof(getConfig) != 'undefined'
		? getConfig
		: (moduleName => ({ [moduleName]: undefined }[moduleName]));
	process.global.commandLineParameters = typeof(commandLineParameters) != 'undefined'
		? commandLineParameters
		: undefined;
	process.global.rawConfig = {};
}

module.exports = moduleFunction({ moduleName })({});
