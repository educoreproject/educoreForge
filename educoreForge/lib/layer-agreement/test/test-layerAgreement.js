#!/usr/bin/env node
'use strict';

// test-layerAgreement.js — gates for lib/layer-agreement (mappingLayers ML2-b). Hermetic: two slices of REAL frozen decision blocks
// (fixtures/: Ed-Fi -> CEDS 1a1e9d16, two picks and one abstention; PESC CT1.7 -> CEDS 86068c72, one fanned-out pick and one fanned-out
// abstention; record pools trimmed, headers whole) and STATED rater rows. The full-block parity with the real exporter is measured by
// the lane tool checkAssertionParity.js (IDENTICAL on both whole blocks); this suite pins the reader's rules and every metric cell.
//
// Run: node lib/layer-agreement/test/test-layerAgreement.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/layer-agreement/layerAssertions and layerAgreement

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Reads two real decision-block slices and a stated rater set, and proves: one assertion per from-node (instances under fan-out),
     the abstention per from-node with the exporter's own predicate, the five judge-against-rater categories and bestHit, that a
     judge's abstention and a rater's No match share an object-level MSI while a pick never shares a full-predicate MSI, that coverage
     lists an element the judge does not answer, that a rated type-level element is answered through its judged subject, the
     version-against-version categories, determinism, and each refusal by name.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const { assertionsFromSssomText, assertionsFromDecisionBlock } = require('../layerAssertions');
const { compareJudgeAgainstRater, compareVersionAgainstVersion } = require('../layerAgreement');
const { NO_TERM_FOUND_PREDICATE_ID, NO_TERM_FOUND_OBJECT_ID } = require('../../bridge-framework/sssomExporter');
const edfiBlock = require('./fixtures/edfiBlockSlice.json');
const pescBlock = require('./fixtures/pescFanOutBlockSlice.json');

const EDFI_PICKED_A = edfiBlock.decisionRecordList[0];
const EDFI_PICKED_B = edfiBlock.decisionRecordList[1];
const EDFI_ABSTAINED = edfiBlock.decisionRecordList[2];
const PESC_PICKED = pescBlock.decisionRecordList[0];
const PESC_ABSTAINED = pescBlock.decisionRecordList[1];
const OTHER_CARD = 'https://w3id.org/EDUcore/CEDStandards/hub/14.0.0.0/0000000000000000000000000000000000000000000000000000000000000000';
const RATER_ONE = 'https://w3id.org/EDUcore/agent/refIdRaterOne';
const RATER_TWO = 'https://w3id.org/EDUcore/agent/refIdRaterTwo';
const standardNameByStandardKey = { edfi: 'EdFi', pesccollegetranscript1v7v0: 'PESC-CollegeTranscript-1.7.0' };

const raterRow = ({ subjectStableId, predicateId, objectId, authorIri, standardVersion = '5.2.0' }) => [subjectStableId, predicateId, objectId, 'semapv:ManualMappingCuration', `urn:educore:${subjectStableId.slice(0, subjectStableId.indexOf(':'))}:`, standardVersion, authorIri].join('\t');
const raterSetFor = (rowTextList) =>
	[
		'#curie_map:',
		'#  edc: "https://w3id.org/EDUcore/"',
		'#  edfi: "urn:educore:edfi:"',
		'#  pesccollegetranscript1v7v0: "urn:educore:pesccollegetranscript1v7v0:"',
		'#  urn: "urn:"',
		'#mapping_set_id: "https://w3id.org/EDUcore/layer/raters/r1"',
		['subject_id', 'predicate_id', 'object_id', 'mapping_justification', 'subject_source', 'subject_source_version', 'author_id'].join('\t'),
		...rowTextList,
	].join('\n') + '\n';
const statedRaterRowList = [
	// hit by Best (rater one), and a hit by Same only (rater two: Best elsewhere, Same on the judge's card)
	raterRow({ subjectStableId: EDFI_PICKED_A.subjectStableId, predicateId: 'edc:bestMatch', objectId: EDFI_PICKED_A.objectStableId, authorIri: RATER_ONE }),
	raterRow({ subjectStableId: EDFI_PICKED_A.subjectStableId, predicateId: 'edc:bestMatch', objectId: OTHER_CARD, authorIri: RATER_TWO }),
	raterRow({ subjectStableId: EDFI_PICKED_A.subjectStableId, predicateId: 'edc:alsoAcceptable', objectId: EDFI_PICKED_A.objectStableId, authorIri: RATER_TWO }),
	// miss; judge picked, rater said No match
	raterRow({ subjectStableId: EDFI_PICKED_B.subjectStableId, predicateId: 'edc:bestMatch', objectId: OTHER_CARD, authorIri: RATER_ONE }),
	raterRow({ subjectStableId: EDFI_PICKED_B.subjectStableId, predicateId: NO_TERM_FOUND_PREDICATE_ID, objectId: NO_TERM_FOUND_OBJECT_ID, authorIri: RATER_TWO }),
	// agreed absence; judge abstained, rater picked
	raterRow({ subjectStableId: EDFI_ABSTAINED.subjectStableId, predicateId: NO_TERM_FOUND_PREDICATE_ID, objectId: NO_TERM_FOUND_OBJECT_ID, authorIri: RATER_ONE }),
	raterRow({ subjectStableId: EDFI_ABSTAINED.subjectStableId, predicateId: 'edc:bestMatch', objectId: OTHER_CARD, authorIri: RATER_TWO }),
	// a fanned-out instance rated directly, and the type-level judged subject rated (answered through the judged subject)
	raterRow({ subjectStableId: PESC_PICKED.instanceStableIdList[0], predicateId: 'edc:bestMatch', objectId: PESC_PICKED.objectStableId, authorIri: RATER_ONE, standardVersion: '1.7.0' }),
	raterRow({ subjectStableId: PESC_ABSTAINED.subjectStableId, predicateId: NO_TERM_FOUND_PREDICATE_ID, objectId: NO_TERM_FOUND_OBJECT_ID, authorIri: RATER_ONE, standardVersion: '1.7.0' }),
	// an element no judge block answers
	raterRow({ subjectStableId: 'edfi:property/domainEntity.Toy.NotJudged', predicateId: 'edc:bestMatch', objectId: OTHER_CARD, authorIri: RATER_ONE }),
];

// =====================================================================
harness.section('reading a frozen decision block (the exporter\'s rules)');
// =====================================================================
const edfiRead = assertionsFromDecisionBlock({ decisionBlock: edfiBlock, sourceLabel: 'edfiBlockSlice' });
const pescRead = assertionsFromDecisionBlock({ decisionBlock: pescBlock, sourceLabel: 'pescFanOutBlockSlice' });
harness.ok('both slices read', edfiRead.error === undefined && pescRead.error === undefined, edfiRead.error || pescRead.error);
harness.equal('Ed-Fi: two picks and one abstention, one row each', `${edfiRead.assertionList.length} ${edfiRead.assertionList.filter((one) => one.isAbstention).length}`, '3 1');
harness.equal('a pick carries the block\'s SKOS predicate', edfiRead.assertionList[0].predicateId, `skos:${EDFI_PICKED_A.predicate}`);
harness.equal('an abstention is skos:mappingRelation -> sssom:NoTermFound', `${edfiRead.assertionList[2].predicateId} ${edfiRead.assertionList[2].objectId}`, 'skos:mappingRelation sssom:NoTermFound');
harness.equal('fan-out: one row per instance, picks and abstentions alike', pescRead.assertionList.length, PESC_PICKED.instanceStableIdList.length + PESC_ABSTAINED.instanceStableIdList.length);
harness.equal('  …each naming its judged subject', Array.from(new Set(pescRead.assertionList.map((one) => one.judgedSubjectStableId))).sort().join(' | '), [PESC_PICKED.subjectStableId, PESC_ABSTAINED.subjectStableId].sort().join(' | '));
harness.equal('the standard version comes from the block header', edfiRead.assertionList[0].standardVersion, '5.2.0');

// =====================================================================
harness.section('judge against rater (SPEC §8.1)');
// =====================================================================
const raterRead = assertionsFromSssomText({ sssomText: raterSetFor(statedRaterRowList), sourceLabel: 'stated rater set' });
harness.ok('the stated rater set reads', raterRead.error === undefined, raterRead.error);
const compareArgsFor = (overrides = {}) => ({
	judgeAssertionList: edfiRead.assertionList.concat(pescRead.assertionList),
	raterAssertionList: raterRead.assertionList,
	raterUnsureList: [{ authorIri: RATER_TWO, elementStableId: 'edfi:property/domainEntity.Toy.Unsure' }],
	elementKindByStableId: { [EDFI_PICKED_A.subjectStableId]: 'code', [EDFI_PICKED_B.subjectStableId]: 'code', [EDFI_ABSTAINED.subjectStableId]: 'freeText', [PESC_PICKED.instanceStableIdList[0]]: 'identifier', [PESC_ABSTAINED.subjectStableId]: 'freeText', 'edfi:property/domainEntity.Toy.NotJudged': 'number' },
	standardNameByStandardKey,
	hubName: 'CEDS',
	judgeLabel: 'stated judge',
	raterLabel: 'stated raters',
	raterPredicateExpansionByPrefix: raterRead.predicateExpansionByPrefix,
	raterBestPredicateId: 'edc:bestMatch',
	...overrides,
});
const compared = compareJudgeAgainstRater(compareArgsFor());
harness.ok('the comparison runs', compared.error === undefined, compared.error);
// a unit the comparison did not score reads as 'unscored', so a regression fails an assertion rather than crashing the suite
const unitOf = (elementStableId, authorIri) => compared.unitList.find((one) => one.elementStableId === elementStableId && (authorIri === undefined || one.authorIri === authorIri)) || { category: 'unscored', judgedVia: 'unscored' };
const categoryOf = (elementStableId, authorIri) => unitOf(elementStableId, authorIri).category;
harness.equal('hit: the judge\'s card is the rater\'s Best', categoryOf(EDFI_PICKED_A.subjectStableId, RATER_ONE), 'hit');
harness.equal('hit: the judge\'s card is only the rater\'s Same', categoryOf(EDFI_PICKED_A.subjectStableId, RATER_TWO), 'hit');
harness.equal('  …bestHit counts the first and not the second', compared.unitList.filter((one) => one.elementStableId === EDFI_PICKED_A.subjectStableId).map((one) => one.bestHit).join(','), 'true,false');
harness.equal('miss: both picked, nothing shared', categoryOf(EDFI_PICKED_B.subjectStableId, RATER_ONE), 'miss');
harness.equal('judgePickedRaterNoMatch', categoryOf(EDFI_PICKED_B.subjectStableId, RATER_TWO), 'judgePickedRaterNoMatch');
harness.equal('agreedAbsence: the judge\'s abstention and the rater\'s No match', categoryOf(EDFI_ABSTAINED.subjectStableId, RATER_ONE), 'agreedAbsence');
harness.equal('judgeAbstainedRaterPicked', categoryOf(EDFI_ABSTAINED.subjectStableId, RATER_TWO), 'judgeAbstainedRaterPicked');
harness.equal('a rated INSTANCE is answered by its own from-node', `${categoryOf(PESC_PICKED.instanceStableIdList[0], RATER_ONE)} ${unitOf(PESC_PICKED.instanceStableIdList[0]).judgedVia}`, 'hit fromNode');
harness.equal('a rated TYPE-LEVEL subject is answered through its judged subject', `${categoryOf(PESC_ABSTAINED.subjectStableId, RATER_ONE)} ${unitOf(PESC_ABSTAINED.subjectStableId).judgedVia}`, 'agreedAbsence judgedSubject');
harness.equal('coverage FIRST: the unanswered element is listed, never scored', JSON.stringify(compared.coverage.judgeUncoveredList), JSON.stringify([{ authorIri: RATER_ONE, elementStableId: 'edfi:property/domainEntity.Toy.NotJudged' }]));
harness.equal('  …the unsure unit is counted and listed, never scored', `${compared.coverage.raterUnsureUnitCount} ${compared.coverage.scoredUnitCount}`, '1 8');
harness.equal('full-predicate MSI agrees ONLY on the two agreed absences (edc: never equals skos:)', compared.overall.fullPredicateAgreement, 2);
harness.equal('overall cells', JSON.stringify([compared.overall.hit, compared.overall.miss, compared.overall.agreedAbsence, compared.overall.judgePickedRaterNoMatch, compared.overall.judgeAbstainedRaterPicked, compared.overall.bestHit]), JSON.stringify([3, 1, 2, 1, 1, 2]));
harness.equal('rates', `${compared.overall.hitRateWhereBothPicked} ${compared.overall.absenceAgreementRate}`, '0.75 0.5');
harness.equal('per standard', JSON.stringify(Object.keys(compared.byStandard)), JSON.stringify(['edfi', 'pesccollegetranscript1v7v0']));
harness.equal('per element kind', JSON.stringify(Object.keys(compared.byElementKind)), JSON.stringify(['code', 'freeText', 'identifier']));
harness.equal('a re-run is byte-identical', JSON.stringify(compareJudgeAgainstRater(compareArgsFor())), JSON.stringify(compared));
harness.equal('shuffled inputs give the same report', JSON.stringify(compareJudgeAgainstRater(compareArgsFor({ judgeAssertionList: edfiRead.assertionList.concat(pescRead.assertionList).reverse(), raterAssertionList: raterRead.assertionList.slice().reverse() }))), JSON.stringify(compared));

// =====================================================================
harness.section('version against version (SPEC §8.2)');
// =====================================================================
const flipRecord = (oneRecord, changes) => ({ ...oneRecord, ...changes });
const rightBlock = { ...edfiBlock, decisionRecordList: [flipRecord(EDFI_PICKED_A, { predicate: 'exactMatch' }), flipRecord(EDFI_PICKED_B, { objectStableId: null, predicate: null, abstained: true }), flipRecord(EDFI_ABSTAINED, { objectStableId: OTHER_CARD, predicate: 'closeMatch', abstained: false })] };
const rightRead = assertionsFromDecisionBlock({ decisionBlock: rightBlock, sourceLabel: 'altered slice' });
const versioned = compareVersionAgainstVersion({ leftAssertionList: edfiRead.assertionList, rightAssertionList: rightRead.assertionList, standardNameByStandardKey, leftLabel: 'left', rightLabel: 'right' });
harness.equal('predicateChanged / newlyAbstained / newlyPicked', versioned.changedUnitList.map((one) => one.category).join(','), 'predicateChanged,newlyAbstained,newlyPicked');
const sameVersioned = compareVersionAgainstVersion({ leftAssertionList: edfiRead.assertionList, rightAssertionList: edfiRead.assertionList, standardNameByStandardKey, leftLabel: 'left', rightLabel: 'left again' });
harness.equal('a version against itself is wholly stable', `${sameVersioned.overall.stable} ${sameVersioned.overall.stableRate}`, '3 1');
const flipped = compareVersionAgainstVersion({ leftAssertionList: edfiRead.assertionList, rightAssertionList: assertionsFromDecisionBlock({ decisionBlock: { ...edfiBlock, decisionRecordList: [flipRecord(EDFI_PICKED_A, { objectStableId: OTHER_CARD })] }, sourceLabel: 'one flip' }).assertionList, standardNameByStandardKey, leftLabel: 'left', rightLabel: 'flip' });
harness.equal('flipped, with coverage naming the left-only elements', `${flipped.overall.flipped} ${flipped.coverage.sharedElementCount} ${flipped.coverage.leftOnlyCount}`, '1 1 2');

// =====================================================================
harness.section('refusals, each by name');
// =====================================================================
harness.rejects('a rater row with no author_id', [compareJudgeAgainstRater(compareArgsFor({ raterAssertionList: raterRead.assertionList.map((one) => ({ ...one, authorIri: '' })) })).error].filter(Boolean), /carries no author_id/);
harness.rejects('a standard with no name', [compareJudgeAgainstRater(compareArgsFor({ standardNameByStandardKey: { edfi: 'EdFi' } })).error].filter(Boolean), /standard 'pesccollegetranscript1v7v0' .* has no standardName/);
harness.rejects('an object that is neither a card nor NoTermFound', [compareJudgeAgainstRater(compareArgsFor({ raterAssertionList: raterRead.assertionList.map((one) => ({ ...one, objectId: 'toy:notAnIri' })) })).error].filter(Boolean), /is neither a card IRI nor sssom:NoTermFound/);
harness.rejects('an answer both picked and abstained', [compareJudgeAgainstRater(compareArgsFor({ raterAssertionList: raterRead.assertionList.concat([{ ...raterRead.assertionList[0], predicateId: NO_TERM_FOUND_PREDICATE_ID, objectId: NO_TERM_FOUND_OBJECT_ID, isAbstention: true }]) })).error].filter(Boolean), /both picked and abstained/);
harness.rejects('a rated element with no kind (never guessed)', [compareJudgeAgainstRater(compareArgsFor({ elementKindByStableId: { [EDFI_PICKED_A.subjectStableId]: 'code' } })).error].filter(Boolean), /rated element .* has no kind/);
harness.rejects('an absent required input', [compareJudgeAgainstRater(compareArgsFor({ raterBestPredicateId: undefined })).error].filter(Boolean), /raterBestPredicateId are required/);
harness.rejects('a set the exporter\'s reader refuses', [assertionsFromSssomText({ sssomText: 'subject_id\tpredicate_id\n', sourceLabel: 'broken' }).error].filter(Boolean), /fails parseSssomTsv/);

harness.report();
