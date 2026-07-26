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
//                          duplicate (source,hub,bridge) — two DIFFERENT bridges on one pair are legal.
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
				// bridge is required on EVERY bridge entry, hub or structural. It used to be
				// required only on the structural kind, and build.js quietly supplied
				// 'defaultSemantic' for the hub kind — a bridge nobody chose, named nowhere in
				// -help or in this schema (polyArch2 §6). Naming it is one word in the recipe and
				// it is the whole description of what the bridge DOES. (Was `mapper`; it names a
				// mapping OR a structural producer, so 'mapper' was a misnomer — renamed per
				// design_bridgeResolution_072526 §5.)
				required: ['source', 'dependencies', 'cacheMode', 'bridge'],
				properties: {
					source: { type: 'string', minLength: 1 },
					hub: { type: 'string', minLength: 1 },
					// pairWith — the sibling STANDARD a STRUCTURAL bridge pairs its source with, standing
					// where `hub` stands for a mapping bridge (design_bridgeResolution_072526 §6: "the sibling
					// sub-standard stands where the hub would"). A dedicated field rather than an overloaded
					// `hub` keeps hub-ABSENCE the honest signal of a structural bridge and keeps `hub` meaning
					// exactly "a declared CEDS hub". Layer-2 referential enforces: EITHER a hub (mapping) OR a
					// pairWith (structural), never both and — for a hubless bridge — never neither; a pairWith
					// is a declared standard, distinct from source. Version-keying composes the block on
					// source@ver + pairWith@ver, so BOTH endpoints are version-keyed.
					pairWith: { type: 'string', minLength: 1 },
					// familyStandards — the WHOLE family a STRUCTURAL FAMILY bridge coordinates over in ONE pass,
					// standing where `pairWith` stands for a single structural pair (multi-block change 2026-07-26).
					// One family entry (source = the family root) emits THREE pair-scoped `_struct` blocks — it is
					// NOT three pairWith entries. Layer-2 referential enforces: EXACTLY ONE of hub (mapping) /
					// pairWith (single structural pair) / familyStandards (structural family); every member is a
					// declared standard; the source is a member; at least two DISTINCT members (a pairing needs two).
					familyStandards: {
						type: 'array',
						minItems: 2,
						items: { type: 'string', minLength: 1 },
					},
					bridge: { type: 'string', minLength: 1 },
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
				.map((b) => `${tokenOf(b.source)}->${b.hub ? tokenOf(b.hub) : b.pairWith ? `${tokenOf(b.pairWith)} (structural)` : b.familyStandards ? `[${asArray(b.familyStandards).join(',')}] (family)` : '(structural)'}`)
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

	// The uniqueness key is source::hub::<bridgeName> (design_bridgeResolution_072526 §3a): TWO
	// DIFFERENT bridges on ONE (source,hub) pair are legal — a pair that needs two producers
	// (authored EXACT + inferred CLOSE) is two entries, distinct keys. Only the SAME bridge NAME
	// twice on a pair collides, and it is refused BY NAME. The real duplicate-block guard is
	// downstream and unchanged (the content-addressed subjectRefId refuses two identical blocks);
	// this recipe-level check only catches the obvious typo.
	const seenBridges = new Set();
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

		// SECOND-ENDPOINT SIGNAL — EXACTLY ONE of hub (mapping) / pairWith (single structural pair) /
		// familyStandards (structural family). hub-ABSENCE is what makes a bridge structural (design §6); a
		// structural bridge then pairs a SINGLE sibling (pairWith) OR coordinates the WHOLE family in one pass
		// (familyStandards). Naming more than one is ambiguous (is the block keyed on a hub, a sibling, or a
		// family?); naming none leaves a hubless bridge with no endpoint to pair or version-key against. Each
		// combination is refused BY NAME (polyArch2 §6), never silently resolved.
		const hasHub = b.hub !== undefined;
		const hasPairWith = b.pairWith !== undefined;
		const hasFamily = b.familyStandards !== undefined;
		if (hasHub && hasPairWith) {
			errors.push(
				`referential: bridges[${i}] names BOTH a hub ('${b.hub}') and a pairWith ('${b.pairWith}') — ` +
					`a bridge is EITHER a hub mapping OR a structural pairing, not both`,
			);
		}
		if (hasHub && hasFamily) {
			errors.push(
				`referential: bridges[${i}] names BOTH a hub ('${b.hub}') and familyStandards — a bridge is a ` +
					`hub mapping OR a structural family, not both`,
			);
		}
		if (hasPairWith && hasFamily) {
			errors.push(
				`referential: bridges[${i}] names BOTH a pairWith ('${b.pairWith}') and familyStandards — a ` +
					`structural bridge pairs a SINGLE sibling (pairWith) OR the whole family (familyStandards), not both`,
			);
		}
		if (!hasHub && !hasPairWith && !hasFamily) {
			errors.push(
				`referential: bridges[${i}] is structural (no hub) but names no sibling pairing endpoint — a ` +
					`structural bridge MUST name its sibling standard in pairWith, or the whole family in familyStandards`,
			);
		}
		if (hasPairWith && !stdTokens.has(lc(b.pairWith))) {
			errors.push(`referential: bridges[${i}].pairWith '${b.pairWith}' is not in standards[]`);
		}
		if (hasPairWith && b.source !== undefined && lc(b.pairWith) === lc(b.source)) {
			errors.push(
				`referential: bridges[${i}].pairWith '${b.pairWith}' is the same as source — a structural ` +
					`pairing needs two DISTINCT standards`,
			);
		}
		// FAMILY membership — every member is a declared standard; the source (family root) is a member; and a
		// family needs at least two DISTINCT members to author a pairing. Each is refused BY NAME.
		if (hasFamily) {
			const familyLc = asArray(b.familyStandards).map(lc);
			asArray(b.familyStandards).forEach((oneMember) => {
				if (!stdTokens.has(lc(oneMember))) {
					errors.push(`referential: bridges[${i}].familyStandards '${oneMember}' is not in standards[]`);
				}
			});
			if (new Set(familyLc).size < 2) {
				errors.push(
					`referential: bridges[${i}].familyStandards has fewer than two DISTINCT standards — a family ` +
						`needs at least two to author a pairing`,
				);
			}
			if (b.source !== undefined && !familyLc.includes(lc(b.source))) {
				errors.push(
					`referential: bridges[${i}].familyStandards does not include the source '${b.source}' — the ` +
						`family root must be a member of its own family`,
				);
			}
		}

		// The uniqueness key is source::<secondEndpoint>::<bridgeName>, where the second endpoint is the hub
		// (mapping) or the pairWith sibling (structural). This is what lets the CTDL family's TWO structural
		// entries with the SAME source 'ctdl' — ctdl::ctdlasn and ctdl::ctdlqdata — be DISTINCT rather than
		// collide as "the same structural bridge twice". Only the SAME bridge NAME on the SAME pair collides,
		// refused BY NAME.
		const secondEndpoint =
			b.hub !== undefined
				? lc(b.hub)
				: b.pairWith !== undefined
					? lc(b.pairWith)
					: b.familyStandards !== undefined
						? 'family'
						: '(structural)';
		const pairing = `${lc(b.source)}::${secondEndpoint}`;
		const key = `${pairing}::${lc(b.bridge)}`;
		if (seenBridges.has(key)) {
			errors.push(`referential: duplicate bridge '${b.bridge}' for pairing '${pairing}'`);
		}
		seenBridges.add(key);
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
