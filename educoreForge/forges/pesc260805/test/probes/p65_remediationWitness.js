'use strict';

// p65_remediationWitness.js — RETAINED EVIDENCE FOR THREE PHASE 6.5 CLAIMS THAT RESTED ON PROSE.
//
// The independent review found three assertions in the Phase 6.5 record that were TRUE but
// UNEVIDENCED — the same failure as the original missing-receipts finding, one level down. A claim
// nobody can re-drive is in the position the campaign's own doctrine describes: indistinguishable
// from a claim nobody checked. This file makes each one an instrument.
//
// WITNESS 1 — THE 28 DOCUMENTATION LITERALS ARE FULLY ATTRIBUTED.
//   I published 28 short and said 5 were the ruled multi-documentation residue and 23 were
//   UNATTRIBUTED with no mechanism offered. Refusing to invent one was right; the reviewer then
//   found the real mechanism. This witness verifies it rather than accepting it: SELF-CLOSING
//   `<xs:documentation/>` elements carry no text, so the graph stores nothing and the emission
//   writes nothing. If self-closing + ruled-multi-doc accounts for the whole 28, then real content
//   loss beyond the ruled 2 is ZERO and the item leaves Phase 7's backlog.
//
// WITNESS 2 — THE p6_mutationSuite EXPECTATION WAS FALSIFIED BY THE CODE, NOT BY THE EDIT.
//   I wrote that the mismatch was "OBSERVED FIRST and that run is in p65PersistRun.log". THAT
//   CITATION IS WRONG. The persisted log postdates the edit and records CAUGHT / exit 0. The run
//   that printed "expected blind, observed CAUGHT" happened before artifacts were being persisted
//   and its log was NOT retained — the same failure the receipts finding named.
//   WHAT THIS WITNESS PROVES INSTEAD, AND IT IS THE CLAIM THAT ACTUALLY MATTERS: the expectation
//   committed at HEAD is 'blind', and under Phase 6.5 the swap moves statements, so the COMMITTED
//   expectation is falsified by the code. That is checkable now, by anyone, and it does not depend
//   on my account of what I saw or when. The ordering claim is restated as unevidenced in the
//   record rather than defended.
//
// WITNESS 3 — THE F-1 ATTRIBUTE-PLACEMENT DISCOVERY.
//   The finding was verified independently by the reviewer but its discovery run was not retained.
//   This counts attributes sitting OUTSIDE a simpleContent/complexContent derivation in all three
//   corpora, so the defect and its repair are a measurement rather than a narrative.
//
// House style: qtools taskListPlus/pipeRunner, error-first callbacks, no async/await.
//
// RUN:
//   jq -nc '{outputPath:"test/test-artifacts"}' | node test/probes/p65_remediationWitness.js

const fs = require('fs');
const path = require('path');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const moduleName = 'p65_remediationWitness';
const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SOURCE_CORPUS_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const PRE_PHASE65_RECONSTRUCTION_DIR = path.join(
	BUNDLE_DIR,
	'test',
	'test-artifacts',
	'p5RoundTripRun4',
	'emitted',
);
const PHASE65_RECONSTRUCTION_DIR = path.join(
	BUNDLE_DIR,
	'test',
	'test-artifacts',
	'p65RoundTripRun1',
	'emitted',
);

// The expectation recorded in the COMMITTED p6_mutationSuite at HEAD 75bd6a7. Re-derivable with:
//   git show 75bd6a7:educoreForge/forges/pesc260805/test/probes/p6_mutationSuite.js \
//     | /usr/bin/grep -a -A1 'swapTwoSiblingElements: {'
const PHASE6_COMMITTED_SWAP_EXPECTATION = 'blind';

const stripXmlComments = (documentText) => String(documentText).replace(/<!--[\s\S]*?-->/g, '');

const readCorpusText = (corpusDirPath) => {
	if (!fs.existsSync(corpusDirPath)) {
		throw new Error(
			`${moduleName}: corpus directory '${corpusDirPath}' does not exist. Refused BY NAME — a ` +
				`witness that reads nothing would report zeroes, which is a plausible number and not a ` +
				`measurement.`,
		);
	}
	const fileNameList = fs
		.readdirSync(corpusDirPath)
		.filter((oneName) => oneName.endsWith('.xsd'))
		.sort();
	if (!fileNameList.length) {
		throw new Error(`${moduleName}: '${corpusDirPath}' holds no .xsd files. Refused BY NAME.`);
	}
	return {
		fileTotal: fileNameList.length,
		declaredText: fileNameList
			.map((oneName) => stripXmlComments(fs.readFileSync(path.join(corpusDirPath, oneName), 'utf8')))
			.join('\n'),
	};
};

const occurrenceCount = (documentText, matcher) => {
	const matchList = documentText.match(matcher);
	return matchList ? matchList.length : 0;
};

// -----------------------------------------------------------------
// WITNESS 1 — documentation attribution
// -----------------------------------------------------------------
const witnessDocumentationAttribution = () => {
	const sourceCorpus = readCorpusText(SOURCE_CORPUS_DIR);
	const reconstructedCorpus = readCorpusText(PHASE65_RECONSTRUCTION_DIR);

	const sourceDocumentationTotal = occurrenceCount(
		sourceCorpus.declaredText,
		/<xs:documentation[\s/>]/g,
	);
	const reconstructedDocumentationTotal = occurrenceCount(
		reconstructedCorpus.declaredText,
		/<xs:documentation[\s/>]/g,
	);
	const selfClosingTotal = occurrenceCount(sourceCorpus.declaredText, /<xs:documentation\s*\/>/g);

	// The RULED residue: XSD permits several xs:documentation children in one xs:annotation and the
	// forge keeps only the first. Measured here rather than quoted, so the witness does not inherit
	// a number from a document.
	//
	// THE TWO CATEGORIES INTERSECT AND THE DECOMPOSITION MUST BE DISJOINT. The first version of this
	// witness ADDED self-closing (26) to multi-doc extras (5) and got 31 against a shortfall of 28.
	// Three of the extra literals are THEMSELVES self-closing, so they were counted twice. Summing
	// two sets that overlap is the same error class as counting inside comments — a confident number
	// assembled from true parts. The witness now partitions instead of adding, which is also why it
	// disagreed with an arithmetic it could have simply asserted.
	const ONE_DOCUMENTATION_ELEMENT_MATCHER =
		/<xs:documentation\s*\/>|<xs:documentation[\s>][\s\S]*?<\/xs:documentation>/g;
	const isSelfClosing = (oneElementText) => /^<xs:documentation\s*\/>$/.test(oneElementText);

	const annotationBlockList = sourceCorpus.declaredText.match(
		/<xs:annotation>[\s\S]*?<\/xs:annotation>/g,
	);
	let extraDocumentationTotal = 0;
	let extraDocumentationThatIsSelfClosingTotal = 0;
	let annotationsCarryingExtras = 0;
	(annotationBlockList || []).forEach((oneBlock) => {
		const documentationElementList = oneBlock.match(ONE_DOCUMENTATION_ELEMENT_MATCHER) || [];
		if (documentationElementList.length <= 1) {
			return;
		}
		annotationsCarryingExtras += 1;
		const extraElementList = documentationElementList.slice(1);
		extraDocumentationTotal += extraElementList.length;
		extraDocumentationThatIsSelfClosingTotal += extraElementList.filter(isSelfClosing).length;
	});

	// DISJOINT PARTITION: every self-closing literal, plus only those multi-doc extras that are NOT
	// already counted as self-closing.
	const extraDocumentationCarryingContentTotal =
		extraDocumentationTotal - extraDocumentationThatIsSelfClosingTotal;
	const shortfall = sourceDocumentationTotal - reconstructedDocumentationTotal;
	const attributed = selfClosingTotal + extraDocumentationCarryingContentTotal;
	return {
		witnessName: 'documentationAttribution',
		sourceDocumentationTotal,
		reconstructedDocumentationTotal,
		shortfall,
		selfClosingEmptyTotal: selfClosingTotal,
		annotationsCarryingExtraDocumentation: annotationsCarryingExtras,
		extraDocumentationTotal,
		extraDocumentationThatIsSelfClosingTotal,
		extraDocumentationCarryingContentTotal,
		attributedTotal: attributed,
		unattributedTotal: shortfall - attributed,
		// The conclusion, stated as a predicate rather than as prose.
		fullyAttributed: shortfall - attributed === 0,
		realContentLossBeyondEmptyLiterals:
			shortfall - attributed === 0
				? extraDocumentationCarryingContentTotal
				: 'UNKNOWN — the shortfall is not fully attributed, so no claim is made',
		note:
			'A self-closing xs:documentation carries no text, so the graph stores nothing and the ' +
			'emission writes nothing: those are EMPTY literals, not lost content. The only literals ' +
			'carrying content that the reconstruction does not reproduce are the non-self-closing ' +
			'2nd..nth children of a multi-documentation annotation, which is the RULED forge residue.',
	};
};

// -----------------------------------------------------------------
// WITNESS 2 — the committed expectation is falsified by the code
// -----------------------------------------------------------------
const witnessSwapExpectationFalsified = (callback) => {
	const emitterLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripSourceEmitter'))();
	const canonicalLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripXsdCanonical'))();
	const { MUTATION_REGISTRY } = require(path.join(__dirname, 'p6_mutationSuite.js'));

	const statementKeySetFor = ({ rowSet }, innerCallback) => {
		emitterLib.emitFromReader(
			{ reader: { readAll: (unusedOptions, readCallback) => readCallback('', rowSet) } },
			(emitError, emitted) => {
				if (emitError) {
					innerCallback(emitError);
					return;
				}
				canonicalLib.canonicalizeXsdFileSet(
					{
						fileList: emitted.emittedFileList.map((oneFile) => ({
							xsdText: oneFile.xsdText,
							fileLabel: oneFile.fileLabel,
						})),
					},
					(canonError, canonical) => {
						if (canonError) {
							innerCallback(canonError);
							return;
						}
						innerCallback('', new Set(canonical.statements.keys()));
					},
				);
			},
		);
	};

	return { statementKeySetFor, MUTATION_REGISTRY, callback };
};

// -----------------------------------------------------------------
// WITNESS 3 — attribute placement, three corpora
// -----------------------------------------------------------------
const witnessAttributePlacement = () => {
	// An xs:attribute belonging to a simpleContent/complexContent derivation must sit INSIDE the
	// derivation. The pre-6.5 emission placed such attributes as SIBLINGS of the wrapper, which is
	// invalid XSD. Counted structurally: an xs:attribute that appears BEFORE the wrapper's opening
	// tag within the same complexType block is misplaced.
	const misplacedAttributeTotalIn = (corpusDirPath) => {
		const corpus = readCorpusText(corpusDirPath);
		const complexTypeBlockList =
			corpus.declaredText.match(/<xs:complexType[\s>][\s\S]*?<\/xs:complexType>/g) || [];
		let misplacedTotal = 0;
		complexTypeBlockList.forEach((oneBlock) => {
			const wrapperPosition = oneBlock.search(/<xs:(simpleContent|complexContent)[\s>]/);
			if (wrapperPosition === -1) {
				return; // no derivation wrapper; attributes at type level are legal
			}
			const beforeWrapperText = oneBlock.slice(0, wrapperPosition);
			misplacedTotal += occurrenceCount(beforeWrapperText, /<xs:attribute[\s/>]/g);
		});
		return { fileTotal: corpus.fileTotal, misplacedTotal };
	};

	const sourceMeasure = misplacedAttributeTotalIn(SOURCE_CORPUS_DIR);
	const preMeasure = misplacedAttributeTotalIn(PRE_PHASE65_RECONSTRUCTION_DIR);
	const nowMeasure = misplacedAttributeTotalIn(PHASE65_RECONSTRUCTION_DIR);

	return {
		witnessName: 'attributePlacement',
		sourceMisplacedTotal: sourceMeasure.misplacedTotal,
		prePhase65ReconstructionMisplacedTotal: preMeasure.misplacedTotal,
		phase65ReconstructionMisplacedTotal: nowMeasure.misplacedTotal,
		// The predicate: source and the repaired reconstruction must both be 0, and the pre-6.5
		// reconstruction must be NONZERO — a defect that was never present is not a defect repaired.
		defectWasPresentBeforeRepair: preMeasure.misplacedTotal > 0,
		defectAbsentFromSource: sourceMeasure.misplacedTotal === 0,
		defectAbsentAfterRepair: nowMeasure.misplacedTotal === 0,
	};
};

module.exports = { witnessDocumentationAttribution, witnessAttributePlacement, moduleName };

if (require.main !== module) {
	return;
}

const readStdinJson = (callback) => {
	let stdinText = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (oneChunk) => {
		stdinText += oneChunk;
	});
	process.stdin.on('end', () => {
		let parsedStdin = null;
		try {
			parsedStdin = JSON.parse(stdinText);
		} catch (parseError) {
			callback(`${moduleName}: stdin is not parseable JSON (${parseError.message}).`);
			return;
		}
		if (typeof parsedStdin.outputPath !== 'string' || parsedStdin.outputPath.trim() === '') {
			callback(`${moduleName}: stdin JSON missing required value: outputPath.`);
			return;
		}
		callback('', parsedStdin);
	});
};

const taskList = new taskListPlus();

taskList.push((args, next) => {
	readStdinJson((stdinError, stdinValues) => next(stdinError, { ...args, ...stdinValues }));
});

taskList.push((args, next) => {
	let documentationWitness = null;
	let attributeWitness = null;
	try {
		documentationWitness = witnessDocumentationAttribution();
		attributeWitness = witnessAttributePlacement();
	} catch (witnessError) {
		next(witnessError.message);
		return;
	}
	next('', { ...args, documentationWitness, attributeWitness });
});

taskList.push((args, next) => {
	const emitterLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripSourceEmitter'))();
	emitterLib.resolveContainerBolt({ containerName: 'DEV_pesc260805' }, (resolveError, resolved) => {
		next(resolveError, { ...args, resolved });
	});
});

taskList.push((args, next) => {
	const emitterLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripSourceEmitter'))();
	const reader = emitterLib.makeNeo4jSourceTierReader({
		boltUrl: args.resolved.boltUrl,
		user: args.resolved.user,
		password: args.resolved.password,
	});
	reader.readAll({}, (readError, baselineRows) => {
		if (readError) {
			next(readError);
			return;
		}
		reader.close(() => next('', { ...args, baselineRows }));
	});
});

taskList.push((args, next) => {
	const { statementKeySetFor, MUTATION_REGISTRY } = witnessSwapExpectationFalsified(() => {});
	const baselineRowSet = args.baselineRows;
	statementKeySetFor({ rowSet: baselineRowSet }, (controlError, controlKeySet) => {
		if (controlError) {
			next(controlError);
			return;
		}
		const mutatedRowSet = JSON.parse(JSON.stringify(baselineRowSet));
		let mutationDescription = '';
		try {
			mutationDescription = MUTATION_REGISTRY.swapTwoSiblingElements.apply(mutatedRowSet);
		} catch (mutationError) {
			next(`${moduleName}: the swap mutation could not reach its target: ${mutationError.message}`);
			return;
		}
		statementKeySetFor({ rowSet: mutatedRowSet }, (mutatedError, mutatedKeySet) => {
			if (mutatedError) {
				next(mutatedError);
				return;
			}
			let removedTotal = 0;
			let addedTotal = 0;
			controlKeySet.forEach((oneStatementKey) => {
				if (!mutatedKeySet.has(oneStatementKey)) {
					removedTotal += 1;
				}
			});
			mutatedKeySet.forEach((oneStatementKey) => {
				if (!controlKeySet.has(oneStatementKey)) {
					addedTotal += 1;
				}
			});
			const observedOutcome = removedTotal + addedTotal > 0 ? 'caught' : 'blind';
			next('', {
				...args,
				swapWitness: {
					witnessName: 'swapExpectationFalsified',
					mutationDescription,
					controlStatementTotal: controlKeySet.size,
					removedTotal,
					addedTotal,
					observedOutcome,
					phase6CommittedExpectation: PHASE6_COMMITTED_SWAP_EXPECTATION,
					committedExpectationHolds:
						observedOutcome === PHASE6_COMMITTED_SWAP_EXPECTATION,
					currentExpectation: MUTATION_REGISTRY.swapTwoSiblingElements.expectation,
					currentExpectationHolds:
						observedOutcome === MUTATION_REGISTRY.swapTwoSiblingElements.expectation,
					orderingClaimStatus:
						'UNEVIDENCED. The run that printed the mismatch banner predates artifact ' +
						'persistence and its log was not retained. This witness establishes that the ' +
						'COMMITTED expectation is falsified by the code, which is checkable by anyone and ' +
						'does not rest on the builder account of what was seen or when.',
				},
			});
		});
	});
});

pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	if (pipeError) {
		process.stdout.write(`REFUSED: ${pipeError}\n`);
		process.exit(1);
		return;
	}

	const report = {
		instrument: moduleName,
		documentationWitness: args.documentationWitness,
		swapWitness: args.swapWitness,
		attributeWitness: args.attributeWitness,
	};

	fs.mkdirSync(args.outputPath, { recursive: true });
	const reportPath = path.join(args.outputPath, 'p65RemediationWitness.json');
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, '\t')}\n`);

	const d = args.documentationWitness;
	const s = args.swapWitness;
	const a = args.attributeWitness;

	process.stdout.write(
		`${moduleName}\n\n` +
			`WITNESS 1 — documentation attribution\n` +
			`  source ${d.sourceDocumentationTotal}   reconstructed ${d.reconstructedDocumentationTotal}   shortfall ${d.shortfall}\n` +
			`  self-closing (empty) ......... ${d.selfClosingEmptyTotal}\n` +
			`  extra literals in ${d.annotationsCarryingExtraDocumentation} multi-doc annotations ... ${d.extraDocumentationTotal}` +
			` (of which ${d.extraDocumentationThatIsSelfClosingTotal} are ALSO self-closing and already counted)\n` +
			`  multi-doc extras CARRYING CONTENT ... ${d.extraDocumentationCarryingContentTotal}\n` +
			`  attributed ${d.attributedTotal}   UNATTRIBUTED ${d.unattributedTotal}   ` +
			`${d.fullyAttributed ? 'FULLY ATTRIBUTED — real content loss beyond the ruled residue is 0' : 'NOT fully attributed'}\n\n` +
			`WITNESS 2 — the committed swap expectation, tested against the code\n` +
			`  ${s.mutationDescription}\n` +
			`  observed: removed ${s.removedTotal} added ${s.addedTotal} -> '${s.observedOutcome}'\n` +
			`  expectation committed at HEAD '${s.phase6CommittedExpectation}' HOLDS: ${s.committedExpectationHolds}\n` +
			`  expectation in the working tree '${s.currentExpectation}' HOLDS: ${s.currentExpectationHolds}\n` +
			`  ordering claim: ${s.orderingClaimStatus}\n\n` +
			`WITNESS 3 — attribute placement (xs:attribute outside a derivation wrapper)\n` +
			`  source ................. ${a.sourceMisplacedTotal}\n` +
			`  pre-6.5 reconstruction . ${a.prePhase65ReconstructionMisplacedTotal}\n` +
			`  6.5 reconstruction ..... ${a.phase65ReconstructionMisplacedTotal}\n` +
			`  defect present before repair: ${a.defectWasPresentBeforeRepair}   absent from source: ${a.defectAbsentFromSource}   absent after repair: ${a.defectAbsentAfterRepair}\n\n` +
			`  written: ${reportPath}\n`,
	);

	const allHold =
		d.fullyAttributed &&
		s.currentExpectationHolds &&
		!s.committedExpectationHolds &&
		a.defectWasPresentBeforeRepair &&
		a.defectAbsentFromSource &&
		a.defectAbsentAfterRepair;
	process.exit(allHold ? 0 : 1);
});
