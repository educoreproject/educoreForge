'use strict';

// gold-eval-conservation.js — the -goldEvalCheck CONSERVATION AUDIT (JOB 6b, AMENDMENT 3 §6b).
// The seam owner's wiring, exactly parallel to gold-eval-bridge-sibling.js: it reads the run's MANIFEST
// out of the standardsDatabase and requires, for EVERY member block, a conservation artifact in the
// build run directory reading PASS. READ-ONLY: it opens the store, reads files, and computes; no graph,
// no docker, no LLM, no spend.
//
//   auditManifestConservation({ standardsDatabase, manifestRefId, buildLogDirPath }, cb)
//       → cb(err, { manifestRefId, memberCount, auditedList, refusalMessageList })
//
// WHY THE MANIFEST IS THE POPULATION AND THE DIRECTORY IS ONLY THE EVIDENCE. The audit enumerates
// manifest members and demands an artifact for each. It must NEVER enumerate conservation/ and check
// what it finds: a population read FROM the evidence cannot detect its own omission, so a block that
// was never checked would be indistinguishable from a block with nothing wrong. That is the single
// lesson of the night this gate was written, stated as code rather than as prose.
//
// WHY THE FILE IS NAMED BY CONTENT ADDRESS. <runDir>/conservation/<schemaBlockRefId>.json. The refId is
// the address of the exact bytes certified, so a rebuild that changes a block leaves NO artifact at the
// looked-up name and a stale PASS from an earlier run of the same recipe cannot pass for this one. The
// subject is carried INSIDE the file and cross-checked, so an artifact that certifies a different
// subject under a colliding name refuses rather than passes.
//
// THERE IS NO 'FAILED' VERDICT, AND A READER SHOULD NOT GO LOOKING FOR ONE. A failed conservation
// comparison REFUSES inside replayManager.harvest and mints no block, so no manifest member can exist
// for it. The refusal is the enforcement; this artifact is the evidence that the check RAN. What this
// audit catches is therefore: a block whose check left no evidence, and a block certified under the
// DECLARED EXEMPTION (verdict 'EXEMPT') — which after JOB 5b no production caller can produce, so its
// presence means a seam went ungated. Any verdict that is neither PASS nor EXEMPT also refuses: a value
// we cannot currently produce must never become a silent pass if some future path produces one.

const path = require('path');
const fs = require('fs');

const moduleName = 'gold-eval-conservation';

const CONSERVATION_SUBDIR_NAME = 'conservation';
const PASS_VERDICT = 'PASS';
const EXEMPT_VERDICT = 'EXEMPT';

// auditOneArtifact — PURE but for the one file read it declares. Returns the row AND its refusal, never
// a null-filled row: a reader that cannot obtain a verdict must say what was missing, not report absence
// as a measured emptiness.
const auditOneArtifact = ({ conservationDirPath, schemaBlockRefId, subject } = {}) => {
	const artifactFilePath = path.join(conservationDirPath, `${schemaBlockRefId}.json`);
	if (!fs.existsSync(artifactFilePath)) {
		return {
			subject,
			refId: schemaBlockRefId,
			verdict: null,
			refusalMessage:
				`manifest member '${subject}' (${schemaBlockRefId}) has NO conservation artifact at ` +
				`'${artifactFilePath}' — its forge-to-harvest seam left no evidence that it was checked, ` +
				`and a block nobody measured must not be promoted`,
		};
	}
	let record = null;
	// boundary translation of an fs / JSON.parse throw into the verdict channel
	try {
		record = JSON.parse(fs.readFileSync(artifactFilePath, 'utf-8'));
	} catch (parseFault) {
		return {
			subject,
			refId: schemaBlockRefId,
			verdict: null,
			refusalMessage: `conservation artifact '${artifactFilePath}' for '${subject}' does not parse (${parseFault.message})`,
		};
	}
	if (record === null || typeof record !== 'object' || Array.isArray(record)) {
		return { subject, refId: schemaBlockRefId, verdict: null, refusalMessage: `conservation artifact '${artifactFilePath}' for '${subject}' is not an object` };
	}
	// STALE-ARTIFACT GUARD. The name already binds the file to the block's bytes; this binds its CONTENT
	// to them too, so a hand-edited or misplaced artifact cannot certify a block it does not describe.
	//
	// AN ABSENT blockRefId REFUSES, IT DOES NOT SKIP THE GUARD. The first form of this check read
	// `typeof record.blockRefId === 'string' && record.blockRefId !== schemaBlockRefId`, which let an
	// artifact carrying NO blockRefId — absent, null, or not a string — fall straight through to the
	// verdict and pass on that alone. A record that does not SAY WHICH BYTES IT CERTIFIES certifies
	// nothing, and the weaker of two conditions must never be the one that decides. (Caught in review by
	// TWILIGHT_ARROW, 2026-09-02; it is the same shape as every other defect in this DEVLOG — a check
	// whose negative case was never exercised, so its silence read as assent.)
	if (typeof record.blockRefId !== 'string') {
		return {
			subject,
			refId: schemaBlockRefId,
			verdict: record.verdict === undefined ? null : record.verdict,
			refusalMessage:
				`conservation artifact '${artifactFilePath}' carries no blockRefId (${JSON.stringify(record.blockRefId)}) — ` +
				`an artifact that does not name the bytes it certifies certifies nothing, and must not pass on its verdict alone`,
		};
	}
	if (record.blockRefId !== schemaBlockRefId) {
		return {
			subject,
			refId: schemaBlockRefId,
			verdict: record.verdict === undefined ? null : record.verdict,
			refusalMessage:
				`conservation artifact '${artifactFilePath}' names blockRefId '${record.blockRefId}' but sits ` +
				`under '${schemaBlockRefId}' — it certifies different bytes than the manifest member it was read for`,
		};
	}
	if (record.verdict === PASS_VERDICT) {
		return { subject, refId: schemaBlockRefId, verdict: PASS_VERDICT, refusalMessage: null };
	}
	if (record.verdict === EXEMPT_VERDICT) {
		return {
			subject,
			refId: schemaBlockRefId,
			verdict: EXEMPT_VERDICT,
			refusalMessage:
				`manifest member '${subject}' (${schemaBlockRefId}) was harvested under the DECLARED ` +
				`CONSERVATION EXEMPTION, so nothing compared what was loaded against what was harvested for ` +
				`it. Since JOB 5b no production caller declares that exemption — its presence here means a ` +
				`seam went ungated, and an ungated seam is not promotable`,
		};
	}
	return {
		subject,
		refId: schemaBlockRefId,
		verdict: record.verdict === undefined ? null : record.verdict,
		refusalMessage:
			`manifest member '${subject}' (${schemaBlockRefId}) carries conservation verdict ` +
			`${JSON.stringify(record.verdict)}, which is neither '${PASS_VERDICT}' nor '${EXEMPT_VERDICT}' — ` +
			`an unrecognised verdict must refuse rather than read as a pass`,
	};
};

// auditConservationForManifest — THE AUDIT ITSELF, SYNCHRONOUS, taking a manifest ALREADY IN HAND.
// -goldEvalCheck has already fetched the manifest for its own certificate, so the audit takes it rather
// than fetching a second copy: two reads of the same manifest are two things that can disagree, and
// this file exists because of what happens when two records of one fact drift apart. It is also why
// this is a plain function and not another nested callback — the caller has one insertion point, not a
// wrapper.
const auditConservationForManifest = ({ manifest, buildLogDirPath } = {}) => {
	if (typeof buildLogDirPath !== 'string' || buildLogDirPath.trim() === '') {
		return { refusalMessageList: [`${moduleName}: buildLogDirPath is REQUIRED and has no default — the artifacts live in the run directory`], memberCount: 0, auditedList: [] };
	}
	const memberList = manifest && Array.isArray(manifest.members) ? manifest.members : [];
	// A manifest with ZERO members is a REFUSAL, not a vacuous pass: every build harvests blocks, so an
	// empty member list means this is not the manifest that was built.
	if (memberList.length === 0) {
		return { refusalMessageList: [`${moduleName}: the manifest carries ZERO members — every build harvests blocks, so an empty manifest cannot be the one that was built`], memberCount: 0, auditedList: [] };
	}
	const conservationDirPath = path.join(buildLogDirPath, CONSERVATION_SUBDIR_NAME);
	const auditedList = memberList.map((oneMember) =>
		auditOneArtifact({ conservationDirPath, schemaBlockRefId: oneMember.schemaBlockRefId, subject: oneMember.subject }),
	);
	return {
		memberCount: memberList.length,
		auditedList,
		refusalMessageList: auditedList.filter((oneRow) => oneRow.refusalMessage !== null).map((oneRow) => oneRow.refusalMessage),
	};
};

// auditManifestConservation — the async wrapper that FETCHES a manifest, for standalone use and for the
// twins. -goldEvalCheck uses the synchronous form above with the manifest it already holds.
const auditManifestConservation = ({ standardsDatabase, manifestRefId, buildLogDirPath } = {}, callback) => {
	if (!standardsDatabase || typeof standardsDatabase.getManifest !== 'function') {
		callback(`${moduleName}: an OPEN standardsDatabase (getManifest) is REQUIRED`);
		return;
	}
	if (typeof manifestRefId !== 'string' || manifestRefId.trim() === '') {
		callback(`${moduleName}: manifestRefId is REQUIRED and has no default — the audit is a claim about ONE manifest's blocks`);
		return;
	}
	if (typeof buildLogDirPath !== 'string' || buildLogDirPath.trim() === '') {
		callback(`${moduleName}: buildLogDirPath is REQUIRED and has no default — the artifacts live in the run directory`);
		return;
	}
	standardsDatabase.getManifest({ refId: manifestRefId }, (manifestError, manifest) => {
		if (manifestError) {
			callback(`${moduleName}: getManifest ${manifestRefId}: ${manifestError}`);
			return;
		}
		if (!manifest) {
			callback(`${moduleName}: manifest ${manifestRefId} is ABSENT from the store — nothing to certify`);
			return;
		}
		// ONE implementation, delegated to — never a second copy of the rule.
		const audit = auditConservationForManifest({ manifest, buildLogDirPath });
		callback('', { manifestRefId, ...audit });
	});
};

module.exports = { auditOneArtifact, auditConservationForManifest, auditManifestConservation, CONSERVATION_SUBDIR_NAME, PASS_VERDICT, EXEMPT_VERDICT, moduleName };
