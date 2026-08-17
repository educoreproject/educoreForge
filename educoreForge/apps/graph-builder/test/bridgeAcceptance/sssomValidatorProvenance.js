'use strict';

// sssomValidatorProvenance.js — WHICH SSSOM validator actually ran, and whether that counts as a MEASUREMENT, as a
// PURE function (RULING B4R-4 as amended to option (c) by SABLE_RIVER 2026-08-17, on FINDING B4-F9 of
// reviews/REVIEW-B4-sifPlugin-081726.md).
//
// ⟪THE DEFECT, AND WHY A SILENT PASS IS WORSE THAN A FAILURE⟫
// BG-P7 has two validators: the framework's own header/row/curie_map PROXY, and the real `sssom-py` from a venv on
// this one machine. test-bgP7.js computed the venv path by climbing four directories from the framework dir. From
// the MAIN tree that lands on system/dataStores/…; from a WORKTREE it lands on codeWorktrees/dataStores/…, which
// does not exist. The suite then took the proxy branch, returned pass:true, and reported 44/44 GREEN.
//
// Side by side, the SAME conjunct's twin detail, both green [measured by the reviewer]:
//     main tree  55357b5 — "sssom validate exit 1: … Slot 'subject_match_field' has an incorrect value:
//                           ['undefined']"        <- the REAL validator, catching a real export defect
//     worktree   38255bd — "PROXY only — sssom-py absent; subject_match_field present true …"
//
// A reviewer running the fleet from a worktree is told the real sssom-py gate passed when it never ran. That is the
// exact failure BR3-6's UNMEASURED accounting exists to prevent, in a family BR3-6 did not reach — and note that
// the sibling suite test-bridgeAcceptanceEdfi.js has the SAME path bug and fails LOUDLY (79/80, "FAIL UNMEASURED"),
// which is what a working instrument looks like. The difference is not the bug; it is the accounting.
//
// ⟪THE RULE: DECLARED, NOT DISCOVERED⟫
// Presence-sniffing a tool path cannot tell "this machine has no sssom-py" from "my path arithmetic is wrong", and
// those want opposite verdicts. So the venv path is DECLARED DATA in acceptanceCommands.jsonc, and the declaration
// is what makes the real validator EXPECTED. Four combinations, four different answers, none of them silent:
//
//   declared + on disk + the REAL validator ran      -> MEASURED. The conjunct means what it says.
//   declared + NOT on disk (whatever ran)            -> UNMEASURED BY NAME, naming the absent declared path. Somebody
//                                                       stated this machine has sssom-py THERE and it is not there:
//                                                       a worktree misresolution or a broken venv. THIS is the case
//                                                       that was silently green.
//   declared + on disk + only the PROXY ran          -> UNMEASURED BY NAME, and a DIFFERENT name: the real validator
//                                                       was available and was not used, which is a wiring bug rather
//                                                       than an environment one. Collapsing it into the case above
//                                                       would send the next reader to look at the venv.
//   NOT declared + only the PROXY ran                -> PERMITTED, labelled proxy-only. No declaration, no promise;
//                                                       the proxy legitimately carries the conjunct.
//   NOT declared + the REAL validator ran            -> REFUSED. Something DISCOVERED a binary nobody declared, which
//                                                       is precisely what this ruling forbids: a run whose validator
//                                                       depends on what happened to be on the box is unreproducible
//                                                       even when it passes.
//
// The verdict carries `unmeasuredReason` rather than throwing, because the CALLER is a gate family that has to
// account for the assertion (BR3-6 counts UNMEASURED assertions by name); a throw would abort the suite instead of
// being tallied.
//
// WIRING: test-bgP7.js is the consumer, and its require+call is the SUPERVISOR'S EDIT AT MERGE (ruled) — that file
// sits inside expectedCompose.diffedPathList, so a byte written there by this phase would turn BG-COMPOSE-SIF (a),
// the zero-framework-diff proof, red. The substance, the twins and the declared data are delivered here; only the
// two-line wiring is deferred, and it is on the merge list beside test-bgNosub.js:147 and
// test-bridgeAcceptanceEdfi.js:101, which are the same trap.

const moduleName = 'sssomValidatorProvenance';

const REAL_VALIDATOR_NAME = 'sssom-py';
const PROXY_VALIDATOR_NAME = 'proxy';
const VALIDATOR_NAME_LIST = Object.freeze([REAL_VALIDATOR_NAME, PROXY_VALIDATOR_NAME]);

// sssomValidatorProvenanceFor — the verdict. `binPathPresent` is passed IN rather than stat-ed here so the rule is
// pure and a twin can state the world it is testing instead of building one on disk.
//   declaredBinPath  — the ABSOLUTE path declared in acceptanceCommands.jsonc, or undefined/null when none is declared
//   binPathPresent   — whether that declared path is on disk (meaningless, and ignored, when nothing is declared)
//   ranValidatorName — 'sssom-py' when the real validator was executed, 'proxy' when only the framework's own ran
// Returns { measured, unmeasuredReason, label }. unmeasuredReason === '' means the outcome is acceptable; the caller
// fails the assertion BY NAME when it is not empty.
const sssomValidatorProvenanceFor = ({ declaredBinPath, binPathPresent, ranValidatorName } = {}) => {
	if (VALIDATOR_NAME_LIST.indexOf(ranValidatorName) === -1) {
		return { measured: false, unmeasuredReason: `${moduleName} was told the validator that ran was ${JSON.stringify(ranValidatorName)}, which is not one of ${VALIDATOR_NAME_LIST.join(' | ')} — a gate that cannot say which validator ran cannot claim a measurement`, label: 'UNKNOWN VALIDATOR' };
	}
	const declared = typeof declaredBinPath === 'string' && declaredBinPath.length > 0;
	if (declared && typeof binPathPresent !== 'boolean') {
		return { measured: false, unmeasuredReason: `${moduleName} was given a declared validator path (${declaredBinPath}) but no boolean binPathPresent — whether the declared tool is actually there is the whole question and is never assumed`, label: 'UNMEASURED — presence unknown' };
	}
	if (!declared) {
		if (ranValidatorName === REAL_VALIDATOR_NAME) {
			return { measured: false, unmeasuredReason: `the REAL ${REAL_VALIDATOR_NAME} validator ran but NO validator path is DECLARED in acceptanceCommands.jsonc — it was DISCOVERED. RULING B4R-4: the venv path is declared data, not discovered, because a run whose validator depends on what happened to be on the machine is unreproducible even when it passes`, label: `UNMEASURED — ${REAL_VALIDATOR_NAME} ran undeclared` };
		}
		// no declaration, no promise: the proxy legitimately carries the conjunct, and says so
		return { measured: false, unmeasuredReason: '', label: `PROXY ONLY — no ${REAL_VALIDATOR_NAME} path declared, so the framework's own validator carries this conjunct (permitted)` };
	}
	if (!binPathPresent) {
		return { measured: false, unmeasuredReason: `acceptanceCommands.jsonc DECLARES the ${REAL_VALIDATOR_NAME} validator at '${declaredBinPath}' and it is NOT ON DISK, so this conjunct is UNMEASURED — the ${PROXY_VALIDATOR_NAME} validator cannot stand in for a declared one and reporting its pass as this gate's pass is FINDING B4-F9 exactly (a worktree misresolution or a broken venv; from a worktree the old four-level climb landed on codeWorktrees/dataStores, which does not exist)`, label: `UNMEASURED — declared ${REAL_VALIDATOR_NAME} absent at ${declaredBinPath}` };
	}
	if (ranValidatorName === PROXY_VALIDATOR_NAME) {
		return { measured: false, unmeasuredReason: `the ${REAL_VALIDATOR_NAME} validator is DECLARED and PRESENT at '${declaredBinPath}', yet only the ${PROXY_VALIDATOR_NAME} validator ran — this conjunct is UNMEASURED for a WIRING reason rather than an environment one, and it is named separately so the next reader is not sent to inspect a venv that is perfectly fine`, label: `UNMEASURED — declared ${REAL_VALIDATOR_NAME} present but not used` };
	}
	return { measured: true, unmeasuredReason: '', label: `MEASURED by the REAL ${REAL_VALIDATOR_NAME} at ${declaredBinPath}` };
};

module.exports = { sssomValidatorProvenanceFor, REAL_VALIDATOR_NAME, PROXY_VALIDATOR_NAME, VALIDATOR_NAME_LIST, moduleName };
