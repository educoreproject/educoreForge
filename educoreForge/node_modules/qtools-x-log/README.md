## **qtools-x-log**

Application-specific logging done the way TQ wants it. Respects command-line flags, outputs to appropriate streams, and handles file logging with style.

The module reads command-line parameters directly and provides multiple output methods that respect flags like `-silent`, `-quiet`, `-verbose`, and `-debug`. Everything routes through the right streams with proper colorization.

**EG,**

```javascript
const xLog = require('qtools-x-log');

xLog.status('Application starting up');
xLog.result(JSON.stringify(data)); // goes to stdout
xLog.error('Something went wrong'); // goes to stderr in red
xLog.emphatic('IMPORTANT MESSAGE'); // highlighted background
xLog.progress('Program controlled information'); //toggled by xLog.setProgressMessageStatus(false);
```

### **Command-Line Flag Awareness:**

The module automatically respects these flags from `qtools-parse-command-line`:

- **`-silent`**: Suppresses all output except errors
- **`-quiet`**: Suppresses status and emphatic messages, allows results
- **`-verbose`**: Enables verbose output when verbose() is called
- **`-debug`**: Enables debug output with special formatting
- **`-noColor`**: Disables color output, uses plain text alternatives

### **Basic Logging Methods:**

- **error**: Red-colored output to stderr. Uses JSON.stringify for objects.
- **result**: Plain output to stdout (process.stdout.write). Never suppressed by silent flag.
- **status**: General status messages to stderr. Suppressed by silent/quiet flags.
- **emphatic**: Highlighted messages (yellow on black background, or *** asterisks *** with noColor).
- **verbose**: Verbose messages only shown when `-verbose` flag is set.
- **debug**: Debug messages with special formatting when `-debug` flag is set. Supports label option.

### **Complete API Reference:**

```javascript
const xLog = require('qtools-x-log');

// Core logging methods
xLog.error(message, options)      // Red output to stderr, JSON.stringify for objects
xLog.result(message, options)     // Plain output to stdout, never suppressed
xLog.status(message, options)     // Status to stderr, suppressed by -silent/-quiet
xLog.emphatic(message, options)   // Highlighted (yellow on black or *** text ***)
xLog.verbose(message, options)    // Only shown with -verbose flag
xLog.debug(message, options)      // Only shown with -debug flag, supports options.label
xLog.progress(message, options)   // Toggleable progress messages

// File operations
xLog.setProcessFilesDirectory(dirPath, options)        // Create and set process files directory {quiet}
xLog.getProcessFilesDirectory()               // Get current process files directory
xLog.saveProcessFile(fileName, data, options) // Save to file, options: {saveAsJson, append}

// Control and utilities
xLog.setProgressMessageStatus(boolean)  // Toggle progress messages (default: true)
xLog.logToStdOut()                     // Switch all output to stdout (breaks pipes)
xLog.logToStdErr()                     // Switch all output to stderr (default, facilitates pipes)
xLog.annotation()                      // Get module filename and info string
xLog.color()                          // Direct access to chalk instance
```

### **Advanced Features:**

- **progress**: Status messages that can be toggled on/off independently of other flags.
- **setProgressMessageStatus**: Toggle progress messages without affecting other output.
- **logToStdOut**: Switch all output from stderr to stdout (except result, which always uses stdout).

### **File Operations:**

- **setProcessFilesDirectory(dirPath)**: Creates and sets directory for process detail files.
- **getProcessFilesDirectory()**: Returns current process files directory.
- **saveProcessFile(fileName, data, options)**: Saves data to files. Each call normally creates a new file, overwriting existing ones. Use `options.append` to append to existing files. Use `options.saveAsJson` to JSON.stringify the data first.

### **Object Handling & Formatting:**

Different methods handle objects with different strategies optimized for their use case:

```javascript
const complexObj = { user: { name: 'John', prefs: { theme: 'dark' } } };

// Error messages: JSON.stringify for clean serialization
xLog.error('Failed to process:', complexObj);
// Output: {"user":{"name":"John","prefs":{"theme":"dark"}}}

// Status/verbose/debug: util.inspect for detailed visualization
xLog.status('Current state:', complexObj);
// Output: { user: { name: 'John', prefs: { theme: 'dark' } } }

// Debug with custom label for better organization
xLog.debug('Complex object state:', complexObj, { label: 'User State Debug' });
// Output includes formatted borders and label
```

**Formatting options** are handled internally with sensible defaults:

- **depth**: 4 levels deep
- **colors**: Respects -noColor flag  
- **compact**: false (readable multi-line format)
- **maxArrayLength**: 100 elements

### **Stream Routing:**

**Critical for Unix pipe compatibility.** Default stderr routing allows your app to participate in Unix pipes where `stdout` carries data and `stderr` carries status messages.

- **Default**: Most output goes to stderr (console.error) - preserves Unix pipe behavior
- **Result**: Always uses stdout (process.stdout.write) - the "data" stream
- **After logToStdOut()**: All output switches to stdout (console.log) - **breaks pipe compatibility**
- **File output**: Separate from console streams, controlled independently

**EG,** `myApp | grep "pattern"` works correctly because status messages don't contaminate the data stream. After `logToStdOut()`, status messages would interfere with piped output. To monitor status messages: `myApp 2>&1 | grep "Processing"`.

### **Utilities:**

- **annotation**: String containing module filename and info message
- **color**: Direct access to chalk color instance for custom formatting

### **Version Notes:**

**1.0.16** Added quiet option.suppressLogNotification to saveProcessFile() to suppress file path notification

**1.0.15** Added quiet option to setProcessFilesDirectory() to suppress directory notification

**1.0.14** Added xLog.warn() (same as status) and reduced decorations on xLog.debug()

**1.0.12** Made it so that appending to existing files does not log the filepath, only on create

**1.0.11** Added default (os.tmpdir()) for processFile() directory

**1.0.8** Added logToStdErr() to compliment logToStdOut(); Updated README with complete API reference and integration examples

**1.0.7** Enhanced object formatting with `util.inspect()` integration, `noColor` flag support, and `logToStdOut()` method. Full compatibility with qtools command-line patterns.

No crashes if directories don't exist - `setProcessFilesDirectory()` creates them recursively. JSON serialization handles most JavaScript types gracefully.

### **Examples:**

**Basic usage with command-line flags:**

```javascript
const xLog = require('qtools-x-log');

// Run with: node myApp.js -verbose -debug
xLog.status('Processing started');        // shown always
xLog.verbose('Detailed processing info'); // only with -verbose
xLog.debug('Debug information');          // only with -debug
xLog.result('{"processed": 100}');        // always to stdout
xLog.error('Something failed');           // always to stderr in red
```

**Unix pipe compatibility:**

```bash
# Status messages go to stderr, results to stdout - jq only sees stdout
node myApp.js | jq .processed           # works perfectly
node myApp.js | jq .                    # processes JSON results, ignores stderr status
```

**File logging with process details:**

```javascript
const xLog = require('qtools-x-log');

xLog.setProcessFilesDirectory('./logs');

// Save different data types
xLog.saveProcessFile('config.json', configData, { saveAsJson: true });
xLog.saveProcessFile('raw-data.txt', rawText);

// Append to existing log file
xLog.saveProcessFile('activity.log', 'Step completed\n', { append: true });
xLog.saveProcessFile('activity.log', 'Next step started\n', { append: true });
```

**Progress tracking:**

```javascript
const xLog = require('qtools-x-log');

// Normal progress messages
xLog.progress('Processing item 1/100');

// Temporarily disable progress spam
xLog.setProgressMessageStatus(false);
// ... lots of operations ...
xLog.setProgressMessageStatus(true);

xLog.progress('Processing completed');
```

**Stream routing for different use cases:**

```javascript
const xLog = require('qtools-x-log');

// Default: status to stderr, results to stdout
xLog.status('Starting process');
xLog.result('data line 1');

// Switch everything to stdout (breaks pipe compatibility)
xLog.logToStdOut();
xLog.status('Now goes to stdout');
xLog.result('still goes to stdout');
```

**Controlling colors in log files**

```javascript
// Check for -noColor flag or force colors
const colorInstance = xLog.color();
console.log(colorInstance.red('This should be red'));
```

### **Troubleshooting:**

**Q: My progress messages aren't showing**

```javascript
// Check if progress is enabled (default: true)
xLog.setProgressMessageStatus(true);
xLog.progress('This should now appear');
```

**Q: Output is going to the wrong stream**

```javascript
xLog.logToStdErr(); //sends log messages to stderr (allows piping results)
Xlog.logToStdOut(); //sends log messages to stdout (interferese with piping results)
```

### **Other Cool Qtools**

[qtools-asynchronous-pipe-plus](https://www.npmjs.com/package/qtools-asynchronous-pipe-plus)
[qtools-config-file-processor](https://www.npmjs.com/package/qtools-config-file-processor)
[qtools-format-columns](https://www.npmjs.com/package/qtools-format-columns)
[qtools-functional-library](https://www.npmjs.com/package/qtools-functional-library)
[qtools-object-flattener](https://www.npmjs.com/package/qtools-object-flattener)
[qtools-parse-command-line](https://www.npmjs.com/package/qtools-parse-command-line)
[qtools-secure-container](https://www.npmjs.com/package/qtools-secure-container)
[qtools-template-replace-for-files](https://www.npmjs.com/package/qtools-template-replace-for-files)
[qtools-transform-text](https://www.npmjs.com/package/qtools-transform-text)