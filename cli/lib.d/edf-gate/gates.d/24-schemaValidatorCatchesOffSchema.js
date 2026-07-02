'use strict';

const path = require('path');

// Phase-7 standing TWIN gate — proves the schema-validator (gate 23, the existence enforcement) actually
// BITES. It feeds the validator a deliberately OFF-SCHEMA block whose elements each violate one rule class,
// plus one fully-conformant control element, and asserts: the control yields ZERO violations AND every
// off-schema element is flagged. If the validator ever silently passed off-schema content, gate 23 would be
// a no-op enforcement; this twin guarantees it is not. Pure (no graph, no forge-store) — deterministic.

const CORE_LIB = path.join(__dirname, '..', '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib');
const vocabulary = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const validatorFactory = require(path.join(CORE_LIB, 'schema-validator', 'schema-validator'));

// a fully-conformant HubReference node (the control) — PG-JSON array-wrapped scalar properties.
const conformantHubReference = () => ({
	ref: { source: 'twin', id: 'ctrl-ref' },
	labels: ['ForgedNode', 'HubReference'],
	stableId: 'twin:ctrl-ref',
	properties: {
		_id: ['twin:ctrl-ref'],
		canonicalKey: ['P000001'],
		hubVersion: ['14.0.0.0'],
		referenceTier: ['property'],
		addressSignature: ['deadbeef'],
	},
});

module.exports = () => ({
	name: 'schemaValidator.catchesOffSchemaBlock',
	phase: 'Phase7',
	kind: 'twin',
	expectFail: false, // the TWIN itself must PASS (it asserts the validator catches the off-schema block)
	run: (ctx, callback) => {
		const validator = validatorFactory({ vocabulary });

		// one valid control + one deliberate violation per rule class.
		const control = conformantHubReference();

		const nodeMissingForgedLabel = {
			ref: { source: 'twin', id: 'n1' },
			labels: ['HubReference'], // N1: missing :ForgedNode
			stableId: 'twin:n1',
			properties: { canonicalKey: ['x'], hubVersion: ['1'], referenceTier: ['property'], addressSignature: ['s'] },
		};
		const nodeMissingStableId = {
			ref: { source: 'twin', id: 'n2' },
			labels: ['ForgedNode', 'HubDefinition'],
			// N2: no stableId; N4: also missing HubDefinition required props
			properties: { hubName: ['CEDS'] },
		};
		const hubRefMissingRequired = {
			ref: { source: 'twin', id: 'n3' },
			labels: ['ForgedNode', 'HubReference'],
			stableId: 'twin:n3',
			properties: { canonicalKey: ['x'], hubVersion: ['1'], referenceTier: ['property'] }, // N3: no addressSignature
		};
		const nodeBadJustification = {
			ref: { source: 'twin', id: 'n4' },
			labels: ['ForgedNode'],
			stableId: 'twin:n4',
			properties: { mappingJustification: ['semapv:NotARealJustification'] }, // N5: bad SSSOM enum
		};

		const edgeMissingTier = {
			type: 'EXACT_MATCH',
			fromRef: { source: 'twin', id: 'a' },
			toRef: { source: 'twin', id: 'b' },
			properties: {}, // E2: missing provenanceTier
		};
		const edgeBadTier = {
			type: 'EXACT_MATCH',
			fromRef: { source: 'twin', id: 'c' },
			toRef: { source: 'twin', id: 'd' },
			properties: { provenanceTier: ['__not_a_tier__'] }, // E2: bad enum
		};
		const edgeBadPredicate = {
			type: 'CLOSE_MATCH',
			fromRef: { source: 'twin', id: 'e' },
			toRef: { source: 'twin', id: 'f' },
			properties: { provenanceTier: ['structural'], predicate: ['notAPredicate'] }, // E3: bad SKOS enum
		};
		// base content node (DME) missing a universal required block prop (searchText) -> N6.
		const baseNodeMissingProp = {
			ref: { source: 'twin', id: 'b1' },
			labels: ['ForgedNode', 'DmeProperty'],
			stableId: 'twin:b1',
			properties: { name: ['x'], role: ['DmeProperty'] }, // N6: missing searchText
		};
		// base content node missing ref identity (the _id/_source provenance) -> N7.
		const baseNodeMissingRef = {
			ref: { source: '', id: '' },
			labels: ['ForgedNode', 'DmeClass'],
			stableId: 'twin:b2',
			properties: { name: ['y'], role: ['DmeClass'], searchText: ['y'] }, // N7: empty ref
		};
		// standard-root node missing a STANDARD_ROOT prop -> N8.
		const rootMissingProp = {
			ref: { source: 'twin', id: 'r1' },
			labels: ['ForgedNode', 'DmeStandardRoot'],
			stableId: 'twin:r1',
			properties: { name: ['R'], role: ['DmeStandardRoot'], searchText: ['R'], standardKey: ['K'] }, // N8: missing standardName/version/...
		};
		// edge with a malformed relationship type -> E1.
		const edgeBadType = {
			type: '1-not-an-identifier',
			fromRef: { source: 'twin', id: 'g' },
			toRef: { source: 'twin', id: 'h' },
			properties: { provenanceTier: ['structural'] },
		};

		// 1) control alone -> zero violations.
		const controlResult = validator.validateBlock({ nodes: [control], edges: [] });

		// 2) the off-schema block -> each violation class flagged.
		const offSchema = validator.validateBlock({
			nodes: [control, nodeMissingForgedLabel, nodeMissingStableId, hubRefMissingRequired, nodeBadJustification, baseNodeMissingProp, baseNodeMissingRef, rootMissingProp],
			edges: [edgeMissingTier, edgeBadTier, edgeBadPredicate, edgeBadType],
		});
		const codes = new Set(offSchema.violations.map((oneV) => oneV.code));
		const expectedCodes = [
			'N1_missingForgedNodeLabel',
			'N2_missingStableId',
			'N3_hubReferenceMissingRequired',
			'N4_hubDefinitionMissingRequired',
			'N5_badEnum',
			'N6_baseNodeMissingRequired',
			'N7_missingRefIdentity',
			'N8_standardRootMissingRequired',
			'E1_invalidEdgeType',
			'E2_missingProvenanceTier',
			'E2_badProvenanceTier',
			'E3_badEnum',
		];
		const missingCodes = expectedCodes.filter((oneCode) => !codes.has(oneCode));

		const passed = controlResult.ok && offSchema.violations.length > 0 && missingCodes.length === 0;
		callback('', {
			passed,
			detail: `control violations=${controlResult.violations.length} (REQUIRED 0); off-schema violations=${offSchema.violations.length} across codes [${[...codes].sort().join(',')}]; missing expected codes=[${missingCodes.join(',')}] (REQUIRED none) — proves the validator bites`,
		});
	},
});
