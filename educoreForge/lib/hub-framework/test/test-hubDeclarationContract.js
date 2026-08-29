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

harness.report();
