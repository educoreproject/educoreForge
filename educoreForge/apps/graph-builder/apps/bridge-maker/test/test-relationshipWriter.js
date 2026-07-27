#!/usr/bin/env node
'use strict';

// test-relationshipWriter.js — proves relationshipWriter's VOCABULARY GUARD (the write seam's
// semantic hardening layered onto the P0 write component; componentLibrary.deriveEdgePolicy). The
// pre-existing syntactic guard (exactly-one-source, applyLabel present) is proven by
// test-bridge-maker.js; THIS suite proves the four NEW checks that ask what the edge actually IS.
//
// Every guard is shown RED (refused, for the SPECIFIC named reason) THEN GREEN (the SAME edge,
// corrected, writes) — a guard never observed failing is not a guard (harness.js doctrine: a
// rejection for the wrong reason must fail, not false-green).
//
// GOLDEN-VERIFIED PROPERTY NAME: the mapping-agreement stamp checked here is `properties.predicate`
// ('exactMatch' / 'closeMatch' / ...) — the SAME property referenceIndex.js and inferredIndex.js
// already carry, confirmed by a live query against GOLD_260718. An earlier draft of this guard
// checked an invented `matchType` property that exists nowhere in the golden; this suite (and the
// guard it proves) key on `predicate` instead, so neither producer needed to change.
//
// Proves, against a graphWriter DOUBLE and a REAL edgePolicy derived from lib/vocabulary/
// vocabulary.js via componentLibrary.deriveEdgePolicy (never a hand-copied fixture — the guard and
// its source of truth must never drift apart, polyArch2 §6):
//   a. a sanctioned, correctly-stamped STRUCTURAL edge (HAS_PROPERTY / provenanceTier structural) writes.
//   b. a correctly-stamped EXACT_MATCH mapping edge (predicate exactMatch / provenanceTier
//      spec-authoritative) writes.
//   c. an UNKNOWN relationshipType is refused; retyped to a sanctioned type, it writes.
//   d. an edge missing provenanceTier is refused; adding it, it writes.
//   e. a mapping edge with NO predicate is refused; adding the agreeing predicate, it writes.
//   f. a mapping edge whose predicate DISAGREES with its type is refused; correcting it, it writes.
//   g. a CLOSE_MATCH edge missing decisionBlockHash/confidence is refused; adding both, it writes.
//   h. a structural edge stamped with a NON-structural provenanceTier is refused; correcting it, it writes.
// Plus: CLASSIFICATION_CROSSWALK is sanctioned but exempt from predicate agreement (vocabulary.js —
// it is spec-authoritative but never a hub match), and constructing relationshipWriter without an
// edgePolicy is refused BY NAME (a guard with nothing to check against is not a guard).
//
// PURE / hermetic: no Neo4j, no container, no network (§3 hard line 2) — a graphWriter DOUBLE only.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-relationshipWriter.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- proves relationshipWriter's vocabulary guard (RED-then-GREEN per check)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives relationshipWriter.write over a graphWriter double under a REAL edgePolicy derived from
     lib/vocabulary/vocabulary.js (componentLibrary.deriveEdgePolicy), proving each new guard both
     refuses the fault it names and passes once corrected.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const relationshipWriterFactory = require('../lib/relationshipWriter');
// deriveEdgePolicy — the SAME derivation componentLibrary uses to construct the real write seam. A
// REAL derived policy, never a hand-copied fixture, so this suite proves the guard against the exact
// contract a real reforge composes.
const { deriveEdgePolicy } = require('../lib/componentLibrary');

const APPLY_LABEL = 'BridgedRelation';
const edgePolicy = deriveEdgePolicy();

// a graphWriter double: records every write that REACHES the substrate, so a refused edge (which
// never reaches graphWriter) is provably distinct from a written one.
const graphWriterDouble = () => {
	const writes = [];
	return {
		writes,
		writeRelationshipEdge: (spec, callback) => {
			writes.push(spec);
			callback('', { edgeWritten: true });
		},
		close: (callback) => callback(''),
	};
};

const newWriter = () => {
	const graphWriter = graphWriterDouble();
	const relationshipWriter = relationshipWriterFactory({ graphWriter, edgePolicy });
	return { graphWriter, relationshipWriter };
};

// =====================================================================
harness.section('CONSTRUCTION — a missing edgePolicy is refused BY NAME (no default guard)');
// =====================================================================
harness.match(
	'constructing relationshipWriter without an edgePolicy throws, naming the reason',
	(() => {
		try {
			relationshipWriterFactory({ graphWriter: graphWriterDouble() });
			return '';
		} catch (constructionError) {
			return constructionError.message;
		}
	})(),
	/constructed without an edgePolicy/,
);

// =====================================================================
harness.section('a — a sanctioned, correctly-stamped STRUCTURAL edge writes');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let observed = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 's:1',
				toStableId: 's:2',
				relationshipType: 'HAS_PROPERTY',
				properties: { provenanceTier: 'structural' },
			},
			applyLabel: APPLY_LABEL,
		},
		(err, result) => {
			observed = { err, result };
		},
	);
	harness.equal('a sanctioned structural edge (provenanceTier structural) writes', observed.err, '');
	harness.equal('  and it reached the graphWriter', graphWriter.writes.length, 1);
	harness.ok(
		'  edgeWritten true',
		observed.result && observed.result.edgeWritten === true,
		JSON.stringify(observed.result),
	);
})();

// =====================================================================
harness.section('b — a correctly-stamped EXACT_MATCH mapping edge writes');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let observed = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'src:1',
				toStableId: 'hub:1',
				relationshipType: 'EXACT_MATCH',
				properties: { provenanceTier: 'spec-authoritative', predicate: 'exactMatch', confidence: 1.0 },
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			observed = err;
		},
	);
	harness.equal('a correctly-stamped EXACT_MATCH edge writes', observed, '');
	harness.equal('  and it reached the graphWriter', graphWriter.writes.length, 1);
})();

// =====================================================================
harness.section('c — UNKNOWN relationshipType: RED then GREEN');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let red = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'x:1',
				toStableId: 'x:2',
				relationshipType: 'TOTALLY_UNKNOWN_TYPE',
				properties: { provenanceTier: 'structural' },
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			red = err;
		},
	);
	harness.rejects(
		'RED — an unsanctioned relationshipType is refused, naming it',
		[red],
		/TOTALLY_UNKNOWN_TYPE.*not a sanctioned edge type/,
	);
	harness.equal('  RED — nothing reached the graphWriter', graphWriter.writes.length, 0);

	let green = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'x:1',
				toStableId: 'x:2',
				relationshipType: 'HAS_PROPERTY', // corrected to a sanctioned structural type
				properties: { provenanceTier: 'structural' },
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			green = err;
		},
	);
	harness.equal('GREEN — retyped to a sanctioned type, it writes', green, '');
	harness.equal('  GREEN — reached the graphWriter', graphWriter.writes.length, 1);
})();

// =====================================================================
harness.section('d — MISSING required property (provenanceTier): RED then GREEN');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let red = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'y:1',
				toStableId: 'y:2',
				relationshipType: 'HAS_OPTION_SET',
				properties: {}, // no provenanceTier
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			red = err;
		},
	);
	harness.rejects(
		'RED — an edge missing provenanceTier is refused, naming it',
		[red],
		/HAS_OPTION_SET.*missing required propert.*provenanceTier/,
	);
	harness.equal('  RED — nothing reached the graphWriter', graphWriter.writes.length, 0);

	let green = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'y:1',
				toStableId: 'y:2',
				relationshipType: 'HAS_OPTION_SET',
				properties: { provenanceTier: 'structural' },
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			green = err;
		},
	);
	harness.equal('GREEN — provenanceTier added, it writes', green, '');
	harness.equal('  GREEN — reached the graphWriter', graphWriter.writes.length, 1);
})();

// =====================================================================
harness.section('e — mapping edge with NO predicate: RED then GREEN');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let red = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'z:1',
				toStableId: 'z:2',
				relationshipType: 'EXACT_MATCH',
				properties: { provenanceTier: 'spec-authoritative' }, // no predicate
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			red = err;
		},
	);
	harness.rejects('RED — an EXACT_MATCH edge with no predicate is refused', [red], /EXACT_MATCH.*predicate.*required/);
	harness.equal('  RED — nothing reached the graphWriter', graphWriter.writes.length, 0);

	let green = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'z:1',
				toStableId: 'z:2',
				relationshipType: 'EXACT_MATCH',
				properties: { provenanceTier: 'spec-authoritative', predicate: 'exactMatch' },
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			green = err;
		},
	);
	harness.equal('GREEN — predicate exactMatch added, it writes', green, '');
	harness.equal('  GREEN — reached the graphWriter', graphWriter.writes.length, 1);
})();

// =====================================================================
harness.section('f — mapping edge whose predicate DISAGREES: RED then GREEN');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let red = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'w:1',
				toStableId: 'w:2',
				relationshipType: 'EXACT_MATCH',
				properties: { provenanceTier: 'spec-authoritative', predicate: 'closeMatch' }, // disagrees
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			red = err;
		},
	);
	harness.rejects(
		'RED — predicate closeMatch disagrees with relationshipType EXACT_MATCH, refused',
		[red],
		/EXACT_MATCH.*expects properties\.predicate 'exactMatch'.*got 'closeMatch'/,
	);
	harness.equal('  RED — nothing reached the graphWriter', graphWriter.writes.length, 0);

	let green = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'w:1',
				toStableId: 'w:2',
				relationshipType: 'EXACT_MATCH',
				properties: { provenanceTier: 'spec-authoritative', predicate: 'exactMatch' },
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			green = err;
		},
	);
	harness.equal('GREEN — predicate corrected to exactMatch, it writes', green, '');
	harness.equal('  GREEN — reached the graphWriter', graphWriter.writes.length, 1);
})();

// =====================================================================
harness.section('g — CLOSE_MATCH missing decisionBlockHash/confidence: RED then GREEN');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let red = null;
	relationshipWriter(
		{
			decision: {
				fromStableId: 'v:1',
				toStableId: 'v:2',
				relationshipType: 'CLOSE_MATCH',
				properties: { provenanceTier: 'embedding-inferred', predicate: 'closeMatch' }, // no decisionBlockHash/confidence
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			red = err;
		},
	);
	harness.rejects(
		'RED — a CLOSE_MATCH edge missing decisionBlockHash/confidence is refused',
		[red],
		/CLOSE_MATCH edge additionally requires decisionBlockHash and confidence/,
	);
	harness.equal('  RED — nothing reached the graphWriter', graphWriter.writes.length, 0);

	let green = null;
	relationshipWriter(
		{
			decision: {
				fromStableId: 'v:1',
				toStableId: 'v:2',
				relationshipType: 'CLOSE_MATCH',
				properties: {
					provenanceTier: 'embedding-inferred',
					predicate: 'closeMatch',
					decisionBlockHash: 'sha256:deadbeef',
					confidence: 0.91,
				},
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			green = err;
		},
	);
	harness.equal('GREEN — decisionBlockHash + confidence added, it writes', green, '');
	harness.equal('  GREEN — reached the graphWriter', graphWriter.writes.length, 1);
})();

// =====================================================================
harness.section('h — structural edge stamped with a NON-structural tier: RED then GREEN');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let red = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'u:1',
				toStableId: 'u:2',
				relationshipType: 'SUBCLASS_OF',
				properties: { provenanceTier: 'spec-authoritative' }, // wrong tier for a structural edge
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			red = err;
		},
	);
	harness.rejects(
		'RED — a structural edge stamped with a non-structural provenanceTier is refused',
		[red],
		/SUBCLASS_OF.*provenanceTier must be 'structural', got 'spec-authoritative'/,
	);
	harness.equal('  RED — nothing reached the graphWriter', graphWriter.writes.length, 0);

	let green = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'u:1',
				toStableId: 'u:2',
				relationshipType: 'SUBCLASS_OF',
				properties: { provenanceTier: 'structural' },
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			green = err;
		},
	);
	harness.equal('GREEN — provenanceTier corrected to structural, it writes', green, '');
	harness.equal('  GREEN — reached the graphWriter', graphWriter.writes.length, 1);
})();

// =====================================================================
harness.section('CROSSWALK — sanctioned, exempt from predicate agreement (only REQUIRED_PROPERTIES.EDGE)');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let observed = null;
	relationshipWriter(
		{
			authoredMapping: {
				fromStableId: 'cw:1',
				toStableId: 'cw:2',
				relationshipType: 'CLASSIFICATION_CROSSWALK',
				properties: { provenanceTier: 'spec-authoritative' }, // no predicate — not a mapping predicate
			},
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			observed = err;
		},
	);
	harness.equal(
		'a CLASSIFICATION_CROSSWALK edge with no predicate still writes (not a mapping predicate)',
		observed,
		'',
	);
	harness.equal('  reached the graphWriter', graphWriter.writes.length, 1);
})();

// =====================================================================
harness.section('THE EXISTING SYNTACTIC GUARD is unaffected — exactly-one-source still refused');
// =====================================================================
(() => {
	const { graphWriter, relationshipWriter } = newWriter();
	let observed = null;
	relationshipWriter(
		{
			// neither decision nor authoredMapping
			applyLabel: APPLY_LABEL,
		},
		(err) => {
			observed = err;
		},
	);
	harness.rejects('neither authoredMapping nor decision is still refused', [observed], /neither was given/);
	harness.equal('  nothing reached the graphWriter', graphWriter.writes.length, 0);
})();

harness.report();
