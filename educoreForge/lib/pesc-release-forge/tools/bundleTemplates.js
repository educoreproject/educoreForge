'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// bundleTemplates.js — the text of every file the scaffold tool writes into a release bundle
// (DESIGN-pescForge.md §4.1). Each template takes the release's names (releaseNames.js) and
// returns the file's exact text. The scaffold gate (F15) regenerates a committed bundle and
// compares it with these templates' output byte for byte, so a hand edit to a bundle file, or a
// template change not followed by a rescaffold, is caught there.
//
// Only README_PROVENANCE.md carries facts of the moment (the date, the paths, the expander's commit),
// and the gate leaves it out of the comparison for that reason. Every other file is a function of
// the manifest entry and the folder alone.

const SCAFFOLD_TOOL_PATH = 'lib/pesc-release-forge/tools/scaffoldReleaseBundle.js';

const jsonFileText = (jsonValue) => `${JSON.stringify(jsonValue, null, '\t')}\n`;

const parserDescriptorText = ({ releaseNames }) => `# parserDescriptor.ini — ${releaseNames.standardKey} self-description (the bundle IS its own registration).
# WRITTEN BY ${SCAFFOLD_TOOL_PATH}; rescaffold rather than edit.
# The [parserDescriptor] section header is REQUIRED: qtools-config-file-processor discards
# sectionless settings, so a mistyped header makes every setting in this file invisible at once.
[parserDescriptor]
# standardName is every node's _source and must be unique across bundles (G-UNIQUE); it equals the
# declaration's standardSource exactly (G-SOURCE). TQ's ruling: one standard per release.
standardName=${releaseNames.standardSource}
displayName=${releaseNames.standardDisplayName}
entryModule=${releaseNames.entryModuleFileName}
# sourceFile is DELIBERATELY ABSENT: the parser reads the snapshot DIRECTORY (the release folder),
# which the forger hands over when sourceFile is omitted, and the framework verifies every file
# SHA256SUMS lists before the parser runs.
# roundTripValidator: a refusing stub until phase F4 builds the round-trip pair (the round-trip stage
# refuses every build whose declared validator does not load and export validate).
roundTripValidator=roundTripValidator.js
# defaultSnapshot is an explicit pin: a new snapshot directory changes nothing until this line flips.
defaultSnapshot=01
`;

const packageJsonText = ({ releaseNames }) =>
	jsonFileText({
		name: `forge-${releaseNames.standardKey}`,
		version: '1.0.0',
		main: releaseNames.entryModuleFileName,
		description: `${releaseNames.standardDisplayName} forge bundle — one PESC release on the shared library lib/pesc-release-forge. Written by the scaffold tool. It does no bridging.`,
		private: true,
	});

const entryModuleText = ({ releaseNames }) => `'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// ${releaseNames.entryModuleFileName} — the ${releaseNames.standardDisplayName} release forge on the Forge Framework.
// WRITTEN BY ${SCAFFOLD_TOOL_PATH} from the release's manifest
// entry; rescaffold rather than edit. Everything this bundle does lives in the shared library
// lib/pesc-release-forge/ (DESIGN-pescForge.md §4.1); this file only wires the framework, the shared
// hooks and this bundle's declaration together.
//
// \`require\` returns ({ embedder }) => bundle, the house two-stage form the forger expects.

const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const releaseBundle = require(path.join(__dirname, '..', '..', 'lib', 'pesc-release-forge', 'releaseBundle'));
const forgeDeclaration = require('./lib/declaration');
const hooks = releaseBundle.makeBundleHooks({ bundleDirPath: __dirname });

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks });

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
`;

const declarationModuleText = ({ releaseNames }) => `'use strict';

// declaration.js — ${releaseNames.standardKey}'s forge declaration, built by the shared library from
// releaseDeclaration.json beside this file. WRITTEN BY ${SCAFFOLD_TOOL_PATH}.
// The entry module and roundTripValidator.js both require this file, so both hold the SAME object.

const path = require('path');
const releaseBundle = require(path.join(__dirname, '..', '..', '..', 'lib', 'pesc-release-forge', 'releaseBundle'));

module.exports = releaseBundle.readForgeDeclaration({ bundleDirPath: path.join(__dirname, '..') });
`;

const roundTripValidatorText = ({ releaseNames }) => `'use strict';

// roundTripValidator.js — ${releaseNames.standardKey}'s round-trip validator, declared in parserDescriptor.ini.
// WRITTEN BY ${SCAFFOLD_TOOL_PATH}. The validator itself is the shared
// library's (lib/pesc-release-forge/roundTripValidatorFor.js), a refusing stub until phase F4.

const path = require('path');
const { makeRoundTripValidator } = require(path.join(__dirname, '..', '..', 'lib', 'pesc-release-forge', 'roundTripValidatorFor'));
const forgeDeclaration = require('./lib/declaration'); // the SAME declaration object as the entry module

module.exports = makeRoundTripValidator({ forgeDeclaration });
`;

const releaseTestText = ({ releaseNames }) => `#!/usr/bin/env node
'use strict';

// test-release.js — the PESC release gate suite, pointed at ${releaseNames.standardKey}. ALL PURE: no
// Docker, no network, no embedding. WRITTEN BY ${SCAFFOLD_TOOL_PATH}.
// The gates and their twins live in lib/pesc-release-forge/gateSuite.js; this bundle's frozen counts
// in ../lib/releaseCensus.json; the work order's expected literals in
// lib/pesc-release-forge/expectedReleaseLiterals.json.
//
// Run: node forges/${releaseNames.standardKey}/test/test-release.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => \`
NAME
     \${moduleName} -- the PESC release gates for ${releaseNames.standardDisplayName}

SYNOPSIS
     \${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
\`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { runReleaseGateSuite } = require(path.join(__dirname, '..', '..', '..', 'lib', 'pesc-release-forge', 'gateSuite'));

runReleaseGateSuite({ harness, bundleDirPath: path.join(__dirname, '..') }, () => harness.report());
`;

const releaseDeclarationText = ({ releaseNames, releaseName }) =>
	jsonFileText({
		releaseName,
		standard: releaseNames.standard,
		version: releaseNames.version,
		standardKey: releaseNames.standardKey,
		standardSource: releaseNames.standardSource,
		standardDisplayName: releaseNames.standardDisplayName,
		labelPrefix: releaseNames.labelPrefix,
		stableUriPropertyName: releaseNames.stableUriPropertyName,
		rootStableId: releaseNames.rootStableId,
		rootLabel: releaseNames.rootLabel,
		stableIdPatternText: releaseNames.stableIdPatternText,
		embedTextLabel: releaseNames.embedTextLabel,
	});

const releaseCensusText = ({ releaseName, releaseCensus }) =>
	jsonFileText({
		censusNote: `The counts this bundle's snapshot must reproduce, measured from the release folder by ${SCAFFOLD_TOOL_PATH} when the bundle was written. The forge refuses by name on any difference (gate F4). Never edit a value to match a measurement.`,
		releaseName,
		census: releaseCensus,
	});

const standardSourceLocationText = ({ releaseNames, releaseName, rootTargetNamespace }) => `standard: forge-${releaseNames.standardKey}
publishedVersion: ${releaseNames.version}
publishedVersionEvidence: the version of PESC release ${releaseName} as pescReleaseExpander's manifest entry states it (releaseEntry.version, copied into releaseManifestEntry.json beside this file); it is also the version token of the root schema's targetNamespace ${rootTargetNamespace}. Written by the scaffold tool. Keep the publishedVersion line bare: deriveVersionStamp takes the whole rest of that line as the version.
upstreamUrl: unknown (publisher: Postsecondary Electronic Standards Council, https://www.pesc.org; a release is our closure of PESC files, never a PESC artifact, and has no URL of its own)
copiedFrom: see README_PROVENANCE.md
`;

const checksumFileText = ({ shaByRelativePath }) =>
	Object.keys(shaByRelativePath)
		.sort()
		.map((oneRelativePath) => `${shaByRelativePath[oneRelativePath]}  ${oneRelativePath}\n`)
		.join('');

const provenanceReadmeText = ({ releaseNames, releaseName, manifestEntryDocument, shaByRelativePath, releaseFolderPath, manifestPath, expanderProvenanceText, scaffoldCommandText, copiedDateText }) => `# README_PROVENANCE — ${releaseNames.standardDisplayName}

Written by \`${SCAFFOLD_TOOL_PATH}\` on ${copiedDateText}. Not machine-checked; the bytes are checked
by \`SHA256SUMS\` (the framework, before every forge) and by \`releaseManifestEntry.json\` (loader 2).

| what | value |
|---|---|
| release | ${releaseName} (standard ${releaseNames.standard}, version ${releaseNames.version}) |
| expander verdict | ${manifestEntryDocument.releaseEntry.verdict} |
| closure digest | ${manifestEntryDocument.releaseEntry.closureDigest} |
| closure date | ${manifestEntryDocument.releaseEntry.closureDate} |
| source corpus digest | ${manifestEntryDocument.copiedFromManifest.sourceCorpus.corpusDigest} |
| expander manifest format | ${manifestEntryDocument.copiedFromManifest.manifestFormat} |
| expander code | ${expanderProvenanceText} |
| copied from | \`${releaseFolderPath}\` |
| manifest | \`${manifestPath}\` |

The release folder is pescReleaseExpander's closure of one PESC message schema over the exact library
files it names. It is ours, never a PESC artifact. Each .xsd file was copied byte for byte
(COPYFILE_EXCL) and never edited. \`releaseManifestEntry.json\` holds the release's entry from
\`releaseManifest.json\`, verbatim, under \`releaseEntry\`, and two manifest-level facts under
\`copiedFromManifest\`.

The command:

\`\`\`
${scaffoldCommandText}
\`\`\`

Files:

| sha256 | file |
|---|---|
${Object.keys(shaByRelativePath)
	.sort()
	.map((oneRelativePath) => `| ${shaByRelativePath[oneRelativePath]} | ${oneRelativePath} |`)
	.join('\n')}
`;

module.exports = {
	parserDescriptorText,
	packageJsonText,
	entryModuleText,
	declarationModuleText,
	roundTripValidatorText,
	releaseTestText,
	releaseDeclarationText,
	releaseCensusText,
	standardSourceLocationText,
	checksumFileText,
	provenanceReadmeText,
	jsonFileText,
	SCAFFOLD_TOOL_PATH,
	moduleName,
};
