'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiDereferencedRoundTripPair.js — H4 for the OpenAPI kit's dereferencedMultiFile layout (nextStandards-102326 K1). A SOURCE-side
// canonicalizer and a GRAPH-side emitter held apart on purpose (the K0 pair's form). Both produce the COMPRESSED form of every component:
// the component's JSON in which each SITE (a property's shape, an items shape, a composition branch, a definitions entry) that is a copy
// of exactly one component is replaced by { $match: <that component's name> } plus the site's own description. The canonicalizer computes
// that by itself, with ITS OWN canonical-JSON and digest functions (deliberately not the walk's, so a defect in one is not hidden by the
// other); the emitter rebuilds it from the graph (REFERENCES edges by locator, node properties by the dereferenced registry read
// backwards). Every leaf of the compressed form is a statement, and every value is part of its key:
//   file|<file>|schema|<C>                       a component in a file (graph: the component's bundleMembership)
//   schema|<C>||declared                         a component (graph: the root's HAS_CLASS or HAS_OPTION_SET edge)
//   schema|<C>|<pointer>|declared                a property site (graph: the HAS_PROPERTY edge)
//   schema|<C>|<pointer>|<JSON scalar>           a scalar leaf at its JSON pointer
//   schema|<C>|<site>/$match|"<name>"            a recovered reference (graph: a REFERENCES edge to a component)
//   schema|<C>|<object>/enum/*|<member>          an enum member, compared as a set (required likewise)
//   schema|<C>|<object>/enumNames@<member>|<name>  an enumNames entry, keyed by the member it names (the two lists are aligned)
// A copy that is a reference states nothing of its body: the body is the component's, stated once under that component.
// EXPLICITLY OMITTED, per file: every top-level member other than components and every components member other than schemas (the API
// around the data model, plan Q-N3), and each leaf of a profile-excluded component.
// A node property the emitter has no reading for is an `unread|…` statement, so an invented property counts as invented.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DME_ROLES, EQUIVALENCE_NODE_LABELS } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const { validateOpenapiProfile, SOURCE_LAYOUT } = require('./openapiProfileContract');
const keywordRegistry = require('./openapiDereferencedKeywordRegistry.json');

const SET_VALUED_KEYWORD_LIST = Object.freeze(['required', 'enum']);
const ALIGNED_KEYWORD = Object.freeze({ NAMES: 'enumNames', MEMBERS: 'enum' });
const SET_MEMBER_SEGMENT = '*';
const MATCH_KEYWORD = '$match';
const DECLARED_TEXT = 'declared';
const ROOT_ROLE = DME_ROLES.STANDARD_ROOT;
const NOT_SOURCE_ROLE_LIST = Object.freeze([DME_ROLES.EMBED_TEXT, EQUIVALENCE_NODE_LABELS.HUB_REFERENCE, EQUIVALENCE_NODE_LABELS.HUB_DEFINITION]);
// the properties the framework derives or stamps, and those the walk derives (checked or read structurally here, never a statement)
const DERIVED_PROPERTY_NAME_LIST = Object.freeze(['_id', '_source', 'stableId', 'role', 'name', 'searchText', 'parentId', 'path', 'depth', 'crossRefs', 'embedding', 'embeddingModelVersion', 'referencedSchemaNames', 'siteRootSchemaName', 'sitePointer']);
const COMPOSITION_BRANCHES_PROPERTY_NAME = 'compositionBranches';
const MATCHED_SITE_DESCRIPTIONS_PROPERTY_NAME = 'matchedSiteDescriptions';
const REQUIRED_FROM_COMPOSITION_PROPERTY_NAME = 'requiredNamesFromComposition';
const ENUM_LOCATOR_PROPERTY_NAME = 'enumLocator';
const ENUM_NAME_PROPERTY_NAME = 'enumName';
const REQUIRED_PROPERTY_NAME = 'isRequired';
const BUNDLE_MEMBERSHIP_PROPERTY_NAME = 'bundleMembership';
const SITE_ROOT_SCHEMA_NAME_PROPERTY_NAME = 'siteRootSchemaName';
const SITE_POINTER_PROPERTY_NAME = 'sitePointer';
const BRANCH_RECORD_STRUCTURE_FIELD_LIST = Object.freeze(['locator', 'construct']);
const STRUCTURALLY_READ_PROPERTY_NAME_LIST = Object.freeze([COMPOSITION_BRANCHES_PROPERTY_NAME, MATCHED_SITE_DESCRIPTIONS_PROPERTY_NAME, REQUIRED_FROM_COMPOSITION_PROPERTY_NAME, ENUM_LOCATOR_PROPERTY_NAME, ENUM_NAME_PROPERTY_NAME, REQUIRED_PROPERTY_NAME, BUNDLE_MEMBERSHIP_PROPERTY_NAME]);

const OMITTED_KIND = Object.freeze({ OUT_OF_SCOPE_BY_DECLARATION: 'outOfScopeByDeclaration', EXCLUDED_SCHEMA: 'excludedSchema' });
const OMITTED_KIND_PROPERTY_NAME = 'omittedKind';
const omitted = (kind) => ({ explicitlyOmitted: true, [OMITTED_KIND_PROPERTY_NAME]: kind });

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const escapedPointerSegment = (segmentText) => `${segmentText}`.replace(/~/g, '~0').replace(/\//g, '~1');
// sortedJsonText — this instrument's own canonical JSON (sorted members at every depth); NOT the walk's function
const sortedJsonText = (jsonValue) => (Array.isArray(jsonValue)
	? `[${jsonValue.map(sortedJsonText).join(',')}]`
	: isPlainObject(jsonValue)
		? `{${Object.keys(jsonValue).sort().map((memberName) => `${JSON.stringify(memberName)}:${sortedJsonText(jsonValue[memberName])}`).join(',')}}`
		: JSON.stringify(jsonValue));
const bodyDigestOf = (shapeObject) => crypto.createHash('sha256').update(sortedJsonText(Object.fromEntries(Object.entries(shapeObject).filter(([memberName]) => memberName !== 'description')))).digest('hex');

// propertyNameByKeywordAt — the registry read backwards for one position: node property name -> keyword (nodeProperty and jsonText rows)
const keywordByPropertyNameAt = (position) => Object.keys(keywordRegistry.carriageByPosition[position])
	.filter((keywordName) => ['nodeProperty', 'jsonText'].indexOf(keywordRegistry.carriageByPosition[position][keywordName].carriage) !== -1)
	.reduce((byName, keywordName) => ({ ...byName, [keywordRegistry.carriageByPosition[position][keywordName].propertyName]: keywordName }), {});
const isJsonTextKeyword = (position, keywordName) => keywordRegistry.carriageByPosition[position][keywordName].carriage === 'jsonText';

const moduleFunction =
	({ moduleName } = {}) =>
	({ openapiProfile, stableUriPropertyName, ruleModulePath }) => {
		validateOpenapiProfile(openapiProfile);
		if (openapiProfile.sourceLayout !== SOURCE_LAYOUT.DEREFERENCED_MULTI_FILE) {
			throw new Error(`${moduleName} REFUSED: the profile's sourceLayout is '${openapiProfile.sourceLayout}' — this pair reads '${SOURCE_LAYOUT.DEREFERENCED_MULTI_FILE}' only`);
		}
		const { stableIdPrefix, sourceFileNameList, schemaExclusionList } = openapiProfile;
		const keywordByPropertyNameByPosition = Object.keys(keywordRegistry.carriageByPosition).reduce((byPosition, position) => ({ ...byPosition, [position]: keywordByPropertyNameAt(position) }), {});
		const ignoredPropertyNameList = DERIVED_PROPERTY_NAME_LIST.concat([stableUriPropertyName]);
		const compositionConstructList = keywordRegistry.compositionConstructList;

		// -----------------------------------------------------------------
		// canonicalizeSource — the snapshot's files → statements (never the graph)
		// -----------------------------------------------------------------
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			const statements = new Map();
			const componentByName = {};
			let fault = '';
			sourceFileNameList.forEach((sourceFileName) => {
				const sourceFilePath = path.join(snapshotPath, sourceFileName);
				let document;
				try {
					document = JSON.parse(fs.readFileSync(sourceFilePath, 'utf8'));
				} catch (parseError) {
					// localized parse boundary (house-sanctioned): the refusal, not the throw, is the flow
					fault = fault || `${moduleName} REFUSED: '${sourceFilePath}' is not parseable JSON (${parseError.message})`;
					return;
				}
				if (!isPlainObject(document) || !isPlainObject(document.components) || !isPlainObject(document.components.schemas)) {
					fault = fault || `${moduleName} REFUSED: '${sourceFilePath}' has no components.schemas object`;
					return;
				}
				Object.keys(document).filter((memberName) => memberName !== 'components').forEach((memberName) => statements.set(`outOfScope|${sourceFileName}|/${escapedPointerSegment(memberName)}`, omitted(OMITTED_KIND.OUT_OF_SCOPE_BY_DECLARATION)));
				Object.keys(document.components).filter((memberName) => memberName !== 'schemas').forEach((memberName) => Object.keys(document.components[memberName]).forEach((entryName) => {
					statements.set(`outOfScope|${sourceFileName}|/components/${escapedPointerSegment(memberName)}/${escapedPointerSegment(entryName)}`, omitted(OMITTED_KIND.OUT_OF_SCOPE_BY_DECLARATION));
				}));
				Object.keys(document.components.schemas).forEach((schemaName) => {
					const isExcluded = schemaExclusionList.indexOf(schemaName) !== -1;
					statements.set(`file|${sourceFileName}|schema|${schemaName}`, isExcluded ? omitted(OMITTED_KIND.EXCLUDED_SCHEMA) : {});
					componentByName[schemaName] = document.components.schemas[schemaName];
				});
			});
			if (fault !== '') {
				callback(fault);
				return;
			}
			const indexedNameList = Object.keys(componentByName).filter((schemaName) => schemaExclusionList.indexOf(schemaName) === -1);
			const nameListByBodyDigest = indexedNameList.reduce((byDigest, schemaName) => {
				const digest = bodyDigestOf(componentByName[schemaName]);
				return { ...byDigest, [digest]: (byDigest[digest] || []).concat([schemaName]) };
			}, {});
			// matchOf — the one component a site's body equals; a tie only by name = title (anything else is the walk's refusal)
			const matchOf = (siteObject) => {
				const candidateNameList = nameListByBodyDigest[bodyDigestOf(siteObject)] || [];
				if (candidateNameList.length <= 1) {
					return candidateNameList[0];
				}
				const titledNameList = candidateNameList.filter((schemaName) => schemaName === siteObject.title);
				return titledNameList.length === 1 ? titledNameList[0] : undefined;
			};
			// compressedSiteOf / compressedObjectOf — the compressed form: matched sites replaced, everything else kept
			const compressedSiteOf = (siteValue) => {
				if (!isPlainObject(siteValue)) {
					return siteValue;
				}
				const matchedName = matchOf(siteValue);
				if (matchedName !== undefined) {
					return { [MATCH_KEYWORD]: matchedName, ...(siteValue.description === undefined ? {} : { description: siteValue.description }) };
				}
				return compressedObjectOf(siteValue);
			};
			const compressedObjectOf = (objectValue) => Object.keys(objectValue).reduce((compressed, memberName) => {
				const memberValue = objectValue[memberName];
				if ((memberName === 'properties' || memberName === 'definitions') && isPlainObject(memberValue)) {
					return { ...compressed, [memberName]: Object.keys(memberValue).reduce((siteMap, siteName) => ({ ...siteMap, [siteName]: compressedSiteOf(memberValue[siteName]) }), {}) };
				}
				if (memberName === 'items') {
					return { ...compressed, items: compressedSiteOf(memberValue) };
				}
				if (compositionConstructList.indexOf(memberName) !== -1 && Array.isArray(memberValue)) {
					return { ...compressed, [memberName]: memberValue.map(compressedSiteOf) };
				}
				return { ...compressed, [memberName]: memberValue };
			}, {});
			// leafStatements — every leaf of a compressed object; sets by member, enumNames keyed by the member each names
			const leafStatementsOf = ({ schemaName, jsonValue, pointer, statementOf }) => {
				if (isPlainObject(jsonValue)) {
					if (isPlainObject(jsonValue.properties)) {
						Object.keys(jsonValue.properties).forEach((propertyName) => statements.set(`schema|${schemaName}|${pointer}/properties/${escapedPointerSegment(propertyName)}|${DECLARED_TEXT}`, statementOf()));
					}
					Object.keys(jsonValue).forEach((memberName) => {
						const memberValue = jsonValue[memberName];
						if (memberName === ALIGNED_KEYWORD.NAMES && Array.isArray(memberValue) && Array.isArray(jsonValue[ALIGNED_KEYWORD.MEMBERS])) {
							memberValue.forEach((nameText, nameIndex) => statements.set(`schema|${schemaName}|${pointer}/${ALIGNED_KEYWORD.NAMES}@${JSON.stringify(jsonValue[ALIGNED_KEYWORD.MEMBERS][nameIndex])}|${JSON.stringify(nameText)}`, statementOf()));
							return;
						}
						leafStatementsOf({ schemaName, jsonValue: memberValue, pointer: `${pointer}/${escapedPointerSegment(memberName)}`, statementOf });
					});
					return;
				}
				if (Array.isArray(jsonValue)) {
					const isSetValued = SET_VALUED_KEYWORD_LIST.indexOf(pointer.split('/').pop()) !== -1;
					jsonValue.forEach((oneMember, memberIndex) => leafStatementsOf({ schemaName, jsonValue: oneMember, pointer: `${pointer}/${isSetValued ? SET_MEMBER_SEGMENT : memberIndex}`, statementOf }));
					return;
				}
				statements.set(`schema|${schemaName}|${pointer}|${JSON.stringify(jsonValue)}`, statementOf());
			};
			Object.keys(componentByName).forEach((schemaName) => {
				const statementOf = () => (schemaExclusionList.indexOf(schemaName) !== -1 ? omitted(OMITTED_KIND.EXCLUDED_SCHEMA) : {});
				statements.set(`schema|${schemaName}||${DECLARED_TEXT}`, statementOf());
				leafStatementsOf({ schemaName, jsonValue: compressedObjectOf(componentByName[schemaName]), pointer: '', statementOf });
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
				const outgoingEdgeListById = graph.edges.reduce((byId, oneEdge) => ({ ...byId, [oneEdge.fromStableId]: (byId[oneEdge.fromStableId] || []).concat([oneEdge]) }), {});
				const incomingEdgeListById = graph.edges.reduce((byId, oneEdge) => ({ ...byId, [oneEdge.toStableId]: (byId[oneEdge.toStableId] || []).concat([oneEdge]) }), {});
				let fault;
				const statementFor = ({ schemaName, pointer, jsonValue }) => statements.set(`schema|${schemaName}|${pointer}|${JSON.stringify(jsonValue)}`, {});
				const unreadStatementFor = ({ stableId, propertyName, propertyValue }) => statements.set(`unread|${stableId}|${propertyName}|${JSON.stringify(propertyValue)}`, {});
				const isComponentNode = (oneNode) => oneNode.properties[BUNDLE_MEMBERSHIP_PROPERTY_NAME] !== undefined;
				const isInlineClassNode = (oneNode) => oneNode.role === DME_ROLES.CLASS && oneNode.properties[SITE_POINTER_PROPERTY_NAME] !== undefined;
				// placeOf — { schemaName, pointer } of an object node in its component's compressed form (components at '')
				const placeOf = (oneNode) => (isInlineClassNode(oneNode)
					? { schemaName: oneNode.properties[SITE_ROOT_SCHEMA_NAME_PROPERTY_NAME], pointer: oneNode.properties[SITE_POINTER_PROPERTY_NAME] }
					: { schemaName: oneNode.properties.name, pointer: '' });
				// propertyPlaceOf — a property node's place: its owner's place + /properties/<name>
				const propertyPlaceOf = (propertyNode) => {
					const ownerEdge = (incomingEdgeListById[propertyNode.stableId] || []).find((oneEdge) => oneEdge.type === 'HAS_PROPERTY');
					if (ownerEdge === undefined) {
						return undefined;
					}
					const ownerPlace = placeOf(nodeById[ownerEdge.fromStableId]);
					return { schemaName: ownerPlace.schemaName, ownerPointer: ownerPlace.pointer, pointer: `${ownerPlace.pointer}/properties/${escapedPointerSegment(propertyNode.properties.name)}` };
				};
				// scalarStatements — a node's registry-carried properties at its place, by one position's table (and items', when given)
				const scalarStatements = ({ oneNode, schemaName, pointer, positionList }) => {
					Object.keys(oneNode.properties).filter((propertyName) => ignoredPropertyNameList.indexOf(propertyName) === -1 && STRUCTURALLY_READ_PROPERTY_NAME_LIST.indexOf(propertyName) === -1).forEach((propertyName) => {
						const propertyValue = oneNode.properties[propertyName];
						const readingPosition = positionList.find((onePosition) => keywordByPropertyNameByPosition[onePosition.position][propertyName] !== undefined);
						if (readingPosition === undefined) {
							unreadStatementFor({ stableId: oneNode.stableId, propertyName, propertyValue });
							return;
						}
						const keywordName = keywordByPropertyNameByPosition[readingPosition.position][propertyName];
						const jsonValue = isJsonTextKeyword(readingPosition.position, keywordName) ? JSON.parse(propertyValue) : propertyValue;
						const leafPointerBase = `${pointer}${readingPosition.pointerSuffix}/${escapedPointerSegment(keywordName)}`;
						// a jsonText value is a JSON tree: its leaves are statements as the canonicalizer's are
						const emitLeaves = (leafValue, leafPointer) => {
							if (isPlainObject(leafValue)) {
								Object.keys(leafValue).forEach((memberName) => emitLeaves(leafValue[memberName], `${leafPointer}/${escapedPointerSegment(memberName)}`));
								return;
							}
							if (Array.isArray(leafValue)) {
								leafValue.forEach((oneMember, memberIndex) => emitLeaves(oneMember, `${leafPointer}/${memberIndex}`));
								return;
							}
							statementFor({ schemaName, pointer: leafPointer, jsonValue: leafValue });
						};
						emitLeaves(jsonValue, leafPointerBase);
					});
				};

				graph.nodes.forEach((oneNode) => {
					const { stableId, role, properties } = oneNode;
					if (role === ROOT_ROLE || NOT_SOURCE_ROLE_LIST.indexOf(role) !== -1 || !stableId.startsWith(stableIdPrefix)) {
						if (role !== ROOT_ROLE && NOT_SOURCE_ROLE_LIST.indexOf(role) === -1) {
							fault = `node '${stableId}' is not under the profile's prefix '${stableIdPrefix}'`;
						}
						return;
					}
					if (role === DME_ROLES.CLASS) {
						const { schemaName, pointer } = placeOf(oneNode);
						if (isComponentNode(oneNode)) {
							JSON.parse(properties[BUNDLE_MEMBERSHIP_PROPERTY_NAME]).forEach((sourceFileName) => statements.set(`file|${sourceFileName}|schema|${schemaName}`, {}));
						}
						scalarStatements({ oneNode, schemaName, pointer, positionList: [{ position: 'class', pointerSuffix: '' }, { position: 'items', pointerSuffix: '/items' }] });
						if (properties[REQUIRED_FROM_COMPOSITION_PROPERTY_NAME] !== undefined) {
							JSON.parse(properties[REQUIRED_FROM_COMPOSITION_PROPERTY_NAME]).forEach((requiredName) => statementFor({ schemaName, pointer: `${pointer}/required/${SET_MEMBER_SEGMENT}`, jsonValue: requiredName }));
						}
						if (properties[MATCHED_SITE_DESCRIPTIONS_PROPERTY_NAME] !== undefined) {
							JSON.parse(properties[MATCHED_SITE_DESCRIPTIONS_PROPERTY_NAME]).forEach((oneSite) => statementFor({ schemaName, pointer: `${pointer}${oneSite.locator}/description`, jsonValue: oneSite.description }));
						}
						if (properties[COMPOSITION_BRANCHES_PROPERTY_NAME] !== undefined) {
							JSON.parse(properties[COMPOSITION_BRANCHES_PROPERTY_NAME]).forEach((oneBranch) => Object.keys(oneBranch).filter((fieldName) => BRANCH_RECORD_STRUCTURE_FIELD_LIST.indexOf(fieldName) === -1).forEach((fieldName) => {
								const keywordName = keywordByPropertyNameByPosition.branch[fieldName];
								if (keywordName === undefined) {
									unreadStatementFor({ stableId, propertyName: `${COMPOSITION_BRANCHES_PROPERTY_NAME}${oneBranch.locator}/${fieldName}`, propertyValue: oneBranch[fieldName] });
									return;
								}
								statementFor({ schemaName, pointer: `${pointer}${oneBranch.locator}/${escapedPointerSegment(keywordName)}`, jsonValue: oneBranch[fieldName] });
							}));
						}
						return;
					}
					if (role === DME_ROLES.PROPERTY) {
						const place = propertyPlaceOf(oneNode);
						if (place === undefined) {
							fault = `property '${stableId}' has no owner (no HAS_PROPERTY edge reaches it)`;
							return;
						}
						statements.set(`schema|${place.schemaName}|${place.pointer}|${DECLARED_TEXT}`, {});
						if (properties[REQUIRED_PROPERTY_NAME] === true) {
							statementFor({ schemaName: place.schemaName, pointer: `${place.ownerPointer}/required/${SET_MEMBER_SEGMENT}`, jsonValue: properties.name });
						}
						scalarStatements({ oneNode, schemaName: place.schemaName, pointer: place.pointer, positionList: [{ position: 'site', pointerSuffix: '' }, { position: 'items', pointerSuffix: '/items' }] });
						return;
					}
					if (role === DME_ROLES.OPTION_SET) {
						if (isComponentNode(oneNode)) {
							JSON.parse(properties[BUNDLE_MEMBERSHIP_PROPERTY_NAME]).forEach((sourceFileName) => statements.set(`file|${sourceFileName}|schema|${properties.name}`, {}));
							scalarStatements({ oneNode, schemaName: properties.name, pointer: '', positionList: [{ position: 'codeList', pointerSuffix: '' }] });
						}
						return; // members are read off HAS_VALUE below, at the set's place
					}
					if (role === DME_ROLES.OPTION_VALUE) {
						return; // read with its set's HAS_VALUE edge
					}
					fault = `node '${stableId}' has role ${role}, which no source schema maps to`;
				});

				// optionSetPlaceOf — { schemaName, objectPointer } of the object an option set's enum sits in
				const optionSetPlaceOf = (optionSetNode) => {
					if (isComponentNode(optionSetNode)) {
						return { schemaName: optionSetNode.properties.name, objectPointer: '' };
					}
					const ownerEdge = (incomingEdgeListById[optionSetNode.stableId] || []).find((oneEdge) => oneEdge.type === 'HAS_OPTION_SET');
					const place = ownerEdge === undefined ? undefined : propertyPlaceOf(nodeById[ownerEdge.fromStableId]);
					if (place === undefined) {
						return undefined;
					}
					const enumLocator = optionSetNode.properties[ENUM_LOCATOR_PROPERTY_NAME];
					return { schemaName: place.schemaName, objectPointer: `${place.pointer}${enumLocator.slice(0, enumLocator.length - '/enum'.length)}` };
				};

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
					if (oneEdge.type === 'HAS_CLASS' && fromNode.role === ROOT_ROLE) {
						statements.set(`schema|${toNode.properties.name}||${DECLARED_TEXT}`, {});
						return;
					}
					if (oneEdge.type === 'HAS_OPTION_SET' && fromNode.role === ROOT_ROLE) {
						statements.set(`schema|${toNode.properties.name}||${DECLARED_TEXT}`, {});
						return;
					}
					if (oneEdge.type === 'HAS_PROPERTY' || (oneEdge.type === 'HAS_OPTION_SET' && fromNode.role === DME_ROLES.PROPERTY)) {
						return; // read with the node (property) and with HAS_VALUE (option set)
					}
					if (oneEdge.type === 'HAS_VALUE') {
						const setPlace = optionSetPlaceOf(fromNode);
						if (setPlace === undefined) {
							fault = `option set '${fromNode.stableId}' has no place (no owner reaches it)`;
							return;
						}
						statementFor({ schemaName: setPlace.schemaName, pointer: `${setPlace.objectPointer}/enum/${SET_MEMBER_SEGMENT}`, jsonValue: toNode.properties.name });
						if (toNode.properties[ENUM_NAME_PROPERTY_NAME] !== undefined) {
							statements.set(`schema|${setPlace.schemaName}|${setPlace.objectPointer}/${ALIGNED_KEYWORD.NAMES}@${JSON.stringify(toNode.properties.name)}|${JSON.stringify(toNode.properties[ENUM_NAME_PROPERTY_NAME])}`, {});
						}
						return;
					}
					if (oneEdge.type === 'REFERENCES') {
						const { locator } = oneEdge.properties;
						const ownerPlace = fromNode.role === DME_ROLES.PROPERTY ? propertyPlaceOf(fromNode) : placeOf(fromNode);
						if (ownerPlace === undefined || typeof locator !== 'string') {
							fault = `REFERENCES ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has no place or no locator`;
							return;
						}
						const sitePointer = `${ownerPlace.pointer}${locator}`;
						if (isInlineClassNode(toNode)) {
							if (toNode.properties[SITE_POINTER_PROPERTY_NAME] !== sitePointer || toNode.properties[SITE_ROOT_SCHEMA_NAME_PROPERTY_NAME] !== ownerPlace.schemaName) {
								fault = `inline class '${toNode.stableId}' says it sits at ${toNode.properties[SITE_ROOT_SCHEMA_NAME_PROPERTY_NAME]}${toNode.properties[SITE_POINTER_PROPERTY_NAME]}, its REFERENCES edge says ${ownerPlace.schemaName}${sitePointer}`;
							}
							return; // its content is stated by its own node, at its place
						}
						statementFor({ schemaName: ownerPlace.schemaName, pointer: `${sitePointer}/${MATCH_KEYWORD}`, jsonValue: toNode.properties.name });
						return;
					}
					fault = `edge ${oneEdge.type} (${fromNode.role} -> ${toNode.role}) ${oneEdge.fromStableId} -> ${oneEdge.toStableId} has no reading`;
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
				'outOfScopeByDeclaration is, in EACH file, every top-level member other than components (paths, info, servers, tags, externalDocs, openapi) and every ' +
				'components member other than schemas (responses, parameters, headers, requestBodies, …), one statement per member: the API around the data model ' +
				'(plan Q-N3). excludedSchema is each leaf of a component the profile excludes.',
		});

		const semanticValidationLimit =
			'SEMANTIC round trip of a dereferenced OpenAPI data model (one or more files, every reference inlined) over its COMPRESSED form: each component once, ' +
			'with every site that is a copy of exactly one component (by content, its top description aside) replaced by that component\'s name and the site\'s own ' +
			'description; every other leaf at its JSON pointer; enum and required compared as sets; enumNames keyed by the member each names; each component\'s files. ' +
			'The body of a copy is not restated at its site: it is stated once, under its component. Structure is read back from the edges and node properties by ' +
			'the dereferenced keyword registry read backwards; a node property with no reading is invented. EXPLICITLY OMITTED and listed: each file outside ' +
			'components.schemas and any profile-excluded component. NOT modelled: member order, and derived values (names of untitled inline objects, path, ' +
			'depth, searchText, embed texts, referencedSchemaNames).';

		return { canonicalizeSource, emitFromGraph, semanticValidationLimit, omissionDeclaration };
	};

module.exports = moduleFunction({ moduleName });
