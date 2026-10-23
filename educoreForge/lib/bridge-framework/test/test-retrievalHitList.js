#!/usr/bin/env node
'use strict';

// test-retrievalHitList.js — zeroBacklog lane B (C), the frozen-block size fix (BRONZE_CROWN ruling, 2026-10-23): embedTextVote-v1's frozen
// trace stored every path of every pool card in full, and a path's four hit fields (the subject's embed text, its property names, the hub
// text it hit, the cosine) repeat across cards: on the B3 rehearsal's sif260928→ctdl block, record 0's 120 paths shared 8 distinct hits,
// and that block reached 506 MB of V8's ~537 MB string ceiling. Each record now carries its hits ONCE, in retrievalHitList, and each path
// names its hit by index beside the fields that are the path's own (baseStableId, baseKind, edgeType). Nothing is dropped: expanding the
// paths reproduces the old full path objects exactly.
//
// PROVES:
//   (a) frozenRetrievalVoteListFor returns retrievalVoteList AND retrievalHitList; each hit appears once, in first-seen order
//   (b) each frozen path is exactly { hitIndex, baseStableId, baseKind, edgeType }
//   (c) LOSSLESS: expandedRetrievalPathListFor rebuilds, for every card, the full path list the old form froze, byte-identical in canonical
//       text (field order embedTextStableId, propertyNameList, hitTextStableId, baseStableId, baseKind, edgeType, cosine)
//   (d) SMALLER: on 40 cards x 4 paths sharing 8 hits, the slim canonical text is under half the old one
//   (e) the method row declares retrievalHitList among its record trace fields, so the framework writes it into every record
//   (f) a path whose hitIndex names no hit, or a hit list that is not a list, is refused by name on expansion

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: embedTextVote-v1's frozen paths name their hit by index; the expansion is lossless and the text is smaller
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const registryLib = require('../candidateRetrievalMethodRegistry');
const { canonicalJsonText } = require('../bridgePluginContract');

const HUB_NAME = 'TOYHUB';
const HIT_COUNT = 8;
const CARD_COUNT = 40;
const PATHS_PER_CARD = 4;

// the hits: (subject embed text, its property names, the hub text it hit, cosine), each long like the real stableIds
const hitFor = (hitIndex) => ({
	embedTextStableId: `source:root/embedText/${String(hitIndex).padStart(64, 'a')}`,
	propertyNameList: hitIndex % 2 === 0 ? ['description'] : ['name', 'description'],
	hitTextStableId: `toyhub:root/embedText/${String(hitIndex).padStart(64, 'b')}`,
	cosine: 0.5 + hitIndex / 100,
});
const SLOT_KIND_LIST = Object.keys(registryLib.HUB_SLOT_BY_SLOT_KIND);
const rankedList = Array.from({ length: CARD_COUNT }, (unused, cardIndex) => ({
	bestCosine: 0.6,
	cardTextCosine: 0.55,
	cardTextWinningTextStableId: `source:root/embedText/${'c'.repeat(64)}`,
	ownVotes: PATHS_PER_CARD,
	pathList: Array.from({ length: PATHS_PER_CARD }, (unusedPath, pathIndex) => {
		const oneHit = hitFor((cardIndex + pathIndex) % HIT_COUNT);
		return { ...oneHit, baseStableId: `toyhub:base/${cardIndex}/${pathIndex}`, baseKind: pathIndex % 2 === 0 ? 'class' : 'property', slotKind: SLOT_KIND_LIST[pathIndex % SLOT_KIND_LIST.length] };
	}),
	stableId: `toyhub/card/${String(cardIndex).padStart(3, '0')}`,
}));
// the OLD frozen path, written out here independently of the code under test (the field order of the pre-fix freezer)
const hubEdgeTypeFor = (slotKind) => `HAS_${HUB_NAME}_${registryLib.HUB_SLOT_BY_SLOT_KIND[slotKind]}`;
const oldFrozenPathListFor = (oneEntry) => oneEntry.pathList.map((onePath) => ({ embedTextStableId: onePath.embedTextStableId, propertyNameList: onePath.propertyNameList.slice(), hitTextStableId: onePath.hitTextStableId, baseStableId: onePath.baseStableId, baseKind: onePath.baseKind, edgeType: hubEdgeTypeFor(onePath.slotKind), cosine: onePath.cosine }));

harness.section('(a)(b) the frozen form');
harness.ok('the registry exports frozenRetrievalVoteListFor and expandedRetrievalPathListFor', typeof registryLib.frozenRetrievalVoteListFor === 'function' && typeof registryLib.expandedRetrievalPathListFor === 'function');
const frozen = typeof registryLib.frozenRetrievalVoteListFor === 'function' ? registryLib.frozenRetrievalVoteListFor({ rankedList, hubName: HUB_NAME }) : { error: new Error('not exported') };
harness.ok('it freezes without error', !frozen.error, frozen.error && frozen.error.message);
harness.equal('retrievalHitList holds each distinct hit once', Array.isArray(frozen.retrievalHitList) ? frozen.retrievalHitList.length : 'absent', HIT_COUNT);
harness.equal('retrievalVoteList keeps one entry per card, in rank order', JSON.stringify((frozen.retrievalVoteList || []).map((oneEntry) => oneEntry.stableId)), JSON.stringify(rankedList.map((oneEntry) => oneEntry.stableId)));
const everyPathIsSlim = (frozen.retrievalVoteList || []).every((oneEntry) => oneEntry.pathList.every((onePath) => Object.keys(onePath).sort().join(',') === 'baseKind,baseStableId,edgeType,hitIndex'));
harness.ok('every frozen path is exactly { hitIndex, baseStableId, baseKind, edgeType }', (frozen.retrievalVoteList || []).length > 0 && everyPathIsSlim);

harness.section('(c) lossless');
const expansionFaultList = (frozen.retrievalVoteList || []).map((oneEntry, rankIndex) => {
	const expanded = typeof registryLib.expandedRetrievalPathListFor === 'function' ? registryLib.expandedRetrievalPathListFor({ retrievalHitList: frozen.retrievalHitList, pathList: oneEntry.pathList }) : { error: new Error('not exported') };
	if (expanded.error) {
		return `${oneEntry.stableId}: ${expanded.error.message}`;
	}
	return JSON.stringify(expanded.pathList) === JSON.stringify(oldFrozenPathListFor(rankedList[rankIndex])) ? null : `${oneEntry.stableId}: expansion differs`;
}).filter((oneFault) => oneFault !== null);
harness.equal('every card\'s expanded path list equals the old frozen form, byte for byte (field order included)', expansionFaultList.slice(0, 3).join(' | '), '');

harness.section('(d) smaller');
const oldText = canonicalJsonText({ retrievalVoteList: rankedList.map((oneEntry) => ({ bestCosine: oneEntry.bestCosine, cardTextCosine: oneEntry.cardTextCosine, cardTextWinningTextStableId: oneEntry.cardTextWinningTextStableId, ownVotes: oneEntry.ownVotes, stableId: oneEntry.stableId, pathList: oldFrozenPathListFor(oneEntry) })) });
const newText = frozen.error ? oldText : canonicalJsonText({ retrievalHitList: frozen.retrievalHitList, retrievalVoteList: frozen.retrievalVoteList });
harness.ok(`the slim text is under half the old (${newText.length} vs ${oldText.length} characters)`, newText.length * 2 < oldText.length);

harness.section('(e) the method row declares the field');
const voteRow = registryLib.methodRowFor({ method: 'embedTextVote-v1' });
const recordTraceFieldNameList = voteRow && (voteRow.methodRow || voteRow).recordTraceFieldNameList;
harness.equal('embedTextVote-v1 recordTraceFieldNameList', JSON.stringify(recordTraceFieldNameList), JSON.stringify(['neighbourTrace', 'retrievalHitList', 'retrievalVoteList']));

harness.section('(f) refusals on expansion');
const refusalOf = (input) => (typeof registryLib.expandedRetrievalPathListFor === 'function' ? String((registryLib.expandedRetrievalPathListFor(input).error || {}).message) : '');
harness.match('a hitIndex that names no hit is refused by name', refusalOf({ retrievalHitList: frozen.retrievalHitList || [], pathList: [{ hitIndex: 99, baseStableId: 'x', baseKind: 'class', edgeType: 'HAS_TOYHUB_DOMAIN' }] }), /hitIndex 99 names no hit/);
harness.match('a hit list that is not a list is refused by name', refusalOf({ retrievalHitList: null, pathList: [] }), /retrievalHitList is not a list/);

harness.report();
