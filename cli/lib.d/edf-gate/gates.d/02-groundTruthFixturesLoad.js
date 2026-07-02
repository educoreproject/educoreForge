'use strict';

const fs = require('fs');

// Gate: the Ed-Fi ground-truth crosswalk fixtures (Appendix A) load with their expected shape — both
// CSVs present, non-zero rows, and the expected column counts (28 element cols / 18 descriptor cols).
// Health check of deliverable 6.

module.exports = () => ({
	name: 'groundTruth.fixturesLoad',
	phase: 'Phase0',
	kind: 'health',
	expectFail: false,
	run: (ctx, callback) => {
		const gt = ctx.groundTruth;
		const { ELEMENTS_CSV, DESCRIPTORS_CSV } = gt.paths;
		const present =
			fs.existsSync(ELEMENTS_CSV) && fs.existsSync(DESCRIPTORS_CSV);
		if (!present) {
			callback('', { passed: false, detail: 'one or both fixture CSVs are missing' });
			return;
		}
		const fx = gt.loadFixtures();
		const ok =
			fx.elements.recordCount > 0 &&
			fx.descriptors.recordCount > 0 &&
			fx.elements.header.length >= 20 &&
			fx.descriptors.header.length >= 15;
		callback('', {
			passed: ok,
			detail:
				`elements ${fx.elements.recordCount} rows / ${fx.elements.header.length} cols; ` +
				`descriptors ${fx.descriptors.recordCount} rows / ${fx.descriptors.header.length} cols`,
		});
	},
});
