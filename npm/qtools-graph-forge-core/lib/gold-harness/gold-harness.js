'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// gold-harness.js — the PRODUCER-ACCURACY ground truth (Appendix A). Loads the Ed-Fi -> CEDS authored
// crosswalk as the measurement frame the inferred PIPELINE is gated against (recall@15, reranker-only
// rank-1, abstention) — exactly the frame EVAL-composedPipeline-062626 measured. Ed-Fi HAS an authored
// crosswalk, which is why it is the accuracy harness; the inferred track is then RUN on the crosswalk-less
// standards (no gold) at emit time. Gold join is 'P' + CEDSGlobalId.zfill(6) (the eval's join), NOT the
// source node's own cedsId (the forge per-node anchoring DIVERGES — carry-forward flag).
//
//   positives: CEDSMappingConfidence == 'Yes' rows -> { fromStableId, goldToken } (a correct CEDS target).
//   negatives: 'Not in CEDS' rows -> { fromStableId } (the source has NO CEDS match -> the pipeline should
//              ABSTAIN; abstention accuracy is measured over these).
// fromStableId convention = edfi:field/<EdFiEntity>.<EdFiElementName> (the same FROM Phase 4 resolves).
//
// Pure synchronous load via the edf-gate ground-truth loader. No async/await, no try/catch for control
// flow. camelCase only.
//
// @concept: [[GoldHarness]]
// @concept: [[GroundTruthFixtures]]

const path = require('path');

const GROUND_TRUTH = path.join(
	__dirname,
	'..',
	'..',
	'..',
	'..',
	'cli',
	'lib.d',
	'edf-gate',
	'lib',
	'ground-truth',
	'groundTruth',
);

// START OF moduleFunction() ============================================================

const moduleFunction = ({ moduleName } = {}) => () => {
	const loadGoldFrame = () => {
		const groundTruth = require(GROUND_TRUTH)();
		const fx = groundTruth.loadFixtures();
		const header = fx.elements.header;
		const entityCol = header.find((c) => /^EdFiEntity$/i.test(c));
		const nameCol = header.find((c) => /^EdFiElementName$/i.test(c));
		const gidCol = header.find((c) => /CEDSGlobalId/i.test(c));
		const confCol = header.find(
			(c) => /CEDSMappingConfidence/i.test(c) || /MappingConfidence/i.test(c),
		);

		const fromStableIdFor = (entity, elementName) => `edfi:field/${entity}.${elementName}`;
		const tokenFor = (globalId) => {
			const trimmed = `${globalId}`.trim();
			return trimmed === '' ? null : `P${trimmed.padStart(6, '0')}`;
		};

		const positives = [];
		const negatives = [];
		fx.elements.records.forEach((oneRecord) => {
			const conf = `${oneRecord[confCol]}`.trim().toLowerCase();
			const entity = `${oneRecord[entityCol]}`.trim();
			const elementName = `${oneRecord[nameCol]}`.trim();
			const fromStableId = fromStableIdFor(entity, elementName);
			if (conf === 'yes') {
				const goldToken = tokenFor(oneRecord[gidCol]);
				if (goldToken) {
					positives.push({ fromStableId, goldToken });
				}
			} else if (`${oneRecord[confCol]}`.trim() === 'Not in CEDS') {
				negatives.push({ fromStableId });
			}
		});

		return { positives, negatives };
	};

	return { loadGoldFrame };
};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
