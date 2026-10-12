#!/usr/bin/env python3
"""Extract Appendix A of the CEDS Ontology Guide Version 14 (Tables A-1 and A-2) and the Conceptual Model concept list
into the TSVs the CEDS `guide` layer forges (lane DES, campaign cedsRichness-101226, 2026-10-12).

Usage: python -I extractGuideAppendixA.py <CEDS_Ontology_Guide_Version_14.pdf> <outputDirectoryPath>

WHY WORD POSITIONS AND NOT A LINE REGEX. Lane INV's first extraction matched one text LINE per row; a table cell that
wraps (A-2's "Accessible Format Issued / Begin Date") lost its continuation line, so 82 of 204 A-2 property names came out
truncated. Caught by the by-eye check against the PDF (2026-10-12). This script places every word in its column by its x
position against the table's own header, starts a row at the line carrying the row's id (C###### or P######, which the
PDF top-aligns), and appends every following line until the next id to that row's cells. Refuses by name on any word it
cannot place and on any page whose header it cannot find.

Requires pdfplumber (the lane's evidence venv). Not run by the forge: the forge reads the TSVs this writes, which are
checksummed beside the PDF they came from; the extraction is re-runnable and its output is diffed in the layer's test.
"""
import sys, os, re, csv
import pdfplumber

if len(sys.argv) != 3:
    sys.stderr.write('extractGuideAppendixA: need <guidePdfPath> <outputDirectoryPath>\n'); sys.exit(2)
guidePdfPath, outputDirectoryPath = sys.argv[1:]
if not os.path.isdir(outputDirectoryPath):
    sys.stderr.write('extractGuideAppendixA: output directory does not exist: ' + outputDirectoryPath + '\n'); sys.exit(2)

TABLE_SPEC_LIST = [
    {'tableName': 'A-1', 'idPattern': r'^C\d{6}$', 'headerList': ['Class Name', 'Class ID', 'Primary Concept', 'Secondary Concept'],
     'fieldList': ['className', 'classId', 'primaryConcept', 'secondaryConcept'], 'fileName': 'ontologyGuideV14-tableA1-classConcept.tsv'},
    {'tableName': 'A-2', 'idPattern': r'^P\d{6}$', 'headerList': ['Date Property Name', 'Property ID', 'Class (Domain)', 'Conceptual Model Concept(s)'],
     'fieldList': ['propertyName', 'propertyId', 'classText', 'conceptText'], 'fileName': 'ontologyGuideV14-tableA2-dateEventProperty.tsv'},
]
LINE_TOLERANCE = 3.0

def linesOfWords(wordList):
    lineList = []
    for oneWord in sorted(wordList, key=lambda word: (round(word['top']), word['x0'])):
        if lineList and abs(lineList[-1]['top'] - oneWord['top']) <= LINE_TOLERANCE:
            lineList[-1]['wordList'].append(oneWord)
        else:
            lineList.append({'top': oneWord['top'], 'wordList': [oneWord]})
    return lineList

def headerColumnStartList(lineList, headerList):
    for lineIndex, oneLine in enumerate(lineList):
        lineText = ' '.join(word['text'] for word in oneLine['wordList'])
        if all(header in lineText for header in headerList):
            # each header is found as a CONSECUTIVE run of its words (two headers may share a first word: 'Class Name',
            # 'Class ID'), searched left to right after the previous header's run
            wordTextList = [word['text'] for word in oneLine['wordList']]
            startList, searchFrom = [], 0
            for header in headerList:
                headerWordList = header.split(' ')
                runStart = next((index for index in range(searchFrom, len(wordTextList)) if wordTextList[index:index + len(headerWordList)] == headerWordList), None)
                if runStart is None:
                    return None, None
                startList.append(oneLine['wordList'][runStart]['x0'])
                searchFrom = runStart + len(headerWordList)
            return lineIndex, startList
    return None, None

rowListByTable = {spec['tableName']: [] for spec in TABLE_SPEC_LIST}
with pdfplumber.open(guidePdfPath) as pdf:
    for pageNumber, page in enumerate(pdf.pages, start=1):
        pageText = page.extract_text() or ''
        lineList = linesOfWords(page.extract_words(keep_blank_chars=False, use_text_flow=False))
        for spec in TABLE_SPEC_LIST:
            headerLineIndex, columnStartList = headerColumnStartList(lineList, spec['headerList'])
            if headerLineIndex is None:
                continue
            currentRow = None
            for oneLine in lineList[headerLineIndex + 1:]:
                if oneLine['wordList'][0]['text'].startswith('Page') and 'of' in [word['text'] for word in oneLine['wordList']]:
                    break
                cellPieceList = [[] for _ in spec['fieldList']]
                for word in oneLine['wordList']:
                    columnIndex = max(index for index, start in enumerate(columnStartList) if word['x0'] >= start - 2) if word['x0'] >= columnStartList[0] - 2 else None
                    if columnIndex is None:
                        sys.stderr.write('extractGuideAppendixA: page %d word %r lies left of the table\n' % (pageNumber, word['text'])); sys.exit(3)
                    cellPieceList[columnIndex].append(word['text'])
                idText = ' '.join(cellPieceList[1])
                if re.match(spec['idPattern'], idText):
                    currentRow = {'pageNumber': pageNumber, 'cellList': [' '.join(piece) for piece in cellPieceList]}
                    rowListByTable[spec['tableName']].append(currentRow)
                elif currentRow is not None:
                    for columnIndex, piece in enumerate(cellPieceList):
                        if piece:
                            currentRow['cellList'][columnIndex] = (currentRow['cellList'][columnIndex] + ' ' + ' '.join(piece)).strip()
                else:
                    sys.stderr.write('extractGuideAppendixA: page %d table %s line %r precedes any row\n' % (pageNumber, spec['tableName'], ' '.join(word['text'] for word in oneLine['wordList']))); sys.exit(3)

# ---- the eight Conceptual Model concepts: definitions from §2.2's bullet list, order checked against Appendix A's numbered list
CONCEPT_FILE_NAME = 'ontologyGuideV14-conceptualModelConcept.tsv'
conceptRowList, numberedNameByOrdinal = [], {}
with pdfplumber.open(guidePdfPath) as pdf:
    for pageNumber, page in enumerate(pdf.pages, start=1):
        pageText = page.extract_text() or ''
        if 'Figure 1: CEDS Conceptual Model Venn Diagram' in pageText:
            bulletText = pageText[pageText.index('concepts interact with each other.') + len('concepts interact with each other.'):]
            bulletText = re.sub(r'\nPage \d+ of \d+\s*$', '', bulletText.strip())
            for bulletMatch in re.finditer(r'(?:^|\n)\u2022?\s*([A-Z][a-z]+): (.+?)(?=\n\u2022|\Z)', bulletText, re.S):
                conceptRowList.append({'conceptName': bulletMatch.group(1), 'conceptDefinition': re.sub(r'\s*\n\s*', ' ', bulletMatch.group(2)).strip(), 'guidePageNumber': pageNumber})
        if 'The eight Conceptual Model' in pageText:
            for numberedMatch in re.finditer(r'(\d)\. ([A-Z][a-z]+)', pageText):
                numberedNameByOrdinal[int(numberedMatch.group(1))] = numberedMatch.group(2)
if len(conceptRowList) != 8 or [numberedNameByOrdinal.get(index + 1) for index in range(8)] != [row['conceptName'] for row in conceptRowList]:
    sys.stderr.write('extractGuideAppendixA: concept list %r does not match Appendix A numbered list %r\n' % ([row['conceptName'] for row in conceptRowList], numberedNameByOrdinal)); sys.exit(3)
with open(os.path.join(outputDirectoryPath, CONCEPT_FILE_NAME), 'w', newline='') as tsvFile:
    writer = csv.writer(tsvFile, delimiter='\t', lineterminator='\n')
    writer.writerow(['conceptOrdinal', 'conceptName', 'conceptDefinition', 'guidePageNumber'])
    for conceptIndex, oneRow in enumerate(conceptRowList):
        writer.writerow([conceptIndex + 1, oneRow['conceptName'], oneRow['conceptDefinition'], oneRow['guidePageNumber']])
print('concepts', len(conceptRowList), 'rows ->', CONCEPT_FILE_NAME)

for spec in TABLE_SPEC_LIST:
    with open(os.path.join(outputDirectoryPath, spec['fileName']), 'w', newline='') as tsvFile:
        writer = csv.writer(tsvFile, delimiter='\t', lineterminator='\n')
        writer.writerow(spec['fieldList'] + ['guidePageNumber'])
        for oneRow in rowListByTable[spec['tableName']]:
            writer.writerow(oneRow['cellList'] + [oneRow['pageNumber']])
    print(spec['tableName'], len(rowListByTable[spec['tableName']]), 'rows ->', spec['fileName'])
