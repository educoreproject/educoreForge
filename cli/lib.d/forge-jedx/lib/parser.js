'use strict';

// parser.js — JEDx CSV data model → native JEDx graphForge node format.
//
// HARVESTED from educoreForgeOLD/system/code/cli/lib.d/forge-jedx/lib/parser.js: the source-navigation
// logic is reused as-is — the quote-aware CSV line splitter, the per-file entity-name extraction
// ("worker_compensation_report-Table 1.csv" -> "worker_compensation_report"), the (Name-bearing) row
// filter, the FK-by-naming reference resolution (<targetEntity>RefId -> targetEntity, Keys==='FK'),
// and the codeset grouping (a distinct codeset per unique non-empty 'Code Set' cell, keyed by its raw
// value, with the set of fields that use it). What is REUSED is HOW the source is read; the emitted
// node SHAPE is the SAME native shape forge-sif/forge-edfi produce (id/label/superLabel/properties/
// edges + optional _parentEdge) so the forge-jedx MAIN module can map each native node onto the
// universal six-role Dme* contract exactly as forge-edfi does. The OLD output schema (its own node
// contract + native HAS_ENTITY edges + hand-rolled searchText) is NOT reproduced.
//
// Source: a DIRECTORY of one CSV per JEDx entity. Each row defines a field with
//   Name, Type, Description, Path, Code Set, Annotation, Keys.
//
// The parser NEVER touches Neo4j. It only reads the source files and returns native nodes. JEDx
// carries NO CEDS-crosswalk columns, so there is no bridge-stash data here — the block is naturally
// CEDS-pure and the main module emits NO cross-standard edges.

const fs = require('fs');
const path = require('path');

// ============================================================
// CSV PARSING  (harvested verbatim from the old forge-jedx parser)
// ============================================================

const parseCsvLine = (line) => {
	const fields = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			fields.push(current.trim());
			current = '';
		} else {
			current += ch;
		}
	}
	fields.push(current.trim());
	return fields;
};

const parseCsvFile = (csvPath) => {
	const content = fs.readFileSync(csvPath, 'utf8');
	const lines = content.split('\n').filter((line) => line.trim());

	if (lines.length < 2) {
		return { headers: [], rows: [] };
	}

	const headers = parseCsvLine(lines[0]);
	const rows = [];

	for (let i = 1; i < lines.length; i++) {
		const values = parseCsvLine(lines[i]);
		const row = {};
		headers.forEach((header, idx) => {
			row[header] = (values[idx] || '').trim();
		});
		if (row.Name) {
			rows.push(row);
		}
	}

	return { headers, rows };
};

// ============================================================
// ENTITY EXTRACTION  (harvested)
// ============================================================

const extractEntityName = (filename) => {
	// "job-Table 1.csv" -> "job"; "worker_compensation_report-Table 1.csv" -> "worker_compensation_report".
	return filename.replace(/-Table\s+\d+\.csv$/i, '');
};

const parseAllCsvFiles = (sourceDirPath) => {
	const csvFiles = fs
		.readdirSync(sourceDirPath)
		.filter((f) => f.endsWith('.csv'))
		.sort();

	const entities = [];

	for (const csvFile of csvFiles) {
		const entityName = extractEntityName(csvFile);
		const csvPath = path.join(sourceDirPath, csvFile);
		const { rows } = parseCsvFile(csvPath);

		const fields = [];
		const fkFields = [];

		for (const row of rows) {
			const fieldDef = {
				name: row.Name || '',
				type: row.Type || '',
				description: row.Description || '',
				path: row.Path || '',
				codeSet: row['Code Set'] || '',
				annotation: row.Annotation || '',
				keys: row.Keys || '',
			};

			fields.push(fieldDef);

			if (fieldDef.keys === 'FK') {
				fkFields.push(fieldDef);
			}
		}

		entities.push({
			name: entityName,
			sourceFile: csvFile,
			fields,
			fkFields,
			pkField: fields.find((f) => f.keys === 'PK') || null,
		});
	}

	return entities;
};

// ============================================================
// FK RESOLUTION — entity -> entity references (harvested)
// ============================================================

const resolveEntityReferences = (entities) => {
	const entityNameSet = new Set(entities.map((e) => e.name));
	const edges = [];

	for (const entity of entities) {
		for (const fkField of entity.fkFields) {
			// FK field names follow the pattern <targetEntity>RefId (organizationRefId -> organization).
			const cleanName = fkField.name;
			const baseName = cleanName.replace(/RefId$/, '');

			if (entityNameSet.has(baseName)) {
				edges.push({
					sourceEntity: entity.name,
					targetEntity: baseName,
					via: cleanName,
					description: fkField.description,
				});
			}
		}
	}

	return edges;
};

// ============================================================
// MAIN PARSER — graphForge parser contract (callback(err, { nodes, metadata }))
//   Emits native JEDx nodes in the forge-edfi/forge-sif native shape:
//     JedxRoot, JedxEntity (-> DmeClass), JedxField (+ _parentEdge HAS_FIELD -> entity; -> DmeProperty),
//     JedxCodeSet (-> DmeOptionSet). A field constrained by a code set carries a CONSTRAINED_BY edge
//     (field -> codeset) on its .edges (the main module translates it to HAS_OPTION_SET — the property
//     OWNS its option set). An entity FK reference carries a REFERENCES edge (entity -> entity) on its
//     .edges (genuine class -> class; stays REFERENCES). All ownership-from-root edges (HAS_CLASS) are
//     SYNTHESIZED by the main module, not declared here (mirrors forge-edfi). JEDx code sets have no
//     enumerated values in the source, so NO DmeOptionValue nodes are produced.
// ============================================================

module.exports = (sourcePath, options, callback) => {
	if (!fs.existsSync(sourcePath)) {
		callback(`Source path not found: ${sourcePath}`);
		return;
	}

	// The registry points at the version DIRECTORY containing the per-entity CSVs (mirrors forge-edfi).
	const stat = fs.statSync(sourcePath);
	if (!stat.isDirectory()) {
		callback(
			`forge-jedx parser: --source must be the version directory containing the JEDx CSV files: ${sourcePath}`,
		);
		return;
	}

	console.error(`[jedx/parser] Parsing CSV files in: ${sourcePath}`);

	// Step 1 — parse all CSVs (harvested navigation).
	const entities = parseAllCsvFiles(sourcePath);
	console.error(`[jedx/parser] Parsed ${entities.length} JEDx entities`);

	// Step 2 — resolve FK references between entities (harvested).
	const referenceEdges = resolveEntityReferences(entities);
	console.error(`[jedx/parser] Resolved ${referenceEdges.length} entity->entity REFERENCES edges`);

	// Step 3 — collect unique code-set values (harvested grouping: one codeset per unique 'Code Set'
	// cell, keyed by its raw value; track the fields that use it for the usedByFieldCount stat).
	const codesetMap = new Map(); // codesetKey -> { value, fields: [] }
	const fieldCodesetMap = new Map(); // fieldKey -> codesetKey
	for (const entity of entities) {
		for (const field of entity.fields) {
			if (field.codeSet) {
				const codesetKey = field.codeSet;
				if (!codesetMap.has(codesetKey)) {
					codesetMap.set(codesetKey, { value: field.codeSet, fields: [] });
				}
				const fieldKey = field.path || `${entity.name}.${field.name}`;
				codesetMap.get(codesetKey).fields.push(fieldKey);
				fieldCodesetMap.set(fieldKey, codesetKey);
			}
		}
	}

	// Step 4 — build native nodes (native shape; NOT the universal contract — that is the main module).
	const nodes = [];

	const totalFieldCount = entities.reduce((sum, e) => sum + e.fields.length, 0);

	// natural keys: entity name; field 'path'||'entity.name'; codeset raw value.
	const entityNativeIdByName = {};
	entities.forEach((e) => {
		entityNativeIdByName[e.name] = `jedxentity-${e.name}`;
	});

	// --- JedxRoot (no native ownership edges — main module synthesizes HAS_CLASS) ---
	nodes.push({
		id: 'jedx-root',
		label: 'JedxRoot',
		superLabel: 'JedxModel',
		properties: {
			name: 'JEDx',
			description: `JEDx Data Model — ${entities.length} entities, ${totalFieldCount} fields, ${codesetMap.size} code sets`,
			entityCount: entities.length,
			fieldCount: totalFieldCount,
			codesetCount: codesetMap.size,
			referenceEdgeCount: referenceEdges.length,
		},
		edges: [],
	});

	// --- JedxEntity nodes (-> DmeClass); REFERENCES (entity -> entity FK) live on the entity's edges ---
	entities.forEach((entity) => {
		const entityId = entityNativeIdByName[entity.name];
		const entityEdges = [];

		referenceEdges
			.filter((re) => re.sourceEntity === entity.name)
			.forEach((re) => {
				entityEdges.push({
					type: 'REFERENCES',
					targetId: entityNativeIdByName[re.targetEntity],
					targetLabel: 'JedxEntity',
					properties: { via: re.via, description: re.description },
				});
			});

		nodes.push({
			id: entityId,
			label: 'JedxEntity',
			superLabel: 'JedxModel',
			properties: {
				name: entity.name,
				description: `JEDx entity: ${entity.name} (${entity.fields.length} fields)`,
				sourceFile: entity.sourceFile,
				fieldCount: entity.fields.length,
				fkCount: entity.fkFields.length,
				hasPk: !!entity.pkField,
			},
			edges: entityEdges,
		});
	});

	// --- JedxField nodes (-> DmeProperty); CONSTRAINED_BY (field -> codeset) when the field has a Code Set ---
	let descriptorFields = 0; // fields carrying a code-set constraint
	entities.forEach((entity) => {
		const entityId = entityNativeIdByName[entity.name];

		entity.fields.forEach((field) => {
			const fieldKey = field.path || `${entity.name}.${field.name}`;
			const fieldNativeId = `jedxfield-${fieldKey}`;
			const fieldEdges = [];

			const codesetKey = fieldCodesetMap.get(fieldKey);
			if (codesetKey) {
				fieldEdges.push({
					type: 'CONSTRAINED_BY',
					targetId: `jedxcodeset-${codesetKey}`,
					targetLabel: 'JedxCodeSet',
				});
				descriptorFields++;
			}

			const fieldProps = {
				name: field.name,
				description: field.description || `JEDx field: ${entity.name}.${field.name}`,
				entityName: entity.name,
				elementType: field.type || '',
				fieldPath: fieldKey,
				annotation: field.annotation || '',
				isPrimaryKey: field.keys === 'PK',
				isForeignKey: field.keys === 'FK',
			};
			if (field.codeSet) {
				fieldProps.codeSet = field.codeSet;
			}

			nodes.push({
				id: fieldNativeId,
				label: 'JedxField',
				superLabel: 'JedxModel',
				properties: fieldProps,
				edges: fieldEdges,
				_parentEdge: {
					type: 'HAS_FIELD',
					fromId: entityId,
					fromLabel: 'JedxEntity',
				},
			});
		});
	});

	// --- JedxCodeSet nodes (-> DmeOptionSet); no enumerated values in source, so no values declared ---
	codesetMap.forEach((cs, key) => {
		nodes.push({
			id: `jedxcodeset-${key}`,
			label: 'JedxCodeSet',
			superLabel: 'JedxModel',
			properties: {
				name: key,
				description: `JEDx code set: ${key}`,
				value: cs.value,
				usedByFieldCount: cs.fields.length,
			},
			edges: [],
		});
	});

	// counts.
	let totalEdges = 0;
	let parentEdgeCount = 0;
	nodes.forEach((n) => {
		totalEdges += (n.edges || []).length;
		if (n._parentEdge) {
			parentEdgeCount++;
		}
	});

	console.error(`[jedx/parser] Total native nodes: ${nodes.length}`);
	console.error(`[jedx/parser] Declared native edges (REFERENCES + CONSTRAINED_BY): ${totalEdges}`);
	console.error(`[jedx/parser] Parent edges (HAS_FIELD): ${parentEdgeCount}`);
	console.error(`[jedx/parser] Code sets: ${codesetMap.size}; fields constrained by a code set: ${descriptorFields}`);

	callback('', {
		nodes,
		metadata: {
			version: '1.0',
			sourceFormat: 'csv',
			sourceFiles: entities.map((e) => e.sourceFile),
			entityCount: entities.length,
			fieldCount: totalFieldCount,
			codesetCount: codesetMap.size,
			referenceEdgeCount: referenceEdges.length,
			descriptorFields,
			totalNodes: nodes.length,
		},
	});
};
