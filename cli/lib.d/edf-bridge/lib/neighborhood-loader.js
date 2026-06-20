'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// neighborhood-loader.js — GENERIC, BULK pre-loader of node fields + neighborhood bundles for the
// -implied reranker (Phase II). Keyed on the UNIVERSAL contract: every structural node carries
// `parentId` (-> parent stableId, 100% present on CEDS+LIF), so parent/siblings/children resolve with
// NO per-label NEIGHBORHOOD_QUERIES and NO per-(source,candidate) graph walk. The whole rerank batch
// is loaded in a FIXED, small number of round-trips (perf: trackA's bounded-I/O discipline):
//   1  node fields for all referenced stableIds (sources + every candidate)
//   1  parent {name, embedding} for all distinct parentIds
//   1  sibling NAMES grouped by parentId (the pool a node's siblings come from)
//   1  child  NAMES grouped by parentId (a node's own children)
// Sibling/child sets are NAME-ONLY (no embeddings) — heap-conscious, exactly as trackA degrades them;
// the parent (one per node) carries its embedding for parentTypeSim.
//
// Async style: qtools taskListPlus/pipeRunner; neo4j only via lifecycle.runCypher. camelCase only.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const toNumber = (value) => {
	if (value && typeof value === 'object' && typeof value.toNumber === 'function') {
		return value.toNumber();
	}
	if (value === null || value === undefined) {
		return null;
	}
	return Number(value);
};

const uniq = (values) => Array.from(new Set(values.filter((v) => v !== null && v !== undefined)));

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ lifecycle } = {}) => {
		// loadBundles — { graphName, stableIds } ->
		//   { fieldsById: { id -> {stableId,name,embedding,dataType,path,depth,parentId} },
		//     bundleById: { id -> {parent:{name,embedding}|null, siblings:[{name}], children:[{name}]} } }
		const loadBundles = ({ graphName, stableIds }, callback) => {
			const ids = uniq(stableIds);
			if (ids.length === 0) {
				callback('', { fieldsById: {}, bundleById: {} });
				return;
			}

			const taskList = new taskListPlus();

			// 1. node fields for every referenced id.
			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (n) WHERE n.stableId IN $ids
							RETURN n.stableId AS id, n.name AS name, n.embedding AS embedding,
								n.dataType AS dataType, n.path AS path, n.depth AS depth, n.parentId AS parentId
						`,
						params: { ids },
					},
					(err, result) => {
						if (err) {
							next(`neighborhood-loader node fields: ${err}`);
							return;
						}
						const fieldsById = {};
						(result.records || []).forEach((record) => {
							fieldsById[record.id] = {
								stableId: record.id,
								name: record.name || '',
								embedding: Array.isArray(record.embedding) ? record.embedding : null,
								dataType: record.dataType || null,
								path: record.path || null,
								depth: toNumber(record.depth),
								parentId: record.parentId || null,
							};
						});
						next('', { ...args, fieldsById });
					},
				);
			});

			// 2. parent {name, embedding} for all distinct parentIds.
			taskList.push((args, next) => {
				const parentIds = uniq(ids.map((id) => (args.fieldsById[id] || {}).parentId));
				if (parentIds.length === 0) {
					next('', { ...args, parentById: {} });
					return;
				}
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (p) WHERE p.stableId IN $parentIds
							RETURN p.stableId AS id, p.name AS name, p.embedding AS embedding
						`,
						params: { parentIds },
					},
					(err, result) => {
						if (err) {
							next(`neighborhood-loader parents: ${err}`);
							return;
						}
						const parentById = {};
						(result.records || []).forEach((record) => {
							parentById[record.id] = {
								name: record.name || '',
								embedding: Array.isArray(record.embedding) ? record.embedding : null,
							};
						});
						next('', { ...args, parentById });
					},
				);
			});

			// 3. sibling NAMES grouped by parentId (every child name under each parent).
			taskList.push((args, next) => {
				const parentIds = uniq(ids.map((id) => (args.fieldsById[id] || {}).parentId));
				if (parentIds.length === 0) {
					next('', { ...args, siblingNamesByParent: {} });
					return;
				}
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (s) WHERE s.parentId IN $parentIds
							RETURN s.parentId AS parentId, collect(s.name) AS names
						`,
						params: { parentIds },
					},
					(err, result) => {
						if (err) {
							next(`neighborhood-loader siblings: ${err}`);
							return;
						}
						const siblingNamesByParent = {};
						(result.records || []).forEach((record) => {
							siblingNamesByParent[record.parentId] = (record.names || []).filter(
								(name) => name !== null && name !== undefined,
							);
						});
						next('', { ...args, siblingNamesByParent });
					},
				);
			});

			// 4. child NAMES grouped by the focal node id (children whose parentId == that id).
			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName,
						cypher: `
							MATCH (c) WHERE c.parentId IN $ids
							RETURN c.parentId AS parentId, collect(c.name) AS names
						`,
						params: { ids },
					},
					(err, result) => {
						if (err) {
							next(`neighborhood-loader children: ${err}`);
							return;
						}
						const childNamesByNode = {};
						(result.records || []).forEach((record) => {
							childNamesByNode[record.parentId] = (record.names || []).filter(
								(name) => name !== null && name !== undefined,
							);
						});
						next('', { ...args, childNamesByNode });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				// assemble bundles. siblings of a node = the parent's children MINUS the node itself
				// (by name); names-only (embedding null -> setSim degrades to token Jaccard).
				const bundleById = {};
				ids.forEach((id) => {
					const fields = args.fieldsById[id];
					if (!fields) {
						bundleById[id] = { parent: null, siblings: [], children: [] };
						return;
					}
					const parent = fields.parentId ? args.parentById[fields.parentId] || null : null;
					const siblingPool = fields.parentId
						? args.siblingNamesByParent[fields.parentId] || []
						: [];
					let selfRemoved = false;
					const siblings = siblingPool
						.filter((name) => {
							if (!selfRemoved && name === fields.name) {
								selfRemoved = true; // drop one occurrence of self
								return false;
							}
							return true;
						})
						.map((name) => ({ name }));
					const children = (args.childNamesByNode[id] || []).map((name) => ({ name }));
					bundleById[id] = { parent, siblings, children };
				});
				callback('', { fieldsById: args.fieldsById, bundleById });
			});
		};

		return { loadBundles };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
