#!/usr/bin/env node
'use strict';

// test-bgBoltLive.js — BG-BOLT-LIVE: the Bridge Framework's two bolt files (lib/bridge-framework/graphReader.js,
// graphWriter.js) against a REAL Neo4j (SPEC-bridgeFramework-v1.md §14.1; B2 review ruling BR1 "PLUS a containerised
// smoke gate in B3"; B2 holdings 1–2 (reviews/STANDDOWN-B2-frozenStream.md): the driver double could not see neo4j
// Integer unwrapping, the multi-page read loop, or whether `SET r = $map` round-trips a ONE-ELEMENT list as a LIST).
// BG-BOLT (test-bgBolt.js) proves PARITY through a driver double; THIS gate proves the SAME files against the wire.
//
// ONE-MACHINE, BUILD-CLASS, SAYS SO BY NAME: it provisions ONE DEV_ container (replayManager.create, GNC-001 scratch
// tier), restores the CEDS hub-bearing base + the Ed-Fi base from the PINNED B3 acceptance store
// (system/dataStores/bridgeAcceptance/edfi/edfiBridge.standardsDatabase.sqlite3 — GOLD_EVAL_260816's bytes; opened
// READ-ONLY, nothing is written to it), runs the conjuncts, and DESTROYS the container. No LLM, no Voyage (the vectors
// come from the store's own vector table). ~4–6 minutes. If Docker or the pinned store is absent it REFUSES BY NAME
// (exit 1) — UNMEASURED is a failure, never a skip.
//
// CONJUNCTS (every one observed RED three-state through a productionMutation of the bolt file, compiled IN MEMORY by
// moduleDouble against the SAME live graph — nothing in the tree changes):
//   (a) PAGING — readSubjectNodes over the Ed-Fi source returns EVERY node (6,336 > PAGE_SIZE 5,000: the multi-page
//       loop and the short-page stop ran past page 1); twin: the short-page stop fires on page 1 → 5,000 → red
//   (b) INTEGER UNWRAP — the driver's Integer reaches the framework on the WRITER's `count(r)` (the read path's
//       node properties arrive as Neo4j FLOATS: replay-engine writes JS numbers, which the driver sends as Float64,
//       so `depth` is a JS number with or without unwrapValue — MEASURED here and stated by name, not assumed);
//       the writer unwraps that Integer to compare it to 1; twin: the writer's isInt branch dropped → the live
//       Integer never equals 1 → the write is REFUSED ("reported 1 edges, not 1") → red
//   (c) HUB CARDS + RE-WIDEN — readHubCards({ referenceTier: 'property' }) returns 2,777 cards; the qualified
//       P001572 cards carry qualifierKeys as a LIST of one (the golden stores one-element lists as SCALARS —
//       RULING P8, re-widened at the read boundary); twin: the re-widen skipped → a string → red
//   (d) BLINDING ON THE WIRE — forEvidence() records carry NONE of the declared blinded names (495 Ed-Fi properties
//       carry cedsId in the graph); forWalk({ channelPropertyList: [] }) REFUSES BY NAME a read of cedsId;
//       twin: blindedRecordFor keeps the names → an evidence record carries cedsId → red
//   (e) WRITE — writeMappingEdge (the real writer, edge properties from materialiser.edgePropertiesFor) writes ONE
//       edge, stamps the pair-scoped label on BOTH endpoints (the harvest MATCH (a:L)-[r]->(b:L) finds it), and the
//       driver's Integer edge count is unwrapped; twin: the object stamp dropped → the harvest finds 0 → red
//   (f) ONE-ELEMENT LIST ROUND TRIP — THE WRITER'S OWN BOLT PATH: graphWriter's `SET r = $map` stores
//       attestationChannelList ['elements:5'] as a LIST of one on the live edge (read back over bolt: an Array of
//       length 1). This proves graphWriter's path ONLY — NOT the replay path that materialises a certified block
//       (see (h)); twin: a writer that unwraps one-element lists before the SET → the read-back is a string → red
//   (g) HARVEST BY LABEL — replayManager.harvest by the pair-scoped label yields a block whose EDGE count EQUALS the
//       edges written and whose harvested attestationChannelList is the one-element list — harvested from the edge
//       THE WRITER wrote in (e)/(f) (BG-HARVEST live); twin = (e)'s (the object stamp dropped → 0 harvested)
//   (h) THE PG-JSON CONTRACT ON THE REPLAY PATH (RULING BR3-2, SABLE_RIVER 2026-08-17): a REPLAYED one-element list
//       property reads back as a SCALAR — the Ed-Fi base block stores the subject node's `role` as ["DmeProperty"]
//       (a list of one, measured off the block); replay-engine's pgToStored collapses it and the live node carries
//       the STRING "DmeProperty". DECLARED THE CONTRACT: the certified artifact holds the list, the graph is its
//       replay under the PG-JSON convention for EVERY list property (attestationChannelList on 575/666 mapping edges,
//       qualifierKeys, crossRefs), and consumers RE-WIDEN at the read boundary — as the framework's own reader does
//       for qualifierKeys (c). twin: the block-side value (an Array of one) fails the graph-side predicate → red;
//       an in-memory pgToStored that keeps one-element lists is NOT the twin (it would re-replay the base: minutes)
//
// DISPENSATION (RULING BR3-7, apps/graph-builder/DOCTRINE.md): this file drives `neo4j-driver` DIRECTLY to read the
// live edge/node back — exactly graphWriter's leaf case — so its `.then().catch()`-to-callback chains at the leaf are
// the named leaf dispensation, GRANTED for this file by name; no conversion, no `async`/`await`.
//
// Run: node apps/graph-builder/test/test-bgBoltLive.js   (from system/code/educoreForge; </dev/null in the fleet)

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- BG-BOLT-LIVE: the framework's bolt reader/writer against a REAL Neo4j (one DEV_ container)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Provisions ONE DEV_ Neo4j container, restores the CEDS hub-bearing base + the Ed-Fi base from the pinned B3
     acceptance store (read-only), proves paging past 5,000 nodes, neo4j Integer unwrapping, hub-card re-widening,
     blinding on the wire, the writer's both-endpoint stamp, the one-element-list round trip ON THE WRITER'S OWN
     PATH, the harvest by label, and (h) the PG-JSON contract on the REPLAY path (a replayed one-element list reads
     back as a scalar — RULING BR3-2) — every conjunct observed RED under an in-memory production mutation or an
     input fault — then destroys the container.
     ONE-MACHINE and BUILD-CLASS: refuses by name without Docker or the pinned store. No LLM, no Voyage.

EXIT STATUS
     0 all assertions passed;  1 at least one failed, or a precondition refused by name.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const treeRoot = path.join(__dirname, '..', '..', '..');
const frameworkDir = path.join(treeRoot, 'lib', 'bridge-framework');
const graphReaderPath = path.join(frameworkDir, 'graphReader.js');
const graphWriterPath = path.join(frameworkDir, 'graphWriter.js');
const graphSeamRulesPath = path.join(frameworkDir, 'graphSeamRules.js');

const PINNED_STORE_PATH = path.join(treeRoot, '..', '..', 'dataStores', 'bridgeAcceptance', 'edfi', 'edfiBridge.standardsDatabase.sqlite3');
const CEDS_BASE_REF_ID = '09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9eacec765962fe487c33';
const EDFI_BASE_REF_ID = 'aea6d8dfe7899adef57c5ac3adb6b0df2bfc7e4a4ae859c4fa3893c132c8b304';
const EDFI_NODE_COUNT = 6336; // [measured] the Ed-Fi base block, harvested 2026-08-16 07:09 (> PAGE_SIZE 5000)
const HUB_PROPERTY_CARD_COUNT = 2777; // [measured] RULINGS row 17
const QUALIFIED_KEY = 'P001572'; // 8 cards, 7 qualified by identifier type + 1 bare [measured]
const SOURCE_STANDARD_NAME = 'EdFi';
const APPLY_LABEL = 'BridgedRelation_EDFI_CEDS_BOLTLIVE';
const BLINDING_DECLARATION = ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName', 'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'];
const DEPENDENCY_STANDARD_NAME_LIST = ['CEDS', 'EdFi'];

const graphReaderLib = require(graphReaderPath);
const graphWriterLib = require(graphWriterPath);
const materialiserLib = require(path.join(frameworkDir, 'materialiser'));
const moduleDouble = require(path.join(treeRoot, 'lib', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const replayBlockLib = require(path.join(treeRoot, 'lib', 'replay', 'replay-block'))();
const standardsDatabaseModule = require(path.join(treeRoot, 'lib', 'standards-database', 'standards-database'));
const replayManagerModule = require(path.join(__dirname, '..', 'apps', 'replay-manager'));
const buildLib = require(path.join(__dirname, '..', 'lib', 'build'))();

// ---------------------------------------------------------------------
// preconditions — refused BY NAME, never skipped
// ---------------------------------------------------------------------
harness.section('SECTION 0 — preconditions (Docker, the pinned store) — refused by name, never skipped');
let dockerPresent = false;
let dockerFault = '';
const probeDocker = () => {
	execFileSync('docker', ['ps', '--format', '{{.Names}}'], { stdio: ['ignore', 'pipe', 'pipe'] });
	dockerPresent = true;
};
try {
	probeDocker();
} catch (probeError) {
	dockerFault = probeError.message;
}
harness.ok('docker answers `docker ps` (BUILD-class gate; ONE-MACHINE)', dockerPresent, dockerFault);
harness.ok(`the pinned B3 acceptance store is on disk: ${PINNED_STORE_PATH}`, fs.existsSync(PINNED_STORE_PATH), 'absent — this gate reads GOLD_EVAL_260816\'s bytes from the B3 store and cannot be measured without it');
if (!dockerPresent || !fs.existsSync(PINNED_STORE_PATH)) {
	harness.note('precondition REFUSED — every conjunct below is UNMEASURED and the suite fails by name');
	harness.report();
	return;
}

// ---------------------------------------------------------------------
// the live graph — create, restore the two bases, run, destroy
// ---------------------------------------------------------------------
const replayManager = replayManagerModule();
let graphHandle = null;
let edfiBaseBlockText = null; // the pinned Ed-Fi base block's text — (h) reads the block-side value off it
const disposeAndReport = () => {
	if (!graphHandle) {
		harness.report();
		return;
	}
	replayManager.delete(graphHandle, (deleteError) => {
		harness.ok(`the DEV_ container ${graphHandle.containerName} is DESTROYED after the gate`, !deleteError, deleteError);
		harness.report();
	});
};
process.on('uncaughtException', (fatal) => {
	harness.ok(`no uncaught exception (${fatal.message})`, false, fatal.stack);
	disposeAndReport();
});

const inGraphFor = (handle) => ({ boltUrl: handle.boltUrl, user: handle.user, password: handle.password, containerName: handle.containerName, graphName: handle.graphName });

standardsDatabaseModule().open({ databaseFilePath: PINNED_STORE_PATH }, (openError, standardsDatabase) => {
	harness.ok('the pinned store opens', !openError, openError);
	if (openError) {
		harness.report();
		return;
	}
	standardsDatabase.getBlock({ refId: CEDS_BASE_REF_ID }, (cedsError, cedsRow) => {
		harness.ok('the CEDS hub-bearing base block reads (content address verified by the store)', !cedsError && cedsRow, cedsError);
		standardsDatabase.getBlock({ refId: EDFI_BASE_REF_ID }, (edfiError, edfiRow) => {
			harness.ok('the Ed-Fi base block reads', !edfiError && edfiRow, edfiError);
			if (!cedsRow || !edfiRow) {
				harness.report();
				return;
			}
			replayManager.create({ purpose: 'bgBoltLive' }, (createError, handle) => {
				harness.ok('ONE DEV_ container provisioned', !createError && handle && /^DEV_/.test(handle.graphName), createError);
				if (createError) {
					harness.report();
					return;
				}
				graphHandle = handle;
				harness.note(`live graph ${handle.containerName} at ${handle.boltUrl} — restoring the two bases (minutes)`);
				const storeResolver = buildLib.makeVectorStoreResolver({ supportStoreFilePath: PINNED_STORE_PATH });
				edfiBaseBlockText = edfiRow.text;
				replayManager.init({ inGraph: handle, schemaBlocks: [cedsRow.text, edfiRow.text], storeResolver }, (initError, initReport) => {
					harness.ok('both bases restored into the live graph', !initError, initError);
					if (initError) {
						disposeAndReport();
						return;
					}
					harness.note(`restored: ${JSON.stringify({ nodesMerged: initReport && initReport.nodesMerged, edgesMerged: initReport && initReport.edgesMerged })}`);
					runConjuncts({ handle });
				});
			});
		});
	});
});

// ---------------------------------------------------------------------
// the conjuncts
// ---------------------------------------------------------------------
const readerFor = ({ handle, readerLib }) => readerLib.graphReaderFactory({ inGraph: inGraphFor(handle), dependencyStandardNameList: DEPENDENCY_STANDARD_NAME_LIST, sourceStandardName: SOURCE_STANDARD_NAME, blindingDeclaration: BLINDING_DECLARATION });

// a twin whose mutation cannot be applied (find-text drift) is reported BY NAME as a failed assertion and yields the
// REAL module so the run continues (the conjunct then fails honestly rather than the suite dying mid-callback)
const mutatedLibOrReal = ({ modulePath, mutationList, realLib, twinLabel }) => {
	let loaded = null;
	let refusal = null;
	const attempt = () => {
		loaded = moduleDouble.loadWithMutations({ modulePath, mutationList });
	};
	try {
		attempt();
	} catch (mutationError) {
		refusal = mutationError.message;
	}
	if (refusal !== null) {
		harness.ok(`twin '${twinLabel}' could be applied (mutation find-text matched once)`, false, refusal);
		return realLib;
	}
	return loaded;
};
const mutatedReaderLib = (mutationList, twinLabel) => mutatedLibOrReal({ modulePath: graphReaderPath, mutationList, realLib: graphReaderLib, twinLabel: twinLabel || 'reader' });
const mutatedWriterLib = (mutationList, twinLabel) => mutatedLibOrReal({ modulePath: graphWriterPath, mutationList, realLib: graphWriterLib, twinLabel: twinLabel || 'writer' });

const runConjuncts = ({ handle }) => {
	harness.section('(a) PAGING past PAGE_SIZE + (b) INTEGER UNWRAP — readSubjectNodes over the Ed-Fi source');
	const realReader = readerFor({ handle, readerLib: graphReaderLib });
	realReader.readSubjectNodes((subjectError, subjectNodeList) => {
		harness.ok('readSubjectNodes returns', !subjectError, subjectError);
		harness.equal(`(a) EVERY Ed-Fi node returned — ${EDFI_NODE_COUNT} > PAGE_SIZE 5000: the multi-page loop and the short-page stop ran past page 1`, subjectNodeList && subjectNodeList.length, EDFI_NODE_COUNT);
		const depthTypeSet = new Set((subjectNodeList || []).map((oneNode) => typeof oneNode.properties.depth));
		harness.ok(`    every record's depth reads as a JS NUMBER through the reader (types seen: ${Array.from(depthTypeSet).join(', ')})`, depthTypeSet.size === 1 && depthTypeSet.has('number'), Array.from(depthTypeSet).join(', '));
		harness.note('(b) MEASURED: node properties in a replayed graph are Neo4j FLOATS (replay-engine sends JS numbers → Float64), so unwrapValue\'s Integer branch is not reachable on node reads here; the framework meets a live driver Integer on the WRITER\'s count(r) — proven in (e) with its own red twin');
		harness.ok('    the sorted read is by stableId (first < last)', subjectNodeList && subjectNodeList.length > 1 && String(subjectNodeList[0].stableId) < String(subjectNodeList[subjectNodeList.length - 1].stableId));

		// (a) RED: the short-page stop fires on page 1
		const pagingTwin = readerFor({ handle, readerLib: mutatedReaderLib([{ modulePath: graphReaderPath, find: 'if (result.records.length < PAGE_SIZE) {', replace: 'if (result.records.length <= PAGE_SIZE) {' }]) });
		pagingTwin.readSubjectNodes((twinError, twinList) => {
			harness.ok(`(a) RED-OBSERVED — with the short-page stop firing on a FULL page the read returns ${twinList ? twinList.length : 'error'} ≠ ${EDFI_NODE_COUNT}`, !twinError && twinList && twinList.length !== EDFI_NODE_COUNT, twinError);
			pagingTwin.close(() => hubCardConjunct({ handle, realReader }));
		});
	});
};

const hubCardConjunct = ({ handle, realReader }) => {
	harness.section('(c) HUB CARDS on the wire — 2,777 property cards; qualifierKeys RE-WIDENED to a list (RULING P8)');
	realReader.readHubCards({ referenceTier: 'property' }, (cardError, cardList) => {
		harness.ok('readHubCards returns', !cardError, cardError);
		harness.equal(`(c) ${HUB_PROPERTY_CARD_COUNT} property-tier cards read`, cardList && cardList.length, HUB_PROPERTY_CARD_COUNT);
		const qualifiedList = (cardList || []).filter((oneCard) => oneCard.canonicalKey === QUALIFIED_KEY);
		harness.equal(`    ${QUALIFIED_KEY} carries 8 cards (7 qualified + 1 bare)`, qualifiedList.length, 8);
		const listShaped = qualifiedList.filter((oneCard) => Array.isArray(oneCard.qualifierKeys));
		harness.equal('    every one of them carries qualifierKeys as an ARRAY (the golden stores a one-element list as a scalar; the reader re-widens)', listShaped.length, qualifiedList.length);
		harness.equal('    seven carry exactly ONE qualifier', qualifiedList.filter((oneCard) => Array.isArray(oneCard.qualifierKeys) && oneCard.qualifierKeys.length === 1).length, 7);
		// (c) RED: the re-widen at the read boundary skipped (graphSeamRules is a RELATIVE sibling of the reader — compiled through the double)
		const widenTwin = readerFor({ handle, readerLib: mutatedReaderLib([{ modulePath: graphSeamRulesPath, find: "			widened[oneSlot] = widened[oneSlot] === '' ? [] : [widened[oneSlot]];", replace: '			widened[oneSlot] = widened[oneSlot];' }]) });
		widenTwin.readHubCards({ referenceTier: 'property' }, (twinError, twinCards) => {
			const twinQualified = (twinCards || []).filter((oneCard) => oneCard.canonicalKey === QUALIFIED_KEY);
			const stringShaped = twinQualified.filter((oneCard) => typeof oneCard.qualifierKeys === 'string');
			harness.ok(`(c) RED-OBSERVED — with the re-widen skipped ${stringShaped.length} qualified cards carry qualifierKeys as a STRING`, (twinError && /qualifierKeys/.test(twinError)) || stringShaped.length > 0, twinError || 'no string-shaped card seen');
			widenTwin.close(() => blindingConjunct({ handle, realReader }));
		});
	});
};

const blindingConjunct = ({ handle, realReader }) => {
	harness.section('(d) BLINDING on the wire — forEvidence() carries no blinded name; forWalk() refuses a blinded read by name');
	realReader.forEvidence().readSourceNodes({ roleList: ['DmeProperty'] }, (evidenceError, evidenceList) => {
		harness.ok('forEvidence().readSourceNodes returns', !evidenceError, evidenceError);
		const leaked = (evidenceList || []).filter((oneRecord) => BLINDING_DECLARATION.some((oneName) => Object.prototype.hasOwnProperty.call(oneRecord.properties, oneName)));
		harness.equal(`(d) ZERO of ${evidenceList ? evidenceList.length : 0} evidence records carry a blinded name (495 properties carry cedsId in the graph)`, leaked.length, 0);
		realReader.forWalk({ channelPropertyList: [] }).readSourceNodes({ roleList: ['DmeProperty'] }, (walkError, walkList) => {
			harness.ok('forWalk({ channelPropertyList: [] }).readSourceNodes returns', !walkError, walkError);
			let walkRefusal = null;
			const readCedsIdOnEveryRecord = () => {
				(walkList || []).forEach((oneRecord) => {
					void oneRecord.properties.cedsId;
				});
			};
			try {
				readCedsIdOnEveryRecord();
			} catch (refusalError) {
				walkRefusal = refusalError.message;
			}
			harness.match('    a walk reading cedsId (undeclared) is REFUSED BY NAME on the wire', walkRefusal || '', /blinded property 'cedsId'/);
			// (d) RED: blindedRecordFor keeps the names
			const blindTwin = readerFor({ handle, readerLib: mutatedReaderLib([{ modulePath: graphSeamRulesPath, find: "	blindingDeclaration.forEach((oneName) => {\n\t\tdelete properties[oneName];\n\t});\n\treturn { stableId: record.stableId, labels: record.labels.slice(), properties };", replace: "	return { stableId: record.stableId, labels: record.labels.slice(), properties };" }]) });
			blindTwin.forEvidence().readSourceNodes({ roleList: ['DmeProperty'] }, (twinError, twinList) => {
				const twinLeaked = (twinList || []).filter((oneRecord) => Object.prototype.hasOwnProperty.call(oneRecord.properties, 'cedsId'));
				harness.ok(`(d) RED-OBSERVED — with the blinding kept ${twinLeaked.length} evidence records carry cedsId`, !twinError && twinLeaked.length > 0, twinError);
				// the write's SUBJECT: a REAL Ed-Fi property node read off the wire (the sorted read's first DmeProperty), never a
				// composed guess — attempt 2 composed 'domainEntity.Student.BirthDate', which is not a node, and the writer rightly refused it
				blindTwin.close(() => writeConjuncts({ handle, realReader, subjectStableId: (walkList || [])[0] }));
			});
		});
	});
};

const edgePropertiesFor = ({ subjectStableId, objectStableId, attestationChannelList }) =>
	materialiserLib.edgePropertiesFor({
		record: { subjectStableId, objectStableId, predicate: 'exactMatch', resolution: 'specified', predicateAssertedBy: 'labelTable', attestationChannelList, sourceLabel: 'Yes' },
		block: { header: { matchBasis: 'crosswalk', producerKind: 'authored' } },
		decisionBlockHash: 'f'.repeat(64),
		sourceStandardName: SOURCE_STANDARD_NAME,
		sourceVersion: '5.2.0',
		hubName: 'CEDS',
		hubVersion: '14.0.0.0',
		mappingProviderUrl: 'https://ceds.ed.gov/',
		subjectMatchField: 'edfiCedsCrosswalk:CEDSGlobalId',
		objectMatchField: 'EDUcoreCeds:canonicalKey|domainId',
		debugMark: null,
	});

const writeConjuncts = ({ handle, realReader, subjectStableId }) => {
	harness.section('(e) WRITE + both endpoints stamped; (f) ONE-ELEMENT LIST round trip on the WRITER\'S OWN path; (h) the PG-JSON contract on the REPLAY path; (g) HARVEST by the pair-scoped label');
	const subjectId = subjectStableId ? subjectStableId.stableId : null;
	harness.ok(`the write's subject is a real Ed-Fi property node read off the wire (${subjectId})`, typeof subjectId === 'string' && /^edfi:property\//.test(subjectId));
	realReader.readHubCards({ referenceTier: 'property' }, (cardError, cardList) => {
		const bareP001572 = (cardList || []).find((oneCard) => oneCard.canonicalKey === QUALIFIED_KEY && Array.isArray(oneCard.qualifierKeys) && oneCard.qualifierKeys.length === 0);
		const anotherCard = (cardList || []).find((oneCard) => oneCard.canonicalKey === 'P000204');
		harness.ok('the two object cards for the write are present (bare P001572, P000204)', !!bareP001572 && !!anotherCard, cardError);
		if (!bareP001572 || !anotherCard) {
			realReader.close(() => disposeAndReport());
			return;
		}
		const realWriter = graphWriterLib.graphWriterFactory({ inGraph: inGraphFor(handle), applyLabel: APPLY_LABEL, sourceStandardName: SOURCE_STANDARD_NAME });
		const attestationChannelList = ['elements:5'];
		realWriter.writeMappingEdge({ subjectStableId: subjectId, objectStableId: bareP001572.stableId, edgeType: 'EXACT_MATCH', edgeProperties: edgePropertiesFor({ subjectStableId: subjectId, objectStableId: bareP001572.stableId, attestationChannelList }) }, (writeError, written) => {
			harness.ok(`(e) the REAL writer writes ${subjectId} -[EXACT_MATCH]-> ${QUALIFIED_KEY} (the driver's Integer edge count unwrapped to 1)`, !writeError && written && written.edgeWritten === true, writeError);
			// read the live edge back over bolt: both endpoint labels, and the list property's SHAPE
			const neo4j = require('neo4j-driver');
			const driver = neo4j.driver(handle.boltUrl, neo4j.auth.basic(handle.user, handle.password), { encrypted: false });
			const session = driver.session();
			session
				.run(`MATCH (s {stableId: $subjectId})-[r:EXACT_MATCH]->(o {stableId: $objectId}) RETURN labels(s) AS sLabels, labels(o) AS oLabels, r.attestationChannelList AS acl, r.provenanceTier AS tier, s.role AS replayedRole`, { subjectId, objectId: bareP001572.stableId })
				.then((result) => {
					const row = result.records[0];
					harness.ok('    the edge exists on the live graph', !!row);
					harness.ok(`(e) the pair-scoped label is stamped on BOTH endpoints (${APPLY_LABEL})`, row && row.get('sLabels').indexOf(APPLY_LABEL) !== -1 && row.get('oLabels').indexOf(APPLY_LABEL) !== -1, row ? `${row.get('sLabels')} / ${row.get('oLabels')}` : 'no row');
					const acl = row && row.get('acl');
					harness.ok(`(f) attestationChannelList round-trips as a LIST of one on the live edge — THE WRITER'S OWN BOLT PATH (graphWriter \`SET r = $map\`), NOT the replay path (see (h)) (got ${JSON.stringify(acl)})`, Array.isArray(acl) && acl.length === 1 && acl[0] === 'elements:5', JSON.stringify(acl));
					harness.equal('    provenanceTier is the engine-level authored value', row && row.get('tier'), 'spec-authoritative');
					// (h) RULING BR3-2 — the PG-JSON contract on the REPLAY path: the block stores the subject's `role` as a
					// one-element LIST; the replayed node carries the SCALAR. Block-side value read off the pinned block itself.
					const blockSideNode = replayBlockLib.deserializeBlock(typeof edfiBaseBlockText === 'string' ? edfiBaseBlockText : edfiBaseBlockText.toString('utf8')).nodes.find((oneNode) => oneNode.stableId === subjectId);
					const blockSideRole = blockSideNode ? blockSideNode.properties.role : undefined;
					const replayedRole = row && row.get('replayedRole');
					const readsBackAsScalar = (value) => typeof value === 'string';
					harness.ok(`(h) the block stores the subject's role as a ONE-ELEMENT LIST (got ${JSON.stringify(blockSideRole)}) — the input to the replay path`, Array.isArray(blockSideRole) && blockSideRole.length === 1, JSON.stringify(blockSideRole));
					harness.ok(`(h) the REPLAYED node reads that property back as a SCALAR — replay-engine's pgToStored, the PG-JSON contract DECLARED by RULING BR3-2 (got ${JSON.stringify(replayedRole)}); consumers re-widen at the read boundary`, readsBackAsScalar(replayedRole) && Array.isArray(blockSideRole) && replayedRole === blockSideRole[0], JSON.stringify(replayedRole));
					harness.ok('(h) RED-OBSERVED — the block-side value (an Array of one) FAILS the graph-side scalar predicate: the divergence is real and the predicate discriminates', !readsBackAsScalar(blockSideRole));
					return session.close();
				})
				.then(() => {
					// (b) RED: the writer's isInt branch dropped → the driver's live Integer count never === 1 → the write REFUSES
					const integerTwinLib = mutatedWriterLib([{ modulePath: graphWriterPath, find: 'const wroteOne = neo4j.isInt(edgeCount) ? edgeCount.toNumber() === 1 : edgeCount === 1;', replace: 'const wroteOne = edgeCount === 1;' }], 'writer isInt dropped');
					const integerTwin = integerTwinLib.graphWriterFactory({ inGraph: inGraphFor(handle), applyLabel: `${APPLY_LABEL}_BTWIN`, sourceStandardName: SOURCE_STANDARD_NAME });
					integerTwin.writeMappingEdge({ subjectStableId: subjectId, objectStableId: anotherCard.stableId, edgeType: 'CLOSE_MATCH', edgeProperties: { ...edgePropertiesFor({ subjectStableId: subjectId, objectStableId: anotherCard.stableId, attestationChannelList: ['elements:7'] }), predicate: 'closeMatch' } }, (integerTwinError) => {
						harness.match('(b) RED-OBSERVED — with the isInt branch dropped the live Integer count(r) never equals 1 and the writer REFUSES by name', integerTwinError || '', /reported 1 edges, not 1/);
						integerTwin.close(() => {
					// (f) RED: a writer that unwraps one-element lists before the SET (a productionMutation of the writer)
					const unwrapWriterLib = mutatedWriterLib([{ modulePath: graphWriterPath, find: '{ subjectStableId, objectStableId, edgeType, edgeProperties })\n\t\t\t\t\t.then((written) => {', replace: '{ subjectStableId, objectStableId, edgeType, edgeProperties: Object.keys(edgeProperties).reduce((soFar, oneName) => ({ ...soFar, [oneName]: Array.isArray(edgeProperties[oneName]) && edgeProperties[oneName].length === 1 ? edgeProperties[oneName][0] : edgeProperties[oneName] }), {}) })\n\t\t\t\t\t.then((written) => {' }]);
					const unwrapWriter = unwrapWriterLib.graphWriterFactory({ inGraph: inGraphFor(handle), applyLabel: `${APPLY_LABEL}_FTWIN`, sourceStandardName: SOURCE_STANDARD_NAME });
					unwrapWriter.writeMappingEdge({ subjectStableId: subjectId, objectStableId: anotherCard.stableId, edgeType: 'EXACT_MATCH', edgeProperties: edgePropertiesFor({ subjectStableId: subjectId, objectStableId: anotherCard.stableId, attestationChannelList }) }, (twinWriteError) => {
						harness.ok('    (f twin) the unwrapping writer still writes its edge', !twinWriteError, twinWriteError);
						const twinSession = driver.session();
						twinSession
							.run(`MATCH (s {stableId: $subjectId})-[r:EXACT_MATCH]->(o {stableId: $objectId}) RETURN r.attestationChannelList AS acl`, { subjectId, objectId: anotherCard.stableId })
							.then((twinResult) => {
								const twinAcl = twinResult.records[0] && twinResult.records[0].get('acl');
								harness.ok(`(f) RED-OBSERVED — the unwrapping writer stores attestationChannelList as a STRING (got ${JSON.stringify(twinAcl)}), so the LIST shape above is the real writer's doing`, typeof twinAcl === 'string', JSON.stringify(twinAcl));
								return twinSession.close();
							})
							.then(() => unwrapWriter.close(() => harvestConjunct({ handle, realReader, realWriter, driver, subjectId, bareP001572, anotherCard })))
							.catch((twinReadError) => {
								harness.ok(`(f twin) read-back: ${twinReadError.message}`, false);
								twinSession.close().then(() => unwrapWriter.close(() => harvestConjunct({ handle, realReader, realWriter, driver, subjectId, bareP001572, anotherCard })));
							});
					});
						});
					});
				})
				.catch((readError) => {
					harness.ok(`(e) live read-back failed: ${readError.message}`, false);
					session.close().then(() => harvestConjunct({ handle, realReader, realWriter, driver, subjectId, bareP001572, anotherCard }));
				});
		});
	});
};

const harvestConjunct = ({ handle, realReader, realWriter, driver, subjectId, bareP001572, anotherCard }) => {
	const harvestHeader = { blockType: 'relationship', standardKey: 'edfi', pairA: 'edfi', pairB: 'ceds', pairAVersion: '5.2.0', pairBVersion: '14.0.0.0', stableUriPropertyName: 'stableId', resolutionKey: 'stableId', embeddingModelVersion: 'voyage-4-large', embeddingEncoding: 'base64', embeddingDtype: 'float32', embeddingByteOrder: 'little-endian', embeddingDims: 1024 };
	// ⟪JOB 2⟫ This harvests material the BRIDGE WRITER wrote, through lib/bridge-framework/graphWriter
	// and not through replayManager.init, so there is no init-captured loaded set to conserve against
	// and the declared exemption is TRUE here today. JOB 5 makes the bridge write produce a real
	// loadedConservationSummary, and this declaration is replaced by it then.
	replayManager.harvest({ inGraph: handle, selectionLabels: [APPLY_LABEL], header: harvestHeader, conservationExpectation: replayManagerModule.CONSERVATION_NOT_LOADED_THROUGH_INIT }, (harvestError, harvested) => {
		harness.ok('(g) replayManager.harvest by the pair-scoped label returns a block', !harvestError && harvested, harvestError);
		let deserialised = null;
		let codecFault = null;
		const decode = () => {
			deserialised = replayBlockLib.deserializeBlock(typeof harvested === 'string' ? harvested : harvested.blockText || harvested.text);
		};
		try {
			decode();
		} catch (decodeError) {
			codecFault = decodeError.message;
		}
		harness.ok('    the harvested block deserialises', codecFault === null, codecFault);
		const mappingEdgeList = deserialised ? deserialised.edges.filter((oneEdge) => oneEdge.type === 'EXACT_MATCH') : [];
		harness.equal('(g) the harvested block carries EXACTLY the ONE edge the real writer wrote under this label (BG-HARVEST live: edgeCount === edgesWritten)', mappingEdgeList.length, 1);
		const harvestedAcl = mappingEdgeList[0] && mappingEdgeList[0].properties.attestationChannelList;
		harness.ok(`(g) the harvested attestationChannelList is the one-element list — harvested from the edge THE WRITER wrote in (f) (a REPLAYED edge would carry the scalar: (h)) (got ${JSON.stringify(harvestedAcl)})`, Array.isArray(harvestedAcl) && harvestedAcl.length === 1 && harvestedAcl[0] === 'elements:5', JSON.stringify(harvestedAcl));
		harness.equal('    both endpoint NODES ride in the harvested block (RULING BF3)', deserialised ? deserialised.nodes.length : -1, 2);

		// (e)/(g) RED: a writer that stamps ONLY the subject endpoint → the harvest MATCH (a:L)-[r]->(b:L) finds nothing
		const stampTwinLib = mutatedWriterLib([{ modulePath: graphWriterPath, find: 'SET s:\\`${applyLabel}\\`, o:\\`${applyLabel}\\` WITH', replace: 'SET s:\\`${applyLabel}\\` WITH' }]);
		const stampTwinLabel = `${APPLY_LABEL}_ETWIN`;
		const stampTwin = stampTwinLib.graphWriterFactory({ inGraph: inGraphFor(handle), applyLabel: stampTwinLabel, sourceStandardName: SOURCE_STANDARD_NAME });
		stampTwin.writeMappingEdge({ subjectStableId: subjectId, objectStableId: bareP001572.stableId, edgeType: 'CLOSE_MATCH', edgeProperties: { ...edgePropertiesFor({ subjectStableId: subjectId, objectStableId: bareP001572.stableId, attestationChannelList: ['elements:6'] }), predicate: 'closeMatch' } }, (twinWriteError) => {
			harness.ok('    (e twin) the subject-only-stamping writer still writes its edge', !twinWriteError, twinWriteError);
			replayManager.harvest({ inGraph: handle, selectionLabels: [stampTwinLabel], header: harvestHeader, conservationExpectation: replayManagerModule.CONSERVATION_NOT_LOADED_THROUGH_INIT }, (twinHarvestError, twinHarvested) => {
				let twinEdgeCount = -1;
				let twinFault = null;
				const decodeTwin = () => {
					twinEdgeCount = replayBlockLib.deserializeBlock(typeof twinHarvested === 'string' ? twinHarvested : twinHarvested.blockText || twinHarvested.text).edges.filter((oneEdge) => oneEdge.type === 'CLOSE_MATCH').length;
				};
				if (!twinHarvestError && twinHarvested) {
					try {
						decodeTwin();
					} catch (decodeError) {
						twinFault = decodeError.message;
					}
				}
				harness.ok(`(e)/(g) RED-OBSERVED — with the OBJECT stamp dropped the harvest by label finds ${twinEdgeCount} mapping edge(s), not 1 (or refuses an empty harvest: ${twinHarvestError ? 'refused' : 'no'})`, (twinHarvestError && /empty|no nodes|0/.test(String(twinHarvestError))) || twinEdgeCount === 0, twinHarvestError || twinFault || `edges ${twinEdgeCount}`);
				stampTwin.close(() => realWriter.close(() => realReader.close(() => driver.close().then(() => disposeAndReport()))));
			});
		});
	});
};
