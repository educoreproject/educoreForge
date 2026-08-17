'use strict';

// p1_seatStampCensus.js — LUNAR_PRISM (P1), 2026-08-17.
//
// READS THE ARTIFACT. The three suites going green proves my edits broke nothing; it does NOT prove
// the seat was stamped, or stamped CORRECTLY, because no shipped assertion mentions it yet. A
// measurement of the emitted graph is the only thing that does. This drives the REAL forge through
// the SAME entry path forger.js uses ({ sourcePath, owner, skipEmbedding: true }) — no Docker, no
// embedder, no container, no store.
//
// WHAT IT ESTABLISHES
//   1. the seat is stamped on every composed source-tier declaration, and NOWHERE ELSE
//   2. ⚠️ THE REQUIRED GATE (SABLE_RIVER, P1-R8 companion edit 2): NO S-1c MERGED CHILD CARRIES THE
//      SOURCE CHILD'S owningTypeName WHERE THE MERGED OWNER DIFFERS. Omitting the registry entry is
//      SILENT — three unregistered properties would enter inheritedPropertyNamesOf and could change
//      decidedNonSignaturePropertyNames, which is STAMPED ONTO THE NODE. Census content moving
//      quietly, through a path with nothing to do with the seat. A COMPANION EDIT WHOSE OMISSION IS
//      SILENT NEEDS A LEVER THAT MAKES THE OMISSION LOUD.
//   3. THE PROSE-SOURCE CENSUS — own / resolvedType / none across the composed declarations. This is
//      the number that makes REPORT-P0's 71.5% evidence claim MEASURABLE ON THE SHIPPED ARTIFACT
//      instead of quoted from a report, and re-derivable by anyone at any later date. It is the whole
//      reason proseSource is stamped at all.
//
// REPORTS THE ASSERTION COUNT REACHED BESIDE THE FAILURE COUNT, always. "0 failed" meant "nothing
// ran" once in this order already.

const path = require('path');

const moduleName = 'p1_seatStampCensus';
const BUNDLE_DIR = path.join(__dirname, '..', '..');
// the SAME path the shipped suite pins (test-pesc260805SourceTier.js:40) and the same one
// parserDescriptor.ini's defaultSnapshot=01 names. My first attempt guessed 'assets/01' and the
// parser REFUSED BY NAME rather than forging an empty corpus — the no-silent-default discipline
// paying for itself on my own mistake.
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');

const SEAT_NAME_LIST = ['effectiveDescription', 'owningTypeName', 'proseSource'];
const COMPOSED_LABEL_LIST = ['PescElementDecl', 'PescAttributeDecl'];
const SOURCE_TIER = 'source';
const SYNTHETIC_TIER = 'synthetic';

const resultList = [];
let assertionsReached = 0;
let failedCount = 0;

const assert = ({ name, pass, detail }) => {
	assertionsReached += 1;
	if (!pass) {
		failedCount += 1;
	}
	resultList.push({ name, verdict: pass ? 'PASS' : 'FAIL', detail });
};

const labelHas = (oneNode, oneLabel) => Array.isArray(oneNode.labels) && oneNode.labels.indexOf(oneLabel) !== -1;
const isComposedLabel = (oneNode) => COMPOSED_LABEL_LIST.some((oneLabel) => labelHas(oneNode, oneLabel));

const report = (extra) => {
	process.stdout.write(
		`${JSON.stringify(
			{
				probe: moduleName,
				assertionsReached,
				failedCount,
				verdict: assertionsReached === 0 ? 'VACUOUS — NOTHING RAN' : failedCount === 0 ? 'ALL GREEN' : 'RED',
				...extra,
				resultList,
			},
			null,
			2,
		)}\n`,
	);
	process.exitCode = failedCount === 0 && assertionsReached > 0 ? 0 : 1;
};

const entryBundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

entryBundle.forge({ sourcePath: SNAPSHOT_DIR, owner: moduleName, skipEmbedding: true }, (forgeError, forged) => {
	if (forgeError) {
		assert({ name: 'FORGE RUN', pass: false, detail: `forge refused: ${forgeError}` });
		report({});
		return;
	}
	assert({ name: 'FORGE RUN completes and returns nodes[]', pass: Array.isArray(forged.nodes), detail: `${forged.nodes.length} nodes` });

	const nodeByStableId = {};
	forged.nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
	});

	// ---------------------------------------------------------------------------------------------
	// 1. THE SEAT IS STAMPED WHERE IT SHOULD BE, AND NOWHERE ELSE
	// ---------------------------------------------------------------------------------------------
	const composedSourceNodeList = forged.nodes.filter(
		(oneNode) => isComposedLabel(oneNode) && oneNode.properties.pescTier === SOURCE_TIER,
	);
	const missingSeatList = composedSourceNodeList.filter((oneNode) =>
		SEAT_NAME_LIST.some((oneName) => oneNode.properties[oneName] === undefined),
	);
	assert({
		name: 'SEAT every composed SOURCE-tier declaration carries all three seat properties',
		pass: composedSourceNodeList.length > 0 && missingSeatList.length === 0,
		detail: `${composedSourceNodeList.length} composed source nodes; ${missingSeatList.length} missing a seat property${missingSeatList.length ? ` (e.g. ${missingSeatList[0].stableId})` : ''}`,
	});

	// NON-VACUITY. A population of zero would make every assertion above pass while measuring nothing.
	assert({
		name: 'SEAT the composed source population is NON-EMPTY (guards against a vacuous green)',
		pass: composedSourceNodeList.length > 10000,
		detail: `${composedSourceNodeList.length} composed source-tier declarations`,
	});

	const nonComposedWithSeatList = forged.nodes.filter(
		(oneNode) =>
			!(isComposedLabel(oneNode) && (oneNode.properties.pescTier === SOURCE_TIER || oneNode.properties.pescTier === SYNTHETIC_TIER)) &&
			SEAT_NAME_LIST.some((oneName) => oneNode.properties[oneName] !== undefined),
	);
	assert({
		name: 'SEAT no node OUTSIDE the composed labels carries a seat property (no tier leakage)',
		pass: nonComposedWithSeatList.length === 0,
		detail: `${nonComposedWithSeatList.length} stray${nonComposedWithSeatList.length ? ` (e.g. ${nonComposedWithSeatList[0].stableId}, labels ${nonComposedWithSeatList[0].labels.join('+')})` : ''}`,
	});

	// ---------------------------------------------------------------------------------------------
	// 2. THE REQUIRED GATE — S-1c merged children carry the MERGED owner, never the source child's
	// ---------------------------------------------------------------------------------------------
	const mergedChildList = forged.nodes.filter(
		(oneNode) => oneNode.properties.pescTier === SYNTHETIC_TIER && typeof oneNode.properties.copiedFromStableId === 'string' && isComposedLabel(oneNode),
	);
	assert({
		name: 'S-1c the merged-child population is NON-EMPTY (a zero here would make the gate below vacuous)',
		pass: mergedChildList.length > 0,
		detail: `${mergedChildList.length} S-1c merged children`,
	});

	const inheritedOwnerList = [];
	let ownerDiffersCount = 0;
	mergedChildList.forEach((oneChild) => {
		const sourceChild = nodeByStableId[oneChild.properties.copiedFromStableId];
		if (sourceChild === undefined) {
			return;
		}
		const sourceOwner = sourceChild.properties.owningTypeName;
		const childOwner = oneChild.properties.owningTypeName;
		if (sourceOwner === childOwner) {
			return;
		}
		// the owners genuinely differ — which is the ONLY condition under which inheritance is
		// detectable at all. A merged child whose owner happens to equal its source child's tells us
		// nothing either way, so it is excluded rather than counted as a pass.
		ownerDiffersCount += 1;
		if (childOwner === sourceOwner) {
			inheritedOwnerList.push({ childStableId: oneChild.stableId, sourceOwner, childOwner });
		}
	});
	// the discriminating check: does any merged child carry a value that EQUALS its source child's
	// owner while the merged definition's own name differs? Recomputed independently of the loop above
	// so a bug in the loop cannot manufacture a pass.
	const inheritedOwnerRecheckList = mergedChildList.filter((oneChild) => {
		const sourceChild = nodeByStableId[oneChild.properties.copiedFromStableId];
		if (sourceChild === undefined) {
			return false;
		}
		const mergedDefinition = nodeByStableId[oneChild.properties.parentId];
		const mergedOwnerName = mergedDefinition === undefined ? undefined : mergedDefinition.properties.name;
		return (
			mergedOwnerName !== undefined &&
			sourceChild.properties.owningTypeName !== mergedOwnerName &&
			oneChild.properties.owningTypeName === sourceChild.properties.owningTypeName
		);
	});
	assert({
		name: '⚠️ GATE no S-1c merged child carries the SOURCE child\'s owningTypeName where the merged owner differs',
		pass: inheritedOwnerRecheckList.length === 0,
		detail: `${inheritedOwnerRecheckList.length} inherited-owner violation(s)${inheritedOwnerRecheckList.length ? ` (e.g. ${inheritedOwnerRecheckList[0].stableId})` : ''}; ${ownerDiffersCount} of ${mergedChildList.length} merged children have an owner differing from their source child`,
	});
	assert({
		name: 'GATE the gate is DISCRIMINATING — at least one merged child HAS an owner differing from its source child, so a pass is not vacuous',
		pass: ownerDiffersCount > 0,
		detail: `${ownerDiffersCount} merged children where source owner !== merged owner`,
	});

	const mergedOwnerMatchList = mergedChildList.filter((oneChild) => {
		const mergedDefinition = nodeByStableId[oneChild.properties.parentId];
		return mergedDefinition !== undefined && oneChild.properties.owningTypeName === mergedDefinition.properties.name;
	});
	assert({
		name: 'S-1c every merged child\'s owningTypeName EQUALS its merged definition\'s name (the positive statement, not merely the absence of the negative)',
		pass: mergedOwnerMatchList.length === mergedChildList.length,
		detail: `${mergedOwnerMatchList.length} of ${mergedChildList.length} match the merged definition's name`,
	});

	// ---------------------------------------------------------------------------------------------
	// 3. THE PROSE-SOURCE CENSUS — the deliverable that makes 71.5% measurable on the artifact
	// ---------------------------------------------------------------------------------------------
	const proseSourceCensusByLabel = {};
	COMPOSED_LABEL_LIST.forEach((oneLabel) => {
		proseSourceCensusByLabel[oneLabel] = { own: 0, resolvedType: 0, none: 0, other: 0, total: 0 };
	});
	const unexpectedProseSourceList = [];
	composedSourceNodeList.forEach((oneNode) => {
		const oneLabel = COMPOSED_LABEL_LIST.find((oneCandidate) => labelHas(oneNode, oneCandidate));
		const bucket = proseSourceCensusByLabel[oneLabel];
		const oneProseSource = oneNode.properties.proseSource;
		bucket.total += 1;
		if (oneProseSource === 'own' || oneProseSource === 'resolvedType' || oneProseSource === 'none') {
			bucket[oneProseSource] += 1;
			return;
		}
		bucket.other += 1;
		if (unexpectedProseSourceList.length < 3) {
			unexpectedProseSourceList.push({ stableId: oneNode.stableId, proseSource: oneProseSource });
		}
	});
	assert({
		name: 'CENSUS every proseSource is one of the three declared values (an unexpected value would make the census unreadable)',
		pass: unexpectedProseSourceList.length === 0,
		detail: unexpectedProseSourceList.length === 0 ? 'all values in {own, resolvedType, none}' : JSON.stringify(unexpectedProseSourceList),
	});

	const elementCensus = proseSourceCensusByLabel.PescElementDecl;
	const withProse = elementCensus.own + elementCensus.resolvedType;
	const coveragePercent = elementCensus.total === 0 ? null : Number(((withProse / elementCensus.total) * 100).toFixed(2));
	assert({
		name: 'CENSUS evidence coverage on PescElementDecl is stamped and re-derivable — reported, not asserted against a target',
		pass: coveragePercent !== null,
		detail: `own ${elementCensus.own} + resolvedType ${elementCensus.resolvedType} = ${withProse} of ${elementCensus.total} = ${coveragePercent}% (REPORT-P0 §5.2 predicts ~71.5%; this figure is MEASURED ON THE ARTIFACT and is the one to quote from now on)`,
	});

	report({
		note: 'A failure count without the assertion count reached cannot distinguish a clean pass from a suite that aborted before asserting anything.',
		proseSourceCensusByLabel,
		evidenceCoveragePercentOnElementDeclarations: coveragePercent,
		mergedChildCount: mergedChildList.length,
		composedSourceDeclarationCount: composedSourceNodeList.length,
	});
});
