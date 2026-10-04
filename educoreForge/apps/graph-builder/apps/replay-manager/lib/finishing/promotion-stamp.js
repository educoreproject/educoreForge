'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// promotion-stamp.js — the step that runs AFTER a graph is promoted (renamed to its GNC-001 name), so the graph's own record
// tells the truth about it (lane P, mappingProvenance 2026-10-04; TQ-approved via VIOLET_VALLEY). Two facts are unknowable at
// build time and were therefore wrong in every promoted graph:
//   * GraphProvenance.graphName named the SCRATCH container (DEV_gb_materialize_<pid>_<n>), because the passport is written
//     before the rename;
//   * the goldEvalCheck BuildAttestation row read 'notRun', and no row recorded the replay, although both are run, and pass,
//     after the build and before promotion.
// The stamp writes ONLY those: the passport's graphName (keeping the scratch name beside it as scratchGraphName) and one
// BuildAttestation row per supplied gate verdict, each carrying the path and sha256 of the evidence file it was read from.
// It writes no content node or edge, and PROVES it: the content census (nodes carrying _source; edges with no :GraphMeta
// endpoint) is taken before and after, and any difference is refused by name.
//
//   factory({ vocabulary, passportWriter }) → { stampPromotion, … }
//   stampPromotion({ runCypher, promotedGraphName, gateVerdictList }, callback(errorText, { before, after, ... }))
//     gateVerdictList: [{ gate, verdict, detail, evidencePath, evidenceSha256 }]; gate ∈ STAMPABLE_GATE_LIST
//
// Async style: callback(errString, result). No async/await, no try/catch-for-control-flow.

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary, passportWriter } = {}) => {
		const { NODE_LABELS, SELF_DOC, GRAPH_META } = vocabulary;
		// the passport's singleton key is the passport writer's, read from it, never restated here
		if (!passportWriter || typeof passportWriter.PASSPORT_KEY_PROPERTY !== 'string' || typeof passportWriter.PASSPORT_SINGLETON_VALUE !== 'string') {
			throw new Error(`${moduleName} REFUSED: a constructed passportWriter is required (its PASSPORT_KEY_PROPERTY and PASSPORT_SINGLETON_VALUE find the passport)`);
		}
		const { PASSPORT_KEY_PROPERTY, PASSPORT_SINGLETON_VALUE } = passportWriter;
		const passportLabel = NODE_LABELS.GRAPH_PROVENANCE;
		const metaLabel = GRAPH_META.LABEL;
		const attestationLabel = SELF_DOC.NODE_LABELS.BUILD_ATTESTATION;
		const attestsEdgeType = SELF_DOC.EDGE_TYPES.ATTESTS;

		// the gates whose verdicts exist only after the build, and the verdicts a stamp may record
		const STAMPABLE_GATE_LIST = Object.freeze(['goldEvalCheck', 'replay']);
		const STAMPABLE_VERDICT_LIST = Object.freeze(['pass', 'fail']);

		const cypherString = (text) => JSON.stringify(String(text));
		const numberFrom = (oneRecord, fieldName) => {
			const raw = oneRecord.get(fieldName);
			return raw && typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw);
		};

		// THE CONTENT CENSUS — what the stamp must leave untouched. Content nodes carry _source (the GraphMeta purity rule:
		// _source XOR :GraphMeta); content edges have no :GraphMeta endpoint.
		const CONTENT_CENSUS_CYPHER = `
			CALL { MATCH (n) WHERE n._source IS NOT NULL RETURN count(n) AS contentNodeCount }
			CALL { MATCH (a)-[r]->(b) WHERE NOT a:\`${metaLabel}\` AND NOT b:\`${metaLabel}\` RETURN count(r) AS contentEdgeCount }
			RETURN contentNodeCount, contentEdgeCount`;

		const verdictRefusal = (oneVerdict, verdictIndex) => {
			const where = `gateVerdictList[${verdictIndex}]`;
			const faultList = []
				.concat(oneVerdict && STAMPABLE_GATE_LIST.indexOf(oneVerdict.gate) !== -1 ? [] : [`gate ${JSON.stringify(oneVerdict && oneVerdict.gate)} is not one of ${STAMPABLE_GATE_LIST.join(', ')}`])
				.concat(oneVerdict && STAMPABLE_VERDICT_LIST.indexOf(oneVerdict.verdict) !== -1 ? [] : [`verdict ${JSON.stringify(oneVerdict && oneVerdict.verdict)} is not one of ${STAMPABLE_VERDICT_LIST.join(', ')}`])
				.concat(oneVerdict && typeof oneVerdict.detail === 'string' && oneVerdict.detail.trim() ? [] : ['detail is empty'])
				.concat(oneVerdict && typeof oneVerdict.evidencePath === 'string' && oneVerdict.evidencePath.trim() ? [] : ['evidencePath is empty'])
				.concat(oneVerdict && /^[0-9a-f]{64}$/.test(String(oneVerdict.evidenceSha256)) ? [] : ['evidenceSha256 is not 64 hex']);
			return faultList.length ? `${moduleName} REFUSED: ${where}: ${faultList.join('; ')} — a verdict is recorded only with the evidence it was read from` : '';
		};

		const readCensus = (runCypher, censusLabel, callback) => {
			runCypher({ cypher: CONTENT_CENSUS_CYPHER }, (err, result) => {
				if (err) {
					callback(`${moduleName}: the ${censusLabel} content census failed: ${err}`);
					return;
				}
				const rows = (result && result.records) || [];
				if (rows.length !== 1) {
					callback(`${moduleName}: the ${censusLabel} content census returned ${rows.length} row(s), not 1`);
					return;
				}
				callback('', { contentNodeCount: numberFrom(rows[0], 'contentNodeCount'), contentEdgeCount: numberFrom(rows[0], 'contentEdgeCount') });
			});
		};

		const stampPromotion = ({ runCypher, promotedGraphName, gateVerdictList } = {}, callback) => {
			if (typeof runCypher !== 'function') {
				callback(`${moduleName} REFUSED: a runCypher is required`);
				return;
			}
			if (typeof promotedGraphName !== 'string' || !promotedGraphName.trim()) {
				callback(`${moduleName} REFUSED: promotedGraphName is required — the stamp exists to write the graph's REAL name`);
				return;
			}
			if (!Array.isArray(gateVerdictList) || gateVerdictList.length === 0) {
				callback(`${moduleName} REFUSED: gateVerdictList is empty — a stamp with no verdict would leave 'notRun' standing and say nothing`);
				return;
			}
			const firstRefusal = gateVerdictList.map(verdictRefusal).find((oneRefusal) => oneRefusal !== '');
			if (firstRefusal !== undefined) {
				callback(firstRefusal);
				return;
			}

			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				readCensus(runCypher, 'BEFORE', (err, before) => (err ? next(err) : next('', { ...args, before })));
			});

			// the passport: exactly one, its graphName set to the promoted name, the scratch name kept beside it
			taskList.push((args, next) => {
				const cypher = `
					MATCH (p:\`${passportLabel}\` {\`${PASSPORT_KEY_PROPERTY}\`: ${cypherString(PASSPORT_SINGLETON_VALUE)}})
					WITH collect(p) AS passportList
					WHERE size(passportList) = 1
					WITH passportList[0] AS p
					SET p.scratchGraphName = coalesce(p.scratchGraphName, p.graphName),
					    p.graphName = ${cypherString(promotedGraphName)}
					RETURN p.graphName AS graphName, p.scratchGraphName AS scratchGraphName, p.manifestRefId AS manifestRefId`;
				runCypher({ cypher }, (err, result) => {
					if (err) {
						next(`${moduleName}: the passport stamp failed: ${err}`);
						return;
					}
					const rows = (result && result.records) || [];
					if (rows.length !== 1) {
						next(`${moduleName} REFUSED: the graph does not hold exactly one GraphProvenance passport, so there is no single record to stamp`);
						return;
					}
					next('', { ...args, graphName: rows[0].get('graphName'), scratchGraphName: rows[0].get('scratchGraphName'), manifestRefId: rows[0].get('manifestRefId') });
				});
			});

			// one BuildAttestation row per verdict, MERGEd on its stableId (idempotent) and ATTESTED from the passport
			gateVerdictList.forEach((oneVerdict) => {
				taskList.push((args, next) => {
					const stableId = `${SELF_DOC.BUILD_ATTESTATION_STABLE_ID_PREFIX}${oneVerdict.gate}`;
					const cypher = `
						MATCH (p:\`${passportLabel}\` {\`${PASSPORT_KEY_PROPERTY}\`: ${cypherString(PASSPORT_SINGLETON_VALUE)}})
						MERGE (a {stableId: ${cypherString(stableId)}})
						SET a:\`${attestationLabel}\`, a:\`${metaLabel}\`,
						    a.gate = ${cypherString(oneVerdict.gate)},
						    a.verdict = ${cypherString(oneVerdict.verdict)},
						    a.detail = ${cypherString(oneVerdict.detail)},
						    a.verdictSupplied = true,
						    a.expected = true,
						    a.evidencePath = ${cypherString(oneVerdict.evidencePath)},
						    a.evidenceSha256 = ${cypherString(oneVerdict.evidenceSha256)},
						    a.writtenOnChannel = ${cypherString('promotion stamp — this verdict exists only after the build, so it is written after promotion from the named evidence file')}
						MERGE (p)-[e:\`${attestsEdgeType}\`]->(a)
						SET e.provenanceTier = ${cypherString(SELF_DOC.PROVENANCE_TIER)}
						RETURN count(a) AS rowCount`;
					runCypher({ cypher }, (err, result) => {
						if (err) {
							next(`${moduleName}: the ${oneVerdict.gate} attestation failed: ${err}`);
							return;
						}
						const rows = (result && result.records) || [];
						if (rows.length !== 1 || numberFrom(rows[0], 'rowCount') !== 1) {
							next(`${moduleName} REFUSED: the ${oneVerdict.gate} attestation wrote no row`);
							return;
						}
						next('', { ...args, stampedGateList: (args.stampedGateList || []).concat([oneVerdict.gate]) });
					});
				});
			});

			taskList.push((args, next) => {
				readCensus(runCypher, 'AFTER', (err, after) => {
					if (err) {
						next(err);
						return;
					}
					if (after.contentNodeCount !== args.before.contentNodeCount || after.contentEdgeCount !== args.before.contentEdgeCount) {
						next(
							`${moduleName} REFUSED: the stamp changed CONTENT — nodes ${args.before.contentNodeCount} → ${after.contentNodeCount}, ` +
								`edges ${args.before.contentEdgeCount} → ${after.contentEdgeCount}. A promotion stamp writes metadata only.`,
						);
						return;
					}
					next('', { ...args, after });
				});
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					graphName: args.graphName,
					scratchGraphName: args.scratchGraphName,
					manifestRefId: args.manifestRefId,
					stampedGateList: args.stampedGateList,
					before: args.before,
					after: args.after,
					summary:
						`promotion stamp: graphName '${args.graphName}' (scratch '${args.scratchGraphName}'); attested ${args.stampedGateList.join(', ')}; ` +
						`content unchanged: ${args.after.contentNodeCount} node(s), ${args.after.contentEdgeCount} edge(s) before and after`,
				});
			});
		};

		return { stampPromotion, STAMPABLE_GATE_LIST, STAMPABLE_VERDICT_LIST, CONTENT_CENSUS_CYPHER };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
