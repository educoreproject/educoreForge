'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiWalk.js — the H3 walk of the OpenAPI kit (nextStandards-102326 K0, design ruled by BRONZE_CROWN 2026-10-23). PURE: it
// reads the loader's document and the bundle's profile, and mints through the framework kit only; a refusal is a thrown named
// Error under the framework's one adapter (the pescldWalk.js form).
//
// THE MODEL (identity: openapiIdentity.js):
//   DmeClass        one per components.schemas member not in the profile's schemaExclusionList
//   DmeProperty     one per (schema, property)
//   DmeOptionSet    the ONE enum anywhere in a property's shape (direct, under items, or in a composition branch)
//   DmeOptionValue  one per enum member
// Edges: root HAS_CLASS schema; schema HAS_PROPERTY property; property HAS_OPTION_SET enum; enum HAS_VALUE member; and one
// REFERENCES edge per $ref, property -> the target schema's class, carrying referenceConstruct ($ref | items | oneOf | anyOf |
// allOf) and locator (the JSON pointer of the $ref inside the property). Polymorphism is never flattened: each branch's $ref is
// its own edge, its enum is the option set (enumLocator says where), and its remaining scalars are carried in
// compositionBranches, a JSON string [{ locator, construct, <scalar>... }].
//
// WHAT IS CARRIED is DATA: openapiKeywordRegistry.json says which keyword is carried at which position and under what name. A
// keyword not in its position's table REFUSES BY NAME, which is how schema-level composition, nested composition, an inline
// object and every keyword no standard has needed yet are refused without a branch of their own. Vendor extensions (x-…) are
// one rule, not rows: carried verbatim under the camelCased name (x-class-pid -> xClassPid), strings only.
//
// FBB-001: the forge resolves nothing outside the document. A $ref must be '#/components/schemas/<name>' naming a forged schema;
// anything else refuses (no stub class is synthesised: the pre-reset forge did, which invents nodes).

const path = require('path');
const { DME_ROLES, EDGE_TYPES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { validateOpenapiProfile } = require('./openapiProfileContract');
const openapiIdentity = require('./openapiIdentity');
const keywordRegistry = require('./openapiKeywordRegistry.json');

const LOCAL_SCHEMA_REFERENCE_PATTERN = /^#\/components\/schemas\/([^/]+)$/;
const VENDOR_EXTENSION_NAME_PATTERN = /^x-[a-z0-9]+(-[a-z0-9]+)*$/;
const POSITION = Object.freeze({ SCHEMA: 'schema', PROPERTY: 'property', ITEMS: 'items', BRANCH: 'branch' });
// the referenceConstruct of a $ref found directly at a position (a branch's is its composition keyword)
const REFERENCE_CONSTRUCT_BY_POSITION = Object.freeze({ [POSITION.PROPERTY]: '$ref', [POSITION.ITEMS]: 'items' });
const COMPOSITION_BRANCHES_PROPERTY_NAME = 'compositionBranches';
const ENUM_LOCATOR_PROPERTY_NAME = 'enumLocator';
const REQUIRED_PROPERTY_NAME = 'isRequired';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const VALUE_KIND_CHECK_BY_KIND = Object.freeze({
	string: (candidate) => typeof candidate === 'string',
	boolean: (candidate) => typeof candidate === 'boolean',
	integer: (candidate) => Number.isInteger(candidate),
});

// vendorPropertyNameOf — x-class-pid -> xClassPid (the ONE vendor-extension naming rule)
const vendorPropertyNameOf = (keywordName) => keywordName
	.slice(keywordRegistry.vendorExtensionRule.namePrefix.length)
	.split('-')
	.reduce((soFar, onePart) => `${soFar}${onePart.charAt(0).toUpperCase()}${onePart.slice(1)}`, keywordRegistry.vendorExtensionRule.propertyNamePrefix);

const refusal = (what, where) => refuse.byName({ moduleName, what, where });

const moduleFunction =
	({ moduleName } = {}) =>
	({ openapiProfile }) => {
		validateOpenapiProfile(openapiProfile);
		const { stableIdPrefix, perStandardLabelByRole, schemaExclusionList } = openapiProfile;

		// -----------------------------------------------------------------
		// emitContractGraph — { loaded: the loader's payload, kit } → { nodes, edges, stats }
		// -----------------------------------------------------------------
		const emitContractGraph = ({ loaded, kit }) => {
			const schemaByName = loaded.document.components.schemas;
			const walkStats = {
				schemaCount: 0,
				excludedSchemaCount: 0,
				propertyCount: 0,
				requiredPropertyCount: 0,
				referenceEdgeCount: 0,
				referenceEdgeCountByConstruct: {},
				enumCount: 0,
				enumValueCount: 0,
				compositionBranchCount: 0,
				vendorExtensionCount: 0,
			};

			const unknownExclusion = schemaExclusionList.find((schemaName) => schemaByName[schemaName] === undefined);
			if (unknownExclusion !== undefined) {
				throw refusal(`schemaExclusionList names '${unknownExclusion}', which components.schemas does not hold`, 'an exclusion names a schema the source states');
			}
			const forgedSchemaNameList = Object.keys(schemaByName).filter((schemaName) => schemaExclusionList.indexOf(schemaName) === -1);
			walkStats.excludedSchemaCount = schemaExclusionList.length;

			// carryVendorExtension — one x-… keyword into a node's property map, under the one naming rule
			const carryVendorExtension = ({ keywordName, keywordValue, position, sink, origin }) => {
				if (!VENDOR_EXTENSION_NAME_PATTERN.test(keywordName)) {
					throw refusal(`${origin}: vendor extension '${keywordName}' is not lower-case words joined by hyphens`, 'the camelCase naming rule is invertible only for x-<word>(-<word>)* in lower case, and the round trip reads the name back');
				}
				if (keywordRegistry.vendorExtensionRule.positionList.indexOf(position) === -1) {
					throw refusal(`${origin}: vendor extension '${keywordName}' at position '${position}'`, `vendor extensions are carried at ${keywordRegistry.vendorExtensionRule.positionList.join(', ')} only (openapiKeywordRegistry.json vendorExtensionRule)`);
				}
				if (!VALUE_KIND_CHECK_BY_KIND[keywordRegistry.vendorExtensionRule.valueKind](keywordValue)) {
					throw refusal(`${origin}: vendor extension '${keywordName}' holds ${JSON.stringify(keywordValue)}, not a ${keywordRegistry.vendorExtensionRule.valueKind}`, 'a vendor extension is carried verbatim as a string; any other shape needs its own declared carriage');
				}
				const propertyName = vendorPropertyNameOf(keywordName);
				if (sink[propertyName] !== undefined) {
					throw refusal(`${origin}: vendor extension '${keywordName}' becomes '${propertyName}', which this node already carries`, 'two keywords may not share one node property; rename by a registry row');
				}
				sink[propertyName] = keywordValue;
				walkStats.vendorExtensionCount += 1;
			};

			// visitShape — every keyword of one shape at one position, by the registry; findings land in the accumulator
			const visitShape = ({ shapeObject, position, locator, compositionConstruct, sink, accumulator, origin }) => {
				Object.keys(shapeObject).forEach((keywordName) => {
					const keywordValue = shapeObject[keywordName];
					if (keywordName.startsWith(keywordRegistry.vendorExtensionRule.namePrefix)) {
						carryVendorExtension({ keywordName, keywordValue, position, sink, origin });
						return;
					}
					const carriageRow = keywordRegistry.carriageByPosition[position][keywordName];
					if (carriageRow === undefined) {
						throw refusal(
							`${origin}: keyword '${keywordName}' at ${locator === '' ? 'the top' : `'${locator}'`} (position '${position}') is not carried`,
							`openapiKeywordRegistry.json carriageByPosition.${position} names ${Object.keys(keywordRegistry.carriageByPosition[position]).join(', ')}; a new keyword is a registry row with its twin, never a silent drop`,
						);
					}
					CARRIAGE_HANDLER_BY_NAME[carriageRow.carriage]({ keywordName, keywordValue, carriageRow, position, locator, compositionConstruct, sink, accumulator, origin });
				});
			};

			const CARRIAGE_HANDLER_BY_NAME = {
				nodeProperty: ({ keywordName, keywordValue, carriageRow, locator, sink, origin }) => {
					if (!VALUE_KIND_CHECK_BY_KIND[carriageRow.valueKind](keywordValue)) {
						throw refusal(`${origin}: '${locator}/${keywordName}' holds ${JSON.stringify(keywordValue)}, not a ${carriageRow.valueKind}`, `the registry carries '${keywordName}' here as a ${carriageRow.valueKind}`);
					}
					if (carriageRow.requiredValue !== undefined && keywordValue !== carriageRow.requiredValue) {
						throw refusal(`${origin}: '${locator}/${keywordName}' is ${JSON.stringify(keywordValue)}, not ${JSON.stringify(carriageRow.requiredValue)}`, `the kit models only ${keywordName} ${JSON.stringify(carriageRow.requiredValue)} at this position`);
					}
					if (keywordValue === '') {
						throw refusal(`${origin}: '${locator}/${keywordName}' is the empty string`, 'an empty text is never carried as if it were one; omit it upstream or declare it');
					}
					sink[carriageRow.propertyName] = keywordValue;
				},
				items: ({ keywordValue, locator, sink, accumulator, origin }) => {
					if (!isPlainObject(keywordValue)) {
						throw refusal(`${origin}: '${locator}/items' is not an object`, 'items is one schema object (tuple items are not modelled)');
					}
					visitShape({ shapeObject: keywordValue, position: POSITION.ITEMS, locator: `${locator}/items`, compositionConstruct: undefined, sink, accumulator, origin });
				},
				reference: ({ keywordValue, position, locator, compositionConstruct, accumulator, origin }) => {
					const referenceMatch = typeof keywordValue === 'string' ? keywordValue.match(LOCAL_SCHEMA_REFERENCE_PATTERN) : null;
					if (referenceMatch === null) {
						throw refusal(`${origin}: '${locator}/$ref' is ${JSON.stringify(keywordValue)}, not '#/components/schemas/<name>'`, 'the kit resolves nothing outside the document (FBB-001)');
					}
					if (forgedSchemaNameList.indexOf(referenceMatch[1]) === -1) {
						throw refusal(`${origin}: '${locator}/$ref' names '${referenceMatch[1]}', which is ${schemaByName[referenceMatch[1]] === undefined ? 'not in components.schemas' : 'excluded by the profile'}`, 'a reference names a forged schema; no stub class is synthesised');
					}
					accumulator.referenceList.push({
						locator: `${locator}/$ref`,
						referenceConstruct: compositionConstruct === undefined ? REFERENCE_CONSTRUCT_BY_POSITION[position] : compositionConstruct,
						targetSchemaName: referenceMatch[1],
					});
				},
				enum: ({ keywordValue, locator, accumulator, origin }) => {
					if (!Array.isArray(keywordValue) || keywordValue.length === 0 || !keywordValue.every((oneMember) => typeof oneMember === 'string' && oneMember !== '')) {
						throw refusal(`${origin}: '${locator}/enum' is not a non-empty list of non-empty strings`, 'an enum member becomes an option value named by its text');
					}
					const repeatedMember = keywordValue.find((oneMember, memberIndex) => keywordValue.indexOf(oneMember) !== memberIndex);
					if (repeatedMember !== undefined) {
						throw refusal(`${origin}: '${locator}/enum' lists '${repeatedMember}' twice`, 'no repeat rule is declared for enum members');
					}
					accumulator.enumList.push({ enumLocator: `${locator}/enum`, memberList: keywordValue });
				},
				composition: ({ keywordName, keywordValue, locator, accumulator, origin }) => {
					if (!Array.isArray(keywordValue) || keywordValue.length === 0 || !keywordValue.every(isPlainObject)) {
						throw refusal(`${origin}: '${locator}/${keywordName}' is not a non-empty list of schema objects`, 'a composition is a list of branch schemas');
					}
					keywordValue.forEach((oneBranch, branchIndex) => {
						const branchLocator = `${locator}/${keywordName}/${branchIndex}`;
						if (Object.keys(oneBranch).length === 0) {
							throw refusal(`${origin}: '${branchLocator}' is an empty schema`, 'an empty branch states nothing the graph could carry; it is refused, never dropped');
						}
						const branchScalarSink = {};
						visitShape({ shapeObject: oneBranch, position: POSITION.BRANCH, locator: branchLocator, compositionConstruct: keywordName, sink: branchScalarSink, accumulator, origin });
						if (Object.keys(branchScalarSink).length !== 0) {
							accumulator.branchList.push({ locator: branchLocator, construct: keywordName, ...branchScalarSink });
						}
						walkStats.compositionBranchCount += 1;
					});
				},
				requiredList: () => {
					// read by the schema pass below, which needs the property map to check it against
				},
				propertyMap: () => {
					// walked by the schema pass below, one DmeProperty per member
				},
			};

			// -----------------------------------------------------------------
			// 1. schemas — DmeClass, in source order
			// -----------------------------------------------------------------
			const classByName = {};
			forgedSchemaNameList.forEach((schemaName) => {
				const schemaObject = schemaByName[schemaName];
				const origin = `components.schemas.${schemaName}`;
				if (!isPlainObject(schemaObject)) {
					throw refusal(`${origin} is not an object`, 'a schema is a schema object');
				}
				if (!isPlainObject(schemaObject.properties)) {
					throw refusal(`${origin} has no properties object`, 'the K0 kit models object schemas with properties; another shape is a registry decision');
				}
				const schemaSink = {};
				const schemaAccumulator = { referenceList: [], enumList: [], branchList: [] };
				visitShape({ shapeObject: schemaObject, position: POSITION.SCHEMA, locator: '', compositionConstruct: undefined, sink: schemaSink, accumulator: schemaAccumulator, origin });
				const stableId = openapiIdentity.schemaStableIdOf({ stableIdPrefix, schemaName });
				const { description, ...schemaCarried } = schemaSink;
				kit.makeNode({
					role: DME_ROLES.CLASS,
					perStandardLabel: perStandardLabelByRole[DME_ROLES.CLASS],
					stableId,
					name: schemaName,
					description,
					structural: { parentId: kit.rootStableId, path: schemaName },
					carriedProperties: schemaCarried,
					origin,
				});
				kit.addEdge({ edgeType: EDGE_TYPES.HAS_CLASS, fromStableId: kit.rootStableId, toStableId: stableId, edgeContext: `root->${schemaName}` });
				classByName[schemaName] = { stableId, schemaObject };
				walkStats.schemaCount += 1;
			});

			// -----------------------------------------------------------------
			// 2. properties — DmeProperty, their references and their enum
			// -----------------------------------------------------------------
			forgedSchemaNameList.forEach((schemaName) => {
				const { stableId: classStableId, schemaObject } = classByName[schemaName];
				const propertyNameList = Object.keys(schemaObject.properties);
				const requiredNameList = schemaObject.required === undefined ? [] : schemaObject.required;
				if (schemaObject.required !== undefined) {
					if (!Array.isArray(requiredNameList) || requiredNameList.length === 0 || !requiredNameList.every((oneName) => typeof oneName === 'string')) {
						throw refusal(`components.schemas.${schemaName}.required is not a non-empty list of names`, 'OpenAPI 3.0 required is a non-empty string list (an empty one would be lost: absent and [] read back alike)');
					}
					const strayName = requiredNameList.find((oneName) => propertyNameList.indexOf(oneName) === -1);
					if (strayName !== undefined) {
						throw refusal(`components.schemas.${schemaName}.required names '${strayName}', which its properties do not hold`, 'isRequired is carried on the property node, so a required name needs its property');
					}
					const repeatedName = requiredNameList.find((oneName, nameIndex) => requiredNameList.indexOf(oneName) !== nameIndex);
					if (repeatedName !== undefined) {
						throw refusal(`components.schemas.${schemaName}.required lists '${repeatedName}' twice`, 'no repeat rule is declared for required');
					}
				}

				propertyNameList.forEach((propertyName) => {
					const shapeObject = schemaObject.properties[propertyName];
					const origin = `components.schemas.${schemaName}.properties.${propertyName}`;
					if (!isPlainObject(shapeObject)) {
						throw refusal(`${origin} is not an object`, 'a property is a schema object');
					}
					const propertySink = {};
					const accumulator = { referenceList: [], enumList: [], branchList: [] };
					visitShape({ shapeObject, position: POSITION.PROPERTY, locator: '', compositionConstruct: undefined, sink: propertySink, accumulator, origin });
					if (accumulator.enumList.length > 1) {
						throw refusal(`${origin} states ${accumulator.enumList.length} enums (${accumulator.enumList.map((oneEnum) => oneEnum.enumLocator).join(', ')})`, 'a property owns ONE option set; two would need a second identity rule');
					}
					const isRequired = requiredNameList.indexOf(propertyName) !== -1;
					const stableId = openapiIdentity.propertyStableIdOf({ stableIdPrefix, schemaName, propertyName });
					const { description, ...propertyCarried } = propertySink;
					kit.makeNode({
						role: DME_ROLES.PROPERTY,
						perStandardLabel: perStandardLabelByRole[DME_ROLES.PROPERTY],
						stableId,
						name: propertyName,
						description,
						structural: { parentId: classStableId, path: `${schemaName}.${propertyName}`, owningName: schemaName },
						carriedProperties: {
							...propertyCarried,
							[REQUIRED_PROPERTY_NAME]: isRequired,
							// a JSON string, not a list: a one-entry list would be read back as a scalar (graph-contract §1)
							...(accumulator.branchList.length === 0 ? {} : { [COMPOSITION_BRANCHES_PROPERTY_NAME]: JSON.stringify(accumulator.branchList) }),
						},
						origin,
					});
					kit.addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: classStableId, toStableId: stableId, edgeContext: `${schemaName}->${propertyName}` });
					walkStats.propertyCount += 1;
					walkStats.requiredPropertyCount += isRequired ? 1 : 0;

					accumulator.referenceList.forEach((oneReference) => {
						kit.addEdge({
							edgeType: EDGE_TYPES.REFERENCES,
							fromStableId: stableId,
							toStableId: classByName[oneReference.targetSchemaName].stableId,
							edgeContext: `${oneReference.locator}:${schemaName}.${propertyName}->${oneReference.targetSchemaName}`,
							edgeProperties: { referenceConstruct: oneReference.referenceConstruct, locator: oneReference.locator },
						});
						walkStats.referenceEdgeCount += 1;
						walkStats.referenceEdgeCountByConstruct[oneReference.referenceConstruct] = (walkStats.referenceEdgeCountByConstruct[oneReference.referenceConstruct] || 0) + 1;
					});

					accumulator.enumList.forEach((oneEnum) => {
						const enumStableId = openapiIdentity.enumStableIdOf({ stableIdPrefix, schemaName, propertyName });
						kit.makeNode({
							role: DME_ROLES.OPTION_SET,
							perStandardLabel: perStandardLabelByRole[DME_ROLES.OPTION_SET],
							stableId: enumStableId,
							// an enum has no name of its own in the source; it is the enum OF this property, so it takes the property's name
							name: propertyName,
							structural: { parentId: stableId, path: `${schemaName}.${propertyName}.enum`, owningName: schemaName },
							carriedProperties: { [ENUM_LOCATOR_PROPERTY_NAME]: oneEnum.enumLocator },
							origin,
						});
						kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: stableId, toStableId: enumStableId, edgeContext: `${schemaName}.${propertyName}->enum` });
						walkStats.enumCount += 1;
						oneEnum.memberList.forEach((memberText) => {
							kit.emitOptionValue({
								optionSetStableId: enumStableId,
								optionValueStableId: openapiIdentity.enumValueStableIdOf({ stableIdPrefix, schemaName, propertyName, memberText }),
								perStandardLabel: perStandardLabelByRole[DME_ROLES.OPTION_VALUE],
								name: memberText,
								path: `${schemaName}.${propertyName}.enum.${memberText}`,
								owningName: propertyName,
								origin,
							});
							walkStats.enumValueCount += 1;
						});
					});
				});
			});

			Object.keys(walkStats).forEach((statName) => {
				kit.stats[statName] = walkStats[statName];
			});
			return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
		};

		return { emitContractGraph };
	};

module.exports = moduleFunction({ moduleName });
