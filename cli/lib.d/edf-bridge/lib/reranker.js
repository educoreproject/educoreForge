'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// reranker.js — Stage-2 reranker orchestration for -implied (Phase II). Takes the Stage-1 retrieved
// pools (per source: a candidate shortlist ordered by raw cosine) and REORDERS each pool by the
// multi-signal composite (score-match.js) so structural/neighborhood evidence can surface a true
// target that raw cosine mis-ranks. Phase II produces SCORES ONLY — no edges (emit is Phase IV).
//
// Perf: neighborhoods for the WHOLE batch (all sources + every distinct candidate) are bulk-loaded
// ONCE via neighborhood-loader (a fixed few round-trips), then scoring is pure in-memory — never a
// per-(source,candidate) graph walk. Async style: qtools taskListPlus/pipeRunner; neo4j only through
// the injected lifecycle (via neighborhood-loader). camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const neighborhoodLoaderFactory = require('./neighborhood-loader');
const { scoreMatch } = require('./score-match');
const defaultConfig = require('./rerank-config.json');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle, config } = {}) => {
		const rerankConfig = config || defaultConfig;
		const neighborhoodLoader = neighborhoodLoaderFactory({ lifecycle });

		// rerankBatch — { graphName, items } -> reranked items.
		//   items: [ { srcStableId, candidates: [ { stableId, score } ] } ]   (score = Stage-1 cosine)
		//   result: [ { srcStableId, reranked: [ { stableId, cosineScore, confidence, signals } ] (desc) } ]
		const rerankBatch = ({ graphName, items }, callback) => {
			const safeItems = (items || []).filter((item) => item && item.srcStableId);
			if (safeItems.length === 0) {
				callback('', { items: [] });
				return;
			}

			const allIds = [];
			safeItems.forEach((item) => {
				allIds.push(item.srcStableId);
				(item.candidates || []).forEach((candidate) => allIds.push(candidate.stableId));
			});

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				neighborhoodLoader.loadBundles({ graphName, stableIds: allIds }, (err, loaded) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, fieldsById: loaded.fieldsById, bundleById: loaded.bundleById });
				});
			});

			taskList.push((args, next) => {
				const { fieldsById, bundleById } = args;
				const rerankedItems = safeItems.map((item) => {
					const sourceNode = fieldsById[item.srcStableId] || null;
					const sourceBundle = bundleById[item.srcStableId] || null;
					const scored = (item.candidates || []).map((candidate) => {
						const targetNode = fieldsById[candidate.stableId] || null;
						const targetBundle = bundleById[candidate.stableId] || null;
						const result = scoreMatch({
							sourceNode,
							targetNode,
							sourceBundle,
							targetBundle,
							config: rerankConfig,
						});
						return {
							stableId: candidate.stableId,
							cosineScore: candidate.score,
							confidence: result.confidence,
							semanticScore: result.semanticScore,
							structuralScore: result.structuralScore,
							signals: result.signals,
						};
					});
					// stable sort by composite confidence DESC; ties keep the higher raw cosine first.
					scored.sort((a, b) => {
						if (b.confidence !== a.confidence) {
							return b.confidence - a.confidence;
						}
						return (b.cosineScore || 0) - (a.cosineScore || 0);
					});
					return { srcStableId: item.srcStableId, reranked: scored };
				});
				next('', { ...args, rerankedItems });
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', { items: args.rerankedItems });
			});
		};

		return { rerankBatch, config: rerankConfig };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
