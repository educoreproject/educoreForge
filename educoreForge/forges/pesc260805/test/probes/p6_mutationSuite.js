#!/usr/bin/env node
'use strict';

// p6_mutationSuite.js — PHASE 6 DELIVERABLE A, the anti-cheat gate (R-VAL-3).
//
// THE CLAIM THIS EXISTS TO TEST: that the round-trip validator can actually catch a defect. A
// check that has only ever passed has not been tested.
//
// WHERE THE DEFECTS ARE PLANTED, AND WHY NOT WHERE THE WORK ORDER SAYS. The work order says to
// plant defects "in the FORGE INPUT or the CORPUS". The CORPUS ROUTE WAS BUILT, RUN, AND FOUND
// UNSOUND FOR THIS PURPOSE, and the reason is structural rather than incidental:
//
//   `fileLabel` is CONTENT-ADDRESSED — `pescArtifact:<sha256 of the file bytes>` — which Phase 5
//   introduced to cure the version-stripped-filename fusion. Every statement subject in a file is
//   scoped to that hash. So changing ONE BYTE of a corpus file changes EVERY subject in it and the
//   whole file decouples from its graph counterpart.
//
// OBSERVED, not reasoned: one character altered inside one xs:documentation string in
// TestScoreReport_v1.1.0.xsd (exactly one differing byte by cmp, SHA256SUMS regenerated so the
// checksum gate was deliberately satisfied and the comparator actually reached) drove ALL EIGHT of
// that file's statements unmatched — including targetNamespace, elementFormDefault and
// importsNamespace, which have nothing to do with the character that changed.
//
// A corpus mutation is therefore a TRUE POSITIVE WITH THE WRONG ATTRIBUTION. It proves the
// validator notices something; it cannot prove the comparator can see a documentation change. On a
// large file the entire file decouples and any single planted defect is indistinguishable in the
// noise. Recorded as a FINDING against the work order rather than worked around silently.
//
// The defects are therefore planted in the GRAPH ROWS delivered by the source-tier reader, by
// wrapping `reader.readAll` before the emitter sees them. That is the mechanism Phase 5's own
// Levers 3 and 4 used. It MUTATES DATA, not a test expectation, which is the standing rule: an
// expectation lever reddens an assertion whether or not its predicate can EVER be satisfied by
// real data, so it certifies vacuous gates as proven.
//
// NOTHING HERE WRITES. Not to the graph, not to the corpus, not to any container. Every mutation
// is applied to an in-memory deep copy of the rows.
//
// THE CONTROL IS LOAD-BEARING. NO_MUTATION_CONTROL runs first and its statement set is the answer
// key. Without it, a harness that reported "different" for everything would look like a perfect
// detector.
//
// A MUTATION THAT CANNOT FIND ITS TARGET REFUSES BY NAME AND DOES NOT RUN. This is not fastidious.
// A mutation that silently mutates nothing reports zero difference and is INDISTINGUISHABLE FROM A
// GENUINE BLIND SPOT. That trap was hit for real while this suite was being built.
//
//   jq -nc '{containerName:"DEV_pesc260805",outputPath:"/tmp/p6"}' | node test/probes/p6_mutationSuite.js
//
// House style: error-first callbacks, no async/await, no try/catch for control flow.

const fs = require('fs');
const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (oneMessage) => console.error(oneMessage),
	result: () => {},
	verbose: () => {},
};

const moduleName = 'p6_mutationSuite';
const BUNDLE_DIR = path.join(__dirname, '..', '..');

const emitterLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripSourceEmitter'))();
const canonicalLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripXsdCanonical'))();

// =====================================================================
// requireRow — the refusal that keeps a missing target from posing as a blind spot.
// =====================================================================
const requireRow = (nodeListByLabel, oneLabel, matchFunction, targetDescription) => {
	const rowList = nodeListByLabel[oneLabel];
	if (!Array.isArray(rowList)) {
		throw new Error(
			`${moduleName}: the reader returned no '${oneLabel}' rows at all. The mutation cannot be ` +
				`applied and MUST NOT be reported as a blind spot.`,
		);
	}
	const foundRow = rowList.find((oneRow) => matchFunction(oneRow.properties));
	if (!foundRow) {
		throw new Error(
			`${moduleName}: no ${oneLabel} row satisfies the target predicate (${targetDescription}). ` +
				`The mutation cannot be applied and MUST NOT be reported as a blind spot.`,
		);
	}
	return foundRow;
};

// =====================================================================
// THE MUTATION REGISTRY — data, not a switch. Each entry names WHAT IT MUTATES and returns a
// human-readable description of the actual row it touched, so the evidence identifies a real
// subject rather than a category.
//
// The six are the six R-VAL-3 names, in the specification's own order.
//
// THE POLYMORPHIC SEAM IS DECLARED RATHER THAN IMPLIED. Every entry is invoked identically by
// this suite AND by p6_redEvidenceLevers, so the shape below is a contract between two callers
// and not a local convenience.
//
/**
 * @interface PlantedDefect
 * @property {'caught'|'blind'|'control'} expectation — what the RECORDED, PRE-REGISTERED belief
 *   is about whether the primary comparator can see this defect. It is written down BEFORE the
 *   run so that an outcome disagreeing with it is reported as a mismatch rather than quietly
 *   becoming the new expectation. The suite exits non-zero on any mismatch.
 * @property {function(Object): string} apply — mutates the graph-row set IN PLACE (the caller
 *   supplies a deep copy) and returns a description naming the ACTUAL row touched. THROWS, and
 *   never returns quietly, when its target is absent: a mutation that mutates nothing produces
 *   zero statement difference and is indistinguishable from a genuine blind spot.
 */
// =====================================================================
const MUTATION_REGISTRY = {
	NO_MUTATION_CONTROL: {
		expectation: 'control',
		apply: () => 'CONTROL: no mutation applied — this run is the answer key',
	},

	dropOneEnumerationValue: {
		expectation: 'caught',
		apply: (rows) => {
			const targetRow = requireRow(
				rows,
				'PescDerivation',
				(oneProperties) =>
					typeof oneProperties.enumerationValues === 'string' &&
					oneProperties.enumerationValues.length > 60,
				'PescDerivation carrying a non-trivial enumerationValues JSON string',
			);
			const parsedValueList = JSON.parse(targetRow.properties.enumerationValues);
			const removedEntry = parsedValueList.shift();
			targetRow.properties.enumerationValues = JSON.stringify(parsedValueList);
			if (
				targetRow.properties.enumerationCount !== null &&
				targetRow.properties.enumerationCount !== undefined
			) {
				targetRow.properties.enumerationCount = parsedValueList.length;
			}
			return `dropped enumeration value ${JSON.stringify(removedEntry.value)} from ${targetRow.properties.stableId}`;
		},
	},

	swapTwoSiblingElements: {
		expectation: 'blind',
		apply: (rows) => {
			const rowListByParentId = new Map();
			rows.PescElementDecl.forEach((oneRow) => {
				const siblingList = rowListByParentId.get(oneRow.properties.parentId) || [];
				siblingList.push(oneRow);
				rowListByParentId.set(oneRow.properties.parentId, siblingList);
			});
			const siblingPair = [...rowListByParentId.values()].find(
				(oneList) =>
					oneList.length >= 2 &&
					oneList[0].properties.name !== oneList[1].properties.name &&
					oneList[0].properties.sequencePosition !== oneList[1].properties.sequencePosition,
			);
			if (!siblingPair) {
				throw new Error(
					`${moduleName}: no pair of distinctly-named sibling PescElementDecl rows with ` +
						`different sequencePositions was found. Refusing rather than reporting a blind spot.`,
				);
			}
			const [firstRow, secondRow] = siblingPair;
			const heldPosition = firstRow.properties.sequencePosition;
			firstRow.properties.sequencePosition = secondRow.properties.sequencePosition;
			secondRow.properties.sequencePosition = heldPosition;
			return (
				`swapped sequencePosition of siblings ${firstRow.properties.name} <-> ` +
				`${secondRow.properties.name} under ${firstRow.properties.parentId}`
			);
		},
	},

	changeOneMinOccurs: {
		expectation: 'caught',
		apply: (rows) => {
			// '0' -> '1' deliberately, and NOT the removal of an explicit minOccurs="1". The
			// canonicalizer emits the XSD-EFFECTIVE value (`minOccurs || '1'`), so deleting an
			// explicit "1" is CORRECTLY invisible and would manufacture a false blind spot.
			const targetRow = requireRow(
				rows,
				'PescElementDecl',
				(oneProperties) => oneProperties.minOccurs === '0',
				'PescElementDecl carrying an explicit minOccurs of "0"',
			);
			targetRow.properties.minOccurs = '1';
			return `minOccurs "0" -> "1" on ${targetRow.properties.stableId}`;
		},
	},

	alterOneDocumentationCharacter: {
		expectation: 'caught',
		apply: (rows) => {
			const targetRow = requireRow(
				rows,
				'PescNamedDefinition',
				(oneProperties) =>
					typeof oneProperties.documentation === 'string' && oneProperties.documentation.length > 30,
				'PescNamedDefinition whose documentation exceeds 30 characters',
			);
			const documentationBefore = targetRow.properties.documentation;
			targetRow.properties.documentation =
				(documentationBefore[0] === 'Z' ? 'Q' : 'Z') + documentationBefore.slice(1);
			return (
				`one character of documentation altered on ${targetRow.properties.stableId} ` +
				`(${JSON.stringify(documentationBefore.slice(0, 24))} -> ` +
				`${JSON.stringify(targetRow.properties.documentation.slice(0, 24))})`
			);
		},
	},

	repointReferenceToOtherNamespace: {
		expectation: 'blind',
		apply: (rows) => {
			const targetRow = requireRow(
				rows,
				'PescElementDecl',
				(oneProperties) =>
					typeof oneProperties.typeAsWritten === 'string' &&
					oneProperties.typeAsWritten.startsWith('core:'),
				'PescElementDecl whose typeAsWritten carries the core: prefix',
			);
			const typeBefore = targetRow.properties.typeAsWritten;
			targetRow.properties.typeAsWritten = `AcRec:${typeBefore.slice('core:'.length)}`;
			return (
				`repointed ${typeBefore} -> ${targetRow.properties.typeAsWritten} (SAME local name, ` +
				`DIFFERENT namespace) on ${targetRow.properties.stableId}`
			);
		},
	},

	deleteOneType: {
		expectation: 'caught',
		apply: (rows) => {
			const targetRow = requireRow(
				rows,
				'PescNamedDefinition',
				(oneProperties) => oneProperties.kind === 'complexType',
				'PescNamedDefinition of kind complexType',
			);
			const removedStableId = targetRow.properties.stableId;
			rows.PescNamedDefinition = rows.PescNamedDefinition.filter((oneRow) => oneRow !== targetRow);
			return `deleted named definition ${removedStableId}`;
		},
	},
};

// =====================================================================
// readStdinJson — the input contract. No default endpoint, no default container.
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
				`${moduleName}: input is REQUIRED on stdin as JSON and there is NO DEFAULT — ` +
					`{containerName, outputPath}. A port is never taken from a document: ports are minted ` +
					`per build and this campaign has a live case where a document's port now belongs to a ` +
					`different graph entirely.`,
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
		const missingNameList = ['containerName', 'outputPath'].filter(
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

// =====================================================================
// emitStatementKeySetUnderMutation — one mutation, one emitted statement key set.
// =====================================================================
const emitStatementKeySetUnderMutation = ({ baselineRows, mutationName }, callback) => {
	const clonedRows = JSON.parse(JSON.stringify(baselineRows));
	let mutationDescription = '';
	let faultMessage = '';
	try {
		mutationDescription = MUTATION_REGISTRY[mutationName].apply(clonedRows);
	} catch (mutationError) {
		faultMessage = mutationError.message;
	}
	if (faultMessage) {
		callback(faultMessage);
		return;
	}
	const mutatingReader = {
		readAll: (unusedOptions, readCallback) => readCallback('', clonedRows),
	};
	emitterLib.emitFromReader({ reader: mutatingReader }, (emitError, emitted) => {
		if (emitError) {
			callback(emitError);
			return;
		}
		const fileList = emitted.emittedFileList.map((oneFile) => ({
			xsdText: oneFile.xsdText,
			fileLabel: oneFile.fileLabel,
		}));
		canonicalLib.canonicalizeXsdFileSet({ fileList }, (canonError, canonical) => {
			if (canonError) {
				callback(canonError);
				return;
			}
			callback('', {
				mutationDescription,
				statementKeySet: new Set(canonical.statements.keys()),
			});
		});
	});
};

// =====================================================================
// EXPORTED FOR THE RED-EVIDENCE LEVERS, and this export is the point rather than a convenience.
//
// p6_redEvidenceLevers.js reddens the refusal path by handing THESE OBJECTS a row set with the
// targets removed. Phase 5 had to WITHDRAW a lever that exercised a probe-local COPY of a
// production assertion, because a copy certifies only itself. The levers must reach the same
// registry and the same requireRow that a real run reaches, so they are exported here.
//
// The suite still runs as a script when invoked directly; requiring it does NOT read stdin.
// =====================================================================
module.exports = { MUTATION_REGISTRY, requireRow, moduleName };

if (require.main !== module) {
	return;
}

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
				const mutationNameList = Object.keys(MUTATION_REGISTRY);
				const resultRowList = [];
				let controlKeySet = null;

				console.log('');
				console.log(`  MUTATION SUITE (R-VAL-3) — graph ${inputValues.containerName} @ ${bolt.boltUrl}`);
				console.log('  every lever MUTATES GRAPH ROWS; nothing is written to graph, corpus or container');
				console.log('');

				const runOne = (mutationIndex) => {
					if (mutationIndex >= mutationNameList.length) {
						const caughtCount = resultRowList.filter((one) => one.outcome === 'CAUGHT').length;
						const blindCount = resultRowList.filter((one) => one.outcome === 'BLIND SPOT').length;
						const unexpectedList = resultRowList.filter(
							(one) => one.expectation !== 'control' && !one.matchesExpectation,
						);
						console.log('');
						console.log(`  CAUGHT ${caughtCount}   DOCUMENTED BLIND SPOTS ${blindCount}`);
						if (unexpectedList.length) {
							console.log('');
							console.log('  *** OUTCOME DIFFERS FROM THE RECORDED EXPECTATION — investigate before believing ***');
							unexpectedList.forEach((oneRow) => {
								console.log(`      ${oneRow.mutationName}: expected ${oneRow.expectation}, observed ${oneRow.outcome}`);
							});
						}
						fs.mkdirSync(inputValues.outputPath, { recursive: true });
						const reportPath = path.join(inputValues.outputPath, 'p6MutationSuite.json');
						fs.writeFileSync(
							reportPath,
							JSON.stringify(
								{
									suite: moduleName,
									containerName: inputValues.containerName,
									boltUrl: bolt.boltUrl,
									controlStatementTotal: controlKeySet.size,
									caughtCount,
									blindSpotCount: blindCount,
									expectationMismatchCount: unexpectedList.length,
									resultRowList,
								},
								null,
								1,
							),
						);
						console.log(`  written: ${reportPath}`);
						process.exit(unexpectedList.length ? 1 : 0);
						return;
					}
					const oneMutationName = mutationNameList[mutationIndex];
					emitStatementKeySetUnderMutation(
						{ baselineRows, mutationName: oneMutationName },
						(runError, outcome) => {
							if (runError) {
								console.error(`  REFUSED  ${oneMutationName}: ${runError}`);
								process.exit(1);
								return;
							}
							if (oneMutationName === 'NO_MUTATION_CONTROL') {
								controlKeySet = outcome.statementKeySet;
								console.log(
									`  CONTROL      statements=${controlKeySet.size}   (the answer key; without it a ` +
										`harness that called everything different would look like a perfect detector)`,
								);
								resultRowList.push({
									mutationName: oneMutationName,
									expectation: 'control',
									outcome: 'control',
									matchesExpectation: true,
									statementTotal: controlKeySet.size,
									description: outcome.mutationDescription,
								});
								runOne(mutationIndex + 1);
								return;
							}
							let removedCount = 0;
							let addedCount = 0;
							controlKeySet.forEach((oneKey) => {
								if (!outcome.statementKeySet.has(oneKey)) {
									removedCount += 1;
								}
							});
							outcome.statementKeySet.forEach((oneKey) => {
								if (!controlKeySet.has(oneKey)) {
									addedCount += 1;
								}
							});
							const observedOutcome = removedCount + addedCount > 0 ? 'CAUGHT' : 'BLIND SPOT';
							const expectation = MUTATION_REGISTRY[oneMutationName].expectation;
							const matchesExpectation =
								(expectation === 'caught' && observedOutcome === 'CAUGHT') ||
								(expectation === 'blind' && observedOutcome === 'BLIND SPOT');
							console.log(
								`  ${observedOutcome.padEnd(12)} ${oneMutationName.padEnd(34)} ` +
									`removed=${String(removedCount).padStart(3)} added=${String(addedCount).padStart(3)}` +
									`${matchesExpectation ? '' : '   <-- DIFFERS FROM RECORDED EXPECTATION'}`,
							);
							console.log(`               ${outcome.mutationDescription}`);
							resultRowList.push({
								mutationName: oneMutationName,
								expectation,
								outcome: observedOutcome,
								matchesExpectation,
								removedCount,
								addedCount,
								description: outcome.mutationDescription,
							});
							runOne(mutationIndex + 1);
						},
					);
				};
				runOne(0);
			});
		},
	);
});
