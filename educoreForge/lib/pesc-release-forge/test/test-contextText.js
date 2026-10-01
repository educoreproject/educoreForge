#!/usr/bin/env node
'use strict';

// test-contextText.js — the shared library's copy of the SIF context-text rule holds to the SIF rule's
// own examples and to the PESC paths the design writes out (DESIGN-pescForge.md §2.2, §3.3). ALL PURE.
// The copy and forges/sif260928/lib/sif260928ContextText.js must render alike; this suite renders
// every example through BOTH and requires them equal, so a change to one alone is caught here.
//
// Run: node lib/pesc-release-forge/test/test-contextText.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- the PESC copy of the SIF context-text rule, against the SIF examples and the design's PESC paths

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { contextTextOf } = require(path.join(__dirname, '..', 'contextText'));
const sifContextText = require(path.join(__dirname, '..', '..', '..', 'forges', 'sif260928', 'lib', 'sif260928ContextText'));

// ---- FROZEN LITERALS: the SIF rule's header examples and the design's PESC renderings. Never edited to match.
const RULED_RENDERING_BY_PATH = Object.freeze({
	'Demographics/BirthDate': 'Demographics / Birth Date',
	W4Date: 'W4 Date',
	LEAInfo: 'LEA Info',
	TitleIProgram: 'Title I Program',
	OtherLEAs: 'Other LEAs',
	'CollegeTranscript/Student/Person/Name/FirstName': 'College Transcript / Student / Person / Name / First Name',
	'CollegeTranscript/Student/AcademicRecord/AcademicAward/AcademicAwardLevel': 'College Transcript / Student / Academic Record / Academic Award / Academic Award Level',
	CollegeTranscript: 'College Transcript',
});

harness.section('the copy renders the frozen examples, and renders them as the SIF original does');
Object.keys(RULED_RENDERING_BY_PATH).forEach((onePath) => {
	harness.equal(`'${onePath}' → '${RULED_RENDERING_BY_PATH[onePath]}'`, contextTextOf(onePath), RULED_RENDERING_BY_PATH[onePath]);
	harness.equal(`  and the SIF original agrees on '${onePath}'`, contextTextOf(onePath), sifContextText.contextTextOf(onePath));
});

harness.report();
