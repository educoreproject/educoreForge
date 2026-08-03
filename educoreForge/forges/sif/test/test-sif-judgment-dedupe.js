#!/usr/bin/env node
'use strict';

// test-sif-judgment-dedupe.js — the SIF structural-dedupe gate (p9-judgmentPersistence, 2026-07-31):
// sifEvidenceBridge's judgmentKey hook, its fan-out honesty, and the real-asset key-count
// measurement grounding the cost model.
//
// PROVES:
//   SECTION 1 — sifJudgmentKey in isolation: the owner-stripped identity (two owners, same nested
//     relative path + leaf + nativeType -> the SAME key; the owner-scoped sequenceGroupKeys that
//     produced them DIFFER); the NEGATIVE CONTROL (same relative path + leaf, DIFFERENT nativeType
//     -> DIFFERENT keys); the root form (owner stripped); and the honest nulls (no groupKey, no
//     name, or a non-forge-format groupKey -> null, judged individually).
//   SECTION 2 — the full flow through the REAL bridgeMaker.run(): three SIF fields where two share
//     the owner-stripped structure — ONE llm judgment covers both (2 calls for 3 sources); the
//     member's frozen entry is stamped judgedVia 'dedupe:<key>' + representativeSourceStableId and
//     REFERENCES (never duplicates) the representative's evidencePackage; the member still
//     materializes its OWN edge; a RERUN freezes a BYTE-IDENTICAL block; MATERIALIZE replays it
//     byte-identically with ZERO llm calls.
//   SECTION 3 — REAL-ASSET MEASUREMENT: forge the real SIF asset (skipEmbedding) and count —
//     total fields, unique judgment keys, judgments needed vs judgments avoided (the ⟪TQ⟫ cost
//     model), largest shared group, and the authored-cedsId divergence within shared groups
//     (an honesty metric reported for review, since fan-out shares one verdict across members).
//
// Run: node forges/sif/test/test-sif-judgment-dedupe.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- SIF structural-dedupe gate: judgmentKey identity, fan-out honesty, real-asset counts

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves sifEvidenceBridge's owner-stripped judgmentKey (including the nativeType negative
     control), drives the dedupe fan-out through the REAL bridgeMaker.run with honesty stamps,
     byte-stable reruns and MATERIALIZE replay, and measures unique judgment keys against the real
     forged SIF asset.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');

const bridgeModule = require('../bridges/sifEvidenceBridge');
const bridgeMakerModule = require('../../../apps/graph-builder/apps/bridge-maker/bridgeMaker');
const evidenceFreezerFactory = require('../../../apps/graph-builder/apps/bridge-maker/lib/evidenceFreezer');

const { sifJudgmentKey, EVIDENCE_GENERATION } = bridgeModule;

// =====================================================================
harness.section('SECTION 1 — sifJudgmentKey: owner-stripped identity, negative control, honest nulls');
// =====================================================================

const keyOf = (record) => {
	let observed = null;
	sifJudgmentKey(record, (err, key) => { observed = { err, key }; });
	return observed;
};

(() => {
	// the mission's own worked example: .../SIF_Metadata/LifeCycle/Modified/By under two DIFFERENT
	// owning objects — the sequence stamps are owner-scoped and DIFFER; the judgment keys agree.
	const underStudentPersonal = {
		stableId: 'sif:field/StudentPersonal/.../By', name: 'By', nativeType: 'normalizedString',
		sequenceGroupKey: 'sif:fieldGroup:StudentPersonal:SIF_Metadata/LifeCycle/Modified',
	};
	const underSchoolInfo = {
		stableId: 'sif:field/SchoolInfo/.../By', name: 'By', nativeType: 'normalizedString',
		sequenceGroupKey: 'sif:fieldGroup:SchoolInfo:SIF_Metadata/LifeCycle/Modified',
	};
	const one = keyOf(underStudentPersonal);
	const two = keyOf(underSchoolInfo);
	harness.equal('the hook answers with no error', one.err, '');
	harness.ok(
		'the owner-scoped sequenceGroupKeys DIFFER (per-document ordinal truth, forgeSif\'s adversarial-review fix)',
		underStudentPersonal.sequenceGroupKey !== underSchoolInfo.sequenceGroupKey,
	);
	harness.equal(
		'OWNER-STRIPPED IDENTITY: the two copies of the shared structure get the SAME judgment key (the CEDS mapping of shared plumbing is owner-independent)',
		one.key,
		two.key,
	);
	harness.equal(
		'  and the key names the relative structure + leaf + nativeType + authored anchor',
		one.key,
		'sif:judgeKey:SIF_Metadata/LifeCycle/Modified:By:normalizedString:(none)',
	);

	// NEGATIVE CONTROL — same relative path + leaf, DIFFERENT nativeType: a different mapping
	// question, and it must NEVER share a judgment.
	const differentType = { ...underSchoolInfo, nativeType: 'xs:dateTime' };
	const three = keyOf(differentType);
	harness.ok(
		'NEGATIVE CONTROL: same relative path + leaf but a DIFFERENT nativeType gets a DIFFERENT key',
		three.key !== one.key,
		`both were ${one.key}`,
	);

	// SECOND NEGATIVE CONTROL — the quality-first anchor term (see the hook's own ⟪QUALITY-FIRST
	// DEVIATION⟫ note): members whose AUTHORS declared different CEDS anchors — or where one is
	// anchored and one is not — must never share a judgment; identical anchors still dedupe.
	const anchoredOne = { ...underStudentPersonal, cedsId: 'P000123' };
	const anchoredConflicting = { ...underSchoolInfo, cedsId: 'P000456' };
	const anchoredAgreeing = { ...underSchoolInfo, cedsId: 'P000123' };
	harness.ok('ANCHOR CONTROL: conflicting authored cedsId anchors -> DIFFERENT keys', keyOf(anchoredOne).key !== keyOf(anchoredConflicting).key);
	harness.ok('  anchored vs anchorless -> DIFFERENT keys (the crossref nomination changes the evidence)', keyOf(anchoredOne).key !== keyOf(underSchoolInfo).key);
	harness.equal('  identical anchors still dedupe', keyOf(anchoredOne).key, keyOf(anchoredAgreeing).key);

	// the root form: 'sif:fieldGroup:root:<owner>' — the owner segment is the LAST token; stripping
	// it merges root-level fields by leaf + nativeType.
	const rootUnderStudentPersonal = { name: '@RefId', nativeType: 'RefIdType', sequenceGroupKey: 'sif:fieldGroup:root:StudentPersonal' };
	const rootUnderSchoolInfo = { name: '@RefId', nativeType: 'RefIdType', sequenceGroupKey: 'sif:fieldGroup:root:SchoolInfo' };
	harness.equal('root form: the owner is stripped (same leaf+type across owners -> same key)', keyOf(rootUnderStudentPersonal).key, keyOf(rootUnderSchoolInfo).key);
	harness.equal('  and the root key names the root position', keyOf(rootUnderStudentPersonal).key, 'sif:judgeKey:root:@RefId:RefIdType:(none)');

	// honest nulls — no asserted structure buys no dedupe (quality is untouchable).
	harness.equal('no sequenceGroupKey -> null (judged individually)', keyOf({ name: 'By', nativeType: 'x' }).key, null);
	harness.equal('no name -> null', keyOf({ sequenceGroupKey: 'sif:fieldGroup:A:B', nativeType: 'x' }).key, null);
	harness.equal(
		"a non-forge-format groupKey (the legacy 'sif:fieldGroup:Name' fixture shape) -> null, never a guessed grouping",
		keyOf({ name: 'By', sequenceGroupKey: 'sif:fieldGroup:Name' }).key,
		null,
	);
	harness.equal('a missing nativeType is part of the identity, not a refusal', keyOf({ name: 'By', sequenceGroupKey: 'sif:fieldGroup:A:B/C' }).key, 'sif:judgeKey:B/C:By:(none):(none)');
})();

// =====================================================================
harness.section('SECTION 2 — the full flow: judge once, fan out honestly, byte-stable rerun, MATERIALIZE replay');
// =====================================================================

// THREE SIF fields: two copies of the shared .../LifeCycle/Modified/By structure under different
// owners (dedupe pair), one distinct root-level field (judged individually).
// ⟪hubReimplementation P3 (SPEC §6)⟫ the card is SELF-SUFFICIENT: it carries its meaning fields,
// its stored embedText, and its forge-stamped embedding (bare number[] — the live LIST<FLOAT> shape;
// the bridge reads candidate.embedding and NEVER re-embeds, so the vectorizer double below serves
// sources only).
const referenceNodesRaw = [
	{
		stableId: 'cedsHubRef:addr1',
		properties: {
			role: 'HubReference', referenceTier: 'property', canonicalKey: 'P800001', propertyKey: 'P800001',
			name: 'Record Modification Author', domainId: 'C200900',
			domainName: 'Record Metadata', domainDefinition: 'Metadata about the lifecycle of a record.',
			propertyName: 'Record Modification Author',
			propertyDefinition: 'The person or system that most recently modified the record.',
			rangeDatatype: 'string',
			embedText: 'Record Metadata · Record Modification Author · The person or system that most recently modified the record.',
			embedding: [1, 0],
		},
	},
];

const sharedGroupProps = (owner) => ({
	_source: 'SIF', role: 'DmeProperty', name: 'By', description: 'sourceDefText',
	xpath: `${owner}/SIF_Metadata/LifeCycle/Modified/By`, tableName: owner,
	sequenceGroupLabel: 'Modified', sequenceGroupKey: `sif:fieldGroup:${owner}:SIF_Metadata/LifeCycle/Modified`,
	sequenceOrdinal: 0, siblingCount: 2, orderSemantics: 'document', nativeType: 'normalizedString',
});
const sourceGraphNodes2 = [
	{ stableId: 'sif:field/StudentPersonal/SIF_Metadata/LifeCycle/Modified/By', properties: sharedGroupProps('StudentPersonal') },
	{ stableId: 'sif:field/SchoolInfo/SIF_Metadata/LifeCycle/Modified/By', properties: sharedGroupProps('SchoolInfo') },
	{
		stableId: 'sif:field/StudentPersonal/@RefId',
		properties: {
			_source: 'SIF', role: 'DmeProperty', name: '@RefId', description: 'refIdDefText',
			xpath: 'StudentPersonal/@RefId', tableName: 'StudentPersonal',
			sequenceGroupLabel: 'StudentPersonal', sequenceGroupKey: 'sif:fieldGroup:root:StudentPersonal',
			sequenceOrdinal: 0, siblingCount: 1, orderSemantics: 'document', nativeType: 'RefIdType',
		},
	},
];

const textVectors2 = {
	sourceDefText: [1, 0],
	refIdDefText: [0.7, Math.sqrt(1 - 0.49)],
};

const graphReaderDouble2 = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodesRaw }); return; }
		if (eq._source === 'SIF' && eq.role === 'DmeProperty') { callback('', { nodes: sourceGraphNodes2 }); return; }
		if (label === 'SifField') { callback('', { nodes: [] }); return; } // sibling read degrades honestly
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});

const makeWriterDouble2 = (writes) => ({ inGraph }) => ({
	writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
	close: (callback) => callback(''),
});

const fakeVectorizerFactory2 = () => ({
	batchEmbed: ({ texts }, cb) => cb('', { vectors: (texts || []).map((t) => textVectors2[t] || null) }),
});

const runConfig2 = { sourceStandard: 'sif', sourceVersion: 'v1', hubVersion: 'v14.0.0.0', dependencies: ['sif', 'ceds'] };

// stub llm — a PURE FUNCTION OF THE PROMPT (the sifWalk ancestry note names the source's xpath):
// the shared-structure representative picks; the @RefId probe abstains.
const makeStubLlm2 = (counter) => ({
	model: 'stub-sif-judge-v1',
	rerank: (spec, callback) => {
		counter.calls += 1;
		if (spec.userPrompt.indexOf('Modified > By') !== -1) {
			callback('', { choice: '1', category: 'strong', rationale: 'the shared lifecycle-authorship structure maps to the modification author' });
			return;
		}
		callback('', { choice: 'NONE', rationale: 'an opaque identifier maps to no CEDS property here' });
	},
});

const runSifDedupePass = ({ graphName, counter, decisionStoreState, rebridge, writes }, passDone) => {
	const decisionStore = {
		getDecisionBlock: ({ pairKey }, cb) => cb('', decisionStoreState[pairKey] ? { frozenText: decisionStoreState[pairKey].frozenText } : { frozenText: null }),
		saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionStoreState[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
	};
	bridgeMakerModule({ graphWriterFactory: makeWriterDouble2(writes), graphReaderFactory: graphReaderDouble2 }).run(
		{
			inGraph: { graphName, boltUrl: 'bolt://x', password: 'x' },
			bridge: 'sifEvidenceBridge', source: 'sif', hub: 'ceds', applyLabel: 'BridgedRelation',
			rebridge, decisionStore,
			inferenceConfig: { llmClient: makeStubLlm2(counter), topK: 15, cosineFloor: -1, concurrency: 4 },
			config: runConfig2,
			componentOverrides: { vectorizer: fakeVectorizerFactory2, graphReader: graphReaderDouble2 },
		},
		(err, report) => passDone(err, { report, frozenBlock: decisionStoreState['CEDS::SIF'] }),
	);
};

const decisionStateOne = {};
const counterOne = { calls: 0 };
const writesOne = [];
runSifDedupePass({ graphName: 'DEV_sif_dedupe_rb', counter: counterOne, decisionStoreState: decisionStateOne, rebridge: true, writes: writesOne }, (runErr, runOut) => {
	harness.ok(`the dedupe REBRIDGE did not error (${runErr || 'ok'})`, !runErr, runErr);
	harness.equal('DEDUPE: 2 llm calls for 3 sources — the shared structure judged ONCE', counterOne.calls, 2);
	harness.equal("the run's generation is the bridge's own v2 tag (⟪A6⟫ — the dedupe pipeline is a NEW generation)", runOut.report.generation, EVIDENCE_GENERATION);

	const parsed = evidenceFreezerFactory().parse(runOut.frozenBlock.frozenText);
	harness.ok('the frozen block parses', !parsed.error, parsed.error);
	harness.equal('3 frozen evidence entries — the story is complete per source', parsed.frozenEvidence.length, 3);

	const representativeEntry = parsed.frozenEvidence.find((e) => e.sourceStableId === 'sif:field/StudentPersonal/SIF_Metadata/LifeCycle/Modified/By');
	const memberEntry = parsed.frozenEvidence.find((e) => e.sourceStableId === 'sif:field/SchoolInfo/SIF_Metadata/LifeCycle/Modified/By');
	harness.ok(
		'the representative (FIRST in source order) carries the evidencePackageRef address (freeze-by-reference, 2026-07-31)',
		representativeEntry && representativeEntry.evidencePackageRef && typeof representativeEntry.evidencePackageRef.promptHash === 'string' && representativeEntry.evidencePackageRef.promptHash.length > 0,
	);
	harness.equal(
		"HONESTY: the member is stamped judgedVia 'dedupe:<owner-stripped key>'",
		memberEntry && memberEntry.judgedVia,
		'dedupe:sif:judgeKey:SIF_Metadata/LifeCycle/Modified:By:normalizedString:(none)',
	);
	harness.equal('  and names its representative', memberEntry && memberEntry.representativeSourceStableId, 'sif:field/StudentPersonal/SIF_Metadata/LifeCycle/Modified/By');
	harness.ok('  and REFERENCES rather than duplicates the evidencePackage', memberEntry && memberEntry.evidencePackage === undefined);
	harness.equal('  and inherits the representative judgment verbatim', JSON.stringify(memberEntry && memberEntry.judgment), JSON.stringify(representativeEntry && representativeEntry.judgment));

	harness.equal('EDGES: the member materializes its OWN edge — 2 picks (rep + member), 1 abstain', writesOne.length, 2);
	const memberEdge = writesOne.find((oneEdge) => oneEdge.fromStableId === 'sif:field/SchoolInfo/SIF_Metadata/LifeCycle/Modified/By');
	harness.ok('  the member edge exists and targets the picked candidate', memberEdge && memberEdge.toStableId === 'cedsHubRef:addr1', JSON.stringify(writesOne.map((w) => w.fromStableId)));

	// BYTE-STABLE RERUN — a fresh rebridge over identical inputs freezes identical bytes.
	const decisionStateTwo = {};
	const counterTwo = { calls: 0 };
	const writesTwo = [];
	runSifDedupePass({ graphName: 'DEV_sif_dedupe_rb2', counter: counterTwo, decisionStoreState: decisionStateTwo, rebridge: true, writes: writesTwo }, (rerunErr, rerunOut) => {
		harness.ok(`the RERUN did not error (${rerunErr || 'ok'})`, !rerunErr, rerunErr);
		harness.equal('BYTE-STABLE RERUN: identical frozen text', rerunOut.frozenBlock.frozenText, runOut.frozenBlock.frozenText);
		harness.equal('  identical hash', rerunOut.frozenBlock.decisionBlockHash, runOut.frozenBlock.decisionBlockHash);
		harness.note(`SIF dedupe decisionBlockHash: ${runOut.frozenBlock.decisionBlockHash}`);

		// MATERIALIZE replay — zero llm calls, byte-identical edges.
		const counterThree = { calls: 0 };
		const writesThree = [];
		runSifDedupePass({ graphName: 'DEV_sif_dedupe_mat', counter: counterThree, decisionStoreState: decisionStateOne, rebridge: false, writes: writesThree }, (matErr, matOut) => {
			harness.ok(`MATERIALIZE did not error (${matErr || 'ok'})`, !matErr, matErr);
			harness.equal('MATERIALIZE: ZERO llm calls (pure replay of the fanned-out decisions)', counterThree.calls, 0);
			harness.equal('MATERIALIZE: pins the SAME decisionBlockHash', matOut.report.decisionBlock, runOut.frozenBlock.decisionBlockHash);
			harness.equal('MATERIALIZE: byte-identical edges, member edge included', JSON.stringify(writesThree), JSON.stringify(writesOne));

			runRealAssetMeasurement();
		});
	});
});

// =====================================================================
// SECTION 3 — REAL-ASSET MEASUREMENT (the ⟪TQ⟫ cost model, grounded).
// (a HOISTED function declaration, deliberately: the SECTION 2 chain above completes
// synchronously with these stubs, so an arrow-const here would still be in its TDZ when called.)
// =====================================================================
function runRealAssetMeasurement() {
	harness.section('SECTION 3 — real-asset measurement: unique judgment keys vs total fields');

	const bundle = require('../forgeSif')({ embedder: null });
	const assetDir = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
	bundle.forge({ sourcePath: assetDir, skipEmbedding: true }, (forgeErr, result) => {
		harness.accepts('the real-asset forge (skipEmbedding) succeeds', forgeErr ? [forgeErr] : []);
		if (forgeErr) {
			harness.report();
			return;
		}
		const fields = result.nodes.filter((oneNode) => oneNode.role === 'DmeProperty');

		// resolve every field's judgment key through the REAL exported hook, over the REAL forged
		// properties (a bridge-run field record is flattenFullRecord over these same scalars).
		let nullKeyCount = 0;
		const membersByKey = {};
		fields.forEach((oneField) => {
			const record = {
				name: oneField.name !== undefined ? oneField.name : oneField.properties.name,
				sequenceGroupKey: oneField.properties.sequenceGroupKey,
				nativeType: oneField.properties.nativeType,
				cedsId: oneField.properties.cedsId,
			};
			sifJudgmentKey(record, (err, key) => {
				if (err || key === null) {
					nullKeyCount += 1;
					return;
				}
				(membersByKey[key] = membersByKey[key] || []).push(oneField);
			});
		});
		const uniqueKeys = Object.keys(membersByKey);
		const judgmentsNeeded = uniqueKeys.length + nullKeyCount;
		const judgmentsAvoided = fields.length - judgmentsNeeded;
		const sharedKeys = uniqueKeys.filter((oneKey) => membersByKey[oneKey].length > 1);
		const largestKey = uniqueKeys.reduce((best, oneKey) => (membersByKey[oneKey].length > (membersByKey[best] || []).length ? oneKey : best), uniqueKeys[0]);

		harness.note(`total fields: ${fields.length}`);
		harness.note(`fields with no structural key (judged individually): ${nullKeyCount}`);
		harness.note(`unique judgment keys: ${uniqueKeys.length} (${sharedKeys.length} shared by 2+ fields)`);
		harness.note(`JUDGMENTS NEEDED: ${judgmentsNeeded}  |  JUDGMENTS AVOIDED: ${judgmentsAvoided} (${Math.round((judgmentsAvoided / fields.length) * 100)}%)`);
		harness.note(`largest shared group: ${membersByKey[largestKey].length} fields share '${largestKey}'`);

		harness.ok('the real asset carries the expected field population (~15,620)', fields.length > 15000 && fields.length < 16500, `${fields.length}`);
		harness.ok('every field resolved (nulls + keyed = total)', nullKeyCount + uniqueKeys.reduce((sum, k) => sum + membersByKey[k].length, 0) === fields.length);
		harness.ok(
			`the dedupe delivers the promised order of reduction (needed ${judgmentsNeeded} <= 6500; mission expectation ~5,000 or fewer from 15,620)`,
			judgmentsNeeded <= 6500,
			`judgments needed: ${judgmentsNeeded}`,
		);
		harness.ok(
			'every shared group is internally consistent on leaf name + nativeType (the key IS the identity)',
			sharedKeys.every((oneKey) => {
				const members = membersByKey[oneKey];
				const names = new Set(members.map((m) => (m.name !== undefined ? m.name : m.properties.name)));
				const types = new Set(members.map((m) => m.properties.nativeType));
				return names.size === 1 && types.size === 1;
			}),
		);

		// AUTHORED-ANCHOR SOUNDNESS — with the quality-first anchor term IN the key (the hook's own
		// ⟪QUALITY-FIRST DEVIATION⟫ note: measured 16 conflicting + 23 mixed-presence groups under
		// the anchor-less formula), every shared group must now be internally UNANIMOUS on its
		// authored cedsId anchor. Asserted, not merely noted: a fanned-out verdict never crosses an
		// author-declared anchor boundary.
		let groupsWithDivergentAnchors = 0;
		let groupsWithMixedAnchorPresence = 0;
		sharedKeys.forEach((oneKey) => {
			const members = membersByKey[oneKey];
			const anchors = members.map((m) => m.properties.cedsId).filter((v) => v !== undefined && v !== null && `${v}`.trim() !== '');
			const distinctAnchors = new Set(anchors);
			if (distinctAnchors.size > 1) {
				groupsWithDivergentAnchors += 1;
			}
			if (anchors.length > 0 && anchors.length < members.length) {
				groupsWithMixedAnchorPresence += 1;
			}
		});
		harness.equal('ANCHOR SOUNDNESS: zero shared groups with conflicting authored cedsId anchors', groupsWithDivergentAnchors, 0);
		harness.equal('  and zero with mixed anchored/anchorless membership', groupsWithMixedAnchorPresence, 0);

		harness.report();
	});
}
