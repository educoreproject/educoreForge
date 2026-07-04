'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// standard-definition-finisher.js — Wave B move #5 (PLAN §5): one :StandardDefinition node per source
// standard, parallel to :HubDefinition. Derived ENTIRELY IN-GRAPH from the replayed content — the
// DmeStandardRoot provenance block (standardKey/standardName/version/sourceFormat/sourceUrl/description,
// plus versionSource when the producer stamped it) + deterministic counts + the standard's mapping
// disposition (authored / inferred / island, read from EXACT/CLOSE edge presence and per-edge SSSOM
// versions). A deterministic function of the built graph: no clock, no randomness, no store reads.
//
// HONESTY RULES (the plan's no-fabrication bar):
//   - version passes through from the root; versionSource passes through when present, defaults to
//     'declared' ONLY when a version exists (the producer parsed it from source), stays null when the
//     version itself is absent — a missing version reads as an honest null, never an invented value.
//   - description passes through from the root; when the source is silent the node SAYS SO explicitly.
//
// Async style: qtools taskListPlus/pipeRunner; cypher at the leaf via the injected lifecycle. No
// async/await, no try/catch-for-control-flow. camelCase only.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle, vocabulary } = {}) => {
		const { xLog } = process.global;

		const { SELF_DOC, DME_ROLES } = vocabulary;
		const DEFINITION_LABEL = SELF_DOC.NODE_LABELS.STANDARD_DEFINITION;
		const STABLE_ID_PREFIX = SELF_DOC.STANDARD_DEFINITION_STABLE_ID_PREFIX;

		// ----- finish — derive + MERGE one :StandardDefinition per DmeStandardRoot, in one
		//   parameterized pass per phase (derive in-cypher, then merge from the computed rows).
		const finish = ({ graphName } = {}, callback) => {
			const taskList = new taskListPlus();

			// 1) derive the per-standard facts in-cypher (roots, counts, mapping evidence, versions).
			taskList.push((args, next) => {
				const cypher = `MATCH (root:ForgedNode { role: $standardRootRole })
					CALL {
						WITH root
						MATCH (n:ForgedNode { _source: root._source })
						RETURN count(n) AS nodeCount,
							count(CASE WHEN n.role = $propertyRole THEN 1 END) AS propertyCount,
							count(CASE WHEN n.role = $classRole THEN 1 END) AS classCount,
							count(CASE WHEN n.role = $optionSetRole THEN 1 END) AS optionSetCount,
							count(CASE WHEN n.role = $optionValueRole THEN 1 END) AS optionValueCount
					}
					CALL {
						WITH root
						OPTIONAL MATCH (p:ForgedNode { _source: root._source, role: $propertyRole })
						RETURN count(CASE WHEN (p)-[:EXACT_MATCH]->(:HubReference) THEN 1 END) AS exactMappedProperties,
							count(CASE WHEN (p)-[:CLOSE_MATCH]->(:HubReference) THEN 1 END) AS closeMappedProperties
					}
					CALL {
						WITH root
						OPTIONAL MATCH (m:ForgedNode { _source: root._source })-[e:EXACT_MATCH|CLOSE_MATCH]->(:HubReference)
						RETURN count(e) AS mappingEdgeCount,
							count(CASE WHEN type(e) = 'EXACT_MATCH' THEN 1 END) AS exactEdgeCount,
							count(CASE WHEN type(e) = 'CLOSE_MATCH' THEN 1 END) AS closeEdgeCount,
							collect(DISTINCT e.subjectVersion) AS subjectVersions,
							collect(DISTINCT e.objectVersion) AS objectVersions
					}
					RETURN root._source AS source, root.standardKey AS standardKey,
						root.standardName AS standardName, root.name AS rootName,
						root.version AS version, root.versionSource AS versionSource,
						root.sourceFormat AS sourceFormat, root.sourceUrl AS sourceUrl,
						root.description AS rootDescription,
						nodeCount, propertyCount, classCount, optionSetCount, optionValueCount,
						exactMappedProperties, closeMappedProperties,
						mappingEdgeCount, exactEdgeCount, closeEdgeCount,
						subjectVersions, objectVersions
					ORDER BY source`;
				lifecycle.runCypher(
					{
						graphName,
						cypher,
						params: {
							standardRootRole: DME_ROLES.STANDARD_ROOT,
							propertyRole: DME_ROLES.PROPERTY,
							classRole: DME_ROLES.CLASS,
							optionSetRole: DME_ROLES.OPTION_SET,
							optionValueRole: DME_ROLES.OPTION_VALUE,
						},
					},
					(err, result) => {
						if (err) {
							next(`standard-definition-finisher: derivation query failed: ${err}`);
							return;
						}
						next('', { ...args, derivedRows: result.records });
					},
				);
			});

			// 2) shape the rows (disposition + honest version/description rules) and MERGE.
			taskList.push((args, next) => {
				const definitionRows = args.derivedRows.map((oneRow) => {
					const exactEdges = Number(oneRow.exactEdgeCount || 0);
					const closeEdges = Number(oneRow.closeEdgeCount || 0);
					const mappingDisposition =
						exactEdges > 0 && closeEdges > 0
							? 'authored+inferred'
							: exactEdges > 0
								? 'authored'
								: closeEdges > 0
									? 'inferred'
									: 'island';
					const version = oneRow.version || null;
					const versionSource = oneRow.versionSource || (version ? 'declared' : null);
					const displayName = oneRow.standardName || oneRow.rootName || oneRow.source;
					const description = oneRow.rootDescription
						? oneRow.rootDescription
						: `The source provides no description for this standard.`;
					return {
						stableId: `${STABLE_ID_PREFIX}${oneRow.source}`,
						source: oneRow.source,
						standardKey: oneRow.standardKey || null,
						displayName,
						name: displayName,
						version,
						versionSource,
						sourceFormat: oneRow.sourceFormat || null,
						sourceUrl: oneRow.sourceUrl || null,
						description,
						nodeCount: Number(oneRow.nodeCount || 0),
						propertyCount: Number(oneRow.propertyCount || 0),
						classCount: Number(oneRow.classCount || 0),
						optionSetCount: Number(oneRow.optionSetCount || 0),
						optionValueCount: Number(oneRow.optionValueCount || 0),
						exactMappedProperties: Number(oneRow.exactMappedProperties || 0),
						closeMappedProperties: Number(oneRow.closeMappedProperties || 0),
						mappingEdgeCount: Number(oneRow.mappingEdgeCount || 0),
						exactEdgeCount: exactEdges,
						closeEdgeCount: closeEdges,
						mappingDisposition,
						// SSSOM endpoint versions observed on this standard's mapping edges (both ends of
						// "versioned at both ends"). DETERMINISM: cypher collect() order is not stable, so the
						// full DISTINCT set is sorted HERE and only then bounded — twin builds store identical arrays.
						subjectVersions: (oneRow.subjectVersions || []).filter((v) => v !== null).sort().slice(0, 8),
						objectVersions: (oneRow.objectVersions || []).filter((v) => v !== null).sort().slice(0, 8),
					};
				});
				if (!definitionRows.length) {
					next('', { ...args, definitionCount: 0, definitionRows });
					return;
				}
				const cypher = `UNWIND $definitionRows AS row
					MERGE (d:ForgedNode:\`${DEFINITION_LABEL}\` { stableId: row.stableId })
					SET d.source = row.source, d.standardKey = row.standardKey,
						d.displayName = row.displayName, d.name = row.name,
						d.version = row.version, d.versionSource = row.versionSource,
						d.sourceFormat = row.sourceFormat, d.sourceUrl = row.sourceUrl,
						d.description = row.description,
						d.nodeCount = row.nodeCount, d.propertyCount = row.propertyCount,
						d.classCount = row.classCount, d.optionSetCount = row.optionSetCount,
						d.optionValueCount = row.optionValueCount,
						d.exactMappedProperties = row.exactMappedProperties,
						d.closeMappedProperties = row.closeMappedProperties,
						d.mappingEdgeCount = row.mappingEdgeCount,
						d.exactEdgeCount = row.exactEdgeCount, d.closeEdgeCount = row.closeEdgeCount,
						d.mappingDisposition = row.mappingDisposition,
						d.subjectVersions = row.subjectVersions, d.objectVersions = row.objectVersions
					RETURN count(d) AS definitionCount`;
				lifecycle.runCypher(
					{ graphName, cypher, params: { definitionRows } },
					(err, result) => {
						if (err) {
							next(`standard-definition-finisher: MERGE failed: ${err}`);
							return;
						}
						next('', {
							...args,
							definitionRows,
							definitionCount: Number(result.records[0].definitionCount),
						});
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				const dispositionSummary = args.definitionRows
					.map((oneRow) => `${oneRow.source}:${oneRow.mappingDisposition}`)
					.join(', ');
				callback('', {
					summary: `standard definitions: ${args.definitionCount} standard(s) [${dispositionSummary}]`,
					definitionCount: args.definitionCount,
				});
			});
		};

		return { finish };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
