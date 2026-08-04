'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// forgeEdfi.js — THE forge-edfi forge, born compliant in the round-trip campaign (Phase 2;
// rulings R-WO-8..R-WO-11; promoted to this RT-1 manifest name at the Phase 5 closeout).
//
// LINEAGE (R-WO-8/R-WO-2): built during the campaign as forgeEdfiV2.js while the incumbent
// CSV-crosswalk forge held the baseline; at closeout (2026-08-04) the incumbent forge, its lib
// modules, and snapshots 01–03 were REMOVED from HEAD (git history is the museum) and this
// module took the manifest name. parserDescriptor.ini pins entryModule=forgeEdfi.js,
// defaultSnapshot=04.
//
// WHAT THIS FORGE IS: a clean reimplementation from Ed-Fi's canonical machine-readable source.
// It consumes the FIVE declared inputs of snapshot 04:
//   1+3. the MetaEd sources (metaEdModel/ + tpdmCommunityModel/) via the Phase 1 independent
//        parser (lib/metaEdParser.js — checksum-verified there),
//   2+4. the descriptor code-value XMLs via lib/descriptorCodeValueLoader.js (checksum-verified
//        there — the consumption debt named in the Phase 1 handoff),
//   5.   the authored Ed-Fi→CEDS crosswalk CSVs via lib/crosswalkCarrier.js (checksum-verified
//        there; R-WO-4 carriage; unmatched rows REPORTED per R-WO-11, never invented),
// and emits the universal forge property contract via lib/forgeEdfiContractGraph.js (pure,
// deterministic; role mapping per R-WO-9; refusal-by-name throughout; absent-is-absent RT-2).
//
// PURITY: buildContractGraph is a PURE synchronous deterministic function of the loaded
// sources. forge() runs loaders -> buildContractGraph -> embedNodes. A shaping violation THROWS
// and is surfaced as a forge error at the pipeline seam (the incumbent's exact seam pattern).
//
// BRIDGE PURITY: a STANDARD-PURE EdFi block — _source='EdFi', EdFi's own nodes + intra-EdFi
// structural edges ONLY. The authored CEDS anchors are STASHED (cedsId / cedsOptionCode +
// crossRefs) for the later bridge phase; NO cross-standard edge is emitted here.
//
// Async style: qtools taskListPlus/pipeRunner; error-first callbacks (RT-8/R7); no async/await,
// no try/catch-for-control-flow. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const metaEdParser = require('./lib/metaEdParser')();
const descriptorCodeValueLoader = require('./lib/descriptorCodeValueLoader')();
const crosswalkCarrier = require('./lib/crosswalkCarrier')();
const forgeEdfiContractGraph = require('./lib/forgeEdfiContractGraph')();

const CORE_LIB = path.join(__dirname, '..', '..', 'lib');
const { deriveVersionStamp } = require(
	path.join(CORE_LIB, 'snapshot-provenance', 'snapshot-provenance'),
);

const EMBED_BATCH_SIZE = 128; // voyage batch ceiling headroom; bounds per-call payload

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) => {
		const { xLog } = process.global;

		// =====================================================================
		// embedNodes — batched embedding pass (1C embedTexts; incumbent-mirrored).
		// =====================================================================
		const embedNodes = ({ nodes, nodeSubsetLimit }, callback) => {
			const targetNodes =
				nodeSubsetLimit && nodeSubsetLimit < nodes.length
					? nodes.slice(0, nodeSubsetLimit)
					: nodes;

			const batches = [];
			for (let batchStart = 0; batchStart < targetNodes.length; batchStart += EMBED_BATCH_SIZE) {
				batches.push(targetNodes.slice(batchStart, batchStart + EMBED_BATCH_SIZE));
			}

			let embedCallCount = 0;
			let batchIndex = 0;

			const nextBatch = () => {
				if (batchIndex >= batches.length) {
					callback('', { embedCallCount, embeddedCount: targetNodes.length });
					return;
				}
				const batch = batches[batchIndex];
				batchIndex++;
				const texts = batch.map((oneNode) => oneNode.properties.searchText);
				embedder.embedTexts({ texts }, (embedError, embedResult) => {
					if (embedError) {
						callback(`forge-edfi embedNodes batch ${batchIndex} failed: ${embedError}`);
						return;
					}
					embedCallCount++;
					batch.forEach((oneNode, nodeIndex) => {
						oneNode.properties.embedding = Array.from(embedResult.vectors[nodeIndex]);
						oneNode.embedding = oneNode.properties.embedding; // for serializeBlock
						oneNode.embeddingModelVersion = embedResult.embeddingModelVersion;
						oneNode.properties.embeddingModelVersion = embedResult.embeddingModelVersion;
					});
					if (xLog && xLog.status) {
						xLog.status(
							`[forge-edfi] embedded batch ${batchIndex}/${batches.length} (${batch.length} nodes)`,
						);
					}
					nextBatch();
				});
			};

			nextBatch();
		};

		// =====================================================================
		// forge — orchestrate loaders -> buildContractGraph -> embedNodes.
		//   options: { sourcePath, owner, embedNodeLimit, skipEmbedding }
		//   sourcePath = the pinned snapshot version directory (the five-input snapshot).
		//   callback(errString, { nodes, edges, metadata, stats, crosswalkMatchReport,
		//                         embedCallCount, standardKey, stableUriPropertyName })
		// =====================================================================
		const forge = ({ sourcePath, owner, embedNodeLimit, skipEmbedding } = {}, callback) => {
			const taskList = new taskListPlus();

			// STAGE 1 — the MetaEd model (Phase 1 parser; its loader owns the .metaed checksums)
			taskList.push((args, next) => {
				metaEdParser.parseMetaEdSnapshot(
					{ snapshotPath: sourcePath, xLog },
					(parseError, metaEdModel) => {
						if (parseError) {
							next(`forge-edfi metaEdParser: ${parseError}`);
							return;
						}
						next('', { ...args, metaEdModel });
					},
				);
			});

			// STAGE 2 — descriptor code values (checksum-verified at consumption)
			taskList.push((args, next) => {
				descriptorCodeValueLoader.loadDescriptorCodeValues(
					{ snapshotPath: sourcePath },
					(loadError, descriptorCodeValues) => {
						if (loadError) {
							next(loadError);
							return;
						}
						xLog.status(
							`[forge-edfi] code values: ${descriptorCodeValues.census.codeValueRecordCount} ` +
								`records across ${descriptorCodeValues.census.xmlFileCount} XMLs ` +
								`(${descriptorCodeValues.census.duplicateIdenticalCollapsedCount} identical ` +
								`duplicates collapsed)`,
						);
						next('', { ...args, descriptorCodeValues });
					},
				);
			});

			// STAGE 3 — authored crosswalk registries (checksum-verified at consumption)
			taskList.push((args, next) => {
				crosswalkCarrier.loadAuthoredCrosswalk(
					{ snapshotPath: sourcePath },
					(loadError, authoredCrosswalk) => {
						if (loadError) {
							next(loadError);
							return;
						}
						xLog.status(
							`[forge-edfi] authored crosswalk: ` +
								`${authoredCrosswalk.census.elementsRowCount} element rows, ` +
								`${authoredCrosswalk.census.descriptorsRowCount} descriptor rows loaded`,
						);
						next('', { ...args, authoredCrosswalk });
					},
				);
			});

			// STAGE 4 — version-provenance stamp (spec §3.3): the model package's own version is
			// the self-described source version; disagreements with the provenance file are warned
			// with both values named, never silently resolved
			taskList.push((args, next) => {
				const coreSourceInput = args.metaEdModel.metadata.sourceInputs[0];
				const selfDescribedVersion =
					coreSourceInput && coreSourceInput.projectVersion
						? coreSourceInput.projectVersion
						: null;
				const metadata = {
					version: selfDescribedVersion || 'unknown',
					versionSource: selfDescribedVersion ? 'spec' : 'unknown',
					sourceFormat: 'metaed+xml+csv',
					sourceFiles: args.metaEdModel.metadata.sourceInputs.map(
						(oneSourceInput) => oneSourceInput.inputName,
					).concat(['descriptorCodeValues', 'tpdmDescriptorCodeValues', 'cedsAuthoredCrosswalk']),
					sourceUrl: '',
				};
				Object.assign(
					metadata,
					deriveVersionStamp({
						sourcePath,
						sourceVersion: selfDescribedVersion,
						warn: (warnMessage) => xLog.error(warnMessage),
					}),
				);
				next('', { ...args, metadata });
			});

			// STAGE 5 — PURE deterministic shaping (throws -> surfaced as forge error; the
			// incumbent's exact seam: try/catch here is the throw-to-callback ADAPTER, not control
			// flow)
			taskList.push((args, next) => {
				let contractGraph;
				let buildError = '';
				try {
					contractGraph = forgeEdfiContractGraph.buildContractGraph({
						metaEdModel: args.metaEdModel,
						descriptorCodeValues: args.descriptorCodeValues,
						authoredCrosswalk: args.authoredCrosswalk,
						metadata: args.metadata,
					});
				} catch (thrownError) {
					buildError = thrownError.message;
				}
				if (buildError) {
					next(`forge-edfi buildContractGraph: ${buildError}`);
					return;
				}
				const report = contractGraph.crosswalkMatchReport;
				xLog.status(
					`[forge-edfi] contract graph: ${contractGraph.nodes.length} nodes, ` +
						`${contractGraph.edges.length} edges; crosswalk matches — properties ` +
						`${report.propertyRows.matchedCount} matched / ` +
						`${report.propertyRows.unmatchedList.length} unmatched / ` +
						`${report.propertyRows.ambiguousList.length} ambiguous; descriptors ` +
						`${report.descriptorRows.matchedCount}/${report.descriptorRows.unmatchedList.length}; ` +
						`values ${report.optionValueRows.matchedCount}/${report.optionValueRows.unmatchedList.length} ` +
						`(unmatched rows are REPORTED, never invented — R-WO-11)`,
				);
				next('', { ...args, contractGraph });
			});

			// STAGE 6 — embedding pass (skippable for determinism proofs and structural checks)
			taskList.push((args, next) => {
				if (skipEmbedding) {
					next('', { ...args, embedCallCount: 0 });
					return;
				}
				embedNodes(
					{ nodes: args.contractGraph.nodes, nodeSubsetLimit: embedNodeLimit },
					(embedError, embedReport) => {
						if (embedError) {
							next(embedError);
							return;
						}
						next('', { ...args, embedCallCount: embedReport.embedCallCount });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
				if (pipelineError) {
					callback(pipelineError);
					return;
				}
				callback('', {
					nodes: args.contractGraph.nodes,
					edges: args.contractGraph.edges,
					metadata: args.metadata,
					stats: args.contractGraph.stats,
					crosswalkMatchReport: args.contractGraph.crosswalkMatchReport,
					embedCallCount: args.embedCallCount,
					standardKey: forgeEdfiContractGraph.STANDARD_KEY,
					stableUriPropertyName: forgeEdfiContractGraph.STABLE_URI_PROPERTY_NAME,
				});
			});
		};

		return {
			forge,
			buildContractGraph: forgeEdfiContractGraph.buildContractGraph, // pure layer, for tests
			STANDARD_KEY: forgeEdfiContractGraph.STANDARD_KEY,
			STANDARD_SOURCE: forgeEdfiContractGraph.STANDARD_SOURCE,
			STABLE_URI_PROPERTY_NAME: forgeEdfiContractGraph.STABLE_URI_PROPERTY_NAME,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
