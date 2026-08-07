#!/usr/bin/env node
'use strict';

// p7_repinnedDescriptorLevers.js — RED EVIDENCE for the three assertions that replaced the stale
// 'INTEGRATION roundTripValidator NOT declared yet' pin (Phase 7 re-pinning).
//
// THE LEVERS MUTATE PRODUCTION DATA, NOT A TEST EXPECTATION. The mutated artifact is
// forges/pesc260805/parserDescriptor.ini — the bundle's own self-description, which forger.js reads
// on every build. This phase MEASURED that 65 of 113 `proven` ledger rows rest on expectation levers
// alone; shipping three new assertions on expectation levers would have made it 68. An expectation
// lever reddens an assertion whether or not its predicate can ever be satisfied by real data, so it
// certifies a vacuous gate as proven. These levers cannot.
//
// THE FILE IS RESTORED BYTE-FOR-BYTE AND THE RESTORE IS VERIFIED, not assumed. A probe that mutates
// the shipped descriptor and exits without restoring would leave the bundle refusing every build —
// so the restore is checked by comparing bytes, and a failed restore is a REFUSAL BY NAME carrying
// the path of the retained original.
//
// ACCEPT-CONTROL: a NO-OP lever that rewrites the ORIGINAL bytes must leave all three predicates
// GREEN. Without it, a harness that simply broke the descriptor on every pass — or one whose reader
// cached and never saw any mutation — would produce an all-red table indistinguishable from working
// levers. The control proves the harness can observe green, so a red means something.
//
// AND A CACHING GUARD, because the predicate reads through qtools-config-file-processor: if a
// mutation produces NO observable change in the parsed descriptor, this probe REFUSES BY NAME rather
// than reporting the assertion green. A lever that did not move the observation certifies nothing,
// and 'no change observed' must never be silently recorded as 'the assertion held'.
//
// Async style: synchronous file work end to end; no callbacks invented. No async/await; the only
// try is the sanctioned boundary translation around require() of a deliberately-broken module.

const fs = require('fs');
const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
const OUTPUT_PATH = path.join(__dirname, '..', 'test-artifacts', 'p7', 'p7RepinnedDescriptorLevers.json');
const BROKEN_MODULE_PATH = path.join(BUNDLE_DIR, 'zzPhase7DeliberatelyExportsNoValidate.js');

/**
 * THE TWO POLYMORPHIC SEAMS OF THIS MODULE, DECLARED (polyArch2). Both are function slots filled by
 * data, so a new predicate or a new lever is an edit to a list rather than to control flow.
 *
 * @typedef {Object} AssertionPredicate
 * @property {string} assertionLabel  the label as it is shipped in the suite, VERBATIM. It is the
 *                                    ledger join key, so a paraphrase here silently decouples the
 *                                    lever table from the assertion it claims to prove.
 * @property {function(Object): boolean} holdsFor
 *                                    given a freshly parsed parserDescriptor section, true when the
 *                                    shipped assertion would PASS. Must not throw on a descriptor
 *                                    that is absent, partial, or points at a module that fails to
 *                                    load — those are the states the levers deliberately create.
 *
 * @typedef {Object} DescriptorLever
 * @property {string}  leverName      compound, greppable identifier.
 * @property {boolean} isAcceptControl true for the no-op control, which must redden NOTHING. Exactly
 *                                    one entry may set it, and the run REFUSES if its expectation
 *                                    does not hold — an all-red table from a broken harness is
 *                                    otherwise indistinguishable from working levers.
 * @property {string}  description    what is mutated and why that mutation is production DATA.
 * @property {function(string): string} mutateDescriptorText
 *                                    original descriptor bytes in, mutated bytes out. Returning the
 *                                    input unchanged is a REFUSAL condition for any non-control
 *                                    lever: a pattern that silently matched nothing certifies
 *                                    nothing while still looking like evidence.
 * @property {number[]} expectedToRedden
 *                                    indices into ASSERTION_PREDICATES that MUST go red. Stated per
 *                                    lever so a lever reddening the WRONG assertion is a visible
 *                                    mismatch rather than a green row.
 */

/** @type {AssertionPredicate[]} */
// THE THREE SHIPPED ASSERTIONS, restated here as predicates over a parsed descriptor. Declared as
// data in one place so the lever table and the suite cannot drift into testing different claims.
const ASSERTION_PREDICATES = [
	{
		assertionLabel: 'INTEGRATION roundTripValidator IS declared (Phase 5; re-pinned in Phase 7)',
		holdsFor: (descriptor) =>
			!!descriptor && descriptor.roundTripValidator === 'roundTripValidator.js',
	},
	{
		assertionLabel:
			'INTEGRATION the declared roundTripValidator file EXISTS (RT-13.3: declared-and-missing refuses every build)',
		holdsFor: (descriptor) => {
			const declaredName = descriptor && descriptor.roundTripValidator;
			return (
				typeof declaredName === 'string' &&
				declaredName !== '' &&
				fs.existsSync(path.join(BUNDLE_DIR, declaredName))
			);
		},
	},
	{
		assertionLabel:
			'INTEGRATION the declared roundTripValidator exports validate() (RT-13.3: declared-and-broken is a refusal, never a downgrade to absent)',
		holdsFor: (descriptor) => {
			const declaredName = descriptor && descriptor.roundTripValidator;
			if (typeof declaredName !== 'string' || declaredName === '') {
				return false;
			}
			const modulePath = path.join(BUNDLE_DIR, declaredName);
			if (!fs.existsSync(modulePath)) {
				return false;
			}
			// SANCTIONED BOUNDARY TRANSLATION (the same pattern round-trip-stage.js uses around its
			// validator require): a module that throws on load is a CONSTRUCTION fault, and the
			// predicate's answer for it is 'does not export validate', not a crashed probe.
			let loaded = null;
			try {
				loaded = require(modulePath);
			} catch (loadFault) {
				return false;
			}
			return typeof loaded === 'function' && typeof loaded().validate === 'function';
		},
	},
];

// THE LEVERS. Each rewrites the descriptor's roundTripValidator declaration in production bytes.
// `expectedToRedden` names which assertions MUST go red — stated per lever so a lever that reddens
// the wrong assertion is a visible mismatch rather than a green row.
/** @type {DescriptorLever[]} */
const DESCRIPTOR_LEVERS = [
	{
		leverName: 'noOpControl',
		isAcceptControl: true,
		description:
			'ACCEPT-CONTROL: rewrite the ORIGINAL bytes unchanged. All three predicates must stay GREEN, ' +
			'proving the harness can observe a passing state and that the reader is not serving a stale ' +
			'cached parse.',
		mutateDescriptorText: (originalText) => originalText,
		expectedToRedden: [],
	},
	{
		leverName: 'removeTheDeclarationEntirely',
		isAcceptControl: false,
		description:
			'PRODUCTION MUTATION, SHIPPED CONFIGURATION: delete the roundTripValidator line from the ' +
			"bundle's self-description — the pre-Phase-5 state the stale assertion used to pin. RT-13.3 " +
			'treats absent as tolerated-but-logged, so this is the state in which the rebuild silently ' +
			'stops being certifiable.',
		mutateDescriptorText: (originalText) =>
			originalText.replace(/^roundTripValidator=.*$/m, '# roundTripValidator REMOVED BY LEVER'),
		expectedToRedden: [0, 1, 2],
	},
	{
		leverName: 'pointTheDeclarationAtAMissingFile',
		isAcceptControl: false,
		description:
			'PRODUCTION MUTATION, SHIPPED CONFIGURATION: declare a validator filename that does not ' +
			'exist. This is RT-13.3\'s declared-and-missing case, which must REFUSE every build by name ' +
			'rather than degrade to absent.',
		mutateDescriptorText: (originalText) =>
			originalText.replace(
				/^roundTripValidator=.*$/m,
				'roundTripValidator=zzNoSuchValidatorFile.js',
			),
		expectedToRedden: [0, 1, 2],
	},
	{
		leverName: 'pointTheDeclarationAtAModuleExportingNoValidate',
		isAcceptControl: false,
		description:
			'PRODUCTION MUTATION, SHIPPED CONFIGURATION: declare a validator file that EXISTS and LOADS ' +
			'but exports no validate(). This is the lever that separates the third assertion from the ' +
			'second — a file-existence check alone cannot see it, which is exactly why the re-pin is ' +
			'three assertions and not one conjunction.',
		mutateDescriptorText: (originalText) =>
			originalText.replace(
				/^roundTripValidator=.*$/m,
				`roundTripValidator=${path.basename(BROKEN_MODULE_PATH)}`,
			),
		expectedToRedden: [0, 2],
	},
];

// re-parse the descriptor with NO cached state — the require cache is cleared so a cached parse
// cannot make a mutation invisible.
const parseDescriptorFresh = () => {
	const configFileProcessorPath = require.resolve('qtools-config-file-processor');
	delete require.cache[configFileProcessorPath];
	const configFileProcessor = require('qtools-config-file-processor');
	const parsed = configFileProcessor.getConfig(DESCRIPTOR_PATH);
	return (parsed || {}).parserDescriptor;
};

const runLevers = () => {
	const originalDescriptorText = fs.readFileSync(DESCRIPTOR_PATH, 'utf8');
	fs.writeFileSync(
		BROKEN_MODULE_PATH,
		"'use strict';\n// Phase 7 lever specimen — deliberately exports no validate(). Written and removed by\n// test/probes/p7_repinnedDescriptorLevers.js on every run; it is never part of a build.\nmodule.exports = () => ({ notValidate: true });\n",
	);

	const leverRows = [];
	const mismatches = [];
	const inertLevers = [];

	DESCRIPTOR_LEVERS.forEach((oneLever) => {
		const mutatedText = oneLever.mutateDescriptorText(originalDescriptorText);
		// A LEVER THAT CHANGES NO BYTES CANNOT REDDEN ANYTHING. Caught here rather than reported as a
		// green row: a regex that silently matched nothing is the classic way a lever becomes inert
		// while still looking like evidence.
		if (!oneLever.isAcceptControl && mutatedText === originalDescriptorText) {
			inertLevers.push(oneLever.leverName);
			return;
		}
		fs.writeFileSync(DESCRIPTOR_PATH, mutatedText);
		const mutatedDescriptor = parseDescriptorFresh();
		const observedRed = [];
		ASSERTION_PREDICATES.forEach((onePredicate, predicateIndex) => {
			if (!onePredicate.holdsFor(mutatedDescriptor)) {
				observedRed.push(predicateIndex);
			}
		});
		fs.writeFileSync(DESCRIPTOR_PATH, originalDescriptorText);
		const expected = oneLever.expectedToRedden.join(',');
		const observed = observedRed.join(',');
		leverRows.push({
			leverName: oneLever.leverName,
			isAcceptControl: oneLever.isAcceptControl,
			description: oneLever.description,
			expectedToRedden: oneLever.expectedToRedden,
			observedRed,
			agrees: expected === observed,
		});
		if (expected !== observed) {
			mismatches.push(
				`${oneLever.leverName}: expected to redden [${expected}] but observed [${observed}]`,
			);
		}
	});

	// RESTORE VERIFIED BY BYTES, NOT ASSUMED.
	const restoredText = fs.readFileSync(DESCRIPTOR_PATH, 'utf8');
	fs.unlinkSync(BROKEN_MODULE_PATH);
	if (restoredText !== originalDescriptorText) {
		return {
			refusal:
				`${moduleName}: parserDescriptor.ini was NOT restored to its original bytes. The bundle's ` +
				`self-description is currently MUTATED and every build will read it. Restore it by hand ` +
				`from git (git checkout -- forges/pesc260805/parserDescriptor.ini) before doing anything ` +
				`else.`,
		};
	}
	if (inertLevers.length > 0) {
		return {
			refusal:
				`${moduleName}: ${inertLevers.length} lever(s) produced NO byte change in the descriptor, ` +
				`so they cannot have reddened anything and certify nothing: ${inertLevers.join(', ')}. ` +
				`The mutation pattern no longer matches the file.`,
		};
	}
	const control = leverRows.filter((oneRow) => oneRow.isAcceptControl);
	if (control.length !== 1 || control[0].observedRed.length !== 0) {
		return {
			refusal:
				`${moduleName}: the ACCEPT-CONTROL did not hold — with the ORIGINAL bytes in place the ` +
				`three predicates must all be GREEN, and ${control.length === 1 ? `predicates [${control[0].observedRed.join(',')}] were red` : 'the control row is missing'}. ` +
				`Either the reader is serving a stale cached parse or the predicates do not describe the ` +
				`shipped state; in both cases every red below is uninterpretable.`,
		};
	}
	return { leverRows, mismatches, restoreVerified: true };
};

module.exports = { runLevers, ASSERTION_PREDICATES, DESCRIPTOR_LEVERS };

if (require.main === module) {
	const outcome = runLevers();
	if (outcome.refusal) {
		console.error(`\n${outcome.refusal}`);
		process.exit(1);
	}
	console.log('=== RED EVIDENCE — the three re-pinned descriptor assertions ===\n');
	ASSERTION_PREDICATES.forEach((onePredicate, predicateIndex) => {
		console.log(`  [${predicateIndex}] ${onePredicate.assertionLabel}`);
	});
	console.log('');
	outcome.leverRows.forEach((oneRow) => {
		console.log(
			`  ${oneRow.agrees ? 'OK  ' : 'MISMATCH'}  ${oneRow.isAcceptControl ? 'CONTROL' : 'LEVER  '}  ` +
				`${oneRow.leverName}\n            reddened [${oneRow.observedRed.join(',')}] ` +
				`(expected [${oneRow.expectedToRedden.join(',')}])`,
		);
	});
	console.log(`\nparserDescriptor.ini restored byte-for-byte: ${outcome.restoreVerified}`);
	fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(outcome, null, 2)}\n`);
	console.log(`wrote ${OUTPUT_PATH}`);
	if (outcome.mismatches.length > 0) {
		console.error(`\nLEVER TABLE MISMATCH:\n  ${outcome.mismatches.join('\n  ')}`);
		process.exit(1);
	}
	console.log('\nEvery assertion was OBSERVED RED under at least one lever that MUTATES PRODUCTION DATA.');
	process.exit(0);
}
