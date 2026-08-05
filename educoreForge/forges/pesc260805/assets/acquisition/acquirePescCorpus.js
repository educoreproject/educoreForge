#!/usr/bin/env node
'use strict';

/*
acquirePescCorpus.js

Acquire a complete, self-describing PESC schema corpus from pesc.org.

WHY THIS EXISTS
    PESC publishes no schema repository, no index, and no filenames. Artifacts sit on a
    GoDaddy asset CDN behind opaque 32-hex-hash URLs that return
    `content-type: application/octet-stream` with NO content-disposition header. The only
    human-readable identity of a file is the anchor text on the page that links to it.

    A previous ad hoc harvest saved four HTTP error bodies (27 bytes of
    {"error":"asset-not-found"}) under schema filenames. This tool refuses to do that.

WHAT IT GUARANTEES
    - Nothing is written to disk unless it passes the PESC schema gate (documented at
      evaluatePescSchemaGate below): the content must be XML-shaped, its root element must
      be an XML Schema `schema` element, and that root must declare a urn:org:pesc:*
      targetNamespace. An HTTP error body can never reach disk.
    - Filenames are DERIVED FROM THE targetNamespace, not from anchor text. The file names
      itself; we do not guess. Anchor text is recorded as metadata only.
    - When PESC publishes TWO different files under ONE namespace (it does — see the
      AcademicRecord v1.6.0 collision), BOTH are retained, discriminated by content hash
      as <Name>_v<ver>.collision-<sha256first12>.xsd, and the collision is recorded as a
      structured fact in the manifest. Acquisition chooses neither; resolution is a forge
      decision. (This deliberately differs from the 2026-08-05 Python prototype, which
      refused the second file. Spec requirement R-ACQ-4.)
    - Every refusal is named and counted. Silence is never a result.
    - A manifest records, per artifact: derived filename, targetNamespace, upstream URL,
      source page, anchor label, HTTP status, byte count, sha256, and every additional
      page that linked the identical bytes (alsoLinkedFrom).
    - xs:import declarations are resolved against what was acquired; anything unresolved is
      reported explicitly as an open closure gap, never quietly ignored. No
      version-insensitive matching: substituting 1.19.1 for a declared 1.19.0 is precisely
      the silent behaviour this corpus exists to eliminate.

ACQUISITION HAZARDS THIS TOOL ENCODES (each cost a failed run once)
    - Hrefs in HTML carry entity-encoded ampersands. Left as written, the CDN's
      AccessKeyId query string arrives malformed and EVERY request returns HTTP 401.
      unescapeHtmlEntities() exists for this reason and is gate-tested (G2).
    - Five CDN links return HTTP 410 Gone — exactly the newest schema block (CoreMain
      1.19.1, AcademicRecord 1.14.0, ISO 3166, Request, Response). Those files survive
      only inside the published Request/Response ZIP, declared below as a supplementary
      source (spec R-ACQ-5).
    - The three legacy Transcript roots are no longer linked from pesc.org at all and come
      from the OCAS mirror at developer.ocas.ca.

EXTERNAL DEPENDENCY (the only one)
    Node has no built-in ZIP reader, and this tool deliberately has no npm install step.
    The supplementary ZIP is therefore unpacked by shelling out to /usr/bin/unzip
    (present on every macOS and virtually every Linux). A missing or failing unzip is a
    NAMED refusal (`zipUnreadable`), never a silent skip. Everything else is Node
    built-ins: fetch, crypto, fs, path, os, child_process.

USAGE
    node acquirePescCorpus.js --outDir=<path> [-verbose]
    node acquirePescCorpus.js -selfTest            # local fixture gates, no network

SELF-TEST (the anti-cheat gates; each demonstrated RED before believed GREEN)
    G1  an HTTP error body offered to the collector must be refused and write nothing
    G2  an href carrying &amp; must be unescaped before use (no '&amp;' may survive)
    G3  two artifacts declaring one namespace with different bytes are BOTH kept under
        collision names; identical bytes offered twice yield ONE file plus alsoLinkedFrom
    Each gate first runs with its guard logically disabled (the naive behaviour) so the
    assertion is OBSERVED FAILING, then runs the real code path and passes.
*/

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration. Explicit constants, no environment guessing, no silent defaults.
// ---------------------------------------------------------------------------

const PESC_STANDARDS_PAGE_URLS = [
	'https://pesc.org/approved-standards/',
	'https://pesc.org/college-transcript/',
	'https://pesc.org/high-school-transcript/',
	'https://pesc.org/admissions-application/',
	'https://pesc.org/course-inventory/',
	'https://pesc.org/test-score/',
	'https://pesc.org/eportfolio/',
	'https://pesc.org/credential-and-experiential-learning/',
	'https://pesc.org/pdf-attachment/',
	'https://pesc.org/edexchange/',
];

// The five newest-block CDN links are dead (HTTP 410). PESC ships those same schemas
// inside one ZIP, which is the ONLY working source for CoreMain 1.19.1 and
// AcademicRecord 1.14.0.
const SUPPLEMENTARY_ZIP_URLS = [
	'https://pesc.org/wp-content/uploads/2025/11/Academic-College-Transcript-Request-Response-v1.0.zip',
];

// The OCAS mirror is the only public source for the three legacy Transcript roots.
const LEGACY_MIRROR_XSD_URLS = [
	'https://developer.ocas.ca/transcripts/schemas/pesc/TranscriptRequest_v1.1.0.xsd',
	'https://developer.ocas.ca/transcripts/schemas/pesc/TranscriptResponse_v1.1.0.xsd',
	'https://developer.ocas.ca/transcripts/schemas/pesc/TranscriptAcknowledgement_v1.1.0.xsd',
];

const CDN_HOSTNAME = 'nebula.wsimg.com';
const REQUEST_TIMEOUT_MILLISECONDS = 60000;
const USER_AGENT_STRING = 'educoreForge-pesc-acquisition/2.0 (+tq@justkidding.com)';
const UNZIP_EXECUTABLE_PATH = '/usr/bin/unzip';

// urn:org:pesc:<layer>:<Name>:v<X.Y.Z>
const PESC_NAMESPACE_PATTERN =
	/^urn:org:pesc:(codes|core|sector|message):([^:]+):v([\d.]+)$/;

const ANCHOR_TAG_PATTERN =
	/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

const HTML_TAG_PATTERN = /<[^>]+>/g;

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const readCommandLineParameters = (argumentVector) => {
	// qtools-style flags: single hyphen for actions (-verbose, -selfTest),
	// double hyphen for parameters (--outDir=<path>). Unknown parameter = fault.
	const commandLineParameters = {
		outDirPath: null,
		verboseEnabled: false,
		selfTestEnabled: false,
	};
	for (const oneArgument of argumentVector.slice(2)) {
		if (oneArgument === '-verbose') {
			commandLineParameters.verboseEnabled = true;
		} else if (oneArgument === '-selfTest') {
			commandLineParameters.selfTestEnabled = true;
		} else if (oneArgument.startsWith('--outDir=')) {
			commandLineParameters.outDirPath = oneArgument.slice('--outDir='.length);
		} else {
			throw new Error(
				`[acquirePescCorpus] unrecognized parameter ${JSON.stringify(oneArgument)}. ` +
					`Accepted: --outDir=<path>, -verbose, -selfTest. There is no default for outDir.`,
			);
		}
	}
	if (!commandLineParameters.selfTestEnabled && !commandLineParameters.outDirPath) {
		throw new Error(
			'[acquirePescCorpus] --outDir is required and has no default. ' +
				'Name the directory the corpus should be written into ' +
				'(or run -selfTest, which uses a private temp directory).',
		);
	}
	return commandLineParameters;
};

// ---------------------------------------------------------------------------
// Logging. Single output channel; status always, verbose only when asked.
// ---------------------------------------------------------------------------

class AcquisitionLog {
	constructor(verboseEnabled) {
		this.verboseEnabled = verboseEnabled;
	}
	status(messageText) {
		process.stdout.write(`${messageText}\n`);
	}
	verbose(messageText) {
		if (this.verboseEnabled) {
			process.stdout.write(`    ${messageText}\n`);
		}
	}
	error(messageText) {
		process.stderr.write(`REFUSED: ${messageText}\n`);
	}
}

// ---------------------------------------------------------------------------
// HTML entity unescaping (gate G2)
// ---------------------------------------------------------------------------

const NAMED_HTML_ENTITY_MAP = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

const unescapeHtmlEntities = (encodedText) => {
	// Single-pass decode so '&amp;lt;' correctly becomes '&lt;' and not '<'.
	// An entity we do not recognize is left exactly as written (refuse-to-guess).
	if (typeof encodedText !== 'string') {
		throw new Error(
			'[unescapeHtmlEntities] encodedText must be a string; it belongs to the ' +
				'caller extracting anchor hrefs from page HTML.',
		);
	}
	return encodedText.replace(
		/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
		(wholeEntity, entityBody) => {
			if (entityBody.startsWith('#x') || entityBody.startsWith('#X')) {
				return String.fromCodePoint(parseInt(entityBody.slice(2), 16));
			}
			if (entityBody.startsWith('#')) {
				return String.fromCodePoint(parseInt(entityBody.slice(1), 10));
			}
			if (Object.prototype.hasOwnProperty.call(NAMED_HTML_ENTITY_MAP, entityBody)) {
				return NAMED_HTML_ENTITY_MAP[entityBody];
			}
			return wholeEntity;
		},
	);
};

// ---------------------------------------------------------------------------
// Anchor extraction
// ---------------------------------------------------------------------------

const extractCdnAnchorPairsFromHtml = (pageHtmlText, sourcePageUrl) => {
	// Recover {upstreamUrl, anchorLabel, sourcePage} for CDN artifact links.
	// The anchor label is the ONLY human-readable identity the CDN exposes, so it is
	// captured for the manifest — but it is deliberately NOT used to name files.
	//
	// CRITICAL: an href in HTML source carries entity-encoded ampersands. Left as
	// written, the CDN's AccessKeyId query string arrives malformed and every request
	// returns HTTP 401. (Observed; cost the prototype one complete failed run.)
	const anchorPairList = [];
	for (const oneAnchorMatch of pageHtmlText.matchAll(ANCHOR_TAG_PATTERN)) {
		const unescapedHref = unescapeHtmlEntities(oneAnchorMatch[1]);
		if (!unescapedHref.includes(CDN_HOSTNAME)) {
			continue;
		}
		const anchorLabelText = oneAnchorMatch[2]
			.replace(HTML_TAG_PATTERN, ' ')
			.split(/\s+/)
			.filter((oneWord) => oneWord.length > 0)
			.join(' ');
		anchorPairList.push({
			upstreamUrl: unescapedHref,
			anchorLabel: anchorLabelText,
			sourcePage: sourcePageUrl,
		});
	}
	return anchorPairList;
};

// ---------------------------------------------------------------------------
// The PESC schema gate (gate G1)
// ---------------------------------------------------------------------------

const evaluatePescSchemaGate = (contentBuffer) => {
	/*
	Decide whether these bytes are a PESC XSD. Returns
	    { accepted: true, targetNamespace }        when they are
	    { accepted: false, rejectionReason }       when they are not

	EXACTLY WHAT THIS CHECK ACCEPTS (documented per work order):
	  1. The content, decoded as UTF-8 with an optional BOM stripped and leading
	     whitespace ignored, must begin with '<' (an XML declaration '<?xml' or a tag).
	  2. After skipping any XML declaration / processing instructions, comments, and a
	     DOCTYPE, the FIRST real element must be an XML Schema root:  <schema ...> or
	     <prefix:schema ...> for any prefix. Anything else (JSON error bodies, HTML
	     pages, PDFs, WSDL) is rejected — this is what keeps
	     {"error":"asset-not-found"} off the disk.
	  3. That root open tag must carry targetNamespace="urn:org:pesc:<layer>:<Name>:v<ver>"
	     where <layer> is one of codes|core|sector|message (single or double quotes).
	  4. The document must contain exactly ONE <(prefix:)schema open tag and exactly ONE
	     matching </(prefix:)schema> close tag, with the close after the open — a cheap
	     balance check that rejects truncated downloads. (xs:schema cannot legally nest,
	     so counts other than 1/1 are always defects. A literal '<xs:schema' inside
	     documentation text would appear entity-escaped and so cannot false-trip this.)
	  This is deliberately NOT a full XML parse: it is a retention gate, and its job is
	  to make non-schemas and truncations unable to reach disk, not to validate schemas.
	*/
	if (!Buffer.isBuffer(contentBuffer)) {
		throw new Error(
			'[evaluatePescSchemaGate] contentBuffer must be a Buffer; it belongs to the ' +
				'collector offering downloaded bytes.',
		);
	}
	let contentText = contentBuffer.toString('utf8');
	if (contentText.charCodeAt(0) === 0xfeff) {
		contentText = contentText.slice(1);
	}
	const leadingTrimmedText = contentText.replace(/^\s+/, '');
	if (!leadingTrimmedText.startsWith('<')) {
		return { accepted: false, rejectionReason: 'contentDoesNotBeginWithXml' };
	}

	// Skip prolog material to find the first real element.
	let scanText = leadingTrimmedText;
	let prologConsumed = true;
	while (prologConsumed) {
		prologConsumed = false;
		for (const onePrologPattern of [/^<\?[\s\S]*?\?>\s*/, /^<!--[\s\S]*?-->\s*/, /^<!DOCTYPE[^>]*>\s*/]) {
			const prologMatch = scanText.match(onePrologPattern);
			if (prologMatch) {
				scanText = scanText.slice(prologMatch[0].length);
				prologConsumed = true;
			}
		}
	}

	const rootTagMatch = scanText.match(/^<([A-Za-z_][\w.-]*:)?schema[\s>]/);
	if (!rootTagMatch) {
		return { accepted: false, rejectionReason: 'rootElementIsNotXsdSchema' };
	}
	const schemaPrefixText = rootTagMatch[1] === undefined ? '' : rootTagMatch[1];

	const rootOpenTagEndIndex = scanText.indexOf('>');
	if (rootOpenTagEndIndex === -1) {
		return { accepted: false, rejectionReason: 'rootOpenTagNeverCloses' };
	}
	const rootOpenTagText = scanText.slice(0, rootOpenTagEndIndex + 1);

	const targetNamespaceMatch = rootOpenTagText.match(
		/\btargetNamespace\s*=\s*(?:"([^"]*)"|'([^']*)')/,
	);
	if (!targetNamespaceMatch) {
		return { accepted: false, rejectionReason: 'rootSchemaDeclaresNoTargetNamespace' };
	}
	const targetNamespace =
		targetNamespaceMatch[1] === undefined ? targetNamespaceMatch[2] : targetNamespaceMatch[1];
	if (!PESC_NAMESPACE_PATTERN.test(targetNamespace)) {
		return { accepted: false, rejectionReason: 'targetNamespaceIsNotPesc' };
	}

	const escapedQualifiedName = `${schemaPrefixText}schema`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const openTagCount = (scanText.match(new RegExp(`<${escapedQualifiedName}[\\s>]`, 'g')) || [])
		.length;
	const closeTagCount = (scanText.match(new RegExp(`</${escapedQualifiedName}\\s*>`, 'g')) || [])
		.length;
	if (openTagCount !== 1 || closeTagCount !== 1) {
		return { accepted: false, rejectionReason: 'schemaElementOpenCloseUnbalanced' };
	}
	if (
		scanText.search(new RegExp(`</${escapedQualifiedName}\\s*>`)) <
		scanText.search(new RegExp(`<${escapedQualifiedName}[\\s>]`))
	) {
		return { accepted: false, rejectionReason: 'schemaCloseTagPrecedesOpenTag' };
	}

	return { accepted: true, targetNamespace };
};

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const deriveFilenameFromNamespace = (targetNamespace) => {
	// Name the file from what it says it is. urn:org:pesc:core:CoreMain:v1.19.0 becomes
	// CoreMain_v1.19.0.xsd. This removes anchor text from the naming path entirely, so a
	// mislabelled link cannot produce a misnamed file.
	const namespaceMatch = targetNamespace.match(PESC_NAMESPACE_PATTERN);
	if (!namespaceMatch) {
		throw new Error(
			`[deriveFilenameFromNamespace] ${JSON.stringify(targetNamespace)} is not a PESC ` +
				`namespace. This should have been rejected by evaluatePescSchemaGate.`,
		);
	}
	const standardNameText = namespaceMatch[2];
	const standardVersionText = namespaceMatch[3];
	return `${standardNameText}_v${standardVersionText}.xsd`;
};

const deriveCollisionFilename = (plainFilename, sha256Hex) => {
	// <Name>_v<ver>.collision-<sha256first12>.xsd — content-hash discrimination for the
	// keep-both rule (R-ACQ-4).
	if (!plainFilename.endsWith('.xsd')) {
		throw new Error(
			`[deriveCollisionFilename] plainFilename ${JSON.stringify(plainFilename)} does not ` +
				`end in .xsd; it belongs to deriveFilenameFromNamespace output.`,
		);
	}
	return `${plainFilename.slice(0, -'.xsd'.length)}.collision-${sha256Hex.slice(0, 12)}.xsd`;
};

// ---------------------------------------------------------------------------
// Import declarations (closure reporting)
// ---------------------------------------------------------------------------

const readImportDeclarations = (contentBuffer) => {
	// Return the {namespace, schemaLocation} pairs this schema imports. Regex over the
	// import open tags is sufficient here: this feeds the closure REPORT, not retention.
	const contentText = contentBuffer.toString('utf8');
	const importDeclarationList = [];
	for (const oneImportMatch of contentText.matchAll(
		/<(?:[A-Za-z_][\w.-]*:)?import\b([^>]*)>/g,
	)) {
		const importAttributesText = oneImportMatch[1];
		const namespaceAttributeMatch = importAttributesText.match(
			/\bnamespace\s*=\s*(?:"([^"]*)"|'([^']*)')/,
		);
		const schemaLocationAttributeMatch = importAttributesText.match(
			/\bschemaLocation\s*=\s*(?:"([^"]*)"|'([^']*)')/,
		);
		importDeclarationList.push({
			namespace:
				namespaceAttributeMatch === null
					? null
					: namespaceAttributeMatch[1] === undefined
						? namespaceAttributeMatch[2]
						: namespaceAttributeMatch[1],
			schemaLocation:
				schemaLocationAttributeMatch === null
					? null
					: schemaLocationAttributeMatch[1] === undefined
						? schemaLocationAttributeMatch[2]
						: schemaLocationAttributeMatch[1],
		});
	}
	return importDeclarationList;
};

// ---------------------------------------------------------------------------
// Fetching. Sequential, polite, refusal-shaped.
// ---------------------------------------------------------------------------

const fetchUrlBytes = async (targetUrl, acquisitionLog) => {
	// Returns {contentBuffer, httpStatus} on success.
	// Returns {contentBuffer:null, failureDetail} on ANY failure — the CALLER decides
	// what a failure means. Nothing is written here, so a dead link can never become a
	// file.
	try {
		const fetchResponse = await fetch(targetUrl, {
			headers: { 'user-agent': USER_AGENT_STRING },
			redirect: 'follow',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
		});
		if (!fetchResponse.ok) {
			acquisitionLog.verbose(`HTTP ${fetchResponse.status} for ${targetUrl}`);
			return { contentBuffer: null, failureDetail: `HTTP ${fetchResponse.status}` };
		}
		const contentBuffer = Buffer.from(await fetchResponse.arrayBuffer());
		return { contentBuffer, httpStatus: fetchResponse.status };
	} catch (fetchError) {
		acquisitionLog.verbose(`${fetchError.name} for ${targetUrl}: ${fetchError.message}`);
		return { contentBuffer: null, failureDetail: `${fetchError.name}: ${fetchError.message}` };
	}
};

// ---------------------------------------------------------------------------
// The collector (gates G1 and G3 live here)
// ---------------------------------------------------------------------------

class CorpusCollector {
	// Accumulates accepted artifacts and refusals.
	//   - identical bytes offered twice → ONE variant, extra source in alsoLinkedFrom
	//   - one namespace, DIFFERENT bytes → BOTH variants kept (collision-named at write
	//     time) and the collision recorded as a structured fact. Acquisition chooses
	//     neither. (R-ACQ-4 — the deliberate change from the Python prototype.)
	constructor(acquisitionLog) {
		this.acquisitionLog = acquisitionLog;
		this.variantListByNamespace = new Map();
		this.refusalList = [];
		this.nonSchemaArtifactList = [];
	}

	offerArtifact({ contentBuffer, httpStatus, upstreamUrl, anchorLabel, sourcePage }) {
		for (const [oneRequiredName, oneRequiredValue] of [
			['contentBuffer', contentBuffer],
			['upstreamUrl', upstreamUrl],
			['sourcePage', sourcePage],
		]) {
			if (oneRequiredValue === undefined || oneRequiredValue === null) {
				throw new Error(
					`[CorpusCollector.offerArtifact] ${oneRequiredName} is required and was absent. ` +
						`It belongs to the acquisition function that downloaded the artifact.`,
				);
			}
		}

		const gateVerdict = evaluatePescSchemaGate(contentBuffer);
		if (!gateVerdict.accepted) {
			const contentPreviewText = contentBuffer
				.slice(0, 120)
				.toString('utf8')
				.replace(/�/g, '?')
				.trim();
			this.nonSchemaArtifactList.push({
				upstreamUrl,
				anchorLabel,
				sourcePage,
				byteCount: contentBuffer.length,
				rejectionReason: gateVerdict.rejectionReason,
				contentPreview: contentPreviewText,
			});
			this.acquisitionLog.verbose(
				`not a PESC schema (${gateVerdict.rejectionReason}): ${anchorLabel} ` +
					`(${contentBuffer.length} bytes)`,
			);
			return null;
		}

		const targetNamespace = gateVerdict.targetNamespace;
		const sha256Hex = crypto.createHash('sha256').update(contentBuffer).digest('hex');

		if (!this.variantListByNamespace.has(targetNamespace)) {
			this.variantListByNamespace.set(targetNamespace, []);
		}
		const variantList = this.variantListByNamespace.get(targetNamespace);

		const matchingVariant = variantList.find(
			(oneVariant) => oneVariant.sha256Hex === sha256Hex,
		);
		if (matchingVariant) {
			matchingVariant.alsoLinkedFrom.push({ sourcePage, anchorLabel, upstreamUrl });
			this.acquisitionLog.verbose(
				`identical bytes already held for ${targetNamespace}; recorded as alsoLinkedFrom`,
			);
			return targetNamespace;
		}

		variantList.push({
			targetNamespace,
			plainFilename: deriveFilenameFromNamespace(targetNamespace),
			sha256Hex,
			contentBuffer,
			byteCount: contentBuffer.length,
			upstreamUrl,
			anchorLabel,
			sourcePage,
			httpStatus,
			alsoLinkedFrom: [],
		});
		this.acquisitionLog.status(
			`  ACCEPTED ${deriveFilenameFromNamespace(targetNamespace).padEnd(44)} ` +
				`${String(contentBuffer.length).padStart(9)} bytes  sha256 ${sha256Hex.slice(0, 12)}`,
		);
		if (variantList.length === 2) {
			this.acquisitionLog.status(
				`  NAMESPACE COLLISION: ${targetNamespace} now has ${variantList.length} distinct ` +
					`byte variants — keeping BOTH (R-ACQ-4)`,
			);
		}
		return targetNamespace;
	}

	recordRefusal({ reason, upstreamUrl, anchorLabel, sourcePage, detail }) {
		if (!reason) {
			throw new Error(
				'[CorpusCollector.recordRefusal] reason is required and was absent; it belongs ' +
					'to the acquisition function reporting the failure.',
			);
		}
		this.refusalList.push({ reason, upstreamUrl, anchorLabel, sourcePage, detail });
		this.acquisitionLog.error(`${reason}: ${anchorLabel || upstreamUrl} -- ${detail}`);
	}
}

// ---------------------------------------------------------------------------
// Acquisition passes
// ---------------------------------------------------------------------------

const acquireFromStandardsPages = async (corpusCollector, acquisitionLog) => {
	// Scrape each standards page and offer every CDN artifact it links. Requests are
	// strictly sequential — politeness to pesc.org is a stated rule.
	const seenUpstreamUrlSet = new Set();
	const pageResultList = [];

	for (const onePageUrl of PESC_STANDARDS_PAGE_URLS) {
		acquisitionLog.status(`\nPAGE ${onePageUrl}`);
		const pageFetchResult = await fetchUrlBytes(onePageUrl, acquisitionLog);
		if (pageFetchResult.contentBuffer === null) {
			corpusCollector.recordRefusal({
				reason: 'standardsPageUnreachable',
				upstreamUrl: onePageUrl,
				anchorLabel: '',
				sourcePage: onePageUrl,
				detail: pageFetchResult.failureDetail,
			});
			pageResultList.push({
				pageUrl: onePageUrl,
				httpStatus: pageFetchResult.failureDetail,
				anchorCount: 0,
			});
			continue;
		}

		const anchorPairList = extractCdnAnchorPairsFromHtml(
			pageFetchResult.contentBuffer.toString('utf8'),
			onePageUrl,
		);
		acquisitionLog.status(`  ${anchorPairList.length} CDN links found`);
		pageResultList.push({
			pageUrl: onePageUrl,
			httpStatus: pageFetchResult.httpStatus,
			anchorCount: anchorPairList.length,
		});

		for (const oneAnchorPair of anchorPairList) {
			if (seenUpstreamUrlSet.has(oneAnchorPair.upstreamUrl)) {
				continue;
			}
			seenUpstreamUrlSet.add(oneAnchorPair.upstreamUrl);

			const artifactFetchResult = await fetchUrlBytes(
				oneAnchorPair.upstreamUrl,
				acquisitionLog,
			);
			if (artifactFetchResult.contentBuffer === null) {
				corpusCollector.recordRefusal({
					reason: 'artifactUnreachable',
					upstreamUrl: oneAnchorPair.upstreamUrl,
					anchorLabel: oneAnchorPair.anchorLabel,
					sourcePage: oneAnchorPair.sourcePage,
					detail: artifactFetchResult.failureDetail,
				});
				continue;
			}

			corpusCollector.offerArtifact({
				contentBuffer: artifactFetchResult.contentBuffer,
				httpStatus: artifactFetchResult.httpStatus,
				upstreamUrl: oneAnchorPair.upstreamUrl,
				anchorLabel: oneAnchorPair.anchorLabel,
				sourcePage: oneAnchorPair.sourcePage,
			});
		}
	}

	return pageResultList;
};

const listFilesRecursively = (rootDirectoryPath) => {
	const foundFilePathList = [];
	for (const oneDirectoryEntry of fs.readdirSync(rootDirectoryPath, { withFileTypes: true })) {
		const oneEntryPath = path.join(rootDirectoryPath, oneDirectoryEntry.name);
		if (oneDirectoryEntry.isDirectory()) {
			foundFilePathList.push(...listFilesRecursively(oneEntryPath));
		} else if (oneDirectoryEntry.isFile()) {
			foundFilePathList.push(oneEntryPath);
		}
	}
	return foundFilePathList;
};

const acquireFromSupplementaryZips = async (corpusCollector, acquisitionLog) => {
	// Extract PESC schemas from the published ZIP bundles. Node has no built-in ZIP
	// reader; /usr/bin/unzip does the unpacking (see header). Failure is a NAMED refusal.
	for (const oneZipUrl of SUPPLEMENTARY_ZIP_URLS) {
		acquisitionLog.status(`\nZIP  ${oneZipUrl}`);
		const zipFetchResult = await fetchUrlBytes(oneZipUrl, acquisitionLog);
		if (zipFetchResult.contentBuffer === null) {
			corpusCollector.recordRefusal({
				reason: 'zipUnreachable',
				upstreamUrl: oneZipUrl,
				anchorLabel: 'supplementary zip',
				sourcePage: oneZipUrl,
				detail: zipFetchResult.failureDetail,
			});
			continue;
		}

		const zipScratchDirectoryPath = fs.mkdtempSync(
			path.join(os.tmpdir(), 'pescCorpusZip-'),
		);
		try {
			const zipFilePath = path.join(zipScratchDirectoryPath, 'supplementary.zip');
			fs.writeFileSync(zipFilePath, zipFetchResult.contentBuffer);
			const zipExtractDirectoryPath = path.join(zipScratchDirectoryPath, 'extracted');
			fs.mkdirSync(zipExtractDirectoryPath);

			const unzipResult = childProcess.spawnSync(
				UNZIP_EXECUTABLE_PATH,
				['-o', '-qq', zipFilePath, '-d', zipExtractDirectoryPath],
				{ encoding: 'utf8' },
			);
			if (unzipResult.error || unzipResult.status !== 0) {
				const unzipFailureDetail = unzipResult.error
					? `${unzipResult.error.name}: ${unzipResult.error.message}`
					: `unzip exit status ${unzipResult.status}; stderr: ${(unzipResult.stderr || '').trim()}`;
				corpusCollector.recordRefusal({
					reason: 'zipUnreadable',
					upstreamUrl: oneZipUrl,
					anchorLabel: 'supplementary zip',
					sourcePage: oneZipUrl,
					detail: unzipFailureDetail,
				});
				continue;
			}

			for (const oneExtractedFilePath of listFilesRecursively(zipExtractDirectoryPath)) {
				corpusCollector.offerArtifact({
					contentBuffer: fs.readFileSync(oneExtractedFilePath),
					httpStatus: zipFetchResult.httpStatus,
					upstreamUrl: oneZipUrl,
					anchorLabel: path.basename(oneExtractedFilePath),
					sourcePage: oneZipUrl,
				});
			}
		} finally {
			// Best-effort scratch cleanup. macOS occasionally throws a transient ENOTEMPTY
			// from recursive rm; a failed TEMP cleanup must never abort the acquisition
			// (observed 2026-08-05: it killed a run after every artifact had been accepted).
			try {
				fs.rmSync(zipScratchDirectoryPath, {
					recursive: true,
					force: true,
					maxRetries: 5,
					retryDelay: 100,
				});
			} catch (scratchCleanupError) {
				acquisitionLog.verbose(
					`zip scratch cleanup failed (non-fatal): ${scratchCleanupError.message} ` +
						`(${zipScratchDirectoryPath})`,
				);
			}
		}
	}
};

const acquireFromLegacyMirror = async (corpusCollector, acquisitionLog) => {
	// The OCAS mirror carries the legacy Transcript roots that pesc.org no longer links.
	for (const oneMirrorUrl of LEGACY_MIRROR_XSD_URLS) {
		acquisitionLog.status(`\nMIRROR ${oneMirrorUrl}`);
		const mirrorFetchResult = await fetchUrlBytes(oneMirrorUrl, acquisitionLog);
		if (mirrorFetchResult.contentBuffer === null) {
			corpusCollector.recordRefusal({
				reason: 'legacyMirrorUnreachable',
				upstreamUrl: oneMirrorUrl,
				anchorLabel: path.basename(oneMirrorUrl),
				sourcePage: 'developer.ocas.ca',
				detail: mirrorFetchResult.failureDetail,
			});
			continue;
		}
		corpusCollector.offerArtifact({
			contentBuffer: mirrorFetchResult.contentBuffer,
			httpStatus: mirrorFetchResult.httpStatus,
			upstreamUrl: oneMirrorUrl,
			anchorLabel: path.basename(oneMirrorUrl),
			sourcePage: 'developer.ocas.ca',
		});
	}
};

// ---------------------------------------------------------------------------
// Closure evaluation and output
// ---------------------------------------------------------------------------

const buildArtifactRecordList = (corpusCollector) => {
	// Assign final filenames: a lone variant keeps its plain name; every member of a
	// multi-variant namespace is collision-named. NEITHER member of a collision gets the
	// plain name — acquisition chooses neither.
	const artifactRecordList = [];
	for (const [oneNamespace, variantList] of corpusCollector.variantListByNamespace) {
		const namespaceHasCollision = variantList.length > 1;
		for (const oneVariant of variantList) {
			artifactRecordList.push({
				filename: namespaceHasCollision
					? deriveCollisionFilename(oneVariant.plainFilename, oneVariant.sha256Hex)
					: oneVariant.plainFilename,
				targetNamespace: oneNamespace,
				collisionMember: namespaceHasCollision,
				upstreamUrl: oneVariant.upstreamUrl,
				sourcePage: oneVariant.sourcePage,
				anchorLabel: oneVariant.anchorLabel,
				httpStatus: oneVariant.httpStatus,
				byteCount: oneVariant.byteCount,
				sha256: oneVariant.sha256Hex,
				alsoLinkedFrom: oneVariant.alsoLinkedFrom,
				contentBuffer: oneVariant.contentBuffer,
			});
		}
	}
	artifactRecordList.sort((leftRecord, rightRecord) =>
		leftRecord.filename < rightRecord.filename ? -1 : leftRecord.filename > rightRecord.filename ? 1 : 0,
	);
	return artifactRecordList;
};

const buildNamespaceCollisionFactList = (corpusCollector) => {
	const namespaceCollisionFactList = [];
	for (const [oneNamespace, variantList] of corpusCollector.variantListByNamespace) {
		if (variantList.length < 2) {
			continue;
		}
		namespaceCollisionFactList.push({
			targetNamespace: oneNamespace,
			memberCount: variantList.length,
			members: variantList
				.map((oneVariant) => ({
					filename: deriveCollisionFilename(oneVariant.plainFilename, oneVariant.sha256Hex),
					byteCount: oneVariant.byteCount,
					sha256: oneVariant.sha256Hex,
					upstreamUrl: oneVariant.upstreamUrl,
					sourcePage: oneVariant.sourcePage,
					anchorLabel: oneVariant.anchorLabel,
				}))
				.sort((leftMember, rightMember) =>
					leftMember.filename < rightMember.filename ? -1 : 1,
				),
			statement:
				'PESC publishes MULTIPLE different files under this one namespace. ' +
				'Acquisition retains every variant, discriminated by content hash, and chooses ' +
				'neither; resolution is a forge decision (spec R-ACQ-4).',
		});
	}
	return namespaceCollisionFactList;
};

const evaluateImportClosure = (corpusCollector) => {
	// An import is satisfied only when a schema declaring EXACTLY that namespace is
	// present. No version-insensitive matching (see header).
	const acquiredNamespaceSet = new Set(corpusCollector.variantListByNamespace.keys());
	const satisfiedImportList = [];
	const unsatisfiedImportList = [];

	for (const [oneNamespace, variantList] of corpusCollector.variantListByNamespace) {
		for (const oneVariant of variantList) {
			for (const oneImportDeclaration of readImportDeclarations(oneVariant.contentBuffer)) {
				if (oneImportDeclaration.namespace === null) {
					continue; // an import with no namespace attribute imports the null namespace
				}
				const importRecord = {
					importedBy: oneNamespace,
					importedByFilename: oneVariant.plainFilename,
					requiredNamespace: oneImportDeclaration.namespace,
					declaredSchemaLocation: oneImportDeclaration.schemaLocation,
				};
				if (acquiredNamespaceSet.has(oneImportDeclaration.namespace)) {
					satisfiedImportList.push(importRecord);
				} else {
					unsatisfiedImportList.push(importRecord);
				}
			}
		}
	}
	return { satisfiedImportList, unsatisfiedImportList };
};

const writeCorpus = ({ corpusCollector, outputDirectoryPath, pageResultList, acquisitionLog }) => {
	// Write the schemas (flat, matching the standardSourceData layout), the manifest,
	// and SHA256SUMS (byte-order sorted by filename, `<sha256>  <filename>` lines).
	fs.mkdirSync(outputDirectoryPath, { recursive: true });

	const artifactRecordList = buildArtifactRecordList(corpusCollector);
	for (const oneArtifactRecord of artifactRecordList) {
		fs.writeFileSync(
			path.join(outputDirectoryPath, oneArtifactRecord.filename),
			oneArtifactRecord.contentBuffer,
		);
	}

	const namespaceCollisionFactList = buildNamespaceCollisionFactList(corpusCollector);
	const { satisfiedImportList, unsatisfiedImportList } = evaluateImportClosure(corpusCollector);

	const manifestRecord = {
		aggregateVersionOwner:
			'educoreForge. THIS AGGREGATE IS OURS, not a PESC release; PESC publishes no ' +
			'coherent whole-family edition. A version number is assigned when the corpus is ' +
			'cut into assets/standardSourceData/.',
		acquisitionTool: 'acquirePescCorpus.js',
		acquisitionRunDate: new Date().toISOString(),
		compositionRule:
			'Every CDN artifact linked from the PESC standards pages, plus the published ' +
			'Request/Response ZIP and the OCAS legacy mirror, retained if and only if it ' +
			'parses as XML and declares a urn:org:pesc:* targetNamespace. Filenames are ' +
			'derived from the targetNamespace, never from anchor text.',
		repairPolicy:
			'NONE. This corpus is a faithful mirror of what PESC published, including its ' +
			'contradictions. A namespace claimed by multiple differing files keeps EVERY ' +
			'variant under collision names; acquisition chooses neither.',
		sourcePages: pageResultList,
		supplementaryZipUrls: SUPPLEMENTARY_ZIP_URLS,
		legacyMirrorUrls: LEGACY_MIRROR_XSD_URLS,
		artifactCount: artifactRecordList.length,
		totalBytes: artifactRecordList.reduce(
			(runningTotal, oneArtifactRecord) => runningTotal + oneArtifactRecord.byteCount,
			0,
		),
		refusedCount: corpusCollector.refusalList.length,
		nonSchemaCount: corpusCollector.nonSchemaArtifactList.length,
		importsSatisfied: satisfiedImportList.length,
		importsUnsatisfied: unsatisfiedImportList.length,
		namespaceCollisions: namespaceCollisionFactList,
		artifacts: artifactRecordList.map((oneArtifactRecord) => ({
			filename: oneArtifactRecord.filename,
			targetNamespace: oneArtifactRecord.targetNamespace,
			collisionMember: oneArtifactRecord.collisionMember,
			upstreamUrl: oneArtifactRecord.upstreamUrl,
			sourcePage: oneArtifactRecord.sourcePage,
			anchorLabel: oneArtifactRecord.anchorLabel,
			httpStatus: oneArtifactRecord.httpStatus,
			byteCount: oneArtifactRecord.byteCount,
			sha256: oneArtifactRecord.sha256,
			alsoLinkedFrom: oneArtifactRecord.alsoLinkedFrom,
		})),
		unsatisfiedImports: unsatisfiedImportList,
		refusals: corpusCollector.refusalList,
		nonSchemaArtifacts: corpusCollector.nonSchemaArtifactList,
	};

	const manifestFilePath = path.join(outputDirectoryPath, 'manifest.json');
	fs.writeFileSync(manifestFilePath, `${JSON.stringify(manifestRecord, null, 2)}\n`);

	const checksumFilePath = path.join(outputDirectoryPath, 'SHA256SUMS');
	fs.writeFileSync(
		checksumFilePath,
		artifactRecordList
			.map((oneArtifactRecord) => `${oneArtifactRecord.sha256}  ${oneArtifactRecord.filename}\n`)
			.join(''),
	);

	acquisitionLog.status(`\nWrote ${manifestFilePath}`);
	acquisitionLog.status(`Wrote ${checksumFilePath}`);
	return manifestRecord;
};

// ---------------------------------------------------------------------------
// Self-test (gates G1, G2, G3 — each shown RED with its guard disabled, then GREEN)
// ---------------------------------------------------------------------------

const runSelfTestGates = () => {
	const selfTestLog = new AcquisitionLog(false);
	const evidenceLineList = [];
	let observedRedCount = 0;
	let observedGreenCount = 0;
	let unexpectedOutcomeCount = 0;

	const emitEvidence = (evidenceText) => {
		evidenceLineList.push(evidenceText);
		process.stdout.write(`${evidenceText}\n`);
	};
	const reportAssertion = ({ phaseLabel, assertionLabel, assertionHolds, redExpected }) => {
		// redExpected=true marks the deliberate guard-disabled run: the assertion MUST be
		// observed failing there, or the gate proves nothing.
		const outcomeText = assertionHolds ? 'ASSERTION PASS' : 'ASSERTION FAIL';
		emitEvidence(`  [${phaseLabel}] ${outcomeText}: ${assertionLabel}`);
		if (redExpected && !assertionHolds) {
			observedRedCount += 1;
		} else if (!redExpected && assertionHolds) {
			observedGreenCount += 1;
		} else {
			unexpectedOutcomeCount += 1;
			emitEvidence(
				`  [${phaseLabel}] UNEXPECTED: this run was supposed to ${redExpected ? 'FAIL (red)' : 'PASS (green)'}`,
			);
		}
	};

	const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pescCorpusSelfTest-'));
	emitEvidence(`=== acquirePescCorpus SELF-TEST (local fixtures, no network) ===`);
	emitEvidence(`scratch: ${scratchDirectoryPath}`);

	// ---- G1: HTTP error body must never reach disk --------------------------------
	emitEvidence('\nG1: retention gate refuses an HTTP error body');
	const errorBodyFixtureBuffer = Buffer.from('{"error":"asset-not-found"}');

	// RED: guard logically disabled — write the offered bytes straight to disk exactly
	// as the pre-gate ad hoc harvest did, then assert no non-schema file exists.
	const g1RedDirectoryPath = path.join(scratchDirectoryPath, 'g1Red');
	fs.mkdirSync(g1RedDirectoryPath);
	fs.writeFileSync(path.join(g1RedDirectoryPath, 'CoreMain_v1.19.1.xsd'), errorBodyFixtureBuffer);
	reportAssertion({
		phaseLabel: 'G1 RED (gate disabled)',
		assertionLabel: 'no file was written for the {"error":"asset-not-found"} body',
		assertionHolds: fs.readdirSync(g1RedDirectoryPath).length === 0,
		redExpected: true,
	});

	// GREEN: the real path — offer through the collector, write the corpus.
	const g1GreenCollector = new CorpusCollector(selfTestLog);
	g1GreenCollector.offerArtifact({
		contentBuffer: errorBodyFixtureBuffer,
		httpStatus: 200,
		upstreamUrl: 'https://nebula.wsimg.com/fixtureErrorBody',
		anchorLabel: 'CoreMain v1.19.1 (fixture)',
		sourcePage: 'selfTestFixture',
	});
	const g1GreenDirectoryPath = path.join(scratchDirectoryPath, 'g1Green');
	writeCorpus({
		corpusCollector: g1GreenCollector,
		outputDirectoryPath: g1GreenDirectoryPath,
		pageResultList: [],
		acquisitionLog: selfTestLog,
	});
	reportAssertion({
		phaseLabel: 'G1 GREEN',
		assertionLabel: 'no .xsd written; error body recorded as nonSchema refusal',
		assertionHolds:
			fs.readdirSync(g1GreenDirectoryPath).filter((oneName) => oneName.endsWith('.xsd'))
				.length === 0 &&
			g1GreenCollector.nonSchemaArtifactList.length === 1 &&
			g1GreenCollector.nonSchemaArtifactList[0].rejectionReason === 'contentDoesNotBeginWithXml',
		redExpected: false,
	});

	// ---- G2: entity-encoded ampersands must be unescaped --------------------------
	emitEvidence('\nG2: href extractor unescapes entity-encoded ampersands');
	const anchorFixtureHtml =
		'<p><a href="https://nebula.wsimg.com/abc123?AccessKeyId=KEY&amp;disposition=0&amp;alloworigin=1">' +
		'CoreMain v1.19.0</a></p>';

	// RED: guard logically disabled — take the href exactly as written in the HTML.
	const rawHrefMatch = anchorFixtureHtml.match(/href="([^"]+)"/);
	if (rawHrefMatch === null) {
		throw new Error('[selfTest G2] fixture anchor did not match; the fixture is broken.');
	}
	const rawHrefText = rawHrefMatch[1];
	reportAssertion({
		phaseLabel: 'G2 RED (unescape disabled)',
		assertionLabel: `no '&amp;' survives in the request URL (raw href: ${rawHrefText})`,
		assertionHolds: !rawHrefText.includes('&amp;'),
		redExpected: true,
	});

	// GREEN: the real extractor.
	const extractedAnchorPairList = extractCdnAnchorPairsFromHtml(anchorFixtureHtml, 'selfTestFixture');
	reportAssertion({
		phaseLabel: 'G2 GREEN',
		assertionLabel:
			`no '&amp;' survives and the literal '&' is present ` +
			`(extracted: ${extractedAnchorPairList.length ? extractedAnchorPairList[0].upstreamUrl : 'NONE'})`,
		assertionHolds:
			extractedAnchorPairList.length === 1 &&
			!extractedAnchorPairList[0].upstreamUrl.includes('&amp;') &&
			extractedAnchorPairList[0].upstreamUrl.includes('AccessKeyId=KEY&disposition=0'),
		redExpected: false,
	});

	// ---- G3: namespace collision keeps BOTH; identical bytes keep ONE -------------
	emitEvidence('\nG3: one namespace, different bytes -> BOTH kept under collision names');
	const collisionNamespaceText = 'urn:org:pesc:sector:AcademicRecord:v9.9.9';
	const collisionVariantABuffer = Buffer.from(
		`<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" ` +
			`targetNamespace="${collisionNamespaceText}"><xs:element name="RequestType"/></xs:schema>\n`,
	);
	const collisionVariantBBuffer = Buffer.from(
		`<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" ` +
			`targetNamespace="${collisionNamespaceText}"><xs:element name="TestScoreReportType"/></xs:schema>\n`,
	);
	const variantASha256Hex = crypto.createHash('sha256').update(collisionVariantABuffer).digest('hex');
	const variantBSha256Hex = crypto.createHash('sha256').update(collisionVariantBBuffer).digest('hex');
	const expectedCollisionFilenameA = `AcademicRecord_v9.9.9.collision-${variantASha256Hex.slice(0, 12)}.xsd`;
	const expectedCollisionFilenameB = `AcademicRecord_v9.9.9.collision-${variantBSha256Hex.slice(0, 12)}.xsd`;

	// RED: guard logically disabled — replicate the PROTOTYPE's wrong behaviour (keep
	// the first variant, refuse the second), then assert both variants reached disk.
	const g3RedDirectoryPath = path.join(scratchDirectoryPath, 'g3Red');
	fs.mkdirSync(g3RedDirectoryPath);
	fs.writeFileSync(path.join(g3RedDirectoryPath, 'AcademicRecord_v9.9.9.xsd'), collisionVariantABuffer);
	// second variant refused, exactly as acquirePescAggregation.py did
	reportAssertion({
		phaseLabel: 'G3 RED (keep-both disabled; prototype refusal behaviour)',
		assertionLabel: 'both byte-variants of the namespace are present on disk',
		assertionHolds:
			fs.existsSync(path.join(g3RedDirectoryPath, expectedCollisionFilenameA)) &&
			fs.existsSync(path.join(g3RedDirectoryPath, expectedCollisionFilenameB)),
		redExpected: true,
	});

	// GREEN: the real collector keeps both, collision-named, with a manifest fact.
	const g3GreenCollector = new CorpusCollector(selfTestLog);
	for (const [oneVariantBuffer, oneVariantLabel] of [
		[collisionVariantABuffer, 'variant A (fixture)'],
		[collisionVariantBBuffer, 'variant B (fixture)'],
	]) {
		g3GreenCollector.offerArtifact({
			contentBuffer: oneVariantBuffer,
			httpStatus: 200,
			upstreamUrl: `https://nebula.wsimg.com/${oneVariantLabel.replace(/[^\w]/g, '')}`,
			anchorLabel: oneVariantLabel,
			sourcePage: 'selfTestFixture',
		});
	}
	const g3GreenDirectoryPath = path.join(scratchDirectoryPath, 'g3Green');
	const g3ManifestRecord = writeCorpus({
		corpusCollector: g3GreenCollector,
		outputDirectoryPath: g3GreenDirectoryPath,
		pageResultList: [],
		acquisitionLog: selfTestLog,
	});
	reportAssertion({
		phaseLabel: 'G3 GREEN',
		assertionLabel:
			'both collision-named files on disk, no plain-named file, collision fact in manifest',
		assertionHolds:
			fs.existsSync(path.join(g3GreenDirectoryPath, expectedCollisionFilenameA)) &&
			fs.existsSync(path.join(g3GreenDirectoryPath, expectedCollisionFilenameB)) &&
			!fs.existsSync(path.join(g3GreenDirectoryPath, 'AcademicRecord_v9.9.9.xsd')) &&
			g3ManifestRecord.namespaceCollisions.length === 1 &&
			g3ManifestRecord.namespaceCollisions[0].memberCount === 2,
		redExpected: false,
	});

	// G3b: identical bytes offered twice -> ONE file, extra source in alsoLinkedFrom.
	const g3IdenticalCollector = new CorpusCollector(selfTestLog);
	for (const oneSourcePageLabel of ['selfTestFixturePageOne', 'selfTestFixturePageTwo']) {
		g3IdenticalCollector.offerArtifact({
			contentBuffer: collisionVariantABuffer,
			httpStatus: 200,
			upstreamUrl: `https://nebula.wsimg.com/sameBytes-${oneSourcePageLabel}`,
			anchorLabel: 'same bytes twice (fixture)',
			sourcePage: oneSourcePageLabel,
		});
	}
	const g3IdenticalDirectoryPath = path.join(scratchDirectoryPath, 'g3Identical');
	writeCorpus({
		corpusCollector: g3IdenticalCollector,
		outputDirectoryPath: g3IdenticalDirectoryPath,
		pageResultList: [],
		acquisitionLog: selfTestLog,
	});
	const identicalRunVariantList =
		g3IdenticalCollector.variantListByNamespace.get(collisionNamespaceText);
	reportAssertion({
		phaseLabel: 'G3 GREEN (identical bytes)',
		assertionLabel: 'one plain-named file only; second source recorded in alsoLinkedFrom',
		assertionHolds:
			fs.readdirSync(g3IdenticalDirectoryPath).filter((oneName) => oneName.endsWith('.xsd'))
				.length === 1 &&
			fs.existsSync(path.join(g3IdenticalDirectoryPath, 'AcademicRecord_v9.9.9.xsd')) &&
			identicalRunVariantList.length === 1 &&
			identicalRunVariantList[0].alsoLinkedFrom.length === 1,
		redExpected: false,
	});

	fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });

	emitEvidence('\n=== SELF-TEST SUMMARY ===');
	emitEvidence(`  red demonstrations observed failing : ${observedRedCount} (expected 3)`);
	emitEvidence(`  green assertions observed passing   : ${observedGreenCount} (expected 4)`);
	emitEvidence(`  unexpected outcomes                 : ${unexpectedOutcomeCount} (required 0)`);

	const selfTestVerdictIsPass =
		observedRedCount === 3 && observedGreenCount === 4 && unexpectedOutcomeCount === 0;
	emitEvidence(`  VERDICT: ${selfTestVerdictIsPass ? 'SELF-TEST PASS' : 'SELF-TEST FAIL'}`);
	return selfTestVerdictIsPass;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
	const commandLineParameters = readCommandLineParameters(process.argv);

	if (commandLineParameters.selfTestEnabled) {
		const selfTestVerdictIsPass = runSelfTestGates();
		process.exitCode = selfTestVerdictIsPass ? 0 : 1;
		return;
	}

	const acquisitionLog = new AcquisitionLog(commandLineParameters.verboseEnabled);
	const corpusCollector = new CorpusCollector(acquisitionLog);

	acquisitionLog.status('=== PESC CORPUS ACQUISITION ===');
	const pageResultList = await acquireFromStandardsPages(corpusCollector, acquisitionLog);
	await acquireFromSupplementaryZips(corpusCollector, acquisitionLog);
	await acquireFromLegacyMirror(corpusCollector, acquisitionLog);

	const manifestRecord = writeCorpus({
		corpusCollector,
		outputDirectoryPath: commandLineParameters.outDirPath,
		pageResultList,
		acquisitionLog,
	});

	acquisitionLog.status('\n=== SUMMARY ===');
	acquisitionLog.status(`  artifacts written    : ${manifestRecord.artifactCount}`);
	acquisitionLog.status(`  namespace collisions : ${manifestRecord.namespaceCollisions.length}`);
	acquisitionLog.status(`  refusals             : ${manifestRecord.refusedCount}`);
	acquisitionLog.status(`  non-schema artifacts : ${manifestRecord.nonSchemaCount}`);
	acquisitionLog.status(`  imports satisfied    : ${manifestRecord.importsSatisfied}`);
	acquisitionLog.status(`  imports UNSATISFIED  : ${manifestRecord.importsUnsatisfied}`);
	if (manifestRecord.importsUnsatisfied > 0) {
		acquisitionLog.status('\n  UNSATISFIED IMPORTS (closure is NOT complete):');
		for (const oneUnsatisfiedImport of manifestRecord.unsatisfiedImports) {
			acquisitionLog.status(
				`    ${oneUnsatisfiedImport.importedByFilename} needs ${oneUnsatisfiedImport.requiredNamespace}`,
			);
		}
	}
};

main().catch((mainError) => {
	process.stderr.write(`FATAL: ${mainError.stack}\n`);
	process.exitCode = 1;
});
