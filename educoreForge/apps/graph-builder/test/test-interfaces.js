#!/usr/bin/env node
'use strict';

// test-interfaces.js — the formal contracts of interfaces.js, ENFORCED. polyArch2 requires
// declared interfaces so implementations cannot drift; this suite is what gives the declaration
// teeth: every component implementation — the REAL modules AND the stub-era ones the -build
// pipeline runs on — must expose EXACTLY the declared method set. A half-implemented component,
// a renamed method, or a stub that forgot to grow with the contract turns this suite red.
//
// Run: node apps/graph-builder/test/test-interfaces.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- enforce the formal component contracts declared in interfaces.js

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Instantiates every component implementation (real modules and stub-components) and holds
     each to EXACTLY the method set COMPONENT_SHAPES declares — nothing missing, nothing extra,
     everything callable. Proven in the failure direction too: a deliberately-drifted shape is
     shown to be caught.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const { COMPONENT_SHAPES } = require('../interfaces');

const realComponents = {
	forger: require('../apps/forger'),
	replayManager: require('../apps/replay-manager'),
	bridgeMaker: require('../apps/bridge-maker'),
	manifestEditor: require('../apps/manifest-editor'),
};
const stubComponents = require('../lib/stub-components');

// conformance verdict for one instance against one declared shape: '' = conforms.
const shapeViolation = (instance, declaredMethods) => {
	if (!instance || typeof instance !== 'object') {
		return `not an object: ${typeof instance}`;
	}
	const actual = Object.keys(instance).sort();
	const declared = declaredMethods.slice().sort();
	const missing = declared.filter((oneName) => typeof instance[oneName] !== 'function');
	const extra = actual.filter((oneName) => !declared.includes(oneName));
	if (missing.length) {
		return `missing/not-a-function: ${missing.join(', ')}`;
	}
	if (extra.length) {
		return `undeclared extras: ${extra.join(', ')}`;
	}
	return '';
};

// =====================================================================
harness.section('DECLARATION — interfaces.js is present and names every component');
// =====================================================================

harness.equal(
	'COMPONENT_SHAPES declares exactly the four components build.js wires',
	Object.keys(COMPONENT_SHAPES).sort().join(','),
	'bridgeMaker,forger,manifestEditor,replayManager',
);

// =====================================================================
harness.section('CONFORMANCE — every implementation matches its declared shape EXACTLY');
// =====================================================================

Object.keys(COMPONENT_SHAPES).forEach((oneComponentName) => {
	const declared = COMPONENT_SHAPES[oneComponentName];
	harness.equal(
		`REAL ${oneComponentName}() conforms ({${declared.join(', ')}})`,
		shapeViolation(realComponents[oneComponentName](), declared),
		'',
	);
	harness.equal(
		`STUB ${oneComponentName}() conforms identically`,
		shapeViolation(stubComponents[oneComponentName](), declared),
		'',
	);
});

// =====================================================================
harness.section('THE GATE BITES — drifted shapes are caught (failure side proven)');
// =====================================================================

harness.match(
	'a missing method is caught and named',
	shapeViolation({ create: () => {}, delete: () => {} }, COMPONENT_SHAPES.replayManager),
	/missing.*extract/,
);
harness.match(
	'an undeclared extra method is caught and named',
	shapeViolation({ forge: () => {}, sneakyExtra: () => {} }, COMPONENT_SHAPES.forger),
	/undeclared extras: sneakyExtra/,
);
harness.match(
	'a method that is not a function is caught',
	shapeViolation({ forge: 'not a function' }, COMPONENT_SHAPES.forger),
	/missing\/not-a-function: forge/,
);
harness.match('a non-object is caught', shapeViolation(undefined, COMPONENT_SHAPES.forger), /not an object/);

harness.report();
