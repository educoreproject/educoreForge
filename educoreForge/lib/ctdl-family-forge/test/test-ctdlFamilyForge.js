#!/usr/bin/env node
'use strict';

// test-ctdlFamilyForge.js — lib/ctdl-family-forge on a SYNTHETIC profile (not CTDL's), so what is proven here is the
// shared code's own contract, independent of any one bundle: the loader partitions native from foreign by the
// profile's allowlist alone and refuses what the profile does not name; the round-trip canonicalizer keys every value.
// The bundles' end-to-end proofs (real snapshots, oracle counts, twins) live in forges/ctdl*/test/.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the shared CTDL-family JSON-LD loader and round-trip canonicalizer on a synthetic profile

SYNOPSIS
     node lib/ctdl-family-forge/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Writes synthetic JSON-LD under os.tmpdir() only, loads it through jsonLdVocabularyLoader with a two-prefix profile,
     and canonicalizes it through jsonLdRoundTripPair. Touches no graph and no repo file.

EXIT STATUS
     0 every assertion passed;  1 otherwise.
`;

const fs = require('fs');
const os = require('os');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const { xLog } = process.global;

const syntheticProfile = Object.freeze({
	profileNote: 'A synthetic two-prefix profile for the shared-lib test.',
	standardSource: 'Synth',
	sourceFileName: 'synth.json',
	descriptionTemplateSubject: 'Synthetic',
	nativePrefixList: ['syn'],
	nativeTermIdList: [],
	seamTargetPrefixList: [],
	sourceStatedInversePredicateList: [],
	termKindByType: { 'rdfs:Class': { termKind: 'class', role: 'DmeClass', perStandardLabel: 'SynthClass', descriptionNoun: 'classes' } },
	termKindOrder: ['class'],
	labelPredicateList: ['rdfs:label'],
	descriptionPredicatePrecedenceList: ['rdfs:comment'],
	languageTag: 'en-US',
	statusPredicate: 'vs:term_status',
	statusValuePrefix: 'vs:',
	statusCarriedByTermKindList: ['class'],
	usageNotePredicate: 'vann:usageNote',
	usageNoteCarriedByTermKindList: [],
	domainlessPropertyRootEdge: false,
	enrichmentKindList: [],
	predicateDispositionByName: { '@id': 'identity', '@type': 'identity', 'rdfs:label': 'label', 'rdfs:comment': 'description', 'rdfs:subClassOf': 'reference' },
	rangeDatatypeRule: { predicateName: 'schema:rangeIncludes', prefixList: ['xsd'], termIdList: [] },
});
const { validateVocabularyProfile } = require(path.join(__dirname, '..', 'vocabularyProfileContract'));
const loader = require(path.join(__dirname, '..', 'jsonLdVocabularyLoader'))({ vocabularyProfile: syntheticProfile });
const roundTripPair = require(path.join(__dirname, '..', 'jsonLdRoundTripPair'))({ vocabularyProfile: syntheticProfile, ruleModulePath: 'lib/ctdl-family-forge/jsonLdRoundTripPair.js' });

const scratchDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ctdlFamilyForgeTest-'));
const writeSource = (graphEntryList) => {
	const sourceFilePath = path.join(scratchDirPath, 'synth.json');
	fs.writeFileSync(sourceFilePath, JSON.stringify({ '@graph': graphEntryList }));
	return sourceFilePath;
};
const label = (text) => ({ 'en-US': text });
const BASE_ENTRY_LIST = Object.freeze([
	{ '@id': 'syn:A', '@type': 'rdfs:Class', 'rdfs:label': label('A'), 'rdfs:comment': label('The A.'), 'rdfs:subClassOf': ['other:Z', 'syn:B'] },
	{ '@id': 'syn:B', '@type': 'rdfs:Class', 'rdfs:label': label('B') },
	{ '@id': 'other:C', '@type': 'rdfs:Class', 'rdfs:label': label('C') },
]);

const taskList = new taskListPlus();
taskList.push((args, next) => loader.loadVocabulary({ sourcePath: writeSource(BASE_ENTRY_LIST), additionalSourceInputPathByName: {}, xLog }, (loadError, loaded) => {
	harness.section('SECTION 1 — the loader partitions by the profile allowlist alone');
	harness.accepts('a well-formed source loads', loadError ? [loadError] : []);
	harness.equal('native entries are the syn: ones', loaded && loaded.nativeEntryList.map((oneEntry) => oneEntry['@id']).join(','), 'syn:A,syn:B');
	harness.equal('the other: entry is foreign, carried whole', loaded && JSON.stringify(loaded.foreignEntryList), JSON.stringify([BASE_ENTRY_LIST[2]]));
	next('', args);
}));
taskList.push((args, next) => loader.loadVocabulary({ sourcePath: writeSource(BASE_ENTRY_LIST.concat([{ '@id': 'syn:D', '@type': 'rdfs:Class', 'rdfs:label': label('D'), 'owl:sameAs': ['x:y'] }])), additionalSourceInputPathByName: {}, xLog }, (loadError) => {
	harness.section('SECTION 2 — a predicate the profile does not name is refused, never ignored');
	harness.rejects('owl:sameAs is not in this profile', loadError ? [loadError] : [], /native 'syn:D' carries predicate 'owl:sameAs', which the profile's predicateDispositionByName does not name/);
	next('', args);
}));
taskList.push((args, next) => roundTripPair.canonicalizeSource({ snapshotPath: writeSource(BASE_ENTRY_LIST), verifiedFileList: [] }, (canonicalizeError, canonical) => {
	harness.section('SECTION 3 — the canonicalizer keys every value, so a key-only diff is a value diff');
	harness.accepts('the source canonicalizes', canonicalizeError ? [canonicalizeError] : []);
	const statementKeyList = canonical ? [...canonical.statements.keys()] : [];
	harness.ok('the label text is in the key', statementKeyList.indexOf('term|syn:A|rdfs:label|A') !== -1, statementKeyList.join('\n'));
	harness.ok('the description text is in the key', statementKeyList.indexOf('term|syn:A|description|The A.') !== -1, statementKeyList.join('\n'));
	harness.ok('a non-native reference is a plain statement', statementKeyList.indexOf('term|syn:A|rdfs:subClassOf|other:Z') !== -1);
	harness.ok('the foreign entry is one statement, verbatim', statementKeyList.some((oneKey) => oneKey.startsWith('foreign|other:C|')));
	next('', args);
}));

taskList.push((args, next) => {
	harness.section('SECTION 4 — the profile is the seam\'s declared interface: an absent or unknown field is refused, never defaulted');
	const refusalOf = (candidateProfile) => {
		let refusalText = '';
		try {
			validateVocabularyProfile(candidateProfile);
		} catch (contractError) {
			refusalText = contractError.message;
		}
		return refusalText;
	};
	const { domainlessPropertyRootEdge, ...withoutFlag } = syntheticProfile;
	harness.rejects('an absent boolean flag is refused, not read as false', [refusalOf(withoutFlag)].filter(Boolean), /field 'domainlessPropertyRootEdge' is absent/);
	harness.rejects('a misspelt field is refused, not ignored', [refusalOf({ ...syntheticProfile, nativePrefixLis: ['x'] })].filter(Boolean), /carries 'nativePrefixLis', which the contract does not name/);
	harness.equal('the complete synthetic profile conforms', refusalOf(syntheticProfile), '');
	next('', args);
});

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	fs.rmSync(scratchDirPath, { recursive: true, force: true });
	harness.report();
});
