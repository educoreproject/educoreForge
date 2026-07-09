'use strict';

// parser.js — SEDM CEDS-Map CSV + domain-structures JSON → native SEDM graphForge node format.
//
// HARVESTED from educoreForgeOLD/system/code/cli/lib.d/forge-sedm/lib/parser.js: the SOURCE-NAVIGATION
// logic is reused as-is — the multi-line quote-aware CSV reader (a SEDM cell can span newlines), the
// SEDM-flag row filter (only rows with a non-empty 'SEDM' column are in-scope), the (elementName,
// entity, category, globalId) element dedup (the CSV repeats elements once per state/provisioning
// context), and the JSON domain-structure walk (ontology classes, compliance categories, IDEA
// indicators, event milestones, IEP components, ETL templates, use cases, declared option sets).
//
// What is REUSED is HOW the source is read; the emitted node shape is the SAME native shape
// forge-edfi's parser produces (id/label/superLabel/properties/edges + optional _parentEdge), so the
// forge-sedm MAIN module can map each native node onto the universal six-role Dme* contract exactly
// as forge-edfi does. The OLD output schema (private Sedm* labels with hand-rolled native edges and
// an older node contract) is NOT reproduced.
//
// ROLE MAPPING (native label -> universal Dme* role, applied by the MAIN module via roleSpec):
//   SedmRoot               -> DmeStandardRoot
//   SedmOntologyClass      -> DmeClass     (SEDM's fundamental organizing classes + subtypes)
//   SedmComplianceCategory -> DmeClass     (the 16 IDEA compliance categories — organizing classes)
//   SedmElement            -> DmeProperty  (the annotated CEDS data elements/fields)
//   SedmOptionSet          -> DmeOptionSet (inline element option sets + declared option sets)
//   SedmOptionValue        -> DmeOptionValue
//   SedmIndicator / SedmEventMilestone / SedmIepComponent / SedmEtlTemplate / SedmUseCase
//                          -> DmeSupport   (SEDM-specific governance constructs, not class/prop/codeset)
//
// EDGE CONVENTION (mandatory, mirrors forge-edfi):
//   * an element's inline Option Set => HAS_OPTION_SET FROM the element (DmeProperty) TO its
//     DmeOptionSet (native CONSTRAINED_BY edge on the element, translated by the main module). The
//     property OWNS its option set.
//   * an option set referenced by ZERO elements (a declared-but-unused JSON set) is anchored from the
//     root via HAS_OPTION_SET (orphan anchor pass in the main module).
//   * class->member / support->element / class->support references stay REFERENCES.
//   * root ownership edges (HAS_CLASS for classes, HAS_SUPPORT for support nodes) are SYNTHESIZED by
//     the main module, not declared here (mirrors forge-edfi's HAS_CLASS synthesis).
//
// The parser NEVER touches Neo4j. The CEDS target Global IDs are carried through as element
// properties (cedsGlobalId) for a LATER bridge phase — they produce NO cross-standard edges.

const fs = require('fs');
const path = require('path');

// ============================================================
// CSV PARSING  (harvested verbatim from the old forge-sedm parser — multi-line quote-aware)
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

	// Handle multi-line quoted fields: join continuation lines before splitting into rows.
	const logicalLines = [];
	let currentLine = '';
	let quoteCount = 0;

	for (const rawLine of content.split('\n')) {
		if (currentLine === '') {
			currentLine = rawLine;
		} else {
			currentLine += '\n' + rawLine;
		}

		for (let i = 0; i < rawLine.length; i++) {
			if (rawLine[i] === '"') {
				if (i + 1 < rawLine.length && rawLine[i + 1] === '"') {
					i++; // skip escaped quote
				} else {
					quoteCount++;
				}
			}
		}

		// Even number of quotes means all fields are closed — a complete logical row.
		if (quoteCount % 2 === 0) {
			if (currentLine.trim()) {
				logicalLines.push(currentLine);
			}
			currentLine = '';
			quoteCount = 0;
		}
	}
	if (currentLine.trim()) {
		logicalLines.push(currentLine);
	}

	if (logicalLines.length < 2) {
		return { headers: [], rows: [] };
	}

	const headers = parseCsvLine(logicalLines[0]);
	const rows = [];

	for (let i = 1; i < logicalLines.length; i++) {
		const values = parseCsvLine(logicalLines[i]);
		const row = {};
		headers.forEach((header, idx) => {
			row[header] = (values[idx] || '').trim();
		});
		rows.push(row);
	}

	return { headers, rows };
};

// ============================================================
// INLINE OPTION SET PARSING  (NEW: the CSV 'Option Set' column carries inline code-value lists)
//   A SEDM-element 'Option Set' cell is a newline-separated list, each line either 'CODE - Name'
//   (e.g. 'AUT - Autism') or a bare token. 'None'/'' means no option set. We turn each present cell
//   into a per-element DmeOptionSet so the mandatory HAS_OPTION_SET (DmeProperty -> DmeOptionSet) edge
//   carries REAL data — this is the standard's actual codeset constraint, not invented structure.
//   Values are deduped by code WITHIN a set (first occurrence wins), mirroring the CSV dedup gotcha.
// ============================================================

const parseInlineOptionSet = (text) => {
	if (text == null) {
		return null;
	}
	const trimmed = `${text}`.trim();
	if (trimmed === '' || trimmed.toLowerCase() === 'none') {
		return null;
	}
	const lines = trimmed
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const valueByCode = new Map();
	for (const line of lines) {
		const match = line.match(/^(.+?)\s+-\s+(.+)$/);
		let code;
		let name;
		if (match) {
			code = match[1].trim();
			name = match[2].trim();
		} else {
			code = line;
			name = line;
		}
		if (code === '') {
			continue;
		}
		if (!valueByCode.has(code)) {
			valueByCode.set(code, { code, name });
		}
	}
	const values = [...valueByCode.values()];
	return values.length ? values : null;
};

// ============================================================
// MAIN PARSER — graphForge parser contract (callback(err, { nodes, metadata }))
// ============================================================

module.exports = (sourcePath, options, callback) => {
	if (!fs.existsSync(sourcePath)) {
		callback(`Source path not found: ${sourcePath}`);
		return;
	}

	const stat = fs.statSync(sourcePath);
	if (!stat.isDirectory()) {
		callback(
			`forge-sedm parser: --source must be the version directory containing the CSV + JSON: ${sourcePath}`,
		);
		return;
	}

	const structuresPath = path.join(sourcePath, 'sedm-domain-structures.json');
	const csvPath = path.join(sourcePath, 'SEDM Logical Model and Maps - 6. CEDS Map.csv');

	if (!fs.existsSync(structuresPath)) {
		callback(`Domain structures JSON not found: ${structuresPath}`);
		return;
	}
	if (!fs.existsSync(csvPath)) {
		callback(`CEDS Map CSV not found: ${csvPath}`);
		return;
	}

	console.error(`[sedm/parser] Parsing source files in: ${sourcePath}`);

	const structures = JSON.parse(fs.readFileSync(structuresPath, 'utf8'));
	const { rows: allCsvRows } = parseCsvFile(csvPath);
	const sedmRows = allCsvRows.filter((r) => r['SEDM'] && r['SEDM'].trim());

	console.error(
		`[sedm/parser] CSV: ${allCsvRows.length} total rows, ${sedmRows.length} SEDM-flagged`,
	);

	const nodes = [];

	// ----- helper id makers (native ids; the main module re-derives clean stableIds) -----
	const slug = (value) =>
		`${value == null ? '' : value}`.toLowerCase().replace(/[^a-z0-9]/g, '');

	// id lookup maps
	const ontClassNativeIdByName = {};
	const complianceNativeIdByNumber = {};

	// ============================================================
	// SedmRoot (no native ownership edges — main module synthesizes HAS_CLASS / HAS_SUPPORT)
	// ============================================================
	nodes.push({
		id: 'sedm-root',
		label: 'SedmRoot',
		superLabel: 'SedmModel',
		properties: {
			name: 'SEDM',
			description:
				'Special Education Data Model — IDEA compliance domain model layered over CEDS.',
		},
		edges: [],
	});

	// ============================================================
	// SedmOntologyClass (6 fundamental classes + their subtypes) -> DmeClass
	// ============================================================
	for (const cls of structures.ontologicalClasses) {
		const classNativeId = `sedm-ontclass-${slug(cls.name)}`;
		ontClassNativeIdByName[cls.name] = classNativeId;

		nodes.push({
			id: classNativeId,
			label: 'SedmOntologyClass',
			superLabel: 'SedmModel',
			properties: {
				name: cls.name,
				naturalKey: cls.name,
				description: cls.definition || `SEDM ontology class: ${cls.name}`,
				subtypeCount: (cls.subtypes || []).length,
			},
			edges: [],
		});

		for (const subtype of cls.subtypes || []) {
			nodes.push({
				id: `sedm-ontsubtype-${slug(cls.name)}-${slug(subtype)}`,
				label: 'SedmOntologyClass',
				superLabel: 'SedmModel',
				properties: {
					name: subtype,
					naturalKey: `${cls.name}.${subtype}`,
					description: `${cls.name} subtype: ${subtype}`,
					parentClass: cls.name,
				},
				edges: [],
				// a subtype REFERENCES its parent ontology class (class -> class).
				_referenceEdges: [
					{ type: 'REFERENCES', targetId: classNativeId, targetLabel: 'SedmOntologyClass' },
				],
			});
		}
	}

	// ============================================================
	// SedmComplianceCategory (16 IDEA compliance categories) -> DmeClass
	// ============================================================
	for (const cat of structures.complianceCategories) {
		const catNativeId = `sedm-compliance-${cat.number}`;
		complianceNativeIdByNumber[cat.number] = catNativeId;

		nodes.push({
			id: catNativeId,
			label: 'SedmComplianceCategory',
			superLabel: 'SedmModel',
			properties: {
				name: cat.name,
				naturalKey: `compliance.${cat.number}`,
				number: cat.number,
				description: cat.description || `SEDM compliance category ${cat.number}: ${cat.name}`,
				ideaStatuteRef: cat.ideaStatuteRef || '',
				ideaIndicatorNumbers: (cat.ideaIndicators || []).join(','),
			},
			edges: [],
		});
	}

	// ============================================================
	// SedmIndicator (18) -> DmeSupport ; REFERENCES its compliance category (support -> class)
	// ============================================================
	for (const ind of structures.ideaIndicators) {
		const refEdges = [];
		const catNativeId = complianceNativeIdByNumber[ind.complianceCategory];
		if (catNativeId) {
			refEdges.push({
				type: 'REFERENCES',
				targetId: catNativeId,
				targetLabel: 'SedmComplianceCategory',
			});
		}
		nodes.push({
			id: `sedm-indicator-${ind.number}`,
			label: 'SedmIndicator',
			superLabel: 'SedmModel',
			properties: {
				name: `Indicator ${ind.number}: ${ind.name}`,
				naturalKey: `indicator.${ind.number}`,
				number: ind.number,
				description: ind.description || '',
				dataSource: ind.dataSource || '',
				complianceCategoryNumber: ind.complianceCategory,
			},
			edges: [],
			_referenceEdges: refEdges,
		});
	}

	// ============================================================
	// SedmEventMilestone (23) -> DmeSupport ; REFERENCES its compliance category
	// ============================================================
	for (const ms of structures.standardEventMilestones.milestoneTypes) {
		const refEdges = [];
		const catNativeId = complianceNativeIdByNumber[ms.complianceCategory];
		if (catNativeId) {
			refEdges.push({
				type: 'REFERENCES',
				targetId: catNativeId,
				targetLabel: 'SedmComplianceCategory',
			});
		}
		nodes.push({
			id: `sedm-milestone-${ms.number}`,
			label: 'SedmEventMilestone',
			superLabel: 'SedmModel',
			properties: {
				name: ms.name,
				naturalKey: `milestone.${ms.number}`,
				number: ms.number,
				complianceCategoryNumber: ms.complianceCategory,
				ideaRequired: !!ms.ideaRequired,
				description: ms.name,
			},
			edges: [],
			_referenceEdges: refEdges,
		});
	}

	// ============================================================
	// SedmIepComponent (10 + subcomponents) -> DmeSupport
	// ============================================================
	for (const comp of structures.iepComponents) {
		const compNativeId = `sedm-iepcomp-${comp.number}`;
		nodes.push({
			id: compNativeId,
			label: 'SedmIepComponent',
			superLabel: 'SedmModel',
			properties: {
				name: comp.name,
				naturalKey: `iepComponent.${comp.number}`,
				number: comp.number,
				abbreviation: comp.abbreviation || '',
				description: comp.description || comp.name,
				dataNeeded: (comp.dataNeeded || []).join('; '),
			},
			edges: [],
		});

		for (const sub of comp.subcomponents || []) {
			nodes.push({
				id: `sedm-iepsubcomp-${comp.number}-${slug(sub.name)}`,
				label: 'SedmIepComponent',
				superLabel: 'SedmModel',
				properties: {
					name: sub.name,
					naturalKey: `iepComponent.${comp.number}.${slug(sub.name)}`,
					description: sub.note || sub.name,
					parentComponent: comp.name,
				},
				edges: [],
				_referenceEdges: [
					{ type: 'REFERENCES', targetId: compNativeId, targetLabel: 'SedmIepComponent' },
				],
			});
		}
	}

	// ============================================================
	// SedmEtlTemplate (14) -> DmeSupport
	// ============================================================
	const etlNativeIdByColumn = {};
	for (const etl of structures.generateEtlTemplates) {
		const etlNativeId = `sedm-etl-${slug(etl.name)}`;
		etlNativeIdByColumn[etl.csvColumn] = etlNativeId;
		nodes.push({
			id: etlNativeId,
			label: 'SedmEtlTemplate',
			superLabel: 'SedmModel',
			properties: {
				name: etl.name,
				naturalKey: `etl.${slug(etl.name)}`,
				csvColumn: etl.csvColumn || '',
				description: `SEDM ETL template: ${etl.name}`,
			},
			edges: [],
		});
	}

	// ============================================================
	// SedmUseCase (1) -> DmeSupport
	// ============================================================
	for (const uc of structures.useCases) {
		nodes.push({
			id: `sedm-usecase-${slug(uc.edFactsCode)}`,
			label: 'SedmUseCase',
			superLabel: 'SedmModel',
			properties: {
				name: `${uc.edFactsCode}: ${uc.name}`,
				naturalKey: `useCase.${slug(uc.edFactsCode)}`,
				edFactsCode: uc.edFactsCode || '',
				dataGroup: uc.dataGroup || '',
				description: uc.description || uc.name,
			},
			edges: [],
		});
	}

	// ============================================================
	// SedmElement (CEDS-Map rows) -> DmeProperty
	//   Each element with an inline Option Set gets a per-element SedmOptionSet (-> DmeOptionSet) + its
	//   SedmOptionValues, wired via a native CONSTRAINED_BY edge (field -> option set), translated by
	//   the main module to HAS_OPTION_SET (the property owns its option set). Dedup mirrors the old
	//   parser: one element per (elementName, entity, category, globalId).
	// ============================================================
	const ETL_COLUMNS = (structures.generateEtlTemplates || [])
		.map((etl) => etl.csvColumn)
		.filter(Boolean);

	const seenElements = new Set();
	let elementsWithCedsId = 0;
	let elementsWithOptionSet = 0;
	let optionValuesEmitted = 0;
	let duplicatesSkipped = 0;
	let elementEtlRefs = 0;

	for (const row of sedmRows) {
		const elementName = (row['Element Name'] || '').trim();
		if (!elementName) {
			continue;
		}
		const globalId = (row['Global ID (CEDS)'] || '').trim();
		const entity = (row['Entity'] || '').trim();
		const category = (row['Category'] || '').trim();
		const domain = (row['Domain'] || '').trim();
		const sedmFlag = (row['SEDM'] || '').trim();
		const sedmCompliance = (row['SEDM Compliance'] || '').trim();
		const sedmIep = (row['SEDM IEP'] || '').trim();
		const ssem = (row['SSEM'] || '').trim();
		const edfiMap = (row['Ed-Fi Map'] || '').trim();
		const definition = (row['Definition'] || '').trim();
		const optionSetText = (row['Option Set'] || '').trim();
		const format = (row['Format'] || '').trim();

		const dedupeKey = `${elementName}|${entity}|${category}|${globalId}`;
		if (seenElements.has(dedupeKey)) {
			duplicatesSkipped++;
			continue;
		}
		seenElements.add(dedupeKey);

		// element natural key: globalId.entity.category.elementName. ALL FOUR parts are required for
		// uniqueness — the dedup above keys on (name, entity, category, globalId), and many elements
		// share an empty/'na'/'Proposed' globalId with the same entity+category, differing ONLY by name
		// (e.g. several School-Year fields). Dropping the name collides their stableIds (a merge
		// collision the replay engine would silently MERGE), so the name is part of the key. Deterministic.
		const elementKey = `${globalId || 'na'}.${slug(entity)}.${slug(category)}.${slug(elementName)}`;
		const elementNativeId = `sedm-element-${slug(globalId)}-${slug(entity)}-${slug(category)}-${slug(elementName)}`;

		const scope = sedmFlag === 'SC' ? 'stateSpecific' : sedmFlag === '?' ? 'uncertain' : 'core';

		if (globalId && !['000000', 'Proposed'].includes(globalId)) {
			elementsWithCedsId++;
		}

		const elementEdges = [];

		// inline option set -> per-element SedmOptionSet (DmeOptionSet) + values, CONSTRAINED_BY edge.
		const inlineValues = parseInlineOptionSet(optionSetText);
		if (inlineValues) {
			elementsWithOptionSet++;
			const optionSetKey = elementKey; // per-element set; the property owns it (same 4-part key)
			const optionSetNativeId = `sedm-optionset-${slug(globalId)}-${slug(entity)}-${slug(category)}-${slug(elementName)}`;

			nodes.push({
				id: optionSetNativeId,
				label: 'SedmOptionSet',
				superLabel: 'SedmModel',
				properties: {
					name: `${elementName} option set`,
					naturalKey: optionSetKey,
					description: `SEDM option set for element ${elementName}`,
					owningElementName: elementName,
					valueCount: inlineValues.length,
				},
				edges: [],
			});

			inlineValues.forEach((val) => {
				const valueNativeId = `sedm-optval-${slug(globalId)}-${slug(entity)}-${slug(category)}-${slug(elementName)}-${slug(val.code)}`;
				nodes.push({
					id: valueNativeId,
					label: 'SedmOptionValue',
					superLabel: 'SedmModel',
					properties: {
						name: val.name,
						naturalKey: `${optionSetKey}.${val.code}`,
						code: val.code,
						description: val.name,
						optionSetName: `${elementName} option set`,
					},
					edges: [],
					_parentEdge: {
						type: 'HAS_VALUE',
						fromId: optionSetNativeId,
						fromLabel: 'SedmOptionSet',
					},
				});
				optionValuesEmitted++;
			});

			// the element (DmeProperty) is CONSTRAINED_BY its option set -> HAS_OPTION_SET in main module.
			elementEdges.push({
				type: 'CONSTRAINED_BY',
				targetId: optionSetNativeId,
				targetLabel: 'SedmOptionSet',
			});
		}

		// element -> ETL template references (REFERENCES; an "x"/"y"/"yes" in an ETL column).
		for (const etlCol of ETL_COLUMNS) {
			const etlVal = (row[etlCol] || '').trim().toLowerCase();
			if (etlVal === 'x' || etlVal === 'y' || etlVal === 'yes') {
				const etlNativeId = etlNativeIdByColumn[etlCol];
				if (etlNativeId) {
					elementEdges.push({
						type: 'REFERENCES',
						targetId: etlNativeId,
						targetLabel: 'SedmEtlTemplate',
					});
					elementEtlRefs++;
				}
			}
		}

		nodes.push({
			id: elementNativeId,
			label: 'SedmElement',
			superLabel: 'SedmModel',
			properties: {
				name: elementName,
				naturalKey: elementKey,
				description: definition || `CEDS element: ${elementName}`,
				domain,
				entity,
				category,
				sedmFlag,
				scope,
				sedmCompliance,
				sedmIep,
				ssem,
				format,
				// BRIDGE data (later phase): the target CEDS element Global ID + an Ed-Fi map hint.
				cedsGlobalId: globalId,
				edfiMap,
			},
			edges: elementEdges,
		});
	}

	// ============================================================
	// Declared JSON option sets (SedmOptionSet) -> DmeOptionSet. These are SEDM-declared codesets that
	//   may not be referenced by any in-scope element; if so they become orphans, anchored from the
	//   root via HAS_OPTION_SET by the main module's orphan pass. Emitted with a distinct 'declared.'
	//   key so they never collide with the per-element option-set keys above.
	// ============================================================
	let declaredOptionSets = 0;
	for (const [setKey, optionSet] of Object.entries(structures.optionSets || {})) {
		const optionSetNativeId = `sedm-optionset-declared-${slug(setKey)}`;
		nodes.push({
			id: optionSetNativeId,
			label: 'SedmOptionSet',
			superLabel: 'SedmModel',
			properties: {
				name: optionSet.cedsElementName || setKey,
				naturalKey: `declared.${setKey}`,
				description: `SEDM declared option set: ${setKey}`,
				valueCount: (optionSet.values || []).length,
			},
			edges: [],
		});
		declaredOptionSets++;

		(optionSet.values || []).forEach((val) => {
			const codeOrName = val.code || val.name;
			nodes.push({
				id: `sedm-optval-declared-${slug(setKey)}-${slug(codeOrName)}`,
				label: 'SedmOptionValue',
				superLabel: 'SedmModel',
				properties: {
					name: val.name,
					naturalKey: `declared.${setKey}.${slug(codeOrName)}`,
					code: val.code || '',
					description: val.description || val.name,
					optionSetName: optionSet.cedsElementName || setKey,
				},
				edges: [],
				_parentEdge: {
					type: 'HAS_VALUE',
					fromId: optionSetNativeId,
					fromLabel: 'SedmOptionSet',
				},
			});
			optionValuesEmitted++;
		});
	}

	// ============================================================
	// STATS AND CALLBACK
	// ============================================================
	const countByLabel = {};
	nodes.forEach((n) => {
		countByLabel[n.label] = (countByLabel[n.label] || 0) + 1;
	});

	console.error(`[sedm/parser] === SEDM Parse Results ===`);
	console.error(`[sedm/parser] ${JSON.stringify(countByLabel)}`);
	console.error(`[sedm/parser] Total native nodes: ${nodes.length}`);
	console.error(`[sedm/parser] Elements with CEDS Global ID: ${elementsWithCedsId}`);
	console.error(`[sedm/parser] Elements with inline Option Set: ${elementsWithOptionSet}`);
	console.error(`[sedm/parser] Declared JSON option sets: ${declaredOptionSets}`);
	console.error(`[sedm/parser] Option values emitted: ${optionValuesEmitted}`);
	console.error(`[sedm/parser] Element->ETL references: ${elementEtlRefs}`);
	console.error(`[sedm/parser] Duplicate rows skipped: ${duplicatesSkipped}`);

	callback('', {
		nodes,
		metadata: {
			version: '1.0',
			sourceFormat: 'csv+json',
			sourceFiles: [
				'SEDM Logical Model and Maps - 6. CEDS Map.csv',
				'sedm-domain-structures.json',
			],
			countByLabel,
			elementsWithCedsId,
			elementsWithOptionSet,
			declaredOptionSets,
			optionValuesEmitted,
			totalNodes: nodes.length,
		},
	});
};
