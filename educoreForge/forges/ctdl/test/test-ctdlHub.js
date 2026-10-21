#!/usr/bin/env node
'use strict';

// test-ctdlHub.js — ctdlHub-101926 P4: the CTDL HUB role on lib/hub-framework (hubCtdl.js + lib/ctdlHubDeclaration.js +
// lib/ctdlHubHooks.js). PURE: forges the real CTDL snapshot in process (no graph, no embedding) and derives the hub through
// the same factory the forger loads.
//
// EVERY EXPECTED COUNT IS DERIVED FROM THE BASE BY THIS SUITE, never typed in, so the suite tests the hub against the
// base rather than against a number someone once saw:
//   term      one per native class, property, scheme and concept (the hub's term tier; a term card needs only an IRI)
//   property  one per (class domain, property): every DmeClass with a HAS_PROPERTY edge to the property (domainAddressing
//             hasPropertyEdges); a property whose only HAS_PROPERTY is from the root is skipped zeroDeclaredDomains
//   value     per (class domain, property, scheme it targets, concept in that scheme) — one per (concept, scheme) by
//             SCARLET_ARROW's step-0 ruling; no concept is in two schemes today (measured)
//   HAS_TERM_REFERENCE  one per property card
//
// CONJUNCTS
//   a  I12: hubName equals the forge declaration's standardSource ('CTDL'); I8: the hub namespace occurs exactly once in
//      production code, in forges/ctdl/parserDescriptor.ini
//   b  the declaration is admitted by the hub declaration contract; the hooks are {}
//   c  the tier counts and the skip report, exactly as derived from the base
//   d  every card passes the field table under the hub's own scope (zero refusals)
//   f  ⟪step 6⟫ the CTDL round trip over a graph holding the base AND its hub stays clean (invented 0, lost 0): the hub layer
//      (HubReference, HubDefinition and the edges touching them) is ours, not CTDL's, and the reader is scoped by role to
//      exclude it — the same layer ruling CEDS's round-trip compiler states (SPEC-hubKitRole §4.6)
//   e  spot cards: term cards for ceterms:Credential, ceterms:name and accommodation:AccessibleHousing; the property card
//      (ceterms:Credential, ceterms:name) carries rangeDatatypeList ['rdf:langString'] and its HAS_TERM_REFERENCE lands on
//      the ceterms:name term card; exactly one HubDefinition, hubName 'CTDL'
// RED TWINS (each a changed COPY of the derived hub): a conjunct whose twin is not observed red fails the suite.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- ctdlHub P4: the CTDL hub derived from the real CTDL base, every count derived from that base

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const SOURCE_FILE_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01', 'ctdl-schema.json');
const forgeCtdl = require('../forgeCtdl')({ embedder: null });
const hubFactory = require('../hubCtdl');
const hubDeclaration = require('../lib/ctdlHubDeclaration');
const ctdlHubHooks = require('../lib/ctdlHubHooks')();
const forgeDeclaration = require('../lib/ctdlForgeDeclaration');
const { validateHubDeclaration } = require(path.join(TREE_ROOT, 'lib', 'hub-framework', 'hubDeclarationContract'));
const { HUB_CARD_FIELD_TABLE, cardFieldRefusal } = require(path.join(TREE_ROOT, 'lib', 'hub-framework', 'hubCardFieldTable'));
const { HUB_TERM_REFERENCE_EDGE_TYPE } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const roundTripHarness = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
const validator = require('../roundTripValidator');
const SNAPSHOT_DIR_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const HUB_NAMESPACE = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'forger', 'forger')).resolveBundle({ standard: 'ctdl' }).hubNamespace;

const cardsOfTier = (hub, referenceTier) => hub.nodes.filter((oneNode) => oneNode.properties.referenceTier === referenceTier);

// the counts the base implies, derived here from its nodes and edges alone
const expectedCountsOf = (base) => {
	const nodeById = base.nodes.reduce((byId, oneNode) => Object.assign(byId, { [oneNode.stableId]: oneNode }), {});
	const memberSetOf = (edgeType, fromRole) => base.edges
		.filter((oneEdge) => oneEdge.type === edgeType && (fromRole === undefined || nodeById[oneEdge.fromRef.id].role === fromRole))
		.reduce((byOwner, oneEdge) => {
			const ownerRefId = edgeType === 'HAS_PROPERTY' ? oneEdge.toRef.id : oneEdge.fromRef.id;
			const memberRefId = edgeType === 'HAS_PROPERTY' ? oneEdge.fromRef.id : oneEdge.toRef.id;
			return Object.assign(byOwner, { [ownerRefId]: new Set([...(byOwner[ownerRefId] || []), memberRefId]) });
		}, {});
	const classDomainSetByProperty = memberSetOf('HAS_PROPERTY', 'DmeClass');
	const schemeSetByProperty = memberSetOf('HAS_OPTION_SET', 'DmeProperty');
	const conceptSetByScheme = memberSetOf('HAS_VALUE');
	const propertyRefIdList = base.nodes.filter((oneNode) => oneNode.role === 'DmeProperty').map((oneNode) => oneNode.stableId);
	const domainCountOf = (propertyRefId) => (classDomainSetByProperty[propertyRefId] || new Set()).size;
	return {
		termTier: base.nodes.filter((oneNode) => ['DmeClass', 'DmeProperty', 'DmeOptionSet', 'DmeOptionValue'].indexOf(oneNode.role) !== -1).length,
		propertyTier: propertyRefIdList.reduce((total, propertyRefId) => total + domainCountOf(propertyRefId), 0),
		valueTier: propertyRefIdList.reduce((total, propertyRefId) => total + domainCountOf(propertyRefId)
			* [...(schemeSetByProperty[propertyRefId] || [])].reduce((schemeTotal, schemeRefId) => schemeTotal + (conceptSetByScheme[schemeRefId] || new Set()).size, 0), 0),
		skipRow: propertyRefIdList.filter((propertyRefId) => domainCountOf(propertyRefId) === 0).length,
	};
};

// I8: every production file under forges/, lib/, apps/ (tests, fixtures and node_modules excluded) that names the namespace
const namespaceOccurrenceList = () => {
	const run = spawnSync('grep', ['-rl', '--exclude-dir=node_modules', '--exclude-dir=test', '--exclude-dir=fixtures', HUB_NAMESPACE, 'forges', 'lib', 'apps'], { cwd: TREE_ROOT, encoding: 'utf8' });
	return String(run.stdout || '').trim().split('\n').filter(Boolean);
};

const judgeByConjunct = {
	a_identityInvariants: () => {
		const occurrenceList = namespaceOccurrenceList();
		return {
			pass: hubDeclaration.hubName === forgeDeclaration.standardSource && hubDeclaration.hubName === 'CTDL' && HUB_NAMESPACE === 'https://w3id.org/EDUcore/CTDL/hub/'
				&& JSON.stringify(occurrenceList) === JSON.stringify(['forges/ctdl/parserDescriptor.ini']),
			detail: `hubName '${hubDeclaration.hubName}' vs standardSource '${forgeDeclaration.standardSource}'; namespace '${HUB_NAMESPACE}' found in [${occurrenceList.join(', ')}]`,
		};
	},
	b_declarationAdmittedHooksEmpty: () => {
		const refusal = validateHubDeclaration({ hubDeclaration });
		return { pass: refusal === null && JSON.stringify(ctdlHubHooks) === '{}', detail: `contract: ${refusal === null ? 'admitted' : refusal}; hooks ${JSON.stringify(ctdlHubHooks)}` };
	},
	c_countsDerivedFromTheBase: ({ hub, expected }) => {
		const measured = {
			termTier: cardsOfTier(hub, 'term').length,
			propertyTier: cardsOfTier(hub, 'property').length,
			valueTier: cardsOfTier(hub, 'value').length,
			skipRow: hub.skipReport.filter((oneRow) => oneRow.reason === 'zeroDeclaredDomains').length,
		};
		const termReferenceCount = hub.edges.filter((oneEdge) => oneEdge.type === HUB_TERM_REFERENCE_EDGE_TYPE).length;
		return {
			pass: JSON.stringify(measured) === JSON.stringify(expected) && hub.skipReport.length === expected.skipRow && termReferenceCount === measured.propertyTier,
			detail: `measured ${JSON.stringify(measured)}; derived from the base ${JSON.stringify(expected)}; HAS_TERM_REFERENCE ${termReferenceCount}; skip rows ${hub.skipReport.length}`,
		};
	},
	d_everyCardPassesTheFieldTable: ({ hub }) => {
		const refusalList = hub.nodes
			.filter((oneNode) => oneNode.role === 'HubReference')
			.map((oneCard) => cardFieldRefusal({ fieldTable: HUB_CARD_FIELD_TABLE, referenceTier: oneCard.properties.referenceTier, cardPropertyNameList: Object.keys(oneCard.properties), tierList: hubDeclaration.tierList, rangeAddressing: hubDeclaration.rangeAddressing }))
			.filter((refusalText) => refusalText !== '');
		return { pass: refusalList.length === 0, detail: `${refusalList.length} refusal(s)${refusalList.length ? `: ${refusalList.slice(0, 3).join(' | ')}` : ''}` };
	},
	e_spotCards: ({ hub }) => {
		const termCardOf = (termIri) => cardsOfTier(hub, 'term').find((oneCard) => oneCard.properties.termIri === termIri);
		const nameOnCredential = cardsOfTier(hub, 'property').find((oneCard) => oneCard.properties.propertyKey === 'ceterms:name' && oneCard.properties.domainId === 'ceterms:Credential');
		const termReference = nameOnCredential && hub.edges.find((oneEdge) => oneEdge.type === HUB_TERM_REFERENCE_EDGE_TYPE && oneEdge.fromRef.id === nameOnCredential.stableId);
		const hubDefinitionList = hub.nodes.filter((oneNode) => oneNode.role === 'HubDefinition');
		const faultList = [
			...['ceterms:Credential', 'ceterms:name', 'accommodation:AccessibleHousing'].filter((termIri) => termCardOf(termIri) === undefined).map((termIri) => `no term card for ${termIri}`),
			...(nameOnCredential === undefined ? ['no property card (ceterms:Credential, ceterms:name)'] : []),
			...(nameOnCredential !== undefined && JSON.stringify([].concat(nameOnCredential.properties.rangeDatatypeList)) !== JSON.stringify(['rdf:langString']) ? [`rangeDatatypeList ${JSON.stringify(nameOnCredential.properties.rangeDatatypeList)}`] : []),
			...(nameOnCredential !== undefined && (termReference === undefined || termReference.toRef.id !== (termCardOf('ceterms:name') || {}).stableId) ? ['HAS_TERM_REFERENCE does not land on the ceterms:name term card'] : []),
			...(hubDefinitionList.length !== 1 || hubDefinitionList[0].properties.hubName !== 'CTDL' ? [`HubDefinition count ${hubDefinitionList.length}`] : []),
		];
		return { pass: faultList.length === 0, detail: faultList.join('; ') || 'all spot cards present and as declared' };
	},
};

const deriveHub = (base, callback) => {
	const rootNode = base.nodes.find((oneNode) => oneNode.role === 'DmeStandardRoot');
	hubFactory({ hubVersion: [].concat(rootNode.properties.version)[0], hubNamespace: HUB_NAMESPACE }).forgeHub({ nodes: base.nodes, edges: base.edges }, callback);
};

forgeCtdl.forge({ sourcePath: SOURCE_FILE_PATH, skipEmbedding: true }, (forgeError, base) => {
	harness.accepts('the real CTDL snapshot forges', forgeError ? [forgeError] : []);
	if (forgeError) {
		harness.report();
		return;
	}
	deriveHub(base, (hubError, hub) => {
		harness.accepts('the CTDL hub derives with no refusal', hubError ? [hubError] : []);
		if (hubError) {
			harness.report();
			return;
		}
		const expected = expectedCountsOf(base);
		harness.note(`DERIVED FROM THE BASE: ${JSON.stringify(expected)}; HUB COUNTS ${JSON.stringify(hub.counts)}`);
		const shippedSubject = () => ({ hub, expected });

		harness.section('BASELINE — every conjunct');
		Object.keys(judgeByConjunct).forEach((conjunctRefId) => {
			const verdict = judgeByConjunct[conjunctRefId](shippedSubject());
			harness.ok(`${conjunctRefId} PASS`, verdict.pass, verdict.detail);
		});

		const withHub = (hubChange) => () => ({ ...shippedSubject(), hub: hubChange(JSON.parse(JSON.stringify(hub))) });
		const TWIN_LIST = [
			{ conjunctRefId: 'c_countsDerivedFromTheBase', twinName: 'oneValueCardDropped', subject: withHub((changed) => ({ ...changed, nodes: changed.nodes.filter((oneNode, nodeIndex) => nodeIndex !== changed.nodes.findIndex((candidate) => candidate.properties.referenceTier === 'value')) })) },
			{ conjunctRefId: 'd_everyCardPassesTheFieldTable', twinName: 'strayDomainOnATermCard', subject: withHub((changed) => {
				changed.nodes.find((oneNode) => oneNode.properties.referenceTier === 'term').properties.domainId = 'ceterms:Credential';
				return changed;
			}) },
			{ conjunctRefId: 'e_spotCards', twinName: 'nameDatatypeDropped', subject: withHub((changed) => {
				changed.nodes.find((oneNode) => oneNode.properties.propertyKey === 'ceterms:name' && oneNode.properties.domainId === 'ceterms:Credential').properties.rangeDatatypeList = [];
				return changed;
			}) },
		];
		harness.section('THE TWIN SWEEP — each derived-hub conjunct OBSERVED RED under a changed copy');
		TWIN_LIST.forEach((oneTwin) => {
			const verdict = judgeByConjunct[oneTwin.conjunctRefId](oneTwin.subject());
			harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
		});
		harness.section('f — the round trip over base + hub (step 6)');
		const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ctdlHubRoundTrip-'));
		const baseAndHub = { nodes: base.nodes.concat(hub.nodes), edges: base.edges.concat(hub.edges) };
		validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult: baseAndHub }), snapshotPath: SNAPSHOT_DIR_PATH, outputPath }, (validateError, verdict) => {
			harness.accepts('f: the validator runs over base + hub', validateError ? [validateError] : []);
			harness.ok('f: invented 0, lost 0, roundTripClean over base + hub', Boolean(verdict) && verdict.inventedTotal === 0 && verdict.lostTotal === 0 && verdict.roundTripClean === true, verdict && `invented ${verdict.inventedTotal} lost ${verdict.lostTotal} clean ${verdict.roundTripClean}`);
			fs.rmSync(outputPath, { recursive: true, force: true });
			harness.report();
		});
	});
});
