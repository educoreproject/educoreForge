'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// syntheticTier.js — the PESC260805 SYNTHETIC tier: the two places where PESC's own publishing
// makes the corpus unusable as shipped and WE decide what it means.
// (DESIGN-pescGraphModel-080526 §2, §3.3, §4; rulings R-P2-1, R-P3-1, R-VAL-5; Phase 4.)
//
// THE TIER'S ONE LAW (design §3.3): everything here is a JUDGMENT, and a judgment must be
// RECORDED, DEFENDED, and REPRODUCIBLE. It is validated by reproducibility, not by fidelity
// (R-VAL-5): re-run the rule over the two preserved collision members and the synthetic nodes must
// come out identical. Consequently, exactly as in the derived tier: NO graph I/O, NO network, NO
// randomness, NO clocks — a pure function of (source tier + derived tier).
//
// WHY A SEPARATE TIER AT ALL. The derived tier may only compute; where it met the contest it
// RECORDED and stopped (201 held references, 1 unresolved import). This tier is where the recorded
// questions get answered, and every answer carries pescTier:'synthetic' plus the syntheticRule
// that produced it, so no consumer can mistake our decision for PESC's statement. In particular
// (design §3.3, third row) a RESOLVES_TO edge produced HERE is marked synthetic:
// resolution-by-decision must never be disguised as resolution-by-computation.
//
// S-1 — THE MERGED AcademicRecord v1.6.0 (R-P3-1).
//   PESC publishes TWO different files under urn:org:pesc:sector:AcademicRecord:v1.6.0. Six
//   substandards import that namespace and NEITHER file serves all six: TestScoreReport 1.0.0
//   references exactly one type in its entire file, AcRec:TestScoreReportType, which the College
//   Transcript member does not carry; TranscriptRequest/Response need RequestType/ResponseType,
//   which the Test Score member does not carry. The merged set is therefore the UNION of named
//   definitions; where both members define one name, the COLLEGE-TRANSCRIPT definition wins (it is
//   the superset in 8 of the 14 conflicts and the subset in NONE — both measured here, not
//   asserted). The whole price is 8 CHILD ELEMENT declarations inside those conflicting types,
//   enumerated by name in the merge report and reachable in the graph under the LOSING member's
//   own source nodes: the loss is queryable, not merely documented.
//
//   WHICH MEMBER IS THE COLLEGE BRANCH IS COMPUTED, NOT CONFIGURED. The branches are identified by
//   the marker types each carries (RequestType/ResponseType/TranscriptHoldType vs
//   TestScoreReportType/EducationTestScoresType) — content the graph already holds. A sha256 or a
//   filename would be a configuration that a re-acquisition could silently invalidate; a marker
//   set fails LOUDLY if the corpus ever changes underneath the rule.
//
//   THE MERGED DEFINITIONS CARRY NO CHILDREN OF THEIR OWN. Each synthetic definition points, via
//   MERGED_FROM, at the source definition(s) it was built from, and names the one whose content it
//   takes (contentFromStableId). Copying the winner's subtree would put a second, drifting copy of
//   PESC's own bytes in a graph whose entire discipline is provenance — and would make the loss
//   invisible by making the survivor look self-contained. One hop to source is the honest shape.
//
// S-2 — THE CoreMain v1.6.0 ALIAS.
//   AcademicRecord_v1.5.0 imports urn:org:pesc:core:CoreMain:v1.6.0, which PESC links from no page
//   and which is the ONLY absent namespace in the corpus. A synthetic PescNamespace node stands in
//   for it, SERVED_BY the real v1.8.0 namespace, and the references resolve THROUGH it so the hop
//   is visible in every traversal. Justification, re-measured here rather than trusted: all 129
//   distinct core: names AcademicRecord_v1.5.0 writes exist in CoreMain 1.8.0. What that is NOT is
//   proof that 1.8.0 says what 1.6.0 said — we have never seen 1.6.0, and any definition that
//   changed between them is silently taken at its 1.8.0 meaning. That is unmeasurable without the
//   file, and stating it is the price of making the substitution.
//
// REFUSE, NEVER SUBSTITUTE. Both rules are judgments about a SPECIFIC known defect. A second
// contested namespace, a second absent namespace, a marker set that identifies zero or two
// branches, or a held reference that STILL has no target after the merge — each is new information
// demanding a new decision, and each refuses BY NAME rather than being folded into the existing
// judgment. The alternative is a tier that quietly grows opinions nobody ruled on.
//
// Sync + pure: throws for refusals (house rule — the forge's one sanctioned try/catch boundary
// converts them to the error channel). No callbacks: nothing here waits on anything.

const path = require('path');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));
const { NODE_LABELS, DME_ROLES, PROVENANCE_TIER } = require(
	path.join(CORE_LIB, 'vocabulary', 'vocabulary'),
);

const PESC_SOURCE_TIER = 'source';
const PESC_DERIVED_TIER = 'derived';
const PESC_SYNTHETIC_TIER = 'synthetic';

const SYNTHETIC_RULE = { MERGE: 'S-1', ALIAS: 'S-2' };

// the marker types that identify each collision branch by CONTENT (see header). All of a set must
// be present for the branch to be identified, and each set must identify exactly one member.
const S1_COLLEGE_BRANCH_MARKER_NAMES = ['RequestType', 'ResponseType', 'TranscriptHoldType'];
const S1_TEST_SCORE_BRANCH_MARKER_NAMES = ['TestScoreReportType', 'EducationTestScoresType'];

// the S-2 judgment, stated as data so it can be grepped and audited (the prototype's reasoning:
// an alias recorded as data, never a symlink — a symlink changes what a filename finds without
// changing what the file declares, and would be invisible to namespace-based resolution).
const S2_ABSENT_NAMESPACE = 'urn:org:pesc:core:CoreMain:v1.6.0';
const S2_SERVING_NAMESPACE = 'urn:org:pesc:core:CoreMain:v1.8.0';

// mirrors derivedTier's table (XSD's separate symbol spaces). Duplicated rather than imported
// because the two tiers must be able to disagree loudly rather than drift together silently; an
// unknown variety refuses.
const ADMISSIBLE_TARGET_KINDS = {
	type: ['complexType', 'simpleType'],
	base: ['complexType', 'simpleType'],
	substitutionGroup: ['element'],
	groupRef: ['group'],
};

// the two derived annotations this tier CONSUMES. Named here so a reader can see the seam: the
// derived tier records the questions under these names; this tier answers exactly those.
const HELD_REFERENCE_ANNOTATION = 'ambiguousPendingSynthesis';
const ABSENT_NAMESPACE_REFERENCE_ANNOTATION = 'unresolvedNamespaceReferences';
const ABSENT_NAMESPACE_IMPORT_ANNOTATION = 'unresolvedImportFact';

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		const { buildSearchText } = buildSearchTextFactory();

		const refuse = (message) => {
			throw new Error(`pesc260805 syntheticTier REFUSES: ${message}`);
		};

		// requiredProperty — absent-property reads throw (house rule): reading a property that is
		// not there is a wrong-model bug, not a default-to-empty situation.
		const requiredProperty = (oneNode, propertyName) => {
			if (!Object.prototype.hasOwnProperty.call(oneNode.properties, propertyName)) {
				refuse(
					`node '${oneNode.stableId}' has no property '${propertyName}' — the synthetic tier's ` +
						`model of the graph it was handed is wrong, which is a bug, not a default`,
				);
			}
			return oneNode.properties[propertyName];
		};

		const labelHas = (oneNode, label) => oneNode.labels.indexOf(label) !== -1;

		const sortedKeyObject = (sourceObject) => {
			const result = {};
			Object.keys(sourceObject)
				.sort()
				.forEach((oneKey) => {
					result[oneKey] = sourceObject[oneKey];
				});
			return result;
		};

		// =====================================================================
		// buildSyntheticTier — ({ nodes, edges }) of the COMBINED source+derived+meta graph ->
		// { nodes, edges, stats, mergeReport }. Adds only; annotates nothing, mutates nothing.
		// =====================================================================
		const buildSyntheticTier = ({ nodes, edges }) => {
			if (!Array.isArray(nodes) || !Array.isArray(edges)) {
				refuse('buildSyntheticTier requires { nodes, edges } arrays');
			}
			// purity guard, the mirror of the derived tier's: synthesis must start from source and
			// derivation, never from a previous synthesis, or a re-run would compound its own output.
			nodes.forEach((oneNode) => {
				if (oneNode.properties.pescTier === PESC_SYNTHETIC_TIER) {
					refuse(
						`input carries synthetic node '${oneNode.stableId}' — re-synthesis must start from ` +
							`source+derived, not from a previous synthesis`,
					);
				}
			});
			edges.forEach((oneEdge) => {
				if (oneEdge.properties.pescTier === PESC_SYNTHETIC_TIER) {
					refuse(
						`input carries a synthetic ${oneEdge.type} edge (${oneEdge.fromRef.id} -> ` +
							`${oneEdge.toRef.id}) — re-synthesis must start from source+derived`,
					);
				}
			});

			const nodeByStableId = {};
			const childrenByParentId = {};
			nodes.forEach((oneNode) => {
				if (nodeByStableId[oneNode.stableId] !== undefined) {
					refuse(`duplicate stableId '${oneNode.stableId}' in input — the graph is corrupt`);
				}
				nodeByStableId[oneNode.stableId] = oneNode;
				const parentId = oneNode.properties.parentId;
				if (parentId !== undefined && parentId !== null && parentId !== '') {
					(childrenByParentId[parentId] = childrenByParentId[parentId] || []).push(oneNode);
				}
			});

			const rootNode = nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT);
			if (rootNode === undefined) {
				refuse('input carries no standard-root node');
			}
			const standardSource = requiredProperty(rootNode, '_source');
			const stableUriPropertyName = requiredProperty(rootNode, 'stableUriPropertyName');

			const syntheticNodes = [];
			const syntheticEdges = [];

			const addSyntheticEdge = (edgeType, fromStableId, toStableId, syntheticRule, extraProperties) => {
				if (!fromStableId || !toStableId) {
					refuse(`syntheticTier builder bug: ${edgeType} edge with unresolved endpoint`);
				}
				if (nodeByStableId[fromStableId] === undefined && !syntheticNodeExists(fromStableId)) {
					refuse(`syntheticTier builder bug: ${edgeType} edge from unknown node '${fromStableId}'`);
				}
				if (nodeByStableId[toStableId] === undefined && !syntheticNodeExists(toStableId)) {
					refuse(`syntheticTier builder bug: ${edgeType} edge to unknown node '${toStableId}'`);
				}
				syntheticEdges.push({
					type: edgeType,
					fromRef: { source: standardSource, id: fromStableId },
					toRef: { source: standardSource, id: toStableId },
					properties: {
						provenanceTier: PROVENANCE_TIER.STRUCTURAL,
						pescTier: PESC_SYNTHETIC_TIER,
						syntheticRule,
						...(extraProperties || {}),
					},
				});
			};
			const syntheticNodeStableIds = {};
			const syntheticNodeExists = (oneStableId) => syntheticNodeStableIds[oneStableId] === true;
			const addSyntheticNode = (oneNode) => {
				if (nodeByStableId[oneNode.stableId] !== undefined || syntheticNodeExists(oneNode.stableId)) {
					refuse(
						`syntheticTier builder bug: synthetic node '${oneNode.stableId}' collides with a node ` +
							`that already exists — a synthetic identity must never overwrite a said one`,
					);
				}
				syntheticNodeStableIds[oneNode.stableId] = true;
				syntheticNodes.push(oneNode);
				return oneNode;
			};

			// ---- the source-tier populations this tier reads --------------------------------
			const artifactNodes = nodes.filter((oneNode) => labelHas(oneNode, 'PescArtifact'));
			const artifactNodeBySha256 = {};
			artifactNodes.forEach((oneArtifactNode) => {
				artifactNodeBySha256[requiredProperty(oneArtifactNode, 'sha256')] = oneArtifactNode;
			});
			const artifactNodesByNamespace = {};
			artifactNodes.forEach((oneArtifactNode) => {
				const oneNamespace = requiredProperty(oneArtifactNode, 'targetNamespace');
				(artifactNodesByNamespace[oneNamespace] = artifactNodesByNamespace[oneNamespace] || []).push(
					oneArtifactNode,
				);
			});
			const definitionNodes = nodes.filter((oneNode) => labelHas(oneNode, 'PescNamedDefinition'));
			const definitionNodesByArtifactSha256 = {};
			definitionNodes.forEach((oneDefinitionNode) => {
				const oneSha = requiredProperty(oneDefinitionNode, 'declaringArtifactSha256');
				(definitionNodesByArtifactSha256[oneSha] = definitionNodesByArtifactSha256[oneSha] || []).push(
					oneDefinitionNode,
				);
			});
			// namespace -> localName -> [definition node]; built by SCAN so the contested members'
			// @sha12 discriminators are irrelevant to lookup (they are identity, not addressing).
			const sourceDefinitionsByNamespaceAndName = {};
			definitionNodes.forEach((oneDefinitionNode) => {
				const declaringArtifactNode =
					artifactNodeBySha256[oneDefinitionNode.properties.declaringArtifactSha256];
				if (declaringArtifactNode === undefined) {
					refuse(
						`definition '${oneDefinitionNode.stableId}' names a declaring artifact sha that ` +
							`matches no artifact node`,
					);
				}
				const lookupKey = `${declaringArtifactNode.properties.targetNamespace} ${oneDefinitionNode.properties.name}`;
				(sourceDefinitionsByNamespaceAndName[lookupKey] =
					sourceDefinitionsByNamespaceAndName[lookupKey] || []).push(oneDefinitionNode);
			});
			const namespaceNodeByNamespace = {};
			nodes
				.filter((oneNode) => labelHas(oneNode, 'PescNamespace'))
				.forEach((oneNamespaceNode) => {
					namespaceNodeByNamespace[requiredProperty(oneNamespaceNode, 'name')] = oneNamespaceNode;
				});

			// =============================================================
			// S-1 — identify the contest, identify the branches
			// =============================================================
			const contestedNamespaces = Object.keys(artifactNodesByNamespace)
				.filter((oneNamespace) => artifactNodesByNamespace[oneNamespace].length > 1)
				.sort();
			if (contestedNamespaces.length !== 1) {
				refuse(
					`S-1 covers exactly ONE known contest (the AcademicRecord v1.6.0 collision) but the ` +
						`corpus presents ${contestedNamespaces.length} contested namespace(s) ` +
						`[${contestedNamespaces.join(', ')}]. A second contest is new information demanding a ` +
						`new ruling, not an existing judgment applied by analogy`,
				);
			}
			const contestedNamespace = contestedNamespaces[0];
			// cross-tier consistency: the derived tier's own verdict on contested-ness must agree.
			const contestedNamespaceNode = namespaceNodeByNamespace[contestedNamespace];
			if (contestedNamespaceNode === undefined) {
				refuse(
					`the derived tier emitted no PescNamespace node for the contested namespace ` +
						`'${contestedNamespace}'; the synthetic tier resolves imports onto it`,
				);
			}
			if (requiredProperty(contestedNamespaceNode, 'contested') !== true) {
				refuse(
					`the derived tier says '${contestedNamespace}' is NOT contested while the artifact census ` +
						`says it is claimed by ${artifactNodesByNamespace[contestedNamespace].length} files — ` +
						`the two tiers disagree about the corpus`,
				);
			}
			const collisionMemberNodes = artifactNodesByNamespace[contestedNamespace];
			if (collisionMemberNodes.length !== 2) {
				refuse(
					`S-1 merges exactly TWO collision members; '${contestedNamespace}' is claimed by ` +
						`${collisionMemberNodes.length}`,
				);
			}

			const memberCarriesAllMarkers = (oneMemberNode, markerNames) =>
				markerNames.every((oneMarkerName) =>
					definitionNodesByArtifactSha256[oneMemberNode.properties.sha256].some(
						(oneDefinitionNode) => oneDefinitionNode.properties.name === oneMarkerName,
					),
				);
			const identifyBranch = (markerNames, branchLabel) => {
				const matchingMemberNodes = collisionMemberNodes.filter((oneMemberNode) =>
					memberCarriesAllMarkers(oneMemberNode, markerNames),
				);
				if (matchingMemberNodes.length !== 1) {
					refuse(
						`S-1 identifies the ${branchLabel} branch by the marker types ` +
							`[${markerNames.join(', ')}], which ${matchingMemberNodes.length} of the ` +
							`${collisionMemberNodes.length} collision members carry ` +
							`(${matchingMemberNodes.map((oneNode) => oneNode.properties.filename).join(', ') || 'none'}). ` +
							`Exactly one must. The corpus has changed underneath the rule and the merge cannot ` +
							`proceed on a guess`,
					);
				}
				return matchingMemberNodes[0];
			};
			const collegeMemberNode = identifyBranch(S1_COLLEGE_BRANCH_MARKER_NAMES, 'college-transcript');
			const testScoreMemberNode = identifyBranch(S1_TEST_SCORE_BRANCH_MARKER_NAMES, 'test-score');
			if (collegeMemberNode.stableId === testScoreMemberNode.stableId) {
				refuse(
					`S-1's two marker sets identify the SAME collision member ` +
						`('${collegeMemberNode.properties.filename}') — the branches are not distinguishable and ` +
						`the winner rule has nothing to rule on`,
				);
			}

			// =============================================================
			// S-1 — the child-element signature (the port of the prototype's comparison)
			// =============================================================
			// PORTED FROM researchArtifacts/buildSyntheticAcademicRecord.py:readChildElementSignature,
			// which used ElementTree's .iter() — a PREORDER walk of the whole definition subtree,
			// collecting (name, type, minOccurs, maxOccurs) for every xs:element at any depth. The
			// source tier splits that subtree across node kinds, so the walk is reconstructed:
			// element decls in sequencePosition order, each followed immediately by its own inline
			// (anonymous) type's contents, then the container's remaining inline types and
			// attributes' inline types. Elements declared inside an xs:extension/xs:restriction hang
			// off the CONTAINER in this model (forgePesc260805.js emitContainerContents), so they are
			// already in the container's sequence and need no separate visit.
			//
			// The signature is what makes a shared name a CONFLICT and what names the 8 lost
			// elements, so its fidelity to the prototype is load-bearing: the gate suite asserts the
			// per-type child counts against the prototype's own published table.
			const childElementSignatureOf = (definitionStableId) => {
				const signatureEntries = [];
				const visitContainer = (containerStableId) => {
					const childNodes = childrenByParentId[containerStableId] || [];
					childNodes
						.filter((oneChild) => labelHas(oneChild, 'PescElementDecl'))
						.sort(
							(childA, childB) =>
								childA.properties.sequencePosition - childB.properties.sequencePosition,
						)
						.forEach((oneElementNode) => {
							signatureEntries.push({
								name: requiredProperty(oneElementNode, 'name'),
								typeAsWritten: requiredProperty(oneElementNode, 'typeAsWritten'),
								minOccurs: requiredProperty(oneElementNode, 'minOccurs'),
								maxOccurs: requiredProperty(oneElementNode, 'maxOccurs'),
							});
							visitContainer(oneElementNode.stableId);
						});
					childNodes
						.filter((oneChild) => labelHas(oneChild, 'PescAnonymousType'))
						.forEach((oneAnonymousNode) => visitContainer(oneAnonymousNode.stableId));
					childNodes
						.filter((oneChild) => labelHas(oneChild, 'PescAttributeDecl'))
						.forEach((oneAttributeNode) => visitContainer(oneAttributeNode.stableId));
				};
				visitContainer(definitionStableId);
				return signatureEntries;
			};
			const signatureEntryKey = (oneEntry) =>
				JSON.stringify([oneEntry.name, oneEntry.typeAsWritten, oneEntry.minOccurs, oneEntry.maxOccurs]);

			// =============================================================
			// S-1 — the SIGNATURE-BASED, SYMMETRIC merge delta (R-P4-5, R-P4-6)
			// =============================================================
			// SUPERSEDES the name-only 'lostChildElementNames' record, which was MISLEADING and is
			// gone from the graph entirely (design §8f). A name-only record cannot express a type
			// REBINDING: the merged ContactsType published lost names ["Address","Email","Phone"]
			// while its own subtree CONTAINS elements of exactly those names, differently bound. A
			// reader consulting that record was actively misled, so the property name is retired
			// rather than repaired — nothing downstream can read the old form by accident.
			//
			// R-P4-5: the record is keyed on name + RESOLVED TYPE + cardinality, and every entry the
			// losing member had that the merged form does not is CLASSIFIED:
			//   ABSENT   no element of that name survives in the merged subtree — a real loss
			//   REBOUND  the name survives, bound to a DIFFERENT type — present, not lost
			//   WIDENED  same name, same type, and the merged cardinality ADMITS the loser's — a
			//            widening loses nothing, and counting it as a loss was simply wrong
			// A fourth shape (same name, same type, merged cardinality NARROWER) would be a genuine
			// loss of a different species and no ruling covers it, so it REFUSES rather than being
			// filed under the nearest label.
			//
			// R-P4-6: the record is SYMMETRIC. A union subtracts and ADDS, and enumerating only the
			// subtractions is not an honest account of a merge. 'added' is what the merged form
			// carries that the losing member never declared — not invention in the round-trip sense
			// (every added entry is declared by the winning source member) but a real widening of
			// what a test-score consumer now sees, and it is stated rather than left implicit.
			const occursNumber = (occursValue) => {
				if (occursValue === null || occursValue === undefined || occursValue === '') {
					return 1; // XSD default for an unstated minOccurs/maxOccurs
				}
				if (occursValue === 'unbounded') {
					return Infinity;
				}
				const parsed = Number(occursValue);
				if (!Number.isFinite(parsed)) {
					refuse(
						`S-1's merge delta met the occurrence value '${occursValue}', which is neither a ` +
							`number nor 'unbounded' — classifying it would be a guess`,
					);
				}
				return parsed;
			};
			const mergedFormAdmits = (mergedEntry, loserEntry) =>
				occursNumber(mergedEntry.minOccurs) <= occursNumber(loserEntry.minOccurs) &&
				occursNumber(mergedEntry.maxOccurs) >= occursNumber(loserEntry.maxOccurs);

			const classifyDroppedEntry = (loserEntry, mergedSignature, definitionKey) => {
				const sameNameInMerged = mergedSignature.filter(
					(oneMergedEntry) => oneMergedEntry.name === loserEntry.name,
				);
				if (sameNameInMerged.length === 0) {
					return { classification: 'ABSENT', mergedCounterpart: null };
				}
				const sameNameSameType = sameNameInMerged.filter(
					(oneMergedEntry) => oneMergedEntry.typeAsWritten === loserEntry.typeAsWritten,
				);
				if (sameNameSameType.length === 0) {
					return { classification: 'REBOUND', mergedCounterpart: sameNameInMerged[0] };
				}
				const wideningCounterpart = sameNameSameType.find((oneMergedEntry) =>
					mergedFormAdmits(oneMergedEntry, loserEntry),
				);
				if (wideningCounterpart !== undefined) {
					return { classification: 'WIDENED', mergedCounterpart: wideningCounterpart };
				}
				refuse(
					`S-1's merge delta cannot classify '${definitionKey}' child '${loserEntry.name}': the ` +
						`merged form binds the same name to the same type '${loserEntry.typeAsWritten}' but with ` +
						`a cardinality that does NOT admit the losing member's ` +
						`(loser ${loserEntry.minOccurs}..${loserEntry.maxOccurs}, merged ` +
						`${sameNameSameType[0].minOccurs}..${sameNameSameType[0].maxOccurs}). That is a NARROWING ` +
						`— a real loss of a species no ruling covers, and filing it under the nearest label ` +
						`would be exactly the dishonesty R-P4-5 was written to end`,
				);
				return null; // unreachable; refuse throws
			};

			const signatureRecordOf = (oneEntry, extraFields) => ({
				name: oneEntry.name,
				typeAsWritten: oneEntry.typeAsWritten,
				minOccurs: oneEntry.minOccurs,
				maxOccurs: oneEntry.maxOccurs,
				...extraFields,
			});

			// =============================================================
			// S-1 — the union, the conflicts, the loss
			// =============================================================
			const definitionMapOfMember = (oneMemberNode) => {
				const definitionMap = {};
				definitionNodesByArtifactSha256[oneMemberNode.properties.sha256].forEach(
					(oneDefinitionNode) => {
						const definitionKey = `${requiredProperty(oneDefinitionNode, 'kind')}|${requiredProperty(oneDefinitionNode, 'name')}`;
						if (definitionMap[definitionKey] !== undefined) {
							refuse(
								`collision member '${oneMemberNode.properties.filename}' declares ` +
									`'${definitionKey}' twice — one symbol space should hold one`,
							);
						}
						definitionMap[definitionKey] = oneDefinitionNode;
					},
				);
				return definitionMap;
			};
			const collegeDefinitionMap = definitionMapOfMember(collegeMemberNode);
			const testScoreDefinitionMap = definitionMapOfMember(testScoreMemberNode);

			const collegeOnlyKeys = Object.keys(collegeDefinitionMap)
				.filter((oneKey) => testScoreDefinitionMap[oneKey] === undefined)
				.sort();
			const testScoreOnlyKeys = Object.keys(testScoreDefinitionMap)
				.filter((oneKey) => collegeDefinitionMap[oneKey] === undefined)
				.sort();
			const sharedKeys = Object.keys(collegeDefinitionMap)
				.filter((oneKey) => testScoreDefinitionMap[oneKey] !== undefined)
				.sort();

			const conflictRecords = [];
			const absentChildElements = [];
			const reboundChildElements = [];
			const widenedChildElements = [];
			const addedChildElements = [];
			sharedKeys.forEach((oneKey) => {
				const collegeSignature = childElementSignatureOf(collegeDefinitionMap[oneKey].stableId);
				const testScoreSignature = childElementSignatureOf(testScoreDefinitionMap[oneKey].stableId);
				const collegeKeys = collegeSignature.map(signatureEntryKey);
				const testScoreKeys = testScoreSignature.map(signatureEntryKey);
				if (collegeKeys.join('\n') === testScoreKeys.join('\n')) {
					return;
				}
				const collegeKeySet = new Set(collegeKeys);
				const testScoreKeySet = new Set(testScoreKeys);

				// the LOSING direction (R-P4-5): what the test-score member declared that the merged
				// (college) form does not declare identically — each entry classified, not just named.
				const droppedEntries = testScoreSignature.filter(
					(oneEntry) => !collegeKeySet.has(signatureEntryKey(oneEntry)),
				);
				// the WINNING direction (R-P4-6): what the merged form declares that the test-score
				// member never did. Same signature basis, same subtree walk, opposite direction.
				const addedEntries = collegeSignature.filter(
					(oneEntry) => !testScoreKeySet.has(signatureEntryKey(oneEntry)),
				);

				const collegeIsSuperset =
					testScoreKeys.every((oneKeyText) => collegeKeySet.has(oneKeyText)) &&
					collegeKeySet.size > testScoreKeySet.size;
				const collegeIsSubset =
					collegeKeys.every((oneKeyText) => testScoreKeySet.has(oneKeyText)) &&
					testScoreKeySet.size > collegeKeySet.size;
				// the winner rule's own justification, MEASURED: the college member is the superset in
				// most conflicts and the subset in none. A subset would invert the rule, so it refuses.
				if (collegeIsSubset) {
					refuse(
						`S-1's winner rule says the college-transcript definition is never the SUBSET, but ` +
							`'${oneKey}' is: the test-score member declares every child the college member does ` +
							`and more. The rule's justification has failed on the data and the merge cannot ` +
							`proceed on the old ruling`,
					);
				}
				// classify every dropped entry, then file it in its own bucket
				const perDefinitionAbsent = [];
				const perDefinitionRebound = [];
				const perDefinitionWidened = [];
				droppedEntries.forEach((oneEntry) => {
					const { classification, mergedCounterpart } = classifyDroppedEntry(
						oneEntry,
						collegeSignature,
						oneKey,
					);
					const record = {
						definitionKey: oneKey,
						definitionName: oneKey.split('|')[1],
						classification,
						...signatureRecordOf(oneEntry),
						// the entry is QUERYABLE: the element declaration still exists in the graph, under
						// the losing member's own source-tier definition. This is the stableId to walk to.
						survivingUnderSourceDefinitionStableId: testScoreDefinitionMap[oneKey].stableId,
						losingArtifactSha256: testScoreMemberNode.properties.sha256,
						mergedCounterpart:
							mergedCounterpart === null ? null : signatureRecordOf(mergedCounterpart),
					};
					if (classification === 'ABSENT') {
						perDefinitionAbsent.push(record);
						absentChildElements.push(record);
						return;
					}
					if (classification === 'REBOUND') {
						perDefinitionRebound.push(record);
						reboundChildElements.push(record);
						return;
					}
					perDefinitionWidened.push(record);
					widenedChildElements.push(record);
				});

				const perDefinitionAdded = addedEntries.map((oneEntry) => ({
					definitionKey: oneKey,
					definitionName: oneKey.split('|')[1],
					classification: 'ADDED',
					...signatureRecordOf(oneEntry),
					// the added declaration's home: the WINNING member's own source-tier definition.
					declaredUnderSourceDefinitionStableId: collegeDefinitionMap[oneKey].stableId,
					declaringArtifactSha256: collegeMemberNode.properties.sha256,
				}));
				perDefinitionAdded.forEach((oneRecord) => addedChildElements.push(oneRecord));

				conflictRecords.push({
					definitionKey: oneKey,
					kind: oneKey.split('|')[0],
					name: oneKey.split('|')[1],
					collegeChildCount: collegeSignature.length,
					testScoreChildCount: testScoreSignature.length,
					collegeIsSuperset,
					absentChildElements: perDefinitionAbsent,
					reboundChildElements: perDefinitionRebound,
					widenedChildElements: perDefinitionWidened,
					addedChildElements: perDefinitionAdded,
				});
			});
			const conflictKeySet = new Set(conflictRecords.map((oneRecord) => oneRecord.definitionKey));

			// =============================================================
			// S-1 — emit the merged definition nodes and their MERGED_FROM provenance
			// =============================================================
			// IDENTITY — RATIFIED by design §8e R-P4-1, which rules that merged definitions take the
			// CLEAN qualified key and that this is consistent with D-1's intent rather than an
			// exception to it: the discriminator exists to mark a namespace DISPUTED, and the
			// synthetic merge is the RESOLUTION of that dispute. (This comment previously read
			// "PROVISIONAL — design §4 is silent on synthetic ones"; that was factually wrong once
			// R-P4-1 was written, and a stale PROVISIONAL invites a re-litigation that already
			// happened.) The merged definition takes the CLEAN qualified key
			// '<namespace>#<kind>/<name>', which the source members cannot hold because D-1 gives
			// every definition in a contested namespace an '@<sha12>' discriminator. So the clean key
			// is both free and exactly right: it is what a written reference 'AcRec:PersonType'
			// MEANS, and its presence says "the contest was decided" as loudly as the discriminator
			// says "the contest is real".
			const mergedDefinitionStableIdByKey = {};
			const mergedDefinitionsByName = {};
			const unionKeys = [...collegeOnlyKeys, ...testScoreOnlyKeys, ...sharedKeys].sort();
			unionKeys.forEach((oneKey) => {
				const isShared = collegeDefinitionMap[oneKey] !== undefined && testScoreDefinitionMap[oneKey] !== undefined;
				const winningDefinitionNode =
					collegeDefinitionMap[oneKey] !== undefined
						? collegeDefinitionMap[oneKey]
						: testScoreDefinitionMap[oneKey];
				const supersededDefinitionNode =
					isShared && conflictKeySet.has(oneKey) ? testScoreDefinitionMap[oneKey] : null;
				const mergeDisposition = !isShared
					? collegeDefinitionMap[oneKey] !== undefined
						? 'collegeTranscriptOnly'
						: 'testScoreOnly'
					: conflictKeySet.has(oneKey)
						? 'sharedConflictCollegeTranscriptWon'
						: 'sharedIdentical';
				const conflictRecord = conflictRecords.find(
					(oneRecord) => oneRecord.definitionKey === oneKey,
				);
				// what the merged NODE publishes about its own delta: the signature, its
				// classification, and the forwarding address. definitionKey/definitionName are
				// dropped because the node IS the definition — repeating them would be noise.
				const publishedDeltaEntry = (oneRecord) => ({
					name: oneRecord.name,
					typeAsWritten: oneRecord.typeAsWritten,
					minOccurs: oneRecord.minOccurs,
					maxOccurs: oneRecord.maxOccurs,
					classification: oneRecord.classification,
					...(oneRecord.classification === 'ADDED'
						? { declaredUnderSourceDefinitionStableId: oneRecord.declaredUnderSourceDefinitionStableId }
						: {
								survivingUnderSourceDefinitionStableId:
									oneRecord.survivingUnderSourceDefinitionStableId,
								mergedCounterpart: oneRecord.mergedCounterpart,
							}),
				});
				const deltaSignatures = {
					absent: (conflictRecord === undefined ? [] : conflictRecord.absentChildElements).map(
						publishedDeltaEntry,
					),
					rebound: (conflictRecord === undefined ? [] : conflictRecord.reboundChildElements).map(
						publishedDeltaEntry,
					),
					widened: (conflictRecord === undefined ? [] : conflictRecord.widenedChildElements).map(
						publishedDeltaEntry,
					),
					added: (conflictRecord === undefined ? [] : conflictRecord.addedChildElements).map(
						publishedDeltaEntry,
					),
				};
				const definitionKind = requiredProperty(winningDefinitionNode, 'kind');
				const definitionName = requiredProperty(winningDefinitionNode, 'name');
				const mergedStableId = `${contestedNamespace}#${definitionKind}/${definitionName}`;
				const definitionRole = winningDefinitionNode.role;
				const owningName = `${requiredProperty(contestedNamespaceNode, 'standardToken')} ${requiredProperty(contestedNamespaceNode, 'version')} (merged)`;

				addSyntheticNode({
					labels: [NODE_LABELS.FORGED_NODE, 'PescNamedDefinition', definitionRole],
					stableId: mergedStableId,
					role: definitionRole,
					properties: {
						_id: mergedStableId,
						_source: standardSource,
						name: definitionName,
						description: requiredProperty(winningDefinitionNode, 'documentation') || '',
						documentation: requiredProperty(winningDefinitionNode, 'documentation') || '',
						role: definitionRole,
						[stableUriPropertyName]: mergedStableId,
						searchText: buildSearchText({
							role: definitionRole,
							name: definitionName,
							owningName,
							standardName: standardSource,
						}),
						crossRefs: JSON.stringify([]),
						parentId: contestedNamespaceNode.stableId,
						depth: 2,
						path: `${owningName} ${definitionName}`,
						pescTier: PESC_SYNTHETIC_TIER,
						syntheticRule: SYNTHETIC_RULE.MERGE,
						kind: definitionKind,
						targetNamespace: contestedNamespace,
						mergeDisposition,
						conflicting: conflictKeySet.has(oneKey),
						// the one hop to content: the merged node carries no children of its own (see
						// header), so a consumer that wants the definition's body walks to this node.
						contentFromStableId: winningDefinitionNode.stableId,
						supersededStableId: supersededDefinitionNode === null ? '' : supersededDefinitionNode.stableId,
						// the SIGNATURE-BASED, SYMMETRIC merge delta (R-P4-5, R-P4-6). The retired
						// 'lostChildElementNames' property is deliberately NOT written under any name
						// close to it: a name-only loss record cannot express a rebinding and misled.
						absentChildElementSignatures: JSON.stringify(deltaSignatures.absent),
						absentChildElementCount: deltaSignatures.absent.length,
						reboundChildElementSignatures: JSON.stringify(deltaSignatures.rebound),
						reboundChildElementCount: deltaSignatures.rebound.length,
						widenedChildElementSignatures: JSON.stringify(deltaSignatures.widened),
						widenedChildElementCount: deltaSignatures.widened.length,
						addedChildElementSignatures: JSON.stringify(deltaSignatures.added),
						addedChildElementCount: deltaSignatures.added.length,
					},
				});
				mergedDefinitionStableIdByKey[oneKey] = mergedStableId;
				(mergedDefinitionsByName[definitionName] = mergedDefinitionsByName[definitionName] || []).push({
					kind: definitionKind,
					stableId: mergedStableId,
				});

				addSyntheticEdge(
					'MERGED_FROM',
					mergedStableId,
					winningDefinitionNode.stableId,
					SYNTHETIC_RULE.MERGE,
					{
						mergeRole: isShared ? 'winner' : 'onlyMember',
						branch:
							collegeDefinitionMap[oneKey] !== undefined ? 'collegeTranscript' : 'testScore',
						declaringArtifactSha256: requiredProperty(winningDefinitionNode, 'declaringArtifactSha256'),
					},
				);
				if (isShared) {
					const loserDefinitionNode = testScoreDefinitionMap[oneKey];
					addSyntheticEdge(
						'MERGED_FROM',
						mergedStableId,
						loserDefinitionNode.stableId,
						SYNTHETIC_RULE.MERGE,
						{
							mergeRole: conflictKeySet.has(oneKey) ? 'superseded' : 'identical',
							branch: 'testScore',
							declaringArtifactSha256: requiredProperty(loserDefinitionNode, 'declaringArtifactSha256'),
							// SYMMETRIC on the provenance edge too: the superseded member's own edge
							// carries both directions of the delta, so a consumer walking MERGED_FROM
							// backwards learns what this member lost AND what the merge added to it.
							absentChildElementCount: deltaSignatures.absent.length,
							reboundChildElementCount: deltaSignatures.rebound.length,
							widenedChildElementCount: deltaSignatures.widened.length,
							addedChildElementCount: deltaSignatures.added.length,
						},
					);
				}
			});

			// =============================================================
			// S-2 — the alias namespace and its SERVED_BY hop
			// =============================================================
			// harvest the absent-namespace facts the derived tier recorded. The set must be exactly
			// the one namespace S-2 rules on; a second absent namespace is a second decision.
			const absentNamespaceReferenceEntries = [];
			const absentNamespaceImportEntries = [];
			nodes.forEach((oneNode) => {
				const referenceAnnotation = oneNode.properties[ABSENT_NAMESPACE_REFERENCE_ANNOTATION];
				if (referenceAnnotation !== undefined) {
					JSON.parse(referenceAnnotation).forEach((oneEntry) =>
						absentNamespaceReferenceEntries.push(oneEntry),
					);
				}
				const importAnnotation = oneNode.properties[ABSENT_NAMESPACE_IMPORT_ANNOTATION];
				if (importAnnotation !== undefined) {
					absentNamespaceImportEntries.push(JSON.parse(importAnnotation));
				}
			});
			const absentNamespaces = [
				...new Set([
					...absentNamespaceReferenceEntries.map((oneEntry) => oneEntry.namespace),
					...absentNamespaceImportEntries.map((oneEntry) => oneEntry.namespaceAsWritten),
				]),
			].sort();
			if (absentNamespaces.length !== 1 || absentNamespaces[0] !== S2_ABSENT_NAMESPACE) {
				refuse(
					`S-2 aliases exactly ONE absent namespace ('${S2_ABSENT_NAMESPACE}'), but the derived ` +
						`tier recorded references into [${absentNamespaces.join(', ') || 'none'}]. An absent ` +
						`namespace S-2 never ruled on cannot be served by S-2's substitution`,
				);
			}
			const servingNamespaceNode = namespaceNodeByNamespace[S2_SERVING_NAMESPACE];
			if (servingNamespaceNode === undefined) {
				refuse(
					`S-2 substitutes '${S2_SERVING_NAMESPACE}' for the absent '${S2_ABSENT_NAMESPACE}', but ` +
						`no namespace node for the substitute exists in the graph`,
				);
			}
			const servingArtifactNodes = artifactNodesByNamespace[S2_SERVING_NAMESPACE];
			if (servingArtifactNodes === undefined || servingArtifactNodes.length !== 1) {
				refuse(
					`S-2's substitute namespace '${S2_SERVING_NAMESPACE}' is claimed by ` +
						`${servingArtifactNodes === undefined ? 0 : servingArtifactNodes.length} artifacts; the ` +
						`alias needs exactly one file to stand behind it`,
				);
			}
			const servingArtifactNode = servingArtifactNodes[0];

			const aliasNamespaceStableId = `pescNamespace:${S2_ABSENT_NAMESPACE}`;
			const aliasUrnMatch = S2_ABSENT_NAMESPACE.match(/^urn:org:pesc:([^:]+):([^:]+):(v[\d.]+)$/);
			if (!aliasUrnMatch) {
				refuse(
					`S-2's absent namespace '${S2_ABSENT_NAMESPACE}' is not a PESC URN of the form ` +
						`urn:org:pesc:<layer>:<name>:<version>`,
				);
			}
			addSyntheticNode({
				labels: [NODE_LABELS.FORGED_NODE, 'PescNamespace', DME_ROLES.SUPPORT],
				stableId: aliasNamespaceStableId,
				role: DME_ROLES.SUPPORT,
				properties: {
					_id: aliasNamespaceStableId,
					_source: standardSource,
					name: S2_ABSENT_NAMESPACE,
					description:
						`PESC namespace ${aliasUrnMatch[2]} ${aliasUrnMatch[3]} — ABSENT from the corpus; ` +
						`served by ${S2_SERVING_NAMESPACE} under synthetic rule ${SYNTHETIC_RULE.ALIAS}`,
					documentation: '',
					role: DME_ROLES.SUPPORT,
					[stableUriPropertyName]: aliasNamespaceStableId,
					searchText: buildSearchText({
						role: DME_ROLES.SUPPORT,
						name: S2_ABSENT_NAMESPACE,
						owningName: `${aliasUrnMatch[2]} ${aliasUrnMatch[3]}`,
						standardName: standardSource,
					}),
					crossRefs: JSON.stringify([]),
					parentId: rootNode.stableId,
					depth: 1,
					path: S2_ABSENT_NAMESPACE,
					pescTier: PESC_SYNTHETIC_TIER,
					syntheticRule: SYNTHETIC_RULE.ALIAS,
					layer: aliasUrnMatch[1],
					standardToken: aliasUrnMatch[2],
					version: aliasUrnMatch[3],
					isLatest: false,
					contested: false,
					artifactCount: 0,
					servedByNamespace: S2_SERVING_NAMESPACE,
					servedByStableId: servingNamespaceNode.stableId,
				},
			});
			addSyntheticEdge(
				'SERVED_BY',
				aliasNamespaceStableId,
				servingNamespaceNode.stableId,
				SYNTHETIC_RULE.ALIAS,
				{ absentNamespace: S2_ABSENT_NAMESPACE, servingNamespace: S2_SERVING_NAMESPACE },
			);

			// the absent import itself: the written import decl resolves onto the ALIAS namespace (so
			// the hop is visible), and the artifact gains the IMPORTS edge the derived tier could not
			// compute, marked synthetic and naming the alias it travelled through.
			absentNamespaceImportEntries
				.slice()
				.sort((entryA, entryB) => (entryA.fromStableId < entryB.fromStableId ? -1 : 1))
				.forEach((oneEntry) => {
					addSyntheticEdge(
						'RESOLVES_TO',
						oneEntry.fromStableId,
						aliasNamespaceStableId,
						SYNTHETIC_RULE.ALIAS,
						{ referenceVariety: 'import', writtenAs: oneEntry.namespaceAsWritten, targetKind: 'namespace' },
					);
					const importDeclNode = nodeByStableId[oneEntry.fromStableId];
					if (importDeclNode === undefined) {
						refuse(
							`the recorded unresolved import names node '${oneEntry.fromStableId}', which is not ` +
								`in the graph`,
						);
					}
					addSyntheticEdge(
						'IMPORTS',
						requiredProperty(importDeclNode, 'parentId'),
						servingArtifactNode.stableId,
						SYNTHETIC_RULE.ALIAS,
						{
							namespace: S2_ABSENT_NAMESPACE,
							servedByNamespace: S2_SERVING_NAMESPACE,
							importDeclStableId: oneEntry.fromStableId,
						},
					);
				});

			// the references written against the absent namespace: resolved to the SERVING
			// namespace's real definitions. Every one must resolve or the alias is not safe and the
			// tier refuses BY NAME rather than shipping a partial substitution.
			const aliasResolvedLocalNames = new Set();
			absentNamespaceReferenceEntries
				.slice()
				.sort((entryA, entryB) =>
					`${entryA.fromStableId} ${entryA.referenceVariety} ${entryA.writtenAs}` <
					`${entryB.fromStableId} ${entryB.referenceVariety} ${entryB.writtenAs}`
						? -1
						: 1,
				)
				.forEach((oneEntry) => {
					const admissibleKinds = ADMISSIBLE_TARGET_KINDS[oneEntry.referenceVariety];
					if (admissibleKinds === undefined) {
						refuse(
							`recorded absent-namespace reference '${oneEntry.writtenAs}' has reference variety ` +
								`'${oneEntry.referenceVariety}', which names no admissible target kind`,
						);
					}
					const candidateDefinitionNodes = (
						sourceDefinitionsByNamespaceAndName[`${S2_SERVING_NAMESPACE} ${oneEntry.localName}`] || []
					).filter(
						(oneDefinitionNode) => admissibleKinds.indexOf(oneDefinitionNode.properties.kind) !== -1,
					);
					if (candidateDefinitionNodes.length === 0) {
						refuse(
							`S-2 substitution INCOMPLETE: file '${oneEntry.declaringFilename}' writes ` +
								`'${oneEntry.writtenAs}' against the absent '${S2_ABSENT_NAMESPACE}', and ` +
								`'${S2_SERVING_NAMESPACE}' declares no ${admissibleKinds.join('/')} named ` +
								`'${oneEntry.localName}'. An alias that resolves most references is a forgery ` +
								`that also does not work`,
						);
					}
					if (candidateDefinitionNodes.length > 1) {
						refuse(
							`S-2 substitution AMBIGUOUS: '${oneEntry.writtenAs}' matches ` +
								`${candidateDefinitionNodes.length} definitions in '${S2_SERVING_NAMESPACE}'`,
						);
					}
					aliasResolvedLocalNames.add(oneEntry.localName);
					addSyntheticEdge(
						'RESOLVES_TO',
						oneEntry.fromStableId,
						candidateDefinitionNodes[0].stableId,
						SYNTHETIC_RULE.ALIAS,
						{
							referenceVariety: oneEntry.referenceVariety,
							writtenAs: oneEntry.writtenAs,
							viaAliasNamespace: S2_ABSENT_NAMESPACE,
							servingNamespace: S2_SERVING_NAMESPACE,
						},
					);
				});

			// =============================================================
			// the 201 held references — answered by S-1
			// =============================================================
			const heldReferenceEntries = [];
			nodes.forEach((oneNode) => {
				const heldAnnotation = oneNode.properties[HELD_REFERENCE_ANNOTATION];
				if (heldAnnotation !== undefined) {
					JSON.parse(heldAnnotation).forEach((oneEntry) => heldReferenceEntries.push(oneEntry));
				}
			});
			const heldReferenceCountsByVariety = {};
			const heldConsumerFilenames = new Set();
			const heldResolvedTargetByWrittenName = {};
			heldReferenceEntries
				.slice()
				.sort((entryA, entryB) =>
					`${entryA.fromStableId} ${entryA.referenceVariety} ${entryA.writtenAs}` <
					`${entryB.fromStableId} ${entryB.referenceVariety} ${entryB.writtenAs}`
						? -1
						: 1,
				)
				.forEach((oneEntry) => {
					if (oneEntry.namespace !== contestedNamespace) {
						refuse(
							`a held reference from '${oneEntry.declaringFilename}' names namespace ` +
								`'${oneEntry.namespace}', which is not the contested namespace S-1 merged`,
						);
					}
					heldReferenceCountsByVariety[oneEntry.referenceVariety] =
						(heldReferenceCountsByVariety[oneEntry.referenceVariety] || 0) + 1;
					if (!oneEntry.intraMember) {
						heldConsumerFilenames.add(oneEntry.declaringFilename);
					}
					if (oneEntry.referenceVariety === 'import') {
						// an import writes a NAMESPACE, not a definition, so its answer is the merged set's
						// home — the contested namespace node — not any one merged definition. PROVISIONAL:
						// design §3.3 speaks only of definition targets. Recorded rather than smoothed over.
						addSyntheticEdge(
							'RESOLVES_TO',
							oneEntry.fromStableId,
							contestedNamespaceNode.stableId,
							SYNTHETIC_RULE.MERGE,
							{
								referenceVariety: 'import',
								writtenAs: oneEntry.writtenAs,
								targetKind: 'namespace',
								mergedDefinitionCount: unionKeys.length,
							},
						);
						return;
					}
					const admissibleKinds = ADMISSIBLE_TARGET_KINDS[oneEntry.referenceVariety];
					if (admissibleKinds === undefined) {
						refuse(
							`held reference '${oneEntry.writtenAs}' has reference variety ` +
								`'${oneEntry.referenceVariety}', which names no admissible target kind`,
						);
					}
					const candidateMergedDefinitions = (
						mergedDefinitionsByName[oneEntry.localName] || []
					).filter((oneCandidate) => admissibleKinds.indexOf(oneCandidate.kind) !== -1);
					if (candidateMergedDefinitions.length === 0) {
						refuse(
							`HELD REFERENCE STILL UNRESOLVED after S-1: file '${oneEntry.declaringFilename}' ` +
								`writes '${oneEntry.writtenAs}' (${oneEntry.referenceVariety}) into ` +
								`'${contestedNamespace}', and the merged set of ${unionKeys.length} definitions ` +
								`declares no ${admissibleKinds.join('/')} named '${oneEntry.localName}'. The merge ` +
								`did not do the job it exists to do; dropping the reference silently would hide that`,
						);
					}
					if (candidateMergedDefinitions.length > 1) {
						refuse(
							`held reference '${oneEntry.writtenAs}' matches ${candidateMergedDefinitions.length} ` +
								`merged definitions — one symbol space should hold one`,
						);
					}
					heldResolvedTargetByWrittenName[oneEntry.localName] =
						candidateMergedDefinitions[0].stableId;
					addSyntheticEdge(
						'RESOLVES_TO',
						oneEntry.fromStableId,
						candidateMergedDefinitions[0].stableId,
						SYNTHETIC_RULE.MERGE,
						{
							referenceVariety: oneEntry.referenceVariety,
							writtenAs: oneEntry.writtenAs,
							intraMember: oneEntry.intraMember,
							candidateCountBeforeMerge: (oneEntry.candidateStableIds || []).length,
						},
					);
				});

			const stats = {
				contestedNamespace,
				collegeTranscriptMemberSha256: collegeMemberNode.properties.sha256,
				collegeTranscriptMemberFilename: collegeMemberNode.properties.filename,
				testScoreMemberSha256: testScoreMemberNode.properties.sha256,
				testScoreMemberFilename: testScoreMemberNode.properties.filename,
				mergedDefinitions: unionKeys.length,
				collegeTranscriptOnlyDefinitions: collegeOnlyKeys.length,
				testScoreOnlyDefinitions: testScoreOnlyKeys.length,
				sharedDefinitions: sharedKeys.length,
				conflictingSharedDefinitions: conflictRecords.length,
				collegeSupersetConflicts: conflictRecords.filter((oneRecord) => oneRecord.collegeIsSuperset)
					.length,
				// R-P4-5 / R-P4-6: the merge delta, classified and SYMMETRIC. 'lostChildElements' is
				// gone — it counted rebindings and a widening as losses and was wrong by a factor of four.
				absentChildElements: absentChildElements.length,
				reboundChildElements: reboundChildElements.length,
				widenedChildElements: widenedChildElements.length,
				addedChildElements: addedChildElements.length,
				mergedFromEdges: syntheticEdges.filter((oneEdge) => oneEdge.type === 'MERGED_FROM').length,
				heldReferencesResolved: heldReferenceEntries.length,
				heldReferenceCountsByVariety,
				heldExternalConsumerFilenames: [...heldConsumerFilenames].sort(),
				aliasNamespace: S2_ABSENT_NAMESPACE,
				aliasServingNamespace: S2_SERVING_NAMESPACE,
				aliasReferencesResolved: absentNamespaceReferenceEntries.length,
				aliasDistinctLocalNames: aliasResolvedLocalNames.size,
				aliasImportsResolved: absentNamespaceImportEntries.length,
				syntheticNodes: syntheticNodes.length,
				syntheticEdges: syntheticEdges.length,
			};

			const mergeReport = {
				contestedNamespace,
				collegeTranscriptMember: {
					filename: collegeMemberNode.properties.filename,
					sha256: collegeMemberNode.properties.sha256,
					definitionCount: definitionNodesByArtifactSha256[collegeMemberNode.properties.sha256].length,
				},
				testScoreMember: {
					filename: testScoreMemberNode.properties.filename,
					sha256: testScoreMemberNode.properties.sha256,
					definitionCount: definitionNodesByArtifactSha256[testScoreMemberNode.properties.sha256].length,
				},
				collegeOnlyKeys,
				testScoreOnlyKeys,
				sharedKeys,
				conflictRecords,
				absentChildElements,
				reboundChildElements,
				widenedChildElements,
				addedChildElements,
				mergedDefinitionStableIdByKey,
			};

			return { nodes: syntheticNodes, edges: syntheticEdges, stats, mergeReport };
		};

		// =====================================================================
		// canonicalizeSyntheticView — the SYNTHETIC CONTENT of a combined graph as one canonical
		// string. G4-A (reproducibility, R-VAL-5) compares two of these.
		// =====================================================================
		const canonicalizeSyntheticView = ({ nodes, edges }) => {
			const syntheticNodeViews = nodes
				.filter((oneNode) => oneNode.properties.pescTier === PESC_SYNTHETIC_TIER)
				.map((oneNode) => ({
					stableId: oneNode.stableId,
					labels: [...oneNode.labels].sort(),
					properties: sortedKeyObject(oneNode.properties),
				}))
				.sort((viewA, viewB) => (viewA.stableId < viewB.stableId ? -1 : 1));
			const syntheticEdgeViews = edges
				.filter((oneEdge) => oneEdge.properties.pescTier === PESC_SYNTHETIC_TIER)
				.map((oneEdge) => ({
					type: oneEdge.type,
					from: oneEdge.fromRef.id,
					to: oneEdge.toRef.id,
					properties: sortedKeyObject(oneEdge.properties),
				}))
				.sort((viewA, viewB) => {
					const keyA = `${viewA.type} ${viewA.from} ${viewA.to} ${JSON.stringify(viewA.properties)}`;
					const keyB = `${viewB.type} ${viewB.from} ${viewB.to} ${JSON.stringify(viewB.properties)}`;
					return keyA < keyB ? -1 : 1;
				});
			return JSON.stringify({ syntheticNodes: syntheticNodeViews, syntheticEdges: syntheticEdgeViews });
		};

		return {
			buildSyntheticTier,
			canonicalizeSyntheticView,
			SYNTHETIC_RULE,
			S1_COLLEGE_BRANCH_MARKER_NAMES,
			S1_TEST_SCORE_BRANCH_MARKER_NAMES,
			S2_ABSENT_NAMESPACE,
			S2_SERVING_NAMESPACE,
			PESC_SOURCE_TIER,
			PESC_DERIVED_TIER,
			PESC_SYNTHETIC_TIER,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
