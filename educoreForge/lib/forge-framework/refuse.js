'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// refuse.js — the ONE shape every framework refusal is built with (SPEC-forgeFramework-v1.md §3.3,
// Profile §7.1). The house form is the forger's own (`forger.js:106-108,186-195`):
//
//     <moduleName> REFUSED: <what> — <where it belongs / which line to fix>
//
// PURE and synchronous: these helpers RETURN an Error (or null); the caller decides whether to
// throw it (inside the pure layer, under the framework's ONE adapter) or to hand its message to a
// callback (on the orchestration side). No I/O, no channel, no clock.
//
// The three helpers cover the three refusal shapes the framework performs everywhere:
//   byName        — a fully composed refusal naming WHAT and WHERE
//   requiredKeys  — the FIRST missing required property of an object, named
//   closedValue   — a value outside a closed enumeration, naming the value and the allowed list

const byName = ({ moduleName: refusingModuleName, what, where }) =>
	new Error(`${refusingModuleName} REFUSED: ${what} — ${where}`);

const requiredKeys = ({ moduleName: refusingModuleName, objectName, object, requiredKeyList }) => {
	if (object === null || typeof object !== 'object') {
		return byName({
			moduleName: refusingModuleName,
			what: `${objectName} is ${object === null ? 'null' : `a ${typeof object}`}, not an object`,
			where: `pass ${objectName} as an object carrying ${requiredKeyList.join(', ')}`,
		});
	}
	const firstMissingName = requiredKeyList.find(
		(oneRequiredName) => object[oneRequiredName] === undefined,
	);
	if (firstMissingName === undefined) {
		return null;
	}
	return byName({
		moduleName: refusingModuleName,
		what: `${objectName} is missing required property '${firstMissingName}'`,
		where: `${objectName} must carry ${requiredKeyList.join(', ')}; absent is absent, never defaulted`,
	});
};

const closedValue = ({ moduleName: refusingModuleName, name, value, allowedValueList }) => {
	if (allowedValueList.indexOf(value) !== -1) {
		return null;
	}
	return byName({
		moduleName: refusingModuleName,
		what: `${name} '${value}' is not one of: ${allowedValueList.join(', ')}`,
		where: `${name} is a closed enumeration; declare one of the listed values`,
	});
};

module.exports = { byName, requiredKeys, closedValue, moduleName };
