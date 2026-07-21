#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

test('complete logging workflow with file operations', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalStdoutWrite = process.stdout.write;
	
	console.error = (msg) => mockStderr.write(msg);
	process.stdout.write = (msg) => mockStdout.write(msg);
	
	setupMocks({ verbose: true, debug: true });
	const xLog = require('../x-log.js');
	
	// Set up file operations
	const tempDir = path.join(os.tmpdir(), 'xlog-integration-test-' + Date.now());
	xLog.setProcessFilesDirectory(tempDir);
	
	// Test various logging operations
	xLog.status('Starting integration test');
	xLog.result('Test result data');
	xLog.verbose('Verbose information');
	xLog.debug('Debug information');
	xLog.emphatic('Important message');
	
	// Test file operations
	const logData = { timestamp: new Date().toISOString(), test: 'integration' };
	xLog.saveProcessFile('test-log.json', logData, { saveAsJson: true });
	
	// Test progress messages
	xLog.progress('Progress step 1');
	xLog.setProgressMessageStatus(false);
	xLog.progress('Hidden progress');
	xLog.setProgressMessageStatus(true);
	xLog.progress('Progress step 2');
	
	// Verify all operations worked
	console.error = originalConsoleError;
	process.stdout.write = originalStdoutWrite;
	
	// Check console output
	assert.ok(mockStderr.data.includes('Starting integration test'));
	assert.ok(mockStdout.data.includes('Test result data'));
	assert.ok(mockStderr.data.includes('Verbose information'));
	assert.ok(mockStderr.data.includes('Debug information'));
	assert.ok(mockStderr.data.includes('Important message'));
	assert.ok(mockStderr.data.includes('Progress step 1'));
	assert.ok(mockStderr.data.includes('Progress step 2'));
	assert.ok(!mockStderr.data.includes('Hidden progress'));
	
	// Check file operations
	const logFile = path.join(tempDir, 'test-log.json');
	assert.ok(fs.existsSync(logFile));
	const savedData = JSON.parse(fs.readFileSync(logFile, 'utf8'));
	assert.strictEqual(savedData.test, 'integration');
	
	// Cleanup
	fs.rmSync(tempDir, { recursive: true, force: true });
});

test('module exports all expected methods', (t) => {
	setupMocks();
	const xLog = require('../x-log.js');
	
	// Check all expected methods are present
	const expectedMethods = [
		'annotation',
		'error',
		'result', 
		'status',
		'debug',
		'emphatic',
		'verbose',
		'setProcessFilesDirectory',
		'getProcessFilesDirectory',
		'saveProcessFile',
		'progress',
		'setProgressMessageStatus',
		'color',
		'logToStdOut'
	];
	
	expectedMethods.forEach(method => {
		assert.ok(xLog.hasOwnProperty(method), `Missing method: ${method}`);
	});
	
	// Check that methods are functions (except annotation and color)
	const functionMethods = expectedMethods.filter(m => !['annotation', 'color'].includes(m));
	functionMethods.forEach(method => {
		assert.ok(typeof xLog[method] === 'function', `${method} should be a function`);
	});
	
	// Check annotation is a string and color is a function
	assert.ok(typeof xLog.annotation === 'string');
	assert.ok(typeof xLog.color === 'function');
	assert.ok(typeof xLog.color.red === 'function');
});

test('real-world usage scenario with mixed operations', (t) => {
	const mockStderr = new MockWritableStream();
	const mockStdout = new MockWritableStream();
	const originalConsoleError = console.error;
	const originalStdoutWrite = process.stdout.write;
	
	console.error = (msg) => mockStderr.write(msg);
	process.stdout.write = (msg) => mockStdout.write(msg);
	
	setupMocks({ verbose: true });
	const xLog = require('../x-log.js');
	
	// Simulate real application workflow
	const tempDir = path.join(os.tmpdir(), 'xlog-workflow-test-' + Date.now());
	
	try {
		// Initialize logging
		xLog.setProcessFilesDirectory(tempDir);
		xLog.status('Application started');
		
		// Process some data
		const data = { users: 100, processed: 0 };
		xLog.verbose('Initial data state', data);
		
		// Simulate processing steps with progress
		for (let i = 1; i <= 3; i++) {
			data.processed += 33;
			xLog.progress(`Processing step ${i}/3 - ${data.processed} users processed`);
			
			// Save intermediate results
			xLog.saveProcessFile(`step-${i}-results.json`, data, { saveAsJson: true });
		}
		
		// Handle an error condition
		if (data.processed < 100) {
			xLog.error('Processing incomplete - only processed ' + data.processed + ' users');
		}
		
		// Final results
		xLog.emphatic('Processing completed successfully');
		xLog.result(JSON.stringify({ status: 'complete', totalProcessed: data.processed }));
		
		// Verify workflow results
		console.error = originalConsoleError;
		process.stdout.write = originalStdoutWrite;
		
		// Check that all steps were logged
		assert.ok(mockStderr.data.includes('Application started'));
		assert.ok(mockStderr.data.includes('Processing step 1/3'));
		assert.ok(mockStderr.data.includes('Processing step 2/3'));
		assert.ok(mockStderr.data.includes('Processing step 3/3'));
		assert.ok(mockStderr.data.includes('Processing completed successfully'));
		assert.ok(mockStdout.data.includes('complete'));
		
		// Check that files were created
		for (let i = 1; i <= 3; i++) {
			const stepFile = path.join(tempDir, `step-${i}-results.json`);
			assert.ok(fs.existsSync(stepFile));
		}
		
	} finally {
		// Cleanup
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	}
});