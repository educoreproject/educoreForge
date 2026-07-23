'use strict';

// optional-boolean-value.js — the PRODUCTION reader for an OPTIONAL boolean command-line value
// that has a DOCUMENTED default.
//
// It is the sibling of test/testLib/require-boolean-value.js (the REQUIRED reader the deliberate
// integration entry points use), and it shares that module's discipline exactly: one spelling, one
// polarity, 'true' or 'false' and nothing else — no 'yes', no '1', no 'True', no synonym table.
// The single difference is the one polyArch2 §6 sanctions: because this input is LEGITIMATELY
// OPTIONAL and its default is stated in the app's -help, an ABSENT value yields the default rather
// than a refusal. A PRESENT-but-invalid value is still the worse fault and is refused BY NAME.
//
// PRODUCTION MUST NOT DEPEND ON test/ CODE. graphBuilder is the app; require-boolean-value lives
// under test/testLib and is for the integration scripts. This module is that reader's production
// equivalent, living in lib/ where the app can require it.
//
// CHANNEL — it RETURNS { value } or { error } (never throws for control flow), so a callback-style
// caller routes a refusal through its own error channel without a try/catch. A genuine programming
// fault (a missing meta-argument the CALLER hard-codes) still throws, because that is a bug at the
// call site, not operator input.

const ACCEPTED = ['true', 'false'];

// -----
// readOptionalBooleanValue — the boolean an operator asked for, the documented default when he said
//   nothing, or an { error } naming what he typed.
//
//   readOptionalBooleanValue({ name, commandLineParameters, moduleName, whatItControls, defaultValue })
//     name:                  the switch name, without hyphens (e.g. 'vectorize')
//     commandLineParameters: the qtools object, whole — values AND switches are both consulted
//     moduleName:            who is asking, so a refusal names the program the operator ran
//     whatItControls:        one clause saying what the switch decides
//     defaultValue:          the boolean returned when the switch is absent (the documented default)

const readOptionalBooleanValue = ({ name, commandLineParameters, moduleName, whatItControls, defaultValue }) => {
	if (
		typeof name !== 'string' ||
		typeof moduleName !== 'string' ||
		typeof whatItControls !== 'string' ||
		typeof defaultValue !== 'boolean' ||
		!commandLineParameters ||
		typeof commandLineParameters !== 'object'
	) {
		throw new Error(
			`readOptionalBooleanValue: name/moduleName/whatItControls (strings), a boolean defaultValue ` +
				`and a commandLineParameters object are all required — these are caller-supplied constants, ` +
				`so their absence is a programming fault, not operator input.`,
		);
	}

	const values = commandLineParameters.values || {};
	const switches = commandLineParameters.switches || {};
	const usage =
		`Give exactly one of: --${name}=${ACCEPTED[0]}, --${name}=${ACCEPTED[1]}, or omit it to accept ` +
		`the documented default (${defaultValue}).`;
	const preamble = `[${moduleName}]`;
	const given = values[name];

	if (given === undefined) {
		if (switches[name]) {
			return {
				error:
					`${preamble} '-${name}' is a switch spelling, and this is a VALUE — a single hyphen ` +
					`never reaches it. ${usage}`,
			};
		}
		// legitimately optional and absent: the documented default is the correct answer (polyArch2 §6)
		return { value: defaultValue };
	}

	if (given === true) {
		return { error: `${preamble} --${name} was given with no value. ${usage}` };
	}

	const list = Array.isArray(given) ? given : [given];
	if (list.length !== 1) {
		return {
			error: `${preamble} --${name} was given ${list.length} values (${list
				.map((oneValue) => `'${oneValue}'`)
				.join(', ')}). ${usage}`,
		};
	}

	const only = String(list[0]);
	if (!ACCEPTED.includes(only)) {
		return {
			error:
				`${preamble} --${name}='${only}' is not a recognized value. ${usage} 'yes', 'no', '1', ` +
				`'0', 'on', 'off' and 'True' are NOT synonyms; a value that is not understood is refused ` +
				`rather than guessed at.`,
		};
	}

	return { value: only === 'true' };
};

module.exports = { readOptionalBooleanValue, ACCEPTED };
