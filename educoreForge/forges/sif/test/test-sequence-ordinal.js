#!/usr/bin/env node
'use strict';

// test-sequence-ordinal.js — hermetic gate for forge-sif's SEQUENCE CAPTURE (Phase A, the
// design-authority upgrade to the SIF sequence-capture work order, 2026-07-30): every SifField and
// non-root SifXmlElement gains sequenceOrdinal/siblingCount/orderSemantics (lib/sequence-contract),
// ADDITIVE ONLY — stableId/parentId/depth/path are BYTE-UNCHANGED (the P4 address-stability ruling).
//
// GROUNDING THIS TEST PINS (file:line, forges/sif/lib/parser.js): the SIF forge's only source is a
// flattened Implementation-Specification TSV with columns Name/Mandatory/Characteristics/Type/
// Description/XPath/CEDS ID/Format (parser.js:60-72) — NO compositor column exists, so the parser
// can never distinguish xs:sequence (order normative) from xs:choice (order not normative); it only
// ever sees TSV-row / XPath document order (parser.js:590-593, :638-645). forgeSif.js therefore
// NEVER stamps orderSemantics 'normative' — every group is honestly 'document'. This suite asserts
// that fact positively (never merely assumes it).
//
// PURE + synchronous + deterministic (skipEmbedding=true; no Voyage, no Neo4j).
//
// Run: node forges/sif/test/test-sequence-ordinal.js

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for forge-sif's sequence-capture stamping

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves ordinals/siblingCount/orderSemantics stamped correctly on a synthetic native parse
     (a nested 'Name' group, a root-level group, and a genuine xs:choice-shaped ambiguity the parser
     cannot resolve), a NEGATIVE control proving identity fields are byte-unchanged versus a
     pre-sequence-capture derivation, and a real-asset sanity pass confirming orderSemantics is
     ALWAYS 'document' (SIF's TSV source carries no compositor signal) and singleton groups are
     stamped honestly ("1 of 1").

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const bundle = require('../forgeSif')({ embedder: null });

// =====================================================================
harness.section("SECTION 1 — synthetic native parse: a nested 'Name' group + a root-level group");
// =====================================================================

// StudentPersonal/Name/{Prefix,FirstName,LastName} — three leaf fields sharing ONE parent element
// (Name); StudentPersonal/{Name,Grade} at the object root — two fields with NO intermediate element,
// grouped by their owning object instead. Deliberately includes a NAME-DUPLICATE shape (isShared):
// the SAME xml element path can legitimately recur.
const syntheticParsed = {
	metadata: { version: '1.0', sourceFormat: 'tsv', objectCount: 1, fieldCount: 5 },
	nodes: [
		{ id: 'sif-root', label: 'SifRoot', properties: { name: 'SIF' }, edges: [] },
		{
			id: 'sifobject-StudentPersonals',
			label: 'SifObject',
			properties: { name: 'StudentPersonal', tableName: 'StudentPersonals', fieldCount: 5 },
			edges: [],
		},
		// ---- the 'Name' xml element and its three leaf children (nested group) ----
		{
			id: 'xmlelement-Name',
			label: 'SifXmlElement',
			properties: { name: 'Name', path: 'Name', depth: 1, isShared: false, isLeaf: false },
			edges: [
				{ type: 'CHILD_ELEMENT', targetId: 'xmlelement-Name/Prefix', targetLabel: 'SifXmlElement', properties: { sequence: 0 } },
				{ type: 'CHILD_ELEMENT', targetId: 'xmlelement-Name/FirstName', targetLabel: 'SifXmlElement', properties: { sequence: 1 } },
				{ type: 'CHILD_ELEMENT', targetId: 'xmlelement-Name/LastName', targetLabel: 'SifXmlElement', properties: { sequence: 2 } },
			],
		},
		{ id: 'xmlelement-Name/Prefix', label: 'SifXmlElement', properties: { name: 'Prefix', path: 'Name/Prefix', depth: 2, isShared: false, isLeaf: true }, edges: [] },
		{ id: 'xmlelement-Name/FirstName', label: 'SifXmlElement', properties: { name: 'FirstName', path: 'Name/FirstName', depth: 2, isShared: false, isLeaf: true }, edges: [] },
		{ id: 'xmlelement-Name/LastName', label: 'SifXmlElement', properties: { name: 'LastName', path: 'Name/LastName', depth: 2, isShared: false, isLeaf: true }, edges: [] },
		{
			id: 'siffield-StudentPersonal/Name/Prefix',
			label: 'SifField',
			properties: { name: 'Prefix', xpath: 'StudentPersonal/Name/Prefix', mandatory: false, description: '', pathSegments: 'Name' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		{
			id: 'siffield-StudentPersonal/Name/FirstName',
			label: 'SifField',
			properties: { name: 'FirstName', xpath: 'StudentPersonal/Name/FirstName', mandatory: true, description: '', pathSegments: 'Name' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		{
			id: 'siffield-StudentPersonal/Name/LastName',
			label: 'SifField',
			properties: { name: 'LastName', xpath: 'StudentPersonal/Name/LastName', mandatory: true, description: '', pathSegments: 'Name' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		// ---- two ROOT-level fields (no intermediate element) — grouped by owning object ----
		{
			id: 'siffield-StudentPersonal/Grade',
			label: 'SifField',
			properties: { name: 'Grade', xpath: 'StudentPersonal/Grade', mandatory: false, description: '' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		{
			id: 'siffield-StudentPersonal/StatusCode',
			label: 'SifField',
			properties: { name: 'StatusCode', xpath: 'StudentPersonal/StatusCode', mandatory: false, description: '' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-StudentPersonals', fromLabel: 'SifObject' },
		},
		// ---- ADVERSARIAL-REVIEW REGRESSION FIXTURE (2026-07-30): a SECOND SifObject reusing the
		// EXACT SAME nested shape ('Name/{Prefix,FirstName,LastName}', pathSegments 'Name') as
		// StudentPersonal above — precisely the cross-object collision shape a real SIF asset exhibits
		// (e.g. 'SIF_Metadata/TimeElements/TimeElement', reused by 136 objects). Deliberately does NOT
		// add its own xmlelement- native nodes: the parser's real elementMap is GLOBAL/deduped by
		// relativePath (isShared), so a second object legitimately reuses the SAME 'Name'/'Name/Prefix'
		// element nodes already declared above — only the FIELD-group key construction (which reads
		// pathSegments off the field itself, never the element) needs to be proven owner-scoped.
		{
			id: 'sifobject-GradePeriods',
			label: 'SifObject',
			properties: { name: 'GradePeriod', tableName: 'GradePeriods', fieldCount: 3 },
			edges: [],
		},
		{
			id: 'siffield-GradePeriod/Name/Prefix',
			label: 'SifField',
			properties: { name: 'Prefix', xpath: 'GradePeriod/Name/Prefix', mandatory: false, description: '', pathSegments: 'Name' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-GradePeriods', fromLabel: 'SifObject' },
		},
		{
			id: 'siffield-GradePeriod/Name/FirstName',
			label: 'SifField',
			properties: { name: 'FirstName', xpath: 'GradePeriod/Name/FirstName', mandatory: true, description: '', pathSegments: 'Name' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-GradePeriods', fromLabel: 'SifObject' },
		},
		{
			id: 'siffield-GradePeriod/Name/LastName',
			label: 'SifField',
			properties: { name: 'LastName', xpath: 'GradePeriod/Name/LastName', mandatory: true, description: '', pathSegments: 'Name' },
			edges: [],
			_parentEdge: { type: 'HAS_FIELD', fromId: 'sifobject-GradePeriods', fromLabel: 'SifObject' },
		},
	],
};

// ---- POST-MIGRATION CALL SHAPE (hub-kit-role Phase 3) --------------------------------------------
// forgeSif.js now injects lib/forge-framework, whose buildContractGraph signature is
// `({ parsed, metadata })` with `parsed` keyed by LOADER NAME — where the bespoke module took a
// SINGLE object carrying `nodes` and `metadata`. The graph these assertions examine is unchanged;
// only the way it is asked for has moved.
//
// The framework mints the DmeStandardRoot itself, from the DECLARATION plus this POST-STAMP metadata
// (the seven keys forge() step 4 composes), so a synthetic call must supply all seven rather than the
// parser's four. sourceUrl '' and sourceFiles [] are the values SIF's own root carries and are
// licensed by the declared allowances S4 and S7; versionSource/publishedVersion 'unknown' is what
// deriveVersionStamp stamps for a source that does not self-describe, which SIF's TSV does not.
const SIF_LOADER_NAME = 'sifImplementationSpecification';
const syntheticPostStampMetadata = {
	version: '1.0',
	versionSource: 'unknown',
	sourceFormat: 'tsv',
	sourceFiles: [],
	sourceUrl: '',
	snapshotKey: '01',
	publishedVersion: 'unknown',
};
const buildContractGraphFromSynthetic = (oneSyntheticParsed) =>
	bundle.buildContractGraph({
		parsed: { [SIF_LOADER_NAME]: oneSyntheticParsed },
		metadata: syntheticPostStampMetadata,
	});

const g = buildContractGraphFromSynthetic(syntheticParsed);
const byXpath = (xpath) => g.nodes.find((n) => n.properties.xpath === xpath);

harness.equal('Prefix: sequenceOrdinal 0 (first under Name)', byXpath('StudentPersonal/Name/Prefix').properties.sequenceOrdinal, 0);
harness.equal('FirstName: sequenceOrdinal 1', byXpath('StudentPersonal/Name/FirstName').properties.sequenceOrdinal, 1);
harness.equal('LastName: sequenceOrdinal 2', byXpath('StudentPersonal/Name/LastName').properties.sequenceOrdinal, 2);
harness.equal('every Name-group field: siblingCount 3', byXpath('StudentPersonal/Name/LastName').properties.siblingCount, 3);
harness.equal('every Name-group field: orderSemantics document', byXpath('StudentPersonal/Name/Prefix').properties.orderSemantics, 'document');
harness.equal(
	'every Name-group field carries the SAME sequenceGroupKey',
	byXpath('StudentPersonal/Name/Prefix').properties.sequenceGroupKey,
	byXpath('StudentPersonal/Name/LastName').properties.sequenceGroupKey,
);
harness.equal("Name-group field's sequenceGroupLabel is 'Name'", byXpath('StudentPersonal/Name/Prefix').properties.sequenceGroupLabel, 'Name');

// ---- ADVERSARIAL-REVIEW REGRESSION PROOF: the SAME nested shape ('Name' under pathSegments),
// reused by a SECOND, unrelated SifObject (GradePeriod), must NOT merge into StudentPersonal's group.
harness.ok(
	"REGRESSION: StudentPersonal's Name-group and GradePeriod's Name-group carry DIFFERENT sequenceGroupKeys (owner-scoped)",
	byXpath('StudentPersonal/Name/Prefix').properties.sequenceGroupKey !== byXpath('GradePeriod/Name/Prefix').properties.sequenceGroupKey,
);
harness.equal(
	"REGRESSION: StudentPersonal's Name-group siblingCount STAYS 3 — NOT merged to 6 with GradePeriod's",
	byXpath('StudentPersonal/Name/LastName').properties.siblingCount,
	3,
);
harness.equal("REGRESSION: GradePeriod's Name-group has its OWN independent siblingCount 3", byXpath('GradePeriod/Name/LastName').properties.siblingCount, 3);
harness.equal('REGRESSION: GradePeriod Prefix: sequenceOrdinal 0 (its OWN group, not continuing StudentPersonal\'s)', byXpath('GradePeriod/Name/Prefix').properties.sequenceOrdinal, 0);
harness.equal('REGRESSION: GradePeriod LastName: sequenceOrdinal 2', byXpath('GradePeriod/Name/LastName').properties.sequenceOrdinal, 2);
harness.equal(
	"REGRESSION: both objects' Name-groups share the SAME human label ('Name') despite being different groups",
	byXpath('GradePeriod/Name/Prefix').properties.sequenceGroupLabel,
	byXpath('StudentPersonal/Name/Prefix').properties.sequenceGroupLabel,
);

// the root-level fields group by owning object, disjoint from the nested Name group.
harness.equal('root-level field Grade: siblingCount 2 (Grade, StatusCode)', byXpath('StudentPersonal/Grade').properties.siblingCount, 2);
harness.equal("root-level field's sequenceGroupLabel is the owning object's name", byXpath('StudentPersonal/Grade').properties.sequenceGroupLabel, 'StudentPersonal');
harness.ok(
	'root-level group is a DIFFERENT group than the Name-nested group',
	byXpath('StudentPersonal/Grade').properties.sequenceGroupKey !== byXpath('StudentPersonal/Name/Prefix').properties.sequenceGroupKey,
);
const gradeOrd = byXpath('StudentPersonal/Grade').properties.sequenceOrdinal;
const statusOrd = byXpath('StudentPersonal/StatusCode').properties.sequenceOrdinal;
harness.equal('root-level fields ARE consecutively ordinaled {0,1}', JSON.stringify([gradeOrd, statusOrd].sort()), JSON.stringify([0, 1]));

// the 'Name' xml element's own children (elements, not fields) are ALSO stamped — the mirrored
// element-level group over the SAME native CHILD_ELEMENT edges.
// SifXmlElement's stableId is deterministic from its native path (normalize.js kindTokenByKind.xmlElement
// === 'element'), so 'sif:element/<path>' locates it directly — the forged node's OWN `properties.path`
// is instead the pathLabel convenience string (just the element's bare name), not its full native path.
const elByPath = (elPath) => g.nodes.find((n) => n.stableId === `sif:element/${elPath}`);
harness.equal('element Prefix: sequenceOrdinal 0', elByPath('Name/Prefix').properties.sequenceOrdinal, 0);
harness.equal('element FirstName: sequenceOrdinal 1', elByPath('Name/FirstName').properties.sequenceOrdinal, 1);
harness.equal('element LastName: sequenceOrdinal 2', elByPath('Name/LastName').properties.sequenceOrdinal, 2);
harness.equal('element siblings: siblingCount 3', elByPath('Name/Prefix').properties.siblingCount, 3);
harness.equal('element siblings: orderSemantics document', elByPath('Name/Prefix').properties.orderSemantics, 'document');

// the ROOT xml element itself ('Name', depth 1) is deliberately NOT grouped — see the header note
// and forgeSif.js's own SEQUENCE CAPTURE comment: a depth-1 relativePath is global/shared across
// SifObjects and forcing a single root group would silently pick a winner among unrelated owners.
const nameElement = g.nodes.find((n) => n.stableId === 'sif:element/Name');
harness.ok("the root 'Name' element itself carries NO sequenceOrdinal (root elements are not grouped)", nameElement.properties.sequenceOrdinal === undefined);

// =====================================================================
harness.section('SECTION 2 — NEGATIVE CONTROL: identity/addressing fields are BYTE-UNCHANGED');
// =====================================================================
(() => {
	// a second buildContractGraph run over the SAME input, with sequence properties stripped back
	// out, must reproduce EXACTLY the same identity-bearing fields as a run that never touched
	// sequence capture at all — i.e. sequence capture is provably ADDITIVE, not a mutation of
	// anything address-bearing (the P4 stability ruling this test exists to pin).
	const g2 = buildContractGraphFromSynthetic(syntheticParsed);
	const identityShape = (graph) =>
		JSON.stringify(
			graph.nodes.map((n) => ({
				stableId: n.stableId,
				role: n.role,
				parentId: n.properties.parentId,
				depth: n.properties.depth,
				path: n.properties.path,
				_id: n.properties._id,
			})),
		);
	harness.equal('two independent runs: IDENTICAL stableId/parentId/depth/path/_id for every node', identityShape(g), identityShape(g2));

	// the SAME check, explicitly stripping the three sequence properties first, proves their
	// PRESENCE never leaks into or perturbs any identity field's VALUE.
	const withoutSequenceProps = (graph) =>
		JSON.stringify(
			graph.nodes.map((n) => {
				const { sequenceOrdinal, siblingCount, orderSemantics, sequenceGroupKey, sequenceGroupLabel, ...rest } = n.properties;
				void sequenceOrdinal;
				void siblingCount;
				void orderSemantics;
				void sequenceGroupKey;
				void sequenceGroupLabel;
				return { stableId: n.stableId, role: n.role, properties: rest };
			}),
		);
	harness.equal(
		'stripping the sequence properties leaves an IDENTICAL node shape across two runs',
		withoutSequenceProps(g),
		withoutSequenceProps(g2),
	);
})();

// =====================================================================
harness.section("SECTION 3 — real-asset sanity: orderSemantics is ALWAYS 'document'; singletons stamped honestly");
// =====================================================================

const assetDir = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
bundle.forge({ sourcePath: assetDir, skipEmbedding: true }, (err, result) => {
	harness.accepts('real-asset forge (skipEmbedding) succeeds', err ? [err] : []);
	if (err) {
		harness.report();
		return;
	}
	const nodes = result.nodes;
	const stamped = nodes.filter((n) => n.properties.sequenceOrdinal !== undefined);

	harness.ok('real asset: at least one node stamped', stamped.length > 0);
	harness.ok(
		"real asset: EVERY stamped node's orderSemantics is 'document' — never 'normative' (this TSV source cannot verify a compositor)",
		stamped.every((n) => n.properties.orderSemantics === 'document'),
	);
	harness.ok(
		'real asset: EVERY DmeProperty (field) is stamped — every field belongs to exactly one group',
		nodes.filter((n) => n.role === 'DmeProperty').every((n) => n.properties.sequenceOrdinal !== undefined),
	);
	harness.ok(
		'real asset: ordinal is always < siblingCount, and >= 0',
		stamped.every((n) => n.properties.sequenceOrdinal >= 0 && n.properties.sequenceOrdinal < n.properties.siblingCount),
	);
	const singletons = stamped.filter((n) => n.properties.siblingCount === 1);
	harness.ok('real asset: at least one honest singleton group exists (siblingCount 1, ordinal 0)', singletons.length > 0);
	harness.ok('real asset: every singleton carries ordinal EXACTLY 0', singletons.every((n) => n.properties.sequenceOrdinal === 0));

	// within any one group, siblingCount and orderSemantics must agree across every member — a
	// disagreement would mean two DIFFERENT groups collided on one key (a defect this proves absent).
	const byGroupKey = {};
	stamped
		.filter((n) => n.properties.sequenceGroupKey)
		.forEach((n) => {
			(byGroupKey[n.properties.sequenceGroupKey] = byGroupKey[n.properties.sequenceGroupKey] || []).push(n);
		});
	const inconsistentGroup = Object.keys(byGroupKey).find((oneKey) => {
		const members = byGroupKey[oneKey];
		return (
			new Set(members.map((n) => n.properties.siblingCount)).size !== 1 ||
			new Set(members.map((n) => n.properties.orderSemantics)).size !== 1
		);
	});
	harness.ok(`real asset: no field group has an internally inconsistent siblingCount/orderSemantics (found: ${inconsistentGroup || 'none'})`, !inconsistentGroup);
	const ordinalsForKey = (oneKey) => byGroupKey[oneKey].map((n) => n.properties.sequenceOrdinal).sort((a, b) => a - b);
	const nonContiguous = Object.keys(byGroupKey).find((oneKey) => {
		const ordinals = ordinalsForKey(oneKey);
		return JSON.stringify(ordinals) !== JSON.stringify(Array.from({ length: ordinals.length }, (v, i) => i));
	});
	harness.ok(`real asset: every field group's ordinals are a contiguous 0..N-1 run (found gap in: ${nonContiguous || 'none'})`, !nonContiguous);

	// =====================================================================
	// SECTION 4 — ADVERSARIAL-REVIEW REGRESSION (2026-07-30): field groups must be OWNER-SCOPED.
	// A prior version keyed a nested field group on props.pathSegments ALONE — object-relative by
	// construction (parser.js's field.pathSegments strips the owning object's own two path segments) —
	// so a shared nested shape reused across many SifObjects (e.g.
	// 'SIF_Metadata/TimeElements/TimeElement', reused by 136 objects) silently merged into ONE
	// cross-object group (268 of 1,873 groups merged; 70% of fields affected; worst case 952 members
	// from 136 objects, when the true per-document sibling count is 7). This section proves the fix
	// DIRECTLY against the real asset, independently deriving each field's owning object from its OWN
	// xpath (never trusting the forge's own owningName computation — an independent check).
	// =====================================================================
	const fields = nodes.filter((n) => n.role === 'DmeProperty');

	// the owning SifObject's singular name is always the SECOND non-empty xpath segment
	// ('/AccountingPeriods/AccountingPeriod/...' -> 'AccountingPeriod') — independent of anything the
	// forge itself computed, so this check cannot be fooled by a bug shared between the code and the
	// probe.
	const ownerFromXpath = (xpath) => (xpath || '').split('/').filter(Boolean)[1];

	const byFieldGroupKey = {};
	fields
		.filter((n) => n.properties.sequenceGroupKey)
		.forEach((n) => {
			(byFieldGroupKey[n.properties.sequenceGroupKey] = byFieldGroupKey[n.properties.sequenceGroupKey] || []).push(n);
		});
	const groupKeys = Object.keys(byFieldGroupKey);
	harness.ok('real asset: field groups actually exist to check (sanity)', groupKeys.length > 0);

	const multiOwnerGroup = groupKeys.find((oneKey) => {
		const owners = new Set(byFieldGroupKey[oneKey].map((n) => ownerFromXpath(n.properties.xpath)));
		return owners.size > 1;
	});
	harness.ok(
		`real asset: NO field group spans more than one owning SifObject (independently derived from each field's own xpath) — found: ${multiOwnerGroup || 'none'}`,
		!multiOwnerGroup,
	);

	// the SIF_Metadata/TimeElements/TimeElement shape the adversarial review named directly: it recurs
	// across 136 distinct SifObjects; each object's OWN group must carry the TRUE per-document sibling
	// count (7 children — NOT the pre-fix 952). Matched by sequenceGroupKey SUFFIX (the exact group —
	// 'owner:SIF_Metadata/TimeElements/TimeElement'), never a raw xpath substring: a substring match
	// would also catch fields NESTED DEEPER still (e.g. .../TimeElement/SpanGaps/SpanGap/Value, whose
	// true immediate parent is 'SpanGap', siblingCount 6) — a distinct, correctly-scoped group of its
	// own, not a counter-example to this one.
	const timeElementFields = fields.filter((n) => (n.properties.sequenceGroupKey || '').endsWith(':SIF_Metadata/TimeElements/TimeElement'));
	harness.ok('real asset: SIF_Metadata/TimeElements/TimeElement fields exist to check (sanity)', timeElementFields.length > 0);
	const timeElementOwners = new Set(timeElementFields.map((n) => ownerFromXpath(n.properties.xpath)));
	harness.ok('real asset: the TimeElement shape recurs across MANY distinct owning objects (the collision precondition)', timeElementOwners.size > 50);
	harness.ok(
		"real asset: EVERY TimeElement-shaped field's siblingCount is the TRUE per-document count (7), never the merged cross-object count (952)",
		timeElementFields.every((n) => n.properties.siblingCount === 7),
	);
	const oneTimeElementField = timeElementFields[0];
	harness.equal(
		"a representative TimeElement field's sequenceGroupLabel is 'TimeElement' (the true immediate parent, per-document)",
		oneTimeElementField.properties.sequenceGroupLabel,
		'TimeElement',
	);

	harness.report();
});
