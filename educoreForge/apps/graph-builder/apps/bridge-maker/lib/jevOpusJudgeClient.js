'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// jevOpusJudgeClient.js — the JEV-THEN-OPUS cascade judge, satisfying JUDGE_PROVIDER_SHAPE.
// Created 2026-09-30 (COPPER_LOOM) on TQ's instruction.
//
// Jev judges every subject first. When Jev's confidence is at or above [jevOpusJudge].escalateBelowConfidence
// its answer stands — a pick or a NONE alike (TQ, 2026-09-30: a confident abstention is an answer). Below
// the cut, the Anthropic judge (Opus) judges the same question and ITS answer stands. The evidence for the
// cut is the Ed-Fi hundred (management/zNotesPlansDocs/jevJudge/ANALYSIS-jevVsOpus-edfiHundred-093026.md):
// at 0.7 the cascade matched Opus alone on the proxy yardstick while sending about half the subjects to Opus.
//
// It COMPOSES the two existing providers rather than re-implementing either: jevJudgeClient and llmClient
// are constructed here from their own config files, which this cascade's config names explicitly.
//
// ⟪IDENTITY⟫ jevOpus:<jev identity>@<cut>+<anthropic identity>. Everything that can change an answer is in
// it — Jev's wire model and request form, the cut, and the Anthropic model — so the judgment cache can never
// serve one cascade's verdict for another.
//
// ⟪WHO ANSWERED⟫ Every rationale ends with a bracketed [jevOpus: …] note saying which judge answered and, on
// an escalation, what Jev had said. That note is how a run is audited for its escalation rate.
//
// ⟪THE PREDICATE⟫ Each leg's verdict is passed through whole, so under judgeSlot-v1 the answering leg's predicate
// is the cascade's; rerankOptions reach both legs whole, predicateRule included. Jev's own relation call is made
// before the cut is read, so an escalated subject has paid for a Jev relation that Opus's answer replaces.
//
// A Jev FAILURE is refused by name, never escalated: an outage must not silently turn a cascade run into an
// Opus run.

const fs = require('fs');
const configFileProcessor = require('qtools-config-file-processor');
const jevJudgeClientLib = require('./jevJudgeClient');
const llmClientLib = require('./llmClient');

const defaultConfigFilePath =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/configs/instanceSpecific/qbook/jevOpusJudge.ini';

const CONFIG_SECTION_NAME = 'jevOpusJudge';
const PROVIDER_NAME = 'jevOpus';
const MODEL_NAMESPACE_SEPARATOR = ':';
const CLIENT_VERSION = 'jevOpusJudgeClient-v1';

const requiredValueOrThrow = (sectionConfig, configKeyName, configFilePath) => {
	const rawValue = sectionConfig[configKeyName];
	if (rawValue === undefined || rawValue === null || `${rawValue}`.trim() === '') {
		throw new Error(`${moduleName}: [${CONFIG_SECTION_NAME}].${configKeyName} is not configured in ${configFilePath}. Every key is required; there are no defaults.`);
	}
	return `${rawValue}`.trim();
};

const resolveConfigOrThrow = (configFilePath) => {
	if (!fs.existsSync(configFilePath)) {
		throw new Error(`${moduleName}: no config file at ${configFilePath}. This provider is configured by a [${CONFIG_SECTION_NAME}] section there.`);
	}
	const sectionConfig = (configFileProcessor.getConfig(configFilePath) || {})[CONFIG_SECTION_NAME];
	if (!sectionConfig) {
		throw new Error(`${moduleName}: ${configFilePath} has no [${CONFIG_SECTION_NAME}] section.`);
	}
	const escalateBelowConfidenceText = requiredValueOrThrow(sectionConfig, 'escalateBelowConfidence', configFilePath);
	const escalateBelowConfidence = Number(escalateBelowConfidenceText);
	if (!Number.isFinite(escalateBelowConfidence) || escalateBelowConfidence < 0 || escalateBelowConfidence > 1) {
		throw new Error(`${moduleName}: [${CONFIG_SECTION_NAME}].escalateBelowConfidence is '${escalateBelowConfidenceText}' in ${configFilePath} — it must be a number from 0 to 1.`);
	}
	return {
		escalateBelowConfidence,
		jevConfigFilePath: requiredValueOrThrow(sectionConfig, 'jevConfigFilePath', configFilePath),
		anthropicConfigFilePath: requiredValueOrThrow(sectionConfig, 'anthropicConfigFilePath', configFilePath),
	};
};

// identitySuffixFor — a provider's model identity without its own namespace, so the cascade's identity reads
// jevOpus:jev-1.13.0:data:cfg-<hash>@0.7+anthropic:claude-opus-5 rather than repeating 'jev:'.
const identitySuffixFor = (namespacedModel) => namespacedModel.slice(namespacedModel.indexOf(MODEL_NAMESPACE_SEPARATOR) + 1);

const moduleFunction = (constructionOptions = {}) => {
	const { configFilePath = defaultConfigFilePath, componentOverrides = {} } = constructionOptions;
	const cfg = resolveConfigOrThrow(configFilePath);
	// The two judges. A test hands in doubles; production constructs the real providers from their own configs.
	const jevProvider = componentOverrides.jevProvider || jevJudgeClientLib({ configFilePath: cfg.jevConfigFilePath });
	const anthropicProvider = componentOverrides.anthropicProvider || llmClientLib({ configFilePath: cfg.anthropicConfigFilePath });
	const namespacedModel = `${PROVIDER_NAME}${MODEL_NAMESPACE_SEPARATOR}${identitySuffixFor(jevProvider.model)}@${cfg.escalateBelowConfidence}+${anthropicProvider.model}`;

	const rerank = (rerankOptions = {}, callback) => {
		jevProvider.rerank(rerankOptions, (jevError, jevVerdict) => {
			if (jevError) {
				callback(`${moduleName}: the Jev judge refused, and a cascade does not escalate a failure: ${jevError}`);
				return;
			}
			// ⟪campaign P3, W-B-3⟫ Jev's pick confidence is read from its judgeSummary (it was jevConfidence before P3)
			const jevPickConfidence = jevVerdict.judgeSummary && typeof jevVerdict.judgeSummary.judgePickConfidence === 'number' ? jevVerdict.judgeSummary.judgePickConfidence : null;
			if (jevPickConfidence === null) {
				callback(`${moduleName}: the Jev verdict carries no judgeSummary.judgePickConfidence, so the escalation cannot be decided.`);
				return;
			}
			if (jevPickConfidence >= cfg.escalateBelowConfidence) {
				callback('', {
					...jevVerdict,
					rationale: `${jevVerdict.rationale} [jevOpus: Jev answered at confidence ${jevPickConfidence} (cut ${cfg.escalateBelowConfidence}); Opus not asked.]`,
					model: namespacedModel,
					answeredBy: jevProvider.name,
				});
				return;
			}
			anthropicProvider.rerank(rerankOptions, (anthropicError, anthropicVerdict) => {
				if (anthropicError) {
					callback(`${moduleName}: escalated to ${anthropicProvider.model} after Jev's confidence ${jevPickConfidence}, and it refused: ${anthropicError}`);
					return;
				}
				callback('', {
					...anthropicVerdict,
					rationale: `${anthropicVerdict.rationale} [jevOpus: escalated; Jev's confidence ${jevPickConfidence} is below the cut ${cfg.escalateBelowConfidence}. Jev's view: ${jevVerdict.rationale}]`,
					model: namespacedModel,
					attempts: (jevVerdict.attempts || 0) + (anthropicVerdict.attempts || 0),
					answeredBy: anthropicProvider.name,
					// the answer is Opus's, so the summary is Opus's (it reports no numbers: null); Jev's view rides beside it
					judgeSummary: anthropicVerdict.judgeSummary === undefined ? null : anthropicVerdict.judgeSummary,
					jevConfidence: jevPickConfidence,
					jevChoice: jevVerdict.choice,
				});
			});
		});
	};

	const describe = () => ({ provider: PROVIDER_NAME, model: namespacedModel, version: CLIENT_VERSION });

	return {
		name: PROVIDER_NAME,
		wireModel: `${jevProvider.wireModel}+${anthropicProvider.wireModel}`,
		model: namespacedModel,
		maxConcurrency: Math.min(jevProvider.maxConcurrency, anthropicProvider.maxConcurrency),
		// judgeConfig — both legs' policies, named; the token budget is the Anthropic leg's, the only one that has one.
		judgeConfig: Object.freeze({
			temperaturePolicy: `${jevProvider.name}:${jevProvider.judgeConfig.temperaturePolicy}+${anthropicProvider.name}:${anthropicProvider.judgeConfig.temperaturePolicy}`,
			maxTokens: anthropicProvider.judgeConfig.maxTokens,
		}),
		rerank,
		describe,
	};
};

moduleFunction.PROVIDER_NAME = PROVIDER_NAME;

module.exports = moduleFunction;
