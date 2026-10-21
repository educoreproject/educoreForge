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
// A reference under a native prefix to a term the source does not define (CTDL 21, CTDL-ASN 35, CTDL-QData 13) becomes no
// edge and no crossRef in this oracle-faithful port; the round trip names each one, and phase P2b carries them as crossRefs.

const EDGE_TYPE = Object.freeze({
	HAS_CLASS: 'HAS_CLASS',
	HAS_PROPERTY: 'HAS_PROPERTY',
	HAS_OPTION_SET: 'HAS_OPTION_SET',
	HAS_VALUE: 'HAS_VALUE',
	SUBCLASS_OF: 'SUBCLASS_OF',
	REFERENCES: 'REFERENCES',
	BROADER_CONCEPT: 'BROADER_CONCEPT',
	TOP_CONCEPT_OF: 'TOP_CONCEPT_OF',
	SUBPROPERTY_OF: 'SUBPROPERTY_OF',
	INVERSE_OF: 'INVERSE_OF',
	RELATED_CONCEPT: 'RELATED_CONCEPT',
});

// which native reference becomes which edge: (term kind, predicate, target term kind) → edge, read as data
// so the walk holds no switch. `from` names which end the declaring entry is.
const STRUCTURAL_REFERENCE_RULE_LIST = Object.freeze([
	Object.freeze({ termKind: 'class', predicateName: 'rdfs:subClassOf', targetTermKind: 'class', edgeType: EDGE_TYPE.SUBCLASS_OF, from: 'declaring' }),
	Object.freeze({ termKind: 'property', predicateName: 'schema:domainIncludes', targetTermKind: 'class', edgeType: EDGE_TYPE.HAS_PROPERTY, from: 'target' }),
	Object.freeze({ termKind: 'property', predicateName: 'meta:targetScheme', targetTermKind: 'optionSet', edgeType: EDGE_TYPE.HAS_OPTION_SET, from: 'declaring' }),
	Object.freeze({ termKind: 'property', predicateName: 'schema:rangeIncludes', targetTermKind: 'class', edgeType: EDGE_TYPE.REFERENCES, from: 'declaring' }),
	Object.freeze({ termKind: 'optionValue', predicateName: 'skos:inScheme', targetTermKind: 'optionSet', edgeType: EDGE_TYPE.HAS_VALUE, from: 'target' }),
	// ⟪P2b enrichment⟫ a rule with an enrichmentKind applies only when the bundle's profile lists that kind (WORKORDER-P2b E-rows)
	Object.freeze({ enrichmentKind: 'E1', termKind: 'optionValue', predicateName: 'skos:broader', targetTermKind: 'optionValue', edgeType: EDGE_TYPE.BROADER_CONCEPT, from: 'declaring' }),
	Object.freeze({ enrichmentKind: 'E2', termKind: 'optionValue', predicateName: 'skos:topConceptOf', targetTermKind: 'optionSet', edgeType: EDGE_TYPE.TOP_CONCEPT_OF, from: 'declaring' }),
	Object.freeze({ enrichmentKind: 'E3', termKind: 'property', predicateName: 'rdfs:subPropertyOf', targetTermKind: 'property', edgeType: EDGE_TYPE.SUBPROPERTY_OF, from: 'declaring' }),
	Object.freeze({ enrichmentKind: 'E4', termKind: 'property', predicateName: 'owl:inverseOf', targetTermKind: 'property', edgeType: EDGE_TYPE.INVERSE_OF, from: 'declaring' }),
	Object.freeze({ enrichmentKind: 'E5', termKind: 'property', predicateName: 'meta:targetScheme', targetTermKind: 'class', edgeType: EDGE_TYPE.REFERENCES, from: 'declaring', edgeProperties: Object.freeze({ locator: 'meta:targetScheme' }) }),
	Object.freeze({ enrichmentKind: 'E13', termKind: 'optionValue', predicateName: 'skos:relatedMatch', targetTermKind: 'optionValue', edgeType: EDGE_TYPE.RELATED_CONCEPT, from: 'declaring' }),
]);

// ⟪P2b E1a, E6⟫ native statements that are probably source anomalies (a concept broader than a SCHEME; a property declared
// equivalent to a CLASS): carried verbatim as { predicate, target } in nativeDeclarationAnomalyList, never made an edge
const ANOMALY_RULE_LIST = Object.freeze([
	Object.freeze({ enrichmentKind: 'E1a', termKind: 'optionValue', predicateName: 'skos:broader', targetTermKind: 'optionSet' }),
	Object.freeze({ enrichmentKind: 'E6', termKind: 'property', predicateName: 'owl:equivalentProperty', targetTermKind: 'class' }),
]);

// ⟪P2b E7, E8, E10⟫ texts and links the July forge dropped, each carried under its own property, never merged into description:
// a secondary description is carried only where it lost the precedence and differs from the text that won
const CARRIED_TEXT_RULE_LIST = Object.freeze([
	Object.freeze({ enrichmentKind: 'E7', predicateName: 'rdfs:comment', propertyName: 'rdfsComment', isSecondaryDescription: true }),
	Object.freeze({ enrichmentKind: 'E8', predicateName: 'skos:definition', propertyName: 'skosDefinition', isSecondaryDescription: true }),
	Object.freeze({ enrichmentKind: 'E10', predicateName: 'meta:changeHistory', propertyName: 'changeHistoryUrl', isSecondaryDescription: false }),
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

const { isNativeIriFor, prefixOf } = require('./nativeIdentity');
const { validateVocabularyProfile } = require('./vocabularyProfileContract');

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabularyProfile }) => {
		validateVocabularyProfile(vocabularyProfile);
		const {
			standardSource,
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
			enrichmentKindList,
			rangeDatatypeRule,
		} = vocabularyProfile;

		const isNativeIri = isNativeIriFor(vocabularyProfile);
		const isSeamIri = (iriText) => seamTargetPrefixList.indexOf(prefixOf(iriText)) !== -1;
		const isEnriched = (enrichmentKind) => enrichmentKindList.indexOf(enrichmentKind) !== -1;
		// ⟪ctdlHub P4 E14⟫ a range target is a DATATYPE when its prefix or its whole CURIE is declared so (rangeDatatypeRule)
		const isDatatypeIri = (iriText) => rangeDatatypeRule.prefixList.indexOf(prefixOf(iriText)) !== -1 || rangeDatatypeRule.termIdList.indexOf(iriText) !== -1;
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
			const walkStats = { crossRefTotal: 0, declaredCorrespondenceTotal: 0, duplicateEdgeSuppressedCount: 0, unresolvedNativePrefixReferenceCount: 0 };

			const addedEdgeSignatureSet = new Set();
			const addEdgeOnce = ({ edgeType, fromStableId, toStableId, edgeContext, edgeProperties }) => {
				const edgeSignature = `${edgeType}|${fromStableId}|${toStableId}`;
				if (addedEdgeSignatureSet.has(edgeSignature)) {
					walkStats.duplicateEdgeSuppressedCount += 1;
					return;
				}
				addedEdgeSignatureSet.add(edgeSignature);
				kit.addEdge({ edgeType, fromStableId, toStableId, edgeContext, edgeProperties });
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
						walkStats.unresolvedNativePrefixReferenceCount += 1;
						// ⟪P2b E11⟫ a reference under a claimed prefix to a term the source does not define is carried, never dropped (R4)
						if (isEnriched('E11')) {
							crossRefList.push({ raw: targetIri, locator: predicateName });
						}
					}
				});
				const nativeDeclarationAnomalyList = ANOMALY_RULE_LIST.filter((oneRule) => oneRule.termKind === termKind && isEnriched(oneRule.enrichmentKind))
					.reduce((anomalyList, oneRule) => anomalyList.concat(nativeTargetsOf(oneEntry, oneRule.predicateName, oneRule.targetTermKind).map((targetId) => ({ predicate: oneRule.predicateName, target: targetId }))), []);
				const winningDescription = firstLanguageValueOf(oneEntry, descriptionPredicatePrecedenceList);
				const carriedTextProperties = CARRIED_TEXT_RULE_LIST.filter((oneRule) => isEnriched(oneRule.enrichmentKind) && oneEntry[oneRule.predicateName] !== undefined)
					.reduce((textProperties, oneRule) => {
						const carriedText = oneRule.isSecondaryDescription ? languageValueOf(oneEntry, oneRule.predicateName) : oneEntry[oneRule.predicateName];
						return oneRule.isSecondaryDescription && carriedText === winningDescription ? textProperties : { ...textProperties, [oneRule.propertyName]: carriedText };
					}, {});
				walkStats.crossRefTotal += crossRefList.length;
				walkStats.declaredCorrespondenceTotal += declaredCorrespondenceList.length;

				// ⟪ctdlHub P4 E14⟫ the property's own datatype ranges, verbatim CURIEs in source order, each once. They stay in crossRefs
				// too (R4: crossRefs is the verbatim record of every non-native reference); this list is the hub's reading of them.
				const rangeDatatypeList = termKind === 'property' && isEnriched('E14')
					? (oneEntry[rangeDatatypeRule.predicateName] || []).filter(isDatatypeIri).filter((iriText, iriIndex, iriList) => iriList.indexOf(iriText) === iriIndex)
					: [];

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
					...(nativeDeclarationAnomalyList.length !== 0 ? { nativeDeclarationAnomalyList: JSON.stringify(nativeDeclarationAnomalyList) } : {}),
					// a LIST, not a JSON string: graph-contract §1 names rangeDatatypeList list-valued, so replay keeps it a list
					...(rangeDatatypeList.length !== 0 ? { rangeDatatypeList } : {}),
					...carriedTextProperties,
				};

				kit.makeNode({
					role: typeSpec.role,
					perStandardLabel: typeSpec.perStandardLabel,
					stableId,
					name,
					description: winningDescription,
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
				STRUCTURAL_REFERENCE_RULE_LIST.filter((oneRule) => oneRule.termKind === termKind && (oneRule.enrichmentKind === undefined || isEnriched(oneRule.enrichmentKind))).forEach((oneRule) => {
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
							edgeProperties: oneRule.edgeProperties,
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
