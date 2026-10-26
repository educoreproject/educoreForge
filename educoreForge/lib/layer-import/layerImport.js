'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// layerImport.js — an outside SSSOM/TSV set becomes a new version of an `imported-<slug>` mapping layer (mappingLayers ML3-c; SPEC §2
// "Import", §4.2, D-PROFILE, D-STORE). It resolves, freezes and registers; it materialises nothing (no relationship schema block) and
// touches no graph: the gold is read from a capture file (layerPublicationCli -captureGold).
//
//   resolveImportRows({ sssomText, prefixExpansionByPrefix, goldCapture, importRules })
//       → { acceptedList: [{ rowNumber, row, subjectStableId, standardName, standardVersion, subjectIri, predicateIri, objectIri, isAbstention }],
//           refusalList: [{ rowNumber, subject_id, predicate_id, object_id, reasonCode, reasonText }], columnList, rowCount } | { error }
//       PURE. Every row is accepted or refused BY NAME with its own reason (importRules.json refusalReasonList); none is dropped,
//       none is guessed. A CURIE resolves only through the DECLARED prefix map (plus SSSOM's built-ins), never the file's own curie_map:
//       an outside file's prefixes are its author's claim, the declaration is ours.
//   importLayer({ sssomText, sssomPath, slug, versionTag, authorIri, prefixMapDeclaration, goldCapture, registry, decisionStore,
//                 publishedAt, validateWithSssomPy, importRules }, cb)
//       → cb('', { layerKey, contentId, layerVersionUri, alreadyPresent, acceptedRowCount, refusedRowCount, refusalList, sssomPyVerdict,
//                  wholeSetBlock, layerRegistry }) — the frozen text is the file's EXACT bytes and its sha256 is the version id; the
//       block is stored under layerSet::imported-<slug> (producerKind imported); the layer (appended once) and the version (Candidate)
//       are appended through the registry's own append path, exactly as -publishLayer appends; identical bytes report alreadyPresent.

const crypto = require('crypto');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const edcUri = require(path.join(__dirname, '..', 'edc-uri', 'edcUri'));
const { registryFor, LAYER_REGISTRY_SCHEMA } = require(path.join(__dirname, '..', 'layer-registry', 'layerRegistry'));

const LAYER_SET_PAIR_KEY_PREFIX = 'layerSet::';
const MANDATORY_COLUMN_LIST = Object.freeze(['subject_id', 'predicate_id', 'object_id', 'mapping_justification']);

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const byCodePoint = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);

// tsvTableOf(sssomText) → { columnList, rowCellListList } | { error }: the body only; the metadata block is the author's, not read here
const tsvTableOf = (sssomText) => {
	const bodyLineList = sssomText.split('\n').filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
	if (bodyLineList.length === 0) {
		return { error: refusalText('the file has no column line', 'SSSOM/TSV: a metadata block, then a column line, then rows') };
	}
	const columnList = bodyLineList[0].split('\t');
	const absentColumn = MANDATORY_COLUMN_LIST.find((oneColumn) => columnList.indexOf(oneColumn) === -1);
	if (absentColumn !== undefined) {
		return { error: refusalText(`mandatory column '${absentColumn}' is absent`, `SSSOM requires ${MANDATORY_COLUMN_LIST.join(', ')}`) };
	}
	return { columnList, rowCellListList: bodyLineList.slice(1).map((oneLine) => oneLine.split('\t')) };
};

const resolveImportRows = ({ sssomText, prefixExpansionByPrefix, goldCapture, importRules } = {}) => {
	if (!isNonEmptyString(sssomText) || !isPlainObject(prefixExpansionByPrefix) || !goldCapture || !Array.isArray(goldCapture.edgeSubjectVersionList) || !importRules) {
		return { error: refusalText('sssomText, prefixExpansionByPrefix, goldCapture (with its edgeSubjectVersionList) and importRules are required', 'resolveImportRows({ … }); nothing is defaulted; re-capture an older gold capture') };
	}
	const table = tsvTableOf(sssomText);
	if (table.error) {
		return table;
	}
	const expansionByPrefix = { ...importRules.builtInPrefixExpansion, ...prefixExpansionByPrefix };
	const sourceNameSetByStableId = goldCapture.elementList.reduce((soFar, oneElement) => {
		if (soFar[oneElement.stableId] === undefined) {
			soFar[oneElement.stableId] = new Set();
		}
		soFar[oneElement.stableId].add(oneElement.sourceName);
		return soFar;
	}, {});
	// a standard's admissible versions: its root's version AND every subject version the gold's own match edges stamp (SEDM's root says
	// 'unknown', its edges 'unknown_01': an assertion id hashes the edge's version, so an element IRI may carry either)
	const versionSetByStandardName = {};
	goldCapture.standardList.concat(goldCapture.edgeSubjectVersionList).forEach((oneStandard) => {
		versionSetByStandardName[oneStandard.standardName] = versionSetByStandardName[oneStandard.standardName] || new Set();
		versionSetByStandardName[oneStandard.standardName].add(oneStandard.standardVersion);
	});
	const cardUriSet = new Set(goldCapture.cardList.map((oneCard) => oneCard.uri));
	const predicateIriSet = new Set(importRules.predicateIriList);
	const expandCell = (cellText) => {
		if (/^https?:\/\//.test(cellText)) {
			return { iri: cellText };
		}
		const separatorIndex = cellText.indexOf(':');
		if (separatorIndex <= 0) {
			return { reasonCode: 'unknownPrefix', reasonText: `${JSON.stringify(cellText)} is neither an absolute IRI nor a CURIE` };
		}
		const prefix = cellText.slice(0, separatorIndex);
		return expansionByPrefix[prefix] === undefined ? { reasonCode: 'unknownPrefix', reasonText: `prefix '${prefix}' is not in the declared prefix map (${Object.keys(prefixExpansionByPrefix).sort(byCodePoint).join(', ')})` } : { iri: `${expansionByPrefix[prefix]}${cellText.slice(separatorIndex + 1)}` };
	};
	const acceptedList = [];
	const refusalList = [];
	const seenRecordIdSet = new Set();
	const recordIdColumnIndex = table.columnList.indexOf('record_id');
	for (let rowIndex = 0; rowIndex < table.rowCellListList.length; rowIndex++) {
		const rowNumber = rowIndex + 1;
		const cellList = table.rowCellListList[rowIndex];
		const row = table.columnList.reduce((soFar, oneColumn, columnIndex) => ({ ...soFar, [oneColumn]: cellList[columnIndex] === undefined ? '' : cellList[columnIndex] }), {});
		const refuseRow = (reasonCode, reasonText) => refusalList.push({ rowNumber, subject_id: row.subject_id, predicate_id: row.predicate_id, object_id: row.object_id, reasonCode, reasonText });
		if (cellList.length !== table.columnList.length || MANDATORY_COLUMN_LIST.some((oneColumn) => !isNonEmptyString(row[oneColumn]))) {
			refuseRow('missingMandatoryCell', `the row has ${cellList.length} cells for ${table.columnList.length} columns, or an empty ${MANDATORY_COLUMN_LIST.join('/')} cell`);
			continue;
		}
		if (recordIdColumnIndex !== -1 && isNonEmptyString(row.record_id)) {
			if (seenRecordIdSet.has(row.record_id)) {
				refuseRow('duplicateRecordId', `record_id ${row.record_id} is already carried by an earlier row (SSSOM 1.1: unique within a set)`);
				continue;
			}
			seenRecordIdSet.add(row.record_id);
		}
		const subject = expandCell(row.subject_id);
		if (subject.reasonCode !== undefined) {
			refuseRow(subject.reasonCode, `subject: ${subject.reasonText}`);
			continue;
		}
		const parsedSubject = edcUri.parse(subject.iri);
		if (parsedSubject.error || parsedSubject.kind !== 'element') {
			refuseRow('subjectNotAnElementIri', `subject ${subject.iri} is not an EDUcore element IRI (${parsedSubject.error ? 'no kind' : parsedSubject.kind})`);
			continue;
		}
		const { standardName, standardVersion, elementStableId } = parsedSubject.partByName;
		const sourceNameSet = sourceNameSetByStableId[elementStableId];
		if (sourceNameSet === undefined || !sourceNameSet.has(standardName) || versionSetByStandardName[standardName] === undefined || !versionSetByStandardName[standardName].has(standardVersion)) {
			refuseRow('subjectAbsentFromGold', `subject ${elementStableId} of ${standardName} ${standardVersion} is not an element of ${goldCapture.goldContainerName} (${versionSetByStandardName[standardName] === undefined ? 'no such standard' : `the gold holds ${standardName} ${Array.from(versionSetByStandardName[standardName]).sort(byCodePoint).join(' | ')}`})`);
			continue;
		}
		const predicateCurie = row.predicate_id;
		if (!/^[A-Za-z_][A-Za-z0-9_.-]*:[A-Za-z_][A-Za-z0-9_.-]*$/.test(predicateCurie) && !/^https?:\/\/\S+$/.test(predicateCurie)) {
			refuseRow('malformedPredicate', `predicate ${JSON.stringify(predicateCurie)} is not a CURIE or an absolute IRI`);
			continue;
		}
		const predicate = expandCell(predicateCurie);
		if (predicate.reasonCode !== undefined) {
			refuseRow(predicate.reasonCode, `predicate: ${predicate.reasonText}`);
			continue;
		}
		if (!predicateIriSet.has(predicate.iri)) {
			refuseRow('predicateNotAdmitted', `predicate ${predicate.iri} is not one importRules.json admits`);
			continue;
		}
		const object = expandCell(row.object_id);
		if (object.reasonCode !== undefined) {
			refuseRow(object.reasonCode, `object: ${object.reasonText}`);
			continue;
		}
		const isAbstention = object.iri === importRules.noTermFoundIri;
		if (!isAbstention && !cardUriSet.has(object.iri)) {
			refuseRow('objectNotAHubReference', `object ${object.iri} is not a HubReference card of ${goldCapture.goldContainerName}`);
			continue;
		}
		acceptedList.push({ rowNumber, row, subjectStableId: elementStableId, standardName, standardVersion, subjectIri: subject.iri, predicateIri: predicate.iri, objectIri: object.iri, isAbstention });
	}
	return { acceptedList, refusalList, columnList: table.columnList, rowCount: table.rowCellListList.length };
};

// layerEntryFor — the registry entry an import appends the first time it sees a slug: its standards and hubs are those its ACCEPTED rows name
const layerEntryFor = ({ layerKey, slug, authorIri, acceptedList, goldCapture, importRules }) => {
	const standardKeyOf = (stableId) => stableId.slice(0, stableId.indexOf(':'));
	const standardByStandardKey = acceptedList.reduce((soFar, oneAccepted) => {
		const standardKey = standardKeyOf(oneAccepted.subjectStableId);
		return soFar[standardKey] !== undefined ? soFar : { ...soFar, [standardKey]: { standardKey, standardName: oneAccepted.standardName, sourceIri: oneAccepted.subjectIri.slice(0, oneAccepted.subjectIri.length - edcUri.encodeSegment(oneAccepted.subjectStableId.slice(standardKey.length + 1)).segmentText.length) } };
	}, {});
	const hubList = goldCapture.hubList
		.filter((oneHub) => acceptedList.some((oneAccepted) => !oneAccepted.isAbstention && oneAccepted.objectIri.indexOf(oneHub.namespace) === 0))
		.map((oneHub) => ({ hubKey: oneHub.hubName.toLowerCase(), hubName: oneHub.hubName, sourceIri: oneHub.namespace }));
	return {
		layerKey,
		displayName: `imported set '${slug}'`,
		layerKind: importRules.layerKind,
		authorAgentIri: authorIri,
		standardList: Object.keys(standardByStandardKey).sort(byCodePoint).map((standardKey) => standardByStandardKey[standardKey]),
		hubList,
		versionList: [],
		statusChangeList: [],
	};
};

const importLayer = ({ sssomText, sssomPath, slug, versionTag, authorIri, prefixMapDeclaration, goldCapture, registry, decisionStore, publishedAt, validateWithSssomPy, importRules } = {}, callback) => {
	if (![sssomText, sssomPath, slug, versionTag, authorIri, publishedAt].every(isNonEmptyString) || !isPlainObject(prefixMapDeclaration) || !isPlainObject(prefixMapDeclaration.prefixExpansion)) {
		callback(refusalText('sssomText, sssomPath, slug, versionTag, authorIri, publishedAt and prefixMapDeclaration.prefixExpansion are required', 'importLayer({ … }); nothing here is defaulted'));
		return;
	}
	if (!registry || !decisionStore || typeof validateWithSssomPy !== 'function' || !goldCapture || !importRules) {
		callback(refusalText('registry, decisionStore, validateWithSssomPy, goldCapture and importRules are required', 'the caller opens the store, loads the registry, captures the gold and names the real validator'));
		return;
	}
	const layerKey = `imported-${slug}`;
	if (!new RegExp(importRules.layerKeyPattern).test(layerKey)) {
		callback(refusalText(`slug '${slug}' makes the layer key '${layerKey}', which does not match ${importRules.layerKeyPattern}`, 'lib/layer-import/importRules.json layerKeyPattern'));
		return;
	}
	if (!registry.agentRegistry.agentList.some((oneAgent) => oneAgent.agentIri === authorIri)) {
		callback(refusalText(`author ${authorIri} is not in the agent registry`, 'recipes/agents.json; the source set\'s author is registered before it is imported'));
		return;
	}
	validateWithSssomPy(sssomPath, (validatorError, sssomPyVerdict) => {
		if (validatorError) {
			callback(refusalText(`${sssomPath} fails sssom-py: ${validatorError}`, 'sssom-py is the real validator; a file it rejects is not an SSSOM set'));
			return;
		}
		const resolved = resolveImportRows({ sssomText, prefixExpansionByPrefix: prefixMapDeclaration.prefixExpansion, goldCapture, importRules });
		if (resolved.error) {
			callback(resolved.error);
			return;
		}
		const contentId = sha256Hex(sssomText);
		const importRecord = { prefixMapDeclarationSha256: sha256Hex(JSON.stringify(prefixMapDeclaration)), prefixExpansion: prefixMapDeclaration.prefixExpansion, goldContainerName: goldCapture.goldContainerName, goldManifestRefId: goldCapture.manifestRefId, rowCount: resolved.rowCount, acceptedRowCount: resolved.acceptedList.length, refusedRowCount: resolved.refusalList.length, refusalCountByReasonCode: resolved.refusalList.reduce((soFar, oneRefusal) => ({ ...soFar, [oneRefusal.reasonCode]: (soFar[oneRefusal.reasonCode] || 0) + 1 }), {}), sssomPyVerdict };
		const report = { layerKey, contentId, acceptedRowCount: resolved.acceptedList.length, refusedRowCount: resolved.refusalList.length, refusalList: resolved.refusalList, importRecord };
		const existingLayer = registry.layerFor(layerKey);
		const existingVersionList = existingLayer.error ? [] : existingLayer.layer.versionList;
		const sameBytesVersion = existingVersionList.find((oneVersion) => oneVersion.administrationRecord.contentId === contentId);
		if (sameBytesVersion !== undefined) {
			callback('', { ...report, layerVersionUri: edcUri.mint({ kind: 'layerVersion', layerKey, versionTag: sameBytesVersion.administrationRecord.versionTag }).uri, alreadyPresent: true, layerRegistry: null });
			return;
		}
		if (existingVersionList.some((oneVersion) => oneVersion.administrationRecord.versionTag === versionTag)) {
			callback(refusalText(`tag '${versionTag}' of layer '${layerKey}' already names other bytes`, 'a published version is immutable and a tag is never reassigned'));
			return;
		}
		if (resolved.acceptedList.length === 0) {
			callback(refusalText(`no row of ${sssomPath} resolved (${resolved.refusalList.length} refused)`, 'an import with no accepted row registers nothing; the refusal list says why'), report);
			return;
		}
		const wholeSetPairKey = `${LAYER_SET_PAIR_KEY_PREFIX}${layerKey}`;
		decisionStore.saveDecisionBlock({ pairKey: wholeSetPairKey, frozenText: sssomText, decisionBlockHash: contentId }, (saveError, saved) => {
			if (saveError) {
				callback(`${moduleName}: saving ${wholeSetPairKey}: ${saveError}`);
				return;
			}
			if (saved.decisionBlockHash !== contentId) {
				callback(refusalText(`the store addressed the set as ${saved.decisionBlockHash}, not ${contentId}`, 'the version id IS the file bytes\' sha256'));
				return;
			}
			const withLayer = existingLayer.error ? registry.withAppendedLayer({ layer: layerEntryFor({ layerKey, slug, authorIri, acceptedList: resolved.acceptedList, goldCapture, importRules }) }) : { layerRegistry: registry.layerRegistry };
			if (withLayer.error) {
				callback(withLayer.error);
				return;
			}
			const wholeSetBlock = { pairKey: wholeSetPairKey, decisionBlockHash: contentId };
			const version = {
				administrationRecord: { registrationAuthority: registry.layerRegistry.registrationAuthorityIri, registrar: registry.layerRegistry.registrarIri, submitter: authorIri, publishedAt, contentId, versionTag },
				registrationStatus: importRules.initialRegistrationStatus,
				authorAgentIri: authorIri,
				contentIdBasis: 'frozenSetBytes',
				wholeSetBlock,
				memberBlockList: [wholeSetBlock],
				sssomPath,
				importRecord,
			};
			const appended = withLayer.layerRegistry === registry.layerRegistry ? registry.withAppendedVersion({ layerKey, version }) : appendVersionToCandidate({ candidateLayerRegistry: withLayer.layerRegistry, layerKey, version, registry });
			if (appended.error) {
				callback(appended.error);
				return;
			}
			// ⟪ML3.1b⟫ what the caller appends to uriContract: the layer (new or existing), the version and the set's frozen bytes
			const uriContractAppend = { layer: appended.layerRegistry.layerList.find((oneLayer) => oneLayer.layerKey === layerKey), version, decisionSchemaBlockList: [{ pairKey: wholeSetPairKey, producerKind: LAYER_REGISTRY_SCHEMA.producerKindByLayerKind[importRules.layerKind], frozenText: sssomText }] };
			callback('', { ...report, layerVersionUri: edcUri.mint({ kind: 'layerVersion', layerKey, versionTag }).uri, wholeSetBlock, alreadyPresent: false, layerRegistry: appended.layerRegistry, uriContractAppend });
		});
	});
};

// appendVersionToCandidate — the version appended to the registry that ALREADY carries the new layer, re-validated whole through registryFor
const appendVersionToCandidate = ({ candidateLayerRegistry, layerKey, version, registry }) => {
	const reloaded = registryFor({ layerRegistry: candidateLayerRegistry, agentRegistry: registry.agentRegistry });
	return reloaded.error ? { error: reloaded.error } : reloaded.registry.withAppendedVersion({ layerKey, version });
};

module.exports = { resolveImportRows, importLayer, LAYER_SET_PAIR_KEY_PREFIX, MANDATORY_COLUMN_LIST, moduleName };
