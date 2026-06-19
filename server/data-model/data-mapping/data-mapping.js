#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, ''); //this just seems to come in handy a lot

const fs = require('fs');
const path = require('path');

const qt = require('qtools-functional-library'); //qt.help({printOutput:true, queryString:'.*', sendJson:false});

// =====================================================================
// SQL INJECTION PROTECTION
// =====================================================================

const sqlString = require('sqlstring-sqlite');

// SYSTEM_TOKENS: Values that should NOT be escaped (e.g., table names,
// column names - things from your code, not from user input)
const SYSTEM_TOKENS = ['tableName'];

/**
 * safeSql - Secure SQL query builder for mapper getSql() functions
 *
 * This wrapper around qtTemplateReplace:
 * 1. Strips quotes around template tokens (for backwards compatibility)
 * 2. Escapes all user-provided values to prevent SQL injection
 * 3. Preserves system tokens (tableName, etc.) unescaped
 *
 * @param {string} queryTemplate - SQL with <!tokenName!> placeholders
 * @param {Object} replaceObject - Key-value pairs for substitution
 * @returns {string} - Safe SQL query with escaped values
 *
 * USAGE IN MAPPERS:
 *   const getSql = (queryName, replaceObject = {}) => {
 *       const queries = {
 *           'byUsername': `SELECT * FROM <!tableName!> WHERE username = <!username!>`,
 *           'all': `SELECT * FROM <!tableName!> WHERE 1=1`
 *       };
 *       const sql = queries[queryName];
 *       if (!sql) { xLog.error(`Unknown query: ${queryName}`); return undefined; }
 *       return safeSql(sql, replaceObject);  // <-- USE safeSql, NOT qtTemplateReplace
 *   };
 *
 * NOTE: Template tokens should NOT have quotes around them:
 *   CORRECT: `WHERE username = <!username!>`
 *   LEGACY:  `WHERE username = '<!username!>'`  (quotes stripped automatically)
 */
const safeSql = (queryTemplate, replaceObject = {}) => {
    // Step 1: Strip quotes around template tokens for backwards compatibility
    // This allows existing queries like "WHERE name = '<!name!>'" to still work
    // The escaped value will include its own quotes as needed
    let cleanTemplate = queryTemplate
        .replace(/'<!([^!]+)!>'/g, '<!$1!>')   // strip single quotes: '<!token!>' → <!token!>
        .replace(/"<!([^!]+)!>"/g, '<!$1!>');  // strip double quotes: "<!token!>" → <!token!>

    // Step 2: Build safe replacement object
    // - System tokens (tableName, etc.) pass through unchanged
    // - All other values get escaped via sqlstring-sqlite
    const safeReplacements = {};
    Object.keys(replaceObject).forEach(key => {
        if (SYSTEM_TOKENS.includes(key)) {
            // System token - use as-is (e.g., table names from your code)
            safeReplacements[key] = replaceObject[key];
        } else {
            // User-provided value - escape it
            safeReplacements[key] = sqlString.escape(replaceObject[key]);
        }
    });

    // Step 3: Apply substitution with escaped values
    return cleanTemplate.qtTemplateReplace(safeReplacements);
};

// =====================================================================
// END SQL INJECTION PROTECTION
// =====================================================================

//START OF moduleFunction() ============================================================

const moduleFunction = ({ moduleName }) => ({pwHash, hashPassword, verifyPassword, validatePasswordStrength}) => {
	const { xLog, getConfig, rawConfig:unused, commandLineParameters:notUsed } = process.global;
	const {placeholder} = getConfig(moduleName); //moduleName is closure


	const baseMappingProcess = mappingSpec => (inObj, {direction}) => {
		const outObj = {};
		if (direction == 'forward') {
			Object.keys(mappingSpec)
				.filter(name => {
					const tmp=inObj[mappingSpec[name]];
					return inObj[mappingSpec[name]];})
				.forEach(goodName => {
						outObj[goodName] = inObj[mappingSpec[goodName]];
				});
		} else {
			Object.keys(mappingSpec)
				.filter(name => inObj[name])
				.forEach(goodName => {
					outObj[mappingSpec[goodName]] = inObj[goodName];
				});
		}
		return outObj;
	};

	const moduleDirPath = path.join(__dirname, 'mappers');
	const resultObject = {};

	fs
		.readdirSync(moduleDirPath)
		.filter(file => path.extname(file) === '.js')
		.forEach(file => {
			const filePath = path.join(moduleDirPath, file);

			resultObject[
				path.basename(file).replace(path.extname(file), '')
			] = require(filePath)({ baseMappingProcess, pwHash, hashPassword, verifyPassword, validatePasswordStrength, safeSql });
		});

	const outObj = {
		...resultObject
	};

	return outObj;
};

//END OF moduleFunction() ============================================================

module.exports = moduleFunction({moduleName}); //returns initialized moduleFunction
