'use strict';

// match-forensics.js — the append-only FORENSIC MATCH LOG (p9-judgmentPersistence scope amendment;
// ⟪TQ RULING, 2026-07-31⟫ "make sure that you have a good log so that we can review and diagnose the
// processing details to support forensic examination to improve quality later... organize them so
// you can examine and answer questions in the context of the standards").
//
// WHAT IT HOLDS: one JSON object per line (JSONL), ONE RECORD PER JUDGMENT, written AT DECISION TIME
// — the same moment the judgment-cache row lands — so a killed run leaves a complete forensic trail
// up to the exact judgment it died on. Cache hits and dedupe fan-outs get records too (judgedVia
// says which), so the forensic story is COMPLETE per source element, never just the live spend.
//
// ORGANIZED BY STANDARD: one file per pair+generation,
//   <baseDirPath>/<pairKey>/<generation>.jsonl        (pairKey e.g. 'CEDS::SIF')
// The directory-per-pair layout IS the organize-by-standard requirement: "what did the SIF run
// judge, and why" is one directory; "what changed between generations" is two files side by side.
//
// CRASH-SAFE, APPEND-ONLY: every record is ONE fs.appendFile call of serialized-object + newline —
// no buffering across judgments, nothing held in memory to lose. This writer PREPARES its own
// directories (mkdir -p of the per-pair dir on first append): it is an evidence log, not a
// datastore — a forensic trail that refused to exist because a directory was missing would defeat
// the very crash it exists to explain. (Contrast judgment-cache/decision-store, which refuse an
// unprepared directory: THOSE hold replayed truth; this holds testimony.)
//
// FORENSICS ARE EVIDENCE, NOT A GATE: this module reports an append failure through its callback
// like everything else, but the CALLER (the judgment seam) is contractually loud-but-nonfatal about
// it — a forensics write failure must never kill a run that is spending real judgment credit.
//
// No sqlite, no process.global, no construction-time side effects — safe to require anywhere.
// Async style: callback(errString, result); camelCase only; no async/await.

const path = require('path');
const fs = require('fs');

// START OF moduleFunction() ============================================================

const matchForensics = () => {
	// -----
	// open — baseDirPath is required; there is no default here (the documented default lives in the
	// caller, graphBuilder's actions.js, exactly the vectorCache/embedding-client split).
	const open = ({ baseDirPath }, callback) => {
		if (!baseDirPath || typeof baseDirPath !== 'string' || baseDirPath.trim() === '') {
			callback(
				`matchForensics.open: baseDirPath is REQUIRED and has no default. A caller that does ` +
					`not say where the forensic trail lives is a caller that can write anywhere.`,
			);
			return;
		}
		if (fs.existsSync(baseDirPath) && !fs.statSync(baseDirPath).isDirectory()) {
			callback(
				`matchForensics.open: '${baseDirPath}' exists and is not a directory. Refusing to ` +
					`append forensic records into a non-directory.`,
			);
			return;
		}
		callback('', makeApi({ baseDirPath }));
	};

	return { open };
};

// pathSegmentViolation — pairKey/generation become FILESYSTEM names; a path separator (or a blank)
// inside either would silently scatter one pair's trail across directories. Refused by name.
const pathSegmentViolation = (value, name, who) => {
	if (typeof value !== 'string' || value.trim() === '') {
		return `matchForensics.${who}: ${name} is required and must be a non-empty string`;
	}
	if (value.indexOf('/') !== -1 || value.indexOf('\\') !== -1 || value.indexOf('\u0000') !== -1) {
		return (
			`matchForensics.${who}: ${name} '${value}' contains a path separator (or NUL) — it becomes ` +
			`a filesystem name and must not smuggle directory structure. There is no sanitized default.`
		);
	}
	return '';
};

// -----
const makeApi = ({ baseDirPath }) => {
	// -----
	// appendRecord — ONE judgment record onto the pair+generation trail. One appendFile call,
	// serialized object + newline, no buffering. The per-pair directory is prepared on demand.
	const appendRecord = ({ pairKey, generation, record } = {}, callback) => {
		const pairViolation = pathSegmentViolation(pairKey, 'pairKey', 'appendRecord');
		if (pairViolation) {
			callback(pairViolation);
			return;
		}
		const generationViolation = pathSegmentViolation(generation, 'generation', 'appendRecord');
		if (generationViolation) {
			callback(generationViolation);
			return;
		}
		if (!record || typeof record !== 'object' || Array.isArray(record)) {
			callback('matchForensics.appendRecord: record is required and must be a plain object');
			return;
		}

		const pairDir = path.join(baseDirPath, pairKey);
		let mkdirFault = '';
		const attempt = () => {
			fs.mkdirSync(pairDir, { recursive: true });
		};
		try {
			attempt();
		} catch (mkdirError) {
			mkdirFault = mkdirError.message;
		}
		if (mkdirFault) {
			callback(`matchForensics.appendRecord: preparing '${pairDir}': ${mkdirFault}`);
			return;
		}

		const filePath = path.join(pairDir, `${generation}.jsonl`);
		fs.appendFile(filePath, `${JSON.stringify(record)}\n`, (appendError) => {
			if (appendError) {
				callback(`matchForensics.appendRecord: appending to '${filePath}': ${appendError.message}`);
				return;
			}
			callback('', { filePath });
		});
	};

	return {
		baseDirPath,
		appendRecord,
	};
};

// END OF moduleFunction() ============================================================

module.exports = matchForensics;
