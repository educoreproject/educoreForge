#!/usr/bin/env node
'use strict';

// p0b_orderingGuardReachability.js — PROVES THE ORDERING REFUSAL IS REACHABLE, not merely correct.
//
// Ordered by SABLE_RIVER (IMCS 2026-08-17) on a failure this codebase has now produced three times,
// twice on the same day: (1) an earlier phase's G3-F gate PASSED FOR THE WRONG REASON because a
// stale-annotation check spoke first and its shape-consistency guard never fired; (2) the B4b builder
// found its own newly written refusal was UNREACHABLE because it sat downstream of a guard that
// always spoke first — discovered by RUNNING it, not by reading it; (3) p0b's LEVER 1 shows the
// refusal firing under the naive placement, which is evidence about ONE input and says nothing about
// whether another precondition would speak first on a different one.
//
// THE QUESTION THIS PROBE ANSWERS: when the zero-RESOLVES_TO condition is present TOGETHER WITH each
// other plausible precondition failure, WHICH refusal speaks — identified BY ITS OWN MESSAGE TEXT and
// never by exit status, because two different faults both exit non-zero and are indistinguishable
// that way.
//
// WHAT COUNTS AS A PASS HERE IS NOT "my guard always wins". Some precondition SHOULD outrank it — a
// non-array input is a worse fault than a mis-ordered one, and saying so is correct. What must be
// true is that the guard outranks every check that could MASK it, meaning every check that the naive
// placement would ALSO trip. Those are the per-node checks: a node's pescTier read and its carried
// composer input. If either spoke first, a real ordering fault would surface as a confusing
// per-node complaint about one stableId instead of as the diagnosis.
//
// The table below records the EXPECTED speaker for each combination and the reason, so a future
// change in precedence fails loudly instead of silently rearranging which diagnosis a builder sees.
//
// A NOTE ON try/catch: applySearchTextComposition is SYNC and THROWS for refusals, exactly as
// derivedTier.js and syntheticTier.js do. Catching here is the sanctioned observation boundary — the
// same role the forge's one try/catch plays when it converts these throws to its error channel — not
// try/catch used for control flow.
//
// Pure: no forge run, no parse, no embedding, no container. Synthetic inputs only.
// Run: node forges/pesc260805/test/probes/p0b_orderingGuardReachability.js

const path = require('path');

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const { applySearchTextComposition } = require(
	path.join(BUNDLE_DIR, 'lib', 'searchTextComposition'),
)();

let pass = 0;
let fail = 0;
const check = (label, condition) => {
	if (condition) {
		pass++;
		console.log(`  ok    ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};
const evidence = (message) => console.log(`    | ${message}`);

// the refusal fingerprints, declared as data. Each is a distinctive substring of ONE refusal, so the
// speaker is identified by what it SAID rather than by the fact that something failed.
const REFUSAL_FINGERPRINTS = {
	orderingTrap: 'ORDERING TRAP',
	arraysRequired: 'pass the COMBINED source+derived graph',
	registryMalformed: 'does not satisfy SearchTextArmComposer',
	missingProperty: 'the composition\'s model of the graph is wrong',
	missingCarriedElement: 'carries no sourceSearchTextElement',
	multipleResolvesTo: 'RESOLVES_TO targets',
};

// identifySpeaker — which refusal spoke, by fingerprint. Returns 'NONE' when nothing threw and
// 'UNRECOGNISED' when something threw that no fingerprint matches, because an unrecognised refusal is
// a real result and must not be quietly scored as one of the known ones.
const identifySpeaker = (thrownMessage) => {
	if (thrownMessage === null) {
		return 'NONE';
	}
	const matched = Object.keys(REFUSAL_FINGERPRINTS).filter(
		(oneName) => thrownMessage.indexOf(REFUSAL_FINGERPRINTS[oneName]) !== -1,
	);
	if (matched.length === 0) {
		return 'UNRECOGNISED';
	}
	if (matched.length > 1) {
		return `AMBIGUOUS(${matched.join('+')})`;
	}
	return matched[0];
};

// runOneCase — the sanctioned observation boundary (see header).
const runOneCase = (graphArgument) => {
	let thrownMessage = null;
	try {
		applySearchTextComposition(graphArgument);
	} catch (thrownError) {
		thrownMessage = thrownError.message;
	}
	return { speaker: identifySpeaker(thrownMessage), thrownMessage };
};

// oneValidPropertyNode — a well-formed source-tier element declaration, so a case can isolate ONE
// defect at a time instead of tripping three at once.
const oneValidPropertyNode = ({ stableId, name, description }) => ({
	labels: ['ForgedNode', 'PescElementDecl', 'DmeProperty'],
	stableId,
	role: 'DmeProperty',
	properties: {
		_id: stableId,
		_source: 'PESC260805',
		name,
		description,
		documentation: description,
		role: 'DmeProperty',
		pesc260805StableId: stableId,
		searchText: `SomeOwningType | ${name}`,
		pescTier: 'source',
	},
	sourceSearchTextElement: { role: 'DmeProperty', name, owningClassName: 'SomeOwningType' },
});

const oneResolvesToEdge = (fromStableId, toStableId) => ({
	type: 'RESOLVES_TO',
	fromRef: { source: 'PESC260805', id: fromStableId },
	toRef: { source: 'PESC260805', id: toStableId },
	properties: { provenanceTier: 'structural', pescTier: 'derived' },
});

const oneUnrelatedEdge = (fromStableId, toStableId) => ({
	type: 'HAS_PROPERTY',
	fromRef: { source: 'PESC260805', id: fromStableId },
	toRef: { source: 'PESC260805', id: toStableId },
	properties: { provenanceTier: 'structural', pescTier: 'source' },
});

// =================================================================================================
// THE PRECEDENCE MATRIX. Every row states the EXPECTED speaker and WHY, before the run.
// =================================================================================================
const PRECEDENCE_MATRIX = [
	{
		caseName: 'A. zero RESOLVES_TO alone (edges present but none of the right type)',
		expectedSpeaker: 'orderingTrap',
		reason:
			'the plain ordering fault with nothing else wrong — the guard must speak, or it is unreachable in the very case it exists for',
		buildGraph: () => ({
			nodes: [oneValidPropertyNode({ stableId: 'n1', name: 'Alpha', description: '' })],
			edges: [oneUnrelatedEdge('owner', 'n1')],
		}),
	},
	{
		caseName: 'B. zero RESOLVES_TO with an EMPTY edges array',
		expectedSpeaker: 'orderingTrap',
		reason:
			'an empty array is still an array, so the arrays check passes and the ordering guard must be what speaks — this is the boundary the arrays check could plausibly have swallowed',
		buildGraph: () => ({
			nodes: [oneValidPropertyNode({ stableId: 'n1', name: 'Alpha', description: '' })],
			edges: [],
		}),
	},
	{
		caseName: 'C. zero RESOLVES_TO + a node with NO pescTier property',
		expectedSpeaker: 'orderingTrap',
		reason:
			'THE MASKING CASE THAT MATTERS. The per-node property read must NOT speak first: if it did, a real ordering fault would surface as a confusing complaint about one stableId instead of as the diagnosis',
		buildGraph: () => {
			const oneNode = oneValidPropertyNode({ stableId: 'n1', name: 'Alpha', description: '' });
			delete oneNode.properties.pescTier;
			return { nodes: [oneNode], edges: [] };
		},
	},
	{
		caseName: 'D. zero RESOLVES_TO + a node MISSING its carried composer input',
		expectedSpeaker: 'orderingTrap',
		reason:
			'THE OTHER MASKING CASE, and the more likely one in practice: composing inside makeNode is exactly the placement where sourceSearchTextElement would not be set yet, so if this check spoke first the naive placement would report the wrong diagnosis',
		buildGraph: () => {
			const oneNode = oneValidPropertyNode({ stableId: 'n1', name: 'Alpha', description: '' });
			delete oneNode.sourceSearchTextElement;
			return { nodes: [oneNode], edges: [] };
		},
	},
	{
		caseName: 'E. zero RESOLVES_TO + edges is NOT an array',
		expectedSpeaker: 'arraysRequired',
		reason:
			'the arrays check SHOULD outrank the ordering guard here and this row asserts that it does — a malformed argument is a worse and more basic fault than a mis-ordered one, and reporting the ordering trap for a non-array would be a wrong diagnosis',
		buildGraph: () => ({
			nodes: [oneValidPropertyNode({ stableId: 'n1', name: 'Alpha', description: '' })],
			edges: 'not an array',
		}),
	},
	{
		caseName: 'F. zero RESOLVES_TO + no nodes at all',
		expectedSpeaker: 'orderingTrap',
		reason:
			'a degenerate input. The ordering guard reads EDGES, so it speaks before the node loop finds nothing to do — recorded as the observed behaviour rather than asserted as ideal, and discussed on the row below',
		buildGraph: () => ({ nodes: [], edges: [] }),
	},
	{
		caseName: 'G. CONTROL — RESOLVES_TO present and everything well formed',
		expectedSpeaker: 'NONE',
		reason:
			'THE ACCEPT-CONTROL. Without a case that must NOT refuse, a guard that refused unconditionally would score identically on every row above',
		buildGraph: () => {
			const declNode = oneValidPropertyNode({ stableId: 'n1', name: 'Alpha', description: '' });
			const typeNode = oneValidPropertyNode({
				stableId: 't1',
				name: 'AlphaType',
				description: 'The prose that the element borrows.',
			});
			typeNode.labels = ['ForgedNode', 'PescNamedDefinition', 'DmeClass'];
			return { nodes: [declNode, typeNode], edges: [oneResolvesToEdge('n1', 't1')] };
		},
	},
];

console.log('\nPRECEDENCE MATRIX — which refusal speaks, identified by its own message text');
const observedSpeakerByCase = {};
PRECEDENCE_MATRIX.forEach((oneCase) => {
	const { speaker, thrownMessage } = runOneCase(oneCase.buildGraph());
	observedSpeakerByCase[oneCase.caseName] = speaker;
	evidence(`${oneCase.caseName}`);
	evidence(`   expected: ${oneCase.expectedSpeaker}   observed: ${speaker}`);
	if (thrownMessage !== null) {
		evidence(`   said: ${thrownMessage.substring(0, 150).replace(/\s+/g, ' ')}`);
	}
	check(
		`REACHABILITY ${oneCase.caseName} -> ${oneCase.expectedSpeaker}`,
		speaker === oneCase.expectedSpeaker,
	);
});

// =================================================================================================
// THE DISCRIMINATION CHECK — the matrix must produce MORE THAN ONE speaker. A probe whose every row
// reported 'orderingTrap' would be indistinguishable from one run against a function that refuses
// unconditionally, and the accept-control alone does not rule that out for the MASKING rows.
// =================================================================================================
console.log('\nDISCRIMINATION — the matrix must distinguish speakers, not report one for everything');
const distinctSpeakers = [...new Set(Object.values(observedSpeakerByCase))].sort();
evidence(`distinct speakers observed: ${distinctSpeakers.join(', ')}`);
check(
	'DISCRIMINATION the matrix elicited MORE THAN ONE distinct speaker',
	distinctSpeakers.length > 1,
);
check(
	'DISCRIMINATION at least one row was NOT the ordering guard (so it is not refusing unconditionally)',
	distinctSpeakers.some((oneSpeaker) => oneSpeaker !== 'orderingTrap'),
);
check(
	'DISCRIMINATION no row produced an UNRECOGNISED or AMBIGUOUS refusal',
	!distinctSpeakers.some(
		(oneSpeaker) => oneSpeaker === 'UNRECOGNISED' || oneSpeaker.indexOf('AMBIGUOUS') === 0,
	),
);

// =================================================================================================
// THE CALLER PATH — nothing upstream may short-circuit before the pass is reached at all. This is a
// CODE FACT read from the caller, asserted here so a future reordering of the forge's build block
// fails this probe instead of silently skipping the composition.
// =================================================================================================
console.log('\nCALLER PATH — the composition is reached, and reached in the right place');
const fs = require('fs');
const forgeText = fs.readFileSync(path.join(BUNDLE_DIR, 'forgePesc260805.js'), 'utf8');
const derivedCallIndex = forgeText.indexOf('const derivedOutput = buildDerivedTier(');
const applyDerivedIndex = forgeText.indexOf('const combinedGraph = applyDerivedTier(');
const compositionCallIndex = forgeText.indexOf('applySearchTextComposition({');
const syntheticCallIndex = forgeText.indexOf('const syntheticOutput = buildSyntheticTier(');
evidence(
	`call offsets — buildDerivedTier ${derivedCallIndex}, applyDerivedTier ${applyDerivedIndex}, ` +
		`applySearchTextComposition ${compositionCallIndex}, buildSyntheticTier ${syntheticCallIndex}`,
);
check(
	'CALLER the composition is called exactly once',
	forgeText.split('applySearchTextComposition({').length - 1 === 1,
);
check(
	'CALLER the composition runs AFTER applyDerivedTier (so RESOLVES_TO exists)',
	applyDerivedIndex > 0 && compositionCallIndex > applyDerivedIndex,
);
check(
	'CALLER the composition runs BEFORE buildSyntheticTier (the ruled placement)',
	syntheticCallIndex > 0 && compositionCallIndex < syntheticCallIndex,
);
check(
	'CALLER the composition is handed the COMBINED graph, not the source graph',
	forgeText.indexOf(
		'applySearchTextComposition({\n\t\t\t\t\t\tnodes: combinedGraph.nodes,\n\t\t\t\t\t\tedges: combinedGraph.edges,\n\t\t\t\t\t})',
	) !== -1,
);
// there is no early return, conditional or short-circuit between applyDerivedTier and the
// composition: the three statements are consecutive inside the one sanctioned try block. Asserted by
// checking that no `return`, `if (` or `next(` appears between them.
const betweenApplyAndComposition = forgeText.substring(applyDerivedIndex, compositionCallIndex);
const shortCircuitTokens = ['return', 'next(', 'if ('].filter(
	(oneToken) => betweenApplyAndComposition.indexOf(oneToken) !== -1,
);
if (shortCircuitTokens.length > 0) {
	evidence(`tokens found between applyDerivedTier and the composition: ${shortCircuitTokens.join(', ')}`);
}
check(
	'CALLER nothing can short-circuit between applyDerivedTier and the composition (no return/next/if between them)',
	shortCircuitTokens.length === 0,
);

console.log(`\np0b_orderingGuardReachability: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
