#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     measureEdfiEdgeCarriage.js — the Phase 2 intermediate check for the Ed-Fi 349 remediation:
     forge snapshot 04 and MEASURE the R-WO-15(d)/(f) edge properties on the real block, with
     no container, no bolt and no materialization

DESCRIPTION
     Phase 2 makes forgeEdfiContractGraph carry three declared attributes as REFERENCES edge
     properties — componentKind, itemMetaEdId, itemNamespaceQualifier. The hermetic suite proves
     the round trip on a five-construct fixture. THIS PROVES THE SCOPE ON THE REAL CORPUS, which
     the fixture is far too small to do.

     WHY IT EXISTS AS A KEPT SCRIPT RATHER THAN A ONE-OFF. The Phase 1 independent review found
     that the real-block observations behind that phase were unreproducible, because the driver
     that produced them was not kept. The figures below are load-bearing for the phase and this
     file is how anyone re-derives them.

     WHAT IT REFUSES, AND WHY EACH ONE IS A DIFFERENT DEFECT

     1. node / edge CARDINALITY, expected 6,336 / 8,171 unchanged. Edge properties change bytes,
        not cardinality. A moved count means the fix added or removed edges, which Phase 2 must
        never do.
     2. the three CARRIAGE COUNTS, expected 205 componentKind (199 element / 6 identityTemplate),
        130 itemMetaEdId, 14 itemNamespaceQualifier. These are the certificate's own measured
        decomposition of the production 349.
     3. SCOPE — that componentKind appears ONLY on edges leaving an interchange-family construct,
        and that the subdomain->parent-domain and extension->extendee edges carry NO declared
        edge content at all. This is the check the hermetic suite structurally cannot make: a
        mis-scoped fix that decorated every REFERENCES edge would still round-trip GREEN on the
        fixture while producing a different real-corpus number here.

EXIT
     0 every measure matches;  1 any refusal, naming the measure and both figures
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');

const forgeEdfi = require('../forgeEdfi.js')({ embedder: null }); // the framework refuses an ABSENT embedder key by name (F3b)

const SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '04');

// the census of record (DEVLOG handoff; identical constants to runEdfiMaterialize.js:70-71)
const EXPECTED_NODE_COUNT = 6336;
const EXPECTED_EDGE_COUNT = 8171;

// the certificate's own decomposition of the production 349, now measured on the block
const EXPECTED_CARRIAGE_COUNT_REGISTRY = [
	{ propertyName: 'componentKind', expectedCount: 205 },
	{ propertyName: 'itemMetaEdId', expectedCount: 130 },
	{ propertyName: 'itemNamespaceQualifier', expectedCount: 14 },
];

const EXPECTED_COMPONENT_KIND_COUNT_REGISTRY = [
	{ componentKindValue: 'element', expectedCount: 199 },
	{ componentKindValue: 'identityTemplate', expectedCount: 6 },
];

const INTERCHANGE_FAMILY_CONSTRUCT_TYPES = ['interchange', 'interchangeExtension'];

const refusalList = [];

const refuse = (refusalMessage) => refusalList.push(refusalMessage);

const requireCount = ({ measureName, actualCount, expectedCount }) => {
	console.error(`[${moduleName}] ${measureName}: ${actualCount} (expected ${expectedCount})`);
	if (actualCount !== expectedCount) {
		refuse(`${measureName} is ${actualCount}, expected ${expectedCount}`);
	}
};

console.error(`[${moduleName}] forging snapshot 04 (skipEmbedding) ...`);
forgeEdfi.forge({ sourcePath: SNAPSHOT_PATH, skipEmbedding: true }, (forgeError, forgeResult) => {
	if (forgeError) {
		console.error(`${moduleName} FAILED: ${forgeError}`);
		process.exit(1);
		return;
	}

	requireCount({
		measureName: 'node count',
		actualCount: forgeResult.nodes.length,
		expectedCount: EXPECTED_NODE_COUNT,
	});
	requireCount({
		measureName: 'edge count',
		actualCount: forgeResult.edges.length,
		expectedCount: EXPECTED_EDGE_COUNT,
	});

	const constructTypeByStableId = {};
	forgeResult.nodes.forEach((oneNode) => {
		constructTypeByStableId[oneNode.stableId] = oneNode.properties.constructType;
	});

	const carriageCountByPropertyName = {};
	const componentKindCountByValue = {};
	const componentKindOffScopeList = [];
	let referencesEdgeCount = 0;

	forgeResult.edges.forEach((oneEdge) => {
		if (oneEdge.type !== 'REFERENCES') {
			return;
		}
		referencesEdgeCount += 1;
		EXPECTED_CARRIAGE_COUNT_REGISTRY.forEach(({ propertyName }) => {
			if (oneEdge.properties[propertyName] === undefined) {
				return;
			}
			carriageCountByPropertyName[propertyName] =
				(carriageCountByPropertyName[propertyName] || 0) + 1;
		});
		if (oneEdge.properties.componentKind === undefined) {
			return;
		}
		const componentKindValue = oneEdge.properties.componentKind;
		componentKindCountByValue[componentKindValue] =
			(componentKindCountByValue[componentKindValue] || 0) + 1;
		// SCOPE: componentKind is interchange-family content. Anywhere else it is a mis-scoped fix.
		const fromConstructType = constructTypeByStableId[oneEdge.fromRef.id];
		if (!INTERCHANGE_FAMILY_CONSTRUCT_TYPES.includes(fromConstructType)) {
			componentKindOffScopeList.push(
				`${oneEdge.fromRef.id} (constructType '${fromConstructType}') -> ${oneEdge.toRef.id}`,
			);
		}
	});

	console.error(`[${moduleName}] REFERENCES edges examined: ${referencesEdgeCount}`);

	EXPECTED_CARRIAGE_COUNT_REGISTRY.forEach(({ propertyName, expectedCount }) => {
		requireCount({
			measureName: `edges carrying ${propertyName}`,
			actualCount: carriageCountByPropertyName[propertyName] || 0,
			expectedCount,
		});
	});

	EXPECTED_COMPONENT_KIND_COUNT_REGISTRY.forEach(({ componentKindValue, expectedCount }) => {
		requireCount({
			measureName: `componentKind === '${componentKindValue}'`,
			actualCount: componentKindCountByValue[componentKindValue] || 0,
			expectedCount,
		});
	});

	// no kind value outside the closed vocabulary reached the block
	Object.keys(componentKindCountByValue).forEach((oneComponentKindValue) => {
		const isDeclared = EXPECTED_COMPONENT_KIND_COUNT_REGISTRY.some(
			({ componentKindValue }) => componentKindValue === oneComponentKindValue,
		);
		if (!isDeclared) {
			refuse(
				`componentKind value '${oneComponentKindValue}' is outside the declared vocabulary ` +
					`(${EXPECTED_COMPONENT_KIND_COUNT_REGISTRY.map((one) => one.componentKindValue).join(', ')})`,
			);
		}
	});

	console.error(
		`[${moduleName}] componentKind off-scope edges (expected 0): ${componentKindOffScopeList.length}`,
	);
	if (componentKindOffScopeList.length) {
		refuse(
			`componentKind reached ${componentKindOffScopeList.length} edge(s) NOT leaving an ` +
				`interchange-family construct — the fix is mis-scoped: ` +
				componentKindOffScopeList.slice(0, 20).join('; '),
		);
	}

	if (refusalList.length) {
		console.error(`\n${moduleName} REFUSED — ${refusalList.length} measure(s) wrong:`);
		refusalList.forEach((oneRefusal) => console.error(`  - ${oneRefusal}`));
		process.exit(1);
		return;
	}

	console.error(`\n${moduleName}: every measure matches. Phase 2 carriage verified on the real block.`);
	process.exit(0);
});
