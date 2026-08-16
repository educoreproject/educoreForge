'use strict';

// gold-eval-bridge-sibling.js — the -goldEvalCheck BRIDGE SIBLING (SPEC-bridgeFramework-v1.md §5.6 step 5 (e),
// §12 item 7, BG-DEBUG (c); RULING R5 and the B2 review ruling for B3: "`-goldEvalCheck`'s debugEdgeRefusal
// reads the MANIFEST block's edge list (the artifact, no container)"; Profile v1.0.6 §4.6). The rule ITSELF is
// the framework's (lib/bridge-framework/certificationCheck.js — pure, proven on the graph double by the bridge
// suite); THIS module is the seam owner's wiring: it reads the run's MANIFEST out of the standardsDatabase, takes
// every RELATIONSHIP member block (the mapping blocks Phase C harvested by the pair-scoped label), deserialises the
// block's EDGE lines through the replay codec (PG-JSONL — every property value a one-element list, which the rule
// scalarises), and applies debugEdgeRefusal per block. READ-ONLY: it opens the store, reads text, and computes;
// no graph, no docker, no LLM.
//
//   auditMappingBlockText({ blockText, subject })                       → { subject, edgeCount, invalidDebugEdgeCount, refusalMessage | null }   (pure)
//   auditManifestMappingBlocks({ standardsDatabase, manifestRefId }, cb) → cb(err, { manifestRefId, memberCount, mappingBlockList, refusalMessageList })
//
// Refuses BY NAME: an absent manifest; a member the store cannot return; a block whose text does not deserialise;
// any relationship block carrying an edge with provenanceTier 'invalid-debug' (naming the block subject and the
// first offender — the rule's own message). A manifest with ZERO relationship members is NOT a refusal — it is
// REPORTED as such (mappingBlockList: []), so a forge-only build certifies as before and a bridged build cannot
// hide a debug block behind "no blocks were looked at".
//
// callback(errString, result) throughout; no async/await; the ONE try/catch is the boundary translation of the
// replay codec's throw into the callback channel (the same dispensation actions.js takes for JSON.parse).

const path = require('path');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const certificationCheckLib = require(path.join(CORE_LIB, 'bridge-framework', 'certificationCheck'));
const replayBlockLib = require(path.join(CORE_LIB, 'replay', 'replay-block'))();
const vocabularyLib = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));

const { SCHEMA_BLOCK_KIND } = vocabularyLib;

// the harvest's PG-JSON edge record → the rule's edge shape ({ fromStableId, toStableId, type, properties }); a
// block edge's fromRef/toRef is { source, id } where id IS the endpoint's stableId (replay-block.js, the greenfield
// resolution key) — the rule names offenders by stableId
const refStableIdOf = (oneRef) => (oneRef && typeof oneRef === 'object' ? oneRef.id : oneRef);
const harvestedEdgeFrom = (oneEdge) => ({ fromStableId: refStableIdOf(oneEdge.fromRef), toStableId: refStableIdOf(oneEdge.toRef), type: oneEdge.type, properties: oneEdge.properties });

// auditMappingBlockText — PURE: one relationship block's text → its edge audit
const auditMappingBlockText = ({ blockText, subject } = {}) => {
	if (typeof blockText !== 'string' || blockText.length === 0) {
		return { subject, edgeCount: 0, invalidDebugEdgeCount: 0, refusalMessage: `${moduleName}: relationship block '${subject}' has no text — an empty block certifies nothing` };
	}
	let deserialised = null;
	let codecFault = null;
	// boundary translation: the replay codec THROWS on a malformed block; the audit REFUSES by name instead
	try {
		deserialised = replayBlockLib.deserializeBlock(blockText);
	} catch (codecError) {
		codecFault = codecError.message;
	}
	if (codecFault !== null) {
		return { subject, edgeCount: 0, invalidDebugEdgeCount: 0, refusalMessage: `${moduleName}: relationship block '${subject}' does not deserialise (${codecFault}) — unreadable evidence certifies nothing` };
	}
	const harvestedEdgeList = deserialised.edges.map(harvestedEdgeFrom);
	const refusal = certificationCheckLib.debugEdgeRefusal({ harvestedEdgeList, blockLabel: subject });
	const invalidDebugEdgeCount = harvestedEdgeList.filter((oneEdge) => {
		const tier = oneEdge.properties && oneEdge.properties.provenanceTier;
		return (Array.isArray(tier) ? tier[0] : tier) === vocabularyLib.PROVENANCE_TIER.INVALID_DEBUG;
	}).length;
	return { subject, edgeCount: harvestedEdgeList.length, invalidDebugEdgeCount, refusalMessage: refusal === null ? null : refusal.message };
};

// auditManifestMappingBlocks — the store-reading half: manifest → relationship members → per-block audit
const auditManifestMappingBlocks = ({ standardsDatabase, manifestRefId } = {}, callback) => {
	if (!standardsDatabase || typeof standardsDatabase.getManifest !== 'function' || typeof standardsDatabase.getBlock !== 'function') {
		callback(`${moduleName}: an OPEN standardsDatabase (getManifest, getBlock) is REQUIRED`);
		return;
	}
	if (typeof manifestRefId !== 'string' || manifestRefId.trim() === '') {
		callback(`${moduleName}: manifestRefId is REQUIRED and has no default — the audit is a claim about ONE manifest's mapping blocks`);
		return;
	}
	standardsDatabase.getManifest({ refId: manifestRefId }, (manifestError, manifest) => {
		if (manifestError) {
			callback(`${moduleName}: getManifest ${manifestRefId}: ${manifestError}`);
			return;
		}
		if (!manifest) {
			callback(`${moduleName}: manifest ${manifestRefId} is ABSENT from the store — nothing to certify`);
			return;
		}
		const memberList = Array.isArray(manifest.members) ? manifest.members : [];
		const relationshipMemberList = memberList.filter((oneMember) => oneMember.kind === SCHEMA_BLOCK_KIND.RELATIONSHIP);
		const mappingBlockList = [];
		const refusalMessageList = [];
		const auditNext = (memberIndex) => {
			if (memberIndex >= relationshipMemberList.length) {
				callback('', { manifestRefId, memberCount: memberList.length, mappingBlockList, refusalMessageList });
				return;
			}
			const oneMember = relationshipMemberList[memberIndex];
			standardsDatabase.getBlock({ refId: oneMember.schemaBlockRefId }, (blockError, blockRow) => {
				if (blockError) {
					callback(`${moduleName}: getBlock ${oneMember.schemaBlockRefId} (${oneMember.subject}): ${blockError}`);
					return;
				}
				if (!blockRow) {
					callback(`${moduleName}: manifest ${manifestRefId} names relationship block ${oneMember.schemaBlockRefId} (${oneMember.subject}) which is ABSENT from the blocks table`);
					return;
				}
				const audit = auditMappingBlockText({ blockText: typeof blockRow.text === 'string' ? blockRow.text : `${blockRow.text}`, subject: oneMember.subject });
				mappingBlockList.push({ subject: oneMember.subject, refId: oneMember.schemaBlockRefId, edgeCount: audit.edgeCount, invalidDebugEdgeCount: audit.invalidDebugEdgeCount });
				if (audit.refusalMessage !== null) {
					refusalMessageList.push(audit.refusalMessage);
				}
				auditNext(memberIndex + 1);
			});
		};
		auditNext(0);
	});
};

module.exports = { auditMappingBlockText, auditManifestMappingBlocks, moduleName };
