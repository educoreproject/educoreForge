'use strict';

/** @implements {ForgerComponent} — formal contract declared in apps/graph-builder/interfaces.js
 *  (ForgeSpec/ForgeReport/GraphHandle typedefs there); conformance enforced by test-interfaces. */

// forger — run ONE standard's forge bundle and hand back what it produced. In-process module of
// graphBuilder; async callback style (err-string first, no async/await, no try/catch for
// control flow).
//
// IT DOES NOT WRITE TO A GRAPH, and this is the point (targetArchitectureDesign §4.1). Exactly
// three things touch a graph — replayManager owns it, bridgeMaker works over it, and the forger
// is not one of them. Its job is to resolve WHICH forge bundle answers to a standard, wire the
// bundle's embedder, run it, and translate the result to engine shape. The orchestrator then
// hands that to replayManager.init.
//
//   forger() -> { forge(spec, callback) }
//
//     spec = {
//       standard                   token, e.g. 'lif' (resolves forges/<standard>/)
//       version                    REQUIRED recipe version token. Reported back as
//                                  requestedVersion, kept DISTINCT from what the bundle stamped;
//                                  it never stands in for the bundle's own version claim.
//       source?                    path to source data; default = the bundle's own asset
//       owner?                     ownerStamp pass-through (default ':golden', incumbent-faithful)
//       vectorize                  REQUIRED, boolean, NO DEFAULT. The SPEND KNOB: true forges
//                                  with real Voyage embeddings and spends credit; false skips the
//                                  embedding pass entirely and constructs no client at all. A
//                                  spec that does not say is REFUSED — 'I did not say' is not
//                                  'yes, bill me' — and a string ('false' is truthy!), a number
//                                  or null are refused rather than guessed at.
//       embedNodeLimit?            embed only the first N nodes (spend bound for smoke runs)
//       embeddingConfigFilePath?   override the Voyage ini; an active override is ANNOUNCED on
//                                  stderr so it can never silently redirect embedding credentials
//     }
//
//     callback('', { standard, version, bundleVersion, requestedVersion, nodeEdges, nodeCount,
//                    edgeCount, embedCallCount })
//       bundleVersion    what the BUNDLE read out of the source document ('unknown' is its own
//                        honest word for a source that does not self-describe, not an absence)
//       requestedVersion the token the RECIPE asked for. Two provenance claims, two fields; a
//                        bundle that stamps NOTHING is refused rather than lent the recipe's token.
//       version          === bundleVersion, kept for callers that read it.
//
//     nodeEdges = { nodes, edges, embeddingDims } in ENGINE shape, ready for replayManager.init.
//
// SEAM (targetArchitectureDesign §4):
//     const nodeEdges = thisStandard.forge();
//     replayManager.init({ inGraph: workingGraph, nodeEdges, applyLabels: [BASE_GRAPH_LABEL] });
//
// WHERE THE SAFETY GUARD WENT. The forger used to carry its own DEV_*-only destination refusal.
// It no longer has a destination to refuse, so the guard MOVED rather than vanished: every write
// now goes through replayManager.init, whose nameRefusal refuses GOLD_*, gf_* and any non-DEV_*
// name before a connection is attempted, and which is gated in test-replay-manager. One write
// path means one place to hold the line, which is stronger than two places that might disagree —
// but it is only stronger if the remaining one is actually proven, so it is.
//
// The deliberate CONTRAST with the incumbent forger app (cli/lib.d/forger): no forge-store, no
// vector-store cache (TQ 2026-07-21: real Voyage, no cache — "Voyage is very cheap"), no
// credential registry, no instance-lifecycle, no provisioning, and now no writing.
//
// SECRET: the Voyage key is read ONLY by the embedding-client from voyageEmbedding.ini; it is
// never on the command line, in env, logged, or echoed here.

const path = require('path');
const fs = require('fs');

const configFileProcessor = require('qtools-config-file-processor');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const { shapeForgedGraph } = require('./lib/shape-forged-graph');

// tree root (educoreForge/) is four levels up: forger -> apps -> graph-builder -> apps -> root
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const TREE_LIB = path.join(TREE_ROOT, 'lib');
const FORGES_DIR = path.join(TREE_ROOT, 'forges');

const CONFIG_SECTION = 'forger';
const CONFIG_FILE = 'graphBuilder.ini';

// -----
// resolveVoyageConfigPath — the Voyage ini pointer as ONE provable rule: call param (announced by
// the caller) > getConfig('forger').voyageConfigFilePath (graphBuilder.ini). There is NO third
// arm, and this is the whole point of the site: an in-code absolute path used to stand behind the
// settable key, so deleting `voyageConfigFilePath=` sent embedding credentials to a
// machine-specific location that exists on one machine and is wrong on every other — silently.
// polyArch2 §6: a constant that shadows a settable key is the anti-pattern, and a pointer to
// CREDENTIALS is the worst place to keep one, because a wrong-but-silent path means the run
// authenticates as something other than what was configured, or fails far from the cause.
//
// A path that does not EXIST is an invalid value, not an occasion to look elsewhere. It is
// refused naming the path AND the source that supplied it, so the operator knows which line to
// fix rather than which program to read.
//
// Answers { configFilePath } or { error } — the same idiom resolveBundle uses ten lines below,
// because forge() is callback-style and nothing here may throw past it. getConfig is injectable
// for the test suite only; production passes nothing.
//
// THE SECRET IS NOT HERE. This resolves a POINTER; only embedding-client ever opens the file, and
// the key is never read, logged, or returned by this module.
const resolveVoyageConfigPath = ({ paramPath, getConfig = process.global.getConfig } = {}) => {
	const configuredPath = ((getConfig && getConfig(CONFIG_SECTION)) || {}).voyageConfigFilePath;
	const givenPath = paramPath === undefined || paramPath === null ? configuredPath : paramPath;
	const sourceName =
		paramPath === undefined || paramPath === null
			? `[${CONFIG_SECTION}].voyageConfigFilePath in ${CONFIG_FILE}`
			: 'the embeddingConfigFilePath call parameter';

	if (givenPath === undefined || givenPath === null) {
		return {
			error:
				`forger: voyageConfigFilePath is not configured. Add it to the [${CONFIG_SECTION}] ` +
				`section of ${CONFIG_FILE} (or pass embeddingConfigFilePath in the spec). It points ` +
				`at the embedding CREDENTIALS, and there is no default: a path guessed in code is a ` +
				`run authenticating as something nobody chose.`,
		};
	}
	const value = String(givenPath).trim();
	if (value === '') {
		return {
			error:
				`forger: voyageConfigFilePath is present but EMPTY (${sourceName}). A blank pointer ` +
				`is not a pointer; give it a path or the key is a lie.`,
		};
	}
	if (!fs.existsSync(value)) {
		return {
			error:
				`forger: voyageConfigFilePath '${value}' does not exist (${sourceName}). A credential ` +
				`pointer that names no file is an INVALID value, not an occasion to look somewhere ` +
				`else. Nothing was substituted for it.`,
		};
	}
	return { configFilePath: value };
};

// -----
// resolveBundle — forges/<standard>/parserDescriptor.ini is the bundle's self-description
// (discovery pattern, not a registry). Returns { error } or the resolved bundle facts.
const resolveBundle = ({ standard }) => {
	const bundleDir = path.join(FORGES_DIR, String(standard).toLowerCase());
	const descriptorPath = path.join(bundleDir, 'parserDescriptor.ini');
	if (!fs.existsSync(descriptorPath)) {
		const known = fs.existsSync(FORGES_DIR)
			? fs
					.readdirSync(FORGES_DIR, { withFileTypes: true })
					.filter((oneEntry) => oneEntry.isDirectory())
					.map((oneEntry) => oneEntry.name)
					.sort()
					.join(', ')
			: '(none)';
		return {
			error: `forger: no forge bundle for standard '${standard}' (no ${descriptorPath}). Known forges: ${known}`,
		};
	}
	// THE BUNDLE IS ITS OWN REGISTRATION. The central standard-registry was deleted and the
	// [parserDescriptor] section is what replaced it, so an ABSENT section is a bundle that is not
	// registered at all. `.parserDescriptor || {}` used to let it walk on as though it were, and
	// it died two lines later blaming a missing entryModule — a disguise, because the operator has
	// very likely already written that key under a header he forgot or mistyped. CODE FACT:
	// qtools-config-file-processor DISCARDS sectionless keys, so a wrong header makes every key in
	// the file invisible at once. polyArch2 §6: the absence is the error, and it must say what is
	// missing and where it belongs.
	const descriptor = (configFileProcessor.getConfig(descriptorPath) || {}).parserDescriptor;
	if (descriptor === undefined || descriptor === null) {
		return {
			error:
				`forger: forge bundle '${standard}' is NOT REGISTERED — ${descriptorPath} has no ` +
				`[parserDescriptor] section. A forge bundle IS its own registration; that section is ` +
				`the whole of it, and it must declare standardName, entryModule, defaultSnapshot and ` +
				`sourceFile. NOTE: sectionless keys are DISCARDED by the ini reader, so a missing or ` +
				`mistyped [parserDescriptor] header makes every key in the file invisible at once.`,
		};
	}
	if (!Object.keys(descriptor).length) {
		return {
			error:
				`forger: forge bundle '${standard}' REGISTERS NOTHING — [parserDescriptor] in ` +
				`${descriptorPath} is present but empty. A registration that declares nothing is not ` +
				`a registration; it must declare standardName, entryModule, defaultSnapshot and ` +
				`sourceFile.`,
		};
	}
	if (!descriptor.entryModule) {
		return {
			error: `forger: forge bundle '${standard}' declares no entryModule in ${descriptorPath}`,
		};
	}
	// THE DECLARED NAME IS DECLARED. `descriptor.standardName || standard` substituted the
	// lowercase DIRECTORY TOKEN when the key was missing, so deleting `standardName=LIF` turned
	// every report, every block-header naming path and every node description from 'LIF' to 'lif'
	// with nothing said. The descriptor IS the bundle's whole registration, and entryModule two
	// lines above already gets exactly this treatment — one rule for the registration, not two
	// (polyArch2 §6).
	if (
		descriptor.standardName === undefined ||
		descriptor.standardName === null ||
		`${descriptor.standardName}`.trim() === ''
	) {
		return {
			error:
				`forger: forge bundle '${standard}' declares ` +
				`${descriptor.standardName === undefined ? 'no' : 'a BLANK'} standardName in ` +
				`${descriptorPath}. It is the name this standard is CALLED — in reports, in block ` +
				`headers and in node descriptions — and the directory token '${standard}' is not a ` +
				`substitute for it. Add standardName= to the [parserDescriptor] section.`,
		};
	}
	// canonicalize defaultSnapshot against the ENUMERATED snapshot directory names:
	// qtools-config-file-processor coerces `01` to the NUMBER 1 (code fact, same hazard the
	// incumbent standard-discovery documents), so the directory name is authoritative — match
	// numerically, use the canonical name ('01').
	let defaultSource = null;
	if (descriptor.defaultSnapshot !== undefined && descriptor.sourceFile) {
		const snapshotsDir = path.join(bundleDir, 'assets', 'standardSourceData');
		const snapshotDirNames = fs.existsSync(snapshotsDir)
			? fs
					.readdirSync(snapshotsDir, { withFileTypes: true })
					.filter((oneEntry) => oneEntry.isDirectory())
					.map((oneEntry) => oneEntry.name)
			: [];
		const matches = snapshotDirNames.filter(
			(oneName) => Number(oneName) === Number(descriptor.defaultSnapshot),
		);
		if (matches.length !== 1) {
			return {
				error: `forger: ${bundleDir} defaultSnapshot '${descriptor.defaultSnapshot}' matches ${
					matches.length === 0 ? 'no' : 'more than one'
				} snapshot directory (found: ${snapshotDirNames.join(', ') || 'none'})`,
			};
		}
		defaultSource = path.join(snapshotsDir, matches[0], `${descriptor.sourceFile}`);
	}
	return {
		bundleDir,
		standardName: `${descriptor.standardName}`.trim(),
		entryPath: path.join(bundleDir, descriptor.entryModule),
		defaultSource,
	};
};

// -----
// resolveReportedVersion — the two version claims, kept apart.
//
//   resolveReportedVersion({ bundleVersion, requestedVersion })
//       -> { bundleVersion, requestedVersion } | { error }
//
// `version: args.forged.metadata.version || version` collapsed two DIFFERENT provenance claims
// into one field: what the bundle actually READ out of the source document, and the version token
// the RECIPE asked for. A bundle that stamped nothing reported the recipe's token as though the
// bundle had stamped it, and no trace of the substitution survived to say otherwise. Both parsers
// stamp an honest 'unknown' rather than empty, so this arm rarely fires — which is precisely what
// makes it a comfortable place for a lie to live (polyArch2 §6, identity clause).
//
// 'unknown' is NOT the same thing as absent: it is the snapshot-provenance layer's deliberate,
// warned, honest-gap marker, and it passes through as the bundle's own word.
const resolveReportedVersion = ({ bundleVersion, requestedVersion } = {}) => {
	if (bundleVersion === undefined || bundleVersion === null || `${bundleVersion}`.trim() === '') {
		return {
			error:
				`forger: the forge bundle stamped no version in its metadata (requested version ` +
				`token: '${requestedVersion}'). The requested token is what the RECIPE asked for; ` +
				`it is NOT evidence of what the source document says, and it will not be reported ` +
				`as though the bundle had stamped it. A bundle that cannot read a version stamps ` +
				`'unknown' honestly — an empty stamp is a bundle defect.`,
		};
	}
	if (
		requestedVersion === undefined ||
		requestedVersion === null ||
		`${requestedVersion}`.trim() === ''
	) {
		return {
			error:
				`forger: the forge spec names no version token. The requested version is reported ` +
				`alongside the bundle's own stamp so the two provenance claims stay distinct, and ` +
				`there is no default for it.`,
		};
	}
	return {
		bundleVersion: `${bundleVersion}`.trim(),
		requestedVersion: `${requestedVersion}`.trim(),
	};
};

// START OF moduleFunction() ============================================================

const forger = () => {
	const forge = (spec, callback) => {
		const { xLog } = process.global;
		const {
			standard,
			version,
			source,
			owner = ':golden',
			vectorize,
			embedNodeLimit,
			embeddingConfigFilePath,
		} = spec || {};

		// THE SPEND KNOB IS STATED OR THE FORGE DOES NOT START. `vectorize = true` used to sit in
		// this destructure, so a caller that said nothing got real Voyage embeddings and a real
		// bill — and build.js, the ONE production caller, said nothing. Work group 3 made all four
		// entry points REQUIRE --vectorize with no default, on the ground that "I did not say" must
		// never be read as "yes, bill me"; this is the site that ACTS on that word, so the same
		// rule holds here or it holds nowhere. A STRING is refused as loudly as an absence: the old
		// code read vectorize:'false' as truthy and spent, which is §6's worse fault — the caller
		// who typed a value believed it took effect.
		//
		// This is the FIRST thing forge() does. Nothing is resolved, required, or constructed
		// until the money question has an answer, so a refusal can never itself cost anything.
		if (vectorize === undefined) {
			callback(
				`forger: vectorize is not set in the forge spec. It is the SPEND KNOB — true forges ` +
					`with real Voyage embeddings and spends credit, false skips the embedding pass ` +
					`entirely and constructs no client at all — and there is NO DEFAULT, deliberately: ` +
					`'I did not say' must never be read as 'yes, bill me'. Pass vectorize: true or ` +
					`vectorize: false.`,
			);
			return;
		}
		if (typeof vectorize !== 'boolean') {
			callback(
				`forger: vectorize is ${
					typeof vectorize === 'string' ? `'${vectorize}' (a string)` : JSON.stringify(vectorize)
				}, which is not a boolean. It is the SPEND KNOB and there is NO DEFAULT. Pass the ` +
					`boolean true or the boolean false — a string, a number and null are REFUSED rather ` +
					`than guessed at, because 'false' is truthy and would have spent your money.`,
			);
			return;
		}

		const resolved = resolveBundle({ standard });
		if (resolved.error) {
			callback(resolved.error);
			return;
		}
		const sourcePath = source || resolved.defaultSource;
		if (!sourcePath) {
			callback(
				`forger: standard '${standard}' has no bundled default source and none was given`,
			);
			return;
		}

		// the vectorizer seam: OUR name for the capability is vectorizer; the copied bundles take
		// the dependency as { embedder } (byte-faithful port). vectorize:false is the spend knob —
		// no Voyage client is constructed at all, and the bundle runs skipEmbedding.
		//
		// Voyage config path precedence: call param (announced — it can never silently redirect
		// embedding credentials) > getConfig('forger').voyageConfigFilePath (graphBuilder.ini).
		// There is no third arm: nothing in code stands behind the key any more, and a path that
		// names no file is refused rather than replaced (polyArch2 §6). The SECRET stays in its
		// own ini either way; only the POINTER is configurable.
		//
		// declaredEmbeddingDims comes from the SAME ini reading that governs the API call, so the
		// width the shaper checks against is the width the vectors were actually made at. There is
		// no in-code width standing in for it any more (polyArch2 §6).
		let embedder = null;
		let declaredEmbeddingDims;
		if (vectorize) {
			if (embeddingConfigFilePath) {
				console.error(
					`EMBEDDING CONFIG OVERRIDE ACTIVE: configFilePath = ${embeddingConfigFilePath} (embeddingConfigFilePath)`,
				);
			}
			const voyagePointer = resolveVoyageConfigPath({ paramPath: embeddingConfigFilePath });
			if (voyagePointer.error) {
				callback(voyagePointer.error);
				return;
			}
			embedder = require(path.join(TREE_LIB, 'embedding', 'embedding-client'))({
				configFilePath: voyagePointer.configFilePath,
			});
			declaredEmbeddingDims = embedder.resolveEmbeddingIdentity().embeddingDims;
		}

		const bundle = require(resolved.entryPath)({ embedder });

		const taskList = new taskListPlus();

		// run the forge bundle: parse -> contract graph -> (embed)
		taskList.push((args, next) => {
			xLog.status(
				`[forger] forging ${resolved.standardName} from ${path.basename(sourcePath)}${
					vectorize ? '' : ' (vectorize OFF)'
				}`,
			);
			bundle.forge(
				{ sourcePath, owner, embedNodeLimit, skipEmbedding: !vectorize },
				(err, forged) => {
					if (err) {
						next(`forger: forge of '${standard}' failed: ${err}`);
						return;
					}
					xLog.status(
						`[forger] forged ${forged.nodes.length} nodes, ${forged.edges.length} edges (${forged.embedCallCount} embedding calls)`,
					);
					next('', { ...args, forged });
				},
			);
		});

		// translate the bundle's output to ENGINE shape. This is where the deleted transport used
		// to be: the forger serialized a schema block and handed it to replay(), which immediately
		// deserialized it — objects -> string -> objects, to reach the only writer that existed.
		// replayManager.init takes objects, so the round trip is gone and a schema block is now
		// born in exactly one place: harvest.
		taskList.push((args, next) => {
			const shaped = shapeForgedGraph({ forged: args.forged, declaredEmbeddingDims });
			if (shaped.error) {
				next(`forger: ${shaped.error}`);
				return;
			}
			xLog.status(
				`[forger] shaped ${shaped.nodes.length} nodes, ${shaped.edges.length} edges for loading`,
			);
			next('', { ...args, shaped });
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				callback(err);
				return;
			}
			// THE TWO VERSION CLAIMS ARE REPORTED SEPARATELY. `metadata.version || version` used to
			// merge them, so a bundle that stamped nothing reported the recipe's token as its own.
			const versions = resolveReportedVersion({
				bundleVersion: args.forged.metadata.version,
				requestedVersion: version,
			});
			if (versions.error) {
				callback(versions.error);
				return;
			}
			callback('', {
				standard: resolved.standardName,
				version: versions.bundleVersion,
				bundleVersion: versions.bundleVersion,
				requestedVersion: versions.requestedVersion,
				nodeEdges: args.shaped,
				nodeCount: args.shaped.nodes.length,
				edgeCount: args.shaped.edges.length,
				embedCallCount: args.forged.embedCallCount,
			});
		});
	};

	return { forge };
};

// END OF moduleFunction() ============================================================

module.exports = forger;
module.exports.resolveBundle = resolveBundle;
module.exports.resolveVoyageConfigPath = resolveVoyageConfigPath;
module.exports.resolveReportedVersion = resolveReportedVersion;
