#!/usr/bin/env node
'use strict';

// test-pescldCsvReader.js — the PESC_LD forge's strict RFC 4180 reader (zeroBacklog lane C1): what it accepts, and every refusal
// named. Pure: text in, records out; no files, no Docker.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- the PESC_LD CSV reader: accepted forms and named refusals (pure, no I/O)

SYNOPSIS
     node forges/pescld/test/${moduleName}.js [-verbose] [-help]

DESCRIPTION
     Feeds forges/pescld/lib/pescldCsvReader.js small texts: the forms the PESC_LD snapshot uses (CRLF records, LF inside a quoted
     cell, no final terminator) and the RFC forms it does not (a "" escape, a final terminator), then one text per refusal.

EXIT STATUS
     0 every assertion passed;  1 otherwise.
`;

const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const harness = require(path.join(TREE_ROOT, 'test', 'testLib', 'harness'))(moduleName);
const { parseCsvText } = require(path.join(__dirname, '..', 'lib', 'pescldCsvReader'));

const read = (csvText) => parseCsvText({ csvText, sourceFileName: 'fixture.csv' });
const refusalListOf = (result) => (result.refusalText === undefined ? [] : [result.refusalText]);

harness.section('SECTION 1 — the forms the snapshot uses, and the rest of the RFC');
const snapshotForm = read('a,b,c\r\n1,"x\ny",3\r\n,,last');
harness.accepts('CRLF records, an LF inside a quoted cell, no final terminator', refusalListOf(snapshotForm));
harness.equal('the header', JSON.stringify(snapshotForm.headerList), '["a","b","c"]');
harness.equal('two records, cells verbatim (the inner LF kept)', JSON.stringify(snapshotForm.recordList.map((oneRecord) => oneRecord.cellList)), JSON.stringify([['1', 'x\ny', '3'], ['', '', 'last']]));
harness.equal('a record knows its line (the quoted LF advances the count)', JSON.stringify(snapshotForm.recordList.map((oneRecord) => oneRecord.lineNumber)), '[2,4]');
const escapeForm = read('a,b\n"say ""hi""", trailing \n');
harness.accepts('LF records, a "" escape, a final terminator', refusalListOf(escapeForm));
harness.equal('the escape is one quote, the surrounding space verbatim, no phantom record', JSON.stringify(escapeForm.recordList.map((oneRecord) => oneRecord.cellList)), JSON.stringify([['say "hi"', ' trailing ']]));

harness.section('SECTION 2 — every refusal, named');
harness.rejects('a quote opening mid-cell', refusalListOf(read('a,b\nx"y",2')), /opens a quote inside a cell/);
harness.rejects('text after a closing quote', refusalListOf(read('a,b\n"x"y,2')), /text after a closing quote/);
harness.rejects('a quoted cell never closed', refusalListOf(read('a,b\n"x,2')), /ends inside a quoted cell/);
harness.rejects('a bare carriage return', refusalListOf(read('a,b\nx\ry,2')), /bare carriage return/);
harness.rejects('a ragged record', refusalListOf(read('a,b\n1,2,3')), /has 3 cells where the header has 2/);
harness.rejects('an empty text', refusalListOf(read('')), /holds no header record/);
harness.rejects('a non-string', refusalListOf(parseCsvText({ csvText: undefined, sourceFileName: 'fixture.csv' })), /not a string/);

harness.report();
