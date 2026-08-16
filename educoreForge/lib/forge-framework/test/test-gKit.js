#!/usr/bin/env node
'use strict';

// test-gKit.js — G-KIT and G-REFERENT (SPEC-forgeFramework-v1.md §10.1; §3.4; §6.2 step 4; Profile
// 11.3 5(d)): the kit is the ONLY door for creation and every mint-time and post-mutation refusal is
// by name; a null/absent name mints NO name property and is COUNTED (never ''); a parentId must name a
// MEMBER stableId. Twins DISABLE the specific check (productionMutation) so the fault passes → red;
// the nameless-count conjunct's twin makes the kit coerce '' without an allowance → count 0 → red.
//
// Run: node lib/forge-framework/test/test-gKit.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-KIT + G-REFERENT: the kit's refusals by name; nameless nodes counted; parentId names a member

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { refusalCase, shapedConjunct, frameworkMutationTwin, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const { DME_ROLES, EDGE_TYPES } = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));

const KIT_GATE_ID = 'G-KIT';
const REFERENT_GATE_ID = 'G-REFERENT';
const twinRegistry = makeTwinRegistry();
const KIT_FILE = 'contractGraphKit.js';
const FRAMEWORK_FILE = 'forge-framework.js';

// withWalkExtra — the toy walk plus one extra kit call (or a post-mint write) BEFORE the return
const withWalkExtra = (scenario, extra) => {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.emitContractGraph = (context) => {
		const walkResult = baseHooks.emitContractGraph(context);
		const extraResult = extra(context, walkResult);
		return extraResult === undefined ? walkResult : extraResult;
	};
};
const mintClass = (kit, stableId, extraArgs = {}) =>
	kit.makeNode({ role: DME_ROLES.CLASS, perStandardLabel: 'ToyClass', stableId, name: 'Extra', structural: { parentId: kit.rootStableId, path: 'Extra' }, origin: 'test:extra', ...extraArgs });

const kitConjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'duplicateStableId',
		title: 'a duplicate stableId is refused naming BOTH origins',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Person'); }),
		regex: /duplicate stableId 'toy:class\/Person' — first minted from classes\[0\], minted again from test:extra/,
		twinName: 'disableDuplicateCheck', fileName: KIT_FILE,
		find: '\t\tif (originByStableId[stableId] !== undefined) {', replace: '\t\tif (originByStableId[stableId] !== undefined && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'uncleanStableIdPattern',
		title: 'a stableId failing the REAL predicate (no toy: prefix) is refused, never repaired',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'class-Extra'); }),
		regex: /unclean stableId 'class-Extra' under stableIdPattern/,
		twinName: 'disableCleanStableIdCheck', fileName: KIT_FILE,
		find: '\t\tif (!isCleanStableId({ stableId })) {', replace: '\t\tif (!isCleanStableId({ stableId }) && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'uncleanStableIdTrim',
		title: 'a stableId with trailing whitespace is refused under the trimmed conjunct',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra '); }),
		regex: /unclean stableId 'toy:class\/Extra ' under stableIdPattern/,
		twinName: 'disableTrimConjunct', fileName: KIT_FILE,
		find: '\t\t(!stableIdPattern.trimmed || stableId === stableId.trim()) &&', replace: '\t\ttrue &&',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'bareStringEdgeType',
		title: 'an edge type outside EDGE_TYPES (bare string) is refused naming the registry',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { kit.addEdge({ edgeType: 'OWNS', fromStableId: kit.rootStableId, toStableId: 'toy:class/Person', edgeContext: 'test' }); }),
		regex: /edge type 'OWNS' is not a member of EDGE_TYPES/,
		twinName: 'disableEdgeTypeCheck', fileName: KIT_FILE,
		find: '\t\t\t} else if (edgeTypeAllowList.indexOf(edgeType) === -1) {', replace: '\t\t\t} else if (false && edgeTypeAllowList.indexOf(edgeType) === -1) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'retiredMappingEdgeType',
		title: 'a retired *_MAPPING edge type is refused, always',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { kit.addEdge({ edgeType: 'SPECIFIED_MAPPING', fromStableId: kit.rootStableId, toStableId: 'toy:class/Person', edgeContext: 'test' }); }),
		regex: /'SPECIFIED_MAPPING' is a RETIRED \*_MAPPING edge type/,
		twinName: 'disableRetiredMappingCheck', fileName: KIT_FILE,
		find: '\t\tif (RETIRED_MAPPING_EDGE_TYPE_LIST.indexOf(edgeType) !== -1) {', replace: '\t\tif (RETIRED_MAPPING_EDGE_TYPE_LIST.indexOf(edgeType) !== -1 && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'crossSourceEndpoint',
		title: 'a hand-made edge with a foreign source in the walk return is refused (a cross-standard edge cannot be expressed)',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }, walkResult) => ({ ...walkResult, edges: walkResult.edges.concat([{ type: 'REFERENCES', fromRef: { source: 'Toy', id: 'toy:class/Person' }, toRef: { source: 'CEDS', id: 'https://ceds.ed.gov/element/000001' }, properties: { provenanceTier: 'structural' } }]) })),
		regex: /returned an edge at index \d+ the kit did not mint/,
		twinName: 'disableEdgeOriginCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (!mintedEdgeSet.has(oneEdge)) {', replace: '\t\t\t\t\tif (!mintedEdgeSet.has(oneEdge) && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'danglingFalsyEndpoint',
		title: 'a falsy endpoint is RECORDED and refused once at the end naming the count and the first offender',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: 'toy:class/Person', toStableId: undefined, edgeContext: 'Person->nothing' }); }),
		regex: /1 edge\(s\) had an unresolved endpoint \(first: \{"edgeType":"REFERENCES","fromStableId":"toy:class\/Person","edgeContext":"Person->nothing"\}\)/,
		twinName: 'disableDanglingRefusal', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (danglingCount > 0) {', replace: '\t\t\t\tif (danglingCount > 0 && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'danglingUnresolvedEndpoint',
		title: 'an endpoint naming a stableId that is never minted is refused at the end (count + first offender)',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { kit.addEdge({ edgeType: EDGE_TYPES.REFERENCES, fromStableId: 'toy:class/Person', toStableId: 'toy:class/Ghost', edgeContext: 'Person->Ghost' }); }),
		regex: /1 edge\(s\) had an unresolved endpoint \(first: \{"edgeType":"REFERENCES","fromStableId":"toy:class\/Person","toStableId":"toy:class\/Ghost"\}\)/,
		twinName: 'disableDanglingRefusal', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tif (danglingCount > 0) {', replace: '\t\t\t\tif (danglingCount > 0 && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'carriedCollidesUniversal',
		title: 'a carriedProperties name colliding with a universal name (searchText) is refused',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra', { carriedProperties: { searchText: 'smuggled' } }); }),
		regex: /carriedProperties name 'searchText' collides with a universal property/,
		twinName: 'disableCollisionCheck', fileName: KIT_FILE,
		find: '\t\t\tif (collidingName !== undefined) {', replace: '\t\t\tif (collidingName !== undefined && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'callerSuppliedIdCarried',
		title: "'_id' supplied in carriedProperties is refused (the FRAMEWORK stamps _id)",
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra', { carriedProperties: { _id: 'toy:x' } }); }),
		regex: /'_id' supplied by the caller in carriedProperties/,
		twinName: 'disableCarriedIdCheck', fileName: KIT_FILE,
		find: '\t\t\tif (carriedPropertiesArg._id !== undefined) {', replace: '\t\t\tif (carriedPropertiesArg._id !== undefined && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'callerSuppliedIdPreceding',
		title: "'_id' supplied in precedingProperties is refused",
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra', { precedingProperties: { _id: 'toy:x' } }); }),
		regex: /'_id' supplied by the caller in precedingProperties/,
		twinName: 'disablePrecedingIdCheck', fileName: KIT_FILE,
		find: '\t\tif (precedingProperties !== undefined && precedingProperties._id !== undefined) {', replace: '\t\tif (false && precedingProperties !== undefined && precedingProperties._id !== undefined) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'unknownRole',
		title: 'an unknown role is refused naming DME_ROLES',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra', { role: 'DmeGadget' }); }),
		regex: /makeNode: unknown role 'DmeGadget'/,
		twinName: 'disableRoleCheck', fileName: KIT_FILE,
		find: '\t\tif (DME_ROLE_VALUE_LIST.indexOf(role) === -1) {\n\t\t\tthrow refuse.byName({ moduleName, what: `makeNode: unknown role', replace: '\t\tif (DME_ROLE_VALUE_LIST.indexOf(role) === -1 && false) {\n\t\t\tthrow refuse.byName({ moduleName, what: `makeNode: unknown role',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'perStandardLabelNotString',
		title: 'a non-string perStandardLabel is refused',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra', { perStandardLabel: 42 }); }),
		regex: /perStandardLabel is 42, not a string/,
		twinName: 'disableLabelCheck', fileName: KIT_FILE,
		find: "\t\tif (typeof perStandardLabel !== 'string' || perStandardLabel.length === 0) {", replace: "\t\tif (false && (typeof perStandardLabel !== 'string' || perStandardLabel.length === 0)) {",
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'emptySearchText',
		title: 'an element that composes to an EMPTY searchText is refused at mint (build-search-text names the element)',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra', { name: '', searchTextElement: { role: DME_ROLES.CLASS, name: '', standardName: '', owningName: '' } }); }),
		regex: /cannot build a non-empty searchText/,
		twinName: 'swallowSearchTextThrow', fileName: KIT_FILE,
		find: '\t\t\tsearchTextProperty = { searchText: buildSearchText(element) };', replace: "\t\t\tlet composedSearchText = ''; try { composedSearchText = buildSearchText(element); } catch (ignoredError) { composedSearchText = ''; } searchTextProperty = { searchText: composedSearchText };",
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'nonStringName',
		title: 'a non-string name (a number) is refused — the framework never coerces',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra', { name: 42 }); }),
		regex: /name is a number on 'toy:class\/Extra'/,
		twinName: 'coerceNonStringName', fileName: KIT_FILE,
		find: "\t\t} else if (typeof name === 'string') {\n\t\t\tnameProperty = { name };\n\t\t} else {", replace: "\t\t} else if (typeof name === 'string') {\n\t\t\tnameProperty = { name };\n\t\t} else if (true) {\n\t\t\tnameProperty = { name: `${name}` };\n\t\t} else {",
	}),
	shapedConjunct({
		conjunctId: 'namelessNodeCounted',
		title: "a null name mints a node with NO name property (never '') and namelessNodeCountByRole EQUALS 1 for the role",
		twinNameList: ['coerceEmptyStringWithoutAllowance'],
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Nameless', { name: null, searchTextElement: { role: DME_ROLES.CLASS, name: 'Nameless-fallthrough', standardName: 'Toy', owningName: 'Toy' } }); }),
		judge: succeeded((result) => {
			const namelessNode = result.nodes.find((oneNode) => oneNode.stableId === 'toy:class/Nameless');
			const hasNoNameProperty = namelessNode !== undefined && !Object.prototype.hasOwnProperty.call(namelessNode.properties, 'name');
			const countedOnce = result.complianceReport.namelessNodeCountByRole[DME_ROLES.CLASS] === 1;
			return { pass: hasNoNameProperty && countedOnce, detail: `name property ${namelessNode ? JSON.stringify(namelessNode.properties.name) : 'no node'}; namelessNodeCountByRole ${JSON.stringify(result.complianceReport.namelessNodeCountByRole)}` };
		}),
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'postMintIdWrite',
		title: "a POST-MINT write of properties._id is refused by the step-4 re-check",
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { const extraNode = mintClass(kit, 'toy:class/Extra'); extraNode.properties._id = 'x'; }),
		regex: /node 'toy:class\/Extra' carries _id "x" after the walk/,
		twinName: 'disableIdRecheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (props._id !== oneNode.stableId) {', replace: '\t\t\t\t\tif (props._id !== oneNode.stableId && false) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'postMintRoleWrite',
		title: 'a POST-MINT rewrite of role is refused by the re-check',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { const extraNode = mintClass(kit, 'toy:class/Extra'); extraNode.properties.role = 'DmeProperty'; }),
		regex: /node 'toy:class\/Extra' role is inconsistent after the walk/,
		twinName: 'disableRoleRecheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (DME_ROLE_VALUE_LIST.indexOf(oneNode.role) === -1 || props.role !== oneNode.role || oneNode.labels[2] !== oneNode.role) {', replace: '\t\t\t\t\tif (false && (DME_ROLE_VALUE_LIST.indexOf(oneNode.role) === -1 || props.role !== oneNode.role || oneNode.labels[2] !== oneNode.role)) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'postMintSearchTextEmptied',
		title: 'a POST-MINT emptied searchText is refused by the re-check',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { const extraNode = mintClass(kit, 'toy:class/Extra'); extraNode.properties.searchText = ''; }),
		regex: /node 'toy:class\/Extra' has an empty searchText after the walk/,
		twinName: 'disableSearchTextRecheck', fileName: FRAMEWORK_FILE,
		find: "\t\t\t\t\tif (isEmbeddable && (typeof props.searchText !== 'string' || props.searchText.length === 0)) {", replace: "\t\t\t\t\tif (false && isEmbeddable && (typeof props.searchText !== 'string' || props.searchText.length === 0)) {",
	}),
	refusalCase({
		registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'postMintEdgeTypeWrite',
		title: 'a POST-MINT rewrite of an edge type to a non-vocabulary name is refused by the re-check',
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { kit.edges[0].type = 'OWNS'; }),
		regex: /edge type 'OWNS' \(toy:root → toy:optionSet\/GenderCode\) is not an EDGE_TYPES member after the walk/,
		twinName: 'disableEdgeTypeRecheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (permittedEdgeTypeList.indexOf(oneEdge.type) === -1) {', replace: '\t\t\t\t\tif (permittedEdgeTypeList.indexOf(oneEdge.type) === -1 && false) {',
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: KIT_GATE_ID, conjunctId: 'namelessNodeCounted', twinName: 'coerceEmptyStringWithoutAllowance', fileName: KIT_FILE, find: "\t\t\tif (emptyStringCoercionPropertyList.indexOf('name') !== -1) {", replace: "\t\t\tif (true) {" });

const referentConjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: REFERENT_GATE_ID, conjunctId: 'parentIdNonMember',
		title: "a parentId naming a non-member is refused with the 'unresolvable' diagnostic (structural-contract.js:108-145)",
		shape: (scenario) => withWalkExtra(scenario, ({ kit }) => { mintClass(kit, 'toy:class/Extra', { structural: { parentId: 'toy:class/Ghost', path: 'Extra' } }); }),
		regex: /parentId 'toy:class\/Ghost' matches no member stableId \(unresolvable\)/,
		twinName: 'skipStructuralFinalizer', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\tstructuralContractLib.finalizeStructuralContract({ nodes, edges });', replace: '\t\t\t\t// finalizer skipped by twin',
	}),
	{
		conjunctId: 'wrongReferentDiagnosticExists',
		title: "the 'wrong referent' diagnostic (a parentId matching a member _id, not a stableId) is reachable through the framework's structural.classifyParentReferent — under the framework's own _id === stableId invariant a hook cannot produce it, so it is proved on the re-exported classifier",
		twinNameList: ['stubClassifier'],
		evaluate: (scenario, callback) => {
			const outcome = toyScenario.injectOnly(scenario);
			if (outcome.injectionError) {
				callback('', { pass: false, detail: outcome.injectionError });
				return;
			}
			const verdict = outcome.forgeFramework.structural.classifyParentReferent({ parentId: 'legacy:_id', memberByStableId: { 'toy:class/Person': {} }, memberByInternalId: { 'legacy:_id': {} } });
			callback('', { pass: verdict === 'wrongReferent', detail: `classifier said '${verdict}'` });
		},
	},
];
frameworkMutationTwin({ registry: twinRegistry, gateId: REFERENT_GATE_ID, conjunctId: 'wrongReferentDiagnosticExists', twinName: 'stubClassifier', fileName: FRAMEWORK_FILE, find: '\t\t\t\tclassifyParentReferent: structuralContractLib.classifyParentReferent,', replace: "\t\t\t\tclassifyParentReferent: () => 'stableId'," });

const gateDeclarationList = [
	{ gateId: KIT_GATE_ID, title: 'the kit — the only door for creation', conjunctList: kitConjunctList },
	{ gateId: REFERENT_GATE_ID, title: 'parentId names a MEMBER stableId', conjunctList: referentConjunctList },
];

runGateFamily(
	{ harness, familyName: 'G-KIT + G-REFERENT', gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 22, expectedTwinCount: 22 },
	() => harness.report(),
);
