#!/usr/bin/env node
'use strict';

// test-spendPricing.js — hermetic gate for lib/spend-ledger/spendPricing.js and spendRecord.js (spend ledger lane R1).
//
// PROVES:
//   SECTION 1 — the pricing table: loads the fixture; refuses an absent path, an absent file, a row missing a member
//     (priceSource, priceAsOf), a negative rate, a bad date, an undeclared member, and a provider/model priced twice.
//   SECTION 2 — THE UNPRICED REFUSAL: a call whose provider/model has no row is refused BY NAME, never priced as zero.
//     TWIN: a module double whose priceRowFor answers a zero row for an unknown model prices it as free — observed red.
//   SECTION 3 — the judge spend record: a live unit priced per leg (jevOpus-shaped: Jev leg + Opus leg); a debug unit
//     (usd 0, pricedBy debug); a hit with a filling list (savedUsd priced); a hit predating the ledger (savedUsd null,
//     named); a live answer with no spendCallList or no latencyMs refused by name; the running totals.
//   SECTION 4 — embedding records priced from tokens; a malformed record refused.
//
// Run: node lib/spend-ledger/test/test-spendPricing.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the spend pricing table and the spend record

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Loads a fixture pricing ini, prices judge and embedding calls, and proves every refusal by name.
     No network, no provider, no spend.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');

const spendPricingLib = require('../spendPricing');
const spendRecordLib = require('../spendRecord');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const FIXTURE_PRICING_FILE_PATH = path.join(__dirname, 'fixtures', 'spendPricing-fixture.ini');
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfSpendPricingGate-'));
const writeScratchIni = (fileName, iniText) => {
	const filePath = path.join(scratchDir, fileName);
	fs.writeFileSync(filePath, iniText);
	return filePath;
};
const VALID_ROW_TEXT = '[spendPrice_one]\nprovider=p\nmodel=m\ninputUsdPerMillionTokens=1\noutputUsdPerMillionTokens=2\npriceSource=s\npriceAsOf=2026-10-21\n';
const near = (actual, expected) => Math.abs(actual - expected) < 1e-12;

// =====================================================================
harness.section('SECTION 1 — the pricing table');
// =====================================================================
const loaded = spendPricingLib.loadSpendPricing({ pricingFilePath: FIXTURE_PRICING_FILE_PATH });
harness.accepts('the fixture pricing table loads', loaded.error ? [loaded.error] : []);
const spendPricer = loaded.spendPricer;
harness.equal('the fixture prices six provider/model rows', spendPricer.priceRowList.length, 6);
harness.match('an absent pricingFilePath is REFUSED by name', spendPricingLib.loadSpendPricing({}).error, /pricingFilePath is undefined.*there is no default/);
harness.match('a pricing file that does not exist is REFUSED', spendPricingLib.loadSpendPricing({ pricingFilePath: path.join(scratchDir, 'absent.ini') }).error, /no spend pricing file/);
harness.match('a row without priceSource is REFUSED (a price nobody sourced is not a price)', spendPricingLib.loadSpendPricing({ pricingFilePath: writeScratchIni('noSource.ini', VALID_ROW_TEXT.replace('priceSource=s\n', '')) }).error, /lacks priceSource/);
harness.match('a row without priceAsOf is REFUSED', spendPricingLib.loadSpendPricing({ pricingFilePath: writeScratchIni('noDate.ini', VALID_ROW_TEXT.replace('priceAsOf=2026-10-21\n', '')) }).error, /lacks priceAsOf/);
harness.match('a negative rate is REFUSED', spendPricingLib.loadSpendPricing({ pricingFilePath: writeScratchIni('negative.ini', VALID_ROW_TEXT.replace('inputUsdPerMillionTokens=1', 'inputUsdPerMillionTokens=-1')) }).error, /not a non-negative number/);
harness.match('a priceAsOf that is not YYYY-MM-DD is REFUSED', spendPricingLib.loadSpendPricing({ pricingFilePath: writeScratchIni('badDate.ini', VALID_ROW_TEXT.replace('2026-10-21', 'last tuesday')) }).error, /YYYY-MM-DD/);
harness.match('an undeclared member is REFUSED', spendPricingLib.loadSpendPricing({ pricingFilePath: writeScratchIni('extra.ini', `${VALID_ROW_TEXT}discount=0.5\n`) }).error, /discount, which is not a price row member/);
harness.match('one provider/model priced twice is REFUSED', spendPricingLib.loadSpendPricing({ pricingFilePath: writeScratchIni('twice.ini', `${VALID_ROW_TEXT}\n${VALID_ROW_TEXT.replace('[spendPrice_one]', '[spendPrice_two]')}`) }).error, /prices the same provider\/model twice \(p:m in \[spendPrice_one\] and \[spendPrice_two\]\)/);
harness.match('a file with no price section is REFUSED', spendPricingLib.loadSpendPricing({ pricingFilePath: writeScratchIni('empty.ini', '[somethingElse]\nx=1\n') }).error, /prices nothing/);

// =====================================================================
harness.section('SECTION 2 — the unpriced refusal');
// =====================================================================
harness.ok('a priced call is priced from the table (1,000,000 in × $5 + 200,000 out × $25 = $10)', near(spendPricer.usdFor({ provider: 'anthropic', model: 'claude-opus-5', inputTokens: 1000000, outputTokens: 200000 }).usd, 10));
const unpriced = spendPricer.usdFor({ provider: 'anthropic', model: 'claude-opus-9', inputTokens: 10, outputTokens: 10 });
harness.match('an UNPRICED provider/model is REFUSED BY NAME, never priced as zero', unpriced.error, /anthropic:claude-opus-9 has no price in .*an unpriced call is refused, never counted as free/);
harness.ok('the refusal carries no usd at all', unpriced.usd === undefined);
harness.match('a non-integer token count is REFUSED', spendPricer.usdFor({ provider: 'anthropic', model: 'claude-opus-5', inputTokens: 1.5, outputTokens: 0 }).error, /non-negative integers/);
(() => {
	// THE TWIN: priceRowFor answers a zero-rate row for anything it does not know — the unpriced call is then "free"
	const doubleLib = moduleDouble.loadWithMutations({
		modulePath: path.join(__dirname, '..', 'spendPricing.js'),
		mutationList: [{ modulePath: path.join(__dirname, '..', 'spendPricing.js'), find: '\t\tif (priceRow === undefined) {\n\t\t\treturn { error:', replace: '\t\tif (priceRow === undefined) {\n\t\t\treturn { priceRow: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 } };\n\t\t\treturn { error:' }],
	});
	const twinPricer = doubleLib.loadSpendPricing({ pricingFilePath: FIXTURE_PRICING_FILE_PATH }).spendPricer;
	const twinPriced = twinPricer.usdFor({ provider: 'anthropic', model: 'claude-opus-9', inputTokens: 10, outputTokens: 10 });
	harness.ok('TWIN (unknown model answered with a zero row) observed RED: the unpriced call is priced at $0 and not refused', twinPriced.error === undefined && twinPriced.usd === 0, JSON.stringify(twinPriced));
})();

// =====================================================================
harness.section('SECTION 3 — the judge spend record');
// =====================================================================
const jevOpusCallList = [
	{ provider: 'jev', model: 'jev-1.13.0', inputTokens: 4000, outputTokens: 200 },
	{ provider: 'anthropic', model: 'claude-opus-5', inputTokens: 5000, outputTokens: 300 },
];
const live = spendRecordLib.judgeSpendRecordFor({ judgeName: 'jevOpus', judgeModel: 'jevOpus:jev-1.13.0:data@0.7+anthropic:claude-opus-5', spendCallList: jevOpusCallList, latencyMs: 1234, cacheHit: false, isDebugClient: false, spendPricer });
harness.accepts('a live jevOpus-shaped unit (Jev leg + Opus leg) is priced', live.error ? [live.error] : []);
harness.equal('its identity is the judge, not a leg', live.spendRecord.provider, 'jevOpus');
harness.equal('its tokens are both legs summed (input)', live.spendRecord.inputTokens, 9000);
harness.ok('its usd is both legs priced (4000×0.5 + 5000×5 + 300×25 per million = $0.0345)', near(live.spendRecord.usd, 0.0345), String(live.spendRecord.usd));
harness.equal('each leg keeps its own provider and model', live.spendRecord.callList.map((oneCall) => `${oneCall.provider}:${oneCall.model}`).join(','), 'jev:jev-1.13.0,anthropic:claude-opus-5');
harness.equal('pricedBy names the table', live.spendRecord.pricedBy, 'spendPricingTable');
harness.equal('the record satisfies its own shape check', spendRecordLib.judgeSpendRecordViolation(live.spendRecord), '');
harness.match('a live answer WITHOUT spendCallList is REFUSED by name', spendRecordLib.judgeSpendRecordFor({ judgeName: 'stub', judgeModel: 'stub:x', spendCallList: undefined, latencyMs: 5, cacheHit: false, isDebugClient: false, spendPricer }).error, /answered without its spend: spendCallList is undefined/);
harness.match('a live answer with an EMPTY spendCallList is REFUSED', spendRecordLib.judgeSpendRecordFor({ judgeName: 'stub', judgeModel: 'stub:x', spendCallList: [], latencyMs: 5, cacheHit: false, isDebugClient: false, spendPricer }).error, /at least one/);
harness.match('a live answer without latencyMs is REFUSED by name', spendRecordLib.judgeSpendRecordFor({ judgeName: 'stub', judgeModel: 'stub:x', spendCallList: [{ provider: 'stub', model: 'stub-wire', inputTokens: 1, outputTokens: 1 }], latencyMs: undefined, cacheHit: false, isDebugClient: false, spendPricer }).error, /latencyMs undefined/);
harness.match('a live answer naming an unpriced leg is REFUSED', spendRecordLib.judgeSpendRecordFor({ judgeName: 'stub', judgeModel: 'stub:x', spendCallList: [{ provider: 'stub', model: 'unpriced-wire', inputTokens: 1, outputTokens: 1 }], latencyMs: 5, cacheHit: false, isDebugClient: false, spendPricer }).error, /stub:unpriced-wire has no price/);
harness.match('a real judgment with NO pricer is REFUSED', spendRecordLib.judgeSpendRecordFor({ judgeName: 'stub', judgeModel: 'stub:x', spendCallList: [], latencyMs: 5, cacheHit: false, isDebugClient: false, spendPricer: undefined }).error, /no spendPricer/);
const debugUnit = spendRecordLib.judgeSpendRecordFor({ judgeName: 'debug', judgeModel: 'debug:first', spendCallList: undefined, latencyMs: 3, cacheHit: false, isDebugClient: true, spendPricer: undefined });
harness.ok('a DEBUG unit records usd 0 with pricedBy debug, and needs no pricer', debugUnit.spendRecord.usd === 0 && debugUnit.spendRecord.pricedBy === 'debug' && debugUnit.spendRecord.savedUsd === null, JSON.stringify(debugUnit));
const filledHit = spendRecordLib.judgeSpendRecordFor({ judgeName: 'jev', judgeModel: 'jev:jev-1.13.0:data:cfg-x', cacheHit: true, fillingSpendCallList: [{ provider: 'jev', model: 'jev-1.13.0', inputTokens: 2000000, outputTokens: 7 }], isDebugClient: false, spendPricer });
harness.ok('a HIT costs 0 and carries savedUsd priced from the call that filled its row ($1.00)', filledHit.spendRecord.usd === 0 && near(filledHit.spendRecord.savedUsd, 1) && filledHit.spendRecord.cacheHit === true && filledHit.spendRecord.latencyMs === null, JSON.stringify(filledHit));
const oldHit = spendRecordLib.judgeSpendRecordFor({ judgeName: 'jev', judgeModel: 'jev:jev-1.13.0:data:cfg-x', cacheHit: true, fillingSpendCallList: null, isDebugClient: false, spendPricer });
harness.ok('a HIT on a row that predates the ledger records savedUsd null, NAMED cacheRowPredatesLedger (not zero)', oldHit.spendRecord.savedUsd === null && oldHit.spendRecord.pricedBy === 'cacheRowPredatesLedger', JSON.stringify(oldHit));
const totals = [live.spendRecord, debugUnit.spendRecord, filledHit.spendRecord, oldHit.spendRecord].reduce((judgeSpend, spendRecord) => spendRecordLib.judgeSpendTotalsWith({ judgeSpend, spendRecord }), { asked: 0, ...spendRecordLib.JUDGE_SPEND_TOTAL_SEED });
harness.ok('the running totals: usd from the live unit only, savedUsd from the filled hit, one unknown saving counted, one debug unit counted', near(totals.usd, 0.0345) && near(totals.savedUsd, 1) && totals.savedUsdUnknownCount === 1 && totals.debugUnitCount === 1 && totals.usdByProviderModel['anthropic:claude-opus-5'].callCount === 1, JSON.stringify(totals));

// =====================================================================
harness.section('SECTION 4 — embedding records');
// =====================================================================
const embeddingRecord = { provider: 'voyage', model: 'voyage-4-large', texts: 10, distinctMisses: 4, servedFromCache: 6, tokens: 3000000, latencyMs: 812 };
const pricedEmbedding = spendRecordLib.pricedEmbeddingSpendRecordFor({ embeddingSpendRecord: embeddingRecord, spendPricer });
harness.ok('an embedding batch is priced from its tokens (3,000,000 × $0.1 per million = $0.30)', pricedEmbedding.error === undefined && near(pricedEmbedding.pricedEmbeddingSpendRecord.usd, 0.3), JSON.stringify(pricedEmbedding));
harness.match('an embedding record missing tokens is REFUSED', spendRecordLib.pricedEmbeddingSpendRecordFor({ embeddingSpendRecord: { ...embeddingRecord, tokens: undefined }, spendPricer }).error, /inputTokens undefined .*both are non-negative integers/);
harness.match('an embedding model without a price is REFUSED', spendRecordLib.pricedEmbeddingSpendRecordFor({ embeddingSpendRecord: { ...embeddingRecord, model: 'voyage-9' }, spendPricer }).error, /voyage:voyage-9 has no price/);

harness.report();
