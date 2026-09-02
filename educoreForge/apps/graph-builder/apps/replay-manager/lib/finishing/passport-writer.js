'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// passport-writer.js — CHANNEL B (graphSelfDoc Phase 4, 2026-09-01).
//
// It sits BESIDE finishing.js rather than inside lib/ with the finishers, and that placement is the
// point: THE PASSPORT IS NOT A REGISTRY MEMBER. It is written by the verb after the whole registry has
// run, because it COUNTS WHAT THE REGISTRY PRODUCED.
//
// ============================================================================================
// WHY A SEPARATE CHANNEL AT ALL — the engine's Guard 1 decides it, and Guard 1 is RIGHT
// ============================================================================================
// `GraphProvenance` is deliberately NOT `:ForgedNode`: it carries `builtAt`, a clock, so it is excluded
// from content fingerprints by construction. Guard 1 refuses non-ForgedNode writes on the shared path,
// and edges to a non-ForgedNode endpoint cannot resolve through mergeEdges anyway. So this writer is a
// small dedicated cypher path — exactly the shape the incumbent's stampProvenance had — rather than a
// bypass of the shared write path. Channel A stays the ONLY way content-shaped nodes are written.
//
// ============================================================================================
// MATCH, NEVER MERGE, ON EVERY FAR ENDPOINT — honest degradation is the whole design
// ============================================================================================
// Every passport-rooted edge MATCHes its target. If a finisher was disabled its target does not exist,
// the MATCH yields zero rows, and NO EDGE APPEARS — and that silence is reported rather than hidden.
// MERGE would CREATE the missing endpoint as a bare node, so a disabled finisher would leave behind an
// invented link to an empty shell that a consumer would read as a real claim. The report says which
// edge families landed and which came back empty, so an absence is legible instead of merely quiet.
//
// ============================================================================================
// THE -Key SUFFIX HERE IS RULED, NOT OVERLOOKED (GRANITE_ECHO, 2026-08-31)
// ============================================================================================
// `passportKey` is a CONSTANT DISCRIMINATOR whose only job is to make MERGE find the one passport — it
// identifies nothing among alternatives, so `passportRefId` would assert an identity it does not have
// and `passportName` would misdescribe it ('graphProvenance' is not the passport's name). Keyed on the
// constant rather than on graphName so GNC-001 promotion-by-rename cannot orphan it. The full ruling
// lives in the GraphProvenance human definition in vocabulary-definitions.js.
//
// ============================================================================================
// THE SELF-STAMP IS LOAD-BEARING
// ============================================================================================
// The passport SETs `:GraphMeta` on itself in the same MERGE. It must: the graphMeta registry sweep ran
// BEFORE this node existed and could not have stamped it, and an unstamped passport carries no `_source`
// either — so it would be a NEITHER-SIDE violation of the XOR the moment it is created. The verb's
// post-Channel-B recheck (work order gate (g)) is what proves this, and withholding this one SET is that
// gate's RED twin.
//
// ============================================================================================
// standardsIncluded VERSUS THE MANIFEST'S SUBJECTS — A CORRESPONDENCE NOTHING CHECKS (Lane B, 2026-09-02)
// ============================================================================================
// `standardsIncluded` lists distinct `_source` values, which are descriptor `standardName`s; manifest
// subjects are prefixed by bundle DIRECTORY names. They correspond through the descriptor, G-SOURCE,
// G-UNIQUE and hub invariant I12 — not through any check that reads both sides. Verified by reading for
// the four bundles, 2026-09-02.
//
// Async style: qtools taskListPlus/pipeRunner; callback(errString, result). No async/await, no
// try/catch-for-control-flow.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { NODE_LABELS, SELF_DOC, SCHEMA_VIEW, GRAPH_META, PROVENANCE_TIER } = vocabulary;

		const passportLabel = NODE_LABELS.GRAPH_PROVENANCE;
		const metaLabel = GRAPH_META.LABEL;
		const edgeTypes = SELF_DOC.EDGE_TYPES;

		// RULED EXCEPTION — see the header. Named constants so neither string is a magic literal.
		const PASSPORT_KEY_PROPERTY = 'passportKey';
		const PASSPORT_SINGLETON_VALUE = 'graphProvenance';
		const SOURCE_PROPERTY = '_source';

		// ----- THE EDGE PLAN, as DATA. Adding a passport-rooted edge family is one row here; no logic below
		//   changes. Each row names the far endpoint by LABEL and the report line it produces.
		const EDGE_PLAN = [
			{
				name: 'builtFrom',
				edgeType: edgeTypes.BUILT_FROM,
				targetLabel: SELF_DOC.NODE_LABELS.MANIFEST_RECIPE,
				// ⟪DEFECT FOUND AND FIXED, 2026-09-01, in the Phase 4 green pass⟫ This row originally carried
				// NO target constraint, so the MATCH found EVERY :ManifestRecipe node — including the two
				// ANCESTORS the recipe finisher writes for the basedOn chain — and the passport asserted
				// BUILT_FROM to all three. The vocabulary is singular and definite: "the ManifestRecipe this
				// graph was replayed from". Three edges said this graph was replayed from three manifests,
				// which is FALSE: it was replayed from one, and the other two are its ANCESTRY, correctly
				// reachable by following BASED_ON from the primary recipe.
				// It survived the first bed because the assertion read `edgeCount > 0` rather than `=== 1` —
				// a gate under-enforcing its stated contract, which is this project's oldest recorded pattern.
				targetStableIdFromManifestRefId: true,
				absenceMeaning:
					'the manifestRecipe finisher was disabled, or no ManifestRecipe exists for THIS manifest ' +
					'(an ancestor recipe being present is not a substitute — it is not what this graph was built from)',
			},
			{
				name: 'hasView',
				edgeType: edgeTypes.HAS_VIEW,
				targetLabel: SCHEMA_VIEW.LABEL,
				targetStableId: SCHEMA_VIEW.ROOT_STABLE_ID,
				absenceMeaning: 'the schemaView finisher was disabled',
			},
			{
				name: 'describes',
				edgeType: edgeTypes.DESCRIBES,
				targetLabel: SELF_DOC.NODE_LABELS.STANDARD_DEFINITION,
				absenceMeaning: 'the standardDefinition finisher was disabled, or the graph has no standard roots',
			},
			{
				name: 'attests',
				edgeType: edgeTypes.ATTESTS,
				targetLabel: SELF_DOC.NODE_LABELS.BUILD_ATTESTATION,
				absenceMeaning: 'the buildAttestation finisher was disabled',
			},
			{
				name: 'advises',
				edgeType: edgeTypes.ADVISES,
				targetLabel: SELF_DOC.NODE_LABELS.USAGE_PATTERN,
				absenceMeaning: 'the usagePattern finisher was disabled',
			},
		];

		const numberFrom = (oneRecord, oneColumnName) => Number(oneRecord.get(oneColumnName) || 0);
		const cypherString = (oneValue) => `'${`${oneValue}`.replace(/'/g, "\\'")}'`;

		// ----- THE CENSUS. Content facts only — the passport counts the graph, never itself. Written
		//   against the XOR: content is exactly the `_source`-bearing side, so this can never drift from
		//   the invariant graphMeta enforces.
		const CONTENT_CENSUS_CYPHER = `
			MATCH (n) WHERE n.\`${SOURCE_PROPERTY}\` IS NOT NULL
			RETURN count(n) AS contentNodeCount,
			       count(DISTINCT n.\`${SOURCE_PROPERTY}\`) AS standardCount,
			       collect(DISTINCT n.\`${SOURCE_PROPERTY}\`) AS standardsIncluded`;

		const CONTENT_EDGE_CENSUS_CYPHER = `
			MATCH (a)-[r]->(b) WHERE NOT a:\`${metaLabel}\` AND NOT b:\`${metaLabel}\`
			RETURN count(r) AS contentEdgeCount`;

		// Tier distribution over MEANING-BEARING edges. 'structural' is OUR OWN metadata scaffolding and
		// says nothing about whether the graph's cross-standard claims can be relied on, so it is excluded
		// here rather than allowed to dilute the verdict. Grouped by tier AND type so the report can show
		// what actually carries the claim rather than a single flattened number.
		const MEANING_TIER_CENSUS_CYPHER = `
			MATCH ()-[r]->()
			WHERE r.provenanceTier IS NOT NULL AND r.provenanceTier <> ${cypherString(PROVENANCE_TIER.STRUCTURAL)}
			RETURN type(r) AS edgeType, r.provenanceTier AS provenanceTier, count(r) AS tierCount
			ORDER BY edgeType, provenanceTier`;

		// ----- trustVerdict — THE HONEST ANSWER, NOT THE FLATTERING ONE (work order gate (d)).
		//   Derived from the tiers actually present. Every false verdict carries its REASON, because a bare
		//   `false` is indistinguishable from a default and a consumer cannot act on it.
		const trustVerdict = (meaningTierRowList) => {
			const meaningBearingCount = meaningTierRowList.reduce(
				(runningTotal, oneRow) => runningTotal + oneRow.tierCount,
				0,
			);
			const invalidDebugCount = meaningTierRowList
				.filter((oneRow) => oneRow.provenanceTier === PROVENANCE_TIER.INVALID_DEBUG)
				.reduce((runningTotal, oneRow) => runningTotal + oneRow.tierCount, 0);

			if (!meaningBearingCount) {
				return {
					trustworthyForMeaning: false,
					trustBasis: 'noMeaningBearingEdges',
					trustNote:
						'This graph asserts NO cross-standard meaning at all: every edge carrying a provenanceTier ' +
						'is structural scaffolding. That is not a defect — it is an island graph — but nothing here ' +
						'may be relied on for equivalence between standards.',
				};
			}
			if (invalidDebugCount) {
				return {
					trustworthyForMeaning: false,
					trustBasis: 'invalidDebugPresent',
					trustNote:
						`${invalidDebugCount} of ${meaningBearingCount} meaning-bearing edge(s) carry the ` +
						`'${PROVENANCE_TIER.INVALID_DEBUG}' tier, produced by a debug judge that takes the first ` +
						'candidate unconditionally. NOTHING informed those choices. They are recorded honestly ' +
						'rather than dressed as inference, and their presence makes this graph unfit to be relied ' +
						'on for meaning — which is the true answer and the one this passport is required to give.',
				};
			}
			return {
				trustworthyForMeaning: true,
				trustBasis: 'allMeaningBearingEdgesCarryAValidTier',
				trustNote:
					`All ${meaningBearingCount} meaning-bearing edge(s) carry a tier that asserts a real basis. ` +
					'This is a claim about PROVENANCE, not about correctness: it says how the mappings were ' +
					'arrived at, not that they are right.',
			};
		};


		// ----- write — THE CHANNEL-B PATH. Census, then MERGE the singleton, then MATCH-only edges, then
		//   round-trip-or-refuse. `builtAt` is INJECTABLE so a gate can pin it; it defaults to the real
		//   clock, and it is the ONLY clock this whole verb is permitted to read.
		const write = (
			{ runCypher, manifestRefId, engineVersions, graphName, builtAt } = {},
			callback,
		) => {
			if (typeof runCypher !== 'function') {
				callback(
					`passport-writer: a runCypher is REQUIRED. The passport is a claim about the live graph and ` +
						`cannot be assembled without reading it.`,
				);
				return;
			}
			if (!manifestRefId) {
				callback(
					`passport-writer: a manifestRefId is REQUIRED. "Which manifest was this graph replayed from" ` +
						`is the passport's CENTRAL claim — writing one without it would produce a build record that ` +
						`cannot answer the question it exists to answer.`,
				);
				return;
			}

			const stampedAt = builtAt || new Date().toISOString();
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				runCypher({ cypher: CONTENT_CENSUS_CYPHER }, (err, result) => {
					if (err) {
						next(`passport-writer: the content census failed: ${err}`);
						return;
					}
					const rows = (result && result.records) || [];
					if (!rows.length) {
						next(
							`passport-writer: the content census returned NO ROWS. This aggregate returns a row even ` +
								`over an empty graph, so no row means the query did not run as written — it is NOT ` +
								`evidence that the graph is empty.`,
						);
						return;
					}
					next('', {
						...args,
						contentNodeCount: numberFrom(rows[0], 'contentNodeCount'),
						standardCount: numberFrom(rows[0], 'standardCount'),
						// SORTED for a stable, readable passport. Not a fingerprint concern — GraphProvenance is
						// excluded from fingerprints by construction — but an unsorted list invites a false diff.
						standardsIncluded: (rows[0].get('standardsIncluded') || [])
							.map((oneSource) => `${oneSource}`)
							.sort(),
					});
				});
			});

			taskList.push((args, next) => {
				runCypher({ cypher: CONTENT_EDGE_CENSUS_CYPHER }, (err, result) => {
					if (err) {
						next(`passport-writer: the content-edge census failed: ${err}`);
						return;
					}
					const rows = (result && result.records) || [];
					next('', { ...args, contentEdgeCount: rows.length ? numberFrom(rows[0], 'contentEdgeCount') : 0 });
				});
			});

			taskList.push((args, next) => {
				runCypher({ cypher: MEANING_TIER_CENSUS_CYPHER }, (err, result) => {
					if (err) {
						next(`passport-writer: the meaning-tier census failed: ${err}`);
						return;
					}
					// ZERO ROWS IS A REAL AND MEANINGFUL ANSWER HERE, unlike the aggregates above: it means the
					// graph carries no meaning-bearing edges at all, which trustVerdict reports as its own basis.
					const meaningTierRowList = ((result && result.records) || []).map((oneRecord) => ({
						edgeType: oneRecord.get('edgeType'),
						provenanceTier: oneRecord.get('provenanceTier'),
						tierCount: numberFrom(oneRecord, 'tierCount'),
					}));
					next('', { ...args, meaningTierRowList, trust: trustVerdict(meaningTierRowList) });
				});
			});

			// ----- MERGE the singleton and SELF-STAMP :GraphMeta in the SAME statement. The stamp is not a
			//   tidy-up: the registry sweep already ran, so an unstamped passport carries neither _source nor
			//   :GraphMeta and violates the XOR the instant it exists.
			taskList.push((args, next) => {
				const meaningBearingEdgeCount = args.meaningTierRowList.reduce(
					(runningTotal, oneRow) => runningTotal + oneRow.tierCount,
					0,
				);
				const cypher = `
					MERGE (p:\`${passportLabel}\` {\`${PASSPORT_KEY_PROPERTY}\`: ${cypherString(PASSPORT_SINGLETON_VALUE)}})
					SET p:\`${metaLabel}\`,
					    p.builtAt = ${cypherString(stampedAt)},
					    p.manifestRefId = ${cypherString(manifestRefId)},
					    p.graphName = ${cypherString(graphName || 'unknown')},
					    p.engineVersions = ${cypherString(JSON.stringify(engineVersions || {}))},
					    p.contentNodeCount = ${args.contentNodeCount},
					    p.contentEdgeCount = ${args.contentEdgeCount},
					    p.standardCount = ${args.standardCount},
					    p.standardsIncluded = [${args.standardsIncluded.map(cypherString).join(', ')}],
					    p.meaningBearingEdgeCount = ${meaningBearingEdgeCount},
					    p.meaningTierBreakdown = ${cypherString(JSON.stringify(args.meaningTierRowList))},
					    p.trustworthyForMeaning = ${args.trust.trustworthyForMeaning},
					    p.trustBasis = ${cypherString(args.trust.trustBasis)},
					    p.trustNote = ${cypherString(args.trust.trustNote)},
					    p.previousManifestRefIdBasis = ${cypherString(
								'unavailable: this generation has no graphs table, so no prior build is recorded ' +
									'anywhere for this writer to read. Recorded as an explicit basis rather than an ' +
									'absent property, because an absent property is indistinguishable from one never written.',
							)}
					RETURN elementId(p) AS passportElementId`;
				runCypher({ cypher }, (err, result) => {
					if (err) {
						next(`passport-writer: the passport MERGE failed: ${err}`);
						return;
					}
					const rows = (result && result.records) || [];
					if (!rows.length) {
						next(`passport-writer: the passport MERGE returned no row — the singleton was not written.`);
						return;
					}
					next('', { ...args, meaningBearingEdgeCount, passportElementId: `${rows[0].get('passportElementId')}` });
				});
			});

			// ----- the passport-rooted edges, one task per EDGE_PLAN row. MATCH the far endpoint, MERGE only
			//   the RELATIONSHIP between two nodes that already exist. A missing target yields zero rows and
			//   NO EDGE — and the absence is recorded with its meaning rather than passing silently.
			const edgeReportList = [];
			EDGE_PLAN.forEach((onePlan) => {
				taskList.push((args, next) => {
					// The target may be pinned by a CONSTANT stableId (schemaView's root) or by one RESOLVED
					// from this run's manifest (builtFrom). An unpinned label match is correct only where every
					// node of that label is genuinely a target of the edge.
					const resolvedTargetStableId =
						onePlan.targetStableId ||
						(onePlan.targetStableIdFromManifestRefId
							? `${SELF_DOC.MANIFEST_RECIPE_STABLE_ID_PREFIX}${manifestRefId}`
							: null);
					const targetPredicate = resolvedTargetStableId
						? ` {stableId: ${cypherString(resolvedTargetStableId)}}`
						: '';
					const cypher = `
						MATCH (p:\`${passportLabel}\` {\`${PASSPORT_KEY_PROPERTY}\`: ${cypherString(PASSPORT_SINGLETON_VALUE)}})
						MATCH (target:\`${onePlan.targetLabel}\`${targetPredicate})
						MERGE (p)-[e:\`${onePlan.edgeType}\`]->(target)
						SET e.provenanceTier = ${cypherString(SELF_DOC.PROVENANCE_TIER)}
						RETURN count(e) AS edgeCount`;
					runCypher({ cypher }, (err, result) => {
						if (err) {
							next(`passport-writer: creating ${onePlan.edgeType} edges failed: ${err}`);
							return;
						}
						const rows = (result && result.records) || [];
						const edgeCount = rows.length ? numberFrom(rows[0], 'edgeCount') : 0;
						edgeReportList.push({
							name: onePlan.name,
							edgeType: onePlan.edgeType,
							targetLabel: onePlan.targetLabel,
							edgeCount,
							degraded: edgeCount === 0,
							absenceMeaning: edgeCount === 0 ? onePlan.absenceMeaning : null,
						});
						next('', args);
					});
				});
			});

			// ----- ROUND-TRIP-OR-REFUSE. Ask the database what it actually holds rather than trusting the
			//   writes above to have meant what they said.
			taskList.push((args, next) => {
				runCypher(
					{
						cypher: `
							MATCH (p:\`${passportLabel}\`)
							RETURN count(p) AS passportCount,
							       sum(CASE WHEN p:\`${metaLabel}\` THEN 0 ELSE 1 END) AS unstampedCount`,
					},
					(err, result) => {
						if (err) {
							next(`passport-writer: the round-trip verification query failed: ${err}`);
							return;
						}
						const rows = (result && result.records) || [];
						const passportCount = rows.length ? numberFrom(rows[0], 'passportCount') : 0;
						const unstampedCount = rows.length ? numberFrom(rows[0], 'unstampedCount') : 0;
						if (passportCount !== 1) {
							next(
								`passport-writer: THE SINGLETON IS NOT SINGULAR — found ${passportCount} ` +
									`:${passportLabel} node(s) after writing, expected exactly 1. The MERGE is keyed on ` +
									`${PASSPORT_KEY_PROPERTY}=${PASSPORT_SINGLETON_VALUE} precisely so a second finish ` +
									`updates the one passport rather than minting another; more than one means a passport ` +
									`exists that this key does not reach, and a consumer would have no way to choose.`,
							);
							return;
						}
						if (unstampedCount) {
							next(
								`passport-writer: the passport was written WITHOUT :${metaLabel}. It carries no ` +
									`${SOURCE_PROPERTY} either, so it violates the purity invariant the moment it exists — ` +
									`the registry sweep ran before this node and cannot cover it, which is why the stamp is ` +
									`part of the MERGE rather than a later pass.`,
							);
							return;
						}
						next('', args);
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const degradedList = edgeReportList.filter((oneEntry) => oneEntry.degraded);
				callback('', {
					passportElementId: args.passportElementId,
					builtAt: stampedAt,
					manifestRefId,
					contentNodeCount: args.contentNodeCount,
					contentEdgeCount: args.contentEdgeCount,
					standardCount: args.standardCount,
					standardsIncluded: args.standardsIncluded,
					meaningBearingEdgeCount: args.meaningBearingEdgeCount,
					meaningTierRowList: args.meaningTierRowList,
					trust: args.trust,
					edgeReportList,
					degradedList,
					summary:
						`passport written (singleton verified, :${metaLabel} self-stamped): ` +
						`${args.contentNodeCount} content node(s), ${args.contentEdgeCount} content edge(s), ` +
						`${args.standardCount} standard(s); trustworthyForMeaning=${args.trust.trustworthyForMeaning} ` +
						`(${args.trust.trustBasis}); edges ` +
						`${edgeReportList.map((oneEntry) => `${oneEntry.edgeType}=${oneEntry.edgeCount}`).join(' ')}` +
						`${degradedList.length ? ` — ${degradedList.length} edge family(ies) ABSENT and reported, not hidden` : ''}`,
				});
			});
		};


		// ============================================================================================
		// GATE (i) — THE usagePatternVerification ROW (ruled by GRANITE_ECHO 2026-08-31)
		// ============================================================================================
		// The stage-2 exemplar verdict CANNOT EXIST until after Channel B, because passport-rooted
		// exemplars require the passport. So it can never be handed to the Channel-A attestation finisher
		// in the same run, and the verb writes it here instead — through the passport's own mechanism.
		// The finisher stays a pure consumer; no already-written node is mutated.
		const VERIFICATION_GATE_NAME = 'usagePatternVerification';

		// ⟪RULED 2026-09-01, GRANITE_ECHO — option (i): OMIT :ForgedNode⟫ Held as DATA, which is why
		// adopting the ruling was a zero-line change: the answer was already this list.
		// THE DECIDING ARGUMENT was fingerprint coherence. Channel B exists precisely BECAUSE Guard 1 refuses
		// non-ForgedNode writes on the shared path, so stamping :ForgedNode on a node written outside
		// writeShapedGraph would undermine the guard that makes the two-channel split mean anything.
		// Substantively too: this verdict DEPENDS ON THE PASSPORT, which is excluded from fingerprints by
		// construction — a fingerprint-scoped node deriving from a fingerprint-EXCLUDED one is incoherent.
		// THE ARGUMENT AGAINST was real and was ANSWERED rather than waived: it makes (:BuildAttestation)
		// a MIXED population — three rows in fingerprint scope, this one not — so a diff taken over
		// :ForgedNode silently omits the row saying whether the usage manual was verified. The mandated
		// remedy is in the BuildAttestation term definition: it states the split, WHY, and the consumer
		// warning to query (:BuildAttestation) rather than (:ForgedNode:BuildAttestation).
		const VERIFICATION_ATTESTATION_LABEL_LIST = [SELF_DOC.NODE_LABELS.BUILD_ATTESTATION, metaLabel];

		const writeVerificationAttestation = (
			{ runCypher, verdict, detail, exemplarCount, verifiedCount } = {},
			callback,
		) => {
			if (typeof runCypher !== 'function') {
				callback(`passport-writer.writeVerificationAttestation: a runCypher is REQUIRED.`);
				return;
			}
			if (typeof verdict !== 'string' || !verdict.trim()) {
				callback(
					`passport-writer.writeVerificationAttestation: a non-empty verdict is REQUIRED. Writing an ` +
						`attestation with no verdict would produce exactly the silence :BuildAttestation exists to ` +
						`abolish — a consumer would read the row's presence as reassurance and learn nothing.`,
				);
				return;
			}

			const stableId = `${SELF_DOC.BUILD_ATTESTATION_STABLE_ID_PREFIX}${VERIFICATION_GATE_NAME}`;
			const labelClause = VERIFICATION_ATTESTATION_LABEL_LIST.map((oneLabel) => `a:\`${oneLabel}\``).join(', ');
			const taskList = new taskListPlus();

			// MERGE on stableId — IDEMPOTENT under a second finish, which is the gate's own requirement.
			taskList.push((args, next) => {
				const cypher = `
					MERGE (a {stableId: ${cypherString(stableId)}})
					SET ${labelClause},
					    a.gate = ${cypherString(VERIFICATION_GATE_NAME)},
					    a.verdict = ${cypherString(verdict)},
					    a.detail = ${cypherString(detail || '')},
					    a.exemplarCount = ${Number(exemplarCount || 0)},
					    a.verifiedCount = ${Number(verifiedCount || 0)},
					    a.verdictSupplied = true,
					    a.expected = true,
					    a.writtenOnChannel = ${cypherString(
								'B — this verdict cannot exist until after the passport, so it is written by the ' +
									'passport writer rather than by the Channel-A attestation finisher, which runs earlier.',
							)}
					RETURN elementId(a) AS attestationElementId`;
				runCypher({ cypher }, (err, result) => {
					if (err) {
						next(`passport-writer.writeVerificationAttestation: the MERGE failed: ${err}`);
						return;
					}
					const rows = (result && result.records) || [];
					if (!rows.length) {
						next(`passport-writer.writeVerificationAttestation: the MERGE returned no row.`);
						return;
					}
					next('', { ...args, attestationElementId: `${rows[0].get('attestationElementId')}` });
				});
			});

			// ATTESTS from the passport — MATCH both ends, MERGE only the relationship, same rule as every
			// other passport-rooted edge.
			taskList.push((args, next) => {
				const cypher = `
					MATCH (p:\`${passportLabel}\` {\`${PASSPORT_KEY_PROPERTY}\`: ${cypherString(PASSPORT_SINGLETON_VALUE)}})
					MATCH (a {stableId: ${cypherString(stableId)}})
					MERGE (p)-[e:\`${edgeTypes.ATTESTS}\`]->(a)
					SET e.provenanceTier = ${cypherString(SELF_DOC.PROVENANCE_TIER)}
					RETURN count(e) AS edgeCount`;
				runCypher({ cypher }, (err, result) => {
					if (err) {
						next(`passport-writer.writeVerificationAttestation: the ATTESTS edge failed: ${err}`);
						return;
					}
					const rows = (result && result.records) || [];
					next('', { ...args, attestsEdgeCount: rows.length ? numberFrom(rows[0], 'edgeCount') : 0 });
				});
			});

			// ROUND-TRIP-OR-REFUSE, and specifically assert SINGULARITY: a second finish must update the one
			// row, never mint a duplicate.
			taskList.push((args, next) => {
				runCypher(
					{ cypher: `MATCH (a {stableId: ${cypherString(stableId)}}) RETURN count(a) AS rowCount` },
					(err, result) => {
						if (err) {
							next(`passport-writer.writeVerificationAttestation: verification failed: ${err}`);
							return;
						}
						const rows = (result && result.records) || [];
						const rowCount = rows.length ? numberFrom(rows[0], 'rowCount') : 0;
						if (rowCount !== 1) {
							next(
								`passport-writer.writeVerificationAttestation: expected exactly 1 row for stableId ` +
									`'${stableId}', found ${rowCount}. The MERGE is keyed on stableId precisely so a ` +
									`second finish updates rather than duplicates.`,
							);
							return;
						}
						next('', args);
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					stableId,
					attestationElementId: args.attestationElementId,
					attestsEdgeCount: args.attestsEdgeCount,
					labels: VERIFICATION_ATTESTATION_LABEL_LIST,
					summary:
						`usagePatternVerification attestation written on Channel B: verdict='${verdict}', ` +
						`labels [${VERIFICATION_ATTESTATION_LABEL_LIST.join(':')}], ` +
						`${args.attestsEdgeCount} ATTESTS edge(s) from the passport`,
				});
			});
		};

		return {
			write,
			writeVerificationAttestation,
			VERIFICATION_GATE_NAME,
			VERIFICATION_ATTESTATION_LABEL_LIST,
			EDGE_PLAN,
			PASSPORT_KEY_PROPERTY,
			PASSPORT_SINGLETON_VALUE,
			CONTENT_CENSUS_CYPHER,
			CONTENT_EDGE_CENSUS_CYPHER,
			MEANING_TIER_CENSUS_CYPHER,
			trustVerdict,
			numberFrom,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
