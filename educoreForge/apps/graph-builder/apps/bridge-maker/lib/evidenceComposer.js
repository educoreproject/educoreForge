'use strict';

// evidenceComposer.js — bridge-maker/lib NEW (bridgeEvidenceRefactor-spec.md §3/§5, ⟪A1⟫, ⟪A5⟫; P2
// deliverable). THE GRAPH-CAPABLE EVIDENCE COMPOSER SCAFFOLD: a generic implementation of the
// MATCH/COMPOSE contract (evidenceContracts.js §2) that owns RECALL as a UNION of retrieval signals
// (⟪A1⟫: cosine top-K PLUS whatever a standard's own `nominate` hook contributes, each nomination
// carrying its rationale) and MAY walk the graph for additional evidence, scoped to exactly the
// standards the recipe declared it depends on (⟪A5⟫ — no new machinery: the EXISTING recipe
// `dependencies` field, see apps/graph-builder/lib/recipe.js and lib/build.js:680-688).
//
// PLACEMENT — deliberately NOT lib.d/. lib.d/ is a STRICT, closed membership set (lib/kitLoader.js's
// EXPECTED_KIT_MODULES, verified by fs.readdirSync against that exact list): dropping a tenth file in
// there makes kitLoader.buildKit() refuse the REAL lib.d/ directory as "carrying a file not in the
// declared kit" — breaking test-kit-loader.js's GREEN section, an EXISTING file's behavior, for a
// capability that isn't wired into the kit's runtime path yet. Wiring this composer into kitLoader
// (alongside the real CEDS hub module, the renderer, and generic `select` — the pieces it is meant to
// compose WITH) is explicit P3 scope (spec §7: "P3 ... generic match base composer"). P2's charter is
// the SCAFFOLD, proven hermetically on its own; this file sits next to kitLoader.js/decisionFreezer.js
// /evidenceContracts.js in bridge-maker/lib exactly as those do, requireable directly by its own test
// suite today and by kitLoader's construction call in P3 tomorrow. Nothing existing requires this file;
// nothing existing is touched by its presence.
//
//   evidenceComposer({ semanticMatcher, nominate, walk, dependencies }) -> matchComposeCallable
//
//     semanticMatcher   REQUIRED — the kit's cosine module (lib.d/semanticMatcher.js): { retrieve(source,
//                       candidatePool) -> [{candidate,cosine}] (already topK-sliced, sorted desc),
//                       cosine(a,b) -> number }. The composer's BASE retrieval signal (⟪A1⟫); there is
//                       no default — a composer with no retrieval signal is a defect, not a
//                       reasonable empty-pool answer.
//     nominate          optional injectable hook, DEFAULT none (no extra nominations). Callback-shaped
//                       per the ⟪TQ RULING, 2026-07-29⟫ (evidenceContracts.js header):
//                         nominate({ sourceElement, candidateElements },
//                                  callback(errString, [{ candidate, nominatedBy, rationale }, ...]))
//                       ⟪A1⟫'s union-pool seam — a standard's OWN signal (e.g. CASE's "any candidate
//                       whose tuple shares my owning-class term") plugs in here; the composer knows
//                       nothing about WHY a candidate was nominated, only that it was, and by whom.
//     walk              optional injectable hook, DEFAULT none (no graph walking performed at all).
//                       Callback-shaped:
//                         walk({ sourceElement, pool, graphReader, dependencies },
//                              callback(errString, { perCandidateNotes: { <candidateKey>: [note,...] },
//                                                     promptSegments: [seg, ...] }))
//                       `graphReader` handed to the hook is ALREADY SCOPED (see scopeGraphReader below)
//                       — ⟪A5⟫'s enforcement lives HERE, not in the hook's own discipline: a read
//                       outside the declared dependency graph is refused BY VALUE before it reaches
//                       the real reader, so a careless or malicious walk hook cannot reach further
//                       than the recipe declared it needed.
//     dependencies      optional array of recipe standard tokens (the EXISTING `dependencies` field —
//                       apps/graph-builder/lib/recipe.js:109, lib/build.js:680-688 — no new schema).
//                       Default [] — a composer constructed with no declared dependencies gets a walk
//                       hook whose graphReader refuses EVERY `_source`-scoped read (⟪A5⟫: no unbounded
//                       reach is the default, not an opt-out).
//
//   -> ({ sourceElement, candidateElements, graphReader, hubModule }, callback(errString, evidencePackage))
//      exactly the MATCH_COMPOSE_SHAPE callable (evidenceContracts.js §2: arity 2, named-argument
//      object naming all four keys, trailing callback). SELF-GATES: the assembled evidencePackage is
//      run through evidencePackageViolation (⟪A3⟫) BEFORE calling back — a malformed package (a
//      hub-tuple omission, a smuggled per-candidate segment in promptSegments, a bare nomination with
//      no rationale) is refused HERE, at the source, never merely downstream at the match->select seam.
//
// OBLIGATIONS honored (MATCH_COMPOSE_OBLIGATIONS, evidenceContracts.js):
//   freezeWhatYouGather — the returned evidencePackage carries EVERY hub tuple + walked note/segment
//     this run gathered; nothing is fetched lazily or resolved on demand at render/freeze time later.
//   graphWalkScopeIsDeclaredDependencyGraph — enforced structurally by scopeGraphReader, not by
//     convention or by trusting the walk hook to behave.
//
// House style: qtools moduleFunction; callback(errString, result) with '' on success;
// qtools-asynchronous-pipe-plus (taskListPlus/pipeRunner) for sequencing, no async/await, no
// try/catch for control flow; refuse-by-value (polyArch2 §6) — every malformed/missing input is
// refused BY NAME before anything runs; camelCase, compound names.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const { evidencePackageViolation } = require('./evidenceContracts');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// candidateKeyFor — the identity a candidate is deduped/looked-up by across cosine top-K,
// nominations, and walked per-candidate notes. First present of: stableId (a graph node's own
// identity, always present on a walked element), canonicalKey, cedsId, valueKey, name. A candidate
// with NONE of these has no identity at all — callers are expected to hand walked/full elements,
// which always carry at least stableId (sourceWalker's flat shapes all do).
const candidateKeyFor = (candidate) =>
	(candidate &&
		(candidate.stableId || candidate.canonicalKey || candidate.cedsId || candidate.valueKey || candidate.name)) ||
	null;

// scopeGraphReader — ⟪A5⟫'s enforcement point. Wraps a real graphReader so any readNodes() call that
// names a `_source` in its propertyEquals is refused BY VALUE unless that source (case-insensitively;
// THE CASE RULE, sourceWalker.js — recipe tokens are lowercase, forged _source is uppercase) is a
// member of the declared `dependencies`. A read with NO `_source` key in propertyEquals is not a
// standard-scoped read in the sense ⟪A5⟫ governs (⟪A5⟫ is specifically about reaching a STANDARD the
// recipe did not declare a dependency on) and passes through untouched — refusing it here would be
// scope creep of a different kind, forbidding reads this mechanism was never meant to police.
const scopeGraphReader = (graphReader, dependencies) => {
	const allowed = (dependencies || []).map((oneDependency) => `${oneDependency}`.toUpperCase());
	return {
		readNodes: ({ label, propertyEquals = {} } = {}, callback) => {
			const requestedSource = propertyEquals._source;
			if (requestedSource !== undefined && requestedSource !== null) {
				const requestedKey = `${requestedSource}`.toUpperCase();
				if (!allowed.includes(requestedKey)) {
					callback(
						`${moduleName}: walk scope violation — '${requestedKey}' is not in the declared ` +
							`dependency graph (${allowed.join(', ') || '(none declared)'}). A composer may only ` +
							`walk the standards its recipe named in \`dependencies\` (⟪A5⟫); refusing before any read.`,
					);
					return;
				}
			}
			graphReader.readNodes({ label, propertyEquals }, callback);
		},
		close: (callback) => graphReader.close(callback),
	};
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ semanticMatcher, nominate = null, walk = null, dependencies = [] } = {}) => {
		if (!semanticMatcher || typeof semanticMatcher.retrieve !== 'function' || typeof semanticMatcher.cosine !== 'function') {
			throw new Error(
				`${moduleName}: constructed without a semanticMatcher (retrieve/cosine) — the composer's ` +
					`base retrieval signal (⟪A1⟫); there is no default retrieval signal to fall back to.`,
			);
		}

		// compose — the produced MatchComposeModule callable (evidenceContracts.js MATCH_COMPOSE_SHAPE).
		// NOTE: the first parameter carries NO default value on purpose — a default parameter makes
		// Function.prototype.length stop counting at that argument (arity would read as 0, not 2),
		// which is exactly the false-positive matchComposeCallableViolation's arity check exists to
		// catch. `spec || {}` below gets the same missing-argument safety without that trap.
		const compose = (spec, callback) => {
			const { sourceElement, candidateElements, graphReader, hubModule } = spec || {};
			if (!sourceElement || typeof sourceElement !== 'object') {
				callback(
					`${moduleName}: sourceElement is missing or not an object — the composer needs the FULL ` +
						`source element (spec §5); there is no default.`,
				);
				return;
			}
			if (!Array.isArray(candidateElements)) {
				callback(
					`${moduleName}: candidateElements is not an array (got ${typeof candidateElements}) — ` +
						`there is no default candidate pool.`,
				);
				return;
			}
			if (!graphReader || typeof graphReader.readNodes !== 'function') {
				callback(
					`${moduleName}: graphReader is missing (readNodes) — a graph-CAPABLE composer needs the ` +
						`read seam even on a run that never walks; there is no default.`,
				);
				return;
			}
			if (typeof hubModule !== 'function') {
				callback(
					`${moduleName}: hubModule is missing — every pool candidate needs the hub's base tuple ` +
						`evidence (R5); there is no default.`,
				);
				return;
			}

			// 1. BASE RETRIEVAL — cosine top-K (⟪A1⟫'s first union member).
			const cosineTopK = semanticMatcher.retrieve(sourceElement, candidateElements);

			const poolByKey = new Map();
			cosineTopK.forEach(({ candidate, cosine }) => {
				poolByKey.set(candidateKeyFor(candidate), { candidate, cosine, notes: [] });
			});

			// applyNominations — ⟪A1⟫'s DEDUPE rule: a nomination whose candidate is ALREADY in the pool
			// (from cosine top-K) keeps its cosine and GAINS the nomination; a nomination for a candidate
			// NOT already present enters the pool fresh, its cosine computed fresh (semanticMatcher.cosine
			// handles a missing vector as -1, the documented degenerate case — never a thrown error).
			const applyNominations = (nominations) => {
				(nominations || []).forEach((oneNomination) => {
					const key = candidateKeyFor(oneNomination && oneNomination.candidate);
					const nomination = {
						nominatedBy: oneNomination && oneNomination.nominatedBy,
						rationale: oneNomination && oneNomination.rationale,
					};
					const existing = poolByKey.get(key);
					if (existing) {
						existing.nomination = nomination;
						return;
					}
					const cosine = semanticMatcher.cosine(
						sourceElement.vector,
						oneNomination && oneNomination.candidate && oneNomination.candidate.vector,
					);
					poolByKey.set(key, { candidate: oneNomination && oneNomination.candidate, cosine, notes: [], nomination });
				});
			};

			// 2. NOMINATIONS SEAM — ⟪A1⟫'s second union member, optional.
			const withNominations = (done) => {
				if (!nominate) {
					done('');
					return;
				}
				nominate({ sourceElement, candidateElements }, (nominateErr, nominations) => {
					if (nominateErr) {
						done(`${moduleName}: nominate() failed: ${nominateErr}`);
						return;
					}
					applyNominations(nominations);
					done('');
				});
			};

			withNominations((nominateErr) => {
				if (nominateErr) {
					callback(nominateErr);
					return;
				}

				// 3. BASE EVIDENCE — hubModule per pool candidate (R7 callback-shaped; sequenced via
				// pipeRunner, never assumed synchronous even though every foreseeable P2/P3 implementation
				// resolves on the same tick).
				const poolEntries = Array.from(poolByKey.values());
				const hubTaskList = new taskListPlus();
				poolEntries.forEach((oneEntry) => {
					hubTaskList.push((args, next) => {
						hubModule(oneEntry.candidate, (hubErr, baseTupleEvidence) => {
							if (hubErr) {
								next(
									`${moduleName}: hubModule failed for candidate '${candidateKeyFor(oneEntry.candidate)}': ${hubErr}`,
								);
								return;
							}
							oneEntry.tuple = baseTupleEvidence;
							next('', args);
						});
					});
				});

				pipeRunner(hubTaskList.getList(), {}, (hubPipeErr) => {
					if (hubPipeErr) {
						callback(hubPipeErr);
						return;
					}

					// assemble — pool entries + any walked findings -> the EvidencePackage, self-gated.
					const assemble = (walkResult) => {
						const perCandidateNotes = (walkResult && walkResult.perCandidateNotes) || {};
						const globalSegments = (walkResult && walkResult.promptSegments) || [];

						const pool = poolEntries.map((oneEntry) => {
							const key = candidateKeyFor(oneEntry.candidate);
							const walkedNotes = perCandidateNotes[key] || [];
							const packaged = {
								candidate: oneEntry.candidate,
								cosine: oneEntry.cosine,
								considerations: { tuple: oneEntry.tuple, notes: [...oneEntry.notes, ...walkedNotes] },
							};
							if (oneEntry.nomination) {
								packaged.nomination = oneEntry.nomination;
							}
							return packaged;
						});

						const evidencePackage = {
							pool,
							// deduped, per ⟪A2⟫ — a walk hook is not trusted to have deduped its own segments.
							promptSegments: Array.from(new Set(globalSegments)),
						};

						// ⟪A3⟫ SELF-GATE — the composer proves its OWN output before it ever reaches a caller.
						const violation = evidencePackageViolation(evidencePackage);
						if (violation) {
							callback(
								`${moduleName}: composed evidence package failed its own shape gate: ${violation}`,
							);
							return;
						}
						callback('', evidencePackage);
					};

					// 4. GRAPH WALKING ⟪A5⟫ — optional, scoped.
					if (!walk) {
						assemble(null);
						return;
					}
					const scopedReader = scopeGraphReader(graphReader, dependencies);
					walk(
						{
							sourceElement,
							pool: poolEntries.map((oneEntry) => oneEntry.candidate),
							graphReader: scopedReader,
							dependencies,
						},
						(walkErr, walkResult) => {
							if (walkErr) {
								callback(`${moduleName}: walk() failed: ${walkErr}`);
								return;
							}
							assemble(walkResult);
						},
					);
				});
			});
		};

		return compose;
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.candidateKeyFor = candidateKeyFor;
module.exports.scopeGraphReader = scopeGraphReader;
