'use strict';

// parser.js — PESC XSD schema files → native PESC graphForge node shape.
//
// HARVESTED+ADAPTED from educoreForgeOLD/system/code/cli/lib.d/forge-pesc/lib/parser.js: the XSD
// navigation logic (regex block extraction for complexType/simpleType/group with nesting-aware close
// matching, element/attribute/enumeration extraction, namespace-prefix resolution across the
// multi-file schema set, and cross-file type-reference resolution) is reused. What is REUSED is HOW
// the .xsd files are read and navigated; the EMITTED node shape is the SAME native shape forge-sif's
// parser produces — { id, label, superLabel, properties, edges, _parentEdge? } — so the forge-pesc
// MAIN module can map each native node onto the universal six-role Dme* contract exactly as forge-sif
// does. The OLD output schema (Pesc* node contract + native HAS_ELEMENT/HAS_TYPE/... edges) is NOT
// reproduced.
//
// SOURCE: a DIRECTORY containing the PESC .xsd schema set (CoreMain + AcademicRecord +
// AdmissionsRecord + message schemas + the imported iso_3166-1 code list). The parser AUTO-DISCOVERS
// every *.xsd file in the directory (so an xs:include / xs:import target that ships alongside is
// parsed too — the multi-file include resolution the old parser did by a hardcoded list). Sample
// instance .xml documents are ignored (only *.xsd).
//
// The parser NEVER touches Neo4j. It only reads the source files and returns native nodes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// NATIVE LABELS (consumed by the MAIN module's roleSpecByNativeLabel)
// ============================================================
//   PescRoot              -> DmeStandardRoot
//   PescComplexType       -> DmeClass     (a structured type that owns fields)
//   PescField             -> DmeProperty  (an xs:element or xs:attribute within a type/group)
//   PescOptionSet         -> DmeOptionSet (a simpleType WITH xs:enumeration)
//   PescOptionValue       -> DmeOptionValue (one enumeration value)
//   PescSupport           -> DmeSupport   (a named simpleType WITHOUT enumeration, or an xs:group:
//                                          reusable scaffolding referenced by complexTypes)

// ============================================================
// XML HELPERS — regex-based extraction from well-formed XSD (harvested)
// ============================================================

const normalizeLineEndings = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractDocumentation = (xmlFragment) => {
	const match = xmlFragment.match(/<xs:documentation>([\s\S]*?)<\/xs:documentation>/);
	if (!match) {
		return '';
	}
	return match[1].replace(/\s+/g, ' ').trim();
};

const extractLeadingDocumentation = (content) => {
	const annoMatch = content.match(
		/^\s*<xs:annotation>\s*<xs:documentation>([\s\S]*?)<\/xs:documentation>\s*<\/xs:annotation>/,
	);
	if (!annoMatch) {
		return '';
	}
	return annoMatch[1].replace(/\s+/g, ' ').trim();
};

// ============================================================
// BLOCK EXTRACTORS — pull typed definition blocks from XSD text (harvested, nesting-aware)
// ============================================================

const extractNamedBlocks = (xsdText, tagName) => {
	const results = [];
	const openPattern = new RegExp('<xs:' + tagName + '\\s+name="([^"]+)"', 'g');
	let openMatch;

	while ((openMatch = openPattern.exec(xsdText)) !== null) {
		const name = openMatch[1];
		const startIdx = openMatch.index;

		const closeTag = '</xs:' + tagName + '>';
		const selfClosePattern = new RegExp(
			'<xs:' + tagName + '\\s+name="' + escapeRegex(name) + '"[^>]*/>',
			'',
		);
		const selfCloseMatch = xsdText.substring(startIdx).match(selfClosePattern);

		if (selfCloseMatch && selfCloseMatch.index === 0) {
			results.push({ name, body: selfCloseMatch[0] });
			continue;
		}

		let depth = 1;
		let searchStart = startIdx + openMatch[0].length;
		const openTag = '<xs:' + tagName;
		let endIdx = -1;

		while (depth > 0 && searchStart < xsdText.length) {
			const nextOpen = xsdText.indexOf(openTag, searchStart);
			const nextClose = xsdText.indexOf(closeTag, searchStart);

			if (nextClose === -1) {
				break;
			}

			if (nextOpen !== -1 && nextOpen < nextClose) {
				const charAfter = xsdText[nextOpen + openTag.length];
				if (charAfter === ' ' || charAfter === '>') {
					// a SELF-CLOSING nested tag (e.g. a <xs:group ref="…"/> member) opens no block —
					// its matching close never arrives, so counting it as an open unbalances the
					// depth and the whole named block is silently discarded (the CoreMain
					// address-group drop, Phase 1 defect D1).
					const nestedTagEnd = xsdText.indexOf('>', nextOpen);
					const nestedIsSelfClosing = nestedTagEnd !== -1 && xsdText[nestedTagEnd - 1] === '/';
					if (!nestedIsSelfClosing) {
						depth++;
					}
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
			results.push({ name, body: xsdText.substring(startIdx, endIdx) });
		}
	}

	return results;
};

// xs:element declarations within a block body. Returns { name, type, minOccurs, maxOccurs, documentation }.
const extractElements = (blockBody) => {
	const elements = [];
	const elementPattern = /<xs:element\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/xs:element>)/g;
	let match;

	while ((match = elementPattern.exec(blockBody)) !== null) {
		const attrs = match[1];
		const innerContent = match[2] || '';

		const nameMatch = attrs.match(/name="([^"]+)"/);
		if (!nameMatch) {
			continue; // a ref= element (no name) is a reference, not a field declaration here
		}

		const typeMatch = attrs.match(/type="([^"]+)"/);
		const minMatch = attrs.match(/minOccurs="([^"]+)"/);
		const maxMatch = attrs.match(/maxOccurs="([^"]+)"/);

		// inline simpleType with a typeRef on the restriction (e.g. an inline enum-typed element)
		let inlineType = '';
		if (!typeMatch && innerContent) {
			const restr = innerContent.match(/<xs:restriction\s+base="([^"]+)"/);
			if (restr) {
				inlineType = restr[1];
			}
		}

		const doc = innerContent ? extractDocumentation(innerContent) : '';

		elements.push({
			kind: 'element',
			name: nameMatch[1],
			type: typeMatch ? typeMatch[1] : inlineType,
			minOccurs: minMatch ? minMatch[1] : '1',
			maxOccurs: maxMatch ? maxMatch[1] : '1',
			documentation: doc,
		});
	}

	return elements;
};

// xs:attribute declarations within a block body. Returns the same field shape, kind 'attribute'.
const extractAttributes = (blockBody) => {
	const attributes = [];
	const attrPattern = /<xs:attribute\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/xs:attribute>)/g;
	let match;

	while ((match = attrPattern.exec(blockBody)) !== null) {
		const attrs = match[1];
		const innerContent = match[2] || '';

		const nameMatch = attrs.match(/name="([^"]+)"/);
		if (!nameMatch) {
			continue;
		}
		const typeMatch = attrs.match(/type="([^"]+)"/);
		const useMatch = attrs.match(/use="([^"]+)"/);
		const doc = innerContent ? extractDocumentation(innerContent) : '';

		attributes.push({
			kind: 'attribute',
			name: nameMatch[1],
			type: typeMatch ? typeMatch[1] : '',
			minOccurs: useMatch && useMatch[1] === 'required' ? '1' : '0',
			maxOccurs: '1',
			documentation: doc,
		});
	}

	return attributes;
};

// xs:group ref declarations within a block body. Returns { ref }.
const extractGroupRefs = (blockBody) => {
	const refs = [];
	const refPattern = /<xs:group\s+ref="([^"]+)"([^>]*?)(?:\/>|>[\s\S]*?<\/xs:group>)/g;
	let match;

	while ((match = refPattern.exec(blockBody)) !== null) {
		refs.push({ ref: match[1] });
	}

	return refs;
};

// xs:enumeration values within a simpleType body. Returns { enums: [{ value, documentation }],
// census: { trimmedValues, emptySkipped, dedupedValues } } — every canonicalization event is
// COUNTED (Phase 1 D6): the trim/skip/dedupe decisions stand, but never silently.
const extractEnumerations = (blockBody) => {
	const enums = [];
	const census = { trimmedValues: 0, emptySkipped: 0, dedupedValues: 0 };
	const enumPattern = /<xs:enumeration\s+value="([^"]*)"(?:\s*\/>|>([\s\S]*?)<\/xs:enumeration>)/g;
	let match;

	const seenValues = new Set();
	while ((match = enumPattern.exec(blockBody)) !== null) {
		// trim the value: the PESC source carries a few enumeration tokens with trailing whitespace
		// (e.g. value="NoCredit " alongside value="NoCredit") — an accidental source artifact, not a
		// meaningful distinct option. The trimmed token is the value's canonical identity; dedupe
		// whitespace variants within the same simpleType (first occurrence wins).
		const rawValue = match[1];
		const value = rawValue.trim();
		if (value !== rawValue) {
			census.trimmedValues++;
		}
		if (value === '') {
			census.emptySkipped++;
			continue;
		}
		if (seenValues.has(value)) {
			census.dedupedValues++;
			continue;
		}
		seenValues.add(value);
		const innerContent = match[2] || '';
		const doc = innerContent ? extractDocumentation(innerContent) : '';
		enums.push({ value, documentation: doc });
	}

	return { enums, census };
};

// the restriction base of a simpleType (e.g. xs:string, or a named base type)
const extractRestrictionBase = (blockBody) => {
	const match = blockBody.match(/<xs:restriction\s+base="([^"]+)"/);
	return match ? match[1] : '';
};

// the extension/restriction base of a complexType's complexContent (the SUBCLASS_OF base type).
const extractComplexBase = (blockBody) => {
	const ext = blockBody.match(/<xs:complexContent>[\s\S]*?<xs:extension\s+base="([^"]+)"/);
	if (ext) {
		return { base: ext[1], derivation: 'extension' };
	}
	const restr = blockBody.match(/<xs:complexContent>[\s\S]*?<xs:restriction\s+base="([^"]+)"/);
	if (restr) {
		return { base: restr[1], derivation: 'restriction' };
	}
	// simpleContent extension (a type with text content + attributes) — also a base relationship.
	const simpleExt = blockBody.match(/<xs:simpleContent>[\s\S]*?<xs:extension\s+base="([^"]+)"/);
	if (simpleExt) {
		return { base: simpleExt[1], derivation: 'extension' };
	}
	return { base: '', derivation: '' };
};

// top-level xs:element declarations (root elements in message schemas) — harvested.
const extractRootElements = (xsdText) => {
	const results = [];
	const pattern = /<xs:element\s+name="([^"]+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/xs:element>)/g;
	let match;

	while ((match = pattern.exec(xsdText)) !== null) {
		const name = match[1];
		const attrs = match[2] || '';
		const innerContent = match[3] || '';

		// only top-level (direct child of xs:schema → 0 or 1 tab indent)
		const lineStart = xsdText.lastIndexOf('\n', match.index);
		const indent = xsdText.substring(lineStart + 1, match.index);
		if (indent.trim() !== '' && indent.replace(/\t/g, '').trim() !== '') {
			continue;
		}
		const tabCount = (indent.match(/\t/g) || []).length;
		if (tabCount > 1) {
			continue;
		}

		const typeMatch = attrs.match(/type="([^"]+)"/);
		// LEADING annotation only (Phase 1 D4): reaching for any nested xs:documentation when the
		// element itself carries none would attribute a CHILD element's documentation to this one.
		const doc = innerContent ? extractLeadingDocumentation(innerContent) : '';

		const hasInlineComplexType = innerContent.indexOf('<xs:complexType>') !== -1;
		let inlineElements = [];
		if (hasInlineComplexType) {
			inlineElements = extractElements(innerContent);
		}

		results.push({
			name,
			type: typeMatch ? typeMatch[1] : '',
			documentation: doc,
			hasInlineComplexType,
			inlineElements,
		});
	}

	return results;
};

// ============================================================
// NAMESPACE RESOLUTION (harvested)
// ============================================================

const resolveTypeRef = (typeRef, namespacePrefixMap) => {
	if (!typeRef) {
		return null;
	}
	const colonIdx = typeRef.indexOf(':');
	if (colonIdx === -1) {
		return { prefix: '', localName: typeRef, resolvedSource: null };
	}
	const prefix = typeRef.substring(0, colonIdx);
	const localName = typeRef.substring(colonIdx + 1);
	if (prefix === 'xs') {
		return { prefix: 'xs', localName, resolvedSource: null };
	}
	const resolvedSource = namespacePrefixMap[prefix] || null;
	return { prefix, localName, resolvedSource };
};

const buildNamespacePrefixMap = (xsdText) => {
	const map = {};
	const nsPattern = /xmlns:(\w+)="([^"]+)"/g;
	let match;
	while ((match = nsPattern.exec(xsdText)) !== null) {
		const prefix = match[1];
		const uri = match[2];
		if (prefix === 'xs') {
			continue;
		}
		const parts = uri.split(':');
		if (parts.length >= 2) {
			map[prefix] = parts[parts.length - 2];
		}
	}
	return map;
};

const sourceLabel = (filename) => filename.replace(/_v[\d.]+\.xsd$/, '').replace(/\.xsd$/, '');

// ============================================================
// MAIN PARSER — graphForge parser contract: callback(err, { nodes, metadata, parseAudit })
// (parseAudit is the Phase 1 silent-source audit ledger — run diagnostics, never block content)
// ============================================================

module.exports = (sourcePath, options, callback) => {
	// RT-3: every refusal names what is wrong AND where the acquisition recipe lives.
	const acquisitionRecipeNote = `acquisition recipe: README_PROVENANCE.md in ${sourcePath}`;

	if (!fs.existsSync(sourcePath)) {
		callback(`forge-pesc parser: source not found: ${sourcePath} — ${acquisitionRecipeNote}`);
		return;
	}
	const stat = fs.statSync(sourcePath);
	if (!stat.isDirectory()) {
		callback(
			`forge-pesc parser: --source must be the version directory containing the .xsd schema set: ${sourcePath} — ${acquisitionRecipeNote}`,
		);
		return;
	}

	// AUTO-DISCOVER every .xsd file (resolves the include/import set the old parser hardcoded).
	const xsdFiles = fs
		.readdirSync(sourcePath)
		.filter((name) => /\.xsd$/i.test(name))
		.sort(); // deterministic order

	if (xsdFiles.length === 0) {
		callback(`forge-pesc parser: no .xsd files found in ${sourcePath} — ${acquisitionRecipeNote}`);
		return;
	}

	// ---- RT-3 source integrity (Phase 1 D5/D7): refuse by name, never skip, never guess ----

	// D5: a versionless filename previously got version 'unknown' silently — a silent default.
	const versionlessFiles = xsdFiles.filter((name) => !/_v[\d.]+\.xsd$/.test(name));
	if (versionlessFiles.length > 0) {
		callback(
			`forge-pesc parser: source file(s) without a _v<version> filename suffix: ${versionlessFiles.join(', ')} — every snapshot .xsd carries its version in its filename; ${acquisitionRecipeNote}`,
		);
		return;
	}

	// D7: verify the source bytes against the snapshot's SHA256SUMS (provenance peer, RT-11).
	// A checksum-failing, unlisted, or listed-but-absent source is a refusal that fails the
	// build — a silently-substituted source is indistinguishable from the right one.
	const checksumFilePath = path.join(sourcePath, 'SHA256SUMS');
	if (!fs.existsSync(checksumFilePath)) {
		callback(
			`forge-pesc parser: SHA256SUMS is missing from ${sourcePath} — the snapshot's provenance checksums are required (RT-3/RT-11); ${acquisitionRecipeNote}`,
		);
		return;
	}
	const declaredChecksumByFilename = {};
	fs.readFileSync(checksumFilePath, 'utf8')
		.split('\n')
		.filter((line) => line.trim() !== '')
		.forEach((line) => {
			const entryMatch = line.match(/^([0-9a-f]{64})\s+(.+)$/);
			if (entryMatch) {
				declaredChecksumByFilename[entryMatch[2].trim()] = entryMatch[1];
			}
		});
	const listedButAbsent = Object.keys(declaredChecksumByFilename).filter(
		(filename) => !fs.existsSync(path.join(sourcePath, filename)),
	);
	if (listedButAbsent.length > 0) {
		callback(
			`forge-pesc parser: SHA256SUMS lists source file(s) absent from ${sourcePath}: ${listedButAbsent.join(', ')} — a missing source fails the build (RT-3); ${acquisitionRecipeNote}`,
		);
		return;
	}
	const unlistedXsdFiles = xsdFiles.filter((name) => !declaredChecksumByFilename[name]);
	if (unlistedXsdFiles.length > 0) {
		callback(
			`forge-pesc parser: .xsd file(s) present but not listed in SHA256SUMS: ${unlistedXsdFiles.join(', ')} — unchecksummed source is refused (RT-3); ${acquisitionRecipeNote}`,
		);
		return;
	}
	const checksumFailures = Object.keys(declaredChecksumByFilename).filter((filename) => {
		const actualChecksum = crypto
			.createHash('sha256')
			.update(fs.readFileSync(path.join(sourcePath, filename)))
			.digest('hex');
		return actualChecksum !== declaredChecksumByFilename[filename];
	});
	if (checksumFailures.length > 0) {
		callback(
			`forge-pesc parser: checksum verification FAILED for: ${checksumFailures.join(', ')} — the source bytes do not match SHA256SUMS (RT-3: corrupt or altered source); ${acquisitionRecipeNote}`,
		);
		return;
	}

	console.error(`[forge-pesc/parser] parsing ${xsdFiles.length} XSD files in: ${sourcePath}`);

	// ---- PHASE 1: read + parse all XSD files ----
	const allComplexTypes = []; // { name, source, documentation, fields[], groupRefs[], base, derivation }
	const allSimpleTypes = []; // { name, source, documentation, restrictionBase, enumerations[] }
	const allGroups = []; // { name, source, documentation, fields[] }
	const allRootElements = []; // { name, source, type, documentation, hasInlineComplexType, inlineElements[] }
	const sourceFiles = [];
	const namespaceMaps = {};

	// parseAudit — the silent-source audit ledger (Phase 1, RT-2/R-PW-4): every decision the
	// parser previously made in silence is recorded here. Run diagnostics only — the forge
	// carries it in stats, never in metadata (which is block content).
	const parseAudit = {
		unresolvedTypeRefs: [], // { typeRef, source, context } — non-builtin refs resolving to nothing
		importDeclarationDrift: [], // R-PW-4: declared schemaLocation absent; what resolved instead
		trimmedEnumValues: 0,
		emptyEnumValuesSkipped: 0,
		dedupedEnumValues: 0,
	};

	for (const filename of xsdFiles) {
		const filePath = path.join(sourcePath, filename);
		const content = normalizeLineEndings(fs.readFileSync(filePath, 'utf8'));
		const source = sourceLabel(filename);

		const versionMatch = filename.match(/_v([\d.]+)\.xsd$/);
		const version = versionMatch[1]; // pre-validated above: every filename carries _v<version>
		sourceFiles.push({ filename, source, version });

		namespaceMaps[source] = buildNamespacePrefixMap(content);

		// R-PW-4 import-declaration drift census — derived mechanically from the xs:import /
		// xs:include declarations themselves, never a hand-maintained list: a schemaLocation
		// naming a file absent from the snapshot is recorded together with the same-label file
		// the version-insensitive resolution reads instead. The curated-assembly posture this
		// makes visible is declared in README_PROVENANCE.md; the drift is reported, never
		// silently resolved and never refused (supervisor ruling R-PW-4, 2026-08-03).
		const importPattern = /<xs:(?:import|include)\s+[^>]*?schemaLocation="([^"]+)"/g;
		let importMatch;
		while ((importMatch = importPattern.exec(content)) !== null) {
			const declaredLocation = importMatch[1];
			if (!xsdFiles.includes(declaredLocation)) {
				const presentInstead = xsdFiles.find(
					(candidateFilename) => sourceLabel(candidateFilename) === sourceLabel(declaredLocation),
				);
				parseAudit.importDeclarationDrift.push({
					declaringFile: filename,
					declaredSchemaLocation: declaredLocation,
					presentInstead: presentInstead === undefined ? null : presentInstead,
				});
			}
		}

		// complexTypes
		for (const block of extractNamedBlocks(content, 'complexType')) {
			const innerStart = block.body.indexOf('>') + 1;
			const doc = extractLeadingDocumentation(block.body.substring(innerStart));
			const { base, derivation } = extractComplexBase(block.body);
			allComplexTypes.push({
				name: block.name,
				source,
				documentation: doc,
				fields: [...extractElements(block.body), ...extractAttributes(block.body)],
				groupRefs: extractGroupRefs(block.body),
				base,
				derivation,
			});
		}

		// simpleTypes
		for (const block of extractNamedBlocks(content, 'simpleType')) {
			const innerStart = block.body.indexOf('>') + 1;
			const doc = extractLeadingDocumentation(block.body.substring(innerStart));
			const { enums, census } = extractEnumerations(block.body);
			parseAudit.trimmedEnumValues += census.trimmedValues;
			parseAudit.emptyEnumValuesSkipped += census.emptySkipped;
			parseAudit.dedupedEnumValues += census.dedupedValues;
			allSimpleTypes.push({
				name: block.name,
				source,
				documentation: doc,
				restrictionBase: extractRestrictionBase(block.body),
				enumerations: enums,
			});
		}

		// groups (groupRefs too — a group whose members are <xs:group ref=…/> owns that
		// scaffolding exactly as a complexType does; present-is-present, Phase 1 D1)
		for (const block of extractNamedBlocks(content, 'group')) {
			const innerStart = block.body.indexOf('>') + 1;
			const doc = extractLeadingDocumentation(block.body.substring(innerStart));
			allGroups.push({
				name: block.name,
				source,
				documentation: doc,
				fields: extractElements(block.body),
				groupRefs: extractGroupRefs(block.body),
			});
		}

		// root (message) elements
		for (const elem of extractRootElements(content)) {
			allRootElements.push({ ...elem, source });
		}
	}

	console.error(
		`[forge-pesc/parser] ${allComplexTypes.length} complexTypes, ${allSimpleTypes.length} simpleTypes, ` +
			`${allGroups.length} groups, ${allRootElements.length} root elements`,
	);

	// ---- PHASE 2: native-id lookup maps for cross-file type resolution ----
	// A simpleType WITH enumeration is an OPTION SET; WITHOUT, it is SUPPORT. Classify up front so
	// type refs resolve to the right native id (and so a field typed by an enum simpleType yields a
	// HAS_OPTION_SET in the main module).
	const isOptionSet = (st) => st.enumerations.length > 0;

	const complexNativeId = (source, name) => `pesccomplex-${source}-${name}`;
	const optionSetNativeId = (source, name) => `pescoptset-${source}-${name}`;
	const supportSimpleNativeId = (source, name) => `pescsupport-simple-${source}-${name}`;
	const supportGroupNativeId = (source, name) => `pescsupport-group-${source}-${name}`;

	// name -> { id, kind } registries (source-qualified first, then name-only first-wins)
	const idBySourceName = {}; // `${source}::${name}` -> { id, kind }
	const idByName = {}; // `${name}` -> { id, kind }
	const registerType = (source, name, id, kind) => {
		const key = `${source}::${name}`;
		idBySourceName[key] = { id, kind };
		if (!idByName[name]) {
			idByName[name] = { id, kind };
		}
	};

	allComplexTypes.forEach((ct) =>
		registerType(ct.source, ct.name, complexNativeId(ct.source, ct.name), 'complexType'),
	);
	allSimpleTypes.forEach((st) => {
		if (isOptionSet(st)) {
			registerType(st.source, st.name, optionSetNativeId(st.source, st.name), 'optionSet');
		} else {
			registerType(st.source, st.name, supportSimpleNativeId(st.source, st.name), 'support');
		}
	});
	allGroups.forEach((grp) =>
		registerType(grp.source, grp.name, supportGroupNativeId(grp.source, grp.name), 'support'),
	);

	// resolve a typeRef -> { id, kind } or null (null for xs: built-ins and unresolved externals)
	const resolveTypeTo = (typeRef, currentSource) => {
		if (!typeRef) {
			return null;
		}
		const resolved = resolveTypeRef(typeRef, namespaceMaps[currentSource] || {});
		if (!resolved || resolved.prefix === 'xs') {
			return null;
		}
		if (resolved.resolvedSource) {
			const key = `${resolved.resolvedSource}::${resolved.localName}`;
			if (idBySourceName[key]) {
				return idBySourceName[key];
			}
		}
		if (!resolved.prefix) {
			const key = `${currentSource}::${resolved.localName}`;
			if (idBySourceName[key]) {
				return idBySourceName[key];
			}
		}
		return idByName[resolved.localName] || null;
	};

	// RT-2 visibility (Phase 1): a non-builtin reference that resolves to nothing was previously
	// skipped without record — absent-is-absent requires the absence be OBSERVABLE. xs: built-ins
	// legitimately resolve to nothing here (XML Schema's own vocabulary, not source types).
	const recordUnresolvedTypeRef = (typeRef, currentSource, context) => {
		if (!typeRef) {
			return;
		}
		const resolved = resolveTypeRef(typeRef, namespaceMaps[currentSource] || {});
		if (resolved && resolved.prefix === 'xs') {
			return;
		}
		parseAudit.unresolvedTypeRefs.push({ typeRef, source: currentSource, context });
	};

	const targetLabelForKind = (kind) => {
		if (kind === 'complexType') {
			return 'PescComplexType';
		}
		if (kind === 'optionSet') {
			return 'PescOptionSet';
		}
		return 'PescSupport';
	};

	// ---- PHASE 3: build native nodes ----
	// DEDUP (the XSD-family analogue of the EdFi CSV repeat-per-usage gotcha): the PESC source
	// genuinely defines some types twice (e.g. AdmissionsRecord defines complexType 'SponsorType'
	// twice), and recurring local enum/element names across the regex-navigated multi-file set can
	// otherwise collide. A type / field / option value identified by the SAME source-qualified native
	// id is canonically ONE node — emit it once (first occurrence wins). Without this dedup, identical
	// stableIds are emitted twice and the replay engine silently MERGEs them, masking the duplication
	// as "missing" data (and failing the unique-stableId gate). pushNode enforces it.
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

	// -- PescRoot --
	nodes.push({
		id: 'pesc-root',
		label: 'PescRoot',
		superLabel: 'PescModel',
		properties: {
			name: 'PESC',
			description: `Postsecondary Electronic Standards Council XML Schema — ${allComplexTypes.length} complex types, ${allSimpleTypes.length} simple types, ${allGroups.length} groups across ${sourceFiles.length} XSD files`,
		},
		edges: [],
	});

	// emit the FIELDS of an owning type/group as PescField nodes; each owns a _parentEdge HAS_FIELD
	// to its owner, and (when typed) a TYPED_BY edge to the resolved type (the main module routes
	// TYPED_BY-to-optionSet -> HAS_OPTION_SET, TYPED_BY-to-complexType/support -> REFERENCES).
	const emitFields = ({ fields, ownerId, ownerName, ownerLabel, source }) => {
		fields.forEach((field) => {
			const fieldNativeId = `pescfield-${source}-${ownerName}-${field.kind}-${field.name}`;
			const fieldEdges = [];

			const target = resolveTypeTo(field.type, source);
			if (target) {
				fieldEdges.push({
					type: 'TYPED_BY',
					targetId: target.id,
					targetLabel: targetLabelForKind(target.kind),
					targetKind: target.kind,
				});
			} else {
				recordUnresolvedTypeRef(field.type, source, `field ${ownerName}.${field.name}`);
			}

			const added = pushNode({
				id: fieldNativeId,
				label: 'PescField',
				superLabel: 'PescModel',
				properties: {
					name: field.name,
					// absent is absent (RT-2, Phase 1 D2): the source's own xs:documentation or
					// nothing — a synthesized placeholder is fabrication, the banned class.
					description: field.documentation,
					xsdKind: field.kind, // 'element' | 'attribute'
					typeName: field.type || '',
					minOccurs: field.minOccurs,
					maxOccurs: field.maxOccurs,
					owningTypeName: ownerName,
					sourceFile: source,
				},
				edges: fieldEdges,
				_parentEdge: {
					type: 'HAS_FIELD',
					fromId: ownerId,
					fromLabel: ownerLabel,
				},
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

	// -- PescComplexType (DmeClass) + its fields + base SUBCLASS_OF + group HAS_SUPPORT --
	allComplexTypes.forEach((ct) => {
		const id = complexNativeId(ct.source, ct.name);
		const edges = [];

		let ctSubclass = 0;
		let ctSupportUsage = 0;

		// SUBCLASS_OF: extension/restriction base when the base resolves to another complexType.
		// (a base resolving to a simpleType/support is NOT unresolved — the derivation is retained
		// in the baseType/derivation scalar properties; only a nothing-resolution is recorded.)
		if (ct.base) {
			const baseTarget = resolveTypeTo(ct.base, ct.source);
			if (baseTarget && baseTarget.kind === 'complexType') {
				edges.push({
					type: 'EXTENDS',
					targetId: baseTarget.id,
					targetLabel: 'PescComplexType',
					targetKind: 'complexType',
				});
				ctSubclass++;
			}
			if (!baseTarget) {
				recordUnresolvedTypeRef(ct.base, ct.source, `complexType ${ct.name} base`);
			}
		}

		// group usage: a complexType referencing an xs:group uses reusable scaffolding -> HAS_SUPPORT.
		ct.groupRefs.forEach((gRef) => {
			const target = resolveTypeTo(gRef.ref, ct.source);
			if (target && target.kind === 'support') {
				edges.push({
					type: 'USES_SUPPORT',
					targetId: target.id,
					targetLabel: 'PescSupport',
					targetKind: 'support',
				});
				ctSupportUsage++;
			} else {
				recordUnresolvedTypeRef(gRef.ref, ct.source, `complexType ${ct.name} group ref`);
			}
		});

		const ctAdded = pushNode({
			id,
			label: 'PescComplexType',
			superLabel: 'PescModel',
			properties: {
				name: ct.name,
				description: ct.documentation,
				sourceFile: ct.source,
				baseType: ct.base || '',
				derivation: ct.derivation || '',
				fieldCount: ct.fields.length,
			},
			edges,
		});
		if (!ctAdded) {
			// a duplicate complexType definition (e.g. AdmissionsRecord's twice-defined SponsorType):
			// the first definition's class + fields are canonical; skip the duplicate's fields too.
			return;
		}
		subclassEdges += ctSubclass;
		supportUsageEdges += ctSupportUsage;

		emitFields({
			fields: ct.fields,
			ownerId: id,
			ownerName: ct.name,
			ownerLabel: 'PescComplexType',
			source: ct.source,
		});
	});

	// -- PescSupport for groups (DmeSupport) + their member fields + group-to-group refs --
	allGroups.forEach((grp) => {
		const id = supportGroupNativeId(grp.source, grp.name);
		const edges = [];

		let grpSupportUsage = 0;
		// group-to-group scaffolding (Phase 1 D1, present-is-present): a group whose members are
		// <xs:group ref=…/> owns that scaffolding exactly as a complexType does — without these
		// edges the address groups would land as empty husks.
		grp.groupRefs.forEach((gRef) => {
			const target = resolveTypeTo(gRef.ref, grp.source);
			if (target && target.kind === 'support') {
				edges.push({
					type: 'USES_SUPPORT',
					targetId: target.id,
					targetLabel: 'PescSupport',
					targetKind: 'support',
				});
				grpSupportUsage++;
			} else {
				recordUnresolvedTypeRef(gRef.ref, grp.source, `group ${grp.name} group ref`);
			}
		});

		const grpAdded = pushNode({
			id,
			label: 'PescSupport',
			superLabel: 'PescModel',
			properties: {
				name: grp.name,
				description: grp.documentation,
				supportKind: 'group',
				sourceFile: grp.source,
				fieldCount: grp.fields.length,
			},
			edges,
		});
		if (!grpAdded) {
			return;
		}
		supportUsageEdges += grpSupportUsage;

		emitFields({
			fields: grp.fields,
			ownerId: id,
			ownerName: grp.name,
			ownerLabel: 'PescSupport',
			source: grp.source,
		});
	});

	// -- PescOptionSet (enum simpleType) + PescOptionValue, OR PescSupport (non-enum simpleType) --
	allSimpleTypes.forEach((st) => {
		if (isOptionSet(st)) {
			const id = optionSetNativeId(st.source, st.name);
			const edges = [];

			// a duplicate-named enum simpleType: keep the FIRST definition's option set + values.
			if (seenNativeId.has(id)) {
				dedupedNodes++;
				return;
			}

			st.enumerations.forEach((en) => {
				const valueNativeId = `pescoptval-${st.source}-${st.name}-${en.value}`;
				const valAdded = pushNode({
					id: valueNativeId,
					label: 'PescOptionValue',
					superLabel: 'PescModel',
					properties: {
						name: en.value,
						description: en.documentation,
						optionSetName: st.name,
						sourceFile: st.source,
					},
					edges: [],
					_parentEdge: {
						type: 'HAS_VALUE',
						fromId: id,
						fromLabel: 'PescOptionSet',
					},
				});
				if (valAdded) {
					optionValueCount++;
				}
			});

			pushNode({
				id,
				label: 'PescOptionSet',
				superLabel: 'PescModel',
				properties: {
					name: st.name,
					description: st.documentation,
					restrictionBase: st.restrictionBase || '',
					sourceFile: st.source,
					valueCount: st.enumerations.length,
				},
				edges,
			});
		} else {
			// non-enum named simpleType = reusable primitive/constraint scaffolding -> DmeSupport
			pushNode({
				id: supportSimpleNativeId(st.source, st.name),
				label: 'PescSupport',
				superLabel: 'PescModel',
				properties: {
					name: st.name,
					description: st.documentation,
					supportKind: 'simpleType',
					restrictionBase: st.restrictionBase || '',
					sourceFile: st.source,
				},
				edges: [],
			});
		}
	});

	// -- PescComplexType for root (message) elements that carry an inline complexType; otherwise a
	//    REFERENCES from a lightweight class to the named type. To keep the model class-centric and
	//    every root element reachable, a root element is modeled as a DmeClass (PescComplexType) that
	//    either owns inline fields or REFERENCES its named type. --
	allRootElements.forEach((re) => {
		const id = `pesccomplex-${re.source}-rootElement-${re.name}`;
		const edges = [];

		let reOptUsage = 0;
		let reRefUsage = 0;
		if (re.type) {
			const target = resolveTypeTo(re.type, re.source);
			if (target) {
				// a typed root element REFERENCES its content type (class->class/support reference)
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
			} else {
				recordUnresolvedTypeRef(re.type, re.source, `root element ${re.name} type`);
			}
		}

		const reAdded = pushNode({
			id,
			label: 'PescComplexType',
			superLabel: 'PescModel',
			properties: {
				name: re.name,
				description: re.documentation,
				sourceFile: re.source,
				baseType: '',
				derivation: '',
				isRootElement: true,
				fieldCount: re.hasInlineComplexType ? re.inlineElements.length : 0,
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
				ownerLabel: 'PescComplexType',
				source: re.source,
			});
		}
	});

	// ---- PHASE 4: counts + callback ----
	const labelCounts = {};
	let declaredEdges = 0;
	let parentEdges = 0;
	nodes.forEach((n) => {
		labelCounts[n.label] = (labelCounts[n.label] || 0) + 1;
		declaredEdges += (n.edges || []).length;
		if (n._parentEdge) {
			parentEdges++;
		}
	});

	console.error(`[forge-pesc/parser] native node counts: ${JSON.stringify(labelCounts)}`);
	console.error(
		`[forge-pesc/parser] total native nodes ${nodes.length}, declared edges ${declaredEdges}, parent edges ${parentEdges}`,
	);
	console.error(
		`[forge-pesc/parser] fields ${fieldCount}, option values ${optionValueCount}, ` +
			`subclass ${subclassEdges}, support-usage ${supportUsageEdges}, ` +
			`optionSet-usage ${optionSetUsageEdges}, references ${referencesEdges}, ` +
			`deduped duplicate definitions ${dedupedNodes}`,
	);
	console.error(
		`[forge-pesc/parser] parseAudit: ${parseAudit.unresolvedTypeRefs.length} unresolved type refs, ` +
			`${parseAudit.importDeclarationDrift.length} drifted import declarations, ` +
			`${parseAudit.trimmedEnumValues} trimmed enum values, ` +
			`${parseAudit.emptyEnumValuesSkipped} empty enum values skipped, ` +
			`${parseAudit.dedupedEnumValues} deduped enum values`,
	);

	callback('', {
		nodes,
		parseAudit,
		metadata: {
			version: '1.0',
			sourceFormat: 'xsd',
			sourceFiles: sourceFiles.map((s) => s.filename),
			complexTypeCount: allComplexTypes.length,
			simpleTypeCount: allSimpleTypes.length,
			groupCount: allGroups.length,
			rootElementCount: allRootElements.length,
			sourceFileCount: sourceFiles.length,
			fieldCount,
			optionValueCount,
			totalNodes: nodes.length,
		},
	});
};
