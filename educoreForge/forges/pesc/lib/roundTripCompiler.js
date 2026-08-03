'use strict';

// roundTripCompiler.js (forge-pesc) — THE RE-EMITTER. Reads a MATERIALIZED PESC graph over bolt and
// writes XSD-shaped schema documents back out, one per source file label, so the emission can be
// diffed against the committed snapshot it came from.
//
// WHY IT READS THE GRAPH AND NOT THE FORGE'S OUTPUT (RT-4). TQ's founding ruling, preserved in the
// CEDS reference compiler: compiling from the forge's own result "would prove only that the forge
// remembers what it just read. Compiling from the GRAPH proves what the GRAPH ITSELF can support" —
// which is the question, and the only reading that also audits the loader.
//
// WHAT IT IS NOT. This module does not fix, enrich, or improve anything. It emits exactly what the
// graph carries and no more. A statement the graph does not hold is NOT invented to flatter the
// diff; it shows up as LOST, which is the deliverable (the import-declaration drift census is
// DECLARED CONTEXT — R-PW-4 condition 2 — and this serializer emits no import declarations at all,
// so the absent versions structurally cannot be invented).
//
// LAYER 1 ONLY (RT-4). Every query names its roles explicitly on BOTH endpoints and is scoped
// _source: 'PESC' — the graph this runs against holds seventeen other standards. THE READ MANIFEST,
// stated so the exclusions are decisions rather than accidents:
//   * roles read:  DmeStandardRoot (provenance identity only), DmeClass, DmeProperty,
//                  DmeOptionSet, DmeOptionValue, DmeSupport
//   * node properties read: _id, name, description, sourceFile, xsdKind, typeName, minOccurs,
//                  maxOccurs, baseType, derivation, restrictionBase, supportKind, isRootElement
//   * edges read:  HAS_PROPERTY (class->property, support->property), HAS_VALUE
//                  (optionSet->value), REFERENCES (class->class, class->support),
//                  HAS_OPTION_SET (class->optionSet), HAS_SUPPORT (class->support,
//                  support->support)
//   * DELIBERATELY NOT READ — Layer 2 / contract apparatus: searchText, embedding, crossRefs,
//     parentId, depth, path, mappingInstruction; hub nodes and IN_HUB-style edges; the
//     DmeStandardRoot's ownership edges (HAS_CLASS / HAS_SUPPORT / orphan HAS_OPTION_SET anchors)
//     — those exist so nothing is unreachable in the DME, they are not PESC statements.
//   * REDUNDANT CARRIERS NOT READ: SUBCLASS_OF (derivesFrom re-emits from the baseType/derivation
//     scalars, the raw source text) and property-level REFERENCES / HAS_OPTION_SET (a field's type
//     re-emits from its typeName scalar, the raw source text). Stated here so the choice of
//     carrier is visible.
//
// GRAMMAR YES, DATA NO (RT-5). This serializer knows the XSD output grammar — the xs: prefixed
// element vocabulary, the xmlns:xs declaration, the complexContent wrapper for a derived type, the
// sequence wrapper for member elements, the use='required' spelling of a required attribute. All of
// these are canonicalizer-transparent or verified-uniform shape, never data. It contains NO source
// value and never opens a source file: the snapshot bytes enter exactly once, at the diff.
//
// Async style: qtools taskListPlus/pipeRunner, error-first callbacks (R7), no async/await, no
// try/catch for control flow (the try/catch below wraps JSON.parse and the neo4j-driver require
// boundary). The neo4j-driver's Promises are consumed .then().catch() AT THE LEAF, resolving back
// into the err-string convention — the blessed dispensation recorded in apps/graph-builder/DOCTRINE.md.

const { execFile } = require('child_process');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const STANDARD_SOURCE = 'PESC';
const XSD_NAMESPACE_DECLARATION = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';
const DEFAULT_PAGE_SIZE = 2000;

const NODE_PROPERTY_NAMES = [
	'_id',
	'name',
	'description',
	'sourceFile',
	'xsdKind',
	'typeName',
	'minOccurs',
	'maxOccurs',
	'baseType',
	'derivation',
	'restrictionBase',
	'supportKind',
	'isRootElement',
];

// The Layer-1 edge queries. Each names BOTH endpoint roles explicitly (the CEDS L-4 discipline):
// the exclusion of Layer 2 and of the root's ownership anchors is a visible decision.
const EDGE_QUERIES = {
	classHasProperty: `MATCH (owner:DmeClass {_source:'${STANDARD_SOURCE}'})-[:HAS_PROPERTY]->(member:DmeProperty {_source:'${STANDARD_SOURCE}'}) RETURN owner._id AS ownerId, member._id AS memberId`,
	supportHasProperty: `MATCH (owner:DmeSupport {_source:'${STANDARD_SOURCE}'})-[:HAS_PROPERTY]->(member:DmeProperty {_source:'${STANDARD_SOURCE}'}) RETURN owner._id AS ownerId, member._id AS memberId`,
	optionSetHasValue: `MATCH (owner:DmeOptionSet {_source:'${STANDARD_SOURCE}'})-[:HAS_VALUE]->(member:DmeOptionValue {_source:'${STANDARD_SOURCE}'}) RETURN owner._id AS ownerId, member._id AS memberId`,
	classReferencesClass: `MATCH (owner:DmeClass {_source:'${STANDARD_SOURCE}'})-[:REFERENCES]->(target:DmeClass {_source:'${STANDARD_SOURCE}'}) RETURN owner._id AS ownerId, target._id AS memberId`,
	classReferencesSupport: `MATCH (owner:DmeClass {_source:'${STANDARD_SOURCE}'})-[:REFERENCES]->(target:DmeSupport {_source:'${STANDARD_SOURCE}'}) RETURN owner._id AS ownerId, target._id AS memberId`,
	classHasOptionSet: `MATCH (owner:DmeClass {_source:'${STANDARD_SOURCE}'})-[:HAS_OPTION_SET]->(target:DmeOptionSet {_source:'${STANDARD_SOURCE}'}) RETURN owner._id AS ownerId, target._id AS memberId`,
	classHasSupport: `MATCH (owner:DmeClass {_source:'${STANDARD_SOURCE}'})-[:HAS_SUPPORT]->(target:DmeSupport {_source:'${STANDARD_SOURCE}'}) RETURN owner._id AS ownerId, target._id AS memberId`,
	supportHasSupport: `MATCH (owner:DmeSupport {_source:'${STANDARD_SOURCE}'})-[:HAS_SUPPORT]->(target:DmeSupport {_source:'${STANDARD_SOURCE}'}) RETURN owner._id AS ownerId, target._id AS memberId`,
};

const CONTENT_ROLES = ['DmeClass', 'DmeProperty', 'DmeOptionSet', 'DmeOptionValue', 'DmeSupport'];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// =====================================================================
		// resolveContainerBolt — bolt endpoint + credential are FACTS ABOUT THE RUNNING
		// CONTAINER, read from `docker inspect`, never restated where they could drift.
		// An absent container / port / credential is a refusal by name, not a guess.
		// =====================================================================

		const defaultRunDockerCommand = (dockerArgs, callback) =>
			execFile('docker', dockerArgs, { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }, callback);

		const resolveContainerBolt = (
			{ containerName, runDockerCommand = defaultRunDockerCommand } = {},
			callback,
		) => {
			if (typeof containerName !== 'string' || containerName.trim() === '') {
				callback(`${moduleName}.resolveContainerBolt: containerName is REQUIRED and has no default.`);
				return;
			}
			runDockerCommand(['inspect', containerName], (inspectError, stdout, stderr) => {
				if (inspectError) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' failed: ` +
							`${inspectError.message}${stderr ? `\n${stderr}` : ''} — the container is absent or ` +
							`Docker is not running; neither is guessed at.`,
					);
					return;
				}
				let inspected;
				let parseFault = '';
				try {
					inspected = JSON.parse(stdout);
				} catch (parseError) {
					parseFault = parseError.message;
				}
				if (parseFault) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' returned ` +
							`unparseable JSON: ${parseFault}`,
					);
					return;
				}
				const record = Array.isArray(inspected) ? inspected[0] : inspected;
				if (!record) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' returned no ` +
							`record. The container does not exist under that name.`,
					);
					return;
				}
				const portBindingList =
					(record.NetworkSettings &&
						record.NetworkSettings.Ports &&
						record.NetworkSettings.Ports['7687/tcp']) ||
					[];
				const boltPort = (
					portBindingList.find((oneBinding) => oneBinding && oneBinding.HostPort) || {}
				).HostPort;
				if (!boltPort) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' publishes no host ` +
							`port for 7687/tcp. There is no bolt endpoint to read and one is not guessed at.`,
					);
					return;
				}
				const authEntry = ((record.Config && record.Config.Env) || []).find((oneEntry) =>
					String(oneEntry).startsWith('NEO4J_AUTH='),
				);
				if (!authEntry) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' declares no ` +
							`NEO4J_AUTH in its environment. The credential is read from the container, never assumed.`,
					);
					return;
				}
				const authValue = authEntry.slice('NEO4J_AUTH='.length);
				const slashAt = authValue.indexOf('/');
				if (slashAt === -1) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' has NEO4J_AUTH ` +
							`'${authValue}', which is not the '<user>/<password>' shape.`,
					);
					return;
				}
				callback('', {
					containerName,
					boltUrl: `bolt://localhost:${boltPort}`,
					user: authValue.slice(0, slashAt),
					password: authValue.slice(slashAt + 1),
				});
			});
		};

		// =====================================================================
		// THE READER — a materialized graph -> pescGraph
		//   makeNeo4jPescReader({ boltUrl, user, password, pageSize }) -> { readAll, close }
		//   A TEST DOUBLE satisfies the same contract; the serializer cannot tell them apart.
		//   pescGraph = { nodesByRole: { <role>: [properties] }, edgePairsByName: { <name>:
		//                [{ ownerId, memberId }] }, rootProperties }
		// =====================================================================

		const makeNeo4jPescReader = ({ boltUrl, user, password, pageSize } = {}) => {
			const effectivePageSize = pageSize || DEFAULT_PAGE_SIZE;
			const neo4j = require('neo4j-driver');
			let driver = null;

			const ensureDriver = () => {
				if (!driver) {
					driver = neo4j.driver(boltUrl, neo4j.auth.basic(user, password));
				}
				return driver;
			};

			// runRead — the ONE seam where driver Promises exist; resolved back to the err-string
			// convention at this leaf (the blessed dispensation, apps/graph-builder/DOCTRINE.md).
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

			const readRolePaged = ({ role }, callback) => {
				const projection = NODE_PROPERTY_NAMES.map(
					(onePropertyName) => `oneNode.\`${onePropertyName}\` AS \`${onePropertyName}\``,
				).join(', ');
				const cypher =
					`MATCH (oneNode:\`${role}\` {_source:'${STANDARD_SOURCE}'}) RETURN ${projection} ` +
					`ORDER BY oneNode.\`_id\` SKIP $skip LIMIT $limit`;
				const collected = [];
				const readNextPage = (skip) => {
					// SKIP/LIMIT must travel as neo4j integers — a JS number arrives as a float
					// and the server refuses '2000.0' by name.
					runRead(cypher, { skip: neo4j.int(skip), limit: neo4j.int(effectivePageSize) }, (readError, result) => {
						if (readError) {
							callback(readError);
							return;
						}
						result.records.forEach((oneRecord) => {
							const properties = {};
							NODE_PROPERTY_NAMES.forEach((onePropertyName) => {
								const value = oneRecord.get(onePropertyName);
								if (value !== null && value !== undefined) {
									properties[onePropertyName] = value;
								}
							});
							collected.push(properties);
						});
						if (result.records.length < effectivePageSize) {
							callback('', { nodeList: collected });
							return;
						}
						readNextPage(skip + effectivePageSize);
					});
				};
				readNextPage(0);
			};

			const readEdgePairs = ({ cypher }, callback) => {
				runRead(cypher, {}, (readError, result) => {
					if (readError) {
						callback(readError);
						return;
					}
					callback('', {
						pairList: result.records.map((oneRecord) => ({
							ownerId: oneRecord.get('ownerId'),
							memberId: oneRecord.get('memberId'),
						})),
					});
				});
			};

			const readAll = (callback) => {
				const taskList = new taskListPlus();
				const nodesByRole = {};
				const edgePairsByName = {};

				CONTENT_ROLES.forEach((oneRole) => {
					taskList.push((args, next) => {
						readRolePaged({ role: oneRole }, (readError, result) => {
							if (readError) {
								next(readError);
								return;
							}
							nodesByRole[oneRole] = result.nodeList;
							next('', args);
						});
					});
				});

				// the root: provenance identity for the verdict (snapshotKey, version), NOT content.
				taskList.push((args, next) => {
					runRead(
						`MATCH (rootNode:DmeStandardRoot {_source:'${STANDARD_SOURCE}'}) RETURN ` +
							`rootNode.\`_id\` AS rootId, rootNode.snapshotKey AS snapshotKey, ` +
							`rootNode.version AS version, rootNode.publishedVersion AS publishedVersion, ` +
							`rootNode.versionSource AS versionSource, rootNode.standardName AS standardName`,
						{},
						(readError, result) => {
							if (readError) {
								next(readError);
								return;
							}
							if (result.records.length !== 1) {
								next(
									`${moduleName}.readAll: expected exactly one DmeStandardRoot with ` +
										`_source='${STANDARD_SOURCE}', found ${result.records.length}. A graph without ` +
										`the PESC root is not a materialized PESC graph; refused rather than guessed at.`,
								);
								return;
							}
							const oneRecord = result.records[0];
							args.rootProperties = {
								rootId: oneRecord.get('rootId'),
								snapshotKey: oneRecord.get('snapshotKey'),
								version: oneRecord.get('version'),
								publishedVersion: oneRecord.get('publishedVersion'),
								versionSource: oneRecord.get('versionSource'),
								standardName: oneRecord.get('standardName'),
							};
							next('', args);
						},
					);
				});

				Object.keys(EDGE_QUERIES).forEach((oneEdgeName) => {
					taskList.push((args, next) => {
						readEdgePairs({ cypher: EDGE_QUERIES[oneEdgeName] }, (readError, result) => {
							if (readError) {
								next(readError);
								return;
							}
							edgePairsByName[oneEdgeName] = result.pairList;
							next('', args);
						});
					});
				});

				pipeRunner(taskList.getList(), {}, (pipeError, args) => {
					if (pipeError) {
						callback(pipeError);
						return;
					}
					callback('', {
						pescGraph: {
							nodesByRole,
							edgePairsByName,
							rootProperties: args.rootProperties,
						},
					});
				});
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
		// THE SERIALIZER — pescGraph -> XSD-shaped documents, one per source file label.
		// PURE (no I/O, no lookups outside the handed graph); callback-shaped per R7.
		// =====================================================================

		const escapeXmlText = (text) =>
			String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const escapeXmlAttribute = (text) =>
			escapeXmlText(text).replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

		const present = (value) => value !== undefined && value !== null && `${value}` !== '';

		const annotationLines = ({ description, indent }) => {
			if (!present(description)) {
				return [];
			}
			return [
				`${indent}<xs:annotation>`,
				`${indent}\t<xs:documentation>${escapeXmlText(description)}</xs:documentation>`,
				`${indent}</xs:annotation>`,
			];
		};

		const serializePescXsdFiles = ({ pescGraph } = {}, callback) => {
			if (!pescGraph || !pescGraph.nodesByRole || !pescGraph.edgePairsByName) {
				callback(
					`${moduleName}.serializePescXsdFiles: pescGraph with nodesByRole and edgePairsByName ` +
						`is REQUIRED and has no default.`,
				);
				return;
			}
			const { nodesByRole, edgePairsByName } = pescGraph;

			// node index + membership maps (owner _id -> member _ids, first-listed order discarded:
			// members are emitted name-sorted because order is not a statement).
			const nodeById = {};
			CONTENT_ROLES.forEach((oneRole) => {
				(nodesByRole[oneRole] || []).forEach((oneNode) => {
					nodeById[oneNode._id] = oneNode;
				});
			});

			const membersOf = (edgeNameList, ownerId) => {
				const memberList = [];
				edgeNameList.forEach((oneEdgeName) => {
					(edgePairsByName[oneEdgeName] || []).forEach((onePair) => {
						if (onePair.ownerId === ownerId && nodeById[onePair.memberId]) {
							memberList.push(nodeById[onePair.memberId]);
						}
					});
				});
				return memberList.sort((left, right) => String(left.name).localeCompare(String(right.name)));
			};

			const fieldLines = ({ fieldNode, indent }) => {
				const lines = [];
				const documentation = annotationLines({ description: fieldNode.description, indent: `${indent}\t` });
				if (fieldNode.xsdKind === 'attribute') {
					const attributeParts = [`name="${escapeXmlAttribute(fieldNode.name)}"`];
					if (present(fieldNode.typeName)) {
						attributeParts.push(`type="${escapeXmlAttribute(fieldNode.typeName)}"`);
					}
					if (`${fieldNode.minOccurs}` === '1') {
						attributeParts.push(`use="required"`);
					}
					if (documentation.length) {
						lines.push(`${indent}<xs:attribute ${attributeParts.join(' ')}>`);
						lines.push(...documentation);
						lines.push(`${indent}</xs:attribute>`);
					} else {
						lines.push(`${indent}<xs:attribute ${attributeParts.join(' ')}/>`);
					}
					return lines;
				}
				const elementParts = [`name="${escapeXmlAttribute(fieldNode.name)}"`];
				if (present(fieldNode.typeName)) {
					elementParts.push(`type="${escapeXmlAttribute(fieldNode.typeName)}"`);
				}
				if (present(fieldNode.minOccurs)) {
					elementParts.push(`minOccurs="${escapeXmlAttribute(fieldNode.minOccurs)}"`);
				}
				if (present(fieldNode.maxOccurs)) {
					elementParts.push(`maxOccurs="${escapeXmlAttribute(fieldNode.maxOccurs)}"`);
				}
				if (documentation.length) {
					lines.push(`${indent}<xs:element ${elementParts.join(' ')}>`);
					lines.push(...documentation);
					lines.push(`${indent}</xs:element>`);
				} else {
					lines.push(`${indent}<xs:element ${elementParts.join(' ')}/>`);
				}
				return lines;
			};

			// member block: the element fields in an xs:sequence (grammar wrapper, canonicalizer-
			// transparent), group refs beside them, attributes after — the XSD shape.
			const memberBlockLines = ({ ownerId, propertyEdgeNameList, groupEdgeNameList, indent }) => {
				const lines = [];
				const memberList = membersOf(propertyEdgeNameList, ownerId);
				const elementMembers = memberList.filter((oneNode) => oneNode.xsdKind !== 'attribute');
				const attributeMembers = memberList.filter((oneNode) => oneNode.xsdKind === 'attribute');
				const groupTargets = membersOf(groupEdgeNameList, ownerId).filter(
					(oneNode) => oneNode.supportKind === 'group',
				);
				if (elementMembers.length || groupTargets.length) {
					lines.push(`${indent}<xs:sequence>`);
					elementMembers.forEach((oneFieldNode) =>
						lines.push(...fieldLines({ fieldNode: oneFieldNode, indent: `${indent}\t` })),
					);
					groupTargets.forEach((oneGroupNode) =>
						lines.push(`${indent}\t<xs:group ref="${escapeXmlAttribute(oneGroupNode.name)}"/>`),
					);
					lines.push(`${indent}</xs:sequence>`);
				}
				attributeMembers.forEach((oneFieldNode) =>
					lines.push(...fieldLines({ fieldNode: oneFieldNode, indent })),
				);
				return lines;
			};

			// ---- assemble per-file documents ----
			const fileLabelSet = new Set();
			CONTENT_ROLES.forEach((oneRole) => {
				(nodesByRole[oneRole] || []).forEach((oneNode) => {
					if (present(oneNode.sourceFile)) {
						fileLabelSet.add(oneNode.sourceFile);
					}
				});
			});

			const byName = (left, right) => String(left.name).localeCompare(String(right.name));

			const emittedFiles = Array.from(fileLabelSet)
				.sort()
				.map((oneFileLabel) => {
					const lines = [];
					lines.push('<?xml version="1.0" encoding="UTF-8"?>');
					lines.push(`<xs:schema ${XSD_NAMESPACE_DECLARATION}>`);

					const classNodes = (nodesByRole.DmeClass || []).filter(
						(oneNode) => oneNode.sourceFile === oneFileLabel,
					);
					const rootElementNodes = classNodes.filter((oneNode) => oneNode.isRootElement === true).sort(byName);
					const namedComplexTypeNodes = classNodes
						.filter((oneNode) => oneNode.isRootElement !== true)
						.sort(byName);
					const supportNodes = (nodesByRole.DmeSupport || []).filter(
						(oneNode) => oneNode.sourceFile === oneFileLabel,
					);
					const groupNodes = supportNodes.filter((oneNode) => oneNode.supportKind === 'group').sort(byName);
					const supportSimpleTypeNodes = supportNodes
						.filter((oneNode) => oneNode.supportKind === 'simpleType')
						.sort(byName);
					const optionSetNodes = (nodesByRole.DmeOptionSet || [])
						.filter((oneNode) => oneNode.sourceFile === oneFileLabel)
						.sort(byName);

					// root (message) elements
					rootElementNodes.forEach((oneRootNode) => {
						const contentTypeTargets = membersOf(
							['classReferencesClass', 'classReferencesSupport', 'classHasOptionSet'],
							oneRootNode._id,
						);
						const elementParts = [`name="${escapeXmlAttribute(oneRootNode.name)}"`];
						if (contentTypeTargets.length) {
							elementParts.push(`type="${escapeXmlAttribute(contentTypeTargets[0].name)}"`);
						}
						const documentation = annotationLines({ description: oneRootNode.description, indent: '\t\t' });
						const inlineMemberLines = memberBlockLines({
							ownerId: oneRootNode._id,
							propertyEdgeNameList: ['classHasProperty'],
							groupEdgeNameList: ['classHasSupport'],
							indent: '\t\t\t',
						});
						if (!documentation.length && !inlineMemberLines.length) {
							lines.push(`\t<xs:element ${elementParts.join(' ')}/>`);
							return;
						}
						lines.push(`\t<xs:element ${elementParts.join(' ')}>`);
						lines.push(...documentation);
						if (inlineMemberLines.length) {
							lines.push('\t\t<xs:complexType>');
							lines.push(...inlineMemberLines);
							lines.push('\t\t</xs:complexType>');
						}
						lines.push('\t</xs:element>');
					});

					// named complex types
					namedComplexTypeNodes.forEach((oneTypeNode) => {
						lines.push(`\t<xs:complexType name="${escapeXmlAttribute(oneTypeNode.name)}">`);
						lines.push(...annotationLines({ description: oneTypeNode.description, indent: '\t\t' }));
						const hasDerivation = present(oneTypeNode.baseType) && present(oneTypeNode.derivation);
						const memberIndent = hasDerivation ? '\t\t\t\t' : '\t\t';
						if (hasDerivation) {
							lines.push('\t\t<xs:complexContent>');
							lines.push(
								`\t\t\t<xs:${oneTypeNode.derivation} base="${escapeXmlAttribute(oneTypeNode.baseType)}">`,
							);
						}
						lines.push(
							...memberBlockLines({
								ownerId: oneTypeNode._id,
								propertyEdgeNameList: ['classHasProperty'],
								groupEdgeNameList: ['classHasSupport'],
								indent: memberIndent,
							}),
						);
						if (hasDerivation) {
							lines.push(`\t\t\t</xs:${oneTypeNode.derivation}>`);
							lines.push('\t\t</xs:complexContent>');
						}
						lines.push('\t</xs:complexType>');
					});

					// groups
					groupNodes.forEach((oneGroupNode) => {
						lines.push(`\t<xs:group name="${escapeXmlAttribute(oneGroupNode.name)}">`);
						lines.push(...annotationLines({ description: oneGroupNode.description, indent: '\t\t' }));
						lines.push(
							...memberBlockLines({
								ownerId: oneGroupNode._id,
								propertyEdgeNameList: ['supportHasProperty'],
								groupEdgeNameList: ['supportHasSupport'],
								indent: '\t\t',
							}),
						);
						lines.push('\t</xs:group>');
					});

					// enumeration simple types (option sets)
					optionSetNodes.forEach((oneOptionSetNode) => {
						lines.push(`\t<xs:simpleType name="${escapeXmlAttribute(oneOptionSetNode.name)}">`);
						lines.push(...annotationLines({ description: oneOptionSetNode.description, indent: '\t\t' }));
						const restrictionParts = present(oneOptionSetNode.restrictionBase)
							? ` base="${escapeXmlAttribute(oneOptionSetNode.restrictionBase)}"`
							: '';
						lines.push(`\t\t<xs:restriction${restrictionParts}>`);
						membersOf(['optionSetHasValue'], oneOptionSetNode._id).forEach((oneValueNode) => {
							const valueDocumentation = annotationLines({
								description: oneValueNode.description,
								indent: '\t\t\t\t',
							});
							if (valueDocumentation.length) {
								lines.push(`\t\t\t<xs:enumeration value="${escapeXmlAttribute(oneValueNode.name)}">`);
								lines.push(...valueDocumentation);
								lines.push('\t\t\t</xs:enumeration>');
							} else {
								lines.push(`\t\t\t<xs:enumeration value="${escapeXmlAttribute(oneValueNode.name)}"/>`);
							}
						});
						lines.push('\t\t</xs:restriction>');
						lines.push('\t</xs:simpleType>');
					});

					// non-enumeration named simple types (support scaffolding)
					supportSimpleTypeNodes.forEach((oneSupportNode) => {
						lines.push(`\t<xs:simpleType name="${escapeXmlAttribute(oneSupportNode.name)}">`);
						lines.push(...annotationLines({ description: oneSupportNode.description, indent: '\t\t' }));
						if (present(oneSupportNode.restrictionBase)) {
							lines.push(
								`\t\t<xs:restriction base="${escapeXmlAttribute(oneSupportNode.restrictionBase)}"/>`,
							);
						}
						lines.push('\t</xs:simpleType>');
					});

					lines.push('</xs:schema>');
					return { fileLabel: oneFileLabel, xsdText: `${lines.join('\n')}\n` };
				});

			callback('', { emittedFiles });
		};

		// =====================================================================
		// compileFromReader — reader -> { emittedFiles, graphSummary }. The reader may be the
		// bolt reader or a test double; this function cannot tell and must not care.
		// =====================================================================

		const compileFromReader = ({ reader } = {}, callback) => {
			if (!reader || typeof reader.readAll !== 'function') {
				callback(
					`${moduleName}.compileFromReader: reader with readAll(callback) is REQUIRED and has ` +
						`no default.`,
				);
				return;
			}
			reader.readAll((readError, readResult) => {
				if (readError) {
					callback(readError);
					return;
				}
				const { pescGraph } = readResult;
				serializePescXsdFiles({ pescGraph }, (serializeError, serializeResult) => {
					if (serializeError) {
						callback(serializeError);
						return;
					}
					const nodeCounts = {};
					CONTENT_ROLES.forEach((oneRole) => {
						nodeCounts[oneRole] = (pescGraph.nodesByRole[oneRole] || []).length;
					});
					const edgeCounts = {};
					Object.keys(pescGraph.edgePairsByName).forEach((oneEdgeName) => {
						edgeCounts[oneEdgeName] = (pescGraph.edgePairsByName[oneEdgeName] || []).length;
					});
					callback('', {
						emittedFiles: serializeResult.emittedFiles,
						graphSummary: {
							rootProperties: pescGraph.rootProperties || {},
							nodeCounts,
							edgeCounts,
						},
					});
				});
			});
		};

		// compileFromGraph — the bolt convenience seam: credentials in, emission out.
		const compileFromGraph = ({ boltUrl, user, password, pageSize } = {}, callback) => {
			if (!boltUrl || !user || password === undefined) {
				callback(
					`${moduleName}.compileFromGraph: boltUrl, user and password are REQUIRED and have no ` +
						`defaults — resolve them from the running container (resolveContainerBolt).`,
				);
				return;
			}
			const reader = makeNeo4jPescReader({ boltUrl, user, password, pageSize });
			compileFromReader({ reader }, (compileError, compileResult) => {
				reader.close((closeError) => {
					if (compileError) {
						callback(compileError);
						return;
					}
					if (closeError) {
						callback(closeError);
						return;
					}
					callback('', compileResult);
				});
			});
		};

		return {
			resolveContainerBolt,
			makeNeo4jPescReader,
			serializePescXsdFiles,
			compileFromReader,
			compileFromGraph,
			EDGE_QUERIES,
			NODE_PROPERTY_NAMES,
			CONTENT_ROLES,
			STANDARD_SOURCE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
