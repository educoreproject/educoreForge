'use strict';

// ctdlFamilyStructure — the CTDL-family intra-family STRUCTURAL bridge, the ONE COORDINATING PRODUCER
// that reads the WHOLE family once and emits THREE pair-scoped blocks in a single pass. It implements
// the PROVEN ALGORITHM of the incumbent cli/parserLib/forge-ctdl/modules/ctdlFamilyStructure.js — the
// LOCATOR_EDGE table, the same-URI identity join, the provenance stamps, the R2-2 dedup and R2-7 empty
// -pairing verdict — in OUR idiom. TQ's decision: the incumbent's ALGORITHM, our contract.
//
// THE ONE-PRODUCER-THREE-BLOCKS SHAPE (TQ 2026-07-26; supersedes the earlier per-pair-invocation shape):
//   The incumbent authored all THREE CTDL-family pairings in one pass and emitted three blocks. This
//   producer does the SAME: it reads every family standard's ForgedNodes ONCE, builds a single identity
//   universe over the whole family, coordinates/dedups crossRef resolution across it, and emits THREE
//   pair-scoped edge-sets — each under its OWN distinct per-pair applyLabel — in one pass. build.js's
//   Phase C harvests EACH label into its own pair-scoped, version-keyed `_struct` block. This is the
//   natural home for the cross-pair coordination the per-invocation design bolted on awkwardly: a crossRef
//   from CTDL into CTDLQData is simply ASSIGNED to the ctdl::ctdlqdata pairing here, in the same pass,
//   rather than counted as "crossPairScope owned by another invocation".
//
//   Because the single family bridge is sourced from ctdl (the family root), it resolves in
//   forges/ctdl/bridges/ — the placement/resolution failure the three-invocation shape hit (a
//   ctdlasn::ctdlqdata entry sourced from ctdlasn searching forges/ctdlasn/bridges/ where this file does
//   not live) simply disappears: there is now ONE entry, sourced from ctdl.
//
//   The recreation stores forged nodes as :ForgedNode with a SCALAR `_source`, a `uri`/`stableId` identity,
//   and a `crossRefs` JSON-array property {system,id,raw,locator} (code fact, forges/ctdl/forgeCtdl.js +
//   forges/ctdl/lib/parser.js: cross-standard refs stamp locator schema:domainIncludes / schema:rangeIncludes
//   / rdfs:subClassOf / meta:targetScheme — EXACTLY the incumbent's LOCATOR_EDGE keys).
//
// THE CONTRACT (interfaces.js @interface BridgeModule; BRIDGE_MODULE_SHAPE):
//   bridgeModule({ ...injected library tools }) ({ inGraph, hub, applyLabel }, cb)
//       -> cb('', { edgesWritten, counts, decisionBlock, producer, blocks })
//   The callable reads inGraph/hub/applyLabel off ONE named-argument object (arity 2). `applyLabel` is the
//   BASE label; each emitted pairing writes under `${applyLabel}_${FIRSTKEY}_${SECONDKEY}` (a bare Cypher
//   identifier) and REPORTS that label in its `blocks[]` entry so build.js harvests each edge-set on its own.
//   hub is null (a structural bridge authors toward NO CEDS hub); a non-null hub is a recipe error refused
//   BY NAME. The producer's OWN operational data — the whole family's standard tokens and which is the root
//   — arrives on injected `config` (config.familyStandards, config.sourceStandard).
//
//   THE `blocks` KEY is how a bridge invocation emits MULTIPLE pair-scoped blocks (the contract change). Each
//   entry: { applyLabel, firstStandard, secondStandard, producer:'structural', edgesWritten, decisionBlock,
//   emptyPairing, counts }. firstStandard/secondStandard are the pair's TOKENS (root-first then lexicographic)
//   so build.js version-keys each block on BOTH endpoints. A single-block mapping bridge simply does NOT
//   return `blocks` (the degenerate list-of-one is synthesized downstream) — this producer is the multi-block
//   case, and the two coexist under one contract.
//
// THE ALGORITHM (from the incumbent, faithfully):
//   Inputs: the crossRefs carried on EVERY family standard's nodes, resolved against the whole family's
//     identities. Resolution: a crossRef's target identifier (raw CURIE) -> the node whose uri/stableId EQUALS
//     it — a deterministic same-URI identity join. NEVER similarity, NEVER fabrication.
//   Edge typing: the LOCATOR_EDGE table below (copied verbatim from the incumbent — the single source of truth).
//   Provenance per edge: provenanceSource='uriBridge', provenanceTier='structural', bridgeAuthored=true,
//     crossRefLocator=<the locator>, owner=':golden'.
//   Assignment: an edge whose two endpoints are two DISTINCT family standards is assigned to THAT unordered
//     pairing's edge-set. Intra-standard resolutions are counted, not emitted. Unresolved crossRefs (target in
//     NO family standard) are REPORTED as danglers, never invented. An unknown locator (equivalence &c.) is
//     REPORTED (skippedUnknownLocator), never turned into an SSSOM edge.
//   Determinism: within each pairing, edges sorted by (type, fromRef.id, toRef.id); dedup keyed the same way
//     (R2-2, collision counted, first emission stands); NO wall-clock, NO randomness.
//   R2-7: a pairing with ZERO edges emits NOTHING and reports emptyPairing:true in its block entry.
//
// House style: qtools curried moduleFunction; callback(errString, result) with '' on success; no async/await,
// no try/catch for control flow (the ONE try/catch is the JSON.parse guard on a crossRefs/uris cell — a parse
// guard that turns a malformed cell into a REPORTED row, not a crash; the ctdlAnchorHarvest precedent).
// camelCase; compound names.

const path = require('path');

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const { PROVENANCE_TIER } = require(
	path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'),
);

const PROVENANCE_SOURCE = 'uriBridge';
const PRODUCER_KIND = 'structural';

// crossRef locator -> the CORRECT structural edge (type + direction). COPIED VERBATIM from the incumbent
// ctdlFamilyStructure LOCATOR_EDGE (the single source of truth; ratified by FADED_FORGE).
//   direction 'targetToSource' emits (target)->(source); 'sourceToTarget' emits (source)->(target).
const LOCATOR_EDGE = {
	'schema:domainIncludes': { type: 'HAS_PROPERTY', direction: 'targetToSource' },
	'schema:rangeIncludes': { type: 'REFERENCES', direction: 'sourceToTarget' },
	'rdfs:subClassOf': { type: 'SUBCLASS_OF', direction: 'sourceToTarget' },
	'meta:targetScheme': { type: 'HAS_OPTION_SET', direction: 'sourceToTarget' },
};

const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

const edgeSortKey = (oneEdge) => `${oneEdge.type} ${oneEdge.fromRef.id} ${oneEdge.toRef.id}`;

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// identifiersOf — every identifier the same-URI identity join may match a crossRef against: the node's
// stableId AND its uri (the recreation sets uri===stableId for CTDL; sibling standards may carry a distinct
// uri, so BOTH are indexed). A plural `uris` cell (array, or a JSON-array string) is indexed too, faithful to
// the incumbent's oneNode.uris. A malformed uris JSON cell is REPORTED (via the returned malformed flag),
// never crashed on.
const identifiersOf = (oneNode) => {
	const props = oneNode.properties || {};
	const identifierSet = new Set();
	if (oneNode.stableId) {
		identifierSet.add(`${oneNode.stableId}`);
	}
	const uriScalar = v1(props.uri);
	if (uriScalar) {
		identifierSet.add(`${uriScalar}`);
	}
	let malformedUris = false;
	const rawUris = props.uris;
	if (Array.isArray(rawUris)) {
		rawUris.forEach((oneUri) => oneUri && identifierSet.add(`${oneUri}`));
	} else if (typeof rawUris === 'string' && rawUris.trim().charAt(0) === '[') {
		try {
			JSON.parse(rawUris).forEach((oneUri) => oneUri && identifierSet.add(`${oneUri}`));
		} catch (parseError) {
			malformedUris = true; // reported by the caller, not thrown
		}
	}
	return { identifierSet, malformedUris };
};

// crossRefsOf — parse the node's crossRefs cell (JSON array, or already an array) into a list; a malformed
// cell is REPORTED (returned flag), never crashed on.
const crossRefsOf = (oneNode) => {
	const rawCrossRefs = v1((oneNode.properties || {}).crossRefs);
	if (rawCrossRefs === undefined || rawCrossRefs === null || rawCrossRefs === '') {
		return { crossRefList: [], malformed: false };
	}
	if (Array.isArray(rawCrossRefs)) {
		return { crossRefList: rawCrossRefs, malformed: false };
	}
	if (typeof rawCrossRefs === 'string') {
		try {
			const parsed = JSON.parse(rawCrossRefs);
			return { crossRefList: Array.isArray(parsed) ? parsed : [], malformed: false };
		} catch (parseError) {
			return { crossRefList: [], malformed: true };
		}
	}
	return { crossRefList: [], malformed: false };
};

// canonPair — the ORDER-INDEPENDENT key of an unordered pairing, so a CTDL->CTDLASN edge and a
// CTDLASN->CTDL edge land in the SAME pairing regardless of which endpoint owns the crossRef.
const canonPair = (keyA, keyB) => [keyA, keyB].sort().join('::');

// START OF moduleFunction() ============================================================

const moduleFunction =
	(injectedTools = {}) =>
	({ inGraph, hub, applyLabel }, callback) => {
		const { graphReader, relationshipWriter, config = {} } = injectedTools;

		// EVERY injected tool this producer composes is stated, or it does not run (polyArch2 §6). A missing
		// tool is a wiring fault, named — never a silent no-op that writes zero edges and reads as success.
		if (typeof graphReader !== 'function') {
			callback(`${moduleName}: injected tool 'graphReader' is not a function — the component library did not supply it.`);
			return;
		}
		if (typeof relationshipWriter !== 'function') {
			callback(`${moduleName}: injected tool 'relationshipWriter' is not a function — the component library did not supply it.`);
			return;
		}
		if (!inGraph) {
			callback(`${moduleName}: inGraph is not given — there is no graph to read the family nodes from.`);
			return;
		}
		// hub is READ and CHECKED: a STRUCTURAL family bridge authors toward NO CEDS hub; its endpoints are the
		// family's sibling STANDARDS, not a hub. A non-null hub is a recipe error, refused by name.
		if (hub !== null && hub !== undefined) {
			callback(
				`${moduleName}: hub is ${JSON.stringify(hub)}, but this is a STRUCTURAL family bridge — it authors ` +
					`intra-family edges among its sibling standards and toward no hub. A hub here is a recipe error.`,
			);
			return;
		}
		if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
			callback(
				`${moduleName}: applyLabel is ${applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)} — ` +
					`it is the BASE label each pairing suffixes; there is no default.`,
			);
			return;
		}
		const rootStandard = config.sourceStandard;
		if (typeof rootStandard !== 'string' || rootStandard.trim() === '') {
			callback(`${moduleName}: config.sourceStandard is not set — the family root (the S11-first endpoint) has no default.`);
			return;
		}
		// familyStandards is the WHOLE family (the pairing universe AND the read scope). A structural family
		// bridge must be told its family; there is no default, and a family of fewer than two standards has no
		// pairing to author. Each malformed shape is refused BY NAME (polyArch2 §6).
		const familyTokens = Array.isArray(config.familyStandards) ? config.familyStandards : null;
		if (!familyTokens) {
			callback(`${moduleName}: config.familyStandards is not an array — a structural family bridge must be told the whole family; there is no default.`);
			return;
		}
		// key (UPPERCASED _source) <-> token (lowercase recipe token) both kept: keys own the pairing order and
		// label the edges; tokens version-key the blocks. THE CASE RULE (CORRECTED): the recipe names standards
		// lowercase ('ctdlqdata'); the forge stamps `_source` with the registry standardName EXACTLY — which is
		// NOT always uppercase ('CTDL' and 'CTDLASN' are, but CTDL-QData is the mixed-case 'CTDLQData',
		// forge-ctdlqdata STANDARD_SOURCE, 'no toLower anywhere'). A literal `_source === token.toUpperCase()`
		// read matched CTDL/CTDLASN by luck and SILENTLY DROPPED every CTDL-QData node (they never entered the
		// family read, so both ctdl::ctdlqdata and ctdlasn::ctdlqdata resolved ZERO edges). The family is therefore
		// read case-INSENSITIVELY (sourceKeyOf below): a node is bucketed to the family key whose UPPERCASE equals
		// its UPPERCASE `_source`, regardless of the registry's casing. The key we tag with stays uppercase, so
		// pairing order and the pair labels are unchanged (CTDL::CTDLASN stays exactly as it was — undisturbed).
		const keyToToken = {};
		familyTokens.forEach((oneToken) => {
			keyToToken[`${oneToken}`.toUpperCase()] = `${oneToken}`;
		});
		const familyKeys = Object.keys(keyToToken);
		if (familyKeys.length < 2) {
			callback(`${moduleName}: config.familyStandards resolves to ${familyKeys.length} distinct standard(s) — a family needs at least two DISTINCT standards to author a pairing.`);
			return;
		}
		const rootKey = rootStandard.toUpperCase();
		if (!keyToToken[rootKey]) {
			callback(`${moduleName}: config.sourceStandard '${rootStandard}' is not among config.familyStandards [${familyTokens.join(', ')}] — the root must be a family member.`);
			return;
		}

		// PAIRING ORDER — S11: family-root first, then the rest lexicographically; all unordered pairs in that
		// order. This gives each block a deterministic ROOT-FIRST endpoint order (ctdl::ctdlasn, ctdl::ctdlqdata,
		// ctdlasn::ctdlqdata) that build.js version-keys and that scans together.
		const orderedKeys = [rootKey].concat(familyKeys.filter((oneKey) => oneKey !== rootKey).sort());
		const pairings = [];
		const pairingByCanon = new Map();
		for (let i = 0; i < orderedKeys.length; i++) {
			for (let j = i + 1; j < orderedKeys.length; j++) {
				const firstKey = orderedKeys[i];
				const secondKey = orderedKeys[j];
				const pairing = {
					firstKey,
					secondKey,
					firstToken: keyToToken[firstKey],
					secondToken: keyToToken[secondKey],
					pairLabel: `${applyLabel}_${firstKey}_${secondKey}`,
					pairKeySet: new Set([firstKey, secondKey]),
					edgesByKey: new Map(),
					dedupedAtEmission: 0,
					edgesWritten: 0,
				};
				pairings.push(pairing);
				pairingByCanon.set(canonPair(firstKey, secondKey), pairing);
			}
		}

		const reader = graphReader({ inGraph });

		// sourceKeyOf — the family key (UPPERCASE, the pairing/label key) a node belongs to, matched
		// case-INSENSITIVELY against its `_source`. Returns null for a node whose `_source` is missing or is not
		// a family member (defensive — the family dependency graph holds only family base blocks, but a stray
		// non-family ForgedNode is simply ignored, never mis-bucketed). This is the fix for the mixed-case
		// registry-name trap described at keyToToken above.
		const sourceKeyOf = (oneNode) => {
			const rawSource = (oneNode.properties || {})._source;
			if (rawSource === undefined || rawSource === null || `${rawSource}` === '') {
				return null;
			}
			const upperSource = `${rawSource}`.toUpperCase();
			return keyToToken[upperSource] ? upperSource : null;
		};

		const taskList = new taskListPlus();

		// WALK — read the WHOLE family's ForgedNodes in ONE pass (no propertyEquals: the reader returns every
		// :ForgedNode — the same WHERE-less query the real neo4jGraphReader runs), then BUCKET each into its
		// family standard by case-insensitive `_source`, tagging it in place with its uppercase family key. This
		// is the literal reading of the producer's own contract ('read every family standard ONCE') and it no
		// longer depends on the forge's `_source` casing matching `token.toUpperCase()`.
		taskList.push((args, next) => {
			reader.readNodes({ label: 'ForgedNode' }, (err, out) => {
				if (err) {
					next(`${moduleName}: reading family ForgedNodes: ${err}`);
					return;
				}
				const allFamilyNodes = ((out || {}).nodes || []).reduce((accumulatedNodes, oneNode) => {
					const ownerKey = sourceKeyOf(oneNode);
					if (ownerKey) {
						oneNode.ownerStandard = ownerKey;
						accumulatedNodes.push(oneNode);
					}
					return accumulatedNodes;
				}, []);
				next('', { ...args, allFamilyNodes });
			});
		});

		// RESOLVE + ASSIGN — build the sorted, deduped edge set FOR EACH pairing in one pass (pure; no write yet).
		taskList.push((args, next) => {
			const allFamilyNodes = args.allFamilyNodes || [];

			// identity universe over the WHOLE family: identifier -> ownerStandard. A cross-standard identifier
			// collision is REPORTED, never guessed (first registration stands, as the incumbent).
			const identityUniverse = new Map();
			const identityCollisions = [];
			const malformedUrisNodes = [];
			allFamilyNodes.forEach((oneNode) => {
				const { identifierSet, malformedUris } = identifiersOf(oneNode);
				if (malformedUris) {
					malformedUrisNodes.push(oneNode.stableId);
				}
				identifierSet.forEach((oneIdentifier) => {
					const priorOwner = identityUniverse.get(oneIdentifier);
					if (priorOwner !== undefined && priorOwner !== oneNode.ownerStandard) {
						identityCollisions.push({ identifier: oneIdentifier, owners: [priorOwner, oneNode.ownerStandard] });
						return;
					}
					identityUniverse.set(oneIdentifier, oneNode.ownerStandard);
				});
			});

			let dedupedAtEmission = 0; // R2-2, aggregate across pairings
			const unresolvedSets = new Map(); // ownerStandard -> Set(raw) — TRUE danglers (target in NO family standard)
			const skippedUnknownLocator = {}; // locator -> count
			const malformedCrossRefsNodes = [];
			let intraStandardCount = 0;
			let crossRefsTotal = 0;
			let outOfFamilyPairCount = 0; // resolved to a family standard NOT paired with the owner (defensive; 0 for a full family)

			// Iterate crossRefs on EVERY family node (the coordinating one-pass walk). Each resolved cross-standard
			// ref is ASSIGNED to its unordered pairing's edge-set — no ref is "owned by another invocation".
			allFamilyNodes.forEach((oneNode) => {
				const { crossRefList, malformed } = crossRefsOf(oneNode);
				if (malformed) {
					malformedCrossRefsNodes.push(oneNode.stableId);
					return;
				}
				crossRefList.forEach((oneRef) => {
					crossRefsTotal++;
					const raw = `${oneRef.raw != null ? oneRef.raw : oneRef.id}`;
					const targetOwner = identityUniverse.get(raw);
					if (targetOwner === undefined) {
						// TRUE dangler — target found in NO family standard. REPORTED, never invented.
						const unresolvedSet = unresolvedSets.get(oneNode.ownerStandard) || new Set();
						unresolvedSet.add(raw);
						unresolvedSets.set(oneNode.ownerStandard, unresolvedSet);
						return;
					}
					const rule = LOCATOR_EDGE[oneRef.locator];
					if (!rule) {
						// no equivalence locator is in LOCATOR_EDGE, so equivalence & friends land here — REPORTED.
						skippedUnknownLocator[oneRef.locator] = (skippedUnknownLocator[oneRef.locator] || 0) + 1;
						return;
					}
					if (targetOwner === oneNode.ownerStandard) {
						// intra-standard resolution — the standard's own forge's business; counted, not emitted.
						intraStandardCount++;
						return;
					}
					const pairing = pairingByCanon.get(canonPair(oneNode.ownerStandard, targetOwner));
					if (!pairing) {
						// resolves to a family standard that shares no pairing with the owner — impossible for a
						// complete family (every unordered pair exists), so this is a defensive REPORT, not a drop.
						outOfFamilyPairCount++;
						return;
					}

					// endpoint convention (edf-ctdl-uri-bridge verbatim): the OWNING node externalizes its own
					// stableId; the TARGET side externalizes the raw CURIE exactly as written. Direction orders them.
					const rawRef = { source: targetOwner, id: raw };
					const ownRef = { source: oneNode.ownerStandard, id: oneNode.stableId };
					const [fromRef, toRef] =
						rule.direction === 'targetToSource' ? [rawRef, ownRef] : [ownRef, rawRef];
					const candidateEdge = {
						type: rule.type,
						fromRef,
						toRef,
						properties: {
							provenanceTier: PROVENANCE_TIER.STRUCTURAL,
							provenanceSource: PROVENANCE_SOURCE,
							bridgeAuthored: true,
							crossRefLocator: oneRef.locator,
							owner: ':golden',
						},
					};
					const dedupKey = edgeSortKey(candidateEdge);
					if (pairing.edgesByKey.has(dedupKey)) {
						// R2-2: first emission stands; the collision is counted, not silently order-dependent.
						dedupedAtEmission++;
						pairing.dedupedAtEmission++;
						return;
					}
					pairing.edgesByKey.set(dedupKey, candidateEdge);
				});
			});

			// freeze each pairing's sorted edge list + its per-pair report.
			pairings.forEach((pairing) => {
				pairing.sortedEdges = Array.from(pairing.edgesByKey.keys())
					.sort()
					.map((oneKey) => pairing.edgesByKey.get(oneKey));
				pairing.byType = {};
				pairing.sortedEdges.forEach((oneEdge) => {
					pairing.byType[oneEdge.type] = (pairing.byType[oneEdge.type] || 0) + 1;
				});
			});

			const unresolvedByStandard = {};
			unresolvedSets.forEach((oneSet, oneStandardKey) => {
				unresolvedByStandard[oneStandardKey] = Array.from(oneSet).sort();
			});

			const byType = {};
			pairings.forEach((pairing) => {
				Object.keys(pairing.byType).forEach((oneType) => {
					byType[oneType] = (byType[oneType] || 0) + pairing.byType[oneType];
				});
			});

			next('', {
				...args,
				aggregateReport: {
					crossRefsTotal,
					dedupedAtEmission,
					byType,
					intraStandardCount,
					outOfFamilyPairCount,
					unresolvedByStandard,
					skippedUnknownLocator,
					identityCollisions,
					malformedCrossRefsNodes,
					malformedUrisNodes,
				},
			});
		});

		// WRITE — one labeled STRUCTURAL edge per resolved, deduped, sorted pairing edge, each under ITS pairing's
		// distinct pairLabel. R2-7: a ZERO-edge pairing writes NOTHING and is reported emptyPairing:true.
		taskList.push((args, next) => {
			const writeList = new taskListPlus();
			pairings.forEach((pairing) => {
				pairing.sortedEdges.forEach((oneEdge) => {
					writeList.push((a2, n2) => {
						relationshipWriter(
							{
								authoredMapping: {
									fromStableId: oneEdge.fromRef.id,
									toStableId: oneEdge.toRef.id,
									relationshipType: oneEdge.type,
									properties: oneEdge.properties,
								},
								applyLabel: pairing.pairLabel,
							},
							(err, writeResult) => {
								if (err) {
									n2(`${moduleName}: writing ${oneEdge.type} ${oneEdge.fromRef.id} -> ${oneEdge.toRef.id} [${pairing.pairLabel}]: ${err}`);
									return;
								}
								if (writeResult && writeResult.edgeWritten) {
									pairing.edgesWritten++;
								}
								n2('', a2);
							},
						);
					});
				});
			});
			pipeRunner(writeList.getList(), {}, (err) => next(err || '', args));
		});

		pipeRunner(taskList.getList(), {}, (runError, args) => {
			// close the reader whether or not the run succeeded (the writer is closed by bridgeMaker).
			reader.close((closeError) => {
				if (runError) {
					callback(closeError ? `${runError} (and the graph reader also failed to close: ${closeError})` : runError);
					return;
				}
				if (closeError) {
					callback(`${moduleName}: authored the family edges but the graph reader failed to close: ${closeError}`);
					return;
				}
				const aggregateReport = args.aggregateReport || {};
				let totalEdges = 0;
				let totalWritten = 0;
				// blocks[] — ONE pair-scoped block entry per pairing, in S11 order. This is the multi-block emit:
				// build.js Phase C harvests EACH applyLabel into its own version-keyed `_struct` block.
				const blocks = pairings.map((pairing) => {
					const edgeCount = pairing.sortedEdges.length;
					totalEdges += edgeCount;
					totalWritten += pairing.edgesWritten;
					return {
						applyLabel: pairing.pairLabel,
						firstStandard: pairing.firstToken,
						secondStandard: pairing.secondToken,
						producer: PRODUCER_KIND, // build.js version-keys with the _struct suffix
						decisionBlock: null, // deterministic identity join — nothing to freeze
						emptyPairing: edgeCount === 0,
						pairing: `${pairing.firstKey}::${pairing.secondKey}`,
						edgesWritten: pairing.edgesWritten,
						counts: {
							edges: edgeCount,
							structural: pairing.edgesWritten,
							dedupedAtEmission: pairing.dedupedAtEmission,
							byType: pairing.byType,
						},
					};
				});
				callback('', {
					edgesWritten: totalWritten,
					decisionBlock: null,
					producer: PRODUCER_KIND,
					blocks,
					counts: {
						edges: totalEdges,
						structural: totalWritten,
						pairings: blocks.length,
						...aggregateReport,
					},
				});
			});
		});
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction;
module.exports.LOCATOR_EDGE = LOCATOR_EDGE;
