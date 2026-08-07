#!/usr/bin/env node
'use strict';

// p6_explicitlyOmittedLaundering.js — the DEMONSTRATION attached to named defect P6-D1.
//
// THE DEFECT. A statement is filed as `explicitlyOmitted` when its PREDICATE appears in the
// canonicalizer's EXPLICITLY_OMITTED_PREDICATES registry. Nothing tests whether the omission was
// actually DELIBERATE. The report calls that bucket "declarations the graph deliberately does not
// carry - CHOSEN, never lost", and because the normative field `lostTotal` carries contentGap
// ONLY, every statement laundered into it is subtracted from the headline loss figure.
//
// WHY THIS PROBE EXISTS RATHER THAN A SENTENCE IN A DOCUMENT. `explicitlyOmittedTotal` is 0 in the
// current build, so a reader has no way to tell whether that is because the path is safe or
// because nothing has exercised it. This probe exercises it and watches it launder.
//
// WHAT IT MUTATES: THE CORPUS — a scratch COPY, never the pinned snapshot. One character inside
// one xs:documentation string. SHA256SUMS is REGENERATED deliberately, so the checksum gate is
// satisfied and the COMPARATOR is actually reached; without that the mutation would be caught by
// the cheap outer gate and this probe would demonstrate nothing about bucketing.
//
// A SECOND THING THIS DEMONSTRATES, and it is why the corpus is not the mutation suite's site.
// `fileLabel` is content-addressed — `pescArtifact:<sha256>` — so a ONE BYTE change re-keys every
// subject in the file and the WHOLE FILE decouples. The eight statements below are the whole of
// that file, not eight consequences of one altered character. A corpus mutation is a TRUE POSITIVE
// WITH THE WRONG ATTRIBUTION.
//
// READ-ONLY against the pinned snapshot, the graph and every container.
//
//   jq -nc '{containerName:"DEV_pesc260805",scratchDirPath:"/tmp/p6l"}' \
//     | node test/probes/p6_explicitlyOmittedLaundering.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (oneMessage) => console.error(oneMessage),
	result: () => {},
	verbose: () => {},
};

const moduleName = 'p6_explicitlyOmittedLaundering';
const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const MUTATION_TARGET_FILENAME = 'TestScoreReport_v1.1.0.xsd';

const validatorLib = require(path.join(BUNDLE_DIR, 'roundTripValidator'))();

const readStdinJson = (callback) => {
	let stdinText = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (oneChunk) => {
		stdinText += oneChunk;
	});
	process.stdin.on('end', () => {
		if (stdinText.trim() === '') {
			callback(
				`${moduleName}: input is REQUIRED on stdin as JSON and there is NO DEFAULT — ` +
					`{containerName, scratchDirPath}.`,
			);
			return;
		}
		let parsedStdin;
		let faultMessage = '';
		try {
			parsedStdin = JSON.parse(stdinText);
		} catch (parseError) {
			faultMessage = parseError.message;
		}
		if (faultMessage) {
			callback(`${moduleName}: stdin is not parseable JSON (${faultMessage}).`);
			return;
		}
		const missingNameList = ['containerName', 'scratchDirPath'].filter(
			(oneName) =>
				typeof parsedStdin[oneName] !== 'string' || parsedStdin[oneName].trim() === '',
		);
		if (missingNameList.length) {
			callback(`${moduleName}: stdin JSON missing required value(s): ${missingNameList.join(', ')}.`);
			return;
		}
		callback('', parsedStdin);
	});
};

// buildMutatedCorpusCopy — one character, one file, checksums regenerated. Refuses by name if the
// edit does not land: a mutation that silently changes nothing would make the comparison below
// report "no difference" and read as safety.
const buildMutatedCorpusCopy = (scratchDirPath) => {
	const corpusCopyPath = path.join(scratchDirPath, 'mutatedCorpus');
	fs.rmSync(corpusCopyPath, { recursive: true, force: true });
	fs.mkdirSync(corpusCopyPath, { recursive: true });
	fs.readdirSync(SNAPSHOT_DIR).forEach((oneFilename) => {
		fs.copyFileSync(path.join(SNAPSHOT_DIR, oneFilename), path.join(corpusCopyPath, oneFilename));
	});

	const targetFilePath = path.join(corpusCopyPath, MUTATION_TARGET_FILENAME);
	const originalText = fs.readFileSync(targetFilePath, 'utf8');
	const documentationOpenTag = '<xs:documentation>';
	const openAt = originalText.indexOf(documentationOpenTag);
	if (openAt === -1) {
		throw new Error(
			`${moduleName}: ${MUTATION_TARGET_FILENAME} carries no ${documentationOpenTag}. The ` +
				`demonstration cannot be built and MUST NOT be reported as a clean result.`,
		);
	}
	const characterAt = openAt + documentationOpenTag.length;
	const originalCharacter = originalText[characterAt];
	const replacementCharacter = originalCharacter === 'Z' ? 'Q' : 'Z';
	const mutatedText =
		originalText.slice(0, characterAt) + replacementCharacter + originalText.slice(characterAt + 1);
	if (mutatedText === originalText) {
		throw new Error(`${moduleName}: the one-character edit produced identical bytes. Refusing.`);
	}
	if (mutatedText.length !== originalText.length) {
		throw new Error(
			`${moduleName}: the edit changed the file LENGTH, so it is not the one-character ` +
				`substitution this demonstration claims. Refusing.`,
		);
	}
	fs.writeFileSync(targetFilePath, mutatedText);

	// Regenerate SHA256SUMS so the checksum gate is SATISFIED and the comparator is reached.
	const sumsLineList = fs
		.readdirSync(corpusCopyPath)
		.filter((oneFilename) => oneFilename.endsWith('.xsd'))
		.sort()
		.map((oneFilename) => {
			const fileBytes = fs.readFileSync(path.join(corpusCopyPath, oneFilename));
			return `${crypto.createHash('sha256').update(fileBytes).digest('hex')}  ${oneFilename}`;
		});
	fs.writeFileSync(path.join(corpusCopyPath, 'SHA256SUMS'), `${sumsLineList.join('\n')}\n`);

	return {
		corpusCopyPath,
		changedFrom: originalCharacter,
		changedTo: replacementCharacter,
		differingByteCount: 1,
	};
};

readStdinJson((inputError, inputValues) => {
	if (inputError) {
		console.error(inputError);
		process.exit(1);
	}
	fs.mkdirSync(inputValues.scratchDirPath, { recursive: true });

	let mutation;
	let buildFaultMessage = '';
	try {
		mutation = buildMutatedCorpusCopy(inputValues.scratchDirPath);
	} catch (buildError) {
		buildFaultMessage = buildError.message;
	}
	if (buildFaultMessage) {
		console.error(buildFaultMessage);
		process.exit(1);
	}

	console.log('');
	console.log(`  NAMED DEFECT P6-D1 — explicitlyOmitted laundering, DEMONSTRATED`);
	console.log(
		`  mutation: one character in one xs:documentation of ${MUTATION_TARGET_FILENAME} ` +
			`('${mutation.changedFrom}' -> '${mutation.changedTo}'), SHA256SUMS regenerated`,
	);
	console.log('');

	// The CONTROL is the pinned snapshot itself. Without it, the mutated numbers below are just
	// numbers; with it they are a delta attributable to one byte.
	validatorLib.validate(
		{
			containerName: inputValues.containerName,
			snapshotPath: SNAPSHOT_DIR,
			outputPath: path.join(inputValues.scratchDirPath, 'controlRun'),
			independentCheck: false,
		},
		(controlError, controlVerdict) => {
			if (controlError) {
				console.error(`${moduleName}: the CONTROL run refused: ${controlError}`);
				process.exit(1);
			}
			validatorLib.validate(
				{
					containerName: inputValues.containerName,
					snapshotPath: mutation.corpusCopyPath,
					outputPath: path.join(inputValues.scratchDirPath, 'mutatedRun'),
					independentCheck: false,
				},
				(mutatedError, mutatedVerdict) => {
					if (mutatedError) {
						console.error(`${moduleName}: the MUTATED run refused: ${mutatedError}`);
						process.exit(1);
					}
					const controlNotReproduced =
						controlVerdict.contentGapTotal + controlVerdict.explicitlyOmittedTotal;
					const mutatedNotReproduced =
						mutatedVerdict.contentGapTotal + mutatedVerdict.explicitlyOmittedTotal;
					const contentGapDelta = mutatedVerdict.contentGapTotal - controlVerdict.contentGapTotal;
					const laundered =
						mutatedVerdict.explicitlyOmittedTotal - controlVerdict.explicitlyOmittedTotal;

					const row = (oneLabel, controlValue, mutatedValue) =>
						console.log(
							`    ${oneLabel.padEnd(34)} control ${String(controlValue).padStart(7)}   ` +
								`mutated ${String(mutatedValue).padStart(7)}   delta ${String(mutatedValue - controlValue).padStart(5)}`,
						);
					row('notReproduced (gap + omitted)', controlNotReproduced, mutatedNotReproduced);
					row('contentGapTotal', controlVerdict.contentGapTotal, mutatedVerdict.contentGapTotal);
					row(
						'explicitlyOmittedTotal',
						controlVerdict.explicitlyOmittedTotal,
						mutatedVerdict.explicitlyOmittedTotal,
					);
					row('lostTotal (NORMATIVE)', controlVerdict.lostTotal, mutatedVerdict.lostTotal);
					row('inventedTotal', controlVerdict.inventedTotal, mutatedVerdict.inventedTotal);

					console.log('');
					const launderingObserved = laundered > 0;
					if (launderingObserved) {
						console.log(
							`  RED OBSERVED   ${laundered} statement(s) of a GENUINE corruption were filed as ` +
								`explicitlyOmitted — the bucket the report calls "CHOSEN, never lost".`,
						);
						console.log(
							`                 notReproduced rose by ${mutatedNotReproduced - controlNotReproduced} ` +
								`while the normative lostTotal rose by only ${contentGapDelta}. ` +
								`lostTotal UNDER-REPORTS by ${laundered}.`,
						);
						// THE SEVERITY CAVEAT, added at the independent review's direction because the
						// first framing overstated this. In THIS demonstration inventedTotal also went
						// 0 -> 8, and inventedTotal > 0 FAILS A BUILD. So this particular defect does
						// NOT escape: it is caught loudly by a different gate. What the demonstration
						// proves is that the LAUNDERING PATH IS LIVE, not that a defect slipped
						// through. The dangerous case is a defect that laundders WITHOUT tripping
						// invented — that case is not demonstrated here and must not be claimed.
						console.log('');
						console.log(
							`  SEVERITY, STATED HONESTLY: inventedTotal also moved ` +
								`${controlVerdict.inventedTotal} -> ${mutatedVerdict.inventedTotal} in this ` +
								`run, and inventedTotal > 0 FAILS A BUILD. This defect therefore does NOT ` +
								`escape here — it is caught by a different gate.`,
						);
						console.log(
							`                 What is demonstrated is that the laundering PATH IS LIVE. A ` +
								`defect that launders WITHOUT moving inventedTotal is the dangerous case and ` +
								`it is NOT demonstrated by this probe. Do not claim it.`,
						);
					} else {
						console.log(
							`  NOT RED        no statement was laundered into explicitlyOmitted. The ` +
								`demonstration did not reproduce and P6-D1 must be re-examined rather than ` +
								`assumed still true.`,
						);
					}

					const reportPath = path.join(inputValues.scratchDirPath, 'p6ExplicitlyOmittedLaundering.json');
					fs.writeFileSync(
						reportPath,
						JSON.stringify(
							{
								defectId: 'P6-D1',
								mutationTargetFilename: MUTATION_TARGET_FILENAME,
								differingByteCount: mutation.differingByteCount,
								control: {
									contentGapTotal: controlVerdict.contentGapTotal,
									explicitlyOmittedTotal: controlVerdict.explicitlyOmittedTotal,
									lostTotal: controlVerdict.lostTotal,
									inventedTotal: controlVerdict.inventedTotal,
								},
								mutated: {
									contentGapTotal: mutatedVerdict.contentGapTotal,
									explicitlyOmittedTotal: mutatedVerdict.explicitlyOmittedTotal,
									lostTotal: mutatedVerdict.lostTotal,
									inventedTotal: mutatedVerdict.inventedTotal,
								},
								launderedStatementCount: laundered,
								lostTotalUnderReportsBy: laundered,
								launderingObserved,
							},
							null,
							1,
						),
					);
					console.log(`  written: ${reportPath}`);
					process.exit(launderingObserved ? 0 : 1);
				},
			);
		},
	);
});
