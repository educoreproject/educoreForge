#!/usr/bin/env node
'use strict';

// Suppress punycode deprecation warning
// process.noDeprecation = true;

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, ''); //this just seems to come in handy a lot

// const qt = require('qtools-functional-library'); //also exposes qtLog(); qt.help({printOutput:true, queryString:'.*', sendJson:false});

const os = require('os');
const path = require('path');
const fs = require('fs');
const commandLineParser = require('qtools-parse-command-line');
const commandLineParameters = commandLineParser.getParameters();

//
// 
// const configFileProcessor = require('qtools-config-file-processor');
//
// const path=require('path');
// const fs=require('fs');
// const os=require('os');
//
// --------------------------------------------------------------------------------
// FIND PROJECT ROOT
// const findProjectRoot=({rootFolderName='system', closest=true}={})=>__dirname.replace(new RegExp(`^(.*${closest?'':'?'}\/${rootFolderName}).*$`), "$1");
// const projectRoot=findProjectRoot(); // call with {closest:false} if there are nested rootFolderName directories and you want the top level one
//--------------------------------------------------------------
// FIGURE OUT CONFIG
// const configName= os.hostname() == 'qMax.local' ? 'instanceSpecific/qbook' : '' ; //when deployed, usually the config is in the configs/ dir
// const configDirPath = `${projectRoot}/configs/${configName}/`;
// const config = configFileProcessor.getConfig('systemParameters.ini', configDirPath)
//
//
// const commandLineParameters = commandLineParser.getParameters();
//
//
// console.dir({['config']:config}, { showHidden: false, depth: 4, colors: true });
// console.dir({['commandLineParameters']:commandLineParameters}, { showHidden: false, depth: 4, colors: true });

//START OF moduleFunction() ============================================================
const moduleFunction =
	({ moduleName } = {}) =>
	({ unused }) => {
		const { xLog, getConfig, rawConfig, commandLineParameters } = process.global;
		const localConfig = getConfig(moduleName); //moduleName is closure

		// =====================================================================================

		const addExecutables = (fullPath, cliExecutablePaths) => {
			try {
				const stats = fs.statSync(fullPath);
				if (!stats.isDirectory()) {
					return;
				}

				const files = fs.readdirSync(fullPath);

				files.forEach((file) => {
					const filePath = path.join(fullPath, file);
					const fileStats = fs.statSync(filePath);

					if (fileStats.isDirectory() || file.endsWith('.js')) {
						return;
					}

					try {
						const fileContent = fs.readFileSync(filePath, 'utf8');
						const firstLine = fileContent.split('\n')[0];

						if (firstLine.startsWith('#!')) {
							const cliName = path.basename(file);
							const executablePath = filePath;
							cliExecutablePaths.push({ cliName, executablePath });
						}
					} catch (readError) {
						xLog.status('Error reading directory (innerloop):', readError);
					}
				});
			} catch (error) {
				xLog.status('Error reading directory (addExecutables):', error);
			}
		};

		const listFilesSync = (directory) => {
			const cliExecutablePaths = [];
			try {
				const files = fs.readdirSync(directory);
				files.forEach((file) => {
					const fullPath = path.join(libraryPath, file);
					const stats = fs.statSync(fullPath);
					let cliName;
					let executablePath;
					let looksGood = false;

					if (stats.isDirectory()) {
						const packageJsonPath = path.join(fullPath, 'package.json');

						if (fs.existsSync(packageJsonPath)) {
							try {
								const packageJson = JSON.parse(
									fs.readFileSync(packageJsonPath, 'utf8'),
								);
								const indexFile = packageJson.main || 'index.js';
								cliName = packageJson.main
									? packageJson.main.replace(/\.js$/, '')
									: path.basename(fullPath);
								executablePath = path.join(fullPath, indexFile);
								if (fs.existsSync(executablePath)) {
									cliExecutablePaths.push({ cliName, executablePath });
								}
							} catch (error) {
								xLog.status(`something wrong with ${packageJsonPath}`);
							}
						} else {
							addExecutables(fullPath, cliExecutablePaths);
						}
					} else {
						try {
							const fileContent = fs.readFileSync(fullPath, 'utf8');
							const firstLine = fileContent.split('\n')[0];

							if (firstLine.startsWith('#!')) {
								cliName = path.basename(fullPath);
								executablePath = fullPath;
								cliExecutablePaths.push({ cliName, executablePath });
							}
						} catch (readError) {}
					}
				});
			} catch (error) {
				xLog.status('Error reading directory:', error);
			}

			return cliExecutablePaths;
		};

		// --------------------------------------------

		const getPersistentSymlinkDir = () => {
			const homeDir = os.homedir();
			const platform = os.platform();

			if (platform === 'win32') {
				return path.join(
					process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'),
					'cli-symlinks',
				);
			} else if (platform === 'darwin') {
				return path.join(homeDir, 'bin');
			} else {
				return path.join(homeDir, '.local', 'bin');
			}
		};

		// --------------------------------------------

		function createSymlinks(cliData, projectName) {
			const symlinkDir = path.join(getPersistentSymlinkDir(), projectName);
			const uninstallMode = commandLineParameters.switches.removeSymLinks;
			const verbose = commandLineParameters.switches.verbose;

			// Delete the target symlink directory if it exists
			if (fs.existsSync(symlinkDir)) {
				try {
					// Remove all files in the directory first
					const files = fs.readdirSync(symlinkDir);
					let shouldNotRemoveDir=false
					for (const file of files) {
						const filePath = path.join(symlinkDir, file);
						if (fs.lstatSync(filePath).isSymbolicLink()) {
							fs.unlinkSync(filePath);
							verbose && xLog.status(`Removed existing symlink: ${filePath}`);
						} else {
							shouldNotRemoveDir=true
							xLog.status(`Skipping non-symlink file: ${filePath}`);
						}
					}

					// Remove the directory itself
					if (!shouldNotRemoveDir){
					fs.rmdirSync(symlinkDir);
						xLog.status(`Emptied and removed existing symlink directory: ${symlinkDir}`);
					}
					else{
						xLog.status(`Kept symlink directory: ${symlinkDir}. Some non-symlink files were there.`);
					}
				} catch (error) {
					xLog.status(
						`Error removing symlink directory ${symlinkDir}:`,
						error,
					);
				}
			}

			if (uninstallMode) {
				return;
			}

			// Create a fresh directory
			fs.mkdirSync(symlinkDir, { recursive: true });
			verbose && xLog.status(`Created new symlink directory: ${symlinkDir}`);

			cliData.forEach(({ cliName }) => {
				const symlinkPath = path.join(symlinkDir, cliName);

				// We don't need to check for existing symlinks as we've already cleared the directory
				if (!uninstallMode) {
					try {
						const { executablePath } = cliData.find(
							(entry) => entry.cliName === cliName,
						);
						fs.chmodSync(executablePath, 0o755);
						fs.symlinkSync(executablePath, symlinkPath);
						verbose &&
							xLog.status(
								`Symlink created: ${symlinkPath} -> ${executablePath}`,
							);
					} catch (error) {
						xLog.status(`Error creating symlink for ${cliName}:`, error);
					}
				}
			});

			return symlinkDir;
		}

		// =====================================================================================

		const libraryPath = path.join(__dirname, 'lib.d');
		const cliExecutablePaths = listFilesSync(libraryPath);
		const symlinkDir = createSymlinks(cliExecutablePaths, 'educoreForge');

		symlinkDir && xLog.result(symlinkDir); //give the new path addition to BASH
		symlinkDir && xLog.status(`Remove symlinks with: initCliApps -removeSymlinks`);
		!symlinkDir && xLog.status(`Restore symlinks with: initCliApps`);
		xLog.status(`Use addCliModule to create a new CLI tool`);
	};

//END OF moduleFunction() ============================================================

const partOfSystem = false;
if (partOfSystem) {
	module.exports = moduleFunction({ moduleName }); //returns initialized moduleFunction
	//module.exports = moduleFunction({config, commandLineParameters, moduleName});
} else {
	// prettier-ignore
	{
	process.global = {};
	process.global.xLog = fs.existsSync('./lib/x-log')?require('./lib/x-log'):{ status: console.error, error: console.error, result: console.log };
	process.global.getConfig=typeof(getConfig)!='undefined' ? getConfig : (moduleName => ({[moduleName]:`no configuration data for ${moduleName}`}[moduleName]));
	process.global.commandLineParameters=typeof(commandLineParameters)!='undefined'?commandLineParameters:undefined;;
	process.global.rawConfig={}; //this should only be used for debugging, use getConfig(moduleName)
	}
	module.exports = moduleFunction({ moduleName })({}); //runs it right now
	//module.exports = moduleFunction({config, commandLineParameters, moduleName})();
}

