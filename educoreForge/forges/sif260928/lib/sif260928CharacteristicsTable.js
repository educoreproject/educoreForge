'use strict';

// sif260928CharacteristicsTable.js — the CLOSED TABLE of SIF Characteristics codes (SPEC §3.1,
// §9 A4). Each code gives the Field's derived obligation and repeatable. A non-empty cell that is
// not a row here is refused by name; an EMPTY cell (162 rows) means absent, and the loader derives
// neither property from it.
//
// This table reads the Characteristics column only. The Mandatory column ('*' or empty) is a
// separate source statement that the loader carries verbatim and never consults here: 119 rows
// carry '*' with an empty Characteristics cell and 9 carry '*' with 'C'.

const OBLIGATION = Object.freeze({ MANDATORY: 'mandatory', OPTIONAL: 'optional', CONDITIONAL: 'conditional' });

const CHARACTERISTICS_TABLE = Object.freeze({
	M: Object.freeze({ obligation: OBLIGATION.MANDATORY, repeatable: false }),
	MR: Object.freeze({ obligation: OBLIGATION.MANDATORY, repeatable: true }),
	O: Object.freeze({ obligation: OBLIGATION.OPTIONAL, repeatable: false }),
	OR: Object.freeze({ obligation: OBLIGATION.OPTIONAL, repeatable: true }),
	C: Object.freeze({ obligation: OBLIGATION.CONDITIONAL, repeatable: false }),
});

module.exports = Object.freeze({ OBLIGATION, CHARACTERISTICS_TABLE });
