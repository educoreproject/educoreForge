'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdResolution.js — the resolution table of the forged files, and the resolution of every as-written QName against it (wave 3 lane I,
// K3, ruled by BRONZE_CROWN 2026-10-24). PURE; a refusal is a thrown named Error.
//
//   buildResolutionTable({ schemaFileList, stableIdPrefix }) → { definitionByResolutionName }
//   resolveWrittenQName({ resolutionTable, schemaFile, writtenQName, symbolSpace, foreignNamespaceUriList })
//       → { resolutionKind: 'builtin' | 'external' | 'corpus', namespaceUri, localName, targetStableId? }
//
// The table is keyed '<namespace>#<symbol space>/<local name>' over every top-level definition of every forged file (symbol spaces from
// the registry: type, element, group, attributeGroup). A QName is resolved through its OWN file's prefix bindings (two files may bind one
// prefix to two namespaces), then:
//   builtin   the XML Schema namespace, symbol space type, a name on the registry's builtinTypeNameList (no edge)
//   external  a namespace the profile declares foreign and the file imports (no edge: carried as written, FBB-001)
//   corpus    the file's own namespace or one it imports, defined in the table (the walk draws the edge)
// Refused by name: a name defined twice in one symbol space of one namespace (naming both files: exclude the unreachable one); a prefix
// the file does not bind; an unprefixed name in a file with no default namespace; an XML Schema name that is not a built-in type; a
// namespace the file neither declares nor imports; a corpus name its namespace does not define.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { prefixOfQualifiedName } = require('./xsdParser');
const xsdIdentity = require('./xsdIdentity');
const constructRegistry = require('./xsdConstructRegistry.json');

const refusal = (what, where) => refuse.byName({ moduleName, what, where });
const resolutionNameOf = ({ namespaceUri, symbolSpace, localName }) => `${namespaceUri}#${symbolSpace}/${localName}`;
const attributeValueOf = (node, attributeName) => (node.attributeList.find((oneAttribute) => oneAttribute.attributeName === attributeName) || {}).attributeValue;

const buildResolutionTable = ({ schemaFileList, stableIdPrefix }) => {
	const definitionByResolutionName = new Map();
	schemaFileList.forEach(({ schemaFileRelativePath, parsedFile }) => {
		parsedFile.rootNode.children.forEach((topNode) => {
			const { symbolSpace, stableIdSegment } = constructRegistry.constructByName[topNode.construct];
			if (symbolSpace === undefined) {
				return;
			}
			const localName = attributeValueOf(topNode, 'name');
			if (localName === undefined) {
				throw refusal(`'${schemaFileRelativePath}' ${topNode.locator}: a top-level ${topNode.localTag} has no name`, 'a top-level definition is named');
			}
			const resolutionName = resolutionNameOf({ namespaceUri: parsedFile.targetNamespace, symbolSpace, localName });
			const firstDefinition = definitionByResolutionName.get(resolutionName);
			if (firstDefinition !== undefined) {
				throw refusal(
					`${symbolSpace} '${localName}' of namespace '${parsedFile.targetNamespace}' is defined in '${firstDefinition.schemaFileRelativePath}' ${firstDefinition.locator} and again in '${schemaFileRelativePath}' ${topNode.locator}`,
					'one name, one definition per namespace: exclude the file no import reaches (schemaFileExclusionList, with its reason)',
				);
			}
			definitionByResolutionName.set(resolutionName, {
				schemaFileRelativePath,
				locator: topNode.locator,
				construct: topNode.construct,
				targetStableId: xsdIdentity.topLevelStableIdOf({ stableIdPrefix, stableIdSegment, namespaceUri: parsedFile.targetNamespace, localName }),
			});
		});
	});
	return { definitionByResolutionName };
};

// visibleNamespaceListOf — the namespaces a file may name: its own and those it imports or includes (foreign ones too)
const visibleNamespaceListOf = (schemaFile) => [schemaFile.parsedFile.targetNamespace].concat(schemaFile.importRecordList.map((oneImport) => oneImport.namespace));

const resolveWrittenQName = ({ resolutionTable, schemaFile, writtenQName, symbolSpace, foreignNamespaceUriList, siteText }) => {
	const { prefix, localName } = prefixOfQualifiedName(writtenQName.trim());
	if (writtenQName !== writtenQName.trim() || localName === '') {
		throw refusal(`${siteText}: QName ${JSON.stringify(writtenQName)} is not a bare QName`, 'a QName is written prefix:localName or localName, without spaces');
	}
	const namespaceUri = schemaFile.parsedFile.prefixBindingByPrefix[prefix];
	if (namespaceUri === undefined) {
		throw refusal(`${siteText}: QName '${writtenQName}' uses ${prefix === '' ? 'no prefix, and the file binds no default namespace' : `prefix '${prefix}', which the file does not bind`}`, 'every QName resolves through its own file\'s bindings; nothing is guessed');
	}
	if (namespaceUri === constructRegistry.xsdNamespace) {
		if (symbolSpace !== 'type' || constructRegistry.builtinTypeNameList.indexOf(localName) === -1) {
			throw refusal(`${siteText}: '${writtenQName}' is in the XML Schema namespace but is not a built-in ${symbolSpace === 'type' ? 'type' : `(symbol space ${symbolSpace})`}`, 'xsdConstructRegistry.json builtinTypeNameList');
		}
		return { resolutionKind: 'builtin', namespaceUri, localName };
	}
	if (visibleNamespaceListOf(schemaFile).indexOf(namespaceUri) === -1) {
		throw refusal(`${siteText}: '${writtenQName}' names namespace '${namespaceUri}', which '${schemaFile.schemaFileRelativePath}' neither declares nor imports`, 'a reference leaves the file only through an import');
	}
	if (foreignNamespaceUriList.indexOf(namespaceUri) !== -1) {
		return { resolutionKind: 'external', namespaceUri, localName };
	}
	const definition = resolutionTable.definitionByResolutionName.get(resolutionNameOf({ namespaceUri, symbolSpace, localName }));
	if (definition === undefined) {
		throw refusal(`${siteText}: '${writtenQName}' names ${symbolSpace} '${localName}', which namespace '${namespaceUri}' does not define`, 'a corpus reference names a definition of a forged file');
	}
	return { resolutionKind: 'corpus', namespaceUri, localName, targetStableId: definition.targetStableId, targetConstruct: definition.construct };
};

module.exports = { buildResolutionTable, resolveWrittenQName, moduleName };
