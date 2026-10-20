'use strict';

// ctdlasnHooks.js — the H2/H3 hook set for the CTDLASN forge bundle (ctdlHub-101926 P2): the shared CTDL-family hooks
// (lib/ctdl-family-forge/jsonLdVocabularyHooks.js) over this bundle's own vocabulary profile.

const path = require('path');
const vocabularyProfile = require('./ctdlasnVocabularyProfile.json');

module.exports = () => require(path.join(__dirname, '..', '..', '..', 'lib', 'ctdl-family-forge', 'jsonLdVocabularyHooks'))({ vocabularyProfile });
