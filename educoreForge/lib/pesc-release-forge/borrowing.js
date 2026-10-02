'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// borrowing.js — phase F-B, borrowed text (DESIGN-pescForge.md §2.7; WORKORDER §3 F-B; NOTES 28b).
// PURE and synchronous, like the walk that calls it.
//
//   structuralDigestOf({ definition }) → sha256 hex, DOCUMENTATION-BLIND
//   makeBorrowingIndex({ donorArtifactList }) → { donorTextFor({ ownerDefinition, ownerArtifact, elementName }) }
//     donorTextFor → { borrowedDocumentation, borrowedFrom } | null
//
// An element with no text of its own borrows a LATER edition's text when a later edition of the same
// library family carries a complex type of the same local name, with the same structural digest,
// holding an element of the same name that has text. The donor is the LATEST such edition.
//
// The structural digest is the owning type's element names, their type LOCAL names (an anonymous
// type is marked, never named), occurrence bounds, attribute names and derivation (variety and base
// local name); nothing else. It cannot be definitionDigest: the 2016 documentation pass changed the
// text of 811 of 883 CoreMain definitions, so a text-bearing digest would match almost nothing.
//
// What borrowing never touches (NOTES 28b): definitionDigest (computed from the parser's model, which
// a borrowed text never enters; shared-file identity depends on it) and the round trip (the emitter
// reads documentationValueList, never a borrowed property; roundTripPair.js names the exclusion).

const crypto = require('crypto');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

// a PESC namespace: urn:org:pesc:<layer>:<family>:v<major>.<minor>.<patch>
const PESC_EDITION_NAMESPACE_RE = /^urn:org:pesc:(codes|core|sector|message):([^:]+):v(\d+)\.(\d+)\.(\d+)$/;
const ANONYMOUS_TYPE_MARK = '(anonymous)';
const OWNER_DEFINITION_KIND = 'complexType';

const localNameOf = (writtenQName) => (writtenQName.indexOf(':') === -1 ? writtenQName : writtenQName.slice(writtenQName.indexOf(':') + 1));
const nonBlankOrNull = (text) => (typeof text === 'string' && text.trim() !== '' ? text : null);

const editionOf = (targetNamespace) => {
	const editionMatch = PESC_EDITION_NAMESPACE_RE.exec(targetNamespace);
	if (editionMatch === null) {
		throw refuse.byName({ moduleName, what: `namespace '${targetNamespace}' names no PESC edition`, where: 'borrowing compares editions of one library family: urn:org:pesc:<layer>:<family>:v<major>.<minor>.<patch>' });
	}
	return { familyName: `${editionMatch[1]}:${editionMatch[2]}`, versionNumberList: [Number(editionMatch[3]), Number(editionMatch[4]), Number(editionMatch[5])] };
};
const compareVersionNumberLists = (leftList, rightList) => {
	const differingIndex = leftList.findIndex((oneNumber, numberIndex) => oneNumber !== rightList[numberIndex]);
	return differingIndex === -1 ? 0 : leftList[differingIndex] - rightList[differingIndex];
};

const structuralDigestOf = ({ definition }) => {
	const content = definition.content;
	const typeLocalNameOf = (oneElement) => (oneElement.typeAsWritten !== null ? localNameOf(oneElement.typeAsWritten) : oneElement.anonymousType !== null ? ANONYMOUS_TYPE_MARK : null);
	const structure = [
		definition.kind,
		content.elements.map((oneElement) => [oneElement.name, typeLocalNameOf(oneElement), oneElement.minOccursAsWritten, oneElement.maxOccursAsWritten]),
		content.attributes.map((oneAttribute) => oneAttribute.name),
		content.derivations.map((oneDerivation) => [oneDerivation.variety, oneDerivation.baseAsWritten === null ? null : localNameOf(oneDerivation.baseAsWritten)]),
	];
	return crypto.createHash('sha256').update(JSON.stringify(structure), 'utf8').digest('hex');
};

const makeBorrowingIndex = ({ donorArtifactList }) => {
	// per family, newest edition first: the latest edition that matches is the donor
	const donorEditionListByFamily = {};
	donorArtifactList.forEach((oneArtifact) => {
		const { familyName, versionNumberList } = editionOf(oneArtifact.targetNamespace);
		const complexTypeByName = {};
		oneArtifact.definitions.filter((oneDefinition) => oneDefinition.kind === OWNER_DEFINITION_KIND).forEach((oneDefinition) => {
			complexTypeByName[oneDefinition.name] = oneDefinition;
		});
		donorEditionListByFamily[familyName] = (donorEditionListByFamily[familyName] || []).concat([{ artifact: oneArtifact, versionNumberList, complexTypeByName, structuralDigestByTypeName: {} }]);
	});
	Object.keys(donorEditionListByFamily).forEach((familyName) => {
		donorEditionListByFamily[familyName].sort((left, right) => compareVersionNumberLists(right.versionNumberList, left.versionNumberList));
	});
	const donorStructuralDigestOf = (donorEdition, typeName) => {
		if (donorEdition.structuralDigestByTypeName[typeName] === undefined) {
			donorEdition.structuralDigestByTypeName[typeName] = structuralDigestOf({ definition: donorEdition.complexTypeByName[typeName] });
		}
		return donorEdition.structuralDigestByTypeName[typeName];
	};

	const ownerStructuralDigestByDefinition = new Map();
	const donorTextFor = ({ ownerDefinition, ownerArtifact, elementName }) => {
		if (ownerDefinition.kind !== OWNER_DEFINITION_KIND) {
			return null;
		}
		const ownerEdition = editionOf(ownerArtifact.targetNamespace);
		if (!ownerStructuralDigestByDefinition.has(ownerDefinition)) {
			ownerStructuralDigestByDefinition.set(ownerDefinition, structuralDigestOf({ definition: ownerDefinition }));
		}
		const ownerStructuralDigest = ownerStructuralDigestByDefinition.get(ownerDefinition);
		const donorEdition = (donorEditionListByFamily[ownerEdition.familyName] || []).find((oneEdition) => {
			const donorType = oneEdition.complexTypeByName[ownerDefinition.name];
			if (donorType === undefined || compareVersionNumberLists(oneEdition.versionNumberList, ownerEdition.versionNumberList) <= 0) {
				return false;
			}
			const donorElement = donorType.content.elements.find((oneElement) => oneElement.name === elementName);
			return donorElement !== undefined && nonBlankOrNull(donorElement.documentation) !== null && donorStructuralDigestOf(oneEdition, ownerDefinition.name) === ownerStructuralDigest;
		});
		if (donorEdition === undefined) {
			return null;
		}
		const donorElement = donorEdition.complexTypeByName[ownerDefinition.name].content.elements.find((oneElement) => oneElement.name === elementName);
		return {
			borrowedDocumentation: donorElement.documentation,
			borrowedFrom: JSON.stringify({ donorNamespace: donorEdition.artifact.targetNamespace, donorFileName: donorEdition.artifact.filename, donorFileSha256: donorEdition.artifact.sha256, donorOwningTypeName: ownerDefinition.name }),
		};
	};

	return { donorTextFor };
};

module.exports = { structuralDigestOf, makeBorrowingIndex, editionOf, ANONYMOUS_TYPE_MARK, moduleName };
