'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// jsonLdVocabularyWalk.js — the H3 walk for a JSON-LD vocabulary (ctdlHub-101926 P1). PURE: it reads the
// loader's validated payload and the bundle's vocabulary profile, and mints through the kit only.
//
// What it reproduces is the July attic forge's graph (codeAttic/cli/parserLib/forge-ctdl, forgeCtdl.js +
// lib/parser.js), judged against the July oracle GOLD_EVAL_260718 — the same nodes, roles, stableIds and
// edges — with the ratified departures (oracle/A3-candidateList.md):
//   - every non-native reference a native entry makes is carried VERBATIM in crossRefs as { raw, locator },
//     with no ownership tag (R4 / A1); the July forge carried only the family's and dropped the rest;
//   - a reference to a SEAM prefix (the profile's seamTargetPrefixList: CTDL's `ceds:`) is carried instead as
//     declaredCorrespondenceList [{ predicate, target }], the predicate verbatim and the target unresolved
//     (R6 / A2) — the forge never resolves it and never translates the predicate;
//   - edges are de-duplicated on (type, from, to): the source repeats a domain in schema:domainIncludes for 9
//     CTDL properties and the July forge emitted an edge per repetition (ruling Q4).
// A native reference whose target the source never defines (21 in CTDL, all ceterms:) is a SOURCE defect: it
// becomes no edge, and the round trip names each one.

const EDGE_TYPE = Object.freeze({
	HAS_CLASS: 'HAS_CLASS',
	HAS_PROPERTY: 'HAS_PROPERTY',
	HAS_OPTION_SET: 'HAS_OPTION_SET',
	HAS_VALUE: 'HAS_VALUE',
	SUBCLASS_OF: 'SUBCLASS_OF',
	REFERENCES: 'REFERENCES',
});

// which native reference becomes which edge: (term kind, predicate, target term kind) → edge, read as data
// so the walk holds no switch. `from` names which end the declaring entry is.
const STRUCTURAL_REFERENCE_RULE_LIST = Object.freeze([
	Object.freeze({ termKind: 'class', predicateName: 'rdfs:subClassOf', targetTermKind: 'class', edgeType: EDGE_TYPE.SUBCLASS_OF, from: 'declaring' }),
	Object.freeze({ termKind: 'property', predicateName: 'schema:domainIncludes', targetTermKind: 'class', edgeType: EDGE_TYPE.HAS_PROPERTY, from: 'target' }),
	Object.freeze({ termKind: 'property', predicateName: 'meta:targetScheme', targetTermKind: 'optionSet', edgeType: EDGE_TYPE.HAS_OPTION_SET, from: 'declaring' }),
	Object.freeze({ termKind: 'property', predicateName: 'schema:rangeIncludes', targetTermKind: 'class', edgeType: EDGE_TYPE.REFERENCES, from: 'declaring' }),
	Object.freeze({ termKind: 'optionValue', predicateName: 'skos:inScheme', targetTermKind: 'optionSet', edgeType: EDGE_TYPE.HAS_VALUE, from: 'target' }),
]);

// the predicate whose first native target is the term's structural parent, per term kind (absent: the root)
const PARENT_PREDICATE_BY_TERM_KIND = Object.freeze({
	property: Object.freeze({ predicateName: 'schema:domainIncludes', targetTermKind: 'class' }),
	optionValue: Object.freeze({ predicateName: 'skos:inScheme', targetTermKind: 'optionSet' }),
});

// every class hangs from the root by HAS_CLASS (the July synthesised edge); other kinds only through their own rules
const ROOT_EDGE_TYPE_BY_TERM_KIND = Object.freeze({ class: EDGE_TYPE.HAS_CLASS });

// owned terms take a qualified path (<owner>.<name>); the rest their bare name
const QUALIFIED_PATH_TERM_KIND_LIST = Object.freeze(['property', 'optionValue']);

const prefixOf = (curieText) => curieText.split(':')[0];

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabularyProfile }) => {
		const {
			standardSource,
			nativePrefixList,
			seamTargetPrefixList,
			termKindByType,
			termKindOrder,
			labelPredicateList,
			descriptionPredicatePrecedenceList,
			languageTag,
			statusPredicate,
			statusValuePrefix,
			statusCarriedByTermKindList,
			usageNotePredicate,
			usageNoteCarriedByTermKindList,
			predicateDispositionByName,
			domainlessPropertyRootEdge,
		} = vocabularyProfile;

		const isNativeIri = (iriText) => nativePrefixList.indexOf(prefixOf(iriText)) !== -1;
		const isSeamIri = (iriText) => seamTargetPrefixList.indexOf(prefixOf(iriText)) !== -1;
		const languageValueOf = (oneEntry, predicateName) => (oneEntry[predicateName] === undefined ? undefined : oneEntry[predicateName][languageTag]);
		const firstLanguageValueOf = (oneEntry, predicateList) => predicateList.map((predicateName) => languageValueOf(oneEntry, predicateName)).find((oneValue) => oneValue !== undefined && oneValue !== '');

		// referencePairListOf — every (predicate, target) a native entry references, in source order
		const referencePairListOf = (oneEntry) => Object.keys(oneEntry)
			.filter((predicateName) => predicateDispositionByName[predicateName] === 'reference')
			.reduce((pairList, predicateName) => pairList.concat(oneEntry[predicateName].map((targetIri) => ({ predicateName, targetIri }))), []);

		// -----------------------------------------------------------------
		// emitContractGraph — { vocabulary: the loader's payload, kit } → { nodes, edges, stats }
		// -----------------------------------------------------------------
		const emitContractGraph = ({ vocabulary, kit }) => {
			const rootStableId = kit.rootStableId;
			const termKindById = vocabulary.nativeEntryList.reduce((byId, oneEntry) => ({ ...byId, [oneEntry['@id']]: termKindByType[oneEntry['@type']].termKind }), {});
			const nameById = vocabulary.nativeEntryList.reduce((byId, oneEntry) => ({ ...byId, [oneEntry['@id']]: firstLanguageValueOf(oneEntry, labelPredicateList) }), {});
			const walkStats = { crossRefTotal: 0, declaredCorrespondenceTotal: 0, duplicateEdgeSuppressedCount: 0, undefinedNativeTargetCount: 0 };

			const addedEdgeSignatureSet = new Set();
			const addEdgeOnce = ({ edgeType, fromStableId, toStableId, edgeContext }) => {
				const edgeSignature = `${edgeType}|${fromStableId}|${toStableId}`;
				if (addedEdgeSignatureSet.has(edgeSignature)) {
					walkStats.duplicateEdgeSuppressedCount += 1;
					return;
				}
				addedEdgeSignatureSet.add(edgeSignature);
				kit.addEdge({ edgeType, fromStableId, toStableId, edgeContext });
			};

			const nativeTargetsOf = (oneEntry, predicateName, targetTermKind) => (oneEntry[predicateName] || [])
				.filter((targetIri) => termKindById[targetIri] === targetTermKind);

			const constrainedOptionSetIdSet = new Set();
			const orderedEntryList = termKindOrder.reduce(
				(entryList, oneTermKind) => entryList.concat(vocabulary.nativeEntryList.filter((oneEntry) => termKindById[oneEntry['@id']] === oneTermKind)),
				[],
			);

			orderedEntryList.forEach((oneEntry) => {
				const stableId = oneEntry['@id'];
				const termKind = termKindById[stableId];
				const typeSpec = termKindByType[oneEntry['@type']];
				const name = nameById[stableId];

				// the structural parent: the first native target of the kind's parent predicate, else the root
				const parentRule = PARENT_PREDICATE_BY_TERM_KIND[termKind];
				const parentId = parentRule === undefined ? undefined : nativeTargetsOf(oneEntry, parentRule.predicateName, parentRule.targetTermKind)[0];
				// the loader refused every native term without a label, so a parent always has a name
				const owningName = parentId === undefined ? standardSource : nameById[parentId];
				const nodePath = QUALIFIED_PATH_TERM_KIND_LIST.indexOf(termKind) === -1 ? `${name}` : `${owningName}.${name}`;

				// references: seam targets, other non-native targets (crossRefs), undefined native targets
				const crossRefList = [];
				const declaredCorrespondenceList = [];
				referencePairListOf(oneEntry).forEach(({ predicateName, targetIri }) => {
					if (isSeamIri(targetIri)) {
						declaredCorrespondenceList.push({ predicate: predicateName, target: targetIri });
						return;
					}
					if (!isNativeIri(targetIri)) {
						crossRefList.push({ raw: targetIri, locator: predicateName });
						return;
					}
					if (termKindById[targetIri] === undefined) {
						walkStats.undefinedNativeTargetCount += 1;
					}
				});
				walkStats.crossRefTotal += crossRefList.length;
				walkStats.declaredCorrespondenceTotal += declaredCorrespondenceList.length;

				const statusValue = oneEntry[statusPredicate];
				const usageNote = languageValueOf(oneEntry, usageNotePredicate);
				const carriedProperties = {
					...(statusCarriedByTermKindList.indexOf(termKind) !== -1 && statusValue !== undefined ? { status: statusValue.replace(new RegExp(`^${statusValuePrefix}`), '') } : {}),
					...(usageNoteCarriedByTermKindList.indexOf(termKind) !== -1 && usageNote !== undefined && usageNote !== '' ? { usageNote } : {}),
					...(termKind === 'property' ? { domainCount: nativeTargetsOf(oneEntry, 'schema:domainIncludes', 'class').length } : {}),
					// crossRefs is a JSON string the finalizer would otherwise stamp '[]'; { raw, locator } carries no
					// ownership tag (R4), which is why kit.crossRefsJson (system + id required) is not used
					...(crossRefList.length !== 0 ? { crossRefs: JSON.stringify(crossRefList) } : {}),
					...(declaredCorrespondenceList.length !== 0 ? { declaredCorrespondenceList: JSON.stringify(declaredCorrespondenceList) } : {}),
				};

				kit.makeNode({
					role: typeSpec.role,
					perStandardLabel: typeSpec.perStandardLabel,
					stableId,
					name,
					description: firstLanguageValueOf(oneEntry, descriptionPredicatePrecedenceList),
					// owned terms name their owner for the search-text ladder; classes and option sets take the kit's default (the standard)
					structural: { parentId: parentId === undefined ? rootStableId : parentId, path: nodePath, owningName: parentRule === undefined ? undefined : owningName },
					carriedProperties,
					origin: `${vocabulary.sourceFileName} ${stableId}`,
				});

				if (ROOT_EDGE_TYPE_BY_TERM_KIND[termKind] !== undefined) {
					addEdgeOnce({ edgeType: ROOT_EDGE_TYPE_BY_TERM_KIND[termKind], fromStableId: rootStableId, toStableId: stableId, edgeContext: `root->${termKind}` });
				}
				if (termKind === 'property' && parentId === undefined && domainlessPropertyRootEdge) {
					addEdgeOnce({ edgeType: EDGE_TYPE.HAS_PROPERTY, fromStableId: rootStableId, toStableId: stableId, edgeContext: 'root->domainlessProperty' });
				}
				STRUCTURAL_REFERENCE_RULE_LIST.filter((oneRule) => oneRule.termKind === termKind).forEach((oneRule) => {
					nativeTargetsOf(oneEntry, oneRule.predicateName, oneRule.targetTermKind).forEach((targetId) => {
						if (oneRule.edgeType === EDGE_TYPE.HAS_OPTION_SET) {
							constrainedOptionSetIdSet.add(targetId);
						}
						const isTargetTheSource = oneRule.from === 'target';
						addEdgeOnce({
							edgeType: oneRule.edgeType,
							fromStableId: isTargetTheSource ? targetId : stableId,
							toStableId: isTargetTheSource ? stableId : targetId,
							edgeContext: `${oneRule.predicateName}:${stableId}->${targetId}`,
						});
					});
				});
			});

			// an option set no property constrains is anchored from the root (the July orphan pass), so it is reachable
			orderedEntryList
				.filter((oneEntry) => termKindById[oneEntry['@id']] === 'optionSet' && !constrainedOptionSetIdSet.has(oneEntry['@id']))
				.forEach((oneEntry) => addEdgeOnce({ edgeType: EDGE_TYPE.HAS_OPTION_SET, fromStableId: rootStableId, toStableId: oneEntry['@id'], edgeContext: 'root->orphanOptionSet' }));

			Object.keys(walkStats).forEach((statName) => {
				kit.stats[statName] = walkStats[statName];
			});
			return { nodes: kit.nodes, edges: kit.edges, stats: kit.stats };
		};

		return { emitContractGraph };
	};

module.exports = moduleFunction({ moduleName });
