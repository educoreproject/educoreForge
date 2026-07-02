#!/usr/bin/env node
'use strict';

// phase4Mapping.js — the PHASE-4 GATE OF RECORD (authored-crosswalk EXACT_MATCH mappings).
//
// Phase 4 converts the AUTHORED Ed-Fi CEDS crosswalk into EXACT_MATCH mapping EDGES (source element ->
// HubReference) PURELY (no LLM), via the version-bridge table for the 6 CEDS-remodeled person-ids. It is
// STRICTLY ADDITIVE and EDGE-ONLY (reify-on-demand -> zero MappingAssertion nodes), so the gate of record
// is an all-scope STRUCTURED diff of the candidate (golden + mapping edges) vs the pre-Phase-4 golden
// (phase3golden), asserting the diff is EXACTLY the declared added EXACT_MATCH edges (zero added nodes,
// zero removed, zero changed), PLUS:
//   - EXACT_MATCH edge count == the producer's deterministic total (918 distinct = 914 direct + 4
//     version-bridge after (source,ref) dedup of the 1000 property-target Yes rows);
//   - ACCURACY vs the CSV ground truth: every authored Yes-row CEDS target (385) is covered by an edge to a
//     HubReference whose canonical address matches that target; every edge resolves correctly for its cedsId;
//   - the 6 remodeled person-id targets resolve through the version-bridge; in particular the VERSION-BRIDGE
//     DISTINCTNESS contract (the conservativity-relevant half provable with Ed-Fi alone): Ed-Fi student
//     P001071 -> the Student-qualified Person-Identifier ref (OV002114100002) and staff P001070 -> the
//     Staff-qualified ref (OV002114100003), as DISTINCT references;
//   - mappings carry the authored-track SSSOM stamp (confidence 1.0, mappingJustification =
//     semapv:ManualMappingCuration, provenanceTier spec-authoritative) and NO embedding (no LLM);
//   - fault-injection TWINS observed failing then restored:
//       PURE-PRODUCER twin — drop the P001071 version-bridge entry -> that source goes ORPHAN, its edge
//         vanishes -> proves the version-bridge table is LOAD-BEARING (exactly the twin WILD_FALCON named);
//       GRAPH twin — merge the staff mapping onto the student ref -> the distinctness gate goes RED -> restore.
//
// Builds the candidate into an isolated scratch graph; reference is the pre-Phase-4 golden (phase3golden).
// Never touches the production golden (productionGuard). Mirrors phase3HubReference.js.
//
// Usage:
//   node phase4Mapping.js --candidateManifest=<key> [--reference=phase3golden] [--candidate=phase4cand]
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
const GROUND_TRUTH = path.join(__dirname, '..', 'lib', 'ground-truth', 'groundTruth');

const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const mappingSubgraphFactory = require(path.join(CORE_LIB, 'mapping-subgraph', 'mappingSubgraph'));
const versionBridge = require(path.join(projectRoot, 'code', 'cli', 'lib.d', 'edf-mapping', 'assets', 'versionBridge'));

// the DERIVED expectations (the producer's deterministic ROW-DRIVEN output for the EdFi authored crosswalk).
const EXPECTED_MAPPING_EDGES = 918; // distinct (source element, HubReference) EXACT_MATCH edges
const EXPECTED_TOTAL_YES_ROWS = 1046;
const EXPECTED_PROPERTY_MAPPINGS = 1000; // Yes rows carrying an ontology-property Global ID
const EXPECTED_TOKENLESS_ROWS = 46; // Yes rows with a named CEDS target but NO property Global ID (out of scope)
const EXPECTED_AUTHORED_TARGETS = 385; // distinct authored property-target Global IDs (379 direct + 6 remodeled)
const EXPECTED_REFERENCE_NODES = 105474; // pre-Phase-4 (Phase-3) all-scope golden node count (goldenAll)
const ALLOWED_ADDED_LABELS = []; // mappings are EDGES — zero added nodes
const ALLOWED_ADDED_EDGE_TYPES = ['EXACT_MATCH'];

// Appendix-B named keys + the Ed-Fi source anchors (the version-bridge cases).
const STUDENT_QUALIFIER = 'OV002114100002';
const STAFF_QUALIFIER = 'OV002114100003';
const STUDENT_OLD_ID = 'P001071'; // Ed-Fi StudentEducationOrganizationAssociation.IdentificationCode
const STAFF_OLD_ID = 'P001070'; // Ed-Fi Staff.IdentificationCode

const argVal = (name) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.replace(`--${name}=`, '') : null;
};
const candidateManifest = argVal('candidateManifest');
const referenceGraph = argVal('reference') || 'phase3golden';
const candidateGraph = argVal('candidate') || 'phase4cand';

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

// the authored crosswalk as ROW-DRIVEN mappings (the same authority the producer uses) + the distinct
// property-target set (for the accuracy check). Mirrors edf-mapping's loadAuthoredMappings.
const loadAuthored = () => {
	const groundTruth = require(GROUND_TRUTH)();
	const fx = groundTruth.loadFixtures();
	const header = fx.elements.header;
	const entityCol = header.find((c) => /^EdFiEntity$/i.test(c));
	const nameCol = header.find((c) => /^EdFiElementName$/i.test(c));
	const uriCol = header.find((c) => /CEDSOntologyPropertyURI/i.test(c));
	const confCol = header.find((c) => /CEDSMappingConfidence/i.test(c) || /MappingConfidence/i.test(c));
	const tokenOf = (uri) => {
		const m = `${uri}`.match(/#?(P\d{6,})\s*$/);
		return m ? m[1] : null;
	};
	const authoredMappings = [];
	const targets = new Set();
	let totalYes = 0;
	let tokenless = 0;
	fx.elements.records.forEach((r) => {
		if (`${r[confCol]}`.trim().toLowerCase() !== 'yes') return;
		totalYes++;
		const token = tokenOf(r[uriCol]);
		if (!token) { tokenless++; return; }
		targets.add(token);
		authoredMappings.push({ fromStableId: `edfi:field/${`${r[entityCol]}`.trim()}.${`${r[nameCol]}`.trim()}`, targetKey: token });
	});
	return { authoredMappings, targets, totalYes, tokenless };
};

// re-derive the mapping subgraph PURELY from the candidate manifest's source + reference blocks, with a
// caller-supplied version-bridge — for the PURE-PRODUCER twin (drop an entry -> observe the consequence).
const deriveFromManifest = (forgeStore, manifestKey, bridge, callback) => {
	const taskList = new taskListPlus();
	taskList.push((args, next) => {
		forgeStore.getManifest({ manifestKey }, (err, manifest) => {
			if (err) { next(err); return; }
			next('', { ...args, members: (manifest && manifest.members) || [] });
		});
	});
	taskList.push((args, next) => {
		const sub = new taskListPlus();
		let sourceRow = null;
		let referenceRow = null;
		args.members.forEach((oneMember) => {
			sub.push((a2, n2) => {
				forgeStore.getBlock({ blockId: oneMember.blockId }, (err, row) => {
					if (err) { n2(err); return; }
					if (row && row.type === 'standard' && row.subject === 'EdFi') sourceRow = row;
					if (row && row.type === 'reference' && row.subject === 'CEDS') referenceRow = row;
					n2('', a2);
				});
			});
		});
		pipeRunner(sub.getList(), {}, (err) => {
			if (err) { next(err); return; }
			next('', { ...args, sourceRow, referenceRow });
		});
	});
	pipeRunner(taskList.getList(), {}, (err, args) => {
		if (err) { callback(err); return; }
		const sourceBlock = replayBlock.deserializeBlock(args.sourceRow.text);
		const referenceBlock = replayBlock.deserializeBlock(args.referenceRow.text);
		const builder = mappingSubgraphFactory({ subjectSource: 'EdFi' });
		const result = builder.buildMappingSubgraph({
			authoredMappings: loadAuthored().authoredMappings,
			sourceNodes: sourceBlock.nodes,
			referenceNodes: referenceBlock.nodes,
			versionBridge: bridge,
		});
		callback('', result);
	});
};

const run = () => {
	if (!candidateManifest) {
		xLog.error('phase4 gate: no --candidateManifest. Aborting.');
		process.exit(2);
	}
	xLog.status(`[phase4 gate] candidate manifest ${candidateManifest.slice(0, 16)}…; reference '${referenceGraph}'; candidate graph '${candidateGraph}'`);

	buildSharedResources((err, resources) => {
		if (err) {
			xLog.error(`phase4 gate bootstrap failed: ${err}`);
			process.exit(2);
		}
		const { forgeStore, lifecycle, graphBuilder, fingerprinter, differ, productionGuard, baselineStore } = resources;
		const taskList = new taskListPlus();

		// 0) PURE-PRODUCER TWIN (no graph needed): full table resolves the student mapping; dropping the
		//    P001071 version-bridge entry makes that source ORPHAN and its edge vanish. Proves the table is
		//    load-bearing — exactly the twin named in the plan/handoff. Done first (cheap, graph-independent).
		taskList.push((args, next) => {
			deriveFromManifest(forgeStore, candidateManifest, versionBridge, (e1, full) => {
				if (e1) { next(`pure-producer full derive failed: ${e1}`); return; }
				const reduced = { hubName: versionBridge.hubName, entries: { ...versionBridge.entries } };
				delete reduced.entries[STUDENT_OLD_ID];
				deriveFromManifest(forgeStore, candidateManifest, reduced, (e2, dropped) => {
					if (e2) { next(`pure-producer reduced derive failed: ${e2}`); return; }
					const studentEdgeIn = (set) => set.edges.some((edge) => edge.properties.cedsAnchorKey === STUDENT_OLD_ID);
					const studentOrphanIn = (set) => set.orphans.some((o) => o.targetKey === STUDENT_OLD_ID);
					const fullHas = studentEdgeIn(full) && !studentOrphanIn(full);
					const droppedLost = !studentEdgeIn(dropped) && studentOrphanIn(dropped);
					record('twinPure.versionBridgeLoadBearing',
						fullHas && droppedLost && full.edges.length === EXPECTED_MAPPING_EDGES && dropped.edges.length === EXPECTED_MAPPING_EDGES - 1,
						`full: student edge present=${studentEdgeIn(full)} orphan=${studentOrphanIn(full)} edges=${full.edges.length}; dropP001071: student edge present=${studentEdgeIn(dropped)} orphan=${studentOrphanIn(dropped)} edges=${dropped.edges.length} (REQUIRED: full has edge+no orphan @${EXPECTED_MAPPING_EDGES}; dropped loses edge+gains orphan @${EXPECTED_MAPPING_EDGES - 1})`);
					next('', { ...args, fullDerive: full });
				});
			});
		});

		// 1) guard the candidate target + clean any prior instance
		taskList.push((args, next) => {
			productionGuard.assertSafeBuildTarget({ graphName: candidateGraph }, (gErr) => {
				if (gErr) { next(`productionGuard refused '${candidateGraph}': ${gErr}`); return; }
				lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
			});
		});

		// 2) build the candidate (golden + mapping edges) into the isolated scratch graph
		taskList.push((args, next) => {
			xLog.status(`[phase4 gate] building candidate '${candidateGraph}' from manifest…`);
			graphBuilder.buildGraph({ manifestKey: candidateManifest, destination: candidateGraph, role: 'bronze' }, (bErr, buildResult) => {
				if (bErr) { next(`candidate build failed: ${bErr}`); return; }
				next('', { ...args, buildResult });
			});
		});

		// 2b) PROVENANCE — prove the reference graph IS the pre-Phase-4 golden: its all-scope fingerprint
		//     (under the goldenAll baseline's own freeze settings) must equal the FROZEN goldenAll baseline.
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
					record('reference.provenanceGoldenAll', matches && live.nodeCount > 0, `reference '${referenceGraph}' all-scope fp=${live.fingerprint.slice(0, 12)}… == frozen goldenAll ${baseline.meta.fingerprint.slice(0, 12)}…? ${matches} (proves it is the pre-Phase-4 golden)`);
					next('', args);
				});
			});
		});

		// 3) fingerprint candidate + reference for the structured diff (all-scope, embedding-excluded,
		//    OWNER-STAMP IGNORED — additive diff independent of the owner label).
		taskList.push((args, next) => {
			fingerprinter.fingerprintGraph({ graphName: candidateGraph, ignoreEmbedding: true, scope: 'all', ignoreOwnerStamp: true }, (fErr, candFp) => {
				if (fErr) { next(`candidate fingerprint failed: ${fErr}`); return; }
				next('', { ...args, candFp });
			});
		});
		taskList.push((args, next) => {
			fingerprinter.fingerprintGraph({ graphName: referenceGraph, ignoreEmbedding: true, scope: 'all', ignoreOwnerStamp: true }, (fErr, refFp) => {
				if (fErr) { next(`reference fingerprint failed (is '${referenceGraph}' up?): ${fErr}`); return; }
				next('', { ...args, refFp });
			});
		});

		// 4) STRUCTURED DIFF — reference (pre-Phase-4 golden) vs candidate (golden + mapping edges)
		taskList.push((args, next) => {
			const { refFp, candFp } = args;
			record('reference.sane', refFp.nodeCount === EXPECTED_REFERENCE_NODES, `reference '${referenceGraph}' all-scope nodeCount=${refFp.nodeCount} (expect ${EXPECTED_REFERENCE_NODES})`);
			const diff = differ.diffManifests({ baseline: refFp.elementManifest, candidate: candFp.elementManifest });
			const s = diff.summary;

			// 4a) NOTHING pre-existing removed or changed, and ZERO added nodes (purely additive, edges only)
			record('diff.nothingRemovedOrChanged', s.removedNodes === 0 && s.changedNodes === 0 && s.removedEdges === 0, `removedNodes=${s.removedNodes} changedNodes=${s.changedNodes} removedEdges=${s.removedEdges} (all must be 0)`);
			record('diff.zeroAddedNodes', s.addedNodes === 0, `addedNodes=${s.addedNodes} (must be 0 — mappings are EDGES, reify-on-demand)`);

			// 4b) added edge count EXACTLY the derived mapping total
			record('diff.addedEdgeCountExact', s.addedEdges === EXPECTED_MAPPING_EDGES, `addedEdges=${s.addedEdges} (expect ${EXPECTED_MAPPING_EDGES} distinct authored EXACT_MATCH edges)`);

			// 4c) no added node labels at all
			const addedByLabel = diff.nodes.addedByLabel || {};
			const strayLabels = Object.keys(addedByLabel).filter((lbl) => ALLOWED_ADDED_LABELS.indexOf(lbl) === -1);
			record('diff.noAddedLabels', strayLabels.length === 0, `addedByLabel=${JSON.stringify(addedByLabel)} (must be empty)`);

			// 4d) every added edge is EXACT_MATCH and the tally is exact
			const addedByType = diff.edges.addedByType || {};
			const strayTypes = Object.keys(addedByType).filter((t) => ALLOWED_ADDED_EDGE_TYPES.indexOf(t) === -1);
			record('diff.onlyExactMatchAdded', strayTypes.length === 0 && (addedByType.EXACT_MATCH || 0) === EXPECTED_MAPPING_EDGES, `addedByType=${JSON.stringify(addedByType)}; strayTypes=[${strayTypes.join(',')}] (expect only EXACT_MATCH=${EXPECTED_MAPPING_EDGES})`);
			next('', { ...args, diff });
		});

		// 5) EXACT_MATCH edge count + provenance stamps on the candidate graph
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH ()-[r:EXACT_MATCH]->(:HubReference)
				RETURN
					count(r) AS edges,
					sum(CASE WHEN r.resolution='direct' THEN 1 ELSE 0 END) AS direct,
					sum(CASE WHEN r.resolution='versionBridge' THEN 1 ELSE 0 END) AS bridge,
					sum(CASE WHEN r.confidence=1.0 AND r.mappingJustification='semapv:ManualMappingCuration' AND r.provenanceTier='spec-authoritative' THEN 1 ELSE 0 END) AS authoredStamp
			`, {}, (qErr, row) => {
				if (qErr) { next(`edge count query failed: ${qErr}`); return; }
				const edges = Number(row.edges || 0), direct = Number(row.direct || 0), bridge = Number(row.bridge || 0), stamp = Number(row.authoredStamp || 0);
				// the dedup-attribution split (direct vs versionBridge) is informational; the load-bearing total +
				// the specific version-bridge resolutions (asserted below) are the invariants.
				record('count.exactMatchEdges', edges === EXPECTED_MAPPING_EDGES && direct + bridge === EXPECTED_MAPPING_EDGES && bridge >= 1, `EXACT_MATCH=${edges} (expect ${EXPECTED_MAPPING_EDGES}); direct=${direct} + versionBridge=${bridge} = ${direct + bridge} (sum must equal total; bridge>=1)`);
				record('provenance.authoredStampOnEveryEdge', stamp === EXPECTED_MAPPING_EDGES, `edges with {confidence=1.0, mappingJustification=semapv:ManualMappingCuration, provenanceTier=spec-authoritative}=${stamp}/${EXPECTED_MAPPING_EDGES} (authored track; no LLM)`);
				next('', args);
			});
		});

		// 5b) every EXACT_MATCH edge targets a real HubReference, and EVERY edge endpoint resolved (no dangling)
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH ()-[r:EXACT_MATCH]->(t)
				RETURN sum(CASE WHEN NOT t:HubReference THEN 1 ELSE 0 END) AS nonRefTargets, count(r) AS total
			`, {}, (qErr, row) => {
				if (qErr) { next(`target-type query failed: ${qErr}`); return; }
				const nonRef = Number(row.nonRefTargets || 0);
				record('integrity.allTargetsAreHubReferences', nonRef === 0, `EXACT_MATCH edges whose target is NOT a HubReference=${nonRef} (must be 0)`);
				next('', args);
			});
		});

		// 6) ACCURACY vs CSV — row-driven 100% reproduction: EVERY authored property-target is COVERED. Direct
		//    targets resolve by canonicalKey; the 6 remodeled targets resolve through the version-bridge to
		//    {P001572 (student/staff qualified), P001571, P000827}. coverage=0 uncovered is the contract.
		taskList.push((args, next) => {
			const authored = loadAuthored();
			const bridgeKeys = new Set(Object.keys(versionBridge.entries));
			const directTargets = [...authored.targets].filter((t) => !bridgeKeys.has(t));
			const bridgeResolutionKeys = ['P001572', 'P001571', 'P000827']; // the current targets the 6 remodel into
			queryOne(lifecycle, candidateGraph, `
				MATCH ()-[:EXACT_MATCH]->(r:HubReference)
				RETURN collect(DISTINCT r.canonicalKey) AS mappedKeys
			`, {}, (qErr, row) => {
				if (qErr) { next(`accuracy query failed: ${qErr}`); return; }
				const mapped = new Set((row.mappedKeys) || []);
				const uncoveredDirect = directTargets.filter((t) => !mapped.has(t));
				const uncoveredBridge = bridgeResolutionKeys.filter((k) => !mapped.has(k));
				record('accuracy.directTargetsCovered', uncoveredDirect.length === 0, `direct authored targets=${directTargets.length}; uncovered=${uncoveredDirect.length} [${uncoveredDirect.slice(0, 8).join(',')}] (every authored non-remodeled target has >=1 EXACT_MATCH edge to its canonicalKey ref)`);
				record('accuracy.versionBridgeTargetsCovered', uncoveredBridge.length === 0, `remodeled targets resolve to {${bridgeResolutionKeys.join(',')}}; uncovered=${uncoveredBridge.length} [${uncoveredBridge.join(',')}]`);
				const propertyMappings = authored.totalYes - authored.tokenless;
				record('accuracy.authoredCounts', authored.targets.size === EXPECTED_AUTHORED_TARGETS && authored.totalYes === EXPECTED_TOTAL_YES_ROWS && authored.tokenless === EXPECTED_TOKENLESS_ROWS && propertyMappings === EXPECTED_PROPERTY_MAPPINGS, `distinct property targets=${authored.targets.size} (expect ${EXPECTED_AUTHORED_TARGETS}); totalYesRows=${authored.totalYes} (expect ${EXPECTED_TOTAL_YES_ROWS}); tokenless(out-of-scope)=${authored.tokenless} (expect ${EXPECTED_TOKENLESS_ROWS}); property-target mappings=${propertyMappings} (expect ${EXPECTED_PROPERTY_MAPPINGS})`);
				next('', args);
			});
		});

		// 7) VERSION-BRIDGE DISTINCTNESS (the Phase-4 standing gate's contract; Appendix-B-adjacent, provable
		//    with Ed-Fi alone): Ed-Fi student P001071 -> Student-qualified ref; staff P001070 -> Staff-qualified
		//    ref; the two refs DISTINCT (overlap=0). Asserts DISTINCTNESS, not mere existence (Phase-3 gate-11
		//    discipline) — catches a version-bridge that conflated the two onto one reference.
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				OPTIONAL MATCH (s {_source:'EdFi', cedsId:$studentOld})-[:EXACT_MATCH]->(rs:HubReference)
				WITH collect(DISTINCT rs) AS stuRefs
				OPTIONAL MATCH (t {_source:'EdFi', cedsId:$staffOld})-[:EXACT_MATCH]->(rt:HubReference)
				WITH stuRefs, collect(DISTINCT rt) AS staffRefs
				RETURN
					size(stuRefs) AS stu, size(staffRefs) AS staff,
					size([x IN stuRefs WHERE $studentQ IN x.qualifierKeys]) AS stuQual,
					size([x IN staffRefs WHERE $staffQ IN x.qualifierKeys]) AS staffQual,
					size([x IN stuRefs WHERE x IN staffRefs]) AS overlap
			`, { studentOld: STUDENT_OLD_ID, staffOld: STAFF_OLD_ID, studentQ: STUDENT_QUALIFIER, staffQ: STAFF_QUALIFIER }, (qErr, row) => {
				if (qErr) { next(`version-bridge distinctness query failed: ${qErr}`); return; }
				const stu = Number(row.stu || 0), staff = Number(row.staff || 0), stuQual = Number(row.stuQual || 0), staffQual = Number(row.staffQual || 0), overlap = Number(row.overlap || 0);
				record('versionBridge.studentStaffDistinct', stu >= 1 && staff >= 1 && stuQual === stu && staffQual === staff && overlap === 0, `studentRefs=${stu} (qualified=${stuQual}) staffRefs=${staff} (qualified=${staffQual}) overlap=${overlap} (REQUIRED: each maps to its OWN type-qualified ref AND the two are DISTINCT, overlap=0)`);
				next('', { ...args, ...{} });
			});
		});

		// 8) GRAPH TWIN — merge the staff mapping onto the STUDENT ref (the equivalence-conflation this gate
		//    exists to catch). The distinctness check MUST go RED (overlap>0); then restore -> GREEN.
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				MATCH (t {_source:'EdFi', cedsId:$staffOld})-[r:EXACT_MATCH]->(staffRef:HubReference)
				MATCH (s {_source:'EdFi', cedsId:$studentOld})-[:EXACT_MATCH]->(stuRef:HubReference)
				WITH t, r, staffRef, stuRef LIMIT 1
				WITH t, staffRef.stableId AS origStaffRefId, stuRef
				MATCH (t)-[r2:EXACT_MATCH]->(:HubReference)
				DELETE r2
				CREATE (t)-[:EXACT_MATCH {resolution:'versionBridge', mergedTwin:true}]->(stuRef)
				RETURN origStaffRefId, stuRef.stableId AS stuRefId, t.stableId AS staffSrcId
			`, { staffOld: STAFF_OLD_ID, studentOld: STUDENT_OLD_ID }, (qErr, row) => {
				if (qErr) { next(`twinGraph merge failed: ${qErr}`); return; }
				next('', { ...args, origStaffRefId: row.origStaffRefId, staffSrcId: row.staffSrcId });
			});
		});
		taskList.push((args, next) => {
			queryOne(lifecycle, candidateGraph, `
				OPTIONAL MATCH (s {_source:'EdFi', cedsId:$studentOld})-[:EXACT_MATCH]->(rs:HubReference)
				WITH collect(DISTINCT rs) AS stuRefs
				OPTIONAL MATCH (t {_source:'EdFi', cedsId:$staffOld})-[:EXACT_MATCH]->(rt:HubReference)
				WITH stuRefs, collect(DISTINCT rt) AS staffRefs
				RETURN size([x IN stuRefs WHERE x IN staffRefs]) AS overlap
			`, { studentOld: STUDENT_OLD_ID, staffOld: STAFF_OLD_ID }, (qErr, row) => {
				if (qErr) { next(`twinGraph recheck failed: ${qErr}`); return; }
				const overlap = Number(row.overlap || 0);
				record('twinGraph.mergedMappingMakesDistinctnessRed', overlap > 0, `merged staff mapping onto the student ref -> overlap now ${overlap} (must be > 0 — distinctness gate observed failing)`);
				next('', args);
			});
		});
		// 8b) restore the twin -> distinctness GREEN again
		taskList.push((args, next) => {
			lifecycle.runCypher({ graphName: candidateGraph, cypher: `
				MATCH (t {stableId:$staffSrcId})-[r:EXACT_MATCH {mergedTwin:true}]->(:HubReference) DELETE r
				WITH t MATCH (origRef:HubReference {stableId:$origStaffRefId})
				CREATE (t)-[:EXACT_MATCH {resolution:'versionBridge', confidence:1.0, mappingJustification:'semapv:ManualMappingCuration', provenanceTier:'spec-authoritative', subjectSource:'EdFi', objectSource:'CEDS', mappingTool:'edf-mapping', cedsAnchorKey:$staffOld}]->(origRef)
				RETURN count(*) AS hit
			`, params: { staffSrcId: args.staffSrcId, origStaffRefId: args.origStaffRefId, staffOld: STAFF_OLD_ID } }, (sErr) => {
				if (sErr) { next(`twinGraph restore failed: ${sErr}`); return; }
				queryOne(lifecycle, candidateGraph, `
					OPTIONAL MATCH (s {_source:'EdFi', cedsId:$studentOld})-[:EXACT_MATCH]->(rs:HubReference)
					WITH collect(DISTINCT rs) AS stuRefs
					OPTIONAL MATCH (t {_source:'EdFi', cedsId:$staffOld})-[:EXACT_MATCH]->(rt:HubReference)
					WITH stuRefs, collect(DISTINCT rt) AS staffRefs
					RETURN size(stuRefs) AS stu, size(staffRefs) AS staff, size([x IN stuRefs WHERE x IN staffRefs]) AS overlap
				`, { studentOld: STUDENT_OLD_ID, staffOld: STAFF_OLD_ID }, (qErr, row) => {
					if (qErr) { next(`twinGraph restore recheck failed: ${qErr}`); return; }
					const stu = Number(row.stu || 0), staff = Number(row.staff || 0), overlap = Number(row.overlap || 0);
					record('twinGraph.restoreMakesDistinctnessGreen', stu >= 1 && staff >= 1 && overlap === 0, `restored staff mapping -> studentRefs=${stu} staffRefs=${staff} overlap=${overlap} (distinctness restored GREEN)`);
					next('', args);
				});
			});
		});

		// 9) teardown the candidate scratch graph (disposable; the suite rebuilds it)
		taskList.push((args, next) => {
			lifecycle.destroyInstanceByName({ graphName: candidateGraph, force: true }, () => next('', args));
		});

		pipeRunner(taskList.getList(), {}, (pErr) => {
			if (pErr) {
				xLog.error(`\n[phase4 gate] ERROR: ${pErr}`);
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
