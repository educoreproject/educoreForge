#!/usr/bin/env node
'use strict';

// runC3IndependentCheck.js — Phase 3.5, gate C-3, run on OBSIDIAN_PATH's explicit ruling.
//
// THE SECOND OPINION, FROM OUTSIDE OUR OWN TOOLCHAIN. Our comparator canonicalizes both sides
// with the SAME code and collapses internal whitespace on both sides deliberately, so it is
// structurally unable to audit its own assumption. That hole has already swallowed 20 real
// literal differences once: CEDS writes 62 character references, our emitter wrote raw carriage
// returns, XML 1.0 normalizes those away on the next parse, and our instrument reported zero —
// honestly, under its own definition.
//
// STRICT is the VERDICT. Whitespace-normalized is a DIAGNOSTIC. `20 strict / 0 normalized` is the
// signature of a character-encoding difference rather than a missing statement.
//
// It reads THE ARCHIVED EMISSION, not the buildLogs original, so what is audited is the artifact
// that will still exist next week.
//
// This driver writes its result beside the other Phase 3.5 artifacts and prints it. It changes
// nothing and reads only.

const fs = require('fs');
const path = require('path');

const independentCheckLib = require(
	path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'rdf-independent-check', 'rdf-independent-check'),
)();

const SOURCE_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/forges/ceds/assets/standardSourceData/01/CEDS-Ontology.rdf';
const EMITTED_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/zArchive_roundTripProof_080426/cedsOnlyRoundTrip_20260805-025124/roundTrip/ceds/emitted/cedsOntology.emitted.rdf';

const OUTPUT_JSON_PATH = path.join(__dirname, 'c3IndependentCheck.json');
const OUTPUT_TEXT_PATH = path.join(__dirname, 'c3IndependentCheck.report.txt');

const startedAtMs = Date.now();
console.log(`C-3 source : ${SOURCE_PATH}`);
console.log(`C-3 emitted: ${EMITTED_PATH}  (THE ARCHIVED COPY)`);

independentCheckLib.compareRdfDocuments(
	{ sourcePath: SOURCE_PATH, emittedPath: EMITTED_PATH },
	(compareError, result) => {
		if (compareError) {
			// A refusal is a REPORTED OUTCOME, never a silent skip. An unavailable check must not
			// read as a passing one.
			console.log(`C-3 UNAVAILABLE — ${compareError}`);
			fs.writeFileSync(
				OUTPUT_JSON_PATH,
				`${JSON.stringify({ status: 'UNAVAILABLE', reason: compareError }, null, 1)}\n`,
			);
			process.exit(1);
		}
		console.log(`C-3 venvCreated: ${result.venvCreated}`);
		console.log(`C-3 runtimeMs:   ${Date.now() - startedAtMs}`);
		fs.writeFileSync(OUTPUT_JSON_PATH, `${JSON.stringify(result.comparison, null, 1)}\n`);
		independentCheckLib.renderComparisonText(
			{ comparison: result.comparison },
			(renderError, rendered) => {
				if (renderError) {
					console.log(`C-3 render failed: ${renderError}`);
					process.exit(1);
				}
				fs.writeFileSync(OUTPUT_TEXT_PATH, rendered.text);
				console.log('---------------- C-3 REPORT ----------------');
				console.log(rendered.text);
				console.log('--------------------------------------------');
				console.log(JSON.stringify(result.comparison, null, 1));
			},
		);
	},
);
