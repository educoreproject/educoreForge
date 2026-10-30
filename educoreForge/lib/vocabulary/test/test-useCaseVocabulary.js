#!/usr/bin/env node
'use strict';

// test-useCaseVocabulary.js — G-UCVOCAB (useCaseForge-102926 Phase V, 2026-10-29): the vocabulary the use-case forge (forges/usecase) needs,
// landed ONE commit before any producer uses it. Pure: the registry, the search-text builder and the coverage finisher's residue, no graph.
//   (a) every USE_CASE_ROLE_LIST role is a DME_ROLES member with a dmeRole definition, and the list names exactly the ten roles
//   (b) every use-case edge type is an EDGE_TYPES member with an edgeType definition that says more than its name
//   (c) every EMBEDDABLE use-case role has a search-text segment builder (a non-empty searchText from its element)
//   (d) the one non-embeddable role, DmeExternalReference, has NO builder: buildSearchText throws naming it (its forge declares it non-embeddable)
//   (e) a label on the Uc stem (UcFoo) is producer-local: the coverage finisher's residue is empty
//   (f) the graph contract carries useCaseScopeRule: standardKind useCaseCorpus and the ten roles
//   (g) every use-case role has a root-ownership edge (HAS_USE_CASE for a case, DECLARES_SHARED_NODE for the rest)
// RED TWINS, each observed in memory (module doubles): (c) the DmeUseCase segment builder removed → the named throw; (e) the Uc stem removed
// from graph-contract → UcFoo in the residue; (f) the rule dropped from the contract; (g) a role's root-ownership row removed.
//
// Run: node lib/vocabulary/test/test-useCaseVocabulary.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-UCVOCAB: the use-case roles, edges, search-text builders, label stem and contract rule
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all conjuncts PASS and every twin was observed RED;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const moduleDouble = require('../../forge-framework/test/testSupport/moduleDouble');

const VOCABULARY_DIR = path.join(__dirname, '..');
const VOCABULARY_PATH = path.join(VOCABULARY_DIR, 'vocabulary.js');
const GRAPH_CONTRACT_PATH = path.join(VOCABULARY_DIR, 'graph-contract.js');
const SEARCH_TEXT_PATH = path.join(VOCABULARY_DIR, '..', 'search-text', 'build-search-text.js');
const COVERAGE_FINISHER_PATH = path.join(VOCABULARY_DIR, '..', '..', 'apps', 'graph-builder', 'apps', 'replay-manager', 'lib', 'finishing', 'lib', 'schema-view-coverage-finisher.js');

const loadFor = (modulePath, mutationList) => (mutationList.length === 0 ? require(modulePath) : moduleDouble.loadWithMutations({ modulePath, mutationList }));

const USE_CASE_ROLE_NAME_LIST = ['DmeUseCase', 'DmeUserStory', 'DmeActor', 'DmeCondition', 'DmeEvent', 'DmeValueDriver', 'DmeSubject', 'DmeDataReference', 'DmeExternalReference', 'DmeResource'];
const NON_EMBEDDABLE_USE_CASE_ROLE_NAME_LIST = ['DmeExternalReference'];
const USE_CASE_EDGE_TYPE_NAME_LIST = [
	'HAS_USE_CASE', 'DECLARES_SHARED_NODE', 'HAS_PRIMARY_ACTOR', 'HAS_ACTOR', 'HAS_INTERESTED_PARTY', 'HAS_STEP', 'INVOKES', 'PERFORMED_BY', 'ACTS_ON',
	'ALIGNS_WITH', 'SERVES', 'TRIGGERED_BY', 'ASSUMES', 'GUARANTEES', 'HAS_SUBJECT', 'HAS_CONSTITUENT', 'COMPRISES', 'GOVERNS', 'CONSUMES', 'PRODUCES',
	'REQUIRES', 'REQUIRES_STANDARD', 'REQUIRES_ORPHAN', 'REQUIRES_ARTIFACT', 'HAS_RESOURCE', 'CHILD', 'PARENT', 'SIBLING', 'DUPLICATE', 'EXTENDS',
	'INCLUDES', 'SEEDED_FROM',
];
// one sample element per embeddable role: the fields the walk hands the builder
const SAMPLE_ELEMENT_BY_ROLE = {
	DmeUseCase: { standardName: 'UseCase', shortName: 'LER Issuance', name: "Issue a Learning and Employment Record to a Holder's Digital Wallet" },
	DmeUserStory: { standardName: 'UseCase', actorName: 'Issuer', name: 'signs the credential' },
	DmeActor: { standardName: 'UseCase', name: 'Issuer' },
	DmeCondition: { standardName: 'UseCase', name: 'The Holder has a wallet.' },
	DmeEvent: { standardName: 'UseCase', name: 'A credential is earned' },
	DmeValueDriver: { standardName: 'UseCase', name: 'Learner data portability' },
	DmeSubject: { standardName: 'UseCase', name: 'Learning and Employment Record' },
	DmeDataReference: { standardName: 'UseCase', referenceKind: 'intermediate', name: 'Holder Identity Verification Result' },
	DmeResource: { standardName: 'UseCase', name: 'Source issue #2' },
};

const conjunctJudgeByRefId = {
	a_rolesDeclaredAndDefined: (mutationList) => {
		const vocabulary = loadFor(VOCABULARY_PATH, mutationList);
		const roleValueList = Object.values(vocabulary.DME_ROLES);
		const faultList = USE_CASE_ROLE_NAME_LIST.filter((oneRole) => roleValueList.indexOf(oneRole) === -1 || typeof vocabulary.TERM_DEFINITIONS.dmeRole[oneRole] !== 'string');
		const listMatches = JSON.stringify(vocabulary.USE_CASE_ROLE_LIST) === JSON.stringify(USE_CASE_ROLE_NAME_LIST);
		return { pass: faultList.length === 0 && listMatches, detail: faultList.length ? `undeclared or undefined: ${faultList.join(', ')}` : `USE_CASE_ROLE_LIST ${JSON.stringify(vocabulary.USE_CASE_ROLE_LIST)}` };
	},
	b_edgesDeclaredAndDefined: (mutationList) => {
		const vocabulary = loadFor(VOCABULARY_PATH, mutationList);
		const faultList = USE_CASE_EDGE_TYPE_NAME_LIST.filter((oneType) => vocabulary.EDGE_TYPES[oneType] !== oneType || typeof vocabulary.TERM_DEFINITIONS.edgeType[oneType] !== 'string' || vocabulary.TERM_DEFINITIONS.edgeType[oneType].trim().length <= oneType.length + 20);
		return { pass: faultList.length === 0, detail: faultList.length ? `undeclared or undefined: ${faultList.join(', ')}` : `${USE_CASE_EDGE_TYPE_NAME_LIST.length} edge types declared and defined` };
	},
	c_embeddableRolesHaveBuilders: (mutationList) => {
		const { buildSearchText } = loadFor(SEARCH_TEXT_PATH, mutationList)();
		const faultList = Object.keys(SAMPLE_ELEMENT_BY_ROLE).map((oneRole) => {
			let searchText = '';
			let thrownText = '';
			try {
				searchText = buildSearchText({ role: oneRole, ...SAMPLE_ELEMENT_BY_ROLE[oneRole] });
			} catch (builderError) {
				thrownText = builderError.message;
			}
			return { oneRole, searchText, thrownText };
		}).filter((oneResult) => oneResult.thrownText !== '' || oneResult.searchText.indexOf(SAMPLE_ELEMENT_BY_ROLE[oneResult.oneRole].name) === -1);
		return { pass: faultList.length === 0, detail: faultList.length ? faultList.map((oneFault) => `${oneFault.oneRole}: ${oneFault.thrownText || oneFault.searchText}`).join('; ') : 'every embeddable use-case role builds a searchText carrying its name' };
	},
	d_nonEmbeddableRoleHasNoBuilder: (mutationList) => {
		const { buildSearchText } = loadFor(SEARCH_TEXT_PATH, mutationList)();
		const faultList = NON_EMBEDDABLE_USE_CASE_ROLE_NAME_LIST.filter((oneRole) => {
			let thrownText = '';
			try {
				buildSearchText({ role: oneRole, standardName: 'UseCase', name: 'Credential Award' });
			} catch (builderError) {
				thrownText = builderError.message;
			}
			return !(/unknown or missing role/.test(thrownText) && thrownText.indexOf(`role=${oneRole}`) !== -1);
		});
		return { pass: faultList.length === 0, detail: faultList.length ? `built a searchText for ${faultList.join(', ')}` : 'DmeExternalReference throws by name' };
	},
	e_ucStemIsProducerLocal: (mutationList) => {
		const vocabulary = loadFor(VOCABULARY_PATH, mutationList);
		const residue = require(COVERAGE_FINISHER_PATH)({ vocabulary }).residueFor({ labelList: ['UcFoo', 'UcUseCase'], relationshipTypeList: [], memberValueList: [] });
		return { pass: residue.length === 0, detail: residue.length ? `residue ${JSON.stringify(residue)}` : 'UcFoo and UcUseCase are producer-local' };
	},
	f_contractCarriesUseCaseScopeRule: (mutationList) => {
		const graphContract = loadFor(GRAPH_CONTRACT_PATH, mutationList);
		const contractObject = JSON.parse(graphContract.canonicalJsonText());
		const scopeRule = contractObject.useCaseScopeRule;
		return {
			pass: scopeRule !== undefined && scopeRule.standardKind === 'useCaseCorpus' && JSON.stringify(scopeRule.useCaseRoleList) === JSON.stringify(USE_CASE_ROLE_NAME_LIST),
			detail: scopeRule === undefined ? 'no useCaseScopeRule in the contract' : `useCaseScopeRule ${JSON.stringify(scopeRule).slice(0, 160)}`,
		};
	},
	g_rootOwnershipRows: (mutationList) => {
		const vocabulary = loadFor(VOCABULARY_PATH, mutationList);
		const faultList = USE_CASE_ROLE_NAME_LIST.filter((oneRole) => {
			let edgeType = '';
			try {
				edgeType = vocabulary.rootOwnershipEdgeTypeFor(oneRole);
			} catch (rowError) {
				edgeType = '';
			}
			return edgeType !== (oneRole === 'DmeUseCase' ? 'HAS_USE_CASE' : 'DECLARES_SHARED_NODE');
		});
		return { pass: faultList.length === 0, detail: faultList.length ? `no or wrong row: ${faultList.join(', ')}` : 'every use-case role has its root-ownership row' };
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_rolesDeclaredAndDefined', twinName: 'roleRowRemoved', modulePath: VOCABULARY_PATH, find: "\tVALUE_DRIVER: 'DmeValueDriver',\n", replace: '' },
	{ conjunctRefId: 'b_edgesDeclaredAndDefined', twinName: 'edgeRowRemoved', modulePath: VOCABULARY_PATH, find: "\tSEEDED_FROM: 'SEEDED_FROM',\n", replace: '' },
	{ conjunctRefId: 'c_embeddableRolesHaveBuilders', twinName: 'useCaseBuilderRemoved', modulePath: SEARCH_TEXT_PATH, find: '\t\t\t[DME_ROLES.USE_CASE]: ({ name, shortName, standardName }) => [standardName, shortName, name],\n', replace: '' },
	{ conjunctRefId: 'd_nonEmbeddableRoleHasNoBuilder', twinName: 'externalReferenceBuilderAdded', modulePath: SEARCH_TEXT_PATH, find: '\t\t\t[DME_ROLES.RESOURCE]: ({ name, standardName }) => [standardName, name],\n', replace: '\t\t\t[DME_ROLES.RESOURCE]: ({ name, standardName }) => [standardName, name],\n\t\t\t[DME_ROLES.EXTERNAL_REFERENCE]: ({ name, standardName }) => [standardName, name],\n' },
	{ conjunctRefId: 'e_ucStemIsProducerLocal', twinName: 'ucStemRemoved', modulePath: GRAPH_CONTRACT_PATH, find: '|Oneroster|Medbiq|Uc)[A-Z]', replace: '|Oneroster|Medbiq)[A-Z]' },
	{ conjunctRefId: 'f_contractCarriesUseCaseScopeRule', twinName: 'scopeRuleDropped', modulePath: GRAPH_CONTRACT_PATH, find: '\t\tuseCaseScopeRule: useCaseScopeRule(),\n', replace: '' },
	{ conjunctRefId: 'g_rootOwnershipRows', twinName: 'ownershipRowRemoved', modulePath: VOCABULARY_PATH, find: '\t[DME_ROLES.EVENT]: EDGE_TYPES.DECLARES_SHARED_NODE,\n', replace: '' },
];

harness.section('BASELINE — the real registry, builder, finisher and contract pass every conjunct');
Object.keys(conjunctJudgeByRefId).forEach((oneRefId) => {
	const verdict = conjunctJudgeByRefId[oneRefId]([]);
	harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail);
});
harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a module double (in memory)');
harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), Object.keys(conjunctJudgeByRefId).sort().join(','));
TWIN_LIST.forEach((oneTwin) => {
	moduleDouble.assertMutationApplies({ modulePath: oneTwin.modulePath, find: oneTwin.find });
	// build-search-text.js opens with a shebang line, which the in-memory compile cannot take: a twin on it drops that line too
	const shebangMutationList = oneTwin.modulePath === SEARCH_TEXT_PATH ? [{ modulePath: SEARCH_TEXT_PATH, find: '#!/usr/bin/env node\n', replace: '' }] : [];
	const mutationList = shebangMutationList.concat([{ modulePath: oneTwin.modulePath, find: oneTwin.find, replace: oneTwin.replace }]);
	// a graph-contract twin reaches (e) through vocabulary.js, which requires graph-contract relatively and re-exports its stem list
	const verdict = conjunctJudgeByRefId[oneTwin.conjunctRefId](mutationList);
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
});
harness.report();
