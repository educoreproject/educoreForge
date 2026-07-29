#!/usr/bin/env node
'use strict';

// test-caseStructuralBridge.js — hermetic gate for forges/case/bridges/caseStructuralBridge.js
// (bridgeKitRefactor_072726 spec §6 Phase 5). Proves the pure helpers (tokenize,
// pathTokensFromStableId, overlapCoefficient), the construction-time fault twin (missing
// kit.semanticMatcher), and the HEADLINE claim: on a path-disambiguated fixture, the structural
// blend picks a DIFFERENT top candidate than pure definition-cosine alone would — the load-bearing
// proof that overriding bridgeSkeleton's `match` move actually changes outcomes, not just plumbing.
//
// PURE + synchronous + deterministic: no Neo4j, no async, no LLM, no embeddings service — the
// fixture vectors below are hand-picked so their cosine is EXACT (see the comment at the fixture).
//
// Run: node forges/case/test/test-caseStructuralBridge.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for forges/case/bridges/caseStructuralBridge.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves tokenize/pathTokensFromStableId/overlapCoefficient in isolation, the missing-
     kit.semanticMatcher construction-time refusal (RED then GREEN), and the headline RED/GREEN:
     pure cosine (the generic pick) vs the structural blend (a DIFFERENT pick) on the SAME fixture.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const bridgeModule = require('../bridges/caseStructuralBridge');
const semanticMatcherFactory = require('../../../apps/graph-builder/apps/bridge-maker/lib.d/semanticMatcher');

const {
	tokenize,
	pathTokensFromStableId,
	overlapCoefficient,
	structuralAffinity,
	caseStructuralMatchMove,
	STRUCT_WEIGHT,
} = bridgeModule;

// =====================================================================
harness.section('SECTION 1 — tokenize: camelCase/acronym-boundary split, lowercased, stopword+short filtered');
// =====================================================================
(() => {
	harness.equal(
		'camelCase splits at the lower->upper boundary',
		JSON.stringify(tokenize('humanCodingScheme')),
		JSON.stringify(['human', 'coding', 'scheme']),
	);
	harness.equal(
		'an acronym-prefixed class name splits the acronym off (CFItem -> item; "cf" dropped, too short)',
		JSON.stringify(tokenize('CFItem')),
		JSON.stringify(['item']),
	);
	harness.equal(
		'stopwords and short tokens are dropped, longer words kept',
		JSON.stringify(tokenize('A Human Readable Label For This Item')),
		JSON.stringify(['human', 'readable', 'label', 'item']),
	);
	harness.equal('null/undefined text tokenizes to an empty array', JSON.stringify(tokenize(undefined)), '[]');
})();

// =====================================================================
harness.section('SECTION 2 — pathTokensFromStableId: CASE casePath -> className+propertyName token set');
// =====================================================================
(() => {
	const tokens = pathTokensFromStableId('case:CFItem.humanCodingScheme');
	harness.equal(
		'className+propertyName both contribute tokens',
		JSON.stringify([...tokens].sort()),
		JSON.stringify(['coding', 'human', 'item', 'scheme']),
	);
	harness.ok(
		'a non-CASE stableId (no case: prefix / no dotted segment) yields an EMPTY set, never a guess',
		pathTokensFromStableId('lif:SomeProperty').size === 0 && pathTokensFromStableId('case:justOneSegment').size === 0,
	);
	harness.ok('a null stableId yields an empty set', pathTokensFromStableId(null).size === 0);
})();

// =====================================================================
harness.section('SECTION 3 — overlapCoefficient: |intersection| / min(|A|,|B|), 0 when either side is empty');
// =====================================================================
(() => {
	const a = new Set(['item', 'human', 'coding', 'scheme']);
	const bFull = new Set(['competency', 'item', 'human', 'coding', 'readable', 'scheme', 'label', 'framework']);
	harness.equal('full containment of the SMALLER set scores 1.0', overlapCoefficient(a, bFull), 1);
	const bPartial = new Set(['item', 'title', 'generic', 'caption']);
	harness.equal('one shared token of four scores 0.25', overlapCoefficient(a, bPartial), 0.25);
	harness.equal('an empty set on either side scores 0, never NaN/divide-by-zero', overlapCoefficient(a, new Set()), 0);
	harness.equal('both sides empty scores 0', overlapCoefficient(new Set(), new Set()), 0);
})();

// =====================================================================
harness.section("SECTION 4 — caseStructuralMatchMove construction-time refusal: RED then GREEN (P4's twin)");
// =====================================================================
(() => {
	harness.doesNotThrow('GREEN: a kit carrying semanticMatcher.cosine constructs cleanly', () => {
		caseStructuralMatchMove({ kit: { semanticMatcher: { cosine: () => 0 } }, matcherName: 'ignored' });
	});
	let redError = null;
	try {
		caseStructuralMatchMove({ kit: {}, matcherName: 'ignored' });
	} catch (err) {
		redError = err;
	}
	harness.ok('RED: a kit with NO semanticMatcher throws, named', !!redError);
	harness.match(
		'RED: the thrown message names kit.semanticMatcher.cosine specifically',
		redError ? redError.message : '',
		/kit\.semanticMatcher\.cosine/,
	);
})();

// =====================================================================
harness.section(
	'SECTION 5 — THE HEADLINE PROOF: on a path-disambiguated fixture, pure cosine and the structural ' +
		'blend pick DIFFERENT top candidates (RED = pure cosine\'s generic pick, GREEN = the override\'s pick)',
);
// =====================================================================
(() => {
	// Fixture vectors are hand-picked for an EXACT cosine (dot product over unit vectors):
	//   source        = [1, 0]
	//   candidateA    = [0.9, sqrt(1-0.81)]   -> cosine(source, A) = 0.9 exactly
	//   candidateB    = [0.8, 0.6]            -> cosine(source, B) = 0.8 exactly (3-4-5 triangle)
	// A is the HIGHER-cosine, WRONG-domain candidate (its wording happens to resemble the source's
	// bare property name, but it is NOT the same CASE class's concept). B is the LOWER-cosine,
	// RIGHT-domain candidate — its own name+description text is saturated with the SOURCE property's
	// owning-class vocabulary (a real CASE shape: 'CFItem.humanCodingScheme', a competency-item
	// coding scheme, vs a generic 'item title' caption that is not about competencies at all).
	const source = { stableId: 'case:CFItem.humanCodingScheme', name: 'humanCodingScheme', vector: [1, 0] };
	const candidateA = {
		stableId: 'ceds:P900001',
		cedsId: 'P900001',
		name: 'Generic Caption',
		defText: 'A generic caption used for display purposes.',
		vector: [0.9, Math.sqrt(1 - 0.9 * 0.9)],
	};
	const candidateB = {
		stableId: 'ceds:P900002',
		cedsId: 'P900002',
		name: 'Competency Item Human Coding Scheme',
		defText: 'A human readable coding scheme label for a competency framework item.',
		vector: [0.8, 0.6],
	};
	const candidatePool = [candidateA, candidateB];

	// structural affinity sanity, computed with the SAME exported helper the match move uses —
	// confirms the fixture actually exercises what the section claims before trusting the ranking.
	const pathTokens = pathTokensFromStableId(source.stableId);
	harness.equal('fixture check: candidateA has ZERO structural affinity to the source path', structuralAffinity(pathTokens, candidateA), 0);
	harness.equal('fixture check: candidateB has FULL structural affinity (containment) to the source path', structuralAffinity(pathTokens, candidateB), 1);

	// RED — pure definition-cosine (byte-for-byte the SAME lib.d/semanticMatcher.js the generic
	// bridge uses; this IS the "STRUCT_WEIGHT=0" case in effect, since no structural term exists
	// on this path at all): the generic matcher's rank-1 pick is candidateA (higher raw cosine).
	const genericMatcher = semanticMatcherFactory({ topK: 2 });
	const genericPool = genericMatcher.retrieve(source, candidatePool);
	harness.equal('RED: pure-cosine genericBridge matcher ranks candidateA first (higher cosine, wrong domain)', genericPool[0].candidate.stableId, candidateA.stableId);
	harness.equal('RED: candidateA cosine is exactly 0.9', Math.round(genericPool[0].cosine * 1e6) / 1e6, 0.9);

	// GREEN — caseStructuralMatchMove, reusing the SAME kit.semanticMatcher.cosine, blended with
	// STRUCT_WEIGHT * structuralAffinity: 0.9 + 0.15*0 = 0.90 for A; 0.8 + 0.15*1.0 = 0.95 for B ->
	// candidateB now ranks FIRST. This is the seam proof: overriding ONE move changed the pick.
	const structuralMatcher = caseStructuralMatchMove({ kit: { semanticMatcher: genericMatcher }, matcherName: 'ignored' });
	const structuralPool = structuralMatcher.retrieve(source, candidatePool);
	harness.equal('GREEN: the structural blend ranks candidateB first instead (0.95 blended > 0.90 blended)', structuralPool[0].candidate.stableId, candidateB.stableId);

	// PROVENANCE — the winning entry's `cosine` field is candidateB's PURE base cosine (0.8), NEVER
	// the blend (0.95) — proves the honesty claim in the file header is real, not asserted prose.
	harness.equal("PROVENANCE: the winning pool entry's cosine field is the PURE base cosine (0.8), not the blend", structuralPool[0].cosine, 0.8);
	harness.equal("PROVENANCE: the winning pool entry carries structuralScore SEPARATELY (1.0)", structuralPool[0].structuralScore, 1);
	harness.equal(
		'PROVENANCE: the blend itself equals cosine + STRUCT_WEIGHT * structuralScore (0.8 + 0.15*1.0 = 0.95)',
		Math.round((structuralPool[0].cosine + STRUCT_WEIGHT * structuralPool[0].structuralScore) * 1e6) / 1e6,
		0.95,
	);

	// TWIN — the runner-up (candidateA) also carries BOTH fields, proving this is not special-cased
	// to the winner alone.
	const runnerUp = structuralPool.find((entry) => entry.candidate.stableId === candidateA.stableId);
	harness.equal('the non-winning entry ALSO keeps its pure base cosine (0.9)', runnerUp.cosine, 0.9);
	harness.equal('the non-winning entry ALSO carries its structuralScore (0)', runnerUp.structuralScore, 0);
})();

harness.report();
