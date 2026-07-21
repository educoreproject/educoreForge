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
					...switches
				}
			})
		}
	};
	
	// Clear module cache for x-log to get fresh instance
	delete require.cache[require.resolve('../x-log.js')];
};

test('setProcessFilesDirectory creates directory and sets path', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	// Create a temporary directory path
	const tempDir = path.join(os.tmpdir(), 'xlog-test-' + Date.now());
	
	// Set the process files directory
	xLog.setProcessFilesDirectory(tempDir);
	
	// Verify directory was created
	assert.ok(fs.existsSync(tempDir));
	
	// Verify getter returns the same path
	assert.strictEqual(xLog.getProcessFilesDirectory(), tempDir);
	
	// Verify status message was output
	assert.ok(mockStderr.data.includes(`Process detail files directory set: ${tempDir}`));
	
	// Cleanup
	fs.rmSync(tempDir, { recursive: true, force: true });
	console.error = originalConsoleError;
});

test('saveProcessFile writes string data to file', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks({ verbose: true }); // Enable verbose to see save message
	const xLog = require('../x-log.js');
	
	const tempDir = path.join(os.tmpdir(), 'xlog-test-' + Date.now());
	xLog.setProcessFilesDirectory(tempDir);
	
	const testData = 'This is test file content';
	const fileName = 'test-file.txt';
	
	xLog.saveProcessFile(fileName, testData);
	
	// Verify file was created and contains correct data
	const filePath = path.join(tempDir, fileName);
	assert.ok(fs.existsSync(filePath));
	const fileContent = fs.readFileSync(filePath, 'utf8');
	assert.strictEqual(fileContent, testData);
	
	// Verify save message appeared (because verbose is true)
	assert.ok(mockStderr.data.includes(`process detail log file saved to ${filePath}`));
	
	// Cleanup
	fs.rmSync(tempDir, { recursive: true, force: true });
	console.error = originalConsoleError;
});

test('saveProcessFile with saveAsJson option serializes object', (t) => {
	setupMocks();
	const xLog = require('../x-log.js');
	
	const tempDir = path.join(os.tmpdir(), 'xlog-test-' + Date.now());
	xLog.setProcessFilesDirectory(tempDir);
	
	const testData = { key: 'value', nested: { prop: 123 } };
	const fileName = 'test-object.json';
	
	xLog.saveProcessFile(fileName, testData, { saveAsJson: true });
	
	// Verify file was created and contains JSON
	const filePath = path.join(tempDir, fileName);
	assert.ok(fs.existsSync(filePath));
	const fileContent = fs.readFileSync(filePath, 'utf8');
	const parsedData = JSON.parse(fileContent);
	assert.deepStrictEqual(parsedData, testData);
	
	// Cleanup
	fs.rmSync(tempDir, { recursive: true, force: true });
});

test('saveProcessFile with append option appends to existing file', (t) => {
	setupMocks();
	const xLog = require('../x-log.js');
	
	const tempDir = path.join(os.tmpdir(), 'xlog-test-' + Date.now());
	xLog.setProcessFilesDirectory(tempDir);
	
	const fileName = 'append-test.txt';
	const firstContent = 'First line\n';
	const secondContent = 'Second line\n';
	
	// Write first content
	xLog.saveProcessFile(fileName, firstContent);
	
	// Append second content
	xLog.saveProcessFile(fileName, secondContent, { append: true });
	
	// Verify file contains both contents
	const filePath = path.join(tempDir, fileName);
	const fileContent = fs.readFileSync(filePath, 'utf8');
	assert.strictEqual(fileContent, firstContent + secondContent);
	
	// Cleanup
	fs.rmSync(tempDir, { recursive: true, force: true });
});

test('getProcessFilesDirectory returns empty string initially', (t) => {
	setupMocks();
	const xLog = require('../x-log.js');
	
	assert.strictEqual(xLog.getProcessFilesDirectory(), '');
});

test('saveProcessFile creates nested directory structure', (t) => {
	setupMocks();
	const xLog = require('../x-log.js');
	
	const tempDir = path.join(os.tmpdir(), 'xlog-test-' + Date.now(), 'nested', 'deep');
	xLog.setProcessFilesDirectory(tempDir);
	
	const testData = 'Test content';
	const fileName = 'nested-file.txt';
	
	xLog.saveProcessFile(fileName, testData);
	
	// Verify nested directory and file were created
	const filePath = path.join(tempDir, fileName);
	assert.ok(fs.existsSync(filePath));
	const fileContent = fs.readFileSync(filePath, 'utf8');
	assert.strictEqual(fileContent, testData);
	
	// Cleanup
	fs.rmSync(path.join(os.tmpdir(), 'xlog-test-' + Date.now().toString().slice(0, -3) + '000'), { recursive: true, force: true });
});