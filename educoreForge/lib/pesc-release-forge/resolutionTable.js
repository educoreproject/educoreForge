'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// resolutionTable.js — the release's resolution table, and the resolution of every as-written QName
// against it (DESIGN-pescForge.md §1.3; gate F5).
//
//   resolveRelease({ artifacts }) → { resolutionTable, referenceList, referenceCensus } | { refusalMessage }
//   resolveWrittenQName({ resolutionTable, artifact, writtenQName, referencedKind })
//       → { resolvedReference } | { refusalMessage }
//
// The table is keyed '<targetNamespace>#<symbolSpace>/<localName>' and holds every top-level
// definition of the release's files. XSD keeps three symbol spaces this corpus uses: 'type'
// (complexType and simpleType share it), 'element' and 'group'. A QName is resolved through its OWN
// file's prefix table (R-ID-1, kept from pesc260805: one prefixed string can mean two things in two
// files, so it is never stored unresolved), and then looked up here.
//
// A reference is one of the four attributes the expander's reference census reads (code fact,
// pescReleaseExpander lib/xsd-registries.js REFERENCE_KIND_BY_ATTRIBUTE): type= on an element or
// attribute, base= on a derivation, ref= on a group particle, substitutionGroup= on a global
// element. So referenceCount here is the same quantity as the manifest entry's
// releaseReferenceCheck.totalReferences, and the gate compares the two.
//
// Refused by name: a name defined twice in one symbol space of one namespace; a prefix the file
// does not bind (the parser already refuses this for prefixed names); an unprefixed name in a file
// with no default namespace; a namespace no file of the release declares, or one the referring file
// neither declares nor imports (the reference leaves the release); a name its namespace does not
// define; an xs: name that is not an XML Schema built-in type.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const XML_SCHEMA_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';
// the XML Schema 1.0 built-in types, as the expander lists them (pescReleaseExpander xsd-registries.js)
const XML_SCHEMA_BUILTIN_TYPE_NAME_LIST = Object.freeze([
	'anyType', 'anySimpleType', 'string', 'normalizedString', 'token', 'language', 'Name', 'NCName',
	'ID', 'IDREF', 'IDREFS', 'ENTITY', 'ENTITIES', 'NMTOKEN', 'NMTOKENS', 'boolean', 'base64Binary',
	'hexBinary', 'float', 'double', 'decimal', 'integer', 'nonPositiveInteger', 'negativeInteger',
	'long', 'int', 'short', 'byte', 'nonNegativeInteger', 'unsignedLong', 'unsignedInt',
	'unsignedShort', 'unsignedByte', 'positiveInteger', 'anyURI', 'QName', 'NOTATION', 'duration',
	'dateTime', 'date', 'time', 'gYearMonth', 'gYear', 'gMonthDay', 'gDay', 'gMonth',
]);

const SYMBOL_SPACE = Object.freeze({ TYPE: 'type', ELEMENT: 'element', GROUP: 'group' });
const SYMBOL_SPACE_BY_DEFINITION_KIND = Object.freeze({
	complexType: SYMBOL_SPACE.TYPE,
	simpleType: SYMBOL_SPACE.TYPE,
	element: SYMBOL_SPACE.ELEMENT,
	group: SYMBOL_SPACE.GROUP,
});

const qualifiedNameFor = ({ targetNamespace, symbolSpace, localName }) => `${targetNamespace}#${symbolSpace}/${localName}`;
const refusal = (what, where) => ({ refusalMessage: refuse.byName({ moduleName, what, where }).message });

// ---- the table ----------------------------------------------------------------------------------

const buildResolutionTable = ({ artifacts }) => {
	const rowByQualifiedName = {};
	const namespaceFileNameByNamespace = {};
	for (let artifactIndex = 0; artifactIndex < artifacts.length; artifactIndex++) {
		const oneArtifact = artifacts[artifactIndex];
		if (namespaceFileNameByNamespace[oneArtifact.targetNamespace] !== undefined) {
			return refusal(`${oneArtifact.filename} and ${namespaceFileNameByNamespace[oneArtifact.targetNamespace]} both declare ${oneArtifact.targetNamespace}`, 'a release holds one file per namespace');
		}
		namespaceFileNameByNamespace[oneArtifact.targetNamespace] = oneArtifact.filename;
		for (let definitionIndex = 0; definitionIndex < oneArtifact.definitions.length; definitionIndex++) {
			const oneDefinition = oneArtifact.definitions[definitionIndex];
			const symbolSpace = SYMBOL_SPACE_BY_DEFINITION_KIND[oneDefinition.kind];
			if (symbolSpace === undefined) {
				return refusal(`${oneArtifact.filename} definition '${oneDefinition.name}' is of kind '${oneDefinition.kind}'`, `the table knows ${Object.keys(SYMBOL_SPACE_BY_DEFINITION_KIND).join(', ')}`);
			}
			const qualifiedName = qualifiedNameFor({ targetNamespace: oneArtifact.targetNamespace, symbolSpace, localName: oneDefinition.name });
			if (rowByQualifiedName[qualifiedName] !== undefined) {
				return refusal(`${qualifiedName} is defined twice (${oneArtifact.filename} positions ${rowByQualifiedName[qualifiedName].documentPosition} and ${oneDefinition.documentPosition})`, 'a name is defined once per symbol space of a namespace');
			}
			rowByQualifiedName[qualifiedName] = Object.freeze({
				qualifiedName,
				targetNamespace: oneArtifact.targetNamespace,
				symbolSpace,
				definitionKind: oneDefinition.kind,
				localName: oneDefinition.name,
				fileName: oneArtifact.filename,
				documentPosition: oneDefinition.documentPosition,
			});
		}
	}
	return { resolutionTable: { rowByQualifiedName, namespaceFileNameByNamespace } };
};

// ---- one QName --------------------------------------------------------------------------------

const resolveWrittenQName = ({ resolutionTable, artifact, writtenQName, referencedKind }) => {
	const colonIndex = writtenQName.indexOf(':');
	const writtenPrefix = colonIndex === -1 ? '' : writtenQName.slice(0, colonIndex);
	const localName = colonIndex === -1 ? writtenQName : writtenQName.slice(colonIndex + 1);
	const referencedNamespace = artifact.prefixBindings[writtenPrefix];
	const site = `${artifact.filename}: '${writtenQName}' (${referencedKind})`;
	if (referencedNamespace === undefined) {
		return refusal(`${site} uses ${writtenPrefix === '' ? 'no prefix, and the file declares no default namespace' : `prefix '${writtenPrefix}', which the file does not bind`}`, "a QName resolves through its own file's prefix table, never anywhere else");
	}
	if (referencedNamespace === XML_SCHEMA_NAMESPACE) {
		if (referencedKind !== SYMBOL_SPACE.TYPE || XML_SCHEMA_BUILTIN_TYPE_NAME_LIST.indexOf(localName) === -1) {
			return refusal(`${site} names the XML Schema namespace, and '${localName}' is not a built-in ${referencedKind}`, 'an xs: reference names an XML Schema built-in type');
		}
		return { resolvedReference: Object.freeze({ writtenQName, referencedKind, referencedNamespace, localName, isBuiltin: true, qualifiedName: qualifiedNameFor({ targetNamespace: referencedNamespace, symbolSpace: referencedKind, localName }) }) };
	}
	const isOwnNamespace = referencedNamespace === artifact.targetNamespace;
	const isImported = artifact.imports.some((oneImport) => oneImport.namespaceAsWritten === referencedNamespace);
	if (!isOwnNamespace && !isImported) {
		return refusal(`${site} names ${referencedNamespace}, which ${artifact.filename} neither declares nor imports`, 'a reference stays inside the namespaces its file imports');
	}
	if (resolutionTable.namespaceFileNameByNamespace[referencedNamespace] === undefined) {
		return refusal(`${site} names ${referencedNamespace}, which no file of the release declares (the reference leaves the release)`, 'every reference resolves inside the release folder');
	}
	const qualifiedName = qualifiedNameFor({ targetNamespace: referencedNamespace, symbolSpace: referencedKind, localName });
	const resolvedRow = resolutionTable.rowByQualifiedName[qualifiedName];
	if (resolvedRow === undefined) {
		return refusal(`${site} resolves to ${qualifiedName}, which ${resolutionTable.namespaceFileNameByNamespace[referencedNamespace]} does not define`, 'every reference names a definition of the release');
	}
	return { resolvedReference: Object.freeze({ writtenQName, referencedKind, referencedNamespace, localName, isBuiltin: false, qualifiedName, resolvedRow }) };
};

// ---- every reference of the release ---------------------------------------------------------

const collectContentModelShapeReferences = (contentModelShape, pushReference) => {
	if (contentModelShape === null) {
		return;
	}
	contentModelShape.particles.forEach((oneParticle) => {
		if (oneParticle.groupRef !== undefined) {
			pushReference(oneParticle.groupRef, SYMBOL_SPACE.GROUP, 'group ref=');
			return;
		}
		if (oneParticle.compositor !== undefined) {
			collectContentModelShapeReferences(oneParticle, pushReference);
		}
	});
};

const collectContainerReferences = (container, pushReference) => {
	container.derivations.forEach((oneDerivation) => pushReference(oneDerivation.baseAsWritten, SYMBOL_SPACE.TYPE, `${oneDerivation.variety} base=`));
	container.elements.forEach((oneElement) => {
		if (oneElement.typeAsWritten !== null) {
			pushReference(oneElement.typeAsWritten, SYMBOL_SPACE.TYPE, `element '${oneElement.name}' type=`);
		}
		if (oneElement.anonymousType !== null) {
			collectContainerReferences(oneElement.anonymousType.body, pushReference);
		}
	});
	container.attributes.forEach((oneAttribute) => {
		if (oneAttribute.typeAsWritten !== null) {
			pushReference(oneAttribute.typeAsWritten, SYMBOL_SPACE.TYPE, `attribute '${oneAttribute.name}' type=`);
		}
		if (oneAttribute.anonymousType !== null) {
			collectContainerReferences(oneAttribute.anonymousType.body, pushReference);
		}
	});
	collectContentModelShapeReferences(container.contentModelShape, pushReference);
};

const collectArtifactReferences = (artifact) => {
	const writtenReferenceList = [];
	const pushReference = (writtenQName, referencedKind, siteText) => writtenReferenceList.push({ writtenQName, referencedKind, siteText });
	artifact.definitions.forEach((oneDefinition) => {
		if (oneDefinition.kind === 'element') {
			if (oneDefinition.typeAsWritten !== null) {
				pushReference(oneDefinition.typeAsWritten, SYMBOL_SPACE.TYPE, `global element '${oneDefinition.name}' type=`);
			}
			if (oneDefinition.substitutionGroupAsWritten !== null) {
				pushReference(oneDefinition.substitutionGroupAsWritten, SYMBOL_SPACE.ELEMENT, `global element '${oneDefinition.name}' substitutionGroup=`);
			}
			if (oneDefinition.anonymousType !== null) {
				collectContainerReferences(oneDefinition.anonymousType.body, pushReference);
			}
			return;
		}
		collectContainerReferences(oneDefinition.content, pushReference);
	});
	return writtenReferenceList;
};

const resolveRelease = ({ artifacts }) => {
	const built = buildResolutionTable({ artifacts });
	if (built.refusalMessage) {
		return built;
	}
	const { resolutionTable } = built;
	const referenceList = [];
	const referenceCensus = { referenceCount: 0, builtinReferenceCount: 0, inReleaseReferenceCount: 0 };
	for (let artifactIndex = 0; artifactIndex < artifacts.length; artifactIndex++) {
		const oneArtifact = artifacts[artifactIndex];
		const writtenReferenceList = collectArtifactReferences(oneArtifact);
		for (let referenceIndex = 0; referenceIndex < writtenReferenceList.length; referenceIndex++) {
			const oneWrittenReference = writtenReferenceList[referenceIndex];
			const resolved = resolveWrittenQName({ resolutionTable, artifact: oneArtifact, writtenQName: oneWrittenReference.writtenQName, referencedKind: oneWrittenReference.referencedKind });
			if (resolved.refusalMessage) {
				return { refusalMessage: `${resolved.refusalMessage} [at ${oneWrittenReference.siteText}]` };
			}
			referenceCensus.referenceCount++;
			if (resolved.resolvedReference.isBuiltin) {
				referenceCensus.builtinReferenceCount++;
			} else {
				referenceCensus.inReleaseReferenceCount++;
			}
			referenceList.push({ fileName: oneArtifact.filename, siteText: oneWrittenReference.siteText, resolvedReference: resolved.resolvedReference });
		}
	}
	return { resolutionTable, referenceList, referenceCensus };
};

module.exports = { resolveRelease, resolveWrittenQName, buildResolutionTable, qualifiedNameFor, SYMBOL_SPACE, XML_SCHEMA_NAMESPACE, XML_SCHEMA_BUILTIN_TYPE_NAME_LIST, moduleName };
