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

test('progress method shows message when progress is enabled (default)', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.progress('Progress message should appear');
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('Progress message should appear'));
});

test('progress method respects setProgressMessageStatus setting', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	// Disable progress messages
	xLog.setProgressMessageStatus(false);
	xLog.progress('Should not appear');
	
	// Re-enable progress messages
	xLog.setProgressMessageStatus(true);
	xLog.progress('Should appear');
	
	console.error = originalConsoleError;
	assert.ok(!mockStderr.data.includes('Should not appear'));
	assert.ok(mockStderr.data.includes('Should appear'));
});

test('progress method is suppressed by silent flag', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ silent: true });
	const xLog = require('../x-log.js');
	
	xLog.progress('Should be suppressed by silent');
	
	console.error = originalConsoleError;
	assert.ok(!mockStderr.data.includes('Should be suppressed'));
});

test('progress method is suppressed by quiet flag', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ quiet: true });
	const xLog = require('../x-log.js');
	
	xLog.progress('Should be suppressed by quiet');
	
	console.error = originalConsoleError;
	assert.ok(!mockStderr.data.includes('Should be suppressed'));
});

test('progress method works with object input', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	const progressObj = { step: 1, total: 5, message: 'Processing...' };
	xLog.progress(progressObj);
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes('step'));
	assert.ok(mockStderr.data.includes('Processing...'));
});

test('progress method can be toggled multiple times', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	// Start enabled (default)
	xLog.progress('Message 1');
	
	// Disable
	xLog.setProgressMessageStatus(false);
	xLog.progress('Message 2 - hidden');
	
	// Re-enable
	xLog.setProgressMessageStatus(true);
	xLog.progress('Message 3');
	
	// Disable again
	xLog.setProgressMessageStatus(false);
	xLog.progress('Message 4 - hidden');
	
	console.error = originalConsoleError;
	
	assert.ok(mockStderr.data.includes('Message 1'));
	assert.ok(!mockStderr.data.includes('Message 2'));
	assert.ok(mockStderr.data.includes('Message 3'));
	assert.ok(!mockStderr.data.includes('Message 4'));
});