'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// snapshot-provenance.js — version-provenance stamp derivation (BINDING spec §3.2/§3.3,
// pairwiseVersionSwitching Phase A).
//
// Given the sourcePath a forge was handed, locates the SNAPSHOT DIRECTORY (the child of
// assets/standardSourceData/ containing the source), derives snapshotKey from its name, reads the
// snapshot's standardSourceLocation provenance file, and applies the §3.3 precedence:
//   'spec'            — the parser read the version from a self-describing source; the SOURCE WINS.
//                       A disagreeing provenance file is WARNED with both values named — the
//                       disagreement is logged, never silently resolved.
//   'provenance-file' — the source is not self-describing; the provenance file supplies
//                       publishedVersion.
//   'unknown'         — neither supplies it; WARNING (§3.2), stamped 'unknown' honestly. Gaps
//                       explicit, never fabricated.
//
// Parser purity preserved: only the handed snapshot directory is read. Pure + synchronous.

const fs = require('fs');
const path = require('path');

const SNAPSHOT_CONTAINER_NAME = 'standardSourceData';
const PROVENANCE_FILE_NAME = 'standardSourceLocation';

// walk up from the sourcePath until the parent directory is the snapshot container; the child is
// the snapshot directory (works whether the forge was handed the directory or a file inside it).
const findSnapshotDirPath = (sourcePath) => {
	let probePath = path.resolve(sourcePath);
	while (probePath !== path.dirname(probePath)) {
		if (path.basename(path.dirname(probePath)) === SNAPSHOT_CONTAINER_NAME) {
			return probePath;
		}
		probePath = path.dirname(probePath);
	}
	return null;
};

const readProvenanceVersion = (snapshotDirPath) => {
	const provenancePath = path.join(snapshotDirPath, PROVENANCE_FILE_NAME);
	if (!fs.existsSync(provenancePath)) {
		return { provenanceVersion: null, provenancePath };
	}
	const versionMatch = fs
		.readFileSync(provenancePath, 'utf8')
		.match(/^publishedVersion:[ \t]*(.+?)[ \t]*$/m);
	if (!versionMatch) {
		return { provenanceVersion: null, provenancePath };
	}
	const value = versionMatch[1];
	// an explicitly-unknown provenance value is an honest gap, not a version
	return {
		provenanceVersion: value.toLowerCase().startsWith('unknown') ? null : value,
		provenancePath,
	};
};

// deriveVersionStamp — { sourcePath, sourceVersion, warn } ->
//   { snapshotKey, publishedVersion, versionSource }
// sourceVersion: the version string the parser itself read from a SELF-DESCRIBING source
//   (owl:versionInfo, openapi info.version, …), or null when the source does not self-describe.
// warn: (message) => void — REQUIRED. Receives the §3.2/§3.3 warnings (callers pass xLog.error).
//   There is no default: the warnings are mandated by the spec this module implements, so a
//   caller that does not name a channel for them is refused rather than quietly deprived.
const deriveVersionStamp = ({ sourcePath, sourceVersion = null, warn } = {}) => {
	// WARN IS PART OF THE CONTRACT, NOT AN OPTION. `warn = () => {}` used to sit in this parameter
	// list, so a caller that forgot it discarded every warning the BINDING spec mandates —
	// version disagreements, missing provenance, all of it — into a function that does nothing.
	// Both callers on disk pass xLog.error, so nothing was lost today; the default existed purely
	// to let a future caller lose it. polyArch2 §6: a required input that is missing is a fault
	// named where it happened, and this one is required by the spec this module implements.
	if (typeof warn !== 'function') {
		throw new Error(
			`${moduleName}.deriveVersionStamp: warn is ${
				warn === undefined ? 'not given' : `a ${typeof warn}`
			} and must be a function. The §3.2/§3.3 warnings — a version DISAGREEMENT between the ` +
				`source and the provenance file, and a publishedVersion nobody supplies — are ` +
				`MANDATED by the binding spec. They are part of this function's contract, not an ` +
				`option, and there is no do-nothing default to swallow them.`,
		);
	}
	const snapshotDirPath = sourcePath ? findSnapshotDirPath(sourcePath) : null;
	const snapshotKey = snapshotDirPath ? path.basename(snapshotDirPath) : 'unknown';
	if (!snapshotDirPath) {
		warn(
			`${moduleName}: sourcePath '${sourcePath}' is not inside an ${SNAPSHOT_CONTAINER_NAME}/ snapshot directory — snapshotKey stamped 'unknown'`,
		);
	}
	const { provenanceVersion, provenancePath } = snapshotDirPath
		? readProvenanceVersion(snapshotDirPath)
		: { provenanceVersion: null, provenancePath: null };
	if (sourceVersion) {
		if (provenanceVersion && provenanceVersion !== sourceVersion) {
			warn(
				`${moduleName}: version DISAGREEMENT — the source declares '${sourceVersion}' but the provenance file declares '${provenanceVersion}' (${provenancePath}); the source wins (versionSource 'spec'); the disagreement is logged, never silently resolved`,
			);
		}
		return { snapshotKey, publishedVersion: sourceVersion, versionSource: 'spec' };
	}
	if (provenanceVersion) {
		return { snapshotKey, publishedVersion: provenanceVersion, versionSource: 'provenance-file' };
	}
	warn(
		`${moduleName}: no publishedVersion available — the source does not self-describe and ${
			provenancePath || 'the provenance file'
		} supplies none; stamping 'unknown' honestly (spec §3.2 warning)`,
	);
	return { snapshotKey, publishedVersion: 'unknown', versionSource: 'unknown' };
};

module.exports = { deriveVersionStamp };
