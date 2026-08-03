#!/usr/bin/env node
'use strict';

// runCedsHubBridgeGates.js — hubReimplementation PHASE 3 gate runner: the FAMILY-E bridge/evidence
// gates G-14 (promptClean), G-15 (noCandidateReembed), G-17 (dmeShape), declared in
// forges/ceds/gates/hubGates.jsonc and judged by the SAME roundTripGates harness as every other
// family. Each runner judges the declarations whose measures it supplies — this one judges the
// bridge:-prefixed declarations only.
//
// WHY THIS IS NOT NAMED test-*.js (deliberate, stated): runAllTests discovers test-*.js suites and
// runs them hermetically. THIS runner is NOT hermetic by design — it requires:
//   1. the LIVE Phase-2 graph (docker container DEV_cedsHubV2_080326, bolt 7815; auth resolved at
//      runtime from `docker inspect`, never stored in the tree);
//   2. one REAL Voyage embed (the mini-bridge's single source element's composed embedText);
//   3. one REAL Opus judgment (the mini-bridge's single evidence selection, authorized spend).
// The evaluate-against-golden.js precedent: live-substrate provers live beside the suites without
// joining the sweep.
//
// RUN:  node --max-old-space-size=16384 forges/ceds/test/runCedsHubBridgeGates.js
// (the G-15 bridge run reads all 94,602 HubReference cards WITH their 1024-dim vectors into one
//  process — the heap flag is for that read, same class of need as the Phase-2 build's)
//
// G-15 SUBSTRATE DECISION (the workorder leaves the mini-bridge design to this phase; recorded here
// and in the DEVLOG): DIRECT BRIDGE INVOCATION against DEV_cedsHubV2_080326 — the workorder's own
// sanctioned option — via the REAL bridgeMaker.run (real kit, real graph reader/writer, real
// decision freeze, real judgment). The graph is CEDS-only, so the runner first MERGEs ONE real LIF
// source element (Assessment.shortName, prose verbatim from
// forges/lif/assets/standardSourceData/01/data_model_1_bare_openapi_schema.1.json) plus its owning
// class node, both stableId-prefixed 'lif:phase3G15:' so they are unmistakably this gate's fixtures
// (ADDITIVE — nothing pre-existing is modified; the bridge's own edges land under applyLabel
// 'phase3G15MiniBridge'). The embed counter sits AT THE EMBEDDING-CLIENT SEAM: a counting proxy
// AROUND the real embedding client, injected through the vectorizer's embeddingClientFactory seam,
// so every embedTexts call the run makes is observed at the one place they all pass through.
//
// House style: qtools; callback(errString, result); taskListPlus/pipeRunner; no async/await, no
// try/catch for control flow (two one-place adapters over throwing APIs — docker inspect and the
// neo4j driver session — follow the parseJsonOrFault precedent, each contained and named).

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hubReimplementation Phase 3 FAMILY-E gate runner (G-14, G-15, G-17)

SYNOPSIS
     node --max-old-space-size=16384 forges/ceds/test/${moduleName}.js [-verbose] [-quiet] [-help]

DESCRIPTION
     Judges the bridge:-measured gates of hubGates.jsonc against the LIVE Phase-2 graph
     (DEV_cedsHubV2_080326): G-14 renders REAL cards and sweeps the bridge sources for the retired
     caveat string; G-15 runs a LIVE one-source mini-bridge (real Voyage embed for the source, real
     Opus judgment) with a counting proxy at the embedding-client seam proving ZERO candidate
     embeds; G-17 proves the DME shape contract (role, six edge types, canonicalKey semantics)
     against the graph and the five DME reader files. NOT hermetic; never joins runAllTests.

EXIT STATUS
     0 all gates PASS with twins observed RED;  1 otherwise.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const { xLog } = process.global;

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const BRIDGE_MAKER_DIR = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker');

const gatesLib = require('../lib/roundTripGates')();
const DECLARATIONS_PATH = path.join(__dirname, '..', 'gates', 'hubGates.jsonc');

const bridgeMaker = require(path.join(BRIDGE_MAKER_DIR, 'bridgeMaker'))();
const { flattenFullRecord } = require(path.join(BRIDGE_MAKER_DIR, 'lib.d', 'sourceWalker'));
const cedsHubModuleFactory = require(path.join(BRIDGE_MAKER_DIR, 'lib.d', 'cedsHubModule'));
const evidenceRendererFactory = require(path.join(BRIDGE_MAKER_DIR, 'lib.d', 'evidenceRenderer'));
const { composeSourceEmbedText } = require(path.join(BRIDGE_MAKER_DIR, 'lib', 'facetScan'));
const decisionStoreFactory = require(path.join(TREE_ROOT, 'lib', 'decision-store', 'decision-store'));
const llmClientFactory = require(path.join(BRIDGE_MAKER_DIR, 'lib', 'llmClient'));
const realEmbeddingClientFactory = require(path.join(TREE_ROOT, 'lib', 'embedding', 'embedding-client'));
const neo4j = require(path.join(TREE_ROOT, 'node_modules', 'neo4j-driver'));

const hubModule = cedsHubModuleFactory();
const { renderCandidateBlock } = evidenceRendererFactory;

// =====================================================================================
// THE LIVE GRAPH — Phase 2's product, addressed by name; the credential is resolved from
// docker at run time (it lives in the container env, never in this tree).
// =====================================================================================
const GRAPH_CONTAINER_NAME = 'DEV_cedsHubV2_080326';
const GRAPH_BOLT_PORT = 7815;
const GRAPH_HTTP_PORT = 7816;
const GRAPH_BOLT_URL = `bolt://localhost:${GRAPH_BOLT_PORT}`;

// resolveGraphPassword — one-place adapter over the throwing execFileSync API (the
// parseJsonOrFault precedent): returns { password } or { error }, never lets the throw escape.
const resolveGraphPassword = () => {
	let rawEnvText;
	try {
		rawEnvText = execFileSync(
			'docker',
			['inspect', GRAPH_CONTAINER_NAME, '--format', '{{range .Config.Env}}{{println .}}{{end}}'],
			{ encoding: 'utf8' },
		);
	} catch (dockerError) {
		return { error: `docker inspect ${GRAPH_CONTAINER_NAME} failed: ${dockerError.message}` };
	}
	const authLine = rawEnvText.split('\n').find((oneLine) => oneLine.indexOf('NEO4J_AUTH=') === 0);
	if (!authLine) {
		return { error: `container ${GRAPH_CONTAINER_NAME} carries no NEO4J_AUTH env` };
	}
	const password = authLine.slice('NEO4J_AUTH='.length).split('/')[1];
	if (!password) {
		return { error: `NEO4J_AUTH on ${GRAPH_CONTAINER_NAME} parsed to no password` };
	}
	return { password };
};

// runCypher — one-place adapter over the promise-shaped neo4j driver: callback(errString, records).
const makeCypherRunner = (driver) => (cypherText, parameters, callback) => {
	const session = driver.session();
	session
		.run(cypherText, parameters)
		.then((result) => {
			session.close().then(() => callback('', result.records));
		})
		.catch((queryError) => {
			session.close().then(() => callback(`cypher failed: ${queryError.message}`));
		});
};

// nodeRecordFrom — a raw driver node -> the { stableId, properties } shape flattenFullRecord reads.
const nodeRecordFrom = (rawNode) => ({ stableId: rawNode.properties.stableId, properties: rawNode.properties });

// =====================================================================================
// MEASURE COMPUTERS — each takes exactly the facts it judges, so the twin registry can
// re-run it over a corrupted clone (the Phase-1/Phase-2 pattern).
// =====================================================================================

const CAVEAT_STRING = 'may be incomplete';

// computePromptCleanViolations — G-14. renderedBlocks: [{ cardLabel, hubModuleError, blockText,
// requiredDomainLine, requiredDefinitionFragment }]. caveatSweepHits: [{ filePath, count }].
const computePromptCleanViolations = ({ renderedBlocks, caveatSweepHits }) => {
	const violations = [];
	renderedBlocks.forEach((oneBlock) => {
		if (oneBlock.hubModuleError) {
			violations.push(`${oneBlock.cardLabel}: hubModule refused the card: ${oneBlock.hubModuleError}`);
			return;
		}
		if (oneBlock.blockText.indexOf(oneBlock.requiredDomainLine) === -1) {
			violations.push(
				`${oneBlock.cardLabel}: rendered block lacks the domain-name line '${oneBlock.requiredDomainLine}'`,
			);
		}
		if (
			oneBlock.requiredDefinitionFragment &&
			oneBlock.blockText.indexOf(oneBlock.requiredDefinitionFragment) === -1
		) {
			violations.push(
				`${oneBlock.cardLabel}: rendered block lacks the definition fragment '${oneBlock.requiredDefinitionFragment.slice(0, 60)}'`,
			);
		}
		// SF-2: the qualifier line is asserted at GATE level for the qualified sample, not only in
		// the unit suite — a qualified card whose block loses its qualifier context is a G-14 red.
		if (
			oneBlock.requiredQualifierFragment &&
			oneBlock.blockText.indexOf(oneBlock.requiredQualifierFragment) === -1
		) {
			violations.push(
				`${oneBlock.cardLabel}: rendered block lacks the qualifier-line fragment '${oneBlock.requiredQualifierFragment}'`,
			);
		}
		if (oneBlock.blockText.indexOf(CAVEAT_STRING) !== -1) {
			violations.push(`${oneBlock.cardLabel}: rendered block still contains '${CAVEAT_STRING}'`);
		}
	});
	caveatSweepHits.forEach((oneHit) => {
		violations.push(`source file ${oneHit.filePath} contains '${CAVEAT_STRING}' x${oneHit.count}`);
	});
	return violations;
};

// computeCandidateReembedViolations — G-15. embeddedTexts: every text observed crossing the
// embedding-client seam during the mini-bridge run; expectedSourceEmbedTexts: the run's source
// embedTexts, INDEPENDENTLY recomposed from the inserted source element's own prose.
const computeCandidateReembedViolations = ({ embeddedTexts, expectedSourceEmbedTexts }) => {
	const violations = [];
	if (embeddedTexts.length === 0) {
		violations.push('the embedding-client seam counter never fired — an unfired counter proves nothing (vacuous)');
		return violations;
	}
	const expectedSet = new Set(expectedSourceEmbedTexts);
	embeddedTexts.forEach((oneText) => {
		if (!expectedSet.has(oneText)) {
			violations.push(
				`a NON-SOURCE text crossed the embedding-client seam (a candidate re-embed or an unknown ` +
					`embed): '${`${oneText}`.slice(0, 80)}...'`,
			);
		}
	});
	return violations;
};

// computeDmeShapeViolations — G-17. graphShapeFacts from the live graph; dmeReaderRequirements
// from the five DME reader files (the SEPARATE educore repo).
const DME_EDGE_TYPE_NAMES = Object.freeze([
	'IN_HUB',
	'HAS_CEDS_DOMAIN',
	'HAS_CEDS_PROPERTY',
	'HAS_CEDS_RANGE',
	'HAS_CEDS_VALUE',
	'HAS_CEDS_QUALIFIER',
]);

const computeDmeShapeViolations = ({ graphShapeFacts, dmeReaderRequirements }) => {
	const violations = [];
	if (!(graphShapeFacts.cardCount > 0)) {
		violations.push(`role HubReference: ${graphShapeFacts.cardCount} cards found — the role is absent`);
	}
	DME_EDGE_TYPE_NAMES.forEach((oneEdgeTypeName) => {
		const edgeCount = graphShapeFacts.edgeCounts[oneEdgeTypeName];
		if (!(edgeCount > 0)) {
			violations.push(`edge type ${oneEdgeTypeName}: ${edgeCount === undefined ? 'ABSENT' : edgeCount} — the DME shape requires it`);
		}
	});
	if (graphShapeFacts.canonicalKeyCount !== graphShapeFacts.cardCount) {
		violations.push(
			`canonicalKey coverage: ${graphShapeFacts.canonicalKeyCount} of ${graphShapeFacts.cardCount} cards — semantics changed`,
		);
	}
	if (graphShapeFacts.propertyPrefixCount !== graphShapeFacts.propertyTierCount) {
		violations.push(
			`property-tier P-prefix: ${graphShapeFacts.propertyPrefixCount} of ${graphShapeFacts.propertyTierCount}`,
		);
	}
	if (graphShapeFacts.valuePrefixCount !== graphShapeFacts.valueTierCount) {
		violations.push(`value-tier OV-prefix: ${graphShapeFacts.valuePrefixCount} of ${graphShapeFacts.valueTierCount}`);
	}
	dmeReaderRequirements.forEach((oneRequirement) => {
		if (oneRequirement.fileMissing) {
			violations.push(`DME reader file missing on disk: ${oneRequirement.filePath} — its shape needs cannot be verified`);
			return;
		}
		oneRequirement.requiredNames.forEach((oneRequiredName) => {
			const nameSatisfied =
				oneRequiredName === 'HubReference'
					? graphShapeFacts.cardCount > 0
					: oneRequiredName === 'canonicalKey'
						? graphShapeFacts.canonicalKeyCount > 0
						: graphShapeFacts.edgeCounts[oneRequiredName] > 0;
			if (!nameSatisfied) {
				violations.push(
					`DME reader ${path.basename(oneRequirement.filePath)} requires '${oneRequiredName}' — absent from the graph`,
				);
			}
		});
	});
	return violations;
};

// =====================================================================================
// G-14 FIXTURES — the caveat sweep scope (the bridge/evidence sources §6 touched, plus the
// whole bridge-maker lib/lib.d and every forge bridge dir) and the OLD-shape twin card.
// =====================================================================================
const CAVEAT_SWEEP_DIRS = [
	path.join(BRIDGE_MAKER_DIR, 'lib'),
	path.join(BRIDGE_MAKER_DIR, 'lib.d'),
	path.join(BRIDGE_MAKER_DIR, 'bridges'),
	path.join(TREE_ROOT, 'forges', 'bridges'),
	path.join(TREE_ROOT, 'forges', 'case', 'bridges'),
	path.join(TREE_ROOT, 'forges', 'ctdl', 'bridges'),
	path.join(TREE_ROOT, 'forges', 'sif', 'bridges'),
];

// sweepForCaveatString — SF-3: RECURSIVE over every CAVEAT_SWEEP_DIRS root, all .js files at any
// depth (a caveat resurrected in a new subdirectory must not escape the sweep by nesting).
//
// ⚠ THE TRAP THIS CLOSED LIST CARRIES (the R-P3-1 registry discipline, applied to its sibling):
// CAVEAT_SWEEP_DIRS is a CLOSED list of roots. A future bridge/evidence module that lives OUTSIDE
// these roots is silently unswept — the gate would report clean while the caveat string lives on in
// a directory nobody enrolled. When a new bridge home is created anywhere in the tree, add its root
// HERE, and prove the addition by planting-and-detecting the string once in a scratch file.
const sweepForCaveatString = () => {
	const hits = [];
	const sweepOneDir = (oneDirPath) => {
		if (!fs.existsSync(oneDirPath)) {
			return;
		}
		fs.readdirSync(oneDirPath, { withFileTypes: true }).forEach((oneEntry) => {
			const entryPath = path.join(oneDirPath, oneEntry.name);
			if (oneEntry.isDirectory()) {
				if (oneEntry.name === 'node_modules') {
					return;
				}
				sweepOneDir(entryPath);
				return;
			}
			if (!/\.js$/.test(oneEntry.name)) {
				return;
			}
			const fileText = fs.readFileSync(entryPath, 'utf8');
			const count = fileText.split(CAVEAT_STRING).length - 1;
			if (count > 0) {
				hits.push({ filePath: entryPath, count });
			}
		});
	};
	CAVEAT_SWEEP_DIRS.forEach(sweepOneDir);
	return hits;
};

// OLD_SHAPE_TWIN_CARD — the retired card shape (no meaning fields, suffix-named qualifier, no
// qualifierNames). The G-14 twin renders "against" this and the gate is observed RED because the
// revised hub module refuses it — an old-shape fixture can no longer produce a passing block.
const OLD_SHAPE_TWIN_CARD = {
	referenceTier: 'property',
	canonicalKey: 'P600502',
	propertyKey: 'P600502',
	name: 'Has Organization Identifier [Federal School Code]',
	domainId: 'C200239',
	rangeClassId: 'C200252',
	qualifierKeys: ['OV_federalSchoolCode'],
	allDomainIds: ['C200239'],
	allDomainNames: ['Organization'],
};

// =====================================================================================
// G-17 — the five DME reader files (PLAN §10.6; a SEPARATE repo and a shipped product).
// =====================================================================================
const DME_CODE_ROOT = '/Users/tqwhite/Documents/webdev/educore/system/code';
const DME_READER_FILE_PATHS = [
	path.join(DME_CODE_ROOT, 'cli', 'lib.d', 'data-model-explorer', 'dataModelExplorerSearch.js'),
	path.join(DME_CODE_ROOT, 'server', 'lib', 'schema-provider.js'),
	path.join(DME_CODE_ROOT, 'cli', 'lib.d', 'index-data-model-explorer-for-milo', 'lib', 'traversalGenerator.js'),
	path.join(DME_CODE_ROOT, 'server', 'data-model', 'data-mapping', 'mappers', 'dme-slack.js'),
	path.join(DME_CODE_ROOT, 'html', 'pages', 'dm', 'explorer.vue'),
];
const DME_GREPPABLE_NAMES = Object.freeze(['HubReference', 'canonicalKey', ...DME_EDGE_TYPE_NAMES]);

const readDmeReaderRequirements = () =>
	DME_READER_FILE_PATHS.map((oneFilePath) => {
		if (!fs.existsSync(oneFilePath)) {
			return { filePath: oneFilePath, fileMissing: true, requiredNames: [] };
		}
		const fileText = fs.readFileSync(oneFilePath, 'utf8');
		return {
			filePath: oneFilePath,
			fileMissing: false,
			requiredNames: DME_GREPPABLE_NAMES.filter((oneName) => fileText.indexOf(oneName) !== -1),
		};
	});

// =====================================================================================
// G-15 — the mini-bridge fixtures: ONE real LIF source element (prose verbatim from the LIF
// source data) + its owning class, both unmistakably labeled.
// =====================================================================================
const G15_STABLE_ID_PREFIX = 'lif:phase3G15:';
const G15_CLASS_STABLE_ID = `${G15_STABLE_ID_PREFIX}Assessment`;
const G15_PROPERTY_STABLE_ID = `${G15_STABLE_ID_PREFIX}Assessment.shortName`;
const G15_SOURCE_DESCRIPTION = 'An abbreviated title for an assessment.';
const G15_APPLY_LABEL = 'phase3G15MiniBridge';
const G15_DECISION_STORE_PATH = path.join(__dirname, 'test-artifacts', 'phase3G15.decisions.sqlite');
const ANTHROPIC_CONFIG_FILE_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/anthropicAi.ini';

// the EXPECTED source embedText, recomposed INDEPENDENTLY from the same prose the inserted node
// carries (the LIF Assessment class has no description in its source — slot 4 honestly empty).
const G15_EXPECTED_SOURCE_EMBED_TEXT = composeSourceEmbedText({
	owningClassName: 'Assessment',
	propertyName: 'shortName',
	description: G15_SOURCE_DESCRIPTION,
	owningClassDescription: '',
});

// =====================================================================================
// THE RUN
// =====================================================================================
const passwordResolution = resolveGraphPassword();
harness.section(`LIVE GRAPH — ${GRAPH_CONTAINER_NAME} @ ${GRAPH_BOLT_URL}`);
harness.ok('graph password resolves from docker inspect', !passwordResolution.error, passwordResolution.error);
if (passwordResolution.error) {
	harness.report();
	return;
}
const graphPassword = passwordResolution.password;
const driver = neo4j.driver(GRAPH_BOLT_URL, neo4j.auth.basic('neo4j', graphPassword));
const runCypher = makeCypherRunner(driver);

const inGraph = {
	graphName: GRAPH_CONTAINER_NAME,
	containerName: GRAPH_CONTAINER_NAME,
	boltUrl: GRAPH_BOLT_URL,
	password: graphPassword,
	boltPort: GRAPH_BOLT_PORT,
	httpPort: GRAPH_HTTP_PORT,
};

const taskList = new taskListPlus();

// ---- G-14 material: three REAL cards (property w/ definition, qualified, value-tier) ----
taskList.push((args, next) => {
	runCypher(
		`MATCH (n:ForgedNode {role:'HubReference', canonicalKey:'P001470'}) RETURN n LIMIT 1`,
		{},
		(err, records) => {
			if (err || records.length === 0) {
				next(err || 'P001470 card not found in the live graph', args);
				return;
			}
			next('', { ...args, propertyCardRecord: nodeRecordFrom(records[0].get('n')) });
		},
	);
});
taskList.push((args, next) => {
	// SF-2: the sampled qualified card must ALSO carry a propertyDefinition, so the definition
	// fragment is asserted on this block too — a qualified card sampled without prose would leave
	// the definition check vacuous for the qualified case.
	runCypher(
		`MATCH (n:ForgedNode {role:'HubReference'})
		 WHERE n.qualifierNames IS NOT NULL AND n.propertyDefinition IS NOT NULL
		 RETURN n LIMIT 1`,
		{},
		(err, records) => {
			if (err || records.length === 0) {
				next(err || 'no qualified card with a propertyDefinition found in the live graph', args);
				return;
			}
			next('', { ...args, qualifiedCardRecord: nodeRecordFrom(records[0].get('n')) });
		},
	);
});
taskList.push((args, next) => {
	runCypher(
		`MATCH (n:ForgedNode {role:'HubReference', referenceTier:'value'}) WHERE n.valueDefinition IS NOT NULL RETURN n LIMIT 1`,
		{},
		(err, records) => {
			if (err || records.length === 0) {
				next(err || 'no value-tier card with a valueDefinition found', args);
				return;
			}
			next('', { ...args, valueCardRecord: nodeRecordFrom(records[0].get('n')) });
		},
	);
});

// ---- G-14 measure: render each REAL card through the REAL hub module + renderer ----
taskList.push((args, next) => {
	const renderOneCard = (cardRecord, cardLabel) => {
		const flattened = flattenFullRecord(cardRecord);
		let hubModuleError = '';
		let blockText = '';
		hubModule(flattened, (hubErr, tuple) => {
			if (hubErr) {
				hubModuleError = hubErr;
				return;
			}
			blockText = renderCandidateBlock({ candidate: flattened, cosine: 0.5, considerations: { tuple, notes: [] } }, 1);
		});
		// SF-2: a qualified sample's qualifier line is a GATE requirement. The card's qualifierNames
		// arrive verbatim off the flatten (list, or PG-collapsed scalar); normalize for the fragment.
		const qualifierNamesList = Array.isArray(flattened.qualifierNames)
			? flattened.qualifierNames
			: flattened.qualifierNames === undefined || flattened.qualifierNames === null || flattened.qualifierNames === ''
				? []
				: [flattened.qualifierNames];
		return {
			cardLabel,
			hubModuleError,
			blockText,
			requiredDomainLine: `Domain: ${flattened.domainName} (${flattened.domainId})`,
			requiredDefinitionFragment:
				typeof flattened.propertyDefinition === 'string' ? flattened.propertyDefinition.slice(0, 60) : '',
			requiredQualifierFragment: qualifierNamesList.length
				? `Qualifier: ${flattened.propertyKey} [${qualifierNamesList.join(', ')}]`
				: '',
		};
	};
	const renderedBlocks = [
		renderOneCard(args.propertyCardRecord, 'P001470 (property tier)'),
		renderOneCard(args.qualifiedCardRecord, 'qualified card'),
		renderOneCard(args.valueCardRecord, 'value-tier card'),
	];
	// the phase report's VERBATIM rendered block — the supervisor reads this with own eyes.
	xLog.result(`\n===== G-14 RENDERED EVIDENCE BLOCK (REAL card P001470, VERBATIM) =====\n${renderedBlocks[0].blockText}\n=====\n`);
	next('', { ...args, renderedBlocks, caveatSweepHits: sweepForCaveatString() });
});

// ---- G-17 material: the graph shape facts + the DME reader requirements ----
taskList.push((args, next) => {
	runCypher(
		`MATCH (n:ForgedNode {role:'HubReference'})
		 RETURN count(n) AS cardCount,
		        count(n.canonicalKey) AS canonicalKeyCount,
		        count(CASE WHEN n.referenceTier='property' THEN 1 END) AS propertyTierCount,
		        count(CASE WHEN n.referenceTier='property' AND n.canonicalKey STARTS WITH 'P' THEN 1 END) AS propertyPrefixCount,
		        count(CASE WHEN n.referenceTier='value' THEN 1 END) AS valueTierCount,
		        count(CASE WHEN n.referenceTier='value' AND n.canonicalKey STARTS WITH 'OV' THEN 1 END) AS valuePrefixCount`,
		{},
		(err, records) => {
			if (err) {
				next(err, args);
				return;
			}
			const row = records[0];
			next('', {
				...args,
				graphShapeFacts: {
					cardCount: row.get('cardCount').toNumber(),
					canonicalKeyCount: row.get('canonicalKeyCount').toNumber(),
					propertyTierCount: row.get('propertyTierCount').toNumber(),
					propertyPrefixCount: row.get('propertyPrefixCount').toNumber(),
					valueTierCount: row.get('valueTierCount').toNumber(),
					valuePrefixCount: row.get('valuePrefixCount').toNumber(),
					edgeCounts: {},
				},
			});
		},
	);
});
DME_EDGE_TYPE_NAMES.forEach((oneEdgeTypeName) => {
	taskList.push((args, next) => {
		runCypher(
			`MATCH (n:ForgedNode {role:'HubReference'})-[r:${oneEdgeTypeName}]->() RETURN count(r) AS edgeCount`,
			{},
			(err, records) => {
				if (err) {
					next(err, args);
					return;
				}
				args.graphShapeFacts.edgeCounts[oneEdgeTypeName] = records[0].get('edgeCount').toNumber();
				next('', args);
			},
		);
	});
});
taskList.push((args, next) => {
	next('', { ...args, dmeReaderRequirements: readDmeReaderRequirements() });
});

// ---- G-15: insert the labeled LIF source pair (ADDITIVE MERGE, idempotent) ----
taskList.push((args, next) => {
	runCypher(
		`MERGE (c:ForgedNode {stableId: $classStableId})
		 SET c.role='DmeClass', c._source='LIF', c.name='Assessment'
		 MERGE (p:ForgedNode {stableId: $propertyStableId})
		 SET p.role='DmeProperty', p._source='LIF', p.name='shortName',
		     p.description=$description, p.parentId=$classStableId, p.rangeDatatype='string'
		 RETURN c.stableId AS classStableId, p.stableId AS propertyStableId`,
		{
			classStableId: G15_CLASS_STABLE_ID,
			propertyStableId: G15_PROPERTY_STABLE_ID,
			description: G15_SOURCE_DESCRIPTION,
		},
		(err) => next(err, args),
	);
});

// ---- SF-1 FORCED MID-RUN FAILURE PROBE — `-forceMidRunFailure` fails the pipeline BY NAME right
// ---- after the fixture insert (the worst moment: fixtures in the graph, bridge not yet run, no
// ---- spend yet), so the ALWAYS-RUN cleanup tail (below the pipeline) can be OBSERVED cleaning up
// ---- a died run. Not a default; a deliberately-armed fault for the failure-path proof (P3 review
// ---- SF-1).
taskList.push((args, next) => {
	if (process.global.commandLineParameters.switches.forceMidRunFailure) {
		next(
			`${moduleName}: FORCED MID-RUN FAILURE (-forceMidRunFailure) — the SF-1 probe: fixtures are ` +
				`in the graph and the pipeline is now dying on purpose so the cleanup tail can prove it ` +
				`runs on the failure path.`,
			args,
		);
		return;
	}
	next('', args);
});

// ---- G-15: open the scratch decision store (fresh per run) ----
taskList.push((args, next) => {
	if (fs.existsSync(G15_DECISION_STORE_PATH)) {
		fs.rmSync(G15_DECISION_STORE_PATH);
	}
	decisionStoreFactory().open({ databaseFilePath: G15_DECISION_STORE_PATH }, (openErr, decisionStore) => {
		next(openErr, { ...args, decisionStore });
	});
});

// ---- G-15: mint the REAL llmClient (adapter over its construction throw) ----
taskList.push((args, next) => {
	let llmClient;
	try {
		llmClient = llmClientFactory({ configFilePath: ANTHROPIC_CONFIG_FILE_PATH });
	} catch (constructionError) {
		next(`llmClient construction refused: ${constructionError.message}`, args);
		return;
	}
	next('', { ...args, llmClient });
});

// ---- G-15: THE LIVE MINI-BRIDGE RUN with the counting proxy at the embedding-client seam ----
taskList.push((args, next) => {
	const seamRecord = { embeddedTexts: [] };
	// the counting proxy AROUND the real client: every embedTexts call is recorded, then DELEGATED —
	// the run's embeds are real; only the observation is added.
	const countingEmbeddingClientFactory = (factoryArgs) => {
		const realClient = realEmbeddingClientFactory(factoryArgs);
		return {
			...realClient,
			embedTexts: ({ texts }, embedCallback) => {
				seamRecord.embeddedTexts.push(...texts);
				realClient.embedTexts({ texts }, embedCallback);
			},
		};
	};
	xLog.status(`[${moduleName}] G-15 mini-bridge: LIVE run over ${GRAPH_CONTAINER_NAME} (1 source element, real judgment)`);
	bridgeMaker.run(
		{
			inGraph,
			bridge: 'genericBridge',
			hub: 'CEDS',
			applyLabel: G15_APPLY_LABEL,
			rebridge: true,
			decisionStore: args.decisionStore,
			inferenceConfig: { llmClient: args.llmClient, topK: 15 },
			config: {
				sourceStandard: 'lif',
				sourceStandardName: 'LIF',
				sourceVersion: '01',
				hubVersion: '14.0.0.0',
				evidenceJudgeConcurrency: 1,
				vectorizerConfig: { embeddingClientFactory: countingEmbeddingClientFactory },
			},
		},
		(bridgeErr, bridgeResult) => {
			if (bridgeErr) {
				next(`G-15 mini-bridge run failed: ${bridgeErr}`, args);
				return;
			}
			next('', { ...args, seamRecord, bridgeResult });
		},
	);
});


// ---- THE ALWAYS-RUN CLEANUP TAIL (P3 review SF-1) — executed whether the pipeline succeeded or
// ---- died mid-run: the preserved graph's exit guarantee must not be happy-path-only. DETACH
// ---- DELETE the labeled fixture nodes (their bridge edges go with them), REMOVE the applyLabel
// ---- node-label from any surviving card, then verify — and the verification is ASSERTED on both
// ---- paths. Cleanup runs its three steps in sequence and never masks the pipeline's own error.
const runCleanupTail = (cleanupDone) => {
	const cleanupTaskList = new taskListPlus();
	cleanupTaskList.push((cleanupArgs, next) => {
		runCypher(
			`MATCH (n:ForgedNode) WHERE n.stableId STARTS WITH $stableIdPrefix DETACH DELETE n`,
			{ stableIdPrefix: G15_STABLE_ID_PREFIX },
			(err) => next(err, cleanupArgs),
		);
	});
	cleanupTaskList.push((cleanupArgs, next) => {
		runCypher(`MATCH (n:\`${G15_APPLY_LABEL}\`) REMOVE n:\`${G15_APPLY_LABEL}\``, {}, (err) => next(err, cleanupArgs));
	});
	cleanupTaskList.push((cleanupArgs, next) => {
		runCypher(
			`MATCH (n:ForgedNode {role:'HubReference'})
			 WITH count(n) AS cardCensusAfterCleanup
			 OPTIONAL MATCH (m:ForgedNode) WHERE m.stableId STARTS WITH $stableIdPrefix
			 WITH cardCensusAfterCleanup, count(m) AS fixtureNodesRemaining
			 OPTIONAL MATCH (labeled:\`${G15_APPLY_LABEL}\`)
			 RETURN cardCensusAfterCleanup, fixtureNodesRemaining, count(labeled) AS labeledNodesRemaining`,
			{ stableIdPrefix: G15_STABLE_ID_PREFIX },
			(err, records) => {
				if (err) {
					next(err, cleanupArgs);
					return;
				}
				const row = records[0];
				next('', {
					...cleanupArgs,
					cleanupVerification: {
						cardCensusAfterCleanup: row.get('cardCensusAfterCleanup').toNumber(),
						fixtureNodesRemaining: row.get('fixtureNodesRemaining').toNumber(),
						labeledNodesRemaining: row.get('labeledNodesRemaining').toNumber(),
					},
				});
			},
		);
	});
	pipeRunner(cleanupTaskList.getList(), {}, (cleanupError, cleanupArgs) =>
		cleanupDone(cleanupError, cleanupArgs && cleanupArgs.cleanupVerification),
	);
};

const assertCleanupVerification = (cleanupError, cleanupVerification) => {
	harness.section('G-15 CLEANUP VERIFICATION — always-run tail (SF-1); the preserved graph exits as it entered');
	harness.ok('the cleanup tail ran without error', !cleanupError, cleanupError);
	if (cleanupError) {
		return;
	}
	harness.equal('card census after cleanup is EXACTLY 94,602', cleanupVerification.cardCensusAfterCleanup, 94602);
	harness.equal('zero phase3G15 fixture nodes remain', cleanupVerification.fixtureNodesRemaining, 0);
	harness.equal(`zero nodes still carry the ${G15_APPLY_LABEL} label`, cleanupVerification.labeledNodesRemaining, 0);
};

// ---- ASSEMBLE measurements + twins, judge the declarations ----
pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	// SF-1: cleanup FIRST, unconditionally — success and failure paths alike.
	runCleanupTail((cleanupError, cleanupVerification) => {
		assertCleanupVerification(cleanupError, cleanupVerification);

		harness.section('MATERIAL GATHERING');
		if (pipeError) {
			// A DIED PIPELINE: the failure is reported honestly — but the cleanup assertions above
			// have already proven the graph exited clean, which is SF-1's whole point.
			harness.note(`pipeline error (reported, not masked by cleanup): ${pipeError}`);
			harness.ok('all live material gathered', false, pipeError);
			driver.close().then(() => harness.report());
			return;
		}
		harness.ok('all live material gathered', true);

	harness.note(
		`G-15 bridge result: mode ${args.bridgeResult.counts.mode}, decisionsConsidered ` +
			`${args.bridgeResult.counts.decisionsConsidered}, picks ${args.bridgeResult.counts.picks}, ` +
			`abstains ${args.bridgeResult.counts.abstains}, edgesWritten ${args.bridgeResult.edgesWritten}, ` +
			`generation ${args.bridgeResult.generation}`,
	);
	harness.note(
		`G-15 seam observation: ${args.seamRecord.embeddedTexts.length} text(s) crossed the embedding-client seam: ` +
			args.seamRecord.embeddedTexts.map((oneText) => `'${`${oneText}`.slice(0, 60)}'`).join(' | '),
	);
	harness.equal('G-15 mini-bridge judged exactly ONE source', args.bridgeResult.counts.decisionsConsidered, 1);

	const measurements = {
		bridge: {
			promptCleanViolations: computePromptCleanViolations({
				renderedBlocks: args.renderedBlocks,
				caveatSweepHits: args.caveatSweepHits,
			}),
			candidateReembedViolations: computeCandidateReembedViolations({
				embeddedTexts: args.seamRecord.embeddedTexts,
				expectedSourceEmbedTexts: [G15_EXPECTED_SOURCE_EMBED_TEXT],
			}),
			dmeShapeViolations: computeDmeShapeViolations({
				graphShapeFacts: args.graphShapeFacts,
				dmeReaderRequirements: args.dmeReaderRequirements,
			}),
		},
	};

	const twinRegistry = {
		renderAgainstOldShapeFixture: ({ measurements: pristine }) => {
			const flattenedOldShape = flattenFullRecord({
				stableId: 'oldShapeTwin',
				properties: OLD_SHAPE_TWIN_CARD,
			});
			let hubModuleError = '';
			let blockText = '';
			hubModule(flattenedOldShape, (hubErr, tuple) => {
				if (hubErr) {
					hubModuleError = hubErr;
					return;
				}
				blockText = renderCandidateBlock({ candidate: flattenedOldShape, cosine: 0.5, considerations: { tuple, notes: [] } }, 1);
			});
			return {
				...pristine,
				bridge: {
					...pristine.bridge,
					promptCleanViolations: computePromptCleanViolations({
						renderedBlocks: [
							{
								cardLabel: 'OLD-shape fixture card (twin)',
								hubModuleError,
								blockText,
								requiredDomainLine: 'Domain: Organization (C200239)',
								requiredDefinitionFragment: '',
							},
						],
						caveatSweepHits: [],
					}),
				},
			};
		},
		forceOneCandidateEmbed: ({ measurements: pristine }) => {
			const flattenedCandidate = flattenFullRecord(args.propertyCardRecord);
			return {
				...pristine,
				bridge: {
					...pristine.bridge,
					candidateReembedViolations: computeCandidateReembedViolations({
						embeddedTexts: [...args.seamRecord.embeddedTexts, flattenedCandidate.embedText],
						expectedSourceEmbedTexts: [G15_EXPECTED_SOURCE_EMBED_TEXT],
					}),
				},
			};
		},
		renameOneEdgeInFixture: ({ measurements: pristine }) => {
			const corruptedEdgeCounts = { ...args.graphShapeFacts.edgeCounts };
			corruptedEdgeCounts.IN_HUBX = corruptedEdgeCounts.IN_HUB;
			delete corruptedEdgeCounts.IN_HUB;
			return {
				...pristine,
				bridge: {
					...pristine.bridge,
					dmeShapeViolations: computeDmeShapeViolations({
						graphShapeFacts: { ...args.graphShapeFacts, edgeCounts: corruptedEdgeCounts },
						dmeReaderRequirements: args.dmeReaderRequirements,
					}),
				},
			};
		},
	};

	gatesLib.loadGateDeclarations({ filePath: DECLARATIONS_PATH }, (loadError, loadResult) => {
		harness.section('GATE DECLARATIONS — the bridge:-measured family-E gates');
		harness.ok('hubGates.jsonc loads', !loadError, loadError);
		if (loadError) {
			driver.close().then(() => harness.report());
			return;
		}
		const declarations = {
			...loadResult.declarations,
			gates: loadResult.declarations.gates.filter((oneGate) => oneGate.measure.indexOf('bridge:') === 0),
		};
		harness.equal('three bridge-scoped gates declared (G-14, G-15, G-17)', declarations.gates.length, 3);

		gatesLib.runTwins({ declarations, measurements, twinRegistry }, (twinError, twinResult) => {
			harness.section('THE TWIN SWEEP — each gate OBSERVED going RED under its own fault');
			harness.ok('the twin sweep runs', !twinError, twinError);
			if (twinError) {
				driver.close().then(() => harness.report());
				return;
			}
			twinResult.twinReports.forEach((oneReport) => {
				harness.note(`${oneReport.gateId}: twin '${oneReport.twin}' injected -> ${oneReport.note}`);
				harness.ok(
					`${oneReport.gateId}: twin '${oneReport.twin}' turned its gate RED`,
					oneReport.ran && oneReport.gateWentRed,
					oneReport.note,
				);
			});

			gatesLib.evaluateSuite(
				{ declarations, measurements, observedTwins: twinResult.observedTwins },
				(evaluateError, evaluateResult) => {
					harness.section('THE VERDICT — pristine measurements, twins observed');
					harness.ok('the suite evaluates', !evaluateError, evaluateError);
					if (evaluateError) {
						driver.close().then(() => harness.report());
						return;
					}
					const suiteResult = evaluateResult.suiteResult;
					gatesLib.renderSuiteText({ suiteResult, twinReports: twinResult.twinReports }, (renderError, renderResult) => {
						if (!renderError) {
							xLog.result(renderResult.text);
						}
						harness.equal('zero FAIL', suiteResult.failed, 0);
						harness.equal('zero UNMEASURED', suiteResult.unmeasured, 0);
						harness.equal('zero UNPROVEN', suiteResult.unproven, 0);
						harness.ok('VERDICT: ACCEPTED', suiteResult.accepted, JSON.stringify(suiteResult, null, 2).slice(0, 2000));
						driver.close().then(() => harness.report());
					});
				},
			);
		});
	});
	});
});
