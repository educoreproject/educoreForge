#!/usr/bin/env node
'use strict';

// test-ctdl-family-structure.js — the hermetic gate for the CTDL-family intra-family STRUCTURAL bridge
// (forges/ctdl/bridges/ctdlFamilyStructure.js) as the ONE COORDINATING PRODUCER that reads the whole family
// once and emits the THREE pair-scoped blocks in a single pass, its recipe.js validation, and its version
// -keyed block names. Proves, WITHOUT docker/Voyage/a database/an LLM (hermetic; the suite builds its OWN
// fixture inGraph):
//
//   A. ONE PASS, THREE BLOCKS — through bridgeMaker.run under a graphReader double (serves all THREE family
//      standards) and a graphWriter double (records writes): the plugin RESOLVES by name from
//      forges/ctdl/bridges/, passes the shape gate, reads the whole family ONCE, and returns blocks[] with
//      THREE pair-scoped entries (ctdl::ctdlasn, ctdl::ctdlqdata, ctdlasn::ctdlqdata — S11 order). Each
//      pairing's edges are CORRECTLY TYPED and DIRECTED via the SAME-URI identity join and written under that
//      pairing's OWN distinct applyLabel. The crux: an ceasn->cdqd crossRef is assigned to the ctdlasn::
//      ctdlqdata block IN THE SAME PASS — the cross-pair coordination the per-invocation shape bolted on.
//   B. R2-7 EMPTY PAIRING — a family that resolves ZERO cross-standard edges writes NOTHING and every block
//      reports emptyPairing:true.
//   C. §6 REFUSALS — a non-null hub, a missing config.familyStandards, a missing config.sourceStandard, a
//      source outside the family, and a family of fewer than two are each refused BY NAME.
//   D. RECIPE VALIDATION (recipe.js) — the ONE-entry CTDL family (source=ctdl, familyStandards=[three]) is
//      ACCEPTED; the existing single structural PAIR shape (pairWith) and mapping shape still validate; every
//      malformed family shape is REFUSED BY NAME (family+hub, family+pairWith, member not a standard, source
//      not a member, fewer than two members).
//   E. VERSION-KEYING — vocabulary composes each structural block name version-keyed on BOTH endpoints and
//      _struct-suffixed (ctdl@2_rel_ctdlasn@1_struct); the RELATIONSHIP kind gate accepts it.
//
// Run: node apps/graph-builder/apps/bridge-maker/test/test-ctdl-family-structure.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic gate for the CTDL-family coordinating structural bridge (producer + recipe + naming)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Drives the coordinating structural producer over a fixture inGraph (reader+writer doubles), asserts it
     emits three pair-scoped blocks in one pass, validates its recipe shape through recipe.js, and checks its
     version-keyed block names through the vocabulary. Pure and in-memory; no docker, no Voyage, no database.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

const bridgeMakerModule = require('../bridgeMaker');
const relationshipWriterFactory = require('../lib/relationshipWriter');
const producerFactory = require('../../../../../forges/ctdl/bridges/ctdlFamilyStructure');
const recipeLib = require('../../../lib/recipe')();
const vocabulary = require('../../../../../lib/vocabulary/vocabulary');

const APPLY_LABEL = 'BridgedRelation';
const INGRAPH = { graphName: 'DEV_familyProbe', boltUrl: 'bolt://x', password: 'x' };

// the three pair-scoped labels the coordinating producer derives from the BASE applyLabel (root-first S11).
const LABEL_CTDL_ASN = `${APPLY_LABEL}_CTDL_CTDLASN`;
const LABEL_CTDL_QDATA = `${APPLY_LABEL}_CTDL_CTDLQDATA`;
const LABEL_ASN_QDATA = `${APPLY_LABEL}_CTDLASN_CTDLQDATA`;

// the whole family — the pairing universe AND the read scope, read once.
const FAMILY_STANDARDS = ['ctdl', 'ctdlasn', 'ctdlqdata'];
const FAMILY_CONFIG = { sourceStandard: 'ctdl', familyStandards: FAMILY_STANDARDS };

// ---- fixture builders ---------------------------------------------------------------------------
// a forged node: SCALAR _source, uri===stableId (the identity), crossRefs as a JSON-array cell.
const node = (source, stableId, crossRefs) => ({
	stableId,
	properties: { _source: source, uri: stableId, crossRefs: JSON.stringify(crossRefs || []) },
});
const ctdlNode = (stableId, crossRefs) => node('CTDL', stableId, crossRefs);
const asnNode = (stableId, crossRefs) => node('CTDLASN', stableId, crossRefs);
// CTDL-QData's _source is the registry standardName EXACTLY — MIXED CASE 'CTDLQData', NOT 'CTDLQDATA'
// (forge-ctdlqdata STANDARD_SOURCE, 'no toLower anywhere'). This casing is LOAD-BEARING: the forge stamps
// it this way in the real graph, and the producer must read the family CASE-INSENSITIVELY to see these
// nodes. An earlier fixture used 'CTDLQDATA', which — with a double that keyed off the query string rather
// than a real property match — masked the shipped bug (both CTDL-QData pairings resolved ZERO edges). Do
// NOT "normalize" this back to all-caps; it is the regression anchor.
const qdataNode = (stableId, crossRefs) => node('CTDLQData', stableId, crossRefs);
// a family cross-standard crossRef (the shape the CTDL parser stamps: {system,id,raw,locator}). The producer
// resolves by `raw` against the identity universe, not by `system`, so `system` is cosmetic here.
const cr = (raw, locator) => ({ system: 'family', id: raw, raw, locator });

// the MAIN fixture — one crossRef of EACH locator across ALL THREE pairings, plus a dup, a dangler, an
// unknown locator, and an intra-standard ref (each exercising a distinct branch).
const mainCtdlNodes = [
	ctdlNode('ceterms:prop1', [cr('ceasn:classA', 'schema:domainIncludes')]), // HAS_PROPERTY  [ctdl::ctdlasn]
	ctdlNode('ceterms:prop2', [cr('cdqd:thing', 'schema:rangeIncludes'), cr('cdqd:thing', 'schema:rangeIncludes')]), // REFERENCES [ctdl::ctdlqdata] + a REPLAY (dedup)
	ctdlNode('ceterms:prop3', [cr('ceasn:schemeX', 'meta:targetScheme')]), // HAS_OPTION_SET [ctdl::ctdlasn]
	ctdlNode('ceterms:dangle', [cr('ceasn:MISSING', 'rdfs:subClassOf')]), // TRUE dangler (in NO family std) -> reported
	ctdlNode('ceterms:equiv', [cr('ceasn:classA', 'skos:exactMatch')]), // unknown locator -> skipped
	ctdlNode('ceterms:intra', [cr('ceterms:prop1', 'schema:rangeIncludes')]), // intra-standard -> counted
];
// THE CRUX — a CTDLASN node whose crossRef resolves into CTDLQData: the ctdlasn::ctdlqdata pairing, authored in
// the SAME pass. The per-invocation shape could not place this without a ctdlasn-sourced entry.
const mainAsnNodes = [
	asnNode('ceasn:classA'),
	asnNode('ceasn:schemeX'),
	asnNode('ceasn:classB', [cr('cdqd:scheme', 'rdfs:subClassOf')]), // SUBCLASS_OF [ctdlasn::ctdlqdata]
];
const mainQdataNodes = [qdataNode('cdqd:thing'), qdataNode('cdqd:scheme')];

// the EMPTY fixture — nothing resolves cross-standard (only a dangling ref and an intra-standard ref).
const emptyCtdlNodes = [
	ctdlNode('ceterms:a', [cr('ceasn:MISSING', 'rdfs:subClassOf')]),
	ctdlNode('ceterms:b', [cr('ceterms:a', 'schema:rangeIncludes')]),
];
const emptyAsnNodes = [asnNode('ceasn:other')];
const emptyQdataNodes = [qdataNode('cdqd:other')];

// a graphReader double that is FAITHFUL to neo4jGraphReader: it filters the whole family node set by EXACT
// scalar-property equality against propertyEquals (an empty filter returns EVERY node) — exactly the WHERE
// the real reader interpolates. The earlier double keyed off the query STRING ('if source===CTDLQDATA
// return qdataNodes'), so it returned the qdata bucket even for a case that the real DB WHERE would miss —
// masking the mixed-case _source bug. Emulating a real property match is what lets this hermetic suite
// catch it. A graphWriter double records writes.
const readerDoubleFor = (ctdlNodes, asnNodes, qdataNodes) => {
	const allNodes = [].concat(ctdlNodes || [], asnNodes || [], qdataNodes || []);
	return ({ inGraph }) => ({
		readNodes: ({ propertyEquals } = {}, callback) => {
			void inGraph;
			const equalsSpec = propertyEquals || {};
			const specKeys = Object.keys(equalsSpec);
			const nodes = allNodes.filter((oneNode) =>
				specKeys.every((oneKey) => (oneNode.properties || {})[oneKey] === equalsSpec[oneKey]),
			);
			return callback('', { nodes });
		},
		close: (callback) => callback(''),
	});
};
const recordingWriterDouble = (writes) => () => ({
	writeRelationshipEdge: (spec, callback) => {
		writes.push(spec);
		callback('', { edgeWritten: true });
	},
	close: (callback) => callback(''),
});

// runDirect — compose the producer over the doubles by hand (so the FULL result object is visible).
const runDirect = ({ ctdlNodes, asnNodes, qdataNodes, hub = null, config }, callback) => {
	const writes = [];
	const graphWriter = { writeRelationshipEdge: (spec, cb) => { writes.push(spec); cb('', { edgeWritten: true }); }, close: (cb) => cb('') };
	const relationshipWriter = relationshipWriterFactory({ graphWriter });
	const callable = producerFactory({
		graphReader: readerDoubleFor(ctdlNodes, asnNodes, qdataNodes || []),
		relationshipWriter,
		config: config === undefined ? FAMILY_CONFIG : config,
	});
	callable({ inGraph: INGRAPH, hub, applyLabel: APPLY_LABEL }, (err, result) => callback(err, result, writes));
};

// findWrite — the recorded write of a given relationshipType (there is at most one per type in the fixture).
const findWrite = (writes, relationshipType) => writes.filter((w) => w.relationshipType === relationshipType)[0];

// =====================================================================
// A — ONE PASS, THREE BLOCKS through bridgeMaker.run
// =====================================================================
const runMainThroughBridgeMaker = () => {
	harness.section('A — the coordinating producer emits THREE pair-scoped blocks in one pass');

	const writes = [];
	bridgeMakerModule({ graphWriterFactory: recordingWriterDouble(writes), graphReaderFactory: readerDoubleFor(mainCtdlNodes, mainAsnNodes, mainQdataNodes) }).run(
		{ inGraph: INGRAPH, bridge: 'ctdlFamilyStructure', source: 'ctdl', hub: null, applyLabel: APPLY_LABEL, config: FAMILY_CONFIG },
		(runErr, report) => {
			harness.ok(`the producer resolved by name and ran (${runErr || 'ok'})`, !runErr, runErr);
			harness.equal('4 structural edges written total (dedup collapsed the replayed REFERENCES)', report && report.edgesWritten, 4);
			harness.equal('4 writes reached the graphWriter', writes.length, 4);

			// THREE pair-scoped blocks, S11 order (root-first then lexicographic).
			const blocks = (report && report.blocks) || [];
			harness.equal('report carries THREE pair-scoped blocks', blocks.length, 3);
			harness.equal('  block[0] label is the ctdl::ctdlasn pair label', blocks[0] && blocks[0].applyLabel, LABEL_CTDL_ASN);
			harness.equal('  block[1] label is the ctdl::ctdlqdata pair label', blocks[1] && blocks[1].applyLabel, LABEL_CTDL_QDATA);
			harness.equal('  block[2] label is the ctdlasn::ctdlqdata pair label', blocks[2] && blocks[2].applyLabel, LABEL_ASN_QDATA);
			harness.equal('  block[0] endpoints are ctdl / ctdlasn (root-first)', `${blocks[0].firstStandard}::${blocks[0].secondStandard}`, 'ctdl::ctdlasn');
			harness.equal('  block[1] endpoints are ctdl / ctdlqdata', `${blocks[1].firstStandard}::${blocks[1].secondStandard}`, 'ctdl::ctdlqdata');
			harness.equal('  block[2] endpoints are ctdlasn / ctdlqdata', `${blocks[2].firstStandard}::${blocks[2].secondStandard}`, 'ctdlasn::ctdlqdata');
			harness.equal('  block[0] wrote 2 edges (HAS_PROPERTY + HAS_OPTION_SET)', blocks[0].edgesWritten, 2);
			harness.equal('  block[1] wrote 1 edge (REFERENCES, deduped)', blocks[1].edgesWritten, 1);
			harness.equal('  block[2] wrote 1 edge (SUBCLASS_OF — the cross-pair authored in one pass)', blocks[2].edgesWritten, 1);
			harness.ok('  every block declares producer:structural', blocks.every((b) => b.producer === 'structural'), JSON.stringify(blocks.map((b) => b.producer)));
			harness.ok('  no block is empty in the main fixture', blocks.every((b) => b.emptyPairing === false), JSON.stringify(blocks.map((b) => b.emptyPairing)));

			// TYPING + DIRECTION via LOCATOR_EDGE, and PER-PAIR LABEL on each write (the crux).
			const hasProp = findWrite(writes, 'HAS_PROPERTY');
			const hasOption = findWrite(writes, 'HAS_OPTION_SET');
			const references = findWrite(writes, 'REFERENCES');
			const subclass = findWrite(writes, 'SUBCLASS_OF');
			harness.equal('domainIncludes -> HAS_PROPERTY, targetToSource (classA -> prop1), label ctdl::ctdlasn', `${hasProp.fromStableId}->${hasProp.toStableId} @${hasProp.applyLabel}`, `ceasn:classA->ceterms:prop1 @${LABEL_CTDL_ASN}`);
			harness.equal('targetScheme -> HAS_OPTION_SET, sourceToTarget (prop3 -> schemeX), label ctdl::ctdlasn', `${hasOption.fromStableId}->${hasOption.toStableId} @${hasOption.applyLabel}`, `ceterms:prop3->ceasn:schemeX @${LABEL_CTDL_ASN}`);
			harness.equal('rangeIncludes -> REFERENCES, sourceToTarget (prop2 -> thing), label ctdl::ctdlqdata', `${references.fromStableId}->${references.toStableId} @${references.applyLabel}`, `ceterms:prop2->cdqd:thing @${LABEL_CTDL_QDATA}`);
			harness.equal('subClassOf -> SUBCLASS_OF, sourceToTarget (classB -> scheme), label ctdlasn::ctdlqdata', `${subclass.fromStableId}->${subclass.toStableId} @${subclass.applyLabel}`, `ceasn:classB->cdqd:scheme @${LABEL_ASN_QDATA}`);

			// PROVENANCE — every edge stamped the structural bridge stamps.
			harness.ok('every edge is provenanceTier structural / provenanceSource uriBridge / bridgeAuthored / owner :golden', writes.every((w) => w.properties && w.properties.provenanceTier === 'structural' && w.properties.provenanceSource === 'uriBridge' && w.properties.bridgeAuthored === true && w.properties.owner === ':golden'));
			harness.ok('every edge carries its crossRefLocator', writes.every((w) => typeof w.properties.crossRefLocator === 'string' && w.properties.crossRefLocator.length > 0));

			// REPORTING (aggregate counts, which bridgeMaker forwards).
			const counts = (report && report.counts) || {};
			harness.equal('aggregate counts.edges === 4', counts.edges, 4);
			harness.equal('one replayed edge was DEDUPED at emission (R2-2)', counts.dedupedAtEmission, 1);
			harness.equal('one intra-standard resolution counted, not emitted', counts.intraStandardCount, 1);
			harness.equal('ONLY the true dangler is reported unresolved', JSON.stringify((counts.unresolvedByStandard || {}).CTDL), JSON.stringify(['ceasn:MISSING']));
			harness.equal('the unknown (equivalence) locator is REPORTED, no edge (no SSSOM)', (counts.skippedUnknownLocator || {})['skos:exactMatch'], 1);
			harness.ok('no edge was authored for the unresolved ref', !writes.some((w) => `${w.toStableId}`.indexOf('MISSING') !== -1 || `${w.fromStableId}`.indexOf('MISSING') !== -1));

			runEmptyThroughBridgeMaker();
		},
	);
};

// =====================================================================
// B — R2-7 EMPTY PAIRINGS (every block empty, zero writes)
// =====================================================================
const runEmptyThroughBridgeMaker = () => {
	harness.section('B — an all-empty family emits NOTHING and every block reports it (R2-7)');
	const emptyWrites = [];
	bridgeMakerModule({ graphWriterFactory: recordingWriterDouble(emptyWrites), graphReaderFactory: readerDoubleFor(emptyCtdlNodes, emptyAsnNodes, emptyQdataNodes) }).run(
		{ inGraph: INGRAPH, bridge: 'ctdlFamilyStructure', source: 'ctdl', hub: null, applyLabel: APPLY_LABEL, config: FAMILY_CONFIG },
		(emptyErr, emptyReport) => {
			harness.ok(`the empty family ran without error (${emptyErr || 'ok'})`, !emptyErr, emptyErr);
			harness.equal('ZERO edges written', emptyReport && emptyReport.edgesWritten, 0);
			harness.equal('ZERO writes reached the graphWriter', emptyWrites.length, 0);
			const blocks = (emptyReport && emptyReport.blocks) || [];
			harness.equal('still THREE blocks (a pairing is a block even when empty)', blocks.length, 3);
			harness.ok('every block reports emptyPairing:true', blocks.every((b) => b.emptyPairing === true), JSON.stringify(blocks.map((b) => b.emptyPairing)));
			harness.ok('every block wrote 0 edges', blocks.every((b) => b.edgesWritten === 0));

			// the DIRECT call exposes the full result too (decisionBlock null — a deterministic identity join).
			runDirect({ ctdlNodes: emptyCtdlNodes, asnNodes: emptyAsnNodes, qdataNodes: emptyQdataNodes }, (directErr, directResult) => {
				harness.ok(`direct empty run ok (${directErr || 'ok'})`, !directErr, directErr);
				harness.equal('the deterministic identity join freezes nothing (decisionBlock null)', directResult && directResult.decisionBlock, null);
				harness.ok('its dangling ref is still REPORTED, not invented', !!((directResult.counts.unresolvedByStandard || {}).CTDL));
				runRefusals();
			});
		},
	);
};

// =====================================================================
// C — §6 refusals fire by name
// =====================================================================
const runRefusals = () => {
	harness.section('C — the producer declares producer:structural; §6 refusals by name');
	runDirect({ ctdlNodes: mainCtdlNodes, asnNodes: mainAsnNodes, qdataNodes: mainQdataNodes }, (err, result) => {
		harness.ok(`direct main run ok (${err || 'ok'})`, !err, err);
		harness.equal("the producer declares producer:'structural' (build.js suffixes each block _struct)", result && result.producer, 'structural');
		harness.equal('the aggregate reports 3 pairings', result && result.counts && result.counts.pairings, 3);

		// a non-null hub is refused BY NAME (a structural family bridge authors toward no hub).
		runDirect({ ctdlNodes: mainCtdlNodes, asnNodes: mainAsnNodes, qdataNodes: mainQdataNodes, hub: 'ceds' }, (hubErr) => {
			harness.match('a non-null hub is refused by name', hubErr, /STRUCTURAL family bridge/);

			// a missing config.familyStandards is refused BY NAME.
			runDirect({ ctdlNodes: mainCtdlNodes, asnNodes: mainAsnNodes, qdataNodes: mainQdataNodes, config: { sourceStandard: 'ctdl' } }, (famErr) => {
				harness.match('a missing config.familyStandards is refused by name', famErr, /config\.familyStandards is not an array/);

				// a missing config.sourceStandard is refused BY NAME.
				runDirect({ ctdlNodes: mainCtdlNodes, asnNodes: mainAsnNodes, qdataNodes: mainQdataNodes, config: { familyStandards: FAMILY_STANDARDS } }, (srcErr) => {
					harness.match('a missing config.sourceStandard is refused by name', srcErr, /config\.sourceStandard is not set/);

					// a source outside the family is refused BY NAME.
					runDirect({ ctdlNodes: mainCtdlNodes, asnNodes: mainAsnNodes, qdataNodes: mainQdataNodes, config: { sourceStandard: 'ceds', familyStandards: ['ctdl', 'ctdlasn'] } }, (outErr) => {
						harness.match('a source outside the family is refused by name', outErr, /is not among config\.familyStandards/);

						// a family of fewer than two DISTINCT standards is refused BY NAME.
						runDirect({ ctdlNodes: mainCtdlNodes, asnNodes: mainAsnNodes, qdataNodes: mainQdataNodes, config: { sourceStandard: 'ctdl', familyStandards: ['ctdl'] } }, (oneErr) => {
							harness.match('a one-member family is refused by name', oneErr, /at least two DISTINCT standards/);
							runRecipeValidation();
						});
					});
				});
			});
		});
	});
};

// =====================================================================
// D — recipe.js validation of the family entry (accept, and refuse malformed BY NAME)
// =====================================================================
const runRecipeValidation = () => {
	harness.section('D — recipe.js validates the ONE-entry CTDL family (both directions)');

	const familyForges = ['ctdl', 'ctdlasn', 'ctdlqdata', 'ceds'];
	const validateFully = (recipe) => recipeLib.validateRecipe(recipe, { contentValidation: true, availableForges: familyForges });
	const validateStructuralOnly = (recipe) => recipeLib.validateRecipe(recipe, {});

	const baseStandards = [
		{ token: 'ctdl', version: '1' },
		{ token: 'ctdlasn', version: '1' },
		{ token: 'ctdlqdata', version: '1' },
	];
	const familyBridge = (extra) =>
		Object.assign({ source: 'ctdl', bridge: 'ctdlFamilyStructure', familyStandards: ['ctdl', 'ctdlasn', 'ctdlqdata'], dependencies: ['ctdl', 'ctdlasn', 'ctdlqdata'], cacheMode: 'reuse' }, extra || {});
	const recipeWith = (bridges, extra) =>
		Object.assign({ schemaVersion: '1.0.0', recipeName: 'ctdlFamily', kind: 'dev', standards: baseStandards, hubs: [], bridges }, extra || {});

	// the CTDL family: ONE coordinating structural entry (source=ctdl, familyStandards=[three]).
	const familyRecipe = recipeWith([familyBridge()]);
	harness.accepts('the ONE-entry CTDL family recipe is structurally clean (Layer 1)', validateStructuralOnly(familyRecipe).layers.structural.errors);
	harness.accepts('ACCEPTS the ONE-entry CTDL family (source=ctdl, familyStandards=[three])', validateFully(familyRecipe).layers.referential.errors);

	// BACKWARD COMPAT — a single structural PAIR (pairWith) and a MAPPING (hub) shape STILL validate.
	const pairRecipe = recipeWith([{ source: 'ctdl', pairWith: 'ctdlasn', bridge: 'ctdlFamilyStructure', dependencies: ['ctdl', 'ctdlasn'], cacheMode: 'reuse' }]);
	harness.accepts('BACKWARD COMPAT — a single structural PAIR shape (pairWith) still validates', validateFully(pairRecipe).layers.referential.errors);
	const mappingRecipe = recipeWith(
		[{ source: 'ctdl', hub: 'ceds', bridge: 'semanticBridge', dependencies: ['ctdl', 'ceds'], cacheMode: 'reuse' }],
		{ standards: baseStandards.concat([{ token: 'ceds', version: '1' }]), hubs: [{ standard: 'ceds', candidateFinder: 'semanticDefText' }] },
	);
	harness.accepts('BACKWARD COMPAT — a mapping (hub) shape still validates', validateFully(mappingRecipe).layers.referential.errors);

	// malformed family shapes, each refused BY NAME.
	const familyPlusHub = recipeWith(
		[familyBridge({ hub: 'ceds' })],
		{ standards: baseStandards.concat([{ token: 'ceds', version: '1' }]), hubs: [{ standard: 'ceds', candidateFinder: 'semanticDefText' }] },
	);
	harness.rejects('REJECTS a family bridge that ALSO names a hub', validateFully(familyPlusHub).layers.referential.errors, /names BOTH a hub .* and familyStandards/);

	const familyPlusPairWith = recipeWith([familyBridge({ pairWith: 'ctdlasn' })]);
	harness.rejects('REJECTS a family bridge that ALSO names a pairWith', validateFully(familyPlusPairWith).layers.referential.errors, /names BOTH a pairWith .* and familyStandards/);

	const memberNotStandard = recipeWith([familyBridge({ familyStandards: ['ctdl', 'ctdlasn', 'notreal'] })]);
	harness.rejects('REJECTS a familyStandards member that is not in standards[]', validateFully(memberNotStandard).layers.referential.errors, /familyStandards 'notreal' is not in standards/);

	const sourceNotMember = recipeWith([familyBridge({ source: 'ctdlasn', familyStandards: ['ctdl', 'ctdlqdata'] })]);
	harness.rejects('REJECTS a family whose source is not one of its members', validateFully(sourceNotMember).layers.referential.errors, /familyStandards does not include the source/);

	// fewer than two members is a STRUCTURAL fault (schema minItems:2) — proven at Layer 1.
	const oneMember = recipeWith([familyBridge({ familyStandards: ['ctdl'] })]);
	harness.rejects('REJECTS a family of fewer than two members (Layer 1 minItems)', validateStructuralOnly(oneMember).layers.structural.errors, /familyStandards/);

	runCaseInsensitiveSourceRead();
};

// =====================================================================
// F — the mixed-case `_source` regression: the family read is case-INSENSITIVE
// =====================================================================
// forge-ctdlqdata stamps `_source` with the registry standardName EXACTLY — 'CTDLQData', mixed case. The
// shipped producer read `{ _source: token.toUpperCase() }` ('CTDLQDATA'), which the real neo4jGraphReader
// turns into `WHERE n._source = 'CTDLQDATA'` — matching ZERO rows in the graph, so every CTDL-QData node fell
// out of the family read and both CTDL-QData pairings resolved ZERO edges (the reported bug). This fixture
// pins a ctdl->cdqd REFERENCES crossRef on a qdata node whose `_source` is the REAL mixed case; the faithful
// reader double (exact property match, like the DB) means it resolves ONLY if the producer reads the family
// case-insensitively. Under the pre-fix literal-uppercase read this block is empty — the RED this guards.
const runCaseInsensitiveSourceRead = () => {
	harness.section('F — mixed-case _source (CTDLQData) is read case-insensitively (the shipped-bug regression)');
	const ctdlNodes = [ctdlNode('ceterms:refsQdata', [cr('cdqd:target', 'schema:rangeIncludes')])];
	const asnNodes = [];
	const qdataNodes = [qdataNode('cdqd:target')]; // _source === 'CTDLQData' (mixed case — the real forge form)

	runDirect({ ctdlNodes, asnNodes, qdataNodes }, (err, result, writes) => {
		harness.ok(`case-insensitive family read ran ok (${err || 'ok'})`, !err, err);
		const qdataBlock = ((result && result.blocks) || []).filter((oneBlock) => oneBlock.applyLabel === LABEL_CTDL_QDATA)[0];
		harness.equal('the ctdl::ctdlqdata block resolves the edge despite the mixed-case _source', qdataBlock && qdataBlock.edgesWritten, 1);
		harness.equal('the mixed-case qdata node is NOT reported as an unresolved dangler', JSON.stringify((result.counts.unresolvedByStandard || {}).CTDL), JSON.stringify(undefined));
		const references = writes.filter((oneWrite) => oneWrite.relationshipType === 'REFERENCES')[0];
		harness.equal('the REFERENCES edge lands on the ctdl::ctdlqdata pair label', `${references && references.fromStableId}->${references && references.toStableId} @${references && references.applyLabel}`, `ceterms:refsQdata->cdqd:target @${LABEL_CTDL_QDATA}`);
		runVersionKeying();
	});
};

// =====================================================================
// E — version-keying: each structural block name is keyed on BOTH endpoints and _struct-suffixed
// =====================================================================
const runVersionKeying = () => {
	harness.section('E — version-keyed, _struct-suffixed relationship block names (both endpoints)');
	// build.js composes each structural block ROOT-FIRST: firstStandard leads, secondStandard follows.
	const composed = vocabulary.relationshipSubject({ hubStandard: 'ctdl', hubVersion: '2', sourceStandard: 'ctdlasn', sourceVersion: '1', producer: 'structural' });
	harness.equal('structural -> ctdl@2_rel_ctdlasn@1_struct (version-keyed on BOTH endpoints, root-first)', composed.subject, 'ctdl@2_rel_ctdlasn@1_struct');
	harness.equal('read-back: ..._struct -> structural', vocabulary.relationshipProducerFromSubject('ctdl@2_rel_ctdlasn@1_struct'), 'structural');
	harness.ok('the RELATIONSHIP kind gate ACCEPTS a _struct name', vocabulary.subjectAgreesWithKind('ctdl@2_rel_ctdlasn@1_struct', vocabulary.SCHEMA_BLOCK_KIND.RELATIONSHIP));
	harness.ok('an unknown producer is STILL refused (no silent default)', !!vocabulary.relationshipSubject({ hubStandard: 'ctdlasn', hubVersion: '1', sourceStandard: 'ctdl', sourceVersion: '2', producer: 'guessed' }).error);

	harness.report();
};

// entry point — all stage functions are declared above (their synchronous double callbacks would otherwise
// reach a later stage before its `const` was initialized).
runMainThroughBridgeMaker();
