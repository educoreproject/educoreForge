'use strict';

// normalize.js — DCTAP stableId normalization (R3, DESIGN §D, DECISIONS §23-R3).
//
// DCTAP (Dublin Core Tabular Application Profile, Dublin Core Metadata Initiative) is a JSON-LD
// META-vocabulary: it describes the structure of application profiles (shapes + statement
// templates), not subject-matter content. Every term in the source carries a NATIVE URI in `@id`,
// expressed as a `dctap:` CURIE (e.g. `dctap:shape`, `dctap:propertyID`, `dctap:_booleanValueSet`).
// DCTAP's identity is therefore URI-bearing (DESIGN §D — the CEDS/URI model, the JSON-LD-family
// default, NOT the structural-path model OpenBadges/SIF use): the stableId IS the term's `@id`
// CURIE and `stableUriPropertyName = 'uri'`. The CURIEs in the source are globally unique, so they
// make clean, comparable stableIds with no minting required. An empty/blank `@id` is a
// normalization MISS — surfaced (returns { error }), NEVER silently dropped — the caller turns that
// into a forge-time failure so a malformed term cannot pass as data (R3).
//
// DCTAP is STANDARD-PURE: as a meta-vocabulary it declares NO cross-standard (CEDS) anchors, so —
// unlike forge-ctdl / forge-ceds — this normalize carries NO CEDS cross-ref machinery. There is
// nothing to bridge. (If a future DCTAP revision were to add equivalence anchors, the CEDS
// normalizer from forge-ctdl would be the template, but the source carries none today.)
//
// Pure + synchronous; no async, no try/catch-for-control-flow. camelCase only.

// -----
// buildStableId — DCTAP stableId IS the term's native `@id` CURIE. Whatever the input, trim it; an
//   empty/blank result is a MISS. Returns { stableId } on success, { error } on a blank id (R3).
const buildStableId = ({ id } = {}) => {
	const cleaned = id == null ? '' : `${id}`.trim();
	if (cleaned === '') {
		return { error: `buildStableId: empty DCTAP @id` };
	}
	return { stableId: cleaned };
};

// isCleanStableId — the R3 predicate the test asserts against. A clean DCTAP stableId is a
//   non-empty, non-whitespace-padded CURIE of the form `<prefix>:<localName>` (the DCTAP source uses
//   `dctap:...`, where the local part may begin with '_' for value sets/values, e.g.
//   `dctap:_booleanValueSet`). A full http(s) URI is also accepted as a clean URI form for
//   robustness, though the DCTAP source does not use one.
const DCTAP_CURIE_RE = /^[A-Za-z][A-Za-z0-9_-]*:[^\s]+$/;
const DCTAP_HTTP_RE = /^https?:\/\/\S+$/;
const isCleanStableId = (value) =>
	typeof value === 'string' &&
	value.length > 0 &&
	value === value.trim() &&
	(DCTAP_HTTP_RE.test(value) || DCTAP_CURIE_RE.test(value));

module.exports = {
	buildStableId,
	isCleanStableId,
	DCTAP_CURIE_RE,
	DCTAP_HTTP_RE,
};
