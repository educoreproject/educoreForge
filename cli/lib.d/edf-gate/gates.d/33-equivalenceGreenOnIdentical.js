'use strict';

// Gate (positive): the GREEN case. Two identical FULL-mode manifests must compare byteIdentical,
// structurallyEquivalent, equivalent, regime='transport', with zero embedding divergence. This is the
// canonical "restored" state the fault gates (31/32) transition back to, asserted on its own so a
// GREEN is a positive claim, not merely the absence of a caught fault. In-memory; touches no graph.

module.exports = () => ({
	name: 'equivalence.greenOnIdentical',
	phase: 'Phase0',
	kind: 'positive',
	expectFail: false,
	run: (ctx, callback) => {
		const ge = ctx.resources.graphEquivalence;
		const fp = ctx.resources.fingerprinter;
		const { buildTwinManifest } = require('../lib/graph-equivalence/equivalenceTwinFixture');

		const verdict = ge.compareEquivalence({
			manifestA: buildTwinManifest(fp),
			manifestB: buildTwinManifest(fp),
		});

		const passed =
			verdict.byteIdentical === true &&
			verdict.equivalent === true &&
			verdict.structurallyEquivalent === true &&
			verdict.regime === 'transport' &&
			verdict.embeddingDivergentCount === 0;

		callback('', {
			passed,
			detail:
				`regime=${verdict.regime},byteIdentical=${verdict.byteIdentical},` +
				`structurallyEquivalent=${verdict.structurallyEquivalent},embeddingDivergentCount=${verdict.embeddingDivergentCount}`,
		});
	},
});
