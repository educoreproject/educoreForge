'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// crypto is for createHash ONLY — the named set's identity is a digest of its own contents. BG-DET
// (test-bgReplay.js) forbids crypto.randomBytes in this directory, not crypto itself; decisionBlock.js
// hashes in the same fingerprint tree for the same reason. A digest of an input is a pure function of
// that input, which is precisely what this module is allowed to be.
const crypto = require('crypto');

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

// ⟪NAMED SUBJECT SET — 2026-09-10, OCEAN_SUMMIT, WORKORDER-namedSubjectSet-091026⟫
//
// A SECOND WAY TO NARROW A RUN, and it exists for a different job than --limit/--offset. The window is
// for DEBUGGING: give me any ten so I can watch the machinery. The named set is for MEASUREMENT: give me
// EXACTLY THESE, every time, so two runs produce numbers that can be compared to each other.
//
// tqii, 2026-09-10: "this mapping confidence problem isn't going to go away ever. The tooling to do this
// confidently will pay dividends." The occasion was retiring the Ed-Fi crosswalk as an answer key; the
// replacement is a frozen list of subjects a human has judged, and a frozen list is worth nothing if a
// run can quietly judge a different one.
//
// THE MARK IS THE LIST'S OWN DIGEST, not its filename and not its length. A filename can be moved, edited
// or reused; a length collides on the first day two sets are the same size. The sha256 of the canonical
// sorted list changes if a single id changes, which makes "did this run judge my set?" answerable from
// the block header alone, with no access to the file that produced it.
const NAMED_SET_MARK = 'NAMED_SET';

// namedSetDigest — sha256 over the CANONICAL form: sorted, de-duplicated, JSON. Sorted so the digest is a
// property of the SET rather than of the order someone happened to type it in; de-duplicated because a
// list naming the same subject twice names the same set as one that names it once, and two digests for
// one set would defeat the whole mechanism.
const canonicalSubjectIdList = (subjectStableIdList) =>
	[...new Set((subjectStableIdList || []).map((oneId) => `${oneId}`))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const namedSetDigest = (subjectStableIdList) =>
	crypto.createHash('sha256').update(JSON.stringify(canonicalSubjectIdList(subjectStableIdList)), 'utf8').digest('hex');

// hasNamedSet — the one place that decides whether a caller asked for a named set at all. An EMPTY array
// is NOT "no named set": it is an operator who asked for nothing, and it is refused below rather than
// silently promoted into a full run over every subject in the standard.
const hasNamedSet = (subjectStableIdList) => Array.isArray(subjectStableIdList);

const namedSetShapeError = (subjectStableIdList) => {
	if (!Array.isArray(subjectStableIdList)) {
		return `${moduleName}: subjectStableIdList must be an ARRAY of stableId strings (got ${JSON.stringify(subjectStableIdList)}).`;
	}
	if (subjectStableIdList.length === 0) {
		return (
			`${moduleName}: subjectStableIdList is EMPTY. An empty named set is refused, never promoted into a ` +
			`full run — "judge nothing" and "judge everything" are opposite instructions and must not share a spelling.`
		);
	}
	const badIndex = subjectStableIdList.findIndex((oneId) => typeof oneId !== 'string' || oneId.trim() === '');
	if (badIndex !== -1) {
		return (
			`${moduleName}: subjectStableIdList[${badIndex}] is ${JSON.stringify(subjectStableIdList[badIndex])}, ` +
			`which is not a non-empty stableId string. The list is refused whole rather than filtered — a set that ` +
			`silently drops its malformed members is a different set wearing the same name.`
		);
	}
	return '';
};

// applyNamedSubjectSet — sort, then FILTER TO THE NAMED IDS. Returns { sourceNodes, namedSet } or { error }.
//
// ⟪AN ABSENT ID REFUSES THE WHOLE RUN⟫ and this is the load-bearing rule. The failure this prevents is not
// dramatic: the standard is re-forged, three subjects are renamed, the evaluation set silently becomes 97
// subjects, and every number after that is compared against numbers from 100. Nothing errors, nothing looks
// wrong, and the drift is invisible in the one place anybody reads — the score. So: name the absent ids and
// refuse. The same discipline bridge-framework.js:986 already applies to a plugin's declared scope.
const applyNamedSubjectSet = (sourceNodes, { subjectStableIdList } = {}) => {
	const shapeError = namedSetShapeError(subjectStableIdList);
	if (shapeError) {
		return { error: shapeError };
	}
	const requested = canonicalSubjectIdList(subjectStableIdList);
	const available = (sourceNodes || []).length;
	const nodeByStableId = new Map();
	(sourceNodes || []).forEach((oneNode) => {
		const stableId = `${(oneNode && oneNode.stableId) || ''}`;
		if (stableId !== '' && !nodeByStableId.has(stableId)) {
			nodeByStableId.set(stableId, oneNode);
		}
	});
	const absentList = requested.filter((oneId) => !nodeByStableId.has(oneId));
	if (absentList.length !== 0) {
		return {
			error:
				`${moduleName}: the named subject set names ${absentList.length} stableId(s) that this run's source ` +
				`population (${available} element(s)) does not contain — first absent: ${JSON.stringify(absentList[0])}` +
				`${absentList.length > 1 ? ` (and ${absentList.length - 1} more)` : ''}. The run is refused rather than ` +
				`narrowed: a measurement set that quietly shrinks produces numbers nobody can compare, and the shrinkage ` +
				`is invisible in the only artifact anyone reads.`,
		};
	}
	// Sorted by stableId, exactly as applySourceWindow sorts, and for the same reason: the order a graph read
	// happens to produce is not an order at all. Both selectors therefore hand the framework the same sequence
	// for the same subjects, so a named set and a window over the same ids judge them in the same order.
	const selected = requested.map((oneId) => nodeByStableId.get(oneId));
	return {
		sourceNodes: selected,
		namedSet: { requested: requested.length, selected: selected.length, availableFrom: available, digest: namedSetDigest(requested) },
	};
};

// namedSetMarkFor — the generation suffix for a named-set run. Computed from the REQUESTED list, before any
// data is read, for the same reason windowMarkFor is: the generation keys the judgment cache and stamps the
// frozen block, so it must be knowable at the start of the run and identical on a re-run.
const namedSetMarkFor = ({ subjectStableIdList } = {}) =>
	hasNamedSet(subjectStableIdList) && subjectStableIdList.length !== 0
		? `${NAMED_SET_MARK}_${namedSetDigest(subjectStableIdList)}`
		: undefined;

// bothSelectorsRefusalText — a named set AND a window is refused BY NAME rather than composed. The two could
// be composed ("the first ten of my hundred"), and the composition is even meaningful — but it is meaningful
// in TWO different ways (ten of the named set, or the named set intersected with a slice of the standard),
// and an operator who wanted one and got the other would have no way to tell from the block. When a
// composition has two honest readings, refuse it until somebody names which one they meant.
const bothSelectorsRefusalText = ({ limit, offset }) =>
	`${moduleName}: a named subject set cannot be combined with --limit/--offset (got limit=${limit === undefined ? 'none' : limit}, ` +
	`offset=${offset === undefined ? 'none' : offset}). The window is for DEBUGGING (any ten will do) and the named set is for ` +
	`MEASUREMENT (exactly these, every time); composing them has two honest readings and the block header could not say which ` +
	`was meant. Refused by name — pass one or the other.`;

// applySourceSelection — THE ONE ENTRY POINT the framework calls. It dispatches to the named set or the
// window, and refuses the combination. Having one door means a third selector added later cannot be wired
// into one call site and forgotten at the other; the framework asks "narrow this list" and never learns how.
const applySourceSelection = (sourceNodes, { limit, offset, subjectStableIdList } = {}) => {
	const windowRequested =
		(limit !== undefined && limit !== null && `${limit}` !== '') || (offset !== undefined && offset !== null && `${offset}` !== '');
	if (hasNamedSet(subjectStableIdList)) {
		if (windowRequested) {
			return { error: bothSelectorsRefusalText({ limit, offset }) };
		}
		return applyNamedSubjectSet(sourceNodes, { subjectStableIdList });
	}
	return applySourceWindow(sourceNodes, { limit, offset });
};

// sourceSelectionMarkFor — the generation suffix for whichever selector was asked for. Same refusal.
const sourceSelectionMarkFor = ({ limit, offset, subjectStableIdList } = {}) => {
	if (hasNamedSet(subjectStableIdList) && subjectStableIdList.length !== 0) {
		return namedSetMarkFor({ subjectStableIdList });
	}
	return windowMarkFor({ limit, offset });
};

// describeNamedSet — the operator line, carrying the same PARTIAL warning the window carries, because the
// hazard is identical: a block frozen from 100 of 1,904 subjects is indistinguishable from a complete one
// once it is stored, and materialise replays whatever block exists, verbatim, forever.
const describeNamedSet = (namedSet) =>
	namedSet
		? `NAMED SUBJECT SET ACTIVE — judging exactly ${namedSet.selected} named of ${namedSet.availableFrom} source ` +
			`element(s), digest ${namedSet.digest.slice(0, 12)}…, sorted by stableId. THE RESULTING DECISION BLOCK IS ` +
			`PARTIAL and its generation says so; it must not be mistaken for full coverage of this pairing.`
		: '';

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
	const windowFound = generation.match(new RegExp(`${WINDOW_MARK}_limit(?:\\d+|none)_offset\\d+`));
	if (windowFound) {
		return windowFound[0];
	}
	// ⟪2026-09-10⟫ the named-set mark is read back by the SAME function, because every reader of a stored
	// block asks one question — "is this block partial, and by what narrowing?" — and a second reader for a
	// second mark would be a second place to forget. materialiser.js compares marks by equality, so a
	// NAMED_SET block automatically refuses to materialise under a full or differently-named run.
	const namedFound = generation.match(new RegExp(`${NAMED_SET_MARK}_[0-9a-f]{64}`));
	return namedFound ? namedFound[0] : undefined;
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
	NAMED_SET_MARK,
	applySourceWindow,
	applyNamedSubjectSet,
	applySourceSelection,
	namedSetDigest,
	namedSetShapeErrorFor: namedSetShapeError,
	namedSetMarkFor,
	sourceSelectionMarkFor,
	describeNamedSet,
	bothSelectorsRefusalText,
	windowMarkFor,
	generationWithWindowMark,
	windowMarkFromGeneration,
	describeWindow,
	parsePositiveInteger,
};
