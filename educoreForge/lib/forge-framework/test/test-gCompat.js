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
const ROOT_NODE_FILE = 'rootNode.js';
const DECLARATION_CONTRACT_FILE = 'forgeDeclarationContract.js';
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
// P4 fixture data: an edge whose type is OUTSIDE EDGE_TYPES but INSIDE the declared allow list —
// the admission the row licenses. DECLARES is PESC's largest such relation (12,991 edges in the
// real block) and is a RELATION, not a synonym for a registry type, which is why PESC's seven are
// ADMITTED by P4 rather than TRANSLATED by an S6-shaped substitution table.
const PESC_EDGE_TYPE_ALLOW_LIST = ['DECLARES', 'IMPORTS', 'IN_NAMESPACE', 'MERGED_FROM', 'RESOLVES_TO', 'SAME_DEFINITION', 'SERVED_BY'];
const addAllowListedEdge = ({ kit }) => kit.addEdge({ edgeType: 'DECLARES', fromStableId: 'toy:class/Person', toStableId: 'toy:class/School', edgeContext: 'an allow-listed relation' });
const withDescribeRoot = (scenario, transform) => { const baseHooks = toyScenario.toyHooksFactory(); scenario.hookOverrides.describeRoot = (context) => transform(baseHooks.describeRoot(context)); };
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
	// ---- THE FOUR PESC ROWS CREATED IN THE HUB-KIT-ROLE PHASE 4 MIGRATION -------------------
	// Scope ruled by FJ-P4-6/7 after I measured the existing coverage and asked: this gate has
	// conjuncts for E6, E8, S2 and S6 and NONE for S3, S4 or S7. So P9's kit behaviour is ALREADY
	// covered by s2LiveInKit — the two share rowRefId 'emptyStringCoercion' — and P17 shares a
	// behaviour that has never had a conjunct on either side. P4 and P5 introduce mechanisms with
	// NO existing coverage at all: edgeTypeAllowList and rootExtraPropertyNameList. Hence: FULL
	// conjunct + both twins for P4 and P5, a DECLARABILITY conjunct for P9 and P17, and NO
	// retro-fit for S3/S4/S7, which are pre-existing gaps docketed rather than fixed in this phase.
	//
	// AND THE RED TWINS CONSTRUCT THE VIOLATION IN THE KIT (supervisor's requirement): an edge type
	// outside the declared allow list, and a root extra property no allowance names — rather than
	// merely flipping a registry flag, so each gate is observed catching the thing it exists for.
	shapedConjunct({
		conjunctId: 'p4LiveInKit',
		title: "P4 declared (as pesc260805) with the seven-name edgeTypeAllowList and a native DECLARES edge → the edge SHIPS with type DECLARES (ADMITTED, not translated), allowListedEdgeCount EQUALS 1, activeAllowanceList ['P4']",
		twinNameList: ['kitIgnoresEdgeTypeAllowList'],
		shape: (scenario) => { asStandard(scenario, 'pesc260805'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'P4', edgeTypeAllowList: PESC_EDGE_TYPE_ALLOW_LIST }]; withWalkExtra(scenario, addAllowListedEdge); },
		judge: succeeded((result) => { const admitted = result.edges.find((oneEdge) => oneEdge.type === 'DECLARES' && oneEdge.fromRef.id === 'toy:class/Person' && oneEdge.toRef.id === 'toy:class/School'); return { pass: admitted !== undefined && result.stats.allowListedEdgeCount === 1 && result.complianceReport.activeAllowanceList.join(',') === 'P4', detail: `admitted edge ${admitted ? 'present as DECLARES' : 'ABSENT'}; allowListedEdgeCount ${result.stats.allowListedEdgeCount}; report ${JSON.stringify(result.complianceReport)}` }; }),
	}),
	shapedConjunct({
		conjunctId: 'p4CountsAllowListedEdges',
		title: 'P4 declared with TWO allow-listed edges → allowListedEdgeCount EQUALS 2 and allowListedEdgeCountByType names each type (an admission that ships unrecorded is the silent-default class, which is why the counter exists at all)',
		twinNameList: ['kitDoesNotCountAllowListedEdges'],
		shape: (scenario) => { asStandard(scenario, 'pesc260805'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'P4', edgeTypeAllowList: PESC_EDGE_TYPE_ALLOW_LIST }]; withWalkExtra(scenario, ({ kit }) => { addAllowListedEdge({ kit }); kit.addEdge({ edgeType: 'RESOLVES_TO', fromStableId: 'toy:class/School', toStableId: 'toy:class/Person', edgeContext: 'second allow-listed edge' }); }); },
		judge: succeeded((result) => { const byType = result.stats.allowListedEdgeCountByType || {}; return { pass: result.stats.allowListedEdgeCount === 2 && byType.DECLARES === 1 && byType.RESOLVES_TO === 1, detail: `allowListedEdgeCount ${result.stats.allowListedEdgeCount}; byType ${JSON.stringify(byType)}` }; }),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'p4UnlistedEdgeTypeRefused',
		title: "P4 declared, and the walk emits an edge type the list does NOT name → refused by name. THE VIOLATION IS BUILT IN THE KIT, not by flipping a registry flag: the allow list is what makes the gate mean something, and a list that admitted anything would be indistinguishable from no gate",
		shape: (scenario) => { asStandard(scenario, 'pesc260805'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'P4', edgeTypeAllowList: PESC_EDGE_TYPE_ALLOW_LIST }]; withWalkExtra(scenario, ({ kit }) => kit.addEdge({ edgeType: 'BOGUS_EDGE', fromStableId: 'toy:class/Person', toStableId: 'toy:class/School', edgeContext: 'an edge type outside the declared allow list' })); },
		regex: /edge type 'BOGUS_EDGE' is not a member of EDGE_TYPES/,
		twinName: 'kitIgnoresEdgeTypeAllowListRefusal', fileName: KIT_FILE,
		find: '\t\t\t} else if (edgeTypeAllowList.indexOf(edgeType) !== -1) {', replace: '\t\t\t} else if (true) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'p4DeclaredButUnneededRefused',
		title: "P4 declared with NO allow-listed edge emitted on this build → refused 'allowance P4 active but its condition is not met' (contract-graph step, reading the counter the same way S6 reads substitutionCount)",
		shape: (scenario) => { asStandard(scenario, 'pesc260805'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'P4', edgeTypeAllowList: PESC_EDGE_TYPE_ALLOW_LIST }]; },
		regex: /buildContractGraph: .*allowance P4 active but its condition is not met/,
		twinName: 'disableDeclaredButUnneededCheckForP4', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (!oneRow.preconditionMet(context)) {', replace: '\t\t\t\tif (!oneRow.preconditionMet(context) && false) {',
	}),
	shapedConjunct({
		conjunctId: 'p5LiveInRoot',
		title: "P5 declared (as pesc260805) naming pescTier, and describeRoot returning extraProperties { pescTier: 'meta' } → the ROOT carries pescTier 'meta', activeAllowanceList ['P5']. The registry's FIRST offline-precondition row, and the only one whose data the framework reads at ROOT BUILD rather than at either evaluation step",
		twinNameList: ['rootNodeIgnoresExtraPropertyAllowance'],
		shape: (scenario) => { asStandard(scenario, 'pesc260805'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'P5', rootExtraPropertyNameList: ['pescTier'], probeEvidence: { probeName: 'gCompatFixture', probeDate: '2026-08-29', probeResult: 'the fixture root carries pescTier' } }]; withDescribeRoot(scenario, (described) => ({ ...described, extraProperties: { pescTier: 'meta' } })); },
		judge: succeeded((result) => { const rootNode = result.nodes.find((oneNode) => oneNode.properties.role === 'DmeStandardRoot'); return { pass: rootNode !== undefined && rootNode.properties.pescTier === 'meta' && result.complianceReport.activeAllowanceList.join(',') === 'P5', detail: `root pescTier ${JSON.stringify(rootNode && rootNode.properties.pescTier)}; report ${JSON.stringify(result.complianceReport)}` }; }),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'p5UndeclaredExtraRefused',
		title: "describeRoot returns a root extra property with NO allowance naming it → refused by name. THE VIOLATION IS BUILT AT THE SEAM, not by flipping a flag: this is the direction rootNode.js already enforces, and it is what makes P5 a licence rather than a decoration",
		shape: (scenario) => { asStandard(scenario, 'pesc260805'); scenario.forgeDeclaration.compatibilityDeclarationList = []; withDescribeRoot(scenario, (described) => ({ ...described, extraProperties: { pescTier: 'meta' } })); },
		regex: /extraProperties carries 'pescTier' and no active allowance names it/,
		twinName: 'rootNodeAdmitsUnlicensedExtra', fileName: ROOT_NODE_FILE,
		find: '\tif (unlicensedExtraName !== undefined) {', replace: '\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'p9DeclarableByPescOnly',
		title: "P9 declared by SIF → refused: 'declarable only by pesc260805'. P9 and S2 share rowRefId 'emptyStringCoercion' so the SWEEP treats them as one behaviour, but the IDS stay per-forge so each retires its own in its own commit (D12) — this conjunct is what keeps those two facts from collapsing into each other",
		shape: (scenario) => { asStandard(scenario, 'sif'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'P9', coerceEmptyStringPropertyList: ['description'] }]; },
		regex: /allowanceId 'P9' is declarable only by pesc260805, not by 'sif'/,
		twinName: 'declarableByCheckDisabledForP9', fileName: DECLARATION_CONTRACT_FILE,
		find: '\t\t\tif (registryRow.declarableBy.indexOf(forgeDeclaration.standardKey) === -1) {', replace: '\t\t\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'p16DeclarableByPescOnly',
		title: "P16 declared by SIF -> refused: 'declarable only by pesc260805'. ⟪versionFromStamp, 2026-09-01⟫ VEHICLE SWAPPED P17 -> P16. THE INVARIANT IS UNCHANGED: per-forge declarableBy keying is enforced even for rows that SHARE a rowRefId. P17's family (versionDisagreement, with S3) was RETIRED this phase, so the shared-behaviour vehicle is now P16 in the sourceUrlEmptyString family (E6/S4/P16) - the same shape against a family that still exists",
		shape: (scenario) => { asStandard(scenario, 'sif'); scenario.forgeDeclaration.compatibilityDeclarationList = [{ allowanceId: 'P16' }]; },
		regex: /allowanceId 'P16' is declarable only by pesc260805, not by 'sif'/,
		twinName: 'declarableByCheckDisabledForP16', fileName: DECLARATION_CONTRACT_FILE,
		find: '\t\t\tif (registryRow.declarableBy.indexOf(forgeDeclaration.standardKey) === -1) {', replace: '\t\t\tif (false) {',
	}),
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

// ---- the PESC rows' twins. Each mutates the PRODUCTION module whose behaviour the conjunct
// claims, so a green conjunct cannot be green because nothing was checked.
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'p4LiveInKit', twinName: 'kitIgnoresEdgeTypeAllowList', fileName: KIT_FILE, find: '\t\t\t} else if (edgeTypeAllowList.indexOf(edgeType) !== -1) {', replace: '\t\t\t} else if (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'p4CountsAllowListedEdges', twinName: 'kitDoesNotCountAllowListedEdges', fileName: KIT_FILE, find: '\t\t\t\tstats.allowListedEdgeCount += 1;', replace: '\t\t\t\tstats.allowListedEdgeCount += 0;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'p5LiveInRoot', twinName: 'rootNodeIgnoresExtraPropertyAllowance', fileName: ROOT_NODE_FILE, find: '\t\t...extraProperties,', replace: '' });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the compatibility-declaration mechanism', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), staticExtraSourceList: (scenario.staticExtraSourceList || []).slice(), migratedDeclarationOverrideByStandardKey: scenario.migratedDeclarationOverrideByStandardKey }), expectedConjunctCount: 24, expectedTwinCount: 24 }, () => harness.report());
