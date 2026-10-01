'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsdSetLoader.js — loader 1 of the PESC release forge, `pescReleaseXsdSet` (DESIGN-pescForge.md
// §1.2, §1.3; gates F4 and F5).
//
//   makeXsdSetLoader({ frozenReleaseCensus, frozenCensusName })
//     → load({ sourcePath }, callback) → callback('', loadedXsdSet) | callback(refusalMessage)
//   loadedXsdSet = { artifacts, parseAudit, resolutionTable, referenceList, releaseCensus }
//
// In order, each step refusing by name:
//   1. PARSE      the snapshot folder's .xsd files through xsdParser (pesc260805's parser, copied):
//                 an untaught construct, an unbound prefix or a non-PESC namespace refuses here.
//   2. RESOLVE    every as-written QName through its own file's prefix table to a row of the
//                 release's resolution table (resolutionTable.js); one miss refuses (F5).
//   3. CENSUS     the counts equal the bundle's frozen census (releaseCensus.js); one difference
//                 refuses, naming every differing field (F4).
//
// The framework has already verified every byte against SHA256SUMS before this runs (forge() step
// 2); this loader does not verify checksums.

const path = require('path');
const { parsePescCorpus } = require('./xsdParser')();
const resolutionTableLib = require('./resolutionTable');
const releaseCensusLib = require('./releaseCensus');

const makeXsdSetLoader = ({ frozenReleaseCensus, frozenCensusName }) => {
	const load = ({ sourcePath }, callback) => {
		parsePescCorpus({ sourcePath }, (parseError, parsedCorpus) => {
			if (parseError) {
				callback(parseError);
				return;
			}
			const resolved = resolutionTableLib.resolveRelease({ artifacts: parsedCorpus.artifacts });
			if (resolved.refusalMessage) {
				callback(resolved.refusalMessage);
				return;
			}
			const measured = releaseCensusLib.measureReleaseCensus({ artifacts: parsedCorpus.artifacts, referenceCensus: resolved.referenceCensus });
			if (measured.refusalMessage) {
				callback(measured.refusalMessage);
				return;
			}
			const censusRefusal = releaseCensusLib.compareReleaseCensus({ measuredCensus: measured.census, frozenCensus: frozenReleaseCensus, frozenCensusName });
			if (censusRefusal) {
				callback(censusRefusal);
				return;
			}
			callback('', {
				artifacts: parsedCorpus.artifacts,
				parseAudit: parsedCorpus.parseAudit,
				resolutionTable: resolved.resolutionTable,
				referenceList: resolved.referenceList,
				releaseCensus: measured.census,
			});
		});
	};
	return { load };
};

module.exports = { makeXsdSetLoader, moduleName };
