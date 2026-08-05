'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// derivedTier.js — the PESC260805 DERIVED tier: namespaces, resolution, sameness chains, and
// latest-view annotations, computed from the SOURCE tier and NOTHING else.
// (DESIGN-pescGraphModel-080526 §3.2, §7; rulings D-4, D-7, R-P2-4, R-P2-5; Phase 3 of the
// pesc rebuild work order.)
//
// THE TIER'S ONE LAW (design §3.2, Gate 3): everything emitted here is REGENERABLE — a pure,
// deterministic function of the retained source-tier graph. Delete every node/edge with
// pescTier:'derived', strip every derived annotation off the source nodes, call buildDerivedTier
// again, and the output must be IDENTICAL. "Derived content that cannot be regenerated is
// synthetic in the wrong tier." Consequently: NO graph I/O, NO network, NO randomness, NO clocks.
//
// WHAT IT COMPUTES
//   * PescNamespace nodes — one per distinct targetNamespace (the contested namespace gets ONE
//     node with TWO artifacts pointing at it; the contest is visible HERE and only here).
//   * IN_NAMESPACE edges — artifact -> namespace.
//   * IMPORTS edges — artifact -> artifact, the resolved form of the source import decls. The
//     known-absent CoreMain v1.6.0 import is RECORDED as an unresolved-import fact, never
//     refused and never resolved (its resolution is Phase 4's S-2 synthetic alias).
//   * RESOLVES_TO edges — written reference -> target PescNamedDefinition, resolved with the
//     DECLARING ARTIFACT'S OWN prefixBindings (R-TR-1), never a global table.
//   * SAME_DEFINITION edges — D-4: within one library family only; D-7: topology is a CHAIN in
//     ascending version order (each member links to the next version carrying the identical
//     definition under the STRICT comparison; clusters are the connected components).
//   * Annotations on source nodes (regenerable properties, stripped by the Gate 3 delete):
//     sameDefinitionClusterId, reachableFromLatestRoot, resolvesToBuiltinXsd,
//     ambiguousPendingSynthesis, unresolvedImportFact, unresolvedNamespaceReferences.
//   * isLatest on namespaces (max version within its layer+name family).
//
// THE CONTESTED NAMESPACE (D-7, supervisor ruling): a reference whose bound namespace is the
// contested AcademicRecord v1.6.0 is NOT resolved and NOT refused — it is RECORDED in the
// ambiguousPendingSynthesis list for Phase 4's synthetic targets. This includes the collision
// members' OWN internal references (183 of them): their candidate is unique (the declaring
// member's own definition), but the namespace is quarantined until S-1 synthesizes the merged
// definition set, and resolving into a quarantined namespace now would create derived edges that
// Phase 4 must supersede. Entries carry intraMember so the two populations stay distinguishable;
// the namespace's CONSUMERS are the entries with intraMember:false (the six importing roots).
// ZERO RESOLVES_TO edges target a contested-namespace definition — that absence is checkable and
// checked (gate G3-D).
//
// xs: BUILT-INS resolve to nothing BY DESIGN: the XSD namespace has no artifact and its types
// have no nodes. A reference bound to http://www.w3.org/2001/XMLSchema is represented as a
// terminal marker property (resolvesToBuiltinXsd) on the referencing node — a marker, not an
// edge, because an edge needs a target and inventing target nodes for xs:string would put
// fabricated content in a graph whose whole discipline is provenance.
//
// STRICT COMPARISON (design §3.2 SAME_DEFINITION): only XML-spec-INSIGNIFICANT differences are
// ignored — attribute order and inter-markup whitespace, both already normalized away by the
// Phase 2 parse (attributes land in named fields; the tree drops layout). Documentation text
// PARTICIPATES byte-for-byte. The comparison operates on the definition subtree RECONSTRUCTED
// FROM SOURCE NODES (children ordered by their source positions), serialized with fixed key
// order and hashed. comparisonOptions exist ONLY for the test harness's RED levers
// (documentation-participation off, whitespace collapse on); the production path pins STRICT.
//
// R-P2-5 GUARD (ratified with a guard; assigned to Phase 3): contentModelShape is a DUAL
// representation of child order. Before trusting shapes (group refs are read from them), every
// container carrying a shape is checked — the element decls enumerated from the shape JSON must
// match the PescElementDecl children 1:1, positions and order. Drift REFUSES by name.
//
// Sync + pure: throws for refusals (house rule — the forge's one sanctioned boundary converts
// them to the error channel). No callbacks: nothing here waits on anything.

const path = require('path');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));
const { NODE_LABELS, DME_ROLES, PROVENANCE_TIER } = require(
	path.join(CORE_LIB, 'vocabulary', 'vocabulary'),
);

const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';
const PESC_DERIVED_TIER = 'derived';

// the facet scalar property names Phase 2 lands on PescDerivation nodes (parser SCALAR_FACET_TAGS
// minus the xs: prefix). Enumerated here because facets participate in the strict comparison and
// live spread across node properties rather than in one JSON blob.
const FACET_PROPERTY_NAMES = [
	'pattern',
	'minLength',
	'maxLength',
	'length',
	'totalDigits',
	'fractionDigits',
	'minInclusive',
	'maxInclusive',
	'minExclusive',
	'maxExclusive',
	'whiteSpace',
];

// every derived property this module may write onto a SOURCE node. The Gate 3 strip step deletes
// exactly these; buildDerivedTier refuses input that still carries any of them (a contaminated
// input would let stale derivation echo through the regeneration proof).
const DERIVED_ANNOTATION_PROPERTY_NAMES = [
	'sameDefinitionClusterId',
	'reachableFromLatestRoot',
	'resolvesToBuiltinXsd',
	'ambiguousPendingSynthesis',
	'unresolvedImportFact',
	'unresolvedNamespaceReferences',
];

// the production comparison. comparisonOptions is a parameter ONLY so the harness can demonstrate
// RED levers; nothing in the production path ever loosens these.
const STRICT_COMPARISON = { includeDocumentation: true, collapseWhitespace: false };

// which definition kinds a written reference may legally target, by reference variety. XSD gives
// types, elements, and groups separate symbol spaces; the variety says which space is being read.
const ADMISSIBLE_TARGET_KINDS = {
	type: ['complexType', 'simpleType'],
	base: ['complexType', 'simpleType'],
	substitutionGroup: ['element'],
	groupRef: ['group'],
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		const { buildSearchText } = buildSearchTextFactory();

		const refuse = (message) => {
			throw new Error(`pesc260805 derivedTier REFUSES: ${message}`);
		};

		// requiredProperty — absent-property reads throw (house rule): reading a property that is
		// not there is a wrong-model bug, not a default-to-empty situation.
		const requiredProperty = (oneNode, propertyName) => {
			if (!Object.prototype.hasOwnProperty.call(oneNode.properties, propertyName)) {
				refuse(
					`node '${oneNode.stableId}' has no property '${propertyName}' — the derived tier's ` +
						`model of the source tier is wrong, which is a bug, not a default`,
				);
			}
			return oneNode.properties[propertyName];
		};

		const labelHas = (oneNode, label) => oneNode.labels.indexOf(label) !== -1;

		// sortedKeyObject — rebuild an object with keys in sorted order so JSON.stringify is
		// canonical. Values pass through untouched (arrays keep their order — order is meaning).
		const sortedKeyObject = (sourceObject) => {
			const result = {};
			Object.keys(sourceObject)
				.sort()
				.forEach((oneKey) => {
					result[oneKey] = sourceObject[oneKey];
				});
			return result;
		};

		// ---- version tokens: 'v1.19.1' -> [1,19,1]; ordering is numeric segment-wise.
		const parseVersionRanks = (versionToken, context) => {
			const versionMatch = `${versionToken}`.match(/^v(\d+(?:\.\d+)*)$/);
			if (!versionMatch) {
				refuse(`${context}: versionToken '${versionToken}' is not v<digits>[.<digits>...]`);
			}
			return versionMatch[1].split('.').map((oneSegment) => parseInt(oneSegment, 10));
		};
		const compareVersionTokens = (versionTokenA, versionTokenB) => {
			const ranksA = parseVersionRanks(versionTokenA, 'compareVersionTokens');
			const ranksB = parseVersionRanks(versionTokenB, 'compareVersionTokens');
			const segmentCount = Math.max(ranksA.length, ranksB.length);
			for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
				const segmentA = ranksA[segmentIndex] === undefined ? 0 : ranksA[segmentIndex];
				const segmentB = ranksB[segmentIndex] === undefined ? 0 : ranksB[segmentIndex];
				if (segmentA !== segmentB) {
					return segmentA - segmentB;
				}
			}
			return 0;
		};

		// =====================================================================
		// buildGraphIndexes — one pass over the source nodes into the lookups everything below
		// shares. Shared with makeFingerprintKit so the harness measures with the SAME machinery
		// the production path uses.
		// =====================================================================
		const buildGraphIndexes = ({ nodes }) => {
			const nodeByStableId = {};
			const childrenByParentId = {};
			nodes.forEach((oneNode) => {
				if (nodeByStableId[oneNode.stableId] !== undefined) {
					refuse(`duplicate stableId '${oneNode.stableId}' in input — the source tier is corrupt`);
				}
				nodeByStableId[oneNode.stableId] = oneNode;
				const parentId = oneNode.properties.parentId;
				if (parentId !== undefined && parentId !== null && parentId !== '') {
					(childrenByParentId[parentId] = childrenByParentId[parentId] || []).push(oneNode);
				}
			});

			const artifactNodes = nodes.filter((oneNode) => labelHas(oneNode, 'PescArtifact'));
			const artifactModels = artifactNodes.map((oneArtifactNode) => ({
				stableId: oneArtifactNode.stableId,
				filename: requiredProperty(oneArtifactNode, 'filename'),
				targetNamespace: requiredProperty(oneArtifactNode, 'targetNamespace'),
				sha256: requiredProperty(oneArtifactNode, 'sha256'),
				layer: requiredProperty(oneArtifactNode, 'layer'),
				standardToken: requiredProperty(oneArtifactNode, 'standardToken'),
				versionToken: requiredProperty(oneArtifactNode, 'versionToken'),
				prefixBindings: JSON.parse(requiredProperty(oneArtifactNode, 'prefixBindings')),
			}));
			const artifactModelBySha256 = {};
			const artifactModelByStableId = {};
			artifactModels.forEach((oneArtifactModel) => {
				artifactModelBySha256[oneArtifactModel.sha256] = oneArtifactModel;
				artifactModelByStableId[oneArtifactModel.stableId] = oneArtifactModel;
			});

			const artifactModelsByNamespace = {};
			artifactModels.forEach((oneArtifactModel) => {
				(artifactModelsByNamespace[oneArtifactModel.targetNamespace] =
					artifactModelsByNamespace[oneArtifactModel.targetNamespace] || []).push(oneArtifactModel);
			});
			const contestedNamespaces = Object.keys(artifactModelsByNamespace)
				.filter((oneNamespace) => artifactModelsByNamespace[oneNamespace].length > 1)
				.sort();

			// declaringArtifactOfNode — walk the parentId chain to the owning PescArtifact.
			// Memoized; every containment chain in the source tier tops out at an artifact.
			const artifactStableIdByNodeId = {};
			const declaringArtifactOfNode = (startStableId) => {
				const visitedStableIds = [];
				let cursorStableId = startStableId;
				while (cursorStableId) {
					if (artifactStableIdByNodeId[cursorStableId] !== undefined) {
						break;
					}
					const cursorNode = nodeByStableId[cursorStableId];
					if (cursorNode === undefined) {
						refuse(
							`parent chain of '${startStableId}' reaches '${cursorStableId}', which is not ` +
								`a node in the input`,
						);
					}
					if (labelHas(cursorNode, 'PescArtifact')) {
						artifactStableIdByNodeId[cursorStableId] = cursorStableId;
						break;
					}
					visitedStableIds.push(cursorStableId);
					cursorStableId = cursorNode.properties.parentId;
				}
				const resolvedArtifactStableId = artifactStableIdByNodeId[cursorStableId];
				if (resolvedArtifactStableId === undefined) {
					refuse(`node '${startStableId}' has no PescArtifact ancestor — orphaned source node`);
				}
				visitedStableIds.forEach((oneVisitedStableId) => {
					artifactStableIdByNodeId[oneVisitedStableId] = resolvedArtifactStableId;
				});
				return artifactModelByStableId[resolvedArtifactStableId];
			};

			// definition index: namespace + localName -> the candidate definitions (kind + id).
			// Keyed by SCAN of the definition nodes, never by constructing a key string, so the
			// contested @sha12 discriminator changes nothing about lookup.
			const definitionNodes = nodes.filter((oneNode) => labelHas(oneNode, 'PescNamedDefinition'));
			const definitionsByNamespaceAndName = {};
			definitionNodes.forEach((oneDefinitionNode) => {
				const declaringArtifactModel =
					artifactModelBySha256[requiredProperty(oneDefinitionNode, 'declaringArtifactSha256')];
				if (declaringArtifactModel === undefined) {
					refuse(
						`definition '${oneDefinitionNode.stableId}' declares artifact sha ` +
							`'${oneDefinitionNode.properties.declaringArtifactSha256}' which matches no artifact node`,
					);
				}
				const lookupKey = `${declaringArtifactModel.targetNamespace} ${oneDefinitionNode.properties.name}`;
				(definitionsByNamespaceAndName[lookupKey] =
					definitionsByNamespaceAndName[lookupKey] || []).push({
					kind: requiredProperty(oneDefinitionNode, 'kind'),
					stableId: oneDefinitionNode.stableId,
					declaringArtifactSha256: declaringArtifactModel.sha256,
				});
			});

			return {
				nodeByStableId,
				childrenByParentId,
				artifactModels,
				artifactModelBySha256,
				artifactModelByStableId,
				artifactModelsByNamespace,
				contestedNamespaces,
				declaringArtifactOfNode,
				definitionNodes,
				definitionsByNamespaceAndName,
			};
		};

		// =====================================================================
		// fingerprint machinery — a definition subtree reconstructed from nodes, serialized with
		// fixed key order. Equality of serializations IS the strict comparison.
		// =====================================================================
		const makeFingerprintBuilder = ({ nodeByStableId, childrenByParentId }) => {
			const transformDocumentation = (documentationText, comparisonOptions) => {
				if (!comparisonOptions.includeDocumentation) {
					return '';
				}
				if (comparisonOptions.collapseWhitespace) {
					return `${documentationText}`.replace(/\s+/g, ' ').trim();
				}
				return documentationText;
			};

			const derivationOrdinal = (derivationStableId) => {
				const ordinalMatch = derivationStableId.match(/\/restriction\/(\d+)$/);
				if (!ordinalMatch) {
					refuse(`PescDerivation stableId '${derivationStableId}' lacks the /restriction/<n> suffix`);
				}
				return parseInt(ordinalMatch[1], 10);
			};

			const childPartsOfContainer = (containerStableId, comparisonOptions) => {
				const childNodes = childrenByParentId[containerStableId] || [];
				const elementParts = childNodes
					.filter((oneChild) => labelHas(oneChild, 'PescElementDecl'))
					.sort((childA, childB) => childA.properties.sequencePosition - childB.properties.sequencePosition)
					.map((oneChild) => ({
						part: 'element',
						name: requiredProperty(oneChild, 'name'),
						typeAsWritten: requiredProperty(oneChild, 'typeAsWritten'),
						minOccurs: requiredProperty(oneChild, 'minOccurs'),
						maxOccurs: requiredProperty(oneChild, 'maxOccurs'),
						nillable: requiredProperty(oneChild, 'nillable'),
						fixedAsWritten: requiredProperty(oneChild, 'fixedAsWritten'),
						defaultAsWritten: requiredProperty(oneChild, 'defaultAsWritten'),
						sequencePosition: requiredProperty(oneChild, 'sequencePosition'),
						documentation: transformDocumentation(
							requiredProperty(oneChild, 'documentation'),
							comparisonOptions,
						),
						anonymousType: anonymousTypePart(oneChild.stableId, comparisonOptions),
					}));
				const attributeParts = childNodes
					.filter((oneChild) => labelHas(oneChild, 'PescAttributeDecl'))
					.sort((childA, childB) => childA.properties.attributePosition - childB.properties.attributePosition)
					.map((oneChild) => ({
						part: 'attribute',
						name: requiredProperty(oneChild, 'name'),
						typeAsWritten: requiredProperty(oneChild, 'typeAsWritten'),
						use: requiredProperty(oneChild, 'use'),
						attributePosition: requiredProperty(oneChild, 'attributePosition'),
						documentation: transformDocumentation(
							requiredProperty(oneChild, 'documentation'),
							comparisonOptions,
						),
						anonymousType: anonymousTypePart(oneChild.stableId, comparisonOptions),
					}));
				const derivationParts = childNodes
					.filter((oneChild) => labelHas(oneChild, 'PescDerivation'))
					.sort(
						(childA, childB) => derivationOrdinal(childA.stableId) - derivationOrdinal(childB.stableId),
					)
					.map((oneChild) => {
						const facets = {};
						FACET_PROPERTY_NAMES.forEach((oneFacetName) => {
							if (Object.prototype.hasOwnProperty.call(oneChild.properties, oneFacetName)) {
								facets[oneFacetName] = oneChild.properties[oneFacetName];
							}
						});
						// enumerationValues re-serializes through parse so the documentation
						// transform applies uniformly; under STRICT this is byte-stable.
						const enumerationEntries = JSON.parse(
							requiredProperty(oneChild, 'enumerationValues'),
						).map((oneEntry) => ({
							value: oneEntry.value,
							documentation: transformDocumentation(oneEntry.documentation, comparisonOptions),
						}));
						return {
							part: 'derivation',
							derivationVariety: requiredProperty(oneChild, 'derivationVariety'),
							contentStyle: requiredProperty(oneChild, 'contentStyle'),
							baseAsWritten: requiredProperty(oneChild, 'baseAsWritten'),
							documentation: transformDocumentation(
								requiredProperty(oneChild, 'documentation'),
								comparisonOptions,
							),
							facets: sortedKeyObject(facets),
							enumerationValues: enumerationEntries,
						};
					});
				return { elementParts, attributeParts, derivationParts };
			};

			const anonymousTypePart = (ownerStableId, comparisonOptions) => {
				const anonymousChildren = (childrenByParentId[ownerStableId] || []).filter((oneChild) =>
					labelHas(oneChild, 'PescAnonymousType'),
				);
				if (anonymousChildren.length === 0) {
					return null;
				}
				if (anonymousChildren.length > 1) {
					refuse(`'${ownerStableId}' owns ${anonymousChildren.length} anonymous types; XSD allows one`);
				}
				const anonymousNode = anonymousChildren[0];
				return {
					part: 'anonymousType',
					typeVariety: requiredProperty(anonymousNode, 'typeVariety'),
					contentModelShape: requiredProperty(anonymousNode, 'contentModelShape'),
					documentation: transformDocumentation(
						requiredProperty(anonymousNode, 'documentation'),
						comparisonOptions,
					),
					...childPartsOfContainer(anonymousNode.stableId, comparisonOptions),
				};
			};

			// fingerprintOf — the canonical serialization of one named definition's content.
			// EXCLUDED on purpose: stableId, namespace, declaring artifact, documentPosition (a
			// definition moving within its file is not a content change), searchText and every
			// other emission convenience. INCLUDED: everything the file SAYS about the definition.
			const fingerprintOf = (definitionStableId, comparisonOptions) => {
				const definitionNode = nodeByStableId[definitionStableId];
				if (definitionNode === undefined || !labelHas(definitionNode, 'PescNamedDefinition')) {
					refuse(`fingerprintOf: '${definitionStableId}' is not a PescNamedDefinition in the input`);
				}
				return JSON.stringify({
					kind: requiredProperty(definitionNode, 'kind'),
					name: requiredProperty(definitionNode, 'name'),
					typeAsWritten: requiredProperty(definitionNode, 'typeAsWritten'),
					substitutionGroupAsWritten: requiredProperty(definitionNode, 'substitutionGroupAsWritten'),
					abstract: requiredProperty(definitionNode, 'abstract'),
					nillable: requiredProperty(definitionNode, 'nillable'),
					contentModelShape: requiredProperty(definitionNode, 'contentModelShape'),
					documentation: transformDocumentation(
						requiredProperty(definitionNode, 'documentation'),
						comparisonOptions,
					),
					anonymousType: anonymousTypePart(definitionStableId, comparisonOptions),
					...childPartsOfContainer(definitionStableId, comparisonOptions),
				});
			};

			return { fingerprintOf };
		};

		// =====================================================================
		// contentModelShape helpers (shared by the R-P2-5 guard and groupRef harvesting)
		// =====================================================================
		const walkShapeParticles = (oneShape, onParticle) => {
			(oneShape.particles || []).forEach((oneParticle) => {
				if (oneParticle.element !== undefined) {
					onParticle({ elementPosition: oneParticle.element });
					return;
				}
				if (oneParticle.compositor !== undefined) {
					walkShapeParticles(oneParticle, onParticle);
					return;
				}
				if (oneParticle.groupRef !== undefined) {
					onParticle({ groupRef: oneParticle.groupRef });
					return;
				}
				if (oneParticle.any !== undefined) {
					onParticle({ any: true });
					return;
				}
				refuse(`contentModelShape carries an unrecognized particle: ${JSON.stringify(oneParticle)}`);
			});
		};

		// =====================================================================
		// buildDerivedTier — the tier. ({ nodes, edges }) -> derivedOutput.
		// Input MUST be the retained (source + meta) graph: derived content in the input refuses.
		// =====================================================================
		const buildDerivedTier = ({ nodes, edges }) => {
			if (!Array.isArray(nodes) || !Array.isArray(edges)) {
				refuse('buildDerivedTier requires { nodes, edges } arrays');
			}
			nodes.forEach((oneNode) => {
				if (oneNode.properties.pescTier === PESC_DERIVED_TIER) {
					refuse(
						`input carries derived-tier node '${oneNode.stableId}' — regeneration must start ` +
							`from source, not from a previous derivation`,
					);
				}
				DERIVED_ANNOTATION_PROPERTY_NAMES.forEach((oneAnnotationName) => {
					if (Object.prototype.hasOwnProperty.call(oneNode.properties, oneAnnotationName)) {
						refuse(
							`input node '${oneNode.stableId}' still carries derived annotation ` +
								`'${oneAnnotationName}' — strip before regenerating or stale derivation echoes through`,
						);
					}
				});
			});

			const graphIndexes = buildGraphIndexes({ nodes });
			const {
				nodeByStableId,
				childrenByParentId,
				artifactModels,
				artifactModelsByNamespace,
				contestedNamespaces,
				declaringArtifactOfNode,
				definitionNodes,
				definitionsByNamespaceAndName,
			} = graphIndexes;

			const rootNode = nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT);
			if (rootNode === undefined) {
				refuse('input carries no standard-root node; the derived tier hangs namespaces off it');
			}
			const standardSource = requiredProperty(rootNode, '_source');
			const stableUriPropertyName = requiredProperty(rootNode, 'stableUriPropertyName');

			const derivedNodes = [];
			const derivedEdges = [];
			const nodeAnnotations = {};
			const unresolvedImports = [];
			const ambiguousPendingSynthesis = [];
			const unresolvedNamespaceReferences = [];
			const stats = {
				namespaces: 0,
				contestedNamespaces,
				inNamespaceEdges: 0,
				importsEdges: 0,
				unresolvedImportsRecorded: 0,
				resolvesToEdges: 0,
				builtinReferenceMarkers: 0,
				ambiguousPendingSynthesisRecorded: 0,
				ambiguousIntraMemberRecorded: 0,
				ambiguousExternalConsumers: [],
				unresolvedNamespaceReferencesRecorded: 0,
				sameDefinitionEdges: 0,
				sameDefinitionExcludedContestedDefinitions: 0,
				isLatestNamespaces: 0,
				definitionsTotal: definitionNodes.length,
				reachableFromLatestRoot: 0,
				contentModelShapeContainersChecked: 0,
				messageRootDefinitionStableIds: [],
			};

			// stageAnnotation — collect derived properties destined for source nodes. One writer
			// per property name per node; a second write to the same slot is a builder bug.
			const stageAnnotation = (targetStableId, annotationName, annotationValue) => {
				const annotationSlot = (nodeAnnotations[targetStableId] =
					nodeAnnotations[targetStableId] || {});
				if (Object.prototype.hasOwnProperty.call(annotationSlot, annotationName)) {
					refuse(
						`derivedTier builder bug: annotation '${annotationName}' staged twice for ` +
							`'${targetStableId}'`,
					);
				}
				annotationSlot[annotationName] = annotationValue;
			};

			const addDerivedEdge = (edgeType, fromStableId, toStableId, extraProperties) => {
				if (!fromStableId || !toStableId) {
					refuse(`derivedTier builder bug: ${edgeType} edge with unresolved endpoint`);
				}
				derivedEdges.push({
					type: edgeType,
					fromRef: { source: standardSource, id: fromStableId },
					toRef: { source: standardSource, id: toStableId },
					properties: {
						provenanceTier: PROVENANCE_TIER.STRUCTURAL,
						pescTier: PESC_DERIVED_TIER,
						...(extraProperties || {}),
					},
				});
			};

			// =============================================================
			// R-P2-5 GUARD — run FIRST: group refs are read from shapes below, so the dual
			// representation must be proven coherent before anything trusts it.
			// =============================================================
			nodes.forEach((oneNode) => {
				const shapeJson = oneNode.properties.contentModelShape;
				if (shapeJson === undefined || shapeJson === null) {
					return;
				}
				stats.contentModelShapeContainersChecked++;
				const shapePositions = [];
				walkShapeParticles(JSON.parse(shapeJson), (oneParticle) => {
					if (oneParticle.elementPosition !== undefined) {
						shapePositions.push(oneParticle.elementPosition);
					}
				});
				const elementChildren = (childrenByParentId[oneNode.stableId] || [])
					.filter((oneChild) => labelHas(oneChild, 'PescElementDecl'))
					.sort(
						(childA, childB) => childA.properties.sequencePosition - childB.properties.sequencePosition,
					);
				const childPositions = elementChildren.map((oneChild) => oneChild.properties.sequencePosition);
				const listsMatch =
					shapePositions.length === childPositions.length &&
					shapePositions.every((onePosition, positionIndex) => onePosition === childPositions[positionIndex]);
				if (!listsMatch) {
					refuse(
						`R-P2-5 consistency: container '${oneNode.stableId}' contentModelShape enumerates ` +
							`element positions [${shapePositions.join(',')}] but its PescElementDecl children ` +
							`carry [${childPositions.join(',')}] (children in order: ` +
							`${elementChildren.map((oneChild) => oneChild.properties.name).join(', ')}). ` +
							`The dual representation has drifted.`,
					);
				}
			});

			// =============================================================
			// PescNamespace nodes + isLatest + IN_NAMESPACE
			// =============================================================
			const familyKeyOfArtifact = (oneArtifactModel) =>
				`${oneArtifactModel.layer}:${oneArtifactModel.standardToken}`;
			const latestVersionByFamily = {};
			artifactModels.forEach((oneArtifactModel) => {
				const familyKey = familyKeyOfArtifact(oneArtifactModel);
				const knownLatest = latestVersionByFamily[familyKey];
				if (
					knownLatest === undefined ||
					compareVersionTokens(oneArtifactModel.versionToken, knownLatest) > 0
				) {
					latestVersionByFamily[familyKey] = oneArtifactModel.versionToken;
				}
			});

			const namespaceStableIdByNamespace = {};
			Object.keys(artifactModelsByNamespace)
				.sort()
				.forEach((oneNamespace) => {
					const claimantArtifactModels = artifactModelsByNamespace[oneNamespace];
					const representativeArtifactModel = claimantArtifactModels[0];
					const familyKey = familyKeyOfArtifact(representativeArtifactModel);
					const isLatest =
						latestVersionByFamily[familyKey] === representativeArtifactModel.versionToken;
					const isContested = contestedNamespaces.indexOf(oneNamespace) !== -1;
					const namespaceStableId = `pescNamespace:${oneNamespace}`;
					namespaceStableIdByNamespace[oneNamespace] = namespaceStableId;
					const namespaceDisplayName = `${representativeArtifactModel.standardToken} ${representativeArtifactModel.versionToken}`;
					derivedNodes.push({
						labels: [NODE_LABELS.FORGED_NODE, 'PescNamespace', DME_ROLES.SUPPORT],
						stableId: namespaceStableId,
						role: DME_ROLES.SUPPORT,
						properties: {
							_id: namespaceStableId,
							_source: standardSource,
							name: oneNamespace,
							description: `PESC namespace ${namespaceDisplayName} (layer ${representativeArtifactModel.layer})`,
							documentation: '',
							role: DME_ROLES.SUPPORT,
							[stableUriPropertyName]: namespaceStableId,
							searchText: buildSearchText({
								role: DME_ROLES.SUPPORT,
								name: oneNamespace,
								owningName: namespaceDisplayName,
								standardName: standardSource,
							}),
							crossRefs: JSON.stringify([]),
							parentId: rootNode.stableId,
							depth: 1,
							path: oneNamespace,
							pescTier: PESC_DERIVED_TIER,
							layer: representativeArtifactModel.layer,
							standardToken: representativeArtifactModel.standardToken,
							version: representativeArtifactModel.versionToken,
							isLatest,
							contested: isContested,
							artifactCount: claimantArtifactModels.length,
						},
					});
					stats.namespaces++;
					if (isLatest) {
						stats.isLatestNamespaces++;
					}
				});

			artifactModels.forEach((oneArtifactModel) => {
				addDerivedEdge(
					'IN_NAMESPACE',
					oneArtifactModel.stableId,
					namespaceStableIdByNamespace[oneArtifactModel.targetNamespace],
					{},
				);
				stats.inNamespaceEdges++;
			});

			// =============================================================
			// IMPORTS — resolved artifact -> artifact; absent target RECORDED; contested RECORDED
			// =============================================================
			const importsEdgeSeen = {};
			nodes
				.filter((oneNode) => labelHas(oneNode, 'PescImportDecl'))
				.forEach((oneImportNode) => {
					const declaringArtifactModel = declaringArtifactOfNode(oneImportNode.stableId);
					const importedNamespace = requiredProperty(oneImportNode, 'namespaceAsWritten');
					if (contestedNamespaces.indexOf(importedNamespace) !== -1) {
						const ambiguousEntry = {
							fromStableId: oneImportNode.stableId,
							declaringFilename: declaringArtifactModel.filename,
							referenceVariety: 'import',
							writtenAs: importedNamespace,
							namespace: importedNamespace,
							localName: null,
							intraMember: declaringArtifactModel.targetNamespace === importedNamespace,
							candidateStableIds: artifactModelsByNamespace[importedNamespace]
								.map((oneClaimant) => oneClaimant.stableId)
								.sort(),
						};
						ambiguousPendingSynthesis.push(ambiguousEntry);
						stageAnnotation(
							oneImportNode.stableId,
							'ambiguousPendingSynthesis',
							JSON.stringify([ambiguousEntry]),
						);
						return;
					}
					const claimantArtifactModels = artifactModelsByNamespace[importedNamespace];
					if (claimantArtifactModels === undefined) {
						const unresolvedEntry = {
							fromStableId: oneImportNode.stableId,
							declaringFilename: declaringArtifactModel.filename,
							namespaceAsWritten: importedNamespace,
							reason:
								'no artifact in the corpus claims this namespace; resolution is Phase 4 ' +
								"S-2's synthetic alias, not this tier's to invent",
						};
						unresolvedImports.push(unresolvedEntry);
						stageAnnotation(
							oneImportNode.stableId,
							'unresolvedImportFact',
							JSON.stringify(unresolvedEntry),
						);
						return;
					}
					const targetArtifactModel = claimantArtifactModels[0];
					const dedupeKey = `${declaringArtifactModel.stableId} ${targetArtifactModel.stableId}`;
					if (importsEdgeSeen[dedupeKey]) {
						refuse(
							`artifact '${declaringArtifactModel.filename}' imports namespace ` +
								`'${importedNamespace}' more than once — new information demanding a deliberate ` +
								`model decision, not a silent dedupe`,
						);
					}
					importsEdgeSeen[dedupeKey] = true;
					addDerivedEdge('IMPORTS', declaringArtifactModel.stableId, targetArtifactModel.stableId, {
						namespace: importedNamespace,
						importDeclStableId: oneImportNode.stableId,
					});
					stats.importsEdges++;
				});
			stats.unresolvedImportsRecorded = unresolvedImports.length;

			// =============================================================
			// RESOLVES_TO — per-artifact prefix bindings, quarantined contested namespace,
			// terminal builtin markers, recorded absent-namespace references.
			// =============================================================
			const ambiguousEntriesByNode = {};
			const unresolvedReferenceEntriesByNode = {};
			const resolveOneReference = ({ fromNode, writtenValue, referenceVariety, groupRefOccurrences }) => {
				const declaringArtifactModel = declaringArtifactOfNode(fromNode.stableId);
				const colonIndex = writtenValue.indexOf(':');
				const writtenPrefix = colonIndex === -1 ? '' : writtenValue.substring(0, colonIndex);
				const localName = colonIndex === -1 ? writtenValue : writtenValue.substring(colonIndex + 1);
				const boundNamespace = declaringArtifactModel.prefixBindings[writtenPrefix];
				if (boundNamespace === undefined) {
					refuse(
						`file '${declaringArtifactModel.filename}': reference '${writtenValue}' on ` +
							`'${fromNode.stableId}' uses ${writtenPrefix === '' ? 'the default namespace' : `prefix '${writtenPrefix}'`}, ` +
							`which the artifact's own prefix table does not bind`,
					);
				}

				if (boundNamespace === XSD_NAMESPACE) {
					if (referenceVariety !== 'type' && referenceVariety !== 'base') {
						refuse(
							`file '${declaringArtifactModel.filename}': ${referenceVariety} reference ` +
								`'${writtenValue}' targets the XSD namespace — a shape this corpus never ` +
								`showed; deciding it silently is not an option`,
						);
					}
					stageAnnotation(fromNode.stableId, 'resolvesToBuiltinXsd', writtenValue);
					stats.builtinReferenceMarkers++;
					return;
				}

				if (contestedNamespaces.indexOf(boundNamespace) !== -1) {
					const admissibleKinds = ADMISSIBLE_TARGET_KINDS[referenceVariety];
					const candidateStableIds = (
						definitionsByNamespaceAndName[`${boundNamespace} ${localName}`] || []
					)
						.filter((oneCandidate) => admissibleKinds.indexOf(oneCandidate.kind) !== -1)
						.map((oneCandidate) => oneCandidate.stableId)
						.sort();
					const ambiguousEntry = {
						fromStableId: fromNode.stableId,
						declaringFilename: declaringArtifactModel.filename,
						referenceVariety,
						writtenAs: writtenValue,
						namespace: boundNamespace,
						localName,
						intraMember: declaringArtifactModel.targetNamespace === boundNamespace,
						candidateStableIds,
					};
					ambiguousPendingSynthesis.push(ambiguousEntry);
					(ambiguousEntriesByNode[fromNode.stableId] =
						ambiguousEntriesByNode[fromNode.stableId] || []).push(ambiguousEntry);
					return;
				}

				if (artifactModelsByNamespace[boundNamespace] === undefined) {
					const unresolvedEntry = {
						fromStableId: fromNode.stableId,
						declaringFilename: declaringArtifactModel.filename,
						referenceVariety,
						writtenAs: writtenValue,
						namespace: boundNamespace,
						localName,
						reason:
							'the bound namespace has no artifact in the corpus (the CoreMain v1.6.0 gap); ' +
							"resolution is Phase 4 S-2's synthetic alias",
					};
					unresolvedNamespaceReferences.push(unresolvedEntry);
					(unresolvedReferenceEntriesByNode[fromNode.stableId] =
						unresolvedReferenceEntriesByNode[fromNode.stableId] || []).push(unresolvedEntry);
					return;
				}

				const admissibleKinds = ADMISSIBLE_TARGET_KINDS[referenceVariety];
				const candidateDefinitions = (
					definitionsByNamespaceAndName[`${boundNamespace} ${localName}`] || []
				).filter((oneCandidate) => admissibleKinds.indexOf(oneCandidate.kind) !== -1);
				if (candidateDefinitions.length === 0) {
					refuse(
						`file '${declaringArtifactModel.filename}': reference '${writtenValue}' ` +
							`(${referenceVariety}) resolves to namespace '${boundNamespace}', but no ` +
							`${admissibleKinds.join('/')} named '${localName}' exists there`,
					);
				}
				if (candidateDefinitions.length > 1) {
					refuse(
						`file '${declaringArtifactModel.filename}': reference '${writtenValue}' matches ` +
							`${candidateDefinitions.length} definitions in '${boundNamespace}' — one symbol ` +
							`space should hold one; the model has met something it does not understand`,
					);
				}
				const edgeExtras = { referenceVariety, writtenAs: writtenValue };
				if (groupRefOccurrences !== undefined && groupRefOccurrences > 1) {
					edgeExtras.groupRefOccurrences = groupRefOccurrences;
				}
				addDerivedEdge('RESOLVES_TO', fromNode.stableId, candidateDefinitions[0].stableId, edgeExtras);
				stats.resolvesToEdges++;
			};

			nodes.forEach((oneNode) => {
				if (labelHas(oneNode, 'PescElementDecl') || labelHas(oneNode, 'PescAttributeDecl')) {
					const writtenType = requiredProperty(oneNode, 'typeAsWritten');
					if (writtenType !== null) {
						resolveOneReference({ fromNode: oneNode, writtenValue: writtenType, referenceVariety: 'type' });
					}
				}
				if (labelHas(oneNode, 'PescDerivation')) {
					resolveOneReference({
						fromNode: oneNode,
						writtenValue: requiredProperty(oneNode, 'baseAsWritten'),
						referenceVariety: 'base',
					});
				}
				if (labelHas(oneNode, 'PescNamedDefinition') && oneNode.properties.kind === 'element') {
					const writtenType = requiredProperty(oneNode, 'typeAsWritten');
					if (writtenType !== null) {
						resolveOneReference({ fromNode: oneNode, writtenValue: writtenType, referenceVariety: 'type' });
					}
					const writtenSubstitutionGroup = requiredProperty(oneNode, 'substitutionGroupAsWritten');
					if (writtenSubstitutionGroup !== null) {
						resolveOneReference({
							fromNode: oneNode,
							writtenValue: writtenSubstitutionGroup,
							referenceVariety: 'substitutionGroup',
						});
					}
				}
				// group refs ride inside contentModelShape (R-P2-5's coherence proven above).
				const shapeJson = oneNode.properties.contentModelShape;
				if (shapeJson !== undefined && shapeJson !== null) {
					const groupRefOccurrenceCounts = {};
					walkShapeParticles(JSON.parse(shapeJson), (oneParticle) => {
						if (oneParticle.groupRef !== undefined) {
							groupRefOccurrenceCounts[oneParticle.groupRef] =
								(groupRefOccurrenceCounts[oneParticle.groupRef] || 0) + 1;
						}
					});
					Object.keys(groupRefOccurrenceCounts)
						.sort()
						.forEach((oneWrittenGroupRef) => {
							resolveOneReference({
								fromNode: oneNode,
								writtenValue: oneWrittenGroupRef,
								referenceVariety: 'groupRef',
								groupRefOccurrences: groupRefOccurrenceCounts[oneWrittenGroupRef],
							});
						});
				}
			});
			Object.keys(ambiguousEntriesByNode).forEach((oneStableId) => {
				stageAnnotation(
					oneStableId,
					'ambiguousPendingSynthesis',
					JSON.stringify(ambiguousEntriesByNode[oneStableId]),
				);
			});
			Object.keys(unresolvedReferenceEntriesByNode).forEach((oneStableId) => {
				stageAnnotation(
					oneStableId,
					'unresolvedNamespaceReferences',
					JSON.stringify(unresolvedReferenceEntriesByNode[oneStableId]),
				);
			});
			stats.ambiguousPendingSynthesisRecorded = ambiguousPendingSynthesis.length;
			stats.ambiguousIntraMemberRecorded = ambiguousPendingSynthesis.filter(
				(oneEntry) => oneEntry.intraMember,
			).length;
			stats.ambiguousExternalConsumers = [
				...new Set(
					ambiguousPendingSynthesis
						.filter((oneEntry) => !oneEntry.intraMember)
						.map((oneEntry) => oneEntry.declaringFilename),
				),
			].sort();
			stats.unresolvedNamespaceReferencesRecorded = unresolvedNamespaceReferences.length;

			// =============================================================
			// SAME_DEFINITION — D-4 (library families only) + D-7 (chains, ascending versions).
			// Cluster = the set of versions carrying the IDENTICAL definition (strict fingerprint);
			// members chain consecutively in version order; the newest member is the cluster
			// representative and its stableId is the clusterId on every member.
			// =============================================================
			const { fingerprintOf } = makeFingerprintBuilder(graphIndexes);
			const { artifactModelBySha256 } = graphIndexes;

			const clusterIdByDefinition = {};
			definitionNodes.forEach((oneDefinitionNode) => {
				clusterIdByDefinition[oneDefinitionNode.stableId] = oneDefinitionNode.stableId; // singleton default
			});

			const chainGroups = {}; // familyKey   kind   name   fingerprint -> members
			definitionNodes.forEach((oneDefinitionNode) => {
				const declaringArtifactModel =
					artifactModelBySha256[oneDefinitionNode.properties.declaringArtifactSha256];
				if (declaringArtifactModel.layer === 'message') {
					return; // D-4: library families only — message-layer definitions stay singletons
				}
				if (contestedNamespaces.indexOf(declaringArtifactModel.targetNamespace) !== -1) {
					// two rival artifacts at one version cannot sit in a CHAIN whose axis is the
					// version; the contested members wait for Phase 4's synthesis (PROVISIONAL).
					stats.sameDefinitionExcludedContestedDefinitions++;
					return;
				}
				const groupKey = [
					familyKeyOfArtifact(declaringArtifactModel),
					oneDefinitionNode.properties.kind,
					oneDefinitionNode.properties.name,
					fingerprintOf(oneDefinitionNode.stableId, STRICT_COMPARISON),
				].join(' ');
				(chainGroups[groupKey] = chainGroups[groupKey] || []).push({
					definitionStableId: oneDefinitionNode.stableId,
					versionToken: declaringArtifactModel.versionToken,
				});
			});

			Object.keys(chainGroups)
				.sort()
				.forEach((oneGroupKey) => {
					const groupMembers = chainGroups[oneGroupKey];
					if (groupMembers.length < 2) {
						return;
					}
					groupMembers.sort((memberA, memberB) =>
						compareVersionTokens(memberA.versionToken, memberB.versionToken),
					);
					const groupKeyParts = oneGroupKey.split(' ');
					const clusterRepresentativeStableId =
						groupMembers[groupMembers.length - 1].definitionStableId;
					groupMembers.forEach((oneMember, memberIndex) => {
						clusterIdByDefinition[oneMember.definitionStableId] = clusterRepresentativeStableId;
						if (memberIndex + 1 < groupMembers.length) {
							addDerivedEdge(
								'SAME_DEFINITION',
								oneMember.definitionStableId,
								groupMembers[memberIndex + 1].definitionStableId,
								{
									familyKey: groupKeyParts[0],
									definitionKind: groupKeyParts[1],
									definitionName: groupKeyParts[2],
									fromVersion: oneMember.versionToken,
									toVersion: groupMembers[memberIndex + 1].versionToken,
								},
							);
							stats.sameDefinitionEdges++;
						}
					});
				});

			// =============================================================
			// reachableFromLatestRoot — BFS from the latest version of each message root, down
			// containment and across RESOLVES_TO. Contested paths run as far as resolution exists
			// (ambiguous references have no edges, so the quarantine bounds the walk naturally).
			// =============================================================
			const resolvesToTargetsByFrom = {};
			derivedEdges.forEach((oneEdge) => {
				if (oneEdge.type === 'RESOLVES_TO') {
					(resolvesToTargetsByFrom[oneEdge.fromRef.id] =
						resolvesToTargetsByFrom[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
				}
			});

			const messageRootDefinitionStableIds = [];
			const messageFamilies = {};
			artifactModels
				.filter((oneArtifactModel) => oneArtifactModel.layer === 'message')
				.forEach((oneArtifactModel) => {
					const familyKey = familyKeyOfArtifact(oneArtifactModel);
					const knownLatest = messageFamilies[familyKey];
					if (
						knownLatest === undefined ||
						compareVersionTokens(oneArtifactModel.versionToken, knownLatest.versionToken) > 0
					) {
						messageFamilies[familyKey] = oneArtifactModel;
					}
				});
			Object.keys(messageFamilies)
				.sort()
				.forEach((oneFamilyKey) => {
					const latestArtifactModel = messageFamilies[oneFamilyKey];
					const rootDefinitions = definitionNodes.filter(
						(oneDefinitionNode) =>
							oneDefinitionNode.properties.declaringArtifactSha256 === latestArtifactModel.sha256 &&
							oneDefinitionNode.properties.kind === 'element',
					);
					if (rootDefinitions.length === 0) {
						refuse(
							`message artifact '${latestArtifactModel.filename}' declares no top-level ` +
								`element — a message without a root is not a message`,
						);
					}
					rootDefinitions
						.map((oneDefinitionNode) => oneDefinitionNode.stableId)
						.sort()
						.forEach((oneStableId) => messageRootDefinitionStableIds.push(oneStableId));
				});
			stats.messageRootDefinitionStableIds = messageRootDefinitionStableIds;

			const reachableDefinitionStableIds = new Set();
			const visitQueue = [...messageRootDefinitionStableIds];
			while (visitQueue.length > 0) {
				const currentDefinitionStableId = visitQueue.shift();
				if (reachableDefinitionStableIds.has(currentDefinitionStableId)) {
					continue;
				}
				reachableDefinitionStableIds.add(currentDefinitionStableId);
				// gather the definition's whole containment subtree, then hop RESOLVES_TO edges
				// from any node in it (the definition node itself included).
				const subtreeStableIds = [currentDefinitionStableId];
				for (let cursorIndex = 0; cursorIndex < subtreeStableIds.length; cursorIndex++) {
					((childrenByParentId[subtreeStableIds[cursorIndex]] || [])).forEach((oneChild) => {
						subtreeStableIds.push(oneChild.stableId);
					});
				}
				subtreeStableIds.forEach((oneSubtreeStableId) => {
					(resolvesToTargetsByFrom[oneSubtreeStableId] || []).forEach((oneTargetStableId) => {
						if (!reachableDefinitionStableIds.has(oneTargetStableId)) {
							visitQueue.push(oneTargetStableId);
						}
					});
				});
			}
			stats.reachableFromLatestRoot = reachableDefinitionStableIds.size;

			definitionNodes.forEach((oneDefinitionNode) => {
				stageAnnotation(
					oneDefinitionNode.stableId,
					'sameDefinitionClusterId',
					clusterIdByDefinition[oneDefinitionNode.stableId],
				);
				stageAnnotation(
					oneDefinitionNode.stableId,
					'reachableFromLatestRoot',
					reachableDefinitionStableIds.has(oneDefinitionNode.stableId),
				);
			});

			return {
				nodes: derivedNodes,
				edges: derivedEdges,
				nodeAnnotations,
				unresolvedImports,
				ambiguousPendingSynthesis,
				unresolvedNamespaceReferences,
				stats,
			};
		};

		// =====================================================================
		// applyDerivedTier — stamp the annotations onto the source nodes (mutates their
		// properties — the forge builds fresh nodes each run, and the gate feeds clones) and
		// return the combined graph. ONE application path: forge and test harness both use this.
		// =====================================================================
		const applyDerivedTier = ({ nodes, edges, derivedOutput }) => {
			const nodeByStableId = {};
			nodes.forEach((oneNode) => {
				nodeByStableId[oneNode.stableId] = oneNode;
			});
			Object.keys(derivedOutput.nodeAnnotations).forEach((oneStableId) => {
				const targetNode = nodeByStableId[oneStableId];
				if (targetNode === undefined) {
					refuse(`applyDerivedTier: annotation target '${oneStableId}' is not in the graph`);
				}
				Object.assign(targetNode.properties, derivedOutput.nodeAnnotations[oneStableId]);
			});
			return {
				nodes: nodes.concat(derivedOutput.nodes),
				edges: edges.concat(derivedOutput.edges),
			};
		};

		// =====================================================================
		// canonicalizeDerivedView — the DERIVED CONTENT of a combined graph as one canonical
		// string: derived nodes, derived edges, and the annotations sitting on source nodes.
		// Gate G3-A compares two of these; the determinism gate compares whole graphs with it too.
		// =====================================================================
		const canonicalizeDerivedView = ({ nodes, edges }) => {
			const derivedNodeViews = nodes
				.filter((oneNode) => oneNode.properties.pescTier === PESC_DERIVED_TIER)
				.map((oneNode) => ({
					stableId: oneNode.stableId,
					labels: [...oneNode.labels].sort(),
					properties: sortedKeyObject(oneNode.properties),
				}))
				.sort((viewA, viewB) => (viewA.stableId < viewB.stableId ? -1 : 1));
			const derivedEdgeViews = edges
				.filter((oneEdge) => oneEdge.properties.pescTier === PESC_DERIVED_TIER)
				.map((oneEdge) => ({
					type: oneEdge.type,
					from: oneEdge.fromRef.id,
					to: oneEdge.toRef.id,
					properties: sortedKeyObject(oneEdge.properties),
				}))
				.sort((viewA, viewB) => {
					const keyA = `${viewA.type} ${viewA.from} ${viewA.to} ${JSON.stringify(viewA.properties)}`;
					const keyB = `${viewB.type} ${viewB.from} ${viewB.to} ${JSON.stringify(viewB.properties)}`;
					return keyA < keyB ? -1 : 1;
				});
			const annotationViews = nodes
				.filter((oneNode) => oneNode.properties.pescTier !== PESC_DERIVED_TIER)
				.map((oneNode) => {
					const presentAnnotations = {};
					DERIVED_ANNOTATION_PROPERTY_NAMES.forEach((oneAnnotationName) => {
						if (Object.prototype.hasOwnProperty.call(oneNode.properties, oneAnnotationName)) {
							presentAnnotations[oneAnnotationName] = oneNode.properties[oneAnnotationName];
						}
					});
					return Object.keys(presentAnnotations).length > 0
						? { stableId: oneNode.stableId, annotations: sortedKeyObject(presentAnnotations) }
						: null;
				})
				.filter((oneView) => oneView !== null)
				.sort((viewA, viewB) => (viewA.stableId < viewB.stableId ? -1 : 1));
			return JSON.stringify({
				derivedNodes: derivedNodeViews,
				derivedEdges: derivedEdgeViews,
				annotations: annotationViews,
			});
		};

		// =====================================================================
		// makeFingerprintKit — HARNESS-FACING: the same strict-comparison machinery, exposed so
		// gates can measure (G3-C's 846/50 split) and demonstrate RED levers (loosened
		// comparisonOptions). The production path never passes anything but STRICT_COMPARISON.
		// =====================================================================
		const makeFingerprintKit = ({ nodes }) => {
			const graphIndexes = buildGraphIndexes({ nodes });
			const { fingerprintOf } = makeFingerprintBuilder(graphIndexes);
			return {
				fingerprintOf,
				STRICT_COMPARISON,
				graphIndexes,
			};
		};

		return {
			buildDerivedTier,
			applyDerivedTier,
			canonicalizeDerivedView,
			makeFingerprintKit,
			DERIVED_ANNOTATION_PROPERTY_NAMES,
			STRICT_COMPARISON,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
