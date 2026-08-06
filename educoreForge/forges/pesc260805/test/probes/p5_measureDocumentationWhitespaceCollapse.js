#!/usr/bin/env node
'use strict';

// p5_measureDocumentationWhitespaceCollapse.js — Phase 5 (session CRYSTAL_STREAM).
// THE O-2 MEASUREMENT. Answers, with a number, the question the SPEC left open and the work order
// ordered measured BEFORE it is decided: how many real differences does
// `roundTripXsdCanonical.js:99-104`'s `.replace(/\s+/g,' ').trim()` currently HIDE?
//
// WHY THIS SHAPE AND NOT A CHEAPER ONE. A normalization applied to BOTH sides of a comparison makes
// every difference it erases invisible BY CONSTRUCTION — the comparison then agrees with itself on
// that dimension whether or not any difference exists. That is the pure-function trap wearing
// validator clothing (DESIGN §8h). The escape is a basis the system publishes INDEPENDENTLY:
//
//   BASIS A — the corpus bytes on disk, SHA256-verified against the snapshot's own SHA256SUMS.
//   BASIS B — the `documentation` property the forge actually stored in Neo4j, read over bolt.
//
// Neither is derived from the other by any code in this repository: A is what PESC published, B is
// what survived parse + shape + replay + bolt. They can genuinely disagree, so a count taken across
// them is a MEASUREMENT and not a theorem.
//
// WHAT IS COMPARED. Documentation literals only — the channel the collapse acts on — as MULTISETS,
// which is the same set-membership criterion the real comparator uses (spec §7.1, statements not
// bytes). Two normalization modes, differing in exactly one operation:
//
//   collapse  — decode character references, `.replace(/\s+/g,' ')`, trim   (WHAT SHIPS TODAY)
//   verbatim  — decode character references, trim                          (R-VAL-2's discipline)
//
// Character-reference decoding is GRAMMAR knowledge (XML 1.0 §4.1), applied identically in both
// modes, so it cannot account for any part of the delta. Trim is retained in both modes because the
// whitespace immediately inside an `xs:documentation` tag is the enclosing document's indentation
// rather than the author's prose; that choice is DECLARED here rather than assumed, and it is the
// one normalization this probe does not measure.
//
// THE DELIVERABLE IS THE DELTA: literals that match under `collapse` but NOT under `verbatim` are
// exactly the differences the shipped collapse conceals from every verdict it has ever produced.
//
// DECLARED LIMIT OF THIS INSTRUMENT — stated here rather than discovered later, on the same
// discipline the canonicalizer applies to its own unmodeled constructs. This is a MULTISET
// comparison over literals with NO SUBJECT attached, so a literal genuinely lost from component A
// is MASKED whenever the identical text occurs on some component B. Measured, not supposed: the
// corpus holds 5 xs:annotation elements carrying more than one xs:documentation child, and the
// forge keeps only the first, discarding 5 literals — yet this probe reports only 2 as
// unreproduced.
//
// THE RECONCILIATION IS NOT THE MASKING ABOVE, and that distinction is the point. The first
// explanation offered for the 5-versus-2 gap was masking, and it was WRONG. Enumerated by
// p5_enumerateMultiDocumentationResidue.js: 3 of the 5 discarded literals are EMPTY STRINGS
// (CourseRepeatabilityCodeType in CoreMain v1.13.0, v1.14.0 and v1.16.0), and empty literals are
// dropped on BOTH sides before comparison, so they never entered the count at all. The real
// content loss is exactly the 2 non-empty literals this probe reports. The masking limit stated
// above is a true property of a multiset comparison and stays declared — it simply is not what
// produced this difference. A plausible mechanism that happens to predict the right number is
// still a guess; the enumeration is what settled it.
//
// The full validator compares SUBJECTED statements and does not have the masking blind spot; this
// probe trades subject precision for the ability to run without an emitter, which is what made the
// O-2 number available before the emitter existed. Read its unreproduced count as a FLOOR on
// documentation loss.
//
// READ-ONLY. Mutates nothing — not the graph, not the corpus, not the bundle. Takes bolt
// credentials on stdin as JSON so no credential is written into a file, and there is NO DEFAULT:
//   jq -nc '{boltUrl:"bolt://localhost:PORT",neo4jUser:"neo4j",neo4jPassword:"..."}' \
//     | node test/probes/p5_measureDocumentationWhitespaceCollapse.js
//
// An optional `corpusOverrideDirPath` reads the .xsd set from somewhere OTHER than the pinned
// snapshot. That exists for ONE purpose: the red lever. Pointing it at a copied corpus carrying a
// single mutated documentation string moves the `verbatim` count and leaves the `collapse` count
// untouched — a DATA lever, on production corpus bytes, demonstrating the blindness directly
// rather than by moving a pinned expectation. When it is used the report says so, loudly, because a
// measurement taken against a substituted corpus must never be read as a measurement of the pinned
// one. SHA256SUMS verification is SKIPPED for an override (the mutation is the point) and that
// skip is likewise reported.
//
// House style: no async/await, no try/catch for control flow. xml2js delivers parse failures
// through its own callback; the neo4j driver's Promises are resolved back into the err-string
// convention at the single leaf that owns them (the blessed dispensation,
// apps/graph-builder/DOCTRINE.md).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const REPO_NODE_MODULES = path.join(__dirname, '..', '..', '..', '..', 'node_modules');
const neo4j = require(path.join(REPO_NODE_MODULES, 'neo4j-driver'));
const xml2js = require(path.join(REPO_NODE_MODULES, 'xml2js'));
const { pipeRunner, taskListPlus } = new (require(
	path.join(REPO_NODE_MODULES, 'qtools-asynchronous-pipe-plus'),
))();

const moduleName = 'p5_measureDocumentationWhitespaceCollapse';

const BUNDLE_DIR = path.join(__dirname, '..', '..');
const PINNED_SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');

// The two modes, declared as data rather than as a branch, so adding a third is a row and not an
// edit to the walk (polyArch2: registry over switch).
const NORMALIZATION_MODE_LIST = [
	{
		modeName: 'collapse',
		description: 'decode character references, collapse whitespace runs to one space, trim — WHAT SHIPS TODAY (roundTripXsdCanonical.js:99-104)',
		collapsesWhitespaceRuns: true,
	},
	{
		modeName: 'verbatim',
		description: 'decode character references, trim — R-VAL-2 verbatim discipline, internal whitespace PRESERVED',
		collapsesWhitespaceRuns: false,
	},
];

// -----
// decodeXmlCharacterReferences — XML 1.0 §4.1, character and entity references to their characters.
// Order is load-bearing: numeric and named forms first, bare '&amp;' LAST, so a literal ampersand
// cannot cascade into a second decode. Copied in behaviour from the incumbent canonicalizer so the
// measurement models the shipped instrument rather than a variant of it.
const decodeXmlCharacterReferences = (text) =>
	String(text)
		.replace(/&#x([0-9a-fA-F]+);/g, (unused, hexCode) => String.fromCodePoint(parseInt(hexCode, 16)))
		.replace(/&#(\d+);/g, (unused, decimalCode) => String.fromCodePoint(parseInt(decimalCode, 10)))
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');

// -----
// normalizeUnderMode — the ONE place the two modes differ. `collapsesWhitespaceRuns` is read from
// the mode row; an unknown mode row is refused by name rather than silently treated as verbatim.
const normalizeUnderMode = (rawText, normalizationMode) => {
	if (!normalizationMode || typeof normalizationMode.collapsesWhitespaceRuns !== 'boolean') {
		throw new Error(
			`${moduleName}.normalizeUnderMode: a normalization mode row carrying a boolean ` +
				`collapsesWhitespaceRuns is REQUIRED; got ${JSON.stringify(normalizationMode)}. ` +
				`There is no default mode.`,
		);
	}
	const decodedText = decodeXmlCharacterReferences(String(rawText == null ? '' : rawText));
	return normalizationMode.collapsesWhitespaceRuns
		? decodedText.replace(/\s+/g, ' ').trim()
		: decodedText.trim();
};

// -----
// collectDocumentationLiteralsFromParsedXml — every xs:documentation text node anywhere in the
// document, in a deterministic walk. Deliberately NOT scoped to the components the graph models:
// the question is what the corpus SAYS, and a literal the graph never stored is a real absence that
// this probe must be able to see rather than one it defines away.
// THE WALK DESCENDS THROUGH BOTH OBJECTS AND ARRAYS, and that is not a stylistic choice. xml2js
// wraps CHILD elements in arrays but leaves the ROOT (`xs:schema`) a bare object. A first version
// of this walk descended only into arrays, so it refused at the root and reported ZERO source
// literals against 15,057 graph literals — and then computed a perfectly believable
// `hiddenByWhitespaceCollapseTotal: 0` from that emptiness. That is DEVLOG trap 5 exactly: a census
// taken before the thing it counts returns a plausible zero, not an error. The refusal below is the
// structural cure; this comment is why it exists.
const collectDocumentationLiteralsFromParsedXml = (parsedElement, collectedLiteralList) => {
	if (!parsedElement || typeof parsedElement !== 'object') {
		return collectedLiteralList;
	}
	if (Array.isArray(parsedElement)) {
		parsedElement.forEach((oneEntry) =>
			collectDocumentationLiteralsFromParsedXml(oneEntry, collectedLiteralList),
		);
		return collectedLiteralList;
	}
	Object.keys(parsedElement).forEach((oneChildName) => {
		if (oneChildName === '$' || oneChildName === '_') {
			return;
		}
		const childValue = parsedElement[oneChildName];
		if (oneChildName.endsWith(':documentation') || oneChildName === 'documentation') {
			const childValueList = Array.isArray(childValue) ? childValue : [childValue];
			childValueList.forEach((oneChildValue) => {
				const literalText =
					typeof oneChildValue === 'string'
						? oneChildValue
						: (oneChildValue && oneChildValue['_']) || '';
				collectedLiteralList.push(literalText);
			});
			return;
		}
		collectDocumentationLiteralsFromParsedXml(childValue, collectedLiteralList);
	});
	return collectedLiteralList;
};

// -----
// countsByNormalizedLiteral — a multiset as a Map, so the comparison is by membership WITH
// multiplicity. Empty literals are dropped on BOTH sides identically (an empty documentation
// element asserts nothing about prose) and the drop is counted so it is never silent.
const countsByNormalizedLiteral = (rawLiteralList, normalizationMode) => {
	const literalCounts = new Map();
	let emptyAfterNormalizationCount = 0;
	rawLiteralList.forEach((oneRawLiteral) => {
		const normalizedLiteral = normalizeUnderMode(oneRawLiteral, normalizationMode);
		if (normalizedLiteral === '') {
			emptyAfterNormalizationCount += 1;
			return;
		}
		literalCounts.set(normalizedLiteral, (literalCounts.get(normalizedLiteral) || 0) + 1);
	});
	return { literalCounts, emptyAfterNormalizationCount };
};

const multisetTotal = (literalCounts) => {
	let total = 0;
	literalCounts.forEach((oneCount) => {
		total += oneCount;
	});
	return total;
};

const multisetMatchedTotal = (leftCounts, rightCounts) => {
	let matched = 0;
	leftCounts.forEach((oneLeftCount, oneLiteral) => {
		const rightCount = rightCounts.get(oneLiteral);
		if (rightCount !== undefined) {
			matched += Math.min(oneLeftCount, rightCount);
		}
	});
	return matched;
};

// =====================================================================
// stdin — the bolt triple, refused by name when absent. No default endpoint is guessed at.
// =====================================================================

const readStdinJson = (callback) => {
	let stdinText = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (oneChunk) => {
		stdinText += oneChunk;
	});
	process.stdin.on('end', () => {
		if (stdinText.trim() === '') {
			callback(
				`${moduleName}: bolt credentials are REQUIRED on stdin as JSON and there is NO DEFAULT — ` +
					`{boltUrl, neo4jUser, neo4jPassword}, optionally corpusOverrideDirPath. ` +
					`Resolve the port from the CONTAINER, never from a document.`,
			);
			return;
		}
		const parsedStdin = JSON.parse(stdinText);
		const missingNameList = ['boltUrl', 'neo4jUser', 'neo4jPassword'].filter(
			(oneName) => typeof parsedStdin[oneName] !== 'string' || parsedStdin[oneName].trim() === '',
		);
		if (missingNameList.length) {
			callback(
				`${moduleName}: stdin JSON is missing required value(s): ${missingNameList.join(', ')}. ` +
					`Each is REQUIRED and none has a default.`,
			);
			return;
		}
		callback('', parsedStdin);
	});
};

// =====================================================================
// the pipeline
// =====================================================================

const taskList = new taskListPlus();

taskList.push((args, next) => {
	readStdinJson((stdinError, stdinValues) => {
		if (stdinError) {
			next(stdinError);
			return;
		}
		next('', { ...args, ...stdinValues });
	});
});

// corpus selection + SHA256SUMS verification (skipped, loudly, for an override)
taskList.push((args, next) => {
	const usingCorpusOverride =
		typeof args.corpusOverrideDirPath === 'string' && args.corpusOverrideDirPath.trim() !== '';
	const corpusDirPath = usingCorpusOverride ? args.corpusOverrideDirPath : PINNED_SNAPSHOT_DIR;

	if (!fs.existsSync(corpusDirPath) || !fs.statSync(corpusDirPath).isDirectory()) {
		next(
			`${moduleName}: corpus directory '${corpusDirPath}' does not exist or is not a directory. ` +
				`Refused by name rather than measured as an empty corpus.`,
		);
		return;
	}

	const xsdFilenameList = fs
		.readdirSync(corpusDirPath)
		.filter((oneName) => oneName.endsWith('.xsd'))
		.sort();
	if (!xsdFilenameList.length) {
		next(
			`${moduleName}: '${corpusDirPath}' holds no .xsd files. A corpus with no source is a ` +
				`missing input, not a zero measurement.`,
		);
		return;
	}

	if (usingCorpusOverride) {
		next('', { ...args, corpusDirPath, xsdFilenameList, usingCorpusOverride, sha256Verified: false });
		return;
	}

	const sumsFilePath = path.join(corpusDirPath, 'SHA256SUMS');
	if (!fs.existsSync(sumsFilePath)) {
		next(
			`${moduleName}: '${corpusDirPath}' has no SHA256SUMS. This probe will not measure against ` +
				`unverifiable source (RT-3).`,
		);
		return;
	}
	const digestByListedFilename = {};
	fs.readFileSync(sumsFilePath, 'utf8')
		.split('\n')
		.map((oneLine) => oneLine.trim())
		.filter((oneLine) => oneLine !== '')
		.forEach((oneLine) => {
			const lineMatch = oneLine.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
			if (lineMatch) {
				digestByListedFilename[lineMatch[2]] = lineMatch[1];
			}
		});
	const unverifiedFilenameList = [];
	xsdFilenameList.forEach((oneFilename) => {
		const listedDigest = digestByListedFilename[oneFilename];
		if (!listedDigest) {
			unverifiedFilenameList.push(`${oneFilename} (not listed in SHA256SUMS)`);
			return;
		}
		const actualDigest = crypto
			.createHash('sha256')
			.update(fs.readFileSync(path.join(corpusDirPath, oneFilename)))
			.digest('hex');
		if (actualDigest !== listedDigest) {
			unverifiedFilenameList.push(`${oneFilename} (digest mismatch)`);
		}
	});
	if (unverifiedFilenameList.length) {
		next(
			`${moduleName}: ${unverifiedFilenameList.length} snapshot file(s) failed SHA256SUMS ` +
				`verification and are refused by name:\n  ${unverifiedFilenameList.join('\n  ')}`,
		);
		return;
	}
	next('', { ...args, corpusDirPath, xsdFilenameList, usingCorpusOverride, sha256Verified: true });
});

// BASIS A — the corpus bytes on disk
taskList.push((args, next) => {
	const sourceRawLiteralList = [];
	const perFileLiteralCount = {};
	const parseNextFile = (fileIndex) => {
		if (fileIndex >= args.xsdFilenameList.length) {
			// THE REFUSAL THAT MAKES ABSENCE A RECORDED FACT. An empty source side is not a
			// measurement of zero hidden differences — it is a reader that never entered the
			// documents, and it produces a believable zero at every downstream step. This probe
			// refuses by name rather than emitting a number computed over nothing.
			if (!sourceRawLiteralList.length) {
				next(
					`${moduleName}: ZERO xs:documentation literals were read from ${args.xsdFilenameList.length} ` +
						`corpus file(s) at '${args.corpusDirPath}'. The PESC corpus carries documentation on ` +
						`thousands of components, so an empty read is a BROKEN READER, not an empty corpus. ` +
						`Refused by name — a delta computed over an empty source side would report 0 hidden ` +
						`differences and look exactly like a clean result.`,
				);
				return;
			}
			next('', { ...args, sourceRawLiteralList, perFileLiteralCount });
			return;
		}
		const oneFilename = args.xsdFilenameList[fileIndex];
		const xsdText = fs.readFileSync(path.join(args.corpusDirPath, oneFilename), 'utf8');
		xml2js.parseString(xsdText, (parseError, parsedDocument) => {
			if (parseError) {
				next(
					`${moduleName}: XML parse of '${oneFilename}' failed: ${parseError.message}. ` +
						`A file that cannot be parsed is refused by name, never skipped.`,
				);
				return;
			}
			const beforeCount = sourceRawLiteralList.length;
			collectDocumentationLiteralsFromParsedXml(parsedDocument, sourceRawLiteralList);
			perFileLiteralCount[oneFilename] = sourceRawLiteralList.length - beforeCount;
			// A PESC .xsd with no xs:documentation at all is possible in principle; a WHOLE CORPUS
			// with none is a broken reader, and it is checked below rather than here so one thin
			// file cannot refuse a sound run.
			parseNextFile(fileIndex + 1);
		});
	};
	parseNextFile(0);
});

// BASIS B — the documentation property the graph actually stored
taskList.push((args, next) => {
	const driver = neo4j.driver(args.boltUrl, neo4j.auth.basic(args.neo4jUser, args.neo4jPassword));
	const session = driver.session();
	// Scoped to pescTier='source' — R-VAL-1's projection. Synthetic and derived documentation is
	// NOT source and must not enter a source-fidelity measurement.
	//
	// TWO CARRIERS, AND READING ONLY ONE OF THEM MANUFACTURES A GAP. Documentation reaches this
	// graph by two distinct routes: the `documentation` PROPERTY on a node, and the
	// `documentation` field of each entry inside a PescDerivation's `enumerationValues` JSON. A
	// first version of this probe read only the property and reported 11,564 source literals as
	// unreproduced — a number that matched the corpus's 11,575 xs:enumeration literals closely
	// enough to look like a finding about the FORGE. It was a finding about the PROBE. Both
	// carriers are read here, and the enumeration carrier is counted separately so the two can
	// never again be confused for one another.
	const cypher =
		"MATCH (oneNode) WHERE oneNode.pescTier = 'source' " +
		'AND (oneNode.documentation IS NOT NULL OR oneNode.enumerationValues IS NOT NULL) ' +
		'RETURN oneNode.documentation AS documentationLiteral, ' +
		'oneNode.enumerationValues AS enumerationValuesJson';
	session
		.run(cypher)
		.then((runResult) => {
			const graphRawLiteralList = [];
			let enumerationCarrierLiteralCount = 0;
			runResult.records.forEach((oneRecord) => {
				const documentationLiteral = oneRecord.get('documentationLiteral');
				if (documentationLiteral !== null && documentationLiteral !== undefined) {
					graphRawLiteralList.push(documentationLiteral);
				}
				const enumerationValuesJson = oneRecord.get('enumerationValuesJson');
				if (enumerationValuesJson === null || enumerationValuesJson === undefined) {
					return;
				}
				const enumerationEntryList = JSON.parse(enumerationValuesJson);
				if (!Array.isArray(enumerationEntryList)) {
					throw new Error(
						`${moduleName}: enumerationValues parsed to a non-array ` +
							`(${typeof enumerationEntryList}). The shape is REQUIRED to be an array of ` +
							`{value, documentation}; refused by name rather than skipped.`,
					);
				}
				enumerationEntryList.forEach((oneEnumerationEntry) => {
					if (!Object.prototype.hasOwnProperty.call(oneEnumerationEntry, 'documentation')) {
						throw new Error(
							`${moduleName}: an enumerationValues entry carries no 'documentation' field ` +
								`(${JSON.stringify(oneEnumerationEntry)}). Absence is refused by name, never ` +
								`read as an empty string.`,
						);
					}
					graphRawLiteralList.push(oneEnumerationEntry.documentation);
					enumerationCarrierLiteralCount += 1;
				});
			});
			session
				.close()
				.then(() => driver.close())
				.then(() =>
					next('', { ...args, graphRawLiteralList, enumerationCarrierLiteralCount }),
				)
				.catch((closeError) => next(`${moduleName}: driver close failed: ${closeError.message}`));
		})
		.catch((runError) => {
			session.close().catch(() => {});
			driver.close().catch(() => {});
			next(
				`${moduleName}: graph read failed: ${runError.message}. Verify the bolt port was ` +
					`resolved from the CONTAINER and that the container is running.`,
			);
		});
});

// THE MEASUREMENT
taskList.push((args, next) => {
	const measurementByModeName = {};
	NORMALIZATION_MODE_LIST.forEach((oneMode) => {
		const sourceSide = countsByNormalizedLiteral(args.sourceRawLiteralList, oneMode);
		const graphSide = countsByNormalizedLiteral(args.graphRawLiteralList, oneMode);
		const matchedTotal = multisetMatchedTotal(sourceSide.literalCounts, graphSide.literalCounts);
		const sourceTotal = multisetTotal(sourceSide.literalCounts);
		const graphTotal = multisetTotal(graphSide.literalCounts);
		measurementByModeName[oneMode.modeName] = {
			modeName: oneMode.modeName,
			description: oneMode.description,
			sourceLiteralTotal: sourceTotal,
			graphLiteralTotal: graphTotal,
			matchedTotal,
			sourceNotReproducedTotal: sourceTotal - matchedTotal,
			graphNotInSourceTotal: graphTotal - matchedTotal,
			sourceEmptyAfterNormalizationCount: sourceSide.emptyAfterNormalizationCount,
			graphEmptyAfterNormalizationCount: graphSide.emptyAfterNormalizationCount,
			distinctSourceLiteralCount: sourceSide.literalCounts.size,
			distinctGraphLiteralCount: graphSide.literalCounts.size,
		};
	});

	const collapseMeasurement = measurementByModeName.collapse;
	const verbatimMeasurement = measurementByModeName.verbatim;
	if (!collapseMeasurement || !verbatimMeasurement) {
		next(
			`${moduleName}: both 'collapse' and 'verbatim' measurements are REQUIRED to compute the ` +
				`delta; got ${Object.keys(measurementByModeName).join(', ')}.`,
		);
		return;
	}

	// THE NUMBER. Literals the corpus and the graph agree on ONLY because the runs were collapsed.
	const hiddenByWhitespaceCollapseTotal =
		verbatimMeasurement.sourceNotReproducedTotal - collapseMeasurement.sourceNotReproducedTotal;

	next('', { ...args, measurementByModeName, hiddenByWhitespaceCollapseTotal });
});

// LOCATE the hidden differences — a count nobody can inspect is a count nobody can check.
taskList.push((args, next) => {
	const collapseMode = NORMALIZATION_MODE_LIST.find((oneMode) => oneMode.modeName === 'collapse');
	const verbatimMode = NORMALIZATION_MODE_LIST.find((oneMode) => oneMode.modeName === 'verbatim');
	const graphVerbatimCounts = countsByNormalizedLiteral(args.graphRawLiteralList, verbatimMode)
		.literalCounts;
	const graphCollapseCounts = countsByNormalizedLiteral(args.graphRawLiteralList, collapseMode)
		.literalCounts;

	const specimenList = [];
	const seenCollapsedLiteral = new Set();
	args.sourceRawLiteralList.forEach((oneRawLiteral) => {
		const verbatimLiteral = normalizeUnderMode(oneRawLiteral, verbatimMode);
		const collapsedLiteral = normalizeUnderMode(oneRawLiteral, collapseMode);
		if (collapsedLiteral === '') {
			return;
		}
		const matchesVerbatim = graphVerbatimCounts.has(verbatimLiteral);
		const matchesCollapsed = graphCollapseCounts.has(collapsedLiteral);
		if (!matchesVerbatim && matchesCollapsed && !seenCollapsedLiteral.has(collapsedLiteral)) {
			seenCollapsedLiteral.add(collapsedLiteral);
			specimenList.push({
				sourceVerbatim: verbatimLiteral.slice(0, 220),
				collapsedForm: collapsedLiteral.slice(0, 220),
				sourceVerbatimLength: verbatimLiteral.length,
				collapsedFormLength: collapsedLiteral.length,
			});
		}
	});
	next('', { ...args, distinctHiddenLiteralCount: specimenList.length, specimenList });
});

pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	if (pipeError) {
		console.error(`\n${pipeError}\n`);
		process.exit(1);
	}

	const report = {
		probe: moduleName,
		phase: 'Phase 5 — O-2, ordered measured before decided',
		corpusDirPath: args.corpusDirPath,
		usingCorpusOverride: args.usingCorpusOverride,
		sha256Verified: args.sha256Verified,
		xsdFileCount: args.xsdFilenameList.length,
		boltUrl: args.boltUrl,
		measurementByModeName: args.measurementByModeName,
		hiddenByWhitespaceCollapseTotal: args.hiddenByWhitespaceCollapseTotal,
		distinctHiddenLiteralCount: args.distinctHiddenLiteralCount,
	};

	console.log('');
	if (args.usingCorpusOverride) {
		console.log('  ############################################################');
		console.log('  ##  CORPUS OVERRIDE IN USE — this is NOT a measurement of ##');
		console.log('  ##  the pinned snapshot. SHA256SUMS verification SKIPPED. ##');
		console.log(`  ##  corpus: ${args.corpusDirPath}`);
		console.log('  ############################################################');
		console.log('');
	}
	console.log(`  corpus            ${args.xsdFilenameList.length} .xsd files at ${args.corpusDirPath}`);
	console.log(`  sha256 verified   ${args.sha256Verified}`);
	console.log(`  graph             ${args.boltUrl}`);
	console.log(`  graph carriers    documentation property + enumerationValues entries (${args.enumerationCarrierLiteralCount} from the enumeration carrier)`);
	console.log('');
	NORMALIZATION_MODE_LIST.forEach((oneMode) => {
		const oneMeasurement = args.measurementByModeName[oneMode.modeName];
		console.log(`  MODE ${oneMode.modeName}`);
		console.log(`    ${oneMode.description}`);
		console.log(`    source literals            ${oneMeasurement.sourceLiteralTotal}`);
		console.log(`    graph  literals            ${oneMeasurement.graphLiteralTotal}`);
		console.log(`    matched                    ${oneMeasurement.matchedTotal}`);
		console.log(`    source NOT reproduced      ${oneMeasurement.sourceNotReproducedTotal}`);
		console.log(`    graph  not in source       ${oneMeasurement.graphNotInSourceTotal}`);
		console.log('');
	});
	console.log(`  >>> HIDDEN BY THE WHITESPACE COLLAPSE: ${args.hiddenByWhitespaceCollapseTotal}`);
	console.log(`  >>> distinct literals affected:        ${args.distinctHiddenLiteralCount}`);
	console.log('');
	args.specimenList.slice(0, 5).forEach((oneSpecimen, specimenIndex) => {
		console.log(`  specimen ${specimenIndex + 1} — source ${oneSpecimen.sourceVerbatimLength} chars, collapsed ${oneSpecimen.collapsedFormLength} chars`);
		console.log(`    verbatim:  ${JSON.stringify(oneSpecimen.sourceVerbatim)}`);
		console.log(`    collapsed: ${JSON.stringify(oneSpecimen.collapsedForm)}`);
	});
	console.log('');

	const artifactDirPath = path.join(BUNDLE_DIR, 'test', 'test-artifacts');
	fs.mkdirSync(artifactDirPath, { recursive: true });
	const artifactFilePath = path.join(
		artifactDirPath,
		args.usingCorpusOverride
			? 'p5DocumentationWhitespaceMeasurement.override.json'
			: 'p5DocumentationWhitespaceMeasurement.json',
	);
	fs.writeFileSync(
		artifactFilePath,
		`${JSON.stringify({ ...report, specimenList: args.specimenList.slice(0, 40) }, null, 1)}\n`,
	);
	console.log(`  written: ${artifactFilePath}`);
	console.log('');
});
