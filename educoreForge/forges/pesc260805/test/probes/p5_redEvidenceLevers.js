#!/usr/bin/env node
'use strict';

// p5_redEvidenceLevers.js — Phase 5 (session CRYSTAL_STREAM). THE RED EVIDENCE FOR GATE 5 AND FOR
// THE TWO CHECKS THIS PHASE SHIPPED, every lever MUTATING DATA rather than an expectation.
//
// WHY DATA LEVERS AND NOT EXPECTATION LEVERS. An expectation lever moves a pinned number and
// reddens an assertion whether or not the predicate can EVER be satisfied by real data, so it
// certifies vacuous gates as proven. A data lever cannot pass a vacuous check, because a vacuous
// check does not respond to data at all. Standing rule, imposed 2026-08-06.
//
// FOUR LEVERS, each stating WHAT IT MUTATES and WHAT MUST GO RED:
//
//   LEVER 1 — GATE 5, the malformed-verdict refusal. Mutates the VERDICT OBJECT (absent field,
//     wrong type, NaN). Must be refused BY NAME. NaN is included deliberately: it is typeof
//     'number' and satisfies a naive type check while making every comparison against it false.
//
//   LEVER 2 — R-VAL-5, synthetic reproducibility. Mutates the PRESERVED SYNTHESIS INPUT — a real
//     named definition is removed from a COPY of one collision member. The recomputed S-1 union
//     must shrink and stop matching the graph. This is the lever that proves the check is not the
//     function proving itself equal to itself.
//
//   LEVER 3 — the SOURCE-TIER PROJECTION assertion (R-VAL-1). Mutates the GRAPH ROWS handed to the
//     emitter, planting a node whose pescTier is 'synthetic'. The reader must refuse by name rather
//     than emit it, because an emitted synthetic node manufactures INVENTED statements.
//
//   LEVER 4 — SUBJECT PRECISION, on the supervisor's requirement TWO. Mutates the GRAPH ROWS,
//     removing ONE documentation literal from ONE component WHOSE TEXT ALSO OCCURS ELSEWHERE in
//     the corpus. A MULTISET comparison MASKS this — the other occurrence still matches, so the
//     count does not move. The validator compares SUBJECTED statements and must catch it. Both are
//     computed here and printed side by side, because the validator's immunity to its own probe's
//     blind spot is exactly the sort of claim that ships unproven.
//
// READ-ONLY against the real graph and the pinned snapshot: every mutation is applied to a COPY in
// a scratch directory or to an in-memory row set. Nothing here writes to the corpus, the graph, or
// any container.
//
//   jq -nc '{boltUrl:"bolt://localhost:PORT",neo4jUser:"neo4j",neo4jPassword:"...",scratchDirPath:"/tmp/..."}' \
//     | node test/probes/p5_redEvidenceLevers.js

const fs = require('fs');
const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const moduleName = 'p5_redEvidenceLevers';
const BUNDLE_DIR = path.join(__dirname, '..', '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');

const validatorLib = require(path.join(BUNDLE_DIR, 'roundTripValidator'))();
const emitterLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripSourceEmitter'))();
const reproducibilityLib = require(path.join(
	BUNDLE_DIR,
	'lib',
	'roundTripSyntheticReproducibility',
))();

let passCount = 0;
let failCount = 0;
let genuineGapCount = 0;
const observe = (label, condition, detail) => {
	if (condition) {
		passCount += 1;
		console.log(`  RED OBSERVED   ${label}`);
		if (detail) {
			console.log(`                 ${detail}`);
		}
		return;
	}
	failCount += 1;
	console.error(`  NOT RED        ${label}  <-- the lever did not redden the check`);
	if (detail) {
		console.error(`                 ${detail}`);
	}
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
				`${moduleName}: bolt credentials are REQUIRED on stdin as JSON and there is NO ` +
					`DEFAULT — {boltUrl, neo4jUser, neo4jPassword, scratchDirPath}.`,
			);
			return;
		}
		const parsedStdin = JSON.parse(stdinText);
		const missingNameList = ['boltUrl', 'neo4jUser', 'neo4jPassword', 'scratchDirPath'].filter(
			(oneName) => typeof parsedStdin[oneName] !== 'string' || parsedStdin[oneName].trim() === '',
		);
		if (missingNameList.length) {
			callback(`${moduleName}: stdin JSON missing required value(s): ${missingNameList.join(', ')}.`);
			return;
		}
		callback('', parsedStdin);
	});
};

// =====================================================================
// LEVER 1 — GATE 5: a deliberately malformed verdict must be refused BY NAME.
// =====================================================================
const runVerdictShapeLevers = () => {
	console.log('');
	console.log('  LEVER 1 — GATE 5, malformed verdict (mutates the VERDICT OBJECT)');

	const soundVerdict = {
		roundTripClean: true,
		inventedTotal: 0,
		lostTotal: 0,
		contentGapTotal: 0,
		explicitlyOmittedTotal: 0,
		syntheticReproducible: true,
		syntheticReproducibilityTotal: 109,
		// The coverage block is part of the SOUND shape as of the closing review. Its absence is
		// now a refusal, so the control must carry it or the control would be measuring the wrong
		// thing.
		syntheticReproducibility: {
			coverage: {
				checkedRuleList: ['S-1'],
				uncheckedRuleList: ['S-1c', 'S-2'],
				checkedNodeCount: 109,
				comparisonBasis: 'kind/name identity only - CONTENT IS NOT COMPARED',
				statement: 'covers S-1 IDENTITY only; S-1c and S-2 are UNCHECKED.',
			},
		},
	};

	// CONTROL FIRST: the sound verdict must PASS, or a refusal below proves nothing about
	// malformation — a check that refuses everything is not a check.
	validatorLib.verifyVerdictShape({ verdict: soundVerdict }, (soundError) => {
		observe(
			'CONTROL: a well-formed verdict is ACCEPTED (so the refusals below are about malformation, not about refusing everything)',
			!soundError,
			soundError ? `unexpected refusal: ${soundError}` : 'accepted',
		);

		const mutationList = [
			{
				label: 'inventedTotal ABSENT',
				mutate: (oneVerdict) => {
					const mutated = { ...oneVerdict };
					delete mutated.inventedTotal;
					return mutated;
				},
			},
			{
				label: "inventedTotal is the STRING '0' (falsy-looking to a naive consumer)",
				mutate: (oneVerdict) => ({ ...oneVerdict, inventedTotal: '0' }),
			},
			{
				label: 'lostTotal is NaN (typeof number; defeats every comparison)',
				mutate: (oneVerdict) => ({ ...oneVerdict, lostTotal: Number.NaN }),
			},
			{
				label: 'roundTripClean is the STRING "true"',
				mutate: (oneVerdict) => ({ ...oneVerdict, roundTripClean: 'true' }),
			},
			{
				label: 'syntheticReproducible ABSENT (R-VAL-5 never claimed)',
				mutate: (oneVerdict) => {
					const mutated = { ...oneVerdict };
					delete mutated.syntheticReproducible;
					return mutated;
				},
			},
			{
				label: 'the verdict is an ARRAY, not an object',
				mutate: () => [],
			},
			{
				// THE CLOSING-REVIEW DEFECT, now a lever. Before this, a coverage-less synthetic
				// result produced a verdict carrying a bare unqualified syntheticReproducible:true
				// — and this very probe was the caller that did it.
				label: 'syntheticReproducibility.coverage ABSENT (an UNQUALIFIED reproducibility claim)',
				mutate: (oneVerdict) => {
					const mutated = { ...oneVerdict };
					delete mutated.syntheticReproducibility;
					return mutated;
				},
			},
			{
				label: 'coverage.uncheckedRuleList is a STRING, not a list of unchecked rules',
				mutate: (oneVerdict) => ({
					...oneVerdict,
					syntheticReproducibility: {
						coverage: {
							...oneVerdict.syntheticReproducibility.coverage,
							uncheckedRuleList: 'S-1c, S-2',
						},
					},
				}),
			},
		];

		let mutationIndex = 0;
		const runNextMutation = () => {
			if (mutationIndex >= mutationList.length) {
				runReproducibilityLever();
				return;
			}
			const oneMutation = mutationList[mutationIndex];
			mutationIndex += 1;
			validatorLib.verifyVerdictShape(
				{ verdict: oneMutation.mutate(soundVerdict) },
				(shapeError) => {
					observe(
						`GATE 5: ${oneMutation.label}`,
						Boolean(shapeError),
						shapeError ? `refused: ${String(shapeError).split('\n')[1] || ''}`.trim() : '',
					);
					runNextMutation();
				},
			);
		};
		runNextMutation();
	});
};

// =====================================================================
// LEVER 2 — R-VAL-5: mutate a PRESERVED SYNTHESIS INPUT.
// =====================================================================
let stdinValues = null;

const runReproducibilityLever = () => {
	console.log('');
	console.log('  LEVER 2 — R-VAL-5, mutates a PRESERVED SYNTHESIS INPUT (a copy of a collision member)');

	const mutatedSnapshotDirPath = path.join(stdinValues.scratchDirPath, 'p5MutatedSynthesisInput');
	fs.rmSync(mutatedSnapshotDirPath, { recursive: true, force: true });
	fs.mkdirSync(mutatedSnapshotDirPath, { recursive: true });
	fs.readdirSync(SNAPSHOT_DIR)
		.filter((oneName) => oneName.endsWith('.xsd'))
		.forEach((oneName) =>
			fs.copyFileSync(path.join(SNAPSHOT_DIR, oneName), path.join(mutatedSnapshotDirPath, oneName)),
		);

	// CONTROL: unmutated copy must reproduce, or the mutation below proves nothing.
	reproducibilityLib.checkReproducibility(
		{
			snapshotPath: mutatedSnapshotDirPath,
			boltUrl: stdinValues.boltUrl,
			user: stdinValues.neo4jUser,
			password: stdinValues.neo4jPassword,
		},
		(controlError, controlResult) => {
			if (controlError) {
				observe('CONTROL: unmutated copy reproduces', false, controlError);
				runProjectionLever();
				return;
			}
			observe(
				`CONTROL: unmutated copy reproduces (union ${controlResult.expectedUnionTotal} = graph ${controlResult.graphSyntheticTotal})`,
				controlResult.reproducible,
			);

			// THE MUTATION: remove ONE real named definition from the college branch.
			const collegeFilePath = path.join(
				mutatedSnapshotDirPath,
				controlResult.collegeBranchFilename,
			);
			const collegeText = fs.readFileSync(collegeFilePath, 'utf8');
			const definitionMatch = collegeText.match(
				/\n\t<xs:simpleType name="([^"]+)">[\s\S]*?<\/xs:simpleType>/,
			);
			if (!definitionMatch) {
				observe(
					'R-VAL-5: a removable top-level simpleType was located in the college branch',
					false,
					'no match — the lever could not be applied',
				);
				runProjectionLever();
				return;
			}
			fs.writeFileSync(collegeFilePath, collegeText.replace(definitionMatch[0], '\n'));

			reproducibilityLib.checkReproducibility(
				{
					snapshotPath: mutatedSnapshotDirPath,
					boltUrl: stdinValues.boltUrl,
					user: stdinValues.neo4jUser,
					password: stdinValues.neo4jPassword,
				},
				(mutatedError, mutatedResult) => {
					if (mutatedError) {
						observe('R-VAL-5 lever', false, mutatedError);
						runProjectionLever();
						return;
					}
					observe(
						`R-VAL-5: removing simpleType '${definitionMatch[1]}' from the PRESERVED college-branch input breaks reproducibility`,
						mutatedResult.reproducible === false &&
							mutatedResult.unexpectedInGraphTotal > controlResult.unexpectedInGraphTotal,
						`union ${controlResult.expectedUnionTotal} -> ${mutatedResult.expectedUnionTotal}, ` +
							`unexpectedInGraph ${controlResult.unexpectedInGraphTotal} -> ${mutatedResult.unexpectedInGraphTotal}, ` +
							`reproducible ${controlResult.reproducible} -> ${mutatedResult.reproducible}`,
					);
					runProjectionLever();
				},
			);
		},
	);
};

// =====================================================================
// LEVERS 3 and 4 — mutate the GRAPH ROWS handed to the emitter.
// =====================================================================
const runProjectionLever = () => {
	console.log('');
	console.log('  LEVERS 3 & 4 — mutate the GRAPH ROWS the emitter reads');

	const reader = emitterLib.makeNeo4jSourceTierReader({
		boltUrl: stdinValues.boltUrl,
		user: stdinValues.neo4jUser,
		password: stdinValues.neo4jPassword,
	});

	reader.readAll({}, (readError, nodeListByLabel) => {
		if (readError) {
			observe('graph read for levers 3 & 4', false, readError);
			finish(reader);
			return;
		}

		// ---- LEVER 3: plant a node carrying the WRONG TIER ----
		const plantedNodeListByLabel = {};
		Object.keys(nodeListByLabel).forEach((oneLabel) => {
			plantedNodeListByLabel[oneLabel] = nodeListByLabel[oneLabel].slice();
		});
		const donorNode = plantedNodeListByLabel.PescElementDecl[0];
		plantedNodeListByLabel.PescElementDecl = plantedNodeListByLabel.PescElementDecl.concat({
			label: 'PescElementDecl',
			properties: {
				...donorNode.properties,
				stableId: `${donorNode.properties.stableId}/PLANTED_SYNTHETIC_LEVER`,
				pescTier: 'synthetic',
			},
		});

		const doubleReaderFor = (oneNodeListByLabel) => ({
			readAll: (unusedArgs, callback) => callback('', oneNodeListByLabel),
			close: (callback) => callback(''),
		});

		// LEVER 3 IS WITHDRAWN, AND THE WITHDRAWAL IS THE HONEST OUTCOME (review item 5).
		//
		// What shipped here was a PROBE-LOCAL RE-IMPLEMENTATION of the reader's tier assertion: it
		// walked the planted rows applying the same condition the reader applies, and reported
		// "RED OBSERVED" when its own copy agreed with itself. The production refusal was NEVER
		// EXECUTED. The reviewer's demonstration is exact and unanswerable — delete the production
		// refusal entirely and this lever stays green. A lever that exercises a copy of the shipped
		// code proves only that the copy works.
		//
		// AND IT CANNOT BE REPAIRED INTO A REAL LEVER, which is why it is withdrawn rather than
		// rewritten. The shipped refusal sits inside `readAll`, downstream of a Cypher WHERE clause
		// that already filters `pescTier = 'source'`. No mutation of the graph can deliver a
		// wrong-tier row to it, because the query will not select one. That is the same fact review
		// item 6 records, seen from the other end: the refusal is UNREACHABLE by data, so the row
		// stands as genuineGap and NOT as proven.
		//
		// Both were shipped by the same hand that wrote the code they certify. That is precisely
		// the closed loop the Phase 5/6 separation exists to break, and it took an independent
		// reader to see it.
		// Declared, NOT observed. It must not pass through observe(), because counting a withdrawn
		// lever as a pass would inflate the very tally this remediation exists to correct.
		genuineGapCount += 1;
		console.log(
			'  genuineGap     R-VAL-1 tier refusal — NO LEVER CLAIMED. The production refusal is ' +
				'unreachable by data (the query filters the tier it then checks), and the previous ' +
				'probe-local re-implementation certified only itself. Withdrawn per review items 5 and 6.',
		);

		// ---- LEVER 4: remove ONE documentation literal whose text ALSO occurs elsewhere ----
		const documentationOccurrenceCount = new Map();
		Object.keys(nodeListByLabel).forEach((oneLabel) => {
			nodeListByLabel[oneLabel].forEach((oneNode) => {
				const documentationText = oneNode.properties.documentation;
				if (documentationText === undefined || String(documentationText).trim() === '') {
					return;
				}
				documentationOccurrenceCount.set(
					documentationText,
					(documentationOccurrenceCount.get(documentationText) || 0) + 1,
				);
			});
		});
		const recurringDocumentationText = Array.from(documentationOccurrenceCount.entries())
			.filter(([oneText, oneCount]) => oneCount >= 2 && oneText.length > 40)
			.sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1])[0];

		if (!recurringDocumentationText) {
			observe(
				'SUBJECT PRECISION: a documentation literal occurring on 2+ components was located',
				false,
				'none found — the lever could not be applied',
			);
			finish(reader);
			return;
		}

		const [targetText, targetOccurrences] = recurringDocumentationText;
		let removedFromStableId = null;
		const strippedNodeListByLabel = {};
		Object.keys(nodeListByLabel).forEach((oneLabel) => {
			strippedNodeListByLabel[oneLabel] = nodeListByLabel[oneLabel].map((oneNode) => {
				if (removedFromStableId || oneNode.properties.documentation !== targetText) {
					return oneNode;
				}
				removedFromStableId = oneNode.properties.stableId;
				const strippedProperties = { ...oneNode.properties };
				delete strippedProperties.documentation;
				return { ...oneNode, properties: strippedProperties };
			});
		});

		console.log('');
		console.log(
			`    target literal occurs on ${targetOccurrences} components; removed from ONE: ${removedFromStableId}`,
		);
		console.log(`    literal: ${JSON.stringify(targetText.slice(0, 90))}`);

		// THE MULTISET VIEW — what p5_measureDocumentationWhitespaceCollapse would see.
		const multisetBefore = new Map();
		const multisetAfter = new Map();
		const tally = (oneNodeListByLabel, oneMultiset) => {
			Object.keys(oneNodeListByLabel).forEach((oneLabel) => {
				oneNodeListByLabel[oneLabel].forEach((oneNode) => {
					const documentationText = oneNode.properties.documentation;
					if (documentationText === undefined || String(documentationText).trim() === '') {
						return;
					}
					const trimmedText = String(documentationText).trim();
					oneMultiset.set(trimmedText, (oneMultiset.get(trimmedText) || 0) + 1);
				});
			});
		};
		tally(nodeListByLabel, multisetBefore);
		tally(strippedNodeListByLabel, multisetAfter);
		const multisetStillPresent = multisetAfter.has(String(targetText).trim());

		// THE VALIDATOR VIEW — subjected statements.
		const outputPathBefore = path.join(stdinValues.scratchDirPath, 'p5LeverBaseline');
		const outputPathAfter = path.join(stdinValues.scratchDirPath, 'p5LeverStripped');
		const soundReproducibility = {
			reproducible: true,
			comparedTotal: 109,
			// COVERAGE IS NOW REQUIRED (closing review). This probe previously handed in a
			// coverage-less object and the validator produced an UNQUALIFIED
			// syntheticReproducible:true — this bundle's own probe was the demonstration that the
			// qualification could be omitted. It cannot be omitted any more, and this fixture is
			// the shape a caller must supply.
			coverage: {
				checkedRuleList: ['S-1'],
				uncheckedRuleList: ['S-1c', 'S-2'],
				checkedNodeCount: 109,
				syntheticNodeTotalInGraph: 632,
				comparisonBasis: 'kind/name identity only - CONTENT IS NOT COMPARED',
				statement:
					'lever fixture: reproducible=true covers S-1 IDENTITY only; S-1c and S-2 are UNCHECKED.',
			},
		};

		validatorLib.validateWithReader(
			{
				reader: doubleReaderFor(nodeListByLabel),
				snapshotPath: SNAPSHOT_DIR,
				outputPath: outputPathBefore,
				graphIdentity: { containerName: 'lever-baseline', boltUrl: stdinValues.boltUrl },
				syntheticReproducibility: soundReproducibility,
			},
			(baselineError, baselineVerdict) => {
				if (baselineError) {
					observe('SUBJECT PRECISION baseline', false, baselineError);
					finish(reader);
					return;
				}
				validatorLib.validateWithReader(
					{
						reader: doubleReaderFor(strippedNodeListByLabel),
						snapshotPath: SNAPSHOT_DIR,
						outputPath: outputPathAfter,
						graphIdentity: { containerName: 'lever-stripped', boltUrl: stdinValues.boltUrl },
						syntheticReproducibility: soundReproducibility,
					},
					(strippedError, strippedVerdict) => {
						if (strippedError) {
							observe('SUBJECT PRECISION stripped', false, strippedError);
							finish(reader);
							return;
						}
						console.log('');
						console.log(
							`    MULTISET view  (the probe's method): literal still present after removal = ${multisetStillPresent}  -> MASKED`,
						);
						console.log(
							`    VALIDATOR view (subjected statements): lostTotal ${baselineVerdict.lostTotal} -> ${strippedVerdict.lostTotal}`,
						);
						observe(
							"SUPERVISOR REQUIREMENT 2: the validator CATCHES a removed literal that the probe's multiset comparison MASKS",
							multisetStillPresent === true &&
								strippedVerdict.lostTotal > baselineVerdict.lostTotal,
							`multiset masks it (text survives on ${targetOccurrences - 1} other components); ` +
								`validator lostTotal rose by ${strippedVerdict.lostTotal - baselineVerdict.lostTotal}`,
						);
						finish(reader);
					},
				);
			},
		);
	});
};

const finish = (reader) => {
	reader.close(() => {
		console.log('');
		console.log(`  RED OBSERVED: ${passCount}    NOT RED: ${failCount}    genuineGap (no lever claimed): ${genuineGapCount}`);
		console.log('');
		process.exit(failCount ? 1 : 0);
	});
};

readStdinJson((stdinError, values) => {
	if (stdinError) {
		console.error(`\n${stdinError}\n`);
		process.exit(1);
	}
	stdinValues = values;
	fs.mkdirSync(stdinValues.scratchDirPath, { recursive: true });
	runVerdictShapeLevers();
});
