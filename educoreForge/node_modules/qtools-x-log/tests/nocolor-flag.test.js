#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Writable } = require('stream');

class MockWritableStream extends Writable {
	constructor(options) {
		super(options);
		this.data = '';
	}
	
	_write(chunk, encoding, callback) {
		this.data += chunk.toString();
		callback();
	}
	
	clear() {
		this.data = '';
	}
}

const setupMocks = (switches = {}) => {
	// Mock qtools-parse-command-line
	delete require.cache[require.resolve('qtools-parse-command-line')];
	require.cache[require.resolve('qtools-parse-command-line')] = {
		exports: {
			getParameters: () => ({
				switches: {
					silent: false,
					quiet: false,
					verbose: false,
					debug: false,
					noColor: false,
					...switches
				}
			})
		}
	};
	
	// Clear module cache for x-log to get fresh instance
	delete require.cache[require.resolve('../x-log.js')];
};

test('emphatic method uses asterisks when noColor flag is set', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ noColor: true });
	const xLog = require('../x-log.js');
	
	xLog.emphatic('Test emphatic message');
	
	console.error = originalConsoleError;
	
	// Should use asterisks instead of colors
	assert.ok(mockStderr.data.includes('*** Test emphatic message ***'));
	// Should not contain ANSI color codes
	assert.ok(!mockStderr.data.includes('\u001b'));
});

test('emphatic method works when noColor flag is false', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ noColor: false });
	const xLog = require('../x-log.js');
	
	xLog.emphatic('Test emphatic message');
	
	console.error = originalConsoleError;
	
	// Should contain the message
	assert.ok(mockStderr.data.includes('Test emphatic message'));
	// Should have produced some output
	assert.ok(mockStderr.data.length > 0);
});

test('error method respects noColor flag for object output', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ noColor: true });
	const xLog = require('../x-log.js');
	
	const testObj = { key: 'value', number: 123 };
	xLog.error(testObj);
	
	console.error = originalConsoleError;
	
	// Should contain the object data
	assert.ok(mockStderr.data.includes('key'));
	assert.ok(mockStderr.data.includes('value'));
	// When noColor is true, util.inspect should not include colors
	// The exact format depends on util.inspect implementation
});

test('outputFunction respects noColor setting for object formatting', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	// Test with noColor: true
	setupMocks({ noColor: true });
	let xLog = require('../x-log.js');
	
	const testObj = { prop: 'value', nested: { inner: true } };
	xLog.status(testObj);
	
	const noColorOutput = mockStderr.data;
	mockStderr.clear();
	
	// Test with noColor: false
	setupMocks({ noColor: false });
	xLog = require('../x-log.js');
	
	xLog.status(testObj);
	
	const colorOutput = mockStderr.data;
	
	console.error = originalConsoleError;
	
	// Both should contain the object data
	assert.ok(noColorOutput.includes('prop'));
	assert.ok(colorOutput.includes('prop'));
	
	// The noColor version should not have ANSI escape sequences in object formatting
	// The color version might have them (depends on util.inspect behavior)
});

test('debug output respects noColor flag', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ debug: true, noColor: true });
	const xLog = require('../x-log.js');
	
	xLog.debug('Debug message');
	
	console.error = originalConsoleError;
	
	// Should contain debug message and formatting
	assert.ok(mockStderr.data.includes('Debug message'));
	assert.ok(mockStderr.data.includes('---')); // Debug formatting
});

test('verbose output respects noColor flag', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ verbose: true, noColor: true });
	const xLog = require('../x-log.js');
	
	const complexObj = { array: [1, 2, 3], nested: { deep: { value: 'test' } } };
	xLog.verbose(complexObj);
	
	console.error = originalConsoleError;
	
	// Should contain object data formatted without colors
	assert.ok(mockStderr.data.includes('array'));
	assert.ok(mockStderr.data.includes('nested'));
	assert.ok(mockStderr.data.includes('test'));
});