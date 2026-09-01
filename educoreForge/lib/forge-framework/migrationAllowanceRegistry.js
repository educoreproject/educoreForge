'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// migrationAllowanceRegistry.js — MIGRATION_ALLOWANCE_REGISTRY, MIGRATING_BUNDLE_LIST and
// PERMISSIVE_STABLE_ID_PATTERN (SPEC-forgeFramework-v1.md §7; Profile §13).
//
// A compatibility declaration / migration allowance is ONE thing under two names: a row of this
// CLOSED registry, keyed by a Profile §13.1 punch-list id, declared by a MIGRATING forge so the
// framework reproduces that forge's pre-migration bytes at ONE named framework-owned step. Rules
// (SPEC §7.1):
//   - forge-time rows carry a precondition the framework EVALUATES on the build it is running;
//     declared-but-unneeded → refused ("allowance <id> active but its condition is not met");
//     undeclared-but-needed → refused at the step in question (the strict behaviour runs).
//   - offline-precondition rows carry `probeEvidence` in the declaration and the framework checks
//     only its PRESENCE. (None of the F3a rows is offline; the shape is declared so the validator
//     walks one table.)
//   - a non-empty declaration list on a name outside MIGRATING_BUNDLE_LIST → refused.
//   - every active allowance is reported in complianceReport.activeAllowanceList (census.js).
//
// F3a SHIPS ONLY THE ROWS F3b/F3c NEED (STANDDOWN-F2-panel ruling 1; BRIEF-F3a): the sourceUrl
// row keyed three ways (E6 / S4 / P16 — one behaviour, per-forge ids so each forge retires its
// own in its own commit, SPEC §14 D12), E8 (ruled 06:33 after the F3a review), S2, S3, S6 (proposed), S7. PESC and CEDS rows (P1–P10,
// C1/C2/C9/C10) are added as DATA in their own migration commits — no unused policy machinery
// ships ahead of its forge.
//
// The registry is DATA. Each row's `preconditionMet` is a small pure predicate over the ONE
// context object the framework hands it at the row's `evaluatedAt` step; that keeps "which step
// evaluates which allowance" in the table instead of in an if-chain inside the pipeline.
// `evaluatedAt`: 'describeSource' (forge() step 4, context { describedSource }) or
// 'contractGraph' (buildContractGraph integrity pass, context { kitStats }).
// `rootEmptyPermittedPropertyList` (optional row data): root properties the row lets be EMPTY
// ('' or []) while active — the sourceUrl row and S7 — read by rootNode.js's required-set check.

const MIGRATING_BUNDLE_LIST = Object.freeze(['ceds', 'edfi', 'sif', 'pesc260805']);

// P10's constant (SPEC §4.1, §7.2): PESC declares it under allowance P10 in F3d. Data only.
const PERMISSIVE_STABLE_ID_PATTERN = Object.freeze({ pattern: '^\\S+$', trimmed: true });

const ALLOWANCE_KIND = Object.freeze({ FORGE_TIME: 'forgeTime', OFFLINE: 'offlinePrecondition' });
const EVALUATED_AT = Object.freeze({ DESCRIBE_SOURCE: 'describeSource', CONTRACT_GRAPH: 'contractGraph' });

// the empty-string-coercion row — ONE behaviour, keyed TWICE (SPEC §7.1, §14 D12). EXTRACTED
// 2026-08-29 (hub-kit-role Phase 4) for the same reason the version-disagreement row was, and found
// the same way: the undeclared-but-needed sweep groups BY rowRefId, so PESC declaring its own P9
// left SIF's S2 still swept, its precondition still met by PESC's 27,139 coerced descriptions, and
// the build REFUSED naming a SIF row PESC may not declare.
//
// THE GENERAL RULE, WORTH STATING ONCE: an allowance ID is per-forge so each forge retires its own
// in its own commit (D12); a rowRefId is per-BEHAVIOUR because that is what the sweep reasons about.
// Three behaviours are now shared across forges — sourceUrlEmptyString, versionDisagreement and
// emptyStringCoercion — and the first was authored that way from the start while the other two were
// authored per-forge and only became wrong when a second forge needed them.
const emptyStringCoercionRow = ({ allowanceId, declarableBy, whileDeclared, retiredBy }) =>
	Object.freeze({
		allowanceId,
		rowRefId: 'emptyStringCoercion',
		declarableBy: Object.freeze([declarableBy]),
		kind: ALLOWANCE_KIND.FORGE_TIME,
		evaluatedAt: EVALUATED_AT.CONTRACT_GRAPH,
		whileDeclared,
		allowanceDataContract: Object.freeze({
			coerceEmptyStringPropertyList: Object.freeze({ kind: 'stringList', mustEqual: ['description'] }),
		}),
		preconditionText: 'at least one node received the empty-string coercion on this build',
		preconditionMet: ({ kitStats }) => kitStats.emptyStringCoercionCount > 0,
		retiredBy,
	});

// the version-disagreement row — ONE behaviour, keyed TWICE (SPEC §7.1, §14 D12), the same
// pattern as the sourceUrl row below. EXTRACTED 2026-08-29 (hub-kit-role Phase 4) when PESC needed
// it: S3 was authored as a SIF-only row with rowRefId 'S3', and evaluateAllowancesAtStep groups the
// undeclared-but-needed sweep BY rowRefId — so a PESC row with its own rowRefId left S3 still swept,
// its precondition still met by PESC's version disagreement, and the build REFUSED naming a SIF row
// PESC is not allowed to declare. Caught by the in-process forge in two seconds, before any
// re-forge was spent. Both rows now share rowRefId 'versionDisagreement'; the ALLOWANCE IDS stay
// per-forge so each retires its own in its own commit, which is exactly what D12 asks for.
// ⟪versionFromStamp, tqii 2026-08-31⟫ THE versionDisagreementRow FACTORY IS RETIRED WITH ITS TWO ROWS.
// It built S3 (sif) and P17 (pesc260805) — ONE behaviour keyed twice, sharing rowRefId
// 'versionDisagreement' — and both are gone: neither forge declares a version any more, so there is
// no declared-versus-self-described divergence left to permit. THE ROWS WERE NOT RETIRED BY THE ROUTE
// THEIR OWN retiredBy PROSE NAMED (SIF's parser reporting a real version, or the root carrying
// 'unknown'); the DECLARATIONS DISAPPEARED ENTIRELY, so there was nothing left to permit. Recorded so
// a reader checking retiredBy does not conclude the retirement was premature.
//
// WHAT REPLACES IT, and it is stricter: forge-framework's refuseVersionDisagreement, a FATAL guard on
// a DECLARED version differing from the RESOLVED stamp. The rows permitted that divergence; the guard
// forbids it. The guard was built only AFTER these rows were deleted, so it is uncoupled by
// construction — nothing can suppress it and it depends on no row.
//
// ⚠ THE HAZARD THIS FACTORY LEAVES BEHIND, for whoever adds the next shared-behaviour row:
// evaluateAllowancesAtStep's undeclared-but-needed sweep walks the WHOLE registry and skips by
// rowRefId — NOT by allowanceId and NOT by declarableBy. So two rows sharing a rowRefId are ONE
// behaviour for the sweep, and retiring one while its twin lives lets the survivor refuse a forge that
// is not allowed to declare it. That bit this project twice: once in 2026-08-29 (a PESC build refused
// naming a SIF row) and once in the design of this very order (SIF would have been refused naming
// PESC's P17).

// the sourceUrl row — ONE behaviour, keyed three ways (SPEC §7.1, §14 D12)
const sourceUrlEmptyStringRow = ({ allowanceId, declarableBy, retiredBy }) =>
	Object.freeze({
		allowanceId,
		rowRefId: 'sourceUrlEmptyString',
		declarableBy: Object.freeze([declarableBy]),
		kind: ALLOWANCE_KIND.FORGE_TIME,
		evaluatedAt: EVALUATED_AT.DESCRIBE_SOURCE,
		whileDeclared: "the root carries sourceUrl '' when describeSource returns '' (Profile §10.4 says OMIT)",
		allowanceDataContract: Object.freeze({}),
		rootEmptyPermittedPropertyList: Object.freeze(['sourceUrl']),
		preconditionText: "describeSource returns sourceUrl === ''",
		preconditionMet: ({ describedSource }) => describedSource.sourceUrl === '',
		retiredBy,
	});

const MIGRATION_ALLOWANCE_REGISTRY = Object.freeze({
	E6: sourceUrlEmptyStringRow({
		allowanceId: 'E6',
		declarableBy: 'edfi',
		retiredBy: 'omit sourceUrl (Profile §10.4) → new Ed-Fi id, its own commit',
	}),
	S4: sourceUrlEmptyStringRow({
		allowanceId: 'S4',
		declarableBy: 'sif',
		retiredBy: 'omit sourceUrl (Profile §10.4) → new SIF id, its own commit',
	}),
	P16: sourceUrlEmptyStringRow({
		allowanceId: 'P16',
		declarableBy: 'pesc260805',
		retiredBy: 'omit sourceUrl (Profile §10.4) → new PESC id, its own commit',
	}),

	// E8 (SABLE_RIVER ruling 2026-08-16 06:33, TIGHTENED 03:40 F3b, Profile v1.0.2 §13.1): Ed-Fi's root
	// sourceFiles are LOGICAL input names (forgeEdfi.js:183-185 — five names over three loaders, measured by
	// the F3b probes), not verified files. While declared, step 4's FA5 cross-check admits an entry that is
	// EITHER a verified file OR one of the names the declaration lists in `logicalSourceFileNameList`;
	// anything else is refused by name even under E8, and a declared logical name that sourceFiles does not
	// use is refused as stale data. `permitsUnverifiedSourceFileNames` is the row DATA the framework reads
	// — no per-id branch. Retirement = sourceFiles becomes the verified list (a byte change).
	E8: Object.freeze({
		allowanceId: 'E8',
		rowRefId: 'E8',
		declarableBy: Object.freeze(['edfi']),
		kind: ALLOWANCE_KIND.FORGE_TIME,
		evaluatedAt: EVALUATED_AT.DESCRIBE_SOURCE,
		whileDeclared: 'root sourceFiles may name the DECLARED logical input names (logicalSourceFileNameList) beside verified files (forgeEdfi.js:183-185); reproduced while declared',
		allowanceDataContract: Object.freeze({
			logicalSourceFileNameList: Object.freeze({ kind: 'stringList' }),
		}),
		permitsUnverifiedSourceFileNames: true,
		preconditionText: 'describeSource returns at least one sourceFiles entry that is not a verified file',
		preconditionMet: ({ describedSource, verifiedFileList }) =>
			Array.isArray(describedSource.sourceFiles) && describedSource.sourceFiles.some((oneName) => verifiedFileList.indexOf(oneName) === -1),
		retiredBy: 'sourceFiles becomes the verified file list — a deliberate byte change in its own commit (E8)',
	}),

	S2: emptyStringCoercionRow({
		allowanceId: 'S2',
		declarableBy: 'sif',
		// ⚠ CORRECTED 2026-08-29 Phase 3 (FJ-P3-2): this row named the WRONG PROPERTY. It read
		// mustEqual ['name'] and cited forgeSif.js:350, while SIF's coercion is on the NEXT line,
		// :351, description. 0 SIF nodes carry name ''; 16,181 carry description ''.
		whileDeclared: "kit.makeNode stamps description: '' when the description is absent/empty (forgeSif.js:351)",
		retiredBy: 'RT-2 repair (absent is absent) → new SIF id (S2; 16,181 nodes carry the byte)',
	}),

	S7: Object.freeze({
		allowanceId: 'S7',
		rowRefId: 'S7',
		declarableBy: Object.freeze(['sif']),
		kind: ALLOWANCE_KIND.FORGE_TIME,
		evaluatedAt: EVALUATED_AT.DESCRIBE_SOURCE,
		whileDeclared: 'root sourceFiles: [] reproduced (sif/lib/parser.js:942-955 returns none; forgeSif.js:394 stamps [])',
		allowanceDataContract: Object.freeze({}),
		rootEmptyPermittedPropertyList: Object.freeze(['sourceFiles']),
		preconditionText: 'describeSource returns sourceFiles.length === 0',
		preconditionMet: ({ describedSource }) =>
			Array.isArray(describedSource.sourceFiles) && describedSource.sourceFiles.length === 0,
		retiredBy: 'the SIF loader reports its files → new id (S7)',
	}),

	S6: Object.freeze({
		allowanceId: 'S6',
		rowRefId: 'S6',
		declarableBy: Object.freeze(['sif']),
		kind: ALLOWANCE_KIND.FORGE_TIME,
		evaluatedAt: EVALUATED_AT.CONTRACT_GRAPH,
		whileDeclared:
			'kit.addEdge applies the declared parentEdgeSubstitutionTable to an edge type outside EDGE_TYPES (forgeSif.js:652 canonical || REFERENCES); the census counts each substitution',
		allowanceDataContract: Object.freeze({
			parentEdgeSubstitutionTable: Object.freeze({ kind: 'stringToEdgeTypeObject' }),
		}),
		preconditionText: 'substitutionCount > 0 on this build (census #1 forbids the declaration at zero)',
		preconditionMet: ({ kitStats }) => kitStats.substitutionCount > 0,
		retiredBy: 'refuse the unknown type → byte-neutral, its own commit (S6)',
	}),

	// ---- PESC260805 ROWS — CREATED 2026-08-29, hub-kit-role Phase 4 (rulings FJ-P4-2, FJ-P4-5) ----
	//
	// THREE ROWS WERE CREATED HERE WHERE F3a SHIPPED ONE (P16). Two of the three were already NAMED
	// IN REFUSAL PROSE by framework code that could never have worked: contractGraphKit.js:223 has
	// pointed readers at "P9" and rootNode.js:124 at "P5: pescTier" since F3a, while NEITHER ROW
	// EXISTED. A refusal that names a non-existent remedy was docketed in Phase 3 as a defect; Phase
	// 4 is the phase that walked into it, because PESC is the forge those texts were written for.
	// The docket's standing observation — a closed registry's rows are UNTESTED until a forge
	// declares them, which is how S2 was wrong for eleven days with every gate green — has now
	// landed THREE times in one phase.

	// P9 — the empty-string coercion. THE ROW THE REFUSAL TEXT ALREADY NAMED; creating it makes
	// contractGraphKit.js:223 true rather than aspirational.
	// MEASURED on the Phase 4 entry block (f139654a, 42,372 node lines) BEFORE the row was written,
	// checking the property the forge COERCES rather than the property any prose names — the FJ-P3-2
	// discipline that S2 was corrected under:
	//     27,139 nodes carry description ''      <- this row's byte
	//          0 nodes carry name ''             <- so 'name' is NOT declared; a coercion measured
	//                                               never to fire is what this registry refuses
	//          0 nodes lack a description property  <- so "omit instead" was never available
	// NOT ['name','description'] for the same reason S2 was not widened.
	P9: emptyStringCoercionRow({
		allowanceId: 'P9',
		declarableBy: 'pesc260805',
		whileDeclared:
			"kit.makeNode stamps description: '' when the artifact's documentation is absent or empty (the bespoke forgePesc260805.js:148 description: documentation || '')",
		retiredBy:
			'RT-2 repair (absent is absent) → new PESC id (P9; 27,139 of 42,372 nodes carry the byte)',
	}),

	// P5 — pescTier on the root. THE SECOND PHANTOM MADE REAL (rootNode.js:124 names it).
	//
	// ⚠ THIS ROW LICENSES ONLY THE ROOT EXTRA PROPERTY. It does NOT license the four root
	// omissions rootNode.js's header says "P5 (PESC, not an F3a row) will license omitting exactly
	// FOUR via rootOmitPropertyList". RULING FJ-P4-5 OVERRULED THAT DESIGN: the PESC root is made
	// CONFORMANT with the other three standards instead — it GAINS snapshotKey, publishedVersion,
	// versionSource and coreVersion rather than omitting them — because the campaign's thesis is
	// that the framework owns the root, and four rows whose only purpose was to keep one root
	// non-conformant would have preserved a byte at the cost of the point. That is the whole reason
	// I4 is re-keyed rather than held. The stale sentence in rootNode.js's header is corrected in
	// this same commit.
	//
	// ⚠ AND THIS IS THE REGISTRY'S FIRST OFFLINE ROW. The shape has existed since F3a and has NEVER
	// BEEN EXERCISED — "the shape is declared so the validator walks one table". It is used here
	// because it is the honest fit rather than for novelty: the framework evaluates preconditions at
	// exactly TWO steps, describeSource (context { describedSource, verifiedFileList }) and
	// contractGraph (context { kitStats }), and NEITHER can see whether describeRoot returned a
	// pescTier — the root is built between them. A forge-time row here would need a predicate over a
	// context that cannot observe the thing the row is about, which is a proxy, and a proxy
	// precondition is the same family of lie as a proxy report. So: no evaluatedAt, no
	// preconditionMet (evaluateAllowancesAtStep skips on the evaluatedAt mismatch, both in the
	// declared-but-unneeded loop and in the undeclared-but-needed sweep), and the declaration must
	// carry probeEvidence, whose PRESENCE forgeDeclarationContract.js:178 checks by name.
	// The undeclared-but-needed direction is not lost: rootNode.js:118-127 already refuses an
	// extraProperty no active allowance names, which is where that refusal belongs.
	P5: Object.freeze({
		allowanceId: 'P5',
		rowRefId: 'P5',
		declarableBy: Object.freeze(['pesc260805']),
		kind: ALLOWANCE_KIND.OFFLINE,
		evaluatedAt: null,
		whileDeclared:
			"the root carries the bundle-local pescTier 'meta' (the bespoke forgePesc260805.js:213), a per-standard tier marker no other standard has",
		// ⚠ THIS IS DECLARATION DATA, NOT ROW DATA, and the distinction cost a refusal to find.
		// rootNode.js:91-93 reduces rootExtraPropertyNameList off activeAllowanceById, which
		// forge-framework.js:113-116 keys to the DECLARATION ENTRY rather than to the registry row —
		// the same place P9 carries coerceEmptyStringPropertyList and P4 its edgeTypeAllowList. A row
		// that carried the list itself validated fine and then did nothing, and the build refused
		// with "no active allowance names it" while the row plainly named it.
		allowanceDataContract: Object.freeze({
			rootExtraPropertyNameList: Object.freeze({ kind: 'stringList', mustEqual: ['pescTier'] }),
		}),
		preconditionText:
			'OFFLINE: the root carries pescTier, evidenced by the declaration probe rather than by a forge-time predicate — the framework has no evaluation step that can observe a root extra property',
		retiredBy:
			"pescTier moves to a declared descriptor field, or is dropped when the source/derived/synthetic tier marker stops being bundle-local → new PESC id",
	}),

	// P17 — the version disagreement. S3's behaviour, keyed for PESC (RULING FJ-P4-5, after the
	// count was measured rather than inherited: the ruling said "P16 + P9 + P5 = 3 unless you
	// measure otherwise", and this is the otherwise).
	//
	// WHY PESC IS THE SIF CASE AND NOT THE CEDS CASE, measured on the three roots:
	//     CEDS  version 14.0.0.0  publishedVersion 14.0.0.0  versionSource spec      no S3-analogue
	//     SIF   version 1.0       publishedVersion unknown   versionSource unknown   S3
	//     PESC  version aggregate-01  publishedVersion aggregate-01  versionSource provenance-file  <- this row
	// snapshot-provenance.js:11 defines versionSource 'spec' as "the parser read the version from a
	// SELF-DESCRIBING source; the SOURCE WINS". PESC's `aggregate-01` is OURS (R-ACQ-7) and the
	// snapshot's own README_PROVENANCE.md says in capitals that it "must never be read as a PESC
	// edition", because PESC publishes no coherent whole-family release. The snapshot's
	// standardSourceLocation supplied no publishedVersion EITHER, AT THE TIME THIS ROW WAS WRITTEN.
	// ⚠ CORRECTED (RULING FJ-P4-7, later the same day, and the correction is the point of the row):
	// the snapshot NOW CARRIES a standardSourceLocation declaring publishedVersion aggregate-01 —
	// PESC was the only one of the four without one — so the stamp resolves to
	// publishedVersion 'aggregate-01' / versionSource 'provenance-file', which is the TRUTHFUL label:
	// the aggregate version is ours, recorded in our own provenance record. THE ROW IS STILL NEEDED
	// AND STILL MET: describeSource returns selfDescribedVersion null, so the root's version
	// 'aggregate-01' still differs from (selfDescribedVersion ?? 'unknown') = 'unknown'. What changed
	// is the publishedVersion/versionSource pair, not this row's predicate.
	// ⚠ THE OTHER BRANCH WAS AVAILABLE AND WAS REFUSED: passing 'aggregate-01' as the self-described
	// version stamps versionSource 'spec' — measured, deriveVersionStamp returns exactly that — and
	// would assert in a BLOCK BYTE that PESC's source declares a whole-family version it does not
	// publish. That is a label that lies, which is what SPEC §4.9 refused when it chose the honest
	// re-key over the cheap pin.

	// P4 — the edge-type allow list. THE THIRD PHANTOM MADE REAL (RULING FJ-P4-6): contractGraphKit.js
	// has pointed readers at "an active P4 edgeTypeAllowList" since F3a while no P4 row existed, and
	// PESC is the only forge that could ever have declared it.
	//
	// MEASURED on the Phase 4 entry block, all 70,628 edge lines, before the row was written:
	//     DECLARES        12,991   IMPORTS            76   IN_NAMESPACE       64
	//     MERGED_FROM        140   RESOLVES_TO    17,706   SAME_DEFINITION 10,400   SERVED_BY  1
	//   = 41,378 edges, 58.6% of PESC's edge population, on SEVEN types outside EDGE_TYPES.
	//   The other three (HAS_PROPERTY 17,575 · HAS_RESTRICTION 10,886 · HAS_SUPPORT 789) are members.
	//
	// WHY NOT S6. S6's parentEdgeSubstitutionTable TRANSLATES a native type INTO a registry member,
	// and the kit refuses a substitution target that is not one (contractGraphKit.js:305). PESC's
	// seven are not synonyms for registry types — DECLARES, RESOLVES_TO, SAME_DEFINITION and
	// IN_NAMESPACE are distinct relations the PESC graph model is built on (design §1-§4).
	// Substituting them would COLLAPSE 41,378 edges onto one type and change the block. They need
	// ADMITTING, not translating, which is what edgeTypeAllowList does and why the refusal names P4.
	//
	// mustEqual PINS THE SEVEN EXACTLY, in a fixed order: an eighth un-registered type emitted later
	// is refused by name rather than quietly admitted. That is the S2 discipline — a list that can
	// silently grow is not a gate.
	P4: Object.freeze({
		allowanceId: 'P4',
		rowRefId: 'P4',
		declarableBy: Object.freeze(['pesc260805']),
		kind: ALLOWANCE_KIND.FORGE_TIME,
		evaluatedAt: EVALUATED_AT.CONTRACT_GRAPH,
		whileDeclared:
			'kit.addEdge ADMITS an edge type outside EDGE_TYPES when the declared edgeTypeAllowList names it (the bespoke forgePesc260805.js and its derived/synthetic tiers emit seven such relations); the census counts each admission',
		allowanceDataContract: Object.freeze({
			edgeTypeAllowList: Object.freeze({
				kind: 'stringList',
				mustEqual: ['DECLARES', 'IMPORTS', 'IN_NAMESPACE', 'MERGED_FROM', 'RESOLVES_TO', 'SAME_DEFINITION', 'SERVED_BY'],
			}),
		}),
		preconditionText: 'allowListedEdgeCount > 0 on this build (an allow list that never admits an edge is a stale no-op)',
		preconditionMet: ({ kitStats }) => kitStats.allowListedEdgeCount > 0,
		retiredBy:
			"the seven PESC relations are promoted into EDGE_TYPES — a SHARED-VOCABULARY decision, not a forge decision, because lib/vocabulary serves every producer → new PESC id (P4)",
	}),
});

module.exports = {
	MIGRATION_ALLOWANCE_REGISTRY,
	MIGRATING_BUNDLE_LIST,
	PERMISSIVE_STABLE_ID_PATTERN,
	ALLOWANCE_KIND,
	EVALUATED_AT,
	moduleName,
};
