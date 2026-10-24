'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// openapiSourceParser.js — the ONE place an OpenAPI source file's text becomes a document (wave 2 lane E, K2a, ruled by BRONZE_CROWN
// 2026-10-24). The parser is chosen by the profile's sourceFormat from a table, so a format is a row, never a branch; the loader and both
// round-trip pairs read through here, so the walk and the pair can never parse one file two ways.
//   json  JSON.parse
//   yaml  js-yaml's load under its JSON_SCHEMA: the document can hold only JSON's value kinds (no dates, no custom tags); js-yaml
//         itself refuses a duplicated mapping key and a stream of more than one document. An unquoted YAML scalar keeps YAML's own
//         typing (CASE's `enum: [ 1.1 ]` is a number): the walk refuses it unless the profile declares its text (K2d).

const fs = require('fs');
const jsYaml = require('js-yaml');

const PARSER_BY_SOURCE_FORMAT = Object.freeze({
	json: (sourceText) => JSON.parse(sourceText),
	yaml: (sourceText) => jsYaml.load(sourceText, { schema: jsYaml.JSON_SCHEMA }),
});
const SOURCE_FORMAT_LIST = Object.freeze(Object.keys(PARSER_BY_SOURCE_FORMAT));

// parseOpenapiSourceFile — { sourceFilePath, sourceFormat } → { parseRefusal: '' or why not, document }
const parseOpenapiSourceFile = ({ sourceFilePath, sourceFormat }) => {
	const parserOfFormat = PARSER_BY_SOURCE_FORMAT[sourceFormat];
	if (parserOfFormat === undefined) {
		return { parseRefusal: `${moduleName} REFUSED: sourceFormat '${sourceFormat}' has no parser (readable: ${SOURCE_FORMAT_LIST.join(', ')})`, document: undefined };
	}
	try {
		return { parseRefusal: '', document: parserOfFormat(fs.readFileSync(sourceFilePath, 'utf8')) };
	} catch (parseError) {
		// localized parse boundary (house-sanctioned, jsonLdVocabularyLoader.js): the refusal, not the throw, is the flow
		return { parseRefusal: `${moduleName} REFUSED: '${sourceFilePath}' is not parseable ${sourceFormat} (${parseError.message.split('\n')[0]}); reacquire per README_PROVENANCE.md`, document: undefined };
	}
};

module.exports = { parseOpenapiSourceFile, SOURCE_FORMAT_LIST, moduleName };
