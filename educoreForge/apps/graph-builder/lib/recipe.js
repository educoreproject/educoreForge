'use strict';

// recipe.js — graphBuilder's recipe layer: LOAD (JSONC), SUMMARIZE (comprehension),
// and VALIDATE. Validation is layered:
//   Layer 1 STRUCTURAL   — JSON Schema (ajv). STRICT to the NEW format (additionalProperties
//                          false; version-pinned object standards; hubs/bridges as designed).
//                          The incumbent golden format is DELIBERATELY rejected — it is a legacy
//                          artifact, not a new-format build recipe.
//   Layer 2 CONTENT      — semantic checks, run only when options.contentValidation is true:
//     2a REFERENTIAL     — recipe-internal integrity: hub.standard ∈ standards; bridge.source ∈
//                          standards; bridge.hub ∈ declared hubs; dependencies ∈ standards; no
//                          duplicate (source,hub) pairing.
//     2b RESOLVABILITY   — environment: each standard token has an available forge (options
//                          .availableForges). Correctly flags un-ported forges until they land.

const fs = require('fs');
const JSON5 = require('json5');
const Ajv = require('ajv');

// =====================================================================
// LAYER 1 — strict NEW-format structural schema
// =====================================================================

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
const RECIPE_SCHEMA = {
	$id: 'educoreForge/recipe/v1',
	type: 'object',
	additionalProperties: false,
	required: ['schemaVersion', 'recipeName', 'standards'],
	properties: {
		$schema: { type: 'string' },
		schemaVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
		recipeName: { type: 'string', minLength: 1 },
		kind: { type: 'string', enum: ['golden', 'dev', 'subset'] },
		description: { type: 'string' },
		standards: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['token', 'version'],
				properties: {
					token: { type: 'string', minLength: 1 },
					version: { type: 'string', minLength: 1 },
					snapshot: { type: 'string' },
					source: { type: 'string' },
				},
			},
		},
		hubs: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['standard', 'candidateFinder'],
				properties: {
					standard: { type: 'string', minLength: 1 },
					candidateFinder: { type: 'string', minLength: 1 },
					adjudicatorProfile: { type: 'string' },
					params: { type: 'object' },
				},
			},
		},
		bridges: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				// mapper is required on EVERY bridge, hub or structural. It used to be required
				// only on the structural kind, and build.js quietly supplied 'defaultSemantic' for
				// the hub kind — a mapper nobody chose, named nowhere in -help or in this schema
				// (polyArch2 §6). Naming it is one word in the recipe and it is the whole
				// description of what the bridge DOES.
				required: ['source', 'dependencies', 'cacheMode', 'mapper'],
				properties: {
					source: { type: 'string', minLength: 1 },
					hub: { type: 'string', minLength: 1 },
					mapper: { type: 'string', minLength: 1 },
					extractor: { type: 'string', minLength: 1 },
					dependencies: {
						type: 'array',
						minItems: 1,
						items: { type: 'string', minLength: 1 },
					},
					cacheMode: { type: 'string', enum: ['reuse', 'fresh', 'pin'] },
					pinBlockId: { type: 'string', minLength: 1 },
					params: { type: 'object' },
				},
				allOf: [
					{
						if: { properties: { cacheMode: { const: 'pin' } }, required: ['cacheMode'] },
						then: { required: ['pinBlockId'] },
					},
				],
			},
		},
		output: {
			type: 'object',
			additionalProperties: false,
			properties: { graphName: { type: 'string' } },
		},
	},
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validateStructural = ajv.compile(RECIPE_SCHEMA);

// =====================================================================
// LOAD
// =====================================================================

const loadRecipe = (recipePath) => {
	if (!recipePath) {
		return { error: 'no recipe path given' };
	}
	if (!fs.existsSync(recipePath)) {
		return { error: `recipe file not found: ${recipePath}` };
	}
	let text;
	try {
		text = fs.readFileSync(recipePath, 'utf8');
	} catch (readError) {
		return { error: `cannot read recipe: ${readError.message}` };
	}
	let recipe;
	try {
		recipe = JSON5.parse(text); // tolerates // and /* */ comments + trailing commas
	} catch (parseError) {
		return { error: `recipe is not parseable JSON/JSONC: ${parseError.message}` };
	}
	if (recipe === null || typeof recipe !== 'object' || Array.isArray(recipe)) {
		return { error: 'recipe must be a JSON object' };
	}
	return { recipe };
};

// =====================================================================
// SUMMARIZE (comprehension) — must NEVER crash on malformed input
// =====================================================================

const asArray = (value) => (Array.isArray(value) ? value : []);

const tokenOf = (entry) => {
	if (typeof entry === 'string') {
		return entry;
	}
	if (entry && typeof entry === 'object') {
		return entry.token || entry.standard || entry.name || JSON.stringify(entry);
	}
	return String(entry);
};

const versionOf = (entry) =>
	entry && typeof entry === 'object' && entry.version ? `@${entry.version}` : '';

const summarizeRecipe = (recipe) => {
	const name = recipe.recipeName || recipe.goldenName || '(unnamed)';
	const kind = recipe.kind || recipe.recipeKind || '(unspecified)';
	const standards = asArray(recipe.standards);
	const crosswalks = asArray(recipe.crosswalks);
	const references = asArray(recipe.references);
	const hubs = asArray(recipe.hubs);
	const bridges = asArray(recipe.bridges);

	const lines = [];
	lines.push('recipe understood:');
	lines.push(`  name:        ${name}`);
	lines.push(`  kind:        ${kind}`);
	if (recipe.schemaVersion) {
		lines.push(`  schemaVer:   ${recipe.schemaVersion}`);
	}
	lines.push(
		`  standards:   ${standards.length}  [${standards
			.map((s) => `${tokenOf(s)}${versionOf(s)}`)
			.join(', ')}]`,
	);
	if (crosswalks.length) {
		lines.push(`  crosswalks:  ${crosswalks.length}  [${crosswalks.join(', ')}]`);
	}
	if (references.length) {
		lines.push(
			`  references:  ${references.length}  [${references
				.map((r) => tokenOf(r && r.standard !== undefined ? r.standard : r))
				.join(', ')}]`,
		);
	}
	if (hubs.length) {
		lines.push(
			`  hubs:        ${hubs.length}  [${hubs
				.map((h) => tokenOf(h && h.standard !== undefined ? h.standard : h))
				.join(', ')}]`,
		);
	}
	if (bridges.length) {
		lines.push(
			`  bridges:     ${bridges.length}  [${bridges
				.map((b) => `${tokenOf(b.source)}->${b.hub ? tokenOf(b.hub) : '(structural)'}`)
				.join(', ')}]`,
		);
	}
	const known = new Set([
		'$schema', 'schemaVersion', 'recipeName', 'goldenName', 'kind', 'recipeKind',
		'description', 'notes', 'standards', 'crosswalks', 'references', 'hubs', 'bridges', 'output',
	]);
	const others = Object.keys(recipe).filter((k) => !known.has(k));
	if (others.length) {
		lines.push(`  (other sections present, not summarized: ${others.join(', ')})`);
	}
	return lines.join('\n');
};

// =====================================================================
// LAYER 2 — content
// =====================================================================

const lc = (value) => String(value == null ? '' : value).toLowerCase();

// 2a — recipe-internal referential integrity
const referentialErrors = (recipe) => {
	const errors = [];
	const standards = asArray(recipe.standards);
	const hubs = asArray(recipe.hubs);
	const bridges = asArray(recipe.bridges);

	const stdTokens = new Set(standards.map((s) => lc(s.token !== undefined ? s.token : tokenOf(s))));
	const hubStdSet = new Set(hubs.map((h) => lc(h.standard)));

	hubs.forEach((h, i) => {
		if (h.standard && !stdTokens.has(lc(h.standard))) {
			errors.push(`referential: hubs[${i}].standard '${h.standard}' is not in standards[]`);
		}
	});

	const seenPairs = new Set();
	bridges.forEach((b, i) => {
		if (b.source && !stdTokens.has(lc(b.source))) {
			errors.push(`referential: bridges[${i}].source '${b.source}' is not in standards[]`);
		}
		if (b.hub !== undefined && !hubStdSet.has(lc(b.hub))) {
			errors.push(`referential: bridges[${i}].hub '${b.hub}' is not a declared hub`);
		}
		asArray(b.dependencies).forEach((d) => {
			if (!stdTokens.has(lc(d))) {
				errors.push(`referential: bridges[${i}].dependencies '${d}' is not in standards[]`);
			}
		});
		const key = `${lc(b.source)}::${b.hub !== undefined ? lc(b.hub) : '(structural)'}`;
		if (seenPairs.has(key)) {
			errors.push(`referential: duplicate bridge pairing '${key}'`);
		}
		seenPairs.add(key);
	});
	return errors;
};

// 2b — resolvability against the environment (which forges are actually present)
const resolvabilityErrors = (recipe, availableForges) => {
	const errors = [];
	const available = new Set(asArray(availableForges).map(lc));
	asArray(recipe.standards).forEach((s) => {
		const token = s.token !== undefined ? s.token : tokenOf(s);
		if (!available.has(lc(token))) {
			errors.push(
				`resolvability: no forge available for standard '${token}' (forges/<STD>/forge.js not found)`,
			);
		}
	});
	return errors;
};

// =====================================================================
// VALIDATE
// =====================================================================

// validateRecipe(recipe, { contentValidation, availableForges }) -> { valid, errors, layers }
const validateRecipe = (recipe, options = {}) => {
	const contentValidation = !!options.contentValidation;
	const availableForges = options.availableForges || [];

	// Layer 1 — structural (always)
	const structuralOk = validateStructural(recipe);
	const structuralErrs = structuralOk
		? []
		: (validateStructural.errors || []).map(
				(e) => `structural: ${e.instancePath || '(root)'} ${e.message}`,
		  );

	// Layer 2 — content (only when requested)
	const refErrs = contentValidation ? referentialErrors(recipe) : [];
	const resErrs = contentValidation ? resolvabilityErrors(recipe, availableForges) : [];

	const errors = [...structuralErrs, ...refErrs, ...resErrs];
	return {
		valid: errors.length === 0,
		errors,
		layers: {
			structural: { ran: true, ok: structuralErrs.length === 0, errors: structuralErrs },
			referential: {
				ran: contentValidation,
				ok: refErrs.length === 0,
				errors: refErrs,
			},
			resolvability: {
				ran: contentValidation,
				ok: resErrs.length === 0,
				errors: resErrs,
			},
		},
	};
};

return { loadRecipe, summarizeRecipe, validateRecipe };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
