#!/usr/bin/env node
'use strict';

// evaluate-against-golden.js — does the RECREATED pipeline still forge the standards accurately?
//
// It runs the real §4 Phase-A path end to end — forge -> init -> harvest — and compares the
// resulting schema block against the LIVE production golden.
//
// WHAT IS COMPARED, and why it is not bytes. The acceptance target changed on 2026-07-22
// (targetArchitectureDesign §0): the recreation mints its own schema-block lineage, so byte or
// blockId identity is meaningless by design. What must still be true is that we produce THE SAME
// SET OF THINGS — and "things" is NODES *and* EDGES. The durable identity of a node is its
// stableId; an edge's is fromStableId|type|toStableId. The comparison is a set comparison over
// both, scoped to the standard's SIX BASE ROLES.
//
// EDGES ARE COMPARED (fixed 2026-07-23, Item 5). Until then the comparison filtered to nodes only,
// on BOTH sides, so a forge change that dropped or renamed an entire edge class (SUBCLASS_OF,
// HAS_VALUE, REFERENCES) still exited 0 — the same class as the historical 0/0-green defect, a
// scope narrowing that reports success for a comparison it did not perform. The set arithmetic now
// lives in lib/golden-comparison, which REQUIRES both edge sets so an empty edge extraction is a
// fault rather than a silent pass.
//
// THE SCOPING IS NOT A CONVENIENCE, IT IS THE CORRECT COMPARISON. The golden's CEDS is the base
// forge PLUS the Phase-3 hub subgraph (~29,788 HubReference/HubDefinition nodes). A hub standard's
// base forge does not and should not contain them, so an unscoped comparison would report ~30k
// spurious "missing" nodes and mean nothing. Comparing base roles to base roles is the like-for-
// like question.
//
// READ-ONLY AGAINST THE GOLDEN, ALWAYS. The golden is opened with an explicit READ session by this
// script directly. replayManager is NOT used to reach it and never will be: its nameRefusal
// refuses GOLD_*/gf_* by name, and that guard is not relaxed "just for reading" — an evaluator
// that can read production through the same door that writes scratch graphs is one typo from being
// a writer. Two doors, one of which does not open.
//
// Spends a docker container per standard. No Voyage credit: stableIds do not depend on embeddings.
//
//   node evaluate-against-golden.js --standard=ceds --goldenPort=7942 --goldenPassword=<pw>
//   node evaluate-against-golden.js --standard=lif,ceds --goldenPort=7942 --goldenPassword=<pw>

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- compare the recreated pipeline's output against the live production golden

SYNOPSIS
     ${moduleName} --standard=<token[,token]> --goldenPort=<port> --goldenPassword=<pw>
                   [--goldenHost=localhost] [-keepGraph] [-verbose] [-help]

OPTIONS
     --standard=<token[,token]>   REQUIRED, and there is NO DEFAULT. Which standard(s) to
                                  compare against the golden. A comma list runs each in turn.
                                  It used to default to ceds, so a run that named nothing
                                  compared one standard and called that "the comparison".

     (there is no --vectorize)    This script NEVER vectorizes and spends no Voyage credit. The
                                  comparison is a SET comparison over stableIds, which do not
                                  depend on embeddings, so the forge is pinned to
                                  vectorize=false and the value is not settable. A --vectorize
                                  offered anyway is REFUSED rather than accepted and ignored.

DESCRIPTION
     Runs forge -> init -> harvest for each standard, then compares the harvested schema block's
     NODE stableId set AND its EDGE set (fromStableId|type|toStableId) against the golden's, scoped
     to the six DME base roles (an edge counts only when BOTH endpoints are base-role nodes).
     Reports missing, extra and identical for nodes and edges. The golden is opened READ-ONLY and is
     never written, never named to replayManager, and never touched by docker.

EXIT STATUS
     0 every standard's node AND edge set is identical to the golden's;  1 otherwise.
`;

const path = require('path');

const commandLineParameters = require('./testLib/testAppStartup')({
	moduleName,
	helpText: helpText(),
});

const harness = require('./testLib/harness')(moduleName);
const { parseListValue } = require('./testLib/parse-list-value');
const { xLog } = process.global;

const neo4j = require('neo4j-driver');

const TREE_ROOT = path.join(__dirname, '..');
const TREE_LIB = path.join(TREE_ROOT, 'lib');
const APPS = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps');

const replayManager = require(path.join(APPS, 'replay-manager', 'replayManager'))();
const forgerModule = require(path.join(APPS, 'forger', 'forger'));
const { DME_ROLES } = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary'));
const goldenComparison = require(path.join(TREE_LIB, 'golden-comparison', 'golden-comparison'))();

const BASE_GRAPH_LABEL = 'StandardBase';
const BASE_ROLES = Object.values(DME_ROLES);

// THE STANDARD SET IS ASKED FOR. `parseListValue(values.standard, ['ceds'])` gave this
// evaluator a silent default, so a run with no --standard compared ONLY CEDS and then reported
// success for "the comparison" with every other standard unexamined. --goldenPort and
// --goldenPassword below are required and loud; this flag is now held to the same rule
// (polyArch2 §6). An acceptance evaluator that decides for itself what it evaluated is not an
// acceptance evaluator.
const standardTokens = parseListValue(commandLineParameters.values.standard, []);
if (!standardTokens.length) {
	xLog.error(
		`${moduleName}: --standard is not set, and it is REQUIRED. It names WHAT is being ` +
			`compared against the golden, and there is no default: a run that quietly evaluated ` +
			`one standard and reported success for "the comparison" would be reporting a result ` +
			`nobody asked for. Give --standard=<token> or --standard=<token>,<token>.`,
	);
	process.exit(1);
}
const goldenHost = (commandLineParameters.values.goldenHost || ['localhost'])[0];
const goldenPort = (commandLineParameters.values.goldenPort || [])[0];
const goldenPassword = (commandLineParameters.values.goldenPassword || [])[0];
const keepGraph = !!commandLineParameters.switches.keepGraph;

// THE SPEND KNOB THIS SCRIPT DOES NOT HAVE. The forge below is pinned to vectorize:false, and the
// pin is correct: the comparison is a SET comparison over stableIds, and a stableId does not
// depend on an embedding, so Voyage credit spent here would buy exactly nothing. polyArch2 §6
// permits an in-code constant only where the value is NOT SETTABLE — which is the case here, and
// is now said out loud in -help instead of being a number nobody could see. What is NOT permitted
// is accepting a --vectorize and ignoring it: the operator who types a value believes it took
// effect, and here he would believe he was paying for embeddings he never got.
const VECTORIZE_IS_PINNED_OFF = false;
if (
	commandLineParameters.values.vectorize !== undefined ||
	commandLineParameters.switches.vectorize
) {
	xLog.error(
		`${moduleName}: --vectorize is not an option of this script, and it will not be silently ` +
			`ignored. The comparison is a SET comparison over stableIds, which do not depend on ` +
			`embeddings, so this run forges with vectorize=false ALWAYS and spends no Voyage ` +
			`credit. Remove the switch. (--vectorize=false is refused too: agreeing with the pin ` +
			`is still asking to set something this script does not let you set.)`,
	);
	process.exit(1);
}

if (!goldenPort || !goldenPassword) {
	xLog.error(
		`${moduleName}: --goldenPort and --goldenPassword are required. Resolve them with ` +
			`\`docker inspect <goldenName>\` — they are deliberately not discovered automatically, ` +
			`so nothing can wander into a production graph it was not explicitly pointed at.`,
	);
	process.exit(1);
}

// -----
// goldenGraph — READ-ONLY. Returns BOTH the node stableId set and the EDGE key set, scoped to the
// six base roles. Edges were never queried before, so a dropped or renamed edge class passed green
// (finding H2, the historical 0/0-green defect class); now they are compared like for like. The
// role filter is built from the vocabulary registry, not a literal list, so a role added to the
// registry cannot silently fall out of the comparison. An edge is in scope only when BOTH endpoints
// are base-role nodes of this source — the same scoping the node query uses, so the golden's hub
// subgraph does not leak spurious edges into the answer.
const goldenGraph = ({ source }, callback) => {
	const driver = neo4j.driver(
		`bolt://${goldenHost}:${goldenPort}`,
		neo4j.auth.basic('neo4j', goldenPassword),
		{ encrypted: false },
	);
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const nodeRoleClause = BASE_ROLES.map((oneRole) => `n:\`${oneRole}\``).join(' OR ');
	const endpointRoleClause = (variable) =>
		BASE_ROLES.map((oneRole) => `${variable}:\`${oneRole}\``).join(' OR ');
	const closeThen = (fn) => session.close().then(() => driver.close()).then(fn);

	session
		.run(
			`MATCH (n) WHERE n._source = $source AND (${nodeRoleClause})
			 RETURN n.stableId AS stableId`,
			{ source },
		)
		.then((nodeResult) => {
			const nodeIds = new Set();
			nodeResult.records.forEach((rec) => nodeIds.add(rec.get('stableId')));
			session
				.run(
					`MATCH (a)-[r]->(b)
					 WHERE a._source = $source AND b._source = $source
					   AND (${endpointRoleClause('a')}) AND (${endpointRoleClause('b')})
					 RETURN a.stableId AS fromId, type(r) AS relType, b.stableId AS toId`,
					{ source },
				)
				.then((edgeResult) => {
					const edgeKeys = new Set();
					edgeResult.records.forEach((rec) =>
						edgeKeys.add(`${rec.get('fromId')}|${rec.get('relType')}|${rec.get('toId')}`),
					);
					closeThen(() => callback('', { nodeIds, edgeKeys }));
				})
				.catch((edgeErr) => closeThen(() => callback(`golden edge query failed: ${edgeErr.message}`)));
		})
		.catch((nodeErr) => closeThen(() => callback(`golden node query failed: ${nodeErr.message}`)));
};

// -----
// harvestedGraph — the RECREATED path, whole: forge -> create -> init -> harvest -> delete. Returns
// the node stableId set AND the edge key set, both read from the harvested block's own lines and
// scoped to the six base roles (an edge counts only when both endpoints are base-role nodes).
const harvestedGraph = ({ token }, callback) => {
	const resolved = forgerModule.resolveBundle({ standard: token });
	if (resolved.error) {
		callback(resolved.error);
		return;
	}

	forgerModule().forge(
		{ standard: token, version: 'current', vectorize: VECTORIZE_IS_PINNED_OFF },
		(forgeErr, forged) => {
		if (forgeErr) {
			callback(forgeErr);
			return;
		}
		replayManager.create({ purpose: `${token}GoldEval` }, (createErr, handle) => {
			if (createErr) {
				callback(createErr);
				return;
			}
			const cleanupAnd = (err, payload) => {
				if (keepGraph) {
					xLog.status(`[${moduleName}] scratch graph '${handle.graphName}' KEPT`);
					callback(err, payload);
					return;
				}
				// BEST-EFFORT-DISPOSE-THEN-REPORT (Item 4). The evaluator spends a docker container per
				// standard, so a swallowed delete error leaks them silently across a multi-standard run.
				// The disposal error is REPORTED (it must not mask the evaluation err/payload we are
				// carrying), never dropped on the floor.
				replayManager.delete(handle, (deleteErr) => {
					if (deleteErr) {
						xLog.error(
							`[${moduleName}] scratch graph '${handle.graphName}' failed to dispose and may be ` +
								`leaking a docker container: ${deleteErr}`,
						);
					}
					callback(err, payload);
				});
			};
			replayManager.init(
				{
					inGraph: handle,
					nodeEdges: forged.nodeEdges,
					applyLabels: [BASE_GRAPH_LABEL],
					sourceLabel: `nodeEdges from forge bundle '${forged.standard}'`,
				},
				(initErr) => {
					if (initErr) {
						cleanupAnd(initErr);
						return;
					}
					replayManager.harvest(
						{
							inGraph: handle,
							selectionLabels: [BASE_GRAPH_LABEL],
							header: {
								blockType: 'standardBase',
								standardKey: forged.standard,
								version: forged.version,
								stableUriPropertyName: 'uri',
								resolutionKey: 'uri',
							},
						},
						(harvestErr, block) => {
							if (harvestErr) {
								cleanupAnd(harvestErr);
								return;
							}
							// Scope to the SAME six base roles the golden query uses, read from the
							// harvested block's own lines. Nodes first (so an edge's endpoints can be
							// checked against the base-role node set), then edges: an edge counts only
							// when BOTH endpoints are base-role nodes, and its key mirrors the golden's
							// fromStableId|type|toStableId (fromRef/toRef externalize the stableId value).
							const records = block.blockText
								.split('\n')
								.filter((oneLine) => oneLine.trim().length > 0)
								.map((oneLine) => JSON.parse(oneLine));

							const nodeIds = new Set();
							records
								.filter((rec) => rec.kind === 'node')
								.filter((rec) => (rec.labels || []).some((l) => BASE_ROLES.includes(l)))
								.forEach((rec) => nodeIds.add(rec.stableId));

							const edgeKeys = new Set();
							records
								.filter((rec) => rec.kind === 'edge')
								.forEach((rec) => {
									const fromId = rec.fromRef && rec.fromRef.id;
									const toId = rec.toRef && rec.toRef.id;
									if (nodeIds.has(fromId) && nodeIds.has(toId)) {
										edgeKeys.add(`${fromId}|${rec.type}|${toId}`);
									}
								});

							cleanupAnd('', {
								nodeIds,
								edgeKeys,
								blockId: block.blockId,
								source: forged.standard,
							});
						},
					);
				},
			);
		});
	});
};

// -----
const compareNext = (index) => {
	if (index >= standardTokens.length) {
		harness.report();
		return;
	}
	const token = standardTokens[index];
	xLog.status(`\n[${moduleName}] === ${token.toUpperCase()} ===`);

	harvestedGraph({ token }, (err, harvested) => {
		if (err) {
			harness.ok(`${token}: recreated pipeline produced a schema block`, false, err);
			compareNext(index + 1);
			return;
		}
		goldenGraph({ source: harvested.source }, (goldErr, golden) => {
			if (goldErr) {
				harness.ok(`${token}: golden queried`, false, goldErr);
				compareNext(index + 1);
				return;
			}

			// NODES AND EDGES, through the shared comparison. Edges used to be compared NOWHERE, so a
			// dropped/renamed edge class passed green (finding H2). compareGraph REQUIRES both edge
			// sets, so an accidentally-empty edge extraction is a fault here, not a silent pass.
			const comparison = goldenComparison.compareGraph({
				goldenNodeIds: golden.nodeIds,
				harvestedNodeIds: harvested.nodeIds,
				goldenEdgeKeys: golden.edgeKeys,
				harvestedEdgeKeys: harvested.edgeKeys,
			});

			harness.section(
				`${harvested.source} — recreated ${harvested.nodeIds.size} nodes / ${harvested.edgeKeys.size} edges ` +
					`vs golden ${golden.nodeIds.size} / ${golden.edgeKeys.size} (base roles)`,
			);
			xLog.status(`  recreated schema blockId: ${harvested.blockId}`);
			if (comparison.nodes.missing.length) {
				xLog.status(`  NODES MISSING (first 5): ${comparison.nodes.missing.slice(0, 5).join(', ')}`);
			}
			if (comparison.nodes.extra.length) {
				xLog.status(`  NODES EXTRA (first 5): ${comparison.nodes.extra.slice(0, 5).join(', ')}`);
			}
			if (comparison.edges.missing.length) {
				xLog.status(`  EDGES MISSING (first 5): ${comparison.edges.missing.slice(0, 5).join(', ')}`);
			}
			if (comparison.edges.extra.length) {
				xLog.status(`  EDGES EXTRA (first 5): ${comparison.edges.extra.slice(0, 5).join(', ')}`);
			}

			harness.ok(
				`${harvested.source}: the golden is non-empty (a comparison against nothing proves nothing)`,
				golden.nodeIds.size > 0,
				golden.nodeIds.size,
			);
			harness.ok(
				`${harvested.source}: the golden carries EDGES (an edge comparison against zero edges proves nothing)`,
				golden.edgeKeys.size > 0,
				golden.edgeKeys.size,
			);
			harness.equal(`${harvested.source}: nothing the golden has among NODES is MISSING`, comparison.nodes.missing.length, 0);
			harness.equal(`${harvested.source}: no NODE was invented (EXTRA)`, comparison.nodes.extra.length, 0);
			harness.equal(`${harvested.source}: nothing the golden has among EDGES is MISSING`, comparison.edges.missing.length, 0);
			harness.equal(`${harvested.source}: no EDGE was invented (EXTRA)`, comparison.edges.extra.length, 0);
			harness.equal(
				`${harvested.source}: node set size matches exactly`,
				harvested.nodeIds.size,
				golden.nodeIds.size,
			);
			harness.equal(
				`${harvested.source}: edge set size matches exactly`,
				harvested.edgeKeys.size,
				golden.edgeKeys.size,
			);

			// RED PROOF — a comparator never observed detecting a difference is one we are merely
			// hoping for. Drop one node AND one edge from a COPY of the golden and confirm BOTH
			// detectors fire. Built from the golden-vs-golden-minus-one, so it is independent of the
			// primary result and never emits a misleading failure when the real comparison already
			// differs.
			const goldenNodesMinusOne = new Set(golden.nodeIds);
			goldenNodesMinusOne.delete([...goldenNodesMinusOne][0]);
			const goldenEdgesMinusOne = new Set(golden.edgeKeys);
			goldenEdgesMinusOne.delete([...goldenEdgesMinusOne][0]);
			harness.ok(
				`${harvested.source}: RED PROOF — a removed NODE is detected as MISSING`,
				goldenComparison.diffSets(golden.nodeIds, goldenNodesMinusOne).missing.length === 1,
			);
			harness.ok(
				`${harvested.source}: RED PROOF — a removed EDGE is detected as MISSING`,
				goldenComparison.diffSets(golden.edgeKeys, goldenEdgesMinusOne).missing.length === 1,
			);

			compareNext(index + 1);
		});
	});
};

compareNext(0);
