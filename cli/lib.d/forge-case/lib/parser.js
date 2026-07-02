'use strict';

// parser.js — CASE (Competencies and Academic Standards Exchange) OpenAPI 3.0 YAML schema reader.
//
// HARVESTED+ADAPTED from trackA forge-case/lib/parser.js: the OpenAPI YAML extraction logic is
// proven and kept in substance — the components.schemas walk, the DType-suffix display-name
// convention, the extension-point detection (CF*ExtensionDType), the $ref / anyOf / oneOf / allOf
// polymorphism collection (collectRefsAndEnums), enum -> optionSet/optionValue, the 1EdTech privacy
// annotations (x-1edtech-confidentiality / x-1edtech-privacy), the CEDS-element-URL harvest
// (extractCedsIds over description), the IMS status-envelope plumbing filter, and the stub-class
// synthesis for unresolved $ref targets. ADAPTED AWAY: trackA's node-shaping (it built private
// Case* nodes — CaseRoot/CaseClass/CaseProperty/CaseOptionSet/CaseOptionValue — with HAS_CLASS/
// HAS_PROPERTY/_parentEdge plumbing and a hand-rolled `|`-joined searchText, and used the
// graphForge parser contract (sourcePath, options, callback) -> {nodes, metadata}). THIS parser
// instead returns ONLY raw intermediate collections + the resolution maps + metadata; shaping into
// the universal property contract (the six Dme* roles, canonical ownership edges, searchText via
// the ONE shared builder, crossRefs, canonical cedsId, stableId/casePath) happens in forgeCase.js.
// The parser NEVER touches Neo4j, embeddings, or the contract.
//
// CASE is the first forge to parse YAML — requires js-yaml (carried in this bundle's node_modules).
//
// Async style: a single callback (err, { entities, maps, metadata }); fs/yaml.load is the only
// boundary and resolves immediately. No async/await, no try/catch-for-control-flow except the
// localized YAML parse boundary. camelCase only.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ============================================================
// Configuration (harvested from trackA)
// ============================================================

// Three Imsx_* plumbing schemas (the IMS status-envelope) carry no data-model meaning.
const PLUMBING_SCHEMAS = new Set([
	'imsx_StatusInfoDType',
	'imsx_CodeMinorDType',
	'imsx_CodeMinorFieldDType',
]);

const REF_PREFIX = '#/components/schemas/';
const DTYPE_SUFFIX = 'DType';
const EXTENSION_SUFFIX = 'ExtensionDType';
const CEDS_URL_PATTERN = /ceds\.ed\.gov\/element\/(\d+)/g;

// ============================================================
// Helpers (harvested verbatim-in-substance from trackA)
// ============================================================

// stripDType — every CASE schema name ends in 'DType' (IMS "DataType"). Strip for display; the
//   raw schema name is retained separately as schemaName.
const stripDType = (schemaName) => {
	if (typeof schemaName !== 'string') {
		return schemaName;
	}
	return schemaName.endsWith(DTYPE_SUFFIX)
		? schemaName.slice(0, -DTYPE_SUFFIX.length)
		: schemaName;
};

const isExtensionPointName = (schemaName) =>
	typeof schemaName === 'string' && schemaName.endsWith(EXTENSION_SUFFIX);

// extractCedsIds — harvest the bare CEDS element ids from prose (description) at any depth. These
//   are CASE's native cross-reference to CEDS.
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

const joinPrivacy = (rawValue) =>
	Array.isArray(rawValue) ? rawValue.join(',') : rawValue || '';

// ============================================================
// Main reader — callback(err, { entities, maps, metadata })
// ============================================================

const parseCase = ({ sourcePath, xLog }, callback) => {
	const log = (xLog && xLog.status) || (() => {});

	if (!fs.existsSync(sourcePath)) {
		callback(`CASE OpenAPI YAML source not found: ${sourcePath}`);
		return;
	}

	// Accept either a directory (find first .yaml/.yml/.yaml.txt file) or a direct file path.
	let yamlPath = sourcePath;
	if (fs.statSync(sourcePath).isDirectory()) {
		// L15: sorted for cross-machine determinism; EXACTLY ONE candidate required — a stray
		// second source file would silently forge a different standard on another machine.
		const candidates = fs
			.readdirSync(sourcePath)
			.filter((name) => /\.(yaml|yml)(\.txt)?$/i.test(name))
			.sort();
		if (!candidates.length) {
			callback(`No .yaml / .yml / .yaml.txt source file in ${sourcePath}`);
			return;
		}
		if (candidates.length > 1) {
			callback(
				`${candidates.length} candidate source files in ${sourcePath} (${candidates.join(', ')}) — expected exactly one; remove the extras.`,
			);
			return;
		}
		yamlPath = path.join(sourcePath, candidates[0]);
	}

	let spec;
	let parseError = '';
	try {
		spec = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
	} catch (err) {
		parseError = err.message;
	}
	if (parseError) {
		callback(`Failed to read/parse CASE YAML: ${parseError}`);
		return;
	}

	log(
		`[forge-case/parser] parsing OpenAPI YAML (${(fs.statSync(yamlPath).size / 1024).toFixed(0)} KB)...`,
	);

	const schemas = (spec.components && spec.components.schemas) || {};
	const info = spec.info || {};
	const allNames = Object.keys(schemas);
	const keptNames = allNames.filter((name) => !PLUMBING_SCHEMAS.has(name));
	const filteredCount = allNames.length - keptNames.length;
	log(
		`[forge-case/parser] kept schemas: ${keptNames.length} (filtered plumbing: ${filteredCount})`,
	);

	const keptNameSet = new Set(keptNames);

	// resolveRefTarget — a $ref schemaName -> { kind:'class'|'stub', schemaName, displayName }.
	//   A target present in the kept schemas is a real class; otherwise (plumbing or undefined) a
	//   stub. The forge mints the same casePath for both from the stripped display name, so a
	//   REFERENCES edge always resolves to a real node stableId.
	const resolveRefTarget = (schemaName) => {
		const displayName = stripDType(schemaName);
		if (keptNameSet.has(schemaName)) {
			return { kind: 'class', schemaName, displayName };
		}
		return { kind: 'stub', schemaName, displayName };
	};

	// ------------------------------------------------------------
	// Raw intermediate collections (NO node shaping here — that is forgeCase.js's job)
	// ------------------------------------------------------------
	const classes = []; // real CASE classes (one per kept schema)
	const properties = []; // class properties (flat + $ref + polymorphic)
	const optionSets = []; // enum containers
	const optionValues = []; // enum members
	const references = []; // property -> target-class REFERENCES (with polymorphism)
	const stubNames = new Set(); // $ref targets resolving to neither a kept class

	const stats = {
		classes: 0,
		extensionPoints: 0,
		stubClasses: 0,
		properties: 0,
		refEdges: 0,
		polymorphicRefEdges: 0,
		optionSets: 0,
		optionValues: 0,
		privacyAnnotatedClasses: 0,
		privacyAnnotatedProperties: 0,
		cedsAnnotatedProperties: 0,
		cedsRefCount: 0,
	};

	// ---- real classes (one per kept schema) ----
	keptNames.forEach((schemaName) => {
		const schema = schemas[schemaName] || {};
		const displayName = stripDType(schemaName);
		const required = Array.isArray(schema.required) ? schema.required : [];
		const classProps = schema.properties || {};
		const isExtPoint = isExtensionPointName(schemaName);
		if (isExtPoint) {
			stats.extensionPoints++;
		}
		const confidentiality = joinPrivacy(schema['x-1edtech-confidentiality']);
		const privacy = joinPrivacy(schema['x-1edtech-privacy']);
		const confidentialityNormal = joinPrivacy(schema['x-1edtech-confidentiality-normal']);
		if (confidentiality || privacy || confidentialityNormal) {
			stats.privacyAnnotatedClasses++;
		}

		classes.push({
			displayName,
			schemaName,
			description: schema.description || '',
			requiredFields: required,
			propertyCount: Object.keys(classProps).length,
			additionalProperties: schema.additionalProperties === true,
			isExtensionPoint: isExtPoint,
			isStub: false,
			confidentiality,
			privacy,
			confidentialityNormal,
		});
		stats.classes++;

		// ---- properties of this class ----
		Object.keys(classProps).forEach((propName) => {
			const propShape = classProps[propName] || {};
			const confidentialityProp = joinPrivacy(propShape['x-1edtech-confidentiality']);
			const privacyProp = joinPrivacy(propShape['x-1edtech-privacy']);
			if (confidentialityProp || privacyProp) {
				stats.privacyAnnotatedProperties++;
			}
			const cedsGlobalIds = extractCedsIds(propShape.description);
			if (cedsGlobalIds.length > 0) {
				stats.cedsAnnotatedProperties++;
				stats.cedsRefCount += cedsGlobalIds.length;
			}

			const { refs, enums } = collectRefsAndEnums(propShape);

			// REFERENCES (one per $ref branch; polymorphism preserved). Resolve the target so the
			// forge can mint the target class's casePath; stub targets become synthesized stub classes.
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
				required: required.includes(propName),
				refCount: refs.length,
				isPolymorphic: refs.some((oneRef) => oneRef.polymorphism !== 'single'),
				referencedSchemas: refs.map((oneRef) => oneRef.schemaName),
				confidentiality: confidentialityProp,
				privacy: privacyProp,
				isExtensionPoint: isExtPoint,
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
		const displayName = stripDType(stubName);
		const reason = PLUMBING_SCHEMAS.has(stubName)
			? 'filtered as IMS status-envelope plumbing'
			: 'not defined in the source';
		classes.push({
			displayName,
			schemaName: stubName,
			description: `Stub — referenced by $ref from data-model schemas but ${reason}.`,
			requiredFields: [],
			propertyCount: 0,
			additionalProperties: false,
			isExtensionPoint: false,
			isStub: true,
			confidentiality: '',
			privacy: '',
			confidentialityNormal: '',
		});
		stats.stubClasses++;
	});

	log(
		`[forge-case/parser] classes=${stats.classes}(+${stats.stubClasses} stub, ${stats.extensionPoints} extension points), ` +
			`properties=${stats.properties} (${stats.cedsAnnotatedProperties} CEDS-annotated, ${stats.privacyAnnotatedProperties} privacy-annotated), ` +
			`refs=${stats.refEdges} (${stats.polymorphicRefEdges} polymorphic), optionSets=${stats.optionSets}, optionValues=${stats.optionValues}, cedsRefs=${stats.cedsRefCount}`,
	);

	callback('', {
		entities: { classes, properties, optionSets, optionValues, references },
		maps: { keptNameSet },
		metadata: {
			version: info.version || 'unknown',
			schemaTitle: info.title || 'Competencies and Academic Standards Exchange',
			openapiVersion: spec.openapi || '',
			publisher: 'IMS Global / 1EdTech',
			sourceFormat: 'openapi-3.0-yaml',
			sourceFiles: [path.basename(yamlPath)],
			sourceUrl: 'https://www.1edtech.org/case',
			...stats,
		},
	});
};

module.exports = {
	parseCase,
	extractCedsIds,
	stripDType,
	isExtensionPointName,
	collectRefsAndEnums,
	inferDataType,
	REF_PREFIX,
	CEDS_URL_PATTERN,
};
