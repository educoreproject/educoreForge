'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// calibrate.js — PURE confidence calibration for -implied Stage-2 (Phase III), v0.
//
// v0 IS THE IDENTITY: calibratedConfidence = clamp01(rawScore), stamped calibrationVersion
// 'uncalibrated-v0'. This is the HONEST choice and it is deliberate: the only ground truth is the
// handful of SPECIFIED anchors (6 for LIF), which "fit no curve" — fabricating a calibration mapping
// from them would overfit and misrepresent confidence. So v0 passes the reranker's raw composite
// through unchanged and labels it uncalibrated. The WRITE FLOOR (the "plus-floor") is NOT applied
// here — it is enforced downstream by the fan-out brake (fanout-brake.js), keeping calibration (a
// value transform) separate from admission (a gate). Real per-pair calibration is a future lever once
// the SPECIFIED-anchor pool grows across more standards. camelCase only; no I/O.

const clamp01 = (x) => {
	if (typeof x !== 'number' || Number.isNaN(x)) {
		return 0;
	}
	if (x < 0) {
		return 0;
	}
	if (x > 1) {
		return 1;
	}
	return x;
};

// calibrate — { rawScore, config } -> { calibratedConfidence, calibrationVersion, rawScore }
const calibrate = ({ rawScore, config } = {}) => {
	const version =
		config && config.calibration && config.calibration.version
			? config.calibration.version
			: 'uncalibrated-v0';
	return {
		rawScore: clamp01(rawScore),
		calibratedConfidence: clamp01(rawScore), // identity — no curve fit on 6 anchors
		calibrationVersion: version,
	};
};

module.exports = { moduleName, calibrate, clamp01 };
