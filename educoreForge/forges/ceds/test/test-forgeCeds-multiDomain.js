#!/usr/bin/env node
'use strict';

// test-forgeCeds-multiDomain.js — the P4 ⟪P0-finding⟫ ACCEPTANCE GATE (bridgeEvidenceRefactor-spec.md
// §7 P4). Proves the forgeCeds.js:306 multi-domain fix is ADDITIVE ONLY, per design-authority ruling:
//
//   ADDRESS SLOT UNCHANGED — every DmeProperty's `domainId` (the address slot feeding
//   addressSlots.domainId, addressSignature, and the HAS_PROPERTY ownership edge) is BYTE-IDENTICAL
//   to what it was before this fix: the FIRST resolvable schema:domainIncludes reference, and nothing
//   else. This suite proves it by re-deriving domainId the OLD way (first-resolvable only) and
//   comparing against the forge's own output for every one of the 2324 live properties.
//
//   ADDITIVE — every DmeProperty now ALSO carries `allDomainIds`/`allDomainNames`: the FULL resolvable
//   domain list (P0 §2.4: 256 of 2324 properties, 11%, are genuinely multi-domain in the source RDF).
//   allDomainIds[0] === domainId always (same source array, same resolution, same order). A property
//   with only one resolvable domain still carries allDomainIds (length 1) — the hub module (P4's OTHER
//   half, lib.d/cedsHubModule.js) treats presence, not count, as the domainsComplete:true signal.
//
// Runs the REAL forge over the REAL local CEDS-Ontology.rdf asset (skipEmbedding:true — no network, no
// Voyage, no Docker) — the SAME fixture test-hubReferenceCountDerived.js already uses; this is the
// forge's own unit fixture the P4 work order asks for, not a synthetic one.
//
// Run: node forges/ceds/test/test-forgeCeds-multiDomain.js

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- P4 acceptance gate: forgeCeds.js's multi-domain fix is additive-only

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Forges the REAL CEDS-Ontology.rdf asset (skipEmbedding:true) and proves: (1) every DmeProperty's
     domainId address slot is byte-identical to the pre-fix first-resolvable-only derivation; (2)
     allDomainIds/allDomainNames are additive, present on every property with >=1 resolvable domain,
     with allDomainIds[0] always equal to domainId; (3) a real population of genuinely multi-domain
     properties exists and is counted correctly.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

// embedder EXPLICITLY null (framework contract, forge-framework.js:87-90): the bundle is now
// built at factory time and REFUSES an undefined embedder by name — "silence is not consent
// to spend". This suite forges with skipEmbedding true, so null is the honest statement of
// what it always meant; the pre-migration `{}` relied on the bespoke module never reading the
// value. Behaviour of this suite is unchanged.
const forgeCeds = require('../forgeCeds')({ embedder: null });
const normalize = require('../lib/normalize');
const { parseCeds } = require('../lib/parser');

const CEDS_SOURCE_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');

// single-element PG-JSON array -> scalar (forgeCeds emits scalars for non-list address fields).
const v1 = (arrayOrScalar) => (Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar);

parseCeds({ sourcePath: CEDS_SOURCE_PATH }, (parseErr, parsed) => {
	if (parseErr) {
		harness.ok('CEDS source parsed (LOCAL asset, no network)', false, String(parseErr));
		harness.report();
		return;
	}

	const { classes, properties } = parsed.entities;
	const classByUri = {};
	classes.forEach((cls) => {
		classByUri[cls.uri] = cls;
	});

	// the OLD derivation, reproduced independently here (not by requiring forgeCeds's own internals) —
	// exactly the pre-fix forgeCeds.js:306 line, first-resolvable-only.
	const oldDomainSlotIdFor = (prop) => {
		const owningClassUri = (prop.domainRefs || []).find((u) => classByUri[u]);
		if (!owningClassUri) {
			return undefined;
		}
		const resolved = normalize.normalizeCedsId({ rawValue: classByUri[owningClassUri].cedsId, kind: 'class' });
		return resolved.error ? undefined : resolved.cedsId;
	};

	// the count of genuinely multi-domain properties in the SOURCE (independent of the forge's own
	// output) — the same distribution P0-cedsTupleModel.md §2.4 cites (256 of 2324, 11%).
	const sourceMultiDomainCount = properties.filter(
		(prop) => (prop.domainRefs || []).filter((u) => classByUri[u]).length > 1,
	).length;

	forgeCeds.forge({ sourcePath: CEDS_SOURCE_PATH, skipEmbedding: true }, (forgeError, base) => {
		if (forgeError) {
			harness.ok('CEDS forge succeeded (LOCAL asset, no embedding)', false, String(forgeError));
			harness.report();
			return;
		}

		const propertyNodes = base.nodes.filter((oneNode) => oneNode.role === 'DmeProperty');

		// =====================================================================
		harness.section('SOURCE — a real, non-trivial multi-domain population exists');
		// =====================================================================
		harness.equal(
			'the source carries 256 genuinely multi-domain properties (P0 §2.4\'s own cited figure)',
			sourceMultiDomainCount,
			256,
		);
		harness.ok('at least one multi-domain property exists to test against', sourceMultiDomainCount > 0);

		// =====================================================================
		harness.section('ADDRESS SLOT UNCHANGED — domainId is BYTE-IDENTICAL to the pre-fix derivation');
		// =====================================================================
		let domainIdMismatches = 0;
		let propertiesWithDomainId = 0;
		properties.forEach((prop) => {
			const forgedNode = propertyNodes.find((oneNode) => oneNode.properties.uri === prop.uri);
			if (!forgedNode) {
				return; // a property that did not forge a node is out of THIS gate's scope
			}
			const expectedOld = oldDomainSlotIdFor(prop);
			const actual = v1(forgedNode.properties.domainId);
			if (expectedOld !== undefined) {
				propertiesWithDomainId += 1;
			}
			if (expectedOld !== actual) {
				domainIdMismatches += 1;
			}
		});
		harness.equal(
			'every property\'s domainId matches the OLD first-resolvable-only derivation, exactly (0 mismatches)',
			domainIdMismatches,
			0,
		);
		harness.ok('a non-trivial number of properties carry domainId', propertiesWithDomainId > 2000, `count=${propertiesWithDomainId}`);

		// =====================================================================
		harness.section('ADDITIVE — allDomainIds carries the FULL list; allDomainIds[0] === domainId always');
		// =====================================================================
		let multiDomainNodesFound = 0;
		let allDomainIdsFirstMismatches = 0;
		let missingAllDomainIdsWhereDomainIdPresent = 0;
		propertyNodes.forEach((oneNode) => {
			const domainId = v1(oneNode.properties.domainId);
			const allDomainIds = oneNode.properties.allDomainIds;
			if (domainId !== undefined && domainId !== null) {
				if (allDomainIds === undefined) {
					missingAllDomainIdsWhereDomainIdPresent += 1;
					return;
				}
				const asArray = Array.isArray(allDomainIds) ? allDomainIds : [allDomainIds];
				if (asArray[0] !== domainId) {
					allDomainIdsFirstMismatches += 1;
				}
				if (asArray.length > 1) {
					multiDomainNodesFound += 1;
				}
			}
		});
		harness.equal(
			'every DmeProperty with a domainId ALSO carries allDomainIds (additive, never dropped)',
			missingAllDomainIdsWhereDomainIdPresent,
			0,
		);
		harness.equal('allDomainIds[0] === domainId for EVERY property (address slot is the authoritative first entry)', allDomainIdsFirstMismatches, 0);
		harness.equal(
			'the forged multi-domain node count matches the source-derived count (256)',
			multiDomainNodesFound,
			sourceMultiDomainCount,
		);

		// =====================================================================
		harness.section('WORKED EXAMPLE — a real multi-domain property, allDomainNames zipped positionally');
		// =====================================================================
		const exampleSourceProp = properties.find(
			(prop) => (prop.domainRefs || []).filter((u) => classByUri[u]).length > 1,
		);
		const exampleNode = propertyNodes.find((oneNode) => oneNode.properties.uri === exampleSourceProp.uri);
		harness.ok('a real multi-domain example resolved to a forged node', !!exampleNode);
		const exampleAllDomainIds = Array.isArray(exampleNode.properties.allDomainIds)
			? exampleNode.properties.allDomainIds
			: [exampleNode.properties.allDomainIds];
		const exampleAllDomainNames = Array.isArray(exampleNode.properties.allDomainNames)
			? exampleNode.properties.allDomainNames
			: [exampleNode.properties.allDomainNames];
		harness.ok('the example carries >1 domain id', exampleAllDomainIds.length > 1, `got ${JSON.stringify(exampleAllDomainIds)}`);
		harness.equal('allDomainNames has the SAME length as allDomainIds (zipped positionally)', exampleAllDomainNames.length, exampleAllDomainIds.length);

		harness.report();
	});
});
