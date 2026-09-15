'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// frameworkNonEmbeddableRoles.js — the framework-owned half of non-embeddability (R-ET-3).
//
// A bundle declares its own nonEmbeddableRoleList (CEDS: edit history, restrictions, vocabulary
// terms). The framework adds the roles it OWNS: today exactly DmeEmbedText, whose nodes the
// framework mints itself (embedTextDerivation.js) and whose text is embedded by its own pass
// (embedTextPass.js) under `textEmbedding`, never through the legacy `searchText` pass.
//
// effectiveNonEmbeddableRoleList is the ONE place the union is computed. Its three callers:
//   contractGraphKit.js makeNode      — no searchText is built for such a role (the search-text
//                                       builder has no segment builder for DmeEmbedText and throws)
//   forge-framework.js integrity pass — no searchText is demanded of such a role
//   embedPass.js embedNodes           — such a role never reaches embedTexts through the legacy pass
// No caller concatenates the lists itself. A bundle that LISTS a framework-owned role is refused at
// injection (forgeDeclarationContract.js kind 'nonEmbeddableRoleList').
//
// PURE. Throws a named Error on a non-array input.

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
const refuse = require('./refuse');

const FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST = Object.freeze([DME_ROLES.EMBED_TEXT]);

const effectiveNonEmbeddableRoleList = ({ nonEmbeddableRoleList } = {}) => {
	if (!Array.isArray(nonEmbeddableRoleList)) {
		throw refuse.byName({
			moduleName,
			what: `effectiveNonEmbeddableRoleList: nonEmbeddableRoleList is ${nonEmbeddableRoleList === null ? 'null' : `a ${typeof nonEmbeddableRoleList}`}, not an array`,
			where: "pass the declaration's nonEmbeddableRoleList (may be [])",
		});
	}
	return Object.freeze(nonEmbeddableRoleList.concat(FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST));
};

module.exports = { FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST, effectiveNonEmbeddableRoleList, moduleName };
