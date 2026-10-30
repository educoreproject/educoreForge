'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// usecaseRoundTripPair.js — H4 for the use-case forge bundle (useCaseForge-102926 Phase 1). A DOCUMENT-LEVEL pair, held apart from the
// walk on purpose: the canonicalizer reads only the snapshot's case documents; the emitter reads only the materialized graph and
// REBUILDS every case document from it (case node, then its edges in listPosition order, then their target nodes): the inverse
// direction of the walk, sharing none of its code. Both sides go through ONE flattener, so a statement is one leaf of one document:
//   case|<caseId>|<JSON pointer>|<canonical JSON of the leaf>
// Every value is part of its statement KEY, so the harness's key-only diff is also a value diff. Array ORDER is modelled (the pointer
// carries the index; the graph carries listPosition), and so is ref-versus-inline (the graph carries statedInline / subjectForm).
// Explicitly omitted, each statement naming its kind: the resolution registry's entries (applied as every reference's citedStableId
// and resolutionAnchor, not carried as a table) and the format schema files (applied as validation, not carried).

const fs = require('fs');
const path = require('path');
const sourceProfile = require('./usecaseSourceProfile.json');

const OMITTED_KIND_PROPERTY_NAME = 'omittedKind';
const OMITTED_KIND = Object.freeze({ REGISTRY_ENTRY: 'resolutionRegistryEntry', FORMAT_SCHEMA: 'formatSchema' });
const MINTED_PREFIX = 'usecase:';
const ROOT_ROLE = 'DmeStandardRoot';
// roles the documents state nothing about, excluded by NAME so the exclusion is a stated decision; any other unknown role faults
const NOT_SOURCE_ROLE_LIST = Object.freeze(['HubReference', 'HubDefinition', 'DmeEmbedText']);
// the edges this instrument reads, and what document slot each is (its own table, not the walk's)
const RELATIONSHIP_BY_EDGE_TYPE = Object.freeze({ CHILD: 'child', PARENT: 'parent', SIBLING: 'sibling', DUPLICATE: 'duplicate', EXTENDS: 'extends', INCLUDES: 'includes', SEEDED_FROM: 'seededFrom' });
const REQUIREMENT_EDGE_TYPE_LIST = Object.freeze(['REQUIRES', 'REQUIRES_STANDARD', 'REQUIRES_ORPHAN', 'REQUIRES_ARTIFACT']);
const READ_EDGE_TYPE_LIST = Object.freeze(['HAS_USE_CASE', 'DECLARES_SHARED_NODE', 'HAS_PRIMARY_ACTOR', 'HAS_ACTOR', 'HAS_INTERESTED_PARTY', 'HAS_STEP', 'INVOKES', 'PERFORMED_BY', 'ACTS_ON', 'ALIGNS_WITH', 'SERVES', 'TRIGGERED_BY', 'ASSUMES', 'GUARANTEES', 'HAS_SUBJECT', 'HAS_CONSTITUENT', 'COMPRISES', 'GOVERNS', 'CONSUMES', 'PRODUCES', 'HAS_RESOURCE'].concat(REQUIREMENT_EDGE_TYPE_LIST, Object.keys(RELATIONSHIP_BY_EDGE_TYPE)));

const omitted = (kind) => ({ explicitlyOmitted: true, [OMITTED_KIND_PROPERTY_NAME]: kind });
const canonicalJson = (candidate) => {
	if (Array.isArray(candidate)) {
		return `[${candidate.map(canonicalJson).join(',')}]`;
	}
	if (candidate !== null && typeof candidate === 'object') {
		return `{${Object.keys(candidate).sort().map((memberName) => `${JSON.stringify(memberName)}:${canonicalJson(candidate[memberName])}`).join(',')}}`;
	}
	return JSON.stringify(candidate);
};
const pointerSegment = (segmentText) => `${segmentText}`.replace(/~/g, '~0').replace(/\//g, '~1');

// flattenInto — every leaf of a document as one statement (an empty object or list is a leaf too, though the loader refuses lists)
const flattenInto = ({ statements, caseId, candidate, pointer }) => {
	if (candidate !== null && typeof candidate === 'object' && Object.keys(candidate).length > 0) {
		Object.keys(candidate).forEach((memberName) => flattenInto({ statements, caseId, candidate: candidate[memberName], pointer: `${pointer}/${pointerSegment(memberName)}` }));
		return;
	}
	statements.set(`case|${caseId}|${pointer}|${canonicalJson(candidate)}`, {});
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ ruleModulePath } = {}) => {
		if (typeof ruleModulePath !== 'string' || ruleModulePath.length === 0) {
			throw new Error(`${moduleName} REFUSED: ruleModulePath is required (the omission declaration names the module that declares the omissions)`);
		}

		// -----------------------------------------------------------------
		// canonicalizeSource — the snapshot's case documents → Map<statementKey, statement>
		// -----------------------------------------------------------------
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			const snapshotDirPath = fs.statSync(snapshotPath).isDirectory() ? snapshotPath : path.dirname(snapshotPath);
			const verifiedNameList = (verifiedFileList || []).map((oneEntry) => (typeof oneEntry === 'string' ? oneEntry : oneEntry.relativePath));
			const statements = new Map();
			const caseFileNameList = verifiedNameList.filter((fileName) => fileName.startsWith(`${sourceProfile.caseDirectoryName}/`)).sort();
			const formatFileNameList = verifiedNameList.filter((fileName) => fileName.startsWith(`${sourceProfile.formatDirectoryName}/`)).sort();
			if (caseFileNameList.length === 0) {
				callback(`${moduleName}: the verified snapshot lists no case document under '${sourceProfile.caseDirectoryName}/'`);
				return;
			}
			caseFileNameList.forEach((caseFileName) => {
				const caseDocument = JSON.parse(fs.readFileSync(path.join(snapshotDirPath, caseFileName), 'utf8'));
				flattenInto({ statements, caseId: caseDocument.id, candidate: caseDocument, pointer: '' });
			});
			const registry = JSON.parse(fs.readFileSync(path.join(snapshotDirPath, sourceProfile.registryFileName), 'utf8'));
			Object.keys(registry).forEach((entryName) => {
				statements.set(`registry|${entryName}|${canonicalJson(registry[entryName])}`, omitted(OMITTED_KIND.REGISTRY_ENTRY));
			});
			formatFileNameList.forEach((formatFileName) => statements.set(`formatSchema|${formatFileName}`, omitted(OMITTED_KIND.FORMAT_SCHEMA)));
			callback('', { statements, stats: { caseDocumentCount: caseFileNameList.length, statementCount: statements.size } });
		};

		// -----------------------------------------------------------------
		// emitFromGraph — the materialized graph → the case documents rebuilt → the same flattener
		// -----------------------------------------------------------------
		const emitFromGraph = ({ reader }, callback) => {
			reader.readAll((readError, graph) => {
				if (readError) {
					callback(readError);
					return;
				}
				const nodeByStableId = new Map(graph.nodes.map((oneNode) => [oneNode.stableId, oneNode]));
				const unknownRoleNode = graph.nodes.find((oneNode) => oneNode.role !== ROOT_ROLE && NOT_SOURCE_ROLE_LIST.indexOf(oneNode.role) === -1 && !/^Dme(UseCase|UserStory|Actor|Condition|Event|ValueDriver|Subject|DataReference|ExternalReference|Resource)$/.test(oneNode.role));
				if (unknownRoleNode !== undefined) {
					callback('', { fault: `node '${unknownRoleNode.stableId}' has role '${unknownRoleNode.role}', which this instrument has no reading for` });
					return;
				}
				const unknownEdge = graph.edges.find((oneEdge) => READ_EDGE_TYPE_LIST.indexOf(oneEdge.type) === -1 && oneEdge.type !== 'DECLARED_CORRESPONDENCE');
				if (unknownEdge !== undefined) {
					callback('', { fault: `edge type '${unknownEdge.type}' (${unknownEdge.fromStableId} -> ${unknownEdge.toStableId}) has no reading` });
					return;
				}
				const outEdgeListByStableId = new Map();
				graph.edges.forEach((oneEdge) => outEdgeListByStableId.set(oneEdge.fromStableId, (outEdgeListByStableId.get(oneEdge.fromStableId) || []).concat([oneEdge])));
				const outEdgesOf = (stableId, typeList) => (outEdgeListByStableId.get(stableId) || []).filter((oneEdge) => typeList.indexOf(oneEdge.type) !== -1).sort((left, right) => left.properties.listPosition - right.properties.listPosition);
				const propsOf = (stableId) => nodeByStableId.get(stableId).properties;
				const isMinted = (stableId) => stableId.startsWith(MINTED_PREFIX);
				const withIdentifier = (stableId, body) => (isMinted(stableId) ? body : { identifier: stableId, ...body });
				const present = (fieldByName) => Object.keys(fieldByName).reduce((kept, fieldName) => (fieldByName[fieldName] === undefined ? kept : { ...kept, [fieldName]: fieldByName[fieldName] }), {});

				const citationOf = (oneEdge) => {
					const target = nodeByStableId.get(oneEdge.toStableId);
					const targetProps = target.properties;
					const edgeProps = oneEdge.properties;
					if (target.role === 'DmeSubject') {
						return { kind: 'subject', ref: oneEdge.toStableId, role: edgeProps.role };
					}
					if (targetProps.referenceKind === 'standardWholesale') {
						return { kind: 'standard-wholesale', standard: targetProps.citedStandard, role: edgeProps.role };
					}
					if (targetProps.referenceKind === 'artifact') {
						return withIdentifier(oneEdge.toStableId, { kind: 'artifact', name: targetProps.name, origin: targetProps.origin, role: edgeProps.role });
					}
					if (targetProps.referenceKind === 'intermediate') {
						return present({ kind: 'intermediate', identifier: oneEdge.toStableId, name: edgeProps.name, role: edgeProps.role });
					}
					return present({
						kind: 'element',
						identifier: targetProps.citedIdentifier,
						standard: edgeProps.standardIsNull === true ? null : edgeProps.standard,
						name: edgeProps.name,
						role: edgeProps.role,
						linkageStatus: edgeProps.linkageStatus,
					});
				};
				const citationListOf = (stableId, typeList) => {
					const edgeList = outEdgesOf(stableId, typeList);
					return edgeList.length === 0 ? undefined : edgeList.map(citationOf);
				};
				const resourceListOf = (stableId) => {
					const edgeList = outEdgesOf(stableId, ['HAS_RESOURCE']);
					return edgeList.length === 0 ? undefined : edgeList.map((oneEdge) => withIdentifier(oneEdge.toStableId, { url: propsOf(oneEdge.toStableId).url, title: propsOf(oneEdge.toStableId).name }));
				};
				const conditionOf = (oneEdge) => (oneEdge.properties.statedInline ? withIdentifier(oneEdge.toStableId, { statement: propsOf(oneEdge.toStableId).name }) : { ref: oneEdge.toStableId });
				const valueDriverOf = (oneEdge) => (oneEdge.properties.statedInline ? withIdentifier(oneEdge.toStableId, present({ title: propsOf(oneEdge.toStableId).name, motivation: propsOf(oneEdge.toStableId).motivation })) : { ref: oneEdge.toStableId });
				const storyOf = (oneEdge) => {
					if (!oneEdge.properties.statedInline) {
						return { ref: oneEdge.toStableId };
					}
					const storyStableId = oneEdge.toStableId;
					const storyProps = propsOf(storyStableId);
					const serveEdgeList = outEdgesOf(storyStableId, ['SERVES']);
					return withIdentifier(storyStableId, present({
						action: storyProps.name,
						intention: storyProps.intention,
						benefit: storyProps.benefit,
						actor: storyProps.actorToken,
						consumes: citationListOf(storyStableId, ['CONSUMES']),
						produces: citationListOf(storyStableId, ['PRODUCES']),
						serves: serveEdgeList.length === 0 ? undefined : serveEdgeList.map(valueDriverOf),
						resources: resourceListOf(storyStableId),
					}));
				};
				const subjectOf = (caseStableId) => {
					const subjectEdge = outEdgesOf(caseStableId, ['HAS_SUBJECT'])[0];
					if (subjectEdge === undefined) {
						return undefined;
					}
					const subjectStableId = subjectEdge.toStableId;
					if (subjectEdge.properties.subjectForm === 'string') {
						return propsOf(subjectStableId).name;
					}
					if (subjectEdge.properties.subjectForm === 'ref') {
						return { ref: subjectStableId };
					}
					const constituentEdgeList = outEdgesOf(subjectStableId, ['HAS_CONSTITUENT']);
					return withIdentifier(subjectStableId, present({
						name: propsOf(subjectStableId).name,
						constituents: constituentEdgeList.length === 0 ? undefined : constituentEdgeList.map((oneEdge) => oneEdge.toStableId),
						comprises: citationListOf(subjectStableId, ['COMPRISES']),
						governs: citationListOf(subjectStableId, ['GOVERNS']),
					}));
				};
				const stepListOf = (caseStableId) => {
					const stepEdgeList = outEdgesOf(caseStableId, ['HAS_STEP', 'INVOKES']);
					const stepByListPosition = new Map();
					stepEdgeList.forEach((oneEdge) => {
						const stepRecord = stepByListPosition.get(oneEdge.properties.listPosition) || {};
						if (oneEdge.type === 'HAS_STEP') {
							stepRecord.storyEdge = oneEdge;
						} else {
							stepRecord.invokesEdge = oneEdge;
						}
						stepByListPosition.set(oneEdge.properties.listPosition, stepRecord);
					});
					return Array.from(stepByListPosition.keys()).sort((left, right) => left - right).map((listPosition) => {
						const { storyEdge, invokesEdge } = stepByListPosition.get(listPosition);
						const coordinate = (storyEdge || invokesEdge).properties;
						return present({
							codedNotation: coordinate.codedNotation,
							kind: coordinate.kind,
							branchesFrom: coordinate.branchesFrom,
							condition: coordinate.condition,
							dependsOn: coordinate.dependsOnJson === undefined ? undefined : JSON.parse(coordinate.dependsOnJson),
							story: storyEdge === undefined ? undefined : storyOf(storyEdge),
							invokes: invokesEdge === undefined ? undefined : invokesEdge.toStableId,
						});
					});
				};
				const listOrAbsent = (candidateList) => (candidateList.length === 0 ? undefined : candidateList);

				const statements = new Map();
				const caseNodeList = graph.nodes.filter((oneNode) => oneNode.role === 'DmeUseCase');
				caseNodeList.forEach((caseNode) => {
					const caseStableId = caseNode.stableId;
					const caseProps = caseNode.properties;
					const caseDocument = present({
						$explanation: caseProps.editorialExplanation,
						id: caseStableId,
						formatVersion: caseProps.formatVersionSource === 'document' ? caseProps.formatVersion : undefined,
						shortName: caseProps.shortName,
						longName: caseProps.name,
						level: caseProps.level,
						scope: caseProps.scope,
						frequency: caseProps.frequency,
						orderingAsserted: caseProps.orderingAsserted,
						openIssues: caseProps.openIssuesJson === undefined ? undefined : JSON.parse(caseProps.openIssuesJson),
						keyConcepts: caseProps.keyConceptsJson === undefined ? undefined : JSON.parse(caseProps.keyConceptsJson),
						primaryActor: caseProps.primaryActorIsNull === true ? null : caseProps.primaryActorToken,
						actors: listOrAbsent(outEdgesOf(caseStableId, ['HAS_ACTOR']).map((oneEdge) => withIdentifier(oneEdge.toStableId, present({ actor: propsOf(oneEdge.toStableId).name, kind: propsOf(oneEdge.toStableId).actorKind, role: oneEdge.properties.role, interest: oneEdge.properties.interest })))),
						interestedParties: listOrAbsent(outEdgesOf(caseStableId, ['HAS_INTERESTED_PARTY']).map((oneEdge) => withIdentifier(oneEdge.toStableId, present({ party: propsOf(oneEdge.toStableId).name, interest: oneEdge.properties.interest, kind: oneEdge.properties.partyKind })))),
						scenario: listOrAbsent(stepListOf(caseStableId)),
						valueDrivers: listOrAbsent(outEdgesOf(caseStableId, ['ALIGNS_WITH']).map((oneEdge) => present({ valueDriver: valueDriverOf(oneEdge), notes: oneEdge.properties.notes }))),
						triggeredBy: outEdgesOf(caseStableId, ['TRIGGERED_BY']).map((oneEdge) => (oneEdge.properties.statedInline ? withIdentifier(oneEdge.toStableId, { name: propsOf(oneEdge.toStableId).name }) : { ref: oneEdge.toStableId }))[0],
						assumes: listOrAbsent(outEdgesOf(caseStableId, ['ASSUMES']).map(conditionOf)),
						guarantees: listOrAbsent(outEdgesOf(caseStableId, ['GUARANTEES']).map((oneEdge) => ({ role: oneEdge.properties.role, condition: conditionOf(oneEdge) }))),
						subject: subjectOf(caseStableId),
						governs: citationListOf(caseStableId, ['GOVERNS']),
						sourceDataRequired: citationListOf(caseStableId, REQUIREMENT_EDGE_TYPE_LIST),
						resources: resourceListOf(caseStableId),
						relatedUseCases: listOrAbsent(outEdgesOf(caseStableId, Object.keys(RELATIONSHIP_BY_EDGE_TYPE)).filter((oneEdge) => oneEdge.properties.edgeOrigin === 'declared').map((oneEdge) => present({ useCase: oneEdge.toStableId, relationship: RELATIONSHIP_BY_EDGE_TYPE[oneEdge.type], notes: oneEdge.properties.notes }))),
					});
					flattenInto({ statements, caseId: caseStableId, candidate: caseDocument, pointer: '' });
				});
				callback('', { statements, stats: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, caseDocumentCount: caseNodeList.length, statementCount: statements.size } });
			});
		};

		const omissionDeclaration = Object.freeze({
			rule: ruleModulePath,
			kindPropertyName: OMITTED_KIND_PROPERTY_NAME,
			kindList: Object.freeze(Object.values(OMITTED_KIND)),
			textBearingKindList: Object.freeze([]),
			textPropertyName: '',
			caveatText:
				'resolutionRegistryEntry is one entry of the snapshot\'s resolutionRegistry.json, applied as every reference node\'s citedStableId and ' +
				'resolutionAnchor rather than carried as a table; formatSchema is a format schema file (formats/), applied as validation of every case ' +
				'written to it. Not in the snapshot at all, so neither carried nor omitted: the rendered HTML, cases/resolutionReport.json (a Layer-4 run ' +
				'record), the Python tooling and v011-shapes.ttl.',
		});

		const semanticValidationLimit =
			'DOCUMENT-LEVEL round trip of the use-case snapshot: every leaf of every case document (cases/*.json), keyed by case id and JSON pointer, ' +
			'with its value. The emitter REBUILDS each document from the graph alone (the case node, its edges in listPosition order, their target ' +
			'nodes), so array order, ref-versus-inline, absent-versus-stated optional fields, the token a document writes for its primary actor and a ' +
			'story\'s actor, and a citation site\'s own words (role; name, linkageStatus and standard where stated) are all modelled. EXPLICITLY OMITTED ' +
			'and listed: the resolution registry entries and the format schema files. NOT modelled: object member ORDER inside a document (JSON object ' +
			'order is not a statement); the derived values the loader owes the standard (position, derivedPrerequisiteListJson, the derivedInverse ' +
			'relatedness edges, effectiveKind), which are not in any document; the forge-minted ids of anonymous nodes and the reference nodes\' ids; ' +
			'searchText, path, depth and the root\'s provenance fields (checked by the framework). An empty list is refused at load (it would read back as absent).';

		return { canonicalizeSource, emitFromGraph, semanticValidationLimit, omissionDeclaration };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
