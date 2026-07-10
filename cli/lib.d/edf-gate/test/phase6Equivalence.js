#!/usr/bin/env node
'use strict';

// phase6Equivalence.js — the PHASE-6 GATE OF RECORD (the EQUIVALENCE LAYER + CONSERVATIVITY + CURATION).
//
// Equivalence is DERIVED (a HubReference with >=2 exactMatch sources IS the cluster; NO Cluster node —
// WHITEPAPER §4.7/§7). The ONLY graph mutation is the CURATION: a vetted SIF closeMatch promoted to a
// curated EXACT_MATCH at the QUALIFIED reference + a reified MappingAssertion (reify-on-demand). This gate
// proves:
//   PURE TWINS (no graph; over the curation fixture + the candidate's source/reference blocks):
//     curationBaseline — the fixture's promotions materialize EXACTLY the curated block's nodes+edges
//                        (curated EXACT_MATCH edges, MappingAssertion nodes, REIFIED_AS/ASSERTS).
//     reifyOnDemand    — NO curation input -> ZERO nodes/edges; the fixture inputs -> exactly N nodes
//                        (the MappingAssertion appears ONLY from a curation input; §6.1).
//     nonResolving     — a curation input whose ref does NOT resolve materializes NOTHING (no dangling edge).
//     conservativityPure — checkConservativity over the curated EXACT_MATCH edges: student & staff sources
//                        DISJOINT -> PASS; inject a bridge (staff source -> student ref) -> VIOLATION named.
//   GRAPH GATE (build the candidate into an isolated scratch graph; reference = the gating golden):
//     provenance       — reference all-scope fp == the frozen goldenAll baseline (it IS the gating golden).
//     additive diff     — candidate vs reference (all-scope, ignoreOwnerStamp): zero removed/changed; added ==
//                        EXACTLY the curation content (2 MappingAssertion nodes; EXACT_MATCH + REIFIED_AS +
//                        ASSERTS edges) and nothing else.
//     gate10Flip        — the qualified Student reference carries >=2 DISTINCT EXACT_MATCH sources on the
//                        CANDIDATE (cluster forms); on the REFERENCE (pre-curation) it had exactly 1 (the
//                        cluster did NOT exist) — the curation is what flips gate 10. (twin: remove the SIF
//                        source -> back to 1 -> RED.)
//     gate13Conservativity — on the CANDIDATE, ZERO sources bridge the student & staff refs (PASS). TWIN
//                        (the single most important demonstration): inject a deliberate EXACT_MATCH merging
//                        a staff source onto the student ref -> the bridge count goes to 1 -> conservativity
//                        RED; remove the injected edge -> restored to 0.
//     replayDeterminism — rebuild the SAME manifest -> identical all-scope fingerprint (curation is durable
//                        manifest content; ZERO LLM at replay).
// Never touches the production golden (productionGuard). Mirrors phase5Implied.js.
//
// Usage: node phase6Equivalence.js --candidateManifest=<key> [--reference=phase5golden]
//        [--candidate=phase6cand] [--gatingManifest=181be81d…]
//
// Async style: qtools taskListPlus/pipeRunner. No async/await, no try/catch for control flow. camelCase.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const configFileProcessor = require('qtools-config-file-processor');

const findProjectRoot = ({ rootFolderName = 'system' } = {}) =>
	__dirname.replace(new RegExp(`^(.*\\/${rootFolderName}).*$`), '$1');
const projectRoot = findProjectRoot();
const CORE_LIB = path.join(projectRoot, 'code', 'npm', 'qtools-graph-forge-core', 'lib');
const CONFIGS_DIR = path.join(projectRoot, 'configs');
const GRAPH_BUILDER = path.join(projectRoot, 'code', 'cli', 'lib.d', 'edf-replay', 'lib', 'graph-builder');
const GATE_LIB = path.join(__dirname, '..', 'lib');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const equivalenceSubgraphFactory = require(path.join(CORE_LIB, 'equivalence-subgraph', 'equivalenceSubgraph'));
const curationFixture = require(path.join(projectRoot, 'code', 'cli', 'bridge-maker', 'edf-equivalence', 'assets', 'curationInputs'));

const DEFAULT_GATING_MANIFEST = '181be81d4b7fb3c1e42867735e1d3dc36f312dc80ba694d63f4231b1a16467dd';

const argVal = (name) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.replace(`--${name}=`, '') : null;
};
const candidateManifest = argVal('candidateManifest');
const gatingManifest = argVal('gatingManifest') || DEFAULT_GATING_MANIFEST;
const referenceGraph = argVal('reference') || 'phase5golden';
const candidateGraph = argVal('candidate') || 'phase6cand';

const xLog = {
	status: (...a) => console.error(...a),
	error: (...a) => console.error(...a),
	result: (...a) => console.log(...a),
	verbose: () => {},
};
let wholeConfig = {};
const hostConfigName =
	os.hostname() === 'qMax.local' || os.hostname() === 'qbook.local' ? 'instanceSpecific/qbook' : '';
const systemIni = path.join(CONFIGS_DIR, hostConfigName, 'systemParameters.ini');
if (fs.existsSync(systemIni)) {
	wholeConfig = configFileProcessor.getConfig(systemIni) || {};
}
process.global = {
	xLog,
	getConfig: (name) => (name === 'allConfigs' ? wholeConfig : wholeConfig[name] || {}),
	commandLineParameters: { switches: {}, values: {}, fileList: [] },
	rawConfig: wholeConfig,
};

const v1 = (a) => (Array.isArray(a) ? a[0] : a);
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

const buildSharedResources = (callback) => {
	const forgeStore = require(path.join(CORE_LIB, 'forge-store', 'forge-store'))();
	const credentialAccessor = require(path.join(CORE_LIB, 'credential-accessor', 'credential-accessor'))({ forgeStore });
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.init({ dbPath: path.join(projectRoot, 'dataStores', 'forgeStore.sqlite3') }, (err) => next(err, args));
	});
	taskList.push((args, next) => {
		require(path.join(CORE_LIB, 'instance-lifecycle', 'instance-lifecycle'))({ forgeStore, credentialAccessor })(
			(err, lifecycle) => next(err, { ...args, lifecycle }),
		);
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) {
			callback(err);
			return;
		}
		const lifecycle = args.lifecycle;
		callback('', {
			forgeStore,
			lifecycle,
			graphBuilder: require(GRAPH_BUILDER)({ forgeStore, lifecycle }),
			fingerprinter: require(path.join(GATE_LIB, 'graph-fingerprint', 'graphFingerprint'))({ lifecycle }),
			differ: require(path.join(GATE_LIB, 'graph-diff', 'graphDiff'))(),
			productionGuard: require(path.join(GATE_LIB, 'production-guard', 'productionGuard'))({ forgeStore }),
			baselineStore: require(path.join(GATE_LIB, 'baseline-store', 'baselineStore'))({ projectRoot }),
		});
	});
};

const queryOne = (lifecycle, graphName, cypher, params, callback) => {
	lifecycle.runCypher({ graphName, cypher, params: params || {} }, (err, result) => {
		if (err) {
			callback(err);
			return;
		}
		callback('', (result.records && result.records[0]) || {});
	});
};

const checks = [];
const record = (name, passed, detail) => {
	checks.push({ name, passed: !!passed, detail });
	xLog.status(`  [${passed ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
};

// resolve a HubReference stableId by a qualifier value key, from the reference block nodes.
const refStableIdByQualifier = (referenceNodes, qualifierKey) => {
	let found = null;
	(referenceNodes || []).forEach((oneNode) => {
		const props = oneNode.properties || {};
		if (v1(props.role) !== 'HubReference') {
			return;
		}
		if (asList(props.qualifierKeys).indexOf(qualifierKey) !== -1 && !found) {
			found = oneNode.stableId;
		}
	});
	return found;
};

// resolve ALL HubReference stableIds carrying a base property (canonicalKey/propertyKey) — multiplicity safe.
const refStableIdsByProperty = (referenceNodes, propertyKey) => {
	const out = [];
	(referenceNodes || []).forEach((oneNode) => {
		const props = oneNode.properties || {};
		if (v1(props.role) !== 'HubReference') {
			return;
		}
		if (v1(props.canonicalKey) === propertyKey || v1(props.propertyKey) === propertyKey) {
			out.push(oneNode.stableId);
		}
	});
	return out;
};

// load the curated mapping block (the ONE candidate member not in the gating manifest) + reference + source.
const loadArtifacts = (forgeStore, callback) => {
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey: candidateManifest }, (err, m) => {
			if (err || !m) {
				next(err || `no candidate manifest ${candidateManifest}`);
				return;
			}
			next('', { ...args, candMembers: (m.members || []).map((x) => x.blockId) });
		});
	});
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey: gatingManifest }, (err, m) => {
			if (err || !m) {
				next(err || `no gating manifest ${gatingManifest}`);
				return;
			}
			const gatingSet = new Set((m.members || []).map((x) => x.blockId));
			const extra = args.candMembers.filter((b) => !gatingSet.has(b));
			if (extra.length !== 1) {
				next(`expected EXACTLY 1 new member (the curated mapping block); found ${extra.length}`);
				return;
			}
			next('', { ...args, curatedBlockId: extra[0] });
		});
	});
	taskList.push((args, next) => {
		forgeStore.getBlock({ blockId: args.curatedBlockId }, (err, row) => {
			if (err || !row) {
				next(err || 'curated mapping block not found');
				return;
			}
			next('', { ...args, curatedBlock: replayBlock.deserializeBlock(row.text) });
		});
	});
	taskList.push((args, next) => {
		const sub = new taskListPlus();
		let referenceNodes = null;
		let sourceNodes = null;
		const sourceStandard = curationFixture.sourceStandard || 'SIF';
		args.candMembers.forEach((blockId) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId }, (err, row) => {
					if (err) {
						n2(err);
						return;
					}
					if (row && row.type === 'reference' && row.subject === 'CEDS') {
						referenceNodes = replayBlock.deserializeBlock(row.text).nodes;
					}
					if (row && row.type === 'standard' && row.subject === sourceStandard) {
						sourceNodes = replayBlock.deserializeBlock(row.text).nodes;
					}
					n2('', a2);
				});
			});
		});
		pipeRunner(sub.getList(), {}, (err) => {
			if (err) {
				next(err);
				return;
			}
			if (!referenceNodes || !sourceNodes) {
				next('could not load reference and/or source blocks from candidate manifest');
				return;
			}
			next('', { ...args, referenceNodes, sourceNodes, sourceStandard });
		});
	});
	pipeRunner(taskList.getList(), {}, (err, args) => callback(err, args));
};

const run = () => {
	if (!candidateManifest) {
		xLog.error('phase6 gate: no --candidateManifest. Aborting.');
		process.exit(2);
	}
	xLog.status(`[phase6 gate] candidate manifest ${candidateManifest.slice(0, 16)}…; reference '${referenceGraph}'; candidate graph '${candidateGraph}'`);

	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`phase6 gate bootstrap failed: ${err}`);
			process.exit(2);
		}
		const { forgeStore, lifecycle, graphBuilder, fingerprinter, differ, productionGuard, baselineStore } = resources;

		loadArtifacts(forgeStore, (laErr, art) => {
			if (laErr) {
				xLog.error(`phase6 gate artifact load failed: ${laErr}`);
				process.exit(2);
			}
			const { curatedBlock, referenceNodes, sourceNodes, sourceStandard } = art;
			const curatedEdges = curatedBlock.edges || [];
			const curatedNodes = curatedBlock.nodes || [];
			const blockExactMatch = curatedEdges.filter((e) => e.type === 'EXACT_MATCH').length;
			const blockReifiedAs = curatedEdges.filter((e) => e.type === 'REIFIED_AS').length;
			const blockAsserts = curatedEdges.filter((e) => e.type === 'ASSERTS').length;

			const namedCase = curationFixture.qualifierConservativityNamedCase || {};
			const studentRefId = refStableIdByQualifier(referenceNodes, namedCase.qualifierA);
			const staffRefId = refStableIdByQualifier(referenceNodes, namedCase.qualifierB);
			// School/LEA was investigated and judged NOT must-never-merge (the EdOrg supertype legitimately maps
			// to both); the enforced different-property list is empty. We still use the investigated descriptor to
			// (a) prove the checkConservativity CAPABILITY with a synthetic bridge, and (b) assert the only real
			// bridge is the documented legitimate supertype source.
			const diffPair = (curationFixture.differentPropertyInvestigated || [])[0] || {};
			const propARefs = refStableIdsByProperty(referenceNodes, diffPair.propertyA);
			const propBRefs = refStableIdsByProperty(referenceNodes, diffPair.propertyB);
			const legitimateBridge = (diffPair.legitimateSupertypeBridge || []).slice().sort();

			const builder = equivalenceSubgraphFactory({
				curationPredicate: 'exactMatch',
				mappingJustification: 'semapv:ManualMappingCuration',
				subjectSource: sourceStandard,
				objectSource: 'CEDS',
				mappingTool: 'edf-equivalence',
			});

			const taskList = new taskListPlus();

			// ---- PURE TWIN 0: curation baseline == the curated block's nodes+edges ----
			taskList.push((args, next) => {
				const base = builder.buildCurationSubgraph({
					curationInputs: curationFixture.promotions,
					sourceNodes,
					referenceNodes,
				});
				const c = base.counts;
				const okEdges = c.curatedExactMatchEdges === blockExactMatch && c.reifyEdges === blockReifiedAs + blockAsserts;
				const okNodes = c.reifiedAssertionNodes === curatedNodes.length;
				record(
					'twinPure.curationBaselineMatchesBlock',
					okEdges && okNodes && c.curatedExactMatchEdges > 0 && c.orphans === 0 && c.fromGaps === 0,
					`pure derive: curatedExactMatch=${c.curatedExactMatchEdges} (block EXACT_MATCH=${blockExactMatch}), reifyEdges=${c.reifyEdges} (block REIFIED_AS+ASSERTS=${blockReifiedAs + blockAsserts}), MappingAssertion nodes=${c.reifiedAssertionNodes} (block nodes=${curatedNodes.length}); orphans=${c.orphans} fromGaps=${c.fromGaps}`,
				);
				next('', { ...args, base });
			});

			// ---- PURE: curator attribution materialized on every MappingAssertion (WHITEPAPER §6.1 the WHO) ----
			taskList.push((args, next) => {
				const blockCurators = curatedNodes.map((n) => v1((n.properties || {}).curator)).filter(Boolean);
				const deriveCurators = args.base.nodes.map((n) => (n.properties || {}).curator).filter(Boolean);
				const ok =
					curatedNodes.length > 0 &&
					blockCurators.length === curatedNodes.length &&
					deriveCurators.length === args.base.nodes.length;
				record(
					'twinPure.curatorAttributionMaterialized',
					ok,
					`MappingAssertion curators — block: ${JSON.stringify(blockCurators)} (${blockCurators.length}/${curatedNodes.length}); pure-derive: ${JSON.stringify(deriveCurators)} (${deriveCurators.length}/${args.base.nodes.length}) (every reified assertion must carry the curator/WHO)`,
				);
				next('', args);
			});

			// ---- PURE TWIN 1: reify-on-demand — 0 nodes/edges with no input, exactly N with the fixture ----
			taskList.push((args, next) => {
				const none = builder.buildCurationSubgraph({ curationInputs: [], sourceNodes, referenceNodes });
				const withInputs = args.base;
				const ok =
					none.counts.reifiedAssertionNodes === 0 &&
					none.counts.curatedExactMatchEdges === 0 &&
					withInputs.counts.reifiedAssertionNodes === curationFixture.promotions.length;
				record(
					'twinPure.reifyOnDemand',
					ok,
					`no curation input -> nodes=${none.counts.reifiedAssertionNodes}, edges=${none.counts.curatedExactMatchEdges} (must be 0/0); fixture (${curationFixture.promotions.length} promotions) -> MappingAssertion nodes=${withInputs.counts.reifiedAssertionNodes} (must equal ${curationFixture.promotions.length})`,
				);
				next('', args);
			});

			// ---- PURE TWIN 2: a non-resolving curation input materializes NOTHING ----
			taskList.push((args, next) => {
				const bogus = builder.buildCurationSubgraph({
					curationInputs: [{ fromStableId: curationFixture.promotions[0].fromStableId, targetPropertyKey: 'P001572', qualifierKey: 'OV_DOES_NOT_EXIST' }],
					sourceNodes,
					referenceNodes,
				});
				record(
					'twinPure.nonResolvingMaterializesNothing',
					bogus.counts.curatedExactMatchEdges === 0 && bogus.counts.reifiedAssertionNodes === 0 && bogus.counts.orphans === 1,
					`bogus qualifier -> edges=${bogus.counts.curatedExactMatchEdges}, nodes=${bogus.counts.reifiedAssertionNodes}, orphans=${bogus.counts.orphans} (must be 0/0/1 — no dangling edge)`,
				);
				next('', args);
			});

			// ---- PURE TWIN 3: the GENERAL STRUCTURAL invariant (same property, differing qualifier) ----
			// Uses checkQualifierConservativity (NO hardcoded pair — purely structural off the reference nodes).
			// student/staff is the named test: clean curated edges pass; injecting the staff source onto the
			// STUDENT ref makes one source EXACT_MATCH to two P001572 refs with different qualifiers -> violation.
			taskList.push((args, next) => {
				const curatedExact = args.base.edges
					.filter((e) => e.type === 'EXACT_MATCH')
					.map((e) => ({ fromId: e.fromRef.id, toId: e.toRef.id }));
				const clean = builder.checkQualifierConservativity({ exactMatchEdges: curatedExact, referenceNodes });
				const staffSource = curatedExact.find((e) => e.toId === staffRefId);
				const bridged = curatedExact.concat([{ fromId: staffSource.fromId, toId: studentRefId }]);
				const violated = builder.checkQualifierConservativity({ exactMatchEdges: bridged, referenceNodes });
				const viol = violated.violations[0] || {};
				record(
					'twinPure.generalQualifierConservativity',
					clean.pass === true && violated.pass === false && violated.violations.length === 1 && viol.propertyKey === namedCase.basePropertyKey,
					`structural invariant: disjoint curated edges -> pass=${clean.pass}; inject staff source '${staffSource.fromId.split('/').pop()}' onto the STUDENT ref -> pass=${violated.pass} (property=${viol.propertyKey}, qualifierSignatures=${JSON.stringify(viol.qualifierSignatures || [])})`,
				);
				next('', args);
			});

			// ---- PURE TWIN 4: the DIFFERENT-PROPERTY guard (School op-status vs LEA op-status) ----
			taskList.push((args, next) => {
				const pairs = [{ label: diffPair.label, refsA: propARefs, refsB: propBRefs }];
				const cleanEdges = [{ fromId: 'synthetic:onlyA', toId: propARefs[0] }];
				const clean = builder.checkConservativity({ exactMatchEdges: cleanEdges, mustNeverMergePairs: pairs });
				const bridgedEdges = cleanEdges.concat([{ fromId: 'synthetic:bridge', toId: propARefs[0] }, { fromId: 'synthetic:bridge', toId: propBRefs[0] }]);
				const violated = builder.checkConservativity({ exactMatchEdges: bridgedEdges, mustNeverMergePairs: pairs });
				record(
					'twinPure.differentPropertyConservativity',
					propARefs.length > 0 && propBRefs.length > 0 && clean.pass === true && violated.pass === false && violated.violations.length === 1,
					`School(${diffPair.propertyA}) refs=${propARefs.length}, LEA(${diffPair.propertyB}) refs=${propBRefs.length}; disjoint -> pass=${clean.pass}; one source EXACT_MATCH to BOTH properties -> pass=${violated.pass}, violations=${violated.violations.length}`,
				);
				next('', args);
			});

			// ---- GRAPH GATE ----
			taskList.push((args, next) => {
				productionGuard.assertSafeBuildTarget({ graphName: candidateGraph }, (gErr) => {
					if (gErr) {
						next(`productionGuard refused '${candidateGraph}': ${gErr}`);
						return;
					}
					lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
				});
			});
			taskList.push((args, next) => {
				xLog.status(`[phase6 gate] building candidate '${candidateGraph}'…`);
				graphBuilder.buildGraph({ manifestKey: candidateManifest, destination: candidateGraph, role: 'bronze' }, (bErr) => next(bErr, args));
			});
			// provenance: reference == frozen goldenAll
			taskList.push((args, next) => {
				baselineStore.readBaseline({ label: 'goldenAll' }, (bErr, baseline) => {
					if (bErr || !baseline || !baseline.meta || !baseline.meta.fingerprint) {
						record('reference.provenanceGoldenAll', false, `no usable goldenAll baseline: ${bErr || 'missing'}`);
						next('', args);
						return;
					}
					const scope = baseline.meta.scope || 'all';
					fingerprinter.fingerprintGraph({ graphName: referenceGraph, scope, ignoreEmbedding: !!baseline.meta.ignoreEmbedding, ignoreOwnerStamp: !!baseline.meta.ignoreOwnerStamp }, (fErr, live) => {
						if (fErr) {
							record('reference.provenanceGoldenAll', false, `reference provenance fingerprint failed: ${fErr}`);
							next('', args);
							return;
						}
						const matches = live.fingerprint === baseline.meta.fingerprint;
						record('reference.provenanceGoldenAll', matches && live.nodeCount > 0, `reference '${referenceGraph}' all-scope fp=${live.fingerprint.slice(0, 12)}… == frozen goldenAll ${baseline.meta.fingerprint.slice(0, 12)}…? ${matches} (it IS the gating golden)`);
						next('', args);
					});
				});
			});
			// fingerprint candidate + reference (all-scope, ignoreEmbedding, ignoreOwnerStamp) + diff
			taskList.push((args, next) => {
				fingerprinter.fingerprintGraph({ graphName: candidateGraph, ignoreEmbedding: true, scope: 'all', ignoreOwnerStamp: true }, (fErr, candFp) => {
					if (fErr) {
						next(`candidate fingerprint failed: ${fErr}`);
						return;
					}
					next('', { ...args, candFp });
				});
			});
			taskList.push((args, next) => {
				fingerprinter.fingerprintGraph({ graphName: referenceGraph, ignoreEmbedding: true, scope: 'all', ignoreOwnerStamp: true }, (fErr, refFp) => {
					if (fErr) {
						next(`reference fingerprint failed (is '${referenceGraph}' up?): ${fErr}`);
						return;
					}
					next('', { ...args, refFp });
				});
			});
			taskList.push((args, next) => {
				const diff = differ.diffManifests({ baseline: args.refFp.elementManifest, candidate: args.candFp.elementManifest });
				const s = diff.summary;
				record('diff.nothingRemovedOrChanged', s.removedNodes === 0 && s.changedNodes === 0 && s.removedEdges === 0, `removedNodes=${s.removedNodes} changedNodes=${s.changedNodes} removedEdges=${s.removedEdges} (all must be 0)`);
				record('diff.addedNodesAreReifiedAssertions', s.addedNodes === curatedNodes.length, `addedNodes=${s.addedNodes} (expect ${curatedNodes.length} reified MappingAssertion nodes)`);
				const addedByType = diff.edges.addedByType || {};
				const expectEdges = { EXACT_MATCH: blockExactMatch, REIFIED_AS: blockReifiedAs, ASSERTS: blockAsserts };
				const strayTypes = Object.keys(addedByType).filter((t) => !expectEdges[t]);
				const typesMatch =
					(addedByType.EXACT_MATCH || 0) === blockExactMatch &&
					(addedByType.REIFIED_AS || 0) === blockReifiedAs &&
					(addedByType.ASSERTS || 0) === blockAsserts &&
					strayTypes.length === 0;
				record('diff.addedEdgesExactlyCuration', s.addedEdges === curatedEdges.length && typesMatch, `addedEdges=${s.addedEdges} (expect ${curatedEdges.length}); addedByType=${JSON.stringify(addedByType)} (expect ${JSON.stringify(expectEdges)}); strayTypes=[${strayTypes.join(',')}]`);
				next('', args);
			});
			// gate 10 flip: candidate student ref >=2 sources; reference (pre-curation) had exactly 1
			taskList.push((args, next) => {
				const cypher = `
					MATCH (r:HubReference) WHERE $q IN r.qualifierKeys
					OPTIONAL MATCH (s)-[:EXACT_MATCH]->(r)
					WITH r, count(DISTINCT s) AS sourcesOnRef
					RETURN count(r) AS refs, coalesce(max(sourcesOnRef),0) AS maxSourcesOnOneRef
				`;
				queryOne(lifecycle, candidateGraph, cypher, { q: namedCase.qualifierA }, (qe, candRow) => {
					if (qe) { next(`gate10 candidate query failed: ${qe}`); return; }
					queryOne(lifecycle, referenceGraph, cypher, { q: namedCase.qualifierA }, (qe2, refRow) => {
						if (qe2) { next(`gate10 reference query failed: ${qe2}`); return; }
						const candMax = Number(candRow.maxSourcesOnOneRef || 0);
						const refMax = Number(refRow.maxSourcesOnOneRef || 0);
						record('gate10.studentEquivalenceClusterFlips', Number(candRow.refs || 0) >= 1 && candMax >= 2 && refMax === 1, `CANDIDATE: student ref maxDistinctExactMatchSources=${candMax} (must be >=2 — cluster forms); REFERENCE pre-curation=${refMax} (must be 1 — cluster did NOT exist; removing the SIF source would revert -> gate 10 RED)`);
						next('', args);
					});
				});
			});
			// gate 13a — the GENERAL STRUCTURAL invariant on the candidate: ZERO source is EXACT_MATCH to two
			// HubReferences that share a base property but differ in qualifier (the general studentId!=staffId form).
			const generalCypher = `
				MATCH (s)-[:EXACT_MATCH]->(r1:HubReference)
				MATCH (s)-[:EXACT_MATCH]->(r2:HubReference)
				WHERE r1.propertyKey = r2.propertyKey AND r1.qualifierKeys <> r2.qualifierKeys
				RETURN count(DISTINCT s) AS bridging
			`;
			taskList.push((args, next) => {
				queryOne(lifecycle, candidateGraph, generalCypher, {}, (qe, row) => {
					if (qe) { next(`gate13 general query failed: ${qe}`); return; }
					record('gate13.generalConservativityClean', Number(row.bridging || 0) === 0, `CANDIDATE: sources bridging two same-property different-qualifier refs=${Number(row.bridging || 0)} (must be 0 — general structural invariant; covers student/staff + all qualifier-distinct pairs)`);
					next('', { ...args, generalCypher });
				});
			});
			// gate 13b — School/LEA different-property bridge: assert the ONLY source bridging the two properties
			// is the DOCUMENTED legitimate supertype (EducationOrganization.OperationalStatusDescriptor). Records
			// the finding (School/LEA is NOT must-never-merge — a supertype legitimately maps to both) AND guards
			// against any NEW, undocumented different-property bridge appearing.
			taskList.push((args, next) => {
				const dpCypher = `
					MATCH (s)-[:EXACT_MATCH]->(rA:HubReference) WHERE rA.canonicalKey=$propA
					MATCH (s)-[:EXACT_MATCH]->(rB:HubReference) WHERE rB.canonicalKey=$propB
					RETURN collect(DISTINCT s.stableId) AS bridging
				`;
				lifecycle.runCypher({ graphName: candidateGraph, cypher: dpCypher, params: { propA: diffPair.propertyA, propB: diffPair.propertyB } }, (qe, result) => {
					if (qe) { next(`gate13 different-property query failed: ${qe}`); return; }
					const row = (result.records && result.records[0]) || {};
					const bridging = (row.bridging || []).slice().sort();
					const matchesDocumented = JSON.stringify(bridging) === JSON.stringify(legitimateBridge);
					record('gate13.differentPropertyOnlyLegitimateSupertypeBridge', matchesDocumented, `CANDIDATE sources bridging ${diffPair.propertyA}<->${diffPair.propertyB}=${JSON.stringify(bridging)} == documented legitimate supertype ${JSON.stringify(legitimateBridge)}? ${matchesDocumented} (School/LEA NOT must-never-merge — EdOrg supertype legitimately maps to both; a NEW bridge would RED this)`);
					next('', args);
				});
			});
			// gate 13c — the TWIN (the single most important demonstration): inject a staff->student EXACT_MATCH
			// (one source now EXACT_MATCH to two P001572 refs of different qualifier) -> the GENERAL invariant
			// goes RED; remove the injected edge -> restored.
			taskList.push((args, next) => {
				const inject = `
					MATCH (s)-[:EXACT_MATCH]->(rStaff:HubReference) WHERE $staff IN rStaff.qualifierKeys
					WITH s LIMIT 1
					MATCH (rStu:HubReference) WHERE $student IN rStu.qualifierKeys
					CREATE (s)-[:EXACT_MATCH {_twinInjected:true, predicate:'exactMatch', provenanceTier:'user-asserted'}]->(rStu)
					RETURN count(*) AS created
				`;
				lifecycle.runCypher({ graphName: candidateGraph, cypher: inject, params: { student: namedCase.qualifierA, staff: namedCase.qualifierB } }, (ie) => {
					if (ie) { next(`twin injection failed: ${ie}`); return; }
					queryOne(lifecycle, candidateGraph, args.generalCypher, {}, (qe, row) => {
						if (qe) { next(`twin general query failed: ${qe}`); return; }
						const bridgedNow = Number(row.bridging || 0);
						const cleanup = `MATCH ()-[r:EXACT_MATCH {_twinInjected:true}]->() DELETE r RETURN count(r) AS removed`;
						lifecycle.runCypher({ graphName: candidateGraph, cypher: cleanup, params: {} }, (ce) => {
							if (ce) { next(`twin cleanup failed: ${ce}`); return; }
							queryOne(lifecycle, candidateGraph, args.generalCypher, {}, (qe2, row2) => {
								if (qe2) { next(`twin restore query failed: ${qe2}`); return; }
								const restored = Number(row2.bridging || 0);
								record('gate13.conservativityTwinGoesRed', bridgedNow >= 1 && restored === 0, `inject staff->student EXACT_MATCH -> general-invariant bridging=${bridgedNow} (conservativity RED — the safety guarantee BITES); remove injected edge -> bridging=${restored} (restored to PASS)`);
								next('', args);
							});
						});
					});
				});
			});
			// replay determinism: rebuild SAME manifest -> identical all-scope fingerprint (no LLM)
			taskList.push((args, next) => {
				lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => {
					graphBuilder.buildGraph({ manifestKey: candidateManifest, destination: candidateGraph, role: 'bronze' }, (bErr) => {
						if (bErr) {
							next(`determinism rebuild failed: ${bErr}`);
							return;
						}
						fingerprinter.fingerprintGraph({ graphName: candidateGraph, ignoreEmbedding: true, scope: 'all', ignoreOwnerStamp: true }, (fErr, candFp2) => {
							if (fErr) {
								next(`determinism re-fingerprint failed: ${fErr}`);
								return;
							}
							record('replay.deterministicAcrossRebuild', candFp2.fingerprint === args.candFp.fingerprint, `rebuild all-scope fp=${candFp2.fingerprint.slice(0, 12)}… == first build ${args.candFp.fingerprint.slice(0, 12)}…? ${candFp2.fingerprint === args.candFp.fingerprint} (curation is durable manifest content; ZERO LLM at replay)`);
							next('', args);
						});
					});
				});
			});
			// teardown
			taskList.push((args, next) => {
				lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
			});

			pipeRunner(taskList.getList(), {}, (pErr) => {
				if (pErr) {
					xLog.error(`\n[phase6 gate] ERROR: ${pErr}`);
					console.log(JSON.stringify({ verdict: 'ERROR', error: `${pErr}`, checks }, null, 2));
					process.exit(2);
				}
				const failures = checks.filter((c) => !c.passed);
				const verdict = failures.length === 0 ? 'GREEN' : 'RED';
				console.log(JSON.stringify({ verdict, candidateManifest, referenceGraph, total: checks.length, failures: failures.length, checks }, null, 2));
				process.exit(verdict === 'GREEN' ? 0 : 1);
			});
		});
	});
};

run();
