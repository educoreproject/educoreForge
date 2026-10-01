'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// releaseCensus.js — counts what one parsed PESC release contains, and compares the count with the
// bundle's frozen census (DESIGN-pescForge.md §6 gate F4; WORKORDER §3 F1).
//
//   measureReleaseCensus({ artifacts, referenceCensus }) → { census } | { refusalMessage }
//     census holds one integer per CENSUS_FIELD_NAME_LIST
//   compareReleaseCensus({ measuredCensus, frozenCensus, frozenCensusName }) → '' | refusal message
//
// The count is taken by walking the parser's artifact model, not by reading the parser's own
// parseAudit counters: a construct the model dropped would still have been counted by the audit,
// and the census exists to notice exactly that.
//
// Kinds, as the design's node-kind table (§2.1) sorts them: a simpleType whose restriction carries
// at least one xs:enumeration is a CODE LIST, any other simpleType is a DATA TYPE; the same rule
// splits the anonymous simple types. Codes are every enumeration value, named or anonymous owner.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

// the census fields in their frozen order: the frozen census file must name exactly these
const CENSUS_FIELD_NAME_LIST = Object.freeze([
	'fileCount',
	'importCount',
	'definitionCount',
	'complexTypeCount',
	'namedCodeListCount',
	'namedDataTypeCount',
	'groupCount',
	'globalElementCount',
	'elementDeclarationCount',
	'attributeDeclarationCount',
	'anonymousComplexTypeCount',
	'anonymousCodeListCount',
	'anonymousDataTypeCount',
	'codeCount',
	'facetCount',
	'groupReferenceCount',
	'anyWildcardCount',
	'referenceCount',
	'builtinReferenceCount',
	'inReleaseReferenceCount',
]);

// the reference census fields copied into the release census (resolutionTable.js measures them)
const REFERENCE_FIELD_NAME_LIST = Object.freeze(['referenceCount', 'builtinReferenceCount', 'inReleaseReferenceCount']);

const containerHasEnumeration = (container) => container.derivations.some((oneDerivation) => oneDerivation.enumerationValues.length > 0);

// ---- the walk ---------------------------------------------------------------------------------

const countContentModelShape = (contentModelShape, census) => {
	if (contentModelShape === null) {
		return;
	}
	contentModelShape.particles.forEach((oneParticle) => {
		if (oneParticle.groupRef !== undefined) {
			census.groupReferenceCount++;
			return;
		}
		if (oneParticle.any !== undefined) {
			census.anyWildcardCount++;
			return;
		}
		if (oneParticle.compositor !== undefined) {
			countContentModelShape(oneParticle, census);
		}
	});
};

const countContainer = (container, census) => {
	container.derivations.forEach((oneDerivation) => {
		census.codeCount += oneDerivation.enumerationValues.length;
		census.facetCount += Object.keys(oneDerivation.facets).length;
	});
	container.elements.forEach((oneElement) => {
		census.elementDeclarationCount++;
		if (oneElement.anonymousType !== null) {
			countAnonymousType(oneElement.anonymousType, census);
		}
	});
	container.attributes.forEach((oneAttribute) => {
		census.attributeDeclarationCount++;
		if (oneAttribute.anonymousType !== null) {
			countAnonymousType(oneAttribute.anonymousType, census);
		}
	});
	countContentModelShape(container.contentModelShape, census);
};

const countAnonymousType = (anonymousType, census) => {
	if (anonymousType.typeVariety === 'complexType') {
		census.anonymousComplexTypeCount++;
	} else if (containerHasEnumeration(anonymousType.body)) {
		census.anonymousCodeListCount++;
	} else {
		census.anonymousDataTypeCount++;
	}
	countContainer(anonymousType.body, census);
};

// the per-definition-kind step: which counter a top-level definition advances, and what it owns
const DEFINITION_COUNTER_BY_KIND = Object.freeze({
	complexType: (definition, census) => {
		census.complexTypeCount++;
		countContainer(definition.content, census);
	},
	simpleType: (definition, census) => {
		if (containerHasEnumeration(definition.content)) {
			census.namedCodeListCount++;
		} else {
			census.namedDataTypeCount++;
		}
		countContainer(definition.content, census);
	},
	group: (definition, census) => {
		census.groupCount++;
		countContainer(definition.content, census);
	},
	element: (definition, census) => {
		census.globalElementCount++;
		if (definition.anonymousType !== null) {
			countAnonymousType(definition.anonymousType, census);
		}
	},
});

const measureReleaseCensus = ({ artifacts, referenceCensus }) => {
	const census = {};
	CENSUS_FIELD_NAME_LIST.forEach((oneFieldName) => {
		census[oneFieldName] = 0;
	});
	const uncountedDefinitionList = [];
	artifacts.forEach((oneArtifact) => {
		census.fileCount++;
		census.importCount += oneArtifact.imports.length;
		oneArtifact.definitions.forEach((oneDefinition) => {
			const countDefinition = DEFINITION_COUNTER_BY_KIND[oneDefinition.kind];
			if (countDefinition === undefined) {
				uncountedDefinitionList.push(`${oneArtifact.filename} '${oneDefinition.name}' (kind '${oneDefinition.kind}')`);
				return;
			}
			census.definitionCount++;
			countDefinition(oneDefinition, census);
		});
	});
	if (uncountedDefinitionList.length > 0) {
		return { refusalMessage: refuse.byName({ moduleName, what: `definitions of a kind the census does not count: ${uncountedDefinitionList.join(', ')}`, where: `the census counts ${Object.keys(DEFINITION_COUNTER_BY_KIND).join(', ')}` }).message };
	}
	REFERENCE_FIELD_NAME_LIST.forEach((oneFieldName) => {
		census[oneFieldName] = referenceCensus[oneFieldName];
	});
	return { census };
};

// ---- the comparison ---------------------------------------------------------------------------

const compareReleaseCensus = ({ measuredCensus, frozenCensus, frozenCensusName }) => {
	const frozenFieldNameList = Object.keys(frozenCensus);
	if (JSON.stringify(frozenFieldNameList) !== JSON.stringify(CENSUS_FIELD_NAME_LIST)) {
		return refuse.byName({ moduleName, what: `${frozenCensusName} names the fields ${frozenFieldNameList.join(', ')}`, where: `a frozen release census names exactly ${CENSUS_FIELD_NAME_LIST.join(', ')}, in that order` }).message;
	}
	const differingFieldNameList = CENSUS_FIELD_NAME_LIST.filter((oneFieldName) => measuredCensus[oneFieldName] !== frozenCensus[oneFieldName]);
	if (differingFieldNameList.length > 0) {
		const differenceText = differingFieldNameList.map((oneFieldName) => `${oneFieldName} measured ${measuredCensus[oneFieldName]}, frozen ${frozenCensus[oneFieldName]}`).join('; ');
		return refuse.byName({ moduleName, what: `the release census differs from ${frozenCensusName}: ${differenceText}`, where: 'the snapshot holds different content from the one the bundle was scaffolded from; a frozen census is never edited to match' }).message;
	}
	return '';
};

module.exports = { measureReleaseCensus, compareReleaseCensus, CENSUS_FIELD_NAME_LIST, REFERENCE_FIELD_NAME_LIST, moduleName };
