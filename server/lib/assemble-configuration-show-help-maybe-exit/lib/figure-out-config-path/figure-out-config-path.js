#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
/*

From system to system, this file is almost always customized for particular needs.
However, this particular one is pretty close to universal.

*/

//START OF moduleFunction() ============================================================
const moduleFunction = function ({ xxx } = {}) {
	const { xLog } = process.global;


	const findProjectRoot = ({
		rootFolderName = 'system',
		closest = true,
	} = {}) =>
		__dirname.replace(
			new RegExp(`^(.*${closest ? '' : '?'}\/${rootFolderName}).*$`),
			'$1',
		);
	const projectRoot = findProjectRoot(); // call with {closest:false} if there are nested rootFolderName directories and you want the top level one

	const getConfigPath = ({ commandLineConfigPath, configName='systemParameters.ini' } = {}) => {

		if (commandLineConfigPath && fs.existsSync(commandLineConfigPath)) {
			return commandLineConfigPath; //return user override config file path
		}

		// =========================================================================
		// This module can be used in a qtools standard project. If so, the config file
		// can be found automatically by reference to the project root.
		// This is found by using the following code in the top level main file of the
		// project.
		// First it looks for a config file in .../configs/${username}
		// Then it checks for TQ's development config in .../configs/qbook
		// Then it looks for a file in .../configs/instanceSpecific
		// Then it looks for a file in .../configs (no instanceSpecific)
		//
		// Unless a value is set in process.global.configPath

		if (!process.global.configPath) {

			const homeUserNameFilePath = path.join(
				projectRoot,
				'configs',
				'instanceSpecific',
				os.userInfo().username,
				`${configName}.ini`,
			); //deployment copies target config to 'configs'; if qbook exists, it's dev system

			const qbookFilePath = path.join(
				projectRoot,
				'configs',
				'instanceSpecific',
				'qbook',
				`${configName}.ini`,
			); //deployment copies target config to 'configs'; if qbook exists, it's dev system

			const hasInstanceFilePath = path.join(
				projectRoot,
				'configs',
				'instanceSpecific',
				`${configName}.ini`,
			); //deployment copies target config to 'configs'; if qbook exists, it's dev system

			const topOfDirFilePath = path.join(
				projectRoot,
				'configs',
				`${configName}.ini`,
			); //deployment copies target config to 'configs'; if qbook exists, it's dev system

			if (fs.existsSync(homeUserNameFilePath)) {
				return homeUserNameFilePath; // this one is any other developers
			}

			if (fs.existsSync(qbookFilePath)) {
				return qbookFilePath; // this one is special for TQ
			}

			if (fs.existsSync(hasInstanceFilePath)) {
				return hasInstanceFilePath; // this one is any other developers
			}

			if (fs.existsSync(topOfDirFilePath)) {
				return topOfDirFilePath; // this one is any other developers
			}
			const message=`NO CONFIG FILE FOUND at\n    ${homeUserNameFilePath} or\n    ${qbookFilePath} or\n    ${hasInstanceFilePath} or\n    ${topOfDirFilePath}\n    (projectRoot was found to be: ${projectRoot} is that right?)`;
			xLog.error(message);
			throw `NO CONFIG FILE FOUND`;
		}

		if (fs.existsSync(process.global.configPath)) {
			return process.global.configPath; // normal deployment has config data at top level of directory so other config's secrets are preserved
		} else {
			throw `NO CONFIG FILE FOUND. Is projectRoot correct?`;
		}
		return;
	};
	return { getConfigPath };
};
//END OF moduleFunction() ============================================================
module.exports = moduleFunction;
