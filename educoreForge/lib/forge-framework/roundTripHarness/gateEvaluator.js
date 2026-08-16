'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// gateEvaluator.js — the gate evaluator + the twin SWEEP (SPEC-forgeFramework-v1.md §10, §10.3;
// Profile §11.1, §11.3). Conventions it enforces: every gate ASSERTS (a conjunct that cannot be
// evaluated is UNMEASURED, a failure, never a skip); no standing expectFail; the sweep counts
// observed-red PER CONJUNCT — a gate with four conjuncts and one twin reports three UNPROVEN, not
// "observed red"; a twin registered expectationLever does not count; a no-op twin reports DEFECTIVE;
// a twin that cannot be APPLIED (its run throws — e.g. a stale mutation find) proves nothing and the
// conjunct is UNPROVEN, never red (FA1, adversarial review 2026-08-16).
//
// Shapes (DATA):
//   gateDeclarationList  [{ gateId, title, conjunctList: [{ conjunctId, title, twinNameList?, evaluate }] }]
//     evaluate(subject, callback(errString, { pass: boolean, detail? }))  — callback-shaped, so a
//     conjunct may run a whole forge(); a throw or a non-boolean pass → UNMEASURED.
//   subject              the gate's SUBJECT — production input or configuration a twin mutates
//                        (a scenario object: framework deps, declaration, hooks, forge args, module
//                        mutations, …). cloneSubject(subject) → a fresh copy for each twin run.
//
//   evaluateGates({ gateDeclarationList, subject, cloneSubject? }, cb) → { gateResultList, accepted, ... }
//     (with cloneSubject every conjunct sees a FRESH copy, so one conjunct's input shaping never leaks)
//   sweepTwins({ gateDeclarationList, twinRegistry, subject, cloneSubject }, cb) → the per-conjunct
//     sweep report: observedRed | DEFECTIVE | UNPROVEN | FAILING(baseline red) per conjunct.
//
// Callback error-first throughout; serial recursion, no async/await. The TWO try/catch blocks here
// (evaluateConjunct, and the twin `run` in sweepTwins) translate a CALLER-SUPPLIED gate function's
// THROW into a status VALUE — UNMEASURED for a conjunct, "twin proved nothing" for a twin — so a
// throwing gate cannot crash the sweep. This is the DOCTRINE's sanctioned boundary translation into an
// error value, not control flow; ruled ACCEPTED by the supervisor (SABLE_RIVER, 2026-08-16 06:04, F3a
// review) alongside the framework's ONE adapter in forge-framework.js.

const { COUNTING_LEVER_KIND_LIST } = require('./twinRegistry');

const CONJUNCT_STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNMEASURED: 'UNMEASURED' });
const SWEEP_STATUS = Object.freeze({
	OBSERVED_RED: 'observedRed',
	DEFECTIVE: 'DEFECTIVE',
	UNPROVEN: 'UNPROVEN',
	FAILING: 'FAILING',
});

const validateGateDeclarationList = (gateDeclarationList) => {
	if (!Array.isArray(gateDeclarationList) || gateDeclarationList.length === 0) {
		return `${moduleName} REFUSED: gateDeclarationList must be a non-empty array`;
	}
	const seenGateIds = {};
	for (let gateIndex = 0; gateIndex < gateDeclarationList.length; gateIndex++) {
		const oneGate = gateDeclarationList[gateIndex];
		if (!oneGate || typeof oneGate.gateId !== 'string' || oneGate.gateId.length === 0) {
			return `${moduleName} REFUSED: gate declaration ${gateIndex} lacks gateId`;
		}
		if (seenGateIds[oneGate.gateId]) {
			return `${moduleName} REFUSED: gateId '${oneGate.gateId}' is declared twice`;
		}
		seenGateIds[oneGate.gateId] = true;
		if (!Array.isArray(oneGate.conjunctList) || oneGate.conjunctList.length === 0) {
			return `${moduleName} REFUSED: gate '${oneGate.gateId}' declares no conjunctList — a gate asserts at least one conjunct`;
		}
		const seenConjunctIds = {};
		for (let conjunctIndex = 0; conjunctIndex < oneGate.conjunctList.length; conjunctIndex++) {
			const oneConjunct = oneGate.conjunctList[conjunctIndex];
			if (!oneConjunct || typeof oneConjunct.conjunctId !== 'string' || oneConjunct.conjunctId.length === 0) {
				return `${moduleName} REFUSED: gate '${oneGate.gateId}' conjunct ${conjunctIndex} lacks conjunctId`;
			}
			if (seenConjunctIds[oneConjunct.conjunctId]) {
				return `${moduleName} REFUSED: gate '${oneGate.gateId}' conjunct '${oneConjunct.conjunctId}' is declared twice`;
			}
			seenConjunctIds[oneConjunct.conjunctId] = true;
			if (typeof oneConjunct.evaluate !== 'function' || oneConjunct.evaluate.length !== 2) {
				return `${moduleName} REFUSED: gate '${oneGate.gateId}' conjunct '${oneConjunct.conjunctId}' evaluate must be evaluate(subject, callback) — arity 2`;
			}
			if (oneConjunct.expectFail !== undefined) {
				return `${moduleName} REFUSED: gate '${oneGate.gateId}' conjunct '${oneConjunct.conjunctId}' carries expectFail — no standing expectFail is permitted; a gate that is red stays red until fixed`;
			}
		}
	}
	return '';
};

// evaluateConjunct — one conjunct over one subject; a throw or a malformed result → UNMEASURED
const evaluateConjunct = ({ conjunct, subject }, callback) => {
	let settled = false;
	const settle = (status, detail) => {
		if (settled) {
			return;
		}
		settled = true;
		callback('', { status, detail: detail === undefined ? '' : String(detail) });
	};
	try {
		conjunct.evaluate(subject, (evaluateError, result) => {
			if (evaluateError) {
				settle(CONJUNCT_STATUS.UNMEASURED, `evaluate reported an error: ${evaluateError}`);
				return;
			}
			if (!result || typeof result.pass !== 'boolean') {
				settle(CONJUNCT_STATUS.UNMEASURED, 'evaluate returned no boolean pass — a gate that does not assert is unmeasured');
				return;
			}
			settle(result.pass ? CONJUNCT_STATUS.PASS : CONJUNCT_STATUS.FAIL, result.detail);
		});
	} catch (thrownError) {
		settle(CONJUNCT_STATUS.UNMEASURED, `evaluate THREW: ${thrownError.message}`);
	}
};

const evaluateGates = ({ gateDeclarationList, subject, cloneSubject } = {}, callback) => {
	const declarationError = validateGateDeclarationList(gateDeclarationList);
	if (declarationError) {
		callback(declarationError);
		return;
	}
	const subjectForConjunct = () => (typeof cloneSubject === 'function' ? cloneSubject(subject) : subject);
	const gateResultList = [];
	let gateIndex = 0;
	const nextGate = () => {
		if (gateIndex >= gateDeclarationList.length) {
			const accepted = gateResultList.every((oneGate) => oneGate.status === CONJUNCT_STATUS.PASS);
			callback('', {
				gateResultList,
				accepted,
				gateCount: gateResultList.length,
				conjunctCount: gateResultList.reduce((soFar, oneGate) => soFar + oneGate.conjunctResultList.length, 0),
				failingList: gateResultList
					.filter((oneGate) => oneGate.status !== CONJUNCT_STATUS.PASS)
					.map((oneGate) => `${oneGate.gateId}: ${oneGate.status}`),
			});
			return;
		}
		const oneGate = gateDeclarationList[gateIndex];
		gateIndex++;
		const conjunctResultList = [];
		let conjunctIndex = 0;
		const nextConjunct = () => {
			if (conjunctIndex >= oneGate.conjunctList.length) {
				const status = conjunctResultList.some((oneResult) => oneResult.status === CONJUNCT_STATUS.UNMEASURED)
					? CONJUNCT_STATUS.UNMEASURED
					: conjunctResultList.some((oneResult) => oneResult.status === CONJUNCT_STATUS.FAIL)
						? CONJUNCT_STATUS.FAIL
						: CONJUNCT_STATUS.PASS;
				gateResultList.push({ gateId: oneGate.gateId, title: oneGate.title, status, conjunctResultList });
				nextGate();
				return;
			}
			const oneConjunct = oneGate.conjunctList[conjunctIndex];
			conjunctIndex++;
			evaluateConjunct({ conjunct: oneConjunct, subject: subjectForConjunct() }, (evaluateError, result) => {
				conjunctResultList.push({ conjunctId: oneConjunct.conjunctId, title: oneConjunct.title, status: result.status, detail: result.detail });
				nextConjunct();
			});
		};
		nextConjunct();
	};
	nextGate();
};

// sweepTwins — for every conjunct: baseline must PASS (else FAILING); each counting twin runs on a
// clone of the subject and the conjunct must go red (else DEFECTIVE); no counting twin → UNPROVEN
const sweepTwins = ({ gateDeclarationList, twinRegistry, subject, cloneSubject } = {}, callback) => {
	const declarationError = validateGateDeclarationList(gateDeclarationList);
	if (declarationError) {
		callback(declarationError);
		return;
	}
	if (!twinRegistry || typeof twinRegistry.entriesFor !== 'function') {
		callback(`${moduleName} REFUSED: sweepTwins needs a twinRegistry (makeTwinRegistry())`);
		return;
	}
	if (typeof cloneSubject !== 'function') {
		callback(`${moduleName} REFUSED: sweepTwins needs cloneSubject(subject) so every twin runs on a fresh copy`);
		return;
	}
	const conjunctReportList = [];
	const conjunctQueue = [];
	gateDeclarationList.forEach((oneGate) => {
		oneGate.conjunctList.forEach((oneConjunct) => {
			conjunctQueue.push({ gate: oneGate, conjunct: oneConjunct });
		});
	});
	let queueIndex = 0;
	const nextConjunct = () => {
		if (queueIndex >= conjunctQueue.length) {
			const observedRedCount = conjunctReportList.filter((oneReport) => oneReport.status === SWEEP_STATUS.OBSERVED_RED).length;
			const defectiveCount = conjunctReportList.filter((oneReport) => oneReport.status === SWEEP_STATUS.DEFECTIVE).length;
			const unprovenCount = conjunctReportList.filter((oneReport) => oneReport.status === SWEEP_STATUS.UNPROVEN).length;
			const failingCount = conjunctReportList.filter((oneReport) => oneReport.status === SWEEP_STATUS.FAILING).length;
			callback('', {
				conjunctReportList,
				conjunctCount: conjunctReportList.length,
				observedRedCount,
				defectiveCount,
				unprovenCount,
				failingCount,
				twinRunCount: conjunctReportList.reduce((soFar, oneReport) => soFar + oneReport.twinReportList.length, 0),
				shippedConfigFalseList: conjunctReportList
					.reduce((soFar, oneReport) => soFar.concat(oneReport.twinReportList), [])
					.filter((oneTwinReport) => oneTwinReport.shippedConfig === false)
					.map((oneTwinReport) => `${oneTwinReport.gateId}/${oneTwinReport.conjunctId}: '${oneTwinReport.twinName}'`),
				expectationLeverList: conjunctReportList
					.reduce((soFar, oneReport) => soFar.concat(oneReport.twinReportList), [])
					.filter((oneTwinReport) => oneTwinReport.leverKind === 'expectationLever')
					.map((oneTwinReport) => `${oneTwinReport.gateId}/${oneTwinReport.conjunctId}: '${oneTwinReport.twinName}'`),
				everyConjunctObservedRed: defectiveCount === 0 && unprovenCount === 0 && failingCount === 0,
			});
			return;
		}
		const { gate, conjunct } = conjunctQueue[queueIndex];
		queueIndex++;
		evaluateConjunct({ conjunct, subject: cloneSubject(subject) }, (baselineError, baselineResult) => {
			if (baselineResult.status !== CONJUNCT_STATUS.PASS) {
				conjunctReportList.push({
					gateId: gate.gateId,
					conjunctId: conjunct.conjunctId,
					status: SWEEP_STATUS.FAILING,
					note: `baseline is ${baselineResult.status}: ${baselineResult.detail}`,
					twinReportList: [],
				});
				nextConjunct();
				return;
			}
			const twinEntryList = twinRegistry.entriesFor({ gateId: gate.gateId, conjunctId: conjunct.conjunctId });
			const twinReportList = [];
			let twinIndex = 0;
			const nextTwin = () => {
				if (twinIndex >= twinEntryList.length) {
					// a twin that could not be APPLIED (its run threw — a stale mutation find, a broken fault)
					// has proven NOTHING (FA1): it is neither a counting observation nor a defect of the gate
					const countingReports = twinReportList.filter((oneReport) => COUNTING_LEVER_KIND_LIST.indexOf(oneReport.leverKind) !== -1 && oneReport.ran);
					const unappliedReports = twinReportList.filter((oneReport) => !oneReport.ran);
					const status =
						countingReports.length === 0
							? SWEEP_STATUS.UNPROVEN
							: countingReports.some((oneReport) => !oneReport.gateWentRed)
								? SWEEP_STATUS.DEFECTIVE
								: SWEEP_STATUS.OBSERVED_RED;
					const note =
						status === SWEEP_STATUS.UNPROVEN
							? unappliedReports.length
								? `twin(s) could not be applied and proved nothing: ${unappliedReports.map((oneReport) => `${oneReport.twinName} (${oneReport.detail})`).join('; ')}`
								: twinReportList.length
									? 'only expectationLever twins registered — recorded, not counted'
									: 'no twin registered for this conjunct'
							: status === SWEEP_STATUS.DEFECTIVE
								? `twin(s) did not turn the gate red: ${countingReports.filter((oneReport) => !oneReport.gateWentRed).map((oneReport) => oneReport.twinName).join(', ')}`
								: '';
					conjunctReportList.push({ gateId: gate.gateId, conjunctId: conjunct.conjunctId, status, note, twinReportList });
					nextConjunct();
					return;
				}
				const oneTwin = twinEntryList[twinIndex];
				twinIndex++;
				let mutatedSubject;
				let runError = '';
				try {
					mutatedSubject = oneTwin.run(cloneSubject(subject));
				} catch (thrownError) {
					runError = thrownError.message;
				}
				if (runError) {
					// a twin that cannot even be applied has proven nothing
					twinReportList.push({ gateId: gate.gateId, conjunctId: conjunct.conjunctId, twinName: oneTwin.twinName, leverKind: oneTwin.leverKind, shippedConfig: oneTwin.shippedConfig, ran: false, gateWentRed: false, detail: `twin run THREW: ${runError}` });
					nextTwin();
					return;
				}
				evaluateConjunct({ conjunct, subject: mutatedSubject }, (twinError, twinResult) => {
					// UNMEASURED under a twin is NOT red: a gate that stops asserting has not been observed failing
					const gateWentRed = twinResult.status === CONJUNCT_STATUS.FAIL;
					twinReportList.push({ gateId: gate.gateId, conjunctId: conjunct.conjunctId, twinName: oneTwin.twinName, leverKind: oneTwin.leverKind, shippedConfig: oneTwin.shippedConfig, ran: true, gateWentRed, statusUnderTwin: twinResult.status, detail: twinResult.detail });
					nextTwin();
				});
			};
			nextTwin();
		});
	};
	nextConjunct();
};

module.exports = { evaluateGates, sweepTwins, evaluateConjunct, validateGateDeclarationList, CONJUNCT_STATUS, SWEEP_STATUS, moduleName };
