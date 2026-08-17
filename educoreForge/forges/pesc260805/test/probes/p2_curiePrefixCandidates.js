'use strict';

// p2_curiePrefixCandidates.js — LUNAR_PRISM (P2), 2026-08-17. RETAINED per O-7 and per SABLE_RIVER's
// standing CP-P2 condition: EVERY MEASUREMENT SCRIPT BEHIND A NUMBER IN THE REPORT LIVES IN THE REPO.
// The reason is P0b's permanent provenance break — a figure whose script is deleted cannot be checked
// by anyone, ever.
//
// THE QUESTION. The census build FAILED in SSSOM export: subjectStableId 'urn:org:pesc:...' does not
// begin with the declared subjectCuriePrefix 'pesc:'. The exporter's rule is a literal
// indexOf(prefix + ':') !== 0 -> REFUSE ([code fact] lib/bridge-framework/sssomExporter.js:197), and
// its own comment states the assumption it rests on: "a forged id already carries its standard's
// prefix (`toy:property/…`, `<standard>:property/…`)".
//
// THAT ASSUMPTION HELD FOR THREE STANDARDS AND IS WRONG IN GENERAL. Ed-Fi and SIF mint CURIE-shaped
// stableIds; PESC mints URNs, correctly — urn:org:pesc:* is its OWN published namespace, enforced by
// its parser's refusal. PESC IS THE FIRST URN-SHAPED STANDARD THROUGH THIS SEAM.
//
// WHAT THIS PROBE DOES. Tests every candidate prefix against BOTH gates that matter — the exporter's
// own predicate, reproduced from source rather than paraphrased, and the REAL declaration validator —
// over REAL stableIds, and states each candidate's NAMESPACE CLAIM separately from whether it passes.
// **PASSING AND BEING TRUE ARE DIFFERENT PROPERTIES AND THE POINT OF THE TABLE IS TO SHOW BOTH.**
//
// I had framed the choice as "pass the check or tell the truth". SABLE_RIVER found the option that
// does both (RULING P2-R1): the check is a plain startsWith, so a MULTI-SEGMENT prefix satisfies it
// as well as a token does, and nothing ever required the prefix to be short.

const path = require('path');

const moduleName = 'p2_curiePrefixCandidates';
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const contractLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'bridgePluginContract'));
const bundleDirPath = path.join(TREE_ROOT, 'forges', 'pesc260805');
const shippedDeclaration = require(path.join(bundleDirPath, 'bridges', 'pescCedsDerivedPlugin')).bridgeDeclaration;

// THE EXPORTER'S RULE, REPRODUCED FROM SOURCE. If sssomExporter.js:197 ever changes, this line must
// change with it — and a paraphrase that drifts is exactly the failure this project keeps finding, so
// it is written to look like the original rather than to read nicely.
const exporterAccepts = (subjectStableId, prefix) => subjectStableId.indexOf(`${prefix}:`) === 0;

const REAL_STABLE_ID_LIST = [
	'urn:org:pesc:core:CoreMain:v1.0.0#complexType/AcademicDegreeRequirementType/el/2:ThesisDissertationAdvisor',
	'urn:org:pesc:message:CollegeTranscript:v1.7.0#element/CollegeTranscript/anon/1/el/1:TransmissionData',
	'urn:org:pesc:codes:iso_3166-1:v1.0.0#simpleType/CountryAlpha2CodeSimpleType',
	'urn:org:pesc:sector:AcademicRecord:v1.6.0#complexType/AcademicAwardType/el/1:AcademicAwardLevel',
];

const CANDIDATE_LIST = [
	{ prefix: 'pesc', namespaceClaim: 'FALSE — no PESC stableId begins `pesc:`. This was the shipped value and it is the defect.' },
	{ prefix: 'urn', namespaceClaim: 'FALSE AS A NAMESPACE — `urn` is a URI SCHEME. It asserts "the namespace of these identifiers is the URN scheme", which is untrue of every URN ever minted.' },
	{ prefix: 'urn:org:pesc', namespaceClaim: "TRUE — `urn:org:pesc` IS PESC's published org namespace, the same string its own parser enforces (parser.js:40)." },
];

const rowList = CANDIDATE_LIST.map((oneCandidate) => {
	const acceptedCount = REAL_STABLE_ID_LIST.filter((oneId) => exporterAccepts(oneId, oneCandidate.prefix)).length;
	const verdict = contractLib.validateBridgeDeclaration({ bridgeDeclaration: { ...shippedDeclaration, subjectCuriePrefix: oneCandidate.prefix }, bundleDirPath });
	return {
		prefix: oneCandidate.prefix,
		exporterAccepts: `${acceptedCount} of ${REAL_STABLE_ID_LIST.length}`,
		exporterVerdict: acceptedCount === REAL_STABLE_ID_LIST.length ? 'PASSES ALL' : 'REFUSES',
		declarationValidator: verdict && verdict.error ? `REFUSED: ${String(verdict.error.message || verdict.error).slice(0, 110)}` : 'ACCEPTED',
		namespaceClaim: oneCandidate.namespaceClaim,
	};
});

const shippedRow = rowList.find((oneRow) => oneRow.prefix === shippedDeclaration.subjectCuriePrefix);

process.stdout.write(
	`${JSON.stringify(
		{
			probe: moduleName,
			exporterRuleReproducedFrom: 'lib/bridge-framework/sssomExporter.js:197 — indexOf(prefix + ":") !== 0 -> REFUSE',
			currentlyShipped: shippedDeclaration.subjectCuriePrefix,
			candidateTable: rowList,
			SHIPPED_ROW_IS_SOUND: Boolean(shippedRow) && shippedRow.exporterVerdict === 'PASSES ALL' && shippedRow.declarationValidator === 'ACCEPTED',
			note:
				'PASSING AND BEING TRUE ARE DIFFERENT PROPERTIES. Two candidates pass the exporter; only one of them names a real namespace. The declared prefix is recorded in both plugin declarations as A SHAPE-FITTING DEVICE, NOT A NAMESPACE CLAIM, so a future reader does not take it at face value.',
			whatRemainsADEFECT:
				'The exporter cannot express an IRI-SHAPED identifier at all. Its assumption held for three standards and is wrong in general. Docketed as framework defect item 14; NOT repairable in this order, whose proof is zero framework change.',
		},
		null,
		2,
	)}\n`,
);
process.exitCode = shippedRow && shippedRow.exporterVerdict === 'PASSES ALL' ? 0 : 1;
