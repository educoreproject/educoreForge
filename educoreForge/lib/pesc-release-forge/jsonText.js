'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// jsonText.js — parseJsonText(text) → { value } | { error: string }.
//
// The ONE throw-to-value adapter in this library: JSON.parse reports bad input only by throwing,
// so this converts its throw into a returned value and nothing else. It is the same adapter, in the
// same shape, as lib/bridge-framework/decisionBlock.js parseJsonText; it is written again here
// because a forge library does not require the bridge framework.

const parseJsonText = (text) => {
	let value = null;
	let parseFault = '';
	const attempt = () => {
		value = JSON.parse(text);
	};
	try {
		attempt();
	} catch (parseError) {
		parseFault = parseError.message;
	}
	return parseFault ? { error: parseFault } : { value };
};

module.exports = { parseJsonText, moduleName };
