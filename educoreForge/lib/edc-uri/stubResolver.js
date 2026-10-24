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
// URI; agent kinds → the agent registry row; element / meaning → the parse (their graph lookup is not ML1's); interpretation,
// question, manifest kinds → 501. Minted URIs keep their w3id spelling; the stub serves them under a private hostname.

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
		callback('', answer(501, { kind: parsed.kind, partByName: parsed.partByName, error: `the ML1 stub does not resolve kind '${parsed.kind}' (interpretations and questions need published manifests: ML5)` }));
		return;
	}
	resolution({ partByName: parsed.partByName, iri: edcUri.mint({ kind: parsed.kind, ...parsed.partByName }).uri, registry, blockTextForHash }, (resolved) => callback('', resolved));
};

module.exports = { resolveEdcUri, edcIriFor, RESOLUTION_BY_KIND, W3ID_PATH_PREFIX, moduleName };
