'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// usecaseWalk.js — the H3 walk for the use-case forge bundle (useCaseForge-102926 Phase 1, RADIANT_HAVEN, 2026-10-29). PURE: it reads
// the loader's validated case documents and the snapshot's resolution registry and mints through the kit only; a refusal is a thrown
// named Error under the framework's one adapter.
//
// THE MODEL is the standard's own (v011-spec.md "The shared vocabulary" and "How a case is wired"), with the roles ruled in the
// Phase V vocabulary commit:
//   DmeUseCase           one per case document                         the corpus id verbatim (uc:…)
//   DmeUserStory         one per story identifier (or anonymous step)  us:… | usecase:story/<case>/step.<codedNotation>
//   DmeActor             one per actor / party identifier              actor:… ip:… | usecase:actor/<case>/<slot>.<n>
//   DmeCondition         one per condition identifier (or site)        cond:… | usecase:condition/<case>/<slot>.<n>
//   DmeEvent             one per event identifier (or case)            event:… | usecase:event/<case>/triggeredBy
//   DmeValueDriver       one per value-driver identifier (or site)     vd:… | usecase:valueDriver/<case>/<site>
//   DmeSubject           one per subject identifier or constituent     subj:… | usecase:subject/<case>/subject
//   DmeExternalReference one per cited (standard, identifier) / whole standard   usecase:ref/<registryKey>[/<local>]
//   DmeDataReference     one per orphan, intermediate, artifact        orphan:… intermediate:… artifact:… | usecase:artifact/<case>/<site>
//   DmeResource          one per resource identifier (or site)         <identifier> | usecase:resource/<case>/<site>
// Every node is parented on the root and owned by it (HAS_USE_CASE for a case, DECLARES_SHARED_NODE for every shared node).
//
// WHAT RIDES THE EDGES, so the graph gives every document back (the round trip, lib/usecaseRoundTripPair.js): listPosition (the
// index in the document's array), statedInline (a shared slot gave the definition, not a ref), the citation site's own words (role;
// name, linkageStatus and standard only when the site states them), and the step coordinate. The three DERIVATIONS the standard
// assigns the loader, each from a closed rule: position (the integer prefix of codedNotation), derivedPrerequisiteListJson (the steps
// of the same case that PRODUCE what this step CONSUMES), and the inverse relatedness edge (edgeOrigin derivedInverse, emitted only
// where the inverse is not itself declared).
//
// THE INTEGRITY PASS restates the Layer-3 violation classes as refusals (README_ValidationCertificate.md maps each), plus the
// corpus gate's reference rules. The SHACL file stays the independent oracle; this module never reads it.

const path = require('path');
const { DME_ROLES, EDGE_TYPES, rootOwnershipEdgeTypeFor } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', '..', '..', 'lib', 'forge-framework', 'refuse'));
// by absolute path: a test's module double compiles every RELATIVE sibling as JavaScript, and this one is JSON
const sourceProfile = require(path.join(__dirname, 'usecaseSourceProfile.json'));

const STANDARD_NAME = 'UseCase';
const MINTED_PREFIX = 'usecase:';
const CASE_PREFIX = 'uc:';

const LABEL_BY_ROLE = Object.freeze({
	[DME_ROLES.USE_CASE]: 'UcUseCase',
	[DME_ROLES.USER_STORY]: 'UcUserStory',
	[DME_ROLES.ACTOR]: 'UcActor',
	[DME_ROLES.CONDITION]: 'UcCondition',
	[DME_ROLES.EVENT]: 'UcEvent',
	[DME_ROLES.VALUE_DRIVER]: 'UcValueDriver',
	[DME_ROLES.SUBJECT]: 'UcSubject',
	[DME_ROLES.DATA_REFERENCE]: 'UcDataReference',
	[DME_ROLES.EXTERNAL_REFERENCE]: 'UcDataReference',
	[DME_ROLES.RESOURCE]: 'UcResource',
});

// the shared kinds a {ref} may name, as DATA: role, the document field that is the node's name, and the other fields carried verbatim
const SHARED_KIND_REGISTRY = Object.freeze({
	story: Object.freeze({ role: DME_ROLES.USER_STORY, nameField: 'action', carriedFieldByPropertyName: Object.freeze({ intention: 'intention', benefit: 'benefit', actorToken: 'actor' }) }),
	condition: Object.freeze({ role: DME_ROLES.CONDITION, nameField: 'statement', carriedFieldByPropertyName: Object.freeze({}) }),
	event: Object.freeze({ role: DME_ROLES.EVENT, nameField: 'name', carriedFieldByPropertyName: Object.freeze({}) }),
	valueDriver: Object.freeze({ role: DME_ROLES.VALUE_DRIVER, nameField: 'title', carriedFieldByPropertyName: Object.freeze({ motivation: 'motivation' }) }),
	subject: Object.freeze({ role: DME_ROLES.SUBJECT, nameField: 'name', carriedFieldByPropertyName: Object.freeze({}) }),
});

// the case document's scalar fields carried on the case node (property name → document field); lists as JSON text
const CASE_SCALAR_CARRIAGE = Object.freeze({ shortName: 'shortName', level: 'level', scope: 'scope', frequency: 'frequency', orderingAsserted: 'orderingAsserted', editorialExplanation: '$explanation' });
const CASE_JSON_CARRIAGE = Object.freeze({ openIssuesJson: 'openIssues', keyConceptsJson: 'keyConcepts' });

// the relatedness vocabulary (v011-spec.md "The references and relatedness"): the edge, and the inverse the loader creates
const RELATEDNESS_EDGE_BY_RELATIONSHIP = Object.freeze({
	child: Object.freeze({ edgeType: EDGE_TYPES.CHILD, inverseRelationship: 'parent' }),
	parent: Object.freeze({ edgeType: EDGE_TYPES.PARENT, inverseRelationship: 'child' }),
	sibling: Object.freeze({ edgeType: EDGE_TYPES.SIBLING, inverseRelationship: 'sibling' }),
	duplicate: Object.freeze({ edgeType: EDGE_TYPES.DUPLICATE, inverseRelationship: 'duplicate' }),
	extends: Object.freeze({ edgeType: EDGE_TYPES.EXTENDS, inverseRelationship: null }),
	includes: Object.freeze({ edgeType: EDGE_TYPES.INCLUDES, inverseRelationship: null }),
	seededFrom: Object.freeze({ edgeType: EDGE_TYPES.SEEDED_FROM, inverseRelationship: null }),
});
const LEVEL_RANK = Object.freeze({ summary: 3, 'user-goal': 2, 'sub-function': 1 });
// sourceDataRequired: the edge by the citation's world
const REQUIREMENT_EDGE_BY_WORLD = Object.freeze({ element: EDGE_TYPES.REQUIRES, standardWholesale: EDGE_TYPES.REQUIRES_STANDARD, orphan: EDGE_TYPES.REQUIRES_ORPHAN, artifact: EDGE_TYPES.REQUIRES_ARTIFACT });
const GROUNDING_WORLD_LIST = Object.freeze(['element', 'standardWholesale', 'orphan']);
const DEFAULT_STEP_KIND = 'main';
const DEFAULT_LINKAGE_STATUS = 'linked';
const PLAIN_LOCAL_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
const CODED_NOTATION_PREFIX_RE = /^([0-9]+)/;

const refusal = (what, where) => refuse.byName({ moduleName, what, where });
const canonicalJson = (candidate) => {
	if (Array.isArray(candidate)) {
		return `[${candidate.map(canonicalJson).join(',')}]`;
	}
	if (candidate !== null && typeof candidate === 'object') {
		return `{${Object.keys(candidate).sort().map((memberName) => `${JSON.stringify(memberName)}:${canonicalJson(candidate[memberName])}`).join(',')}}`;
	}
	return JSON.stringify(candidate);
};
const positionOf = (codedNotation) => Number(codedNotation.match(CODED_NOTATION_PREFIX_RE)[1]);
const caseLocalOf = (caseId) => caseId.slice(CASE_PREFIX.length);

// -----------------------------------------------------------------
// emitContractGraph — { loaded: the loader's payload, kit } → { nodes, edges, stats }
// -----------------------------------------------------------------
const emitContractGraph = ({ loaded, kit }) => {
	const { caseRecordList, resolutionRegistry } = loaded;
	const walkStats = { caseCount: 0, stepCount: 0, derivedInverseEdgeCount: 0, declaredInverseSkippedCount: 0, anonymousNodeCount: 0, derivedPrerequisiteCount: 0 };

	const nodeSpecByStableId = new Map();
	const edgeList = [];
	const edgeIdentitySet = new Set();

	// defineNode — the ONE place identity is decided: a second definition must equal the first exactly (identifier conflict otherwise)
	const defineNode = ({ stableId, role, name, carriedProperties, searchTextFields, comparable, origin }) => {
		const prior = nodeSpecByStableId.get(stableId);
		const comparableText = canonicalJson(comparable);
		if (prior !== undefined) {
			if (prior.role !== role || prior.comparableText !== comparableText) {
				throw refusal(`identifier conflict: '${stableId}' is defined at ${prior.origin} and again, differently, at ${origin} (${prior.comparableText} vs ${comparableText})`, 'one identifier denotes exactly one node; two inline definitions must be identical (v011-graph-validation.md "Dedup by identifier"); the documents are the coalition\'s to reconcile');
			}
			return;
		}
		if (stableId.startsWith(MINTED_PREFIX)) {
			walkStats.anonymousNodeCount += 1;
		}
		nodeSpecByStableId.set(stableId, { stableId, role, name, carriedProperties, searchTextFields, comparableText, origin });
	};
	const addEdge = ({ edgeType, fromStableId, toStableId, edgeProperties }) => {
		const identityText = `${edgeType}|${fromStableId}|${toStableId}|${canonicalJson(edgeProperties)}`;
		if (edgeIdentitySet.has(identityText)) {
			return;
		}
		edgeIdentitySet.add(identityText);
		edgeList.push({ edgeType, fromStableId, toStableId, edgeProperties });
	};

	// -----------------------------------------------------------------
	// 1. the shared definitions, corpus-wide, so a {ref} resolves wherever its definition lives
	// -----------------------------------------------------------------
	const definitionByKind = Object.keys(SHARED_KIND_REGISTRY).reduce((byKind, kindName) => ({ ...byKind, [kindName]: new Map() }), {});
	const noteDefinition = ({ kindName, definition, origin }) => {
		if (definition === undefined || definition === null || typeof definition !== 'object' || definition.ref !== undefined || definition.identifier === undefined) {
			return;
		}
		const prior = definitionByKind[kindName].get(definition.identifier);
		if (prior !== undefined && canonicalJson(prior.definition) !== canonicalJson(definition)) {
			throw refusal(`identifier conflict: ${kindName} '${definition.identifier}' is defined inline at ${prior.origin} and again, differently, at ${origin}`, 'full-definition equality, no field subsetting (v011-graph-validation.md "Dedup by identifier")');
		}
		if (prior === undefined) {
			definitionByKind[kindName].set(definition.identifier, { definition, origin });
		}
	};
	caseRecordList.forEach(({ fileName, caseDocument }) => {
		(caseDocument.assumes || []).forEach((entry, index) => noteDefinition({ kindName: 'condition', definition: entry, origin: `${fileName} assumes/${index}` }));
		(caseDocument.guarantees || []).forEach((entry, index) => noteDefinition({ kindName: 'condition', definition: entry.condition, origin: `${fileName} guarantees/${index}/condition` }));
		(caseDocument.valueDrivers || []).forEach((entry, index) => noteDefinition({ kindName: 'valueDriver', definition: entry.valueDriver, origin: `${fileName} valueDrivers/${index}/valueDriver` }));
		noteDefinition({ kindName: 'event', definition: caseDocument.triggeredBy, origin: `${fileName} triggeredBy` });
		if (typeof caseDocument.subject === 'object') {
			noteDefinition({ kindName: 'subject', definition: caseDocument.subject, origin: `${fileName} subject` });
		}
		caseDocument.scenario.forEach((step, index) => {
			noteDefinition({ kindName: 'story', definition: step.story, origin: `${fileName} scenario/${index}/story` });
			if (step.story !== undefined && step.story.ref === undefined) {
				(step.story.serves || []).forEach((served, serveIndex) => noteDefinition({ kindName: 'valueDriver', definition: served, origin: `${fileName} scenario/${index}/story/serves/${serveIndex}` }));
			}
		});
	});
	const resolveShared = ({ kindName, reference, origin }) => {
		if (reference.ref === undefined) {
			return reference;
		}
		const found = definitionByKind[kindName].get(reference.ref);
		if (found === undefined) {
			throw refusal(`dangling ref: ${origin} names ${kindName} '${reference.ref}', which no case defines inline`, 'a ref resolves to a definition somewhere in the corpus (the shared corpus gate); a dangling ref is never given a placeholder');
		}
		return found.definition;
	};

	// -----------------------------------------------------------------
	// 2. corpus-wide checks: duplicate name, invocation (resolves, descends, acyclic), hierarchy acyclic
	// -----------------------------------------------------------------
	const caseById = new Map();
	caseRecordList.forEach(({ fileName, caseDocument }) => {
		if (!caseDocument.id.startsWith(CASE_PREFIX)) {
			throw refusal(`${fileName}: case id '${caseDocument.id}' does not begin '${CASE_PREFIX}'`, 'a use case is identified by its corpus id uc:<local part>');
		}
		if (caseById.has(caseDocument.id)) {
			throw refusal(`identifier conflict: case id '${caseDocument.id}' is stated by ${caseById.get(caseDocument.id).fileName} and by ${fileName}`, 'one case per id');
		}
		caseById.set(caseDocument.id, { fileName, caseDocument });
	});
	const fileNameByLongName = {};
	caseRecordList.forEach(({ fileName, caseDocument }) => {
		const nameText = caseDocument.longName.trim().toLowerCase();
		if (fileNameByLongName[nameText] !== undefined) {
			throw refusal(`duplicate name: '${caseDocument.longName}' is the longName of ${fileNameByLongName[nameText]} and of ${fileName}`, 'no two cases share a longName (Name uniqueness)');
		}
		fileNameByLongName[nameText] = fileName;
	});
	const invocationTargetListByCaseId = new Map();
	caseRecordList.forEach(({ fileName, caseDocument }) => {
		const targetList = caseDocument.scenario.filter((step) => step.invokes !== undefined).map((step) => {
			const target = caseById.get(step.invokes);
			if (target === undefined) {
				throw refusal(`${fileName} step ${step.codedNotation} invokes '${step.invokes}', which is no case of the corpus`, 'Invocation resolves: every INVOKES edge lands on a defined UseCase');
			}
			if (LEVEL_RANK[target.caseDocument.level] >= LEVEL_RANK[caseDocument.level]) {
				throw refusal(`ascending invocation: ${fileName} (${caseDocument.level}) step ${step.codedNotation} invokes '${step.invokes}' (${target.caseDocument.level})`, 'Invocation descends: a case invokes only a case at a LOWER altitude (summary > user-goal > sub-function)');
			}
			return step.invokes;
		});
		invocationTargetListByCaseId.set(caseDocument.id, targetList);
	});
	const cycleIn = ({ successorListByNode }) => {
		const stateByNode = new Map();
		const stack = [];
		const visit = (oneNode) => {
			stateByNode.set(oneNode, 'open');
			stack.push(oneNode);
			const successorList = successorListByNode.get(oneNode) || [];
			for (let successorIndex = 0; successorIndex < successorList.length; successorIndex++) {
				const successor = successorList[successorIndex];
				if (stateByNode.get(successor) === 'open') {
					return stack.slice(stack.indexOf(successor)).concat([successor]);
				}
				if (!stateByNode.has(successor)) {
					const found = visit(successor);
					if (found) {
						return found;
					}
				}
			}
			stack.pop();
			stateByNode.set(oneNode, 'closed');
			return null;
		};
		const nodeList = Array.from(successorListByNode.keys());
		for (let nodeIndex = 0; nodeIndex < nodeList.length; nodeIndex++) {
			if (!stateByNode.has(nodeList[nodeIndex])) {
				const found = visit(nodeList[nodeIndex]);
				if (found) {
					return found;
				}
			}
		}
		return null;
	};
	const invocationCycle = cycleIn({ successorListByNode: invocationTargetListByCaseId });
	if (invocationCycle) {
		throw refusal(`invocation cycle: ${invocationCycle.join(' -> ')}`, 'Invocation is acyclic: the corpus-wide INVOKES graph contains no cycles');
	}
	const childListByCaseId = new Map(Array.from(caseById.keys()).map((caseId) => [caseId, []]));
	caseRecordList.forEach(({ fileName, caseDocument }) => {
		(caseDocument.relatedUseCases || []).forEach((entry, index) => {
			if (!caseById.has(entry.useCase)) {
				throw refusal(`${fileName} relatedUseCases/${index} names '${entry.useCase}', which is no case of the corpus`, 'a relatedness edge lands on a defined UseCase');
			}
			if (entry.relationship === 'child') {
				childListByCaseId.get(caseDocument.id).push(entry.useCase);
			}
			if (entry.relationship === 'parent') {
				childListByCaseId.get(entry.useCase).push(caseDocument.id);
			}
		});
	});
	const hierarchyCycle = cycleIn({ successorListByNode: childListByCaseId });
	if (hierarchyCycle) {
		throw refusal(`hierarchy cycle: ${hierarchyCycle.join(' -> ')}`, 'Hierarchy is acyclic: a case must not be its own ancestor (parent/child)');
	}
	const subjectTargetSet = new Set();
	caseRecordList.forEach(({ caseDocument }) => {
		if (typeof caseDocument.subject === 'object' && caseDocument.subject.ref === undefined) {
			if (caseDocument.subject.identifier !== undefined) {
				subjectTargetSet.add(caseDocument.subject.identifier);
			}
			(caseDocument.subject.constituents || []).forEach((constituent) => subjectTargetSet.add(constituent));
		}
	});

	// -----------------------------------------------------------------
	// 3. reference nodes: one per cited thing, by world
	// -----------------------------------------------------------------
	const artifactStableIdByName = new Map();
	const worldOf = (citation) => {
		if (citation.kind === 'standard-wholesale') {
			return 'standardWholesale';
		}
		if (citation.kind === 'element') {
			return citation.linkageStatus === 'orphan' ? 'orphan' : 'element';
		}
		return citation.kind;
	};
	const registryEntryFor = ({ standardKey, origin }) => {
		const entry = resolutionRegistry[standardKey];
		if (entry === undefined) {
			throw refusal(`${origin}: standard '${standardKey}' is not a resolution-registry key (${Object.keys(resolutionRegistry).filter((oneName) => !oneName.startsWith('$')).join(', ')})`, 'a citation\'s standard is a key of the snapshot\'s resolutionRegistry.json');
		}
		return entry;
	};
	const referenceLocalOf = ({ citation, registryEntry, origin }) => {
		if (PLAIN_LOCAL_RE.test(citation.identifier)) {
			return citation.identifier;
		}
		const expansion = registryEntry.shorthandExpansion;
		const expansionHead = typeof expansion === 'string' ? expansion.slice(0, expansion.indexOf(sourceProfile.registryShorthandPlaceholder)) : null;
		if (expansionHead && citation.identifier.startsWith(expansionHead) && PLAIN_LOCAL_RE.test(citation.identifier.slice(expansionHead.length))) {
			return citation.identifier.slice(expansionHead.length);
		}
		throw refusal(`${origin}: cited identifier '${citation.identifier}' is neither a plain token nor the registry's own expansion (${expansion})`, 'the reference node\'s id is the identifier, or its registry-relative local part; nothing else is guessed (DESIGN-0 §3)');
	};
	const citedStableIdOf = ({ citation, registryEntry }) => (registryEntry.shorthandPattern !== null && new RegExp(registryEntry.shorthandPattern).test(citation.identifier)
		? registryEntry.shorthandExpansion.replace(sourceProfile.registryShorthandPlaceholder, citation.identifier)
		: citation.identifier);

	// referenceFor — the target stableId of one citation, defining its node; a subject citation lands on the Subject itself
	const referenceFor = ({ citation, caseLocal, site, origin }) => {
		const world = worldOf(citation);
		if (citation.kind === 'subject') {
			if (!subjectTargetSet.has(citation.ref)) {
				throw refusal(`${origin}: subject citation '${citation.ref}' is no case's subject and no declared constituent`, 'a subject citation references, never defines (the shared corpus gate)');
			}
			return { stableId: citation.ref, world };
		}
		if (world === 'standardWholesale') {
			const registryEntry = registryEntryFor({ standardKey: citation.standard, origin });
			const stableId = `${MINTED_PREFIX}ref/${citation.standard}`;
			defineNode({ stableId, role: DME_ROLES.EXTERNAL_REFERENCE, name: citation.standard, carriedProperties: { referenceKind: world, citedStandard: citation.standard, resolutionAnchor: registryEntry.anchor }, searchTextFields: null, comparable: { world, standard: citation.standard }, origin });
			return { stableId, world };
		}
		if (world === 'element') {
			const registryEntry = registryEntryFor({ standardKey: citation.standard, origin });
			const stableId = `${MINTED_PREFIX}ref/${citation.standard}/${referenceLocalOf({ citation, registryEntry, origin })}`;
			const linkageStatus = citation.linkageStatus === undefined ? DEFAULT_LINKAGE_STATUS : citation.linkageStatus;
			defineNode({
				stableId,
				role: DME_ROLES.EXTERNAL_REFERENCE,
				name: undefined,
				carriedProperties: { referenceKind: world, citedStandard: citation.standard, citedIdentifier: citation.identifier, citedStableId: citedStableIdOf({ citation, registryEntry }), resolutionAnchor: registryEntry.anchor, linkageStatus },
				searchTextFields: null,
				comparable: { world, standard: citation.standard, identifier: citation.identifier, linkageStatus },
				origin,
			});
			return { stableId, world, citedName: citation.name };
		}
		if (world === 'orphan' || world === 'intermediate') {
			defineNode({ stableId: citation.identifier, role: DME_ROLES.DATA_REFERENCE, name: undefined, carriedProperties: { referenceKind: world, ...(world === 'orphan' ? { citedIdentifier: citation.identifier, linkageStatus: citation.linkageStatus } : {}) }, searchTextFields: { referenceKind: world }, comparable: { world }, origin });
			return { stableId: citation.identifier, world, citedName: citation.name };
		}
		if (world === 'artifact') {
			let stableId = citation.identifier;
			if (stableId === undefined) {
				stableId = artifactStableIdByName.has(citation.name) ? artifactStableIdByName.get(citation.name) : `${MINTED_PREFIX}artifact/${caseLocal}/${site}`;
				artifactStableIdByName.set(citation.name, stableId);
			}
			defineNode({ stableId, role: DME_ROLES.DATA_REFERENCE, name: citation.name, carriedProperties: { referenceKind: world, origin: citation.origin }, searchTextFields: { referenceKind: world }, comparable: { world, name: citation.name, origin: citation.origin }, origin });
			return { stableId, world };
		}
		throw refusal(`${origin}: citation kind '${citation.kind}' is not a v0.11 citation world`, 'element, standard-wholesale, artifact, subject, intermediate');
	};
	// the one-identifier-one-name rule for element and intermediate citations, applied after every site is seen
	const citedNameSiteListByStableId = new Map();
	const citationEdgeProperties = ({ citation, listPosition, reference }) => {
		if (reference.citedName !== undefined) {
			if (!citedNameSiteListByStableId.has(reference.stableId)) {
				citedNameSiteListByStableId.set(reference.stableId, new Set());
			}
			citedNameSiteListByStableId.get(reference.stableId).add(reference.citedName.trim());
		}
		return {
			role: citation.role,
			listPosition,
			...(citation.kind !== 'artifact' && citation.name !== undefined ? { name: citation.name } : {}),
			...(citation.linkageStatus !== undefined ? { linkageStatus: citation.linkageStatus } : {}),
			...(citation.kind === 'element' && citation.standard === null ? { standardIsNull: true } : {}),
			...(citation.kind === 'element' && typeof citation.standard === 'string' ? { standard: citation.standard } : {}),
		};
	};
	const addCitationEdgeList = ({ citationList, edgeTypeFor, fromStableId, caseLocal, sitePrefix, originPrefix }) => (citationList || []).map((citation, index) => {
		const reference = referenceFor({ citation, caseLocal, site: `${sitePrefix}.${index}`, origin: `${originPrefix}/${index}` });
		addEdge({ edgeType: edgeTypeFor(reference.world), fromStableId, toStableId: reference.stableId, edgeProperties: citationEdgeProperties({ citation, listPosition: index, reference }) });
		return { citation, reference };
	});
	const dataKeyOf = (citation) => {
		if (citation.kind === 'subject') {
			return citation.ref;
		}
		if (citation.kind === 'intermediate') {
			return citation.identifier;
		}
		if (citation.kind === 'standard-wholesale') {
			return `standard::${citation.standard}`;
		}
		if (citation.kind === 'artifact') {
			return `artifact::${citation.identifier === undefined ? citation.name : citation.identifier}`;
		}
		return `element::${citation.identifier}`;
	};

	// sharedNodeFor — define (or reuse) the node a shared slot names; returns { stableId, definition, statedInline }
	const sharedNodeFor = ({ kindName, reference, anonymousStableId, origin }) => {
		const definition = resolveShared({ kindName, reference, origin });
		const kindRow = SHARED_KIND_REGISTRY[kindName];
		const stableId = reference.ref !== undefined ? reference.ref : definition.identifier !== undefined ? definition.identifier : anonymousStableId;
		const carriedProperties = Object.keys(kindRow.carriedFieldByPropertyName).reduce((carried, propertyName) => {
			const fieldValue = definition[kindRow.carriedFieldByPropertyName[propertyName]];
			return fieldValue === undefined ? carried : { ...carried, [propertyName]: fieldValue };
		}, {});
		const { ref: unusedRef, ...comparableDefinition } = definition;
		defineNode({ stableId, role: kindRow.role, name: definition[kindRow.nameField], carriedProperties, searchTextFields: {}, comparable: comparableDefinition, origin });
		return { stableId, definition, statedInline: reference.ref === undefined };
	};

	// -----------------------------------------------------------------
	// 4. per case
	// -----------------------------------------------------------------
	const actorSiteListByStableId = new Map();
	const storyEdgesDoneSet = new Set();
	const subjectEdgesDoneSet = new Set();
	const performerNameByStoryStableId = new Map();
	const declaredRelationshipSet = new Set();
	caseRecordList.forEach(({ caseDocument }) => (caseDocument.relatedUseCases || []).forEach((entry) => declaredRelationshipSet.add(`${caseDocument.id}|${entry.relationship}|${entry.useCase}`)));

	caseRecordList.forEach(({ fileName, caseDocument, formatVersion, formatVersionSource }) => {
		const caseId = caseDocument.id;
		const caseLocal = caseLocalOf(caseId);
		walkStats.caseCount += 1;
		if (caseDocument.scope !== undefined && typeof caseDocument.scope !== 'string') {
			throw refusal(`${fileName}: scope is given in its object or ref form`, 'release 1.0 forges a string scope only (no Scope node: none in the corpus); the object form is one vocabulary row away');
		}
		const caseCarried = {
			...Object.keys(CASE_SCALAR_CARRIAGE).reduce((carried, propertyName) => (caseDocument[CASE_SCALAR_CARRIAGE[propertyName]] === undefined ? carried : { ...carried, [propertyName]: caseDocument[CASE_SCALAR_CARRIAGE[propertyName]] }), {}),
			...Object.keys(CASE_JSON_CARRIAGE).reduce((carried, propertyName) => (caseDocument[CASE_JSON_CARRIAGE[propertyName]] === undefined ? carried : { ...carried, [propertyName]: JSON.stringify(caseDocument[CASE_JSON_CARRIAGE[propertyName]]) }), {}),
			...(caseDocument.primaryActor === null ? { primaryActorIsNull: true } : { primaryActorToken: caseDocument.primaryActor }),
			formatVersion,
			formatVersionSource,
			sourceFileName: fileName,
		};
		defineNode({ stableId: caseId, role: DME_ROLES.USE_CASE, name: caseDocument.longName, carriedProperties: caseCarried, searchTextFields: { shortName: caseDocument.shortName }, comparable: { fileName }, origin: fileName });

		// the cast
		const actorStableIdByToken = new Map();
		const noteActorSite = ({ stableId, displayName, slotName, actorKind, origin }) => {
			if (!actorSiteListByStableId.has(stableId)) {
				actorSiteListByStableId.set(stableId, []);
			}
			actorSiteListByStableId.get(stableId).push({ displayName, slotName, actorKind, origin });
		};
		(caseDocument.actors || []).forEach((entry, index) => {
			const stableId = entry.identifier !== undefined ? entry.identifier : `${MINTED_PREFIX}actor/${caseLocal}/actors.${index}`;
			noteActorSite({ stableId, displayName: entry.actor, slotName: 'actors', actorKind: entry.kind, origin: `${fileName} actors/${index}` });
			addEdge({ edgeType: EDGE_TYPES.HAS_ACTOR, fromStableId: caseId, toStableId: stableId, edgeProperties: { role: entry.role, interest: entry.interest, listPosition: index } });
			[entry.identifier, entry.actor].filter((token) => token !== undefined).forEach((token) => actorStableIdByToken.set(token, stableId));
		});
		(caseDocument.interestedParties || []).forEach((entry, index) => {
			const stableId = entry.identifier !== undefined ? entry.identifier : `${MINTED_PREFIX}actor/${caseLocal}/interestedParties.${index}`;
			noteActorSite({ stableId, displayName: entry.party, slotName: 'interestedParties', actorKind: undefined, origin: `${fileName} interestedParties/${index}` });
			addEdge({ edgeType: EDGE_TYPES.HAS_INTERESTED_PARTY, fromStableId: caseId, toStableId: stableId, edgeProperties: { interest: entry.interest, listPosition: index, ...(entry.kind !== undefined ? { partyKind: entry.kind } : {}) } });
			[entry.identifier, entry.party].filter((token) => token !== undefined).forEach((token) => actorStableIdByToken.set(token, stableId));
		});
		if (caseDocument.primaryActor !== null) {
			const primaryStableId = actorStableIdByToken.get(caseDocument.primaryActor);
			if (primaryStableId === undefined) {
				throw refusal(`${fileName}: primaryActor '${caseDocument.primaryActor}' is not among the case's actors or interested parties`, 'Primary-actor cross-reference');
			}
			addEdge({ edgeType: EDGE_TYPES.HAS_PRIMARY_ACTOR, fromStableId: caseId, toStableId: primaryStableId, edgeProperties: {} });
		}

		// the subject
		const subjectTokenSet = new Set();
		let subjectStableId;
		if (typeof caseDocument.subject === 'string') {
			subjectStableId = `${MINTED_PREFIX}subject/${caseLocal}/subject`;
			defineNode({ stableId: subjectStableId, role: DME_ROLES.SUBJECT, name: caseDocument.subject, carriedProperties: {}, searchTextFields: {}, comparable: { name: caseDocument.subject }, origin: `${fileName} subject` });
			subjectTokenSet.add(caseDocument.subject);
			addEdge({ edgeType: EDGE_TYPES.HAS_SUBJECT, fromStableId: caseId, toStableId: subjectStableId, edgeProperties: { subjectForm: 'string' } });
		} else {
			const subjectNode = sharedNodeFor({ kindName: 'subject', reference: caseDocument.subject, anonymousStableId: `${MINTED_PREFIX}subject/${caseLocal}/subject`, origin: `${fileName} subject` });
			subjectStableId = subjectNode.stableId;
			[caseDocument.subject.ref, subjectNode.definition.identifier, subjectNode.definition.name].filter((token) => token !== undefined).forEach((token) => subjectTokenSet.add(token));
			addEdge({ edgeType: EDGE_TYPES.HAS_SUBJECT, fromStableId: caseId, toStableId: subjectStableId, edgeProperties: { subjectForm: subjectNode.statedInline ? 'inline' : 'ref' } });
			if (subjectNode.statedInline && !subjectEdgesDoneSet.has(subjectStableId)) {
				subjectEdgesDoneSet.add(subjectStableId);
				(subjectNode.definition.constituents || []).forEach((constituent, index) => {
					if (!nodeSpecByStableId.has(constituent) && !caseRecordList.some(({ caseDocument: otherDocument }) => typeof otherDocument.subject === 'object' && otherDocument.subject.identifier === constituent)) {
						defineNode({ stableId: constituent, role: DME_ROLES.SUBJECT, name: undefined, carriedProperties: {}, searchTextFields: { name: constituent }, comparable: { constituentOnly: true }, origin: `${fileName} subject/constituents/${index}` });
					}
					addEdge({ edgeType: EDGE_TYPES.HAS_CONSTITUENT, fromStableId: subjectStableId, toStableId: constituent, edgeProperties: { listPosition: index } });
				});
				addCitationEdgeList({ citationList: subjectNode.definition.comprises, edgeTypeFor: () => EDGE_TYPES.COMPRISES, fromStableId: subjectStableId, caseLocal, sitePrefix: 'subject.comprises', originPrefix: `${fileName} subject/comprises` });
				addCitationEdgeList({ citationList: subjectNode.definition.governs, edgeTypeFor: () => EDGE_TYPES.GOVERNS, fromStableId: subjectStableId, caseLocal, sitePrefix: 'subject.governs', originPrefix: `${fileName} subject/governs` });
			}
		}
		const resolvedSubject = typeof caseDocument.subject === 'object' ? resolveShared({ kindName: 'subject', reference: caseDocument.subject, origin: `${fileName} subject` }) : {};

		// trigger, assumptions, guarantees, value drivers
		const triggerNode = sharedNodeFor({ kindName: 'event', reference: caseDocument.triggeredBy, anonymousStableId: `${MINTED_PREFIX}event/${caseLocal}/triggeredBy`, origin: `${fileName} triggeredBy` });
		addEdge({ edgeType: EDGE_TYPES.TRIGGERED_BY, fromStableId: caseId, toStableId: triggerNode.stableId, edgeProperties: { statedInline: triggerNode.statedInline } });
		(caseDocument.assumes || []).forEach((entry, index) => {
			const conditionNode = sharedNodeFor({ kindName: 'condition', reference: entry, anonymousStableId: `${MINTED_PREFIX}condition/${caseLocal}/assumes.${index}`, origin: `${fileName} assumes/${index}` });
			addEdge({ edgeType: EDGE_TYPES.ASSUMES, fromStableId: caseId, toStableId: conditionNode.stableId, edgeProperties: { listPosition: index, statedInline: conditionNode.statedInline } });
		});
		(caseDocument.guarantees || []).forEach((entry, index) => {
			const conditionNode = sharedNodeFor({ kindName: 'condition', reference: entry.condition, anonymousStableId: `${MINTED_PREFIX}condition/${caseLocal}/guarantees.${index}`, origin: `${fileName} guarantees/${index}/condition` });
			addEdge({ edgeType: EDGE_TYPES.GUARANTEES, fromStableId: caseId, toStableId: conditionNode.stableId, edgeProperties: { role: entry.role, listPosition: index, statedInline: conditionNode.statedInline } });
		});
		const caseDriverTokenSet = new Set();
		(caseDocument.valueDrivers || []).forEach((entry, index) => {
			const driverNode = sharedNodeFor({ kindName: 'valueDriver', reference: entry.valueDriver, anonymousStableId: `${MINTED_PREFIX}valueDriver/${caseLocal}/valueDrivers.${index}`, origin: `${fileName} valueDrivers/${index}` });
			caseDriverTokenSet.add(driverNode.stableId);
			addEdge({ edgeType: EDGE_TYPES.ALIGNS_WITH, fromStableId: caseId, toStableId: driverNode.stableId, edgeProperties: { listPosition: index, statedInline: driverNode.statedInline, ...(entry.notes !== undefined ? { notes: entry.notes } : {}) } });
		});
		(caseDocument.resources || []).forEach((entry, index) => {
			const resourceStableId = entry.identifier !== undefined ? entry.identifier : `${MINTED_PREFIX}resource/${caseLocal}/resources.${index}`;
			defineNode({ stableId: resourceStableId, role: DME_ROLES.RESOURCE, name: entry.title, carriedProperties: { url: entry.url }, searchTextFields: {}, comparable: { url: entry.url, title: entry.title }, origin: `${fileName} resources/${index}` });
			addEdge({ edgeType: EDGE_TYPES.HAS_RESOURCE, fromStableId: caseId, toStableId: resourceStableId, edgeProperties: { listPosition: index } });
		});
		const caseGovernsList = addCitationEdgeList({ citationList: caseDocument.governs, edgeTypeFor: () => EDGE_TYPES.GOVERNS, fromStableId: caseId, caseLocal, sitePrefix: 'governs', originPrefix: `${fileName} governs` });
		const requiredList = addCitationEdgeList({ citationList: caseDocument.sourceDataRequired, edgeTypeFor: (world) => REQUIREMENT_EDGE_BY_WORLD[world], fromStableId: caseId, caseLocal, sitePrefix: 'sourceDataRequired', originPrefix: `${fileName} sourceDataRequired` });

		// relatedness: the declared direction, and the loader's inverse where it is not itself declared
		(caseDocument.relatedUseCases || []).forEach((entry, index) => {
			const relatednessRow = RELATEDNESS_EDGE_BY_RELATIONSHIP[entry.relationship];
			addEdge({ edgeType: relatednessRow.edgeType, fromStableId: caseId, toStableId: entry.useCase, edgeProperties: { edgeOrigin: 'declared', listPosition: index, ...(entry.notes !== undefined ? { notes: entry.notes } : {}) } });
			if (relatednessRow.inverseRelationship !== null) {
				if (declaredRelationshipSet.has(`${entry.useCase}|${relatednessRow.inverseRelationship}|${caseId}`)) {
					walkStats.declaredInverseSkippedCount += 1;
				} else {
					addEdge({ edgeType: RELATEDNESS_EDGE_BY_RELATIONSHIP[relatednessRow.inverseRelationship].edgeType, fromStableId: entry.useCase, toStableId: caseId, edgeProperties: { edgeOrigin: 'derivedInverse' } });
					walkStats.derivedInverseEdgeCount += 1;
				}
			}
		});

		// the scenario
		const stepByCodedNotation = new Map();
		caseDocument.scenario.forEach((step) => {
			if (stepByCodedNotation.has(step.codedNotation)) {
				throw refusal(`${fileName}: codedNotation '${step.codedNotation}' names two steps`, 'codedNotation is the stable per-step handle; one step each');
			}
			stepByCodedNotation.set(step.codedNotation, step);
		});
		const resolvedStoryByCodedNotation = new Map();
		caseDocument.scenario.forEach((step, index) => {
			if (step.story === undefined && step.invokes === undefined) {
				throw refusal(`empty step: ${fileName} step ${step.codedNotation} has neither a story nor an invokes`, 'Step content: every step carries a story, an invokes, or both');
			}
			const stepKind = step.kind === undefined ? DEFAULT_STEP_KIND : step.kind;
			if (stepKind !== DEFAULT_STEP_KIND && step.branchesFrom === undefined) {
				throw refusal(`unresolvable branch point: ${fileName} step ${step.codedNotation} is a ${stepKind} with no branchesFrom`, 'Scenario integrity: a non-main step names the step it branches from');
			}
			if (step.branchesFrom !== undefined && !stepByCodedNotation.has(step.branchesFrom)) {
				throw refusal(`unresolvable branch point: ${fileName} step ${step.codedNotation} branches from '${step.branchesFrom}', which is no step of this case`, 'branchesFrom resolves: every declared branch point is a step of this case');
			}
			if (step.branchesFrom !== undefined && !(step.codedNotation.startsWith(step.branchesFrom) && step.codedNotation !== step.branchesFrom)) {
				throw refusal(`non-extending deviation notation: ${fileName} step ${step.codedNotation} does not extend its branch point '${step.branchesFrom}'`, 'Deviation notation extends its branch point');
			}
			if (step.story !== undefined) {
				resolvedStoryByCodedNotation.set(step.codedNotation, resolveShared({ kindName: 'story', reference: step.story, origin: `${fileName} scenario/${index}/story` }));
			}
		});
		// the derived data-flow prerequisites (v011-spec.md "Order is a partial order")
		const producerListByDataKey = new Map();
		resolvedStoryByCodedNotation.forEach((story, codedNotation) => (story.produces || []).forEach((citation) => {
			const dataKey = dataKeyOf(citation);
			producerListByDataKey.set(dataKey, (producerListByDataKey.get(dataKey) || []).concat([codedNotation]));
		}));
		const derivedListByCodedNotation = new Map();
		caseDocument.scenario.forEach((step) => {
			const story = resolvedStoryByCodedNotation.get(step.codedNotation);
			const derivedList = [];
			(story === undefined ? [] : story.consumes || []).forEach((citation) => (producerListByDataKey.get(dataKeyOf(citation)) || []).forEach((producerCodedNotation) => {
				if (producerCodedNotation !== step.codedNotation && derivedList.indexOf(producerCodedNotation) === -1) {
					derivedList.push(producerCodedNotation);
				}
			}));
			(step.dependsOn || []).forEach((declaredCodedNotation) => {
				if (!stepByCodedNotation.has(declaredCodedNotation)) {
					throw refusal(`${fileName} step ${step.codedNotation} dependsOn '${declaredCodedNotation}', which is no step of this case`, 'dependsOn resolves within the case');
				}
			});
			derivedListByCodedNotation.set(step.codedNotation, derivedList);
			walkStats.derivedPrerequisiteCount += derivedList.length;
		});
		const effectiveListByCodedNotation = new Map(caseDocument.scenario.map((step) => [step.codedNotation, (step.dependsOn || []).concat(derivedListByCodedNotation.get(step.codedNotation).filter((oneNotation) => (step.dependsOn || []).indexOf(oneNotation) === -1))]));
		const dependencyCycle = cycleIn({ successorListByNode: effectiveListByCodedNotation });
		if (dependencyCycle) {
			throw refusal(`dependency cycle: ${fileName} steps ${dependencyCycle.join(' -> ')}`, 'Dependency acyclicity: declared dependsOn UNION derived data-flow is a DAG');
		}
		effectiveListByCodedNotation.forEach((prerequisiteList, codedNotation) => prerequisiteList.forEach((prerequisite) => {
			if (positionOf(prerequisite) > positionOf(codedNotation)) {
				throw refusal(`${fileName} step ${codedNotation} has prerequisite ${prerequisite}, which is numbered after it`, 'Numbering is a valid linearization of the dependency DAG');
			}
		}));
		// intermediates: defined by first use within the case, consumed only where produced
		const producedIntermediateSet = new Set();
		resolvedStoryByCodedNotation.forEach((story) => (story.produces || []).filter((citation) => citation.kind === 'intermediate').forEach((citation) => producedIntermediateSet.add(citation.identifier)));
		resolvedStoryByCodedNotation.forEach((story, codedNotation) => (story.consumes || []).filter((citation) => citation.kind === 'intermediate').forEach((citation) => {
			if (!producedIntermediateSet.has(citation.identifier)) {
				throw refusal(`${fileName} step ${codedNotation} consumes ${citation.identifier}, which no step of this case produces`, 'Intermediates produced in case (defined by first use)');
			}
		}));

		let groundingFound = requiredList.concat(caseGovernsList).some(({ reference }) => GROUNDING_WORLD_LIST.indexOf(reference.world) !== -1)
			|| (resolvedSubject.comprises || []).some((citation) => GROUNDING_WORLD_LIST.indexOf(worldOf(citation)) !== -1)
			|| (resolvedSubject.governs || []).length > 0;

		caseDocument.scenario.forEach((step, index) => {
			walkStats.stepCount += 1;
			const stepKind = step.kind === undefined ? DEFAULT_STEP_KIND : step.kind;
			const stepCoordinate = {
				codedNotation: step.codedNotation,
				position: positionOf(step.codedNotation),
				listPosition: index,
				...(step.kind !== undefined ? { kind: step.kind } : {}),
				effectiveKind: stepKind,
				...(step.branchesFrom !== undefined ? { branchesFrom: step.branchesFrom } : {}),
				...(step.condition !== undefined ? { condition: step.condition } : {}),
				...(step.dependsOn !== undefined ? { dependsOnJson: JSON.stringify(step.dependsOn) } : {}),
				derivedPrerequisiteListJson: JSON.stringify(derivedListByCodedNotation.get(step.codedNotation)),
			};
			if (step.invokes !== undefined) {
				addEdge({ edgeType: EDGE_TYPES.INVOKES, fromStableId: caseId, toStableId: step.invokes, edgeProperties: step.story === undefined ? stepCoordinate : { codedNotation: step.codedNotation, position: positionOf(step.codedNotation), listPosition: index } });
			}
			if (step.story === undefined) {
				return;
			}
			const storyNode = sharedNodeFor({ kindName: 'story', reference: step.story, anonymousStableId: `${MINTED_PREFIX}story/${caseLocal}/step.${step.codedNotation}`, origin: `${fileName} scenario/${index}/story` });
			addEdge({ edgeType: EDGE_TYPES.HAS_STEP, fromStableId: caseId, toStableId: storyNode.stableId, edgeProperties: { ...stepCoordinate, statedInline: storyNode.statedInline } });
			const story = storyNode.definition;
			// the performer, resolved in THIS case's cast (or the Subject, when the traveling artifact acts)
			if (subjectTokenSet.has(story.actor)) {
				addEdge({ edgeType: EDGE_TYPES.ACTS_ON, fromStableId: storyNode.stableId, toStableId: subjectStableId, edgeProperties: {} });
			} else if (actorStableIdByToken.has(story.actor)) {
				addEdge({ edgeType: EDGE_TYPES.PERFORMED_BY, fromStableId: storyNode.stableId, toStableId: actorStableIdByToken.get(story.actor), edgeProperties: {} });
				if (!performerNameByStoryStableId.has(storyNode.stableId)) {
					performerNameByStoryStableId.set(storyNode.stableId, actorStableIdByToken.get(story.actor));
				}
			} else {
				throw refusal(`${fileName} step ${step.codedNotation}: the story's actor '${story.actor}' is not in this case's cast or its subject`, 'Unit subject: every unit is performed by an Actor of the case or acts on its Subject');
			}
			(story.serves || []).forEach((served, serveIndex) => {
				const servedStableId = served.ref !== undefined ? served.ref : served.identifier;
				if (!caseDriverTokenSet.has(servedStableId)) {
					throw refusal(`unclaimed serves: ${fileName} step ${step.codedNotation} serves '${servedStableId}', which is not among the case's valueDrivers`, 'Alignment rolls up: every SERVES target also appears in the case\'s valueDrivers');
				}
				if (!storyEdgesDoneSet.has(storyNode.stableId)) {
					const driverNode = sharedNodeFor({ kindName: 'valueDriver', reference: served, anonymousStableId: `${MINTED_PREFIX}valueDriver/${caseLocal}/step.${step.codedNotation}.serves.${serveIndex}`, origin: `${fileName} scenario/${index}/story/serves/${serveIndex}` });
					addEdge({ edgeType: EDGE_TYPES.SERVES, fromStableId: storyNode.stableId, toStableId: driverNode.stableId, edgeProperties: { listPosition: serveIndex, statedInline: driverNode.statedInline } });
				}
			});
			const storyCitationList = (story.consumes || []).concat(story.produces || []);
			if (storyCitationList.some((citation) => GROUNDING_WORLD_LIST.indexOf(worldOf(citation)) !== -1)) {
				groundingFound = true;
			}
			if (storyEdgesDoneSet.has(storyNode.stableId) || !storyNode.statedInline) {
				return;
			}
			storyEdgesDoneSet.add(storyNode.stableId);
			addCitationEdgeList({ citationList: story.consumes, edgeTypeFor: () => EDGE_TYPES.CONSUMES, fromStableId: storyNode.stableId, caseLocal, sitePrefix: `step.${step.codedNotation}.consumes`, originPrefix: `${fileName} scenario/${index}/story/consumes` });
			addCitationEdgeList({ citationList: story.produces, edgeTypeFor: () => EDGE_TYPES.PRODUCES, fromStableId: storyNode.stableId, caseLocal, sitePrefix: `step.${step.codedNotation}.produces`, originPrefix: `${fileName} scenario/${index}/story/produces` });
			(story.resources || []).forEach((entry, resourceIndex) => {
				const resourceStableId = entry.identifier !== undefined ? entry.identifier : `${MINTED_PREFIX}resource/${caseLocal}/step.${step.codedNotation}.resources.${resourceIndex}`;
				defineNode({ stableId: resourceStableId, role: DME_ROLES.RESOURCE, name: entry.title, carriedProperties: { url: entry.url }, searchTextFields: {}, comparable: { url: entry.url, title: entry.title }, origin: `${fileName} scenario/${index}/story/resources/${resourceIndex}` });
				addEdge({ edgeType: EDGE_TYPES.HAS_RESOURCE, fromStableId: storyNode.stableId, toStableId: resourceStableId, edgeProperties: { listPosition: resourceIndex } });
			});
		});
		// a story placed by ref gets its citation edges at its inline site, wherever in the corpus that is (every inline site is visited)
		if (!groundingFound) {
			throw refusal(`artifact-only grounding: ${fileName} (${caseId}) binds to no DataElement, Standard or OrphanElement`, 'Data-grounding: every case binds to at least one external element, whole standard or orphan (artifacts, subjects and intermediates do not ground)');
		}
	});

	// -----------------------------------------------------------------
	// 5. actors: one display name per identifier, one kind per slot
	// -----------------------------------------------------------------
	actorSiteListByStableId.forEach((siteList, stableId) => {
		const displayNameList = Array.from(new Set(siteList.map((oneSite) => oneSite.displayName)));
		if (displayNameList.length > 1) {
			throw refusal(`identifier conflict: actor '${stableId}' carries two display names ${JSON.stringify(displayNameList)} (${siteList.map((oneSite) => oneSite.origin).join(' vs ')})`, 'an actor compares by its node projection: one display name per identifier');
		}
		const actorKindList = Array.from(new Set(siteList.filter((oneSite) => oneSite.slotName === 'actors').map((oneSite) => (oneSite.actorKind === undefined ? '<absent>' : oneSite.actorKind))));
		if (actorKindList.length > 1) {
			throw refusal(`identifier conflict: actor '${stableId}' carries two actors[] kinds ${JSON.stringify(actorKindList)}`, 'kind is compared within one slot type');
		}
		const actorKind = actorKindList.length === 1 && actorKindList[0] !== '<absent>' ? actorKindList[0] : undefined;
		defineNode({ stableId, role: DME_ROLES.ACTOR, name: displayNameList[0], carriedProperties: actorKind === undefined ? {} : { actorKind }, searchTextFields: {}, comparable: { stableId }, origin: siteList[0].origin });
	});
	citedNameSiteListByStableId.forEach((nameSet, stableId) => {
		if (nameSet.size > 1) {
			throw refusal(`identifier conflict: '${stableId}' is cited under two names ${JSON.stringify(Array.from(nameSet))}`, 'Citation name coherence: one identifier, one name');
		}
		const nodeSpec = nodeSpecByStableId.get(stableId);
		nodeSpec.name = Array.from(nameSet)[0];
	});

	// -----------------------------------------------------------------
	// 6. mint: nodes in byte-sorted stableId order (determinism), then the root ownership edges, then the edges
	// -----------------------------------------------------------------
	const stableIdList = Array.from(nodeSpecByStableId.keys()).sort();
	stableIdList.forEach((stableId) => {
		const nodeSpec = nodeSpecByStableId.get(stableId);
		const searchTextElement = nodeSpec.searchTextFields === null
			? undefined
			: {
				role: nodeSpec.role,
				standardName: STANDARD_NAME,
				...nodeSpec.searchTextFields,
				// a nameless node (a declared constituent subject) is searched by its identifier, which the walk hands as searchTextFields.name
				name: nodeSpec.name === undefined ? nodeSpec.searchTextFields.name : nodeSpec.name,
				...(nodeSpec.role === DME_ROLES.USER_STORY && performerNameByStoryStableId.has(stableId) ? { actorName: nodeSpecByStableId.get(performerNameByStoryStableId.get(stableId)).name } : {}),
			};
		kit.makeNode({
			role: nodeSpec.role,
			perStandardLabel: LABEL_BY_ROLE[nodeSpec.role],
			stableId,
			name: nodeSpec.name,
			structural: { parentId: kit.rootStableId, path: stableId },
			carriedProperties: nodeSpec.carriedProperties,
			...(searchTextElement === undefined ? {} : { searchTextElement }),
			origin: nodeSpec.origin,
		});
		kit.addEdge({ edgeType: rootOwnershipEdgeTypeFor(nodeSpec.role), fromStableId: kit.rootStableId, toStableId: stableId, edgeContext: `root->${stableId}` });
	});
	edgeList.forEach((oneEdge) => {
		if (!nodeSpecByStableId.has(oneEdge.fromStableId) || !nodeSpecByStableId.has(oneEdge.toStableId)) {
			throw refusal(`edge ${oneEdge.edgeType} ${oneEdge.fromStableId} -> ${oneEdge.toStableId} names a node the walk never defined`, 'a partial edge is never emitted');
		}
		kit.addEdge({ edgeType: oneEdge.edgeType, fromStableId: oneEdge.fromStableId, toStableId: oneEdge.toStableId, edgeContext: `${oneEdge.edgeType}:${oneEdge.fromStableId}->${oneEdge.toStableId}`, edgeProperties: oneEdge.edgeProperties });
	});

	Object.keys(walkStats).forEach((statName) => {
		kit.stats[statName] = walkStats[statName];
	});
	return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
};

module.exports = { emitContractGraph, LABEL_BY_ROLE, moduleName };
