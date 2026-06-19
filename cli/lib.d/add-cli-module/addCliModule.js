#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, ''); //this just seems to come in handy a lot

const qt = require('qtools-functional-library'); //also exposes qtLog(); qt.help({printOutput:true, queryString:'.*', sendJson:false});

const os = require('os');
const path = require('path');
const fs = require('fs');

// --------------------------------------------------------------------------------
// FIND PROJECT ROOT
const findProjectRoot = ({ rootFolderName = 'system', closest = true } = {}) =>
	__dirname.replace(
		new RegExp(`^(.*${closest ? '' : '?'}\/${rootFolderName}).*$`),
		'$1',
	);
const applicationBasePath = findProjectRoot(); // call with {closest:false} if there are nested rootFolderName directories and you want the top level one

const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();

// =============================================================================
// MODULE IMPORTS


//START OF moduleFunction() ============================================================
const moduleFunction =
	({ moduleName } = {}) =>
	({ unused }) => {
		const { xLog, getConfig, rawConfig, commandLineParameters } =
			process.global;
		const localConfig = getConfig(moduleName); //moduleName is closure
		
		
		// Check for help flag first
		const globalCommandLineParameters = require('qtools-parse-command-line').getParameters();
		if (globalCommandLineParameters.switches.help || globalCommandLineParameters.switches.h) {
			xLog.status(`
=====================================
ADD CLI MODULE - Command Line Tool Generator
=====================================

Description:
    Creates a new CLI module with comprehensive template and documentation.
    Automatically integrates with system PATH for system-wide availability.

Usage:
    addCliModule 'module-name' 'command-name' 'description'

Parameters:
    module-name    Directory name for the CLI module (e.g., 'data-processor')
    command-name   Executable command name (e.g., 'processData')
    description    Brief description of the CLI tool functionality

Examples:
    addCliModule 'file-processor' 'processFiles' 'Process and transform files'
    addCliModule 'data-migrator' 'migrateData' 'Database migration utility'
    addCliModule 'code-generator' 'generateCode' 'Generate boilerplate code'

What this command creates:
    • Directory: lib.d/module-name/
    • Executable: command-name.js (with comprehensive template)
    • Configuration: package.json with metadata
    • System integration: Automatic PATH symlink creation
    • Documentation: Inline comments explaining all patterns

The generated CLI tool includes:
    • Project root discovery for file operations
    • Command-line parameter parsing and validation
    • Configuration system integration
    • Error handling and user feedback patterns
    • Examples for common CLI operations (files, database, API)
    • Help system implementation
    • System integration patterns

After creation:
    • Tool becomes available system-wide via PATH
    • Follow template comments to implement functionality
    • See cli/CLAUDE.md for development patterns

=====================================
			`);
			return {};
		}

		if (!globalCommandLineParameters.fileList[0] && !globalCommandLineParameters.fileList[1] && !globalCommandLineParameters.fileList[2]){
			xLog.error(`call requires three parameters: addCliModule 'new-module-name' 'commandName' 'module description text'`);
			xLog.error(`Use --help for detailed usage information.`);
			return {};
		}
		
		const [newModuleName, commandName, descriptionText]=globalCommandLineParameters.fileList;

const copyRecursive = (src, dest) =>  {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    entry.isDirectory()
      ? copyRecursive(srcPath, destPath)
      : fs.copyFileSync(srcPath, destPath);
  }
}
const source=path.join(__dirname, './', 'assets', 'CLI_MODULE_TEMPLATE/cli-template');
const destPath=path.join(__dirname, '../', newModuleName);


copyRecursive(source, destPath);
const oldJsPath=path.join(destPath, 'cliClientTemplate.js');
const newJsPath=path.join(destPath, `${commandName.replace(/\.js$/, '')}.js`);

fs.renameSync(oldJsPath, newJsPath);
fs.chmodSync(newJsPath, 0o755);



		const packageJsonString=`
		{
  "name": "${newModuleName}",
  "version": "1.0.0",
  "description": "${descriptionText.replace(/"/g, '\\"')}",
  "main": "${commandName}.js",
  "scripts": {
    "test": "echo \\"Error: no test specified\\" && exit 1"
  },
  "author": "TQ White II",
  "license": "ISC"
}
`

const packagePath=path.join(destPath, 'package.json');

fs.writeFileSync(packagePath, packageJsonString);

xLog.status(`\n=====================================`);
xLog.status(`created: ${commandName} at ${destPath.replace(applicationBasePath, '...')}`);
xLog.status(`Added to PATH directory:`);
require('../../initCli.js')
xLog.status(`=====================================`);

		return {};
	};
//END OF moduleFunction() ============================================================

// prettier-ignore
	{
	process.global = {};
	process.global.xLog = fs.existsSync('./lib/x-log')?require('./lib/x-log'):{ status: console.log, error: console.error, result: console.log };
	process.global.getConfig=typeof(getConfig)!='undefined' ? getConfig : (moduleName => ({[moduleName]:`no configuration data for ${moduleName}`}[moduleName]));
	process.global.commandLineParameters=typeof(commandLineParameters)!='undefined'?commandLineParameters:undefined;;
	process.global.rawConfig={}; //this should only be used for debugging, use getConfig(moduleName)
	}
	module.exports = moduleFunction({ moduleName })({}); //runs it right now
	//module.exports = moduleFunction({config, commandLineParameters, moduleName})();

