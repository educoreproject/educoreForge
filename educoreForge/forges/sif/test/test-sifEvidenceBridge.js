#!/usr/bin/env node
'use strict';

// test-sifEvidenceBridge.js — hermetic gate for forges/sif/bridges/sifEvidenceBridge.js
// (bridgeEvidenceRefactor-spec.md §7, Phase 6 — pattern: test-caseEvidenceBridge.js, "with SIF's
// character"; REVISED for hubReimplementation P3, 2026-08-03, SPEC §6). PURE + synchronous +
// deterministic where the module itself is (the pure helpers, the nominate/walk hooks, the REAL
// evidenceComposer run); the full-flow sections drive the REAL bridgeMaker.run() with a STUBBED
// llmClient (no real Anthropic call) and graphReader/graphWriter/vectorizer doubles, exactly
// test-caseEvidenceBridge.js's own SECTION 7 discipline.
//
// ⟪hubReimplementation P3 REVISION⟫ every HubReference candidate fixture in this suite is the NEW
// self-sufficient card shape (SPEC §1/§6): referenceTier/canonicalKey/propertyKey/name, the MEANING
// fields (domainId/domainName/domainDefinition, propertyName/propertyDefinition), exactly ONE range
// field, a non-empty forge-composed `embedText`, and the forge-stamped `embedding` — and NONE of the
// retired fields (cedsId, description, searchText, allDomainIds, allDomainNames) as CARD properties.
// (The FLATTENED element the hooks receive still carries a computed `cedsId`: lib.d/sourceWalker.js
// flattenFullRecord resolves it to canonicalKey on the new card — that computed identity is what
// sifNominate's crossref channel reads, and the unit fixtures below carry it AS that flatten-computed
// field, never as a card property.) Candidates are NEVER re-embedded: the bridge reads
// embedding/embedText off the card, refuses BY NAME a card lacking either (proven OBSERVED-RED in
// SECTION 8.5), and batchEmbeds ONLY the source composites (asserted, G-15). The old hub-DmeClass
// domain-map read is DELETED from the bridge, so no stub serves it; SECTION 4/5 run the REAL
// lib.d/cedsHubModule (the MEANING presentation) instead of a hand-shaped tuple double.
//
// PROVES:
//   SECTION 1 — the pure helpers (tokenize/candidateTokens/overlapCoefficient/sharedTokens/
//     leafAndAncestorTokens/ancestryDescription/threeSlotComparisonDescription/
//     sequenceBaselineDescription/sequenceNeighborNamesDescription).
//   SECTION 2 — sifNominate in isolation: RED (a source with no leaf/ancestor tokens AND no cedsId
//     nominates nothing), GREEN (token-overlap nomination with a rationale naming the shared tokens),
//     the CROSSREF nomination (an exact cedsId match, ALWAYS included, overwriting a weaker
//     token-overlap nomination for the SAME candidate with the stronger rationale), and the TOPK cap.
//   SECTION 3 — sifWalk in isolation: THREE notes (ancestry, three-slot, sequence) on EVERY pool
//     candidate, the sibling-name graph-read enrichment (present when the graphReader resolves
//     siblings, gracefully absent when it does not), and the ONE global segment.
//   SECTION 4 — THE HEADLINE PROOF, through the REAL kit.evidenceComposer AND the REAL cedsHubModule:
//     a candidate absent from a narrow cosine top-K but token-sharing enters via sifNominate; a
//     candidate absent from BOTH cosine AND token overlap but carrying the source's OWN crossref
//     anchor ALSO enters, via the crossref channel; a candidate absent from all three channels is
//     ABSENT from the final pool; the package passes the REAL ⟪A3⟫ gate (which now proves the
//     MEANING contract on every considerations.tuple).
//   SECTION 5 — THE SMUGGLING GATE (⟪A3⟫) TWIN: RED — a deliberately candidate-naming segment IS
//     refused; GREEN — SIF_GLOBAL_SEGMENT, over the SAME pool, passes clean.
//   SECTION 6 — wiring-fault twins (RED then GREEN), direct calls, no bridgeMaker — every refusal
//     genericBridge.js/caseEvidenceBridge.js prove PLUS this bridge's own new refusal (a source
//     standard other than SIF).
//   SECTION 7 — THE FULL EVIDENCE FLOW through the REAL bridgeMaker.run(), REBRIDGE then MATERIALIZE:
//     the CROSSREF-recovered candidate (SIF's headline distinguishing feature — an author-declared
//     'CEDS ID' anchor, not an inferred token match) is the one the stub LLM picks, proving the
//     recovery reaches an ACTUAL written edge; the vectorizer is proven to have embedded ONLY source
//     texts (G-15); MATERIALIZE replays byte-identically with ZERO additional llmClient calls.
//   SECTION 8 — RESOLVER CHECK: 'sifEvidenceBridge' resolves to exactly ONE file via bridgeMaker's
//     standard-local search (source: 'sif').
//   SECTION 8.5 — ⟪hubReimplementation P3⟫ OBSERVED-RED refusal twins: a candidate carrying no
//     `embedding` is refused NAMING it; a candidate carrying no `embedText` is refused NAMING it —
//     both through the REAL bridgeMaker.run(), both refused before any judging occurs.
//   SECTION 9 — DETERMINISM UNDER CONCURRENCY (p8-judgeConcurrency): a staggered-delay concurrent
//     run and a concurrency-1 run produce BYTE-IDENTICAL frozen blocks.
//
// Run: node forges/sif/test/test-sifEvidenceBridge.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for forges/sif/bridges/sifEvidenceBridge.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the pure helpers, the nominate/walk hooks in isolation (including the crossref
     nomination channel), the headline nomination-recovers-recall proof (both token AND crossref
     channels) through the REAL evidenceComposer and REAL cedsHubModule, the ⟪A3⟫ smuggling-gate
     RED/GREEN twin, the bridge's own wiring-fault twins, the hubReimplementation P3 candidate-card
     refusals (no embedding / no embedText, OBSERVED RED), the full evidence flow (REBRIDGE then
     MATERIALIZE) through the REAL bridgeMaker.run() with a stubbed llmClient, and byte-identical
     frozen blocks under judge concurrency.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');

const bridgeModule = require('../bridges/sifEvidenceBridge');
const bridgeMakerModule = require('../../../apps/graph-builder/apps/bridge-maker/bridgeMaker');
const evidenceComposerFactory = require('../../../apps/graph-builder/apps/bridge-maker/lib/evidenceComposer');
const { evidencePackageViolation } = require('../../../apps/graph-builder/apps/bridge-maker/lib/evidenceContracts');
// the REAL hub module (⟪hubReimplementation P3⟫ the MEANING presentation, SPEC §6) — SECTION 4/5
// compose their tuples through it rather than a hand-shaped double, so the suite proves the bridge's
// hooks against the presentation the live pipeline actually renders.
const cedsHubModule = require('../../../apps/graph-builder/apps/bridge-maker/lib.d/cedsHubModule')();

const {
	tokenize,
	candidateTokens,
	overlapCoefficient,
	sharedTokens,
	leafAndAncestorTokens,
	ancestryDescription,
	threeSlotComparisonDescription,
	sequenceBaselineDescription,
	sequenceNeighborNamesDescription,
	sifNominate,
	sifWalk,
	SIF_GLOBAL_SEGMENT,
	SIF_NOMINATION_TOPK,
	MAPPING_TOOL,
	SOURCE_STANDARD,
} = bridgeModule;

// a representative SIF source field fixture, reused across sections.
const SOURCE_FIXTURE = {
	stableId: 'sif:field/StudentPersonal/Name/FirstName',
	name: 'FirstName',
	xpath: 'StudentPersonal/Name/FirstName',
	tableName: 'StudentPersonal',
	sequenceGroupLabel: 'Name',
	sequenceGroupKey: 'sif:fieldGroup:Name',
	sequenceOrdinal: 1,
	siblingCount: 3,
	orderSemantics: 'document',
	nativeType: 'normalizedString',
	cedsId: 'P900002',
};

// =====================================================================
// hubCandidateElementFor — ONE fixture builder for a FULL flattened HubReference element in the
// ⟪hubReimplementation P3⟫ card shape (SPEC §1/§6): every MEANING field ON the element, its
// forge-composed embedText and forge-stamped embedding, and NO cedsId/description/searchText/
// allDomainIds/allDomainNames as CARD fields. Two fields mirror lib.d/sourceWalker.js
// flattenFullRecord's OWN computed identities over the new card (they are flatten products, not card
// properties): `defText` (the chain resolves to the element's own name — the card stores its prose
// in propertyDefinition, which that chain never reads) and `cedsId` (resolves to canonicalKey; the
// identity sifNominate's crossref channel reads). `vector` mirrors the bridge's own candidate step
// (candidate.vector = candidate.embedding).
// =====================================================================
const hubCandidateElementFor = ({ stableId, canonicalKey, name, domainId, domainName, domainDefinition, propertyDefinition, embedding }) => ({
	stableId,
	role: 'HubReference',
	referenceTier: 'property',
	canonicalKey,
	propertyKey: canonicalKey,
	name,
	defText: name,
	cedsId: canonicalKey,
	domainId,
	domainName,
	domainDefinition,
	propertyName: name,
	propertyDefinition,
	rangeDatatype: 'string',
	embedText: `${domainName} · ${name} · ${propertyDefinition}`,
	embedding,
	vector: embedding,
});

// =====================================================================
harness.section('SECTION 1 — the pure helpers');
// =====================================================================
(() => {
	harness.equal('tokenize: camelCase boundary split, lowercased', JSON.stringify(tokenize('FirstName')), JSON.stringify(['first', 'name']));
	harness.equal("tokenize: leading '@' (SIF XML attribute) is stripped", JSON.stringify(tokenize('@RefId')), JSON.stringify(['ref']));
	harness.equal('tokenize: null/undefined -> empty array', JSON.stringify(tokenize(undefined)), '[]');

	const candTokens = candidateTokens({ name: 'First Given Name', defText: 'The first name of a person.' });
	harness.equal('candidateTokens: name+defText tokenized and unioned, stopwords dropped', JSON.stringify([...candTokens].sort()), JSON.stringify(['first', 'given', 'name', 'person']));

	harness.equal('overlapCoefficient: full containment of the smaller set scores 1.0', overlapCoefficient(new Set(['a1', 'bb2']), new Set(['a1', 'bb2', 'cc3'])), 1);
	harness.equal('overlapCoefficient: empty set on either side scores 0', overlapCoefficient(new Set(['a1']), new Set()), 0);

	harness.equal(
		'sharedTokens: the ACTUAL intersecting tokens, not a re-hidden score',
		JSON.stringify(sharedTokens(new Set(['first', 'name']), { name: 'First Given Name', defText: '' }).sort()),
		JSON.stringify(['first', 'name']),
	);
	harness.equal('sharedTokens: no overlap -> empty array', JSON.stringify(sharedTokens(new Set(['first']), { name: 'Generic Caption', defText: '' })), '[]');

	harness.equal(
		'leafAndAncestorTokens: leaf name + sequenceGroupLabel tokens, unioned',
		JSON.stringify([...leafAndAncestorTokens(SOURCE_FIXTURE)].sort()),
		JSON.stringify(['first', 'name']),
	);
	harness.ok('leafAndAncestorTokens: a source with neither name nor label -> empty set', leafAndAncestorTokens({}).size === 0);

	harness.match(
		"ancestryDescription: names the owning SIF object AND the full xpath ancestry chain",
		ancestryDescription(SOURCE_FIXTURE),
		/SIF object 'StudentPersonal'.*StudentPersonal > Name > FirstName/s,
	);

	const candidate = { name: 'First Given Name', domainId: 'C200002', rangeDatatype: 'string' };
	const threeSlot = threeSlotComparisonDescription(SOURCE_FIXTURE, candidate);
	harness.match('threeSlotComparisonDescription: leaf slot names both sides', threeSlot, /leaf: SIF field 'FirstName' vs CEDS property name 'First Given Name'/);
	harness.match('threeSlotComparisonDescription: ancestor slot names both sides', threeSlot, /ancestor: SIF ancestor 'Name' vs CEDS domain 'C200002'/);
	harness.match('threeSlotComparisonDescription: value-hint slot names both sides', threeSlot, /value hint: SIF native type\/format 'normalizedString' vs CEDS range 'string'/);

	harness.match('sequenceBaselineDescription: states position among true siblings, honestly document-order', sequenceBaselineDescription(SOURCE_FIXTURE), /child 2 of 3 under 'Name'.*orderSemantics: document/s);
	harness.equal('sequenceBaselineDescription: a source with no sequence stamp is honest, not fabricated', sequenceBaselineDescription({}), 'Sequence context: not available for this source element (no sequence stamp).');

	const siblingNodes = [
		{ properties: { name: 'Prefix', sequenceOrdinal: 0 } },
		{ properties: { name: 'FirstName', sequenceOrdinal: 1 } },
		{ properties: { name: 'LastName', sequenceOrdinal: 2 } },
	];
	harness.match('sequenceNeighborNamesDescription: preceded by + followed by, both named', sequenceNeighborNamesDescription(SOURCE_FIXTURE, siblingNodes), /preceded by 'Prefix'.*followed by 'LastName'/);
	harness.match('sequenceNeighborNamesDescription: FIRST child says so honestly', sequenceNeighborNamesDescription({ ...SOURCE_FIXTURE, sequenceOrdinal: 0 }, siblingNodes), /\(first child\).*followed by 'FirstName'/);
	harness.match('sequenceNeighborNamesDescription: LAST child says so honestly', sequenceNeighborNamesDescription({ ...SOURCE_FIXTURE, sequenceOrdinal: 2 }, siblingNodes), /preceded by 'FirstName'.*\(last child\)/);
	harness.equal('sequenceNeighborNamesDescription: no siblings resolved -> null (caller keeps the walk-free baseline alone)', sequenceNeighborNamesDescription(SOURCE_FIXTURE, []), null);
	harness.equal('sequenceNeighborNamesDescription: no ordinal on source -> null', sequenceNeighborNamesDescription({}, siblingNodes), null);
})();

// =====================================================================
harness.section('SECTION 2 — sifNominate in isolation');
// =====================================================================
(() => {
	// ⟪hubReimplementation P3⟫ NEW-shape cards; each element's `cedsId` is the flatten-computed
	// identity (== canonicalKey), which is exactly what the crossref channel exact-matches.
	const candTokenMatch = hubCandidateElementFor({
		stableId: 'ceds:P900099', canonicalKey: 'P900099', name: 'First Given Name',
		domainId: 'C200002', domainName: 'Person Name', domainDefinition: 'The name parts of a person.',
		propertyDefinition: 'The first name of a person.', embedding: [0, 1],
	});
	const candCrossRefOnly = hubCandidateElementFor({
		stableId: 'ceds:P900002x', canonicalKey: 'P900002', name: 'Unrelated Widget Descriptor',
		domainId: 'C200005', domainName: 'Widget Registry', domainDefinition: 'Registry entries for widgets.',
		propertyDefinition: 'Nothing to do with names at all.', embedding: [0, -1],
	});
	const candIrrelevant = hubCandidateElementFor({
		stableId: 'ceds:P900003', canonicalKey: 'P900003', name: 'Generic Caption',
		domainId: 'C200001', domainName: 'Display Artifact', domainDefinition: 'Presentational display artifacts.',
		propertyDefinition: 'A generic caption used for display purposes.', embedding: [1, 0],
	});

	// RED — a source with NEITHER usable tokens NOR a cedsId nominates NOTHING.
	let redResult = null;
	sifNominate({ sourceElement: {}, candidateElements: [candTokenMatch, candCrossRefOnly, candIrrelevant] }, (err, nominations) => {
		redResult = { err, nominations };
	});
	harness.equal('RED: a source with no signal nominates zero candidates', redResult && redResult.nominations.length, 0);
	harness.equal('RED: no error either — an empty nomination list is honest, not a fault', redResult && redResult.err, '');

	// GREEN (token channel) — the token-sharing candidate is nominated; the irrelevant one is not.
	let greenResult = null;
	sifNominate({ sourceElement: { name: 'FirstName', sequenceGroupLabel: 'Name' }, candidateElements: [candTokenMatch, candIrrelevant] }, (err, nominations) => {
		greenResult = { err, nominations };
	});
	harness.equal('GREEN (token): no error', greenResult && greenResult.err, '');
	harness.equal('GREEN (token): exactly ONE candidate nominated (the token-sharing one)', greenResult && greenResult.nominations.length, 1);
	harness.equal('GREEN (token): the nominated candidate IS candTokenMatch', greenResult.nominations[0].candidate, candTokenMatch);
	harness.equal("GREEN (token): nominatedBy is this bridge's own MAPPING_TOOL", greenResult.nominations[0].nominatedBy, MAPPING_TOOL);
	harness.match('GREEN (token): the rationale names the leaf/ancestor and the shared tokens', greenResult.nominations[0].rationale, /leaf 'FirstName'.*ancestor 'Name'.*first.*name/s);

	// GREEN (crossref channel) — an EXACT cedsId match is nominated even with ZERO token overlap.
	let crossRefResult = null;
	sifNominate({ sourceElement: SOURCE_FIXTURE, candidateElements: [candCrossRefOnly, candIrrelevant] }, (err, nominations) => {
		crossRefResult = { err, nominations };
	});
	harness.equal('CROSSREF: exactly ONE candidate nominated (the cedsId-matching one, despite zero token overlap)', crossRefResult && crossRefResult.nominations.length, 1);
	harness.equal('CROSSREF: the nominated candidate IS candCrossRefOnly', crossRefResult.nominations[0].candidate, candCrossRefOnly);
	harness.match('CROSSREF: the rationale names the authored-cross-reference evidence class', crossRefResult.nominations[0].rationale, /authored cross-reference.*P900002.*strongest evidence class/s);

	// COLLISION — when the SAME candidate is BOTH token-nominated and crossref-nominated, the
	// crossref rationale WINS (the stronger evidence class), never diluted or duplicated.
	const candBoth = hubCandidateElementFor({
		stableId: 'ceds:P900002', canonicalKey: 'P900002', name: 'First Given Name',
		domainId: 'C200002', domainName: 'Person Name', domainDefinition: 'The name parts of a person.',
		propertyDefinition: 'The first name of a person.', embedding: [0, 1],
	});
	let collisionResult = null;
	sifNominate({ sourceElement: SOURCE_FIXTURE, candidateElements: [candBoth] }, (err, nominations) => {
		collisionResult = { err, nominations };
	});
	harness.equal('COLLISION: exactly ONE nomination entry for the doubly-qualifying candidate', collisionResult && collisionResult.nominations.length, 1);
	harness.match('COLLISION: the SURVIVING rationale is the crossref one, not the token one', collisionResult.nominations[0].rationale, /authored cross-reference/);

	// CAP — SIF_NOMINATION_TOPK bounds the TOKEN-overlap nomination list.
	const manyOverlapping = Array.from({ length: SIF_NOMINATION_TOPK + 5 }, (v, i) =>
		hubCandidateElementFor({
			stableId: `ceds:Pmany${i}`, canonicalKey: `Pmany${i}`, name: `First Name Variant ${i}`,
			domainId: 'C200002', domainName: 'Person Name', domainDefinition: 'The name parts of a person.',
			propertyDefinition: `Variant ${i} of the first name.`, embedding: [0, 1],
		}),
	);
	let cappedResult = null;
	sifNominate({ sourceElement: { name: 'FirstName', sequenceGroupLabel: 'Name' }, candidateElements: manyOverlapping }, (err, nominations) => {
		cappedResult = { err, nominations };
	});
	harness.equal(`CAP: token-overlap nominations never exceed SIF_NOMINATION_TOPK (${SIF_NOMINATION_TOPK})`, cappedResult && cappedResult.nominations.length, SIF_NOMINATION_TOPK);
})();

// =====================================================================
harness.section('SECTION 3 — sifWalk in isolation');
// =====================================================================
(() => {
	const candA = hubCandidateElementFor({
		stableId: 'ceds:P900099', canonicalKey: 'P900099', name: 'First Given Name',
		domainId: 'C200002', domainName: 'Person Name', domainDefinition: 'The name parts of a person.',
		propertyDefinition: 'The first name of a person.', embedding: [0, 1],
	});
	const candB = hubCandidateElementFor({
		stableId: 'ceds:P900003', canonicalKey: 'P900003', name: 'Generic Caption',
		domainId: 'C200003', domainName: 'Display Artifact', domainDefinition: 'Presentational display artifacts.',
		propertyDefinition: 'A generic caption used for display purposes.', embedding: [1, 0],
	});

	// no graphReader at all -> degrades gracefully to the walk-free baseline (no throw).
	let walkResultNoReader = null;
	sifWalk({ sourceElement: SOURCE_FIXTURE, pool: [candA, candB], graphReader: null, dependencies: ['sif', 'ceds'] }, (err, result) => {
		walkResultNoReader = { err, result };
	});
	harness.equal('sifWalk (no graphReader): no error', walkResultNoReader && walkResultNoReader.err, '');
	harness.equal('sifWalk (no graphReader): a note-triple for BOTH pool candidates', Object.keys(walkResultNoReader.result.perCandidateNotes).length, 2);
	const notesA = walkResultNoReader.result.perCandidateNotes['ceds:P900099'];
	harness.equal('sifWalk: EXACTLY THREE notes per candidate (ancestry, three-slot, sequence)', notesA.length, 3);
	harness.match('  note 1 is the ancestry note', notesA[0], /SIF source location/);
	harness.match('  note 2 is the three-slot comparison', notesA[1], /Three-slot comparison/);
	harness.match('  note 3 is the sequence context, WITHOUT sibling names (no graphReader)', notesA[2], /child 2 of 3 under 'Name'/);
	harness.ok('  note 3 carries no sibling-name enrichment when there is no graphReader', !/preceded by|followed by/.test(notesA[2]));
	harness.equal('sifWalk: EXACTLY ONE global segment', walkResultNoReader.result.promptSegments.length, 1);
	harness.equal('sifWalk: the global segment IS SIF_GLOBAL_SEGMENT', walkResultNoReader.result.promptSegments[0], SIF_GLOBAL_SEGMENT);

	// a graphReader double THAT RESOLVES siblings -> the sequence note is ENRICHED with neighbor names.
	const siblingGraphReader = {
		readNodes: ({ label, propertyEquals }, callback) => {
			harness.equal('sifWalk: the sibling read is scoped by label SifField', label, 'SifField');
			harness.equal('sifWalk: the sibling read is scoped by _source SIF and the SAME sequenceGroupKey', JSON.stringify(propertyEquals), JSON.stringify({ _source: 'SIF', sequenceGroupKey: 'sif:fieldGroup:Name' }));
			callback('', {
				nodes: [
					{ properties: { name: 'Prefix', sequenceOrdinal: 0 } },
					{ properties: { name: 'FirstName', sequenceOrdinal: 1 } },
					{ properties: { name: 'LastName', sequenceOrdinal: 2 } },
				],
			});
		},
	};
	let walkResultWithReader = null;
	sifWalk({ sourceElement: SOURCE_FIXTURE, pool: [candA], graphReader: siblingGraphReader, dependencies: ['sif', 'ceds'] }, (err, result) => {
		walkResultWithReader = { err, result };
	});
	harness.equal('sifWalk (with graphReader): no error', walkResultWithReader && walkResultWithReader.err, '');
	const enrichedNote = walkResultWithReader.result.perCandidateNotes['ceds:P900099'][2];
	harness.match('sifWalk (with graphReader): the sequence note is enriched with BOTH neighbor names', enrichedNote, /preceded by 'Prefix'.*followed by 'LastName'/);

	// a FAILING graphReader -> degrades honestly to the baseline, never an error.
	const failingGraphReader = { readNodes: (spec, callback) => { void spec; callback('boom'); } };
	let walkResultFailing = null;
	sifWalk({ sourceElement: SOURCE_FIXTURE, pool: [candA], graphReader: failingGraphReader, dependencies: ['sif', 'ceds'] }, (err, result) => {
		walkResultFailing = { err, result };
	});
	harness.equal('sifWalk (failing graphReader): STILL no error at the walk-hook level', walkResultFailing && walkResultFailing.err, '');
	harness.match('sifWalk (failing graphReader): degrades to the walk-free baseline', walkResultFailing.result.perCandidateNotes['ceds:P900099'][2], /child 2 of 3 under 'Name'/);
})();

// =====================================================================
harness.section('SECTION 4 — THE HEADLINE PROOF: token AND crossref recovery, through the REAL evidenceComposer');
// =====================================================================
(() => {
	// candA — HIGH-cosine, structurally UNRELATED (retrieved by cosine alone).
	// candB — ZERO-cosine, TOKEN-overlap related (leaf 'FirstName' + ancestor 'Name') — recoverable
	//   ONLY via sifNominate's token channel with a narrow topK=1 cosine slice.
	// candC — ZERO-cosine, ZERO token overlap, but its OWN canonicalKey (the flatten-computed cedsId)
	//   matches the source's authored crossref anchor exactly — recoverable ONLY via the crossref channel.
	// candD — ZERO-cosine, ZERO token overlap, WRONG key — must be ABSENT from the final pool.
	// ⟪hubReimplementation P3⟫ each candidate is a FULL new-shape card element; its `vector` is its own
	// forge-stamped `embedding` (the bridge's candidate step), never a re-embed.
	const source = { ...SOURCE_FIXTURE, vector: [1, 0] };
	const candA = hubCandidateElementFor({
		stableId: 'ceds:P900001', canonicalKey: 'P900001', name: 'Generic Caption',
		domainId: 'C200001', domainName: 'Display Artifact', domainDefinition: 'Presentational display artifacts.',
		propertyDefinition: 'A generic caption used for display purposes.', embedding: [0.99, Math.sqrt(1 - 0.99 * 0.99)],
	});
	const candB = hubCandidateElementFor({
		stableId: 'ceds:P900099', canonicalKey: 'P900099', name: 'First Given Name',
		domainId: 'C200002', domainName: 'Person Name', domainDefinition: 'The name parts of a person.',
		propertyDefinition: 'The first name of a person.', embedding: [0, 1],
	});
	const candC = hubCandidateElementFor({
		stableId: 'ceds:P900002x', canonicalKey: 'P900002', name: 'Unrelated Widget Descriptor',
		domainId: 'C200005', domainName: 'Widget Registry', domainDefinition: 'Registry entries for widgets.',
		propertyDefinition: 'Nothing to do with names at all.', embedding: [0, -1],
	});
	const candD = hubCandidateElementFor({
		stableId: 'ceds:P900003', canonicalKey: 'P900003', name: 'Totally Unrelated Other Thing',
		domainId: 'C200006', domainName: 'Sundries', domainDefinition: 'Everything else.',
		propertyDefinition: 'Shares nothing with the source.', embedding: [-1, 0],
	});
	const candidateElements = [candA, candB, candC, candD];

	const cosine = (a, b) => {
		if (!a || !b) return -1;
		let dot = 0, na = 0, nb = 0;
		for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
		return na === 0 || nb === 0 ? -1 : dot / (Math.sqrt(na) * Math.sqrt(nb));
	};
	const narrowSemanticMatcher = {
		cosine,
		retrieve: (src, pool) => pool.map((c) => ({ candidate: c, cosine: cosine(src.vector, c.vector) })).sort((a, b) => b.cosine - a.cosine).slice(0, 1),
	};

	// ⟪hubReimplementation P3⟫ the REAL cedsHubModule renders each candidate's MEANING presentation
	// (SPEC §6) from the card's own fields — the hand-shaped tuple double this section used to carry
	// described the RETIRED card shape and would now be refused by the ⟪A3⟫ gate itself.
	const noopGraphReader = { readNodes: (spec, cb) => { void spec; cb('', { nodes: [] }); }, close: (cb) => cb('') };

	const composer = evidenceComposerFactory({ semanticMatcher: narrowSemanticMatcher, nominate: sifNominate, walk: sifWalk, dependencies: ['sif', 'ceds'] });

	let composed = null;
	composer({ sourceElement: source, candidateElements, graphReader: noopGraphReader, hubModule: cedsHubModule }, (err, evidencePackage) => {
		composed = { err, evidencePackage };
	});

	harness.equal('composer: no error', composed && composed.err, '');
	const pool = composed.evidencePackage.pool;
	const poolIds = pool.map((e) => e.candidate.stableId).sort();
	harness.equal(
		'the pool is EXACTLY {candA (cosine top-K), candB (token-nominated), candC (crossref-nominated)} — candD is ABSENT',
		JSON.stringify(poolIds),
		JSON.stringify(['ceds:P900001', 'ceds:P900002x', 'ceds:P900099']),
	);

	const candBEntry = pool.find((e) => e.candidate.stableId === 'ceds:P900099');
	harness.ok('candB entered the pool carrying a `nomination` (⟪A1⟫, token channel)', !!candBEntry.nomination);
	harness.match('candB\'s nomination rationale names the shared tokens', candBEntry.nomination.rationale, /first.*name/s);

	const candCEntry = pool.find((e) => e.candidate.stableId === 'ceds:P900002x');
	harness.ok('candC entered the pool carrying a `nomination` (⟪A1⟫, crossref channel)', !!candCEntry.nomination);
	harness.match('candC\'s nomination rationale names the authored-crossref evidence class', candCEntry.nomination.rationale, /authored cross-reference/);
	harness.equal(
		'candC\'s cosine field is its OWN base cosine (0, computed fresh since it was NOT cosine-retrieved), never fabricated',
		Math.round(candCEntry.cosine * 1e6) / 1e6,
		0,
	);

	const candAEntry = pool.find((e) => e.candidate.stableId === 'ceds:P900001');
	harness.ok('candA (cosine-retrieved only) carries NO nomination field', !candAEntry.nomination);

	// ⟪hubReimplementation P3⟫ the tuple is the MEANING presentation — the card's own domain name and
	// definition prose, composed by the REAL cedsHubModule, sit ON the pool entry.
	harness.equal('candC\'s considerations.tuple carries the card\'s own domainName (MEANING, not an opaque id)', candCEntry.considerations.tuple.domain.domainName, 'Widget Registry');
	harness.equal('candC\'s considerations.tuple carries the card\'s own propertyDefinition', candCEntry.considerations.tuple.property.propertyDefinition, 'Nothing to do with names at all.');

	// per-candidate consideration content — every pool member carries the three-note shape.
	pool.forEach((oneEntry) => {
		harness.equal(`  candidate ${oneEntry.candidate.stableId}: THREE considerations.notes`, oneEntry.considerations.notes.length, 3);
	});

	// the global segment: present, ONCE, deduped.
	harness.equal('promptSegments carries EXACTLY ONE entry', composed.evidencePackage.promptSegments.length, 1);
	harness.equal('the ONE entry IS SIF_GLOBAL_SEGMENT', composed.evidencePackage.promptSegments[0], SIF_GLOBAL_SEGMENT);

	// ⟪A3⟫ THE REAL GATE — the composed package is proven, not merely asserted, contract-conforming
	// (and the gate now proves the MEANING contract on every considerations.tuple, SPEC §6).
	harness.equal('the composed evidencePackage passes the REAL evidencePackageViolation oracle (⟪A3⟫)', evidencePackageViolation(composed.evidencePackage), '');
})();

// =====================================================================
harness.section('SECTION 5 — THE SMUGGLING GATE (⟪A3⟫) TWIN: a candidate-naming segment is RED; SIF_GLOBAL_SEGMENT is GREEN');
// =====================================================================
(() => {
	// ⟪hubReimplementation P3⟫ the pool entry's tuple is composed by the REAL cedsHubModule from a
	// new-shape card — the ⟪A3⟫ gate proves the tuple's MEANING shape before it ever reaches the
	// smuggling scan, so a bare {referenceTier} stand-in would fail for the WRONG reason.
	const smugglingCandidate = hubCandidateElementFor({
		stableId: 'ceds:P900002x', canonicalKey: 'P900002', name: 'Unrelated Widget Descriptor',
		domainId: 'C200005', domainName: 'Widget Registry', domainDefinition: 'Registry entries for widgets.',
		propertyDefinition: 'Nothing to do with names at all.', embedding: [0, -1],
	});
	let smugglingTuple = null;
	cedsHubModule(smugglingCandidate, (hubErr, presentation) => {
		harness.equal('fixture check: the REAL cedsHubModule composes the smuggling-pool tuple with no error', hubErr, '');
		smugglingTuple = presentation;
	});
	const pool = [
		{
			candidate: smugglingCandidate,
			cosine: 0,
			considerations: { tuple: smugglingTuple, notes: [] },
		},
	];

	// RED — a segment that NAMES a specific candidate's identifying token, exactly the smuggling shape
	// ⟪A3⟫ exists to catch.
	const smugglingPackage = { sourceElement: { name: 's' }, pool, promptSegments: ['Candidate P900002 is a strong match — prefer it.'] };
	const redViolation = evidencePackageViolation(smugglingPackage);
	harness.ok('RED: a candidate-naming global segment IS refused by the REAL evidencePackageViolation', !!redViolation);
	harness.match('RED: the refusal names the smuggling reason', redViolation, /candidate-specific token/);

	// GREEN — SIF_GLOBAL_SEGMENT, run through the SAME gate over the SAME pool, passes clean — it is
	// written entirely about SIF-the-standard's own naming habits, never a candidate (file header CAUTION).
	const cleanPackage = { sourceElement: { name: 's' }, pool, promptSegments: [SIF_GLOBAL_SEGMENT] };
	harness.equal('GREEN: SIF_GLOBAL_SEGMENT over the SAME pool passes the REAL gate clean', evidencePackageViolation(cleanPackage), '');
})();

// =====================================================================
harness.section("SECTION 6 — the bridge's own wiring-fault twins (RED then GREEN), direct calls, no bridgeMaker");
// =====================================================================

const noopGraphReader6 = { readNodes: (spec, cb) => { void spec; cb('', { nodes: [] }); }, close: (cb) => cb('') };
const noopSourceWalker6 = { walk: (spec, cb) => { void spec; cb('', { sourceNodes: [] }); } };
const noopEvidenceFreezer6 = {
	freeze: () => ({ frozenText: '{}', decisionBlockHash: 'h', inferredDecisions: [], generation: 'g', rendererVersion: 'r', frozenEvidence: [] }),
	parse: () => ({ inferredDecisions: [], frozenEvidence: [] }),
};
const noopMaterializerFactory6 = () => ({ buildInferredSubgraph: () => ({ edges: [], counts: { orphans: 0, fromGaps: 0 } }) });
const noopWriter6 = (spec, cb) => { void spec; cb('', { edgeWritten: true }); };
const noBlockDecisionStore6 = {
	getDecisionBlock: (a, cb) => { void a; cb('', { frozenText: null }); },
	saveDecisionBlock: (a, cb) => { void a; cb(''); },
};

const baseKit6 = (overrides = {}) => ({
	config: { sourceStandard: 'sif' },
	decisionStore: noBlockDecisionStore6,
	rebridge: false,
	graphReader: noopGraphReader6,
	sourceWalker: noopSourceWalker6,
	evidenceFreezer: noopEvidenceFreezer6,
	materializer: noopMaterializerFactory6,
	writer: noopWriter6,
	vectorizer: null,
	semanticMatcher: null,
	evidenceComposer: null,
	cedsHubModule: null,
	evidenceRenderer: null,
	evidenceSelect: null,
	confidenceNormalizer: null,
	inferenceConfig: {},
	...overrides,
});

const runDirect6 = (injectedTools, spec, done) => bridgeModule(injectedTools)(spec, done);
const BASE_ARGS6 = { inGraph: { graphName: 'DEV_probe' }, hub: 'ceds', applyLabel: 'BridgedRelation' };

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6() }, BASE_ARGS6, (err, result) => { observed = { err, result }; });
	harness.equal('GREEN base case: a valid materialize-no-block kit runs with no error', observed && observed.err, '');
	harness.ok('  and returns the honest zero-edge / null-decisionBlock status', observed && observed.result && observed.result.edgesWritten === 0 && observed.result.decisionBlock === null);
})();

(() => {
	let observed = null;
	runDirect6({}, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects('RED: injectedTools.kit is not given is refused by name', [observed], /injectedTools\.kit is not given/);
})();

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ decisionStore: null }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects('RED: kit.decisionStore missing is refused by name', [observed], /kit\.decisionStore .*REQUIRED/);
})();

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ rebridge: true }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects(
		'RED: --rebridge with the evidence-path kit members missing is refused by name',
		[observed],
		/kit\.(vectorizer|semanticMatcher|evidenceComposer|cedsHubModule|evidenceRenderer|evidenceSelect|confidenceNormalizer) is missing/,
	);
})();

(() => {
	let observed = null;
	runDirect6(
		{
			kit: baseKit6({
				rebridge: true,
				vectorizer: {}, semanticMatcher: {}, evidenceComposer: () => {}, cedsHubModule: () => {},
				evidenceRenderer: { render: () => {}, RENDERER_VERSION: 'v1' }, evidenceSelect: () => {}, confidenceNormalizer: () => {},
				inferenceConfig: {},
			}),
		},
		BASE_ARGS6,
		(err) => { observed = err; },
	);
	harness.rejects('RED: --rebridge with kit.inferenceConfig.llmClient missing is refused by name', [observed], /kit\.inferenceConfig\.llmClient .*is missing.*SELECT_SHAPE/s);
})();

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6() }, { ...BASE_ARGS6, hub: 'case' }, (err) => { observed = err; });
	harness.rejects('RED: hub other than CEDS is refused by name', [observed], /hub is 'case'.*CEDS hub only/);
})();

(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ config: {} }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects('RED: config.sourceStandard not set is refused by name', [observed], /config\.sourceStandard is not set/);
})();

// ---- THIS BRIDGE'S OWN new refusal — a source standard other than SIF ----
(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ config: { sourceStandard: 'lif' } }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.rejects(
		`RED (new to this bridge): source standard other than ${SOURCE_STANDARD} is refused by name`,
		[observed],
		/sourceStandard is 'LIF', but this bridge sources from SIF only/,
	);
})();
(() => {
	let observed = null;
	runDirect6({ kit: baseKit6({ config: { sourceStandard: 'sif' } }) }, BASE_ARGS6, (err) => { observed = err; });
	harness.equal('GREEN twin: sourceStandard=sif is accepted (no error)', observed, '');
})();

(() => {
	let observed = null;
	const { applyLabel, ...withoutLabel } = BASE_ARGS6;
	void applyLabel;
	runDirect6({ kit: baseKit6() }, withoutLabel, (err) => { observed = err; });
	harness.rejects('RED: applyLabel not given is refused by name', [observed], /applyLabel/);
})();

(() => {
	let observed = null;
	const { inGraph, ...withoutGraph } = BASE_ARGS6;
	void inGraph;
	runDirect6({ kit: baseKit6() }, withoutGraph, (err) => { observed = err; });
	harness.rejects('RED: inGraph not given is refused by name', [observed], /inGraph is not given/);
})();

// =====================================================================
harness.section('SECTION 7 — THE FULL EVIDENCE FLOW through the REAL bridgeMaker.run(): REBRIDGE then MATERIALIZE');
// =====================================================================

// ONE SIF source whose OWN authored crossref anchor (cedsId) points at a candidate a narrow cosine
// top-K (topK=1) would otherwise NEVER see — driven end-to-end so the recovery is proven to reach an
// ACTUAL written edge, not merely the composer's own pool (SECTION 4's proof).
//
// ⟪hubReimplementation P3⟫ each HubReference is the NEW self-sufficient card (SPEC §1): its MEANING
// fields, its stored `embedText` (never re-embedded here — G-15's whole assertion), and its
// forge-stamped `embedding` — a FLAT number[] exactly as forgeCeds stamps properties.embedding, which
// lib.d/sourceWalker.js flattenFullRecord's LIST_VALUED_PROPERTY_NAMES registry (supervisor ruling
// 2026-08-03) passes through VERBATIM instead of v1-collapsing to its first float. The cards carry
// NO cedsId property; the flatten-computed cedsId (== canonicalKey) is the identity the crossref
// channel and the facet scan's anchorMatch read.
const ADDR1_EMBEDDING_7 = [0.99, Math.sqrt(1 - 0.99 * 0.99)];
const ADDR2_EMBEDDING_7 = [-1, 0];
const referenceNodesRaw7 = [
	{
		stableId: 'cedsHubRef:addr1',
		properties: {
			role: 'HubReference', referenceTier: 'property', canonicalKey: 'P900001', propertyKey: 'P900001',
			name: 'Generic Caption', domainId: 'C200001', domainName: 'Display Artifact',
			domainDefinition: 'Presentational display artifacts and captions.',
			propertyName: 'Generic Caption', propertyDefinition: 'A generic caption used for display purposes.',
			rangeDatatype: 'string',
			embedText: 'Display Artifact · Generic Caption · A generic caption used for display purposes.',
			embedding: ADDR1_EMBEDDING_7,
		},
	},
	{
		stableId: 'cedsHubRef:addr2',
		properties: {
			role: 'HubReference', referenceTier: 'property', canonicalKey: 'P900002', propertyKey: 'P900002',
			name: 'Unrelated Widget Descriptor', domainId: 'C200002', domainName: 'Widget Registry',
			domainDefinition: 'Registry entries for widgets.',
			propertyName: 'Unrelated Widget Descriptor', propertyDefinition: 'Nothing to do with names at all.',
			rangeDatatype: 'string',
			embedText: 'Widget Registry · Unrelated Widget Descriptor · Nothing to do with names at all.',
			embedding: ADDR2_EMBEDDING_7,
		},
	},
];

const sourceGraphNodes7 = [
	{
		stableId: 'sif:field/StudentPersonal/Name/FirstName',
		properties: {
			_source: 'SIF', role: 'DmeProperty', name: 'FirstName', description: 'sourceDefText',
			xpath: 'StudentPersonal/Name/FirstName', tableName: 'StudentPersonal',
			sequenceGroupLabel: 'Name', sequenceGroupKey: 'sif:fieldGroup:Name',
			sequenceOrdinal: 1, siblingCount: 3, orderSemantics: 'document',
			cedsId: 'P900002', // the authored crossref anchor — the ONLY route to addr2 under topK=1
		},
	},
];

// ⟪hubReimplementation P3 (SPEC §6)⟫ the vectorizer double serves ONLY the SOURCE side now: every
// HubReference card arrives carrying its forge-stamped `embedding` (read off the card, never
// re-embedded — gate G-15), so textVectors7 maps just the source's composite embedText
// (lib/facetScan.js §4.1; this reader returns no SIF DmeClass nodes, so the composite is the field's
// name and description joined).
const textVectors7 = {
	'FirstName · sourceDefText': [1, 0], // the source's composite embedText
	// addr1's card embedding is near-parallel to the source (the HIGH-cosine wrong-domain distractor);
	// addr2's is anti-parallel — deliberately UNREACHABLE by cosine, reachable only via the AUTHORED
	// anchor (the crossref nomination, and ⟪P12⟫ the scan's unconditional anchorMatch seat).
};

// makeGraphReaderDouble7 — parameterized over the HubReference set so SECTION 8.5's refusal twins can
// serve deliberately-broken cards through the SAME reader shape. The bridge's remaining reads are:
// HubReference (the candidate cards), the SIF DmeProperty walk (the sources), the SIF DmeClass
// owning-class-map read (served honestly empty here), and sifWalk's sibling read (SifField — an
// honest empty read this run, so the walk-free baseline stands). The old hub-DmeClass domain-map read
// is DELETED from the bridge (the card carries domainName itself), so nothing serves it.
const makeGraphReaderDouble7 = (referenceNodes) => ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodes }); return; }
		if (eq._source === 'SIF' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes7 }); return; }
		if (label === 'SifField') { callback('', { nodes: [] }); return; } // no siblings resolved this run — an honest empty read
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});
const graphReaderDouble7 = makeGraphReaderDouble7(referenceNodesRaw7);

const makeWriterDouble7 = (writes) => ({ inGraph }) => ({
	writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
	close: (callback) => callback(''),
});

// batchEmbedTexts7 — EVERY text the pipeline ever asks the vectorizer to embed, recorded so SECTION 7
// can assert the list is the SOURCE composites and NOTHING else (G-15: zero candidate embeds).
const batchEmbedTexts7 = [];
const fakeVectorizerFactory7 = () => ({
	batchEmbed: ({ texts }, cb) => {
		batchEmbedTexts7.push(...(texts || []));
		cb('', { vectors: (texts || []).map((t) => textVectors7[t] || null) });
	},
});

const runConfig7 = { sourceStandard: 'sif', sourceVersion: 'v1', hubVersion: 'v14.0.0.0', dependencies: ['sif', 'ceds'] };

// stubLlm — distinguishes addr2 (the crossref-recovered candidate) by its OWN rendered header line —
// the one honest signal available to a hermetic stub standing in for a real model that WOULD read the
// full evidence (including the "authored cross-reference" note) and judge accordingly.
let rerankCallCount7 = 0;
const stubLlm7 = {
	rerank: (spec, callback) => {
		rerankCallCount7 += 1;
		const match = spec.userPrompt.match(/(\d+)\) Unrelated Widget Descriptor/);
		if (match) {
			callback('', { choice: match[1], category: 'strong', rationale: "the candidate carries this SIF field's own authored cross-reference anchor" });
			return;
		}
		callback('', { choice: 'NONE', rationale: 'no candidate is supported by the evidence' });
	},
};

const rebridgeWrites7 = [];
const decisionBlocks7 = {};
const decisionStore7 = {
	getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocks7[pairKey] ? { frozenText: decisionBlocks7[pairKey].frozenText } : { frozenText: null }),
	saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocks7[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
};

let rebridgeReport7 = null;
bridgeMakerModule({ graphWriterFactory: makeWriterDouble7(rebridgeWrites7), graphReaderFactory: graphReaderDouble7 }).run(
	{
		inGraph: { graphName: 'DEV_sif_evidence_rb', boltUrl: 'bolt://x', password: 'x' },
		bridge: 'sifEvidenceBridge', source: 'sif', hub: 'ceds', applyLabel: 'BridgedRelation',
		rebridge: true, decisionStore: decisionStore7,
		inferenceConfig: { llmClient: stubLlm7, topK: 1, cosineFloor: -1, concurrency: 4 },
		config: runConfig7,
		componentOverrides: { vectorizer: fakeVectorizerFactory7, graphReader: graphReaderDouble7 },
	},
	(err, report) => { rebridgeReport7 = { err, report }; },
);

harness.ok(`REBRIDGE did not error (${(rebridgeReport7 && rebridgeReport7.err) || 'ok'})`, rebridgeReport7 && !rebridgeReport7.err, rebridgeReport7 && rebridgeReport7.err);
harness.equal('REBRIDGE: exactly 1 rerank call (one source)', rerankCallCount7, 1);
harness.equal('REBRIDGE: exactly ONE edge written', rebridgeReport7.report && rebridgeReport7.report.edgesWritten, 1);
harness.equal("REBRIDGE: result.generation is this bridge's own EVIDENCE_GENERATION tag", rebridgeReport7.report.generation, bridgeModule.EVIDENCE_GENERATION);
harness.equal(
	'EVIDENCE_GENERATION is the ⟪hubReimplementation P3⟫ tag (SPEC §6: card-borne candidate vectors + the meaning prompt re-judge the world)',
	bridgeModule.EVIDENCE_GENERATION,
	'sifEvidenceBridge-evidence-v6',
);

// ⟪hubReimplementation P3, G-15⟫ CANDIDATES ARE NEVER RE-EMBEDDED — the vectorizer was asked to embed
// EXACTLY the source composites, nothing else (the candidates' vectors came off their cards).
harness.equal(
	'REBRIDGE (G-15): batchEmbed received ONLY the source composite embedText — ZERO candidate texts',
	JSON.stringify(batchEmbedTexts7),
	JSON.stringify(['FirstName · sourceDefText']),
);

harness.ok('exactly one edge was written', rebridgeWrites7.length === 1, JSON.stringify(rebridgeWrites7));
const writtenEdge7 = rebridgeWrites7[0];
harness.equal(
	'THE HEADLINE PROOF, end-to-end: the written edge targets addr2 -- the CROSSREF-RECOVERED candidate, invisible to a topK=1 cosine retrieval alone',
	writtenEdge7 && writtenEdge7.toStableId,
	'cedsHubRef:addr2',
);
harness.equal("  mappingTool is this bridge's own name", writtenEdge7 && writtenEdge7.properties.mappingTool, MAPPING_TOOL);
harness.equal('  predicate is stamped as ever', writtenEdge7 && writtenEdge7.properties.predicate, 'closeMatch');

// the frozen block's own evidence entries, re-checked through the REAL parser — not merely trusted.
const evidenceFreezerFactory7 = require('../../../apps/graph-builder/apps/bridge-maker/lib/evidenceFreezer');
const frozenBlock7 = decisionBlocks7['CEDS::SIF'];
harness.ok('a real frozen evidence-decision block was saved under pairKey CEDS::SIF', !!frozenBlock7);
const parsedFrozen7 = evidenceFreezerFactory7().parse(frozenBlock7.frozenText);
harness.ok('the frozen block parses with no error', !parsedFrozen7.error, parsedFrozen7.error);
const s1Frozen7 = parsedFrozen7.frozenEvidence.find((e) => e.sourceStableId === 'sif:field/StudentPersonal/Name/FirstName');
harness.ok("s1's frozen evidence is retrievable", !!s1Frozen7);
// ⟪FREEZE-BY-REFERENCE, 2026-07-31⟫ the frozen entry carries the evidence's ADDRESS, not its bytes
// (the ⟪A3⟫ gate proved the package upstream, at compose time, before judging).
harness.ok("s1's frozen entry carries NO embedded evidencePackage (freeze-by-reference)", s1Frozen7.evidencePackage === undefined);
harness.ok("  and its evidencePackageRef carries a non-empty promptHash", s1Frozen7.evidencePackageRef && typeof s1Frozen7.evidencePackageRef.promptHash === 'string' && s1Frozen7.evidencePackageRef.promptHash.length > 0);
harness.equal("s1's frozen category is 'strong'", s1Frozen7.judgment.category, 'strong');

// =====================================================================
harness.section('SECTION 7 (cont.) — MATERIALIZE: the SAME frozen block replayed, ZERO llm calls');
// =====================================================================

const rerankCallsBeforeMaterialize7 = rerankCallCount7;
const embedTextCountBeforeMaterialize7 = batchEmbedTexts7.length;
const materializeWrites7 = [];
let materializeReport7 = null;
bridgeMakerModule({ graphWriterFactory: makeWriterDouble7(materializeWrites7), graphReaderFactory: graphReaderDouble7 }).run(
	{
		inGraph: { graphName: 'DEV_sif_evidence_mat', boltUrl: 'bolt://x', password: 'x' },
		bridge: 'sifEvidenceBridge', source: 'sif', hub: 'ceds', applyLabel: 'BridgedRelation',
		rebridge: false, decisionStore: decisionStore7,
		inferenceConfig: { llmClient: stubLlm7, topK: 1, cosineFloor: -1 },
		config: runConfig7,
		componentOverrides: { vectorizer: fakeVectorizerFactory7, graphReader: graphReaderDouble7 },
	},
	(err, report) => { materializeReport7 = { err, report }; },
);

harness.ok(`MATERIALIZE did not error (${(materializeReport7 && materializeReport7.err) || 'ok'})`, materializeReport7 && !materializeReport7.err, materializeReport7 && materializeReport7.err);
harness.equal('MATERIALIZE: ZERO additional rerank calls (pure replay, never re-judges)', rerankCallCount7, rerankCallsBeforeMaterialize7);
harness.equal('MATERIALIZE: ZERO additional batchEmbed texts (pure replay, never re-embeds anything)', batchEmbedTexts7.length, embedTextCountBeforeMaterialize7);
harness.equal('MATERIALIZE: the SAME edge count (1)', materializeReport7.report.edgesWritten, 1);
harness.equal('MATERIALIZE: pins to the SAME decisionBlockHash as the rebridge that produced it', materializeReport7.report.decisionBlock, rebridgeReport7.report.decisionBlock);
harness.equal(
	'MATERIALIZE: BYTE-IDENTICAL replayed edge',
	JSON.stringify(materializeWrites7[0]),
	JSON.stringify(rebridgeWrites7[0]),
);

// =====================================================================
harness.section("SECTION 8 — RESOLVER CHECK: sifEvidenceBridge resolves uniquely via the standard-local search (source: sif)");
// =====================================================================

const resolved8 = bridgeMakerModule.resolveBridgePlugin({ bridge: 'sifEvidenceBridge', source: 'sif' });
harness.ok(
	"'sifEvidenceBridge' resolves through the real search path (source: 'sif' -> standard-local scope)",
	!!resolved8 && !resolved8.error && typeof resolved8.pluginFactory === 'function',
	`got ${JSON.stringify(resolved8)}`,
);
const expectedPath8 = path.join(__dirname, '..', 'bridges', 'sifEvidenceBridge.js');
harness.equal('  and the resolved file IS forges/sif/bridges/sifEvidenceBridge.js', resolved8.resolvedPath, expectedPath8);

// =====================================================================
harness.section('SECTION 8.5 — ⟪hubReimplementation P3⟫ OBSERVED-RED refusal twins: a card lacking embedding or embedText is refused BY NAME, never re-embedded/recomposed');
// =====================================================================
// The bridge READS `embedding` and `embedText` off each HubReference card (SPEC §1.5, gates G-6/G-7)
// and refuses a candidate lacking either — a vectorless candidate means the graph was materialized
// without its vector store; an embedTextless one lost its stored retrieval string. Both twins run the
// REAL bridgeMaker.run() and are refused BEFORE any judging (the rerank counter proves it).

// withoutCardProperty — a deep clone of one raw reference node, minus one named card property.
const withoutCardProperty = (oneNode, propertyName) => {
	const cloned = JSON.parse(JSON.stringify(oneNode));
	delete cloned.properties[propertyName];
	return cloned;
};

const freshRefusalStore85 = () => ({
	getDecisionBlock: (a, cb) => { void a; cb('', { frozenText: null }); },
	saveDecisionBlock: (a, cb) => { void a; cb('', { saved: true }); },
});

const runRefusalRebridge85 = (brokenReferenceNodes, done) => {
	const brokenReader = makeGraphReaderDouble7(brokenReferenceNodes);
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble7([]), graphReaderFactory: brokenReader }).run(
		{
			inGraph: { graphName: 'DEV_sif_evidence_refusal', boltUrl: 'bolt://x', password: 'x' },
			bridge: 'sifEvidenceBridge', source: 'sif', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore: freshRefusalStore85(),
			inferenceConfig: { llmClient: stubLlm7, topK: 1, cosineFloor: -1, concurrency: 4 },
			config: runConfig7,
			componentOverrides: { vectorizer: fakeVectorizerFactory7, graphReader: brokenReader },
		},
		(err) => done(err),
	);
};

const rerankCallsBeforeRefusals85 = rerankCallCount7;

(() => {
	let observed = null;
	runRefusalRebridge85([withoutCardProperty(referenceNodesRaw7[0], 'embedding'), referenceNodesRaw7[1]], (err) => { observed = err; });
	harness.rejects(
		'OBSERVED RED: a candidate carrying no embedding is refused NAMING the candidate, never re-embedded',
		[observed],
		/candidate 'P900001' carries no embedding.*Refusing rather than re-embedding/s,
	);
})();

(() => {
	let observed = null;
	runRefusalRebridge85([withoutCardProperty(referenceNodesRaw7[0], 'embedText'), referenceNodesRaw7[1]], (err) => { observed = err; });
	harness.rejects(
		'OBSERVED RED: a candidate carrying no embedText is refused NAMING the candidate, never recomposed',
		[observed],
		/candidate 'P900001' carries no embedText.*Refusing rather than recomposing/s,
	);
})();

harness.equal('both refusal twins were refused BEFORE any judging (zero additional rerank calls)', rerankCallCount7, rerankCallsBeforeRefusals85);

// =====================================================================
harness.section('SECTION 9 — DETERMINISM UNDER CONCURRENCY: staggered-delay concurrent run vs concurrency-1 run, SAME frozen bytes');
// =====================================================================
// p8-judgeConcurrency: the per-source judge loop now dispatches through boundedRunner with
// EVIDENCE_JUDGE_CONCURRENCY=8 in flight. The frozen decision block must stay BYTE-IDENTICAL to a
// serial run — proven here with a stub llmClient whose responses arrive in REVERSED order (the
// last-launched judgment completes first) against a config.evidenceJudgeConcurrency=1 comparator.
// This section is ASYNC (real timers stagger completions), so it owns harness.report().

const SOURCE_COUNT_9 = 6;
const FIELD_NAMES_9 = ['FirstName', 'MiddleName', 'LastName', 'PreferredName', 'FormerName', 'AliasName'];
const sourceGraphNodes9 = FIELD_NAMES_9.map((oneFieldName, i) => ({
	stableId: `sif:field/StudentPersonal/Name/${oneFieldName}`,
	properties: {
		_source: 'SIF', role: 'DmeProperty', name: oneFieldName, description: 'sourceDefText',
		xpath: `StudentPersonal/Name/${oneFieldName}`, tableName: 'StudentPersonal',
		sequenceGroupLabel: 'Name', sequenceGroupKey: 'sif:fieldGroup:Name',
		sequenceOrdinal: i + 1, siblingCount: SOURCE_COUNT_9, orderSemantics: 'document',
		cedsId: 'P900002', // every probe carries the authored anchor, so addr2 is always in the pool
	},
}));

const graphReaderDouble9 = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodesRaw7 }); return; }
		if (eq._source === 'SIF' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes9 }); return; }
		if (label === 'SifField') { callback('', { nodes: [] }); return; } // no siblings resolved — honest baseline
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});

// makeStubLlm9 — per-call responses VARY (category cycles; rationale carries the call ordinal; odd
// calls abstain) so a wrong-order assembly would change the frozen bytes, not merely reshuffle
// identical entries. All pre-select steps are synchronous with these doubles, so rerank call order
// IS source launch order (strictly ascending — boundedRunner's contract) in BOTH runs; only the
// completion timing differs.
const CATEGORY_CYCLE_9 = ['strong', 'moderate', 'weakButReal'];
const makeStubLlm9 = ({ delayForCall, completionOrder, inFlightLedger }) => {
	let callOrdinal = -1;
	return {
		rerank: (spec, callback) => {
			callOrdinal += 1;
			const thisCall = callOrdinal;
			const crossrefOrdinalMatch = spec.userPrompt.match(/(\d+)\) Unrelated Widget Descriptor/);
			if (inFlightLedger) {
				inFlightLedger.now += 1;
				inFlightLedger.max = Math.max(inFlightLedger.max, inFlightLedger.now);
			}
			const respond = () => {
				if (inFlightLedger) {
					inFlightLedger.now -= 1;
				}
				if (completionOrder) {
					completionOrder.push(thisCall);
				}
				if (thisCall % 2 === 1 || !crossrefOrdinalMatch) {
					callback('', { choice: 'NONE', rationale: `determinism abstain rationale #${thisCall}` });
					return;
				}
				callback('', {
					choice: crossrefOrdinalMatch[1],
					category: CATEGORY_CYCLE_9[(thisCall / 2) % CATEGORY_CYCLE_9.length],
					rationale: `determinism pick rationale #${thisCall}`,
				});
			};
			const delayMs = delayForCall(thisCall);
			if (delayMs === 0) {
				respond();
				return;
			}
			setTimeout(respond, delayMs);
		},
	};
};

const runOneDeterminismPass9 = ({ graphName, stubLlm, configOverrides, writes }, passDone) => {
	const decisionBlocks9 = {};
	const decisionStore9 = {
		getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocks9[pairKey] ? { frozenText: decisionBlocks9[pairKey].frozenText } : { frozenText: null }),
		saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocks9[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
	};
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble7(writes), graphReaderFactory: graphReaderDouble9 }).run(
		{
			inGraph: { graphName, boltUrl: 'bolt://x', password: 'x' },
			bridge: 'sifEvidenceBridge', source: 'sif', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge: true, decisionStore: decisionStore9,
			inferenceConfig: { llmClient: stubLlm, topK: 1, cosineFloor: -1, concurrency: 4 },
			config: { ...runConfig7, ...configOverrides },
			componentOverrides: { vectorizer: fakeVectorizerFactory7, graphReader: graphReaderDouble9 },
		},
		(err, report) => passDone(err, { report, frozenBlock: decisionBlocks9['CEDS::SIF'] }),
	);
};

// PASS 1 — CONCURRENT (the bridge's EVIDENCE_JUDGE_CONCURRENCY=8 default), REVERSED staggered
// delays: the LAST-launched judgment completes FIRST.
const completionOrder9 = [];
const inFlightLedger9 = { now: 0, max: 0 };
const concurrentWrites9 = [];
runOneDeterminismPass9(
	{
		graphName: 'DEV_sif_determinism_concurrent',
		stubLlm: makeStubLlm9({
			delayForCall: (callOrdinal) => (SOURCE_COUNT_9 - callOrdinal) * 12,
			completionOrder: completionOrder9,
			inFlightLedger: inFlightLedger9,
		}),
		configOverrides: {},
		writes: concurrentWrites9,
	},
	(concurrentErr, concurrentOut) => {
		harness.ok(`the CONCURRENT rebridge pass did not error (${concurrentErr || 'ok'})`, !concurrentErr, concurrentErr);
		harness.ok(
			'the judgments genuinely OVERLAPPED (max concurrent rerank calls in flight > 1)',
			inFlightLedger9.max > 1,
			`max in flight was ${inFlightLedger9.max}`,
		);
		harness.ok(
			`completion order provably DIFFERS from source order (was ${JSON.stringify(completionOrder9)})`,
			JSON.stringify(completionOrder9) !== JSON.stringify(Array.from({ length: SOURCE_COUNT_9 }, (ignore, i) => i)),
			`completion order was ${JSON.stringify(completionOrder9)}`,
		);

		// PASS 2 — SERIAL comparator: config.evidenceJudgeConcurrency=1 (the documented override
		// seam), zero delay — the exact behavior of the retired taskListPlus serial loop.
		const serialWrites9 = [];
		runOneDeterminismPass9(
			{
				graphName: 'DEV_sif_determinism_serial',
				stubLlm: makeStubLlm9({ delayForCall: () => 0 }),
				configOverrides: { evidenceJudgeConcurrency: 1 },
				writes: serialWrites9,
			},
			(serialErr, serialOut) => {
				harness.ok(`the SERIAL (concurrency-1) rebridge pass did not error (${serialErr || 'ok'})`, !serialErr, serialErr);

				// THE PROOF — the frozen decision block is BYTE-IDENTICAL and hash-identical.
				harness.ok('both passes saved a real frozen block', !!(concurrentOut.frozenBlock && serialOut.frozenBlock));
				harness.equal(
					'DETERMINISM PROVED: the frozen decision block TEXT is BYTE-IDENTICAL between the out-of-order concurrent run and the serial run',
					concurrentOut.frozenBlock.frozenText,
					serialOut.frozenBlock.frozenText,
				);
				harness.equal(
					'  and the content-address (decisionBlockHash) is IDENTICAL',
					concurrentOut.frozenBlock.decisionBlockHash,
					serialOut.frozenBlock.decisionBlockHash,
				);
				harness.equal(
					'  and both bridge reports pin the SAME decisionBlock hash',
					concurrentOut.report.decisionBlock,
					serialOut.report.decisionBlock,
				);
				harness.equal(
					'  and the WRITTEN edges are byte-identical, in the same order',
					JSON.stringify(concurrentWrites9),
					JSON.stringify(serialWrites9),
				);
				harness.equal('  3 picks -> 3 edges in each pass (even ordinals pick addr2, odd abstain)', concurrentWrites9.length, 3);

				harness.report();
			},
		);
	},
);
