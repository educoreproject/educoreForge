#!/usr/bin/env node
'use strict';

// test-pesc260805SourceTier.js — the Phase 2 gate suite for the pesc260805 SOURCE-tier bundle.
// ALL PURE: no Voyage call, no Neo4j, no golden touch. Each gate demonstrates RED first — either
// by feeding the checker deliberately broken data (proving the checker can fail) or by re-keying
// in the HARNESS the way a naive model would (proving the trap is real) — then GREEN against the
// real bundle output. Evidence lines are printed for retention in test output.
//
// Gates (work order, Phase 2):
//   G-A  parse all 64; counts nonzero; two runs -> identical stableId sets (determinism)
//   G-B  the identity traps: three TransmissionDataType nodes; PersonType 1.10.0 != 1.19.1
//   G-C  collision: contested-namespace definitions disjoint, every key @sha12, no plain key
//   G-D  refusals observed by name (unbound prefix; message->message import) — fixtures only
//   G-E  facet fidelity: ApplicationFeeAmountType totalDigits/fractionDigits present in 1.19.0,
//        ABSENT in 1.19.1 (the fidelity the incumbent lost)
//   G-F  documentation verbatim: a multi-line source documentation string is byte-identical on
//        the emitted node (no whitespace collapse)
//   INTEGRATION: invoke the bundle exactly as forger.js does; validate the returned shape via
//        shape-forged-graph.js.
//
// Run: node forges/pesc260805/test/test-pesc260805SourceTier.js

const path = require('path');
const fs = require('fs');

// minimal process.global for the bundle factory (xLog only; no embedder for the pure layer).
process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: (message) => console.log(message),
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();
const configFileProcessor = require('qtools-config-file-processor');

const BUNDLE_DIR = path.join(__dirname, '..');
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');

const bundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

let pass = 0;
let fail = 0;
// every label check() is called with, in run order — the LEDGER gate at the foot of this file
// reconciles this list against test/redEvidenceLedger.json so a new assertion cannot arrive
// without red evidence recorded for it.
const shippedAssertionLabels = [];
const check = (label, condition) => {
	shippedAssertionLabels.push(label);
	if (condition) {
		pass++;
		console.log(`  ok    ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};
const evidence = (line) => console.log(`        ${line}`);

// R-ET-40 (P9, RADIANT_QUEST): the framework mints DmeEmbedText nodes and EMBEDS_TEXT_OF edges AFTER the walk
// (R-ET-2). A text node carries no searchText (R-ET-3) and no pescTier, by design. The universal INTEGRATION
// checks therefore quantify over the WALK population. The exclusion is EXACT (it equals stats) and the
// excluded population is checked positively. Labels here are CONSTANT: the LEDGER gate keys on them.
const { DME_ROLES, EDGE_TYPES } = require(path.join(TREE_ROOT, 'lib', 'vocabulary', 'vocabulary'));
const pescForgeDeclaration = require(path.join(BUNDLE_DIR, 'lib', 'pescForgeDeclaration'));
const isEmbedTextNode = (oneNode) => oneNode.role === DME_ROLES.EMBED_TEXT;
const isEmbedsTextOfEdge = (oneEdge) => oneEdge.type === EDGE_TYPES.EMBEDS_TEXT_OF;
const walkNodeListOf = (nodeList) => nodeList.filter((oneNode) => !isEmbedTextNode(oneNode));
const walkEdgeListOf = (edgeList) => edgeList.filter((oneEdge) => !isEmbedsTextOfEdge(oneEdge));
const checkEmbedTextPopulation = ({ nodeList, edgeList, forgeStats }) => {
	const textNodeList = nodeList.filter(isEmbedTextNode);
	const embedsTextOfEdgeList = edgeList.filter(isEmbedsTextOfEdge);
	const textStableIdSet = new Set(textNodeList.map((oneNode) => oneNode.stableId));
	const walkRoleByStableId = {};
	walkNodeListOf(nodeList).forEach((oneNode) => {
		walkRoleByStableId[oneNode.stableId] = oneNode.role;
	});
	const declaredRoleList = Object.keys(pescForgeDeclaration.embedTextDeclaration.textPropertyListByRole);
	evidence(`R-ET-40 excluded population: ${textNodeList.length} DmeEmbedText nodes (stats ${forgeStats.embedTextNodeCount}), ${embedsTextOfEdgeList.length} EMBEDS_TEXT_OF edges (stats ${forgeStats.embedTextEdgeCount})`);
	check('INTEGRATION R-ET-40 excluded DmeEmbedText nodes EQUAL stats.embedTextNodeCount', textNodeList.length > 0 && textNodeList.length === forgeStats.embedTextNodeCount);
	check('INTEGRATION R-ET-40 excluded EMBEDS_TEXT_OF edges EQUAL stats.embedTextEdgeCount', embedsTextOfEdgeList.length > 0 && embedsTextOfEdgeList.length === forgeStats.embedTextEdgeCount);
	check('INTEGRATION R-ET-40 every excluded text node carries NO searchText and NO pescTier', textNodeList.every((oneNode) => oneNode.properties.searchText === undefined && oneNode.properties.pescTier === undefined));
	check('INTEGRATION R-ET-40 every EMBEDS_TEXT_OF edge leaves a text node and lands on a walk node of a declared role', embedsTextOfEdgeList.every((oneEdge) => textStableIdSet.has(oneEdge.fromRef.id) && declaredRoleList.indexOf(walkRoleByStableId[oneEdge.toRef.id]) !== -1));
};

const CONTESTED_NAMESPACE = 'urn:org:pesc:sector:AcademicRecord:v1.6.0';

// ---- node-set helpers over a forged result ----
const namedDefinitionNodes = (forged) =>
	forged.nodes.filter((oneNode) => oneNode.labels.indexOf('PescNamedDefinition') !== -1);
const stableIdSet = (forged) => new Set(forged.nodes.map((oneNode) => oneNode.stableId));

const taskList = new taskListPlus();

// =====================================================================
// two full forge runs (G-A needs both; every later gate reads run one)
// =====================================================================
taskList.push((args, next) => {
	bundle.forge({ sourcePath: SNAPSHOT_DIR, owner: 'test', skipEmbedding: true }, (err, forged) => {
		if (err) {
			next(`run one failed: ${err}`);
			return;
		}
		next('', { ...args, runOne: forged });
	});
});
taskList.push((args, next) => {
	bundle.forge({ sourcePath: SNAPSHOT_DIR, owner: 'test', skipEmbedding: true }, (err, forged) => {
		if (err) {
			next(`run two failed: ${err}`);
			return;
		}
		next('', { ...args, runTwo: forged });
	});
});

// =====================================================================
// G-A — parse census, nonzero counts, determinism
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG-A — full parse + determinism');
	const { runOne, runTwo } = args;

	const setOne = stableIdSet(runOne);
	const setTwo = stableIdSet(runTwo);

	// RED first: prove the set comparator CAN fail — remove one id from a copy and compare.
	const mutilatedSet = new Set(setOne);
	const firstId = mutilatedSet.values().next().value;
	mutilatedSet.delete(firstId);
	const comparatorCatchesMutation =
		mutilatedSet.size !== setOne.size ||
		[...setOne].some((oneId) => !mutilatedSet.has(oneId));
	evidence(`RED (demonstrated): comparator fed a set missing '${firstId.substring(0, 60)}…' -> mismatch detected: ${comparatorCatchesMutation}`);
	check('G-A comparator demonstrably able to go red', comparatorCatchesMutation);

	const artifactCount = runOne.nodes.filter((oneNode) => oneNode.labels.indexOf('PescArtifact') !== -1).length;
	check('G-A all 64 corpus files produced artifact nodes', artifactCount === 64);
	check('G-A node count nonzero', runOne.nodes.length > 0);
	check('G-A edge count nonzero', runOne.edges.length > 0);
	evidence(`census: ${JSON.stringify({
		artifacts: runOne.stats.artifacts,
		importDecls: runOne.stats.importDecls,
		namedDefinitions: runOne.stats.namedDefinitions,
		elementDecls: runOne.stats.elementDecls,
		anonymousTypes: runOne.stats.anonymousTypes,
		derivations: runOne.stats.derivations,
		attributeDecls: runOne.stats.attributeDecls,
		enumerationValuesCarried: runOne.stats.enumerationValuesCarried,
		nodes: runOne.nodes.length,
		edges: runOne.edges.length,
	})}`);

	const sameSize = setOne.size === setTwo.size && setOne.size === runOne.nodes.length;
	const sameMembers = [...setOne].every((oneId) => setTwo.has(oneId));
	evidence(`GREEN: run one ${setOne.size} unique stableIds (of ${runOne.nodes.length} nodes), run two identical: ${sameSize && sameMembers}`);
	check('G-A stableIds unique within a run', setOne.size === runOne.nodes.length);
	check('G-A two runs produce identical stableId sets', sameSize && sameMembers);
	next('', args);
});

// =====================================================================
// G-B — the trap test: qualified identity vs bare-local-name fusion
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG-B — same-name/different-namespace identity traps');
	const definitionNodes = namedDefinitionNodes(args.runOne);

	const transmissionTargets = [
		'urn:org:pesc:core:CoreMain:v1.19.1#complexType/TransmissionDataType',
		'urn:org:pesc:sector:AcademicRecord:v1.13.0#complexType/TransmissionDataType',
		'urn:org:pesc:sector:AdmissionsRecord:v1.4.0#complexType/TransmissionDataType',
	];
	const transmissionNodes = definitionNodes.filter(
		(oneNode) => transmissionTargets.indexOf(oneNode.stableId) !== -1,
	);

	// RED (harness-only re-keying — NEVER in the bundle): key those same defs by bare local name.
	const bareKeys = new Set(
		transmissionNodes.map((oneNode) => `${oneNode.properties.kind}/${oneNode.properties.name}`),
	);
	evidence(`RED (demonstrated): bare-local-name keying fuses ${transmissionNodes.length} TransmissionDataType definitions into ${bareKeys.size} key(s): ${[...bareKeys].join(', ')}`);
	check('G-B RED: bare keying WOULD fuse the three TransmissionDataTypes', transmissionNodes.length === 3 && bareKeys.size === 1);

	evidence(`GREEN: real keys -> ${transmissionNodes.length} distinct nodes: ${transmissionNodes.map((oneNode) => oneNode.stableId).join(' | ')}`);
	check('G-B three TransmissionDataType definitions are three distinct nodes', new Set(transmissionNodes.map((oneNode) => oneNode.stableId)).size === 3);

	const personTypeIds = [
		'urn:org:pesc:core:CoreMain:v1.10.0#complexType/PersonType',
		'urn:org:pesc:core:CoreMain:v1.19.1#complexType/PersonType',
	];
	const personTypeNodes = definitionNodes.filter((oneNode) => personTypeIds.indexOf(oneNode.stableId) !== -1);
	const personBareKeys = new Set(personTypeNodes.map((oneNode) => `${oneNode.properties.kind}/${oneNode.properties.name}`));
	evidence(`RED (demonstrated): bare keying fuses PersonType 1.10.0 + 1.19.1 into ${personBareKeys.size} key(s)`);
	check('G-B RED: bare keying WOULD fuse the two PersonTypes', personTypeNodes.length === 2 && personBareKeys.size === 1);
	evidence(`GREEN: PersonType 1.10.0 and 1.19.1 are distinct nodes: ${personTypeNodes.map((oneNode) => oneNode.stableId).join(' | ')}`);
	check('G-B CoreMain 1.10.0 and 1.19.1 PersonType are distinct nodes', new Set(personTypeNodes.map((oneNode) => oneNode.stableId)).size === 2);
	next('', args);
});

// =====================================================================
// G-C — the collision discriminator (D-1)
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG-C — contested-namespace discriminator');
	const definitionNodes = namedDefinitionNodes(args.runOne);
	// PHASE 4 SCOPING, and it is load-bearing rather than cosmetic. D-1's discriminator is a rule
	// about what the FILES say — two artifacts, one namespace, so each declaration is keyed by its
	// declarer. Phase 4's merged definitions live in the same namespace and deliberately carry the
	// CLEAN key (that is what "the contest was decided" looks like in an identity), so an unscoped
	// filter here swept them in and the gate crashed reading a discriminator they are right not to
	// have. The subject of this gate is the SOURCE tier; say so.
	const contestedDefinitions = definitionNodes.filter(
		(oneNode) =>
			oneNode.properties.pescTier === 'source' &&
			oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#`) === 0,
	);

	// RED (harness-only): strip the @sha12 discriminator and count the keys that collide.
	const strippedKeyCounts = {};
	contestedDefinitions.forEach((oneNode) => {
		const strippedKey = oneNode.stableId.replace(/@[0-9a-f]{12}$/, '');
		strippedKeyCounts[strippedKey] = (strippedKeyCounts[strippedKey] || 0) + 1;
	});
	const fusedKeyCount = Object.keys(strippedKeyCounts).filter(
		(oneKey) => strippedKeyCounts[oneKey] > 1,
	).length;
	evidence(`RED (demonstrated): discriminator stripped -> ${fusedKeyCount} same-named definitions in the contested namespace WOULD fuse (e.g. ${Object.keys(strippedKeyCounts).find((oneKey) => strippedKeyCounts[oneKey] > 1) || 'none'})`);
	check('G-C RED: without @sha12 the two collision members WOULD fuse definitions', fusedKeyCount > 0);

	const discriminatorPattern = /@[0-9a-f]{12}$/;
	const allCarryDiscriminator = contestedDefinitions.every((oneNode) => discriminatorPattern.test(oneNode.stableId));
	const shaGroups = new Set(contestedDefinitions.map((oneNode) => oneNode.stableId.match(/@([0-9a-f]{12})$/)[1]));
	evidence(`GREEN: ${contestedDefinitions.length} contested-namespace definitions, all @sha12-keyed, ${shaGroups.size} disjoint artifact groups (${[...shaGroups].join(', ')})`);
	check('G-C contested-namespace definitions exist', contestedDefinitions.length > 0);
	check('G-C every contested definition key carries @sha12', allCarryDiscriminator);
	check('G-C the two collision artifacts produce two disjoint definition sets', shaGroups.size === 2);
	check('G-C no plain-keyed definition exists in the contested namespace', contestedDefinitions.filter((oneNode) => !discriminatorPattern.test(oneNode.stableId)).length === 0);

	// uncontested namespaces stay clean — the discriminator appears EXACTLY where the contest is.
	const discriminatedElsewhere = definitionNodes.filter(
		(oneNode) => discriminatorPattern.test(oneNode.stableId) && oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#`) !== 0,
	);
	check('G-C uncontested namespaces carry NO discriminator', discriminatedElsewhere.length === 0);
	next('', args);
});

// =====================================================================
// G-D — refusals, observed firing by name (fixtures live OUTSIDE the corpus)
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG-D — refusal gates (fixtures)');
	bundle.forge(
		{ sourcePath: path.join(FIXTURES_DIR, 'unboundPrefix'), owner: 'test', skipEmbedding: true },
		(err) => {
			const refused = !!err;
			const namesFile = refused && err.indexOf('UnboundPrefixFixture_v1.0.0.xsd') !== -1;
			const namesPrefix = refused && err.indexOf(`'ghost'`) !== -1;
			evidence(`RED (observed refusal): ${refused ? err.substring(0, 180) : 'NO REFUSAL — defect'}`);
			check('G-D unbound prefix refused', refused);
			check('G-D refusal names the file', namesFile);
			check('G-D refusal names the prefix', namesPrefix);
			next('', args);
		},
	);
});
taskList.push((args, next) => {
	bundle.forge(
		{ sourcePath: path.join(FIXTURES_DIR, 'messageImportsMessage'), owner: 'test', skipEmbedding: true },
		(err) => {
			const refused = !!err;
			const namesBoth =
				refused &&
				err.indexOf('urn:org:pesc:message:MessageImportFixture:v1.0.0') !== -1 &&
				err.indexOf('urn:org:pesc:message:CollegeTranscript:v1.8.0') !== -1;
			evidence(`RED (observed refusal): ${refused ? err.substring(0, 220) : 'NO REFUSAL — defect'}`);
			check('G-D message->message import refused', refused);
			check('G-D refusal names both namespaces', namesBoth);
			evidence('GREEN: the 64-file corpus itself parsed with zero refusals (runs one and two above)');
			next('', args);
		},
	);
});

// =====================================================================
// G-E — facet fidelity: the 1.19.0 vs 1.19.1 difference is VISIBLE
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG-E — facet fidelity (ApplicationFeeAmountType)');
	const byStableId = {};
	args.runOne.nodes.forEach((oneNode) => {
		byStableId[oneNode.stableId] = oneNode;
	});
	const restriction1190 =
		byStableId['urn:org:pesc:core:CoreMain:v1.19.0#simpleType/ApplicationFeeAmountType/restriction/1'];
	const restriction1191 =
		byStableId['urn:org:pesc:core:CoreMain:v1.19.1#simpleType/ApplicationFeeAmountType/restriction/1'];

	check('G-E 1.19.0 restriction node exists', !!restriction1190);
	check('G-E 1.19.1 restriction node exists', !!restriction1191);
	if (restriction1190 && restriction1191) {
		// RED first: assert 1.19.0's facts against the 1.19.1 node — the checker must fail there,
		// proving it detects absence rather than passing vacuously.
		const redWouldPass =
			restriction1191.properties.totalDigits === '12' && restriction1191.properties.fractionDigits === '2';
		evidence(`RED (demonstrated): asserting totalDigits/fractionDigits on the 1.19.1 node fails as it must (totalDigits=${JSON.stringify(restriction1191.properties.totalDigits)}, fractionDigits=${JSON.stringify(restriction1191.properties.fractionDigits)})`);
		check('G-E RED: the facet assertion demonstrably fails where facets are absent', !redWouldPass);

		evidence(`GREEN: 1.19.0 carries totalDigits=${restriction1190.properties.totalDigits}, fractionDigits=${restriction1190.properties.fractionDigits}; 1.19.1 carries neither — the Phase 0 facet difference is VISIBLE in emitted nodes`);
		check('G-E 1.19.0 carries totalDigits 12', restriction1190.properties.totalDigits === '12');
		check('G-E 1.19.0 carries fractionDigits 2', restriction1190.properties.fractionDigits === '2');
		check('G-E 1.19.1 facets ABSENT', restriction1191.properties.totalDigits === undefined && restriction1191.properties.fractionDigits === undefined);
		check('G-E both share the written base', restriction1190.properties.baseAsWritten === 'core:SmallCurrencyType' && restriction1191.properties.baseAsWritten === 'core:SmallCurrencyType');
	}
	next('', args);
});

// =====================================================================
// G-F — documentation verbatim (byte-identical, no whitespace collapse)
// =====================================================================
taskList.push((args, next) => {
	console.log('\nG-F — documentation carried verbatim');
	const sourceFilename = 'CoreMain_v1.10.0.xsd';
	const rawXml = fs.readFileSync(path.join(SNAPSHOT_DIR, sourceFilename), 'utf8');

	// pick the FIRST documentation string in the raw source that spans lines and contains no
	// entity or markup (so decoded text === raw bytes) — a specimen the incumbent's
	// `.replace(/\s+/g,' ')` would mangle.
	const documentationPattern = /<xs:documentation>([\s\S]*?)<\/xs:documentation>/g;
	let specimen = null;
	let oneMatch;
	while ((oneMatch = documentationPattern.exec(rawXml)) !== null) {
		if (/\n/.test(oneMatch[1]) && !/[&<]/.test(oneMatch[1])) {
			specimen = oneMatch[1];
			break;
		}
	}
	check('G-F a multi-line documentation specimen exists in the raw source', specimen !== null);

	if (specimen !== null) {
		const collapsedSpecimen = specimen.replace(/\s+/g, ' ').trim(); // the incumbent's normalization
		evidence(`specimen: ${specimen.length} bytes, ${specimen.split('\n').length} lines; collapsed form would be ${collapsedSpecimen.length} bytes`);
		evidence(`RED (demonstrated): the incumbent's collapse changes the bytes (byte-identical: ${collapsedSpecimen === specimen}) — this checker would catch it`);
		check('G-F RED: whitespace collapse is detectable by the byte comparison', collapsedSpecimen !== specimen);

		// the specimen must appear BYTE-IDENTICAL somewhere in the emitted graph: as a node's
		// documentation property or inside an ordered enumerationValues entry.
		let carrierStableId = null;
		args.runOne.nodes.some((oneNode) => {
			if (oneNode.properties.documentation === specimen) {
				carrierStableId = oneNode.stableId;
				return true;
			}
			if (oneNode.properties.enumerationValues) {
				const enumerationEntries = JSON.parse(oneNode.properties.enumerationValues);
				if (enumerationEntries.some((oneEntry) => oneEntry.documentation === specimen)) {
					carrierStableId = `${oneNode.stableId} (enumeration annotation)`;
					return true;
				}
			}
			return false;
		});
		evidence(`GREEN: specimen found byte-identical on ${carrierStableId || 'NOWHERE — defect'}`);
		check('G-F specimen is byte-identical on an emitted node', carrierStableId !== null);
	}
	next('', args);
});

// =====================================================================
// INTEGRATION — the real invocation path (forger.js contract) + engine shaping
// =====================================================================
taskList.push((args, next) => {
	console.log('\nINTEGRATION — descriptor + factory + forge + shapeForgedGraph');

	const descriptorPath = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
	const descriptor = (configFileProcessor.getConfig(descriptorPath) || {}).parserDescriptor;
	check('INTEGRATION [parserDescriptor] section is visible to the ini reader', !!descriptor);
	check('INTEGRATION standardName is PESC260805 (D-6)', descriptor && descriptor.standardName === 'PESC260805');
	check('INTEGRATION entryModule declared', descriptor && descriptor.entryModule === 'forgePesc260805.js');
	// PHASE 7 RE-PIN (SCARLET_GARDEN, 2026-08-07). The assertion here read, from Phase 2 until now:
	//   check('INTEGRATION roundTripValidator NOT declared yet (declared-and-broken = refusal)',
	//         descriptor && descriptor.roundTripValidator === undefined);
	// PHASE 5 FALSIFIED IT by declaring roundTripValidator=roundTripValidator.js, and it has been the
	// suite's single standing FAIL (54 passed / 1 failed) ever since — carried across Phases 5, 6 and
	// 6.5 as a DECLARED debt rather than repaired, so that a red suite could not be mistaken for a
	// clean one. This is its re-pinning, which the Phase 6.5 closing handoff assigned to Phase 7.
	//
	// IT IS RE-PINNED TO THE OPPOSITE FACT, NOT DELETED. The original assertion's PURPOSE was RT-13.3:
	// a declared roundTripValidator that does not exist or does not load REFUSES EVERY BUILD by name,
	// stage on or off, so the declaration must never be speculative. That purpose is unchanged; only
	// the state of the world moved. The honest pin is therefore not "it is absent" but "it is declared
	// AND the file it names is really there", which is the condition RT-13.3 actually cares about.
	//
	// DELIBERATELY THREE SEPARATE ASSERTIONS, NOT ONE CONJUNCTION. This phase measured the conjunction
	// class — 78 of 233 shipped assertions carry a top-level `&&`, and a receipt keyed to a LABEL
	// proves only that SOME conjunct can fail. Writing the replacement as one three-part conjunction
	// would have added a 79th on the very day the class was measured.
	// THE GUARD LOGIC IS LIFTED INTO NAMED INTERMEDIATES SO EACH check() CARRIES ZERO TOP-LEVEL
	// CONJUNCTIONS. The first draft of this re-pin wrote each successor as
	// `typeof name === 'string' AND name !== '' AND fs.existsSync(...)` — three conjuncts apiece —
	// and mp_auditConjunctiveAssertions.js immediately reported conjunctive rows 78 -> 80 and
	// 3-plus-conjunct proven rows 11 -> 13. THE AUTHOR OF THE CONJUNCTION MEASUREMENT ADDED TWO
	// MEMBERS TO THE CLASS ON THE DAY HE MEASURED IT, and did not notice until the instrument said
	// so. Recorded here rather than quietly corrected: knowing about a trap does not disarm it, and
	// an instrument that runs is worth more than an intention that does not.
	const declaredValidatorFileName = descriptor && descriptor.roundTripValidator;
	const declaredValidatorPath =
		typeof declaredValidatorFileName === 'string' && declaredValidatorFileName !== ''
			? path.join(BUNDLE_DIR, declaredValidatorFileName)
			: '';
	const declaredValidatorFileExists = declaredValidatorPath !== '' && fs.existsSync(declaredValidatorPath);
	const declaredValidatorExportsValidate =
		declaredValidatorFileExists && typeof require(declaredValidatorPath)().validate === 'function';
	check('INTEGRATION roundTripValidator IS declared (Phase 5; re-pinned in Phase 7)', declaredValidatorFileName === 'roundTripValidator.js');
	check('INTEGRATION the declared roundTripValidator file EXISTS (RT-13.3: declared-and-missing refuses every build)', declaredValidatorFileExists);
	check('INTEGRATION the declared roundTripValidator exports validate() (RT-13.3: declared-and-broken is a refusal, never a downgrade to absent)', declaredValidatorExportsValidate);
	check('INTEGRATION defaultSnapshot resolves to exactly the 01 directory', descriptor && Number(descriptor.defaultSnapshot) === 1 && fs.existsSync(SNAPSHOT_DIR));

	// invoke the way forger.js does: require(entryPath)({ embedder }), then bundle.forge(...)
	const entryBundle = require(path.join(BUNDLE_DIR, `${descriptor.entryModule}`))({ embedder: null });
	entryBundle.forge(
		{ sourcePath: SNAPSHOT_DIR, owner: 'test', skipEmbedding: true },
		(err, forged) => {
			if (err) {
				check(`INTEGRATION forge run (${err})`, false);
				next('', args);
				return;
			}
			check('INTEGRATION forge returns nodes[] and edges[]', Array.isArray(forged.nodes) && Array.isArray(forged.edges));
			check('INTEGRATION metadata.version non-blank', typeof forged.metadata.version === 'string' && forged.metadata.version.trim() === 'aggregate-01');
			check('INTEGRATION standardKey + stableUriPropertyName returned', forged.standardKey === 'pesc260805' && forged.stableUriPropertyName === 'pesc260805StableId');
			check('INTEGRATION embedCallCount is 0 with skipEmbedding', forged.embedCallCount === 0);

			const everyNodeConforms = walkNodeListOf(forged.nodes).every(
				(oneNode) =>
					oneNode.stableId &&
					Array.isArray(oneNode.labels) &&
					oneNode.labels.indexOf('ForgedNode') !== -1 &&
					typeof oneNode.properties.searchText === 'string' &&
					oneNode.properties.searchText.length > 0,
			);
			check('INTEGRATION every node has stableId, ForgedNode label, non-empty searchText', everyNodeConforms);
			const everyEdgeConforms = walkEdgeListOf(forged.edges).every(
				(oneEdge) => oneEdge.properties && oneEdge.properties.provenanceTier === 'structural' && oneEdge.properties.pescTier,
			);
			check('INTEGRATION every edge carries provenanceTier structural + pescTier', everyEdgeConforms);
			checkEmbedTextPopulation({ nodeList: forged.nodes, edgeList: forged.edges, forgeStats: forged.stats });

			// =====================================================================================
			// COMPOSITION — the HYBRID searchText composition (TQ 2026-08-17 "re-embed authorized").
			//
			// WHY THESE ARE SHIPPED ASSERTIONS AND NOT ONLY A PROBE: the ordering guard is a REFUSAL
			// in production code and therefore runs on every build, but the SHAPE of what each arm
			// emits is checked nowhere unless it is checked here. The composition's failure mode is a
			// silently WRONG STRING, which forges clean, round-trips clean and passes every other
			// gate in this suite.
			//
			// The arm statistics are read from the DECLARED registry rather than restated, so a
			// registry change cannot leave a stale expectation behind in this file.
			//
			// THE TWO POPULATIONS ARE NEVER POOLED (binding constraint 2 of the ruling): they are
			// embedded on differently-shaped strings and are not mutually comparable. Every figure
			// below is per arm.
			// =====================================================================================
			const compositionStats = forged.stats.searchTextComposition;
			const composedNodesByArm = compositionStats.byArm;
			evidence(
				`composition C2 ${composedNodesByArm.hasEffectiveDescription.nodesComposed} ` +
					`(mean ${composedNodesByArm.hasEffectiveDescription.characterMean} chars, ` +
					`${composedNodesByArm.hasEffectiveDescription.atOrAboveHubMinimum} at/above the hub's 81); ` +
					`C0 ${composedNodesByArm.noProseAnywhere.nodesComposed} ` +
					`(mean ${composedNodesByArm.noProseAnywhere.characterMean} chars); ` +
					`prose own ${compositionStats.proseSource.own} / ` +
					`viaResolvesTo ${compositionStats.proseSource.resolvedType} / ` +
					`none ${compositionStats.proseSource.none}`,
			);
			evidence(
				`composition by label: ` +
					Object.keys(compositionStats.byLabel)
						.sort()
						.map(
							(oneLabel) =>
								`${oneLabel} ${compositionStats.byLabel[oneLabel].nodesComposed}` +
								`${compositionStats.byLabel[oneLabel].insideMeasuredEvidence ? '' : ' [outside the measured evidence]'}`,
						)
						.join('; '),
			);

			// (1) a bare element name is C1 — the arm the cosine guard DISQUALIFIED for a 0.169 fall
			// in median top-1 cosine, more than five times the 0.03 threshold. Shipping it silently
			// to any subject is the defect this whole pass exists to avoid.
			check(
				'COMPOSITION zero C1-shaped emissions (a bare element name is the DISQUALIFIED arm)',
				compositionStats.c1ShapedEmissions === 0,
			);

			// (2) THE ORDERING, asserted on OUTPUT rather than trusted from the call site. If the
			// composition ever runs before the derived tier, no element can borrow its type's prose
			// and this figure is exactly zero. §5.2 measured the rescue at 6,646 declarations, so a
			// zero here is not a corpus property, it is a wiring fault.
			check(
				'COMPOSITION prose IS borrowed over RESOLVES_TO, so the composition ran AFTER the derived tier',
				compositionStats.proseSource.resolvedType > 0,
			);

			// (3) and (4) — the SHAPES the ruling names, checked over every composed node rather than
			// sampled. TWO assertions, because one would have been unfalsifiable in a way worth
			// recording: a REVERSED C2 arm emitting `effectiveDescription | ElementName` ends with the
			// element's name and would therefore satisfy a permissive "name-first OR name-last" test
			// by masquerading as a valid C0. The envelope test alone cannot tell those apart.
			//
			// So (4) carries a SOUND IMPLICATION that pins the direction: a node with prose OF ITS OWN
			// has a non-empty effective description whatever RESOLVES_TO says, so it is on the C2 arm
			// necessarily, and the C2 arm puts the NAME FIRST. That is derivable from the node alone,
			// it needs no second copy of the selection rule, and a reversed arm fails it immediately.
			// It deliberately says nothing about nodes that reached C2 via RESOLVES_TO — asserting
			// about those would require recomputing the resolution here, which is the duplicate
			// derivation this suite avoids elsewhere.
			const composedLabelNames = Object.keys(compositionStats.byLabel);
			const composedSourceNodes = forged.nodes.filter(
				(oneNode) =>
					oneNode.properties.pescTier === 'source' &&
					composedLabelNames.some((oneLabel) => oneNode.labels.indexOf(oneLabel) !== -1),
			);
			const outsideBothShapes = [];
			const ownProseNotNameFirst = [];
			composedSourceNodes.forEach((oneNode) => {
				const oneSearchText = oneNode.properties.searchText;
				const oneName = `${oneNode.properties.name}`;
				const isNameFirst = oneSearchText.indexOf(`${oneName} | `) === 0;
				const isNameLast =
					oneSearchText.length > oneName.length + 3 &&
					oneSearchText.lastIndexOf(` | ${oneName}`) === oneSearchText.length - oneName.length - 3;
				if (!isNameFirst && !isNameLast) {
					outsideBothShapes.push(
						`${oneNode.stableId} -> ${JSON.stringify(oneSearchText.substring(0, 80))}`,
					);
				}
				if (`${oneNode.properties.description || ''}`.trim() !== '' && !isNameFirst) {
					ownProseNotNameFirst.push(
						`${oneNode.stableId} -> ${JSON.stringify(oneSearchText.substring(0, 80))}`,
					);
				}
			});
			if (outsideBothShapes.length > 0) {
				evidence(
					`outside both ruled shapes (${outsideBothShapes.length}): ${outsideBothShapes.slice(0, 3).join(' ; ')}`,
				);
			}
			if (ownProseNotNameFirst.length > 0) {
				evidence(
					`own-prose nodes NOT name-first (${ownProseNotNameFirst.length}): ${ownProseNotNameFirst.slice(0, 3).join(' ; ')}`,
				);
			}
			check(
				'COMPOSITION every composed node emits one of the two RULED shapes (name-first or name-last)',
				outsideBothShapes.length === 0,
			);
			check(
				'COMPOSITION a node with its OWN prose emits the NAME FIRST (the C2 direction, so a reversed arm cannot pass as C0)',
				ownProseNotNameFirst.length === 0,
			);

			// (5) the accounting closes. The arms must partition the composed population exactly —
			// no node counted twice, none uncounted. An arm that silently skipped a node would leave
			// that node carrying its PRE-CHANGE text with nothing to say so.
			const armTotal =
				composedNodesByArm.hasEffectiveDescription.nodesComposed +
				composedNodesByArm.noProseAnywhere.nodesComposed;
			const labelTotal = Object.keys(compositionStats.byLabel).reduce(
				(runningTotal, oneLabel) => runningTotal + compositionStats.byLabel[oneLabel].nodesComposed,
				0,
			);
			const proseSourceTotal =
				compositionStats.proseSource.own +
				compositionStats.proseSource.resolvedType +
				compositionStats.proseSource.none;
			evidence(
				`composition accounting: byArm ${armTotal}, byLabel ${labelTotal}, ` +
					`proseSource ${proseSourceTotal}, composed source nodes ${composedSourceNodes.length}`,
			);
			check(
				'COMPOSITION the arms PARTITION the composed population (byArm = byLabel = proseSource = nodes seen)',
				armTotal === labelTotal &&
					armTotal === proseSourceTotal &&
					armTotal === composedSourceNodes.length,
			);
			// TIER CENSUS — the THREE-TIER reality. This assertion previously read "all nodes except
			// the root are pescTier source", which was true when forge() emitted source+meta only.
			// forge() now emits source + derived + meta in ONE pass, so the old form was stale — and
			// the old evidence line mis-described the 64 non-source nodes as "the root" when they are
			// 63 derived namespaces PLUS the root. Replaced with EXACT per-tier counts (a drift in
			// either direction fails) plus an assertion that the tier vocabulary is CLOSED: a node
			// carrying a pescTier outside the R-P2-1 enum is a fault, not a node to quietly ignore.
			const PESC_TIER_VALUES = ['source', 'derived', 'synthetic', 'meta'];
			const nodeCountByTier = {};
			PESC_TIER_VALUES.forEach((oneTierValue) => {
				nodeCountByTier[oneTierValue] = 0;
			});
			const nodesWithUnratifiedTier = [];
			walkNodeListOf(forged.nodes).forEach((oneNode) => {
				const nodeTierValue = oneNode.properties.pescTier;
				if (PESC_TIER_VALUES.indexOf(nodeTierValue) === -1) {
					nodesWithUnratifiedTier.push(
						`${oneNode.stableId} (pescTier ${JSON.stringify(nodeTierValue)})`,
					);
					return;
				}
				nodeCountByTier[nodeTierValue]++;
			});
			evidence(`tier census: source ${nodeCountByTier.source}, derived ${nodeCountByTier.derived}, meta ${nodeCountByTier.meta}, synthetic ${nodeCountByTier.synthetic}; walk population ${walkNodeListOf(forged.nodes).length} (what the four tiers must sum to), full population ${forged.nodes.length} (walk + framework embed-text nodes)`);
			if (nodesWithUnratifiedTier.length > 0) {
				evidence(`unratified pescTier values: ${nodesWithUnratifiedTier.slice(0, 3).join('; ')}`);
			}
			check('INTEGRATION every node carries a ratified pescTier (source|derived|synthetic|meta, R-P2-1)', nodesWithUnratifiedTier.length === 0);
			check('INTEGRATION source tier is EXACTLY 41,676 nodes', nodeCountByTier.source === 41676);
			check('INTEGRATION derived tier is EXACTLY 63 nodes (the namespaces)', nodeCountByTier.derived === 63);
			check('INTEGRATION meta tier is EXACTLY 1 node (the standard root, R-P2-1)', nodeCountByTier.meta === 1);
			// RESTATED AT PHASE 4. This read "synthetic tier is EMPTY until Phase 4 emits it", which
			// was a statement about a schedule, not an invariant — and Phase 4 has now emitted it.
			// The claim that still matters at this altitude is that the tier is POPULATED and its
			// size is pinned. A drift in either direction fails here as well as in the Phase 4 suite,
			// because a census that only one suite can see is a census one edit away from being
			// unwatched.
			//
			// RESTATED AGAIN AT PHASE 4.6a, and the restatement is the FINDING, not a repair. The
			// pinned size was 110 (109 S-1 merged definitions + 1 S-2 alias namespace). R-P4-3
			// ordered merged definitions to carry their children directly, so the tier legitimately
			// gains 522 duplicated element declarations (S-1c) and the pin moves to 632. The count is
			// re-derived from its parts here rather than written as a bare 632, so a future drift
			// says WHICH part moved instead of only that something did.
			check(
				'INTEGRATION synthetic tier is EXACTLY 632 nodes (109 S-1 merged definitions + 522 S-1c duplicated children + 1 S-2 alias namespace)',
				nodeCountByTier.synthetic === 109 + 522 + 1,
			);
			check('INTEGRATION the four tiers account for every emitted node', nodeCountByTier.source + nodeCountByTier.derived + nodeCountByTier.meta + nodeCountByTier.synthetic === walkNodeListOf(forged.nodes).length);

			// engine shaping — the exact translation forger.js applies before replay.
			const { shapeForgedGraph } = require(
				path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'forger', 'lib', 'shape-forged-graph'),
			)();
			const shaped = shapeForgedGraph({ forged });
			check('INTEGRATION shapeForgedGraph accepts the output (no error)', !shaped.error);
			if (shaped.error) {
				evidence(`shape error: ${shaped.error}`);
			} else {
				check('INTEGRATION shaped embeddingDims null (nothing embedded)', shaped.embeddingDims === null);
				check(
					'INTEGRATION shaped nodes carry ref{source,id} resolving the stableId',
					shaped.nodes.every((oneNode) => oneNode.ref && oneNode.ref.source === 'PESC260805' && oneNode.ref.id === oneNode.stableId),
				);
				check(
					'INTEGRATION shaped edges carry provenanceTier (PG-JSON array form)',
					shaped.edges.every((oneEdge) => Array.isArray(oneEdge.properties.provenanceTier) && oneEdge.properties.provenanceTier[0] === 'structural'),
				);
			}
			next('', args);
		},
	);
});

// =====================================================================
// LEDGER — every shipped assertion must carry recorded red evidence
// =====================================================================
// See the twin gate in test-pesc260805DerivedTier.js for the reasoning. In THIS suite the
// dominant bucket is records-gap rather than genuine gap: the DEVLOG records "PHASE 2: CLOSED —
// 47/47 gates, all RED-first" and Phase 2 was independently reviewed and committed at b02168b,
// but those red receipts were not retained. Believed, cited, unverifiable — and deliberately NOT
// re-run, because re-proving them by hand duplicates Phase 6's mutation suite.
taskList.push((args, next) => {
	console.log('\nLEDGER — red evidence for every shipped assertion');
	const ledger = require(path.join(__dirname, 'redEvidenceLedger.json'));
	const suiteLedger = ledger.suites.source;
	const ledgeredLabels = new Set(suiteLedger.assertions.map((oneEntry) => oneEntry.label));
	// THE GATE MUST NOT EXEMPT ITSELF — see the twin gate in the derived suite. Declared once,
	// used both to seed the label set and to make the calls, so the two cannot drift apart.
	const LEDGER_GATE_LABELS = [
		'LEDGER every shipped assertion has a red-evidence entry',
		'LEDGER carries no stale entries for assertions this suite no longer runs',
		'LEDGER the entry count matches the assertions actually run',
		'LEDGER every proven row carries at least one lever that MUTATES PRODUCTION DATA',
	];
	const uniqueShippedLabels = [...new Set([...shippedAssertionLabels, ...LEDGER_GATE_LABELS])];
	const unledgeredLabels = uniqueShippedLabels.filter((oneLabel) => !ledgeredLabels.has(oneLabel));
	const staleLedgerLabels = [...ledgeredLabels].filter(
		(oneLabel) => uniqueShippedLabels.indexOf(oneLabel) === -1,
	);
	const statusCounts = { proven: 0, recordsGap: 0, genuineGap: 0 };
	suiteLedger.assertions.forEach((oneEntry) => {
		statusCounts[oneEntry.status]++;
	});
	evidence(`ledger: ${uniqueShippedLabels.length} shipped assertions; proven-red ${statusCounts.proven}, records-gap ${statusCounts.recordsGap}, GENUINE GAP ${statusCounts.genuineGap}`);
	if (unledgeredLabels.length > 0) {
		evidence(`UNLEDGERED (new assertion without red evidence): ${unledgeredLabels.join(' | ')}`);
	}
	if (staleLedgerLabels.length > 0) {
		evidence(`STALE ledger entries (assertion removed or renamed): ${staleLedgerLabels.join(' | ')}`);
	}
	check(LEDGER_GATE_LABELS[0], unledgeredLabels.length === 0);
	check(LEDGER_GATE_LABELS[1], staleLedgerLabels.length === 0);
	check(LEDGER_GATE_LABELS[2], suiteLedger.assertions.length === uniqueShippedLabels.length);

	// ==========================================================================================
	// THE STANDING RULE, NOW ENFORCED (JADE_PORTAL ruling, 2026-08-07, on SCARLET_GARDEN's sweep):
	// EVERY `proven` ROW MUST CARRY AT LEAST ONE LEVER THAT MUTATES PRODUCTION DATA.
	//
	// Mechanically: an expectation lever reddens an assertion whether or not its predicate can ever
	// be satisfied by real data, so it certifies a VACUOUS gate as proven. A data lever cannot,
	// because a vacuous check does not respond to data at all. A row whose only receipt is an
	// expectation perturbation proves the assertion is WIRED UP, not that it can catch a defect.
	//
	// THE CLASSIFIER IS IMPORTED, NOT REIMPLEMENTED. p7_expectationLeverSweep.js owns the declared
	// LEVER_CLASS_REGISTRY and refuses by name on an undeclared opening token; a second copy here
	// would be two derivations of one judgment held against each other, which is DESIGN 8h's failure.
	//
	// THIS GATE'S FIRST RUN WAS RED AGAINST 65 SHIPPED ROWS and that red is retained at
	// test/test-artifacts/p7/p7RED_provenImpliesDataLever.log. Those rows were then re-stated
	// `expectationLeverOnly` — a status added for them, because the ledger DEFINES `genuineGap` as
	// "never demonstrated able to fail, by anyone" and these rows HAVE failed, just not under a data
	// lever. Re-labelling them genuineGap would have bought an honest number with a dishonest
	// vocabulary.
	// ==========================================================================================
	const { classifyOneLever } = require(path.join(__dirname, 'probes', 'p7_expectationLeverSweep.js'));
	const provenRowsWithoutADataLever = suiteLedger.assertions
		.filter((oneEntry) => oneEntry.status === 'proven')
		.filter(
			(oneEntry) =>
				!(Array.isArray(oneEntry.redEvidence) ? oneEntry.redEvidence : []).some((oneLever) => {
					const classified = classifyOneLever(oneLever.lever);
					return classified !== null && classified.mutatesProductionData;
				}),
		);
	if (provenRowsWithoutADataLever.length > 0) {
		evidence(
			`PROVEN WITHOUT A DATA LEVER (${provenRowsWithoutADataLever.length}): ` +
				provenRowsWithoutADataLever.map((oneEntry) => oneEntry.label).join(' | '),
		);
	}
	check(LEDGER_GATE_LABELS[3], provenRowsWithoutADataLever.length === 0);
	next('', args);
});

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nSUITE ABORTED: ${err}`);
		process.exit(1);
	}
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail === 0 ? 0 : 1);
});
