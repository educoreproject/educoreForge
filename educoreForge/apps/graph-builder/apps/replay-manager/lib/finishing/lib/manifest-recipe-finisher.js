'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// manifest-recipe-finisher.js — registry member 3, mode 'emit' (graphSelfDoc Phase 2, 2026-08-31).
//
// THE ONLY STORE-READING FINISHER. Every other member derives from the vocabulary registry or from the
// built graph; this one alone opens the forge store, and it reads METADATA ONLY — manifest rows and block
// rows, never block TEXT. It emits the manifest this graph was replayed from as in-graph nodes, so a
// consumer holding nothing but a bolt connection can see the recipe without the store.
//
// ============================================================================================
// THE STORE-GENERATION TRANSLATION — the trap that breaks a naive port of the attic finisher
// ============================================================================================
// The incumbent was written against a different store generation. Verified against the live API and schema
// this session (ARCH change-inventory #9 says "verify, don't assume", so it was verified):
//   attic                      ->  live
//   getManifest({manifestKey}) ->  getManifest({refId})              (the TRANSLATION IS IN THE CALL SHAPE,
//   getBlockMeta({blockId})    ->  getBlockMeta({refId})              not only in the columns)
//   manifests.manifestKey      ->  manifests.refId
//   manifests.label / .note    ->  manifests.name / .description
//   manifests.basedOn          ->  manifests.basedOnManifestRefId
//   manifestBlocks.blockId     ->  manifestBlocks.schemaBlockRefId
//   blocks.type                ->  blocks.kind
//   (new)                      ->  manifests.recipeName / recipeHash / recipeFileName
//   (new)                      ->  manifestBlocks.description  (per-membership)
//
// NAMING, DECLARED RATHER THAN SILENT: ARCH §6 calls the spec field `manifestKey`. This module takes
// `manifestRefId`, on TQ's standing identifier ruling (COPPER_OCEAN 2026-07-27): `refId` means ONLY a
// record's own primary key; `<table>RefId` means ONLY a foreign key to that table. The finisher is
// REFERRING to a manifest record, so the reference is `manifestRefId` — which is also exactly what the
// store's own columns call it. The ARCH's own gloss agrees in substance ("the manifest refId this graph
// was materialized from"); only the token differs.
//
// ============================================================================================
// AN ABSENT MANIFEST RETURNS ('', null) — NOT AN ERROR. This is the trap this finisher must not fall into.
// ============================================================================================
// standardsDatabase.getManifest calls back ('', null) when the refId matches no row. A finisher that
// treated a null as "a manifest with no members" would emit an EMPTY RECIPE and report success — a graph
// that says it was built from nothing, with no error anywhere. So a null is REFUSED BY NAME.
//
// ============================================================================================
// purposeSource — RULED BY GRANITE_ECHO 2026-08-31 ON A MEASURED SURVEY
// ============================================================================================
// The Graph Self-Doc design says to take manifestBlocks.description as `purpose` because "a human already
// wrote why this block is in this manifest". THAT PREMISE IS FALSE ON THIS STORE GENERATION, established
// three ways: BY ROW (9 of 9 membership rows match the template, 0 candidates); BY WRITER
// (manifestEditor.add requires a description but its ONLY caller is build.js, which hardcodes three
// template literals in build.js's three membership writes (forged, reused, bridged; line numbers move — grep the literal) — so no human description can
// arrive by any current path); and BY THE STORE'S OWN DESIGN (manifestEditor EXCLUDES descriptions from
// the manifest hash — "fixing a typo in a description must never change a refId" — so the system already
// classifies this text as COMMENTARY, not identity-bearing WARRANT).
//
// So the text is carried AS-IS and labelled with an explicit purposeSource, enum of FOUR:
//     mechanical:forged | mechanical:reused | mechanical:bridged | unrecognized
//
// `authored` IS DELIBERATELY NOT IN THE ENUM. A description matching no template is `unrecognized`, NOT
// authored: authored is a POSITIVE CLAIM ABOUT PROVENANCE, and with no human path in existence a
// non-matching string is far likelier a FOURTH TEMPLATE we have not met than a human. Claiming `authored`
// from a failed regex would be inferring warrant from an absence — this campaign's original sin wearing a
// new coat. When a human channel is built, `authored` arrives WITH that channel, carrying its evidence.
//
// Async style: qtools taskListPlus/pipeRunner; callback(errString, result). No async/await, no
// try/catch-for-control-flow.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// The three templates build.js writes, as RECOGNISERS. Ordered most-specific first: the 'reused' sentence
// also contains the word 'forged' inside "REUSED (not forged)", so a naive 'forged' test would swallow it.
const PURPOSE_SOURCE = {
	FORGED: 'mechanical:forged',
	REUSED: 'mechanical:reused',
	BRIDGED: 'mechanical:bridged',
	UNRECOGNIZED: 'unrecognized',
};
// `site` NAMES THE WRITE, IT DOES NOT LOCATE IT. This field is emitted into the graph as
// `purposeTemplateSite`, so it is DOCUMENTATION THAT SHIPS — and a line number is a comment wearing
// data's clothes: correct the day it is typed and silently false after the next edit above it.
// It had gone false: measured 2026-09-02, all three coordinates were EXACTLY 81 LINES STALE — one
// insertion above them all — and nine nodes of the mounted graph carried them.
// NO REPLACEMENT COORDINATE IS RECORDED HERE, DELIBERATELY. Writing down where the templates sit
// today would rot on the same schedule as the numbers it replaced, in a comment inside the very fix
// for that defect. A token naming the write survives any edit that does not change what the write
// IS. Grep the token to find it; that is the whole point of it.
const PURPOSE_TEMPLATE_MATCHERS = [
	{ token: PURPOSE_SOURCE.REUSED, pattern: /REUSED \(not forged\) by recipe /, site: 'build.js reused-standardBase description write' },
	{ token: PURPOSE_SOURCE.BRIDGED, pattern: /^relationship schema block for .*bridged by bridge /, site: 'build.js bridged-relationship description write' },
	{ token: PURPOSE_SOURCE.FORGED, pattern: /^standardBase schema block for .*forged by recipe /, site: 'build.js forged-standardBase description write' },
];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { NODE_LABELS, SELF_DOC } = vocabulary;
		const forgedLabel = NODE_LABELS.FORGED_NODE;
		const recipeLabel = SELF_DOC.NODE_LABELS.MANIFEST_RECIPE;
		const blockLabel = SELF_DOC.NODE_LABELS.RECIPE_BLOCK;
		const recipePrefix = SELF_DOC.MANIFEST_RECIPE_STABLE_ID_PREFIX;
		const blockPrefix = SELF_DOC.RECIPE_BLOCK_STABLE_ID_PREFIX;
		const tier = SELF_DOC.PROVENANCE_TIER;

		// every metadata node carries ref{source:null} — the honest "computed by the build, parsed from
		// nothing". Cypher's SET += removes the null, so no _source lands and the XOR holds. MEASURED.
		const metadataRef = (oneStableId) => ({ source: null, id: oneStableId });

		// ----- classifyPurpose — the ruled four-token enum. Returns { purpose, purposeSource, templateSite }.
		const classifyPurpose = (descriptionText) => {
			if (typeof descriptionText !== 'string' || descriptionText.trim() === '') {
				return { purpose: null, purposeSource: PURPOSE_SOURCE.UNRECOGNIZED, templateSite: null };
			}
			const matched = PURPOSE_TEMPLATE_MATCHERS.filter((oneMatcher) =>
				oneMatcher.pattern.test(descriptionText),
			)[0];
			if (!matched) {
				return {
					purpose: descriptionText,
					purposeSource: PURPOSE_SOURCE.UNRECOGNIZED,
					templateSite: null,
				};
			}
			return { purpose: descriptionText, purposeSource: matched.token, templateSite: matched.site };
		};

		// ----- walkAncestry — the basedOn chain, CYCLE-GUARDED. Returns the ordered ancestor rows.
		//   A pruned parent ENDS the chain honestly while the child's basedOnManifestRefId still names the
		//   key that went missing — the lineage says "it pointed here and here is gone", not "there was
		//   nothing". Measured note for this generation: EVERY manifest in the live store has a NULL
		//   basedOnManifestRefId, and manifestEditor has no lineage parameter at all, so the chain is
		//   legitimately EMPTY on real data. That is recorded rather than papered over.
		const walkAncestry = ({ storeReader, rootRow }, callback) => {
			const ancestorRows = [];
			const seen = [rootRow.refId];

			const step = (parentRefId) => {
				if (!parentRefId) {
					callback('', ancestorRows);
					return;
				}
				if (seen.indexOf(parentRefId) !== -1) {
					callback(
						`manifest-recipe-finisher: basedOn ancestry CYCLES at '${parentRefId}' — the chain ` +
							`revisits a manifest already in it (${seen.join(' -> ')}). Refusing rather than ` +
							`walking forever or silently truncating.`,
					);
					return;
				}
				seen.push(parentRefId);
				storeReader.getManifest({ refId: parentRefId }, (err, parentRow) => {
					if (err) {
						callback(`manifest-recipe-finisher: getManifest('${parentRefId}') failed: ${err}`);
						return;
					}
					if (!parentRow) {
						// PRUNED PARENT — an honest end. The child still names it; we do not invent a node.
						callback('', ancestorRows);
						return;
					}
					ancestorRows.push(parentRow);
					step(parentRow.basedOnManifestRefId || null);
				});
			};

			step(rootRow.basedOnManifestRefId || null);
		};

		// ----- emit — mode 'emit'. Reads the store; writes nothing.
		const emit = ({ storeReader, manifestRefId } = {}, callback) => {
			if (typeof manifestRefId !== 'string' || manifestRefId.trim() === '') {
				callback(
					`manifest-recipe-finisher: no manifestRefId was supplied — the recipe cannot be ` +
						`materialized without knowing which manifest this graph was replayed from. There is no ` +
						`default and guessing one would put a false lineage in the graph.`,
				);
				return;
			}
			if (!storeReader || typeof storeReader.getManifest !== 'function') {
				callback(
					`manifest-recipe-finisher: a storeReader exposing getManifest is REQUIRED. This is the ` +
						`ONLY finisher that reads the store; without it there is nothing to record.`,
				);
				return;
			}

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				storeReader.getManifest({ refId: manifestRefId }, (err, rootRow) => {
					if (err) {
						next(`manifest-recipe-finisher: getManifest('${manifestRefId}') failed: ${err}`);
						return;
					}
					// ('', null) means NO SUCH MANIFEST. Treating it as an empty one would emit a recipe
					// saying this graph was built from nothing, with no error anywhere.
					if (!rootRow) {
						next(
							`manifest-recipe-finisher: no manifest '${manifestRefId}' in the store. ` +
								`getManifest returned no row (it reports absence as a null result, NOT as an ` +
								`error), and an absent manifest is refused rather than recorded as an empty one.`,
						);
						return;
					}
					next('', { ...args, rootRow });
				});
			});

			taskList.push((args, next) => {
				walkAncestry({ storeReader, rootRow: args.rootRow }, (err, ancestorRows) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, ancestorRows });
				});
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}

				const { rootRow, ancestorRows } = args;
				const nodes = [];
				const edges = [];

				const recipeNodeFor = (oneRow, isRoot) => {
					const stableId = `${recipePrefix}${oneRow.refId}`;
					return {
						stableId,
						ref: metadataRef(stableId),
						labels: [forgedLabel, recipeLabel],
						properties: {
							stableId,
							manifestRefId: oneRow.refId,
							name: oneRow.name || null,
							description: oneRow.description || null,
							recipeName: oneRow.recipeName || null,
							recipeHash: oneRow.recipeHash || null,
							recipeFileName: oneRow.recipeFileName || null,
							basedOnManifestRefId: oneRow.basedOnManifestRefId || null,
							createdAt: oneRow.createdAt || null,
							isRootOfThisGraph: !!isRoot,
							// previousManifestId is HONESTLY NULL — no graphs table exists in this store
							// generation (Graph Self-Doc §9, decided 2026-08-31). Recorded, not omitted, so a
							// consumer sees the field is unavailable rather than wondering if it was forgotten.
							previousManifestId: null,
						},
					};
				};

				nodes.push(recipeNodeFor(rootRow, true));
				ancestorRows.forEach((oneRow) => nodes.push(recipeNodeFor(oneRow, false)));

				// BASED_ON chain: root -> parent -> grandparent. Ancestors get NO HAS_BLOCK fan-out — the
				// lineage is the point, not a second copy of every ancestor's membership.
				const chainRows = [rootRow].concat(ancestorRows);
				chainRows.forEach((oneRow, onePosition) => {
					const parentRow = chainRows[onePosition + 1];
					if (!parentRow) {
						return;
					}
					edges.push({
						type: SELF_DOC.EDGE_TYPES.BASED_ON,
						fromRef: { id: `${recipePrefix}${oneRow.refId}` },
						toRef: { id: `${recipePrefix}${parentRow.refId}` },
						properties: { provenanceTier: tier },
					});
				});

				// HAS_BLOCK fan-out, ROOT ONLY.
				(rootRow.members || []).forEach((oneMember) => {
					const stableId = `${blockPrefix}${oneMember.schemaBlockRefId}`;
					const classified = classifyPurpose(oneMember.description);
					nodes.push({
						stableId,
						ref: metadataRef(stableId),
						labels: [forgedLabel, blockLabel],
						properties: {
							stableId,
							schemaBlockRefId: oneMember.schemaBlockRefId,
							kind: oneMember.kind || null,
							subject: oneMember.subject || null,
							version: oneMember.version || null,
							position: oneMember.position === undefined ? null : oneMember.position,
							purpose: classified.purpose,
							// RULED: the text is carried as-is and LABELLED. 'authored' is not in this enum.
							purposeSource: classified.purposeSource,
							purposeTemplateSite: classified.templateSite,
						},
					});
					edges.push({
						type: SELF_DOC.EDGE_TYPES.HAS_BLOCK,
						fromRef: { id: `${recipePrefix}${rootRow.refId}` },
						toRef: { id: stableId },
						properties: { provenanceTier: tier },
					});
				});

				const memberCount = (rootRow.members || []).length;
				const sourceTally = nodes
					.filter((oneNode) => oneNode.labels.indexOf(blockLabel) !== -1)
					.reduce((tally, oneNode) => {
						const token = oneNode.properties.purposeSource;
						return { ...tally, [token]: (tally[token] || 0) + 1 };
					}, {});

				callback('', {
					nodes,
					edges,
					summary:
						`manifest recipe: ${memberCount} member block(s), ${ancestorRows.length} ancestor(s) in ` +
						`the basedOn chain; purposeSource ${JSON.stringify(sourceTally)}`,
					memberCount,
					ancestorCount: ancestorRows.length,
					purposeSourceTally: sourceTally,
				});
			});
		};

		return { emit, classifyPurpose, PURPOSE_SOURCE, PURPOSE_TEMPLATE_MATCHERS };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
