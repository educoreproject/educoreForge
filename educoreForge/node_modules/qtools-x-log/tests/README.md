# qtools-x-log Tests

Comprehensive test suite for the qtools-x-log logging module using Node.js built-in test runner.

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
node --test tests/logging-methods.test.js
node --test tests/command-line-flags.test.js
node --test tests/file-operations.test.js
node --test tests/progress-messages.test.js
node --test tests/output-formatting.test.js
node --test tests/nocolor-flag.test.js
node --test tests/log-to-stdout.test.js
node --test tests/enhanced-object-formatting.test.js
node --test tests/integration.test.js
```

## Test Coverage

### logging-methods.test.js
- Tests all logging methods (error, result, status, emphatic, verbose, debug)
- Verifies output streams (stderr vs stdout)
- Tests object stringification
- Validates annotation property

### command-line-flags.test.js
- Tests silent flag behavior (suppresses most output)
- Tests quiet flag behavior (suppresses status/emphatic)
- Tests verbose flag behavior (enables verbose output)
- Tests debug flag behavior (enables debug output with formatting)
- Tests flag combinations and precedence

### file-operations.test.js
- Tests setProcessFilesDirectory() and getProcessFilesDirectory()
- Tests saveProcessFile() with string and JSON data
- Tests file append functionality
- Tests nested directory creation

### progress-messages.test.js
- Tests progress() method output
- Tests setProgressMessageStatus() toggle functionality
- Tests progress message suppression by flags

### output-formatting.test.js
- Tests object vs string input handling
- Tests JSON stringification
- Tests colored output functionality
- Tests edge cases (empty strings, complex objects)

### nocolor-flag.test.js
- Tests noColor flag functionality with emphatic method
- Tests asterisk output vs colored output
- Tests noColor flag interaction with object formatting

### log-to-stdout.test.js
- Tests logToStdOut() method functionality
- Tests default stderr routing vs stdout routing after switch
- Tests all logging methods respect the output stream setting
- Tests result() method always uses stdout regardless of setting

### enhanced-object-formatting.test.js
- Tests enhanced outputFunction with util.inspect
- Tests object depth handling and formatting options
- Tests special JavaScript types (Date, RegExp, etc.)
- Tests array handling and complex nested structures

### integration.test.js
- Tests complete workflows combining multiple features
- Tests real-world usage scenarios
- Validates all 15 exported methods are present and functional

## Test Architecture

- Uses Node.js built-in test runner (no external dependencies)
- Mocks command-line parameters via require.cache manipulation
- Captures console output using custom Writable streams
- Uses temporary directories for file operation testing
- Cleans up resources automatically after each test

## Key Testing Strategies

- **Output Capture**: Mocks console.error and process.stdout.write to verify correct output
- **Command-Line Mocking**: Replaces qtools-parse-command-line module to control flags
- **File System Testing**: Uses OS temp directories with automatic cleanup
- **Stream Mocking**: Custom MockWritableStream class to capture output
- **Module Isolation**: Clears require cache to get fresh module instances per test