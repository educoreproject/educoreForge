'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// assertionIdentity.js — the public identity of a mapping assertion and its layer-independent twin (mappingLayers ML1-a;
// D-ASSERTID; DESIGN-ML1a-uriSchemeAndAssertionId-102426.md §3, ruled by BRONZE_CROWN 2026-10-24). PURE and synchronous.
//
//   nodeIriFor({ stableId, standardName, standardVersion }) → { iri } | { error }
//       a stableId that is already an absolute IRI (uriScheme.json absoluteIriPrefixList: hub cards, CEDS terms) is its own
//       IRI; a vocabulary term (vocabularyIriByCurie: sssom:NoTermFound, an abstention's object) is its declared IRI; every
//       other stableId is a CURIE-shaped key and expands to the edc element IRI of its standard version
//   predicateIriFor(predicateCurie) → { iri } | { error }        through uriScheme.json predicatePrefixExpansion
//   assertionIdFor({ decisionBlockHash, subjectStableId, subjectStandardName, subjectStandardVersion, predicateCurie,
//                    objectStableId, objectStandardName, objectStandardVersion })
//       → { assertionId, assertionHash, subjectIri, predicateIri, objectIri } | { error }
//       assertionHash = sha256(subjectIri \n predicateIri \n objectIri); assertionId = the edc assertion IRI over
//       (decisionBlockHash, assertionHash). Under fan-out the caller passes the INSTANCE as the subject.
//   mappingSamenessIdFor({ subjectIriList, predicateIri, objectIriList, isNegative })
//       → { mappingSamenessId } | { error }
//       the MSI of ts4nfdi.github.io/mapping-sameness-identifier (read 2026-10-24): subjects sorted by code point and joined
//       '|', one space, the predicate IRI, one space, objects sorted and joined '|'; NFC; sha256 lowercase hex; 'mapping:'
//       prefix; '~' appended when negative. Never stored on an edge; computed for measurement.
//
// The recipe reads only what an edge and its two end nodes carry, so a gate recomputes it from the graph with no store.

const crypto = require('crypto');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const edcUri = require(path.join(__dirname, 'edcUri'));

const { URI_SCHEME } = edcUri;
const MAPPING_SAMENESS_ID_PREFIX = 'mapping:';
const MAPPING_SAMENESS_NEGATIVE_SUFFIX = '~';
const ASSERTION_HASH_SEPARATOR = '\n';

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const isAbsoluteIri = (text) => URI_SCHEME.absoluteIriPrefixList.some((onePrefix) => text.indexOf(onePrefix) === 0);
// code-point order, not locale order and not UTF-16 unit order (they differ above U+FFFF): the MSI page fixes code points
const compareByCodePoint = (leftText, rightText) => {
	const leftPointList = Array.from(leftText).map((oneCharacter) => oneCharacter.codePointAt(0));
	const rightPointList = Array.from(rightText).map((oneCharacter) => oneCharacter.codePointAt(0));
	const sharedLength = Math.min(leftPointList.length, rightPointList.length);
	for (let pointIndex = 0; pointIndex < sharedLength; pointIndex++) {
		if (leftPointList[pointIndex] !== rightPointList[pointIndex]) {
			return leftPointList[pointIndex] - rightPointList[pointIndex];
		}
	}
	return leftPointList.length - rightPointList.length;
};

const nodeIriFor = ({ stableId, standardName, standardVersion } = {}) => {
	if (!isNonEmptyString(stableId)) {
		return { error: refuse.byName({ moduleName, what: `stableId ${JSON.stringify(stableId)} is absent`, where: 'nodeIriFor({ stableId, standardName, standardVersion })' }).message };
	}
	if (isAbsoluteIri(stableId)) {
		return { iri: stableId };
	}
	if (typeof URI_SCHEME.vocabularyIriByCurie[stableId] === 'string' && stableId !== 'about') {
		return { iri: URI_SCHEME.vocabularyIriByCurie[stableId] };
	}
	const minted = edcUri.mint({ kind: 'element', standardName, standardVersion, elementStableId: stableId });
	return minted.error ? { error: minted.error } : { iri: minted.uri };
};

const predicateIriFor = (predicateCurie) => {
	if (!isNonEmptyString(predicateCurie) || predicateCurie.indexOf(':') <= 0) {
		return { error: refuse.byName({ moduleName, what: `predicate ${JSON.stringify(predicateCurie)} is not a CURIE`, where: 'a predicate reaches the recipe as skos:<relation> or a declared CURIE verbatim' }).message };
	}
	const prefix = predicateCurie.slice(0, predicateCurie.indexOf(':'));
	const expansion = URI_SCHEME.predicatePrefixExpansion[prefix];
	if (expansion === undefined) {
		return { error: refuse.byName({ moduleName, what: `predicate prefix '${prefix}' (in ${predicateCurie}) has no expansion`, where: `uriScheme.json predicatePrefixExpansion (${Object.keys(URI_SCHEME.predicatePrefixExpansion).join(', ')})` }).message };
	}
	return { iri: `${expansion}${predicateCurie.slice(prefix.length + 1)}` };
};

const assertionIdFor = ({ decisionBlockHash, subjectStableId, subjectStandardName, subjectStandardVersion, predicateCurie, objectStableId, objectStandardName, objectStandardVersion } = {}) => {
	if (typeof decisionBlockHash !== 'string' || !/^[0-9a-f]{64}$/.test(decisionBlockHash)) {
		return { error: refuse.byName({ moduleName, what: `decisionBlockHash ${JSON.stringify(decisionBlockHash)} is not a 64-hex id`, where: 'an assertion is scoped by the decision block that holds it (R-1)' }).message };
	}
	const subject = nodeIriFor({ stableId: subjectStableId, standardName: subjectStandardName, standardVersion: subjectStandardVersion });
	if (subject.error) {
		return { error: `${moduleName}: subject: ${subject.error}` };
	}
	const predicate = predicateIriFor(predicateCurie);
	if (predicate.error) {
		return { error: `${moduleName}: predicate: ${predicate.error}` };
	}
	const object = nodeIriFor({ stableId: objectStableId, standardName: objectStandardName, standardVersion: objectStandardVersion });
	if (object.error) {
		return { error: `${moduleName}: object: ${object.error}` };
	}
	const assertionHash = sha256Hex([subject.iri, predicate.iri, object.iri].join(ASSERTION_HASH_SEPARATOR));
	const minted = edcUri.mint({ kind: 'assertion', decisionBlockHash, assertionHash });
	if (minted.error) {
		return { error: minted.error };
	}
	return { assertionId: minted.uri, assertionHash, subjectIri: subject.iri, predicateIri: predicate.iri, objectIri: object.iri };
};

const mappingSamenessIdFor = ({ subjectIriList, predicateIri, objectIriList, isNegative } = {}) => {
	const badList = [['subjectIriList', subjectIriList], ['objectIriList', objectIriList]].find(([, oneList]) => !Array.isArray(oneList) || oneList.length === 0 || !oneList.every((oneIri) => isNonEmptyString(oneIri) && isAbsoluteIri(oneIri)));
	if (badList !== undefined) {
		return { error: refuse.byName({ moduleName, what: `${badList[0]} ${JSON.stringify(badList[1])} is not a non-empty list of absolute IRIs`, where: 'the MSI hashes full IRIs, never CURIEs' }).message };
	}
	if (!isNonEmptyString(predicateIri) || !isAbsoluteIri(predicateIri)) {
		return { error: refuse.byName({ moduleName, what: `predicateIri ${JSON.stringify(predicateIri)} is not an absolute IRI`, where: 'mappingSamenessIdFor' }).message };
	}
	if (typeof isNegative !== 'boolean') {
		return { error: refuse.byName({ moduleName, what: `isNegative ${JSON.stringify(isNegative)} is not a boolean`, where: 'negativity is stated, never defaulted' }).message };
	}
	const joinSorted = (iriList) => iriList.map((oneIri) => oneIri.normalize('NFC')).sort(compareByCodePoint).join('|');
	const hashedText = `${joinSorted(subjectIriList)} ${predicateIri.normalize('NFC')} ${joinSorted(objectIriList)}`;
	return { mappingSamenessId: `${MAPPING_SAMENESS_ID_PREFIX}${sha256Hex(hashedText)}${isNegative ? MAPPING_SAMENESS_NEGATIVE_SUFFIX : ''}` };
};

module.exports = { nodeIriFor, predicateIriFor, assertionIdFor, mappingSamenessIdFor, ASSERTION_HASH_SEPARATOR, MAPPING_SAMENESS_ID_PREFIX, moduleName };
