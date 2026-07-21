#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Writable } = require('stream');

// Mock command line parameters before requiring the module
const originalProcessGlobal = process.global;

// Create a writable stream to capture output
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

test('error method outputs red colored message to stderr', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.error('Test error message');
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('Test error message'));
});

test('result method outputs to stdout', (t) => {
	const mockStdout = new MockWritableStream();
	const originalStdoutWrite = process.stdout.write;
	process.stdout.write = (msg) => mockStdout.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.result('Test result message');
	
	process.stdout.write = originalStdoutWrite;
	assert.ok(mockStdout.data.includes('Test result message'));
});

test('status method outputs message when not silent or quiet', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.status('Test status message');
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('Test status message'));
});

test('emphatic method outputs highlighted message when not silent or quiet', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.emphatic('Test emphatic message');
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('Test emphatic message'));
});

test('verbose method only outputs when verbose flag is set', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	// First test without verbose flag
	setupMocks();
	let xLog = require('../x-log.js');
	xLog.verbose('Should not appear');
	assert.strictEqual(mockStderr.data, '');
	
	mockStderr.clear();
	
	// Then test with verbose flag
	setupMocks({ verbose: true });
	xLog = require('../x-log.js');
	xLog.verbose('Should appear');
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('Should appear'));
});

test('debug method only outputs when debug flag is set', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	// First test without debug flag
	setupMocks();
	let xLog = require('../x-log.js');
	xLog.debug('Should not appear');
	assert.strictEqual(mockStderr.data, '');
	
	mockStderr.clear();
	
	// Then test with debug flag
	setupMocks({ debug: true });
	xLog = require('../x-log.js');
	xLog.debug('Should appear');
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('Should appear'));
});

test('methods handle object input by stringifying', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	const testObj = { key: 'value', nested: { prop: 123 } };
	xLog.error(testObj);
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('key'));
	assert.ok(mockStderr.data.includes('value'));
});

test('annotation property contains filename information', (t) => {
	setupMocks();
	const xLog = require('../x-log.js');
	
	assert.ok(xLog.annotation.includes('x-log.js'));
	assert.ok(xLog.annotation.includes('HELLO FROM'));
});