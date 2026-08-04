#!/usr/bin/env node
'use strict';

// test-authored-anchor-bridge.js — the hermetic gate for the GENERIC authored-anchor resolver
// (forges/bridges/authoredAnchorBridge.js, "item zero", P7 2026-07-30). Proves, WITHOUT docker/
// Voyage/a database:
//
//   A. HARVEST semantics (pure, synthetic) — the two-anchor-source reconciliation per TQ's ruling:
//      agreement -> ONE dual-attested mapping; divergence -> BOTH channels (authored EXACT +
//      per-node CLOSE); non-P-form and non-ceds crossRefs entries ignored; repeated ids deduped.
//   B. THE DIVERGENCE MANIFEST is deterministic and content-addressed — same decisions ->
//      byte-identical frozen text and hash; different decisions -> a different hash.
//   C. THE BRIDGE end-to-end over synthetic fixtures, writing through the REAL vocabulary-guarded
//      relationshipWriter (constructed with the REAL deriveEdgePolicy): agreement -> one
//      EXACT_MATCH carrying BOTH locators; divergence -> an EXACT_MATCH and a distinct CLOSE_MATCH
//      whose decisionBlockHash equals the saved manifest hash; an UNRESOLVABLE anchor -> honest
//      abstention (orphan with its true reason), never a fabricated edge. Because the writes travel
//      the REAL guard, this section IS the GREEN half of the guard proof.
//   D. RED negative controls against the REAL guard — a CLOSE_MATCH stripped of its
//      decisionBlockHash/confidence stamps is refused BY NAME; a mis-predicated mapping edge
//      (EXACT_MATCH carrying predicate 'closeMatch') is refused, never silently corrected.
//   E. REPLAY BYTE-STABILITY — two runs over identical fixtures produce byte-identical write
//      sequences and the identical manifest hash (the deterministic-join twin of MATERIALIZE
//      replay).
//   F. REAL EdFi — the EdFi forge runs in-process (skipEmbedding) and the bridge resolves its
//      REAL stashed anchors through bridgeMaker.run (reader/writer doubles, real guard): 625
//      anchored nodes -> 656 EXACT_MATCH edges (625 dual-attested + 31 crosswalk-only), 0
//      divergent per-node anchors (measured 2026-08-04 over snapshot 04; the per-node scalar is
//      always the FIRST crosswalk id).
//      RE-MEASURED AT THE forge-edfi PHASE 5 CLOSEOUT: this section previously forged the
//      INCUMBENT CSV-crosswalk forge over snapshot 01 and asserted 1,190 / 1,147 / 43. That forge
//      and that snapshot were removed at closeout (R-WO-2), so the section now forges the
//      round-trip-campaign forge over snapshot 04 and asserts what THAT population measures. The
//      drop is a concrete R-WO-1 consequence, not a regression: identity continuity was never a
//      goal, and the shortfall is the 764 unmatched authored-crosswalk element rows already
//      REPORTED as the enrichment backlog (R-WO-11, REPORT-edfiCensusDelta-080326.md) — the old
//      forge derived node identities from the crosswalk CSV's own flattened XSD paths, so its rows
//      matched by construction; this forge derives them from MetaEd. The SHAPE is unchanged and
//      that is what this section guards: every anchored node carries BOTH channels (0 scalar-only,
//      0 crossRef-only, measured), hence dualAttested === anchoredNodes and nodeAnchorDivergent
//      === 0, with 656 total assignments = 625 first-per-node + 31 beyond-first.
//   G. REAL SEDM — same path: 230 anchored elements -> 230 dual-attested EXACT_MATCH edges, 0
//      divergence (the SEDM element identity INCLUDES its Global ID, so the sources cannot split).
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-authored-anchor-bridge.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the generic authored-anchor resolver

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the authored-anchor bridge's reconciliation semantics (agreement -> one dual-attested
     EXACT_MATCH; divergence -> authored EXACT_MATCH + per-node CLOSE_MATCH with a deterministic
     decision manifest; unresolvable -> honest abstention), RED/GREEN against the REAL vocabulary
     guard, replay byte-stability, and the real EdFi/SEDM anchor populations end-to-end through
     bridgeMaker.run. Pure and in-memory beyond the bundled forge assets; no docker, no Voyage,
     no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const path = require('path');

const authoredAnchorBridge = require('../../../../../forges/bridges/authoredAnchorBridge');
const referenceIndexFactory = require('../lib/referenceIndex');
const relationshipWriterFactory = require('../lib/relationshipWriter');
const { deriveEdgePolicy } = require('../lib/componentLibrary');
const bridgeMakerModule = require('../bridgeMaker');

const { harvestAuthoredAnchors, composeDivergenceManifest } = authoredAnchorBridge;

// =====================================================================
harness.section('A — HARVEST semantics (pure): agreement, divergence, ignore rules, dedup');
// =====================================================================
const syntheticSourceNodes = [
	{
		// agreement: per-node anchor corroborates the one crosswalk assignment
		stableId: 'xy:a',
		properties: {
			cedsId: 'P000123',
			crossRefs: JSON.stringify([{ system: 'ceds', id: 'P000123', raw: '123', locator: 'CEDSGlobalId' }]),
		},
	},
	{
		// divergence: crosswalk says P000111, the per-node anchor says P000555
		stableId: 'xy:b',
		properties: {
			cedsId: 'P000555',
			crossRefs: JSON.stringify([{ system: 'ceds', id: 'P000111', raw: '111', locator: 'CEDSGlobalId' }]),
		},
	},
	{
		// node-anchor-only divergence: a per-node anchor with NO crosswalk entry at all
		stableId: 'xy:c',
		properties: { cedsId: 'P000999', crossRefs: '[]' },
	},
	{
		// no anchors of either kind — not this bridge's node
		stableId: 'xy:d',
		properties: { crossRefs: '[]' },
	},
	{
		// ignore rules + dedup: non-ceds system, non-P-form id (an OV token and a raw option code),
		// and the SAME P id twice -> exactly one mapping
		stableId: 'xy:e',
		properties: {
			cedsId: 'P000321',
			crossRefs: JSON.stringify([
				{ system: 'ceds', id: 'P000321', raw: '321', locator: 'CEDSGlobalId' },
				{ system: 'ceds', id: 'P000321', raw: '321-again', locator: 'CEDSGlobalId' },
				{ system: 'ceds', id: 'OV000042', raw: 'ov', locator: 'CEDSOptionCode' },
				{ system: 'ceds', optionCode: '42', locator: 'CEDSOptionCode' },
				{ system: 'lex', id: 'P000777', raw: 'not-ceds', locator: 'other' },
			]),
		},
	},
];

const harvest = harvestAuthoredAnchors({ sourceNodes: syntheticSourceNodes });
harness.equal('5 nodes seen', harvest.counts.nodesSeen, 5);
harness.equal('4 anchored nodes (xy:d has no anchor)', harvest.counts.anchoredNodes, 4);
harness.equal('3 authored crosswalk mappings (a, b, e — dedup holds on e)', harvest.authoredMappings.length, 3);
harness.equal('2 dual-attested (a and e)', harvest.counts.dualAttested, 2);
harness.equal('1 authored-only (b: P000111 uncorroborated by the scalar)', harvest.counts.authoredOnly, 1);
harness.equal('2 divergent per-node anchors (b: P000555; c: P000999)', harvest.counts.nodeAnchorDivergent, 2);
harness.equal('divergent mappings list matches the count', harvest.divergentAnchorMappings.length, 2);
harness.ok(
	'no OV-form, option-code, or non-ceds entry produced a mapping',
	harvest.authoredMappings.every((m) => /^P\d{6,}$/.test(m.targetKey)) &&
		harvest.authoredMappings.every((m) => m.targetKey !== 'P000777'),
);
const dualAttestation = harvest.attestationByPair['xy:a|P000123'];
harness.equal('agreement attestation is dual', dualAttestation && dualAttestation.anchorAttestation, 'authoredCrossRef+nodeAnchor');
harness.equal('agreement records BOTH locators', dualAttestation && dualAttestation.anchorLocators, 'CEDSGlobalId+cedsId');
const authoredOnlyAttestation = harvest.attestationByPair['xy:b|P000111'];
harness.equal('crosswalk-only attestation names the crosswalk alone', authoredOnlyAttestation && authoredOnlyAttestation.anchorAttestation, 'authoredCrossRef');
const nodeAnchorAttestation = harvest.attestationByPair['xy:b|P000555'];
harness.equal('divergent per-node attestation names the node anchor alone', nodeAnchorAttestation && nodeAnchorAttestation.anchorAttestation, 'nodeAnchor');
harness.equal('divergent per-node locator is the scalar property', nodeAnchorAttestation && nodeAnchorAttestation.anchorLocators, 'cedsId');

// =====================================================================
harness.section('B — the divergence manifest: deterministic, content-addressed, self-describing');
// =====================================================================
const pairStamp = { subjectSource: 'XY', subjectVersion: '1', objectSource: 'CEDS', objectVersion: '9' };
const manifestOne = composeDivergenceManifest({ pairStamp, divergentAnchorMappings: harvest.divergentAnchorMappings });
const manifestTwo = composeDivergenceManifest({ pairStamp, divergentAnchorMappings: harvest.divergentAnchorMappings });
harness.equal('same decisions -> byte-identical frozen text', manifestOne.frozenText, manifestTwo.frozenText);
harness.equal('same decisions -> identical hash', manifestOne.decisionBlockHash, manifestTwo.decisionBlockHash);
harness.match('the manifest self-describes its generation', manifestOne.frozenText, /authoredAnchorBridge-v1/);
const manifestOther = composeDivergenceManifest({ pairStamp, divergentAnchorMappings: harvest.divergentAnchorMappings.slice(0, 1) });
harness.ok('different decisions -> a different hash', manifestOther.decisionBlockHash !== manifestOne.decisionBlockHash);

// =====================================================================
// shared fixtures + doubles for the end-to-end sections
// =====================================================================
const propertyRefFor = (oneId) => ({
	stableId: `ref/${oneId}`,
	properties: {
		role: 'HubReference',
		referenceTier: 'property',
		canonicalKey: oneId,
		propertyKey: oneId,
		qualifierKeys: [],
	},
});
const syntheticReferenceNodes = ['P000123', 'P000111', 'P000555', 'P000321'].map(propertyRefFor);
// NOTE: P000999 deliberately has NO HubReference — the honest-abstention case.

const makeGraphReaderDouble = ({ sourceNodes, referenceNodes, sourceKey }) => ({ inGraph }) => ({
	readNodes: ({ label, propertyEquals }, callback) => {
		void inGraph;
		const eq = propertyEquals || {};
		if (label === 'HubReference') {
			callback('', { nodes: referenceNodes });
			return;
		}
		if (eq._source === sourceKey) {
			callback('', { nodes: sourceNodes });
			return;
		}
		callback('', { nodes: [] });
	},
	close: (callback) => callback(''),
});

const makeDecisionStoreDouble = (saves) => ({
	saveDecisionBlock: ({ pairKey, frozenText, decisionBlockHash }, callback) => {
		saves.push({ pairKey, frozenText, decisionBlockHash });
		callback('', {});
	},
	getDecisionBlock: ({ pairKey }, callback) => {
		void pairKey;
		callback('', { frozenText: null });
	},
});

const makeGraphWriterDouble = (writes) => ({
	writeRelationshipEdge: (spec, callback) => {
		writes.push(spec);
		// defer like real I/O would: the EdFi run queues 656 writes through pipeRunner's recursion,
		// and a synchronous callback chain that deep overflows the stack (the real substrate never
		// calls back synchronously, so the bridge is correct — the DOUBLE must not lie about that).
		setImmediate(() => callback('', { edgeWritten: true }));
	},
	close: (callback) => callback(''),
});

// runBridgeDirect — compose the bridge exactly the way the component library would, but with the
// REAL referenceIndex + the REAL vocabulary-guarded relationshipWriter over a writer double.
// THE EXACT-NAME RULE (2026-07-30): the double is keyed by the DECLARED standardName VERBATIM —
// deliberately MIXED-CASE ('Xy') against a lowercase token ('xy'), because the first live EdFi run
// proved a double that echoes the bridge's own case assumption (the old sourceStandard.toUpperCase()
// here) can never catch a case mismatch. The double must be faithful to reality, not to the code
// under test.
const SYNTHETIC_STANDARD_NAME = 'Xy';
const runBridgeDirect = ({ sourceNodes, referenceNodes, sourceStandard, sourceStandardName = SYNTHETIC_STANDARD_NAME, writes, saves }, callback) => {
	const writer = relationshipWriterFactory({ graphWriter: makeGraphWriterDouble(writes), edgePolicy: deriveEdgePolicy() });
	const bridgeCallable = authoredAnchorBridge({
		graphReader: makeGraphReaderDouble({ sourceNodes, referenceNodes, sourceKey: SYNTHETIC_STANDARD_NAME }),
		referenceIndex: referenceIndexFactory,
		relationshipWriter: writer,
		decisionStore: makeDecisionStoreDouble(saves),
		config: { sourceStandard, sourceStandardName },
	});
	bridgeCallable({ inGraph: { graphName: 'DEV_probe' }, hub: 'ceds', applyLabel: 'BridgedRelation' }, callback);
};

// =====================================================================
harness.section('C — the bridge end-to-end (synthetic), through the REAL vocabulary guard (GREEN)');
// =====================================================================
const cWrites = [];
const cSaves = [];
runBridgeDirect(
	{ sourceNodes: syntheticSourceNodes, referenceNodes: syntheticReferenceNodes, sourceStandard: 'xy', writes: cWrites, saves: cSaves },
	(cErr, cResult) => {
		harness.ok(`bridge run did not error (${cErr || 'ok'})`, !cErr, cErr);
		harness.equal('4 edges written (3 EXACT + 1 CLOSE; P000999 abstained)', cResult && cResult.edgesWritten, 4);
		harness.equal('counts.authored (EXACT channel) === 3', cResult && cResult.counts && cResult.counts.authored, 3);
		harness.equal('counts.divergentAnchorClose === 1', cResult && cResult.counts && cResult.counts.divergentAnchorClose, 1);
		harness.equal('counts.inferred === 0 (nothing here is LLM-inferred)', cResult && cResult.counts && cResult.counts.inferred, 0);
		harness.equal('counts.orphans === 1 (the unresolvable P000999)', cResult && cResult.counts && cResult.counts.orphans, 1);
		harness.equal('producer declares itself authored', cResult && cResult.producer, 'authored');

		const exactWrites = cWrites.filter((w) => w.relationshipType === 'EXACT_MATCH');
		const closeWrites = cWrites.filter((w) => w.relationshipType === 'CLOSE_MATCH');
		harness.equal('3 EXACT_MATCH writes', exactWrites.length, 3);
		harness.equal('1 CLOSE_MATCH write', closeWrites.length, 1);
		harness.ok('every write carried the applyLabel', cWrites.every((w) => w.applyLabel === 'BridgedRelation'));
		harness.ok('every write targets a HubReference (ref/*)', cWrites.every((w) => `${w.toStableId}`.indexOf('ref/') === 0));
		harness.ok(
			'every EXACT write: predicate exactMatch / spec-authoritative / confidence 1.0 / manual curation',
			exactWrites.every(
				(w) =>
					w.properties.predicate === 'exactMatch' &&
					w.properties.provenanceTier === 'spec-authoritative' &&
					w.properties.confidence === 1.0 &&
					w.properties.mappingJustification === 'semapv:ManualMappingCuration',
			),
		);

		const agreementWrite = exactWrites.find((w) => w.fromStableId === 'xy:a');
		harness.equal('AGREEMENT -> ONE edge only for xy:a', cWrites.filter((w) => w.fromStableId === 'xy:a').length, 1);
		harness.equal('agreement edge is doubly attested', agreementWrite && agreementWrite.properties.anchorAttestation, 'authoredCrossRef+nodeAnchor');
		harness.equal('agreement edge records BOTH locators', agreementWrite && agreementWrite.properties.anchorLocators, 'CEDSGlobalId+cedsId');

		harness.equal('DIVERGENCE -> BOTH edges for xy:b', cWrites.filter((w) => w.fromStableId === 'xy:b').length, 2);
		const divergentClose = closeWrites[0];
		harness.equal('the divergent per-node edge is CLOSE_MATCH from xy:b', divergentClose && divergentClose.fromStableId, 'xy:b');
		harness.equal('  predicate closeMatch', divergentClose && divergentClose.properties.predicate, 'closeMatch');
		harness.equal('  attested by the node anchor alone', divergentClose && divergentClose.properties.anchorAttestation, 'nodeAnchor');
		harness.equal('  confidence 1.0 (the deterministic anchor assertion; the predicate carries the downgrade)', divergentClose && divergentClose.properties.confidence, 1.0);
		harness.ok('  decisionBlockHash stamped', !!(divergentClose && divergentClose.properties.decisionBlockHash));
		harness.equal('  the stamped hash IS the returned decisionBlock', divergentClose && divergentClose.properties.decisionBlockHash, cResult && cResult.decisionBlock);
		harness.equal('the manifest was saved once', cSaves.length, 1);
		harness.equal('  under the bridge\'s OWN pairKey (never the evidence block\'s)', cSaves[0] && cSaves[0].pairKey, 'CEDS::Xy::authoredAnchor');
		harness.equal('  save hash === stamped hash', cSaves[0] && cSaves[0].decisionBlockHash, cResult && cResult.decisionBlock);

		harness.equal('UNRESOLVABLE anchor -> zero edges from xy:c', cWrites.filter((w) => w.fromStableId === 'xy:c').length, 0);
		const abstention = (cResult.unresolvedAnchors || []).find((o) => o.fromStableId === 'xy:c');
		harness.ok('the abstention is RECORDED with its true reason', !!abstention && /no property-tier or value-tier HubReference/.test(abstention.reason));

		// =====================================================================
		harness.section('D — RED negative controls: the REAL vocabulary guard refuses a mis-stamped edge');
		// =====================================================================
		const redWrites = [];
		const guardedWriter = relationshipWriterFactory({ graphWriter: makeGraphWriterDouble(redWrites), edgePolicy: deriveEdgePolicy() });
		guardedWriter(
			{
				decision: {
					fromStableId: 'xy:b',
					toStableId: 'ref/P000555',
					relationshipType: 'CLOSE_MATCH',
					// predicate + tier present, but the CLOSE_MATCH stamps (decisionBlockHash, confidence)
					// stripped — exactly what a lazily-tiered divergent edge would look like.
					properties: { predicate: 'closeMatch', provenanceTier: 'spec-authoritative', mappingJustification: 'semapv:ManualMappingCuration' },
				},
				applyLabel: 'BridgedRelation',
			},
			(redErr) => {
				harness.ok('RED: CLOSE_MATCH without its stamps is refused', !!redErr);
				harness.match('  the refusal names the missing stamps', `${redErr}`, /CLOSE_MATCH edge additionally requires decisionBlockHash and confidence/);
				guardedWriter(
					{
						authoredMapping: {
							fromStableId: 'xy:b',
							toStableId: 'ref/P000555',
							// a mis-tiered edge the guard CAN see: the type claims EXACT while the stamp
							// confesses closeMatch — refused, never silently corrected.
							relationshipType: 'EXACT_MATCH',
							properties: { predicate: 'closeMatch', provenanceTier: 'spec-authoritative', confidence: 1.0 },
						},
						applyLabel: 'BridgedRelation',
					},
					(redErrTwo) => {
						harness.ok('RED: EXACT_MATCH carrying predicate closeMatch is refused', !!redErrTwo);
						harness.match('  the refusal names the disagreement', `${redErrTwo}`, /expects properties\.predicate 'exactMatch', but got 'closeMatch'/);
						harness.equal('no RED write reached the graph', redWrites.length, 0);

						// =====================================================================
						harness.section('E — replay byte-stability: two identical runs, identical writes + hash');
						// =====================================================================
						const eWritesOne = [];
						const eWritesTwo = [];
						const eSavesOne = [];
						const eSavesTwo = [];
						runBridgeDirect(
							{ sourceNodes: syntheticSourceNodes, referenceNodes: syntheticReferenceNodes, sourceStandard: 'xy', writes: eWritesOne, saves: eSavesOne },
							(eErrOne, eResultOne) => {
								runBridgeDirect(
									{ sourceNodes: syntheticSourceNodes, referenceNodes: syntheticReferenceNodes, sourceStandard: 'xy', writes: eWritesTwo, saves: eSavesTwo },
									(eErrTwo, eResultTwo) => {
										harness.ok(`neither replay run errored (${eErrOne || eErrTwo || 'ok'})`, !eErrOne && !eErrTwo);
										harness.equal('byte-identical write sequences', JSON.stringify(eWritesOne), JSON.stringify(eWritesTwo));
										harness.equal('identical manifest hash across runs', eResultOne && eResultOne.decisionBlock, eResultTwo && eResultTwo.decisionBlock);
										harness.equal('byte-identical frozen manifest text', eSavesOne[0] && eSavesOne[0].frozenText, eSavesTwo[0] && eSavesTwo[0].frozenText);

										runRealStandardSections();
									},
								);
							},
						);
					},
				);
			},
		);
	},
);

// =====================================================================
// F/G — the REAL forged standards, end-to-end through bridgeMaker.run (reader/writer doubles; the
// component library builds the REAL guarded relationshipWriter, so the guard runs live here too).
// =====================================================================
// hoisted declarations (same TDZ reason as runRealStandardSections below).
function referenceFixtureFrom(forgedNodes) {
	const anchorIds = new Set();
	forgedNodes.forEach((oneNode) => {
		const props = oneNode.properties || {};
		JSON.parse(props.crossRefs || '[]')
			.filter((oneRef) => oneRef && oneRef.system === 'ceds' && /^P\d{6,}$/.test(`${oneRef.id}`))
			.forEach((oneRef) => anchorIds.add(`${oneRef.id}`));
		if (/^P\d{6,}$/.test(`${props.cedsId}`)) {
			anchorIds.add(`${props.cedsId}`);
		}
	});
	return [...anchorIds].sort().map(propertyRefFor);
}

function runThroughBridgeMaker({ forgedNodes, sourceToken, sourceStandardName, writes, saves }, callback) {
	const referenceNodes = referenceFixtureFrom(forgedNodes);
	// EXACT-NAME RULE: the double is keyed by the real forged _source (the declared standardName,
	// VERBATIM — 'EdFi', not 'EDFI'), exactly what a live dependency graph carries.
	const graphReaderDouble = makeGraphReaderDouble({
		sourceNodes: forgedNodes,
		referenceNodes,
		sourceKey: sourceStandardName,
	});
	const graphWriterDouble = () => makeGraphWriterDouble(writes);
	bridgeMakerModule({ graphWriterFactory: graphWriterDouble, graphReaderFactory: graphReaderDouble }).run(
		{
			inGraph: { graphName: 'DEV_probe' },
			bridge: 'authoredAnchorBridge',
			source: sourceToken,
			hub: 'ceds',
			applyLabel: 'BridgedRelation',
			decisionStore: makeDecisionStoreDouble(saves),
			config: { sourceStandard: sourceToken, sourceStandardName },
		},
		callback,
	);
}

// a hoisted declaration on purpose: the synthetic sections' doubles call back SYNCHRONOUSLY, so
// section E reaches this before a const initializer would have run (TDZ).
function runRealStandardSections() {
	// -----------------------------------------------------------------
	harness.section('F — REAL EdFi anchors through bridgeMaker.run: 656 EXACT (625 dual + 31 crosswalk-only)');
	// -----------------------------------------------------------------
	const edfiBundle = require('../../../../../forges/edfi/forgeEdfi')({ embedder: null });
	const EDFI_ASSET_DIR = path.join(__dirname, '..', '..', '..', '..', '..', 'forges', 'edfi', 'assets', 'standardSourceData', '04');
	edfiBundle.forge({ sourcePath: EDFI_ASSET_DIR, skipEmbedding: true }, (edfiErr, edfiResult) => {
		if (edfiErr) {
			harness.ok(`real EdFi forge did not error (${edfiErr})`, false, edfiErr);
			harness.report();
			return;
		}
		const fWrites = [];
		const fSaves = [];
		runThroughBridgeMaker({ forgedNodes: edfiResult.nodes, sourceToken: 'edfi', sourceStandardName: 'EdFi', writes: fWrites, saves: fSaves }, (fErr, fReport) => {
			harness.ok(`EdFi bridge run did not error (${fErr || 'ok'})`, !fErr, fErr);
			harness.equal('656 edges written (every crosswalk assignment resolved)', fReport && fReport.edgesWritten, 656);
			harness.equal('counts.anchoredNodes === 625', fReport && fReport.counts && fReport.counts.anchoredNodes, 625);
			harness.equal('counts.dualAttested === 625', fReport && fReport.counts && fReport.counts.dualAttested, 625);
			harness.equal('counts.authoredOnly === 31 (the multi-id crosswalk rows the scalar collapsed away)', fReport && fReport.counts && fReport.counts.authoredOnly, 31);
			harness.equal('counts.nodeAnchorDivergent === 0 (the scalar is always the first crosswalk id)', fReport && fReport.counts && fReport.counts.nodeAnchorDivergent, 0);
			harness.equal('counts.orphans === 0 over the derived reference fixture', fReport && fReport.counts && fReport.counts.orphans, 0);
			harness.equal('decisionBlock is null (no divergent channel, nothing frozen)', fReport && fReport.decisionBlock, null);
			harness.equal('no manifest save without divergence', fSaves.length, 0);
			harness.equal('656 writes reached the graphWriter', fWrites.length, 656);
			harness.ok('every EdFi write is EXACT_MATCH', fWrites.every((w) => w.relationshipType === 'EXACT_MATCH'));
			harness.equal(
				'625 writes doubly attested',
				fWrites.filter((w) => w.properties.anchorAttestation === 'authoredCrossRef+nodeAnchor').length,
				625,
			);
			harness.equal(
				'31 writes crosswalk-attested only',
				fWrites.filter((w) => w.properties.anchorAttestation === 'authoredCrossRef').length,
				31,
			);
			harness.ok(
				'every EdFi write spec-authoritative / confidence 1.0 / manual curation',
				fWrites.every(
					(w) =>
						w.properties.provenanceTier === 'spec-authoritative' &&
						w.properties.confidence === 1.0 &&
						w.properties.mappingJustification === 'semapv:ManualMappingCuration',
				),
			);

			// -----------------------------------------------------------------
			harness.section('G — REAL SEDM anchors through bridgeMaker.run: 230 dual-attested EXACT');
			// -----------------------------------------------------------------
			const sedmBundle = require('../../../../../forges/sedm/forgeSedm')({ embedder: null });
			const SEDM_ASSET_DIR = path.join(__dirname, '..', '..', '..', '..', '..', 'forges', 'sedm', 'assets', 'standardSourceData', '01');
			sedmBundle.forge({ sourcePath: SEDM_ASSET_DIR, skipEmbedding: true }, (sedmErr, sedmResult) => {
				if (sedmErr) {
					harness.ok(`real SEDM forge did not error (${sedmErr})`, false, sedmErr);
					harness.report();
					return;
				}
				const gWrites = [];
				const gSaves = [];
				runThroughBridgeMaker({ forgedNodes: sedmResult.nodes, sourceToken: 'sedm', sourceStandardName: 'SEDM', writes: gWrites, saves: gSaves }, (gErr, gReport) => {
					harness.ok(`SEDM bridge run did not error (${gErr || 'ok'})`, !gErr, gErr);
					harness.equal('230 edges written (230/321 elements carry an anchor)', gReport && gReport.edgesWritten, 230);
					harness.equal('counts.dualAttested === 230 (SEDM stamps both sources together, always)', gReport && gReport.counts && gReport.counts.dualAttested, 230);
					harness.equal('counts.authoredOnly === 0', gReport && gReport.counts && gReport.counts.authoredOnly, 0);
					harness.equal('counts.nodeAnchorDivergent === 0 (checked, not assumed — identity includes the Global ID)', gReport && gReport.counts && gReport.counts.nodeAnchorDivergent, 0);
					harness.equal('counts.orphans === 0', gReport && gReport.counts && gReport.counts.orphans, 0);
					harness.equal('decisionBlock is null', gReport && gReport.decisionBlock, null);
					harness.equal('no manifest save', gSaves.length, 0);
					harness.ok('every SEDM write is a doubly attested EXACT_MATCH', gWrites.every((w) => w.relationshipType === 'EXACT_MATCH' && w.properties.anchorAttestation === 'authoredCrossRef+nodeAnchor'));

					// -----------------------------------------------------------------
					harness.section('H — EXACT-NAME RULE refusals (RED): the first live EdFi run wrote an EMPTY block; never again');
					// -----------------------------------------------------------------
					// H1: missing sourceStandardName is refused BY NAME — the token's case is not trustworthy.
					const hWriter = relationshipWriterFactory({ graphWriter: makeGraphWriterDouble([]), edgePolicy: deriveEdgePolicy() });
					const hBridgeNoName = authoredAnchorBridge({
						graphReader: makeGraphReaderDouble({ sourceNodes: syntheticSourceNodes, referenceNodes: syntheticReferenceNodes, sourceKey: SYNTHETIC_STANDARD_NAME }),
						referenceIndex: referenceIndexFactory,
						relationshipWriter: hWriter,
						decisionStore: makeDecisionStoreDouble([]),
						config: { sourceStandard: 'xy' },
					});
					hBridgeNoName({ inGraph: { graphName: 'DEV_probe' }, hub: 'ceds', applyLabel: 'BridgedRelation' }, (h1Err) => {
						harness.ok('RED: missing config.sourceStandardName is refused', !!h1Err);
						harness.match('  the refusal names the requirement', `${h1Err}`, /sourceStandardName is not set/);

						// H2: a name matching ZERO nodes is refused — an empty source set is never written as
						// an empty relationship block (the exact silent failure the live EdFi run produced).
						const hBridgeWrongName = authoredAnchorBridge({
							graphReader: makeGraphReaderDouble({ sourceNodes: syntheticSourceNodes, referenceNodes: syntheticReferenceNodes, sourceKey: SYNTHETIC_STANDARD_NAME }),
							referenceIndex: referenceIndexFactory,
							relationshipWriter: hWriter,
							decisionStore: makeDecisionStoreDouble([]),
							config: { sourceStandard: 'xy', sourceStandardName: 'XY' },
						});
						hBridgeWrongName({ inGraph: { graphName: 'DEV_probe' }, hub: 'ceds', applyLabel: 'BridgedRelation' }, (h2Err) => {
							harness.ok("RED: a name matching zero nodes ('XY' vs forged 'Xy') is refused", !!h2Err);
							harness.match('  the refusal names the empty source set', `${h2Err}`, /ZERO nodes with _source 'XY'/);

							harness.report();
						});
					});
				});
			});
		});
	});
}
