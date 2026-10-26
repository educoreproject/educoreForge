'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// publishLayer.js — freeze one SSSOM/TSV mapping set as a version of a registered mapping layer (mappingLayers ML1-b; SPEC §4.2,
// §10 "publish means they get a URI and become immutable"; ruling R-4 of DESIGN-ML1a, BRONZE_CROWN 2026-10-24). It lists no
// library and touches no manifest.
//
//   publishLayer({ sssomText, sssomPath, layerKey, versionTag, authorIri, registry, decisionStore, publishedAt, validateWithSssomPy }, cb)
//     → cb('', { contentId, layerVersionUri, layerVersionByContentUri, alreadyPresent, wholeSetBlock, memberBlockList, layerRegistry,
//                uriContractAppend })   ⟪ML3.1b⟫ uriContractAppend = { layer, version, decisionSchemaBlockList }: what -publishLayer appends
//                                       to uriContract (absent when alreadyPresent)
//
// IN ORDER, each step refusing by name: (1) the TSV passes the exporter's own parseSssomTsv; (2) it passes sssom-py `sssom validate`
// (the caller's validateWithSssomPy, a callback(errString) — the real validator, never a proxy); (3) the layer is registered and
// its kind is a LAYER producer kind (a judge layer is published by its bridge, never here); (4) the bytes' sha256 is the content
// id: a tag already holding THESE bytes is alreadyPresent, a tag holding OTHER bytes is refused, and these bytes already under
// another tag are refused (one tag per version); (5) a curated set's #mapping_provider is its author's agent IRI; (6) rows are
// split, deterministically, into one block per (subject_source, object_source) pair resolved through the layer's standardList and
// hubList (an unlisted source refused): the block's text is the set's header lines, its column line and that pair's rows in
// source order, under pairKey <hubKey>@<hubVersion>::<standardKey>@<version>::layer.<layerKey>::<producerKind>; the WHOLE set is
// also frozen once, under layerSet::<layerKey>, and its hash IS the content id; (7) every block is saved (idempotent: the store
// answers alreadyPresent); (8) the registry gains the version as Candidate, by a new registry object; ⟪ML3.1b⟫ the CALLER appends it to uriContract.
//
// TRAP: the decision store answers getDecisionBlock with the LATEST block per pairKey and never re-inserts identical bytes, so a
// pair whose rows return to an earlier version's bytes leaves the store's "latest" pointing at the intervening block. The
// registry's memberBlockList, not the store's latest, names a version's blocks.

const crypto = require('crypto');
const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const edcUri = require(path.join(__dirname, '..', 'edc-uri', 'edcUri'));
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const sssomExporterLib = require(path.join(__dirname, '..', 'bridge-framework', 'sssomExporter'));
const { LAYER_REGISTRY_SCHEMA } = require(path.join(__dirname, 'layerRegistry'));

const { LAYER_PRODUCER_KIND, LAYER_PRODUCER_KIND_LIST } = vocabularyLib;
const LAYER_SET_PAIR_KEY_PREFIX = 'layerSet::';
const LAYER_PAIR_KEY_PRODUCER_PREFIX = 'layer.';
const INITIAL_REGISTRATION_STATUS = 'Candidate';
// the four propagatable source slots a row is split by: the row's column when it carries one, else the set-level header scalar
const PAIR_SLOT_NAME_LIST = Object.freeze(['subject_source', 'subject_source_version', 'object_source', 'object_source_version']);

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;

// splitSetByPair({ sssomText, parsed, layer, producerKind }) → { pairBlockList: [{ pairKey, frozenText, rowCount }] } | { error }
const splitSetByPair = ({ sssomText, parsed, layer, producerKind }) => {
	const lineList = sssomText.split('\n');
	const headerLineList = lineList.filter((oneLine) => oneLine.startsWith('#'));
	const bodyLineList = lineList.filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
	const columnLine = bodyLineList[0];
	const rowLineList = bodyLineList.slice(1);
	const standardBySourceIri = layer.standardList.reduce((soFar, oneStandard) => ({ ...soFar, [oneStandard.sourceIri]: oneStandard }), {});
	const hubBySourceIri = layer.hubList.reduce((soFar, oneHub) => ({ ...soFar, [oneHub.sourceIri]: oneHub }), {});
	const pairByPairKey = {};
	const pairKeyOrderList = [];
	for (let rowIndex = 0; rowIndex < parsed.rowList.length; rowIndex++) {
		const oneRow = parsed.rowList[rowIndex];
		const slotByName = PAIR_SLOT_NAME_LIST.reduce((soFar, oneSlot) => ({ ...soFar, [oneSlot]: isNonEmptyString(oneRow[oneSlot]) ? oneRow[oneSlot] : parsed.headerScalarOf(oneSlot) }), {});
		const absentSlot = PAIR_SLOT_NAME_LIST.find((oneSlot) => !isNonEmptyString(slotByName[oneSlot]));
		if (absentSlot !== undefined) {
			return { error: refusalText(`row ${rowIndex + 1} (${oneRow.subject_id}) has no ${absentSlot}, as a column or at set level`, 'a layer set is split by its rows\' source slots (R-4)') };
		}
		const standard = standardBySourceIri[slotByName.subject_source];
		const hub = hubBySourceIri[slotByName.object_source];
		if (standard === undefined || hub === undefined) {
			return { error: refusalText(`row ${rowIndex + 1} (${oneRow.subject_id}): ${standard === undefined ? `subject_source ${slotByName.subject_source}` : `object_source ${slotByName.object_source}`} is not listed by layer '${layer.layerKey}'`, `recipes/layers.json ${standard === undefined ? 'standardList' : 'hubList'} (an unlisted source is refused, never guessed)`) };
		}
		const pairKey = `${hub.hubKey}@${slotByName.object_source_version}::${standard.standardKey}@${slotByName.subject_source_version}::${LAYER_PAIR_KEY_PRODUCER_PREFIX}${layer.layerKey}::${producerKind}`;
		if (pairByPairKey[pairKey] === undefined) {
			pairByPairKey[pairKey] = [];
			pairKeyOrderList.push(pairKey);
		}
		pairByPairKey[pairKey].push(rowLineList[rowIndex]);
	}
	return {
		pairBlockList: pairKeyOrderList
			.slice()
			.sort()
			.map((pairKey) => ({ pairKey, rowCount: pairByPairKey[pairKey].length, frozenText: `${headerLineList.join('\n')}\n${columnLine}\n${pairByPairKey[pairKey].join('\n')}\n` })),
	};
};

// saveEveryBlock({ decisionStore, blockList }, cb) → cb('', [{ pairKey, decisionBlockHash, alreadyPresent }]) in order
const saveEveryBlock = ({ decisionStore, blockList }, callback) => {
	const savedList = [];
	const saveNext = (blockIndex) => {
		if (blockIndex >= blockList.length) {
			callback('', savedList);
			return;
		}
		const oneBlock = blockList[blockIndex];
		decisionStore.saveDecisionBlock({ pairKey: oneBlock.pairKey, frozenText: oneBlock.frozenText, decisionBlockHash: sha256Hex(oneBlock.frozenText) }, (saveError, saved) => {
			if (saveError) {
				callback(`${moduleName}: saving ${oneBlock.pairKey}: ${saveError}`);
				return;
			}
			savedList.push({ pairKey: oneBlock.pairKey, decisionBlockHash: saved.decisionBlockHash, alreadyPresent: saved.alreadyPresent });
			saveNext(blockIndex + 1);
		});
	};
	saveNext(0);
};

const publishLayer = ({ sssomText, sssomPath, layerKey, versionTag, authorIri, registry, decisionStore, publishedAt, validateWithSssomPy } = {}, callback) => {
	if (!isNonEmptyString(sssomText) || !isNonEmptyString(sssomPath) || !isNonEmptyString(versionTag) || !isNonEmptyString(publishedAt)) {
		callback(refusalText('sssomText, sssomPath, versionTag and publishedAt are required', 'publishLayer({ … }); nothing here is defaulted'));
		return;
	}
	if (!registry || !decisionStore || typeof validateWithSssomPy !== 'function') {
		callback(refusalText('registry, decisionStore and validateWithSssomPy are required', 'the caller opens the store, loads the registry and names the real validator'));
		return;
	}
	if (!new RegExp(LAYER_REGISTRY_SCHEMA.versionTagPattern).test(versionTag)) {
		callback(refusalText(`versionTag '${versionTag}' does not match ${LAYER_REGISTRY_SCHEMA.versionTagPattern}`, 'layerRegistrySchema.json versionTagPattern'));
		return;
	}
	const parsed = sssomExporterLib.parseSssomTsv(sssomText);
	if (parsed.error) {
		callback(refusalText(`${sssomPath} fails parseSssomTsv: ${parsed.error}`, 'the exporter\'s own reader is the first validator'));
		return;
	}
	if (parsed.rowList.length === 0) {
		callback(refusalText(`${sssomPath} carries no mapping rows`, 'an empty set is not a layer version'));
		return;
	}
	validateWithSssomPy(sssomPath, (validatorError) => {
		if (validatorError) {
			callback(refusalText(`${sssomPath} fails sssom validate: ${validatorError}`, 'sssom-py is the second, real validator'));
			return;
		}
		const found = registry.layerFor(layerKey);
		if (found.error) {
			callback(found.error);
			return;
		}
		const { layer } = found;
		const producerKind = LAYER_REGISTRY_SCHEMA.producerKindByLayerKind[layer.layerKind];
		if (LAYER_PRODUCER_KIND_LIST.indexOf(producerKind) === -1) {
			callback(refusalText(`layer '${layerKey}' is a '${layer.layerKind}' layer (producer kind ${producerKind})`, `-publishLayer publishes mapping LAYERS (${LAYER_PRODUCER_KIND_LIST.join(', ')}); a judge layer is frozen by its bridge`));
			return;
		}
		const contentId = sha256Hex(sssomText);
		const sameTagVersion = layer.versionList.find((oneVersion) => oneVersion.administrationRecord.versionTag === versionTag);
		if (sameTagVersion !== undefined && sameTagVersion.administrationRecord.contentId !== contentId) {
			callback(refusalText(`tag '${versionTag}' of layer '${layerKey}' already names other bytes (content ${sameTagVersion.administrationRecord.contentId}; these are ${contentId})`, 'a published version is immutable and a tag is never reassigned; publish the change under a new tag'));
			return;
		}
		const sameBytesVersion = layer.versionList.find((oneVersion) => oneVersion.administrationRecord.contentId === contentId && oneVersion.administrationRecord.versionTag !== versionTag);
		if (sameBytesVersion !== undefined) {
			callback(refusalText(`these bytes are already layer '${layerKey}' version '${sameBytesVersion.administrationRecord.versionTag}'`, 'one version, one tag'));
			return;
		}
		const resolvedAuthorIri = isNonEmptyString(authorIri) ? authorIri : layer.authorAgentIri;
		const authorAgent = registry.agentRegistry.agentList.find((oneAgent) => oneAgent.agentIri === resolvedAuthorIri);
		if (authorAgent === undefined) {
			callback(refusalText(`author ${JSON.stringify(resolvedAuthorIri)} is not in the agent registry`, 'recipes/agents.json; an author is registered before they publish'));
			return;
		}
		const mappingProvider = parsed.headerScalarOf('mapping_provider');
		if (producerKind === LAYER_PRODUCER_KIND.CURATED && mappingProvider !== resolvedAuthorIri) {
			callback(refusalText(`a curated set's #mapping_provider is ${JSON.stringify(mappingProvider)}, not its author ${resolvedAuthorIri}`, 'SSSOM set slots for producerKind curated: mapping_provider = the author\'s agent registry entry'));
			return;
		}
		if (producerKind === LAYER_PRODUCER_KIND.IMPORTED && !isNonEmptyString(mappingProvider)) {
			callback(refusalText('an imported set carries no #mapping_provider', 'SSSOM set slots for producerKind imported: mapping_provider = the source set\'s id'));
			return;
		}
		const split = splitSetByPair({ sssomText, parsed, layer, producerKind });
		if (split.error) {
			callback(split.error);
			return;
		}
		const wholeSetPairKey = `${LAYER_SET_PAIR_KEY_PREFIX}${layerKey}`;
		saveEveryBlock({ decisionStore, blockList: [{ pairKey: wholeSetPairKey, frozenText: sssomText }].concat(split.pairBlockList) }, (saveError, savedList) => {
			if (saveError) {
				callback(saveError);
				return;
			}
			const [wholeSetSaved, ...memberSavedList] = savedList;
			if (wholeSetSaved.decisionBlockHash !== contentId) {
				callback(refusalText(`the store addressed the whole set as ${wholeSetSaved.decisionBlockHash}, not ${contentId}`, 'the content id IS the frozen bytes\' sha256'));
				return;
			}
			const layerVersionUri = edcUri.mint({ kind: 'layerVersion', layerKey, versionTag });
			const layerVersionByContentUri = edcUri.mint({ kind: 'layerVersionByContent', layerKey, contentId });
			const mintError = layerVersionUri.error || layerVersionByContentUri.error;
			if (mintError) {
				callback(mintError);
				return;
			}
			const wholeSetBlock = { pairKey: wholeSetPairKey, decisionBlockHash: wholeSetSaved.decisionBlockHash };
			const memberBlockList = memberSavedList.map((oneSaved) => ({ pairKey: oneSaved.pairKey, decisionBlockHash: oneSaved.decisionBlockHash }));
			const report = { contentId, layerVersionUri: layerVersionUri.uri, layerVersionByContentUri: layerVersionByContentUri.uri, wholeSetBlock, memberBlockList, rowCountByPairKey: split.pairBlockList.reduce((soFar, onePair) => ({ ...soFar, [onePair.pairKey]: onePair.rowCount }), {}) };
			if (sameTagVersion !== undefined) {
				callback('', { ...report, alreadyPresent: true, layerRegistry: null });
				return;
			}
			const version = {
				administrationRecord: { registrationAuthority: registry.layerRegistry.registrationAuthorityIri, registrar: registry.layerRegistry.registrarIri, submitter: resolvedAuthorIri, publishedAt, contentId, versionTag },
				registrationStatus: INITIAL_REGISTRATION_STATUS,
				authorAgentIri: resolvedAuthorIri,
				contentIdBasis: 'frozenSetBytes',
				wholeSetBlock,
				memberBlockList,
				sssomPath,
			};
			const appended = registry.withAppendedVersion({ layerKey, version });
			if (appended.error) {
				callback(appended.error);
				return;
			}
			// ⟪ML3.1b⟫ what the caller appends to uriContract (lib/uri-contract appendLayerVersion): the layer, the version and the
			// frozen text of every block it is made of, so the forever store never depends on the working decision store
			const decisionSchemaBlockList = [{ pairKey: wholeSetPairKey, producerKind, frozenText: sssomText }].concat(split.pairBlockList.map((onePair) => ({ pairKey: onePair.pairKey, producerKind, frozenText: onePair.frozenText })));
			const uriContractAppend = { layer: appended.layerRegistry.layerList.find((oneLayer) => oneLayer.layerKey === layerKey), version, decisionSchemaBlockList };
			callback('', { ...report, alreadyPresent: false, layerRegistry: appended.layerRegistry, uriContractAppend });
		});
	});
};

module.exports = { publishLayer, splitSetByPair, LAYER_SET_PAIR_KEY_PREFIX, LAYER_PAIR_KEY_PRODUCER_PREFIX, moduleName };
