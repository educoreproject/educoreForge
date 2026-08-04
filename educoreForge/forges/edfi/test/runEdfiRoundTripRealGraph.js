#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     runEdfiRoundTripRealGraph.js — the Phase 3 REAL-graph round-trip verdict

DESCRIPTION
     Runs roundTripValidator.validate() against the materialized scratch container
     DEV_edfiRoundTrip_080326 (built by runEdfiMaterialize.js) over the pinned snapshot 04,
     landing the RT-6 verdict artifact in test-artifacts/realGraphRun/. This is the run that
     audits the LOADER as well as the forge (RT-4: the graph, not the forge's memory).

     Bolt endpoint + credential are resolved from the RUNNING container (docker inspect),
     never restated here.

     ASSERTED (exit 1 on any miss):
       - inventedTotal === 0 (doctrine 5.3 hard line; diff INVENTED + crosswalk guard)
       - every LOST record carries a located file:line AND one of the three ruled backlog
         labels (R-WO-15d + ratified extension) — no anonymous loss
       - the reducer census equals the Phase 1 census of record for snapshot 04
         (849 constructs / 1,904 properties / 60 enumeration items / 367 domain items /
         205 interchange components) — the two-independent-readers cross-check on the REAL
         corpus (the 19-comment census is also asserted; the DEVLOG's earlier 17 was an
         undercount, corrected this phase with grep evidence)

     NOT asserted: roundTripClean — LOST is the honest work-remaining meter (the enrichment
     backlog); the verdict reports it, categorized and located.

     --containerName=<name> overrides the default scratch container.

EXIT
     0 verdict landed and every assertion held;  1 otherwise.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');

const roundTripValidator = require('../roundTripValidator')();

const { commandLineParameters } = process.global;
const containerName =
	(commandLineParameters.values.containerName || [])[0] || 'DEV_edfiRoundTrip_080326';

const SNAPSHOT_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '04');
const OUTPUT_PATH = path.join(__dirname, 'test-artifacts', 'realGraphRun');

// the Phase 1 census of record for snapshot 04 (DEVLOG, QUIET_RIVER; comment census corrected
// to 19 this phase — data pinned to THIS snapshot, revisited on any RT-12 pin flip)
const CENSUS_OF_RECORD = {
	totalConstructCount: 849,
	propertyCount: 1904,
	enumerationItemCount: 60,
	domainItemCount: 367,
	interchangeComponentCount: 205,
	commentLineCount: 19,
};

const RULED_BACKLOG_LABEL_LIST = [
	'interchangeComponentKind (R-WO-15d)',
	'itemMetaEdId (R-WO-15d extension)',
	'itemNamespaceQualifier (R-WO-15d extension)',
];

const failOut = (failureMessage) => {
	console.error(`${moduleName} FAILED: ${failureMessage}`);
	process.exit(1);
};

console.error(`[${moduleName}] validating container '${containerName}' against snapshot 04 ...`);
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

		assertThat('inventedTotal === 0 (hard)', verdict.inventedTotal === 0);
		assertThat('diff INVENTED === 0', verdict.invented === 0);
		assertThat('crosswalk guard violations === 0', verdict.crosswalkGuard.violationCount === 0);
		assertThat(
			'every LOST record located and carrying a ruled backlog label',
			verdict.report.lostDetailList.length === verdict.lost &&
				verdict.report.lostDetailList.every(
					(oneLost) =>
						oneLost.located &&
						oneLost.backlogLabel &&
						RULED_BACKLOG_LABEL_LIST.includes(oneLost.backlogLabel),
				),
		);

		const reducedConstructTotal = Object.values(
			verdict.reducerCensus.constructCountByType,
		).reduce((runningSum, oneCount) => runningSum + oneCount, 0);
		assertThat(
			`reducer construct census equals record (${reducedConstructTotal} vs ${CENSUS_OF_RECORD.totalConstructCount})`,
			reducedConstructTotal === CENSUS_OF_RECORD.totalConstructCount,
		);
		assertThat(
			`reducer property census equals record (${verdict.reducerCensus.propertyCount})`,
			verdict.reducerCensus.propertyCount === CENSUS_OF_RECORD.propertyCount,
		);
		assertThat(
			`enumeration item census equals record (${verdict.reducerCensus.enumerationItemCount})`,
			verdict.reducerCensus.enumerationItemCount === CENSUS_OF_RECORD.enumerationItemCount,
		);
		assertThat(
			`domain item census equals record (${verdict.reducerCensus.domainItemCount})`,
			verdict.reducerCensus.domainItemCount === CENSUS_OF_RECORD.domainItemCount,
		);
		assertThat(
			`interchange component census equals record (${verdict.reducerCensus.interchangeComponentCount})`,
			verdict.reducerCensus.interchangeComponentCount ===
				CENSUS_OF_RECORD.interchangeComponentCount,
		);
		assertThat(
			`comment census equals corrected record (${verdict.declaredContextCensus.commentLineCount} vs 19)`,
			verdict.declaredContextCensus.commentLineCount === CENSUS_OF_RECORD.commentLineCount,
		);

		console.log(
			JSON.stringify(
				{
					containerName,
					roundTripClean: verdict.roundTripClean,
					reproduced: verdict.reproduced,
					lost: verdict.lost,
					lostByBacklogLabel: verdict.lostByBacklogLabel,
					inventedTotal: verdict.inventedTotal,
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
