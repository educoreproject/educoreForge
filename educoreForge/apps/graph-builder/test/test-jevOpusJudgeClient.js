#!/usr/bin/env node
'use strict';

// test-jevOpusJudgeClient.js — THE JEV-THEN-OPUS CASCADE, HELD TO THE CONTRACT.
// Created 2026-09-30 (COPPER_LOOM).
//
// HERMETIC — both judges are doubles handed in through componentOverrides (jevProvider, anthropicProvider),
// so no network and no key is touched. The config is a throwaway ini in the temp directory.
//
// Run: node apps/graph-builder/test/test-jevOpusJudgeClient.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- the jevOpus cascade escalates below its cut and names who answered

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Holds jevOpusJudgeClient.js to the provider contract: an identity carrying both judges and the cut,
     Jev's answer standing at or above the cut (a NONE included), Opus answering below it, a Jev failure
     refused rather than escalated, and a rationale that records which judge answered.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');

const harness = require('../../../test/testLib/harness')(moduleName);

const { judgeProviderViolation } = require('../interfaces');
const jevOpusJudgeClientLib = require(path.join(__dirname, '..', 'apps', 'bridge-maker', 'lib', 'jevOpusJudgeClient'));

const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jevOpusJudgeClientTest-'));

const iniFilePathFor = (escalateBelowConfidence) => {
	const iniFilePath = path.join(scratchDirectoryPath, `jevOpusJudge-${escalateBelowConfidence}.ini`);
	fs.writeFileSync(
		iniFilePath,
		['[jevOpusJudge]', `escalateBelowConfidence=${escalateBelowConfidence}`, 'jevConfigFilePath=/not/read/by/doubles', 'anthropicConfigFilePath=/not/read/by/doubles'].join('\n'),
	);
	return iniFilePath;
};

// jevDouble — answers with the scripted verdict (or error) and counts its calls.
const jevDouble = ({ verdict, error }) => {
	const callCountHolder = { count: 0 };
	return {
		callCountHolder,
		provider: {
			name: 'jev',
			wireModel: 'jev-1.13.0',
			model: 'jev:jev-1.13.0:data',
			maxConcurrency: 4,
			judgeConfig: Object.freeze({ temperaturePolicy: 'notOffered', maxTokens: null }),
			describe: () => ({ provider: 'jev', model: 'jev:jev-1.13.0:data', version: 'double' }),
			rerank: (rerankOptions, callback) => {
				callCountHolder.count += 1;
				setImmediate(() => callback(error || '', verdict));
			},
		},
	};
};

const anthropicDouble = () => {
	const callCountHolder = { count: 0 };
	return {
		callCountHolder,
		provider: {
			name: 'anthropic',
			wireModel: 'claude-opus-5',
			model: 'anthropic:claude-opus-5',
			maxConcurrency: 8,
			judgeConfig: Object.freeze({ temperaturePolicy: 'zero', maxTokens: 16000 }),
			describe: () => ({ provider: 'anthropic', model: 'anthropic:claude-opus-5', version: 'double' }),
			rerank: (rerankOptions, callback) => {
				callCountHolder.count += 1;
				setImmediate(() => callback('', { choice: '2', category: 'moderate', rationale: 'Opus chose "Learning Resource Identifier".', model: 'anthropic:claude-opus-5', attempts: 1, usage: { inputTokens: 5000 } }));
			},
		},
	};
};

const jevVerdictAt = (jevConfidence, choice = '1') => ({
	choice,
	category: choice === 'NONE' ? 'none' : 'moderate',
	rationale: `Jev chose "Has Organization Identifier" with confidence ${jevConfidence}.`,
	model: 'jev:jev-1.13.0:data',
	attempts: 1,
	jevConfidence,
});

const cascadeFor = ({ escalateBelowConfidence = 0.7, jev, anthropic }) =>
	jevOpusJudgeClientLib({ configFilePath: iniFilePathFor(escalateBelowConfidence), componentOverrides: { jevProvider: jev.provider, anthropicProvider: anthropic.provider } });

const runSequence = (caseList, finalCallback) => {
	if (!caseList.length) {
		finalCallback();
		return;
	}
	caseList[0](() => runSequence(caseList.slice(1), finalCallback));
};

harness.section('THE CASCADE SATISFIES JUDGE_PROVIDER_SHAPE');
const shapeCascade = cascadeFor({ jev: jevDouble({ verdict: jevVerdictAt(0.9) }), anthropic: anthropicDouble() });
harness.ok('no contract violation', judgeProviderViolation(shapeCascade, { providerLabel: 'jevOpus' }) === null, judgeProviderViolation(shapeCascade, { providerLabel: 'jevOpus' }));
harness.equal('the identity carries both judges and the cut', shapeCascade.model, 'jevOpus:jev-1.13.0:data@0.7+anthropic:claude-opus-5');
harness.equal('a different cut is a different identity', cascadeFor({ escalateBelowConfidence: 0.6, jev: jevDouble({ verdict: jevVerdictAt(0.9) }), anthropic: anthropicDouble() }).model, 'jevOpus:jev-1.13.0:data@0.6+anthropic:claude-opus-5');
harness.equal('concurrency is the lower of the two', shapeCascade.maxConcurrency, 4);
harness.equal("judgeConfig names both legs' policies", shapeCascade.judgeConfig.temperaturePolicy, 'jev:notOffered+anthropic:zero');
harness.equal("…and carries the Anthropic leg's token budget", shapeCascade.judgeConfig.maxTokens, 16000);

const caseList = [
	(done) => {
		const jev = jevDouble({ verdict: jevVerdictAt(0.7) });
		const anthropic = anthropicDouble();
		cascadeFor({ jev, anthropic }).rerank({ choiceEnum: ['1', '2', 'NONE'] }, (rerankError, verdict) => {
			harness.section('AT THE CUT, JEV ANSWERS AND OPUS IS NOT ASKED');
			harness.ok('no error', !rerankError, rerankError);
			harness.equal("Jev's choice stands", verdict && verdict.choice, '1');
			harness.equal('Opus was not called', anthropic.callCountHolder.count, 0);
			harness.equal('answeredBy is jev', verdict && verdict.answeredBy, 'jev');
			harness.equal('model is the cascade identity', verdict && verdict.model, 'jevOpus:jev-1.13.0:data@0.7+anthropic:claude-opus-5');
			harness.match('the rationale records who answered', verdict && verdict.rationale, /\[jevOpus: Jev answered at confidence 0\.7 \(cut 0\.7\); Opus not asked\.\]$/);
			done();
		});
	},
	(done) => {
		const jev = jevDouble({ verdict: jevVerdictAt(0.85, 'NONE') });
		const anthropic = anthropicDouble();
		cascadeFor({ jev, anthropic }).rerank({ choiceEnum: ['1', '2', 'NONE'] }, (rerankError, verdict) => {
			harness.section('A CONFIDENT NONE IS AN ANSWER');
			harness.equal('NONE stands', verdict && verdict.choice, 'NONE');
			harness.equal('Opus was not called', anthropic.callCountHolder.count, 0);
			done();
		});
	},
	(done) => {
		const jev = jevDouble({ verdict: jevVerdictAt(0.69) });
		const anthropic = anthropicDouble();
		cascadeFor({ jev, anthropic }).rerank({ choiceEnum: ['1', '2', 'NONE'] }, (rerankError, verdict) => {
			harness.section('BELOW THE CUT, OPUS ANSWERS');
			harness.ok('no error', !rerankError, rerankError);
			harness.equal("Opus's choice stands", verdict && verdict.choice, '2');
			harness.equal("Opus's category stands", verdict && verdict.category, 'moderate');
			harness.equal('both judges were called once', `${jev.callCountHolder.count},${anthropic.callCountHolder.count}`, '1,1');
			harness.equal('answeredBy is anthropic', verdict && verdict.answeredBy, 'anthropic');
			harness.equal('model is the cascade identity, not Opus alone', verdict && verdict.model, 'jevOpus:jev-1.13.0:data@0.7+anthropic:claude-opus-5');
			harness.match("the rationale keeps Opus's reason first", verdict && verdict.rationale, /^Opus chose "Learning Resource Identifier"\./);
			harness.match("…and records Jev's view", verdict && verdict.rationale, /\[jevOpus: escalated; Jev's confidence 0\.69 is below the cut 0\.7\. Jev's view: Jev chose "Has Organization Identifier"/);
			harness.equal('attempts add up', verdict && verdict.attempts, 2);
			harness.equal("Jev's choice is kept as evidence", verdict && verdict.jevChoice, '1');
			done();
		});
	},
	(done) => {
		const jev = jevDouble({ error: 'jevJudgeClient: HTTP 503 after 3 attempt(s)' });
		const anthropic = anthropicDouble();
		cascadeFor({ jev, anthropic }).rerank({ choiceEnum: ['1', '2', 'NONE'] }, (rerankError) => {
			harness.section('A JEV FAILURE IS REFUSED, NEVER ESCALATED');
			harness.match('refused by name', rerankError, /the Jev judge refused, and a cascade does not escalate a failure: jevJudgeClient: HTTP 503/);
			harness.equal('Opus was not called', anthropic.callCountHolder.count, 0);
			done();
		});
	},
	(done) => {
		const jev = jevDouble({ verdict: { ...jevVerdictAt(0.9), jevConfidence: undefined } });
		const anthropic = anthropicDouble();
		cascadeFor({ jev, anthropic }).rerank({ choiceEnum: ['1', '2', 'NONE'] }, (rerankError) => {
			harness.section('A JEV VERDICT WITHOUT A CONFIDENCE IS REFUSED');
			harness.match('refused by name', rerankError, /carries no jevConfidence/);
			done();
		});
	},
];

harness.section('CONFIGURATION IS REFUSED BY NAME');
const badIniFilePath = path.join(scratchDirectoryPath, 'bad.ini');
fs.writeFileSync(badIniFilePath, '[jevOpusJudge]\nescalateBelowConfidence=1.2\njevConfigFilePath=x\nanthropicConfigFilePath=y');
let badError = '';
try {
	jevOpusJudgeClientLib({ configFilePath: badIniFilePath, componentOverrides: { jevProvider: jevDouble({}).provider, anthropicProvider: anthropicDouble().provider } });
} catch (constructionFault) {
	badError = constructionFault.message;
}
harness.match('an out-of-range cut is refused', badError, /escalateBelowConfidence is '1\.2'.*from 0 to 1/);

runSequence(caseList, () => {
	fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });
	harness.report();
});
