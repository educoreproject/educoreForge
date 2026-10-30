#!/usr/bin/env node
'use strict';

// test-usecaseForge.js — the use-case forge bundle's hermetic suite (useCaseForge-102926 Phase 1, 2026-10-29). No graph, no Docker:
// the real snapshot through the real forge, the walk driven directly on mutated in-memory corpora, and the round trip over the
// framework's graph double.
//   (a) the bundle: descriptor keys, the factory shape, the forge over snapshot 01
//   (b) T1.2 counts: every role's node count equals the Phase 0 census (evidence/P0/identityCensus.json), counted from the JSON first
//   (c) T1.3 the integrity refusals: each fault fixture refused BY NAME; each refusal's twin (the throw disabled in a module double)
//       ACCEPTS the fixture, so every conjunct is OBSERVED RED
//   (d) the schema twin (an invalid document refused naming the file and the JSON pointer) and the format twin (format 9.9 refused by
//       name), each over a temporary copy of the snapshot
//   (e) T1.4 determinism: two forges of one snapshot, byte-identical; twin: a clock stamped into one stableId differs
//   (f) T1.1 the round trip over the graph double: clean, 0 invented, 0 lost; cheating twin (edges dropped) loses; invention twin invents
//   (g) non-embeddable by declaration: no DmeExternalReference carries a searchText; every other use-case node does
//
// Run: node forges/usecase/test/test-usecaseForge.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the use-case forge: bundle, counts, integrity refusals, schema and format twins, determinism, round trip
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 every conjunct PASS and every twin observed RED;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const moduleDouble = require('../../../lib/forge-framework/test/testSupport/moduleDouble');
const { contractGraphKit } = require('../../../lib/forge-framework/contractGraphKit');
const roundTripHarness = require('../../../lib/forge-framework/roundTripHarness/roundTripHarness')();

const BUNDLE_DIR = path.join(__dirname, '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const WALK_PATH = path.join(BUNDLE_DIR, 'lib', 'usecaseWalk.js');
const forgeDeclaration = require('../lib/usecaseForgeDeclaration');
const usecaseSnapshotLoader = require('../lib/usecaseSnapshotLoader');
const roundTripValidator = require('../roundTripValidator');

// the Phase 0 census (evidence/P0/identityCensus.json, sha256 7b3dc114…), counted from the JSON by a script that shares no code with
// the forge: 190 identifier-bearing nodes, plus the root
const EXPECTED_NODE_COUNT_BY_ROLE = Object.freeze({
	DmeStandardRoot: 1, DmeUseCase: 7, DmeUserStory: 55, DmeActor: 21, DmeCondition: 30, DmeEvent: 5, DmeValueDriver: 7, DmeSubject: 6,
	DmeExternalReference: 29, DmeDataReference: 21, DmeResource: 9,
});

const temporaryDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'test-usecaseForge-'));
const silentLog = { status: () => {}, error: () => {}, warn: () => {}, verbose: () => {}, debug: () => {} };
const cloneJson = (candidate) => JSON.parse(JSON.stringify(candidate));

// forgeOf — the real forge over a snapshot directory
const forgeOf = ({ sourcePath }, callback) => require('../forgeUsecase')({ embedder: null }).forge({ sourcePath, skipEmbedding: true }, callback);

// walkVerdictOf — the walk driven directly over an in-memory corpus: { refusalText } | { nodeCount }
const walkVerdictOf = ({ loaded, mutationList }) => {
	const walk = mutationList.length === 0 ? require(WALK_PATH) : moduleDouble.loadWithMutations({ modulePath: WALK_PATH, mutationList });
	const { kit, kitInternals } = contractGraphKit({ forgeDeclaration, metadata: {} });
	kitInternals.setRootStableId(forgeDeclaration.rootStableId);
	try {
		const result = walk.emitContractGraph({ loaded, kit });
		return { nodeCount: result.nodes.length };
	} catch (walkError) {
		return { refusalText: walkError.message };
	}
};

// a minimal valid case whose only data is a source artifact (the artifact-only grounding fixture)
const artifactOnlyCase = () => ({
	id: 'uc:test-artifact-only',
	shortName: 'Artifact only',
	longName: 'A test case grounded in a source artifact alone',
	level: 'sub-function',
	primaryActor: 'actor:test-reader',
	actors: [{ actor: 'Test Reader', identifier: 'actor:test-reader', role: 'reads', interest: 'knowing' }],
	scenario: [{ codedNotation: '1', kind: 'main', story: { identifier: 'us:test-read-policy', actor: 'actor:test-reader', action: 'reads a policy', intention: 'to know it', consumes: [{ kind: 'artifact', name: 'A policy document', origin: 'the state', role: 'input' }] } }],
	triggeredBy: { name: 'A test trigger', identifier: 'event:test-trigger' },
	subject: 'A test subject',
	guarantees: [{ role: 'success', condition: { statement: 'The policy is known.' } }],
});

// the fault fixtures (each a mutation of the real corpus) and the twin that disables the refusal the fixture must meet
const caseNamed = (loaded, fileName) => loaded.caseRecordList.find((oneRecord) => oneRecord.fileName === `cases/${fileName}`).caseDocument;
const REFUSAL_FIXTURE_LIST = [
	{
		conjunctRefId: 'c1_duplicateName', refusalPattern: /duplicate name: .*longName of cases\/fs002Compilation\.json and of cases\/fs002FederalReporting\.json/,
		fault: (loaded) => { caseNamed(loaded, 'fs002FederalReporting.json').longName = caseNamed(loaded, 'fs002Compilation.json').longName; },
		disableList: ['throw refusal(`duplicate name:'],
	},
	{
		conjunctRefId: 'c2_hierarchyCycle', refusalPattern: /hierarchy cycle: uc:fs002-compilation -> uc:ler-issuance -> uc:fs002-compilation|hierarchy cycle: uc:ler-issuance -> uc:fs002-compilation -> uc:ler-issuance/,
		fault: (loaded) => {
			caseNamed(loaded, 'lerIssuance.json').relatedUseCases.push({ useCase: 'uc:fs002-compilation', relationship: 'child' });
			caseNamed(loaded, 'fs002Compilation.json').relatedUseCases = (caseNamed(loaded, 'fs002Compilation.json').relatedUseCases || []).concat([{ useCase: 'uc:ler-issuance', relationship: 'child' }]);
		},
		disableList: ['throw refusal(`hierarchy cycle:'],
	},
	{
		conjunctRefId: 'c3_unclaimedServes', refusalPattern: /unclaimed serves: cases\/lerIssuance\.json step 1 serves 'vd:idea-618-compliance'/,
		fault: (loaded) => { caseNamed(loaded, 'lerIssuance.json').scenario[0].story.serves = [{ ref: 'vd:idea-618-compliance' }]; },
		disableList: ['throw refusal(`unclaimed serves:'],
	},
	{
		conjunctRefId: 'c4_identifierConflict', refusalPattern: /identifier conflict: condition 'cond:holder-has-wallet' is defined inline at cases\/fs5003Confirmation\.json assumes\/3 and again, differently, at cases\/lerIssuance\.json assumes\/0/,
		fault: (loaded) => { caseNamed(loaded, 'fs5003Confirmation.json').assumes.push({ identifier: 'cond:holder-has-wallet', statement: 'A different claim under the same identifier.' }); },
		disableList: ['throw refusal(`identifier conflict: ${kindName}', "throw refusal(`identifier conflict: '${stableId}' is defined"],
	},
	{
		conjunctRefId: 'c5_ascendingInvocation', refusalPattern: /ascending invocation: cases\/fs002PackageSubmission\.json \(summary\) step 2 invokes 'uc:fs002-compilation' \(summary\)/,
		fault: (loaded) => { caseNamed(loaded, 'fs002Compilation.json').level = 'summary'; },
		disableList: ['throw refusal(`ascending invocation:'],
	},
	{
		conjunctRefId: 'c6_emptyStep', refusalPattern: /empty step: cases\/lerIssuance\.json step 8 has neither a story nor an invokes/,
		fault: (loaded) => { delete caseNamed(loaded, 'lerIssuance.json').scenario.find((step) => step.codedNotation === '8').story; },
		disableList: ['throw refusal(`empty step:'],
	},
	{
		conjunctRefId: 'c7_unresolvableBranchPoint', refusalPattern: /unresolvable branch point: cases\/lerIssuance\.json step 7a branches from '99', which is no step of this case/,
		fault: (loaded) => { caseNamed(loaded, 'lerIssuance.json').scenario.find((step) => step.codedNotation === '7a').branchesFrom = '99'; },
		disableList: ["throw refusal(`unresolvable branch point: ${fileName} step ${step.codedNotation} branches from"],
	},
	{
		conjunctRefId: 'c8_nonExtendingDeviation', refusalPattern: /non-extending deviation notation: cases\/lerIssuance\.json step 7a does not extend its branch point '6'/,
		fault: (loaded) => { caseNamed(loaded, 'lerIssuance.json').scenario.find((step) => step.codedNotation === '7a').branchesFrom = '6'; },
		disableList: ['throw refusal(`non-extending deviation notation:'],
	},
	{
		conjunctRefId: 'c9_artifactOnlyGrounding', refusalPattern: /artifact-only grounding: cases\/zzArtifactOnly\.json \(uc:test-artifact-only\) binds to no DataElement, Standard or OrphanElement/,
		fault: (loaded) => { loaded.caseRecordList.push({ fileName: 'cases/zzArtifactOnly.json', caseDocument: artifactOnlyCase(), formatVersion: '0.11', formatVersionSource: 'schemaId' }); },
		disableList: ['throw refusal(`artifact-only grounding:'],
	},
	{
		conjunctRefId: 'c10_danglingRef', refusalPattern: /dangling ref: cases\/lerIssuance\.json scenario\/0\/story names story 'us:no-such-story'/,
		fault: (loaded) => { caseNamed(loaded, 'lerIssuance.json').scenario[0].story = { ref: 'us:no-such-story' }; },
		disableList: ['throw refusal(`dangling ref:'],
	},
];

const conjunctResultList = [];
const recordConjunct = ({ conjunctRefId, pass, detail }) => conjunctResultList.push({ conjunctRefId, pass, detail });

const taskList = new taskListPlus();

// (a) + (b) + (g): the real forge over the real snapshot
taskList.push((args, next) => {
	harness.section('(a) the bundle: descriptor, factory, the forge over snapshot 01');
	const descriptorText = fs.readFileSync(path.join(BUNDLE_DIR, 'parserDescriptor.ini'), 'utf8');
	harness.ok('parserDescriptor.ini carries the section header and the five keys', /^\[parserDescriptor\]$/m.test(descriptorText) && ['standardName=UseCase', 'entryModule=forgeUsecase.js', 'roundTripValidator=roundTripValidator.js', 'defaultSnapshot=01'].every((oneLine) => descriptorText.indexOf(oneLine) !== -1), descriptorText.slice(0, 120));
	forgeOf({ sourcePath: SNAPSHOT_DIR }, (forgeError, forgeResult) => {
		harness.ok('the forge over snapshot 01 succeeds', !forgeError, forgeError);
		if (forgeError) {
			next(forgeError);
			return;
		}
		harness.ok('metadata: release 1.0 from the provenance file, the published standard as sourceUrl', forgeResult.metadata.version === '1.0' && forgeResult.metadata.versionSource === 'provenance-file' && forgeResult.metadata.sourceUrl === 'https://genericwhite.com/26/educore/useCaseV11/', JSON.stringify(forgeResult.metadata).slice(0, 300));

		harness.section('(b) T1.2 the node counts equal the Phase 0 census');
		const countByRole = forgeResult.nodes.reduce((byRole, oneNode) => ({ ...byRole, [oneNode.role]: (byRole[oneNode.role] || 0) + 1 }), {});
		harness.equal('node count by role', JSON.stringify(Object.keys(countByRole).sort().map((oneRole) => [oneRole, countByRole[oneRole]])), JSON.stringify(Object.keys(EXPECTED_NODE_COUNT_BY_ROLE).sort().map((oneRole) => [oneRole, EXPECTED_NODE_COUNT_BY_ROLE[oneRole]])));
		const caseNodeList = forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeUseCase');
		harness.ok('every case carries formatVersion 0.11 from the schema $id (R3)', caseNodeList.every((oneNode) => oneNode.properties.formatVersion === '0.11' && oneNode.properties.formatVersionSource === 'schemaId'), JSON.stringify(caseNodeList.map((oneNode) => [oneNode.stableId, oneNode.properties.formatVersion, oneNode.properties.formatVersionSource])));

		harness.section('(g) non-embeddable by declaration');
		const externalWithText = forgeResult.nodes.filter((oneNode) => oneNode.role === 'DmeExternalReference' && oneNode.properties.searchText !== undefined);
		const otherWithoutText = forgeResult.nodes.filter((oneNode) => oneNode.role !== 'DmeExternalReference' && oneNode.properties.searchText === undefined);
		harness.ok('no DmeExternalReference carries a searchText; every other node does', externalWithText.length === 0 && otherWithoutText.length === 0, `external with text ${externalWithText.length}, others without ${otherWithoutText.map((oneNode) => oneNode.stableId).join(', ')}`);
		next('', { ...args, forgeResult });
	});
});

// (c) the integrity refusals
taskList.push((args, next) => {
	harness.section('(c) T1.3 the integrity refusals, each fixture refused BY NAME');
	usecaseSnapshotLoader.loadSnapshot({ sourcePath: SNAPSHOT_DIR, additionalSourceInputPathByName: {}, xLog: silentLog }, (loadError, loaded) => {
		if (loadError) {
			next(loadError);
			return;
		}
		const baseline = walkVerdictOf({ loaded: cloneJson(loaded), mutationList: [] });
		harness.ok('the unmutated corpus passes the walk', baseline.refusalText === undefined, baseline.refusalText);
		REFUSAL_FIXTURE_LIST.forEach((oneFixture) => {
			const faulted = cloneJson(loaded);
			oneFixture.fault(faulted);
			const verdict = walkVerdictOf({ loaded: faulted, mutationList: [] });
			const pass = verdict.refusalText !== undefined && oneFixture.refusalPattern.test(verdict.refusalText);
			harness.ok(`${oneFixture.conjunctRefId} refused by name`, pass, verdict.refusalText || 'ACCEPTED');
			recordConjunct({ conjunctRefId: oneFixture.conjunctRefId, pass, detail: verdict.refusalText });
		});
		harness.section('(c) THE TWIN SWEEP — each refusal disabled in a module double; the fixture is then NOT refused by name (RED)');
		REFUSAL_FIXTURE_LIST.forEach((oneFixture) => {
			const mutationList = oneFixture.disableList.map((findText) => {
				moduleDouble.assertMutationApplies({ modulePath: WALK_PATH, find: findText });
				return { modulePath: WALK_PATH, find: findText, replace: findText.replace('throw refusal(', 'void refusal(') };
			});
			const faulted = cloneJson(loaded);
			oneFixture.fault(faulted);
			const verdict = walkVerdictOf({ loaded: faulted, mutationList });
			const stillRefusedByName = verdict.refusalText !== undefined && oneFixture.refusalPattern.test(verdict.refusalText);
			harness.ok(`${oneFixture.conjunctRefId} observed RED with its refusal disabled`, !stillRefusedByName, verdict.refusalText || 'accepted');
			harness.note(`RED-OBSERVED ${oneFixture.conjunctRefId} twin='refusalDisabled' → ${stillRefusedByName ? 'STILL REFUSED' : `FAIL: ${verdict.refusalText ? `refused otherwise: ${verdict.refusalText.slice(0, 120)}` : 'the fault was accepted'}`}`);
		});
		next('', { ...args, loaded });
	});
});

// (d) the schema twin and the format twin, over temporary snapshot copies
const snapshotCopyWith = ({ copyName, editCase }) => {
	const copyDirPath = path.join(temporaryDirPath, copyName);
	fs.cpSync(SNAPSHOT_DIR, copyDirPath, { recursive: true });
	const caseFilePath = path.join(copyDirPath, 'cases', 'lerIssuance.json');
	const caseDocument = JSON.parse(fs.readFileSync(caseFilePath, 'utf8'));
	editCase(caseDocument);
	fs.writeFileSync(caseFilePath, JSON.stringify(caseDocument, null, '\t'));
	const checksumText = fs.readFileSync(path.join(copyDirPath, 'SHA256SUMS'), 'utf8').split('\n').filter((oneLine) => oneLine.trim() !== '').map((oneLine) => {
		const relativePath = oneLine.replace(/^[0-9a-f]{64}\s+/, '');
		return `${crypto.createHash('sha256').update(fs.readFileSync(path.join(copyDirPath, relativePath))).digest('hex')}  ${relativePath}`;
	}).join('\n');
	fs.writeFileSync(path.join(copyDirPath, 'SHA256SUMS'), `${checksumText}\n`);
	return copyDirPath;
};
taskList.push((args, next) => {
	harness.section('(d) the schema twin and the format twin');
	forgeOf({ sourcePath: snapshotCopyWith({ copyName: 'schemaTwin', editCase: (caseDocument) => { caseDocument.level = 'banana'; } }) }, (schemaError) => {
		const schemaPass = typeof schemaError === 'string' && /'cases\/lerIssuance\.json' fails the format 0\.11 schema \(formats\/v011-schema\.json\) at '\/level'/.test(schemaError);
		harness.ok('d1_schemaTwin: an invalid document is refused naming the file and the JSON pointer', schemaPass, schemaError || 'ACCEPTED');
		forgeOf({ sourcePath: snapshotCopyWith({ copyName: 'formatTwin', editCase: (caseDocument) => { caseDocument.formatVersion = '9.9'; } }) }, (formatError) => {
			const formatPass = typeof formatError === 'string' && /'cases\/lerIssuance\.json' names format version '9\.9', and the snapshot holds a schema for 0\.11 only/.test(formatError);
			harness.ok('d2_formatTwin: a case naming format 9.9 is refused by name', formatPass, formatError || 'ACCEPTED');
			// the unedited copy forges: the twins' refusals come from the edit, not from the copying
			forgeOf({ sourcePath: snapshotCopyWith({ copyName: 'controlCopy', editCase: () => {} }) }, (controlError) => {
				harness.ok('the unedited temporary copy forges (the control)', !controlError, controlError);
				next('', args);
			});
		});
	});
});

// (e) determinism
taskList.push((args, next) => {
	harness.section('(e) T1.4 determinism: two forges, byte-identical; a clock stamped in one stableId is caught');
	forgeOf({ sourcePath: SNAPSHOT_DIR }, (secondError, secondResult) => {
		if (secondError) {
			next(secondError);
			return;
		}
		const firstText = JSON.stringify({ nodes: args.forgeResult.nodes, edges: args.forgeResult.edges });
		const secondText = JSON.stringify({ nodes: secondResult.nodes, edges: secondResult.edges });
		harness.ok('two forges of snapshot 01 are byte-identical', firstText === secondText, `${firstText.length} vs ${secondText.length} chars`);
		const clockedWalk = moduleDouble.loadWithMutations({ modulePath: WALK_PATH, mutationList: [{ modulePath: WALK_PATH, find: "const stableId = `${MINTED_PREFIX}ref/${citation.standard}`;", replace: "const stableId = `${MINTED_PREFIX}ref/${citation.standard}-${Date.now()}`;" }] });
		const { kit, kitInternals } = contractGraphKit({ forgeDeclaration: { ...forgeDeclaration, stableIdPattern: { pattern: '.+', trimmed: true } }, metadata: {} });
		kitInternals.setRootStableId(forgeDeclaration.rootStableId);
		usecaseSnapshotLoader.loadSnapshot({ sourcePath: SNAPSHOT_DIR, additionalSourceInputPathByName: {}, xLog: silentLog }, (loadError, loaded) => {
			const clockedText = JSON.stringify(clockedWalk.emitContractGraph({ loaded, kit }).nodes.map((oneNode) => oneNode.stableId).sort());
			const realText = JSON.stringify(args.forgeResult.nodes.filter((oneNode) => oneNode.role !== 'DmeStandardRoot').map((oneNode) => oneNode.stableId).sort());
			harness.ok('e_determinism observed RED: a clock in the wholesale reference id changes the node ids', clockedText !== realText, 'the clocked walk minted the same ids');
			harness.note(`RED-OBSERVED e_determinism twin='clockInStableId' → ${clockedText !== realText ? 'FAIL: the ids differ' : 'STILL EQUAL'}`);
			next('', args);
		});
	});
});

// (f) the round trip over the graph double
const verdictOverDouble = ({ forgeResult, outputName }, callback) => {
	const outputPath = path.join(temporaryDirPath, outputName);
	fs.mkdirSync(outputPath, { recursive: true });
	roundTripValidator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: SNAPSHOT_DIR, outputPath, graphIdentity: { containerName: 'graphDouble' } }, callback);
};
taskList.push((args, next) => {
	harness.section('(f) T1.1 the round trip over the graph double');
	verdictOverDouble({ forgeResult: args.forgeResult, outputName: 'clean' }, (verdictError, verdict) => {
		harness.ok('the validator produces a verdict', !verdictError, verdictError);
		if (verdictError) {
			next(verdictError);
			return;
		}
		harness.ok('roundTripClean, invented 0, lost 0', verdict.roundTripClean === true && verdict.inventedTotal === 0 && verdict.lostTotal === 0, JSON.stringify({ roundTripClean: verdict.roundTripClean, inventedTotal: verdict.inventedTotal, lostTotal: verdict.lostTotal }));
		harness.ok('the omissions are exactly the registry entries and the format schema', verdict.explicitlyOmittedTotal === 7 && verdict.explicitlyOmittedList.every((oneItem) => ['resolutionRegistryEntry', 'formatSchema'].indexOf(oneItem.kind) !== -1), JSON.stringify(verdict.explicitlyOmittedList.map((oneItem) => oneItem.kind)));
		const droppedResult = { ...args.forgeResult, edges: args.forgeResult.edges.filter((oneEdge, edgeIndex) => !(oneEdge.type === 'CONSUMES' && edgeIndex % 50 === 0)) };
		verdictOverDouble({ forgeResult: droppedResult, outputName: 'cheating' }, (droppedError, droppedVerdict) => {
			const cheatingCaught = !droppedError && droppedVerdict.lostTotal > 0 && droppedVerdict.roundTripClean === false;
			harness.ok('f_cheatingDetector observed RED: CONSUMES edges dropped from the double are lost', cheatingCaught, droppedError || `lost ${droppedVerdict.lostTotal}`);
			harness.note(`RED-OBSERVED f_cheatingDetector twin='edgesDropped' → ${cheatingCaught ? `FAIL: lost ${droppedVerdict.lostTotal}` : 'STILL CLEAN'}`);
			const inventedResult = cloneJson({ nodes: args.forgeResult.nodes, edges: args.forgeResult.edges });
			inventedResult.nodes.find((oneNode) => oneNode.role === 'DmeUseCase').properties.frequency = 'hourly';
			verdictOverDouble({ forgeResult: inventedResult, outputName: 'invention' }, (inventedError, inventedVerdict) => {
				const inventionCaught = !inventedError && inventedVerdict.inventedTotal > 0;
				harness.ok('f_inventionDetector observed RED: a frequency the source never states is invented', inventionCaught, inventedError || `invented ${inventedVerdict.inventedTotal}`);
				harness.note(`RED-OBSERVED f_inventionDetector twin='propertyInvented' → ${inventionCaught ? `FAIL: invented ${inventedVerdict.inventedTotal}` : 'STILL CLEAN'}`);
				next('', args);
			});
		});
	});
});

pipeRunner(taskList.getList(), {}, (pipeError) => {
	if (pipeError) {
		harness.ok('the suite ran to the end', false, pipeError);
	}
	fs.rmSync(temporaryDirPath, { recursive: true, force: true });
	harness.report();
});
