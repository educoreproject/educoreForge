'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// edfiHooks.js — the H2/H3 hook set for the Ed-Fi forge bundle (SPEC-forgeFramework-v1.md §5;
// migrated F3b 2026-08-16 from forgeEdfi.js:114-267, byte-identical block aea6d8dfe789…):
//   sourceLoaderList — TWO loaders, run SERIALLY in list order (the canonical N-loader form,
//     RULING 23:12 #4): the MetaEd model (Phase 1 parser; verifies the .metaed checksums itself —
//     the double hash is accepted, SPEC §4.2), the descriptor code values. The third, the authored
//     crosswalk, is RETIRED (2026-10-02, BRIEF-F; TQ 2026-09-10 and 2026-10-01: excluded from every
//     graph, "known to be garbage"): its CSVs sit in cedsAuthoredCrosswalk_DO_NOT_USE/, unread.
//     Each loader consumes ONLY bytes the framework has already verified (forge() step 2 verifies
//     every SHA256SUMS-listed file of the snapshot before step 3 runs).
//   describeSource — PURE; TWO version keys (FR2): the model package's own projectVersion is BOTH
//     the root `version` and the stamp input (`selfDescribedVersion`), exactly as forgeEdfi.js:170-181
//     composed them; null → root 'unknown' (the framework then stamps 'unknown' in the triple).
//     sourceFiles = the FOUR logical input names (allowance E8 declares them);
//     sourceUrl EDFI_DATA_STANDARD_SOURCE_URL (E6 retired P3 W-C-16).
//   emitContractGraph — the walk, forgeEdfiContractGraph.js (H3).
//   describeRoot — PURE; the root description Ed-Fi's contract graph template-built at cg:472-475,
//     reproduced VERBATIM during migration (punch row E7 — a review-enforced row, not a registry
//     row; its retirement is a byte change in its own commit).
//
// describeSource / describeRoot are PURE (they read only their arguments); the loaders speak through
// the xLog the framework hands them (the R-WO-11 crosswalk-match status line emitContractGraph printed
// retired with the crosswalk). No logger is manufactured anywhere here (Profile §5.3).

const forgeDeclaration = require('./edfiForgeDeclaration'); // H1 — data
const metaEdParser = require('./metaEdParser')();
const descriptorCodeValueLoader = require('./descriptorCodeValueLoader')();
const forgeEdfiContractGraph = require('./forgeEdfiContractGraph')();

// the loader logical names + Ed-Fi's sourceFormat literal — bytes on the root. The format drops '+csv':
// the only CSVs this forge ever read were the retired crosswalk's
const SOURCE_FORMAT = 'metaed+xml';
// the repository the Data Standard model is cloned from (assets/standardSourceData provenance README)
const EDFI_DATA_STANDARD_SOURCE_URL = 'https://github.com/Ed-Fi-Alliance-OSS/Ed-Fi-Data-Standard';
const LOADER_NAME = Object.freeze({
	META_ED_MODEL: 'metaEdModel',
	DESCRIPTOR_CODE_VALUES: 'descriptorCodeValues',
});
// the logical names appended after the MetaEd source input names ('cedsAuthoredCrosswalk' retired 2026-10-02)
const LOADER_LOGICAL_SOURCE_FILE_NAME_LIST = Object.freeze([
	'descriptorCodeValues',
	'tpdmDescriptorCodeValues',
]);

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// -----------------------------------------------------------------
		// H2 — the two loaders (forgeEdfi.js STAGE 1-2, verbatim behaviour incl. the status lines)
		// -----------------------------------------------------------------
		const loadMetaEdModel = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			metaEdParser.parseMetaEdSnapshot({ snapshotPath: sourcePath, xLog }, callback);
		};

		const loadDescriptorCodeValues = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			descriptorCodeValueLoader.loadDescriptorCodeValues({ snapshotPath: sourcePath }, (loadError, descriptorCodeValues) => {
				if (loadError) {
					callback(loadError);
					return;
				}
				xLog.status(
					`[forge-edfi] code values: ${descriptorCodeValues.census.codeValueRecordCount} ` +
						`records across ${descriptorCodeValues.census.xmlFileCount} XMLs ` +
						`(${descriptorCodeValues.census.duplicateIdenticalCollapsedCount} identical ` +
						`duplicates collapsed)`,
				);
				callback('', descriptorCodeValues);
			});
		};

		// -----------------------------------------------------------------
		// describeSource — PURE; forgeEdfi.js STAGE 4's overlay in the framework's five-key shape
		// -----------------------------------------------------------------
		const describeSource = ({ parsed }) => {
			const metaEdModel = parsed[LOADER_NAME.META_ED_MODEL];
			const coreSourceInput = metaEdModel.metadata.sourceInputs[0];
			const selfDescribedVersion =
				coreSourceInput && coreSourceInput.projectVersion ? coreSourceInput.projectVersion : null;
			return {
				version: selfDescribedVersion === null ? 'unknown' : selfDescribedVersion,
				selfDescribedVersion,
				sourceFormat: SOURCE_FORMAT,
				sourceFiles: metaEdModel.metadata.sourceInputs
					.map((oneSourceInput) => oneSourceInput.inputName)
					.concat(LOADER_LOGICAL_SOURCE_FILE_NAME_LIST),
				sourceUrl: EDFI_DATA_STANDARD_SOURCE_URL, // E6 retired P3 W-C-16 (G14 c1)
			};
		};

		// -----------------------------------------------------------------
		// H3 — the walk
		// -----------------------------------------------------------------
		const emitContractGraph = ({ parsed, metadata, kit }) =>
			forgeEdfiContractGraph.emitContractGraph({
				metaEdModel: parsed[LOADER_NAME.META_ED_MODEL],
				descriptorCodeValues: parsed[LOADER_NAME.DESCRIPTOR_CODE_VALUES],
				kit,
			});

		// -----------------------------------------------------------------
		// describeRoot — PURE; the template-built description (cg:472-475), verbatim (E7)
		// -----------------------------------------------------------------
		const describeRoot = ({ parsed, metadata }) => {
			const metaEdModel = parsed[LOADER_NAME.META_ED_MODEL];
			const descriptorCodeValues = parsed[LOADER_NAME.DESCRIPTOR_CODE_VALUES];
			const totalCodeValueCount = Object.values(descriptorCodeValues.codeValueListByDescriptorName).reduce(
				(runningSum, oneList) => runningSum + oneList.length,
				0,
			);
			return {
				description:
					`${forgeDeclaration.standardDisplayName} — ${metaEdModel.census.totalConstructCount} MetaEd constructs, ` +
					`${metaEdModel.census.totalPropertyCount} properties, ` +
					`${totalCodeValueCount} descriptor code values`,
			};
		};

		return {
			sourceLoaderList: [
				{ loaderName: LOADER_NAME.META_ED_MODEL, load: loadMetaEdModel },
				{ loaderName: LOADER_NAME.DESCRIPTOR_CODE_VALUES, load: loadDescriptorCodeValues },
			],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

module.exports = moduleFunction({ moduleName });
