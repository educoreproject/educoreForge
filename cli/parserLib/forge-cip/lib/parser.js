'use strict';

// parser.js — NCES CIP 2020 CSV -> native CIP graphForge node format.
//
// HARVESTED from educoreForgeOLD/system/code/cli/lib.d/forge-cip/lib/parser.js: the CSV navigation
// logic (the quote-aware line splitter, the Excel-safe ="01" code de-encoding, the Deleted-row skip,
// the 2/4/6-digit level classification, the parent-code derivation, the CrossReferences code
// extraction, and the ALL-CAPS title de-shouting) is reused as-is. What is REUSED is HOW the source
// is read; the emitted node shape is the SAME native shape forge-edfi/forge-sif's parser produces
// ({ id, label, superLabel, properties, edges, optional _parentEdge }) so the forge-cip MAIN module
// can map each native node onto the universal six-role Dme* contract. The OLD output schema (its own
// CipDomain/CipSubdomain/CipProgram node contract + HAS_DOMAIN/HAS_SUBDOMAIN/HAS_PROGRAM/
// CROSS_REFERENCES native edges) is NOT reproduced verbatim — the hierarchy is expressed as a single
// native HAS_CHILD parent edge (translated by the main module to SUBCLASS_OF child->parent), and the
// cross-references as native CROSS_REFERENCES edges (translated to REFERENCES).
//
// One source CSV (a DIRECTORY is the source; the parser resolves the single .csv inside it, matching
// the SIF/EdFi version-directory convention):
//   CIPCode2020.csv — the NCES CIP 2020 taxonomy (family/code/action/title/definition/x-refs/examples)
//
// The parser NEVER touches Neo4j. It only reads the source file and returns native nodes. CIP carries
// NO CEDS columns in the CSV — it is a pure intra-CIP taxonomy; there is no bridge/cross-standard data
// to stash here.

const fs = require('fs');
const path = require('path');

const normalize = require('./normalize');

// ============================================================
// CSV PARSING  (harvested verbatim from the old forge-cip parser)
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

// Strip Excel-safe encoding: ="01.0000" -> 01.0000  (harvested)
const stripExcelEncoding = (value) => `${value || ''}`.replace(/^="?|"?$/g, '').trim();

const parseCipCsv = (csvPath) => {
	const content = fs.readFileSync(csvPath, 'utf8');
	const lines = content.split('\n').filter((line) => line.trim());

	if (lines.length < 2) {
		return [];
	}

	const headers = parseCsvLine(lines[0]);
	const rows = [];

	for (let i = 1; i < lines.length; i++) {
		const values = parseCsvLine(lines[i]);
		const row = {};
		headers.forEach((header, idx) => {
			row[header] = (values[idx] || '').trim();
		});

		// Strip Excel encoding from the code fields.
		row.CIPCode = stripExcelEncoding(row.CIPCode || '');
		row.CIPFamily = stripExcelEncoding(row.CIPFamily || '');

		// Skip change-tracking artifacts from the CIP 2010->2020 revision — they are NOT substantive
		// taxonomy entries. 'Deleted' codes are gone; 'Moved from'/'Moved to' rows are redirect
		// breadcrumbs (the CIPDefinition is literally "Moved from X to Y", not program content) whose
		// computed hierarchy parent is frequently a deleted/moved code, producing orphan SUBCLASS_OF
		// edges. The 2020 taxonomy proper is the {No substantive changes, New} set; dropping the
		// migration artifacts yields a clean, fully-connected pure taxonomy (no dangling edges).
		const action = (row.Action || '').trim();
		if (action === 'Deleted' || action === 'Moved from' || action === 'Moved to') {
			continue;
		}

		if (row.CIPCode) {
			rows.push(row);
		}
	}

	return rows;
};

// ============================================================
// CROSS-REFERENCE PARSING  (harvested: extract CIP codes from the free-text CrossReferences field)
//   "14.0301 - Agricultural Engineering." -> ['14.0301']
//   "13.1001, 13.1501 - some text"        -> ['13.1001','13.1501']
// ============================================================

const parseCrossReferences = (crossRefStr) => {
	if (!crossRefStr) {
		return [];
	}
	const refs = [];
	const codePattern = /(\d{2}\.\d{2,4})/g;
	let match;
	while ((match = codePattern.exec(crossRefStr)) !== null) {
		refs.push(match[1]);
	}
	return refs;
};

// ============================================================
// TITLE FORMATTING  (harvested: CIP titles are ALL CAPS w/ trailing period -> title case)
// ============================================================

const formatTitle = (title) => {
	if (!title) {
		return '';
	}
	let clean = `${title}`.replace(/\.\s*$/, '');
	clean = clean.toLowerCase().replace(/(?:^|\s|[-/])\w/g, (ch) => ch.toUpperCase());
	return clean;
};

// ============================================================
// MAIN PARSER — graphForge parser contract (callback(err, { nodes, metadata }))
//   Emits native CIP nodes in the forge-edfi native shape:
//     CipRoot, CipDomain (DmeClass), CipSubdomain (DmeClass), CipProgram (DmeClass).
//   The hierarchy is expressed as ONE native _parentEdge per non-domain node:
//     subdomain -> domain, program -> subdomain (native type HAS_CHILD; the main module translates
//     it to SUBCLASS_OF FROM the child TO the parent — the canonical class-hierarchy edge).
//   Domains are owned by the root (HAS_CLASS), SYNTHESIZED by the main module (mirrors forge-edfi).
//   Intra-CIP cross-references live on each node's .edges (native CROSS_REFERENCES -> REFERENCES).
// ============================================================

module.exports = (sourcePath, options, callback) => {
	if (!fs.existsSync(sourcePath)) {
		callback(`Source path not found: ${sourcePath}`);
		return;
	}

	// The registry points at the version DIRECTORY containing the CSV (mirrors forge-edfi/forge-sif).
	let csvPath;
	const stat = fs.statSync(sourcePath);
	if (stat.isDirectory()) {
		// L15: sorted for cross-machine determinism; EXACTLY ONE candidate required — a stray
		// second source file would silently forge a different standard on another machine.
		const csvFiles = fs.readdirSync(sourcePath).filter((f) => f.endsWith('.csv')).sort();
		if (csvFiles.length === 0) {
			callback(`forge-cip parser: no CSV file found in version directory: ${sourcePath}`);
			return;
		}
		if (csvFiles.length > 1) {
			callback(
				`forge-cip parser: ${csvFiles.length} candidate .csv source files in ${sourcePath} (${csvFiles.join(', ')}) — expected exactly one; remove the extras.`,
			);
			return;
		}
		csvPath = path.join(sourcePath, csvFiles[0]);
	} else {
		csvPath = sourcePath;
	}

	console.error(`[cip/parser] Parsing CIP 2020 CSV: ${csvPath}`);

	// Step 1: parse the CSV (harvested navigation).
	const rows = parseCipCsv(csvPath);
	console.error(`[cip/parser] Parsed ${rows.length} CIP entries (excluding deleted codes)`);

	// Step 2: classify by level + index by code.
	const domains = [];
	const subdomains = [];
	const programs = [];
	const allCodes = new Set();

	rows.forEach((row) => {
		allCodes.add(row.CIPCode);
		const level = normalize.classifyCode(row.CIPCode);
		if (level === 'domain') {
			domains.push(row);
		} else if (level === 'subdomain') {
			subdomains.push(row);
		} else {
			programs.push(row);
		}
	});

	console.error(
		`[cip/parser] Domains: ${domains.length}, Subdomains: ${subdomains.length}, Programs: ${programs.length}`,
	);

	// native ids keyed by CIP code (deterministic). The main module's stableId is cip:<kind>/<code>.
	const nativeIdFor = (level, cipCode) => `cip${level}-${cipCode}`;
	const labelByLevel = { domain: 'CipDomain', subdomain: 'CipSubdomain', program: 'CipProgram' };

	// Step 3: build native nodes.
	const nodes = [];

	// --- CipRoot (no native ownership edges — main module synthesizes HAS_CLASS to domains) ---
	nodes.push({
		id: 'cip-root',
		label: 'CipRoot',
		superLabel: 'CipModel',
		properties: {
			name: 'CIP 2020',
			description: `Classification of Instructional Programs (CIP) 2020 — ${domains.length} domains, ${subdomains.length} subdomains, ${programs.length} programs`,
			domainCount: domains.length,
			subdomainCount: subdomains.length,
			programCount: programs.length,
		},
		edges: [],
	});

	let crossRefDeclared = 0;

	// --- helper: build one native CIP taxonomy node ---
	const buildCipNode = (row, level) => {
		const title = formatTitle(row.CIPTitle);
		const definition = (row.CIPDefinition || '').trim();
		const examples = (row.Examples || '').trim();
		const crossRefs = parseCrossReferences(row.CrossReferences || '');

		// native CROSS_REFERENCES edges to other CIP codes that actually exist (intra-CIP).
		const edges = [];
		crossRefs.forEach((refCode) => {
			if (allCodes.has(refCode)) {
				const refLevel = normalize.classifyCode(refCode);
				edges.push({
					type: 'CROSS_REFERENCES',
					targetId: nativeIdFor(refLevel, refCode),
					targetLabel: labelByLevel[refLevel],
				});
				crossRefDeclared++;
			}
		});

		const node = {
			id: nativeIdFor(level, row.CIPCode),
			label: labelByLevel[level],
			superLabel: 'CipModel',
			properties: {
				name: title || row.CIPCode,
				description:
					definition || `CIP ${level}: ${row.CIPCode}${title ? ` ${title}` : ''}`,
				cipCode: row.CIPCode,
				cipFamily: row.CIPFamily || '',
				cipLevel: level,
			},
			edges,
		};
		if (examples) {
			node.properties.examples = examples;
		}

		// SUBCLASS_OF parent edge (child -> parent), expressed natively as HAS_CHILD parent->child;
		// the main module emits SUBCLASS_OF FROM child TO parent. Domains have no parent edge here.
		//
		// NEAREST-EXISTING-ANCESTOR fallback: a few substantive ('New') programs have an immediate
		// parent subdomain that was itself marked 'Moved to'/'Deleted' (e.g. 61.2201 under the
		// moved-out 61.22). Dropping those real programs would lose data; emitting a SUBCLASS_OF to a
		// non-existent parent would be a dangling edge (forbidden). So we walk UP to the nearest
		// ANCESTOR that actually survives in the taxonomy (program -> its existing domain when the
		// subdomain is gone), keeping the hierarchy fully connected without inventing placeholder nodes.
		const resolveExistingAncestor = (cipCode, fromLevel) => {
			let candidate = normalize.parentCodeOf(cipCode, fromLevel);
			while (candidate) {
				const candidateLevel = normalize.classifyCode(candidate);
				if (allCodes.has(candidate)) {
					return { code: candidate, level: candidateLevel };
				}
				candidate = normalize.parentCodeOf(candidate, candidateLevel);
			}
			return null; // nothing survives above it -> the main module anchors it to the root
		};

		if (level !== 'domain') {
			const ancestor = resolveExistingAncestor(row.CIPCode, level);
			if (ancestor) {
				node._parentEdge = {
					type: 'HAS_CHILD',
					fromId: nativeIdFor(ancestor.level, ancestor.code),
					fromLabel: labelByLevel[ancestor.level],
				};
			}
			// when no surviving ancestor exists the node carries NO _parentEdge; the main module
			// treats a parentless non-domain class as root-owned (HAS_CLASS), so nothing is unreachable.
		}
		return node;
	};

	domains.forEach((row) => nodes.push(buildCipNode(row, 'domain')));
	subdomains.forEach((row) => nodes.push(buildCipNode(row, 'subdomain')));
	programs.forEach((row) => nodes.push(buildCipNode(row, 'program')));

	// counts.
	let parentEdgeCount = 0;
	nodes.forEach((n) => {
		if (n._parentEdge) {
			parentEdgeCount++;
		}
	});

	console.error(`[cip/parser] Total native nodes: ${nodes.length}`);
	console.error(`[cip/parser] Parent (HAS_CHILD -> SUBCLASS_OF) edges: ${parentEdgeCount}`);
	console.error(`[cip/parser] Cross-reference (CROSS_REFERENCES -> REFERENCES) edges: ${crossRefDeclared}`);

	callback('', {
		nodes,
		metadata: {
			version: 'CIP 2020',
			sourceFormat: 'csv',
			sourceFiles: [path.basename(csvPath)],
			sourceUrl: '',
			domainCount: domains.length,
			subdomainCount: subdomains.length,
			programCount: programs.length,
			crossReferenceEdgeCount: crossRefDeclared,
			totalNodes: nodes.length,
		},
	});
};
