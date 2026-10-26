'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// uriContractRelations.js — the COMPUTED RELATIONS a resolver answers beside each thing (TQ rulings Q4 and Q5, 2026-10-26; the
// shapes are lane A's, relayed by AMBER_JOURNEY, VERBATIM). Every answer is computed at request time from uriContract's rows and
// its derived tables (derivedIndexes.js); nothing here is stored. Synchronous, over the injected handle; each function returns
// { error } or { answer } (answer null when the thing is not published). uriContract.js wraps them in lane A's callback form.
//
//   1  elementRecordFor({ standardName, standardVersion, elementStableId })
//        → { schemaBlockRefId, node: { stableId, labels, properties }, parentStableId | null, siblingStableIdList, definitionText | null }
//   2  publishedLayerVersionListForStandard({ standardName, standardVersion }) → [{ layerKey, versionTag, registrationStatus }]
//   3  mappingsToMeaningFor(meaningIri) → [{ manifestRefId, standardName, standardVersion, layerKey | null, versionTag | null, relationType, elementCount }]
//   4  layerHistoryFor(layerKey) → { layerKey, displayName, layerKind, authorAgentIri, versionList: [{ versionTag, contentId, publishedAt,
//        statusHistory: [{ registrationStatus, changedAt, changedBy }], scores | null }] }
//   5  layerVersionRecordFor({ layerKey, versionTag }) → { authorAgentIri, publishedAt, latestStatus, countByStandard, countByHub,
//        abstentionRate, agreementScores | null }
//   6  manifestInventoryFor({ publicLabel } | { manifestRefId }) → { manifestRefId, publicLabel, publishedAt, latestStatus, standardList,
//        hubList, layerVersionList, nodeCount, edgeCount }
//   7  rootCountsFor() → { manifestCount, layerCount, layerVersionCount, agentCount }
//   8  publishedManifestListFor({ pageNumber, pageSize }) → { totalCount, manifestList: [{ manifestRefId, publicLabel, publishedAt, latestStatus }] }
//   9  manifestStandardListFor(manifestSelector) → { manifestRefId, publicLabel, standardList: [{ standardName, standardVersion, standardKey,
//        elementCount, schemaBlockRefId }] }
//   10 manifestElementListFor(manifestSelector, { standardName, standardVersion, pageNumber, pageSize }) → { totalCount, elementList:
//        [{ elementStableId, role | null }] }   ordered by elementStableId in code-point order (SQLite BINARY), so pages are stable
//   11 agentListFor({ pageNumber, pageSize }) → { totalCount, agentList: [{ profile }] }
//   12 layerListFor() → [{ layerKey, displayName, layerKind, versionCount, currentStandardVersionTag | null }]
//   13 manifestHubListFor(manifestSelector) → { manifestRefId, publicLabel, hubList: [{ hubName, hubVersion, hubSegment, hubReleaseSegment, cardCount, domainCount }] }
//   14 hubDomainListFor(manifestSelector, { hubSegment, hubReleaseSegment, pageNumber, pageSize }) → { totalCount, domainList: [{ domainId,
//        domainName, domainUri, domainDefinition, cardCount }] }   ordered by domainId
//   15 hubDomainCardListFor(manifestSelector, { hubSegment, hubReleaseSegment, domainId, pageNumber, pageSize }) → { totalCount, cardList:
//        [{ meaningIri, label, definition, propertyName, propertyKey, referenceTier }] }   ordered by meaningIri
//
// DECISIONS stated once: pages are numbered from 1 and pageSize is 1..PAGE_SIZE_LIMIT (anything else refused by name); "latestStatus"
// is always { registrationStatus, changedAt }; a decisionBlockHash names the layer version that FIRST published it among layers that
// are not copies (a copy layer, one whose versions carry copiedFromLayerVersion, re-registers the same blocks under another key),
// else null (3); a manifest's layerVersionList is the non-copy versions ALL of whose member blocks the manifest's answer edges cite
// (6); an element held by two base blocks of one standard@version answers from the one indexed first (1).

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const refusalText = (what, where) => refuse.byName({ moduleName, what, where }).message;
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (candidate) => typeof candidate === 'string' && candidate.length > 0;
const PAGE_SIZE_LIMIT = 1000;

const pageRefusal = ({ pageNumber, pageSize } = {}) => (Number.isInteger(pageNumber) && pageNumber >= 1 && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= PAGE_SIZE_LIMIT ? '' : refusalText(`pageNumber ${JSON.stringify(pageNumber)} and pageSize ${JSON.stringify(pageSize)}: pages are numbered from 1 and hold 1 to ${PAGE_SIZE_LIMIT}`, 'a paged listing names its page; nothing is defaulted'));

const uriContractRelationsFor = ({ database, uriContract }) => {
	const latestManifestStatusOf = (manifestRefId) => database.prepare('SELECT registrationStatus, changedAt FROM manifestStatusChanges WHERE manifestRefId = ? ORDER BY rowId DESC LIMIT 1').get(manifestRefId);
	const manifestRowFor = (manifestSelector) => {
		if (!isPlainObject(manifestSelector) || (!isNonEmptyString(manifestSelector.publicLabel) && !isNonEmptyString(manifestSelector.manifestRefId))) {
			return { error: refusalText('a manifest is named by { publicLabel } or { manifestRefId }', 'manifestSelector') };
		}
		const row = isNonEmptyString(manifestSelector.manifestRefId) ? database.prepare('SELECT * FROM publishedManifests WHERE manifestRefId = ?').get(manifestSelector.manifestRefId) : database.prepare('SELECT * FROM publishedManifests WHERE publicLabel = ?').get(manifestSelector.publicLabel);
		return { manifestRow: row === undefined ? null : row };
	};
	const loadedRegistry = () => uriContract.loadRegistry();
	// firstPublishingVersionByHash — decisionBlockHash → { layerKey, versionTag } of the earliest-published non-copy version holding it
	const firstPublishingVersionByHash = (registry) => {
		const candidateList = [];
		registry.layerRegistry.layerList
			.filter((oneLayer) => !oneLayer.versionList.some((oneVersion) => oneVersion.copiedFromLayerVersion !== undefined))
			.forEach((oneLayer) => oneLayer.versionList.forEach((oneVersion) => candidateList.push({ layerKey: oneLayer.layerKey, versionTag: oneVersion.administrationRecord.versionTag, publishedAt: oneVersion.administrationRecord.publishedAt, hashList: oneVersion.memberBlockList.map((oneMember) => oneMember.decisionBlockHash) })));
		return candidateList
			.sort((left, right) => (left.publishedAt < right.publishedAt ? -1 : left.publishedAt > right.publishedAt ? 1 : 0))
			.reduce((soFar, oneCandidate) => oneCandidate.hashList.reduce((inner, oneHash) => (inner[oneHash] === undefined ? { ...inner, [oneHash]: { layerKey: oneCandidate.layerKey, versionTag: oneCandidate.versionTag } } : inner), soFar), {});
	};

	// 1
	const elementRecordFor = ({ standardName, standardVersion, elementStableId } = {}) => {
		const row = database.prepare('SELECT * FROM derivedElementIndex WHERE standardName = ? AND standardVersion = ? AND elementStableId = ? ORDER BY rowid LIMIT 1').get(standardName, standardVersion, elementStableId);
		if (row === undefined) {
			return { answer: null };
		}
		const node = JSON.parse(row.nodeJson);
		const siblingStableIdList = row.parentStableId === null ? [] : database.prepare('SELECT elementStableId FROM derivedElementIndex WHERE schemaBlockRefId = ? AND parentStableId = ? AND elementStableId <> ? ORDER BY elementStableId').all(row.schemaBlockRefId, row.parentStableId, elementStableId).map((oneRow) => oneRow.elementStableId);
		return { answer: { schemaBlockRefId: row.schemaBlockRefId, node: { stableId: node.stableId, labels: node.labels, properties: node.properties }, parentStableId: row.parentStableId, siblingStableIdList, definitionText: row.definitionText } };
	};

	// 2
	const publishedLayerVersionListForStandard = ({ standardName, standardVersion } = {}) => {
		const loaded = loadedRegistry();
		if (loaded.error) {
			return loaded;
		}
		const answer = [];
		loaded.registry.layerRegistry.layerList.forEach((oneLayer) => {
			const standardKeyList = oneLayer.standardList.filter((oneStandard) => oneStandard.standardName === standardName).map((oneStandard) => oneStandard.standardKey);
			oneLayer.versionList
				.filter((oneVersion) => oneVersion.memberBlockList.some((oneMember) => standardKeyList.some((standardKey) => oneMember.pairKey.split('::')[1] === `${standardKey}@${standardVersion}`)))
				.forEach((oneVersion) => answer.push({ layerKey: oneLayer.layerKey, versionTag: oneVersion.administrationRecord.versionTag, registrationStatus: loaded.registry.effectiveStatusFor({ layerKey: oneLayer.layerKey, versionTag: oneVersion.administrationRecord.versionTag }).registrationStatus }));
		});
		return { answer };
	};

	// 3
	const mappingsToMeaningFor = (meaningIri) => {
		const loaded = loadedRegistry();
		if (loaded.error) {
			return loaded;
		}
		const versionByHash = firstPublishingVersionByHash(loaded.registry);
		const groupList = database
			.prepare('SELECT members.manifestRefId AS manifestRefId, edges.subjectStandardName AS standardName, edges.subjectStandardVersion AS standardVersion, edges.decisionBlockHash AS decisionBlockHash, edges.relationType AS relationType, COUNT(DISTINCT edges.subjectStableId) AS elementCount FROM derivedAnswerEdges AS edges JOIN publishedManifestMembers AS members ON members.schemaBlockRefId = edges.schemaBlockRefId WHERE edges.meaningIri = ? GROUP BY members.manifestRefId, edges.subjectStandardName, edges.subjectStandardVersion, edges.decisionBlockHash, edges.relationType ORDER BY members.manifestRefId, edges.subjectStandardName, edges.relationType')
			.all(meaningIri);
		return { answer: groupList.map((oneGroup) => ({ manifestRefId: oneGroup.manifestRefId, standardName: oneGroup.standardName, standardVersion: oneGroup.standardVersion, layerKey: oneGroup.decisionBlockHash !== null && versionByHash[oneGroup.decisionBlockHash] !== undefined ? versionByHash[oneGroup.decisionBlockHash].layerKey : null, versionTag: oneGroup.decisionBlockHash !== null && versionByHash[oneGroup.decisionBlockHash] !== undefined ? versionByHash[oneGroup.decisionBlockHash].versionTag : null, relationType: oneGroup.relationType, elementCount: oneGroup.elementCount })) };
	};

	// 4
	const layerHistoryFor = (layerKey) => {
		const loaded = loadedRegistry();
		if (loaded.error) {
			return loaded;
		}
		const layer = loaded.registry.layerRegistry.layerList.find((oneLayer) => oneLayer.layerKey === layerKey);
		if (layer === undefined) {
			return { answer: null };
		}
		const statusRowList = database.prepare('SELECT * FROM layerStatusChanges WHERE layerKey = ? ORDER BY rowId').all(layerKey);
		return {
			answer: {
				layerKey,
				displayName: layer.displayName,
				layerKind: layer.layerKind,
				authorAgentIri: layer.authorAgentIri,
				versionList: layer.versionList.map((oneVersion) => ({
					versionTag: oneVersion.administrationRecord.versionTag,
					contentId: oneVersion.administrationRecord.contentId,
					publishedAt: oneVersion.administrationRecord.publishedAt,
					statusHistory: statusRowList.filter((oneRow) => oneRow.versionTag === oneVersion.administrationRecord.versionTag).map((oneRow) => ({ registrationStatus: oneRow.registrationStatus, changedAt: oneRow.changedAt, changedBy: oneRow.changedByAgentIri })),
					scores: oneVersion.scoreList === undefined ? null : oneVersion.scoreList,
				})),
			},
		};
	};

	// 5
	const layerVersionRecordFor = ({ layerKey, versionTag } = {}) => {
		const loaded = loadedRegistry();
		if (loaded.error) {
			return loaded;
		}
		const found = loaded.registry.versionFor({ layerKey, versionTag });
		if (found.error) {
			return { answer: null };
		}
		const latestRow = database.prepare('SELECT registrationStatus, changedAt FROM layerStatusChanges WHERE layerKey = ? AND versionTag = ? ORDER BY rowId DESC LIMIT 1').get(layerKey, versionTag);
		const countRowList = database.prepare('SELECT * FROM derivedLayerVersionCounts WHERE layerKey = ? AND versionTag = ? ORDER BY countScope, scopeName').all(layerKey, versionTag);
		const countsOf = (countScope) => countRowList.filter((oneRow) => oneRow.countScope === countScope).reduce((soFar, oneRow) => ({ ...soFar, [oneRow.scopeName]: { rowCount: oneRow.rowCount, mappedCount: oneRow.mappedCount, abstainedCount: oneRow.abstainedCount } }), {});
		const standardRowList = countRowList.filter((oneRow) => oneRow.countScope === 'standard');
		const totalRowCount = standardRowList.reduce((soFar, oneRow) => soFar + oneRow.rowCount, 0);
		const totalAbstainedCount = standardRowList.reduce((soFar, oneRow) => soFar + oneRow.abstainedCount, 0);
		return { answer: { authorAgentIri: found.version.authorAgentIri, publishedAt: found.version.administrationRecord.publishedAt, latestStatus: { registrationStatus: latestRow.registrationStatus, changedAt: latestRow.changedAt }, countByStandard: countsOf('standard'), countByHub: countsOf('hub'), abstentionRate: totalRowCount === 0 ? null : totalAbstainedCount / totalRowCount, agreementScores: found.version.scoreList === undefined ? null : found.version.scoreList } };
	};

	// the base members of a manifest: one row per standardBase schema block, with its header standardKey and its element count
	const baseMemberListFor = (manifestRefId) =>
		database
			.prepare("SELECT elements.standardName AS standardName, elements.standardVersion AS standardVersion, elements.standardKey AS standardKey, COUNT(*) AS elementCount, elements.schemaBlockRefId AS schemaBlockRefId FROM publishedManifestMembers AS members JOIN schemaBlocks AS blocks ON blocks.refId = members.schemaBlockRefId JOIN derivedElementIndex AS elements ON elements.schemaBlockRefId = members.schemaBlockRefId WHERE members.manifestRefId = ? AND blocks.kind = 'standardBase' GROUP BY elements.schemaBlockRefId, elements.standardName, elements.standardVersion, elements.standardKey ORDER BY MIN(members.position), elements.standardName")
			.all(manifestRefId);

	// 6
	const manifestInventoryFor = (manifestSelector) => {
		const found = manifestRowFor(manifestSelector);
		if (found.error || found.manifestRow === null) {
			return found.error ? found : { answer: null };
		}
		const { manifestRow } = found;
		const loaded = loadedRegistry();
		if (loaded.error) {
			return loaded;
		}
		const citedHashSet = new Set(database.prepare('SELECT DISTINCT edges.decisionBlockHash AS decisionBlockHash FROM derivedAnswerEdges AS edges JOIN publishedManifestMembers AS members ON members.schemaBlockRefId = edges.schemaBlockRefId WHERE members.manifestRefId = ? AND edges.decisionBlockHash IS NOT NULL').all(manifestRow.manifestRefId).map((oneRow) => oneRow.decisionBlockHash));
		const layerVersionList = [];
		loaded.registry.layerRegistry.layerList
			.filter((oneLayer) => !oneLayer.versionList.some((oneVersion) => oneVersion.copiedFromLayerVersion !== undefined))
			.forEach((oneLayer) => oneLayer.versionList.filter((oneVersion) => oneVersion.memberBlockList.every((oneMember) => citedHashSet.has(oneMember.decisionBlockHash))).forEach((oneVersion) => layerVersionList.push({ layerKey: oneLayer.layerKey, versionTag: oneVersion.administrationRecord.versionTag })));
		const hubList = database.prepare('SELECT DISTINCT edges.hubName AS hubName, edges.hubVersion AS hubVersion FROM derivedAnswerEdges AS edges JOIN publishedManifestMembers AS members ON members.schemaBlockRefId = edges.schemaBlockRefId WHERE members.manifestRefId = ? ORDER BY edges.hubName, edges.hubVersion').all(manifestRow.manifestRefId);
		const latestRow = latestManifestStatusOf(manifestRow.manifestRefId);
		return { answer: { manifestRefId: manifestRow.manifestRefId, publicLabel: manifestRow.publicLabel, publishedAt: manifestRow.publishedAt, latestStatus: { registrationStatus: latestRow.registrationStatus, changedAt: latestRow.changedAt }, standardList: baseMemberListFor(manifestRow.manifestRefId).reduce((soFar, oneStandard) => (soFar.some((oneSeen) => oneSeen.standardName === oneStandard.standardName && oneSeen.standardVersion === oneStandard.standardVersion) ? soFar : soFar.concat([{ standardName: oneStandard.standardName, standardVersion: oneStandard.standardVersion }])), []), hubList, layerVersionList, nodeCount: manifestRow.recordedNodeCount, edgeCount: manifestRow.recordedEdgeCount } };
	};

	// 7
	const rootCountsFor = () => ({ answer: { manifestCount: database.prepare('SELECT COUNT(*) AS rowCount FROM publishedManifests').get().rowCount, layerCount: database.prepare('SELECT COUNT(DISTINCT layerKey) AS rowCount FROM layerVersions').get().rowCount, layerVersionCount: database.prepare('SELECT COUNT(*) AS rowCount FROM layerVersions').get().rowCount, agentCount: database.prepare('SELECT COUNT(*) AS rowCount FROM agents').get().rowCount } });

	// 8
	const publishedManifestListFor = (pageSpec) => {
		const fault = pageRefusal(pageSpec);
		if (fault) {
			return { error: fault };
		}
		const manifestList = database.prepare('SELECT manifestRefId, publicLabel, publishedAt FROM publishedManifests ORDER BY rowid LIMIT ? OFFSET ?').all(pageSpec.pageSize, (pageSpec.pageNumber - 1) * pageSpec.pageSize).map((oneRow) => ({ ...oneRow, latestStatus: latestManifestStatusOf(oneRow.manifestRefId) }));
		return { answer: { totalCount: database.prepare('SELECT COUNT(*) AS rowCount FROM publishedManifests').get().rowCount, manifestList } };
	};

	// 9
	const manifestStandardListFor = (manifestSelector) => {
		const found = manifestRowFor(manifestSelector);
		if (found.error || found.manifestRow === null) {
			return found.error ? found : { answer: null };
		}
		return { answer: { manifestRefId: found.manifestRow.manifestRefId, publicLabel: found.manifestRow.publicLabel, standardList: baseMemberListFor(found.manifestRow.manifestRefId) } };
	};

	// 10
	const manifestElementListFor = (manifestSelector, { standardName, standardVersion, pageNumber, pageSize } = {}) => {
		const fault = pageRefusal({ pageNumber, pageSize });
		if (fault) {
			return { error: fault };
		}
		const found = manifestRowFor(manifestSelector);
		if (found.error || found.manifestRow === null) {
			return found.error ? found : { answer: null };
		}
		const fromSql = 'FROM derivedElementIndex AS elements JOIN publishedManifestMembers AS members ON members.schemaBlockRefId = elements.schemaBlockRefId WHERE members.manifestRefId = ? AND elements.standardName = ? AND elements.standardVersion = ?';
		const parameterList = [found.manifestRow.manifestRefId, standardName, standardVersion];
		const elementList = database.prepare(`SELECT DISTINCT elements.elementStableId AS elementStableId, json_extract(elements.nodeJson, '$.properties.role[0]') AS role ${fromSql} ORDER BY elements.elementStableId LIMIT ? OFFSET ?`).all(...parameterList, pageSize, (pageNumber - 1) * pageSize).map((oneRow) => ({ elementStableId: oneRow.elementStableId, role: oneRow.role === undefined ? null : oneRow.role }));
		return { answer: { totalCount: database.prepare(`SELECT COUNT(DISTINCT elements.elementStableId) AS rowCount ${fromSql}`).get(...parameterList).rowCount, elementList } };
	};

	// 11
	const agentListFor = (pageSpec) => {
		const fault = pageRefusal(pageSpec);
		if (fault) {
			return { error: fault };
		}
		const agentIriList = database.prepare('SELECT agentIri FROM agents ORDER BY rowid LIMIT ? OFFSET ?').all(pageSpec.pageSize, (pageSpec.pageNumber - 1) * pageSpec.pageSize).map((oneRow) => oneRow.agentIri);
		const profileByIri = uriContract.registryShape().agentRegistry.agentList.reduce((soFar, oneAgent) => ({ ...soFar, [oneAgent.agentIri]: oneAgent }), {});
		return { answer: { totalCount: database.prepare('SELECT COUNT(*) AS rowCount FROM agents').get().rowCount, agentList: agentIriList.map((agentIri) => ({ profile: profileByIri[agentIri] })) } };
	};

	// 12
	const layerListFor = () => {
		const loaded = loadedRegistry();
		if (loaded.error) {
			return loaded;
		}
		return { answer: loaded.registry.layerRegistry.layerList.map((oneLayer) => { const current = loaded.registry.currentStandardVersionFor(oneLayer.layerKey); return { layerKey: oneLayer.layerKey, displayName: oneLayer.displayName, layerKind: oneLayer.layerKind, versionCount: oneLayer.versionList.length, currentStandardVersionTag: current.error ? null : current.version.administrationRecord.versionTag }; }) };
	};

	// 13-15: the hub cards of a manifest (derivedHubCards joined to its members). A card with no domain (CTDL's, measured) counts in
	// its hub's cardCount but in no domain; domains are listed by domainId and cards by meaningIri, code-point order, so pages are stable
	const cardFromSql = 'FROM derivedHubCards AS cards JOIN publishedManifestMembers AS members ON members.schemaBlockRefId = cards.schemaBlockRefId WHERE members.manifestRefId = ?';
	const manifestHubListFor = (manifestSelector) => {
		const found = manifestRowFor(manifestSelector);
		if (found.error || found.manifestRow === null) {
			return found.error ? found : { answer: null };
		}
		const hubList = database.prepare(`SELECT cards.hubName AS hubName, cards.hubVersion AS hubVersion, cards.hubSegment AS hubSegment, cards.hubReleaseSegment AS hubReleaseSegment, COUNT(DISTINCT cards.meaningIri) AS cardCount, COUNT(DISTINCT cards.domainId) AS domainCount ${cardFromSql} GROUP BY cards.hubSegment, cards.hubReleaseSegment, cards.hubName, cards.hubVersion ORDER BY cards.hubSegment, cards.hubReleaseSegment`).all(found.manifestRow.manifestRefId);
		return { answer: { manifestRefId: found.manifestRow.manifestRefId, publicLabel: found.manifestRow.publicLabel, hubList } };
	};
	const hubDomainListFor = (manifestSelector, { hubSegment, hubReleaseSegment, pageNumber, pageSize } = {}) => {
		const fault = pageRefusal({ pageNumber, pageSize });
		if (fault) {
			return { error: fault };
		}
		const found = manifestRowFor(manifestSelector);
		if (found.error || found.manifestRow === null) {
			return found.error ? found : { answer: null };
		}
		const scopeSql = `${cardFromSql} AND cards.hubSegment = ? AND cards.hubReleaseSegment = ? AND cards.domainId IS NOT NULL`;
		const parameterList = [found.manifestRow.manifestRefId, hubSegment, hubReleaseSegment];
		const domainList = database.prepare(`SELECT cards.domainId AS domainId, MIN(cards.domainName) AS domainName, MIN(cards.domainUri) AS domainUri, MIN(cards.domainDefinition) AS domainDefinition, COUNT(DISTINCT cards.meaningIri) AS cardCount ${scopeSql} GROUP BY cards.domainId ORDER BY cards.domainId LIMIT ? OFFSET ?`).all(...parameterList, pageSize, (pageNumber - 1) * pageSize);
		return { answer: { totalCount: database.prepare(`SELECT COUNT(DISTINCT cards.domainId) AS rowCount ${scopeSql}`).get(...parameterList).rowCount, domainList } };
	};
	const hubDomainCardListFor = (manifestSelector, { hubSegment, hubReleaseSegment, domainId, pageNumber, pageSize } = {}) => {
		const fault = pageRefusal({ pageNumber, pageSize });
		if (fault) {
			return { error: fault };
		}
		const found = manifestRowFor(manifestSelector);
		if (found.error || found.manifestRow === null) {
			return found.error ? found : { answer: null };
		}
		const scopeSql = `${cardFromSql} AND cards.hubSegment = ? AND cards.hubReleaseSegment = ? AND cards.domainId = ?`;
		const parameterList = [found.manifestRow.manifestRefId, hubSegment, hubReleaseSegment, domainId];
		const cardList = database.prepare(`SELECT DISTINCT cards.meaningIri AS meaningIri, cards.label AS label, cards.definition AS definition, cards.propertyName AS propertyName, cards.propertyKey AS propertyKey, cards.referenceTier AS referenceTier ${scopeSql} ORDER BY cards.meaningIri LIMIT ? OFFSET ?`).all(...parameterList, pageSize, (pageNumber - 1) * pageSize);
		return { answer: { totalCount: database.prepare(`SELECT COUNT(DISTINCT cards.meaningIri) AS rowCount ${scopeSql}`).get(...parameterList).rowCount, cardList } };
	};

	return { manifestHubListFor, hubDomainListFor, hubDomainCardListFor, layerListFor, elementRecordFor, publishedLayerVersionListForStandard, mappingsToMeaningFor, layerHistoryFor, layerVersionRecordFor, manifestInventoryFor, rootCountsFor, publishedManifestListFor, manifestStandardListFor, manifestElementListFor, agentListFor };
};

module.exports = { uriContractRelationsFor, PAGE_SIZE_LIMIT, moduleName };
