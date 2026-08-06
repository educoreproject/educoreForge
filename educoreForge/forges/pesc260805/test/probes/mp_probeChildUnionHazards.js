#!/usr/bin/env node
'use strict';

// mp_probeChildUnionHazards.js — Phase 4.6a PRE-IMPLEMENTATION probe (session MYSTIC_PORTAL).
// READ-ONLY: runs the forge in memory and measures three hazards that would each silently break
// "duplicate the children" if assumed past rather than checked. Writes nothing, asserts nothing.
//
// H1 SIGNATURE UNDER-SPECIFICATION. The merge signature is name|typeAsWritten|minOccurs|maxOccurs.
//    An element declaration ALSO carries nillable, fixedAsWritten, defaultAsWritten and
//    documentation. If two branches agree on the signature but differ on any of those, then
//    "the two branches declare the same child" is TRUE at signature granularity and FALSE in
//    bytes — and copying "the" child has no determinate answer. That is a refusal condition, not
//    a tie to break.
//
// H2 NAME UNIQUENESS WITHIN ONE DEFINITION. Criterion 3 speaks of "both branches declare one
//    name", which presumes a name identifies at most one child per definition. XSD does not
//    guarantee that: a repeated element inside a choice or a second sequence can declare the same
//    name twice. If it happens here, a name-keyed union is wrong on its face.
//
// H3 THE TWO POLICIES, COUNTED. How many synthetic children does each candidate policy emit —
//    winner-takes-all versus union-including-the-losing-branch's-unmatched-names. The difference
//    is the whole of the open question.

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
const COLLEGE_MEMBER_SHA12 = '948d88f32069';
const TEST_SCORE_MEMBER_SHA12 = 'e12830fc86a3';

// the properties that make a child's BYTES, beyond the four the signature names
const BEYOND_SIGNATURE_PROPERTY_NAMES = [
	'nillable',
	'fixedAsWritten',
	'defaultAsWritten',
	'documentation',
];

const labelHas = (oneNode, label) => oneNode.labels.indexOf(label) !== -1;

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

	// the two branches' source definitions, keyed kind|name
	const definitionMapOfBranch = (branchSha12) => {
		const definitionMap = {};
		forged.nodes
			.filter(
				(oneNode) =>
					labelHas(oneNode, 'PescNamedDefinition') &&
					oneNode.properties.pescTier === 'source' &&
					oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#`) === 0 &&
					oneNode.stableId.indexOf(`@${branchSha12}`) !== -1,
			)
			.forEach((oneNode) => {
				definitionMap[`${oneNode.properties.kind}|${oneNode.properties.name}`] = oneNode;
			});
		return definitionMap;
	};
	const collegeDefinitionMap = definitionMapOfBranch(COLLEGE_MEMBER_SHA12);
	const testScoreDefinitionMap = definitionMapOfBranch(TEST_SCORE_MEMBER_SHA12);

	const directElementChildrenOf = (definitionStableId) =>
		(childrenByParentId[definitionStableId] || [])
			.filter((oneChild) => labelHas(oneChild, 'PescElementDecl'))
			.sort(
				(childA, childB) =>
					childA.properties.sequencePosition - childB.properties.sequencePosition,
			);

	const signatureOf = (oneChild) =>
		JSON.stringify([
			oneChild.properties.name,
			oneChild.properties.typeAsWritten,
			oneChild.properties.minOccurs,
			oneChild.properties.maxOccurs,
		]);

	console.log(
		`branches: college ${Object.keys(collegeDefinitionMap).length} definitions, ` +
			`testScore ${Object.keys(testScoreDefinitionMap).length} definitions`,
	);

	// ---- H2 name uniqueness within one definition ------------------------------------
	const duplicateNameFindings = [];
	[
		['college', collegeDefinitionMap],
		['testScore', testScoreDefinitionMap],
	].forEach(([branchLabel, definitionMap]) => {
		Object.keys(definitionMap).forEach((oneDefinitionKey) => {
			const childNodes = directElementChildrenOf(definitionMap[oneDefinitionKey].stableId);
			const countByChildName = {};
			childNodes.forEach((oneChild) => {
				countByChildName[oneChild.properties.name] =
					(countByChildName[oneChild.properties.name] || 0) + 1;
			});
			Object.keys(countByChildName)
				.filter((oneChildName) => countByChildName[oneChildName] > 1)
				.forEach((oneChildName) => {
					duplicateNameFindings.push({
						branchLabel,
						definitionKey: oneDefinitionKey,
						childName: oneChildName,
						occurrences: countByChildName[oneChildName],
					});
				});
		});
	});
	console.log(`\n===== H2 duplicate child NAMES within one definition =====`);
	console.log(`findings: ${duplicateNameFindings.length}`);
	duplicateNameFindings.slice(0, 20).forEach((oneFinding) => console.log(JSON.stringify(oneFinding)));

	// ---- H1 signature-equal but byte-different -----------------------------------------
	const underSpecifiedFindings = [];
	const sharedDefinitionKeys = Object.keys(collegeDefinitionMap)
		.filter((oneDefinitionKey) => testScoreDefinitionMap[oneDefinitionKey] !== undefined)
		.sort();
	sharedDefinitionKeys.forEach((oneDefinitionKey) => {
		const collegeChildNodes = directElementChildrenOf(collegeDefinitionMap[oneDefinitionKey].stableId);
		const testScoreChildNodes = directElementChildrenOf(
			testScoreDefinitionMap[oneDefinitionKey].stableId,
		);
		const collegeChildBySignature = {};
		collegeChildNodes.forEach((oneChild) => {
			collegeChildBySignature[signatureOf(oneChild)] = oneChild;
		});
		testScoreChildNodes.forEach((oneTestScoreChild) => {
			const collegeCounterpart = collegeChildBySignature[signatureOf(oneTestScoreChild)];
			if (collegeCounterpart === undefined) {
				return;
			}
			const differingPropertyNames = BEYOND_SIGNATURE_PROPERTY_NAMES.filter(
				(onePropertyName) =>
					JSON.stringify(collegeCounterpart.properties[onePropertyName]) !==
					JSON.stringify(oneTestScoreChild.properties[onePropertyName]),
			);
			if (differingPropertyNames.length > 0) {
				underSpecifiedFindings.push({
					definitionKey: oneDefinitionKey,
					childName: oneTestScoreChild.properties.name,
					differingPropertyNames,
					collegeValues: differingPropertyNames.map(
						(onePropertyName) => collegeCounterpart.properties[onePropertyName],
					),
					testScoreValues: differingPropertyNames.map(
						(onePropertyName) => oneTestScoreChild.properties[onePropertyName],
					),
				});
			}
		});
	});
	console.log(`\n===== H1 signature-equal children that differ BEYOND the signature =====`);
	console.log(`shared definitions examined: ${sharedDefinitionKeys.length}`);
	console.log(`findings: ${underSpecifiedFindings.length}`);
	underSpecifiedFindings.slice(0, 20).forEach((oneFinding) => console.log(JSON.stringify(oneFinding)));

	// ---- H3 the two candidate policies, counted ---------------------------------------
	const allDefinitionKeys = [
		...new Set([...Object.keys(collegeDefinitionMap), ...Object.keys(testScoreDefinitionMap)]),
	].sort();
	let winnerTakesAllChildCount = 0;
	let unionChildCount = 0;
	const unionOnlyEntries = [];
	allDefinitionKeys.forEach((oneDefinitionKey) => {
		const collegeDefinitionNode = collegeDefinitionMap[oneDefinitionKey];
		const testScoreDefinitionNode = testScoreDefinitionMap[oneDefinitionKey];
		const winnerDefinitionNode =
			collegeDefinitionNode !== undefined ? collegeDefinitionNode : testScoreDefinitionNode;
		const winnerChildNodes = directElementChildrenOf(winnerDefinitionNode.stableId);
		winnerTakesAllChildCount += winnerChildNodes.length;

		const winnerChildNames = new Set(winnerChildNodes.map((oneChild) => oneChild.properties.name));
		const loserChildNodes =
			collegeDefinitionNode !== undefined && testScoreDefinitionNode !== undefined
				? directElementChildrenOf(testScoreDefinitionNode.stableId)
				: [];
		const loserOnlyByName = loserChildNodes.filter(
			(oneChild) => !winnerChildNames.has(oneChild.properties.name),
		);
		unionChildCount += winnerChildNodes.length + loserOnlyByName.length;
		loserOnlyByName.forEach((oneChild) =>
			unionOnlyEntries.push({
				definitionKey: oneDefinitionKey,
				childName: oneChild.properties.name,
				typeAsWritten: oneChild.properties.typeAsWritten,
				minOccurs: oneChild.properties.minOccurs,
				maxOccurs: oneChild.properties.maxOccurs,
			}),
		);
	});
	console.log(`\n===== H3 the two candidate policies, counted =====`);
	console.log(
		JSON.stringify({
			mergedDefinitions: allDefinitionKeys.length,
			winnerTakesAllChildCount,
			unionChildCount,
			differenceCount: unionChildCount - winnerTakesAllChildCount,
		}),
	);
	console.log('entries the UNION adds that winner-takes-all does not:');
	unionOnlyEntries.forEach((oneEntry) => console.log(JSON.stringify(oneEntry)));
});
