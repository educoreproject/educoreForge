'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// walk.js — the emission walk of the PESC release forge (DESIGN-pescForge.md §2.2 to §2.4, §4.4;
// WORKORDER §3 F2). PURE and synchronous: it runs inside the framework's buildContractGraph, where a
// throw is the sanctioned refusal (the framework's one adapter hands it to the forge callback).
//
//   emitReleaseGraph({ xsdSet, loadedManifestEntry, standardKey, nodeKindTable, kit })
//     → { walkStats, sequenceGroups }
//
// It mints, after the framework's root: the release record; one schema file node per member file;
// for each file, in document order, every top-level definition (type, code list, data type, group,
// global element) and everything it owns (local elements, attributes, anonymous types, codes). And it
// adds HAS_SUPPORT (root → release record, schema files, groups; NOT data types, stand-down item 1),
// HAS_CLASS (root → named complex type), HAS_PROPERTY (owner → local element or attribute),
// REFERENCES_TYPE (local element → named complex type or data type), HAS_OPTION_SET (local element →
// named code list), HAS_VALUE (code list → code), SUBCLASS_OF (derivation owner → named base, with
// derivationVariety), REFERENCES (owner → group it references; global element → its substitution
// group head).
//
// Which declarations get the type edges follows the planner's counted model exactly
// (evidence/graphModel.js, whose numbers are the work order's literals): LOCAL elements only, typed
// by a NAMED type. Attributes and global elements carry their typeQName as a property and get no
// type edge; an anonymous type is its declaration's child (parentId), not an edge target; and an
// anonymous code list therefore has no HAS_OPTION_SET. These are recorded in DEVLOG-F2 as open
// items, not silent drops.
//
// Occurrences, HAS_INSTANCE, HAS_CHILD, reachableFromRoot and the context paths are phase F3.
//
// THE FORGE DOES NO BRIDGING (FBB-001): the walk ends with a scan that refuses any property whose
// name speaks of CEDS (gate F14).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { EDGE_TYPES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const resolutionTableLib = require('./resolutionTable');
const { definitionDigestOf } = require('./definitionDigest');
const { makeSequenceGroupCollector, GROUP_KIND } = require('./sequenceGroups');

const { SYMBOL_SPACE } = resolutionTableLib;
const ELEMENT_SEGMENT = 'el';
const ATTRIBUTE_SEGMENT = 'attr';
const ANONYMOUS_SEGMENT = 'anon';
const CODE_SEGMENT = 'code';
const RELEASE_RECORD_SEGMENT = 'release';
const SCHEMA_FILE_SEGMENT = 'file';
const DOCUMENTATION_SOURCE = Object.freeze({ OWN: 'own', TYPE: 'type' });
const BRIDGING_PROPERTY_NAME_RE = /ceds/i;

// the stableId kind segment of each top-level node kind (§2.3: '<standardKey>:<kind>/<namespace>#<localName>')
const STABLE_ID_SEGMENT_BY_NODE_KIND = Object.freeze({
	type: 'type',
	codeList: 'codeList',
	dataType: 'dataType',
	group: 'group',
	globalElement: 'element',
});

// which edge a LOCAL element gets to its named type, by the type's node kind
const TYPE_EDGE_BY_TARGET_NODE_KIND = Object.freeze({
	type: EDGE_TYPES.REFERENCES_TYPE,
	dataType: EDGE_TYPES.REFERENCES_TYPE,
	codeList: EDGE_TYPES.HAS_OPTION_SET,
});

// the top-level node kinds the root reaches by HAS_SUPPORT and HAS_CLASS
const ROOT_EDGE_BY_NODE_KIND = Object.freeze({
	group: EDGE_TYPES.HAS_SUPPORT,
	type: EDGE_TYPES.HAS_CLASS,
});

const containerHasEnumeration = (container) => container.derivations.some((oneDerivation) => oneDerivation.enumerationValues.length > 0);

// a simple type is a code list when its restriction carries an enumeration (§2.1)
const NODE_KIND_BY_DEFINITION_KIND = Object.freeze({
	complexType: () => 'type',
	simpleType: (definition) => (containerHasEnumeration(definition.content) ? 'codeList' : 'dataType'),
	group: () => 'group',
	element: () => 'globalElement',
});
const NODE_KIND_BY_ANONYMOUS_VARIETY = Object.freeze({
	complexType: () => 'anonymousType',
	simpleType: (body) => (containerHasEnumeration(body) ? 'codeList' : 'dataType'),
});

// the carry list of each node kind, in property order (§2.2). A fact that is null, '' or an empty
// list is omitted, never stamped (absent is absent; gate F7)
const SOURCE_CARRY_LIST = Object.freeze(['sourceFileName', 'documentPosition', 'sequencePosition', 'releaseIndependentId', 'definitionDigest']);
const CARRY_LIST_BY_NODE_KIND = Object.freeze({
	releaseRecord: Object.freeze(['releaseName', 'standard', 'version', 'closureDigest', 'closureDate', 'closureDatePrecision', 'closureDateEvidence', 'verdict', 'pinDecisionsApplied', 'librariesNamed', 'rootChangeLogLineList', 'expanderManifestFormat', 'sourceCorpusDigest']),
	schemaFile: Object.freeze(['sourceFileName', 'releaseIndependentId', 'sha256', 'byteCount', 'targetNamespace', 'layer', 'importList', 'schemaAttributeList', 'fileDocumentation']),
	type: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'contentModelShape', 'baseTypeQName', 'derivationVariety', 'contentStyle', 'facets', 'abstractAsWritten'])),
	anonymousType: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'contentModelShape', 'baseTypeQName', 'derivationVariety', 'contentStyle', 'facets'])),
	codeList: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'baseTypeQName', 'derivationVariety', 'facets', 'codeCount'])),
	dataType: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'baseTypeQName', 'derivationVariety', 'facets'])),
	group: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'contentModelShape'])),
	globalElement: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'typeQName', 'typeAsWritten', 'typeName', 'substitutionGroupQName', 'abstractAsWritten', 'nillableAsWritten'])),
	element: Object.freeze(SOURCE_CARRY_LIST.concat(['documentation', 'typeQName', 'typeAsWritten', 'typeName', 'minOccursAsWritten', 'maxOccursAsWritten', 'nillableAsWritten', 'defaultAsWritten', 'fixedAsWritten', 'owningTypeName', 'effectiveDocumentation', 'documentationSource'])),
	attribute: Object.freeze(SOURCE_CARRY_LIST.concat(['documentation', 'typeQName', 'typeAsWritten', 'typeName', 'useAsWritten', 'owningTypeName', 'effectiveDocumentation', 'documentationSource'])),
	code: Object.freeze(SOURCE_CARRY_LIST.concat(['value', 'documentation', 'codePosition'])),
});

const isAbsent = (factValue) => factValue === null || factValue === undefined || factValue === '' || (Array.isArray(factValue) && factValue.length === 0);
const presentFactsOf = (facts) => Object.keys(facts).reduce((soFar, factName) => (isAbsent(facts[factName]) ? soFar : { ...soFar, [factName]: facts[factName] }), {});
const jsonOrAbsent = (jsonValue) => (isAbsent(jsonValue) || (typeof jsonValue === 'object' && !Array.isArray(jsonValue) && Object.keys(jsonValue).length === 0) ? null : JSON.stringify(jsonValue));
const qualifiedTypeNameOf = (resolvedReference) => `${resolvedReference.referencedNamespace}#${resolvedReference.localName}`;
const nonBlankOrNull = (text) => (typeof text === 'string' && text.trim() !== '' ? text : null);

// one derivation at most per container in this corpus; a second is new information and refused
const singleDerivationOf = ({ container, ownerStableId }) => {
	if (container.derivations.length > 1) {
		throw refuse.byName({ moduleName, what: `${ownerStableId} carries ${container.derivations.length} derivations`, where: 'an XSD type body derives once; the parser model holds a list only because it is shared' });
	}
	return container.derivations.length === 1 ? container.derivations[0] : null;
};

const emitReleaseGraph = ({ xsdSet, loadedManifestEntry, standardKey, nodeKindTable, kit }) => {
	const { artifacts, resolutionTable } = xsdSet;
	const stableIdPrefix = `${standardKey}:`;
	const releaseIndependentIdOf = (stableId) => stableId.slice(stableIdPrefix.length);
	const nodeCountByKind = {};
	const edgeCountByType = {};
	const documentationSourceCount = { [DOCUMENTATION_SOURCE.OWN]: 0, [DOCUMENTATION_SOURCE.TYPE]: 0, none: 0 };
	const sequenceGroupCollector = makeSequenceGroupCollector();

	const addEdge = ({ edgeType, fromStableId, toStableId, edgeProperties }) => {
		kit.addEdge({ edgeType, fromStableId, toStableId, edgeContext: `${edgeType} ${fromStableId} → ${toStableId}`, ...(edgeProperties === undefined ? {} : { edgeProperties }) });
		edgeCountByType[edgeType] = (edgeCountByType[edgeType] || 0) + 1;
	};
	const mintNode = ({ nodeKind, stableId, name, parentId, facts, owningName }) => {
		const kindRow = nodeKindTable[nodeKind];
		kit.makeNode({
			role: kindRow.role,
			perStandardLabel: kindRow.perStandardLabel,
			stableId,
			...(isAbsent(name) ? {} : { name }),
			structural: { parentId, path: releaseIndependentIdOf(stableId), ...(owningName === undefined ? {} : { owningName }) },
			carriedProperties: kit.carriedProperties({ parsedObject: presentFactsOf(facts), carryList: CARRY_LIST_BY_NODE_KIND[nodeKind] }),
			origin: `${nodeKind} ${stableId}`,
		});
		nodeCountByKind[nodeKind] = (nodeCountByKind[nodeKind] || 0) + 1;
	};

	// ---- every top-level definition's stableId and node kind, first, so references can point anywhere
	const topLevelByQualifiedName = {};
	artifacts.forEach((oneArtifact) => {
		oneArtifact.definitions.forEach((oneDefinition) => {
			const nodeKind = NODE_KIND_BY_DEFINITION_KIND[oneDefinition.kind](oneDefinition);
			const qualifiedName = resolutionTableLib.qualifiedNameFor({ targetNamespace: oneArtifact.targetNamespace, symbolSpace: SYMBOL_SPACE_BY_KIND[oneDefinition.kind], localName: oneDefinition.name });
			topLevelByQualifiedName[qualifiedName] = {
				nodeKind,
				definition: oneDefinition,
				artifact: oneArtifact,
				stableId: `${stableIdPrefix}${STABLE_ID_SEGMENT_BY_NODE_KIND[nodeKind]}/${oneArtifact.targetNamespace}#${oneDefinition.name}`,
			};
		});
	});
	const resolveOrRefuse = ({ artifact, writtenQName, referencedKind, siteText }) => {
		const resolved = resolutionTableLib.resolveWrittenQName({ resolutionTable, artifact, writtenQName, referencedKind });
		if (resolved.refusalMessage) {
			throw new Error(`${resolved.refusalMessage} [at ${siteText}]`);
		}
		const { resolvedReference } = resolved;
		const target = resolvedReference.isBuiltin ? null : topLevelByQualifiedName[resolvedReference.qualifiedName];
		if (target === undefined) {
			throw refuse.byName({ moduleName, what: `${siteText}: '${writtenQName}' resolves to ${resolvedReference.qualifiedName}, which is no definition of the release`, where: 'the walk mints an edge only to a definition it minted; the resolution table should have refused this first' });
		}
		return { resolvedReference, target };
	};

	// ---- the release record and the schema files
	const rootStableId = kit.rootStableId;
	const releaseEntry = loadedManifestEntry.releaseEntry;
	const releaseRecordStableId = `${stableIdPrefix}${RELEASE_RECORD_SEGMENT}`;
	mintNode({
		nodeKind: 'releaseRecord',
		stableId: releaseRecordStableId,
		name: releaseEntry.releaseName,
		parentId: rootStableId,
		facts: {
			releaseName: releaseEntry.releaseName,
			standard: releaseEntry.standard,
			version: releaseEntry.version,
			closureDigest: releaseEntry.closureDigest,
			closureDate: releaseEntry.closureDate,
			closureDatePrecision: releaseEntry.closureDateEvidence.datePrecision,
			closureDateEvidence: JSON.stringify(releaseEntry.closureDateEvidence),
			verdict: releaseEntry.verdict,
			pinDecisionsApplied: JSON.stringify(releaseEntry.pinDecisionsApplied),
			librariesNamed: releaseEntry.librariesNamed,
			rootChangeLogLineList: releaseEntry.rootChangeLogLines,
			expanderManifestFormat: loadedManifestEntry.expanderManifestFormat,
			sourceCorpusDigest: loadedManifestEntry.sourceCorpusDigest,
		},
	});
	addEdge({ edgeType: EDGE_TYPES.HAS_SUPPORT, fromStableId: rootStableId, toStableId: releaseRecordStableId });

	artifacts.forEach((oneArtifact) => {
		const schemaFileStableId = `${stableIdPrefix}${SCHEMA_FILE_SEGMENT}/${oneArtifact.targetNamespace}`;
		mintNode({
			nodeKind: 'schemaFile',
			stableId: schemaFileStableId,
			name: oneArtifact.filename,
			parentId: rootStableId,
			facts: {
				sourceFileName: oneArtifact.filename,
				releaseIndependentId: releaseIndependentIdOf(schemaFileStableId),
				sha256: oneArtifact.sha256,
				byteCount: oneArtifact.byteCount,
				targetNamespace: oneArtifact.targetNamespace,
				layer: oneArtifact.layer,
				importList: JSON.stringify(oneArtifact.imports.map((oneImport) => ({ namespace: oneImport.namespaceAsWritten, schemaLocation: oneImport.schemaLocationAsWritten, documentPosition: oneImport.documentPosition }))),
				schemaAttributeList: jsonOrAbsent(oneArtifact.schemaAttributes),
				fileDocumentation: nonBlankOrNull(oneArtifact.documentation),
			},
		});
		addEdge({ edgeType: EDGE_TYPES.HAS_SUPPORT, fromStableId: rootStableId, toStableId: schemaFileStableId });
	});

	// ---- what a container owns: local elements, attributes, their anonymous types, codes, edges
	const derivationFactsOf = ({ container, ownerStableId, artifact }) => {
		const derivation = singleDerivationOf({ container, ownerStableId });
		if (derivation === null) {
			return { baseTypeQName: null, derivationVariety: null, contentStyle: null, facets: null };
		}
		const { resolvedReference, target } = resolveOrRefuse({ artifact, writtenQName: derivation.baseAsWritten, referencedKind: SYMBOL_SPACE.TYPE, siteText: `${ownerStableId} ${derivation.variety} base` });
		if (target !== null) {
			addEdge({ edgeType: EDGE_TYPES.SUBCLASS_OF, fromStableId: ownerStableId, toStableId: target.stableId, edgeProperties: { derivationVariety: derivation.variety } });
		}
		return { baseTypeQName: qualifiedTypeNameOf(resolvedReference), derivationVariety: derivation.variety, contentStyle: derivation.contentStyle, facets: jsonOrAbsent(derivation.facets) };
	};

	const emitCodes = ({ container, codeListStableId, artifact }) => {
		const codeStableIdList = [];
		container.derivations.forEach((oneDerivation) => {
			oneDerivation.enumerationValues.forEach((oneValue, valueIndex) => {
				const codePosition = valueIndex + 1;
				// the value is encoded in the id: PESC values carry spaces, a trailing one included
				// (CoreMain 1.19.0 CourseCreditUnitsType 'NoCredit '), which a trimmed stableId refuses; the
				// value itself is carried verbatim on the node
				const codeStableId = `${codeListStableId}/${CODE_SEGMENT}/${codePosition}:${encodeURIComponent(oneValue.value)}`;
				mintNode({
					nodeKind: 'code',
					stableId: codeStableId,
					name: oneValue.value,
					parentId: codeListStableId,
					facts: { sourceFileName: artifact.filename, releaseIndependentId: releaseIndependentIdOf(codeStableId), definitionDigest: definitionDigestOf(oneValue), value: oneValue.value, documentation: nonBlankOrNull(oneValue.documentation), codePosition },
				});
				addEdge({ edgeType: EDGE_TYPES.HAS_VALUE, fromStableId: codeListStableId, toStableId: codeStableId });
				codeStableIdList.push(codeStableId);
			});
		});
		if (codeStableIdList.length > 0) {
			sequenceGroupCollector.addGroup({ groupKey: `${codeListStableId}#codes`, members: codeStableIdList, compositor: GROUP_KIND.DOCUMENT_ORDER });
		}
		return codeStableIdList.length;
	};

	const emitGroupReferences = ({ contentModelShape, ownerStableId, artifact }) => {
		if (contentModelShape === null) {
			return;
		}
		contentModelShape.particles.forEach((oneParticle) => {
			if (oneParticle.groupRef !== undefined) {
				const { target } = resolveOrRefuse({ artifact, writtenQName: oneParticle.groupRef, referencedKind: SYMBOL_SPACE.GROUP, siteText: `${ownerStableId} group ref` });
				addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: ownerStableId, toStableId: target.stableId });
				return;
			}
			if (oneParticle.compositor !== undefined) {
				emitGroupReferences({ contentModelShape: oneParticle, ownerStableId, artifact });
			}
		});
	};

	// the documentation of the type a declaration names: its named definition's, or its anonymous body's
	const typeDocumentationOf = ({ target, anonymousType }) => {
		if (anonymousType !== null) {
			return nonBlankOrNull(anonymousType.body.documentation);
		}
		return target === null ? null : nonBlankOrNull(target.definition.documentation);
	};
	const effectiveDocumentationFactsOf = ({ ownDocumentation, typeDocumentation }) => {
		if (ownDocumentation !== null) {
			documentationSourceCount[DOCUMENTATION_SOURCE.OWN]++;
			return { effectiveDocumentation: ownDocumentation, documentationSource: DOCUMENTATION_SOURCE.OWN };
		}
		if (typeDocumentation !== null) {
			documentationSourceCount[DOCUMENTATION_SOURCE.TYPE]++;
			return { effectiveDocumentation: typeDocumentation, documentationSource: DOCUMENTATION_SOURCE.TYPE };
		}
		documentationSourceCount.none++;
		return { effectiveDocumentation: null, documentationSource: null };
	};

	// an anonymous type, owned by the declaration it is written inside
	const emitAnonymousType = ({ anonymousType, ownerDeclarationStableId, ownerDeclarationName, artifact }) => {
		const nodeKind = NODE_KIND_BY_ANONYMOUS_VARIETY[anonymousType.typeVariety](anonymousType.body);
		const anonymousStableId = `${ownerDeclarationStableId}/${ANONYMOUS_SEGMENT}`;
		const derivationFacts = derivationFactsOf({ container: anonymousType.body, ownerStableId: anonymousStableId, artifact });
		const codeCount = nodeKind === 'codeList' ? anonymousType.body.derivations.reduce((soFar, oneDerivation) => soFar + oneDerivation.enumerationValues.length, 0) : null;
		mintNode({
			nodeKind,
			stableId: anonymousStableId,
			parentId: ownerDeclarationStableId,
			owningName: ownerDeclarationName,
			facts: {
				sourceFileName: artifact.filename,
				releaseIndependentId: releaseIndependentIdOf(anonymousStableId),
				definitionDigest: definitionDigestOf(anonymousType),
				targetNamespace: artifact.targetNamespace,
				documentation: nonBlankOrNull(anonymousType.body.documentation),
				documentationValueList: anonymousType.body.documentationValues,
				contentModelShape: jsonOrAbsent(anonymousType.body.contentModelShape),
				...derivationFacts,
				codeCount,
			},
		});
		if (nodeKind === 'codeList') {
			emitCodes({ container: anonymousType.body, codeListStableId: anonymousStableId, artifact });
		}
		emitContainerContent({ container: anonymousType.body, ownerStableId: anonymousStableId, owningTypeName: null, artifact });
		return anonymousStableId;
	};

	const emitContainerContent = ({ container, ownerStableId, owningTypeName, artifact }) => {
		const elementStableIdList = [];
		container.elements.forEach((oneElement) => {
			const elementStableId = `${ownerStableId}/${ELEMENT_SEGMENT}/${oneElement.sequencePosition}:${oneElement.name}`;
			const typed = oneElement.typeAsWritten === null ? { resolvedReference: null, target: null } : resolveOrRefuse({ artifact, writtenQName: oneElement.typeAsWritten, referencedKind: SYMBOL_SPACE.TYPE, siteText: `${elementStableId} type` });
			const ownDocumentation = nonBlankOrNull(oneElement.documentation);
			mintNode({
				nodeKind: 'element',
				stableId: elementStableId,
				name: oneElement.name,
				parentId: ownerStableId,
				facts: {
					sourceFileName: artifact.filename,
					sequencePosition: oneElement.sequencePosition,
					releaseIndependentId: releaseIndependentIdOf(elementStableId),
					definitionDigest: definitionDigestOf({ element: oneElement, resolvedType: typed.target === null ? null : typed.target.definition }),
					documentation: ownDocumentation,
					typeQName: typed.resolvedReference === null ? null : qualifiedTypeNameOf(typed.resolvedReference),
					typeAsWritten: oneElement.typeAsWritten,
					typeName: typed.resolvedReference === null ? null : typed.resolvedReference.localName,
					minOccursAsWritten: oneElement.minOccursAsWritten,
					maxOccursAsWritten: oneElement.maxOccursAsWritten,
					nillableAsWritten: oneElement.nillableAsWritten,
					defaultAsWritten: oneElement.defaultAsWritten,
					fixedAsWritten: oneElement.fixedAsWritten,
					owningTypeName,
					...effectiveDocumentationFactsOf({ ownDocumentation, typeDocumentation: typeDocumentationOf({ target: typed.target, anonymousType: oneElement.anonymousType }) }),
				},
			});
			addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: ownerStableId, toStableId: elementStableId });
			if (typed.target !== null) {
				const typeEdgeType = TYPE_EDGE_BY_TARGET_NODE_KIND[typed.target.nodeKind];
				if (typeEdgeType === undefined) {
					throw refuse.byName({ moduleName, what: `${elementStableId} is typed by a ${typed.target.nodeKind} (${typed.target.stableId})`, where: `an element's type is one of ${Object.keys(TYPE_EDGE_BY_TARGET_NODE_KIND).join(', ')}` });
				}
				addEdge({ edgeType: typeEdgeType, fromStableId: elementStableId, toStableId: typed.target.stableId });
			}
			if (oneElement.anonymousType !== null) {
				emitAnonymousType({ anonymousType: oneElement.anonymousType, ownerDeclarationStableId: elementStableId, ownerDeclarationName: oneElement.name, artifact });
			}
			elementStableIdList.push(elementStableId);
		});
		container.attributes.forEach((oneAttribute) => {
			const attributeStableId = `${ownerStableId}/${ATTRIBUTE_SEGMENT}/${oneAttribute.attributePosition}:${oneAttribute.name}`;
			const typed = oneAttribute.typeAsWritten === null ? { resolvedReference: null, target: null } : resolveOrRefuse({ artifact, writtenQName: oneAttribute.typeAsWritten, referencedKind: SYMBOL_SPACE.TYPE, siteText: `${attributeStableId} type` });
			const ownDocumentation = nonBlankOrNull(oneAttribute.documentation);
			mintNode({
				nodeKind: 'attribute',
				stableId: attributeStableId,
				name: oneAttribute.name,
				parentId: ownerStableId,
				facts: {
					sourceFileName: artifact.filename,
					sequencePosition: oneAttribute.attributePosition,
					releaseIndependentId: releaseIndependentIdOf(attributeStableId),
					definitionDigest: definitionDigestOf({ attribute: oneAttribute, resolvedType: typed.target === null ? null : typed.target.definition }),
					documentation: ownDocumentation,
					typeQName: typed.resolvedReference === null ? null : qualifiedTypeNameOf(typed.resolvedReference),
					typeAsWritten: oneAttribute.typeAsWritten,
					typeName: typed.resolvedReference === null ? null : typed.resolvedReference.localName,
					useAsWritten: oneAttribute.useAsWritten,
					owningTypeName,
					...effectiveDocumentationFactsOf({ ownDocumentation, typeDocumentation: typeDocumentationOf({ target: typed.target, anonymousType: oneAttribute.anonymousType }) }),
				},
			});
			addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: ownerStableId, toStableId: attributeStableId });
			if (oneAttribute.anonymousType !== null) {
				emitAnonymousType({ anonymousType: oneAttribute.anonymousType, ownerDeclarationStableId: attributeStableId, ownerDeclarationName: oneAttribute.name, artifact });
			}
		});
		emitGroupReferences({ contentModelShape: container.contentModelShape, ownerStableId, artifact });
		if (elementStableIdList.length > 0) {
			if (container.contentModelShape === null) {
				throw refuse.byName({ moduleName, what: `${ownerStableId} owns ${elementStableIdList.length} elements and no compositor`, where: 'local elements sit in an xs:sequence or xs:choice' });
			}
			sequenceGroupCollector.addGroup({ groupKey: `${ownerStableId}#elements`, members: elementStableIdList, compositor: container.contentModelShape.compositor });
		}
	};

	// ---- the top-level definitions, file by file, in document order
	artifacts.forEach((oneArtifact) => {
		const definitionStableIdList = [];
		oneArtifact.definitions.forEach((oneDefinition) => {
			const qualifiedName = resolutionTableLib.qualifiedNameFor({ targetNamespace: oneArtifact.targetNamespace, symbolSpace: SYMBOL_SPACE_BY_KIND[oneDefinition.kind], localName: oneDefinition.name });
			const { nodeKind, stableId } = topLevelByQualifiedName[qualifiedName];
			const commonFacts = {
				sourceFileName: oneArtifact.filename,
				documentPosition: oneDefinition.documentPosition,
				releaseIndependentId: releaseIndependentIdOf(stableId),
				definitionDigest: definitionDigestOf(oneDefinition),
				targetNamespace: oneArtifact.targetNamespace,
				documentation: nonBlankOrNull(oneDefinition.documentation),
			};
			if (nodeKind === 'globalElement') {
				const typed = oneDefinition.typeAsWritten === null ? { resolvedReference: null } : resolveOrRefuse({ artifact: oneArtifact, writtenQName: oneDefinition.typeAsWritten, referencedKind: SYMBOL_SPACE.TYPE, siteText: `${stableId} type` });
				const headed = oneDefinition.substitutionGroupAsWritten === null ? { resolvedReference: null, target: null } : resolveOrRefuse({ artifact: oneArtifact, writtenQName: oneDefinition.substitutionGroupAsWritten, referencedKind: SYMBOL_SPACE.ELEMENT, siteText: `${stableId} substitutionGroup` });
				mintNode({
					nodeKind,
					stableId,
					name: oneDefinition.name,
					parentId: rootStableId,
					facts: {
						...commonFacts,
						typeQName: typed.resolvedReference === null ? null : qualifiedTypeNameOf(typed.resolvedReference),
						typeAsWritten: oneDefinition.typeAsWritten,
						typeName: typed.resolvedReference === null ? null : typed.resolvedReference.localName,
						substitutionGroupQName: headed.resolvedReference === null ? null : qualifiedTypeNameOf(headed.resolvedReference),
						abstractAsWritten: oneDefinition.abstractAsWritten,
						nillableAsWritten: oneDefinition.nillableAsWritten,
					},
				});
				if (headed.target !== null) {
					addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: stableId, toStableId: headed.target.stableId });
				}
				if (oneDefinition.anonymousType !== null) {
					emitAnonymousType({ anonymousType: oneDefinition.anonymousType, ownerDeclarationStableId: stableId, ownerDeclarationName: oneDefinition.name, artifact: oneArtifact });
				}
				definitionStableIdList.push(stableId);
				return;
			}
			const container = oneDefinition.content;
			const derivationFacts = derivationFactsOf({ container, ownerStableId: stableId, artifact: oneArtifact });
			mintNode({
				nodeKind,
				stableId,
				name: oneDefinition.name,
				parentId: rootStableId,
				facts: {
					...commonFacts,
					documentationValueList: container.documentationValues,
					contentModelShape: jsonOrAbsent(container.contentModelShape),
					...derivationFacts,
					abstractAsWritten: oneDefinition.abstractAsWritten,
					codeCount: nodeKind === 'codeList' ? container.derivations.reduce((soFar, oneDerivation) => soFar + oneDerivation.enumerationValues.length, 0) : null,
				},
			});
			if (ROOT_EDGE_BY_NODE_KIND[nodeKind] !== undefined) {
				addEdge({ edgeType: ROOT_EDGE_BY_NODE_KIND[nodeKind], fromStableId: rootStableId, toStableId: stableId });
			}
			if (nodeKind === 'codeList') {
				emitCodes({ container, codeListStableId: stableId, artifact: oneArtifact });
			}
			emitContainerContent({ container, ownerStableId: stableId, owningTypeName: oneDefinition.name, artifact: oneArtifact });
			definitionStableIdList.push(stableId);
		});
		sequenceGroupCollector.addGroup({ groupKey: `${stableIdPrefix}${SCHEMA_FILE_SEGMENT}/${oneArtifact.targetNamespace}#definitions`, members: definitionStableIdList, compositor: GROUP_KIND.DOCUMENT_ORDER });
	});

	// ---- F14: the forge names no bridge target
	kit.nodes.forEach((oneNode) => {
		const bridgingPropertyName = Object.keys(oneNode.properties).find((onePropertyName) => BRIDGING_PROPERTY_NAME_RE.test(onePropertyName));
		if (bridgingPropertyName !== undefined) {
			throw refuse.byName({ moduleName, what: `node '${oneNode.stableId}' carries property '${bridgingPropertyName}'`, where: 'THE FORGE DOES NO BRIDGING (FBB-001): no property of a PESC release graph names CEDS' });
		}
	});

	return {
		walkStats: { nodeCountByKind, edgeCountByType, documentationSourceCount },
		sequenceGroups: sequenceGroupCollector.sequenceGroups(),
	};
};

// the resolution table's symbol space of each definition kind (resolutionTable.js keys the table by it)
const SYMBOL_SPACE_BY_KIND = Object.freeze({
	complexType: SYMBOL_SPACE.TYPE,
	simpleType: SYMBOL_SPACE.TYPE,
	element: SYMBOL_SPACE.ELEMENT,
	group: SYMBOL_SPACE.GROUP,
});

module.exports = { emitReleaseGraph, CARRY_LIST_BY_NODE_KIND, STABLE_ID_SEGMENT_BY_NODE_KIND, moduleName };
