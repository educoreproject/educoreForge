'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// subjectCurie.js — the SSSOM subject_id of a forged element, and its curie_map entry (mappingLayers ML3-a, ruling R-a by BRONZE_CROWN
// 2026-10-25: "verbatim up to RFC 3986 encoding"). PURE and synchronous: every function RETURNS { error } or its result.
//
//   subjectCurieFor({ stableId, standardName, standardVersion }) → { subjectCurie, prefix, expansion, elementIri } | { error }
//       subjectCurie = <prefix>:<encodeElementPath(local part)> ('/' kept literal since ML3.1, Q42), and expansion is the curie_map
//       entry for <prefix>, chosen so that plain
//       CURIE expansion (concatenation) gives the minted edc element IRI BYTE FOR BYTE; a reader therefore recomputes record_id from
//       the row with no knowledge of our encoding
//   stableIdOfSubjectCurie(subjectCurie) → { stableId } | { error }   the inverse: percent-decode the local part piece by piece
//       (lossless: '%' is always encoded inside a piece, so a decoded '%' was never ambiguous)
//
// WHY NOT VERBATIM (measured 2026-10-25, DESIGN-ML3a §1): the element IRI percent-encodes '/', '@', ' ', '%' and ','; a verbatim
// 'edfi:property/X' under ANY curie_map entry expands to '.../edfi:property/X', never '.../edfi:property%2FX', so a verbatim subject
// made record_id unrecomputable on 73,209 of 73,209 rows. sssom-py also silently DROPS a row whose subject_id carries a space (and
// exits 0); the encoded form cannot carry one. ML3.1 (Q42, ruled 2026-10-26): '/' is now real in the element IRI and so in the local
// part; sssom-py 0.4.21 accepts such CURIEs and drops none (measured on 73,209 rows, DESIGN-ML3.1-uriRespelling-102626.md §6).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const edcUri = require(path.join(__dirname, 'edcUri'));

// a prefix must be made of characters the segment encoding keeps literal, so that encodeSegment(stableId) = prefix + ':' + encodeSegment(local)
const SUBJECT_CURIE_PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;

const splitCurie = (curieText) => {
	const separatorIndex = isNonEmptyString(curieText) ? curieText.indexOf(':') : -1;
	if (separatorIndex <= 0 || separatorIndex === curieText.length - 1) {
		return { error: refusalText(`${JSON.stringify(curieText)} is not '<prefix>:<local part>'`, 'a forged stableId begins with its standard\'s CURIE prefix (RULING BR2)') };
	}
	const prefix = curieText.slice(0, separatorIndex);
	if (!SUBJECT_CURIE_PREFIX_PATTERN.test(prefix)) {
		return { error: refusalText(`prefix '${prefix}' of ${JSON.stringify(curieText)} does not match ${SUBJECT_CURIE_PREFIX_PATTERN}`, 'only a prefix the segment encoding keeps literal can expand to the element IRI by concatenation') };
	}
	return { prefix, localPart: curieText.slice(separatorIndex + 1) };
};

const subjectCurieFor = ({ stableId, standardName, standardVersion } = {}) => {
	const split = splitCurie(stableId);
	if (split.error) {
		return split;
	}
	// the whole stableId is encoded as the element path is, and the local part is what follows '<prefix>:' (':' is literal), so the
	// local part's pieces are exactly the path's pieces
	const encodedPath = edcUri.encodeElementPath(stableId);
	if (encodedPath.error) {
		return { error: encodedPath.error };
	}
	const encodedLocal = { segmentText: encodedPath.pathText.slice(split.prefix.length + 1) };
	const minted = edcUri.mint({ kind: 'element', standardName, standardVersion, elementStableId: stableId });
	if (minted.error) {
		return { error: minted.error };
	}
	const expansion = minted.uri.slice(0, minted.uri.length - encodedLocal.segmentText.length);
	// the property the whole design rests on, checked on every call rather than trusted
	if (`${expansion}${encodedLocal.segmentText}` !== minted.uri || !expansion.endsWith(`/${split.prefix}:`)) {
		return { error: refusalText(`the element IRI ${minted.uri} is not '<expansion ending in /${split.prefix}:>' + the encoded local part`, 'uriScheme.json element template {standardName}/{standardVersion}/{elementStableId}') };
	}
	return { subjectCurie: `${split.prefix}:${encodedLocal.segmentText}`, prefix: split.prefix, expansion, elementIri: minted.uri };
};

const stableIdOfSubjectCurie = (subjectCurie) => {
	const split = splitCurie(subjectCurie);
	if (split.error) {
		return split;
	}
	const decoded = edcUri.decodeElementPath(split.localPart);
	return decoded.error ? { error: decoded.error } : { stableId: `${split.prefix}:${decoded.text}` };
};

module.exports = { subjectCurieFor, stableIdOfSubjectCurie, SUBJECT_CURIE_PREFIX_PATTERN, moduleName };
