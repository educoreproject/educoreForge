#!/usr/bin/env python3
"""
rdfTripleCompare — compare two RDF documents as TRIPLE SETS, using rdflib.

THE POINT OF THIS FILE IS THAT IT SHARES NO CODE WITH THE FORGE.

Our own round-trip comparator canonicalizes both sides with the same module, which makes it
fast and precise about WHAT is missing and WHERE -- but structurally unable to audit its own
assumptions. It collapses internal whitespace on both sides, deliberately, so indentation can
never register as loss. That is correct for its job, and it made a real difference invisible:
CEDS writes 62 `&#13;` character references, our emitter wrote raw carriage returns, and XML
1.0 §2.11 normalizes those away on the next parse. Twenty triples differed. Our instrument
reported zero, honestly, under its own definition.

rdflib applies the RDF/XML spec's own parsing rules and yields TRIPLES. It cannot tell you
which predicate to go fix. It can tell you whether the answer is true.

Output is a single JSON object on stdout so the calling module never parses prose.

Usage: rdfTripleCompare.py <sourcePath> <emittedPath>
"""

import json
import sys
from collections import Counter

try:
    from rdflib import Graph
    from rdflib.term import BNode, Literal
except ImportError as importError:  # pragma: no cover - reported, never guessed at
    print(json.dumps({'error': f'rdflib is not importable: {importError}'}))
    sys.exit(2)


def tripleKey(triple, normalizeWhitespace):
    """A comparable key for one triple.

    BLANK NODES get an identity-independent key. Their labels are an artefact of parsing --
    the same document parsed twice yields different labels -- so comparing them literally
    would report differences that do not exist. This is a deliberate weakening and it is the
    ONE place this comparison is not strict; it is disclosed rather than silent.
    """

    def term(one):
        if isinstance(one, BNode):
            return '_:BNODE'
        if isinstance(one, Literal) and normalizeWhitespace:
            return 'L' + ' '.join(str(one).split())
        return str(one)

    return (term(triple[0]), term(triple[1]), term(triple[2]))


def loadGraph(path):
    graph = Graph()
    graph.parse(path, format='xml')
    return graph


def main():
    if len(sys.argv) != 3:
        print(json.dumps({'error': 'usage: rdfTripleCompare.py <sourcePath> <emittedPath>'}))
        sys.exit(2)

    sourcePath, emittedPath = sys.argv[1], sys.argv[2]

    try:
        sourceGraph = loadGraph(sourcePath)
        emittedGraph = loadGraph(emittedPath)
    except Exception as parseError:  # noqa: BLE001 - the caller decides what a parse fault means
        print(json.dumps({'error': f'rdflib could not parse: {parseError}'}))
        sys.exit(3)

    result = {
        'sourceTripleCount': len(sourceGraph),
        'emittedTripleCount': len(emittedGraph),
        'sourcePath': sourcePath,
        'emittedPath': emittedPath,
        'rdflibVersion': __import__('rdflib').__version__,
    }

    # STRICT is the verdict. The whitespace-normalized pass is reported alongside it purely as
    # a DIAGNOSTIC: when strict differs and normalized does not, the difference is entirely
    # inside literal text, which is a very different repair from a missing statement.
    for normalize, label in ((False, 'strict'), (True, 'whitespaceNormalized')):
        sourceKeys = Counter(tripleKey(one, normalize) for one in sourceGraph)
        emittedKeys = Counter(tripleKey(one, normalize) for one in emittedGraph)
        onlySource = sourceKeys - emittedKeys
        onlyEmitted = emittedKeys - sourceKeys
        result[label] = {
            'inSourceNotEmitted': sum(onlySource.values()),
            'inEmittedNotSource': sum(onlyEmitted.values()),
            'sourceSamples': [
                {'subject': k[0][:200], 'predicate': k[1][:200], 'object': str(k[2])[:200], 'count': n}
                for k, n in list(onlySource.items())[:10]
            ],
            'emittedSamples': [
                {'subject': k[0][:200], 'predicate': k[1][:200], 'object': str(k[2])[:200], 'count': n}
                for k, n in list(onlyEmitted.items())[:10]
            ],
        }

    result['identical'] = (
        result['strict']['inSourceNotEmitted'] == 0
        and result['strict']['inEmittedNotSource'] == 0
        and result['sourceTripleCount'] == result['emittedTripleCount']
    )
    print(json.dumps(result))


if __name__ == '__main__':
    main()
