'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// score-match.js — PURE multi-signal reranker scoring for -implied Stage-2 (Phase II). Harvested and
// adapted from trackA (crosswalk-engine: elementMatcher / pathMatcher / neighborhoodMatcher /
// scorer). Three signal layers (element .30 / path .20 / neighborhood .50) over EIGHT sub-signals;
// confidence = Σ wᵢ·sᵢ (weights sum to 1.0, so it is a convex combination in [0,1]).
//
// GENERIC over the universal property contract (DECISIONS §7) — it reads name / description-via-
// embedding / dataType / path / depth / parentId-derived neighborhood bundles, NOT XML-specific
// xpath/xsdType. Signals a standard lacks degrade to a NEUTRAL 0.5 (datatype UNKNOWN, absent
// parent/sibling/child), exactly as trackA does; name & embedding absence are a real 0 penalty (not
// neutralized). No per-standard branches. Weights arrive as DATA (rerank-config.json).
//
// No I/O, no qtools, no neo4j — deterministic functions. Neighborhood BUNDLES are pre-loaded by
// neighborhood-loader.js and passed in. camelCase only.
//
// PHASE-II FINDINGS (logged per OBSIDIAN_FLAME, independently verified against golden 2026-06-20):
//   1. descriptionEmbed currently == the searchText RETRIEVAL cosine — there is ONE embedding per
//      node (voyage on searchText), so the .15 descriptionEmbed weight RE-APPLIES the retrieval
//      cosine rather than contributing an independent definition-semantic signal. Real v0 limitation.
//      The future lever is a SEPARATE definition/SKOS embedding (forge-layer re-embed) — deferred.
//   2. EXPERT-SEMANTIC mappings are a surface-signal CEILING. Example: LIF Credential.level ('level')
//      -> CEDS P001301 'Has Course Applicable Education Level' is genuinely cosine-WEAKER than the
//      surface decoy P002082 'Has Low Grade Level' (shares the generic token 'level', wrong mapping).
//      The scorer correctly DECLINES to manufacture evidence absent from the data (SPEC §8 substrate
//      ceiling, not a defect). Such pairs are handled HONESTLY downstream via low calibrated
//      confidence + the human-review band / fan-out floor — NEVER by forcing rank or tuning weights
//      to the handful of anchors.

const { tokenize, jaccard, cosine } = require('./text-similarity');

// ---- datatype family classification (element layer) ----
const DATATYPE_FAMILY = (raw) => {
	if (!raw || typeof raw !== 'string') {
		return 'UNKNOWN';
	}
	const t = raw.toLowerCase();
	if (t.includes('boolean') || t === 'xs:boolean') {
		return 'BOOLEAN';
	}
	if (t.includes('datetime') || t.includes('timestamp')) {
		return 'DATETIME';
	}
	if (t === 'xs:date' || t === 'xsd:date' || t.endsWith(':date') || t === 'date') {
		return 'DATE';
	}
	if (t.includes('time') && !t.includes('datetime')) {
		return 'TIME';
	}
	if (t.includes('int') || t.includes('long') || t.includes('short') || t.includes('byte')) {
		return 'INTEGER';
	}
	if (t.includes('decimal') || t.includes('float') || t.includes('double') || t.includes('number')) {
		return 'NUMBER';
	}
	if (t.includes('uri') || t.includes('url') || t.includes('anyuri')) {
		return 'URI';
	}
	if (t.includes('id') && (t.includes('identif') || t === 'xs:id' || t.endsWith(':id'))) {
		return 'IDENTIFIER';
	}
	if (t.includes('string') || t.includes('text') || t.includes('token')) {
		return 'STRING';
	}
	if (t.includes('enum') || t.includes('code')) {
		return 'ENUM';
	}
	return 'CUSTOM';
};

const SOFT_DATATYPE_PAIRS = new Set([
	'STRING|IDENTIFIER', 'IDENTIFIER|STRING',
	'STRING|ENUM', 'ENUM|STRING',
	'STRING|URI', 'URI|STRING',
	'STRING|CUSTOM', 'CUSTOM|STRING',
	'CUSTOM|IDENTIFIER', 'IDENTIFIER|CUSTOM',
	'DATE|DATETIME', 'DATETIME|DATE',
	'INTEGER|NUMBER', 'NUMBER|INTEGER',
]);

const compareDatatypes = (a, b) => {
	const fa = DATATYPE_FAMILY(a);
	const fb = DATATYPE_FAMILY(b);
	if (fa === 'UNKNOWN' || fb === 'UNKNOWN') {
		return 0.5; // neutral — one side carries no usable datatype
	}
	if (fa === fb) {
		return 1.0;
	}
	if (SOFT_DATATYPE_PAIRS.has(`${fa}|${fb}`)) {
		return 0.7;
	}
	return 0.0;
};

// ---- element layer ----
// fields read: name, embedding (1024-d), dataType.
const elementSignals = (sourceNode, targetNode) => {
	const s = sourceNode || {};
	const t = targetNode || {};
	const nameJaccard = jaccard(tokenize(s.name || ''), tokenize(t.name || ''));
	const descriptionEmbed = cosine(s.embedding, t.embedding);
	const datatypeMatch = compareDatatypes(s.dataType, t.dataType);
	return { nameJaccard, descriptionEmbed, datatypeMatch };
};

// ---- path layer ----
// GENERIC: segments come from the universal `path` (dot-delimited), depth from the universal `depth`.
// No XML xpath, no [parentName,name] synthesis — our nodes carry real structure.
const segmentsOf = (node) => {
	if (node && typeof node.path === 'string' && node.path.length > 0) {
		return node.path.split('.').filter((segment) => segment.length > 0);
	}
	return [];
};

const depthOf = (node, segs) => {
	if (node && typeof node.depth === 'number') {
		return node.depth;
	}
	return segs.length;
};

const scoreDepthMatch = (sourceDepth, targetDepth) => {
	if (sourceDepth == null || targetDepth == null) {
		return 0.5;
	}
	const maxDepth = Math.max(sourceDepth, targetDepth, 1);
	const value = 1.0 - Math.abs(sourceDepth - targetDepth) / maxDepth;
	if (value < 0) {
		return 0;
	}
	if (value > 1) {
		return 1;
	}
	return value;
};

// mean over SOURCE segments of (best token-Jaccard against any target segment).
const scoreSegmentSim = (sourceSegs, targetSegs) => {
	if (!sourceSegs.length || !targetSegs.length) {
		return 0.5;
	}
	const sourceTokens = sourceSegs.map(tokenize);
	const targetTokens = targetSegs.map(tokenize);
	let total = 0;
	sourceTokens.forEach((srcTok) => {
		let best = 0;
		targetTokens.forEach((tgtTok) => {
			const j = jaccard(srcTok, tgtTok);
			if (j > best) {
				best = j;
			}
		});
		total += best;
	});
	return total / sourceTokens.length;
};

const pathSignals = (sourceNode, targetNode) => {
	const sourceSegs = segmentsOf(sourceNode);
	const targetSegs = segmentsOf(targetNode);
	const sourceDepth = depthOf(sourceNode, sourceSegs);
	const targetDepth = depthOf(targetNode, targetSegs);
	return {
		pathDepthMatch: scoreDepthMatch(sourceDepth, targetDepth),
		pathSegmentSim: scoreSegmentSim(sourceSegs, targetSegs),
	};
};

// ---- neighborhood layer ----
// bundles: { parent: {name, embedding}|null, siblings: [{name, embedding?}], children: [{name, embedding?}] }
const nameOf = (node) => {
	if (!node) {
		return '';
	}
	return node.name || node.shortName || node.displayName || '';
};
const embeddingOf = (node) => {
	if (!node) {
		return null;
	}
	return Array.isArray(node.embedding) ? node.embedding : null;
};

const scoreParent = (sourceParent, targetParent) => {
	if (!sourceParent || !targetParent) {
		return 0.5;
	}
	const nameSim = jaccard(tokenize(nameOf(sourceParent)), tokenize(nameOf(targetParent)));
	const embA = embeddingOf(sourceParent);
	const embB = embeddingOf(targetParent);
	if (embA && embB) {
		return (nameSim + cosine(embA, embB)) / 2;
	}
	return nameSim;
};

// set-similarity used by both siblingOverlap and childOverlap: blend of pooled-token Jaccard and
// mean-best-cosine (cosine degrades to the token Jaccard when embeddings are absent — the
// heap-conscious default; sibling/child sets are loaded NAME-ONLY).
const setSim = (sourceList, targetList) => {
	if (!sourceList || !targetList) {
		return 0.5;
	}
	if (sourceList.length === 0 || targetList.length === 0) {
		return 0.5;
	}
	const sourceNameTokens = new Set();
	const targetNameTokens = new Set();
	sourceList.forEach((node) => {
		tokenize(nameOf(node)).forEach((token) => sourceNameTokens.add(token));
	});
	targetList.forEach((node) => {
		tokenize(nameOf(node)).forEach((token) => targetNameTokens.add(token));
	});
	let inter = 0;
	sourceNameTokens.forEach((token) => {
		if (targetNameTokens.has(token)) {
			inter++;
		}
	});
	const union = sourceNameTokens.size + targetNameTokens.size - inter;
	const tokenJaccard = union > 0 ? inter / union : 0;

	let cosSum = 0;
	let cosCount = 0;
	sourceList.forEach((sn) => {
		const sEmb = embeddingOf(sn);
		if (!sEmb) {
			return;
		}
		let best = 0;
		targetList.forEach((tn) => {
			const tEmb = embeddingOf(tn);
			if (!tEmb) {
				return;
			}
			const c = cosine(sEmb, tEmb);
			if (c > best) {
				best = c;
			}
		});
		cosSum += best;
		cosCount++;
	});
	const meanBestCos = cosCount > 0 ? cosSum / cosCount : tokenJaccard;
	return (tokenJaccard + meanBestCos) / 2;
};

const neighborhoodSignals = (sourceBundle, targetBundle) => {
	const safeBundle = (b) => b || { parent: null, siblings: [], children: [] };
	const a = safeBundle(sourceBundle);
	const b = safeBundle(targetBundle);
	return {
		parentTypeSim: scoreParent(a.parent, b.parent),
		siblingOverlap: setSim(a.siblings || [], b.siblings || []),
		childOverlap: setSim(a.children || [], b.children || []),
	};
};

// ---- composite (scorer) ----
const clamp01 = (x) => {
	if (typeof x !== 'number' || Number.isNaN(x)) {
		return 0;
	}
	if (x < 0) {
		return 0;
	}
	if (x > 1) {
		return 1;
	}
	return x;
};

const composeScore = (signals, config) => {
	const w = config.weights;
	const s = signals || {};
	const safe = clamp01;

	const elementSubtotal =
		w.element.nameJaccard * safe(s.nameJaccard) +
		w.element.descriptionEmbed * safe(s.descriptionEmbed) +
		w.element.datatypeMatch * safe(s.datatypeMatch);

	const pathSubtotal =
		w.path.pathDepthMatch * safe(s.pathDepthMatch) +
		w.path.pathSegmentSim * safe(s.pathSegmentSim);

	const neighborhoodSubtotal =
		w.neighborhood.parentTypeSim * safe(s.parentTypeSim) +
		w.neighborhood.siblingOverlap * safe(s.siblingOverlap) +
		w.neighborhood.childOverlap * safe(s.childOverlap);

	const confidence = elementSubtotal + pathSubtotal + neighborhoodSubtotal;
	const semanticScore = w.element.total > 0 ? elementSubtotal / w.element.total : 0;
	const structuralCombinedWeight = w.path.total + w.neighborhood.total;
	const structuralScore =
		structuralCombinedWeight > 0
			? (pathSubtotal + neighborhoodSubtotal) / structuralCombinedWeight
			: 0;

	return {
		confidence: clamp01(confidence),
		elementSubtotal,
		pathSubtotal,
		neighborhoodSubtotal,
		semanticScore: clamp01(semanticScore),
		structuralScore: clamp01(structuralScore),
		signals: {
			nameJaccard: safe(s.nameJaccard),
			descriptionEmbed: safe(s.descriptionEmbed),
			datatypeMatch: safe(s.datatypeMatch),
			pathDepthMatch: safe(s.pathDepthMatch),
			pathSegmentSim: safe(s.pathSegmentSim),
			parentTypeSim: safe(s.parentTypeSim),
			siblingOverlap: safe(s.siblingOverlap),
			childOverlap: safe(s.childOverlap),
		},
	};
};

// scoreMatch — the full pair score: compute all 8 sub-signals, compose. sourceBundle/targetBundle are
// the pre-loaded neighborhood bundles (may be null -> neutral neighborhood signals).
const scoreMatch = ({ sourceNode, targetNode, sourceBundle, targetBundle, config }) => {
	const signals = {
		...elementSignals(sourceNode, targetNode),
		...pathSignals(sourceNode, targetNode),
		...neighborhoodSignals(sourceBundle, targetBundle),
	};
	return composeScore(signals, config);
};

module.exports = {
	moduleName,
	DATATYPE_FAMILY,
	compareDatatypes,
	elementSignals,
	pathSignals,
	neighborhoodSignals,
	composeScore,
	scoreMatch,
	segmentsOf,
	depthOf,
	clamp01,
};
