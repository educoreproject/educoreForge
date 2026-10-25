'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiRoundTripPair.js — H4 for every OpenAPI-kit forge bundle (nextStandards-102326 K0; Profile §8.5): a SOURCE-side
// canonicalizer and a GRAPH-side emitter held apart on purpose. The canonicalizer reads only the snapshot's OpenAPI document and
// knows nothing of the graph: it flattens every components.schemas member to LEAF statements. The emitter reads only the
// materialized graph and rebuilds the same statements, reading the keyword registry BACKWARDS (node property name -> keyword at
// its position). Every value is part of its statement KEY, so the harness's key-only diff is also a value diff:
//   schema|<S>||declared                          a schema (graph: the root's HAS_CLASS edge)
//   schema|<S>|/properties/<p>|declared           a property (graph: the HAS_PROPERTY edge)
//   schema|<S>|<pointer>|<JSON scalar>            every scalar leaf, at its JSON pointer inside the schema (graph: a node
//                                                 property, a REFERENCES edge by its locator, a compositionBranches entry)
//   schema|<S>|<pointer>/*|<JSON scalar>          a member of a SET-valued array: required (graph: isRequired true) and
//                                                 enum (graph: HAS_OPTION_SET then HAS_VALUE, at the set's enumLocator)
// Order is NOT a statement: JSON object member order and the order of required and enum members carry no meaning in JSON
// Schema; a composition branch's position IS kept, because it is part of the locator its edge carries.
// EXPLICITLY OMITTED, each statement naming its kind: every top-level member other than components (paths, info, servers, tags,
// openapi, …) and every components member other than schemas, one statement per member (outOfScopeByDeclaration, plan Q-N3);
// and each leaf of a schema the profile excludes (excludedSchema).
// A node property the emitter has no reading for is NOT ignored: it becomes an `unread|…` statement, which no source states, so
// an invented property counts as invented. The names it may ignore are the framework's derived ones, listed here by name.
// ⟪K2, wave 2 lane E⟫ the source is parsed by its sourceFormat (openapiSourceParser.js, as the loader). A vendor property name reads
// back by the walk's rule, a '_'-marked word being a digit-led one (x_1edtechPrivacy -> x-1edtech-privacy); a vendor extension the
// profile's listValuedVendorExtensionNameList names is JSON text holding the source list, read back member by member at its index.
// EXPLICITLY OMITTED by the profile's enumMemberTextDeclarationList: each enum member the source types as a number or boolean
// (declaredMemberText); the source then states the declared text in its place, which is what the graph carries.

const path = require('path');
const { DME_ROLES, EQUIVALENCE_NODE_LABELS } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const { validateOpenapiProfile } = require('./openapiProfileContract');
const { parseOpenapiSourceFile } = require('./openapiSourceParser');
const { memberSegmentOf } = require('./openapiIdentity');
const keywordRegistry = require('./openapiKeywordRegistry.json');

const SET_VALUED_KEYWORD_LIST = Object.freeze(['required', 'enum']);
const SET_MEMBER_SEGMENT = '*';
const DECLARED_TEXT = 'declared';
const SCHEMA_REFERENCE_PREFIX = '#/components/schemas/';
const ROOT_ROLE = DME_ROLES.STANDARD_ROOT;
// layers the source states nothing about, excluded BY ROLE so the exclusion is a stated decision (the pescld/CTDL-family form)
const NOT_SOURCE_ROLE_LIST = Object.freeze([DME_ROLES.EMBED_TEXT, EQUIVALENCE_NODE_LABELS.HUB_REFERENCE, EQUIVALENCE_NODE_LABELS.HUB_DEFINITION]);
// the properties the framework derives or stamps on every content node: identity, structure, search; never a source statement
// 'embedding' is the node's vector: a vectorised build's graph reader returns it (measured: laneA/builds/a1recvec, 233 invented before this)
const DERIVED_PROPERTY_NAME_LIST = Object.freeze(['_id', '_source', 'stableId', 'role', 'name', 'searchText', 'parentId', 'path', 'depth', 'crossRefs', 'embedding', 'embeddingModelVersion']);
const COMPOSITION_BRANCHES_PROPERTY_NAME = 'compositionBranches';
const ENUM_LOCATOR_PROPERTY_NAME = 'enumLocator';
const REQUIRED_PROPERTY_NAME = 'isRequired';
// derived from the REFERENCES edges by the walk; checked against them below, never a statement of its own
const REFERENCED_SCHEMA_NAMES_PROPERTY_NAME = 'referencedSchemaNames';
const REFERENCED_SCHEMA_NAMES_SEPARATOR = ', ';
const BRANCH_RECORD_STRUCTURE_FIELD_LIST = Object.freeze(['locator', 'construct']);

const OMITTED_KIND = Object.freeze({ OUT_OF_SCOPE_BY_DECLARATION: 'outOfScopeByDeclaration', EXCLUDED_SCHEMA: 'excludedSchema', DECLARED_MEMBER_TEXT: 'declaredMemberText' });
const OMITTED_KIND_PROPERTY_NAME = 'omittedKind';
const omitted = (kind) => ({ explicitlyOmitted: true, [OMITTED_KIND_PROPERTY_NAME]: kind });

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const escapedPointerSegment = (segmentText) => `${segmentText}`.replace(/~/g, '~0').replace(/\//g, '~1');

// keywordByPropertyNameAt — the registry read backwards for one position: node property name -> keyword
const keywordByPropertyNameAt = (position) => Object.keys(keywordRegistry.carriageByPosition[position])
	.filter((keywordName) => keywordRegistry.carriageByPosition[position][keywordName].carriage === 'nodeProperty')
	.reduce((byName, keywordName) => ({ ...byName, [keywordRegistry.carriageByPosition[position][keywordName].propertyName]: keywordName }), {});
// vendorKeywordOf — xClassPid -> x-class-pid, x_1edtechPrivacy -> x-1edtech-privacy (the inverse of the walk's naming rule: a word is a
// capital and its lower-case run, or '_' and a digit-led run)
const VENDOR_PROPERTY_WORD_PATTERN = /[A-Z][a-z0-9]*|_[0-9][a-z0-9]*/g;
const vendorKeywordOf = (propertyName) => `${keywordRegistry.vendorExtensionRule.namePrefix}${propertyName
	.slice(keywordRegistry.vendorExtensionRule.propertyNamePrefix.length)
	.match(VENDOR_PROPERTY_WORD_PATTERN)
	.map((oneWord) => (oneWord.charAt(0) === '_' ? oneWord.slice(1) : oneWord.toLowerCase()))
	.join('-')}`;
const VENDOR_PROPERTY_NAME_PATTERN = new RegExp(`^${keywordRegistry.vendorExtensionRule.propertyNamePrefix}([A-Z][a-z0-9]*|_[0-9][a-z0-9]*)+$`);

// the reference construct a locator implies (a consistency reading: the edge's own referenceConstruct must agree)
const referenceConstructOfLocator = (locator) => {
	const compositionMatch = locator.match(new RegExp(`/(${keywordRegistry.compositionConstructList.join('|')})/[0-9]+/\\$ref$`));
	if (compositionMatch !== null) {
		return compositionMatch[1];
	}
	return locator === '/items/$ref' ? 'items' : locator === '/$ref' ? '$ref' : undefined;
};

const moduleFunction =
	({ moduleName } = {}) =>
	({ openapiProfile, stableUriPropertyName, ruleModulePath }) => {
		validateOpenapiProfile(openapiProfile);
		const { stableIdPrefix, sourceFileName, schemaExclusionList, listValuedVendorExtensionNameList, enumMemberTextDeclarationList } = openapiProfile;
		const classKeywordByPropertyName = keywordByPropertyNameAt('schema');
		const propertyKeywordByPropertyName = keywordByPropertyNameAt('property');
		const itemsKeywordByPropertyName = keywordByPropertyNameAt('items');
		const branchKeywordByPropertyName = keywordByPropertyNameAt('branch');
		const ignoredPropertyNameList = DERIVED_PROPERTY_NAME_LIST.concat([stableUriPropertyName]);

		// -----------------------------------------------------------------
		// canonicalizeSource — the snapshot's OpenAPI document → statements (never the graph)
		// -----------------------------------------------------------------
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			const sourceFilePath = path.join(snapshotPath, sourceFileName);
			const { parseRefusal, document } = parseOpenapiSourceFile({ sourceFilePath, sourceFormat: openapiProfile.sourceFormat });
			if (parseRefusal !== '') {
				callback(`${moduleName} ${parseRefusal}`);
				return;
			}
			if (!isPlainObject(document) || !isPlainObject(document.components) || !isPlainObject(document.components.schemas)) {
				callback(`${moduleName} REFUSED: '${sourceFilePath}' has no components.schemas object`);
				return;
			}
			const statements = new Map();
			Object.keys(document).filter((memberName) => memberName !== 'components').forEach((memberName) => {
				statements.set(`outOfScope|/${escapedPointerSegment(memberName)}`, omitted(OMITTED_KIND.OUT_OF_SCOPE_BY_DECLARATION));
			});
			Object.keys(document.components).filter((memberName) => memberName !== 'schemas').forEach((memberName) => {
				Object.keys(document.components[memberName]).forEach((entryName) => {
					statements.set(`outOfScope|/components/${escapedPointerSegment(memberName)}/${escapedPointerSegment(entryName)}`, omitted(OMITTED_KIND.OUT_OF_SCOPE_BY_DECLARATION));
				});
			});

			// leafStatements — every scalar leaf under one JSON value, at its pointer; set-valued arrays keyed by member
			const leafStatementsOf = ({ schemaName, jsonValue, pointer, statementOf }) => {
				if (Array.isArray(jsonValue)) {
					const lastSegment = pointer.split('/').pop();
					const isSetValued = SET_VALUED_KEYWORD_LIST.indexOf(lastSegment) !== -1;
					const enumObjectPointer = `${schemaName}${pointer.slice(0, -'/enum'.length)}`;
					jsonValue.forEach((oneMember, memberIndex) => {
						const memberDeclaration = lastSegment === 'enum' && typeof oneMember !== 'string'
							? enumMemberTextDeclarationList.find((oneDeclaration) => oneDeclaration.enumObjectPointer === enumObjectPointer && oneDeclaration.statedValue === oneMember)
							: undefined;
						if (memberDeclaration !== undefined) {
							// ⟪K2d⟫ the stated scalar is declared omitted; the declared text is what the source states in its place
							statements.set(`schema|${schemaName}|${pointer}/${SET_MEMBER_SEGMENT}|${JSON.stringify(oneMember)}`, omitted(OMITTED_KIND.DECLARED_MEMBER_TEXT));
							statements.set(`schema|${schemaName}|${pointer}/${SET_MEMBER_SEGMENT}|${JSON.stringify(memberDeclaration.carriedText)}`, statementOf());
							return;
						}
						leafStatementsOf({ schemaName, jsonValue: oneMember, pointer: `${pointer}/${isSetValued ? SET_MEMBER_SEGMENT : memberIndex}`, statementOf });
					});
					return;
				}
				if (isPlainObject(jsonValue)) {
					Object.keys(jsonValue).forEach((memberName) => leafStatementsOf({ schemaName, jsonValue: jsonValue[memberName], pointer: `${pointer}/${escapedPointerSegment(memberName)}`, statementOf }));
					return;
				}
				statements.set(`schema|${schemaName}|${pointer}|${JSON.stringify(jsonValue)}`, statementOf());
			};

			Object.keys(document.components.schemas).forEach((schemaName) => {
				const schemaObject = document.components.schemas[schemaName];
				const isExcluded = schemaExclusionList.indexOf(schemaName) !== -1;
				const statementOf = () => (isExcluded ? omitted(OMITTED_KIND.EXCLUDED_SCHEMA) : {});
				statements.set(`schema|${schemaName}||${DECLARED_TEXT}`, statementOf());
				if (isPlainObject(schemaObject) && isPlainObject(schemaObject.properties)) {
					Object.keys(schemaObject.properties).forEach((propertyName) => statements.set(`schema|${schemaName}|/properties/${escapedPointerSegment(propertyName)}|${DECLARED_TEXT}`, statementOf()));
				}
				leafStatementsOf({ schemaName, jsonValue: schemaObject, pointer: '', statementOf });
			});
			callback('', { statements, stats: { statementCount: statements.size } });
		};

		// -----------------------------------------------------------------
		// emitFromGraph — the materialized graph → statements (never a source file)
		// -----------------------------------------------------------------
		const emitFromGraph = ({ reader }, callback) => {
			reader.readAll((readError, graph) => {
				if (readError) {
					callback(readError);
					return;
				}
				const statements = new Map();
				const nodeById = graph.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
				let fault;
				// identityOf — { schemaName, propertyName?, isEnum? } from a stableId under the profile's prefix, or a fault
				const identityOf = (stableId) => {
					if (!stableId.startsWith(stableIdPrefix)) {
						return undefined;
					}
					const segmentList = stableId.slice(stableIdPrefix.length).split('/');
					return { schemaName: segmentList[0], propertyName: segmentList[1], enumSegment: segmentList[2], memberText: segmentList[3], segmentCount: segmentList.length };
				};
				const statementFor = ({ schemaName, pointer, jsonValue }) => statements.set(`schema|${schemaName}|${pointer}|${JSON.stringify(jsonValue)}`, {});
				const unreadStatementFor = ({ stableId, propertyName, propertyValue }) => statements.set(`unread|${stableId}|${propertyName}|${JSON.stringify(propertyValue)}`, {});
				// vendorStatementsFor — one vendor node property back to its statement(s); a declared list-valued one is JSON text whose
				// members are read at their index (anything else under that name is unread, so it counts as invented)
				const vendorStatementsFor = ({ stableId, schemaName, pointerPrefix, propertyName, propertyValue }) => {
					const vendorKeyword = vendorKeywordOf(propertyName);
					if (listValuedVendorExtensionNameList.indexOf(vendorKeyword) === -1) {
						statementFor({ schemaName, pointer: `${pointerPrefix}/${vendorKeyword}`, jsonValue: propertyValue });
						return;
					}
					const memberList = typeof propertyValue === 'string' && /^\[/.test(propertyValue) ? JSON.parse(propertyValue) : undefined;
					if (!Array.isArray(memberList)) {
						unreadStatementFor({ stableId, propertyName, propertyValue });
						return;
					}
					memberList.forEach((oneMember, memberIndex) => statementFor({ schemaName, pointer: `${pointerPrefix}/${vendorKeyword}/${memberIndex}`, jsonValue: oneMember }));
				};

				graph.nodes.forEach((oneNode) => {
					const { stableId, role, properties } = oneNode;
					if (role === ROOT_ROLE || NOT_SOURCE_ROLE_LIST.indexOf(role) !== -1) {
						return;
					}
					const identity = identityOf(stableId);
					if (identity === undefined) {
						fault = `node '${stableId}' is not under the profile's prefix '${stableIdPrefix}'`;
						return;
					}
					const { schemaName, propertyName } = identity;
					if (role === DME_ROLES.CLASS) {
						if (identity.segmentCount !== 1 || properties.name !== schemaName) {
							fault = `class node '${stableId}' does not read as <prefix><Schema> named for its schema`;
							return;
						}
						Object.keys(properties).filter((oneName) => ignoredPropertyNameList.indexOf(oneName) === -1).forEach((oneName) => {
							if (classKeywordByPropertyName[oneName] !== undefined) {
								statementFor({ schemaName, pointer: `/${escapedPointerSegment(classKeywordByPropertyName[oneName])}`, jsonValue: properties[oneName] });
								return;
							}
							if (VENDOR_PROPERTY_NAME_PATTERN.test(oneName)) {
								vendorStatementsFor({ stableId, schemaName, pointerPrefix: '', propertyName: oneName, propertyValue: properties[oneName] });
								return;
							}
							unreadStatementFor({ stableId, propertyName: oneName, propertyValue: properties[oneName] });
						});
						return;
					}
					if (role === DME_ROLES.PROPERTY) {
						if (identity.segmentCount !== 2 || properties.name !== propertyName) {
							fault = `property node '${stableId}' does not read as <prefix><Schema>/<property> named for its property`;
							return;
						}
						const propertyPointer = `/properties/${escapedPointerSegment(propertyName)}`;
						Object.keys(properties).filter((oneName) => ignoredPropertyNameList.indexOf(oneName) === -1).forEach((oneName) => {
							const propertyValue = properties[oneName];
							if (propertyKeywordByPropertyName[oneName] !== undefined) {
								statementFor({ schemaName, pointer: `${propertyPointer}/${propertyKeywordByPropertyName[oneName]}`, jsonValue: propertyValue });
								return;
							}
							if (itemsKeywordByPropertyName[oneName] !== undefined) {
								statementFor({ schemaName, pointer: `${propertyPointer}/items/${itemsKeywordByPropertyName[oneName]}`, jsonValue: propertyValue });
								return;
							}
							if (oneName === REQUIRED_PROPERTY_NAME) {
								if (propertyValue === true) {
									statementFor({ schemaName, pointer: `/required/${SET_MEMBER_SEGMENT}`, jsonValue: propertyName });
								} else if (propertyValue !== false) {
									unreadStatementFor({ stableId, propertyName: oneName, propertyValue });
								}
								return;
							}
							if (oneName === REFERENCED_SCHEMA_NAMES_PROPERTY_NAME) {
								return; // derived: checked against the REFERENCES edges after the node pass
							}
							if (oneName === COMPOSITION_BRANCHES_PROPERTY_NAME) {
								JSON.parse(propertyValue).forEach((oneBranch) => Object.keys(oneBranch)
									.filter((fieldName) => BRANCH_RECORD_STRUCTURE_FIELD_LIST.indexOf(fieldName) === -1)
									.forEach((fieldName) => {
										if (branchKeywordByPropertyName[fieldName] === undefined) {
											unreadStatementFor({ stableId, propertyName: `${oneName}${oneBranch.locator}/${fieldName}`, propertyValue: oneBranch[fieldName] });
											return;
										}
										statementFor({ schemaName, pointer: `${propertyPointer}${oneBranch.locator}/${branchKeywordByPropertyName[fieldName]}`, jsonValue: oneBranch[fieldName] });
									}));
								return;
							}
							if (VENDOR_PROPERTY_NAME_PATTERN.test(oneName)) {
								vendorStatementsFor({ stableId, schemaName, pointerPrefix: propertyPointer, propertyName: oneName, propertyValue });
								return;
							}
							unreadStatementFor({ stableId, propertyName: oneName, propertyValue });
						});
						return;
					}
					if (role === DME_ROLES.OPTION_SET) {
						if (identity.segmentCount !== 3 || identity.enumSegment !== 'enum' || typeof properties[ENUM_LOCATOR_PROPERTY_NAME] !== 'string') {
							fault = `option set node '${stableId}' does not read as <prefix><Schema>/<property>/enum with an enumLocator`;
						}
						return; // its members are read off its HAS_VALUE edges at its enumLocator; its name is the property's (derived)
					}
					if (role === DME_ROLES.OPTION_VALUE) {
						// ⟪K4a, wave 3 lane H⟫ the id carries the member's ENCODED segment (memberSegmentOf), the name the member verbatim
						if (identity.segmentCount !== 4 || identity.enumSegment !== 'enum' || memberSegmentOf(properties.name) !== identity.memberText) {
							fault = `option value node '${stableId}' does not read as <prefix><Schema>/<property>/enum/<member> named for its member`;
						}
						return;
					}
					fault = `node '${stableId}' has role ${role}, which no source schema maps to`;
				});

				graph.edges.forEach((oneEdge) => {
					const fromNode = nodeById[oneEdge.fromStableId];
					const toNode = nodeById[oneEdge.toStableId];
					if (fromNode === undefined || toNode === undefined) {
						fault = `edge ${oneEdge.type} ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has an endpoint the read did not return`;
						return;
					}
					if (NOT_SOURCE_ROLE_LIST.indexOf(fromNode.role) !== -1 || NOT_SOURCE_ROLE_LIST.indexOf(toNode.role) !== -1) {
						return;
					}
					const edgeReading = `${oneEdge.type}|${fromNode.role}|${toNode.role}`;
					if (edgeReading === `HAS_CLASS|${ROOT_ROLE}|${DME_ROLES.CLASS}`) {
						statements.set(`schema|${identityOf(toNode.stableId).schemaName}||${DECLARED_TEXT}`, {});
						return;
					}
					if (edgeReading === `HAS_PROPERTY|${DME_ROLES.CLASS}|${DME_ROLES.PROPERTY}`) {
						statements.set(`schema|${identityOf(fromNode.stableId).schemaName}|/properties/${escapedPointerSegment(identityOf(toNode.stableId).propertyName)}|${DECLARED_TEXT}`, {});
						return;
					}
					if (edgeReading === `REFERENCES|${DME_ROLES.PROPERTY}|${DME_ROLES.CLASS}`) {
						const { locator, referenceConstruct } = oneEdge.properties;
						if (typeof locator !== 'string' || referenceConstructOfLocator(locator) !== referenceConstruct) {
							fault = `REFERENCES ${oneEdge.fromStableId} -> ${oneEdge.toStableId}: referenceConstruct ${JSON.stringify(referenceConstruct)} does not agree with locator ${JSON.stringify(locator)}`;
							return;
						}
						const { schemaName, propertyName } = identityOf(fromNode.stableId);
						statementFor({ schemaName, pointer: `/properties/${escapedPointerSegment(propertyName)}${locator}`, jsonValue: `${SCHEMA_REFERENCE_PREFIX}${identityOf(toNode.stableId).schemaName}` });
						return;
					}
					if (edgeReading === `HAS_OPTION_SET|${DME_ROLES.PROPERTY}|${DME_ROLES.OPTION_SET}`) {
						return; // read with HAS_VALUE below, which joins through it
					}
					if (edgeReading === `HAS_VALUE|${DME_ROLES.OPTION_SET}|${DME_ROLES.OPTION_VALUE}`) {
						const owningPropertyEdge = graph.edges.find((candidateEdge) => candidateEdge.type === 'HAS_OPTION_SET' && candidateEdge.toStableId === fromNode.stableId);
						if (owningPropertyEdge === undefined) {
							fault = `option set '${fromNode.stableId}' has no owning property (no HAS_OPTION_SET edge reaches it)`;
							return;
						}
						const { schemaName, propertyName } = identityOf(owningPropertyEdge.fromStableId);
						statementFor({ schemaName, pointer: `/properties/${escapedPointerSegment(propertyName)}${fromNode.properties[ENUM_LOCATOR_PROPERTY_NAME]}/${SET_MEMBER_SEGMENT}`, jsonValue: toNode.properties.name });
						return;
					}
					fault = `edge ${oneEdge.type} (${fromNode.role} -> ${toNode.role}) ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has no reading`;
				});
				// the derived referencedSchemaNames of every property equals the distinct targets of its REFERENCES edges (as a set)
				graph.nodes.filter((oneNode) => oneNode.role === DME_ROLES.PROPERTY).forEach((oneNode) => {
					const edgeTargetNameList = graph.edges.filter((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromStableId === oneNode.stableId).map((oneEdge) => identityOf(oneEdge.toStableId).schemaName);
					const carriedText = oneNode.properties[REFERENCED_SCHEMA_NAMES_PROPERTY_NAME];
					const carriedNameList = carriedText === undefined ? [] : `${carriedText}`.split(REFERENCED_SCHEMA_NAMES_SEPARATOR);
					const asSetText = (nameList) => nameList.filter((oneName, nameIndex) => nameList.indexOf(oneName) === nameIndex).sort().join('|');
					if (asSetText(edgeTargetNameList) !== asSetText(carriedNameList)) {
						fault = `property '${oneNode.stableId}' carries ${REFERENCED_SCHEMA_NAMES_PROPERTY_NAME} ${JSON.stringify(carriedText)} but its REFERENCES edges reach ${JSON.stringify(asSetText(edgeTargetNameList))}`;
					}
				});
				if (fault !== undefined) {
					callback('', { fault });
					return;
				}
				callback('', { statements, stats: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, statementCount: statements.size } });
			});
		};

		const omissionDeclaration = Object.freeze({
			rule: ruleModulePath,
			kindPropertyName: OMITTED_KIND_PROPERTY_NAME,
			kindList: Object.freeze(Object.values(OMITTED_KIND)),
			textBearingKindList: Object.freeze([]),
			textPropertyName: '',
			caveatText:
				'outOfScopeByDeclaration is every top-level member of the OpenAPI document other than components (paths, info, servers, tags, openapi, …) and ' +
				'every components member other than schemas (headers, links, securitySchemes, …), one statement per member: the API protocol, not the data model ' +
				'(plan Q-N3; info.version is read as the root\'s selfDescribedVersion and info.description as its description); excludedSchema is each leaf of a ' +
				'schema the bundle\'s profile names in schemaExclusionList; declaredMemberText is each enum member the source types as a number or boolean, which ' +
				'the profile\'s enumMemberTextDeclarationList carries as text (the source is then read as stating that text).',
		});

		const semanticValidationLimit =
			'SEMANTIC round trip of an OpenAPI 3 document\'s components.schemas over the statement domain THIS INSTRUMENT MODELS: every schema and every ' +
			'property declared, and every scalar leaf of every schema at its JSON pointer (type, description, format, pattern, minItems, additionalProperties, ' +
			'vendor x- extensions, items scalars, composition branch scalars, every $ref); required and enum compared as SETS of members. Structure is read back ' +
			'from the edges (HAS_CLASS, HAS_PROPERTY, REFERENCES by locator, HAS_OPTION_SET with HAS_VALUE at the enumLocator) and node properties by the kit\'s ' +
			'keyword registry read backwards; a node property with no reading is an invented statement. EXPLICITLY OMITTED and listed: the document outside ' +
			'components.schemas and any profile-excluded schema. NOT modelled: member ORDER (no meaning in JSON Schema; a branch\'s index is kept in its locator), ' +
			'derived values (name, path, depth, searchText, embed texts) and the root\'s provenance fields (checked by the framework). A vendor extension the ' +
			'profile declares list-valued is compared member by member at its index (its order kept); an enum member declared by enumMemberTextDeclarationList is ' +
			'compared as its declared text.';

		return { canonicalizeSource, emitFromGraph, semanticValidationLimit, omissionDeclaration };
	};

module.exports = moduleFunction({ moduleName });
