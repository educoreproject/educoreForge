'use strict';

// ctdlHooks.js — the H2/H3 hook set for the CTDL forge bundle (ctdlHub-101926 P1): the shared CTDL-family hooks
// (lib/ctdl-family-forge/jsonLdVocabularyHooks.js) over this bundle's own vocabulary profile.

const path = require('path');
const vocabularyProfile = require('./ctdlVocabularyProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'ctdl-family-forge', 'jsonLdVocabularyHooks'))({ vocabularyProfile });
