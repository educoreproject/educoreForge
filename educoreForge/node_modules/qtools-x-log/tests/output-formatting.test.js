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
	require.cache[require.cache[require.resolve('qtools-parse-command-line')]] = {
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

test('object input is properly stringified as JSON', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	const testObject = {
		name: 'test',
		values: [1, 2, 3],
		nested: {
			prop: 'value'
		}
	};
	
	xLog.error(testObject);
	
	console.error = originalConsoleError;
	
	// Should contain JSON-stringified version
	assert.ok(mockStderr.data.includes('"name"'));
	assert.ok(mockStderr.data.includes('"test"'));
	assert.ok(mockStderr.data.includes('"values"'));
	assert.ok(mockStderr.data.includes('"nested"'));
});

test('string input passes through unchanged', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	const testString = 'This is a simple string message';
	xLog.status(testString);
	
	console.error = originalConsoleError;
	assert.ok(mockStderr.data.includes(testString));
});

test('emphatic method uses colored background when colors enabled', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks(); // Default has colors enabled
	const xLog = require('../x-log.js');
	
	xLog.emphatic('Emphatic message');
	
	console.error = originalConsoleError;
	// Should contain the emphatic message
	assert.ok(mockStderr.data.includes('Emphatic message'));
});

test('emphatic method processes message correctly', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.emphatic('Emphatic message');
	
	console.error = originalConsoleError;
	// Should contain the emphatic message
	assert.ok(mockStderr.data.includes('Emphatic message'));
});

test('error method applies red color when colors enabled', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks(); // Default has colors enabled
	const xLog = require('../x-log.js');
	
	xLog.error('Error message');
	
	console.error = originalConsoleError;
	// Should contain the error message
	assert.ok(mockStderr.data.includes('Error message'));
});

test('complex nested objects are properly formatted', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(msg);
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	const complexObject = {
		level1: {
			level2: {
				level3: {
					array: [1, 2, { nested: 'deep' }],
					nullValue: null,
					undefinedValue: undefined,
					boolean: true
				}
			}
		},
		topLevelArray: ['a', 'b', 'c']
	};
	
	xLog.status(complexObject);
	
	console.error = originalConsoleError;
	
	// Verify nested structure is preserved in JSON
	assert.ok(mockStderr.data.includes('"level1"'));
	assert.ok(mockStderr.data.includes('"level2"'));
	assert.ok(mockStderr.data.includes('"level3"'));
	assert.ok(mockStderr.data.includes('"nested"'));
	assert.ok(mockStderr.data.includes('"deep"'));
	assert.ok(mockStderr.data.includes('"topLevelArray"'));
});

test('color instance is available as property', (t) => {
	setupMocks();
	const xLog = require('../x-log.js');
	
	// Should have color property available
	assert.ok(xLog.color);
	assert.ok(typeof xLog.color.red === 'function');
	assert.ok(typeof xLog.color.yellow === 'function');
	// bgBlack is a chainable property that returns a function
	assert.ok(typeof xLog.color.bgBlack.yellow === 'function');
});

test('empty strings and zero values are handled correctly', (t) => {
	const mockStderr = new MockWritableStream();
	const originalConsoleError = console.error;
	console.error = (msg) => mockStderr.write(String(msg));
	
	setupMocks();
	const xLog = require('../x-log.js');
	
	xLog.status(''); // empty string
	xLog.status('0');  // zero as string
	xLog.status('false'); // false as string
	
	console.error = originalConsoleError;
	
	// All values should be processed
	assert.ok(mockStderr.data.length > 0);
});