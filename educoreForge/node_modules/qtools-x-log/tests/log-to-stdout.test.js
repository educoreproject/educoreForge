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

test('default output goes to stderr (console.error)', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalConsoleLog = console.log;
	
	console.error = (msg) => mockStderr.write(msg);
	console.log = (msg) => mockStdout.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.status('Status message');
	xLog.error('Error message');
	
	console.error = originalConsoleError;
	console.log = originalConsoleLog;
	
	// Messages should go to stderr by default
	assert.ok(mockStderr.data.includes('Status message'));
	assert.ok(mockStderr.data.includes('Error message'));
	assert.strictEqual(mockStdout.data, '');
});

test('logToStdOut switches output to stdout (console.log)', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalConsoleLog = console.log;
	
	console.error = (msg) => mockStderr.write(msg);
	console.log = (msg) => mockStdout.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	// Switch to stdout
	xLog.logToStdOut();
	
	xLog.status('Status after switch');
	xLog.error('Error after switch');
	
	console.error = originalConsoleError;
	console.log = originalConsoleLog;
	
	// Messages should now go to stdout (except result which always goes to stdout)
	assert.ok(mockStdout.data.includes('Status after switch'));
	assert.ok(mockStdout.data.includes('Error after switch'));
	assert.strictEqual(mockStderr.data, '');
});

test('emphatic method respects logToStdOut setting', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalConsoleLog = console.log;
	
	console.error = (msg) => mockStderr.write(msg);
	console.log = (msg) => mockStdout.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.logToStdOut();
	xLog.emphatic('Emphatic message');
	
	console.error = originalConsoleError;
	console.log = originalConsoleLog;
	
	// Emphatic should go to stdout after switch
	assert.ok(mockStdout.data.includes('Emphatic message'));
	assert.strictEqual(mockStderr.data, '');
});

test('verbose and debug methods respect logToStdOut setting', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalConsoleLog = console.log;
	
	console.error = (msg) => mockStderr.write(msg);
	console.log = (msg) => mockStdout.write(msg);
	
	setupMocks({ verbose: true, debug: true });
	const xLog = require('../x-log.js');
	
	// Clear the initialization messages first
	mockStderr.clear();
	
	xLog.logToStdOut();
	xLog.verbose('Verbose message');
	xLog.debug('Debug message');
	
	console.error = originalConsoleError;
	console.log = originalConsoleLog;
	
	// Both should go to stdout after switch
	assert.ok(mockStdout.data.includes('Verbose message'));
	assert.ok(mockStdout.data.includes('Debug message'));
	// stderr should only have initialization messages, not our test messages
	assert.ok(!mockStderr.data.includes('Verbose message'));
	assert.ok(!mockStderr.data.includes('Debug message'));
});

test('result method always uses process.stdout.write regardless of logToStdOut', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalConsoleLog = console.log;
	const originalStdoutWrite = process.stdout.write;
	
	console.error = (msg) => mockStderr.write(msg);
	console.log = (msg) => mockStdout.write(msg);
	process.stdout.write = (msg) => mockStdout.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	// Test before logToStdOut
	xLog.result('Result before switch');
	
	// Switch output and test after
	xLog.logToStdOut();
	xLog.result('Result after switch');
	
	console.error = originalConsoleError;
	console.log = originalConsoleLog;
	process.stdout.write = originalStdoutWrite;
	
	// Result should always go to the mockStdout (via process.stdout.write)
	assert.ok(mockStdout.data.includes('Result before switch'));
	assert.ok(mockStdout.data.includes('Result after switch'));
	assert.strictEqual(mockStderr.data, '');
});

test('progress method respects logToStdOut setting', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalConsoleLog = console.log;
	
	console.error = (msg) => mockStderr.write(msg);
	console.log = (msg) => mockStdout.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.logToStdOut();
	xLog.progress('Progress update');
	
	console.error = originalConsoleError;
	console.log = originalConsoleLog;
	
	// Progress should go to stdout after switch (since it calls status internally)
	assert.ok(mockStdout.data.includes('Progress update'));
	assert.strictEqual(mockStderr.data, '');
});

test('mixed usage - some messages before switch, some after', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalConsoleLog = console.log;
	
	console.error = (msg) => mockStderr.write(msg);
	console.log = (msg) => mockStdout.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	// Before switch - should go to stderr
	xLog.status('Message to stderr');
	xLog.error('Error to stderr');
	
	// Switch to stdout
	xLog.logToStdOut();
	
	// After switch - should go to stdout
	xLog.status('Message to stdout');
	xLog.error('Error to stdout');
	
	console.error = originalConsoleError;
	console.log = originalConsoleLog;
	
	// Verify proper routing
	assert.ok(mockStderr.data.includes('Message to stderr'));
	assert.ok(mockStderr.data.includes('Error to stderr'));
	assert.ok(mockStdout.data.includes('Message to stdout'));
	assert.ok(mockStdout.data.includes('Error to stdout'));
});