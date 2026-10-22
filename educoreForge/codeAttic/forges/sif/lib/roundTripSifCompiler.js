'use strict';

// roundTripSifCompiler.js (forge-sif) — THE GRAPH READER. Reads a MATERIALIZED SIF graph over
// bolt and assembles the sifGraph payload the canonicalizer's graph minter consumes.
//
// WHY IT READS THE GRAPH AND NOT THE FORGE'S OUTPUT (RT-4). TQ's founding ruling, preserved in
// the CEDS reference compiler: compiling from the forge's own result "would prove only that the
// forge remembers what it just read. Compiling from the GRAPH proves what the GRAPH ITSELF can
// support" — which is the question, and the only reading that also audits the loader.
//
// LAYER 1 ONLY (RT-4). Every query names its per-standard label explicitly and is scoped
// _source: 'SIF' — the graph this runs against holds seventeen other standards. THE READ
// MANIFEST, stated so the exclusions are decisions rather than accidents:
//   * roles read:   DmeStandardRoot (provenance identity only, via SifRoot's _source scope),
//                   SifObject (DmeClass), SifField (DmeProperty)
//   * node properties read: _id, name, tableName (objects); _id, name, xpath, mandatory,
//                   characteristics, description, nativeType, format, crossRefs,
//                   sequenceOrdinal, siblingCount, orderSemantics (fields)
//   * edges read:   HAS_PROPERTY (SifObject -> SifField) — the ownership carrier that names
//                   each field's sibling scope
//   * DELIBERATELY NOT READ — redundant carriers (the pesc carrier-of-record discipline): the
//     SifComplexType / SifSimpleType / SifPrimitiveType / SifXmlElement node registries restate
//     xpath segments and Type-column values whose carrier of record is each field's own
//     xpath/nativeType scalar; the SifCodeset / SifCodesetValue registry restates Format-column
//     enumerations whose carrier of record is each field's own format scalar (stored VERBATIM —
//     the quote-strip canonicalization feeds only the registry's fingerprints, a code fact of
//     lib/parser.js). Reading a registry would re-prove the derivation, not the source.
//   * DELIBERATELY NOT READ — the DERIVED characteristics pair (Phase 4):
//     `characteristicsRepeatable` and `characteristicsObligation`. These are the forge's documented
//     INTERPRETATION of the Characteristics column (its frozen derivation table; see forgeSif.js),
//     and their carrier of record is each field's own `characteristics` scalar, which IS read above.
//     Reading the derived pair would re-prove the derivation rather than the source — and worse, it
//     would put an interpretation into the statement domain, where the re-emission would assert it
//     as though SIF had stated it. That is invention in exchange for a smaller LOST, which the
//     doctrine names as strictly worse than the loss it would cure. Gate G-17 asserts both names
//     stay out of FIELD_PROPERTY_NAMES; it has been OBSERVED RED against a real leak, and with a
//     matching canonicalizer mapping added the fixture measured INVENTED = 11.
//   * DELIBERATELY NOT READ — REFERENCES edges: heuristic/curated refId interpretation
//     (supervisor ruling D5: interpretation, not source statement) whose curated input
//     (refIdResolutionMap.tsv) is in-house apparatus, out of this diff domain (declared in the
//     validator header and the verdict).
//   * DELIBERATELY NOT READ — Layer 2 / contract apparatus: searchText, embedding, parentId,
//     depth, path, sequenceGroupKey/sequenceGroupLabel (the grouping is re-derived from xpath by
//     the SHARED domain rule instead — trusting the forge's own group key would let the forge
//     grade its own grouping), mappingInstruction, hub nodes, ownership anchors HAS_CLASS /
//     HAS_SUPPORT / HAS_VALUE / HAS_OPTION_SET. crossRefs is read ONLY for the locator='CEDS ID'
//     raw member — the faithful carrier of the source's annotation cell (see the canonicalizer).
//
// Async style: qtools taskListPlus/pipeRunner, error-first callbacks (R7), no async/await, no
// try/catch for control flow (the try/catch below wraps JSON.parse at the docker-inspect
// boundary). The neo4j-driver's Promises are consumed .then().catch() AT THE LEAF, resolving
// back into the err-string convention — the blessed dispensation recorded in
// apps/graph-builder/DOCTRINE.md.

const { execFile } = require('child_process');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const STANDARD_SOURCE = 'SIF';
const DEFAULT_PAGE_SIZE = 2000;

const OBJECT_PROPERTY_NAMES = ['_id', 'name', 'tableName'];
const FIELD_PROPERTY_NAMES = [
	'_id',
	'name',
	'xpath',
	'mandatory',
	'characteristics',
	'description',
	'nativeType',
	'format',
	'crossRefs',
	'sequenceOrdinal',
	'siblingCount',
	'orderSemantics',
];

// the ONE Layer-1 edge query — both endpoint labels named explicitly (the CEDS L-4 discipline).
const HAS_PROPERTY_PAIR_QUERY =
	`MATCH (owner:SifObject {_source:'${STANDARD_SOURCE}'})-[:HAS_PROPERTY]->` +
	`(member:SifField {_source:'${STANDARD_SOURCE}'}) ` +
	`RETURN owner.\`_id\` AS ownerId, member.\`_id\` AS memberId`;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// =====================================================================
		// resolveContainerBolt — bolt endpoint + credential are FACTS ABOUT THE RUNNING
		// CONTAINER, read from `docker inspect`, never restated where they could drift.
		// An absent container / port / credential is a refusal by name, not a guess.
		// =====================================================================

		const defaultRunDockerCommand = (dockerArgs, callback) =>
			execFile('docker', dockerArgs, { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }, callback);

		const resolveContainerBolt = (
			{ containerName, runDockerCommand = defaultRunDockerCommand } = {},
			callback,
		) => {
			if (typeof containerName !== 'string' || containerName.trim() === '') {
				callback(`${moduleName}.resolveContainerBolt: containerName is REQUIRED and has no default.`);
				return;
			}
			runDockerCommand(['inspect', containerName], (inspectError, stdout, stderr) => {
				if (inspectError) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' failed: ` +
							`${inspectError.message}${stderr ? `\n${stderr}` : ''} — the container is absent or ` +
							`Docker is not running; neither is guessed at.`,
					);
					return;
				}
				let inspected;
				let parseFault = '';
				try {
					inspected = JSON.parse(stdout);
				} catch (parseError) {
					parseFault = parseError.message;
				}
				if (parseFault) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' returned ` +
							`unparseable JSON: ${parseFault}`,
					);
					return;
				}
				const record = Array.isArray(inspected) ? inspected[0] : inspected;
				if (!record) {
					callback(
						`${moduleName}.resolveContainerBolt: 'docker inspect ${containerName}' returned no ` +
							`record. The container does not exist under that name.`,
					);
					return;
				}
				const portBindingList =
					(record.NetworkSettings &&
						record.NetworkSettings.Ports &&
						record.NetworkSettings.Ports['7687/tcp']) ||
					[];
				const boltPort = (
					portBindingList.find((oneBinding) => oneBinding && oneBinding.HostPort) || {}
				).HostPort;
				if (!boltPort) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' publishes no host ` +
							`port for 7687/tcp. There is no bolt endpoint to read and one is not guessed at.`,
					);
					return;
				}
				const authEntry = ((record.Config && record.Config.Env) || []).find((oneEntry) =>
					String(oneEntry).startsWith('NEO4J_AUTH='),
				);
				if (!authEntry) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' declares no ` +
							`NEO4J_AUTH in its environment. The credential is read from the container, never assumed.`,
					);
					return;
				}
				const authValue = authEntry.slice('NEO4J_AUTH='.length);
				const slashAt = authValue.indexOf('/');
				if (slashAt === -1) {
					callback(
						`${moduleName}.resolveContainerBolt: container '${containerName}' has NEO4J_AUTH ` +
							`'${authValue}', which is not the '<user>/<password>' shape.`,
					);
					return;
				}
				callback('', {
					containerName,
					boltUrl: `bolt://localhost:${boltPort}`,
					user: authValue.slice(0, slashAt),
					password: authValue.slice(slashAt + 1),
				});
			});
		};

		// =====================================================================
		// THE READER — a materialized graph -> sifGraph
		//   makeNeo4jSifReader({ boltUrl, user, password, pageSize }) -> { readAll, close }
		//   A TEST DOUBLE satisfies the same contract; the canonicalizer cannot tell them apart.
		//   sifGraph = { objectNodeList, fieldNodeList, hasPropertyPairList, rootProperties }
		// =====================================================================

		const makeNeo4jSifReader = ({ boltUrl, user, password, pageSize } = {}) => {
			const effectivePageSize = pageSize || DEFAULT_PAGE_SIZE;
			const neo4j = require('neo4j-driver');
			let driver = null;

			const ensureDriver = () => {
				if (!driver) {
					// disableLosslessIntegers: sequenceOrdinal (and every count) arrives as a JS
					// number, not a neo4j Integer object — the canonicalizer's numeric guard depends
					// on it (the same setting the edfi materialization runner proved).
					driver = neo4j.driver(boltUrl, neo4j.auth.basic(user, password), {
						disableLosslessIntegers: true,
					});
				}
				return driver;
			};

			// runRead — the ONE seam where driver Promises exist; resolved back to the err-string
			// convention at this leaf (the blessed dispensation, apps/graph-builder/DOCTRINE.md).
			const runRead = (cypher, parameters, callback) => {
				const session = ensureDriver().session();
				session
					.run(cypher, parameters || {})
					.then((runResult) => {
						session.close().catch(() => {});
						callback('', { records: runResult.records });
					})
					.catch((runError) => {
						session.close().catch(() => {});
						callback(`${moduleName}.runRead: ${runError.message}\ncypher: ${cypher}`);
					});
			};

			const readLabelPaged = ({ perStandardLabel, propertyNameList }, callback) => {
				const projection = propertyNameList
					.map((onePropertyName) => `oneNode.\`${onePropertyName}\` AS \`${onePropertyName}\``)
					.join(', ');
				const cypher =
					`MATCH (oneNode:\`${perStandardLabel}\` {_source:'${STANDARD_SOURCE}'}) RETURN ${projection} ` +
					`ORDER BY oneNode.\`_id\` SKIP $skip LIMIT $limit`;
				const collected = [];
				const readNextPage = (skip) => {
					// SKIP/LIMIT must travel as neo4j integers — a JS number arrives as a float and
					// the server refuses '2000.0' by name.
					const neo4j = require('neo4j-driver');
					runRead(
						cypher,
						{ skip: neo4j.int(skip), limit: neo4j.int(effectivePageSize) },
						(readError, result) => {
							if (readError) {
								callback(readError);
								return;
							}
							result.records.forEach((oneRecord) => {
								const properties = {};
								propertyNameList.forEach((onePropertyName) => {
									const value = oneRecord.get(onePropertyName);
									if (value !== null && value !== undefined) {
										properties[onePropertyName] = value;
									}
								});
								collected.push(properties);
							});
							if (result.records.length < effectivePageSize) {
								callback('', { nodeList: collected });
								return;
							}
							readNextPage(skip + effectivePageSize);
						},
					);
				};
				readNextPage(0);
			};

			const readAll = (callback) => {
				const taskList = new taskListPlus();

				taskList.push((args, next) => {
					readLabelPaged(
						{ perStandardLabel: 'SifObject', propertyNameList: OBJECT_PROPERTY_NAMES },
						(readError, result) => {
							if (readError) {
								next(readError);
								return;
							}
							next('', { ...args, objectNodeList: result.nodeList });
						},
					);
				});

				taskList.push((args, next) => {
					readLabelPaged(
						{ perStandardLabel: 'SifField', propertyNameList: FIELD_PROPERTY_NAMES },
						(readError, result) => {
							if (readError) {
								next(readError);
								return;
							}
							next('', { ...args, fieldNodeList: result.nodeList });
						},
					);
				});

				taskList.push((args, next) => {
					runRead(HAS_PROPERTY_PAIR_QUERY, {}, (readError, result) => {
						if (readError) {
							next(readError);
							return;
						}
						next('', {
							...args,
							hasPropertyPairList: result.records.map((oneRecord) => ({
								ownerId: oneRecord.get('ownerId'),
								memberId: oneRecord.get('memberId'),
							})),
						});
					});
				});

				// the root: provenance identity for the verdict (snapshotKey, version), NOT content.
				taskList.push((args, next) => {
					runRead(
						`MATCH (rootNode:DmeStandardRoot {_source:'${STANDARD_SOURCE}'}) RETURN ` +
							`rootNode.\`_id\` AS rootId, rootNode.snapshotKey AS snapshotKey, ` +
							`rootNode.version AS version, rootNode.publishedVersion AS publishedVersion, ` +
							`rootNode.versionSource AS versionSource, rootNode.standardName AS standardName`,
						{},
						(readError, result) => {
							if (readError) {
								next(readError);
								return;
							}
							if (result.records.length !== 1) {
								next(
									`${moduleName}.readAll: expected exactly one DmeStandardRoot with ` +
										`_source='${STANDARD_SOURCE}', found ${result.records.length}. A graph ` +
										`without the SIF root is not a materialized SIF graph; refused rather than ` +
										`guessed at.`,
								);
								return;
							}
							const oneRecord = result.records[0];
							next('', {
								...args,
								rootProperties: {
									rootId: oneRecord.get('rootId'),
									snapshotKey: oneRecord.get('snapshotKey'),
									version: oneRecord.get('version'),
									publishedVersion: oneRecord.get('publishedVersion'),
									versionSource: oneRecord.get('versionSource'),
									standardName: oneRecord.get('standardName'),
								},
							});
						},
					);
				});

				pipeRunner(taskList.getList(), {}, (pipeError, args) => {
					if (pipeError) {
						callback(pipeError);
						return;
					}
					callback('', {
						sifGraph: {
							objectNodeList: args.objectNodeList,
							fieldNodeList: args.fieldNodeList,
							hasPropertyPairList: args.hasPropertyPairList,
							rootProperties: args.rootProperties,
						},
					});
				});
			};

			const close = (callback) => {
				if (!driver) {
					callback('');
					return;
				}
				driver
					.close()
					.then(() => callback(''))
					.catch((closeError) => callback(`${moduleName}.close: ${closeError.message}`));
			};

			return { readAll, close };
		};

		// =====================================================================
		// compileFromReader — reader -> { sifGraph, graphSummary }. The reader may be the bolt
		// reader or a test double; this function cannot tell and must not care.
		// =====================================================================

		const compileFromReader = ({ reader } = {}, callback) => {
			if (!reader || typeof reader.readAll !== 'function') {
				callback(
					`${moduleName}.compileFromReader: reader with readAll(callback) is REQUIRED and has ` +
						`no default.`,
				);
				return;
			}
			reader.readAll((readError, readResult) => {
				if (readError) {
					callback(readError);
					return;
				}
				const { sifGraph } = readResult;
				callback('', {
					sifGraph,
					graphSummary: {
						rootProperties: sifGraph.rootProperties || {},
						nodeCounts: {
							SifObject: (sifGraph.objectNodeList || []).length,
							SifField: (sifGraph.fieldNodeList || []).length,
						},
						edgeCounts: {
							hasProperty: (sifGraph.hasPropertyPairList || []).length,
						},
					},
				});
			});
		};

		return {
			resolveContainerBolt,
			makeNeo4jSifReader,
			compileFromReader,
			OBJECT_PROPERTY_NAMES,
			FIELD_PROPERTY_NAMES,
			HAS_PROPERTY_PAIR_QUERY,
			STANDARD_SOURCE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
