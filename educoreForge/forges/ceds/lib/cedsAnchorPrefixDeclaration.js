'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// cedsAnchorPrefixDeclaration.js — how a CEDS anchor is written, declared by the CEDS bundle (R5 S2, 2026-10-21).
//
// A source standard whose own data carries CEDS ids (the old SIF forge's 'CEDS ID' column) normalizes them through the forge
// kit's hub-generic hubAnchorValue({ hubToken: 'ceds', kind, rawValue }). The kit knows no hub: the forger collects every
// bundle's declaration named by `anchorPrefixDeclaration=` in its parserDescriptor.ini into a hubToken -> declaration map
// and hands it to each bundle. The prefixes are this bundle's own normalizer's (normalize.js rolePrefixByKind), so the
// forge's own cedsId and a source forge's anchor can never disagree. Pure data; never on a node.

const path = require('path');
const { rolePrefixByKind } = require(path.join(__dirname, 'normalize'));

module.exports = Object.freeze({
	hubToken: 'ceds',
	anchorPrefixByKind: Object.freeze({ ...rolePrefixByKind }),
	anchorDigitCount: 6,
	moduleName,
});
