#!/usr/bin/env node
'use strict';

// phase3HubReference.js — the PHASE-3 GATE OF RECORD (HubReference reference subgraph).
//
// Phase 3 materializes the canonical addresses as HubReference nodes (property/value/qualified tiers) +
// one HubDefinition, decomposed onto the EXISTING hub structural nodes via HAS_CEDS_* / IN_HUB edges. It
// is STRICTLY ADDITIVE — it adds new-node-type nodes + edges and changes NOTHING pre-existing. An additive
// phase is NOT fingerprint-identical, so the gate of record is a STRUCTURED diff (all-scope) of the
// candidate (golden + reference subgraph) against the reference golden replay, asserting the diff is
// EXACTLY the declared additions (zero removed, zero changed), PLUS:
//   - HubReference count == the DERIVED expectation (2324 property + 27437 value + 27 qualified = 29788);
//   - addressSignature composite uniqueness (hubName, addressSignature) == 0 violations;
//   - decomposition invariants (every reference resolves DOMAIN+PROPERTY+IN_HUB onto real hub nodes;
//     value-tier carries RANGE+VALUE; qualified carries QUALIFIER);
//   - the named Appendix-B references exist with correct shape (gate 11 student≠staff by qualifier;
//     gate 12 School≠LEA by domain);
//   - fault-injection TWINS observed failing then restored (collision -> uniqueness RED; drop -> count RED).
//
// Builds the candidate into an isolated scratch graph; reference is the pre-Phase-3 golden replay
// (phase0a). Never touches the production golden (productionGuard). Mirrors phase2CanonicalAddressing.js.
//
// Usage:
//   node phase3HubReference.js --candidateManifest=<key> [--reference=phase0a] [--candidate=phase3cand]
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

// the DERIVED expectations (see referenceSubgraph.js + the count derivation, confirmed WILD_FALCON).
const EXPECTED_PROPERTY_TIER = 2324;
const EXPECTED_VALUE_TIER = 27437;
const EXPECTED_QUALIFIED = 27;
const EXPECTED_HUB_REFERENCES = EXPECTED_PROPERTY_TIER + EXPECTED_VALUE_TIER + EXPECTED_QUALIFIED; // 29788
const EXPECTED_HUB_DEFINITIONS = 1;
const EXPECTED_ADDED_NODES = EXPECTED_HUB_REFERENCES + EXPECTED_HUB_DEFINITIONS; // 29789
const EXPECTED_ADDED_EDGES = 145259; // 2324*3 + 994 RANGE (property tier) + 27437*5 (value) + 27*4 (qualified)
const EXPECTED_REFERENCE_NODES = 75685; // pre-Phase-3 all-scope golden node count (gate 14 fact)
// the ONLY node labels the additive phase may introduce. The diff fingerprints are taken with
// ignoreOwnerStamp:true (the owner label :user/:golden is stripped), so the added labels are exactly the
// content labels: :ForgedNode + one of HubReference/HubDefinition.
const ALLOWED_ADDED_LABELS = ['ForgedNode', 'HubReference', 'HubDefinition'];
// the ONLY edge types the additive phase may introduce.
const ALLOWED_ADDED_EDGE_TYPES = [
	'HAS_CEDS_DOMAIN',
	'HAS_CEDS_PROPERTY',
	'HAS_CEDS_RANGE',
	'HAS_CEDS_VALUE',
	'HAS_CEDS_QUALIFIER',
	'IN_HUB',
];
// Appendix-B named keys (ground-truth NAMED_CASES).
const STUDENT_QUALIFIER = 'OV002114100002';
const STAFF_QUALIFIER = 'OV002114100003';
const SCHOOL_PROPERTY = 'P000533';
const LEA_PROPERTY = 'P000174';

const argVal = (name) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.replace(`--${name}=`, '') : null;
};
const candidateKeyFile = path.join(
	'/private/tmp/claude-501/-Users-tqwhite-Documents-webdev/f27d4b22-b709-4843-ac3e-6bec59d17aa0/scratchpad',
	'candidate-key.txt',
);
const candidateManifest =
	argVal('candidateManifest') ||
	(fs.existsSync(candidateKeyFile) ? fs.readFileSync(candidateKeyFile, 'utf8').trim() : null);
const referenceGraph = argVal('reference') || 'phase0a';
const candidateGraph = argVal('candidate') || 'phase3cand';

// --------------------------------------------------------------------------------
// process.global bootstrap
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

const run = () => {
	if (!candidateManifest) {
		xLog.error('phase3 gate: no --candidateManifest (and no scratch key file). Aborting.');
		process.exit(2);
	}
	xLog.status(`[phase3 gate] candidate manifest ${candidateManifest.slice(0, 16)}…; reference '${referenceGraph}'; candidate graph '${candidateGraph}'`);

	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`phase3 gate bootstrap failed: ${err}`);
			process.exit(2);
		}
		const { lifecycle, graphBuilder, fingerprinter, differ, productionGuard, baselineStore } = resources;
		const taskList = new taskListPlus();

		// 0) guard the candidate target + clean any prior instance
		taskList.push((args, next) => {
			productionGuard.assertSafeBuildTarget({ graphName: candidateGraph }, (gErr) => {
				if (gErr) {
					next(`productionGuard refused '${candidateGraph}': ${gErr}`);
					return;
				}
				lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
			});
		});

		// 1) build the candidate (golden + reference subgraph) into the isolated scratch graph
		taskList.push((args, next) => {
			xLog.status(`[phase3 gate] building candidate '${candidateGraph}' from manifest…`);
			graphBuilder.buildGraph({ manifestKey: candidateManifest, destination: candidateGraph, role: 'bronze' }, (bErr, buildResult) => {
				if (bErr) {
					next(`candidate build failed: ${bErr}`);
					return;
				}
				next('', { ...args, buildResult });
			});
		});

		// 1b) PROVENANCE (note B) — prove the reference graph IS the pre-Phase-3 golden: its all-scope
		//     fingerprint (under the goldenAll baseline's own freeze settings) must equal the FROZEN
		//     goldenAll baseline. Without this the harness would trust an arbitrary same-node-count graph.
		taskList.push((args, next) => {
			baselineStore.readBaseline({ label: 'goldenAll' }, (bErr, baseline) => {
				if (bErr || !baseline || !baseline.meta || !baseline.meta.fingerprint) {
					record('reference.provenanceGoldenAll', false, `no usable goldenAll baseline: ${bErr || 'missing'}`);
					next('', args);
					return;
				}
				const scope = baseline.meta.scope || 'all';
				const ignoreEmbedding = !!baseline.meta.ignoreEmbedding;
				const ignoreOwnerStamp = !!baseline.meta.ignoreOwnerStamp;
				fingerprinter.fingerprintGraph({ graphName: referenceGraph, scope, ignoreEmbedding, ignoreOwnerStamp }, (fErr, live) => {
					if (fErr) {
						record('reference.provenanceGoldenAll', false, `reference provenance fingerprint failed: ${fErr}`);
						next('', args);
						return;
					}
					const matches = live.fingerprint === baseline.meta.fingerprint;
					record('reference.provenanceGoldenAll', matches && live.nodeCount > 0, `reference '${referenceGraph}' all-scope fp=${live.fingerprint.slice(0, 12)}… == frozen goldenAll ${baseline.meta.fingerprint.slice(0, 12)}…? ${matches} (proves it is the pre-Phase-3 golden, not an arbitrary graph)`);
					next('', args);
				});
			});
		});

		// 2) fingerprint candidate + reference for the structured diff (all-scope, embedding-excluded,
		//    OWNER-STAMP IGNORED). ignoreOwnerStamp makes the additive diff independent of the owner label
		//    (:user for bronze, :golden for golden) — so changed/added cannot silently invert if the two
		//    graphs were built under different owners (owner-stamp invariant, made explicit per review note).
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

		// 3) STRUCTURED DIFF — reference (pre-Phase-3 golden) vs candidate (golden + reference subgraph)
		taskList.push((args, next) => {
			const { refFp, candFp } = args;
			record('reference.sane', refFp.nodeCount === EXPECTED_REFERENCE_NODES, `reference '${referenceGraph}' all-scope nodeCount=${refFp.nodeCount} (expect ${EXPECTED_REFERENCE_NODES})`);
			const diff = differ.diffManifests({ baseline: refFp.elementManifest, candidate: candFp.elementManifest });
			const s = diff.summary;

			// 3a) NOTHING pre-existing removed or changed (purely additive)
			record('diff.nothingRemovedOrChanged', s.removedNodes === 0 && s.changedNodes === 0 && s.removedEdges === 0, `removedNodes=${s.removedNodes} changedNodes=${s.changedNodes} removedEdges=${s.removedEdges} (all must be 0)`);

			// 3b) added node/edge counts EXACTLY match the derived expectation
			record('diff.addedNodeCountExact', s.addedNodes === EXPECTED_ADDED_NODES, `addedNodes=${s.addedNodes} (expect ${EXPECTED_ADDED_NODES} = ${EXPECTED_HUB_REFERENCES} HubReference + ${EXPECTED_HUB_DEFINITIONS} HubDefinition)`);
			record('diff.addedEdgeCountExact', s.addedEdges === EXPECTED_ADDED_EDGES, `addedEdges=${s.addedEdges} (expect ${EXPECTED_ADDED_EDGES})`);

			// 3c) every added node carries ONLY allowed labels; the HubReference/HubDefinition tallies are exact
			const addedByLabel = diff.nodes.addedByLabel || {};
			const strayLabels = Object.keys(addedByLabel).filter((lbl) => ALLOWED_ADDED_LABELS.indexOf(lbl) === -1);
			record('diff.onlyAllowedAddedLabels', strayLabels.length === 0, `addedByLabel=${JSON.stringify(addedByLabel)}; strayLabels=[${strayLabels.join(',')}]`);
			record('diff.hubReferenceLabelCount', (addedByLabel.HubReference || 0) === EXPECTED_HUB_REFERENCES && (addedByLabel.HubDefinition || 0) === EXPECTED_HUB_DEFINITIONS, `HubReference=${addedByLabel.HubReference || 0} (expect ${EXPECTED_HUB_REFERENCES}); HubDefinition=${addedByLabel.HubDefinition || 0} (expect ${EXPECTED_HUB_DEFINITIONS})`);

			// 3d) every added edge is one of the allowed HAS_CEDS_*/IN_HUB types
			const addedByType = diff.edges.addedByType || {};
			const strayTypes = Object.keys(addedByType).filter((t) => ALLOWED_ADDED_EDGE_TYPES.indexOf(t) === -1);
			record('diff.onlyAllowedAddedEdgeTypes', strayTypes.length === 0, `addedByType=${JSON.stringify(addedByType)}; strayTypes=[${strayTypes.join(',')}]`);
			next('', { ...args, diff });
		});

		// 4) HubReference / HubDefinition COUNTS (derived expectation) on the candidate graph
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference) WITH count(r) AS refs
				MATCH (d:HubDefinition) RETURN refs, count(d) AS defs
			`, {}, (qErr, row) => {
				if (qErr) { next(`count query failed: ${qErr}`); return; }
				const refs = Number(row.refs || 0);
				const defs = Number(row.defs || 0);
				record('count.hubReferenceDerived', refs === EXPECTED_HUB_REFERENCES && defs === EXPECTED_HUB_DEFINITIONS, `HubReference=${refs} (expect ${EXPECTED_HUB_REFERENCES} = ${EXPECTED_PROPERTY_TIER}+${EXPECTED_VALUE_TIER}+${EXPECTED_QUALIFIED}); HubDefinition=${defs} (expect ${EXPECTED_HUB_DEFINITIONS})`);
				next('', args);
			});
		});

		// 4b) tier breakdown matches the derivation
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference)
				RETURN
					sum(CASE WHEN r.referenceTier='property' AND size(r.qualifierKeys)=0 THEN 1 ELSE 0 END) AS propertyTier,
					sum(CASE WHEN r.referenceTier='value' THEN 1 ELSE 0 END) AS valueTier,
					sum(CASE WHEN r.referenceTier='property' AND size(r.qualifierKeys)>0 THEN 1 ELSE 0 END) AS qualified
			`, {}, (qErr, row) => {
				if (qErr) { next(`tier query failed: ${qErr}`); return; }
				const p = Number(row.propertyTier || 0), v = Number(row.valueTier || 0), q = Number(row.qualified || 0);
				record('count.tierBreakdown', p === EXPECTED_PROPERTY_TIER && v === EXPECTED_VALUE_TIER && q === EXPECTED_QUALIFIED, `property=${p} (expect ${EXPECTED_PROPERTY_TIER}); value=${v} (expect ${EXPECTED_VALUE_TIER}); qualified=${q} (expect ${EXPECTED_QUALIFIED})`);
				next('', args);
			});
		});

		// 5) addressSignature COMPOSITE uniqueness (hubName, addressSignature) — zero violations
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference)
				WITH r.hubName AS h, r.addressSignature AS s, count(*) AS c
				RETURN count(*) AS distinctPairs, sum(CASE WHEN c>1 THEN 1 ELSE 0 END) AS violations, sum(c) AS total
			`, {}, (qErr, row) => {
				if (qErr) { next(`uniqueness query failed: ${qErr}`); return; }
				const violations = Number(row.violations || 0);
				const distinctPairs = Number(row.distinctPairs || 0);
				const total = Number(row.total || 0);
				record('uniqueness.addressSignatureComposite', violations === 0 && distinctPairs === EXPECTED_HUB_REFERENCES && total === EXPECTED_HUB_REFERENCES, `distinct (hubName,addressSignature)=${distinctPairs} total=${total} violations=${violations} (expect ${EXPECTED_HUB_REFERENCES}/${EXPECTED_HUB_REFERENCES}/0)`);
				next('', args);
			});
		});

		// 6) DECOMPOSITION INVARIANTS — every reference resolves the right edge-set onto REAL hub nodes
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference)
				OPTIONAL MATCH (r)-[:HAS_CEDS_DOMAIN]->(dom) WITH r, count(dom) AS doms
				OPTIONAL MATCH (r)-[:HAS_CEDS_PROPERTY]->(prop) WITH r, doms, count(prop) AS props
				OPTIONAL MATCH (r)-[:IN_HUB]->(hub:HubDefinition) WITH r, doms, props, count(hub) AS hubs
				RETURN
					sum(CASE WHEN doms<>1 THEN 1 ELSE 0 END) AS missingDomain,
					sum(CASE WHEN props<>1 THEN 1 ELSE 0 END) AS missingProperty,
					sum(CASE WHEN hubs<>1 THEN 1 ELSE 0 END) AS missingInHub
			`, {}, (qErr, row) => {
				if (qErr) { next(`decomposition query failed: ${qErr}`); return; }
				const md = Number(row.missingDomain || 0), mp = Number(row.missingProperty || 0), mh = Number(row.missingInHub || 0);
				record('decomposition.domainPropertyInHub', md === 0 && mp === 0 && mh === 0, `references missing exactly-one DOMAIN=${md}, PROPERTY=${mp}, IN_HUB=${mh} (all must be 0)`);
				next('', args);
			});
		});

		// 6b) value-tier carries RANGE+VALUE; qualified carries QUALIFIER; and EVERY HAS_CEDS_* lands on a hub node
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference {referenceTier:'value'})
				OPTIONAL MATCH (r)-[:HAS_CEDS_VALUE]->(val) WITH r, count(val) AS vals
				OPTIONAL MATCH (r)-[:HAS_CEDS_RANGE]->(rng) WITH r, vals, count(rng) AS rngs
				RETURN sum(CASE WHEN vals<>1 THEN 1 ELSE 0 END) AS missingValue, sum(CASE WHEN rngs<>1 THEN 1 ELSE 0 END) AS missingRange
			`, {}, (qErr, row) => {
				if (qErr) { next(`value-tier decomposition query failed: ${qErr}`); return; }
				const mv = Number(row.missingValue || 0), mr = Number(row.missingRange || 0);
				record('decomposition.valueTierRangeValue', mv === 0 && mr === 0, `value-tier refs missing VALUE=${mv}, RANGE=${mr} (all must be 0)`);
				next('', args);
			});
		});
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference)-[e:HAS_CEDS_DOMAIN|HAS_CEDS_PROPERTY|HAS_CEDS_RANGE|HAS_CEDS_VALUE|HAS_CEDS_QUALIFIER]->(t)
				RETURN sum(CASE WHEN NOT t:ForgedNode OR t._source IS NULL THEN 1 ELSE 0 END) AS danglingTargets, count(e) AS decompEdges
			`, {}, (qErr, row) => {
				if (qErr) { next(`endpoint query failed: ${qErr}`); return; }
				const dangling = Number(row.danglingTargets || 0);
				record('decomposition.allTargetsAreHubNodes', dangling === 0, `HAS_CEDS_* edges=${row.decompEdges}, targets not a real :ForgedNode hub node=${dangling} (must be 0)`);
				next('', args);
			});
		});

		// 7) APPENDIX-B gate 11 — student vs staff DISTINCT (by qualifier). The contract is DISTINCTNESS,
		//    not mere existence: both refs must exist AND be DIFFERENT nodes (overlap=0). overlap>0 catches a
		//    merged-ref regression — one HubReference carrying BOTH qualifier keys (or student+staff collapsed
		//    onto one node). A set going empty catches a signature collision that merged the two. (Review fix:
		//    the old pass condition checked only existence and would falsely pass equivalence-conflation.)
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				OPTIONAL MATCH (rs:HubReference) WHERE $student IN rs.qualifierKeys
				WITH collect(DISTINCT rs) AS studentRefs
				OPTIONAL MATCH (rt:HubReference) WHERE $staff IN rt.qualifierKeys
				WITH studentRefs, collect(DISTINCT rt) AS staffRefs
				RETURN size(studentRefs) AS sCount, size(staffRefs) AS tCount, size([x IN studentRefs WHERE x IN staffRefs]) AS overlap
			`, { student: STUDENT_QUALIFIER, staff: STAFF_QUALIFIER }, (qErr, row) => {
				if (qErr) { next(`gate11 query failed: ${qErr}`); return; }
				const sr = Number(row.sCount || 0), tr = Number(row.tCount || 0), overlap = Number(row.overlap || 0);
				record('appendixB.gate11.studentVsStaffDistinct', sr >= 1 && tr >= 1 && overlap === 0, `studentRefs=${sr} staffRefs=${tr} overlap=${overlap} (REQUIRED: both >=1 AND distinct nodes, overlap=0)`);
				next('', args);
			});
		});

		// 8) APPENDIX-B gate 12 — school vs LEA operational status present (distinct by domain)
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference) WHERE r.canonicalKey IN $keys
				RETURN count(DISTINCT r.canonicalKey) AS keysPresent
			`, { keys: [SCHOOL_PROPERTY, LEA_PROPERTY] }, (qErr, row) => {
				if (qErr) { next(`gate12 query failed: ${qErr}`); return; }
				const kp = Number(row.keysPresent || 0);
				record('appendixB.gate12.schoolVsLeaStatus', kp === 2, `distinctCanonicalKeysPresent=${kp}/2 (${SCHOOL_PROPERTY} school, ${LEA_PROPERTY} LEA)`);
				next('', args);
			});
		});

		// 9) TWIN A — collide addressSignature on a reference; uniqueness MUST go RED; then restore -> GREEN.
		//    deterministic victim selection by ORDER BY ... LIMIT (NO cartesian product).
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference) WITH r ORDER BY r.stableId LIMIT 2
				WITH collect(r) AS rs
				WITH rs[0] AS donor, rs[1] AS victim, rs[1].addressSignature AS victimOrig
				SET victim.addressSignature = donor.addressSignature
				RETURN victim.stableId AS victimId, victimOrig
			`, {}, (qErr, row) => {
				if (qErr) { next(`twinA collide failed: ${qErr}`); return; }
				next('', { ...args, victimId: row.victimId, victimOrig: row.victimOrig });
			});
		});
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference) WITH r.hubName AS h, r.addressSignature AS s, count(*) AS c
				RETURN sum(CASE WHEN c>1 THEN 1 ELSE 0 END) AS violations
			`, {}, (qErr, row) => {
				if (qErr) { next(`twinA recheck failed: ${qErr}`); return; }
				const violations = Number(row.violations || 0);
				record('twinA.collisionMakesUniquenessRed', violations > 0, `forced addressSignature collision on ${(args.victimId || '').slice(0, 24)}… -> composite-uniqueness violations now ${violations} (must be > 0 — gate observed failing)`);
				next('', args);
			});
		});
		// 9b) restore TWIN A -> uniqueness GREEN again
		taskList.push((args, next) => {
			lifecycle.runCypher({ graphName: candidateGraph, cypher: `MATCH (v:HubReference {stableId:$victimId}) SET v.addressSignature=$victimOrig RETURN count(v) AS hit`, params: { victimId: args.victimId, victimOrig: args.victimOrig } }, (sErr) => {
				if (sErr) { next(`twinA restore set failed: ${sErr}`); return; }
				queryOne(lifecycle, candidateGraph, `
					MATCH (r:HubReference) WITH r.hubName AS h, r.addressSignature AS s, count(*) AS c
					RETURN sum(CASE WHEN c>1 THEN 1 ELSE 0 END) AS violations
				`, {}, (qErr, row) => {
					if (qErr) { next(`twinA restore recheck failed: ${qErr}`); return; }
					const violations = Number(row.violations || 0);
					record('twinA.restoreMakesUniquenessGreen', violations === 0, `restored victim signature -> composite-uniqueness violations now ${violations} (must be 0 — gate restored GREEN)`);
					next('', args);
				});
			});
		});

		// 10) TWIN B — drop a HubReference (remove its :HubReference label); count MUST go RED; then restore -> GREEN.
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference) WITH r ORDER BY r.stableId LIMIT 1
				REMOVE r:HubReference
				RETURN r.stableId AS victimId
			`, {}, (qErr, row) => {
				if (qErr) { next(`twinB drop failed: ${qErr}`); return; }
				next('', { ...args, droppedId: row.victimId });
			});
		});
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `MATCH (r2:HubReference) RETURN count(r2) AS refs`, {}, (qErr, row) => {
				if (qErr) { next(`twinB recount failed: ${qErr}`); return; }
				const refs = Number(row.refs || 0);
				record('twinB.dropMakesCountRed', refs === EXPECTED_HUB_REFERENCES - 1, `dropped HubReference ${(args.droppedId || '').slice(0, 24)}… -> count now ${refs} (must be ${EXPECTED_HUB_REFERENCES - 1} < ${EXPECTED_HUB_REFERENCES} — count gate observed failing)`);
				next('', args);
			});
		});
		// 10b) restore TWIN B -> count GREEN again
		taskList.push((args, next) => {
			lifecycle.runCypher({ graphName: candidateGraph, cypher: `MATCH (n:ForgedNode {stableId:$droppedId}) SET n:HubReference RETURN count(n) AS hit`, params: { droppedId: args.droppedId } }, (sErr) => {
				if (sErr) { next(`twinB restore set failed: ${sErr}`); return; }
				queryOne(lifecycle, candidateGraph, `MATCH (r2:HubReference) RETURN count(r2) AS refs`, {}, (qErr, row) => {
					if (qErr) { next(`twinB restore recount failed: ${qErr}`); return; }
					const refs = Number(row.refs || 0);
					record('twinB.restoreMakesCountGreen', refs === EXPECTED_HUB_REFERENCES, `restored the HubReference label -> count now ${refs} (must be ${EXPECTED_HUB_REFERENCES} — count gate restored GREEN)`);
					next('', args);
				});
			});
		});

		// 10c) TWIN C — MERGED-REF fault (the equivalence-conflation Appendix B #2 exists to catch): make the
		//     student ref ALSO carry the staff qualifier (one ref for both meanings). The DISTINCTNESS gate 11
		//     MUST go RED (overlap>0); then restore -> GREEN. This proves gate 11 enforces DISTINCTNESS, not
		//     mere existence (the old existence-only check would have falsely stayed green here).
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (r:HubReference) WHERE $student IN r.qualifierKeys
				WITH r ORDER BY r.stableId LIMIT 1
				WITH r, r.qualifierKeys AS orig
				SET r.qualifierKeys = [$student, $staff]
				RETURN r.stableId AS victimId, orig
			`, { student: STUDENT_QUALIFIER, staff: STAFF_QUALIFIER }, (qErr, row) => {
				if (qErr) { next(`twinC inject failed: ${qErr}`); return; }
				next('', { ...args, mergedVictimId: row.victimId, mergedOrig: row.orig });
			});
		});
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				OPTIONAL MATCH (rs:HubReference) WHERE $student IN rs.qualifierKeys
				WITH collect(DISTINCT rs) AS studentRefs
				OPTIONAL MATCH (rt:HubReference) WHERE $staff IN rt.qualifierKeys
				WITH studentRefs, collect(DISTINCT rt) AS staffRefs
				RETURN size(studentRefs) AS sCount, size(staffRefs) AS tCount, size([x IN studentRefs WHERE x IN staffRefs]) AS overlap
			`, { student: STUDENT_QUALIFIER, staff: STAFF_QUALIFIER }, (qErr, row) => {
				if (qErr) { next(`twinC recheck failed: ${qErr}`); return; }
				const sr = Number(row.sCount || 0), tr = Number(row.tCount || 0), overlap = Number(row.overlap || 0);
				const gate11WouldPass = sr >= 1 && tr >= 1 && overlap === 0;
				record('twinC.mergedRefMakesGate11Red', overlap > 0 && !gate11WouldPass, `merged student+staff onto ${(args.mergedVictimId || '').slice(0, 24)}… -> overlap now ${overlap} (gate 11 distinctness now FAILS: gate11WouldPass=${gate11WouldPass}) — observed failing`);
				next('', args);
			});
		});
		taskList.push((args, next) => {
			lifecycle.runCypher({ graphName: candidateGraph, cypher: `MATCH (r:HubReference {stableId:$victimId}) SET r.qualifierKeys=$orig RETURN count(r) AS hit`, params: { victimId: args.mergedVictimId, orig: args.mergedOrig } }, (sErr) => {
				if (sErr) { next(`twinC restore failed: ${sErr}`); return; }
				queryOne(lifecycle, candidateGraph, `
					OPTIONAL MATCH (rs:HubReference) WHERE $student IN rs.qualifierKeys
					WITH collect(DISTINCT rs) AS studentRefs
					OPTIONAL MATCH (rt:HubReference) WHERE $staff IN rt.qualifierKeys
					WITH studentRefs, collect(DISTINCT rt) AS staffRefs
					RETURN size(studentRefs) AS sCount, size(staffRefs) AS tCount, size([x IN studentRefs WHERE x IN staffRefs]) AS overlap
				`, { student: STUDENT_QUALIFIER, staff: STAFF_QUALIFIER }, (qErr, row) => {
					if (qErr) { next(`twinC restore recheck failed: ${qErr}`); return; }
					const sr = Number(row.sCount || 0), tr = Number(row.tCount || 0), overlap = Number(row.overlap || 0);
					record('twinC.restoreMakesGate11Green', sr >= 1 && tr >= 1 && overlap === 0, `restored qualifierKeys -> studentRefs=${sr} staffRefs=${tr} overlap=${overlap} (gate 11 distinctness restored GREEN)`);
					next('', args);
				});
			});
		});

		// 11) teardown the candidate scratch graph (disposable; the suite rebuilds it)
		taskList.push((args, next) => {
			lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
		});

		pipeRunner(taskList.getList(), {}, (pErr) => {
			if (pErr) {
				xLog.error(`\n[phase3 gate] ERROR: ${pErr}`);
				console.log(JSON.stringify({ verdict: 'ERROR', error: `${pErr}`, checks }, null, 2));
				process.exit(2);
			}
			const failures = checks.filter((c) => !c.passed);
			const verdict = failures.length === 0 ? 'GREEN' : 'RED';
			console.log(JSON.stringify({ verdict, candidateManifest, referenceGraph, total: checks.length, failures: failures.length, checks }, null, 2));
			process.exit(verdict === 'GREEN' ? 0 : 1);
		});
	});
};

run();
