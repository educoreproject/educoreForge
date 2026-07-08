#!/usr/bin/env node
'use strict';

// __TEST_liveEmbeddingPresence.js — the LIVE embedding-axis presence assert (QUIET_ECHO's required
// D-c addition). A byteIdentical equivalence verdict is only trustworthy if the embeddingHash axis is
// actually populated on the live graph; a self-compare over an embeddingless graph would report a
// vacuous null==null GREEN. This script POSITIVELY confirms, READ-ONLY, that a live graph carries
// embeddings in the expected ballpark — proving the axis is alive before any equivalence GREEN is
// trusted. It is the live counterpart to gate 34's in-memory liveness guard.
//
// READ-ONLY: opens a READ session and runs only MATCH ... RETURN count/sample. Never writes. Creds
// are passed at runtime (argv), never committed.
//
// Async style: qtools taskListPlus/pipeRunner for orchestration; a single runRead() adapter bridges
// the neo4j-driver promise to a callback at the driver boundary (mirrors instance-lifecycle's
// runCypherAgainst). No async/await, no try/catch for control flow.
//
// Usage: node __TEST_liveEmbeddingPresence.js <boltUri> <password> [expectedMin] [user]
//   e.g. node __TEST_liveEmbeddingPresence.js bolt://localhost:7714 <pw> 70000 neo4j

const neo4j = require('neo4j-driver');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const boltUri = process.argv[2];
const password = process.argv[3];
const expectedMin = process.argv[4] ? parseInt(process.argv[4], 10) : 1;
const user = process.argv[5] || 'neo4j';

if (!boltUri || !password) {
	console.error('usage: node __TEST_liveEmbeddingPresence.js <boltUri> <password> [expectedMin] [user]');
	process.exit(2);
}

const driver = neo4j.driver(boltUri, neo4j.auth.basic(user, password), {
	disableLosslessIntegers: true,
});
const session = driver.session({ defaultAccessMode: neo4j.session.READ });

const num = (v) => (v && typeof v === 'object' && 'low' in v ? v.low : v);

// runRead(cypher, cb) -> records. The ONE promise->callback adapter (driver boundary only).
const runRead = (cypher, cb) => {
	session.run(cypher).then(
		(result) => cb('', result.records),
		(err) => cb(err.message || `${err}`),
	);
};

const taskList = new taskListPlus();

taskList.push((args, next) => {
	runRead('MATCH (n:ForgedNode) RETURN count(n) AS total', (err, records) => {
		if (err) { next(`total count: ${err}`); return; }
		next('', { ...args, total: num(records[0].get('total')) });
	});
});

taskList.push((args, next) => {
	runRead('MATCH (n:ForgedNode) WHERE n.embedding IS NOT NULL RETURN count(n) AS withEmbedding', (err, records) => {
		if (err) { next(`embedding count: ${err}`); return; }
		next('', { ...args, withEmbedding: num(records[0].get('withEmbedding')) });
	});
});

taskList.push((args, next) => {
	runRead(
		'MATCH (n:ForgedNode) WHERE n.embedding IS NOT NULL RETURN n.stableId AS stableId, size(n.embedding) AS dims LIMIT 3',
		(err, records) => {
			if (err) { next(`sample: ${err}`); return; }
			next('', { ...args, sample: records.map((rec) => ({ stableId: rec.get('stableId'), dims: num(rec.get('dims')) })) });
		},
	);
});

pipeRunner(taskList.getList(), {}, (err, args) => {
	const finish = (code) => session.close().then(() => driver.close().then(() => process.exit(code)));
	if (err) {
		console.error(`live presence assert failed: ${err}`);
		finish(1);
		return;
	}
	const pass =
		args.withEmbedding >= expectedMin &&
		args.withEmbedding > 0 &&
		args.sample.every((s) => s.dims > 0);
	console.log(
		JSON.stringify(
			{
				boltUri,
				total: args.total,
				withEmbedding: args.withEmbedding,
				coveragePct: args.total ? Math.round((args.withEmbedding / args.total) * 1000) / 10 : 0,
				expectedMin,
				sample: args.sample,
				verdict: pass ? 'EMBEDDING AXIS LIVE (GREEN)' : 'EMBEDDING AXIS DEAD/BELOW-BALLPARK (RED)',
				pass,
			},
			null,
			2,
		),
	);
	finish(pass ? 0 : 1);
});
