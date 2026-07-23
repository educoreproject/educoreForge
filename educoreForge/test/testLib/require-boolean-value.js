'use strict';

// require-boolean-value.js — read a `--name=true|false` command-line VALUE, or refuse it out loud.
//
// ONE spelling, ONE polarity, ONE reading, shared by every entry point that takes a boolean.
// Its sibling parse-list-value.js does the same job for list values; this is the boolean rule.
//
// WHY IT EXISTS (Phase 4, work group 3): --vectorize was read in four places in TWO OPPOSITE
// POLARITIES — `[0] !== 'false'` in the forger's entry points, `[0] === 'true'` in the replay
// manager's. One spelling, `--vectorize=no`, therefore meant TRUE in two of them (spending real
// Voyage credit against the explicit intent of whoever typed it) and FALSE in the other two
// (silently producing vectorless output), and neither said a word about it. polyArch2 §6: a
// value someone TYPED and had silently overruled is the WORSE of the two faults, because he
// believes it took effect.
//
// THE RULE: exactly the string 'true' or exactly the string 'false'. Nothing else. Not 'yes',
// not 'no', not '1', not '0', not 'True', not 'on', not 'off', and not absence. Two spellings
// are memorable; a synonym table is a second thing to be wrong about, and any line drawn through
// the synonyms ('yes' but not 'oui'? 'True' but not 'TRUE'?) is arbitrary. Refusing everything
// outside the two is the only rule that needs no documentation beyond itself — and it is what
// the entry points' -help already told the operator to type.
//
// CODE FACTS about qtools-parse-command-line (probed against this tree's copy, 2026-07-23) —
// every one of these shapes is refused BY NAME rather than collapsed into a guess:
//   --vectorize=false   -> values.vectorize === ['false']   the ordinary case
//   --vectorize=a,b     -> values.vectorize === ['a','b']   commas are pre-split into entries
//   --vectorize=        -> values.vectorize === true        a BOOLEAN, not an array — and it
//                                                           SWALLOWS the following argument
//   --vectorize         -> values.vectorize === true        the same
//   -vectorize          -> switches.vectorize === true, and values.vectorize is UNDEFINED, so a
//                                                           single-hyphen spelling is invisible
//                                                           to any reader that consults values only
//   repeated --flags    -> the last one wins, as one entry
//
// CHANNEL — throw, not callback. This is read at the top of an entry point, before any work is
// begun and with no callback in sight; a program whose control surface was misread has nothing
// sensible to do next.

const ACCEPTED = ['true', 'false'];

// -----
// requireBooleanValue — the boolean an operator asked for, or a refusal naming what he typed.
//
//   requireBooleanValue({ name, commandLineParameters, moduleName, whatItControls }) -> boolean
//     name:                  the switch name, without hyphens (e.g. 'vectorize')
//     commandLineParameters: the qtools object, whole — values AND switches are both consulted
//     moduleName:            who is asking, so the refusal names the program the operator ran
//     whatItControls:        one clause saying what the switch decides, so the refusal explains
//                            why he has to choose rather than merely that he must

const requireBooleanValue = ({ name, commandLineParameters, moduleName, whatItControls }) => {
	// the helper holds itself to §6: its own arguments are required, and their absence is a
	// programming fault named where it happened, never a default.
	['name', 'commandLineParameters', 'moduleName', 'whatItControls'].forEach((oneArgument) => {
		if (({ name, commandLineParameters, moduleName, whatItControls })[oneArgument] === undefined) {
			throw new Error(
				`requireBooleanValue: '${oneArgument}' is required and was not given. ` +
					`All of name, commandLineParameters, moduleName and whatItControls must be passed.`,
			);
		}
	});

	const values = commandLineParameters.values || {};
	const switches = commandLineParameters.switches || {};
	const usage = `Give exactly one of: --${name}=${ACCEPTED[0]}, --${name}=${ACCEPTED[1]}.`;
	const preamble = `[${moduleName}]`;
	const given = values[name];

	if (given === undefined) {
		if (switches[name]) {
			throw new Error(
				`${preamble} '-${name}' is a switch spelling, and this is a VALUE — a single hyphen ` +
					`never reaches it. ${usage}`,
			);
		}
		throw new Error(
			`${preamble} --${name} is not set, and it is required: it decides ${whatItControls}. ` +
				`${usage} There is no default — this is not a decision the program will make for you.`,
		);
	}

	if (given === true) {
		throw new Error(
			`${preamble} --${name} was given with no value. ${usage}`,
		);
	}

	const list = Array.isArray(given) ? given : [given];

	if (list.length !== 1) {
		throw new Error(
			`${preamble} --${name} was given ${list.length} values ` +
				`(${list.map((oneValue) => `'${oneValue}'`).join(', ')}). ${usage}`,
		);
	}

	const only = String(list[0]);

	if (!ACCEPTED.includes(only)) {
		throw new Error(
			`${preamble} --${name}='${only}' is not a recognized value. ${usage} ` +
				`Nothing else is accepted: 'yes', 'no', '1', '0', 'on', 'off' and 'True' are NOT ` +
				`synonyms, and a value that is not understood is refused rather than guessed at.`,
		);
	}

	return only === 'true';
};

module.exports = { requireBooleanValue, ACCEPTED };
