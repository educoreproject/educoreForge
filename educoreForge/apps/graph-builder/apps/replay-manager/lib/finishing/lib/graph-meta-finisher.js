'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graph-meta-finisher.js — registry member 7 and the LAST one, mode 'apply' (graphSelfDoc Phase 4, 2026-09-01).
//
// Two duties, in this order: STAMP `:GraphMeta` on every metadata node, then VERIFY the purity invariant
// over the WHOLE graph — every node carries `_source` XOR `:GraphMeta`, never both, never neither.
//
// It runs LAST in the registry for a reason that is not stylistic: everything it stamps must already exist.
// A finisher added after this one would emit nodes the sweep has already passed, and they would sit
// unstamped — which the verification below would then catch as a neither-side violation. That is the
// invariant protecting itself, and it is why the order is forced rather than conventional.
//
// ============================================================================================
// WHY THE RULE IS AN XOR AND NOT AN ALLOW-LIST — the whole point, restated so nobody "simplifies" it
// ============================================================================================
// Expressed as XOR, adding a new metadata node type costs exactly ONE entry in META_NODE_LABELS and the
// verification query below is NEVER edited. Expressed as an allow-list of labels, every new type would
// require remembering to edit a gate that lives somewhere else — and the failure mode of forgetting is
// SILENT, because an unlisted label simply is not checked. The XOR has no such hole: a node that is
// neither content nor declared metadata violates it by construction, whatever it is called.
//
// ============================================================================================
// THE PASSPORT IS DELIBERATELY OUT OF THIS SWEEP, AND THAT IS NOT A GAP
// ============================================================================================
// `GraphProvenance` appears in META_NODE_LABELS but DOES NOT EXIST when this finisher runs: the passport
// is Channel B, written by the verb AFTER the whole registry has finished. So the stamp pass matches zero
// passport nodes and the verification below is honestly clean without it.
// THE PASSPORT SELF-STAMPS `:GraphMeta` at the moment it is MERGEd, and the VERB re-runs `verifyXor`
// as its last act (work order Phase 4 gate (g)) so the invariant covers a node this sweep could not see.
// `verifyXor` is EXPORTED for exactly that reason: the verb reuses this implementation rather than
// carrying a second copy of the rule. Two copies of an invariant is how the two copies come to disagree.
//
// Async style: qtools taskListPlus/pipeRunner; callback(errString, result). No async/await, no
// try/catch-for-control-flow.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { GRAPH_META } = vocabulary;
		const metaLabel = GRAPH_META.LABEL;
		const metaNodeLabelList = GRAPH_META.META_NODE_LABELS;

		// The content-provenance property the XOR is written against. Declared HERE rather than imported:
		// the vocabulary carries '_source' only as one element of REQUIRED_PROPERTIES.NODE, and reaching
		// into that list by array position would be a fragile way to name a property — a reordering of a
		// required-properties list would silently change which property this invariant checks.
		const SOURCE_PROPERTY = '_source';

		// ----- the verification query. ALWAYS returns exactly one row, including when the graph is clean,
		//   so a zero-row result can never be mistaken for a passing check.
		const XOR_CENSUS_CYPHER = `
			MATCH (n)
			WITH n, (n.\`${SOURCE_PROPERTY}\` IS NOT NULL) AS hasSource, (n:\`${metaLabel}\`) AS isMeta
			RETURN count(n) AS totalNodes,
			       sum(CASE WHEN hasSource AND isMeta THEN 1 ELSE 0 END) AS bothSidesCount,
			       sum(CASE WHEN (NOT hasSource) AND (NOT isMeta) THEN 1 ELSE 0 END) AS neitherSideCount`;

		// Run ONLY when the census reports violations — cheap in the clean case, specific in the dirty one.
		const XOR_OFFENDER_CYPHER = `
			MATCH (n)
			WITH n, (n.\`${SOURCE_PROPERTY}\` IS NOT NULL) AS hasSource, (n:\`${metaLabel}\`) AS isMeta
			WHERE hasSource = isMeta
			RETURN labels(n) AS nodeLabels, hasSource AS carriesSource, isMeta AS carriesGraphMeta,
			       coalesce(n.stableId, n.\`_id\`, elementId(n)) AS identity
			LIMIT 10`;

		const numberFrom = (oneRecord, oneColumnName) => Number(oneRecord.get(oneColumnName) || 0);

		// ----- verifyXor — EXPORTED. The verb re-runs this after Channel B (gate (g)).
		const verifyXor = ({ runCypher, phaseLabel } = {}, callback) => {
			if (typeof runCypher !== 'function') {
				callback(
					`graph-meta-finisher.verifyXor: a runCypher is REQUIRED. The purity invariant is a claim ` +
						`about the LIVE graph and cannot be established from anything else.`,
				);
				return;
			}
			const phase = phaseLabel || 'registry sweep';

			runCypher({ cypher: XOR_CENSUS_CYPHER }, (censusErr, censusResult) => {
				if (censusErr) {
					callback(`graph-meta-finisher.verifyXor: the census query failed (${phase}): ${censusErr}`);
					return;
				}
				const censusRows = (censusResult && censusResult.records) || [];
				if (!censusRows.length) {
					callback(
						`graph-meta-finisher.verifyXor: the census returned NO ROWS (${phase}). This query is ` +
							`written to return exactly one row even over an empty graph, so no row means the query ` +
							`did not run as written — it is NOT evidence that the invariant holds.`,
					);
					return;
				}

				const totalNodes = numberFrom(censusRows[0], 'totalNodes');
				const bothSidesCount = numberFrom(censusRows[0], 'bothSidesCount');
				const neitherSideCount = numberFrom(censusRows[0], 'neitherSideCount');
				const violationCount = bothSidesCount + neitherSideCount;

				if (!violationCount) {
					callback('', {
						totalNodes,
						bothSidesCount: 0,
						neitherSideCount: 0,
						violationCount: 0,
						phase,
						summary:
							`XOR purity verified over ${totalNodes} node(s) (${phase}): every node carries ` +
							`${SOURCE_PROPERTY} XOR :${metaLabel} — 0 both-sides, 0 neither-side`,
					});
					return;
				}

				runCypher({ cypher: XOR_OFFENDER_CYPHER }, (offenderErr, offenderResult) => {
					// A failure to fetch EXAMPLES must not soften the verdict — the census already decided it.
					const offenderList = offenderErr
						? []
						: ((offenderResult && offenderResult.records) || []).map((oneRecord) => ({
								nodeLabels: oneRecord.get('nodeLabels'),
								carriesSource: oneRecord.get('carriesSource'),
								carriesGraphMeta: oneRecord.get('carriesGraphMeta'),
								identity: `${oneRecord.get('identity')}`,
							}));
					const rendered = offenderList
						.map(
							(oneOffender) =>
								`${oneOffender.identity} [${(oneOffender.nodeLabels || []).join(':')}] ` +
								`${SOURCE_PROPERTY}=${oneOffender.carriesSource ? 'present' : 'ABSENT'} ` +
								`:${metaLabel}=${oneOffender.carriesGraphMeta ? 'present' : 'ABSENT'}`,
						)
						.join(' · ');

					callback(
						`graph-meta-finisher.verifyXor: THE PURITY INVARIANT IS VIOLATED (${phase}) — ` +
							`${violationCount} of ${totalNodes} node(s) fail ${SOURCE_PROPERTY} XOR :${metaLabel}: ` +
							`${bothSidesCount} carry BOTH (a content node wrongly stamped as metadata, so it would ` +
							`be excluded from content comparison while still holding content) and ` +
							`${neitherSideCount} carry NEITHER (a node belonging to no declared category at all — ` +
							`either an orphan write, or a metadata type minted without an entry in META_NODE_LABELS). ` +
							`${offenderList.length ? `Offenders: ${rendered}` : `Offender detail unavailable: ${offenderErr}`}`,
					);
				});
			});
		};

		// ----- stampOneLabel — idempotent by construction: only nodes NOT already stamped are touched, so a
		//   second run reports zero and changes nothing (work order gate (b), idempotence).
		const stampOneLabel = ({ runCypher, oneLabel }, callback) => {
			runCypher(
				{
					cypher:
						`MATCH (n:\`${oneLabel}\`) WHERE NOT n:\`${metaLabel}\` ` +
						`SET n:\`${metaLabel}\` RETURN count(n) AS stampedCount`,
				},
				(stampErr, stampResult) => {
					if (stampErr) {
						callback(`graph-meta-finisher: stamping :${metaLabel} on :${oneLabel} failed: ${stampErr}`);
						return;
					}
					const rows = (stampResult && stampResult.records) || [];
					callback('', { label: oneLabel, stampedCount: rows.length ? numberFrom(rows[0], 'stampedCount') : 0 });
				},
			);
		};

		// ----- apply — mode 'apply'. Stamps, then verifies. A verification failure ABORTS the phase.
		const apply = ({ runCypher } = {}, callback) => {
			if (typeof runCypher !== 'function') {
				callback(
					`graph-meta-finisher: a runCypher is REQUIRED. This finisher's entire job is to stamp and ` +
						`then verify the live graph; without a write door it could do neither and reporting ` +
						`success would assert an invariant nobody checked.`,
				);
				return;
			}

			const taskList = new taskListPlus();
			const stampedList = [];

			// One task per DECLARED metadata label. Driven off META_NODE_LABELS so adding a metadata type
			// stays a one-row change in the vocabulary and never a code change here.
			metaNodeLabelList.forEach((oneLabel) => {
				taskList.push((args, next) => {
					stampOneLabel({ runCypher, oneLabel }, (stampErr, stampReport) => {
						if (stampErr) {
							next(stampErr);
							return;
						}
						stampedList.push(stampReport);
						next('', args);
					});
				});
			});

			// VERIFY LAST, and only after every stamp has landed — verifying mid-sweep would read a graph
			// this finisher has not finished changing and could report a violation it was about to fix.
			taskList.push((args, next) => {
				verifyXor({ runCypher, phaseLabel: 'registry sweep' }, (verifyErr, verifyReport) => {
					if (verifyErr) {
						next(verifyErr);
						return;
					}
					next('', { ...args, verifyReport });
				});
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const verifyReport = args.verifyReport;
				const stampedTotal = stampedList.reduce(
					(runningTotal, oneEntry) => runningTotal + oneEntry.stampedCount,
					0,
				);
				callback('', {
					nodes: [],
					edges: [],
					stampedByLabel: stampedList,
					stampedTotal,
					xorVerified: true,
					totalNodes: verifyReport.totalNodes,
					summary:
						`graph meta: stamped :${metaLabel} on ${stampedTotal} node(s) across ` +
						`${metaNodeLabelList.length} declared metadata label(s); ` +
						`${verifyReport.summary}. NOTE: the passport is not in this sweep — it does not ` +
						`exist yet (Channel B) and is covered by the verb's own recheck.`,
				});
			});
		};

		return { apply, verifyXor, SOURCE_PROPERTY, XOR_CENSUS_CYPHER, XOR_OFFENDER_CYPHER };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
