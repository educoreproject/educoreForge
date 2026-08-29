#!/usr/bin/env node
'use strict';

// test-gCompat.js — G-COMPAT (SPEC-forgeFramework-v1.md §10.1; §7): complianceReport.activeAllowanceCount
// EQUALS the frozen per-forge count; every forge-time allowance's precondition met (declared-but-unneeded
// refused); a needed-but-undeclared allowance refused; a non-empty list outside the four refused; and
// the F3a rows exercised INSIDE the four — E6 (sourceUrl ''), S2 (name '' coercion in the kit), S6
// (parentEdgeSubstitutionTable in addEdge, census-counted). The toy is put inside the four by giving
// its declaration a migrating standardKey ('edfi' / 'sif' — inputFault shaping; the rows' declarableBy
// then admits it), and the TEST-ONLY MIGRATING_BUNDLE_LIST override is used only where the spec asks
// (registered shippedConfig:false) with a sibling conjunct asserting the override is ABSENT from
// shipped configuration.
//
// Run: node lib/forge-framework/test/test-gCompat.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-COMPAT: the allowance mechanism — counts EQUAL, preconditions enforced both ways, E6/S2/S6 live

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, refusalCase, shapedConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const { DME_ROLES } = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));

const GATE_ID = 'G-COMPAT';
const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'forge-framework.js';
const KIT_FILE = 'contractGraphKit.js';
const CENSUS_FILE = 'census.js';
const FROZEN_TOY_ALLOWANCE_COUNT = 0;
const REAL_FORGES_DIR = path.resolve(toyScenario.FRAMEWORK_DIR, '..', '..', 'forges');

const { MIGRATED_FORGE_ROSTER, migratedForgeDeclarationFor } = require('./testSupport/migratedForgeRoster');
const ALLOWANCE_COUNT_FILE = path.join(__dirname, 'acceptance', 'expectedAllowanceCounts.json');
const censusLib = require('../census');
const asStandard = (scenario, standardKey) => { scenario.forgeDeclaration.standardKey = standardKey; };
const withDescribeSource = (scenario, transform) => { const baseHooks = toyScenario.toyHooksFactory(); scenario.hookOverrides.describeSource = ({ parsed }) => transform(baseHooks.describeSource({ parsed })); };
const withWalkExtra = (scenario, extra) => { const baseHooks = toyScenario.toyHooksFactory(); scenario.hookOverrides.emitContractGraph = (context) => { const walkResult = baseHooks.emitContractGraph(context); extra(context); return walkResult; }; };
const mintNameless = ({ kit }) => kit.makeNode({ role: DME_ROLES.CLASS, perStandardLabel: 'ToyClass', stableId: 'toy:class/Nameless', name: null, structural: { parentId: kit.rootStableId, path: 'Nameless' }, searchTextElement: { role: DME_ROLES.CLASS, name: 'Nameless', standardName: 'Toy', owningName: 'Toy' }, origin: 'nameless' });
const addNativeEdge = ({ kit }) => kit.addEdge({ edgeType: 'HAS_CHILD', fromStableId: 'toy:class/Person', toStableId: 'toy:class/School', edgeContext: 'native parent edge' });
// S2's fixture, MOVED FROM name TO description (RULING FJ-P3-2). The row was authored against
// forgeSif.js:350 (`name`) and SIF's real coercion is :351 (`description`); its data contract now
// reads mustEqual ['description'], so a name-shaped fixture could no longer exercise it at all.
// NOTE THE SHAPE DIFFERENCE, which is why this is not a rename: the kit has TWO name branches
// (absent/null -> '' when licensed, and an explicit '' refused-or-counted) but only ONE description
// branch — an EXPLICIT '' — because nothing coerces an ABSENT description into a byte. So the
// fixture passes description '' rather than null, and `mintNameless` stays where it is, still used
// by the nameless-census conjuncts that are genuinely about names.
const mintEmptyDescription = ({ kit }) => kit.makeNode({ role: DME_ROLES.CLASS, perStandardLabel: 'ToyClass', stableId: 'toy:class/Blank', name: 'Blank', description: '', structural: { parentId: kit.rootStableId, path: 'Blank' }, searchTextElement: { role: DME_ROLES.CLASS, name: 'Blank', standardName: 'Toy', owningName: 'Toy' }, origin: 'empty description' });

// the shipped-configuration texts: the toy entry module + hooks + the four forges' entry modules
const shippedConfigTextList = () => {
	const toyList = ['forgeToy.js', 'lib/toyHooks.js', 'lib/toyForgeDeclaration.js', 'roundTripValidator.js'].map((oneRelative) => ({ fileName: `toyForge/${oneRelative}`, text: fs.readFileSync(path.join(toyScenario.TOY_DIR, oneRelative), 'utf8') }));
	const forgeList = fs.readdirSync(REAL_FORGES_DIR, { withFileTypes: true })
		.filter((oneEntry) => oneEntry.isDirectory() && fs.existsSync(path.join(REAL_FORGES_DIR, oneEntry.name, 'parserDescriptor.ini')))
		.map((oneEntry) => {
			const entryModule = (fs.readFileSync(path.join(REAL_FORGES_DIR, oneEntry.name, 'parserDescriptor.ini'), 'utf8').match(/^entryModule=(.+)$/m) || [])[1];
			return { fileName: `forges/${oneEntry.name}/${entryModule}`, text: entryModule ? fs.readFileSync(path.join(REAL_FORGES_DIR, oneEntry.name, entryModule.trim()), 'utf8') : '' };
		});
	return toyList.concat(forgeList);
};

const conjunctList = [
	shapedConjunct({
		conjunctId: 'countEqualsFrozen',
		title: `complianceReport.activeAllowanceCount EQUALS the frozen toy count (${FROZEN_TOY_ALLOWANCE_COUNT}) and activeAllowanceList is []`,
		twinNameList: ['declareE6UnderOverride'],
		judge: succeeded((result) => ({ pass: result.complianceReport.activeAllowanceCount === FROZEN_TOY_ALLOWANCE_COUNT && result.complianceReport.activeAllowanceList.length === 0, detail: JSON.stringify(result.complianceReport) })),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'declaredButUnneededRefused',
		title: "E6 declared (as edfi) while describeSource returns a real sourceUrl → refused 'allowance E6 active but its condition is not met'",
		shape: (scenario) => { asStandard(scenario, 'edfi'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E6' }]; },
		regex: /allowance E6 active but its condition is not met/,
		twinName: 'disableDeclaredButUnneededCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (!oneRow.preconditionMet(context)) {', replace: '\t\t\t\tif (!oneRow.preconditionMet(context) && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'neededButUndeclaredRefused',
		title: "describeSource returns sourceUrl '' (as edfi) with no E6 → refused naming E6 / S4 / P16",
		shape: (scenario) => { asStandard(scenario, 'edfi'); withDescribeSource(scenario, (described) => ({ ...described, sourceUrl: '' })); },
		regex: /would need allowance E6 \(edfi\) \/ S4 \(sif\) \/ P16 \(pesc260805\)/,
		twinName: 'disableNeededButUndeclaredCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (oneRow.preconditionMet(context)) {\n\t\t\t\t\tconst idList', replace: '\t\t\t\tif (false && oneRow.preconditionMet(context)) {\n\t\t\t\t\tconst idList',
	}),
	shapedConjunct({
		conjunctId: 'e6LiveReportedAndByteReproduced',
		title: "E6 declared and needed (as edfi, sourceUrl '') → the run succeeds, the root carries sourceUrl '' (the byte), activeAllowanceList EQUALS ['E6'] and count 1",
		twinNameList: ['censusHidesActiveAllowances'],
		shape: (scenario) => { asStandard(scenario, 'edfi'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E6' }]; withDescribeSource(scenario, (described) => ({ ...described, sourceUrl: '' })); },
		judge: succeeded((result) => { const rootNode = result.nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT); return { pass: rootNode.properties.sourceUrl === '' && result.complianceReport.activeAllowanceList.join(',') === 'E6' && result.complianceReport.activeAllowanceCount === 1, detail: `root sourceUrl ${JSON.stringify(rootNode.properties.sourceUrl)}; report ${JSON.stringify(result.complianceReport)}` }; }),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'outsideTheFourRefused',
		title: "the toy (outside the four) declaring E6 is refused naming MIGRATING_BUNDLE_LIST", mode: 'inject',
		shape: (scenario) => { scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E6' }]; },
		regex: /is non-empty but standardKey 'toy' is not in MIGRATING_BUNDLE_LIST \(ceds, edfi, sif, pesc260805\)/,
		twinName: 'putToyInsideTheFour', leverKind: 'inputFault', shippedConfig: false,
		mutate: (scenario) => { scenario.deps = { ...scenario.deps, migratingBundleListOverride: ['toy'] }; },
	}),
	{
		conjunctId: 'migratedForgeCountsEqualFrozen',
		title: `G-CENSUS compliance half (SPEC §10.2, FB3): for each MIGRATED forge (${MIGRATED_FORGE_ROSTER.map((oneForge) => oneForge.standardKey).join(', ')}) the LIVE complianceReport.activeAllowanceCount computed by the framework's census over the forge's REAL declaration EQUALS expectedAllowanceCounts.json's frozen count, and the id list EQUALS the frozen list`,
		twinNameList: ['migratedForgeDeclaresThirdAllowance'],
		evaluate: (scenario, callback) => {
			const frozenData = JSON.parse(fs.readFileSync(ALLOWANCE_COUNT_FILE, 'utf8')).byStandardKey;
			const detailList = [];
			const offenderList = MIGRATED_FORGE_ROSTER.filter((oneForge) => {
				const frozen = frozenData[oneForge.standardKey];
				const declaration = (scenario.migratedDeclarationOverrideByStandardKey || {})[oneForge.standardKey] || migratedForgeDeclarationFor(oneForge.standardKey);
				const report = censusLib.complianceReport({ forgeDeclaration: declaration, nodes: [], kitStats: {} });
				const pass = frozen !== undefined && report.activeAllowanceCount === frozen.frozenCount && report.activeAllowanceList.join(',') === frozen.frozenList.join(',');
				detailList.push(`${oneForge.standardKey} live ${report.activeAllowanceCount} [${report.activeAllowanceList.join(',')}] ${pass ? '==' : '!='} frozen ${frozen ? `${frozen.frozenCount} [${frozen.frozenList.join(',')}]` : 'ABSENT'}`);
				return !pass;
			});
			callback('', { pass: offenderList.length === 0, detail: detailList.join('; ') });
		},
	},
	shapedConjunct({
		conjunctId: 'e8LiveLogicalSourceFileNames',
		title: "E8 declared (as edfi) with logicalSourceFileNameList ['descriptorCodeValues'] and sourceFiles naming that LOGICAL name beside the verified file → the run succeeds, the root carries the names verbatim, activeAllowanceList EQUALS ['E8'] (ruling 06:33, tightened 03:40)",
		twinNameList: ['frameworkIgnoresE8'],
		shape: (scenario) => { asStandard(scenario, 'edfi'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E8', logicalSourceFileNameList: ['descriptorCodeValues'] }]; withDescribeSource(scenario, (described) => ({ ...described, sourceFiles: described.sourceFiles.concat(['descriptorCodeValues']) })); },
		judge: succeeded((result) => { const rootNode = result.nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT); return { pass: rootNode.properties.sourceFiles.join(',') === 'toyModel.json,descriptorCodeValues' && result.complianceReport.activeAllowanceList.join(',') === 'E8', detail: `root sourceFiles ${JSON.stringify(rootNode.properties.sourceFiles)}; report ${JSON.stringify(result.complianceReport.activeAllowanceList)}` }; }),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e8DeclaredButUnneededRefused',
		title: "E8 declared (as edfi, logicalSourceFileNameList []) while every sourceFiles entry IS verified → refused 'allowance E8 active but its condition is not met'",
		shape: (scenario) => { asStandard(scenario, 'edfi'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E8', logicalSourceFileNameList: [] }]; },
		regex: /allowance E8 active but its condition is not met/,
		twinName: 'disableDeclaredButUnneededCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (!oneRow.preconditionMet(context)) {', replace: '\t\t\t\tif (!oneRow.preconditionMet(context) && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e8UndeclaredUnverifiedEntryRefused',
		title: "E8 declared (as edfi) with logicalSourceFileNameList ['descriptorCodeValues'] while sourceFiles ALSO names 'strayLogicalName' (neither verified nor declared) → refused naming the entry and the declared list (E8 tightened, ruling 03:40)",
		shape: (scenario) => { asStandard(scenario, 'edfi'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E8', logicalSourceFileNameList: ['descriptorCodeValues'] }]; withDescribeSource(scenario, (described) => ({ ...described, sourceFiles: described.sourceFiles.concat(['descriptorCodeValues', 'strayLogicalName']) })); },
		regex: /sourceFiles entry 'strayLogicalName' that is neither verified against SHA256SUMS .* nor a declared logical name \(declared: descriptorCodeValues\)/,
		twinName: 'disableUndeclaredEntryCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (unverifiedSourceFile !== undefined) {', replace: '\t\t\t\t\tif (unverifiedSourceFile !== undefined && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e8StaleDeclaredNameRefused',
		title: "E8 declared (as edfi) with logicalSourceFileNameList ['descriptorCodeValues', 'neverUsedName'] while sourceFiles uses only the first → refused naming 'neverUsedName' as stale declaration data (E8 tightened, ruling 03:40)",
		shape: (scenario) => { asStandard(scenario, 'edfi'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E8', logicalSourceFileNameList: ['descriptorCodeValues', 'neverUsedName'] }]; withDescribeSource(scenario, (described) => ({ ...described, sourceFiles: described.sourceFiles.concat(['descriptorCodeValues']) })); },
		regex: /declares logical sourceFiles name 'neverUsedName' \(allowance E8\) that describeSource.sourceFiles does not use/,
		twinName: 'disableStaleLogicalNameCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (staleLogicalSourceFileName !== undefined) {', replace: '\t\t\t\t\tif (staleLogicalSourceFileName !== undefined && false) {',
	}),
	shapedConjunct({
		conjunctId: 's2LiveInKit',
		title: "S2 declared (as sif) with an empty-description node → description '' SHIPS as the byte, activeAllowanceList ['S2'], and the node's NAME is untouched (the coercion is scoped to the one declared property)",
		twinNameList: ['kitIgnoresCoercionAllowance'],
		shape: (scenario) => { asStandard(scenario, 'sif'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S2', coerceEmptyStringPropertyList: ['description'] }]; withWalkExtra(scenario, mintEmptyDescription); },
		judge: succeeded((result) => { const blankNode = result.nodes.find((oneNode) => oneNode.stableId === 'toy:class/Blank'); return { pass: blankNode.properties.description === '' && blankNode.properties.name === 'Blank' && result.complianceReport.activeAllowanceList.join(',') === 'S2', detail: `description ${JSON.stringify(blankNode.properties.description)}; name ${JSON.stringify(blankNode.properties.name)}; report ${JSON.stringify(result.complianceReport)}` }; }),
	}),
	shapedConjunct({
		conjunctId: 's2CountsCallerEmptyDescription',
		title: "S2 declared (as sif) with a hook passing description '' → emptyStringCoercionCount EQUALS 1 (FA4: counted, never silent — a coercion that ships unrecorded is the silent-default class)",
		twinNameList: ['kitDoesNotCountEmptyDescription'],
		shape: (scenario) => { asStandard(scenario, 'sif'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S2', coerceEmptyStringPropertyList: ['description'] }]; withWalkExtra(scenario, ({ kit }) => kit.makeNode({ role: DME_ROLES.CLASS, perStandardLabel: 'ToyClass', stableId: 'toy:class/EmptyDescribed', name: 'EmptyDescribed', description: '', structural: { parentId: kit.rootStableId, path: 'EmptyDescribed' }, searchTextElement: { role: DME_ROLES.CLASS, name: 'EmptyDescribed', standardName: 'Toy', owningName: 'Toy' }, origin: 'empty description' })); },
		judge: succeeded((result) => { const emptyNode = result.nodes.find((oneNode) => oneNode.stableId === 'toy:class/EmptyDescribed'); return { pass: emptyNode.properties.description === '' && result.stats.emptyStringCoercionCount === 1 && result.complianceReport.activeAllowanceList.join(',') === 'S2', detail: `description ${JSON.stringify(emptyNode.properties.description)}; emptyStringCoercionCount ${result.stats.emptyStringCoercionCount}` }; }),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 's2DeclaredButUnneededRefused',
		title: "S2 declared (as sif) with NO empty-description node → refused 'allowance S2 active but its condition is not met' (contract-graph step)",
		shape: (scenario) => { asStandard(scenario, 'sif'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S2', coerceEmptyStringPropertyList: ['description'] }]; },
		regex: /buildContractGraph: .*allowance S2 active but its condition is not met/,
		twinName: 'disableDeclaredButUnneededCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (!oneRow.preconditionMet(context)) {', replace: '\t\t\t\tif (!oneRow.preconditionMet(context) && false) {',
	}),
	shapedConjunct({
		conjunctId: 's6LiveInKit',
		title: "S6 declared (as sif) with parentEdgeSubstitutionTable { HAS_CHILD: REFERENCES } and a native HAS_CHILD edge → a REFERENCES edge is emitted, substitutionCount EQUALS 1, activeAllowanceList ['S6']",
		twinNameList: ['kitIgnoresSubstitutionTable'],
		shape: (scenario) => { asStandard(scenario, 'sif'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S6', parentEdgeSubstitutionTable: { HAS_CHILD: 'REFERENCES' } }]; withWalkExtra(scenario, addNativeEdge); },
		judge: succeeded((result) => { const substituted = result.edges.find((oneEdge) => oneEdge.type === 'REFERENCES' && oneEdge.fromRef.id === 'toy:class/Person' && oneEdge.toRef.id === 'toy:class/School'); return { pass: substituted !== undefined && result.complianceReport.substitutionCount === 1 && result.complianceReport.activeAllowanceList.join(',') === 'S6', detail: `substituted edge ${substituted ? 'present' : 'ABSENT'}; report ${JSON.stringify(result.complianceReport)}` }; }),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 's6DeclaredButUnneededRefused',
		title: "S6 declared (as sif) with NO substitution on this build → refused 'allowance S6 active but its condition is not met'",
		shape: (scenario) => { asStandard(scenario, 'sif'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'S6', parentEdgeSubstitutionTable: { HAS_CHILD: 'REFERENCES' } }]; },
		regex: /buildContractGraph: .*allowance S6 active but its condition is not met/,
		twinName: 'disableDeclaredButUnneededCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (!oneRow.preconditionMet(context)) {', replace: '\t\t\t\tif (!oneRow.preconditionMet(context) && false) {',
	}),
	{
		conjunctId: 'overrideAbsentFromShippedConfig',
		title: "the TEST-ONLY 'migratingBundleListOverride' token is ABSENT from shipped configuration (the toy entry/hooks/validator and the four forges' entry modules)",
		twinNameList: ['shippedEntryPassesOverride'],
		evaluate: (scenario, callback) => {
			const offenderList = shippedConfigTextList().concat(scenario.staticExtraSourceList || []).filter((oneFile) => /migratingBundleListOverride/.test(oneFile.text)).map((oneFile) => oneFile.fileName);
			callback('', { pass: offenderList.length === 0, detail: offenderList.length ? `override token in: ${offenderList.join(', ')}` : `${shippedConfigTextList().length} shipped files clean` });
		},
	},
];

scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'migratedForgeCountsEqualFrozen', twinName: 'migratedForgeDeclaresThirdAllowance', leverKind: 'inputFault', mutate: (scenario) => { const edfiDeclaration = migratedForgeDeclarationFor('edfi'); scenario.migratedDeclarationOverrideByStandardKey = { edfi: { ...edfiDeclaration, compatibilityDeclarationList: edfiDeclaration.compatibilityDeclarationList.concat([{ allowanceId: 'S4' }]) } }; } });
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'countEqualsFrozen', twinName: 'declareE6UnderOverride', leverKind: 'inputFault', shippedConfig: false, mutate: (scenario) => { asStandard(scenario, 'edfi'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'E6' }]; withDescribeSource(scenario, (described) => ({ ...described, sourceUrl: '' })); scenario.deps = { ...scenario.deps, migratingBundleListOverride: ['toy', 'edfi'] }; } });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e6LiveReportedAndByteReproduced', twinName: 'censusHidesActiveAllowances', fileName: CENSUS_FILE, find: '\tconst activeAllowanceList = forgeDeclaration.compatibilityDeclarationList.map((oneEntry) => oneEntry.allowanceId);', replace: '\tconst activeAllowanceList = [];' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'e8LiveLogicalSourceFileNames', twinName: 'frameworkIgnoresE8', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\t.filter((oneRow) => oneRow.permitsUnverifiedSourceFileNames === true)', replace: '\t\t\t\t\t\t.filter((oneRow) => false)' });
// TWIN MOVED WITH THE ROW (FJ-P3-2). It mutated the kit's NAME branch, which the S2 conjuncts no
// longer exercise — left alone it would go on "passing" against a lever that could never redden its
// conjunct, which is the defect class STANDDOWN-P2 C.1 records. The lever now disables the
// DESCRIPTION allowance consultation, so the licensed '' byte is refused and s2LiveInKit goes red.
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 's2LiveInKit', twinName: 'kitIgnoresCoercionAllowance', fileName: KIT_FILE, find: "\t\t\tif (emptyStringCoercionPropertyList.indexOf('description') === -1) {", replace: "\t\t\tif (true) {" });
// Same move. The lever removes the COUNT from the DESCRIPTION branch only (the name branch keeps
// its own), so the '' byte still ships and only the tally goes wrong — exactly what
// s2CountsCallerEmptyDescription asserts, and nothing else in the suite would catch it.
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 's2CountsCallerEmptyDescription', twinName: 'kitDoesNotCountEmptyDescription', fileName: KIT_FILE, find: "\t\t\tstats.emptyStringCoercionCount += 1;\n\t\t}\n\t\tif (searchTextElement !== undefined", replace: "\t\t}\n\t\tif (searchTextElement !== undefined" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 's6LiveInKit', twinName: 'kitIgnoresSubstitutionTable', fileName: KIT_FILE, find: '\t\t\tif (parentEdgeSubstitutionTable[edgeType] !== undefined) {', replace: '\t\t\tif (false && parentEdgeSubstitutionTable[edgeType] !== undefined) {' });
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'overrideAbsentFromShippedConfig', twinName: 'shippedEntryPassesOverride', leverKind: 'productionMutation', mutate: (scenario) => { scenario.staticExtraSourceList = (scenario.staticExtraSourceList || []).concat([{ fileName: 'forges/toy/forgeToy.js (in-memory shipped double)', text: "forgeFramework({ embedder, migratingBundleListOverride: ['toy'] })" }]); } });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the compatibility-declaration mechanism', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), staticExtraSourceList: (scenario.staticExtraSourceList || []).slice(), migratedDeclarationOverrideByStandardKey: scenario.migratedDeclarationOverrideByStandardKey }), expectedConjunctCount: 16, expectedTwinCount: 16 }, () => harness.report());
