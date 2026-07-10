'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// groundTruth.js — Ed-Fi crosswalk fixtures + Appendix-B regression constants (Phase 0, deliverable 6).
//
// Loads the two authoritative Ed-Fi->CEDS crosswalk CSVs (Appendix A) and exposes the named
// regression-case constants (Appendix B) as DATA. The crosswalk is the deterministic-track answer key
// (later phases gate 100% reproduction against it); the named cases are the must-pass equivalence
// assertions. The actual gate descriptors live in gates.d/ and import these constants; this module is
// pure data loading + constants (no graph access).
//
// CSV parsing: a small self-contained RFC4180 reader (quoted fields, embedded commas/newlines,
// doubled-quote escapes) — no new dependency, no coupling to a producer's parser.
//
// Pure + synchronous read of fixed asset files. No async/await, no try/catch for control flow. camelCase.
//
// @concept: [[GroundTruthFixtures]]
// @concept: [[EdFiCrosswalk]]
// @concept: [[NamedRegressionCases]]

const path = require('path');
const fs = require('fs');

// --------------------------------------------------------------------------------
// fixture asset paths (code fact — confirmed present this session)
const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const EDFI_ASSET_DIR = path.join(
	findProjectRoot(),
	'code',
	'cli',
	// REORG-REPAIR (Phase 0, supervisor-authorized): parser bundles moved lib.d -> parserLib
	// (reorg pass-1, commit fe76c5d); this consumer was missed. Scaffolding restoration only.
	'parserLib',
	'forge-edfi',
	'assets',
	'standardSourceData',
	'01',
);
const ELEMENTS_CSV = path.join(EDFI_ASSET_DIR, 'EdFiEntityElementsToCEDS.csv');
const DESCRIPTORS_CSV = path.join(EDFI_ASSET_DIR, 'EdFiEntityDescriptorsToCEDS.csv');

// --------------------------------------------------------------------------------
// Appendix B — named regression-case constants (the must-pass equivalence assertions). These are the
// canonical addresses the later phases must materialize. Encoded here as the single source of truth;
// the gates.d/ regression gates read them. Until Phase 3/6 land, the gates that consult these will
// FAIL (no HubReference subgraph yet) — registered + tracked, expected-fail (PLAN §2 task 6).
const NAMED_CASES = {
	studentIdEquivalence: {
		caseName: 'studentId ≡ studentId across standards',
		expectation: 'equivalent',
		qualifierValueKey: 'OV002114100002', // Has Person Identifier Type = Student Identifier
		qualifierLabel: 'Student Identifier',
		baseProperty: 'Person Identifier',
		baseDomain: 'Person Identification',
		sources: ['SIF', 'EdFi'],
	},
	studentVsStaffDistinct: {
		caseName: 'studentId ≠ staffId',
		expectation: 'notEquivalent',
		studentQualifierValueKey: 'OV002114100002', // Student Identifier
		staffQualifierValueKey: 'OV002114100003', // Staff Member Identifier
		baseProperty: 'Person Identifier',
	},
	schoolVsLeaOperationalStatus: {
		caseName: 'School ≠ LEA operational status',
		expectation: 'notEquivalent',
		schoolPropertyKey: 'P000533', // Has School Operational Status / School Operational Detail
		leaPropertyKey: 'P000174', // Has Local Education Agency Operational Status / LEA Operational Detail
	},
	conservativity: {
		caseName: 'conservativity — no source-distinct elements share a cluster',
		expectation: 'noUnexpectedMerge',
		// PINNED RULE (Phase 6, LUNAR_GARDEN 2026-06-30) — generalized to a STRUCTURAL INVARIANT enforced by
		// gate 13: NO source may hold EXACT_MATCH to two HubReferences that share a base property (same
		// propertyKey) but DIFFER in the qualifier (different qualifierKeys). This is the general form of the
		// studentId != staffId thesis (named test: Person Identifier P001572, OV002114100002 vs OV002114100003)
		// and covers every qualifier-distinct identifier pair with no enumerated list. CLOSE_MATCH is never
		// consulted (only exactMatch composes to equivalence).
		rule: 'noSourceExactMatchesTwoSamePropertyDifferentQualifierReferences',
		namedTest: { basePropertyKey: 'P001572', qualifierA: 'OV002114100002', qualifierB: 'OV002114100003' },
		// DIFFERENT-PROPERTY pairs are NOT enforced. The candidate School-op-status (P000533) vs LEA-op-status
		// (P000174) was investigated and judged NOT must-never-merge: the abstract Ed-Fi EducationOrganization
		// SUPERTYPE field legitimately crosswalks to BOTH concrete subtype properties, and no two DISTINCT
		// concrete sources are equated. Appendix-B #3 distinctness is enforced by gate 12 (distinct references).
		differentPropertyNotEnforced: { schoolPropertyKey: 'P000533', leaPropertyKey: 'P000174', verdict: 'legitimateSupertypeBridge' },
		// BOUNDARY: complete only while equivalence stays NON-TRANSITIVE + SINGLE-HUB. Cross-hub equivalence
		// (WHITEPAPER §4.7) requires the guard to be re-derived. Carried to the cross-hub phase.
	},
};

// --------------------------------------------------------------------------------
// minimal RFC4180 CSV reader
const parseCsv = (text) => {
	const rows = [];
	let row = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
			continue;
		}
		if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (c === '\r') {
			// skip CR (CRLF normalization)
		} else {
			field += c;
		}
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
};

// rows[0] is the header; map each later row to an object keyed by header column.
const toObjects = (rows) => {
	if (!rows.length) return { header: [], records: [] };
	const header = rows[0];
	const records = rows.slice(1).map((oneRow) => {
		const obj = {};
		header.forEach((col, idx) => {
			obj[col] = oneRow[idx] !== undefined ? oneRow[idx] : '';
		});
		return obj;
	});
	return { header, records };
};

const moduleFunction = ({ moduleName } = {}) => () => {
	// loadFixtures() -> { elements:{path,header,records}, descriptors:{...}, present:bool }
	// synchronous; fixture files are fixed assets. Fails LOUD (throws) on a missing fixture, since a
	// proving apparatus without its ground truth is a hard configuration error, not a soft path.
	const loadFixtures = () => {
		const elementsRaw = fs.readFileSync(ELEMENTS_CSV, 'utf8');
		const descriptorsRaw = fs.readFileSync(DESCRIPTORS_CSV, 'utf8');
		const elements = toObjects(parseCsv(elementsRaw));
		const descriptors = toObjects(parseCsv(descriptorsRaw));
		return {
			present: true,
			elements: {
				path: ELEMENTS_CSV,
				header: elements.header,
				recordCount: elements.records.length,
				records: elements.records,
			},
			descriptors: {
				path: DESCRIPTORS_CSV,
				header: descriptors.header,
				recordCount: descriptors.records.length,
				records: descriptors.records,
			},
		};
	};

	// positiveCrosswalkRows() -> the deterministic-track positives (CEDSMappingConfidence === 'Yes').
	// The later phases gate 100% reproduction of these; here it is just the loaded answer key.
	const positiveCrosswalkRows = () => {
		const { elements } = loadFixtures();
		const confidenceCol = elements.header.find(
			(c) => /CEDSMappingConfidence/i.test(c) || /MappingConfidence/i.test(c),
		);
		if (!confidenceCol) {
			return { confidenceColumn: null, positives: [], note: 'no confidence column found' };
		}
		const positives = elements.records.filter(
			(r) => `${r[confidenceCol]}`.trim().toLowerCase() === 'yes',
		);
		return { confidenceColumn: confidenceCol, positives };
	};

	return {
		loadFixtures,
		positiveCrosswalkRows,
		NAMED_CASES,
		paths: { ELEMENTS_CSV, DESCRIPTORS_CSV, EDFI_ASSET_DIR },
	};
};

module.exports = moduleFunction({ moduleName });
