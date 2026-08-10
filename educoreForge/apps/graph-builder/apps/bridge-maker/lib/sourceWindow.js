'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sourceWindow.js — the DEBUG WINDOW over a bridge's source elements: --limit and --offset.
//
// tqii, 2026-08-10: "I want to be able to limit the bridges processed/created. If I ask for
// SIF.StudentPersonals and say limit=10, I want only 10 of 214 elements processed. While we are at
// it, lets add --offset as well so we can skip around for debugging."
//
// WHY IT IS SHARED. Every evidence bridge walks its own source list, so a window written into one
// bridge would be a window only that standard has. This module is required by all three, for the
// same reason the debug-mark helpers were consolidated: three copies of a convention are three
// chances for it to drift, and a half-updated convention is worse than none.
//
// ⟪THE ORDER IS SORTED FIRST, AND THAT IS NOT A DETAIL⟫. sourceWalker returns whatever order the
// graph read produced; nothing sorts it. An OFFSET over an unstable order is meaningless — the same
// --offset=50 would land on different elements from run to run, so a debugging session could never
// return to the element it was looking at, which is the entire point of having an offset. The window
// therefore sorts by stableId (a total order, present on every forged element) BEFORE slicing.
// Sorting costs nothing at these sizes and makes --limit/--offset reproducible by construction.
//
// ⟪A WINDOWED RUN PRODUCES A PARTIAL DECISION BLOCK, AND IT MUST SAY SO⟫. This is the hazard, and it
// is the same shape as the debug judge's: a block frozen from 10 of 214 elements is INDISTINGUISHABLE
// from a complete one once it is stored, and MATERIALIZE replays whatever block exists, verbatim,
// forever. A later plain build would write ten edges and report success — silent, durable
// under-coverage presented as a finished pairing. So a windowed run stamps its generation
// (windowMarkFor / generationWithWindowMark), exactly as a debug run stamps its own, and the mark
// records the window that produced it.
//
// Refuse-by-value throughout (polyArch2 §6): a malformed limit or offset, or a window that selects
// ZERO elements, is refused BY NAME. An empty windowed run is never judged as silence — the
// CASE-RULE lesson, and the same discipline applySifObjectScope applies to its own scope.
//
// PURE: no graph, no network, no clock, no randomness.
//
// @concept: [[DebugSourceWindow]]

// WINDOW_MARK — the generation suffix a windowed run carries. Deliberately shouty and deliberately
// contains 'PARTIAL', because that is the property a reader must not miss: the block is not wrong,
// it is INCOMPLETE, and incompleteness is the thing that reads as completeness if unlabelled.
const WINDOW_MARK = 'PARTIAL_WINDOW';

// parsePositiveInteger — a shared reader for both knobs. Refuses anything that is not a
// non-negative whole number, BY NAME, rather than coercing: '10abc', 1.5, '-3' and true are all
// mistakes an operator wants told about, not silently rounded into a different run.
const parsePositiveInteger = ({ value, name, minimum }) => {
	if (value === undefined || value === null || value === '') {
		return { value: undefined };
	}
	const asString = `${value}`.trim();
	if (!/^\d+$/.test(asString)) {
		return {
			error:
				`${moduleName}: ${name} must be a whole number (got ${JSON.stringify(value)}) — there is no ` +
				`default coercion; a malformed window is refused rather than rounded into a different run.`,
		};
	}
	const parsed = parseInt(asString, 10);
	if (parsed < minimum) {
		return {
			error: `${moduleName}: ${name} must be at least ${minimum} (got ${parsed}).`,
		};
	}
	return { value: parsed };
};

// applySourceWindow — sort, then slice. Returns { sourceNodes, window } or { error }.
//   window is undefined when no window was requested (the ordinary full run, untouched).
//   window is { limit, offset, selected, availableFrom } when one was.
const applySourceWindow = (sourceNodes, { limit, offset } = {}) => {
	const limitResolution = parsePositiveInteger({ value: limit, name: 'limit', minimum: 1 });
	if (limitResolution.error) {
		return { error: limitResolution.error };
	}
	const offsetResolution = parsePositiveInteger({ value: offset, name: 'offset', minimum: 0 });
	if (offsetResolution.error) {
		return { error: offsetResolution.error };
	}
	const resolvedLimit = limitResolution.value;
	const resolvedOffset = offsetResolution.value;

	if (resolvedLimit === undefined && resolvedOffset === undefined) {
		return { sourceNodes }; // no window asked for: the list is returned UNSORTED and untouched,
		// so an ordinary run is byte-for-byte what it was before this module existed.
	}

	const available = (sourceNodes || []).length;
	// stableId is the total order. localeCompare would be locale-dependent; a plain < / > on the
	// string is deterministic everywhere, which is what reproducibility needs.
	const sorted = [...(sourceNodes || [])].sort((a, b) => {
		const ka = `${(a && a.stableId) || ''}`;
		const kb = `${(b && b.stableId) || ''}`;
		return ka < kb ? -1 : ka > kb ? 1 : 0;
	});
	const from = resolvedOffset === undefined ? 0 : resolvedOffset;
	const windowed = resolvedLimit === undefined ? sorted.slice(from) : sorted.slice(from, from + resolvedLimit);

	if (windowed.length === 0) {
		return {
			error:
				`${moduleName}: the window (limit=${resolvedLimit === undefined ? 'none' : resolvedLimit}, ` +
				`offset=${from}) selected ZERO of ${available} source element(s) — the offset is at or past ` +
				`the end of the list. An empty windowed run is refused, never judged as silence.`,
		};
	}

	return {
		sourceNodes: windowed,
		window: { limit: resolvedLimit, offset: from, selected: windowed.length, availableFrom: available },
	};
};

// windowMarkFor — the generation suffix for a windowed run, or undefined for a full one. It NAMES
// the window, so two partial blocks over different slices are different generations rather than two
// things claiming to be the same one.
//
// IT IS COMPUTED FROM THE REQUESTED limit/offset, NOT from the resolved counts, and deliberately: the
// generation is fixed at the START of a rebridge (it keys the judgment cache and stamps the frozen
// block) while the selected/available counts are only known after the source walk. Naming the REQUEST
// keeps the generation deterministic and computable before any data is read; the measured counts go
// to the run log and the returned report, where a number that varies belongs.
const windowMarkFor = ({ limit, offset } = {}) => {
	const hasLimit = limit !== undefined && limit !== null && `${limit}` !== '';
	const hasOffset = offset !== undefined && offset !== null && `${offset}` !== '';
	if (!hasLimit && !hasOffset) {
		return undefined;
	}
	return `${WINDOW_MARK}_limit${hasLimit ? limit : 'none'}_offset${hasOffset ? offset : 0}`;
};

const generationWithWindowMark = (generation, windowMark) => (windowMark ? `${generation}-${windowMark}` : generation);

// windowMarkFromGeneration — read back OUT of a stored block, for the same reason the debug mark is:
// a plain build replaying a partial block has no window to ask about, and must still know the block
// is partial.
const windowMarkFromGeneration = (generation) => {
	if (typeof generation !== 'string') {
		return undefined;
	}
	const found = generation.match(new RegExp(`${WINDOW_MARK}_limit(?:\\d+|none)_offset\\d+`));
	return found ? found[0] : undefined;
};

// describeWindow — one operator-facing line, so a windowed run announces itself in the run log
// rather than looking like an ordinary short standard.
const describeWindow = (window) =>
	window
		? `SOURCE WINDOW ACTIVE — judging ${window.selected} of ${window.availableFrom} source element(s) ` +
			`(limit=${window.limit === undefined ? 'none' : window.limit}, offset=${window.offset}), sorted by ` +
			`stableId so the same window is reproducible. THE RESULTING DECISION BLOCK IS PARTIAL and its ` +
			`generation says so; it must not be mistaken for full coverage of this pairing.`
		: '';

module.exports = {
	WINDOW_MARK,
	applySourceWindow,
	windowMarkFor,
	generationWithWindowMark,
	windowMarkFromGeneration,
	describeWindow,
	parsePositiveInteger,
};
