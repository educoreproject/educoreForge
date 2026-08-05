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
const check = (label, condition) => {
	if (condition) {
		pass++;
		console.log(`  ok    ${label}`);
	} else {
		fail++;
		console.error(`  FAIL  ${label}`);
	}
};
const evidence = (line) => console.log(`        ${line}`);

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
	const contestedDefinitions = definitionNodes.filter(
		(oneNode) => oneNode.stableId.indexOf(`${CONTESTED_NAMESPACE}#`) === 0,
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
	check('INTEGRATION roundTripValidator NOT declared yet (declared-and-broken = refusal)', descriptor && descriptor.roundTripValidator === undefined);
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

			const everyNodeConforms = forged.nodes.every(
				(oneNode) =>
					oneNode.stableId &&
					Array.isArray(oneNode.labels) &&
					oneNode.labels.indexOf('ForgedNode') !== -1 &&
					typeof oneNode.properties.searchText === 'string' &&
					oneNode.properties.searchText.length > 0,
			);
			check('INTEGRATION every node has stableId, ForgedNode label, non-empty searchText', everyNodeConforms);
			const everyEdgeConforms = forged.edges.every(
				(oneEdge) => oneEdge.properties && oneEdge.properties.provenanceTier === 'structural' && oneEdge.properties.pescTier,
			);
			check('INTEGRATION every edge carries provenanceTier structural + pescTier', everyEdgeConforms);
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
			forged.nodes.forEach((oneNode) => {
				const nodeTierValue = oneNode.properties.pescTier;
				if (PESC_TIER_VALUES.indexOf(nodeTierValue) === -1) {
					nodesWithUnratifiedTier.push(
						`${oneNode.stableId} (pescTier ${JSON.stringify(nodeTierValue)})`,
					);
					return;
				}
				nodeCountByTier[nodeTierValue]++;
			});
			evidence(`tier census: source ${nodeCountByTier.source}, derived ${nodeCountByTier.derived}, meta ${nodeCountByTier.meta}, synthetic ${nodeCountByTier.synthetic}; total ${forged.nodes.length}`);
			if (nodesWithUnratifiedTier.length > 0) {
				evidence(`unratified pescTier values: ${nodesWithUnratifiedTier.slice(0, 3).join('; ')}`);
			}
			check('INTEGRATION every node carries a ratified pescTier (source|derived|synthetic|meta, R-P2-1)', nodesWithUnratifiedTier.length === 0);
			check('INTEGRATION source tier is EXACTLY 41,676 nodes', nodeCountByTier.source === 41676);
			check('INTEGRATION derived tier is EXACTLY 63 nodes (the namespaces)', nodeCountByTier.derived === 63);
			check('INTEGRATION meta tier is EXACTLY 1 node (the standard root, R-P2-1)', nodeCountByTier.meta === 1);
			check('INTEGRATION synthetic tier is EMPTY until Phase 4 emits it', nodeCountByTier.synthetic === 0);
			check('INTEGRATION the four tiers account for every emitted node', nodeCountByTier.source + nodeCountByTier.derived + nodeCountByTier.meta + nodeCountByTier.synthetic === forged.nodes.length);

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

pipeRunner(taskList.getList(), {}, (err) => {
	if (err) {
		console.error(`\nSUITE ABORTED: ${err}`);
		process.exit(1);
	}
	console.log(`\n${pass} passed, ${fail} failed`);
	process.exit(fail === 0 ? 0 : 1);
});
