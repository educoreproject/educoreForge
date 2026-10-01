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
// REFERENCES_TYPE (declaration → named complex type or data type), HAS_OPTION_SET (declaration →
// named or anonymous code list), HAS_VALUE (code list → code), SUBCLASS_OF (derivation owner → named base, with
// derivationVariety), REFERENCES (owner → group it references; global element → its substitution
// group head).
//
// Every element-like declaration (local element, attribute, global element) gets the same type edge
// to a NAMED type: REFERENCES_TYPE to a complex type or data type, HAS_OPTION_SET to a code list. And
// a declaration whose code list is ANONYMOUS gets HAS_OPTION_SET to it, because the DME reaches an
// option set only through that edge (QUIET_ORBIT ruling on DEVLOG-F2 §10, 2026-09-30, which moved
// the work order's literals; the planner's model had counted local elements to named types only).
// An anonymous complex type or data type stays its declaration's child (parentId) with no edge.
//
// A local element typed by a code list also CARRIES that list's codeListName (named lists only; an
// anonymous list has none) and codeListDocumentation (absent when the list has none): the derived
// bridge renders only its subject's own properties, and code lists are evidence for their element
// (QUIET_ORBIT, phase F6's first commit). Neither is a declared text, and the round trip never reads
// them. In the seven built releases no attribute or global element is typed by a code list (measured).
//
// REACHABILITY AND OCCURRENCES (phase F3, §2.8; reachability.js walks, this file mints). Before any
// node is minted the walk from the document root runs, so every source node is minted already
// stamped: reachableFromRoot on declarations, definitions, anonymous types and codes; on each element
// declaration its paths (contextText of the first, contextPathSampleList with the first
// PER_SECTION_SAMPLE_COUNT readable paths of every section it occurs in, contextPathCount,
// occurrenceSectionList, reachableVia). After the source nodes it mints one …Occurrence per path,
// parented on its parent occurrence (the root global element at the top) so the parentId chain IS the
// document path, with HAS_INSTANCE declaration → occurrence and HAS_CHILD parent → occurrence.
// An occurrence's sectionPath is the first SECTION_DEPTH_BELOW_ROOT segments below the root, or the
// whole path when it is shallower: a fact about the document the forge stamps; partitioning on it is
// the bridge's (FBB-001). Occurrences are derived: no text, no vector, no ordering group.
// A reachable attribute is refused by name: no release reaches one (DESIGN-pescBridge.md §1.1,
// measured), and an attribute has no element path for an occurrence to name.
//
// THE FORGE DOES NO BRIDGING (FBB-001): the walk ends with a scan that refuses any property whose
// name speaks of CEDS (gate F14).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { EDGE_TYPES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const resolutionTableLib = require('./resolutionTable');
const { definitionDigestOf } = require('./definitionDigest');
const { makeSequenceGroupCollector, GROUP_KIND } = require('./sequenceGroups');
const reachabilityLib = require('./reachability');
const { contextTextOf } = require('./contextText');

const { SYMBOL_SPACE } = resolutionTableLib;
const ELEMENT_SEGMENT = 'el';
const ATTRIBUTE_SEGMENT = 'attr';
const ANONYMOUS_SEGMENT = 'anon';
const CODE_SEGMENT = 'code';
const RELEASE_RECORD_SEGMENT = 'release';
const SCHEMA_FILE_SEGMENT = 'file';
const DOCUMENTATION_SOURCE = Object.freeze({ OWN: 'own', TYPE: 'type' });
const BRIDGING_PROPERTY_NAME_RE = /ceds/i;
// the section rule (§2.8): the first two segments BELOW the root element
const SECTION_DEPTH_BELOW_ROOT = 2;
// the declaration's path sample (§2.2): the first two readable paths of every section it occurs in
const PER_SECTION_SAMPLE_COUNT = 2;
const REACHABLE_VIA_ORDER = Object.freeze([reachabilityLib.REACHABLE_VIA.CONTENT, reachabilityLib.REACHABLE_VIA.BASE, reachabilityLib.REACHABLE_VIA.XSI_TYPE]);

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
const SOURCE_CARRY_LIST = Object.freeze(['sourceFileName', 'documentPosition', 'sequencePosition', 'releaseIndependentId', 'definitionDigest', 'reachableFromRoot']);
const PATH_CARRY_LIST = Object.freeze(['contextText', 'contextPathSampleList', 'contextPathCount', 'occurrenceSectionList', 'reachableVia']);
const CARRY_LIST_BY_NODE_KIND = Object.freeze({
	releaseRecord: Object.freeze(['releaseName', 'standard', 'version', 'closureDigest', 'closureDate', 'closureDatePrecision', 'closureDateEvidence', 'verdict', 'pinDecisionsApplied', 'librariesNamed', 'rootChangeLogLineList', 'expanderManifestFormat', 'sourceCorpusDigest']),
	schemaFile: Object.freeze(['sourceFileName', 'releaseIndependentId', 'sha256', 'byteCount', 'targetNamespace', 'layer', 'importList', 'schemaAttributeList', 'fileDocumentation']),
	type: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'contentModelShape', 'baseTypeQName', 'derivationVariety', 'contentStyle', 'facets', 'abstractAsWritten'])),
	anonymousType: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'contentModelShape', 'baseTypeQName', 'derivationVariety', 'contentStyle', 'facets'])),
	codeList: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'baseTypeQName', 'derivationVariety', 'facets', 'codeCount'])),
	dataType: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'baseTypeQName', 'derivationVariety', 'facets'])),
	group: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'documentationValueList', 'contentModelShape'])),
	globalElement: Object.freeze(SOURCE_CARRY_LIST.concat(['targetNamespace', 'documentation', 'typeQName', 'typeAsWritten', 'typeName', 'substitutionGroupQName', 'abstractAsWritten', 'nillableAsWritten'], PATH_CARRY_LIST)),
	// codeListName and codeListDocumentation: the code list an element is typed by, carried onto the element
	// because the derived bridge renders only the subject's own properties (QUIET_ORBIT, F6 first commit);
	// not text-declared, and the round trip never reads them (the list is regenerated from its own node)
	element: Object.freeze(SOURCE_CARRY_LIST.concat(['documentation', 'typeQName', 'typeAsWritten', 'typeName', 'minOccursAsWritten', 'maxOccursAsWritten', 'nillableAsWritten', 'formAsWritten', 'defaultAsWritten', 'fixedAsWritten', 'owningTypeName', 'effectiveDocumentation', 'documentationSource', 'codeListName', 'codeListDocumentation'], PATH_CARRY_LIST)),
	attribute: Object.freeze(SOURCE_CARRY_LIST.concat(['documentation', 'typeQName', 'typeAsWritten', 'typeName', 'useAsWritten', 'owningTypeName', 'effectiveDocumentation', 'documentationSource'])),
	// a code whose value is the empty string carries no value (absent is absent, gate F7) and
	// valueIsEmptyString true, so the round trip can write value="" without guessing (phase F4 ruling);
	// documentationValueList is every documentation string as written, an empty one included
	code: Object.freeze(SOURCE_CARRY_LIST.concat(['value', 'valueIsEmptyString', 'documentation', 'documentationValueList', 'codePosition'])),
	occurrence: Object.freeze(['contextPath', 'contextText', 'sectionPath', 'documentDepth', 'reachableVia', 'xsiTypeName']),
});

const isAbsent = (factValue) => factValue === null || factValue === undefined || factValue === '' || (Array.isArray(factValue) && factValue.length === 0);
const presentFactsOf = (facts) => Object.keys(facts).reduce((soFar, factName) => (isAbsent(facts[factName]) ? soFar : { ...soFar, [factName]: facts[factName] }), {});
const jsonOrAbsent = (jsonValue) => (isAbsent(jsonValue) || (typeof jsonValue === 'object' && !Array.isArray(jsonValue) && Object.keys(jsonValue).length === 0) ? null : JSON.stringify(jsonValue));
const qualifiedTypeNameOf = (resolvedReference) => `${resolvedReference.referencedNamespace}#${resolvedReference.localName}`;
const nonBlankOrNull = (text) => (typeof text === 'string' && text.trim() !== '' ? text : null);

// identity of a local element and of an anonymous type (§2.3); reachability.js names declarations
// through these, so a declaration has one stableId whoever names it
const elementStableIdOf = ({ ownerStableId, oneElement }) => `${ownerStableId}/${ELEMENT_SEGMENT}/${oneElement.sequencePosition}:${oneElement.name}`;
const anonymousTypeStableIdOf = (ownerDeclarationStableId) => `${ownerDeclarationStableId}/${ANONYMOUS_SEGMENT}`;
const sectionPathOf = (contextPathSegmentList) => contextPathSegmentList.slice(0, 1 + SECTION_DEPTH_BELOW_ROOT).join(reachabilityLib.PATH_SEPARATOR);

// what a declaration's occurrences say about it, in document order (§2.2)
const pathFactsOf = (occurrenceList) => {
	const sectionPathList = [];
	const readablePathListBySection = {};
	occurrenceList.forEach((oneOccurrence) => {
		const sectionPath = sectionPathOf(oneOccurrence.contextPathSegmentList);
		if (readablePathListBySection[sectionPath] === undefined) {
			readablePathListBySection[sectionPath] = [];
			sectionPathList.push(sectionPath);
		}
		readablePathListBySection[sectionPath].push(contextTextOf(oneOccurrence.contextPathSegmentList.join(reachabilityLib.PATH_SEPARATOR)));
	});
	const viaSet = new Set(occurrenceList.map((oneOccurrence) => oneOccurrence.reachableVia));
	return {
		contextText: contextTextOf(occurrenceList[0].contextPathSegmentList.join(reachabilityLib.PATH_SEPARATOR)),
		contextPathSampleList: sectionPathList.reduce((soFar, oneSectionPath) => soFar.concat(readablePathListBySection[oneSectionPath].slice(0, PER_SECTION_SAMPLE_COUNT)), []),
		contextPathCount: occurrenceList.length,
		occurrenceSectionList: sectionPathList.slice().sort(),
		reachableVia: REACHABLE_VIA_ORDER.filter((oneVia) => viaSet.has(oneVia)),
	};
};

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

	// ---- reachability first (reachability.js), so every node is minted already stamped
	const { occurrenceList, reachableDefinitionStableIdSet, rootGlobalElementStableIdList, reachabilityStats } = reachabilityLib.computeReachability({
		artifacts,
		topLevelByQualifiedName,
		resolveOrRefuse,
		elementStableIdOf,
		anonymousTypeStableIdOf,
		typeSymbolSpace: SYMBOL_SPACE.TYPE,
		groupSymbolSpace: SYMBOL_SPACE.GROUP,
	});
	const occurrenceListByDeclaration = new Map();
	occurrenceList.forEach((oneOccurrence) => {
		const declarationOccurrenceList = occurrenceListByDeclaration.get(oneOccurrence.declarationStableId) || [];
		declarationOccurrenceList.push(oneOccurrence);
		occurrenceListByDeclaration.set(oneOccurrence.declarationStableId, declarationOccurrenceList);
	});
	const rootGlobalElementStableIdSet = new Set(rootGlobalElementStableIdList);
	const declarationIsReachable = (declarationStableId) => occurrenceListByDeclaration.has(declarationStableId) || rootGlobalElementStableIdSet.has(declarationStableId);
	const declarationPathFactsOf = (declarationStableId) => (occurrenceListByDeclaration.has(declarationStableId) ? pathFactsOf(occurrenceListByDeclaration.get(declarationStableId)) : {});

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

	// the type edge of any element-like declaration to the named type it references
	const addTypeEdge = ({ declarationStableId, target }) => {
		if (target === null) {
			return;
		}
		const typeEdgeType = TYPE_EDGE_BY_TARGET_NODE_KIND[target.nodeKind];
		if (typeEdgeType === undefined) {
			throw refuse.byName({ moduleName, what: `${declarationStableId} is typed by a ${target.nodeKind} (${target.stableId})`, where: `a declaration's type is one of ${Object.keys(TYPE_EDGE_BY_TARGET_NODE_KIND).join(', ')}` });
		}
		addEdge({ edgeType: typeEdgeType, fromStableId: declarationStableId, toStableId: target.stableId });
	};

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

	const emitCodes = ({ container, codeListStableId, artifact, reachableFromRoot }) => {
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
					facts: { sourceFileName: artifact.filename, releaseIndependentId: releaseIndependentIdOf(codeStableId), definitionDigest: definitionDigestOf(oneValue), reachableFromRoot, value: oneValue.value, valueIsEmptyString: oneValue.value === '' ? true : null, documentation: nonBlankOrNull(oneValue.documentation), documentationValueList: oneValue.documentationValues, codePosition },
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
	// the code list an element is typed by, named or anonymous: its name (an anonymous list has none, so
	// none is stamped) and its documentation; an element not typed by a code list gets neither
	const codeListFactsOf = ({ target, anonymousType }) => {
		if (anonymousType !== null) {
			return NODE_KIND_BY_ANONYMOUS_VARIETY[anonymousType.typeVariety](anonymousType.body) === 'codeList' ? { codeListName: null, codeListDocumentation: nonBlankOrNull(anonymousType.body.documentation) } : {};
		}
		return target !== null && target.nodeKind === 'codeList' ? { codeListName: target.definition.name, codeListDocumentation: nonBlankOrNull(target.definition.documentation) } : {};
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
		const anonymousStableId = anonymousTypeStableIdOf(ownerDeclarationStableId);
		const reachableFromRoot = declarationIsReachable(ownerDeclarationStableId);
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
				reachableFromRoot,
				targetNamespace: artifact.targetNamespace,
				documentation: nonBlankOrNull(anonymousType.body.documentation),
				documentationValueList: anonymousType.body.documentationValues,
				contentModelShape: jsonOrAbsent(anonymousType.body.contentModelShape),
				...derivationFacts,
				codeCount,
			},
		});
		if (nodeKind === 'codeList') {
			emitCodes({ container: anonymousType.body, codeListStableId: anonymousStableId, artifact, reachableFromRoot });
			addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: ownerDeclarationStableId, toStableId: anonymousStableId });
		}
		emitContainerContent({ container: anonymousType.body, ownerStableId: anonymousStableId, owningTypeName: null, artifact, ownerIsReachable: reachableFromRoot });
		return anonymousStableId;
	};

	const emitContainerContent = ({ container, ownerStableId, owningTypeName, artifact, ownerIsReachable }) => {
		const elementStableIdList = [];
		container.elements.forEach((oneElement) => {
			const elementStableId = elementStableIdOf({ ownerStableId, oneElement });
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
					reachableFromRoot: declarationIsReachable(elementStableId),
					documentation: ownDocumentation,
					typeQName: typed.resolvedReference === null ? null : qualifiedTypeNameOf(typed.resolvedReference),
					typeAsWritten: oneElement.typeAsWritten,
					typeName: typed.resolvedReference === null ? null : typed.resolvedReference.localName,
					minOccursAsWritten: oneElement.minOccursAsWritten,
					maxOccursAsWritten: oneElement.maxOccursAsWritten,
					nillableAsWritten: oneElement.nillableAsWritten,
					formAsWritten: oneElement.formAsWritten,
					defaultAsWritten: oneElement.defaultAsWritten,
					fixedAsWritten: oneElement.fixedAsWritten,
					owningTypeName,
					...effectiveDocumentationFactsOf({ ownDocumentation, typeDocumentation: typeDocumentationOf({ target: typed.target, anonymousType: oneElement.anonymousType }) }),
					...codeListFactsOf({ target: typed.target, anonymousType: oneElement.anonymousType }),
					...declarationPathFactsOf(elementStableId),
				},
			});
			addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: ownerStableId, toStableId: elementStableId });
			addTypeEdge({ declarationStableId: elementStableId, target: typed.target });
			if (oneElement.anonymousType !== null) {
				emitAnonymousType({ anonymousType: oneElement.anonymousType, ownerDeclarationStableId: elementStableId, ownerDeclarationName: oneElement.name, artifact });
			}
			elementStableIdList.push(elementStableId);
		});
		container.attributes.forEach((oneAttribute) => {
			const attributeStableId = `${ownerStableId}/${ATTRIBUTE_SEGMENT}/${oneAttribute.attributePosition}:${oneAttribute.name}`;
			const typed = oneAttribute.typeAsWritten === null ? { resolvedReference: null, target: null } : resolveOrRefuse({ artifact, writtenQName: oneAttribute.typeAsWritten, referencedKind: SYMBOL_SPACE.TYPE, siteText: `${attributeStableId} type` });
			const ownDocumentation = nonBlankOrNull(oneAttribute.documentation);
			if (ownerIsReachable) {
				throw refuse.byName({ moduleName, what: `attribute '${attributeStableId}' sits on a reachable owner`, where: 'no release reaches an attribute (DESIGN-pescBridge.md §1.1, measured); an attribute has no element path, so its occurrence rule is undesigned: design it, do not let it pass unmarked' });
			}
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
					reachableFromRoot: false,
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
			addTypeEdge({ declarationStableId: attributeStableId, target: typed.target });
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
			const reachableFromRoot = nodeKind === 'globalElement' ? declarationIsReachable(stableId) : reachableDefinitionStableIdSet.has(stableId);
			const commonFacts = {
				sourceFileName: oneArtifact.filename,
				documentPosition: oneDefinition.documentPosition,
				releaseIndependentId: releaseIndependentIdOf(stableId),
				definitionDigest: definitionDigestOf(oneDefinition),
				reachableFromRoot,
				targetNamespace: oneArtifact.targetNamespace,
				documentation: nonBlankOrNull(oneDefinition.documentation),
			};
			if (nodeKind === 'globalElement') {
				const typed = oneDefinition.typeAsWritten === null ? { resolvedReference: null, target: null } : resolveOrRefuse({ artifact: oneArtifact, writtenQName: oneDefinition.typeAsWritten, referencedKind: SYMBOL_SPACE.TYPE, siteText: `${stableId} type` });
				const headed = oneDefinition.substitutionGroupAsWritten === null ? { resolvedReference: null, target: null } : resolveOrRefuse({ artifact: oneArtifact, writtenQName: oneDefinition.substitutionGroupAsWritten, referencedKind: SYMBOL_SPACE.ELEMENT, siteText: `${stableId} substitutionGroup` });
				mintNode({
					nodeKind,
					stableId,
					name: oneDefinition.name,
					parentId: rootStableId,
					facts: {
						...commonFacts,
						// like an element's and an attribute's, the declaration plus its resolved type (verdict carry)
						definitionDigest: definitionDigestOf({ globalElement: oneDefinition, resolvedType: typed.target === null ? null : typed.target.definition }),
						typeQName: typed.resolvedReference === null ? null : qualifiedTypeNameOf(typed.resolvedReference),
						typeAsWritten: oneDefinition.typeAsWritten,
						typeName: typed.resolvedReference === null ? null : typed.resolvedReference.localName,
						substitutionGroupQName: headed.resolvedReference === null ? null : qualifiedTypeNameOf(headed.resolvedReference),
						abstractAsWritten: oneDefinition.abstractAsWritten,
						nillableAsWritten: oneDefinition.nillableAsWritten,
						...(rootGlobalElementStableIdSet.has(stableId) ? { contextText: contextTextOf(oneDefinition.name) } : declarationPathFactsOf(stableId)),
					},
				});
				addTypeEdge({ declarationStableId: stableId, target: typed.target });
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
				emitCodes({ container, codeListStableId: stableId, artifact: oneArtifact, reachableFromRoot });
			}
			emitContainerContent({ container, ownerStableId: stableId, owningTypeName: oneDefinition.name, artifact: oneArtifact, ownerIsReachable: reachableFromRoot });
			definitionStableIdList.push(stableId);
		});
		sequenceGroupCollector.addGroup({ groupKey: `${stableIdPrefix}${SCHEMA_FILE_SEGMENT}/${oneArtifact.targetNamespace}#definitions`, members: definitionStableIdList, compositor: GROUP_KIND.DOCUMENT_ORDER });
	});

	// ---- the occurrences (§2.8), in document order: each parented on its parent occurrence or, at the
	// top, the root global element; HAS_INSTANCE from its declaration, HAS_CHILD from its parent
	const sectionPathSet = new Set();
	occurrenceList.forEach((oneOccurrence) => {
		const contextPath = oneOccurrence.contextPathSegmentList.join(reachabilityLib.PATH_SEPARATOR);
		const sectionPath = sectionPathOf(oneOccurrence.contextPathSegmentList);
		sectionPathSet.add(sectionPath);
		kit.makeNode({
			role: nodeKindTable.occurrence.role,
			perStandardLabel: nodeKindTable.occurrence.perStandardLabel,
			stableId: oneOccurrence.occurrenceStableId,
			name: oneOccurrence.declarationName,
			structural: { parentId: oneOccurrence.parentStableId, path: contextPath },
			carriedProperties: kit.carriedProperties({
				parsedObject: presentFactsOf({ contextPath, contextText: contextTextOf(contextPath), sectionPath, documentDepth: oneOccurrence.contextPathSegmentList.length - 1, reachableVia: oneOccurrence.reachableVia, xsiTypeName: oneOccurrence.xsiTypeName }),
				carryList: CARRY_LIST_BY_NODE_KIND.occurrence,
			}),
			origin: `occurrence ${oneOccurrence.occurrenceStableId}`,
		});
		nodeCountByKind.occurrence = (nodeCountByKind.occurrence || 0) + 1;
		addEdge({ edgeType: EDGE_TYPES.HAS_INSTANCE, fromStableId: oneOccurrence.declarationStableId, toStableId: oneOccurrence.occurrenceStableId });
		addEdge({ edgeType: EDGE_TYPES.HAS_CHILD, fromStableId: oneOccurrence.parentStableId, toStableId: oneOccurrence.occurrenceStableId });
	});

	// ---- F14: the forge names no bridge target
	kit.nodes.forEach((oneNode) => {
		const bridgingPropertyName = Object.keys(oneNode.properties).find((onePropertyName) => BRIDGING_PROPERTY_NAME_RE.test(onePropertyName));
		if (bridgingPropertyName !== undefined) {
			throw refuse.byName({ moduleName, what: `node '${oneNode.stableId}' carries property '${bridgingPropertyName}'`, where: 'THE FORGE DOES NO BRIDGING (FBB-001): no property of a PESC release graph names CEDS' });
		}
	});

	return {
		walkStats: {
			nodeCountByKind,
			edgeCountByType,
			documentationSourceCount,
			reachabilityStats: { ...reachabilityStats, occurrenceCount: occurrenceList.length, reachableDeclarationCount: occurrenceListByDeclaration.size, reachableDefinitionCount: reachableDefinitionStableIdSet.size, sectionCount: sectionPathSet.size },
		},
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

module.exports = { emitReleaseGraph, CARRY_LIST_BY_NODE_KIND, STABLE_ID_SEGMENT_BY_NODE_KIND, SECTION_DEPTH_BELOW_ROOT, PER_SECTION_SAMPLE_COUNT, sectionPathOf, moduleName };
