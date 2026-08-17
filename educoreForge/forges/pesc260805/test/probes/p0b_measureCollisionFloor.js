#!/usr/bin/env node
// RETAINED DELIBERATELY, AND THE REASON IS A CRITICISM THIS BUILDER LEVELLED AT SOMEONE ELSE.
// DEVLOG-P-pescBridge.md §4 records that the P0 composition test spent 2,621 embedding texts whose
// script and texts were NOT retained, so its winning composition can never be checked byte-for-byte
// against what the forge later emitted. Reporting figures from a script in a scratchpad that gets
// deleted would have been the same failure one order later. So the measurement tools behind the
// numbers in that DEVLOG live here.
//
// THIS IS A MEASUREMENT TOOL, NOT A GATE. No suite runs it, it declares no assertions, and it
// contributes no label to test/redEvidenceLedger.json. Do not read a clean run as certification.
//
// CONNECTION DETAILS GO STALE: any bolt port or password below belonged to a container that existed
// on 2026-08-17 and does not now. Re-resolve with `docker inspect` before re-running; the hub cards
// come from whichever container currently holds the CEDS hub.
'use strict';

// measureCollisionFloor.js — AZURE_DELTA (P0b). RE-MEASURES THE §13 COLLISION ERROR FLOOR ON THE
// VECTORS THE FORGE ACTUALLY EMITS, as SABLE_RIVER ordered: "the winning composition was chosen on
// text embedded by a measurement script, not by the forge — if the forge's own emission differs in
// any way (whitespace, separator, field order, truncation), the winner was measured on something the
// pipeline will never produce."
//
// THE METRIC, and it is verified against the report's own arithmetic before being trusted:
//   collision error floor = (scoredConcepts - distinctTop1Cards) / scoredConcepts
//   Check against REPORT §13.1: C0 had 263 distinct top-1 over 769 -> (769-263)/769 = 0.6580 EXACT;
//   C2 had 348 -> (769-348)/769 = 0.5475 EXACT. The formula reproduces both published figures, so it
//   is the report's formula and not a plausible substitute for it.
//
// WHAT THIS CAN AND CANNOT COMPARE — stated before any number, because the temptation is to present
// this as a like-for-like check against 0.5475 and IT IS NOT ONE:
//   * §13 scored 769 concepts: 369 control representatives plus a 400-concept sample under seed
//     'pescP0-composition-260817'. THAT SAMPLE CANNOT BE REPRODUCED. The measurement script is not on
//     disk, the seeding algorithm is not documented, and the cache holds none of its texts (the only
//     cache entries created today are this build's 1,611). So a figure computed here is NOT
//     comparable to 0.5475 as the same quantity.
//   * WHAT IS COMPARABLE, and is the stronger test anyway: OLD versus NEW over an IDENTICAL,
//     REPRODUCIBLE population, with the old text scored exactly as the forge used to emit it. That
//     answers "did the change help, on what the pipeline actually produces" without borrowing the
//     report's population.
//
// THE OLD VECTORS COST NOTHING. Every pre-change searchText is already in the shared vector cache
// from the original build, so the before-side is a cache read, not a spend. Zero embedding calls.
//
// THE TWO ARMS ARE REPORTED SEPARATELY AND NEVER POOLED (binding constraint 2). A whole-population
// figure IS printed for the OLD-vs-NEW comparison because there the two sides are the same
// population under one composition each; the per-arm figures are printed beside it and no
// cross-arm mean is computed anywhere.

const path = require('path');
const crypto = require('crypto');
const Database = require(
	'/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/better-sqlite3',
);
const neo4j = require(
	'/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/node_modules/neo4j-driver',
);

process.global = process.global || {};
process.global.xLog = process.global.xLog || {
	status: () => {},
	error: (message) => console.error(message),
	result: () => {},
	verbose: () => {},
};

const BUNDLE_DIR =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/forges/pesc260805';
const SNAPSHOT_DIR = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
const CACHE_PATH =
	'/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3';
const HUB_BOLT = 'bolt://localhost:7817';
const HUB_AUTH = neo4j.auth.basic('neo4j', 'LPnzVJjt3JkBeIzH4dUeeRrQ');
const EMBEDDING_MODEL_VERSION = 'voyage-4-large';
const EMBEDDING_DIMS = 1024;

const textHashOf = (text) => crypto.createHash('sha256').update(`${text}`, 'utf8').digest('hex');
const decodeVector = (vectorBase64) => {
	const buffer = Buffer.from(vectorBase64, 'base64');
	return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
};
const cleanOneSegment = (value) => {
	if (value == null) {
		return null;
	}
	const trimmed = `${value}`.trim();
	return trimmed === '' ? null : trimmed;
};

const bundle = require(path.join(BUNDLE_DIR, 'forgePesc260805'))({ embedder: null });

bundle.forge({ sourcePath: SNAPSHOT_DIR, skipEmbedding: true }, (forgeError, forged) => {
	if (forgeError) {
		console.error(`FORGE ERROR: ${forgeError}`);
		process.exit(1);
	}
	const { nodes, edges } = forged;

	const nodeByStableId = {};
	nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
	});
	const resolvesToTargetsByFromStableId = {};
	edges.forEach((oneEdge) => {
		if (oneEdge.type !== 'RESOLVES_TO') {
			return;
		}
		(resolvesToTargetsByFromStableId[oneEdge.fromRef.id] =
			resolvesToTargetsByFromStableId[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
	});

	// ---- the subject population: source-tier PescElementDecl only. Attributes are EXCLUDED here
	// because §13's evidence base is element declarations and folding 84 outside-the-evidence nodes
	// into the headline metric would be exactly the pooling the standing rule forbids.
	const sourceElementDecls = nodes.filter(
		(oneNode) =>
			oneNode.labels.indexOf('PescElementDecl') !== -1 && oneNode.properties.pescTier === 'source',
	);

	// ---- reconstruct the PRE-CHANGE text, and VALIDATE the reconstruction where the answer is known.
	// The old composition was `OwningType | ElementName` for every declaration. The 5,114 no-prose
	// declarations still carry exactly that text today (the C0 arm delegates to the shared composer),
	// so they are a population where the reconstruction can be CHECKED rather than trusted. Only if
	// it matches there is it applied to the 11,907 whose text changed.
	// FIRST ATTEMPT WAS WRONG AND THE VALIDATION CAUGHT IT — recorded rather than quietly corrected,
	// because it is the exact hazard that made the production pass carry the composer input forward
	// instead of rebuilding it here. 111 of 4,847 checked declarations mismatched: children of an
	// ANONYMOUS type. The anon node's DISPLAY name is `AdmissionsApplication (inline complexType)`,
	// but the name the composer was handed as owningClassName is the anon's OWNER name,
	// `AdmissionsApplication`. Reading the parent's `name` therefore reconstructs a string the forge
	// never emitted. The suffix is stripped by the same rule emitAnonymousType uses to build it.
	const ANONYMOUS_DISPLAY_SUFFIX = / \(inline [^)]*\)$/;
	const reconstructOldText = (oneNode) => {
		const parentNode = nodeByStableId[oneNode.properties.parentId];
		const owningName =
			parentNode === undefined
				? null
				: `${parentNode.properties.name}`.replace(ANONYMOUS_DISPLAY_SUFFIX, '');
		return [owningName, oneNode.properties.name]
			.map(cleanOneSegment)
			.filter((one) => one != null)
			.join(' | ');
	};

	const effectiveDescriptionOf = (oneNode) => {
		const own = cleanOneSegment(oneNode.properties.description);
		if (own !== null) {
			return own;
		}
		const targetList = resolvesToTargetsByFromStableId[oneNode.stableId] || [];
		if (targetList.length !== 1) {
			return '';
		}
		const targetNode = nodeByStableId[targetList[0]];
		if (targetNode === undefined) {
			return '';
		}
		return cleanOneSegment(targetNode.properties.description) || '';
	};

	let reconstructionCheckedCount = 0;
	let reconstructionMatchCount = 0;
	const reconstructionMismatchExamples = [];
	sourceElementDecls.forEach((oneNode) => {
		if (effectiveDescriptionOf(oneNode) !== '') {
			return; // text changed; the answer is not known here
		}
		reconstructionCheckedCount++;
		const rebuilt = reconstructOldText(oneNode);
		if (rebuilt === oneNode.properties.searchText) {
			reconstructionMatchCount++;
		} else if (reconstructionMismatchExamples.length < 5) {
			reconstructionMismatchExamples.push(
				`${oneNode.stableId}: rebuilt ${JSON.stringify(rebuilt)} vs emitted ${JSON.stringify(oneNode.properties.searchText)}`,
			);
		}
	});
	console.log('=== RECONSTRUCTION OF THE PRE-CHANGE TEXT, validated where the answer is known ===');
	console.log(
		`  checked on the ${reconstructionCheckedCount} no-prose declarations (their text did NOT change): ` +
			`${reconstructionMatchCount} match, ${reconstructionCheckedCount - reconstructionMatchCount} mismatch`,
	);
	reconstructionMismatchExamples.forEach((one) => console.log(`    ${one}`));
	const reconstructionIsSound =
		reconstructionCheckedCount > 0 && reconstructionMatchCount === reconstructionCheckedCount;
	console.log(`  reconstruction SOUND: ${reconstructionIsSound}`);
	if (!reconstructionIsSound) {
		console.log(
			'  REFUSING to report a before/after: the pre-change text cannot be reconstructed exactly, ' +
				'so an "old" figure would be computed on strings the forge never emitted.',
		);
		process.exit(2);
	}

	// ---- the CONCEPT population: scope (a') — distinct (name, typeAsWritten, effectiveDescription),
	// representative = lowest stableId. The ruling fixes this at 2,213 concepts.
	const conceptByCompositeName = {};
	sourceElementDecls.forEach((oneNode) => {
		const compositeName = JSON.stringify([
			oneNode.properties.name,
			oneNode.properties.typeAsWritten,
			effectiveDescriptionOf(oneNode),
		]);
		const existing = conceptByCompositeName[compositeName];
		if (existing === undefined || oneNode.stableId < existing.stableId) {
			conceptByCompositeName[compositeName] = oneNode;
		}
	});
	const representativeList = Object.keys(conceptByCompositeName)
		.sort()
		.map((oneName) => conceptByCompositeName[oneName]);
	console.log(`\n=== CONCEPT POPULATION (scope a') ===`);
	console.log(`  concepts: ${representativeList.length}   (the ruling fixes this at 2,213)`);

	const armOf = (oneNode) =>
		effectiveDescriptionOf(oneNode) === '' ? 'noProseAnywhere' : 'hasEffectiveDescription';
	const armTally = { hasEffectiveDescription: 0, noProseAnywhere: 0 };
	representativeList.forEach((oneNode) => {
		armTally[armOf(oneNode)]++;
	});
	console.log(
		`  by arm at CONCEPT grain: C2 ${armTally.hasEffectiveDescription} / C0 ${armTally.noProseAnywhere}`,
	);

	// ---- vectors, both sides, from the cache. Zero embedding calls.
	const cacheDb = new Database(CACHE_PATH, { readonly: true });
	const lookupStatement = cacheDb.prepare(
		`SELECT vectorBase64 FROM vectorCacheEntries
		 WHERE embeddingModelVersion = ? AND embeddingDims = ? AND textHash = ?`,
	);
	const vectorForText = (oneText) => {
		const oneRow = lookupStatement.get(EMBEDDING_MODEL_VERSION, EMBEDDING_DIMS, textHashOf(oneText));
		return oneRow === undefined ? null : decodeVector(oneRow.vectorBase64);
	};

	const scoredList = [];
	let missingNew = 0;
	let missingOld = 0;
	representativeList.forEach((oneNode) => {
		const newText = oneNode.properties.searchText;
		const oldText = reconstructOldText(oneNode);
		const newVector = vectorForText(newText);
		const oldVector = vectorForText(oldText);
		if (newVector === null) {
			missingNew++;
			return;
		}
		if (oldVector === null) {
			missingOld++;
			return;
		}
		scoredList.push({
			stableId: oneNode.stableId,
			armName: armOf(oneNode),
			newVector,
			oldVector,
			newText,
			oldText,
		});
	});
	console.log(
		`  vectors resolved from the cache: ${scoredList.length} of ${representativeList.length} ` +
			`(missing NEW ${missingNew}, missing OLD ${missingOld}) — ZERO embedding calls`,
	);
	cacheDb.close();

	// ---- the candidate pool: EXACTLY the 2,777 property-tier hub cards.
	// referenceTier is the property that carries the property/value split — 'property' 2,777,
	// 'value' 91,825, summing to 94,602. The bare `tier` property is null on all 94,602, which is why
	// the split read as absent. Same shape as the pescTier-not-tier trap, on a second label.
	const driver = neo4j.driver(HUB_BOLT, HUB_AUTH);
	const session = driver.session();
	session
		.run(
			`MATCH (n:HubReference)
			 WHERE n.referenceTier = 'property' AND n.embedding IS NOT NULL
			 RETURN n.canonicalKey AS cardKey, n.embedding AS embedding`,
		)
		.then((result) => {
			const cardKeyList = [];
			const cardVectorList = [];
			result.records.forEach((oneRecord) => {
				cardKeyList.push(oneRecord.get('cardKey'));
				cardVectorList.push(Float32Array.from(oneRecord.get('embedding')));
			});
			console.log(`\n=== CANDIDATE POOL ===`);
			console.log(`  property-tier hub cards with an embedding: ${cardVectorList.length} (expected 2,777)`);

			// both sides are L2-normalised (measured by the P0 builder and by the cache's own
			// provenance), so a dot product IS the cosine. Asserted rather than assumed:
			const normOf = (oneVector) => {
				let total = 0;
				for (let i = 0; i < oneVector.length; i++) {
					total += oneVector[i] * oneVector[i];
				}
				return Math.sqrt(total);
			};
			const sampleNorms = [
				normOf(cardVectorList[0]),
				normOf(scoredList[0].newVector),
				normOf(scoredList[0].oldVector),
			];
			console.log(
				`  unit-normalisation check (card, new subject, old subject): ` +
					sampleNorms.map((one) => one.toFixed(8)).join(', '),
			);
			const allUnit = sampleNorms.every((one) => Math.abs(one - 1) < 1e-4);
			console.log(`  all unit-normalised within 1e-4: ${allUnit} (a dot product IS the cosine)`);

			const topOneCardIndexFor = (subjectVector) => {
				let bestIndex = -1;
				let bestScore = -Infinity;
				for (let cardIndex = 0; cardIndex < cardVectorList.length; cardIndex++) {
					const oneCard = cardVectorList[cardIndex];
					let dot = 0;
					for (let i = 0; i < EMBEDDING_DIMS; i++) {
						dot += subjectVector[i] * oneCard[i];
					}
					if (dot > bestScore) {
						bestScore = dot;
						bestIndex = cardIndex;
					}
				}
				return { bestIndex, bestScore };
			};

			// collisionFloorOf — the report's formula, verified against its published numbers above.
			const collisionFloorOf = (topOneList) => {
				const distinctCount = new Set(topOneList.map((one) => one.bestIndex)).size;
				return {
					scored: topOneList.length,
					distinctTop1: distinctCount,
					collisionFloor: Number(((topOneList.length - distinctCount) / topOneList.length).toFixed(4)),
					medianTop1Cosine: Number(
						(() => {
							const sorted = topOneList.map((one) => one.bestScore).sort((a, b) => a - b);
							return sorted.length % 2
								? sorted[(sorted.length - 1) / 2]
								: (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
						})().toFixed(4),
					),
				};
			};

			console.log(`\n=== SCORING ${scoredList.length} concepts against ${cardVectorList.length} cards, both sides ===`);
			const newTopOne = [];
			const oldTopOne = [];
			scoredList.forEach((oneSubject, subjectIndex) => {
				newTopOne.push({ ...topOneCardIndexFor(oneSubject.newVector), armName: oneSubject.armName });
				oldTopOne.push({ ...topOneCardIndexFor(oneSubject.oldVector), armName: oneSubject.armName });
				if ((subjectIndex + 1) % 500 === 0) {
					console.log(`  ...${subjectIndex + 1}/${scoredList.length}`);
				}
			});

			const oldWhole = collisionFloorOf(oldTopOne);
			const newWhole = collisionFloorOf(newTopOne);

			console.log(`\n================ BEFORE / AFTER, IDENTICAL POPULATION ================`);
			console.log(`  OLD (all-C0 'OwningType | ElementName'): scored ${oldWhole.scored}, distinct top-1 ${oldWhole.distinctTop1}, collision floor ${oldWhole.collisionFloor}, median top-1 cosine ${oldWhole.medianTop1Cosine}`);
			console.log(`  NEW (the ruled HYBRID):                  scored ${newWhole.scored}, distinct top-1 ${newWhole.distinctTop1}, collision floor ${newWhole.collisionFloor}, median top-1 cosine ${newWhole.medianTop1Cosine}`);
			console.log(`  FLOOR GAIN: ${(oldWhole.collisionFloor - newWhole.collisionFloor).toFixed(4)}  (§13's C0->C2 gain on its own population was 0.1105)`);
			console.log(`  MEDIAN COSINE MOVE: ${(newWhole.medianTop1Cosine - oldWhole.medianTop1Cosine).toFixed(4)}  (the §12.7 guard DISQUALIFIES a fall of more than 0.03)`);

			console.log(`\n================ THE TWO ARMS, SEPARATELY — NEVER POOLED ================`);
			['hasEffectiveDescription', 'noProseAnywhere'].forEach((oneArmName) => {
				const armNew = collisionFloorOf(newTopOne.filter((one) => one.armName === oneArmName));
				const armOld = collisionFloorOf(oldTopOne.filter((one) => one.armName === oneArmName));
				const armLabel = oneArmName === 'hasEffectiveDescription' ? 'C2 (prose)' : 'C0 (no prose)';
				console.log(`  ${armLabel}:`);
				console.log(`     OLD: scored ${armOld.scored}, distinct top-1 ${armOld.distinctTop1}, floor ${armOld.collisionFloor}, median cosine ${armOld.medianTop1Cosine}`);
				console.log(`     NEW: scored ${armNew.scored}, distinct top-1 ${armNew.distinctTop1}, floor ${armNew.collisionFloor}, median cosine ${armNew.medianTop1Cosine}`);
			});
			console.log(
				`\n  NOTE: the C0 arm's text did not change, so its OLD and NEW rows MUST be identical. ` +
					`They are a control: a difference there would mean the reconstruction or the cache lookup is wrong.`,
			);

			// how many concepts changed their top-1 answer
			let changedTopOne = 0;
			for (let i = 0; i < newTopOne.length; i++) {
				if (newTopOne[i].bestIndex !== oldTopOne[i].bestIndex) {
					changedTopOne++;
				}
			}
			console.log(
				`\n  concepts whose TOP-1 CARD CHANGED: ${changedTopOne} of ${newTopOne.length} ` +
					`(${((changedTopOne / newTopOne.length) * 100).toFixed(1)}%)`,
			);
			console.log(
				`  NOT A CORRECTNESS CLAIM: both floors bound error from BELOW and neither identifies a ` +
					`correct card. No truth set exists. A floor of 0.55 is still a floor of 0.55.`,
			);

			session.close().then(() => driver.close());
		})
		.catch((thrownError) => {
			console.error(`HUB QUERY FAILED: ${thrownError.message}`);
			session.close().then(() => driver.close());
			process.exit(1);
		});
});
