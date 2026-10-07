#!/usr/bin/env node
'use strict';

// test-omissionDeclaration.js — gate for G21 (PLAN-knownIssues G21; WORKORDER-G21; W-C-14's one verdict shape): omissions
// are declared, not mislabelled as lost. Before G21 a verdict listed every omitted item inside `lostList` (a PESC verdict
// carried lostTotal 0 beside a lostList of 29,339 entries) and the in-graph certificate gave one bare omitted count per
// standard.
//
// PROVES:
//   (a) a lostList holding an explicitlyOmitted item is REFUSED: lostList holds only true losses
//   (b) lostList.length !== lostTotal is REFUSED
//   (c) a verdict without explicitlyOmittedList is REFUSED
//   (d) explicitlyOmittedList.length !== explicitlyOmittedTotal is REFUSED
//   (e) an omitted entry without a kind, or without a rule, is REFUSED
//   (f) an omitted entry whose kind its own declaration does not list is REFUSED (kinds are declared, never discovered)
//   (g) the assembler splits a diff: contentGap items stay in lostList, omitted items become { statementKey, kind, rule }
//   (h) the PESC pair declares its rule (lib/pesc-release-forge/roundTripPair.js), its three kinds and the G20 caveat, and
//       an XSD's comment / whitespace / processing instruction land as those kinds
//   (i) the SIF 2.6 pair declares 'container' under forges/sif260928/lib/sif260928RoundTripPair.js, and its source side
//       stamps that kind on every container statement
//   (j) CEDS, Ed-Fi and the SIF incumbent carry an EMPTY explicitlyOmittedList (their registries are empty)
//   (k) the stage summary row states the omissions per standard BY KIND with the rule, and the caveat
//   (l) the roundTrip BuildAttestation row carries explicitOmissionDeclarationList (one line per standard) and its detail
//       says the same; graph-contract §4 declares the field for the roundTrip gate (stringList) and §1 keeps it a list
//   ⟪G21b, VIOLET_VALLEY 2026-10-07: "an omission declaration whose comment text cannot be read cannot be audited"⟫
//   (m) a PESC comment entry carries its text; whitespace and processing-instruction entries carry none
//   (n) an entry of a text-bearing kind without its text is REFUSED; (o) text on any other kind is REFUSED
//   (p) a declaration whose textBearingKindList names a kind its kindList does not is REFUSED
// RED TWINS (in memory): every conjunct is driven against a double of the module it judges, mutated to the pre-G21 rule.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: round-trip omissions are declared by kind and rule, and lostList holds only true losses
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const ASSEMBLER_PATH = path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'verdictAssembler.js');
const STAGE_PATH = path.join(__dirname, '..', 'lib', 'round-trip-stage.js');
const BUILD_JS_PATH = path.join(__dirname, '..', 'lib', 'build.js');
const PESC_PAIR_PATH = path.join(TREE_ROOT, 'lib', 'pesc-release-forge', 'roundTripPair.js');
const SIF_PAIR_PATH = path.join(TREE_ROOT, 'forges', 'sif260928', 'lib', 'sif260928RoundTripPair.js');
const GRAPH_CONTRACT_PATH = path.join(TREE_ROOT, 'lib', 'vocabulary', 'graph-contract.js');
const VALIDATOR_PATH_BY_NAME = {
	ceds: path.join(TREE_ROOT, 'forges', 'ceds', 'roundTripValidator.js'),
	edfi: path.join(TREE_ROOT, 'forges', 'edfi', 'roundTripValidator.js'),
	sif: path.join(TREE_ROOT, 'forges', 'sif', 'roundTripValidator.js'),
};

const doubleOrReal = (modulePath, mutationList) => (mutationList.length === 0 ? require(modulePath) : loadBuildJsDouble({ buildJsPath: modulePath, mutationList }));
const silentXLog = { status() {}, error() {}, verbose() {}, result() {} };

// ---- fixtures ---------------------------------------------------------------------------------------------------------
const PESC_RULE = 'lib/pesc-release-forge/roundTripPair.js';
const TOY_DECLARATION = { rule: 'toy/roundTripPair.js', kindPropertyName: 'omittedKind', kindList: ['comment', 'whitespace'], textBearingKindList: ['comment'], textPropertyName: 'omittedText', caveatText: '' };
const contentGapItemFor = (itemIndex) => ({ statementKey: `gap${itemIndex}`, statement: { subject: `gap${itemIndex}` }, lostCategory: 'contentGap' });
const omittedEntryFor = (itemIndex, kind) => ({ statementKey: `omit${itemIndex}`, kind, rule: TOY_DECLARATION.rule, ...(kind === 'comment' ? { text: ` note ${itemIndex} ` } : {}) });
const CENSUS = { wallClockMs: 1, peakMemoryBytes: 1, statementCensus: { sourceStatementCount: 9, graphStatementCount: 4, matchedCount: 4 } };
// a well-formed G21 verdict: 2 true losses, 3 declared omissions
const WELL_FORMED = {
	roundTripClean: false, inventedTotal: 0, lostTotal: 2, contentGapTotal: 2, explicitlyOmittedTotal: 3,
	lostList: [contentGapItemFor(0), contentGapItemFor(1)],
	explicitlyOmittedList: [omittedEntryFor(0, 'comment'), omittedEntryFor(1, 'whitespace'), omittedEntryFor(2, 'whitespace')],
	explicitOmissionDeclaration: TOY_DECLARATION,
	inventedList: [],
	semanticValidationLimit: 'a toy limit',
	census: CENSUS,
};
const shapeErrorOf = (mutationList, verdict) => doubleOrReal(ASSEMBLER_PATH, mutationList).verifyVerdictShape(verdict).error;
const refusedWith = (mutationList, verdict, pattern) => {
	const shapeError = shapeErrorOf(mutationList, verdict);
	return { pass: pattern.test(shapeError), detail: shapeError || 'ACCEPTED' };
};

const runStageWith = (mutationList, verdict, done) => {
	const outputDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'g21OmissionDeclaration-'));
	doubleOrReal(STAGE_PATH, mutationList)().runRoundTripStage(
		{
			stageSpec: { mode: 'build', enabled: true, outputDirPath, roster: { rosterRows: [{ token: 'pesccollegetranscript1v8v0', standardName: 'PESC CT', disposition: 'declared', validatorPath: '/fake/roundTripValidator.js', validatorApi: { validate: (spec, cb) => cb('', verdict) }, snapshotDirPath: '/fake/snap' }], declaredTokens: ['pesccollegetranscript1v8v0'], absentTokens: [], unresolvableTokens: [] } },
			containerHandle: { containerName: 'DEV_g21', boltUrl: 'bolt://localhost:9999', user: 'neo4j', password: 'x' },
			xLog: silentXLog,
		},
		(err, stageReport) => {
			if (err) {
				done(err, null);
				return;
			}
			done('', JSON.parse(fs.readFileSync(stageReport.summaryFilePath, 'utf8')));
		},
	);
};
// a College Transcript-sized clean verdict: whitespace 28,428, comment 907, processingInstruction 4
const PESC_DECLARATION = { rule: PESC_RULE, kindPropertyName: 'omittedKind', kindList: ['comment', 'whitespace', 'processingInstruction'], textBearingKindList: ['comment'], textPropertyName: 'omittedText', caveatText: 'comments may carry content (PLAN G20)' };
const pescCleanVerdict = () => {
	const explicitlyOmittedList = [];
	[['whitespace', 28428], ['comment', 907], ['processingInstruction', 4]].forEach(([kind, count]) => {
		for (let itemIndex = 1; itemIndex <= count; itemIndex++) {
			explicitlyOmittedList.push({ statementKey: `f.xsd|${kind}#${itemIndex}`, kind, rule: PESC_RULE, ...(kind === 'comment' ? { text: '=====' } : {}) });
		}
	});
	return { roundTripClean: true, inventedTotal: 0, lostTotal: 0, contentGapTotal: 0, explicitlyOmittedTotal: explicitlyOmittedList.length, lostList: [], explicitlyOmittedList, explicitOmissionDeclaration: PESC_DECLARATION, inventedList: [], semanticValidationLimit: 'PESC limit', census: CENSUS };
};
const PESC_DECLARATION_TEXT = 'pesccollegetranscript1v8v0: whitespace 28,428, comment 907, processingInstruction 4 (rule: lib/pesc-release-forge/roundTripPair.js); comments may carry content (PLAN G20)';

const BESPOKE_PART_BY_VALIDATOR = {
	ceds: (validator) => validator.normativeVerdictPartFor({ report: { headline: { sourceStatements: 3, emittedStatements: 2, matched: 2 }, lostItemList: [{ statementKey: 'k1', statement: { subject: 'a', predicate: 'p', objectKind: 'literal', object: 'x', datatype: '' } }], inventedItemList: [] }, explicitlyOmittedPredicateList: [], wallClockMs: 1, peakMemoryBytes: 1 }),
	edfi: (validator) => validator.normativeVerdictPartFor({ report: { headline: { sourceStatements: 3, emittedStatements: 2, reproduced: 2 }, lostDetailList: [{ subject: 'a', predicate: 'p', object: 'x', bucketName: 'contentGap' }], inventedDetailList: [] }, crosswalkGuardViolationList: [], wallClockMs: 1, peakMemoryBytes: 1 }),
	sif: (validator) => validator.normativeVerdictPartFor({ report: { headline: { sourceStatements: 3, emittedStatements: 2, matched: 2 }, lostDetailList: [{ subject: 'a', predicate: 'p', object: 'x', lostCategory: 'contentGap' }], inventedDetailList: [] }, wallClockMs: 1, peakMemoryBytes: 1 }),
};
const bespokeConjunctFor = (validatorName) => (mutationList, done) => {
	const loaded = doubleOrReal(VALIDATOR_PATH_BY_NAME[validatorName], mutationList);
	const part = BESPOKE_PART_BY_VALIDATOR[validatorName](typeof loaded === 'function' ? loaded() : loaded);
	const verdict = { roundTripClean: false, inventedTotal: 0, lostTotal: 1, contentGapTotal: 1, explicitlyOmittedTotal: 0, semanticValidationLimit: `the ${validatorName} limit`, ...part };
	const shapeError = require(ASSEMBLER_PATH).verifyVerdictShape(verdict).error;
	const declaration = part.explicitOmissionDeclaration || {};
	done({
		pass: shapeError === '' && Array.isArray(part.explicitlyOmittedList) && part.explicitlyOmittedList.length === 0 && Array.isArray(declaration.kindList) && declaration.kindList.length === 0 && /\S/.test(declaration.rule || ''),
		detail: shapeError || `${validatorName}: explicitlyOmittedList ${JSON.stringify(part.explicitlyOmittedList)}, declaration ${JSON.stringify(declaration)}`,
	});
};

const conjunctJudgeByRefId = {
	a_lostListHoldsOnlyTrueLosses: (mutationList, done) =>
		done(refusedWith(mutationList, { ...WELL_FORMED, lostTotal: 2, lostList: [contentGapItemFor(0), contentGapItemFor(1), { ...contentGapItemFor(2), lostCategory: 'explicitlyOmitted' }] }, /lost item 2 \(gap2\) carries lostCategory "explicitlyOmitted" — lostList holds only true losses/)),
	b_lostListLengthIsLostTotal: (mutationList, done) =>
		done(refusedWith(mutationList, { ...WELL_FORMED, lostList: [contentGapItemFor(0), contentGapItemFor(1), contentGapItemFor(2)] }, /lostList has 3 item\(s\) but lostTotal is 2/)),
	c_explicitlyOmittedListRequired: (mutationList, done) => {
		const verdict = { ...WELL_FORMED };
		delete verdict.explicitlyOmittedList;
		done(refusedWith(mutationList, verdict, /verdict lacks explicitlyOmittedList/));
	},
	d_explicitlyOmittedListLengthIsTotal: (mutationList, done) =>
		done(refusedWith(mutationList, { ...WELL_FORMED, explicitlyOmittedList: WELL_FORMED.explicitlyOmittedList.slice(0, 1) }, /explicitlyOmittedList has 1 item\(s\) but explicitlyOmittedTotal is 3/)),
	e_entryNeedsKindAndRule: (mutationList, done) => {
		const withoutKind = refusedWith(mutationList, { ...WELL_FORMED, explicitlyOmittedList: [{ statementKey: 'omit0', rule: TOY_DECLARATION.rule }, omittedEntryFor(1, 'whitespace'), omittedEntryFor(2, 'whitespace')] }, /explicitly omitted item 0 \(omit0\) carries no kind/);
		const withoutRule = refusedWith(mutationList, { ...WELL_FORMED, explicitlyOmittedList: [{ statementKey: 'omit0', kind: 'comment' }, omittedEntryFor(1, 'whitespace'), omittedEntryFor(2, 'whitespace')] }, /explicitly omitted item 0 \(omit0\) carries no rule/);
		done({ pass: withoutKind.pass && withoutRule.pass, detail: `kind: ${withoutKind.detail} | rule: ${withoutRule.detail}` });
	},
	f_undeclaredKindRefused: (mutationList, done) =>
		done(refusedWith(mutationList, { ...WELL_FORMED, explicitlyOmittedList: [omittedEntryFor(0, 'processingInstruction'), omittedEntryFor(1, 'whitespace'), omittedEntryFor(2, 'whitespace')] }, /explicitly omitted item 0 \(omit0\) has kind 'processingInstruction', which its declaration \(toy\/roundTripPair\.js\) does not list/)),
	g_assemblerSplitsTheDiff: (mutationList, done) => {
		const sourceStatements = new Map([['gap0', { subject: 'gap0' }], ['omit0', { omittedKind: 'comment', omittedText: ' a note ', explicitlyOmitted: true }], ['omit1', { omittedKind: 'whitespace', explicitlyOmitted: true }], ['kept', { subject: 'kept' }]]);
		const graphStatements = new Map([['kept', { subject: 'kept' }]]);
		const assembled = doubleOrReal(ASSEMBLER_PATH, mutationList).assembleVerdict({ verdictVersion: 'g21-1', semanticValidationLimit: 'toy', sourceStatements, graphStatements, wallClockMs: 1, peakMemoryBytes: 1, omissionDeclaration: TOY_DECLARATION });
		const verdict = assembled.verdict || {};
		const omittedText = JSON.stringify(verdict.explicitlyOmittedList);
		done({
			pass: !assembled.error && verdict.lostTotal === 1 && Array.isArray(verdict.lostList) && verdict.lostList.length === 1 && verdict.lostList[0].statementKey === 'gap0' &&
				omittedText === JSON.stringify([{ statementKey: 'omit0', kind: 'comment', rule: 'toy/roundTripPair.js', text: ' a note ' }, { statementKey: 'omit1', kind: 'whitespace', rule: 'toy/roundTripPair.js' }]),
			detail: assembled.error || `lostList ${JSON.stringify((verdict.lostList || []).map((one) => one.statementKey))}; explicitlyOmittedList ${omittedText}`,
		});
	},
	h_pescPairDeclaresItsKinds: (mutationList, done) => {
		const pescPairLib = doubleOrReal(PESC_PAIR_PATH, mutationList);
		const declaration = pescPairLib.makeRoundTripPair({ labelPrefix: 'PescToy' }).omissionDeclaration || {};
		const canonical = pescPairLib.canonicalStatementsOfXsdText({ fileName: 'toy.xsd', xsdText: '<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><!-- Change # CR1 -->\n</xs:schema>', includeOmitted: true });
		const sourceStatements = new Map(canonical.statementList || []);
		const assembled = require(ASSEMBLER_PATH).assembleVerdict({ verdictVersion: 'g21-1', semanticValidationLimit: 'pesc', sourceStatements, graphStatements: new Map([...sourceStatements].filter(([, statement]) => statement.explicitlyOmitted !== true)), wallClockMs: 1, peakMemoryBytes: 1, omissionDeclaration: declaration });
		const kindText = ((assembled.verdict || {}).explicitlyOmittedList || []).map((one) => `${one.kind}@${one.rule}`).sort().join(',');
		done({
			pass: declaration.rule === PESC_RULE && (declaration.kindList || []).slice().sort().join(',') === 'comment,processingInstruction,whitespace' && /comments may carry content \(PLAN G20\)/.test(declaration.caveatText || '') &&
				kindText === `comment@${PESC_RULE},processingInstruction@${PESC_RULE},whitespace@${PESC_RULE},whitespace@${PESC_RULE}`,
			detail: assembled.error || `declaration ${JSON.stringify(declaration)}; entries ${kindText}`,
		});
	},
	i_sifPairDeclaresContainer: (mutationList, done) => {
		const pair = doubleOrReal(SIF_PAIR_PATH, mutationList)({ sourceFileName: 'toy.tsv' });
		const declaration = pair.omissionDeclaration || {};
		const sourceText = fs.readFileSync(SIF_PAIR_PATH, 'utf8');
		done({
			pass: declaration.rule === 'forges/sif260928/lib/sif260928RoundTripPair.js' && JSON.stringify(declaration.kindList) === '["container"]' && declaration.kindPropertyName === 'omittedKind' &&
				/\{ containerPath, omittedKind: STATEMENT_KIND\.CONTAINER, explicitlyOmitted: true \}/.test(sourceText),
			detail: `declaration ${JSON.stringify(declaration)}`,
		});
	},
	jCeds_emptyOmittedList: bespokeConjunctFor('ceds'),
	jEdfi_emptyOmittedList: bespokeConjunctFor('edfi'),
	jSif_emptyOmittedList: bespokeConjunctFor('sif'),
	k_stageSummaryByKindWithRule: (mutationList, done) =>
		runStageWith(mutationList, pescCleanVerdict(), (err, summary) => {
			const row = ((summary || {}).standards || [])[0] || {};
			done({
				pass: !err && row.explicitOmissionDeclarationText === PESC_DECLARATION_TEXT &&
					JSON.stringify(row.explicitlyOmittedCountByKindList) === JSON.stringify([{ kind: 'whitespace', count: 28428, rule: PESC_RULE }, { kind: 'comment', count: 907, rule: PESC_RULE }, { kind: 'processingInstruction', count: 4, rule: PESC_RULE }]),
				detail: err || `text ${JSON.stringify(row.explicitOmissionDeclarationText)}; byKind ${JSON.stringify(row.explicitlyOmittedCountByKindList)}`,
			});
		}),
	m_pescCommentEntryCarriesItsText: (mutationList, done) => {
		const pescPairLib = require(PESC_PAIR_PATH);
		const declaration = pescPairLib.makeRoundTripPair({ labelPrefix: 'PescToy' }).omissionDeclaration;
		const canonical = pescPairLib.canonicalStatementsOfXsdText({ fileName: 'toy.xsd', xsdText: '<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><!-- Change # CR1 -->\n</xs:schema>', includeOmitted: true });
		const sourceStatements = new Map(canonical.statementList || []);
		const assembled = doubleOrReal(ASSEMBLER_PATH, mutationList).assembleVerdict({ verdictVersion: 'g21b-1', semanticValidationLimit: 'pesc', sourceStatements, graphStatements: new Map(), wallClockMs: 1, peakMemoryBytes: 1, omissionDeclaration: declaration });
		const entryList = ((assembled.verdict || {}).explicitlyOmittedList || []);
		const commentEntry = entryList.find((one) => one.kind === 'comment') || {};
		const textlessOtherCount = entryList.filter((one) => one.kind !== 'comment' && one.text === undefined).length;
		done({ pass: !assembled.error && commentEntry.text === ' Change # CR1 ' && textlessOtherCount === entryList.length - 1 && JSON.stringify(declaration.textBearingKindList) === '["comment"]', detail: assembled.error || `comment ${JSON.stringify(commentEntry)}; others without text ${textlessOtherCount}/${entryList.length - 1}` });
	},
	n_textBearingEntryWithoutTextRefused: (mutationList, done) =>
		done(refusedWith(mutationList, { ...WELL_FORMED, explicitlyOmittedList: [{ statementKey: 'omit0', kind: 'comment', rule: TOY_DECLARATION.rule }, omittedEntryFor(1, 'whitespace'), omittedEntryFor(2, 'whitespace')] }, /explicitly omitted item 0 \(omit0\) of text-bearing kind 'comment' carries no text/)),
	o_textOnOtherKindRefused: (mutationList, done) =>
		done(refusedWith(mutationList, { ...WELL_FORMED, explicitlyOmittedList: [omittedEntryFor(0, 'comment'), { ...omittedEntryFor(1, 'whitespace'), text: '\n\t' }, omittedEntryFor(2, 'whitespace')] }, /explicitly omitted item 1 \(omit1\) of kind 'whitespace' carries text, but its declaration \(toy\/roundTripPair\.js\) makes only \[comment\] text-bearing/)),
	p_textBearingKindsAreDeclaredKinds: (mutationList, done) => {
		const declarationError = doubleOrReal(ASSEMBLER_PATH, mutationList).omissionDeclarationError({ ...TOY_DECLARATION, textBearingKindList: ['bogus'] });
		done({ pass: /textBearingKindList names 'bogus', which its kindList \[comment, whitespace\] does not/.test(declarationError), detail: declarationError || 'ACCEPTED' });
	},
	l_attestationCarriesTheDeclaration: (mutationList, done) => {
		const graphContract = doubleOrReal(GRAPH_CONTRACT_PATH, mutationList);
		const { roundTripRowFor } = doubleOrReal(BUILD_JS_PATH, []);
		const sifText = 'sif260928: container 6,586 (rule: forges/sif260928/lib/sif260928RoundTripPair.js)';
		const cleanRow = (token, explicitlyOmittedTotal, explicitOmissionDeclarationText) => ({ token, ran: true, roundTripClean: true, inventedTotal: 0, lostTotal: 0, explicitlyOmittedTotal, explicitOmissionDeclarationText });
		const row = roundTripRowFor({ stageRan: true, summaryFilePath: '/tmp/s.json', standards: [cleanRow('pesccollegetranscript1v8v0', 29339, PESC_DECLARATION_TEXT), cleanRow('sif260928', 6586, sifText)] });
		const declaredField = graphContract.ATTESTATION_FIELD_LIST.find((oneField) => oneField.name === 'explicitOmissionDeclarationList') || {};
		done({
			pass: JSON.stringify(row.explicitOmissionDeclarationList) === JSON.stringify([PESC_DECLARATION_TEXT, sifText]) && row.detail.indexOf(PESC_DECLARATION_TEXT) !== -1 && row.detail.indexOf(sifText) !== -1 &&
				declaredField.type === 'stringList' && declaredField.channel === 'channelA' && JSON.stringify(declaredField.gateList) === '["roundTrip"]' &&
				graphContract.LIST_VALUED_PROPERTY_NAME_LIST.indexOf('explicitOmissionDeclarationList') !== -1,
			detail: `list ${JSON.stringify(row.explicitOmissionDeclarationList)}; declared ${JSON.stringify(declaredField)}; detail ${String(row.detail).slice(0, 160)}`,
		});
	},
};

// each twin restores the pre-G21 rule in the module its conjunct judges
const TWIN_LIST = [
	{ conjunctRefId: 'a_lostListHoldsOnlyTrueLosses', twinName: 'omittedAllowedInLostList', modulePath: ASSEMBLER_PATH, find: 'oneLost.lostCategory !== LOST_CATEGORY.CONTENT_GAP', replace: 'LOST_CATEGORY_LIST.indexOf(oneLost.lostCategory) === -1' },
	{ conjunctRefId: 'b_lostListLengthIsLostTotal', twinName: 'lostListLengthUnchecked', modulePath: ASSEMBLER_PATH, find: 'if (verdict.lostList.length !== verdict.lostTotal) {', replace: 'if (false) {' },
	{ conjunctRefId: 'c_explicitlyOmittedListRequired', twinName: 'omittedListOptional', modulePath: ASSEMBLER_PATH, find: '	if (!Array.isArray(verdict.explicitlyOmittedList)) {', replace: "	if (!Array.isArray(verdict.explicitlyOmittedList)) { return { error: '' };" },
	{ conjunctRefId: 'd_explicitlyOmittedListLengthIsTotal', twinName: 'omittedLengthUnchecked', modulePath: ASSEMBLER_PATH, find: 'if (verdict.explicitlyOmittedList.length !== verdict.explicitlyOmittedTotal) {', replace: 'if (false) {' },
	{ conjunctRefId: 'e_entryNeedsKindAndRule', twinName: 'entryFieldsUnchecked', modulePath: ASSEMBLER_PATH, find: 'const missingEntryMemberName = OMITTED_ENTRY_MEMBER_NAME_LIST.find(', replace: 'const missingEntryMemberName = [].find(' },
	{ conjunctRefId: 'f_undeclaredKindRefused', twinName: 'kindNotHeldToDeclaration', modulePath: ASSEMBLER_PATH, find: 'if (declaration.kindList.indexOf(oneEntry.kind) === -1) {', replace: 'if (false) {' },
	{ conjunctRefId: 'g_assemblerSplitsTheDiff', twinName: 'omittedLeftInLostList', modulePath: ASSEMBLER_PATH, find: '		lostList: partitioned.lostList,', replace: '		lostList: diff.lostList,' },
	{ conjunctRefId: 'm_pescCommentEntryCarriesItsText', twinName: 'textNotCopied', modulePath: ASSEMBLER_PATH, find: 'const textMember = ', replace: 'const textMember = {} || ' },
	{ conjunctRefId: 'n_textBearingEntryWithoutTextRefused', twinName: 'missingTextUnchecked', modulePath: ASSEMBLER_PATH, find: 'if (isTextBearing && typeof oneEntry.text !== \'string\') {', replace: 'if (false) {' },
	{ conjunctRefId: 'o_textOnOtherKindRefused', twinName: 'strayTextUnchecked', modulePath: ASSEMBLER_PATH, find: 'if (!isTextBearing && oneEntry.text !== undefined) {', replace: 'if (false) {' },
	{ conjunctRefId: 'p_textBearingKindsAreDeclaredKinds', twinName: 'subsetUnchecked', modulePath: ASSEMBLER_PATH, find: 'const undeclaredTextKind = declaration.textBearingKindList.find(', replace: 'const undeclaredTextKind = [].find(' },
	{ conjunctRefId: 'h_pescPairDeclaresItsKinds', twinName: 'pescCaveatDropped', modulePath: PESC_PAIR_PATH, find: "	caveatText: 'comments may carry content (PLAN G20)',", replace: "	caveatText: '',"},
	{ conjunctRefId: 'i_sifPairDeclaresContainer', twinName: 'sifKindUnstamped', modulePath: SIF_PAIR_PATH, find: 'kindList: Object.freeze([STATEMENT_KIND.CONTAINER])', replace: 'kindList: Object.freeze([])' },
	...['ceds', 'edfi', 'sif'].map((oneValidatorName) => ({ conjunctRefId: `j${oneValidatorName.charAt(0).toUpperCase()}${oneValidatorName.slice(1)}_emptyOmittedList`, twinName: `${oneValidatorName}PartWithoutOmittedList`, modulePath: VALIDATOR_PATH_BY_NAME[oneValidatorName], find: 'explicitlyOmittedList: partitioned.explicitlyOmittedList,', replace: '' })),
	{ conjunctRefId: 'k_stageSummaryByKindWithRule', twinName: 'summaryWithoutDeclaration', modulePath: STAGE_PATH, find: '					explicitOmissionDeclarationText: omissionDeclarationText,', replace: '' },
	{ conjunctRefId: 'l_attestationCarriesTheDeclaration', twinName: 'fieldUndeclared', modulePath: GRAPH_CONTRACT_PATH, find: "	{ name: 'explicitOmissionDeclarationList',", replace: "	{ name: 'explicitOmissionDeclarationListUndeclared'," },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
const judgeSafely = (refId, mutationList, done) => {
	// a mutation whose find-text no longer matches throws from the double loader: that is a stale twin, reported as such
	let judged = false;
	const finish = (verdict) => {
		if (!judged) {
			judged = true;
			done(verdict);
		}
	};
	try {
		conjunctJudgeByRefId[refId](mutationList, finish);
	} catch (judgeError) {
		finish({ pass: false, threw: true, detail: `THREW: ${judgeError.message}` });
	}
};
harness.section('BASELINE — the real modules pass every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => judgeSafely(oneRefId, [], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a double of its module (in memory)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) => {
				// the twin mutates its own module; the conjunct loads that module through doubleOrReal(modulePath, mutationList)
				const mutationList = [{ find: oneTwin.find, replace: oneTwin.replace }];
				const scopedJudge = (refId, done) => judgeSafely(refId, mutationList.map((oneMutation) => ({ ...oneMutation, modulePath: oneTwin.modulePath })), done);
				scopedJudge(oneTwin.conjunctRefId, (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}' (not by a stale find-text)`, !verdict.pass && !verdict.threw, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				});
			}),
			() => harness.report(),
		);
	},
);
