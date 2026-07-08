'use strict';

// Gate (twin / guard, STANDING): the assembled LIVE valid-guard of assertGraphEquivalence must refuse
// to call a vacuous byteIdentical a trustworthy GREEN. Gate 34 proves the embeddingCoverage primitive;
// THIS gate proves the guard as WIRED INTO the live path (nonEmpty AND embeddingAxisLive => valid),
// so the D-c vacuous-green protection is a PERMANENT check, not a one-off review probe (house rule:
// every guard gets a standing twin — an unguarded scale-time green is what rots).
//
// Graph-free: a STUB fingerprinter (same idea as gate 34's in-memory substrate) returns a canned
// element manifest, so assertGraphEquivalence runs its full orchestration with NO Neo4j/docker. Two
// fingerprints of the same stub are byteIdentical by construction — exactly the condition under which
// a dead embedding axis would masquerade as GREEN. The gate asserts valid=false anyway.
//
// RED-then-GREEN, all three through the live valid-guard:
//   RED  (a) two EMPTY graphs        -> byteIdentical=true, nonEmpty=false        => valid=false
//   RED  (b) non-empty, ALL embeddingHash null -> byteIdentical=true, axisLive=false => valid=false
//   GREEN(c) populated + embeddings  -> byteIdentical=true, axisLive=true, nonEmpty=true => valid=true

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

module.exports = () => ({
	name: 'equivalence.liveValidGuard',
	phase: 'Phase0',
	kind: 'twin',
	expectFail: false,
	run: (ctx, callback) => {
		const fp = ctx.resources.fingerprinter; // used only for buildNodeLine (canonical line format)
		const differ = ctx.resources.differ;
		const graphEquivalenceFactory = require('../lib/graph-equivalence/graphEquivalence');
		const { buildTwinManifest } = require('../lib/graph-equivalence/equivalenceTwinFixture');

		// a STUB fingerprinter: every fingerprintGraph call returns the SAME canned manifest, so graphA
		// and graphB come back identical (byteIdentical) — the vacuous-green setup.
		const stubFingerprinter = (manifest) => ({
			fingerprintGraph: ({ graphName }, cb) =>
				cb('', {
					elementManifest: manifest,
					nodeCount: (manifest.nodes || []).length,
					edgeCount: (manifest.edges || []).length,
					fingerprint: `stub:${(manifest.nodes || []).length}n`,
				}),
		});

		const runScenario = (manifest, done) => {
			const ge = graphEquivalenceFactory({ fingerprinter: stubFingerprinter(manifest), differ });
			ge.assertGraphEquivalence({ graphA: 'stubA', graphB: 'stubB' }, done);
		};

		const emptyManifest = { nodes: [], edges: [] };
		const allNullManifest = {
			nodes: [
				fp.buildNodeLine(
					{ stableId: 'stub:s1', labels: ['ForgedNode', 'CedsProperty'], props: { name: 'A' }, embeddingHash: null },
					{ ignoreOwnerStamp: false, ignoreEmbedding: false },
				),
				fp.buildNodeLine(
					{ stableId: 'stub:s2', labels: ['ForgedNode', 'CedsClass'], props: { name: 'B' }, embeddingHash: null },
					{ ignoreOwnerStamp: false, ignoreEmbedding: false },
				),
			],
			edges: [],
		};
		const populatedManifest = buildTwinManifest(fp);

		const taskList = new taskListPlus();
		taskList.push((args, next) => {
			runScenario(emptyManifest, (err, res) => next(err, { ...args, emptyRes: res }));
		});
		taskList.push((args, next) => {
			runScenario(allNullManifest, (err, res) => next(err, { ...args, nullRes: res }));
		});
		taskList.push((args, next) => {
			runScenario(populatedManifest, (err, res) => next(err, { ...args, goodRes: res }));
		});

		pipeRunner(taskList.getList(), {}, (err, args) => {
			if (err) {
				callback('', { passed: false, detail: `scenario error: ${err}` });
				return;
			}
			const { emptyRes, nullRes, goodRes } = args;
			const redEmpty =
				emptyRes.byteIdentical === true && emptyRes.nonEmpty === false && emptyRes.valid === false;
			const redNull =
				nullRes.byteIdentical === true &&
				nullRes.nonEmpty === true &&
				nullRes.embeddingAxisLive === false &&
				nullRes.valid === false;
			const green =
				goodRes.byteIdentical === true &&
				goodRes.nonEmpty === true &&
				goodRes.embeddingAxisLive === true &&
				goodRes.valid === true;
			callback('', {
				passed: redEmpty && redNull && green,
				detail:
					`RED(empty)->byteIdentical=${emptyRes.byteIdentical},valid=${emptyRes.valid}; ` +
					`RED(allNull)->byteIdentical=${nullRes.byteIdentical},axisLive=${nullRes.embeddingAxisLive},valid=${nullRes.valid}; ` +
					`GREEN(populated)->byteIdentical=${goodRes.byteIdentical},axisLive=${goodRes.embeddingAxisLive},valid=${goodRes.valid}`,
			});
		});
	},
});
