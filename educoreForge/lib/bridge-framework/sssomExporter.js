'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// sssomExporter.js — toSssomTsv (SPEC-bridgeFramework-v1.md §8; Profile §4; RULINGS P7, BF13, 12:05 #9;
// BR-041, BR-046, BR-052..058). A first-class member, run at the end of every re-judge (beside the block in
// the run's output dir; outputPath REQUIRED) and on demand.
//
//   toSssomTsv({ decisionBlock, decisionBlockHash, cardByStableId, curieMap, setLevelSlots, outputPath }, cb)
//     → { outputPath, rowCount, subjectCount, setLevelSlots }
//   setLevelSlots = { mappingProvider: { url, verifiedBy }, subjectSource, subjectSourceVersion, objectSource,
//                     objectSourceVersion, subjectMatchField, objectMatchField, subjectCuriePrefix,
//                     labelTableProvenance | channelAssertionProvenance, authorId?, creatorId? }
//
// Rows: subject_id (the forged stableId VERBATIM — it already begins with subjectCuriePrefix:, RULING BR2), object_id (the card uri), predicate_id (skos:…),
// mapping_justification, object_label, confidence (judged only), subject_source/_version, object_source/
// _version (the curie_map EXPANSION IRIs of the subject and hub prefixes — derived, RULING B3 cp2 (iv)), subject_match_field,
// object_match_field, mapping_tool (+version, judged only), predicate_asserted_by, source_label. The metadata header is
// YAML with EVERY scalar quoted, mapping_set_id a URI, and every non-standard slot/column declared under
// extension_definitions (RULING B3 cp2, sssom-py conformance). mapping_date ONLY when a declared source column supplied it (none in v1 — a mapping_date is
// REFUSED). curie_map declares every non-built-in prefix; propagatable slots condensed to set level (the #
// header block). REFUSES BEFORE WRITING: an undeclared prefix; a banned justification; a mapping_provider not
// recorded as verified (verifiedBy null — never a placeholder); a mapping_date the source did not supply.
// The report carries the SUBJECT census beside the row count (82 same-target shared leaves → fewer rows than
// subjects, by design — RULING 12:05 #9). TSV only in v1.

const fs = require('fs');
const path = require('path');
const vocabularyLib = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { pickedRecordList } = require('./materialiser');
const { JUSTIFICATION_BY_RESOLUTION } = require('./materialiser');

const { sssomJustificationRefusal } = vocabularyLib;

const BUILT_IN_PREFIX_LIST = Object.freeze(['skos', 'semapv', 'owl', 'rdfs', 'sssom']);
// the NON-STANDARD slots / columns this exporter emits — every one DECLARED under extension_definitions (SSSOM non-standard
// slots) with a property IRI under the EDUcore namespace; the data is kept, its non-standard status stated
const EXTENSION_SLOT_NAME_LIST = Object.freeze(['mapping_provider_verified_by', 'label_table', 'channel_assertion', 'subject_census', 'source_label', 'predicate_asserted_by']);
const EXTENSION_PROPERTY_BASE = 'https://w3id.org/EDUcore/sssom/extension#';
const MAPPING_SET_ID_URN_BASE = 'urn:educore:decisionBlock:';
const URN_SCHEME_PREFIX = 'urn';
const URN_SCHEME_EXPANSION = 'urn:';
// yamlScalar — every metadata value QUOTED as a YAML double-quoted scalar (JSON string syntax is valid YAML): a bare value
// ending in ':' or containing ': ' is a YAML scanner error, and a real validator parses this header as YAML
const yamlScalar = (value) => JSON.stringify(String(value));
const COLUMN_LIST = Object.freeze([
	'subject_id',
	'predicate_id',
	'object_id',
	'mapping_justification',
	'object_label',
	'confidence',
	'subject_source',
	'subject_source_version',
	'object_source',
	'object_source_version',
	'subject_match_field',
	'object_match_field',
	'mapping_tool',
	'mapping_tool_version',
	'predicate_asserted_by',
	'source_label',
]);
const isPlainObject = (candidate) => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
// SSSOM_SET_SLOT_DISPOSITION_BY_PRODUCER_KIND — which set-level slots each producer carries, as data. Same
// idiom as the write seam's EDGE_PROVIDER_DISPOSITION_BY_PRODUCER_KIND, so the graph edge and the SSSOM row
// cannot drift into disagreeing about whether a mapping had a provider (RULING §11.7 (c)(d), amended 2026-08-17).
const SSSOM_SET_SLOT_DISPOSITION_BY_PRODUCER_KIND = Object.freeze({
	authored: Object.freeze({ mappingProvider: 'required', mappingTool: 'absent', subjectMatchField: 'required' }),
	inferred: Object.freeze({ mappingProvider: 'forbidden', mappingTool: 'required', subjectMatchField: 'omitted' }),
});

const prefixOf = (curie) => (typeof curie === 'string' && curie.indexOf(':') > 0 ? curie.slice(0, curie.indexOf(':')) : null);
const tsvCell = (value) => (value === undefined || value === null ? '' : String(value).replace(/[\t\r\n]/g, ' '));

const toSssomTsv = ({ decisionBlock, decisionBlockHash, cardByStableId, curieMap, setLevelSlots, outputPath } = {}, callback) => {
	const refuseWith = (what, where) => callback(refuse.byName({ moduleName, what, where }).message);
	if (!decisionBlock || !decisionBlock.header || !Array.isArray(decisionBlock.decisionRecordList)) {
		refuseWith('decisionBlock is not a parsed block', 'toSssomTsv({ decisionBlock, decisionBlockHash, cardByStableId, curieMap, setLevelSlots, outputPath })');
		return;
	}
	if (!isNonEmptyString(outputPath)) {
		refuseWith('outputPath is required', 'the TSV lands beside the block in the run output dir; there is no default path');
		return;
	}
	if (!isPlainObject(curieMap) || !isPlainObject(setLevelSlots) || !isPlainObject(cardByStableId)) {
		refuseWith('curieMap, setLevelSlots and cardByStableId must be objects', 'declare every non-built-in prefix and the set-level slots');
		return;
	}
	// SET-LEVEL SLOTS ARE CONDITIONAL BY producerKind (RULING §11.7 (c)(d), as amended 2026-08-17). An AUTHORED
	// set names its mapping_provider — who asserted these mappings — and the export refuses until that URL has
	// been verified to resolve. An INFERRED set has no provider at all (nobody asserted them) and names its
	// mapping_tool instead: the PRODUCER at set level. subject_match_field is OMITTED for an inferred set —
	// Profile §4.5 never defines it for derived, and a derived subject matched on no field, it matched on
	// meaning. Row-level mapping_tool remains the JUDGE for both producers and OVERRIDES the set-level value,
	// which is legal SSSOM and is exactly the distinction wanted: the set says what produced the mappings, the
	// row says what decided this one.
	const exportProducerKind = decisionBlock.header.producerKind;
	const setSlotDisposition = SSSOM_SET_SLOT_DISPOSITION_BY_PRODUCER_KIND[exportProducerKind];
	if (setSlotDisposition === undefined) {
		refuseWith(`the block's producerKind '${exportProducerKind}' names no SSSOM set-slot disposition`, `every producerKind declares which set-level slots it carries (${Object.keys(SSSOM_SET_SLOT_DISPOSITION_BY_PRODUCER_KIND).join(', ')})`);
		return;
	}
	const provider = setLevelSlots.mappingProvider;
	if (setSlotDisposition.mappingProvider === 'required') {
		if (!isPlainObject(provider) || !isNonEmptyString(provider.url)) {
			refuseWith('setLevelSlots.mappingProvider.url is absent', 'mapping_provider is a set-level slot (BR-041)');
			return;
		}
		if (provider.verifiedBy === null || provider.verifiedBy === undefined) {
			refuseWith(`mappingProvider ${provider.url} is not recorded as verified-to-resolve (verifiedBy null)`, 'the builder verifies the URL and records { sessionName, date, note }; the export refuses until then — never a placeholder (RULING P7)');
			return;
		}
	} else if (provider !== undefined && provider !== null) {
		refuseWith(`an '${exportProducerKind}' mapping set carries a mappingProvider (${JSON.stringify(provider)})`, 'nobody AUTHORED an inferred mapping; mapping_provider is ABSENT and mapping_tool names the producer (RULING §11.7 (c))');
		return;
	}
	if (setSlotDisposition.mappingTool === 'required' && !isNonEmptyString(setLevelSlots.mappingTool)) {
		refuseWith(`an '${exportProducerKind}' mapping set needs setLevelSlots.mappingTool`, 'the tool that produced the mappings, named once at set level (RULING §11.7 (c)); the per-row mapping_tool is the JUDGE and overrides it');
		return;
	}
	if (setLevelSlots.mappingDate !== undefined && setLevelSlots.mappingDate !== null) {
		refuseWith('a mapping_date was supplied but no source column supplies one in v1', 'mapping_date is DATA from the source only, never minted (BR-053, Profile §4.6)');
		return;
	}
	const requiredSlotList = ['subjectSource', 'subjectSourceVersion', 'objectSource', 'objectSourceVersion', 'objectMatchField', 'subjectCuriePrefix'].concat(setSlotDisposition.subjectMatchField === 'required' ? ['subjectMatchField'] : []);
	if (setSlotDisposition.subjectMatchField !== 'required' && isNonEmptyString(setLevelSlots.subjectMatchField)) {
		refuseWith(`an '${exportProducerKind}' mapping set carries subject_match_field '${setLevelSlots.subjectMatchField}'`, 'a derived subject matched on MEANING, not on a field; Profile §4.5 does not define the slot for it, so it is OMITTED (RULING §11.7 (d))');
		return;
	}
	const missingSlot = requiredSlotList.find((oneName) => !isNonEmptyString(setLevelSlots[oneName]));
	if (missingSlot !== undefined) {
		refuseWith(`setLevelSlots.${missingSlot} is absent`, 'every propagatable slot is stated once at set level');
		return;
	}
	const declaredPrefixSet = new Set(Object.keys(curieMap));
	const prefixRefusal = (curie, slotName) => {
		const prefix = prefixOf(curie);
		if (prefix === null) {
			return `${slotName} '${curie}' is not a CURIE`;
		}
		return BUILT_IN_PREFIX_LIST.indexOf(prefix) === -1 && !declaredPrefixSet.has(prefix) ? `${slotName} prefix '${prefix}' is not declared in curie_map (${Array.from(declaredPrefixSet).join(', ')})` : '';
	};
	const subjectPrefixRefusal = declaredPrefixSet.has(setLevelSlots.subjectCuriePrefix) ? '' : `subjectCuriePrefix '${setLevelSlots.subjectCuriePrefix}' is not declared in curie_map`;
	if (subjectPrefixRefusal) {
		refuseWith(subjectPrefixRefusal, 'curie_map declares every non-built-in prefix (Profile §4.6)');
		return;
	}
	const matchFieldPrefixList = (setSlotDisposition.subjectMatchField === 'required' ? String(setLevelSlots.subjectMatchField).split('|') : []).concat(String(setLevelSlots.objectMatchField).split('|'));
	const undeclaredMatchField = matchFieldPrefixList.map((oneField) => prefixRefusal(oneField, 'match_field')).find((oneReason) => oneReason !== '');
	if (undeclaredMatchField !== undefined) {
		refuseWith(undeclaredMatchField, 'subject_match_field / object_match_field prefixes are declared in curie_map');
		return;
	}
	// (iv) the SOURCE slots are the curie_map EXPANSION IRIs — subject: the subject prefix; object: the hub prefix the
	// objectMatchField names — derived, never literal; (ii) the set id is a URI over the block hash; a URN scheme used by any
	// expansion is declared in the effective curie map (identity expansion) so a CURIE-shaped 'urn:…' resolves
	const objectPrefix = prefixOf(String(setLevelSlots.objectMatchField).split('|')[0]);
	const subjectSourceIri = curieMap[setLevelSlots.subjectCuriePrefix];
	const objectSourceIri = objectPrefix === null ? undefined : curieMap[objectPrefix];
	if (!isNonEmptyString(subjectSourceIri) || !isNonEmptyString(objectSourceIri)) {
		refuseWith(`subject_source / object_source derive from curie_map[${setLevelSlots.subjectCuriePrefix}] / curie_map[${objectPrefix}] and one is absent`, 'the source slots are the declared expansion IRIs, never literals (RULING B3 checkpoint 2 (iv))');
		return;
	}
	const mappingSetId = `${MAPPING_SET_ID_URN_BASE}${decisionBlockHash}`;
	const usesUrnScheme = Object.keys(curieMap).some((onePrefix) => /^urn:/i.test(String(curieMap[onePrefix]))) || /^urn:/i.test(mappingSetId);
	const effectiveCurieMap = usesUrnScheme && curieMap[URN_SCHEME_PREFIX] === undefined ? { ...curieMap, [URN_SCHEME_PREFIX]: URN_SCHEME_EXPANSION } : curieMap;
	const rowList = [];
	const subjectSet = new Set();
	const picked = pickedRecordList(decisionBlock.decisionRecordList);
	for (let recordIndex = 0; recordIndex < picked.length; recordIndex++) {
		const oneRecord = picked[recordIndex];
		// ⟪G-2, adversarial review D4 2026-08-17⟫ RECORD-FIRST, byte-identical to the expression in
		// materialiser.js. Reading the table first relabelled every derived row as CompositeMatching — the
		// justification for "an algorithm chose among candidates", which says nothing about HOW the candidates
		// were proposed — while the block and the graph both carried SemanticSimilarityThresholdMatching. All 520
		// rows disagreed with the artifact they describe. The parallel-table comment two files away claimed the
		// edge and the export "cannot drift into disagreeing about the same fact"; they drifted because only ONE
		// of the two consulted the record. Documentary producers are unaffected: their records carry exactly the
		// table's values, so the two expressions agree byte for byte there.
		const justification = oneRecord.mappingJustification === undefined || oneRecord.mappingJustification === null ? JUSTIFICATION_BY_RESOLUTION[oneRecord.resolution] : oneRecord.mappingJustification;
		const justificationRefusal = sssomJustificationRefusal(justification);
		if (justificationRefusal) {
			refuseWith(justificationRefusal, 'Profile §4.2');
			return;
		}
		const card = cardByStableId[oneRecord.objectStableId];
		if (!card || !isNonEmptyString(card.uri) || !isNonEmptyString(card.name)) {
			refuseWith(`objectStableId ${oneRecord.objectStableId} has no card with uri and name`, 'object_id is the card uri and object_label its name (MUST)');
			return;
		}
		// subject_id IS the forged stableId VERBATIM — a forged id already carries its standard's prefix
		// (`toy:property/…`, `<standard>:property/…`); prepending would double it (RULING BR2). A stableId that does NOT
		// begin with the declared subjectCuriePrefix is a contract violation and is REFUSED by name, never repaired.
		if (oneRecord.subjectStableId.indexOf(`${setLevelSlots.subjectCuriePrefix}:`) !== 0) {
			refuseWith(`subjectStableId '${oneRecord.subjectStableId}' does not begin with the declared subjectCuriePrefix '${setLevelSlots.subjectCuriePrefix}:'`, 'subject_id is the forged stableId verbatim (RULING BR2); the prefix is never prepended and never repaired');
			return;
		}
		subjectSet.add(oneRecord.subjectStableId);
		rowList.push({
			subject_id: oneRecord.subjectStableId,
			predicate_id: `skos:${oneRecord.predicate}`,
			object_id: card.uri,
			mapping_justification: justification,
			object_label: card.name,
			confidence: oneRecord.resolution === 'judged' ? oneRecord.confidence : '',
			subject_source: subjectSourceIri,
			subject_source_version: setLevelSlots.subjectSourceVersion,
			object_source: objectSourceIri,
			object_source_version: setLevelSlots.objectSourceVersion,
			subject_match_field: setLevelSlots.subjectMatchField,
			object_match_field: setLevelSlots.objectMatchField,
			mapping_tool: oneRecord.resolution === 'judged' ? oneRecord.judge.judgeModel : '',
			mapping_tool_version: oneRecord.resolution === 'judged' ? oneRecord.judge.rendererVersion : '',
			predicate_asserted_by: oneRecord.predicateAssertedBy,
			source_label: oneRecord.sourceLabel === null || oneRecord.sourceLabel === undefined ? '' : oneRecord.sourceLabel,
		});
	}
	// ⟪B2 DEFECT #3 found by sssom-py on the first REAL export — RULING SABLE_RIVER 2026-08-16 (B3, "sssomExporter validator
	// conformance")⟫ the metadata header is YAML: (i) EVERY scalar is QUOTED (yamlScalar — a value ending in ':' or containing
	// ': ' broke the scanner: `EDUcoreHub: urn:educore:hub:CEDS:`); (ii) mapping_set_id is a URI (urn:educore:decisionBlock:<id>),
	// never a bare hash; (iii) every NON-STANDARD slot / column is DECLARED under extension_definitions (the data kept, declared
	// honestly); (iv) subject_source / object_source are the curie_map EXPANSION IRIs of the subject prefix and the hub prefix —
	// DERIVED from the declaration's curie map, never literals — and, because a URN is CURIE-shaped ('urn:…'), the URN scheme is
	// itself declared in curie_map (`urn: "urn:"`, an identity expansion) so a strict validator resolves it. Measured with
	// sssom-py 0.4.21: `sssom validate` exits 0 on this shape; the framework's PROXY (parseSssomTsv) had accepted the old shape.
	const extensionDefinitionList = EXTENSION_SLOT_NAME_LIST.map((oneSlot) => ({ slot_name: oneSlot, property: `${EXTENSION_PROPERTY_BASE}${oneSlot}`, type_hint: 'xsd:string' }));
	const headerLineList = [
		'#curie_map:',
		...Object.keys(effectiveCurieMap)
			.sort()
			.map((onePrefix) => `#  ${onePrefix}: ${yamlScalar(effectiveCurieMap[onePrefix])}`),
		// the provider lines appear ONLY for a producer whose row requires a provider; an inferred set names its
		// mapping_tool in their place. Spread-in rather than emitted-empty: an omitted SSSOM slot is omitted,
		// never present-and-blank (RULING §11.7 (c), amended 2026-08-17).
		...(setSlotDisposition.mappingProvider === 'required'
			? [
					`#mapping_provider: ${yamlScalar(provider.url)}`,
					`#mapping_provider_verified_by: ${yamlScalar(`${provider.verifiedBy.sessionName} ${provider.verifiedBy.date} — ${provider.verifiedBy.note}`)}`,
				]
			: []),
		...(setSlotDisposition.mappingTool === 'required' ? [`#mapping_tool: ${yamlScalar(setLevelSlots.mappingTool)}`] : []),
		`#mapping_set_id: ${yamlScalar(mappingSetId)}`,
		'#extension_definitions:',
		...extensionDefinitionList.reduce((soFar, oneDefinition) => soFar.concat([`#  - slot_name: ${yamlScalar(oneDefinition.slot_name)}`, `#    property: ${yamlScalar(oneDefinition.property)}`, `#    type_hint: ${yamlScalar(oneDefinition.type_hint)}`]), []),
		`#subject_source: ${yamlScalar(subjectSourceIri)}`,
		`#subject_source_version: ${yamlScalar(setLevelSlots.subjectSourceVersion)}`,
		`#object_source: ${yamlScalar(objectSourceIri)}`,
		`#object_source_version: ${yamlScalar(setLevelSlots.objectSourceVersion)}`,
		// ⟪G-1, adversarial review D4 2026-08-17⟫ CONDITIONAL on the disposition, exactly as mapping_tool above
		// is. The table already said `subjectMatchField: 'omitted'` for inferred, and the VALIDATION at the top of
		// this function already refused a value it should not carry — but this EMISSION consulted nothing, so
		// RULING §11.7(d)'s "OMITTED for derived" wrote the literal string "undefined" into the header and the
		// shipped file failed `sssom validate`. The data was right and one line did not read it.
		...(setSlotDisposition.subjectMatchField === 'required' ? [`#subject_match_field: ${yamlScalar(setLevelSlots.subjectMatchField)}`] : []),
		`#object_match_field: ${yamlScalar(setLevelSlots.objectMatchField)}`,
	];
	if (isNonEmptyString(setLevelSlots.authorId)) {
		headerLineList.push(`#author_id: ${yamlScalar(setLevelSlots.authorId)}`);
	}
	if (isNonEmptyString(setLevelSlots.creatorId)) {
		headerLineList.push(`#creator_id: ${yamlScalar(setLevelSlots.creatorId)}`);
	}
	if (setLevelSlots.labelTableProvenance !== undefined) {
		headerLineList.push(`#label_table: ${yamlScalar(JSON.stringify(setLevelSlots.labelTableProvenance))}`);
	}
	if (setLevelSlots.channelAssertionProvenance !== undefined) {
		headerLineList.push(`#channel_assertion: ${yamlScalar(JSON.stringify(setLevelSlots.channelAssertionProvenance))}`);
	}
	headerLineList.push(`#subject_census: ${yamlScalar(JSON.stringify({ subjectCount: subjectSet.size, rowCount: rowList.length, note: 'rows are per (subject stableId, predicate, object); several source subjects sharing one leaf yield ONE row' }))}`);
	const text = `${headerLineList.join('\n')}\n${COLUMN_LIST.join('\t')}\n${rowList.map((oneRow) => COLUMN_LIST.map((oneColumn) => tsvCell(oneRow[oneColumn])).join('\t')).join('\n')}${rowList.length ? '\n' : ''}`;
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFile(outputPath, text, 'utf8', (writeError) => {
		if (writeError) {
			callback(`${moduleName}: writing ${outputPath}: ${writeError.message}`);
			return;
		}
		callback('', { outputPath, rowCount: rowList.length, subjectCount: subjectSet.size, setLevelSlots });
	});
};

// parseSssomTsv(text) → { headerLineList, columnList, rowList } | { error } — the framework's own PROXY validator (BG-P7 a)
const parseSssomTsv = (text) => {
	if (typeof text !== 'string' || text.length === 0) {
		return { error: 'empty text' };
	}
	const lineList = text.split('\n');
	const headerLineList = lineList.filter((oneLine) => oneLine.startsWith('#'));
	const bodyLineList = lineList.filter((oneLine) => !oneLine.startsWith('#') && oneLine.length > 0);
	if (bodyLineList.length === 0) {
		return { error: 'no column header line' };
	}
	// the PROXY's YAML-header checks (RULING B3 cp2, sssom-py conformance): every `key: value` scalar in the metadata block is a
	// QUOTED (JSON-string) scalar — an unquoted value ending in ':' or containing ': ' is a YAML scanner error a real validator
	// refuses; and mapping_set_id is a URI (a scheme + ':'), never a bare hash
	const scalarLineList = headerLineList.filter((oneLine) => /^#\s*(- )?[A-Za-z_][A-Za-z0-9_]*: .+$/.test(oneLine));
	const unquotedLine = scalarLineList.find((oneLine) => {
		const value = oneLine.replace(/^#\s*(- )?[A-Za-z_][A-Za-z0-9_]*: /, '');
		let parsed;
		let fault = false;
		try {
			parsed = JSON.parse(value);
		} catch (parseError) {
			fault = true;
		}
		return fault || typeof parsed !== 'string';
	});
	if (unquotedLine !== undefined) {
		return { error: `metadata scalar is not a quoted YAML scalar: ${unquotedLine.slice(0, 120)}` };
	}
	const mappingSetIdLine = headerLineList.find((oneLine) => oneLine.startsWith('#mapping_set_id: '));
	if (mappingSetIdLine === undefined) {
		return { error: 'no #mapping_set_id line' };
	}
	const mappingSetIdValue = JSON.parse(mappingSetIdLine.replace('#mapping_set_id: ', ''));
	if (!/^[A-Za-z][A-Za-z0-9+.-]*:.+/.test(mappingSetIdValue) || /^[0-9a-f]{64}$/.test(mappingSetIdValue)) {
		return { error: `mapping_set_id '${mappingSetIdValue}' is not a URI (a scheme is required; a bare hash is not an id)` };
	}
	const columnList = bodyLineList[0].split('\t');
	const missingColumn = ['subject_id', 'predicate_id', 'object_id', 'mapping_justification'].find((oneName) => columnList.indexOf(oneName) === -1);
	if (missingColumn !== undefined) {
		return { error: `mandatory column '${missingColumn}' is absent` };
	}
	const rowList = bodyLineList.slice(1).map((oneLine) => {
		const cellList = oneLine.split('\t');
		return columnList.reduce((soFar, oneColumn, columnIndex) => ({ ...soFar, [oneColumn]: cellList[columnIndex] === undefined ? '' : cellList[columnIndex] }), {});
	});
	const badWidth = bodyLineList.slice(1).find((oneLine) => oneLine.split('\t').length !== columnList.length);
	if (badWidth !== undefined) {
		return { error: `a row has ${badWidth.split('\t').length} cells; the header has ${columnList.length}` };
	}
	return { headerLineList, columnList, rowList, headerScalarOf: (name) => { const line = headerLineList.find((oneLine) => oneLine.startsWith(`#${name}: `)); return line === undefined ? undefined : JSON.parse(line.replace(`#${name}: `, '')); } };
};

module.exports = { toSssomTsv, parseSssomTsv, COLUMN_LIST, BUILT_IN_PREFIX_LIST, EXTENSION_SLOT_NAME_LIST, EXTENSION_PROPERTY_BASE, MAPPING_SET_ID_URN_BASE, URN_SCHEME_PREFIX, yamlScalar, moduleName };
