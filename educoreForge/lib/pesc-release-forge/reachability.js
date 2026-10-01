'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// reachability.js — the walk from the message root element of one PESC release: every path at
// which an element can appear in a document of this release (DESIGN-pescForge.md §2.8; WORKORDER
// §3 F3). PURE and synchronous, inside the framework's buildContractGraph like walk.js, so a throw
// is the sanctioned refusal.
//
//   computeReachability({ artifacts, topLevelByQualifiedName, resolveOrRefuse, elementStableIdOf,
//                         anonymousTypeStableIdOf, typeSymbolSpace, groupSymbolSpace })
//     → { occurrenceList, reachableDefinitionStableIdSet, rootGlobalElementStableIdList, reachabilityStats }
//
// It reads the parser's model only and mints nothing: walk.js owns identity and minting, and hands
// in its own resolution (resolveOrRefuse) and its own id rules (elementStableIdOf,
// anonymousTypeStableIdOf), so a declaration has ONE stableId whoever names it.
//
// THE RULE. From each global element of the message-layer file (the document root), in document
// order (the compositor tree's particle order), follow:
//   content   the content model of the element's type: elements, nested compositors, group references;
//             an element's anonymous type is its content
//   base      the content of the base of an extension, BEFORE the extension's own (XSD's order), up
//             the whole base chain
//   xsiType   every extension subtype of a type an element is typed by, because an instance may name
//             it with xsi:type wherever the base is expected: each subtype's OWN extension layer is
//             walked under the element after the base's content, then its own subtypes' layers below it
//   NOT xs:any: anything may appear in a wildcard, so nothing is reachable through it
//             (WILDCARD_IS_FOLLOWED is false; gate F9's twin makes it true)
// Substitution groups are not followed because none can be reached: a head is reached only through
// <xs:element ref=…>, which the parser refuses (code fact, xsdParser.js walkElementDecl).
// Recursion: a named complex type already on the current path is not entered again (its element is
// still an occurrence; its content is not repeated). The rule and the guard are the planner's
// (evidence/q4SectionSpan/sectionCensus.js), whose counts are the work order's literals.
//
// WHAT IT RETURNS. One occurrence per (declaration, path), in document order:
//   { occurrenceStableId '<declarationStableId>/at/<contextPath>', declarationStableId, declarationName,
//     parentStableId (the parent occurrence, or the root global element at the top), contextPathSegmentList,
//     reachableVia, xsiTypeName (only under a substitution: the nearest substituted type's local name) }
// reachableVia is 'xsiType' for every occurrence at or under a substituted layer (an instance must name
// the type for any of them to exist); otherwise 'base' when the declaration sits in a base type's
// content at this step, else 'content'. A declaration reaching one path twice is refused by name: the
// walk would have counted one place twice.
// reachableDefinitionStableIdSet: every named type (complex, code list, data type) that types a reached
// declaration, every group whose content was walked, and every substituted subtype; the planner's
// "reachable named types and groups" (evidence/graphModel.js reachedType).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const OCCURRENCE_SEGMENT = 'at';
const PATH_SEPARATOR = '/';
const MESSAGE_LAYER = 'message';
const REACHABLE_VIA = Object.freeze({ CONTENT: 'content', BASE: 'base', XSI_TYPE: 'xsiType' });
const EXTENSION_VARIETY = 'extension';
const COMPLEX_TYPE_NODE_KIND = 'type';

// xs:any is not followed (DESIGN-pescForge.md §2.8, stand-down item 6). Were it followed, a wildcard
// would admit every global element that is not a document root (gate F9's twin sets this true)
const WILDCARD_IS_FOLLOWED = false;

const singleExtensionOf = (container) => container.derivations.find((oneDerivation) => oneDerivation.variety === EXTENSION_VARIETY);

// which extension subtypes an element typed by their base may name with xsi:type, by rule name
const SUBSTITUTABLE_SUBTYPE_RULE = Object.freeze({
	// the planner's rule, whose counts are the work order's literals (evidence/q4SectionSpan/sectionCensus.js):
	// a subtype that types a reached element somewhere is not substituted anywhere
	subtypesNotReachedByContent: ({ oneSubtype, contentReachedTypeStableIdSet }) => !contentReachedTypeStableIdSet.has(oneSubtype.stableId),
	// the rule as DESIGN-pescForge.md §2.8 words it: every extension subtype, everywhere
	everySubtype: () => true,
});
const SUBSTITUTABLE_SUBTYPE_RULE_NAME = 'subtypesNotReachedByContent';

const computeReachability = (reachabilityArgs) => {
	if (SUBSTITUTABLE_SUBTYPE_RULE[SUBSTITUTABLE_SUBTYPE_RULE_NAME] === undefined) {
		throw refuse.byName({ moduleName, what: `substitution rule '${SUBSTITUTABLE_SUBTYPE_RULE_NAME}'`, where: `a rule is one of ${Object.keys(SUBSTITUTABLE_SUBTYPE_RULE).join(', ')}` });
	}
	// pass 1, no substitution: the complex types that type a reached element by content and base alone
	const contentPass = walkFromRoots({ ...reachabilityArgs, isSubstitutable: () => false });
	const contentReachedTypeStableIdSet = contentPass.complexTypeTypingReachedElementSet;
	// pass 2, the release's reachability
	const releasePass = walkFromRoots({ ...reachabilityArgs, isSubstitutable: (oneSubtype) => SUBSTITUTABLE_SUBTYPE_RULE[SUBSTITUTABLE_SUBTYPE_RULE_NAME]({ oneSubtype, contentReachedTypeStableIdSet }) });
	return {
		occurrenceList: releasePass.occurrenceList,
		reachableDefinitionStableIdSet: releasePass.reachableDefinitionStableIdSet,
		rootGlobalElementStableIdList: releasePass.rootGlobalElementStableIdList,
		reachabilityStats: {
			...releasePass.reachabilityStats,
			substitutableSubtypeRuleName: SUBSTITUTABLE_SUBTYPE_RULE_NAME,
			contentAndBaseOccurrenceCount: contentPass.occurrenceList.length,
			contentAndBaseDeclarationCount: new Set(contentPass.occurrenceList.map((oneOccurrence) => oneOccurrence.declarationStableId)).size,
			contentAndBaseDefinitionCount: contentPass.reachableDefinitionStableIdSet.size,
		},
	};
};

const walkFromRoots = ({ artifacts, topLevelByQualifiedName, resolveOrRefuse, elementStableIdOf, anonymousTypeStableIdOf, typeSymbolSpace, groupSymbolSpace, isSubstitutable }) => {
	const occurrenceList = [];
	const complexTypeTypingReachedElementSet = new Set();
	const parentByPathByDeclaration = new Map();
	const reachableDefinitionStableIdSet = new Set();
	const reachabilityStats = { wildcardParticleCount: 0, recursionStopCount: 0, substitutedLayerCount: 0 };

	const topLevelEntryList = Object.keys(topLevelByQualifiedName).map((oneQualifiedName) => topLevelByQualifiedName[oneQualifiedName]);

	// the named complex type an extension derives from, or null (simple content extends a simple type)
	const extensionBaseOf = (typeEntry) => {
		const extension = singleExtensionOf(typeEntry.definition.content);
		if (extension === undefined) {
			return null;
		}
		const { target } = resolveOrRefuse({ artifact: typeEntry.artifact, writtenQName: extension.baseAsWritten, referencedKind: typeSymbolSpace, siteText: `${typeEntry.stableId} extension base (reachability)` });
		return target !== null && target.nodeKind === COMPLEX_TYPE_NODE_KIND ? target : null;
	};

	// direct extension subtypes of each named complex type, in the release's definition order
	const directSubtypeListByBaseStableId = {};
	topLevelEntryList
		.filter((oneEntry) => oneEntry.nodeKind === COMPLEX_TYPE_NODE_KIND)
		.forEach((oneEntry) => {
			const baseEntry = extensionBaseOf(oneEntry);
			if (baseEntry !== null) {
				(directSubtypeListByBaseStableId[baseEntry.stableId] = directSubtypeListByBaseStableId[baseEntry.stableId] || []).push(oneEntry);
			}
		});

	const recordOccurrence = ({ declarationStableId, declarationName, parentOccurrence, reachableVia, xsiTypeName }) => {
		const contextPathSegmentList = parentOccurrence.contextPathSegmentList.concat([declarationName]);
		const contextPath = contextPathSegmentList.join(PATH_SEPARATOR);
		const parentByPath = parentByPathByDeclaration.get(declarationStableId) || new Map();
		if (parentByPath.has(contextPath)) {
			throw refuse.byName({ moduleName, what: `declaration '${declarationStableId}' reaches '${contextPath}' twice (under '${parentByPath.get(contextPath)}' and under '${parentOccurrence.occurrenceStableId}')`, where: 'one declaration, one occurrence per path (DESIGN-pescForge.md §2.3, gate F18): a second visit is a walk that counted one place twice' });
		}
		parentByPath.set(contextPath, parentOccurrence.occurrenceStableId);
		parentByPathByDeclaration.set(declarationStableId, parentByPath);
		const occurrence = {
			occurrenceStableId: `${declarationStableId}/${OCCURRENCE_SEGMENT}/${contextPath}`,
			declarationStableId,
			declarationName,
			parentStableId: parentOccurrence.occurrenceStableId,
			contextPathSegmentList,
			reachableVia,
			...(xsiTypeName === null ? {} : { xsiTypeName }),
		};
		occurrenceList.push(occurrence);
		return occurrence;
	};

	// the walk's state at one step: where it is (parentOccurrence), which named types are on the path
	// (ancestryStableIdSet), how this type's content was reached (stepVia) and under which substitution
	const walkParticleList = ({ particleList, container, artifact, ownerStableId, walkState }) => {
		particleList.forEach((oneParticle) => {
			if (oneParticle.element !== undefined) {
				visitElement({ oneElement: container.elements[oneParticle.element - 1], artifact, ownerStableId, walkState });
				return;
			}
			if (oneParticle.groupRef !== undefined) {
				const { target } = resolveOrRefuse({ artifact, writtenQName: oneParticle.groupRef, referencedKind: groupSymbolSpace, siteText: `${ownerStableId} group ref (reachability)` });
				reachableDefinitionStableIdSet.add(target.stableId);
				walkContainer({ container: target.definition.content, artifact: target.artifact, ownerStableId: target.stableId, walkState });
				return;
			}
			if (oneParticle.compositor !== undefined) {
				walkParticleList({ particleList: oneParticle.particles, container, artifact, ownerStableId, walkState });
				return;
			}
			reachabilityStats.wildcardParticleCount++;
			if (WILDCARD_IS_FOLLOWED) {
				nonRootGlobalElementEntryList().forEach((oneGlobalEntry) => visitGlobalElement({ globalEntry: oneGlobalEntry, walkState }));
			}
		});
	};
	const walkContainer = ({ container, artifact, ownerStableId, walkState }) => {
		if (container.contentModelShape !== null) {
			walkParticleList({ particleList: [container.contentModelShape], container, artifact, ownerStableId, walkState });
		}
	};

	// a named complex type's content at one occurrence: its base chain first, then its own
	const walkTypeContent = ({ typeEntry, walkState, stepVia }) => {
		const baseEntry = extensionBaseOf(typeEntry);
		if (baseEntry !== null) {
			walkTypeContent({ typeEntry: baseEntry, walkState, stepVia: REACHABLE_VIA.BASE });
		}
		walkContainer({ container: typeEntry.definition.content, artifact: typeEntry.artifact, ownerStableId: typeEntry.stableId, walkState: { ...walkState, stepVia: walkState.xsiTypeName === null ? stepVia : REACHABLE_VIA.XSI_TYPE } });
	};

	// each extension subtype's own layer, under an element typed by its base, then its own subtypes'
	const walkSubstitutedLayers = ({ baseEntry, walkState }) => {
		(directSubtypeListByBaseStableId[baseEntry.stableId] || []).filter(isSubstitutable).forEach((oneSubtype) => {
			if (walkState.ancestryStableIdSet.has(oneSubtype.stableId)) {
				reachabilityStats.recursionStopCount++;
				return;
			}
			reachabilityStats.substitutedLayerCount++;
			reachableDefinitionStableIdSet.add(oneSubtype.stableId);
			const layerWalkState = { ...walkState, ancestryStableIdSet: new Set([...walkState.ancestryStableIdSet, oneSubtype.stableId]), stepVia: REACHABLE_VIA.XSI_TYPE, xsiTypeName: oneSubtype.definition.name };
			walkContainer({ container: oneSubtype.definition.content, artifact: oneSubtype.artifact, ownerStableId: oneSubtype.stableId, walkState: layerWalkState });
			walkSubstitutedLayers({ baseEntry: oneSubtype, walkState: layerWalkState });
		});
	};

	// one element's occurrence here, and everything under it
	const descendInto = ({ occurrence, typeTarget, anonymousType, anonymousOwnerStableId, artifact, walkState }) => {
		const childWalkState = { ...walkState, parentOccurrence: occurrence, stepVia: REACHABLE_VIA.CONTENT };
		if (anonymousType !== null) {
			if (anonymousType.typeVariety === 'complexType') {
				walkContainer({ container: anonymousType.body, artifact, ownerStableId: anonymousOwnerStableId, walkState: { ...childWalkState, stepVia: walkState.xsiTypeName === null ? REACHABLE_VIA.CONTENT : REACHABLE_VIA.XSI_TYPE } });
			}
			return;
		}
		if (typeTarget === null || typeTarget.nodeKind !== COMPLEX_TYPE_NODE_KIND) {
			return;
		}
		complexTypeTypingReachedElementSet.add(typeTarget.stableId);
		if (walkState.ancestryStableIdSet.has(typeTarget.stableId)) {
			reachabilityStats.recursionStopCount++;
			return;
		}
		const typedWalkState = { ...childWalkState, ancestryStableIdSet: new Set([...walkState.ancestryStableIdSet, typeTarget.stableId]) };
		walkTypeContent({ typeEntry: typeTarget, walkState: typedWalkState, stepVia: REACHABLE_VIA.CONTENT });
		walkSubstitutedLayers({ baseEntry: typeTarget, walkState: typedWalkState });
	};

	const typeTargetOf = ({ declaration, artifact, declarationStableId }) => {
		if (declaration.typeAsWritten === null) {
			return null;
		}
		const { target } = resolveOrRefuse({ artifact, writtenQName: declaration.typeAsWritten, referencedKind: typeSymbolSpace, siteText: `${declarationStableId} type (reachability)` });
		if (target !== null) {
			reachableDefinitionStableIdSet.add(target.stableId);
		}
		return target;
	};

	const visitElement = ({ oneElement, artifact, ownerStableId, walkState }) => {
		const declarationStableId = elementStableIdOf({ ownerStableId, oneElement });
		const typeTarget = typeTargetOf({ declaration: oneElement, artifact, declarationStableId });
		const occurrence = recordOccurrence({ declarationStableId, declarationName: oneElement.name, parentOccurrence: walkState.parentOccurrence, reachableVia: walkState.stepVia, xsiTypeName: walkState.xsiTypeName });
		descendInto({ occurrence, typeTarget, anonymousType: oneElement.anonymousType, anonymousOwnerStableId: anonymousTypeStableIdOf(declarationStableId), artifact, walkState });
	};

	// a global element as a particle (only when a wildcard is followed, which the rule does not do)
	const visitGlobalElement = ({ globalEntry, walkState }) => {
		const typeTarget = typeTargetOf({ declaration: globalEntry.definition, artifact: globalEntry.artifact, declarationStableId: globalEntry.stableId });
		const occurrence = recordOccurrence({ declarationStableId: globalEntry.stableId, declarationName: globalEntry.definition.name, parentOccurrence: walkState.parentOccurrence, reachableVia: walkState.stepVia, xsiTypeName: walkState.xsiTypeName });
		descendInto({ occurrence, typeTarget, anonymousType: globalEntry.definition.anonymousType, anonymousOwnerStableId: anonymousTypeStableIdOf(globalEntry.stableId), artifact: globalEntry.artifact, walkState });
	};

	// ---- the roots: every global element of the message-layer file
	const messageArtifactNameList = artifacts.filter((oneArtifact) => oneArtifact.layer === MESSAGE_LAYER).map((oneArtifact) => oneArtifact.filename);
	const rootGlobalEntryList = topLevelEntryList.filter((oneEntry) => oneEntry.nodeKind === 'globalElement' && oneEntry.artifact.layer === MESSAGE_LAYER);
	if (rootGlobalEntryList.length === 0) {
		throw refuse.byName({ moduleName, what: `no global element in a '${MESSAGE_LAYER}'-layer file (message files: ${messageArtifactNameList.length ? messageArtifactNameList.join(', ') : 'none'})`, where: 'a release is one PESC message schema whose global element is the document root (DESIGN-pescForge.md §0)' });
	}
	const rootGlobalStableIdSet = new Set(rootGlobalEntryList.map((oneEntry) => oneEntry.stableId));
	const nonRootGlobalElementEntryList = () => topLevelEntryList.filter((oneEntry) => oneEntry.nodeKind === 'globalElement' && !rootGlobalStableIdSet.has(oneEntry.stableId));

	rootGlobalEntryList.forEach((oneRootEntry) => {
		const rootOccurrence = { occurrenceStableId: oneRootEntry.stableId, contextPathSegmentList: [oneRootEntry.definition.name] };
		const rootWalkState = { parentOccurrence: rootOccurrence, ancestryStableIdSet: new Set(), stepVia: REACHABLE_VIA.CONTENT, xsiTypeName: null };
		const typeTarget = typeTargetOf({ declaration: oneRootEntry.definition, artifact: oneRootEntry.artifact, declarationStableId: oneRootEntry.stableId });
		descendInto({ occurrence: rootOccurrence, typeTarget, anonymousType: oneRootEntry.definition.anonymousType, anonymousOwnerStableId: anonymousTypeStableIdOf(oneRootEntry.stableId), artifact: oneRootEntry.artifact, walkState: rootWalkState });
	});

	return {
		occurrenceList,
		reachableDefinitionStableIdSet,
		rootGlobalElementStableIdList: rootGlobalEntryList.map((oneEntry) => oneEntry.stableId),
		reachabilityStats,
		complexTypeTypingReachedElementSet,
	};
};

module.exports = { computeReachability, REACHABLE_VIA, OCCURRENCE_SEGMENT, PATH_SEPARATOR, moduleName };
