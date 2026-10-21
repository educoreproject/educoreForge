'use strict';

// cedsHubEdgeDefinitions.js — the CEDS hub's own definitions of its decomposition edges, HAS_CEDS_<SLOT> (R5 S7, 2026-10-21).
// They lived in lib/vocabulary/vocabulary-definitions.js (kept there by RULING FJ-P2-1 when the CEDS_HUB_EDGE_TYPES constant
// was deleted); a hub's account of its own edges belongs to the hub. Declared by parserDescriptor.ini
// edgeDefinitionDeclaration=, collected by the forger (hubEdgeDefinitionByHubNameFor) and read by the schema-view finisher,
// which uses a declared text before its generated sentence. The texts are the kept ones, byte for byte: they are the
// schema view's member descriptions on every graph holding this hub (graph-only, written at finish; no block reads them).
// Keyed by slot (vocabulary HUB_DECOMPOSITION_SLOTS / HUB_TERM_DECOMPOSITION_SLOTS); a slot this hub does not mint is absent.

module.exports = Object.freeze({
	hubName: 'CEDS',
	edgeDefinitionBySlot: Object.freeze({
		DOMAIN: 'CEDS instantiation of the domain decomposition slot: HubReference to the CEDS class it addresses.',
		PROPERTY: 'CEDS instantiation of the property decomposition slot: HubReference to the CEDS property it addresses.',
		RANGE: 'CEDS instantiation of the range decomposition slot: HubReference to the CEDS option set or class forming its range.',
		VALUE: 'CEDS instantiation of the value decomposition slot: HubReference to the CEDS option value it addresses (value tier).',
		QUALIFIER: 'CEDS instantiation of the qualifier decomposition slot.',
	}),
});
