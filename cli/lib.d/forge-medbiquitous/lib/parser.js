'use strict';

// parser.js — MedBiquitous XSD + WSDL schema set -> native MedBiq graphForge node shape.
//
// HARVESTED+ADAPTED from educoreForgeOLD/system/code/cli/lib.d/forge-medbiquitous/lib/{parser,xsdParser,
// wsdlParser,importResolver}.js: the XSD/WSDL navigation logic (regex block extraction for
// complexType/simpleType/group/attributeGroup with nesting-aware close matching; element/attribute/
// enumeration/group-ref extraction; xs|xsd prefix detection; namespace-prefix resolution across the
// multi-file set; cross-file type-reference resolution; WSDL message/portType/binding/operation
// extraction) is REUSED. What is REUSED is HOW the .xsd/.wsdl files are read and navigated; the EMITTED
// node shape is the SAME native shape forge-pesc's parser produces — { id, label, superLabel,
// properties, edges, _parentEdge? } — so the forge-medbiquitous MAIN module maps each native node onto
// the universal six-role Dme* contract exactly as forge-pesc does. The OLD output schema (MedBiq* node
// contract: MedBiqElement/MedBiqComplexType/MedBiqSimpleType/MedBiqEnumValue/MedBiqWsdl* with native
// HAS_ELEMENT/TYPE_OF/IMPORTS_TYPE/USES_MESSAGE edges and a per-standard model anchor) is NOT
// reproduced.
//
// SOURCE: a DIRECTORY containing the MedBiquitous schema set, organized in a NESTED per-standard /
// per-version tree (e.g. activityReport/v2/activityreport.xsd, shared/common.xsd,
// professionalProfileWebServices/v2/memberservice.wsdl). The parser AUTO-DISCOVERS every *.xsd and
// *.wsdl file RECURSIVELY (the nested analogue of forge-pesc's flat readdir; MedBiquitous genuinely
// ships same-named files in different standards/versions — two activityreport.xsd, two
// curriculuminventory.xsd — so a recursive walk + relative-path source-qualification is required). The
// manifest.json (when present) supplies richer per-file display/standard metadata but is NOT required:
// discovery is by filesystem so an unlisted include/import target ships and parses too. .meta.json
// sidecars are ignored.
//
// WSDL HANDLING (decision, documented in the report + runbook §SOURCE NOTE): the OLD forge DID model
// the WSDL service descriptions (it emitted MedBiqWsdlMessage / MedBiqWsdlBinding / MedBiqWsdlOperation
// nodes). To preserve that coverage under the universal contract — which has no service-specific role —
// each WSDL construct is emitted as a native MedbiqSupport node (supportKind 'wsdlMessage' |
// 'wsdlBinding' | 'wsdlOperation' | 'wsdlPortType' | 'wsdlService'): reusable operational scaffolding
// that the MAIN module owns from the root via HAS_SUPPORT. This keeps the WSDL coverage the OLD forge
// had while staying standard-pure and within the six roles.
//
// The parser NEVER touches Neo4j. It only reads the source files and returns native nodes.

const fs = require('fs');
const path = require('path');

// ============================================================
// NATIVE LABELS (consumed by the MAIN module's roleSpecByNativeLabel)
// ============================================================
//   MedbiqRoot            -> DmeStandardRoot
//   MedbiqComplexType     -> DmeClass     (a named complexType, or a top-level/message element)
//   MedbiqField           -> DmeProperty  (an xs:element or xs:attribute within a type/group)
//   MedbiqOptionSet       -> DmeOptionSet (a simpleType WITH xs:enumeration)
//   MedbiqOptionValue     -> DmeOptionValue (one enumeration value)
//   MedbiqSupport         -> DmeSupport   (a non-enum simpleType, an xs:group / xs:attributeGroup,
//                                          OR a WSDL message/binding/operation/portType/service)

// ============================================================
// XML HELPERS — regex-based extraction from well-formed XSD/WSDL (harvested from the OLD xsd/wsdlParser)
// ============================================================

const normalizeLineEndings = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decodeXmlEntities = (s) =>
	s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');

// detect the schema element prefix used in THIS file ('xs' or 'xsd')
const detectXsdPrefix = (xsdText) => {
	const m = xsdText.match(/<(\w+):schema\b/);
	return m ? m[1] : 'xsd';
};

const detectWsdlPrefix = (wsdlText) => {
	const m = wsdlText.match(/<(\w+):definitions\b/);
	return m ? m[1] : ''; // '' = default namespace
};

const extractFirstDocumentation = (prefix, body) => {
	const pat = new RegExp(
		'<' +
			escapeRegex(prefix) +
			':annotation>\\s*<' +
			escapeRegex(prefix) +
			':documentation[^>]*>([\\s\\S]*?)</' +
			escapeRegex(prefix) +
			':documentation>\\s*</' +
			escapeRegex(prefix) +
			':annotation>',
	);
	const m = body.match(pat);
	if (!m) {
		return '';
	}
	return decodeXmlEntities(m[1].replace(/\s+/g, ' ').trim());
};

const extractLeadingDocumentation = (prefix, content) => {
	const pat = new RegExp(
		'^\\s*<' +
			escapeRegex(prefix) +
			':annotation>\\s*<' +
			escapeRegex(prefix) +
			':documentation[^>]*>([\\s\\S]*?)</' +
			escapeRegex(prefix) +
			':documentation>',
	);
	const m = content.match(pat);
	if (!m) {
		return '';
	}
	return decodeXmlEntities(m[1].replace(/\s+/g, ' ').trim());
};

const docFor = (prefix, body) =>
	extractLeadingDocumentation(prefix, body) || extractFirstDocumentation(prefix, body);

// ============================================================
// BLOCK EXTRACTORS — nesting-aware named-block puller (harvested)
// ============================================================

const extractNamedBlocks = (xmlText, prefix, tagName) => {
	const tag = prefix ? prefix + ':' + tagName : tagName;
	const results = [];
	const openPattern = new RegExp(
		'<' + escapeRegex(tag) + '\\b[^>]*?\\bname\\s*=\\s*"([^"]+)"[^>]*?(/?>)',
		'g',
	);
	let openMatch;

	while ((openMatch = openPattern.exec(xmlText)) !== null) {
		const name = openMatch[1];
		const isSelfClose = openMatch[2] === '/>';
		const startIdx = openMatch.index;

		if (isSelfClose) {
			results.push({ name, body: '', fullMatch: openMatch[0] });
			continue;
		}

		const openTag = '<' + tag;
		const closeTag = '</' + tag + '>';
		let depth = 1;
		let searchStart = startIdx + openMatch[0].length;
		let endIdx = -1;

		while (depth > 0 && searchStart < xmlText.length) {
			const nextOpen = xmlText.indexOf(openTag, searchStart);
			const nextClose = xmlText.indexOf(closeTag, searchStart);
			if (nextClose === -1) {
				break;
			}
			if (nextOpen !== -1 && nextOpen < nextClose) {
				const charAfter = xmlText[nextOpen + openTag.length];
				if (charAfter === ' ' || charAfter === '\t' || charAfter === '\n' || charAfter === '>') {
					depth++;
				}
				searchStart = nextOpen + openTag.length;
			} else {
				depth--;
				if (depth === 0) {
					endIdx = nextClose + closeTag.length;
				}
				searchStart = nextClose + closeTag.length;
			}
		}

		if (endIdx !== -1) {
			const body = xmlText.substring(startIdx + openMatch[0].length, endIdx - closeTag.length);
			results.push({ name, body, fullMatch: xmlText.substring(startIdx, endIdx) });
		}
	}

	return results;
};

// xs:element declarations within a block body. Returns named element fields (a ref-only element is a
// reference, not a field declaration here — skipped, matching forge-pesc).
const extractElements = (prefix, blockBody) => {
	const elements = [];
	const pat = new RegExp(
		'<' +
			escapeRegex(prefix) +
			':element\\b([^>]*?)(/>|>([\\s\\S]*?)</' +
			escapeRegex(prefix) +
			':element>)',
		'g',
	);
	let m;
	while ((m = pat.exec(blockBody)) !== null) {
		const attrs = m[1];
		const inner = m[3] || '';
		const nameMatch = attrs.match(/\bname="([^"]+)"/);
		if (!nameMatch) {
			continue;
		}
		const typeMatch = attrs.match(/\btype="([^"]+)"/);
		const minMatch = attrs.match(/\bminOccurs="([^"]+)"/);
		const maxMatch = attrs.match(/\bmaxOccurs="([^"]+)"/);

		// inline restriction base on an anonymous simpleType (an inline enum-typed element)
		let inlineType = '';
		if (!typeMatch && inner) {
			const restr = inner.match(new RegExp('<' + escapeRegex(prefix) + ':restriction\\s+base="([^"]+)"'));
			if (restr) {
				inlineType = restr[1];
			}
		}

		elements.push({
			kind: 'element',
			name: nameMatch[1],
			type: typeMatch ? typeMatch[1] : inlineType,
			minOccurs: minMatch ? minMatch[1] : '1',
			maxOccurs: maxMatch ? maxMatch[1] : '1',
			documentation: inner ? docFor(prefix, inner) : '',
		});
	}
	return elements;
};

// xs:attribute declarations within a block body. Same field shape, kind 'attribute'.
const extractAttributes = (prefix, blockBody) => {
	const out = [];
	const pat = new RegExp(
		'<' +
			escapeRegex(prefix) +
			':attribute\\b([^>]*?)(/>|>([\\s\\S]*?)</' +
			escapeRegex(prefix) +
			':attribute>)',
		'g',
	);
	let m;
	while ((m = pat.exec(blockBody)) !== null) {
		const attrs = m[1];
		const inner = m[3] || '';
		const nameMatch = attrs.match(/\bname="([^"]+)"/);
		if (!nameMatch) {
			continue;
		}
		const typeMatch = attrs.match(/\btype="([^"]+)"/);
		const useMatch = attrs.match(/\buse="([^"]+)"/);
		out.push({
			kind: 'attribute',
			name: nameMatch[1],
			type: typeMatch ? typeMatch[1] : '',
			minOccurs: useMatch && useMatch[1] === 'required' ? '1' : '0',
			maxOccurs: '1',
			documentation: inner ? extractFirstDocumentation(prefix, inner) : '',
		});
	}
	return out;
};

// xs:group ref declarations within a block body. Returns { ref }.
const extractGroupRefs = (prefix, blockBody) => {
	const refs = [];
	const pat = new RegExp(
		'<' +
			escapeRegex(prefix) +
			':group\\b[^>]*?\\bref="([^"]+)"[^>]*?(?:/>|>[\\s\\S]*?</' +
			escapeRegex(prefix) +
			':group>)',
		'g',
	);
	let m;
	while ((m = pat.exec(blockBody)) !== null) {
		refs.push({ ref: m[1], refType: 'group' });
	}
	return refs;
};

// xs:attributeGroup ref declarations within a block body. Returns { ref }.
const extractAttributeGroupRefs = (prefix, blockBody) => {
	const refs = [];
	const pat = new RegExp(
		'<' + escapeRegex(prefix) + ':attributeGroup\\b[^>]*?\\bref="([^"]+)"[^>]*?/?>',
		'g',
	);
	let m;
	while ((m = pat.exec(blockBody)) !== null) {
		refs.push({ ref: m[1], refType: 'attributeGroup' });
	}
	return refs;
};

// xs:enumeration values within a simpleType body. TRIM each value (defensive — the PESC source carried
// trailing-whitespace enum artifacts; trim + dedupe whitespace variants, first wins).
const extractEnumerations = (prefix, blockBody) => {
	const enums = [];
	const pat = new RegExp(
		'<' +
			escapeRegex(prefix) +
			':enumeration\\b[^>]*?\\bvalue="([^"]*)"[^>]*?(?:/>|>([\\s\\S]*?)</' +
			escapeRegex(prefix) +
			':enumeration>)',
		'g',
	);
	let m;
	const seen = new Set();
	while ((m = pat.exec(blockBody)) !== null) {
		const value = m[1].trim();
		if (value === '' || seen.has(value)) {
			continue;
		}
		seen.add(value);
		const inner = m[2] || '';
		enums.push({ value, documentation: inner ? extractFirstDocumentation(prefix, inner) : '' });
	}
	return enums;
};

const extractRestrictionBase = (prefix, blockBody) => {
	const m = blockBody.match(new RegExp('<' + escapeRegex(prefix) + ':restriction\\b[^>]*?\\bbase="([^"]+)"'));
	return m ? m[1] : '';
};

// the extension/restriction base of a complexType's complexContent/simpleContent (SUBCLASS_OF base).
const extractComplexBase = (prefix, blockBody) => {
	const cc = blockBody.match(
		new RegExp('<' + escapeRegex(prefix) + ':complexContent>[\\s\\S]*?<' + escapeRegex(prefix) + ':extension\\s+base="([^"]+)"'),
	);
	if (cc) {
		return { base: cc[1], derivation: 'extension' };
	}
	const ccr = blockBody.match(
		new RegExp('<' + escapeRegex(prefix) + ':complexContent>[\\s\\S]*?<' + escapeRegex(prefix) + ':restriction\\s+base="([^"]+)"'),
	);
	if (ccr) {
		return { base: ccr[1], derivation: 'restriction' };
	}
	const sc = blockBody.match(
		new RegExp('<' + escapeRegex(prefix) + ':simpleContent>[\\s\\S]*?<' + escapeRegex(prefix) + ':extension\\s+base="([^"]+)"'),
	);
	if (sc) {
		return { base: sc[1], derivation: 'extension' };
	}
	return { base: '', derivation: '' };
};

// top-level xs:element declarations (message roots), excluding those nested inside a named container.
const extractTopLevelElements = (prefix, xsdText) => {
	const out = [];
	const schemaOpen = xsdText.match(new RegExp('<' + escapeRegex(prefix) + ':schema\\b[^>]*>'));
	const schemaClose = xsdText.match(new RegExp('</' + escapeRegex(prefix) + ':schema>'));
	if (!schemaOpen || !schemaClose) {
		return out;
	}
	const startIdx = schemaOpen.index + schemaOpen[0].length;
	const endIdx = schemaClose.index;

	const allElementBlocks = extractNamedBlocks(xsdText, prefix, 'element');
	const containers = [
		...extractNamedBlocks(xsdText, prefix, 'complexType'),
		...extractNamedBlocks(xsdText, prefix, 'simpleType'),
		...extractNamedBlocks(xsdText, prefix, 'group'),
		...extractNamedBlocks(xsdText, prefix, 'attributeGroup'),
	].map((b) => {
		const idx = xsdText.indexOf(b.fullMatch);
		return { start: idx, end: idx + b.fullMatch.length };
	});
	const isInsideContainer = (idx) => containers.some((c) => idx > c.start && idx < c.end);

	for (const el of allElementBlocks) {
		const idx = xsdText.indexOf(el.fullMatch);
		if (idx === -1 || idx < startIdx || idx > endIdx || isInsideContainer(idx)) {
			continue;
		}
		const openTagEnd = el.fullMatch.indexOf('>');
		const openTag = el.fullMatch.substring(0, openTagEnd + 1);
		const nameMatch = openTag.match(/\bname="([^"]+)"/);
		if (!nameMatch) {
			continue;
		}
		const typeMatch = openTag.match(/\btype="([^"]+)"/);

		const inlineCt = el.body.match(
			new RegExp('<' + escapeRegex(prefix) + ':complexType\\b[^>]*?>([\\s\\S]*?)</' + escapeRegex(prefix) + ':complexType>'),
		);
		out.push({
			name: nameMatch[1],
			type: typeMatch ? typeMatch[1] : '',
			documentation: docFor(prefix, el.body),
			hasInlineComplexType: !!inlineCt,
			inlineElements: inlineCt ? extractElements(prefix, inlineCt[1]) : [],
		});
	}
	return out;
};

// ============================================================
// NAMESPACE RESOLUTION (harvested) — build prefix -> source-slug map per file
// ============================================================

const buildNamespacePrefixMap = (xmlText, prefix) => {
	const map = {};
	const schemaOpen = xmlText.match(new RegExp('<' + escapeRegex(prefix || 'xsd') + ':schema\\b[^>]*>')) ||
		xmlText.match(/<\w+:schema\b[^>]*>/);
	const head = schemaOpen ? schemaOpen[0] : xmlText.slice(0, 4000);
	const pattern = /xmlns:(\w+)="([^"]+)"/g;
	let m;
	while ((m = pattern.exec(head)) !== null) {
		const p = m[1];
		const uri = m[2];
		if (p === prefix) {
			continue; // the schema's own xs/xsd prefix
		}
		// MedBiquitous namespaces look like http(s)://ns.medbiq.org/<standard>/v<n>/ — pull <standard>.
		const medbiq = uri.match(/^https?:\/\/ns\.medbiq\.org\/([^/]+)/);
		if (medbiq) {
			map[p] = medbiq[1];
			continue;
		}
		// otherwise key by the last meaningful colon/slash token (best-effort, harvested heuristic)
		const colonParts = uri.split(':');
		if (colonParts.length >= 2) {
			map[p] = colonParts[colonParts.length - 2];
		}
	}
	return map;
};

const resolveTypeRef = (typeRef, namespacePrefixMap) => {
	if (!typeRef) {
		return null;
	}
	const colonIdx = typeRef.indexOf(':');
	if (colonIdx === -1) {
		return { prefix: '', localName: typeRef, resolvedSlug: null };
	}
	const prefix = typeRef.substring(0, colonIdx);
	const localName = typeRef.substring(colonIdx + 1);
	if (prefix === 'xs' || prefix === 'xsd') {
		return { prefix: 'xs', localName, resolvedSlug: null };
	}
	return { prefix, localName, resolvedSlug: namespacePrefixMap[prefix] || null };
};

// the source label for a discovered file = its directory-qualified relative key (without extension),
// e.g. activityReport/v2/activityreport, shared/common, professionalProfileWebServices/v2/memberservice.
// Slashes are preserved (they are legal in the synthetic stableId remainder).
const sourceLabelFor = (relPath) => relPath.replace(/\.(xsd|wsdl)$/i, '');

// the namespace SLUG for a file = its top folder (the standard slug used in ns.medbiq.org URIs),
// e.g. 'shared', 'activityReport' -> normalized to lowercase folder; mirrors the OLD slug logic.
const slugForFile = (relPath) => {
	const top = relPath.split('/')[0];
	return top;
};

// ============================================================
// MAIN PARSER — graphForge parser contract: callback(err, { nodes, metadata })
// ============================================================

module.exports = (sourcePath, options, callback) => {
	if (typeof callback !== 'function') {
		throw new Error('forge-medbiquitous parser requires a callback');
	}
	if (!sourcePath || !fs.existsSync(sourcePath)) {
		callback(`forge-medbiquitous parser: source not found: ${sourcePath}`);
		return;
	}
	const stat = fs.statSync(sourcePath);
	if (!stat.isDirectory()) {
		callback(
			`forge-medbiquitous parser: --source must be the version directory containing the .xsd/.wsdl schema set: ${sourcePath}`,
		);
		return;
	}

	// AUTO-DISCOVER every .xsd + .wsdl file RECURSIVELY (the nested per-standard/per-version tree).
	const walk = (dir, rel, acc) => {
		for (const entry of fs.readdirSync(dir).sort()) {
			const full = path.join(dir, entry);
			const relPath = rel ? `${rel}/${entry}` : entry;
			const s = fs.statSync(full);
			if (s.isDirectory()) {
				walk(full, relPath, acc);
			} else if (/\.(xsd|wsdl)$/i.test(entry)) {
				acc.push(relPath);
			}
		}
		return acc;
	};
	const allFiles = walk(sourcePath, '', []).sort(); // deterministic order
	const xsdFiles = allFiles.filter((f) => /\.xsd$/i.test(f));
	const wsdlFiles = allFiles.filter((f) => /\.wsdl$/i.test(f));

	if (xsdFiles.length === 0) {
		callback(`forge-medbiquitous parser: no .xsd files found under ${sourcePath}`);
		return;
	}

	// optional manifest.json for richer per-file display metadata (NOT required for discovery)
	let manifestByLocalPath = {};
	const manifestPath = path.join(sourcePath, 'manifest.json');
	if (fs.existsSync(manifestPath)) {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		(manifest.artifacts || []).forEach((a) => {
			if (a.localPath) {
				manifestByLocalPath[a.localPath] = a;
			}
		});
	}

	console.error(
		`[forge-medbiquitous/parser] parsing ${xsdFiles.length} XSD + ${wsdlFiles.length} WSDL files under: ${sourcePath}`,
	);

	// ---- PHASE 1: read + parse all XSD files ----
	const allComplexTypes = []; // { name, source, slug, documentation, fields[], typeRefs[], base, derivation }
	const allSimpleTypes = []; // { name, source, slug, documentation, restrictionBase, enumerations[] }
	const allGroups = []; // { name, source, slug, documentation, fields[], kindOfGroup }
	const allRootElements = []; // { name, source, slug, type, documentation, hasInlineComplexType, inlineElements[] }
	const namespaceMaps = {}; // source -> prefixMap
	const sourceFiles = [];

	for (const relPath of xsdFiles) {
		const filePath = path.join(sourcePath, relPath);
		const content = normalizeLineEndings(fs.readFileSync(filePath, 'utf8'));
		const prefix = detectXsdPrefix(content);
		const source = sourceLabelFor(relPath);
		const slug = slugForFile(relPath);
		const art = manifestByLocalPath[relPath];

		sourceFiles.push({ filename: relPath, source, slug, standard: art ? art.standard : slug });
		namespaceMaps[source] = buildNamespacePrefixMap(content, prefix);

		for (const block of extractNamedBlocks(content, prefix, 'complexType')) {
			const { base, derivation } = extractComplexBase(prefix, block.body);
			allComplexTypes.push({
				name: block.name,
				source,
				slug,
				prefix,
				documentation: docFor(prefix, block.body),
				fields: [...extractElements(prefix, block.body), ...extractAttributes(prefix, block.body)],
				typeRefs: [
					...extractGroupRefs(prefix, block.body),
					...extractAttributeGroupRefs(prefix, block.body),
				],
				base,
				derivation,
			});
		}

		for (const block of extractNamedBlocks(content, prefix, 'simpleType')) {
			allSimpleTypes.push({
				name: block.name,
				source,
				slug,
				prefix,
				documentation: docFor(prefix, block.body),
				restrictionBase: extractRestrictionBase(prefix, block.body),
				enumerations: extractEnumerations(prefix, block.body),
			});
		}

		for (const block of extractNamedBlocks(content, prefix, 'group')) {
			allGroups.push({
				name: block.name,
				source,
				slug,
				prefix,
				kindOfGroup: 'group',
				documentation: docFor(prefix, block.body),
				fields: extractElements(prefix, block.body),
			});
		}
		for (const block of extractNamedBlocks(content, prefix, 'attributeGroup')) {
			allGroups.push({
				name: block.name,
				source,
				slug,
				prefix,
				kindOfGroup: 'attributeGroup',
				documentation: docFor(prefix, block.body),
				fields: extractAttributes(prefix, block.body),
			});
		}

		for (const elem of extractTopLevelElements(prefix, content)) {
			allRootElements.push({ ...elem, source, slug, prefix });
		}
	}

	console.error(
		`[forge-medbiquitous/parser] ${allComplexTypes.length} complexTypes, ${allSimpleTypes.length} simpleTypes, ` +
			`${allGroups.length} groups, ${allRootElements.length} root elements`,
	);

	// ---- PHASE 2: type-resolution registries (source-qualified first, slug-qualified, then name-only) ----
	const isOptionSet = (st) => st.enumerations.length > 0;

	const complexNativeId = (source, name) => `medbiqcomplex-${source}-${name}`;
	const optionSetNativeId = (source, name) => `medbiqoptset-${source}-${name}`;
	const supportSimpleNativeId = (source, name) => `medbiqsupport-simple-${source}-${name}`;
	const supportGroupNativeId = (source, kindOfGroup, name) => `medbiqsupport-${kindOfGroup}-${source}-${name}`;

	const idBySourceName = {}; // `${source}::${name}` -> { id, kind }
	const idBySlugName = {}; // `${slug}::${name}` -> { id, kind } (first wins; cross-file within a standard)
	const idByName = {}; // `${name}` -> { id, kind } (first wins; shared substrate / global fallback)
	const registerType = (source, slug, name, id, kind) => {
		idBySourceName[`${source}::${name}`] = { id, kind };
		if (!idBySlugName[`${slug}::${name}`]) {
			idBySlugName[`${slug}::${name}`] = { id, kind };
		}
		if (!idByName[name]) {
			idByName[name] = { id, kind };
		}
	};

	allComplexTypes.forEach((ct) =>
		registerType(ct.source, ct.slug, ct.name, complexNativeId(ct.source, ct.name), 'complexType'),
	);
	allSimpleTypes.forEach((st) => {
		if (isOptionSet(st)) {
			registerType(st.source, st.slug, st.name, optionSetNativeId(st.source, st.name), 'optionSet');
		} else {
			registerType(st.source, st.slug, st.name, supportSimpleNativeId(st.source, st.name), 'support');
		}
	});
	allGroups.forEach((grp) =>
		registerType(grp.source, grp.slug, grp.name, supportGroupNativeId(grp.source, grp.kindOfGroup, grp.name), 'support'),
	);

	// resolve a typeRef -> { id, kind } or null (null for xs: built-ins and unresolved externals)
	const resolveTypeTo = (typeRef, currentSource, currentSlug) => {
		if (!typeRef) {
			return null;
		}
		const resolved = resolveTypeRef(typeRef, namespaceMaps[currentSource] || {});
		if (!resolved || resolved.prefix === 'xs') {
			return null;
		}
		// 1. resolved namespace slug + local name (cross-standard, prefix-qualified)
		if (resolved.resolvedSlug) {
			const bySlug = idBySlugName[`${resolved.resolvedSlug}::${resolved.localName}`];
			if (bySlug) {
				return bySlug;
			}
		}
		// 2. same-file (source-qualified)
		const bySource = idBySourceName[`${currentSource}::${resolved.localName}`];
		if (bySource) {
			return bySource;
		}
		// 3. same-standard (slug-qualified) — same standard, sibling version/file
		const bySlugLocal = idBySlugName[`${currentSlug}::${resolved.localName}`];
		if (bySlugLocal) {
			return bySlugLocal;
		}
		// 4. global name-only first-wins (shared substrate)
		return idByName[resolved.localName] || null;
	};

	const targetLabelForKind = (kind) => {
		if (kind === 'complexType') {
			return 'MedbiqComplexType';
		}
		if (kind === 'optionSet') {
			return 'MedbiqOptionSet';
		}
		return 'MedbiqSupport';
	};

	// ---- PHASE 3: build native nodes (DEDUP by native id, first-occurrence-wins) ----
	const nodes = [];
	const seenNativeId = new Set();
	let dedupedNodes = 0;
	const pushNode = (node) => {
		if (seenNativeId.has(node.id)) {
			dedupedNodes++;
			return false;
		}
		seenNativeId.add(node.id);
		nodes.push(node);
		return true;
	};

	let fieldCount = 0;
	let optionValueCount = 0;
	let subclassEdges = 0;
	let referencesEdges = 0;
	let supportUsageEdges = 0;
	let optionSetUsageEdges = 0;

	// -- MedbiqRoot --
	nodes.push({
		id: 'medbiq-root',
		label: 'MedbiqRoot',
		superLabel: 'MedbiqModel',
		properties: {
			name: 'MedBiquitous',
			description: `MedBiquitous Health Professions Education and Credentialing Standards Portfolio — ${allComplexTypes.length} complex types, ${allSimpleTypes.length} simple types, ${allGroups.length} groups across ${xsdFiles.length} XSD + ${wsdlFiles.length} WSDL files`,
		},
		edges: [],
	});

	// emit FIELDS of an owning type/group as MedbiqField nodes (HAS_FIELD _parentEdge; TYPED_BY edge).
	const emitFields = ({ fields, ownerId, ownerName, ownerLabel, source, slug }) => {
		fields.forEach((field) => {
			const fieldNativeId = `medbiqfield-${source}-${ownerName}-${field.kind}-${field.name}`;
			const fieldEdges = [];
			const target = resolveTypeTo(field.type, source, slug);
			if (target) {
				fieldEdges.push({
					type: 'TYPED_BY',
					targetId: target.id,
					targetLabel: targetLabelForKind(target.kind),
					targetKind: target.kind,
				});
			}
			const added = pushNode({
				id: fieldNativeId,
				label: 'MedbiqField',
				superLabel: 'MedbiqModel',
				properties: {
					name: field.name,
					description:
						field.documentation || `MedBiquitous ${field.kind} ${field.name} within ${ownerName}`,
					xsdKind: field.kind,
					typeName: field.type || '',
					minOccurs: field.minOccurs,
					maxOccurs: field.maxOccurs,
					owningTypeName: ownerName,
					sourceFile: source,
				},
				edges: fieldEdges,
				_parentEdge: { type: 'HAS_FIELD', fromId: ownerId, fromLabel: ownerLabel },
			});
			if (added) {
				fieldCount++;
				if (target) {
					if (target.kind === 'optionSet') {
						optionSetUsageEdges++;
					} else {
						referencesEdges++;
					}
				}
			}
		});
	};

	// -- MedbiqComplexType (DmeClass) + fields + base SUBCLASS_OF + group/attrGroup HAS_SUPPORT --
	allComplexTypes.forEach((ct) => {
		const id = complexNativeId(ct.source, ct.name);
		const edges = [];
		let ctSubclass = 0;
		let ctSupportUsage = 0;
		let ctReferences = 0;

		if (ct.base) {
			const baseTarget = resolveTypeTo(ct.base, ct.source, ct.slug);
			if (baseTarget && baseTarget.kind === 'complexType') {
				edges.push({ type: 'EXTENDS', targetId: baseTarget.id, targetLabel: 'MedbiqComplexType', targetKind: 'complexType' });
				ctSubclass++;
			} else if (baseTarget) {
				// extension of a non-class (e.g. simpleContent over a support type) -> REFERENCES
				edges.push({ type: 'REFERENCES', targetId: baseTarget.id, targetLabel: targetLabelForKind(baseTarget.kind), targetKind: baseTarget.kind });
				ctReferences++;
			}
		}

		ct.typeRefs.forEach((gRef) => {
			const target = resolveTypeTo(gRef.ref, ct.source, ct.slug);
			if (target && target.kind === 'support') {
				edges.push({ type: 'USES_SUPPORT', targetId: target.id, targetLabel: 'MedbiqSupport', targetKind: 'support' });
				ctSupportUsage++;
			}
		});

		const ctAdded = pushNode({
			id,
			label: 'MedbiqComplexType',
			superLabel: 'MedbiqModel',
			properties: {
				name: ct.name,
				description: ct.documentation || `MedBiquitous complex type ${ct.name} from ${ct.source}`,
				sourceFile: ct.source,
				baseType: ct.base || '',
				derivation: ct.derivation || '',
			},
			edges,
		});
		if (!ctAdded) {
			return; // duplicate complexType definition: first wins; skip its fields too
		}
		subclassEdges += ctSubclass;
		supportUsageEdges += ctSupportUsage;
		referencesEdges += ctReferences;

		emitFields({ fields: ct.fields, ownerId: id, ownerName: ct.name, ownerLabel: 'MedbiqComplexType', source: ct.source, slug: ct.slug });
	});

	// -- MedbiqSupport for groups/attributeGroups (DmeSupport) + their member fields --
	allGroups.forEach((grp) => {
		const id = supportGroupNativeId(grp.source, grp.kindOfGroup, grp.name);
		const grpAdded = pushNode({
			id,
			label: 'MedbiqSupport',
			superLabel: 'MedbiqModel',
			properties: {
				name: grp.name,
				description: grp.documentation || `MedBiquitous ${grp.kindOfGroup} (scaffolding) ${grp.name} from ${grp.source}`,
				supportKind: grp.kindOfGroup,
				sourceFile: grp.source,
			},
			edges: [],
		});
		if (!grpAdded) {
			return;
		}
		emitFields({ fields: grp.fields, ownerId: id, ownerName: grp.name, ownerLabel: 'MedbiqSupport', source: grp.source, slug: grp.slug });
	});

	// -- MedbiqOptionSet (enum simpleType) + MedbiqOptionValue, OR MedbiqSupport (non-enum simpleType) --
	allSimpleTypes.forEach((st) => {
		if (isOptionSet(st)) {
			const id = optionSetNativeId(st.source, st.name);
			if (seenNativeId.has(id)) {
				dedupedNodes++;
				return;
			}
			st.enumerations.forEach((en) => {
				const valueNativeId = `medbiqoptval-${st.source}-${st.name}-${en.value}`;
				const valAdded = pushNode({
					id: valueNativeId,
					label: 'MedbiqOptionValue',
					superLabel: 'MedbiqModel',
					properties: {
						name: en.value,
						description: en.documentation || `Enumeration value "${en.value}" of ${st.name}`,
						optionSetName: st.name,
						sourceFile: st.source,
					},
					edges: [],
					_parentEdge: { type: 'HAS_VALUE', fromId: id, fromLabel: 'MedbiqOptionSet' },
				});
				if (valAdded) {
					optionValueCount++;
				}
			});
			pushNode({
				id,
				label: 'MedbiqOptionSet',
				superLabel: 'MedbiqModel',
				properties: {
					name: st.name,
					description: st.documentation || `MedBiquitous enumerated type ${st.name} from ${st.source}`,
					restrictionBase: st.restrictionBase || '',
					sourceFile: st.source,
				},
				edges: [],
			});
		} else {
			pushNode({
				id: supportSimpleNativeId(st.source, st.name),
				label: 'MedbiqSupport',
				superLabel: 'MedbiqModel',
				properties: {
					name: st.name,
					description: st.documentation || `MedBiquitous simple type ${st.name} from ${st.source}`,
					supportKind: 'simpleType',
					restrictionBase: st.restrictionBase || '',
					sourceFile: st.source,
				},
				edges: [],
			});
		}
	});

	// -- MedbiqComplexType for root (message) elements: class-centric, REFERENCES its named content type
	//    (or owns inline fields). Keeps every message root reachable. --
	allRootElements.forEach((re) => {
		const id = `medbiqcomplex-${re.source}-rootElement-${re.name}`;
		const edges = [];
		let reOptUsage = 0;
		let reRefUsage = 0;
		if (re.type) {
			const target = resolveTypeTo(re.type, re.source, re.slug);
			if (target) {
				edges.push({
					type: 'REFERENCES_TYPE',
					targetId: target.id,
					targetLabel: targetLabelForKind(target.kind),
					targetKind: target.kind,
				});
				if (target.kind === 'optionSet') {
					reOptUsage++;
				} else {
					reRefUsage++;
				}
			}
		}
		const reAdded = pushNode({
			id,
			label: 'MedbiqComplexType',
			superLabel: 'MedbiqModel',
			properties: {
				name: re.name,
				description: re.documentation || `MedBiquitous root (message) element ${re.name} from ${re.source}`,
				sourceFile: re.source,
				baseType: '',
				derivation: '',
				isRootElement: true,
			},
			edges,
		});
		if (!reAdded) {
			return;
		}
		optionSetUsageEdges += reOptUsage;
		referencesEdges += reRefUsage;

		if (re.hasInlineComplexType && re.inlineElements.length) {
			emitFields({
				fields: re.inlineElements.map((e) => ({ ...e, kind: 'element' })),
				ownerId: id,
				ownerName: re.name,
				ownerLabel: 'MedbiqComplexType',
				source: re.source,
				slug: re.slug,
			});
		}
	});

	// ---- PHASE 4: WSDL files -> MedbiqSupport nodes (operational scaffolding) ----
	// Decision (see header + report): the OLD forge modeled WSDLs as MedBiqWsdl* nodes. Under the
	// universal six-role contract (no service role), each WSDL construct becomes a MedbiqSupport node
	// (supportKind wsdl*). Messages/portTypes/bindings/operations/services are emitted; operations are
	// owned by their portType via HAS_FIELD->HAS_PROPERTY would mis-role them, so each WSDL construct is
	// a standalone support node owned by the root via HAS_SUPPORT (no fields). Standard-pure.
	const { parseWsdl } = require('./wsdlParser');
	let wsdlNodeCount = 0;
	for (const relPath of wsdlFiles) {
		const filePath = path.join(sourcePath, relPath);
		const content = normalizeLineEndings(fs.readFileSync(filePath, 'utf8'));
		const source = sourceLabelFor(relPath);
		const parsed = parseWsdl(content);

		const emitWsdlSupport = (kind, name, description) => {
			const nativeId = `medbiqsupport-${kind}-${source}-${name}`;
			const added = pushNode({
				id: nativeId,
				label: 'MedbiqSupport',
				superLabel: 'MedbiqModel',
				properties: {
					name,
					description: description || `MedBiquitous WSDL ${kind} ${name} from ${source}`,
					supportKind: kind,
					sourceFile: source,
				},
				edges: [],
			});
			if (added) {
				wsdlNodeCount++;
			}
		};

		parsed.messages.forEach((msg) =>
			emitWsdlSupport('wsdlMessage', msg.name, msg.documentation || `WSDL message ${msg.name} (${msg.parts.length} parts) in ${source}`),
		);
		parsed.portTypes.forEach((pt) => {
			emitWsdlSupport('wsdlPortType', pt.name, pt.documentation || `WSDL portType ${pt.name} in ${source}`);
			pt.operations.forEach((op) =>
				emitWsdlSupport(
					'wsdlOperation',
					`${pt.name}.${op.name}`,
					op.documentation || `WSDL operation ${op.name} (portType ${pt.name}) in ${source}`,
				),
			);
		});
		parsed.bindings.forEach((b) =>
			emitWsdlSupport('wsdlBinding', b.name, b.documentation || `WSDL binding ${b.name} (${b.style || ''} ${b.transport || ''}) in ${source}`),
		);
		parsed.services.forEach((svc) =>
			emitWsdlSupport('wsdlService', svc.name, svc.documentation || `WSDL service ${svc.name} in ${source}`),
		);
	}

	// ---- PHASE 5: counts + callback ----
	const labelCounts = {};
	nodes.forEach((n) => {
		labelCounts[n.label] = (labelCounts[n.label] || 0) + 1;
	});
	console.error(`[forge-medbiquitous/parser] native node counts: ${JSON.stringify(labelCounts)}`);
	console.error(
		`[forge-medbiquitous/parser] total native nodes ${nodes.length}, fields ${fieldCount}, ` +
			`option values ${optionValueCount}, subclass ${subclassEdges}, support-usage ${supportUsageEdges}, ` +
			`optionSet-usage ${optionSetUsageEdges}, references ${referencesEdges}, ` +
			`wsdl support nodes ${wsdlNodeCount}, deduped duplicates ${dedupedNodes}`,
	);

	callback('', {
		nodes,
		metadata: {
			version: '1.0',
			sourceFormat: 'medbiquitous-xsd-wsdl',
			sourceFiles: sourceFiles.map((s) => s.filename),
			complexTypeCount: allComplexTypes.length,
			simpleTypeCount: allSimpleTypes.length,
			groupCount: allGroups.length,
			rootElementCount: allRootElements.length,
			xsdFileCount: xsdFiles.length,
			wsdlFileCount: wsdlFiles.length,
			sourceFileCount: xsdFiles.length + wsdlFiles.length,
			wsdlSupportNodeCount: wsdlNodeCount,
			fieldCount,
			optionValueCount,
			totalNodes: nodes.length,
		},
	});
};
