#!/usr/bin/env node
'use strict';

// test-facetScan.js — hermetic gate for lib/facetScan.js and its two consumers' P12 surface
// (candidateSelectionRedesign-073126.md §4; P12 deliverable). Proves, against the REAL modules and
// hand-built fixtures only — no Docker, no Neo4j, no LLM, no network, no embedding call:
//
//   SECTION 1  composite embedded text — the SOURCE side's EXACT documented format; the CANDIDATE
//              side's forge-stored embedText read VERBATIM (⟪hubReimplementation P3⟫: the card
//              composes and stores its own retrieval string at forge time); determinism (same
//              inputs, same bytes, every time); whitespace normalization; slot omission; the
//              degenerate all-empty case; and the defText resolution chain it REPLACES.
//   SECTION 2  the owning-class map — build, lookup by parentId, honest absence, stamping — and the
//              candidate's context read straight off the card's own domainName (the bridge-side
//              domain map is RETIRED with the card shape that made it necessary).
//   SECTION 3  each facet in isolation, including its edge cases (missing vector, no tokens, an
//              authored anchor that does NOT match, an undetermined type, an unknown tier).
//   SECTION 4  slot allocation — every reserved slot is filled, dedupe seats a shared candidate ONCE
//              while recording EVERY slot it earned, a zero-valued facet earns no seat, anchors are
//              unconditional and cap-exempt, and the cap binds deterministically.
//   SECTION 5  THE REGRESSION PROOF, modeled on the real `case:CFItem.uri` failure: a candidate the
//              OLD union (cosine top-15 ∪ nominate top-10) EXCLUDES is present under the new
//              allocation. The old union is reproduced by the REAL modules (semanticMatcher +
//              caseEvidenceBridge's own exported nominate machinery), not by this suite's assertions.
//   SECTION 6  facet provenance reaches the rendered prompt, and the source block carries the owning
//              class NAME and DESCRIPTION — proven through the REAL renderer, and through the REAL
//              ⟪A3⟫ gate (evidencePackageViolation) as the acceptance oracle for the package shape.
//   SECTION 7  refusals BY NAME — construction and shape guards on facetScan and on the composer's
//              facetScanner injection; the reimplemented card's OWN refusals (no embedText, no
//              domainName — each refused NAMING the candidate); the retired exports proven gone;
//              and the contracts gate's own facet/slot refusals (RED/GREEN).
//   SECTION 8  MEASURED SCAN COST at realistic scale (29,346 candidates × 1024 dims), reported as a
//              number, not asserted — a timing assertion on shared hardware is a flake generator.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-facetScan.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the P12 multi-facet candidate scan (facetScan.js)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help] [-skipScale]

DESCRIPTION
     Proves composite embed-text composition, the owning-class map, all six facets, reserved-slot
     allocation, the CFItem-shaped regression case, facet provenance in the rendered prompt, and
     every refusal by name. -skipScale omits SECTION 8's realistic-scale timing measurement.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const facetScan = require('../lib/facetScan');
const evidenceComposerFactory = require('../lib/evidenceComposer');
const semanticMatcherFactory = require('../lib.d/semanticMatcher');
const evidenceRendererFactory = require('../lib.d/evidenceRenderer');
const { evidencePackageViolation, DECLARED_FACET_NAMES } = require('../lib/evidenceContracts');
const sourceWalkerModule = require('../lib.d/sourceWalker');
const caseEvidenceBridge = require('../../../../../forges/case/bridges/caseEvidenceBridge');

const {
	composeSourceEmbedText,
	embedTextForSource,
	embedTextForCandidate,
	buildClassMap,
	candidateDomainText,
	owningClassOf,
	stampOwningClass,
	tokenize,
	overlapCoefficient,
	datatypeCode,
	sourceTypeCode,
	candidateTypeCode,
	sourceTierCode,
	candidateTierCode,
	sourceAnchorId,
	candidateAnchorKeys,
	DEFAULT_RESERVATIONS,
	POOL_CAP,
} = facetScan;

const { commandLineParameters } = process.global;
const skipScale = !!(commandLineParameters && commandLineParameters.switches && commandLineParameters.switches.skipScale);

// =====================================================================
// SHARED FIXTURE HELPERS
// =====================================================================

// unitVector — a 3-dim vector on the unit sphere so cosine values read by inspection.
const v3 = (a, b, c) => [a, b, c];

// hubModuleDouble — the minimum conforming BaseTupleEvidence a package gate accepts, in the
// ⟪hubReimplementation P3⟫ shape (SPEC §6: singular meaning-carrying `domain` group, `property`
// group, `qualifierNames`). Not the real cedsHubModule (which demands a full reimplemented
// HubReference card); this suite is about the SCAN. Every field is read from its ONE place on the
// new-shape fixture card — no defaulting.
const hubModuleDouble = (candidate, callback) =>
	callback('', {
		referenceTier: candidate.referenceTier,
		canonicalKey: candidate.canonicalKey,
		propertyKey: candidate.propertyKey,
		name: candidate.name,
		domain: { domainId: candidate.domainId, domainName: candidate.domainName },
		property: { propertyName: candidate.propertyName, propertyDefinition: candidate.propertyDefinition },
		range: { shape: 'datatype', rangeDatatype: candidate.rangeDatatype, rangeClassId: null, rangeOptionSetId: null },
		isQualified: false,
		qualifierNames: [],
		value: null,
	});

const graphReaderDouble = {
	readNodes: (spec, callback) => callback('', { nodes: [] }),
	close: (callback) => callback(''),
};

// =====================================================================
// SECTION 1 — COMPOSITE EMBEDDED TEXT (§4.1)
// =====================================================================

harness.section('SECTION 1 — composite embedded text: the exact documented format, both sides');

harness.equal(
	'source composite: all four slots, in slot order, joined by the documented separator',
	composeSourceEmbedText({
		owningClassName: 'CFItem',
		propertyName: 'uri',
		description: 'The Uniform Resource Identifier.',
		owningClassDescription: 'This is the content that either describes a specific competency.',
	}),
	'CFItem · uri · The Uniform Resource Identifier. · This is the content that either describes a specific competency.',
);

// ⟪hubReimplementation P3⟫ the candidate side is composed AT FORGE TIME and STORED on the card as
// `embedText` (SPEC §1.5/§4); embedTextForCandidate is a verbatim READ of that field — one
// composition, one authority, inspectable in the graph.
harness.equal(
	"candidate side: embedTextForCandidate returns the card's STORED embedText VERBATIM",
	embedTextForCandidate({
		canonicalKey: 'P000887',
		name: 'Competency Definition URL',
		domainName: 'Competency Definition',
		embedText: 'Competency Definition · Competency Definition URL · The URL of the competency definition.',
	}),
	'Competency Definition · Competency Definition URL · The URL of the competency definition.',
);
harness.equal(
	'the stored embedText comes back BYTE-FOR-BYTE — no renormalization, no recomposition, no second authority',
	embedTextForCandidate({ canonicalKey: 'PRAW', domainName: 'Anything', embedText: '  raw   stored\tbytes ' }),
	'  raw   stored\tbytes ',
);

harness.equal(
	'an empty slot contributes nothing — no bare separator run',
	composeSourceEmbedText({ owningClassName: '', propertyName: 'uri', description: '', owningClassDescription: 'a class' }),
	'uri · a class',
);

harness.equal(
	'whitespace is collapsed and trimmed inside every slot',
	composeSourceEmbedText({ owningClassName: '  CF\n\tItem ', propertyName: ' uri  ', description: '', owningClassDescription: '' }),
	'CF Item · uri',
);

harness.equal(
	'null/undefined slots behave exactly as empty ones',
	composeSourceEmbedText({ owningClassName: null, propertyName: 'Name', description: undefined, owningClassDescription: null }),
	'Name',
);

harness.equal('every slot empty composes to the empty string', composeSourceEmbedText({}), '');

// DETERMINISM — the whole retrieval story rests on the same record always producing the same bytes.
const determinismInput = {
	owningClassName: 'CFDefinition',
	propertyName: 'CFConcepts',
	description: 'The set of concept definitions.',
	owningClassDescription: 'A competency framework document.',
};
const determinismRuns = [];
for (let i = 0; i < 25; i++) {
	determinismRuns.push(composeSourceEmbedText({ ...determinismInput }));
}
harness.ok(
	'composition is deterministic: 25 runs over equal inputs produce ONE distinct string',
	new Set(determinismRuns).size === 1,
	`observed ${new Set(determinismRuns).size} distinct results`,
);
harness.ok(
	'composition is order-insensitive in its ARGUMENT object (read by named key, never by key order)',
	composeSourceEmbedText({
		owningClassDescription: determinismInput.owningClassDescription,
		description: determinismInput.description,
		propertyName: determinismInput.propertyName,
		owningClassName: determinismInput.owningClassName,
	}) === determinismRuns[0],
);

// THE FALLBACK CHAIN IT REPLACES — the defect of record, reproduced against the REAL sourceWalker so
// the comparison is with live behavior, not with a remembered description of it.
const cfConceptsNode = {
	stableId: 'case:CFDefinition.CFConcepts',
	properties: {
		role: 'DmeProperty',
		name: 'CFConcepts',
		description: 'The set of concept definitions.',
		searchText: 'CFDefinition | CFConcepts',
		parentId: 'case:CFDefinition',
	},
};
const flatCfConcepts = sourceWalkerModule.flattenFullRecord(cfConceptsNode);
harness.equal(
	'THE DEFECT, reproduced: the fallback chain resolves defText to the description ALONE',
	flatCfConcepts.defText,
	'The set of concept definitions.',
);
harness.ok(
	'THE DEFECT, reproduced: the owning class is absent from the fallback-chain text entirely',
	flatCfConcepts.defText.indexOf('CFDefinition') === -1,
);
const cfConceptsClassMap = buildClassMap([
	{ stableId: 'case:CFDefinition', name: 'CFDefinition', description: 'A competency framework document.' },
]);
const cfConceptsEmbedText = embedTextForSource(flatCfConcepts, cfConceptsClassMap);
harness.equal(
	'THE FIX: the composite carries the owning class, the property, the description AND the class prose',
	cfConceptsEmbedText,
	'CFDefinition · CFConcepts · The set of concept definitions. · A competency framework document.',
);
harness.equal(
	'defText is BYTE-UNTOUCHED by composition — the decision to add embedText rather than redefine defText',
	flatCfConcepts.defText,
	'The set of concept definitions.',
);

harness.equal(
	'degenerate record (no class, no name, no description) falls back to defText FOR THAT RECORD ONLY',
	embedTextForSource({ defText: 'last resort text' }, {}),
	'last resort text',
);

// =====================================================================
// SECTION 2 — THE OWNING-CLASS MAP (§4.5)
// =====================================================================

harness.section('SECTION 2 — the prefetched owning-class map');

const classMap = buildClassMap([
	{
		stableId: 'case:CFItem',
		name: 'CFItem',
		description: 'This is the content that either describes a specific competency (learning objective).',
	},
	{ stableId: 'case:CFDocument', name: 'CFDocument', description: 'A competency framework document.' },
	{ stableId: null, name: 'ignored — no stableId', description: 'x' },
]);

harness.equal('buildClassMap keys by stableId', Object.keys(classMap).sort().join(','), 'case:CFDocument,case:CFItem');
harness.equal(
	'buildClassMap carries the class DESCRIPTION, which is the specific fix for the CFItem failure',
	classMap['case:CFItem'].description,
	'This is the content that either describes a specific competency (learning objective).',
);
harness.equal(
	'owningClassOf resolves a source through its parentId',
	owningClassOf({ parentId: 'case:CFItem' }, classMap).name,
	'CFItem',
);
harness.equal(
	'owningClassOf on an unresolvable parentId is honestly EMPTY — never a fabricated class name',
	JSON.stringify(owningClassOf({ parentId: 'case:NoSuchClass' }, classMap)),
	JSON.stringify({ name: '', description: '' }),
);
harness.equal(
	'owningClassOf with no classMap at all is honestly EMPTY',
	JSON.stringify(owningClassOf({ parentId: 'case:CFItem' }, null)),
	JSON.stringify({ name: '', description: '' }),
);

const stampedSource = stampOwningClass({ stableId: 'case:CFItem.uri', name: 'uri', parentId: 'case:CFItem' }, classMap);
harness.equal('stampOwningClass stamps owningClassName', stampedSource.owningClassName, 'CFItem');
harness.match(
	'stampOwningClass stamps owningClassDescription',
	stampedSource.owningClassDescription,
	/describes a specific competency/,
);

// ---- THE CANDIDATE'S CONTEXT (⟪hubReimplementation P3, SPEC §1.3/§6⟫): the reimplemented card
// ---- carries `domainName` ITSELF (proven on 100% of cards by gate G-4) — the bridge-side domain
// ---- map, and the resolution chain it fed, are RETIRED with the card shape that made them
// ---- necessary. candidateDomainText is now a one-argument verbatim read; a card without a
// ---- domainName is refused BY NAME (observed in SECTION 7).
harness.equal(
	"candidateDomainText reads the card's own domainName, full stop",
	candidateDomainText({ canonicalKey: 'P000887', name: 'Competency Definition URL', domainName: 'Competency Definition' }),
	'Competency Definition',
);

const cardContextScanner = facetScan({
	candidateElements: [
		{
			stableId: 'ceds:carded',
			canonicalKey: 'PM1',
			propertyKey: 'PM1',
			name: 'Competency Definition URL',
			propertyName: 'Competency Definition URL',
			domainName: 'Competency Definition',
			domainId: 'C200002',
			referenceTier: 'property',
			rangeDatatype: 'anyURI',
			embedText: 'Competency Definition · Competency Definition URL',
			vector: v3(0, 1, 0),
		},
	],
});
harness.equal(
	"contextOverlap MEASURES through the card's own domainName: an owning class matching it overlaps",
	cardContextScanner
		.scan({ role: 'DmeProperty', name: 'uri', owningClassName: 'Competency Definition', vector: v3(1, 0, 0) })
		.entries[0].facets.contextOverlap.sharedTokens.join(','),
	'competency,definition',
);

// =====================================================================
// SECTION 3 — THE SIX FACETS, EACH IN ISOLATION (§4.2)
// =====================================================================

harness.section('SECTION 3 — each facet, including its edge cases');

harness.equal(
	'the declared facet vocabulary is exactly the six §4.2 names, in order',
	DECLARED_FACET_NAMES.join(','),
	'cosine,nameOverlap,contextOverlap,anchorMatch,typeFit,tierMatch',
);

// -- tokenize / overlap (the shared measure both overlap facets use) --
harness.equal(
	'tokenize splits camelCase, drops stopwords and short tokens',
	tokenize('CFItemURI of the thing').join(','),
	'item,uri,thing',
);
harness.equal('overlapCoefficient on disjoint sets is 0', overlapCoefficient(new Set(['a']), new Set(['b'])), 0);
harness.equal('overlapCoefficient with an empty set is 0', overlapCoefficient(new Set(), new Set(['b'])), 0);
harness.equal(
	'overlapCoefficient is |intersection| / min(|A|,|B|)',
	overlapCoefficient(new Set(['uri', 'item']), new Set(['uri', 'item', 'competency', 'definition'])),
	1,
);

// -- typeFit --
harness.equal('datatypeCode normalizes an XSD prefix', datatypeCode('xs:dateTime'), datatypeCode('date'));
harness.equal('datatypeCode maps an unrecognized token to UNKNOWN, never a neighbouring bucket', datatypeCode('widgetoid'), 0);
harness.equal('sourceTypeCode reads nativeType first', sourceTypeCode({ nativeType: 'xs:date', rangeDatatype: 'string' }), datatypeCode('date'));
harness.equal(
	'candidateTypeCode reads the range SHAPE: an option-set range is not a datatype',
	candidateTypeCode({ rangeOptionSetId: 'OS100', rangeDatatype: null }),
	facetScan.candidateTypeCode({ rangeOptionSetId: 'OS999' }),
);
harness.ok(
	'an option-set candidate and a string candidate do NOT share a type code',
	candidateTypeCode({ rangeOptionSetId: 'OS100' }) !== candidateTypeCode({ rangeDatatype: 'string' }),
);

// -- tierMatch --
harness.equal('sourceTierCode: DmeProperty -> property', sourceTierCode({ role: 'DmeProperty' }), candidateTierCode({ referenceTier: 'property' }));
harness.equal('sourceTierCode: DmeOptionValue -> value', sourceTierCode({ role: 'DmeOptionValue' }), candidateTierCode({ referenceTier: 'value' }));
harness.equal('an unrecognized role is UNKNOWN, never defaulted to property', sourceTierCode({ role: 'DmeSupport' }), 0);

// -- anchorMatch --
harness.equal('sourceAnchorId reads the authored cedsId', sourceAnchorId({ cedsId: ' P000887 ' }), 'P000887');
harness.equal('sourceAnchorId is EMPTY when the source declares no anchor', sourceAnchorId({ name: 'uri' }), '');
// ⟪hubReimplementation P3 (SPEC §6)⟫ the card carries NO cedsId — canonicalKey is the ONE anchor
// identity, read from its one authority.
const strayAnchorKeys = candidateAnchorKeys({ canonicalKey: 'P1', cedsId: 'P2' });
harness.ok(
	'candidateAnchorKeys carries canonicalKey ONLY — exactly one anchor identity',
	strayAnchorKeys.has('P1') && strayAnchorKeys.size === 1,
	`keys: ${[...strayAnchorKeys].join(',')}`,
);
harness.ok(
	'a STRAY cedsId property on a card contributes NO anchor — the retired second member stays retired',
	!strayAnchorKeys.has('P2'),
);

// -- the facets as computed BY THE SCAN, over a small deterministic fixture of NEW-SHAPE cards
// -- (SPEC §1: meaning ON the card — domainName/propertyName/definitions; a stored embedText;
// -- exactly ONE range member; valueKey on the value tier; NO cedsId/description/searchText) --
const facetCandidates = [
	{
		stableId: 'ceds:A',
		canonicalKey: 'P000001',
		propertyKey: 'P000001',
		name: 'Competency Definition URI',
		propertyName: 'Competency Definition URI',
		propertyDefinition: 'The URI of a competency definition.',
		domainName: 'Competency Definition',
		domainDefinition: 'Facts about a defined competency.',
		domainId: 'D100',
		referenceTier: 'property',
		rangeDatatype: 'anyURI',
		embedText: 'Competency Definition · Competency Definition URI · The URI of a competency definition. · Facts about a defined competency.',
		vector: v3(1, 0, 0),
	},
	{
		stableId: 'ceds:B',
		canonicalKey: 'P000002',
		propertyKey: 'P000002',
		name: 'Assessment Registration Score',
		propertyName: 'Assessment Registration Score',
		propertyDefinition: 'A score.',
		domainName: 'Assessment',
		domainDefinition: 'Facts about an assessment.',
		domainId: 'D200',
		referenceTier: 'property',
		rangeDatatype: 'decimal',
		embedText: 'Assessment · Assessment Registration Score · A score. · Facts about an assessment.',
		vector: v3(0, 1, 0),
	},
	{
		stableId: 'ceds:C',
		canonicalKey: 'P000003',
		propertyKey: 'P000003',
		valueKey: 'P000003.OS1.V1',
		name: 'Option Value Thing',
		propertyName: 'Option Value Property',
		propertyDefinition: 'A property with an option-set range.',
		valueName: 'Option Value Thing',
		valueDefinition: 'A value.',
		domainName: 'Assessment',
		domainDefinition: 'Facts about an assessment.',
		domainId: 'D200',
		referenceTier: 'value',
		rangeOptionSetId: 'OS1',
		rangeOptionSetName: 'Thing Options',
		embedText: 'Assessment · Option Value Thing · A value. · Facts about an assessment.',
		vector: v3(0, 0, 1),
	},
	{
		stableId: 'ceds:D',
		canonicalKey: 'P000004',
		propertyKey: 'P000004',
		name: 'No Vector Candidate',
		propertyName: 'No Vector Candidate',
		domainName: 'Unrelated Area',
		domainId: 'D300',
		referenceTier: 'property',
		rangeDatatype: 'string',
		embedText: 'Unrelated Area · No Vector Candidate',
	},
];

const facetSource = {
	stableId: 'case:CFItem.uri',
	role: 'DmeProperty',
	name: 'uri',
	description: 'The Uniform Resource Identifier.',
	parentId: 'case:CFItem',
	owningClassName: 'Competency Definition Item',
	owningClassDescription: 'Describes a specific competency.',
	nativeType: 'anyURI',
	cedsId: 'P000001',
	vector: v3(1, 0, 0),
};

const facetScanner = facetScan({ candidateElements: facetCandidates, poolCap: POOL_CAP });
const facetScanned = facetScanner.scan(facetSource);
const facetEntryByStableId = {};
facetScanned.entries.forEach((oneEntry) => {
	facetEntryByStableId[oneEntry.candidate.stableId] = oneEntry;
});

harness.equal('the scan reports the candidate count it scanned', facetScanned.candidateCount, 4);
harness.equal('cosine: an aligned vector scores 1', Math.round(facetEntryByStableId['ceds:A'].facets.cosine.value * 1e6) / 1e6, 1);
harness.equal('cosine: an orthogonal vector scores 0', Math.round(facetEntryByStableId['ceds:B'].facets.cosine.value * 1e6) / 1e6, 0);
harness.equal(
	'cosine EDGE CASE: a candidate with no vector scores -1 (the documented degenerate case), never a throw',
	facetEntryByStableId['ceds:D'].facets.cosine.value,
	-1,
);
harness.equal('cosine rank 1 goes to the aligned vector', facetEntryByStableId['ceds:A'].facets.cosine.rank, 1);
harness.equal('every facet reports the population it ranked within', facetEntryByStableId['ceds:A'].facets.cosine.outOf, 4);

harness.equal(
	'nameOverlap: shared name tokens are reported, not merely counted',
	facetEntryByStableId['ceds:A'].facets.nameOverlap.sharedTokens.join(','),
	'uri',
);
harness.equal(
	'nameOverlap EDGE CASE: no shared name tokens -> value 0 and an empty token list',
	facetEntryByStableId['ceds:B'].facets.nameOverlap.value,
	0,
);
harness.equal(
	'contextOverlap: the source OWNING CLASS tokens against the candidate DOMAIN tokens',
	facetEntryByStableId['ceds:A'].facets.contextOverlap.sharedTokens.join(','),
	'competency,definition',
);
harness.equal(
	'contextOverlap names both sides for the evidence',
	facetEntryByStableId['ceds:A'].facets.contextOverlap.candidateContext,
	'Competency Definition',
);
harness.ok('anchorMatch: an authored cedsId matching a canonicalKey is TRUE', facetEntryByStableId['ceds:A'].facets.anchorMatch.value === true);
harness.ok('anchorMatch EDGE CASE: a non-matching candidate is FALSE while still naming the declared anchor', facetEntryByStableId['ceds:B'].facets.anchorMatch.value === false);
harness.equal('anchorMatch reports the anchor the source declared', facetEntryByStableId['ceds:B'].facets.anchorMatch.anchorId, 'P000001');
harness.equal('typeFit: anyURI source vs anyURI candidate range is compatible', facetEntryByStableId['ceds:A'].facets.typeFit.value, 'compatible');
harness.equal('typeFit: anyURI source vs decimal candidate range is different', facetEntryByStableId['ceds:B'].facets.typeFit.value, 'different');
harness.equal('tierMatch: property source vs property candidate matches', facetEntryByStableId['ceds:A'].facets.tierMatch.value, true);
harness.equal('tierMatch: property source vs VALUE-tier candidate does not', facetEntryByStableId['ceds:C'].facets.tierMatch.value, false);

const noAnchorScan = facetScanner.scan({ ...facetSource, cedsId: undefined, vector: v3(1, 0, 0) });
harness.equal(
	'anchorMatch EDGE CASE: a source that declares NO anchor matches nothing and reports a null anchorId',
	noAnchorScan.entries.filter((oneEntry) => oneEntry.facets.anchorMatch.value).length,
	0,
);
const noTypeScan = facetScanner.scan({ ...facetSource, nativeType: undefined, rangeDatatype: undefined, format: undefined });
harness.equal(
	'typeFit EDGE CASE: an unknown type on either side is UNDETERMINED, never a guessed compatibility',
	noTypeScan.entries[0].facets.typeFit.value,
	'undetermined',
);
const noVectorScan = facetScanner.scan({ ...facetSource, vector: undefined });
harness.ok(
	'cosine EDGE CASE: a SOURCE with no vector scans without throwing; every cosine is -1',
	noVectorScan.entries.every((oneEntry) => oneEntry.facets.cosine.value === -1),
);
harness.ok(
	'the scan is REPEATABLE: the same source over the same scanner yields byte-identical entries',
	JSON.stringify(facetScanner.scan(facetSource).entries) === JSON.stringify(facetScanned.entries),
);

// =====================================================================
// SECTION 4 — RESERVED-SLOT ALLOCATION (§4.3)
// =====================================================================

harness.section('SECTION 4 — reserved-slot allocation: representation, dedupe, cap');

// A population big enough that each reserved slot must reach for DIFFERENT candidates.
const allocationCandidates = [];
for (let i = 0; i < 60; i++) {
	allocationCandidates.push({
		stableId: `ceds:alloc${i}`,
		canonicalKey: `PA${i}`,
		propertyKey: `PA${i}`,
		name: `Filler Candidate ${i}`,
		propertyName: `Filler Candidate ${i}`,
		domainName: 'Filler Domain',
		domainId: 'D400',
		referenceTier: 'property',
		rangeDatatype: 'string',
		embedText: `Filler Domain · Filler Candidate ${i}`,
		// a descending cosine ladder: alloc0 is closest, alloc59 furthest
		vector: [Math.cos((i * Math.PI) / 200), Math.sin((i * Math.PI) / 200), 0],
	});
}
// a candidate that ONLY name-overlaps (cosine-invisible: orthogonal)
allocationCandidates.push({
	stableId: 'ceds:nameOnly',
	canonicalKey: 'PNAME',
	propertyKey: 'PNAME',
	name: 'Rubric Criterion Identifier',
	propertyName: 'Rubric Criterion Identifier',
	domainName: 'Filler Domain',
	domainId: 'D400',
	referenceTier: 'property',
	rangeDatatype: 'string',
	embedText: 'Filler Domain · Rubric Criterion Identifier',
	vector: [0, 0, 1],
});
// a candidate that ONLY context-overlaps
allocationCandidates.push({
	stableId: 'ceds:contextOnly',
	canonicalKey: 'PCTX',
	propertyKey: 'PCTX',
	name: 'Totally Different Wording',
	propertyName: 'Totally Different Wording',
	domainName: 'Competency Framework Rubric',
	domainId: 'D401',
	referenceTier: 'property',
	rangeDatatype: 'string',
	embedText: 'Competency Framework Rubric · Totally Different Wording',
	vector: [0, 0, 1],
});
// the AUTHORED ANCHOR — deliberately the WORST candidate on every inferred signal
allocationCandidates.push({
	stableId: 'ceds:anchored',
	canonicalKey: 'PANCHOR',
	propertyKey: 'PANCHOR',
	name: 'Nothing In Common Whatsoever',
	propertyName: 'Nothing In Common Whatsoever',
	domainName: 'Unrelated Domain',
	domainId: 'D402',
	referenceTier: 'property',
	rangeDatatype: 'string',
	embedText: 'Unrelated Domain · Nothing In Common Whatsoever',
	vector: [-1, 0, 0],
});

const allocationSource = {
	stableId: 'case:CFRubric.rubricCriterionId',
	role: 'DmeProperty',
	name: 'Rubric Criterion Identifier',
	owningClassName: 'Competency Framework Rubric',
	owningClassDescription: 'A rubric.',
	cedsId: 'PANCHOR',
	rangeDatatype: 'string',
	vector: [1, 0, 0],
};

const allocationScanner = facetScan({ candidateElements: allocationCandidates });
const allocated = allocationScanner.scan(allocationSource);
const allocatedKeys = allocated.entries.map((oneEntry) => oneEntry.candidate.stableId);
const slotsOf = (stableId) => {
	const found = allocated.entries.find((oneEntry) => oneEntry.candidate.stableId === stableId);
	return found ? found.slots : null;
};

harness.ok(`the pool respects the cap (${allocated.entries.length} <= ${POOL_CAP} + anchors)`, allocated.entries.length <= POOL_CAP + 1);
harness.ok('the pool is DEDUPED — no candidate is seated twice', new Set(allocatedKeys).size === allocatedKeys.length);
harness.ok('the cosine slot is filled: the closest candidate is seated', allocatedKeys.includes('ceds:alloc0'));
harness.ok('the nameOverlap slot is filled: a cosine-invisible name match is seated', allocatedKeys.includes('ceds:nameOnly'));
harness.ok('the contextOverlap slot is filled: a cosine-invisible domain match is seated', allocatedKeys.includes('ceds:contextOnly'));
harness.ok('the anchorMatch slot is filled UNCONDITIONALLY, despite the worst cosine in the population', allocatedKeys.includes('ceds:anchored'));
harness.equal('the anchor names anchorMatch as the slot that seated it', (slotsOf('ceds:anchored') || []).join(','), 'anchorMatch');
harness.ok(
	'a combinedRank slot exists and seated at least one candidate',
	allocated.entries.some((oneEntry) => oneEntry.slots.includes('combinedRank')),
);
harness.ok(
	'DEDUPE RECORDS EVERY SLOT: a candidate earning more than one slot is seated once and names them all',
	allocated.entries.some((oneEntry) => oneEntry.slots.length > 1),
	JSON.stringify(allocated.entries.map((oneEntry) => oneEntry.slots)),
);
harness.equal(
	'slot allocation is deterministic across repeated scans',
	JSON.stringify(allocationScanner.scan(allocationSource).entries.map((oneEntry) => [oneEntry.candidate.stableId, oneEntry.slots])),
	JSON.stringify(allocatedKeys.map((oneKey) => [oneKey, slotsOf(oneKey)])),
);

// A ZERO-VALUED FACET EARNS NO SEAT — a source with no owning class at all must not fill the
// contextOverlap slot with five arbitrary candidates.
const contextlessScan = allocationScanner.scan({
	...allocationSource,
	owningClassName: '',
	owningClassDescription: '',
	parentId: undefined,
});
harness.equal(
	'a zero-valued facet earns NO seat: no contextOverlap slot is handed out when the source has no owning class',
	contextlessScan.entries.filter((oneEntry) => oneEntry.slots.includes('contextOverlap')).length,
	0,
);

// The cap binds deterministically when the reservations exceed it.
const tightScanner = facetScan({ candidateElements: allocationCandidates, poolCap: 6 });
const tightScan = tightScanner.scan(allocationSource);
harness.ok(`a tight cap binds: ${tightScan.entries.length} seated with poolCap 6 (anchors exempt)`, tightScan.entries.length <= 7);
harness.ok('the anchor survives a binding cap — author-declared beats inference', tightScan.entries.some((oneEntry) => oneEntry.candidate.stableId === 'ceds:anchored'));
harness.ok('a binding cap reports how many candidates it dropped, never silently', tightScan.droppedCount > 0);

// =====================================================================
// SECTION 5 — THE REGRESSION PROOF (the `case:CFItem.uri` shape)
// =====================================================================

harness.section('SECTION 5 — regression: a candidate the OLD union excluded IS present under the new allocation');

// The fixture is modeled on the real failure: a CASE property whose description is thin, whose owning
// class carries the meaning, and whose correct CEDS answer is neither the cosine leader nor a strong
// token match on the property name alone. `cfItemUri`'s true answer is 'Competency Definition URL'.
const regressionCandidates = [];
// 30 decoys that all beat the true answer on raw cosine (a thin 'uri' description embeds toward
// generic identifier prose), exactly the shape §2's worked failure describes. NEW-SHAPE cards: no
// cedsId, no defText, no description — the meaning fields and the stored embedText carry the prose.
for (let i = 0; i < 30; i++) {
	regressionCandidates.push({
		stableId: `ceds:decoy${i}`,
		canonicalKey: `PD${i}`,
		propertyKey: `PD${i}`,
		name: `Competency Framework Identifier URI ${i}`,
		propertyName: `Competency Framework Identifier URI ${i}`,
		propertyDefinition: `An identifier URI for framework artifact ${i}.`,
		domainName: 'Credential Definition',
		domainId: 'C300',
		referenceTier: 'property',
		rangeDatatype: 'anyURI',
		embedText: `Credential Definition · Competency Framework Identifier URI ${i} · An identifier URI for framework artifact ${i}.`,
		vector: [Math.cos((i + 1) * 0.002), Math.sin((i + 1) * 0.002), 0],
	});
}
// THE TRUE ANSWER: strong on contextOverlap (its domain is 'Competency Definition', the source's owning
// class is 'CFItem' whose forged class name tokenizes to 'competency definition item'), respectable but
// NOT top on cosine, and NOT the strongest single token match — top on nothing, strong on several.
const trueAnswer = {
	stableId: 'ceds:P000887',
	canonicalKey: 'P000887',
	propertyKey: 'P000887',
	name: 'Competency Definition URL',
	propertyName: 'Competency Definition URL',
	propertyDefinition: 'The Uniform Resource Locator of the competency definition.',
	domainName: 'Competency Definition',
	domainId: 'C200354',
	referenceTier: 'property',
	rangeDatatype: 'anyURI',
	embedText: 'Competency Definition · Competency Definition URL · The Uniform Resource Locator of the competency definition.',
	vector: [Math.cos(0.4), Math.sin(0.4), 0], // clearly behind all 30 decoys on cosine
};
regressionCandidates.push(trueAnswer);

const cfItemUriSource = {
	stableId: 'case:CFItem.uri',
	role: 'DmeProperty',
	name: 'uri',
	defText: 'The Uniform Resource Identifier.',
	description: 'The Uniform Resource Identifier.',
	parentId: 'case:CFItem',
	owningClassName: 'Competency Definition Item',
	owningClassDescription: 'This is the content that either describes a specific competency (learning objective).',
	rangeDatatype: 'anyURI',
	vector: [1, 0, 0],
};

// --- THE OLD UNION, reproduced with the REAL modules it was built from ---
const oldCosineTopK = semanticMatcherFactory({ topK: 15 }).retrieve(cfItemUriSource, regressionCandidates);
const oldCosineKeys = oldCosineTopK.map((oneRetrieved) => oneRetrieved.candidate.stableId);
harness.ok(
	'OLD UNION, half 1: the true answer is NOT in cosine top-15 (rank 31 of 31)',
	!oldCosineKeys.includes('ceds:P000887'),
	`cosine top-15: ${oldCosineKeys.join(', ')}`,
);

// half 2 — the real caseEvidenceBridge nomination machinery, on the real CASE stableId shape.
const casePathTokens = caseEvidenceBridge.pathTokensFromStableId(cfItemUriSource.stableId);
const caseScored = regressionCandidates
	.map((oneCandidate) => ({
		stableId: oneCandidate.stableId,
		affinity: caseEvidenceBridge.structuralAffinity(casePathTokens, oneCandidate),
	}))
	.filter((oneScored) => oneScored.affinity > 0)
	.sort((a, b) => b.affinity - a.affinity)
	.slice(0, 10);
const oldNominatedKeys = caseScored.map((oneScored) => oneScored.stableId);
harness.ok(
	'OLD UNION, half 2: the true answer is NOT in the nominate top-10 either — the casePath tokens ' +
		'(item, uri) favour the 30 decoys whose NAMES literally repeat them',
	!oldNominatedKeys.includes('ceds:P000887'),
	`nominated: ${oldNominatedKeys.join(', ') || '(none)'}`,
);
harness.ok(
	'OLD UNION VERDICT: the correct answer never entered the pool at all — the reproduced CFItem.uri failure',
	!oldCosineKeys.concat(oldNominatedKeys).includes('ceds:P000887'),
);

// --- THE NEW ALLOCATION ---
const regressionScanner = facetScan({ candidateElements: regressionCandidates });
const regressionScan = regressionScanner.scan(cfItemUriSource);
const regressionEntry = regressionScan.entries.find((oneEntry) => oneEntry.candidate.stableId === 'ceds:P000887');
harness.ok(
	'NEW ALLOCATION: the correct answer IS in the pool',
	!!regressionEntry,
	`pool: ${regressionScan.entries.map((oneEntry) => oneEntry.candidate.stableId).join(', ')}`,
);
if (regressionEntry) {
	harness.ok(
		'NEW ALLOCATION: and its seat is attributed — it names the slot(s) that earned it',
		regressionEntry.slots.length > 0,
		`slots: ${regressionEntry.slots.join(', ')}`,
	);
	harness.ok(
		'NEW ALLOCATION: it is seated by contextOverlap and/or combinedRank — a signal the old union had no seat for',
		regressionEntry.slots.includes('contextOverlap') || regressionEntry.slots.includes('combinedRank'),
		`slots: ${regressionEntry.slots.join(', ')}`,
	);
	harness.ok(
		'NEW ALLOCATION: the evidence states its cosine rank honestly — it is NOT pretending to be a cosine winner',
		regressionEntry.facets.cosine.rank > 15,
		`cosine rank ${regressionEntry.facets.cosine.rank} of ${regressionEntry.facets.cosine.outOf}`,
	);
}

// The strong-on-several-top-on-none case, stated as its own assertion.
const topOnNothing = regressionScan.entries.filter(
	(oneEntry) =>
		oneEntry.facets.cosine.rank > 1 && oneEntry.facets.nameOverlap.rank > 1 && oneEntry.facets.contextOverlap.rank > 1,
);
harness.ok(
	'a candidate strong on several facets but TOP OF NONE is seated — the seats that do not exist in the old union',
	topOnNothing.length > 0,
	`${topOnNothing.length} such candidate(s) seated`,
);

// =====================================================================
// SECTION 6 — PROVENANCE IN THE RENDERED PROMPT, THROUGH THE REAL RENDERER AND THE REAL ⟪A3⟫ GATE
// =====================================================================

harness.section('SECTION 6 — facet provenance and the owning class reach the judge');

const composerWithScan = evidenceComposerFactory({
	semanticMatcher: semanticMatcherFactory({ topK: 15 }),
	facetScanner: regressionScanner,
});

let composedPackage = null;
let composeError = null;
composerWithScan(
	{
		sourceElement: cfItemUriSource,
		candidateElements: regressionCandidates,
		graphReader: graphReaderDouble,
		hubModule: hubModuleDouble,
	},
	(err, evidencePackage) => {
		composeError = err;
		composedPackage = evidencePackage;
	},
);

harness.equal('the facet-scanned composer produces a package', composeError, '');
harness.equal(
	'THE ACCEPTANCE ORACLE: the composed package passes the REAL ⟪A3⟫ gate with facets present',
	evidencePackageViolation(composedPackage),
	'',
);
harness.ok(
	'every pool entry carries its facets and its slot attribution',
	composedPackage.pool.every((oneEntry) => oneEntry.facets && Array.isArray(oneEntry.slots) && oneEntry.slots.length),
);

const renderer = evidenceRendererFactory();
harness.equal('RENDERER_VERSION was bumped for the prompt change', renderer.RENDERER_VERSION, 'evidenceRenderer-v5');

let renderedPrompt = null;
let renderError = null;
renderer.render(composedPackage, ['hub framing'], {}, (err, promptText) => {
	renderError = err;
	renderedPrompt = promptText;
});
harness.equal('the package renders', renderError, '');
harness.match('THE SOURCE BLOCK NAMES THE OWNING CLASS', renderedPrompt, /owning class: Competency Definition Item/);
harness.match(
	'THE SOURCE BLOCK CARRIES THE OWNING CLASS DESCRIPTION — the specific CFItem fix',
	renderedPrompt,
	/owning class description: This is the content that either describes a specific competency/,
);
harness.match('every candidate states the seat it earned', renderedPrompt, /Seat earned by: /);
harness.match('facet provenance states the cosine WITH its rank out of the whole population', renderedPrompt, /cosine [\d.-]+ \(rank \d+ of 31\)/);
harness.match('facet provenance states the context tokens shared', renderedPrompt, /context tokens shared \[/);
harness.match('facet provenance states the type comparison', renderedPrompt, /type fit: source uri <-> candidate uri — compatible/);
harness.match('facet provenance states the tier comparison', renderedPrompt, /tier: source property <-> candidate property — match/);
harness.match('facet provenance states the combined rank-sum', renderedPrompt, /combined rank-sum \d+ across cosine\+name\+context/);
harness.ok(
	'the composed embedText is NOT rendered into the prompt (it would restate every line at length)',
	renderedPrompt.indexOf('embedText') === -1,
);

// DETERMINISM — the renderer's keystone invariant, over a facet-carrying package.
let renderedAgain = null;
renderer.render(composedPackage, ['hub framing'], {}, (err, promptText) => {
	renderedAgain = promptText;
});
harness.equal('the facet-carrying prompt is BYTE-STABLE across two renders', renderedAgain, renderedPrompt);

// =====================================================================
// SECTION 7 — REFUSALS BY NAME
// =====================================================================

harness.section('SECTION 7 — refusals by name (RED), and the gate proven RED then GREEN');

const refusalOf = (fn) => {
	let message = '';
	try {
		fn();
	} catch (error) {
		message = `${error.message}`;
	}
	return message;
};

harness.match(
	'facetScan refuses construction with no candidateElements array, BY NAME',
	refusalOf(() => facetScan({})),
	/candidateElements array/,
);
harness.match(
	'facetScan refuses an empty reservations policy, BY NAME',
	refusalOf(() => facetScan({ candidateElements: [], reservations: [] })),
	/reservations must be a non-empty array/,
);
harness.match(
	'facetScan refuses a malformed reservation, BY NAME',
	refusalOf(() => facetScan({ candidateElements: [], reservations: [{ slotType: 'cosine', seats: 0 }] })),
	/is malformed/,
);
harness.match(
	'facetScan refuses a non-positive poolCap, BY NAME',
	refusalOf(() => facetScan({ candidateElements: [], poolCap: 0 })),
	/poolCap is 0/,
);

// ⟪hubReimplementation P3 (SPEC §6)⟫ THE CARD'S OWN REFUSALS — a broken card is refused NAMING the
// candidate, never silently scanned as contextless and never handed a recomposed retrieval string.
const missingEmbedTextRefusal = refusalOf(() =>
	embedTextForCandidate({ canonicalKey: 'P000887', name: 'Competency Definition URL', domainName: 'Competency Definition' }),
);
harness.match(
	'embedTextForCandidate refuses a card with NO stored embedText — the refusal NAMES the candidate',
	missingEmbedTextRefusal,
	/candidate 'P000887'/,
);
harness.match(
	'and it states the missing field by name — there is no bridge-side recomposition and no default',
	missingEmbedTextRefusal,
	/embedText/,
);
harness.match(
	'an EMPTY-STRING embedText is refused exactly as an absent one, naming the candidate',
	refusalOf(() => embedTextForCandidate({ canonicalKey: 'PEMPTY', embedText: '' })),
	/candidate 'PEMPTY'/,
);

const missingDomainNameRefusal = refusalOf(() => candidateDomainText({ canonicalKey: 'PCTXLESS', name: 'Some Property' }));
harness.match(
	'candidateDomainText refuses a card with NO domainName — the refusal NAMES the candidate',
	missingDomainNameRefusal,
	/candidate 'PCTXLESS'/,
);
harness.match(
	'and it states the missing field by name — there is no map and no default',
	missingDomainNameRefusal,
	/domainName/,
);
harness.match(
	'an EMPTY-STRING domainName is refused exactly as an absent one, naming the candidate',
	refusalOf(() => candidateDomainText({ canonicalKey: 'PBLANK', domainName: '' })),
	/candidate 'PBLANK'/,
);
harness.match(
	'the SCAN ITSELF refuses a domainName-less card at construction — a broken card never enters the pass',
	refusalOf(() =>
		facetScan({
			candidateElements: [
				{ canonicalKey: 'PBROKEN', name: 'Broken Card', referenceTier: 'property', rangeDatatype: 'string', embedText: 'x' },
			],
		}),
	),
	/candidate 'PBROKEN'/,
);

// THE RETIRED EXPORTS, proven gone — the candidate side is composed at forge time and stored on the
// card; a bridge-side recomposition surface left exported would be a second authority over one fact.
harness.ok(
	'composeCandidateEmbedText is NO LONGER exported — the forge composes the candidate side',
	facetScan.composeCandidateEmbedText === undefined,
);
harness.ok(
	'buildDomainMap is NO LONGER exported — the card carries its own domainName',
	facetScan.buildDomainMap === undefined,
);
harness.match(
	'the composer refuses a facetScanner that cannot scan, BY NAME — never a silent degradation to cosine top-K',
	refusalOf(() => evidenceComposerFactory({ semanticMatcher: semanticMatcherFactory({}), facetScanner: { nope: true } })),
	/facetScanner was given but carries no scan\(\)/,
);
harness.ok(
	'the default reservations are the §4.3 policy: cosine 10, contextOverlap 5, nameOverlap 5, combinedRank 5',
	JSON.stringify(DEFAULT_RESERVATIONS.map((oneReservation) => [oneReservation.slotType, oneReservation.seats])) ===
		JSON.stringify([
			['cosine', 10],
			['contextOverlap', 5],
			['nameOverlap', 5],
			['combinedRank', 5],
		]),
);

// The ⟪A3⟫ gate's own facet rules, RED then GREEN against the REAL oracle.
const goodEntry = JSON.parse(JSON.stringify(composedPackage.pool[0]));
const packageWith = (entry) => ({
	sourceElement: composedPackage.sourceElement,
	pool: [entry],
	promptSegments: [],
});

harness.equal('GREEN: a complete facet set + slots passes the gate', evidencePackageViolation(packageWith(goodEntry)), '');

const missingFacet = JSON.parse(JSON.stringify(goodEntry));
delete missingFacet.facets.tierMatch;
harness.match(
	'RED: a HALF-POPULATED facets object is refused by name — an under-stated seat is what §4.4 forbids',
	evidencePackageViolation(packageWith(missingFacet)),
	/carries no 'tierMatch'/,
);

const unattributedSeat = JSON.parse(JSON.stringify(goodEntry));
unattributedSeat.slots = [];
harness.match(
	'RED: facets present with NO slot attribution is refused by name',
	evidencePackageViolation(packageWith(unattributedSeat)),
	/must name the reserved slot\(s\) that earned it a seat/,
);

const slotsWithoutFacets = JSON.parse(JSON.stringify(goodEntry));
delete slotsWithoutFacets.facets;
harness.match(
	'RED: a slot attribution with no facet values behind it is refused by name',
	evidencePackageViolation(packageWith(slotsWithoutFacets)),
	/slots is present without facets/,
);

// COEXISTENCE — a composer with NO facetScanner still composes the historical cosine-top-K pool, and
// that pool still passes the gate (no facets required).
let legacyPackage = null;
evidenceComposerFactory({ semanticMatcher: semanticMatcherFactory({ topK: 3 }) })(
	{
		sourceElement: cfItemUriSource,
		candidateElements: regressionCandidates,
		graphReader: graphReaderDouble,
		hubModule: hubModuleDouble,
	},
	(err, evidencePackage) => {
		legacyPackage = evidencePackage;
	},
);
harness.equal('COEXISTENCE: a composer with no facetScanner still composes cosine top-K', legacyPackage.pool.length, 3);
harness.ok('COEXISTENCE: that pool carries no facets at all', legacyPackage.pool.every((oneEntry) => oneEntry.facets === undefined));
harness.equal('COEXISTENCE: and it passes the gate unchanged', evidencePackageViolation(legacyPackage), '');

// =====================================================================
// SECTION 8 — MEASURED COST AT REALISTIC SCALE
// =====================================================================

harness.section('SECTION 8 — measured scan cost at realistic scale');

if (skipScale) {
	harness.note('-skipScale given: the realistic-scale timing measurement was not run.');
} else {
	const SCALE_CANDIDATE_COUNT = 29346; // the live CEDS HubReference population, 2026-07-31
	const SCALE_DIMENSIONS = 1024; // voyage-4-large
	const scaleCandidates = new Array(SCALE_CANDIDATE_COUNT);
	// a cheap deterministic PRNG so the fixture is reproducible and never touches Math.random
	let seed = 20260731;
	const nextPseudoRandom = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	for (let i = 0; i < SCALE_CANDIDATE_COUNT; i++) {
		const vector = new Float64Array(SCALE_DIMENSIONS);
		for (let d = 0; d < SCALE_DIMENSIONS; d++) {
			vector[d] = nextPseudoRandom() - 0.5;
		}
		scaleCandidates[i] = {
			stableId: `ceds:scale${i}`,
			canonicalKey: `PS${i}`,
			propertyKey: `PS${i}`,
			name: `Scale Candidate ${i} Identifier Name`,
			propertyName: `Scale Candidate ${i} Identifier Name`,
			propertyDefinition: `A synthetic candidate ${i} for timing.`,
			domainName: `Domain ${i % 40}`,
			domainId: `D${i % 40}`,
			referenceTier: 'property',
			rangeDatatype: 'string',
			embedText: `Domain ${i % 40} · Scale Candidate ${i} Identifier Name · A synthetic candidate ${i} for timing.`,
			vector,
		};
	}
	const scaleSourceVector = new Float64Array(SCALE_DIMENSIONS);
	for (let d = 0; d < SCALE_DIMENSIONS; d++) {
		scaleSourceVector[d] = nextPseudoRandom() - 0.5;
	}
	const scaleSource = {
		stableId: 'case:CFItem.uri',
		role: 'DmeProperty',
		name: 'Rubric Criterion Identifier',
		description: 'timing probe',
		owningClassName: 'Domain 7',
		owningClassDescription: 'timing probe class',
		rangeDatatype: 'string',
		vector: scaleSourceVector,
	};

	const constructionStart = process.hrtime.bigint();
	const scaleScanner = facetScan({ candidateElements: scaleCandidates });
	const constructionMs = Number(process.hrtime.bigint() - constructionStart) / 1e6;

	scaleScanner.scan(scaleSource); // one warm-up pass, excluded from the measurement
	const SCAN_REPEATS = 10;
	const scanStart = process.hrtime.bigint();
	let seatedTotal = 0;
	for (let i = 0; i < SCAN_REPEATS; i++) {
		seatedTotal += scaleScanner.scan(scaleSource).entries.length;
	}
	const perScanMs = Number(process.hrtime.bigint() - scanStart) / 1e6 / SCAN_REPEATS;

	harness.ok(
		`MEASURED: ${SCALE_CANDIDATE_COUNT} candidates × ${SCALE_DIMENSIONS} dims — once-per-run precompute ` +
			`${constructionMs.toFixed(0)} ms; per-source six-facet scan + 4 exact rankings + allocation ` +
			`${perScanMs.toFixed(1)} ms; ${seatedTotal / SCAN_REPEATS} seats filled`,
		true,
	);
	harness.note(
		`Baseline of record (candidateSelectionRedesign-073126.md §3): the OLD single cosine scan measured ` +
			`58 ms per source over the same population. Projected wall clock at ${perScanMs.toFixed(1)} ms/source — ` +
			`CASE (194) ${((perScanMs * 194) / 1000).toFixed(1)} s; bronze (5,472) ` +
			`${((perScanMs * 5472) / 1000).toFixed(0)} s; SIF (15,620) ${((perScanMs * 15620) / 60000).toFixed(1)} min. ` +
			`Judging the same populations is measured in hours and hundreds of dollars.`,
	);
	harness.ok(
		'the scan completes at realistic scale without exhausting memory or time (a smoke bound, not a perf assertion)',
		perScanMs < 5000,
		`${perScanMs.toFixed(1)} ms per source`,
	);
}

harness.report();
