#!/usr/bin/env node
// RETAINED DELIBERATELY, AND THE REASON IS A CRITICISM THIS BUILDER LEVELLED AT SOMEONE ELSE.
// DEVLOG-P-pescBridge.md §4 records that the P0 composition test spent 2,621 embedding texts whose
// script and texts were NOT retained, so its winning composition can never be checked byte-for-byte
// against what the forge later emitted. Reporting figures from a script in a scratchpad that gets
// deleted would have been the same failure one order later. So the measurement tools behind the
// numbers in that DEVLOG live here.
//
// THIS IS A MEASUREMENT TOOL, NOT A GATE. No suite runs it, it declares no assertions, and it
// contributes no label to test/redEvidenceLedger.json. Do not read a clean run as certification.
//
// CONNECTION DETAILS GO STALE: any bolt port or password below belonged to a container that existed
// on 2026-08-17 and does not now. Re-resolve with `docker inspect` before re-running; the hub cards
// come from whichever container currently holds the CEDS hub.
'use strict';

// diagnose220.js — AZURE_DELTA. Prediction C committed C2 12,127 / C0 4,842 at declaration grain,
// derived from REPORT §9.3's "declarations gaining text 12,127" and §5.2's "left with no prose
// 4,842". The forge emitted 11,907 / 5,062 — 220 declarations sit on the other arm.
//
// THE NAMED UNKNOWN FROM THE PREDICTIONS MESSAGE, now tested: "§5.1/§5.2 counted 'non-empty'; the
// shared composer's cleanSegment treats whitespace-only as absent. I will treat non-empty-after-trim
// as present ... I do not know today whether they differ."
//
// This computes the effective-description population BOTH WAYS over the identical corpus:
//   NON-EMPTY (the report's rule):            description !== ''
//   NON-EMPTY AFTER TRIM (the composer's):    description.trim() !== ''
// If the first reproduces 12,127 and the second reproduces 11,907, the 220 is fully explained and
// the cause is the rule, not the resolution.

const path = require('path');

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const BUNDLE_DIR =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/forges/pesc260805';
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');

const bundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

bundle.forge({ sourcePath: SNAPSHOT_DIR, skipEmbedding: true }, (err, result) => {
	if (err) {
		console.error(`FORGE ERROR: ${err}`);
		process.exit(1);
	}
	const { nodes, edges } = result;

	const nodeByStableId = {};
	nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
	});
	const resolvesToTargetsByFromStableId = {};
	edges.forEach((oneEdge) => {
		if (oneEdge.type !== 'RESOLVES_TO') {
			return;
		}
		(resolvesToTargetsByFromStableId[oneEdge.fromRef.id] =
			resolvesToTargetsByFromStableId[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
	});

	const sourceElementDecls = nodes.filter(
		(oneNode) =>
			oneNode.labels.indexOf('PescElementDecl') !== -1 && oneNode.properties.pescTier === 'source',
	);

	// the two rules, as named predicates rather than inline conditions, so the report can say which
	// one produced which number.
	const RULE_REGISTRY = {
		reportRuleNonEmpty: (oneText) => `${oneText == null ? '' : oneText}` !== '',
		composerRuleNonEmptyAfterTrim: (oneText) => `${oneText == null ? '' : oneText}`.trim() !== '',
	};

	const tally = {};
	Object.keys(RULE_REGISTRY).forEach((oneRuleName) => {
		tally[oneRuleName] = { own: 0, resolvedType: 0, none: 0, effectivePresent: 0 };
	});

	// the disagreement cases, enumerated rather than counted, so the cause is inspectable
	const disagreementExamples = [];
	let ownWhitespaceOnly = 0;
	let resolvedTypeWhitespaceOnly = 0;
	let resolvesToTargetCount = 0;
	let noResolvesToTarget = 0;

	sourceElementDecls.forEach((oneNode) => {
		const ownDescription = oneNode.properties.description;
		const targetStableIdList = resolvesToTargetsByFromStableId[oneNode.stableId] || [];
		if (targetStableIdList.length === 0) {
			noResolvesToTarget++;
		} else {
			resolvesToTargetCount++;
		}
		const targetNode =
			targetStableIdList.length === 1 ? nodeByStableId[targetStableIdList[0]] : undefined;
		const resolvedDescription = targetNode === undefined ? '' : targetNode.properties.description;

		if (
			RULE_REGISTRY.reportRuleNonEmpty(ownDescription) &&
			!RULE_REGISTRY.composerRuleNonEmptyAfterTrim(ownDescription)
		) {
			ownWhitespaceOnly++;
		}
		if (
			RULE_REGISTRY.reportRuleNonEmpty(resolvedDescription) &&
			!RULE_REGISTRY.composerRuleNonEmptyAfterTrim(resolvedDescription)
		) {
			resolvedTypeWhitespaceOnly++;
		}

		Object.keys(RULE_REGISTRY).forEach((oneRuleName) => {
			const isPresent = RULE_REGISTRY[oneRuleName];
			if (isPresent(ownDescription)) {
				tally[oneRuleName].own++;
				tally[oneRuleName].effectivePresent++;
				return;
			}
			if (isPresent(resolvedDescription)) {
				tally[oneRuleName].resolvedType++;
				tally[oneRuleName].effectivePresent++;
				return;
			}
			tally[oneRuleName].none++;
		});

		// a declaration the two rules DISAGREE about
		const reportSaysPresent =
			RULE_REGISTRY.reportRuleNonEmpty(ownDescription) ||
			RULE_REGISTRY.reportRuleNonEmpty(resolvedDescription);
		const composerSaysPresent =
			RULE_REGISTRY.composerRuleNonEmptyAfterTrim(ownDescription) ||
			RULE_REGISTRY.composerRuleNonEmptyAfterTrim(resolvedDescription);
		if (reportSaysPresent !== composerSaysPresent && disagreementExamples.length < 8) {
			disagreementExamples.push({
				stableId: oneNode.stableId,
				name: oneNode.properties.name,
				ownDescription: JSON.stringify(ownDescription),
				resolvedDescription: JSON.stringify(resolvedDescription),
			});
		}
	});

	console.log(`source-tier PescElementDecl: ${sourceElementDecls.length}`);
	console.log(`  with exactly one RESOLVES_TO target: ${resolvesToTargetCount}`);
	console.log(`  with none: ${noResolvesToTarget}`);
	console.log('');
	console.log('EFFECTIVE-DESCRIPTION POPULATION, TWO RULES OVER THE IDENTICAL CORPUS');
	Object.keys(tally)
		.sort()
		.forEach((oneRuleName) => {
			const oneTally = tally[oneRuleName];
			console.log(
				`  ${oneRuleName.padEnd(34)} present ${oneTally.effectivePresent}  ` +
					`(own ${oneTally.own} + viaResolvesTo ${oneTally.resolvedType})  absent ${oneTally.none}`,
			);
		});
	console.log('');
	console.log(`PREDICTED (report rule):  C2 12127 / C0 4842`);
	console.log(
		`report rule reproduces:   C2 ${tally.reportRuleNonEmpty.effectivePresent} / C0 ${tally.reportRuleNonEmpty.none}`,
	);
	console.log(
		`composer rule reproduces: C2 ${tally.composerRuleNonEmptyAfterTrim.effectivePresent} / C0 ${tally.composerRuleNonEmptyAfterTrim.none}`,
	);
	console.log('');
	console.log(
		`declarations whose OWN description is whitespace-only:           ${ownWhitespaceOnly}`,
	);
	console.log(
		`declarations whose RESOLVED TYPE description is whitespace-only: ${resolvedTypeWhitespaceOnly}`,
	);
	console.log(
		`declarations the two rules DISAGREE about:                       ${tally.reportRuleNonEmpty.effectivePresent - tally.composerRuleNonEmptyAfterTrim.effectivePresent}`,
	);
	console.log('');
	console.log('DISAGREEMENT EXAMPLES (the whitespace made visible by JSON escaping):');
	disagreementExamples.forEach((oneExample) => {
		console.log(`  ${oneExample.name}`);
		console.log(`     own      = ${oneExample.ownDescription}`);
		console.log(`     resolved = ${oneExample.resolvedDescription.substring(0, 90)}`);
	});
});
