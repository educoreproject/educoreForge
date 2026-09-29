#!/usr/bin/env node
'use strict';

// test-sif260928RoundTrip.js — the phase A6 gates: the graph regenerates the SIF spreadsheet byte for
// byte (PLAN-sifReplacement-smallPhases-092826.md §3 A6; SPEC §9 A3, A25; EBONY_DREAM's A6 ruling).
// ALL DOCKER-FREE: the forge runs in pure mode, and the graph is read through the harness's
// graphDoubleFrom, re-sorted into the order the live reader returns (ORDER BY stableId), so the proof
// cannot lean on the double keeping the forge's emission order.
//
// Every conjunct runs the validator the way a build runs it: the round-trip stage composes its roster
// from the bundle's own parserDescriptor.ini through the forger's resolveBundle, and runs the declared
// validator against the snapshot directory the forger resolved. Only the bolt connection is replaced:
// the validator's validateWithReader is driven over the double.
//
//   A6-VERDICT  (a) the verdict: roundTripClean true, inventedTotal 0, lostTotal 0, contentGapTotal 0,
//                   explicitlyOmittedTotal 6,586; an invented row fails the build; every row's eight
//                   cells and line; the stored description readings; the whole file by sha256; the
//                   Containers exactly the omitted items; every graph node classified
//   A6-SHAPE    (b) the verdict carries the five normative fields, and the stage adjudicates on them
//   A6-STAGE        (the A1a stand-down) the stage classifies this validator DECLARED, and the forger
//                   resolves the pinned snapshot directory that the validator is handed
//
// The twins are input faults: they change a copy of the forged graph in memory, or the verdict or the
// resolver's answer on its way to the stage. Nothing is written to the tree; stage output goes to a
// scratch directory under the OS temp directory, removed at the end.
//
// Run: PATH=/usr/local/bin:$PATH node forges/sif260928/test/test-sif260928RoundTrip.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- phase A6 gates: the graph regenerates the SIF TSV byte for byte

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct PASSES and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BUNDLE_DIR = path.join(__dirname, '..');
const TREE_ROOT = path.join(BUNDLE_DIR, '..', '..');
const FORGE_FRAMEWORK_DIR = path.join(TREE_ROOT, 'lib', 'forge-framework');
const ENTRY_MODULE_PATH = path.join(BUNDLE_DIR, 'forgeSif260928.js');
const VALIDATOR_PATH = path.join(BUNDLE_DIR, 'roundTripValidator.js');
const DESCRIPTOR_PATH = path.join(BUNDLE_DIR, 'parserDescriptor.ini');
const INCUMBENT_SNAPSHOT_DIR = path.join(TREE_ROOT, 'forges', 'sif', 'assets', 'standardSourceData', '01');

const { runGateFamily } = require(path.join(FORGE_FRAMEWORK_DIR, 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'twinRegistry'));
const roundTripHarness = require(path.join(FORGE_FRAMEWORK_DIR, 'roundTripHarness', 'roundTripHarness'))();
const rosterLib = require(path.join(FORGE_FRAMEWORK_DIR, 'roster'));
const roundTripStageLib = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'lib', 'round-trip-stage'))();
const { resolveBundle } = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'forger'));
const { STATEMENT_KIND, LOST_REASON } = require(path.join(BUNDLE_DIR, 'lib', 'sif260928RoundTripPair'));

const descriptorValueByName = rosterLib.readDescriptorSection(DESCRIPTOR_PATH).valueByName;
const STANDARD_TOKEN = 'sif260928';
const PINNED_SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const SOURCE_PATH = path.join(PINNED_SNAPSHOT_DIR, descriptorValueByName.sourceFile);

// ---- FROZEN LITERALS. Never edited to match a measurement.
// PLAN §3 A6 (a) and A2 (a): the Containers are the omitted items
const RULED_EXPLICITLY_OMITTED_TOTAL = 6586;
// PLAN §3 A1b and SPEC §9 A21: 15,620 rows over 159 tables; 16,101 lines by split
const RULED_ROW_COUNT = 15620;
const RULED_TABLE_COUNT = 159;
const RULED_LINE_COUNT = 16101;
// A1a: the TSV's pinned sha256 (the incumbent's SHA256SUMS entry, byte-copied)
const RULED_SOURCE_SHA256 = '6814727786bd767a23b3f6eabdf1862d30c126a0e82146cd3e622107174ae706';
// the forge's node census (A2 to A5), by what the proof does with each kind
const RULED_NODE_COUNT_BY_DISPOSITION = Object.freeze({ row: 15620, table: 159, omittedStructure: 6586, derivedStructure: 1 + 5018 + 131 + 4055 + 7698 });
const NORMATIVE_VERDICT_FIELD_TYPE_BY_NAME = Object.freeze({ roundTripClean: 'boolean', inventedTotal: 'number', lostTotal: 'number', contentGapTotal: 'number', explicitlyOmittedTotal: 'number' });

// ---- named rows the twins fault
const NAMED_DELETED_FIELD_XPATH = '/AccountingPeriods/AccountingPeriod/EndDate';
// a quote-wrapped Description cell with padding inside the quotes
const NAMED_QUOTED_FIELD_XPATH = '/AccountingPeriods/AccountingPeriod/SIF_Metadata/TimeElements/TimeElement/Type';
const NAMED_TABLE_OBJECT_PATH = '/AccountingPeriods/AccountingPeriod';
const NAMED_DELETED_CONTAINER_PATH = '/AccountingPeriods/AccountingPeriod/SIF_Metadata';
const INVENTED_FIELD_XPATH = '/AccountingPeriods/AccountingPeriod/InventedByTheTwin';

// the stage's bolt triple, never dialled: the validator is driven over the double
const DOUBLE_CONTAINER_HANDLE = Object.freeze({ containerName: 'graphDouble-A6', boltUrl: 'bolt://graph-double.invalid:7687', user: 'graphDouble', password: 'graphDouble' });

const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sif260928RoundTrip-'));
let scratchRunCount = 0;

// ---- the forged graph, forged once; every run takes a copy
let forgedOnce = null;
const forgedGraph = (callback) => {
	if (forgedOnce !== null) {
		callback('', forgedOnce);
		return;
	}
	require(ENTRY_MODULE_PATH)({ embedder: null }).forge({ sourcePath: SOURCE_PATH, owner: 'test', skipEmbedding: true }, (forgeError, forged) => {
		if (forgeError) {
			callback(forgeError);
			return;
		}
		forgedOnce = forged;
		callback('', forged);
	});
};

// ---- the subject every conjunct reads and every twin changes (on a clone)
//   graphFaultList      functions (nodes, edges) → { nodes, edges } applied to a copy of the forge result
//   verdictFault        a function applied to the verdict on its way to the stage, or null
//   resolverFault       a function applied to resolveBundle's answer, or null
const makeSubject = () => ({ graphFaultList: [], verdictFault: null, resolverFault: null });
const cloneSubject = (subject) => ({ ...subject, graphFaultList: subject.graphFaultList.slice() });

// the live reader's order (graphReader.js: nodes ORDER BY stableId; edges by from, type, to)
const compareText = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);
const liveOrderReaderOf = (forgeResult) => {
	const doubleReader = roundTripHarness.graphDoubleFrom({ forgeResult });
	return {
		readAll: (callback) =>
			doubleReader.readAll((readError, graph) => {
				if (readError) {
					callback(readError);
					return;
				}
				const nodes = graph.nodes.slice().sort((leftNode, rightNode) => compareText(leftNode.stableId, rightNode.stableId));
				const edges = graph.edges.slice().sort((leftEdge, rightEdge) => compareText(leftEdge.fromStableId, rightEdge.fromStableId) || compareText(leftEdge.type, rightEdge.type) || compareText(leftEdge.toStableId, rightEdge.toStableId));
				callback('', { nodes, edges });
			}),
		close: doubleReader.close,
	};
};

// the stage run: roster composed from the descriptor, the declared validator run over the double
const runStage = (subject, callback) => {
	forgedGraph((forgeError, forged) => {
		if (forgeError) {
			callback('', { forgeError });
			return;
		}
		const faultedGraph = subject.graphFaultList.reduce((graph, graphFault) => graphFault(graph), { nodes: forged.nodes.slice(), edges: forged.edges.slice() });
		const reader = liveOrderReaderOf(faultedGraph);
		const validatorApi = require(VALIDATOR_PATH);
		const runFacts = {
			handedSnapshotPath: null,
			verdict: null,
			requiredValidatorPath: null,
			graphContainerPathList: faultedGraph.nodes.filter((oneNode) => oneNode.labels.includes('Sif260928Container')).map((oneNode) => oneNode.properties.path),
		};
		// the load seam: the stage's own require of the declared file, recorded, with only the bolt
		// connection replaced by the double
		const requireValidator = (validatorPath) => {
			runFacts.requiredValidatorPath = validatorPath;
			const loadedApi = require(validatorPath);
			return {
				validate: ({ containerName, boltUrl, snapshotPath, outputPath }, validateCallback) => {
					runFacts.handedSnapshotPath = snapshotPath;
					loadedApi.validateWithReader({ reader, snapshotPath, outputPath, graphIdentity: { containerName, boltUrl } }, (validateError, verdict) => {
						if (validateError) {
							validateCallback(validateError);
							return;
						}
						runFacts.verdict = subject.verdictFault === null ? verdict : subject.verdictFault({ ...verdict });
						validateCallback('', runFacts.verdict);
					});
				},
			};
		};
		const bundleResolver = subject.resolverFault === null ? resolveBundle : (resolveArgs) => subject.resolverFault(resolveBundle(resolveArgs));
		const stageLineList = [];
		const stageLog = { status: (lineText) => stageLineList.push(lineText), error: (lineText) => stageLineList.push(lineText) };
		const outputDirPath = path.join(scratchRootPath, `run${++scratchRunCount}`);
		roundTripStageLib.composeValidatorRoster({ standardTokens: [STANDARD_TOKEN], bundleResolver, requireValidator }, (rosterError, roster) => {
			if (rosterError) {
				callback('', { rosterError, runFacts, validatorApi });
				return;
			}
			roundTripStageLib.runRoundTripStage({ stageSpec: { mode: 'build', enabled: true, roster, outputDirPath }, containerHandle: DOUBLE_CONTAINER_HANDLE, xLog: stageLog }, (stageError, stageResult) => {
				callback('', { roster, stageError, stageResult, stageLineList, runFacts, validatorApi });
			});
		});
	});
};

// a conjunct over one stage run: a forge refusal or a roster refusal is a FAIL, with the reason
const overStageRun = (judgeRun) => (subject, callback) => {
	runStage(subject, (unusedError, stageRun) => {
		if (stageRun.forgeError) {
			callback('', { pass: false, detail: `forge refused: ${String(stageRun.forgeError).slice(0, 300)}` });
			return;
		}
		if (stageRun.rosterError) {
			callback('', { pass: false, detail: `roster refused: ${String(stageRun.rosterError).slice(0, 300)}` });
			return;
		}
		callback('', judgeRun(stageRun));
	});
};

const firstOf = (itemList) => (itemList.length ? ` (first ${JSON.stringify(itemList[0]).slice(0, 200)})` : '');
const stageFailureText = (stageRun) => (stageRun.stageError ? `stage FAILED: ${String(stageRun.stageError).slice(0, 400)}` : 'stage ran');
const statementKindOf = (statementKey) => statementKey.split('|')[0];
const lostListOf = (verdict, predicate) => verdict.lostList.filter(predicate);

// ---- graph faults (inputFault)
const fieldNodeOf = (graph, xpath) => graph.nodes.find((oneNode) => oneNode.labels.includes('Sif260928Field') && oneNode.properties.xpath === xpath);
const replaceNode = (graph, oldNode, newNode) => ({ nodes: graph.nodes.map((oneNode) => (oneNode === oldNode ? newNode : oneNode)), edges: graph.edges });
const withProperties = (oneNode, propertyChangeByName) => ({ ...oneNode, properties: { ...oneNode.properties, ...propertyChangeByName } });
const withoutNode = (graph, stableId) => ({ nodes: graph.nodes.filter((oneNode) => oneNode.stableId !== stableId), edges: graph.edges.filter((oneEdge) => oneEdge.fromRef.id !== stableId && oneEdge.toRef.id !== stableId) });

const GRAPH_FAULT = Object.freeze({
	// a Field for a row the TSV never had, on a line after the last
	inventedFieldAdded: (graph) => {
		const modelNode = fieldNodeOf(graph, NAMED_DELETED_FIELD_XPATH);
		const inventedStableId = `sif260928:field${INVENTED_FIELD_XPATH}`;
		return { nodes: graph.nodes.concat([{ ...withProperties(modelNode, { xpath: INVENTED_FIELD_XPATH, name: 'InventedByTheTwin', sourceLineNumber: RULED_LINE_COUNT + 1, _id: inventedStableId, sif260928StableId: inventedStableId, path: INVENTED_FIELD_XPATH }), stableId: inventedStableId }]), edges: graph.edges };
	},
	oneFieldDeleted: (graph) => withoutNode(graph, fieldNodeOf(graph, NAMED_DELETED_FIELD_XPATH).stableId),
	descriptionQuotedFlipped: (graph) => {
		const quotedNode = fieldNodeOf(graph, NAMED_QUOTED_FIELD_XPATH);
		return replaceNode(graph, quotedNode, withProperties(quotedNode, { descriptionQuoted: !quotedNode.properties.descriptionQuoted }));
	},
	// padding added outside the closing quote: the cell changes; its stripped, trimmed reading does not
	descriptionCellTextAltered: (graph) => {
		const quotedNode = fieldNodeOf(graph, NAMED_QUOTED_FIELD_XPATH);
		return replaceNode(graph, quotedNode, withProperties(quotedNode, { descriptionCellText: `${quotedNode.properties.descriptionCellText} ` }));
	},
	oneTableTitleTruncated: (graph) => {
		const objectNode = graph.nodes.find((oneNode) => oneNode.labels.includes('Sif260928Object') && oneNode.properties.path === NAMED_TABLE_OBJECT_PATH);
		return replaceNode(graph, objectNode, withProperties(objectNode, { tableTitleName: objectNode.properties.tableTitleName.slice(0, -1) }));
	},
	oneContainerDeleted: (graph) => withoutNode(graph, `sif260928:container${NAMED_DELETED_CONTAINER_PATH}`),
	unclassifiedLabelNodeAdded: (graph) => {
		const modelNode = fieldNodeOf(graph, NAMED_DELETED_FIELD_XPATH);
		const strayStableId = 'sif260928:stray/UnclassifiedByTheTwin';
		return { nodes: graph.nodes.concat([{ ...modelNode, stableId: strayStableId, labels: ['ForgedNode', 'Sif260928Stray', 'DmeSupport'], properties: { ...modelNode.properties, _id: strayStableId, sif260928StableId: strayStableId } }]), edges: graph.edges };
	},
});

const twinRegistry = makeTwinRegistry();
const registerTwin = ({ gateId, conjunctId, twinName, applyFault }) => {
	twinRegistry.register({
		gateId,
		conjunctId,
		twinName,
		leverKind: 'inputFault',
		shippedConfig: true,
		run: (subject) => applyFault(subject),
	});
};
const registerGraphFaultTwin = ({ gateId, conjunctId, twinName }) =>
	registerTwin({
		gateId,
		conjunctId,
		twinName,
		applyFault: (subject) => {
			subject.graphFaultList.push(GRAPH_FAULT[twinName]);
			return subject;
		},
	});

const VERDICT_GATE_ID = 'A6-VERDICT';
const SHAPE_GATE_ID = 'A6-SHAPE';
const STAGE_GATE_ID = 'A6-STAGE';

// =====================================================================
// (a) A6-VERDICT
// =====================================================================
const verdictConjunctList = [
	{
		conjunctId: 'verdictTotalsEqualRuling',
		title: 'the verdict the stage receives: roundTripClean true, inventedTotal 0, lostTotal 0, contentGapTotal 0, explicitlyOmittedTotal 6,586',
		twinNameList: ['inventedFieldAdded', 'oneFieldDeleted', 'descriptionQuotedFlipped'],
		evaluate: overStageRun((stageRun) => {
			const { verdict } = stageRun.runFacts;
			if (verdict === null) {
				return { pass: false, detail: `no verdict; ${stageFailureText(stageRun)}` };
			}
			return {
				pass: verdict.roundTripClean === true && verdict.inventedTotal === 0 && verdict.lostTotal === 0 && verdict.contentGapTotal === 0 && verdict.explicitlyOmittedTotal === RULED_EXPLICITLY_OMITTED_TOTAL,
				detail: `roundTripClean ${verdict.roundTripClean}, inventedTotal ${verdict.inventedTotal}${firstOf(verdict.inventedList.map((oneItem) => oneItem.statementKey))}, lostTotal ${verdict.lostTotal}, contentGapTotal ${verdict.contentGapTotal}${firstOf(lostListOf(verdict, (oneLost) => oneLost.lostCategory === 'contentGap').map((oneLost) => `${oneLost.statementKey} ${oneLost.lostReason}`))}, explicitlyOmittedTotal ${verdict.explicitlyOmittedTotal}`,
			};
		}),
	},
	{
		conjunctId: 'inventedRowFailsTheBuild',
		title: 'the round-trip stage adjudicates the verdict and the build passes: nothing invented; an invented row makes the stage FAIL the build by name',
		twinNameList: ['inventedFieldAdded'],
		evaluate: overStageRun((stageRun) => {
			const standardSummary = stageRun.stageResult === undefined ? undefined : stageRun.stageResult.standards.find((oneStandard) => oneStandard.token === STANDARD_TOKEN);
			return {
				pass: !stageRun.stageError && standardSummary !== undefined && standardSummary.ran === true && standardSummary.inventedTotal === 0,
				detail: `${stageFailureText(stageRun)}; ${STANDARD_TOKEN} summary ${JSON.stringify(standardSummary && { ran: standardSummary.ran, inventedTotal: standardSummary.inventedTotal })}`,
			};
		}),
	},
	{
		conjunctId: 'everyRowRegeneratedOnItsLine',
		title: 'all 15,620 rows are regenerated from the graph, each with its eight cells verbatim on its own line: no row absent from the graph, no row whose cells or line differ',
		twinNameList: ['oneFieldDeleted', 'descriptionCellTextAltered'],
		evaluate: overStageRun((stageRun) => {
			const { verdict } = stageRun.runFacts;
			if (verdict === null) {
				return { pass: false, detail: `no verdict; ${stageFailureText(stageRun)}` };
			}
			const rowLostList = lostListOf(verdict, (oneLost) => statementKindOf(oneLost.statementKey) === STATEMENT_KIND.ROW);
			const rowAbsentList = rowLostList.filter((oneLost) => oneLost.lostReason === LOST_REASON.ABSENT_FROM_GRAPH).map((oneLost) => oneLost.statementKey);
			const rowCellOrLineDiffersList = rowLostList
				.filter((oneLost) => oneLost.lostReason === LOST_REASON.VALUE_DIFFERS && oneLost.differingFieldNameList.some((fieldName) => fieldName === 'cellList' || fieldName === 'sourceLineNumber'))
				.map((oneLost) => `${oneLost.statementKey} [${oneLost.differingFieldNameList}]`);
			const { sourceStats } = verdict.census;
			return {
				pass: sourceStats.rowCount === RULED_ROW_COUNT && rowAbsentList.length === 0 && rowCellOrLineDiffersList.length === 0,
				detail: `source rows ${sourceStats.rowCount}; absent from the graph ${rowAbsentList.length}${firstOf(rowAbsentList)}; cells or line differ ${rowCellOrLineDiffersList.length}${firstOf(rowCellOrLineDiffersList)}`,
			};
		}),
	},
	{
		conjunctId: 'storedDescriptionReadingsAgreeWithCells',
		title: "every Field's stored description and descriptionQuoted equal the SPEC A3 reading of its own Description cell (one enclosing quote pair stripped, then trimmed)",
		twinNameList: ['descriptionQuotedFlipped'],
		evaluate: overStageRun((stageRun) => {
			const { verdict } = stageRun.runFacts;
			if (verdict === null) {
				return { pass: false, detail: `no verdict; ${stageFailureText(stageRun)}` };
			}
			const readingDiffersList = lostListOf(verdict, (oneLost) => oneLost.lostReason === LOST_REASON.VALUE_DIFFERS && oneLost.differingFieldNameList.some((fieldName) => fieldName === 'description' || fieldName === 'descriptionQuoted')).map(
				(oneLost) => `${oneLost.statementKey} [${oneLost.differingFieldNameList}]`,
			);
			return { pass: readingDiffersList.length === 0, detail: `rows whose stored reading differs ${readingDiffersList.length}${firstOf(readingDiffersList)}` };
		}),
	},
	{
		conjunctId: 'fileRegeneratedByteForByte',
		title: "the text regenerated from the graph alone (read in stableId order) is the TSV byte for byte: sha256 equal to SHA256SUMS's pinned 6814727786bd…, 16,101 lines, 159 table titles on their lines, no line claimed twice or left unplaced",
		twinNameList: ['oneTableTitleTruncated'],
		evaluate: overStageRun((stageRun) => {
			const { verdict } = stageRun.runFacts;
			if (verdict === null) {
				return { pass: false, detail: `no verdict; ${stageFailureText(stageRun)}` };
			}
			const sourceFileText = fs.readFileSync(SOURCE_PATH);
			const snapshotSha256 = crypto.createHash('sha256').update(sourceFileText).digest('hex');
			const sumsSha256 = fs
				.readFileSync(path.join(PINNED_SNAPSHOT_DIR, 'SHA256SUMS'), 'utf8')
				.split('\n')
				.find((oneLine) => oneLine.endsWith(`  ${descriptorValueByName.sourceFile}`))
				.split('  ')[0];
			const fileAndTableLostList = lostListOf(verdict, (oneLost) => [STATEMENT_KIND.FILE, STATEMENT_KIND.TABLE].includes(statementKindOf(oneLost.statementKey))).map((oneLost) => `${oneLost.statementKey} [${oneLost.differingFieldNameList}]`);
			const { graphStats } = verdict.census;
			return {
				pass:
					snapshotSha256 === RULED_SOURCE_SHA256 &&
					sumsSha256 === RULED_SOURCE_SHA256 &&
					fileAndTableLostList.length === 0 &&
					graphStats.regeneratedLineCount === RULED_LINE_COUNT &&
					graphStats.nodeCountByDisposition.table === RULED_TABLE_COUNT &&
					graphStats.lineCollisionCount === 0 &&
					graphStats.unplacedLineCount === 0,
				detail: `snapshot sha ${snapshotSha256.slice(0, 12)}, SHA256SUMS ${sumsSha256.slice(0, 12)}; file or table statements lost ${fileAndTableLostList.length}${firstOf(fileAndTableLostList)}; regenerated lines ${graphStats.regeneratedLineCount}, tables ${graphStats.nodeCountByDisposition.table}, collisions ${graphStats.lineCollisionCount}, unplaced ${graphStats.unplacedLineCount}`,
			};
		}),
	},
	{
		conjunctId: 'containersAreTheOmittedItems',
		title: "the 6,586 explicitlyOmitted items are container statements only, and their paths are exactly the graph's Container paths",
		twinNameList: ['oneContainerDeleted'],
		evaluate: overStageRun((stageRun) => {
			const { verdict } = stageRun.runFacts;
			if (verdict === null) {
				return { pass: false, detail: `no verdict; ${stageFailureText(stageRun)}` };
			}
			const omittedList = lostListOf(verdict, (oneLost) => oneLost.lostCategory === 'explicitlyOmitted');
			const nonContainerOmittedList = omittedList.filter((oneLost) => statementKindOf(oneLost.statementKey) !== STATEMENT_KIND.CONTAINER).map((oneLost) => oneLost.statementKey);
			const omittedPathSet = new Set(omittedList.map((oneLost) => oneLost.statement.containerPath));
			const { graphContainerPathList } = stageRun.runFacts;
			const graphOnlyList = graphContainerPathList.filter((containerPath) => !omittedPathSet.has(containerPath));
			const graphContainerPathSet = new Set(graphContainerPathList);
			const omittedOnlyList = [...omittedPathSet].filter((containerPath) => !graphContainerPathSet.has(containerPath));
			return {
				pass: verdict.explicitlyOmittedTotal === RULED_EXPLICITLY_OMITTED_TOTAL && nonContainerOmittedList.length === 0 && graphOnlyList.length === 0 && omittedOnlyList.length === 0,
				detail: `explicitlyOmittedTotal ${verdict.explicitlyOmittedTotal}; not containers ${nonContainerOmittedList.length}${firstOf(nonContainerOmittedList)}; graph Containers ${graphContainerPathList.length}, in the graph only ${graphOnlyList.length}${firstOf(graphOnlyList)}, omitted only ${omittedOnlyList.length}${firstOf(omittedOnlyList)}`,
			};
		}),
	},
	{
		conjunctId: 'everyGraphNodeClassified',
		title: 'every graph node is classified: 15,620 rows (Field), 159 tables (Object), 6,586 omitted structure (Container), 16,903 derived structure (root, Question, Codeset, CodesetValue, search text); a node of an unclassified kind is an emission fault and the build fails',
		twinNameList: ['unclassifiedLabelNodeAdded'],
		evaluate: overStageRun((stageRun) => {
			const { verdict } = stageRun.runFacts;
			if (verdict === null) {
				return { pass: false, detail: `no verdict; ${stageFailureText(stageRun)}` };
			}
			const { nodeCountByDisposition } = verdict.census.graphStats;
			return {
				pass: !stageRun.stageError && JSON.stringify(nodeCountByDisposition) === JSON.stringify(RULED_NODE_COUNT_BY_DISPOSITION),
				detail: `${stageFailureText(stageRun)}; by disposition ${JSON.stringify(nodeCountByDisposition)}`,
			};
		}),
	},
];
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'verdictTotalsEqualRuling', twinName: 'inventedFieldAdded' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'verdictTotalsEqualRuling', twinName: 'oneFieldDeleted' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'verdictTotalsEqualRuling', twinName: 'descriptionQuotedFlipped' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'inventedRowFailsTheBuild', twinName: 'inventedFieldAdded' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'everyRowRegeneratedOnItsLine', twinName: 'oneFieldDeleted' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'everyRowRegeneratedOnItsLine', twinName: 'descriptionCellTextAltered' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'storedDescriptionReadingsAgreeWithCells', twinName: 'descriptionQuotedFlipped' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'fileRegeneratedByteForByte', twinName: 'oneTableTitleTruncated' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'containersAreTheOmittedItems', twinName: 'oneContainerDeleted' });
registerGraphFaultTwin({ gateId: VERDICT_GATE_ID, conjunctId: 'everyGraphNodeClassified', twinName: 'unclassifiedLabelNodeAdded' });

// =====================================================================
// (b) A6-SHAPE
// =====================================================================
const shapeConjunctList = [
	{
		conjunctId: 'verdictCarriesTheFiveNormativeFields',
		title: 'the verdict carries roundTripClean, inventedTotal, lostTotal, contentGapTotal and explicitlyOmittedTotal with their types, passes the harness shape check, and the stage adjudicates on exactly those values; a verdict missing one is refused by the stage, by name',
		twinNameList: ['contentGapTotalOmitted'],
		evaluate: overStageRun((stageRun) => {
			const { verdict } = stageRun.runFacts;
			if (verdict === null) {
				return { pass: false, detail: `no verdict; ${stageFailureText(stageRun)}` };
			}
			const wrongFieldList = Object.keys(NORMATIVE_VERDICT_FIELD_TYPE_BY_NAME).filter((fieldName) => typeof verdict[fieldName] !== NORMATIVE_VERDICT_FIELD_TYPE_BY_NAME[fieldName]);
			const shapeCheck = roundTripHarness.verifyVerdictShape(verdict);
			const standardSummary = stageRun.stageResult === undefined ? undefined : stageRun.stageResult.standards.find((oneStandard) => oneStandard.token === STANDARD_TOKEN);
			const adjudicatedDifferList = standardSummary === undefined ? ['(no summary)'] : Object.keys(NORMATIVE_VERDICT_FIELD_TYPE_BY_NAME).filter((fieldName) => standardSummary[fieldName] !== verdict[fieldName]);
			return {
				pass: wrongFieldList.length === 0 && shapeCheck.error === '' && !stageRun.stageError && adjudicatedDifferList.length === 0,
				detail: `${stageFailureText(stageRun)}; missing or mistyped [${wrongFieldList}]; stage summary differs on [${adjudicatedDifferList}]; shape check '${shapeCheck.error.slice(0, 160)}'`,
			};
		}),
	},
];
registerTwin({
	gateId: SHAPE_GATE_ID,
	conjunctId: 'verdictCarriesTheFiveNormativeFields',
	twinName: 'contentGapTotalOmitted',
	applyFault: (subject) => ({
		...subject,
		verdictFault: (verdict) => {
			delete verdict.contentGapTotal;
			return verdict;
		},
	}),
});

// =====================================================================
// A6-STAGE (the A1a stand-down: the stage's classification, the forger's snapshot path)
// =====================================================================
const stageConjunctList = [
	{
		conjunctId: 'stageClassifiesValidatorDeclared',
		title: "composeValidatorRoster, reading parserDescriptor.ini through the forger's resolveBundle, classifies sif260928 DECLARED, loads roundTripValidator.js from the bundle, and holds this validator's validate",
		twinNameList: ['validatorDeclarationDropped'],
		evaluate: overStageRun((stageRun) => {
			const rosterRow = stageRun.roster.rosterRows.find((oneRow) => oneRow.token === STANDARD_TOKEN);
			return {
				pass:
					rosterRow.disposition === 'declared' &&
					rosterRow.validatorPath === VALIDATOR_PATH &&
					stageRun.runFacts.requiredValidatorPath === VALIDATOR_PATH &&
					JSON.stringify(stageRun.roster.declaredTokens) === JSON.stringify([STANDARD_TOKEN]) &&
					typeof stageRun.validatorApi.validate === 'function' &&
					typeof stageRun.validatorApi.validateWithReader === 'function',
				detail: `disposition ${rosterRow.disposition}; validatorPath ${rosterRow.validatorPath}; required ${stageRun.runFacts.requiredValidatorPath}; declared [${stageRun.roster.declaredTokens}]`,
			};
		}),
	},
	{
		conjunctId: 'forgerResolvesThePinnedSnapshot',
		title: "resolveBundle resolves defaultSnapshot=01 to the bundle's own snapshot directory, the stage hands the validator exactly that directory, and the verdict names it",
		twinNameList: ['snapshotPointedAtIncumbent'],
		evaluate: overStageRun((stageRun) => {
			const rosterRow = stageRun.roster.rosterRows.find((oneRow) => oneRow.token === STANDARD_TOKEN);
			const { verdict } = stageRun.runFacts;
			return {
				pass: rosterRow.snapshotDirPath === PINNED_SNAPSHOT_DIR && stageRun.runFacts.handedSnapshotPath === PINNED_SNAPSHOT_DIR && verdict !== null && verdict.snapshotPath === PINNED_SNAPSHOT_DIR,
				detail: `roster snapshotDirPath ${rosterRow.snapshotDirPath}; handed ${stageRun.runFacts.handedSnapshotPath}; verdict snapshotPath ${verdict && verdict.snapshotPath}; ${stageFailureText(stageRun)}`,
			};
		}),
	},
];
registerTwin({
	gateId: STAGE_GATE_ID,
	conjunctId: 'stageClassifiesValidatorDeclared',
	twinName: 'validatorDeclarationDropped',
	applyFault: (subject) => ({ ...subject, resolverFault: (resolved) => ({ ...resolved, roundTripValidatorFileName: undefined }) }),
});
// the incumbent's snapshot holds the same TSV bytes, so the proof itself stays clean: only the
// snapshot conjunct can see the wrong directory
registerTwin({
	gateId: STAGE_GATE_ID,
	conjunctId: 'forgerResolvesThePinnedSnapshot',
	twinName: 'snapshotPointedAtIncumbent',
	applyFault: (subject) => ({ ...subject, resolverFault: (resolved) => ({ ...resolved, snapshotDirPath: INCUMBENT_SNAPSHOT_DIR }) }),
});

const gateDeclarationList = [
	{ gateId: VERDICT_GATE_ID, title: '(a) the verdict: clean, nothing invented, lost or changed, the 6,586 Containers omitted, the file byte for byte', conjunctList: verdictConjunctList },
	{ gateId: SHAPE_GATE_ID, title: '(b) the verdict carries the five normative fields', conjunctList: shapeConjunctList },
	{ gateId: STAGE_GATE_ID, title: 'the stage classifies the validator DECLARED and hands it the pinned snapshot', conjunctList: stageConjunctList },
];

runGateFamily({ harness, familyName: 'sif260928 A6 round trip', gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 10, expectedTwinCount: 13 }, () => {
	fs.rmSync(scratchRootPath, { recursive: true, force: true });
	harness.report();
});
