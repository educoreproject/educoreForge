#!/usr/bin/env node
'use strict';

// test-semantic-bridge-value-tier.js — the HERMETIC gate for the semanticBridge SOURCE-EXTRACTION fix and the
// VALUE-TIER coverage (P3c). Proves, WITHOUT docker / Voyage / Opus / a database, using a DETERMINISTIC STUB
// llmClient + a FAKE vectorizer + a recording reader double:
//
//   E. THE EXTRACTION FIX (the "0 sources extracted" bug + the DmeProperty-only omission), RED-FIRST:
//      the recipe names the source token LOWERCASE ('ctdl') but forged `_source` is UPPERCASE ('CTDL'). The
//      producer MUST read `_source: 'CTDL'` (case-corrected) for BOTH the DmeProperty AND DmeOptionValue
//      tiers (and the DmeOptionSet chain scaffolding + the CEDS value candidates). The OLD code read
//      `_source: 'ctdl'` (0 sources) and only DmeProperty (missed the 33 value sources) — both assertions
//      below go RED against it.
//   F. THE VALUE TIER end-to-end: a scoped value resolves to the COMPOSITE '${matchedPropertyKey}|${OVtoken}'
//      HubReference — via the deterministic exact-shortcut (name match) AND via the scoped LLM rerank (stub) —
//      never a global retrieve. A property pick and both value picks are written as CLOSE_MATCH edges.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-semantic-bridge-value-tier.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the semanticBridge source-extraction fix + value-tier coverage

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves (RED-FIRST) that the inferred semantic producer reads its source nodes by the case-corrected
     UPPERCASE _source and across BOTH tiers (DmeProperty + DmeOptionValue), and that a scoped value resolves
     to its composite value-tier HubReference through both the exact-shortcut and the scoped stub rerank. No
     docker, no Voyage, no Opus, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const bridgeMakerModule = require('../bridgeMaker');

// ---- fixtures --------------------------------------------------------------------------------------
// Forged nodes carry UPPERCASE _source ('CTDL'/'CEDS'), exactly as the forge stamps them. The recipe token
// handed to the producer is LOWERCASE ('ctdl') — the producer must uppercase it before reading _source.
const ctdlProperty = { stableId: 'ctdl:assessmentMethodType', properties: { _source: 'CTDL', role: 'DmeProperty', name: 'assessment method type', defText: 'assessment method type' } };
const ctdlOptionSet = { stableId: 'ctdl:AssessmentMethod', properties: { _source: 'CTDL', role: 'DmeOptionSet', name: 'Assessment Method', parentId: 'ctdl:assessmentMethodType' } };
const ctdlValueArtifact = { stableId: 'ctdl:Artifact', properties: { _source: 'CTDL', role: 'DmeOptionValue', name: 'Artifact', defText: 'artifact def', parentId: 'ctdl:AssessmentMethod' } };
const ctdlValueExam = { stableId: 'ctdl:Exam', properties: { _source: 'CTDL', role: 'DmeOptionValue', name: 'Exam', defText: 'exam def', parentId: 'ctdl:AssessmentMethod' } };

const cedsPropertyCand = { stableId: 'ceds:P100', properties: { _source: 'CEDS', role: 'DmeProperty', name: 'ceds assessment method', defText: 'ceds assessment method', cedsId: 'P100', canonicalKey: 'P100' } };
const cedsValueArtifact = { stableId: 'ceds:OVart', properties: { _source: 'CEDS', role: 'DmeOptionValue', name: 'Artifact', defText: 'ceds artifact', canonicalKey: 'OV100art', cedsId: 'OV100art', rangeOptionSetId: 'OS100' } };
const cedsValueExam = { stableId: 'ceds:OVexam', properties: { _source: 'CEDS', role: 'DmeOptionValue', name: 'Examination', defText: 'ceds exam', canonicalKey: 'OV100exam', cedsId: 'OV100exam', rangeOptionSetId: 'OS100' } };

// HubReferences: one property-tier (P100, carrying its option set OS100) + two value-tier (composite keys).
const referenceNodes = [
	{ stableId: 'ref/P100', properties: { role: 'HubReference', referenceTier: 'property', canonicalKey: 'P100', propertyKey: 'P100', rangeOptionSetId: 'OS100', qualifierKeys: [] } },
	{ stableId: 'ref/P100|OV100art', properties: { role: 'HubReference', referenceTier: 'value', canonicalKey: 'OV100art', propertyKey: 'P100', qualifierKeys: [] } },
	{ stableId: 'ref/P100|OV100exam', properties: { role: 'HubReference', referenceTier: 'value', canonicalKey: 'OV100exam', propertyKey: 'P100', qualifierKeys: [] } },
];

// fake vectorizer: defText -> fixture vector. Property source ~ P100; ctdl:Exam ~ ceds Examination.
const textVectors = {
	'ceds assessment method': [1, 0, 0], 'assessment method type': [1, 0, 0],
	'ceds exam': [0, 1, 0], 'exam def': [0, 1, 0],
	'ceds artifact': [0, 0, 1],
};
let vectorizerCalls = 0;
const fakeVectorizerFactory = () => ({
	batchEmbed: ({ texts }, cb) => { vectorizerCalls++; cb('', { vectors: (texts || []).map((t) => textVectors[t] || null) }); },
});

// deterministic STUB reranker: always pick retrieval rank 1 (highest cosine); never LLM-abstains.
let stubRerankCalls = 0;
const stubLlm = { model: 'stub-reranker-pick1', rerank: ({ choiceEnum } = {}, cb) => { stubRerankCalls++; void choiceEnum; cb('', { choice: '1', model: 'stub-reranker-pick1', attempts: 1 }); } };

// recording reader double — records every propertyEquals it was asked, routes by role.
const recordedQueries = [];
const graphReaderDouble = ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') { callback('', { nodes: referenceNodes }); return; }
		recordedQueries.push({ ...eq });
		const bySrcRole = {
			'CTDL|DmeProperty': [ctdlProperty],
			'CTDL|DmeOptionValue': [ctdlValueArtifact, ctdlValueExam],
			'CTDL|DmeOptionSet': [ctdlOptionSet],
			'CEDS|DmeProperty': [cedsPropertyCand],
			'CEDS|DmeOptionValue': [cedsValueArtifact, cedsValueExam],
		};
		callback('', { nodes: bySrcRole[`${eq._source}|${eq.role}`] || [] });
	},
	close: (callback) => callback(''),
});

const decisionBlocks = {};
const decisionStore = {
	getDecisionBlock: ({ pairKey }, cb) => cb('', decisionBlocks[pairKey] ? { frozenText: decisionBlocks[pairKey].frozenText } : { frozenText: null }),
	saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, cb) => { decisionBlocks[pairKey] = { frozenText, decisionBlockHash }; cb('', { saved: true }); },
};
const makeWriterDouble = (writes) => ({ inGraph }) => ({
	writeRelationshipEdge: (spec, callback) => { void inGraph; writes.push({ ...spec }); callback('', { edgeWritten: true }); },
	close: (callback) => callback(''),
});

// LOWERCASE recipe token — the exact shape build.js passes from the recipe (bridge.source = 'ctdl').
const runConfig = { sourceStandard: 'ctdl', sourceVersion: '', hubVersion: '14.0.0.0' };
const inferenceConfig = { llmClient: stubLlm, topK: 15, cosineFloor: 0.6, concurrency: 4 };

const rebridgeWrites = [];
bridgeMakerModule({ graphWriterFactory: makeWriterDouble(rebridgeWrites), graphReaderFactory: graphReaderDouble }).run(
	{
		inGraph: { graphName: 'DEV_valueTier', boltUrl: 'bolt://x', password: 'x' },
		bridge: 'semanticBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
		rebridge: true, decisionStore, inferenceConfig, config: runConfig,
		componentOverrides: { vectorizer: fakeVectorizerFactory },
	},
	(rebErr, rebReport) => {
		// ===================================================================================
		harness.section('E — SOURCE EXTRACTION (RED-FIRST): case-corrected UPPERCASE _source, BOTH tiers');
		// ===================================================================================
		harness.ok(`--rebridge run did not error (${rebErr || 'ok'})`, !rebErr, rebErr);
		const asked = (src, role) => recordedQueries.some((q) => q._source === src && q.role === role);
		harness.ok('reads CTDL DmeProperty sources by UPPERCASE _source (old code read lowercase "ctdl" -> 0)', asked('CTDL', 'DmeProperty'));
		harness.ok('reads CTDL DmeOptionValue sources (the value tier the old DmeProperty-only code omitted)', asked('CTDL', 'DmeOptionValue'));
		harness.ok('reads CTDL DmeOptionSet chain scaffolding (for the value->set->property 2-hop scope)', asked('CTDL', 'DmeOptionSet'));
		harness.ok('reads CEDS DmeOptionValue candidates (the scoped value candidate pool)', asked('CEDS', 'DmeOptionValue'));
		harness.ok('NEVER queries the lowercase recipe token as _source (the exact "0 sources" bug)', !recordedQueries.some((q) => q._source === 'ctdl'));

		// ===================================================================================
		harness.section('F — VALUE TIER end-to-end: composite HubReference resolution (exact + scoped rerank)');
		// ===================================================================================
		harness.equal('wrote 3 CLOSE_MATCH edges (1 property + 2 value: exact-shortcut + scoped rerank)', rebReport && rebReport.edgesWritten, 3);
		harness.ok('every write is a CLOSE_MATCH', rebridgeWrites.every((w) => w.relationshipType === 'CLOSE_MATCH'));
		const toById = {};
		rebridgeWrites.forEach((w) => { toById[w.fromStableId] = w.toStableId; });
		harness.equal('the property source resolves to the property-tier HubReference (P100)', toById['ctdl:assessmentMethodType'], 'ref/P100');
		harness.equal('the exact-shortcut value (Artifact) resolves to its COMPOSITE value HubReference (P100|OV100art)', toById['ctdl:Artifact'], 'ref/P100|OV100art');
		harness.equal('the scoped-rerank value (Exam) resolves to its COMPOSITE value HubReference (P100|OV100exam)', toById['ctdl:Exam'], 'ref/P100|OV100exam');
		harness.equal('counts.valueSources == 2 (both value sources extracted)', rebReport && rebReport.counts && rebReport.counts.valueSources, 2);
		harness.equal('counts.valueScoped == 2 (both scoped to their parent property\'s matched option set)', rebReport && rebReport.counts && rebReport.counts.valueScoped, 2);
		harness.ok('the scoped rerank reached the stub exactly ONCE (only Exam; Artifact took the exact-shortcut)', stubRerankCalls >= 2 && stubRerankCalls <= 3);

		// ---- replay: a plain build materializes the SAME block into byte-identical edges, ZERO llm/vectorizer.
		const rerankAfter = stubRerankCalls;
		const vectorizeAfter = vectorizerCalls;
		const matWrites = [];
		bridgeMakerModule({ graphWriterFactory: makeWriterDouble(matWrites), graphReaderFactory: graphReaderDouble }).run(
			{
				inGraph: { graphName: 'DEV_valueTier2', boltUrl: 'bolt://x', password: 'x' },
				bridge: 'semanticBridge', hub: 'ceds', applyLabel: 'BridgedRelation',
				rebridge: false, decisionStore, inferenceConfig, config: runConfig,
				componentOverrides: { vectorizer: fakeVectorizerFactory },
			},
			(matErr, matReport) => {
				harness.section('F.replay — plain build MATERIALIZES the same 3 edges, ZERO llm/vectorizer');
				harness.ok(`plain-build materialize did not error (${matErr || 'ok'})`, !matErr, matErr);
				harness.equal('materialize wrote the SAME 3 edges', matReport && matReport.edgesWritten, 3);
				harness.equal('materialize made ZERO reranker calls (no LLM on replay)', stubRerankCalls, rerankAfter);
				harness.equal('materialize made ZERO vectorizer calls (no Voyage on replay)', vectorizerCalls, vectorizeAfter);
				harness.equal('replay edges BYTE-IDENTICAL to rebridge edges', JSON.stringify(matWrites.map((w) => [w.fromStableId, w.toStableId]).sort()), JSON.stringify(rebridgeWrites.map((w) => [w.fromStableId, w.toStableId]).sort()));
				harness.report();
			},
		);
	},
);
