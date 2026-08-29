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

	S2: Object.freeze({
		allowanceId: 'S2',
		rowRefId: 'S2',
		declarableBy: Object.freeze(['sif']),
		kind: ALLOWANCE_KIND.FORGE_TIME,
		evaluatedAt: EVALUATED_AT.CONTRACT_GRAPH,
		// ⚠ CORRECTED 2026-08-29, hub-kit-role Phase 3 (RULING FJ-P3-2). THIS ROW NAMED THE WRONG
		// PROPERTY and was therefore unusable by the only forge allowed to declare it. It read
		// mustEqual ['name'] and cited forgeSif.js:350 — the `name: name == null ? '' : ...` line.
		// SIF's actual empty-string coercion is on THE NEXT LINE, :351, `description: description || ''`.
		// MEASURED over all 27,069 nodes of the SIF block before the correction: ZERO nodes carry
		// name '' and 16,181 carry description '', across all eight non-root labels (SifXmlElement
		// 5,872 · SifField 4,733 · SifCodesetValue 4,064 · SifComplexType 897 · SifObject 159 ·
		// SifSimpleType 301 · SifCodeset 140 · SifPrimitiveType 15). Because mustEqual is an EQUALITY
		// check, S2 could not name 'description', and contractGraphKit.js:221-226 refuses that byte
		// unless an active allowance names it — so SIF could not reproduce its own bytes at all.
		// NOT ['name', 'description']: naming a coercion measured never to fire is the same
		// declared-but-unneeded defect this registry exists to refuse.
		whileDeclared: "kit.makeNode stamps description: '' when the description is absent/empty (forgeSif.js:351)",
		allowanceDataContract: Object.freeze({
			coerceEmptyStringPropertyList: Object.freeze({ kind: 'stringList', mustEqual: ['description'] }),
		}),
		preconditionText: 'at least one node received the empty-string coercion on this build',
		preconditionMet: ({ kitStats }) => kitStats.emptyStringCoercionCount > 0,
		retiredBy: 'RT-2 repair (absent is absent) → new SIF id (S2)',
	}),

	S3: Object.freeze({
		allowanceId: 'S3',
		rowRefId: 'S3',
		declarableBy: Object.freeze(['sif']),
		kind: ALLOWANCE_KIND.FORGE_TIME,
		evaluatedAt: EVALUATED_AT.DESCRIBE_SOURCE,
		whileDeclared:
			"root version may differ from (selfDescribedVersion ?? 'unknown') — SIF root '1.0' while the stamp input is null (forgeSif.js:762-765)",
		allowanceDataContract: Object.freeze({}),
		preconditionText: "describeSource returns version !== (selfDescribedVersion ?? 'unknown')",
		preconditionMet: ({ describedSource }) =>
			describedSource.version !==
			(describedSource.selfDescribedVersion === null || describedSource.selfDescribedVersion === undefined
				? 'unknown'
				: describedSource.selfDescribedVersion),
		retiredBy: "SIF's parser reports a real source version (or the root carries 'unknown') → new id (S3)",
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
});

module.exports = {
	MIGRATION_ALLOWANCE_REGISTRY,
	MIGRATING_BUNDLE_LIST,
	PERMISSIVE_STABLE_ID_PATTERN,
	ALLOWANCE_KIND,
	EVALUATED_AT,
	moduleName,
};
