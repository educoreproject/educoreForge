'use strict';

// relationshipWriter — the WRITE component of the bridge library (design §3.6). It is the ONE
// library component that gets a real body in P0, because it is the write-into-graph substrate the
// whole phase exists to lay: a bridge plugin composes it, and it drives the injected graphWriter.
// Everything upstream of it (walk / gather / select / freeze) is skeletoned in P0 and filled by
// P2/P3; the edge actually reaching the graph is proven now.
//
//   relationshipWriter({ graphWriter }) ->
//       ({ decision, authoredMapping, applyLabel }, callback('', { edgeWritten, metadata }))
//
// It takes EITHER an authoredMapping (deterministic EXACT_MATCH producer) OR a frozen decision
// (inferred CLOSE_MATCH producer) — exactly one — plus the applyLabel handed down from the
// orchestrator. It shapes the bridging metadata and hands a single edge to graphWriter, then
// RETURNS status: it is never a pure side-effect, because an un-counted write cannot be gated
// (design §3.6).
//
// P0 SCOPE: the metadata assembled here is the minimum an edge needs to be written and harvested
// — endpoint stableIds, a relationship type, and the applyLabel. The full bridging stamp
// (matchType, confidence, provenanceTier, mappingJustification, decisionBlockHash, hub-anchor
// key) is authored by the producers that land in P2/P3; this seam carries whatever `properties`
// they supply straight through to graphWriter. It invents none of them (polyArch2 §6).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ graphWriter } = {}) => {
		if (!graphWriter) {
			throw new Error(
				`${moduleName}: constructed without a graphWriter. relationshipWriter is the write ` +
					`seam; it must be handed the graphWriter minted from the run's GraphHandle. There is ` +
					`no default — a writer with nowhere to write is not a writer.`,
			);
		}

		const write = ({ decision, authoredMapping, applyLabel } = {}, callback) => {
			// EXACTLY ONE source of the edge. Neither is a fault; both at once is an ambiguous call
			// (which one's stableIds win?) and is refused rather than silently preferring one.
			if (!decision && !authoredMapping) {
				callback(
					`${moduleName}: an edge needs either an authoredMapping (EXACT_MATCH) or a frozen ` +
						`decision (CLOSE_MATCH); neither was given.`,
				);
				return;
			}
			if (decision && authoredMapping) {
				callback(
					`${moduleName}: both an authoredMapping and a decision were given for one edge; that ` +
						`is ambiguous. Pass exactly one.`,
				);
				return;
			}
			if (typeof applyLabel !== 'string' || applyLabel.trim() === '') {
				callback(
					`${moduleName}: applyLabel is ${
						applyLabel === undefined ? 'not given' : JSON.stringify(applyLabel)
					}. It is the label the orchestrator stamps so the edge can be harvested; there is no ` +
						`default.`,
				);
				return;
			}

			const edgeSource = authoredMapping || decision;
			const { fromStableId, toStableId, relationshipType, properties } = edgeSource;

			graphWriter.writeRelationshipEdge(
				{ fromStableId, toStableId, relationshipType, applyLabel, properties: properties || {} },
				(err, writeResult) => {
					if (err) {
						callback(`${moduleName}: ${err}`);
						return;
					}
					callback('', {
						edgeWritten: !!(writeResult && writeResult.edgeWritten),
						metadata: { fromStableId, toStableId, relationshipType, applyLabel },
					});
				},
			);
		};

		return write;
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
