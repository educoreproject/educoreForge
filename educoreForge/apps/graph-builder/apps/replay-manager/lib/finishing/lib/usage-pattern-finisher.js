'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// usage-pattern-finisher.js — registry member 6, mode 'emit' (graphSelfDoc Phase 3, 2026-08-31).
//
// tqii's fifth question — HOW DO I GET USED — and the one that turns the metadata from a RECORD into a
// MANUAL. One :UsagePattern per named question: question · cypher · caveat · entryLabel.
//
// ============================================================================================
// EXECUTION IS THE PROOF — but WHEN it is executed is the whole question (see the two-stage section)
// ============================================================================================
// Every exemplar is EXECUTED, and a rotted one fails the build rather than teaching a stale traversal to
// whatever reads it next — the DME's askMilo GENERATES CYPHER, so a stale exemplar in the graph is not
// inert documentation, it is bad input to a generator. Same round-trip-or-refuse discipline as every other
// finisher. What changed on 2026-08-31 is WHERE the rot judgement lives: emit time can only check that a
// query RUNS; only the FINISHED graph can say whether it ANSWERS.
//
// ============================================================================================
// THE CAVEAT FIELD IS THE POINT, NOT THE CYPHER
// ============================================================================================
// SHACL can say a mapping edge must land on a HubReference. It can NEVER say "this graph's mapping edges
// are all debug output and must not be used for meaning". That is ADVICE, not SHAPE, and advice is exactly
// what a consumer holding a bolt connection cannot derive for itself. Every exemplar that touches mapping
// edges carries a caveat saying what the answer must NOT be taken to mean — because from the graph's side
// those edges LOOK like mappings, which is precisely how a consumer gets misled.
//
// ============================================================================================
// THE CHECK IS IN TWO STAGES — RULED (GRANITE_ECHO 2026-08-31, amended gate (c)). ANY PRE-WRITE
// VERIFICATION IS WRONG ON PRINCIPLE.
// ============================================================================================
// My first build executed exemplars at emit time and judged zero rows as rot. It refused on a live bed —
// correctly, but for a reason that indicted the DESIGN, not the graph: the contiguous-emitter batching rule
// puts usagePattern in the SAME WRITE BATCH as manifestRecipe/standardDefinition/buildAttestation, so at
// emit time their nodes are IN MEMORY, NOT IN THE GRAPH, and an exemplar asking about them is honestly
// empty.
//
// THE DECISIVE POINT, which I could not see from this lane: EXEMPLAR TRUTH IS A PROPERTY OF THE FINISHED
// GRAPH. Even a "flush the batch before me" flag would verify against pre-usagePattern state — and an
// exemplar traversing from the PASSPORT (GraphProvenance / BUILT_FROM / ATTESTS) can NEVER be verified
// before Channel B, which runs after ALL of Channel A. So no moment inside emit is the right moment.
//
//   STAGE 1 — EMIT TIME: execute every exemplar as a QUERY-VALIDITY CHECK ONLY. A query ERROR (nonexistent
//     label, broken Cypher) REFUSES BY NAME immediately. A ZERO-ROW RESULT IS NOT JUDGED HERE — the state
//     it ran against cannot contain what later writes add, so judging it would convict the exemplar of the
//     batching rule's timing.
//   STAGE 2 — FINISH TIME (verifyWritten, called after ALL Channel-A writes land; in Phase 4 beside gate
//     (g)'s XOR recheck with the passport present): RE-EXECUTE every written exemplar. `defect` + zero rows
//     = REFUSAL BY NAME, and at verb level it FAILS THE VERB — the graph is not reported finished.
//     `finding` + zero rows = the honest finding, reported rather than reworded.
//
// zeroRowMeaning REMAINS DECLARED DATA PER EXEMPLAR — 'defect' (zero rows means it has rotted) or
// 'finding' (zero rows is a TRUE and interesting answer about this graph). Writing an exemplar chosen
// because it returns rows would be selecting the question to fit the answer, which is what this
// distinction exists to forbid.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { NODE_LABELS, SELF_DOC, DME_ROLES } = vocabulary;
		const forgedLabel = NODE_LABELS.FORGED_NODE;
		const patternLabel = SELF_DOC.NODE_LABELS.USAGE_PATTERN;
		const patternPrefix = SELF_DOC.USAGE_PATTERN_STABLE_ID_PREFIX;

		const metadataRef = (oneStableId) => ({ source: null, id: oneStableId });

		// ----- THE EXEMPLARS. Each is a question a consumer actually has, the cypher that answers it, the
		//   label to enter from, and a caveat naming what the answer must not be taken to mean.
		const EXEMPLAR_LIST = [
			{
				patternName: 'whatStandardsAreHere',
				question: 'Which standards does this graph contain, and how big is each?',
				entryLabel: SELF_DOC.NODE_LABELS.STANDARD_DEFINITION,
				cypher:
					'MATCH (d:StandardDefinition) RETURN d.standardName AS standard, d.version AS version, ' +
					'd.propertyCount AS properties, d.mappingDisposition AS mappingDisposition ORDER BY standard',
				caveat:
					'`version` is what the FORGE stamped (the provenance stamp since versionFromStamp; a ' +
					'parser-reported value only on pre-framework blocks) and is the value that entered the ' +
					'content address. ' +
					'Check `versionDisagreement` before quoting it — where it is true, `publishedVersion` is what ' +
					'the standard actually is and the two deliberately differ.',
				zeroRowMeaning: 'defect',
			},
			{
				patternName: 'whereDoIStart',
				question: 'I have a bolt connection and no prior knowledge. What do the labels mean?',
				entryLabel: 'SchemaView',
				cypher:
					'MATCH (root:SchemaView {kind: \'schemaViewRoot\'})-[:HAS_SCHEMA_TERM]->(term:SchemaView) ' +
					'RETURN term.kind AS kind, term.value AS term, term.description AS meaning ORDER BY kind, term',
				caveat:
					'This catalog is generated from the vocabulary registry at build time. CODE IS TRUTH; this ' +
					'is its projection. A term absent here is absent from the registry, not merely undocumented.',
				zeroRowMeaning: 'defect',
			},
			{
				patternName: 'howWasThisBuilt',
				question: 'What recipe produced this graph, and from which schema blocks?',
				entryLabel: SELF_DOC.NODE_LABELS.MANIFEST_RECIPE,
				cypher:
					'MATCH (r:ManifestRecipe)-[:HAS_BLOCK]->(b:RecipeBlock) ' +
					'RETURN r.manifestRefId AS manifest, b.subject AS schemaBlock, b.kind AS kind, ' +
					'b.purpose AS purpose, b.purposeSource AS purposeSource ORDER BY schemaBlock',
				caveat:
					'`purpose` is CARRIED TEXT, not a warrant. Read `purposeSource` with it: on this store ' +
					'generation every purpose is machine-generated by the builder, and the token `authored` does ' +
					'not exist because no human channel exists to produce one. Absence of a template match reads ' +
					'as `unrecognized`, NEVER as human authorship.',
				zeroRowMeaning: 'defect',
			},
			{
				patternName: 'whatDoesThisGraphClaimAboutMeaning',
				question:
					'Which cross-standard mappings are ASSERTED here, and may I rely on them for meaning?',
				entryLabel: 'HubReference',
				cypher:
					'MATCH ()-[m]->(:HubReference) RETURN type(m) AS relation, m.provenanceTier AS provenanceTier, ' +
					'count(*) AS edges ORDER BY relation, provenanceTier',
				caveat:
					'READ provenanceTier BEFORE USING ANY ROW. An edge tiered `invalid-debug` was produced by the ' +
					'debug judge (rule "first": candidate 1 taken unconditionally) and carries NO semantic ' +
					'warrant — it proves the plumbing, not the meaning. From the graph side such an edge is ' +
					'INDISTINGUISHABLE from a real mapping, which is exactly why this caveat exists. Only ' +
					'`spec-authoritative` composes to cross-standard equivalence.',
				zeroRowMeaning: 'finding',
			},
		];

		// ----- emit — mode 'emit'. EXECUTES each exemplar, then emits only those that returned rows.
		const emit = ({ readQuery } = {}, callback) => {
			if (typeof readQuery !== 'function') {
				callback(
					`usage-pattern-finisher: a readQuery is REQUIRED. Every exemplar must be EXECUTED before it ` +
						`is written — an unexecuted exemplar is an untested instruction, and writing one would be ` +
						`the exact rot this finisher exists to prevent.`,
				);
				return;
			}

			const taskList = new taskListPlus();
			const executed = [];

			EXEMPLAR_LIST.forEach((oneExemplar) => {
				taskList.push((args, next) => {
					readQuery({ cypher: oneExemplar.cypher }, (err, result) => {
						if (err) {
							// A cypher error is ALWAYS a defect — the exemplar names something that is not there.
							next(
								`usage-pattern-finisher: exemplar '${oneExemplar.patternName}' FAILED TO EXECUTE ` +
									`against this graph: ${err} — refusing to write a usage pattern that does not run. ` +
									`Cypher: ${oneExemplar.cypher}`,
							);
							return;
						}
						const rowCount = ((result && result.records) || []).length;
						executed.push({ ...oneExemplar, rowCount });
						next('', args);
					});
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}

				// STAGE 1 IS QUERY-VALIDITY ONLY. Every exemplar that EXECUTED without error is written; a
				// zero-row result is NOT judged here, because the state it ran against cannot contain what
				// the rest of this very batch is about to add. The rot judgement belongs to verifyWritten.
				const nodes = executed.map((oneExemplar) => {
					const stableId = `${patternPrefix}${oneExemplar.patternName}`;
					return {
						stableId,
						ref: metadataRef(stableId),
						labels: [forgedLabel, patternLabel],
						properties: {
							stableId,
							patternName: oneExemplar.patternName,
							question: oneExemplar.question,
							cypher: oneExemplar.cypher,
							caveat: oneExemplar.caveat,
							entryLabel: oneExemplar.entryLabel,
							// The row count observed at EMIT time, recorded as provenance and NOT as proof — at
							// this instant the batch's own nodes are unwritten, so a zero here means nothing.
							// The finish-time count written by verifyWritten is the one that carries weight.
							emitTimeRowCount: oneExemplar.rowCount,
							// zeroRowMeaning travels WITH the node so finish-time verification, and any later
							// reader, can tell a rotted exemplar from an honestly empty one without re-deriving it.
							zeroRowMeaning: oneExemplar.zeroRowMeaning,
						},
					};
				});

				callback('', {
					nodes,
					edges: [],
					summary:
						`usage patterns: ${nodes.length} emitted (all EXECUTED without error; zero-row rows NOT ` +
						`judged at emit time — see verifyWritten for the finish-time verdict)`,
					writtenCount: nodes.length,
					executedCount: executed.length,
				});
			});
		};

		// ----- verifyWritten — STAGE 2, THE FINISH-TIME VERDICT (ruled; amended gate (c)).
		//   Called AFTER all Channel-A writes have landed — in Phase 3 by the harness over the completed
		//   bed, in Phase 4 by the verb beside gate (g)'s XOR recheck WITH the Channel-B passport present.
		//   THIS is where a zero row means something, because this is the first moment the graph contains
		//   everything the exemplars ask about.
		//
		//   `defect` + zero rows  -> REFUSAL BY NAME. At verb level this FAILS THE VERB: a graph whose own
		//                            usage manual does not work is not a finished graph.
		//   `finding` + zero rows -> the HONEST FINDING, reported rather than reworded. Rewording an
		//                            exemplar until it returns rows is selecting the question to fit the
		//                            answer.
		// `disabledFinisherList` is passed by THE VERB and exists only to make the refusal legible.
		// RULED 2026-09-01 (GRANITE_ECHO, the (c)/(h) conflict): a caller who exercised the documented
		// per-finisher opt-out must learn AT THE POINT OF REFUSAL why that documented option ended here.
		// Disabling a finisher whose nodes an exemplar traverses makes the exemplar unanswerable, and the
		// refusal is CORRECT — but a refusal naming only the rotted exemplar leaves the caller to rediscover
		// the cause it already knew. This is deliberately a REPORTED LIST, not a dependency declaration:
		// option (ii)'s per-exemplar dependency machinery was REFUSED because a wrong declaration would
		// silently exempt an exemplar that should have been judged — a gate weakened invisibly.
		const verifyWritten = ({ readQuery, disabledFinisherList } = {}, callback) => {
			if (typeof readQuery !== 'function') {
				callback(
					`usage-pattern-finisher.verifyWritten: a readQuery is REQUIRED. The finish-time verdict is ` +
						`the ONLY one that carries weight — skipping it would leave every exemplar unproven ` +
						`against the graph it actually ships in.`,
				);
				return;
			}

			const taskList = new taskListPlus();
			const verified = [];

			EXEMPLAR_LIST.forEach((oneExemplar) => {
				taskList.push((args, next) => {
					readQuery({ cypher: oneExemplar.cypher }, (err, result) => {
						if (err) {
							next(
								`usage-pattern-finisher.verifyWritten: exemplar '${oneExemplar.patternName}' FAILED ` +
									`TO EXECUTE against the finished graph: ${err}`,
							);
							return;
						}
						verified.push({
							...oneExemplar,
							rowCount: ((result && result.records) || []).length,
						});
						next('', args);
					});
				});
			});

			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}

				const rotted = verified.filter(
					(oneExemplar) => oneExemplar.rowCount === 0 && oneExemplar.zeroRowMeaning === 'defect',
				);
				if (rotted.length) {
					const disabledList = Array.isArray(disabledFinisherList) ? disabledFinisherList : [];
					const causeClause = disabledList.length
						? ` FINISHERS DISABLED THIS RUN: ${disabledList.join(', ')} — a disabled finisher whose ` +
							`nodes an exemplar traverses is the likely cause, and this refusal is the documented ` +
							`opt-out announcing its constraint rather than a defect. The opt-out remains ` +
							`exercisable; it cannot leave the graph advertising a question it can no longer answer.`
						: ` No finishers were disabled this run, so the rot is NOT explained by the opt-out ` +
							`— the graph genuinely stopped answering a question it advertises.`;
					callback(
						`usage-pattern-finisher.verifyWritten: ${rotted.length} exemplar(s) declared ` +
							`zeroRowMeaning 'defect' returned NO ROWS against the FINISHED graph: ` +
							`${rotted.map((oneExemplar) => oneExemplar.patternName).join(', ')}. These have rotted — ` +
							`the graph carries a usage manual that does not answer. Refusing.${causeClause}`,
					);
					return;
				}

				const zeroRowFindings = verified
					.filter(
						(oneExemplar) => oneExemplar.rowCount === 0 && oneExemplar.zeroRowMeaning === 'finding',
					)
					.map((oneExemplar) => ({
						patternName: oneExemplar.patternName,
						question: oneExemplar.question,
						note:
							`executed correctly against the FINISHED graph and returned ZERO rows. Declared ` +
							`zeroRowMeaning 'finding', so this is a TRUE and reportable fact about this graph — not ` +
							`a defect in the exemplar, and not a reason to reword the question until it passes.`,
					}));

				callback('', {
					summary:
						`usage patterns verified against the FINISHED graph: ${verified.length} executed, ` +
						`${verified.length - zeroRowFindings.length} returning rows` +
						(zeroRowFindings.length
							? `, ${zeroRowFindings.length} honestly zero-row and REPORTED`
							: ''),
					verifiedCount: verified.length,
					rowCounts: verified.reduce(
						(tally, oneExemplar) => ({ ...tally, [oneExemplar.patternName]: oneExemplar.rowCount }),
						{},
					),
					zeroRowFindings,
				});
			});
		};

		return { emit, verifyWritten, EXEMPLAR_LIST };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
