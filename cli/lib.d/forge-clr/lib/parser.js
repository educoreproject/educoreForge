'use strict';

// parser.js — CLR (Comprehensive Learner Record) OpenAPI 3.0 JSON schema reader.
//
// HARVESTED+ADAPTED from trackA forge-clr/lib/parser.js: the OpenAPI extraction logic is proven and
// kept in substance — the components.schemas walk, the nine-schema plumbing filter (OpenApi* /
// Imsx_* / GetClrCredentialsResponse / ServiceDescriptionDocument), the $ref / anyOf / oneOf / allOf
// polymorphism collection (collectRefsAndEnums), enum -> optionSet/optionValue with multi-branch
// merge, the 1EdTech persistent-id harvest (x-class-pid on schemas, x-srcprop-pid on properties),
// the CEDS-element-URL harvest (extractCedsIds over description), and the stub-class synthesis for
// unresolved $ref targets. ADAPTED AWAY: trackA's node-shaping (it built private Clr* nodes —
// ClrRoot/ClrClass/ClrProperty/ClrOptionSet/ClrOptionValue — with HAS_CLASS/HAS_PROPERTY/_parentEdge
// plumbing and a hand-rolled `|`-joined searchText, and used the graphForge parser contract
// (sourcePath, options, callback) -> {nodes, metadata}). THIS parser instead returns ONLY raw
// intermediate collections + the resolution maps + metadata; shaping into the universal property
// contract (the six Dme* roles, canonical ownership edges, searchText via the ONE shared builder,
// crossRefs, canonical cedsId, stableId/clrPath) happens in forgeClr.js. The parser NEVER touches
// Neo4j, embeddings, or the contract.
//
// Unlike CASE, CLR has NO DType-suffix display convention (schema names are plain), is JSON (no
// js-yaml dependency), and carries 1EdTech persistent ids (x-class-pid / x-srcprop-pid) rather than
// privacy annotations.
//
// Async style: a single callback (err, { entities, maps, metadata }); fs.readFileSync + JSON.parse
// is the only boundary and resolves immediately. No async/await, no try/catch-for-control-flow
// except the localized JSON parse boundary. camelCase only.

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration (harvested from trackA)
// ============================================================

// Nine plumbing schemas (REST envelope machinery) carry no data-model meaning.
const PLUMBING_SCHEMAS = new Set([
	'OpenApiComponents',
	'OpenApiInfo',
	'OpenApiOAuth2SecurityScheme',
	'OpenApiSecuritySchemes',
	'Imsx_StatusInfo',
	'Imsx_CodeMinor',
	'Imsx_CodeMinorField',
	'GetClrCredentialsResponse',
	'ServiceDescriptionDocument',
]);

const REF_PREFIX = '#/components/schemas/';
const CEDS_URL_PATTERN = /ceds\.ed\.gov\/element\/(\d+)/g;

// ============================================================
// Helpers (harvested verbatim-in-substance from trackA)
// ============================================================

// extractCedsIds — harvest the bare CEDS element ids from prose (description). CLR's native
//   cross-reference to CEDS, when present.
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

const parseClr = ({ sourcePath, xLog }, callback) => {
	const log = (xLog && xLog.status) || (() => {});

	if (!fs.existsSync(sourcePath)) {
		callback(`CLR OpenAPI JSON source not found: ${sourcePath}`);
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
		callback(`Failed to read/parse CLR JSON: ${parseError}`);
		return;
	}

	log(`[forge-clr/parser] parsing OpenAPI JSON (${(fs.statSync(jsonPath).size / 1024).toFixed(0)} KB)...`);

	const schemas = (spec.components && spec.components.schemas) || {};
	const info = spec.info || {};
	const allNames = Object.keys(schemas);
	const keptNames = allNames.filter((name) => !PLUMBING_SCHEMAS.has(name));
	const filteredCount = allNames.length - keptNames.length;
	log(`[forge-clr/parser] kept schemas: ${keptNames.length} (filtered plumbing: ${filteredCount})`);

	const keptNameSet = new Set(keptNames);

	// resolveRefTarget — a $ref schemaName -> { kind:'class'|'stub', schemaName }. CLR has no DType
	//   suffix, so the display name IS the schema name. The forge mints the same clrPath for both a
	//   real and a stub target, so a REFERENCES edge always resolves to a real node stableId.
	const resolveRefTarget = (schemaName) => {
		if (keptNameSet.has(schemaName)) {
			return { kind: 'class', schemaName };
		}
		return { kind: 'stub', schemaName };
	};

	// ------------------------------------------------------------
	// Raw intermediate collections (NO node shaping here — that is forgeClr.js's job)
	// ------------------------------------------------------------
	const classes = []; // real CLR classes (one per kept schema)
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
		cedsAnnotatedProperties: 0,
		cedsRefCount: 0,
		persistentIdClasses: 0,
		persistentIdProperties: 0,
	};

	// ---- real classes (one per kept schema) ----
	keptNames.forEach((schemaName) => {
		const schema = schemas[schemaName] || {};
		const required = Array.isArray(schema.required) ? schema.required : [];
		const classProps = schema.properties || {};
		const classPid = schema['x-class-pid'] || '';
		if (classPid) {
			stats.persistentIdClasses++;
		}

		classes.push({
			displayName: schemaName, // CLR schema names ARE the display names (no DType strip)
			schemaName,
			description: schema.description || '',
			requiredFields: required,
			propertyCount: Object.keys(classProps).length,
			additionalProperties: schema.additionalProperties === true,
			persistentId: classPid,
			isStub: false,
		});
		stats.classes++;

		// ---- properties of this class ----
		Object.keys(classProps).forEach((propName) => {
			const propShape = classProps[propName] || {};
			const propPid = propShape['x-srcprop-pid'] || '';
			if (propPid) {
				stats.persistentIdProperties++;
			}
			const cedsGlobalIds = extractCedsIds(propShape.description);
			if (cedsGlobalIds.length > 0) {
				stats.cedsAnnotatedProperties++;
				stats.cedsRefCount += cedsGlobalIds.length;
			}

			const { refs, enums } = collectRefsAndEnums(propShape);

			// REFERENCES (one per $ref branch; polymorphism preserved). Resolve so the forge can mint
			// the target class's clrPath; stub targets become synthesized stub classes.
			refs.forEach((oneRef) => {
				const resolved = resolveRefTarget(oneRef.schemaName);
				references.push({
					className: schemaName,
					propertyName: propName,
					targetSchemaName: oneRef.schemaName,
					targetDisplayName: resolved.schemaName,
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
				className: schemaName,
				classSchemaName: schemaName,
				description: propShape.description || '',
				dataType: inferDataType(propShape),
				format: propShape.format || '',
				pattern: propShape.pattern || '',
				required: required.includes(propName),
				refCount: refs.length,
				isPolymorphic: refs.some((oneRef) => oneRef.polymorphism !== 'single'),
				referencedSchemas: refs.map((oneRef) => oneRef.schemaName),
				persistentId: propPid,
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
						className: schemaName,
						propertyName: propName,
						valueCount: merged.length,
						description: propShape.description || '',
					});
					stats.optionSets++;
					merged.forEach((oneValue) => {
						optionValues.push({
							value: oneValue,
							className: schemaName,
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
			? 'filtered as REST-envelope plumbing'
			: 'not defined in the source';
		classes.push({
			displayName: stubName,
			schemaName: stubName,
			description: `Stub — referenced by $ref from data-model schemas but ${reason}.`,
			requiredFields: [],
			propertyCount: 0,
			additionalProperties: false,
			persistentId: '',
			isStub: true,
		});
		stats.stubClasses++;
	});

	log(
		`[forge-clr/parser] classes=${stats.classes}(+${stats.stubClasses} stub, ${stats.persistentIdClasses} with persistentId), ` +
			`properties=${stats.properties} (${stats.cedsAnnotatedProperties} CEDS-annotated, ${stats.persistentIdProperties} with persistentId), ` +
			`refs=${stats.refEdges} (${stats.polymorphicRefEdges} polymorphic), optionSets=${stats.optionSets}, optionValues=${stats.optionValues}, cedsRefs=${stats.cedsRefCount}`,
	);

	callback('', {
		entities: { classes, properties, optionSets, optionValues, references },
		maps: { keptNameSet },
		metadata: {
			version: info.version || 'unknown',
			schemaTitle: info.title || 'Comprehensive Learner Record',
			openapiVersion: spec.openapi || '',
			publisher: (info.contact && info.contact.name) || 'IMS Global / 1EdTech',
			status: info['x-status'] || '',
			modelPid: info['x-model-pid'] || '',
			sourceFormat: 'openapi-3.0-json',
			sourceFiles: [path.basename(jsonPath)],
			sourceUrl: 'https://www.imsglobal.org/spec/clr/v2p0',
			...stats,
		},
	});
};

module.exports = {
	parseClr,
	extractCedsIds,
	collectRefsAndEnums,
	inferDataType,
	REF_PREFIX,
	CEDS_URL_PATTERN,
};
