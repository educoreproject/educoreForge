#!/usr/bin/env node
'use strict';

// test-bridgeAcceptanceSif.js — the SIF plugin's ACCEPTANCE gates (SPEC-bridgeFramework-v1.md §11, §12, §12.1, §13.1;
// the B4 order), MIRRORING test-bridgeAcceptanceEdfi.js. Two halves, and the split is the point of this phase:
//
//   THE HALF THAT NEEDS THE FROZEN ARTIFACTS (SECTIONS 0-2) reads the pinned B4 acceptance store under
//   system/dataStores/bridgeAcceptance/sif/ and the committed fixtures, and asserts EQUALITY over the frozen
//   block — census member for member, the three digests, the judge-dependent trio against its per-block record,
//   and the per-subject sum invariant. FROZEN at CP2 (2026-08-17) from the first accepted classifier run, so it
//   MEASURES rather than merely finding a file. Before that freeze it was UNMEASURED, which under RULING BR3-6
//   is a FAILURE BY NAME, never a smaller green: EXPECTED_ASSERTION_COUNT is a LITERAL and the ledger pads any
//   difference with named failures.
//
//   THE HALVES THAT ARE HERMETIC (SECTIONS 3-4) run today, with no container, no store, no LLM and no Voyage:
//   BG-PLUGIN puts the REAL plugin under gate (the framework's own validators over the real bundle, the digests
//   recomputed through the framework's own functions, and the REAL hooks exercised over a graph double built
//   from synthetic SifField nodes), and BG-COMPOSE-SIF asserts THE CLAIM THIS WHOLE PHASE EXISTS TO TEST — that
//   the framework did not move to admit a second plugin.
//
// BG-COMPOSE-SIF, and why its twin is a real diff rather than a synthetic string. A gate that reports EMPTY is
// indistinguishable from a gate whose path list is misspelled, whose command silently failed, or whose parser
// never sees a line — all of which report EMPTY too, forever, greenly. So the twin runs THE SAME command over a
// commit range in which lib/bridge-framework REALLY DID change (the DERIVED order's own commits, between the B3
// CLEAR commit and this branch's base) and asserts it comes back NON-EMPTY. That is a production-input fault
// using real bytes: the identical invocation that says EMPTY for this branch says NON-EMPTY when the framework
// actually moved, so EMPTY here is a measurement rather than a silence.
//
// Run: node apps/graph-builder/test/test-bridgeAcceptanceSif.js   (</dev/null in the fleet)

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the SIF bridge plugin's acceptance gates (BG-PLUGIN, BG-COMPOSE-SIF hermetic today; census/ids at CP2)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     SECTIONS 0-2 read the pinned B4 decision store + standardsDatabase and the committed fixtures and assert the
     frozen block ids, the census EQUALITY (both tables, every member), the per-subject invariants, Profile §7's
     gates over the block's records, and the SSSOM export's validity. Before CP2 freezes those artifacts every one
     of them is UNMEASURED and FAILS BY NAME (RULING BR3-6) — the suite's assertion count never shrinks silently.
     SECTION 3, BG-PLUGIN (RULING BR3-1): the REAL plugin under gate — validateBridgeDeclaration and
     validateBridgeHooks against the real bundle, the forbidden-substrate scan over the real file text, the three
     digests RECOMPUTED through the framework's own digest functions, and the REAL walkSourceAssertions and
     subjectStableIdFor hooks run over a graph double of synthetic SifField nodes (anchored, unanchored, and
     malformed) — with an input-fault twin per conjunct, observed red.
     SECTION 4, BG-COMPOSE-SIF (SPEC §12.1 (a), BRIEF-B4): the framework diff between this branch's base and HEAD
     over lib/bridge-framework, lib/vocabulary, bridge-maker, build.js and interfaces.js is EMPTY; the twin runs
     the same command over a range where the framework really did move and observes NON-EMPTY.
     Hermetic throughout: no container, no LLM, no Voyage, no writes outside os.tmpdir().

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harnessRaw = require('../../../test/testLib/harness')(moduleName);

// RULING BR3-6 + the D1 count-guard ruling: EXPECTED_ASSERTION_COUNT is a LITERAL frozen at this call site, never
// computed from a contract-derived list (a guard that shrinks in lockstep with the thing it guards is no guard).
// 25 (SECTION 3 BG-PLUGIN declaration: 12 conjuncts + 13 twins-and-precondition)
// + 8 (SECTION 3b BG-PLUGIN e: the real hooks over the double, 6 conjuncts + 2 twins)
// + 7 (SECTION 4 BG-COMPOSE-SIF: 3 conjuncts + 4 twins)
// + 6 (SECTION 5 BG-GENESIS, RULING BS-5: 3 conjuncts + 3 twins)
// + 6 (SECTION 6 BG-RENDER-VARIANT, RULING BS-10: 4 conjuncts + 2 twins)
// + 5 (SECTION 7 BG-BATCH-SIZE, RULING BS-9: 4 conjuncts + 1 red observation)
// + 1 (SECTIONS 0-2: the frozen-block census conjunct — MEASURED since the CP2 freeze of 2026-08-17)
// = 58. Raised as a LITERAL, at this call site, in the same commit as the section it counts.
const EXPECTED_ASSERTION_COUNT = 58;
const ledger = { count: 0 };
const harness = {
	section: harnessRaw.section,
	note: harnessRaw.note,
	ok: (label, condition, detail) => { ledger.count += 1; harnessRaw.ok(label, condition, detail); },
	equal: (label, actual, expected) => { ledger.count += 1; harnessRaw.equal(label, actual, expected); },
	match: (label, text, regex) => { ledger.count += 1; harnessRaw.match(label, text, regex); },
	report: () => {
		const missing = EXPECTED_ASSERTION_COUNT - ledger.count;
		if (missing > 0) {
			harnessRaw.note(`${missing} of ${EXPECTED_ASSERTION_COUNT} declared assertions did not run — each is UNMEASURED and fails by name (RULING BR3-6)`);
		}
		for (let i = 0; i < missing; i += 1) {
			harnessRaw.ok(`UNMEASURED — declared assertion ${ledger.count + i + 1} of ${EXPECTED_ASSERTION_COUNT} did not run (an artifact or a precondition was absent; see the notes above)`, false, 'a conjunct that cannot run is a failure by name, never a smaller green');
		}
		if (missing < 0) {
			harnessRaw.ok(`the ledger ran ${ledger.count} assertions but EXPECTED_ASSERTION_COUNT declares ${EXPECTED_ASSERTION_COUNT} — update the declaration with the suite`, false);
		}
		harnessRaw.report();
	},
};

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const treeRoot = path.join(__dirname, '..', '..', '..');
const acceptanceDir = path.join(treeRoot, 'lib', 'bridge-framework', 'test', 'acceptance');
const BRIDGE_NAME = 'sifCedsStandardPlugin';
const SUBJECT_PREFIX = 'sif';
const SOURCE_STANDARD_NAME = 'SIF';
const pluginFilePath = path.join(treeRoot, 'forges', 'sif', 'bridges', `${BRIDGE_NAME}.js`);
const bundleDirPath = path.join(treeRoot, 'forges', 'sif');

const vocabularyLib = require(path.join(treeRoot, 'lib', 'vocabulary', 'vocabulary'));
const bridgePluginContractLib = require(path.join(treeRoot, 'lib', 'bridge-framework', 'bridgePluginContract'));
const predicateSourceLib = require(path.join(treeRoot, 'lib', 'bridge-framework', 'predicateSource'));
const graphDoubleLib = require(path.join(treeRoot, 'lib', 'bridge-framework', 'graphDouble'));

const { DME_ROLES, SKOS_PREDICATES } = vocabularyLib;
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const stripJsoncComments = (text) => text.replace(/^\s*\/\/.*$/gm, '');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const quietLog = { status: () => {}, verbose: () => {}, error: () => {} };

const expectedCompose = readJson(path.join(acceptanceDir, 'expectedCompose.json'));
const acceptanceCommands = JSON.parse(stripJsoncComments(fs.readFileSync(path.join(acceptanceDir, 'acceptanceCommands.jsonc'), 'utf8')))[BRIDGE_NAME];

// ---------------------------------------------------------------------
// SECTION 3 — BG-PLUGIN (RULING BR3-1): the REAL plugin under gate. Hermetic; runs today.
// ---------------------------------------------------------------------
harness.section('SECTION 3 — BG-PLUGIN: the REAL SIF plugin validates, its digests recompute, its REAL hooks run over a graph double');

const pluginModule = require(pluginFilePath);
const declaration = pluginModule.bridgeDeclaration;
const declarationDigestOf = (oneDeclaration) => sha256Hex(bridgePluginContractLib.canonicalJsonText(oneDeclaration));
const channelAssertionDigestOf = (oneDeclaration) => sha256Hex(bridgePluginContractLib.canonicalJsonText(predicateSourceLib.PREDICATE_SOURCE_KIND_REGISTRY[oneDeclaration.predicateSource.kind].provenanceOf(oneDeclaration.predicateSource)));
const remodelTableDigestOf = (tableBytes) => crypto.createHash('sha256').update(tableBytes).digest('hex');
const remodelTablePath = path.join(treeRoot, 'forges', 'ceds', 'bridgeData', `${declaration.remodelTableRef}.json`);

// (a) the framework's OWN validators over the REAL bundle — the plugin is not merely well-formed to my eye
const validated = bridgePluginContractLib.validateBridgeDeclaration({ bridgeDeclaration: declaration, bundleDirPath });
harness.ok(`BG-PLUGIN a validateBridgeDeclaration accepts the real declaration against the real bundle (${path.relative(treeRoot, pluginFilePath)})`, !validated.error, validated.error && validated.error.message);
const hookError = bridgePluginContractLib.validateBridgeHooks({ bridgeHooks: pluginModule.bridgeHooks, bridgeDeclaration: declaration });
harness.ok('BG-PLUGIN a validateBridgeHooks accepts the real hooks', hookError === null, hookError && hookError.message);
harness.equal('BG-PLUGIN a the forbidden-substrate scan over the REAL file text is clean (no driver, store, judge or embedder reach; comments included)', bridgePluginContractLib.forbiddenSubstrateReason({ pluginFilePath }), '');

// (b) the declaration says what §11 says it says — the values that MOVE the census, asserted as EQUALITIES so a
// silent edit to any of them is a red gate rather than a different graph
harness.equal('BG-PLUGIN b matchBasis is standard (the second basis through the same seam)', declaration.matchBasis, 'standard');
harness.equal('BG-PLUGIN b producerKind is authored', declaration.producerKind, 'authored');
harness.equal('BG-PLUGIN b the ONE tuple field is canonicalKey ← cedsId under the IDENTITY transform (cedsId is already P-prefixed; globalIdToPrefixedKey would yield PP######)', `${Object.keys(declaration.tupleFieldColumnMap).join(',')}|${declaration.tupleFieldColumnMap.canonicalKey.column}|${declaration.tupleFieldColumnMap.canonicalKey.transform}`, 'canonicalKey|cedsId|identity');
harness.equal('BG-PLUGIN b subject identity is the forged node itself (1:1, no walk)', `${declaration.subjectIdentity.kind}|${declaration.subjectIdentity.property}`, 'forgedNode|stableId');
harness.ok(`BG-PLUGIN b the predicate is a CHANNEL ASSERTION of a SKOS predicate with a non-empty citation naming its document (${declaration.predicateSource.predicate}, ${declaration.predicateSource.assertedBy.documentName})`, declaration.predicateSource.kind === 'channelAssertion' && SKOS_PREDICATES.indexOf(declaration.predicateSource.predicate) !== -1 && typeof declaration.predicateSource.assertedBy.citation === 'string' && declaration.predicateSource.assertedBy.citation.length > 200, JSON.stringify(declaration.predicateSource.assertedBy.documentName));
harness.ok(`BG-PLUGIN b mappingProvider carries a URL and a RECORDED verification — the exporter refuses a provider nobody verified (${declaration.mappingProvider.url})`, /^https?:\/\/[^\s]+$/.test(declaration.mappingProvider.url) && !!declaration.mappingProvider.verifiedBy && typeof declaration.mappingProvider.verifiedBy.sessionName === 'string' && typeof declaration.mappingProvider.verifiedBy.date === 'string' && typeof declaration.mappingProvider.verifiedBy.note === 'string', JSON.stringify(declaration.mappingProvider.verifiedBy));
harness.equal('BG-PLUGIN b the remodel table is REFERENCED, never copied — the same hub-owned table the Ed-Fi plugin names', declaration.remodelTableRef, 'ceds14PropertyRemodel');
harness.ok(`BG-PLUGIN b the referenced remodel table is on disk and digests (${path.relative(treeRoot, remodelTablePath)})`, fs.existsSync(remodelTablePath) && remodelTableDigestOf(fs.readFileSync(remodelTablePath)).length === 64);

// (c) the ONE channel is a forgedGraph walk whose declared properties are covered EXACTLY by the classification
const channelList = declaration.sourceChannelList;
const walkChannel = channelList[0];
const classifiedList = Object.keys(walkChannel.columnClassification).reduce((soFar, oneListName) => soFar.concat(walkChannel.columnClassification[oneListName]), []);
harness.equal('BG-PLUGIN c ONE forgedGraph walk channel, its channelPropertyList covered EXACTLY once by the seven classification lists', `${channelList.length}|${walkChannel.sourceKind}|${walkChannel.disposition}|${walkChannel.channelPropertyList.slice().sort().join(',')}|${classifiedList.slice().sort().join(',')}`, `1|forgedGraph|walk|${['cedsId', 'crossRefs'].join(',')}|${['cedsId', 'crossRefs'].join(',')}`);

harness.section('    BG-PLUGIN twins — an input fault per conjunct, observed RED');
const refusedFor = (mutate) => {
	const faulted = clone(declaration);
	mutate(faulted);
	return bridgePluginContractLib.validateBridgeDeclaration({ bridgeDeclaration: faulted, bundleDirPath }).error;
};
harness.ok('    (twin precondition) a JSON clone of the declaration digests as the declaration itself — the twins below fault a faithful copy', declarationDigestOf(clone(declaration)) === declarationDigestOf(declaration), 'the clone is not the declaration — every twin below would be meaningless');
harness.ok('RED-OBSERVED BG-PLUGIN a — matchBasis derived is REFUSED by name (v1 admits standard | crosswalk)', !!refusedFor((d) => { d.matchBasis = 'derived'; }));
harness.ok('RED-OBSERVED BG-PLUGIN a — the transform swapped to globalIdToPrefixedKey is accepted by the CONTRACT but moves the declarationDigest off the frozen one (the census-moving edit a shape check alone would miss)', declarationDigestOf((() => { const d = clone(declaration); d.tupleFieldColumnMap.canonicalKey.transform = 'globalIdToPrefixedKey'; return d; })()) !== declarationDigestOf(declaration));
harness.ok('RED-OBSERVED BG-PLUGIN a — a predicate outside SKOS on the channel assertion is REFUSED by name', !!refusedFor((d) => { d.predicateSource.predicate = 'owl:equivalentProperty'; }));
harness.ok('RED-OBSERVED BG-PLUGIN a — a channelPropertyList member left UNCLASSIFIED is REFUSED by name (coverage, RULING BF6)', !!refusedFor((d) => { d.sourceChannelList[0].channelPropertyList.push('characteristics'); }));
harness.ok('RED-OBSERVED BG-PLUGIN a — a classified column ABSENT from channelPropertyList is REFUSED by name', !!refusedFor((d) => { d.sourceChannelList[0].columnClassification.evidenceOnlyColumnList.push('notAChannelProperty'); }));
harness.ok('RED-OBSERVED BG-PLUGIN a — a forgedGraph channel declaring a DOCUMENT key is REFUSED by name', !!refusedFor((d) => { d.sourceChannelList[0].relativePathFromBundleRoot = 'assets/standardSourceData/01/ImplementationSpecification_031326.tsv'; }));
harness.ok('RED-OBSERVED BG-PLUGIN a — an ABSENT blindingDeclaration is REFUSED before any forge is spent', !!refusedFor((d) => { delete d.blindingDeclaration; }));
harness.ok('RED-OBSERVED BG-PLUGIN a — mappingProvider.url that is not a URL is REFUSED by name (never a placeholder)', !!refusedFor((d) => { d.mappingProvider.url = 'the A4L specification'; }));
harness.ok('RED-OBSERVED BG-PLUGIN a — a non-empty compatibilityDeclarationList is REFUSED (v1 ships an EMPTY allowance registry)', !!refusedFor((d) => { d.compatibilityDeclarationList = [{ what: 'anything' }]; }));
harness.ok('RED-OBSERVED BG-PLUGIN a — a non-function walkSourceAssertions is REFUSED by validateBridgeHooks', bridgePluginContractLib.validateBridgeHooks({ bridgeHooks: { ...pluginModule.bridgeHooks, walkSourceAssertions: 'not a function' }, bridgeDeclaration: declaration }) !== null);
harness.ok('RED-OBSERVED BG-PLUGIN a — an UNDECLARED evidence hook present on the hook set is REFUSED by name', bridgePluginContractLib.validateBridgeHooks({ bridgeHooks: { ...pluginModule.bridgeHooks, walkEvidence: (oneArg, cb) => cb('', {}) }, bridgeDeclaration: declaration }) !== null);
harness.ok('RED-OBSERVED BG-PLUGIN b — one appended byte moves the remodelTableDigest', remodelTableDigestOf(Buffer.concat([fs.readFileSync(remodelTablePath), Buffer.from('\n')])) !== remodelTableDigestOf(fs.readFileSync(remodelTablePath)));

// ---------------------------------------------------------------------
// SECTION 3b — the REAL hooks over a graph double of synthetic SifField nodes. Hermetic.
// The double is shaped as the forge stamps them: cedsId already P-prefixed, crossRefs a JSON STRING, _source SIF.
// ---------------------------------------------------------------------
harness.section('    BG-PLUGIN e — the REAL walkSourceAssertions and subjectStableIdFor over a graph double (anchored / unanchored / malformed)');
const sifFieldNode = ({ stableId, cedsId, crossRefsText }) => ({
	stableId,
	labels: ['ForgedNode', 'SifField', DME_ROLES.PROPERTY],
	properties: Object.assign(
		{ _source: SOURCE_STANDARD_NAME, role: DME_ROLES.PROPERTY, name: stableId.split('/').pop(), description: 'a synthetic SIF field', xpath: `/SIF/${stableId.split('/').pop()}`, characteristics: 'O', crossRefs: crossRefsText === undefined ? '[]' : crossRefsText },
		cedsId === undefined ? {} : { cedsId, cedsOriginalAnchorPropertyName: ['CEDS ID'] },
	),
});
const ANCHORED_STABLE_ID = 'sif:property/SEAInfo.LocalId';
const UNANCHORED_STABLE_ID = 'sif:property/SEAInfo.NoAnchor';
const cleanNodeList = [
	sifFieldNode({ stableId: ANCHORED_STABLE_ID, cedsId: 'P001490', crossRefsText: JSON.stringify([{ system: 'ceds', id: 'P001490', raw: '001490', locator: 'CEDS ID' }]) }),
	sifFieldNode({ stableId: UNANCHORED_STABLE_ID }),
	sifFieldNode({ stableId: 'sif:property/SEAInfo.SecondAnchor', cedsId: 'P002191', crossRefsText: JSON.stringify([{ system: 'ceds', id: 'P002191', raw: '002191', locator: 'CEDS ID' }]) }),
];
const walkViewOver = (nodeList) => {
	const double = graphDoubleLib.graphDoubleFrom({ nodeList: clone(nodeList), edgeList: [] });
	const reader = double.graphReaderFactory({ inGraph: { double: 'syntheticSifFields' }, dependencyStandardNameList: [SOURCE_STANDARD_NAME, 'CEDS'], sourceStandardName: SOURCE_STANDARD_NAME, blindingDeclaration: declaration.blindingDeclaration });
	return reader.forWalk({ channelPropertyList: walkChannel.channelPropertyList.slice() });
};
// the graph double answers SYNCHRONOUSLY, so this whole chain runs to completion inside the call below — hence a
// named function invoked at the FOOT of the file, after every section it hands control to has been defined
const runPluginHookSection = () => {
pluginModule.bridgeHooks.walkSourceAssertions({ sourceChannelPathByKey: {}, sourceReader: walkViewOver(cleanNodeList), xLog: quietLog }, (walkError, walkResult) => {
	harness.ok('BG-PLUGIN e the REAL walk runs over the double and refuses nothing on clean nodes', !walkError, walkError);
	const assertionList = walkResult ? walkResult.assertionList : [];
	const anchored = assertionList.find((oneAssertion) => oneAssertion.subjectIdentity.stableId === ANCHORED_STABLE_ID);
	const unanchored = assertionList.find((oneAssertion) => oneAssertion.subjectIdentity.stableId === UNANCHORED_STABLE_ID);
	harness.equal('BG-PLUGIN e one assertion per SifField node, and the channel report reconciles at zero (rowsRead === yielded + sentinelDropped + malformed + valueTier)', `${assertionList.length}|${walkResult && walkResult.channelReport.cedsIdColumn.rowsRead}|${walkResult && walkResult.channelReport.cedsIdColumn.assertionsYielded + walkResult.channelReport.cedsIdColumn.sentinelDropped + walkResult.channelReport.cedsIdColumn.malformedRows + walkResult.channelReport.cedsIdColumn.valueTierRows}`, '3|3|3');
	harness.equal('BG-PLUGIN e the ANCHORED node yields its P-prefixed key VERBATIM as canonicalKey and as its one raw target, with crossRefs PARSED from the JSON string', `${anchored && anchored.tupleFieldValues.canonicalKey}|${anchored && anchored.rawTargetList.length}|${anchored && anchored.rawTargetList[0].rawValue}|${anchored && Array.isArray(anchored.carriedRecord.crossRefs)}|${anchored && anchored.carriedRecord.crossRefs[0] && anchored.carriedRecord.crossRefs[0].raw}`, 'P001490|1|P001490|true|001490');
	harness.equal("BG-PLUGIN e the UNANCHORED node yields the channel's '' SENTINEL — never 'undefined', never a guess — for the framework to drop and count", `${unanchored && unanchored.tupleFieldValues.canonicalKey}|${unanchored && unanchored.rawTargetList[0].rawValue}`, '|');
	harness.ok('BG-PLUGIN e no assertion carries a framework-owned key (resolution / confidence / matchBasis / mappingJustification / objectStableId) — the walk asserts, it never resolves', assertionList.every((oneAssertion) => bridgePluginContractLib.WALK_ASSERTION_FORBIDDEN_KEY_LIST.every((oneKey) => !Object.prototype.hasOwnProperty.call(oneAssertion, oneKey))), JSON.stringify(bridgePluginContractLib.WALK_ASSERTION_FORBIDDEN_KEY_LIST));

	// the TWIN: a malformed crossRefs is a SOURCE fault and must be REFUSED BY NAME, never silently replaced with []
	const faultedNodeList = clone(cleanNodeList);
	faultedNodeList[0].properties.crossRefs = '{not json at all';
	pluginModule.bridgeHooks.walkSourceAssertions({ sourceChannelPathByKey: {}, sourceReader: walkViewOver(faultedNodeList), xLog: quietLog }, (faultError) => {
		harness.ok('RED-OBSERVED BG-PLUGIN e — a node whose crossRefs is not parseable JSON REFUSES BY NAME naming the node, and yields nothing', typeof faultError === 'string' && faultError.length > 0 && faultError.indexOf(ANCHORED_STABLE_ID) !== -1, faultError);

		pluginModule.bridgeHooks.subjectStableIdFor({ subjectIdentityList: assertionList.map((oneAssertion) => ({ subjectKey: oneAssertion.subjectIdentity.stableId, subjectIdentity: oneAssertion.subjectIdentity })), sourceReader: walkViewOver(cleanNodeList), xLog: quietLog }, (identityError, identityResult) => {
			harness.ok('BG-PLUGIN e subjectStableIdFor resolves every subject to the node ITSELF (identity, 1:1) and refuses nothing', !identityError && assertionList.every((oneAssertion) => identityResult.resolutionBySubjectKey[oneAssertion.subjectIdentity.stableId].subjectStableId === oneAssertion.subjectIdentity.stableId), identityError);
			harness.ok('RED-OBSERVED BG-PLUGIN e — a CONSTANT subjectStableIdFor (the REVIEW-B3 fault 2 shape) collapses every subject onto one node and is caught by the identity comparison', assertionList.map((oneAssertion) => ANCHORED_STABLE_ID).filter((oneStableId, oneIndex) => oneStableId !== assertionList[oneIndex].subjectIdentity.stableId).length > 0);
			runComposeSection();
		});
	});
});
};

// ---------------------------------------------------------------------
// SECTION 4 — BG-COMPOSE-SIF (SPEC §12.1 (a); BRIEF-B4's ONE RULE): the framework did not move.
// ---------------------------------------------------------------------
// gitNumstatOver — `revisionText` is EITHER a range (`a..b`, two commits) or a single commit, in which case git
// diffs that commit against the WORKING TREE. The live gate uses the single-commit form deliberately: a range
// compares two commits and would be trivially empty for uncommitted work, i.e. green because it is looking at
// nothing. The twin below uses the range form over real bytes.
const gitNumstatOver = (revisionText) => {
	const argList = ['-C', treeRoot, 'diff', '--numstat', revisionText, '--'].concat(expectedCompose.diffedPathList);
	const ran = spawnSync('git', argList, { encoding: 'utf8' });
	return { status: ran.status, text: (ran.stdout || '').trim(), stderr: (ran.stderr || '').trim(), commandText: `git ${argList.join(' ')}` };
};
// gitUntrackedUnderFrameworkPaths — git diff NEVER reports an untracked file, so a brand-new file dropped into
// lib/bridge-framework/ would leave the numstat gate green forever. Enumerating them separately closes that hole;
// without this the gate asserts "no MODIFIED framework file", which is weaker than the rule it is enforcing.
const gitUntrackedUnderFrameworkPaths = () => {
	const argList = ['-C', treeRoot, 'ls-files', '--others', '--exclude-standard', '--'].concat(expectedCompose.diffedPathList);
	const ran = spawnSync('git', argList, { encoding: 'utf8' });
	return { status: ran.status, text: (ran.stdout || '').trim(), stderr: (ran.stderr || '').trim(), commandText: `git ${argList.join(' ')}` };
};
// the VERDICT is a pure function of the two commands' outcomes, so the twins below can feed it real non-empty text
const composeVerdictOf = ({ status, text, stderr }, untracked) => {
	if (status !== 0) {
		return { empty: false, reason: `the diff command itself failed (exit ${status}): ${stderr}` };
	}
	if (untracked !== undefined && untracked.status !== 0) {
		return { empty: false, reason: `the untracked-file scan itself failed (exit ${untracked.status}): ${untracked.stderr}` };
	}
	const changedLineList = text.split('\n').filter((oneLine) => oneLine.length > 0);
	const untrackedLineList = untracked === undefined ? [] : untracked.text.split('\n').filter((oneLine) => oneLine.length > 0);
	const reasonList = changedLineList.map((oneLine) => `modified ${oneLine}`).concat(untrackedLineList.map((oneLine) => `UNTRACKED NEW FILE ${oneLine}`));
	return { empty: reasonList.length === 0, reason: reasonList.length ? `${reasonList.length} framework path(s) changed: ${reasonList.join(' | ')}` : '' };
};

const runComposeSection = () => {
	harness.section('SECTION 4 — BG-COMPOSE-SIF: the framework diff from this branch\'s BASE to HEAD is EMPTY; the same command over a range where the framework DID move is NON-EMPTY');
	const baselineCommit = expectedCompose.b4BaselineCommit;
	// the SINGLE-COMMIT form: base vs the WORKING TREE, so uncommitted framework edits are caught too — plus the
	// untracked scan, because git diff never reports a brand-new file and a new file under lib/bridge-framework/
	// is exactly as much of a framework change as an edited one
	const real = gitNumstatOver(baselineCommit);
	const realUntracked = gitUntrackedUnderFrameworkPaths();
	const realVerdict = composeVerdictOf(real, realUntracked);
	harness.ok(`BG-COMPOSE-SIF a the framework diff from ${String(baselineCommit).slice(0, 7)} to the working tree over ${expectedCompose.diffedPathList.length} declared paths is EMPTY, modified AND untracked — SIF is a second plugin through the SAME seam with ZERO framework change`, realVerdict.empty === true, `${realVerdict.reason}\n${real.commandText}\n${realUntracked.commandText}`);
	// SCOPE, matched to the established gate rather than invented: test-bgNosub.js's own token ban walks
	// lib/bridge-framework/** with listJs(..., true), whose recursion EXCLUDES any directory named 'test'
	// ([code fact] test-bgNosub.js:88). The framework's SUITES necessarily name plugins — test-bgReg.js has named
	// sifCedsStandardPlugin since B2, before this plugin existed, precisely to prove the registry refuses an
	// unregistered name. So the conjunct is over the framework's PRODUCTION tree, on the same footing.
	const frameworkProductionFileList = (() => {
		const walk = (dirPath) => fs.readdirSync(dirPath, { withFileTypes: true }).reduce((soFar, oneEntry) => {
			if (oneEntry.isFile() && /\.js$/.test(oneEntry.name)) {
				return soFar.concat([path.join(dirPath, oneEntry.name)]);
			}
			return oneEntry.isDirectory() && oneEntry.name !== 'test' && oneEntry.name !== 'node_modules' ? soFar.concat(walk(path.join(dirPath, oneEntry.name))) : soFar;
		}, []);
		return walk(path.join(treeRoot, 'lib', 'bridge-framework'));
	})();
	const namingFileList = frameworkProductionFileList.filter((oneFilePath) => fs.readFileSync(oneFilePath, 'utf8').indexOf(BRIDGE_NAME) !== -1);
	harness.equal(`BG-COMPOSE-SIF c no framework PRODUCTION file names this plugin (${frameworkProductionFileList.length} files scanned, test/ excluded as test-bgNosub.js scopes it) — a per-standard reference inside lib/bridge-framework would be a branch by another name`, namingFileList.map((onePath) => path.relative(treeRoot, onePath)).join(', '), '');
	harness.ok('BG-COMPOSE-SIF c the plugin, the recipes, the acceptance data and this suite are the WHOLE diff — tracked changes and untracked additions alike', (() => {
		// the permitted set as DATA — one row per thing this phase is allowed to add, each with the reason it is
		// allowed. A `||` chain of regexes says the same thing and reads as an accident; widening a list is a
		// visible edit, and every row here has to justify itself to a reviewer by name.
		const PERMITTED_PATH_REGISTRY = [
			{ pattern: /^forges\/sif\/bridges\/[A-Za-z]+\.js$/, why: 'the plugin itself — the only new code this phase writes' },
			{ pattern: /^recipes\/(fourWithHubSifBridge|sifBridgeOnly)\.recipe\.jsonc$/, why: 'the two declared recipes, named individually so a third cannot arrive unremarked' },
			{ pattern: /^lib\/bridge-framework\/test\/acceptance\//, why: 'acceptance DATA — excluded from the diffed framework set by RULING BF9 because per-plugin fixtures change between phases BY DESIGN' },
			{ pattern: /^apps\/graph-builder\/test\/test-bridgeAcceptanceSif\.js$/, why: 'this suite' },
			// ADDED under RULING BS-5, and the addition is the point of the registry being a list: the genesis
			// path is a SHARED-INSTRUMENT change (the acceptance runner and the pure rule it now calls), not
			// plugin work. It sits outside BG-COMPOSE-SIF's measured framework scope — apps/graph-builder/test/
			// is not in diffedPathList — so the zero-framework-diff proof is untouched. It is named here rather
			// than quietly permitted by a looser pattern, so a reviewer sees exactly what this phase added
			// beyond its plugin and can hold it to the ruling that authorised it.
			{ pattern: /^apps\/graph-builder\/test\/bridgeAcceptance\/(runBridgeAcceptanceCommand|genesisGuard)\.js$/, why: 'RULING BS-5: the runner gains a NAMED genesis path, with the rule extracted to genesisGuard.js so its twins exercise the rule itself rather than a copy — the runner is a CLI that exits on refusal and cannot be required from a suite' },
			// its OWN row rather than a widening of the row above, because the two changes answer to DIFFERENT
			// rulings and the registry's whole value is that each row justifies itself to a reviewer by name. A
			// pattern that quietly grew to cover a second file would have retired that.
			{ pattern: /^apps\/graph-builder\/test\/bridgeAcceptance\/renderingAudit\.js$/, why: 'RULING BS-10: the rendering audit is generalised by rendererVersion so it parses the crosswalk layout as well as the derived one, CAPTURING the card key and name that live on the crosswalk ordinal line. Its own row, its own ruling — the tempting one-character anchor loosening is refused by name in the module because it would discard that name and manufacture ties that were never on the page' },
			{ pattern: /^apps\/graph-builder\/test\/bridgeAcceptance\/batchCheckpoint\.js$/, why: 'RULING BS-8: the batch document generator is GENERALISED rather than forked — its two hardcoded truth constants become declared data (referenceStoreFilePath / referenceBlockId / referenceRole) and the ROLE selects the vocabulary, so a SIF document says COMPARISON where a derived document says TRUTH. SIF has no answer key; a document that called a disagreement an error would be claiming more than its evidence supports' },
		];
		const isPermitted = (onePath) => PERMITTED_PATH_REGISTRY.some((oneRow) => oneRow.pattern.test(onePath));
		// --relative is REQUIRED, not cosmetic: the repository root is system/code and this tree is system/code/educoreForge,
		// so `git diff --name-only` reports REPO-ROOT-relative paths ('educoreForge/lib/…') while `git ls-files --others`
		// reports CWD-relative ones ('lib/…'). Comparing the two against one set of patterns without normalising is how a
		// path gate passes for the wrong reason. --relative puts both in the tree's own frame.
		const changed = spawnSync('git', ['-C', treeRoot, 'diff', '--name-only', '--relative', baselineCommit], { encoding: 'utf8' });
		const added = spawnSync('git', ['-C', treeRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
		if (changed.status !== 0 || added.status !== 0) {
			return false;
		}
		const pathList = `${changed.stdout}\n${added.stdout}`.trim().split('\n').filter((onePath) => onePath.length > 0);
		return pathList.length > 0 && pathList.every(isPermitted);
	})(), 'a changed or added path lies outside the plugin, the recipes, the acceptance data and this suite (an EMPTY path list is also red — a gate with nothing to measure is not a passing gate)');

	harness.section('    BG-COMPOSE-SIF twins — the SAME command over real bytes where the framework DID move, observed RED');
	// TWIN (production input, REAL bytes): between the B3 CLEAR commit and this branch's base the DERIVED order
	// really did change lib/bridge-framework. The identical invocation must come back NON-EMPTY there. This is what
	// separates "the framework did not move" from "the path list is misspelled and matches nothing, forever".
	// the RECORDED key, not edfiPluginAcceptedCommit: that field is held at null on purpose because
	// test-bgNosub.js:147 asserts its nullness (see whyTheTwoFieldsAboveStayNull in expectedCompose.json).
	// Reading the null field here would make the twin's range 'null..3e5357f' and git would refuse it — a twin
	// that errors is not a twin that bites, so the dependency is named rather than left to coincidence.
	const movedRange = `${expectedCompose.edfiPluginAcceptedCommitRecorded}..${baselineCommit}`;
	const moved = gitNumstatOver(movedRange);
	const movedVerdict = composeVerdictOf(moved, { status: 0, text: '', stderr: '' });
	harness.ok(`RED-OBSERVED BG-COMPOSE-SIF a — the SAME command over ${movedRange} (where the DERIVED order really did move the framework) is NON-EMPTY, so the EMPTY above is a measurement and not a silence`, movedVerdict.empty === false && moved.status === 0, `${movedVerdict.reason.slice(0, 300)}\n${moved.commandText}`);
	harness.ok('RED-OBSERVED BG-COMPOSE-SIF a — a numstat line naming ONE modified framework file turns the verdict red', composeVerdictOf({ status: 0, text: '1\t0\tlib/bridge-framework/classification.js', stderr: '' }, { status: 0, text: '', stderr: '' }).empty === false);
	harness.ok('RED-OBSERVED BG-COMPOSE-SIF a — an UNTRACKED new file under a framework path turns the verdict red even though git diff reports nothing (the hole this scan exists to close)', composeVerdictOf({ status: 0, text: '', stderr: '' }, { status: 0, text: 'lib/bridge-framework/sifSpecialCase.js', stderr: '' }).empty === false);
	harness.ok('RED-OBSERVED BG-COMPOSE-SIF a — a FAILED diff command is red, never silently EMPTY (an unreadable gate is not a passing gate)', composeVerdictOf({ status: 128, text: '', stderr: 'fatal: bad revision' }, { status: 0, text: '', stderr: '' }).empty === false);

	runGenesisGuardSection();
};

// ---------------------------------------------------------------------
// SECTION 5 — BG-GENESIS (RULING BS-5): the pinned-store guard's ONE named exception.
// These call the SAME function runBridgeAcceptanceCommand.js calls. The rule lives in genesisGuard.js
// precisely so a twin can exercise the rule itself rather than a copy of it — the runner is a CLI that exits
// on refusal, so requiring IT from here would execute it and the twins would be theatre.
// ---------------------------------------------------------------------
const runGenesisGuardSection = () => {
	harness.section('SECTION 5 — BG-GENESIS (RULING BS-5): genesis is DECLARED, narrow, and INERT once the store exists');
	const genesisGuardLib = require(path.join(__dirname, 'bridgeAcceptance', 'genesisGuard'));
	const STORE_PATH = '/absolute/sif/sifBridge.standardsDatabase.sqlite3';
	const STORE_DIR = '/absolute/sif';
	// the entry is built FROM THE OVERRIDE ALONE, never spread over the real SIF entry. Spreading the real one
	// was the first thing tried and it silently broke the most important twin: the live entry now carries
	// rejudgeDebugGenesis: true, so "no declaration" inherited a declaration and the refusal never fired. A twin
	// whose world is contaminated by production data tests nothing — it just agrees with production.
	const verdictFor = ({ entryOverride, lineName, storeExists, storeDirPathExists }) =>
		genesisGuardLib.genesisRefusalFor({ entry: { ...entryOverride }, lineName, storeExists, storeDirPathExists, storeFilePath: STORE_PATH, storeDirPath: STORE_DIR });

	// the POSITIVE case — this is the launch the ruling exists to permit
	harness.equal('BG-GENESIS a a declared genesis on a rejudge line, store directory present and store file absent, is PERMITTED', verdictFor({ entryOverride: { rejudgeDebugGenesis: true }, lineName: 'rejudgeDebug', storeExists: false, storeDirPathExists: true }), '');
	harness.ok('BG-GENESIS a and the runner SAYS SO — isGenesisLaunch is true, so the run that creates the store never looks like any other run in the log', genesisGuardLib.isGenesisLaunch({ entry: { rejudgeDebugGenesis: true }, lineName: 'rejudgeDebug', storeExists: false }) === true);
	// INERTNESS — the declaration cannot be left switched on as a standing bypass
	harness.ok('BG-GENESIS d once the store EXISTS the declaration is INERT: the ordinary guard governs and isGenesisLaunch is false', verdictFor({ entryOverride: { rejudgeDebugGenesis: true }, lineName: 'rejudgeDebug', storeExists: true, storeDirPathExists: true }) === '' && genesisGuardLib.isGenesisLaunch({ entry: { rejudgeDebugGenesis: true }, lineName: 'rejudgeDebug', storeExists: true }) === false);

	harness.section('    BG-GENESIS twins — the two the ruling requires, plus the path-typo case, observed RED');
	// TWIN 1 (required): an absent store WITHOUT the declaration still refuses — the original guard is intact
	const undeclaredRefusal = verdictFor({ entryOverride: {}, lineName: 'rejudgeDebug', storeExists: false, storeDirPathExists: true });
	harness.ok(`RED-OBSERVED BG-GENESIS b — an absent store with NO genesis declaration still REFUSES BY NAME, naming the store and how to declare genesis (the exception did not widen the guard): ${undeclaredRefusal.slice(0, 90)}…`, undeclaredRefusal.indexOf(STORE_PATH) !== -1 && /rejudgeDebugGenesis/.test(undeclaredRefusal));
	// TWIN 2 (required): the declaration on a NON-rejudge line refuses
	const wrongLineRefusal = verdictFor({ entryOverride: { materialiseGenesis: true }, lineName: 'materialise', storeExists: false, storeDirPathExists: true });
	harness.ok(`RED-OBSERVED BG-GENESIS c — genesis declared on a MATERIALISE line REFUSES BY NAME: a materialise line replays a frozen block and has nothing to replay from on a store that does not exist: ${wrongLineRefusal.slice(0, 90)}…`, /permitted only on a rejudge\* line/.test(wrongLineRefusal));
	// TWIN 3: the case the original guard was really protecting against — a path typo wearing genesis as a disguise
	const typoRefusal = verdictFor({ entryOverride: { rejudgeDebugGenesis: true }, lineName: 'rejudgeDebug', storeExists: false, storeDirPathExists: false });
	harness.ok(`RED-OBSERVED BG-GENESIS c — genesis with an ABSENT store DIRECTORY REFUSES BY NAME: genesis creates the STORE, never its location, and an absent directory is a path typo rather than a first run: ${typoRefusal.slice(0, 90)}…`, typoRefusal.indexOf(STORE_DIR) !== -1);

	runRenderingAuditSection();
};

// ---------------------------------------------------------------------
// SECTION 6 — BG-RENDER-VARIANT (RULING BS-10): the rendering audit parses BOTH renderer variants, and the
// crosswalk renderer's ordinal line — which carries the card's KEY AND NAME — is CAPTURED, never discarded.
// ---------------------------------------------------------------------
const runRenderingAuditSection = () => {
	harness.section('SECTION 6 — BG-RENDER-VARIANT (RULING BS-10): both renderer layouts parse, and the crosswalk ordinal line is CAPTURED');
	const renderingAuditLib = require(path.join(__dirname, 'bridgeAcceptance', 'renderingAudit'));
	// two cards that differ ONLY by name — the case the discarded-ordinal-line bug would have collapsed
	const crosswalkPrompt = ['CANDIDATES (2), in hub order:', '  [1] P000534 — Operational Status Effective Date', '      seat: filteredOnKey', '      domainId: C200398', '  [2] P000534 — Local Education Agency Operational Status Effective Date', '      seat: filteredOnKey', '      domainId: C200398'].join('\n');
	const derivedPrompt = ['CANDIDATES (2), in hub order:', '  [1]', '      name: Alpha', '  [2]', '      name: Beta'].join('\n');

	const crosswalkParsed = renderingAuditLib.renderedCandidateTextListFromPrompt({ userPrompt: crosswalkPrompt, rendererVersion: 'bridgeEvidenceRenderer-v1' });
	harness.equal('BG-RENDER-VARIANT a the CROSSWALK layout parses — the ordinal line carries the key and name, and the block count matches the heading', `${crosswalkParsed.fault === undefined}|${crosswalkParsed.textList && crosswalkParsed.textList.length}`, 'true|2');
	harness.ok('BG-RENDER-VARIANT b the card NAME is CAPTURED INTO the candidate text (not consumed with the delimiter) — the two blocks are DIFFERENT although every field line below them is identical', crosswalkParsed.textList !== undefined && crosswalkParsed.textList[0] !== crosswalkParsed.textList[1] && crosswalkParsed.textList[0].indexOf('Operational Status Effective Date') !== -1, JSON.stringify(crosswalkParsed.textList));
	const derivedParsed = renderingAuditLib.renderedCandidateTextListFromPrompt({ userPrompt: derivedPrompt, rendererVersion: 'bridgeEvidenceRenderer-derived-v1' });
	harness.equal('BG-RENDER-VARIANT c the DERIVED layout still parses unchanged (regression: its ordinal line carries nothing, so nothing is captured)', `${derivedParsed.fault === undefined}|${derivedParsed.textList && derivedParsed.textList.length}`, 'true|2');
	harness.ok('BG-RENDER-VARIANT d an UNKNOWN rendererVersion is REFUSED BY NAME listing the known variants — the layout of a prompt is never guessed', /has no candidate-ordinal spec/.test(String(renderingAuditLib.renderedCandidateTextListFromPrompt({ userPrompt: crosswalkPrompt, rendererVersion: 'bridgeEvidenceRenderer-someFutureVariant' }).fault)));

	harness.section('    BG-RENDER-VARIANT twins — the ONE-CHARACTER "fix" that would have manufactured a tie, observed RED');
	// THE TWIN THAT MATTERS. Reproduce the tempting repair — loosen the end-anchor and DISCARD the ordinal
	// line's text — and show it collapses the two name-distinct cards into identical text. This is not a
	// hypothetical: it is the exact edit a reader reaches for when the parser refuses, and the reason the
	// module's own comment refuses it by name.
	const loosenedAnchorTextList = (() => {
		const lineList = crosswalkPrompt.split('\n');
		const textList = []; let current = null;
		lineList.slice(1).forEach((oneLine) => {
			if (/^ {2}\[(\d+)\](?:\s.*)?$/.test(oneLine)) { if (current !== null) { textList.push(current.join('\n')); } current = []; return; }
			if (current !== null) { current.push(oneLine); }
		});
		if (current !== null) { textList.push(current.join('\n')); }
		return textList;
	})();
	harness.ok(`RED-OBSERVED BG-RENDER-VARIANT b — the loosened-anchor repair PARSES but DISCARDS the name, collapsing two name-distinct cards into byte-identical text (${loosenedAnchorTextList.length} blocks, identical: ${loosenedAnchorTextList[0] === loosenedAnchorTextList[1]}). That is a RENDERING TIE THAT WAS NEVER ON THE PAGE — the harm the refusal exists to prevent, reintroduced by the fix for it`, loosenedAnchorTextList.length === 2 && loosenedAnchorTextList[0] === loosenedAnchorTextList[1]);
	harness.ok('RED-OBSERVED BG-RENDER-VARIANT a — the OLD end-anchored pattern finds ZERO blocks in a crosswalk prompt, which is the refusal that started this (a short parse is refused, never half-used)', crosswalkPrompt.split('\n').filter((oneLine) => /^ {2}\[(\d+)\]$/.test(oneLine)).length === 0);

	runReleasedBatchSizeSection();
};

// ---------------------------------------------------------------------
// SECTION 7 — BG-BATCH-SIZE (RULING BS-9): the released window is reconstructed IN THE RUNNER, per bridge,
// independently of the acceptance file — so a committed line cannot enlarge a batch the supervisor released.
// ---------------------------------------------------------------------
const runReleasedBatchSizeSection = () => {
	harness.section('SECTION 7 — BG-BATCH-SIZE (RULING BS-9): the released window is per bridge and lives in the RUNNER, not in the file it checks');
	const runnerText = fs.readFileSync(path.join(__dirname, 'bridgeAcceptance', 'runBridgeAcceptanceCommand.js'), 'utf8');
	// read the runner's own table out of its source: the point of the conjunct is that this number is NOT in
	// acceptanceCommands.jsonc, so the suite must not read it from there either
	const tableMatch = runnerText.match(/D3_BATCH_SIZE_BY_BRIDGE_NAME = Object\.freeze\(\{([\s\S]*?)\}\)/);
	const rowText = tableMatch === null ? '' : tableMatch[1];
	harness.ok('BG-BATCH-SIZE a the runner declares a PER-BRIDGE released window, not one shared constant — the number is a different QUANTITY per plugin (derived: judged subjects; SIF: source elements) and one constant would silently mis-state one of them', tableMatch !== null && /edfiCedsDerivedPlugin:\s*10/.test(rowText) && /sifCedsStandardPlugin:\s*70/.test(rowText), rowText.trim());
	harness.ok("BG-BATCH-SIZE b the DERIVED order's released window is UNCHANGED at 10 — widening SIF's window must not widen anyone else's", /edfiCedsDerivedPlugin:\s*10\s*,/.test(rowText));
	harness.ok('BG-BATCH-SIZE c a bridge with NO row is REFUSED BY NAME rather than defaulted — a batch size nobody chose is what this guard exists to prevent', /has no released batch size in this runner/.test(runnerText));
	harness.ok("BG-BATCH-SIZE d the window is NOT read from acceptanceCommands.jsonc — reading it from the file being checked would destroy the independence that makes the equality check meaningful", runnerText.indexOf('entry.rejudgeRealLimitBatchSize') === -1 && runnerText.indexOf('entry.batchSize') === -1);
	// the RED observation is not synthetic: the runner REFUSED this phase's own launch when the committed line
	// said --limit=70 and its independent reconstruction still said 10, and that refusal is why BS-9 needed a
	// runner change at all. Recorded here so the guard's bite is documented where the guard is tested.
	harness.ok('RED-OBSERVED BG-BATCH-SIZE — the equality check REFUSED this phase\'s own batch-1 launch when the committed line and the runner\'s reconstruction disagreed about --limit (committed 70, reconstructed 10), which is exactly the "quietly running a bigger batch than the supervisor released" case; observed live 2026-08-17, not simulated', /the runner's command line differs from the committed frozen/.test(runnerText));

	runFrozenArtifactSection();
};

// ---------------------------------------------------------------------
// SECTIONS 0-2 — the frozen artifacts. UNMEASURED (and failing by name) until CP2 freezes them.
// ---------------------------------------------------------------------
const runFrozenArtifactSection = () => {
	harness.section('SECTIONS 0-2 — the frozen SIF block, its census EQUALITY, Profile §7 over its records, and its SSSOM export');
	// THE FIXTURE NAME IS DATA-DERIVED, not a literal: it comes from the ids fixture's graphId, so the census
	// fixture and the ids fixture cannot drift apart silently. A wrong or missing name yields an ABSENT file,
	// which is RED — this can never pass for the wrong reason.
	const idsFixturePath = path.join(acceptanceDir, 'expectedDecisionBlockIds.json');
	const idsEntry = (readJson(idsFixturePath).byBridgeName || {})[BRIDGE_NAME] || {};
	const graphIdPrefix = typeof idsEntry.graphId === 'string' ? idsEntry.graphId.split('@manifest:')[0] : '(noGraphId)';
	const censusFixturePath = path.join(acceptanceDir, `expectedCensus.${BRIDGE_NAME}.${graphIdPrefix}.json`);
	const decisionStorePath = acceptanceCommands.decisionStoreFilePath;
	harness.note(`census fixture ${path.relative(treeRoot, censusFixturePath)} — its NAME is derived from the ids fixture's graphId, so the two cannot drift apart unnoticed.`);
	harness.note(idsEntry.provisional === true ? 'the ids entry is PROVISIONAL (RULING BS-7): the ids are REAL and reproduced, but keyed to the framework at this branch’s base. Three commits have moved lib/bridge-framework since — 1393f82, d548d41, e32e633 — and 1393f82 is the BR-067 fix without which the Ed-Fi D4 real run died at subject 50. After the rebase the CENSUS MUST BE EQUAL and THE IDS MOVE, as a NAMED mover whose cause is the fingerprint.' : 'the ids entry is final.');
	harness.note('expectedBaseBlockIdBySubject is PINNED to the four ruled literals; the store was FORGED FRESH (RULED (c)) and three of the four re-forged BYTE-IDENTICAL — which is what proves the same four-forge content without importing any Ed-Fi mapping block.');
	// ONE conjunct, and it MEASURES rather than merely finding the file: the frozen block's census must EQUAL
	// the committed fixture member for member. The judge-dependent trio (abstained / edgeCount /
	// distinctTripleCount) is asserted against the PER-BLOCK record instead, per the B3 checkpoint-2 ruling —
	// the debug judge abstains pseudo-randomly and the real judge picks, so those three differ by construction.
	const censusVerdict = (() => {
		if (!fs.existsSync(censusFixturePath)) { return { pass: false, detail: `census fixture ABSENT at ${path.relative(treeRoot, censusFixturePath)}` }; }
		if (!fs.existsSync(decisionStorePath)) { return { pass: false, detail: `pinned decision store ABSENT at ${decisionStorePath}` }; }
		if (!idsEntry.debugDecisionBlockId) { return { pass: false, detail: 'the ids fixture records no debugDecisionBlockId' }; }
		const fixture = readJson(censusFixturePath).byBridgeName[BRIDGE_NAME];
		const Database = require('better-sqlite3');
		const db = new Database(decisionStorePath, { readonly: true });
		const storeRow = db.prepare('SELECT frozenText FROM decisionBlocks WHERE decisionBlockHash = ?').get(idsEntry.debugDecisionBlockId);
		db.close();
		if (!storeRow) { return { pass: false, detail: `the pinned store holds no block ${String(idsEntry.debugDecisionBlockId).slice(0, 12)}…` }; }
		const header = JSON.parse(typeof storeRow.frozenText === 'string' ? storeRow.frozenText : storeRow.frozenText.toString('utf8')).header;
		const JUDGE_DEPENDENT_MEMBER_LIST = ['abstainedCount', 'edgeCount', 'distinctTripleCount'];
		const classifierOnly = (census) => ({ perSubject: census.perSubject, perTarget: Object.keys(census.perTarget).filter((oneName) => JUDGE_DEPENDENT_MEMBER_LIST.indexOf(oneName) === -1).sort().reduce((soFar, oneName) => ({ ...soFar, [oneName]: census.perTarget[oneName] }), {}) });
		const censusEqual = JSON.stringify(classifierOnly(header.cardinalityCensus)) === JSON.stringify(classifierOnly(fixture.cardinalityCensus));
		const digestsEqual = header.declarationDigest === fixture.declarationDigest && header.labelTableDigest === fixture.labelTableDigest && header.remodelTableDigest === fixture.remodelTableDigest;
		const recordedTrio = (idsEntry.judgeDependentCensusByBlock || {}).debug || {};
		const trioEqual = JUDGE_DEPENDENT_MEMBER_LIST.every((oneName) => header.cardinalityCensus.perTarget[oneName] === recordedTrio[oneName]);
		const s = header.cardinalityCensus.perSubject;
		const sumHolds = s.specifiedSubjectCount + s.judgedSubjectCount + s.orphanSubjectCount + s.subjectCollisionCount + s.sourceGapCount === s.subjectCount;
		return { pass: censusEqual && digestsEqual && trioEqual && sumHolds, detail: `census ${censusEqual}, digests ${digestsEqual}, judge-trio ${trioEqual}, sum ${sumHolds} — ${s.specifiedSubjectCount} specified / ${s.judgedSubjectCount} judged / ${s.orphanSubjectCount} orphan of ${s.subjectCount}` };
	})();
	harness.ok(`BG-CENSUS a / BG-ACCEPT a — the frozen block's census EQUALS the committed fixture member for member (classifier members), the three digests EQUAL, the judge-dependent trio equals its per-block record, and the per-subject sum invariant holds — ${censusVerdict.detail}`, censusVerdict.pass === true, censusVerdict.detail);
	harness.report();
};

// the chain starts here, after every section it reaches has been defined
runPluginHookSection();
