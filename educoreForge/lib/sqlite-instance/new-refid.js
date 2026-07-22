#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, ''); //this just seems to come in handy a lot
//const projectRoot=fs.realpathSync(path.join(__dirname, '..', '..')); // adjust the number of '..' to fit reality

const qt = require('qtools-functional-library'); //qt.help({printOutput:true, queryString:'.*', sendJson:false});

//START OF moduleFunction() ============================================================


// process.global.newRefId({digits:4,excludedChars:['A','B','C','D', '0', 'l', '1', 'I', 'O', 'Z']})

const moduleFunction = function({ digits }) {
	//const qt = require('qtools-functional-library'); //qt.help({printOutput:true, queryString:'.*', sendJson:false});
	const alphaNumericRandom = (digits) => (options = {}) => {
		digits=options.digits?options.digits:digits;
		const getChar = () => {
			const allChars =
				'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
			const {excludedChars=[]}=options;
			

				const cleanupRegEx=new RegExp(`(${excludedChars.join('|')})`, 'g');

			const workingCharSet = options.excludedChars
				? allChars.replace(
						cleanupRegEx,
						''
					)
				: allChars;

			const root = Math.floor(Math.random() * workingCharSet.length);
			return workingCharSet.substring(root, root + 1);
		};
		let outString = '';
		[...new Array(digits)].forEach(
			unused => (outString = getChar() + outString)
		);
		return outString;
	};

	return alphaNumericRandom(digits);
};

//END OF moduleFunction() ============================================================

module.exports = moduleFunction;

