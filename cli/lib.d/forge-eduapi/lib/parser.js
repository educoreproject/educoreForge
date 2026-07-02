'use strict';

// parser.js — EduAPI (1EdTech Ed-API / Edu-API v1.0) OpenAPI 3.0 JSON schema reader.
//
// HARVESTED+ADAPTED from trackA forge-eduapi/lib/parser.js: the OpenAPI JSON extraction logic is
// proven and kept in substance — the components.schemas walk, the $ref / anyOf / oneOf / allOf
// polymorphism collection (collectRefsAndEnums), enum -> optionSet/optionValue (merged + dedup,
// order preserved), the IMS status-envelope plumbing filter (Imsx_StatusInfo / Imsx_CodeMinor /
// Imsx_CodeMinorField), the 1EdTech persistent-identifier capture (x-class-pid / x-srcprop-pid),
// the CEDS-element-URL harvest (extractCedsIds over description), and the stub-class synthesis for
// unresolved $ref targets. EduAPI schema names are already clean (Person, Organization, Enrollment
// — NO DType suffix to strip, unlike CASE), so displayName === schemaName. ADAPTED AWAY: trackA's
// node-shaping (it built private EduApi* nodes — EduApiRoot/EduApiClass/EduApiProperty/
// EduApiOptionSet/EduApiOptionValue — with HAS_CLASS/HAS_PROPERTY/_parentEdge plumbing and a
// hand-rolled `|`-joined searchText, and used the graphForge parser contract (sourcePath, options,
// callback) -> {nodes, metadata}). THIS parser instead returns ONLY raw intermediate collections +
// the resolution maps + metadata; shaping into the universal property contract (the six Dme* roles,
// canonical ownership edges, searchText via the ONE shared builder, crossRefs, canonical cedsId,
// stableId/eduapiPath) happens in forgeEduapi.js. The parser NEVER touches Neo4j, embeddings, or
// the contract.
//
// EduAPI is a JSON OpenAPI source (mirrors forge-lif) — needs no js-yaml.
//
// Async style: a single callback (err, { entities, maps, metadata }); fs.readFileSync + JSON.parse
// is the only boundary and resolves immediately. No async/await, no try/catch-for-control-flow
// except the localized JSON parse boundary. camelCase only.

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration (harvested from trackA)
// ============================================================

// Three Imsx_* plumbing schemas (the IMS status-envelope) carry no data-model meaning.
const PLUMBING_SCHEMAS = new Set([
	'Imsx_StatusInfo',
	'Imsx_CodeMinor',
	'Imsx_CodeMinorField',
]);

const REF_PREFIX = '#/components/schemas/';
const CEDS_URL_PATTERN = /ceds\.ed\.gov\/element\/(\d+)/g;

// ============================================================
// Helpers (harvested verbatim-in-substance from trackA)
// ============================================================

// extractCedsIds — harvest the bare CEDS element ids from prose (description) at any depth. These
//   are EduAPI's native cross-reference to CEDS, when present.
const extractCedsIds = (...texts) => {
	const ids = new Set();
	texts.forEach((text) => {
		if (!text || typeof text !== 'string') {
			return;
		}
		const re = new RegExp(CEDS_URL_PATTERN.source, 'g');
		let match;
		while ((match = re.exec(text)) !== null) {
			ids.add(match[1]);
		}
	});
	return [...ids];
};

const resolveRefName = (refString) => {
	if (typeof refString !== 'string' || !refString.startsWith(REF_PREFIX)) {
		return null;
	}
	return refString.slice(REF_PREFIX.length);
};

// collectRefsAndEnums — collect all $ref targets AND any enum definitions from a property shape,
//   recursively through items / anyOf / oneOf / allOf. Returns
//   { refs: [{ schemaName, polymorphism }], enums: [array-of-values] }.
const collectRefsAndEnums = (shape) => {
	const refs = [];
	const enums = [];
	if (!shape || typeof shape !== 'object') {
		return { refs, enums };
	}

	if (shape.$ref) {
		const name = resolveRefName(shape.$ref);
		if (name) {
			refs.push({ schemaName: name, polymorphism: 'single' });
		}
	}

	if (Array.isArray(shape.enum) && shape.enum.length > 0) {
		enums.push(shape.enum);
	}

	if (shape.items && typeof shape.items === 'object') {
		const inner = collectRefsAndEnums(shape.items);
		inner.refs.forEach((oneRef) => refs.push(oneRef));
		inner.enums.forEach((oneEnum) => enums.push(oneEnum));
	}

	['anyOf', 'oneOf', 'allOf'].forEach((polyKey) => {
		if (Array.isArray(shape[polyKey])) {
			shape[polyKey].forEach((branch) => {
				if (!branch || typeof branch !== 'object') {
					return;
				}
				if (branch.$ref) {
					const name = resolveRefName(branch.$ref);
					if (name) {
						refs.push({ schemaName: name, polymorphism: polyKey });
					}
				}
				if (Array.isArray(branch.enum) && branch.enum.length > 0) {
					enums.push(branch.enum);
				}
				if (branch.items && typeof branch.items === 'object') {
					const inner = collectRefsAndEnums(branch.items);
					inner.refs.forEach((oneRef) => refs.push({ ...oneRef, polymorphism: polyKey }));
					inner.enums.forEach((oneEnum) => enums.push(oneEnum));
				}
			});
		}
	});

	return { refs, enums };
};

const inferDataType = (shape) => {
	if (!shape || typeof shape !== 'object') {
		return '';
	}
	if (shape.type) {
		return shape.type;
	}
	if (shape.$ref) {
		return 'reference';
	}
	if (Array.isArray(shape.anyOf)) {
		return 'anyOf';
	}
	if (Array.isArray(shape.oneOf)) {
		return 'oneOf';
	}
	if (Array.isArray(shape.allOf)) {
		return 'allOf';
	}
	return '';
};

// ============================================================
// Main reader — callback(err, { entities, maps, metadata })
// ============================================================

const parseEduapi = ({ sourcePath, xLog }, callback) => {
	const log = (xLog && xLog.status) || (() => {});

	if (!fs.existsSync(sourcePath)) {
		callback(`EduAPI OpenAPI JSON source not found: ${sourcePath}`);
		return;
	}

	// Accept either a directory (find first .json file) or a direct file path.
	let jsonPath = sourcePath;
	if (fs.statSync(sourcePath).isDirectory()) {
		// L15: sorted for cross-machine determinism; EXACTLY ONE candidate required — a stray
		// second source file would silently forge a different standard on another machine.
		const candidates = fs
			.readdirSync(sourcePath)
			.filter((name) => /\.json$/i.test(name))
			.sort();
		if (!candidates.length) {
			callback(`No .json source file in ${sourcePath}`);
			return;
		}
		if (candidates.length > 1) {
			callback(
				`${candidates.length} candidate .json source files in ${sourcePath} (${candidates.join(', ')}) — expected exactly one; remove the extras.`,
			);
			return;
		}
		jsonPath = path.join(sourcePath, candidates[0]);
	}

	let spec;
	let parseError = '';
	try {
		spec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
	} catch (err) {
		parseError = err.message;
	}
	if (parseError) {
		callback(`Failed to read/parse EduAPI JSON: ${parseError}`);
		return;
	}

	log(
		`[forge-eduapi/parser] parsing OpenAPI JSON (${(fs.statSync(jsonPath).size / 1024).toFixed(0)} KB)...`,
	);

	const schemas = (spec.components && spec.components.schemas) || {};
	const info = spec.info || {};
	const allNames = Object.keys(schemas);
	const keptNames = allNames.filter((name) => !PLUMBING_SCHEMAS.has(name));
	const filteredCount = allNames.length - keptNames.length;
	log(
		`[forge-eduapi/parser] kept schemas: ${keptNames.length} (filtered plumbing: ${filteredCount})`,
	);

	const keptNameSet = new Set(keptNames);

	// resolveRefTarget — a $ref schemaName -> { kind:'class'|'stub', schemaName, displayName }.
	//   EduAPI schema names are already clean -> displayName === schemaName. A target present in the
	//   kept schemas is a real class; otherwise (plumbing or undefined) a stub. The forge mints the
	//   same eduapiPath for both from the display name, so a REFERENCES edge always resolves.
	const resolveRefTarget = (schemaName) => {
		if (keptNameSet.has(schemaName)) {
			return { kind: 'class', schemaName, displayName: schemaName };
		}
		return { kind: 'stub', schemaName, displayName: schemaName };
	};

	// ------------------------------------------------------------
	// Raw intermediate collections (NO node shaping here — that is forgeEduapi.js's job)
	// ------------------------------------------------------------
	const classes = []; // real EduAPI classes (one per kept schema)
	const properties = []; // class properties (flat + $ref + polymorphic)
	const optionSets = []; // enum containers
	const optionValues = []; // enum members
	const references = []; // property -> target-class REFERENCES (with polymorphism)
	const stubNames = new Set(); // $ref targets resolving to neither a kept class

	const stats = {
		classes: 0,
		stubClasses: 0,
		properties: 0,
		refEdges: 0,
		polymorphicRefEdges: 0,
		optionSets: 0,
		optionValues: 0,
		persistentIdClasses: 0,
		persistentIdProperties: 0,
		cedsAnnotatedProperties: 0,
		cedsRefCount: 0,
	};

	// ---- real classes (one per kept schema) ----
	keptNames.forEach((schemaName) => {
		const schema = schemas[schemaName] || {};
		const displayName = schemaName; // EduAPI names are already clean (no DType suffix)
		const required = Array.isArray(schema.required) ? schema.required : [];
		const classProps = schema.properties || {};
		const persistentId = schema['x-class-pid'] || '';
		if (persistentId) {
			stats.persistentIdClasses++;
		}

		classes.push({
			displayName,
			schemaName,
			description: schema.description || '',
			persistentId,
			requiredFields: required,
			propertyCount: Object.keys(classProps).length,
			additionalProperties: schema.additionalProperties === true,
			isStub: false,
		});
		stats.classes++;

		// ---- properties of this class ----
		Object.keys(classProps).forEach((propName) => {
			const propShape = classProps[propName] || {};
			const propPersistentId = propShape['x-srcprop-pid'] || '';
			if (propPersistentId) {
				stats.persistentIdProperties++;
			}
			const cedsGlobalIds = extractCedsIds(propShape.description);
			if (cedsGlobalIds.length > 0) {
				stats.cedsAnnotatedProperties++;
				stats.cedsRefCount += cedsGlobalIds.length;
			}

			const { refs, enums } = collectRefsAndEnums(propShape);

			// REFERENCES (one per $ref branch; polymorphism preserved). Resolve the target so the
			// forge can mint the target class's eduapiPath; stub targets become synthesized stub classes.
			refs.forEach((oneRef) => {
				const resolved = resolveRefTarget(oneRef.schemaName);
				references.push({
					className: displayName,
					propertyName: propName,
					targetSchemaName: oneRef.schemaName,
					targetDisplayName: resolved.displayName,
					polymorphism: oneRef.polymorphism,
				});
				stats.refEdges++;
				if (oneRef.polymorphism !== 'single') {
					stats.polymorphicRefEdges++;
				}
				if (resolved.kind === 'stub') {
					stubNames.add(oneRef.schemaName);
				}
			});

			properties.push({
				name: propName,
				className: displayName,
				classSchemaName: schemaName,
				description: propShape.description || '',
				dataType: inferDataType(propShape),
				format: propShape.format || '',
				pattern: propShape.pattern || '',
				persistentId: propPersistentId,
				required: required.includes(propName),
				refCount: refs.length,
				isPolymorphic: refs.some((oneRef) => oneRef.polymorphism !== 'single'),
				referencedSchemas: refs.map((oneRef) => oneRef.schemaName),
				cedsGlobalIds, // RAW native CEDS element ids harvested from prose
				hasEnum: enums.length > 0,
			});
			stats.properties++;

			// ---- option set from merged enum(s) (dedup values, preserve order) ----
			if (enums.length > 0) {
				const merged = [];
				const seen = new Set();
				enums.forEach((arr) => {
					arr.forEach((oneValue) => {
						const asString = String(oneValue);
						if (!seen.has(asString)) {
							seen.add(asString);
							merged.push(asString);
						}
					});
				});
				if (merged.length > 0) {
					optionSets.push({
						className: displayName,
						propertyName: propName,
						valueCount: merged.length,
						description: propShape.description || '',
					});
					stats.optionSets++;
					merged.forEach((oneValue) => {
						optionValues.push({
							value: oneValue,
							className: displayName,
							propertyName: propName,
						});
						stats.optionValues++;
					});
				}
			}
		});
	});

	// ---- stub classes for unresolved $ref targets (referenced but not a kept data-model schema) ----
	[...stubNames].forEach((stubName) => {
		if (keptNameSet.has(stubName)) {
			return; // resolved after all — defensive
		}
		const reason = PLUMBING_SCHEMAS.has(stubName)
			? 'filtered as IMS status-envelope plumbing'
			: 'not defined in the source';
		classes.push({
			displayName: stubName,
			schemaName: stubName,
			description: `Stub — referenced by $ref from data-model schemas but ${reason}.`,
			persistentId: '',
			requiredFields: [],
			propertyCount: 0,
			additionalProperties: false,
			isStub: true,
		});
		stats.stubClasses++;
	});

	log(
		`[forge-eduapi/parser] classes=${stats.classes}(+${stats.stubClasses} stub), ` +
			`properties=${stats.properties} (${stats.cedsAnnotatedProperties} CEDS-annotated, ${stats.persistentIdProperties} with persistentId), ` +
			`refs=${stats.refEdges} (${stats.polymorphicRefEdges} polymorphic), optionSets=${stats.optionSets}, optionValues=${stats.optionValues}, cedsRefs=${stats.cedsRefCount}`,
	);

	callback('', {
		entities: { classes, properties, optionSets, optionValues, references },
		maps: { keptNameSet },
		metadata: {
			version: info.version || 'unknown',
			schemaTitle: info.title || 'Ed-API — 1EdTech Education API',
			openapiVersion: spec.openapi || '',
			publisher: (info.contact && info.contact.name) || 'IMS Global / 1EdTech',
			modelPid: info['x-model-pid'] || '',
			status: info['x-status'] || '',
			sourceFormat: 'openapi-3.0-json',
			sourceFiles: [path.basename(jsonPath)],
			sourceUrl: 'https://www.1edtech.org/standards/edu-api',
			...stats,
		},
	});
};

module.exports = {
	parseEduapi,
	extractCedsIds,
	collectRefsAndEnums,
	inferDataType,
	REF_PREFIX,
	CEDS_URL_PATTERN,
};
