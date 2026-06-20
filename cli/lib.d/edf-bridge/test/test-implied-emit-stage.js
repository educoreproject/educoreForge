#!/usr/bin/env node
'use strict';

// test-implied-emit-stage.js — Phase-III gate for -implied Stage-2 emit-stage logic (all PURE; no
// graph). Covers classifyPredicate (SKOS, independent of confidence), calibrate v0 (identity +
// version), and the Gemini Risk-2 fan-out brake (floor + cap), INCLUDING a synthetic loose-hub
// fixture provably capped by the brake (before/after edge count). NO edges are emitted in Phase III.
//
// Run: node test/test-implied-emit-stage.js

const { classifyPredicate } = require('../lib/classify-predicate');
const { calibrate, clamp01 } = require('../lib/calibrate');
const { applyBrake } = require('../lib/fanout-brake');
const config = require('../lib/rerank-config.json');

let passCount = 0;
let failCount = 0;
const check = (label, condition) => {
	if (condition) {
		passCount++;
		console.log(`  PASS  ${label}`);
	} else {
		failCount++;
		console.log(`  FAIL  ${label}`);
	}
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------
console.log('\n========== classifyPredicate (SKOS axis) ==========');

const cp = (signals, sourceOptionNames, targetOptionNames) =>
	classifyPredicate({ signals, sourceOptionNames, targetOptionNames, config }).matchPredicate;

check('exactMatch: high equivalence, no options', cp({ nameJaccard: 1.0, descriptionEmbed: 0.9 }) === 'exactMatch');
check('closeMatch: mid equivalence (0.6), no options', cp({ nameJaccard: 0.6, descriptionEmbed: 0.6 }) === 'closeMatch');
check('relatedMatch: low equivalence (0.3), no options', cp({ nameJaccard: 0.3, descriptionEmbed: 0.3 }) === 'relatedMatch');
check('broadMatch: source options ⊂ target options', cp({ nameJaccard: 0.3, descriptionEmbed: 0.3 }, ['Male'], ['Male', 'Female', 'Unknown']) === 'broadMatch');
check('narrowMatch: target options ⊂ source options', cp({ nameJaccard: 0.3, descriptionEmbed: 0.3 }, ['Male', 'Female', 'Unknown'], ['Female']) === 'narrowMatch');
check('exactMatch: high equivalence AND equal option sets', cp({ nameJaccard: 1.0, descriptionEmbed: 0.9 }, ['Yes', 'No'], ['Yes', 'No']) === 'exactMatch');
check('containment OVERRIDES equivalence band (high equiv but source⊂target -> broadMatch)', cp({ nameJaccard: 1.0, descriptionEmbed: 0.95 }, ['Male'], ['Male', 'Female']) === 'broadMatch');
// independence of confidence: predicate is computed from signals only, never from a confidence value.
const indep = classifyPredicate({ signals: { nameJaccard: 0.9, descriptionEmbed: 0.9 }, config });
check('predicate independent of confidence (no confidence input consulted)', indep.matchPredicate === 'exactMatch' && typeof indep.equivalence === 'number');

// ---------------------------------------------------------------------------------------------
console.log('\n========== calibrate v0 (identity + version) ==========');

const c1 = calibrate({ rawScore: 0.368, config });
check('calibrate identity: calibratedConfidence === rawScore', c1.calibratedConfidence === 0.368);
check('calibrate stamps calibrationVersion uncalibrated-v0', c1.calibrationVersion === 'uncalibrated-v0');
check('calibrate clamps >1 to 1', calibrate({ rawScore: 1.5, config }).calibratedConfidence === 1);
check('calibrate clamps <0 to 0', calibrate({ rawScore: -0.2, config }).calibratedConfidence === 0);
check('calibrate is the identity over [0,1]', [0, 0.25, 0.5, 0.75, 1].every((v) => near(calibrate({ rawScore: v, config }).calibratedConfidence, clamp01(v))));

// ---------------------------------------------------------------------------------------------
console.log('\n========== fan-out brake (floor + cap) ==========');

check('config defaults surfaced: floor 0.30, cap 5', config.fanout.confidenceFloor === 0.30 && config.fanout.maxFanOut === 5);

// floor drops below-floor candidates
const floorCase = applyBrake({
	candidates: [
		{ stableId: 'a', calibratedConfidence: 0.5 },
		{ stableId: 'b', calibratedConfidence: 0.29 },
		{ stableId: 'c', calibratedConfidence: 0.31 },
	],
	config,
});
check('brake floor drops conf<0.30 (b dropped)', floorCase.droppedByFloor === 1 && floorCase.kept.every((k) => k.stableId !== 'b'));

// cap keeps only top maxFanOut, highest confidence first
const capCase = applyBrake({
	candidates: [
		{ stableId: 'p1', calibratedConfidence: 0.91 },
		{ stableId: 'p2', calibratedConfidence: 0.95 },
		{ stableId: 'p3', calibratedConfidence: 0.80 },
		{ stableId: 'p4', calibratedConfidence: 0.70 },
		{ stableId: 'p5', calibratedConfidence: 0.60 },
		{ stableId: 'p6', calibratedConfidence: 0.55 },
		{ stableId: 'p7', calibratedConfidence: 0.50 },
	],
	config,
});
check('brake cap keeps exactly maxFanOut (5)', capCase.keptCount === 5 && capCase.droppedByCap === 2);
check('brake cap keeps the highest-confidence first (p2 top)', capCase.kept[0].stableId === 'p2' && capCase.kept[0].calibratedConfidence === 0.95);
check('brake cap drops the two lowest (p6,p7)', capCase.kept.every((k) => k.stableId !== 'p6' && k.stableId !== 'p7'));

// tight case: under cap, above floor -> all kept
const tight = applyBrake({
	candidates: [
		{ stableId: 'x', calibratedConfidence: 0.7 },
		{ stableId: 'y', calibratedConfidence: 0.4 },
	],
	config,
});
check('brake passes through when under cap and above floor', tight.keptCount === 2 && tight.droppedByFloor === 0 && tight.droppedByCap === 0);

// SYNTHETIC LOOSE-HUB fixture: 20 candidates a vague hub WOULD spray; 12 below floor, 8 above (cap 5).
const looseHub = [];
for (let i = 0; i < 12; i++) {
	looseHub.push({ stableId: `low${i}`, calibratedConfidence: 0.10 + i * 0.015 }); // 0.10..0.265 (all < 0.30)
}
for (let i = 0; i < 8; i++) {
	looseHub.push({ stableId: `hi${i}`, calibratedConfidence: 0.35 + i * 0.05 }); // 0.35..0.70 (all >= 0.30)
}
const braked = applyBrake({ candidates: looseHub, config });
console.log(`  loose-hub: BEFORE=${braked.consideredCount} edges -> AFTER=${braked.keptCount} edges (droppedByFloor=${braked.droppedByFloor}, droppedByCap=${braked.droppedByCap})`);
check('LOOSE-HUB before=20 considered', braked.consideredCount === 20);
check('LOOSE-HUB floor drops all 12 sub-0.30', braked.droppedByFloor === 12);
check('LOOSE-HUB cap holds the 8 survivors to 5', braked.keptCount === 5 && braked.droppedByCap === 3);
check('LOOSE-HUB provably capped: after (5) <= maxFanOut AND all kept >= floor', braked.keptCount <= config.fanout.maxFanOut && braked.kept.every((k) => k.calibratedConfidence >= config.fanout.confidenceFloor));
check('LOOSE-HUB kept are the highest-confidence survivors (hi7..hi3)', braked.kept.map((k) => k.stableId).join(',') === 'hi7,hi6,hi5,hi4,hi3');

// ---------------------------------------------------------------------------------------------
console.log(`\n==================== RESULT ====================`);
console.log(`  PASS: ${passCount}   FAIL: ${failCount}`);
console.log(`  ${failCount === 0 ? 'GREEN' : 'RED'}`);
console.log(`================================================\n`);
process.exit(failCount === 0 ? 0 : 1);
