"""xsdComponentCompare — THE INDEPENDENT INSTRUMENT (R-VAL-4), PESC edition.

Shares NO CODE with roundTripSourceEmitter or roundTripXsdCanonical. It reads XSD with the
third-party `xmlschema` component-model implementation — the XSD specification's own semantic
layer — playing exactly the role rdflib plays for CEDS in lib/rdf-independent-check.

WHY A SECOND INSTRUMENT AT ALL. The primary comparator canonicalizes both sides with the same
code, which makes it precise and structurally unable to audit its own assumptions. Anything it
does not model is absent from BOTH sides of its comparison and therefore reads as fidelity. Only
a processor sharing no code with ours can see that class of defect. A tool cannot audit the
assumption it is built on.

R-P5-1 — XSD 1.1 IS PINNED, EXPLICITLY, AND THE PIN IS ASSERTED RATHER THAN TRUSTED.
`xmlschema.XMLSchema` is an alias for `XMLSchema10`. Under 1.0 the single corpus file carrying
`vc:minVersion="1.1"` (AcademicEportfolio_v1.0.0.xsd, 90KB, 45 complexTypes) compiles in 0.04s to
ZERO types, ZERO elements, ZERO imports, ZERO warnings, and reports SUCCESS. Under 1.1 the same
file yields 57 types. Getting this wrong makes the instrument report 57 real types as INVENTED.

WHAT IS DELIBERATELY CAPTURED, AND WHY EACH ONE. Captured precisely because the primary
comparator discards them, so an instrument that also discarded them would reproduce our blind
spots instead of auditing them:
  * PARTICLE ORDER — the primary comparator's statement subject carries no ordinal, so a sibling
    swap emits an identical statement set and is invisible to it.
  * RESOLVED QUALIFIED NAMES — the primary comparator strips the namespace prefix, so a reference
    repointed to a same-named type in a DIFFERENT namespace canonicalizes identically. That is
    R-ID-1's fusion in the object space.

=======================================================================================
THE TRAVERSAL RECURSES, AND THIS IS THE CORRECTION THAT MATTERS MOST IN THIS FILE.
=======================================================================================
The first revision walked `compiled.types` only — GLOBAL NAMED types. A sibling swap planted in a
message root's ANONYMOUS inline type reported ZERO order differences, an instrument blind spot
indistinguishable from a real one. The repair was to walk `compiled.elements` as well.

THE INDEPENDENT REVIEW THEN DROVE THAT REPAIR AND FOUND IT PARTIAL, and the diagnosis is the part
worth keeping: ADDING ONE HARD-CODED PARENT IS THE SAME MOVE THAT LEFT THE FIRST GAP. A content
model inside a LOCAL element's anonymous inline type was still unwalked — measured at 274 content
models with two or more children against 12,745 reachable, and a dropped enumeration inside a
local element's anonymous simpleType scored 0/0/0.

The class is "content models live in more places than I enumerated." Enumerating one more place
does not close a class. So the walk now RECURSES from every global type and every global element
through each particle's type, to arbitrary depth, guarded by a visited set on component identity.

=======================================================================================
UNAVAILABILITY IS COUNTED, NEVER SILENTLY EQUAL.
=======================================================================================
The first revision emitted a `traversalUnavailable` marker and NOTHING CONSUMED IT. Two sides that
both failed to look produced equal lists and scored as AGREEMENT — the mutual blind spot
reproduced inside the instrument built to detect mutual blind spots. The marker is now (a) raised
whenever a content model exists but cannot be walked, including when iteration itself fails, and
(b) CONSUMED by the comparison: a type unwalkable on either side is EXCLUDED from the agreement
counts and reported under its own total. Mutual unavailability can no longer read as agreement.

REFUSAL DISCIPLINE. Every refusal names the file, the processor's own exception class, and its own
message. Nothing is binned into a generic category, nothing is skipped, and no absent value is
replaced by a plausible one. An UNAVAILABLE instrument must never read as a passing one.
"""
import json
import os
import sys
import time

try:
    import xmlschema
except ImportError as oneImportError:  # environment fault, not a comparison result
    print(json.dumps({'error': 'xsdComponentCompare: xmlschema is not importable in this '
                               'interpreter (%s). The independent check cannot run and its gate '
                               'must read UNAVAILABLE, never pass.' % oneImportError}))
    sys.exit(1)


# A file smaller than this is allowed to legitimately carry no components at all; above it, a
# total-empty compile is the XSD 1.0 silent-empty signature and is refused by name.
NON_TRIVIAL_FILE_BYTES = 4096

# Depth guard. The visited set already prevents cycles; this is a second, cheaper backstop so a
# pathological schema cannot hang the instrument. Exceeding it raises the unavailable marker
# rather than truncating silently.
MAXIMUM_TRAVERSAL_DEPTH = 40


def refuseByName(messageText):
    print(json.dumps({'error': messageText}))
    sys.exit(1)


def assertProcessorIsXsd11():
    """The pin, asserted rather than trusted. R-P5-1."""
    if not hasattr(xmlschema, 'XMLSchema11'):
        refuseByName('xsdComponentCompare: this xmlschema build exposes no XMLSchema11. R-P5-1 '
                     'requires XSD 1.1 and there is no acceptable alternative processor.')
    if xmlschema.XMLSchema11 is getattr(xmlschema, 'XMLSchema10', None):
        refuseByName('xsdComponentCompare: XMLSchema11 and XMLSchema10 are the same class in this '
                     'build. The 1.1 pin cannot be honoured and the instrument refuses rather '
                     'than silently measuring under 1.0.')


def localNameOf(oneComponent):
    """The component's own name, or an explicit anonymity marker. Never a plausible blank."""
    if oneComponent is None:
        return None
    componentName = getattr(oneComponent, 'name', None)
    return componentName if componentName is not None else '(anonymous)'


def enumerationValueList(oneType):
    facetMap = getattr(oneType, 'facets', None) or {}
    for oneFacetName, oneFacet in facetMap.items():
        if oneFacetName is not None and str(oneFacetName).endswith('}enumeration'):
            return [str(oneValue) for oneValue in (getattr(oneFacet, 'enumeration', None) or [])]
    return []


def particleListOf(oneType):
    """(particleList, unavailableReason). Exactly one of the two is meaningful.

    A type with NO content model genuinely has no particles and returns ([], None) — a real empty.
    A type whose content model cannot be walked returns (None, reason) so the caller can raise the
    marker. Conflating those two is the defect this signature exists to prevent.
    """
    contentModel = getattr(oneType, 'content', None)
    if contentModel is None:
        return [], None
    iterElements = getattr(contentModel, 'iter_elements', None)
    if iterElements is None:
        return None, ('content model of type %s exposes no iter_elements'
                      % type(contentModel).__name__)
    try:
        return list(iterElements()), None
    except Exception as oneError:  # the walk itself failed; that is unavailability, not emptiness
        return None, ('iter_elements raised %s: %s' % (type(oneError).__name__, str(oneError)[:120]))


def collectTypeFactList(compiled):
    """Every reachable content model, recursively, keyed by a path stable across both corpora.

    Keys: a global named type by its qualified name; a global element carrying an ANONYMOUS type
    by `element:<name>`; anything nested by `<parentKey>/<position>:<particleName>`. Position is
    part of the nested key so two same-named particles in one content model cannot collapse.
    """
    typeFactList = []
    visitedTypeIdSet = set()
    globalTypeIdSet = set(id(oneType) for oneType in compiled.types.values())

    def walkOneType(oneType, oneKey, oneDepth):
        if oneType is None:
            return
        if id(oneType) in visitedTypeIdSet:
            return
        visitedTypeIdSet.add(id(oneType))

        if oneDepth > MAXIMUM_TRAVERSAL_DEPTH:
            typeFactList.append({
                'typeName': oneKey,
                'orderedParticles': [],
                'enumerationValues': [],
                'traversalUnavailable': True,
                'traversalUnavailableReason': 'exceeded MAXIMUM_TRAVERSAL_DEPTH of %d'
                                              % MAXIMUM_TRAVERSAL_DEPTH,
            })
            return

        particleList, unavailableReason = particleListOf(oneType)
        if unavailableReason is not None:
            typeFactList.append({
                'typeName': oneKey,
                'orderedParticles': [],
                'enumerationValues': enumerationValueList(oneType),
                'traversalUnavailable': True,
                'traversalUnavailableReason': unavailableReason,
            })
            return

        particleFactList = []
        for onePosition, oneParticle in enumerate(particleList):
            particleType = getattr(oneParticle, 'type', None)
            particleName = localNameOf(oneParticle)
            particleFactList.append({
                'position': onePosition,
                'particleName': particleName,
                'resolvedTypeName': localNameOf(particleType),
                'minOccurs': getattr(oneParticle, 'min_occurs', None),
                'maxOccurs': getattr(oneParticle, 'max_occurs', None),
            })
            # RECURSE. A particle's type may itself carry a content model or enumeration facets,
            # at any depth. Global named types are reached from the global pass and are not
            # re-walked here, which is also what removes the double-walk the review found.
            if particleType is not None and id(particleType) not in globalTypeIdSet:
                walkOneType(particleType, '%s/%d:%s' % (oneKey, onePosition, particleName),
                            oneDepth + 1)

        typeFactList.append({
            'typeName': oneKey,
            'orderedParticles': particleFactList,
            'enumerationValues': enumerationValueList(oneType),
            'traversalUnavailable': False,
            'traversalUnavailableReason': None,
        })

    for oneTypeName, oneType in sorted(compiled.types.items(), key=lambda onePair: str(onePair[0])):
        walkOneType(oneType, str(oneTypeName), 0)

    for oneElementName, oneElement in sorted(compiled.elements.items(),
                                             key=lambda onePair: str(onePair[0])):
        elementType = getattr(oneElement, 'type', None)
        if elementType is None:
            continue
        if id(elementType) in globalTypeIdSet:
            # THE DOUBLE-WALK THE REVIEW FOUND. A global element declared on a global NAMED type
            # was previously recorded twice — once under the type name and once under
            # `element:<name>` — inflating particleOrderDifferenceTotal. It is now recorded as a
            # POINTER, which still makes a repoint of the element's type visible without counting
            # the same content model's particles a second time.
            typeFactList.append({
                'typeName': 'element:' + str(oneElementName),
                'orderedParticles': [],
                'enumerationValues': [],
                'pointsToGlobalType': localNameOf(elementType),
                'traversalUnavailable': False,
                'traversalUnavailableReason': None,
            })
            continue
        walkOneType(elementType, 'element:' + str(oneElementName), 0)

    return typeFactList


def compileOneFile(filePath):
    """One file, one outcome. Status is always one of clean / refused / emptyCompile."""
    outcome = {'filename': os.path.basename(filePath)}
    startedAt = time.time()
    try:
        compiled = xmlschema.XMLSchema11(filePath)
    except Exception as oneError:
        outcome['status'] = 'refused'
        outcome['errorClass'] = type(oneError).__name__
        outcome['errorMessage'] = str(oneError)[:400]
        outcome['elapsedSeconds'] = round(time.time() - startedAt, 3)
        return outcome

    typeFactList = collectTypeFactList(compiled)
    elementNameList = sorted(str(oneName) for oneName in compiled.elements.keys())
    importCount = len(getattr(compiled, 'imports', None) or {})

    if (not compiled.types and not elementNameList and importCount == 0
            and os.path.getsize(filePath) > NON_TRIVIAL_FILE_BYTES):
        outcome['status'] = 'emptyCompile'
        outcome['errorMessage'] = (
            'compiled to ZERO types, ZERO elements and ZERO imports from a %d byte file. This is '
            'the R-P5-1 silent-empty signature. It is REFUSED, never counted as clean, because it '
            'is otherwise indistinguishable from success.' % os.path.getsize(filePath))
        outcome['elapsedSeconds'] = round(time.time() - startedAt, 3)
        return outcome

    outcome['status'] = 'clean'
    outcome['typeList'] = typeFactList
    outcome['elementNameList'] = elementNameList
    outcome['typeCount'] = len(typeFactList)
    outcome['traversalUnavailableCount'] = sum(
        1 for one in typeFactList if one.get('traversalUnavailable'))
    outcome['elapsedSeconds'] = round(time.time() - startedAt, 3)
    return outcome


def compileCorpus(corpusDirectory):
    if not os.path.isdir(corpusDirectory):
        refuseByName('xsdComponentCompare: not a directory: %s' % corpusDirectory)
    fileNameList = sorted(one for one in os.listdir(corpusDirectory) if one.endswith('.xsd'))
    if not fileNameList:
        refuseByName('xsdComponentCompare: no .xsd files under %s. An empty corpus is a missing '
                     'input, not an empty result.' % corpusDirectory)
    outcomeByFilename = {}
    for oneFileName in fileNameList:
        outcomeByFilename[oneFileName] = compileOneFile(os.path.join(corpusDirectory, oneFileName))
    return outcomeByFilename


def tallyOf(outcomeByFilename):
    return {
        'attempted': len(outcomeByFilename),
        'clean': sum(1 for one in outcomeByFilename.values() if one['status'] == 'clean'),
        'refused': sum(1 for one in outcomeByFilename.values() if one['status'] == 'refused'),
        'emptyCompile': sum(1 for one in outcomeByFilename.values()
                            if one['status'] == 'emptyCompile'),
        'traversalUnavailableTypes': sum(one.get('traversalUnavailableCount', 0)
                                         for one in outcomeByFilename.values()),
    }


# REFUSAL CAUSES AS DATA, not as a branch chain. Adding a cause is a new row here rather than a
# new `elif` in the classifier, which is the open/closed rule. An unmatched message is NOT binned
# into a generic bucket — it is echoed verbatim under `unclassified:`, so a cause nobody has seen
# before announces itself instead of disappearing into "other".
REFUSAL_CAUSE_SIGNATURE_LIST = [
    ('Unexpected child with tag',
     'invalid content model - element particle not inside a compositor'),
    ('not found in namespace map',
     'reference through an UNDECLARED namespace prefix'),
    ('unknown type',
     'reference into an unresolvable namespace (unknown type)'),
    ('missing group',
     'reference into an unresolvable namespace (missing group)'),
]


def refusalCauseTally(outcomeByFilename):
    """Group refusals by the processor's own words. Never invent a category."""
    tally = {}
    for oneOutcome in outcomeByFilename.values():
        if oneOutcome['status'] != 'refused':
            continue
        messageText = oneOutcome.get('errorMessage', '')
        causeLabel = None
        for oneSignature, oneLabel in REFUSAL_CAUSE_SIGNATURE_LIST:
            if oneSignature in messageText:
                causeLabel = oneLabel
                break
        if causeLabel is None:
            causeLabel = 'unclassified: ' + messageText[:70]
        tally[causeLabel] = tally.get(causeLabel, 0) + 1
    return tally


def compareCleanPair(sourceOutcome, emittedOutcome):
    """Compare two CLEAN compilations of the same filename at component level.

    UNAVAILABILITY IS CONSUMED HERE. A type the traversal could not walk on EITHER side is removed
    from the comparison and counted separately. Leaving it in would let two empty particle lists
    compare equal and score as agreement, which is precisely the mutual blind spot this instrument
    exists to detect.
    """
    sourceTypeMap = {one['typeName']: one for one in sourceOutcome['typeList']}
    emittedTypeMap = {one['typeName']: one for one in emittedOutcome['typeList']}
    typeOnlyInSource = sorted(set(sourceTypeMap) - set(emittedTypeMap))
    typeOnlyInEmitted = sorted(set(emittedTypeMap) - set(sourceTypeMap))

    particleOrderDifferenceList = []
    resolvedTypeDifferenceList = []
    enumerationDifferenceList = []
    pointerDifferenceList = []
    unavailableTypeNameList = []

    for oneTypeName in sorted(set(sourceTypeMap) & set(emittedTypeMap)):
        sourceType, emittedType = sourceTypeMap[oneTypeName], emittedTypeMap[oneTypeName]

        if sourceType.get('traversalUnavailable') or emittedType.get('traversalUnavailable'):
            unavailableTypeNameList.append({
                'typeName': oneTypeName,
                'sourceUnavailable': bool(sourceType.get('traversalUnavailable')),
                'emittedUnavailable': bool(emittedType.get('traversalUnavailable')),
                'sourceReason': sourceType.get('traversalUnavailableReason'),
                'emittedReason': emittedType.get('traversalUnavailableReason'),
            })
            continue

        if sourceType.get('pointsToGlobalType') or emittedType.get('pointsToGlobalType'):
            if sourceType.get('pointsToGlobalType') != emittedType.get('pointsToGlobalType'):
                pointerDifferenceList.append({
                    'typeName': oneTypeName,
                    'sourcePointsTo': sourceType.get('pointsToGlobalType'),
                    'emittedPointsTo': emittedType.get('pointsToGlobalType'),
                })
            continue

        sourceParticleList = sourceType['orderedParticles']
        emittedParticleList = emittedType['orderedParticles']

        sourceOrder = [one['particleName'] for one in sourceParticleList]
        emittedOrder = [one['particleName'] for one in emittedParticleList]
        if sourceOrder != emittedOrder:
            particleOrderDifferenceList.append({
                'typeName': oneTypeName, 'sourceOrder': sourceOrder[:40],
                'emittedOrder': emittedOrder[:40]})

        # COMPARED BY POSITION, NOT BY NAME. Keying resolved types on the bare particle name let
        # two same-named particles in one content model collapse with last-wins, which the review
        # found. Position is the particle's identity within its own content model.
        for onePosition in range(min(len(sourceParticleList), len(emittedParticleList))):
            sourceParticle = sourceParticleList[onePosition]
            emittedParticle = emittedParticleList[onePosition]
            if sourceParticle['particleName'] != emittedParticle['particleName']:
                continue  # an order difference, already reported above; not a type difference
            if sourceParticle['resolvedTypeName'] != emittedParticle['resolvedTypeName']:
                resolvedTypeDifferenceList.append({
                    'typeName': oneTypeName,
                    'position': onePosition,
                    'particleName': sourceParticle['particleName'],
                    'sourceResolvedType': sourceParticle['resolvedTypeName'],
                    'emittedResolvedType': emittedParticle['resolvedTypeName']})

        if sourceType['enumerationValues'] != emittedType['enumerationValues']:
            enumerationDifferenceList.append({
                'typeName': oneTypeName,
                'onlyInSource': sorted(set(sourceType['enumerationValues'])
                                       - set(emittedType['enumerationValues']))[:20],
                'onlyInEmitted': sorted(set(emittedType['enumerationValues'])
                                        - set(sourceType['enumerationValues']))[:20]})

    return {
        'typeOnlyInSource': typeOnlyInSource,
        'typeOnlyInEmitted': typeOnlyInEmitted,
        'particleOrderDifferenceList': particleOrderDifferenceList,
        'resolvedTypeDifferenceList': resolvedTypeDifferenceList,
        'enumerationDifferenceList': enumerationDifferenceList,
        'pointerDifferenceList': pointerDifferenceList,
        'traversalUnavailableList': unavailableTypeNameList,
        'comparedTypeCount': len(set(sourceTypeMap) & set(emittedTypeMap))
                             - len(unavailableTypeNameList),
    }


def main():
    if len(sys.argv) != 4:
        refuseByName('xsdComponentCompare: exactly three arguments are REQUIRED and none has a '
                     'default - <sourceCorpusDirectory> <emittedCorpusDirectory> <outputJsonPath>')
    assertProcessorIsXsd11()
    sourceCorpusDirectory, emittedCorpusDirectory, outputJsonPath = sys.argv[1:4]

    startedAt = time.time()
    sourceOutcomeByFilename = compileCorpus(sourceCorpusDirectory)
    emittedOutcomeByFilename = compileCorpus(emittedCorpusDirectory)

    sharedFilenameList = sorted(set(sourceOutcomeByFilename) & set(emittedOutcomeByFilename))
    bothCleanFilenameList = [one for one in sharedFilenameList
                             if sourceOutcomeByFilename[one]['status'] == 'clean'
                             and emittedOutcomeByFilename[one]['status'] == 'clean']
    sourceCleanEmittedNotList = [one for one in sharedFilenameList
                                 if sourceOutcomeByFilename[one]['status'] == 'clean'
                                 and emittedOutcomeByFilename[one]['status'] != 'clean']
    emittedCleanSourceNotList = [one for one in sharedFilenameList
                                 if emittedOutcomeByFilename[one]['status'] == 'clean'
                                 and sourceOutcomeByFilename[one]['status'] != 'clean']

    comparisonByFilename = {}
    for oneFilename in bothCleanFilenameList:
        comparisonByFilename[oneFilename] = compareCleanPair(
            sourceOutcomeByFilename[oneFilename], emittedOutcomeByFilename[oneFilename])

    traversalUnavailableTotal = sum(len(one['traversalUnavailableList'])
                                    for one in comparisonByFilename.values())

    payload = {
        'instrument': 'xsdComponentCompare',
        'processorClass': 'XMLSchema11',
        'xmlschemaVersion': xmlschema.__version__,
        'elapsedSeconds': round(time.time() - startedAt, 2),
        'source': tallyOf(sourceOutcomeByFilename),
        'emitted': tallyOf(emittedOutcomeByFilename),
        'sourceRefusalCauseTally': refusalCauseTally(sourceOutcomeByFilename),
        'emittedRefusalCauseTally': refusalCauseTally(emittedOutcomeByFilename),
        'compileAgreement': {
            'sharedFilenames': len(sharedFilenameList),
            'bothClean': len(bothCleanFilenameList),
            'sourceCleanEmittedNotClean': len(sourceCleanEmittedNotList),
            'emittedCleanSourceNotClean': len(emittedCleanSourceNotList),
            'sourceCleanEmittedNotCleanList': sourceCleanEmittedNotList,
            'emittedCleanSourceNotCleanList': emittedCleanSourceNotList,
        },
        'componentComparison': {
            'comparedFilenames': bothCleanFilenameList,
            'comparedTypeTotal': sum(one['comparedTypeCount']
                                     for one in comparisonByFilename.values()),
            'typeOnlyInSourceTotal': sum(len(one['typeOnlyInSource'])
                                         for one in comparisonByFilename.values()),
            'typeOnlyInEmittedTotal': sum(len(one['typeOnlyInEmitted'])
                                          for one in comparisonByFilename.values()),
            'particleOrderDifferenceTotal': sum(len(one['particleOrderDifferenceList'])
                                                for one in comparisonByFilename.values()),
            'resolvedTypeDifferenceTotal': sum(len(one['resolvedTypeDifferenceList'])
                                               for one in comparisonByFilename.values()),
            'enumerationDifferenceTotal': sum(len(one['enumerationDifferenceList'])
                                              for one in comparisonByFilename.values()),
            'pointerDifferenceTotal': sum(len(one['pointerDifferenceList'])
                                          for one in comparisonByFilename.values()),
            # CONSUMED, not merely emitted. Types excluded from every count above because one or
            # both sides could not be walked. NONZERO MEANS THE COMPARISON IS INCOMPLETE BY THAT
            # AMOUNT, and it must never be read as agreement.
            'traversalUnavailableTotal': traversalUnavailableTotal,
            'perFilename': comparisonByFilename,
        },
        'sourceOutcomeByFilename': sourceOutcomeByFilename,
        'emittedOutcomeByFilename': emittedOutcomeByFilename,
    }

    with open(outputJsonPath, 'w') as oneHandle:
        json.dump(payload, oneHandle)

    summaryKeyList = ('instrument', 'processorClass', 'xmlschemaVersion', 'elapsedSeconds',
                      'source', 'emitted', 'compileAgreement', 'emittedRefusalCauseTally')
    summary = dict((oneKey, payload[oneKey]) for oneKey in summaryKeyList)
    summary['compileAgreement'] = dict(
        (oneKey, oneValue) for oneKey, oneValue in summary['compileAgreement'].items()
        if not oneKey.endswith('List'))
    summary['componentComparison'] = dict(
        (oneKey, oneValue) for oneKey, oneValue in payload['componentComparison'].items()
        if oneKey.endswith('Total'))
    print(json.dumps(summary))


main()
