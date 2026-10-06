'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// capturedCensusScopeDelta.js — TEST SUPPORT: campaign P3's W-B-9 change (2026-10-06), applied to run-report counts
// CAPTURED before it, so an oracle comparing today's counts with a branch-cut capture keeps proving what it was written
// to prove (the capture is NOT re-captured — that would compare the code with itself; capturedEdgeProvenanceDelta.js
// states the same rule for lane P's change).
//
// The delta is exactly what W-B-9 does to the census of a run with NO scope file (every documentary run, and a derived run
// whose subjectSource names no scope): perSubject gains labelledSubjectCount = subjectCount and outOfScopeSubjectCount = 0.
// A capture of a SCOPED run cannot be delta'd (the labelled count was never recorded) and is refused by name: the caller
// says the captured run was unscoped.
//
//   capturedCountsWithScopeCensusDelta({ capturedCounts, capturedRunWasUnscoped }) → counts | throws by name

const sortedMembers = (candidate) => Object.keys(candidate).sort().reduce((soFar, oneName) => ({ ...soFar, [oneName]: candidate[oneName] }), {});

const capturedCountsWithScopeCensusDelta = ({ capturedCounts, capturedRunWasUnscoped }) => {
	if (capturedRunWasUnscoped !== true) {
		throw new Error(`${moduleName} REFUSED: only an UNSCOPED run's captured census can take the W-B-9 delta (its labelled count is its subject count); a scoped capture never recorded how many subjects the scope left out`);
	}
	const capturedPerSubject = capturedCounts.cardinalityCensus.perSubject;
	if (!Number.isInteger(capturedPerSubject.subjectCount)) {
		throw new Error(`${moduleName} REFUSED: the captured perSubject has no integer subjectCount (${JSON.stringify(capturedPerSubject)})`);
	}
	const perSubject = sortedMembers({ ...capturedPerSubject, labelledSubjectCount: capturedPerSubject.subjectCount, outOfScopeSubjectCount: 0 });
	return { ...capturedCounts, cardinalityCensus: { ...capturedCounts.cardinalityCensus, perSubject } };
};

module.exports = { capturedCountsWithScopeCensusDelta, moduleName };
