'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graph-meta-finisher.js — Wave B, CRIMSON gate 6: the :GraphMeta STRUCTURAL MARKER. Every legitimately
// source-less node the build mints (SchemaView terms + root, HubDefinition, ManifestRecipe, RecipeBlock,
// StandardDefinition) is stamped :GraphMeta here — label-driven from vocabulary.GRAPH_META.META_NODE_LABELS,
// NEVER a name list. The G2 purity gate then reads: for EVERY node, (_source IS NOT NULL) XOR (:GraphMeta) —
// a new meta node type is one entry in META_NODE_LABELS and zero gate edits.
//
// The GraphProvenance passport is in META_NODE_LABELS but is minted AFTER finishing (graph-builder
// stampProvenance), so stampProvenance applies its own :GraphMeta label; this finisher's pass over that
// label simply matches nothing at finishing time (and re-stamps idempotently on a rebuild into an
// existing graph).
//
// RUNS LAST in the finisher registry so every meta node the earlier finishers minted exists before
// stamping. After stamping, the finisher VERIFIES the XOR invariant over the whole graph and REFUSES
// the build if any node carries neither _source nor :GraphMeta (or both).
//
// Async style: qtools taskListPlus/pipeRunner; cypher at the leaf via the injected lifecycle. No
// async/await, no try/catch-for-control-flow. camelCase only.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// label position cannot be parameterized in cypher; validate every label as a bare identifier so the
// backtick-quoted position can never inject.
const LABEL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle, vocabulary } = {}) => {
		const { xLog } = process.global;

		const { GRAPH_META } = vocabulary;
		const metaLabel = GRAPH_META.LABEL; // 'GraphMeta'

		// ----- finish — stamp :GraphMeta on every node carrying a META_NODE_LABELS label, then verify
		//   the XOR purity invariant graph-wide.
		const finish = ({ graphName } = {}, callback) => {
			const badLabels = [metaLabel, ...GRAPH_META.META_NODE_LABELS].filter(
				(oneLabel) => !LABEL_RE.test(oneLabel),
			);
			if (badLabels.length) {
				callback(
					`graph-meta-finisher: invalid label identifier(s) in GRAPH_META: ${badLabels.join(', ')}`,
				);
				return;
			}

			const taskList = new taskListPlus();
			const stampCounts = {};

			// 1) stamp each meta label's nodes (idempotent SET; one pass per label — labels cannot be
			//    parameterized, each is registry-sourced and identifier-validated above).
			GRAPH_META.META_NODE_LABELS.forEach((oneLabel) => {
				taskList.push((args, next) => {
					lifecycle.runCypher(
						{
							graphName,
							cypher: `MATCH (n:\`${oneLabel}\`) SET n:\`${metaLabel}\` RETURN count(n) AS c`,
						},
						(err, result) => {
							if (err) {
								next(`graph-meta-finisher: stamping :${oneLabel} failed: ${err}`);
								return;
							}
							stampCounts[oneLabel] = Number(result.records[0].c);
							next('', args);
						},
					);
				});
			});

			// 2) VERIFY the XOR invariant: every node carries (_source) XOR (:GraphMeta). The passport is
			//    minted after finishing, so it is EXPECTED absent here — the check runs over what exists now;
			//    the standing G2 gate re-checks the finished graph (passport included) independently.
			taskList.push((args, next) => {
				const cypher = `MATCH (n)
					WHERE NOT ((n._source IS NOT NULL) XOR (n:\`${metaLabel}\`))
					RETURN count(n) AS violationCount,
						collect(coalesce(n.stableId, n.name, 'id:' + toString(id(n))))[0..10] AS examples`;
				lifecycle.runCypher({ graphName, cypher }, (err, result) => {
					if (err) {
						next(`graph-meta-finisher: XOR verification query failed: ${err}`);
						return;
					}
					const row = result.records[0];
					const violationCount = Number(row.violationCount);
					if (violationCount > 0) {
						next(
							`graph-meta-finisher: PURITY VIOLATION — ${violationCount} node(s) fail the ` +
								`(_source XOR :${metaLabel}) invariant. Examples: ${(row.examples || []).join(', ')}. ` +
								`Refusing the build.`,
						);
						return;
					}
					next('', args);
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				const stamped = Object.keys(stampCounts)
					.map((oneLabel) => `${oneLabel}=${stampCounts[oneLabel]}`)
					.join(', ');
				const totalStamped = Object.values(stampCounts).reduce((sum, oneCount) => sum + oneCount, 0);
				callback('', {
					summary: `graphMeta: stamped ${totalStamped} meta node(s) [${stamped}]; XOR purity verified`,
					stampCounts,
					totalStamped,
				});
			});
		};

		return { finish };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
