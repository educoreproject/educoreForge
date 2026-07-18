'use strict';

// =====================================================================
// ctdlFamilyStructure — the PILOT forge module (forgeArchitectureRefactor
// SPECIFICATION v2 S2; the uniform-contract PATTERN-SETTER every future
// bridgeMaker module copies).
// =====================================================================
// Authors the CTDL-family cross-standard STRUCTURAL relationships as THREE
// pair-scoped, version-keyed structuralBridge emissions — one per pairing,
// S11 ordering (family-root first, then lexicographic):
//   CTDL::CTDLASN, CTDL::CTDLQData, CTDLASN::CTDLQData
//
// CONTRACT (S2): a module is a passive object — { kind, name, requires, run }.
//   - requires entries are standardKeys RESOLVED THROUGH standardDiscovery by the
//     runner (never string-equal against spoken names — the F8 casing trap).
//   - run({ reader, emitBlock, log }, callback): reads ONLY through the injected
//     reader (S4 — modules never open the store or a driver); hands each pairing's
//     content to emitBlock; the RUNNER owns version stamps, serialization, and
//     every store write (S8: modules never write edges — blocks only, and even the
//     block persistence is the runner's).
//   - emitBlock({ pairA, pairB, edges, counts }) — edges canonically sorted and
//     deduped (R2-2) BEFORE emission; pairA/pairB already in S11 order.
//
// EDGE AUTHORSHIP (the edf-ctdl-uri-bridge lineage, S1.6 supersession):
//   - Inputs: the PARSED crossRefs of all three standards' nodes (via the reader).
//   - Resolution: raw CURIE -> the node whose uri/stableId equals it — a
//     deterministic same-URI identity join. Never similarity, never fabrication.
//   - Edge typing: the ratified LOCATOR_EDGE table below — MOVED IN from
//     edfCtdlUriBridge.js and now the SINGLE SOURCE OF TRUTH (that tool requires
//     it from here until its retirement).
//   - NO equivalence/SSSOM edges: no equivalence locator appears in LOCATOR_EDGE,
//     so any such crossRef lands in skippedUnknownLocator and is REPORTED.
//   - Unlike the legacy tool there is NO alreadyBridged suppression: every
//     resolvable cross-standard family crossRef is authored (S9.4 — the surplus
//     over the legacy 229 is expected and is the genesis census's business).
//   - Unresolved crossRefs are REPORTED, never invented; intra-standard
//     resolutions are the standard's own forge's business — counted, not emitted.
//   - R2-7: a pairing with ZERO edges emits NOTHING and reports the empty pairing
//     explicitly (empty is a verdict, not a surprise).
//
// PROVENANCE per edge: provenanceSource='uriBridge', provenanceTier='structural',
// bridgeAuthored=true, crossRefLocator, owner=':golden'. Block-level
// producedBy='ctdlFamilyStructure' is stamped by the runner at saveBlock.
//
// DETERMINISM (S11): no wall-clock, no randomness; edges sorted by
// (type, fromRef.id, toRef.id); dedup keyed the same way; node iteration follows
// block order (itself deterministic content).

const path = require('path');

const { PROVENANCE_TIER } = require(
	path.join(__dirname, '..', '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib', 'vocabulary', 'vocabulary'),
);

const MODULE_NAME = 'ctdlFamilyStructure';
const PROVENANCE_SOURCE = 'uriBridge';
const FAMILY_ROOT_STANDARD = 'CTDL'; // S11: family-root first in pair ordering
const REQUIRED_STANDARDS = ['CTDL', 'CTDLASN', 'CTDLQData'];

// crossRef locator -> the CORRECT structural edge (type + direction). Ratified by
// FADED_FORGE; MOVED IN from edfCtdlUriBridge.js (S2 — single source of truth).
//   direction 'targetToSource' emits (target)->(source); 'sourceToTarget' emits (source)->(target).
const LOCATOR_EDGE = {
	'schema:domainIncludes': { type: 'HAS_PROPERTY', direction: 'targetToSource' },
	'schema:rangeIncludes': { type: 'REFERENCES', direction: 'sourceToTarget' },
	'rdfs:subClassOf': { type: 'SUBCLASS_OF', direction: 'sourceToTarget' },
	'meta:targetScheme': { type: 'HAS_OPTION_SET', direction: 'sourceToTarget' },
};

// canonical pairing order (S11): family-root first where present, else lexicographic
// by standardKey (exact discovery casing — the reader surfaces store subjects, which
// are pinned to discovery casing).
const orderPairing = (standardKeyOne, standardKeyTwo) => {
	if (standardKeyOne === FAMILY_ROOT_STANDARD) {
		return [standardKeyOne, standardKeyTwo];
	}
	if (standardKeyTwo === FAMILY_ROOT_STANDARD) {
		return [standardKeyTwo, standardKeyOne];
	}
	return standardKeyOne < standardKeyTwo
		? [standardKeyOne, standardKeyTwo]
		: [standardKeyTwo, standardKeyOne];
};

const edgeSortKey = (oneEdge) => `${oneEdge.type} ${oneEdge.fromRef.id} ${oneEdge.toRef.id}`;

const run = ({ reader, emitBlock, log }, callback) => {
	// ---- defensive requires check (the runner enforces first; a module never
	// trusts that it did — ERROR, never silent-skip) ----
	const presentKeys = reader.standardsPresent().map((oneEntry) => oneEntry.standardKey);
	const missingStandards = REQUIRED_STANDARDS.filter(
		(oneKey) => presentKeys.indexOf(oneKey) === -1,
	);
	if (missingStandards.length > 0) {
		callback(
			`${MODULE_NAME}: required standards missing from the working manifest: ` +
				`${missingStandards.join(', ')} (present: ${presentKeys.join(', ')})`,
		);
		return;
	}

	// ---- identity universe: every uri/stableId of every family node -> owner ----
	// identifier -> { ownerStandard, source } (the surviving _source scalar).
	const identityUniverse = new Map();
	const identityCollisions = []; // cross-standard identifier collisions — reported, never guessed
	REQUIRED_STANDARDS.forEach((oneStandardKey) => {
		reader.nodesFor(oneStandardKey).forEach((oneNode) => {
			const identifiers = new Set(oneNode.uris);
			if (oneNode.stableId) {
				identifiers.add(oneNode.stableId);
			}
			identifiers.forEach((oneIdentifier) => {
				const priorEntry = identityUniverse.get(oneIdentifier);
				if (priorEntry && priorEntry.ownerStandard !== oneStandardKey) {
					identityCollisions.push({
						identifier: oneIdentifier,
						owners: [priorEntry.ownerStandard, oneStandardKey],
					});
					return; // first registration stands; the collision is surfaced in the report
				}
				identityUniverse.set(oneIdentifier, {
					ownerStandard: oneStandardKey,
					source: oneNode.source,
				});
			});
		});
	});

	// ---- resolve every crossRef of every family standard ----
	const edgesByPairSubject = new Map(); // 'A::B' -> Map(edgeSortKey -> edge)
	const dedupCountByPairSubject = new Map(); // R2-2: collided emissions, counted
	const unresolvedByStandard = {}; // sourceStandard -> sorted [raw]
	const unresolvedSets = new Map();
	const skippedUnknownLocator = {}; // locator -> count (equivalence & friends land here)
	let intraStandardCount = 0;
	let crossRefsTotal = 0;

	REQUIRED_STANDARDS.forEach((sourceStandardKey) => {
		reader.nodesFor(sourceStandardKey).forEach((oneNode) => {
			oneNode.crossRefs.forEach((oneRef) => {
				crossRefsTotal++;
				const raw = oneRef.raw || oneRef.id;
				const targetEntry = identityUniverse.get(raw);
				if (!targetEntry) {
					const unresolvedSet =
						unresolvedSets.get(sourceStandardKey) || new Set();
					unresolvedSet.add(raw);
					unresolvedSets.set(sourceStandardKey, unresolvedSet);
					return;
				}
				const rule = LOCATOR_EDGE[oneRef.locator];
				if (!rule) {
					skippedUnknownLocator[oneRef.locator] =
						(skippedUnknownLocator[oneRef.locator] || 0) + 1;
					return;
				}
				if (targetEntry.ownerStandard === sourceStandardKey) {
					intraStandardCount++;
					return;
				}

				const [pairA, pairB] = orderPairing(
					sourceStandardKey,
					targetEntry.ownerStandard,
				);
				const pairSubjectKey = `${pairA}::${pairB}`;

				// endpoint convention (fixture-compatible, edf-ctdl-uri-bridge verbatim):
				// the SOURCE side externalizes its stableId; the TARGET side externalizes
				// the raw CURIE exactly as written (raw IS one of the target node's
				// identifiers — the identity join guarantees it).
				const [fromId, toId] =
					rule.direction === 'targetToSource'
						? [raw, oneNode.stableId]
						: [oneNode.stableId, raw];
				const sourceOf = (oneId) =>
					oneId === raw ? targetEntry.source : oneNode.source;
				const candidateEdge = {
					type: rule.type,
					fromRef: { source: sourceOf(fromId) || null, id: fromId },
					toRef: { source: sourceOf(toId) || null, id: toId },
					properties: {
						provenanceTier: PROVENANCE_TIER.STRUCTURAL,
						provenanceSource: PROVENANCE_SOURCE,
						bridgeAuthored: true,
						crossRefLocator: oneRef.locator,
						owner: ':golden',
					},
				};

				const pairEdges = edgesByPairSubject.get(pairSubjectKey) || new Map();
				const dedupKey = edgeSortKey(candidateEdge);
				if (pairEdges.has(dedupKey)) {
					// R2-2: replay MERGEs on type+endpoints with last-write-wins props —
					// collided triples would be silently property-order-dependent; dedup
					// here removes the hazard. First emission stands; collision counted.
					dedupCountByPairSubject.set(
						pairSubjectKey,
						(dedupCountByPairSubject.get(pairSubjectKey) || 0) + 1,
					);
					return;
				}
				pairEdges.set(dedupKey, candidateEdge);
				edgesByPairSubject.set(pairSubjectKey, pairEdges);
			});
		});
	});

	unresolvedSets.forEach((oneSet, oneStandardKey) => {
		unresolvedByStandard[oneStandardKey] = Array.from(oneSet).sort();
	});

	// ---- emit per pairing, S11 order; zero-edge pairing emits NOTHING + reports ----
	const familyPairings = [
		orderPairing('CTDL', 'CTDLASN'),
		orderPairing('CTDL', 'CTDLQData'),
		orderPairing('CTDLASN', 'CTDLQData'),
	];
	const emittedPairings = [];
	const emptyPairings = [];

	familyPairings.forEach(([pairA, pairB]) => {
		const pairSubjectKey = `${pairA}::${pairB}`;
		const pairEdgesMap = edgesByPairSubject.get(pairSubjectKey);
		const sortedEdges = pairEdgesMap
			? Array.from(pairEdgesMap.keys())
					.sort()
					.map((oneKey) => pairEdgesMap.get(oneKey))
			: [];
		if (sortedEdges.length === 0) {
			// R2-7: pair-group-mint refuses empty groups; an empty pairing is a
			// REPORTED VERDICT, never a zero-edge block.
			emptyPairings.push(pairSubjectKey);
			log(`${MODULE_NAME}: pairing ${pairSubjectKey} yielded ZERO edges — nothing emitted (reported)`);
			return;
		}
		const byType = {};
		sortedEdges.forEach((oneEdge) => {
			byType[oneEdge.type] = (byType[oneEdge.type] || 0) + 1;
		});
		emitBlock({
			pairA,
			pairB,
			edges: sortedEdges,
			counts: {
				edges: sortedEdges.length,
				dedupedAtEmission: dedupCountByPairSubject.get(pairSubjectKey) || 0,
				byType,
			},
		});
		emittedPairings.push({ pairSubject: pairSubjectKey, edges: sortedEdges.length });
		log(`${MODULE_NAME}: pairing ${pairSubjectKey} — ${sortedEdges.length} edges emitted`);
	});

	callback('', {
		module: MODULE_NAME,
		crossRefsTotal,
		emittedPairings,
		emptyPairings,
		unresolvedByStandard,
		skippedUnknownLocator,
		intraStandardCount,
		identityCollisions,
	});
};

module.exports = {
	kind: 'structuralBridgeModule',
	name: MODULE_NAME,
	requires: REQUIRED_STANDARDS,
	run,
	LOCATOR_EDGE, // exported single source of truth (edfCtdlUriBridge consumes this until retirement)
};
