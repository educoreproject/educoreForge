#!/usr/bin/env node
'use strict';

// test-cedsElementsWorkbookOracle.js — GATE D (lane DES, 2026-10-12; COPPER_RIVER ruling Q5): CEDS's own V14 Elements workbook,
// an independent rendering of the release, held against the CEDS statement set. Here the statements are the pinned ontology's
// own (the round trip proves the emission equals them, 239,761 / 0 / 0); in a build the gate reads the EMISSION compiled from
// the graph, inside CEDS's roundTripValidator. Shown PASSING on every compared field with exactly the five declared
// differences, then RED on each fault it exists for: a statement the emission lost, a statement it changed, a declared
// difference that stopped occurring, and an undeclared one.
//
// Run: node forges/ceds/test/test-cedsElementsWorkbookOracle.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate D: the CEDS-Elements V14 workbook against the CEDS statements, with its twins
SYNOPSIS
     ${moduleName} [-verbose] [-help]
EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const canonicalLib = require('../lib/roundTripCanonical')();
const oracleLib = require('../lib/elementsWorkbookOracle');
const xlsxReader = require(path.join(__dirname, '..', '..', '..', 'lib', 'xlsx-reader', 'xlsx-reader'))();
const layout = require('../gates/elementsWorkbookOracleLayout.json');
const declaredDifferenceList = require('../gates/elementsWorkbookDeclaredDifferences.json').declaredDifferenceList;

const ONTOLOGY_PATH = path.join(__dirname, '..', 'assets', 'standardSourceData', '01', 'CEDS-Ontology.rdf');
const WORKBOOK_PATH = path.join(__dirname, '..', 'gates', 'elementsWorkbookOracleData', '01', 'CEDS-V14.0.0.0.xlsx');
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

canonicalLib.canonicalizeRdfFile({ filePath: ONTOLOGY_PATH }, (canonicalError, canonical) => {
	harness.equal('the pinned ontology canonicalizes', canonicalError, '');
	xlsxReader.readWorkbookFile({ filePath: WORKBOOK_PATH }, (readError, workbook) => {
		harness.equal('the V14 workbook reads', readError, '');
		const compare = ({ statementMap, declaredList }) => oracleLib.compareWorkbookWithStatements({ workbook, emittedStatementMap: statementMap, normalizeLiteral: canonicalLib.normalizeLiteral, layout, declaredDifferenceList: declaredList });

		harness.section('the workbook agrees with the release on every compared field but the five declared');
		const real = compare({ statementMap: canonical.statements, declaredList: declaredDifferenceList });
		harness.equal('no refusal', real.error, undefined);
		harness.equal('23,237 terms compared, one row each', real.comparedRowCount, 23237);
		harness.equal('273,556 fields compared', real.comparedFieldCount, 273556);
		harness.equal('273,551 agree', real.agreeingFieldCount, 273551);
		harness.equal('the five declared differences are all observed', real.declaredDifferenceList.length, 5);
		harness.equal('no undeclared difference', real.undeclaredDifferenceList.length, 0);
		harness.equal('no declared difference has gone stale', real.unobservedDeclaredDifferenceList.length, 0);

		harness.section('twins — each fault OBSERVED red');
		const statementKeyOfLabel = Array.from(canonical.statements.keys()).find((oneKey) => {
			const oneStatement = canonical.statements.get(oneKey);
			return oneStatement.subject === 'https://w3id.org/CEDStandards/terms/P000001' && oneStatement.predicate === RDFS_LABEL;
		});
		const withoutLabel = new Map(canonical.statements);
		withoutLabel.delete(statementKeyOfLabel);
		harness.equal("twin 'emissionLostOneLabel' is RED: one undeclared difference", compare({ statementMap: withoutLabel, declaredList: declaredDifferenceList }).undeclaredDifferenceList.length, 1);
		const withChangedLabel = new Map(canonical.statements);
		withChangedLabel.set(statementKeyOfLabel, { ...canonical.statements.get(statementKeyOfLabel), object: 'Academic Award Date (changed)' });
		harness.equal("twin 'emissionChangedOneLabel' is RED: one undeclared difference", compare({ statementMap: withChangedLabel, declaredList: declaredDifferenceList }).undeclaredDifferenceList.length, 1);
		harness.equal("twin 'declaredDifferenceRemoved' is RED: the difference it excused is undeclared", compare({ statementMap: canonical.statements, declaredList: declaredDifferenceList.slice(1) }).undeclaredDifferenceList.length, 1);
		const staleDeclaration = { sheetName: 'Properties', iri: 'https://w3id.org/CEDStandards/terms/P000001', header: 'Label (rdfs:label)', reason: 'a declaration of a difference that does not occur' };
		harness.equal("twin 'staleDeclaration' is RED: a declared difference not observed", compare({ statementMap: canonical.statements, declaredList: declaredDifferenceList.concat([staleDeclaration]) }).unobservedDeclaredDifferenceList.length, 1);
		harness.report();
	});
});
