#!/usr/bin/env node
'use strict';

// test-cedsLayers.js — CEDS's three LAYERS forged over the REAL CEDS base and round-tripped, Docker-free (lane DES, campaign
// cedsRichness-101226, 2026-10-12; TQ rulings 1-3, COPPER_RIVER's design word):
//   des        the Domain Entity Schema V13 workbook, every cell of four sheets back out of the layer
//   guide      Ontology Guide V14 Appendix A, every cell of its three TSVs back out
//   textRepair the U+FFFD repairs: exactly what the declared rule licenses, from the IDS v14 reference data
// Every count below was MEASURED (design §2, §2.5) and is asserted as a number, not a ratio. Every round trip is shown clean
// and then shown RED on a twin that breaks the one thing it guards (a cell, an edge, a repair). And the base is shown
// UNTOUCHED: a layer reads the base and never writes it (ruling 1: V13 text never goes onto a V14 node).
//
// Run: node forges/ceds/test/test-cedsLayers.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- CEDS's des, guide and textRepair layers over the real base, with their round trips and twins
SYNOPSIS
     ${moduleName} [-verbose] [-help]
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const crypto = require('crypto');
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const TREE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const layerFramework = require(path.join(TREE_LIB, 'layer-framework', 'layer-framework'))();
const { layerGraphOfStampedGraph } = require(path.join(TREE_LIB, 'layer-framework', 'layerRoundTrip'))();
const forgeCeds = require('../forgeCeds')({ embedder: null });

const BUNDLE_DIR_PATH = path.join(__dirname, '..');
const CEDS_SOURCE_PATH = path.join(BUNDLE_DIR_PATH, 'assets', 'standardSourceData', '01', 'CEDS-Ontology.rdf');
const LAYER_NAMESPACE = 'https://w3id.org/EDUcore/CEDStandards/layer/';
const cloneOf = (anyValue) => JSON.parse(JSON.stringify(anyValue));
const sha256Of = (anyValue) => crypto.createHash('sha256').update(JSON.stringify(anyValue)).digest('hex');
const countOf = (itemList, predicate) => itemList.filter(predicate).length;

// forgeOneLayer — resolve + forge one layer over the base; callback(errString, forged)
const forgeOneLayer = ({ layerKey, baseNodeEdges }, callback) => {
	const resolvedLayer = layerFramework.resolveLayer({ bundleDir: BUNDLE_DIR_PATH, layerKey });
	if (resolvedLayer.error) {
		callback(resolvedLayer.error);
		return;
	}
	layerFramework.forgeLayer({ resolvedLayer, baseNodeEdges, standardName: 'CEDS', layerNamespace: LAYER_NAMESPACE }, (forgeError, forged) => callback(forgeError, forged && { ...forged, resolvedLayer }));
};

// roundTripOf — the layer's own validator over the stamped graph (a double of what the bolt reader returns)
const roundTripOf = ({ layerKey, stampedGraph, baseNodeEdges, resolvedLayer }, callback) => {
	const validator = require(path.join(BUNDLE_DIR_PATH, 'layers', layerKey, 'roundTripValidator.js'));
	const layerGraph = layerGraphOfStampedGraph({ stampedGraph, baseNodeEdges });
	if (validator.baseQueryRowsOfNodeEdges) {
		layerGraph.baseQueryRowListByName = validator.baseQueryRowsOfNodeEdges({ baseNodeEdges });
	}
	validator.validateWithLayerGraph({ snapshotPath: resolvedLayer.snapshotDirPath, layerGraph }, callback);
};

// twinIsRed — a mutated copy of the stamped graph must NOT round-trip clean
const twinIsRed = ({ layerKey, forged, baseNodeEdges, twinName, mutate }, callback) => {
	const stampedGraph = cloneOf(forged.stampedGraph);
	mutate(stampedGraph);
	roundTripOf({ layerKey, stampedGraph, baseNodeEdges, resolvedLayer: forged.resolvedLayer }, (roundTripError, verdict) => {
		const isRed = Boolean(roundTripError) || verdict.roundTripClean === false;
		harness.ok(`twin '${twinName}' is RED (${roundTripError ? `refused: ${String(roundTripError).slice(0, 80)}` : `lost ${verdict.lostTotal}, invented ${verdict.inventedTotal}`})`, isRed);
		callback();
	});
};

const eachInSeries = (itemList, iterator, done) => {
	const step = (itemIndex) => (itemIndex >= itemList.length ? done() : iterator(itemList[itemIndex], () => step(itemIndex + 1)));
	step(0);
};

const runLayerSection = ({ baseNodeEdges, layerKey, title, countAssertion, twinList }, done) => {
	harness.section(title);
	forgeOneLayer({ layerKey, baseNodeEdges }, (forgeError, forged) => {
		harness.equal(`the ${layerKey} layer forges over the real base`, forgeError, '');
		if (forgeError) {
			done();
			return;
		}
		countAssertion(forged);
		roundTripOf({ layerKey, stampedGraph: forged.stampedGraph, baseNodeEdges, resolvedLayer: forged.resolvedLayer }, (roundTripError, verdict) => {
			harness.equal(`the ${layerKey} round trip runs`, roundTripError, '');
			harness.ok(`the ${layerKey} round trip is CLEAN: lost 0, invented 0 (${verdict && verdict.census.statementCensus.sourceStatementCount} statements)`, verdict && verdict.roundTripClean === true && verdict.lostTotal === 0 && verdict.inventedTotal === 0);
			eachInSeries(twinList, (oneTwin, next) => twinIsRed({ layerKey, forged, baseNodeEdges, ...oneTwin }, next), done);
		});
	});
};

const nodesOfRole = (stampedGraph, role) => stampedGraph.nodes.filter((oneNode) => oneNode.properties.role === role);
const edgesOfType = (stampedGraph, type) => stampedGraph.edges.filter((oneEdge) => oneEdge.type === type);
const rootOf = (stampedGraph) => nodesOfRole(stampedGraph, 'DmeLayerRoot')[0].properties;

forgeCeds.forge({ sourcePath: CEDS_SOURCE_PATH, skipEmbedding: true }, (forgeError, base) => {
	if (forgeError) {
		harness.ok('CEDS forge succeeded (local asset, no embedding)', false, String(forgeError));
		harness.report();
		return;
	}
	const baseNodeEdges = { nodes: base.nodes, edges: base.edges };
	const baseFingerprintBefore = sha256Of(baseNodeEdges);

	runLayerSection(
		{
			baseNodeEdges,
			layerKey: 'des',
			title: 'des — the Domain Entity Schema V13, every cell of four sheets',
			countAssertion: (forged) => {
				const graph = forged.stampedGraph;
				harness.equal('13 DES domains', countOf(graph.nodes, (oneNode) => oneNode.properties.areaKind === 'desDomain'), 13);
				harness.equal('75 DES entities (domain-scoped)', countOf(graph.nodes, (oneNode) => oneNode.properties.areaKind === 'desEntity'), 75);
				harness.equal('523 DES category nodes (488 published paths and their prefixes)', countOf(graph.nodes, (oneNode) => oneNode.properties.areaKind === 'desCategory'), 523);
				harness.equal('1,965 DES elements', nodesOfRole(graph, 'DmeLayerElement').length, 1965);
				harness.equal('5,110 placements', nodesOfRole(graph, 'DmePlacement').length, 5110);
				harness.equal('1,937 elements join a V14 property by Global ID', edgesOfType(graph, 'SAME_GLOBAL_ID_PROPERTY').length, 1937);
				harness.equal('4,907 placements reach a V14 property', edgesOfType(graph, 'PLACES_PROPERTY').length, 4907);
				harness.equal('the root counts the 28 DES-only elements, never dropped', rootOf(graph).globalIdUnjoinedElementCount, 28);
				harness.ok('every DES node is stamped desVersion 13 (ruling 1)', graph.nodes.every((oneNode) => oneNode.properties.desVersion === '13'));
				harness.ok('no DES edge links an entity or category to a CEDS class (ruling 2)', !graph.edges.some((oneEdge) => /\/C\d{6}$/.test(oneEdge.toRef.id)));
			},
			twinList: [
				{ twinName: 'oneCellChanged', mutate: (graph) => { nodesOfRole(graph, 'DmePlacement')[0].properties.desNewAssociation = 'Maybe'; } },
				{ twinName: 'onePlacementPropertyEdgeDropped', mutate: (graph) => { graph.edges.splice(graph.edges.findIndex((oneEdge) => oneEdge.type === 'PLACES_PROPERTY'), 1); } },
				{ twinName: 'onePlacementMovedToAnotherArea', mutate: (graph) => { const moved = graph.edges.find((oneEdge) => oneEdge.type === 'HAS_DES_PLACEMENT'); moved.fromRef = { ...moved.fromRef, id: graph.edges.filter((oneEdge) => oneEdge.type === 'HAS_DES_PLACEMENT').find((oneEdge) => oneEdge.fromRef.id !== moved.fromRef.id).fromRef.id }; } },
				{ twinName: 'oneElementDropped', mutate: (graph) => { graph.nodes.splice(graph.nodes.findIndex((oneNode) => oneNode.properties.role === 'DmeLayerElement'), 1); } },
			],
		},
		() =>
			runLayerSection(
				{
					baseNodeEdges,
					layerKey: 'guide',
					title: 'guide — Ontology Guide V14 Appendix A, every cell of three tables',
					countAssertion: (forged) => {
						const graph = forged.stampedGraph;
						harness.equal('8 Conceptual Model concepts, Claim included', nodesOfRole(graph, 'DmeConcept').map((oneNode) => oneNode.properties.name).join(','), 'Person,Organization,Resource,Membership,Asset,Event,Claim,Provenance');
						harness.equal('400 classes take a primary concept', edgesOfType(graph, 'HAS_PRIMARY_CONCEPT').length, 400);
						harness.equal('191 take a secondary concept', edgesOfType(graph, 'HAS_SECONDARY_CONCEPT').length, 191);
						harness.equal('204 event-date properties, 418 concept edges', new Set(edgesOfType(graph, 'HAS_EVENT_DATE_CONCEPT').map((oneEdge) => oneEdge.fromRef.id)).size * 1000 + edgesOfType(graph, 'HAS_EVENT_DATE_CONCEPT').length, 204418);
						harness.equal('the guide\'s wrapped names come out whole (the by-eye check)', edgesOfType(graph, 'HAS_EVENT_DATE_CONCEPT').find((oneEdge) => oneEdge.fromRef.id.endsWith('/P002090')).properties.guidePropertyName, 'Accessible Format Issued Begin Date');
					},
					twinList: [
						{ twinName: 'oneSecondaryConceptDropped', mutate: (graph) => { graph.edges.splice(graph.edges.findIndex((oneEdge) => oneEdge.type === 'HAS_SECONDARY_CONCEPT'), 1); } },
						{ twinName: 'onePrimaryConceptRedirected', mutate: (graph) => { const redirected = graph.edges.find((oneEdge) => oneEdge.type === 'HAS_PRIMARY_CONCEPT'); redirected.toRef = { ...redirected.toRef, id: nodesOfRole(graph, 'DmeConcept').find((oneNode) => oneNode.stableId !== redirected.toRef.id).stableId }; } },
					],
				},
				() =>
					runLayerSection(
						{
							baseNodeEdges,
							layerKey: 'textRepair',
							title: 'textRepair — the U+FFFD repairs the declared rule licenses, and the list of what it leaves alone',
							countAssertion: (forged) => {
								const graph = forged.stampedGraph;
								const repairList = nodesOfRole(graph, 'DmeTextRepair');
								harness.equal('834 repairs: 407 names, 407 prefLabels, 10 definitions, 10 descriptions', ['definition', 'description', 'name', 'prefLabel'].map((propertyName) => `${propertyName}:${countOf(repairList, (oneRepair) => oneRepair.properties.repairedPropertyName === propertyName)}`).join(','), 'definition:10,description:10,name:407,prefLabel:407');
								harness.equal('what is left alone, by reason', rootOf(graph).unrepairedCountByReasonText, JSON.stringify({ notAnOptionValue: 27, idsTextDiffersBeyondTheDamage: 2, noIdsReferenceRowByIdJoin: 1795, propertyHasNoIdsColumn: 1 }));
								const zapotec = repairList.find((oneRepair) => oneRepair.properties.repairedCedsId === 'OV001637180061' && oneRepair.properties.repairedPropertyName === 'name');
								harness.equal('a repair carries the IDS text beside the faithful one', zapotec && `${zapotec.properties.faithfulText} -> ${zapotec.properties.repairedText}`, 'Santa In�s Yatzechi Zapotec -> Santa Inés Yatzechi Zapotec');
								harness.ok('every repair cites file, sha256 and line', repairList.every((oneRepair) => oneRepair.properties.repairSourceFileName === 'Populate-CEDS-Ref-Tables.sql' && /^[0-9a-f]{64}$/.test(oneRepair.properties.repairSourceSha256) && Number.isInteger(oneRepair.properties.repairSourceLineNumber)));
							},
							twinList: [
								{ twinName: 'oneRepairDropped', mutate: (graph) => { graph.nodes.splice(graph.nodes.findIndex((oneNode) => oneNode.properties.role === 'DmeTextRepair'), 1); } },
								{ twinName: 'oneRepairedTextChanged', mutate: (graph) => { nodesOfRole(graph, 'DmeTextRepair')[0].properties.repairedText = 'Not what the IDS says'; } },
								{ twinName: 'oneFaithfulTextNoLongerTheCedsText', mutate: (graph) => { nodesOfRole(graph, 'DmeTextRepair')[1].properties.faithfulText = 'Rewritten'; } },
								{ twinName: 'oneUnrepairedTextUnlisted', mutate: (graph) => { const rootProperties = rootOf(graph); rootProperties.unrepairedTextListText = JSON.stringify(JSON.parse(rootProperties.unrepairedTextListText).slice(1)); } },
							],
						},
						() => {
							harness.section('the base is untouched');
							harness.equal('the CEDS base nodeEdges are byte-identical after all three layers (no V14 node written)', sha256Of(baseNodeEdges), baseFingerprintBefore);
							harness.report();
						},
					),
			),
	);
});
