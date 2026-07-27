'use strict';

// parser.js — SOC / O*NET source data → native SOC graphForge node format.
//
// HARVESTED from educoreForgeOLD/system/code/cli/lib.d/forge-soc/lib/parser.js: the source-navigation
// logic (the quote-aware CSV splitter, the TSV splitter, the header-index discovery, the
// occupations / Job Zone Reference / Job Zones / Alternate Titles / CIP crosswalk readers, and the
// .XX → SOC-base-code stripping for crosswalk matching). What is REUSED is HOW the source is read;
// the emitted node shape is the SAME native shape forge-edfi/forge-sif parsers produce
// (id/label/superLabel/properties/edges + optional _parentEdge) so the forge-soc MAIN module can map
// each native node onto the universal six-role Dme* contract. The OLD output schema (SocOccupation /
// SocJobZone with AT_JOB_ZONE/HAS_OCCUPATION edges and a cipMappings-as-bridge property) is NOT
// reproduced verbatim — it is re-shaped to the native contract below.
//
// SOURCE FILES (the registry points at the version DIRECTORY; the parser resolves files inside it):
//   2019_Occupations.csv                  → detailed O*NET-SOC occupations  (-> DmeClass)
//   db_30_2_text/Job Zone Reference.txt    → the 5 Job Zone preparation tiers (-> DmeOptionValue)
//   db_30_2_text/Job Zones.txt             → occupation → job-zone assignment (stashed scalar)
//   db_30_2_text/Alternate Titles.txt      → occupation synonyms (stashed array)
//   CIP2020_SOC2018_Crosswalk.csv          → CIP program targets (CROSS-STANDARD bridge stash)
//
// SYNTHESIZED (no group source file ships in the MVP bundle): SocGroup nodes (major/minor/broad)
// derived from the occupation code structure, so the SUBCLASS_OF occupation taxonomy is meaningful.
//
// MODELING (see forgeSoc.js header for the full role-mapping rationale):
//   SocRoot            -> DmeStandardRoot
//   SocGroup           -> DmeClass   (SUBCLASS_OF chain major <- minor <- broad)
//   SocOccupation      -> DmeClass   (SUBCLASS_OF its broad group)
//   SocJobZoneProperty -> DmeProperty (one synthetic 'jobZone' property; HAS_OPTION_SET -> the set)
//   SocJobZoneSet      -> DmeOptionSet (the single 'Job Zone' option set)
//   SocJobZone         -> DmeOptionValue (a preparation tier; HAS_VALUE from the set)
//
// CROSS-STANDARD PURITY: the CIP crosswalk is NOT SOC structural data. CIP codes are stashed as a
// cipMappings array on the occupation (raw codes) for a LATER bridge phase. NO CIP node and NO
// cross-standard edge is produced here. The parser NEVER touches Neo4j.

const fs = require('fs');
const path = require('path');

const normalize = require('./normalize');

// ============================================================
// LINE PARSING  (harvested verbatim from the old forge-soc parser)
// ============================================================

// Quote-aware CSV line splitter — handles "quoted,values" with embedded commas and "" escapes.
const parseCsvLine = (line) => {
	const out = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out;
};

const parseTsvLine = (line) => line.split('\t');

// ============================================================
// SOURCE READERS  (harvested navigation; header-index discovery preserved)
// ============================================================

// 1. Occupations (2019_Occupations.csv) — O*NET-SOC code → { code, title, description, baseCode }.
const readOccupations = (occupationsCsv) => {
	const lines = fs.readFileSync(occupationsCsv, 'utf8').split('\n').filter((line) => line.trim());
	const header = parseCsvLine(lines[0]).map((h) => h.trim());
	const codeIdx = header.findIndex((h) => h.includes('Code'));
	const titleIdx = header.findIndex((h) => h.includes('Title'));
	const descIdx = header.findIndex((h) => h.includes('Description'));

	const occByCode = {};
	for (let i = 1; i < lines.length; i++) {
		const cols = parseCsvLine(lines[i]);
		const code = (cols[codeIdx] || '').trim();
		if (!code) {
			continue;
		}
		occByCode[code] = {
			code,
			title: (cols[titleIdx] || '').trim(),
			description: (cols[descIdx] || '').trim(),
			baseCode: normalize.toSocBaseCode(code),
		};
	}
	return occByCode;
};

// 2. Job Zone Reference (Job Zone Reference.txt) — zone number → preparation-tier metadata.
const readJobZoneReference = (jobZoneRef) => {
	const lines = fs.readFileSync(jobZoneRef, 'utf8').split('\n').filter((line) => line.trim());
	const header = parseTsvLine(lines[0]);
	const col = {
		zone: header.findIndex((h) => h.trim() === 'Job Zone'),
		name: header.findIndex((h) => h.trim() === 'Name'),
		experience: header.findIndex((h) => h.trim() === 'Experience'),
		education: header.findIndex((h) => h.trim() === 'Education'),
		training: header.findIndex((h) => h.trim() === 'Job Training'),
		examples: header.findIndex((h) => h.trim() === 'Examples'),
		svp: header.findIndex((h) => h.trim() === 'SVP Range'),
	};

	const zoneByNumber = {};
	for (let i = 1; i < lines.length; i++) {
		const cols = parseTsvLine(lines[i]);
		const zone = Number(cols[col.zone]);
		if (!zone) {
			continue;
		}
		zoneByNumber[zone] = {
			zone,
			name: (cols[col.name] || `Job Zone ${zone}`).trim(),
			experience: (cols[col.experience] || '').trim(),
			education: (cols[col.education] || '').trim(),
			training: (cols[col.training] || '').trim(),
			examples: (cols[col.examples] || '').trim(),
			svp: (cols[col.svp] || '').trim(),
		};
	}
	return zoneByNumber;
};

// 3. Job Zones assignment (Job Zones.txt) — O*NET-SOC code → zone number.
const readJobZoneAssignments = (jobZones) => {
	const lines = fs.readFileSync(jobZones, 'utf8').split('\n').filter((line) => line.trim());
	const header = parseTsvLine(lines[0]);
	const codeIdx = header.findIndex((h) => h.trim().includes('SOC Code'));
	const zoneIdx = header.findIndex((h) => h.trim() === 'Job Zone');

	const occupationToZone = {};
	for (let i = 1; i < lines.length; i++) {
		const cols = parseTsvLine(lines[i]);
		const code = (cols[codeIdx] || '').trim();
		const zone = Number(cols[zoneIdx]);
		if (code && zone) {
			occupationToZone[code] = zone;
		}
	}
	return occupationToZone;
};

// 4. Alternate Titles (Alternate Titles.txt) — O*NET-SOC code → [synonyms] (stashed array).
const readAlternateTitles = (altTitles) => {
	const lines = fs.readFileSync(altTitles, 'utf8').split('\n').filter((line) => line.trim());
	const header = parseTsvLine(lines[0]);
	const codeIdx = header.findIndex((h) => h.trim().includes('SOC Code'));
	const titleIdx = header.findIndex((h) => h.trim() === 'Alternate Title');

	const occupationToAltTitles = {};
	for (let i = 1; i < lines.length; i++) {
		const cols = parseTsvLine(lines[i]);
		const code = (cols[codeIdx] || '').trim();
		const title = (cols[titleIdx] || '').trim();
		if (!code || !title) {
			continue;
		}
		if (!occupationToAltTitles[code]) {
			occupationToAltTitles[code] = [];
		}
		occupationToAltTitles[code].push(title);
	}
	return occupationToAltTitles;
};

// 5. CIP ↔ SOC crosswalk (CIP2020_SOC2018_Crosswalk.csv) — SOC base code → Set of CIP codes.
//    CROSS-STANDARD bridge data; matched on the .XX-stripped SOC base code. Stashed, never edged.
const readCipCrosswalk = (crosswalkCsv) => {
	const lines = fs.readFileSync(crosswalkCsv, 'utf8').split('\n').filter((line) => line.trim());
	const header = parseCsvLine(lines[0]);
	const cipIdx = header.findIndex((h) => h.trim() === 'CIP2020Code');
	const socIdx = header.findIndex((h) => h.trim() === 'SOC2018Code');

	const baseCodeToCipCodes = {};
	for (let i = 1; i < lines.length; i++) {
		const cols = parseCsvLine(lines[i]);
		const cipCode = (cols[cipIdx] || '').trim();
		const socBase = (cols[socIdx] || '').trim();
		if (!cipCode || !socBase) {
			continue;
		}
		if (!baseCodeToCipCodes[socBase]) {
			baseCodeToCipCodes[socBase] = new Set();
		}
		baseCodeToCipCodes[socBase].add(cipCode);
	}
	return baseCodeToCipCodes;
};

// ============================================================
// MAIN PARSER — graphForge parser contract (callback(err, { nodes, metadata })).
//   Emits native SOC nodes in the forge-edfi/forge-sif native shape; the main module maps each to a
//   universal Dme* role and synthesizes the root-ownership edges (HAS_CLASS/HAS_PROPERTY) + the
//   SUBCLASS_OF chain. Native edges declared here: occupation/group SUBCLASS_OF parent (on .edges),
//   the synthetic jobZone property's CONSTRAINED_BY → the Job Zone option set (on .edges), and each
//   job-zone value's _parentEdge HAS_VALUE → the option set.
// ============================================================

module.exports = (sourcePath, options, callback) => {
	if (!fs.existsSync(sourcePath)) {
		callback(`Source path not found: ${sourcePath}`);
		return;
	}
	const stat = fs.statSync(sourcePath);
	if (!stat.isDirectory()) {
		callback(`forge-soc parser: --source must be the version directory containing the SOC source files: ${sourcePath}`);
		return;
	}

	const occupationsCsv = path.join(sourcePath, '2019_Occupations.csv');
	const crosswalkCsv = path.join(sourcePath, 'CIP2020_SOC2018_Crosswalk.csv');
	const onetDir = path.join(sourcePath, 'db_30_2_text');
	const jobZoneRef = path.join(onetDir, 'Job Zone Reference.txt');
	const jobZones = path.join(onetDir, 'Job Zones.txt');
	const altTitles = path.join(onetDir, 'Alternate Titles.txt');

	const required = [
		['occupations CSV', occupationsCsv],
		['CIP crosswalk CSV', crosswalkCsv],
		['Job Zone Reference', jobZoneRef],
		['Job Zones', jobZones],
		['Alternate Titles', altTitles],
	];
	for (const [label, filePath] of required) {
		if (!fs.existsSync(filePath)) {
			callback(`forge-soc parser: missing required source file (${label}): ${filePath}`);
			return;
		}
	}

	console.error(`[soc/parser] Reading from: ${sourcePath}`);

	const occByCode = readOccupations(occupationsCsv);
	const zoneByNumber = readJobZoneReference(jobZoneRef);
	const occupationToZone = readJobZoneAssignments(jobZones);
	const occupationToAltTitles = readAlternateTitles(altTitles);
	const baseCodeToCipCodes = readCipCrosswalk(crosswalkCsv);

	const occupationCount = Object.keys(occByCode).length;
	const jobZoneCount = Object.keys(zoneByNumber).length;
	console.error(`[soc/parser] Occupations: ${occupationCount}`);
	console.error(`[soc/parser] Job Zones (reference): ${jobZoneCount}`);
	console.error(`[soc/parser] Occupation→Zone assignments: ${Object.keys(occupationToZone).length}`);
	console.error(`[soc/parser] CIP base SOC codes: ${Object.keys(baseCodeToCipCodes).length}`);

	// ----------------------------------------------------------
	// Synthesize the SocGroup taxonomy from occupation code structure (major/minor/broad).
	// groupByCode: socCode -> { code, level, parentCode } ; parentCode null at the major level.
	// ----------------------------------------------------------
	const groupByCode = {};
	const levelByDepth = ['majorGroup', 'minorGroup', 'broadOccupation'];

	const ensureGroupChain = (baseCode) => {
		const chain = normalize.socGroupCodesForBaseCode(baseCode); // [major, minor, broad]
		if (!chain.length) {
			return { ok: false };
		}
		chain.forEach((code, idx) => {
			if (!groupByCode[code]) {
				groupByCode[code] = {
					code,
					level: levelByDepth[idx] || 'broadOccupation',
					parentCode: idx === 0 ? null : chain[idx - 1],
				};
			}
		});
		return { ok: true, broadCode: chain[chain.length - 1] };
	};

	const occupationParentMisses = [];
	Object.values(occByCode).forEach((occ) => {
		const result = ensureGroupChain(occ.baseCode);
		if (!result.ok) {
			occupationParentMisses.push(occ.code);
		} else {
			occ.broadGroupCode = result.broadCode;
		}
	});

	const groupCount = Object.keys(groupByCode).length;
	console.error(`[soc/parser] Synthesized SOC groups: ${groupCount} (occupation parent misses: ${occupationParentMisses.length})`);

	// ============================================================
	// Build native nodes.
	// ============================================================
	const nodes = [];
	const stats = {
		occupations: 0,
		groups: 0,
		jobZoneValues: 0,
		jobZoneAssignments: 0,
		occupationsWithAltTitles: 0,
		totalAltTitles: 0,
		occupationsWithCipMappings: 0,
		totalCipMappings: 0,
		occupationParentMisses: occupationParentMisses.length,
	};

	// --- SocRoot (main module synthesizes HAS_CLASS/HAS_PROPERTY ownership) ---
	const rootId = 'soc-root';
	nodes.push({
		id: rootId,
		label: 'SocRoot',
		superLabel: 'SocModel',
		properties: {
			name: 'SOC',
			description: `Standard Occupational Classification / O*NET — ${occupationCount} detailed occupations across ${groupCount} taxonomy groups, ${jobZoneCount} O*NET Job Zones`,
		},
		edges: [],
	});

	// --- SocGroup nodes (-> DmeClass); SUBCLASS_OF the parent group (on .edges) ---
	Object.values(groupByCode).forEach((group) => {
		const groupEdges = [];
		if (group.parentCode && groupByCode[group.parentCode]) {
			groupEdges.push({
				type: 'SUBCLASS_OF',
				targetId: `soc-group-${group.parentCode}`,
				targetLabel: 'SocGroup',
			});
		}
		const levelLabel = {
			majorGroup: 'SOC Major Group',
			minorGroup: 'SOC Minor Group',
			broadOccupation: 'SOC Broad Occupation',
		}[group.level];
		nodes.push({
			id: `soc-group-${group.code}`,
			label: 'SocGroup',
			superLabel: 'SocModel',
			properties: {
				name: `${group.code}`,
				description: `${levelLabel} ${group.code}`,
				socCode: group.code,
				socLevel: group.level,
			},
			edges: groupEdges,
		});
		stats.groups++;
	});

	// --- The single Job Zone DmeOptionSet (its values hang off it via _parentEdge HAS_VALUE) ---
	const jobZoneSetId = 'soc-jobzoneset';
	nodes.push({
		id: jobZoneSetId,
		label: 'SocJobZoneSet',
		superLabel: 'SocModel',
		properties: {
			name: 'Job Zone',
			description: `O*NET Job Zone — ${jobZoneCount} preparation tiers grouping occupations by the education, experience, and training needed`,
			valueCount: jobZoneCount,
		},
		edges: [],
	});

	// --- SocJobZone DmeOptionValue nodes (one per preparation tier) ---
	Object.values(zoneByNumber).forEach((zone) => {
		nodes.push({
			id: `soc-jobzone-${zone.zone}`,
			label: 'SocJobZone',
			superLabel: 'SocModel',
			properties: {
				name: `${zone.zone}`,
				description: `${zone.name}. Education: ${zone.education} Experience: ${zone.experience}`.trim(),
				zoneNumber: zone.zone,
				zoneName: zone.name,
				experience: zone.experience,
				education: zone.education,
				training: zone.training,
				examples: zone.examples,
				svpRange: zone.svp,
			},
			edges: [],
			_parentEdge: {
				type: 'HAS_VALUE',
				fromId: jobZoneSetId,
				fromLabel: 'SocJobZoneSet',
			},
		});
		stats.jobZoneValues++;
	});

	// --- The synthetic jobZone DmeProperty; CONSTRAINED_BY -> the Job Zone option set ---
	//     Per the EDGE-TRANSLATION CONVENTION a codeset constraint is HAS_OPTION_SET FROM the
	//     DmeProperty TO the DmeOptionSet. SOC's source has no native field-bearing class for the
	//     job zone, so we model a single standard-level 'jobZone' property that owns the option set.
	nodes.push({
		id: 'soc-property-jobZone',
		label: 'SocJobZoneProperty',
		superLabel: 'SocModel',
		properties: {
			name: 'jobZone',
			description: "An occupation's O*NET Job Zone — the preparation tier (education, experience, training) it requires",
		},
		edges: [
			{
				type: 'CONSTRAINED_BY',
				targetId: jobZoneSetId,
				targetLabel: 'SocJobZoneSet',
			},
		],
	});

	// --- SocOccupation nodes (-> DmeClass); SUBCLASS_OF the broad group (on .edges) ---
	Object.values(occByCode).forEach((occ) => {
		const zone = occupationToZone[occ.code];
		const altTitlesForOcc = occupationToAltTitles[occ.code] || [];
		const cipSet = baseCodeToCipCodes[occ.baseCode];
		const cipMappings = cipSet ? [...cipSet] : [];

		if (altTitlesForOcc.length > 0) {
			stats.occupationsWithAltTitles++;
		}
		stats.totalAltTitles += altTitlesForOcc.length;
		if (cipMappings.length > 0) {
			stats.occupationsWithCipMappings++;
		}
		stats.totalCipMappings += cipMappings.length;
		if (zone) {
			stats.jobZoneAssignments++;
		}

		const occEdges = [];
		if (occ.broadGroupCode && groupByCode[occ.broadGroupCode]) {
			occEdges.push({
				type: 'SUBCLASS_OF',
				targetId: `soc-group-${occ.broadGroupCode}`,
				targetLabel: 'SocGroup',
			});
		}

		nodes.push({
			id: `soc-occupation-${occ.code}`,
			label: 'SocOccupation',
			superLabel: 'SocModel',
			properties: {
				name: occ.title,
				description: occ.description,
				socCode: occ.code,
				socBaseCode: occ.baseCode,
				// jobZone assignment: a faithful scalar attribute value (the structural option-set
				// reachability is carried by the synthetic jobZone DmeProperty, not per-occupation
				// edges — an MVP-scope decision documented in the forge header).
				jobZone: zone || null,
				// stashed search/synonym fodder (NOT nodes) — occupation alternate titles.
				alternateTitles: altTitlesForOcc,
				// CROSS-STANDARD bridge stash: raw CIP2020 program codes mapped to this SOC base code.
				// Carried for a LATER bridge phase; NO CIP node, NO cross-standard edge here.
				cipMappings,
			},
			edges: occEdges,
			_parentEdge: {
				type: 'HAS_OCCUPATION',
				fromId: rootId,
				fromLabel: 'SocRoot',
			},
		});
		stats.occupations++;
	});

	// ----------------------------------------------------------
	// Report
	// ----------------------------------------------------------
	let nativeEdgeCount = 0;
	let parentEdgeCount = 0;
	nodes.forEach((n) => {
		nativeEdgeCount += (n.edges || []).length;
		if (n._parentEdge) {
			parentEdgeCount++;
		}
	});

	console.error(`[soc/parser] === SOC Parse Results ===`);
	console.error(`[soc/parser] SocRoot: 1`);
	console.error(`[soc/parser] SocGroup: ${stats.groups}`);
	console.error(`[soc/parser] SocOccupation: ${stats.occupations}`);
	console.error(`[soc/parser]   ├─ with job zone: ${stats.jobZoneAssignments}`);
	console.error(`[soc/parser]   ├─ with alternate titles: ${stats.occupationsWithAltTitles} (${stats.totalAltTitles} titles)`);
	console.error(`[soc/parser]   └─ with CIP mappings (bridge stash): ${stats.occupationsWithCipMappings} (${stats.totalCipMappings} pairs)`);
	console.error(`[soc/parser] SocJobZoneSet: 1   SocJobZone (values): ${stats.jobZoneValues}   SocJobZoneProperty: 1`);
	console.error(`[soc/parser] Total native nodes: ${nodes.length}`);
	console.error(`[soc/parser] Declared native edges (SUBCLASS_OF + CONSTRAINED_BY): ${nativeEdgeCount}`);
	console.error(`[soc/parser] Parent edges (HAS_OCCUPATION + HAS_VALUE): ${parentEdgeCount}`);

	callback('', {
		nodes,
		metadata: {
			version: 'O*NET-SOC 2019 / O*NET DB 30.2',
			sourceFormat: 'csv',
			sourceFiles: [
				'2019_Occupations.csv',
				'CIP2020_SOC2018_Crosswalk.csv',
				'db_30_2_text/Job Zone Reference.txt',
				'db_30_2_text/Job Zones.txt',
				'db_30_2_text/Alternate Titles.txt',
			],
			sourceUrl: 'https://www.onetcenter.org/database.html',
			occupationCount,
			groupCount,
			jobZoneCount,
			...stats,
			totalNodes: nodes.length,
		},
	});
};
