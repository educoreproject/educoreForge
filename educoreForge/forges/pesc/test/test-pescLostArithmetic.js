#!/usr/bin/env node
'use strict';

// test-pescLostArithmetic.js — THE GATE FOR THE A13 ARITHMETIC ITSELF.
//
// WHY THIS FILE EXISTS, stated plainly because it is the whole justification for adding a 96th
// suite to the tree. Doctrine amendment A13 (2026-08-04) lifted explicitly-omitted declarations
// OUT of every loss total: `lostTotal` counts contentGap ALONE, and `notReproducedTotal` carries
// the old arithmetic under an honest name. The Phase 2 builder added assertions of that rule to
// test-pescRoundTrip / test-sifRoundTrip / test-edfiRoundTrip and then checked whether they could
// actually fail. THEY COULD NOT. Every hermetic fixture in the tree reports explicitlyOmitted = 0
// — the PESC and SIF fixtures round-trip clean by construction (RT-7), Ed-Fi's in-domain bucket is
// empty by design, and SIF's registry is deliberately empty. With the omitted count at zero,
// `contentGap + explicitlyOmitted === notReproduced` and `lostTotal === contentGapTotal` are BOTH
// true under the OLD arithmetic as well. The assertions passed for a reason unrelated to their
// claim: 0 + N === N proves nothing about whether the omissions were excluded.
//
// The 73 real omissions live only in the PESC REAL-GRAPH run, which needs Docker, a materialized
// graph and the full source snapshot — not something a hermetic suite can reach. So the arithmetic
// change would have shipped gated by nothing. This suite closes that hole at the only place it can
// be closed cheaply: the diff module is a PURE function over two statement Maps, so a hand-built
// source Map containing a KNOWN explicitly-omitted predicate that is NOT emitted produces a
// nonzero explicitlyOmitted with no graph, no Docker, and no network.
//
// The three-state proof for this gate is recorded in the Phase 2 DEVLOG: it was observed RED
// against the pre-A13 arithmetic (lostTotal summing both categories) before it was observed GREEN.
//
// Pure: no Docker, no bolt, no Voyage, no filesystem writes.
//
// Run: node forges/pesc/test/test-pescLostArithmetic.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate for the A13 loss arithmetic (explicitly-omitted excluded from LOST)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
DESCRIPTION
     Drives the PURE pesc diff module with a hand-built statement set carrying a nonzero
     explicitlyOmitted count — the one condition no hermetic fixture in the tree produces — and
     proves contentGap alone is LOSS while the deliberate omission is reported and excluded.
OPTIONS
     -verbose    Show every individual assertion, not just failures and the tally.
     -quiet      Failures and the tally only.
     -help       This message.
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const diffLib = require('../lib/roundTripDiff')();
const canonicalLib = require('../lib/roundTripXsdCanonical')();

const SCHEMA_SUBJECT = `${canonicalLib.SUBJECT_SCHEME}CoreMain.xsd`;
const TYPE_SUBJECT = `${canonicalLib.SUBJECT_SCHEME}CoreMain.xsd#complexType/AddressType`;

// the statement shape the canonicalizer mints: { subject, predicate, object, subjectRoot }
const statementOf = ({ subject, predicate, object }) => ({
	subject,
	predicate,
	object,
	subjectRoot: subject,
	fileLabel: 'CoreMain.xsd',
});
const identityOf = (oneStatement) =>
	`${oneStatement.subject}\t${oneStatement.predicate}\t${oneStatement.object}`;
const mapOf = (statementList) =>
	new Map(statementList.map((oneStatement) => [identityOf(oneStatement), oneStatement]));

// =====================================================================
harness.section(
	'THE REGISTRY IS REAL — the predicates this gate calls omitted are the ones the canonicalizer claims',
);
// =====================================================================
// If this drifts, the gate below would be measuring a contentGap and calling it an omission.
harness.ok(
	'EXPLICITLY_OMITTED_PREDICATES is a non-empty registry on the canonicalizer',
	Array.isArray(canonicalLib.EXPLICITLY_OMITTED_PREDICATES) &&
		canonicalLib.EXPLICITLY_OMITTED_PREDICATES.length > 0,
	JSON.stringify(canonicalLib.EXPLICITLY_OMITTED_PREDICATES),
);
harness.ok(
	"'targetNamespace' is CLAIMED by the registry (this gate depends on it)",
	canonicalLib.EXPLICITLY_OMITTED_PREDICATES.includes('targetNamespace'),
);
harness.ok(
	"'importsNamespace' is CLAIMED by the registry",
	canonicalLib.EXPLICITLY_OMITTED_PREDICATES.includes('importsNamespace'),
);
harness.equal(
	"a claimed predicate categorizes as 'explicitlyOmitted'",
	diffLib.lostCategoryOfPredicate('targetNamespace'),
	'explicitlyOmitted',
);
harness.equal(
	"an UNCLAIMED predicate defaults to 'contentGap' — omission must be claimed, never assumed",
	diffLib.lostCategoryOfPredicate('documentation'),
	'contentGap',
);

// =====================================================================
harness.section(
	'THE ARITHMETIC — a nonzero explicitlyOmitted, the condition NO hermetic fixture in the tree produces',
);
// =====================================================================
// Source makes five statements. The emission reproduces two of them. Of the three not
// reproduced, TWO are registry-claimed declarations (deliberate) and ONE is real content.
const sourceStatements = mapOf([
	statementOf({ subject: SCHEMA_SUBJECT, predicate: 'targetNamespace', object: 'urn:org:pesc:core' }),
	statementOf({ subject: SCHEMA_SUBJECT, predicate: 'importsNamespace', object: 'urn:org:pesc:sector' }),
	statementOf({ subject: TYPE_SUBJECT, predicate: 'documentation', object: 'A postal address.' }),
	statementOf({ subject: TYPE_SUBJECT, predicate: 'fieldType', object: 'AddressLine' }),
	statementOf({ subject: TYPE_SUBJECT, predicate: 'minOccurs', object: '1' }),
]);
const emittedStatements = mapOf([
	statementOf({ subject: TYPE_SUBJECT, predicate: 'fieldType', object: 'AddressLine' }),
	statementOf({ subject: TYPE_SUBJECT, predicate: 'minOccurs', object: '1' }),
]);

let capturedReport;
diffLib.diffStatements(
	{ sourceStatements, emittedStatements, sourceStats: {}, emittedStats: {}, context: {} },
	(diffError, diffResult) => {
		harness.equal('the diff completes without refusal', diffError, '');
		capturedReport = (diffResult || {}).report;
	},
);

harness.ok('a report came back', !!capturedReport);
const headline = (capturedReport || {}).headline || {};

harness.equal('MATCHED is 2', headline.matched, 2);
harness.equal('NOT REPRODUCED is 3 — the raw set difference, unchanged by A13', headline.notReproduced, 3);
harness.equal(
	'explicitlyOmitted is 2 — NONZERO, which is the whole point of this suite',
	headline.explicitlyOmitted,
	2,
);
harness.equal('contentGap is 1 — the ONLY genuine loss here', headline.contentGap, 1);
harness.equal('INVENTED is 0 — the hard line holds', headline.invented, 0);

// THE DISCRIMINATING ASSERTION. Under the pre-A13 arithmetic LOST was the sum (3). Under A13 it
// is contentGap alone (1). These two numbers DIFFER here, which is exactly what no other fixture
// in the tree can say — and it is why this assertion can actually fail.
harness.ok(
	'LOSS (contentGap) and NOT REPRODUCED are DIFFERENT numbers here — the gate can discriminate the two arithmetics',
	headline.contentGap !== headline.notReproduced,
	`contentGap=${headline.contentGap} notReproduced=${headline.notReproduced}`,
);
harness.equal(
	'the two categories still sum to NOT REPRODUCED — no uncategorized loss (A7 preserved)',
	headline.contentGap + headline.explicitlyOmitted,
	headline.notReproduced,
);
harness.ok(
	'the headline carries NO `lost` field — the ambiguous name is gone, not merely re-pointed',
	headline.lost === undefined,
	JSON.stringify(Object.keys(headline)),
);

// =====================================================================
harness.section('PER-ROW CATEGORY — every not-reproduced row says which kind it is');
// =====================================================================
const rowsByPredicate = {};
(capturedReport || {}).perPredicate.forEach((oneRow) => {
	rowsByPredicate[oneRow.predicate] = oneRow;
});
harness.equal(
	"the targetNamespace row is categorized 'explicitlyOmitted'",
	rowsByPredicate.targetNamespace.lostCategory,
	'explicitlyOmitted',
);
harness.equal(
	"the documentation row is categorized 'contentGap'",
	rowsByPredicate.documentation.lostCategory,
	'contentGap',
);
harness.equal(
	'the reproduced fieldType row reports zero loss',
	rowsByPredicate.fieldType.lost,
	0,
);

// =====================================================================
harness.section('THE HUMAN REPORT SAYS CHOSEN, NOT LOST — the naming defect A13 cured');
// =====================================================================
let capturedReportText = '';
diffLib.renderReportText({ report: capturedReport }, (renderError, renderResult) => {
	harness.equal('the report renders without refusal', renderError, '');
	capturedReportText = (renderResult || {}).reportText || '';
});
harness.match(
	'the report prints LOST as contentGap ALONE (1), never the sum',
	capturedReportText,
	/LOST \.+\s+1\s+\(contentGap alone/,
);
harness.match(
	'the report prints NOT REPRODUCED separately (3)',
	capturedReportText,
	/NOT REPRODUCED \.+\s+3/,
);
harness.match(
	'the omission line says CHOSEN — a reader who never saw the doctrine can tell nothing is wrong',
	capturedReportText,
	/explicitlyOmitted \.+\s+2\s+.*CHOSEN, never lost/,
);
harness.ok(
	"the rendered report no longer uses the word 'declaredContext' anywhere",
	!capturedReportText.includes('declaredContext'),
);

harness.report();
