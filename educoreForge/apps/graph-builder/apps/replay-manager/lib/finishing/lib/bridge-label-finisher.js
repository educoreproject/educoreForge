'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bridge-label-finisher.js — registry member 0, mode 'apply' (campaign P2, W-B-13 / V1-C29; 2026-10-06).
//
// A bridge run stamps BOTH endpoints of every edge it writes with a pair-scoped label, BridgedRelation_<SOURCE>_<HUB>, so
// the harvest can select that pair's nodes into its relationship block — and replay re-applies the label from the block.
// On the finished graph it is SCAFFOLD: nothing reads it after harvest (the DME greps it 0 times, code fact), and a hub
// card's label set then varies with which bridges a recipe ran (measured on the acceptance gold: 13,807 nodes, 502 hubs
// carrying two or more, at most nine on one node). So the finish strips every such label, FIRST in the registry, before
// the schema view and its coverage gate look at the graph's labels.
//
// It strips ONLY labels matching the declared grammar (graph-contract BRIDGE_PAIR_LABEL_PATTERN_SOURCE). A label that
// starts with the prefix and does not match is REFUSED by name — never stripped by a generic prefix rule, because a
// malformed pair label means a producer outside the declared grammar, and that is a fact to surface, not to tidy away.
// The relationship blocks keep the labels; only the finished graph loses them (harvest happened at build time).
//
//   factory({ vocabulary }) → { apply }
//   apply({ runCypher }, callback(errorText, { summary, removedLabelList, removedOccurrenceCount }))
//
// Async style: qtools taskListPlus/pipeRunner; callback(errString, result). No async/await, no try/catch-for-control-flow.

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { BRIDGE_PAIR_LABEL_PREFIX, BRIDGE_PAIR_LABEL_PATTERN_SOURCE } = vocabulary;
		const pairLabelPattern = new RegExp(BRIDGE_PAIR_LABEL_PATTERN_SOURCE);
		const REMOVE_BATCH_SIZE = 10000;
		const numberFrom = (oneRecord, fieldName) => {
			const raw = oneRecord.get(fieldName);
			return raw && typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw);
		};

		const PAIR_LABEL_CENSUS_CYPHER = `CALL db.labels() YIELD label WHERE label STARTS WITH '${BRIDGE_PAIR_LABEL_PREFIX}' RETURN label ORDER BY label`;
		const removeBatchCypherFor = (pairLabel) => `MATCH (n:\`${pairLabel}\`) WITH n LIMIT ${REMOVE_BATCH_SIZE} REMOVE n:\`${pairLabel}\` RETURN count(n) AS removedCount`;

		// removeEveryOccurrence — batches until a batch removes nothing; the occurrence count is what the batches said
		const removeEveryOccurrence = ({ runCypher, pairLabel }, callback) => {
			const removeNextBatch = (runningTotal) => {
				runCypher({ cypher: removeBatchCypherFor(pairLabel) }, (err, result) => {
					if (err) {
						callback(`${moduleName}: removing :${pairLabel} failed: ${err}`);
						return;
					}
					const removedCount = ((result && result.records) || []).length ? numberFrom(result.records[0], 'removedCount') : 0;
					if (removedCount === 0) {
						callback('', runningTotal);
						return;
					}
					removeNextBatch(runningTotal + removedCount);
				});
			};
			removeNextBatch(0);
		};

		const apply = ({ runCypher } = {}, callback) => {
			if (typeof runCypher !== 'function') {
				callback(`${moduleName}: a runCypher is REQUIRED`);
				return;
			}
			const taskList = new taskListPlus();
			taskList.push((args, next) => {
				runCypher({ cypher: PAIR_LABEL_CENSUS_CYPHER }, (err, result) => {
					if (err) {
						next(`${moduleName}: the pair-label census failed: ${err}`);
						return;
					}
					const labelList = ((result && result.records) || []).map((oneRecord) => `${oneRecord.get('label')}`);
					const malformedList = labelList.filter((oneLabel) => !pairLabelPattern.test(oneLabel));
					if (malformedList.length) {
						next(`${moduleName} REFUSED: label(s) ${malformedList.map((oneLabel) => `'${oneLabel}'`).join(', ')} start with '${BRIDGE_PAIR_LABEL_PREFIX}' but do not match the declared pair-label grammar ${BRIDGE_PAIR_LABEL_PATTERN_SOURCE} — a producer outside the grammar wrote them, and they are not stripped by a prefix rule`);
						return;
					}
					next('', { ...args, labelList });
				});
			});
			taskList.push((args, next) => {
				const removalTaskList = new taskListPlus();
				args.labelList.forEach((onePairLabel) => {
					removalTaskList.push((removalArgs, removalNext) => {
						removeEveryOccurrence({ runCypher, pairLabel: onePairLabel }, (err, removedCount) => (err ? removalNext(err) : removalNext('', { ...removalArgs, removedOccurrenceCount: removalArgs.removedOccurrenceCount + removedCount })));
					});
				});
				pipeRunner(removalTaskList.getList(), { removedOccurrenceCount: 0 }, (err, removalArgs) => (err ? next(err) : next('', { ...args, removedOccurrenceCount: removalArgs.removedOccurrenceCount })));
			});
			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					removedLabelList: args.labelList,
					removedOccurrenceCount: args.removedOccurrenceCount,
					summary: `bridge pair labels stripped: ${args.labelList.length} label(s), ${args.removedOccurrenceCount} occurrence(s)${args.labelList.length ? ` (${args.labelList.join(', ')})` : ''}`,
				});
			});
		};

		return { apply, PAIR_LABEL_CENSUS_CYPHER, removeBatchCypherFor };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
