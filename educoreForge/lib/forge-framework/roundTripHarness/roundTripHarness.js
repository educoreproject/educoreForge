'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripHarness.js — the round-trip harness CONTRACT (SPEC-forgeFramework-v1.md §3.3 harness
// table, §6.6, §10 G-RT; Profile §8; D8: contract + refusals + assembler + double + twin registry in
// v1; per-forge diffs run BEHIND it; the four diff engines' consolidation is deferred).
//
//   const { validatorFrom, graphDoubleFrom } = require('<lib>/forge-framework/roundTripHarness/roundTripHarness')({ xLog? });
//
// A SEPARATE module from the forge-time framework object, required DIRECTLY by a bundle's
// roundTripValidator.js and NEVER by an entry module or a hook (FR15) — holding the framework gives
// nothing that opens a bolt session; only this module reaches graphReader.js.
//
//   validatorFrom({ forgeDeclaration, canonicalizeSource, emitFromGraph, semanticValidationLimit,
//                   verdictVersion, extraVerdictFieldList?, diffStatements?, gateDeclarationList?, twinRegistry? })
//     → { validate, validateWithReader }
//   validate({ containerName, boltUrl, user, password, snapshotPath, outputPath }, cb)   the uniform
//     stage contract (round-trip-stage.js:490-498); opens the bolt reader, runs validateWithReader, closes.
//   validateWithReader({ reader, snapshotPath, outputPath, graphIdentity? }, cb)   the seam every twin
//     drives: intake (verifySnapshotChecksums over the snapshot), canonicalizeSource, emitFromGraph over
//     `reader`, verdict assembly (A13 identity, lostCategory, A8 census), write, callback('', verdict).
//   graphDoubleFrom({ forgeResult }) → { readAll, close }   the ONE Docker-free graph double (R5) built
//     from a forge result, exposing the SAME GraphReader contract as graphReader.js.
//
// Refuses by name: a validator declaring no/blank semanticValidationLimit; an absent outputPath (E1
// cannot recur); an emitter that is not callback-shaped (E3 cannot recur) — arity 2 at construction and
// a synchronous return value at run time; a verdict missing a normative field / a lostCategory / a
// finite count (verdictAssembler); an emission fault ({ fault }) is FATAL.
//
// Callback error-first; taskListPlus/pipeRunner; the ONLY Promise handling is in graphReader.js.
// Wall-clock and memory are the A8 census (Profile §8.6) — this module is NOT the pure layer and is
// outside G-DET's no-clock grep by the §12.1 module boundary.

const fs = require('fs');
const path = require('path');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const sourceVerificationLib = require(path.join(__dirname, '..', 'sourceVerification'));
const verdictAssemblerLib = require('./verdictAssembler');
const graphReaderLib = require('./graphReader');
const twinRegistryLib = require('./twinRegistry');
const gateEvaluatorLib = require('./gateEvaluator');

const VERDICT_FILE_NAME = 'roundTripVerdict.json'; // === round-trip-stage.js:92

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const moduleFunction =
	({ moduleName } = {}) =>
	({ xLog } = {}) => {
		const log = xLog !== undefined ? xLog : process.global && process.global.xLog;
		if (!log || typeof log.status !== 'function') {
			throw new Error(`${moduleName} REFUSED: xLog is available neither as a dep nor as process.global.xLog — no do-nothing logger is manufactured`);
		}

		// -----------------------------------------------------------------
		// graphDoubleFrom — the Docker-free double; the same GraphReader contract as graphReader.js
		// -----------------------------------------------------------------
		const graphDoubleFrom = ({ forgeResult } = {}) => {
			if (!forgeResult || !Array.isArray(forgeResult.nodes) || !Array.isArray(forgeResult.edges)) {
				throw new Error(`${moduleName} REFUSED: graphDoubleFrom needs a forgeResult with nodes[] and edges[] — there is no default graph`);
			}
			const readAll = (callback) => {
				const nodes = forgeResult.nodes.map((oneNode) => {
					// the materialized graph carries the forge properties plus the engine's canonical
					// `stableId`; the vector is not a statement and is not read (RT-4: Layer 1)
					const properties = {};
					Object.keys(oneNode.properties).forEach((oneName) => {
						if (oneName === 'embedding') {
							return;
						}
						properties[oneName] = oneNode.properties[oneName];
					});
					properties.stableId = oneNode.stableId;
					return { stableId: oneNode.stableId, labels: oneNode.labels.slice(), role: oneNode.role, properties };
				});
				const edges = forgeResult.edges.map((oneEdge) => ({
					type: oneEdge.type,
					fromStableId: oneEdge.fromRef.id,
					toStableId: oneEdge.toRef.id,
					properties: { ...oneEdge.properties },
				}));
				callback('', { nodes, edges });
			};
			const close = (callback) => callback('');
			return { readAll, close };
		};

		// -----------------------------------------------------------------
		// validatorFrom
		// -----------------------------------------------------------------
		const validatorFrom = ({
			forgeDeclaration,
			canonicalizeSource,
			emitFromGraph,
			semanticValidationLimit,
			verdictVersion,
			extraVerdictFieldList,
			diffStatements,
			gateDeclarationList,
			twinRegistry,
		} = {}) => {
			if (!isPlainObject(forgeDeclaration) || typeof forgeDeclaration.standardKey !== 'string' || typeof forgeDeclaration.standardSource !== 'string') {
				throw new Error(`${moduleName} REFUSED: validatorFrom needs the bundle's forgeDeclaration (standardKey, standardSource) — the SAME object the entry module uses`);
			}
			if (typeof canonicalizeSource !== 'function' || canonicalizeSource.length !== 2) {
				throw new Error(`${moduleName} REFUSED: forge-${forgeDeclaration.standardKey} canonicalizeSource must be canonicalizeSource({ snapshotPath, verifiedFileList }, callback) — arity 2, callback-shaped (RT-8)`);
			}
			if (typeof emitFromGraph !== 'function' || emitFromGraph.length !== 2) {
				throw new Error(`${moduleName} REFUSED: forge-${forgeDeclaration.standardKey} emitFromGraph must be emitFromGraph({ reader }, callback) — arity 2, callback-shaped; a synchronous emitter is refused (E3)`);
			}
			if (typeof semanticValidationLimit !== 'string' || semanticValidationLimit.trim().length === 0) {
				throw new Error(`${moduleName} REFUSED: forge-${forgeDeclaration.standardKey} declares no semanticValidationLimit — a validator MUST state what the round trip models and does not model (Profile §8.4)`);
			}
			if (typeof verdictVersion !== 'string' || verdictVersion.length === 0) {
				throw new Error(`${moduleName} REFUSED: forge-${forgeDeclaration.standardKey} declares no verdictVersion (R9)`);
			}
			if (diffStatements !== undefined && (typeof diffStatements !== 'function' || diffStatements.length !== 2)) {
				throw new Error(`${moduleName} REFUSED: forge-${forgeDeclaration.standardKey} diffStatements must be diffStatements({ sourceStatements, graphStatements }, callback) — arity 2`);
			}
			if (gateDeclarationList !== undefined) {
				const gateError = gateEvaluatorLib.validateGateDeclarationList(gateDeclarationList);
				if (gateError) {
					throw new Error(gateError);
				}
			}
			const validatorPrefix = `forge-${forgeDeclaration.standardKey} roundTrip`;

			const validateWithReader = ({ reader, snapshotPath, outputPath, graphIdentity } = {}, callback) => {
				if (typeof callback !== 'function') {
					throw new Error(`${moduleName} REFUSED: validateWithReader needs a callback`);
				}
				if (!reader || typeof reader.readAll !== 'function' || typeof reader.close !== 'function') {
					callback(`${validatorPrefix} REFUSED: reader must expose readAll(cb) and close(cb) (the GraphReader contract)`);
					return;
				}
				if (typeof outputPath !== 'string' || outputPath.length === 0) {
					callback(`${validatorPrefix} REFUSED: outputPath is absent — a verdict MUST NOT be producible with nothing on disk (Profile §8.1; E1)`);
					return;
				}
				if (typeof snapshotPath !== 'string' || snapshotPath.length === 0) {
					callback(`${validatorPrefix} REFUSED: snapshotPath is absent — the source bytes enter once, as the answer key (RT-5)`);
					return;
				}
				const startedAtMs = Date.now();
				let peakMemoryBytes = process.memoryUsage().rss;
				const sampleMemory = () => {
					peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);
				};
				const taskList = new taskListPlus();

				// intake — every listed file of the snapshot verified against SHA256SUMS
				taskList.push((args, next) => {
					const snapshotDirPath = fs.existsSync(snapshotPath) && fs.statSync(snapshotPath).isDirectory() ? snapshotPath : path.dirname(snapshotPath);
					sourceVerificationLib.verifySnapshotChecksums({ snapshotDirPath }, (verifyError, verified) => {
						if (verifyError) {
							next(`${validatorPrefix} intake: ${verifyError}`);
							return;
						}
						next('', { ...args, snapshotDirPath, verifiedFileList: verified.verifiedFileList });
					});
				});

				// source side — the canonicalizer never opens the graph
				taskList.push((args, next) => {
					canonicalizeSource({ snapshotPath, verifiedFileList: args.verifiedFileList }, (canonicalError, canonical) => {
						if (canonicalError) {
							next(`${validatorPrefix} canonicalizeSource: ${canonicalError}`);
							return;
						}
						if (!canonical || !(canonical.statements instanceof Map)) {
							next(`${validatorPrefix} REFUSED: canonicalizeSource must return { statements: Map, stats }`);
							return;
						}
						sampleMemory();
						next('', { ...args, sourceStatements: canonical.statements, sourceStats: canonical.stats === undefined ? {} : canonical.stats });
					});
				});

				// graph side — the emitter never opens a source file; a fault is FATAL; a synchronous
				// return value is refused (E3)
				taskList.push((args, next) => {
					let calledBack = false;
					const returnedValue = emitFromGraph({ reader, graphIdentity }, (emitError, emitted) => {
						calledBack = true;
						if (emitError) {
							next(`${validatorPrefix} emitFromGraph: ${emitError}`);
							return;
						}
						if (emitted && emitted.fault !== undefined) {
							next(`${validatorPrefix} emitFromGraph reported an emission FAULT (fatal): ${typeof emitted.fault === 'string' ? emitted.fault : JSON.stringify(emitted.fault)}`);
							return;
						}
						if (!emitted || !(emitted.statements instanceof Map)) {
							next(`${validatorPrefix} REFUSED: emitFromGraph must call back with { statements: Map, stats } | { fault }`);
							return;
						}
						sampleMemory();
						next('', { ...args, graphStatements: emitted.statements, graphStats: emitted.stats === undefined ? {} : emitted.stats });
					});
					if (returnedValue !== undefined && !calledBack) {
						next(`${validatorPrefix} REFUSED: emitFromGraph RETURNED a value synchronously instead of calling back — a synchronous emitter is refused (E3, RT-8)`);
					}
				});

				// diff — the forge's own engine when declared, else the harness's set difference
				taskList.push((args, next) => {
					if (diffStatements === undefined) {
						next('', { ...args, diffResult: undefined });
						return;
					}
					diffStatements({ sourceStatements: args.sourceStatements, graphStatements: args.graphStatements }, (diffError, diffResult) => {
						if (diffError) {
							next(`${validatorPrefix} diffStatements: ${diffError}`);
							return;
						}
						next('', { ...args, diffResult });
					});
				});

				// assemble + write
				taskList.push((args, next) => {
					sampleMemory();
					const assembled = verdictAssemblerLib.assembleVerdict({
						verdictVersion,
						semanticValidationLimit,
						sourceStatements: args.sourceStatements,
						graphStatements: args.graphStatements,
						diffResult: args.diffResult,
						wallClockMs: Date.now() - startedAtMs,
						peakMemoryBytes,
						sourceStats: args.sourceStats,
						graphStats: args.graphStats,
						extraFields: { standardKey: forgeDeclaration.standardKey, standardSource: forgeDeclaration.standardSource, snapshotPath, ...(graphIdentity === undefined ? {} : { graphIdentity }) },
						extraVerdictFieldList,
					});
					if (assembled.error) {
						next(`${validatorPrefix}: ${assembled.error}`);
						return;
					}
					fs.mkdirSync(outputPath, { recursive: true });
					const verdictFilePath = path.join(outputPath, VERDICT_FILE_NAME);
					fs.writeFileSync(verdictFilePath, JSON.stringify(assembled.verdict, null, 2));
					log.status(`[${validatorPrefix}] inventedTotal=${assembled.verdict.inventedTotal} lostTotal=${assembled.verdict.lostTotal} (contentGap ${assembled.verdict.contentGapTotal}, explicitlyOmitted ${assembled.verdict.explicitlyOmittedTotal}) roundTripClean=${assembled.verdict.roundTripClean} -> ${verdictFilePath}`);
					next('', { ...args, verdict: assembled.verdict, verdictFilePath });
				});

				pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
					if (pipelineError) {
						callback(pipelineError);
						return;
					}
					callback('', args.verdict);
				});
			};

			const validate = ({ containerName, boltUrl, user, password, snapshotPath, outputPath } = {}, callback) => {
				graphReaderLib.openGraphReader({ boltUrl, user, password, standardSource: forgeDeclaration.standardSource }, (openError, reader) => {
					if (openError) {
						callback(`${validatorPrefix}: ${openError}`);
						return;
					}
					validateWithReader({ reader, snapshotPath, outputPath, graphIdentity: { containerName, boltUrl } }, (validateError, verdict) => {
						reader.close((closeError) => {
							if (validateError) {
								callback(validateError);
								return;
							}
							if (closeError) {
								callback(`${validatorPrefix}: ${closeError}`);
								return;
							}
							callback('', verdict);
						});
					});
				});
			};

			return {
				validate,
				validateWithReader,
				semanticValidationLimit,
				verdictVersion,
				gateDeclarationList,
				twinRegistry,
			};
		};

		return {
			validatorFrom,
			graphDoubleFrom,
			makeTwinRegistry: twinRegistryLib.makeTwinRegistry,
			evaluateGates: gateEvaluatorLib.evaluateGates,
			sweepTwins: gateEvaluatorLib.sweepTwins,
			verifyVerdictShape: verdictAssemblerLib.verifyVerdictShape,
			VERDICT_FILE_NAME,
		};
	};

module.exports = moduleFunction({ moduleName });
