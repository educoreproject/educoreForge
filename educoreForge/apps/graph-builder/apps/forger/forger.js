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
//       deriveHub?                 OPTIONAL boolean, default false — the HUB-FOLD SIGNAL (new
//                                  design 2026-07-24). When true, the forger DERIVES this standard's
//                                  hub from the base nodeEdges it just produced and FOLDS the hub
//                                  nodes/edges INTO the nodeEdges it returns, so ONE block per
//                                  standard already carries its hub. build.js reads recipe.hubs and
//                                  sets it. A standard DECLARED a hub (deriveHub true) with no entry
//                                  in HUB_FORGE_BY_STANDARD is REFUSED BY NAME (no silent default);
//                                  a standard that is not a hub (the default) returns base-only.
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

const { shapeForgedGraph } = require('./lib/shape-forged-graph')();

// tree root (educoreForge/) is four levels up: forger -> apps -> graph-builder -> apps -> root
const TREE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const TREE_LIB = path.join(TREE_ROOT, 'lib');
const FORGES_DIR = path.join(TREE_ROOT, 'forges');

// the vocabulary's declared label names — the hub embed pass selects HubReference cards by the
// SAME registry every producer stamps from, never a re-typed string.
const { EQUIVALENCE_NODE_LABELS } = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));

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
		// KNOWN FORGES — a forge BUNDLE is one carrying its own parserDescriptor.ini (the bundle IS its
		// own registration, per the comment above); forges/ ALSO holds non-bundle scopes that are not
		// standards at all (forges/bridges/, the forges-shared BRIDGE scope bridgeMaker's directory
		// search path resolves against — bridgeKitRefactor_072726 Phase 2) and stray files (README.md).
		// Filtering to "carries parserDescriptor.ini" is what keeps a directory like that from being
		// listed as a forgeable standard it never claimed to be.
		const known = fs.existsSync(FORGES_DIR)
			? fs
					.readdirSync(FORGES_DIR, { withFileTypes: true })
					.filter((oneEntry) => oneEntry.isDirectory())
					.map((oneEntry) => oneEntry.name)
					.filter((oneName) => fs.existsSync(path.join(FORGES_DIR, oneName, 'parserDescriptor.ini')))
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
	// snapshotDirPath — the pinned snapshot VERSION DIRECTORY itself (RT-13, forge-edfi Phase 4).
	// Distinct from defaultSource: a single-file bundle's defaultSource is a FILE inside this
	// directory, but a roundTripValidator's answer key is always the directory (both live
	// validators demand it — pesc's header names it explicitly; edfi's intake checksum-verifies
	// the directory's SHA256SUMS). null when the bundle pins no defaultSnapshot.
	let snapshotDirPath = null;
	if (descriptor.defaultSnapshot !== undefined) {
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
		const snapshotDir = path.join(snapshotsDir, matches[0]);
		snapshotDirPath = snapshotDir;
		// sourceFile is OPTIONAL. A single-file parser names its file (sourceFile=ctdlasn.json) and gets
		// that file. A DIRECTORY-source parser (a multi-file standard: medbiquitous XSD/WSDL set, jedx
		// CSV tables, pesc XSD set, the CSV/TSV crosswalk standards) OMITS sourceFile and gets the
		// snapshot DIRECTORY, which is what its parser demands ("--source must be the version directory").
		// Single-file behavior is unchanged: sourceFile present -> the same file path as before.
		defaultSource = descriptor.sourceFile
			? path.join(snapshotDir, `${descriptor.sourceFile}`)
			: snapshotDir;
	}
	return {
		bundleDir,
		standardName: `${descriptor.standardName}`.trim(),
		entryPath: path.join(bundleDir, descriptor.entryModule),
		defaultSource,
		// RT-13 (forge-edfi Phase 4) — ADDITIVE facts for the round-trip stage. Existing callers
		// destructure only the four keys above; these are read solely by the stage's roster
		// composer (apps/graph-builder/lib/round-trip-stage.js).
		snapshotDirPath,
		// the roundTripValidator DECLARATION, verbatim (doctrine RT-13.1: declared, not sniffed).
		// undefined when the bundle declares none — resolveBundle stays a pure descriptor reader;
		// integrity enforcement (exists / loads / exports validate — the RT-13.3 refusal) belongs
		// to the roster composer, which is where a blank declared value is also refused by name.
		roundTripValidatorFileName: descriptor.roundTripValidator,
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

// -----
// HUB FORGE REGISTRY (registry-over-switch; polyArch2 §7) — the per-standard hub derivation,
// keyed by the LOWERCASE standard token. A standard DECLARED a hub (spec.deriveHub) resolves its
// row here; a standard declared a hub with NO registered derivation is REFUSED BY NAME in
// foldHubIntoNodeEdges (no silent default — a hub we cannot derive is a recipe error, not a
// zero-reference hub). ceds is the only hub derivation today; a second hub is one MORE ROW here,
// never a branch to edit.
//
// Each row is { hubForgeFactory, hubNamespace } (hubReimplementation Phase 2):
//   hubForgeFactory  ({ hubVersion, hubNamespace }) -> { forgeHub } — forgeHub is R7
//                    error-first callback-shaped: forgeHub(baseNodeEdges, callback) with
//                    callback(errString, { nodes, edges, divergenceReport, skipReport, counts })
//   hubNamespace     the ONE DECLARED HOME of this hub's URI root (SPEC §2). Every card uri and
//                    the HubDefinition.namespace are minted FROM this value, which flows through
//                    the factory argument — the module holds no literal, and neither may any
//                    other site. A second occurrence of this URL anywhere in the tree is a defect.
const HUB_FORGE_BY_STANDARD = {
	ceds: {
		hubForgeFactory: require(path.join(FORGES_DIR, 'ceds', 'lib', 'cedsHubForge')),
		hubNamespace: 'https://w3id.org/EDUcore/CEDStandards/hub/',
	},
};

// -----
// HUB_EMBED_BATCH_SIZE — voyage batch ceiling headroom, the same bound the forge bundles use for
// their base-node embedding pass (forgeCeds EMBED_BATCH_SIZE precedent). Bounds per-call payload;
// serial batches keep memory and rate in check.
const HUB_EMBED_BATCH_SIZE = 128;

// -----
// embedHubReferenceCards — the hub-card embedding pass (hubReimplementation Phase 2, SPEC §1.5/§3).
// Every HubReference card carries embedText composed by the forge; a VECTORIZED build stamps
// embedding + embeddingModelVersion on each card through the SAME embedding-client the base pass
// used (shared content-addressed vector cache, so a repeat build is cache-served and spends
// nothing). The HubDefinition is not a card and is not embedded.
//
// embedder ABSENT means --vectorize=false: the spend knob is off, cards carry embedText only and
// no vector — exactly as the base nodes do on that path (SPEC §3: gates report the vector gate
// UNMEASURED, never silently pass). embedder PRESENT with a card missing embedText is a REFUSAL
// BY NAME: a card that cannot be embedded is never quietly skipped (no silent substitution).
//
//   embedHubReferenceCards({ hubNodes, embedder }, callback)
//     -> callback(errString, { embeddedCardCount, vectorized })
const embedHubReferenceCards = ({ hubNodes, embedder }, callback) => {
	if (!embedder) {
		callback('', { embeddedCardCount: 0, vectorized: false });
		return;
	}
	const hubReferenceCards = hubNodes.filter(
		(oneNode) => oneNode.role === EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
	);
	if (!hubReferenceCards.length) {
		callback('', { embeddedCardCount: 0, vectorized: true });
		return;
	}
	const cardsMissingEmbedText = hubReferenceCards.filter((oneCard) => {
		const embedTextValue = oneCard.properties.embedText;
		return typeof embedTextValue !== 'string' || embedTextValue.trim() === '';
	});
	if (cardsMissingEmbedText.length) {
		callback(
			`forger: ${cardsMissingEmbedText.length} HubReference card(s) carry no embedText ` +
				`(first: '${cardsMissingEmbedText[0].stableId}'). A card with nothing to embed is ` +
				`refused, not quietly skipped — the forge composes embedText on every card (G-6).`,
		);
		return;
	}

	const batches = [];
	for (
		let batchStart = 0;
		batchStart < hubReferenceCards.length;
		batchStart += HUB_EMBED_BATCH_SIZE
	) {
		batches.push(hubReferenceCards.slice(batchStart, batchStart + HUB_EMBED_BATCH_SIZE));
	}

	const taskList = new taskListPlus();
	batches.forEach((oneBatch, batchIndex) => {
		taskList.push((args, next) => {
			embedder.embedTexts(
				{ texts: oneBatch.map((oneCard) => oneCard.properties.embedText) },
				(embedError, embedResult) => {
					if (embedError) {
						next(
							`forger: hub card embedding batch ${batchIndex + 1}/${batches.length} ` +
								`failed: ${embedError}`,
						);
						return;
					}
					oneBatch.forEach((oneCard, cardIndex) => {
						oneCard.properties.embedding = Array.from(embedResult.vectors[cardIndex]);
						oneCard.properties.embeddingModelVersion = embedResult.embeddingModelVersion;
						// ⟪R-P2-2⟫ the card DECLARES its embed input per node record: harvest's
						// sidecar computes embeddingRef from the declared property (cards embed
						// their composed embedText, SPEC §4/§1.5), while undeclared records — the
						// base nodes — keep the original searchText addressing exactly.
						oneCard.properties.embedSourceProperty = 'embedText';
					});
					next('', args);
				},
			);
		});
	});
	pipeRunner(taskList.getList(), {}, (pipeError) => {
		if (pipeError) {
			callback(pipeError);
			return;
		}
		callback('', { embeddedCardCount: hubReferenceCards.length, vectorized: true });
	});
};

// -----
// foldHubIntoNodeEdges — the NEW-DESIGN (TQ 2026-07-24) hub seam, callback-shaped since the
// hubReimplementation Phase 2 flip (R7: the hub module's forgeHub is error-first callback-shaped,
// and the vectorized fold performs real embedding I/O). DERIVE this standard's hub from the base
// nodeEdges just shaped, EMBED its cards (vectorized builds), and FOLD its nodes/edges into the
// SAME nodeEdges, so ONE block per standard carries its hub (no separate hub block, no separate
// harvest, no change to the graph engine). Called by forge() ONLY when the recipe declares the
// standard a hub.
//
//   foldHubIntoNodeEdges(
//       { standard, bundleVersion, requestedVersion, baseNodeEdges, declaredEmbeddingDims, embedder },
//       callback,
//   )
//     -> callback(errString, { nodeEdges: { nodes, edges, embeddingDims },
//                              hubDivergenceReport, hubSkipReport, hubCounts,
//                              hubEmbeddedCardCount })
//
//   embedder — the SAME embedding-client instance the base pass used (shared vector cache), or
//              null on --vectorize=false, in which case cards carry embedText and no vector.
//   hubDivergenceReport / hubSkipReport — the forge module's §5 prose-divergence rows and S-3
//              zero-domain skip rows, carried up for the build orchestrator to WRITE (the fold
//              does no report I/O; build.js owns the build's log directory).
//
// THE HUB IS STAMPED WITH THE BUNDLE'S REAL VERSION, NEVER THE RECIPE TOKEN. hubVersion folds into
// every hub addressSignature and the base nodes carry metadata.version; if the hub took the recipe
// token ('current') instead of what the bundle READ ('14.0.0.0'), base and hub would
// address-DIVERGE though the structure is identical — the golden-diff defect (2026-07-24). So this
// seam takes the TWO version claims and resolves the real one through resolveReportedVersion — the
// SAME validated reading forge() reports with — which refuses when the bundle stamped no real
// version, so a placeholder can never reach a content address (polyArch2 §6, identity clause).
//
// forgeHub reads the forger's ENGINE-SHAPE nodeEdges DIRECTLY (verified, PLAN §7): its v1() unwraps
// scalar-OR-single-element-array, and engine-shape nodes carry stableId + PG-JSON-array properties
// while engine-shape edges carry type + fromRef.id + toRef.id — exactly the fields forgeHub reads.
// No adapter is required.
//
// forgeHub returns the derived hub in PRODUCER shape ({labels, stableId, role, scalar properties});
// shapeForgedGraph — the forger's OWN producer->engine translator — turns those into engine shape
// ({ref, PG-JSON-array properties}, embedding lifted top-level and width-checked against
// declaredEmbeddingDims) so they concatenate onto the base cleanly. The hub's HAS_CEDS_* edges
// reference base-node stableIds that are present in the same combined nodeEdges, so once build.js
// loads this under [StandardBase] the edges resolve WITHIN one block.
const foldHubIntoNodeEdges = (
	{
		standard,
		bundleVersion,
		requestedVersion,
		baseNodeEdges,
		declaredEmbeddingDims,
		embedder,
	},
	callback,
) => {
	const hubForgeRow = HUB_FORGE_BY_STANDARD[String(standard).toLowerCase()];
	if (!hubForgeRow) {
		const known = Object.keys(HUB_FORGE_BY_STANDARD).join(', ') || '(none)';
		callback(
			`forger: standard '${standard}' is declared a hub but has no registered hub forge — ` +
				`known hub forges: ${known}. A hub declared for a standard with no derivation is a ` +
				`recipe error; nothing was substituted.`,
		);
		return;
	}

	const versions = resolveReportedVersion({ bundleVersion, requestedVersion });
	if (versions.error) {
		callback(versions.error);
		return;
	}
	const hubVersion = versions.bundleVersion;

	// CONSTRUCT the hub forge. The factory refuses an absent/empty hubVersion or hubNamespace by
	// THROW (its documented contract); contain that throw at this one boundary and route it
	// error-first — boundary containment, not control flow.
	let hubForge;
	try {
		hubForge = hubForgeRow.hubForgeFactory({
			hubVersion,
			hubNamespace: hubForgeRow.hubNamespace,
		});
	} catch (factoryError) {
		callback(
			`forger: hub forge factory for '${standard}' refused: ${factoryError.message}`,
		);
		return;
	}

	hubForge.forgeHub(baseNodeEdges, (forgeHubError, hubSubgraph) => {
		if (forgeHubError) {
			callback(`forger: forgeHub for '${standard}' failed: ${forgeHubError}`);
			return;
		}

		// EMBED the cards (vectorized builds; the spend is cache-served on every repeat build)
		embedHubReferenceCards(
			{ hubNodes: hubSubgraph.nodes, embedder },
			(embedError, embedOutcome) => {
				if (embedError) {
					callback(embedError);
					return;
				}

				// SHAPE the derived hub (producer -> engine) with the forger's OWN translator; on a
				// vectorized fold the shaper lifts each card's embedding top-level and enforces the
				// declared width, exactly as it does for base nodes.
				const shapedHub = shapeForgedGraph({ forged: hubSubgraph, declaredEmbeddingDims });
				if (shapedHub.error) {
					callback(`forger: shaping the derived hub for '${standard}': ${shapedHub.error}`);
					return;
				}

				// EMBEDDING DIMS RECONCILIATION — a stated rule, not an identity chain: when BOTH the
				// base and the hub carry vectors their widths must agree (both were checked against the
				// same declaredEmbeddingDims, so disagreement means a shaping fault — refuse loudly);
				// the folded block's width is the base's when the base carries vectors, otherwise the
				// hub's, otherwise null (an un-embedded block).
				const baseEmbeddingDims = baseNodeEdges.embeddingDims;
				const hubEmbeddingDims = shapedHub.embeddingDims;
				if (
					baseEmbeddingDims !== null &&
					baseEmbeddingDims !== undefined &&
					hubEmbeddingDims !== null &&
					baseEmbeddingDims !== hubEmbeddingDims
				) {
					callback(
						`forger: folded hub for '${standard}' carries ${hubEmbeddingDims}-dim vectors ` +
							`but the base block is ${baseEmbeddingDims}-dim. One block, one width; ` +
							`refusing to fold a ragged block.`,
					);
					return;
				}
				const foldedEmbeddingDims =
					baseEmbeddingDims !== null && baseEmbeddingDims !== undefined
						? baseEmbeddingDims
						: hubEmbeddingDims;

				// FOLD: concatenate the shaped hub onto the base. The hub's HAS_CEDS_* edges reference
				// base-node stableIds now sitting in the same nodeEdges, so once loaded under
				// [StandardBase] they resolve within one block.
				callback('', {
					nodeEdges: {
						nodes: baseNodeEdges.nodes.concat(shapedHub.nodes),
						edges: baseNodeEdges.edges.concat(shapedHub.edges),
						embeddingDims: foldedEmbeddingDims,
					},
					hubDivergenceReport: hubSubgraph.divergenceReport,
					hubSkipReport: hubSubgraph.skipReport,
					hubCounts: hubSubgraph.counts,
					hubEmbeddedCardCount: embedOutcome.embeddedCardCount,
				});
			},
		);
	});
};

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
	const forge = (spec, callback) => {
		const { xLog } = process.global;
		const {
			standard,
			version,
			source,
			owner = ':golden',
			deriveHub = false,
			vectorize,
			embedNodeLimit,
			embeddingConfigFilePath,
			embeddingCacheFilePath,
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

		// THE REQUIRED VERSION IS STATED BEFORE ANY SPEND, BESIDE THE SPEND KNOB. version is
		// declared REQUIRED in this module's header, but its presence used to be checked ONLY in
		// the completion callback (inside resolveReportedVersion), AFTER the full parse AND the
		// full Voyage embedding pass — so forge({ standard, vectorize:true }) with no version ran
		// the entire real-credit embedding run and was refused only once the bill was already
		// paid. The presence check moves HERE, before any bundle is resolved or any embedder is
		// constructed, so a missing version costs nothing. resolveReportedVersion still runs at
		// the end and is UNCHANGED — it keeps the two provenance claims (the bundle's own stamp vs
		// the recipe's requested token) distinct; this only front-loads the part that must precede
		// the spend (polyArch2 §6).
		if (version === undefined || version === null || `${version}`.trim() === '') {
			callback(
				`forger: the forge spec names no version token. version is REQUIRED — it is ` +
					`reported alongside the bundle's own stamp so the two provenance claims stay ` +
					`distinct, and there is no default for it. This is checked BEFORE any bundle is ` +
					`resolved or any embedder is constructed, so a missing version cannot cost ` +
					`Voyage credit.`,
			);
			return;
		}

		// deriveHub is the OPTIONAL hub-fold signal (default: not a hub). A SUPPLIED value must BE a
		// boolean: a truthy string ('false' is truthy!) would fold a hub against a caller who typed
		// the opposite — the same §6 fault the vectorize guard above refuses. A non-boolean is REFUSED
		// BY NAME rather than coerced. This is a cheap refusal placed before resolveBundle, so a bad
		// signal costs neither a bundle read nor Voyage credit. Absence is fine and means not-a-hub.
		if (spec && spec.deriveHub !== undefined && typeof spec.deriveHub !== 'boolean') {
			callback(
				`forger: deriveHub is ${
					typeof spec.deriveHub === 'string'
						? `'${spec.deriveHub}' (a string)`
						: JSON.stringify(spec.deriveHub)
				}, which is not a boolean. It is the OPTIONAL hub-fold signal (default: not a hub); a ` +
					`SUPPLIED value must be the boolean true or false. A string, number or null is REFUSED ` +
					`rather than coerced, because a truthy non-boolean would fold a hub nobody asked for.`,
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
		let declaredEmbeddingModelVersion;
		if (vectorize) {
			if (embeddingConfigFilePath) {
				console.error(
					`EMBEDDING CONFIG OVERRIDE ACTIVE: configFilePath = ${embeddingConfigFilePath} (embeddingConfigFilePath)`,
				);
			}
			if (embeddingCacheFilePath !== undefined) {
				console.error(
					`EMBEDDING CACHE OVERRIDE ACTIVE: cacheFilePath = ${embeddingCacheFilePath} (embeddingCacheFilePath)`,
				);
			}
			const voyagePointer = resolveVoyageConfigPath({ paramPath: embeddingConfigFilePath });
			if (voyagePointer.error) {
				callback(voyagePointer.error);
				return;
			}
			embedder = require(path.join(TREE_LIB, 'embedding', 'embedding-client'))({
				configFilePath: voyagePointer.configFilePath,
				// Cache override for test isolation. The standing policy is the shared vector cache ON by
				// default, so a build that says nothing passes no override and the embedder takes its
				// documented default (the one dataStores cache). A caller/test that names a path REDIRECTS
				// it — the embedded end-to-end gate points at a throwaway cache so it keeps spending real
				// Voyage rather than being served free from the warm production cache.
				...(embeddingCacheFilePath !== undefined ? { cacheFilePath: embeddingCacheFilePath } : {}),
			});
			// dims AND model come from the SAME embedding identity — they are the width and the model
			// the vectors were MADE at. The standardBase block header must declare both (the block
			// serializer copies them and the restore gate refuses an embedded block that omits
			// embeddingDims); both are surfaced on the forge report so build.js can thread them into
			// the harvest header. On --vectorize=false there is no embedder, so both stay undefined and
			// the header carries no embedding fields — exactly as an un-embedded block should.
			const embeddingIdentity = embedder.resolveEmbeddingIdentity();
			declaredEmbeddingDims = embeddingIdentity.embeddingDims;
			declaredEmbeddingModelVersion = embeddingIdentity.model;
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

		// FOLD THE HUB INTO THE BASE (new design 2026-07-24). When the recipe declares this standard
		// a hub (deriveHub), derive its hub from the just-shaped base nodeEdges and fold it in, so the
		// single block this standard produces already contains its hub. A non-hub standard (the
		// default) skips this entirely and returns base-only nodeEdges. A standard DECLARED a hub with
		// no registered derivation is refused BY NAME inside foldHubIntoNodeEdges (no silent default).
		// declaredEmbeddingDims is threaded through: the hub embeds nothing, so it is unused there,
		// but passing it keeps the shaper's contract honest if a future hub ever carried vectors.
		//
		// THE HUB IS STAMPED WITH THE VERSION THE BUNDLE READ, NOT THE RECIPE TOKEN. `version` is the
		// recipe's requestedVersion (e.g. 'current'); `args.forged.metadata.version` is what the bundle
		// actually read out of the source (e.g. '14.0.0.0'), the SAME value the base nodes carry. Both
		// go to foldHubIntoNodeEdges, which resolves the real one through resolveReportedVersion so base
		// and hub agree on the real version and no placeholder reaches a hub address (golden-diff defect,
		// 2026-07-24; polyArch2 §6).
		taskList.push((args, next) => {
			if (!deriveHub) {
				next('', args);
				return;
			}
			foldHubIntoNodeEdges(
				{
					standard,
					bundleVersion: args.forged.metadata.version,
					requestedVersion: version,
					baseNodeEdges: args.shaped,
					declaredEmbeddingDims,
					// the SAME embedder the base pass used (shared vector cache); null on
					// --vectorize=false, so hub cards carry embedText and no vector on that path
					embedder,
				},
				(foldError, folded) => {
					if (foldError) {
						next(foldError);
						return;
					}
					xLog.status(
						`[forger] folded '${standard}' hub into its base block: nodeEdges now ` +
							`${folded.nodeEdges.nodes.length} nodes, ${folded.nodeEdges.edges.length} edges` +
							(folded.hubEmbeddedCardCount
								? ` (${folded.hubEmbeddedCardCount} hub cards embedded)`
								: ' (hub cards not vectorized)'),
					);
					next('', {
						...args,
						shaped: folded.nodeEdges,
						// the fold's reports ride the forge report so the build orchestrator (which
						// owns the build's log directory) can write them; the forger writes nothing
						hubFoldReports: {
							hubDivergenceReport: folded.hubDivergenceReport,
							hubSkipReport: folded.hubSkipReport,
							hubCounts: folded.hubCounts,
							hubEmbeddedCardCount: folded.hubEmbeddedCardCount,
						},
					});
				},
			);
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
				// the snapshot-provenance triple the bundle stamped from the snapshot directory: the
				// honest published version, WHERE it came from, and WHICH snapshot on disk. build.js
				// derives the EXPLICIT stored version from these (publishedVersion when known;
				// 'unknown_<snapshotKey>' when versionSource is 'unknown'), so no floating 'current'
				// and no laundered default ever reaches a persisted subject, header, or column.
				snapshotKey: args.forged.metadata.snapshotKey,
				publishedVersion: args.forged.metadata.publishedVersion,
				versionSource: args.forged.metadata.versionSource,
				nodeEdges: args.shaped,
				nodeCount: args.shaped.nodes.length,
				edgeCount: args.shaped.edges.length,
				embedCallCount: args.forged.embedCallCount,
				// hub-fold reports (present ONLY when deriveHub ran): the module's §5
				// prose-divergence rows, the S-3 skip rows, and the derivation counts — carried
				// for build.js to WRITE into the build's log directory; the forger writes nothing.
				...(args.hubFoldReports ? args.hubFoldReports : {}),
				// header material for build.js's standardBase harvest — CARRIED from the forge, never
				// invented: stableUriPropertyName names the stable-URI property, embeddingModelVersion is
				// the model the vectors were made at (undefined when --vectorize=false).
				stableUriPropertyName: args.forged.stableUriPropertyName,
				embeddingModelVersion: declaredEmbeddingModelVersion,
			});
		});
	};

	return { forge };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
module.exports.resolveBundle = resolveBundle;
module.exports.resolveVoyageConfigPath = resolveVoyageConfigPath;
module.exports.resolveReportedVersion = resolveReportedVersion;
// the hub-fold seam and its registry, exported so the fold logic is provable WITHOUT running a
// whole forge (test-forger drives foldHubIntoNodeEdges over a synthetic engine-shape base).
module.exports.foldHubIntoNodeEdges = foldHubIntoNodeEdges;
module.exports.HUB_FORGE_BY_STANDARD = HUB_FORGE_BY_STANDARD;
