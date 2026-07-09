'use strict';

// parser.js — Ed-Fi CEDS-crosswalk CSVs → native EdFi graphForge node format.
//
// HARVESTED from educoreForgeOLD/system/code/cli/lib.d/forge-edfi/lib/parser.js: the CSV navigation
// logic (the quote-aware line splitter, the duplicate-header override for the descriptors file, the
// (entity,element) field grouping, and the descriptor->values grouping) is reused as-is. What is
// REUSED is HOW the source is read; the emitted node shape is the SAME native shape forge-sif's
// parser produces (id/label/superLabel/properties/edges + optional _parentEdge) so the forge-edfi
// MAIN module can map each native node onto the universal six-role Dme* contract exactly as
// forge-sif does. The OLD output schema (its own node contract + native HAS_ENTITY edges) is NOT
// reproduced.
//
// Two source CSVs (a DIRECTORY is the source; the parser resolves both files inside it):
//   EdFiEntityElementsToCEDS.csv     — entity fields, with target CEDS element global-ids (BRIDGE)
//   EdFiEntityDescriptorsToCEDS.csv  — descriptor values, with target CEDS option codes (BRIDGE)
//
// The parser NEVER touches Neo4j. It only reads the source files and returns native nodes. The CEDS
// target values are carried through as field/value properties (cedsGlobalId / cedsOptionCode) for a
// LATER bridge phase — they are NOT structural EdFi data and produce NO cross-standard edges.

const fs = require('fs');
const path = require('path');

// ============================================================
// CSV PARSING  (harvested verbatim from the old forge-edfi parser)
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

const parseCsvFile = (csvPath, headerOverrides) => {
	const content = fs.readFileSync(csvPath, 'utf8');
	const lines = content.split('\n').filter((line) => line.trim());

	if (lines.length < 2) {
		return { headers: [], rows: [] };
	}

	const rawHeaders = parseCsvLine(lines[0]);

	// Apply overrides for duplicate column names (the descriptors file repeats 'EdFiDescription').
	const headers = rawHeaders.map((h, idx) => {
		if (headerOverrides && headerOverrides[idx]) {
			return headerOverrides[idx];
		}
		return h;
	});

	const rows = [];
	for (let i = 1; i < lines.length; i++) {
		const values = parseCsvLine(lines[i]);
		const row = {};
		headers.forEach((header, idx) => {
			row[header] = (values[idx] || '').trim();
		});
		rows.push(row);
	}

	return { headers, rows };
};

// ============================================================
// ELEMENTS CSV PROCESSING  (harvested: (entity,element) grouping + multi-CEDS collection)
// ============================================================

const processElementsCsv = (csvPath) => {
	const { rows } = parseCsvFile(csvPath);

	// Group by (entity, element) to handle rows that map to multiple CEDS elements.
	const fieldMap = new Map();
	const entitySet = new Map(); // entity name → first description seen

	for (const row of rows) {
		const entity = row.EdFiEntity;
		const element = row.EdFiElementName;
		if (!entity || !element) {
			continue;
		}

		const fieldKey = `${entity}.${element}`;

		if (!entitySet.has(entity)) {
			entitySet.set(entity, row.EdFiEntityDescription || '');
		}

		if (!fieldMap.has(fieldKey)) {
			fieldMap.set(fieldKey, {
				entity,
				element,
				elementType: row.EdFiElementType || '',
				required: row.EdFiRequired === '1',
				description: row.EdFiElementDescription || '',
				entityPath: row.EdFiEntityPath || '',
				cedsGlobalIds: [],
			});
		}

		const cedsGlobalId = row.CEDSGlobalId;
		if (cedsGlobalId && cedsGlobalId !== '000000') {
			fieldMap.get(fieldKey).cedsGlobalIds.push(cedsGlobalId);
		}
	}

	return { fieldMap, entitySet };
};

// ============================================================
// DESCRIPTORS CSV PROCESSING  (harvested: duplicate-header override + descriptor→values grouping)
// ============================================================

const processDescriptorsCsv = (csvPath) => {
	// Descriptors CSV has duplicate "EdFiDescription" at cols 4 and 8.
	// Col 4 = value description, Col 8 = element/path description.
	const headerOverrides = {
		8: 'EdFiElementDescription',
	};

	const { rows } = parseCsvFile(csvPath, headerOverrides);

	// Build descriptor → values mapping.
	//
	// DEDUP (correctness fix over the harvested logic): the source repeats a descriptor's ENTIRE
	// code-value list once per entity that uses the descriptor (e.g. AcademicSubjectDescriptor's
	// values appear under every entity referencing it). A descriptor's option-value SET is canonical
	// — one DmeOptionValue per (descriptorName, codeValue) regardless of how many entities use it.
	// So we key values by codeValue WITHIN each descriptor and merge: first occurrence wins for the
	// descriptive fields, but a later occurrence FILLS an empty cedsOptionCode / description (prefer
	// the richer row's bridge + text). Without this dedup the same value-stableId is emitted many
	// times and the replay engine silently MERGEs them — masking the duplication as "missing" data.
	const descriptorMap = new Map(); // descriptor name → { descriptor info, valueByCode: Map }

	for (const row of rows) {
		const descriptorName = row.EdFiElementName;
		const codeValue = row.EdFiCodeValue;
		if (!descriptorName || !codeValue) {
			continue;
		}

		if (!descriptorMap.has(descriptorName)) {
			descriptorMap.set(descriptorName, {
				name: descriptorName,
				namespace: row.EdFiNamespace || '',
				entity: row.EdFiEntity || '',
				path: row.EdFiPath || '',
				elementDescription: row.EdFiElementDescription || '',
				version: row.EdFiVersionNumber || '',
				cedsElementName: row.CEDSElementName || '',
				cedsGlobalId:
					row.CEDSGlobalId && row.CEDSGlobalId !== '000000'
						? row.CEDSGlobalId
						: '',
				valueByCode: new Map(),
			});
		}

		const descriptor = descriptorMap.get(descriptorName);
		const existing = descriptor.valueByCode.get(codeValue);
		if (!existing) {
			descriptor.valueByCode.set(codeValue, {
				codeValue,
				shortDescription: row.EdFiShortDescription || '',
				description: row.EdFiDescription || '',
				cedsOptionCode: row.CEDSOptionCode || '',
				cedsOptionDescription: row.CEDSOptionDescription || '',
				optionSetMatchConfidence: row.OptionSetMatchConfidence || '',
				elementMatchConfidence: row.ElementMatchConfidence || '',
			});
			continue;
		}
		// merge: fill any empty field on the first-seen value from this later row (richer wins).
		if (!existing.description && row.EdFiDescription) existing.description = row.EdFiDescription;
		if (!existing.shortDescription && row.EdFiShortDescription) existing.shortDescription = row.EdFiShortDescription;
		if (!existing.cedsOptionCode && row.CEDSOptionCode) existing.cedsOptionCode = row.CEDSOptionCode;
		if (!existing.cedsOptionDescription && row.CEDSOptionDescription) existing.cedsOptionDescription = row.CEDSOptionDescription;
	}

	// flatten valueByCode -> values[] (insertion order = first-seen source order, deterministic).
	descriptorMap.forEach((descriptor) => {
		descriptor.values = [...descriptor.valueByCode.values()];
		delete descriptor.valueByCode;
	});

	return descriptorMap;
};

// ============================================================
// MAIN PARSER — graphForge parser contract (callback(err, { nodes, metadata }))
//   Emits native EdFi nodes in the forge-sif native shape:
//     EdfiRoot, EdfiEntity, EdfiField (+ _parentEdge HAS_FIELD -> entity),
//     EdfiDescriptor (DmeOptionSet), EdfiDescriptorValue (+ _parentEdge HAS_VALUE -> descriptor).
//   The field's CONSTRAINED_BY edge (field -> descriptor) lives on the field's .edges (the main
//   module translates it to HAS_OPTION_SET). All ownership-from-root edges (HAS_CLASS) are
//   SYNTHESIZED by the main module, not declared here (mirrors forge-sif).
// ============================================================

module.exports = (sourcePath, options, callback) => {
	if (!fs.existsSync(sourcePath)) {
		callback(`Source path not found: ${sourcePath}`);
		return;
	}

	// The registry points at the version DIRECTORY containing both CSVs (mirrors forge-sif).
	const stat = fs.statSync(sourcePath);
	if (!stat.isDirectory()) {
		callback(
			`forge-edfi parser: --source must be the version directory containing the two CSV files: ${sourcePath}`,
		);
		return;
	}

	const elementsCsvPath = path.join(sourcePath, 'EdFiEntityElementsToCEDS.csv');
	const descriptorsCsvPath = path.join(sourcePath, 'EdFiEntityDescriptorsToCEDS.csv');

	if (!fs.existsSync(elementsCsvPath)) {
		callback(`Elements CSV not found: ${elementsCsvPath}`);
		return;
	}
	if (!fs.existsSync(descriptorsCsvPath)) {
		callback(`Descriptors CSV not found: ${descriptorsCsvPath}`);
		return;
	}

	console.error(`[edfi/parser] Parsing CSV files in: ${sourcePath}`);

	// Step 1: parse both CSVs (harvested navigation).
	const { fieldMap, entitySet } = processElementsCsv(elementsCsvPath);
	const descriptorMap = processDescriptorsCsv(descriptorsCsvPath);

	console.error(
		`[edfi/parser] Parsed ${entitySet.size} entities, ${fieldMap.size} fields`,
	);
	console.error(`[edfi/parser] Parsed ${descriptorMap.size} descriptors`);

	// Step 2: build native nodes.
	const nodes = [];

	// natural keys: entity name; field 'entity.element'; descriptor name; value 'descriptor.code'.
	const entityNativeIdByName = {};
	entitySet.forEach((desc, name) => {
		entityNativeIdByName[name] = `edfientity-${name}`;
	});

	const descriptorNativeIdByName = {};
	descriptorMap.forEach((desc, name) => {
		descriptorNativeIdByName[name] = `edfidescriptor-${name}`;
	});

	// totals for the root description.
	const totalFieldCount = fieldMap.size;
	const totalDescriptorCount = descriptorMap.size;
	let totalDescriptorValueCount = 0;
	descriptorMap.forEach((d) => {
		totalDescriptorValueCount += d.values.length;
	});

	// --- EdfiRoot (no native ownership edges — main module synthesizes HAS_CLASS) ---
	nodes.push({
		id: 'edfi-root',
		label: 'EdfiRoot',
		superLabel: 'EdfiModel',
		properties: {
			name: 'EdFi',
			description: `Ed-Fi Data Standard — ${entitySet.size} entities, ${totalFieldCount} fields, ${totalDescriptorCount} descriptors, ${totalDescriptorValueCount} descriptor values`,
			entityCount: entitySet.size,
			fieldCount: totalFieldCount,
			descriptorCount: totalDescriptorCount,
			descriptorValueCount: totalDescriptorValueCount,
		},
		edges: [],
	});

	// --- EdfiEntity nodes (-> DmeClass) ---
	entitySet.forEach((entityDescription, entityName) => {
		nodes.push({
			id: entityNativeIdByName[entityName],
			label: 'EdfiEntity',
			superLabel: 'EdfiModel',
			properties: {
				name: entityName,
				description: entityDescription || `Ed-Fi entity: ${entityName}`,
				tableName: entityName,
			},
			edges: [],
		});
	});

	// --- EdfiField nodes (-> DmeProperty); CONSTRAINED_BY -> descriptor when type is Descriptor ---
	let fieldsWithCedsId = 0;
	let descriptorFields = 0;

	fieldMap.forEach((field) => {
		const fieldNativeId = `edfifield-${field.entity}.${field.element}`;
		const entityNativeId = entityNativeIdByName[field.entity];
		const fieldEdges = [];

		// CONSTRAINED_BY edge (field → descriptor) when type is Descriptor. The element name is
		// usually the descriptor name; otherwise try appending 'Descriptor'. (Harvested matching.)
		if (field.elementType === 'Descriptor') {
			const directName = field.element;
			const altName = `${field.element}Descriptor`;
			let targetDescriptorName = null;
			if (descriptorNativeIdByName[directName]) {
				targetDescriptorName = directName;
			} else if (descriptorNativeIdByName[altName]) {
				targetDescriptorName = altName;
			}
			if (targetDescriptorName) {
				fieldEdges.push({
					type: 'CONSTRAINED_BY',
					targetId: descriptorNativeIdByName[targetDescriptorName],
					targetLabel: 'EdfiDescriptor',
				});
				descriptorFields++;
			}
		}

		const uniqueCedsIds = [...new Set(field.cedsGlobalIds)];
		if (uniqueCedsIds.length > 0) {
			fieldsWithCedsId++;
		}

		nodes.push({
			id: fieldNativeId,
			label: 'EdfiField',
			superLabel: 'EdfiModel',
			properties: {
				name: field.element,
				description:
					field.description ||
					`Ed-Fi field: ${field.entity}.${field.element}`,
				entityName: field.entity,
				elementType: field.elementType,
				required: field.required,
				entityPath: field.entityPath,
				// BRIDGE data (later phase): the target CEDS element global-id(s). Carried through;
				// NOT a structural EdFi property and NOT emitted as an edge here.
				cedsGlobalIds: uniqueCedsIds,
			},
			edges: fieldEdges,
			_parentEdge: {
				type: 'HAS_FIELD',
				fromId: entityNativeId,
				fromLabel: 'EdfiEntity',
			},
		});
	});

	// --- EdfiDescriptor nodes (-> DmeOptionSet) ---
	descriptorMap.forEach((descriptor, descriptorName) => {
		nodes.push({
			id: descriptorNativeIdByName[descriptorName],
			label: 'EdfiDescriptor',
			superLabel: 'EdfiModel',
			properties: {
				name: descriptorName,
				description:
					descriptor.elementDescription ||
					`Ed-Fi descriptor: ${descriptorName}`,
				namespace: descriptor.namespace,
				version: descriptor.version,
				valueCount: descriptor.values.length,
				// BRIDGE data (later phase): the descriptor-level target CEDS element global-id.
				cedsGlobalId: descriptor.cedsGlobalId || '',
			},
			edges: [],
		});
	});

	// --- EdfiDescriptorValue nodes (-> DmeOptionValue) ---
	let descriptorValuesEmitted = 0;
	descriptorMap.forEach((descriptor, descriptorName) => {
		const descriptorNativeId = descriptorNativeIdByName[descriptorName];

		descriptor.values.forEach((value) => {
			const valueNativeId = `edfidescval-${descriptorName}.${value.codeValue}`;

			nodes.push({
				id: valueNativeId,
				label: 'EdfiDescriptorValue',
				superLabel: 'EdfiModel',
				properties: {
					name: value.codeValue,
					description:
						value.description ||
						value.shortDescription ||
						`Ed-Fi descriptor value: ${descriptorName}.${value.codeValue}`,
					shortDescription: value.shortDescription,
					descriptorName,
					// BRIDGE data (later phase): the target CEDS option code.
					cedsOptionCode: value.cedsOptionCode || '',
				},
				edges: [],
				_parentEdge: {
					type: 'HAS_VALUE',
					fromId: descriptorNativeId,
					fromLabel: 'EdfiDescriptor',
				},
			});
			descriptorValuesEmitted++;
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

	console.error(`[edfi/parser] Total native nodes: ${nodes.length}`);
	console.error(`[edfi/parser] Declared native edges: ${totalEdges}`);
	console.error(`[edfi/parser] Parent edges (HAS_FIELD + HAS_VALUE): ${parentEdgeCount}`);
	console.error(`[edfi/parser] Fields with CEDS global-ids: ${fieldsWithCedsId}`);
	console.error(`[edfi/parser] Fields constrained by descriptors: ${descriptorFields}`);
	console.error(`[edfi/parser] Descriptor values: ${descriptorValuesEmitted}`);

	callback('', {
		nodes,
		metadata: {
			version: '1.0',
			sourceFormat: 'csv',
			sourceFiles: ['EdFiEntityElementsToCEDS.csv', 'EdFiEntityDescriptorsToCEDS.csv'],
			entityCount: entitySet.size,
			fieldCount: totalFieldCount,
			descriptorCount: totalDescriptorCount,
			descriptorValueCount: totalDescriptorValueCount,
			fieldsWithCedsId,
			descriptorFields,
			totalNodes: nodes.length,
		},
	});
};
