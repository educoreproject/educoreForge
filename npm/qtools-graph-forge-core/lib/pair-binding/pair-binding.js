'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pair-binding.js — pair/version-key binding resolution (BINDING spec §4.2/§7.1,
// pairwiseVersionSwitching Phase C).
//
// Resolves the discovery bindings (descriptor + snapshot) of the two standards a producer
// or transformer is working across, into the canonical pair stamp:
//   { pairA, pairAVersion, publishedVersionA,
//     pairB, pairBVersion, publishedVersionB,
//     pairSubject, versionKey }
//
// PURE BY DESIGN (the snapshot-provenance precedent): this module never requires the
// discovery loader — the caller supplies the ROSTER (standard-discovery.roster(), with or
// without synthetics, the caller's choice). Core lib therefore never depends on cli/ code.
//
// Matching is by standardName, CASE-INSENSITIVE — deliberately: the frozen store content
// carries one casing divergence (blocks 'eduAPI' vs roster 'EduAPI' [store-fact, Phase C
// Q10]) and the returned binding always carries the DISCOVERY casing, which is what pair
// subjects are pinned to (spec §4.1, Q10 ruling). Ambiguity (two roster entries sharing a
// standardName, the p6hub 'CEDS' test-mode mirror) prefers the production entry; a tie
// that preference cannot break is a named error, never a guess.

const path = require('path');

const { deriveVersionStamp } = require('../snapshot-provenance/snapshot-provenance');
const { pairSubjectText, versionKeyText } = require('../vocabulary/vocabulary');

const SNAPSHOT_CONTAINER_RELATIVE = ['assets', 'standardSourceData'];

const moduleFunction =
	({ moduleName } = {}) =>
	({ unused } = {}) => {
		// findRosterEntry — { roster, standardName, preferredBundleDir } -> { entry } | { error }
		// preferredBundleDir (Phase D ruling D-D5, additive, behavior-neutral when absent):
		// when a standardName matches several bundles, an EXPLICITLY preferred bundle wins the
		// tie ahead of the production preference — the synthetic flows use it so a p6hub-derived
		// emission stamps p6hub's own provenance instead of the real hub's (honest stamps in
		// the store of record; the mirror-design ambiguity stays available where it is wanted).
		const findRosterEntry = ({ roster, standardName, preferredBundleDir = null }) => {
			if (!standardName) {
				return { error: `${moduleName}: standardName is required` };
			}
			const wanted = `${standardName}`.toLowerCase();
			const matches = (roster || []).filter(
				(oneEntry) => `${oneEntry.standardName}`.toLowerCase() === wanted,
			);
			if (matches.length === 0) {
				return {
					error:
						`${moduleName}: no discovery bundle carries standardName '${standardName}' ` +
						`(known: ${(roster || []).map((oneEntry) => oneEntry.standardName).join(', ')})`,
				};
			}
			if (matches.length === 1) {
				return { entry: matches[0] };
			}
			if (preferredBundleDir) {
				const preferredMatches = matches.filter(
					(oneEntry) => oneEntry.bundleDir === preferredBundleDir,
				);
				if (preferredMatches.length === 1) {
					return { entry: preferredMatches[0] };
				}
				return {
					error:
						`${moduleName}: preferredBundleDir '${preferredBundleDir}' does not name one of ` +
						`the bundles matching standardName '${standardName}' ` +
						`(${matches.map((oneEntry) => oneEntry.bundleDir).join(', ')})`,
				};
			}
			const productionMatches = matches.filter((oneEntry) => !oneEntry.synthetic);
			if (productionMatches.length === 1) {
				return { entry: productionMatches[0] };
			}
			return {
				error:
					`${moduleName}: standardName '${standardName}' is ambiguous in this roster ` +
					`(${matches.map((oneEntry) => oneEntry.bundleDir).join(', ')}) and the ` +
					`production preference cannot break the tie`,
			};
		};

		// stampForEntry — snapshot binding for one roster entry; the descriptor's
		// defaultSnapshot and the path-derived snapshotKey must AGREE (loud on drift).
		const stampForEntry = ({ entry, warn }) => {
			const stamp = deriveVersionStamp({ sourcePath: entry.defaultSource, warn });
			if (stamp.snapshotKey !== entry.defaultSnapshot) {
				return {
					error:
						`${moduleName}: bundle '${entry.bundleDir}' snapshot drift — the path derives ` +
						`snapshotKey '${stamp.snapshotKey}' but the descriptor declares defaultSnapshot ` +
						`'${entry.defaultSnapshot}'. Refusing to stamp a version key from disagreeing bindings.`,
				};
			}
			return { stamp };
		};

		// stampForSnapshot — snapshot binding for one roster entry at a CHOSEN snapshot key
		// (Phase D: a version key may legitimately reference a NON-default snapshot — the
		// three-acts discipline means a forged-but-not-promoted snapshot is mintable; stamping
		// its publishedVersion from the DEFAULT snapshot would be silent mis-provenance).
		// The chosen key must be one of the bundle's enumerated snapshots (loud, never a guess).
		const stampForSnapshot = ({ entry, snapshotKey, warn }) => {
			if ((entry.snapshots || []).indexOf(snapshotKey) === -1) {
				return {
					error:
						`${moduleName}: bundle '${entry.bundleDir}' has no snapshot '${snapshotKey}' ` +
						`(known snapshots: ${(entry.snapshots || []).join(', ')})`,
				};
			}
			const snapshotDirPath = path.join(
				entry.bundlePath,
				...SNAPSHOT_CONTAINER_RELATIVE,
				snapshotKey,
			);
			const sourcePath = entry.sourceFile
				? path.join(snapshotDirPath, entry.sourceFile)
				: snapshotDirPath;
			const stamp = deriveVersionStamp({ sourcePath, warn });
			if (stamp.snapshotKey !== snapshotKey) {
				return {
					error:
						`${moduleName}: bundle '${entry.bundleDir}' snapshot drift — the path derives ` +
						`snapshotKey '${stamp.snapshotKey}' but the caller chose '${snapshotKey}'. ` +
						`Refusing to stamp a version key from disagreeing bindings.`,
				};
			}
			return { stamp };
		};

		// resolvePairBindingAtVersions — resolvePairBinding at CALLER-CHOSEN snapshot keys
		// (Phase D). Casing resolution identical; each side's publishedVersion derives from
		// ITS chosen snapshot's provenance, never from the descriptor default.
		//   { roster, hubStandardName, spokeStandardName, aVersion, bVersion, warn }
		//     -> binding | { error }
		const resolvePairBindingAtVersions = ({
			roster,
			hubStandardName,
			spokeStandardName,
			aVersion,
			bVersion,
			preferredHubBundleDir = null,
			warn = () => {},
		}) => {
			const hubFound = findRosterEntry({
				roster,
				standardName: hubStandardName,
				preferredBundleDir: preferredHubBundleDir,
			});
			if (hubFound.error) {
				return { error: `${hubFound.error} (resolving the hub side)` };
			}
			const spokeFound = findRosterEntry({ roster, standardName: spokeStandardName });
			if (spokeFound.error) {
				return { error: `${spokeFound.error} (resolving the spoke side)` };
			}

			const hubStamped = stampForSnapshot({
				entry: hubFound.entry,
				snapshotKey: aVersion,
				warn,
			});
			if (hubStamped.error) {
				return { error: hubStamped.error };
			}
			const spokeStamped = stampForSnapshot({
				entry: spokeFound.entry,
				snapshotKey: bVersion,
				warn,
			});
			if (spokeStamped.error) {
				return { error: spokeStamped.error };
			}

			const pairA = hubFound.entry.standardName;
			const pairB = spokeFound.entry.standardName;

			return {
				pairA,
				pairAVersion: aVersion,
				publishedVersionA: hubStamped.stamp.publishedVersion,
				pairB,
				pairBVersion: bVersion,
				publishedVersionB: spokeStamped.stamp.publishedVersion,
				pairSubject: pairSubjectText(pairA, pairB),
				versionKey: versionKeyText(aVersion, bVersion),
			};
		};

		// resolvePairBinding — the one working function.
		//   { roster, hubStandardName, spokeStandardName, warn } -> binding | { error }
		const resolvePairBinding = ({
			roster,
			hubStandardName,
			spokeStandardName,
			preferredHubBundleDir = null,
			warn = () => {},
		}) => {
			const hubFound = findRosterEntry({
				roster,
				standardName: hubStandardName,
				preferredBundleDir: preferredHubBundleDir,
			});
			if (hubFound.error) {
				return { error: `${hubFound.error} (resolving the hub side)` };
			}
			const spokeFound = findRosterEntry({ roster, standardName: spokeStandardName });
			if (spokeFound.error) {
				return { error: `${spokeFound.error} (resolving the spoke side)` };
			}

			const hubStamped = stampForEntry({ entry: hubFound.entry, warn });
			if (hubStamped.error) {
				return { error: hubStamped.error };
			}
			const spokeStamped = stampForEntry({ entry: spokeFound.entry, warn });
			if (spokeStamped.error) {
				return { error: spokeStamped.error };
			}

			const pairA = hubFound.entry.standardName;
			const pairB = spokeFound.entry.standardName;
			const pairAVersion = hubStamped.stamp.snapshotKey;
			const pairBVersion = spokeStamped.stamp.snapshotKey;

			return {
				pairA,
				pairAVersion,
				publishedVersionA: hubStamped.stamp.publishedVersion,
				pairB,
				pairBVersion,
				publishedVersionB: spokeStamped.stamp.publishedVersion,
				pairSubject: pairSubjectText(pairA, pairB),
				versionKey: versionKeyText(pairAVersion, pairBVersion),
			};
		};

		return {
			resolvePairBinding,
			resolvePairBindingAtVersions,
			stampForSnapshot,
			findRosterEntry,
		};
	};

module.exports = moduleFunction({ moduleName });
