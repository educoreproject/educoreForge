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
// SET OF THINGS. The durable identity of a node is its stableId, so the comparison is a set
// comparison over stableIds, scoped to the standard's SIX BASE ROLES.
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

DESCRIPTION
     Runs forge -> init -> harvest for each standard, then compares the harvested schema block's
     stableId SET against the golden's, scoped to the six DME base roles. Reports missing, extra
     and identical. The golden is opened READ-ONLY and is never written, never named to
     replayManager, and never touched by docker.

EXIT STATUS
     0 every standard's stableId set is identical to the golden's;  1 otherwise.
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

if (!goldenPort || !goldenPassword) {
	xLog.error(
		`${moduleName}: --goldenPort and --goldenPassword are required. Resolve them with ` +
			`\`docker inspect <goldenName>\` — they are deliberately not discovered automatically, ` +
			`so nothing can wander into a production graph it was not explicitly pointed at.`,
	);
	process.exit(1);
}

// -----
// goldenStableIds — READ-ONLY. The role filter is built from the vocabulary registry, not from a
// literal list, so a role added to the registry cannot silently fall out of this comparison.
const goldenStableIds = ({ source }, callback) => {
	const driver = neo4j.driver(
		`bolt://${goldenHost}:${goldenPort}`,
		neo4j.auth.basic('neo4j', goldenPassword),
		{ encrypted: false },
	);
	const session = driver.session({ defaultAccessMode: neo4j.session.READ });
	const roleClause = BASE_ROLES.map((oneRole) => `n:\`${oneRole}\``).join(' OR ');
	session
		.run(
			`MATCH (n) WHERE n._source = $source AND (${roleClause})
			 RETURN n.stableId AS stableId`,
			{ source },
		)
		.then((result) => {
			const ids = new Set();
			result.records.forEach((rec) => ids.add(rec.get('stableId')));
			session.close().then(() => driver.close());
			callback('', ids);
		})
		.catch((err) => {
			session.close().then(() => driver.close());
			callback(`golden query failed: ${err.message}`);
		});
};

// -----
// harvestedStableIds — the RECREATED path, whole: forge -> create -> init -> harvest -> delete.
const harvestedStableIds = ({ token }, callback) => {
	const resolved = forgerModule.resolveBundle({ standard: token });
	if (resolved.error) {
		callback(resolved.error);
		return;
	}

	forgerModule().forge({ standard: token, version: 'current', vectorize: false }, (forgeErr, forged) => {
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
				replayManager.delete(handle, () => callback(err, payload));
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
							// harvested block's own node lines.
							const ids = new Set();
							block.blockText
								.split('\n')
								.filter((oneLine) => oneLine.trim().length > 0)
								.map((oneLine) => JSON.parse(oneLine))
								.filter((rec) => rec.kind === 'node')
								.filter((rec) => (rec.labels || []).some((l) => BASE_ROLES.includes(l)))
								.forEach((rec) => ids.add(rec.stableId));
							cleanupAnd('', { ids, blockId: block.blockId, source: forged.standard });
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

	harvestedStableIds({ token }, (err, harvested) => {
		if (err) {
			harness.ok(`${token}: recreated pipeline produced a schema block`, false, err);
			compareNext(index + 1);
			return;
		}
		goldenStableIds({ source: harvested.source }, (goldErr, golden) => {
			if (goldErr) {
				harness.ok(`${token}: golden queried`, false, goldErr);
				compareNext(index + 1);
				return;
			}

			const missing = [...golden].filter((oneId) => !harvested.ids.has(oneId));
			const extra = [...harvested.ids].filter((oneId) => !golden.has(oneId));

			harness.section(
				`${harvested.source} — recreated ${harvested.ids.size} vs golden ${golden.size} (base roles)`,
			);
			xLog.status(`  recreated schema blockId: ${harvested.blockId}`);
			if (missing.length) {
				xLog.status(`  MISSING from the recreation (first 5): ${missing.slice(0, 5).join(', ')}`);
			}
			if (extra.length) {
				xLog.status(`  EXTRA in the recreation (first 5): ${extra.slice(0, 5).join(', ')}`);
			}

			harness.ok(
				`${harvested.source}: the golden is non-empty (a comparison against nothing proves nothing)`,
				golden.size > 0,
				golden.size,
			);
			harness.equal(`${harvested.source}: nothing the golden has is MISSING`, missing.length, 0);
			harness.equal(`${harvested.source}: nothing EXTRA was invented`, extra.length, 0);
			harness.equal(
				`${harvested.source}: stableId set size matches exactly`,
				harvested.ids.size,
				golden.size,
			);

			// RED PROOF — every assertion above passed, which means nothing until the comparator is
			// shown capable of failing. Drop one id from a COPY of each side and confirm the
			// detectors report it. A comparator never observed detecting a difference is a
			// comparator we are merely hoping for.
			const goldenMinusOne = new Set(golden);
			goldenMinusOne.delete([...goldenMinusOne][0]);
			const harvestedMinusOne = new Set(harvested.ids);
			harvestedMinusOne.delete([...harvestedMinusOne][0]);
			harness.ok(
				`${harvested.source}: RED PROOF — a removed golden id is detected as EXTRA`,
				[...harvested.ids].filter((oneId) => !goldenMinusOne.has(oneId)).length === 1,
			);
			harness.ok(
				`${harvested.source}: RED PROOF — a removed harvested id is detected as MISSING`,
				[...golden].filter((oneId) => !harvestedMinusOne.has(oneId)).length === 1,
			);

			compareNext(index + 1);
		});
	});
};

compareNext(0);
