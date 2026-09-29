'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// materialisationFanout.js — the instances a judged subject stands for, frozen with its record (phase B4a, 2026-09-28).
//
// A subject may stand for many instances (a question standing for every field that asks it). With the optional
// declaration key materialisationFanout, the run reads the declared instance edge ONCE, before any subject is judged,
// and each subject leaf carries instanceStableIdList: the instances its answer is to be written to. The frozen record
// carries that list, so the per-instance materialiser (phase B4b) can read it from the block, never from the graph.
// Until B4b the materialiser does not read it and still writes one edge per picked record, at its subject.
//
//   MATERIALISATION_FANOUT_KIND_REGISTRY   kind → { memberNameList, readInstanceStableIdListBySubject }
//   declarationReason(value)               the contract row's shape check → '' | reason
//   fannedOutLeafList({ leafList, fanoutDeclaration, instanceStableIdListBySubject }) → { leafList, instanceCount } | { error }
//
// ONE INSTANCE EDGE, ONE LIST. A judgment partition (judgmentPartition.js) splits the list this module attaches; it
// reads no instance edge of its own. A partition therefore requires fan-out, and the contract refuses one without it.
//
// WHERE THE GUARD IS. A subject with no instance is refused by name here: its answer would be written nowhere. The
// order of a list is not this module's business; the freeze canonicalises it (decisionBlock STABLE_ID_LIST_KEY_LIST).
//
// The kind row's reader is the only asynchronous part; fannedOutLeafList is pure and synchronous.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));

const EDGE_FROM_SUBJECT_KIND = 'edgeFromSubject';

const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const hasExactMembers = (candidate, memberNameList) => Object.keys(candidate).length === memberNameList.length && memberNameList.every((oneName) => Object.prototype.hasOwnProperty.call(candidate, oneName));

// readEdgeFromSubject — the declared edge among _source nodes, subject → instance, grouped by subject
const readEdgeFromSubject = ({ fanoutDeclaration, evidenceView }, callback) =>
	evidenceView.readEdgesAmongSource({ edgeTypeList: [fanoutDeclaration.edgeType] }, (edgeError, instanceEdgeList) => {
		if (edgeError) {
			callback(edgeError);
			return;
		}
		const instanceStableIdListBySubject = new Map();
		instanceEdgeList.forEach((oneEdge) => {
			if (!instanceStableIdListBySubject.has(oneEdge.fromStableId)) {
				instanceStableIdListBySubject.set(oneEdge.fromStableId, []);
			}
			instanceStableIdListBySubject.get(oneEdge.fromStableId).push(oneEdge.toStableId);
		});
		callback('', instanceStableIdListBySubject);
	});

// MATERIALISATION_FANOUT_KIND_REGISTRY — one row per fan-out kind: its declaration members and the reader that turns the
// graph into { subjectStableId → instance stableId list }. A new kind is a row here, never a branch in the orchestrator.
const MATERIALISATION_FANOUT_KIND_REGISTRY = Object.freeze({
	[EDGE_FROM_SUBJECT_KIND]: Object.freeze({
		memberNameList: Object.freeze(['kind', 'edgeType']),
		readInstanceStableIdListBySubject: readEdgeFromSubject,
	}),
});

// declarationReason — a registered kind carrying exactly its declared members
const declarationReason = (value) => {
	if (!isPlainObject(value) || MATERIALISATION_FANOUT_KIND_REGISTRY[value.kind] === undefined) {
		return `must be an object whose kind is one of ${Object.keys(MATERIALISATION_FANOUT_KIND_REGISTRY).join(', ')} (got ${JSON.stringify(value)})`;
	}
	const memberNameList = MATERIALISATION_FANOUT_KIND_REGISTRY[value.kind].memberNameList;
	if (!hasExactMembers(value, memberNameList)) {
		return `kind '${value.kind}' must be exactly { ${memberNameList.join(', ')} } (got ${JSON.stringify(Object.keys(value).sort())})`;
	}
	return '';
};

// fannedOutLeafList — each leaf gains instanceStableIdList, its subject's instances; a subject with none is refused
const fannedOutLeafList = ({ leafList, fanoutDeclaration, instanceStableIdListBySubject }) => {
	const fannedOutList = [];
	let instanceCount = 0;
	for (let leafIndex = 0; leafIndex < leafList.length; leafIndex++) {
		const oneLeaf = leafList[leafIndex];
		const instanceStableIdList = instanceStableIdListBySubject.get(oneLeaf.subjectStableId);
		if (instanceStableIdList === undefined) {
			return { error: refuse.byName({ moduleName, what: `subject ${oneLeaf.subjectStableId} has no '${fanoutDeclaration.edgeType}' instance`, where: 'under materialisationFanout a judged subject is written to its instances; a subject with none would be judged and written nowhere' }) };
		}
		instanceCount += instanceStableIdList.length;
		fannedOutList.push({ ...oneLeaf, instanceStableIdList: instanceStableIdList.slice() });
	}
	return { leafList: fannedOutList, instanceCount };
};

module.exports = {
	EDGE_FROM_SUBJECT_KIND,
	MATERIALISATION_FANOUT_KIND_REGISTRY,
	declarationReason,
	fannedOutLeafList,
	moduleName,
};
