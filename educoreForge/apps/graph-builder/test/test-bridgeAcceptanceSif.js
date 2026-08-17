#!/usr/bin/env node
'use strict';

// test-bridgeAcceptanceSif.js — the SIF plugin's ACCEPTANCE gates (SPEC-bridgeFramework-v1.md §11, §12, §12.1, §13.1;
// the B4 order), MIRRORING test-bridgeAcceptanceEdfi.js. Two halves, and the split is the point of this phase:
//
//   THE HALVES THAT NEED THE FROZEN ARTIFACTS (SECTIONS 0-2) read the pinned B4 acceptance store under
//   system/dataStores/bridgeAcceptance/sif/ and the committed fixtures, and assert EQUALITIES over the frozen
//   block. Until CP2 freezes them they are UNMEASURED — which under RULING BR3-6 is a FAILURE BY NAME, never a
//   smaller green: EXPECTED_ASSERTION_COUNT is a LITERAL and the ledger pads the difference with named failures.
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
// + 1 (SECTIONS 0-2: the frozen-artifact conjunct, UNMEASURED and RED until CP2)
// = 41. RAISED as a LITERAL, in the same commit, when CP2 wires SECTIONS 0-2 in full.
const EXPECTED_ASSERTION_COUNT = 41;
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

	runFrozenArtifactSection();
};

// ---------------------------------------------------------------------
// SECTIONS 0-2 — the frozen artifacts. UNMEASURED (and failing by name) until CP2 freezes them.
// ---------------------------------------------------------------------
const runFrozenArtifactSection = () => {
	harness.section('SECTIONS 0-2 — the frozen SIF block, its census EQUALITY, Profile §7 over its records, and its SSSOM export');
	const censusFixturePath = path.join(acceptanceDir, `expectedCensus.${BRIDGE_NAME}.GOLD_EVAL_260816.json`);
	const idsFixturePath = path.join(acceptanceDir, 'expectedDecisionBlockIds.json');
	const decisionStorePath = acceptanceCommands.decisionStoreFilePath;
	const censusFrozen = fs.existsSync(censusFixturePath);
	const storePinned = fs.existsSync(decisionStorePath);
	const idsCarrySif = fs.existsSync(idsFixturePath) && Object.prototype.hasOwnProperty.call(readJson(idsFixturePath).byBridgeName || {}, BRIDGE_NAME);
	harness.note(`census fixture ${censusFrozen ? 'PRESENT' : 'ABSENT'} (${path.relative(treeRoot, censusFixturePath)}); pinned decision store ${storePinned ? 'PRESENT' : 'ABSENT'} (${decisionStorePath}); ids fixture ${idsCarrySif ? 'carries a SIF entry' : 'carries NO SIF entry'}.`);
	harness.note(`acceptanceCommands declares the four SIF lines. expectedBaseBlockIdBySubject is PINNED to the four ruled literals (${Object.keys(acceptanceCommands.expectedBaseBlockIdBySubject || {}).length} subjects) — the store is forged FRESH (RULED (c)) and those ids MUST come out equal, which is what proves the same four-forge content without importing any Ed-Fi mapping block; -verify refuses by name otherwise. fourBaseManifestId and this fixture's NAME stay ABSENT until the CP2 run produces its manifest — absent rather than guessed.`);
	// ONE named conjunct rather than a wall of anonymous UNMEASURED lines. The Ed-Fi harness uses the same
	// convention on its own real-block line ("null-and-honest = UNMEASURED = red until frozen"): the suite is RED
	// today, for exactly one stated reason — the plugin is proven, the acceptance data is not yet measured. When
	// CP2 freezes census + ids, SECTIONS 0-2 are wired in the shape test-bridgeAcceptanceEdfi.js already carries
	// and EXPECTED_ASSERTION_COUNT is raised with them, as a literal, in the same commit.
	harness.ok('BG-CENSUS a / BG-ACCEPT a — the SIF census fixture and decision block ids are FROZEN and the pinned store holds them (UNMEASURED until CP2 freezes them from the first ACCEPTED debug classifier run; SPEC §10.4 freezing order — a census written from prose arithmetic would be a fixture that proves the arithmetic, not the classifier)', censusFrozen && storePinned && idsCarrySif, `census fixture ${censusFrozen}, pinned store ${storePinned}, ids entry ${idsCarrySif} — CP2 has not run`);
	harness.report();
};

// the chain starts here, after every section it reaches has been defined
runPluginHookSection();
