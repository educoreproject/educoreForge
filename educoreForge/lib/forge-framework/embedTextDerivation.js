'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// embedTextDerivation.js — deriveEmbedTextGraph({ nodes, embedTextDeclaration, kit }): the framework
// mints one DmeEmbedText node per DISTINCT text a bundle declares, and one EMBEDS_TEXT_OF edge per
// distinct (text node, source node) pair (PLAN-forgeEmbedText §8.3 R-ET-1, R-ET-2, R-ET-4, R-ET-16;
// §8.4 R-ET-28, R-ET-29).
//
// Called by forge-framework.js buildContractGraph AFTER the walk's origin/completeness check and
// BEFORE the universal post-mutation checks, with the walk's returned nodes. Every node and edge is
// created through the kit, so text nodes pass the integrity pass, the finalizers and the census like
// any walk node.
//
// With embedTextDeclaration null it mints nothing and returns an EMPTY report, so no embedText*
// property reaches `stats` (R-ET-23). Otherwise:
//   pass 1 (read only), over `nodes` in emission order, for each node whose role has a declared
//   property list, for each listed property in list order:
//     undefined / null                    → counted (embedTextAbsentCount), skipped
//     a string                            → one value
//     an array                            → each element is one value, in order; [] refused; an
//                                           element that is not a string (a nested array included)
//                                           refused
//     anything else                       → refused
//     a value containing NUL (U+0000)     → refused (the vector sidecar refuses NUL at harvest)
//     text = value.trim()                 → the DECLARED identity rule; empty → counted
//                                           (embedTextSkippedEmptyCount), skipped; a non-empty text
//                                           that differs from its value → counted (embedTextTrimmedCount)
//   pass 2 (mint): stableId = rootStableId + ('/' unless the root already ends with '/') +
//   'embedText/' + sha256hex(text); text nodes minted in ascending stableId order, carrying ONLY
//   { text, embedSourceProperty: 'text', vectorPropertyName: 'textEmbedding' } beyond what the kit
//   stamps (no name, no description, no searchText); then edges in ascending (from, to) order, each
//   carrying propertyNameList — the sorted, unique source property names of that pair.
//
// PURE and synchronous: no I/O, no clock, no xLog. Throws named Errors inside the pure layer.

const crypto = require('crypto');
const path = require('path');
const { DME_ROLES, EDGE_TYPES, EMBED_TEXT_VECTOR } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require('./refuse');

const EMBED_TEXT_PATH_SEGMENT = 'embedText/';
const EMBED_TEXT_PROPERTY_NAME = 'text';
const EMBED_TEXT_ORIGIN = 'embedTextDerivation';
const NUL_CHARACTER = String.fromCharCode(0);
const NULL_DECLARATION_REPORT = Object.freeze({});

const isPlainObject = (candidate) =>
	candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);

const compareStrings = (leftText, rightText) => (leftText < rightText ? -1 : leftText > rightText ? 1 : 0);

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// valueListFor — the values one listed property contributes, or a named refusal
const valueListFor = ({ rawValue, sourceStableId, propertyName }) => {
	if (typeof rawValue === 'string') {
		return [rawValue];
	}
	if (!Array.isArray(rawValue)) {
		throw refuse.byName({ moduleName, what: `node '${sourceStableId}' property '${propertyName}' is a ${typeof rawValue}, not a string or a list of strings`, where: 'declare only text-valued properties in embedTextDeclaration.textPropertyListByRole' });
	}
	if (rawValue.length === 0) {
		throw refuse.byName({ moduleName, what: `node '${sourceStableId}' property '${propertyName}' is an EMPTY list`, where: 'an empty list is not absence; the walk omits the property when it has no value' });
	}
	const nonStringElementIndex = rawValue.findIndex((oneElement) => typeof oneElement !== 'string');
	if (nonStringElementIndex !== -1) {
		throw refuse.byName({ moduleName, what: `node '${sourceStableId}' property '${propertyName}' element ${nonStringElementIndex} is ${Array.isArray(rawValue[nonStringElementIndex]) ? 'a NESTED list' : `a ${typeof rawValue[nonStringElementIndex]}`}, not a string`, where: 'a list-valued text property holds strings only' });
	}
	return rawValue;
};

const deriveEmbedTextGraph = ({ nodes, embedTextDeclaration, kit } = {}) => {
	if (!Array.isArray(nodes)) {
		throw refuse.byName({ moduleName, what: `deriveEmbedTextGraph: nodes is ${typeof nodes}, not an array`, where: "pass the walk's returned node array" });
	}
	if (embedTextDeclaration === undefined) {
		throw refuse.byName({ moduleName, what: 'deriveEmbedTextGraph: embedTextDeclaration is undefined', where: 'pass the validated declaration value: null, or { embedTextLabel, textPropertyListByRole }' });
	}
	if (!isPlainObject(kit) || typeof kit.makeNode !== 'function' || typeof kit.addEdge !== 'function') {
		throw refuse.byName({ moduleName, what: 'deriveEmbedTextGraph: kit is not a contract-graph kit', where: 'pass the kit buildContractGraph created for this invocation' });
	}
	if (embedTextDeclaration === null) {
		return NULL_DECLARATION_REPORT;
	}
	const rootStableId = kit.rootStableId;
	if (typeof rootStableId !== 'string' || rootStableId.length === 0) {
		throw refuse.byName({ moduleName, what: `deriveEmbedTextGraph: kit.rootStableId is ${JSON.stringify(rootStableId)}`, where: 'the framework registers the root before the walk; derive after it' });
	}
	const { embedTextLabel, textPropertyListByRole } = embedTextDeclaration;

	// pass 1 — occurrences (text, source node, property), counted, nothing minted
	let embedTextAbsentCount = 0;
	let embedTextSkippedEmptyCount = 0;
	let embedTextTrimmedCount = 0;
	const occurrenceList = [];
	nodes.forEach((oneNode) => {
		if (!Object.prototype.hasOwnProperty.call(textPropertyListByRole, oneNode.role)) {
			return;
		}
		textPropertyListByRole[oneNode.role].forEach((onePropertyName) => {
			const rawValue = oneNode.properties[onePropertyName];
			if (rawValue === undefined || rawValue === null) {
				embedTextAbsentCount += 1;
				return;
			}
			valueListFor({ rawValue, sourceStableId: oneNode.stableId, propertyName: onePropertyName }).forEach((oneValue) => {
				if (oneValue.indexOf(NUL_CHARACTER) !== -1) {
					throw refuse.byName({ moduleName, what: `node '${oneNode.stableId}' property '${onePropertyName}' contains the NUL character (U+0000)`, where: 'the vector sidecar refuses NUL at harvest; clean the source text in the walk or omit the property' });
				}
				const text = oneValue.trim();
				if (text.length === 0) {
					embedTextSkippedEmptyCount += 1;
					return;
				}
				if (text !== oneValue) {
					embedTextTrimmedCount += 1;
				}
				occurrenceList.push({ text, sourceStableId: oneNode.stableId, propertyName: onePropertyName });
			});
		});
	});

	// pass 2 — identity, then mint in ascending stableId order
	const stableIdJoinText = rootStableId.endsWith('/') ? '' : '/';
	const identifiedOccurrenceList = occurrenceList.map((oneOccurrence) => ({
		...oneOccurrence,
		textStableId: `${rootStableId}${stableIdJoinText}${EMBED_TEXT_PATH_SEGMENT}${sha256Hex(oneOccurrence.text)}`,
	}));
	const textByTextStableId = {};
	const propertyNameListByPairIdentity = {};
	const pairByPairIdentity = {};
	identifiedOccurrenceList.forEach((oneOccurrence) => {
		textByTextStableId[oneOccurrence.textStableId] = oneOccurrence.text;
		const pairIdentityText = JSON.stringify([oneOccurrence.textStableId, oneOccurrence.sourceStableId]);
		if (pairByPairIdentity[pairIdentityText] === undefined) {
			pairByPairIdentity[pairIdentityText] = { textStableId: oneOccurrence.textStableId, sourceStableId: oneOccurrence.sourceStableId };
			propertyNameListByPairIdentity[pairIdentityText] = [];
		}
		if (propertyNameListByPairIdentity[pairIdentityText].indexOf(oneOccurrence.propertyName) === -1) {
			propertyNameListByPairIdentity[pairIdentityText].push(oneOccurrence.propertyName);
		}
	});

	const textStableIdList = Object.keys(textByTextStableId).sort(compareStrings);
	textStableIdList.forEach((oneTextStableId) => {
		kit.makeNode({
			role: DME_ROLES.EMBED_TEXT,
			perStandardLabel: embedTextLabel,
			stableId: oneTextStableId,
			structural: { parentId: rootStableId, path: oneTextStableId.slice(rootStableId.length + stableIdJoinText.length) },
			carriedProperties: {
				[EMBED_TEXT_PROPERTY_NAME]: textByTextStableId[oneTextStableId],
				embedSourceProperty: EMBED_TEXT_PROPERTY_NAME,
				vectorPropertyName: EMBED_TEXT_VECTOR.propertyName,
			},
			origin: EMBED_TEXT_ORIGIN,
		});
	});

	const pairIdentityList = Object.keys(pairByPairIdentity).sort((leftIdentity, rightIdentity) =>
		compareStrings(pairByPairIdentity[leftIdentity].textStableId, pairByPairIdentity[rightIdentity].textStableId) ||
		compareStrings(pairByPairIdentity[leftIdentity].sourceStableId, pairByPairIdentity[rightIdentity].sourceStableId),
	);
	pairIdentityList.forEach((onePairIdentity) => {
		kit.addEdge({
			edgeType: EDGE_TYPES.EMBEDS_TEXT_OF,
			fromStableId: pairByPairIdentity[onePairIdentity].textStableId,
			toStableId: pairByPairIdentity[onePairIdentity].sourceStableId,
			edgeContext: `${EMBED_TEXT_ORIGIN} ${pairByPairIdentity[onePairIdentity].sourceStableId}`,
			edgeProperties: { propertyNameList: propertyNameListByPairIdentity[onePairIdentity].slice().sort(compareStrings) },
		});
	});

	return {
		embedTextNodeCount: textStableIdList.length,
		embedTextEdgeCount: pairIdentityList.length,
		embedTextSkippedEmptyCount,
		embedTextAbsentCount,
		embedTextTrimmedCount,
	};
};

module.exports = { deriveEmbedTextGraph, EMBED_TEXT_PATH_SEGMENT, EMBED_TEXT_PROPERTY_NAME, moduleName };
