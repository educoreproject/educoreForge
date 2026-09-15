#!/usr/bin/env node
'use strict';

// test-gVecProp.js — G-VECPROP, the gate for the loader's vector-slot declaration and its second vector index
// (PLAN-forgeEmbedText-091426 §4 P4, §8.1 R-ET-8, §8.3 R-ET-8 revised, §8.4 R-ET-27 and R-ET-30;
// BRIEF-P4-loaderSidecar G-VECPROP a-f).
//
// A DmeEmbedText node keeps its vector under `textEmbedding`, declared by the ordinary property
// vectorPropertyName beside embedSourceProperty 'text', so the DME's search, which reads only the
// ForgedNode(embedding) index, never sees a text. Inside the engine the vector rides in the record's ONE slot;
// the declaration decides where harvest READS it and where restore LANDS it. This suite locks:
//   a  LEGACY BYTE IDENTITY. Real excerpts of the pinned CEDS (09a5d658807b) and SIF (d393b0406d08) base blocks
//      round-trip byte-identical through the codec AND through restore -> harvest.
//   b  THE TEXT NODE through the forger's shaper, the init row, harvest, restore and re-harvest; both harvest
//      branches (sidecar and store-less inline); the dimension guard; both vector slots refused by name.
//   c  a text node's ref ABSENT from the store is refused by name.
//   d  the declaration refusals, at every door that reads a declaration.
//   e  the index DDL, through writeShapedGraph over a RECORDING session (R-ET-27): exactly two vector indexes,
//      both recorded as skipped on an old kernel, and no written text row carries `embedding`.
//   f  the DME's vector-index resolver, reproduced from educore dataModelExplorerSearch.js:159-180, selects
//      exactly one index from the SHOW INDEXES rows those statements produce.
// The LIVE halves of e and f (a real SHOW INDEXES, count of DmeEmbedText nodes with `embedding`, the resolver
// on a real graph) are P7's.
//
// FIXTURE PROVENANCE: fixtures/gVecProp/cedsBase-09a5d658807b-excerpt.jsonl is the header plus lines 25204 (a
// hub card declaring embedSourceProperty), 6 (an ordinary ref node), 2 (a vectorless node) and 119807 (an
// edge) of block 09a5d658807b in dataStores/bridgeAcceptance/sif/sifBridge.standardsDatabase.sqlite3;
// sifBase-d393b0406d08-excerpt.jsonl is the header plus lines 2, 3 and 27071 of block d393b0406d08 in the
// same store. Extracted 2026-09-14 (AMBER_RIDGE). The full blocks' identity is scratch evidence in the DEVLOG.
//
// RED TWINS: every conjunct is observed RED under an in-memory module double
// (lib/forge-framework/test/testSupport/moduleDouble.js); no file is written. Hermetic: no docker, no Neo4j,
// no network, no Voyage. The vector store is the REAL module on scratch databases under os.tmpdir.
//
// Run: node lib/replay/test/test-gVecProp.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- G-VECPROP: vector-slot declaration, sidecar round trip, second vector index
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Locks legacy block byte identity (codec and restore->harvest) on real excerpts, the text node's single
     vector slot from the forger's shaper through restore and re-harvest, the declaration refusals, the two
     vector-index statements over a recording session, and the DME resolver choosing exactly one index.
     Every conjunct is observed RED under an in-memory module double. Hermetic.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const harness = require('../../../test/testLib/harness')(moduleName);
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const contentAddress = require('../../content-address/content-address')();
const vectorStoreModule = require('../../vector-store/vector-store');

const ENGINE_PATH = path.join(__dirname, '..', 'replay-engine.js');
const BLOCK_PATH = path.join(__dirname, '..', 'replay-block.js');
const SHAPER_PATH = path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'forger', 'lib', 'shape-forged-graph.js');
const FIXTURE_DIRECTORY_PATH = path.join(__dirname, 'fixtures', 'gVecProp');

const LEGACY_EXCERPT_LIST = [
	{
		excerptName: 'cedsBase-09a5d658807b',
		fileName: 'cedsBase-09a5d658807b-excerpt.jsonl',
		excerptSha256: '0ad4637d341a523378ed579d8a8d16ec23891f8acf45dfff3ed14260cf6ba7a2',
	},
	{
		excerptName: 'sifBase-d393b0406d08',
		fileName: 'sifBase-d393b0406d08-excerpt.jsonl',
		excerptSha256: '23411f3894b41a2d96a8f748fea11876e608cf6041ce34aad67823e1c2099ca7',
	},
];

// the ruled names (PLAN §8.3 R-ET-8, R-ET-24), stated independently of the modules they check
const GRAPH_NAME = 'DEV_gVecProp';
const ORDINARY_INDEX_NAME = 'DEV_gVecProp_vector';
const EMBED_TEXT_INDEX_NAME = 'DEV_gVecProp_embedText_vector';

const MODEL_VERSION = 'voyage-test-model';
const VECTOR_DIMS = 8;
const SOURCE_LABEL = 'G-VECPROP fixture';

const sha256Of = (text) => crypto.createHash('sha256').update(text).digest('hex');
// values chosen NOT float32-exact, so the shaper's narrowing is observable in what init writes
const vectorFor = (seed, dims) => Array.from({ length: dims }, (unused, i) => 0.1 * (i + seed));
const narrowed = (floatList) => floatList.map((oneValue) => Math.fround(oneValue));
const sameNumberList = (leftList, rightList) =>
	Array.isArray(leftList) &&
	Array.isArray(rightList) &&
	leftList.length === rightList.length &&
	leftList.every((oneValue, index) => oneValue === rightList[index]);
const hasOwn = (subjectObject, propertyName) => Object.prototype.hasOwnProperty.call(subjectObject || {}, propertyName);

const TEXT_VALUE = 'A unique number or alphanumeric code assigned to a person.';
const TEXT_STABLE_ID = `https://w3id.org/CEDStandards/terms/embedText/${sha256Of(TEXT_VALUE)}`;
const BASE_STABLE_ID = 'https://w3id.org/CEDStandards/terms/P000001';
const TEXT_VECTOR = vectorFor(1, VECTOR_DIMS);
const BASE_VECTOR = vectorFor(2, VECTOR_DIMS);
const TEXT_LABEL_LIST = ['ForgedNode', 'CedsEmbedText', 'DmeEmbedText'];

const HEADER = {
	blockType: 'standardBase',
	standardKey: 'ceds',
	version: '14.0.0.0',
	stableUriPropertyName: 'uri',
	resolutionKey: 'uri',
	embeddingModelVersion: MODEL_VERSION,
	embeddingEncoding: 'base64',
	embeddingDtype: 'float32',
	embeddingByteOrder: 'little-endian',
	embeddingDims: VECTOR_DIMS,
};

// ---------------------------------------------------------------------------------------------------
// FIXTURE RECORDS — a text node as the forge framework mints and embeds it (R-ET-2, R-ET-8), and the
// property node it describes
// ---------------------------------------------------------------------------------------------------
const textPropertiesOf = (propertyOverrides, omittedPropertyNameList) => {
	const textProperties = {
		_source: 'CEDS',
		uri: TEXT_STABLE_ID,
		role: 'DmeEmbedText',
		text: TEXT_VALUE,
		embedSourceProperty: 'text',
		vectorPropertyName: 'textEmbedding',
		textEmbedding: TEXT_VECTOR,
		embeddingModelVersion: MODEL_VERSION,
		...(propertyOverrides || {}),
	};
	(omittedPropertyNameList || []).forEach((onePropertyName) => delete textProperties[onePropertyName]);
	return textProperties;
};

// the forge record (scalars; the vector inside properties)
const forgedTextNode = (propertyOverrides, omittedPropertyNameList) => ({
	stableId: TEXT_STABLE_ID,
	labels: TEXT_LABEL_LIST,
	properties: textPropertiesOf(propertyOverrides, omittedPropertyNameList),
});

// a graph node as harvest reads it (stored scalars; the vector under its property)
const graphTextNode = (propertyOverrides, omittedPropertyNameList) => ({
	labels: TEXT_LABEL_LIST,
	properties: textPropertiesOf(propertyOverrides, omittedPropertyNameList),
});

// an engine-shaped record (PG-JSON arrays; the vector in the slot), built by hand so the guard is tested
// independently of the shaper
const engineTextRecord = (propertyOverrides, omittedPropertyNameList) => {
	const textProperties = textPropertiesOf(propertyOverrides, omittedPropertyNameList);
	const recordProperties = {};
	Object.keys(textProperties)
		.filter((onePropertyName) => onePropertyName !== 'textEmbedding' || hasOwn(propertyOverrides, 'textEmbedding'))
		.filter((onePropertyName) => onePropertyName !== 'embeddingModelVersion' && onePropertyName !== '_source')
		.forEach((onePropertyName) => {
			recordProperties[onePropertyName] = [textProperties[onePropertyName]];
		});
	return {
		ref: { source: 'CEDS', id: TEXT_STABLE_ID },
		labels: TEXT_LABEL_LIST,
		stableId: TEXT_STABLE_ID,
		properties: recordProperties,
		embedding: narrowed(TEXT_VECTOR),
		embeddingModelVersion: MODEL_VERSION,
	};
};

const forgedBaseNode = () => ({
	stableId: BASE_STABLE_ID,
	labels: ['ForgedNode', 'CedsProperty', 'DmeProperty'],
	properties: {
		_source: 'CEDS',
		uri: BASE_STABLE_ID,
		role: 'DmeProperty',
		name: 'Person Identifier',
		definition: TEXT_VALUE,
		searchText: 'CEDS | Person Identifier',
		embedding: BASE_VECTOR,
		embeddingModelVersion: MODEL_VERSION,
	},
});

const forgedTextEdge = () => ({
	type: 'EMBEDS_TEXT_OF',
	fromRef: { source: 'CEDS', id: TEXT_STABLE_ID },
	toRef: { source: 'CEDS', id: BASE_STABLE_ID },
	properties: { provenanceTier: 'structural', propertyNameList: ['definition'] },
});

// ---------------------------------------------------------------------------------------------------
// SEAMS — contained in ONE place each
// ---------------------------------------------------------------------------------------------------

// shapeNode and buildNodeRow refuse by THROW (the engine's idiom there); the suite needs the message as data.
// The refusalMessageOf precedent in test-embedSourceProperty.js.
const outcomeOf = (throwingFunction) => {
	let thrownMessage = '';
	let returnedValue;
	try {
		returnedValue = throwingFunction();
	} catch (thrownError) {
		thrownMessage = String(thrownError && thrownError.message);
	}
	return { thrownMessage, returnedValue };
};

const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gVecProp-'));
let scratchStoreCount = 0;

// a FRESH real vector store per use, so a twin can never be masked by a vector an earlier run stored.
// The store answers SYNCHRONOUSLY from inside its own error handling, so without a hop every later step of
// this run — including a throw a twin provokes — would execute inside the store's call and come back as a
// store error naming the wrong thing (observed 2026-09-14). Every callback it gives is therefore delivered on
// a fresh stack; the store itself is the real module, unaltered.
const openScratchStore = (done) => {
	scratchStoreCount++;
	const realVectorStore = vectorStoreModule({});
	realVectorStore.init({ dbPath: path.join(scratchRootPath, `store_${process.pid}_${scratchStoreCount}.sqlite3`) }, (initError) =>
		setImmediate(() => {
			if (initError) {
				done(`the scratch vector store did not open: ${initError}`);
				return;
			}
			const vectorStore = {
				putVector: (vectorEntry, putDone) => realVectorStore.putVector(vectorEntry, (putError, putResult) => setImmediate(() => putDone(putError, putResult))),
				getVector: (vectorQuery, getDone) => realVectorStore.getVector(vectorQuery, (getError, record) => setImmediate(() => getDone(getError, record))),
			};
			done('', { vectorStore, storeResolver: (unusedStandardKey, resolverDone) => resolverDone('', vectorStore) });
		}),
	);
};

// the shaper refuses by returning { error }; under a twin it may THROW instead, which is a different fact and
// is reported as one
const shapeFixture = (subject, forgedNodeList) => {
	const shapeOutcome = outcomeOf(() =>
		subject.shaper.shapeForgedGraph({
			forged: { nodes: forgedNodeList, edges: [forgedTextEdge()] },
			declaredEmbeddingDims: VECTOR_DIMS,
		}),
	);
	return shapeOutcome.thrownMessage ? { error: `the shaper THREW: ${shapeOutcome.thrownMessage}` } : shapeOutcome.returnedValue;
};

// what init leaves in the graph, as harvest reads it back: the stored row under the record's labels
const graphNodeDoubleOf = (storedRow, labelList) => ({ labels: labelList, properties: storedRow.props });

// init -> harvest for ONE engine record: the stored row, read back through the graph double, shaped as
// harvest shapes it, its vector put into the store in sidecar mode, serialised.
const harvestLineOf = ({ subject, engineRecord, header, vectorStore, emitEmbeddingRef }, done) => {
	const rowOutcome = outcomeOf(() => subject.replayEngine.buildNodeRow(engineRecord));
	if (rowOutcome.thrownMessage) {
		done(`buildNodeRow refused: ${rowOutcome.thrownMessage}`);
		return;
	}
	const harvestOutcome = outcomeOf(() =>
		subject.replayEngine.shapeNode(graphNodeDoubleOf(rowOutcome.returnedValue, engineRecord.labels), header, emitEmbeddingRef),
	);
	if (harvestOutcome.thrownMessage) {
		done(`shapeNode refused: ${harvestOutcome.thrownMessage}`);
		return;
	}
	const harvestedNode = harvestOutcome.returnedValue;
	subject.replayEngine.putDistinctNodeVectors(
		{ nodes: [harvestedNode], vectorStore: emitEmbeddingRef ? vectorStore : null },
		(putError) => {
			if (putError) {
				done(putError);
				return;
			}
			done('', { storedRow: rowOutcome.returnedValue, harvestedNode, nodeLine: subject.replayBlock.serializeNodeLine(harvestedNode) });
		},
	);
};

// a recording session (R-ET-27): records every statement, answers the kernel probe, resolves the rest empty
const recordingSessionOf = (kernelVersion) => {
	const recordedStatementList = [];
	return {
		recordedStatementList,
		run: (statementText, statementParameters) => {
			recordedStatementList.push({ statementText, statementParameters });
			if (/dbms\.components\(\)/.test(statementText)) {
				return Promise.resolve({ records: [{ get: () => kernelVersion }] });
			}
			return Promise.resolve({ records: [] });
		},
	};
};

const writeThroughRecordingSession = ({ subject, kernelVersion }, done) => {
	const shapedGraph = shapeFixture(subject, [forgedBaseNode(), forgedTextNode()]);
	if (shapedGraph.error) {
		done(`the shaper refused the fixture: ${shapedGraph.error}`);
		return;
	}
	const recordingSession = recordingSessionOf(kernelVersion);
	subject.replayEngine.writeShapedGraph(
		{
			session: recordingSession,
			groups: [{ sourceLabel: SOURCE_LABEL, nodes: shapedGraph.nodes, edges: shapedGraph.edges }],
			embeddingDims: shapedGraph.embeddingDims,
			graphName: GRAPH_NAME,
		},
		// the engine calls back from INSIDE a promise .then; setImmediate moves the rest of this run out of it, so
		// a later throw is not caught by the engine's .catch and reported as a phase-3 failure (observed 2026-09-14)
		(writeError, writeReport) =>
			setImmediate(() => {
				if (writeError) {
					done(`writeShapedGraph refused: ${writeError}`);
					return;
				}
				done('', { recordedStatementList: recordingSession.recordedStatementList, writeReport });
			}),
	);
};

const vectorIndexStatementListOf = (recordedStatementList) =>
	recordedStatementList.map((oneStatement) => oneStatement.statementText).filter((oneText) => /CREATE VECTOR INDEX/.test(oneText));

// SHOW INDEXES rows as Neo4j lists them for the recorded DDL
const showIndexRowListOf = (recordedStatementList) =>
	recordedStatementList
		.map((oneStatement) => /CREATE (VECTOR )?INDEX (\S+) IF NOT EXISTS\s+FOR \(n:(\w+)\) ON \(n\.(\w+)\)/.exec(oneStatement.statementText))
		.filter((oneMatch) => oneMatch !== null)
		.map((oneMatch) => ({
			name: oneMatch[2],
			type: oneMatch[1] ? 'VECTOR' : 'RANGE',
			entityType: 'NODE',
			labelsOrTypes: [oneMatch[3]],
			properties: [oneMatch[4]],
		}));

// REPRODUCED from educore system/code/cli/lib.d/data-model-explorer/dataModelExplorerSearch.js:159-180
// (resolveVectorIndex, read 2026-09-14): the SHOW INDEXES read replaced by rows, the throws returned as data.
// A read-only reproduction; nothing in educore is edited.
const dmeResolveVectorIndexOf = (showIndexRowList) => {
	const candidates = showIndexRowList
		.map((row) => ({
			name: row.name,
			type: row.type,
			entityType: row.entityType,
			labels: row.labelsOrTypes || [],
			properties: row.properties || [],
		}))
		.filter(
			(row) =>
				row.type === 'VECTOR' && row.entityType === 'NODE' && row.labels.includes('ForgedNode') && row.properties.includes('embedding'),
		);
	if (candidates.length === 0) {
		return { error: 'No VECTOR index on :ForgedNode(embedding) exists on this graph — vector search cannot run.' };
	}
	if (candidates.length > 1) {
		return { error: `Ambiguous VECTOR indexes on :ForgedNode(embedding): ${candidates.map((row) => row.name).join(', ')} — cannot choose safely.` };
	}
	return { error: '', indexName: candidates[0].name };
};

const verdictOf = (checkList) => {
	const failingCheckList = checkList.filter((oneCheck) => !oneCheck.pass);
	return {
		pass: failingCheckList.length === 0,
		detail:
			failingCheckList.length === 0
				? checkList.map((oneCheck) => oneCheck.checkName).join('; ')
				: failingCheckList.map((oneCheck) => `${oneCheck.checkName}: ${oneCheck.detail}`).join(' | '),
	};
};
const failedVerdict = (detail) => ({ pass: false, detail });

const firstDifferenceOf = (leftText, rightText) => {
	const leftLineList = `${leftText}`.split('\n');
	const rightLineList = `${rightText}`.split('\n');
	const lineIndex = leftLineList.findIndex((oneLine, index) => oneLine !== rightLineList[index]);
	return lineIndex === -1
		? `line counts ${leftLineList.length} vs ${rightLineList.length}`
		: `line ${lineIndex + 1}: ${`${leftLineList[lineIndex]}`.slice(0, 160)} VS ${`${rightLineList[lineIndex]}`.slice(0, 160)}`;
};

// ---------------------------------------------------------------------------------------------------
// THE CONJUNCTS — judges over a subject { replayEngine, replayBlock, shaper } (real, or doubled)
// ---------------------------------------------------------------------------------------------------
const conjunctJudgeByRefId = {
	// a — LEGACY: the codec
	a1_legacyExcerptCodecRoundTripIsByteIdentical: (subject, done) => {
		const checkList = [];
		LEGACY_EXCERPT_LIST.forEach((oneExcerpt) => {
			const excerptText = fs.readFileSync(path.join(FIXTURE_DIRECTORY_PATH, oneExcerpt.fileName), 'utf8');
			checkList.push({
				checkName: `${oneExcerpt.excerptName} is the recorded excerpt`,
				pass: sha256Of(excerptText) === oneExcerpt.excerptSha256,
				detail: sha256Of(excerptText),
			});
			const roundTrip = outcomeOf(() => subject.replayBlock.serializeBlock(subject.replayBlock.deserializeBlock(excerptText)));
			checkList.push({
				checkName: `${oneExcerpt.excerptName} codec round trip is byte-identical`,
				pass: roundTrip.thrownMessage === '' && roundTrip.returnedValue === excerptText,
				detail: roundTrip.thrownMessage || `sha256 ${sha256Of(roundTrip.returnedValue || '')}; ${firstDifferenceOf(excerptText, roundTrip.returnedValue)}`,
			});
		});
		done(verdictOf(checkList));
	},

	// a — LEGACY: restore -> harvest through the changed engine functions
	a2_legacyExcerptRestoreHarvestIsByteIdentical: (subject, done) => {
		const checkList = [];
		let excerptIndex = 0;
		const nextExcerpt = () => {
			if (excerptIndex >= LEGACY_EXCERPT_LIST.length) {
				done(verdictOf(checkList));
				return;
			}
			const oneExcerpt = LEGACY_EXCERPT_LIST[excerptIndex];
			excerptIndex++;
			const excerptText = fs.readFileSync(path.join(FIXTURE_DIRECTORY_PATH, oneExcerpt.fileName), 'utf8');
			const parsedBlock = subject.replayBlock.deserializeBlock(excerptText);
			openScratchStore((storeError, scratch) => {
				if (storeError) {
					done(failedVerdict(storeError));
					return;
				}
				// seed the store with a vector for every ref, addressed by the SAME input the forge addressed it by
				const seedEntryList = parsedBlock.nodes
					.filter((oneNode) => oneNode.embeddingRef)
					.map((oneNode) => {
						const declaredSourceList = oneNode.properties.embedSourceProperty;
						const inputText = declaredSourceList ? oneNode.properties[declaredSourceList[0]][0] : oneNode.properties.searchText[0];
						return { embeddingRef: oneNode.embeddingRef, modelVersion: parsedBlock.header.embeddingModelVersion, inputText, vector: vectorFor(3, VECTOR_DIMS) };
					});
				seedEntryList.forEach((oneEntry) =>
					checkList.push({
						checkName: `${oneExcerpt.excerptName} ref ${oneEntry.embeddingRef.slice(0, 12)} is the content address of its input`,
						pass: contentAddress.vectorIdForInput(oneEntry.modelVersion, oneEntry.inputText) === oneEntry.embeddingRef,
						detail: oneEntry.inputText.slice(0, 80),
					}),
				);
				let seedIndex = 0;
				const nextSeed = () => {
					if (seedIndex < seedEntryList.length) {
						const oneEntry = seedEntryList[seedIndex];
						seedIndex++;
						scratch.vectorStore.putVector(
							{ modelVersion: oneEntry.modelVersion, inputText: oneEntry.inputText, vector: oneEntry.vector },
							(putError) => {
								if (putError) {
									done(failedVerdict(`seeding the store: ${putError}`));
									return;
								}
								nextSeed();
							},
						);
						return;
					}
					parsedBlock.nodes.forEach((oneNode) => {
						oneNode._standardKey = parsedBlock.header.standardKey;
					});
					subject.replayEngine.resolveNodeVectors(
						{ nodes: parsedBlock.nodes, storeResolver: scratch.storeResolver, header: { embeddingDims: parsedBlock.header.embeddingDims } },
						(resolveError) => {
							if (resolveError) {
								checkList.push({ checkName: `${oneExcerpt.excerptName} resolves`, pass: false, detail: resolveError });
								nextExcerpt();
								return;
							}
							const harvestOutcomeList = parsedBlock.nodes.map((oneNode) =>
								outcomeOf(() =>
									subject.replayEngine.shapeNode(
										graphNodeDoubleOf(subject.replayEngine.buildNodeRow(oneNode), oneNode.labels),
										parsedBlock.header,
										true,
									),
								),
							);
							const refusedOutcome = harvestOutcomeList.find((oneOutcome) => oneOutcome.thrownMessage !== '');
							if (refusedOutcome) {
								checkList.push({ checkName: `${oneExcerpt.excerptName} harvests`, pass: false, detail: refusedOutcome.thrownMessage });
								nextExcerpt();
								return;
							}
							const harvestedNodeList = harvestOutcomeList.map((oneOutcome) => oneOutcome.returnedValue);
							subject.replayEngine.putDistinctNodeVectors({ nodes: harvestedNodeList, vectorStore: scratch.vectorStore }, (putError) => {
								const reharvestedText = subject.replayBlock.serializeBlock({
									header: parsedBlock.header,
									nodes: harvestedNodeList,
									edges: parsedBlock.edges,
								});
								checkList.push({
									checkName: `${oneExcerpt.excerptName} restore -> harvest is byte-identical`,
									pass: !putError && reharvestedText === excerptText,
									detail: putError || `sha256 ${sha256Of(reharvestedText)}; ${firstDifferenceOf(excerptText, reharvestedText)}`,
								});
								nextExcerpt();
							});
						},
					);
				};
				nextSeed();
			});
		};
		nextExcerpt();
	},

	// b — the shaper lifts the text vector into the one slot; init writes it under textEmbedding
	b1_initRowLandsTheTextVectorUnderTextEmbedding: (subject, done) => {
		const shapedGraph = shapeFixture(subject, [forgedBaseNode(), forgedTextNode()]);
		if (shapedGraph.error) {
			done(failedVerdict(`the shaper refused the fixture: ${shapedGraph.error}`));
			return;
		}
		const admission = subject.replayEngine.validateShapedGraph([{ sourceLabel: SOURCE_LABEL, nodes: shapedGraph.nodes, edges: shapedGraph.edges }]);
		const baseRecord = shapedGraph.nodes[0];
		const textRecord = shapedGraph.nodes[1];
		const textRow = outcomeOf(() => subject.replayEngine.buildNodeRow(textRecord));
		const baseRow = outcomeOf(() => subject.replayEngine.buildNodeRow(baseRecord));
		const textRowProperties = (textRow.returnedValue || {}).props || {};
		const baseRowProperties = (baseRow.returnedValue || {}).props || {};
		done(
			verdictOf([
				{ checkName: 'validateShapedGraph admits the shaped text node', pass: admission.error === '', detail: admission.error },
				{
					checkName: 'the shaper lifted the text vector into the one slot, narrowed',
					pass: sameNumberList(textRecord.embedding, narrowed(TEXT_VECTOR)) && !hasOwn(textRecord.properties, 'textEmbedding'),
					detail: `slot ${JSON.stringify(textRecord.embedding)}; properties.textEmbedding ${JSON.stringify(textRecord.properties.textEmbedding)}`,
				},
				{
					checkName: 'the init row carries textEmbedding, float32-narrowed',
					pass: textRow.thrownMessage === '' && sameNumberList(textRowProperties.textEmbedding, narrowed(TEXT_VECTOR)),
					detail: textRow.thrownMessage || JSON.stringify(textRowProperties.textEmbedding),
				},
				{ checkName: 'the init row carries NO embedding on the text node', pass: !hasOwn(textRowProperties, 'embedding'), detail: Object.keys(textRowProperties).join(',') },
				{ checkName: 'the init row carries the ordinary embeddingModelVersion', pass: textRowProperties.embeddingModelVersion === MODEL_VERSION, detail: textRowProperties.embeddingModelVersion },
				{
					checkName: 'the property node still lands under embedding',
					pass: baseRow.thrownMessage === '' && sameNumberList(baseRowProperties.embedding, narrowed(BASE_VECTOR)) && !hasOwn(baseRowProperties, 'textEmbedding'),
					detail: baseRow.thrownMessage || Object.keys(baseRowProperties).join(','),
				},
			]),
		);
	},

	// b — harvest (sidecar branch) writes the ref and never the vector
	b2_harvestLineCarriesTheRefAndNoVector: (subject, done) => {
		const shapedGraph = shapeFixture(subject, [forgedBaseNode(), forgedTextNode()]);
		if (shapedGraph.error) {
			done(failedVerdict(`the shaper refused the fixture: ${shapedGraph.error}`));
			return;
		}
		openScratchStore((storeError, scratch) => {
			if (storeError) {
				done(failedVerdict(storeError));
				return;
			}
			harvestLineOf({ subject, engineRecord: shapedGraph.nodes[1], header: HEADER, vectorStore: scratch.vectorStore, emitEmbeddingRef: true }, (harvestError, harvested) => {
				if (harvestError) {
					done(failedVerdict(harvestError));
					return;
				}
				const parsedLine = JSON.parse(harvested.nodeLine);
				done(
					verdictOf([
						{
							checkName: 'embeddingRef is the content address of the declared text',
							pass: parsedLine.embeddingRef === contentAddress.vectorIdForInput(MODEL_VERSION, TEXT_VALUE),
							detail: parsedLine.embeddingRef,
						},
						{ checkName: 'NO textEmbedding key in properties', pass: !hasOwn(parsedLine.properties, 'textEmbedding'), detail: harvested.nodeLine.slice(0, 300) },
						{ checkName: 'no inline embedding on the line', pass: !hasOwn(parsedLine, 'embedding') && !hasOwn(parsedLine.properties, 'embedding'), detail: harvested.nodeLine.slice(0, 300) },
						{
							checkName: 'the declaration rides as ordinary properties',
							pass: JSON.stringify(parsedLine.properties.vectorPropertyName) === '["textEmbedding"]' && JSON.stringify(parsedLine.properties.embedSourceProperty) === '["text"]',
							detail: JSON.stringify(parsedLine.properties),
						},
						{
							checkName: 'no float array anywhere on the line',
							pass: !/\[-?\d+\.\d+(,-?\d+\.\d+){7}\]/.test(harvested.nodeLine),
							detail: harvested.nodeLine.slice(0, 300),
						},
					]),
				);
			});
		});
	},

	// b — restore lands the stored vector under textEmbedding, and re-harvest is byte-identical
	b3_restoreThenReharvestIsByteIdentical: (subject, done) => {
		const shapedGraph = shapeFixture(subject, [forgedBaseNode(), forgedTextNode()]);
		if (shapedGraph.error) {
			done(failedVerdict(`the shaper refused the fixture: ${shapedGraph.error}`));
			return;
		}
		openScratchStore((storeError, scratch) => {
			if (storeError) {
				done(failedVerdict(storeError));
				return;
			}
			harvestLineOf({ subject, engineRecord: shapedGraph.nodes[1], header: HEADER, vectorStore: scratch.vectorStore, emitEmbeddingRef: true }, (harvestError, harvested) => {
				if (harvestError) {
					done(failedVerdict(harvestError));
					return;
				}
				const parsedBlock = subject.replayBlock.deserializeBlock(subject.replayBlock.serializeBlock({ header: HEADER, nodes: [harvested.harvestedNode], edges: [] }));
				const restoredRecord = parsedBlock.nodes[0];
				restoredRecord._standardKey = HEADER.standardKey;
				subject.replayEngine.resolveNodeVectors({ nodes: [restoredRecord], storeResolver: scratch.storeResolver, header: { embeddingDims: VECTOR_DIMS } }, (resolveError) => {
					if (resolveError) {
						done(failedVerdict(`resolveNodeVectors refused: ${resolveError}`));
						return;
					}
					harvestLineOf({ subject, engineRecord: restoredRecord, header: HEADER, vectorStore: scratch.vectorStore, emitEmbeddingRef: true }, (reharvestError, reharvested) => {
						if (reharvestError) {
							done(failedVerdict(reharvestError));
							return;
						}
						const restoredRowProperties = reharvested.storedRow.props;
						done(
							verdictOf([
								{
									checkName: 'the restored row carries textEmbedding, the stored vector',
									pass: sameNumberList(restoredRowProperties.textEmbedding, narrowed(TEXT_VECTOR)),
									detail: JSON.stringify(restoredRowProperties.textEmbedding),
								},
								{ checkName: 'the restored row carries NO embedding', pass: !hasOwn(restoredRowProperties, 'embedding'), detail: Object.keys(restoredRowProperties).join(',') },
								{
									checkName: 're-harvest is byte-identical to the first harvest',
									pass: reharvested.nodeLine === harvested.nodeLine,
									detail: firstDifferenceOf(harvested.nodeLine, reharvested.nodeLine),
								},
							]),
						);
					});
				});
			});
		});
	},

	// b — R-ET-30: the store-less inline branch reads the same slot
	b4_storeLessHarvestReadsTheSameSlot: (subject, done) => {
		const shapedGraph = shapeFixture(subject, [forgedBaseNode(), forgedTextNode()]);
		if (shapedGraph.error) {
			done(failedVerdict(`the shaper refused the fixture: ${shapedGraph.error}`));
			return;
		}
		harvestLineOf({ subject, engineRecord: shapedGraph.nodes[1], header: HEADER, vectorStore: null, emitEmbeddingRef: false }, (harvestError, harvested) => {
			if (harvestError) {
				done(failedVerdict(harvestError));
				return;
			}
			const parsedLine = JSON.parse(harvested.nodeLine);
			const decoded = outcomeOf(() => subject.replayBlock.decodeEmbedding(parsedLine.embedding, VECTOR_DIMS));
			done(
				verdictOf([
					{
						checkName: 'the inline line carries the text vector as base64 embedding',
						pass: decoded.thrownMessage === '' && sameNumberList(decoded.returnedValue, narrowed(TEXT_VECTOR)),
						detail: decoded.thrownMessage || harvested.nodeLine.slice(0, 300),
					},
					{ checkName: 'and no embeddingRef', pass: !hasOwn(parsedLine, 'embeddingRef'), detail: parsedLine.embeddingRef },
					{ checkName: 'and NO textEmbedding key in properties', pass: !hasOwn(parsedLine.properties, 'textEmbedding'), detail: harvested.nodeLine.slice(0, 300) },
				]),
			);
		});
	},

	// b — text vectors share the dimension guard: another width is refused
	b5_textVectorOfAnotherWidthIsRefused: (subject, done) => {
		const raggedGraph = shapeFixture(subject, [forgedBaseNode(), forgedTextNode({ textEmbedding: vectorFor(1, VECTOR_DIMS / 2) })]);
		done(
			verdictOf([
				{
					checkName: 'a text vector of another width is refused as a ragged set, naming the text node',
					pass: /inconsistent embedding dimensions[\s\S]*embedText/.test(raggedGraph.error || ''),
					detail: raggedGraph.error || 'admitted',
				},
			]),
		);
	},

	// b — R-ET-30: both slots present, refused by name in the shaper
	b6_shaperRefusesBothVectorSlots: (subject, done) => {
		const bothSlotGraph = shapeFixture(subject, [forgedTextNode({ embedding: BASE_VECTOR })]);
		done(
			verdictOf([
				{
					checkName: 'the shaper refuses a record carrying embedding AND its declared vector, by name',
					pass: /declares vectorPropertyName 'textEmbedding' AND carries 'embedding'[\s\S]*ONE vector slot/.test(bothSlotGraph.error || '') && (bothSlotGraph.error || '').indexOf(TEXT_STABLE_ID) !== -1,
					detail: bothSlotGraph.error || 'admitted',
				},
			]),
		);
	},

	// b — R-ET-30: both slots present, refused by name in shapeNode
	b7_harvestRefusesBothVectorSlots: (subject, done) => {
		const bothSlotHarvest = outcomeOf(() => subject.replayEngine.shapeNode(graphTextNode({ embedding: BASE_VECTOR }), HEADER, true));
		done(
			verdictOf([
				{
					checkName: 'shapeNode refuses a graph node carrying embedding AND its declared vector, by name',
					pass: /declares vectorPropertyName 'textEmbedding' AND carries 'embedding'[\s\S]*ONE vector slot/.test(bothSlotHarvest.thrownMessage) && bothSlotHarvest.thrownMessage.indexOf(TEXT_STABLE_ID) !== -1,
					detail: bothSlotHarvest.thrownMessage || 'harvested',
				},
			]),
		);
	},

	// c — the existing fail-loud rule, on the new path
	c_absentTextRefIsRefusedByName: (subject, done) => {
		openScratchStore((storeError, scratch) => {
			if (storeError) {
				done(failedVerdict(storeError));
				return;
			}
			const textEmbeddingRef = contentAddress.vectorIdForInput(MODEL_VERSION, TEXT_VALUE);
			const restoredRecord = {
				...engineTextRecord(),
				embedding: null,
				embeddingRef: textEmbeddingRef,
				_standardKey: 'ceds',
			};
			subject.replayEngine.resolveNodeVectors({ nodes: [restoredRecord], storeResolver: scratch.storeResolver, header: { embeddingDims: VECTOR_DIMS } }, (resolveError) => {
				done(
					verdictOf([
						{
							checkName: 'an absent text ref is refused naming the ref and the standard',
							pass: new RegExp(`embeddingRef ${textEmbeddingRef} is ABSENT[\\s\\S]*standard 'ceds'`).test(resolveError || ''),
							detail: resolveError || 'no refusal',
						},
						{ checkName: 'and nothing is substituted into the slot', pass: !restoredRecord.embedding, detail: JSON.stringify(restoredRecord.embedding) },
					]),
				);
			});
		});
	},

	// d — a declaration without embedSourceProperty, at every door that reads one
	d1_declarationWithoutEmbedSourcePropertyIsRefused: (subject, done) => {
		const shaperError = shapeFixture(subject, [forgedTextNode({}, ['embedSourceProperty'])]).error || '';
		const harvestRefusal = outcomeOf(() => subject.replayEngine.shapeNode(graphTextNode({}, ['embedSourceProperty']), HEADER, true)).thrownMessage;
		const guardError = subject.replayEngine.validateShapedGraph([{ sourceLabel: SOURCE_LABEL, nodes: [engineTextRecord({}, ['embedSourceProperty'])], edges: [] }]).error;
		const refusalPattern = /declares vectorPropertyName "textEmbedding" but no embedSourceProperty/;
		done(
			verdictOf([
				{ checkName: 'the shaper refuses it by name', pass: refusalPattern.test(shaperError), detail: shaperError || 'admitted' },
				{ checkName: 'shapeNode refuses it by name', pass: refusalPattern.test(harvestRefusal), detail: harvestRefusal || 'harvested' },
				{ checkName: 'validateShapedGraph refuses it by name, before any write', pass: refusalPattern.test(guardError) && /No writes performed/.test(guardError), detail: guardError || 'admitted' },
			]),
		);
	},

	// d — declaring the ordinary name, at every door that reads a declaration
	d2_declaringTheOrdinaryVectorPropertyIsRefused: (subject, done) => {
		const shaperError = shapeFixture(subject, [forgedTextNode({ vectorPropertyName: 'embedding', embedding: TEXT_VECTOR }, ['textEmbedding'])]).error || '';
		const harvestRefusal = outcomeOf(() =>
			subject.replayEngine.shapeNode(graphTextNode({ vectorPropertyName: 'embedding', embedding: TEXT_VECTOR }, ['textEmbedding']), HEADER, true),
		).thrownMessage;
		const guardError = subject.replayEngine.validateShapedGraph([{ sourceLabel: SOURCE_LABEL, nodes: [engineTextRecord({ vectorPropertyName: 'embedding' })], edges: [] }]).error;
		const refusalPattern = /declares vectorPropertyName "embedding": that is the ordinary vector property/;
		done(
			verdictOf([
				{ checkName: 'the shaper refuses it by name', pass: refusalPattern.test(shaperError), detail: shaperError || 'admitted' },
				{ checkName: 'shapeNode refuses it by name', pass: refusalPattern.test(harvestRefusal), detail: harvestRefusal || 'harvested' },
				{ checkName: 'validateShapedGraph refuses it by name', pass: refusalPattern.test(guardError), detail: guardError || 'admitted' },
			]),
		);
	},

	// d — GUARD 4: an engine record whose declared vector is still under properties
	d3_declaredVectorLeftUnderPropertiesIsRefused: (subject, done) => {
		const guardError = subject.replayEngine.validateShapedGraph([
			{ sourceLabel: SOURCE_LABEL, nodes: [engineTextRecord({ textEmbedding: narrowed(TEXT_VECTOR) })], edges: [] },
		]).error;
		done(
			verdictOf([
				{
					checkName: 'validateShapedGraph refuses a declared vector left under properties, before any write',
					pass: /vector slot enforcement[\s\S]*carries its declared vector property 'textEmbedding' under properties[\s\S]*No writes performed/.test(guardError),
					detail: guardError || 'admitted',
				},
			]),
		);
	},

	// d — a declared property whose value is not a vector
	d4_nonVectorUnderTheDeclaredPropertyIsRefused: (subject, done) => {
		const shaperStringError = shapeFixture(subject, [forgedTextNode({ textEmbedding: 'not a vector' })]).error || '';
		const shaperEmptyError = shapeFixture(subject, [forgedTextNode({ textEmbedding: [] })]).error || '';
		const harvestRefusal = outcomeOf(() => subject.replayEngine.shapeNode(graphTextNode({ textEmbedding: 'not a vector' }), HEADER, true)).thrownMessage;
		done(
			verdictOf([
				{ checkName: 'the shaper refuses a string under the declared property', pass: /is not a non-empty vector \(got string\)/.test(shaperStringError), detail: shaperStringError || 'admitted' },
				{ checkName: 'the shaper refuses an empty array under it', pass: /is not a non-empty vector \(got an empty array\)/.test(shaperEmptyError), detail: shaperEmptyError || 'admitted' },
				{ checkName: 'shapeNode refuses a non-vector under it', pass: /the value there is not a non-empty vector/.test(harvestRefusal), detail: harvestRefusal || 'harvested' },
			]),
		);
	},

	// d — R-ET-37 (RADIANT_QUEST, 2026-09-14): the only declarable vector property is EMBED_TEXT_VECTOR.propertyName,
	// the one a vector index covers; any other name is refused at every door that reads a declaration
	d5_undeclarableVectorPropertyNameIsRefused: (subject, done) => {
		const shaperError = shapeFixture(subject, [forgedTextNode({ vectorPropertyName: 'otherVector', otherVector: TEXT_VECTOR }, ['textEmbedding'])]).error || '';
		const harvestRefusal = outcomeOf(() =>
			subject.replayEngine.shapeNode(graphTextNode({ vectorPropertyName: 'otherVector', otherVector: TEXT_VECTOR }, ['textEmbedding']), HEADER, true),
		).thrownMessage;
		const guardError = subject.replayEngine.validateShapedGraph([{ sourceLabel: SOURCE_LABEL, nodes: [engineTextRecord({ vectorPropertyName: 'otherVector' })], edges: [] }]).error;
		const refusalPattern = /declares vectorPropertyName "otherVector"; the only declarable vector property is 'textEmbedding'/;
		done(
			verdictOf([
				{ checkName: 'the shaper refuses it by name', pass: refusalPattern.test(shaperError), detail: shaperError || 'admitted' },
				{ checkName: 'shapeNode refuses it by name', pass: refusalPattern.test(harvestRefusal), detail: harvestRefusal || 'harvested' },
				{ checkName: 'validateShapedGraph refuses it by name', pass: refusalPattern.test(guardError), detail: guardError || 'admitted' },
			]),
		);
	},

	// e — two vector indexes on a capable kernel
	e1_twoVectorIndexStatementsOnACapableKernel: (subject, done) => {
		writeThroughRecordingSession({ subject, kernelVersion: '5.26.0' }, (writeError, written) => {
			if (writeError) {
				done(failedVerdict(writeError));
				return;
			}
			const vectorIndexStatementList = vectorIndexStatementListOf(written.recordedStatementList);
			done(
				verdictOf([
					{ checkName: 'EXACTLY two CREATE VECTOR INDEX statements', pass: vectorIndexStatementList.length === 2, detail: `${vectorIndexStatementList.length}` },
					{
						checkName: `${ORDINARY_INDEX_NAME} FOR (n:ForgedNode) ON (n.embedding)`,
						pass: vectorIndexStatementList.some((oneText) => new RegExp(`CREATE VECTOR INDEX ${ORDINARY_INDEX_NAME} IF NOT EXISTS\\s+FOR \\(n:ForgedNode\\) ON \\(n\\.embedding\\)`).test(oneText)),
						detail: vectorIndexStatementList.join(' || '),
					},
					{
						checkName: `${EMBED_TEXT_INDEX_NAME} FOR (n:DmeEmbedText) ON (n.textEmbedding)`,
						pass: vectorIndexStatementList.some((oneText) => new RegExp(`CREATE VECTOR INDEX ${EMBED_TEXT_INDEX_NAME} IF NOT EXISTS\\s+FOR \\(n:DmeEmbedText\\) ON \\(n\\.textEmbedding\\)`).test(oneText)),
						detail: vectorIndexStatementList.join(' || '),
					},
					{
						checkName: 'both at vector.dimensions = embeddingDims, cosine',
						pass:
							vectorIndexStatementList.length > 0 &&
							vectorIndexStatementList.every((oneText) => new RegExp(`\`vector\\.dimensions\`: ${VECTOR_DIMS},`).test(oneText) && /`vector\.similarity_function`: 'cosine'/.test(oneText)),
						detail: vectorIndexStatementList.join(' || '),
					},
					{
						checkName: 'the report names both indexes as built',
						pass: (written.writeReport.indexesBuilt || []).includes(ORDINARY_INDEX_NAME) && (written.writeReport.indexesBuilt || []).includes(EMBED_TEXT_INDEX_NAME),
						detail: JSON.stringify(written.writeReport.indexesBuilt),
					},
				]),
			);
		});
	},

	// e — both recorded as skipped on an old kernel
	e2_bothIndexesRecordedSkippedOnAnOldKernel: (subject, done) => {
		writeThroughRecordingSession({ subject, kernelVersion: '5.12.0' }, (writeError, written) => {
			if (writeError) {
				done(failedVerdict(writeError));
				return;
			}
			const indexesBuilt = written.writeReport.indexesBuilt || [];
			done(
				verdictOf([
					{ checkName: 'no CREATE VECTOR INDEX statement on 5.12.0', pass: vectorIndexStatementListOf(written.recordedStatementList).length === 0, detail: vectorIndexStatementListOf(written.recordedStatementList).join(' || ') },
					{ checkName: `${ORDINARY_INDEX_NAME} recorded as skipped`, pass: indexesBuilt.includes(`${ORDINARY_INDEX_NAME}:skipped(serverVersion 5.12.0 < 5.13)`), detail: JSON.stringify(indexesBuilt) },
					{ checkName: `${EMBED_TEXT_INDEX_NAME} recorded as skipped`, pass: indexesBuilt.includes(`${EMBED_TEXT_INDEX_NAME}:skipped(serverVersion 5.12.0 < 5.13)`), detail: JSON.stringify(indexesBuilt) },
				]),
			);
		});
	},

	// e — the hermetic half of "golden_vector indexes zero text nodes": no written text row carries `embedding`
	e3_noWrittenTextRowCarriesEmbedding: (subject, done) => {
		writeThroughRecordingSession({ subject, kernelVersion: '5.26.0' }, (writeError, written) => {
			if (writeError) {
				done(failedVerdict(writeError));
				return;
			}
			const mergeRowListFor = (labelName) =>
				written.recordedStatementList
					.filter((oneStatement) => /MERGE \(n:`ForgedNode` \{stableId: row\.stableId\}\)/.test(oneStatement.statementText) && oneStatement.statementText.indexOf(`\`${labelName}\``) !== -1)
					.reduce((rowList, oneStatement) => rowList.concat(oneStatement.statementParameters.batch), []);
			const textRowList = mergeRowListFor('DmeEmbedText');
			const propertyRowList = mergeRowListFor('DmeProperty');
			done(
				verdictOf([
					{ checkName: 'one text row was written', pass: textRowList.length === 1, detail: `${textRowList.length}` },
					{ checkName: 'no written text row carries embedding', pass: textRowList.every((oneRow) => !hasOwn(oneRow.props, 'embedding')), detail: textRowList.map((oneRow) => Object.keys(oneRow.props).join(',')).join(' | ') },
					{ checkName: 'the written text row carries textEmbedding', pass: textRowList.length === 1 && sameNumberList(textRowList[0].props.textEmbedding, narrowed(TEXT_VECTOR)), detail: textRowList.map((oneRow) => JSON.stringify(oneRow.props.textEmbedding)).join(' | ') },
					{ checkName: 'the written property row still carries embedding', pass: propertyRowList.length === 1 && sameNumberList(propertyRowList[0].props.embedding, narrowed(BASE_VECTOR)), detail: `${propertyRowList.length}` },
				]),
			);
		});
	},

	// f — the DME resolver sees exactly one candidate on the two-index graph
	f_dmeResolverSelectsExactlyOneIndex: (subject, done) => {
		writeThroughRecordingSession({ subject, kernelVersion: '5.26.0' }, (writeError, written) => {
			if (writeError) {
				done(failedVerdict(writeError));
				return;
			}
			const showIndexRowList = showIndexRowListOf(written.recordedStatementList);
			const resolution = dmeResolveVectorIndexOf(showIndexRowList);
			done(
				verdictOf([
					{ checkName: 'SHOW INDEXES lists the resolution-key index and two vector indexes', pass: showIndexRowList.length === 3 && showIndexRowList.filter((oneRow) => oneRow.type === 'VECTOR').length === 2, detail: JSON.stringify(showIndexRowList) },
					{ checkName: `the resolver selects exactly ${ORDINARY_INDEX_NAME}`, pass: resolution.error === '' && resolution.indexName === ORDINARY_INDEX_NAME, detail: resolution.error || resolution.indexName },
				]),
			);
		});
	},
};

// ---------------------------------------------------------------------------------------------------
// THE TWINS — each a named production fault, and the conjuncts it must turn RED
// ---------------------------------------------------------------------------------------------------
const twinList = [
	{
		twinName: 'codecAddsAFieldToTheLegacyLine',
		mutationList: [{ modulePath: BLOCK_PATH, find: 'ordered.embeddingRef = node.embeddingRef; // 64-hex vectorId', replace: "ordered.embeddingRef = node.embeddingRef; ordered.vectorSlot = 'embedding'; // 64-hex vectorId" }],
		conjunctRefIdList: ['a1_legacyExcerptCodecRoundTripIsByteIdentical', 'a2_legacyExcerptRestoreHarvestIsByteIdentical'],
	},
	{
		twinName: 'restoreLandsEveryVectorUnderAnotherName',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (node.embedding) props[vectorSlotVerdict.vectorSlotPropertyName] = node.embedding;', replace: 'if (node.embedding) props.misnamedVectorSlot = node.embedding;' }],
		conjunctRefIdList: ['a2_legacyExcerptRestoreHarvestIsByteIdentical', 'b1_initRowLandsTheTextVectorUnderTextEmbedding'],
	},
	{
		twinName: 'restoreLandsTheTextVectorUnderEmbedding',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (node.embedding) props[vectorSlotVerdict.vectorSlotPropertyName] = node.embedding;', replace: 'if (node.embedding) props.embedding = node.embedding;' }],
		conjunctRefIdList: ['b1_initRowLandsTheTextVectorUnderTextEmbedding', 'b3_restoreThenReharvestIsByteIdentical', 'e3_noWrittenTextRowCarriesEmbedding'],
		greenRefIdList: ['a2_legacyExcerptRestoreHarvestIsByteIdentical'],
		greenReason: 'a legacy node declares nothing, so its slot IS embedding',
	},
	{
		twinName: 'harvestReadsOnlyTheOrdinarySlot',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'const slotVectorList = props[vectorSlotPropertyName];', replace: 'const slotVectorList = props[ORDINARY_VECTOR_PROPERTY_NAME];' }],
		conjunctRefIdList: ['b2_harvestLineCarriesTheRefAndNoVector', 'b4_storeLessHarvestReadsTheSameSlot'],
		greenRefIdList: ['a2_legacyExcerptRestoreHarvestIsByteIdentical'],
		greenReason: 'a legacy node declares nothing, so its slot IS embedding',
	},
	{
		twinName: 'harvestKeepsTheDeclaredVectorAsAProperty',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (oneKey === vectorSlotPropertyName) return;', replace: '' }],
		conjunctRefIdList: ['b2_harvestLineCarriesTheRefAndNoVector', 'b4_storeLessHarvestReadsTheSameSlot'],
		greenRefIdList: ['a2_legacyExcerptRestoreHarvestIsByteIdentical'],
		greenReason: 'embedding is dropped by its own clause',
	},
	{
		twinName: 'shaperSkipsTheLift',
		mutationList: [
			{ modulePath: SHAPER_PATH, find: 'if (oneNode.properties[vectorSlotPropertyName]) {', replace: 'if (oneNode.properties.embedding) {' },
			{ modulePath: SHAPER_PATH, find: 'const vector = oneNode.properties[vectorSlotPropertyName];', replace: 'const vector = oneNode.properties.embedding;' },
			{ modulePath: SHAPER_PATH, find: "oneKey === 'embeddingModelVersion' || oneKey === vectorSlotPropertyName", replace: "oneKey === 'embeddingModelVersion'" },
		],
		conjunctRefIdList: ['b1_initRowLandsTheTextVectorUnderTextEmbedding', 'b5_textVectorOfAnotherWidthIsRefused'],
	},
	{
		twinName: 'shaperBothSlotsCheckRemoved',
		mutationList: [{ modulePath: SHAPER_PATH, find: 'if (forgeProperties[ORDINARY_VECTOR_PROPERTY_NAME] !== undefined && forgeProperties[ORDINARY_VECTOR_PROPERTY_NAME] !== null) {', replace: 'if (false) {' }],
		conjunctRefIdList: ['b6_shaperRefusesBothVectorSlots'],
	},
	{
		twinName: 'harvestBothSlotsCheckRemoved',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (props[ORDINARY_VECTOR_PROPERTY_NAME] !== undefined && props[ORDINARY_VECTOR_PROPERTY_NAME] !== null) {', replace: 'if (false) {' }],
		conjunctRefIdList: ['b7_harvestRefusesBothVectorSlots'],
	},
	{
		twinName: 'absentRefSwallowed',
		// the absence branch ACCEPTS and moves on (a swallow), rather than merely skipping the check, which would
		// crash on record.vector and prove a crash, not a silent pass
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (!record) {', replace: "if (!record) { entryDone(''); return; } if (false) {" }],
		conjunctRefIdList: ['c_absentTextRefIsRefusedByName'],
	},
	{
		twinName: 'embedSourceRequirementRemoved',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (embedSourcePropertyValue === undefined || embedSourcePropertyValue === null) {', replace: 'if (false) {' }],
		conjunctRefIdList: ['d1_declarationWithoutEmbedSourcePropertyIsRefused'],
	},
	{
		twinName: 'ordinaryNameDeclarationAllowed',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (declaredName === ORDINARY_VECTOR_PROPERTY_NAME) {', replace: 'if (false) {' }],
		conjunctRefIdList: ['d2_declaringTheOrdinaryVectorPropertyIsRefused'],
	},
	{
		twinName: 'anyVectorPropertyNameDeclarable',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (declaredName !== EMBED_TEXT_VECTOR.propertyName) {', replace: 'if (false) {' }],
		conjunctRefIdList: ['d5_undeclarableVectorPropertyNameIsRefused'],
	},
	{
		twinName: 'vectorUnderPropertiesAdmitted',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'if (recordProperties[declaredName] !== undefined) {', replace: 'if (false) {' }],
		conjunctRefIdList: ['d3_declaredVectorLeftUnderPropertiesIsRefused'],
	},
	{
		twinName: 'nonVectorDeclaredValueAdmitted',
		mutationList: [
			{ modulePath: SHAPER_PATH, find: 'if (declaredVector !== undefined && declaredVector !== null && !(Array.isArray(declaredVector) && declaredVector.length > 0)) {', replace: 'if (false) {' },
			{ modulePath: ENGINE_PATH, find: '!(Array.isArray(declaredVectorValue) && declaredVectorValue.length > 0)', replace: 'false' },
		],
		conjunctRefIdList: ['d4_nonVectorUnderTheDeclaredPropertyIsRefused'],
	},
	{
		twinName: 'secondIndexStatementDropped',
		mutationList: [{ modulePath: ENGINE_PATH, find: '.then(() => session.run(embedTextVectorQuery))', replace: '' }],
		conjunctRefIdList: ['e1_twoVectorIndexStatementsOnACapableKernel', 'f_dmeResolverSelectsExactlyOneIndex'],
	},
	{
		twinName: 'secondIndexSkipNotRecorded',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'indexesBuilt.push(`${embedTextVectorIndex}:skipped(serverVersion ${kernelVersion} < 5.13)`);', replace: '' }],
		conjunctRefIdList: ['e2_bothIndexesRecordedSkippedOnAnOldKernel'],
	},
	{
		twinName: 'secondIndexDeclaredOnTheOrdinaryPair',
		mutationList: [{ modulePath: ENGINE_PATH, find: 'FOR (n:${EMBED_TEXT_VECTOR.label}) ON (n.${EMBED_TEXT_VECTOR.propertyName})', replace: 'FOR (n:ForgedNode) ON (n.embedding)' }],
		conjunctRefIdList: ['f_dmeResolverSelectsExactlyOneIndex', 'e1_twoVectorIndexStatementsOnACapableKernel'],
	},
];

// ---------------------------------------------------------------------------------------------------
// RUNNER
// ---------------------------------------------------------------------------------------------------
const realSubject = {
	replayEngine: require('../replay-engine')(),
	replayBlock: require('../replay-block')(),
	shaper: require(SHAPER_PATH)(),
};

// COMPILE ADAPTATION, not a fault: moduleDouble compiles a sibling with Module.wrap, which (unlike Node's own
// loader) does not strip a shebang, and content-address.js — reached relatively from the engine — opens with
// one. Removing that line is the smallest change that lets the double compile the real module.
const CONTENT_ADDRESS_PATH = path.join(__dirname, '..', '..', 'content-address', 'content-address.js');
const COMPILE_ADAPTATION_MUTATION_LIST = [{ modulePath: CONTENT_ADDRESS_PATH, find: '#!/usr/bin/env node\n', replace: '' }];

const doubledSubjectOf = (twinMutationList) => {
	const mutationList = COMPILE_ADAPTATION_MUTATION_LIST.concat(twinMutationList);
	return {
		replayEngine: moduleDouble.loadWithMutations({ modulePath: ENGINE_PATH, mutationList })(),
		replayBlock: moduleDouble.loadWithMutations({ modulePath: BLOCK_PATH, mutationList })(),
		shaper: moduleDouble.loadWithMutations({ modulePath: SHAPER_PATH, mutationList })(),
	};
};

// judges run ONE at a time. A judge is NOT wrapped in a catch: the real vector store answers synchronously,
// so the rest of the run executes inside the judge's own call, and a catch here would swallow every later
// throw and end the run in silence (observed on this suite's first run, 2026-09-14). Throwing engine calls
// are contained individually by outcomeOf inside the judges; anything else is allowed to crash loudly.
const runConjunctList = ({ subject, conjunctRefIdList }, done) => {
	const verdictByRefId = {};
	let conjunctIndex = 0;
	const nextConjunct = () => {
		if (conjunctIndex >= conjunctRefIdList.length) {
			done(verdictByRefId);
			return;
		}
		const conjunctRefId = conjunctRefIdList[conjunctIndex];
		conjunctIndex++;
		conjunctJudgeByRefId[conjunctRefId](subject, (verdict) => {
			if (hasOwn(verdictByRefId, conjunctRefId)) {
				throw new Error(`${moduleName}: judge ${conjunctRefId} called back twice — its verdict cannot be trusted`);
			}
			verdictByRefId[conjunctRefId] = verdict;
			// each judge starts on a fresh stack, outside whatever library call delivered the last verdict
			setImmediate(nextConjunct);
		});
	};
	nextConjunct();
};

// a run that ends WITHOUT reaching its report is a failure, never a quiet exit 0 (a judge that never calls
// back would otherwise drain the event loop and look like success)
let isReportReached = false;
process.on('exit', () => {
	if (!isReportReached) {
		process.stderr.write(`${moduleName}: the run ended before its report — a judge never called back. FAILED.\n`);
		process.exitCode = 1;
	}
});

const allConjunctRefIdList = Object.keys(conjunctJudgeByRefId);
const observedRedSet = new Set();

harness.section('G-VECPROP — every conjunct GREEN on the real modules');
runConjunctList({ subject: realSubject, conjunctRefIdList: allConjunctRefIdList }, (realVerdictByRefId) => {
	allConjunctRefIdList.forEach((oneRefId) => {
		harness.ok(`${oneRefId} PASS`, realVerdictByRefId[oneRefId].pass, realVerdictByRefId[oneRefId].detail);
	});

	harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a module double (in memory)');
	let twinIndex = 0;
	const nextTwin = () => {
		if (twinIndex >= twinList.length) {
			allConjunctRefIdList.forEach((oneRefId) => {
				harness.ok(`${oneRefId} was observed red under at least one twin`, observedRedSet.has(oneRefId));
			});
			process.global.xLog.status(`  G-VECPROP: ${observedRedSet.size}/${allConjunctRefIdList.length} conjuncts observed red, ${twinList.length} twin runs`);
			fs.rmSync(scratchRootPath, { recursive: true, force: true });
			isReportReached = true;
			harness.report();
			return;
		}
		const oneTwin = twinList[twinIndex];
		twinIndex++;
		oneTwin.mutationList.forEach((oneMutation) => moduleDouble.assertMutationApplies({ modulePath: oneMutation.modulePath, find: oneMutation.find }));
		const doubledSubject = doubledSubjectOf(oneTwin.mutationList);
		const judgedRefIdList = oneTwin.conjunctRefIdList.concat(oneTwin.greenRefIdList || []);
		runConjunctList({ subject: doubledSubject, conjunctRefIdList: judgedRefIdList }, (twinVerdictByRefId) => {
			oneTwin.conjunctRefIdList.forEach((oneRefId) => {
				const twinVerdict = twinVerdictByRefId[oneRefId];
				harness.ok(`${oneRefId} observed RED under twin '${oneTwin.twinName}'`, twinVerdict.pass === false, twinVerdict.detail);
				if (twinVerdict.pass === false) {
					observedRedSet.add(oneRefId);
				}
				process.global.xLog.status(`  RED-OBSERVED G-VECPROP/${oneRefId} twin='${oneTwin.twinName}' → ${twinVerdict.pass ? 'PASS (DEFECTIVE)' : 'FAIL'}: ${twinVerdict.detail.slice(0, 400)}`);
			});
			(oneTwin.greenRefIdList || []).forEach((oneRefId) => {
				const twinVerdict = twinVerdictByRefId[oneRefId];
				harness.ok(`${oneRefId} stays GREEN under twin '${oneTwin.twinName}' (${oneTwin.greenReason})`, twinVerdict.pass === true, twinVerdict.detail);
			});
			nextTwin();
		});
	};
	nextTwin();
});
