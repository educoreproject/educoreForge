'use strict';

// required-setting.js — read ONE required path setting from graphBuilder.ini, or refuse it by name.
//
// Deep review 2026-11-21, Build 13 (F-37): thirteen paths under /Users/tqwhite were written into the code as defaults.
// The code is deployed to a server where those paths do not exist, so the day a build ran there each default would
// have pointed at nothing, or created a fresh, empty home (a second build-log tree, a cold vector cache) without a
// word. Each is now a SETTING: present and non-blank in its section, or the run is refused naming the section, the
// key, the file it was looked for in, and what the path is for. There is no default and no derivation from the code's
// own location (a worktree resolves its /system/ to the real one, which T0 section 5 names as a trap).
//
//   readRequiredSetting({ getConfig, sectionName, settingName, whatItNames, askedBy }) -> { value } | { error }
//     getConfig    process.global.getConfig (startup.js loadConfig), or a test's double
//     sectionName  the ini section, e.g. 'stores'
//     settingName  the key, e.g. 'buildLogsDirPath'
//     whatItNames  one clause: what the path is for, so the operator knows what to put there
//     askedBy      who is asking ('graphBuilder build', 'rdf-independent-check'), for the refusal's prefix
//
// It never throws for an absent or blank setting (the caller routes { error } through its callback); a missing
// argument from the CALLER is a programming fault and throws.

const CONFIG_FILE_DESCRIPTION = 'graphBuilder.ini (system/configs/instanceSpecific/<host>/graphBuilder.ini, found by startup.js discovery)';

const readRequiredSetting = ({ getConfig, sectionName, settingName, whatItNames, askedBy } = {}) => {
	if (typeof sectionName !== 'string' || typeof settingName !== 'string' || typeof whatItNames !== 'string' || typeof askedBy !== 'string') {
		throw new Error('readRequiredSetting: sectionName, settingName, whatItNames and askedBy (strings) are required; they are caller constants, so their absence is a programming fault.');
	}
	if (typeof getConfig !== 'function') {
		return { error: `${askedBy}: [${sectionName}] ${settingName} cannot be read: no configuration is loaded (process.global.getConfig is absent). It names ${whatItNames}, and there is no default.` };
	}
	const sectionValues = getConfig(sectionName) || {};
	const settingValue = sectionValues[settingName];
	if (settingValue === undefined) {
		return {
			error:
				`${askedBy}: [${sectionName}] ${settingName} is absent from ${CONFIG_FILE_DESCRIPTION}. It names ${whatItNames}. ` +
				`There is NO DEFAULT (deep review 2026-11-21, F-37: the old default was a path on one Mac). ` +
				`Add the line '${settingName}=<absolute path>' to the [${sectionName}] section.`,
		};
	}
	if (typeof settingValue !== 'string' || settingValue.trim() === '') {
		return { error: `${askedBy}: [${sectionName}] ${settingName} is present in ${CONFIG_FILE_DESCRIPTION} but ${typeof settingValue === 'string' ? 'BLANK' : `not a path (${JSON.stringify(settingValue)})`}. It names ${whatItNames}. Name a path or remove the key; it is not guessed at.` };
	}
	return { value: settingValue };
};

module.exports = { readRequiredSetting, CONFIG_FILE_DESCRIPTION };
