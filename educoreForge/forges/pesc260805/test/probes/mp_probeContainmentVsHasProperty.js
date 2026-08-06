#!/usr/bin/env node
'use strict';

// mp_probeContainmentVsHasProperty.js — Phase 4.6a (session MYSTIC_PORTAL).
// READ-ONLY. Measures the difference between two things that were being treated as one:
//   the HAS_PROPERTY EDGE set, and the parentId CONTAINMENT tree.
// A PescDerivation child is parented to its container but carries no HAS_PROPERTY edge, so a
// census taken over edges under-reports the containment tree. Both my earlier graph queries and
// the supervisor's independent confirmation were taken over EDGES, which is why they agreed and
// why the agreement proved less than it appeared to.

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const bundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

const CONTESTED_NAMESPACE = 'urn:org:pesc:sector:AcademicRecord:v1.6.0';

const labelHas = (oneNode, label) => oneNode.labels.indexOf(label) !== -1;
const perStandardLabelsOf = (oneNode) =>
	oneNode.labels.filter((oneLabel) => oneLabel.indexOf('Pesc') === 0).join('+') || oneNode.labels.join('+');

bundle.forge({ sourcePath: SNAPSHOT_DIR, owner: 'probe', skipEmbedding: true }, (err, forged) => {
	if (err) {
		console.error(`forge failed: ${err}`);
		process.exit(1);
	}

	const childrenByParentId = {};
	forged.nodes.forEach((oneNode) => {
		const parentId = oneNode.properties.parentId;
		if (parentId) (childrenByParentId[parentId] = childrenByParentId[parentId] || []).push(oneNode);
	});
	const hasPropertyChildIdsByParentId = {};
	forged.edges
		.filter((oneEdge) => oneEdge.type === 'HAS_PROPERTY')
		.forEach((oneEdge) => {
			(hasPropertyChildIdsByParentId[oneEdge.fromRef.id] =
				hasPropertyChildIdsByParentId[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
		});

	// the definitions in the contested namespace — the population S-1c duplicates from
	const contestedDefinitionNodes = forged.nodes.filter(
		(oneNode) =>
			labelHas(oneNode, 'PescNamedDefinition') &&
			oneNode.properties.pescTier === 'source' &&
			oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#`) === 0,
	);

	const countBy = (itemList, keyOf) =>
		itemList.reduce(
			(counts, oneItem) => ({ ...counts, [keyOf(oneItem)]: (counts[keyOf(oneItem)] || 0) + 1 }),
			{},
		);

	const allContainmentChildren = [];
	const allHasPropertyChildCount = { total: 0 };
	contestedDefinitionNodes.forEach((oneDefinitionNode) => {
		(childrenByParentId[oneDefinitionNode.stableId] || []).forEach((oneChild) =>
			allContainmentChildren.push(oneChild),
		);
		allHasPropertyChildCount.total += (hasPropertyChildIdsByParentId[oneDefinitionNode.stableId] || [])
			.length;
	});

	console.log(`contested-namespace source definitions: ${contestedDefinitionNodes.length}`);
	console.log(
		`\n=== DIRECT CHILDREN OF THOSE DEFINITIONS, two bases ===\n` +
			JSON.stringify({
				containmentTreeChildren: allContainmentChildren.length,
				hasPropertyEdgeChildren: allHasPropertyChildCount.total,
				difference: allContainmentChildren.length - allHasPropertyChildCount.total,
			}),
	);
	console.log('\ncontainment children by label:');
	console.log(JSON.stringify(countBy(allContainmentChildren, perStandardLabelsOf), null, 2));

	// and one level further: what hangs under the ELEMENT children?
	const elementChildren = allContainmentChildren.filter((oneChild) =>
		labelHas(oneChild, 'PescElementDecl'),
	);
	const grandChildren = [];
	elementChildren.forEach((oneElementChild) => {
		(childrenByParentId[oneElementChild.stableId] || []).forEach((oneGrandChild) =>
			grandChildren.push(oneGrandChild),
		);
	});
	console.log(
		`\n=== UNDER THE ELEMENT CHILDREN (${elementChildren.length} of them) ===\n` +
			`containment grandchildren: ${grandChildren.length}`,
	);
	console.log(JSON.stringify(countBy(grandChildren, perStandardLabelsOf), null, 2));

	// which definitions carry a derivation, and do BOTH branches carry it consistently?
	const derivationChildren = allContainmentChildren.filter((oneChild) =>
		labelHas(oneChild, 'PescDerivation'),
	);
	console.log(`\n=== DERIVATION CHILDREN: ${derivationChildren.length} ===`);
	console.log(
		JSON.stringify(
			countBy(derivationChildren, (oneChild) => `${oneChild.properties.derivationVariety}`),
			null,
			2,
		),
	);
	const derivationOwnerStableIds = new Set(
		derivationChildren.map((oneChild) => oneChild.properties.parentId),
	);
	console.log(`definitions owning at least one derivation: ${derivationOwnerStableIds.size}`);
	console.log('first 10 derivation owners:');
	[...derivationOwnerStableIds]
		.sort()
		.slice(0, 10)
		.forEach((oneOwnerStableId) => console.log(`  ${oneOwnerStableId}`));
});
