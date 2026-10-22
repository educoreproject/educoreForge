'use strict';

// parser.js — SIF Implementation Specification TSV → standard graphForge node format
// Ported from educore sif/tsvParser.js — adapted to graphForge parser contract.
// The parser NEVER touches Neo4j. It only reads the source files and returns standard nodes.
//
// CONTRACT: module.exports = (sourcePath, options, callback) with
// callback(errorString, { nodes, metadata, parseAudit }) — parseAudit added in the Phase 1 forge
// audit (2026-08-03): counts/records of every formerly-silent parse path (resolution-path census,
// unresolved refIds, reference-edge drops, leaf-link skips, format canonicalization events,
// header verifications, empty-name row skips). parseAudit is run diagnostics — the forge threads
// it onto stats, DIGEST-EXCLUDED (the block fingerprint covers nodes/edges/metadata only).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TABLE_HEADER_PATTERN = /^(.+):\s*Table\s+\d+$/;
const LITERAL_COLUMN_HEADER = ['Name', 'Mandatory', 'Characteristics', 'Type', 'Description', 'XPath', 'CEDS ID', 'Format'].join('\t');

// ============================================================
// TSV PARSING
// ============================================================

// returns { sifObjectList, parseEvents } or { error } — never both. Phase 1 forge audit (RT-2/RT-3):
// the parse refuses by name instead of guessing, and every formerly-silent skip is counted.
const parseTsvFile = (tsvPath) => {
	const content = fs.readFileSync(tsvPath, 'utf8');
	const lines = content.split('\n');

	const sifObjectList = [];
	const parseEvents = { columnHeadersVerified: 0, emptyNameRowsSkipped: 0 };
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
			// name is derived AFTER the section is parsed, from the xpath-stated element name —
			// never guessed from the sheet-derived tableName (see the derivation loop below).
			currentObject = {
				tableName,
				name: '',
				fields: [],
				refIdFields: []
			};
			expectColumnHeaders = true;
			continue;
		}

		if (expectColumnHeaders) {
			expectColumnHeaders = false;
			// RT-3: the row after every table header MUST be the literal 8-column header. The
			// incumbent swallowed this line unexamined, so a section missing its header row would
			// silently eat a DATA row instead.
			if (line !== LITERAL_COLUMN_HEADER) {
				return {
					error:
						`table '${currentObject.tableName}' is not followed by the required column-header row ` +
						`(Name/Mandatory/Characteristics/Type/Description/XPath/CEDS ID/Format) — refusing to parse ` +
						`a section whose first row cannot be verified as the header`,
				};
			}
			parseEvents.columnHeadersVerified++;
			continue;
		}

		if (!currentObject) { continue; }

		const columns = line.split('\t');
		const fieldName = (columns[0] || '').trim();
		if (!fieldName) {
			// RT-2 visibility: a row carrying content but no Name is skipped — counted, never silent.
			if (columns.some((oneColumn) => (oneColumn || '').trim() !== '')) {
				parseEvents.emptyNameRowsSkipped++;
			}
			continue;
		}

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

	// Phase 1 D2 — the object's element name (singular) is STATED by the source in every field
	// xpath ('/AccountingPeriods/AccountingPeriod/…' — second non-empty segment). The incumbent
	// GUESSED it by stripping a trailing 's' from tableName — wrong for the 4 sheet names the
	// spreadsheet TRUNCATES at the ~31-char sheet-name limit (tableName keeps the sheet name
	// verbatim; it is the stableId natural key and is a source statement in its own right).
	// Absent-is-absent: no stated name, or conflicting stated names, is a refusal — never a guess.
	for (const oneObject of sifObjectList) {
		const statedElementNames = [
			...new Set(
				oneObject.fields
					.map((oneField) => oneField.xpath.split('/').filter((onePart) => onePart)[1])
					.filter((onePart) => onePart),
			),
		];
		if (statedElementNames.length === 0) {
			return {
				error:
					`table '${oneObject.tableName}' has no xpath-stated element name (no field xpath ` +
					`carries a second segment) — refusing to guess a singular object name`,
			};
		}
		if (statedElementNames.length > 1) {
			return {
				error:
					`table '${oneObject.tableName}' states conflicting element names in its field xpaths ` +
					`(${statedElementNames.join(', ')}) — refusing to choose between them`,
			};
		}
		oneObject.name = statedElementNames[0];
	}

	return { sifObjectList, parseEvents };
};

// ============================================================
// REFID RESOLUTION
// ============================================================

// returns { manualResolutions } or { error }. Phase 1 D3 (RT-3): the curated crosswalk is a
// REQUIRED source input — the incumbent warned and continued, silently degrading every curated
// resolution to the pluralization heuristic.
const loadResolutionMap = (resolutionMapPath) => {
	const manualResolutions = {};

	if (!fs.existsSync(resolutionMapPath)) {
		return {
			error:
				`refIdResolutionMap.tsv not found at ${resolutionMapPath} — it is a required source ` +
				`input of the SIF forge; see README_PROVENANCE.md in the snapshot directory for the ` +
				`acquisition recipe`,
		};
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

	return { manualResolutions };
};

// resolutionAudit (Phase 1 D5): every resolution path is COUNTED and every nothing-resolution is
// RECORDED — the heuristics themselves are the bundle's documented resolution method (supervised
// by the curated map; supervisor-ruled KEEP 2026-08-03), but none of them acts silently anymore.
const resolveRefIdTargets = (sifObjectList, manualResolutions, resolutionAudit) => {
	const tableNameSet = new Set(sifObjectList.map(obj => obj.tableName));
	const tableNameLowerMap = {};
	for (const obj of sifObjectList) {
		tableNameLowerMap[obj.tableName.toLowerCase()] = obj.tableName;
	}

	const allEdges = [];

	resolutionAudit.resolutionPaths = {
		manual: 0,
		manualUnresolvable: 0,
		naivePlural: 0,
		lowercasePlural: 0,
		suffixInfos: 0,
		suffixPersonals: 0,
		suffixItems: 0,
	};

	for (const sifObject of sifObjectList) {
		for (const refField of sifObject.refIdFields) {
			const cleanName = refField.name.replace(/^@/, '');

			if (manualResolutions[cleanName]) {
				const resolved = manualResolutions[cleanName];
				if (resolved === 'UNRESOLVABLE_GENERIC_REF') {
					resolutionAudit.resolutionPaths.manualUnresolvable++;
					continue;
				}
				resolutionAudit.resolutionPaths.manual++;
				if (!tableNameSet.has(resolved)) {
					// a curated row naming a table the source does not carry would formerly vanish at
					// block assembly — recorded here at the resolution seam.
					resolutionAudit.manualTargetsAbsentFromSource.push({
						sourceTable: sifObject.tableName,
						refIdProperty: cleanName,
						resolvedTable: resolved,
					});
				}
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
				resolutionAudit.resolutionPaths.naivePlural++;
				allEdges.push({ sourceTable: sifObject.tableName, targetTable: naiveTarget, via: cleanName, mandatory: refField.mandatory });
				continue;
			}

			if (tableNameLowerMap[naiveTarget.toLowerCase()]) {
				resolutionAudit.resolutionPaths.lowercasePlural++;
				allEdges.push({ sourceTable: sifObject.tableName, targetTable: tableNameLowerMap[naiveTarget.toLowerCase()], via: cleanName, mandatory: refField.mandatory });
				continue;
			}

			let found = false;
			for (const suffix of ['Infos', 'Personals', 'Items']) {
				const candidate = baseName + suffix;
				if (tableNameLowerMap[candidate.toLowerCase()]) {
					resolutionAudit.resolutionPaths[`suffix${suffix}`]++;
					allEdges.push({ sourceTable: sifObject.tableName, targetTable: tableNameLowerMap[candidate.toLowerCase()], via: cleanName, mandatory: refField.mandatory });
					found = true;
					break;
				}
			}
			if (found) { continue; }

			// nothing resolved — RECORDED (Phase 1 D5), never a silent skip.
			resolutionAudit.unresolvedRefIds.push({
				sourceTable: sifObject.tableName,
				refIdProperty: cleanName,
			});
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

// canonicalization events (quote-strip, empty-after-strip) are COUNTED on the audit (Phase 1 D6) —
// the canonicalization itself is KEPT: it is identity-bearing (codeset fingerprints, and therefore
// stableIds, are computed over the canonicalized values; reversing it would churn ids).
const buildCodesetRegistry = (sifObjectList, canonicalizationAudit) => {
	const codesetMap = new Map();
	const fieldCodesetMap = new Map();

	for (const obj of sifObjectList) {
		for (const field of obj.fields) {
			let formatStr = field.format;
			if (!formatStr) { continue; }
			const strippedFormatStr = formatStr.replace(/^"(.*)"$/, '$1');
			if (strippedFormatStr !== formatStr) {
				canonicalizationAudit.formatQuoteStripCount++;
			}
			formatStr = strippedFormatStr;
			if (!formatStr.trim()) {
				canonicalizationAudit.formatEmptyAfterQuoteStrip++;
				continue;
			}
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
// SOURCE-INTEGRITY VERIFICATION AT CONSUMPTION (Phase 1 D4, RT-3)
// ============================================================

// returns '' when every listed source file verifies, else a named refusal. Scope: the snapshot
// directory's .tsv source bytes (SHA256SUMS covers source bytes only; README_PROVENANCE.md,
// SHA256SUMS itself, and standardSourceLocation are provenance peers, not source bytes).
const verifySourceChecksums = (snapshotDirPath) => {
	const checksumFilePath = path.join(snapshotDirPath, 'SHA256SUMS');
	if (!fs.existsSync(checksumFilePath)) {
		return (
			`SHA256SUMS missing from ${snapshotDirPath} — source integrity cannot be verified at ` +
			`consumption; see README_PROVENANCE.md in that directory for the acquisition recipe`
		);
	}

	const listedChecksums = {};
	fs.readFileSync(checksumFilePath, 'utf8')
		.split('\n')
		.forEach((oneLine) => {
			const checksumMatch = oneLine.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
			if (checksumMatch) {
				listedChecksums[checksumMatch[2].trim()] = checksumMatch[1];
			}
		});
	// a malformed line leaves its file unlisted, which refuses below — never a silent pass.
	if (Object.keys(listedChecksums).length === 0) {
		return (
			`SHA256SUMS at ${checksumFilePath} contains no parseable checksum lines — source ` +
			`integrity cannot be verified; see README_PROVENANCE.md in that directory`
		);
	}

	for (const [oneListedName, expectedChecksum] of Object.entries(listedChecksums)) {
		const listedFilePath = path.join(snapshotDirPath, oneListedName);
		if (!fs.existsSync(listedFilePath)) {
			return (
				`source file '${oneListedName}' is listed in SHA256SUMS but absent from ` +
				`${snapshotDirPath} — refusing to forge; see README_PROVENANCE.md in that directory ` +
				`for the acquisition recipe`
			);
		}
		const computedChecksum = crypto.createHash('sha256').update(fs.readFileSync(listedFilePath)).digest('hex');
		if (computedChecksum !== expectedChecksum) {
			return (
				`source file '${oneListedName}' fails SHA256 verification in ${snapshotDirPath} ` +
				`(expected ${expectedChecksum}, computed ${computedChecksum}) — the bytes are not the ` +
				`provenance'd snapshot; refusing to forge; see README_PROVENANCE.md in that directory`
			);
		}
	}

	const unlistedSourceFiles = fs
		.readdirSync(snapshotDirPath)
		.filter((oneName) => oneName.endsWith('.tsv') && !(oneName in listedChecksums));
	if (unlistedSourceFiles.length) {
		return (
			`source file '${unlistedSourceFiles.join("', '")}' in ${snapshotDirPath} is not listed in ` +
			`SHA256SUMS — an unprovenance'd source candidate; refusing to forge; see ` +
			`README_PROVENANCE.md in that directory`
		);
	}

	return '';
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
		// Phase 1 D4 (RT-3): source integrity is verified AT CONSUMPTION, before any candidate
		// selection — mismatch, listed-but-absent, unlisted, and missing-SHA256SUMS each refuse by
		// name. Snapshot-directory consumption is the production path (parserDescriptor.ini omits
		// sourceFile) and is what the checksums provenance; a FILE-mode caller points at explicit
		// bytes deliberately and is guarded by the per-input refusals below instead.
		const checksumError = verifySourceChecksums(sourcePath);
		if (checksumError) {
			callback(checksumError);
			return;
		}
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

	// Step 1: Parse TSV (refuses by name on unverifiable header rows / object names)
	const parsedSource = parseTsvFile(tsvPath);
	if (parsedSource.error) {
		callback(parsedSource.error);
		return;
	}
	const sifObjectList = parsedSource.sifObjectList;
	console.error(`[sif-tsv/parser] Parsed ${sifObjectList.length} SIF objects`);

	// parseAudit (Phase 1 D5/D6): every formerly-silent path counted or recorded. Run diagnostics —
	// digest-EXCLUDED (the forge's block fingerprint covers nodes/edges/metadata only; the audit
	// rides on stats).
	const parseAudit = {
		columnHeadersVerified: parsedSource.parseEvents.columnHeadersVerified,
		emptyNameRowsSkipped: parsedSource.parseEvents.emptyNameRowsSkipped,
		resolutionPaths: null, // filled by resolveRefIdTargets
		unresolvedRefIds: [],
		manualTargetsAbsentFromSource: [],
		referenceEdgeDrops: [],
		leafLinkSkips: 0,
		formatQuoteStripCount: 0,
		formatEmptyAfterQuoteStrip: 0,
	};

	// Step 2: Resolve RefId targets (refuses by name on a missing curated crosswalk)
	const resolutionMapResult = loadResolutionMap(resolutionMapPath);
	if (resolutionMapResult.error) {
		callback(resolutionMapResult.error);
		return;
	}
	const rawEdges = resolveRefIdTargets(sifObjectList, resolutionMapResult.manualResolutions, parseAudit);
	const referenceEdges = deduplicateEdges(rawEdges);
	console.error(`[sif-tsv/parser] Resolved ${referenceEdges.length} REFERENCES edges`);

	// Step 3: Build in-memory data structures
	const typeRegistry = buildTypeRegistry(sifObjectList);
	const { codesetMap, fieldCodesetMap } = buildCodesetRegistry(sifObjectList, parseAudit);
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
				// RT-2 (Phase 1 D1): the source states no description for a type — absent is absent.
				description: '',
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
				// RT-2 (Phase 1 D1): absent is absent.
				description: '',
				category: 'simple'
			},
			edges: []
		});
	});

	// SifCodeset nodes
	const codesetList = [...codesetMap.values()];
	codesetList.forEach(cs => {
		// the display name is APPARATUS, not fabrication (supervisor-ruled 2026-08-03): SIF codesets
		// are UNNAMED inline enumerations keyed by value-fingerprint — the source states no name, so
		// the bundle names them from their own source-stated values, verbatim.
		const codesetName = cs.values.slice(0, 3).join(', ') + (cs.values.length > 3 ? '...' : '');
		nodes.push({
			id: `codeset-${cs.fingerprint}`,
			label: 'SifCodeset',
			superLabel: 'SifModel',
			properties: {
				name: codesetName,
				// RT-2 (Phase 1 D1): the values live in the `values` property; prose is absent.
				description: '',
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
				// RT-2 (Phase 1 D1): absent is absent — the usage counts live in their own properties.
				description: '',
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
				// RT-2 (Phase 1 D1): absent is absent — the field counts live in their own properties.
				description: '',
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
		const sourceNode = sourceId ? nodes.find(n => n.id === sourceId) : null;
		if (sourceId && targetId && sourceNode) {
			sourceNode.edges.push({
				type: 'REFERENCES',
				targetId,
				targetLabel: 'SifObject',
				properties: { via: refEdge.via, mandatory: refEdge.mandatory }
			});
		} else {
			// an unmaterializable resolved edge would formerly vanish here — RECORDED (Phase 1 D5).
			parseAudit.referenceEdgeDrops.push({
				sourceTable: refEdge.sourceTable,
				targetTable: refEdge.targetTable,
				via: refEdge.via,
			});
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
				// RT-2 (Phase 1 D1): the source's Description cell, verbatim — an empty cell emits ''
				// (the || placeholder chain fabricated prose on 4,733 of 15,620 fields).
				description: field.description,
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
				// RT-2 (Phase 1 D1): absent is absent — depth/path live in their own properties.
				description: '',
				path: el.path,
				depth: el.depth,
				isShared: el.isShared,
				isLeaf: el.isLeaf
			},
			edges: elEdges
		});
	});

	// REALIZED_BY edges (leaf xml elements → fields). Leaves-only is the documented design (a
	// non-leaf element is structure, not a value carrier); the skipped candidates are COUNTED on
	// the audit (Phase 1 D5) so the design's reach is measured, never silent.
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
		} else {
			parseAudit.leafLinkSkips++;
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
		parseAudit,
		metadata: {
			// NO `version` KEY. The TSV declares no version of its own — it never did, and the
			// literal '1.0' that stood here was read from nothing and supported by nothing
			// (versionFromStamp order, tqii 2026-08-31). A parser reports what it PARSED; the
			// framework now takes the version from the snapshot's provenance stamp instead.
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
