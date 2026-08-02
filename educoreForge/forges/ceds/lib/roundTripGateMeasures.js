'use strict';

// =====================================================================================
// roundTripGateMeasures — what the gates are pointed AT
// =====================================================================================
//
// The harness (roundTripGates.js) judges. This measures. Keeping them apart is not tidiness:
// it is what lets the harness be proven without Docker while these measures do the I/O that
// genuinely needs a running container.
//
// THE RULE THIS MODULE OBEYS: a measure it cannot honestly compute is NOT SUPPLIED. It is
// never estimated, never defaulted to a passing value, never quietly omitted. An unsupplied
// measure drives its gate to UNMEASURED, which the harness treats as a failure, and the
// reason travels with it so a reader learns WHY rather than wondering. A green gate nobody
// measured is the precise bug this whole suite exists to prevent, and the easiest place to
// reintroduce it is right here, in the module that decides what "measured" means.
//
// EVERY CYPHER STATEMENT IS MATCH/RETURN. There is no write clause anywhere in this file
// and refuseIfWriteClause() enforces that at run time rather than by good intentions.

const fs = require('fs');
const path = require('path');

const moduleName = path.basename(__filename).replace(/\.js$/, '');

const compilerLib = require('./roundTripCompiler')();
const canonicalLib = require('./roundTripCanonical')();
const diffLib = require('./roundTripDiff')();
const gatesLib = require('./roundTripGates')();
const independentCheckLib = require(
	path.join(__dirname, '..', '..', '..', 'lib', 'rdf-independent-check', 'rdf-independent-check'),
)();

const SUITE_FACTS_PATH = path.join(__dirname, '..', 'gates', 'suiteFacts.jsonc');

// The roles the DME's schema-provider documents. D-3 compares this against what the graph
// actually carries -- the gate exists because the doc claimed six while the graph had eight.
const DOCUMENTED_ROLES_SOURCE_PATH =
	'/Users/tqwhite/Documents/webdev/educore/system/code/server/lib/schema-provider.js';

// Roles that predate this revision. D-4 asserts enrichment does not disturb them.
const PRE_EXISTING_ROLES = [
	'DmeOptionValue',
	'DmeProperty',
	'DmeClass',
	'DmeSupport',
	'DmeOptionSet',
	'DmeStandardRoot',
	'HubReference',
	'HubDefinition',
];

// The role this revision introduces for CEDS's own annotation vocabulary (spec §8.5).
const META_VOCABULARY_ROLE = 'DmeVocabularyTerm';

// Hub-only properties. L-2 proves none of these is read to rebuild a Layer 1 statement.
const HUB_ONLY_PROPERTY_KEYS = [
	'addressSignature',
	'canonicalKey',
	'hubName',
	'hubVersion',
	'embedding',
	'embeddingModelVersion',
];

const WRITE_CLAUSE_PATTERN = /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV)\b/i;

const roundTripGateMeasures = () => {
	const unsupplied = [];
	const record = (name, reason) => {
		unsupplied.push({ name, reason });
	};

	// refuseIfWriteClause — R-4 enforced mechanically. A measure that mutates the thing it
	// measures is not a measure, and "we only wrote MATCH queries" is a claim, not a control.
	let graphWriteAttempts = 0;
	const refuseIfWriteClause = (cypher) => {
		if (WRITE_CLAUSE_PATTERN.test(cypher)) {
			graphWriteAttempts += 1;
			return `${moduleName}: REFUSED, a gate measure attempted a write clause: ${cypher.slice(0, 120)}`;
		}
		return '';
	};

	// =================================================================================
	// suite facts
	// =================================================================================
	const loadSuiteFacts = ({ filePath } = {}, callback) => {
		const resolvedPath = filePath || SUITE_FACTS_PATH;
		if (!fs.existsSync(resolvedPath)) {
			callback(`${moduleName}.loadSuiteFacts: '${resolvedPath}' does not exist.`);
			return;
		}
		const stripped = gatesLib.stripJsonComments(fs.readFileSync(resolvedPath, 'utf8'));
		let parsed;
		let faultMessage = '';
		try {
			parsed = JSON.parse(stripped);
		} catch (parseError) {
			faultMessage = parseError.message;
		}
		if (faultMessage) {
			callback(`${moduleName}.loadSuiteFacts: '${resolvedPath}' is unparseable: ${faultMessage}`);
			return;
		}
		callback('', { suiteFacts: parsed });
	};

	// =================================================================================
	// derived report measures — pure arithmetic over the round-trip report
	// =================================================================================
	const deriveReportMeasures = ({ report }) => {
		if (!report || !report.headline) {
			record('report:*', 'no round-trip report was supplied');
			return {};
		}
		const { headline } = report;
		const rows = report.perPredicate || [];

		const matchedByPredicate = {};
		let maxLostAcrossPredicates = 0;
		let predicateLostSum = 0;
		rows.forEach((oneRow) => {
			matchedByPredicate[oneRow.predicate] = oneRow.matched;
			predicateLostSum += oneRow.lost || 0;
			maxLostAcrossPredicates = Math.max(maxLostAcrossPredicates, oneRow.lost || 0);
		});

		return {
			matchedEqualsSource: headline.matched === headline.sourceStatements,

			// F-3, the Phase-0 lesson: two empty things are identical, and identical is what a
			// naive comparison calls success. These are NON-EMPTINESS floors, and they are
			// deliberately NOT the acceptance targets.
			//
			// The first version required emittedStatements >= 239761 -- the finished number --
			// which made F-3 a duplicate of F-1 wearing a different hat, and made it red for
			// the whole enrichment for a reason that had nothing to do with emptiness. A floor
			// that only clears when the work is complete is not a floor. What F-3 must catch
			// is a run measuring nothing: the source fully parsed, a substantial emission, and
			// every entity subject present.
			sizeFloors:
				headline.sourceStatements >= 239761 &&
				headline.emittedStatements >= 100000 &&
				headline.emittedSubjects >= 23237,

			structuralFidelityPresent:
				typeof headline.structuralFidelityPercent === 'number' &&
				typeof headline.structuralSourceStatements === 'number' &&
				headline.structuralSourceStatements > 0,

			predicateRowsSumToLost: predicateLostSum === headline.lost,

			topLevelWithoutSubjectSurfaced:
				typeof headline.sourceTopLevelWithoutSubject === 'number' &&
				typeof headline.emittedTopLevelWithoutSubject === 'number',

			matchedByPredicate,
			maxLostAcrossPredicates,
		};
	};

	// =================================================================================
	// suite measures — the suite auditing itself
	// =================================================================================
	const deriveSuiteMeasures = ({ declarations, suiteFacts, observedTwins }) => {
		const gates = (declarations || {}).gates || [];
		const facts = suiteFacts || {};

		// F-4: no gate may make a PERCENTAGE its acceptance measure. The audits proved a
		// tampered emission carrying four fabrications still reported 71.936%.
		//
		// DETECT THE THING, NOT THE WORD. The first version of this matched /[Pp]ercent/
		// against every measure name and promptly flagged ITSELF --
		// `suite:gatesUsingPercentInAcceptance` contains "Percent". A gate that fails because
		// of how it is spelled teaches nothing and erodes trust in the ones that fail for
		// real reasons. So: a percentage measure is one that READS a percent-valued field out
		// of the report, which is a fact about where the number comes from rather than about
		// vocabulary.
		const gatesUsingPercentInAcceptance = gates.filter((oneGate) =>
			/^report\.[A-Za-z.]*[Pp]ercent$/.test(oneGate.measure),
		).length;

		const aggregateFailureAttributionCount = (facts.environmentalFailureAttributions || []).filter(
			(oneEntry) => oneEntry.aggregate === true,
		).length;

		return {
			gatesUsingPercentInAcceptance,
			exclusionManifestLength: (facts.exclusionManifest || []).length,
			skosDefinitionFindingRecorded: !!(facts.skosDefinitionFinding || {}).recorded,
			gatesWithUnobservedTwin: gates.filter((oneGate) => !(observedTwins || {})[oneGate.id]).length,

			// M-2: XFAIL and skip are not permitted states. They do not exist in the
			// declaration vocabulary at all, so this counts any attempt to smuggle one in.
			maskedGateCount: gates.filter(
				(oneGate) => oneGate.expectFail === true || oneGate.skip === true,
			).length,

			gatesWithoutComparator: gates.filter((oneGate) => !oneGate.comparator).length,
			aggregateFailureAttributionCount,
			wiredIntoGateOfRecord: !!(facts.gateOfRecord || {}).wired,
			expectationsWithoutBaselineProvenance: facts.baselineProvenance ? 0 : gates.length,
			graphWriteAttemptCount: graphWriteAttempts + (facts.graphWriteAttempts || 0),
		};
	};

	// =================================================================================
	// static probes — read the compiler's own source
	// =================================================================================
	// L-4 asks whether the layer exclusion is a STATED decision rather than luck. That is a
	// question about the code, so it is answered by reading the code: every MATCH against a
	// node must name a role or a role-bearing label on BOTH endpoints. A query that happens
	// to return the right rows today, unscoped, is exactly the accident this gate forbids.
	const deriveStaticProbes = () => {
		const compilerSource = fs.readFileSync(path.join(__dirname, 'roundTripCompiler.js'), 'utf8');

		const matchClauses = compilerSource.match(/MATCH\s*\([^)]*\)[^\n]*/g) || [];
		const unscoped = matchClauses.filter((oneClause) => {
			const namesRoleOrLabel =
				/role:\s*'/.test(oneClause) ||
				/:ForgedNode/.test(oneClause) ||
				/:Dme[A-Za-z]+/.test(oneClause) ||
				/:StandardBase/.test(oneClause);
			return !namesRoleOrLabel;
		});

		// L-3: the compiler must never NAME a hub role in an emission path. Reading the
		// exclusion out of the source is weaker than watching the output, so this is a
		// supporting probe -- graph:hubStatementsInEmission is the one that watches output.
		const hubOnlyKeysReferenced = HUB_ONLY_PROPERTY_KEYS.filter(
			(oneKey) => new RegExp(`GRAPH_PROPERTY_BY_FIELD[^]*['"\`]${oneKey}['"\`]`).test(compilerSource),
		);

		return {
			allQueriesRoleScoped: unscoped.length === 0,
			allQueriesRoleScopedDetail: unscoped.slice(0, 4),
			hubOnlyKeysReferencedInFieldMap: hubOnlyKeysReferenced,
		};
	};

	// =================================================================================
	// canonicalizer probes — the instrument's own honesty, against real inputs
	// =================================================================================
	// C-1 is the deepest gate in the suite. The SAME module canonicalizes both sides, so
	// anything it discards it discards symmetrically: a statement we never captured could
	// score MATCHED because the distinguishing detail was erased on both sides. These pairs
	// assert genuinely DIFFERENT things and must never collide.
	const ADVERSARIAL_PAIRS = [
		{
			name: 'differing rdf:datatype',
			left: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p rdf:datatype="http://www.w3.org/2001/XMLSchema#token">7</x:p></rdf:Description></rdf:RDF>`,
			right: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">7</x:p></rdf:Description></rdf:RDF>`,
		},
		{
			name: 'differing xml:lang',
			left: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p xml:lang="en">colour</x:p></rdf:Description></rdf:RDF>`,
			right: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p xml:lang="fr">colour</x:p></rdf:Description></rdf:RDF>`,
		},
		{
			name: 'resource reference vs literal of identical text',
			left: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p rdf:resource="http://x.example/o"/></rdf:Description></rdf:RDF>`,
			right: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p>http://x.example/o</x:p></rdf:Description></rdf:RDF>`,
		},
		{
			name: 'different object entirely',
			left: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p>alpha</x:p></rdf:Description></rdf:RDF>`,
			right: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p>beta</x:p></rdf:Description></rdf:RDF>`,
		},
		{
			name: 'different subject',
			left: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s1"><x:p>same</x:p></rdf:Description></rdf:RDF>`,
			right: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s2"><x:p>same</x:p></rdf:Description></rdf:RDF>`,
		},
	];

	// C-6: the header claims nested namespace redeclarations are REFUSED. Until 2026-08-02
	// nothing looked, and a redeclared prefix would have keyed statements under the WRONG
	// predicate URI -- a change of meaning that reads as a clean match.
	const NESTED_NAMESPACE_DOCUMENT = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p xmlns:x="http://OTHER.example/">value</x:p></rdf:Description></rdf:RDF>`;

	const deriveCanonicalProbes = (callback) => {
		const keysOf = ({ statements }) => Array.from(statements.keys()).sort().join('\n');

		const canonicalizeAll = (documents, whenDone) => {
			const results = [];
			const step = (index) => {
				if (index >= documents.length) {
					whenDone('', results);
					return;
				}
				canonicalLib.canonicalizeRdfText(
					{ rdfText: documents[index], sourceLabel: `probe-${index}` },
					(canonicalError, canonical) => {
						if (canonicalError) {
							whenDone(canonicalError);
							return;
						}
						results.push(canonical);
						step(index + 1);
					},
				);
			};
			step(0);
		};

		const pairDocuments = [];
		ADVERSARIAL_PAIRS.forEach((onePair) => {
			pairDocuments.push(onePair.left, onePair.right);
		});

		canonicalizeAll(pairDocuments, (pairError, pairResults) => {
			if (pairError) {
				record('probe:adversarialPairsAllDistinct', `canonicalizer refused a probe input: ${pairError}`);
				callback('', {});
				return;
			}
			const collisions = [];
			ADVERSARIAL_PAIRS.forEach((onePair, oneIndex) => {
				const left = keysOf(pairResults[oneIndex * 2]);
				const right = keysOf(pairResults[oneIndex * 2 + 1]);
				if (left === right) {
					collisions.push(onePair.name);
				}
			});

			canonicalizeAll([NESTED_NAMESPACE_DOCUMENT], (nestedError, nestedResults) => {
				const nestedFaults = nestedError ? [] : (nestedResults[0].stats || {}).faults || [];
				const nestedRefused =
					!!nestedError || nestedFaults.some((oneFault) => /REFUSED/.test(oneFault));

				callback('', {
					adversarialPairsAllDistinct: collisions.length === 0,
					adversarialCollisions: collisions,
					nestedNamespaceRefused: nestedRefused,
				});
			});
		});
	};

	// =================================================================================
	// diff probes — N-2 and N-3, proven on synthetic statement sets
	// =================================================================================
	// The audit proved these load-bearing by tampering with a real emission: four fabricated
	// statements, and the headline percentage did not move at all.
	const deriveDiffProbes = (callback) => {
		const cleanDocument = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p>alpha</x:p></rdf:Description></rdf:RDF>`;
		const fabricatingDocument = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="http://x.example/"><rdf:Description rdf:about="http://x.example/s"><x:p>alpha</x:p><x:invented>never said</x:invented></rdf:Description></rdf:RDF>`;

		canonicalLib.canonicalizeRdfText({ rdfText: cleanDocument, sourceLabel: 'probeSource' }, (e1, source) => {
			if (e1) {
				record('probe:inventionsIndividuallyNamed', `canonicalizer refused: ${e1}`);
				callback('', {});
				return;
			}
			canonicalLib.canonicalizeRdfText(
				{ rdfText: fabricatingDocument, sourceLabel: 'probeEmitted' },
				(e2, emitted) => {
					if (e2) {
						record('probe:inventionsIndividuallyNamed', `canonicalizer refused: ${e2}`);
						callback('', {});
						return;
					}
					diffLib.diffStatements(
						{
							sourceStatements: source.statements,
							emittedStatements: emitted.statements,
							sourceStats: source.stats,
							emittedStats: emitted.stats,
							context: { probe: 'invention' },
						},
						(diffError, diffResult) => {
							if (diffError) {
								record('probe:inventionsIndividuallyNamed', `diff refused: ${diffError}`);
								callback('', {});
								return;
							}
							const { report } = diffResult;
							const namedRows = (report.invented || {}).perPredicate || [];
							const namesTheFabrication = namedRows.some(
								(oneRow) => oneRow.predicate.indexOf('invented') >= 0,
							);
							callback('', {
								inventionsIndividuallyNamed:
									report.headline.invented === 1 && namesTheFabrication,
								// N-3: the combined figure must FALL when something is fabricated. The
								// plain fidelity percentage does not move at all -- that is the defect.
								cleanFidelityFallsOnInvention:
									report.headline.cleanFidelityPercent < report.headline.fidelityPercent,
							});
						},
					);
				},
			);
		});
	};

	// =================================================================================
	// graph measures — read-only, one session, every statement MATCH/RETURN
	// =================================================================================
	// GRAPH_MEASURE_QUERIES is a REGISTRY, not a switch: adding a measure is adding an
	// entry. Each declares its Cypher and how to read one row out of the result, and
	// refuseIfWriteClause inspects every one before it is issued (gate R-4 enforced
	// mechanically rather than by the assurance that we only wrote MATCH).
	const GRAPH_MEASURE_QUERIES = [
		{
			name: 'optionSetSubClassOfCount',
			cypher: `MATCH (os:ForgedNode {role:'DmeOptionSet', _source:'CEDS'})-[:SUBCLASS_OF]->(target:ForgedNode)
			         RETURN count(*) AS value`,
		},
		{
			name: 'classSubClassOfCount',
			cypher: `MATCH (c:ForgedNode {role:'DmeClass', _source:'CEDS'})-[:SUBCLASS_OF]->(target:ForgedNode {role:'DmeClass'})
			         RETURN count(*) AS value`,
		},
		{
			// S-2. An edge whose target is absent is invisible to a count of edges, which is
			// why this asks the question from the other end.
			name: 'danglingSubClassOfCount',
			cypher: `MATCH (n:ForgedNode {_source:'CEDS'})-[r:SUBCLASS_OF]->(target)
			         WHERE target.cedsId IS NULL
			         RETURN count(r) AS value`,
		},
		{
			name: 'wellFormedRestrictionCount',
			cypher: `MATCH (r:ForgedNode {role:'DmeRestriction', _source:'CEDS'})
			         WHERE r.onProperty IS NOT NULL AND r.allValuesFrom IS NOT NULL
			         RETURN count(r) AS value`,
		},
		{
			// S-6. The comparison must be SHAPE-AWARE for the same reason the compiler's read
			// had to be: 2,068 of 2,324 property nodes store allDomainIds as a scalarized
			// string, so a naive p.allDomainIds[0] returns a CHARACTER on most of the corpus
			// and the mismatch count becomes nonsense that looks like data.
			name: 'domainEdgeScalarMismatchCount',
			cypher: `MATCH (p:ForgedNode {role:'DmeProperty', _source:'CEDS'})
			         WHERE p.domainId IS NOT NULL AND p.allDomainIds IS NOT NULL
			         WITH p, CASE WHEN valueType(p.allDomainIds) STARTS WITH 'LIST'
			                      THEN p.allDomainIds[0] ELSE p.allDomainIds END AS firstDomain
			         WHERE firstDomain <> p.domainId
			         RETURN count(p) AS value`,
		},
		{
			// A-1. crossRefs[0].raw is the SOLE carrier of the source dc:identifier for every
			// option set and option value, whose cedsId is a REWRITE (C000002 -> OS000002).
			// If it ever stops being written, 20,511 statements become unreconstructible while
			// every entity still looks perfectly healthy.
			name: 'crossRefsRawPresentCount',
			cypher: `MATCH (n:ForgedNode {_source:'CEDS'})
			         WHERE n.role IN ['DmeOptionSet','DmeOptionValue']
			           AND n.crossRefs IS NOT NULL AND n.crossRefs CONTAINS '"raw"'
			         RETURN count(n) AS value`,
		},
		{
			name: 'metaVocabularyEmbeddedCount',
			cypher: `MATCH (n:ForgedNode {role:'${META_VOCABULARY_ROLE}', _source:'CEDS'})
			         WHERE n.embedding IS NOT NULL
			         RETURN count(n) AS value`,
		},
		{
			// D-2. The DME browses by POSITIVE role selection, so a meta-vocabulary node is
			// reachable only if it wears a data role. This asks exactly that question.
			name: 'metaVocabularyReachableByBrowseCount',
			cypher: `MATCH (n:ForgedNode {_source:'CEDS'})
			         WHERE n.isMetaVocabulary = true
			           AND n.role IN ['DmeClass','DmeProperty','DmeOptionSet','DmeOptionValue']
			         RETURN count(n) AS value`,
		},
		{
			// M-3, the Phase-0 Q2 lesson: the fingerprint and diff scope is :ForgedNode ONLY,
			// so a new node kind that forgets the super-label is invisible to the very gates
			// meant to verify it.
			//
			// ANCHORED ON THE NEW LABELS, deliberately. The obvious phrasing --
			// MATCH (n {_source:'CEDS'}) WHERE NOT n:ForgedNode -- has no label to start from
			// and makes Neo4j scan every node in the database. It hung this measure past two
			// minutes on first run. Naming the labels this revision mints turns it into a
			// label scan that costs nothing, and returns 0 instantly while those labels have
			// no members yet.
			name: 'mintedNodesMissingForgedNodeLabel',
			cypher: `MATCH (n)
			         WHERE (n:DmeVocabularyTerm OR n:DmeEditHistoryEntry OR n:DmeRestriction)
			           AND NOT n:ForgedNode
			         RETURN count(n) AS value`,
		},
	];

	const measureGraph = ({ containerName, neo4jDriverModule } = {}, callback) => {
		if (!containerName) {
			callback(`${moduleName}.measureGraph: containerName is REQUIRED and has no default.`);
			return;
		}
		const refusals = GRAPH_MEASURE_QUERIES.map((oneMeasure) =>
			refuseIfWriteClause(oneMeasure.cypher),
		).filter((one) => one);
		if (refusals.length) {
			callback(refusals.join(' | '));
			return;
		}

		compilerLib.resolveContainerBolt({ containerName }, (resolveError, resolved) => {
			if (resolveError) {
				callback(`${moduleName}.measureGraph: ${resolveError}`);
				return;
			}
			const neo4j = neo4jDriverModule || require('neo4j-driver');
			const driver = neo4j.driver(
				resolved.boltUrl,
				neo4j.auth.basic(resolved.user, resolved.password),
			);
			const session = driver.session();
			const graphMeasures = {};

			// TEARDOWN IS PROMISE-SHAPED. neo4j-driver's session.close() and driver.close()
			// return Promises; they do NOT take a callback. Handing them one is silent --
			// no error, no warning, the callback simply never fires and the whole measurement
			// hangs forever looking like a slow query. It cost a wrong diagnosis here: nine
			// queries were timed and found innocent (all under 100ms) before the teardown was
			// suspected at all.
			const finish = (errorString) => {
				session
					.close()
					.then(() => driver.close())
					.then(() => {
						callback(errorString || '', errorString ? undefined : { graphMeasures, resolved });
					})
					.catch((closeError) => {
						callback(`${moduleName}.measureGraph: teardown failed: ${closeError.message}`);
					});
			};

			const runOne = (index) => {
				if (index >= GRAPH_MEASURE_QUERIES.length) {
					runCensus();
					return;
				}
				const oneMeasure = GRAPH_MEASURE_QUERIES[index];
				session
					.run(oneMeasure.cypher)
					.then((result) => {
						const row = result.records[0];
						graphMeasures[oneMeasure.name] = row ? Number(row.get('value').toString()) : 0;
						runOne(index + 1);
					})
					.catch((queryError) => {
						// A measure that ERRORED is not supplied. It is never zero: zero is a
						// passing value for most of these, and a failed query silently passing its
						// gate is the exact bug this suite exists to prevent.
						record(`graph:${oneMeasure.name}`, `query failed: ${queryError.message}`);
						runOne(index + 1);
					});
			};

			// The role census answers D-3 and D-4 together, from one pass.
			const runCensus = () => {
				session
					.run(`MATCH (n:ForgedNode) RETURN n.role AS role, count(*) AS value`)
					.then((result) => {
						const rolesPresent = [];
						const preExistingRoleCounts = {};
						result.records.forEach((oneRecord) => {
							const role = oneRecord.get('role');
							const value = Number(oneRecord.get('value').toString());
							if (!role) {
								return;
							}
							rolesPresent.push(role);
							if (PRE_EXISTING_ROLES.includes(role)) {
								preExistingRoleCounts[role] = value;
							}
						});
						graphMeasures.preExistingRoleCounts = preExistingRoleCounts;

						// D-3: the roles the graph carries versus the roles the DME documents. This
						// gate exists because the doc claimed six while the graph carried eight,
						// for weeks, and nothing noticed.
						if (!fs.existsSync(DOCUMENTED_ROLES_SOURCE_PATH)) {
							record(
								'graph:rolesPresentVersusDocumented',
								`the DME schema provider '${DOCUMENTED_ROLES_SOURCE_PATH}' is not readable from here`,
							);
						} else {
							const documentedText = fs.readFileSync(DOCUMENTED_ROLES_SOURCE_PATH, 'utf8');
							const onlyInGraph = rolesPresent.filter(
								(oneRole) => documentedText.indexOf(oneRole) < 0,
							);
							graphMeasures.rolesPresentVersusDocumented = {
								equal: onlyInGraph.length === 0,
								onlyInLeft: onlyInGraph,
								onlyInRight: [],
							};
						}

						// S-5 integrity is a conjunction, so it is measured as one boolean with its
						// parts kept for the report. Absent enrichment there are no history nodes at
						// all, which is a FAILING state and correctly reported as such.
						session
							.run(
								// COUNT EACH LEG INDEPENDENTLY. The first version ended with a plain
								// MATCH on `n.editHistory IS NOT NULL`, which acts as a FILTER ON THE
								// WHOLE QUERY: when zero nodes store history as a property -- the
								// CORRECT state -- that MATCH returns no rows and the entire result
								// vanishes, so entries and owned both read 0 and the gate failed
								// against a perfectly good graph. A gate that goes red when the thing
								// it wants is true is worse than no gate.
								`CALL () { MATCH (e:ForgedNode {role:'DmeEditHistoryEntry', _source:'CEDS'})
								           RETURN count(e) AS entries }
								 CALL () { MATCH (:ForgedNode)-[r:HAS_EDIT_HISTORY]->(:ForgedNode {role:'DmeEditHistoryEntry'})
								           RETURN count(r) AS owned }
								 CALL () { MATCH (n:ForgedNode {_source:'CEDS'}) WHERE n.editHistory IS NOT NULL
								           RETURN count(n) AS storedAsProperty }
								 RETURN entries, owned, storedAsProperty`,
							)
							.then((historyResult) => {
								const row = historyResult.records[0];
								const entries = row ? Number(row.get('entries').toString()) : 0;
								const owned = row ? Number(row.get('owned').toString()) : 0;
								const storedAsProperty = row
									? Number(row.get('storedAsProperty').toString())
									: 0;
								graphMeasures.editHistoryIntegrity =
									entries === 1920 && owned === entries && storedAsProperty === 0;
								graphMeasures.editHistoryDetail = { entries, owned, storedAsProperty };
								finish('');
							})
							.catch((historyError) => {
								record('graph:editHistoryIntegrity', `query failed: ${historyError.message}`);
								finish('');
							});
					})
					.catch((censusError) => {
						record('graph:preExistingRoleCounts', `census failed: ${censusError.message}`);
						record('graph:rolesPresentVersusDocumented', `census failed: ${censusError.message}`);
						finish('');
					});
			};

			runOne(0);
		});
	};

	// =================================================================================
	// deriveIndependentRdfProbe — C-3, and the only measure NOT computed by our own code
	// =================================================================================
	// ⟪TQ, 2026-08-02⟫ "Gate C3 should be updated." It used to ask for an independently
	// derived statement COUNT. The strong form is a TRIPLE-SET comparison by a parser that
	// shares no code with ours, because our canonicalizer collapses internal whitespace on
	// both sides by design -- which made 20 differing triples invisible to it while it
	// honestly reported zero.
	//
	// Slow by nature: it parses a 19MB RDF/XML document twice, ~90s for the CEDS pair. That
	// is the price of an outside opinion and it is worth paying once per acceptance run.
	const deriveIndependentRdfProbe = ({ sourcePath, emittedPath } = {}, callback) => {
		if (!sourcePath || !emittedPath) {
			record(
				'probe:independentRdfGraphsIdentical',
				'no sourcePath/emittedPath supplied, so the independent RDF comparison did not run',
			);
			callback('', {});
			return;
		}
		independentCheckLib.compareRdfDocuments({ sourcePath, emittedPath }, (compareError, result) => {
			if (compareError) {
				// UNAVAILABLE IS NOT PASSING. If python3 or rdflib is missing the gate must read
				// UNMEASURED with the reason attached -- never green by default.
				record('probe:independentRdfGraphsIdentical', compareError);
				callback('', {});
				return;
			}
			callback('', {
				independentRdfGraphsIdentical: result.comparison.identical === true,
				independentRdfComparison: result.comparison,
			});
		});
	};

	// =================================================================================
	// measures this module will NOT fake
	// =================================================================================
	// Recorded as unsupplied WITH REASONS so their gates report UNMEASURED and a reader
	// learns why rather than wondering. Each is a real piece of work, not an oversight.
	const recordDeferredMeasures = () => {
		record(
			'probe:forgeDeterminism',
			'needs two full CEDS forges of identical source and a statement-set comparison. ' +
				'Real, affordable, and not yet run.',
		);
		record(
			'probe:emissionUnchangedWithHubStripped',
			'needs a compile of the same read with hub-only properties stripped. The seams exist ' +
				'(readAll and compileToFile are separable); the probe is not yet written.',
		);
		record(
			'probe:compilesWithSourceAbsent',
			'needs a compile driven with the source ontology renamed away. The compile path never ' +
				'opens the source today (verified by reading), but this gate wants it PROVEN by running.',
		);
		record(
			'probe:spellingInvariance',
			'proven inside test-cedsRoundTrip.js against the A/B fixtures; not yet surfaced here as ' +
				'a gate measure.',
		);
		record(
			'probe:allDomainIdsShapeAgnostic',
			'needs a fixture pair feeding the compiler the scalarized and array forms of the same ' +
				'declaration. The behaviour was verified live (2,068 scalar vs 256 array, counts ' +
				'unchanged); the gate wants it repeatable.',
		);
		record(
			'probe:identifierDatatypeExclusive',
			'needs an emission-side check that xsd:token appears on all 23,237 identifiers and ' +
				'nowhere else.',
		);
		record(
			'graph:hubStatementsInEmission',
			'needs the emitted RDF parsed and searched for hub subjects. The compiler excludes hub ' +
				'roles by explicit filter (L-4 passes); this gate wants the OUTPUT watched, not the code read.',
		);
	};

	return {
		loadSuiteFacts,
		measureGraph,
		deriveIndependentRdfProbe,
		recordDeferredMeasures,
		GRAPH_MEASURE_QUERIES,
		deriveReportMeasures,
		deriveSuiteMeasures,
		deriveStaticProbes,
		deriveCanonicalProbes,
		deriveDiffProbes,
		refuseIfWriteClause,
		unsupplied,
		record,
		PRE_EXISTING_ROLES,
		META_VOCABULARY_ROLE,
		HUB_ONLY_PROPERTY_KEYS,
		DOCUMENTED_ROLES_SOURCE_PATH,
		SUITE_FACTS_PATH,
		ADVERSARIAL_PAIRS,
	};
};

module.exports = roundTripGateMeasures;
