'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// graph-structure-check.js — the structure checks PLAN G5 and G6 asked for, read from a materialised graph (campaign P4a).
//
//   instanceStructure (G5) — for EVERY standard that has instances (SIF Fields, PESC occurrences; DmeInstance since P3):
//       every instance has exactly ONE declaration (one incoming HAS_INSTANCE, from a DmeProperty of its own standard) and
//       exactly ONE owner (one incoming edge of the type graphStructureRules.json names for its label suffix: HAS_FIELD
//       from its SIF object, HAS_CHILD from its PESC parent); every declaration with instances carries no match edge of its
//       own (its mappings live on its instances, so the two can never be counted twice); a declaration that records an
//       instanceCount (SIF Questions) records its HAS_INSTANCE out-degree. Until P4a only SIF's forge gate checked this.
//   codeListStructure (G6) — per standard: option sets, option values, empty option sets (reported, not failed: CEDS 2 and
//       Ed-Fi 46 are real), and every option value owned by exactly ONE option set of its own standard; where the
//       standard's family declares a frozen SOURCE census (graphStructureRules.json; PESC's releaseCensus.json, counted
//       from the release files by a tool separate from the walk), the graph's option set and value counts must equal it.
//   rootOwnership (G5's other half; a VERDICT since forgeClean lane CLEAN, R2, 2026-10-08, PLAN G19) — per standard and
//       role, the content nodes no directed path (any edge type, depth ROOT_REACH_DEPTH) from the standard's root reaches
//       (text nodes, hub cards and the hub definition are outside the question). FAIL when any standard has one, naming
//       the standard, the roles and the orphans' stableIds (a capped sample, read by a second query only when a standard
//       fails, so a clean graph pays for one walk). W-C-1 made every SIF node reachable; lane CLEAN made every PESC node
//       reachable; until R2 the row was only a measurement, so nothing stopped a new orphan.
//
// The forgeCensus attestation (forge-census-gate.js) folds all three checks into its row at every -build; the
// standalone tools/graphStructureCheck.js runs all three against a named container, read-only.
//
//   instanceStructureRowFor({ instanceRowList, declarationRowList }) -> row (pure)
//   codeListStructureRowFor({ optionValueRowList, optionSetRowList, sourceCodeListCensusByStandard }) -> row (pure)
//   rootOwnershipRowFor({ rootRoleRowList, unreachedStableIdListByStandard }) -> row (pure; the orphan names are optional)
//   unreachedStableIdListFor({ reachedStableIdList, contentStableIdList }) -> the sorted orphans (pure)
//   runGraphStructureCheck({ session, checkNameList, sourceCodeListCensusByStandard }, callback(err, checkRowList))
//   sourceCodeListCensusFor({ treeRootPath, standardDefinitionRowList }) -> { sourceCodeListCensusByStandard, refusal }
//
// Async style: callback(errString, result). No async/await, no try/catch-for-control-flow.

const fs = require('fs');
const path = require('path');
const vocabulary = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const GRAPH_STRUCTURE_RULES = Object.freeze(JSON.parse(fs.readFileSync(path.join(__dirname, 'graphStructureRules.json'), 'utf8')));
const INSTANCE_OWNER_EDGE_TYPE_BY_LABEL_SUFFIX = Object.freeze({ ...GRAPH_STRUCTURE_RULES.instanceOwnerEdgeTypeByLabelSuffix });
const CODE_LIST_SOURCE_CENSUS_RULE_BY_STANDARD_FAMILY = Object.freeze({ ...GRAPH_STRUCTURE_RULES.codeListSourceCensusRuleByStandardFamily });
// the deepest directed path the root-ownership check follows (measured: 14 reaches every SIF and Ed-Fi node, and every
// PESC node since lane CLEAN). A node only deeper reads as an orphan: the verdict errs toward FAIL, never toward a pass.
const ROOT_REACH_DEPTH = 14;
const DETAIL_ITEM_CAP = 6;

const INSTANCE_STRUCTURE_CYPHER = `
	MATCH (i:ForgedNode) WHERE i.role = $instanceRole
	WITH i,
	     COUNT { (anyDeclaration)-[:${vocabulary.EDGE_TYPES.HAS_INSTANCE}]->(i) } AS declarationEdgeCount,
	     COUNT { (declaration:ForgedNode)-[:${vocabulary.EDGE_TYPES.HAS_INSTANCE}]->(i) WHERE declaration.role = $propertyRole AND declaration._source = i._source } AS ownDeclarationCount
	UNWIND $ownerEdgeTypeList AS ownerEdgeType
	WITH i, declarationEdgeCount, ownDeclarationCount, ownerEdgeType, COUNT { ()-[ownerEdge]->(i) WHERE type(ownerEdge) = ownerEdgeType } AS ownerEdgeInCount
	RETURN i._source AS standardName, labels(i) AS labelList, ownerEdgeType, count(i) AS instanceCount,
	       count(CASE WHEN declarationEdgeCount = 1 AND ownDeclarationCount = 1 THEN 1 END) AS oneDeclarationInstanceCount,
	       count(CASE WHEN ownerEdgeInCount = 1 THEN 1 END) AS oneOwnerInstanceCount`;
const DECLARATION_STRUCTURE_CYPHER = `
	MATCH (d:ForgedNode) WHERE d.role = $propertyRole AND EXISTS { (d)-[:${vocabulary.EDGE_TYPES.HAS_INSTANCE}]->() }
	WITH d, COUNT { (d)-[:${vocabulary.EDGE_TYPES.HAS_INSTANCE}]->() } AS instanceOutDegree, COUNT { (d)-->(:HubReference) } AS ownMatchEdgeCount
	RETURN d._source AS standardName, count(d) AS declarationCount,
	       count(CASE WHEN d.instanceCount IS NOT NULL AND d.instanceCount <> instanceOutDegree THEN 1 END) AS instanceCountMismatchCount,
	       count(CASE WHEN ownMatchEdgeCount > 0 THEN 1 END) AS declarationWithOwnMatchEdgeCount`;
const OPTION_VALUE_STRUCTURE_CYPHER = `
	MATCH (v:ForgedNode) WHERE v.role = $optionValueRole
	WITH v, COUNT { (anyOwner)-[:${vocabulary.EDGE_TYPES.HAS_VALUE}]->(v) } AS ownerEdgeCount,
	     COUNT { (optionSet:ForgedNode)-[:${vocabulary.EDGE_TYPES.HAS_VALUE}]->(v) WHERE optionSet.role = $optionSetRole AND optionSet._source = v._source } AS ownOptionSetCount
	RETURN v._source AS standardName, count(v) AS optionValueCount, count(CASE WHEN ownerEdgeCount = 1 AND ownOptionSetCount = 1 THEN 1 END) AS oneOptionSetValueCount`;
const OPTION_SET_STRUCTURE_CYPHER = `
	MATCH (s:ForgedNode) WHERE s.role = $optionSetRole
	WITH s, COUNT { (s)-[:${vocabulary.EDGE_TYPES.HAS_VALUE}]->(:ForgedNode) } AS valueCount
	RETURN s._source AS standardName, count(s) AS optionSetCount, count(CASE WHEN valueCount = 0 THEN 1 END) AS emptyOptionSetCount`;
// one directed walk per root collects the roles it reaches; the content totals per role are counted SEPARATELY and the two
// subtracted — a membership test per node (NOT n IN list, or NOT EXISTS over a path) is quadratic and ran for minutes
const ROOT_OWNERSHIP_CYPHER = `
	MATCH (root:ForgedNode) WHERE root.role = $standardRootRole
	CALL {
		WITH root
		MATCH (root)-[*1..${ROOT_REACH_DEPTH}]->(reached:ForgedNode) WHERE reached._source = root._source AND NOT reached:HubReference AND NOT reached:HubDefinition
		WITH DISTINCT reached
		RETURN collect(reached.role) AS reachedRoleList
	}
	CALL {
		WITH root
		MATCH (n:ForgedNode) WHERE n._source = root._source AND n <> root AND n.role <> $embedTextRole AND NOT n:HubReference AND NOT n:HubDefinition
		RETURN n.role AS role, count(n) AS contentNodeCount
	}
	RETURN root._source AS standardName, role, contentNodeCount, size([reachedRole IN reachedRoleList WHERE reachedRole = role]) AS reachedNodeCount
	ORDER BY standardName, role`;
// the two stableId lists of ONE failing standard, diffed in JavaScript (a Set): the orphans' names for the verdict. Run
// only for a standard the count query found short, because a membership test inside Cypher is quadratic (see above)
const ROOT_OWNERSHIP_STABLE_ID_CYPHER = `
	MATCH (root:ForgedNode) WHERE root.role = $standardRootRole AND root._source = $standardName
	CALL {
		WITH root
		MATCH (root)-[*1..${ROOT_REACH_DEPTH}]->(reached:ForgedNode) WHERE reached._source = root._source AND NOT reached:HubReference AND NOT reached:HubDefinition
		RETURN collect(DISTINCT reached.stableId) AS reachedStableIdList
	}
	CALL {
		WITH root
		MATCH (n:ForgedNode) WHERE n._source = root._source AND n <> root AND n.role <> $embedTextRole AND NOT n:HubReference AND NOT n:HubDefinition
		RETURN collect(n.stableId) AS contentStableIdList
	}
	RETURN reachedStableIdList, contentStableIdList`;

const labelSuffixOf = (labelList) => Object.keys(INSTANCE_OWNER_EDGE_TYPE_BY_LABEL_SUFFIX).filter((labelSuffix) => labelList.some((oneLabel) => oneLabel !== vocabulary.DME_ROLES.INSTANCE && oneLabel.endsWith(labelSuffix)));
const cappedText = (itemList) => `${itemList.slice(0, DETAIL_ITEM_CAP).join('; ')}${itemList.length > DETAIL_ITEM_CAP ? `; +${itemList.length - DETAIL_ITEM_CAP} more` : ''}`;
const verdictOf = (failureList) => (failureList.length === 0 ? vocabulary.BUILD_ATTESTATION_VERDICT.PASS : vocabulary.BUILD_ATTESTATION_VERDICT.FAIL);

// instanceStructureRowFor — one row per (standard, label set, owner edge type) from INSTANCE_STRUCTURE_CYPHER; the row whose
// owner edge type is the one declared for the label's suffix is the one judged
const instanceStructureRowFor = ({ instanceRowList, declarationRowList }) => {
	const failureList = [];
	const measuredByStandard = {};
	instanceRowList.forEach((oneRow) => {
		const suffixList = labelSuffixOf(oneRow.labelList);
		if (suffixList.length !== 1) {
			if (oneRow.ownerEdgeType === Object.values(INSTANCE_OWNER_EDGE_TYPE_BY_LABEL_SUFFIX)[0]) {
				failureList.push(`${oneRow.standardName}: ${oneRow.instanceCount} instance(s) labelled ${oneRow.labelList.join(':')} match ${suffixList.length} declared label suffixes (${Object.keys(INSTANCE_OWNER_EDGE_TYPE_BY_LABEL_SUFFIX).join(', ')}); their owner edge is not guessed`);
			}
			return;
		}
		if (INSTANCE_OWNER_EDGE_TYPE_BY_LABEL_SUFFIX[suffixList[0]] !== oneRow.ownerEdgeType) {
			return;
		}
		measuredByStandard[oneRow.standardName] = { instanceCount: oneRow.instanceCount, ownerEdgeType: oneRow.ownerEdgeType, oneDeclarationInstanceCount: oneRow.oneDeclarationInstanceCount, oneOwnerInstanceCount: oneRow.oneOwnerInstanceCount };
		if (oneRow.oneDeclarationInstanceCount !== oneRow.instanceCount) {
			failureList.push(`${oneRow.standardName}: ${oneRow.instanceCount - oneRow.oneDeclarationInstanceCount} of ${oneRow.instanceCount} instance(s) lack exactly one HAS_INSTANCE from a DmeProperty of their standard`);
		}
		if (oneRow.oneOwnerInstanceCount !== oneRow.instanceCount) {
			failureList.push(`${oneRow.standardName}: ${oneRow.instanceCount - oneRow.oneOwnerInstanceCount} of ${oneRow.instanceCount} instance(s) lack exactly one incoming ${oneRow.ownerEdgeType} (their owner)`);
		}
	});
	declarationRowList.forEach((oneRow) => {
		measuredByStandard[oneRow.standardName] = { ...(measuredByStandard[oneRow.standardName] || {}), declarationCount: oneRow.declarationCount };
		if (oneRow.declarationWithOwnMatchEdgeCount > 0) {
			failureList.push(`${oneRow.standardName}: ${oneRow.declarationWithOwnMatchEdgeCount} declaration(s) with instances also carry a match edge of their own (their mappings would count twice)`);
		}
		if (oneRow.instanceCountMismatchCount > 0) {
			failureList.push(`${oneRow.standardName}: ${oneRow.instanceCountMismatchCount} declaration(s) record an instanceCount other than their HAS_INSTANCE out-degree`);
		}
	});
	const standardNameList = Object.keys(measuredByStandard).sort();
	return {
		checkName: 'instanceStructure',
		verdict: verdictOf(failureList),
		detail: failureList.length === 0
			? `${standardNameList.length} standard(s) with instances (${standardNameList.join(', ')}): every instance has one declaration and one owner; no declaration with instances carries its own match edge`
			: `FAILED — ${cappedText(failureList)}`,
		measuredByStandard,
	};
};

// codeListStructureRowFor — per standard from the two option Cyphers, compared with the frozen source census where one is
// declared; a standard with no declared census is NAMED as not compared, never silently passed as compared
const codeListStructureRowFor = ({ optionValueRowList, optionSetRowList, sourceCodeListCensusByStandard }) => {
	const failureList = [];
	const measuredByStandard = {};
	optionSetRowList.forEach((oneRow) => {
		measuredByStandard[oneRow.standardName] = { optionSetCount: oneRow.optionSetCount, emptyOptionSetCount: oneRow.emptyOptionSetCount, optionValueCount: 0, oneOptionSetValueCount: 0 };
	});
	optionValueRowList.forEach((oneRow) => {
		measuredByStandard[oneRow.standardName] = { optionSetCount: 0, emptyOptionSetCount: 0, ...(measuredByStandard[oneRow.standardName] || {}), optionValueCount: oneRow.optionValueCount, oneOptionSetValueCount: oneRow.oneOptionSetValueCount };
		if (oneRow.oneOptionSetValueCount !== oneRow.optionValueCount) {
			failureList.push(`${oneRow.standardName}: ${oneRow.optionValueCount - oneRow.oneOptionSetValueCount} of ${oneRow.optionValueCount} option value(s) lack exactly one owning option set of their standard`);
		}
	});
	const uncomparedList = [];
	Object.keys(measuredByStandard).sort().forEach((standardName) => {
		const sourceCensus = sourceCodeListCensusByStandard[standardName];
		if (!sourceCensus) {
			uncomparedList.push(standardName);
			return;
		}
		const measured = measuredByStandard[standardName];
		measured.sourceOptionSetCount = sourceCensus.optionSetCount;
		measured.sourceOptionValueCount = sourceCensus.optionValueCount;
		if (measured.optionSetCount !== sourceCensus.optionSetCount || measured.optionValueCount !== sourceCensus.optionValueCount) {
			failureList.push(`${standardName}: option sets ${measured.optionSetCount} / values ${measured.optionValueCount} in the graph, ${sourceCensus.optionSetCount} / ${sourceCensus.optionValueCount} in the source census (${sourceCensus.censusFilePath})`);
		}
	});
	const comparedCount = Object.keys(measuredByStandard).length - uncomparedList.length;
	const countText = Object.keys(measuredByStandard).sort().map((standardName) => `${standardName} ${measuredByStandard[standardName].optionSetCount}/${measuredByStandard[standardName].optionValueCount}`).join(', ');
	return {
		checkName: 'codeListStructure',
		verdict: verdictOf(failureList),
		detail: `${failureList.length === 0 ? 'every option value has one owning option set of its standard' : `FAILED — ${cappedText(failureList)}`}; sets/values ${countText}; ${comparedCount} standard(s) equal their frozen source census${uncomparedList.length ? `; not compared to a source census: ${uncomparedList.join(', ')}` : ''}`,
		measuredByStandard,
	};
};

// unreachedStableIdListFor — the content stableIds the reached list lacks, sorted (pure)
const unreachedStableIdListFor = ({ reachedStableIdList, contentStableIdList }) => {
	const reachedStableIdSet = new Set(reachedStableIdList);
	return contentStableIdList.filter((stableId) => !reachedStableIdSet.has(stableId)).sort();
};

// rootOwnershipRowFor — a VERDICT (PLAN G19): FAIL when any standard's root fails to reach one of its content nodes, naming
// the standard and its roles, and the orphans when unreachedStableIdListByStandard carries them
const rootOwnershipRowFor = ({ rootRoleRowList, unreachedStableIdListByStandard }) => {
	const orphanListByStandard = unreachedStableIdListByStandard || {};
	const measuredByStandard = {};
	rootRoleRowList.forEach((oneRow) => {
		const standardMeasure = measuredByStandard[oneRow.standardName] = measuredByStandard[oneRow.standardName] || { contentNodeCount: 0, unreachedNodeCount: 0, unreachedNodeCountByRole: {} };
		standardMeasure.contentNodeCount += oneRow.contentNodeCount;
		const unreachedCount = oneRow.contentNodeCount - oneRow.reachedNodeCount;
		if (unreachedCount > 0) {
			standardMeasure.unreachedNodeCount += unreachedCount;
			standardMeasure.unreachedNodeCountByRole[oneRow.role] = unreachedCount;
		}
	});
	const standardNameList = Object.keys(measuredByStandard).sort();
	const failureList = standardNameList
		.filter((standardName) => measuredByStandard[standardName].unreachedNodeCount > 0)
		.map((standardName) => {
			const measured = measuredByStandard[standardName];
			const orphanList = orphanListByStandard[standardName] || [];
			measured.unreachedStableIdSampleList = orphanList.slice(0, DETAIL_ITEM_CAP);
			return `${standardName}: ${measured.unreachedNodeCount} of ${measured.contentNodeCount} content node(s) unreached from its root (${Object.keys(measured.unreachedNodeCountByRole).map((role) => `${role} ${measured.unreachedNodeCountByRole[role]}`).join(', ')})${orphanList.length ? `: ${cappedText(orphanList)}` : ''}`;
		});
	const countText = standardNameList.map((standardName) => `${standardName} ${measuredByStandard[standardName].unreachedNodeCount}/${measuredByStandard[standardName].contentNodeCount}`).join(', ');
	return {
		checkName: 'rootOwnership',
		verdict: verdictOf(failureList),
		detail: failureList.length === 0
			? `every content node of ${standardNameList.length} standard(s) is reached from its root (unreached/content: ${countText})`
			: `FAILED — ${failureList.join(' | ')}`,
		measuredByStandard,
	};
};

// the neo4j-driver promise is met in exactly this one place; rows come back as plain objects with integers as numbers
const runCypher = (session, cypherText, cypherParameters, callback) => {
	session.run(cypherText, cypherParameters).then(
		(cypherResult) => callback('', cypherResult.records.map((oneRecord) => oneRecord.keys.reduce((soFar, columnName) => {
			const cellValue = oneRecord.get(columnName);
			return { ...soFar, [columnName]: cellValue && typeof cellValue.toNumber === 'function' ? cellValue.toNumber() : cellValue };
		}, {}))),
		(cypherError) => callback(`${moduleName}: ${cypherError.message}`),
	);
};

const CYPHER_PARAMETERS = Object.freeze({
	instanceRole: vocabulary.DME_ROLES.INSTANCE,
	propertyRole: vocabulary.DME_ROLES.PROPERTY,
	optionSetRole: vocabulary.DME_ROLES.OPTION_SET,
	optionValueRole: vocabulary.DME_ROLES.OPTION_VALUE,
	standardRootRole: vocabulary.DME_ROLES.STANDARD_ROOT,
	embedTextRole: vocabulary.DME_ROLES.EMBED_TEXT,
	ownerEdgeTypeList: Object.values(INSTANCE_OWNER_EDGE_TYPE_BY_LABEL_SUFFIX),
});

// each check: the Cyphers it reads (by the row-list name its row builder takes) and the builder
// rootOwnership's second read: for each standard its row found short, the orphans' stableIds, so the verdict names them
const unreachedStableIdListByStandardFor = ({ session, rowListByName }, callback) => {
	const shortStandardNameList = [...new Set(rowListByName.rootRoleRowList.filter((oneRow) => oneRow.contentNodeCount > oneRow.reachedNodeCount).map((oneRow) => oneRow.standardName))].sort();
	const unreachedStableIdListByStandard = {};
	const nextStandard = (standardIndex) => {
		if (standardIndex >= shortStandardNameList.length) {
			callback('', { unreachedStableIdListByStandard });
			return;
		}
		runCypher(session, ROOT_OWNERSHIP_STABLE_ID_CYPHER, { ...CYPHER_PARAMETERS, standardName: shortStandardNameList[standardIndex] }, (cypherError, rowList) => {
			if (cypherError) {
				callback(cypherError);
				return;
			}
			unreachedStableIdListByStandard[shortStandardNameList[standardIndex]] = rowList.length === 1 ? unreachedStableIdListFor(rowList[0]) : [];
			nextStandard(standardIndex + 1);
		});
	};
	nextStandard(0);
};

// each check: the Cyphers it reads (by the row-list name its row builder takes), an optional second read whose result
// joins the builder's arguments, and the builder
const CHECK_BY_NAME = Object.freeze({
	instanceStructure: { cypherByRowListName: { instanceRowList: INSTANCE_STRUCTURE_CYPHER, declarationRowList: DECLARATION_STRUCTURE_CYPHER }, rowFor: instanceStructureRowFor },
	codeListStructure: { cypherByRowListName: { optionValueRowList: OPTION_VALUE_STRUCTURE_CYPHER, optionSetRowList: OPTION_SET_STRUCTURE_CYPHER }, rowFor: codeListStructureRowFor },
	rootOwnership: { cypherByRowListName: { rootRoleRowList: ROOT_OWNERSHIP_CYPHER }, secondReadFor: unreachedStableIdListByStandardFor, rowFor: rootOwnershipRowFor },
});

const runGraphStructureCheck = ({ session, checkNameList, sourceCodeListCensusByStandard } = {}, callback) => {
	const unknownCheckNameList = (checkNameList || []).filter((checkName) => !CHECK_BY_NAME[checkName]);
	if (!Array.isArray(checkNameList) || checkNameList.length === 0 || unknownCheckNameList.length > 0) {
		callback(`${moduleName}: checkNameList must name one or more of ${Object.keys(CHECK_BY_NAME).join(', ')}${unknownCheckNameList.length ? ` (unknown: ${unknownCheckNameList.join(', ')})` : ''}`);
		return;
	}
	if (!sourceCodeListCensusByStandard || typeof sourceCodeListCensusByStandard !== 'object') {
		callback(`${moduleName}: sourceCodeListCensusByStandard is REQUIRED — {} when no source census is to be compared (sourceCodeListCensusFor builds it)`);
		return;
	}
	const checkRowList = [];
	const nextCheck = (checkIndex) => {
		if (checkIndex >= checkNameList.length) {
			callback('', checkRowList);
			return;
		}
		const { cypherByRowListName, secondReadFor, rowFor } = CHECK_BY_NAME[checkNameList[checkIndex]];
		const rowListNameList = Object.keys(cypherByRowListName);
		const rowListByName = {};
		const nextCypher = (cypherIndex) => {
			if (cypherIndex >= rowListNameList.length) {
				if (secondReadFor === undefined) {
					checkRowList.push(rowFor({ ...rowListByName, sourceCodeListCensusByStandard }));
					nextCheck(checkIndex + 1);
					return;
				}
				secondReadFor({ session, rowListByName }, (secondReadError, secondReadResult) => {
					if (secondReadError) {
						callback(`${checkNameList[checkIndex]}: ${secondReadError}`);
						return;
					}
					checkRowList.push(rowFor({ ...rowListByName, ...secondReadResult, sourceCodeListCensusByStandard }));
					nextCheck(checkIndex + 1);
				});
				return;
			}
			runCypher(session, cypherByRowListName[rowListNameList[cypherIndex]], CYPHER_PARAMETERS, (cypherError, rowList) => {
				if (cypherError) {
					callback(`${checkNameList[checkIndex]}: ${cypherError}`);
					return;
				}
				rowListByName[rowListNameList[cypherIndex]] = rowList;
				nextCypher(cypherIndex + 1);
			});
		};
		nextCypher(0);
	};
	nextCheck(0);
};

// sourceCodeListCensusFor — the frozen source census of every standard whose FAMILY declares a rule, read from the forge
// tree; a declared census file that is absent or lacks a declared field is a refusal by name, never a skipped comparison
const fieldAt = (parsedCensus, fieldPathText) => fieldPathText.split('.').reduce((soFar, fieldName) => (soFar === undefined || soFar === null ? undefined : soFar[fieldName]), parsedCensus);
const sourceCodeListCensusFor = ({ treeRootPath, standardDefinitionRowList }) => {
	const sourceCodeListCensusByStandard = {};
	const refusalList = [];
	standardDefinitionRowList.forEach(({ sourceKey, standardKey, standardFamily }) => {
		const censusRule = CODE_LIST_SOURCE_CENSUS_RULE_BY_STANDARD_FAMILY[standardFamily];
		if (!censusRule) {
			return;
		}
		const censusFilePath = path.join(treeRootPath, censusRule.censusFilePathTemplate.replace('<standardKey>', standardKey));
		if (!fs.existsSync(censusFilePath)) {
			refusalList.push(`${sourceKey}: family ${standardFamily} declares a source census at ${censusFilePath}, which is absent`);
			return;
		}
		const parsedCensus = JSON.parse(fs.readFileSync(censusFilePath, 'utf8'));
		const sumOf = (fieldPathList) => fieldPathList.reduce((soFar, fieldPathText) => (Number.isInteger(fieldAt(parsedCensus, fieldPathText)) && soFar !== null ? soFar + fieldAt(parsedCensus, fieldPathText) : null), 0);
		const optionSetCount = sumOf(censusRule.optionSetCountFieldPathList);
		const optionValueCount = sumOf(censusRule.optionValueCountFieldPathList);
		if (optionSetCount === null || optionValueCount === null) {
			refusalList.push(`${sourceKey}: ${censusFilePath} lacks an integer at one of ${censusRule.optionSetCountFieldPathList.concat(censusRule.optionValueCountFieldPathList).join(', ')}`);
			return;
		}
		sourceCodeListCensusByStandard[sourceKey] = { optionSetCount, optionValueCount, censusFilePath: path.relative(treeRootPath, censusFilePath) };
	});
	return { sourceCodeListCensusByStandard, refusal: refusalList.length ? `${moduleName}: ${refusalList.join(' | ')}` : '' };
};

module.exports = {
	moduleName,
	PASS_VERDICT: vocabulary.BUILD_ATTESTATION_VERDICT.PASS,
	INSTANCE_OWNER_EDGE_TYPE_BY_LABEL_SUFFIX,
	CODE_LIST_SOURCE_CENSUS_RULE_BY_STANDARD_FAMILY,
	INSTANCE_STRUCTURE_CYPHER,
	DECLARATION_STRUCTURE_CYPHER,
	OPTION_VALUE_STRUCTURE_CYPHER,
	OPTION_SET_STRUCTURE_CYPHER,
	ROOT_OWNERSHIP_CYPHER,
	ROOT_OWNERSHIP_STABLE_ID_CYPHER,
	instanceStructureRowFor,
	codeListStructureRowFor,
	rootOwnershipRowFor,
	unreachedStableIdListFor,
	runGraphStructureCheck,
	sourceCodeListCensusFor,
};
