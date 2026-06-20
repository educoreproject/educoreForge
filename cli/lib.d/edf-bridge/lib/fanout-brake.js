'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// fanout-brake.js — PURE Gemini Risk-2 fan-out brake for -implied Stage-2 (Phase III).
//
// Applied PER SOURCE ELEMENT to its calibrated candidate list. Two configurable gates stop a
// loose/vague hub (a source vaguely similar to MANY targets) from emitting a large spray of
// low-confidence edges:
//   1. FLOOR  — drop every candidate whose calibratedConfidence < fanout.confidenceFloor.
//   2. CAP    — of those that survive the floor, keep at most fanout.maxFanOut (highest confidence
//               first). -implied is legitimately 1:many, but bounded.
// Both are DATA (rerank-config.json fanout.*). Pure: no I/O. The brake REPORTS what it dropped so the
// effect is auditable (the loose-hub gate is visible, never silent). camelCase only.

// applyBrake — { candidates, config } -> { kept, droppedByFloor, droppedByCap, consideredCount, floor, cap }
//   candidates: [ { stableId, calibratedConfidence, ... } ]  (other fields passed through on kept)
const applyBrake = ({ candidates, config } = {}) => {
	const list = Array.isArray(candidates) ? candidates : [];
	const floor = config && config.fanout ? config.fanout.confidenceFloor : 0.3;
	const cap = config && config.fanout ? config.fanout.maxFanOut : 5;

	const consideredCount = list.length;

	const aboveFloor = list.filter(
		(candidate) =>
			typeof candidate.calibratedConfidence === 'number' &&
			candidate.calibratedConfidence >= floor,
	);
	const droppedByFloor = consideredCount - aboveFloor.length;

	// stable sort by calibrated confidence DESC (ties keep input order).
	const sorted = aboveFloor
		.map((candidate, index) => ({ candidate, index }))
		.sort((a, b) => {
			const diff = b.candidate.calibratedConfidence - a.candidate.calibratedConfidence;
			if (diff !== 0) {
				return diff;
			}
			return a.index - b.index;
		})
		.map((wrapped) => wrapped.candidate);

	const kept = sorted.slice(0, cap);
	const droppedByCap = sorted.length - kept.length;

	return {
		kept,
		droppedByFloor,
		droppedByCap,
		consideredCount,
		keptCount: kept.length,
		floor,
		cap,
	};
};

module.exports = { moduleName, applyBrake };
