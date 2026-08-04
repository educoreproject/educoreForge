#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     runSifRoundTripRealGraph.js — the Phase 2 REAL-graph round-trip verdict (forge-sif)

DESCRIPTION
     Runs roundTripValidator.validate() against the materialized scratch container
     DEV_sifRoundTrip_080326 (built by runSifMaterialize.js) over the pinned snapshot 01,
     landing the RT-6 verdict artifact in test-artifacts/realGraphRun/. This is the run that
     audits the LOADER as well as the forge (RT-4: the graph, not the forge's memory) — and,
     under R-SF-1, the run that proves sequenceOrdinal reproduces the TSV's row order at full
     corpus scale via the all-pairs precedence diff (R-SF-7).

     Bolt endpoint + credential are resolved from the RUNNING container (docker inspect),
     never restated here.

     ASSERTED (exit 1 on any miss):
       - INVENTED === 0 (doctrine 5.3 hard line)
       - orderMismatches === 0 (R-SF-1: the graph asserts no order the source did not state)
       - every LOST record is LOCATED (a TSV line) and carries the ONE ruled backlog label
         (fieldCharacteristics — the forge translation gap measured this phase); any other
         label is anonymous loss and FAILS
       - the source census equals the campaign census of record (159 tables / 15,620 field
         rows) — the two-independent-readers cross-check (R-WO-14): this instrument's OWN TSV
         reader against the Phase 0/1 numbers
       - the SCALE report is present, with the largest group's member and pair counts stated
         (the supervisor's R-SF-7 addition: the next campaign inherits the worst case as a
         number, not a fear)

     NOT asserted: roundTripClean — LOST is the honest work-remaining meter (the enrichment
     backlog); the verdict reports it, categorized, located, and labeled.

     --containerName=<name> overrides the default scratch container.

EXIT
     0 verdict landed and every assertion held;  1 otherwise.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');

const roundTripValidator = require('../roundTripValidator')();

const { commandLineParameters } = process.global;
const containerName =
	(commandLineParameters.values.containerName || [])[0] || 'DEV_sifRoundTrip_080326';

const SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01');
const OUTPUT_PATH = path.join(__dirname, 'test-artifacts', 'realGraphRun');

// the campaign census of record for snapshot 01 (Phase 0 scout + Phase 1 audit; revisited on
// any RT-12 pin flip)
const CENSUS_OF_RECORD = {
	tableCount: 159,
	fieldRowCount: 15620,
};

const RULED_BACKLOG_LABEL_LIST = [
	'fieldCharacteristics (forge translation gap: lib/parser.js carries the Characteristics ' +
		'cell; forgeSif.js scalar map omits it)',
];

const failOut = (failureMessage) => {
	console.error(`${moduleName} FAILED: ${failureMessage}`);
	process.exit(1);
};

console.error(`[${moduleName}] validating container '${containerName}' against snapshot 01 ...`);
roundTripValidator.validate(
	{ containerName, snapshotPath: SNAPSHOT_PATH, outputPath: OUTPUT_PATH },
	(validateError, verdict) => {
		if (validateError) {
			failOut(validateError);
			return;
		}

		const assertionFailureList = [];
		const assertThat = (assertionLabel, condition) => {
			console.error(`  ${condition ? 'ok  ' : 'FAIL'} ${assertionLabel}`);
			if (!condition) {
				assertionFailureList.push(assertionLabel);
			}
		};

		assertThat('INVENTED === 0 (hard)', verdict.invented === 0);
		assertThat('orderMismatches === 0 (R-SF-1)', verdict.orderMismatches === 0);
		assertThat(
			'every LOST record located and carrying the ruled backlog label',
			verdict.report.lostDetailList.length === verdict.lost &&
				verdict.report.lostDetailList.every(
					(oneLost) =>
						oneLost.located &&
						oneLost.backlogLabel &&
						RULED_BACKLOG_LABEL_LIST.includes(oneLost.backlogLabel),
				),
		);
		assertThat(
			`source table census equals record (${verdict.report.sourceStats.tableCount} vs ` +
				`${CENSUS_OF_RECORD.tableCount})`,
			verdict.report.sourceStats.tableCount === CENSUS_OF_RECORD.tableCount,
		);
		assertThat(
			`source field-row census equals record (${verdict.report.sourceStats.fieldRowCount} vs ` +
				`${CENSUS_OF_RECORD.fieldRowCount})`,
			verdict.report.sourceStats.fieldRowCount === CENSUS_OF_RECORD.fieldRowCount,
		);
		assertThat(
			'SCALE report present with the largest group stated (member + pair counts)',
			!!verdict.scaleReport &&
				typeof verdict.scaleReport.runtimeMs === 'number' &&
				verdict.scaleReport.rssBytes > 0 &&
				!!verdict.scaleReport.largestSourceGroup &&
				verdict.scaleReport.largestSourceGroup.memberCount >= 2 &&
				verdict.scaleReport.largestSourceGroup.pairCount >= 1 &&
				verdict.scaleReport.largestSourceGroup.groupSubject !== '',
		);

		console.log(
			JSON.stringify(
				{
					containerName,
					roundTripClean: verdict.roundTripClean,
					reproduced: verdict.reproduced,
					lost: verdict.lost,
					lostDeclaredContext: verdict.lostDeclaredContext,
					lostContentGap: verdict.lostContentGap,
					invented: verdict.invented,
					orderMismatches: verdict.orderMismatches,
					scaleReport: verdict.scaleReport,
					snapshotCombinedDigest: verdict.snapshot.combinedDigest,
					verdictPath: path.join(OUTPUT_PATH, 'roundTripVerdict.json'),
					assertionFailures: assertionFailureList,
				},
				null,
				1,
			),
		);
		if (assertionFailureList.length) {
			failOut(`${assertionFailureList.length} assertion(s) failed`);
			return;
		}
		console.error(`[${moduleName}] VERDICT LANDED AND ASSERTED`);
		process.exit(0);
	},
);
