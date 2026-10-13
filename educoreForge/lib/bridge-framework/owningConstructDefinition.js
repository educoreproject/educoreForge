'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// owningConstructDefinition.js — WHAT THE SOURCE ELEMENT BELONGS TO, in the source standard's own published words.
// Lane JEVQ (cedsRichness-101226), 2026-10-13, on TQ's "go" to the deep dive's first finding
// (deepDive-101326/REPORT-deepDive-101326.md §1, §4.3).
//
// THE FINDING. Jev was asked to match a source property without ever being told what the property's owning entity IS,
// although the graph holds a definition for it. Adding that definition to the source element (and taking Claude's
// system prompt out of Jev's state) moved Jev from 45/45/47 to 52/52/51 of 71 on the frozen evaluation hundred.
//
// WHAT THIS MODULE DOES. Given a subject node, the source standard's nodes by stableId and the plugin's DECLARED
// owningConstructDefinitionSource, it returns the owning construct's definition text, or no text and the reason there
// is none. It READS the forge's nodes; it never writes, repairs or borrows (FBB-001: the forge does not change). The
// framework calls it for a variant whose row says requiresOwningConstructDefinitionSource; the renderer puts the text
// into Jev's split question ONLY, so the text prompt every other judge reads is unchanged.
//
// THE SOURCE KINDS ARE A REGISTRY (one row each, never a branch on the kind name):
//   ownerNodeProperty  the subject names its owner by a property (parentId, in the shipped plugins), and the owner node
//                      carries the definition in a declared property (description). An owner WITHOUT that text is a
//                      measured, normal absence (extension entities, anonymous types): no text, reason recorded. An owner
//                      reference that names no node is a graph defect and is refused by name.
//   none               the standard publishes no definition for its owning constructs (measured per plugin; the plugin
//                      says so in its declaration). Every subject renders without one, under the DECLARED reason.
//
//   owningConstructDefinitionFor({ subjectNode, subjectNodeByStableId, owningConstructDefinitionSource })
//     → { owningConstructDefinition: string, absentReason: null } | { owningConstructDefinition: null, absentReason: string } | { error }
//   owningConstructDefinitionSourceReason(value) → '' when the declaration is well-formed, else the reason it is not

const refuse = require('../forge-framework/refuse');

const ABSENT_REASON_OWNER_HAS_NO_DEFINITION = 'ownerHasNoDefinitionText';
const ABSENT_REASON_DECLARED_NONE_PREFIX = 'declaredNone';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonBlankString = (candidate) => typeof candidate === 'string' && candidate.trim() !== '';

// definitionTextOf — a property value as definition text: a non-blank string, trimmed; anything else is no text
const definitionTextOf = (propertyValue) => (isNonBlankString(propertyValue) ? propertyValue.trim() : null);

const OWNING_CONSTRUCT_DEFINITION_SOURCE_KIND_REGISTRY = Object.freeze({
	ownerNodeProperty: Object.freeze({
		memberNameList: Object.freeze(['kind', 'ownerReferencePropertyName', 'definitionPropertyName']),
		declarationReason: (declaration) =>
			!isNonBlankString(declaration.ownerReferencePropertyName) || !isNonBlankString(declaration.definitionPropertyName) ? 'ownerNodeProperty needs a non-blank ownerReferencePropertyName and definitionPropertyName' : '',
		resolve: ({ subjectNode, subjectNodeByStableId, owningConstructDefinitionSource }) => {
			const ownerStableId = subjectNode.properties[owningConstructDefinitionSource.ownerReferencePropertyName];
			if (!isNonBlankString(ownerStableId)) {
				return { error: refuse.byName({ moduleName, what: `subject ${subjectNode.stableId} carries no '${owningConstructDefinitionSource.ownerReferencePropertyName}'`, where: 'the declared owner reference names the owning construct; a subject without one is a forge/declaration disagreement, never a silent absence' }) };
			}
			const ownerNode = subjectNodeByStableId[ownerStableId];
			if (ownerNode === undefined) {
				return { error: refuse.byName({ moduleName, what: `subject ${subjectNode.stableId} names owner '${ownerStableId}', which is not a node of the source standard`, where: 'an owner reference that resolves to nothing is a graph defect; the definition is never guessed or borrowed' }) };
			}
			const definitionText = definitionTextOf(ownerNode.properties[owningConstructDefinitionSource.definitionPropertyName]);
			return definitionText === null ? { owningConstructDefinition: null, absentReason: ABSENT_REASON_OWNER_HAS_NO_DEFINITION } : { owningConstructDefinition: definitionText, absentReason: null };
		},
	}),
	none: Object.freeze({
		memberNameList: Object.freeze(['kind', 'reason']),
		declarationReason: (declaration) => (!isNonBlankString(declaration.reason) ? "kind 'none' needs a non-blank reason saying why the standard has no owning-construct definition" : ''),
		resolve: ({ owningConstructDefinitionSource }) => ({ owningConstructDefinition: null, absentReason: `${ABSENT_REASON_DECLARED_NONE_PREFIX}: ${owningConstructDefinitionSource.reason}` }),
	}),
});
const OWNING_CONSTRUCT_DEFINITION_SOURCE_KIND_LIST = Object.freeze(Object.keys(OWNING_CONSTRUCT_DEFINITION_SOURCE_KIND_REGISTRY));

const owningConstructDefinitionSourceReason = (declaration) => {
	if (!isPlainObject(declaration)) {
		return `owningConstructDefinitionSource must be an object, got ${JSON.stringify(declaration)}`;
	}
	const kindRow = OWNING_CONSTRUCT_DEFINITION_SOURCE_KIND_REGISTRY[declaration.kind];
	if (kindRow === undefined) {
		return `owningConstructDefinitionSource.kind ${JSON.stringify(declaration.kind)} is not one of ${OWNING_CONSTRUCT_DEFINITION_SOURCE_KIND_LIST.join(', ')}`;
	}
	const strayMemberList = Object.keys(declaration).filter((memberName) => kindRow.memberNameList.indexOf(memberName) === -1);
	if (strayMemberList.length) {
		return `owningConstructDefinitionSource kind '${declaration.kind}' carries undeclared member(s) ${strayMemberList.join(', ')}; its members are ${kindRow.memberNameList.join(', ')}`;
	}
	return kindRow.declarationReason(declaration);
};

const owningConstructDefinitionFor = ({ subjectNode, subjectNodeByStableId, owningConstructDefinitionSource }) => {
	const declarationReason = owningConstructDefinitionSourceReason(owningConstructDefinitionSource);
	if (declarationReason) {
		return { error: refuse.byName({ moduleName, what: declarationReason, where: 'the plugin declares owningConstructDefinitionSource; bridgePluginContract checks it at registration' }) };
	}
	if (!isPlainObject(subjectNode) || !isPlainObject(subjectNode.properties) || !isNonBlankString(subjectNode.stableId)) {
		return { error: refuse.byName({ moduleName, what: 'subjectNode is not { stableId, properties }', where: 'the framework passes the subject node it read' }) };
	}
	return OWNING_CONSTRUCT_DEFINITION_SOURCE_KIND_REGISTRY[owningConstructDefinitionSource.kind].resolve({ subjectNode, subjectNodeByStableId, owningConstructDefinitionSource });
};

module.exports = {
	OWNING_CONSTRUCT_DEFINITION_SOURCE_KIND_LIST,
	ABSENT_REASON_OWNER_HAS_NO_DEFINITION,
	ABSENT_REASON_DECLARED_NONE_PREFIX,
	owningConstructDefinitionFor,
	owningConstructDefinitionSourceReason,
	moduleName,
};
