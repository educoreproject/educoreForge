'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sedmStructuresWalk.js — the SEDM domain structures (sedm-domain-structures.json) as DmeSupport nodes, and its declared code lists
// (nextStandards-102326 wave 2, lane G; BRONZE_CROWN ruling 5). PURE: it reads the loader's parsed object and sedmStructuresProfile.json
// and mints through the kit only; a refusal is a thrown named Error under the framework's one adapter.
//
//   emitSupportNodes      every section row of the profile: one DmeSupport per item (HAS_SUPPORT from the root), one per sub-item
//                         (REFERENCES sub -> item, the row's locator), and a REFERENCES edge per reference field to the support node
//                         it names. Returns the stableId of every support node by (kind, identity), for the element walk's ETL edges.
//   emitDeclaredOptionSets  the code-list section. A list naming the element it restates (the profile's restatedElementNameFieldName)
//                         must EQUAL that element's inline option set, code for code and name for name, and is then not minted (the
//                         element owns the set; counted); a list naming no element is a DmeOptionSet owned by the root.
//
// Carried verbatim, field by field, under the profile's property names; a field the profile does not list for its section is refused,
// as is a top-level section the profile neither reads nor omits. Lists and objects are JSON strings (graph-contract §1: a one-entry
// list would read back as a scalar).

const path = require('path');
const { DME_ROLES, EDGE_TYPES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
const structuresProfile = require('./sedmStructuresProfile.json');
const sourceProfile = require('./sedmSourceProfile.json');
const sedmIdentity = require('./sedmIdentity');

const DECLARED_OPTION_SET_LABEL = 'SedmOptionSet';
const DECLARED_OPTION_VALUE_LABEL = 'SedmOptionValue';

const refusal = (what, where) => refuse.byName({ moduleName, what, where });
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

// the carried form of one field value, refused when the value is not of the form the profile declares
const CARRIED_FORM_REGISTRY = Object.freeze({
	text: (fieldValue) => (typeof fieldValue === 'string' ? { carriedValue: fieldValue } : { formFault: 'not a string' }),
	number: (fieldValue) => (Number.isFinite(fieldValue) ? { carriedValue: fieldValue } : { formFault: 'not a number' }),
	boolean: (fieldValue) => (typeof fieldValue === 'boolean' ? { carriedValue: fieldValue } : { formFault: 'not a boolean' }),
	jsonList: (fieldValue) => (Array.isArray(fieldValue) ? { carriedValue: JSON.stringify(fieldValue) } : { formFault: 'not a list' }),
	jsonObject: (fieldValue) => (isPlainObject(fieldValue) ? { carriedValue: JSON.stringify(fieldValue) } : { formFault: 'not an object' }),
});

// valueAtPath — the value at a list of member names, or undefined
const valueAtPath = ({ structures, pathList }) => pathList.reduce((soFar, memberName) => (isPlainObject(soFar) ? soFar[memberName] : undefined), structures);

// identityTextOf — an identity field's value as id text: a non-empty string, or an integer
const identityTextOf = ({ fieldValue, origin }) => {
	if (typeof fieldValue === 'string' && fieldValue !== '') {
		return fieldValue;
	}
	if (Number.isInteger(fieldValue)) {
		return String(fieldValue);
	}
	throw refusal(`${origin}: identity ${JSON.stringify(fieldValue)} is neither a non-empty string nor an integer`, 'an identity is never repaired');
};

// carriedPropertiesOf — every carried field present on the item, by the profile's form; an unlisted field refuses
const carriedPropertiesOf = ({ item, itemRow, origin }) => {
	const listedFieldNameList = [itemRow.identityFieldName, itemRow.nameFieldName, itemRow.descriptionFieldName]
		.concat(itemRow.carriedFieldList.map((oneField) => oneField.fieldName))
		.concat((itemRow.referenceFieldList || []).map((oneField) => oneField.fieldName))
		.concat(itemRow.subItem ? [itemRow.subItem.fieldName] : [])
		.filter((fieldName) => fieldName !== null);
	const unlistedFieldName = Object.keys(item).find((fieldName) => listedFieldNameList.indexOf(fieldName) === -1);
	if (unlistedFieldName !== undefined) {
		throw refusal(`${origin}: field '${unlistedFieldName}' is not in this section's profile row`, 'every field is carried, referenced or refused; add it to sedmStructuresProfile.json with its form');
	}
	return itemRow.carriedFieldList
		.filter((oneField) => item[oneField.fieldName] !== undefined)
		.reduce((carried, oneField) => {
			const formRow = CARRIED_FORM_REGISTRY[oneField.form];
			if (formRow === undefined) {
				throw refusal(`${origin}: field '${oneField.fieldName}' declares form '${oneField.form}'`, `the forms are ${Object.keys(CARRIED_FORM_REGISTRY).join(', ')}`);
			}
			const formed = formRow(item[oneField.fieldName]);
			if (formed.formFault !== undefined) {
				throw refusal(`${origin}: field '${oneField.fieldName}' is ${formed.formFault} (${JSON.stringify(item[oneField.fieldName])}); its profile form is ${oneField.form}`, 'a value is carried in its declared form or refused');
			}
			return { ...carried, [oneField.propertyName]: formed.carriedValue };
		}, {});
};

// textOrUndefined — a name or description field: a non-empty string, absent, or refused
const textOrUndefined = ({ item, fieldName, origin }) => {
	if (fieldName === null || item[fieldName] === undefined) {
		return undefined;
	}
	if (typeof item[fieldName] !== 'string' || item[fieldName] === '') {
		throw refusal(`${origin}: field '${fieldName}' is ${JSON.stringify(item[fieldName])}`, 'a name or a description is a non-empty string, or absent');
	}
	return item[fieldName];
};

// -----------------------------------------------------------------
// emitSupportNodes — { structures, kit, walkStats } → { supportStableIdByKindAndIdentity }
// -----------------------------------------------------------------
const emitSupportNodes = ({ structures, kit, walkStats }) => {
	const readTopSectionNameList = structuresProfile.sectionList.map((oneSection) => oneSection.itemListPathList[0])
		.concat(structuresProfile.omittedPathList.map((oneOmission) => oneOmission.pathList[0]))
		.concat([structuresProfile.declaredOptionSetSection.sectionName]);
	const unreadSectionName = Object.keys(structures).find((sectionName) => readTopSectionNameList.indexOf(sectionName) === -1);
	if (unreadSectionName !== undefined) {
		throw refusal(`structures section '${unreadSectionName}' is neither read nor omitted`, 'add a section row or an omittedPathList row to sedmStructuresProfile.json');
	}
	// a container section (standardEventMilestones, entityHierarchy) holds only members the profile reads or omits
	structuresProfile.sectionList.filter((oneSection) => oneSection.itemListPathList.length > 1).forEach((oneSection) => {
		const containerPathList = oneSection.itemListPathList.slice(0, -1);
		const knownMemberNameList = [oneSection.itemListPathList[oneSection.itemListPathList.length - 1]]
			.concat(structuresProfile.omittedPathList.filter((oneOmission) => oneOmission.pathList.length === containerPathList.length + 1 && oneOmission.pathList.slice(0, -1).join('/') === containerPathList.join('/')).map((oneOmission) => oneOmission.pathList[oneOmission.pathList.length - 1]));
		const container = valueAtPath({ structures, pathList: containerPathList });
		const unknownMemberName = Object.keys(isPlainObject(container) ? container : {}).find((memberName) => knownMemberNameList.indexOf(memberName) === -1);
		if (unknownMemberName !== undefined) {
			throw refusal(`structures member '${containerPathList.concat([unknownMemberName]).join('.')}' is neither read nor omitted`, 'add a section row or an omittedPathList row to sedmStructuresProfile.json');
		}
	});

	const supportStableIdByKindAndIdentity = {};
	const pendingReferenceList = [];
	structuresProfile.sectionList.forEach((oneSection) => {
		const itemList = valueAtPath({ structures, pathList: oneSection.itemListPathList });
		const sectionPathText = oneSection.itemListPathList.join('.');
		if (!Array.isArray(itemList)) {
			throw refusal(`structures '${sectionPathText}' is not a list`, 'every profile section reads a list of items');
		}
		itemList.forEach((item, itemIndex) => {
			const origin = `${sourceProfile.structuresFileName} ${sectionPathText}[${itemIndex}]`;
			if (!isPlainObject(item)) {
				throw refusal(`${origin}: an item is not an object`, 'a section item is one JSON object');
			}
			const identityText = identityTextOf({ fieldValue: item[oneSection.identityFieldName], origin });
			const stableId = sedmIdentity.supportStableIdOf({ supportKind: oneSection.supportKind, identityText });
			const name = textOrUndefined({ item, fieldName: oneSection.nameFieldName, origin });
			kit.makeNode({
				role: DME_ROLES.SUPPORT,
				perStandardLabel: oneSection.perStandardLabel,
				stableId,
				name,
				description: textOrUndefined({ item, fieldName: oneSection.descriptionFieldName, origin }),
				structural: { parentId: kit.rootStableId, path: `${oneSection.supportKind}.${identityText}` },
				carriedProperties: carriedPropertiesOf({ item, itemRow: oneSection, origin }),
				origin,
			});
			kit.addEdge({ edgeType: EDGE_TYPES.HAS_SUPPORT, fromStableId: kit.rootStableId, toStableId: stableId, edgeContext: `root->${oneSection.supportKind}.${identityText}` });
			supportStableIdByKindAndIdentity[`${oneSection.supportKind}|${identityText}`] = stableId;
			walkStats.supportNodeCountByKind[oneSection.supportKind] = (walkStats.supportNodeCountByKind[oneSection.supportKind] || 0) + 1;
			oneSection.referenceFieldList
				.filter((oneReference) => item[oneReference.fieldName] !== undefined)
				.forEach((oneReference) => pendingReferenceList.push({ fromStableId: stableId, oneReference, targetIdentityText: identityTextOf({ fieldValue: item[oneReference.fieldName], origin }), origin }));

			// the nested items: a list of plain texts (subtypes) or of objects (subcomponents)
			const subItem = oneSection.subItem;
			if (subItem === null || item[subItem.fieldName] === undefined) {
				return;
			}
			if (!Array.isArray(item[subItem.fieldName])) {
				throw refusal(`${origin}: '${subItem.fieldName}' is not a list`, 'nested items are a list');
			}
			item[subItem.fieldName].forEach((subItemValue, subIndex) => {
				const subOrigin = `${origin}.${subItem.fieldName}[${subIndex}]`;
				const isTextForm = subItem.itemForm === 'text';
				if (isTextForm ? (typeof subItemValue !== 'string' || subItemValue === '') : !isPlainObject(subItemValue)) {
					throw refusal(`${subOrigin}: ${JSON.stringify(subItemValue)} is not a ${isTextForm ? 'non-empty string' : 'JSON object'}`, `this sub-item list's form is ${subItem.itemForm}`);
				}
				const subIdentityText = isTextForm ? subItemValue : identityTextOf({ fieldValue: subItemValue[subItem.identityFieldName], origin: subOrigin });
				const subStableId = sedmIdentity.supportStableIdOf({ supportKind: oneSection.supportKind, identityText, subIdentityText });
				kit.makeNode({
					role: DME_ROLES.SUPPORT,
					perStandardLabel: subItem.perStandardLabel,
					stableId: subStableId,
					name: isTextForm ? subItemValue : textOrUndefined({ item: subItemValue, fieldName: subItem.nameFieldName, origin: subOrigin }),
					description: isTextForm ? undefined : textOrUndefined({ item: subItemValue, fieldName: subItem.descriptionFieldName, origin: subOrigin }),
					// owned by the root like every support node (HAS_SUPPORT); the nesting is the REFERENCES edge and the path
					structural: { parentId: kit.rootStableId, path: `${oneSection.supportKind}.${identityText}.${subIdentityText}`, owningName: name },
					carriedProperties: isTextForm ? {} : carriedPropertiesOf({ item: subItemValue, itemRow: { ...subItem, referenceFieldList: [], subItem: null }, origin: subOrigin }),
					origin: subOrigin,
				});
				kit.addEdge({ edgeType: EDGE_TYPES.HAS_SUPPORT, fromStableId: kit.rootStableId, toStableId: subStableId, edgeContext: `root->${oneSection.supportKind}.${identityText}.${subIdentityText}` });
				kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: subStableId, toStableId: stableId, edgeContext: `${subItem.locator}:${identityText}.${subIdentityText}`, edgeProperties: { locator: subItem.locator } });
				walkStats.supportNodeCountByKind[oneSection.supportKind] += 1;
				walkStats.supportReferenceEdgeCount += 1;
			});
		});
	});

	// references last: every target section has been minted
	pendingReferenceList.forEach(({ fromStableId, oneReference, targetIdentityText, origin }) => {
		const toStableId = supportStableIdByKindAndIdentity[`${oneReference.targetSupportKind}|${targetIdentityText}`];
		if (toStableId === undefined) {
			throw refusal(`${origin}: '${oneReference.fieldName}' names ${oneReference.targetSupportKind} '${targetIdentityText}', which the structures do not declare`, 'a reference names a declared item');
		}
		kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId, toStableId, edgeContext: `${oneReference.locator}:${fromStableId}->${toStableId}`, edgeProperties: { locator: oneReference.locator } });
		walkStats.supportReferenceEdgeCount += 1;
	});
	walkStats.omittedStructuresPathCount = structuresProfile.omittedPathList.filter((oneOmission) => valueAtPath({ structures, pathList: oneOmission.pathList }) !== undefined).length;
	return { supportStableIdByKindAndIdentity };
};

// -----------------------------------------------------------------
// emitDeclaredOptionSets — { structures, kit, walkStats, inlineValueListByElementName } → nothing (nodes minted through the kit)
//   inlineValueListByElementName: element name → [{ codeText, valueName }] for every in-scope element carrying an inline set
// -----------------------------------------------------------------
const emitDeclaredOptionSets = ({ structures, kit, walkStats, inlineValueListByElementName }) => {
	const sectionRow = structuresProfile.declaredOptionSetSection;
	const declaredSetByName = structures[sectionRow.sectionName];
	if (declaredSetByName === undefined) {
		return;
	}
	if (!isPlainObject(declaredSetByName)) {
		throw refusal(`structures '${sectionRow.sectionName}' is not an object of named code lists`, 'the code-list section maps a list name to { values }');
	}
	Object.keys(declaredSetByName).forEach((optionSetName) => {
		const origin = `structures ${sectionRow.sectionName}.${optionSetName}`;
		const declaredSet = declaredSetByName[optionSetName];
		const knownFieldNameList = [sectionRow.valueListFieldName, sectionRow.restatedElementNameFieldName];
		const unknownFieldName = Object.keys(isPlainObject(declaredSet) ? declaredSet : {}).find((fieldName) => knownFieldNameList.indexOf(fieldName) === -1);
		if (!isPlainObject(declaredSet) || !Array.isArray(declaredSet[sectionRow.valueListFieldName]) || unknownFieldName !== undefined) {
			throw refusal(`${origin}: is not { ${knownFieldNameList.join(', ')} }${unknownFieldName === undefined ? '' : ` (it carries '${unknownFieldName}')`}`, 'a declared code list is its values and, optionally, the element it restates');
		}
		const valueList = declaredSet[sectionRow.valueListFieldName];
		const restatedElementName = declaredSet[sectionRow.restatedElementNameFieldName];
		if (restatedElementName !== undefined) {
			const inlineValueList = inlineValueListByElementName[restatedElementName];
			const declaredPairText = JSON.stringify(valueList.map((oneValue) => [oneValue[sectionRow.valueCodeFieldName], oneValue[sectionRow.valueNameFieldName]]));
			const inlinePairText = inlineValueList === undefined ? undefined : JSON.stringify(inlineValueList.map((oneValue) => [oneValue.codeText, oneValue.valueName]));
			if (declaredPairText !== inlinePairText) {
				throw refusal(`${origin}: restates element '${restatedElementName}', whose inline option set ${inlineValueList === undefined ? 'does not exist among the in-scope elements' : `differs (${inlinePairText} against ${declaredPairText})`}`, 'a declared list naming an element must equal that element\'s inline set; a different list needs its own ruling, never a silent choice');
			}
			walkStats.restatedDeclaredOptionSetCount += 1;
			return;
		}
		const optionSetStableId = sedmIdentity.declaredOptionSetStableIdOf({ optionSetName });
		kit.makeNode({
			role: DME_ROLES.OPTION_SET,
			perStandardLabel: DECLARED_OPTION_SET_LABEL,
			stableId: optionSetStableId,
			name: optionSetName,
			structural: { parentId: kit.rootStableId, path: `${sectionRow.sectionName}.${optionSetName}` },
			origin,
		});
		kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: kit.rootStableId, toStableId: optionSetStableId, edgeContext: `root->${optionSetName}` });
		walkStats.declaredOptionSetCount += 1;
		valueList.forEach((oneValue, valueIndex) => {
			const valueOrigin = `${origin}.${sectionRow.valueListFieldName}[${valueIndex}]`;
			const valueName = textOrUndefined({ item: oneValue, fieldName: sectionRow.valueNameFieldName, origin: valueOrigin });
			const unknownValueFieldName = Object.keys(oneValue).find((fieldName) => [sectionRow.valueCodeFieldName, sectionRow.valueNameFieldName, sectionRow.valueDescriptionFieldName].indexOf(fieldName) === -1);
			if (valueName === undefined || unknownValueFieldName !== undefined) {
				throw refusal(`${valueOrigin}: ${valueName === undefined ? 'has no name' : `carries '${unknownValueFieldName}'`}`, 'a declared value is { name, code?, description? }');
			}
			const codeText = textOrUndefined({ item: oneValue, fieldName: sectionRow.valueCodeFieldName, origin: valueOrigin });
			kit.emitOptionValue({
				optionSetStableId,
				optionValueStableId: sedmIdentity.declaredOptionValueStableIdOf({ optionSetName, valueName: codeText === undefined ? valueName : codeText }),
				perStandardLabel: DECLARED_OPTION_VALUE_LABEL,
				name: valueName,
				description: textOrUndefined({ item: oneValue, fieldName: sectionRow.valueDescriptionFieldName, origin: valueOrigin }),
				path: `${sectionRow.sectionName}.${optionSetName}.${valueName}`,
				owningName: optionSetName,
				carriedProperties: codeText === undefined ? {} : { code: codeText },
				origin: valueOrigin,
			});
			walkStats.declaredOptionValueCount += 1;
		});
	});
};

module.exports = { emitSupportNodes, emitDeclaredOptionSets, moduleName };
