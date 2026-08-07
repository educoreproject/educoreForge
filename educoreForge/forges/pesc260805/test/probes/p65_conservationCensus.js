'use strict';

// p65_conservationCensus.js — THE OLD-CODE / NEW-CODE CONSERVATION CONTROL, AS A RETAINED ARTIFACT.
//
// WHAT IT ANSWERS. Phase 6.5 changed how documents are reconstructed. The claim that matters beside
// "the compositor now appears" is the one nobody asks for: DID ANYTHING ELSE MOVE? A change that
// adds 3,037 sequences and also quietly drops 40 enumerations would show up as a clean gate and a
// wrong corpus.
//
// THE TWO SIDES ARE BOTH ON DISK AND NEITHER IS RE-DERIVED HERE:
//   OLD — test-artifacts/p5RoundTripRun4/emitted, the COMMITTED pre-6.5 reconstruction. Using the
//         committed artifact rather than re-running old code is deliberate: it cannot be influenced
//         by anything in the working tree.
//   NEW — whatever reconstruction directory is named on stdin (the validator writes one per run).
//   SOURCE — the pinned corpus, included so a reader can see which differences are Phase 6.5's and
//         which are pre-existing reconstruction shortfalls that predate it.
//
// IT COUNTS OCCURRENCES, NOT LINES. `grep -c` counts MATCHING LINES, and these XSDs are irregularly
// wrapped — several source files are a single line. A line-based census of this corpus is a
// plausible number that is not the quantity anyone means, and this instrument was written after
// exactly that mistake was made and caught during Phase 6.5.
//
// IT STRIPS XML COMMENTS BEFORE COUNTING, AND THAT REPAIR IS WHY THIS PARAGRAPH EXISTS. The FIRST
// version of this file counted raw bytes. The PESC corpus carries schema that has been COMMENTED
// OUT and left in place — `<!-- moved to core main per discussion with Tom 7/6/2008`,
// `<!-- JAF 2011/06/03 Modified this ComplexType…` — and counting inside those comments
// manufactured FOUR phantom shortfalls: 5 xs:sequence, 24 xs:element, 5 xs:complexType, 1 group
// reference. Every one of them is ACTUALLY ZERO.
//
// THE PART WORTH REMEMBERING IS NOT THE REGEX. Having produced a phantom 5-complexType shortfall,
// I then EXPLAINED it — `OrganizationType` absent, `SponsorType` "declared TWICE in the source
// bytes" — and the explanation fit the number exactly. Both were fabrications: both of those
// declarations sit inside comments, and neither is duplicated. I never opened the file; I inferred
// a duplicate from a diff of sorted name lists. A mechanism that predicts the right number is the
// most persuasive possible evidence and it is worth nothing until the artifact is READ.
//
// A construct inside a comment is not a declaration. The stripped count is the measurement; the raw
// count is published beside it so a reader can see HOW MUCH commented-out schema this corpus
// carries rather than having to trust that the difference was small.
//
// House style: qtools taskListPlus/pipeRunner, error-first callbacks, no async/await.
//
// RUN:
//   jq -nc '{reconstructedPath:"…/p65RoundTripRun1/emitted",outputPath:"…/test-artifacts"}' \
//     | node test/probes/p65_conservationCensus.js

const fs = require('fs');
const path = require('path');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const moduleName = 'p65_conservationCensus';
const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SOURCE_CORPUS_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const PRE_PHASE65_RECONSTRUCTION_DIR = path.join(
	BUNDLE_DIR,
	'test',
	'test-artifacts',
	'p5RoundTripRun4',
	'emitted',
);

// The constructs counted. A construct absent from this list is a construct this control cannot
// speak about, which is a decision recorded here rather than an omission discovered later.
const COUNTED_CONSTRUCT_LIST = [
	{ constructName: 'xs:sequence', matcher: /<xs:sequence[\s/>]/g },
	{ constructName: 'xs:choice', matcher: /<xs:choice[\s/>]/g },
	{ constructName: 'xs:all', matcher: /<xs:all[\s/>]/g },
	{ constructName: 'xs:group[ref]', matcher: /<xs:group\s+ref=/g },
	{ constructName: 'xs:any', matcher: /<xs:any[\s/>]/g },
	{ constructName: 'xs:element', matcher: /<xs:element[\s/>]/g },
	{ constructName: 'xs:attribute', matcher: /<xs:attribute[\s/>]/g },
	{ constructName: 'xs:complexType', matcher: /<xs:complexType[\s/>]/g },
	{ constructName: 'xs:simpleType', matcher: /<xs:simpleType[\s/>]/g },
	{ constructName: 'xs:extension', matcher: /<xs:extension[\s/>]/g },
	{ constructName: 'xs:restriction', matcher: /<xs:restriction[\s/>]/g },
	{ constructName: 'xs:enumeration', matcher: /<xs:enumeration[\s/>]/g },
	{ constructName: 'xs:documentation', matcher: /<xs:documentation[\s/>]/g },
	{ constructName: 'xs:complexContent', matcher: /<xs:complexContent[\s/>]/g },
	{ constructName: 'xs:simpleContent', matcher: /<xs:simpleContent[\s/>]/g },
	{ constructName: 'xmlns declaration', matcher: /\sxmlns(:[A-Za-z0-9_.-]+)?=/g },
];

// stripXmlComments — XML 1.0 §2.5. A comment cannot nest and cannot contain '--', so the
// non-greedy form is exact rather than approximate for conforming documents.
const stripXmlComments = (documentText) => String(documentText).replace(/<!--[\s\S]*?-->/g, '');

// SELF-TEST — THE RED LEVER FOR THE COMMENT STRIPPING, RUN BEFORE ANY CORPUS IS COUNTED.
//
// It plants each counted construct INSIDE a comment and requires the census to score it ZERO, with
// an ACCEPT-CONTROL placing the identical construct outside a comment and requiring exactly ONE.
// Without the control, a stripper that deleted the whole document would also score zero and look
// like a working filter.
//
// It runs at STARTUP, not as an optional check, because the defect it guards against does not
// announce itself: a census counting comments returns confident, plausible, wrong numbers and every
// downstream conclusion inherits them.
const CONSTRUCT_SELF_TEST_SAMPLE_BY_NAME = {
	'xs:sequence': '<xs:sequence>',
	'xs:choice': '<xs:choice>',
	'xs:all': '<xs:all>',
	'xs:group[ref]': '<xs:group ref="core:X"/>',
	'xs:any': '<xs:any/>',
	'xs:element': '<xs:element name="X"/>',
	'xs:attribute': '<xs:attribute name="X"/>',
	'xs:complexType': '<xs:complexType name="X">',
	'xs:simpleType': '<xs:simpleType>',
	'xs:extension': '<xs:extension base="X">',
	'xs:restriction': '<xs:restriction base="X">',
	'xs:enumeration': '<xs:enumeration value="X"/>',
	'xs:documentation': '<xs:documentation>x</xs:documentation>',
	'xs:complexContent': '<xs:complexContent>',
	'xs:simpleContent': '<xs:simpleContent>',
	'xmlns declaration': '<xs:schema xmlns:core="urn:x">',
};

const runCommentStrippingSelfTest = () => {
	const observationList = [];
	COUNTED_CONSTRUCT_LIST.forEach((oneConstruct) => {
		const sampleText = CONSTRUCT_SELF_TEST_SAMPLE_BY_NAME[oneConstruct.constructName];
		if (sampleText === undefined) {
			throw new Error(
				`${moduleName}: no self-test sample is declared for counted construct ` +
					`'${oneConstruct.constructName}'. A construct counted but never self-tested is a ` +
					`construct whose comment behaviour nobody has checked. Refused BY NAME.`,
			);
		}
		const countIn = (oneText) => {
			const matchList = stripXmlComments(oneText).match(oneConstruct.matcher);
			return matchList ? matchList.length : 0;
		};
		const acceptControlCount = countIn(`<root>\n${sampleText}\n</root>`);
		const commentedOutCount = countIn(`<root>\n<!-- ${sampleText} -->\n</root>`);
		observationList.push({
			constructName: oneConstruct.constructName,
			acceptControlCount,
			commentedOutCount,
			leverHolds: acceptControlCount === 1 && commentedOutCount === 0,
		});
	});
	const failedList = observationList.filter((oneObservation) => !oneObservation.leverHolds);
	if (failedList.length) {
		throw new Error(
			`${moduleName}: the comment-stripping self-test FAILED for ` +
				`${failedList.map((one) => `${one.constructName} (control ${one.acceptControlCount}, commented ${one.commentedOutCount})`).join('; ')}. ` +
				`Refused BY NAME — a census whose filter is unproven produces plausible wrong numbers, ` +
				`which is exactly the defect this self-test was added to prevent.`,
		);
	}
	return observationList;
};

const censusOfDirectory = (corpusDirPath) => {
	if (!fs.existsSync(corpusDirPath)) {
		throw new Error(
			`${moduleName}: corpus directory '${corpusDirPath}' does not exist. A census of a ` +
				`directory that is not there would report zeroes, which is a plausible number and not a ` +
				`measurement. Refused BY NAME.`,
		);
	}
	const fileNameList = fs
		.readdirSync(corpusDirPath)
		.filter((oneName) => oneName.endsWith('.xsd'))
		.sort();
	if (!fileNameList.length) {
		throw new Error(
			`${moduleName}: corpus directory '${corpusDirPath}' holds no .xsd files. Refused BY NAME.`,
		);
	}
	const rawCorpusText = fileNameList
		.map((oneName) => fs.readFileSync(path.join(corpusDirPath, oneName), 'utf8'))
		.join('\n');
	const declaredCorpusText = stripXmlComments(rawCorpusText);
	const countByConstruct = {};
	const rawCountByConstruct = {};
	COUNTED_CONSTRUCT_LIST.forEach((oneConstruct) => {
		const declaredMatchList = declaredCorpusText.match(oneConstruct.matcher);
		const rawMatchList = rawCorpusText.match(oneConstruct.matcher);
		countByConstruct[oneConstruct.constructName] = declaredMatchList ? declaredMatchList.length : 0;
		rawCountByConstruct[oneConstruct.constructName] = rawMatchList ? rawMatchList.length : 0;
	});
	return {
		corpusDirPath,
		fileTotal: fileNameList.length,
		// countByConstruct is the MEASUREMENT — declarations only. rawCountByConstruct is published
		// beside it so the volume of commented-out schema is visible rather than merely asserted.
		countByConstruct,
		rawCountByConstruct,
	};
};

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
		const missingNameList = ['reconstructedPath', 'outputPath'].filter(
			(oneName) =>
				typeof parsedStdin[oneName] !== 'string' || parsedStdin[oneName].trim() === '',
		);
		if (missingNameList.length) {
			callback(
				`${moduleName}: stdin JSON missing required value(s): ${missingNameList.join(', ')}.`,
			);
			return;
		}
		callback('', parsedStdin);
	});
};

module.exports = { COUNTED_CONSTRUCT_LIST, censusOfDirectory, moduleName };

if (require.main !== module) {
	return;
}

const taskList = new taskListPlus();

taskList.push((args, next) => {
	readStdinJson((stdinError, stdinValues) => next(stdinError, { ...args, ...stdinValues }));
});

taskList.push((args, next) => {
	// THE SELF-TEST RUNS BEFORE ANY CORPUS IS READ. If the filter this census depends on is broken,
	// every number below is plausible and wrong, so the run must not reach them.
	let censusSet = null;
	try {
		const commentStrippingSelfTest = runCommentStrippingSelfTest();
		censusSet = {
			commentStrippingSelfTest,
			sourceCensus: censusOfDirectory(SOURCE_CORPUS_DIR),
			prePhase65Census: censusOfDirectory(PRE_PHASE65_RECONSTRUCTION_DIR),
			phase65Census: censusOfDirectory(args.reconstructedPath),
		};
	} catch (censusError) {
		next(censusError.message);
		return;
	}
	next('', { ...args, ...censusSet });
});

pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	if (pipeError) {
		process.stdout.write(`REFUSED: ${pipeError}\n`);
		process.exit(1);
		return;
	}

	const rowList = COUNTED_CONSTRUCT_LIST.map((oneConstruct) => {
		const sourceCount = args.sourceCensus.countByConstruct[oneConstruct.constructName];
		const sourceRawCount = args.sourceCensus.rawCountByConstruct[oneConstruct.constructName];
		const preCount = args.prePhase65Census.countByConstruct[oneConstruct.constructName];
		const nowCount = args.phase65Census.countByConstruct[oneConstruct.constructName];
		return {
			constructName: oneConstruct.constructName,
			sourceDeclaredCount: sourceCount,
			sourceRawCount,
			sourceCommentedOutCount: sourceRawCount - sourceCount,
			prePhase65ReconstructionCount: preCount,
			phase65ReconstructionCount: nowCount,
			phase65Delta: nowCount - preCount,
			stillShortOfSource: sourceCount - nowCount,
		};
	});

	// THE CLAIM THIS CONTROL EXISTS TO TEST, stated as a predicate rather than as prose: every
	// construct the pre-6.5 reconstruction already emitted must be emitted the SAME number of times.
	// The four particle constructs and the xmlns declarations are the intended additions.
	const INTENDED_ADDITION_NAME_LIST = [
		'xs:sequence',
		'xs:choice',
		'xs:all',
		'xs:group[ref]',
		'xs:any',
		'xmlns declaration',
	];
	const unintendedMovementList = rowList.filter(
		(oneRow) =>
			!INTENDED_ADDITION_NAME_LIST.includes(oneRow.constructName) && oneRow.phase65Delta !== 0,
	);

	const stillShortList = rowList.filter((oneRow) => oneRow.stillShortOfSource !== 0);

	const report = {
		instrument: moduleName,
		countingBasis:
			'XML COMMENTS ARE STRIPPED BEFORE COUNTING. A construct inside a comment is not a ' +
			'declaration. sourceRawCount and sourceCommentedOutCount are published per row so the ' +
			'volume of commented-out schema is visible rather than asserted.',
		commentStrippingSelfTest: args.commentStrippingSelfTest,
		sourceCorpusDirectory: SOURCE_CORPUS_DIR,
		prePhase65ReconstructionDirectory: PRE_PHASE65_RECONSTRUCTION_DIR,
		phase65ReconstructionDirectory: args.reconstructedPath,
		fileTotals: {
			source: args.sourceCensus.fileTotal,
			prePhase65: args.prePhase65Census.fileTotal,
			phase65: args.phase65Census.fileTotal,
		},
		intendedAdditionNameList: INTENDED_ADDITION_NAME_LIST,
		conservationHolds: unintendedMovementList.length === 0,
		unintendedMovementList,
		stillShortOfSourceList: stillShortList,
		rowList,
	};

	fs.mkdirSync(args.outputPath, { recursive: true });
	const reportPath = path.join(args.outputPath, 'p65ConservationCensus.json');
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, '\t')}\n`);

	process.stdout.write(
		`${moduleName}\n` +
			`  source .......... ${report.sourceCorpusDirectory} (${report.fileTotals.source} files)\n` +
			`  pre-6.5 ......... ${report.prePhase65ReconstructionDirectory} (${report.fileTotals.prePhase65} files)\n` +
			`  phase 6.5 ....... ${report.phase65ReconstructionDirectory} (${report.fileTotals.phase65} files)\n\n` +
			`  comment-stripping self-test: ${args.commentStrippingSelfTest.length} constructs, ` +
			`each scoring 1 outside a comment and 0 inside — PASSED\n\n` +
			`  ${'construct'.padEnd(20)}${'srcRaw'.padStart(8)}${'inCmt'.padStart(7)}${'source'.padStart(9)}${'pre-6.5'.padStart(10)}${'6.5'.padStart(9)}${'delta'.padStart(8)}${'short'.padStart(7)}\n`,
	);
	rowList.forEach((oneRow) => {
		process.stdout.write(
			`  ${oneRow.constructName.padEnd(20)}${String(oneRow.sourceRawCount).padStart(8)}` +
				`${String(oneRow.sourceCommentedOutCount).padStart(7)}` +
				`${String(oneRow.sourceDeclaredCount).padStart(9)}` +
				`${String(oneRow.prePhase65ReconstructionCount).padStart(10)}` +
				`${String(oneRow.phase65ReconstructionCount).padStart(9)}` +
				`${(oneRow.phase65Delta > 0 ? `+${oneRow.phase65Delta}` : String(oneRow.phase65Delta)).padStart(8)}` +
				`${String(oneRow.stillShortOfSource).padStart(7)}` +
				`${INTENDED_ADDITION_NAME_LIST.includes(oneRow.constructName) ? '  (intended addition)' : ''}\n`,
		);
	});
	process.stdout.write(
		`\n  CONSERVATION ${report.conservationHolds ? 'HOLDS' : 'VIOLATED'} — ` +
			`${unintendedMovementList.length} construct(s) moved that Phase 6.5 did not intend to touch\n` +
			`  STILL SHORT OF SOURCE: ${stillShortList.length ? stillShortList.map((one) => `${one.constructName} ${one.stillShortOfSource}`).join(', ') : 'none'}\n` +
			`  written: ${reportPath}\n`,
	);
	process.exit(report.conservationHolds ? 0 : 1);
});
