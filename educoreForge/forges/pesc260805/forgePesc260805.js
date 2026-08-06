'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgePesc260805.js — the PESC260805 forge bundle: SOURCE-TIER graph of the 64-file PESC aggregate
// (DESIGN-pescGraphModel-080526 §3.1; Phase 2 of the pesc rebuild work order).
//
// THE SPINE IS THE FILE (design §1): one PescArtifact node per corpus file, DECLARES edges to every
// named definition the file carries — reachable or not — and containment below that. Everything
// emitted here is what a file LITERALLY SAYS: typeAsWritten/baseAsWritten stay prefixed and
// verbatim, documentation is carried byte-faithful (no whitespace collapse, R-VAL-2), facets are
// first-class (the incumbent's single largest loss, spec §7.1). NO reference-resolution edges exist
// in this phase — resolution is the DERIVED tier (Phase 3), computed later from each artifact's own
// prefixBindings.
//
// IDENTITY (design §4, rulings D-1..D-3):
//   * artifact:            pescArtifact:<sha256>            (content-addressed; can never collide)
//   * named definition:    <targetNamespace>#<kind>/<localName>
//       - D-1: within a CONTESTED namespace only (two artifacts, one namespace — the
//         AcademicRecord v1.6.0 defect), the key gains '@<sha256:12>' of the declaring artifact.
//         Contested-ness is COMPUTED from the parsed corpus (>=2 distinct sha256 per namespace),
//         never read from a manifest, so a fixture corpus is judged by the same rule.
//   * local element:       <parentStableId>/el/<sequencePosition>:<name>
//   * anonymous type:      <containerStableId>/anon/<position>
//   * restriction/attr:    <containerStableId>/restriction/<n>, <containerStableId>/attr/<n>:<name>
//
// TIERS (design §2): every node and edge carries bundle-local pescTier:'source'; every edge ALSO
// carries provenanceTier:'structural' (the shared guard's requirement — the four-value enum cannot
// be extended without touching shared code). PROVISIONAL EXCEPTION, flagged for supervisor review:
// the DmeStandardRoot and its ownership edges carry pescTier:'meta' — the root is neither said by
// any file (not 'source'), nor regenerable by the Phase 3 derivation pass (not 'derived'), nor a
// judgment about PESC content (not 'synthetic'). Design §2's enum has no value for it; 'meta' keeps
// the emitter's source predicate and Gate 3's derived-deletion set both clean.
//
// Async style: qtools taskListPlus/pipeRunner, err-first callback strings, no async/await, no
// try/catch for control flow (ONE sanctioned boundary converts the pure builder's throws).
// Works with embedder null when skipEmbedding is true (Phase 2 builds without vectorization);
// searchText is populated regardless, via the ONE shared 1C builder.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const parserFactory = require('./lib/parser');
const derivedTierFactory = require('./lib/derivedTier');
const syntheticTierFactory = require('./lib/syntheticTier');

const CORE_LIB = path.join(__dirname, '..', '..', 'lib');
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));
const { NODE_LABELS, DME_ROLES, EDGE_TYPES, PROVENANCE_TIER } = require(
	path.join(CORE_LIB, 'vocabulary', 'vocabulary'),
);

const STANDARD_KEY = 'pesc260805';
// D-6 (supervisor ruling): deliberately DISTINCT from the incumbent's 'PESC' so both bundles can
// coexist in one graph while the rebuild earns retirement of the incumbent on evidence.
const STANDARD_SOURCE = 'PESC260805';
const STANDARD_DISPLAY = 'Postsecondary Electronic Standards Council (PESC) - pesc260805 rebuild';
const STABLE_URI_PROPERTY_NAME = 'pesc260805StableId';
const ROOT_STABLE_ID = 'pesc260805:root';
const AGGREGATE_VERSION = 'aggregate-01'; // OURS, never a PESC edition (R-ACQ-7); manifest.json names constituents
const EMBED_BATCH_SIZE = 128;

const PESC_TIER = { SOURCE: 'source', META: 'meta' };

// mappingInstruction on the root (contract §B). Phase 2 makes no mapping claims: no CEDS anchors
// exist in XSD source, so the instruction is honestly empty rather than borrowed from a sibling.
const pescMappingInstruction = {
	cedsOriginalAnchorPropertyName: [],
	cedsOptionOriginalAnchorPropertyName: [],
	crosswalkPrefix: [],
	crosswalkResolveProperty: STABLE_URI_PROPERTY_NAME,
	includeInImplied: false,
	impliedTargets: [],
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const xLog = (process.global && process.global.xLog) || {
			status: () => {},
			error: (message) => console.error(message),
		};
		const { buildSearchText } = buildSearchTextFactory();
		const { parsePescCorpus } = parserFactory();
		const { buildDerivedTier, applyDerivedTier } = derivedTierFactory();
		const { buildSyntheticTier } = syntheticTierFactory();

		// =====================================================================
		// buildSourceTierGraph — PURE, deterministic: parsed corpus -> { nodes, edges, stats }.
		// Same corpus -> identical stableId sets (gate G-A).
		// =====================================================================
		const buildSourceTierGraph = ({ artifacts, parseAudit }) => {
			const nodes = [];
			const edges = [];
			const stats = {
				artifacts: 0,
				importDecls: 0,
				namedDefinitions: 0,
				elementDecls: 0,
				anonymousTypes: 0,
				derivations: 0,
				attributeDecls: 0,
				enumerationValuesCarried: 0,
				contestedNamespaces: [],
				parseAudit,
			};

			// ---- D-1 precomputation: a namespace is CONTESTED when >=2 artifacts with DIFFERENT
			// bytes claim it. The discriminator applies exactly there and nowhere else.
			const shaSetByNamespace = {};
			artifacts.forEach((oneArtifact) => {
				(shaSetByNamespace[oneArtifact.targetNamespace] =
					shaSetByNamespace[oneArtifact.targetNamespace] || []).push(oneArtifact.sha256);
			});
			const contestedNamespaces = Object.keys(shaSetByNamespace)
				.filter((oneNamespace) => shaSetByNamespace[oneNamespace].length > 1)
				.sort();
			stats.contestedNamespaces = contestedNamespaces;

			// ---- makeNode — stamp the universal forged-node property shape (forgeSif.js pattern)
			// plus the bundle-local source-tier facts. documentation rides VERBATIM.
			const makeNode = ({
				role,
				perStandardLabel,
				stableId,
				name,
				documentation,
				searchTextElement,
				structural,
				scalar,
			}) => {
				const node = {
					labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role],
					stableId,
					role,
					properties: {
						_id: stableId,
						_source: STANDARD_SOURCE,
						name: name == null ? '' : `${name}`,
						description: documentation || '',
						documentation: documentation || '',
						role,
						[STABLE_URI_PROPERTY_NAME]: stableId,
						searchText: buildSearchText(searchTextElement),
						crossRefs: JSON.stringify([]),
						parentId: structural.parentId,
						depth: structural.depth,
						path: structural.path,
						pescTier: PESC_TIER.SOURCE,
						...(scalar || {}),
					},
				};
				nodes.push(node);
				return node;
			};

			// ---- addEdge — every edge carries the shared guard's provenanceTier AND the
			// bundle-local pescTier (design §2). Both endpoints are stableIds minted THIS run, so
			// an unresolved endpoint is a builder bug — throw, never a partial edge.
			const addEdge = (edgeType, fromStableId, toStableId, extraProperties, pescTier) => {
				if (!fromStableId || !toStableId) {
					throw new Error(
						`forge-pesc260805 builder bug: ${edgeType} edge with unresolved endpoint ` +
							`(${fromStableId} -> ${toStableId})`,
					);
				}
				edges.push({
					type: edgeType,
					fromRef: { source: STANDARD_SOURCE, id: fromStableId },
					toRef: { source: STANDARD_SOURCE, id: toStableId },
					properties: {
						provenanceTier: PROVENANCE_TIER.STRUCTURAL,
						pescTier: pescTier || PESC_TIER.SOURCE,
						...(extraProperties || {}),
					},
				});
			};

			// ---- the DmeStandardRoot (provenance block; pescTier 'meta' — see header PROVISIONAL).
			nodes.push({
				labels: [NODE_LABELS.FORGED_NODE, 'Pesc260805Root', DME_ROLES.STANDARD_ROOT],
				stableId: ROOT_STABLE_ID,
				role: DME_ROLES.STANDARD_ROOT,
				properties: {
					_id: ROOT_STABLE_ID,
					_source: STANDARD_SOURCE,
					name: STANDARD_SOURCE,
					description: `${STANDARD_DISPLAY} — ${artifacts.length} schema artifacts, source tier`,
					role: DME_ROLES.STANDARD_ROOT,
					[STABLE_URI_PROPERTY_NAME]: ROOT_STABLE_ID,
					searchText: buildSearchText({
						role: DME_ROLES.STANDARD_ROOT,
						name: STANDARD_SOURCE,
						standardName: STANDARD_DISPLAY,
					}),
					standardKey: STANDARD_KEY,
					standardName: STANDARD_DISPLAY,
					version: AGGREGATE_VERSION,
					sourceFormat: 'pesc-xsd-directory',
					sourceFiles: artifacts.map((oneArtifact) => oneArtifact.filename),
					sourceUrl: '',
					parserVersion: '1',
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
					mappingInstruction: JSON.stringify(pescMappingInstruction),
					pescTier: PESC_TIER.META,
				},
			});

			// =====================================================================
			// per-artifact emission
			// =====================================================================
			artifacts.forEach((oneArtifact) => {
				const isCollisionMember = contestedNamespaces.indexOf(oneArtifact.targetNamespace) !== -1;
				const collisionDiscriminator = isCollisionMember
					? `@${oneArtifact.sha256.substring(0, 12)}`
					: '';
				const artifactStableId = `pescArtifact:${oneArtifact.sha256}`;
				const owningName = `${oneArtifact.standardToken} ${oneArtifact.versionToken}`;

				makeNode({
					role: DME_ROLES.SUPPORT,
					perStandardLabel: 'PescArtifact',
					stableId: artifactStableId,
					name: oneArtifact.filename,
					documentation: oneArtifact.documentation,
					searchTextElement: {
						role: DME_ROLES.SUPPORT,
						name: oneArtifact.filename,
						owningName,
						standardName: STANDARD_SOURCE,
					},
					structural: {
						parentId: ROOT_STABLE_ID,
						depth: 1,
						path: oneArtifact.filename,
					},
					scalar: {
						filename: oneArtifact.filename,
						targetNamespace: oneArtifact.targetNamespace,
						sha256: oneArtifact.sha256,
						byteCount: oneArtifact.byteCount,
						collisionMember: isCollisionMember,
						prefixBindings: JSON.stringify(oneArtifact.prefixBindings),
						schemaAttributes: JSON.stringify(oneArtifact.schemaAttributes),
						elementFormDefault: oneArtifact.schemaAttributes.elementFormDefault || '',
						attributeFormDefault: oneArtifact.schemaAttributes.attributeFormDefault || '',
						schemaVersionAttribute: oneArtifact.schemaAttributes.version || '',
						layer: oneArtifact.layer,
						standardToken: oneArtifact.standardToken,
						versionToken: oneArtifact.versionToken,
					},
				});
				addEdge(EDGE_TYPES.HAS_SUPPORT, ROOT_STABLE_ID, artifactStableId, {}, PESC_TIER.META);
				stats.artifacts++;

				// ---- import declarations (source rows; the resolved IMPORTS edge is Phase 3's)
				oneArtifact.imports.forEach((oneImport) => {
					const importStableId = `${artifactStableId}/import/${oneImport.documentPosition}`;
					makeNode({
						role: DME_ROLES.SUPPORT,
						perStandardLabel: 'PescImportDecl',
						stableId: importStableId,
						name: oneImport.namespaceAsWritten,
						documentation: '',
						searchTextElement: {
							role: DME_ROLES.SUPPORT,
							name: oneImport.namespaceAsWritten,
							owningName: oneArtifact.filename,
							standardName: STANDARD_SOURCE,
						},
						structural: {
							parentId: artifactStableId,
							depth: 2,
							path: `${oneArtifact.filename}.import[${oneImport.documentPosition}]`,
						},
						scalar: {
							namespaceAsWritten: oneImport.namespaceAsWritten,
							schemaLocationAsWritten: oneImport.schemaLocationAsWritten,
							documentPosition: oneImport.documentPosition,
						},
					});
					addEdge('DECLARES', artifactStableId, importStableId, {
						documentPosition: oneImport.documentPosition,
					});
					stats.importDecls++;
				});

				// ---- containment emission, recursive over the parsed container model ----
				// container = a node that owns elements/attributes/derivations. Elements declared
				// inside a derivation (extension/restriction) hang off the CONTAINER — uniform
				// HAS_PROPERTY — while the PescDerivation child records the wrapper the emitter
				// must rebuild (contentStyle + derivationVariety).
				const emitContainerContents = ({
					containerStableId,
					containerName,
					containerPath,
					content,
					depth,
				}) => {
					content.elements.forEach((oneElement) => {
						const elementStableId = `${containerStableId}/el/${oneElement.sequencePosition}:${oneElement.name}`;
						makeNode({
							role: DME_ROLES.PROPERTY,
							perStandardLabel: 'PescElementDecl',
							stableId: elementStableId,
							name: oneElement.name,
							documentation: oneElement.documentation,
							searchTextElement: {
								role: DME_ROLES.PROPERTY,
								name: oneElement.name,
								owningClassName: containerName,
							},
							structural: {
								parentId: containerStableId,
								depth: depth + 1,
								path: `${containerPath}.${oneElement.name}`,
							},
							scalar: {
								typeAsWritten: oneElement.typeAsWritten,
								minOccurs: oneElement.minOccursAsWritten,
								maxOccurs: oneElement.maxOccursAsWritten,
								nillable: oneElement.nillableAsWritten,
								fixedAsWritten: oneElement.fixedAsWritten,
								defaultAsWritten: oneElement.defaultAsWritten,
								sequencePosition: oneElement.sequencePosition,
							},
						});
						addEdge(EDGE_TYPES.HAS_PROPERTY, containerStableId, elementStableId, {
							sequencePosition: oneElement.sequencePosition,
						});
						stats.elementDecls++;
						if (oneElement.anonymousType) {
							emitAnonymousType({
								ownerStableId: elementStableId,
								ownerName: `${containerName}.${oneElement.name}`,
								ownerPath: `${containerPath}.${oneElement.name}`,
								anonymousType: oneElement.anonymousType,
								depth: depth + 1,
							});
						}
					});

					content.attributes.forEach((oneAttribute) => {
						const attributeStableId = `${containerStableId}/attr/${oneAttribute.attributePosition}:${oneAttribute.name}`;
						makeNode({
							role: DME_ROLES.PROPERTY,
							perStandardLabel: 'PescAttributeDecl',
							stableId: attributeStableId,
							name: oneAttribute.name,
							documentation: oneAttribute.documentation,
							searchTextElement: {
								role: DME_ROLES.PROPERTY,
								name: oneAttribute.name,
								owningClassName: containerName,
							},
							structural: {
								parentId: containerStableId,
								depth: depth + 1,
								path: `${containerPath}.@${oneAttribute.name}`,
							},
							scalar: {
								typeAsWritten: oneAttribute.typeAsWritten,
								use: oneAttribute.useAsWritten,
								attributePosition: oneAttribute.attributePosition,
							},
						});
						addEdge(EDGE_TYPES.HAS_PROPERTY, containerStableId, attributeStableId, {
							attributePosition: oneAttribute.attributePosition,
							declKind: 'attribute',
						});
						stats.attributeDecls++;
						if (oneAttribute.anonymousType) {
							emitAnonymousType({
								ownerStableId: attributeStableId,
								ownerName: `${containerName}.@${oneAttribute.name}`,
								ownerPath: `${containerPath}.@${oneAttribute.name}`,
								anonymousType: oneAttribute.anonymousType,
								depth: depth + 1,
							});
						}
					});

					content.derivations.forEach((oneDerivation, derivationIndex) => {
						// R-P2-4: node kind renamed PescRestriction -> PescDerivation (it carries
						// xs:extension too; a Restriction label holding extensions is a lie in a graph
						// built for comprehension). The stableId segment '/restriction/' is IDENTITY,
						// not vocabulary, and stays — renaming keys is not a mechanical fixup.
						const derivationStableId = `${containerStableId}/restriction/${derivationIndex + 1}`;
						// facet scalars land under the DESIGN's names (pattern, minLength, ...,
						// totalDigits, fractionDigits) — G-E's fidelity lives in these properties.
						const facetScalars = {};
						Object.keys(oneDerivation.facets).forEach((oneFacetName) => {
							facetScalars[oneFacetName] = oneDerivation.facets[oneFacetName];
						});
						makeNode({
							role: DME_ROLES.SUPPORT,
							perStandardLabel: 'PescDerivation',
							stableId: derivationStableId,
							name: `${containerName} ${oneDerivation.variety} of ${oneDerivation.baseAsWritten}`,
							documentation: oneDerivation.documentation,
							searchTextElement: {
								role: DME_ROLES.SUPPORT,
								name: `${oneDerivation.variety} of ${oneDerivation.baseAsWritten}`,
								owningName: containerName,
								standardName: STANDARD_SOURCE,
							},
							structural: {
								parentId: containerStableId,
								depth: depth + 1,
								path: `${containerPath}.${oneDerivation.variety}`,
							},
							scalar: {
								derivationVariety: oneDerivation.variety,
								contentStyle: oneDerivation.contentStyle,
								baseAsWritten: oneDerivation.baseAsWritten,
								enumerationValues: JSON.stringify(oneDerivation.enumerationValues),
								enumerationCount: oneDerivation.enumerationValues.length,
								...facetScalars,
							},
						});
						// edge type stays EDGE_TYPES.HAS_RESTRICTION: it is the SHARED vocabulary enum
						// (lib/vocabulary), out of this bundle's rename authority.
						addEdge(EDGE_TYPES.HAS_RESTRICTION, containerStableId, derivationStableId, {
							derivationPosition: derivationIndex + 1,
						});
						stats.derivations++;
						stats.enumerationValuesCarried += oneDerivation.enumerationValues.length;
					});
				};

				const emitAnonymousType = ({ ownerStableId, ownerName, ownerPath, anonymousType, depth }) => {
					// one inline type per owner (XSD's rule, parser-enforced), so position is 1.
					const anonStableId = `${ownerStableId}/anon/1`;
					makeNode({
						role: DME_ROLES.SUPPORT,
						perStandardLabel: 'PescAnonymousType',
						stableId: anonStableId,
						name: `${ownerName} (inline ${anonymousType.typeVariety})`,
						documentation: anonymousType.body.documentation,
						searchTextElement: {
							role: DME_ROLES.SUPPORT,
							name: `inline ${anonymousType.typeVariety}`,
							owningName: ownerName,
							standardName: STANDARD_SOURCE,
						},
						structural: {
							parentId: ownerStableId,
							depth: depth + 1,
							path: `${ownerPath}(anon)`,
						},
						scalar: {
							typeVariety: anonymousType.typeVariety,
							contentModelShape: anonymousType.body.contentModelShape
								? JSON.stringify(anonymousType.body.contentModelShape)
								: null,
						},
					});
					addEdge(EDGE_TYPES.HAS_SUPPORT, ownerStableId, anonStableId, { anonPosition: 1 });
					stats.anonymousTypes++;
					emitContainerContents({
						containerStableId: anonStableId,
						containerName: ownerName,
						containerPath: `${ownerPath}(anon)`,
						content: anonymousType.body,
						depth: depth + 1,
					});
				};

				// ---- named top-level definitions ----
				oneArtifact.definitions.forEach((oneDefinition) => {
					const definitionStableId =
						`${oneArtifact.targetNamespace}#${oneDefinition.kind}/${oneDefinition.name}` +
						collisionDiscriminator;

					// DME role (design §3.4): message roots (top-level elements) and named
					// complexTypes -> CLASS; enumeration-carrying simpleTypes -> OPTION_SET; other
					// simpleTypes and groups -> SUPPORT.
					const carriesEnumerations =
						oneDefinition.content &&
						oneDefinition.content.derivations.some(
							(oneDerivation) => oneDerivation.enumerationValues.length > 0,
						);
					const roleByKind = {
						complexType: DME_ROLES.CLASS,
						element: DME_ROLES.CLASS,
						group: DME_ROLES.SUPPORT,
						simpleType: carriesEnumerations ? DME_ROLES.OPTION_SET : DME_ROLES.SUPPORT,
					};
					const definitionRole = roleByKind[oneDefinition.kind];
					const definitionPath = `${owningName} ${oneDefinition.name}`;

					const searchTextElement =
						definitionRole === DME_ROLES.CLASS
							? {
									role: definitionRole,
									name: oneDefinition.name,
									standardName: STANDARD_SOURCE,
									owningName,
								}
							: definitionRole === DME_ROLES.OPTION_SET
								? {
										role: definitionRole,
										name: oneDefinition.name,
										owningClassName: owningName,
									}
								: {
										role: definitionRole,
										name: oneDefinition.name,
										owningName,
										standardName: STANDARD_SOURCE,
									};

					makeNode({
						role: definitionRole,
						perStandardLabel: 'PescNamedDefinition',
						stableId: definitionStableId,
						name: oneDefinition.name,
						documentation: oneDefinition.documentation,
						searchTextElement,
						structural: {
							parentId: artifactStableId,
							depth: 2,
							path: definitionPath,
						},
						scalar: {
							kind: oneDefinition.kind,
							documentPosition: oneDefinition.documentPosition,
							typeAsWritten: oneDefinition.typeAsWritten,
							substitutionGroupAsWritten: oneDefinition.substitutionGroupAsWritten,
							abstract: oneDefinition.abstractAsWritten,
							nillable: oneDefinition.nillableAsWritten,
							declaringArtifactSha256: oneArtifact.sha256,
							declaringFilename: oneArtifact.filename,
							contentModelShape:
								oneDefinition.content && oneDefinition.content.contentModelShape
									? JSON.stringify(oneDefinition.content.contentModelShape)
									: null,
						},
					});
					addEdge('DECLARES', artifactStableId, definitionStableId, {
						documentPosition: oneDefinition.documentPosition,
					});
					stats.namedDefinitions++;

					if (oneDefinition.content) {
						emitContainerContents({
							containerStableId: definitionStableId,
							containerName: oneDefinition.name,
							containerPath: definitionPath,
							content: oneDefinition.content,
							depth: 2,
						});
					}
					if (oneDefinition.anonymousType) {
						emitAnonymousType({
							ownerStableId: definitionStableId,
							ownerName: oneDefinition.name,
							ownerPath: definitionPath,
							anonymousType: oneDefinition.anonymousType,
							depth: 2,
						});
					}
				});
			});

			return { nodes, edges, stats };
		};

		// =====================================================================
		// embedNodes — batched embedding pass (mirrors forge-sif). Only reached when
		// skipEmbedding is false; refuses by name if no embedder was injected.
		// =====================================================================
		const embedNodes = ({ nodes, nodeSubsetLimit }, callback) => {
			if (!embedder) {
				callback(
					'forge-pesc260805: embedding requested (skipEmbedding false) but no embedder was ' +
						'injected. Pass an embedder or say skipEmbedding:true — silence is not consent to spend.',
				);
				return;
			}
			const targetNodes =
				nodeSubsetLimit && nodeSubsetLimit < nodes.length ? nodes.slice(0, nodeSubsetLimit) : nodes;
			const batches = [];
			for (let batchStart = 0; batchStart < targetNodes.length; batchStart += EMBED_BATCH_SIZE) {
				batches.push(targetNodes.slice(batchStart, batchStart + EMBED_BATCH_SIZE));
			}
			let embedCallCount = 0;
			let batchIndex = 0;
			const nextBatch = () => {
				if (batchIndex >= batches.length) {
					callback('', { embedCallCount, embeddedCount: targetNodes.length });
					return;
				}
				const oneBatch = batches[batchIndex];
				batchIndex++;
				embedder.embedTexts(
					{ texts: oneBatch.map((oneNode) => oneNode.properties.searchText) },
					(err, result) => {
						if (err) {
							callback(`forge-pesc260805 embedNodes batch ${batchIndex} failed: ${err}`);
							return;
						}
						embedCallCount++;
						oneBatch.forEach((oneNode, oneIndex) => {
							oneNode.properties.embedding = Array.from(result.vectors[oneIndex]);
							oneNode.embedding = oneNode.properties.embedding;
							oneNode.embeddingModelVersion = result.embeddingModelVersion;
							oneNode.properties.embeddingModelVersion = result.embeddingModelVersion;
						});
						nextBatch();
					},
				);
			};
			nextBatch();
		};

		// =====================================================================
		// forge — parse -> buildSourceTierGraph -> (optional) embed. The bundle contract
		// (forger.js): returns { nodes, edges, metadata, stats, embedCallCount, standardKey,
		// stableUriPropertyName }; metadata.version non-blank is enforced upstream.
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				if (!sourcePath) {
					next('forge-pesc260805: sourcePath is required (the snapshot DIRECTORY; no default)');
					return;
				}
				parsePescCorpus({ sourcePath }, (err, parsed) => {
					if (err) {
						next(`forge-pesc260805 parse: ${err}`);
						return;
					}
					next('', { ...args, parsed });
				});
			});

			// the ONE sanctioned try/catch boundary: the pure builders (source tier, then the
			// Phase 3 derived tier — both throw on refusals and builder bugs) are translated here
			// to the error channel. Source, derived, and meta emit in this one pass: the derived
			// tier is computed from the source tier just built (never from re-parsing), which is
			// the same input the Gate 3 regeneration uses — one input, one code path.
			taskList.push((args, next) => {
				let graph;
				let buildError = '';
				try {
					const sourceGraph = buildSourceTierGraph(args.parsed);
					const derivedOutput = buildDerivedTier({
						nodes: sourceGraph.nodes,
						edges: sourceGraph.edges,
					});
					const combinedGraph = applyDerivedTier({
						nodes: sourceGraph.nodes,
						edges: sourceGraph.edges,
						derivedOutput,
					});
					// SYNTHETIC (Phase 4) reads the combined source+derived+meta graph and ADDS ONLY —
					// it annotates nothing and mutates nothing, so the derived tier it was handed is the
					// derived tier that ships, and Gate 3's regeneration proof is untouched by construction.
					const syntheticOutput = buildSyntheticTier({
						nodes: combinedGraph.nodes,
						edges: combinedGraph.edges,
					});
					graph = {
						nodes: combinedGraph.nodes.concat(syntheticOutput.nodes),
						edges: combinedGraph.edges.concat(syntheticOutput.edges),
						stats: {
							...sourceGraph.stats,
							derived: derivedOutput.stats,
							synthetic: syntheticOutput.stats,
						},
						syntheticMergeReport: syntheticOutput.mergeReport,
					};
				} catch (thrownError) {
					buildError = thrownError.message;
				}
				if (buildError) {
					next(`forge-pesc260805 graph build: ${buildError}`);
					return;
				}
				xLog.status(
					`[forge-pesc260805] source tier: ` +
						`(${graph.stats.artifacts} artifacts, ${graph.stats.namedDefinitions} named definitions, ` +
						`${graph.stats.elementDecls} element decls, ${graph.stats.anonymousTypes} anonymous types, ` +
						`${graph.stats.derivations} derivations (restrictions/extensions), ${graph.stats.attributeDecls} attributes; ` +
						`contested namespaces: ${graph.stats.contestedNamespaces.join(', ') || 'none'})`,
				);
				xLog.status(
					`[forge-pesc260805] derived tier: ${graph.stats.derived.namespaces} namespaces ` +
						`(${graph.stats.derived.isLatestNamespaces} latest), ${graph.stats.derived.inNamespaceEdges} IN_NAMESPACE, ` +
						`${graph.stats.derived.importsEdges} IMPORTS (+${graph.stats.derived.unresolvedImportsRecorded} unresolved recorded), ` +
						`${graph.stats.derived.resolvesToEdges} RESOLVES_TO (+${graph.stats.derived.builtinReferenceMarkers} builtin markers, ` +
						`+${graph.stats.derived.ambiguousPendingSynthesisRecorded} ambiguous recorded, ` +
						`+${graph.stats.derived.unresolvedNamespaceReferencesRecorded} absent-namespace recorded), ` +
						`${graph.stats.derived.sameDefinitionEdges} SAME_DEFINITION chain edges, ` +
						`${graph.stats.derived.reachableFromLatestRoot}/${graph.stats.derived.definitionsTotal} reachable from latest roots)`,
				);
				xLog.status(
					`[forge-pesc260805] synthetic tier: S-1 merged ${graph.stats.synthetic.mergedDefinitions} definitions ` +
						`(${graph.stats.synthetic.collegeTranscriptOnlyDefinitions} college-only + ` +
						`${graph.stats.synthetic.testScoreOnlyDefinitions} test-score-only + ` +
						`${graph.stats.synthetic.sharedDefinitions} shared, of which ` +
						`${graph.stats.synthetic.conflictingSharedDefinitions} conflict and ` +
						`${graph.stats.synthetic.absentChildElements} child elements are genuinely ABSENT, ` +
						`${graph.stats.synthetic.reboundChildElements} REBOUND, ` +
						`${graph.stats.synthetic.widenedChildElements} WIDENED, and ` +
						`${graph.stats.synthetic.addedChildElements} ADDED by the winning member), ` +
						`${graph.stats.synthetic.mergedFromEdges} MERGED_FROM, ` +
						`${graph.stats.synthetic.heldReferencesResolved} held references resolved; ` +
						`S-2 alias ${graph.stats.synthetic.aliasNamespace} served by ${graph.stats.synthetic.aliasServingNamespace} ` +
						`(${graph.stats.synthetic.aliasReferencesResolved} references over ` +
						`${graph.stats.synthetic.aliasDistinctLocalNames} distinct names, ` +
						`${graph.stats.synthetic.aliasImportsResolved} import); ` +
						`total ${graph.nodes.length} nodes, ${graph.edges.length} edges`,
				);
				next('', { ...args, graph });
			});

			taskList.push((args, next) => {
				if (skipEmbedding) {
					next('', { ...args, embedCallCount: 0 });
					return;
				}
				embedNodes({ nodes: args.graph.nodes, nodeSubsetLimit: embedNodeLimit }, (err, result) => {
					if (err) {
						next(err);
						return;
					}
					next('', { ...args, embedCallCount: result.embedCallCount });
				});
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					nodes: args.graph.nodes,
					edges: args.graph.edges,
					metadata: {
						// the version is OURS (R-ACQ-7): PESC publishes no whole-family release, so
						// the aggregate token is stamped as the bundle's honest version claim.
						version: AGGREGATE_VERSION,
						snapshotKey: path.basename(sourcePath),
						publishedVersion: AGGREGATE_VERSION,
						versionSource: 'aggregate-manifest',
						sourceFormat: 'pesc-xsd-directory',
						sourceFiles: args.parsed.artifacts.map((oneArtifact) => oneArtifact.filename),
						sourceUrl: '',
					},
					stats: args.graph.stats,
					// the S-1 merge report rides out with the graph: the 8 lost child elements, the
					// conflict table, and the branch identification are the DEFENCE of a judgment, and a
					// judgment whose defence is only in a log has not really been recorded.
					syntheticMergeReport: args.graph.syntheticMergeReport,
					embedCallCount: args.embedCallCount,
					standardKey: STANDARD_KEY,
					stableUriPropertyName: STABLE_URI_PROPERTY_NAME,
				});
			});
		};

		return {
			forge,
			buildSourceTierGraph, // exported for the pure-layer gates (determinism, identity)
			STANDARD_KEY,
			STANDARD_SOURCE,
			STABLE_URI_PROPERTY_NAME,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
