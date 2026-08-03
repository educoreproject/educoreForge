#!/usr/bin/env node
'use strict';

// runForgeEdfiV2CensusDelta.js — the R-WO-1 census-delta proof runner for forge-edfi Phase 2.
// DELIBERATELY NOT HERMETIC: it reads the REAL snapshots (01 for the incumbent, 04 for V2).
//
// WHAT IT DOES (all READ-ONLY with respect to every repo file):
//   1. Derives the INCUMBENT census by running the incumbent parser + buildContractGraph
//      against snapshot 01 (the old forge is studied read-only, per the Phase 2 commission).
//   2. Runs the V2 forge over snapshot 04 TWICE with skipEmbedding and proves the canonical
//      graph hash is STABLE across the two builds (embedding-excluded identity) — both hashes
//      printed (work-order Phase 2 proof).
//   3. Computes the old-vs-new delta: role-population comparison (R-WO-9 supervisor addition),
//      named adds/drops/renames by CONCEPTUAL identity (name-join heuristics stated inline),
//      raw stableId overlap (the identity-continuity statement), crosswalk match census, and
//      the item-keyword drift census.
//   4. Writes the machine-readable artifact to test-artifacts/censusDeltaReport.json (untracked
//      artifacts directory, ceds precedent) and prints a summary.
//
// The narrative REPORT (the R-WO-1 named deliverable) is authored from this artifact in the
// campaign docs; this runner is the mechanical evidence base it cites.
//
// Run: node forges/edfi/test/runForgeEdfiV2CensusDelta.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- R-WO-1 census-delta + hash-stability proof runner (forge-edfi Phase 2)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Derives the incumbent census read-only from snapshot 01, builds the V2 forge twice over
     snapshot 04 (skipEmbedding), proves hash stability, and writes the census-delta artifact
     to test-artifacts/censusDeltaReport.json. Requires the real (gitignored) MetaEd bytes.

EXIT
     0 delta computed and hashes stable;  1 any stage refused or hashes diverged.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const bundleDir = path.join(__dirname, '..');
const snapshot01Path = path.join(bundleDir, 'assets', 'standardSourceData', '01');
const snapshot04Path = path.join(bundleDir, 'assets', 'standardSourceData', '04');
const artifactPath = path.join(__dirname, 'test-artifacts', 'censusDeltaReport.json');

const incumbentParser = require('../lib/parser');
const incumbentForge = require('../forgeEdfi.js')({});
const forgeEdfiV2 = require('../forgeEdfiV2.js')({});

// canonical, embedding-excluded hash over the full node/edge stream (house determinism-gate
// method: sorted property order per node, edge list as emitted)
const canonicalGraphHash = (forged) => {
	const canonicalText = JSON.stringify({
		nodes: forged.nodes.map((oneNode) => ({
			labels: oneNode.labels,
			stableId: oneNode.stableId,
			role: oneNode.role,
			properties: Object.keys(oneNode.properties)
				.sort()
				.reduce((ordered, propertyName) => {
					ordered[propertyName] = oneNode.properties[propertyName];
					return ordered;
				}, {}),
		})),
		edges: forged.edges,
	});
	return crypto.createHash('sha256').update(canonicalText).digest('hex');
};

const inventoryOf = (nodes) =>
	nodes.map((oneNode) => ({
		role: oneNode.role,
		stableId: oneNode.stableId,
		name: `${oneNode.properties.name}`,
	}));

const roleCountsOf = (inventory) => {
	const roleCounts = {};
	inventory.forEach((oneEntry) => {
		roleCounts[oneEntry.role] = (roleCounts[oneEntry.role] || 0) + 1;
	});
	return roleCounts;
};

// =====================================================================
// STAGE 1 — incumbent census (READ-ONLY: parse snapshot 01, pure-shape it)
// =====================================================================
incumbentParser(snapshot01Path, {}, (incumbentParseError, incumbentParsed) => {
	if (incumbentParseError) {
		harness.rejects('incumbent parse', [incumbentParseError], /^$/);
		harness.report();
		return;
	}
	let incumbentGraph;
	let incumbentBuildError = '';
	try {
		incumbentGraph = incumbentForge.buildContractGraph(incumbentParsed);
	} catch (thrownError) {
		incumbentBuildError = thrownError.message;
	}
	if (incumbentBuildError) {
		harness.rejects('incumbent buildContractGraph', [incumbentBuildError], /^$/);
		harness.report();
		return;
	}
	harness.ok(
		`incumbent census derived read-only from snapshot 01 (${incumbentGraph.nodes.length} nodes, ${incumbentGraph.edges.length} edges)`,
		incumbentGraph.nodes.length > 0,
	);

	// =====================================================================
	// STAGE 2 — V2 build #1 and build #2 (skipEmbedding), hash stability
	// =====================================================================
	forgeEdfiV2.forge(
		{ sourcePath: snapshot04Path, skipEmbedding: true },
		(firstBuildError, firstForged) => {
			if (firstBuildError) {
				harness.rejects('V2 build #1', [firstBuildError], /^$/);
				harness.report();
				return;
			}
			forgeEdfiV2.forge(
				{ sourcePath: snapshot04Path, skipEmbedding: true },
				(secondBuildError, secondForged) => {
					if (secondBuildError) {
						harness.rejects('V2 build #2', [secondBuildError], /^$/);
						harness.report();
						return;
					}
					const firstHash = canonicalGraphHash(firstForged);
					const secondHash = canonicalGraphHash(secondForged);
					harness.ok(`V2 build #1 canonical hash: ${firstHash}`, true);
					harness.ok(`V2 build #2 canonical hash: ${secondHash}`, true);
					harness.equal(
						'block hash STABLE across two builds (embedding-excluded identity)',
						firstHash,
						secondHash,
					);

					// =====================================================================
					// STAGE 3 — the delta
					// =====================================================================
					const oldInventory = inventoryOf(incumbentGraph.nodes);
					const newInventory = inventoryOf(firstForged.nodes);

					// identity continuity: raw stableId overlap
					const newStableIdSet = new Set(newInventory.map((oneEntry) => oneEntry.stableId));
					const carriedStableIdList = oldInventory
						.map((oneEntry) => oneEntry.stableId)
						.filter((oneStableId) => newStableIdSet.has(oneStableId));

					// conceptual joins (heuristics stated per family):
					//   class: old edfi:entity/<Name> joins any new class-like construct of the same
					//     name (new id differs -> RENAME)
					//   property: old edfi:field/<Entity>.<Element> joins new property with
					//     owner name === Entity and effective name === Element
					//   optionSet: old edfi:descriptor/<NameDescriptor> joins new edfi:descriptor/
					//     <Name> after stripping the 'Descriptor' suffix the old CSV names carried
					//   optionValue: old edfi:value/<NameDescriptor>.<code> joins new edfi:value/
					//     <Name>.<code> the same way (code compared TRIMMED — the V2 identity rule)
					// join tiers are MECHANICAL naming-convention inversions, censused, never fuzzy:
					//   class: exact name; then the old crosswalk's literal ' (TPDM)' suffix stripped
					//   property: exact (owner.element); then the old ODS 'Descriptor' suffix
					//     stripped, accepted only onto a descriptor-reference property
					//   optionSet: 'Descriptor' suffix stripped; then case-folded (the corpus holds
					//     one case-drift pair, ContinuationofServicesReason), censused separately
					const newClassNameIndex = {};
					const newPropertyIndex = {};
					const newOptionSetNameIndex = {};
					const newOptionSetFoldedNameIndex = {};
					const newOptionValueIndex = {};
					const newOptionValueFoldedIndex = {};
					firstForged.nodes.forEach((oneNode) => {
						if (oneNode.role === 'DmeClass') {
							(newClassNameIndex[oneNode.properties.name] =
								newClassNameIndex[oneNode.properties.name] || []).push(oneNode.stableId);
						}
						if (oneNode.role === 'DmeProperty') {
							const ownerAndName = `${oneNode.properties.owningConstructName}.${oneNode.properties.name}`;
							(newPropertyIndex[ownerAndName] = newPropertyIndex[ownerAndName] || []).push({
								stableId: oneNode.stableId,
								propertyType: oneNode.properties.propertyType,
							});
						}
						if (oneNode.role === 'DmeOptionSet') {
							(newOptionSetNameIndex[oneNode.properties.name] =
								newOptionSetNameIndex[oneNode.properties.name] || []).push(oneNode.stableId);
							const foldedName = `${oneNode.properties.name}`.toLowerCase();
							(newOptionSetFoldedNameIndex[foldedName] =
								newOptionSetFoldedNameIndex[foldedName] || []).push(oneNode.stableId);
						}
						if (oneNode.role === 'DmeOptionValue') {
							newOptionValueIndex[oneNode.stableId] = true;
							newOptionValueFoldedIndex[oneNode.stableId.toLowerCase()] = oneNode.stableId;
						}
					});

					const caseDriftJoinList = [];
					const conceptualJoinByOldRole = {
						DmeClass: (oldEntry) =>
							(newClassNameIndex[oldEntry.name] || [])[0] ||
							(newClassNameIndex[oldEntry.name.replace(/ \(TPDM\)$/, '')] || [])[0],
						DmeProperty: (oldEntry) => {
							const idBody = oldEntry.stableId.replace(/^edfi:field\//, '');
							const bodyMatch = idBody.match(/^(.+)\.([^.]+)$/);
							if (!bodyMatch) {
								return undefined;
							}
							const ownerName = bodyMatch[1].replace(/ \(TPDM\)$/, '');
							const elementName = bodyMatch[2];
							const directMatch = (newPropertyIndex[`${ownerName}.${elementName}`] || [])[0];
							if (directMatch) {
								return directMatch.stableId;
							}
							if (!elementName.endsWith('Descriptor')) {
								return undefined;
							}
							const strippedRefId = `${ownerName}.${elementName.replace(/Descriptor$/, '')}`;
							const suffixMatch = (newPropertyIndex[strippedRefId] || []).find(
								(oneCandidate) => oneCandidate.propertyType === 'descriptor',
							);
							return suffixMatch && suffixMatch.stableId;
						},
						DmeOptionSet: (oldEntry) => {
							const strippedName = oldEntry.name.replace(/Descriptor$/, '');
							const directMatch = (newOptionSetNameIndex[strippedName] || [])[0];
							if (directMatch) {
								return directMatch;
							}
							const foldedMatch = (newOptionSetFoldedNameIndex[strippedName.toLowerCase()] ||
								[])[0];
							if (foldedMatch) {
								caseDriftJoinList.push({
									oldName: oldEntry.name,
									newStableId: foldedMatch,
									role: 'DmeOptionSet',
								});
							}
							return foldedMatch;
						},
						DmeOptionValue: (oldEntry) => {
							const idBody = oldEntry.stableId.replace(/^edfi:value\//, '');
							const bodyMatch = idBody.match(/^(.+?)\.(.+)$/);
							if (!bodyMatch) {
								return undefined;
							}
							const candidateStableId = `edfi:value/${bodyMatch[1].replace(
								/Descriptor$/,
								'',
							)}.${bodyMatch[2].trim()}`;
							if (newOptionValueIndex[candidateStableId]) {
								return candidateStableId;
							}
							const foldedMatch = newOptionValueFoldedIndex[candidateStableId.toLowerCase()];
							if (foldedMatch) {
								caseDriftJoinList.push({
									oldName: oldEntry.stableId,
									newStableId: foldedMatch,
									role: 'DmeOptionValue',
								});
							}
							return foldedMatch;
						},
						DmeStandardRoot: () => 'edfi:root',
					};

					const renamedList = [];
					const droppedList = [];
					const joinedNewStableIdSet = new Set();
					oldInventory.forEach((oldEntry) => {
						const joinFunction = conceptualJoinByOldRole[oldEntry.role];
						const joinedNewStableId = joinFunction ? joinFunction(oldEntry) : undefined;
						if (joinedNewStableId) {
							joinedNewStableIdSet.add(joinedNewStableId);
							if (joinedNewStableId !== oldEntry.stableId) {
								renamedList.push({
									oldStableId: oldEntry.stableId,
									newStableId: joinedNewStableId,
									role: oldEntry.role,
								});
							}
							return;
						}
						droppedList.push({ oldStableId: oldEntry.stableId, role: oldEntry.role, name: oldEntry.name });
					});
					const addedList = newInventory
						.filter((oneEntry) => !joinedNewStableIdSet.has(oneEntry.stableId))
						.map((oneEntry) => ({
							newStableId: oneEntry.stableId,
							role: oneEntry.role,
							name: oneEntry.name,
						}));

					const deltaReport = {
						generatedBy: 'runForgeEdfiV2CensusDelta.js (forge-edfi Phase 2, OCEAN_TOWER)',
						hashStability: { firstHash, secondHash, stable: firstHash === secondHash },
						rolePopulation: {
							incumbent: roleCountsOf(oldInventory),
							v2: roleCountsOf(newInventory),
						},
						identityContinuity: {
							carriedStableIdCount: carriedStableIdList.length,
							carriedStableIdList,
							statement:
								carriedStableIdList.length === 1 && carriedStableIdList[0] === 'edfi:root'
									? 'NO structural stableId survives the forge swap except the root token ' +
										"edfi:root. Every judgment cache entry and mapping block keyed to an old " +
										'edfi:* stableId is INVALIDATED by this swap (R-WO-1: identity continuity ' +
										'was ruled a non-goal; this is the measured consequence).'
									: 'UNEXPECTED overlap shape — inspect carriedStableIdList.',
						},
						conceptualDelta: {
							renamedCount: renamedList.length,
							droppedCount: droppedList.length,
							addedCount: addedList.length,
							caseDriftJoinList,
							renamedList,
							droppedList,
							addedList,
						},
						v2Stats: firstForged.stats,
						crosswalkMatchReport: firstForged.crosswalkMatchReport,
						incumbentEdgeCount: incumbentGraph.edges.length,
						v2EdgeCount: firstForged.edges.length,
					};

					fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
					fs.writeFileSync(artifactPath, JSON.stringify(deltaReport, null, 2));
					harness.ok(`census-delta artifact written: ${artifactPath}`, true);
					harness.ok(
						`role population — incumbent ${JSON.stringify(deltaReport.rolePopulation.incumbent)}`,
						true,
					);
					harness.ok(`role population — v2 ${JSON.stringify(deltaReport.rolePopulation.v2)}`, true);
					harness.ok(
						`conceptual delta — ${renamedList.length} renamed, ${droppedList.length} dropped, ${addedList.length} added`,
						true,
					);
					harness.ok(deltaReport.identityContinuity.statement, true);
					harness.report();
				},
			);
		},
	);
});
