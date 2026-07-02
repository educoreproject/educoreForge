'use strict';

const path = require('path');

// Phase-7 standing gate (the PRODUCER-TIME schema validator, POSITIVE side — the existence enforcement).
// On Neo4j Community edition property-EXISTENCE constraints are unavailable (Enterprise-only), so "required
// properties exist" cannot be a DB constraint — THIS gate is the build's existence enforcement: it runs the
// schema-validator over EVERY block in the gating manifest and REDs if any block carries an off-schema
// element (missing :ForgedNode label / missing stableId / a HubReference|HubDefinition missing a required
// property / a bad provenanceTier|SKOS|SSSOM enum / a malformed edge type). The validator's contract was
// verified to hold with ZERO violations over the conformant gating golden's 32 blocks before this gate was
// enforced. Blocks (producer output) are unchanged by the finishing phase (the manifest carries no schema),
// so this gate is independent of the finisher re-freeze and is ENFORCED immediately.
//
// Its TWIN is gate 24 (synthetic off-schema block -> the validator flags it), proving the gate bites.
// Streams block-by-block (load -> validate -> free) to bound memory over the full ~105k-node golden.

const CORE_LIB = path.join(__dirname, '..', '..', '..', '..', 'npm', 'qtools-graph-forge-core', 'lib');
const replayBlock = require(path.join(CORE_LIB, 'replay', 'replay-block'));
const vocabulary = require(path.join(CORE_LIB, 'vocabulary', 'vocabulary'));
const validatorFactory = require(path.join(CORE_LIB, 'schema-validator', 'schema-validator'));

module.exports = () => ({
	name: 'schemaValidator.goldenBlocksConformant',
	phase: 'Phase7',
	kind: 'positive',
	expectFail: false, // ENFORCED immediately — block-level + baseline-independent; verified 0 violations
	run: (ctx, callback) => {
		const { forgeStore } = ctx.resources;
		const manifestKey = ctx.manifestKey;
		if (!manifestKey) {
			callback('', {
				passed: false,
				detail: 'schemaValidator gate requires --manifest (the gating manifest) to read golden blocks',
			});
			return;
		}
		const validator = validatorFactory({ vocabulary });

		forgeStore.getManifest({ manifestKey }, (err, manifest) => {
			if (err || !manifest) {
				callback('', { passed: false, detail: `getManifest error: ${err || 'no manifest'}` });
				return;
			}
			const members = manifest.members || [];
			let totalNodes = 0;
			let totalEdges = 0;
			const violations = [];
			let i = 0;

			const next = () => {
				if (i >= members.length) {
					const passed = violations.length === 0;
					const sample = violations
						.slice(0, 3)
						.map((oneV) => `${oneV.code}@${oneV.element}`)
						.join('; ');
					callback('', {
						passed,
						detail: `validated ${members.length} block(s): ${totalNodes} node(s)/${totalEdges} edge(s); violations=${violations.length}${sample ? ` [${sample}]` : ''} (REQUIRED: 0 — every block element on-schema)`,
					});
					return;
				}
				const oneMember = members[i++];
				forgeStore.getBlock({ blockId: oneMember.blockId }, (blockErr, row) => {
					if (blockErr || !row) {
						callback('', {
							passed: false,
							detail: `getBlock '${oneMember.blockId}' error: ${blockErr || 'missing'}`,
						});
						return;
					}
					const text = Buffer.isBuffer(row.text) ? row.text.toString('utf8') : `${row.text}`;
					const parsed = replayBlock.deserializeBlock(text);
					const result = validator.validateBlock(parsed);
					totalNodes += result.counts.nodes;
					totalEdges += result.counts.edges;
					result.violations.forEach((oneV) => violations.push(oneV));
					next(); // block freed when `parsed`/`text`/`row` go out of scope on the next tick
				});
			};
			next();
		});
	},
});
