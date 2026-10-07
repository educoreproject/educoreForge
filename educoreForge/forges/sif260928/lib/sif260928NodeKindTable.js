'use strict';

// sif260928NodeKindTable.js — the ROLE TABLE: each kind of node this forge mints, with its
// per-standard label and its DME role. This is data, and the walk (A1c onward) looks every node
// up here rather than choosing a label or role itself.
//
// The roles are ruled (EBONY_DREAM, review #9; PLAN §3 A1a):
//   Object → DmeClass, Question → DmeProperty, Field → DmeInstance (⟪campaign P3, W-B-12 (a)⟫ was DmeSupport),
//   Container → DmeSupport,
//   Codeset → DmeOptionSet, CodesetValue → DmeOptionValue.
// Roles decide both texts and node vectors (the framework keys embedTextDeclaration and
// nonEmbeddableRoleList by role), which is why Field sits in DmeInstance (non-embeddable) rather than DmeProperty:
// only Questions and Objects get texts and node vectors (SPEC §9 A1).
//
// The labels carry the Sif260928 prefix because bare 'Field' or 'Question' would collide with
// another standard's nodes in a combined graph, and no code enforces a prefix (SPEC §9 A8).

const path = require('path');
const { DME_ROLES } = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));

const SIF260928_NODE_KIND_TABLE = Object.freeze({
	object: Object.freeze({ perStandardLabel: 'Sif260928Object', role: DME_ROLES.CLASS }),
	question: Object.freeze({ perStandardLabel: 'Sif260928Question', role: DME_ROLES.PROPERTY }),
	field: Object.freeze({ perStandardLabel: 'Sif260928Field', role: DME_ROLES.INSTANCE }),
	container: Object.freeze({ perStandardLabel: 'Sif260928Container', role: DME_ROLES.SUPPORT }),
	codeset: Object.freeze({ perStandardLabel: 'Sif260928Codeset', role: DME_ROLES.OPTION_SET }),
	codesetValue: Object.freeze({ perStandardLabel: 'Sif260928CodesetValue', role: DME_ROLES.OPTION_VALUE }),
});

module.exports = SIF260928_NODE_KIND_TABLE;
