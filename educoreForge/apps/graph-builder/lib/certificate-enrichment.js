'use strict';

// certificate-enrichment.js — RULING R5: "Validation certificates must name the base schema block
// they reference." They did not. A certificate said WHERE it ran (summaryFilePath, containerName)
// and never WHAT it certified, so a build directory that is moved or rebuilt leaves the certificate
// pointing at nothing, silently.
//
// This module computes the four fields Phase 6 adds, from values already in hand where
// -goldEvalCheck emits its verdict. It is ADDITIVE: it never reads, renames or reorders a
// pre-existing certificate field. The caller appends the result, so every incumbent field keeps its
// name, its position and its value.
//
//   baseBlockIdByToken — declared token -> the refId of its standardBase block, READ from the
//                        manifest's members and NEVER composed. Composing an id from a subject and
//                        a version would be a second implementation of the content-addressing rule,
//                        and a certificate whose ids are recomputed rather than read certifies the
//                        recomputation, not the build.
//   recipeTextHash     — sha256 of the recipe FILE BYTES, with the algorithm named IN the value so
//                        a reader can never mistake it for some other digest. It is computed HERE,
//                        from the file, and is not read from the store. MEASURED, and stated at the
//                        strength it was measured: for the Phase 0 anchor recipe this value equals
//                        the store's manifests.recipeHash (2f4a5b24…), so the two agree on that one
//                        recipe. Whether they agree IN GENERAL is NOT established — manifestEditor.js
//                        computes that column as contentAddress.blockIdForText(recipeText), over the
//                        LOADED TEXT rather than the raw bytes, and no one has proven those coincide
//                        for every recipe. Treat the agreement as corroboration on the case measured,
//                        never as an identity to rely on.
//   boltEndpoint       — where the round trip actually ran. NOT in the stage summary (which carries
//                        containerName alone); it is at .graph.boltUrl in each per-token
//                        roundTripVerdict.json, artifacts -goldEvalCheck already opens and
//                        existence-checks. ⚠ IT IS NESTED. A top-level read returns undefined for
//                        every token and reads as "absent" while the value sits one level down.
//   declaredTokens     — summary.declaredTokens, already written by the stage.
//
// REFUSAL, NOT NULL-FILL. Every reader returns EITHER a value OR a refusalMessage naming what was
// missing and where it was looked for. Nothing is defaulted, and no field is ever emitted holding
// null: a null in a certificate reads as "measured and empty" when the truth is "never obtained".
//
// callback(errString, result) is the house style for asynchronous work; these readers are
// SYNCHRONOUS and pure but for the file reads they declare, so they return their verdict directly —
// the same shape gold-eval-bridge-sibling.js's auditMappingBlockText uses for the same reason. The
// try/catch blocks below are the boundary translation of a JSON.parse / fs throw into that verdict
// channel, the identical dispensation actions.js and gold-eval-bridge-sibling.js already take, and
// they are never used for control flow.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const vocabularyLib = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

const { SCHEMA_BLOCK_KIND } = vocabularyLib;

const RECIPE_HASH_ALGORITHM = 'sha256';

// The named absence for a run that named no manifest. This is NOT a null-fill and NOT a default: a
// forge-only build has no manifest open by design (actions.js: "a forge-only build certifies exactly
// as before B3"), so the field states that fact in words a promoter must read, rather than holding a
// null that reads as "no base blocks exist".
const NO_MANIFEST_NAMED_TEXT =
	'NO MANIFEST WAS NAMED — this run passed no --manifestRefId, so no manifest was opened and the ' +
	'base schema block ids are UNREAD, not empty. Re-run with --manifestRefId=<the manifest -build ' +
	'printed> (and --standardsDatabaseFilePath=<its store>) for a certificate that names what it certified.';

// ---------------------------------------------------------------------
// the four readers — one per field, each returning { value } or { refusalMessage }
// ---------------------------------------------------------------------

const readDeclaredTokens = ({ summary } = {}) => {
	const tokenList = summary ? summary.declaredTokens : undefined;
	if (!Array.isArray(tokenList)) {
		return {
			refusalMessage:
				`${moduleName}: the stage summary carries no 'declaredTokens' array (found ` +
				`${typeof tokenList}) — the certificate cannot name which validators were declared, so ` +
				`it cannot say what it certified`,
		};
	}
	const badEntryList = tokenList.filter((oneToken) => typeof oneToken !== 'string' || oneToken.trim() === '');
	if (badEntryList.length) {
		return {
			refusalMessage:
				`${moduleName}: the stage summary's 'declaredTokens' holds ${badEntryList.length} entr(y/ies) ` +
				`that are not non-empty strings — an unnameable token cannot be certified`,
		};
	}
	return { value: tokenList };
};

const readRecipeTextHash = ({ recipePath } = {}) => {
	if (typeof recipePath !== 'string' || recipePath.trim() === '') {
		return {
			refusalMessage:
				`${moduleName}: the recipe was not located for this run directory, so its text cannot be ` +
				`hashed — pass --recipePath=<the recipe this build ran> so the certificate can name the ` +
				`recipe it certified rather than merely the directory it read`,
		};
	}
	if (!fs.existsSync(recipePath)) {
		return {
			refusalMessage: `${moduleName}: the recipe named for this run ('${recipePath}') is not on disk — a recipe that cannot be read cannot be hashed`,
		};
	}
	let recipeFileBytes = null;
	let readFault = null;
	// boundary translation of an fs throw into the verdict channel
	try {
		recipeFileBytes = fs.readFileSync(recipePath);
	} catch (readError) {
		readFault = readError.message;
	}
	if (readFault !== null) {
		return { refusalMessage: `${moduleName}: the recipe '${recipePath}' could not be read (${readFault}) — unreadable evidence hashes to nothing` };
	}
	const digestText = crypto.createHash(RECIPE_HASH_ALGORITHM).update(recipeFileBytes).digest('hex');
	// the algorithm travels IN the value; a bare hex string invites a reader to assume the wrong one
	return { value: `${RECIPE_HASH_ALGORITHM}:${digestText}` };
};

const readBoltEndpoint = ({ declaredRowList } = {}) => {
	if (!Array.isArray(declaredRowList) || declaredRowList.length === 0) {
		return { refusalMessage: `${moduleName}: no declared validator rows were given, so there is no round trip whose bolt endpoint could be named` };
	}
	const endpointByToken = [];
	const refusalList = [];
	declaredRowList.forEach((oneRow) => {
		const tokenName = oneRow.token;
		if (typeof oneRow.verdictPath !== 'string' || !fs.existsSync(oneRow.verdictPath)) {
			refusalList.push(`'${tokenName}' has no readable verdict artifact at '${oneRow.verdictPath}', so its bolt endpoint is unobtainable`);
			return;
		}
		let verdict = null;
		let parseFault = null;
		// boundary translation of a JSON.parse throw into the verdict channel
		try {
			verdict = JSON.parse(fs.readFileSync(oneRow.verdictPath, 'utf-8'));
		} catch (parseError) {
			parseFault = parseError.message;
		}
		if (parseFault !== null) {
			refusalList.push(`'${tokenName}' verdict '${oneRow.verdictPath}' does not parse (${parseFault})`);
			return;
		}
		// ⚠ NESTED, deliberately named here: .graph.boltUrl, never the top level. A top-level read
		// returns undefined for every token and would refuse a build whose endpoint is present.
		const endpointText = verdict && verdict.graph ? verdict.graph.boltUrl : undefined;
		if (typeof endpointText !== 'string' || endpointText.trim() === '') {
			refusalList.push(`'${tokenName}' verdict '${oneRow.verdictPath}' carries no .graph.boltUrl — the endpoint the round trip actually read is unrecorded`);
			return;
		}
		endpointByToken.push({ tokenName, endpointText });
	});
	if (refusalList.length) {
		return { refusalMessage: `${moduleName}: the bolt endpoint could not be established — ${refusalList.join('; ')}` };
	}
	const distinctEndpointList = endpointByToken
		.map((oneEntry) => oneEntry.endpointText)
		.filter((oneEndpoint, atIndex, wholeList) => wholeList.indexOf(oneEndpoint) === atIndex);
	if (distinctEndpointList.length !== 1) {
		// one certificate is a claim about ONE graph; validators that read different endpoints did not
		// round-trip the same graph, and averaging or picking one would hide that
		return {
			refusalMessage:
				`${moduleName}: the declared validators report ${distinctEndpointList.length} DIFFERENT bolt endpoints ` +
				`(${endpointByToken.map((oneEntry) => `${oneEntry.tokenName}=${oneEntry.endpointText}`).join(', ')}) — ` +
				`a certificate is a claim about ONE graph and cannot name several`,
		};
	}
	return { value: distinctEndpointList[0] };
};

const readBaseBlockIdByToken = ({ manifest, declaredTokenList } = {}) => {
	if (manifest === null || manifest === undefined) {
		return { value: NO_MANIFEST_NAMED_TEXT };
	}
	if (!Array.isArray(declaredTokenList) || declaredTokenList.length === 0) {
		return { refusalMessage: `${moduleName}: no declared tokens were given, so no base schema block can be attributed to one` };
	}
	const memberList = Array.isArray(manifest.members) ? manifest.members : [];
	const baseMemberList = memberList.filter((oneMember) => oneMember.kind === SCHEMA_BLOCK_KIND.STANDARD_BASE);
	const baseBlockIdByToken = {};
	const refusalList = [];
	declaredTokenList.forEach((oneToken) => {
		// the member's OWN subject is `<token>@<versionSlug>_base`; matching on its prefix READS the
		// association the build recorded. The refId below is then taken verbatim from the member.
		const matchList = baseMemberList.filter((oneMember) => typeof oneMember.subject === 'string' && oneMember.subject.indexOf(`${oneToken}@`) === 0);
		if (matchList.length === 0) {
			refusalList.push(`declared token '${oneToken}' has NO standardBase member in manifest ${manifest.refId} — the certificate cannot name the base schema block it certified for that token`);
			return;
		}
		if (matchList.length > 1) {
			refusalList.push(`declared token '${oneToken}' matches ${matchList.length} standardBase members in manifest ${manifest.refId} (${matchList.map((oneMember) => oneMember.subject).join(', ')}) — the base schema block is ambiguous and must not be guessed`);
			return;
		}
		baseBlockIdByToken[oneToken] = matchList[0].schemaBlockRefId;
	});
	if (refusalList.length) {
		return { refusalMessage: `${moduleName}: ${refusalList.join('; ')}` };
	}
	return { value: baseBlockIdByToken };
};

// ---------------------------------------------------------------------
// the registry — data, not a switch. Order here is the order the fields are appended to the
// certificate, and appending is what keeps the change additive.
// ---------------------------------------------------------------------

const ENRICHMENT_READER_REGISTRY = Object.freeze({
	baseBlockIdByToken: readBaseBlockIdByToken,
	recipeTextHash: readRecipeTextHash,
	boltEndpoint: readBoltEndpoint,
	declaredTokens: readDeclaredTokens,
});

const ENRICHMENT_FIELD_NAME_LIST = Object.freeze(Object.keys(ENRICHMENT_READER_REGISTRY));

// buildCertificateEnrichment — the four fields, or a refusal naming every one that could not be had.
// Returns { enrichment, refusalMessageList }. When refusalMessageList is non-empty, enrichment is
// null: a partial enrichment is exactly the null-fill this module exists to prevent.
const buildCertificateEnrichment = ({ summary, declaredRowList, manifest, recipePath } = {}) => {
	const declaredTokensVerdict = readDeclaredTokens({ summary });
	const readerArgumentsByField = {
		baseBlockIdByToken: { manifest, declaredTokenList: declaredTokensVerdict.value },
		recipeTextHash: { recipePath },
		boltEndpoint: { declaredRowList },
		declaredTokens: { summary },
	};
	const enrichment = {};
	const refusalMessageList = [];
	ENRICHMENT_FIELD_NAME_LIST.forEach((oneFieldName) => {
		const verdict = ENRICHMENT_READER_REGISTRY[oneFieldName](readerArgumentsByField[oneFieldName]);
		if (verdict.refusalMessage) {
			refusalMessageList.push(verdict.refusalMessage);
			return;
		}
		enrichment[oneFieldName] = verdict.value;
	});
	if (refusalMessageList.length) {
		return { enrichment: null, refusalMessageList };
	}
	return { enrichment, refusalMessageList: [] };
};

module.exports = {
	buildCertificateEnrichment,
	readDeclaredTokens,
	readRecipeTextHash,
	readBoltEndpoint,
	readBaseBlockIdByToken,
	ENRICHMENT_FIELD_NAME_LIST,
	RECIPE_HASH_ALGORITHM,
	NO_MANIFEST_NAMED_TEXT,
	moduleName,
};
