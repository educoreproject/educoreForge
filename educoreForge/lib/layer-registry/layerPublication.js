'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerPublication.js — the public renderings of registered layer versions (mappingLayers ML3-a/b; SPEC §2, §5; DESIGN-ML3a, rulings
// R-a..R-f and R-c' by BRONZE_CROWN 2026-10-25; TQ Q37). PURE and synchronous: frozen inputs in, text out; no store, no graph, no clock.
//
//   machineMemberRowsFor({ member, decisionBlock, cardByStableId })            → { memberRows } | { error }
//       one member block of a judge-layer version, its rows built by sssomExporter.blockRowsFor (the SAME code as the per-block export)
//       and then given their public form: subject_id the encoded CURIE (R-a), object_id the full IRI, subject_source the element base
//   machineVersionSetText({ layer, version, memberRowsList, publicFilter })  → { setText, rowCount, … } | { error }
//   curatedVersionSetText({ layer, version, wholeSetText, publicFilter })     → { setText, rowCount, … } | { error }
//       ONE SSSOM set per layer version (R-b): mapping_set_id = the pinned layer-version URI, mapping_set_version = the tag,
//       mapping_set_source = the version it was copied from (only when the registry records one), see_also = the frozen block URN(s)
//   registryDocumentText({ layer, registry, localNameByVersionTag, publicFilter })  → { documentText } | { error }
//   siteRegistryDocumentText({ layerKeyList, publicFilter })                       → { documentText } | { error }
//   contextDocumentTextList({ layer, version, subjectStableIdList, publicFilter }) → { contextDocumentList: [{ standardKey, documentText }] } | { error }
//   recordIdRecomputation({ setText })                                             → { checkedRowCount } | { error }   the identity gate, from the TEXT alone
//
// IDENTITY (SPEC §5.2, as ruled): record_id = edc:assertion/<scopeBlockHash>/<assertionHash>.
//   machine row:  scope = the member decision block;      assertionHash = sha256(subjectIri \n predicateIri \n objectIri)
//   curated row:  scope = the stored curated set block;   assertionHash = sha256(subjectIri \n predicateIri \n objectIri \n authorIri)
// Every IRI is the plain CURIE expansion of the row's own cell under the set's own curie_map, so a reader recomputes record_id from the
// row; recordIdRecomputation does exactly that, with no knowledge of how the row was made.
//
// A SET CARRIES NO STATUS: the effective registration status lives in the registry document (mapping_set_group), so a status change never
// changes a set's bytes. A PUBLIC FILTERED RENDERING (Q37) drops the rows whose subject belongs to a licence-held standard; it gets its
// own mapping_set_id (the version URI + '#publicFilter-<digest>') and a declared public_filter slot naming the filter, the excluded
// standards and the full version, so it can never be taken for the complete version set.

const crypto = require('crypto');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const edcUri = require(path.join(__dirname, '..', 'edc-uri', 'edcUri'));
const subjectCurieLib = require(path.join(__dirname, '..', 'edc-uri', 'subjectCurie'));
const assertionIdentity = require(path.join(__dirname, '..', 'edc-uri', 'assertionIdentity'));
const sssomExporterLib = require(path.join(__dirname, '..', 'bridge-framework', 'sssomExporter'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

const { blockRowsFor, parseSssomTsv, yamlScalar, COLUMN_LIST, RECORD_ID_COLUMN, JUDGED_SUBJECT_COLUMN, NO_TERM_FOUND_OBJECT_ID, EXTENSION_SLOT_NAME_LIST, EXTENSION_PROPERTY_BASE, MAPPING_SET_ID_URN_BASE, URN_SCHEME_PREFIX } = sssomExporterLib;
const { SSSOM_COLUMN_BY_EDGE_PROPERTY, MAPPING_PROPERTIES, JUDGE_SUMMARY_EDGE_PROPERTY_LIST, SSSOM_VERSION_FOR_ONE_ONE_SLOTS } = vocabularyLib;

// what this renderer writes, as data
const PUBLICATION_RULES = Object.freeze({
	sssomSchemaReleaseText: 'sssom-schema 1.1.0a5; validated with sssom-py 0.4.21', // R-e: the enum admits only 1.0 | 1.1, so the alpha is named here
	renderedBy: 'educoreForge lib/layer-registry/layerPublication.js (mappingLayers ML3)',
	machineProducerKindList: ['inferred'], // the registered machine layers are judge layers (measured: 45 of 45 member blocks)
	droppedMachineColumnList: ['subject_match_field', 'object_match_field'], // per-bridge, and their prefix (EDUcoreHub) names one hub per curie_map
	legacySubjectExpansionPattern: 'urn:educore:{standardKey}:', // what the pre-ML3 export expanded a subject prefix to (bridge-framework.js)
	legacyHubSourcePattern: 'urn:educore:hub:{hubName}:', // object_source, unchanged from the per-block export
	publicFilterFragmentPrefix: '#publicFilter-',
	authorIdSeparator: '|', // SSSOM/TSV multivalued cell separator
});
const ML3_SET_EXTENSION_SLOT_NAME_LIST = Object.freeze(['sssom_schema_release', 'legacy_curie_map', 'rendering_of']);
const MACHINE_ONLY_EXTENSION_SLOT_NAME_LIST = Object.freeze(['member_block_list']);
const PUBLIC_FILTER_SLOT_NAME = 'public_filter';
const CONTEXT_TERM_COLON_ESCAPE = '%3A';
const CONDITIONAL_COLUMN_ORDER = Object.freeze([JUDGED_SUBJECT_COLUMN, ...JUDGE_SUMMARY_EDGE_PROPERTY_LIST.map((onePropertyName) => SSSOM_COLUMN_BY_EDGE_PROPERTY[onePropertyName]), SSSOM_COLUMN_BY_EDGE_PROPERTY[MAPPING_PROPERTIES.MAPPING_RATIONALE]]);
const NO_TERM_FOUND_COLUMN_LIST = Object.freeze(['mapping_cardinality', 'comment']);
const BUILT_IN_EXPANSION_BY_PREFIX = Object.freeze({ skos: 'http://www.w3.org/2004/02/skos/core#', owl: 'http://www.w3.org/2002/07/owl#', semapv: 'https://w3id.org/semapv/vocab/', sssom: 'https://w3id.org/sssom/', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' });

const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const byCodePoint = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);
const tsvCell = (cellText) => (cellText === undefined || cellText === null ? '' : String(cellText).replace(/[\t\r\n]/g, ' '));
const prefixOf = (curieText) => curieText.slice(0, curieText.indexOf(':'));
const standardKeyOfPairKey = (pairKey) => pairKey.split('::')[1].split('@')[0];
const edcCurieOf = (edcIri) => (edcIri.indexOf(edcUri.URI_SCHEME.baseIri) === 0 ? `${edcUri.URI_SCHEME.curiePrefix}:${edcIri.slice(edcUri.URI_SCHEME.baseIri.length)}` : edcIri);
const mintUri = (partByName) => {
	const minted = edcUri.mint(partByName);
	return minted.error ? { error: minted.error } : { uri: minted.uri };
};

// publicFilterFor({ licenceHoldList, filterSourceText }) → { publicFilter } — the excluded standards, as data from the downloads rules
const publicFilterFor = ({ licenceHoldList, filterSourceText }) => {
	if (!Array.isArray(licenceHoldList) || licenceHoldList.length === 0 || !licenceHoldList.every((oneHold) => isNonEmptyString(oneHold.bundleToken)) || !isNonEmptyString(filterSourceText)) {
		return { error: refusalText('licenceHoldList is not a non-empty list of { bundleToken } with a named source', 'apps/graph-builder/lib/downloadArtifactsRules.json licenceHoldList (TQ Q37: the public tree excludes held standards)') };
	}
	const excludedStandardKeyList = licenceHoldList.map((oneHold) => oneHold.bundleToken).sort(byCodePoint);
	return { publicFilter: { excludedStandardKeyList, filterSource: filterSourceText, filterDigest: sha256Hex(excludedStandardKeyList.join('\n')).slice(0, 12) } };
};

const versionUriFor = (layer, version) => mintUri({ kind: 'layerVersion', layerKey: layer.layerKey, versionTag: version.administrationRecord.versionTag });

// headerListLines(slotName, valueList) — a multivalued set slot as a YAML list, every scalar quoted
const headerListLines = (slotName, valueList) => [`#${slotName}:`].concat(valueList.map((oneValue) => `#  - ${yamlScalar(oneValue)}`));

const extensionDefinitionLines = (slotNameList) =>
	['#extension_definitions:'].concat(slotNameList.reduce((soFar, oneSlot) => soFar.concat([`#  - slot_name: ${yamlScalar(oneSlot)}`, `#    property: ${yamlScalar(`${EXTENSION_PROPERTY_BASE}${oneSlot}`)}`, `#    type_hint: ${yamlScalar('xsd:string')}`]), []));

const tsvBodyText = (columnList, rowList) => `${columnList.join('\t')}\n${rowList.map((oneRow) => columnList.map((oneColumn) => tsvCell(oneRow[oneColumn])).join('\t')).join('\n')}${rowList.length ? '\n' : ''}`;

// ---------------------------------------------------------------------------------------------------------------------------
// machine (judge) layer versions
// ---------------------------------------------------------------------------------------------------------------------------

const machineMemberRowsFor = ({ member, decisionBlock, cardByStableId } = {}) => {
	if (!member || !isNonEmptyString(member.pairKey) || !decisionBlock || !decisionBlock.header || !Array.isArray(decisionBlock.decisionRecordList)) {
		return { error: refusalText('a member needs { pairKey, decisionBlockHash } and its parsed decision block', 'machineMemberRowsFor({ member, decisionBlock, cardByStableId })') };
	}
	const { header } = decisionBlock;
	if (PUBLICATION_RULES.machineProducerKindList.indexOf(header.producerKind) === -1) {
		return { error: refusalText(`member ${member.pairKey} has producerKind '${header.producerKind}'`, `a machine layer version renders judge blocks only (${PUBLICATION_RULES.machineProducerKindList.join(', ')}); an authored block is in no registered layer`) };
	}
	const standardName = header.sourceStandardName;
	const standardVersion = String(header.sourceVersion);
	const hubName = header.hubName;
	const hubVersion = String(header.hubVersion);
	const fromStableIdList = decisionBlock.decisionRecordList.reduce((soFar, oneRecord) => soFar.concat(oneRecord.instanceStableIdList === undefined ? [oneRecord.subjectStableId] : oneRecord.instanceStableIdList), []);
	const subjectCuriePrefixList = Array.from(new Set(fromStableIdList.map(prefixOf))).sort(byCodePoint);
	const objectSourceIri = PUBLICATION_RULES.legacyHubSourcePattern.replace('{hubName}', hubName);
	const blockRows = blockRowsFor({
		decisionBlock,
		decisionBlockHash: member.decisionBlockHash,
		cardByStableId,
		setLevelSlots: { subjectSource: standardName, subjectSourceVersion: standardVersion, objectSource: hubName, objectSourceVersion: hubVersion, objectMatchField: '' },
		subjectCuriePrefixList,
		exportProducerKind: header.producerKind,
		subjectSourceIri: '',
		objectSourceIri,
	});
	if (blockRows.error) {
		return { error: `${moduleName}: member ${member.pairKey}: ${blockRows.error}` };
	}
	const subjectExpansionByPrefix = {};
	const rowList = [];
	for (let rowIndex = 0; rowIndex < blockRows.rowList.length; rowIndex++) {
		const oneRow = blockRows.rowList[rowIndex];
		const subjectIdentity = subjectCurieLib.subjectCurieFor({ stableId: oneRow.subject_id, standardName, standardVersion });
		if (subjectIdentity.error) {
			return { error: `${moduleName}: member ${member.pairKey}: ${subjectIdentity.error}` };
		}
		subjectExpansionByPrefix[subjectIdentity.prefix] = subjectIdentity.expansion;
		const judgedIdentity = isNonEmptyString(oneRow[JUDGED_SUBJECT_COLUMN]) ? subjectCurieLib.subjectCurieFor({ stableId: oneRow[JUDGED_SUBJECT_COLUMN], standardName, standardVersion }) : { subjectCurie: '' };
		if (judgedIdentity.error) {
			return { error: `${moduleName}: member ${member.pairKey}: judged subject: ${judgedIdentity.error}` };
		}
		const objectIdentity = oneRow.object_id === NO_TERM_FOUND_OBJECT_ID ? { iri: NO_TERM_FOUND_OBJECT_ID } : assertionIdentity.nodeIriFor({ stableId: oneRow.object_id, standardName: hubName, standardVersion: hubVersion });
		if (objectIdentity.error) {
			return { error: `${moduleName}: member ${member.pairKey}: object: ${objectIdentity.error}` };
		}
		const publicRow = { ...oneRow, subject_id: subjectIdentity.subjectCurie, subject_source: subjectIdentity.expansion, object_id: objectIdentity.iri, [JUDGED_SUBJECT_COLUMN]: judgedIdentity.subjectCurie };
		PUBLICATION_RULES.droppedMachineColumnList.forEach((oneColumn) => {
			delete publicRow[oneColumn];
		});
		rowList.push({ row: publicRow, subjectStableId: oneRow.subject_id });
	}
	return {
		memberRows: {
			member: { pairKey: member.pairKey, decisionBlockHash: member.decisionBlockHash },
			standardKey: standardKeyOfPairKey(member.pairKey),
			standardName,
			standardVersion,
			blockHeaderSummary: { bridgeName: header.bridgeName, pluginVersion: header.pluginVersion, declarationDigest: header.declarationDigest, judgeKind: header.judgeKind, frameworkFingerprint: header.frameworkFingerprint },
			conditionalColumnList: blockRows.conditionalColumnList,
			hasNoTermFound: blockRows.noTermFoundPlannedList.length > 0,
			subjectExpansionByPrefix,
			rowList,
		},
	};
};

// assembleSetText — the parts every rendering shares: identity slots, curie_map, extensions, body
const assembleSetText = ({ versionUri, version, layer, publicFilter, curieMap, legacyCurieMap, headerExtraLineList, extensionSlotNameList, seeAlsoList, renderingOf, columnList, rowList }) => {
	const mappingSetId = publicFilter === undefined ? versionUri : `${versionUri}${PUBLICATION_RULES.publicFilterFragmentPrefix}${publicFilter.filterDigest}`;
	const declaredSlotNameList = extensionSlotNameList.concat(publicFilter === undefined ? [] : [PUBLIC_FILTER_SLOT_NAME]);
	const headerLineList = [
		'#curie_map:',
		...Object.keys(curieMap)
			.sort(byCodePoint)
			.map((onePrefix) => `#  ${onePrefix}: ${yamlScalar(curieMap[onePrefix])}`),
		`#mapping_set_id: ${yamlScalar(mappingSetId)}`,
		`#mapping_set_version: ${yamlScalar(version.administrationRecord.versionTag)}`,
		`#mapping_set_title: ${yamlScalar(`${layer.displayName}, version ${version.administrationRecord.versionTag}${publicFilter === undefined ? '' : ' (public filtered rendering)'}`)}`,
		...(isNonEmptyString(version.copiedFromLayerVersion) ? headerListLines('mapping_set_source', [version.copiedFromLayerVersion]) : []),
		...headerListLines('see_also', seeAlsoList),
		`#sssom_version: ${yamlScalar(SSSOM_VERSION_FOR_ONE_ONE_SLOTS)}`,
		...extensionDefinitionLines(declaredSlotNameList),
		...headerExtraLineList,
		`#sssom_schema_release: ${yamlScalar(PUBLICATION_RULES.sssomSchemaReleaseText)}`,
		`#legacy_curie_map: ${yamlScalar(JSON.stringify(legacyCurieMap))}`,
		`#rendering_of: ${yamlScalar(JSON.stringify(renderingOf))}`,
		...(publicFilter === undefined ? [] : [`#${PUBLIC_FILTER_SLOT_NAME}: ${yamlScalar(JSON.stringify({ ...publicFilter, fullVersionId: versionUri, fullVersionContentId: version.administrationRecord.contentId, note: 'rows whose subject belongs to an excluded standard are OMITTED; this file is NOT the complete version set' }))}`]),
	];
	return { setText: `${headerLineList.join('\n')}\n${tsvBodyText(columnList, rowList)}`, mappingSetId };
};

const machineVersionSetText = ({ layer, version, memberRowsList, publicFilter } = {}) => {
	if (!layer || !version || !Array.isArray(memberRowsList) || memberRowsList.length !== (version.memberBlockList || []).length) {
		return { error: refusalText('every member block of the version must be rendered, in registry order', 'machineVersionSetText({ layer, version, memberRowsList, publicFilter })') };
	}
	const memberOrderRefusal = memberRowsList.find((oneMemberRows, memberIndex) => oneMemberRows.member.decisionBlockHash !== version.memberBlockList[memberIndex].decisionBlockHash);
	if (memberOrderRefusal !== undefined) {
		return { error: refusalText(`member ${memberOrderRefusal.member.pairKey} is out of registry order`, 'the rendering follows memberBlockList so the same registry gives the same bytes') };
	}
	const versionMint = versionUriFor(layer, version);
	if (versionMint.error) {
		return versionMint;
	}
	const isPublished = (oneMemberRows) => publicFilter === undefined || publicFilter.excludedStandardKeyList.indexOf(oneMemberRows.standardKey) === -1;
	const keptMemberRowsList = memberRowsList.filter(isPublished);
	const curieMap = { [URN_SCHEME_PREFIX]: `${URN_SCHEME_PREFIX}:`, [edcUri.URI_SCHEME.curiePrefix]: edcUri.URI_SCHEME.baseIri };
	const legacyCurieMap = {};
	for (let memberIndex = 0; memberIndex < keptMemberRowsList.length; memberIndex++) {
		const oneMemberRows = keptMemberRowsList[memberIndex];
		const conflictPrefix = Object.keys(oneMemberRows.subjectExpansionByPrefix).find((onePrefix) => curieMap[onePrefix] !== undefined && curieMap[onePrefix] !== oneMemberRows.subjectExpansionByPrefix[onePrefix]);
		if (conflictPrefix !== undefined) {
			return { error: refusalText(`subject prefix '${conflictPrefix}' expands to ${curieMap[conflictPrefix]} and ${oneMemberRows.subjectExpansionByPrefix[conflictPrefix]} in one version`, 'one curie_map holds one expansion per prefix: a version holding two versions of one standard cannot be one set') };
		}
		Object.keys(oneMemberRows.subjectExpansionByPrefix).forEach((onePrefix) => {
			curieMap[onePrefix] = oneMemberRows.subjectExpansionByPrefix[onePrefix];
			legacyCurieMap[onePrefix] = PUBLICATION_RULES.legacySubjectExpansionPattern.replace('{standardKey}', oneMemberRows.standardKey);
		});
	}
	const conditionalColumnList = CONDITIONAL_COLUMN_ORDER.filter((oneColumn) => keptMemberRowsList.some((oneMemberRows) => oneMemberRows.conditionalColumnList.indexOf(oneColumn) !== -1));
	const hasNoTermFound = keptMemberRowsList.some((oneMemberRows) => oneMemberRows.hasNoTermFound);
	const columnList = COLUMN_LIST.filter((oneColumn) => PUBLICATION_RULES.droppedMachineColumnList.indexOf(oneColumn) === -1).concat(conditionalColumnList, [RECORD_ID_COLUMN], hasNoTermFound ? NO_TERM_FOUND_COLUMN_LIST : []);
	const rowList = keptMemberRowsList.reduce((soFar, oneMemberRows) => soFar.concat(oneMemberRows.rowList.map((oneEntry) => oneEntry.row)), []);
	const memberBlockList = memberRowsList.map((oneMemberRows) => ({ ...oneMemberRows.member, standardKey: oneMemberRows.standardKey, ...oneMemberRows.blockHeaderSummary, rowCount: oneMemberRows.rowList.length, rowsInThisFile: isPublished(oneMemberRows) }));
	const extensionSlotNameList = ['source_label', 'predicate_asserted_by'].concat(conditionalColumnList, ML3_SET_EXTENSION_SLOT_NAME_LIST, MACHINE_ONLY_EXTENSION_SLOT_NAME_LIST);
	const unknownExtension = extensionSlotNameList.find((oneSlot) => EXTENSION_SLOT_NAME_LIST.concat(CONDITIONAL_COLUMN_ORDER, ML3_SET_EXTENSION_SLOT_NAME_LIST, MACHINE_ONLY_EXTENSION_SLOT_NAME_LIST).indexOf(oneSlot) === -1);
	if (unknownExtension !== undefined) {
		return { error: refusalText(`extension slot '${unknownExtension}' is not one this renderer declares`, 'every non-standard slot is declared under extension_definitions') };
	}
	const assembled = assembleSetText({
		versionUri: versionMint.uri,
		version,
		layer,
		publicFilter,
		curieMap,
		legacyCurieMap,
		// creator_id as an edc CURIE: sssom-py 0.4.21 refuses a set-level entity slot it cannot contract (measured: 'incorrect value' on the IRI)
		headerExtraLineList: [`#creator_id:`, `#  - ${yamlScalar(edcCurieOf(version.authorAgentIri))}`, `#member_block_list: ${yamlScalar(JSON.stringify(memberBlockList))}`],
		extensionSlotNameList,
		seeAlsoList: version.memberBlockList.map((oneMember) => `${MAPPING_SET_ID_URN_BASE}${oneMember.decisionBlockHash}`),
		renderingOf: { layerVersion: versionMint.uri, contentId: version.administrationRecord.contentId, contentIdBasis: version.contentIdBasis, renderedBy: PUBLICATION_RULES.renderedBy, statusNote: 'the registration status is in the registry document, never in a set (a status change must not change a set\'s bytes)' },
		columnList,
		rowList,
	});
	const subjectStableIdList = Array.from(new Set(keptMemberRowsList.reduce((soFar, oneMemberRows) => soFar.concat(oneMemberRows.rowList.map((oneEntry) => oneEntry.subjectStableId)), []))).sort(byCodePoint);
	return { setText: assembled.setText, mappingSetId: assembled.mappingSetId, rowCount: rowList.length, fullRowCount: memberRowsList.reduce((soFar, oneMemberRows) => soFar + oneMemberRows.rowList.length, 0), subjectStableIdList };
};

// ---------------------------------------------------------------------------------------------------------------------------
// curated (human) layer versions: a RENDERING of the stored set, whose block hash is the version's content id (R-c)
// ---------------------------------------------------------------------------------------------------------------------------

const curatedVersionSetText = ({ layer, version, wholeSetText, publicFilter } = {}) => {
	if (!layer || !version || version.contentIdBasis !== 'frozenSetBytes' || !isNonEmptyString(wholeSetText)) {
		return { error: refusalText('a curated version renders from its stored whole-set text (contentIdBasis frozenSetBytes)', 'curatedVersionSetText({ layer, version, wholeSetText, publicFilter })') };
	}
	const contentId = version.administrationRecord.contentId;
	if (sha256Hex(wholeSetText) !== contentId) {
		return { error: refusalText(`the whole-set text hashes to ${sha256Hex(wholeSetText)}, not the version's content id ${contentId}`, 'the rendering is OF the stored version; its bytes are verified, never trusted') };
	}
	const parsed = parseSssomTsv(wholeSetText);
	if (parsed.error) {
		return { error: `${moduleName}: ${layer.layerKey}: ${parsed.error}` };
	}
	const versionMint = versionUriFor(layer, version);
	if (versionMint.error) {
		return versionMint;
	}
	const standardByStandardKey = layer.standardList.reduce((soFar, oneStandard) => ({ ...soFar, [oneStandard.standardKey]: oneStandard }), {});
	const hub = layer.hubList.length === 1 ? layer.hubList[0] : undefined;
	if (hub === undefined) {
		return { error: refusalText(`layer '${layer.layerKey}' names ${layer.hubList.length} hubs`, 'a curated rendering resolves objects against its ONE hub (the rater layer answers CEDS)') };
	}
	const objectSourceVersion = parsed.headerScalarOf('object_source_version');
	const curieMap = { [URN_SCHEME_PREFIX]: `${URN_SCHEME_PREFIX}:` };
	const legacyCurieMap = {};
	const rowList = [];
	const subjectStableIdList = [];
	for (let rowIndex = 0; rowIndex < parsed.rowList.length; rowIndex++) {
		const oneRow = parsed.rowList[rowIndex];
		const standardKey = prefixOf(oneRow.subject_id);
		const standard = standardByStandardKey[standardKey];
		if (standard === undefined || !isNonEmptyString(oneRow.subject_source_version)) {
			return { error: refusalText(`row ${rowIndex + 1} subject ${oneRow.subject_id} names a standard the layer does not list, or no subject_source_version`, `recipes/layers.json layer '${layer.layerKey}' standardList`) };
		}
		if (publicFilter !== undefined && publicFilter.excludedStandardKeyList.indexOf(standardKey) !== -1) {
			continue;
		}
		const subjectIdentity = subjectCurieLib.subjectCurieFor({ stableId: oneRow.subject_id, standardName: standard.standardName, standardVersion: oneRow.subject_source_version });
		if (subjectIdentity.error) {
			return { error: `${moduleName}: ${layer.layerKey} row ${rowIndex + 1}: ${subjectIdentity.error}` };
		}
		const identity = assertionIdentity.curatedAssertionIdFor({
			decisionBlockHash: contentId,
			subjectStableId: oneRow.subject_id,
			subjectStandardName: standard.standardName,
			subjectStandardVersion: oneRow.subject_source_version,
			predicateCurie: oneRow.predicate_id,
			objectStableId: oneRow.object_id,
			objectStandardName: hub.hubName,
			objectStandardVersion: objectSourceVersion,
			authorIdList: isNonEmptyString(oneRow.author_id) ? oneRow.author_id.split(PUBLICATION_RULES.authorIdSeparator) : [],
		});
		if (identity.error) {
			return { error: `${moduleName}: ${layer.layerKey} row ${rowIndex + 1}: ${identity.error}` };
		}
		curieMap[subjectIdentity.prefix] = subjectIdentity.expansion;
		legacyCurieMap[subjectIdentity.prefix] = oneRow.subject_source;
		rowList.push({ ...oneRow, subject_id: subjectIdentity.subjectCurie, subject_source: subjectIdentity.expansion, [RECORD_ID_COLUMN]: identity.assertionId });
		subjectStableIdList.push(oneRow.subject_id);
	}
	// the stored set's own prefixes that are not subject prefixes (edc for the predicates, urn already) are carried over as declared
	const storedCurieMap = parsed.headerLineList.reduce((soFar, oneLine) => {
		const matched = /^#  ([A-Za-z_][A-Za-z0-9_]*): (".*")$/.exec(oneLine);
		return matched ? { ...soFar, [matched[1]]: JSON.parse(matched[2]) } : soFar;
	}, {});
	Object.keys(storedCurieMap)
		.filter((onePrefix) => standardByStandardKey[onePrefix] === undefined)
		.forEach((onePrefix) => {
			curieMap[onePrefix] = storedCurieMap[onePrefix];
		});
	const recordIdList = rowList.map((oneRow) => oneRow[RECORD_ID_COLUMN]);
	if (new Set(recordIdList).size !== recordIdList.length) {
		return { error: refusalText(`${layer.layerKey}: record_id is not unique (${recordIdList.length} rows, ${new Set(recordIdList).size} distinct)`, "SSSOM 1.1: record_id is unique within a set (ruling R-c': the author term separates two authors of one triple)") };
	}
	const carriedSlotLineList = ['mapping_provider', 'object_source', 'object_source_version', 'comment'].filter((oneSlot) => parsed.headerScalarOf(oneSlot) !== undefined).map((oneSlot) => `#${oneSlot}: ${yamlScalar(parsed.headerScalarOf(oneSlot))}`);
	const assembled = assembleSetText({
		versionUri: versionMint.uri,
		version,
		layer,
		publicFilter,
		curieMap,
		legacyCurieMap,
		headerExtraLineList: carriedSlotLineList,
		extensionSlotNameList: ML3_SET_EXTENSION_SLOT_NAME_LIST.slice(),
		seeAlsoList: [`${MAPPING_SET_ID_URN_BASE}${contentId}`],
		renderingOf: { layerVersion: versionMint.uri, contentId, contentIdBasis: version.contentIdBasis, renderedBy: PUBLICATION_RULES.renderedBy, statusNote: 'the registration status is in the registry document, never in a set (a status change must not change a set\'s bytes)' },
		columnList: parsed.columnList.concat([RECORD_ID_COLUMN]),
		rowList,
	});
	return { setText: assembled.setText, mappingSetId: assembled.mappingSetId, rowCount: rowList.length, fullRowCount: parsed.rowList.length, subjectStableIdList: Array.from(new Set(subjectStableIdList)).sort(byCodePoint) };
};

// ---------------------------------------------------------------------------------------------------------------------------
// the identity gate, from the text alone
// ---------------------------------------------------------------------------------------------------------------------------

// recordIdRecomputation({ setText }) → { checkedRowCount } | { error }: every row's record_id recomputed from the row and the set's
// curie_map; a row with ONE author_id takes the curated recipe, a row with none the machine recipe, several are refused
const recordIdRecomputation = ({ setText } = {}) => {
	const parsed = parseSssomTsv(setText);
	if (parsed.error) {
		return { error: `${moduleName}: ${parsed.error}` };
	}
	const curieMap = parsed.headerLineList.reduce((soFar, oneLine) => {
		const matched = /^#  ([A-Za-z_][A-Za-z0-9_]*): (".*")$/.exec(oneLine);
		return matched ? { ...soFar, [matched[1]]: JSON.parse(matched[2]) } : soFar;
	}, {});
	const expand = (cellText) => {
		if (/^https?:\/\//.test(cellText)) {
			return cellText;
		}
		const prefix = prefixOf(cellText);
		const expansion = curieMap[prefix] !== undefined ? curieMap[prefix] : BUILT_IN_EXPANSION_BY_PREFIX[prefix];
		return expansion === undefined ? undefined : `${expansion}${cellText.slice(prefix.length + 1)}`;
	};
	for (let rowIndex = 0; rowIndex < parsed.rowList.length; rowIndex++) {
		const oneRow = parsed.rowList[rowIndex];
		const recordIdMatch = /\/assertion\/([0-9a-f]{64})\/([0-9a-f]{64})$/.exec(oneRow[RECORD_ID_COLUMN] || '');
		const authorList = isNonEmptyString(oneRow.author_id) ? oneRow.author_id.split(PUBLICATION_RULES.authorIdSeparator) : [];
		const iriList = [expand(oneRow.subject_id), expand(oneRow.predicate_id), expand(oneRow.object_id)].concat(authorList.length === 1 ? [authorList[0]] : []);
		if (recordIdMatch === null || authorList.length > 1 || iriList.some((oneIri) => oneIri === undefined)) {
			return { error: refusalText(`row ${rowIndex + 1} (${oneRow.subject_id}) has no recomputable record_id (record_id ${JSON.stringify(oneRow[RECORD_ID_COLUMN])}, ${authorList.length} author(s))`, 'every row carries an edc assertion record_id over curie_map-expandable cells') };
		}
		if (sha256Hex(iriList.join('\n')) !== recordIdMatch[2]) {
			return { error: refusalText(`row ${rowIndex + 1} (${oneRow.subject_id}): record_id ${oneRow[RECORD_ID_COLUMN]} does not recompute from the row`, 'SPEC §5.2: sha256 over the expanded IRIs (and the one author, for a curated row)') };
		}
	}
	return { checkedRowCount: parsed.rowList.length };
};

// ---------------------------------------------------------------------------------------------------------------------------
// registry documents (SSSOM `mapping registry`, validated by linkml against sssom-schema) and JSON-LD contexts
// ---------------------------------------------------------------------------------------------------------------------------

const REGISTRY_DESCRIPTION_TEXT = 'EDUcore mapping-layer registry. Each mapping_set_reference is one frozen layer version: mapping_set_id is its pinned tag URI; mirror_from is its content-addressed URI (layer/<key>/sha256/<contentId>); mapping_set_group is its EFFECTIVE ISO/IEC 11179 registration status (the latest statusChangeList entry, else the status it was published with); last_updated is the date of that status; local_name is the rendered set beside this document. No URI resolves publicly yet (no w3id registration).';

const registryDocumentText = ({ layer, registry, localNameByVersionTag, publicFilter } = {}) => {
	const layerMint = mintUri({ kind: 'layer', layerKey: layer.layerKey });
	if (layerMint.error) {
		return layerMint;
	}
	const referenceLineList = [];
	for (let versionIndex = 0; versionIndex < layer.versionList.length; versionIndex++) {
		const oneVersion = layer.versionList[versionIndex];
		const { versionTag, contentId, publishedAt } = oneVersion.administrationRecord;
		const versionMint = versionUriFor(layer, oneVersion);
		const contentMint = mintUri({ kind: 'layerVersionByContent', layerKey: layer.layerKey, contentId });
		const effective = registry.effectiveStatusFor({ layerKey: layer.layerKey, versionTag });
		const firstError = [versionMint, contentMint, effective].find((oneResult) => oneResult.error !== undefined);
		if (firstError !== undefined) {
			return { error: firstError.error };
		}
		if (!isNonEmptyString(localNameByVersionTag[versionTag])) {
			return { error: refusalText(`no rendered set is named for ${layer.layerKey}/${versionTag}`, 'every listed version points at its rendered set') };
		}
		const statusChangeList = layer.statusChangeList.filter((oneChange) => oneChange.versionTag === versionTag);
		const statusDate = (statusChangeList.length ? statusChangeList[statusChangeList.length - 1].changedAt : publishedAt).slice(0, 10);
		const mappingSetId = publicFilter === undefined ? versionMint.uri : `${versionMint.uri}${PUBLICATION_RULES.publicFilterFragmentPrefix}${publicFilter.filterDigest}`;
		referenceLineList.push(`  - mapping_set_id: ${yamlScalar(mappingSetId)}`, `    mirror_from: ${yamlScalar(contentMint.uri)}`, `    mapping_set_group: ${yamlScalar(effective.registrationStatus)}`, `    last_updated: ${yamlScalar(statusDate)}`, `    local_name: ${yamlScalar(localNameByVersionTag[versionTag])}`);
	}
	const documentText = [
		`mapping_registry_id: ${yamlScalar(layerMint.uri)}`,
		`mapping_registry_title: ${yamlScalar(`${layer.displayName}${publicFilter === undefined ? '' : ' (public filtered renderings)'}`)}`,
		`mapping_registry_description: ${yamlScalar(`${REGISTRY_DESCRIPTION_TEXT}${publicFilter === undefined ? '' : ` PUBLIC FILTERED: every set listed here omits the rows whose subject belongs to ${publicFilter.excludedStandardKeyList.join(', ')} (${publicFilter.filterSource}); its own public_filter slot names the full version.`}`)}`,
		'mapping_set_references:',
		...referenceLineList,
	].join('\n');
	return { documentText: `${documentText}\n` };
};

const siteRegistryDocumentText = ({ layerKeyList, publicFilter } = {}) => {
	const siteMint = mintUri({ kind: 'siteLayerRegistry' });
	const layerMintList = layerKeyList.map((layerKey) => mintUri({ kind: 'layer', layerKey }));
	const firstError = [siteMint].concat(layerMintList).find((oneResult) => oneResult.error !== undefined);
	if (firstError !== undefined) {
		return { error: firstError.error };
	}
	const documentText = [
		`mapping_registry_id: ${yamlScalar(siteMint.uri)}`,
		`mapping_registry_title: ${yamlScalar(`EDUcore mapping layers${publicFilter === undefined ? '' : ' (public filtered renderings)'}`)}`,
		`mapping_registry_description: ${yamlScalar('Every EDUcore mapping layer; each import is one layer\'s registry, whose id is the layer\'s floating URI (layer/<key>) and which lists its versions.')}`,
		'imports:',
		...layerMintList.map((oneMint) => `  - ${yamlScalar(oneMint.uri)}`),
	].join('\n');
	return { documentText: `${documentText}\n` };
};

// contextDocumentTextList — one JSON-LD context per (layer version, standard): term = the element's local part, segment-encoded AND with
// ':' encoded as %3A (PESC local parts carry 'urn:org:pesc:…'; a term holding ':' or '/' would be read as an IRI), mapped to the element's
// PINNED interpretation URI under this version (SPEC §5.3). The term decodes back to the local part.
const contextDocumentTextList = ({ layer, version, subjectStableIdList, standardNameByStandardKey, standardVersionByStandardKey, publicFilter } = {}) => {
	const stableIdListByStandardKey = subjectStableIdList.reduce((soFar, oneStableId) => {
		const standardKey = prefixOf(oneStableId);
		return { ...soFar, [standardKey]: (soFar[standardKey] || []).concat([oneStableId]) };
	}, {});
	const contextDocumentList = [];
	const standardKeyList = Object.keys(stableIdListByStandardKey).sort(byCodePoint).filter((standardKey) => publicFilter === undefined || publicFilter.excludedStandardKeyList.indexOf(standardKey) === -1);
	for (let standardIndex = 0; standardIndex < standardKeyList.length; standardIndex++) {
		const standardKey = standardKeyList[standardIndex];
		const standardName = standardNameByStandardKey[standardKey];
		const standardVersion = standardVersionByStandardKey[standardKey];
		if (!isNonEmptyString(standardName) || !isNonEmptyString(standardVersion)) {
			return { error: refusalText(`standard '${standardKey}' has no name or version for its context`, 'the interpretation URI is minted from the standard name and version') };
		}
		const termDefinitionByTerm = {};
		const stableIdList = stableIdListByStandardKey[standardKey].slice().sort(byCodePoint);
		for (let elementIndex = 0; elementIndex < stableIdList.length; elementIndex++) {
			const oneStableId = stableIdList[elementIndex];
			const encodedLocal = edcUri.encodeSegment(oneStableId.slice(standardKey.length + 1));
			if (encodedLocal.error) {
				return { error: encodedLocal.error };
			}
			const termText = encodedLocal.segmentText.split(':').join(CONTEXT_TERM_COLON_ESCAPE);
			const interpretationMint = mintUri({ kind: 'interpretationPinned', standardName, standardVersion, elementStableId: oneStableId, layerKey: layer.layerKey, versionTag: version.administrationRecord.versionTag });
			if (interpretationMint.error) {
				return interpretationMint;
			}
			if (termDefinitionByTerm[termText] !== undefined) {
				return { error: refusalText(`two elements of ${standardKey} give the term ${termText}`, 'one term, one element') };
			}
			termDefinitionByTerm[termText] = { '@id': interpretationMint.uri };
		}
		contextDocumentList.push({ standardKey, documentText: `${JSON.stringify({ '@context': { '@version': 1.1, ...termDefinitionByTerm } }, null, '\t')}\n` });
	}
	return { contextDocumentList };
};

module.exports = { machineMemberRowsFor, machineVersionSetText, curatedVersionSetText, recordIdRecomputation, registryDocumentText, siteRegistryDocumentText, contextDocumentTextList, publicFilterFor, PUBLICATION_RULES, moduleName };
