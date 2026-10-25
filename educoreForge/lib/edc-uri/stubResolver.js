'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// stubResolver.js — the LOCAL stand-in for the w3id redirect plus resolver (mappingLayers ML1, AMENDMENT: TQ ruled NO public
// registration, "make a stub"; R-5). It answers what an edc: URI names, by SPEC §5.3, for the kinds ML1 can answer; every other
// kind is answered 501 by name, never guessed. The resolution is a pure function over INJECTED lookups (the registry and a block
// reader), so no storage is touched here; stubResolverServer.js is the HTTP shell and the one place a store is opened.
//
//   resolveEdcUri({ uriOrPath, registry, blockTextForHash }, cb) → cb('', { httpStatus, body })
//     uriOrPath         an edc IRI, an edc: CURIE, or the path a request carries ('/EDUcore/<path>' or '/<path>')
//     registry          lib/layer-registry registryFor(...).registry
//     blockTextForHash  (decisionBlockHash, cb(err, frozenText | null))
//
// ANSWERS: layer → its current STANDARD version (never merely the newest); layerVersion / layerVersionByContent → the version's
// administration record, status and member blocks; assertion → the one record of its block whose recomputed assertion id is this
// URI; agent kinds → the agent registry row; element / meaning → the parse (their graph lookup is not ML1's); ⟪ML3⟫ interpretation
// (pinned and floating) → the version's assertions for the element, or an explicit NoTermFound; question, manifest kinds → 501. Minted URIs keep their w3id spelling; the stub serves them under a private hostname.

const path = require('path');
const edcUri = require(path.join(__dirname, 'edcUri'));
const assertionIdentity = require(path.join(__dirname, 'assertionIdentity'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const materialiserLib = require(path.join(__dirname, '..', 'bridge-framework', 'materialiser'));

const { URI_SCHEME } = edcUri;
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

// RESOLUTION_BY_KIND — one row per kind the stub answers (DATA, no branch); a kind with no row is answered 501 by name
const RESOLUTION_BY_KIND = Object.freeze({
	layer: ({ partByName, registry }, done) => {
		const current = registry.currentStandardVersionFor(partByName.layerKey);
		done(current.error ? answer(404, { error: current.error }) : answer(200, { kind: 'layer', layerKey: partByName.layerKey, currentStandardVersion: current.version, currentStandardVersionUri: edcUri.mint({ kind: 'layerVersion', layerKey: partByName.layerKey, versionTag: current.version.administrationRecord.versionTag }).uri }));
	},
	layerVersion: ({ partByName, registry }, done) => {
		const found = registry.versionFor({ layerKey: partByName.layerKey, versionTag: partByName.versionTag });
		// the row keeps the status it was published with; the EFFECTIVE status (after appended changes) is answered beside it
		done(found.error ? answer(404, { error: found.error }) : answer(200, { kind: 'layerVersion', layerKey: partByName.layerKey, effectiveRegistrationStatus: registry.effectiveStatusFor({ layerKey: partByName.layerKey, versionTag: partByName.versionTag }).registrationStatus, version: found.version }));
	},
	layerVersionByContent: ({ partByName, registry }, done) => {
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
	agentPerson: ({ iri, registry }, done) => done(agentAnswerFor({ iri, registry })),
	agentJudge: ({ iri, registry }, done) => done(agentAnswerFor({ iri, registry })),
	agentOrganisation: ({ iri, registry }, done) => done(agentAnswerFor({ iri, registry })),
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
	element: ({ partByName }, done) => done(answer(200, { kind: 'element', partByName, note: 'parsed only: the element\'s graph record is not served by the ML1 stub' })),
	meaning: ({ partByName }, done) => done(answer(200, { kind: 'meaning', partByName, note: 'parsed only: the card\'s graph record is not served by the ML1 stub' })),
});
const agentAnswerFor = ({ iri, registry }) => {
	const agent = registry.agentRegistry.agentList.find((oneAgent) => oneAgent.agentIri === iri);
	return agent === undefined ? answer(404, { error: `agent ${iri} is not in the agent registry` }) : answer(200, { kind: 'agent', agent });
};

const resolveEdcUri = ({ uriOrPath, registry, blockTextForHash } = {}, callback) => {
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
	const resolution = RESOLUTION_BY_KIND[parsed.kind];
	if (resolution === undefined) {
		callback('', answer(501, { kind: parsed.kind, partByName: parsed.partByName, error: `the stub does not resolve kind '${parsed.kind}' (questions and manifests need published manifests: ML5)` }));
		return;
	}
	resolution({ partByName: parsed.partByName, iri: edcUri.mint({ kind: parsed.kind, ...parsed.partByName }).uri, registry, blockTextForHash }, (resolved) => callback('', resolved));
};

module.exports = { resolveEdcUri, edcIriFor, RESOLUTION_BY_KIND, W3ID_PATH_PREFIX, moduleName };
