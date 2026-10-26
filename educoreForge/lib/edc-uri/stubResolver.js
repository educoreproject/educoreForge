'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// stubResolver.js — the LOCAL stand-in for the w3id redirect plus resolver (mappingLayers ML1, AMENDMENT: TQ ruled NO public
// registration, "make a stub"; R-5). It answers what an edc: URI names, by SPEC §5.3, for the kinds ML1 can answer; every other
// kind is answered 501 by name, never guessed. The resolution is a pure function over INJECTED lookups (the registry and a block
// reader), so no storage is touched here; stubResolverServer.js is the HTTP shell and the one place a store is opened.
//
//   resolveEdcUri({ uriOrPath, registry, blockTextForHash, uriContractReader }, cb) → cb('', { httpStatus, body })
//     uriOrPath         an edc IRI, an edc: CURIE, or the path a request carries ('/EDUcore/<path>' or '/<path>')
//     registry          lib/layer-registry registryFor(...).registry
//     blockTextForHash  (decisionBlockHash, cb(err, frozenText | null))
//     uriContractReader ⟪ML3.1, O-4⟫ OPTIONAL; the kinds that need it (questions, schemaBlock, decisionSchemaBlock) answer 501 by name
//                       without it. lib/uri-contract implements it (lane B); a test passes a double. @interface UriContractReader:
//       schemaBlockFor(schemaBlockRefId, cb(err, { schemaBlockRefId, blockKind, subject, version, text } | null))
//       decisionSchemaBlockFor(decisionBlockHash, cb(err, { decisionBlockHash, pairKey, frozenText } | null))
//       publishedManifestFor({ publicLabel } | { manifestRefId }, cb(err, { manifestRefId, publicLabel, publishedAt,
//           latestStatus: { registrationStatus, changedAt }, memberList: [{ schemaBlockRefId, position }],
//           defaultLayerByHub: null | { <hubSegment>: { decisionBlockHashList } } } | null))
//       agentRecordFor(agentIri, cb(err, { profile: { agentIri, agentKind, displayName, aliasIri }, layersAuthored: [...], scores: {...} } | null))
//           ⟪TQ ruling Q3, relayed by AMBER_JOURNEY 2026-10-26⟫ a profile plus a computed record; the stub answers ONLY the profile
//           fields AGENT_PROFILE_FIELD_LIST names, so nothing else a reader carries can leak (persons are strictly pseudonymous)
//     ⟪ML3.1, TQ Q4: every URI answers the thing PLUS its relations, computed from uriContract, never stored⟫
//       elementRecordFor({ standardName, standardVersion, elementStableId }, cb(err, { schemaBlockRefId, node: { stableId, labels,
//           properties }, parentStableId | null, siblingStableIdList, definitionText | null } | null))
//       publishedLayerVersionListForStandard({ standardName, standardVersion }, cb(err, [{ layerKey, versionTag, registrationStatus }]))
//       mappingsToMeaningFor(meaningIri, cb(err, [{ manifestRefId, standardName, standardVersion, layerKey | null, versionTag | null,
//           relationType, elementCount }]))
//       layerHistoryFor(layerKey, cb(err, { layerKey, displayName, layerKind, authorAgentIri, versionList: [{ versionTag, contentId,
//           publishedAt, statusHistory: [{ registrationStatus, changedAt, changedBy }], scores | null }] } | null))
//       layerVersionRecordFor({ layerKey, versionTag }, cb(err, { authorAgentIri, publishedAt, latestStatus, countByStandard,
//           countByHub, abstentionRate, agreementScores | null } | null))
//       manifestInventoryFor({ publicLabel } | { manifestRefId }, cb(err, { manifestRefId, publicLabel, publishedAt, latestStatus,
//           standardList: [{ standardName, standardVersion }], hubList, layerVersionList, nodeCount, edgeCount } | null))
//     ⟪ML3.1, TQ Q5: discovery⟫ listings are paged as uriScheme.json listingPaging says (?page=N, fixed pageSize)
//       rootCountsFor(cb(err, { manifestCount, layerCount, layerVersionCount, agentCount }))
//       publishedManifestListFor({ pageNumber, pageSize }, cb(err, { totalCount, manifestList: [{ manifestRefId, publicLabel, publishedAt, latestStatus }] }))
//       manifestStandardListFor({ publicLabel } | { manifestRefId }, cb(err, { manifestRefId, publicLabel, standardList: [{ standardName,
//           standardVersion, standardKey, elementCount, schemaBlockRefId }] } | null))
//       manifestElementListFor({ publicLabel } | { manifestRefId }, { standardName, standardVersion, pageNumber, pageSize },
//           cb(err, { totalCount, elementList: [{ elementStableId, role | null }] } | null))   ordered by stableId (code point)
//       agentListFor({ pageNumber, pageSize }, cb(err, { totalCount, agentList: [{ profile }] }))
//       layerListFor(cb(err, [{ layerKey, displayName, layerKind, versionCount, currentStandardVersionTag | null }]))   the site registry
//     ⟪ML3.1, TQ Q7: card listings; a hub's domains are the distinct domainId its cards carry, read verbatim (the hub's own classes)⟫
//       manifestHubListFor({ publicLabel } | { manifestRefId }, cb(err, { manifestRefId, publicLabel, hubList: [{ hubName, hubVersion,
//           hubSegment, hubReleaseSegment, cardCount, domainCount }] } | null))
//       hubDomainListFor(address, { hubSegment, hubReleaseSegment, pageNumber, pageSize }, cb(err, { totalCount, domainList: [{ domainId,
//           domainName, domainUri, domainDefinition, cardCount }] } | null))   ordered by domainId (code point)
//       hubDomainCardListFor(address, { hubSegment, hubReleaseSegment, domainId, pageNumber, pageSize }, cb(err, { totalCount,
//           cardList: [{ meaningIri, label, definition, propertyName, propertyKey, referenceTier }] } | null))   ordered by meaningIri
//       Every hash the reader hands over it has verified on read; null means "not published", never an error.
//
// ANSWERS: layer → its current STANDARD version (never merely the newest); layerVersion / layerVersionByContent → the version's
// administration record, status and member blocks; assertion → the one record of its block whose recomputed assertion id is this
// URI; agent kinds → the agent registry row; element / meaning → the parse (their graph lookup is not ML1's); ⟪ML3⟫ interpretation
// (pinned and floating) → the version's assertions for the element, or an explicit NoTermFound; ⟪ML3.1⟫ question kinds (by label or
// by manifest hash, with or without a hub) → the rows of the manifest's OWN relationship schema blocks whose from-node is the element,
// each with its provenance (ruling (b), AMBER_JOURNEY 2026-10-26; defaultLayerByHub only settles a hub answered by two producers);
// schemaBlock / decisionSchemaBlock → the frozen text, or for a licence-held standard 451 with the metadata and the reason (Q51, never
// a bare 404); manifest kinds → 501 (ML5). Minted URIs keep their w3id spelling; the stub serves them under a private hostname.

const path = require('path');
const edcUri = require(path.join(__dirname, 'edcUri'));
const assertionIdentity = require(path.join(__dirname, 'assertionIdentity'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const materialiserLib = require(path.join(__dirname, '..', 'bridge-framework', 'materialiser'));

const { URI_SCHEME } = edcUri;
// ⟪ML3.1, Q51⟫ which standards' texts are withheld, read as DATA from the same list the downloads obey (JEDx leaves it in Part C)
const DOWNLOAD_ARTIFACTS_RULES = require(path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'lib', 'downloadArtifactsRules.json'));
if (!Array.isArray(DOWNLOAD_ARTIFACTS_RULES.licenceHoldList)) {
	throw refuse.byName({ moduleName, what: 'downloadArtifactsRules.json has no licenceHoldList', where: 'apps/graph-builder/lib/downloadArtifactsRules.json (state [] for none)' });
}
const LICENCE_HOLD_BY_STANDARD_KEY = Object.freeze(DOWNLOAD_ARTIFACTS_RULES.licenceHoldList.reduce((soFar, oneHold) => ({ ...soFar, [oneHold.bundleToken]: oneHold }), {}));
const W3ID_PATH_PREFIX = `/${URI_SCHEME.baseIri.replace(/^https?:\/\/[^/]+\//, '')}`; // '/EDUcore/'
const STUB_NOTE = 'answered by the LOCAL STUB resolver (lib/edc-uri/stubResolver.js); edc: URIs are not publicly registered (TQ, 2026-10-24)';

const answer = (httpStatus, body) => ({ httpStatus, body: { ...body, stubNote: STUB_NOTE } });

// edcIriFor(uriOrPath) → the edc IRI a request names: a full IRI or CURIE as given, or a request path under '/EDUcore/' or '/'
const edcIriFor = (uriOrPath) => {
	if (typeof uriOrPath !== 'string') {
		return uriOrPath;
	}
	if (uriOrPath.indexOf(URI_SCHEME.baseIri) === 0 || uriOrPath.indexOf(`${URI_SCHEME.curiePrefix}:`) === 0) {
		return uriOrPath;
	}
	const pathText = uriOrPath.split('?')[0];
	return `${URI_SCHEME.baseIri}${pathText.indexOf(W3ID_PATH_PREFIX) === 0 ? pathText.slice(W3ID_PATH_PREFIX.length) : pathText.replace(/^\//, '')}`;
};

// assertionRecordFor({ frozenText, assertionIri }) → { record } | { error }: a machine block is JSON; its records are matched by
// recomputing each planned edge's assertion id from the block header's standards and versions
const assertionRecordFor = ({ frozenText, assertionIri, decisionBlockHash }) => {
	if (frozenText.charAt(0) !== '{') {
		// a layer set (SSSOM/TSV): the row whose record_id is this IRI
		const lineList = frozenText.split('\n').filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
		const columnList = lineList.length ? lineList[0].split('\t') : [];
		const recordIdIndex = columnList.indexOf('record_id');
		const rowLine = recordIdIndex === -1 ? undefined : lineList.slice(1).find((oneLine) => oneLine.split('\t')[recordIdIndex] === assertionIri);
		return rowLine === undefined ? { error: 'no row of this set carries that record_id' } : { record: columnList.reduce((soFar, oneColumn, columnIndex) => ({ ...soFar, [oneColumn]: rowLine.split('\t')[columnIndex] }), {}) };
	}
	const block = JSON.parse(frozenText);
	const header = block.header;
	// the block's own edge shape names its predicate_id, exactly as the materialiser and the exporter read it
	const shapeLookup = materialiserLib.edgeShapeRowFor(block);
	if (shapeLookup.error) {
		return { error: shapeLookup.error };
	}
	const predicateCurieFor = (oneRecord) => shapeLookup.edgeShapeRow.sssomPredicateIdFor(oneRecord.predicate);
	const plannedList = block.decisionRecordList
		.filter((oneRecord) => typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0)
		.reduce((soFar, oneRecord) => soFar.concat((oneRecord.instanceStableIdList === undefined ? [oneRecord.subjectStableId] : oneRecord.instanceStableIdList).map((fromStableId) => ({ oneRecord, fromStableId }))), []);
	const found = plannedList.find(({ oneRecord, fromStableId }) => {
		const computed = assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId: fromStableId, subjectStandardName: header.sourceStandardName, subjectStandardVersion: String(header.sourceVersion), predicateCurie: predicateCurieFor(oneRecord), objectStableId: oneRecord.objectStableId, objectStandardName: header.hubName, objectStandardVersion: String(header.hubVersion) });
		return computed.assertionId === assertionIri;
	});
	return found === undefined ? { error: 'no edge this block writes has that assertion id' } : { record: { subjectStableId: found.fromStableId, judgedSubjectStableId: found.oneRecord.subjectStableId, predicate: found.oneRecord.predicate, objectStableId: found.oneRecord.objectStableId, resolution: found.oneRecord.resolution, confidence: found.oneRecord.confidence, mappingMethod: found.oneRecord.mappingMethod, judgeIdentity: found.oneRecord.judge && found.oneRecord.judge.judgeModel, subjectSource: header.sourceStandardName, subjectVersion: header.sourceVersion, objectSource: header.hubName, objectVersion: header.hubVersion } };
};

// ⟪ML3, the FADED_ORBIT gap⟫ interpretationOf — SPEC §5.3: a PINNED interpretation is the set of that layer version's assertions whose
// subject is the element; zero rows is an explicit NoTermFound answer, never another layer's answer. Machine versions read only the member
// blocks of the element's standard (pairKey) and match on the from-node (the instance under fan-out); curated and imported versions read
// their stored set: a curated row's id is the R-c' recipe (s p o author, scoped by the stored set), an imported row's subject resolves
// through the prefix map its import recorded. What the stub cannot give without a graph (the meaning's definition text) is named.
const NO_TERM_FOUND_OBJECT_ID = 'sssom:NoTermFound';
const NO_TERM_FOUND_PREDICATE_ID = 'skos:mappingRelation';
const setRowListOf = (frozenText) => {
	const lineList = frozenText.split('\n').filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
	const columnList = lineList.length ? lineList[0].split('\t') : [];
	return lineList.slice(1).map((oneLine) => oneLine.split('\t').reduce((soFar, oneCell, cellIndex) => ({ ...soFar, [columnList[cellIndex]]: oneCell }), {}));
};
const machineAssertionListFor = ({ frozenText, decisionBlockHash, elementStableId, standardName, standardVersion }) => {
	const block = JSON.parse(frozenText);
	const { header } = block;
	if (header.sourceStandardName !== standardName || String(header.sourceVersion) !== standardVersion) {
		return { assertionList: [] };
	}
	const shapeLookup = materialiserLib.edgeShapeRowFor(block);
	if (shapeLookup.error) {
		return { error: shapeLookup.error };
	}
	const assertionList = [];
	for (let recordIndex = 0; recordIndex < block.decisionRecordList.length; recordIndex++) {
		const oneRecord = block.decisionRecordList[recordIndex];
		const fromStableIdList = oneRecord.instanceStableIdList === undefined ? [oneRecord.subjectStableId] : oneRecord.instanceStableIdList;
		if (fromStableIdList.indexOf(elementStableId) === -1) {
			continue;
		}
		const isAbstention = !(typeof oneRecord.objectStableId === 'string' && oneRecord.objectStableId.length > 0);
		const predicateCurie = isAbstention ? NO_TERM_FOUND_PREDICATE_ID : shapeLookup.edgeShapeRow.sssomPredicateIdFor(oneRecord.predicate);
		const identity = assertionIdentity.assertionIdFor({ decisionBlockHash, subjectStableId: elementStableId, subjectStandardName: standardName, subjectStandardVersion: standardVersion, predicateCurie, objectStableId: isAbstention ? NO_TERM_FOUND_OBJECT_ID : oneRecord.objectStableId, objectStandardName: header.hubName, objectStandardVersion: String(header.hubVersion) });
		if (identity.error) {
			return { error: identity.error };
		}
		assertionList.push({ assertionId: identity.assertionId, predicate: predicateCurie, object: isAbstention ? NO_TERM_FOUND_OBJECT_ID : oneRecord.objectStableId, hubName: header.hubName, hubVersion: String(header.hubVersion), resolution: oneRecord.resolution === undefined ? null : oneRecord.resolution, confidence: oneRecord.confidence === undefined ? null : oneRecord.confidence, judgedSubjectStableId: oneRecord.subjectStableId });
	}
	return { assertionList };
};
const setAssertionListFor = ({ frozenText, decisionBlockHash, elementStableId, elementIri, standardName, standardVersion, layer, version }) => {
	const prefixExpansion = version.importRecord !== undefined ? version.importRecord.prefixExpansion : undefined;
	const objectVersionLine = frozenText.split('\n').find((oneLine) => oneLine.startsWith('#object_source_version: '));
	const objectSourceVersion = objectVersionLine === undefined ? undefined : JSON.parse(objectVersionLine.slice('#object_source_version: '.length));
	const assertionList = [];
	const rowList = setRowListOf(frozenText);
	for (let rowIndex = 0; rowIndex < rowList.length; rowIndex++) {
		const oneRow = rowList[rowIndex];
		if (prefixExpansion !== undefined) {
			const prefix = oneRow.subject_id.slice(0, Math.max(oneRow.subject_id.indexOf(':'), 0));
			const subjectIri = /^https?:\/\//.test(oneRow.subject_id) ? oneRow.subject_id : prefixExpansion[prefix] === undefined ? '' : `${prefixExpansion[prefix]}${oneRow.subject_id.slice(prefix.length + 1)}`;
			if (subjectIri === elementIri) {
				assertionList.push({ assertionId: oneRow.record_id || null, predicate: oneRow.predicate_id, object: oneRow.object_id, authorId: oneRow.author_id || null, sourceRowNumber: rowIndex + 1 });
			}
			continue;
		}
		if (oneRow.subject_id !== elementStableId) {
			continue;
		}
		const identity = assertionIdentity.curatedAssertionIdFor({ decisionBlockHash, subjectStableId: elementStableId, subjectStandardName: standardName, subjectStandardVersion: standardVersion, predicateCurie: oneRow.predicate_id, objectStableId: oneRow.object_id, objectStandardName: layer.hubList[0].hubName, objectStandardVersion: objectSourceVersion, authorIdList: (oneRow.author_id || '').split('|').filter((oneAuthor) => oneAuthor.length) });
		if (identity.error) {
			return { error: identity.error };
		}
		assertionList.push({ assertionId: identity.assertionId, predicate: oneRow.predicate_id, object: oneRow.object_id, authorId: oneRow.author_id });
	}
	return { assertionList };
};
const interpretationOf = ({ kind, partByName, layerKey, version, registry, blockTextForHash }, done) => {
	const found = registry.layerFor(layerKey);
	if (found.error) {
		done(answer(404, { error: found.error }));
		return;
	}
	const { standardName, standardVersion, elementStableId } = partByName;
	const elementMint = edcUri.mint({ kind: 'element', standardName, standardVersion, elementStableId });
	const versionTag = version.administrationRecord.versionTag;
	const standardKey = elementStableId.slice(0, elementStableId.indexOf(':'));
	const isMachine = version.contentIdBasis === 'sortedMemberBlockHashList';
	const blockList = isMachine ? version.memberBlockList.filter((oneMember) => oneMember.pairKey.split('::')[1].split('@')[0] === standardKey) : [version.wholeSetBlock];
	const collected = [];
	const readNext = (blockIndex) => {
		if (blockIndex >= blockList.length) {
			const mappedList = collected.filter((oneAssertion) => oneAssertion.object !== NO_TERM_FOUND_OBJECT_ID);
			done(answer(200, {
				kind,
				element: elementMint.uri,
				layerVersion: edcUri.mint({ kind: 'layerVersion', layerKey, versionTag }).uri,
				effectiveRegistrationStatus: registry.effectiveStatusFor({ layerKey, versionTag }).registrationStatus,
				answer: mappedList.length === 0 ? NO_TERM_FOUND_OBJECT_ID : 'assertionList',
				answerNote: mappedList.length === 0 ? `this layer, at version ${versionTag}, found no meaning for this element${collected.length ? ' (it abstained)' : ' (it holds no row for it)'}; never another layer's answer` : `${mappedList.length} meaning(s): an interpretation is a set`,
				assertionList: collected,
				notServed: 'the meaning\'s definition text and label need the graph; the stub answers from the frozen layer version alone',
			}));
			return;
		}
		blockTextForHash(blockList[blockIndex].decisionBlockHash, (readError, frozenText) => {
			if (readError || frozenText === null) {
				done(answer(404, { error: readError || `no decision block ${blockList[blockIndex].decisionBlockHash} in the store` }));
				return;
			}
			const read = isMachine
				? machineAssertionListFor({ frozenText, decisionBlockHash: blockList[blockIndex].decisionBlockHash, elementStableId, standardName, standardVersion })
				: setAssertionListFor({ frozenText, decisionBlockHash: blockList[blockIndex].decisionBlockHash, elementStableId, elementIri: elementMint.uri, standardName, standardVersion, layer: found.layer, version });
			if (read.error) {
				done(answer(500, { error: read.error }));
				return;
			}
			collected.push(...read.assertionList);
			readNext(blockIndex + 1);
		});
	};
	readNext(0);
};

// ⟪ML3.1, Q51⟫ the standards a stored block names, read from the block itself: a schema block's header (standardKey, or pairA/pairB);
// a decision block's pairKey ('<hub>@<v>::<standard>@<v>::…'), or for a stored set (pairKey 'layerSet::…') its rows' subject prefixes
const schemaBlockStandardKeyListFor = (text) => {
	const headerLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
	const header = headerLine.charAt(0) === '{' ? JSON.parse(headerLine) : {};
	return [header.standardKey, header.pairA, header.pairB].filter((oneStandardKey) => typeof oneStandardKey === 'string');
};
const decisionBlockStandardKeyListFor = ({ pairKey, frozenText }) => {
	const fieldList = pairKey.split('::');
	if (fieldList.length >= 2 && fieldList[0].indexOf('@') !== -1 && fieldList[1].indexOf('@') !== -1) {
		return [fieldList[0].split('@')[0], fieldList[1].split('@')[0]];
	}
	return Array.from(new Set(setRowListOf(frozenText).map((oneRow) => (oneRow.subject_id || '').slice(0, Math.max((oneRow.subject_id || '').indexOf(':'), 0))).filter((onePrefix) => onePrefix.length > 0))).sort();
};
const withheldAnswerFor = ({ standardKeyList, metadata }) => {
	const heldList = standardKeyList.filter((oneStandardKey) => LICENCE_HOLD_BY_STANDARD_KEY[oneStandardKey] !== undefined);
	return heldList.length === 0 ? null : answer(451, { ...metadata, standardKeyList, textWithheld: true, withheldReasonList: heldList.map((oneStandardKey) => ({ standardKey: oneStandardKey, unavailableReason: LICENCE_HOLD_BY_STANDARD_KEY[oneStandardKey].unavailableReason })) });
};
// the fields an agent answer may carry (DATA): a profile and the computed record, never a username, e-mail or any other identifying field
const AGENT_PROFILE_FIELD_LIST = Object.freeze(['agentIri', 'agentKind', 'displayName', 'aliasIri']);
const agentRecordAnswerFor = ({ kind, iri, uriContractReader }, done) =>
	uriContractReader.agentRecordFor(iri, (readError, agentRecord) => {
		if (readError || agentRecord === null) {
			done(answer(404, { kind, error: readError || `agent ${iri} is not in uriContract` }));
			return;
		}
		const profile = agentRecord.profile === null || typeof agentRecord.profile !== 'object' ? {} : agentRecord.profile;
		done(answer(200, { ...AGENT_PROFILE_FIELD_LIST.reduce((soFar, oneFieldName) => (profile[oneFieldName] === undefined ? soFar : { ...soFar, [oneFieldName]: profile[oneFieldName] }), { kind }), layersAuthored: agentRecord.layersAuthored, scores: agentRecord.scores }));
	});
// an agent kind answers from uriContract when the stub has a reader; without one, from the registry row as in ML1 (lane B repoints it)
const agentResolutionFor = (kind) => ({ iri, registry, uriContractReader }, done) => (uriContractReader === undefined ? done(agentAnswerFor({ iri, registry })) : agentRecordAnswerFor({ kind, iri, uriContractReader }, done));
const NO_READER_ERROR = (kind) => `the stub was started without a uriContract reader, so kind '${kind}' (served from uriContract.sqlite) cannot be answered`;

// ⟪ML3.1, ruling (b)⟫ questionAnswerFor — read the manifest's relationship schema blocks, keep the edges whose from-node is the element
// (and whose hub card is under hubSegment, for a hub question), each row with its provenance; defaultLayerByHub (when the manifest
// declares one for a hub) keeps only that producer's rows for that hub
const questionAnswerFor = ({ kind, partByName, iri, uriContractReader }, done) => {
	const manifestAddress = partByName.manifestRefId !== undefined ? { manifestRefId: partByName.manifestRefId } : { publicLabel: partByName.publicLabel };
	uriContractReader.publishedManifestFor(manifestAddress, (readError, manifest) => {
		if (readError || manifest === null) {
			done(answer(404, { kind, error: readError || `no published manifest ${JSON.stringify(manifestAddress)}` }));
			return;
		}
		const { standardName, standardVersion, elementStableId, hubSegment } = partByName;
		const defaultLayerByHub = manifest.defaultLayerByHub === null ? {} : manifest.defaultLayerByHub;
		const orderedMemberList = manifest.memberList.slice().sort((leftMember, rightMember) => leftMember.position - rightMember.position);
		const rowList = [];
		const readNext = (memberIndex) => {
			if (memberIndex >= orderedMemberList.length) {
				done(answer(200, { kind, question: iri, manifestRefId: manifest.manifestRefId, publicLabel: manifest.publicLabel, manifestPublishedAt: manifest.publishedAt, manifestLatestStatus: manifest.latestStatus, element: edcUri.mint({ kind: 'element', standardName, standardVersion, elementStableId }).uri, hubSegment: hubSegment === undefined ? null : hubSegment, answer: rowList.length === 0 ? 'sssom:NoTermFound' : 'rowList', answerNote: rowList.length === 0 ? `no relationship schema block of this manifest maps this element${hubSegment === undefined ? '' : ` to the ${hubSegment} hub`}` : `${rowList.length} row(s) from this manifest's own relationship schema blocks`, rowList }));
				return;
			}
			uriContractReader.schemaBlockFor(orderedMemberList[memberIndex].schemaBlockRefId, (blockError, schemaBlock) => {
				if (blockError || schemaBlock === null) {
					done(answer(500, { kind, error: blockError || `manifest member ${orderedMemberList[memberIndex].schemaBlockRefId} is not in uriContract` }));
					return;
				}
				if (schemaBlock.blockKind !== 'relationship') {
					readNext(memberIndex + 1);
					return;
				}
				const lineList = schemaBlock.text.split('\n');
				const header = JSON.parse(lineList[0]);
				lineList.slice(1).forEach((oneLine) => {
					if (oneLine.indexOf('"kind":"edge"') === -1) {
						return;
					}
					const edge = JSON.parse(oneLine);
					const edgeProperties = edge.properties;
					const firstOf = (propertyName) => (Array.isArray(edgeProperties[propertyName]) ? edgeProperties[propertyName][0] : null);
					if (edge.fromRef.id !== elementStableId || edge.fromRef.source !== standardName || String(firstOf('subjectVersion')) !== standardVersion) {
						return;
					}
					const objectParse = edcUri.parse(edge.toRef.id);
					const objectHubSegment = objectParse.kind === 'meaning' ? objectParse.partByName.hubSegment : null;
					if (hubSegment !== undefined && objectHubSegment !== hubSegment) {
						return;
					}
					const declaredDefault = objectHubSegment === null ? undefined : defaultLayerByHub[objectHubSegment];
					if (declaredDefault !== undefined && declaredDefault.decisionBlockHashList.indexOf(firstOf('decisionBlockHash')) === -1) {
						return;
					}
					rowList.push({ assertionId: firstOf('assertionId'), edgeType: edge.type, predicate: firstOf('predicate'), object: edge.toRef.id, objectSource: firstOf('objectSource'), objectVersion: firstOf('objectVersion'), hubSegment: objectHubSegment, provenance: { schemaBlockRefId: schemaBlock.schemaBlockRefId, producer: header.producer, mappingSource: firstOf('mappingSource'), matchBasis: firstOf('matchBasis'), mappingKind: firstOf('mappingKind'), decisionBlockHash: firstOf('decisionBlockHash'), judgeIdentity: firstOf('judgeIdentity') } });
				});
				readNext(memberIndex + 1);
			});
		};
		readNext(0);
	});
};
const withReader = (kind, resolution) => (context, done) => (context.uriContractReader === undefined ? done(answer(501, { kind, error: NO_READER_ERROR(kind) })) : resolution(context, done));

// ⟪ML3.1, Q4⟫ relation answers. mintUriOf: a URI the stub writes into an answer, minted through edcUri (lane B hard-codes no spelling)
const mintUriOf = (partByName) => edcUri.mint(partByName).uri;
const manifestAddressOf = (partByName) => (partByName.manifestRefId !== undefined ? { manifestRefId: partByName.manifestRefId } : { publicLabel: partByName.publicLabel });
const manifestUriOf = (manifestAddress) => (manifestAddress.manifestRefId !== undefined ? mintUriOf({ kind: 'manifestByContent', manifestRefId: manifestAddress.manifestRefId }) : mintUriOf({ kind: 'manifest', publicLabel: manifestAddress.publicLabel }));
const readerAnswer = ({ kind, readError, found, notFoundText }, answerBodyFor) => (readError ? answer(500, { kind, error: readError }) : found === null ? answer(404, { kind, error: notFoundText }) : answer(200, { kind, ...answerBodyFor(found) }));
// the floating version of a layer, from its history: the latest-published version whose LATEST status is Standard (SPEC §5.3)
const currentStandardTagOf = (history) => {
	const standardList = history.versionList.filter((oneVersion) => oneVersion.statusHistory.length > 0 && oneVersion.statusHistory[oneVersion.statusHistory.length - 1].registrationStatus === 'Standard').sort((leftVersion, rightVersion) => (leftVersion.publishedAt < rightVersion.publishedAt ? 1 : leftVersion.publishedAt > rightVersion.publishedAt ? -1 : 0));
	return standardList.length === 0 ? null : standardList[0].versionTag;
};
const elementAnswerFor = ({ partByName, iri, uriContractReader }, done) => {
	const { standardName, standardVersion, elementStableId } = partByName;
	uriContractReader.elementRecordFor({ standardName, standardVersion, elementStableId }, (readError, elementRecord) => {
		if (readError || elementRecord === null) {
			done(readError ? answer(500, { kind: 'element', error: readError }) : answer(404, { kind: 'element', error: `no published schema block holds ${standardName} ${standardVersion} element ${elementStableId}` }));
			return;
		}
		uriContractReader.publishedLayerVersionListForStandard({ standardName, standardVersion }, (listError, layerVersionList) => {
			if (listError) {
				done(answer(500, { kind: 'element', error: listError }));
				return;
			}
			const elementUriOf = (stableId) => mintUriOf({ kind: 'element', standardName, standardVersion, elementStableId: stableId });
			done(answer(200, {
				kind: 'element',
				element: iri,
				partByName,
				definitionText: elementRecord.definitionText,
				node: elementRecord.node,
				schemaBlock: mintUriOf({ kind: 'schemaBlock', schemaBlockRefId: elementRecord.schemaBlockRefId }),
				parent: elementRecord.parentStableId === null ? null : elementUriOf(elementRecord.parentStableId),
				siblingList: elementRecord.siblingStableIdList.map(elementUriOf),
				interpretationList: layerVersionList.map((oneLayerVersion) => ({ ...oneLayerVersion, pinned: mintUriOf({ kind: 'interpretationPinned', standardName, standardVersion, elementStableId, layerKey: oneLayerVersion.layerKey, versionTag: oneLayerVersion.versionTag }), floating: mintUriOf({ kind: 'interpretationFloating', standardName, standardVersion, elementStableId, layerKey: oneLayerVersion.layerKey }) })),
			}));
		});
	});
};

// ⟪ML3.1, Q5⟫ pageNumberFor(queryText, kind) → { pageNumber } | { error }: only a listing takes a query, and only ?page=N
const LISTING_PAGING = URI_SCHEME.listingPaging;
const pageNumberFor = (queryText, kind) => {
	const isListing = LISTING_PAGING.listingKindList.indexOf(kind) !== -1;
	if (queryText === '') {
		return { pageNumber: LISTING_PAGING.firstPageNumber };
	}
	if (!isListing) {
		return { error: `kind '${kind}' takes no query ('?${queryText}'); only the listings (${LISTING_PAGING.listingKindList.join(', ')}) take ?${LISTING_PAGING.queryParameterName}=N` };
	}
	const matched = new RegExp(`^${LISTING_PAGING.queryParameterName}=([0-9]+)$`).exec(queryText);
	if (matched === null || !/^[1-9][0-9]*$/.test(matched[1]) || Number(matched[1]) < LISTING_PAGING.firstPageNumber) {
		return { error: `'?${queryText}' is not ?${LISTING_PAGING.queryParameterName}=N with N an integer from ${LISTING_PAGING.firstPageNumber} (uriScheme.json listingPaging; never clamped)` };
	}
	return { pageNumber: Number(matched[1]) };
};
// pagedAnswer — totalCount, page position and next/previous URLs; a page past the end is refused by name, never clamped
const pagedAnswer = ({ kind, iri, pageNumber, totalCount, itemListName, itemList, extra }) => {
	const pageCount = Math.max(1, Math.ceil(totalCount / LISTING_PAGING.pageSize));
	if (pageNumber > pageCount) {
		return answer(400, { kind, error: `page ${pageNumber} is past the end: ${totalCount} item(s) in ${pageCount} page(s) of ${LISTING_PAGING.pageSize} (never clamped)` });
	}
	const pageUrlOf = (oneNumber) => `${iri}?${LISTING_PAGING.queryParameterName}=${oneNumber}`;
	return answer(200, { kind, listing: iri, ...extra, totalCount, pageSize: LISTING_PAGING.pageSize, pageNumber, pageCount, next: pageNumber < pageCount ? pageUrlOf(pageNumber + 1) : null, previous: pageNumber > LISTING_PAGING.firstPageNumber ? pageUrlOf(pageNumber - 1) : null, [itemListName]: itemList });
};
const layerVersionRecordAnswerFor = ({ kind, layerKey, versionTag, uriContractReader }, done) =>
	uriContractReader.layerVersionRecordFor({ layerKey, versionTag }, (readError, versionRecord) =>
		done(readerAnswer({ kind, readError, found: versionRecord, notFoundText: `layer '${layerKey}' has no published version '${versionTag}'` }, (found) => ({ layerKey, versionTag, layerVersion: mintUriOf({ kind: 'layerVersion', layerKey, versionTag }), layer: mintUriOf({ kind: 'layer', layerKey }), ...found }))),
	);
const manifestInventoryAnswerFor = ({ kind, manifestAddress, uriContractReader }, done) =>
	uriContractReader.manifestInventoryFor(manifestAddress, (readError, inventory) =>
		done(readerAnswer({ kind, readError, found: inventory, notFoundText: `no published manifest ${JSON.stringify(manifestAddress)}` }, (found) => ({ manifest: mintUriOf({ kind: 'manifest', publicLabel: found.publicLabel }), manifestByContent: mintUriOf({ kind: 'manifestByContent', manifestRefId: found.manifestRefId }), standardListing: mintUriOf({ kind: 'manifestStandardList', publicLabel: found.publicLabel }), ...found, layerVersionList: found.layerVersionList.map((oneLayerVersion) => ({ ...oneLayerVersion, uri: mintUriOf({ kind: 'layerVersion', layerKey: oneLayerVersion.layerKey, versionTag: oneLayerVersion.versionTag }) })) }))),
	);
const manifestStandardListAnswerFor = ({ kind, partByName, iri, uriContractReader }, done) => {
	const manifestAddress = manifestAddressOf(partByName);
	uriContractReader.manifestStandardListFor(manifestAddress, (readError, found) =>
		done(readerAnswer({ kind, readError, found, notFoundText: `no published manifest ${JSON.stringify(manifestAddress)}` }, (standardListing) => ({
			listing: iri,
			manifest: manifestUriOf(manifestAddress),
			manifestRefId: standardListing.manifestRefId,
			publicLabel: standardListing.publicLabel,
			standardList: standardListing.standardList.map((oneStandard) => ({ ...oneStandard, elementListing: mintUriOf({ kind: manifestAddress.manifestRefId !== undefined ? 'manifestElementListByContent' : 'manifestElementList', ...manifestAddress, standardName: oneStandard.standardName, standardVersion: oneStandard.standardVersion }), schemaBlock: mintUriOf({ kind: 'schemaBlock', schemaBlockRefId: oneStandard.schemaBlockRefId }) })),
		}))),
	);
};
const manifestElementListAnswerFor = ({ kind, partByName, iri, pageNumber, uriContractReader }, done) => {
	const manifestAddress = manifestAddressOf(partByName);
	const { standardName, standardVersion } = partByName;
	uriContractReader.manifestElementListFor(manifestAddress, { standardName, standardVersion, pageNumber, pageSize: LISTING_PAGING.pageSize }, (readError, page) => {
		if (readError || page === null) {
			done(readError ? answer(500, { kind, error: readError }) : answer(404, { kind, error: `no published manifest ${JSON.stringify(manifestAddress)} lists ${standardName} ${standardVersion}` }));
			return;
		}
		const questionKind = manifestAddress.manifestRefId !== undefined ? 'questionByContent' : 'question';
		done(pagedAnswer({ kind, iri, pageNumber, totalCount: page.totalCount, itemListName: 'elementList', extra: { manifest: manifestUriOf(manifestAddress), standardName, standardVersion }, itemList: page.elementList.map((oneElement) => ({ ...oneElement, element: mintUriOf({ kind: 'element', standardName, standardVersion, elementStableId: oneElement.elementStableId }), question: mintUriOf({ kind: questionKind, ...manifestAddress, standardName, standardVersion, elementStableId: oneElement.elementStableId }) })) }));
	});
};
// ⟪ML3.1, Q7⟫ the hub, domain and card listings: every URI in them minted through edcUri, the manifest form kept (label or hash)
const kindFor = (manifestAddress, labelKind) => (manifestAddress.manifestRefId !== undefined ? `${labelKind}ByContent` : labelKind);
const manifestHubListAnswerFor = ({ kind, partByName, iri, uriContractReader }, done) => {
	const manifestAddress = manifestAddressOf(partByName);
	uriContractReader.manifestHubListFor(manifestAddress, (readError, found) =>
		done(readerAnswer({ kind, readError, found, notFoundText: `no published manifest ${JSON.stringify(manifestAddress)}` }, (hubListing) => ({
			listing: iri,
			manifest: manifestUriOf(manifestAddress),
			manifestRefId: hubListing.manifestRefId,
			publicLabel: hubListing.publicLabel,
			hubList: hubListing.hubList.map((oneHub) => ({ ...oneHub, domainListing: mintUriOf({ kind: kindFor(manifestAddress, 'hubDomainList'), ...manifestAddress, hubSegment: oneHub.hubSegment, hubReleaseSegment: oneHub.hubReleaseSegment }) })),
		}))),
	);
};
const hubDomainListAnswerFor = ({ kind, partByName, iri, pageNumber, uriContractReader }, done) => {
	const manifestAddress = manifestAddressOf(partByName);
	const { hubSegment, hubReleaseSegment } = partByName;
	uriContractReader.hubDomainListFor(manifestAddress, { hubSegment, hubReleaseSegment, pageNumber, pageSize: LISTING_PAGING.pageSize }, (readError, page) => {
		if (readError || page === null) {
			done(readError ? answer(500, { kind, error: readError }) : answer(404, { kind, error: `no published manifest ${JSON.stringify(manifestAddress)} holds hub ${hubSegment} ${hubReleaseSegment}` }));
			return;
		}
		done(pagedAnswer({ kind, iri, pageNumber, totalCount: page.totalCount, itemListName: 'domainList', extra: { manifest: manifestUriOf(manifestAddress), hubSegment, hubReleaseSegment }, itemList: page.domainList.map((oneDomain) => ({ ...oneDomain, cardListing: mintUriOf({ kind: kindFor(manifestAddress, 'hubDomainCardList'), ...manifestAddress, hubSegment, hubReleaseSegment, domainId: oneDomain.domainId }) })) }));
	});
};
const hubDomainCardListAnswerFor = ({ kind, partByName, iri, pageNumber, uriContractReader }, done) => {
	const manifestAddress = manifestAddressOf(partByName);
	const { hubSegment, hubReleaseSegment, domainId } = partByName;
	uriContractReader.hubDomainCardListFor(manifestAddress, { hubSegment, hubReleaseSegment, domainId, pageNumber, pageSize: LISTING_PAGING.pageSize }, (readError, page) => {
		if (readError || page === null) {
			done(readError ? answer(500, { kind, error: readError }) : answer(404, { kind, error: `no published manifest ${JSON.stringify(manifestAddress)} holds domain ${domainId} of hub ${hubSegment} ${hubReleaseSegment}` }));
			return;
		}
		done(pagedAnswer({ kind, iri, pageNumber, totalCount: page.totalCount, itemListName: 'cardList', extra: { manifest: manifestUriOf(manifestAddress), hubSegment, hubReleaseSegment, domainId }, itemList: page.cardList }));
	});
};
const profileOf = (profile) => AGENT_PROFILE_FIELD_LIST.reduce((soFar, oneFieldName) => (profile === null || typeof profile !== 'object' || profile[oneFieldName] === undefined ? soFar : { ...soFar, [oneFieldName]: profile[oneFieldName] }), {});

// RESOLUTION_BY_KIND — one row per kind the stub answers (DATA, no branch); a kind with no row is answered 501 by name
const RESOLUTION_BY_KIND = Object.freeze({
	layer: ({ partByName, registry, uriContractReader }, done) => {
		// ⟪ML3.1, Q4⟫ with a reader: the full version history with statuses, scores and dates, and the version it floats to
		if (uriContractReader !== undefined) {
			uriContractReader.layerHistoryFor(partByName.layerKey, (readError, history) =>
				done(readerAnswer({ kind: 'layer', readError, found: history, notFoundText: `layer '${partByName.layerKey}' is not in uriContract` }, (found) => {
					const currentStandardVersionTag = currentStandardTagOf(found);
					return { layerKey: partByName.layerKey, displayName: found.displayName, layerKind: found.layerKind, author: found.authorAgentIri, currentStandardVersionTag, currentStandardVersionUri: currentStandardVersionTag === null ? null : mintUriOf({ kind: 'layerVersion', layerKey: partByName.layerKey, versionTag: currentStandardVersionTag }), versionList: found.versionList.map((oneVersion) => ({ ...oneVersion, uri: mintUriOf({ kind: 'layerVersion', layerKey: partByName.layerKey, versionTag: oneVersion.versionTag }), uriByContent: mintUriOf({ kind: 'layerVersionByContent', layerKey: partByName.layerKey, contentId: oneVersion.contentId }) })) };
				})),
			);
			return;
		}
		const current = registry.currentStandardVersionFor(partByName.layerKey);
		done(current.error ? answer(404, { error: current.error }) : answer(200, { kind: 'layer', layerKey: partByName.layerKey, currentStandardVersion: current.version, currentStandardVersionUri: edcUri.mint({ kind: 'layerVersion', layerKey: partByName.layerKey, versionTag: current.version.administrationRecord.versionTag }).uri }));
	},
	layerVersion: ({ partByName, registry, uriContractReader }, done) => {
		if (uriContractReader !== undefined) {
			layerVersionRecordAnswerFor({ kind: 'layerVersion', layerKey: partByName.layerKey, versionTag: partByName.versionTag, uriContractReader }, done);
			return;
		}
		const found = registry.versionFor({ layerKey: partByName.layerKey, versionTag: partByName.versionTag });
		// the row keeps the status it was published with; the EFFECTIVE status (after appended changes) is answered beside it
		done(found.error ? answer(404, { error: found.error }) : answer(200, { kind: 'layerVersion', layerKey: partByName.layerKey, effectiveRegistrationStatus: registry.effectiveStatusFor({ layerKey: partByName.layerKey, versionTag: partByName.versionTag }).registrationStatus, version: found.version }));
	},
	layerVersionByContent: ({ partByName, registry, uriContractReader }, done) => {
		if (uriContractReader !== undefined) {
			uriContractReader.layerHistoryFor(partByName.layerKey, (readError, history) => {
				const version = readError || history === null ? undefined : history.versionList.find((oneVersion) => oneVersion.contentId === partByName.contentId);
				if (version === undefined) {
					done(readError ? answer(500, { kind: 'layerVersionByContent', error: readError }) : answer(404, { kind: 'layerVersionByContent', error: `layer '${partByName.layerKey}' has no published version with content ${partByName.contentId}` }));
					return;
				}
				layerVersionRecordAnswerFor({ kind: 'layerVersionByContent', layerKey: partByName.layerKey, versionTag: version.versionTag, uriContractReader }, done);
			});
			return;
		}
		const found = registry.layerFor(partByName.layerKey);
		const version = found.error ? undefined : found.layer.versionList.find((oneVersion) => oneVersion.administrationRecord.contentId === partByName.contentId);
		done(version === undefined ? answer(404, { error: found.error || `layer '${partByName.layerKey}' has no version with content ${partByName.contentId}` }) : answer(200, { kind: 'layerVersionByContent', layerKey: partByName.layerKey, effectiveRegistrationStatus: registry.effectiveStatusFor({ layerKey: partByName.layerKey, versionTag: version.administrationRecord.versionTag }).registrationStatus, version }));
	},
	assertion: ({ partByName, iri, blockTextForHash }, done) => {
		blockTextForHash(partByName.decisionBlockHash, (readError, frozenText) => {
			if (readError || frozenText === null) {
				done(answer(404, { error: readError || `no decision block ${partByName.decisionBlockHash} in the store` }));
				return;
			}
			const found = assertionRecordFor({ frozenText, assertionIri: iri, decisionBlockHash: partByName.decisionBlockHash });
			done(found.error ? answer(404, { error: found.error }) : answer(200, { kind: 'assertion', assertionId: iri, decisionBlockHash: partByName.decisionBlockHash, assertion: found.record }));
		});
	},
	agentPerson: agentResolutionFor('agentPerson'),
	agentJudge: agentResolutionFor('agentJudge'),
	agentOrganisation: agentResolutionFor('agentOrganisation'),
	interpretationPinned: ({ partByName, registry, blockTextForHash }, done) => {
		const found = registry.versionFor({ layerKey: partByName.layerKey, versionTag: partByName.versionTag });
		if (found.error) {
			done(answer(404, { error: found.error }));
			return;
		}
		interpretationOf({ kind: 'interpretationPinned', partByName, layerKey: partByName.layerKey, version: found.version, registry, blockTextForHash }, done);
	},
	// a FLOATING interpretation follows the layer's current STANDARD version, never merely its newest (SPEC §5.3); a layer with none says so
	interpretationFloating: ({ partByName, registry, blockTextForHash }, done) => {
		const current = registry.currentStandardVersionFor(partByName.layerKey);
		if (current.error) {
			done(answer(404, { error: current.error }));
			return;
		}
		interpretationOf({ kind: 'interpretationFloating', partByName, layerKey: partByName.layerKey, version: current.version, registry, blockTextForHash }, (resolved) => done({ ...resolved, body: { ...resolved.body, followedVersionTag: current.version.administrationRecord.versionTag } }));
	},
	// ⟪ML3-a⟫ a declared mapping predicate answers its definition (uriScheme.json vocabularyTermDefinitionByName)
	vocabularyTerm: ({ partByName, iri }, done) => done(answer(200, { kind: 'vocabularyTerm', term: iri, termName: partByName.termName, definition: URI_SCHEME.vocabularyTermDefinitionByName[partByName.termName] })),
	// ⟪ML3.1, Q4⟫ with a uriContract reader an element and a meaning answer their relations; without one, the parse as in ML1
	element: (context, done) => (context.uriContractReader === undefined ? done(answer(200, { kind: 'element', partByName: context.partByName, note: 'parsed only: the stub was started without a uriContract reader' })) : elementAnswerFor(context, done)),
	meaning: ({ partByName, iri, uriContractReader }, done) => {
		if (uriContractReader === undefined) {
			done(answer(200, { kind: 'meaning', partByName, note: 'parsed only: the stub was started without a uriContract reader' }));
			return;
		}
		uriContractReader.mappingsToMeaningFor(iri, (readError, mappingList) =>
			done(readerAnswer({ kind: 'meaning', readError, found: mappingList, notFoundText: '' }, (found) => ({ meaning: iri, partByName, mappedElementCount: found.reduce((soFar, oneRow) => soFar + oneRow.elementCount, 0), mappingList: found.map((oneRow) => ({ ...oneRow, manifest: mintUriOf({ kind: 'manifestByContent', manifestRefId: oneRow.manifestRefId }), layerVersion: oneRow.layerKey === null ? null : mintUriOf({ kind: 'layerVersion', layerKey: oneRow.layerKey, versionTag: oneRow.versionTag }) })) }))),
		);
	},
	// ⟪ML3.1, Q4⟫ a manifest answers its inventory; ⟪Q5⟫ the discovery forms
	manifest: withReader('manifest', ({ partByName, uriContractReader }, done) => manifestInventoryAnswerFor({ kind: 'manifest', manifestAddress: manifestAddressOf(partByName), uriContractReader }, done)),
	manifestByContent: withReader('manifestByContent', ({ partByName, uriContractReader }, done) => manifestInventoryAnswerFor({ kind: 'manifestByContent', manifestAddress: manifestAddressOf(partByName), uriContractReader }, done)),
	root: withReader('root', ({ iri, uriContractReader }, done) =>
		uriContractReader.rootCountsFor((readError, counts) =>
			done(readerAnswer({ kind: 'root', readError, found: counts, notFoundText: '' }, (found) => ({ root: iri, entryPointList: [{ kind: 'scheme', uri: mintUriOf({ kind: 'scheme' }) }, { kind: 'manifestList', uri: mintUriOf({ kind: 'manifestList' }), count: found.manifestCount }, { kind: 'siteLayerRegistry', uri: mintUriOf({ kind: 'siteLayerRegistry' }), layerCount: found.layerCount, layerVersionCount: found.layerVersionCount }, { kind: 'agentList', uri: mintUriOf({ kind: 'agentList' }), count: found.agentCount }] }))),
		),
	),
	// the scheme answers ITSELF: the very object the parser compiled, plus the reserved words it derived, so the two cannot disagree
	siteLayerRegistry: withReader('siteLayerRegistry', ({ iri, uriContractReader }, done) =>
		uriContractReader.layerListFor((readError, layerList) =>
			done(readerAnswer({ kind: 'siteLayerRegistry', readError, found: layerList, notFoundText: '' }, (found) => ({ registry: iri, layerList: found.map((oneLayer) => ({ ...oneLayer, layer: mintUriOf({ kind: 'layer', layerKey: oneLayer.layerKey }) })) }))),
		),
	),
	scheme: ({ iri }, done) => done(answer(200, { kind: 'scheme', scheme: iri, reservedWordList: edcUri.RESERVED_WORD_LIST, kindCount: edcUri.KIND_LIST.length, uriScheme: URI_SCHEME })),
	manifestList: withReader('manifestList', ({ iri, pageNumber, uriContractReader }, done) =>
		uriContractReader.publishedManifestListFor({ pageNumber, pageSize: LISTING_PAGING.pageSize }, (readError, page) =>
			done(readError ? answer(500, { kind: 'manifestList', error: readError }) : pagedAnswer({ kind: 'manifestList', iri, pageNumber, totalCount: page.totalCount, itemListName: 'manifestList', itemList: page.manifestList.map((oneManifest) => ({ ...oneManifest, manifest: mintUriOf({ kind: 'manifest', publicLabel: oneManifest.publicLabel }), manifestByContent: mintUriOf({ kind: 'manifestByContent', manifestRefId: oneManifest.manifestRefId }) })) })),
		),
	),
	manifestStandardList: withReader('manifestStandardList', (context, done) => manifestStandardListAnswerFor({ ...context, kind: 'manifestStandardList' }, done)),
	manifestStandardListByContent: withReader('manifestStandardListByContent', (context, done) => manifestStandardListAnswerFor({ ...context, kind: 'manifestStandardListByContent' }, done)),
	manifestElementList: withReader('manifestElementList', (context, done) => manifestElementListAnswerFor({ ...context, kind: 'manifestElementList' }, done)),
	manifestElementListByContent: withReader('manifestElementListByContent', (context, done) => manifestElementListAnswerFor({ ...context, kind: 'manifestElementListByContent' }, done)),
	manifestHubList: withReader('manifestHubList', (context, done) => manifestHubListAnswerFor({ ...context, kind: 'manifestHubList' }, done)),
	manifestHubListByContent: withReader('manifestHubListByContent', (context, done) => manifestHubListAnswerFor({ ...context, kind: 'manifestHubListByContent' }, done)),
	hubDomainList: withReader('hubDomainList', (context, done) => hubDomainListAnswerFor({ ...context, kind: 'hubDomainList' }, done)),
	hubDomainListByContent: withReader('hubDomainListByContent', (context, done) => hubDomainListAnswerFor({ ...context, kind: 'hubDomainListByContent' }, done)),
	hubDomainCardList: withReader('hubDomainCardList', (context, done) => hubDomainCardListAnswerFor({ ...context, kind: 'hubDomainCardList' }, done)),
	hubDomainCardListByContent: withReader('hubDomainCardListByContent', (context, done) => hubDomainCardListAnswerFor({ ...context, kind: 'hubDomainCardListByContent' }, done)),
	agentList: withReader('agentList', ({ iri, pageNumber, uriContractReader }, done) =>
		uriContractReader.agentListFor({ pageNumber, pageSize: LISTING_PAGING.pageSize }, (readError, page) =>
			done(readError ? answer(500, { kind: 'agentList', error: readError }) : pagedAnswer({ kind: 'agentList', iri, pageNumber, totalCount: page.totalCount, itemListName: 'agentList', itemList: page.agentList.map((oneAgent) => profileOf(oneAgent.profile)) })),
		),
	),
	// ⟪ML3.1⟫ the four question forms share one answer; schema blocks answer their text or, held, their metadata (Q51)
	question: withReader('question', (context, done) => questionAnswerFor({ ...context, kind: 'question' }, done)),
	questionForHub: withReader('questionForHub', (context, done) => questionAnswerFor({ ...context, kind: 'questionForHub' }, done)),
	questionByContent: withReader('questionByContent', (context, done) => questionAnswerFor({ ...context, kind: 'questionByContent' }, done)),
	questionForHubByContent: withReader('questionForHubByContent', (context, done) => questionAnswerFor({ ...context, kind: 'questionForHubByContent' }, done)),
	schemaBlock: withReader('schemaBlock', ({ partByName, uriContractReader }, done) =>
		uriContractReader.schemaBlockFor(partByName.schemaBlockRefId, (readError, schemaBlock) => {
			if (readError || schemaBlock === null) {
				done(answer(404, { kind: 'schemaBlock', error: readError || `schema block ${partByName.schemaBlockRefId} is not in uriContract` }));
				return;
			}
			const metadata = { kind: 'schemaBlock', schemaBlockRefId: schemaBlock.schemaBlockRefId, blockKind: schemaBlock.blockKind, subject: schemaBlock.subject, version: schemaBlock.version };
			const standardKeyList = schemaBlockStandardKeyListFor(schemaBlock.text);
			done(withheldAnswerFor({ standardKeyList, metadata }) || answer(200, { ...metadata, standardKeyList, text: schemaBlock.text }));
		}),
	),
	decisionSchemaBlock: withReader('decisionSchemaBlock', ({ partByName, uriContractReader }, done) =>
		uriContractReader.decisionSchemaBlockFor(partByName.decisionBlockHash, (readError, decisionSchemaBlock) => {
			if (readError || decisionSchemaBlock === null) {
				done(answer(404, { kind: 'decisionSchemaBlock', error: readError || `decision schema block ${partByName.decisionBlockHash} is not in uriContract` }));
				return;
			}
			const metadata = { kind: 'decisionSchemaBlock', decisionBlockHash: decisionSchemaBlock.decisionBlockHash, pairKey: decisionSchemaBlock.pairKey };
			const standardKeyList = decisionBlockStandardKeyListFor(decisionSchemaBlock);
			done(withheldAnswerFor({ standardKeyList, metadata }) || answer(200, { ...metadata, standardKeyList, text: decisionSchemaBlock.frozenText }));
		}),
	),
});
const agentAnswerFor = ({ iri, registry }) => {
	const agent = registry.agentRegistry.agentList.find((oneAgent) => oneAgent.agentIri === iri);
	return agent === undefined ? answer(404, { error: `agent ${iri} is not in the agent registry` }) : answer(200, { kind: 'agent', agent });
};

const resolveEdcUri = ({ uriOrPath, registry, blockTextForHash, uriContractReader } = {}, callback) => {
	if (!registry || typeof blockTextForHash !== 'function') {
		callback(refuse.byName({ moduleName, what: 'registry and blockTextForHash are required', where: 'resolveEdcUri({ uriOrPath, registry, blockTextForHash })' }).message);
		return;
	}
	const iri = edcIriFor(uriOrPath);
	const parsed = edcUri.parse(iri);
	if (parsed.error) {
		callback('', answer(400, { error: parsed.error }));
		return;
	}
	// ⟪ML3.1, Q5⟫ a query is a VIEW (a listing's page), never part of the identity; anything else carrying one is refused by name
	const queryText = typeof uriOrPath === 'string' && uriOrPath.indexOf('?') !== -1 ? uriOrPath.slice(uriOrPath.indexOf('?') + 1) : '';
	const paging = pageNumberFor(queryText, parsed.kind);
	if (paging.error) {
		callback('', answer(400, { kind: parsed.kind, error: paging.error }));
		return;
	}
	const resolution = RESOLUTION_BY_KIND[parsed.kind];
	if (resolution === undefined) {
		callback('', answer(501, { kind: parsed.kind, partByName: parsed.partByName, error: `the stub does not resolve kind '${parsed.kind}'` }));
		return;
	}
	resolution({ partByName: parsed.partByName, iri: edcUri.mint({ kind: parsed.kind, ...parsed.partByName }).uri, registry, blockTextForHash, uriContractReader, pageNumber: paging.pageNumber }, (resolved) => callback('', resolved));
};

module.exports = { resolveEdcUri, edcIriFor, RESOLUTION_BY_KIND, LICENCE_HOLD_BY_STANDARD_KEY, AGENT_PROFILE_FIELD_LIST, W3ID_PATH_PREFIX, moduleName };
