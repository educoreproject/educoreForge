'use strict';

// p1_pluginDeclarationValidation.js — LUNAR_PRISM (P1), 2026-08-17.
//
// CP-P1 REQUIRES "the plugin validates". An ACCEPTED from a validator I invoked myself is not that:
// a check whose negative result I have never seen is UNPROVEN, and this order has already been burnt
// by an instrument that could not fail. So this asserts acceptance AND drives four DISTINCT refusals
// through the SAME shipped validator, on four different axes, with the unmutated declaration as the
// control. Reports the assertion count reached beside the failure count.
//
// TWO OF THE NEGATIVES DOUBLE AS LIVE CONFIRMATION OF CODE FACTS I REPORTED FROM SOURCE READING:
//   NEGATIVE 2 — a per-tier candidateRetrieval key is refused BY NAME. That is the seam the value
//                tier would need and does not have. Reported to the supervisor as a source reading;
//                here it is OBSERVED.
//   NEGATIVE 4 — a value-domain predicate is refused BY NAME because SKOS_PREDICATES is a closed
//                five-value set with no term for "is the value domain of". This is why the sibling
//                option-set plugin ships relatedMatch as the HONEST FLOOR imposed by the interchange
//                standard, recorded as an UNDERSTATEMENT rather than mislabelled as exactMatch.
//
// Pure: requires the contract module and the plugin. No graph, no container, no store.

const path = require('path');
const crypto = require('crypto');

const moduleName = 'p1_pluginDeclarationValidation';
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const contractLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'bridgePluginContract'));
const bundleDirPath = path.join(TREE_ROOT, 'forges', 'pesc260805');
// BOTH plugins, not one. A probe that silently covers half the deliverable is the same genus of
// empty measurement this order keeps finding — and the sibling is the one carrying the UNDERSTATED
// predicate, so it is the one most worth validating.
const PLUGIN_NAME_LIST = ['pescCedsDerivedPlugin', 'pescOptionSetCedsDerivedPlugin'];

const resultList = [];
let assertionsReached = 0;
let failedCount = 0;
const assert = ({ name, pass, detail }) => {
	assertionsReached += 1;
	if (!pass) { failedCount += 1; }
	resultList.push({ name, verdict: pass ? 'PASS' : 'FAIL', detail });
};

const refusalTextFor = (candidate) => {
	const verdict = contractLib.validateBridgeDeclaration({ bridgeDeclaration: candidate, bundleDirPath });
	return verdict && verdict.error ? (verdict.error.message || String(verdict.error)) : '';
};

const digestByPluginName = {};

PLUGIN_NAME_LIST.forEach((onePluginName) => {
	const pluginModule = require(path.join(bundleDirPath, 'bridges', onePluginName));
	const shipped = pluginModule.bridgeDeclaration;
	const shippedRefusal = refusalTextFor(shipped);
	assert({ name: `CONTROL ${onePluginName} — the SHIPPED declaration validates`, pass: shippedRefusal === '', detail: shippedRefusal || 'ACCEPTED' });

	const hookProblem = contractLib.validateBridgeHooks({ bridgeHooks: pluginModule.bridgeHooks, bridgeDeclaration: shipped });
	assert({
		name: `CONTROL ${onePluginName} — the empty hook object validates (a derived basis FORBIDS both mandatory hooks)`,
		pass: !hookProblem || !(hookProblem.error || hookProblem.message),
		detail: hookProblem && (hookProblem.error || hookProblem.message) ? String(hookProblem.error || hookProblem.message) : 'ACCEPTED',
	});

	assert({
		name: `CONTROL ${onePluginName} — standardKey equals the bundle directory (BR-009, pluginRegistry.js:48)`,
		pass: shipped.standardKey === 'pesc260805',
		detail: `standardKey='${shipped.standardKey}'`,
	});

	digestByPluginName[onePluginName] = crypto.createHash('sha256').update(contractLib.canonicalJsonText(shipped)).digest('hex');
});

// THE TWO DIGESTS MUST DIFFER. They are different runs over different populations, and a scheme that
// gave them one id would be HIDING that — the same reasoning the Ed-Fi derived plugin records for its
// own two phase-switched scopes.
assert({
	name: 'the two sibling declarations have DISTINCT digests (one id for two populations would hide the difference)',
	pass: digestByPluginName[PLUGIN_NAME_LIST[0]] !== digestByPluginName[PLUGIN_NAME_LIST[1]],
	detail: `${digestByPluginName[PLUGIN_NAME_LIST[0]].slice(0, 16)}… vs ${digestByPluginName[PLUGIN_NAME_LIST[1]].slice(0, 16)}…`,
});

// the NEGATIVES are driven through the property-tier declaration; they exercise the VALIDATOR, which
// is shared, so driving them twice would prove nothing twice.
const shipped = require(path.join(bundleDirPath, 'bridges', PLUGIN_NAME_LIST[0])).bridgeDeclaration;

const negativeList = [
	{ name: 'NEGATIVE 1 unknown top-level key is refused BY NAME (why the dedup rule lives on disk, not in the declaration)', mutate: (d) => ({ ...d, dedupRule: { concepts: 2213 } }), expectText: "unknown key 'dedupRule'" },
	{ name: 'NEGATIVE 2 a PER-TIER candidateRetrieval key is refused BY NAME — the value tier has no seam here', mutate: (d) => ({ ...d, candidateRetrieval: { ...d.candidateRetrieval, referenceTier: 'value' } }), expectText: "unknown key 'referenceTier'" },
	{ name: 'NEGATIVE 3 an IDENTIFIER in the subject allow-list is refused BY NAME (the bias audit)', mutate: (d) => ({ ...d, renderingAllowList: { ...d.renderingAllowList, subject: [...d.renderingAllowList.subject, 'stableId'] } }), expectText: 'RENDERING_NEVER_NAME_LIST' },
	{ name: 'NEGATIVE 4 a value-domain predicate is refused BY NAME — SKOS has no word for it', mutate: (d) => ({ ...d, predicateByCategory: { ...d.predicateByCategory, strong: 'valueDomainOf' } }), expectText: 'SKOS_PREDICATES' },
];

negativeList.forEach((oneNegative) => {
	const refusalText = refusalTextFor(oneNegative.mutate({ ...shipped }));
	assert({
		name: oneNegative.name,
		pass: refusalText !== '' && refusalText.indexOf(oneNegative.expectText) !== -1,
		detail: refusalText === '' ? 'DID NOT REFUSE — the validator is not reachable on this axis' : refusalText.slice(0, 200),
	});
});


process.stdout.write(`${JSON.stringify({
	probe: moduleName,
	assertionsReached,
	failedCount,
	verdict: assertionsReached === 0 ? 'VACUOUS — NOTHING RAN' : failedCount === 0 ? 'ALL GREEN' : 'RED',
	note: 'A failure count without the assertion count reached cannot distinguish a clean pass from a suite that aborted before asserting anything.',
	declarationDigestByPluginName: digestByPluginName,
	resultList,
}, null, 2)}\n`);
process.exitCode = failedCount === 0 && assertionsReached > 0 ? 0 : 1;
