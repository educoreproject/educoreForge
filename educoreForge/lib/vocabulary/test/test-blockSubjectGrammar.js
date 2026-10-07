'use strict';

// test-blockSubjectGrammar.js — ⟪campaign P3, W-C-6 (V1-S40/S41/S42, V1-C35/C36)⟫ ONE block-subject grammar and ONE header
// shape per kind. Before P3 a base subject slugged its version ('ceds@14_0_0_0_base') while a relationship subject kept the
// pretty one ('ceds@14.0.0.0_rel_edfi@5.2.0_close'), and a relationship header put the WHOLE SUBJECT in standardKey.
//
//   a  every subject the composers make parses back to its parts, and re-composes byte for byte (base, relationship,
//      discriminated relationship)
//   b  the pre-P3 dotted relationship form is REFUSED by parseBlockSubject, by name
//   c  serializeHeaderLine writes exactly SCHEMA_BLOCK_HEADER_FIELD_LIST_BY_KIND[kind] in order (serializerVersion '2'); a
//      relationship header carries no standardKey; an unknown blockType is refused by name
//   d  subjectOfHeader reads a v2 header by kind, still reads a serializerVersion-1 header (replay of any existing
//      manifest), and refuses a v2 relationship header missing an identity field by name
//
// RED TWINS (in-memory doubles; nothing written):
//   versionsNotSlugged          relationshipSubject keeps the pretty versions -> a red
//   standardKeyBackOnRelationship  the relationship header row regains standardKey -> c red
//   versionOneHeadersUnread     subjectOfHeader's serializerVersion-1 branch removed -> d red
//   dottedFormAccepted          the version slug pattern admits '.' -> b red

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- W-C-6: one block-subject grammar, one header shape per kind

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));

const VOCABULARY_PATH = path.join(__dirname, '..', 'vocabulary.js');
const REPLAY_BLOCK_PATH = path.join(__dirname, '..', '..', 'replay', 'replay-block.js');

const subjectFor = (mutationList) => {
	if (mutationList.length === 0) {
		return { vocabulary: require(VOCABULARY_PATH), replayBlock: require(REPLAY_BLOCK_PATH)() };
	}
	// replay-block requires '../vocabulary/vocabulary' RELATIVELY, so the double compiles both with the same mutations
	return {
		vocabulary: moduleDouble.loadWithMutations({ modulePath: VOCABULARY_PATH, mutationList }),
		replayBlock: moduleDouble.loadWithMutations({ modulePath: REPLAY_BLOCK_PATH, mutationList })(),
	};
};

const RELATIONSHIP_TUPLE_LIST = [
	{ hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'edfi', sourceVersion: '5.2.0', producer: 'inferred' },
	{ hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'pesccollegetranscript1v8v0', sourceVersion: '1.8.0', producer: 'inferred' },
	{ hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'pesc260805', sourceVersion: 'aggregate-01', producer: 'inferred', discriminator: 'optionSet' },
	{ hubStandard: 'ceds', hubVersion: '14.0.0.0', sourceStandard: 'sif', sourceVersion: 'unknown_01', producer: 'authored' },
];
const BASE_TUPLE_LIST = [{ standardKey: 'ceds', version: '14.0.0.0' }, { standardKey: 'sif260928', version: '4.3' }, { standardKey: 'edfi', version: '5.2.0' }];
const EMBEDDING_HEADER = { embeddingModelVersion: 'voyage-4-large', embeddingEncoding: 'base64', embeddingDtype: 'float32', embeddingByteOrder: 'little-endian', embeddingDims: 1024 };

const judgeByConjunct = {
	a_composedSubjectsRoundTrip: ({ vocabulary }) => {
		const wrongList = [];
		RELATIONSHIP_TUPLE_LIST.forEach((oneTuple) => {
			const composed = vocabulary.relationshipSubject(oneTuple);
			const parsed = vocabulary.parseBlockSubject(composed.subject);
			const sameParts = !parsed.error && parsed.pairA === oneTuple.hubStandard && parsed.pairB === oneTuple.sourceStandard && parsed.producer === oneTuple.producer && parsed.discriminator === oneTuple.discriminator
				&& parsed.pairAVersionSlug === vocabulary.slugifyVersion(oneTuple.hubVersion) && parsed.pairBVersionSlug === vocabulary.slugifyVersion(oneTuple.sourceVersion);
			if (!sameParts) wrongList.push(`${composed.subject}: ${JSON.stringify(parsed)}`);
		});
		BASE_TUPLE_LIST.forEach((oneTuple) => {
			const composed = vocabulary.baseSubject(oneTuple);
			const parsed = vocabulary.parseBlockSubject(composed.subject);
			if (parsed.error || parsed.standardKey !== oneTuple.standardKey || parsed.versionSlug !== vocabulary.slugifyVersion(oneTuple.version)) wrongList.push(`${composed.subject}: ${JSON.stringify(parsed)}`);
		});
		return { pass: wrongList.length === 0, detail: wrongList.length ? wrongList.join(' | ') : `${RELATIONSHIP_TUPLE_LIST.length + BASE_TUPLE_LIST.length} subjects round-trip` };
	},
	b_dottedFormRefused: ({ vocabulary }) => {
		const parsed = vocabulary.parseBlockSubject('ceds@14.0.0.0_rel_edfi@5.2.0_close');
		return { pass: typeof parsed.error === 'string' && /is neither/.test(parsed.error), detail: JSON.stringify(parsed).slice(0, 200) };
	},
	c_headerShapeByKind: ({ vocabulary, replayBlock }) => {
		const relationshipLine = JSON.parse(replayBlock.serializeHeaderLine({ blockType: 'relationship', pairA: 'ceds', pairAVersion: '14.0.0.0', pairB: 'edfi', pairBVersion: '5.2.0', producer: 'inferred', standardKey: 'SHOULD-NOT-APPEAR', ...EMBEDDING_HEADER }));
		const baseLine = JSON.parse(replayBlock.serializeHeaderLine({ blockType: 'standardBase', standardKey: 'ceds', version: '14.0.0.0', stableUriPropertyName: 'uri', resolutionKey: 'stableId', ...EMBEDDING_HEADER }));
		let unknownRefusal = '';
		try {
			// the serializer's refusal is a THROW by its contract; catching it here observes that contract
			replayBlock.serializeHeaderLine({ blockType: 'bridge', pairA: 'a', pairB: 'b' });
		} catch (serializeError) {
			unknownRefusal = serializeError.message;
		}
		const expectedRelationshipKeyList = vocabulary.SCHEMA_BLOCK_HEADER_FIELD_LIST_BY_KIND.relationship.filter((fieldName) => fieldName !== 'discriminator');
		const expectedBaseKeyList = vocabulary.SCHEMA_BLOCK_HEADER_FIELD_LIST_BY_KIND.standardBase.filter((fieldName) => fieldName !== 'embeddingRefGrammar');
		const pass = JSON.stringify(Object.keys(relationshipLine)) === JSON.stringify(expectedRelationshipKeyList)
			&& relationshipLine.standardKey === undefined && relationshipLine.serializerVersion === '2'
			&& JSON.stringify(Object.keys(baseLine)) === JSON.stringify(expectedBaseKeyList)
			&& /blockType "bridge" has no header shape/.test(unknownRefusal);
		return { pass, detail: `relationship keys ${Object.keys(relationshipLine).join(',')}; base keys ${Object.keys(baseLine).join(',')}; unknown: ${unknownRefusal || 'NOT refused'}` };
	},
	d_headerSubjectByKindAndVersion: ({ vocabulary }) => {
		const v2Relationship = vocabulary.subjectOfHeader({ blockType: 'relationship', serializerVersion: '2', pairA: 'ceds', pairAVersion: '14.0.0.0', pairB: 'pesc260805', pairBVersion: 'aggregate-01', producer: 'inferred', discriminator: 'optionSet' });
		const v2Base = vocabulary.subjectOfHeader({ blockType: 'standardBase', serializerVersion: '2', standardKey: 'ceds', version: '14.0.0.0' });
		const v1Relationship = vocabulary.subjectOfHeader({ blockType: 'relationship', serializerVersion: '1', standardKey: 'ceds@14.0.0.0_rel_edfi@5.2.0_close' });
		const v2Missing = vocabulary.subjectOfHeader({ blockType: 'relationship', serializerVersion: '2', pairA: 'ceds', pairAVersion: '14.0.0.0', pairB: 'edfi', pairBVersion: '5.2.0' });
		const pass = v2Relationship.subject === 'ceds@14_0_0_0_rel_pesc260805@aggregate_01_close~optionSet' && v2Base.subject === 'ceds@14_0_0_0_base'
			&& v1Relationship.subject === 'ceds@14.0.0.0_rel_edfi@5.2.0_close' && /lacks producer/.test(v2Missing.error || '');
		return { pass, detail: JSON.stringify({ v2Relationship, v2Base, v1Relationship, v2Missing }).slice(0, 400) };
	},
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_composedSubjectsRoundTrip', twinName: 'versionsNotSlugged', find: '`${hubStandard}@${slugifyVersion(hubVersion)}${RELATIONSHIP_PAIR_INFIX}${sourceStandard}@${slugifyVersion(sourceVersion)}${producerSuffix}`', replace: '`${hubStandard}@${hubVersion}${RELATIONSHIP_PAIR_INFIX}${sourceStandard}@${sourceVersion}${producerSuffix}`' },
	{ conjunctRefId: 'b_dottedFormRefused', twinName: 'dottedFormAccepted', find: "const SUBJECT_VERSION_SLUG_SOURCE = '[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*';", replace: "const SUBJECT_VERSION_SLUG_SOURCE = '[A-Za-z0-9.-]+(?:_[A-Za-z0-9.-]+)*';" },
	{ conjunctRefId: 'c_headerShapeByKind', twinName: 'standardKeyBackOnRelationship', find: "Object.freeze(['kind', 'blockType', 'serializerVersion', 'pairA',", replace: "Object.freeze(['kind', 'blockType', 'serializerVersion', 'standardKey', 'pairA'," },
	{ conjunctRefId: 'd_headerSubjectByKindAndVersion', twinName: 'versionOneHeadersUnread', find: "	if (h.serializerVersion === '1' || h.serializerVersion === undefined) {", replace: "	if (false) {" },
];

harness.section('BASELINE — the real grammar passes every conjunct');
Object.keys(judgeByConjunct).forEach((conjunctRefId) => {
	const verdict = judgeByConjunct[conjunctRefId](subjectFor([]));
	harness.ok(`${conjunctRefId} PASS`, verdict.pass, verdict.detail);
});

harness.section('THE TWIN SWEEP — each conjunct OBSERVED RED under an in-memory double');
const reddenedConjunctList = [];
TWIN_LIST.forEach((oneTwin) => {
	const mutation = { modulePath: VOCABULARY_PATH, find: oneTwin.find, replace: oneTwin.replace };
	moduleDouble.assertMutationApplies(mutation);
	const verdict = judgeByConjunct[oneTwin.conjunctRefId](subjectFor([mutation]));
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail.slice(0, 200)}`);
	if (!verdict.pass) reddenedConjunctList.push(oneTwin.conjunctRefId);
});
harness.equal('every conjunct has an observed twin', Object.keys(judgeByConjunct).filter((conjunctRefId) => reddenedConjunctList.indexOf(conjunctRefId) === -1).join(','), '');

harness.report();
