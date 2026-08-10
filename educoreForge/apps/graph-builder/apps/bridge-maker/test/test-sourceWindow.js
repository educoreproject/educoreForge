#!/usr/bin/env node
'use strict';

// test-sourceWindow.js — hermetic gate for the DEBUG WINDOW (--limit / --offset) over a bridge's
// source elements (bridgeMakers Item 2, 2026-08-10).
//
// What it proves:
//   1. THE ACCEPT-CONTROL, FIRST — no window requested means the list is returned UNTOUCHED and
//      UNSORTED, so an ordinary run is byte-for-byte what it was before this module existed. Without
//      this, "the window works" would be unfalsifiable: a module that always sorted and sliced would
//      pass every other assertion here.
//   2. THE SLICE — limit alone, offset alone, and the two composed, over a known list.
//   3. SORTED FIRST — the same window over a SHUFFLED input selects the SAME elements. This is the
//      point of the sort: a graph read has no guaranteed order, and an offset over an unstable order
//      would land somewhere different every run, which is useless for the debugging it exists for.
//   4. REFUSE-BY-NAME — malformed values, and a window selecting ZERO (offset at or past the end).
//      An empty windowed run must never be judged as silence.
//   5. THE PARTIAL MARK — a windowed run's generation says it is partial, and the mark reads back out
//      of a stored generation. A block frozen from 10 of 214 is otherwise indistinguishable from a
//      complete one, and MATERIALIZE would replay those ten forever as if they were the pairing.
//
// PURE / hermetic: no Neo4j, no network, no LLM, no filesystem.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-sourceWindow.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the --limit / --offset source window

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves an unwindowed run is untouched, that the slice is correct and reproducible over a
     shuffled input, that malformed and empty windows are refused by name, and that a windowed run's
     decision-block generation declares itself PARTIAL.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const {
	WINDOW_MARK,
	applySourceWindow,
	windowMarkFor,
	generationWithWindowMark,
	windowMarkFromGeneration,
	describeWindow,
} = require('../lib/sourceWindow');

const buildStatics = require('../../../lib/build');

// A known list: stableIds e000..e019, deliberately created OUT of order so any assertion that
// depends on the sort is really testing the sort.
const ordered = Array.from({ length: 20 }, (unusedValue, i) => ({ stableId: `e${String(i).padStart(3, '0')}` }));
const shuffled = [...ordered].reverse();
const ids = (list) => list.map((one) => one.stableId).join(',');

// =====================================================================
harness.section('THE ACCEPT-CONTROL — no window means UNTOUCHED, not merely unsliced');
// =====================================================================

const noWindow = applySourceWindow(shuffled, {});
harness.equal('no window returns every element', noWindow.sourceNodes.length, 20);
harness.equal('no window reports no window', noWindow.window, undefined);
harness.equal(
	'the list is returned UNSORTED — an ordinary run is unchanged by this module existing',
	ids(noWindow.sourceNodes),
	ids(shuffled),
);
harness.ok('the same array identity or an equal one, never a reordering', noWindow.sourceNodes[0].stableId === 'e019');
harness.equal('undefined options behave as no window', applySourceWindow(shuffled).window, undefined);

// =====================================================================
harness.section('THE SLICE — limit, offset, and the two composed');
// =====================================================================

const limited = applySourceWindow(ordered, { limit: 3 });
harness.equal('limit=3 selects three', ids(limited.sourceNodes), 'e000,e001,e002');
harness.equal('...and reports the window', JSON.stringify(limited.window), JSON.stringify({ limit: 3, offset: 0, selected: 3, availableFrom: 20 }));

const offsetOnly = applySourceWindow(ordered, { offset: 17 });
harness.equal('offset=17 with no limit runs to the end', ids(offsetOnly.sourceNodes), 'e017,e018,e019');

const composed = applySourceWindow(ordered, { limit: 4, offset: 10 });
harness.equal('limit=4 offset=10 selects elements 11-14', ids(composed.sourceNodes), 'e010,e011,e012,e013');
harness.equal('...selected count is reported', composed.window.selected, 4);
harness.equal('...against the ORIGINAL population, not the slice', composed.window.availableFrom, 20);

const overrun = applySourceWindow(ordered, { limit: 500, offset: 18 });
harness.equal('a limit past the end takes what remains rather than refusing', ids(overrun.sourceNodes), 'e018,e019');

harness.equal('string values are accepted (the CLI hands strings)', ids(applySourceWindow(ordered, { limit: '2' }).sourceNodes), 'e000,e001');
harness.equal('offset=0 is a real value, not "absent"', applySourceWindow(ordered, { offset: 0 }).window.offset, 0);

// =====================================================================
harness.section('SORTED FIRST — the same window over a SHUFFLED input picks the SAME elements');
// =====================================================================

harness.equal(
	'limit=4 offset=10 over a REVERSED list selects identically',
	ids(applySourceWindow(shuffled, { limit: 4, offset: 10 }).sourceNodes),
	ids(composed.sourceNodes),
);
const scrambled = [ordered[7], ordered[2], ordered[19], ordered[0], ordered[11]];
harness.equal(
	'an arbitrary scramble of five sorts before slicing',
	ids(applySourceWindow(scrambled, { limit: 2 }).sourceNodes),
	'e000,e002',
);
// THE SAME SET in three different orders must give the SAME window. (An earlier draft of this
// assertion compared windows over two DIFFERENT populations — 20 elements against 25 with duplicates
// — and failed correctly: different inputs, different answers. The claim being tested is that ORDER
// does not matter, so every arm must carry the identical set.)
const rotated = ordered.slice(7).concat(ordered.slice(0, 7));
const interleaved = ordered.filter((unusedValue, i) => i % 2 === 0).concat(ordered.filter((unusedValue, i) => i % 2 === 1));
const windowOf = (list) => ids(applySourceWindow(list, { limit: 6, offset: 3 }).sourceNodes);
harness.equal('THE SAME SET, ROTATED, GIVES THE SAME WINDOW', windowOf(rotated), windowOf(ordered));
harness.equal('...interleaved, the same again', windowOf(interleaved), windowOf(ordered));
harness.equal('...reversed, the same again — order genuinely does not matter', windowOf(shuffled), windowOf(ordered));
harness.equal('...and it is the window the sort predicts', windowOf(ordered), 'e003,e004,e005,e006,e007,e008');

// =====================================================================
harness.section('REFUSE-BY-NAME — malformed, and the empty window');
// =====================================================================

const refusals = [
	['limit is not a number', { limit: 'abc' }, /limit must be a whole number/],
	['limit is fractional', { limit: '1.5' }, /limit must be a whole number/],
	['limit is negative', { limit: '-3' }, /limit must be a whole number/],
	['limit is zero', { limit: 0 }, /limit must be at least 1/],
	['offset is not a number', { offset: 'ten' }, /offset must be a whole number/],
	['offset is negative', { offset: '-1' }, /offset must be a whole number/],
];
refusals.forEach(([label, options, pattern]) => {
	const refusal = applySourceWindow(ordered, options);
	harness.ok(`refused: ${label}`, !!refusal.error);
	harness.match(`...by name: ${label}`, refusal.error, pattern);
	harness.equal(`...and no nodes are returned: ${label}`, refusal.sourceNodes, undefined);
});

const empty = applySourceWindow(ordered, { offset: 20 });
harness.ok('an offset AT the end selects zero and is REFUSED', !!empty.error);
harness.match('...naming the counts so the operator can correct it', empty.error, /selected ZERO of 20/);
harness.match('...and stating it is not silence', empty.error, /never judged as silence/);
harness.ok('an offset PAST the end is refused too', !!applySourceWindow(ordered, { offset: 999 }).error);

// =====================================================================
harness.section('THE PARTIAL MARK — a windowed block declares itself');
// =====================================================================

const BASE = 'sifEvidenceBridge-evidence-v6';

harness.equal('no window leaves the generation alone', windowMarkFor({}), undefined);
harness.equal('...and generationWithWindowMark is then the identity', generationWithWindowMark(BASE, undefined), BASE);

const mark = windowMarkFor({ limit: 10, offset: 50 });
harness.match('a windowed run mints a mark naming the REQUEST', mark, /^PARTIAL_WINDOW_limit10_offset50$/);
harness.match('...and the mark shouts PARTIAL', mark, new RegExp(WINDOW_MARK));
harness.equal('limit alone defaults the offset to 0 in the mark', windowMarkFor({ limit: 10 }), 'PARTIAL_WINDOW_limit10_offset0');
harness.equal('offset alone records no limit rather than inventing one', windowMarkFor({ offset: 5 }), 'PARTIAL_WINDOW_limitnone_offset5');

const windowedGeneration = generationWithWindowMark(BASE, mark);
harness.ok('the base generation stays legible inside the marked one', windowedGeneration.indexOf(BASE) === 0);
harness.equal(
	'the mark READS BACK OUT of a stored generation — a plain build has no window to ask',
	windowMarkFromGeneration(windowedGeneration),
	mark,
);
harness.equal('a full generation reads back as no mark', windowMarkFromGeneration(BASE), undefined);
harness.equal('a missing generation yields no mark rather than throwing', windowMarkFromGeneration(undefined), undefined);
harness.ok(
	'two DIFFERENT windows are DIFFERENT generations, never two blocks claiming to be the same',
	windowMarkFor({ limit: 10, offset: 0 }) !== windowMarkFor({ limit: 10, offset: 50 }),
);
harness.match('the operator line names the counts and the partiality', describeWindow(composed.window), /judging 4 of 20 .*PARTIAL/s);
harness.equal('no window produces no operator line', describeWindow(undefined), '');

// =====================================================================
harness.section('THE CLI RESOLVER — where the values come from, and the eager refusal');
// =====================================================================

const cli = ({ values = {} }) => ({ values, switches: {} });
harness.equal(
	'absent flags resolve to an undefined window',
	JSON.stringify(buildStatics.resolveSourceWindow({}, cli({}))),
	JSON.stringify({ value: { limit: undefined, offset: undefined } }),
);
harness.equal(
	'--limit=10 --offset=50 resolve',
	JSON.stringify(buildStatics.resolveSourceWindow({}, cli({ values: { limit: ['10'], offset: ['50'] } })).value),
	JSON.stringify({ limit: 10, offset: 50 }),
);
harness.equal(
	'deps injection OUTRANKS the command line',
	buildStatics.resolveSourceWindow({ limit: 3 }, cli({ values: { limit: ['10'] } })).value.limit,
	3,
);
const eager = buildStatics.resolveSourceWindow({}, cli({ values: { limit: ['abc'] } }));
harness.ok('a malformed --limit is refused EAGERLY, before any forging', !!eager.error);
harness.match('...naming the flag as the operator typed it', eager.error, /--limit must be a whole number/);
harness.ok(
	'a malformed --offset is refused eagerly too',
	/--offset must be a whole number/.test(buildStatics.resolveSourceWindow({}, cli({ values: { offset: ['x'] } })).error || ''),
);

harness.report();
