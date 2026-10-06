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
//   auditMappingBlockText({ blockText, subject })                       → { subject, edgeCount, judgedSubjectCount?, invalidDebugEdgeCount, refusalMessage | null }   (pure)
//   (judgedSubjectCount, phase B4c: the distinct judgedSubjectStableId values of a fanned-out block; absent for any other)
//   auditManifestMappingBlocks({ standardsDatabase, manifestRefId }, cb) → cb(err, { manifestRefId, memberCount, mappingBlockList, refusalMessageList })
//
// Refuses BY NAME: an absent manifest; a member the store cannot return; a block whose text does not deserialise;
// any relationship block carrying an edge with mappingSource 'bridge-debug' (provenanceTier 'invalid-debug' until lane P, 2026-10-04) (naming the block subject and the
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
// the DATED alias table for retired judge identities (JOB 6, G6-g). Data beside this module, not under
// bridge-maker/lib: a new file there would move the decision-block fingerprint for a reason unrelated to content.
const judgeIdentityAliasTableLib = require(path.join(__dirname, 'judgeIdentityAliasTable'));

const { SCHEMA_BLOCK_KIND, MAPPING_PROPERTIES } = vocabularyLib;

// ⟪JOB 6, 2026-09-08⟫ THE JUDGE ENUMERATION — read-side, and it enumerates FROM THE MANIFEST.
// The population rule is the conservation audit's own: a population read from a registry of what you EXPECT
// to find cannot detect the thing nobody declared, which is the only judge a promotion gate really needs to
// show you. So nothing here consults judgeProviderRegistry, and that omission is the design.
//
// SCOPED TO resolution === 'judged', and the scope is load-bearing in both directions. A `specified` edge
// correctly carries NO judgeIdentity (graphSeamRules' JUDGED_ONLY_PROPERTY_LIST), so a guard that read every
// edge would refuse every authored bridge in the project; and a guard keyed on "does this block have edges"
// would demand a judge for a bridge that was never judged.
const JUDGED_RESOLUTION = 'judged';
// An ABSENT rendererVersion is reported AS ABSENT, in words. Never '', never null, never a substituted
// renderer version. [code fact, materialiser.js edgePropertiesFor] the current writer CANNOT produce the shape — it writes
// the version through a template literal, so it is always a string — but absence is the shape a fabricator
// needs, and a reader that quietly supplied a default here would print a version the edge does not carry
// into a certificate that a promoter reads as measured.
const ABSENT_RENDERER_VERSION_TOKEN = '(rendererVersion ABSENT — the block records none)';

const scalarPropertyOf = (edgeProperties, propertyName) => {
	const rawValue = edgeProperties === null || edgeProperties === undefined ? undefined : edgeProperties[propertyName];
	const scalarValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;
	// '' and whitespace are ABSENCE wearing a value's clothes; the block codec renders every property as a
	// one-element list, so a blank string is what a stripped property looks like on the wire.
	return typeof scalarValue === 'string' && scalarValue.trim() === '' ? undefined : scalarValue;
};

// judgeEnumerationOf — the pure enumeration over one block's harvested edges.
//   → { judgedEdgeCount, judgedEdgeMissingJudgeIdentityCount, judgeIdentityPairList, missingIdentityOffenderList }
// The pair list is DERIVED, ordered, and carries its own denominator per pair; nothing about it is declared
// in advance. Ordering is by (judgeIdentity, rendererVersion) so a certificate diffs cleanly.
const judgeEnumerationOf = (harvestedEdgeList) => {
	const judgedEdgeList = harvestedEdgeList.filter((oneEdge) => scalarPropertyOf(oneEdge.properties, MAPPING_PROPERTIES.RESOLUTION) === JUDGED_RESOLUTION);
	const missingIdentityOffenderList = judgedEdgeList.filter((oneEdge) => scalarPropertyOf(oneEdge.properties, MAPPING_PROPERTIES.JUDGE_IDENTITY) === undefined);
	// ⟪JOB 6b, G6-k⟫ A NON-STRING identity is its OWN fault class, refused separately from an absent one.
	// Before this it was enumerated with its native type, so judgeToolIdList held a number while --judgedBy
	// values are strings: indexOf could never match and the operator was told to name a judge NO SPELLING
	// COULD SATISFY. That is a STUCK promotion, not a clean refusal. Absent and malformed are DIFFERENT
	// facts for an operator ("no judge is recorded" vs "the judge recorded is not a name"), so they are
	// counted and reported separately rather than folded into one number.
	const malformedToolOffenderList = judgedEdgeList.filter((oneEdge) => {
		const writtenValue = scalarPropertyOf(oneEdge.properties, MAPPING_PROPERTIES.JUDGE_IDENTITY);
		return writtenValue !== undefined && typeof writtenValue !== 'string';
	});
	const judgedEdgeCountByPairRefId = {};
	judgedEdgeList.forEach((oneEdge) => {
		const writtenJudgeIdentity = scalarPropertyOf(oneEdge.properties, MAPPING_PROPERTIES.JUDGE_IDENTITY);
		if (writtenJudgeIdentity === undefined || typeof writtenJudgeIdentity !== 'string') {
			return; // both offender lists refuse these BY NAME; neither is an identity anyone could type back
		}
		// THE ONE PLACE a written identity becomes an ENUMERATED one. A retired spelling resolves to its
		// successor here so a pre-JOB-4 graph reports ONE judge rather than several spellings of one rule.
		// The table RENAMES and never admits or excludes: an identity it does not know passes through
		// untouched and is enumerated under its own name, because an unknown judge is precisely what this
		// gate exists to show the operator.
		const judgeIdentity = judgeIdentityAliasTableLib.currentModelIdentityFor(writtenJudgeIdentity);
		const rendererVersionRaw = scalarPropertyOf(oneEdge.properties, MAPPING_PROPERTIES.RENDERER_VERSION);
		const rendererVersion = rendererVersionRaw === undefined ? ABSENT_RENDERER_VERSION_TOKEN : `${rendererVersionRaw}`;
		// the UNIT SEPARATOR, not bare concatenation: ('ab','c') and ('a','bc') are DIFFERENT pairs and
		// must not collapse into one row. materialiser.js edgeUniquenessRefusal keys its check with the same
		// separator, for the same reason.
		const pairRefId = `${judgeIdentity}\u001f${rendererVersion}`;
		const existingPair = judgedEdgeCountByPairRefId[pairRefId];
		judgedEdgeCountByPairRefId[pairRefId] = existingPair === undefined ? { judgeIdentity, rendererVersion, judgedEdgeCount: 1 } : { judgeIdentity, rendererVersion, judgedEdgeCount: existingPair.judgedEdgeCount + 1 };
	});
	const judgeIdentityPairList = Object.keys(judgedEdgeCountByPairRefId)
		.sort()
		.map((onePairRefId) => judgedEdgeCountByPairRefId[onePairRefId]);
	return { judgedEdgeCount: judgedEdgeList.length, judgedEdgeMissingJudgeIdentityCount: missingIdentityOffenderList.length, judgedEdgeMalformedJudgeIdentityCount: malformedToolOffenderList.length, judgeIdentityPairList, missingIdentityOffenderList, malformedToolOffenderList };
};

// the harvest's PG-JSON edge record → the rule's edge shape ({ fromStableId, toStableId, type, properties }); a
// block edge's fromRef/toRef is { source, id } where id IS the endpoint's stableId (replay-block.js, the greenfield
// resolution key) — the rule names offenders by stableId
const refStableIdOf = (oneRef) => (oneRef && typeof oneRef === 'object' ? oneRef.id : oneRef);
const harvestedEdgeFrom = (oneEdge) => ({ fromStableId: refStableIdOf(oneEdge.fromRef), toStableId: refStableIdOf(oneEdge.toRef), type: oneEdge.type, properties: oneEdge.properties });

// the enumeration fields for a block that could not be READ at all. Present and empty, never omitted: an
// absent field and an empty one are the same value to a caller, and telling them apart is the whole subject
// of the gates below. judgeEnumerationRefusalMessage is explicitly null — "looked, nothing to refuse" — the
// same idiom refusalMessage already uses.
const UNREADABLE_BLOCK_ENUMERATION = { judgedEdgeCount: 0, judgedEdgeMissingJudgeIdentityCount: 0, judgedEdgeMalformedJudgeIdentityCount: 0, judgeIdentityPairList: [], judgeEnumerationRefusalMessage: null };

// auditMappingBlockText — PURE: one relationship block's text → its edge audit
const auditMappingBlockText = ({ blockText, subject } = {}) => {
	if (typeof blockText !== 'string' || blockText.length === 0) {
		return { subject, edgeCount: 0, invalidDebugEdgeCount: 0, ...UNREADABLE_BLOCK_ENUMERATION, refusalMessage: `${moduleName}: relationship block '${subject}' has no text — an empty block certifies nothing` };
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
		return { subject, edgeCount: 0, invalidDebugEdgeCount: 0, ...UNREADABLE_BLOCK_ENUMERATION, refusalMessage: `${moduleName}: relationship block '${subject}' does not deserialise (${codecFault}) — unreadable evidence certifies nothing` };
	}
	const harvestedEdgeList = deserialised.edges.map(harvestedEdgeFrom);
	const refusal = certificationCheckLib.debugEdgeRefusal({ harvestedEdgeList, blockLabel: subject });
	const invalidDebugEdgeCount = harvestedEdgeList.filter((oneEdge) => {
		// the debug marker is mappingSource 'bridge-debug' since lane P (2026-10-04); provenanceTier no longer rides a mapping edge
		const mappingSource = oneEdge.properties && oneEdge.properties.mappingSource;
		return (Array.isArray(mappingSource) ? mappingSource[0] : mappingSource) === certificationCheckLib.DEBUG_MAPPING_SOURCE;
	}).length;
	// ⟪JOB 6⟫ THE JUDGE ENUMERATION, and its refusal is kept in a SEPARATE FIELD from refusalMessage.
	// That separation is the mechanism by which "the invalid-debug refusal fires FIRST" is STRUCTURAL rather
	// than a matter of which message happens to be first in a list: the verb tests the invalid-debug channel,
	// returns on it, and only then looks at this one. It also leaves refusalMessage byte-unchanged for the
	// conjuncts that already assert on it.
	const enumeration = judgeEnumerationOf(harvestedEdgeList);
	// FAN-OUT (phase B4c): a fanned-out edge leaves an instance and names the subject that was judged. The count of those
	// subjects is reported beside edgeCount only for a block that carries the property, so any other audit row is unchanged.
	const judgedSubjectStableIdSet = new Set(harvestedEdgeList.map((oneEdge) => scalarPropertyOf(oneEdge.properties, MAPPING_PROPERTIES.JUDGED_SUBJECT_STABLE_ID)).filter((judgedSubjectStableId) => judgedSubjectStableId !== undefined));
	const judgedSubjectCensus = judgedSubjectStableIdSet.size === 0 ? {} : { judgedSubjectCount: judgedSubjectStableIdSet.size };
	// A judged edge with NO judgeIdentity is the READ-SIDE TWIN of the write-side rule
	// (graphSeamRules.js writeMappingEdge, JUDGED_ONLY_PROPERTY_LIST: judged ⇒ judgeIdentity). The write side
	// cannot be relied on to have run: a block can be hand-assembled, or written by a builder that predates
	// the rule. Named offender, by stableId, in the codec's own idiom — never "[object Object]".
	const blockLabelText = subject === undefined ? '(unnamed)' : subject;
	const firstMissingToolOffender = enumeration.missingIdentityOffenderList[0];
	const firstMalformedToolOffender = enumeration.malformedToolOffenderList[0];
	const judgeEnumerationRefusalMessage =
		firstMissingToolOffender !== undefined
			? `${moduleName}: relationship block '${blockLabelText}' carries ${enumeration.judgedEdgeMissingJudgeIdentityCount} JUDGED edge(s) with NO ${MAPPING_PROPERTIES.JUDGE_IDENTITY} (first: ${firstMissingToolOffender.fromStableId} -[${firstMissingToolOffender.type}]-> ${firstMissingToolOffender.toStableId}) — a judged edge that cannot say what judged it can never be named at promotion; this is the read-side twin of the write-side rule judged ⇒ ${MAPPING_PROPERTIES.JUDGE_IDENTITY}`
			: firstMalformedToolOffender === undefined
				? null
				// ⟪G6-k⟫ quote WHAT WAS WRITTEN and its TYPE. A refusal that says only "malformed" leaves the
				// operator hunting; the value and its type are what let them find the block that produced it.
				: `${moduleName}: relationship block '${blockLabelText}' carries ${enumeration.judgedEdgeMalformedJudgeIdentityCount} JUDGED edge(s) whose ${MAPPING_PROPERTIES.JUDGE_IDENTITY} is NOT A STRING (first: ${firstMalformedToolOffender.fromStableId} -[${firstMalformedToolOffender.type}]-> ${firstMalformedToolOffender.toStableId} carries ${JSON.stringify(scalarPropertyOf(firstMalformedToolOffender.properties, MAPPING_PROPERTIES.JUDGE_IDENTITY))}, a ${typeof scalarPropertyOf(firstMalformedToolOffender.properties, MAPPING_PROPERTIES.JUDGE_IDENTITY)}) — a judge identity that is not a name can never be typed back with --judgedBy, so it would refuse forever rather than refuse usefully`;
	return {
		subject,
		edgeCount: harvestedEdgeList.length,
		...judgedSubjectCensus,
		invalidDebugEdgeCount,
		judgedEdgeCount: enumeration.judgedEdgeCount,
		judgedEdgeMissingJudgeIdentityCount: enumeration.judgedEdgeMissingJudgeIdentityCount,
		judgedEdgeMalformedJudgeIdentityCount: enumeration.judgedEdgeMalformedJudgeIdentityCount,
		judgeIdentityPairList: enumeration.judgeIdentityPairList,
		judgeEnumerationRefusalMessage,
		refusalMessage: refusal === null ? null : refusal.message,
	};
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
		// ⟪JOB 6⟫ a SEPARATE channel from refusalMessageList. The separation is what makes "the invalid-debug
		// refusal fires FIRST" structural rather than a question of which message lands first in one list —
		// the verb tests that channel, returns on it, and only then looks at this one. It also leaves
		// refusalMessageList byte-unchanged for the conjuncts that already assert on it.
		const judgeEnumerationRefusalMessageList = [];
		const auditNext = (memberIndex) => {
			if (memberIndex >= relationshipMemberList.length) {
				// THE AGGREGATE, DERIVED from the per-block enumerations and from nothing else. judgeToolIdList
				// is what --judgedBy must name: the distinct set of ALIASED identities actually FOUND, never a
				// declared list, so a judge nobody expected still appears and still has to be named back.
				const aggregatePairByRefId = {};
				mappingBlockList.forEach((oneBlockRow) => {
					oneBlockRow.judgeIdentityPairList.forEach((onePair) => {
						const pairRefId = `${onePair.judgeIdentity}\u001f${onePair.rendererVersion}`;
						const runningPair = aggregatePairByRefId[pairRefId];
						aggregatePairByRefId[pairRefId] = runningPair === undefined ? { judgeIdentity: onePair.judgeIdentity, rendererVersion: onePair.rendererVersion, judgedEdgeCount: onePair.judgedEdgeCount } : { judgeIdentity: onePair.judgeIdentity, rendererVersion: onePair.rendererVersion, judgedEdgeCount: runningPair.judgedEdgeCount + onePair.judgedEdgeCount };
					});
				});
				const judgeIdentityPairList = Object.keys(aggregatePairByRefId).sort().map((onePairRefId) => aggregatePairByRefId[onePairRefId]);
				const judgeToolIdSeen = {};
				judgeIdentityPairList.forEach((onePair) => { judgeToolIdSeen[onePair.judgeIdentity] = true; });
				const judgeToolIdList = Object.keys(judgeToolIdSeen).sort();
				const judgedEdgeTotal = mappingBlockList.reduce((soFar, oneBlockRow) => soFar + oneBlockRow.judgedEdgeCount, 0);
				callback('', { manifestRefId, memberCount: memberList.length, mappingBlockList, refusalMessageList, judgeEnumerationRefusalMessageList, judgeIdentityPairList, judgeToolIdList, judgedEdgeTotal });
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
				mappingBlockList.push({ subject: oneMember.subject, refId: oneMember.schemaBlockRefId, edgeCount: audit.edgeCount, ...(audit.judgedSubjectCount === undefined ? {} : { judgedSubjectCount: audit.judgedSubjectCount }), invalidDebugEdgeCount: audit.invalidDebugEdgeCount, judgedEdgeCount: audit.judgedEdgeCount, judgedEdgeMissingJudgeIdentityCount: audit.judgedEdgeMissingJudgeIdentityCount, judgedEdgeMalformedJudgeIdentityCount: audit.judgedEdgeMalformedJudgeIdentityCount, judgeIdentityPairList: audit.judgeIdentityPairList });
				if (audit.refusalMessage !== null) {
					refusalMessageList.push(audit.refusalMessage);
				}
				if (audit.judgeEnumerationRefusalMessage !== null) {
					judgeEnumerationRefusalMessageList.push(audit.judgeEnumerationRefusalMessage);
				}
				auditNext(memberIndex + 1);
			});
		};
		auditNext(0);
	});
};

// ABSENT_RENDERER_VERSION_TOKEN is EXPORTED so the gates and any future certificate reader assert against
// the module's own constant rather than retyping the string. A gate that retypes a token is a second
// declaration of it, and two declarations of one value are two things that can drift — the subject of this
// whole campaign, in miniature.
module.exports = { auditMappingBlockText, auditManifestMappingBlocks, judgeEnumerationOf, ABSENT_RENDERER_VERSION_TOKEN, moduleName };
