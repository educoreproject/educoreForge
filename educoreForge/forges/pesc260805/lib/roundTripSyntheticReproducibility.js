'use strict';

// roundTripSyntheticReproducibility.js (forge-pesc260805) — R-VAL-5, AND IT IS A DIFFERENT
// INSTRUMENT FROM FIDELITY.
//
// Synthetic content cannot be round-trip validated against a source file: it matches none by
// construction, because it is a DECISION rather than a transcription. It is validated instead by
// REPRODUCIBILITY OF ITS DERIVATION — re-running the documented synthesis rule over the preserved
// inputs must reproduce exactly what is in the graph. The validator owns both instruments and must
// never conflate them, which is why this result travels in its own verdict field and is never
// folded into lostTotal or inventedTotal.
//
// THE TRAP THIS MODULE EXISTS TO AVOID, named by the supervisor before a line was written:
// "if it re-runs the rule by calling the same function the tier calls, it proves the function
// equals itself." That is the pure-function shape that produced four vacuous gates in Phase 4.6a —
// a check comparing two derivations of one input is a THEOREM, not a measurement.
//
// SO NOTHING HERE TOUCHES lib/syntheticTier.js. The independence is structural, on three axes:
//
//   1. A DIFFERENT PARSER. syntheticTier's inputs come from lib/parser.js, which navigates XSD by
//      REGEX. This module parses the same bytes with xml2js — a real XML parse. A navigation bug in
//      either cannot cancel out, because they do not share a line of code.
//   2. A DIFFERENT UNION. The S-1 rule is re-implemented here from the SPEC's words (§6.2), not
//      imported.
//   3. THE BRANCHES ARE IDENTIFIED BY CONTENT, NOT BY A PINNED HASH. The college-transcript member
//      is the one declaring RequestType / ResponseType / TranscriptHoldType; the test-score member
//      declares TestScoreReportType / EducationTestScoresType (SPEC §3.2). Pinning a sha256 here
//      would make this check agree with whatever the last build happened to produce — a constant
//      compared against a constant. Deriving the branch from what the FILES SAY lets the data move
//      the answer, which is the whole requirement.
//
// THE EXPECTED VALUE THEREFORE COMES FROM THE PRESERVED SOURCE FILES; the actual value comes from
// the GRAPH over bolt. Two bases the system publishes independently. Mutating either one moves the
// verdict, which is what makes this a check rather than a theorem.
//
// READ-ONLY. Refuses by name on every absent input; nothing here is defaulted.
// House style: no async/await, no try/catch for control flow.

const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const CONTESTED_NAMESPACE = 'urn:org:pesc:sector:AcademicRecord:v1.6.0';

// The XSD top-level constructs that are NAMED DEFINITIONS, and the kind token each carries in the
// graph. A registry, so the set is data rather than a switch.
const NAMED_DEFINITION_RULE_LIST = [
	{ xsdElementName: 'xs:complexType', kind: 'complexType' },
	{ xsdElementName: 'xs:simpleType', kind: 'simpleType' },
	{ xsdElementName: 'xs:element', kind: 'element' },
	{ xsdElementName: 'xs:group', kind: 'group' },
	{ xsdElementName: 'xs:attributeGroup', kind: 'attributeGroup' },
];

// Branch fingerprints from SPEC §3.2 — measured facts about what each published file declares.
// Used to IDENTIFY the branches from their content; never to decide the merge outcome.
const COLLEGE_BRANCH_MARKER_NAME_LIST = ['RequestType', 'ResponseType', 'TranscriptHoldType'];
const TEST_SCORE_BRANCH_MARKER_NAME_LIST = ['TestScoreReportType', 'EducationTestScoresType'];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// readNamedDefinitionsFromXsdText — top-level named definitions only, by a real XML parse.
		const readNamedDefinitionsFromXsdText = ({ xsdText, filename }, callback) => {
			xml2js.parseString(xsdText, (parseError, parsedDocument) => {
				if (parseError) {
					callback(
						`${moduleName}: XML parse of '${filename}' failed: ${parseError.message}. A ` +
							`preserved synthesis input that cannot be parsed is refused BY NAME — never ` +
							`skipped, because a skipped input yields a smaller union that looks like a ` +
							`successful comparison.`,
					);
					return;
				}
				const schemaElement = parsedDocument && parsedDocument['xs:schema'];
				if (!schemaElement) {
					callback(
						`${moduleName}: '${filename}' has no xs:schema root element. Refused by name.`,
					);
					return;
				}
				const definitionByQualifiedName = new Map();
				NAMED_DEFINITION_RULE_LIST.forEach((oneRule) => {
					(schemaElement[oneRule.xsdElementName] || []).forEach((oneDefinitionElement) => {
						const declaredName =
							oneDefinitionElement &&
							oneDefinitionElement['$'] &&
							oneDefinitionElement['$'].name;
						if (!declaredName) {
							return; // a top-level construct with no name is not a named definition
						}
						definitionByQualifiedName.set(`${oneRule.kind}/${declaredName}`, {
							kind: oneRule.kind,
							name: declaredName,
						});
					});
				});
				callback('', { filename, definitionByQualifiedName });
			});
		};

		// -----
		// classifyBranchesByContent — which preserved file is the college-transcript member and
		// which is the test-score member, decided by what each DECLARES. Refuses when the markers
		// do not separate the two cleanly, rather than picking one.
		const classifyBranchesByContent = ({ branchReadingList }) => {
			const scoredBranchList = branchReadingList.map((oneReading) => {
				const declaredNameList = Array.from(oneReading.definitionByQualifiedName.values()).map(
					(oneDefinition) => oneDefinition.name,
				);
				return {
					...oneReading,
					collegeMarkerHits: COLLEGE_BRANCH_MARKER_NAME_LIST.filter((oneMarker) =>
						declaredNameList.includes(oneMarker),
					).length,
					testScoreMarkerHits: TEST_SCORE_BRANCH_MARKER_NAME_LIST.filter((oneMarker) =>
						declaredNameList.includes(oneMarker),
					).length,
				};
			});
			const collegeBranch = scoredBranchList.find(
				(oneBranch) => oneBranch.collegeMarkerHits > oneBranch.testScoreMarkerHits,
			);
			const testScoreBranch = scoredBranchList.find(
				(oneBranch) => oneBranch.testScoreMarkerHits > oneBranch.collegeMarkerHits,
			);
			if (!collegeBranch || !testScoreBranch || collegeBranch === testScoreBranch) {
				throw new Error(
					`${moduleName}: the two preserved AcademicRecord v1.6.0 members could not be told ` +
						`apart by their declared content. Marker hits: ` +
						`${scoredBranchList
							.map(
								(oneBranch) =>
									`${oneBranch.filename} college=${oneBranch.collegeMarkerHits} ` +
									`testScore=${oneBranch.testScoreMarkerHits}`,
							)
							.join('; ')}. Refused BY NAME rather than guessing which branch wins — ` +
						`choosing the wrong winner would silently invert the S-1 ruling.`,
				);
			}
			return { collegeBranch, testScoreBranch };
		};

		// -----
		// computeS1Union — the S-1 rule, re-implemented from SPEC §6.2: the UNION of named
		// definitions from the two published files; where BOTH define a name, the college-transcript
		// definition WINS. Yields the merged AcademicRecord v1.6.0 definition set.
		const computeS1Union = ({ collegeBranch, testScoreBranch }) => {
			const unionByQualifiedName = new Map();
			testScoreBranch.definitionByQualifiedName.forEach((oneDefinition, oneQualifiedName) => {
				unionByQualifiedName.set(oneQualifiedName, { ...oneDefinition, branch: 'testScore' });
			});
			collegeBranch.definitionByQualifiedName.forEach((oneDefinition, oneQualifiedName) => {
				// college wins on conflict — the whole content of the rule, applied last
				unionByQualifiedName.set(oneQualifiedName, { ...oneDefinition, branch: 'college' });
			});
			return unionByQualifiedName;
		};

		// -----
		// readGraphSyntheticDefinitions — the ACTUAL side, over bolt.
		const readGraphSyntheticDefinitions = (
			{ boltUrl, user, password },
			callback,
		) => {
			const neo4j = require('neo4j-driver');
			const driver = neo4j.driver(boltUrl, neo4j.auth.basic(user, password));
			const session = driver.session();
			const cypher =
				"MATCH (oneNode:PescNamedDefinition) WHERE oneNode.pescTier = 'synthetic' " +
				"AND oneNode.syntheticRule = 'S-1' " +
				'RETURN oneNode.kind AS kind, oneNode.name AS name, oneNode.stableId AS stableId';
			session
				.run(cypher)
				.then((runResult) => {
					const graphDefinitionByQualifiedName = new Map();
					runResult.records.forEach((oneRecord) => {
						const kind = oneRecord.get('kind');
						const name = oneRecord.get('name');
						if (kind === null || name === null) {
							return;
						}
						graphDefinitionByQualifiedName.set(`${kind}/${name}`, {
							kind,
							name,
							stableId: oneRecord.get('stableId'),
						});
					});
					session
						.close()
						.then(() => driver.close())
						.then(() => callback('', { graphDefinitionByQualifiedName }))
						.catch((closeError) =>
							callback(`${moduleName}: driver close failed: ${closeError.message}`),
						);
				})
				.catch((runError) => {
					session.close().catch(() => {});
					driver.close().catch(() => {});
					callback(
						`${moduleName}: synthetic-tier graph read failed: ${runError.message}. Verify the ` +
							`bolt port was resolved from the CONTAINER.`,
					);
				});
		};

		// =====================================================================
		// checkReproducibility — the whole instrument.
		// =====================================================================
		const checkReproducibility = (
			{ snapshotPath, boltUrl, user, password } = {},
			callback,
		) => {
			const missingNameList = [
				['snapshotPath', snapshotPath],
				['boltUrl', boltUrl],
				['user', user],
				['password', password],
			]
				.filter(([, oneValue]) => oneValue === undefined || oneValue === null || oneValue === '')
				.map(([oneName]) => oneName);
			if (missingNameList.length) {
				callback(
					`${moduleName}.checkReproducibility: missing required input(s): ` +
						`${missingNameList.join(', ')}. Each is REQUIRED and none has a default.`,
				);
				return;
			}

			const taskList = new taskListPlus();

			// locate the PRESERVED collision members in the snapshot
			taskList.push((args, next) => {
				const collisionFilenameList = fs
					.readdirSync(snapshotPath)
					.filter(
						(oneName) =>
							oneName.endsWith('.xsd') &&
							oneName.startsWith('AcademicRecord_v1.6.0') &&
							oneName.includes('collision'),
					)
					.sort();
				if (collisionFilenameList.length !== 2) {
					next(
						`${moduleName}: expected exactly 2 preserved AcademicRecord v1.6.0 collision ` +
							`members in '${snapshotPath}', found ${collisionFilenameList.length} ` +
							`(${collisionFilenameList.join(', ') || 'none'}). S-1 is a union of TWO files; ` +
							`refused by name rather than synthesised from whatever is present.`,
					);
					return;
				}
				next('', { ...args, collisionFilenameList });
			});

			// EXPECTED — from the preserved inputs, by an independent parse
			taskList.push((args, next) => {
				const branchReadingList = [];
				const readNextBranch = (branchIndex) => {
					if (branchIndex >= args.collisionFilenameList.length) {
						const { collegeBranch, testScoreBranch } = classifyBranchesByContent({
							branchReadingList,
						});
						const expectedUnionByQualifiedName = computeS1Union({
							collegeBranch,
							testScoreBranch,
						});
						next('', {
							...args,
							collegeBranchFilename: collegeBranch.filename,
							testScoreBranchFilename: testScoreBranch.filename,
							collegeBranchDefinitionCount: collegeBranch.definitionByQualifiedName.size,
							testScoreBranchDefinitionCount: testScoreBranch.definitionByQualifiedName.size,
							expectedUnionByQualifiedName,
						});
						return;
					}
					const oneFilename = args.collisionFilenameList[branchIndex];
					readNamedDefinitionsFromXsdText(
						{
							xsdText: fs.readFileSync(path.join(snapshotPath, oneFilename), 'utf8'),
							filename: oneFilename,
						},
						(readError, reading) => {
							if (readError) {
								next(readError);
								return;
							}
							branchReadingList.push(reading);
							readNextBranch(branchIndex + 1);
						},
					);
				};
				readNextBranch(0);
			});

			// ACTUAL — from the graph
			taskList.push((args, next) => {
				readGraphSyntheticDefinitions({ boltUrl, user, password }, (readError, readResult) => {
					if (readError) {
						next(readError);
						return;
					}
					next('', { ...args, ...readResult });
				});
			});

			// COMPARE — exact match required (R-VAL-5)
			taskList.push((args, next) => {
				const expectedQualifiedNameList = Array.from(args.expectedUnionByQualifiedName.keys());
				const graphQualifiedNameList = Array.from(args.graphDefinitionByQualifiedName.keys());

				// An empty expectation cannot be compared. Absence made a recorded fact.
				if (!expectedQualifiedNameList.length) {
					next(
						`${moduleName}: the recomputed S-1 union is EMPTY. Two preserved files that yield ` +
							`no named definitions is a broken read, not a merge of nothing — refused by name ` +
							`rather than compared, because an empty expectation matched against an empty ` +
							`actual would report reproducible:true having proven nothing.`,
					);
					return;
				}

				const missingFromGraphList = expectedQualifiedNameList.filter(
					(oneQualifiedName) => !args.graphDefinitionByQualifiedName.has(oneQualifiedName),
				);
				const unexpectedInGraphList = graphQualifiedNameList.filter(
					(oneQualifiedName) => !args.expectedUnionByQualifiedName.has(oneQualifiedName),
				);

				next('', {
					...args,
					result: {
							rule: 'S-1',
						// COVERAGE, DECLARED AT REMEDIATION (review item 9). The shipped field was
						// an unqualified `syntheticReproducible: true`, which reads as "the
						// synthetic tier reproduces". It does not say that and never did. What is
						// checked is S-1's kind/name pairs — 109 of the graph's 632 synthetic
						// nodes, IDENTITY ONLY, not content. What is NOT checked is stated here
						// rather than left to be discovered: S-1c's 522 duplicated children (the
						// whole Phase 4.6a product) and S-2's namespace alias. A true that covers
						// 17% while sounding like 100% is the kind of claim this campaign exists
						// to stop, so the coverage travels WITH the boolean and cannot be read
						// apart from it.
						coverage: {
							checkedRuleList: ['S-1'],
							uncheckedRuleList: ['S-1c', 'S-2'],
							checkedNodeCount: expectedQualifiedNameList.length,
							syntheticNodeTotalInGraph: 632,
							comparisonBasis: 'kind/name identity only — CONTENT IS NOT COMPARED',
							statement:
								'reproducible=true means S-1 IDENTITY reproduces. It does NOT mean the ' +
								'synthetic tier reproduces: S-1c (522 children) and S-2 are UNCHECKED, ' +
								'and no synthetic node CONTENT is compared.',
						},
						description:
							'Merged AcademicRecord v1.6.0: union of named definitions from the two preserved ' +
							'collision members, college-transcript winning on name conflict (SPEC 6.2). ' +
							'Recomputed here by an INDEPENDENT xml2js parse and an independent union; ' +
							'compared against the graph synthetic tier over bolt. Shares no code with ' +
							'lib/syntheticTier.js.',
						contestedNamespace: CONTESTED_NAMESPACE,
						collegeBranchFilename: args.collegeBranchFilename,
						testScoreBranchFilename: args.testScoreBranchFilename,
						collegeBranchDefinitionCount: args.collegeBranchDefinitionCount,
						testScoreBranchDefinitionCount: args.testScoreBranchDefinitionCount,
						expectedUnionTotal: expectedQualifiedNameList.length,
						graphSyntheticTotal: graphQualifiedNameList.length,
						comparedTotal: expectedQualifiedNameList.length,
						missingFromGraphTotal: missingFromGraphList.length,
						unexpectedInGraphTotal: unexpectedInGraphList.length,
						missingFromGraphList: missingFromGraphList.slice(0, 40),
						unexpectedInGraphList: unexpectedInGraphList.slice(0, 40),
						reproducible:
							missingFromGraphList.length === 0 && unexpectedInGraphList.length === 0,
					},
				});
			});

			pipeRunner(taskList.getList(), {}, (pipeError, args) => {
				if (pipeError) {
					callback(pipeError);
					return;
				}
				callback('', args.result);
			});
		};

		return {
			checkReproducibility,
			computeS1Union,
			classifyBranchesByContent,
			readNamedDefinitionsFromXsdText,
			CONTESTED_NAMESPACE,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
