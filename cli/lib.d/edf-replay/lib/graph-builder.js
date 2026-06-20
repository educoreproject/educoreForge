'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graph-builder.js — the -buildGraph engine of replayManager (helpSpec, DECISIONS §14/§17).
//
// THE MANIFEST -> BLOCKS READ PATH IS forge-store (confirmed by orchestrator + FROZEN_LATTICE):
//   getManifest -> deriveBuildOrder -> getBlock, yielding the ORDERED block texts. replayManager
//   reads the block texts DIRECTLY through the forge-store library API; it holds NO raw SQL and
//   never shells out to manifestEditor (which stays the writer only).
//
// Steps:
//   1. resolve the manifest's ORDERED member blocks via forge-store:
//        getManifest({manifestKey}) -> members
//        load each member's meta (type/subject/requires) via getBlock
//        deriveBuildOrder(memberBlocks) -> CEDS-first topological order (position override honored)
//        getBlock again to pull each ordered block's `text` (the PG-JSONL itself)
//   2. CREATE + register the destination instance via the 1B instance-lifecycle (resolve-or-create,
//        mirroring the forger's materializer; type derives from --destination).
//   3. replay the ordered block texts into the instance via the Phase-2 engine (boltUri + credential
//        resolved by name from the registry — never on the command line).
//   4. ownerStamp: stamp EVERY node and edge with --owner (helpSpec INVARIANTS, schemas §4). The
//        replay engine writes data only and explicitly defers the ownerStamp to replayManager; we
//        apply it as a post-replay cypher pass — the owner token becomes a node LABEL and an edge
//        `owner` PROPERTY (Neo4j relationships cannot carry labels). Idempotent (SET label/prop).
//   5. stampProvenance: write the SINGLE :GraphProvenance passport node as the FINAL step
//        (SPEC-graphProvenanceNode-062026.md). It records what/where/when/how the graph was built
//        from inside the graph itself. Created AFTER ownerStamp so it is never owner-stamped, and
//        deliberately carries neither the :ForgedNode label nor an _source (Option A): every
//        content-equality/diff query scopes to (:ForgedNode), so the passport — whose builtAt is
//        non-deterministic — is excluded from byte-identical content equality.
//
//   NEVER tears down on error (DECISIONS §14): a failed build leaves the instance in place.
//
// Async style: qtools taskListPlus/pipeRunner; engine/neo4j resolve at the leaf. No async/await,
// no try/catch-for-control-flow, no Promises surfaced. camelCase only.

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const CORE_LIB = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'..',
	'npm',
	'qtools-graph-forge-core',
	'lib',
);
const replayEngine = require(path.join(CORE_LIB, 'replay', 'replay-engine'));
// replay-block is a PURE constants/codec module (no Neo4j); we read SERIALIZER_VERSION from it
// for the :GraphProvenance passport rather than hardcoding the serializer version.
const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
// the engine/format version stamped on the passport is the version of the package that SHIPS the
// replay engine (qtools-graph-forge-core); read it rather than hardcoding or inventing a constant.
const FORGE_CORE_VERSION = require(path.join(CORE_LIB, '..', 'package.json')).version;

// role -> instance type (registry `type`, which the teardown guard reads). bronze is ephemeral
// (freely tearable); golden/user are protected. The ROLE is the canonical destination token
// (bronze|golden|user); the graph NAME may equal the role (first-app: golden IS named 'golden')
// or differ (a tenant graph 'tenantA' has role 'user'). Anything not bronze/golden is 'user'.
const typeForRole = (role) => {
	if (role === 'bronze') return 'bronze';
	if (role === 'golden') return 'golden';
	return 'user';
};

// owner derives from role (golden -> :golden, otherwise :user); override allowed (§14).
const ownerForRole = (role) => (role === 'golden' ? ':golden' : ':user');

// the owner token as a bare Neo4j label (strip the leading ':'); validated as an identifier so it
// can never inject through the label position (which cannot be parameterized).
const OWNER_LABEL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ownerLabel = (owner) => `${owner}`.replace(/^:/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ forgeStore, lifecycle } = {}) => {
		const { xLog } = process.global;

		// -----
		// resolveOrderedBlockTexts — the forge-store manifest->blocks READ path. Returns the
		//   ordered array of PG-JSONL block texts (CEDS-first topo order via deriveBuildOrder).
		const resolveOrderedBlockTexts = ({ manifestKey }, callback) => {
			const taskList = new taskListPlus();

			// getManifest -> ordered-unaware member list
			taskList.push((args, next) => {
				forgeStore.getManifest({ manifestKey }, (err, manifest) => {
					if (err) {
						next(err);
						return;
					}
					if (!manifest) {
						next(`buildGraph: no manifest '${manifestKey}'`);
						return;
					}
					next('', { ...args, members: manifest.members || [] });
				});
			});

			// load each member's meta (type/subject/requires) so deriveBuildOrder can sort it
			taskList.push((args, next) => {
				const blockTaskList = new taskListPlus();
				const memberBlocks = [];
				args.members.forEach((oneMember) => {
					blockTaskList.push((blockArgs, blockNext) => {
						forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
							if (err) {
								blockNext(err);
								return;
							}
							if (!row) {
								blockNext(
									`buildGraph: manifest references missing block '${oneMember.blockId}'`,
								);
								return;
							}
							memberBlocks.push({
								blockId: oneMember.blockId,
								position: oneMember.position,
								type: row.type,
								subject: row.subject,
								requires: row.requires || [],
							});
							blockNext('', blockArgs);
						});
					});
				});
				pipeRunner(blockTaskList.getList(), {}, (err) =>
					next(err, { ...args, memberBlocks }),
				);
			});

			// deriveBuildOrder (CEDS-first; position override honored) -> ordered blockIds
			taskList.push((args, next) => {
				const ordered = forgeStore.deriveBuildOrder(args.memberBlocks);
				if (ordered.cycle) {
					next(
						`buildGraph: manifest requires-graph has a cycle among: ${ordered.cycleMembers.join(', ')}`,
					);
					return;
				}
				next('', { ...args, orderedBlocks: ordered.list });
			});

			// pull each ordered block's `text` (the PG-JSONL itself), preserving order
			taskList.push((args, next) => {
				const blockTexts = [];
				const blockTaskList = new taskListPlus();
				args.orderedBlocks.forEach((oneBlock, index) => {
					blockTaskList.push((blockArgs, blockNext) => {
						forgeStore.getBlock({ blockId: oneBlock.blockId }, (err, row) => {
							if (err) {
								blockNext(err);
								return;
							}
							// row.text arrives as a Buffer (BLOB) or string; normalize to string.
							const text = Buffer.isBuffer(row.text)
								? row.text.toString('utf8')
								: `${row.text}`;
							blockTexts[index] = text;
							blockNext('', blockArgs);
						});
					});
				});
				pipeRunner(blockTaskList.getList(), {}, (err) =>
					next(err, { ...args, blockTexts }),
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					blockTexts: args.blockTexts,
					orderedBlocks: args.orderedBlocks,
				});
			});
		};

		// -----
		// stampOwner — post-replay ownerStamp pass. Owner token -> node LABEL + edge `owner`
		//   property. Idempotent. The replay engine writes data only (its docs defer ownerStamp
		//   to replayManager), so this is replayManager's responsibility per helpSpec INVARIANTS.
		const stampOwner = ({ destination, owner }, callback) => {
			const label = ownerLabel(owner);
			if (!OWNER_LABEL_RE.test(label)) {
				callback(`buildGraph: invalid --owner '${owner}' (must be :golden|:user)`);
				return;
			}

			const taskList = new taskListPlus();

			// stamp every node with the owner LABEL (idempotent SET)
			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName: destination,
						cypher: `MATCH (n:ForgedNode) SET n:\`${label}\` RETURN count(n) AS c`,
					},
					(err, result) => {
						if (err) {
							next(err);
							return;
						}
						next('', { ...args, nodesStamped: Number(result.records[0].c) });
					},
				);
			});

			// stamp every edge with an `owner` property (relationships can't carry labels)
			taskList.push((args, next) => {
				lifecycle.runCypher(
					{
						graphName: destination,
						cypher: `MATCH ()-[r]->() SET r.owner = $owner RETURN count(r) AS c`,
						params: { owner: `${owner}` },
					},
					(err, result) => {
						if (err) {
							next(err);
							return;
						}
						next('', { ...args, edgesStamped: Number(result.records[0].c) });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					callback(err);
					return;
				}
				callback('', {
					nodesStamped: args.nodesStamped,
					edgesStamped: args.edgesStamped,
				});
			});
		};

		// -----
		// buildGraph — { manifestKey, destination, owner?, role? } ->
		//   { destination, location, owner, blockCount, replayResult, ownerStampResult }.
		//   Resolve ordered block texts (forge-store) -> create+register instance -> replay ->
		//   ownerStamp. `destination` is the graph NAME (the only thing that names a graph). `role`
		//   is the canonical destination token (bronze|golden|user) that drives instance type + the
		//   default owner; it DEFAULTS to `destination` (first-app: golden IS named 'golden'). owner
		//   derives from role unless overridden. NEVER destroys on error (DECISIONS §14).
		// -----
		// statusForType — the INITIAL status the passport carries, by graphType. PRINCIPLE:
		//   replayManager BUILDS, the promote path PUBLISHES — so 'live' means
		//   pointer-advanced/published, which buildGraph does NOT do. bronze is a working scratch
		//   graph; a user/tenant graph is live as soon as it is built (no promote step); golden (and
		//   dev/validation) come up 'built' = replayed-but-not-yet-promoted. The promote path (IV-b)
		//   later flips golden 'built' -> 'live', sets publishedAt + previousManifestId, and advances
		//   the pointer.
		const statusForType = (graphType) =>
			graphType === 'bronze'
				? 'working'
				: graphType === 'user'
					? 'live'
					: 'built';

		// -----
		// stampProvenance — the FINAL build step: write the single :GraphProvenance passport node
		//   (SPEC-graphProvenanceNode-062026.md). Runs AFTER content load + ownerStamp so counts and
		//   provenanceTierComplete reflect the finished graph. Content facts (counts, standardsIncluded,
		//   embeddingModelVersion, tier-completeness) are computed IN-CYPHER over (:ForgedNode) — so the
		//   passport excludes ITSELF — while the externally-known scalars are passed as params. ONE
		//   parameterized CREATE (SPEC §6). The passport is NOT a :ForgedNode and carries no _source
		//   (Option A), so content-equality scoping to (:ForgedNode) excludes it. Neo4j drops
		//   null-valued map properties on CREATE, so fields with no source today (schemaVersion,
		//   buildSequence, triggeredBy, description, publishedAt, previousManifestId-when-null) read
		//   back as null.
		const stampProvenance = (
			{ destination, manifestKey, owner, graphType, isEphemeral, builtAt },
			callback,
		) => {
			const taskList = new taskListPlus();

			// previousManifestId — the manifest pointer this build advances FROM
			// (graphs.currentManifest). buildGraph does NOT itself move the pointer, so for a graph
			// only ever built here this is null (the registry column exists but is unset).
			taskList.push((args, next) => {
				forgeStore.getGraphByName({ name: destination }, (err, graphRow) => {
					if (err) {
						next(err);
						return;
					}
					next('', {
						...args,
						previousManifestId: graphRow
							? graphRow.currentManifest || null
							: null,
					});
				});
			});

			// the single parameterized CREATE. Content facts aggregate in-cypher (native ints,
			// passport-excluding); scalars arrive as params.
			taskList.push((args, next) => {
				const params = {
					graphName: destination,
					graphType,
					owner,
					isEphemeral,
					// no forge schema-version constant exists in the codebase today (null + flagged)
					schemaVersion: null,
					// the codebase's content-addressed manifest identifier is named manifestKey
					manifestKey,
					builtBy: 'replayManager',
					// version of the package that ships the replay engine (qtools-graph-forge-core)
					replayEngineVersion: FORGE_CORE_VERSION,
					serializerVersion: replayBlock.SERIALIZER_VERSION, // "1"
					builtAt,
					// not passed to replayManager today (null + flagged)
					triggeredBy: null,
					// the manifest pointer this build advances FROM; buildGraph does not move the
					// pointer (that is a promote action), so null for replayManager-built graphs
					previousManifestId: args.previousManifestId,
					// the registry tracks no monotonic build counter today; promote populates later
					buildSequence: null,
					status: statusForType(graphType),
					// publishedAt is a PROMOTE-time field (golden 'built'->'live'); never set at build
					publishedAt: null,
					// no --description control-surface input today (null + flagged)
					description: null,
				};
				const cypher = `
					CALL { MATCH (n:ForgedNode)
						RETURN count(n) AS nodeCountAtBuild,
							collect(DISTINCT n._source) AS standardsRaw }
					CALL { MATCH (:ForgedNode)-[r]->(:ForgedNode)
						RETURN count(r) AS edgeCountAtBuild,
							count(CASE WHEN r.provenanceTier IS NULL THEN 1 END) AS missingTier }
					CALL { MATCH (e:ForgedNode) WHERE e.embeddingModelVersion IS NOT NULL
						RETURN collect(DISTINCT e.embeddingModelVersion) AS emvList }
					WITH nodeCountAtBuild, edgeCountAtBuild, missingTier,
						[s IN standardsRaw WHERE s IS NOT NULL] AS standardsIncluded,
						head(emvList) AS embeddingModelVersion
					CREATE (p:GraphProvenance {
						graphName: $graphName,
						graphType: $graphType,
						owner: $owner,
						isEphemeral: $isEphemeral,
						schemaVersion: $schemaVersion,
						manifestKey: $manifestKey,
						builtBy: $builtBy,
						replayEngineVersion: $replayEngineVersion,
						serializerVersion: $serializerVersion,
						builtAt: $builtAt,
						triggeredBy: $triggeredBy,
						previousManifestId: $previousManifestId,
						buildSequence: $buildSequence,
						status: $status,
						publishedAt: $publishedAt,
						description: $description,
						nodeCountAtBuild: nodeCountAtBuild,
						edgeCountAtBuild: edgeCountAtBuild,
						standardsIncluded: standardsIncluded,
						embeddingModelVersion: embeddingModelVersion,
						provenanceTierComplete: (missingTier = 0)
					})
					RETURN elementId(p) AS elementId, properties(p) AS provenance
				`;
				lifecycle.runCypher(
					{ graphName: destination, cypher, params },
					(err, result) => {
						if (err) {
							next(err);
							return;
						}
						const row = result.records[0];
						const provenance = row.provenance;
						next('', {
							...args,
							provenanceResult: {
								elementId: row.elementId,
								status: provenance.status,
								standardsIncluded: provenance.standardsIncluded,
								nodeCountAtBuild: Number(provenance.nodeCountAtBuild),
								edgeCountAtBuild: Number(provenance.edgeCountAtBuild),
								provenanceTierComplete: provenance.provenanceTierComplete,
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
				callback('', args.provenanceResult);
			});
		};

		const buildGraph = ({ manifestKey, destination, owner, role }, callback) => {
			const effectiveRole = role || destination;
			const effectiveOwner = owner || ownerForRole(effectiveRole);
			const instanceType = typeForRole(effectiveRole);

			const taskList = new taskListPlus();

			// 1. resolve the manifest's ORDERED block texts via forge-store
			taskList.push((args, next) => {
				resolveOrderedBlockTexts({ manifestKey }, (err, resolved) => {
					if (err) {
						next(err);
						return;
					}
					xLog.status(
						`[graph-builder] manifest '${manifestKey}' -> ${resolved.blockTexts.length} ordered block(s)`,
					);
					next('', { ...args, blockTexts: resolved.blockTexts });
				});
			});

			// 2. resolve-or-create the destination instance (register it in the graphs registry)
			taskList.push((args, next) => {
				lifecycle.resolveAccessByName(
					{ graphName: destination },
					(err, access) => {
						if (!err && access && access.location) {
							xLog.status(
								`[graph-builder] destination '${destination}' already provisioned`,
							);
							next('', { ...args, access });
							return;
						}
						xLog.status(
							`[graph-builder] provisioning instance '${destination}' (type=${instanceType})...`,
						);
						lifecycle.createInstanceByName(
							{ graphName: destination, type: instanceType },
							(createErr) => {
								if (createErr) {
									next(`buildGraph create '${destination}' failed: ${createErr}`);
									return;
								}
								lifecycle.resolveAccessByName(
									{ graphName: destination },
									(resolveErr, freshAccess) => {
										if (resolveErr) {
											next(resolveErr);
											return;
										}
										next('', { ...args, access: freshAccess });
									},
								);
							},
						);
					},
				);
			});

			// 3. replay the ORDERED block texts into the instance via the Phase-2 engine
			taskList.push((args, next) => {
				const { access } = args;
				replayEngine.replay(
					{
						manifest: args.blockTexts,
						boltUri: access.location,
						password: access.credential.value,
						graphName: destination,
					},
					(err, replayResult) => {
						if (err) {
							next(`buildGraph replay into '${destination}' failed: ${err}`);
							return;
						}
						xLog.status(
							`[graph-builder] replay: nodesMerged=${replayResult.nodesMerged}, edgesMerged=${replayResult.edgesMerged}, dangling=${(replayResult.danglingRefs || []).length}`,
						);
						next('', { ...args, replayResult });
					},
				);
			});

			// 4. ownerStamp (node label + edge property)
			taskList.push((args, next) => {
				stampOwner(
					{ destination, owner: effectiveOwner },
					(err, ownerStampResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[graph-builder] ownerStamp ${effectiveOwner}: ${ownerStampResult.nodesStamped} node(s), ${ownerStampResult.edgesStamped} edge(s)`,
						);
						next('', { ...args, ownerStampResult });
					},
				);
			});

			// 5. stamp the single :GraphProvenance passport (FINAL step; SPEC-graphProvenanceNode).
			taskList.push((args, next) => {
				stampProvenance(
					{
						destination,
						manifestKey,
						owner: effectiveOwner,
						graphType: instanceType,
						isEphemeral: instanceType === 'bronze',
						builtAt: new Date().toISOString(),
					},
					(err, provenanceResult) => {
						if (err) {
							next(err);
							return;
						}
						xLog.status(
							`[graph-builder] graphProvenance: status=${provenanceResult.status}, ` +
								`${provenanceResult.nodeCountAtBuild} node(s)/${provenanceResult.edgeCountAtBuild} edge(s), ` +
								`standards [${(provenanceResult.standardsIncluded || []).join(', ')}], ` +
								`provenanceTierComplete=${provenanceResult.provenanceTierComplete}`,
						);
						next('', { ...args, provenanceResult });
					},
				);
			});

			pipeRunner(taskList.getList(), {}, (err, args) => {
				if (err) {
					// NEVER tear down on error — leave the instance in place (DECISIONS §14).
					callback(err);
					return;
				}
				callback('', {
					destination,
					location: args.access.location,
					owner: effectiveOwner,
					blockCount: args.blockTexts.length,
					replayResult: args.replayResult,
					ownerStampResult: args.ownerStampResult,
					provenanceResult: args.provenanceResult,
				});
			});
		};

		return {
			buildGraph,
			resolveOrderedBlockTexts,
			stampOwner,
			ownerForRole,
			typeForRole,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
