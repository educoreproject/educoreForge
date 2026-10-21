#!/usr/bin/env node
'use strict';

// test-hubLiteralCensus.js — gate for apps/graph-builder/lib/hub-literal-census.js, its CLI tools/hubLiteralCensus.js, and
// THE LANE GATE ITSELF (R0 proof kit, 2026-10-21, step 9): this tree's 'code' count of the hub token must not exceed the
// count recorded in the baseline census (graphBuilder.ini [noRebuildProof] baselineDirectoryPath/literalCensus.json).
//
// PROVES:
//   (a) an occurrence is the token STARTING a name: word start, the regex escape \b, or capitalised mid-word count; a
//       lower-case run inside another word does not; a declared false-positive word does not
//   (b) the .js split: line comment, block comment (across lines) → comments; code and string literals (a URL's // does
//       not open a comment) → code; a template literal carries across lines
//   (c) path classes, first rule wins
//   (d) the tree census over a throwaway git repo: the hub's own bundle is excluded, an untracked file is not counted, a
//       binary file is skipped, every class is counted
//   (e) the CLI: refused without --hubToken; with a baseline whose code count is LOWER, exits 1 and says ROSE
//   (f) THE LANE GATE: this tree's code count against the recorded baseline (absent config refuses, never skips)
//   (g) no hub literal in the tool or its library

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the hub-literal census counts correctly, and this tree's code count has not risen
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);
const { getConfig } = process.global;

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const censusLib = require('../lib/hub-literal-census');
const TOOL_PATH = path.join(__dirname, '..', 'tools', 'hubLiteralCensus.js');
const TOY_HUB_TOKEN = 'hubx';
const NO_FALSE_POSITIVES = [];
const countIn = (lineText, falsePositiveWordList) => censusLib.occurrenceIndexListIn({ lineText, hubToken: TOY_HUB_TOKEN, falsePositiveWordList: falsePositiveWordList || NO_FALSE_POSITIVES }).length;

harness.section('(a) what counts as an occurrence');
harness.equal('word start', countIn('const hubx = 1;'), 1);
harness.equal('upper case', countIn('the HUBX hub'), 1);
harness.equal('capitalised mid-word (edfiHubxDerived)', countIn('edfiHubxDerivedPlugin'), 1);
harness.equal('after a colon (hubx:C000001)', countIn("'hubx:C000001'"), 1);
harness.equal('after the regex escape \\b', countIn('/\\bhubx\\b/'), 1);
harness.equal('lower case inside another word is not the hub (refhubxStable)', countIn('refhubxStable'), 0);
harness.equal('a declared false-positive word is not counted', countIn('the hubxtanding row', ['hubxtanding']), 0);
harness.equal('two on one line', countIn('hubx and Hubx'), 2);

harness.section('(b) the .js split');
const splitOf = (fileText) => censusLib.jsOccurrenceSplitFor({ fileText, hubToken: TOY_HUB_TOKEN, falsePositiveWordList: NO_FALSE_POSITIVES })
	.map((oneLine) => `${oneLine.lineNumber}:${oneLine.codeCount}/${oneLine.commentCount}`).join(' ');
harness.equal('code, then a trailing line comment on the same line', splitOf("const hubxId = 'x'; // the hubx id"), '1:1/1');
harness.equal('a block comment across lines', splitOf('/* about\n hubx here\n*/ const hubx = 1;'), '2:0/1 3:1/0');
harness.equal("a URL's // inside a string does not open a comment", splitOf("const iri = 'https://example.org/Hubx/terms/';"), '1:1/0');
harness.equal('a template literal carries across lines; its // is text', splitOf('const helpText = `\n see https://x/ hubx\n`; // hubx'), '2:1/0 3:0/1');
harness.equal('an escaped quote does not end the string', splitOf("const t = 'it\\'s hubx'; // hubx"), '1:1/1');

harness.section('(c) path classes');
const rules = censusLib.readRules();
const classOf = (relativePath) => censusLib.classNameForPath({ relativePath, classRuleList: rules.classRuleList });
harness.equal('lib .js → source', classOf('lib/bridge-framework/bridge-framework.js'), 'source');
harness.equal('a test suite → testsAndFixtures', classOf('apps/graph-builder/test/test-build.js'), 'testsAndFixtures');
harness.equal('a fixture → testsAndFixtures', classOf('lib/bridge-framework/test/fixtures/x.json'), 'testsAndFixtures');
harness.equal('a README → docs', classOf('apps/graph-builder/README_BridgeDocumentation/a.md'), 'docs');
harness.equal('a source asset → assets', classOf('forges/edfi/assets/x.xsd'), 'assets');
harness.equal('a recipe → data', classOf('recipes/goldCtdlHub.recipe.jsonc'), 'data');
harness.equal('a retired bridge → retired', classOf('forges/edfi/retiredBridges/x.js'), 'retired');

harness.section('(d) the tree census over a throwaway git repo');
const scratchTreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'testHubLiteralCensus-'));
const writeTreeFile = (relativePath, fileContent) => {
	fs.mkdirSync(path.dirname(path.join(scratchTreePath, relativePath)), { recursive: true });
	fs.writeFileSync(path.join(scratchTreePath, relativePath), fileContent);
};
writeTreeFile(`forges/${TOY_HUB_TOKEN}/lib/hub.js`, 'const hubx = 1;\n');
writeTreeFile('lib/thing/thing.js', "// hubx comment\nconst name = 'hubx';\nconst refhubxStable = 2;\n");
writeTreeFile('lib/thing/test/test-thing.js', 'hubx\nhubx\n');
writeTreeFile('docs/README.md', 'the hubx hub\n');
writeTreeFile('recipes/one.recipe.jsonc', '{ "hub": "hubx" }\n');
writeTreeFile('lib/thing/binary.bin', Buffer.from([0x68, 0x75, 0x62, 0x78, 0x00, 0x01]));
spawnSync('git', ['-C', scratchTreePath, 'init', '-q']);
spawnSync('git', ['-C', scratchTreePath, 'add', '.']);
writeTreeFile('lib/thing/untracked.js', 'const hubx = 3;\n');
const treeCensus = censusLib.censusOfTree({ treeRootPath: scratchTreePath, hubToken: TOY_HUB_TOKEN, rules });
harness.ok('the census answers', treeCensus.error === undefined, treeCensus.error);
const countText = (className) => `${treeCensus.census.countByClass[className].lineCount}/${treeCensus.census.countByClass[className].occurrenceCount}/${treeCensus.census.countByClass[className].fileCount}`;
harness.equal('code: one line (the string), the hub bundle and the untracked file excluded', countText('code'), '1/1/1');
harness.equal('comments: one line', countText('comments'), '1/1/1');
harness.equal('testsAndFixtures: two lines', countText('testsAndFixtures'), '2/2/1');
harness.equal('docs and data: one each', `${countText('docs')} ${countText('data')}`, '1/1/1 1/1/1');
harness.equal('the binary file is skipped', treeCensus.census.occurrenceListByClass.data.join(','), 'recipes/one.recipe.jsonc:1');
const noBundle = censusLib.censusOfTree({ treeRootPath: scratchTreePath, hubToken: 'nosuchhub', rules });
harness.match('a hub token with no bundle in the tree is refused by name', String(noBundle.error), /holds no forges\/nosuchhub\//);

harness.section('(e) the CLI');
const runTool = (argumentList) => spawnSync(process.execPath, [TOOL_PATH, ...argumentList], { encoding: 'utf8' });
const noToken = runTool([]);
harness.equal('no --hubToken exits 1', noToken.status, 1);
harness.match('no --hubToken is refused by name', `${noToken.stdout}${noToken.stderr}`, /--hubToken is required and absent/);
const fakeBaselinePath = path.join(scratchTreePath, 'lowBaseline.json');
const zeroCountByClass = rules.countedClassNameList.reduce((soFar, className) => ({ ...soFar, [className]: { lineCount: 0, occurrenceCount: 0 } }), {});
fs.writeFileSync(fakeBaselinePath, JSON.stringify({ hubToken: 'ceds', treeHead: 'fixture', countByClass: zeroCountByClass }));
const rose = runTool(['--hubToken=ceds', `--baselineCensusPath=${fakeBaselinePath}`]);
harness.equal('a code count above the baseline exits 1', rose.status, 1);
harness.match('and says ROSE', rose.stdout, /code count ROSE: FAIL/);
const partialBaselinePath = path.join(scratchTreePath, 'partialBaseline.json');
fs.writeFileSync(partialBaselinePath, JSON.stringify({ hubToken: 'ceds', treeHead: 'fixture', countByClass: { code: { lineCount: 9999, occurrenceCount: 9999 } } }));
const partial = runTool(['--hubToken=ceds', `--baselineCensusPath=${partialBaselinePath}`]);
harness.match('a baseline missing a class is refused by name, never read as zero', `${partial.status} ${partial.stdout}${partial.stderr}`, /^1 [\s\S]*the baseline counts no class comments/);

harness.section('(f) THE LANE GATE: this tree against the recorded baseline');
const proofConfig = getConfig('noRebuildProof') || {};
const baselineCensusPath = typeof proofConfig.baselineDirectoryPath === 'string' ? path.join(proofConfig.baselineDirectoryPath, 'literalCensus.json') : '';
harness.ok('graphBuilder.ini [noRebuildProof] baselineDirectoryPath names a directory holding literalCensus.json', baselineCensusPath !== '' && fs.existsSync(baselineCensusPath), `got ${JSON.stringify(proofConfig.baselineDirectoryPath)}; there is no default and the gate does not skip`);
if (baselineCensusPath !== '' && fs.existsSync(baselineCensusPath)) {
	const gateRun = runTool([`--hubToken=${JSON.parse(fs.readFileSync(baselineCensusPath, 'utf8')).hubToken}`, `--baselineCensusPath=${baselineCensusPath}`]);
	harness.equal('this tree\'s code count did not rise above the baseline', gateRun.status, 0);
	harness.match('the gate line', gateRun.stdout, /code count did not rise: PASS/);
}

harness.section('(g) no hub literal');
const literalFileList = [TOOL_PATH, require.resolve('../lib/hub-literal-census'), censusLib.RULES_FILE_PATH]
	.filter((filePath) => censusLib.occurrenceIndexListIn({ lineText: fs.readFileSync(filePath, 'utf8'), hubToken: 'ceds', falsePositiveWordList: rules.falsePositiveWordList }).length > 0);
harness.equal('the tool, its library and its rules name no hub', literalFileList.join(','), '');

fs.rmSync(scratchTreePath, { recursive: true, force: true });
harness.report();
