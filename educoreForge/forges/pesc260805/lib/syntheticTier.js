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
const { NODE_LABELS, DME_ROLES, PROVENANCE_TIER, EDGE_TYPES } = require(
	path.join(CORE_LIB, 'vocabulary', 'vocabulary'),
);
// searchTextComposition — the HYBRID composition's ONE DECISION SITE, imported rather than
// reimplemented. S-1c's merged children REBUILD their searchText (searchText is in
// DUPLICATED_CHILD_OVERRIDDEN_PROPERTY_NAMES below) rather than inheriting it, so this tier is a
// second ASSEMBLY site for the same decision. SABLE_RIVER ruled 2026-08-17 that the merged children
// take the hybrid: §6.1's synthetic exclusion governs the SCOPE OF JUDGMENT — what gets mapped —
// not how the forge composes its own node text, and two nodes with the same name, type and
// description carrying differently-shaped embedded text is the worse outcome. Calling the shared
// composer here instead would leave them on C0 and produce exactly that split.
const searchTextCompositionFactory = require('./searchTextComposition');

// IMPORTED, NOT DUPLICATED — and the contrast with ADMISSIBLE_TARGET_KINDS below is deliberate.
// That table is a JUDGMENT about XSD symbol spaces, so the two tiers holding it separately lets
// them disagree LOUDLY. This is a mechanical REGISTRY OF NAMES, and the only thing divergence
// could produce is a silent leak: S-1c copies a source child's whole property bag, so any derived
// annotation this list fails to name rides along onto a synthetic node, where the derived tier can
// neither regenerate nor strip it. Measured, not theorised — the first build leaked
// 'ambiguousPendingSynthesis' onto 134 duplicated children and moved the Gate 3 regeneration
// compare by 94,051 canonical bytes.
const { DERIVED_ANNOTATION_PROPERTY_NAMES } = require('./derivedTier')();

const PESC_SOURCE_TIER = 'source';
const PESC_DERIVED_TIER = 'derived';
const PESC_SYNTHETIC_TIER = 'synthetic';

// S-1c is a SUB-RULE of S-1, not a third judgment: the merge decides WHICH definitions exist and
// which branch's declaration each child publishes; S-1c materialises that decision as nodes. It
// gets its own id anyway, so the census can count merged DEFINITIONS apart from merged CHILDREN
// and so the Gate 4.6a regeneration lever can strip precisely the children. 'S-3' is deliberately
// NOT reused — D-2 struck it, and a retired id returning with a new meaning is grep poison.
const SYNTHETIC_RULE = { MERGE: 'S-1', ALIAS: 'S-2', MERGED_CHILD: 'S-1c' };

// R-P4-10 (RULED 2026-08-06, session JADE_PORTAL): the child union is a UNION ACROSS BOTH
// BRANCHES, not winner-takes-all. The ground is not criterion 1's wording but two already-ratified
// rulings: R-P3-1 made S-1 a union at TYPE level (42 college-only + 36 test-score-only + 31
// shared), and a merge that carries test-score-only TYPES while dropping test-score-only CHILDREN
// is a union at one granularity and winner-takes-all at another — incoherent rather than a policy.
// R-P4-6 then required the record to be SYMMETRIC; dropping the two would make the MERGE ITSELF
// one-sided in the winner's favour, a worse form of the sin R-P4-6 ended.
//
// The union is keyed by NAME, and that is safe because it was MEASURED: across both collision
// members no definition declares one child name twice (probe mp_probeChildUnionHazards). Where
// both branches declare a name with DIFFERENT signatures the winner rule already decided, and the
// merged child publishes the winner's declaration — emitting both would hand the consumer a choice
// the synthesis already made, which is R-P4-3's own disqualifying condition.
const MERGED_CHILD_CONTRIBUTING_BRANCH = { COLLEGE: 'collegeTranscript', TEST_SCORE: 'testScore' };

// how a merged child came to be, recorded on the child itself so the union is auditable per node
// rather than only in aggregate.
const MERGED_CHILD_UNION_DISPOSITION = {
	// the name exists in one branch only, and that branch is the winner of the definition
	SOLE_BRANCH: 'soleBranchDeclaration',
	// both branches declare the name with the SAME signature AND the same content — nothing decided
	BOTH_BRANCHES_AGREE: 'bothBranchesAgree',
	// GAP 3 (independent review, 2026-08-06). The signature is name + resolved type + cardinality.
	// Two declarations can match on all four and still DIFFER in what they say — documentation
	// above all, which R-VAL-2's verbatim discipline exists to protect. Three children do exactly
	// that here: the college member carries real prose and the test-score member an empty string,
	// and the union takes the winner's. Stamping those 'bothBranchesAgree' asserted that NOTHING
	// was decided while a choice was being made silently — which is §8f's sin precisely, a record
	// that misleads a reader who consults it. They get their own disposition, and the child names
	// which properties the choice covered.
	BOTH_BRANCHES_AGREE_CONTENT_DECIDED: 'bothBranchesAgreeSignatureContentDecided',
	// both branches declare the name with DIFFERENT signatures; the winner's is published
	WINNER_CHOSEN_OVER_LOSER: 'winnerChosenOverLoser',
	// the LOSING branch declares a name the winner does not — R-P4-10's two
	LOSING_BRANCH_CONTRIBUTED: 'losingBranchContributed',
};

// the properties a duplicated child OVERRIDES. Each MUST already exist on the source child: a name
// that does not is a misspelling, and this campaign has twice produced confident figures from one.
const DUPLICATED_CHILD_OVERRIDDEN_PROPERTY_NAMES = [
	'_id',
	'parentId',
	'depth',
	'path',
	'pescTier',
	'searchText',
	'sequencePosition',
	// THE RENDERING SEAT (P1-R8, LUNAR_PRISM 2026-08-17). These three belong HERE, with searchText,
	// and NOT in DERIVED_ANNOTATION_PROPERTY_NAMES — i.e. RECOMPOSED FRESH for the merged child
	// rather than stripped from it. SABLE_RIVER ruled the reason decisive and it is a CORRECTNESS
	// argument, not a mechanical one:
	//
	//   A BULK-COPIED owningTypeName WOULD BE A FALSE STATEMENT ABOUT THE GRAPH. The merged child's
	//   owner IS the merged definition, not the source child's container — this file already says so
	//   in its own comment at the composition site, which is precisely why the element is assembled
	//   here instead of reused from the source tier. STRIPPING LEAVES A HOLE; COPYING STATES A
	//   FALSEHOOD; RECOMPOSING IS THE ONLY OPTION THAT IS CORRECT.
	//
	// The supporting reason is SABLE_RIVER's own Q2 ruling, which turns out to have a second edge
	// nobody noticed: two nodes sharing name, type and description must not carry differently-shaped
	// emitted text for a reason no reader could reconstruct. A merged child carrying searchText but
	// NOT effectiveDescription is that same split, one field over.
	//
	// ⚠️ AND THE OMISSION HERE WOULD HAVE BEEN SILENT. Unregistered, these three would enter
	// inheritedPropertyNamesOf below (GAP 3) and could change decidedNonSignaturePropertyNames, which
	// is STAMPED ONTO THE NODE — census content moving quietly through a path with nothing to do with
	// the evidence seat they were added for, and NO EXISTING INSTRUMENT WOULD HAVE SAID A WORD.
	// A COMPANION EDIT WHOSE OMISSION IS SILENT NEEDS A LEVER THAT MAKES THE OMISSION LOUD, so one
	// ships with it.
	'effectiveDescription',
	'owningTypeName',
	'proseSource',
];

// the properties a duplicated child ADDS. Each MUST NOT already exist on the source child, or the
// copy would be silently overwriting something the source said with synthetic bookkeeping.
const DUPLICATED_CHILD_ADDED_PROPERTY_NAMES = [
	'syntheticRule',
	'copiedFromStableId',
	'contributedByBranch',
	'contributedByArtifactSha256',
	'sourceSequencePosition',
	'childUnionDisposition',
	'mergedDefinitionStableId',
	// GAP 3: which inherited properties the union CHOSE between when both branches declared this
	// name. '[]' when nothing was chosen — an empty array rather than an absent property, so a
	// consumer can tell "nothing was decided" from "this node predates the record".
	'decidedNonSignaturePropertyNames',
];

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
		const { composeOneSearchText, buildResolvesToIndex, resolveEffectiveDescription, seatPropertiesFor } =
			searchTextCompositionFactory();

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

		// =====================================================================
		// THE INVENTION CHECK (Gate 4.6a's first lever)
		// =====================================================================
		// mergedChildDeclarationKey — the key under which a merged child's declaration is looked up
		// when proving some branch DECLARED it. It carries the owning definition, so a child cannot
		// be judged "declared" on the strength of a same-named element belonging to a different type
		// — the precise laxness that let R-P4-7's predecessor gate match by name over a superset of
		// its own haystack and become unable to fail.
		const mergedChildDeclarationKey = ({ definitionKey, name, typeAsWritten, minOccurs, maxOccurs }) =>
			JSON.stringify([definitionKey, name, typeAsWritten, minOccurs, maxOccurs]);

		// verifyMergedChildrenWereDeclared — every duplicated child must carry a signature some
		// collision member actually declares, for the type it hangs under. A union that can emit what
		// no source declares is round-trip INVENTION, the one failure this campaign will not ship.
		//
		// DECLARED AT MODULE SCOPE AND EXPORTED DELIBERATELY. In production this check cannot fail:
		// children are built by COPYING branch declarations, so the property it asserts is true by
		// construction. A check that is true by construction is exactly the vacuous gate this campaign
		// keeps finding — it passes green having proved nothing. Making it a pure function of its two
		// inputs is what lets the gate suite hand it a FABRICATED record and observe it refuse, which
		// is the only honest way to show the checker distinguishes anything at all. The limitation is
		// real and stated rather than hidden: the lever operates on the checker's input, because the
		// production path has no route to invention.
		const verifyMergedChildrenWereDeclared = ({
			mergedChildDeclarationRecords,
			declaredChildDeclarationKeys,
		}) => {
			if (!Array.isArray(mergedChildDeclarationRecords)) {
				refuse('verifyMergedChildrenWereDeclared requires a mergedChildDeclarationRecords array');
			}
			if (!(declaredChildDeclarationKeys instanceof Set)) {
				refuse('verifyMergedChildrenWereDeclared requires declaredChildDeclarationKeys as a Set');
			}
			const undeclaredRecords = mergedChildDeclarationRecords.filter(
				(oneRecord) => !declaredChildDeclarationKeys.has(mergedChildDeclarationKey(oneRecord)),
			);
			if (undeclaredRecords.length !== 0) {
				const firstUndeclared = undeclaredRecords[0];
				refuse(
					`S-1c INVENTION: ${undeclaredRecords.length} duplicated child declaration(s) carry a ` +
						`signature NO collision member declares for their owning type. First: ` +
						`'${firstUndeclared.definitionKey}' child '${firstUndeclared.name}' as ` +
						`'${firstUndeclared.typeAsWritten}' [${firstUndeclared.minOccurs}..` +
						`${firstUndeclared.maxOccurs}] on merged node '${firstUndeclared.mergedDefinitionStableId}'. ` +
						`A merged type may publish only what some source file says; emitting anything else ` +
						`would put a fabricated element into a re-emitted PESC schema`,
				);
			}
			return mergedChildDeclarationRecords.length;
		};

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

			// RESOLVES_TO index, for the hybrid composition of S-1c's merged children. Built ONCE from
			// the edges this tier was handed — which INCLUDE the derived tier's RESOLVES_TO, because
			// buildSyntheticTier reads the combined source+derived+meta graph. A merged child's
			// effective description is resolved through its SOURCE child's edge, not its own: the
			// synthetic child's RESOLVES_TO is emitted later in this same pass and does not exist yet
			// when the child node is built.
			const resolvesToTargetsByFromStableId = buildResolvesToIndex(edges);

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
			// S-1c — the DIRECT children a merged definition duplicates (R-P4-3)
			// =============================================================
			// DELIBERATELY NOT childElementSignatureOf. That walk FLATTENS a whole subtree, which is
			// correct for a signature census (a census does not care about shape) and wrong for a
			// duplication (a duplicated child must keep its shape or the merged type is a lie about
			// its own structure). This walk is ONE level and refuses anything it would have to
			// flatten or drop.
			//
			// MEASURED, THEN ENFORCED. Against the shipped corpus every one of the 520 direct
			// children of the 109 content-source definitions is a PescElementDecl and NONE has a
			// child of its own — so one level IS the whole subtree here, and duplication loses
			// nothing. That is a fact about this corpus, not a property of XSD, so it is asserted
			// rather than assumed: a nested container or an attribute/derivation child arriving in
			// a future corpus would silently produce a shallow or lossy merged type, and instead it
			// REFUSES BY NAME.
			// MEASURED, NOT ASSUMED — and the first measurement was WRONG, which is why this reads the
			// way it does. A census taken over HAS_PROPERTY EDGES reports 757 element declarations
			// under the 140 contested definitions and nothing else. The forge does not index
			// containment by that edge; it indexes by the parentId PROPERTY, and over THAT index the
			// same population carries 757 element declarations AND 43 PescDerivation wrappers, with
			// 6 PescAnonymousType nodes one level further down. Two independent censuses agreed with
			// each other because both used the edge basis — agreement on a shared assumption, which
			// proves less than one measurement that questions it.
			//
			// SCOPE (option (c), pending ratification): element declarations are DUPLICATED, because
			// that is the deliverable's literal subject. Derivation wrappers and inline anonymous
			// types are RECORDED WITH A DIRECT POINTER and not duplicated. That is not a dodge of
			// R-P4-3: the disqualifying fact R-P4-3 named was that the MERGED_FROM hop reached TWO
			// BRANCHES, so the consumer had to re-decide the merge. A single pointer into the branch
			// the synthesis already chose forces no choice on anybody. Anything OTHER than these two
			// kinds refuses by name — an attribute declaration or an unforeseen node kind really
			// would be dropped silently, and that is the defect this phase exists to end.
			const containmentChildrenOfContainer = (containerStableId, containerDescription) => {
				const elementChildNodes = [];
				const derivationChildNodes = [];
				(childrenByParentId[containerStableId] || []).forEach((oneChild) => {
					if (labelHas(oneChild, 'PescElementDecl')) {
						elementChildNodes.push(oneChild);
						return;
					}
					if (labelHas(oneChild, 'PescDerivation')) {
						derivationChildNodes.push(oneChild);
						return;
					}
					refuse(
						`S-1c cannot account for a child of ${containerDescription}: ` +
							`'${oneChild.stableId}' is ${oneChild.labels.join('+')}, which is neither an element ` +
							`declaration (duplicated) nor a derivation wrapper (recorded by pointer). Duplicating ` +
							`around it would drop it silently, and a merged type quietly missing content is the ` +
							`empty-render defect R-P4-3 exists to end`,
					);
				});
				elementChildNodes.sort(
					(childA, childB) =>
						requiredProperty(childA, 'sequencePosition') -
						requiredProperty(childB, 'sequencePosition'),
				);
				// GAP 5 (independent review, 2026-08-06): the child union is keyed by NAME, and until
				// now that was warranted only by a probe — measured once, asserted nowhere, and
				// therefore free to stop being true without anything noticing. XSD does NOT guarantee
				// name uniqueness within a type: a repeated element inside a choice, or a second
				// sequence, can declare one name twice. If that ever arrives, a name-keyed union
				// silently collapses two distinct declarations into one. It refuses here instead.
				const childCountByName = {};
				elementChildNodes.forEach((oneChildNode) => {
					const oneChildName = requiredProperty(oneChildNode, 'name');
					childCountByName[oneChildName] = (childCountByName[oneChildName] || 0) + 1;
				});
				const repeatedChildNames = Object.keys(childCountByName).filter(
					(oneChildName) => childCountByName[oneChildName] > 1,
				);
				if (repeatedChildNames.length !== 0) {
					refuse(
						`S-1c cannot union the children of ${containerDescription} by NAME: it declares ` +
							`${repeatedChildNames.map((oneChildName) => `'${oneChildName}' ${childCountByName[oneChildName]} times`).join(', ')}. ` +
							`R-P4-10's union is name-keyed, and it is name-keyed because no definition in ` +
							`either collision member was measured to repeat a child name. A repeat means that ` +
							`warrant has expired: keying by name would silently collapse two distinct ` +
							`declarations into one, which is invention by subtraction and needs a new ruling`,
					);
				}

				elementChildNodes.forEach((oneChildNode) => {
					(childrenByParentId[oneChildNode.stableId] || []).forEach((oneGrandChild) => {
						if (!labelHas(oneGrandChild, 'PescAnonymousType')) {
							refuse(
								`S-1c cannot account for what hangs under child '${oneChildNode.stableId}' of ` +
									`${containerDescription}: '${oneGrandChild.stableId}' is ` +
									`${oneGrandChild.labels.join('+')}, and only an inline anonymous type is ` +
									`provided for. Copying the declaration and abandoning this would publish a ` +
									`merged child whose content silently vanished`,
							);
						}
					});
				});
				return { elementChildNodes, derivationChildNodes };
			};

			// the inline anonymous type a source element declaration owns, or '' when it has none.
			// Empty string rather than null deliberately: Neo4j has no null property, so a null here
			// would arrive as ABSENT and be indistinguishable from a property nobody wrote (the trap
			// design §8g records for Phase 5's emitter).
			const inlineTypeStableIdOf = (oneChildNode) => {
				const anonymousTypeNodes = (childrenByParentId[oneChildNode.stableId] || []).filter(
					(oneGrandChild) => labelHas(oneGrandChild, 'PescAnonymousType'),
				);
				if (anonymousTypeNodes.length > 1) {
					refuse(
						`S-1c met element declaration '${oneChildNode.stableId}' owning ` +
							`${anonymousTypeNodes.length} inline anonymous types; one declaration has at most one ` +
							`inline type, so the model this rule was written against no longer holds`,
					);
				}
				return anonymousTypeNodes.length === 0 ? '' : anonymousTypeNodes[0].stableId;
			};

			// duplicateChildOntoMergedDefinition — build ONE synthetic PescElementDecl from ONE source
			// child declaration. The whole property bag is copied and then explicitly overridden, so a
			// scalar the parser adds later travels automatically instead of being silently dropped by
			// an enumerated whitelist. The two guards below are what make that safe.
			const duplicateChildOntoMergedDefinition = ({
				sourceChildNode,
				mergedDefinitionStableId,
				mergedDefinitionName,
				mergedDefinitionPath,
				mergedSequencePosition,
				contributingBranch,
				contributingArtifactSha256,
				childUnionDisposition,
				decidedNonSignaturePropertyNames,
			}) => {
				if (!Array.isArray(decidedNonSignaturePropertyNames)) {
					refuse(
						`S-1c cannot duplicate '${sourceChildNode.stableId}': no ` +
							`decidedNonSignaturePropertyNames array was supplied. A child that cannot say ` +
							`WHETHER a content choice was made is the record GAP 3 found — silence reading as ` +
							`"nothing was decided" when something was`,
					);
				}
				DUPLICATED_CHILD_OVERRIDDEN_PROPERTY_NAMES.concat([stableUriPropertyName]).forEach(
					(onePropertyName) => {
						if (
							!Object.prototype.hasOwnProperty.call(sourceChildNode.properties, onePropertyName)
						) {
							refuse(
								`S-1c cannot duplicate '${sourceChildNode.stableId}': it has no property ` +
									`'${onePropertyName}', which S-1c intends to OVERRIDE. Overriding a property that ` +
									`is not there means the name is misspelled or the source model changed, and ` +
									`writing it anyway would invent a property no element declaration carries`,
							);
						}
					},
				);
				DUPLICATED_CHILD_ADDED_PROPERTY_NAMES.forEach((onePropertyName) => {
					if (Object.prototype.hasOwnProperty.call(sourceChildNode.properties, onePropertyName)) {
						refuse(
							`S-1c cannot duplicate '${sourceChildNode.stableId}': it ALREADY carries ` +
								`'${onePropertyName}', which S-1c intends to ADD. Adding it would overwrite something ` +
								`the source declaration says with synthetic bookkeeping, and the loss would be silent`,
						);
					}
				});

				// STRIP THE DERIVED TIER'S ANNOTATIONS. A source element declaration in the contested
				// namespace legitimately carries them — 'ambiguousPendingSynthesis' above all, since
				// these are exactly the held references. Copying the property bag wholesale carries
				// them onto a SYNTHETIC node, where the derived tier can neither regenerate them nor
				// strip them, and Gate 3's delete-and-regenerate compare moves as a result. The bulk
				// copy exists so a scalar the parser adds later travels automatically; this is the
				// price of that generosity, paid explicitly.
				if (!Array.isArray(DERIVED_ANNOTATION_PROPERTY_NAMES) || DERIVED_ANNOTATION_PROPERTY_NAMES.length === 0) {
					refuse(
						`S-1c cannot strip derived annotations: derivedTier exported no ` +
							`DERIVED_ANNOTATION_PROPERTY_NAMES list. Duplicating without it would leak derived ` +
							`content onto synthetic nodes silently, so this refuses rather than copying blind`,
					);
				}
				const sourceChildPropertiesWithoutDerivedAnnotations = { ...sourceChildNode.properties };
				DERIVED_ANNOTATION_PROPERTY_NAMES.forEach((oneAnnotationName) => {
					delete sourceChildPropertiesWithoutDerivedAnnotations[oneAnnotationName];
				});

				const childName = requiredProperty(sourceChildNode, 'name');
				const childStableId = `${mergedDefinitionStableId}/el/${mergedSequencePosition}:${childName}`;

				// THE HYBRID COMPOSITION, second assembly site (ruled by SABLE_RIVER 2026-08-17).
				// The effective description is resolved through the SOURCE child — same name, same
				// typeAsWritten, same description, and it is the node the derived tier gave a RESOLVES_TO
				// edge. The merged child's own edge is emitted later in this pass, so resolving through
				// the child itself would silently find nothing and hand it the DISQUALIFIED bare-name
				// arm. That is the same ordering trap the source-tier pass exists to avoid, arriving here
				// by a different route.
				const { effectiveDescription: childEffectiveDescription, proseSource: childProseSource } = resolveEffectiveDescription({
					oneNode: sourceChildNode,
					resolvesToTargetsByFromStableId,
					nodeByStableId,
				});
				// the merged child's owning class is the MERGED definition, not the source child's
				// container — which is why this element is assembled here and not reused from the
				// source tier. Built ONCE and handed to BOTH the composer and the seat producer, so the
				// stamped owningTypeName and the composed text cannot disagree about who the owner is.
				const mergedChildSearchTextElement = {
					role: sourceChildNode.role,
					name: childName,
					owningClassName: mergedDefinitionName,
				};
				const { composedSearchText: childSearchText } = composeOneSearchText({
					searchTextElement: mergedChildSearchTextElement,
					elementName: childName,
					effectiveDescription: childEffectiveDescription,
					describedBy: `synthetic S-1c merged child '${childStableId}'`,
				});
				// THE RENDERING SEAT, SECOND ASSEMBLY SITE (P1-R8). The ONE producer is called here
				// rather than a second expression written to match it — the same reason composeOneSearchText
				// is exported rather than duplicated. Because the element above names the MERGED definition
				// as the owner, the stamped owningTypeName is the merged owner BY CONSTRUCTION, which is the
				// whole point of recomposing instead of inheriting.
				const mergedChildSeatProperties = seatPropertiesFor({
					searchTextElement: mergedChildSearchTextElement,
					effectiveDescription: childEffectiveDescription,
					proseSource: childProseSource,
					describedBy: `synthetic S-1c merged child '${childStableId}'`,
					refuse,
				});
				return addSyntheticNode({
					labels: [...sourceChildNode.labels],
					stableId: childStableId,
					role: sourceChildNode.role,
					properties: {
						...sourceChildPropertiesWithoutDerivedAnnotations,
						_id: childStableId,
						[stableUriPropertyName]: childStableId,
						parentId: mergedDefinitionStableId,
						depth: 3,
						path: `${mergedDefinitionPath}.${childName}`,
						pescTier: PESC_SYNTHETIC_TIER,
						searchText: childSearchText,
						// THE RENDERING SEAT, spread AFTER the bulk copy so the recomposed values
						// OVERRIDE the source child's inherited ones. Their names are registered in
						// DUPLICATED_CHILD_OVERRIDDEN_PROPERTY_NAMES above; the registry and this
						// spread are the two halves of one decision and must move together.
						...mergedChildSeatProperties,
						sequencePosition: mergedSequencePosition,
						syntheticRule: SYNTHETIC_RULE.MERGED_CHILD,
						copiedFromStableId: sourceChildNode.stableId,
						contributedByBranch: contributingBranch,
						contributedByArtifactSha256: contributingArtifactSha256,
						sourceSequencePosition: requiredProperty(sourceChildNode, 'sequencePosition'),
						childUnionDisposition,
						mergedDefinitionStableId,
						decidedNonSignaturePropertyNames: JSON.stringify(decidedNonSignaturePropertyNames),
					},
				});
			};

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
			// S-1c accumulators. mergedChildDeclarationRecords is the census the INVENTION check
			// verifies against the branches' own declarations; contributedChildElements is R-P4-11's
			// single branch-naming classification.
			const mergedChildDeclarationRecords = [];
			const contributedChildElements = [];
			// per merged definition, WHICH branch definitions it was built from — identities, NOT
			// counts. Recording counts here is what made the acceptance refusal vacuous the second
			// time: a count taken during the union pass agrees with the union by construction. An
			// IDENTITY lets the refusal recount from an independent basis (the HAS_PROPERTY edges)
			// and therefore lets the two disagree.
			const mergedChildBranchStableIds = {};
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

				// =========================================================
				// S-1c — COMPUTE THE CHILD UNION (R-P4-3, materialised per R-P4-10)
				// =========================================================
				// Before this phase a merged definition had out-degree 2 and rendered as an EMPTY
				// TYPE: its content sat one MERGED_FROM hop away, across TWO branches, so a consumer
				// had to pick a branch or union them — re-deciding the merge the synthesis already
				// decided. That is the disqualifying fact R-P4-3 named. These children ARE that
				// decision, written down.
				//
				// MERGED_FROM IS UNTOUCHED. Duplication supplements provenance, it does not replace
				// it: every child names the source declaration it was copied from and the collision
				// member that contributed it, so nothing published here is a claim about PESC that
				// cannot be walked back to a file.
				//
				// Computed BEFORE the merged node is created because the node publishes its own
				// contribution counts; emitted after, because an edge needs its endpoints to exist.
				const winnerBranchName =
					collegeDefinitionMap[oneKey] !== undefined
						? MERGED_CHILD_CONTRIBUTING_BRANCH.COLLEGE
						: MERGED_CHILD_CONTRIBUTING_BRANCH.TEST_SCORE;
				const loserDefinitionNodeForChildren = isShared ? testScoreDefinitionMap[oneKey] : null;
				const winnerContainment = containmentChildrenOfContainer(
					winningDefinitionNode.stableId,
					`the ${winnerBranchName} declaration of '${oneKey}'`,
				);
				const winnerChildNodes = winnerContainment.elementChildNodes;
				const loserChildNodes =
					loserDefinitionNodeForChildren === null
						? []
						: containmentChildrenOfContainer(
								loserDefinitionNodeForChildren.stableId,
								`the testScore declaration of '${oneKey}'`,
							).elementChildNodes;
				const loserChildNodeByName = {};
				loserChildNodes.forEach((oneLoserChild) => {
					loserChildNodeByName[requiredProperty(oneLoserChild, 'name')] = oneLoserChild;
				});
				const winnerChildNameSet = new Set(
					winnerChildNodes.map((oneWinnerChild) => requiredProperty(oneWinnerChild, 'name')),
				);
				// R-P4-10's two: names the LOSING branch declares that the winner does not. Keying
				// this by NAME is safe here because it was measured — across both collision members
				// no definition declares one child name twice (probe mp_probeChildUnionHazards).
				const losingBranchContributedChildNodes = loserChildNodes.filter(
					(oneLoserChild) => !winnerChildNameSet.has(requiredProperty(oneLoserChild, 'name')),
				);

				// the branch IDENTITIES, recorded before any duplication happens. Deliberately not
				// their child counts — see the declaration above.
				mergedChildBranchStableIds[mergedStableId] = {
					winnerStableId: winningDefinitionNode.stableId,
					loserStableId:
						loserDefinitionNodeForChildren === null ? null : loserDefinitionNodeForChildren.stableId,
				};

				const signatureOfChildNode = (oneChildNode) => ({
					name: requiredProperty(oneChildNode, 'name'),
					typeAsWritten: requiredProperty(oneChildNode, 'typeAsWritten'),
					minOccurs: requiredProperty(oneChildNode, 'minOccurs'),
					maxOccurs: requiredProperty(oneChildNode, 'maxOccurs'),
				});

				// the properties a duplicated child inherits from its source declaration — i.e. every
				// property that is NOT branch-specific bookkeeping S-1c overwrites anyway, and not a
				// derived annotation (stripped at duplication). These are the bytes a signature match
				// does NOT speak for, so they are where an undeclared choice can hide.
				const inheritedPropertyNamesOf = (oneChildNode) =>
					Object.keys(oneChildNode.properties).filter(
						(onePropertyName) =>
							DUPLICATED_CHILD_OVERRIDDEN_PROPERTY_NAMES.indexOf(onePropertyName) === -1 &&
							DERIVED_ANNOTATION_PROPERTY_NAMES.indexOf(onePropertyName) === -1 &&
							onePropertyName !== stableUriPropertyName,
					);

				// GAP 3: which INHERITED properties the two branches disagree about, when their
				// signatures match. A non-empty answer means the union made a content choice, and the
				// child must say so rather than claim the branches agreed.
				const decidedPropertyNamesBetween = (oneWinnerChild, oneLoserChild) => {
					const comparedPropertyNames = [
						...new Set([
							...inheritedPropertyNamesOf(oneWinnerChild),
							...inheritedPropertyNamesOf(oneLoserChild),
						]),
					].sort();
					return comparedPropertyNames.filter(
						(onePropertyName) =>
							JSON.stringify(oneWinnerChild.properties[onePropertyName]) !==
							JSON.stringify(oneLoserChild.properties[onePropertyName]),
					);
				};

				const decisionForWinnerChild = (oneWinnerChild) => {
					if (!isShared) {
						return {
							disposition: MERGED_CHILD_UNION_DISPOSITION.SOLE_BRANCH,
							decidedNonSignaturePropertyNames: [],
						};
					}
					const loserCounterpart = loserChildNodeByName[requiredProperty(oneWinnerChild, 'name')];
					if (loserCounterpart === undefined) {
						return {
							disposition: MERGED_CHILD_UNION_DISPOSITION.SOLE_BRANCH,
							decidedNonSignaturePropertyNames: [],
						};
					}
					if (
						signatureEntryKey(signatureOfChildNode(oneWinnerChild)) !==
						signatureEntryKey(signatureOfChildNode(loserCounterpart))
					) {
						return {
							disposition: MERGED_CHILD_UNION_DISPOSITION.WINNER_CHOSEN_OVER_LOSER,
							decidedNonSignaturePropertyNames: decidedPropertyNamesBetween(
								oneWinnerChild,
								loserCounterpart,
							),
						};
					}
					const decidedNonSignaturePropertyNames = decidedPropertyNamesBetween(
						oneWinnerChild,
						loserCounterpart,
					);
					return {
						disposition:
							decidedNonSignaturePropertyNames.length === 0
								? MERGED_CHILD_UNION_DISPOSITION.BOTH_BRANCHES_AGREE
								: MERGED_CHILD_UNION_DISPOSITION.BOTH_BRANCHES_AGREE_CONTENT_DECIDED,
						decidedNonSignaturePropertyNames,
					};
				};

				// the union in a DETERMINISTIC order: the winner's declarations in their own
				// declaration order, then the losing branch's contributions in theirs. Positions are
				// renumbered 1..N over the merged definition rather than carried across, because the
				// two branches' positions can collide and a collision would surface as a duplicate
				// stableId refusal rather than as the ordering decision it actually is. The source
				// position travels on the node as sourceSequencePosition, so nothing is lost.
				// the contributing artifact hash is read from the contributing DEFINITION, not from
				// the child: an element declaration carries no declaringArtifactSha256 of its own.
				// (Learned the way the house rules intend — requiredProperty refused the first run
				// rather than handing back undefined, which would have shipped 522 children with an
				// empty provenance hash and no complaint from anything.)
				const winnerArtifactSha256 = requiredProperty(
					winningDefinitionNode,
					'declaringArtifactSha256',
				);
				const loserArtifactSha256 =
					loserDefinitionNodeForChildren === null
						? null
						: requiredProperty(loserDefinitionNodeForChildren, 'declaringArtifactSha256');
				const orderedChildContributions = [
					...winnerChildNodes.map((oneWinnerChild) => {
						const winnerDecision = decisionForWinnerChild(oneWinnerChild);
						return {
							sourceChildNode: oneWinnerChild,
							contributingBranch: winnerBranchName,
							contributingArtifactSha256: winnerArtifactSha256,
							childUnionDisposition: winnerDecision.disposition,
							decidedNonSignaturePropertyNames: winnerDecision.decidedNonSignaturePropertyNames,
						};
					}),
					...losingBranchContributedChildNodes.map((oneLoserChild) => ({
						sourceChildNode: oneLoserChild,
						contributingBranch: MERGED_CHILD_CONTRIBUTING_BRANCH.TEST_SCORE,
						contributingArtifactSha256: loserArtifactSha256,
						childUnionDisposition: MERGED_CHILD_UNION_DISPOSITION.LOSING_BRANCH_CONTRIBUTED,
						// the losing branch is the ONLY declarer of these names, so nothing was chosen
						decidedNonSignaturePropertyNames: [],
					})),
				];
				// R-P4-11's ONE classification, per definition. Contribution is meaningful ONLY where
				// two branches meet: where a single member declares the type there is no other branch
				// to contribute TO, and where both declare a child identically neither contributed.
				// BOTH agreement dispositions are excluded, and the second exclusion is deliberate
				// rather than incidental. R-P4-11's classification is defined on the SIGNATURE basis:
				// a branch contributes when its DECLARATION is what the merged child publishes and the
				// other branch never declared it in that form. The content-decided children have
				// IDENTICAL signatures — what differs is documentation — so they are not signature
				// contributions, and folding them in would silently move a RULED number from 33/2 to
				// 36/2 as a side effect of an unrelated fix. The content decision is a real fact and
				// it is recorded on its own (GAP 3), which is precisely why it must not be counted twice.
				const perDefinitionContributions = !isShared
					? []
					: orderedChildContributions.filter(
							(oneContribution) =>
								oneContribution.childUnionDisposition !==
									MERGED_CHILD_UNION_DISPOSITION.BOTH_BRANCHES_AGREE &&
								oneContribution.childUnionDisposition !==
									MERGED_CHILD_UNION_DISPOSITION.BOTH_BRANCHES_AGREE_CONTENT_DECIDED,
						);
				const contributionsFromBranch = (branchName) =>
					perDefinitionContributions
						.filter((oneContribution) => oneContribution.contributingBranch === branchName)
						.map((oneContribution) => ({
							...signatureOfChildNode(oneContribution.sourceChildNode),
							contributedByBranch: oneContribution.contributingBranch,
							childUnionDisposition: oneContribution.childUnionDisposition,
							copiedFromStableId: oneContribution.sourceChildNode.stableId,
						}));
				const collegeContributedEntries = contributionsFromBranch(
					MERGED_CHILD_CONTRIBUTING_BRANCH.COLLEGE,
				);
				const testScoreContributedEntries = contributionsFromBranch(
					MERGED_CHILD_CONTRIBUTING_BRANCH.TEST_SCORE,
				);

				// THE ZEROING OF 'absent' IS PROVED HERE, NOT ASSERTED BELOW. Writing
				// absentChildElementCount: 0 is only honest if the union genuinely carried every
				// entry the classifier called ABSENT. If one were classified absent and NOT carried,
				// it would be a real loss wearing a zero — the exact species of quiet inaccuracy §8f
				// was written to end — so it refuses by name instead.
				const losingBranchContributedNameSet = new Set(
					losingBranchContributedChildNodes.map((oneLoserChild) =>
						requiredProperty(oneLoserChild, 'name'),
					),
				);
				const absentEntriesTheUnionDidNotCarry = deltaSignatures.absent.filter(
					(oneAbsentEntry) => !losingBranchContributedNameSet.has(oneAbsentEntry.name),
				);
				if (absentEntriesTheUnionDidNotCarry.length !== 0) {
					refuse(
						`S-1c cannot zero the ABSENT record for '${oneKey}': ` +
							`${absentEntriesTheUnionDidNotCarry.length} entry(ies) classified ABSENT were NOT ` +
							`carried by the child union (` +
							`${absentEntriesTheUnionDidNotCarry.map((oneEntry) => oneEntry.name).join(', ')}). ` +
							`R-P4-10 zeroes that bucket only because the union supplies every loser-only name; ` +
							`an entry the union missed is a genuine loss, and publishing absentChildElementCount ` +
							`0 over it would be a false record rather than a corrected one`,
					);
				}

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
						// R-P4-11 (RULED 2026-08-06): ONE classification, naming the CONTRIBUTING
						// BRANCH. The retired 'added' record counted only what the WINNING member
						// contributed; giving the losing member's contributions a different name
						// would re-create in the vocabulary the very asymmetry R-P4-6 removed from
						// the record. Both directions are the same phenomenon and now share one name.
						contributedChildElementSignatures: JSON.stringify([
							...collegeContributedEntries,
							...testScoreContributedEntries,
						]),
						contributedChildElementCount:
							collegeContributedEntries.length + testScoreContributedEntries.length,
						collegeContributedChildElementCount: collegeContributedEntries.length,
						testScoreContributedChildElementCount: testScoreContributedEntries.length,
						// ABSENT is RETAINED AND ZERO, not deleted (standing rule 4). Before Phase
						// 4.6a a name the losing branch alone declared was genuinely absent from the
						// merged form; R-P4-10's union now carries it as a synthetic child, so the
						// bucket is structurally empty. The marker says WHEN and WHY it went to zero,
						// because a bucket that is merely empty invites the reading that it was never
						// populated.
						absentChildElementSignatures: JSON.stringify([]),
						absentChildElementCount: 0,
						absentChildElementsZeroedAtPhase: '4.6a',
						// UNCHANGED, and deliberately still published. Presence is not fidelity: a
						// REBOUND child is a type rebinding and a WIDENED one a cardinality change,
						// both real semantic movement that an "absent 0" headline would bury. §8f
						// exists because one over-summarising sentence propagated into a ruling and a
						// commit message before anyone measured it.
						reboundChildElementSignatures: JSON.stringify(deltaSignatures.rebound),
						reboundChildElementCount: deltaSignatures.rebound.length,
						widenedChildElementSignatures: JSON.stringify(deltaSignatures.widened),
						widenedChildElementCount: deltaSignatures.widened.length,
						// THE OVERLAP, STATED IN WORDS BECAUSE THE ARITHMETIC MISLEADS WITHOUT IT.
						// The rebound and widened entries are NOT additional to the contributed
						// count — they are a described SUBSET of it. Each collision the winner won
						// appears once inside collegeContributedChildElementCount and again, from the
						// loser's point of view, under rebound or widened. Adding the four numbers
						// therefore double-counts every collision. Two individually true figures a
						// reader can combine into a false one is this campaign's favourite defect;
						// naming the relationship is the only thing that stops it.
						contributedChildElementOverlapNote:
							'reboundChildElementCount and widenedChildElementCount describe a SUBSET of ' +
							'collegeContributedChildElementCount, not entries additional to it. Do not sum ' +
							'these counts: every collision the college member won is counted once as a ' +
							'college contribution and described again as rebound or widened.',
						// BOTH BASES, LABELLED. A reader who recomputes at signature granularity gets
						// 8 where the classification says 2, and without this pair would conclude one
						// of the two is wrong rather than that they answer different questions.
						signatureLevelCollegeContributedCount: deltaSignatures.added.length,
						signatureLevelTestScoreDroppedCount:
							deltaSignatures.absent.length +
							deltaSignatures.rebound.length +
							deltaSignatures.widened.length,
						childElementRecordBasisNote:
							'MATERIALIZED basis (collegeContributedChildElementCount / ' +
							'testScoreContributedChildElementCount) answers: which branch’s declaration does ' +
							'each child a consumer meets on HAS_PROPERTY actually publish. SIGNATURE basis ' +
							'(signatureLevelCollegeContributedCount / signatureLevelTestScoreDroppedCount) ' +
							'answers: how many declarations does each branch hold that the other does not hold ' +
							'identically. The two differ because a name declared by both branches with ' +
							'different signatures is one materialized child but two signature-level entries.',
						// the union's own size — what a consumer walking HAS_PROPERTY will meet
						childElementCount: orderedChildContributions.length,
						// R-P4-12 option (c): the winning branch's derivation wrapper
						// (extension/restriction) is REFERENCED BY EDGE, not duplicated — a count
						// here, never an address (condition 1: an address in a property can dangle
						// unseen). Referenced rather than copied because the wrapper is what Phase
						// 5's emitter rebuilds, and that emitter is scoped to the SOURCE projection
						// (R-VAL-1), so a duplicate here would be a second, drifting copy that no
						// consumer reads.
						derivationReferencedCount: winnerContainment.derivationChildNodes.length,
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

				// R-P4-12 condition 1: the winning branch's derivation wrappers, referenced by REAL
				// EDGES from the merged definition. Same shared vocabulary the source tier uses for
				// the same relationship, distinguished only by its synthetic tier marking.
				winnerContainment.derivationChildNodes.forEach((oneDerivationNode) => {
					addSyntheticEdge(
						EDGE_TYPES.HAS_RESTRICTION,
						mergedStableId,
						oneDerivationNode.stableId,
						SYNTHETIC_RULE.MERGED_CHILD,
						{
							referencedNotDuplicated: true,
							contributedByBranch: winnerBranchName,
							derivationVariety: requiredProperty(oneDerivationNode, 'derivationVariety'),
							residueNote:
								'the derivation wrapper is REFERENCED, not duplicated: it remains a source-tier ' +
								'node under the contributing branch',
						},
					);
				});

				// S-1c — EMIT the children computed above, now that the merged node they hang from
				// exists (addSyntheticEdge refuses an edge to a node that is not there yet).
				orderedChildContributions.forEach((oneContribution, contributionIndex) => {
					const mergedSequencePosition = contributionIndex + 1;
					const childNode = duplicateChildOntoMergedDefinition({
						sourceChildNode: oneContribution.sourceChildNode,
						mergedDefinitionStableId: mergedStableId,
						mergedDefinitionName: definitionName,
						mergedDefinitionPath: `${owningName} ${definitionName}`,
						mergedSequencePosition,
						contributingBranch: oneContribution.contributingBranch,
						contributingArtifactSha256: oneContribution.contributingArtifactSha256,
						childUnionDisposition: oneContribution.childUnionDisposition,
						decidedNonSignaturePropertyNames: oneContribution.decidedNonSignaturePropertyNames,
					});
					addSyntheticEdge(
						EDGE_TYPES.HAS_PROPERTY,
						mergedStableId,
						childNode.stableId,
						SYNTHETIC_RULE.MERGED_CHILD,
						{
							sequencePosition: mergedSequencePosition,
							contributedByBranch: oneContribution.contributingBranch,
							copiedFromStableId: oneContribution.sourceChildNode.stableId,
							childUnionDisposition: oneContribution.childUnionDisposition,
						},
					);

					// CONDITION 1 of R-P4-12: the inline anonymous type is referenced by a REAL EDGE,
					// never by a stableId-valued property. A property that merely LOOKS like an
					// address can dangle and no gate in this campaign would notice — conservation
					// compares node and edge SETS, referential integrity folds into conservation, and
					// the forge refuses dangling EDGES at emission with no equivalent protection for
					// a string. addSyntheticEdge checks both endpoints exist; nothing checks a string.
					const inlineTypeStableId = inlineTypeStableIdOf(oneContribution.sourceChildNode);
					if (inlineTypeStableId !== '') {
						addSyntheticEdge(
							EDGE_TYPES.HAS_SUPPORT,
							childNode.stableId,
							inlineTypeStableId,
							SYNTHETIC_RULE.MERGED_CHILD,
							{
								referencedNotDuplicated: true,
								contributedByBranch: oneContribution.contributingBranch,
								residueNote:
									'the inline type is REFERENCED, not duplicated: walking into this child ' +
									'still takes a hop into the contributing branch',
							},
						);
					}

					const childSignature = signatureOfChildNode(oneContribution.sourceChildNode);
					mergedChildDeclarationRecords.push({
						mergedDefinitionStableId: mergedStableId,
						definitionKey: oneKey,
						childStableId: childNode.stableId,
						inlineTypeFromStableId: inlineTypeStableId,
						copiedFromStableId: oneContribution.sourceChildNode.stableId,
						contributedByBranch: oneContribution.contributingBranch,
						childUnionDisposition: oneContribution.childUnionDisposition,
						...childSignature,
					});

					// R-P4-11 — ONE classification, naming the CONTRIBUTING BRANCH. Contribution is
					// meaningful ONLY where two branches meet: in a definition only one member
					// declares there is no other branch to contribute TO, and in a shared definition
					// where both declare a child identically nothing was contributed by either. So
					// the classification covers the shared definitions where the two disagree, in
					// BOTH directions, which is precisely what R-P4-6 required of the record.
					// EXCLUDES BOTH AGREEMENT DISPOSITIONS, and it must match perDefinitionContributions
					// above EXACTLY. It did not, briefly, and nothing failed: this accumulator feeds
					// STATS while that one feeds the merged NODES, so the build reported 36 college
					// contributions while the graph published 33 — one name, two answers. No assertion
					// caught it because the only stats use of the figure was an upper bound (6 < 33),
					// which holds at 36 as well. A number used only as a loose bound is not being
					// checked; it merely looks as though it is.
					if (
						isShared &&
						oneContribution.childUnionDisposition !==
							MERGED_CHILD_UNION_DISPOSITION.BOTH_BRANCHES_AGREE &&
						oneContribution.childUnionDisposition !==
							MERGED_CHILD_UNION_DISPOSITION.BOTH_BRANCHES_AGREE_CONTENT_DECIDED
					) {
						contributedChildElements.push({
							definitionKey: oneKey,
							definitionName,
							contributedByBranch: oneContribution.contributingBranch,
							childUnionDisposition: oneContribution.childUnionDisposition,
							...childSignature,
							copiedFromStableId: oneContribution.sourceChildNode.stableId,
						});
					}
				});
			});

			// =============================================================
			// S-1c — the INVENTION check, run over the whole duplicated population
			// =============================================================
			// The declared-key set is rebuilt HERE by walking the two collision members again, rather
			// than reusing the lists the duplication consumed. That is deliberate: a check fed the
			// same list its subject was built from confirms only that the list equals itself.
			const declaredChildDeclarationKeys = new Set();
			[collegeMemberNode, testScoreMemberNode].forEach((oneMemberNode) => {
				definitionNodesByArtifactSha256[oneMemberNode.properties.sha256].forEach(
					(oneDefinitionNode) => {
						const declaredDefinitionKey = `${requiredProperty(oneDefinitionNode, 'kind')}|${requiredProperty(oneDefinitionNode, 'name')}`;
						(childrenByParentId[oneDefinitionNode.stableId] || [])
							.filter((oneChild) => labelHas(oneChild, 'PescElementDecl'))
							.forEach((oneChild) => {
								declaredChildDeclarationKeys.add(
									mergedChildDeclarationKey({
										definitionKey: declaredDefinitionKey,
										name: requiredProperty(oneChild, 'name'),
										typeAsWritten: requiredProperty(oneChild, 'typeAsWritten'),
										minOccurs: requiredProperty(oneChild, 'minOccurs'),
										maxOccurs: requiredProperty(oneChild, 'maxOccurs'),
									}),
								);
							});
					},
				);
			});
			verifyMergedChildrenWereDeclared({
				mergedChildDeclarationRecords,
				declaredChildDeclarationKeys,
			});


			// how many children each merged definition actually carries. Computed HERE, next to the
			// acceptance refusal that consumes it, rather than travelling with the reached-target
			// census below — that census must run after every edge is emitted, this must run before
			// the build is allowed to proceed, and coupling them once already produced a wrong answer.
			// SEEDED AT ZERO FOR EVERY MERGED DEFINITION, so that "this definition has no children" is
			// a RECORDED FACT rather than an absent key. That distinction is the whole point: reading
			// an absent key as zero via `|| 0` is the silent default this campaign forbids, and I
			// wrote two of them into production in the very remediation that removed one from a test.
			// With the map seeded, requiredMergedChildCount below can refuse an unknown id by name —
			// which is what an absent read should always do.
			const childCountByMergedStableId = {};
			Object.keys(mergedChildBranchStableIds).forEach((oneMergedStableId) => {
				childCountByMergedStableId[oneMergedStableId] = 0;
			});
			mergedChildDeclarationRecords.forEach((oneRecord) => {
				if (
					!Object.prototype.hasOwnProperty.call(
						childCountByMergedStableId,
						oneRecord.mergedDefinitionStableId,
					)
				) {
					refuse(
						`S-1c emitted a child under '${oneRecord.mergedDefinitionStableId}', which is not a ` +
							`merged definition this run produced. A child parented to an unknown definition would ` +
							`be counted into nothing`,
					);
				}
				childCountByMergedStableId[oneRecord.mergedDefinitionStableId]++;
			});
			const requiredMergedChildCount = (oneMergedStableId) => {
				if (
					!Object.prototype.hasOwnProperty.call(childCountByMergedStableId, oneMergedStableId)
				) {
					refuse(
						`S-1c has no child count for merged definition '${oneMergedStableId}'. Reading that as ` +
							`zero would let an unknown definition pass every count check silently`,
					);
				}
				return childCountByMergedStableId[oneMergedStableId];
			};

			// THE ACCEPTANCE CRITERION, ASSERTED IN PRODUCTION AGAINST AN INDEPENDENT BASIS.
			//
			// REBUILT TWICE. The FIRST version lived in the gate suite and demanded a target have zero
			// children AND have child records — mutually exclusive, so it filtered an always-empty set
			// and printed a reassuring zero. The SECOND version, written to repair it, compared
			// mergedChildBranchChildCount against childCountByMergedStableId — and BOTH are populated
			// from the same union pass, so branch-children implies own-children and it could not fire
			// either. I wrote a comment explaining the first defect directly above the second one.
			// Knowing a defect's shape is not the same as having checked your own work against it.
			//
			// WHY THIS VERSION CAN ACTUALLY FAIL. buildSyntheticTier is a PURE FUNCTION of one input,
			// so any check comparing two derivations of that input is an implementation-consistency
			// check and can only be reddened by mutating CODE. The escape is that the source tier
			// publishes containment TWICE and independently: as the `parentId` PROPERTY (which the
			// union walks) and as HAS_PROPERTY EDGES. This check recomputes the expected union from
			// the EDGES. The two bases can therefore disagree, and a DATA mutation — dropping a
			// HAS_PROPERTY edge from the input graph — makes it fire. That is not a contrivance: the
			// divergence between those two bases is the exact trap that produced a false depth
			// finding earlier in this phase, confirmed by two censuses that had both used the edges.
			//
			// AND IT IS A COUNT TEST, NOT A ZERO TEST. The predecessor asked only whether children
			// EXIST, so a merged definition rendering 1 of its 18 would have passed untouched. A zero
			// test also cannot respond to the data mutation above; a count test can. The two
			// corrections are one correction.
			const sourceChildNamesByParentFromEdges = {};
			edges
				.filter((oneEdge) => oneEdge.type === EDGE_TYPES.HAS_PROPERTY)
				.forEach((oneEdge) => {
					const childNode = nodeByStableId[oneEdge.toRef.id];
					if (childNode === undefined || !labelHas(childNode, 'PescElementDecl')) {
						return;
					}
					(sourceChildNamesByParentFromEdges[oneEdge.fromRef.id] =
						sourceChildNamesByParentFromEdges[oneEdge.fromRef.id] || []).push(
						requiredProperty(childNode, 'name'),
					);
				});
			const acceptanceShortfalls = [];
			Object.keys(mergedChildBranchStableIds)
				.sort()
				.forEach((oneMergedStableId) => {
					const branchStableIds = mergedChildBranchStableIds[oneMergedStableId];
					// the winning branch first: its names all survive. Then the losing branch's names
					// that the winner does not declare. Recomputed from EDGES, never from the union.
					const winnerChildNames =
						sourceChildNamesByParentFromEdges[branchStableIds.winnerStableId] || [];
					const loserChildNames =
						branchStableIds.loserStableId === null
							? []
							: sourceChildNamesByParentFromEdges[branchStableIds.loserStableId] || [];
					const winnerChildNameSet = new Set(winnerChildNames);
					const expectedChildCount =
						winnerChildNames.length +
						loserChildNames.filter((oneChildName) => !winnerChildNameSet.has(oneChildName)).length;
					const emittedChildCount = requiredMergedChildCount(oneMergedStableId);
					if (emittedChildCount !== expectedChildCount) {
						acceptanceShortfalls.push(
							`'${oneMergedStableId}' carries ${emittedChildCount} of an expected ${expectedChildCount}`,
						);
					}
				});
			if (acceptanceShortfalls.length !== 0) {
				refuse(
					`S-1c FAILED ITS OWN ACCEPTANCE CRITERION: ${acceptanceShortfalls.length} merged ` +
						`definition(s) do not carry the number of children their branches declare, recomputed ` +
						`INDEPENDENTLY from the source tier's HAS_PROPERTY edges rather than from the union's ` +
						`own parentId walk. A merged definition short of its children renders an incomplete ` +
						`type, which is the defect R-P4-3 exists to end. First: ${acceptanceShortfalls[0]}`,
				);
			}

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

			// RELOCATED, and the relocation is the finding. This census was first computed immediately
			// after the invention check — BEFORE the held-reference resolution emits the RESOLVES_TO
			// edges it counts. It therefore reported 0 reached targets and 0 rendering empty: not a
			// crash, not an error, a PLAUSIBLE ZERO that reads exactly like good news. It is computed
			// here, after every edge this tier emits, so it counts a finished graph.
			// =============================================================
			// GAP 2 — HOW MANY MERGED TARGETS STILL RENDER EMPTY, AND WHY
			// =============================================================
			// The independent review found this number missing everywhere: not in the suite, not in
			// stats, not in the DEVLOG. The published residue (inline types, derivation wrappers)
			// describes the MECHANISM; it does not tell a consumer how many merged targets they will
			// actually meet that show nothing. That number is not a defect — nothing was dropped —
			// but a consumer who is not told it will read an empty type as a bug in this phase.
			//
			// TWO SCOPES, BOTH PUBLISHED AND LABELLED, because they differ and the difference is not
			// obvious: 'anyReferrer' counts every reference variety, 'elementDeclReferrer' counts only
			// element declarations, which is the population acceptance criterion 1 speaks about. They
			// differ by targets reached ONLY by a base or type reference from a non-element node.
			const mergedDefinitionKindByStableId = {};
			syntheticNodes
				.filter((oneNode) => oneNode.properties.syntheticRule === SYNTHETIC_RULE.MERGE)
				.forEach((oneNode) => {
					mergedDefinitionKindByStableId[oneNode.stableId] = oneNode.properties.kind;
				});
			const reachedTargetsByReferrerScope = { anyReferrer: new Set(), elementDeclReferrer: new Set() };
			syntheticEdges
				.filter(
					(oneEdge) =>
						oneEdge.type === 'RESOLVES_TO' &&
						mergedDefinitionKindByStableId[oneEdge.toRef.id] !== undefined,
				)
				.forEach((oneEdge) => {
					reachedTargetsByReferrerScope.anyReferrer.add(oneEdge.toRef.id);
					const referrerNode = nodeByStableId[oneEdge.fromRef.id];
					if (referrerNode !== undefined && labelHas(referrerNode, 'PescElementDecl')) {
						reachedTargetsByReferrerScope.elementDeclReferrer.add(oneEdge.toRef.id);
					}
				});
			const emptyRenderCensusFor = (reachedTargetStableIds) => {
				const emptyTargetStableIds = [...reachedTargetStableIds]
					// requiredMergedChildCount, never `|| 0`. This feeds a PUBLISHED number — the
					// empty-render census a consumer reads — and a silent default here would let a
					// definition the union never saw be reported as "renders empty" rather than
					// refused as unknown. TQ named silent defaulting as his longest-standing
					// complaint about how this system behaves; it has no business in a published count.
					.filter((oneStableId) => requiredMergedChildCount(oneStableId) === 0)
					.sort();
				const emptyCountByKind = {};
				emptyTargetStableIds.forEach((oneStableId) => {
					const oneKind = mergedDefinitionKindByStableId[oneStableId];
					emptyCountByKind[oneKind] = (emptyCountByKind[oneKind] || 0) + 1;
				});
				return {
					reachedTargets: reachedTargetStableIds.size,
					rendersEmpty: emptyTargetStableIds.length,
					rendersChildren: reachedTargetStableIds.size - emptyTargetStableIds.length,
					emptyCountByKind,
					emptyTargetStableIds,
				};
			};
			const emptyRenderCensus = {
				anyReferrer: emptyRenderCensusFor(reachedTargetsByReferrerScope.anyReferrer),
				elementDeclReferrer: emptyRenderCensusFor(
					reachedTargetsByReferrerScope.elementDeclReferrer,
				),
				explanation:
					'These merged targets render no child elements because they HAVE none to render, not ' +
					'because S-1c dropped any. A simpleType has no element children by definition; the ' +
					'complexTypes here take their content from an extension BASE rather than from local ' +
					'declarations, so their content lives on the base type. Verified by the acceptance ' +
					'assertion that ZERO merged definitions with children in either branch render empty.',
			};

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
				//
				// TWO BASES, BOTH LABELLED (R-P4-11). The SIGNATURE basis counts declarations each
				// branch holds that the other does not hold identically. The MATERIALIZED basis counts
				// what a consumer walking HAS_PROPERTY actually meets. They differ because a name both
				// branches declare with different signatures is ONE materialized child but TWO
				// signature-level entries — which is also why the counts below must not be summed.
				signatureLevelAbsentChildElements: absentChildElements.length,
				signatureLevelTestScoreDroppedChildElements:
					absentChildElements.length + reboundChildElements.length + widenedChildElements.length,
				signatureLevelCollegeContributedChildElements: addedChildElements.length,
				reboundChildElements: reboundChildElements.length,
				widenedChildElements: widenedChildElements.length,
				// MATERIALIZED basis — the classification the merged nodes publish
				contributedChildElements: contributedChildElements.length,
				collegeContributedChildElements: contributedChildElements.filter(
					(oneEntry) => oneEntry.contributedByBranch === MERGED_CHILD_CONTRIBUTING_BRANCH.COLLEGE,
				).length,
				testScoreContributedChildElements: contributedChildElements.filter(
					(oneEntry) => oneEntry.contributedByBranch === MERGED_CHILD_CONTRIBUTING_BRANCH.TEST_SCORE,
				).length,
				absentChildElementsAfterUnion: 0,
				// S-1c — the duplicated children themselves (R-P4-3)
				mergedChildNodes: mergedChildDeclarationRecords.length,
				mergedChildHasPropertyEdges: syntheticEdges.filter(
					(oneEdge) => oneEdge.type === 'HAS_PROPERTY',
				).length,
				// OPTION (c) RESIDUE, NAMED SO IT IS A NUMBER SOMEONE READS RATHER THAN AN INVISIBLE
				// GAP. These are the containment nodes S-1c points at instead of duplicating. If the
				// supervisor rules for recursive duplication these both go to zero; while they are
				// nonzero they are the honest cost of the elements-only scope.
				// counted off the EDGES, which are the authoritative record (R-P4-12 condition 1), not
				// off a property that restates them — two sources of truth is how they drift apart.
				inlineTypeReferenceEdges: syntheticEdges.filter(
					(oneEdge) =>
						oneEdge.type === EDGE_TYPES.HAS_SUPPORT &&
						oneEdge.properties.syntheticRule === SYNTHETIC_RULE.MERGED_CHILD,
				).length,
				derivationReferenceEdges: syntheticEdges.filter(
					(oneEdge) =>
						oneEdge.type === EDGE_TYPES.HAS_RESTRICTION &&
						oneEdge.properties.syntheticRule === SYNTHETIC_RULE.MERGED_CHILD,
				).length,
				// GAP 2 — published so a consumer is TOLD how many merged targets render nothing, and
				// why, instead of meeting one and reading it as a defect of this phase.
				emptyRenderCensus,
				// GAP 3 — children whose signatures matched but whose CONTENT the union chose between
				mergedChildrenWithContentDecided: mergedChildDeclarationRecords.filter(
					(oneRecord) =>
						oneRecord.childUnionDisposition ===
						MERGED_CHILD_UNION_DISPOSITION.BOTH_BRANCHES_AGREE_CONTENT_DECIDED,
				).length,
				mergedChildrenByDisposition: mergedChildDeclarationRecords.reduce(
					(dispositionCounts, oneRecord) => ({
						...dispositionCounts,
						[oneRecord.childUnionDisposition]:
							(dispositionCounts[oneRecord.childUnionDisposition] || 0) + 1,
					}),
					{},
				),
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
				// S-1c. mergedChildDeclarationRecords and declaredChildDeclarationKeys are returned
				// so Gate 4.6a's INVENTION lever can re-run the SHIPPED checker over the SHIPPED
				// population with one fabricated record appended. Without them the lever would have
				// to reimplement the check, and a lever that reimplements what it tests proves only
				// that two implementations agree.
				mergedChildDeclarationRecords,
				declaredChildDeclarationKeys: [...declaredChildDeclarationKeys].sort(),
				contributedChildElements,
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
			// exported for Gate 4.6a's INVENTION lever — see the function's own header for why a
			// check that cannot fail in production must still be shown able to fail
			verifyMergedChildrenWereDeclared,
			mergedChildDeclarationKey,
			MERGED_CHILD_CONTRIBUTING_BRANCH,
			MERGED_CHILD_UNION_DISPOSITION,
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
