#!/usr/bin/env node
'use strict';

// test-bgMappingProvenance.js — BG-PROV: every mapping edge says WHAT KIND of claim it is, WHO made it and HOW SURE they
// were, from closed vocabularies (lane P, mappingProvenance 2026-10-04; WORKORDER-mappingProvenance-100426 step 3). TQ found
// the DME calling every EXACT_MATCH an "authored crosswalk ... trust as fact" in a graph whose 12,698 edges were every one a
// Jev judgment; these three fields are what a reader reads instead of inferring it.
//   (a) every edge carries mappingKind EQUAL to MAPPING_KIND_BY_RESOLUTION[resolution] and a mappingSource whose family
//       belongs to that kind
//   (b) a judged edge (real-client double) names its judge: mappingSource === 'bridge-' + the registered provider that minted
//       its mappingTool, and mappingConfidence EQUALS confidence
//   (c) a specified edge names its document: mappingSource === '<crosswalk|standard>-' + the block's bridgeName, and carries
//       NO mappingConfidence key
//   (d) a derived block judged by a real client: every edge 'inferred', and NO edge carries provenanceTier (retired from
//       mapping edges: TQ, 2026-10-04, reversing ruling A1 — the three fields ARE the provenance)
//   (e)-(k) the WRITE SEAM refuses, each BY NAME: an absent mappingKind; a mappingKind outside the vocabulary; a kind that
//       disagrees with the resolution; a source with no family; a bridge source naming an unregistered judge; a judged edge
//       without mappingConfidence; a specified edge carrying one
//   (l) the MATERIALISER refuses, by name and before any write, a judged record whose judge model no registered provider minted
//   (m) a DEBUG judge's edges are marked by WHO made them, not by a kind (TQ, 2026-10-04): mappingKind 'inferred',
//       mappingSource 'bridge-debug', mappingConfidence 0; the specified edges of the same block stay authored
//   (n) the write seam refuses provenanceTier on a mapping edge BY ITS RETIREMENT REASON, not merely as an unknown name
//   (o) the write seam refuses a 'bridge-debug' edge whose mappingConfidence is not 0
//   (p) the certification check (goldEvalCheck's bridge sibling) refuses, by name, a harvested edge with NO mappingSource: it
//       cannot be told from a debug edge, so it certifies nothing
// Every conjunct is observed RED under its twin; a refusal twin goes red BY MESSAGE (the refusal disappears, or a different
// one fires).
//
// Run: node lib/bridge-framework/test/test-bgMappingProvenance.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-PROV: mappingKind, mappingSource and mappingConfidence on every mapping edge

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, refusalCase, frameworkMutationTwin, scenarioTwin, edgesOf, blockOf } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const vocabularyLib = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));
const judgeProviderRegistryLib = require(path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'judgeProviderRegistry'));

const { MAPPING_KIND, MAPPING_KIND_BY_RESOLUTION, MAPPING_KIND_BY_MAPPING_SOURCE_FAMILY, MAPPING_SOURCE_FAMILY, MAPPING_SOURCE_FAMILY_BY_AUTHORED_MATCH_BASIS, composeMappingSource, mappingSourceRefusal, mappingSourceFamilyOf } = vocabularyLib;

const twinRegistry = makeTwinRegistry();
const MATERIALISER_FILE = 'materialiser.js';
const CERTIFICATION_FILE = 'certificationCheck.js';
const SEAM_RULES_FILE = 'graphSeamRules.js';
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const UNREGISTERED_PROVIDER_NAME = 'unregisteredJudge';
// the debug judge's mappingSource, read from where the production readers read it
const { DEBUG_MAPPING_SOURCE } = require('../certificationCheck');

// derivedShape — test-bgDerived's own scenario edit: the toy graph's vectors gain the declared model, and the derived plugin
// is the bridge. Restated here (eight lines) rather than required, because test-bgDerived is a suite, not a support module.
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
const realClientShape = (scenario) => {
	scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({});
};

// seamWrapShape — a writer wrapper that lays a property mutation over every edge BEFORE the rule-checked writer sees it.
// No bypass past the seam: the seam's own refusal is what the conjunct reads.
const seamWrapShape = (mutateProperties) => (scenario) => {
	realClientShape(scenario);
	scenario.graphWriterFactoryOverride = (graphDouble) => (writerArgs) => {
		const inner = graphDouble.graphWriterFactory(writerArgs);
		return { writeMappingEdge: (edgeArgs, callback) => inner.writeMappingEdge({ ...edgeArgs, edgeProperties: mutateProperties({ ...edgeArgs.edgeProperties }) }, callback), close: inner.close };
	};
};

// writerPastSeamTwin — a twin whose writer lays a mutation over every edge and, when the seam refuses it, writes it PAST the
// seam into the double's state: a writer that does not check. The RUN conjunct must then catch the fault on the graph.
const writerPastSeamTwin = ({ conjunctId, twinName, mutateProperties }) =>
	scenarioTwin({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId, twinName, leverKind: 'productionMutation', mutate: (scenario) => {
		scenario.graphWriterFactoryOverride = (graphDouble) => (writerArgs) => {
			const inner = graphDouble.graphWriterFactory(writerArgs);
			return {
				writeMappingEdge: ({ subjectStableId, objectStableId, edgeType, edgeProperties }, callback) => {
					const mutatedProperties = mutateProperties({ ...edgeProperties });
					inner.writeMappingEdge({ subjectStableId, objectStableId, edgeType, edgeProperties: mutatedProperties }, (writeError) => {
						if (writeError) {
							const pastSeamEdge = { fromStableId: subjectStableId, toStableId: objectStableId, type: edgeType, properties: mutatedProperties };
							graphDouble.state.edgeList.push(pastSeamEdge);
							graphDouble.state.writtenEdgeList.push(pastSeamEdge);
						}
						callback('', { edgeWritten: true });
					});
				},
				close: inner.close,
			};
		};
	} });

// sourceFaultList — what is wrong with one edge's kind/source pair, as text; [] when it is right
const sourceFaultList = (oneEdge) => {
	const edgeProperties = oneEdge.properties;
	const sourceRefusal = mappingSourceRefusal(edgeProperties.mappingSource);
	return []
		.concat(MAPPING_KIND_BY_RESOLUTION[edgeProperties.resolution] === edgeProperties.mappingKind ? [] : [`mappingKind ${JSON.stringify(edgeProperties.mappingKind)} on a ${edgeProperties.resolution} edge`])
		.concat(sourceRefusal ? [sourceRefusal] : [])
		.concat(!sourceRefusal && MAPPING_KIND_BY_MAPPING_SOURCE_FAMILY[mappingSourceFamilyOf(edgeProperties.mappingSource)] !== edgeProperties.mappingKind ? [`mappingSource '${edgeProperties.mappingSource}' is not a ${edgeProperties.mappingKind} source`] : [])
		.concat(Object.prototype.hasOwnProperty.call(edgeProperties, 'provenanceTier') ? [`carries provenanceTier ${JSON.stringify(edgeProperties.provenanceTier)}`] : []);
};
const verdictOver = ({ edgeList, faultListFor, emptyDetail }) => {
	if (edgeList.length === 0) {
		return { pass: false, detail: emptyDetail };
	}
	const faultedList = edgeList.map((oneEdge) => ({ oneEdge, faultList: faultListFor(oneEdge) })).filter((oneCheck) => oneCheck.faultList.length > 0);
	return faultedList.length === 0
		? { pass: true, detail: `${edgeList.length} edge(s), all as required` }
		: { pass: false, detail: `${faultedList.length} of ${edgeList.length}: ${faultedList[0].oneEdge.fromStableId}: ${faultedList[0].faultList.join('; ')}` };
};
const judgedEdgesOf = (outcome) => edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'judged');
const specifiedEdgesOf = (outcome) => edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'specified');

// ---------------------------------------------------------------------
// BG-PROV — the edges
// ---------------------------------------------------------------------
const provConjunctList = [
	runConjunct({ conjunctId: 'a_kindAndSourceOnEveryEdge', title: 'every edge carries a mappingKind its resolution permits, a mappingSource whose family permits that kind, and no provenanceTier', twinNameList: ['stripMappingKindPastSeam'], judge: succeeded((runReport, outcome) =>
		verdictOver({ edgeList: edgesOf(outcome), faultListFor: sourceFaultList, emptyDetail: 'no edge was written, so nothing was checked' })) }),
	runConjunct({ conjunctId: 'b_judgedEdgeNamesRegisteredJudge', title: "a judged edge's mappingSource is 'bridge-' + the REGISTERED provider that minted its mappingTool, and its mappingConfidence EQUALS its confidence", twinNameList: ['literalJudgeName'], shape: realClientShape, judge: succeeded((runReport, outcome) =>
		verdictOver({ edgeList: judgedEdgesOf(outcome), emptyDetail: 'no judged edge was written', faultListFor: (oneEdge) => {
			const owner = judgeProviderRegistryLib.providerNameForJudgeModel(oneEdge.properties.mappingTool);
			const expectedSource = owner.error ? `(no registered provider: ${owner.error})` : composeMappingSource({ family: MAPPING_SOURCE_FAMILY.BRIDGE, sourceName: owner.providerName });
			return []
				.concat(oneEdge.properties.mappingSource === expectedSource ? [] : [`mappingSource '${oneEdge.properties.mappingSource}', expected '${expectedSource}'`])
				.concat(oneEdge.properties.mappingConfidence === oneEdge.properties.confidence ? [] : [`mappingConfidence ${oneEdge.properties.mappingConfidence} ≠ confidence ${oneEdge.properties.confidence}`]);
		} })) }),
	runConjunct({ conjunctId: 'c_specifiedEdgeNamesDocument', title: "a specified edge's mappingSource is '<family by matchBasis>-' + the block's bridgeName, and it carries NO mappingConfidence key", twinNameList: ['mappingConfidenceOnSpecifiedPastSeam'], judge: succeeded((runReport, outcome) => {
		const block = blockOf(outcome);
		const expectedSource = block === null ? '(no block)' : composeMappingSource({ family: MAPPING_SOURCE_FAMILY_BY_AUTHORED_MATCH_BASIS[block.header.matchBasis], sourceName: block.header.bridgeName });
		return verdictOver({ edgeList: specifiedEdgesOf(outcome), emptyDetail: 'no specified edge was written', faultListFor: (oneEdge) =>
			[]
				.concat(oneEdge.properties.mappingSource === expectedSource ? [] : [`mappingSource '${oneEdge.properties.mappingSource}', expected '${expectedSource}'`])
				.concat(Object.prototype.hasOwnProperty.call(oneEdge.properties, 'mappingConfidence') ? [`carries mappingConfidence ${JSON.stringify(oneEdge.properties.mappingConfidence)}`] : []) });
	}) }),
	runConjunct({ conjunctId: 'd_derivedEdgesInferredNoTier', title: "a derived block judged by a real client: every edge mappingKind 'inferred' and NO provenanceTier key (retired from mapping edges, TQ 2026-10-04)", twinNameList: ['provenanceTierStampedAgain'], shape: (scenario) => { derivedShape(scenario); realClientShape(scenario); }, judge: succeeded((runReport, outcome) =>
		verdictOver({ edgeList: edgesOf(outcome), emptyDetail: 'the derived run wrote no edge', faultListFor: (oneEdge) =>
			[]
				.concat(oneEdge.properties.mappingKind === MAPPING_KIND.INFERRED ? [] : [`mappingKind ${JSON.stringify(oneEdge.properties.mappingKind)}`])
				.concat(Object.prototype.hasOwnProperty.call(oneEdge.properties, 'provenanceTier') ? [`provenanceTier ${JSON.stringify(oneEdge.properties.provenanceTier)}`] : []) })) }),

	// ---- the write seam, each refusal BY NAME; each twin removes or blinds the refusal so a different outcome appears ----
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'e_absentKindRefused', title: 'an edge without mappingKind is REFUSED at the write seam by name',
		shape: seamWrapShape((edgeProperties) => { delete edgeProperties.mappingKind; return edgeProperties; }), regex: /edge property 'mappingKind' is absent/,
		twinName: 'kindNotRequired', fileName: SEAM_RULES_FILE, find: '\tMAPPING_PROPERTIES.MAPPING_KIND,\n\tMAPPING_PROPERTIES.MAPPING_SOURCE,\n]);', replace: '\tMAPPING_PROPERTIES.MAPPING_SOURCE,\n]);' }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'f_unknownKindRefused', title: "a mappingKind outside MAPPING_KIND_LIST ('guessed') is REFUSED at the write seam by name",
		shape: seamWrapShape((edgeProperties) => ({ ...edgeProperties, mappingKind: 'guessed' })), regex: /mappingKind "guessed" is not in MAPPING_KIND_LIST/,
		twinName: 'kindVocabularyUnchecked', fileName: SEAM_RULES_FILE, find: '\tif (MAPPING_KIND_LIST.indexOf(edgeProperties.mappingKind) === -1) {', replace: '\tif (MAPPING_KIND_LIST.indexOf(edgeProperties.mappingKind) === -2) {' }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'g_kindResolutionDisagreementRefused', title: "a judged edge claiming mappingKind 'authored' is REFUSED at the write seam by name",
		shape: seamWrapShape((edgeProperties) => (edgeProperties.resolution === 'judged' ? { ...edgeProperties, mappingKind: vocabularyLib.MAPPING_KIND.AUTHORED } : edgeProperties)), regex: /mappingKind 'authored' disagrees with resolution 'judged'/,
		twinName: 'kindResolutionUnchecked', fileName: SEAM_RULES_FILE, find: '\tif (MAPPING_KIND_BY_RESOLUTION[edgeProperties.resolution] !== edgeProperties.mappingKind) {', replace: '\tif (false) {' }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'h_sourceWithoutFamilyRefused', title: "a mappingSource with no family ('judge-jev') is REFUSED at the write seam by name",
		shape: seamWrapShape((edgeProperties) => ({ ...edgeProperties, mappingSource: 'judge-jev' })), regex: /mappingSource 'judge-jev' does not begin with a family/,
		twinName: 'sourceShapeUnchecked', fileName: SEAM_RULES_FILE, find: '\tconst sourceRefusal = mappingSourceRefusal(edgeProperties.mappingSource);', replace: "\tconst sourceRefusal = '';" }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'i_unregisteredJudgeSourceRefused', title: `a judged edge whose mappingSource names an unregistered judge ('bridge-${UNREGISTERED_PROVIDER_NAME}') is REFUSED at the write seam by name`,
		shape: seamWrapShape((edgeProperties) => (edgeProperties.resolution === 'judged' ? { ...edgeProperties, mappingSource: composeMappingSource({ family: MAPPING_SOURCE_FAMILY.BRIDGE, sourceName: UNREGISTERED_PROVIDER_NAME }) } : edgeProperties)), regex: new RegExp(`names '${UNREGISTERED_PROVIDER_NAME}', which is not registered for the 'bridge' family`),
		twinName: 'judgeRegistryUnchecked', fileName: SEAM_RULES_FILE, find: '\tif (registeredSourceNameList !== undefined && registeredSourceNameList.indexOf(sourceName) === -1) {', replace: '\tif (false) {' }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'j_judgedWithoutMappingConfidenceRefused', title: 'a judged edge without mappingConfidence is REFUSED at the write seam by name',
		shape: seamWrapShape((edgeProperties) => { if (edgeProperties.resolution === 'judged') { delete edgeProperties.mappingConfidence; } return edgeProperties; }), regex: /a judged edge lacks 'mappingConfidence'/,
		twinName: 'mappingConfidenceNotJudgedOnly', fileName: SEAM_RULES_FILE, find: ', MAPPING_PROPERTIES.MAPPING_TOOL_VERSION, MAPPING_PROPERTIES.MAPPING_CONFIDENCE]);', replace: ', MAPPING_PROPERTIES.MAPPING_TOOL_VERSION]);' }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'k_specifiedCarryingMappingConfidenceRefused', title: 'a specified edge carrying mappingConfidence (1.0) is REFUSED at the write seam by name — a document asserts, it is not sure',
		shape: seamWrapShape((edgeProperties) => (edgeProperties.resolution === 'specified' ? { ...edgeProperties, mappingConfidence: 1.0 } : edgeProperties)), regex: /a specified edge carries 'mappingConfidence'/,
		twinName: 'mappingConfidenceAllowedOnSpecified', fileName: SEAM_RULES_FILE, find: ', MAPPING_PROPERTIES.MAPPING_TOOL_VERSION, MAPPING_PROPERTIES.MAPPING_CONFIDENCE]);', replace: ', MAPPING_PROPERTIES.MAPPING_TOOL_VERSION]);' }),

	// ---- the materialiser ----
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'l_unregisteredJudgeModelRefusedBeforeWrite', title: 'a judged record whose judge model NO registered provider minted is REFUSED by the materialiser, by name, before any edge is written',
		shape: (scenario) => {
			const fakeClient = scenarioLib.makeFakeRealClient({});
			fakeClient.name = UNREGISTERED_PROVIDER_NAME;
			fakeClient.model = `${UNREGISTERED_PROVIDER_NAME}:${fakeClient.wireModel}`;
			scenario.judgeClientOverride = fakeClient;
		}, regex: new RegExp(`mappingSource: judgeProviderRegistry: judge model '${UNREGISTERED_PROVIDER_NAME}:`),
		twinName: 'materialiserSourceCheckRemoved', fileName: MATERIALISER_FILE, find: '\tif (unsourcedPlanned !== undefined) {', replace: '\tif (false) {' }),

	// ---- the debug marker, and the retired tier ----
	runConjunct({ conjunctId: 'm_debugJudgeEdgesMarkedBySourceAndZeroConfidence', title: "under the DEBUG judge (the toy default, rule 'digest') every judged edge is mappingKind 'inferred', mappingSource 'bridge-debug', mappingConfidence 0; every specified edge stays authored", twinNameList: ['debugConfidenceNotFixed'], judge: succeeded((runReport, outcome) =>
		verdictOver({ edgeList: edgesOf(outcome), emptyDetail: 'the debug run wrote no edge', faultListFor: (oneEdge) =>
			oneEdge.properties.resolution === 'judged'
				? []
					.concat(oneEdge.properties.mappingKind === MAPPING_KIND.INFERRED ? [] : [`judged edge with mappingKind ${JSON.stringify(oneEdge.properties.mappingKind)}`])
					.concat(oneEdge.properties.mappingSource === DEBUG_MAPPING_SOURCE ? [] : [`judged edge with mappingSource ${JSON.stringify(oneEdge.properties.mappingSource)}`])
					.concat(oneEdge.properties.mappingConfidence === 0 ? [] : [`judged debug edge with mappingConfidence ${JSON.stringify(oneEdge.properties.mappingConfidence)}`])
				: oneEdge.properties.mappingKind === MAPPING_KIND.AUTHORED ? [] : [`specified edge with mappingKind ${JSON.stringify(oneEdge.properties.mappingKind)}`] })) }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'n_provenanceTierOnMappingEdgeRefusedAsRetired', title: 'a mapping edge carrying provenanceTier is REFUSED at the write seam by its RETIREMENT reason, not merely as an unknown name',
		shape: seamWrapShape((edgeProperties) => ({ ...edgeProperties, provenanceTier: 'embedding-inferred' })), regex: /a mapping edge carries 'provenanceTier' \("embedding-inferred"\) — provenanceTier is RETIRED from mapping edges/,
		twinName: 'retirementReasonRemoved', fileName: SEAM_RULES_FILE, find: '\tif (retiredName !== undefined) {', replace: '\tif (false) {' }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'o_debugEdgeConfidenceHeldToZero', title: "a 'bridge-debug' edge carrying mappingConfidence 0.9 is REFUSED at the write seam by name: the debug judge may not look sure",
		shape: (scenario) => { const wrap = seamWrapShape((edgeProperties) => (edgeProperties.mappingSource === DEBUG_MAPPING_SOURCE ? { ...edgeProperties, mappingConfidence: 0.9 } : edgeProperties)); wrap(scenario); scenario.judgeClientOverride = null; },
		regex: /a 'bridge-debug' edge carries mappingConfidence 0\.9, not its fixed 0/,
		twinName: 'fixedConfidenceUnchecked', fileName: SEAM_RULES_FILE, find: '\tif (fixedConfidence !== undefined && edgeProperties.mappingConfidence !== fixedConfidence) {', replace: '\tif (false) {' }),
	pureConjunct({ conjunctId: 'p_certificationRefusesSourcelessEdge', title: 'the certification check REFUSES, by name, a harvested mapping edge with NO mappingSource (it cannot be told from a debug edge)', twinNameList: ['sourcelessEdgeCertified'], judge: (scenario) => {
		const certificationMutationList = scenario.frameworkMutationList.filter((oneMutation) => oneMutation.modulePath.endsWith(CERTIFICATION_FILE));
		const certificationCheckLib = certificationMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CERTIFICATION_FILE), mutationList: certificationMutationList }) : require('../certificationCheck');
		const refusal = certificationCheckLib.debugEdgeRefusal({ harvestedEdgeList: [{ fromStableId: 'toy:a', toStableId: 'toyhub:b', type: 'EXACT_MATCH', properties: { mappingKind: ['inferred'] } }], blockLabel: 'BridgedRelation_TOY_TOYHUB' });
		return { pass: refusal !== null && /carries 1 edge\(s\) with NO mappingSource/.test(refusal.message), detail: refusal === null ? 'certified an edge with no mappingSource' : refusal.message.slice(0, 160) };
	} }),
];
writerPastSeamTwin({ conjunctId: 'a_kindAndSourceOnEveryEdge', twinName: 'stripMappingKindPastSeam', mutateProperties: (edgeProperties) => { delete edgeProperties.mappingKind; return edgeProperties; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'b_judgedEdgeNamesRegisteredJudge', twinName: 'literalJudgeName', fileName: MATERIALISER_FILE,
	find: 'sourceName: owner.providerName })', replace: "sourceName: 'jev' })" });
writerPastSeamTwin({ conjunctId: 'c_specifiedEdgeNamesDocument', twinName: 'mappingConfidenceOnSpecifiedPastSeam', mutateProperties: (edgeProperties) => (edgeProperties.resolution === 'specified' ? { ...edgeProperties, mappingConfidence: 1.0 } : edgeProperties) });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'd_derivedEdgesInferredNoTier', twinName: 'provenanceTierStampedAgain', fileName: MATERIALISER_FILE,
	find: '\t\t[MAPPING_PROPERTIES.MAPPING_KIND]: MAPPING_KIND_BY_RESOLUTION[record.resolution],', replace: "\t\t[MAPPING_PROPERTIES.MAPPING_KIND]: MAPPING_KIND_BY_RESOLUTION[record.resolution],\n\t\tprovenanceTier: 'embedding-inferred'," });
writerPastSeamTwin({ conjunctId: 'm_debugJudgeEdgesMarkedBySourceAndZeroConfidence', twinName: 'debugConfidenceNotFixed', mutateProperties: (edgeProperties) => (edgeProperties.mappingSource === DEBUG_MAPPING_SOURCE ? { ...edgeProperties, mappingConfidence: edgeProperties.confidence } : edgeProperties) });

frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PROV', conjunctId: 'p_certificationRefusesSourcelessEdge', twinName: 'sourcelessEdgeCertified', fileName: CERTIFICATION_FILE, find: '\tif (unkindedList.length > 0) {', replace: '\tif (false) {' });

const gateDeclarationList = [{ gateId: 'BG-PROV', title: 'mappingKind, mappingSource, mappingConfidence: who made the claim and how sure', conjunctList: provConjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-PROV', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 4 + 7 + 1 + 4 },
	() => harness.report(),
);
