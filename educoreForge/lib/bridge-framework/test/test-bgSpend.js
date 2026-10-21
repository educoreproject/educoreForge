#!/usr/bin/env node
'use strict';

// test-bgSpend.js — BG-SPEND: every judged unit through the REAL bridge framework carries its spend (spend ledger lane R1).
//
// PROVES, over the toy bridge scenario (graph double, in-memory stores, no network):
//   a  DEBUG judge: every judgment record's spendRecord is pricedBy 'debug' at $0, and judgeSpend counts the debug units
//   b  a REAL-client double: every record is priced from the fixture table and carries the wrapper-stamped latency;
//      judgeSpend.usd is the sum, broken out by provider:model
//   c  a WARM cache: the second run asks nothing, spends $0, and its hits carry savedUsd priced from the sidecar's filling
//      spend — the same dollars the first run paid
//   d  a RE-ASKED unit pays twice: the refused first attempt and the accepted answer each carry their own spendRecord and
//      both are in judgeSpend.usd
//   e  BG-DET's PURPOSE HOLDS: two runs whose clients report different latencies freeze byte-identical blocks (latency is
//      evidence, never block text)
//   f  an UNPRICED judge model is REFUSED by name and the run freezes nothing
//
// Run: node lib/bridge-framework/test/test-bgSpend.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- BG-SPEND: the bridge framework records what every judged unit cost

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const scenarioLib = require('./testSupport/toyBridgeScenario');
const { forensicsOf, refusalTextOf } = require('./testSupport/bridgeTwinFactories');

// the fake real client's one call: 10 in / 5 out at the fixture's fake-anthropic rate ($3 / $15 per million)
const UNIT_USD = (10 * 3 + 5 * 15) / 1e6;
const near = (actual, expected) => typeof actual === 'number' && Math.abs(actual - expected) < 1e-12;
const judgmentRecordListOf = (outcome) => forensicsOf(outcome).map((oneEntry) => oneEntry.record).filter((oneRecord) => oneRecord.kind === undefined && oneRecord.refusedAttempt === undefined);
const refusedAttemptRecordListOf = (outcome) => forensicsOf(outcome).map((oneEntry) => oneEntry.record).filter((oneRecord) => oneRecord.refusedAttempt !== undefined);
const cloneJson = (candidate) => JSON.parse(JSON.stringify(candidate));
const runShaped = (shape, callback) => {
	const scenario = scenarioLib.makeScenario();
	shape(scenario);
	scenarioLib.runScenario(scenario, (unusedError, outcome) => callback(outcome, scenario));
};

const caseList = [
	(done) => {
		harness.section('a — the debug judge: $0, named');
		runShaped(() => {}, (outcome) => {
			harness.ok('the debug run succeeds', !refusalTextOf(outcome), refusalTextOf(outcome));
			const recordList = judgmentRecordListOf(outcome);
			harness.ok('every judgment record carries a spendRecord pricedBy debug at $0', recordList.length > 0 && recordList.every((oneRecord) => oneRecord.spendRecord.pricedBy === 'debug' && oneRecord.spendRecord.usd === 0), `${recordList.length} record(s)`);
			const judgeSpend = outcome.runReport.counts.judgeSpend;
			harness.ok('judgeSpend counts every asked unit as a debug unit, usd 0', judgeSpend.asked > 0 && judgeSpend.debugUnitCount === judgeSpend.asked && judgeSpend.usd === 0, JSON.stringify(judgeSpend));
			done();
		});
	},
	(done) => {
		harness.section('b + c — a real-client double, then a warm cache');
		runShaped((scenario) => {
			scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({});
		}, (first, scenario) => {
			harness.ok('the real-client run succeeds', !refusalTextOf(first), refusalTextOf(first));
			const recordList = judgmentRecordListOf(first);
			harness.ok('every judgment record is priced from the table, with the stamped latency', recordList.length > 0 && recordList.every((oneRecord) => oneRecord.spendRecord.pricedBy === 'spendPricingTable' && near(oneRecord.spendRecord.usd, UNIT_USD) && oneRecord.spendRecord.latencyMs === 7), JSON.stringify(recordList[0] && recordList[0].spendRecord));
			const judgeSpend = first.runReport.counts.judgeSpend;
			harness.ok('judgeSpend.usd is asked × the unit price, broken out by provider:model', near(judgeSpend.usd, judgeSpend.asked * UNIT_USD) && judgeSpend.usdByProviderModel['anthropic:fake-anthropic-judge-v1'].callCount === judgeSpend.asked, JSON.stringify(judgeSpend));
			const second = scenarioLib.cloneScenario(scenario);
			second.stores = scenario.stores;
			second.graph = cloneJson(scenario.graph);
			second.judgeClientOverride = scenarioLib.makeFakeRealClient({});
			scenarioLib.runScenario(second, (unusedSecondError, secondOutcome) => {
				const warmSpend = secondOutcome.runReport ? secondOutcome.runReport.counts.judgeSpend : null;
				harness.ok('the warm run asks nothing and spends $0', warmSpend !== null && warmSpend.asked === 0 && warmSpend.usd === 0 && warmSpend.servedFromCache === judgeSpend.asked, JSON.stringify(warmSpend));
				harness.ok('  and its hits SAVED what the first run paid (priced from the sidecar\'s filling spend)', warmSpend !== null && near(warmSpend.savedUsd, judgeSpend.usd) && warmSpend.savedUsdUnknownCount === 0, JSON.stringify(warmSpend));
				const hitRecordList = judgmentRecordListOf(secondOutcome).slice(-warmSpend.servedFromCache);
				harness.ok('  each hit record: cacheHit, usd 0, savedUsd the unit price, latencyMs null', hitRecordList.length > 0 && hitRecordList.every((oneRecord) => oneRecord.spendRecord.cacheHit === true && oneRecord.spendRecord.usd === 0 && near(oneRecord.spendRecord.savedUsd, UNIT_USD) && oneRecord.spendRecord.latencyMs === null), JSON.stringify(hitRecordList[0] && hitRecordList[0].spendRecord));
				done();
			});
		});
	},
	(done) => {
		harness.section('d — a re-asked unit pays twice');
		runShaped((scenario) => {
			scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ rationaleMode: 'ordinalThenKeyAndName' });
		}, (outcome) => {
			harness.ok('the re-asking run succeeds', !refusalTextOf(outcome), refusalTextOf(outcome));
			const refusedList = refusedAttemptRecordListOf(outcome);
			const judgeSpend = outcome.runReport.counts.judgeSpend;
			harness.ok('every refused first attempt carries its own priced spendRecord', refusedList.length > 0 && refusedList.every((oneRecord) => near(oneRecord.spendRecord.usd, UNIT_USD)), `${refusedList.length} refused attempt(s)`);
			harness.ok('judgeSpend.usd counts BOTH attempts of every re-asked unit', near(judgeSpend.usd, (judgeSpend.asked + judgeSpend.rationaleReaskCount) * UNIT_USD) && judgeSpend.rationaleReaskCount === refusedList.length, JSON.stringify(judgeSpend));
			done();
		});
	},
	(done) => {
		harness.section('e — latency never reaches the block (BG-DET\'s purpose)');
		runShaped((scenario) => {
			scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ extraReturnKeys: { latencyMs: 3 } });
		}, (fastOutcome) => {
			runShaped((scenario) => {
				scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ extraReturnKeys: { latencyMs: 98765 } });
			}, (slowOutcome) => {
				const fastHash = fastOutcome.runReport && fastOutcome.runReport.decisionBlock.decisionBlockHash;
				const slowHash = slowOutcome.runReport && slowOutcome.runReport.decisionBlock.decisionBlockHash;
				harness.ok('two runs at 3 ms and 98,765 ms per unit freeze the SAME decision block', typeof fastHash === 'string' && fastHash === slowHash, `${fastHash} vs ${slowHash}`);
				harness.ok('  while their forensic records DO differ in latency (so the probe could have seen a leak)', judgmentRecordListOf(fastOutcome)[0].spendRecord.latencyMs === 3 && judgmentRecordListOf(slowOutcome)[0].spendRecord.latencyMs === 98765);
				done();
			});
		});
	},
	(done) => {
		harness.section('f — an unpriced judge model is refused');
		runShaped((scenario) => {
			scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({ wireModel: 'unpriced-judge-v9' });
		}, (outcome) => {
			harness.match('the run is REFUSED, naming the unpriced provider:model', refusalTextOf(outcome), /anthropic:unpriced-judge-v9 has no price in .*an unpriced call is refused, never counted as free/);
			harness.ok('  and it froze no decision block', outcome.stores.decisionStore.rowList.length === 0, `${outcome.stores.decisionStore.rowList.length} row(s)`);
			done();
		});
	},
];

const runSequence = (remainingList) => {
	if (!remainingList.length) {
		harness.report();
		return;
	}
	remainingList[0](() => runSequence(remainingList.slice(1)));
};
runSequence(caseList);
