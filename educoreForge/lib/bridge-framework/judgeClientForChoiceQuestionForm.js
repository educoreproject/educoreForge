'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// judgeClientForChoiceQuestionForm.js — the judge a bridge runs under, bound to that bridge's split-question form.
//
// ⟪lane JEVQ, ruling COPPER_RIVER 2026-10-13⟫ The split question's form is chosen PER BRIDGE (the plugin's
// choiceQuestionFormName picks the variant; the variant row names the form). A judge provider's identity may differ by form
// (a judge that reads the split question asks a different question in each), so the provider answers
// modelForChoiceQuestionForm, a member JUDGE_PROVIDER_SHAPE requires of every provider. This module asks it ONCE per bridge
// and returns a view of the provider whose `model` is that answer and whose rerank hands the form, by name, with every
// question. Everything downstream (judgment-cache key, frozen record, header judgeKind, edge judge name) reads `model` and
// so carries the form's identity without knowing forms exist.
//
//   judgeClientBoundToChoiceQuestionForm({ judgeClient, choiceQuestionFormName }) → { judgeClient } | { error }
//     judgeClient null (a run with no judge)        → { judgeClient: null }
//     choiceQuestionFormName null (the variant builds no split question) → the provider itself, unbound
//     otherwise                                     → the bound view, or the provider's refusal by name
//
// A form the provider does not know is refused by the provider, never mapped to another.

const judgeClientBoundToChoiceQuestionForm = ({ judgeClient, choiceQuestionFormName }) => {
	if (judgeClient === null) {
		return { judgeClient: null };
	}
	if (choiceQuestionFormName === null) {
		return { judgeClient };
	}
	if (typeof choiceQuestionFormName !== 'string' || choiceQuestionFormName === '') {
		return { error: `${moduleName}: the variant names choiceQuestionFormName ${JSON.stringify(choiceQuestionFormName)}; a form is a non-empty name, or null when the variant builds no split question` };
	}
	const modelResult = judgeClient.modelForChoiceQuestionForm(choiceQuestionFormName);
	if (!modelResult || modelResult.error || typeof modelResult.model !== 'string' || modelResult.model === '') {
		return { error: `${moduleName}: judge '${judgeClient.model}' names no identity for split-question form '${choiceQuestionFormName}': ${modelResult && modelResult.error ? modelResult.error : JSON.stringify(modelResult)}` };
	}
	const formModel = modelResult.model;
	return {
		judgeClient: Object.freeze({
			...judgeClient,
			model: formModel,
			rerank: (rerankOptions, rerankCallback) => judgeClient.rerank({ ...rerankOptions, choiceQuestionFormName }, rerankCallback),
			describe: () => ({ ...judgeClient.describe(), model: formModel }),
		}),
	};
};

module.exports = { judgeClientBoundToChoiceQuestionForm, moduleName };
