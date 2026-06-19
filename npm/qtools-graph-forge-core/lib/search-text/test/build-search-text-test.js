#!/usr/bin/env node
'use strict';

// build-search-text-test.js — gating tests for the searchText builder (contract §1C).
// Run: node lib/search-text/test/build-search-text-test.js

const assert = require('assert');

const { buildSearchText, ValidationError } = require('../build-search-text')();

let passCount = 0;
let failCount = 0;

const check = (label, fn) => {
	try {
		fn();
		passCount++;
		console.log(`  PASS  ${label}`);
	} catch (err) {
		failCount++;
		console.log(`  FAIL  ${label}\n        ${err.message}`);
	}
};

console.log('searchText builder gating tests:');

// 1. a DmeProperty carries its owning Class name
check('DmeProperty carries its owning Class name', () => {
	const searchText = buildSearchText({
		role: 'DmeProperty',
		name: 'FirstName',
		owningClassName: 'K12Student',
		description: 'The legal first name of the student.',
	});
	assert.ok(searchText.includes('K12Student'), 'owning class name must appear');
	assert.ok(searchText.includes('FirstName'), 'property name must appear');
	assert.ok(searchText.includes('|'), 'must be pipe-delimited');
	// built from structure, NOT description
	assert.ok(!searchText.includes('legal first name'), 'description must NOT appear');
});

// 2. a DmeOptionValue carries its set + owner
check('DmeOptionValue carries its set + owner', () => {
	const searchText = buildSearchText({
		role: 'DmeOptionValue',
		name: 'Hispanic or Latino',
		optionSetName: 'RaceEthnicity',
		owningName: 'StudentDemographic',
		owningClassName: 'K12Student',
	});
	assert.ok(searchText.includes('RaceEthnicity'), 'option set must appear');
	assert.ok(
		searchText.includes('StudentDemographic') || searchText.includes('K12Student'),
		'owner must appear',
	);
	assert.ok(searchText.includes('Hispanic or Latino'), 'value name must appear');
});

// 3. a null-description element still yields NON-empty searchText
check('null description still yields non-empty searchText', () => {
	const searchText = buildSearchText({
		role: 'DmeProperty',
		name: 'BirthDate',
		owningClassName: 'K12Student',
		description: null,
	});
	assert.ok(searchText.length > 0, 'must be non-empty');
	assert.ok(searchText.includes('BirthDate'));
});

check('empty-string description still yields non-empty searchText', () => {
	const searchText = buildSearchText({
		role: 'DmeOptionValue',
		name: 'Female',
		optionSetName: 'Sex',
		owningName: 'K12Student',
		description: '',
	});
	assert.ok(searchText.length > 0, 'must be non-empty');
	assert.ok(searchText.includes('Female'));
});

// 4. a genuinely-empty input throws ValidationError naming the element
check('genuinely-empty input throws ValidationError naming the element', () => {
	let threw = false;
	try {
		buildSearchText({
			role: 'DmeProperty',
			name: '   ',
			owningClassName: '',
			description: 'has a description but no usable structural context',
		});
	} catch (err) {
		threw = true;
		assert.ok(err instanceof ValidationError, 'must be a ValidationError');
		assert.ok(err instanceof Error, 'ValidationError must be a real Error subclass');
		assert.ok(
			err.message.includes('DmeProperty'),
			'error must name the offending element (role)',
		);
	}
	assert.ok(threw, 'must throw on genuinely-empty input');
});

check('missing/unknown role throws ValidationError', () => {
	let threw = false;
	try {
		buildSearchText({ name: 'Orphan', role: 'NotARole' });
	} catch (err) {
		threw = true;
		assert.ok(err instanceof ValidationError);
		assert.ok(err.message.includes('NotARole'));
	}
	assert.ok(threw, 'must throw on unknown role');
});

console.log(`\nsearchText: ${passCount} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
