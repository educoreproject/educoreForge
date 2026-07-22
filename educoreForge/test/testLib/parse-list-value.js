'use strict';

// parse-list-value.js — turn a qtools commandLineParameters VALUES array into a clean token list.
//
// CODE FACT (burned 2026-07-22): qtools-parse-command-line SPLITS comma-separated values into
// array entries — `--standard=ceds,lif` arrives as ['ceds','lif'], already split. Consuming only
// element [0] silently drops every value after the first; a "both standards" integration run
// forged one standard and passed all its gates about the wrong thing. This helper consumes the
// WHOLE array; the flatMap split is belt-and-braces for any channel that didn't pre-split
// (JSON-on-stdin hands values through verbatim).
//
//   parseListValue(values, defaults) -> string[]
//     values:   the commandLineParameters.values.<name> array (may be undefined/empty)
//     defaults: the list to use when no values were given at all

const parseListValue = (values, defaults = []) =>
	(values && values.length ? values : defaults)
		.flatMap((oneValue) => String(oneValue).split(','))
		.map((oneToken) => oneToken.trim())
		.filter(Boolean);

module.exports = { parseListValue };
