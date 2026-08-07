'use strict';

// roundTripSourceEmitter.js (forge-pesc260805) — THE RE-EMITTER, SCOPED TO THE SOURCE-TIER
// PROJECTION. Reads the materialized pesc260805 graph over bolt and writes XSD-shaped documents
// back out, one per corpus artifact, so the emission can be diffed against the snapshot it came
// from.
//
// WHY IT READS THE GRAPH AND NOT THE FORGE'S OUTPUT (RT-4). Compiling from the forge's own result
// would prove only that the forge remembers what it just read. Compiling from the GRAPH proves what
// the GRAPH ITSELF can support — which is the question, and the only reading that also audits the
// loader.
//
// R-VAL-1, AND IT IS ONE PREDICATE. Round-trip is defined over the SOURCE-tier projection: a graph
// richer than its source is not a failure so long as the surplus is marked and the emitter reads
// only the marked subset. The mark is `pescTier` (DESIGN §2) and the read rule is
// `pescTier = 'source'`. THE 632 SYNTHETIC NODES AND 63 DERIVED NODES ARE NOT SOURCE AND ARE NOT
// EMITTED. Emitting one synthetic child would manufacture an INVENTED statement against a corpus
// file that never declared it — the failure mode the verdict treats as fatal.
//
// THE TIER CHECK IN `readAll` IS A genuineGap, NOT A PROVEN GATE — corrected at remediation, and
// the correction matters more than the check. It was shipped described as "asserted, not assumed".
// It is not. The Cypher WHERE clause already selects `pescTier = 'source'`, so the check re-tests
// the predicate that chose its own input and CANNOT BE REDDENED BY ANY MUTATION OF THE DATA. That
// is exactly the pure-function trap DESIGN §8h names: a check comparing a selection against the
// criterion that made it is a theorem wearing an assertion's clothes.
//
// It is deliberately NOT rewritten into something provable. It is retained because it is a real
// guard against a FUTURE change to the query, and it is LABELLED genuineGap so no one reads it as
// evidence. A gate honestly marked unproven is worth more than one argued into looking proven.
//
// CONTAINMENT IS THE `parentId` PROPERTY, NOT THE EDGE SET. This cost the campaign a real defect
// (DEVLOG trap 1): a PescDerivation child is parented but carries NO HAS_PROPERTY edge, and two
// independent censuses agreed on a wrong answer because both used the edge basis. Whole graph:
// 41,849 containment children against 17,053 HAS_PROPERTY edges. This emitter walks parentId.
//
// GRAMMAR YES, DATA NO (RT-5). This module knows the XSD OUTPUT GRAMMAR — the xs: element
// vocabulary, the xmlns:xs declaration, the sequence wrapper, the annotation/documentation nesting.
// It contains NO source value and never opens a source file. The snapshot bytes enter exactly once,
// at the diff, as the answer key. A statement the graph does not hold is NOT invented to flatter
// the comparison; it shows up as unreproduced, which is the deliverable.
//
// House style: qtools taskListPlus/pipeRunner, error-first callbacks, no async/await, no try/catch
// for control flow. The neo4j driver's Promises are resolved back into the err-string convention at
// the single leaf that owns them (the blessed dispensation, apps/graph-builder/DOCTRINE.md).

const path = require('path');
const { execFile } = require('child_process');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const STANDARD_SOURCE = 'PESC260805';
const SOURCE_TIER = 'source';
// PHASE 6.5: was XSD_NAMESPACE_DECLARATION, a hard-coded `xmlns:xs="…"` that WAS THE ONLY
// namespace the emission declared. The declaration text is now built from the artifact's own
// prefixBindings; what survives here is the URI, because this module writes xs:-prefixed grammar
// unconditionally and therefore asserts that binding rather than assuming it.
const XSD_NAMESPACE_URI = 'http://www.w3.org/2001/XMLSchema';
const DEFAULT_PAGE_SIZE = 4000;

// Every property the emitter reads, named once. A property absent from this list is a property the
// emission cannot carry, and that is a decision recorded here rather than an accident discovered in
// a diff.
const NODE_PROPERTY_NAMES = [
	'stableId',
	'parentId',
	'pescTier',
	'name',
	'kind',
	'documentation',
	'documentPosition',
	'sequencePosition',
	'attributePosition',
	'typeAsWritten',
	'minOccurs',
	'maxOccurs',
	'nillable',
	'use',
	'baseAsWritten',
	'derivationVariety',
	'contentStyle',
	'typeVariety',
	'enumerationValues',
	'enumerationCount',
	'pattern',
	'minLength',
	'maxLength',
	'minInclusive',
	'maxInclusive',
	'totalDigits',
	'fractionDigits',
	'whiteSpace',
	// ADDED AT REMEDIATION (review item 4). The graph carries `length` on exactly 33 nodes and
	// `fixedAsWritten` on exactly 2 — precisely the 33 facet:length and 2 elementFixed statements
	// the first verdict reported as chain loss. A property absent from this list is a property the
	// emission cannot carry, so its absence here WAS the loss.
	'length',
	'fixedAsWritten',
	// minExclusive/maxExclusive are ZERO in this corpus (measured, not assumed) and would
	// otherwise become silent loss the first time PESC publishes one.
	'minExclusive',
	'maxExclusive',
	'namespaceAsWritten',
	'schemaLocationAsWritten',
	// ADDED AT PHASE 6.5. The two properties Phase 6's independent instrument proved the emission
	// could not do without. `contentModelShape` carries the compositor kind and the ORDERED particle
	// list (3,079 nodes); `prefixBindings` carries the artifact's full xmlns map (64 nodes). Both
	// were present and correct in the graph and read ZERO times here, which is why 62 of 64 emitted
	// documents placed element particles as direct children of xs:complexType and the 63rd
	// referenced a prefix it never declared.
	'contentModelShape',
	'prefixBindings',
	'filename',
	'targetNamespace',
	'elementFormDefault',
	'attributeFormDefault',
	'schemaVersionAttribute',
	'sha256',
];

// The labels the emitter renders. `PescNamespace` is DERIVED and deliberately absent.
const EMITTED_LABEL_LIST = [
	'PescArtifact',
	'PescImportDecl',
	'PescNamedDefinition',
	'PescElementDecl',
	'PescAnonymousType',
	'PescDerivation',
	'PescAttributeDecl',
];

// Facet property -> xs: element name. A registry rather than a switch, so adding a facet is a row.
const FACET_ELEMENT_NAME_BY_PROPERTY = [
	{ propertyName: 'pattern', elementName: 'xs:pattern' },
	{ propertyName: 'minLength', elementName: 'xs:minLength' },
	{ propertyName: 'maxLength', elementName: 'xs:maxLength' },
	{ propertyName: 'minInclusive', elementName: 'xs:minInclusive' },
	{ propertyName: 'maxInclusive', elementName: 'xs:maxInclusive' },
	{ propertyName: 'totalDigits', elementName: 'xs:totalDigits' },
	{ propertyName: 'fractionDigits', elementName: 'xs:fractionDigits' },
	{ propertyName: 'whiteSpace', elementName: 'xs:whiteSpace' },
	// ADDED AT REMEDIATION (review item 4).
	{ propertyName: 'length', elementName: 'xs:length' },
	{ propertyName: 'minExclusive', elementName: 'xs:minExclusive' },
	{ propertyName: 'maxExclusive', elementName: 'xs:maxExclusive' },
];

// typeVariety / contentStyle -> emitted grammar. REGISTRIES WITH REFUSAL, not comparisons with a
// silent alternative. The first emitter wrote `typeVariety === 'simple' ? simpleType : complexType`;
// the graph writes 'simpleType', so the test was NEVER TRUE and all 530 inline simpleTypes emitted
// as xs:complexType — a wrong answer produced silently by the else-branch. That is the defect class
// TQ names as his longest-standing complaint, and the cure is that an unrecognised value is refused
// BY NAME rather than quietly taking a default.
const ANONYMOUS_TYPE_ELEMENT_NAME_BY_VARIETY = {
	simpleType: 'xs:simpleType',
	complexType: 'xs:complexType',
};

// contentStyle 'simpleType' means the derivation sits DIRECTLY inside a simpleType with no wrapper;
// the other two name the wrapper element XSD requires around a complexType's derivation.
const DERIVATION_WRAPPER_ELEMENT_NAME_BY_CONTENT_STYLE = {
	simpleType: null,
	complexContent: 'xs:complexContent',
	simpleContent: 'xs:simpleContent',
};

// ADDED AT PHASE 6.5 — the compositor vocabulary, as a registry with refusal.
//
// ONLY sequence AND choice ARE REGISTERED, DELIBERATELY. lib/parser.js accepts exactly these two
// (its walkContainer and walkCompositor refuse every other particle container BY NAME), so the graph
// cannot hold an `all` and registering one here would advertise a capability no data can exercise.
// Measured on the canonical graph 2026-08-07: 3,030 shapes carry a sequence, 201 carry a choice,
// ZERO carry an all. An unregistered kind is refused BY NAME rather than rendered as a sequence,
// because rendering an unknown compositor as the common one is precisely the silent substitution
// that turned 530 inline simpleTypes into complexTypes in the predecessor.
const COMPOSITOR_ELEMENT_NAME_BY_KIND = {
	sequence: 'xs:sequence',
	choice: 'xs:choice',
};

// The particle vocabulary of contentModelShape, as a registry keyed on the DISCRIMINATOR PROPERTY
// each particle variety carries. A particle must carry EXACTLY ONE of these; zero or several is a
// malformed shape and is refused by name rather than resolved by precedence.
const PARTICLE_DISCRIMINATOR_PROPERTY_NAME_LIST = ['element', 'compositor', 'groupRef', 'any'];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// escapeXmlText / escapeXmlAttributeValue — grammar, not data. The canonicalizer decodes
		// character references on BOTH sides (XML 1.0 §4.1), so an escaped spelling here and a raw
		// spelling in the source are the same datum and cannot register as a difference.
		const escapeXmlText = (rawText) =>
			String(rawText)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');

		const escapeXmlAttributeValue = (rawValue) =>
			escapeXmlText(rawValue).replace(/"/g, '&quot;');

		// -----
		// requiredProperty — an absent property THROWS by name. No `|| 0`, no plausible default.
		// TQ's longest-standing complaint about this system is silent defaulting, and two instances
		// reached production in the phase before this one.
		const requiredProperty = (oneNode, propertyName, contextLabel) => {
			const value = oneNode.properties[propertyName];
			if (value === undefined || value === null) {
				throw new Error(
					`${moduleName}: node '${oneNode.properties.stableId}' (${contextLabel}) has no ` +
						`'${propertyName}'. A required property that is absent is refused BY NAME — it is ` +
						`never read as an empty string, a zero, or a default.`,
				);
			}
			return value;
		};

		// -----
		// optionalProperty — ABSENT-AS-NULL, the fact Phase 4.5 could only learn by loading. Neo4j
		// has no null property, so a deliberately-null value is simply MISSING from the node. An
		// emitter that treated absence as an error would refuse on 2,039 legitimate nulls; one that
		// treated it as a value would invent. Absence means "the source did not say", full stop, and
		// the caller must ask for it deliberately through this function.
		const optionalProperty = (oneNode, propertyName) => {
			const value = oneNode.properties[propertyName];
			return value === undefined ? null : value;
		};

		const attributeIfPresent = (attributeName, value) =>
			value === null || value === undefined || String(value) === ''
				? ''
				: ` ${attributeName}="${escapeXmlAttributeValue(value)}"`;

		// =====================================================================
		// resolveContainerBolt — endpoint + credential from the RUNNING CONTAINER. Never from a
		// document: ports are minted per build, and the campaign has a live example of a document
		// naming a port that now belongs to a DIFFERENT graph, where a validator would have read a
		// pre-4.6a store and reported 522 legitimate children as missing.
		// =====================================================================

		const resolveContainerBolt = ({ containerName } = {}, callback) => {
			if (typeof containerName !== 'string' || containerName.trim() === '') {
				callback(
					`${moduleName}.resolveContainerBolt: containerName is REQUIRED and has no default.`,
				);
				return;
			}
			const portFormat =
				'{{range $onePort, $oneBinding := .NetworkSettings.Ports}}' +
				'{{if eq $onePort "7687/tcp"}}{{(index $oneBinding 0).HostPort}}{{end}}{{end}}';
			execFile(
				'docker',
				['inspect', containerName, '--format', portFormat],
				(portError, portStdout) => {
					if (portError) {
						callback(
							`${moduleName}.resolveContainerBolt: docker inspect failed for container ` +
								`'${containerName}': ${portError.message}. The container must be RUNNING; ` +
								`no endpoint is guessed at.`,
						);
						return;
					}
					const hostPort = String(portStdout).trim();
					if (!/^\d+$/.test(hostPort)) {
						callback(
							`${moduleName}.resolveContainerBolt: container '${containerName}' published no ` +
								`7687/tcp host port (got '${hostPort}'). Refused by name.`,
						);
						return;
					}
					execFile(
						'docker',
						['inspect', containerName, '--format', '{{range .Config.Env}}{{println .}}{{end}}'],
						(envError, envStdout) => {
							if (envError) {
								callback(
									`${moduleName}.resolveContainerBolt: docker inspect env failed for ` +
										`'${containerName}': ${envError.message}.`,
								);
								return;
							}
							const authLine = String(envStdout)
								.split('\n')
								.map((oneLine) => oneLine.trim())
								.find((oneLine) => oneLine.startsWith('NEO4J_AUTH='));
							if (!authLine) {
								callback(
									`${moduleName}.resolveContainerBolt: container '${containerName}' declares no ` +
										`NEO4J_AUTH. Refused by name rather than attempting a default credential.`,
								);
								return;
							}
							const authValue = authLine.slice('NEO4J_AUTH='.length);
							const separatorAt = authValue.indexOf('/');
							if (separatorAt === -1) {
								callback(
									`${moduleName}.resolveContainerBolt: NEO4J_AUTH on '${containerName}' is not ` +
										`user/password shaped. Refused by name.`,
								);
								return;
							}
							callback('', {
								containerName,
								boltUrl: `bolt://localhost:${hostPort}`,
								user: authValue.slice(0, separatorAt),
								password: authValue.slice(separatorAt + 1),
							});
						},
					);
				},
			);
		};

		// =====================================================================
		// makeNeo4jSourceTierReader — the ONLY graph I/O in this module.
		// =====================================================================

		const makeNeo4jSourceTierReader = ({ boltUrl, user, password, pageSize } = {}) => {
			const effectivePageSize = pageSize || DEFAULT_PAGE_SIZE;
			const neo4j = require('neo4j-driver');
			let driver = null;

			const ensureDriver = () => {
				if (!driver) {
					driver = neo4j.driver(boltUrl, neo4j.auth.basic(user, password));
				}
				return driver;
			};

			const runRead = (cypher, parameters, callback) => {
				const session = ensureDriver().session();
				session
					.run(cypher, parameters || {})
					.then((runResult) => {
						session.close().catch(() => {});
						callback('', { records: runResult.records });
					})
					.catch((runError) => {
						session.close().catch(() => {});
						callback(`${moduleName}.runRead: ${runError.message}\ncypher: ${cypher}`);
					});
			};

			const readLabelPaged = ({ label }, callback) => {
				const projection = NODE_PROPERTY_NAMES.map(
					(onePropertyName) => `oneNode.\`${onePropertyName}\` AS \`${onePropertyName}\``,
				).join(', ');
				const cypher =
					`MATCH (oneNode:\`${label}\`) WHERE oneNode.\`_source\` = '${STANDARD_SOURCE}' ` +
					`AND oneNode.pescTier = '${SOURCE_TIER}' RETURN ${projection} ` +
					'ORDER BY oneNode.`stableId` SKIP $skip LIMIT $limit';
				const collectedNodeList = [];
				const readNextPage = (skipCount) => {
					// SKIP/LIMIT must travel as neo4j integers — a JS number arrives as a float and
					// the server refuses '4000.0' by name.
					runRead(
						cypher,
						{ skip: neo4j.int(skipCount), limit: neo4j.int(effectivePageSize) },
						(readError, result) => {
							if (readError) {
								callback(readError);
								return;
							}
							result.records.forEach((oneRecord) => {
								const properties = {};
								NODE_PROPERTY_NAMES.forEach((onePropertyName) => {
									const rawValue = oneRecord.get(onePropertyName);
									if (rawValue === null || rawValue === undefined) {
										return; // ABSENT stays ABSENT — see optionalProperty
									}
									properties[onePropertyName] =
										neo4j.isInt && neo4j.isInt(rawValue) ? rawValue.toNumber() : rawValue;
								});
								collectedNodeList.push({ label, properties });
							});
							if (result.records.length < effectivePageSize) {
								callback('', collectedNodeList);
								return;
							}
							readNextPage(skipCount + effectivePageSize);
						},
					);
				};
				readNextPage(0);
			};

			const readAll = (unusedArgs, callback) => {
				const nodeListByLabel = {};
				let labelIndex = 0;
				const readNextLabel = () => {
					if (labelIndex >= EMITTED_LABEL_LIST.length) {
						// genuineGap — NOT a proven gate. The WHERE clause above already filters on
					// pescTier='source', so this re-tests its own selection criterion and no data
					// mutation can redden it. Kept as a guard against a future edit to the query;
					// labelled honestly so it is never counted as evidence. See the header note.
						const wrongTierNodeList = [];
						Object.keys(nodeListByLabel).forEach((oneLabel) => {
							nodeListByLabel[oneLabel].forEach((oneNode) => {
								if (oneNode.properties.pescTier !== SOURCE_TIER) {
									wrongTierNodeList.push(
										`${oneLabel} ${oneNode.properties.stableId} tier=${oneNode.properties.pescTier}`,
									);
								}
							});
						});
						if (wrongTierNodeList.length) {
							callback(
								`${moduleName}.readAll: ${wrongTierNodeList.length} node(s) reached the ` +
									`SOURCE-TIER projection carrying a different pescTier. R-VAL-1 scoping has ` +
									`failed and emitting them would manufacture INVENTED statements. Refused by ` +
									`name:\n  ${wrongTierNodeList.slice(0, 20).join('\n  ')}`,
							);
							return;
						}
						if (!(nodeListByLabel.PescArtifact || []).length) {
							callback(
								`${moduleName}.readAll: the graph returned ZERO PescArtifact nodes at the ` +
									`source tier. An emission over no artifacts would diff as total loss and look ` +
									`like a catastrophic regression rather than a bad read. Refused by name — ` +
									`verify the bolt port was resolved from the CONTAINER.`,
							);
							return;
						}
						callback('', nodeListByLabel);
						return;
					}
					const oneLabel = EMITTED_LABEL_LIST[labelIndex];
					labelIndex += 1;
					readLabelPaged({ label: oneLabel }, (readError, nodeList) => {
						if (readError) {
							callback(readError);
							return;
						}
						nodeListByLabel[oneLabel] = nodeList;
						readNextLabel();
					});
				};
				readNextLabel();
			};

			const close = (callback) => {
				if (!driver) {
					callback('');
					return;
				}
				driver
					.close()
					.then(() => callback(''))
					.catch((closeError) => callback(`${moduleName}.close: ${closeError.message}`));
			};

			return { readAll, close };
		};

		// =====================================================================
		// THE SERIALIZER — graph rows to XSD text. Pure; no I/O, no graph, no source file.
		// =====================================================================

		const serializeSourceProjection = ({ nodeListByLabel } = {}) => {
			if (!nodeListByLabel || typeof nodeListByLabel !== 'object') {
				throw new Error(
					`${moduleName}.serializeSourceProjection: nodeListByLabel is REQUIRED and has no default.`,
				);
			}

			const childNodeListByParentId = new Map();
			const allNodeList = [];
			EMITTED_LABEL_LIST.forEach((oneLabel) => {
				(nodeListByLabel[oneLabel] || []).forEach((oneNode) => {
					allNodeList.push(oneNode);
					const parentId = oneNode.properties.parentId;
					if (parentId === undefined || parentId === null) {
						return;
					}
					if (!childNodeListByParentId.has(parentId)) {
						childNodeListByParentId.set(parentId, []);
					}
					childNodeListByParentId.get(parentId).push(oneNode);
				});
			});

			// Deterministic child order. documentPosition orders declarations within a file;
			// sequencePosition orders element children; attributePosition orders attributes. A node
			// carrying none of the three sorts by stableId so the emission is stable rather than
			// dependent on read order.
			const orderingValueOf = (oneNode) => {
				const properties = oneNode.properties;
				if (properties.sequencePosition !== undefined) {
					return Number(properties.sequencePosition);
				}
				if (properties.attributePosition !== undefined) {
					return Number(properties.attributePosition) + 1000000;
				}
				if (properties.documentPosition !== undefined) {
					return Number(properties.documentPosition);
				}
				return Number.MAX_SAFE_INTEGER;
			};

			const orderedChildrenOf = (parentStableId) =>
				(childNodeListByParentId.get(parentStableId) || [])
					.slice()
					.sort(
						(leftNode, rightNode) =>
							orderingValueOf(leftNode) - orderingValueOf(rightNode) ||
							String(leftNode.properties.stableId).localeCompare(
								String(rightNode.properties.stableId),
							),
					);

			const documentationLines = (oneNode, indent) => {
				const documentationText = optionalProperty(oneNode, 'documentation');
				if (documentationText === null || String(documentationText) === '') {
					return [];
				}
				return [
					`${indent}<xs:annotation>`,
					`${indent}\t<xs:documentation>${escapeXmlText(documentationText)}</xs:documentation>`,
					`${indent}</xs:annotation>`,
				];
			};

			// ---- the renderer registry: one entry per emitted label, no switch statement ----
			//
			// FORMAL INTERFACE — NodeRenderer (declared because Phase 6.5 makes this seam
			// polymorphic in a second argument, and an undeclared polymorphic seam is a polyArch2
			// violation):
			//
			//   @typedef  {function} NodeRenderer
			//   @param    {object}   oneNode        the graph row, {label, properties}
			//   @param    {string}   indent         the leading tab run for this node's own line
			//   @param    {object}   [renderContext]
			//   @param    {function} [renderContext.renderInjectedDerivationBody]
			//              (indent: string) => string[] — supplied ONLY by a container whose
			//              content-model compositor and attribute declarations must be emitted
			//              INSIDE this node rather than beside it. The receiver chooses the indent
			//              because only it knows how deeply its own wrappers nest. A renderer that
			//              is handed this and ignores it would silently drop the whole content
			//              model, so the one renderer that can receive it (PescDerivation) refuses
			//              BY NAME if it is handed one it cannot place.
			//   @returns  {string[]} the emitted lines
			const renderNode = (oneNode, indent, renderContext) => {
				const renderer = RENDERER_BY_LABEL[oneNode.label];
				if (!renderer) {
					throw new Error(
						`${moduleName}: no renderer is declared for label '${oneNode.label}' ` +
							`(node ${oneNode.properties.stableId}). An unrenderable node is refused BY NAME ` +
							`rather than skipped — a silently dropped node emits as loss and looks like a ` +
							`forge defect.`,
					);
				}
				return renderer(oneNode, indent, renderContext);
			};

			const renderChildren = (oneNode, indent) =>
				orderedChildrenOf(oneNode.properties.stableId).reduce(
					(lineList, oneChild) => lineList.concat(renderNode(oneChild, indent)),
					[],
				);

			// =====================================================================
			// THE CONTENT MODEL — PHASE 6.5 (deliverable 1)
			//
			// WHAT WAS WRONG. Element particles were emitted as DIRECT CHILDREN of xs:complexType,
			// which is not valid XSD. Phase 6's independent instrument (python xmlschema, XSD 1.1)
			// compiled 1 of 64 emitted documents against 55 of 64 source documents, and 62 of the
			// 63 refusals were exactly this. The information to fix it was in the graph the whole
			// time: `contentModelShape` on 3,079 nodes, read ZERO times by this file.
			//
			// WHY THE OBVIOUS FIX IS STILL INVALID, MEASURED BEFORE IT WAS WRITTEN. Wrapping the
			// flat child run in an xs:sequence at the TYPE level repairs 2,517 types and leaves 478
			// broken, because those 478 carry a complexContent/extension derivation AND 2,105
			// element declarations parented to the TYPE rather than to the derivation (the forge
			// parser attributes members to the container). In the source those elements sit INSIDE
			// the extension; a type carrying both an xs:sequence and an xs:complexContent is
			// refused by any conforming processor. The compositor therefore goes inside the
			// derivation when one is present. Enumerating the easy case and calling it done is the
			// move that produced the gap being repaired here.
			//
			// THE SHAPE INDEXES, IT DOES NOT DUPLICATE. A leaf particle is {element: N} where N is
			// the child's sequencePosition; a nested compositor recurses. Rendering therefore
			// RESOLVES each particle against the child rows, and a shape that names a position with
			// no child — or names one twice, or leaves one unnamed — is a coherence fault refused
			// BY NAME. That refusal is what makes this a read rather than a guess: a renderer that
			// inferred a plausible sequence from the order children happen to arrive in would have
			// nothing to be incoherent with.
			// =====================================================================

			// discriminatorPropertyNameOfParticle — which of the four particle varieties this is.
			// EXACTLY ONE discriminator is required. Zero means an untaught particle shape; several
			// means an ambiguous one. Both are refused by name rather than settled by precedence,
			// because a precedence rule here would silently pick a reading of data nobody checked.
			const discriminatorPropertyNameOfParticle = (oneParticle, ownerNode, particlePath) => {
				if (!oneParticle || typeof oneParticle !== 'object') {
					throw new Error(
						`${moduleName}: contentModelShape on '${ownerNode.properties.stableId}' carries a ` +
							`non-object particle at ${particlePath}. Refused BY NAME.`,
					);
				}
				const presentDiscriminatorList = PARTICLE_DISCRIMINATOR_PROPERTY_NAME_LIST.filter(
					(oneDiscriminatorPropertyName) =>
						Object.prototype.hasOwnProperty.call(oneParticle, oneDiscriminatorPropertyName),
				);
				if (presentDiscriminatorList.length !== 1) {
					throw new Error(
						`${moduleName}: contentModelShape on '${ownerNode.properties.stableId}' carries a ` +
							`particle at ${particlePath} with ${presentDiscriminatorList.length} discriminator ` +
							`properties (${presentDiscriminatorList.join(', ') || 'none'}). Exactly one of ` +
							`${PARTICLE_DISCRIMINATOR_PROPERTY_NAME_LIST.join(', ')} is REQUIRED. Refused BY ` +
							`NAME rather than resolved by precedence.`,
					);
				}
				return presentDiscriminatorList[0];
			};

			// renderElementParticle — resolve {element: sequencePosition} against the container's
			// own element children and render that child in place.
			const renderElementParticle = ({ oneParticle, indent, walkState, particlePath }) => {
				const sequencePosition = Number(oneParticle.element);
				if (!Number.isFinite(sequencePosition)) {
					throw new Error(
						`${moduleName}: contentModelShape on '${walkState.ownerNode.properties.stableId}' ` +
							`names a non-numeric element position '${oneParticle.element}' at ${particlePath}. ` +
							`Refused BY NAME.`,
					);
				}
				const elementNode = walkState.elementNodeBySequencePosition.get(sequencePosition);
				if (elementNode === undefined) {
					throw new Error(
						`${moduleName}: contentModelShape on '${walkState.ownerNode.properties.stableId}' ` +
							`names element sequencePosition ${sequencePosition} at ${particlePath}, but the ` +
							`container declares no element child at that position (it declares ` +
							`${[...walkState.elementNodeBySequencePosition.keys()].sort((leftPosition, rightPosition) => leftPosition - rightPosition).join(', ') || 'none'}). ` +
							`Refused BY NAME — emitting the compositor without the particle would ship a ` +
							`content model the graph does not assert.`,
					);
				}
				if (walkState.consumedSequencePositionSet.has(sequencePosition)) {
					throw new Error(
						`${moduleName}: contentModelShape on '${walkState.ownerNode.properties.stableId}' ` +
							`names element sequencePosition ${sequencePosition} more than once (again at ` +
							`${particlePath}). Refused BY NAME — emitting the child twice would INVENT a ` +
							`declaration the source never made.`,
					);
				}
				walkState.consumedSequencePositionSet.add(sequencePosition);
				return renderNode(elementNode, indent);
			};

			// renderGroupRefParticle — <xs:group ref="…"/>. The forge does not build a node for a
			// group reference (the ruled 268-statement omission), but the REFERENCE itself rides
			// inside contentModelShape, so the emission can carry it faithfully without the parser
			// changing at all.
			const renderGroupRefParticle = ({ oneParticle, indent, walkState, particlePath }) => {
				// THE DISCRIMINATOR PROVES THE PROPERTY IS PRESENT, NOT THAT IT HAS A VALUE. Caught
				// in self-audit: a groupRef present-but-null passed the discriminator and would have
				// rendered ref="null" — a well-formed document asserting a reference nobody wrote,
				// which is the silent substitution this campaign exists to eliminate.
				if (typeof oneParticle.groupRef !== 'string' || oneParticle.groupRef.trim() === '') {
					throw new Error(
						`${moduleName}: contentModelShape on '${walkState.ownerNode.properties.stableId}' ` +
							`carries a group-reference particle at ${particlePath} whose 'groupRef' is ` +
							`${JSON.stringify(oneParticle.groupRef)} rather than a reference. Refused BY NAME.`,
					);
				}
				return [
					`${indent}<xs:group ref="${escapeXmlAttributeValue(oneParticle.groupRef)}"` +
						attributeIfPresent('minOccurs', oneParticle.minOccursAsWritten) +
						attributeIfPresent('maxOccurs', oneParticle.maxOccursAsWritten) +
						'/>',
				];
			};

			// renderAnyParticle — <xs:any/>. Same standing as the group reference above (the ruled
			// 25-statement omission); the wildcard's own attributes ride inside the shape.
			const renderAnyParticle = ({ oneParticle, indent, walkState, particlePath }) => {
				const anyRecord = oneParticle.any;
				if (!anyRecord || typeof anyRecord !== 'object') {
					throw new Error(
						`${moduleName}: contentModelShape on '${walkState.ownerNode.properties.stableId}' ` +
							`carries an xs:any particle at ${particlePath} whose payload is not an object. ` +
							`Refused BY NAME.`,
					);
				}
				return [
					`${indent}<xs:any` +
						attributeIfPresent('namespace', anyRecord.namespaceAsWritten) +
						attributeIfPresent('processContents', anyRecord.processContents) +
						attributeIfPresent('minOccurs', anyRecord.minOccursAsWritten) +
						attributeIfPresent('maxOccurs', anyRecord.maxOccursAsWritten) +
						'/>',
				];
			};

			// renderNestedCompositorParticle — a compositor nested inside a compositor. RECURSES.
			// It does not enumerate a second level and stop; the corpus nests arbitrarily and the
			// review that produced this phase was written about exactly that mistake.
			const renderNestedCompositorParticle = ({ oneParticle, indent, walkState, particlePath }) =>
				renderCompositorRecord({
					compositorRecord: oneParticle,
					indent,
					walkState,
					particlePath,
				});

			// FORMAL INTERFACE — ParticleRenderer. Declared because this is a polymorphic seam with
			// four implementations and one of them recurses back through the dispatcher; an
			// undeclared seam is where the next implementer guesses the contract wrong.
			//
			//   @typedef {function} ParticleRenderer
			//   @param   {object} arguments0
			//   @param   {object} arguments0.oneParticle   the particle record from contentModelShape
			//   @param   {string} arguments0.indent        leading tabs for this particle's own line
			//   @param   {object} arguments0.walkState     { ownerNode, elementNodeBySequencePosition,
			//                                               consumedSequencePositionSet } — SHARED and
			//                                               MUTATED: consuming an element position is
			//                                               how the coherence check later proves every
			//                                               declared child was placed exactly once.
			//   @param   {string} arguments0.particlePath  dotted path for refusal messages, so a
			//                                               refusal names a position and not a category
			//   @returns {string[]} emitted lines
			//   THROWS by name on any incoherence. It must never return a plausible rendering of a
			//   particle it could not resolve.
			const PARTICLE_RENDERER_BY_DISCRIMINATOR = {
				element: renderElementParticle,
				compositor: renderNestedCompositorParticle,
				groupRef: renderGroupRefParticle,
				any: renderAnyParticle,
			};

			// renderCompositorRecord — one compositor node of the shape tree -> its emitted lines.
			function renderCompositorRecord({ compositorRecord, indent, walkState, particlePath }) {
				const compositorKind = compositorRecord.compositor;
				if (
					!Object.prototype.hasOwnProperty.call(COMPOSITOR_ELEMENT_NAME_BY_KIND, compositorKind)
				) {
					throw new Error(
						`${moduleName}: contentModelShape on '${walkState.ownerNode.properties.stableId}' ` +
							`carries compositor kind '${compositorKind}' at ${particlePath}, which names no ` +
							`emitted element. Known kinds: ` +
							`${Object.keys(COMPOSITOR_ELEMENT_NAME_BY_KIND).join(', ')}. Refused BY NAME — an ` +
							`unrecognised compositor rendered as the common one would change the content ` +
							`model's meaning silently.`,
					);
				}
				const compositorElementName = COMPOSITOR_ELEMENT_NAME_BY_KIND[compositorKind];
				if (!Array.isArray(compositorRecord.particles)) {
					throw new Error(
						`${moduleName}: contentModelShape on '${walkState.ownerNode.properties.stableId}' ` +
							`carries a compositor at ${particlePath} whose 'particles' is not an array. ` +
							`REQUIRED shape is {compositor, particles:[…]}. Refused BY NAME.`,
					);
				}
				const openTag =
					`${indent}<${compositorElementName}` +
					attributeIfPresent('minOccurs', compositorRecord.minOccursAsWritten) +
					attributeIfPresent('maxOccurs', compositorRecord.maxOccursAsWritten);
				const particleLines = compositorRecord.particles.reduce(
					(lineList, oneParticle, particleOrdinal) => {
						const childParticlePath = `${particlePath}/${particleOrdinal}`;
						const discriminatorPropertyName = discriminatorPropertyNameOfParticle(
							oneParticle,
							walkState.ownerNode,
							childParticlePath,
						);
						return lineList.concat(
							PARTICLE_RENDERER_BY_DISCRIMINATOR[discriminatorPropertyName]({
								oneParticle,
								indent: `${indent}\t`,
								walkState,
								particlePath: childParticlePath,
							}),
						);
					},
					[],
				);
				return particleLines.length
					? [`${openTag}>`, ...particleLines, `${indent}</${compositorElementName}>`]
					: [`${openTag}/>`];
			}

			// renderContainerBody — the shared body of every node that can own a content model:
			// named definitions and anonymous types. Returns the lines that go between the
			// container's own open and close tags, documentation excluded (the caller owns that).
			//
			// THE ABSENCE RULE IS SEEDED, NOT GUESSED. A container that declares element children
			// REQUIRES a contentModelShape; its absence is a recorded fault refused by name, not a
			// missing key read as "emit them flat". A container with no element children and no
			// shape is the ordinary case (a simpleType, or a complexType carrying only attributes)
			// and is not an error. That pairing is what lets the red lever prove a READ.
			const renderContainerBody = (oneNode, indent, containerLabel) => {
				const childNodeList = orderedChildrenOf(oneNode.properties.stableId);
				const elementChildNodeList = childNodeList.filter(
					(oneChild) => oneChild.label === 'PescElementDecl',
				);
				// ATTRIBUTES TRAVEL WITH THE CONTENT MODEL — FOUND BY RUNNING THE INSTRUMENT, NOT BY
				// READING THE CHARTER. The parser attributes an xs:attribute to the CONTAINER by the
				// same rule it applies to an element, so the 14 attributes declared inside a
				// simpleContent extension were emitted OUTSIDE it, before the wrapper. XSD permits a
				// complexType carrying simpleContent/complexContent NO other children but annotation,
				// and orders an extension's own children compositor-then-attributes; the old emission
				// violated both. This was invisible while the element defect existed because a schema
				// processor reports the FIRST fault per component and stopped earlier — which is why
				// Phase 6's cause tally attributes 62 of 63 refusals to the compositor alone. Pre-
				// existing and identical in Phase 5's committed emission; verified, not assumed.
				const attributeChildNodeList = childNodeList.filter(
					(oneChild) => oneChild.label === 'PescAttributeDecl',
				);
				const derivationChildNodeList = childNodeList.filter(
					(oneChild) => oneChild.label === 'PescDerivation',
				);
				const remainingChildNodeList = childNodeList.filter(
					(oneChild) =>
						oneChild.label !== 'PescElementDecl' &&
						oneChild.label !== 'PescAttributeDecl' &&
						oneChild.label !== 'PescDerivation',
				);

				const contentModelShapeJson = optionalProperty(oneNode, 'contentModelShape');
				if (contentModelShapeJson === null && elementChildNodeList.length) {
					throw new Error(
						`${moduleName}: ${containerLabel} '${oneNode.properties.stableId}' declares ` +
							`${elementChildNodeList.length} element child/children but carries no ` +
							`'contentModelShape'. REQUIRED whenever element children exist and refused BY ` +
							`NAME — element particles emitted without a compositor are not valid XSD, and ` +
							`inferring a sequence from child order would be a guess dressed as a read.`,
					);
				}

				if (derivationChildNodeList.length > 1) {
					throw new Error(
						`${moduleName}: ${containerLabel} '${oneNode.properties.stableId}' carries ` +
							`${derivationChildNodeList.length} PescDerivation children. XSD permits one ` +
							`content derivation per type, so there is no defensible place to put the content ` +
							`model. Refused BY NAME.`,
					);
				}

				const walkState = {
					ownerNode: oneNode,
					elementNodeBySequencePosition: new Map(),
					consumedSequencePositionSet: new Set(),
				};
				if (contentModelShapeJson !== null) {
					elementChildNodeList.forEach((oneElementChild) => {
						walkState.elementNodeBySequencePosition.set(
							Number(requiredProperty(oneElementChild, 'sequencePosition', 'PescElementDecl')),
							oneElementChild,
						);
					});
				}

				// renderContainerMemberLines is A FUNCTION OF THE INDENT because only the receiving
				// node knows how deep its own wrappers go. Calling it is what consumes the element
				// children, so the coherence check below runs after the placement decision.
				//
				// ORDER IS THE XSD GRAMMAR'S, NOT THE GRAPH'S: compositor first, then attributes.
				// The graph's own child ordering puts attributes at attributePosition+1000000, which
				// happens to agree, but agreeing by accident is not the same as being right, and the
				// derivation route below reorders anyway.
				const renderContainerMemberLines = (memberIndent) =>
					(contentModelShapeJson === null
						? []
						: renderCompositorRecord({
								compositorRecord: JSON.parse(contentModelShapeJson),
								indent: memberIndent,
								walkState,
								particlePath: 'contentModelShape',
							})
					).concat(
						attributeChildNodeList.reduce(
							(lineList, oneChild) => lineList.concat(renderNode(oneChild, memberIndent)),
							[],
						),
					);

				const renderRemainingChildLines = () =>
					remainingChildNodeList.reduce(
						(lineList, oneChild) => lineList.concat(renderNode(oneChild, indent)),
						[],
					);

				const bodyLines = derivationChildNodeList.length
					? renderNode(derivationChildNodeList[0], indent, {
							renderInjectedDerivationBody: renderContainerMemberLines,
						}).concat(renderRemainingChildLines())
					: renderContainerMemberLines(indent).concat(renderRemainingChildLines());

				if (walkState.consumedSequencePositionSet.size !== elementChildNodeList.length) {
					const unconsumedPositionList = elementChildNodeList
						.map((oneElementChild) => Number(oneElementChild.properties.sequencePosition))
						.filter(
							(oneSequencePosition) =>
								!walkState.consumedSequencePositionSet.has(oneSequencePosition),
						);
					throw new Error(
						`${moduleName}: ${containerLabel} '${oneNode.properties.stableId}' declares ` +
							`${elementChildNodeList.length} element children but its contentModelShape names ` +
							`only ${walkState.consumedSequencePositionSet.size}; sequencePosition(s) ` +
							`${unconsumedPositionList.join(', ')} are unplaced. Refused BY NAME — emitting an ` +
							`unplaced child outside the compositor is invalid XSD and omitting it is silent ` +
							`loss reported as a forge defect.`,
					);
				}

				return bodyLines;
			};

			const renderNamedDefinition = (oneNode, indent) => {
				const kind = requiredProperty(oneNode, 'kind', 'PescNamedDefinition');
				const name = requiredProperty(oneNode, 'name', 'PescNamedDefinition');
				// PHASE 6.5: children now route through renderContainerBody, which places the
				// element children INSIDE the compositor named by contentModelShape rather than
				// beside it.
				const childLines = renderContainerBody(oneNode, `${indent}\t`, 'PescNamedDefinition');
				const documentation = documentationLines(oneNode, `${indent}\t`);
				// ADDED AT REMEDIATION (review item 3). A top-level xs:element may name its type by
				// reference; the graph carries typeAsWritten on exactly the 145 kind='element'
				// nodes whose 145 contentTypeRef statements the first verdict reported lost. The
				// correspondence being EXACT is what identified this as an emitter gap rather than
				// chain loss.
				const openTag =
					`${indent}<xs:${kind} name="${escapeXmlAttributeValue(name)}"` +
					attributeIfPresent('type', optionalProperty(oneNode, 'typeAsWritten'));
				return [`${openTag}>`, ...documentation, ...childLines, `${indent}</xs:${kind}>`];
			};

			const renderElementDecl = (oneNode, indent) => {
				const name = requiredProperty(oneNode, 'name', 'PescElementDecl');
				const openTag =
					`${indent}<xs:element name="${escapeXmlAttributeValue(name)}"` +
					attributeIfPresent('type', optionalProperty(oneNode, 'typeAsWritten')) +
					attributeIfPresent('minOccurs', optionalProperty(oneNode, 'minOccurs')) +
					attributeIfPresent('maxOccurs', optionalProperty(oneNode, 'maxOccurs')) +
					attributeIfPresent('nillable', optionalProperty(oneNode, 'nillable')) +
					// ADDED AT REMEDIATION (review item 4): the graph carries fixedAsWritten on
					// exactly the 2 nodes whose 2 elementFixed statements were reported lost.
					attributeIfPresent('fixed', optionalProperty(oneNode, 'fixedAsWritten'));
				const inner = documentationLines(oneNode, `${indent}\t`).concat(
					renderChildren(oneNode, `${indent}\t`),
				);
				return inner.length
					? [`${openTag}>`, ...inner, `${indent}</xs:element>`]
					: [`${openTag}/>`];
			};

			const renderAttributeDecl = (oneNode, indent) => {
				const name = requiredProperty(oneNode, 'name', 'PescAttributeDecl');
				const openTag =
					`${indent}<xs:attribute name="${escapeXmlAttributeValue(name)}"` +
					attributeIfPresent('type', optionalProperty(oneNode, 'typeAsWritten')) +
					attributeIfPresent('use', optionalProperty(oneNode, 'use'));
				const inner = documentationLines(oneNode, `${indent}\t`).concat(
					renderChildren(oneNode, `${indent}\t`),
				);
				return inner.length
					? [`${openTag}>`, ...inner, `${indent}</xs:attribute>`]
					: [`${openTag}/>`];
			};

			const renderAnonymousType = (oneNode, indent) => {
				const typeVariety = requiredProperty(oneNode, 'typeVariety', 'PescAnonymousType');
				const elementName = ANONYMOUS_TYPE_ELEMENT_NAME_BY_VARIETY[typeVariety];
				if (!elementName) {
					throw new Error(
						`${moduleName}: PescAnonymousType '${oneNode.properties.stableId}' carries ` +
							`typeVariety '${typeVariety}', which names no emitted element. Known values: ` +
							`${Object.keys(ANONYMOUS_TYPE_ELEMENT_NAME_BY_VARIETY).join(', ')}. Refused BY ` +
							`NAME — the predecessor silently emitted xs:complexType for anything it did not ` +
							`recognise, which is how 530 simpleTypes became complexTypes without a word.`,
					);
				}
				// PHASE 6.5: an anonymous type owns a content model exactly as a named one does —
				// 162 of them carry contentModelShape. Routing it through the same body builder is
				// the whole point: the review that chartered this phase was written about a fix
				// that handled one parent and left the others.
				const inner = documentationLines(oneNode, `${indent}\t`).concat(
					renderContainerBody(oneNode, `${indent}\t`, 'PescAnonymousType'),
				);
				return [`${indent}<${elementName}>`, ...inner, `${indent}</${elementName}>`];
			};

			const renderDerivation = (oneNode, indent, renderContext) => {
				const derivationVariety = requiredProperty(
					oneNode,
					'derivationVariety',
					'PescDerivation',
				);
				const elementName = `xs:${derivationVariety}`;
				const baseAsWritten = optionalProperty(oneNode, 'baseAsWritten');

				const facetLines = FACET_ELEMENT_NAME_BY_PROPERTY.reduce((lineList, oneFacetRule) => {
					const facetValue = optionalProperty(oneNode, oneFacetRule.propertyName);
					if (facetValue === null) {
						return lineList;
					}
					return lineList.concat(
						`${indent}\t<${oneFacetRule.elementName} value="${escapeXmlAttributeValue(facetValue)}"/>`,
					);
				}, []);

				// enumerationValues is a JSON string of [{value, documentation}]. It is the second
				// carrier of documentation in this graph and an emitter that ignored it would report
				// tens of thousands of literals as lost.
				const enumerationValuesJson = optionalProperty(oneNode, 'enumerationValues');
				const enumerationLines = [];
				if (enumerationValuesJson !== null) {
					const enumerationEntryList = JSON.parse(enumerationValuesJson);
					if (!Array.isArray(enumerationEntryList)) {
						throw new Error(
							`${moduleName}: enumerationValues on '${oneNode.properties.stableId}' parsed to a ` +
								`non-array. The shape is REQUIRED to be [{value, documentation}]; refused by name.`,
						);
					}
					enumerationEntryList.forEach((oneEnumerationEntry) => {
						if (!Object.prototype.hasOwnProperty.call(oneEnumerationEntry, 'value')) {
							throw new Error(
								`${moduleName}: an enumerationValues entry on '${oneNode.properties.stableId}' ` +
									`carries no 'value'. Refused by name, never emitted as an empty option.`,
							);
						}
						const openTag = `${indent}\t<xs:enumeration value="${escapeXmlAttributeValue(oneEnumerationEntry.value)}"`;
						const entryDocumentation = oneEnumerationEntry.documentation;
						if (entryDocumentation === undefined || String(entryDocumentation) === '') {
							enumerationLines.push(`${openTag}/>`);
							return;
						}
						enumerationLines.push(
							`${openTag}>`,
							`${indent}\t\t<xs:annotation>`,
							`${indent}\t\t\t<xs:documentation>${escapeXmlText(entryDocumentation)}</xs:documentation>`,
							`${indent}\t\t</xs:annotation>`,
							`${indent}\t</xs:enumeration>`,
						);
					});
				}

				const inner = documentationLines(oneNode, `${indent}\t`)
					.concat(facetLines)
					.concat(enumerationLines)
					.concat(renderChildren(oneNode, `${indent}\t`));
				// ADDED AT REMEDIATION (review item 2). XSD requires a complexContent or
				// simpleContent WRAPPER around a complexType's derivation. The predecessor read
				// contentStyle into NODE_PROPERTY_NAMES and then never used it, so 694 + 28
				// wrapped derivations emitted bare — and the canonicalizer, which recognises
				// derivation BY the wrapper, reported 600 derivesFrom + 600 derivationMethod as
				// chain loss over data the graph held all along.
				//
				// contentStyle is REQUIRED and an unknown value is refused by name. Reading it as
				// "no wrapper" would silently reproduce the very defect being repaired here.
				const contentStyle = requiredProperty(oneNode, 'contentStyle', 'PescDerivation');
				if (
					!Object.prototype.hasOwnProperty.call(
						DERIVATION_WRAPPER_ELEMENT_NAME_BY_CONTENT_STYLE,
						contentStyle,
					)
				) {
					throw new Error(
						`${moduleName}: PescDerivation '${oneNode.properties.stableId}' carries ` +
							`contentStyle '${contentStyle}', which names no wrapper rule. Known values: ` +
							`${Object.keys(DERIVATION_WRAPPER_ELEMENT_NAME_BY_CONTENT_STYLE).join(', ')}. ` +
							`Refused BY NAME rather than emitted bare.`,
					);
				}
				const wrapperElementName =
					DERIVATION_WRAPPER_ELEMENT_NAME_BY_CONTENT_STYLE[contentStyle];

				const derivationIndent = wrapperElementName ? `${indent}\t` : indent;

				// PHASE 6.5 — THE PLACEMENT THAT 478 TYPES DEPEND ON. The forge parser attributes a
				// derivation's member elements to the CONTAINING TYPE, not to the derivation node,
				// so the type owns the contentModelShape while the members physically belong inside
				// this extension. Emitting the compositor beside the wrapper (the shape of the
				// obvious fix) leaves a complexType carrying BOTH an xs:sequence and an
				// xs:complexContent, which every conforming processor refuses. The owner therefore
				// hands the content model down and this renderer places it, choosing the indent
				// because only it knows how deep its own wrapper goes.
				const injectedDerivationBodyLines =
					renderContext && renderContext.renderInjectedDerivationBody
						? renderContext.renderInjectedDerivationBody(`${derivationIndent}\t`)
						: [];
				if (injectedDerivationBodyLines.length && wrapperElementName === null) {
					throw new Error(
						`${moduleName}: PescDerivation '${oneNode.properties.stableId}' carries ` +
							`contentStyle '${contentStyle}', which places it directly inside a simpleType, ` +
							`yet its owner handed down content-model or attribute members to place. A ` +
							`simpleType has neither, so there is no valid position for them. Refused BY NAME ` +
							`rather than emitted somewhere plausible.`,
					);
				}
				const derivationBodyLines = inner.concat(injectedDerivationBodyLines);
				const openTag = `${derivationIndent}<${elementName}${attributeIfPresent('base', baseAsWritten)}`;
				const derivationLines = derivationBodyLines.length
					? [`${openTag}>`, ...derivationBodyLines, `${derivationIndent}</${elementName}>`]
					: [`${openTag}/>`];
				return wrapperElementName
					? [
							`${indent}<${wrapperElementName}>`,
							...derivationLines,
							`${indent}</${wrapperElementName}>`,
						]
					: derivationLines;
			};

			const renderImportDecl = (oneNode, indent) =>
				[
					`${indent}<xs:import` +
						attributeIfPresent('namespace', optionalProperty(oneNode, 'namespaceAsWritten')) +
						attributeIfPresent(
							'schemaLocation',
							optionalProperty(oneNode, 'schemaLocationAsWritten'),
						) +
						'/>',
				];

			const RENDERER_BY_LABEL = {
				PescNamedDefinition: renderNamedDefinition,
				PescElementDecl: renderElementDecl,
				PescAttributeDecl: renderAttributeDecl,
				PescAnonymousType: renderAnonymousType,
				PescDerivation: renderDerivation,
				PescImportDecl: renderImportDecl,
			};

			// ---- one document per artifact ----
			const emittedFileList = (nodeListByLabel.PescArtifact || [])
				.slice()
				.sort((leftNode, rightNode) =>
					String(leftNode.properties.filename).localeCompare(String(rightNode.properties.filename)),
				)
				.map((oneArtifactNode) => {
					const filename = requiredProperty(oneArtifactNode, 'filename', 'PescArtifact');

					// PHASE 6.5 (deliverable 2) — THE PREFIX DECLARATIONS. The emission previously
					// declared xmlns:xs and nothing else, so every reference written through a
					// corpus prefix — core:, AcRec:, tsr: — pointed at a namespace the document
					// never bound. That is the 63rd of Phase 6's 63 refusals, and the map to fix it
					// has been on the artifact node all along: prefixBindings, present on all 64
					// source artifacts (measured, not assumed).
					//
					// REQUIRED, never defaulted. Emitting the xs: vocabulary into a document whose
					// own binding table we could not read would produce a document that only looks
					// like a schema. The 'xs' binding is additionally asserted rather than trusted:
					// this module writes xs:-prefixed grammar on every line, so a corpus that bound
					// the XML Schema namespace to some other prefix would silently invalidate every
					// emitted document, and it must stop the run instead.
					const prefixBindingMap = JSON.parse(
						requiredProperty(oneArtifactNode, 'prefixBindings', 'PescArtifact'),
					);
					if (prefixBindingMap === null || typeof prefixBindingMap !== 'object') {
						throw new Error(
							`${moduleName}: prefixBindings on PescArtifact '${filename}' parsed to a ` +
								`non-object. The shape is REQUIRED to be a {prefix: namespace} map; refused BY NAME.`,
						);
					}
					if (prefixBindingMap.xs !== XSD_NAMESPACE_URI) {
						throw new Error(
							`${moduleName}: PescArtifact '${filename}' binds prefix 'xs' to ` +
								`'${prefixBindingMap.xs === undefined ? 'nothing' : prefixBindingMap.xs}', not to ` +
								`'${XSD_NAMESPACE_URI}'. This module emits xs:-prefixed XSD grammar unconditionally, ` +
								`so that binding is load-bearing. Refused BY NAME rather than emitting a document ` +
								`whose own grammar is unbound.`,
						);
					}
					// Deterministic order: the DEFAULT namespace ('') sorts first, then prefixes
					// alphabetically. Attribute order is not a statement on either side, but a
					// stable emission keeps byte diffs readable for a human.
					const namespaceDeclarationText = Object.keys(prefixBindingMap)
						.sort()
						.map((onePrefix) =>
							onePrefix === ''
								? `xmlns="${escapeXmlAttributeValue(prefixBindingMap[onePrefix])}"`
								: `xmlns:${onePrefix}="${escapeXmlAttributeValue(prefixBindingMap[onePrefix])}"`,
						)
						.join(' ');

					const schemaOpenTag =
						`<xs:schema ${namespaceDeclarationText}` +
						attributeIfPresent(
							'targetNamespace',
							optionalProperty(oneArtifactNode, 'targetNamespace'),
						) +
						attributeIfPresent(
							'elementFormDefault',
							optionalProperty(oneArtifactNode, 'elementFormDefault'),
						) +
						attributeIfPresent(
							'attributeFormDefault',
							optionalProperty(oneArtifactNode, 'attributeFormDefault'),
						) +
						attributeIfPresent(
							'version',
							optionalProperty(oneArtifactNode, 'schemaVersionAttribute'),
						) +
						'>';
					const bodyLines = documentationLines(oneArtifactNode, '\t').concat(
						renderChildren(oneArtifactNode, '\t'),
					);
					const lineList = [
						'<?xml version="1.0" encoding="UTF-8"?>',
						schemaOpenTag,
						...bodyLines,
						'</xs:schema>',
					];
					return {
						filename,
						// THE EMITTED SIDE'S SUBJECT — the artifact's OWN stableId, straight from
						// the graph. Formerly sourceLabelFor(filename), a version-stripped label
						// that fused all 14 CoreMain versions onto one subject and made loss in
						// one version unobservable behind another. See the long note at the
						// matching line in roundTripValidator.verifySnapshotDir; the two sides
						// must key identically or nothing matches at all. REQUIRED, never
						// defaulted: a subject quietly falling back to a name would reintroduce
						// exactly the fusion this change removes.
						fileLabel: requiredProperty(oneArtifactNode, 'stableId', 'PescArtifact'),
						displayFilename: filename,
						sha256: optionalProperty(oneArtifactNode, 'sha256'),
						xsdText: `${lineList.join('\n')}\n`,
					};
				});

			const nodeCountByLabel = {};
			EMITTED_LABEL_LIST.forEach((oneLabel) => {
				nodeCountByLabel[oneLabel] = (nodeListByLabel[oneLabel] || []).length;
			});

			return {
				emittedFileList,
				graphSummary: {
					sourceTierNodeTotal: allNodeList.length,
					nodeCountByLabel,
					artifactCount: emittedFileList.length,
				},
			};
		};

		// sourceLabelFor — the version-stripped file label, matching the canonicalizer's derivation
		// so subjects agree across the two sides.
		const sourceLabelFor = (filename) =>
			String(filename)
				.replace(/_v[\d.]+\.xsd$/, '')
				.replace(/\.xsd$/, '');

		// =====================================================================
		// emitFromReader — reader in, emitted documents out.
		// =====================================================================

		const emitFromReader = ({ reader } = {}, callback) => {
			if (!reader || typeof reader.readAll !== 'function') {
				callback(
					`${moduleName}.emitFromReader: a reader exposing readAll is REQUIRED and has no default.`,
				);
				return;
			}
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				reader.readAll({}, (readError, nodeListByLabel) => {
					if (readError) {
						next(readError);
						return;
					}
					next('', { ...args, nodeListByLabel });
				});
			});

			taskList.push((args, next) => {
				const serialized = serializeSourceProjection({ nodeListByLabel: args.nodeListByLabel });
				next('', { ...args, ...serialized });
			});

			pipeRunner(taskList.getList(), {}, (pipeError, args) => {
				if (pipeError) {
					callback(pipeError);
					return;
				}
				callback('', {
					emittedFileList: args.emittedFileList,
					graphSummary: args.graphSummary,
				});
			});
		};

		return {
			resolveContainerBolt,
			makeNeo4jSourceTierReader,
			serializeSourceProjection,
			emitFromReader,
			sourceLabelFor,
			STANDARD_SOURCE,
			SOURCE_TIER,
			EMITTED_LABEL_LIST,
			NODE_PROPERTY_NAMES,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
