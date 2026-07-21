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
					...switches
				}
			})
		}
	};
	
	// Clear module cache for x-log to get fresh instance
	delete require.cache[require.resolve('../x-log.js')];
};

test('silent flag suppresses all output except errors', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalStdoutWrite = process.stdout.write;
	
	console.error = (msg) => mockStderr.write(msg);
	process.stdout.write = (msg) => mockStdout.write(msg);
	
	setupMocks({ silent: true });
	const xLog = require('../x-log.js');
	
	// These should be suppressed
	xLog.result('Should be suppressed');
	xLog.status('Should be suppressed');
	xLog.emphatic('Should be suppressed');
	xLog.verbose('Should be suppressed');
	xLog.debug('Should be suppressed');
	
	// Error should still work
	xLog.error('Error should appear');
	
	console.error = originalConsoleError;
	process.stdout.write = originalStdoutWrite;
	
	// Result is suppressed by returning early, so stdout should be empty
	assert.strictEqual(mockStdout.data, '');
	// Error should still appear
	assert.ok(mockStderr.data.includes('Error should appear'));
	// Other methods should not appear (they return early when silent)
	assert.ok(!mockStderr.data.includes('Should be suppressed'));
});

test('quiet flag suppresses status and emphatic but allows result', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalStdoutWrite = process.stdout.write;
	
	console.error = (msg) => mockStderr.write(msg);
	process.stdout.write = (msg) => mockStdout.write(msg);
	
	setupMocks({ quiet: true });
	const xLog = require('../x-log.js');
	
	xLog.result('Result should appear');
	xLog.status('Should be suppressed');
	xLog.emphatic('Should be suppressed');
	xLog.error('Error should appear');
	
	console.error = originalConsoleError;
	process.stdout.write = originalStdoutWrite;
	
	assert.ok(mockStdout.data.includes('Result should appear'));
	assert.ok(mockStderr.data.includes('Error should appear'));
	assert.ok(!mockStderr.data.includes('Should be suppressed'));
});

test('verbose flag enables verbose output', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ verbose: true });
	const xLog = require('../x-log.js');
	
	xLog.verbose('Verbose message should appear');
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('Verbose message should appear'));
});

test('debug flag enables debug output with formatting', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ debug: true });
	const xLog = require('../x-log.js');
	
	xLog.debug('Debug message should appear');
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('Debug message should appear'));
	assert.ok(mockStderr.data.includes('---')); // Debug formatting includes dashes
});

test('debug with label option shows labeled output', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ debug: true });
	const xLog = require('../x-log.js');
	
	xLog.debug('Debug message with label', { label: 'TEST LABEL' });
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('TEST LABEL'));
	assert.ok(mockStderr.data.includes('Debug message with label'));
});

test('combined flags work correctly', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalStdoutWrite = process.stdout.write;
	
	console.error = (msg) => mockStderr.write(msg);
	process.stdout.write = (msg) => mockStdout.write(msg);
	
	// Test verbose + debug together
	setupMocks({ verbose: true, debug: true });
	const xLog = require('../x-log.js');
	
	xLog.verbose('Verbose should appear');
	xLog.debug('Debug should appear');
	xLog.status('Status should appear');
	
	console.error = originalConsoleError;
	process.stdout.write = originalStdoutWrite;
	
	assert.ok(mockStderr.data.includes('Verbose should appear'));
	assert.ok(mockStderr.data.includes('Debug should appear'));
	assert.ok(mockStderr.data.includes('Status should appear'));
});

test('silent overrides other flags', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalStdoutWrite = process.stdout.write;
	
	console.error = (msg) => mockStderr.write(msg);
	process.stdout.write = (msg) => mockStdout.write(msg);
	
	// Test silent with verbose and debug - should still suppress
	setupMocks({ silent: true, verbose: true, debug: true });
	const xLog = require('../x-log.js');
	
	xLog.verbose('Should be suppressed');
	xLog.debug('Should be suppressed');
	xLog.status('Should be suppressed');
	xLog.result('Should be suppressed');
	
	console.error = originalConsoleError;
	process.stdout.write = originalStdoutWrite;
	
	assert.strictEqual(mockStdout.data, '');
	assert.ok(!mockStderr.data.includes('Should be suppressed'));
});