'use strict';

// test-hubDeclarationContract.js — the hub kit role's descriptor contract, gated (Phase 2a,
// SPEC-hubKitRole-082826.md §4.1 [R2 F5], §4.2; invariant I7's upstream half).
//
// WHAT THIS SUITE IS FOR. Phase 2a deleted the forger's HUB_FORGE_BY_STANDARD registry and moved the
// hub declaration into each kit's parserDescriptor.ini. A registry was a table someone had to EDIT,
// so a malformed row was a code review away from being caught. A descriptor is a CONFIG FILE an
// operator edits, and the ini reader DISCARDS what it does not understand — so the only thing
// standing between a typo and a silently hubless build is this contract. Every refusal below was
// OBSERVED FIRING before it was trusted (the campaign's three-state rule).
//
// STANDDOWN-P1's one-sentence lesson for this phase: "your suites will be green on a broken build".
// This suite is therefore written as NEGATIVE CASES WITH CONTROLS — each refusal is paired with the
// admission it must NOT swallow, because a validator that refuses everything is as useless as one
// that refuses nothing and passes a test suite just as easily.
//
// Run: node lib/hub-framework/test/test-hubDeclarationContract.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the hub descriptor contract: table-driven, unknown-key refusal, no silent default

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const contract = require('../hubDeclarationContract');
const { validateHubDescriptor, HUB_DESCRIPTOR_CONTRACT, HUB_DESCRIPTOR_KEY_LIST } = contract;

const DESCRIPTOR_PATH = 'forges/ceds/parserDescriptor.ini';
const refusalFor = (descriptor) => {
	const fault = validateHubDescriptor({ descriptor, descriptorPath: DESCRIPTOR_PATH });
	return fault === null ? '' : fault.message;
};
// THE FIXTURE READS THE LIVE DESCRIPTOR rather than restating the URL. Invariant I8 exempts tests,
// but a literal here would still be a SECOND PLACE THE VALUE LIVES, and the negative cases below are
// stronger for being DERIVED from the real value: "the same string minus its trailing slash" cannot
// drift away from what production actually declares, whereas a hand-typed near-miss can.
const forgerModule = require(path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'forger', 'forger'));
const LIVE_CEDS_BUNDLE = forgerModule.resolveBundle({ standard: 'ceds' });
if (LIVE_CEDS_BUNDLE.error) {
	throw new Error(`${moduleName} REFUSED: the live ceds bundle did not resolve — ${LIVE_CEDS_BUNDLE.error}`);
}
const WELL_FORMED = Object.freeze({
	standardName: 'CEDS',
	entryModule: 'forgeCeds.js',
	hubModule: LIVE_CEDS_BUNDLE.hubModuleFileName,
	hubNamespace: LIVE_CEDS_BUNDLE.hubNamespace,
});
const withHub = (overrideObject) => Object.assign({}, WELL_FORMED, overrideObject);

// ---------------------------------------------------------------------------------------------
harness.section('SHAPE — the contract is a frozen TABLE, not a switch (polyArch2 §7)');

harness.ok(
	'HUB_DESCRIPTOR_CONTRACT is frozen',
	Object.isFrozen(HUB_DESCRIPTOR_CONTRACT),
	`${Object.isFrozen(HUB_DESCRIPTOR_CONTRACT)}`,
);
harness.equal(
	'it names exactly the two hub keys the descriptor may carry',
	JSON.stringify(HUB_DESCRIPTOR_KEY_LIST),
	JSON.stringify(['hubModule', 'hubNamespace']),
);
harness.ok(
	'every entry declares a kind that the ONE kind-checker registry can answer (no orphan kinds)',
	HUB_DESCRIPTOR_KEY_LIST.every(
		(oneName) => typeof contract.KIND_CHECKER_REGISTRY[HUB_DESCRIPTOR_CONTRACT[oneName].kind] === 'function',
	),
	HUB_DESCRIPTOR_KEY_LIST.map((oneName) => `${oneName}:${HUB_DESCRIPTOR_CONTRACT[oneName].kind}`).join(', '),
);

// ---------------------------------------------------------------------------------------------
harness.section('CONTROLS — the two shapes that MUST be admitted (a validator that refuses everything is not a gate)');

harness.equal('a well-formed hub kit is ADMITTED', refusalFor(WELL_FORMED), '');
harness.equal(
	'a kit that declares NO hub key at all is ADMITTED — not being a hub is legal and is the common case (edfi, sif, pesc260805)',
	refusalFor({ standardName: 'EdFi', entryModule: 'forgeEdfi.js', roundTripValidator: 'roundTripValidator.js' }),
	'',
);
harness.equal(
	'THE LIVE DESCRIPTOR ON DISK is admitted — this suite gates the real file, not only synthetic shapes',
	LIVE_CEDS_BUNDLE.error ? LIVE_CEDS_BUNDLE.error : '',
	'',
);

// ---------------------------------------------------------------------------------------------
harness.section('UNKNOWN KEY — a typo must not become a silently ignored declaration');

harness.match(
	'an unrecognised hub* key is REFUSED, naming the offending key',
	refusalFor(withHub({ hubVerison: '14' })),
	/unknown hub key 'hubVerison'/,
);
harness.match(
	'  and the refusal names what IS allowed, so the operator can see the correction',
	refusalFor(withHub({ hubVerison: '14' })),
	/HUB_DESCRIPTOR_CONTRACT names hubModule, hubNamespace/,
);
harness.equal(
	'CONTROL: a NON-hub key the hub contract does not own is left alone (it does not police the whole descriptor)',
	refusalFor(withHub({ someOtherKitKey: 'x' })),
	'',
);

// ---------------------------------------------------------------------------------------------
harness.section('HALF-DECLARED HUB — declaring one key and not the other is a typo, never a default');

harness.match(
	'hubModule with no hubNamespace is REFUSED by name',
	refusalFor({ standardName: 'CEDS', hubModule: 'lib/cedsHubForge.js' }),
	/missing required hub key 'hubNamespace'/,
);
harness.match(
	'hubNamespace with no hubModule is REFUSED by name',
	refusalFor({ standardName: 'CEDS', hubNamespace: WELL_FORMED.hubNamespace }),
	/missing required hub key 'hubModule'/,
);

// ---------------------------------------------------------------------------------------------
harness.section('hubModule — a kit declares its OWN modules');

harness.match('empty/whitespace is REFUSED', refusalFor(withHub({ hubModule: '   ' })), /must be a non-empty string/);
harness.match(
	'an ABSOLUTE path is REFUSED — hubModule is resolved against the bundle directory',
	refusalFor(withHub({ hubModule: '/etc/passwd.js' })),
	/must be KIT-RELATIVE, not absolute/,
);
harness.match(
	"a path climbing out of the kit with '..' is REFUSED",
	refusalFor(withHub({ hubModule: '../../elsewhere.js' })),
	/must not climb out of the bundle/,
);
harness.match(
	'a path that does not name a .js module is REFUSED',
	refusalFor(withHub({ hubModule: 'lib/cedsHubForge' })),
	/must name a \.js module/,
);
harness.equal('CONTROL: a nested kit-relative .js path is ADMITTED', refusalFor(withHub({ hubModule: 'lib/deeper/hubX.js' })), '');

// ---------------------------------------------------------------------------------------------
harness.section('hubNamespace — the trailing slash is LOAD-BEARING, not cosmetic');

harness.match('a non-URI is REFUSED', refusalFor(withHub({ hubNamespace: 'w3id.org/hub/' })), /must be an http\(s\) URI/);
harness.match(
	'a URI with NO TRAILING SLASH is REFUSED — card uris are composed by CONCATENATION onto this value, so without it every uri in the block silently loses its separator and the block id moves with nothing to say so',
	refusalFor(withHub({ hubNamespace: WELL_FORMED.hubNamespace.replace(/\/$/, '') })),
	/must end with '\/'/,
);
harness.equal('CONTROL: http (not only https) is ADMITTED', refusalFor(withHub({ hubNamespace: 'http://example.org/hub/' })), '');

// ---------------------------------------------------------------------------------------------
harness.section('THE ARGUMENT ITSELF — absent is absent');

harness.match('a null descriptor is REFUSED by name', refusalFor(null), /descriptor is null/);
harness.match('an array descriptor is REFUSED by name', refusalFor([]), /descriptor is an array/);
harness.match('a string descriptor is REFUSED by name', refusalFor('nope'), /descriptor is a string/);

// =================================================================================================
// PHASE 2c — THE H1 DECLARATION CONTRACT (SPEC §4.4). Phase 2a's skeleton validated only the
// DESCRIPTOR; the declaration table arrived with the extraction and is gated here.
//
// The two refusal classes FROZEN_JOURNEY named are both driven: UNKNOWN KEY and MISSING REQUIRED
// KEY. Each is paired with the admission it must not swallow — a validator that refuses everything
// passes a negative suite exactly as easily as one that refuses nothing.
// =================================================================================================
harness.section('H1 DECLARATION — shape');

const liveDeclaration = require('../../../forges/ceds/lib/cedsHubDeclaration');
const declarationRefusalFor = (hubDeclaration) => {
	const fault = contract.validateHubDeclaration({ hubDeclaration });
	return fault === null ? '' : fault.message;
};
const withoutKey = (oneName) => {
	const copy = Object.assign({}, liveDeclaration);
	delete copy[oneName];
	return copy;
};

harness.ok(
	'HUB_DECLARATION_CONTRACT is frozen and names the eight §4.4 fields',
	Object.isFrozen(contract.HUB_DECLARATION_CONTRACT) &&
		JSON.stringify(contract.HUB_DECLARATION_KEY_LIST) ===
			JSON.stringify([
				'hubName', 'hubDisplayName', 'canonicalKeyName', 'canonicalKeyMinted',
				'sourceIdFieldName', 'baseFieldNames', 'qualifiedReference', 'provenanceLabel',
			]),
	JSON.stringify(contract.HUB_DECLARATION_KEY_LIST),
);

harness.section('H1 DECLARATION — CONTROL: the LIVE CEDS declaration is admitted');
harness.equal(
	'THE REAL forges/ceds/lib/cedsHubDeclaration.js is ADMITTED — this suite gates the file production loads, not only synthetic shapes',
	declarationRefusalFor(liveDeclaration),
	'',
);

harness.section('H1 DECLARATION — REFUSAL CLASS 1: an unknown key (a typo must not be silently ignored)');
harness.match(
	'an unknown top-level property is REFUSED, naming the offender',
	declarationRefusalFor(Object.assign({}, liveDeclaration, { hubDisplayNmae: 'a plausible typo' })),
	/unknown property 'hubDisplayNmae'/,
);
harness.match(
	'  and the refusal lists what IS allowed, so the operator can see the correction',
	declarationRefusalFor(Object.assign({}, liveDeclaration, { hubDisplayNmae: 'x' })),
	/HUB_DECLARATION_CONTRACT names hubName, hubDisplayName/,
);

harness.section('H1 DECLARATION — REFUSAL CLASS 2: a missing REQUIRED key, one per field');
['hubName', 'hubDisplayName', 'canonicalKeyName', 'canonicalKeyMinted', 'sourceIdFieldName', 'baseFieldNames', 'provenanceLabel'].forEach(
	(oneName) => {
		harness.match(
			`a declaration missing '${oneName}' is REFUSED BY NAME (absent is absent, never defaulted)`,
			declarationRefusalFor(withoutKey(oneName)),
			new RegExp(`missing required property '${oneName}'`),
		);
	},
);

harness.section('H1 DECLARATION — CONTROL: the ONE optional field is admitted when absent');
harness.equal(
	'qualifiedReference OMITTED is ADMITTED — a hub with no identification patterns declares none, pass 2 is skipped, and identificationPatterns is []. Without this control the seven refusals above would also pass against a validator that simply refused everything.',
	declarationRefusalFor(withoutKey('qualifiedReference')),
	'',
);

harness.section('H1 DECLARATION — baseFieldNames is the check that makes the map worth having');
harness.match(
	'a baseFieldNames map MISSING a field the derivation reads is REFUSED — otherwise it reads properties[undefined] and drops prose SILENTLY, which no count can see',
	declarationRefusalFor(
		Object.assign({}, liveDeclaration, {
			baseFieldNames: (() => {
				const copy = Object.assign({}, liveDeclaration.baseFieldNames);
				delete copy.dataType;
				return copy;
			})(),
		}),
	),
	/missing required base field name\(s\): dataType/,
);
harness.match(
	'an UNKNOWN base field name is REFUSED (the derivation reads a closed set)',
	declarationRefusalFor(
		Object.assign({}, liveDeclaration, {
			baseFieldNames: Object.assign({}, liveDeclaration.baseFieldNames, { notAField: 'x' }),
		}),
	),
	/unknown base field name 'notAField'/,
);

harness.section('H1 DECLARATION — provenanceLabel carries BLOCK BYTES');
harness.match(
	'a provenanceLabel missing forgeModule is REFUSED, saying WHY it matters (an absent one would stamp undefined into every hub block)',
	declarationRefusalFor(Object.assign({}, liveDeclaration, { provenanceLabel: { forgeModuleVersion: '1.0.0' } })),
	/forgeModule must be .*BLOCK BYTES/s,
);
harness.equal(
	'CONTROL: the live provenanceLabel is exactly the pair Phase 2b re-keyed and proved',
	JSON.stringify(liveDeclaration.provenanceLabel),
	JSON.stringify({ forgeModule: 'hub-framework', forgeModuleVersion: '1.0.0' }),
);

harness.section('H1 HOOKS — present and empty is legal; an unimplemented hook is refused, not ignored');
harness.equal(
	'CONTROL: the LIVE cedsHubHooks (empty) is ADMITTED',
	(() => {
		const fault = contract.validateHubHooks({ hooks: require('../../../forges/ceds/lib/cedsHubHooks')() });
		return fault === null ? '' : fault.message;
	})(),
	'',
);
harness.match(
	'an UNKNOWN hook name is REFUSED — a hub author learns at injection instead of wondering why nothing happened',
	(() => {
		const fault = contract.validateHubHooks({ hooks: { emitExtraCards: () => {} } });
		return fault === null ? '' : fault.message;
	})(),
	/unknown hook 'emitExtraCards'/,
);

harness.report();
