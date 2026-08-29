// test-bridgeAcceptancePesc.js — the PESC bridge plugins' acceptance gates.
// LUNAR_PRISM (P1), supervisor SABLE_RIVER. BRIEF-P1-pescPlugin.md; PLAN-pescDerivedBridge-v1.md;
// RULINGS P1-R2 (two plugins, one seam), P1-R5, P1-R6, P1-R8, P1-R9.
//
// WHAT THIS PHASE HAS TO PROVE, and it is a sharper claim than B4's. B3 proved matchBasis `crosswalk`,
// B4 proved `standard`, D1-D4 proved `derived` — three MATCH BASES through one unchanged seam. PESC
// adds a fourth and fifth plugin and, with the option-set sibling, proves THE SEAM IS NOT TIED TO ONE
// SUBJECT SHAPE EITHER: two different subject LABELS, PescElementDecl and PescNamedDefinition, with
// ZERO framework change.
//
// SECTION 1 — BG-PLUGIN-PESC. Both REAL declarations under the REAL validator, both discovered by the
// REAL registry built by discovery over forges/. Five twins drive DISTINCT refusals through that same
// validator, because an ACCEPTED from a validator nobody has seen refuse is not evidence.
//
// SECTION 2 — BG-COMPOSE-PESC. The framework diff from this phase's baseline is EMPTY, MODIFIED AND
// UNTRACKED, and the IDENTICAL command over a range where the framework really did move is NON-EMPTY.
// A diff gate that reports EMPTY is indistinguishable from one whose path list is misspelled, whose
// command failed, or whose parser never sees a line — all of those report EMPTY too, greenly, forever.
// The twin turns the silence into a measurement.
//
// SECTION 3 — BG-SEAT-PESC, AND IT EXISTS BECAUSE OF A FRAMEWORK DEFECT I FOUND AND MAY NOT FIX.
// ⚠️ graphSeamRules.js `allowListRefusal` is written, correctly reasoned in its own comment, exported,
// and NEVER CALLED — three references in the whole repository, all inside its own file, and every
// consumer requires the module whole so a call could only appear as that literal string. Its sibling
// `allowListedRecordFor` is dead the same way. The only live path, `allowListedPropertiesFor`, SILENTLY
// OMITS a name no node carries. CONSEQUENCE: a renderingAllowList naming a property that does not exist
// renders NOTHING, forever, with every gate green — which is exactly what would have happened to this
// order's MANDATORY evidence seat had it been declared before the forge stamped it.
// THIS SECTION CLOSES THAT HAZARD FOR THESE TWO PLUGINS. IT DOES NOT FIX THE FRAMEWORK AND MUST NEVER
// BE DESCRIBED AS THOUGH IT DOES. The defect is recorded on the docket under RULING P1-R9.
//
// Run: node apps/graph-builder/test/test-bridgeAcceptancePesc.js   (</dev/null in the fleet)

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the PESC bridge plugins' acceptance gates (BG-PLUGIN-PESC, BG-COMPOSE-PESC, BG-SEAT-PESC)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     SECTION 1 BG-PLUGIN-PESC: both REAL declarations through the REAL contract validator and the REAL
     plugin registry, with five twins driving DISTINCT refusals through the same validator.
     SECTION 2 BG-COMPOSE-PESC: the framework diff from this phase's baseline is EMPTY (modified AND
     untracked), with the identical command over a moved range asserted NON-EMPTY.
     SECTION 3 BG-SEAT-PESC: every declared SUBJECT allow-list name is populated on at least one node
     the forge actually emits, and the rendering seat is stamped where it should be and nowhere else.
     Section 3 runs the REAL forge IN MEMORY (skipEmbedding) -- no Docker, no embedder, no store, no spend.

     Every assertion count in this file is a LITERAL. A declared assertion that does not run is emitted
     as an UNMEASURED FAILURE rather than silently shrinking the green.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harnessRaw = require('../../../test/testLib/harness')(moduleName);

// EXPECTED_ASSERTION_COUNT is a LITERAL frozen at this call site, never computed from a list the suite
// also derives — a guard that shrinks in lockstep with the thing it guards is no guard.
// 14 (SECTION 1 BG-PLUGIN-PESC: 9 conjuncts + 5 twins)
// + 6 (SECTION 2 BG-COMPOSE-PESC: 2 conjuncts + 4 twins)
// + 6 (SECTION 3 BG-SEAT-PESC: 5 conjuncts + 1 twin)
// = 26.
const EXPECTED_ASSERTION_COUNT = 26;
const ledger = { count: 0 };
const harness = {
	section: harnessRaw.section,
	note: harnessRaw.note,
	ok: (label, condition, detail) => {
		ledger.count += 1;
		harnessRaw.ok(label, condition, detail);
	},
	equal: (label, actual, expected) => {
		ledger.count += 1;
		harnessRaw.equal(label, actual, expected);
	},
	report: () => {
		const missing = EXPECTED_ASSERTION_COUNT - ledger.count;
		if (missing > 0) {
			harnessRaw.note(`${missing} of ${EXPECTED_ASSERTION_COUNT} declared assertions did not run — each is UNMEASURED and fails by name (RULING BR3-6)`);
		}
		for (let oneIndex = 0; oneIndex < missing; oneIndex += 1) {
			harnessRaw.ok(
				`UNMEASURED — declared assertion ${ledger.count + oneIndex + 1} of ${EXPECTED_ASSERTION_COUNT} did not run (an artifact or a precondition was absent; see the notes above)`,
				false,
				'a conjunct that cannot run is a failure by name, never a smaller green',
			);
		}
		if (missing < 0) {
			harnessRaw.ok(`the ledger ran ${ledger.count} assertions but EXPECTED_ASSERTION_COUNT declares ${EXPECTED_ASSERTION_COUNT} — update the declaration with the suite`, false);
		}
		harnessRaw.report();
	},
};

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const treeRoot = path.join(__dirname, '..', '..', '..');
const bundleDirPath = path.join(treeRoot, 'forges', 'pesc260805');
const acceptanceDir = path.join(treeRoot, 'lib', 'bridge-framework', 'test', 'acceptance');

const bridgePluginContractLib = require(path.join(treeRoot, 'lib', 'bridge-framework', 'bridgePluginContract'));
const pluginRegistryLib = require(path.join(treeRoot, 'lib', 'bridge-framework', 'pluginRegistry'));

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const expectedCompose = readJson(path.join(acceptanceDir, 'expectedCompose.json'));

// THE TWO PLUGINS, AS DATA. Each row carries the subject LABEL it declares AND the predicate that
// narrows that label to the population the plugin ACTUALLY JUDGES.
//
// ⚠️ THE subjectFilter IS NOT DECORATION AND I LEARNED THAT FROM MY OWN TWIN GOING RED. This section
// first checked allow-list names against EVERY node carrying the label. That is too weak, and the twin
// caught it on the first run: `typeAsWritten` IS populated on PescNamedDefinition — on its DmeClass and
// DmeSupport nodes — and is NOT populated on a single one of the DmeOptionSet nodes the option-set
// plugin actually judges. So a name could be populated somewhere under the label, pass the check, and
// render NOTHING for every real subject.
//
// THAT IS THE SAME SHAPE AS THE DEAD FRAMEWORK GUARD THIS SECTION EXISTS TO REPLACE: a check that
// answers a question adjacent to the one that matters. A gate must be scoped to the population its
// plugin sees, not to the label its plugin names.
const PLUGIN_REGISTRY_ROW_LIST = [
	{
		bridgeName: 'pescCedsDerivedPlugin',
		subjectLabel: 'PescElementDecl',
		subjectFilterDescription: "pescTier 'source' — the judged population is the concept representatives drawn from exactly these",
		subjectFilter: (oneNode) => oneNode.properties.pescTier === 'source',
	},
	{
		bridgeName: 'pescOptionSetCedsDerivedPlugin',
		subjectLabel: 'PescNamedDefinition',
		subjectFilterDescription: "pescTier 'source' AND role 'DmeOptionSet' AND reachableFromLatestRoot — the label ALSO carries DmeClass and DmeSupport nodes this plugin never judges",
		subjectFilter: (oneNode) => oneNode.properties.pescTier === 'source' && oneNode.properties.role === 'DmeOptionSet' && oneNode.properties.reachableFromLatestRoot === true,
	},
];

// ---------------------------------------------------------------------
// SECTION 1 — BG-PLUGIN-PESC
// ---------------------------------------------------------------------
const refusalTextFor = (candidateDeclaration) => {
	const verdict = bridgePluginContractLib.validateBridgeDeclaration({ bridgeDeclaration: candidateDeclaration, bundleDirPath });
	return verdict && verdict.error ? verdict.error.message || String(verdict.error) : '';
};

const runPluginSection = () => {
	harness.section('SECTION 1 — BG-PLUGIN-PESC: both REAL declarations validate, both are DISCOVERED by the REAL registry, and five twins drive distinct refusals through the same validator');

	const digestByBridgeName = {};
	PLUGIN_REGISTRY_ROW_LIST.forEach((oneRow) => {
		const pluginModule = require(path.join(bundleDirPath, 'bridges', oneRow.bridgeName));
		const shipped = pluginModule.bridgeDeclaration;
		harness.equal(`BG-PLUGIN-PESC a ${oneRow.bridgeName} — the SHIPPED declaration validates against the REAL contract`, refusalTextFor(shipped), '');

		const hookProblem = bridgePluginContractLib.validateBridgeHooks({ bridgeHooks: pluginModule.bridgeHooks, bridgeDeclaration: shipped });
		harness.ok(
			`BG-PLUGIN-PESC a ${oneRow.bridgeName} — the EMPTY hook object validates (a derived basis FORBIDS both mandatory hooks, so a declaration is the whole file)`,
			!hookProblem || !(hookProblem.error || hookProblem.message),
			hookProblem && (hookProblem.error || hookProblem.message) ? String(hookProblem.error || hookProblem.message) : 'accepted',
		);
		harness.equal(`BG-PLUGIN-PESC a ${oneRow.bridgeName} — standardKey EQUALS the bundle directory (BR-009, pluginRegistry.js:48)`, shipped.standardKey, 'pesc260805');
		digestByBridgeName[oneRow.bridgeName] = crypto.createHash('sha256').update(bridgePluginContractLib.canonicalJsonText(shipped)).digest('hex');
	});

	// The two are DIFFERENT RUNS OVER DIFFERENT POPULATIONS. A scheme that gave them one id would be
	// HIDING that, which is the same reasoning edfiCedsDerivedPlugin records for its own two scopes.
	harness.ok(
		'BG-PLUGIN-PESC b the two sibling declarations have DISTINCT digests — one id for two populations would hide the difference rather than simplify it',
		digestByBridgeName[PLUGIN_REGISTRY_ROW_LIST[0].bridgeName] !== digestByBridgeName[PLUGIN_REGISTRY_ROW_LIST[1].bridgeName],
		`${digestByBridgeName[PLUGIN_REGISTRY_ROW_LIST[0].bridgeName].slice(0, 16)}… vs ${digestByBridgeName[PLUGIN_REGISTRY_ROW_LIST[1].bridgeName].slice(0, 16)}…`,
	);

	// DISCOVERY is a SEPARATE failure from validation: a declaration can be perfect and the file never
	// found, keyed wrong, or bound to the wrong bundle. Nothing else in this suite tests that.
	const built = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: path.join(treeRoot, 'forges') });
	const registry = built && built.registry ? built.registry : built;
	PLUGIN_REGISTRY_ROW_LIST.forEach((oneRow) => {
		const found = pluginRegistryLib.lookupPlugin({ registry, bridgeName: oneRow.bridgeName, standardKey: 'pesc260805' });
		const entry = found && found.entry ? found.entry : found;
		harness.ok(
			`BG-PLUGIN-PESC c ${oneRow.bridgeName} is FOUND by the registry built by discovery over forges/ and bound to bundle pesc260805`,
			Boolean(entry) && !(found && found.error) && entry.standardKey === 'pesc260805',
			found && found.error ? String(found.error.message || found.error) : `standardKey='${entry && entry.standardKey}'`,
		);
	});

	harness.section('    BG-PLUGIN-PESC twins — five DISTINCT refusals through the SAME validator, observed RED');
	const shippedPropertyTier = require(path.join(bundleDirPath, 'bridges', PLUGIN_REGISTRY_ROW_LIST[0].bridgeName)).bridgeDeclaration;
	const twinList = [
		{
			label: 'RED-OBSERVED an UNKNOWN TOP-LEVEL KEY is refused by name — which is WHY the dedup rule and the understatement record live on disk as data rather than inside the declaration',
			mutate: (oneDeclaration) => ({ ...oneDeclaration, dedupRule: { concepts: 2213 } }),
			expectText: "unknown key 'dedupRule'",
		},
		{
			label: 'RED-OBSERVED a PER-TIER candidateRetrieval key is refused by name — the seam the VALUE TIER would need DOES NOT EXIST, and this is that fact as a running assertion rather than a source reading',
			mutate: (oneDeclaration) => ({ ...oneDeclaration, candidateRetrieval: { ...oneDeclaration.candidateRetrieval, referenceTier: 'value' } }),
			expectText: "unknown key 'referenceTier'",
		},
		{
			label: 'RED-OBSERVED an IDENTIFIER in the subject allow-list is refused by name (the bias audit; TQ named cedsId by name)',
			mutate: (oneDeclaration) => ({ ...oneDeclaration, renderingAllowList: { ...oneDeclaration.renderingAllowList, subject: oneDeclaration.renderingAllowList.subject.concat(['stableId']) } }),
			expectText: 'RENDERING_NEVER_NAME_LIST',
		},
		{
			label: 'RED-OBSERVED a VALUE-DOMAIN predicate is refused by name — SKOS_PREDICATES is a CLOSED five-value set with no term for it, which is why the option-set sibling ships relatedMatch as a RECORDED UNDERSTATEMENT rather than a mislabelled exactMatch',
			mutate: (oneDeclaration) => ({ ...oneDeclaration, predicateByCategory: { ...oneDeclaration.predicateByCategory, strong: 'valueDomainOf' } }),
			expectText: 'SKOS_PREDICATES',
		},
	];
	twinList.forEach((oneTwin) => {
		const refusalText = refusalTextFor(oneTwin.mutate({ ...shippedPropertyTier }));
		harness.ok(oneTwin.label, refusalText !== '' && refusalText.indexOf(oneTwin.expectText) !== -1, refusalText === '' ? 'DID NOT REFUSE — the validator is not reachable on this axis' : refusalText.slice(0, 200));
	});

	const unknownLookup = pluginRegistryLib.lookupPlugin({ registry, bridgeName: 'pescPluginThatDoesNotExist', standardKey: 'pesc260805' });
	const unknownRefusalText = unknownLookup && unknownLookup.error ? String(unknownLookup.error.message || unknownLookup.error) : '';
	harness.ok(
		'RED-OBSERVED an UNKNOWN BRIDGE NAME is refused BY NAME at the registry, listing the registered alternatives — note that `graphBuilder -validate` does NOT catch this (recipe.js:403 resolvability checks FORGE availability, not bridge names), so THIS is the layer that enforces it',
		unknownRefusalText.indexOf('pescPluginThatDoesNotExist') !== -1 && unknownRefusalText.indexOf('REFUSED') !== -1,
		unknownRefusalText === '' ? 'DID NOT REFUSE — plugin existence would be enforced nowhere' : unknownRefusalText.slice(0, 200),
	);
};

// ---------------------------------------------------------------------
// SECTION 2 — BG-COMPOSE-PESC
// ---------------------------------------------------------------------
const gitNumstatOver = (revisionText) => {
	const argList = ['-C', treeRoot, 'diff', '--numstat', revisionText, '--'].concat(expectedCompose.diffedPathList);
	const ran = spawnSync('git', argList, { encoding: 'utf8' });
	return { status: ran.status, text: (ran.stdout || '').trim(), stderr: (ran.stderr || '').trim(), commandText: `git ${argList.join(' ')}` };
};
// git diff NEVER reports an untracked file, so a brand-new file dropped into lib/bridge-framework/
// would leave the numstat gate green forever. Enumerating them separately closes that hole.
const gitUntrackedUnderFrameworkPaths = () => {
	const argList = ['-C', treeRoot, 'ls-files', '--others', '--exclude-standard', '--'].concat(expectedCompose.diffedPathList);
	const ran = spawnSync('git', argList, { encoding: 'utf8' });
	return { status: ran.status, text: (ran.stdout || '').trim(), stderr: (ran.stderr || '').trim(), commandText: `git ${argList.join(' ')}` };
};
const composeVerdictOf = ({ status, text, stderr }, untracked) => {
	if (status !== 0) {
		return { empty: false, reason: `the diff command itself failed (exit ${status}): ${stderr}` };
	}
	if (untracked !== undefined && untracked.status !== 0) {
		return { empty: false, reason: `the untracked-file scan itself failed (exit ${untracked.status}): ${untracked.stderr}` };
	}
	const changedLineList = text.split('\n').filter((oneLine) => oneLine.length > 0);
	const untrackedLineList = untracked === undefined ? [] : untracked.text.split('\n').filter((oneLine) => oneLine.length > 0);
	const reasonList = changedLineList.map((oneLine) => `modified ${oneLine}`).concat(untrackedLineList.map((oneLine) => `UNTRACKED NEW FILE ${oneLine}`));
	return { empty: reasonList.length === 0, reason: reasonList.length ? `${reasonList.length} framework path(s) changed: ${reasonList.join(' | ')}` : '' };
};

// THE BASELINE, and it is INHERITED FROM A RECORDED RULE RATHER THAN INVENTED. B4's own baseline note
// states the principle: "the claim B4 has to prove is that SIF adds nothing to the framework IT IS
// ADDED TO, so the baseline is the framework as it stood when B4 branched." The same holds here.
// MEASURED before choosing it: b77c9df (the SIF CLEAR commit) .. 5360b8e is NOT empty — it carries
// test-bgNosub.js and test-bgP7.js, which are the supervisor's own ruled merge edits at B4 and have
// nothing to do with PESC. So P1's baseline is 5360b8e, the framework as it stood when P1 branched.
//
// ⟪RE-ANCHORED 2026-08-28 UNDER RULING FJ-P0-1⟫ — the BG-SEAM-UNTOUCHED re-anchor (3e9cd1f) lives
// inside this gate's diffedPathList, so the two gates collided — D1 precedent.
//
// THE COLLISION, STATED PLAINLY SO IT IS NOT REDISCOVERED. This gate's diffedPathList covers
// `lib/bridge-framework/` and excludes `lib/bridge-framework/test/acceptance/` — but NOT
// `lib/bridge-framework/test/`. BG-SEAM-UNTOUCHED's own suite, test-bgNosub.js, lives at
// `lib/bridge-framework/test/test-bgNosub.js`, i.e. INSIDE the paths this gate diffs. So the
// ordered re-anchor of THAT gate (BRIEF-SEAM-reanchorBgSeamUntouched.md, RULING P1-R11, commit
// 3e9cd1f) could not be performed WITHOUT turning THIS conjunct red. Neither gate is wrong; they
// overlap.
//
// MEASURED BEFORE THE MOVE WAS PROPOSED, with this gate's OWN command over its OWN declared paths,
// which is what separates "the re-anchor caused it" from "it was already red":
//     5360b8ec..66c5c60  (hub kit role Phase 0 entry)   EMPTY — green
//     5360b8ec..75d5470  (Phase 0 Commit A)             EMPTY — green
//     5360b8ec..working tree, with 3e9cd1f              50 3 lib/bridge-framework/test/test-bgNosub.js — RED
//
// THE ALTERNATIVE WAS REJECTED, AND BY WHOM. Adding `lib/bridge-framework/test/` to diffedPathList
// would have silenced the collision in one line — and WIDENED AN EXCLUSION, blinding this gate to
// every future bridge-framework test change, permanently. The baseline moves; THE EXCLUSION LIST IS
// NOT TOUCHED. That is the difference between "this change was authorised" and "this file stopped
// being protected". Ruled by FROZEN_JOURNEY (FJ-P0-1); the implementer proposed both remedies and
// applied neither until ruled, because narrowing or widening a gate is not the implementer's call.
//
// WHAT THE BASELINE MEANT BEFORE, PRESERVED HERE BECAUSE THE MOVE DOES NOT REPUDIATE IT: 5360b8ec
// was "the framework as it stood when P1 branched", chosen by B4's recorded rule and measured (see
// the note above). That claim was TRUE and this gate proved it through the whole PESC order. The
// new baseline makes the same KIND of claim against a later frame: nothing under the declared paths
// has moved since the hub kit role Phase 0 anchor.
//
// ⚠ THE COMMIT FIRST RULED WAS OFF BY ONE, AND THE CORRECTION IS RECORDED HERE RATHER THAN TIDIED
// AWAY, because the mistake is instructive and a successor re-deriving this baseline can make it
// again. FJ-P0-1 as first issued named 75d5470. Measured with this gate's own command over its own
// declared paths, BEFORE anything was committed:
//     75d5470..HEAD   50 3 lib/bridge-framework/test/test-bgNosub.js   — gate stays RED, 25/26
//     3e9cd1f..HEAD   (empty)                                          — gate GREEN, 26/26
// THE COLLISION-CAUSING EDIT *IS* COMMIT 3e9cd1f, AND 75d5470 IS ITS PARENT — so a baseline at
// 75d5470 sits BEFORE the change it was moved to absorb, and absorbs nothing. It was referred back
// with both measurements rather than silently substituted (which commit anchors a gate is not the
// implementer's call) and rather than applied as ruled and reported red (which would be carrying
// out an instruction known in advance to be self-defeating). FJ-P0-1 was then CORRECTED to 3e9cd1f.
//
// NEW BASELINE, in full: 3e9cd1fe385511d28c922f0da723e81d9ae78c17 — "Re-anchor BG-SEAM-UNTOUCHED to
// postPescReembed-082926", the commit whose edit caused the collision and which this baseline must
// therefore INCLUDE. It carries annotated tag **postBgSeamReanchor-082926**; the constant stays the
// full hash so it cannot drift if a tag is ever moved, and the tag is named here for legibility.
//
// ⚠ THE TWO GATES LEGITIMATELY ANCHOR AT DIFFERENT COMMITS, ONE APART, AND THIS IS THE TRAP TO
// AVOID RE-INTRODUCING:
//     BG-SEAM-UNTOUCHED   -> postPescReembed-082926     at 75d5470  (Phase 0 Commit A)
//     BG-COMPOSE-PESC (a) -> postBgSeamReanchor-082926  at 3e9cd1f  (Phase 0 Commit B)
// BG-SEAM's base must be where its own ruled fixture edit lives; THIS gate's base must be one
// commit later, because BG-SEAM's re-anchor edit is itself inside the paths this gate diffs. There
// is NO single "Phase 0 anchor" that serves both, and anyone who assumes one will put this gate
// back to 25/26.
//
// OLD BASELINE, in full, so the move is legible without the log:
// 5360b8ec219a1e40b0b8398de31315cb9a770d6b.
// ── PHASE 1 RE-ANCHOR, RULING FJ-P1-2 ────────────────────────────────────────────────────────────
// THE TRAP THE BLOCK ABOVE WARNS ABOUT WAS SPRUNG, EXACTLY AS WRITTEN, ONE PHASE LATER — and it is
// recorded here rather than tidied away because the warning was already in this file and did not
// prevent it.
//
// MECHANISM, identical in shape to FJ-P0-1. Phase 1 Commit B (b260ba8, "Re-anchor seamDiffEmpty to
// postCedsForgeMigration-082926") edited lib/bridge-framework/test/test-bgNosub.js by 38/2. That
// path is INSIDE this gate's diffedPathList, which excludes lib/bridge-framework/test/acceptance/
// but NOT lib/bridge-framework/test/. Measured at b260ba8 against the old base:
//     1 framework path(s) changed: modified 38  2  educoreForge/lib/bridge-framework/test/test-bgNosub.js
// so this gate read 25/26 exit 1.
//
// THE GENERAL RULE, now a corollary of the FJ-P1-1 standing rule and inherited by Phases 3 and 4:
// EVERY seamDiffEmpty RE-ANCHOR MUST BE FOLLOWED BY A BG-COMPOSE-PESC (a) RE-ANCHOR. seamDiffEmpty
// lives inside the paths this gate diffs, so moving one always moves the other. TWO COMMITS PER
// FORGE MIGRATION, and the second is not optional.
//
// NEW BASELINE, in full: b260ba8a3ce876d4034ddd885dd51a47472a4de6 — the commit whose edit caused
// the collision and which this baseline must therefore INCLUDE, NOT its parent 2615522. Annotated
// tag **postSeamDiffEmptyReanchorP1-082926**; the constant stays the full hash so it cannot drift
// if a tag is ever moved.
//
// THE THREE ANCHOR POINTS NOW IN PLAY — each gate anchors where its own ruled edits live:
//     seamDiffEmpty        -> postCedsForgeMigration-082926      at 2615522  (Phase 1 Commit A)
//     (iii)                -> postPescReembed-082926             at 75d5470  (Phase 0 Commit A)
//     BG-COMPOSE-PESC (a)  -> postSeamDiffEmptyReanchorP1-082926 at b260ba8  (Phase 1 Commit B)
//
// THE EXCLUSION LIST IS UNTOUCHED. Adding lib/bridge-framework/test/ to it would silence this
// collision in one line and blind the gate to every future bridge-framework test change,
// permanently. The baseline moves; the exclusion list does not. Refused in Phase 0 and refused again.
//
// PREVIOUS BASELINE, in full: 3e9cd1fe385511d28c922f0da723e81d9ae78c17 (FJ-P0-1, as corrected).
// ── SECOND PHASE 1 RE-ANCHOR, RULING FJ-P1-3 ─────────────────────────────────────────────────────
// The pairing above held again, deliberately this time rather than by discovery. Commit E
// (ceff79c, "Re-anchor seamDiffEmpty to postCedsForgeS3-082926") edited
// lib/bridge-framework/test/test-bgNosub.js by 36/3 — inside this gate's diffedPathList — so this
// baseline moves with it. RULED TOGETHER WITH the seamDiffEmpty move rather than after it failed.
//
// WHY THERE WAS A SECOND PAIR AT ALL, recorded because the sequencing is the transferable lesson:
// Commit D (37473dc) applied the independent review's S3 finding AFTER Commit A had already been
// tagged, and D's edit landed inside SEAM_PATH_LIST — a git pathspec's `*` crosses `/`, so
// forges/*/forge*.js matches forges/ceds/lib/forgeCedsContractGraph.js, which neither the ruling
// nor the review expected. PLAN rule for Phases 3 and 4: HOLD THE ANCHOR TAG UNTIL THE REVIEW'S
// CODE FINDINGS ARE IN, and this pair is paid once instead of twice.
//
// NEW BASELINE, in full: ceff79cc973133174cf5f9e0cebc2d5ff3080ce5 — Commit E, whose edit caused this
// collision and which this baseline must therefore INCLUDE, NOT its parent 37473dc. Annotated tag
// **postSeamDiffEmptyReanchorP1b-082926**.
//
// THE FOUR ANCHOR POINTS NOW IN PLAY — each gate anchors where its own ruled edits live:
//     seamDiffEmpty        -> postCedsForgeS3-082926              at 37473dc  (Phase 1 Commit D)
//     (iii)                -> postPescReembed-082926              at 75d5470  (Phase 0 Commit A)
//     BG-COMPOSE-PESC (a)  -> postSeamDiffEmptyReanchorP1b-082926 at ceff79c  (Phase 1 Commit E)
//     (i), (ii)            -> their own, unchanged
//
// THE EXCLUSION LIST IS UNTOUCHED, for the third time. Adding lib/bridge-framework/test/ would
// silence the pairing in one line and blind this gate to every future bridge-framework test change,
// permanently. The baseline moves; the exclusion list does not.
//
// PREVIOUS BASELINE, in full: b260ba8a3ce876d4034ddd885dd51a47472a4de6 (FJ-P1-2).
const P1_BASELINE_COMMIT = 'ceff79cc973133174cf5f9e0cebc2d5ff3080ce5';
// the twin range: where the DERIVED order really did move lib/bridge-framework. The same range B4 used.
const MOVED_RANGE = `${expectedCompose.edfiPluginAcceptedCommitRecorded}..${expectedCompose.b4BaselineCommit}`;

const runComposeSection = () => {
	harness.section("SECTION 2 — BG-COMPOSE-PESC: the framework diff from this phase's BASE to the working tree is EMPTY; the SAME command over a range where the framework DID move is NON-EMPTY");

	const real = gitNumstatOver(P1_BASELINE_COMMIT);
	const realUntracked = gitUntrackedUnderFrameworkPaths();
	const realVerdict = composeVerdictOf(real, realUntracked);
	harness.ok(
		`BG-COMPOSE-PESC a the framework diff from ${P1_BASELINE_COMMIT.slice(0, 7)} to the working tree over ${expectedCompose.diffedPathList.length} declared paths is EMPTY, MODIFIED AND UNTRACKED — PESC adds a FOURTH and FIFTH plugin, and a SECOND SUBJECT LABEL, through the SAME seam with ZERO framework change`,
		realVerdict.empty === true,
		`${realVerdict.reason}\n${real.commandText}\n${realUntracked.commandText}`,
	);

	// SCOPE MATCHED TO THE ESTABLISHED GATE RATHER THAN INVENTED. test-bgNosub.js's own token ban walks
	// lib/bridge-framework/** with a recursion that EXCLUDES any directory named 'test' (test-bgNosub.js:88).
	// The framework's SUITES necessarily name plugins — test-bgReg.js has named a plugin since B2 precisely
	// to prove the registry refuses an unregistered name — so this conjunct is over the PRODUCTION tree, on
	// the same footing. Writing a scope from first principles is how a predecessor caught test-bgReg.js by
	// accident; inheriting the established one avoids repeating that.
	const frameworkProductionFileList = (() => {
		const walk = (dirPath) =>
			fs.readdirSync(dirPath, { withFileTypes: true }).reduce((soFar, oneEntry) => {
				if (oneEntry.isFile() && /\.js$/.test(oneEntry.name)) {
					return soFar.concat([path.join(dirPath, oneEntry.name)]);
				}
				return oneEntry.isDirectory() && oneEntry.name !== 'test' && oneEntry.name !== 'node_modules' ? soFar.concat(walk(path.join(dirPath, oneEntry.name))) : soFar;
			}, []);
		return walk(path.join(treeRoot, 'lib', 'bridge-framework'));
	})();
	const namingFileList = frameworkProductionFileList.filter((oneFilePath) => {
		const fileText = fs.readFileSync(oneFilePath, 'utf8');
		return PLUGIN_REGISTRY_ROW_LIST.some((oneRow) => fileText.indexOf(oneRow.bridgeName) !== -1);
	});
	harness.equal(
		`BG-COMPOSE-PESC c no framework PRODUCTION file names EITHER plugin (${frameworkProductionFileList.length} files scanned, test/ excluded as test-bgNosub.js scopes it) — a per-standard reference inside lib/bridge-framework would be a branch by another name`,
		namingFileList.map((onePath) => path.relative(treeRoot, onePath)).join(', '),
		'',
	);

	harness.section('    BG-COMPOSE-PESC twins — the SAME command over real bytes where the framework DID move, plus the three ways a diff gate lies while looking green');
	const moved = gitNumstatOver(MOVED_RANGE);
	const movedVerdict = composeVerdictOf(moved, { status: 0, text: '', stderr: '' });
	harness.ok(
		`RED-OBSERVED BG-COMPOSE-PESC a — the SAME command over ${MOVED_RANGE} (where the DERIVED order really did move the framework) is NON-EMPTY, so the EMPTY above is a MEASUREMENT and not a silence`,
		movedVerdict.empty === false && moved.status === 0,
		`${movedVerdict.reason.slice(0, 300)}\n${moved.commandText}`,
	);
	harness.ok(
		'RED-OBSERVED BG-COMPOSE-PESC a — a numstat line naming ONE modified framework file turns the verdict red',
		composeVerdictOf({ status: 0, text: '1\t0\tlib/bridge-framework/classification.js', stderr: '' }, { status: 0, text: '', stderr: '' }).empty === false,
	);
	harness.ok(
		'RED-OBSERVED BG-COMPOSE-PESC a — an UNTRACKED new file under a framework path turns the verdict red even though git diff reports nothing (the hole this scan exists to close)',
		composeVerdictOf({ status: 0, text: '', stderr: '' }, { status: 0, text: 'lib/bridge-framework/pescSpecialCase.js', stderr: '' }).empty === false,
	);
	harness.ok(
		'RED-OBSERVED BG-COMPOSE-PESC a — a FAILED diff command is RED, never silently EMPTY (an unreadable gate is not a passing gate)',
		composeVerdictOf({ status: 128, text: '', stderr: 'fatal: bad revision' }, { status: 0, text: '', stderr: '' }).empty === false,
	);
};

// ---------------------------------------------------------------------
// SECTION 3 — BG-SEAT-PESC (hermetic: the REAL forge in memory, no Docker)
// ---------------------------------------------------------------------
const SEAT_NAME_LIST = ['effectiveDescription', 'owningTypeName', 'proseSource'];
const COMPOSED_LABEL_LIST = ['PescElementDecl', 'PescAttributeDecl'];
const labelHas = (oneNode, oneLabel) => Array.isArray(oneNode.labels) && oneNode.labels.indexOf(oneLabel) !== -1;

const runSeatSection = (forged, done) => {
	harness.section('SECTION 3 — BG-SEAT-PESC: every declared SUBJECT allow-list name is POPULATED on a node the forge actually emits, and the rendering seat is stamped where it belongs and nowhere else');
	harness.note('this section exists because graphSeamRules.allowListRefusal — the framework\'s OWN guard against an allow-listed name that describes nothing — is DEAD CODE (never called). It closes the hazard FOR THESE PLUGINS. It does NOT fix the framework.');

	const nodeListByLabel = {};
	forged.nodes.forEach((oneNode) => {
		(oneNode.labels || []).forEach((oneLabel) => {
			if (nodeListByLabel[oneLabel] === undefined) {
				nodeListByLabel[oneLabel] = [];
			}
			nodeListByLabel[oneLabel].push(oneNode);
		});
	});

	// SCOPED to the population the plugin actually judges — see the subjectFilter note on the registry.
	const subjectNodeListFor = (oneRow) => (nodeListByLabel[oneRow.subjectLabel] || []).filter(oneRow.subjectFilter);
	const namePopulatedOnSome = (oneName, subjectNodeList) =>
		subjectNodeList.some((oneNode) => {
			const oneValue = oneNode.properties[oneName];
			return oneValue !== undefined && oneValue !== null && oneValue !== '';
		});

	PLUGIN_REGISTRY_ROW_LIST.forEach((oneRow) => {
		const shipped = require(path.join(bundleDirPath, 'bridges', oneRow.bridgeName)).bridgeDeclaration;
		const subjectNodeList = subjectNodeListFor(oneRow);
		const unpopulatedNameList = shipped.renderingAllowList.subject.filter((oneName) => !namePopulatedOnSome(oneName, subjectNodeList));
		harness.equal(
			`BG-SEAT-PESC a ${oneRow.bridgeName} — every declared SUBJECT allow-list name is non-empty on at least one node of the population it JUDGES (${subjectNodeList.length} of ${(nodeListByLabel[oneRow.subjectLabel] || []).length} '${oneRow.subjectLabel}' nodes; filter: ${oneRow.subjectFilterDescription}). An unpopulated name renders NOTHING, SILENTLY, forever`,
			unpopulatedNameList.join(', '),
			'',
		);
	});

	// THE TWIN — AND IT IS THE ASSERTION THAT FOUND THE DEFECT IN THIS VERY SECTION ON ITS FIRST RUN.
	// `typeAsWritten` is the honest choice rather than an invented string: the property-tier plugin
	// declares it legitimately; it is populated on ZERO of the option-set nodes the sibling judges; and
	// it IS populated elsewhere UNDER THE SAME LABEL, on the DmeClass and DmeSupport nodes. So it
	// discriminates a SCOPED check from an unscoped one — which is precisely the mistake this section
	// made before the subjectFilter existed, and the reason it now does.
	const elementRow = PLUGIN_REGISTRY_ROW_LIST[0];
	const optionSetRow = PLUGIN_REGISTRY_ROW_LIST[1];
	const populatedOnElementSubjects = namePopulatedOnSome('typeAsWritten', subjectNodeListFor(elementRow));
	const populatedOnWholeLabel = namePopulatedOnSome('typeAsWritten', nodeListByLabel[optionSetRow.subjectLabel] || []);
	const populatedOnOptionSetSubjects = namePopulatedOnSome('typeAsWritten', subjectNodeListFor(optionSetRow));
	harness.ok(
		"RED-OBSERVED BG-SEAT-PESC a — 'typeAsWritten' is populated on the ELEMENT plugin's subjects AND on the option-set LABEL at large, but on NONE of the option-set plugin's actual SUBJECTS. An UNSCOPED check calls it populated and is WRONG; the scoped one catches it",
		populatedOnElementSubjects && populatedOnWholeLabel && !populatedOnOptionSetSubjects,
		`element subjects: ${populatedOnElementSubjects}; whole ${optionSetRow.subjectLabel} label: ${populatedOnWholeLabel}; option-set SUBJECTS: ${populatedOnOptionSetSubjects}`,
	);

	const composedSourceNodeList = forged.nodes.filter((oneNode) => COMPOSED_LABEL_LIST.some((oneLabel) => labelHas(oneNode, oneLabel)) && oneNode.properties.pescTier === 'source');
	const missingSeatCount = composedSourceNodeList.filter((oneNode) => SEAT_NAME_LIST.some((oneName) => oneNode.properties[oneName] === undefined)).length;
	harness.ok(
		`BG-SEAT-PESC b the rendering seat is stamped on EVERY composed source-tier declaration (${composedSourceNodeList.length} scanned, a LITERAL population of 17,053 at this freeze) — the MANDATORY RESOLVES_TO seat is not reachable by a declaration at all unless the forge puts it on the node`,
		composedSourceNodeList.length === 17053 && missingSeatCount === 0,
		`${composedSourceNodeList.length} composed source nodes, ${missingSeatCount} missing a seat property`,
	);

	const strayList = forged.nodes.filter(
		(oneNode) =>
			!(COMPOSED_LABEL_LIST.some((oneLabel) => labelHas(oneNode, oneLabel)) && (oneNode.properties.pescTier === 'source' || oneNode.properties.pescTier === 'synthetic')) &&
			SEAT_NAME_LIST.some((oneName) => oneNode.properties[oneName] !== undefined),
	);
	harness.equal('BG-SEAT-PESC b no node OUTSIDE the composed labels carries a seat property — a derived annotation riding onto a tier that cannot regenerate it is the leak syntheticTier.js strips for', String(strayList.length), '0');

	// S-1c. STATED AS THE POSITIVE, not merely the absence of the negative.
	// ⚠️ AND ITS DISCRIMINATING POWER IS REPORTED WITH IT, because I measured that it has none on this
	// corpus: S-1c merges SAME-NAMED definitions, so the merged owner EQUALS the source child's
	// container on all 522 and inheriting is indistinguishable from recomposing FOR THIS FIELD. The
	// registry entry is load-bearing for a DIFFERENT reason, measured separately: without it, three
	// unregistered names enter GAP 3's comparison and move decidedNonSignaturePropertyNames on 7
	// children — a STAMPED property, changing silently. See test/probes/p1_registryOmissionLever.js.
	const mergedChildList = forged.nodes.filter((oneNode) => oneNode.properties.pescTier === 'synthetic' && typeof oneNode.properties.copiedFromStableId === 'string' && COMPOSED_LABEL_LIST.some((oneLabel) => labelHas(oneNode, oneLabel)));
	const nodeByStableId = forged.nodes.reduce((soFar, oneNode) => ({ ...soFar, [oneNode.stableId]: oneNode }), {});
	const ownerMatchCount = mergedChildList.filter((oneChild) => {
		const mergedDefinition = nodeByStableId[oneChild.properties.parentId];
		return mergedDefinition !== undefined && oneChild.properties.owningTypeName === mergedDefinition.properties.name;
	}).length;
	harness.ok(
		`BG-SEAT-PESC c every S-1c merged child's owningTypeName EQUALS its MERGED definition's name (${mergedChildList.length} children, a LITERAL 522 at this freeze). NOTE ITS LIMIT, measured and not assumed: on this corpus the merged owner also equals the source child's container, so this conjunct CANNOT discriminate inheritance from recomposition — it is correct by construction, not proven by data`,
		mergedChildList.length === 522 && ownerMatchCount === 522,
		`${ownerMatchCount} of ${mergedChildList.length} match the merged definition's name`,
	);

	done();
};

// ---------------------------------------------------------------------
// the run — SECTIONS 1 and 2 are hermetic and synchronous; SECTION 3 needs the forge
// ---------------------------------------------------------------------
runPluginSection();
runComposeSection();

const entryBundle = require(path.join(bundleDirPath, 'forgePesc260805'))({ embedder: null });
entryBundle.forge({ sourcePath: path.join(bundleDirPath, 'assets', 'standardSourceData', '01'), owner: moduleName, skipEmbedding: true }, (forgeError, forged) => {
	if (forgeError) {
		harness.note(`the forge REFUSED (${forgeError}) — SECTION 3's conjuncts are UNMEASURED and fail by name below, never silently skipped`);
		harness.report();
		return;
	}
	runSeatSection(forged, () => {
		harness.report();
	});
});
