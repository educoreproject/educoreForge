#!/usr/bin/env node
'use strict';

// test-embedSourceProperty.js — the R-P2-2 hermetic suite (hubReimplementation Phase 2,
// supervisor ruling 2026-08-03): the embedding sidecar's PER-NODE-RECORD embed-input
// declaration, its refusals, and the store round-trip.
//
// THE RULED CONTRACT, proven here probe by probe:
//   1. A vectored node record carrying `embedSourceProperty` DECLARES which of its
//      properties was embedded; the sidecar's embeddingRef is computed from THAT value.
//   2. A record NOT carrying it is the ORIGINAL FORMAT and keeps the searchText behavior
//      EXACTLY — a format discriminator, not a default (proven by hash identity against an
//      independent recomputation of the original rule).
//   3. A DECLARED property that is absent/empty on the node is a REFUSAL naming node and
//      property — nothing substituted. (Observed RED by nature: the refusal IS the red.)
//   4. An EMPTY declaration is refused the same way.
//   5. The original no-searchText refusal is unchanged.
//   6. SIDECAR ROUND-TRIP (hermetic half of the ruling's round-trip gate): shapeNode ->
//      putDistinctNodeVectors (REAL ported vector-store, scratch db) -> resolveNodeVectors
//      stamps the SAME vector back (float32-exact), proven by value; its twin corrupts the
//      stored blob's source and is observed RED via the store's verify-on-read refusal.
//
// Run: node lib/replay/test/test-embedSourceProperty.js [-verbose]   (hermetic, no docker,
// no network; the scratch store lives under os.tmpdir and is process-unique)

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- R-P2-2: per-node embed-input declaration + sidecar round-trip

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the format-versioned embedSourceProperty contract on replay-engine.shapeNode
     (declared input honored; undeclared keeps searchText addressing byte-exactly; a
     declared-but-absent input refuses by name) and the harvest->restore vector round-trip
     through the REAL vector-store on a scratch database, with the corruption twin observed
     RED through the store's verify-on-read refusal.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const replayEngine = require('../replay-engine')();
const { shapeNode, putDistinctNodeVectors, resolveNodeVectors } = replayEngine;
const contentAddress = require('../../content-address/content-address')();
const vectorStoreModule = require('../../vector-store/vector-store');

const MODEL_VERSION = 'voyage-test-model';
const HEADER = { stableUriPropertyName: 'uri', embeddingModelVersion: MODEL_VERSION };

// a throwing seam contained in ONE place (the parseJsonOrFault precedent): shapeNode refuses
// by throw; the suite needs the message as data.
const refusalMessageOf = (throwingFunction) => {
	let refusalMessage = '';
	try {
		throwingFunction();
	} catch (thrownError) {
		refusalMessage = String(thrownError.message);
	}
	return refusalMessage;
};

const aVector = (seed) => Array.from({ length: 8 }, (unused, i) => (i + seed) * 0.25);

const neoNodeWith = (properties) => ({
	labels: ['ForgedNode', 'HubReference'],
	properties: { _source: 'CEDS', uri: 'https://example.test/card/1', ...properties },
});

// =====================================================================================
harness.section('FORMAT VERSIONING — declared embed input vs the original searchText rule');
// =====================================================================================

// 1. DECLARED: embeddingRef computed from the declared property's value
const declaredCardNode = shapeNode(
	neoNodeWith({
		embedText: 'Domain · Property · the composed retrieval string',
		embedSourceProperty: 'embedText',
		embedding: aVector(1),
	}),
	HEADER,
	true,
);
harness.equal(
	'a DECLARED record addresses its vector by the declared property value (embedText)',
	declaredCardNode.embeddingRef,
	contentAddress.vectorIdForInput(MODEL_VERSION, 'Domain · Property · the composed retrieval string'),
);
harness.equal(
	'  and the sidecar input text is the declared value verbatim',
	declaredCardNode._sidecarInputText,
	'Domain · Property · the composed retrieval string',
);

// 2. UNDECLARED: the ORIGINAL format, byte-exact against an independent recomputation
const undeclaredBaseNode = shapeNode(
	neoNodeWith({ searchText: 'the base node search text', embedding: aVector(2) }),
	HEADER,
	true,
);
harness.equal(
	'an UNDECLARED record keeps the ORIGINAL searchText addressing EXACTLY',
	undeclaredBaseNode.embeddingRef,
	contentAddress.vectorIdForInput(MODEL_VERSION, 'the base node search text'),
);
harness.equal(
	'  original-format sidecar input is searchText verbatim',
	undeclaredBaseNode._sidecarInputText,
	'the base node search text',
);
harness.ok(
	'  and a record with BOTH searchText and a declaration follows the DECLARATION (the declaration is the format marker)',
	shapeNode(
		neoNodeWith({
			searchText: 'this must NOT be the address input',
			embedText: 'this MUST be the address input',
			embedSourceProperty: 'embedText',
			embedding: aVector(3),
		}),
		HEADER,
		true,
	).embeddingRef === contentAddress.vectorIdForInput(MODEL_VERSION, 'this MUST be the address input'),
	'declaration did not take precedence',
);

// =====================================================================================
harness.section('REFUSALS — a declared-but-absent input refuses BY NAME (observed red)');
// =====================================================================================

const absentDeclaredRefusal = refusalMessageOf(() =>
	shapeNode(
		neoNodeWith({ embedSourceProperty: 'embedText', embedding: aVector(4) }),
		HEADER,
		true,
	),
);
harness.match(
	"a record declaring embedSourceProperty 'embedText' with NO such value is REFUSED naming node and property",
	absentDeclaredRefusal,
	/declares embedSourceProperty 'embedText' but carries no value under it[\s\S]*refused, never substituted/,
);
harness.match('  the refusal names the node', absentDeclaredRefusal, /example\.test\/card\/1/);

harness.match(
	'an EMPTY declaration is refused as a declaration that names nothing',
	refusalMessageOf(() =>
		shapeNode(
			neoNodeWith({ embedSourceProperty: '  ', embedding: aVector(5) }),
			HEADER,
			true,
		),
	),
	/declares an EMPTY embedSourceProperty/,
);

harness.match(
	'the ORIGINAL no-searchText refusal is unchanged for undeclared records',
	refusalMessageOf(() => shapeNode(neoNodeWith({ embedding: aVector(6) }), HEADER, true)),
	/carries an embedding but no[\s\S]*searchText — cannot compute embeddingRef/,
);

// =====================================================================================
harness.section('M-2 — a ref-style block through a RESOLVERLESS restore is REFUSED by name');
// =====================================================================================
// ⟪P2-review M-2⟫ the no-resolver branch is the old-vs-ref format discriminator: legacy
// inline nodes pass exactly as they always did; a node carrying embeddingRef with no inline
// embedding through a resolverless resolveNodeVectors is refused naming the first offender.
// The refusal IS the observed red; the legacy pass-through is the green control.

resolveNodeVectors(
	{
		nodes: [
			{
				stableId: 'https://example.test/card/refStyle',
				embeddingRef: 'a'.repeat(64),
				_standardKey: 'ceds',
				properties: {},
			},
		],
		storeResolver: undefined,
		header: { embeddingDims: 8 },
	},
	(refStyleRefusal) => {
		harness.match(
			'OBSERVED RED: a ref-carrying node with NO storeResolver is refused naming stableId + standard',
			refStyleRefusal || '',
			/REFUSED[\s\S]*card\/refStyle[\s\S]*'ceds'[\s\S]*requires a storeResolver/,
		);
	},
);

const legacyInlineNode = {
	stableId: 'https://example.test/base/legacy',
	embedding: aVector(9),
	_standardKey: 'ceds',
	properties: {},
};
resolveNodeVectors(
	{ nodes: [legacyInlineNode], storeResolver: undefined, header: { embeddingDims: 8 } },
	(legacyOutcome) => {
		harness.equal(
			'GREEN CONTROL: a legacy INLINE node with no resolver passes exactly as before',
			legacyOutcome || '',
			'',
		);
		harness.ok(
			'  its inline embedding is untouched and the transient tag stripped',
			Array.isArray(legacyInlineNode.embedding) && legacyInlineNode._standardKey === undefined,
			JSON.stringify(Object.keys(legacyInlineNode)),
		);
	},
);

// =====================================================================================
harness.section('SIDECAR ROUND-TRIP — harvest-shape -> REAL store -> restore-resolve, twin RED');
// =====================================================================================

const scratchStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedSourceProp-'));
const scratchStorePath = path.join(scratchStoreDir, `cedsScratch_${process.pid}.sqlite3`);
const scratchStore = vectorStoreModule({});

scratchStore.init({ dbPath: scratchStorePath }, (initError) => {
	harness.ok('the REAL ported vector-store opens on a scratch db', !initError, initError);
	if (initError) {
		harness.report();
		return;
	}

	const roundTripVector = aVector(7);
	const harvestShapedCard = shapeNode(
		neoNodeWith({
			embedText: 'round trip embed input',
			embedSourceProperty: 'embedText',
			embedding: roundTripVector,
		}),
		HEADER,
		true,
	);

	putDistinctNodeVectors(
		{ nodes: [harvestShapedCard], vectorStore: scratchStore },
		(putError) => {
			harness.ok('putDistinctNodeVectors persists the declared-input vector', !putError, putError);
			harness.ok(
				'  and strips the transient sidecar carriers from the node',
				harvestShapedCard._sidecarVector === undefined &&
					harvestShapedCard._sidecarInputText === undefined,
				JSON.stringify(Object.keys(harvestShapedCard)),
			);

			// the restore side reads what the block would carry: embeddingRef + standardKey
			const restoreSideNode = {
				stableId: harvestShapedCard.stableId,
				embeddingRef: harvestShapedCard.embeddingRef,
				_standardKey: 'ceds',
				properties: {},
			};
			const storeResolver = (standardKey, resolverDone) =>
				standardKey === 'ceds'
					? resolverDone('', scratchStore)
					: resolverDone(`no store for '${standardKey}'`);

			resolveNodeVectors(
				{ nodes: [restoreSideNode], storeResolver, header: { embeddingDims: 8 } },
				(resolveError) => {
					harness.ok('resolveNodeVectors resolves the ref from the store', !resolveError, resolveError);
					const restoredVector = restoreSideNode.embedding || [];
					const float32Of = (values) => Array.from(Float32Array.from(values));
					harness.equal(
						'the restored vector is float32-identical to what the harvest persisted (spot-hash)',
						crypto.createHash('sha256').update(JSON.stringify(float32Of(restoredVector))).digest('hex'),
						crypto.createHash('sha256').update(JSON.stringify(float32Of(roundTripVector))).digest('hex'),
					);

					// TWIN (observed RED): corrupt the stored row's inputText so the determinant
					// hash no longer matches the vectorId — the store's verify-on-read must REFUSE,
					// never hand a tampered vector into a restore.
					const corruptStatement = `UPDATE vectors SET inputText='tampered input' WHERE vectorId='${harvestShapedCard.embeddingRef}';`;
					const sqliteBinary = require('child_process').spawnSync('sqlite3', [
						scratchStorePath,
						corruptStatement,
					]);
					harness.ok(
						'twin setup: the stored determinant was corrupted in place',
						sqliteBinary.status === 0,
						String(sqliteBinary.stderr),
					);
					resolveNodeVectors(
						{
							nodes: [
								{
									stableId: restoreSideNode.stableId,
									embeddingRef: harvestShapedCard.embeddingRef,
									_standardKey: 'ceds',
									properties: {},
								},
							],
							storeResolver,
							header: { embeddingDims: 8 },
						},
						(twinError) => {
							harness.match(
								'TWIN OBSERVED RED: a tampered store row is REFUSED on read (verify-on-read), never restored',
								twinError || '',
								/determinant|vectorId|corrupt|verification|hash/i,
							);
							harness.report();
						},
					);
				},
			);
		},
	);
});
