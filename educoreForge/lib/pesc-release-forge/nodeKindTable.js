'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// nodeKindTable.js — the ROLE TABLE of the PESC release forge (DESIGN-pescForge.md §2.1), as data:
// each kind of node the walk mints, the label suffix it carries and its DME role. The walk looks
// every node up here and never chooses a label or role itself.
//
//   NODE_KIND_SUFFIX_TABLE                  kind → { labelSuffix, role }
//   buildNodeKindTable({ labelPrefix })     kind → { perStandardLabel, role }, labels prefixed
//
// The prefix is the bundle's declared labelPrefix (PescCollegeTranscript1v8v0), so two releases sit
// in one graph without colliding (no code enforces a prefix; SIF rebuild SPEC §9 A8). The root is
// not in the table: the framework mints it from the declaration's rootLabel.
//
// Roles decide texts and node vectors (the declaration keys embedTextDeclaration and
// nonEmbeddableRoleList by role). The occurrence is DmeSupport, as SIF's Field is (QUIET_ORBIT
// ruling 3A.3): it carries no text and no vector, and the lever to make it DmeProperty is this one
// row, TQ's to pull.

const path = require('path');
const refuse = require(path.join(__dirname, '..', 'forge-framework', 'refuse'));
const { DME_ROLES } = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));

const NODE_KIND_SUFFIX_TABLE = Object.freeze({
	releaseRecord: Object.freeze({ labelSuffix: 'Release', role: DME_ROLES.SUPPORT }),
	schemaFile: Object.freeze({ labelSuffix: 'SchemaFile', role: DME_ROLES.SUPPORT }),
	type: Object.freeze({ labelSuffix: 'Type', role: DME_ROLES.CLASS }),
	anonymousType: Object.freeze({ labelSuffix: 'AnonymousType', role: DME_ROLES.CLASS }),
	element: Object.freeze({ labelSuffix: 'Element', role: DME_ROLES.PROPERTY }),
	attribute: Object.freeze({ labelSuffix: 'Attribute', role: DME_ROLES.PROPERTY }),
	globalElement: Object.freeze({ labelSuffix: 'GlobalElement', role: DME_ROLES.PROPERTY }),
	occurrence: Object.freeze({ labelSuffix: 'Occurrence', role: DME_ROLES.SUPPORT }),
	codeList: Object.freeze({ labelSuffix: 'CodeList', role: DME_ROLES.OPTION_SET }),
	code: Object.freeze({ labelSuffix: 'Code', role: DME_ROLES.OPTION_VALUE }),
	dataType: Object.freeze({ labelSuffix: 'DataType', role: DME_ROLES.SUPPORT }),
	group: Object.freeze({ labelSuffix: 'Group', role: DME_ROLES.SUPPORT }),
});

const LABEL_PREFIX_RE = /^Pesc[A-Za-z]+\d+v\d+v\d+$/;

const buildNodeKindTable = ({ labelPrefix }) => {
	if (typeof labelPrefix !== 'string' || !LABEL_PREFIX_RE.test(labelPrefix)) {
		throw refuse.byName({ moduleName, what: `labelPrefix is ${JSON.stringify(labelPrefix)}`, where: `a release label prefix matches ${LABEL_PREFIX_RE} (Pesc + the standard + the version, e.g. PescCollegeTranscript1v8v0)` });
	}
	const nodeKindTable = {};
	Object.keys(NODE_KIND_SUFFIX_TABLE).forEach((oneKind) => {
		nodeKindTable[oneKind] = Object.freeze({ perStandardLabel: `${labelPrefix}${NODE_KIND_SUFFIX_TABLE[oneKind].labelSuffix}`, role: NODE_KIND_SUFFIX_TABLE[oneKind].role });
	});
	return Object.freeze(nodeKindTable);
};

module.exports = { NODE_KIND_SUFFIX_TABLE, buildNodeKindTable, LABEL_PREFIX_RE, moduleName };
