'use strict';

// operator-input.js — the ONE reader of graphBuilder's operator input, run once at startup on both
// channels, before any action is chosen or any config is read (deep review 2026-11-21, Build 2: F-2 and
// its siblings, F-38).
//
// WHY AT THE ENTRY AND NOT AT EACH READER. qtools-parse-command-line loses information an operator typed
// (code fact, deepReview-112126/scratch/probeBlankFlag.js and pass2/T0 section 1.1):
//   --name=        last on the line becomes the BOOLEAN true; anywhere else it SWALLOWS the next token as
//                  its value: `--a= --b=c` gives a=['--b=c'] and drops --b; `--a= -build` drops the action.
//   --name value   the space form: the next token becomes the value, whatever it is.
//   --a=x --a=y    the last wins; x is gone.
//   -build=1       the =1 is dropped.
//   --p=a,b        two values; a path with a comma arrives in pieces.
// After the parse a swallowed token is a well-formed array, so no reader downstream can see it. About
// thirty files read values (T0 1.3); a hole closed per reader reopens with the next reader written. So
// the raw tokens are audited here, once, and the parsed values are audited for the shapes the stdin
// channel can carry (a string where an array belongs, an empty array, a blank, a non-string).
// Reading process.argv's tokens is this module's job alone; every other module reads
// process.global.commandLineParameters.
//
// Every refusal names the flag and the action, so `--x=$UNSET` reads as what it is. The wording
// 'was given but BLANK' is the wording of the per-reader refusals that predate this module
// (actions.js resolveSupportStoreFilePath), so a runbook that greps for it still finds it.
//
// The rules are DATA: lib/graphBuilderActionRegistry.json (actions, help and modifier switches, the
// flags that may be bare, the single-value suffixes). Returns '' when admitted, else the refusal text;
// nothing here throws for operator input.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const LONG_FLAG_WITH_VALUE_PATTERN = /^--([^=]+)=([\s\S]*)$/;
const LONG_FLAG_BARE_PATTERN = /^--([^=]+)$/;
const SWITCH_WITH_VALUE_PATTERN = /^-([^-=][^=]*)=([\s\S]*)$/;
const SWITCH_PATTERN = /^-([^-=][^=]*)$/;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ actionRegistry } = {}) => {
		if (!actionRegistry || !Array.isArray(actionRegistry.actionList) || !Array.isArray(actionRegistry.helpSwitchNameList) || !Array.isArray(actionRegistry.modifierSwitchNameList) || !Array.isArray(actionRegistry.bareSwitchFlagNameList) || !Array.isArray(actionRegistry.singleValueFlagNameSuffixList)) {
			throw new Error(`${moduleName}: an actionRegistry with actionList, helpSwitchNameList, modifierSwitchNameList, bareSwitchFlagNameList and singleValueFlagNameSuffixList is required (lib/graphBuilderActionRegistry.json); this is a programming fault, not operator input.`);
		}

		const actionSwitchNameList = actionRegistry.actionList.map((oneAction) => oneAction.switchName);
		const knownSwitchNameList = actionSwitchNameList.concat(actionRegistry.helpSwitchNameList, actionRegistry.modifierSwitchNameList);
		const isSingleValueFlagName = (flagName) => actionRegistry.singleValueFlagNameSuffixList.some((oneSuffix) => flagName.endsWith(oneSuffix));
		const isBareSwitchFlagName = (flagName) => actionRegistry.bareSwitchFlagNameList.includes(flagName);

		const prefixFor = (actionLabel) => (actionLabel ? `graphBuilder ${actionLabel}:` : 'graphBuilder:');
		const blankRefusal = (actionLabel, flagName, howTyped) =>
			`${prefixFor(actionLabel)} --${flagName} was given but BLANK (${howTyped}). A blank is refused rather than ` +
			`read as absent: read as absent it would take whatever default stands behind the flag (for a store, ` +
			`the store of record), and a caller that tried to name a value and failed has not agreed to any other. ` +
			`Give --${flagName}=<value>, or leave the flag out.`;

		// actionLabelForTokens — the action an operator TYPED, read from the raw tokens, so a refusal can name it even
		// when a blank flag swallowed it from the parse. '' when none is typed.
		const actionLabelForTokens = (tokenList) => {
			const typedActionName = tokenList.map((oneToken) => (SWITCH_PATTERN.exec(oneToken) || [])[1]).find((switchName) => actionSwitchNameList.includes(switchName));
			return typedActionName ? `-${typedActionName}` : '';
		};

		// -----
		// commandLineTokenRefusal — the raw tokens: blank (--x=), bare (--x), repeated (--x twice), a switch with a value.
		const commandLineTokenRefusal = (tokenList) => {
			const actionLabel = actionLabelForTokens(tokenList);
			const countByFlagName = {};
			for (let tokenIndex = 0; tokenIndex < tokenList.length; tokenIndex++) {
				const oneToken = `${tokenList[tokenIndex]}`;
				const isLastToken = tokenIndex === tokenList.length - 1;
				const withValueMatch = LONG_FLAG_WITH_VALUE_PATTERN.exec(oneToken);
				const bareMatch = LONG_FLAG_BARE_PATTERN.exec(oneToken);
				const switchWithValueMatch = SWITCH_WITH_VALUE_PATTERN.exec(oneToken);
				if (withValueMatch) {
					const flagName = withValueMatch[1];
					if (withValueMatch[2] === '') {
						return blankRefusal(actionLabel, flagName, `typed '--${flagName}=' with nothing after the '='; the parser would ${isLastToken ? 'read it as the boolean true' : `swallow the next token, '${tokenList[tokenIndex + 1]}', as its value`}`);
					}
					countByFlagName[flagName] = (countByFlagName[flagName] || 0) + 1;
				} else if (bareMatch) {
					const flagName = bareMatch[1];
					if (!isBareSwitchFlagName(flagName)) {
						return (
							`${prefixFor(actionLabel)} --${flagName} was given without '='. Parameters are typed --${flagName}=<value>; ` +
							`the space form hands the parser the NEXT token as the value (${isLastToken ? 'here there is none, so it would read as the boolean true' : `here '${tokenList[tokenIndex + 1]}'`}), which is how a flag or an action goes missing without a word.`
						);
					}
					if (!isLastToken) {
						return (
							`${prefixFor(actionLabel)} --${flagName} may be given bare only as the LAST token: anywhere else the parser takes ` +
							`the next token ('${tokenList[tokenIndex + 1]}') as its value. Give --${flagName}=<value>, or move the bare --${flagName} to the end.`
						);
					}
					countByFlagName[flagName] = (countByFlagName[flagName] || 0) + 1;
				} else if (switchWithValueMatch) {
					return `${prefixFor(actionLabel)} '${oneToken}': a switch takes no value (the parser would drop '=${switchWithValueMatch[2]}' and run -${switchWithValueMatch[1]} as if it were not there). Parameters take a double hyphen: --name=<value>.`;
				}
			}
			const repeatedFlagName = Object.keys(countByFlagName).find((flagName) => countByFlagName[flagName] > 1);
			if (repeatedFlagName) {
				return (
					`${prefixFor(actionLabel)} --${repeatedFlagName} was given ${countByFlagName[repeatedFlagName]} times. The parser keeps ` +
					`only the LAST and drops the others without a word, so a repeat is refused. A flag that takes a list takes ` +
					`it comma-separated: --${repeatedFlagName}=<a>,<b>.`
				);
			}
			return '';
		};

		// -----
		// switchesRefusal — every switch is known and true, and at most one names an action.
		const switchesRefusal = (switches, actionLabel) => {
			const switchNameList = Object.keys(switches);
			const notTrueSwitchName = switchNameList.find((switchName) => switches[switchName] !== true);
			if (notTrueSwitchName) {
				return `${prefixFor(actionLabel)} switch '${notTrueSwitchName}' must be true when given, got ${JSON.stringify(switches[notTrueSwitchName])}. A switch is present or absent; 'false' is a truthy string and is not read as off.`;
			}
			const unknownSwitchName = switchNameList.find((switchName) => !knownSwitchNameList.includes(switchName));
			if (unknownSwitchName) {
				return (
					`graphBuilder: unknown switch -${unknownSwitchName}. The actions are: ${actionSwitchNameList.map((switchName) => `-${switchName}`).join(', ')}; ` +
					`the other switches are ${actionRegistry.modifierSwitchNameList.concat(actionRegistry.helpSwitchNameList).map((switchName) => `-${switchName}`).join(', ')}. ` +
					`Parameters take a double hyphen (--name=<value>). See graphBuilder -help.`
				);
			}
			const namedActionList = switchNameList.filter((switchName) => actionSwitchNameList.includes(switchName));
			if (namedActionList.length > 1) {
				return `graphBuilder: more than one action: ${namedActionList.map((switchName) => `-${switchName}`).join(', ')}. One invocation runs one action; neither is chosen for you.`;
			}
			return '';
		};

		// -----
		// valuesRefusal — every values member is an array of non-blank strings (or true, for a declared bare flag on the
		// command line), and a single-value flag carries exactly one.
		const valuesRefusal = (values, actionLabel) => {
			const flagNameList = Object.keys(values);
			for (let flagIndex = 0; flagIndex < flagNameList.length; flagIndex++) {
				const flagName = flagNameList[flagIndex];
				const given = values[flagName];
				if (given === true && isBareSwitchFlagName(flagName)) {
					continue;
				}
				if (given === true) {
					return `${prefixFor(actionLabel)} --${flagName} was given with no value. Give --${flagName}=<value>, or leave the flag out.`;
				}
				if (!Array.isArray(given)) {
					return `${prefixFor(actionLabel)} 'values.${flagName}' must be an array of strings, got ${given === null ? 'null' : typeof given} (${JSON.stringify(given)}). Every parameter is a list, even of one: "${flagName}": ["<value>"].`;
				}
				if (given.length === 0) {
					return `${prefixFor(actionLabel)} --${flagName} was given with no value (an empty list). Read as absent, it would take the default behind the flag; give a value or leave it out.`;
				}
				const nonStringMember = given.find((oneMember) => typeof oneMember !== 'string');
				if (nonStringMember !== undefined) {
					return `${prefixFor(actionLabel)} --${flagName} carries a ${nonStringMember === null ? 'null' : Array.isArray(nonStringMember) ? 'list' : typeof nonStringMember} (${JSON.stringify(nonStringMember)}); every value is a string.`;
				}
				if (given.some((oneMember) => oneMember.trim() === '')) {
					return blankRefusal(actionLabel, flagName, given.length > 1 ? `one element of ${JSON.stringify(given)} is blank` : 'its value is an empty string');
				}
				if (given.length > 1 && isSingleValueFlagName(flagName)) {
					return (
						`${prefixFor(actionLabel)} --${flagName} was given ${given.length} values (${given.map((oneMember) => `'${oneMember}'`).join(', ')}). ` +
						`It names ONE path; the parser splits on commas, so a path containing a comma arrives in pieces and only the first would be read.`
					);
				}
			}
			return '';
		};

		// -----
		// operatorInputRefusal — the whole audit. commandLineTokenList is the raw argument list when the command line is
		// the channel, and [] when stdin replaced it (its tokens are then not the input and are not judged).
		const operatorInputRefusal = ({ commandLineParameters, commandLineTokenList }) => {
			const tokenRefusal = commandLineTokenRefusal(commandLineTokenList || []);
			if (tokenRefusal) {
				return tokenRefusal;
			}
			const switches = commandLineParameters.switches || {};
			const values = commandLineParameters.values || {};
			const fileList = commandLineParameters.fileList || [];
			const chosenActionName = Object.keys(switches).find((switchName) => actionSwitchNameList.includes(switchName));
			const actionLabel = chosenActionName ? `-${chosenActionName}` : '';
			const refusal = switchesRefusal(switches, actionLabel) || valuesRefusal(values, actionLabel);
			if (refusal) {
				return refusal;
			}
			if (!chosenActionName && (Object.keys(values).length > 0 || fileList.length > 0)) {
				return `graphBuilder: the input carries parameters but names no action. The actions are: ${actionSwitchNameList.map((switchName) => `-${switchName}`).join(', ')}. An invocation with no arguments at all prints the help; one with arguments and no action is refused, so a script never reads help prose as a result.`;
			}
			return '';
		};

		// -----
		// chosenActionSwitchName — after operatorInputRefusal admitted the input: the one action named, or '' for none.
		const chosenActionSwitchName = (switches) => Object.keys(switches || {}).find((switchName) => actionSwitchNameList.includes(switchName)) || '';

		const helpIsRequested = (switches) => actionRegistry.helpSwitchNameList.some((switchName) => (switches || {})[switchName] === true);

		return { operatorInputRefusal, chosenActionSwitchName, helpIsRequested, commandLineTokenRefusal, valuesRefusal, switchesRefusal };
	};

// END OF moduleFunction() ============================================================

// firstFlagValueOf — the per-flag reader every action uses after the entry admitted the input (the SECOND line of
// defence). Absent: undefined. A member that is not a list means the input reached an action without passing the
// entry's audit, which is a programming fault, so it throws rather than reading a string's first character.
const firstFlagValueOf = (commandLineParameters, flagName) => {
	const given = (commandLineParameters.values || {})[flagName];
	if (given === undefined) {
		return undefined;
	}
	if (!Array.isArray(given)) {
		throw new Error(`firstFlagValueOf: --${flagName} is ${JSON.stringify(given)}, not a list of values. Operator input reaches an action only through operator-input.js operatorInputRefusal, which refuses this shape by name; a caller that built commandLineParameters by hand must give every value as a list.`);
	}
	return given[0];
};

module.exports = moduleFunction({ moduleName });
module.exports.firstFlagValueOf = firstFlagValueOf;
