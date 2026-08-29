#!/usr/bin/env node
'use strict';

// test-i7bHublessReuse.js — INVARIANT I7b (SPEC-hubKitRole-082826.md §4.2 [R2 F4], §5 I7b):
//
//   "deriveHub + --reuseForgedBlocks over a HUBLESS block is refused by name."
//
// ⚠️ THIS SUITE IS EXPECTED RED AT PHASE 0 AND THAT IS ITS PURPOSE. It was written by the Phase 0
// builder (STERLING_PEAK, 2026-08-29) to OBSERVE a known defect failing before Phase 2a is allowed
// to claim it fixed. A gate never seen red is a gate nobody has proven works. Conjunct C3 is the
// one that is red; C1 and C2 are its controls and pass today. See
// zNotesPlansDocs/hubKitRole/DOCKET-bugsNotFixed.md.
//
// THE DEFECT, in the production path (code fact, apps/graph-builder/lib/build.js
// attemptBaseBlockReuse, ~:1164-1246). Reuse resolves a stored block BY SUBJECT — a name, a slot.
// Having found it, the ONLY inspection it performs on the block TEXT is
//
//     header = JSON.parse(text.slice(0, text.indexOf('\n')))
//
// i.e. the FIRST LINE, read for embeddingModelVersion / embeddingDims. It never asks whether the
// block carries a hub. So this sequence has no refusal anywhere in it:
//
//   1. build a HUBLESS ceds (recipes/cedsOnlyRoundTrip.recipe.jsonc declares "hubs": [])
//        -> the store gains a legitimate block named ceds@14_0_0_0_base with NO HubDefinition
//   2. build a HUB recipe (hubs:[ceds]) with --reuseForgedBlocks=true against that same store
//        -> reuse matches by NAME, hands back the hubless block, deriveHub NEVER RUNS
//   3. build.js checks only that a base exists; graphReader.readHubCards has no empty-pool refusal
//        -> every bridge that targets the CEDS hub then runs against ZERO cards, reporting success
//
// Two facts measured in Phase 0 that make this reachable rather than theoretical:
//   * findBlockBySubject orders by createdAt DESC, so the MOST RECENT block for a subject wins —
//     fitness is never consulted (recipes/fourWithHub-baseline.recipe.jsonc says so in its own header).
//   * CEDS is REUSABLE by name. Measured 2026-08-29: under --reuseForgedBlocks, ceds and edfi are
//     reused, while pesc260805 and sif REFUSE reuse by name because their version stamp cannot be
//     answered without parsing the source. So the one standard that has a hub is also one of the
//     two that reuse can actually reach.
//
// WHAT PHASE 2a MUST ADD, and what C3 asserts: a NAMED refusal exported as a static from build.js,
// following that module's own stated idiom — "pure helpers exported as statics so the refusal is
// provable directly, without standing up the whole build pipeline" (build.js:2073-2074).
//
//     build.refuseHublessReuseUnderDeriveHub({ deriveHub, reusedBlockText, subject }) -> '' | refusalString
//
// It must return '' when deriveHub is false (reuse of a hubless block is CORRECT under a hubless
// recipe — that is the ordinary case and must not be broken), '' when the text carries a
// HubDefinition, and a refusal NAMING THE SUBJECT otherwise.
//
// ONE-MACHINE-ONLY. C1 and C2 read the two real block texts Phase 0 forged. They are refused BY NAME
// when absent rather than skipped, because a control that silently does not run is not a control.
//
// Run: node apps/graph-builder/test/test-i7bHublessReuse.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- I7b: deriveHub + --reuseForgedBlocks over a HUBLESS block must be refused by name

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

STATUS
     EXPECTED RED at Phase 0. Conjunct C3 fails because the refusal does not exist yet.
     It goes green in Phase 2a. C1 and C2 are controls and pass today.

EXIT STATUS
     0 every conjunct passed;  1 otherwise (which is the Phase 0 expectation).
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const Database = require('better-sqlite3');
const buildLib = require('../lib/build');

const STORE_DIR = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder';
const HUB_BEARING_STORE_PATH = `${STORE_DIR}/hubKitRole_phase0.standardsDatabase.sqlite3`;
const HUBLESS_STORE_PATH = `${STORE_DIR}/hubKitRole_phase0_hubless.standardsDatabase.sqlite3`;
const CEDS_SUBJECT = 'ceds@14_0_0_0_base';

// HubDefinition is a NODE LINE in the block text: {"kind":"node",...,"labels":[...,"HubDefinition",...]}.
// Matching the quoted label is deliberate — matching the bare word would also hit prose inside a
// property value and would make the discriminator lie.
const HUB_DEFINITION_LABEL_PATTERN = /"HubDefinition"/;

const readStandardBaseText = (databasePath, subject) => {
	if (!fs.existsSync(databasePath)) {
		throw new Error(
			`${moduleName} REFUSED (ONE-MACHINE-ONLY): the Phase 0 scratch store '${databasePath}' is ` +
				`not on disk. C1 and C2 are controls over REAL forged blocks and are refused by name ` +
				`rather than skipped. Re-run the Phase 0 builds recorded in ` +
				`zNotesPlansDocs/hubKitRole/ANCHOR-082826.md first.`,
		);
	}
	const database = new Database(databasePath, { readonly: true });
	const rowList = database
		.prepare("SELECT refId, text FROM blocks WHERE kind = 'standardBase' AND subject = ?")
		.all(subject);
	database.close();
	if (rowList.length !== 1) {
		throw new Error(
			`${moduleName} REFUSED: '${databasePath}' holds ${rowList.length} standardBase block(s) for ` +
				`subject '${subject}'; exactly ONE is required for an unambiguous control.`,
		);
	}
	return {
		refId: rowList[0].refId,
		text: typeof rowList[0].text === 'string' ? rowList[0].text : `${rowList[0].text}`,
	};
};

// ---------------------------------------------------------------------------------------------
// C1 — POSITIVE CONTROL: the two real blocks differ in exactly the way the discriminator needs.
// Without this, a red C3 could mean "the fixtures are wrong" rather than "the refusal is missing".
// ---------------------------------------------------------------------------------------------
harness.section('C1 — CONTROL: the hub-bearing and hubless CEDS blocks are genuinely distinguishable');

const hubBearing = readStandardBaseText(HUB_BEARING_STORE_PATH, CEDS_SUBJECT);
const hubless = readStandardBaseText(HUBLESS_STORE_PATH, CEDS_SUBJECT);

harness.equal(
	`the hub-bearing block (${hubBearing.refId.slice(0, 12)}…) CONTAINS a HubDefinition node line`,
	HUB_DEFINITION_LABEL_PATTERN.test(hubBearing.text),
	true,
);
harness.equal(
	`the hubless block (${hubless.refId.slice(0, 12)}…) contains NO HubDefinition node line`,
	HUB_DEFINITION_LABEL_PATTERN.test(hubless.text),
	false,
);
harness.equal(
	'the two blocks are DIFFERENT artifacts (different content addresses) yet share ONE subject — which is exactly why resolution by NAME cannot tell them apart',
	hubBearing.refId !== hubless.refId,
	true,
);

// ---------------------------------------------------------------------------------------------
// C2 — THE HAZARD, OBSERVED: the reuse path inspects only the block's FIRST LINE.
// ---------------------------------------------------------------------------------------------
harness.section('C2 — the production reuse path inspects only the header line');

const buildSourceText = fs.readFileSync(`${__dirname}/../lib/build.js`, 'utf8');
const reuseFunctionText = buildSourceText.slice(
	buildSourceText.indexOf('const attemptBaseBlockReuse'),
	buildSourceText.indexOf('const forgeOneStandard'),
);

harness.equal(
	'attemptBaseBlockReuse was located in build.js (if this fails the function was renamed and this suite must be re-pointed, not deleted)',
	reuseFunctionText.length > 0,
	true,
);
harness.match(
	'it reads the FIRST LINE for the embedding identity',
	reuseFunctionText,
	/text\.slice\(0,\s*text\.indexOf\('\\n'\)\)/,
);
harness.equal(
	'and it performs NO HubDefinition inspection anywhere — this is the defect',
	HUB_DEFINITION_LABEL_PATTERN.test(reuseFunctionText) || /HubDefinition/.test(reuseFunctionText),
	false,
);

// ---------------------------------------------------------------------------------------------
// C3 — THE REQUIREMENT. RED at Phase 0. GREEN when Phase 2a lands the refusal.
// ---------------------------------------------------------------------------------------------
harness.section('C3 — I7b: the named refusal (EXPECTED RED until Phase 2a)');

const refuse = buildLib.refuseHublessReuseUnderDeriveHub;

harness.equal(
	'build.js exports refuseHublessReuseUnderDeriveHub as a static (build.js\'s own idiom: "pure helpers exported as statics so the refusal is provable directly")',
	typeof refuse === 'function',
	true,
);

if (typeof refuse === 'function') {
	harness.equal(
		'I7b: deriveHub TRUE over a HUBLESS block is REFUSED',
		refuse({ deriveHub: true, reusedBlockText: hubless.text, subject: CEDS_SUBJECT }) !== '',
		true,
	);
	harness.match(
		'  and the refusal NAMES THE SUBJECT (refused by name, never a bare boolean)',
		refuse({ deriveHub: true, reusedBlockText: hubless.text, subject: CEDS_SUBJECT }),
		new RegExp(CEDS_SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
	);
	harness.equal(
		'CONTROL: deriveHub TRUE over a HUB-BEARING block is ADMITTED (the gate must not refuse the correct case)',
		refuse({ deriveHub: true, reusedBlockText: hubBearing.text, subject: CEDS_SUBJECT }),
		'',
	);
	harness.equal(
		'CONTROL: deriveHub FALSE over a HUBLESS block is ADMITTED (a hubless recipe reusing a hubless block is CORRECT and must keep working)',
		refuse({ deriveHub: false, reusedBlockText: hubless.text, subject: CEDS_SUBJECT }),
		'',
	);
} else {
	harness.equal(
		'I7b: deriveHub TRUE over a HUBLESS block is REFUSED — NOT MEASURABLE: the refusal does not exist, so nothing refuses. THIS IS THE DEFECT, observed. (Phase 2a)',
		false,
		true,
	);
}

harness.report();
