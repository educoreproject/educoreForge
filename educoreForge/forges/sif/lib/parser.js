'use strict';

// parser.js — SIF Implementation Specification TSV → standard graphForge node format
// Ported from educore sif/tsvParser.js — adapted to graphForge parser contract.
// The parser NEVER touches Neo4j. It only reads the source files and returns standard nodes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TABLE_HEADER_PATTERN = /^(.+):\s*Table\s+\d+$/;

// ============================================================
// TSV PARSING
// ============================================================

const parseTsvFile = (tsvPath) => {
	const content = fs.readFileSync(tsvPath, 'utf8');
	const lines = content.split('\n');

	const sifObjectList = [];
	let currentObject = null;
	let expectColumnHeaders = false;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line) { continue; }

		const tableMatch = line.match(TABLE_HEADER_PATTERN);
		if (tableMatch) {
			if (currentObject) {
				sifObjectList.push(currentObject);
			}
			const tableName = tableMatch[1].trim();
			const singularName = tableName.replace(/s$/, '');
			currentObject = {
				tableName,
				name: singularName,
				fields: [],
				refIdFields: []
			};
			expectColumnHeaders = true;
			continue;
		}

		if (expectColumnHeaders) {
			expectColumnHeaders = false;
			continue;
		}

		if (!currentObject) { continue; }

		const columns = line.split('\t');
		const fieldName = (columns[0] || '').trim();
		if (!fieldName) { continue; }

		const xpath = (columns[5] || '').trim();
		const xpathParts = xpath.split('/');

		const fieldDef = {
			name: fieldName,
			mandatory: (columns[1] || '').trim() === '*',
			characteristics: (columns[2] || '').trim(),
			type: (columns[3] || '').trim(),
			description: (columns[4] || '').trim(),
			xpath,
			cedsId: (columns[6] || '').trim(),
			format: (columns[7] || '').trim(),
			depth: Math.max(0, xpathParts.length - 3),
			isAttribute: fieldName.startsWith('@'),
			pathSegments: xpathParts.length > 3 ? xpathParts.slice(3, -1) : []
		};

		currentObject.fields.push(fieldDef);

		if (fieldName !== '@RefId' && fieldName !== 'Name' && fieldName.endsWith('RefId')) {
			currentObject.refIdFields.push(fieldDef);
		}
	}

	if (currentObject) {
		sifObjectList.push(currentObject);
	}

	return sifObjectList;
};

// ============================================================
// REFID RESOLUTION
// ============================================================

const loadResolutionMap = (resolutionMapPath) => {
	const manualResolutions = {};

	if (!fs.existsSync(resolutionMapPath)) {
		console.error(`Warning: Resolution map not found at ${resolutionMapPath}`);
		return manualResolutions;
	}

	const content = fs.readFileSync(resolutionMapPath, 'utf8');
	const lines = content.split('\n');

	for (let i = 1; i < lines.length; i++) {
		const cols = lines[i].split('\t');
		const refIdProperty = (cols[0] || '').trim();
		const resolvedTable = (cols[2] || '').trim();
		if (refIdProperty && resolvedTable) {
			manualResolutions[refIdProperty] = resolvedTable;
		}
	}

	return manualResolutions;
};

const resolveRefIdTargets = (sifObjectList, manualResolutions) => {
	const tableNameSet = new Set(sifObjectList.map(obj => obj.tableName));
	const tableNameLowerMap = {};
	for (const obj of sifObjectList) {
		tableNameLowerMap[obj.tableName.toLowerCase()] = obj.tableName;
	}

	const allEdges = [];

	for (const sifObject of sifObjectList) {
		for (const refField of sifObject.refIdFields) {
			const cleanName = refField.name.replace(/^@/, '');

			if (manualResolutions[cleanName]) {
				const resolved = manualResolutions[cleanName];
				if (resolved === 'UNRESOLVABLE_GENERIC_REF') { continue; }
				allEdges.push({
					sourceTable: sifObject.tableName,
					targetTable: resolved,
					via: cleanName,
					mandatory: refField.mandatory
				});
				continue;
			}

			const baseName = cleanName.replace(/RefId$/, '');
			const naiveTarget = baseName + 's';

			if (tableNameSet.has(naiveTarget)) {
				allEdges.push({ sourceTable: sifObject.tableName, targetTable: naiveTarget, via: cleanName, mandatory: refField.mandatory });
				continue;
			}

			if (tableNameLowerMap[naiveTarget.toLowerCase()]) {
				allEdges.push({ sourceTable: sifObject.tableName, targetTable: tableNameLowerMap[naiveTarget.toLowerCase()], via: cleanName, mandatory: refField.mandatory });
				continue;
			}

			let found = false;
			for (const suffix of ['Infos', 'Personals', 'Items']) {
				const candidate = baseName + suffix;
				if (tableNameLowerMap[candidate.toLowerCase()]) {
					allEdges.push({ sourceTable: sifObject.tableName, targetTable: tableNameLowerMap[candidate.toLowerCase()], via: cleanName, mandatory: refField.mandatory });
					found = true;
					break;
				}
			}
			if (found) { continue; }

			// Unresolved — skip silently
		}
	}

	return allEdges;
};

const deduplicateEdges = (edgeList) => {
	const seen = new Set();
	const uniqueEdges = [];

	for (const edge of edgeList) {
		const edgeKey = `${edge.sourceTable}|${edge.targetTable}|${edge.via}`;
		if (!seen.has(edgeKey)) {
			seen.add(edgeKey);
			uniqueEdges.push(edge);
		}
	}

	return uniqueEdges;
};

// ============================================================
// IN-MEMORY DATA STRUCTURE BUILDERS
// ============================================================

const buildTypeRegistry = (sifObjectList) => {
	const typeMap = new Map();
	for (const obj of sifObjectList) {
		for (const field of obj.fields) {
			const typeName = field.type;
			if (!typeName || typeMap.has(typeName)) { continue; }
			const isSimple = typeName.endsWith('Type');
			typeMap.set(typeName, {
				name: typeName,
				category: isSimple ? 'simple' : 'primitive',
				label: isSimple ? 'SifSimpleType' : 'SifPrimitiveType'
			});
		}
	}
	return typeMap;
};

const buildCodesetRegistry = (sifObjectList) => {
	const codesetMap = new Map();
	const fieldCodesetMap = new Map();

	for (const obj of sifObjectList) {
		for (const field of obj.fields) {
			let formatStr = field.format;
			if (!formatStr) { continue; }
			formatStr = formatStr.replace(/^"(.*)"$/, '$1');
			if (!formatStr.trim()) { continue; }
			const values = formatStr.split(', ').map(v => v.trim()).filter(v => v);
			if (values.length === 0) { continue; }
			const sorted = [...values].sort();
			const fingerprintRaw = sorted.join('|');
			const fingerprint = fingerprintRaw.length > 200
				? crypto.createHash('sha256').update(fingerprintRaw).digest('hex')
				: fingerprintRaw;
			if (!codesetMap.has(fingerprint)) {
				codesetMap.set(fingerprint, { values: sorted, valueCount: sorted.length, fingerprint });
			}
			fieldCodesetMap.set(field.xpath, fingerprint);
		}
	}

	return { codesetMap, fieldCodesetMap };
};

const buildComplexTypeRegistry = (sifObjectList) => {
	const complexTypeMap = new Map();
	const parentChildPairs = new Set();
	const fieldComplexTypeMap = new Map();
	const objectComplexTypesMap = new Map();

	for (const obj of sifObjectList) {
		if (!objectComplexTypesMap.has(obj.tableName)) {
			objectComplexTypesMap.set(obj.tableName, new Set());
		}
		for (const field of obj.fields) {
			const segments = field.pathSegments;
			if (!segments || segments.length === 0) { continue; }
			for (let i = 0; i < segments.length; i++) {
				const segName = segments[i];
				if (!complexTypeMap.has(segName)) {
					complexTypeMap.set(segName, { name: segName, objects: new Set(), fieldCount: 0 });
				}
				const ct = complexTypeMap.get(segName);
				ct.objects.add(obj.tableName);
				objectComplexTypesMap.get(obj.tableName).add(segName);
				if (i > 0) { parentChildPairs.add(`${segments[i - 1]}|${segName}`); }
			}
			const innermostSegment = segments[segments.length - 1];
			fieldComplexTypeMap.set(field.xpath, innermostSegment);
			complexTypeMap.get(innermostSegment).fieldCount++;
		}
	}

	for (const [, ct] of complexTypeMap) { ct.objectCount = ct.objects.size; }
	return { complexTypeMap, parentChildPairs, fieldComplexTypeMap, objectComplexTypesMap };
};

const buildXmlElementTree = (sifObjectList) => {
	const elementMap = new Map();
	const childElementPairs = new Set();
	const objectRootElements = new Map();
	const leafFieldLinks = [];

	for (const obj of sifObjectList) {
		if (!objectRootElements.has(obj.tableName)) {
			objectRootElements.set(obj.tableName, new Set());
		}
		for (const field of obj.fields) {
			const xpathParts = field.xpath.split('/');
			if (xpathParts.length <= 3) { continue; }
			const elementParts = xpathParts.slice(3);
			for (let i = 0; i < elementParts.length; i++) {
				const relativePath = elementParts.slice(0, i + 1).join('/');
				const elementName = elementParts[i];
				const depth = i + 1;
				if (!elementMap.has(relativePath)) {
					elementMap.set(relativePath, { name: elementName, path: relativePath, depth, objectNames: new Set(), children: new Set(), isLeaf: true });
				}
				const el = elementMap.get(relativePath);
				el.objectNames.add(obj.tableName);
				if (i > 0) {
					const parentPath = elementParts.slice(0, i).join('/');
					childElementPairs.add(`${parentPath}|${relativePath}`);
					const parentEl = elementMap.get(parentPath);
					if (parentEl) { parentEl.isLeaf = false; parentEl.children.add(relativePath); }
				}
				if (i === 0) { objectRootElements.get(obj.tableName).add(relativePath); }
			}
			const leafPath = elementParts.join('/');
			leafFieldLinks.push({ elementPath: leafPath, fieldXpath: field.xpath });
		}
	}

	for (const [, el] of elementMap) { el.isShared = el.objectNames.size > 1; }
	return { elementMap, childElementPairs, objectRootElements, leafFieldLinks };
};

// ============================================================
// MAIN PARSER — graphForge parser contract
// ============================================================

module.exports = (sourcePath, options, callback) => {
	if (!fs.existsSync(sourcePath)) {
		callback(`TSV file not found: ${sourcePath}`);
		return;
	}

	// v1.6.0: parser may receive the version DIRECTORY instead of a file.
	// Main file is the ImplementationSpecification*.tsv; the secondary
	// refIdResolutionMap.tsv lives alongside it inside that same dir.
	let tsvPath = sourcePath;
	let resolutionMapInDir = null;
	if (fs.statSync(sourcePath).isDirectory()) {
		// L15: sorted for cross-machine determinism; EXACTLY ONE candidate required — a stray
		// second source file would silently forge a different standard on another machine.
		const f = fs.readdirSync(sourcePath).filter((n) => n.endsWith('.tsv') && n !== 'refIdResolutionMap.tsv').sort();
		if (!f.length) { callback(`No ImplementationSpecification .tsv source file in ${sourcePath}`); return; }
		if (f.length > 1) {
			callback(`${f.length} candidate .tsv source files in ${sourcePath} (${f.join(', ')}) — expected exactly one; remove the extras.`);
			return;
		}
		tsvPath = path.join(sourcePath, f[0]);
		resolutionMapInDir = path.join(sourcePath, 'refIdResolutionMap.tsv');
	}

	// Resolve resolution map path
	const sourceDir = path.dirname(tsvPath);
	const resolutionMapPath = resolutionMapInDir
		|| ((options && options.resolutionMapPath)
			? options.resolutionMapPath
			: path.join(sourceDir, 'refIdResolutionMap.tsv'));

	console.error(`[sif-tsv/parser] Parsing TSV: ${tsvPath}`);

	// Step 1: Parse TSV
	const sifObjectList = parseTsvFile(tsvPath);
	console.error(`[sif-tsv/parser] Parsed ${sifObjectList.length} SIF objects`);

	// Step 2: Resolve RefId targets
	const manualResolutions = loadResolutionMap(resolutionMapPath);
	const rawEdges = resolveRefIdTargets(sifObjectList, manualResolutions);
	const referenceEdges = deduplicateEdges(rawEdges);
	console.error(`[sif-tsv/parser] Resolved ${referenceEdges.length} REFERENCES edges`);

	// Step 3: Build in-memory data structures
	const typeRegistry = buildTypeRegistry(sifObjectList);
	const { codesetMap, fieldCodesetMap } = buildCodesetRegistry(sifObjectList);
	const { complexTypeMap, parentChildPairs, fieldComplexTypeMap, objectComplexTypesMap } = buildComplexTypeRegistry(sifObjectList);
	const { elementMap, childElementPairs, objectRootElements, leafFieldLinks } = buildXmlElementTree(sifObjectList);

	const primitiveTypes = [...typeRegistry.values()].filter(t => t.category === 'primitive');
	const simpleTypes = [...typeRegistry.values()].filter(t => t.category === 'simple');

	console.error(`[sif-tsv/parser] Types: ${primitiveTypes.length} primitive, ${simpleTypes.length} simple`);
	console.error(`[sif-tsv/parser] Codesets: ${codesetMap.size}`);
	console.error(`[sif-tsv/parser] ComplexTypes: ${complexTypeMap.size}`);
	console.error(`[sif-tsv/parser] XmlElements: ${elementMap.size}`);

	// Step 4: Build graphForge standard nodes
	const nodes = [];

	// Build lookup maps for edge creation
	const tableNameToObjectId = {};
	sifObjectList.forEach(obj => {
		tableNameToObjectId[obj.tableName] = `sifobject-${obj.tableName}`;
	});

	// SIF root node
	const totalFieldCount = sifObjectList.reduce((sum, obj) => sum + obj.fields.length, 0);
	nodes.push({
		id: 'sif-root',
		label: 'SifRoot',
		superLabel: 'SifModel',
		properties: {
			name: 'SIF',
			description: `SIF Implementation Specification — ${sifObjectList.length} objects, ${totalFieldCount} fields`,
			objectCount: sifObjectList.length,
			fieldCount: totalFieldCount,
			complexTypeCount: complexTypeMap.size,
			codesetCount: codesetMap.size,
			xmlElementCount: elementMap.size
		},
		edges: []
	});

	// SifPrimitiveType nodes
	primitiveTypes.forEach(t => {
		nodes.push({
			id: `primtype-${t.name}`,
			label: 'SifPrimitiveType',
			superLabel: 'SifModel',
			properties: {
				name: t.name,
				description: `SIF primitive type: ${t.name}`,
				category: 'primitive'
			},
			edges: []
		});
	});

	// SifSimpleType nodes
	simpleTypes.forEach(t => {
		nodes.push({
			id: `simpletype-${t.name}`,
			label: 'SifSimpleType',
			superLabel: 'SifModel',
			properties: {
				name: t.name,
				description: `SIF simple type: ${t.name}`,
				category: 'simple'
			},
			edges: []
		});
	});

	// SifCodeset nodes
	const codesetList = [...codesetMap.values()];
	codesetList.forEach(cs => {
		const codesetName = cs.values.slice(0, 3).join(', ') + (cs.values.length > 3 ? '...' : '');
		nodes.push({
			id: `codeset-${cs.fingerprint}`,
			label: 'SifCodeset',
			superLabel: 'SifModel',
			properties: {
				name: codesetName,
				description: `SIF codeset: ${cs.values.join(', ')}`,
				fingerprint: cs.fingerprint,
				valueCount: cs.valueCount,
				values: cs.values
			},
			edges: []
		});
	});

	// SifComplexType nodes
	const complexTypeList = [...complexTypeMap.values()];
	const ctContainsEdges = [...parentChildPairs].map(pair => {
		const [parentName, childName] = pair.split('|');
		return { parentName, childName };
	});

	complexTypeList.forEach(ct => {
		const ctEdges = [];

		// CONTAINS edges (parent → child complex types)
		ctContainsEdges.forEach(e => {
			if (e.parentName === ct.name) {
				ctEdges.push({
					type: 'CONTAINS',
					targetId: `complextype-${e.childName}`,
					targetLabel: 'SifComplexType'
				});
			}
		});

		nodes.push({
			id: `complextype-${ct.name}`,
			label: 'SifComplexType',
			superLabel: 'SifModel',
			properties: {
				name: ct.name,
				description: `SIF complex type: ${ct.name} (used in ${ct.objectCount} objects, ${ct.fieldCount} fields)`,
				objectCount: ct.objectCount,
				fieldCount: ct.fieldCount
			},
			edges: ctEdges
		});
	});

	// SifObject nodes
	sifObjectList.forEach(obj => {
		const objectId = `sifobject-${obj.tableName}`;
		const objEdges = [];

		// USES_COMPLEX_TYPE edges
		const ctNames = objectComplexTypesMap.get(obj.tableName);
		if (ctNames) {
			ctNames.forEach(ctName => {
				objEdges.push({
					type: 'USES_COMPLEX_TYPE',
					targetId: `complextype-${ctName}`,
					targetLabel: 'SifComplexType'
				});
			});
		}

		// HAS_ROOT_ELEMENT edges
		const rootElementPaths = objectRootElements.get(obj.tableName);
		if (rootElementPaths) {
			rootElementPaths.forEach(elPath => {
				objEdges.push({
					type: 'HAS_ROOT_ELEMENT',
					targetId: `xmlelement-${elPath}`,
					targetLabel: 'SifXmlElement'
				});
			});
		}

		nodes.push({
			id: objectId,
			label: 'SifObject',
			superLabel: 'SifModel',
			properties: {
				name: obj.name,
				description: `SIF object: ${obj.name} (${obj.fields.length} fields)`,
				tableName: obj.tableName,
				fieldCount: obj.fields.length,
				mandatoryFieldCount: obj.fields.filter(f => f.mandatory).length
			},
			edges: objEdges
		});
	});

	// REFERENCES edges (object-to-object via RefId)
	referenceEdges.forEach(refEdge => {
		const sourceId = tableNameToObjectId[refEdge.sourceTable];
		const targetId = tableNameToObjectId[refEdge.targetTable];
		if (sourceId && targetId) {
			const sourceNode = nodes.find(n => n.id === sourceId);
			if (sourceNode) {
				sourceNode.edges.push({
					type: 'REFERENCES',
					targetId,
					targetLabel: 'SifObject',
					properties: { via: refEdge.via, mandatory: refEdge.mandatory }
				});
			}
		}
	});

	// SifField nodes (the big one — ~15,620 fields)
	let fieldsWithCedsId = 0;
	sifObjectList.forEach(obj => {
		const objectId = `sifobject-${obj.tableName}`;

		obj.fields.forEach((field, fieldIndex) => {
			const fieldId = `siffield-${field.xpath}`;
			const fieldEdges = [];

			// HAS_TYPE edge
			if (field.type) {
				const typeInfo = typeRegistry.get(field.type);
				if (typeInfo) {
					const typePrefix = typeInfo.category === 'simple' ? 'simpletype' : 'primtype';
					fieldEdges.push({
						type: 'HAS_TYPE',
						targetId: `${typePrefix}-${field.type}`,
						targetLabel: typeInfo.label
					});
				}
			}

			// CONSTRAINED_BY edge
			const fingerprint = fieldCodesetMap.get(field.xpath);
			if (fingerprint) {
				fieldEdges.push({
					type: 'CONSTRAINED_BY',
					targetId: `codeset-${fingerprint}`,
					targetLabel: 'SifCodeset'
				});
			}

			// MEMBER_OF edge (field → complex type)
			const ctName = fieldComplexTypeMap.get(field.xpath);
			if (ctName) {
				fieldEdges.push({
					type: 'MEMBER_OF',
					targetId: `complextype-${ctName}`,
					targetLabel: 'SifComplexType'
				});
			}

			const fieldProps = {
				name: field.name,
				description: field.description || `SIF field: ${field.name}`,
				xpath: field.xpath,
				mandatory: field.mandatory,
				characteristics: field.characteristics,
				depth: field.depth,
				isAttribute: field.isAttribute,
				// XML sequence within the parent SifObject. 0-based. Source rows in
				// ImplementationSpecification_*.tsv already arrive in XML-valid order;
				// we stamp each field with its position so query consumers can ORDER BY.
				sequenceInParent: fieldIndex,
				// the native XSD-derived value type (e.g. 'normalizedString', 'date', 'token') and its
				// format annotation (bridgeEvidenceRefactor P6 grounding: forgeSif.js previously read the
				// TSV's Type/Format columns only to build the type/codeset REGISTRIES, never propagated
				// them onto the SifField node itself — added here, additively, so a consumer (e.g. the
				// SIF evidence bridge's "value-ish hints" comparison) has a real value-type signal to
				// read instead of none).
				nativeType: field.type,
				format: field.format
			};

			const searchParts = [fieldProps.name + ': ' + fieldProps.description];
			if (fieldProps.xpath) { searchParts.push('XPath: ' + fieldProps.xpath); }
			if (fieldProps.characteristics) { searchParts.push(fieldProps.characteristics); }
			fieldProps.searchText = searchParts.join('. ');

			// Preserve cedsId (critical for bridge building)
			if (field.cedsId) {
				fieldProps.cedsId = field.cedsId;
				fieldsWithCedsId++;
			}

			// Store pathSegments as a joined string (Neo4j-friendly)
			if (field.pathSegments && field.pathSegments.length > 0) {
				fieldProps.pathSegments = field.pathSegments.join('/');
			}

			nodes.push({
				id: fieldId,
				label: 'SifField',
				superLabel: 'SifModel',
				properties: fieldProps,
				edges: fieldEdges,
				// Store parentId for HAS_FIELD edge creation by loader
				_parentEdge: {
					type: 'HAS_FIELD',
					fromId: objectId,
					fromLabel: 'SifObject'
				}
			});
		});
	});

	// SifXmlElement nodes
	const elementData = [...elementMap.values()];
	elementData.forEach(el => {
		const elEdges = [];

		// CHILD_ELEMENT edges. The `sequence` edge property preserves the XML
		// child order from the source TSV — essential because SIF XSDs are
		// sequence-sensitive and the graph's native edge ordering is not
		// guaranteed stable. el.children is a Set (insertion-order preserving
		// per ECMAScript spec), so converting to Array gives us stable indices.
		[...el.children].forEach((childPath, childIndex) => {
			elEdges.push({
				type: 'CHILD_ELEMENT',
				targetId: `xmlelement-${childPath}`,
				targetLabel: 'SifXmlElement',
				properties: { sequence: childIndex }
			});
		});

		// TYPED_AS edge (non-leaf elements → complex type with same name)
		if (!el.isLeaf && complexTypeMap.has(el.name)) {
			elEdges.push({
				type: 'TYPED_AS',
				targetId: `complextype-${el.name}`,
				targetLabel: 'SifComplexType'
			});
		}

		nodes.push({
			id: `xmlelement-${el.path}`,
			label: 'SifXmlElement',
			superLabel: 'SifModel',
			properties: {
				name: el.name,
				description: `SIF XML element: ${el.name} (depth ${el.depth})`,
				path: el.path,
				depth: el.depth,
				isShared: el.isShared,
				isLeaf: el.isLeaf
			},
			edges: elEdges
		});
	});

	// REALIZED_BY edges (leaf xml elements → fields)
	leafFieldLinks.forEach(link => {
		const el = elementMap.get(link.elementPath);
		if (el && el.isLeaf) {
			const xmlNode = nodes.find(n => n.id === `xmlelement-${link.elementPath}`);
			if (xmlNode) {
				xmlNode.edges.push({
					type: 'REALIZED_BY',
					targetId: `siffield-${link.fieldXpath}`,
					targetLabel: 'SifField'
				});
			}
		}
	});

	// Count total edges
	let totalEdges = 0;
	let parentEdgeCount = 0;
	nodes.forEach(n => {
		totalEdges += (n.edges || []).length;
		if (n._parentEdge) { parentEdgeCount++; }
	});

	console.error(`[sif-tsv/parser] Total nodes: ${nodes.length}`);
	console.error(`[sif-tsv/parser] Total edges (declared): ${totalEdges}`);
	console.error(`[sif-tsv/parser] Parent edges (HAS_FIELD): ${parentEdgeCount}`);
	console.error(`[sif-tsv/parser] Fields with cedsId: ${fieldsWithCedsId}`);

	callback('', {
		nodes,
		metadata: {
			version: '1.0',
			sourceFormat: 'tsv',
			objectCount: sifObjectList.length,
			fieldCount: totalFieldCount,
			complexTypeCount: complexTypeMap.size,
			simpleTypeCount: simpleTypes.length,
			primitiveTypeCount: primitiveTypes.length,
			codesetCount: codesetMap.size,
			xmlElementCount: elementMap.size,
			referenceEdgeCount: referenceEdges.length,
			fieldsWithCedsId,
			totalNodes: nodes.length
		}
	});
};
