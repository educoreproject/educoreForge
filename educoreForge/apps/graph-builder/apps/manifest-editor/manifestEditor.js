'use strict';

/** @implements {ManifestEditorComponent} — formal contract declared in
 *  apps/graph-builder/interfaces.js; enforced by test-interfaces. */

// manifestEditor (STUB) — composes a manifest from block references (compose-by-selection).
// In-process module; synchronous accumulator per the graphBuilder pseudocode.
//
//   manifestEditor() -> { init(name, recipe) -> manifestHandle }
//   manifestHandle: {
//     add(key, kind, blockRef) -> memberCount,   // key = standardName@version | pair@versionKey
//     id() -> manifestId,
//     members() -> [ { key, kind, blockRef } ],
//     recipeName() -> string                       // the recipe reference held for provenance
//   }
//
// The real manifestEditor persists the manifest into the store and remembers which recipe built it.
// The stub keeps members in memory and mints a placeholder manifest id.

let seq = 0;

const manifestEditor = () => {
	const init = (name, recipe) => {
		seq += 1;
		const manifestId = `stub-manifest:${name || 'unnamed'}:${seq}`;
		const members = [];
		const recipeName = recipe && recipe.recipeName ? recipe.recipeName : name;
		return {
			add: (key, kind, blockRef) => {
				members.push({ key, kind, blockRef });
				return members.length;
			},
			id: () => manifestId,
			members: () => members.slice(),
			recipeName: () => recipeName,
		};
	};
	return { init };
};

module.exports = manifestEditor;
