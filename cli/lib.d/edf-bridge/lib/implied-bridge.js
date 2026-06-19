'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// implied-bridge.js — the -implied mode of bridgeMaker (helpSpec, DESIGN §F).
//
// findMappedItem search: hybrid retrieve -> rerank -> calibrated emit. Runs LAST, only on scope
// items NOT already covered by a SPECIFIED_MAPPING or DERIVED_MAPPING edge (it calibrates on, and
// skips, what the deterministic tiers already covered).
//
// ADAPTED vs STUBBED (honest, per the build mandate):
//   Stage 1 (retrieve) — ADAPTED from trackA crosswalk-engine: the `cosine` similarity over the
//     stored voyage embeddings (embeddingMatcher.js) and the candidate-ranking idea
//     (candidatePool.selectCandidatesForSource). trackA's Stage-1 issued ONE
//     `db.index.vector.queryNodes` per source against a named vector index; we port the SAME
//     retrieval SEMANTICS but compute cosine IN MEMORY here. Reason it does not port verbatim: the
//     trackA query is bound to a jobSpec.targetVectorIndex name and per-standard source/target
//     LABELS (CedsProperty, MedBiqElement, …). Our graph is generic (role labels + _source), so a
//     hardcoded index name / label list would BE per-standard code — which the bridge layer forbids
//     (DESIGN §F, DECISIONS §12). The in-memory cosine over the same stored vectors is the clean,
//     generic port. It reads `embedding` + `searchText`, exactly the node shape the design promises.
//   Stage 2 (rerank + calibrate) — STUBBED, marked [PINNED-DEFERRED] (helpSpec: "[PINNED-DEFERRED]
//     Stage 2 (rerank+calibrate)"). trackA's Stage-2 is the nine-signal weighted scorer
//     (scorer.js) + neighborhood/path matchers + calibration into a SKOS matchPredicate. That is NOT
//     cleanly portable: it depends on per-standard neighborhood cypher (candidatePool
//     NEIGHBORHOOD_QUERIES keyed by CedsProperty/CtdlClass/… labels) and a crosswalkConfig weight
//     table — both per-standard. Porting it generically is a real design task, not an adaptation.
//     So we DO NOT fake calibrated results: Stage-2 is a logged no-op and -implied emits NO edges in
//     this phase. The retrieve stage runs and is reported (candidatesRetrieved) so the wiring is
//     real and testable, but the calibrated emit is deferred.
//
// When -implied DOES emit (a later phase), the edge is IMPLIED_MAPPING with provenanceTier
// 'embedding-inferred', a calibrated confidence, and a matchPredicate (the SKOS precision predicate).
//
// Async style: qtools taskListPlus/pipeRunner; neo4j resolves at the leaf. No async/await, no
// try/catch-for-control-flow, no Promises surfaced. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const mappingInstructionFactory = require('./mapping-instruction');

const EDGE_TYPE = 'IMPLIED_MAPPING';
const PROVENANCE_TIER = 'embedding-inferred';
const CANDIDATE_TOP_K = 5;

// ---- PORTED FROM trackA embeddingMatcher.js (Stage-1 retrieve): cosine over stored vectors. ----
// Negative similarities are forced to 0 (vectors pointing away — never a real match in this domain).
const cosine = (a, b) => {
	if (!Array.isArray(a) || !Array.isArray(b)) {
		return 0;
	}
	if (a.length === 0 || a.length !== b.length) {
		return 0;
	}
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) {
		return 0;
	}
	const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
	if (sim < 0) {
		return 0;
	}
	if (sim > 1) {
		return 1;
	}
	return sim;
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		const { xLog } = process.global;
		const mappingInstruction = mappingInstructionFactory({ lifecycle });

		// bridge — { graphName, scope, owner } ->
		//   { stageTwoStubbed: true, candidatesRetrieved, edgesMerged: 0, note }.
		const bridge = ({ graphName, scope, owner }, callback) => {
			const taskList = new taskListPlus();

			// read the scope's mappingInstruction (generic). includeInImplied===false means this
			// standard opts out of the implied pass entirely.
			taskList.push((args, next) => {
				mappingInstruction.readForScope({ graphName, scope }, (err, resolved) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, instruction: resolved.instruction });
				});
			});

			// Stage 1 (ADAPTED): load scope nodes NOT already covered by SPECIFIED/DERIVED, plus the
			// candidate target embeddings (the impliedTargets standards, default ['CEDS'] -> _source
			// 'ceds'). One bulk fetch each — same batched-load discipline as trackA candidatePool.
			taskList.push((args, next) => {
				if (!args.instruction.includeInImplied) {
					xLog.status(
						`[implied-bridge] scope '${scope}' opts out of implied (includeInImplied=false); skipping`,
					);
					next('', { ...args, sources: [], targets: [] });
					return;
				}
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (src)
							WHERE src._source = $scope
							  AND src.embedding IS NOT NULL
							  AND NOT (src)-[:SPECIFIED_MAPPING|DERIVED_MAPPING]->()
							RETURN src.stableId AS stableId, src.searchText AS searchText, src.embedding AS embedding
						`,
						params: { scope },
					},
					(err, result) => {
						if (err) {
							next(`implied source scan: ${err}`);
							return;
						}
						const sources = result.records.map((record) => ({
							stableId: record.stableId,
							searchText: record.searchText,
							embedding: record.embedding,
						}));
						next('', { ...args, sources });
					},
				);
			});

			// load the candidate targets (impliedTargets; default CEDS).
			taskList.push((args, next) => {
				if (args.sources.length === 0) {
					next('', { ...args, targets: [] });
					return;
				}
				const targetSources = (args.instruction.impliedTargets || ['CEDS']).map((oneTarget) =>
					`${oneTarget}`.toLowerCase(),
				);
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (tgt)
							WHERE toLower(tgt._source) IN $targetSources
							  AND tgt.embedding IS NOT NULL
							RETURN tgt.stableId AS stableId, tgt.searchText AS searchText, tgt.embedding AS embedding
						`,
						params: { targetSources },
					},
					(err, result) => {
						if (err) {
							next(`implied target scan: ${err}`);
							return;
						}
						const targets = result.records.map((record) => ({
							stableId: record.stableId,
							searchText: record.searchText,
							embedding: record.embedding,
						}));
						next('', { ...args, targets });
					},
				);
			});

			// Stage 1 (ADAPTED): for each uncovered source, rank targets by cosine and keep top-K.
			// This is the retrieve stage — it produces CANDIDATES, not edges.
			taskList.push((args, next) => {
				let candidatesRetrieved = 0;
				args.sources.forEach((oneSource) => {
					const ranked = args.targets
						.map((oneTarget) => ({
							targetStableId: oneTarget.stableId,
							similarity: cosine(oneSource.embedding, oneTarget.embedding),
						}))
						.filter((candidate) => candidate.similarity > 0)
						.sort((left, right) => right.similarity - left.similarity)
						.slice(0, CANDIDATE_TOP_K);
					candidatesRetrieved += ranked.length;
				});
				xLog.status(
					`[implied-bridge] Stage-1 retrieve (ADAPTED from trackA): ${args.sources.length} uncovered source(s) x ${args.targets.length} target(s) -> ${candidatesRetrieved} candidate(s) (top-${CANDIDATE_TOP_K} each)`,
				);
				next('', { ...args, candidatesRetrieved });
			});

			// Stage 2 (STUBBED, [PINNED-DEFERRED]): rerank + calibrate + emit. NOT done — we emit NO
			// edges and fake NO calibrated results. The note is surfaced so the operator (and the
			// Phase-5 report) sees the honest deferral.
			taskList.push((args, next) => {
				xLog.status(
					`[implied-bridge] [PINNED-DEFERRED] Stage-2 (rerank+calibrate+emit) NOT ported — depends on per-standard neighborhood/path signals + a crosswalkConfig weight table (trackA scorer.js / candidatePool NEIGHBORHOOD_QUERIES). No ${EDGE_TYPE} edges emitted; no results faked.`,
				);
				next('', { ...args, edgesMerged: 0 });
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					stageTwoStubbed: true,
					candidatesRetrieved: args.candidatesRetrieved || 0,
					edgesMerged: 0,
					note: '[PINNED-DEFERRED] Stage-1 retrieve adapted from trackA (in-memory cosine); Stage-2 rerank/calibrate/emit deferred — no edges emitted, no results faked',
				});
			});
		};

		return { bridge, cosine };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
