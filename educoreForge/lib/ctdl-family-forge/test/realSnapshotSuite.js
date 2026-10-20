'use strict';

// realSnapshotSuite.js — the shared real-snapshot test body for a CTDL-family forge bundle (ctdlHub-101926 P2): forge the
// bundle's pinned snapshot in process, assert the counts its expectation table names, round-trip it over the harness's
// graph double, and observe the round trip go RED on two perturbations. A bundle's own test supplies the expectation
// table (data); the assertions are written once. Docker-free; writes only under os.tmpdir().

const fs = require('fs');
const os = require('os');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const roundTripHarness = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();

const countBy = (itemList, nameOf) => itemList.reduce((counts, oneItem) => ({ ...counts, [nameOf(oneItem)]: (counts[nameOf(oneItem)] || 0) + 1 }), {});
const sortedText = (counts) => JSON.stringify(counts, Object.keys(counts).sort());
const copyOfForgeResult = (forgeResult) => ({ nodes: forgeResult.nodes.map((oneNode) => ({ ...oneNode, properties: { ...oneNode.properties } })), edges: forgeResult.edges.slice() });

// ⟪P2b⟫ expected.intendedEnrichmentList is the suite's own statement of the rows the bundle carries (written FIRST, so the suite is red
// until the profile turns a row on); expected.enrichmentEffectByRow gives each row's edges, retired omissions, crossRefs and examples
const enrichedCountFor = (expected, fieldName) => expected.intendedEnrichmentList.reduce((total, oneRow) => total + (expected.enrichmentEffectByRow[oneRow][fieldName] || 0), 0);
const omittedAfterEnrichmentFor = (expected) => {
	const remaining = { ...expected.explicitlyOmittedByKind };
	expected.intendedEnrichmentList.forEach((oneRow) => Object.keys(expected.enrichmentEffectByRow[oneRow].omittedDelta).forEach((kind) => { remaining[kind] -= expected.enrichmentEffectByRow[oneRow].omittedDelta[kind]; }));
	return Object.keys(remaining).filter((kind) => remaining[kind] !== 0).reduce((kept, kind) => ({ ...kept, [kind]: remaining[kind] }), {});
};
const profileRowListOf = (vocabularyProfile) => vocabularyProfile.enrichmentKindList.concat(
	vocabularyProfile.statusCarriedByTermKindList.indexOf('optionSet') !== -1 ? ['E9'] : [],
	vocabularyProfile.usageNoteCarriedByTermKindList.length > 1 ? ['E12'] : [],
).sort();

const runRealSnapshotSuite = ({ harness, bundle, validator, snapshotDirPath, sourceFileName, vocabularyProfile, expected }) => {
	const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), `${expected.standardSource}ForgeTest-`));
	const validateDouble = ({ forgeResult, caseName }, callback) => {
		const outputPath = path.join(scratchRootPath, caseName);
		fs.mkdirSync(outputPath, { recursive: true });
		validator.validateWithReader({ reader: roundTripHarness.graphDoubleFrom({ forgeResult }), snapshotPath: snapshotDirPath, outputPath }, callback);
	};
	const taskList = new taskListPlus();
	taskList.push((args, next) => bundle.forge({ sourcePath: path.join(snapshotDirPath, sourceFileName), owner: 'test', skipEmbedding: true }, (forgeError, forgeResult) => {
		harness.section(`SECTION 1 — ${expected.standardSource} snapshot forged in process: the July counts and the carriage rules`);
		harness.accepts('the real snapshot forges', forgeError ? [forgeError] : []);
		if (forgeError) {
			next(forgeError, args);
			return;
		}
		harness.equal('node count by role = the July oracle', sortedText(countBy(forgeResult.nodes, (oneNode) => oneNode.role)), sortedText(expected.nodeCountByRole));
		harness.equal('edge count = the July oracle + the P2b rows', forgeResult.edges.length, expected.edgeCount + enrichedCountFor(expected, 'edgeDelta'));
		harness.equal('root edges by type', sortedText(countBy(forgeResult.edges.filter((oneEdge) => oneEdge.fromRef.id === expected.rootStableId), (oneEdge) => oneEdge.type)), sortedText(expected.rootEdgeCountByType));
		Object.keys(expected.statByName).filter((statName) => statName !== 'crossRefTotal').forEach((statName) => harness.equal(`stats.${statName}`, forgeResult.stats[statName], expected.statByName[statName]));
		harness.equal('stats.crossRefTotal (+ E11)', forgeResult.stats.crossRefTotal, expected.statByName.crossRefTotal + enrichedCountFor(expected, 'crossRefDelta'));
		const rootNode = forgeResult.nodes.find((oneNode) => oneNode.role === 'DmeStandardRoot');
		harness.equal('root foreignTermEntryList carries the foreign entries (A5)', JSON.parse(rootNode.properties.foreignTermEntryList).length, expected.foreignTermEntryCount);
		harness.equal('root version and publishedVersion read from standardSourceLocation (V2)', `${rootNode.properties.version}|${rootNode.properties.publishedVersion}|${rootNode.properties.versionSource}`, expected.rootVersionText);
		harness.equal('root standardFamily', rootNode.properties.standardFamily, expected.standardFamily);
		const crossRefEntryList = forgeResult.nodes.reduce((entryList, oneNode) => entryList.concat(JSON.parse(oneNode.properties.crossRefs)), []);
		harness.ok('every crossRef is exactly { raw, locator } (R4)', crossRefEntryList.every((oneEntry) => JSON.stringify(Object.keys(oneEntry)) === '["raw","locator"]'));
		harness.equal('crossRef total (+ E11)', crossRefEntryList.length, expected.statByName.crossRefTotal + enrichedCountFor(expected, 'crossRefDelta'));
		harness.equal('the profile carries exactly the P2b rows the suite expects', JSON.stringify(profileRowListOf(vocabularyProfile)), JSON.stringify(expected.intendedEnrichmentList.slice().sort()));
		const nodeById = forgeResult.nodes.reduce((byId, oneNode) => ({ ...byId, [oneNode.stableId]: oneNode }), {});
		expected.intendedEnrichmentList.forEach((oneRow) => {
			const effect = expected.enrichmentEffectByRow[oneRow];
			if (effect.edgeType !== undefined) {
				const rowEdgeList = forgeResult.edges.filter((oneEdge) => oneEdge.type === effect.edgeType && oneEdge.properties.locator === effect.edgeLocator);
				harness.equal(`${oneRow}: ${effect.edgeType} edges`, rowEdgeList.length, effect.edgeDelta);
				effect.exampleEdgeList.forEach(([fromId, toId]) => harness.ok(`${oneRow}: ${fromId} -[${effect.edgeType}]-> ${toId}`, rowEdgeList.some((oneEdge) => oneEdge.fromRef.id === fromId && oneEdge.toRef.id === toId)));
			}
			if (effect.carriedPropertyName !== undefined) {
				const carrierList = forgeResult.nodes.filter((oneNode) => oneNode.properties[effect.carriedPropertyName] !== undefined && (effect.carriedRole === undefined || (effect.carriedRole === 'nonProperty' ? oneNode.role !== 'DmeProperty' : oneNode.role === effect.carriedRole)));
				harness.equal(`${oneRow}: ${effect.carriedPropertyName} carried on ${effect.carriedRole || 'any role'}`, carrierList.length, effect.carriedCount);
				effect.exampleIdList.forEach((oneId) => harness.ok(`${oneRow}: ${oneId} carries ${effect.carriedPropertyName}`, nodeById[oneId].properties[effect.carriedPropertyName] !== undefined));
			}
		});
		next('', { ...args, forgeResult });
	}));
	taskList.push((args, next) => validateDouble({ forgeResult: args.forgeResult, caseName: 'real' }, (validateError, verdict) => {
		harness.section('SECTION 2 — round trip over the graph double');
		harness.accepts('the validator runs', validateError ? [validateError] : []);
		if (validateError) {
			next(validateError, args);
			return;
		}
		harness.equal('inventedTotal 0, lostTotal 0, roundTripClean', `${verdict.inventedTotal}|${verdict.lostTotal}|${verdict.roundTripClean}`, '0|0|true');
		harness.equal('explicitly omitted, by declared kind, after the P2b rows', sortedText(countBy(verdict.explicitlyOmittedList, (oneItem) => oneItem.kind)), sortedText(omittedAfterEnrichmentFor(expected)));
		next('', args);
	}));
	[
		{ twinName: 'a structural edge dropped from the graph', caseName: 'twinEdge', perturb: (forgeResult) => ({ ...forgeResult, edges: forgeResult.edges.filter((oneEdge) => oneEdge !== forgeResult.edges.find((candidate) => candidate.type === expected.twinEdgeType && candidate.fromRef.id !== expected.rootStableId)) }) },
		{ twinName: 'one crossRef dropped from the graph', caseName: 'twinCrossRef', perturb: (forgeResult) => {
			const perturbed = copyOfForgeResult(forgeResult);
			const target = perturbed.nodes.find((oneNode) => JSON.parse(oneNode.properties.crossRefs).length > 0);
			target.properties.crossRefs = JSON.stringify(JSON.parse(target.properties.crossRefs).slice(1));
			return perturbed;
		} },
	].forEach((oneTwin, twinIndex) => taskList.push((args, next) => validateDouble({ forgeResult: oneTwin.perturb(args.forgeResult), caseName: oneTwin.caseName }, (validateError, verdict) => {
		if (twinIndex === 0) {
			harness.section('SECTION 3 — the round-trip instrument observed RED');
		}
		harness.ok(`RED-OBSERVED: ${oneTwin.twinName} → lost ${verdict && verdict.lostTotal}`, !validateError && verdict.lostTotal >= 1 && verdict.roundTripClean === false, validateError);
		next('', args);
	})));
	pipeRunner(taskList.getList(), {}, (pipeError) => {
		if (pipeError) {
			harness.ok('the suite ran to the end', false, pipeError);
		}
		fs.rmSync(scratchRootPath, { recursive: true, force: true });
		harness.report();
	});
};

module.exports = { runRealSnapshotSuite };
