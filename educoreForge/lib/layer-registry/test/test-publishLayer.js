#!/usr/bin/env node
'use strict';

// test-publishLayer.js — publishLayer's freeze, idempotence, refusals and split (mappingLayers ML1-b; G-FREEZE's hermetic half). A
// throwaway decision store in the OS temp directory; a STATED registry (literal, never the production file); the sssom-py step is a
// stated double here (the real validator runs in lane M's G-FREEZE script, whose output the gate report pastes), so this suite
// needs no venv. Every refusal is observed on a fixture that states its fault.
//
// Run: node lib/layer-registry/test/test-publishLayer.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for lib/layer-registry/publishLayer

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Publishes a small two-standard set into a temporary store: proves the whole set's hash is the content id, that it splits into
     one block per (standard, hub) pair in a stable order, that a second publish is alreadyPresent, and that each refusal fires by
     name: other bytes under a used tag, these bytes under another tag, an unlisted source, a curated set whose mapping_provider is
     not its author, a judge layer, a set the validator refuses, and a set the exporter's own reader refuses.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const { registryFor } = require('../layerRegistry');
const { publishLayer } = require('../publishLayer');
const decisionStoreLib = require('../../decision-store/decision-store')();

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const AUTHOR_IRI = 'https://w3id.org/EDUcore/agent/org/toyCurator';
const ORGANISATION_IRI = 'https://w3id.org/EDUcore/agent/org/educore';
const JUDGE_IRI = 'https://w3id.org/EDUcore/agent/judge/debug:digest';
const agentRegistry = { agentList: [{ agentIri: ORGANISATION_IRI, agentKind: 'organisation', displayName: 'EDUcore' }, { agentIri: AUTHOR_IRI, agentKind: 'organisation', displayName: 'a toy curator' }, { agentIri: JUDGE_IRI, agentKind: 'judge', displayName: 'the debug judge' }] };
const sourceListsFor = () => ({
	standardList: [{ standardKey: 'toya', standardName: 'ToyA', sourceIri: 'urn:educore:toya:' }, { standardKey: 'toyb', standardName: 'ToyB', sourceIri: 'urn:educore:toyb:' }],
	hubList: [{ hubKey: 'toyhub', hubName: 'ToyHub', sourceIri: 'urn:educore:hub:ToyHub:' }],
});
const statedLayerRegistry = () => ({
	registrationAuthorityIri: ORGANISATION_IRI,
	registrarIri: ORGANISATION_IRI,
	layerList: [
		{ layerKey: 'toyCurated', displayName: 'a toy curated layer', layerKind: 'curated', authorAgentIri: AUTHOR_IRI, ...sourceListsFor(), versionList: [] },
		{ layerKey: 'toyJudge', displayName: 'a toy judge layer', layerKind: 'judge', authorAgentIri: JUDGE_IRI, ...sourceListsFor(), versionList: [] },
	],
});
// the set: two ToyA rows (one a NoTermFound), one ToyB row; source slots per row, hub at set level
const setTextFor = ({ provider = AUTHOR_IRI, commentText = 'a stated fixture', toyBSourceIri = 'urn:educore:toyb:' } = {}) =>
	[
		'#curie_map:',
		'#  toya: "urn:educore:toya:"',
		'#  toyb: "urn:educore:toyb:"',
		'#  urn: "urn:"',
		'#mapping_set_id: "https://w3id.org/EDUcore/layer/toyCurated/r1"',
		`#mapping_provider: ${JSON.stringify(provider)}`,
		'#object_source: "urn:educore:hub:ToyHub:"',
		'#object_source_version: "1.0"',
		`#comment: ${JSON.stringify(commentText)}`,
		['subject_id', 'predicate_id', 'object_id', 'mapping_justification', 'subject_source', 'subject_source_version'].join('\t'),
		['toya:property/Alpha', 'skos:exactMatch', 'https://w3id.org/EDUcore/ToyHub/hub/1.0/aaaa', 'semapv:ManualMappingCuration', 'urn:educore:toya:', '2.0'].join('\t'),
		['toyb:property/Beta', 'skos:closeMatch', 'https://w3id.org/EDUcore/ToyHub/hub/1.0/bbbb', 'semapv:ManualMappingCuration', toyBSourceIri, '3.0'].join('\t'),
		['toya:property/Gamma', 'skos:mappingRelation', 'sssom:NoTermFound', 'semapv:ManualMappingCuration', 'urn:educore:toya:', '2.0'].join('\t'),
	].join('\n') + '\n';
const passingValidator = (validatedPath, validatedCallback) => validatedCallback('');
const refusingValidator = (validatedPath, validatedCallback) => validatedCallback('exit 1: a stated validator refusal');

const temporaryDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'publishLayerTest-'));
const publishArgsFor = ({ layerRegistry, sssomText, layerKey = 'toyCurated', versionTag = 'r1', validateWithSssomPy = passingValidator, decisionStore }) => ({
	sssomText,
	sssomPath: path.join(temporaryDirectoryPath, `${versionTag}.sssom.tsv`),
	layerKey,
	versionTag,
	registry: registryFor({ layerRegistry, agentRegistry }).registry,
	decisionStore,
	publishedAt: '2026-10-24T12:00:00.000Z',
	validateWithSssomPy,
});

decisionStoreLib.open({ databaseFilePath: path.join(temporaryDirectoryPath, 'decisions.sqlite3') }, (openError, decisionStore) => {
	if (openError) {
		harness.ok('the temporary decision store opens', false, openError);
		harness.report();
		return;
	}
	const steps = [];
	const run = (label, args, judge) => steps.push((next) => publishLayer(args, (publishError, published) => { judge(publishError, published); next(published); }));
	let registryAfterFirst = null;
	const setText = setTextFor();

	// =====================================================================
	harness.section('publish: the content id is the bytes\' sha256; one block per (standard, hub) pair, in a stable order');
	// =====================================================================
	run('first', publishArgsFor({ layerRegistry: statedLayerRegistry(), sssomText: setText, decisionStore }), (publishError, published) => {
		harness.ok('the stated set publishes', !publishError, publishError);
		if (publishError) return;
		registryAfterFirst = published.layerRegistry;
		harness.equal('contentId = sha256 of the set bytes', published.contentId, sha256Hex(setText));
		harness.equal('the whole set is frozen under layerSet::toyCurated with that hash', JSON.stringify(published.wholeSetBlock), JSON.stringify({ pairKey: 'layerSet::toyCurated', decisionBlockHash: sha256Hex(setText) }));
		harness.equal('two pair blocks, sorted by pairKey', published.memberBlockList.map((oneMember) => oneMember.pairKey).join(' | '), 'toyhub@1.0::toya@2.0::layer.toyCurated::curated | toyhub@1.0::toyb@3.0::layer.toyCurated::curated');
		harness.equal('the ToyA block carries its two rows (the NoTermFound kept), the ToyB block its one', JSON.stringify(published.rowCountByPairKey), JSON.stringify({ 'toyhub@1.0::toya@2.0::layer.toyCurated::curated': 2, 'toyhub@1.0::toyb@3.0::layer.toyCurated::curated': 1 }));
		harness.equal('the version URI is the edc layer-version IRI', published.layerVersionUri, 'https://w3id.org/EDUcore/layer/toyCurated/r1');
		const appendedVersion = published.layerRegistry.layerList[0].versionList[0];
		harness.equal('the registry gains the version as Candidate', appendedVersion.registrationStatus, 'Candidate');
		harness.equal('  …submitted by its author, under the registry\'s authority', `${appendedVersion.administrationRecord.submitter} / ${appendedVersion.administrationRecord.registrationAuthority}`, `${AUTHOR_IRI} / ${ORGANISATION_IRI}`);
		harness.ok('  …and the appended registry is itself accepted', registryFor({ layerRegistry: published.layerRegistry, agentRegistry }).error === undefined);
	});
	steps.push((next) => {
		// =====================================================================
		harness.section('idempotence and immutability');
		// =====================================================================
		publishLayer(publishArgsFor({ layerRegistry: registryAfterFirst, sssomText: setText, decisionStore }), (againError, again) => {
			harness.ok('the same bytes under the same tag: alreadyPresent, and no new registry', !againError && again.alreadyPresent === true && again.layerRegistry === null, againError);
			const alteredText = setTextFor({ commentText: 'a stated fixturE' });
			publishLayer(publishArgsFor({ layerRegistry: registryAfterFirst, sssomText: alteredText, decisionStore }), (alteredError) => {
				harness.match('one byte altered under the same tag: refused by name', alteredError, /tag 'r1' of layer 'toyCurated' already names other bytes/);
				publishLayer(publishArgsFor({ layerRegistry: registryAfterFirst, sssomText: setText, versionTag: 'r2', decisionStore }), (retagError) => {
					harness.match('the same bytes under another tag: refused by name', retagError, /these bytes are already layer 'toyCurated' version 'r1'/);
					next();
				});
			});
		});
	});
	steps.push((next) => {
		// =====================================================================
		harness.section('refusals before anything is frozen');
		// =====================================================================
		const freshRegistry = statedLayerRegistry();
		publishLayer(publishArgsFor({ layerRegistry: freshRegistry, sssomText: setTextFor({ toyBSourceIri: 'urn:educore:toyc:' }), versionTag: 'r9', decisionStore }), (unlistedError) => {
			harness.match('a row whose subject_source the layer does not list: refused', unlistedError, /subject_source urn:educore:toyc: is not listed by layer 'toyCurated'/);
			publishLayer(publishArgsFor({ layerRegistry: freshRegistry, sssomText: setTextFor({ provider: 'https://example.org/someoneElse' }), versionTag: 'r9', decisionStore }), (providerError) => {
				harness.match("a curated set whose mapping_provider is not its author: refused", providerError, /mapping_provider is "https:\/\/example.org\/someoneElse", not its author/);
				publishLayer(publishArgsFor({ layerRegistry: freshRegistry, sssomText: setText, layerKey: 'toyJudge', versionTag: 'r9', decisionStore }), (judgeError) => {
					harness.match('a judge layer: refused (its bridge freezes it)', judgeError, /is a 'judge' layer/);
					publishLayer(publishArgsFor({ layerRegistry: freshRegistry, sssomText: setText, versionTag: 'r9', validateWithSssomPy: refusingValidator, decisionStore }), (validatorError) => {
						harness.match('a set the validator refuses: refused, with its words', validatorError, /fails sssom validate: exit 1: a stated validator refusal/);
						publishLayer(publishArgsFor({ layerRegistry: freshRegistry, sssomText: setText.replace('#mapping_set_id: "https://w3id.org/EDUcore/layer/toyCurated/r1"\n', ''), versionTag: 'r9', decisionStore }), (readerError) => {
							harness.match("a set the exporter's own reader refuses: refused", readerError, /fails parseSssomTsv: no #mapping_set_id line/);
							publishLayer(publishArgsFor({ layerRegistry: freshRegistry, sssomText: setText, layerKey: 'raters', versionTag: 'r9', decisionStore }), (unknownError) => {
								harness.match('an unregistered layer: refused by name', unknownError, /layerKey "raters" is not in the registry/);
								next();
							});
						});
					});
				});
			});
		});
	});
	const runNext = (stepIndex) => {
		if (stepIndex >= steps.length) {
			fs.rmSync(temporaryDirectoryPath, { recursive: true, force: true });
			harness.report();
			return;
		}
		steps[stepIndex](() => runNext(stepIndex + 1));
	};
	runNext(0);
});
