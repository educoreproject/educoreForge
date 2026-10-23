'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// pescldTtlOracle.js — the PESC_LD SECOND ORACLE (zeroBacklog lane C1; ruling Q-Z8). The round trip proves the graph gives back the
// CSV snapshot it was forged from; this module asks a different witness, the publisher's own merged SHACL TTL, whether the graph
// says what the publisher says. It translates the TTL into the round trip's statement vocabulary (lib/pescldRoundTripPair.js
// header) and diffs it against the graph's emission (that pair's emitFromGraph). The two sides differ where the CSV and the TTL
// genuinely differ, and the declared departure table (pescldTtlDepartureTable.json) names every such statement: each departure
// must match exactly one row, and each row's count must equal its expectedCount. An unexplained departure, a statement two rows
// claim, or a count that moved is a FAILED oracle.
//
//   canonicalizeTtl({ ttlFilePath }, callback(errString, { statements, stats }))
//   diffAgainstGraph({ ttlStatements, graphStatements, departureTable }) → { isOracleClean, departureCountByKind,
//       unexplainedList, ambiguousList, countMismatchList, ttlStatementCount, graphStatementCount }
//
// The translation reads only the TTL; the diff reads only statement maps. Neither touches the CSVs or the forge.

const fs = require('fs');
const { readTurtleText } = require('./pescldTurtleReader');

const NODE_KIND_TEXT_BY_NAME = Object.freeze({ 'sh:Literal': 'Literal', 'sh:IRI': 'IRI', 'sh:BlankNode': 'BNODE', 'sh:BlankNodeOrIRI': 'IRI BNODE' });
const SEVERITY_PREFIX = 'sh:';
const CURIE_RE = /^([A-Za-z][A-Za-z0-9]*):(.+)$/;
// the predicates the translation reads, per shape kind; any other predicate is refused (an unmodelled TTL statement is never skipped)
const NODE_SHAPE_PREDICATE_LIST = Object.freeze(['rdf:type', 'rdfs:label', 'sh:closed', 'sh:property', 'sh:targetClass', 'sh:severity']);
const PROPERTY_SHAPE_PREDICATE_LIST = Object.freeze(['rdf:type', 'sh:path', 'sh:name', 'sh:minCount', 'sh:maxCount', 'sh:nodeKind', 'sh:datatype', 'sh:in', 'sh:maxLength', 'sh:minLength', 'sh:pattern', 'sh:hasValue', 'sh:node', 'sh:class', 'sh:or', 'rdfs:comment', 'sh:severity']);

// termText — a term as the CSV would write it: a prefixed name or literal verbatim, a relative IRI as its local name
const termText = (oneTerm) => {
	if (oneTerm.termKind === 'prefixedName') {
		return oneTerm.nameText;
	}
	if (oneTerm.termKind === 'literal') {
		return oneTerm.literalText;
	}
	if (oneTerm.termKind === 'iri') {
		return oneTerm.iriText;
	}
	if (oneTerm.termKind === 'integer') {
		return `${oneTerm.integerValue}`;
	}
	return undefined;
};

// -----------------------------------------------------------------
// canonicalizeTtl — the TTL → statements in the round trip's vocabulary (never the CSV, never the graph)
// -----------------------------------------------------------------
const canonicalizeTtl = ({ ttlFilePath }, callback) => {
	const turtle = readTurtleText({ turtleText: fs.readFileSync(ttlFilePath, 'utf8'), sourceFileName: ttlFilePath.split('/').pop() });
	if (turtle.refusalText !== undefined) {
		callback(turtle.refusalText);
		return;
	}
	const iriOf = (curieText) => {
		const curieMatch = curieText.match(CURIE_RE);
		return curieMatch === null || turtle.iriByPrefix[curieMatch[1]] === undefined ? undefined : `${turtle.iriByPrefix[curieMatch[1]]}${curieMatch[2]}`;
	};
	const statements = new Map();
	const recordLanguageTag = ({ subjectIri, predicateName, oneTerm }) => {
		if (oneTerm.languageTag !== undefined) {
			statements.set(`ttl|languageTag|${subjectIri}|${predicateName}|${oneTerm.languageTag}`, {});
		}
	};
	const typeOf = (oneSubject) => (oneSubject.predicateMap['rdf:type'] || []).map(termText).join(',');
	const nodeShapeList = turtle.subjectList.filter((oneSubject) => typeOf(oneSubject) === 'sh:NodeShape');
	const propertyShapeByIri = turtle.subjectList.filter((oneSubject) => typeOf(oneSubject) === 'sh:PropertyShape').reduce((byIri, oneSubject) => ({ ...byIri, [oneSubject.subjectIri]: oneSubject }), {});
	const untypedSubject = turtle.subjectList.find((oneSubject) => ['sh:NodeShape', 'sh:PropertyShape'].indexOf(typeOf(oneSubject)) === -1);
	if (untypedSubject !== undefined) {
		callback(`${moduleName} REFUSED: subject <${untypedSubject.subjectIri}> is typed '${typeOf(untypedSubject)}', neither sh:NodeShape nor sh:PropertyShape`);
		return;
	}
	let refusalText;
	const ownerShapeIdByPropertyShapeIri = {};
	nodeShapeList.forEach((oneShape) => {
		const shapeID = oneShape.subjectIri;
		const unknownPredicate = Object.keys(oneShape.predicateMap).find((predicateName) => NODE_SHAPE_PREDICATE_LIST.indexOf(predicateName) === -1);
		if (unknownPredicate !== undefined) {
			refusalText = refusalText || `${moduleName} REFUSED: NodeShape <${shapeID}> states '${unknownPredicate}', which the translation does not model`;
			return;
		}
		const firstOf = (predicateName) => (oneShape.predicateMap[predicateName] || [])[0];
		statements.set(`shape|${shapeID}|declared|true`, {});
		if (firstOf('rdfs:label') !== undefined) {
			statements.set(`shape|${shapeID}|label|${termText(firstOf('rdfs:label'))}`, {});
			recordLanguageTag({ subjectIri: shapeID, predicateName: 'rdfs:label', oneTerm: firstOf('rdfs:label') });
		}
		if (firstOf('sh:targetClass') !== undefined) {
			const targetText = termText(firstOf('sh:targetClass'));
			statements.set(`shape|${shapeID}|target|${targetText}`, {});
			statements.set(`shape|${shapeID}|targetType|class`, {});
			if (iriOf(targetText) !== undefined) {
				statements.set(`shape|${shapeID}|termIri|${iriOf(targetText)}`, {});
			}
		}
		if (firstOf('sh:closed') !== undefined) {
			statements.set(`shape|${shapeID}|Closed|${firstOf('sh:closed').booleanValue ? 'TRUE' : 'FALSE'}`, {});
		}
		if (firstOf('sh:severity') !== undefined) {
			statements.set(`shape|${shapeID}|severity|${termText(firstOf('sh:severity')).replace(SEVERITY_PREFIX, '')}`, {});
		}
		(oneShape.predicateMap['sh:property'] || []).forEach((oneTerm) => {
			ownerShapeIdByPropertyShapeIri[oneTerm.iriText] = (ownerShapeIdByPropertyShapeIri[oneTerm.iriText] || []).concat([shapeID]);
		});
	});

	Object.keys(propertyShapeByIri).forEach((propertyShapeIri) => {
		const onePropertyShape = propertyShapeByIri[propertyShapeIri];
		const ownerShapeIdList = ownerShapeIdByPropertyShapeIri[propertyShapeIri] || [];
		if (ownerShapeIdList.length !== 1) {
			refusalText = refusalText || `${moduleName} REFUSED: PropertyShape <${propertyShapeIri}> is listed by ${ownerShapeIdList.length} NodeShapes (one owner expected)`;
			return;
		}
		const unknownPredicate = Object.keys(onePropertyShape.predicateMap).find((predicateName) => PROPERTY_SHAPE_PREDICATE_LIST.indexOf(predicateName) === -1);
		if (unknownPredicate !== undefined) {
			refusalText = refusalText || `${moduleName} REFUSED: PropertyShape <${propertyShapeIri}> states '${unknownPredicate}', which the translation does not model`;
			return;
		}
		const shapeID = ownerShapeIdList[0];
		const firstOf = (predicateName) => (onePropertyShape.predicateMap[predicateName] || [])[0];
		const propertyID = termText(firstOf('sh:path'));
		const rowPrefix = `row|${shapeID}|${propertyID}`;
		statements.set(`ttl|propertyShapeIri|${shapeID}|${propertyID}|${propertyShapeIri}`, {});
		statements.set(`${rowPrefix}|shapeID|${shapeID}`, {});
		statements.set(`${rowPrefix}|propertyID|${propertyID}`, {});
		if (iriOf(propertyID) !== undefined) {
			statements.set(`${rowPrefix}|termIri|${iriOf(propertyID)}`, {});
		}
		statements.set(`${rowPrefix}|propertyLabel|${termText(firstOf('sh:name'))}`, {});
		recordLanguageTag({ subjectIri: propertyShapeIri, predicateName: 'sh:name', oneTerm: firstOf('sh:name') });
		statements.set(`${rowPrefix}|mandatory|${firstOf('sh:minCount') !== undefined && firstOf('sh:minCount').integerValue === 1 ? 'TRUE' : 'FALSE'}`, {});
		statements.set(`${rowPrefix}|repeatable|${firstOf('sh:maxCount') !== undefined && firstOf('sh:maxCount').integerValue === 1 ? 'FALSE' : 'TRUE'}`, {});
		const nodeKindText = NODE_KIND_TEXT_BY_NAME[termText(firstOf('sh:nodeKind'))];
		if (nodeKindText === undefined) {
			refusalText = refusalText || `${moduleName} REFUSED: PropertyShape <${propertyShapeIri}> sh:nodeKind '${termText(firstOf('sh:nodeKind'))}' has no spelling in NODE_KIND_TEXT_BY_NAME`;
			return;
		}
		statements.set(`${rowPrefix}|valueNodeType|${nodeKindText}`, {});
		if (firstOf('sh:datatype') !== undefined) {
			statements.set(`${rowPrefix}|valueDataType|${termText(firstOf('sh:datatype'))}`, {});
		}
		if (firstOf('sh:in') !== undefined) {
			statements.set(`${rowPrefix}|valueConstraintType|picklist`, {});
			firstOf('sh:in').itemList.map(termText).forEach((valueText) => {
				statements.set(`picklistValue|${shapeID}|${propertyID}|${valueText}`, {});
				if (iriOf(valueText) !== undefined) {
					statements.set(`picklistValueIri|${shapeID}|${propertyID}|${valueText}|${iriOf(valueText)}`, {});
				}
			});
		}
		if (firstOf('sh:minLength') !== undefined) {
			statements.set(`${rowPrefix}|valueConstraintType|lengthRange`, {});
			statements.set(`${rowPrefix}|valueConstraint|${termText(firstOf('sh:minLength'))}..${termText(firstOf('sh:maxLength'))}`, {});
		} else if (firstOf('sh:maxLength') !== undefined) {
			statements.set(`${rowPrefix}|valueConstraintType|maxLength`, {});
			statements.set(`${rowPrefix}|valueConstraint|${termText(firstOf('sh:maxLength'))}`, {});
		}
		if (firstOf('sh:pattern') !== undefined) {
			statements.set(`${rowPrefix}|valueConstraintType|pattern`, {});
			statements.set(`${rowPrefix}|valueConstraint|${termText(firstOf('sh:pattern'))}`, {});
		}
		if (firstOf('sh:hasValue') !== undefined) {
			statements.set(`${rowPrefix}|valueConstraint|${termText(firstOf('sh:hasValue'))}`, {});
		}
		if (firstOf('sh:node') !== undefined) {
			statements.set(`${rowPrefix}|valueShape|${termText(firstOf('sh:node'))}`, {});
		}
		(onePropertyShape.predicateMap['sh:class'] || []).forEach((oneTerm) => statements.set(`${rowPrefix}|valueClass|${termText(oneTerm)}`, {}));
		(onePropertyShape.predicateMap['sh:or'] || []).forEach((oneCollection) => oneCollection.itemList.forEach((oneMember) => {
			(oneMember.predicateMap['sh:class'] || []).forEach((oneTerm) => statements.set(`${rowPrefix}|valueClass|${termText(oneTerm)}`, {}));
		}));
		if (firstOf('rdfs:comment') !== undefined) {
			statements.set(`${rowPrefix}|note|${termText(firstOf('rdfs:comment'))}`, {});
			// the same text again as the DME text field: a translation of the round trip's own statement, not a departure (the graph
			// carries the note as description too; ruling BRONZE_CROWN 2026-10-23)
			statements.set(`${rowPrefix}|dmeTextFromNote|${termText(firstOf('rdfs:comment'))}`, {});
			recordLanguageTag({ subjectIri: propertyShapeIri, predicateName: 'rdfs:comment', oneTerm: firstOf('rdfs:comment') });
		}
		if (firstOf('sh:severity') !== undefined) {
			statements.set(`${rowPrefix}|Severity|${termText(firstOf('sh:severity')).replace(SEVERITY_PREFIX, '')}`, {});
		}
	});
	if (refusalText !== undefined) {
		callback(refusalText);
		return;
	}
	callback('', { statements, stats: { nodeShapeCount: nodeShapeList.length, propertyShapeCount: Object.keys(propertyShapeByIri).length, statementCount: statements.size } });
};

// -----------------------------------------------------------------
// diffAgainstGraph — every one-sided statement explained by exactly one departure row, every row at its expected count
// -----------------------------------------------------------------
const diffAgainstGraph = ({ ttlStatements, graphStatements, departureTable }) => {
	const departureList = departureTable.departureList.map((oneRow) => ({ ...oneRow, statementRegex: new RegExp(oneRow.statementPatternSource) }));
	const departureCountByKind = departureList.reduce((byKind, oneRow) => ({ ...byKind, [oneRow.departureKind]: 0 }), {});
	const unexplainedList = [];
	const ambiguousList = [];
	const classify = ({ statementKey, side }) => {
		const matchingRowList = departureList.filter((oneRow) => oneRow.side === side && oneRow.statementRegex.test(statementKey));
		if (matchingRowList.length === 0) {
			unexplainedList.push({ side, statementKey });
			return;
		}
		if (matchingRowList.length > 1) {
			ambiguousList.push({ side, statementKey, departureKindList: matchingRowList.map((oneRow) => oneRow.departureKind) });
			return;
		}
		departureCountByKind[matchingRowList[0].departureKind] += 1;
	};
	[...ttlStatements.keys()].filter((statementKey) => !graphStatements.has(statementKey)).forEach((statementKey) => classify({ statementKey, side: 'ttlOnly' }));
	[...graphStatements.keys()].filter((statementKey) => !ttlStatements.has(statementKey) && graphStatements.get(statementKey).explicitlyOmitted !== true).forEach((statementKey) => classify({ statementKey, side: 'graphOnly' }));
	const countMismatchList = departureList
		.filter((oneRow) => departureCountByKind[oneRow.departureKind] !== oneRow.expectedCount)
		.map((oneRow) => ({ departureKind: oneRow.departureKind, expectedCount: oneRow.expectedCount, measuredCount: departureCountByKind[oneRow.departureKind] }));
	return {
		isOracleClean: unexplainedList.length === 0 && ambiguousList.length === 0 && countMismatchList.length === 0,
		departureCountByKind,
		unexplainedList,
		ambiguousList,
		countMismatchList,
		ttlStatementCount: ttlStatements.size,
		graphStatementCount: graphStatements.size,
	};
};

module.exports = { canonicalizeTtl, diffAgainstGraph, moduleName };
