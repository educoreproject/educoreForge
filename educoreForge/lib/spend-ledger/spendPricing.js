'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// spendPricing.js — the pricing table, read from configuration (spend ledger lane R1, 2026-10-21).
//
//   loadSpendPricing({ pricingFilePath }) → { spendPricer } | { error }
//   spendPricer.usdFor({ provider, model, inputTokens, outputTokens }) → { usd } | { error }
//   spendPricer.priceRowFor({ provider, model }) → { priceRow } | { error }
//   spendPricer.pricingFilePath, spendPricer.priceRowList
//
// THE FILE. One section per priced row, the section name a free label ([spendPrice_<label>]); the provider and model live in
// VALUES because the ini parser nests dotted keys and refuses ':' in a section name, and real model names carry both
// (jev-1.13.0, qwen2.5:32b). Every member is required: a price nobody sourced or dated is not a price.
//   [spendPrice_anthropicOpus5]
//   provider=anthropic
//   model=claude-opus-5
//   inputUsdPerMillionTokens=5
//   outputUsdPerMillionTokens=25
//   priceSource=<where the number came from>
//   priceAsOf=<YYYY-MM-DD it was read>
//
// `model` is the WIRE model, the name the vendor bills, never a namespaced judge identity. A provider/model with no row is
// REFUSED by name: a zero would read as "free", which is a claim, not an absence. A free model (a local Ollama) is a row
// that says 0 and names why in priceSource.

const fs = require('fs');
const configFileProcessor = require('qtools-config-file-processor');

const PRICE_SECTION_PREFIX = 'spendPrice_';
const PRICE_ROW_FIELD_LIST = Object.freeze(['provider', 'model', 'inputUsdPerMillionTokens', 'outputUsdPerMillionTokens', 'priceSource', 'priceAsOf']);
const PRICE_ROW_TEXT_FIELD_LIST = Object.freeze(['provider', 'model', 'priceSource', 'priceAsOf']);
const PRICE_ROW_RATE_FIELD_LIST = Object.freeze(['inputUsdPerMillionTokens', 'outputUsdPerMillionTokens']);
const PRICE_AS_OF_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKENS_PER_MILLION = 1000000;
const PROVIDER_MODEL_SEPARATOR = ':';

const providerModelNameFor = ({ provider, model }) => `${provider}${PROVIDER_MODEL_SEPARATOR}${model}`;

// priceRowViolation — '' when one section is a complete price row, else why not
const priceRowViolation = ({ sectionName, sectionValue }) => {
	const missingList = PRICE_ROW_FIELD_LIST.filter((fieldName) => sectionValue[fieldName] === undefined || `${sectionValue[fieldName]}`.trim() === '');
	if (missingList.length) {
		return `[${sectionName}] lacks ${missingList.join(', ')}`;
	}
	const extraList = Object.keys(sectionValue).filter((fieldName) => PRICE_ROW_FIELD_LIST.indexOf(fieldName) === -1);
	if (extraList.length) {
		return `[${sectionName}] carries ${extraList.join(', ')}, which is not a price row member (${PRICE_ROW_FIELD_LIST.join(', ')})`;
	}
	const badRateName = PRICE_ROW_RATE_FIELD_LIST.find((fieldName) => !Number.isFinite(Number(sectionValue[fieldName])) || Number(sectionValue[fieldName]) < 0);
	if (badRateName) {
		return `[${sectionName}].${badRateName} is ${JSON.stringify(sectionValue[badRateName])}, which is not a non-negative number of US dollars per million tokens`;
	}
	if (!PRICE_AS_OF_RE.test(`${sectionValue.priceAsOf}`)) {
		return `[${sectionName}].priceAsOf is ${JSON.stringify(sectionValue.priceAsOf)}; it is the date the price was read, YYYY-MM-DD`;
	}
	return '';
};

const loadSpendPricing = ({ pricingFilePath } = {}) => {
	if (typeof pricingFilePath !== 'string' || pricingFilePath.trim() === '') {
		return { error: `${moduleName}: pricingFilePath is ${JSON.stringify(pricingFilePath)}. It names the spend pricing ini ([spendLedger].spendPricingFilePath in graphBuilder.ini); there is no default` };
	}
	if (!fs.existsSync(pricingFilePath)) {
		return { error: `${moduleName}: no spend pricing file at ${pricingFilePath}. Every judge and embedding call is priced from it; a run cannot be priced without it` };
	}
	const wholeConfig = configFileProcessor.getConfig(pricingFilePath) || {};
	const sectionNameList = Object.keys(wholeConfig).filter((sectionName) => sectionName.indexOf(PRICE_SECTION_PREFIX) === 0);
	if (!sectionNameList.length) {
		return { error: `${moduleName}: ${pricingFilePath} has no [${PRICE_SECTION_PREFIX}<label>] section; it prices nothing` };
	}
	const violationList = sectionNameList.map((sectionName) => priceRowViolation({ sectionName, sectionValue: wholeConfig[sectionName] })).filter((violation) => violation !== '');
	if (violationList.length) {
		return { error: `${moduleName}: ${pricingFilePath}: ${violationList.join('; ')}` };
	}
	const priceRowList = sectionNameList.map((sectionName) => {
		const sectionValue = wholeConfig[sectionName];
		return Object.freeze({
			sectionName,
			provider: `${sectionValue.provider}`.trim(),
			model: `${sectionValue.model}`.trim(),
			inputUsdPerMillionTokens: Number(sectionValue.inputUsdPerMillionTokens),
			outputUsdPerMillionTokens: Number(sectionValue.outputUsdPerMillionTokens),
			priceSource: `${sectionValue.priceSource}`.trim(),
			priceAsOf: `${sectionValue.priceAsOf}`.trim(),
		});
	});
	const priceRowByProviderModelName = {};
	const duplicateList = [];
	priceRowList.forEach((priceRow) => {
		const providerModelName = providerModelNameFor(priceRow);
		if (priceRowByProviderModelName[providerModelName] !== undefined) {
			duplicateList.push(`${providerModelName} in [${priceRowByProviderModelName[providerModelName].sectionName}] and [${priceRow.sectionName}]`);
			return;
		}
		priceRowByProviderModelName[providerModelName] = priceRow;
	});
	if (duplicateList.length) {
		return { error: `${moduleName}: ${pricingFilePath} prices the same provider/model twice (${duplicateList.join('; ')}); one price per model` };
	}

	const priceRowFor = ({ provider, model }) => {
		const priceRow = priceRowByProviderModelName[providerModelNameFor({ provider, model })];
		if (priceRow === undefined) {
			return { error: `${moduleName}: ${providerModelNameFor({ provider, model })} has no price in ${pricingFilePath} (priced: ${Object.keys(priceRowByProviderModelName).sort().join(', ')}). Add a [${PRICE_SECTION_PREFIX}<label>] row with its source and date; an unpriced call is refused, never counted as free` };
		}
		return { priceRow };
	};

	const usdFor = ({ provider, model, inputTokens, outputTokens }) => {
		if (!Number.isInteger(inputTokens) || inputTokens < 0 || !Number.isInteger(outputTokens) || outputTokens < 0) {
			return { error: `${moduleName}: ${providerModelNameFor({ provider, model })} was handed inputTokens ${JSON.stringify(inputTokens)} / outputTokens ${JSON.stringify(outputTokens)}; both are non-negative integers` };
		}
		const found = priceRowFor({ provider, model });
		if (found.error) {
			return { error: found.error };
		}
		return { usd: (inputTokens * found.priceRow.inputUsdPerMillionTokens + outputTokens * found.priceRow.outputUsdPerMillionTokens) / TOKENS_PER_MILLION };
	};

	return { spendPricer: Object.freeze({ pricingFilePath, priceRowList: Object.freeze(priceRowList), priceRowFor, usdFor }) };
};

module.exports = { loadSpendPricing, providerModelNameFor, PRICE_SECTION_PREFIX, PRICE_ROW_FIELD_LIST, moduleName };
