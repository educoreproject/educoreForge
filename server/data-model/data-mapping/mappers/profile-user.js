#!/usr/bin/env node
'use strict';

/**
 * MAPPER EXAMPLE: PROFILE USER DATA TRANSFORMATION
 *
 * This mapper demonstrates the complete pattern for creating data mappers.
 * Use this file as a template when creating new mappers for other business entities.
 *
 * MAPPER PURPOSE: Transform data between database format and application format
 * - Database format: Raw SQL columns with database naming conventions
 * - Application format: Clean objects with application naming conventions
 * - Bidirectional: 'forward' (DB→App) and 'reverse' (App→DB) transformations
 *
 * ARCHITECTURE PATTERN:
 * 1. Field mapping configuration (inputNameMapping)
 * 2. Record-level transformation functions (recordMapper)
 * 3. Array/single object handler (mapper)
 * 4. Named SQL query generation (getSql) - USES safeSql FOR INJECTION PROTECTION
 * 5. Clean API export (map and getSql functions)
 *
 * TO CREATE A NEW MAPPER:
 * 1. Copy this file to new name matching your entity (e.g., product-catalog.js)
 * 2. Update inputNameMapping with your database→application field mappings
 * 3. Modify recordMapper for any custom transformation logic
 * 4. Add named queries to getSql() for your entity's common database operations
 * 5. Register in data-mapping.js to make available to access points
 * 6. Test with corresponding access point
 */

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, ''); //this just seems to come in handy a lot

const qt = require('qtools-functional-library'); //qt.help({printOutput:true, queryString:'.*', sendJson:false});

//START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName }) =>
	({ baseMappingProcess, pwHash, hashPassword, verifyPassword, validatePasswordStrength, safeSql }) => {
		process.global = process.global ? process.global : {};
		const xLog = process.global.xLog;


		// ================================================================================
		// FIELD MAPPING CONFIGURATION
		//
		// EXPLANATION: Maps database column names to application property names.
		// This enables clean separation between database schema and application objects.
		//
		// PATTERN: { ['databaseColumnName']: 'applicationPropertyName' }
		// BIDIRECTIONAL: Works for both DB→App (forward) and App→DB (reverse) transforms
		//
		// SPECIAL HANDLING:
		// - Use 'XXX' as applicationPropertyName to mark fields for removal from output
		// - Keep refId, createdAt, updatedAt for standard database columns
		//
		// TO ADD NEW FIELDS: Add entries for any new database columns or application properties

		const inputNameMapping = {
			['refId']: 'refId',
			['username']: 'username',
			['password']: 'password',
			['first']: 'first',
			['last']: 'last',
			['emailAdr']: 'emailAdr',
			['phone']: 'phone',
			['source']: 'source',
			['role']: 'role'
		}; // {reverseName:'forwardName'}, result name XXX forces removed from output

		// ================================================================================
		// TRANSFORMATION FUNCTION SETUP
		//
		// EXPLANATION: Creates the core transformation function using the mapping system.
		// baseMappingProcess is provided by the data-mapping layer and handles the actual
		// field name transformations based on inputNameMapping configuration.
		//
		// TO MODIFY: Generally no changes needed here unless custom transformation logic required

		const basicMapper = baseMappingProcess(inputNameMapping);


		// ================================================================================
		// RECORD-LEVEL TRANSFORMATION
		//
		// EXPLANATION: Transforms individual data records between database and application formats.
		// This is where custom business logic transformations happen beyond simple field mapping.
		//
		// DIRECTION PARAMETER:
		// - 'forward': Database format → Application format (default)
		// - 'reverse': Application format → Database format
		//
		// CUSTOM LOGIC EXAMPLES:
		// - Data validation and cleaning
		// - Computed fields (fullName = first + ' ' + last)
		// - Date format conversions
		// - Password hashing/validation
		// - Field removal (XXX pattern)
		//
		// TO ADD CUSTOM LOGIC: Insert transformations before the return statement

		const recordMapper = (inObj, direction = 'forward') => {
			const outObj = basicMapper(inObj, {direction});

			// Remove fields marked with 'XXX' in inputNameMapping
			delete outObj.XXX; //inputs that are not wanted by the rest of the app are removed

			// CUSTOM TRANSFORMATION LOGIC
			if (direction === 'forward') {
				// Database → Application format
				// Never send password hashes to client
				delete outObj.password;
			}

			if (direction === 'reverse') {
				// Application → Database format
				// Hash passwords before storing in database
				if (outObj.password) {
					// Only hash if password is provided and not already hashed
					if (!outObj.password.includes(':')) {
						try {
							outObj.password = hashPassword(outObj.password);
						} catch (error) {
							xLog.error(`Password hashing failed: ${error.message}`);
							throw new Error('Password processing failed');
						}
					}
				}
			}

			return outObj;
		};


		// ================================================================================
		// ARRAY/SINGLE OBJECT HANDLER
		//
		// EXPLANATION: Handles both individual objects and arrays of objects uniformly.
		// This provides a consistent interface whether processing single records or collections.
		//
		// USAGE PATTERNS:
		// - Single object: mapper(userObject, 'forward')
		// - Array of objects: mapper(userArray, 'forward')
		// - Default direction: mapper(userData) // defaults to 'forward'
		//
		// TO MODIFY: Generally no changes needed here

		const mapper = (inData, direction = 'forward') => {
			if (Array.isArray(inData)) {
				return inData.map((inObj) => recordMapper(inObj, direction));
			}
			return recordMapper(inData, direction);
		};


		// ================================================================================
		// NAMED SQL QUERY GENERATION (WITH SQL INJECTION PROTECTION)
		//
		// EXPLANATION: Provides pre-defined SQL queries with parameter substitution.
		// This is the preferred pattern for database access - NO raw SQL in access points.
		//
		// SECURITY: Uses safeSql() which automatically escapes user-provided values
		// to prevent SQL injection attacks. System tokens (like tableName) are NOT escaped.
		//
		// NAMED QUERY PATTERN:
		// 1. Define common queries with descriptive names
		// 2. Use <!tokenName!> for parameter substitution (NO quotes around tokens)
		// 3. Access points call: dataMapping['mapper-name'].getSql('queryName', {params})
		// 4. safeSql handles token→value substitution WITH ESCAPING
		//
		// STANDARD TOKENS:
		// - <!tableName!> - Replaced by database abstraction layer (NOT escaped)
		// - <!fieldName!> - Replaced with actual field values (ESCAPED for safety)
		//
		// QUERY NAMING CONVENTIONS:
		// - 'all' - Select all records
		// - 'byFieldName' - Select by specific field (byUsername, byId, etc.)
		// - 'search' - Text search queries
		// - 'recent' - Time-based queries
		//
		// TO ADD NEW QUERIES:
		// 1. Add new entry to queries object with descriptive name
		// 2. Use token substitution for dynamic values (NO quotes around tokens)
		// 3. Test with corresponding access point
		// 4. Document the query's purpose and required parameters

		const getSql = (queryName, replaceObject = {}) => {
			const queries = {
				'byUsername': `
					SELECT
						refId, username, password, first, last,
						emailAdr, phone, source, role
					FROM <!tableName!>
					WHERE username = <!username!>
				`,
				'all': `
					SELECT
						refId, username, password, first, last,
						emailAdr, phone, source, role
					FROM <!tableName!>
					WHERE 1=1
				`
				// ADD NEW QUERIES HERE:
				// 'byRole': `SELECT * FROM <!tableName!> WHERE role = <!role!>`,
				// 'searchByName': `SELECT * FROM <!tableName!> WHERE first LIKE <!searchTerm!> OR last LIKE <!searchTerm!>`,
				// 'activeUsers': `SELECT * FROM <!tableName!> WHERE source != 'disabled' ORDER BY last, first`
			};

			if (!queries[queryName]) {
				xLog.error(`Unknown query name '${queryName}' in ${moduleName}`);
				return undefined;
			}

			const sql = queries[queryName];

			// CRITICAL: Use safeSql for SQL injection protection
			// safeSql escapes user-provided values while preserving system tokens
			return safeSql(sql, replaceObject);
		};

		// ================================================================================
		// MAPPER API EXPORT
		//
		// EXPLANATION: Returns the public interface for this mapper.
		// Access points will receive these functions through dataMapping['profile-user'].
		//
		// EXPORTED FUNCTIONS:
		// - map: Transform data between database and application formats
		// - getSql: Generate named SQL queries with parameter substitution
		//
		// USAGE IN ACCESS POINTS:
		// - const user = dataMapping['profile-user'].map(dbRecord, 'forward');
		// - const query = dataMapping['profile-user'].getSql('byUsername', {username: 'john'});
		//
		// TO MODIFY: Generally no changes needed here

		return {
			map: mapper,
			getSql,
			hashPassword,
			verifyPassword,
			validatePasswordStrength
		};
	};

//END OF moduleFunction() ============================================================

// ================================================================================
// MODULE INITIALIZATION AND EXPORT
//
// EXPLANATION: Initializes the mapper with moduleName and exports the configured
// mapper function. The moduleName is used for error reporting and logging.
//
// REGISTRATION: This mapper must be registered in data-mapping.js to be available
// to access points via: dataMapping['profile-user']
//
// TO MODIFY: No changes needed here

module.exports = moduleFunction(moduleName); //returns initialized moduleFunction
