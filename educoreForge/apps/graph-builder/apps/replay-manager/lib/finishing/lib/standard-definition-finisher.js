'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// standard-definition-finisher.js — registry member 4, mode 'emit' (graphSelfDoc Phase 3, 2026-08-31).
//
// One :StandardDefinition per :DmeStandardRoot — the per-standard header a consumer reads to learn what
// each standard IS, what version it claims, how we know, and whether its mappings mean anything.
//
// THE FIRST FINISHER THAT ACTUALLY READS THE BUILT GRAPH. schemaView derives from the frozen registry and
// manifestRecipe from the store; this one derives from the graph itself, through the injected READ-ONLY
// `readQuery`. That is why the interface grants emitters a read door at all.
//
// ============================================================================================
// WHY IT IS A SEPARATE NODE FROM DmeStandardRoot, AND MUST STAY SEPARATE
// ============================================================================================
// It is tempting to fold these fields onto the content root and have one node per standard. They must stay
// apart for a precise reason: THE DEFINITION'S COUNTS DEPEND ON THE MAPPINGS. Re-bridge the graph and
// exactMappedProperties changes. Put that on the content root and a re-bridge would ALTER A CONTENT NODE —
// and the standard's schema block would stop reproducing byte-for-byte. The split keeps build-dependent
// facts out of the content fingerprint. So: CONNECT, DO NOT MERGE. The consumer still gets one header per
// standard; it is simply the metadata one, with the content root one hop below it via DEFINES.
//
// ============================================================================================
// THE HONESTY RULES — ported deliberately, because they are the point of the node
// ============================================================================================
//   * `version` passes through from the root UNTIDIED. Whatever the forge stamped is what is recorded,
//     including a value we believe to be wrong. Since versionFromStamp (f87f7da, 2026-09-01) a framework
//     forge takes the root's version from the provenance stamp when the source declares none and REFUSES
//     at forge time when a declared version disagrees with the stamp; pre-framework blocks carry whatever
//     their parser reported. It is the content-address byte; tidying it here would make the graph
//     disagree with the schema block it came from.
//   * `versionSource` passes through when present, and defaults to 'declared' ONLY WHEN A VERSION EXISTS.
//     When the version itself is absent it stays NULL. A MISSING VERSION READS AS AN HONEST NULL, NEVER AN
//     INVENTED VALUE — the same shape as the `authored` ruling on purposeSource: do not manufacture a
//     provenance token to fill a hole.
//   * `versionDisagreement` + `versionNote` are set when `version` and `publishedVersion` DIFFER. Carrying
//     both silently is NOT enough: a consumer reading the obvious field would learn one and never the
//     other. The disagreement is itself a fact and gets a field. REACHABILITY: a framework-forged root
//     cannot differ (forge-framework copies the stamp or refuses at forge time), so this branch serves
//     pre-framework-generation blocks — where it HAS fired: the 2026-09-01 five-bridge finish measured
//     one disagreement (SIF, '1.0' beside 'unknown'; COVERAGE-fiveBridgeFinish-090126.md).
//
// ============================================================================================
// DETERMINISM — CYPHER collect() ORDER IS NOT STABLE, AND THIS NODE IS IN FINGERPRINT SCOPE
// ============================================================================================
// :StandardDefinition carries :ForgedNode, so it counts toward the graph fingerprint: twin builds must
// produce identical bytes. Cypher's collect() makes no ordering promise, so EVERY collected list is SORTED
// before it is written. An unsorted collect is a determinism bug that appears only when somebody diffs two
// supposedly identical graphs — long after the build that introduced it.
//
// Async style: callback(errString, result). No async/await, no try/catch-for-control-flow.

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { NODE_LABELS, SELF_DOC, DME_ROLES } = vocabulary;
		const forgedLabel = NODE_LABELS.FORGED_NODE;
		const definitionLabel = SELF_DOC.NODE_LABELS.STANDARD_DEFINITION;
		const definitionPrefix = SELF_DOC.STANDARD_DEFINITION_STABLE_ID_PREFIX;
		const tier = SELF_DOC.PROVENANCE_TIER;
		const rootRole = DME_ROLES.STANDARD_ROOT;

		const metadataRef = (oneStableId) => ({ source: null, id: oneStableId });
		const sorted = (oneList) => (oneList || []).map((oneValue) => `${oneValue}`).sort();

		// ----- THE DERIVATION QUERY. One pass, read-only. Counts are per-standard and deterministic
		//   functions of the built graph. The EXACT/CLOSE counts are read from match presence; the mapping kinds and
		//   sources from the mappingKind / mappingSource on the edges (lane P), never from the edge type or the producer.
		const DERIVATION_CYPHER = `
			MATCH (root:\`${rootRole}\`)
			OPTIONAL MATCH (root)<-[:HAS_CLASS|HAS_PROPERTY*1..]-()
			WITH root
			OPTIONAL MATCH (p {_source: root._source}) WHERE p.role = 'DmeProperty'
			WITH root, count(DISTINCT p) AS propertyCount
			OPTIONAL MATCH (c {_source: root._source}) WHERE c.role = 'DmeClass'
			WITH root, propertyCount, count(DISTINCT c) AS classCount
			OPTIONAL MATCH (ov {_source: root._source}) WHERE ov.role = 'DmeOptionValue'
			WITH root, propertyCount, classCount, count(DISTINCT ov) AS optionValueCount
			OPTIONAL MATCH (e {_source: root._source})-[:EXACT_MATCH]->(:HubReference)
			WITH root, propertyCount, classCount, optionValueCount, count(DISTINCT e) AS exactMappedProperties
			OPTIONAL MATCH (cl {_source: root._source})-[:CLOSE_MATCH]->(:HubReference)
			WITH root, propertyCount, classCount, optionValueCount, exactMappedProperties,
			     count(DISTINCT cl) AS closeMappedProperties
			OPTIONAL MATCH (mk {_source: root._source})-[mkEdge]->(:HubReference)
			WITH root, propertyCount, classCount, optionValueCount, exactMappedProperties, closeMappedProperties,
			     collect(DISTINCT mkEdge.mappingKind) AS mappingKindList,
			     collect(DISTINCT mkEdge.mappingSource) AS mappingSourceList,
			     count(CASE WHEN mkEdge IS NOT NULL AND mkEdge.mappingKind IS NULL THEN 1 END) AS unkindedMappingEdgeCount
			OPTIONAL MATCH (any {_source: root._source})-[m]->(:HubReference)
			RETURN root._source AS sourceKey,
			       root.standardKey AS standardKey, root.standardName AS standardName,
			       root.version AS version, root.versionSource AS versionSource,
			       root.publishedVersion AS publishedVersion, root.snapshotKey AS snapshotKey,
			       root.sourceFormat AS sourceFormat, root.sourceUrl AS sourceUrl,
			       root.stableId AS rootStableId,
			       root.standardKind AS standardKind, root.standardUsageTips AS standardUsageTips,
			       root.standardFamily AS standardFamily, root.releaseLabel AS releaseLabel,
			       propertyCount, classCount, optionValueCount,
			       exactMappedProperties, closeMappedProperties,
			       mappingKindList, mappingSourceList, unkindedMappingEdgeCount,
			       collect(DISTINCT type(m)) AS mappingEdgeTypes
			ORDER BY sourceKey`;

		// ----- shapeOne — the honesty rules, applied to one root row.
		// shapeOne(oneRow) — standardKind and standardUsageTips pass through FROM THE ROOT, where the standard's own forge
		// declaration put them (lane R, 2026-10-05; TQ: they were a configs side file, lane P's acknowledged stopgap). A root
		// without one (its forge declared no tips, or the block was forged before forges declared them) gives a card without
		// it: absent is absent, never invented text.
		const shapeOne = (oneRow) => {
			const version = oneRow.version || null;
			// 'declared' ONLY when a version exists; NULL otherwise. Never an invented token.
			const versionSource = oneRow.versionSource || (version ? 'declared' : null);
			const publishedVersion = oneRow.publishedVersion || null;

			// The disagreement is itself a FACT and gets a field. Carrying both numbers silently would let
			// a consumer read the obvious field and never learn the other exists.
			const versionDisagreement = !!(version && publishedVersion && version !== publishedVersion);
			const versionNote = versionDisagreement
				? `The parser reported version '${version}' while the standard's published version is ` +
					`'${publishedVersion}' (versionSource '${versionSource}'). Both are recorded. '${version}' is ` +
					`the value that entered the content address and therefore the schema block; ` +
					`'${publishedVersion}' is what the standard actually is. They disagree and that disagreement ` +
					`is deliberate to surface, not an error to resolve here.`
				: null;

			const exact = Number(oneRow.exactMappedProperties || 0);
			const close = Number(oneRow.closeMappedProperties || 0);
			// ⟪lane P, 2026-10-04; TQ⟫ what kind of mapping a standard has, and who made it, in the SAME vocabulary as its
			// edges: the distinct mappingKind and mappingSource values its own match edges carry, read from the graph and
			// SORTED (collect() order is not stable and this node is in fingerprint scope). Never hand-typed, and never
			// inferred from the relation type: the retired mappingDisposition was ('authored' for any EXACT_MATCH), and it
			// called 9 of 10 standards in GOLD_EVAL_261002_jevFresh authored when all 12,698 edges were Jev judgments. A
			// standard with no match edge (CEDS, the hub) says so with two EMPTY lists.
			const mappingKindList = sorted(oneRow.mappingKindList).filter((oneValue) => oneValue !== 'null');
			const mappingSourceList = sorted(oneRow.mappingSourceList).filter((oneValue) => oneValue !== 'null');

			const stableId = `${definitionPrefix}${oneRow.sourceKey}`;
			return {
				stableId,
				ref: metadataRef(stableId),
				labels: [forgedLabel, definitionLabel],
				properties: {
					stableId,
					sourceKey: oneRow.sourceKey,
					standardKey: oneRow.standardKey || null,
					standardName: oneRow.standardName || null,
					version,
					versionSource,
					publishedVersion,
					versionDisagreement,
					versionNote,
					snapshotKey: oneRow.snapshotKey || null,
					sourceFormat: oneRow.sourceFormat || null,
					sourceUrl: oneRow.sourceUrl || null,
					propertyCount: Number(oneRow.propertyCount || 0),
					classCount: Number(oneRow.classCount || 0),
					optionValueCount: Number(oneRow.optionValueCount || 0),
					exactMappedProperties: exact,
					closeMappedProperties: close,
					mappingKindList,
					mappingSourceList,
					...(oneRow.standardKind ? { standardKind: oneRow.standardKind } : {}),
					// ⟪campaign P3, W-C-4⟫ REQUIRED, never spread-if-present: a root without them was forged before the contract, and
					// the rows are refused by name before shaping (below)
					standardFamily: oneRow.standardFamily,
					releaseLabel: oneRow.releaseLabel,
					...(oneRow.standardUsageTips ? { standardUsageTips: oneRow.standardUsageTips } : {}),
					// SORTED — collect() order is not stable and this node is in fingerprint scope.
					mappingEdgeTypes: sorted(oneRow.mappingEdgeTypes).filter((oneType) => oneType !== 'null'),
				},
				rootStableId: oneRow.rootStableId || null,
			};
		};

		// ----- emit — mode 'emit'. Reads the graph through readQuery; writes nothing.
		const emit = ({ readQuery } = {}, callback) => {
			if (typeof readQuery !== 'function') {
				callback(
					`standard-definition-finisher: a readQuery is REQUIRED. This finisher DERIVES every field ` +
						`from the built graph — without a read door there is nothing to derive from, and ` +
						`emitting a definition assembled from nothing would be an invention.`,
				);
				return;
			}

			readQuery({ cypher: DERIVATION_CYPHER }, (err, result) => {
				if (err) {
					callback(`standard-definition-finisher: the derivation query failed: ${err}`);
					return;
				}

				const rows = ((result && result.records) || []).map((oneRecord) => ({
					sourceKey: oneRecord.get('sourceKey'),
					standardKey: oneRecord.get('standardKey'),
					standardName: oneRecord.get('standardName'),
					version: oneRecord.get('version'),
					versionSource: oneRecord.get('versionSource'),
					publishedVersion: oneRecord.get('publishedVersion'),
					snapshotKey: oneRecord.get('snapshotKey'),
					sourceFormat: oneRecord.get('sourceFormat'),
					sourceUrl: oneRecord.get('sourceUrl'),
					rootStableId: oneRecord.get('rootStableId'),
					standardKind: oneRecord.get('standardKind'),
					standardUsageTips: oneRecord.get('standardUsageTips'),
					standardFamily: oneRecord.get('standardFamily'),
					releaseLabel: oneRecord.get('releaseLabel'),
					propertyCount: oneRecord.get('propertyCount'),
					classCount: oneRecord.get('classCount'),
					optionValueCount: oneRecord.get('optionValueCount'),
					exactMappedProperties: oneRecord.get('exactMappedProperties'),
					closeMappedProperties: oneRecord.get('closeMappedProperties'),
					mappingKindList: oneRecord.get('mappingKindList'),
					mappingSourceList: oneRecord.get('mappingSourceList'),
					unkindedMappingEdgeCount: oneRecord.get('unkindedMappingEdgeCount'),
					mappingEdgeTypes: oneRecord.get('mappingEdgeTypes'),
				}));

				// A mapping edge with no mappingKind cannot be classified, and calling its standard an island, or
				// anything else, would invent the answer. Refused by name, naming the standards that carry one.
				const unkindedRowList = rows.filter((oneRow) => Number(oneRow.unkindedMappingEdgeCount || 0) > 0);
				if (unkindedRowList.length > 0) {
					callback(
						`standard-definition-finisher REFUSED: ${unkindedRowList.map((oneRow) => `${oneRow.sourceKey} (${Number(oneRow.unkindedMappingEdgeCount)})`).join(', ')} ` +
							`carry mapping edges with no mappingKind, so the standard's mappingKindList cannot be read from the graph. Every mapping ` +
							`edge the bridge framework writes carries one (lane P, 2026-10-04); an edge without it predates that or came from elsewhere.`,
					);
					return;
				}

				// ⟪campaign P3, W-C-4⟫ every root declares its family and release label (forge declaration, stamped on the root); a
				// root without them is a block forged before the contract — refused by name, never a card that guesses
				const familylessRowList = rows.filter((oneRow) => typeof oneRow.standardFamily !== 'string' || !oneRow.standardFamily || typeof oneRow.releaseLabel !== 'string' || !oneRow.releaseLabel);
				if (familylessRowList.length > 0) {
					callback(
						`standard-definition-finisher REFUSED: ${familylessRowList.map((oneRow) => `${oneRow.sourceKey} (standardFamily ${JSON.stringify(oneRow.standardFamily)}, releaseLabel ${JSON.stringify(oneRow.releaseLabel)})`).join(', ')} ` +
							`carry no forge-declared family and release label on their root: the block was forged before the contract (W-C-4). Re-forge it.`,
					);
					return;
				}

				// A graph with no standard roots is not an error — a metadata-only or empty graph is a real
				// state — but it IS reported, so an empty result is never mistaken for a successful census.
				const shaped = rows.map((oneRow) => shapeOne(oneRow));
				const nodes = shaped.map((oneShaped) => {
					const { rootStableId, ...oneNode } = oneShaped;
					return oneNode;
				});

				// DEFINES — the ONE metadata->content edge, and the only new edge that is not
				// passport-rooted. Both endpoints are :ForgedNode, so it rides Channel A like content.
				// Emitted ONLY where the root's stableId is known: an edge to a guessed endpoint would
				// silently land in danglingRefs while the run exits 0.
				const edges = shaped
					.filter((oneShaped) => !!oneShaped.rootStableId)
					.map((oneShaped) => ({
						type: SELF_DOC.EDGE_TYPES.DEFINES,
						fromRef: { id: oneShaped.stableId },
						toRef: { id: oneShaped.rootStableId },
						properties: { provenanceTier: tier },
					}));

				// tallied by the standard's sorted mappingKind list ('' = no match edge, the hub)
				const dispositionTally = nodes.reduce(
					(tally, oneNode) => ({
						...tally,
						[oneNode.properties.mappingKindList.join('+')]: (tally[oneNode.properties.mappingKindList.join('+')] || 0) + 1,
					}),
					{},
				);
				const disagreements = nodes.filter((oneNode) => oneNode.properties.versionDisagreement);
				// a standard whose root declares no kind was forged before forges declared one: said, never hidden
				const unkindedStandardList = nodes.filter((oneNode) => !oneNode.properties.standardKind).map((oneNode) => oneNode.properties.sourceKey);

				callback('', {
					nodes,
					edges,
					summary:
						`standard definitions: ${nodes.length} standard(s), disposition ` +
						`${JSON.stringify(dispositionTally)}, ${disagreements.length} version disagreement(s), ` +
						`${edges.length} DEFINES edge(s), ${unkindedStandardList.length} with no forge-declared standardKind` +
						(unkindedStandardList.length ? ` (${unkindedStandardList.join(', ')})` : ''),
					standardCount: nodes.length,
					dispositionTally,
					versionDisagreementCount: disagreements.length,
					definesEdgeCount: edges.length,
					unkindedStandardList,
				});
			});
		};

		return { emit, shapeOne, DERIVATION_CYPHER };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
