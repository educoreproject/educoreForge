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

const { deriveVersionStamp } = require('../snapshot-provenance/snapshot-provenance');
const { pairSubjectText, versionKeyText } = require('../vocabulary/vocabulary');

const moduleFunction =
	({ moduleName } = {}) =>
	({ unused } = {}) => {
		// findRosterEntry — { roster, standardName } -> { entry } | { error }
		const findRosterEntry = ({ roster, standardName }) => {
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

		// resolvePairBinding — the one working function.
		//   { roster, hubStandardName, spokeStandardName, warn } -> binding | { error }
		const resolvePairBinding = ({
			roster,
			hubStandardName,
			spokeStandardName,
			warn = () => {},
		}) => {
			const hubFound = findRosterEntry({ roster, standardName: hubStandardName });
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

		return { resolvePairBinding, findRosterEntry };
	};

module.exports = moduleFunction({ moduleName });
