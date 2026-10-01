'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// writeScopeAndSectionsLib.js — the bridge's two generated data files, from a forge result
// (DESIGN-pescForge.md §4.1; DESIGN-pescBridge.md §1.1, §1.2; WORKORDER §3 F3). The CLI
// (writeScopeAndSections.js) forges a bundle and writes the files; the gate calls this directly.
//
//   scopeAndSectionsOf({ nodeList, edgeList, labelPrefix })
//     → { reachableSubjectStableIdList, sectionRowList, scopeFileText, sectionFileText, sectionFileSha256 }
//       | { refusalMessage }
//   bridgeFileNamesOf({ labelPrefix }) → { scopeFileName, sectionFileName }
//   writeScopeAndSectionsFiles({ nodeList, edgeList, labelPrefix, outputDirPath }, callback)
//     → callback('', { scopeFilePath, sectionFilePath, ...scopeAndSectionsOf }) | callback(refusalText)
//
// THE SCOPE LIST is the stableIds of the release's element declarations marked reachableFromRoot,
// sorted, as a JSON array (bridge-framework reads `subjectSource.scopeStableIdListPath` as "a non-empty
// JSON array of stableId strings", code fact). It must equal the set of declarations with at least one
// HAS_INSTANCE edge, because fan-out refuses a subject with no instance (code fact,
// materialisationFanout.js): a disagreement is refused here, never written.
// THE SECTION FILE is one row per distinct occurrence sectionPath, sorted, under the header
// `sectionPath<TAB>documentSection`: the raw section and its readable form by the forge's own rule
// (contextText.js), the label the judge reads (judgmentPartition.js readPartitionFile, code fact: a
// header row, tab-separated, a blank cell or a repeated object refused). The sections named by the
// declarations' occurrenceSectionList must equal the sections the occurrences carry.
//
// ONE-ELEMENT LISTS. The replay engine stores a one-element list as a scalar (code fact,
// hub-framework.js: "The replay engine scalarizes single-element arrays"), so a declaration in one
// section reads back with occurrenceSectionList 'CollegeTranscript/Student/Person', not a list. Every
// list property is read through widenedList; a fresh forge and a graph read give the same files
// (gate F9 scalarReadIsWidened).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();
const refuse = require(path.join(__dirname, '..', '..', 'forge-framework', 'refuse'));
const { contextTextOf } = require('../contextText');

const ELEMENT_LABEL_SUFFIX = 'Element';
const OCCURRENCE_LABEL_SUFFIX = 'Occurrence';
const HAS_INSTANCE_EDGE_TYPE = 'HAS_INSTANCE';
const SECTION_FILE_HEADER_CELL_LIST = Object.freeze(['sectionPath', 'documentSection']);
const SCOPE_FILE_SUFFIX = 'ReachableSubjects.json';
const SECTION_FILE_SUFFIX = 'SectionPartition.tsv';
const TSV_FIELD_SEPARATOR = '\t';
const LINE_SEPARATOR = '\n';

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const compareStrings = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);

// a list property as read back from the graph: a scalar is a one-element list
const widenedList = (listOrScalar) => (Array.isArray(listOrScalar) ? listOrScalar : [listOrScalar]);

// the bridge data files' names: the plugin's lowerCamel prefix (DESIGN-pescForge.md §2.5) + suffix
const bridgeFileNamesOf = ({ labelPrefix }) => {
	const bridgeFilePrefix = `${labelPrefix.charAt(0).toLowerCase()}${labelPrefix.slice(1)}`;
	return { scopeFileName: `${bridgeFilePrefix}${SCOPE_FILE_SUFFIX}`, sectionFileName: `${bridgeFilePrefix}${SECTION_FILE_SUFFIX}` };
};

const scopeAndSectionsOf = ({ nodeList, edgeList, labelPrefix }) => {
	const labelOf = (oneNode) => oneNode.labels[1];
	const elementLabel = `${labelPrefix}${ELEMENT_LABEL_SUFFIX}`;
	const occurrenceLabel = `${labelPrefix}${OCCURRENCE_LABEL_SUFFIX}`;
	const reachableElementList = nodeList.filter((oneNode) => labelOf(oneNode) === elementLabel && oneNode.properties.reachableFromRoot === true);
	const occurrenceList = nodeList.filter((oneNode) => labelOf(oneNode) === occurrenceLabel);
	if (reachableElementList.length === 0 || occurrenceList.length === 0) {
		return { refusalMessage: refusalText(`the forge result holds ${reachableElementList.length} reachable '${elementLabel}' nodes and ${occurrenceList.length} '${occurrenceLabel}' nodes`, 'a release graph has reachable element declarations and their occurrences (phase F3 walk)') };
	}

	const reachableSubjectStableIdList = reachableElementList.map((oneNode) => oneNode.stableId).sort(compareStrings);
	const elementStableIdSet = new Set(nodeList.filter((oneNode) => labelOf(oneNode) === elementLabel).map((oneNode) => oneNode.stableId));
	const instancedElementStableIdList = [...new Set(edgeList.filter((oneEdge) => oneEdge.type === HAS_INSTANCE_EDGE_TYPE && elementStableIdSet.has(oneEdge.fromRef.id)).map((oneEdge) => oneEdge.fromRef.id))].sort(compareStrings);
	if (JSON.stringify(instancedElementStableIdList) !== JSON.stringify(reachableSubjectStableIdList)) {
		const markedOnlyList = reachableSubjectStableIdList.filter((oneId) => instancedElementStableIdList.indexOf(oneId) === -1);
		const instancedOnlyList = instancedElementStableIdList.filter((oneId) => reachableSubjectStableIdList.indexOf(oneId) === -1);
		return { refusalMessage: refusalText(`${reachableSubjectStableIdList.length} declarations are marked reachableFromRoot and ${instancedElementStableIdList.length} have a HAS_INSTANCE edge (marked only: ${markedOnlyList.slice(0, 2).join(' | ') || 'none'}; instanced only: ${instancedOnlyList.slice(0, 2).join(' | ') || 'none'})`, 'the scope list is exactly the declarations with occurrences; fan-out refuses a subject with none') };
	}

	const declaredSectionPathList = [...new Set(reachableElementList.reduce((soFar, oneNode) => [...soFar, ...widenedList(oneNode.properties.occurrenceSectionList)], []))].sort(compareStrings);
	const occurrenceSectionPathList = [...new Set(occurrenceList.map((oneNode) => oneNode.properties.sectionPath))].sort(compareStrings);
	if (JSON.stringify(declaredSectionPathList) !== JSON.stringify(occurrenceSectionPathList)) {
		return { refusalMessage: refusalText(`the declarations name ${declaredSectionPathList.length} sections and the occurrences carry ${occurrenceSectionPathList.length} (first declared: ${declaredSectionPathList.slice(0, 2).join(' | ')}; first carried: ${occurrenceSectionPathList.slice(0, 2).join(' | ')})`, 'occurrenceSectionList is the set of its occurrences\' sectionPath; read it through widenedList') };
	}

	const sectionRowList = occurrenceSectionPathList.map((oneSectionPath) => ({ sectionPath: oneSectionPath, documentSection: contextTextOf(oneSectionPath) }));
	const scopeFileText = `${JSON.stringify(reachableSubjectStableIdList, null, '\t')}${LINE_SEPARATOR}`;
	const sectionFileText = [SECTION_FILE_HEADER_CELL_LIST.join(TSV_FIELD_SEPARATOR)].concat(sectionRowList.map((oneRow) => `${oneRow.sectionPath}${TSV_FIELD_SEPARATOR}${oneRow.documentSection}`)).join(LINE_SEPARATOR) + LINE_SEPARATOR;
	return {
		reachableSubjectStableIdList,
		sectionRowList,
		scopeFileText,
		sectionFileText,
		sectionFileSha256: crypto.createHash('sha256').update(sectionFileText, 'utf8').digest('hex'),
	};
};

const writeScopeAndSectionsFiles = ({ nodeList, edgeList, labelPrefix, outputDirPath }, callback) => {
	const taskList = new taskListPlus();

	taskList.push((args, next) => {
		if (typeof outputDirPath !== 'string' || !fs.existsSync(outputDirPath) || !fs.statSync(outputDirPath).isDirectory()) {
			next(refusalText(`outputDirPath '${outputDirPath}' is not a directory`, 'the files are written into an existing directory (a bundle\'s bridges/ for B1)'));
			return;
		}
		const computed = scopeAndSectionsOf({ nodeList, edgeList, labelPrefix });
		if (computed.refusalMessage) {
			next(computed.refusalMessage);
			return;
		}
		const { scopeFileName, sectionFileName } = bridgeFileNamesOf({ labelPrefix });
		next('', { ...args, computed, scopeFilePath: path.join(outputDirPath, scopeFileName), sectionFilePath: path.join(outputDirPath, sectionFileName) });
	});

	taskList.push((args, next) => {
		fs.writeFile(args.scopeFilePath, args.computed.scopeFileText, (writeError) => next(writeError ? refusalText(`writing ${args.scopeFilePath} failed: ${writeError.message}`, 'the scope file is written whole or not at all') : '', args));
	});

	taskList.push((args, next) => {
		fs.writeFile(args.sectionFilePath, args.computed.sectionFileText, (writeError) => next(writeError ? refusalText(`writing ${args.sectionFilePath} failed: ${writeError.message}`, 'the section file is written whole or not at all') : '', args));
	});

	pipeRunner(taskList.getList(), {}, (pipeError, finalArgs) => {
		if (pipeError) {
			callback(pipeError);
			return;
		}
		callback('', { scopeFilePath: finalArgs.scopeFilePath, sectionFilePath: finalArgs.sectionFilePath, ...finalArgs.computed });
	});
};

module.exports = { scopeAndSectionsOf, writeScopeAndSectionsFiles, bridgeFileNamesOf, widenedList, SECTION_FILE_HEADER_CELL_LIST, moduleName };
