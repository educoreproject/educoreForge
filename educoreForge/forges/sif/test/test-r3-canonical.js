#!/usr/bin/env node
'use strict';

// test-r3-canonical.js — Phase-III R3 gate for the SIF forge (DECISIONS §23-R3/R4). ALL PURE: no
// Voyage embedding call, no Neo4j, no golden touch — it exercises normalize + buildContractGraph
// (and forge() with skipEmbedding=true over the REAL asset) and asserts that, whatever the native
// SIF input form, the emitted node's stableId + canonical CEDS cross-ref conform to clean canonical
// forms BEFORE emission, searchText is non-empty, edges are canonical + fully resolved, and the
// shaping is deterministic. A normalization miss surfaces as a FAILURE, never a silent missed mapping.
//
// Run: node cli/lib.d/forge-sif/test/test-r3-canonical.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// minimal process.global for the bundle factory (xLog only; no embedder needed for the pure layer).
process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (m) => console.error(m),
	result: () => {},
	verbose: () => {},
};

const normalize = require('../lib/normalize');
const bundle = require('../forgeSif')({ embedder: null });

let pass = 0;
let fail = 0;
const check = (label, cond) => {
	if (cond) {
		pass++;
		// console.log(`  ok  ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};

// =====================================================================
// 1. normalize unit asserts — canonical forms from varied native inputs (R3 independent of live data)
// =====================================================================

check('buildStableId root -> sif:root', normalize.buildStableId({ kind: 'root' }).stableId === 'sif:root');
check(
	'buildStableId object -> sif:object/<tableName>',
	normalize.buildStableId({ kind: 'object', key: 'StudentPersonals' }).stableId === 'sif:object/StudentPersonals',
);
check(
	'buildStableId field keeps xpath slashes',
	normalize.buildStableId({ kind: 'field', key: 'StudentPersonal/Name/FirstName' }).stableId ===
		'sif:field/StudentPersonal/Name/FirstName',
);
check(
	'buildStableId optionValue keeps fingerprint/value',
	normalize.buildStableId({ kind: 'optionValue', key: 'A|B|C/United States' }).stableId ===
		'sif:optionValue/A|B|C/United States',
);
check('buildStableId empty key -> error', !!normalize.buildStableId({ kind: 'object', key: '   ' }).error);
check('buildStableId unknown kind -> error', !!normalize.buildStableId({ kind: 'bogus', key: 'x' }).error);

check('isCleanStableId accepts sif:root', normalize.isCleanStableId('sif:root'));
check('isCleanStableId accepts sif:field/<xpath>', normalize.isCleanStableId('sif:field/A/B/C'));
check('isCleanStableId accepts value with spaces', normalize.isCleanStableId('sif:optionValue/fp/United States'));
check('isCleanStableId rejects empty', !normalize.isCleanStableId(''));
check('isCleanStableId rejects non-sif', !normalize.isCleanStableId('ceds:C000113'));
check('isCleanStableId rejects whitespace-padded', !normalize.isCleanStableId(' sif:root '));

// CEDS cross-ref canonicalization: bare number, zero-padded number, all -> P######
check("normalizeCedsCrossRef('534') -> P000534", normalize.normalizeCedsCrossRef({ rawValue: '534' }).cedsId === 'P000534');
check("normalizeCedsCrossRef('000534') -> P000534", normalize.normalizeCedsCrossRef({ rawValue: '000534' }).cedsId === 'P000534');
check("normalizeCedsCrossRef(534 number) -> P000534", normalize.normalizeCedsCrossRef({ rawValue: 534 }).cedsId === 'P000534');
check("normalizeCedsCrossRef('CEDS ID') -> error (no digits)", !!normalize.normalizeCedsCrossRef({ rawValue: 'CEDS ID' }).error);
check("normalizeCedsCrossRef('') -> error", !!normalize.normalizeCedsCrossRef({ rawValue: '' }).error);
check('isCanonicalCrossRefCedsId(P000534)', normalize.isCanonicalCrossRefCedsId('P000534'));
check('isCanonicalCrossRefCedsId rejects 000534', !normalize.isCanonicalCrossRefCedsId('000534'));
check('isCanonicalCrossRefCedsId rejects C000534', !normalize.isCanonicalCrossRefCedsId('C000534'));

// =====================================================================
// 2. buildContractGraph on a SYNTHETIC native parse — assert the universal contract shaping
// =====================================================================

const syntheticParsed = {
	metadata: { version: '1.0', sourceFormat: 'tsv', objectCount: 1, fieldCount: 2 },
	nodes: [
		{ id: 'sif-root', label: 'SifRoot', properties: { name: 'SIF' }, edges: [] },
		{
			id: 'sifobject-StudentPersonals',
			label: 'SifObject',
			properties: { name: 'StudentPersonal', tableName: 'StudentPersonals', fieldCount: 2 },
			edges: [{ type: 'USES_COMPLEX_TYPE', targetId: 'complextype-Name', targetLabel: 'SifComplexType' }],
		},
		{ id: 'complextype-Name', label: 'SifComplexType', properties: { name: 'Name', fieldCount: 1 }, edges: [] },
		{ id: 'complextype-Empty', label: 'SifComplexType', properties: { name: 'EmptyScaffold', fieldCount: 0 }, edges: [] },
		{
			id: 'siffield-StudentPersonal/Name/FirstName',
			label: 'SifField',
			properties: {
				name: 'FirstName',
				xpath: 'StudentPersonal/Name/FirstName',
				cedsId: '000534',
				mandatory: true,
				description: 'the first name',
			},
			edges: [
				{ type: 'CONSTRAINED_BY', targetId: 'codeset-fp1', targetLabel: 'SifCodeset' },
				{ type: 'MEMBER_OF', targetId: 'complextype-Name', targetLabel: 'SifComplexType' },
			],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		{
			id: 'siffield-StudentPersonal/LastName',
			label: 'SifField',
			properties: { name: 'LastName', xpath: 'StudentPersonal/LastName', mandatory: false, description: '' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		{
			id: 'codeset-fp1',
			label: 'SifCodeset',
			properties: { name: 'A, B, C', fingerprint: 'A|B|C', valueCount: 3, values: ['A', 'B', 'C'] },
			edges: [],
		},
		{ id: 'simpletype-xsd:string', label: 'SifSimpleType', properties: { name: 'xsd:string', category: 'simple' }, edges: [] },
	],
};

const g = bundle.buildContractGraph(syntheticParsed);
const byRole = (role) => g.nodes.filter((n) => n.role === role);
const allEdgeTypes = new Set(g.edges.map((e) => e.type));

check('exactly one DmeStandardRoot', byRole('DmeStandardRoot').length === 1);
check('two DmeClass (object + 2 complexTypes = 3)', byRole('DmeClass').length === 3);
check('two DmeProperty (fields)', byRole('DmeProperty').length === 2);
check('one DmeOptionSet (codeset)', byRole('DmeOptionSet').length === 1);
check('three DmeOptionValue (expanded A/B/C)', byRole('DmeOptionValue').length === 3);
check('one DmeSupport (simpleType)', byRole('DmeSupport').length === 1);

check('every node has clean stableId', g.nodes.every((n) => normalize.isCleanStableId(n.stableId)));
check('every node _source === SIF', g.nodes.every((n) => n.properties._source === 'SIF'));
check('every node has non-empty searchText', g.nodes.every((n) => typeof n.properties.searchText === 'string' && n.properties.searchText.length > 0));
check('every node _id === stableId', g.nodes.every((n) => n.properties._id === n.stableId));
check('every node carries sifStableId === stableId', g.nodes.every((n) => n.properties.sifStableId === n.stableId));
check('structural nodes carry parentId/depth/path', g.nodes.filter((n) => n.role !== 'DmeStandardRoot').every((n) => n.properties.parentId && typeof n.properties.depth === 'number' && n.properties.path));
check('no snake_case property names', g.nodes.every((n) => Object.keys(n.properties).every((k) => !/[a-z]_[a-z]/.test(k))));

// the annotated field carries canonical cedsId + crossRefs; the un-annotated one does not.
const annotated = g.nodes.find((n) => n.stableId === 'sif:field/StudentPersonal/Name/FirstName');
const unAnnotated = g.nodes.find((n) => n.stableId === 'sif:field/StudentPersonal/LastName');
check('annotated field cedsId === P000534', annotated && annotated.properties.cedsId === 'P000534');
check('annotated field cedsId is canonical', annotated && normalize.isCanonicalCrossRefCedsId(annotated.properties.cedsId));
check('annotated field crossRefs JSON carries the ceds ref', annotated && JSON.parse(annotated.properties.crossRefs)[0].id === 'P000534');
check('annotated field crossRefs retains raw form', annotated && JSON.parse(annotated.properties.crossRefs)[0].raw === '000534');
check('un-annotated field has no cedsId', unAnnotated && unAnnotated.properties.cedsId === undefined);
check('un-annotated field crossRefs === []', unAnnotated && unAnnotated.properties.crossRefs === '[]');
check('DmeProperty searchText carries owning class name', annotated && annotated.properties.searchText.includes('StudentPersonal'));

// edges: only canonical/REFERENCES types, all structural, all resolved (no throw means no danglers).
const ALLOWED_EDGE_TYPES = new Set(['HAS_CLASS', 'HAS_PROPERTY', 'HAS_OPTION_SET', 'HAS_VALUE', 'HAS_SUPPORT', 'REFERENCES']);
check('only canonical/REFERENCES edge types', [...allEdgeTypes].every((t) => ALLOWED_EDGE_TYPES.has(t)));
check('every edge provenanceTier === structural', g.edges.every((e) => e.properties.provenanceTier === 'structural'));
check('HAS_CLASS root->object present', g.edges.some((e) => e.type === 'HAS_CLASS' && e.fromRef.id === 'sif:root' && e.toRef.id === 'sif:object/StudentPersonals'));
check('HAS_PROPERTY object->field present', g.edges.some((e) => e.type === 'HAS_PROPERTY' && e.fromRef.id === 'sif:object/StudentPersonals' && e.toRef.id === 'sif:field/StudentPersonal/Name/FirstName'));
check('HAS_OPTION_SET field->codeset present', g.edges.some((e) => e.type === 'HAS_OPTION_SET' && e.toRef.id === 'sif:codeset/A|B|C'));
check('HAS_VALUE codeset->value present', g.edges.some((e) => e.type === 'HAS_VALUE' && e.fromRef.id === 'sif:codeset/A|B|C'));
check('HAS_SUPPORT root->simpleType present', g.edges.some((e) => e.type === 'HAS_SUPPORT' && e.toRef.id === 'sif:simpleType/xsd:string'));
check('USES_COMPLEX_TYPE translated to REFERENCES', g.edges.some((e) => e.type === 'REFERENCES' && e.toRef.id === 'sif:complexType/Name'));

check('stats.fieldlessComplexTypes === 1', g.stats.fieldlessComplexTypes === 1);
check('stats.crossRefsAnnotated === 1', g.stats.crossRefsAnnotated === 1);
check('stats.optionValuesExpanded === 3', g.stats.optionValuesExpanded === 3);
check('stats.danglingEdges empty', g.stats.danglingEdges.length === 0);

// determinism: same input -> identical node/edge counts + identical serialized shape (minus embedding).
const g2 = bundle.buildContractGraph(syntheticParsed);
const strip = (graph) => JSON.stringify({
	nodes: graph.nodes.map((n) => ({ s: n.stableId, r: n.role, l: n.labels, p: { ...n.properties, ingestedAt: undefined } })),
	edges: graph.edges,
});
check('buildContractGraph is deterministic (modulo ingestedAt)', strip(g) === strip(g2));

// a present-but-unnormalizable CEDS annotation MUST throw (R3 — never silently dropped).
const badParsed = JSON.parse(JSON.stringify(syntheticParsed));
badParsed.nodes.find((n) => n.id === 'siffield-StudentPersonal/Name/FirstName').properties.cedsId = 'not-a-number';
let threw = false;
try {
	bundle.buildContractGraph(badParsed);
} catch (e) {
	threw = true;
}
check('unnormalizable cedsId throws (R3 surfaced)', threw);

// =====================================================================
// 2.5 PHASE-1 FORGE-AUDIT GATES (RT-2 / RT-3, campaign forge-sif Phase 1) — refusal-by-name and
//     source-integrity verification at consumption. Every fixture is a TEMP COPY under os.tmpdir();
//     the committed snapshot is never touched. The skipEmbedding forge path is fully synchronous
//     (pesc Phase 1 lesson), so these run inline before the section-3 real-data pass.
// =====================================================================

const snapshotDir = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const LITERAL_COLUMN_HEADER = ['Name', 'Mandatory', 'Characteristics', 'Type', 'Description', 'XPath', 'CEDS ID', 'Format'].join('\t');

const makeScratchSnapshotCopy = (label) => {
	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), `sifPhase1Gates-${label}-`));
	fs.readdirSync(snapshotDir).forEach((oneName) => {
		const sourceFilePath = path.join(snapshotDir, oneName);
		if (fs.statSync(sourceFilePath).isFile()) {
			fs.copyFileSync(sourceFilePath, path.join(scratchDir, oneName));
		}
	});
	return scratchDir;
};

// recompute SHA256SUMS entries for the files actually present in a scratch dir — used by fixtures
// that deliberately mutate a source file but must PASS checksum verification so a DEEPER refusal
// (header row, name coverage) is the one observed firing.
const rewriteScratchChecksums = (scratchDir) => {
	const sumLines = fs
		.readdirSync(scratchDir)
		.filter((oneName) => oneName.endsWith('.tsv'))
		.sort()
		.map((oneName) => {
			const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(scratchDir, oneName))).digest('hex');
			return `${digest}  ${oneName}`;
		});
	fs.writeFileSync(path.join(scratchDir, 'SHA256SUMS'), sumLines.join('\n') + '\n');
};

const forgeExpectingRefusal = (label, sourcePath, requiredSubstrings) => {
	let sawError = '';
	bundle.forge({ sourcePath, skipEmbedding: true }, (err) => {
		sawError = err || '';
	});
	check(`rt3: ${label} refuses`, !!sawError);
	requiredSubstrings.forEach((oneSubstring) => {
		check(`rt3: ${label} refusal names '${oneSubstring}'`, String(sawError).includes(oneSubstring));
	});
};

// gate: missing SHA256SUMS refuses by name (never a silent unverified parse)
{
	const scratchDir = makeScratchSnapshotCopy('missingSums');
	fs.unlinkSync(path.join(scratchDir, 'SHA256SUMS'));
	forgeExpectingRefusal('missing SHA256SUMS', scratchDir, ['SHA256SUMS', 'README_PROVENANCE.md']);
}

// gate: corrupted source bytes (checksum mismatch) refuse by name
{
	const scratchDir = makeScratchSnapshotCopy('corruptTsv');
	fs.appendFileSync(path.join(scratchDir, 'ImplementationSpecification_031326.tsv'), '\ncorruptionByte\n');
	forgeExpectingRefusal('corrupted source (checksum mismatch)', scratchDir, [
		'ImplementationSpecification_031326.tsv',
		'SHA256',
		'README_PROVENANCE.md',
	]);
}

// gate: an unlisted .tsv candidate refuses by name (an unprovenance'd source is never parsed)
{
	const scratchDir = makeScratchSnapshotCopy('unlisted');
	fs.writeFileSync(path.join(scratchDir, 'StrayExtra.tsv'), 'strayContent\n');
	forgeExpectingRefusal('unlisted .tsv present', scratchDir, ['StrayExtra.tsv', 'SHA256SUMS', 'README_PROVENANCE.md']);
}

// gate: listed-but-absent source file refuses by name (directory mode; checksum verification fires
// before candidate selection, so the absence is named as a provenance violation)
{
	const scratchDir = makeScratchSnapshotCopy('listedAbsent');
	fs.unlinkSync(path.join(scratchDir, 'refIdResolutionMap.tsv'));
	forgeExpectingRefusal('listed-but-absent source file', scratchDir, ['refIdResolutionMap.tsv', 'README_PROVENANCE.md']);
}

// gate: missing refIdResolutionMap.tsv refuses by name in FILE mode too (the loadResolutionMap
// seam itself — the incumbent WARNED AND CONTINUED, silently degrading every curated resolution)
{
	const scratchDir = makeScratchSnapshotCopy('fileModeNoMap');
	fs.unlinkSync(path.join(scratchDir, 'refIdResolutionMap.tsv'));
	forgeExpectingRefusal(
		'missing refIdResolutionMap.tsv (file mode)',
		path.join(scratchDir, 'ImplementationSpecification_031326.tsv'),
		['refIdResolutionMap.tsv', 'README_PROVENANCE.md'],
	);
}

// gate: a table header not followed by the literal 8-column header row refuses by name (the
// incumbent swallowed that line UNEXAMINED — a missing header row silently ate a data row).
// SHA256SUMS is rewritten to match the mutated bytes, so the header refusal — not the checksum
// refusal — is the one proven firing.
{
	const scratchDir = makeScratchSnapshotCopy('badHeader');
	const scratchTsvPath = path.join(scratchDir, 'ImplementationSpecification_031326.tsv');
	const scratchContent = fs.readFileSync(scratchTsvPath, 'utf8');
	fs.writeFileSync(scratchTsvPath, scratchContent.replace(LITERAL_COLUMN_HEADER, 'CORRUPTED_HEADER_ROW'));
	rewriteScratchChecksums(scratchDir);
	forgeExpectingRefusal('corrupted column-header row', scratchDir, ['AccountingPeriods', 'column-header']);
}

// gates: object-name coverage refusals — the source states each object's element name in its field
// xpaths (second segment); NO stated name and CONFLICTING stated names each refuse rather than guess.
const RESOLUTION_MAP_HEADER = 'refIdProperty\tinferredTarget\tresolvedTable\tresolutionMethod\tnotes\n';
{
	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sifPhase1Gates-conflictingName-'));
	fs.writeFileSync(
		path.join(scratchDir, 'ImplementationSpecification_test.tsv'),
		'Widgets: Table 1\n' +
			LITERAL_COLUMN_HEADER + '\n' +
			'@RefId\t*\t\tRefIdType\tThe id.\t/Widgets/Widget/@RefId\t\t\n' +
			'Name\t*\t\tNameType\tThe name.\t/Widgets/Gizmo/Name\t\t\n',
	);
	fs.writeFileSync(path.join(scratchDir, 'refIdResolutionMap.tsv'), RESOLUTION_MAP_HEADER);
	rewriteScratchChecksums(scratchDir);
	forgeExpectingRefusal('conflicting xpath-stated element names', scratchDir, ['Widgets', 'conflicting']);
}
{
	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sifPhase1Gates-noStatedName-'));
	fs.writeFileSync(
		path.join(scratchDir, 'ImplementationSpecification_test.tsv'),
		'Widgets: Table 1\n' +
			LITERAL_COLUMN_HEADER + '\n' +
			'SomeField\t\t\tStringType\tA field with no xpath.\t\t\t\n',
	);
	fs.writeFileSync(path.join(scratchDir, 'refIdResolutionMap.tsv'), RESOLUTION_MAP_HEADER);
	rewriteScratchChecksums(scratchDir);
	forgeExpectingRefusal('no xpath-stated element name', scratchDir, ['no xpath-stated']);
}

// control gate (positive twin, green by design): an INTACT scratch copy still forges — the
// refusals above are named refusals, not over-refusal of healthy source.
let controlNodeCount = 0;
{
	const scratchDir = makeScratchSnapshotCopy('intactControl');
	bundle.forge({ sourcePath: scratchDir, skipEmbedding: true }, (err, result) => {
		check('rt3 control: intact scratch copy still forges (no over-refusal)', !err);
		controlNodeCount = result ? result.nodes.length : 0;
	});
}

// =====================================================================
// 3. REAL-DATA run via forge({skipEmbedding:true}) — full contract over the actual SIF asset.
//    No Voyage, no Neo4j (skipEmbedding). Doubles as the no-cost dry-count for the Gate-A report.
// =====================================================================

const assetDir = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
bundle.forge({ sourcePath: assetDir, skipEmbedding: true }, (err, result) => {
	if (err) {
		console.error(`  FAIL  real-data forge errored: ${err}`);
		fail++;
		finish();
		return;
	}
	const nodes = result.nodes;
	const edges = result.edges;
	const roleCount = {};
	nodes.forEach((n) => { roleCount[n.role] = (roleCount[n.role] || 0) + 1; });
	const edgeCount = {};
	edges.forEach((e) => { edgeCount[e.type] = (edgeCount[e.type] || 0) + 1; });

	check('real: exactly one DmeStandardRoot', roleCount.DmeStandardRoot === 1);
	check('real: has DmeClass nodes', (roleCount.DmeClass || 0) > 0);
	check('real: has DmeProperty nodes', (roleCount.DmeProperty || 0) > 0);
	check('real: every node clean stableId', nodes.every((n) => normalize.isCleanStableId(n.stableId)));
	check('real: every node _source === SIF', nodes.every((n) => n.properties._source === 'SIF'));
	check('real: every node non-empty searchText', nodes.every((n) => n.properties.searchText && n.properties.searchText.length > 0));
	check('real: every node carries sifStableId', nodes.every((n) => n.properties.sifStableId === n.stableId));
	check('real: stableIds unique', new Set(nodes.map((n) => n.stableId)).size === nodes.length);
	check('real: every annotated field cedsId canonical', nodes.filter((n) => n.properties.cedsId).every((n) => normalize.isCanonicalCrossRefCedsId(n.properties.cedsId)));
	check('real: only canonical/REFERENCES edges', Object.keys(edgeCount).every((t) => ALLOWED_EDGE_TYPES.has(t)));
	check('real: every edge structural provenanceTier', edges.every((e) => e.properties.provenanceTier === 'structural'));
	check('real: no embedding stamped (skipEmbedding)', nodes.every((n) => n.properties.embedding === undefined));

	// ===== PHASE-1 FORGE-AUDIT real-data gates (RT-2 absent-is-absent) =====

	// no fabricated placeholder descriptions anywhere in the block. Patterns are colon-anchored to
	// the exact synthesized templates — the one REAL source description beginning 'SIF object
	// referenced by…' (Billings.@SIF_RefObject) carries no colon and must never be caught.
	const placeholderPatterns = [
		/^SIF primitive type: /,
		/^SIF simple type: /,
		/^SIF codeset: /,
		/^SIF complex type: /,
		/^SIF object: /,
		/^SIF field: /,
		/^SIF XML element: /,
	];
	const placeholderCarriers = nodes.filter(
		(n) => n.role !== 'DmeStandardRoot' && placeholderPatterns.some((p) => p.test(n.properties.description)),
	);
	check(`real: no fabricated placeholder descriptions (found ${placeholderCarriers.length})`, placeholderCarriers.length === 0);

	// absent source documentation emits the contract-uniform '' — the 4,733 fields whose source
	// Description cell is empty (measured against the snapshot-01 TSV) carry '' exactly.
	const emptyDescriptionFieldCount = nodes.filter((n) => n.role === 'DmeProperty' && n.properties.description === '').length;
	check(`real: absent source descriptions emit '' on exactly 4733 fields (found ${emptyDescriptionFieldCount})`, emptyDescriptionFieldCount === 4733);

	// object names are the SOURCE-STATED element names (xpath second segment) — the 4 sheet-name
	// truncation artifacts (~31-char Excel sheet-name limit) are corrected…
	const objectNodes = nodes.filter((n) => n.labels.includes('SifObject'));
	const correctedNames = [
		'FinancialAccountAccountingPeriodLocationInfo',
		'FoodserviceStudentEnrollmentCount',
		'ProfessionalDevelopmentActivities',
		'ProfessionalDevelopmentRegistration',
	];
	check(
		'real: the 4 truncation-corrected object names are present (xpath-stated)',
		correctedNames.every((oneName) => objectNodes.some((o) => o.properties.name === oneName)),
	);
	const truncatedGuesses = [
		'FinancialAccountAccountingPerio',
		'FoodserviceStudentEnrollmentCou',
		'ProfessionalDevelopmentActiviti',
		'ProfessionalDevelopmentRegistra',
	];
	check(
		'real: no object name is a truncated strip-s guess',
		truncatedGuesses.every((oneBadName) => !objectNodes.some((o) => o.properties.name === oneBadName)),
	);
	// …while tableName preserves the sheet name VERBATIM (source statement, stableId natural key).
	check(
		'real: truncated sheet names preserved verbatim in tableName (stableIds unchanged)',
		objectNodes.some((o) => o.properties.tableName === 'FinancialAccountAccountingPerio'),
	);
	// total closure: EVERY object's name equals the second non-empty xpath segment of every one of
	// its own fields (independent derivation — the same probe test-sequence-ordinal uses).
	const objectByStableId = {};
	objectNodes.forEach((o) => {
		objectByStableId[o.stableId] = o;
	});
	const nameClosureViolation = nodes
		.filter((n) => n.role === 'DmeProperty' && objectByStableId[n.properties.parentId])
		.find((n) => {
			const statedSingular = (n.properties.xpath || '').split('/').filter(Boolean)[1];
			return statedSingular && objectByStableId[n.properties.parentId].properties.name !== statedSingular;
		});
	check(
		`real: EVERY object name matches its own fields' xpath-stated element name (violation: ${nameClosureViolation ? nameClosureViolation.properties.xpath : 'none'})`,
		!nameClosureViolation,
	);

	// parseAudit — the silent paths made visible (digest-excluded run diagnostics on stats)
	const parseAudit = result.stats.parseAudit;
	check('real: parseAudit present on stats', !!parseAudit);
	check(
		'real: refId resolution path census matches snapshot 01 (manual 200, unresolvable 14, naivePlural 407, others 0)',
		!!parseAudit &&
			parseAudit.resolutionPaths.manual === 200 &&
			parseAudit.resolutionPaths.manualUnresolvable === 14 &&
			parseAudit.resolutionPaths.naivePlural === 407 &&
			parseAudit.resolutionPaths.lowercasePlural === 0 &&
			parseAudit.resolutionPaths.suffixInfos === 0 &&
			parseAudit.resolutionPaths.suffixPersonals === 0 &&
			parseAudit.resolutionPaths.suffixItems === 0,
	);
	check('real: zero unresolved refIds on snapshot 01 (every one would be recorded, never silent)', !!parseAudit && parseAudit.unresolvedRefIds.length === 0);
	check('real: zero curated-map targets absent from source', !!parseAudit && parseAudit.manualTargetsAbsentFromSource.length === 0);
	check('real: zero block-level reference edge drops', !!parseAudit && parseAudit.referenceEdgeDrops.length === 0);
	check('real: format quote-strip canonicalization counted (1495 on snapshot 01)', !!parseAudit && parseAudit.formatQuoteStripCount === 1495);
	check('real: all 159 column-header rows verified', !!parseAudit && parseAudit.columnHeadersVerified === 159);
	check('real: zero empty-name rows skipped (counted, never silent)', !!parseAudit && parseAudit.emptyNameRowsSkipped === 0);
	check(
		'real: leaf-link skips counted (2684 non-leaf REALIZED_BY candidates on snapshot 01 — leaves-only is the documented design)',
		!!parseAudit && parseAudit.leafLinkSkips === 2684,
	);

	// intact-control equality: the scratch-copy control run and the committed asset agree.
	check('rt3 control: intact-copy forge matches committed-asset node count', controlNodeCount === nodes.length);

	console.log('\n=== SIF REAL-DATA DRY COUNT (no embedding) ===');
	console.log(`nodes: ${nodes.length}  edges: ${edges.length}`);
	console.log('by role:', JSON.stringify(roleCount));
	console.log('by edge type:', JSON.stringify(edgeCount));
	console.log('stats:', JSON.stringify({
		crossRefsAnnotated: result.stats.crossRefsAnnotated,
		fieldlessComplexTypes: result.stats.fieldlessComplexTypes,
		optionValuesExpanded: result.stats.optionValuesExpanded,
		codesetUnique: result.stats.codesetUnique,
		codesetAssignments: result.stats.codesetAssignments,
		codesetMerged: result.stats.codesetAssignments - result.stats.codesetUnique,
		danglingEdges: result.stats.danglingEdges.length,
	}));
	finish();
});

function finish() {
	console.log(`\n=== R3 RESULT: ${pass} passed, ${fail} failed ===`);
	process.exit(fail === 0 ? 0 : 1);
}
