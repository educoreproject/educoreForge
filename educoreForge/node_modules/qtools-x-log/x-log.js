#!/usr/bin/env node
'use strict';

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();

const qt = require('qtools-functional-library');
//console.dir(qt.help());
const fs = require('fs');
const path = require('path');

const chalk = require('chalk');
const util = require('util');

//START OF moduleFunction() ============================================================

const moduleFunction = function () {
	const annotation = `HELLO FROM: ${__filename}. Note: this function accesses the command line directly.`;

	const { silent, quiet, verbose, debug, noColor } =
		commandLineParameters.switches; //flags used here may need to be added to assemble-configuration-show-help-maybe-exit.js

	let defaultOutputFunction = console.error;
	

	const logToStdOut = () => {
		defaultOutputFunction = console.log;
	};
	

	const logToStdErr = () => {
		defaultOutputFunction = console.error;
	};
	

	const outputFunction = (message, options = {}) => {
		const finalOptions = {
			...{
				depth: 4,
			},
			...options,
			...{ colors: noColor ? false : true },
		};

		if (typeof message == 'object') {
			message = util.inspect(message, finalOptions);
		}

		defaultOutputFunction(message);
	};
	

	debug && outputFunction(`found -debug flag`);
	verbose && outputFunction(`found -verbose flag`);

	const color =
		'writing to file' === true ? new chalk.Instance({ level: 0 }) : chalk; //wanted to figure out how I could write clean messages to files if I ever want to

	const stringify = (message, options = {}) => {
		if (typeof message == 'object') {
			const defaults = {
				showHidden: false, // if true, the object's non-enumerable and symbol properties will be shown
				depth: 4, // the recursion depth. Use null for unlimited depth
				colors: true, // if true, the output will be styled with ANSI color codes
				customInspect: true, // if false, custom inspect() functions defined on the objects being inspected won't be called
				showProxy: false, // if true, then objects created with `Proxy` are shown as they are
				maxArrayLength: 100, // specifies the maximum number of Array and TypedArray elements to include. Use null for unlimited
				breakLength: 60, // the length at which object properties will break onto new lines. Set to Infinity to format the object into a single line
				compact: false, // if false, every property of an object is put onto a new line
				sorted: false, // if true, object properties are sorted, can also be a compare function
				getters: false, // if true, getters are going to be inspected as well, can be 'get' or 'set' to only inspect one kind
			};
			const parms = { ...defaults, ...options };

			return JSON.stringify(message, '', '\t');
		}

		return message;
	};

	const error = (message, options = {}) => {
		message = stringify(message, options);
		outputFunction(color.red(message));
	};
	const result = (message, options = {}) => {
		message = stringify(message, options);
		if (silent) {
			return;
		}
		process.stdout.write(message);
	};

	const status = (message, options = {}) => {
		message = stringify(message, options);
		if (silent || quiet) {
			return;
		}
		outputFunction(message);
	};
	
	const warn=status;

	const emphatic = (message, options = {}) => {
		if (silent || quiet) {
			return;
		}
		if (!noColor) {
			outputFunction(color.bgBlack.yellow(message)), options;
		} else {
			outputFunction(`*** ${message} ***`), options;
		}
	};

	const verboseFunction = (message, options = {}) => {
		message = stringify(message, options);
		if (!silent && verbose) {
			outputFunction(message);
		}
	};

	const debugFunction = (message, options = {}) => {
		message = stringify(message, options);
		if (!silent && debug) {
			if (options.label) {
				outputFunction(
					`${options.label}: ${message}`,
				);
			}
			outputFunction(
				message,
			);
		}
	};
	

	let processFilesDirectory = path.join(
		'/tmp',
		`xLog_${Math.floor(Date.now() / 1000)
			.toString()
			.slice(-4)}`,
	);

	let setProcessFilesDirectory = (dirPath, options={}) => {
		fs.mkdirSync(dirPath, { recursive: true });
		processFilesDirectory = dirPath;
		!options.quiet && status(`Process detail files directory set: ${dirPath}`);
	};
	

	const getProcessFilesDirectory = () => processFilesDirectory;
	

	const saveProcessFile = (fileName, inData, options = {}) => {
		const fileData = options.saveAsJson
			? JSON.stringify(inData, '', '\t')
			: inData;

		const filePath = path.join(processFilesDirectory, fileName);
		const dirPath = path.dirname(filePath);
		fs.mkdirSync(dirPath, { recursive: true });

		const fileExists = fs.existsSync(filePath);

		if (options.suppressLogNotification || options.append || fileExists) {
			fs.appendFileSync(filePath, fileData);
		} else {
			fs.writeFileSync(filePath, fileData);
			status(`process detail log file saved to ${filePath}`);
		}
	};

	let showProgress = true;
	const progressFunction = (message, options = {}) => {
		if (showProgress) {
			status(message, options);
		}
	};
	

	const setProgressMessageStatus = (setProgresMessageStatus) => {
		showProgress = setProgresMessageStatus;
	};

	return {
		annotation,
		error,
		result,
		status,
		warn,
		debug: debugFunction,
		emphatic,
		verbose: verboseFunction,
		setProcessFilesDirectory,
		getProcessFilesDirectory,
		saveProcessFile,
		progress: progressFunction,
		setProgressMessageStatus,
		color,
		logToStdOut,
		logToStdErr,
	};
};

//END OF moduleFunction() ============================================================

module.exports = moduleFunction();

/*

https://www.npmjs.com/package/chalk

eg,

const error = chalk.bold.red;

Styles

Modifiers
	reset - Resets the current color chain.
	bold - Make text bold.
	dim - Emitting only a small amount of light.
	italic - Make text italic. (Not widely supported)
	underline - Make text underline. (Not widely supported)
	inverse- Inverse background and foreground colors.
	hidden - Prints the text, but makes it invisible.
	strikethrough - Puts a horizontal line through the center of the text. (Not widely supported)
	visible- Prints the text only when Chalk has a color level > 0. Can be useful for things that are purely cosmetic.
Colors
	black
	red
	green
	yellow
	blue
	magenta
	cyan
	white
	blackBright (alias: gray, grey)
	redBright
	greenBright
	yellowBright
	blueBright
	magentaBright
	cyanBright
	whiteBright
Background colors
	bgBlack
	bgRed
	bgGreen
	bgYellow
	bgBlue
	bgMagenta
	bgCyan
	bgWhite
	bgBlackBright (alias: bgGray, bgGrey)
	bgRedBright
	bgGreenBright
	bgYellowBright
	bgBlueBright
	bgMagentaBright
	bgCyanBright
	bgWhiteBright

*/
