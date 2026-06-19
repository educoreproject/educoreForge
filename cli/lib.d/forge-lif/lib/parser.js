'use strict';

// parser.js — LIF (Learner Information Framework) OpenAPI 3.0 schema reader.
//
// HARVESTED+ADAPTED from trackA forge-lif/lib/parser.js: the OpenAPI extraction logic is proven and
// kept in substance — the components.schemas walk, the three structural patterns (flat property,
// Ref property matching /Ref[A-Z]/, composite = array-with-.properties up to 3 deep), the
// composite-index pre-scan for Ref resolution, enum -> optionSet/optionValue, junk-entity filter,
// and the CEDS-element-URL harvest (extractCedsIds over description / use_recommendations at any
// depth — `cedsGlobalIds`). ADAPTED AWAY: trackA's node-shaping (it built private Lif* nodes with
// HAS_ENTITY/HAS_PROPERTY/_parentEdge and a hand-rolled `|`-joined searchText, and used the
// graphForge parser contract (sourcePath, options, callback) -> {nodes, metadata}). THIS parser
// instead returns ONLY raw intermediate entities + the resolution maps + metadata; shaping into the
// universal property contract (the six Dme* roles, canonical ownership edges, searchText via the ONE
// shared builder, crossRefs, canonical cedsId, stableId/lifPath) happens in forgeLif.js. The parser
// NEVER touches Neo4j, embeddings, or the contract.
//
// Async style: a single callback (err, { entities, maps, metadata }); fs/JSON.parse is the only
// boundary and resolves immediately. No async/await, no try/catch-for-control-flow except the
// localized JSON parse boundary. camelCase only.

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration (harvested from trackA)
// ============================================================

const JUNK_ENTITIES = new Set(['TammieEntity', 'Frank Test Entity']);
const REF_PROPERTY_PATTERN = /Ref([A-Z]\w*)$/;
const CEDS_URL_PATTERN = /ceds\.ed\.gov\/element\/(\d+)/g;

// ============================================================
// Helpers (harvested verbatim-in-substance from trackA)
// ============================================================

// extractCedsIds — harvest the bare CEDS element ids from any prose (description /
// use_recommendations) at any depth. These are LIF's native cross-reference to CEDS.
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

const getRefTargetName = (propertyName) => {
	const match = propertyName.match(REF_PROPERTY_PATTERN);
	return match ? match[1] : null;
};

const isComposite = (prop) =>
	prop && prop.type === 'array' && prop.properties && Object.keys(prop.properties).length > 0;

const isRefObject = (propertyName, prop) =>
	prop && prop.type === 'object' && getRefTargetName(propertyName) !== null;

// ============================================================
// Main reader — callback(err, { entities, maps, metadata })
// ============================================================

const parseLif = ({ sourcePath, xLog }, callback) => {
	const log = (xLog && xLog.status) || (() => {});

	if (!fs.existsSync(sourcePath)) {
		callback(`LIF OpenAPI source not found: ${sourcePath}`);
		return;
	}

	let filePath = sourcePath;
	if (fs.statSync(sourcePath).isDirectory()) {
		const candidates = fs.readdirSync(sourcePath).filter((n) => n.endsWith('.json'));
		if (!candidates.length) {
			callback(`No .json source file in ${sourcePath}`);
			return;
		}
		filePath = path.join(sourcePath, candidates[0]);
	}

	let spec;
	let parseError = '';
	try {
		spec = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (err) {
		parseError = err.message;
	}
	if (parseError) {
		callback(`Failed to read/parse LIF JSON: ${parseError}`);
		return;
	}

	log(`[forge-lif/parser] parsing OpenAPI schema (${(fs.statSync(filePath).size / 1024).toFixed(0)} KB)...`);

	const schemas = (spec.components && spec.components.schemas) || {};
	const info = spec.info || {};
	const allNames = Object.keys(schemas);
	const entityNames = allNames.filter((n) => !JUNK_ENTITIES.has(n));
	const filteredCount = allNames.length - entityNames.length;
	log(`[forge-lif/parser] real entities: ${entityNames.length} (filtered junk: ${filteredCount})`);

	// ------------------------------------------------------------
	// Pre-scan: composite-name -> compositeKey index (for Ref resolution). A composite name may
	// appear under multiple entities; Refs in practice target one location, so first match wins.
	// compositeKey is the dotted intra-entity path (entity + '.' + composite path) — the same shape
	// forgeLif.js uses to mint the composite's lifPath, so a Ref resolves to a real stableId.
	// ------------------------------------------------------------
	const compositeIndex = {}; // compositeName -> [{ entityName, compositePath }]

	const prescanProperty = (propName, prop, entityName, parentPath) => {
		if (isComposite(prop)) {
			const compositePath = parentPath ? `${parentPath}.${propName}` : propName;
			if (!compositeIndex[propName]) {
				compositeIndex[propName] = [];
			}
			compositeIndex[propName].push({ entityName, compositePath });
			Object.keys(prop.properties).forEach((subName) => {
				prescanProperty(subName, prop.properties[subName], entityName, compositePath);
			});
		}
	};
	entityNames.forEach((entityName) => {
		const props = (schemas[entityName] || {}).properties || {};
		Object.keys(props).forEach((propName) => {
			prescanProperty(propName, props[propName], entityName, '');
		});
	});

	const entityNameSet = new Set(entityNames);

	// resolveRefTarget — Ref target -> { kind:'entity'|'composite'|'stub', entityName, fullPath }.
	//   The forge turns this into a REFERENCES edge against the target's lifPath.
	const resolveRefTarget = (targetName) => {
		if (entityNameSet.has(targetName)) {
			return { kind: 'entity', entityName: targetName, fullPath: '' };
		}
		const hits = compositeIndex[targetName];
		if (hits && hits.length > 0) {
			return { kind: 'composite', entityName: hits[0].entityName, fullPath: hits[0].compositePath };
		}
		return { kind: 'stub', entityName: targetName, fullPath: '' };
	};

	// ------------------------------------------------------------
	// Raw intermediate entity collections (NO node shaping here — that is forgeLif.js's job)
	// ------------------------------------------------------------
	const entities = []; // real LIF entities
	const composites = []; // composite array-of-object containers
	const properties = []; // flat + ref leaf properties
	const optionSets = []; // enum containers
	const optionValues = []; // enum members
	const stubNames = new Set(); // Ref targets resolving to neither entity nor composite

	const stats = {
		entities: 0,
		stubEntities: 0,
		composites: 0,
		properties: 0,
		topLevelProperties: 0,
		nestedProperties: 0,
		refProperties: 0,
		optionSets: 0,
		optionValues: 0,
		cedsAnnotatedProperties: 0,
		cedsRefCount: 0,
	};

	// recursive property processor. context: { entityName, parentPath, parentKind, parentRequired }
	const processProperty = (propName, prop, context) => {
		const fullPath = context.parentPath ? `${context.parentPath}.${propName}` : propName;

		// -------- Composite branch --------
		if (isComposite(prop)) {
			const subProps = prop.properties || {};
			const subRequired = Array.isArray(prop.required) ? prop.required : [];
			composites.push({
				name: propName,
				entityName: context.entityName,
				parentPath: context.parentPath,
				fullPath,
				parentKind: context.parentKind,
				description: prop.use_recommendations || '',
				requiredFields: subRequired,
				subPropertyCount: Object.keys(subProps).length,
				pathDepth: fullPath.split('.').length - 1,
			});
			stats.composites++;
			Object.keys(subProps).forEach((subName) => {
				processProperty(subName, subProps[subName], {
					entityName: context.entityName,
					parentPath: fullPath,
					parentKind: 'composite',
					parentRequired: subRequired,
				});
			});
			return;
		}

		// -------- Flat or Ref property branch --------
		const refTargetName = getRefTargetName(propName);
		const isRef = isRefObject(propName, prop);
		const cedsGlobalIds = extractCedsIds(prop.description, prop.use_recommendations);
		if (cedsGlobalIds.length > 0) {
			stats.cedsAnnotatedProperties++;
			stats.cedsRefCount += cedsGlobalIds.length;
		}

		let refResolution = null;
		if (isRef) {
			refResolution = resolveRefTarget(refTargetName);
			if (refResolution.kind === 'stub') {
				stubNames.add(refTargetName);
			}
			stats.refProperties++;
		}

		const pathDepth = fullPath.split('.').length - 1;
		if (pathDepth === 0) {
			stats.topLevelProperties++;
		} else {
			stats.nestedProperties++;
		}

		properties.push({
			name: propName,
			entityName: context.entityName,
			parentPath: context.parentPath,
			parentKind: context.parentKind,
			fullPath,
			pathDepth,
			description: prop.description || '',
			useRecommendations: prop.use_recommendations || '',
			dataType: prop.type || '',
			format: prop.format || '',
			example: typeof prop.example === 'string' ? prop.example : '',
			required:
				Array.isArray(context.parentRequired) && context.parentRequired.includes(propName),
			isRef,
			refTargetName: refTargetName || '',
			refResolution, // { kind, entityName, fullPath } | null
			cedsGlobalIds, // RAW native CEDS element ids harvested from prose
			hasEnum: Array.isArray(prop.enum) && prop.enum.length > 0,
		});
		stats.properties++;

		// -------- Option set from enum (only on flat properties) --------
		if (Array.isArray(prop.enum) && prop.enum.length > 0) {
			optionSets.push({
				entityName: context.entityName,
				propertyPath: fullPath,
				propertyName: propName,
				valueCount: prop.enum.length,
				description: prop.description || '',
				enumPreview: prop.enum.map(String).join(' '),
			});
			stats.optionSets++;
			prop.enum.forEach((val) => {
				optionValues.push({
					value: String(val),
					entityName: context.entityName,
					propertyPath: fullPath,
					propertyName: propName,
				});
				stats.optionValues++;
			});
		}
	};

	// ---- real entities ----
	entityNames.forEach((entityName) => {
		const entity = schemas[entityName] || {};
		const required = Array.isArray(entity.required) ? entity.required : [];
		const entityProps = entity.properties || {};
		entities.push({
			name: entityName,
			description: entity.use_recommendations || '',
			requiredFields: required,
			propertyCount: Object.keys(entityProps).length,
			isStub: false,
		});
		stats.entities++;
		Object.keys(entityProps).forEach((propName) => {
			processProperty(propName, entityProps[propName], {
				entityName,
				parentPath: '',
				parentKind: 'entity',
				parentRequired: required,
			});
		});
	});

	// ---- stub entities (Refs unresolved to entity or composite) ----
	[...stubNames].forEach((stubName) => {
		if (entityNameSet.has(stubName)) {
			return; // resolved after all — defensive
		}
		entities.push({
			name: stubName,
			description:
				'Stub — referenced by Ref properties but not defined as a schema or composite in the LIF OpenAPI source.',
			requiredFields: [],
			propertyCount: 0,
			isStub: true,
		});
		stats.stubEntities++;
	});

	log(
		`[forge-lif/parser] entities=${stats.entities}(+${stats.stubEntities} stub), composites=${stats.composites}, properties=${stats.properties} (${stats.refProperties} Ref, ${stats.cedsAnnotatedProperties} CEDS-annotated), optionSets=${stats.optionSets}, optionValues=${stats.optionValues}, cedsRefs=${stats.cedsRefCount}`,
	);

	callback('', {
		entities: { entities, composites, properties, optionSets, optionValues },
		maps: { compositeIndex, entityNameSet },
		metadata: {
			version: info.version || 'unknown',
			schemaTitle: info.title || 'Learner Information Framework',
			openapiVersion: spec.openapi || '',
			sourceFormat: 'openapi-3.0-json',
			sourceFiles: [path.basename(filePath)],
			sourceUrl: 'https://www.imsglobal.org/lis/index.html',
			...stats,
		},
	});
};

module.exports = {
	parseLif,
	extractCedsIds,
	getRefTargetName,
	isComposite,
	isRefObject,
	REF_PROPERTY_PATTERN,
	CEDS_URL_PATTERN,
};
