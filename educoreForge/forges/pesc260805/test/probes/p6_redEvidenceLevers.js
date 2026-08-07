#!/usr/bin/env node
'use strict';

// p6_redEvidenceLevers.js — PHASE 6 RED EVIDENCE. Every gate this phase ships, OBSERVED FAILING.
//
// WHY EVERY LEVER MUTATES DATA. An expectation lever moves a pinned number and reddens an
// assertion whether or not its predicate can EVER be satisfied by real data, so it certifies
// vacuous gates as proven. A data lever cannot pass a vacuous check, because a vacuous check does
// not respond to data at all. Standing rule, imposed 2026-08-06.
//
// WHY THESE LEVERS REACH THE REAL REGISTRY. Phase 5 had to WITHDRAW a lever after finding it
// exercised a probe-local COPY of a production assertion, which certifies only itself. Every
// lever below requires p6_mutationSuite and drives the SAME `MUTATION_REGISTRY` and the SAME
// `requireRow` that a production run drives.
//
// THE CONTROL IS FIRST AND IT IS LOAD-BEARING. A guard that refuses everything is not a guard.
// Each refusal lever is preceded by an accept-control over the SAME code path with the target
// present, so a refusal below demonstrates a MISSING TARGET rather than a check that says no to
// whatever it is handed.
//
// READ-ONLY. Nothing here writes to the graph, the corpus or any container. Row sets are built in
// memory from a live read and mutated as deep copies.
//
//   jq -nc '{containerName:"DEV_pesc260805"}' | node test/probes/p6_redEvidenceLevers.js

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (oneMessage) => console.error(oneMessage),
	result: () => {},
	verbose: () => {},
};

const moduleName = 'p6_redEvidenceLevers';
const BUNDLE_DIR = path.join(__dirname, '..', '..');

const emitterLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripSourceEmitter'))();
const independentCheckLib = require(
	path.join(BUNDLE_DIR, 'lib', 'xsd-independent-check', 'xsd-independent-check'),
)();
const { MUTATION_REGISTRY } = require(path.join(__dirname, 'p6_mutationSuite'));

let redObservedCount = 0;
let notRedCount = 0;

const observe = (leverLabel, conditionHeld, detailText) => {
	if (conditionHeld) {
		redObservedCount += 1;
		console.log(`  RED OBSERVED   ${leverLabel}`);
		if (detailText) {
			console.log(`                 ${detailText}`);
		}
		return;
	}
	notRedCount += 1;
	console.error(`  NOT RED        ${leverLabel}  <-- the lever did not redden the check`);
	if (detailText) {
		console.error(`                 ${detailText}`);
	}
};

// applyAndCatch — runs a registry entry and reports the refusal message rather than throwing.
// try/catch here is EXCEPTION CAPTURE at a boundary, not control flow: the registry signals a
// missing target by throwing, and this probe's whole job is to observe that throw.
const applyAndCatch = (mutationName, rows) => {
	let refusalMessage = '';
	let successDescription = '';
	try {
		successDescription = MUTATION_REGISTRY[mutationName].apply(rows);
	} catch (mutationError) {
		refusalMessage = mutationError.message;
	}
	return { refusalMessage, successDescription };
};

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
					`{containerName}.`,
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
		if (typeof parsedStdin.containerName !== 'string' || parsedStdin.containerName.trim() === '') {
			callback(`${moduleName}: stdin JSON missing required value: containerName.`);
			return;
		}
		callback('', parsedStdin);
	});
};

// =====================================================================
// LEVER GROUP 1 — the MISSING-TARGET refusal (mutates the ROW DATA).
//
// The check under test: a mutation whose target is absent must REFUSE BY NAME rather than mutate
// nothing. This is not fastidiousness. A mutation that silently mutates nothing produces zero
// statement difference and is INDISTINGUISHABLE FROM A GENUINE BLIND SPOT — it would be published
// as a finding about the validator when it is a defect in the harness. That trap was hit for real
// while this suite was being built, twice, which is why the guard exists.
// =====================================================================
const runMissingTargetLevers = (baselineRows, callback) => {
	console.log('');
	console.log('  LEVER GROUP 1 — the missing-target refusal (mutates the ROW DATA)');

	const leverList = [
		{
			mutationName: 'dropOneEnumerationValue',
			targetDescription: 'every PescDerivation enumerationValues string',
			strip: (rows) => {
				rows.PescDerivation.forEach((oneRow) => {
					oneRow.properties.enumerationValues = '[]';
				});
			},
		},
		{
			mutationName: 'changeOneMinOccurs',
			targetDescription: 'every explicit minOccurs of "0"',
			strip: (rows) => {
				rows.PescElementDecl.forEach((oneRow) => {
					if (oneRow.properties.minOccurs === '0') {
						oneRow.properties.minOccurs = '1';
					}
				});
			},
		},
		{
			mutationName: 'repointReferenceToOtherNamespace',
			targetDescription: 'every core:-prefixed typeAsWritten',
			strip: (rows) => {
				rows.PescElementDecl.forEach((oneRow) => {
					if (
						typeof oneRow.properties.typeAsWritten === 'string' &&
						oneRow.properties.typeAsWritten.startsWith('core:')
					) {
						oneRow.properties.typeAsWritten = `zz:${oneRow.properties.typeAsWritten.slice(5)}`;
					}
				});
			},
		},
		{
			mutationName: 'deleteOneType',
			targetDescription: 'every PescNamedDefinition of kind complexType',
			strip: (rows) => {
				rows.PescNamedDefinition = rows.PescNamedDefinition.filter(
					(oneRow) => oneRow.properties.kind !== 'complexType',
				);
			},
		},
	];

	leverList.forEach((oneLever) => {
		// ACCEPT-CONTROL FIRST, over the same code path with the target PRESENT.
		const controlRows = JSON.parse(JSON.stringify(baselineRows));
		const controlOutcome = applyAndCatch(oneLever.mutationName, controlRows);
		observe(
			`CONTROL: ${oneLever.mutationName} SUCCEEDS while its target is present`,
			controlOutcome.refusalMessage === '' && controlOutcome.successDescription !== '',
			controlOutcome.refusalMessage
				? `unexpected refusal: ${controlOutcome.refusalMessage}`
				: controlOutcome.successDescription.slice(0, 120),
		);

		// THE DATA LEVER: remove the target from the rows and require a NAMED refusal.
		const strippedRows = JSON.parse(JSON.stringify(baselineRows));
		oneLever.strip(strippedRows);
		const strippedOutcome = applyAndCatch(oneLever.mutationName, strippedRows);
		observe(
			`${oneLever.mutationName} REFUSES BY NAME once the data no longer contains ${oneLever.targetDescription}`,
			strippedOutcome.refusalMessage.includes('MUST NOT be reported as a blind spot') ||
				strippedOutcome.refusalMessage.includes('Refusing rather than reporting a blind spot'),
			strippedOutcome.refusalMessage
				? strippedOutcome.refusalMessage.slice(0, 150)
				: `NO REFUSAL — the mutation reported success: ${strippedOutcome.successDescription.slice(0, 100)}`,
		);
	});

	callback('');
};

// =====================================================================
// LEVER GROUP 2 — the INDEPENDENT INSTRUMENT's input refusals (mutates the ARGUMENTS, which for
// this check ARE the data: a corpus directory is the whole input).
//
// A COMMENT HERE PREVIOUSLY CLAIMED THE R-P5-1 PROCESSOR PIN WAS EXERCISED AND IT WAS NOT. The
// independent review found it: there were three argument guards and no pin lever, and 4x2+3 = 11
// confirmed the count. The claim has not been softened — the LEVER HAS BEEN BUILT, below, and it
// drives the EXPORTED production guard `refuseUnlessProcessorIsXsd11`, not a copy.
//
// WHAT REMAINS UNDRIVEN IS DECLARED RATHER THAN IMPLIED. Of the four R-P5-1 pins, this probe now
// drives ONE (the Node-side result check). The python-side `XMLSchema11 is XMLSchema10` pin and
// the `hasattr XMLSchema11` pin cannot be driven without monkey-patching the third-party library
// inside the instrument that exists to be independent of us, so they stand as `genuineGap` — NOT
// as proven. The empty-compile pin was driven by the independent reviewer and found correct.
// =====================================================================
const runIndependentInstrumentLevers = (callback) => {
	console.log('');
	console.log('  LEVER GROUP 2 — the independent instrument refuses malformed input BY NAME');

	independentCheckLib.compareXsdCorpora({}, (absentArgumentError) => {
		observe(
			'compareXsdCorpora REFUSES when the two corpora are not named',
			typeof absentArgumentError === 'string' &&
				absentArgumentError.includes('REQUIRED') &&
				absentArgumentError.includes('no default'),
			String(absentArgumentError).slice(0, 150),
		);
		independentCheckLib.compareXsdCorpora(
			{
				sourceCorpusDirectory: '/nonexistent/source/corpus',
				emittedCorpusDirectory: '/nonexistent/emitted/corpus',
				outputJsonPath: '/tmp/p6IndependentRefusalProbe.json',
			},
			(absentDirectoryError) => {
				observe(
					'compareXsdCorpora REFUSES a named corpus directory that does not exist',
					typeof absentDirectoryError === 'string' &&
						absentDirectoryError.includes('does not exist'),
					String(absentDirectoryError).slice(0, 150),
				);
				independentCheckLib.renderComparisonText({}, (absentComparisonError) => {
					observe(
						'renderComparisonText REFUSES to render a comparison it was never given',
						typeof absentComparisonError === 'string' &&
							absentComparisonError.includes('REQUIRED'),
						String(absentComparisonError).slice(0, 150),
					);
					runProcessorPinLevers(callback);
				});
			},
		);
	});
};

// =====================================================================
// LEVER GROUP 3 — THE R-P5-1 PROCESSOR PIN, actually driven.
//
// This is the lever a comment used to claim existed. It hands the EXPORTED production guard the
// shape it will really meet — the parsed summary the python instrument returns — carrying a
// processorClass other than XMLSchema11, which is exactly the state that arises if the pin in the
// python module is ever weakened or removed. The ACCEPT-CONTROL comes first, so a refusal below
// demonstrates the wrong processor rather than a guard that says no to everything.
// =====================================================================
const runProcessorPinLevers = (callback) => {
	console.log('');
	console.log('  LEVER GROUP 3 — the R-P5-1 XSD 1.1 pin, driven against the exported guard');

	independentCheckLib.refuseUnlessProcessorIsXsd11(
		{ summary: { processorClass: 'XMLSchema11', xmlschemaVersion: '4.3.2' } },
		(controlError) => {
			observe(
				'CONTROL: a summary reporting XMLSchema11 is ACCEPTED',
				!controlError,
				controlError ? `unexpected refusal: ${controlError}` : 'accepted',
			);
			independentCheckLib.refuseUnlessProcessorIsXsd11(
				{ summary: { processorClass: 'XMLSchema10', xmlschemaVersion: '4.3.2' } },
				(tenError) => {
					observe(
						'a summary reporting XMLSchema10 is REFUSED BY NAME (the silent-empty processor)',
						typeof tenError === 'string' && tenError.includes('R-P5-1'),
						String(tenError).slice(0, 150),
					);
					independentCheckLib.refuseUnlessProcessorIsXsd11(
						{ summary: { xmlschemaVersion: '4.3.2' } },
						(absentError) => {
							observe(
								'a summary NAMING NO PROCESSOR AT ALL is REFUSED, never assumed to be 1.1',
								typeof absentError === 'string' && absentError.includes('R-P5-1'),
								String(absentError).slice(0, 150),
							);
							callback('');
						},
					);
				},
			);
		},
	);
};

// =====================================================================
// main
// =====================================================================
readStdinJson((inputError, inputValues) => {
	if (inputError) {
		console.error(inputError);
		process.exit(1);
	}
	emitterLib.resolveContainerBolt(
		{ containerName: inputValues.containerName },
		(resolveError, bolt) => {
			if (resolveError) {
				console.error(`${moduleName}: ${resolveError}`);
				process.exit(1);
			}
			const baseReader = emitterLib.makeNeo4jSourceTierReader({
				boltUrl: bolt.boltUrl,
				user: bolt.user,
				password: bolt.password,
			});
			baseReader.readAll({}, (readError, baselineRows) => {
				if (readError) {
					console.error(`${moduleName}: ${readError}`);
					process.exit(1);
				}
				console.log('');
				console.log(`  PHASE 6 RED EVIDENCE — graph ${inputValues.containerName} @ ${bolt.boltUrl}`);
				runMissingTargetLevers(baselineRows, () => {
					runIndependentInstrumentLevers(() => {
						console.log('');
						console.log(`  RED OBSERVED ${redObservedCount}   NOT RED ${notRedCount}`);
						process.exit(notRedCount ? 1 : 0);
					});
				});
			});
		},
	);
});
