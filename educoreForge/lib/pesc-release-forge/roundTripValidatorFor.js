'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripValidatorFor.js — every PESC release bundle's round-trip validator (DESIGN-pescForge.md §5;
// WORKORDER §3 F4): the framework's harness over the shared pair (roundTripPair.js).
//
//   makeRoundTripValidator({ forgeDeclaration }) → { validate, validateWithReader, … } (the harness's validator)
//
// Each bundle's three-line roundTripValidator.js calls this with its own declaration (the SAME object
// the entry module uses); the bundles' files did not change when F4 replaced the stub that stood here.
// The label prefix the pair classifies nodes by is the declaration's rootLabel less 'Root', and must
// agree with its embedTextLabel less 'EmbedText': a declaration that disagrees with itself is refused.
//
// validate (the stage contract) also writes the regenerated .xsd files into <outputPath>/regeneratedXsd/,
// so a stage-on build leaves the files xmllint can compile beside the verdict (§5.2's "second, free check").
// validateWithReader (what the gates drive, over the graph double) writes the verdict only; the gates
// take the regenerated texts from the pair directly.

const fs = require('fs');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { makeRoundTripPair } = require('./roundTripPair');

const ROOT_LABEL_SUFFIX = 'Root';
const EMBED_TEXT_LABEL_SUFFIX = 'EmbedText';
const VERDICT_VERSION = 'pescReleaseRoundTripVerdict-1';
const REGENERATED_DIR_NAME = 'regeneratedXsd';

const labelPrefixOf = ({ forgeDeclaration }) => {
	const { rootLabel, embedTextDeclaration, standardKey } = forgeDeclaration;
	const embedTextLabel = embedTextDeclaration === undefined ? undefined : embedTextDeclaration.embedTextLabel;
	const fromRootLabel = typeof rootLabel === 'string' && rootLabel.endsWith(ROOT_LABEL_SUFFIX) ? rootLabel.slice(0, -ROOT_LABEL_SUFFIX.length) : null;
	const fromEmbedTextLabel = typeof embedTextLabel === 'string' && embedTextLabel.endsWith(EMBED_TEXT_LABEL_SUFFIX) ? embedTextLabel.slice(0, -EMBED_TEXT_LABEL_SUFFIX.length) : null;
	if (fromRootLabel === null || fromRootLabel === '' || fromRootLabel !== fromEmbedTextLabel) {
		throw refuse.byName({ moduleName, what: `${standardKey}: rootLabel '${rootLabel}' and embedTextLabel '${embedTextLabel}' do not share one label prefix`, where: 'a release declaration names <labelPrefix>Root and <labelPrefix>EmbedText (releaseNames.js)' });
	}
	return fromRootLabel;
};

const makeRoundTripValidator = ({ forgeDeclaration }) => {
	const roundTripHarness = require(path.join(__dirname, '..', 'forge-framework', 'roundTripHarness', 'roundTripHarness'))();
	const roundTripPair = makeRoundTripPair({ labelPrefix: labelPrefixOf({ forgeDeclaration }) });
	const harnessValidator = roundTripHarness.validatorFrom({
		forgeDeclaration,
		canonicalizeSource: roundTripPair.canonicalizeSource,
		emitFromGraph: roundTripPair.emitFromGraph,
		diffStatements: roundTripPair.diffStatements,
		semanticValidationLimit: roundTripPair.semanticValidationLimit,
		verdictVersion: VERDICT_VERSION,
	});

	const validate = (validateArgs, callback) => {
		harnessValidator.validate(validateArgs, (validateError, verdict) => {
			if (validateError) {
				callback(validateError);
				return;
			}
			const regeneratedDirPath = path.join(validateArgs.outputPath, REGENERATED_DIR_NAME);
			const fileTextByName = roundTripPair.lastRegeneration.fileTextByName;
			fs.mkdir(regeneratedDirPath, { recursive: true }, (mkdirError) => {
				if (mkdirError) {
					callback(`${moduleName}: creating ${regeneratedDirPath} failed: ${mkdirError.message}`);
					return;
				}
				const fileNameList = Object.keys(fileTextByName);
				const writeNext = (fileIndex) => {
					if (fileIndex >= fileNameList.length) {
						callback('', verdict);
						return;
					}
					fs.writeFile(path.join(regeneratedDirPath, fileNameList[fileIndex]), fileTextByName[fileNameList[fileIndex]], (writeError) => {
						if (writeError) {
							callback(`${moduleName}: writing the regenerated ${fileNameList[fileIndex]} failed: ${writeError.message}`);
							return;
						}
						writeNext(fileIndex + 1);
					});
				};
				writeNext(0);
			});
		});
	};

	return { ...harnessValidator, validate, roundTripPair };
};

module.exports = { makeRoundTripValidator, labelPrefixOf, VERDICT_VERSION, REGENERATED_DIR_NAME, moduleName };
