'use strict';

// roundTripSifCanonical.js (forge-sif) — THE STATEMENT DOMAIN. Mints the canonical SIF statement
// set from EITHER side of the round trip: statementsFromTsvText reads the committed snapshot's
// ImplementationSpecification TSV (the answer key, RT-5 — its bytes enter the instrument exactly
// once, here); statementsFromSifGraph reads the materialized-graph payload the compiler assembles.
// Both minters live in ONE module so the identity rules (subjects, predicates, statement keys,
// grouping) are shared code — but the source minter never sees the graph and the graph minter
// never opens a file, and NEITHER path touches the forge's own lib/parser.js (independence of
// code path, the R-WO-14 precedent: a validator that parses with the forge's parser can only
// prove the forge agrees with itself).
//
// ORDER IS PART OF STATEMENT IDENTITY (R-SF-1, TQ ruling: "Element sequence is important").
// Mechanism ruled R-SF-7 (AMBER_TOWER, 2026-08-04): ALL-PAIRS PRECEDENCE statements per sibling
// group — for every ordered pair X-before-Y in a group, one statement `precedesInGroup`. The
// calculus this buys:
//   * a SWAP flips exactly the affected pairs — source pair LOST + reversed emitted pair
//     INVENTED, naming the group and both members (the strongest legible RED);
//   * a MISSING member degrades to located LOST only (its field statements + its precedence
//     pairs) — never a false INVENTED. The hard line (INVENTED=0) is never spent to express
//     loss (the R-WO-15(f) principle applied to sequence);
//   * REPRODUCED means exactly relative-order-preserved.
// Absolute ordinals are deliberately NOT statements (rank = predecessor count; derivable), and
// the rejected rival forms (ordinal-in-identity, group-level tuple) are recorded in the design
// note ruled R-SF-7 in DEVLOG-sifRoundTripForge-080326.md.
//
// ORDER SEMANTICS ARE DOCUMENT-ORDER-ONLY (R-SF-8, same ruling): the source states row order and
// nothing else; the instrument never consults the scratch-held published-XSD corpus for
// compositor facts. Normativity, if ever wanted, is FORGE-side enrichment via a ruled,
// checksummed snapshot input — never an instrument side-channel.
//
// GRAMMAR YES, DATA NO (RT-5). This module knows the TSV's grammar: the `<TableName>: Table N`
// section delimiter (the numeric suffix is export pagination apparatus — a section delimiter the
// format itself requires on every table — recognized and NOT minted as a statement), the literal
// 8-column header row that must follow every section header (verified corpus-wide by the test
// suite before being admitted here), cell-trim, and the xpath path grammar. It contains NO
// source value: every object in every statement is read from the input handed in.
//
// THE STATEMENT VOCABULARY (verbatim trimmed cell values; absent is absent — an empty cell mints
// NO statement, RT-2 symmetry):
//   sif:object/<tableName>   objectTableName     the sheet name, verbatim (truncations included —
//                                                it is a source statement in its own right)
//                            objectElementName   the xpath-stated singular element name (the D2
//                                                derivation, independently re-implemented here)
//   sif:field/<xpath>        fieldName, fieldMandatory, fieldCharacteristics, fieldType,
//                            fieldDescription, fieldCedsId, fieldFormat — one predicate per
//                            source column, so every loss class localizes to its column
//   sif:group/<elementName>/<parentSegments|(root)>
//                            precedesInGroup     `<xpathA> precedes <xpathB>` (R-SF-7 pairs)
//
// Pure, callback-shaped (R7), no I/O — callers hand in text or the graph payload. No
// async/await, no try/catch for control flow (the one try/catch below wraps JSON.parse of the
// crossRefs carrier, resolved to a fault value).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const STANDARD_SOURCE = 'SIF';
const SUBJECT_SCHEME = 'sif:';
const ROOT_GROUP_TOKEN = '(root)';

// the TSV grammar constants (verified against the whole real snapshot in test section 1 before
// being admitted as grammar — the pesc uniform-constant discipline).
const TABLE_SECTION_PATTERN = /^(.+):\s*Table\s+\d+\s*$/;
const LITERAL_COLUMN_HEADER = [
	'Name',
	'Mandatory',
	'Characteristics',
	'Type',
	'Description',
	'XPath',
	'CEDS ID',
	'Format',
].join('\t');

// column index -> field predicate. Registry, not switch. Mandatory (index 1) is handled apart —
// its stated value is minted verbatim, whatever it is, so a non-'*' marking the source might
// carry is never silently coerced.
const FIELD_CELL_PREDICATE_REGISTRY = [
	{ cellIndex: 0, predicate: 'fieldName' },
	{ cellIndex: 1, predicate: 'fieldMandatory' },
	{ cellIndex: 2, predicate: 'fieldCharacteristics' },
	{ cellIndex: 3, predicate: 'fieldType' },
	{ cellIndex: 4, predicate: 'fieldDescription' },
	{ cellIndex: 6, predicate: 'fieldCedsId' },
	{ cellIndex: 7, predicate: 'fieldFormat' },
];

// graph field property -> predicate (the re-emission side of the same registry). mandatory and
// cedsId have their own carriers (boolean -> '*'; crossRefs raw) handled at the mint site.
const GRAPH_FIELD_PREDICATE_REGISTRY = [
	{ propertyName: 'name', predicate: 'fieldName' },
	{ propertyName: 'characteristics', predicate: 'fieldCharacteristics' },
	{ propertyName: 'nativeType', predicate: 'fieldType' },
	{ propertyName: 'description', predicate: 'fieldDescription' },
	{ propertyName: 'format', predicate: 'fieldFormat' },
];

// LOST categorization (RT-6, the pesc declaredContext/contentGap refinement): declaredContext
// must be CLAIMED by name, never assumed. SIF's statement domain has no we-chose-not-to-carry
// class — the `: Table N` suffix is section-delimiter grammar (not minted), so every loss in
// this domain is contentGap: enrichment work, named to the backlog. The registry exists, is
// empty, and is the visible place a future ruling would claim a predicate.
const DECLARED_CONTEXT_PREDICATES = [];

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// shared identity helpers — ONE implementation each, used by both minters, so the two
		// sides cannot drift on what a subject or a statement key IS.

		const statementKeyFor = ({ subject, predicate, object }) =>
			`${subject}\t${predicate}\t${object}`;

		// the xpath's non-empty segments: '/Tables/Table/A/B/Field' -> [Tables, Table, A, B, Field].
		const nonEmptySegmentsOf = (xpath) => String(xpath).split('/').filter((onePart) => onePart);

		// the sibling-group parent segments: everything between the object element and the leaf.
		// [Tables, Table, A, B, Field] -> [A, B]; [Tables, Table, Field] -> [] (a root member).
		const parentSegmentListFromXpath = (xpath) => nonEmptySegmentsOf(xpath).slice(2, -1);

		const groupSubjectFor = ({ objectElementName, parentSegmentList }) =>
			`sif:group/${objectElementName}/${
				parentSegmentList.length ? parentSegmentList.join('/') : ROOT_GROUP_TOKEN
			}`;

		// -----
		// addStatement — into the Map, refusing duplicates (a domain where the same statement
		// mints twice has a broken identity rule; that is an instrument fault, not a diff result).
		const addStatement = ({ statements, faultList, subject, predicate, object, location }) => {
			const statementKey = statementKeyFor({ subject, predicate, object });
			if (statements.has(statementKey)) {
				faultList.push(
					`duplicate statement minted: ${subject} ${predicate} '${object}' (${location} and ` +
						`${statements.get(statementKey).location})`,
				);
				return;
			}
			statements.set(statementKey, { subject, predicate, object, location });
		};

		// -----
		// mintPrecedenceStatements — the R-SF-7 all-pairs expansion for one ordered group.
		const mintPrecedenceStatements = ({
			statements,
			faultList,
			groupSubject,
			orderedMemberList, // [{ xpath, location }] already in the side's own order
			stats,
		}) => {
			for (let earlierIndex = 0; earlierIndex < orderedMemberList.length; earlierIndex++) {
				for (
					let laterIndex = earlierIndex + 1;
					laterIndex < orderedMemberList.length;
					laterIndex++
				) {
					addStatement({
						statements,
						faultList,
						subject: groupSubject,
						predicate: 'precedesInGroup',
						object: `${orderedMemberList[earlierIndex].xpath} precedes ${orderedMemberList[laterIndex].xpath}`,
						location: `${orderedMemberList[earlierIndex].location} -> ${orderedMemberList[laterIndex].location}`,
					});
					stats.precedencePairCount++;
				}
			}
			const pairCount = (orderedMemberList.length * (orderedMemberList.length - 1)) / 2;
			if (orderedMemberList.length > stats.largestGroup.memberCount) {
				stats.largestGroup = {
					groupSubject,
					memberCount: orderedMemberList.length,
					pairCount,
				};
			}
		};

		const makeStats = () => ({
			tableCount: 0,
			fieldRowCount: 0,
			statementCount: 0,
			groupCount: 0,
			precedencePairCount: 0,
			largestGroup: { groupSubject: '', memberCount: 0, pairCount: 0 },
			emptyNameRowsSkipped: 0,
			unrecognizedLineCount: 0,
			columnHeadersVerified: 0,
			nonAsteriskMandatoryCellCount: 0,
		});

		// =====================================================================
		// statementsFromTsvText — the SOURCE side. TSV text in, statement Map out.
		// Refusals are BY NAME (RT-3): an unverifiable section header row, a field row without an
		// xpath, a duplicate xpath, a table with no (or conflicting) xpath-stated element name —
		// each stops the measurement rather than guessing.
		// =====================================================================

		const statementsFromTsvText = ({ tsvText } = {}, callback) => {
			if (typeof tsvText !== 'string' || tsvText.trim() === '') {
				callback(`${moduleName}.statementsFromTsvText: tsvText is REQUIRED and has no default.`);
				return;
			}

			const statements = new Map();
			const faultList = [];
			const stats = makeStats();

			const tableList = []; // { tableName, headerLineNumber, rowList: [{ lineNumber, cells }] }
			const tableNameSeen = {};
			const xpathSeen = {}; // xpath -> first lineNumber
			let currentTable = null;
			let expectColumnHeader = false;

			const lineList = tsvText.split('\n');
			for (let lineIndex = 0; lineIndex < lineList.length; lineIndex++) {
				const lineNumber = lineIndex + 1;
				const line = lineList[lineIndex].trimEnd();
				if (!line) {
					continue;
				}

				const sectionMatch = line.match(TABLE_SECTION_PATTERN);
				if (sectionMatch) {
					const tableName = sectionMatch[1].trim();
					if (tableNameSeen[tableName] !== undefined) {
						callback(
							`${moduleName}.statementsFromTsvText: table '${tableName}' appears twice ` +
								`(lines ${tableNameSeen[tableName]} and ${lineNumber}) — duplicate section ` +
								`identity is unmeasurable; refused by name.`,
						);
						return;
					}
					tableNameSeen[tableName] = lineNumber;
					currentTable = { tableName, headerLineNumber: lineNumber, rowList: [] };
					tableList.push(currentTable);
					expectColumnHeader = true;
					continue;
				}

				if (expectColumnHeader) {
					expectColumnHeader = false;
					if (line !== LITERAL_COLUMN_HEADER) {
						callback(
							`${moduleName}.statementsFromTsvText: table '${currentTable.tableName}' (line ` +
								`${lineNumber}) is not followed by the literal 8-column header row ` +
								`(Name/Mandatory/Characteristics/Type/Description/XPath/CEDS ID/Format) — ` +
								`refusing to measure a section whose first row cannot be verified as the header.`,
						);
						return;
					}
					stats.columnHeadersVerified++;
					continue;
				}

				if (!currentTable) {
					// content before any section header — counted, and the gate suite asserts zero.
					stats.unrecognizedLineCount++;
					continue;
				}

				const cellList = line.split('\t').map((oneCell) => oneCell.trim());
				const fieldName = cellList[0] || '';
				if (!fieldName) {
					if (cellList.some((oneCell) => oneCell !== '')) {
						stats.emptyNameRowsSkipped++;
					}
					continue;
				}

				const xpath = cellList[5] || '';
				if (!xpath) {
					callback(
						`${moduleName}.statementsFromTsvText: field row '${fieldName}' in table ` +
							`'${currentTable.tableName}' (line ${lineNumber}) states no XPath — a field ` +
							`without its stated identity is unmeasurable; refused by name.`,
					);
					return;
				}
				if (nonEmptySegmentsOf(xpath).length < 2) {
					callback(
						`${moduleName}.statementsFromTsvText: field row '${fieldName}' (line ${lineNumber}) ` +
							`states xpath '${xpath}' with fewer than two segments — no element name is ` +
							`derivable; refused by name.`,
					);
					return;
				}
				if (xpathSeen[xpath] !== undefined) {
					callback(
						`${moduleName}.statementsFromTsvText: xpath '${xpath}' appears twice (lines ` +
							`${xpathSeen[xpath]} and ${lineNumber}) — duplicate field identity is ` +
							`unmeasurable; refused by name.`,
					);
					return;
				}
				xpathSeen[xpath] = lineNumber;

				currentTable.rowList.push({ lineNumber, cellList, xpath });
				stats.fieldRowCount++;
			}

			stats.tableCount = tableList.length;
			if (!tableList.length) {
				callback(
					`${moduleName}.statementsFromTsvText: the TSV contains no table sections — an empty ` +
						`source is a missing input, not an empty statement set.`,
				);
				return;
			}

			// per table: the xpath-stated element name (the D2 rule, independently re-implemented:
			// the SECOND non-empty xpath segment, required identical across the table's rows).
			for (const oneTable of tableList) {
				const statedElementNameList = [
					...new Set(
						oneTable.rowList
							.map((oneRow) => nonEmptySegmentsOf(oneRow.xpath)[1])
							.filter((onePart) => onePart),
					),
				];
				if (statedElementNameList.length === 0) {
					callback(
						`${moduleName}.statementsFromTsvText: table '${oneTable.tableName}' states no ` +
							`element name in any field xpath — refusing to guess a singular object name.`,
					);
					return;
				}
				if (statedElementNameList.length > 1) {
					callback(
						`${moduleName}.statementsFromTsvText: table '${oneTable.tableName}' states ` +
							`conflicting element names (${statedElementNameList.join(', ')}) — refusing to ` +
							`choose between them.`,
					);
					return;
				}
				oneTable.elementName = statedElementNameList[0];
			}

			// mint object + field statements, and collect the sibling groups in document order.
			const groupMap = new Map(); // groupSubject -> [{ xpath, location }]
			for (const oneTable of tableList) {
				const objectSubject = `sif:object/${oneTable.tableName}`;
				const headerLocation = `line ${oneTable.headerLineNumber}`;
				addStatement({
					statements,
					faultList,
					subject: objectSubject,
					predicate: 'objectTableName',
					object: oneTable.tableName,
					location: headerLocation,
				});
				addStatement({
					statements,
					faultList,
					subject: objectSubject,
					predicate: 'objectElementName',
					object: oneTable.elementName,
					location: headerLocation,
				});

				for (const oneRow of oneTable.rowList) {
					const fieldSubject = `sif:field/${oneRow.xpath}`;
					const rowLocation = `line ${oneRow.lineNumber}`;
					for (const oneCellPredicate of FIELD_CELL_PREDICATE_REGISTRY) {
						const cellValue = oneRow.cellList[oneCellPredicate.cellIndex] || '';
						if (cellValue === '') {
							continue; // absent is absent (RT-2) — an empty cell mints no statement.
						}
						if (oneCellPredicate.predicate === 'fieldMandatory' && cellValue !== '*') {
							stats.nonAsteriskMandatoryCellCount++;
						}
						addStatement({
							statements,
							faultList,
							subject: fieldSubject,
							predicate: oneCellPredicate.predicate,
							object: cellValue,
							location: rowLocation,
						});
					}

					const groupSubject = groupSubjectFor({
						objectElementName: oneTable.elementName,
						parentSegmentList: parentSegmentListFromXpath(oneRow.xpath),
					});
					if (!groupMap.has(groupSubject)) {
						groupMap.set(groupSubject, []);
					}
					groupMap.get(groupSubject).push({ xpath: oneRow.xpath, location: rowLocation });
				}
			}

			// the R-SF-7 precedence expansion — source order IS TSV row order (document order; the
			// source states nothing else — R-SF-8).
			groupMap.forEach((orderedMemberList, groupSubject) => {
				stats.groupCount++;
				mintPrecedenceStatements({
					statements,
					faultList,
					groupSubject,
					orderedMemberList,
					stats,
				});
			});

			stats.statementCount = statements.size;
			if (faultList.length) {
				callback(
					`${moduleName}.statementsFromTsvText: ${faultList.length} minting fault(s):\n  ` +
						faultList.join('\n  '),
				);
				return;
			}
			callback('', { statements, stats });
		};

		// =====================================================================
		// statementsFromSifGraph — the GRAPH side. The compiler's sifGraph payload in, statement
		// Map out. Faults (an ownerless field, an unorderable group, an unparseable crossRefs
		// carrier) are returned on faultList — the validator treats ANY fault as fatal (a
		// half-measured emission must not produce a verdict someone might believe).
		// =====================================================================

		const statementsFromSifGraph = ({ sifGraph } = {}, callback) => {
			if (
				!sifGraph ||
				!Array.isArray(sifGraph.objectNodeList) ||
				!Array.isArray(sifGraph.fieldNodeList) ||
				!Array.isArray(sifGraph.hasPropertyPairList)
			) {
				callback(
					`${moduleName}.statementsFromSifGraph: sifGraph with objectNodeList, fieldNodeList ` +
						`and hasPropertyPairList is REQUIRED and has no default.`,
				);
				return;
			}

			const statements = new Map();
			const faultList = [];
			const stats = makeStats();
			stats.tableCount = sifGraph.objectNodeList.length;
			stats.fieldRowCount = sifGraph.fieldNodeList.length;

			// object statements
			const objectNodeById = {};
			sifGraph.objectNodeList.forEach((oneObjectNode) => {
				objectNodeById[oneObjectNode._id] = oneObjectNode;
				const nodeLocation = `node ${oneObjectNode._id}`;
				if (!oneObjectNode.tableName) {
					faultList.push(`object ${oneObjectNode._id} carries no tableName (${nodeLocation})`);
					return;
				}
				if (!oneObjectNode.name) {
					faultList.push(`object ${oneObjectNode._id} carries no name (${nodeLocation})`);
					return;
				}
				const objectSubject = `sif:object/${oneObjectNode.tableName}`;
				addStatement({
					statements,
					faultList,
					subject: objectSubject,
					predicate: 'objectTableName',
					object: `${oneObjectNode.tableName}`,
					location: nodeLocation,
				});
				addStatement({
					statements,
					faultList,
					subject: objectSubject,
					predicate: 'objectElementName',
					object: `${oneObjectNode.name}`,
					location: nodeLocation,
				});
			});

			// ownership: each field's ONE owning object (HAS_PROPERTY). Zero or several owners is a
			// fault — the graph cannot say whose sibling a field is.
			const ownerIdByFieldId = {};
			sifGraph.hasPropertyPairList.forEach((onePair) => {
				if (ownerIdByFieldId[onePair.memberId] !== undefined) {
					faultList.push(
						`field ${onePair.memberId} has more than one HAS_PROPERTY owner ` +
							`(${ownerIdByFieldId[onePair.memberId]} and ${onePair.ownerId})`,
					);
					return;
				}
				ownerIdByFieldId[onePair.memberId] = onePair.ownerId;
			});

			// field statements + group membership
			const groupMap = new Map(); // groupSubject -> [{ xpath, location, sequenceOrdinal }]
			sifGraph.fieldNodeList.forEach((oneFieldNode) => {
				const nodeLocation = `node ${oneFieldNode._id}`;
				const xpath = oneFieldNode.xpath;
				if (!xpath) {
					faultList.push(`field ${oneFieldNode._id} carries no xpath (${nodeLocation})`);
					return;
				}
				const fieldSubject = `sif:field/${xpath}`;

				for (const oneGraphPredicate of GRAPH_FIELD_PREDICATE_REGISTRY) {
					const propertyValue = oneFieldNode[oneGraphPredicate.propertyName];
					if (propertyValue === undefined || propertyValue === null || `${propertyValue}` === '') {
						continue; // absent is absent — symmetric with the source's empty cell.
					}
					addStatement({
						statements,
						faultList,
						subject: fieldSubject,
						predicate: oneGraphPredicate.predicate,
						object: `${propertyValue}`,
						location: nodeLocation,
					});
				}

				// mandatory: the graph carries a boolean; the source's statement is the literal '*'.
				// Only true re-emits — a false is the graph's encoding of "the source stated nothing".
				if (oneFieldNode.mandatory === true) {
					addStatement({
						statements,
						faultList,
						subject: fieldSubject,
						predicate: 'fieldMandatory',
						object: '*',
						location: nodeLocation,
					});
				}

				// cedsId: the canonicalized scalar (P######) is the bridge anchor, NOT the source
				// statement — the FAITHFUL carrier of the source's 'CEDS ID' cell is crossRefs[].raw
				// (locator 'CEDS ID'), stamped verbatim at forge time. Read manifest decision: this is
				// the ONE crossRefs read the instrument makes, and it reads only the raw member.
				if (oneFieldNode.crossRefs !== undefined && oneFieldNode.crossRefs !== null) {
					let crossRefList = null;
					let crossRefsParseFault = '';
					try {
						crossRefList = JSON.parse(oneFieldNode.crossRefs);
					} catch (parseError) {
						crossRefsParseFault = parseError.message;
					}
					if (crossRefsParseFault) {
						faultList.push(
							`field ${oneFieldNode._id} carries unparseable crossRefs: ${crossRefsParseFault}`,
						);
					} else if (Array.isArray(crossRefList)) {
						crossRefList
							.filter((oneCrossRef) => oneCrossRef && oneCrossRef.locator === 'CEDS ID')
							.forEach((oneCrossRef) => {
								if (oneCrossRef.raw === undefined || `${oneCrossRef.raw}` === '') {
									faultList.push(
										`field ${oneFieldNode._id} carries a CEDS ID crossRef without a raw value`,
									);
									return;
								}
								addStatement({
									statements,
									faultList,
									subject: fieldSubject,
									predicate: 'fieldCedsId',
									object: `${oneCrossRef.raw}`,
									location: nodeLocation,
								});
							});
					}
				}

				// sibling-group membership: owner name (over the HAS_PROPERTY edge — the ownership
				// carrier under test) + the xpath-derived parent segments (the SAME shared rule the
				// source side uses).
				const ownerId = ownerIdByFieldId[oneFieldNode._id];
				if (ownerId === undefined) {
					faultList.push(
						`field ${oneFieldNode._id} has no HAS_PROPERTY owner — its sibling group is ` +
							`unknowable (${nodeLocation})`,
					);
					return;
				}
				const ownerNode = objectNodeById[ownerId];
				if (!ownerNode || !ownerNode.name) {
					faultList.push(
						`field ${oneFieldNode._id} is owned by ${ownerId}, which is not an object node ` +
							`with a name (${nodeLocation})`,
					);
					return;
				}
				const sequenceOrdinal = oneFieldNode.sequenceOrdinal;
				if (typeof sequenceOrdinal !== 'number' || !Number.isFinite(sequenceOrdinal)) {
					faultList.push(
						`field ${oneFieldNode._id} carries no numeric sequenceOrdinal — its position is ` +
							`unstated and the group cannot be ordered (${nodeLocation})`,
					);
					return;
				}
				const groupSubject = groupSubjectFor({
					objectElementName: ownerNode.name,
					parentSegmentList: parentSegmentListFromXpath(xpath),
				});
				if (!groupMap.has(groupSubject)) {
					groupMap.set(groupSubject, []);
				}
				groupMap.get(groupSubject).push({ xpath, location: nodeLocation, sequenceOrdinal });
			});

			// precedence: graph order is sequenceOrdinal rank and NOTHING else — never xpath order,
			// never read order. Duplicate ordinals inside one group make the order unstated: fault.
			groupMap.forEach((memberList, groupSubject) => {
				stats.groupCount++;
				const ordinalSeen = {};
				let groupFaulted = false;
				memberList.forEach((oneMember) => {
					if (ordinalSeen[oneMember.sequenceOrdinal] !== undefined) {
						faultList.push(
							`group ${groupSubject} carries duplicate sequenceOrdinal ` +
								`${oneMember.sequenceOrdinal} (${ordinalSeen[oneMember.sequenceOrdinal]} and ` +
								`${oneMember.xpath}) — the order is unstated; refusing to rank`,
						);
						groupFaulted = true;
						return;
					}
					ordinalSeen[oneMember.sequenceOrdinal] = oneMember.xpath;
				});
				if (groupFaulted) {
					return;
				}
				const orderedMemberList = memberList
					.slice()
					.sort((leftMember, rightMember) => leftMember.sequenceOrdinal - rightMember.sequenceOrdinal);
				mintPrecedenceStatements({
					statements,
					faultList,
					groupSubject,
					orderedMemberList,
					stats,
				});
			});

			stats.statementCount = statements.size;
			callback('', { statements, stats, faultList });
		};

		return {
			statementsFromTsvText,
			statementsFromSifGraph,
			statementKeyFor,
			parentSegmentListFromXpath,
			groupSubjectFor,
			DECLARED_CONTEXT_PREDICATES,
			LITERAL_COLUMN_HEADER,
			TABLE_SECTION_PATTERN,
			SUBJECT_SCHEME,
			STANDARD_SOURCE,
			ROOT_GROUP_TOKEN,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
