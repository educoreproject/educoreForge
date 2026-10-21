'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// ctdlHubHooks.js — H2 for the CTDL hub role (ctdlHub-101926 P4). PRESENT AND EMPTY, as CEDS's is.
//
// The second real hub needs no method: the two places CTDL differs from CEDS (domains as edges, ranges as meaning) are
// DECLARED (domainAddressing, rangeAddressing in lib/ctdlHubDeclaration.js), not hooked. That is the finding the hooks seam
// was built to record. If a later CTDL release needs a hook, the work order's rule holds: stop and report, do not add one.

// START OF moduleFunction() ============================================================

const moduleFunction = ({ moduleName } = {}) => () => ({});

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
