'use strict';

// parser.js — DCTAP JSON-LD schema reader (Dublin Core Tabular Application Profile).
//
// HARVESTED+ADAPTED from the OLD forge-dctap/lib/parser.js: the JSON-LD navigation is reused (read
// `@graph`, bucket by `@type`, pull name/description/definition/cardinality, follow hasElement /
// belongsToComponent / constrainedBy / hasValue / broader). The OLD output contract (private Dctap*
// nodes with HAS_COMPONENT/DEFINES_CONCEPT/HAS_FIELD edges + a hand-rolled searchText) is NOT copied
// — this parser RE-SHAPES output to the SAME native node shape forge-ctdl / forge-ceds / forge-edfi
// emit:
//   { id, label, superLabel, properties, edges, _parentEdge?, _owningClassIds? }
// where `label` is the native per-standard label and `edges`/`_parentEdge` carry NATIVE edge types
// that the forge translates to the canonical contract.
//
// Source: dctap-elements.jsonld (hand-authored JSON-LD from
//   https://www.dublincore.org/specifications/dctap/elements/). @ids are dctap: CURIEs (globally
//   unique). @graph entries by @type (CODE FACT — verified against the real source):
//     Standard (1), Component (2: shape, statementTemplate), Element (12), AllowedValueSet (3),
//     AllowedValue (15), Concept (3: Profile, Shape, StatementTemplate).
//
// DCTAP-SPECIFIC navigation facts (verified against the real source, CODE FACT):
//   * a Component (shape / statementTemplate) is a structural container -> DmeClass; the root owns
//     each via a synthesized HAS_CLASS.
//   * an Element attaches to its owning Component via `belongsToComponent` (12/12 resolvable) ->
//     native HAS_FIELD parent edge -> canonical HAS_PROPERTY. Every Element belongs to exactly one
//     Component in this source (no multi-domain), but the parser carries _owningClassIds for
//     forge-family symmetry.
//   * an Element's option-set constraint is `constrainedBy` pointing at an AllowedValueSet (5/12
//     elements) -> native CONSTRAINED_BY -> canonical HAS_OPTION_SET (the property OWNS its set).
//   * an AllowedValue's owning set is the set-side `hasValue` list (15/15 resolvable) -> native
//     HAS_VALUE parent edge -> canonical HAS_VALUE. (DCTAP values carry no inScheme back-pointer, so
//     membership is read from the set's hasValue list — the authoritative path here.)
//   * a Concept (Profile / Shape / StatementTemplate) is a SKOS glossary term forming a `broader`
//     hierarchy (StatementTemplate broader Shape broader Profile). Concepts map to DmeClass and the
//     `broader` link becomes a native SUBCLASS_OF -> canonical SUBCLASS_OF. Concepts are root-owned
//     via HAS_CLASS like Components.
//   * DCTAP is a META-vocabulary: STANDARD-PURE, NO CEDS / cross-standard anchors anywhere.
//
// The parser NEVER touches Neo4j or embeddings. Pure read + reshape; errors via callback.

const fs = require('fs');
const path = require('path');

// ============================================================
// helpers
// ============================================================

const toArray = (value) => {
	if (!value) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
};

// localName — the part of a dctap: CURIE after the prefix (for fallback display names + paths).
const localName = (curie) => `${curie}`.split(':').pop().replace(/^_+/, '');

// ============================================================
// Main parser — graphForge native-node parser contract.
//   callback(err, { nodes, metadata }). nodes[].label is the native DCTAP label; the forge maps it.
// ============================================================

const parseDctap = ({ sourcePath, xLog } = {}, callback) => {
	const log = xLog && xLog.status ? xLog.status : () => {};

	if (!sourcePath || !fs.existsSync(sourcePath)) {
		callback(`forge-dctap parser: source not found: ${sourcePath}`);
		return;
	}

	// the parser accepts the version DIRECTORY (resolves dctap-elements.jsonld inside) OR the file.
	const stat = fs.statSync(sourcePath);
	const jsonPath = stat.isDirectory()
		? path.join(sourcePath, 'dctap-elements.jsonld')
		: sourcePath;

	if (!fs.existsSync(jsonPath)) {
		callback(`forge-dctap parser: DCTAP JSON-LD not found: ${jsonPath}`);
		return;
	}

	let doc;
	let readError = '';
	try {
		doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
	} catch (err) {
		readError = err.message;
	}
	if (readError) {
		callback(`forge-dctap parser: JSON parse failed (${jsonPath}): ${readError}`);
		return;
	}

	const graph = doc['@graph'] || [];
	log(`[forge-dctap] @graph entries: ${graph.length}`);

	// ---- bucket by @type (registry, not switch) ----
	const typeBucket = {
		Standard: [],
		Component: [],
		Element: [],
		Concept: [],
		AllowedValueSet: [],
		AllowedValue: [],
	};
	graph.forEach((entry) => {
		const type = entry['@type'];
		if (typeBucket[type]) {
			typeBucket[type].push(entry);
		} else {
			log(`[forge-dctap] unrecognized @type '${type}' on ${entry['@id']}`);
		}
	});

	const rawStandard = typeBucket.Standard;
	const rawComponents = typeBucket.Component;
	const rawElements = typeBucket.Element;
	const rawConcepts = typeBucket.Concept;
	const rawSets = typeBucket.AllowedValueSet;
	const rawValues = typeBucket.AllowedValue;

	if (rawStandard.length !== 1) {
		callback(`forge-dctap parser: expected exactly 1 Standard, got ${rawStandard.length}`);
		return;
	}

	// ---- membership sets so edge endpoints can be resolved before emission ----
	const componentIds = new Set(rawComponents.map((e) => e['@id']));
	const setIds = new Set(rawSets.map((e) => e['@id']));
	const conceptIds = new Set(rawConcepts.map((e) => e['@id']));

	const nodes = [];
	let constrainedElementCount = 0;
	let danglingConstrainedByCount = 0;

	// ---- ROOT (native DctapRoot) ----
	const std = rawStandard[0];
	nodes.push({
		id: std['@id'],
		label: 'DctapRoot',
		superLabel: 'DctapModel',
		properties: {
			name: std.name || 'DCTAP',
			fullName: std.fullName || '',
			description:
				std.description ||
				`Dublin Core Tabular Application Profile — ${rawComponents.length} components, ${rawElements.length} elements, ${rawConcepts.length} concepts, ${rawSets.length} allowed-value sets, ${rawValues.length} allowed values.`,
			uri: std['@id'],
			version: std.version || '',
			publishedDate: std.publishedDate || '',
			editor: std.editor || '',
			sourceURL: std.sourceURL || '',
			componentCount: rawComponents.length,
			elementCount: rawElements.length,
			conceptCount: rawConcepts.length,
			allowedValueSetCount: rawSets.length,
			allowedValueCount: rawValues.length,
		},
		edges: [],
	});

	// ---- DctapComponent nodes (Component -> DmeClass) ----
	rawComponents.forEach((comp) => {
		const id = comp['@id'];
		nodes.push({
			id,
			label: 'DctapComponent',
			superLabel: 'DctapModel',
			properties: {
				name: comp.name || localName(id),
				description: comp.description || comp.definition || '',
				uri: id,
				definition: comp.definition || '',
			},
			edges: [],
		});
	});

	// ---- DctapConcept nodes (Concept -> DmeClass; broader -> native SUBCLASS_OF) ----
	rawConcepts.forEach((concept) => {
		const id = concept['@id'];
		const edges = [];
		toArray(concept.broader).forEach((broaderId) => {
			if (conceptIds.has(broaderId)) {
				edges.push({ type: 'SUBCLASS_OF', targetId: broaderId, targetLabel: 'DctapConcept' });
			}
		});
		nodes.push({
			id,
			label: 'DctapConcept',
			superLabel: 'DctapModel',
			properties: {
				name: concept.name || localName(id),
				description: concept.description || concept.definition || '',
				uri: id,
				definition: concept.definition || '',
			},
			edges,
		});
	});

	// ---- DctapElement nodes (Element -> DmeProperty) ----
	rawElements.forEach((elem) => {
		const id = elem['@id'];
		const edges = [];

		// option-set constraint: constrainedBy pointing at an AllowedValueSet -> CONSTRAINED_BY.
		toArray(elem.constrainedBy).forEach((setRef) => {
			if (setIds.has(setRef)) {
				edges.push({
					type: 'CONSTRAINED_BY',
					targetId: setRef,
					targetLabel: 'DctapAllowedValueSet',
				});
				constrainedElementCount++;
			} else {
				danglingConstrainedByCount++;
			}
		});

		// owning component(s) via belongsToComponent (the structural parent -> HAS_PROPERTY).
		const owningComponentIds = toArray(elem.belongsToComponent).filter((c) => componentIds.has(c));

		const node = {
			id,
			label: 'DctapElement',
			superLabel: 'DctapModel',
			properties: {
				name: elem.name || localName(id),
				description: elem.description || '',
				uri: id,
				cardinality: elem.cardinality || '',
			},
			edges,
			_owningClassIds: owningComponentIds,
		};
		if (owningComponentIds.length > 0) {
			node._parentEdge = {
				type: 'HAS_FIELD',
				fromId: owningComponentIds[0],
				fromLabel: 'DctapComponent',
			};
		}
		nodes.push(node);
	});

	// ---- DctapAllowedValueSet nodes (AllowedValueSet -> DmeOptionSet) ----
	rawSets.forEach((set) => {
		const id = set['@id'];
		nodes.push({
			id,
			label: 'DctapAllowedValueSet',
			superLabel: 'DctapModel',
			properties: {
				name: set.name || localName(id),
				description: set.description || '',
				uri: id,
				valueCount: toArray(set.hasValue).length,
			},
			edges: [],
		});
	});

	// ---- DctapAllowedValue nodes (AllowedValue -> DmeOptionValue) ----
	// owning set is read from each set's hasValue list (DCTAP values carry no inScheme back-pointer).
	const valueToSetId = {};
	rawSets.forEach((set) => {
		const setId = set['@id'];
		toArray(set.hasValue).forEach((valueId) => {
			valueToSetId[valueId] = setId;
		});
	});

	rawValues.forEach((value) => {
		const id = value['@id'];
		const node = {
			id,
			label: 'DctapAllowedValue',
			superLabel: 'DctapModel',
			properties: {
				name: value.name || localName(id),
				description: value.description || '',
				uri: id,
			},
			edges: [],
		};
		const owningSetId = valueToSetId[id];
		if (owningSetId) {
			node._parentEdge = {
				type: 'HAS_VALUE',
				fromId: owningSetId,
				fromLabel: 'DctapAllowedValueSet',
			};
		}
		nodes.push(node);
	});

	log(
		`[forge-dctap] parsed: components ${rawComponents.length}, elements ${rawElements.length}, ` +
			`concepts ${rawConcepts.length}, allowed-value sets ${rawSets.length}, allowed values ${rawValues.length}; ` +
			`constrained elements ${constrainedElementCount}; dangling constrainedBy refs ${danglingConstrainedByCount}`,
	);

	callback('', {
		nodes,
		metadata: {
			version: std.version || 'Draft - Request for Comments',
			sourceFormat: 'json-ld',
			sourceFiles: [path.basename(jsonPath)],
			sourceUrl: std.sourceURL || 'https://www.dublincore.org/specifications/dctap/elements/',
			publishedDate: std.publishedDate || '',
			editor: std.editor || '',
			componentCount: rawComponents.length,
			elementCount: rawElements.length,
			conceptCount: rawConcepts.length,
			allowedValueSetCount: rawSets.length,
			allowedValueCount: rawValues.length,
			constrainedElementCount,
			danglingConstrainedByCount,
		},
	});
};

module.exports = parseDctap;
module.exports.parseDctap = parseDctap;
