#!/usr/bin/env node
'use strict';

// test-judgeProviderRegistry.js — THE JUDGE PROVIDER REGISTRY, HELD TO ITS CONTRACT.
// judgeProviderRegistry JOB 4, 2026-09-07.
//
// ⟪WHY THIS FILE WAS WRITTEN BEFORE THE MODULE IT TESTS⟫ v2 §GOVERNANCE: "GATE BEFORE EDIT on any seam
// that has no suite... A gate written after the edit is an audit; a gate written before it is a spec."
// bridge-maker/lib has had no suite of its own for four consecutive jobs. This file was written in full
// and observed RED before judgeProviderRegistry.js had a line — and, per COBALT_ANCHOR's JOB 2 learning
// carried into v2, red TWICE: once against the NONEXISTENT module (which proves only that a file is
// absent — "a suite of a hundred vacuous gates prints the identical line") and again against a
// DELIBERATELY WRONG STUB, which is what makes each individual assertion demonstrate that it discriminates.
//
// HERMETIC — no network, no Docker, no store, no Ollama, no Anthropic. Every row that would touch a socket
// is driven through componentOverrides; the ollama row's construction is doubled at fetchModelTagList and
// its throwaway ini points at a port where NOTHING LISTENS, so a double that is ever removed or bypassed
// reddens this suite instead of quietly depending on a running server (JOB 3's structural-hermeticism
// lesson: "a double you install is a promise; a double the suite cannot bypass is a property").
//
// Run: node apps/graph-builder/test/test-judgeProviderRegistry.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the judge provider registry selects by ONE key, constructs ONLY the selected row,
     validates inside the construction callback, and freezes what it hands out

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Gates G4-a (a third provider by one new file and one data row, factory source byte-unchanged;
     build.js carries zero direct judge-factory requires), G4-b (an unknown provider refused by name
     LISTING the known rows, from data), G-F1-b (a model collision refused at construction), and the
     JOB 4 docket twins: (ii) validation at registry construction, (iii) a describe() that is not a
     function refused rather than invoked, (iv) the framework-ceiling agreement a row CLAIMS,
     (vi) callback-shaped construction for every row through ONE protocol, and (vii) the validated
     provider object FROZEN before it is handed out.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const harness = require('../../../test/testLib/harness')(moduleName);

const BRIDGE_MAKER_LIB_DIR_PATH = path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib');
const REGISTRY_FILE_PATH = path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'judgeProviderRegistry.js');
const BUILD_JS_FILE_PATH = path.join(__dirname, '..', 'lib', 'build.js');

const { JUDGE_PROVIDER_SHAPE } = require('../interfaces');
const judgeProviderRegistryLib = require(REGISTRY_FILE_PATH);
// ⟪JOB 6⟫ compiles a module in memory with one of its DEPENDENCIES mutated; every other require loads for
// real. Section G6-h needs it to move debugJudge's PROVIDER_NAME and watch the registry's constant follow —
// the only assertion shape a literal that happens to agree cannot satisfy.
const moduleDouble = require('../../../lib/forge-framework/test/testSupport/moduleDouble');

const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// The registry's own SOURCE, read once. Several gates assert STRUCTURAL properties of it — that a list is
// derived rather than restated, that every catch is the boundary translation — because those are the only
// form a coincidence cannot satisfy. Comments are stripped for the gates that must not match prose.
const registrySourceText = fs.readFileSync(REGISTRY_FILE_PATH, 'utf8');
const commentStrippedRegistrySource = registrySourceText
	.split('\n')
	.filter((oneLine) => oneLine.trim().indexOf('//') !== 0)
	.join('\n')
	.replace(/\/\*[\s\S]*?\*\//g, '');

// thrownMessage — captures a REFUSAL so it can be asserted on. The try/catch is this test's PRODUCT (the
// refusal text), never control flow in production code; test-ollamaJudgeClient.js and
// test-selectCandidateSchema.js use the identical idiom for the identical reason.
const thrownMessage = (fn) => {
	let message = '';
	try {
		fn();
	} catch (thrown) {
		message = thrown.message;
	}
	return message;
};

// ---------------------------------------------------------------------------------------------------
// TEST ROWS. The registry's REAL row list is exercised further down; these prove the WALK, and they are
// the only way to construct the faults a correct real row can never exhibit.
// ---------------------------------------------------------------------------------------------------
const conformingProvider = ({ name = 'alpha', wireModel = 'w-1', model, maxConcurrency = 4 } = {}) => {
	const resolvedModel = model || `${name}${JUDGE_PROVIDER_SHAPE.MODEL_NAMESPACE_SEPARATOR}${wireModel}`;
	return {
		name,
		wireModel,
		model: resolvedModel,
		maxConcurrency,
		rerank: (rerankOptions, rerankCallback) => rerankCallback('', {}),
		describe: () => ({ provider: name, model: resolvedModel, version: `${name}-vTest` }),
	};
};

const rowConstructingSynchronously = (providerOverrides, rowOverrides = {}) =>
	Object.assign(
		{
			name: (providerOverrides && providerOverrides.name) || 'alpha',
			enabled: true,
				construct: (rowConstructionOptions, rowCallback) => {
				rowCallback('', conformingProvider(providerOverrides));
			},
		},
		rowOverrides,
	);

// A row that DETONATES if it is ever constructed. This is the proof for "only the selected row
// constructs" — an assertion that merely counts constructions can be satisfied by a registry that
// constructs everything and discards; a row that throws cannot.
let detonatorConstructionCount = 0;
const detonatorRow = (name) => ({
	name,
	enabled: true,
	construct: () => {
		detonatorConstructionCount += 1;
		throw new Error(`THE '${name}' ROW WAS CONSTRUCTED AND MUST NOT HAVE BEEN`);
	},
});

const constructWith = (constructionOptions, rowList) => {
	let captured = { constructionError: 'THE CONSTRUCTION CALLBACK WAS NEVER CALLED', provider: null, calledSynchronously: true };
	let callbackHasRun = false;
	judgeProviderRegistryLib.constructJudgeProvider(
		Object.assign(
			{},
			constructionOptions,
			rowList ? { componentOverrides: Object.assign({ judgeProviderRowList: rowList }, constructionOptions.componentOverrides) } : {},
		),
		(constructionError, provider) => {
			callbackHasRun = true;
			captured = { constructionError: constructionError || '', provider: provider || null, calledSynchronously: captured.calledSynchronously };
		},
	);
	captured.calledSynchronously = callbackHasRun;
	return captured;
};

// constructWithSettled — the SAME call, but read after the event loop has turned, so a row that calls
// back on the next tick has landed. Every assertion about a RESULT uses this; the one assertion about
// WHEN the callback ran uses the synchronous reading above.
const constructWithSettled = (constructionOptions, rowList, done) => {
	judgeProviderRegistryLib.constructJudgeProvider(
		Object.assign(
			{},
			constructionOptions,
			rowList ? { componentOverrides: Object.assign({ judgeProviderRowList: rowList }, constructionOptions.componentOverrides) } : {},
		),
		(constructionError, provider) => done({ constructionError: constructionError || '', provider: provider || null }),
	);
};

// =====================================================================
harness.section('THE ROW LIST IS ORDERED DATA, AND THE KNOWN-NAME LIST IS DERIVED FROM IT');
// =====================================================================

harness.ok(
	'JUDGE_PROVIDER_ROW_LIST is exported and is an array',
	Array.isArray(judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST),
	`got ${typeof judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST}`,
);
harness.ok(
	'…and it is FROZEN — the rows are a declaration, not a mutable table a caller can extend at run time',
	Object.isFrozen(judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST),
);
harness.ok(
	'…and it carries the THREE providers that exist today, in order',
	judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.length === 3,
	`${judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.length} row(s): ${judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.map((oneRow) => oneRow.name).join(', ')}`,
);
harness.ok(
	'every row declares the three members a row must have — name, enabled, construct',
	judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.every(
		(oneRow) => typeof oneRow.name === 'string' && oneRow.name.length > 0 && typeof oneRow.enabled === 'boolean' && typeof oneRow.construct === 'function',
	),
);
harness.equal(
	'KNOWN_PROVIDER_NAME_LIST agrees with the rows',
	JSON.stringify(judgeProviderRegistryLib.KNOWN_PROVIDER_NAME_LIST),
	JSON.stringify(judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.filter((oneRow) => oneRow.enabled).map((oneRow) => oneRow.name)),
);
// ⟪MUTATION M9 FOUND THE ASSERTION ABOVE VACUOUS BY ITSELF, AND THIS IS THE REPAIR.⟫ Replacing the
// derivation with a hard-coded ['anthropic','ollama','debug'] left the suite GREEN at 85/85 — because the
// literal HAPPENS TO EQUAL the derivation today. That is exactly COBALT_ANCHOR's M14 finding one job over:
// "a literal mirror that happens to hold the right three values today satisfies every equality assertion."
// Equality can only ever prove agreement; it can never prove DERIVATION. So the derivation is asserted
// STRUCTURALLY, against the source, which is the one form a coincidence cannot satisfy.
harness.ok(
	'…and it is DERIVED FROM THE ROWS IN SOURCE, not a literal that happens to agree today',
	/const KNOWN_PROVIDER_NAME_LIST = Object\.freeze\(JUDGE_PROVIDER_ROW_LIST\s*\.?\s*filter/.test(registrySourceText.replace(/\s+/g, ' ')) ||
		/KNOWN_PROVIDER_NAME_LIST = Object\.freeze\(JUDGE_PROVIDER_ROW_LIST.filter/.test(registrySourceText),
	registrySourceText.split('\n').filter((oneLine) => oneLine.indexOf('KNOWN_PROVIDER_NAME_LIST =') !== -1).join(' | '),
);
harness.ok(
	'…and no refusal text restates the provider names as a literal list either',
	!/'anthropic',\s*'ollama'/.test(registrySourceText),
);

// THE REGISTRY CONTAINS NO SWITCH. polyArch2's first hard constraint, asserted mechanically rather than
// promised in a comment — comments stripped first, so a `switch` mentioned in prose does not red it.
harness.ok(
	'the registry contains NO switch statement — the row list IS the dispatch',
	commentStrippedRegistrySource.indexOf('switch') === -1,
	'a switch appears in the comment-stripped source',
);
harness.ok(
	'…and no async/await — server/CLI control flow is error-first callbacks',
	!/\basync\b/.test(commentStrippedRegistrySource) && !/\bawait\b/.test(commentStrippedRegistrySource),
);

// =====================================================================
harness.section('SELECTION BY THE ONE KEY — AND G4-b, AN UNKNOWN NAME REFUSED BY NAME, LISTING THE ROWS');
// =====================================================================

const alphaRow = rowConstructingSynchronously({ name: 'alpha' });
const betaRow = rowConstructingSynchronously({ name: 'beta' });

const selectedAlpha = constructWith({ providerName: 'alpha' }, [alphaRow, betaRow]);
harness.equal('the row named by the one key is the row constructed', selectedAlpha.constructionError, '');
harness.equal('…and the provider it yields is that row s', selectedAlpha.provider && selectedAlpha.provider.name, 'alpha');

const selectedBeta = constructWith({ providerName: 'beta' }, [alphaRow, betaRow]);
harness.equal('…and naming the OTHER row yields the OTHER provider (the key really selects)', selectedBeta.provider && selectedBeta.provider.name, 'beta');

const unknownName = constructWith({ providerName: 'nosuchjudge' }, [alphaRow, betaRow]);
harness.ok('G4-b: an unknown provider name is REFUSED', !!unknownName.constructionError, unknownName.constructionError);
harness.ok('…and NO provider object is produced', !unknownName.provider);
harness.match('…the refusal quotes the name that was asked for', unknownName.constructionError, /nosuchjudge/);
harness.match('…and LISTS the known rows — alpha', unknownName.constructionError, /alpha/);
harness.match('…and beta', unknownName.constructionError, /beta/);
harness.ok(
	'…and the listing comes from the ROW DATA, not a hand-typed list: a THIRD row appears in it with no edit to any refusal text',
	constructWith({ providerName: 'nosuchjudge' }, [alphaRow, betaRow, rowConstructingSynchronously({ name: 'gammaAddedByData' })]).constructionError.indexOf(
		'gammaAddedByData',
	) !== -1,
	constructWith({ providerName: 'nosuchjudge' }, [alphaRow, betaRow, rowConstructingSynchronously({ name: 'gammaAddedByData' })]).constructionError,
);

// THE ABSENT VALUE, NOT ONLY THE WRONG ONE — AZURE_ANCHOR's M3. A registry that refuses a MISSPELLED name
// but silently picks a default for a MISSING one is the shape a fabricator needs.
const absentName = constructWith({ providerName: undefined }, [alphaRow, betaRow]);
harness.ok('an ABSENT providerName is refused, not defaulted', !!absentName.constructionError, absentName.constructionError);
harness.ok('…and yields no provider', !absentName.provider);
harness.match('…naming the config key an operator would have to set', absentName.constructionError, /judgeProviderName/);
// ⟪MUTATION M3 FOUND THIS GATE VACUOUS AND THIS IS THE REPAIR.⟫ Disabling the absent-name guard entirely
// left the suite GREEN at 85/85: with no guard, an undefined name simply matches no row and falls into the
// UNKNOWN-name refusal, which ALSO quotes the config key — so every assertion above still passed while the
// check they exist to protect was gone. The two faults must be DISTINGUISHABLE, because they are different
// facts for an operator: "you did not name a judge" and "you named one that does not exist". Asserting the
// absent refusal does NOT read as the unknown one is what makes removing the guard visible.
harness.ok(
	'…and the ABSENT refusal is DISTINGUISHABLE from the UNKNOWN-name refusal, not the same sentence twice',
	/no judge provider was named/.test(absentName.constructionError) && !/is not a\s+registered judge provider|which is not a/.test(absentName.constructionError),
	absentName.constructionError,
);
harness.ok(
	'…and it quotes NO provider name, because none was given — an absence refusal that quotes a name is describing a different fault',
	absentName.constructionError.indexOf("names '") === -1,
	absentName.constructionError,
);
const emptyName = constructWith({ providerName: '' }, [alphaRow, betaRow]);
harness.ok('an EMPTY providerName is refused too', !!emptyName.constructionError, emptyName.constructionError);

// A DISABLED row is not selectable, and saying so is not the same as saying it does not exist.
const disabledRow = rowConstructingSynchronously({ name: 'retired' }, { enabled: false });
const selectedDisabled = constructWith({ providerName: 'retired' }, [alphaRow, disabledRow]);
harness.ok('a row whose enabled is false is NOT selectable', !!selectedDisabled.constructionError, selectedDisabled.constructionError);
harness.match('…and the refusal says it is disabled rather than pretending it is unknown', selectedDisabled.constructionError, /disabled/i);

// =====================================================================
harness.section('ONLY THE SELECTED ROW CONSTRUCTS — proven by a row that DETONATES if constructed');
// =====================================================================

detonatorConstructionCount = 0;
const withDetonators = constructWith({ providerName: 'alpha' }, [detonatorRow('bomb1'), alphaRow, detonatorRow('bomb2')]);
harness.equal('selecting alpha out of a list flanked by two detonating rows SUCCEEDS', withDetonators.constructionError, '');
harness.equal('…and yields alpha', withDetonators.provider && withDetonators.provider.name, 'alpha');
harness.equal(
	'…and NEITHER unselected row was constructed — a dead Ollama must never break an Anthropic run',
	detonatorConstructionCount,
	0,
);
harness.ok(
	'…and the detonator really does detonate when it IS selected, so the proof is not vacuous',
	(() => {
		detonatorConstructionCount = 0;
		const detonated = constructWith({ providerName: 'bomb1' }, [detonatorRow('bomb1'), alphaRow]);
		// The throw is NAMED THROUGH THE CALLBACK by the boundary translation, not allowed to escape.
		return detonated.constructionError.indexOf('WAS CONSTRUCTED AND MUST NOT HAVE BEEN') !== -1 && detonatorConstructionCount === 1;
	})(),
);
detonatorConstructionCount = 0;

// =====================================================================
harness.section('DOCKET (vi) — ONE CONSTRUCTION PROTOCOL: EVERY REAL ROW CALLS BACK, THE SYNC ONES ON THE NEXT TICK');
// =====================================================================

// ASSERTED ON THE REAL ROWS, AND THAT CORRECTION MATTERS. The first version of this gate asserted
// asynchrony against an INJECTED test row and failed — correctly. constructOnNextTick wraps the rows the
// REGISTRY declares; a row this suite injects calls back however the suite wrote it, so asserting against an
// injected row was measuring the fixture rather than the module. The property belongs to the real rows and
// is asserted there.
const REAL_SYNC_FACTORY_ROW_NAME_LIST = ['anthropic', 'debug'];
const anthropicIniForProtocol = (() => {
	const filePath = path.join(os.tmpdir(), 'test-judgeProviderRegistry-protocol-anthropicAi.ini');
	fs.writeFileSync(filePath, '[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=claude-opus-4-8\napiVersion=2023-06-01\n');
	return filePath;
})();

REAL_SYNC_FACTORY_ROW_NAME_LIST.forEach((oneRowName) => {
	let calledSynchronously = true;
	let callbackHasRun = false;
	judgeProviderRegistryLib.constructJudgeProvider(
		{ providerName: oneRowName, debugJudgeRuleName: 'first', configFilePathByProviderName: { anthropic: anthropicIniForProtocol } },
		() => {
			callbackHasRun = true;
		},
	);
	calledSynchronously = callbackHasRun;
	harness.ok(
		`the REAL '${oneRowName}' row constructs SYNCHRONOUSLY but does NOT call back synchronously — it is wrapped to the next tick`,
		calledSynchronously === false,
		`calledSynchronously ${calledSynchronously}`,
	);
});

harness.ok(
	'…so a caller can never depend on one provider answering sooner than another, which is what ONE protocol means',
	judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.every((oneRow) => oneRow.construct.length === 2),
	judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.map((oneRow) => `${oneRow.name}/${oneRow.construct.length}`).join(', '),
);

// =====================================================================
harness.section('DOCKET (ii) — CONTRACT VALIDATION RUNS INSIDE THE CONSTRUCTION CALLBACK');
// =====================================================================

const nonConformingRow = {
	name: 'ragged',
	enabled: true,
	construct: (rowConstructionOptions, rowCallback) => rowCallback('', { name: 'ragged', model: 'ragged:x' }),
};
const nonConforming = constructWith({ providerName: 'ragged' }, [nonConformingRow]);
harness.ok('a provider missing contract members is REFUSED at registry construction', !!nonConforming.constructionError, nonConforming.constructionError);
harness.ok('…and no provider escapes', !nonConforming.provider);
harness.match('…the refusal names JUDGE_PROVIDER_SHAPE', nonConforming.constructionError, /JUDGE_PROVIDER_SHAPE/);
harness.match('…and names rerank as one of the faulty members', nonConforming.constructionError, /rerank/);

const rowYieldingNothing = {
	name: 'empty',
	enabled: true,
	construct: (rowConstructionOptions, rowCallback) => rowCallback('', undefined),
};
const yieldingNothing = constructWith({ providerName: 'empty' }, [rowYieldingNothing]);
harness.ok(
	'a row that reports success but yields NO provider object is refused — absence, not just wrongness',
	!!yieldingNothing.constructionError,
	yieldingNothing.constructionError,
);
// ⟪MUTATION M11 FOUND THE ASSERTION ABOVE VACUOUS AND THIS IS THE REPAIR.⟫ Removing the no-provider check
// left the suite GREEN: an undefined provider then reaches judgeProviderViolation, which refuses it anyway,
// so `!!constructionError` still held. Defence in depth is good and the second check should stay — but an
// assertion satisfied by the NEXT check does not prove THIS one exists. Asserting the specific sentence is
// what makes its removal visible, and it matters because the two refusals say different things to an
// operator: "your row returned nothing" is a fault in the ROW, not in the provider's shape.
harness.match(
	'…and the refusal is its OWN sentence, so removing the check is visible rather than absorbed by the next one',
	yieldingNothing.constructionError,
	/yielded NO provider object/,
);

const rowRefusing = {
	name: 'refuser',
	enabled: true,
	construct: (rowConstructionOptions, rowCallback) => rowCallback('THE ROW REFUSED: canned construction fault', null),
};
const rowRefused = constructWith({ providerName: 'refuser' }, [rowRefusing]);
harness.match(
	'a row s OWN construction refusal reaches the caller intact — the registry does not swallow or reword it',
	rowRefused.constructionError,
	/THE ROW REFUSED: canned construction fault/,
);
harness.ok('…and still yields no provider', !rowRefused.provider);

// THE ROW MUST NOT BE ABLE TO LIE ABOUT WHICH ROW IT IS. This is what makes a model collision
// unconstructable rather than merely unlikely: model must begin `${provider.name}:`, so if the
// provider's name must also equal the ROW's name, two rows can never produce one model.
const impostorRow = {
	name: 'declaredAsThis',
	enabled: true,
	construct: (rowConstructionOptions, rowCallback) => rowCallback('', conformingProvider({ name: 'butActuallyThis' })),
};
const impostor = constructWith({ providerName: 'declaredAsThis' }, [impostorRow]);
harness.ok('a provider whose own name DISAGREES with its row is refused', !!impostor.constructionError, impostor.constructionError);
harness.match('…the refusal names the row', impostor.constructionError, /declaredAsThis/);
harness.match('…and what the provider called itself', impostor.constructionError, /butActuallyThis/);

// =====================================================================
harness.section('G-F1-b — A MODEL COLLISION IS REFUSED AT CONSTRUCTION, NEVER REACHABLE AT RUN TIME');
// =====================================================================

// TWO ROWS REPORTING THE SAME `model`. There are two ways to attempt it and BOTH are closed.
const collidingByDuplicateName = [rowConstructingSynchronously({ name: 'twin' }), rowConstructingSynchronously({ name: 'twin' })];
const duplicateName = constructWith({ providerName: 'twin' }, collidingByDuplicateName);
harness.ok(
	'G-F1-b (a): two rows sharing a NAME are refused — identical names would mint identical identities',
	!!duplicateName.constructionError,
	duplicateName.constructionError,
);
harness.match('…the refusal names the duplicated row', duplicateName.constructionError, /twin/);
harness.ok('…and yields no provider', !duplicateName.provider);

// (b) two DIFFERENTLY-named rows whose providers both claim ONE model string. The namespace rule closes
// it: `model` must begin `${name}:`, so at most one differently-named row can own any given model.
const collidingByModelRow = {
	name: 'gamma',
	enabled: true,
	construct: (rowConstructionOptions, rowCallback) => rowCallback('', conformingProvider({ name: 'gamma', model: 'alpha:w-1' })),
};
const collidingByModel = constructWith({ providerName: 'gamma' }, [alphaRow, collidingByModelRow]);
harness.ok(
	'G-F1-b (b): a row whose provider claims ANOTHER row s model string is refused',
	!!collidingByModel.constructionError,
	collidingByModel.constructionError,
);
harness.match('…because model must be namespaced by the provider s own name', collidingByModel.constructionError, /namespaced/);
harness.ok('…and yields no provider', !collidingByModel.provider);

harness.ok(
	'…and the THREE REAL identities are pairwise distinct, so no collision exists to refuse today',
	(() => {
		const realNameList = judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.map((oneRow) => oneRow.name);
		return new Set(realNameList).size === realNameList.length;
	})(),
	judgeProviderRegistryLib.JUDGE_PROVIDER_ROW_LIST.map((oneRow) => oneRow.name).join(', '),
);

// =====================================================================
harness.section('DOCKET (iii) — describe() THAT IS NOT A FUNCTION IS REFUSED, NEVER INVOKED');
// =====================================================================

const describeNotAFunctionRow = {
	name: 'mute',
	enabled: true,
	construct: (rowConstructionOptions, rowCallback) =>
		rowCallback('', Object.assign(conformingProvider({ name: 'mute' }), { describe: 'NOT A FUNCTION' })),
};
const describeNotAFunction = constructWith({ providerName: 'mute' }, [describeNotAFunctionRow]);
harness.ok(
	'a provider whose describe is not a function is refused BY NAME rather than invoked',
	!!describeNotAFunction.constructionError,
	describeNotAFunction.constructionError,
);
harness.match('…and the refusal names describe', describeNotAFunction.constructionError, /describe/);
harness.ok('…and yields no provider', !describeNotAFunction.provider);

const describeAbsentRow = {
	name: 'silent',
	enabled: true,
	construct: (rowConstructionOptions, rowCallback) => {
		const provider = conformingProvider({ name: 'silent' });
		delete provider.describe;
		rowCallback('', provider);
	},
};
harness.ok(
	'…and an ABSENT describe is refused too, not only a wrongly-typed one',
	!!constructWith({ providerName: 'silent' }, [describeAbsentRow]).constructionError,
	constructWith({ providerName: 'silent' }, [describeAbsentRow]).constructionError,
);
harness.match(
	'THE REGISTRY HEADER DOCUMENTS THAT describe() MUST NOT THROW — the contract a pre-check cannot enforce',
	registrySourceText,
	/describe\(\)[\s\S]{0,400}must not throw/i,
);
// EVERY catch IN THE REGISTRY MUST BE THE BOUNDARY TRANSLATION, AND THAT IS STRONGER THAN COUNTING ZERO.
// The codebase already ruled on this idiom in build.js's own words, where the same crossing used to happen
// before JOB 4 moved the catch into the registry: "boundary translation of a CONSTRUCTION (configuration)
// fault into the orchestrator's callback channel... Not control flow: the throw IS the §6 refusal, caught
// only to name it through build()'s callback." No line is cited because that sentence moved with its code.
// The registry needs exactly that,
// because JOB 3 ruled config faults THROW while the registry's protocol is a callback. A gate asserting
// "zero catches" would have been wrong the moment that idiom was needed — AZURE_ANCHOR's JOB 3 lesson that
// a gate which CHECKS beats a gate which COUNTS. So: every catch must BE this shape, and there must be at
// least one, or the assertion is vacuous.
const registryCatchList = commentStrippedRegistrySource.match(/catch\s*\(([A-Za-z0-9_]+)\)\s*\{([\s\S]*?)\n\t*\}/g) || [];
harness.ok('the registry has at least one catch, so the shape assertion below is not vacuous', registryCatchList.length > 0, `${registryCatchList.length} catch block(s)`);
harness.ok(
	'…and EVERY one of them is the sanctioned BOUNDARY TRANSLATION — it names the throw through the callback and does nothing else',
	registryCatchList.every((oneCatchBlock) => /allback\s*\(/.test(oneCatchBlock) && !/if\s*\(/.test(oneCatchBlock)),
	registryCatchList.join(' ||| ').slice(0, 400),
);

// =====================================================================
harness.section('DOCKET (iv) — THE TWO CONCURRENCY LITERALS ARE NOW ONE VALUE, DERIVED');
// =====================================================================

// The repair is a DERIVATION, not an assertion between two literals, so what this suite pins is that the
// derivation is still a derivation. Requiring the leaf HERE — in the test — is what lets a future
// re-literalisation of either side redden without the registry needing to know the framework exists.
const { JUDGE_CONCURRENCY } = require('../../../lib/bridge-framework/judgeConcurrency');
const debugJudgeLib = require(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'debugJudge'));

harness.equal(
	'the debug provider s maxConcurrency IS the framework ceiling — one value, not two literals that agree',
	debugJudgeLib.DEBUG_JUDGE_MAX_CONCURRENCY,
	JUDGE_CONCURRENCY,
);
harness.ok('…and the leaf that holds it is FROZEN', Object.isFrozen(require('../../../lib/bridge-framework/judgeConcurrency')));
harness.ok(
	'…and the leaf has ZERO requires of its own — it is a leaf, which is what makes it safe for both sides to read',
	fs
		.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'bridge-framework', 'judgeConcurrency.js'), 'utf8')
		.split('\n')
		.filter((oneLine) => oneLine.trim().indexOf('//') !== 0)
		.every((oneLine) => !/require\s*\(/.test(oneLine)),
);
harness.ok(
	'…and NEITHER side restates the number as a literal any more',
	(() => {
		const frameworkText = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'bridge-framework', 'bridge-framework.js'), 'utf8');
		const debugJudgeText = fs.readFileSync(path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'debugJudge.js'), 'utf8');
		return /const \{ JUDGE_CONCURRENCY \} = require/.test(frameworkText) && /DEBUG_JUDGE_MAX_CONCURRENCY = require/.test(debugJudgeText);
	})(),
);

// =====================================================================
harness.section('G6-h — DEBUG_JUDGE_PROVIDER_NAME IS DERIVED FROM debugJudge, NOT A MIRROR THAT HAPPENS TO AGREE');
// =====================================================================
// ⟪JOB 6, VELVET_PRISM 2026-09-08 — RUBY_ANCHOR's JOB 4 stand-down, its own answer to DAWN_TOWER's question⟫
// Three of the four DEBUG_JUDGE_* constants read from debugJudgeLib; PROVIDER_NAME alone was retyped as the
// literal 'debug', while the comment block directly above them claimed all four were "READ from debugJudge
// rather than retyped". The comment was false about its own first line.
//
// THE PIN HAD TO BE AN IDENTITY PIN, NOT AN EQUALITY ONE, and that is the whole point of this section.
// `'debug' === debugJudgeLib.PROVIDER_NAME` is TRUE today, so an equality assertion passes against the
// literal AND against the derivation and can tell you nothing. That is RUBY_ANCHOR's M9 exactly — "equality
// can only ever prove agreement, never derivation" — and writing the weaker assertion here, in the gate
// installed to repair M9's own species of defect, would have been the joke writing itself.
//
// So the load-bearing assertion is BEHAVIOURAL: move the SOURCE and require the CONSUMER to follow. A
// literal cannot follow. No coincidence of values can satisfy it.
const registryUnderMutatedProviderName = moduleDouble.loadWithMutations({
	modulePath: REGISTRY_FILE_PATH,
	mutationList: [{ modulePath: path.join(BRIDGE_MAKER_LIB_DIR_PATH, 'debugJudge.js'), find: "const PROVIDER_NAME = 'debug';", replace: "const PROVIDER_NAME = 'debugMovedBySection_G6h';" }],
});
harness.equal(
	'G6-h — with debugJudge s PROVIDER_NAME MOVED, the registry s constant FOLLOWS IT (a literal could not)',
	registryUnderMutatedProviderName.DEBUG_JUDGE_PROVIDER_NAME,
	'debugMovedBySection_G6h',
);
// the STRUCTURAL companion: assert the derivation against the source, the one form a coincidence cannot
// satisfy (COBALT_ANCHOR's M14, RUBY_ANCHOR's M9 repair). Deliberately paired with the behavioural
// assertion above rather than trusted alone — JOB 1's T3 proved a lexical assertion can match a
// substring and stay green through the very mutation it was written to catch.
harness.ok(
	'…and the source line is a DERIVATION from debugJudgeLib, not a quoted literal',
	/const DEBUG_JUDGE_PROVIDER_NAME = debugJudgeLib\.PROVIDER_NAME;/.test(fs.readFileSync(REGISTRY_FILE_PATH, 'utf8')),
);
// the COMPANION CASE, and it is a separate fact: deriving must not have MOVED the shipped identity.
// A "fix" that changed the value would satisfy both assertions above and silently rename the debug
// provider, which is RUBY_ANCHOR's "a refusal that fires is not the same as a refusal that fires ONLY
// when it should", turned around onto a derivation.
harness.equal('…and the derived value is still exactly the shipped identity, unmoved', judgeProviderRegistryLib.DEBUG_JUDGE_PROVIDER_NAME, 'debug');
harness.equal('…which is debugJudge s own export, read back from the unmutated module', judgeProviderRegistryLib.DEBUG_JUDGE_PROVIDER_NAME, debugJudgeLib.PROVIDER_NAME);

// =====================================================================
harness.section('DOCKET (vii) — THE VALIDATED PROVIDER IS FROZEN BEFORE IT IS HANDED OUT');
// =====================================================================

const frozenResult = constructWith({ providerName: 'alpha' }, [alphaRow]);
harness.ok('the provider the registry hands out is FROZEN', Object.isFrozen(frozenResult.provider));
harness.equal(
	'…so reassigning model between construction and use CANNOT put one identity in the cache key and another on the edge',
	thrownMessage(() => {
		frozenResult.provider.model = 'somethingElse:zzz';
	}).length > 0
		? 'refused'
		: `NOT REFUSED — model is now ${frozenResult.provider.model}`,
	'refused',
);
harness.equal('…and the identity is unmoved after the attempt', frozenResult.provider.model, 'alpha:w-1');
harness.ok(
	'…and adding a NEW member is refused too, not only reassigning an existing one',
	thrownMessage(() => {
		frozenResult.provider.smuggledMember = 1;
	}).length > 0,
);
harness.ok(
	'…the freeze is SHALLOW BY DECISION, and the header says so — every member is a string or a function',
	/shallow/i.test(registrySourceText),
);
harness.ok(
	'…and the members really are only strings and functions, which is what makes shallow enough',
	Object.keys(frozenResult.provider).every((oneMemberName) => ['string', 'number', 'function'].indexOf(typeof frozenResult.provider[oneMemberName]) !== -1),
	Object.keys(frozenResult.provider)
		.map((oneMemberName) => `${oneMemberName}:${typeof frozenResult.provider[oneMemberName]}`)
		.join(', '),
);

// =====================================================================
harness.section('G4-a — A THIRD PROVIDER IS ONE NEW FILE PLUS ONE DATA ROW; THE FACTORY SOURCE DOES NOT MOVE');
// =====================================================================

// THE FACTORY'S SOURCE, delimited in the module by markers so this gate measures a REGION rather than a
// whole file that also contains the data. Proving it "by diff, not inspection" means hashing the region
// before and after a row is added, and adding the row WITHOUT touching the region.
const FACTORY_REGION_START_MARKER = '// ⟪G4-a FACTORY REGION START⟫';
const FACTORY_REGION_END_MARKER = '// ⟪G4-a FACTORY REGION END⟫';
const factoryRegionOf = (sourceText) => {
	const startIndex = sourceText.indexOf(FACTORY_REGION_START_MARKER);
	const endIndex = sourceText.indexOf(FACTORY_REGION_END_MARKER);
	return startIndex === -1 || endIndex === -1 || endIndex < startIndex ? null : sourceText.slice(startIndex, endIndex);
};

const realFactoryRegion = factoryRegionOf(registrySourceText);
harness.ok('the factory region is delimited in the source so this gate can measure it', realFactoryRegion !== null);
harness.ok('…and it is not empty', realFactoryRegion !== null && realFactoryRegion.length > 200, `${realFactoryRegion === null ? 0 : realFactoryRegion.length} chars`);

// THE ROW-ADDED VARIANT, built in memory. No file is written: the claim is about SOURCE TEXT, and writing
// a copy into bridge-maker/lib would move the decision-block fingerprint for a test's convenience.
const ROW_LIST_ANCHOR = '// ⟪G4-a ROW LIST — ADD A PROVIDER HERE AND NOWHERE ELSE⟫';
harness.ok('the row list carries the anchor that says a new provider is added HERE and nowhere else', registrySourceText.indexOf(ROW_LIST_ANCHOR) !== -1);
const rowAddedSourceText = registrySourceText.replace(
	ROW_LIST_ANCHOR,
	`${ROW_LIST_ANCHOR}\n\t{ name: 'aThirdProvider', enabled: true, construct: (o, cb) => cb('', null) },`,
);
harness.ok('…and splicing a row in really did change the file text', rowAddedSourceText !== registrySourceText);
harness.equal(
	'G4-a: adding a provider ROW leaves the FACTORY s source BYTE-UNCHANGED — proven by sha256, not by reading it',
	sha256(factoryRegionOf(rowAddedSourceText)),
	sha256(realFactoryRegion),
);
harness.note(`G4-a factory-region sha256: ${sha256(realFactoryRegion)}`);

// …AND THE ADDED ROW IS SELECTABLE. The hash above proves the factory does not move; this proves the row
// is enough. Together they are G4-a; either alone is half of it.
const thirdProviderRow = rowConstructingSynchronously({ name: 'aThirdProvider' });
const thirdSelected = constructWith({ providerName: 'aThirdProvider' }, [alphaRow, betaRow, thirdProviderRow]);
harness.equal('…and a provider added as ONE ROW is selectable with no change to the walk', thirdSelected.constructionError, '');
harness.equal('…yielding that provider', thirdSelected.provider && thirdSelected.provider.name, 'aThirdProvider');

// G4-a EXTENDED — build.js carries ZERO direct requires of any judge factory.
const buildSourceText = fs.readFileSync(BUILD_JS_FILE_PATH, 'utf8');
const buildRequireLineList = buildSourceText
	.split('\n')
	.map((oneLine, oneIndex) => ({ lineNumber: oneIndex + 1, text: oneLine }))
	.filter((oneLine) => oneLine.text.trim().indexOf('//') !== 0 && /require\s*\(/.test(oneLine.text));
const judgeFactoryRequireLineList = buildRequireLineList.filter((oneLine) => /'llmClient'|'debugJudge'|'ollamaJudgeClient'/.test(oneLine.text));
harness.equal(
	'G4-a EXTENDED: build.js contains ZERO direct requires of any judge factory',
	judgeFactoryRequireLineList.map((oneLine) => `${oneLine.lineNumber}: ${oneLine.text.trim()}`).join(' | '),
	'',
);
harness.note(`G4-a denominator: ${buildRequireLineList.length} non-comment require( lines examined in build.js`);
harness.ok(
	'…and build.js DOES require the registry, so the seam moved rather than merely disappearing',
	/judgeProviderRegistry/.test(buildSourceText),
);

// =====================================================================
harness.section('THE THREE REAL ROWS CONSTRUCT THROUGH THE REGISTRY — hermetically, doubles the suite cannot bypass');
// =====================================================================

const throwawayIniFilePath = (fileName, contentText) => {
	const filePath = path.join(os.tmpdir(), fileName);
	fs.writeFileSync(filePath, contentText);
	return filePath;
};

const ANTHROPIC_INI_FILE_PATH = throwawayIniFilePath(
	'test-judgeProviderRegistry-anthropicAi.ini',
	'[anthropicAi]\napiKey=DUMMY-NEVER-SENT\nmodel=claude-opus-4-8\napiVersion=2023-06-01\n',
);

// PORT 11599, WHERE NOTHING LISTENS — deliberately not the real 11434. If the fetchModelTagList double is
// ever removed or bypassed, construction fails with ECONNREFUSED and this suite goes RED rather than
// quietly depending on a running Ollama. JOB 3's idiom, adopted for the same reason.
const DEAD_PORT_NUMBER = 11599;
const OLLAMA_INI_FILE_PATH = throwawayIniFilePath(
	'test-judgeProviderRegistry-ollamaJudge.ini',
	`[ollamaJudge]\nendpointHostName=127.0.0.1\nendpointPortNumber=${DEAD_PORT_NUMBER}\nwireModel=qwen2.5:32b\nmaxConcurrency=1\nrequestTimeoutMs=180000\nnumPredict=400\n`,
);
const DIGEST_FIXTURE = '9f13ba1299afea09d9a956fc6a85becc99115a6d596fae201a5487a03bdc4368';
const cannedTagList = (tagListCallback) => tagListCallback('', { models: [{ name: 'qwen2.5:32b', digest: DIGEST_FIXTURE }] });

const REAL_ROW_CASE_LIST = [
	{
		providerName: 'anthropic',
		expectedModel: 'anthropic:claude-opus-4-8',
		constructionOptions: { configFilePathByProviderName: { anthropic: ANTHROPIC_INI_FILE_PATH } },
	},
	{
		providerName: 'ollama',
		expectedModel: 'ollama:qwen2.5:32b@9f13ba1299af',
		constructionOptions: {
			configFilePathByProviderName: { ollama: OLLAMA_INI_FILE_PATH },
			componentOverrides: { ollama: { fetchModelTagList: cannedTagList } },
		},
	},
];

const runRealRowCase = (caseIndex, afterAll) => {
	if (caseIndex >= REAL_ROW_CASE_LIST.length) {
		afterAll();
		return;
	}
	const oneCase = REAL_ROW_CASE_LIST[caseIndex];
	constructWithSettled(Object.assign({ providerName: oneCase.providerName }, oneCase.constructionOptions), null, ({ constructionError, provider }) => {
		harness.equal(`the REAL '${oneCase.providerName}' row constructs through the registry`, constructionError, '');
		harness.equal(`…with the identity the contract requires`, provider && provider.model, oneCase.expectedModel);
		harness.ok(`…satisfying JUDGE_PROVIDER_SHAPE`, !!provider && Object.keys(JUDGE_PROVIDER_SHAPE.MEMBER_KIND_BY_NAME).every((oneMemberName) => provider[oneMemberName] !== undefined));
		harness.ok(`…and FROZEN`, !!provider && Object.isFrozen(provider));
		runRealRowCase(caseIndex + 1, afterAll);
	});
};

runRealRowCase(0, () => {
	// THE DEBUG ROW, whose rule comes from the CLI override and not from a second config key.
	constructWithSettled({ providerName: 'debug', debugJudgeRuleName: 'first' }, null, ({ constructionError, provider }) => {
		harness.equal('the REAL debug row constructs through the registry', constructionError, '');
		harness.ok('…and carries the rule it was given', !!provider && provider.ruleName === 'first');
		harness.ok('…and is FROZEN like every other row s product', !!provider && Object.isFrozen(provider));

		constructWithSettled({ providerName: 'debug', debugJudgeRuleName: 'nosuchrule' }, null, ({ constructionError: badRuleError, provider: badRuleProvider }) => {
			harness.ok('…and an unknown debug rule is refused by name, listing the registered rules', !!badRuleError, badRuleError);
			harness.ok('…yielding no provider', !badRuleProvider);
			harness.report();
		});
	});
});
