'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// searchTextComposition.js — the PESC260805 HYBRID searchText composition (TQ's re-embed
// authorisation, 2026-08-17: "re-embed authorized"; RULINGS-supervisor-bridgeFramework.md §"TQ
// AUTHORISES THE PESC FORGE RE-EMBED"; evidence REPORT-P0-pescMeasurement.md §13).
//
// WHAT IT DOES, and the one sentence that says why it exists as a SEPARATE PASS:
//   Composes `searchText` for the ruled labels from a DECLARED COMPOSITION REGISTRY keyed on
//   whether the node has an EFFECTIVE DESCRIPTION — its own prose, or its RESOLVES_TO type's when
//   it has none. `RESOLVES_TO` IS BUILT BY THE DERIVED TIER, WHICH RUNS AFTER SOURCE EMISSION, so
//   the effective description IS NOT COMPUTABLE at the point makeNode currently composes text.
//   This pass therefore runs on the COMBINED source+derived graph, where the edge exists.
//
// THE TRAP THIS MODULE'S EXISTENCE PREVENTS, stated because it fails SILENTLY:
//   Composing C2 inside makeNode resolves the effective description to the element's OWN
//   description only — non-empty on 5,521 of 17,491 declarations (31.6%, §5.1). Roughly 68% would
//   then receive `ElementName | ''`, which cleanSegment drops to the bare `ElementName`. That is
//   C1 — the arm DISQUALIFIED by the cosine guard for a 0.169 median fall, more than five times
//   the threshold (§13.1). It parses, forges, round-trips clean and passes every pre-existing
//   gate while shipping the disqualified arm to two thirds of subjects. The `c1ShapedEmissions`
//   counter below exists to make that condition observable, and its gate was observed RED against
//   exactly that naive placement before it was made green.
//
// THE TWO ARMS (declared data, NEVER a branch — the ruling says so in those words):
//   has effective description (~71.5% of source-tier element declarations, 12,127 of 16,969 by
//     §9.3/§5.2) -> C2  `ElementName | effectiveDescription`   — the MEASURED WINNER, collision
//     error floor 0.5475 against C0's 0.6580, median top-1 cosine down 0.001 against a 0.03 guard.
//   no prose anywhere (~28.5%, 4,842 of 16,969) -> C0  `OwningType | ElementName`  — KEPT, because
//     C2 degenerates to C1 there and C1 is disqualified; C0 is the best MEASURED option for a
//     subject with no prose.
//
// A GRAIN CAUTION THAT MUST TRAVEL WITH THOSE PERCENTAGES: the ruling's "~76% / ~24%" are
// CONCEPT-grain figures (1,678 of 2,213 concepts, §5.2; 184 of 769 compared concepts, §13.3). THIS
// PASS OPERATES PER DECLARATION, where the report's own measured split is 71.5% / 28.5%. A
// declaration-grain result near 76/24 is a defect signal, not a confirmation.
//
// WHY THE C0 ARM DELEGATES TO THE SHARED COMPOSER RATHER THAN REIMPLEMENTING IT:
//   `lib/search-text/build-search-text.js` is the ONE shared builder for every standard. The C0
//   arm calls it with the IDENTICAL element the source tier used, so the ~28.5% population's text
//   is byte-identical to the pre-change emission BY CONSTRUCTION rather than by comparison — their
//   vectors do not move, and the shared file stays byte-unchanged, which is what keeps the Ed-Fi,
//   SIF and CEDS base ids from moving.
//
// THE TWO POPULATIONS ARE NOT MUTUALLY COMPARABLE — standing reporting rule (binding constraint 2
// of the ruling). They are embedded on differently-shaped strings. Their pool statistics are
// reported SEPARATELY and NEVER pooled into one figure. The stats this module returns are split by
// arm for that reason and must not be summed into a single retrieval number.
//
// `documentation` is BYTE-IDENTICAL to `description` on all 17,491 element declarations (binding
// constraint 3) — one value under two names. THE COMPOSITION NAMES ONE: `description`. Naming both
// would pay twice for the same tokens.
//
// TWO ASSEMBLY SITES, ONE DECISION SITE — read this before adding a third.
//   `composeOneSearchText` is the ONLY place an arm is chosen and a string is built. It is called
//   from exactly two places, because the two places have DIFFERENT INPUTS TO ASSEMBLE and neither
//   can see the other's:
//     1. forgePesc260805.js — the source tier, over the COMBINED source+derived graph, resolving
//        the effective description through the real RESOLVES_TO edges.
//     2. syntheticTier.js — the merged children of S-1, which REBUILD their searchText rather than
//        inheriting it (searchText is in DUPLICATED_CHILD_OVERRIDDEN_PROPERTY_NAMES), and whose
//        owning class is the MERGED definition's name, not the source child's.
//   The registry, the arm selection and the punctuation are shared; only the input assembly differs.
//   A third caller that reimplements the decision instead of calling this function is the drift this
//   note exists to prevent — and the gate suite asserts BOTH populations carry zero C1-shaped text.
//
// SCOPE, RULED BY SABLE_RIVER ON 2026-08-17 AFTER AZURE_DELTA ASKED (both recorded in
// RULED_SCOPE_RECORD below rather than left as prose):
//   PescAttributeDecl (84 nodes) — INCLUDED. Outside the measured evidence; COUNTED SEPARATELY in
//     the report so the measured population stays traceable.
//   Synthetic merged children — INCLUDED, in syntheticTier's own rebuild. §6.1's synthetic exclusion
//     governs the SCOPE OF JUDGMENT (what gets mapped), not how the forge composes its own node text.
//
// Sync + pure: throws for refusals (house rule, as derivedTier.js and syntheticTier.js do — the
// forge's ONE sanctioned try/catch boundary converts them to the error channel). No callbacks:
// nothing here waits on anything. No async/await, no try/catch for control flow.

const path = require('path');

const CORE_LIB = path.join(__dirname, '..', '..', '..', 'lib');
const buildSearchTextFactory = require(path.join(CORE_LIB, 'search-text', 'build-search-text'));

// the separator the ONE shared composer uses (build-search-text.js: `.join(' | ')`). Declared here
// as a named constant rather than inlined so a drift between the two is a one-line diff instead of
// a hunt, and so the C2 arm cannot silently diverge from the C0 arm's punctuation.
const SEGMENT_SEPARATOR = ' | ';

// PESC_SOURCE_TIER — THIS PASS applies to the SOURCE tier and nothing else. Derived nodes
// (namespaces) keep their own composition; synthetic merged children take the hybrid at their own
// assembly site in syntheticTier.js, per RULED_SCOPE_RECORD.syntheticMergedChildren below.
const PESC_SOURCE_TIER = 'source';

// =================================================================================================
// THE COMPOSITION REGISTRY — declared data, keyed on the description-availability condition.
//
// polyArch2 §7: a registry, never a switch. Adding a third arm means adding an entry, not editing
// control flow. Each entry declares its own name, the ruling that put it there, and its composer.
//
// The condition name is `descriptionAvailabilityCondition` throughout — never the bare word 'key',
// which cannot be interpreted (developmentPractices.md §2a).
// =================================================================================================

/**
 * @interface SearchTextArmComposer
 * @description The formal contract every registry entry satisfies. One polymorphic seam, one
 *   declared interface (polyArch2 §3). A new arm that does not satisfy this is refused by name at
 *   registry-validation time rather than producing a wrong string at emission time.
 * @property {string} armName — the composition's name in the evidence (`C0`, `C2`). Reported, so it
 *   must be the same token the report and the ruling use.
 * @property {string} compositionShape — the human-readable shape, for error text and reports.
 * @property {string} ruledBy — the ruling that put this arm in the registry. An arm with no cited
 *   ruling is an arm somebody added on taste.
 * @property {boolean} readsEffectiveDescription — whether this arm consumes the resolved prose.
 *   Declared so the pass can assert an arm never reads prose it was not given.
 * @property {function(SearchTextCompositionInput): string} composeSearchText — returns the
 *   non-empty composed text, or throws naming the node.
 */

/**
 * @interface SearchTextCompositionInput
 * @description What every composer is handed. Uniform across arms so no arm can reach for
 *   something another arm cannot see.
 * @property {object} searchTextElement — the EXACT element the source tier handed the shared
 *   composer. Carried forward rather than reconstructed, so the C0 arm is byte-identical by
 *   construction and the C2 arm reads an authoritative name.
 * @property {string} elementName — the node's own `name` property.
 * @property {string} effectiveDescription — resolved prose, or `''` when there is none anywhere.
 * @property {function(object): string} buildSharedSearchText — the ONE shared composer, injected
 *   rather than required here, so a composer cannot quietly acquire a second text builder.
 */

const COMPOSITION_REGISTRY = {
	// ---- the ~71.5%: prose exists, so the description SUBSTITUTES for the parent-type prefix.
	// §13.2's clean comparison: C2 vs C3 differ only by the prefix and C2 wins; C1 vs C2 differ
	// only by the description and C2 wins. The description does the work; the prefix is net-harmful
	// once the description is present. The winning composition is SHORTER than the losing one.
	hasEffectiveDescription: {
		armName: 'C2',
		compositionShape: 'ElementName | effectiveDescription',
		ruledBy: 'TQ 2026-08-17 "re-embed authorized"; evidence REPORT-P0-pescMeasurement.md §13.1 (collision floor 0.5475 vs 0.6580)',
		readsEffectiveDescription: true,
		composeSearchText: ({ elementName, effectiveDescription }) =>
			joinSegments([elementName, effectiveDescription]),
	},

	// ---- the ~28.5%: no prose anywhere. KEEP the current composition, because C2 degenerates to
	// C1 here and C1 is the arm the cosine guard DISQUALIFIED. Delegated to the shared composer so
	// this population's text is provably unmoved.
	noProseAnywhere: {
		armName: 'C0',
		compositionShape: 'OwningType | ElementName (unchanged — the shared composer)',
		ruledBy: 'TQ 2026-08-17; REPORT §13.3 — C2 collapses to the DISQUALIFIED C1 without prose, so C0 is the best MEASURED option',
		readsEffectiveDescription: false,
		composeSearchText: ({ searchTextElement, buildSharedSearchText }) =>
			buildSharedSearchText(searchTextElement),
	},
};

// =================================================================================================
// THE COMPOSED SCOPE — declared data, so widening it is a data edit and not a code edit.
//
// PescElementDecl is the population the composition test actually measured (16,969 source-tier
// declarations; §13's 769-concept comparison is drawn from it). Nothing else is in the evidence.
// =================================================================================================
const COMPOSED_LABEL_REGISTRY = {
	PescElementDecl: {
		measuredPopulation: 16969,
		insideMeasuredEvidence: true,
		ruledBy: 'TQ 2026-08-17 re-embed authorisation; the measured population of REPORT §13',
	},
	// INCLUDED by SABLE_RIVER's ruling, and recorded as OUTSIDE the measured evidence rather than
	// quietly folded in. Structurally the composer cannot tell an attribute from an element: both are
	// emitted with DME_ROLES.PROPERTY and a searchTextElement of the same shape. The exposure is 84
	// nodes and they are COUNTED SEPARATELY in the report, so the measured 16,969 stays traceable.
	PescAttributeDecl: {
		measuredPopulation: 0,
		insideMeasuredEvidence: false,
		nodeCountAtRulingTime: 84,
		ruledBy: 'SABLE_RIVER IMCS 2026-08-17, answering AZURE_DELTA Q1: "INCLUDE, as you recommend ... they sit OUTSIDE the measured evidence ... you COUNT THEM SEPARATELY"',
	},
};

// RULED_SCOPE_RECORD — the two scope questions AZURE_DELTA put to SABLE_RIVER, with the answers, as
// DATA rather than as prose nobody greps. Kept after the ruling rather than deleted, because the
// interesting part is not the answer but the fact that both extensions sit OUTSIDE the measured
// evidence and were admitted on a stated mechanism rather than on measurement. A successor asking
// "why does an attribute get the winning arm when the test never measured one?" gets the reason here.
const RULED_SCOPE_RECORD = {
	attributeDeclarations: {
		question:
			'do the 84 PescAttributeDecl nodes take the hybrid? They are emitted with DME_ROLES.PROPERTY ' +
			'and a searchTextElement byte-identical in SHAPE to an element declaration, so the composer ' +
			'cannot tell them apart — but the measured population was PescElementDecl ONLY',
		ruling: 'INCLUDE (SABLE_RIVER, IMCS 2026-08-17)',
		reason:
			'the ruled mechanism — description substitutes for a parent-type prefix that says nothing ' +
			'about the element\'s own meaning — applies identically to an attribute; excluding them ' +
			'manufactures a THIRD population the never-pool rule must then carry for 84 nodes',
		evidenceStatus: 'OUTSIDE the measured evidence. Exposure 84 nodes. Counted SEPARATELY in the report.',
	},
	syntheticMergedChildren: {
		question:
			'the synthetic tier REBUILDS searchText for S-1 merged children (syntheticTier.js, and ' +
			'searchText is in DUPLICATED_CHILD_OVERRIDDEN_PROPERTY_NAMES) rather than inheriting it. ' +
			'Do they get the hybrid, or keep C0 in deference to §6.1\'s synthetic exclusion?',
		ruling: 'GIVE THEM THE HYBRID, in syntheticTier\'s own rebuild (SABLE_RIVER, IMCS 2026-08-17)',
		reason:
			'§6.1\'s exclusion governs the SCOPE OF JUDGMENT — what gets mapped — not how the forge ' +
			'composes its own node text. Two nodes with the same name, type and description carrying ' +
			'differently-shaped embedded text, for a reason no reader could reconstruct from the graph, ' +
			'is the worse outcome. The round trip\'s synthetic check is identity-only and content-blind, ' +
			'so this cannot disturb it.',
		evidenceStatus:
			'OUTSIDE the measured evidence (§6.1 measured that the 522 synthetic declarations add ZERO ' +
			'distinct concepts, which is why they were excluded from JUDGMENT scope).',
	},
};

// joinSegments — the shared composer's cleaning semantics, reproduced EXACTLY so the C2 arm cannot
// punctuate differently from the C0 arm. build-search-text.js cleanSegment: coerce, trim,
// null/undefined/'' become null and are dropped from the join.
//
// Declared at module scope (not inside the factory) because COMPOSITION_REGISTRY is a module-scope
// literal that calls it. Pure: same input, same output, no state.
const cleanOneSegment = (value) => {
	if (value == null) {
		return null;
	}
	const trimmed = `${value}`.trim();
	return trimmed === '' ? null : trimmed;
};

const joinSegments = (segmentList) =>
	segmentList
		.map(cleanOneSegment)
		.filter((oneSegment) => oneSegment != null)
		.join(SEGMENT_SEPARATOR);

// =================================================================================================
// THE RENDERING SEAT — three properties PERSISTED, never newly computed.
// LUNAR_PRISM (P1), ruled by SABLE_RIVER as P1-R8, 2026-08-17.
//
// WHY IT HAD TO EXIST. The bridge's `renderingAllowList` names NODE PROPERTIES, and the framework's
// evidence path is a PURE FILTER over one flat property bag — [code fact] evidenceRenderer.js:134
// calls graphSeamRules.allowListedPropertiesFor({ properties: sourceElement.material, ... }) — with
// NO edge traversal anywhere on that path. So the RESOLVES_TO description, which REPORT-P0 §5.2
// measures as lifting judge-visible prose from 31.6% to 71.5% of declarations and which the P1
// brief makes MANDATORY, was not reachable by any declaration at all: it lives ACROSS AN EDGE, on
// another node. A bridge cannot ask for it. Only the forge can put it where a bridge can see it.
//
// THE DECISIVE FACT, AND THE REASON THIS COSTS NOTHING: THIS PASS ALREADY COMPUTES THE VALUE AND
// THEN THROWS IT AWAY INTO A STRING. resolveEffectiveDescription already walks the REAL RESOLVES_TO
// edges, at the one point in the pipeline where they exist (the ordering trap this module was built
// around). Nothing is derived here that the forge did not already derive. A DERIVATION THE FORGE
// ALREADY MAKES AND DISCARDS IS SIMPLY PERSISTED. Zero framework bytes; zero embedding spend,
// because searchText is untouched and every text remains a cache hit.
//
// ⚠️ THE SILENCE THAT MADE THIS DANGEROUS TO GET WRONG, recorded so the next person adding a seat
// does not rediscover it: the framework's OWN guard against an allow-listed name that describes
// nothing — graphSeamRules.js allowListRefusal, whose comment reasons the hazard correctly and in
// full — IS DEAD CODE. Written, documented, exported, and NEVER CALLED: three references in the
// entire repository, all three inside its own file, and every consumer requires the module whole
// with no destructuring, so a call could only appear as that literal string. Its sibling
// allowListedRecordFor is dead the same way. CONSEQUENCE: a declaration naming a property no node
// carries renders NOTHING, SILENTLY, and every gate stays green forever. A GATE NEVER CALLED IS NOT
// A GATE, and in source it reads exactly like one that works. Recorded as a framework defect on the
// docket by SABLE_RIVER (P1-R9); NOT repaired here, because lib/bridge-framework/ is this order's
// hard line and repairing it would forfeit the zero-framework-diff proof this phase exists to make.
// The bridge's own acceptance suite carries a conjunct that closes the hazard FOR THIS PLUGIN. That
// conjunct does not fix the framework and must never be described as though it does.
// =================================================================================================
const SEAT_PROPERTY_REGISTRY = {
	// THE SEAT ITSELF. Allow-listed by the bridge and rendered to the judge.
	effectiveDescription: {
		judgeVisible: true,
		valueSource: 'resolveEffectiveDescription — the node\'s own description, or its RESOLVES_TO type\'s',
		absentIs: "'' — and the renderer OMITS an empty value rather than printing a blank line (allowListedPropertiesFor drops '' as well as null)",
		why: 'REPORT-P0 §5.2: 6,646 otherwise-mute declarations are rescued by their type\'s prose; 31.6% -> 71.5% coverage. The P1 brief calls this seat MANDATORY.',
	},
	// THE OWNING TYPE. Judge-visible, and it REPAIRS A RECIPE THAT SILENTLY STOPPED WORKING.
	owningTypeName: {
		judgeVisible: true,
		valueSource:
			'searchTextElement.owningClassName || searchTextElement.owningName — the IDENTICAL expression the shared composer uses for its first segment ([code fact] lib/search-text/build-search-text.js:59-60), so the stamped value cannot disagree with the C0 arm\'s prefix BY CONSTRUCTION rather than by test',
		absentIs: "'' — an element with no owning context (a top-level declaration) omits the line",
		why:
			'REPORT-P0 §5.4 recommends rendering the owning type and tells a reader to PARSE IT FROM searchText. ' +
			'THAT RECIPE IS NOW BROKEN AND NOBODY HAD WRITTEN IT DOWN: after the C2 hybrid a prose-bearing ' +
			'declaration\'s searchText is `ElementName | effectiveDescription` and NO LONGER CONTAINS THE OWNING ' +
			'TYPE — 11,907 of 16,969 declarations at the P0b measurement. Stamping the value makes the recipe ' +
			'UNNECESSARY instead of leaving a documented instruction that quietly no longer works.',
	},
	// PROVENANCE. NOT for the judge — for the CENSUS and the rendering audit.
	proseSource: {
		judgeVisible: false,
		valueSource: "resolveEffectiveDescription — one of 'own' | 'resolvedType' | 'none'",
		absentIs: 'never absent; the resolver always names one of the three',
		why:
			'IT MAKES THE 71.5% CLAIM MEASURABLE ON THE SHIPPED ARTIFACT INSTEAD OF QUOTED FROM A REPORT. ' +
			'P2\'s census can then report evidence coverage BY SOURCE rather than asserting it, and any reader ' +
			'can re-derive the figure from the graph at any later date. Every expensive hour of this order has ' +
			'come from a number that was true when measured and unverifiable afterwards.',
	},
};

// seatPropertiesFor — the ONE producer of the seat bag, from values this pass already holds.
//
// SELF-GUARDING BY DESIGN: the produced key set is checked against SEAT_PROPERTY_REGISTRY's key set
// and DISAGREEMENT REFUSES BY NAME. Adding a registry entry without producing it — or producing a
// property the registry does not document — is the drift that turns declared data back into
// undocumented code, and it is exactly the failure this module avoids elsewhere by exporting its
// registries to the gates instead of restating them. A registry nobody checks is a comment.
const seatPropertiesFor = ({ searchTextElement, effectiveDescription, proseSource, describedBy, refuse }) => {
	const produced = {
		effectiveDescription: cleanOneSegment(effectiveDescription) === null ? '' : `${effectiveDescription}`.trim(),
		owningTypeName:
			cleanOneSegment(searchTextElement.owningClassName || searchTextElement.owningName) === null
				? ''
				: `${searchTextElement.owningClassName || searchTextElement.owningName}`.trim(),
		proseSource,
	};
	const registryNameList = Object.keys(SEAT_PROPERTY_REGISTRY).sort();
	const producedNameList = Object.keys(produced).sort();
	if (registryNameList.join(',') !== producedNameList.join(',')) {
		refuse(
			`seatPropertiesFor (${describedBy || 'caller unnamed'}): the produced seat properties ` +
				`[${producedNameList.join(', ')}] do not match SEAT_PROPERTY_REGISTRY [${registryNameList.join(', ')}]. ` +
				`A registry that has drifted from its producer documents a property nobody stamps, or stamps a ` +
				`property nobody documents — refused by name rather than allowed to disagree quietly`,
		);
	}
	return produced;
};

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		const { buildSearchText } = buildSearchTextFactory();

		const refuse = (message) => {
			throw new Error(`pesc260805 searchTextComposition REFUSES: ${message}`);
		};

		const labelHas = (oneNode, label) => oneNode.labels.indexOf(label) !== -1;

		// requiredProperty — absent-property reads throw (house rule, mirrored from derivedTier.js):
		// reading a property that is not there is a wrong-model bug, not a default-to-empty
		// situation. This is the guard the `pescTier`-not-`tier` trap earns: a MISSPELLED property
		// name returns null on every node instead of erroring, so a typo and genuinely absent data
		// are indistinguishable from the result. Here a misspelling refuses by name instead.
		const requiredProperty = (oneNode, propertyName) => {
			if (!Object.prototype.hasOwnProperty.call(oneNode.properties, propertyName)) {
				refuse(
					`node '${oneNode.stableId}' has no property '${propertyName}' — the composition's ` +
						`model of the graph is wrong, which is a bug, not a default`,
				);
			}
			return oneNode.properties[propertyName];
		};

		// -----
		// validateRegistry — every entry satisfies SearchTextArmComposer before anything is composed.
		// A malformed arm is refused at the registry, not discovered as a wrong string in 16,969
		// nodes. Runs on every call: it is a handful of property checks over two entries.
		const validateRegistry = () => {
			const REQUIRED_ARM_PROPERTY_NAMES = [
				'armName',
				'compositionShape',
				'ruledBy',
				'readsEffectiveDescription',
				'composeSearchText',
			];
			Object.keys(COMPOSITION_REGISTRY).forEach((oneConditionName) => {
				const oneArm = COMPOSITION_REGISTRY[oneConditionName];
				REQUIRED_ARM_PROPERTY_NAMES.forEach((onePropertyName) => {
					if (!Object.prototype.hasOwnProperty.call(oneArm, onePropertyName)) {
						refuse(
							`registry arm '${oneConditionName}' does not satisfy SearchTextArmComposer — ` +
								`missing '${onePropertyName}'. Required: ${REQUIRED_ARM_PROPERTY_NAMES.join(', ')}`,
						);
					}
				});
				if (typeof oneArm.composeSearchText !== 'function') {
					refuse(
						`registry arm '${oneConditionName}' has a composeSearchText that is not a function ` +
							`(got ${typeof oneArm.composeSearchText})`,
					);
				}
			});
		};

		// -----
		// resolveEffectiveDescription — the element's OWN description, or its RESOLVES_TO type's when
		// the element has none (REPORT §12.1, §5.2). Returns the prose and WHERE IT CAME FROM, so the
		// two sources can be counted separately and the rescue's contribution is visible rather than
		// inferred.
		//
		// §9.3 measured that every element resolves to AT MOST ONE type (15,662 to one, 1,307 to
		// none), so the resolution is deterministic and needs no tie-break. A SECOND edge would break
		// that premise, so it REFUSES rather than picking one — silence is not consent to a tie-break
		// nobody designed.
		const resolveEffectiveDescription = ({ oneNode, resolvesToTargetsByFromStableId, nodeByStableId }) => {
			const ownDescription = cleanOneSegment(requiredProperty(oneNode, 'description'));
			if (ownDescription !== null) {
				return { effectiveDescription: ownDescription, proseSource: 'own' };
			}

			const targetStableIdList = resolvesToTargetsByFromStableId[oneNode.stableId] || [];
			if (targetStableIdList.length === 0) {
				return { effectiveDescription: '', proseSource: 'none' };
			}
			if (targetStableIdList.length > 1) {
				refuse(
					`node '${oneNode.stableId}' has ${targetStableIdList.length} RESOLVES_TO targets ` +
						`(${targetStableIdList.join(', ')}) — §9.3 measured at most one per declaration, so ` +
						`the composition has no declared tie-break and will not invent one`,
				);
			}

			const targetNode = nodeByStableId[targetStableIdList[0]];
			if (targetNode === undefined) {
				refuse(
					`node '${oneNode.stableId}' RESOLVES_TO '${targetStableIdList[0]}', which is not a node ` +
						`in the graph handed to the composition — an unresolved endpoint is a builder bug`,
				);
			}

			const resolvedDescription = cleanOneSegment(requiredProperty(targetNode, 'description'));
			if (resolvedDescription === null) {
				return { effectiveDescription: '', proseSource: 'none' };
			}
			return { effectiveDescription: resolvedDescription, proseSource: 'resolvedType' };
		};

		// -----
		// selectCondition — the ONE place the arm is chosen. Returns the condition NAME; the caller
		// looks it up. A condition with no registry entry REFUSES by name and lists what is valid
		// (polyArch2 §6: absent or invalid input is a fault, never an occasion for a default).
		const selectCondition = ({ effectiveDescription }) =>
			effectiveDescription === '' ? 'noProseAnywhere' : 'hasEffectiveDescription';

		// -----
		// buildResolvesToIndex — fromStableId -> [toStableId]. Exported because BOTH assembly sites
		// need it and building it twice from two hand-written loops is two derivations of one
		// judgment held against each other.
		//
		// Built from the EDGES ACTUALLY PRESENT. If the derived tier did not run, the index is empty
		// and the c1ShapedEmissions counter is what notices — rather than the composition silently
		// putting every prose-less node into the disqualified arm. That is the ordering trap made
		// observable instead of merely documented.
		const buildResolvesToIndex = (edges) => {
			if (!Array.isArray(edges)) {
				refuse('buildResolvesToIndex needs the edges array');
			}
			const resolvesToTargetsByFromStableId = {};
			edges.forEach((oneEdge) => {
				if (oneEdge.type !== 'RESOLVES_TO') {
					return;
				}
				(resolvesToTargetsByFromStableId[oneEdge.fromRef.id] =
					resolvesToTargetsByFromStableId[oneEdge.fromRef.id] || []).push(oneEdge.toRef.id);
			});
			return resolvesToTargetsByFromStableId;
		};

		// =====================================================================
		// composeOneSearchText — THE ONE DECISION SITE. Every caller, source tier or synthetic tier,
		// comes through here. It chooses the arm from the registry and returns the composed text
		// together with WHICH arm produced it, so a caller can count by arm without re-deriving the
		// condition (re-deriving it is how the two would drift).
		//
		// `describedBy` names the caller for error text — a refusal that cannot say who was composing
		// costs a grep through two assembly sites.
		// =====================================================================
		const composeOneSearchText = ({
			searchTextElement,
			elementName,
			effectiveDescription,
			describedBy,
		} = {}) => {
			if (searchTextElement === undefined) {
				refuse(
					`composeOneSearchText (${describedBy || 'caller unnamed'}): searchTextElement is required — ` +
						`the C0 arm delegates to the shared composer and cannot reconstruct an owning class`,
				);
			}
			if (typeof effectiveDescription !== 'string') {
				refuse(
					`composeOneSearchText (${describedBy || 'caller unnamed'}): effectiveDescription must be a ` +
						`string, '' when there is no prose anywhere (got ${typeof effectiveDescription}). ` +
						`An absent value is not an empty one and will not be coerced into one.`,
				);
			}

			const descriptionAvailabilityCondition = selectCondition({ effectiveDescription });
			const selectedArm = COMPOSITION_REGISTRY[descriptionAvailabilityCondition];
			if (selectedArm === undefined) {
				refuse(
					`composeOneSearchText (${describedBy || 'caller unnamed'}): ` +
						`descriptionAvailabilityCondition '${descriptionAvailabilityCondition}' has no ` +
						`registered composition arm. Declared conditions: ` +
						`${Object.keys(COMPOSITION_REGISTRY).join(', ')}`,
				);
			}

			const composedSearchText = selectedArm.composeSearchText({
				searchTextElement,
				elementName,
				effectiveDescription,
				buildSharedSearchText: buildSearchText,
			});

			if (`${composedSearchText}`.trim() === '') {
				refuse(
					`composeOneSearchText (${describedBy || 'caller unnamed'}): arm ` +
						`'${selectedArm.armName}' composed an EMPTY searchText — the shared composer's own ` +
						`non-empty contract, held here too`,
				);
			}

			return {
				composedSearchText,
				armName: selectedArm.armName,
				descriptionAvailabilityCondition,
				// a C1-shaped emission is a composed text with NO separator: one surviving segment, the
				// bare element name. Computed here, at the decision site, so both assembly sites get the
				// same answer and neither can forget to ask.
				isC1Shaped: composedSearchText.indexOf(SEGMENT_SEPARATOR) === -1,
			};
		};

		// =====================================================================
		// applySearchTextComposition — recompose `searchText` on the ruled labels over the COMBINED
		// source+derived graph, where RESOLVES_TO exists.
		//
		// MUTATES the nodes it is given. The caller (forgePesc260805.js) owns that array — it is the
		// fresh combined graph applyDerivedTier returned, not the caller's input — and the mutation
		// is the point of the pass, so hiding it behind a clone would only cost a copy of 42,372
		// nodes and obscure what happened.
		//
		// Returns stats SPLIT BY ARM. Binding constraint 2: the two populations are embedded on
		// differently-shaped strings, are NOT mutually comparable, and their statistics are never
		// pooled into one figure.
		// =====================================================================
		const applySearchTextComposition = ({ nodes, edges } = {}) => {
			if (!Array.isArray(nodes) || !Array.isArray(edges)) {
				refuse('applySearchTextComposition needs both nodes and edges arrays — pass the COMBINED source+derived graph');
			}
			validateRegistry();

			const nodeByStableId = {};
			nodes.forEach((oneNode) => {
				nodeByStableId[oneNode.stableId] = oneNode;
			});

			const resolvesToTargetsByFromStableId = buildResolvesToIndex(edges);

			// =========================================================================================
			// THE ORDERING GUARD — and the reason it is a REFUSAL and not a counter.
			//
			// I first proposed the C1-shape counter below as the twin for the ordering trap. IT CANNOT
			// CATCH IT, and I found that out while building the red lever rather than after shipping.
			// The C0 arm DELEGATES to the shared composer, which for a PROPERTY role always emits
			// `OwningType | ElementName` — a separator is always present. So under the naive placement
			// the emitted text is never C1-SHAPED; what goes wrong is that far too many declarations are
			// ROUTED to C0. The failure is in the arm SELECTION, and a shape check is blind to it.
			//
			// What IS unmistakable under the naive placement is this: the RESOLVES_TO index is EXACTLY
			// EMPTY, because the edges do not exist yet. So the honest guard is to refuse a hybrid
			// composition that has no resolution available at all — the composition's whole premise is
			// that a mute element can borrow its type's prose, and with no edges it cannot, so every one
			// of the ~68% without own prose would silently take the mute arm.
			//
			// Refusal rather than a counter, because a counter reports a number nobody has to read,
			// while a refusal cannot be ignored. polyArch2 §6: absent input is a fault, not an occasion
			// for a default.
			// =========================================================================================
			if (Object.keys(resolvesToTargetsByFromStableId).length === 0) {
				refuse(
					`the graph handed to the composition carries ZERO RESOLVES_TO edges, so no mute element ` +
						`can borrow its type's prose and every declaration without its OWN description would ` +
						`silently take the no-prose arm. This is the ORDERING TRAP: RESOLVES_TO is built by ` +
						`the DERIVED tier, so the composition must run on the COMBINED source+derived graph, ` +
						`never on the source tier alone and never inside makeNode. ` +
						`Edges received: ${edges.length}.`,
				);
			}

			const stats = {
				resolvesToEdgesSeen: Object.keys(resolvesToTargetsByFromStableId).length,
				byArm: {},
				proseSource: { own: 0, resolvedType: 0, none: 0 },
				// the counter the silent-trap gate reads. A C1-shaped emission is a composed text with
				// no separator in it — the bare element name. Under the hybrid this MUST be zero: the
				// prose arm always has two segments, and the no-prose arm delegates to the shared
				// composer, which for a PROPERTY role always carries the owning class name.
				c1ShapedEmissions: 0,
				c1ShapedExamples: [],
				textUnchangedFromPreviousComposition: 0,
				textChangedFromPreviousComposition: 0,
				composedLabels: Object.keys(COMPOSED_LABEL_REGISTRY),
				// per-label counts, so the 84 attribute declarations stay SEPARATELY traceable from the
				// measured 16,969 element declarations — SABLE_RIVER's condition on admitting them.
				byLabel: {},
				nonSourceTierSkipped: 0,
				// THE RENDERING SEAT's own coverage (P1-R8), reported so the 71.5% evidence figure is a
				// measurement OF THE SHIPPED ARTIFACT rather than a number quoted from REPORT-P0. These
				// three are deliberately NOT folded into any existing tally: nodesStamped must equal the
				// composed node count, and withEffectiveDescription must equal proseSource.own +
				// proseSource.resolvedType, so a disagreement between two independently-incremented
				// counters is visible instead of arithmetic.
				seat: { nodesStamped: 0, withEffectiveDescription: 0, withOwningTypeName: 0 },
			};
			Object.keys(COMPOSED_LABEL_REGISTRY).forEach((oneLabel) => {
				stats.byLabel[oneLabel] = {
					insideMeasuredEvidence: COMPOSED_LABEL_REGISTRY[oneLabel].insideMeasuredEvidence,
					nodesComposed: 0,
					byArm: { hasEffectiveDescription: 0, noProseAnywhere: 0 },
				};
			});
			Object.keys(COMPOSITION_REGISTRY).forEach((oneConditionName) => {
				stats.byArm[oneConditionName] = {
					armName: COMPOSITION_REGISTRY[oneConditionName].armName,
					compositionShape: COMPOSITION_REGISTRY[oneConditionName].compositionShape,
					nodesComposed: 0,
					characterTotal: 0,
					characterMinimum: null,
					characterMaximum: null,
					characterLengths: [],
				};
			});

			nodes.forEach((oneNode) => {
				const composedLabel = Object.keys(COMPOSED_LABEL_REGISTRY).find((oneLabel) =>
					labelHas(oneNode, oneLabel),
				);
				if (composedLabel === undefined) {
					return;
				}
				// THIS pass owns the SOURCE tier only. Synthetic merged children are composed by
				// syntheticTier's own rebuild (RULED_SCOPE_RECORD.syntheticMergedChildren) — and in any
				// case they do not exist yet when this pass runs, which is why the seat is there and not
				// here. Counted rather than ignored so the number is visible if it is ever nonzero.
				if (requiredProperty(oneNode, 'pescTier') !== PESC_SOURCE_TIER) {
					stats.nonSourceTierSkipped++;
					return;
				}

				// the EXACT element the source tier handed the shared composer, carried forward by
				// makeNode rather than reconstructed here. Reconstructing owningClassName from parentId
				// would be wrong for anonymous-type owners, whose container name is a composite
				// (`${containerName}.${elementName}`) that no single node property carries.
				const searchTextElement = oneNode.sourceSearchTextElement;
				if (searchTextElement === undefined) {
					refuse(
						`node '${oneNode.stableId}' carries no sourceSearchTextElement — makeNode must carry ` +
							`the composer input forward for the composition pass to delegate the C0 arm ` +
							`byte-identically; reconstructing it here would guess at anonymous-type owners`,
					);
				}

				const { effectiveDescription, proseSource } = resolveEffectiveDescription({
					oneNode,
					resolvesToTargetsByFromStableId,
					nodeByStableId,
				});
				stats.proseSource[proseSource]++;

				const { composedSearchText, armName, descriptionAvailabilityCondition, isC1Shaped } =
					composeOneSearchText({
						searchTextElement,
						elementName: requiredProperty(oneNode, 'name'),
						effectiveDescription,
						describedBy: `source tier, node '${oneNode.stableId}'`,
					});

				const previousSearchText = requiredProperty(oneNode, 'searchText');
				if (composedSearchText === previousSearchText) {
					stats.textUnchangedFromPreviousComposition++;
				} else {
					stats.textChangedFromPreviousComposition++;
				}

				// THE SILENT-TRAP COUNTER. Computed at the decision site; recorded here. Counted rather
				// than refused so the gate can report HOW MANY and WHICH, which is what makes the red
				// observation legible — a bare throw would name one node and hide the scale.
				if (isC1Shaped) {
					stats.c1ShapedEmissions++;
					if (stats.c1ShapedExamples.length < 5) {
						stats.c1ShapedExamples.push({
							stableId: oneNode.stableId,
							armName,
							composedSearchText,
						});
					}
				}

				const labelStats = stats.byLabel[composedLabel];
				labelStats.nodesComposed++;
				labelStats.byArm[descriptionAvailabilityCondition]++;

				const armStats = stats.byArm[descriptionAvailabilityCondition];
				armStats.nodesComposed++;
				armStats.characterTotal += composedSearchText.length;
				armStats.characterLengths.push(composedSearchText.length);
				armStats.characterMinimum =
					armStats.characterMinimum === null
						? composedSearchText.length
						: Math.min(armStats.characterMinimum, composedSearchText.length);
				armStats.characterMaximum =
					armStats.characterMaximum === null
						? composedSearchText.length
						: Math.max(armStats.characterMaximum, composedSearchText.length);

				oneNode.properties.searchText = composedSearchText;

				// THE RENDERING SEAT (P1-R8). Stamped from values this pass ALREADY holds — nothing is
				// recomputed and no edge is walked a second time. See SEAT_PROPERTY_REGISTRY for what each
				// name is for and why a bridge cannot reach it any other way.
				const seatProperties = seatPropertiesFor({
					searchTextElement,
					effectiveDescription,
					proseSource,
					describedBy: `source tier, node '${oneNode.stableId}'`,
					refuse,
				});
				Object.keys(seatProperties).forEach((oneSeatName) => {
					oneNode.properties[oneSeatName] = seatProperties[oneSeatName];
				});

				// COUNTED, because the seat's whole value is that its coverage is MEASURABLE on the shipped
				// artifact rather than quoted from a report. A count nobody can reproduce from the graph is
				// the thing this seat exists to replace.
				stats.seat.nodesStamped++;
				if (seatProperties.effectiveDescription !== '') {
					stats.seat.withEffectiveDescription++;
				}
				if (seatProperties.owningTypeName !== '') {
					stats.seat.withOwningTypeName++;
				}
			});

			// per-arm character statistics, reported SEPARATELY (binding constraint 2). Median is
			// computed here rather than by a reader summing means, because a mean over two
			// differently-shaped populations is exactly the pooled figure the rule forbids.
			Object.keys(stats.byArm).forEach((oneConditionName) => {
				const armStats = stats.byArm[oneConditionName];
				const sortedLengths = armStats.characterLengths.slice().sort((left, right) => left - right);
				armStats.characterMean =
					armStats.nodesComposed === 0
						? null
						: Number((armStats.characterTotal / armStats.nodesComposed).toFixed(2));
				armStats.characterMedian =
					sortedLengths.length === 0
						? null
						: sortedLengths.length % 2 === 1
							? sortedLengths[(sortedLengths.length - 1) / 2]
							: (sortedLengths[sortedLengths.length / 2 - 1] +
									sortedLengths[sortedLengths.length / 2]) /
								2;
				// the hub's 81-character minimum (§9.1) — the comparability yardstick §13.35 used.
				armStats.atOrAboveHubMinimum = sortedLengths.filter((oneLength) => oneLength >= 81).length;
				delete armStats.characterLengths;
			});

			// the carried composer input is scaffolding for THIS pass and must not travel downstream:
			// nothing else should be able to recompose text from it, and no extra key should ride into
			// the shaping or fingerprint layers even though both read `properties` only.
			nodes.forEach((oneNode) => {
				delete oneNode.sourceSearchTextElement;
			});

			return { stats };
		};

		return {
			// the source-tier pass, called by forgePesc260805.js
			applySearchTextComposition,
			// THE ONE DECISION SITE, plus the two helpers the synthetic tier's assembly site needs.
			// Exported rather than duplicated so the second seat cannot drift from the first.
			composeOneSearchText,
			buildResolvesToIndex,
			resolveEffectiveDescription,
			// THE RENDERING SEAT (P1-R8). Exported for the SAME reason as the composer above: the
			// synthetic tier's merged-child assembly site must stamp the seat from the ONE producer
			// rather than from a second expression that can drift from this one. syntheticTier.js
			// already calls resolveEffectiveDescription there, so it holds every input this needs.
			seatPropertiesFor,
			// exported for the gate suites: the registry and the scope are DATA, so a test reads them
			// rather than restating them — two derivations of one judgment held against each other is
			// the failure this avoids.
			COMPOSITION_REGISTRY,
			COMPOSED_LABEL_REGISTRY,
			RULED_SCOPE_RECORD,
			SEAT_PROPERTY_REGISTRY,
			SEGMENT_SEPARATOR,
			joinSegments,
			selectCondition,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
