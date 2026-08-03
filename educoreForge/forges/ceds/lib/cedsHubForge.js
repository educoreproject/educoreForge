'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// cedsHubForge.js — the CLEAN REIMPLEMENTATION of the CEDS HubReference derivation
// (SPEC-hubReimplementation-080326.md §1–§5; replaces referenceSubgraph.js at the forger seam
// in Phase 2 — this phase the incumbent stays registered and this module coexists beside it).
//
// One card = one addressable idea = one tuple. The card is SELF-SUFFICIENT: everything needed
// to embed it, render it, and judge it is ON the card (ADDRESS / IDENTITY / MEANING /
// PROVENANCE / DERIVED groups). Edges remain for traversal; no reader requires them.
//
// DERIVATION SEMANTICS ARE THE INCUMBENT'S (referenceSubgraph.js is the semantics authority
// for enumeration even though this module replaces it): one property-tier card per declared
// (domain, property) pair reading allDomainIds SHAPE-AGNOSTICALLY, one value-tier card per
// (domain, property, value) triple, qualified §4.3 identification-pattern cards stem-matched
// exactly as before. What changes is what rides on the address: the MEANING group copies each
// tuple slot's name and prose from the base nodes already present in baseNodeEdges.
//
// addressSignature — RULING R-P1-1 (AMBER_TOWER, 2026-08-03): the INCUMBENT computation
// stands. vocabulary.ADDRESS_SIGNATURE_FIELD_ORDER is the single source of truth for hash
// inputs and order; canonicalKey participates (id-only, so prose purity holds); referenceTier
// stays un-hashed (valueKey presence encodes tier). Prose NEVER enters the signature (G-2).
//
// REFUSALS, NOT SUBSTITUTIONS: a domainId that resolves to no class node, a property with no
// name, a value with no name, a qualifier with no name, an absent root (sourceProvenance),
// an absent/empty factory argument — each is refused BY NAME with the offending id. No
// degraded card is ever emitted. No a||b||c identity chains. Absent is absent: a slot CEDS
// gave no prose gets NO field, never ''.
//
// R7: forgeHub is error-first callback-shaped even though the derivation is synchronous.
// PURE + deterministic: no I/O, no Neo4j, no network, no embedding calls, no Date/random.
// embedText is COMPOSED and STORED here (§4); the vector itself is stamped at build time
// (Phase 2) through the shared content-addressed cache.
//
// @concept: [[HubReference]]
// @concept: [[CedsHubForge]]

const crypto = require('crypto');
const path = require('path');

const vocab = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const {
	NODE_LABELS,
	EQUIVALENCE_NODE_LABELS,
	REFERENCE_TIER,
	CANONICAL_ADDRESS_PROPERTIES: A,
	HUB_REFERENCE_PROPERTIES: HR,
	HUB_DEFINITION_PROPERTIES: HD,
	CEDS_HUB_EDGE_TYPES,
	IN_HUB_EDGE_TYPE,
	ADDRESS_SIGNATURE_FIELD_ORDER,
	PROVENANCE_TIER,
	DME_ROLES,
} = vocab;

const FORGE_MODULE_VERSION = '1.0.0';

// single-element PG-JSON array -> scalar. The replay engine scalarizes single-element arrays,
// so the same property reads back as an array from a fresh forge and as a bare value from a
// deserialized block; both shapes must land in the same place.
const v1 = (arrayOrScalar) =>
	Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar;

// every declared domain, whatever shape it was stored in. 2,068 of 2,324 property nodes hold
// allDomainIds as a bare string after scalarization; an Array.isArray() test would silently
// visit one domain for 89% of the corpus and look exactly like a fix.
const domainListOf = (value) =>
	[]
		.concat(value === undefined || value === null ? [] : value)
		.filter((one) => typeof one === 'string' && one.trim() !== '');

const sha256Hex = (text) =>
	crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const collapseWhitespace = (text) => String(text).replace(/\s+/g, ' ').trim();

// a prose/meaning slot value is CARRIED only when CEDS actually said something. '' is "no
// prose" (G-3: zero ''-valued properties on any card); absent stays absent so "CEDS has no
// definition" and "we failed to copy it" remain distinguishable.
const hasProse = (scalar) =>
	scalar !== undefined && scalar !== null && !(typeof scalar === 'string' && scalar === '');

// FORMAL INTERFACE (polyArch2 — the seam's contract in one place).
//
// @typedef {Object} BaseNodeEdges — the forged (or deserialized) CEDS base.
// @property {Array<{stableId:string, role:string, properties:Object}>} nodes
// @property {Array<{type:string, fromRef:{id:string}, toRef:{id:string}}>} edges
//
// @typedef {Object} HubForgeResult
// @property {Array<{labels:string[], stableId:string, role:string, properties:Object}>} nodes —
//     HubReference cards + the one HubDefinition, sorted by stableId. stableId === uri ===
//     hubNamespace + hubVersion + '/' + addressSignature. NO _id (the replay engine stamps it).
// @property {Array<{type:string, fromRef:Object, toRef:Object, properties:Object}>} edges —
//     HAS_CEDS_* decomposition + IN_HUB, sorted by (type, from, to).
// @property {Array<{role:string, cedsId:string, name:string, description:string, definition:string}>}
//     divergenceReport — one row per source node whose description and definition both carry
//     prose (hasProse) and differ (§5). Explicitly [] when there are none.
// @property {Array<{reason:string, role:string, cedsId:string, propertyKey:string, name:string}>}
//     skipReport — one row per DmeProperty skipped BY NAME (S-3: zeroDeclaredDomains — no
//     declared domain means no tuple). Explicitly [] when nothing was skipped.
// @property {Object} counts — { hubDefinition, propertyTier, valueTier, qualified,
//     hubReferenceTotal, nodeTotal, edgeTotal }.
// @property {Array<Object>} identificationPatterns — every §4.3 pattern examined.
//
// @interface CedsHubForge
// @property {function(BaseNodeEdges, function(errString, HubForgeResult))} forgeHub — R7
//     error-first callback; refuses malformed input and unresolvable slots BY NAME.
// @property {function(Object): string} addressSignatureFor — the R-P1-1 incumbent signature.
// @property {string} hubDefinitionStableId

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ hubVersion, hubNamespace } = {}) => {
		const absentFactoryArgs = [];
		if (typeof hubVersion !== 'string' || hubVersion.trim() === '') {
			absentFactoryArgs.push('hubVersion');
		}
		if (typeof hubNamespace !== 'string' || hubNamespace.trim() === '') {
			absentFactoryArgs.push('hubNamespace');
		}
		if (absentFactoryArgs.length) {
			throw new Error(
				`${moduleName}: REFUSED — required factory argument(s) absent or empty: ` +
					`${absentFactoryArgs.join(', ')}. Both hubVersion and hubNamespace are required; ` +
					`there is no default.`,
			);
		}

		const hubName = 'CEDS';
		const hubDisplayName = 'Common Education Data Standards';
		const canonicalKeyName = 'CEDS Global ID';
		const canonicalKeyMinted = false;

		const hubDefinitionStableId = `${hubNamespace}hubDefinition/${hubName}`;

		// the three range shapes are mutually exclusive (XOR, G-12); the signature folds the one
		// present shape into the single 'range' slot. Stated fold rule, not an identity chain.
		const rangeSlotOf = ({ rangeOptionSetId, rangeClassId, rangeDatatype }) => {
			if (hasProse(rangeOptionSetId)) {
				return rangeOptionSetId;
			}
			if (hasProse(rangeClassId)) {
				return rangeClassId;
			}
			if (hasProse(rangeDatatype)) {
				return rangeDatatype;
			}
			return '';
		};

		// an empty hash slot encodes as '' (the registered encoding rule, not a default value).
		const encodeSignatureSlot = (slotValue) =>
			slotValue === undefined || slotValue === null ? '' : String(slotValue);

		// addressSignature — R-P1-1: the incumbent computation over EXACTLY
		// ADDRESS_SIGNATURE_FIELD_ORDER. Ids only; prose never participates (G-2).
		const addressSignatureFor = ({
			canonicalKey,
			domainId,
			propertyKey,
			rangeOptionSetId,
			rangeClassId,
			rangeDatatype,
			valueKey,
			qualifierKeys,
		}) => {
			const fieldValues = {
				hubName,
				canonicalKey: encodeSignatureSlot(canonicalKey),
				domainId: encodeSignatureSlot(domainId),
				propertyKey: encodeSignatureSlot(propertyKey),
				range: encodeSignatureSlot(
					rangeSlotOf({ rangeOptionSetId, rangeClassId, rangeDatatype }),
				),
				valueKey: encodeSignatureSlot(valueKey),
				// absence encodes as the empty slot — the registered encoding rule, made
				// explicit rather than an || chain
				qualifierKeys: (Array.isArray(qualifierKeys) ? qualifierKeys : [])
					.slice()
					.sort()
					.join(','),
				hubVersion,
			};
			const encoded = ADDRESS_SIGNATURE_FIELD_ORDER.map(
				(oneField) => fieldValues[oneField],
			).join('|');
			return sha256Hex(encoded);
		};

		// =====================================================================
		// embedText composition — §4, BOTH tiers, one scheme. Composed from the CARD's own
		// fields so what was embedded is recomputable byte-for-byte from the card (G-6).
		// =====================================================================
		const composeEmbedText = ({ referenceTier, cardProperties }) => {
			const tierSlots =
				referenceTier === REFERENCE_TIER.VALUE
					? [
							// slot 1 CONTEXT: domainName · propertyName · rangeOptionSetName
							[
								cardProperties.domainName,
								cardProperties.propertyName,
								cardProperties.rangeOptionSetName,
							]
								.filter(hasProse)
								.join(' · '),
							// slot 2 NAME
							cardProperties.valueName,
							// slot 3 DEFINITION (absent for ~52% of values — slot simply empty)
							cardProperties.valueDefinition,
							// slot 4 CONTEXT DEF — option-set definition; the range on value tier IS an
							// option set (stated rule, full stop — not a chain)
							cardProperties.rangeOptionSetDefinition,
						]
					: [
							// slot 1 CONTEXT
							cardProperties.domainName,
							// slot 2 NAME
							cardProperties.propertyName,
							// slot 3 DEFINITION
							cardProperties.propertyDefinition,
							// slot 4 CONTEXT DEF
							cardProperties.domainDefinition,
						];
			// slot 5 QUALIFIER — qualified cards regardless of tier (SPEC §4 as amended by
			// R-P1-1's companion ruling)
			// qualifierNames exists only on qualified cards (documented shape); its absence
			// IS "no qualifier slot", stated explicitly
			const qualifierSlot = (
				Array.isArray(cardProperties.qualifierNames)
					? cardProperties.qualifierNames
					: []
			).join(' · ');
			const allSlots = tierSlots.concat([qualifierSlot]);
			return collapseWhitespace(allSlots.filter(hasProse).join(' · '));
		};

		// =====================================================================
		// forgeHub — R7 callback shape; pure, deterministic, no I/O.
		// =====================================================================
		const forgeHub = (baseNodeEdges, callback) => {
			if (
				!baseNodeEdges ||
				!Array.isArray(baseNodeEdges.nodes) ||
				!Array.isArray(baseNodeEdges.edges)
			) {
				callback(
					`${moduleName}.forgeHub: REFUSED — requires { nodes: [], edges: [] }; ` +
						`got ${JSON.stringify(baseNodeEdges).slice(0, 200)}`,
				);
				return;
			}
			const baseNodes = baseNodeEdges.nodes;
			const baseEdges = baseNodeEdges.edges;

			const derivationFaults = [];
			const refuse = (message) => {
				derivationFaults.push(message);
			};

			const nodes = [];
			const edges = [];

			// ---- index the hub structural nodes ----
			const nodeByStableId = {};
			const nodesByRole = {
				[DME_ROLES.CLASS]: [],
				[DME_ROLES.PROPERTY]: [],
				[DME_ROLES.OPTION_SET]: [],
				[DME_ROLES.OPTION_VALUE]: [],
			};
			const classByDomainId = {};
			let rootNode = null;
			baseNodes.forEach((oneNode) => {
				nodeByStableId[oneNode.stableId] = oneNode;
				const role = v1(oneNode.properties.role);
				if (nodesByRole[role]) {
					nodesByRole[role].push(oneNode);
				}
				if (role === DME_ROLES.CLASS) {
					classByDomainId[v1(oneNode.properties.domainId)] = oneNode;
				}
				if (role === DME_ROLES.STANDARD_ROOT) {
					rootNode = oneNode;
				}
			});

			if (!rootNode) {
				callback(
					`${moduleName}.forgeHub: REFUSED — no ${DME_ROLES.STANDARD_ROOT} node in ` +
						`baseNodeEdges; sourceProvenance cannot be populated (SPEC §2).`,
				);
				return;
			}

			// ---- structural maps from the base ownership edges ----
			const optionSetNodeOfProperty = {};
			const valueNodesOfOptionSet = {};
			const propertyNodesOfClass = {};
			baseEdges.forEach((oneEdge) => {
				const fromNode = nodeByStableId[oneEdge.fromRef.id];
				const toNode = nodeByStableId[oneEdge.toRef.id];
				if (!fromNode || !toNode) {
					return;
				}
				if (oneEdge.type === 'HAS_PROPERTY') {
					(propertyNodesOfClass[fromNode.stableId] =
						propertyNodesOfClass[fromNode.stableId] || []).push(toNode);
				} else if (oneEdge.type === 'HAS_OPTION_SET') {
					optionSetNodeOfProperty[fromNode.stableId] = toNode;
				} else if (oneEdge.type === 'HAS_VALUE') {
					(valueNodesOfOptionSet[fromNode.stableId] =
						valueNodesOfOptionSet[fromNode.stableId] || []).push(toNode);
				}
			});

			// ---- MEANING copy: carried only when CEDS said something (absent stays absent) ----
			const carryProseField = ({ cardProperties, cardFieldName, sourceValue }) => {
				const scalar = v1(sourceValue);
				if (!hasProse(scalar)) {
					return;
				}
				cardProperties[cardFieldName] = scalar;
			};

			// ---- emit one HubReference card + its decomposition edges ----
			const emitReference = ({
				referenceTier,
				canonicalKey,
				domainId,
				propertyKey,
				rangeOptionSetId,
				rangeClassId,
				rangeDatatype,
				valueKey,
				qualifierPairs,
				classNode,
				propertyNode,
				optionSetNode,
				classRangeNode,
				valueNode,
			}) => {
				if (!Array.isArray(qualifierPairs)) {
					refuse(
						`${moduleName}: REFUSED — emitReference requires qualifierPairs as an ` +
							`array (property '${propertyKey}', domain '${domainId}'); an absent ` +
							`list must be stated as [], never implied.`,
					);
					return;
				}
				const propertyName = v1(propertyNode.properties.name);
				if (!hasProse(canonicalKey)) {
					refuse(
						`${moduleName}: REFUSED — ${referenceTier}-tier card for property ` +
							`'${propertyKey}' in domain '${domainId}' has no canonicalKey.`,
					);
					return;
				}
				if (!classNode) {
					refuse(
						`${moduleName}: REFUSED — domainId '${domainId}' resolves to no ` +
							`${DME_ROLES.CLASS} node (property '${propertyKey}').`,
					);
					return;
				}
				if (!hasProse(propertyName)) {
					refuse(
						`${moduleName}: REFUSED — property '${propertyKey}' has no name ` +
							`(domain '${domainId}').`,
					);
					return;
				}
				const valueName = valueNode ? v1(valueNode.properties.name) : undefined;
				if (valueNode && !hasProse(valueName)) {
					refuse(
						`${moduleName}: REFUSED — value '${valueKey}' has no name ` +
							`(property '${propertyKey}', domain '${domainId}').`,
					);
					return;
				}
				const namelessQualifier = qualifierPairs.find(
					(onePair) => !hasProse(onePair.qualifierName),
				);
				if (namelessQualifier) {
					refuse(
						`${moduleName}: REFUSED — qualifier '${namelessQualifier.qualifierKey}' has ` +
							`no name (property '${propertyKey}', domain '${domainId}'); qualifierNames ` +
							`must stay positionally parallel to qualifierKeys.`,
					);
					return;
				}

				// qualifierKeys are SORTED; qualifierNames stay positionally parallel by sorting
				// the PAIRS on the key
				const sortedQualifierPairs = qualifierPairs
					.slice()
					.sort((left, right) =>
						left.qualifierKey < right.qualifierKey
							? -1
							: left.qualifierKey > right.qualifierKey
								? 1
								: 0,
					);
				const sortedQualifierKeys = sortedQualifierPairs.map(
					(onePair) => onePair.qualifierKey,
				);

				const addressSignature = addressSignatureFor({
					canonicalKey,
					domainId,
					propertyKey,
					rangeOptionSetId,
					rangeClassId,
					rangeDatatype,
					valueKey,
					qualifierKeys: sortedQualifierKeys,
				});
				const cardUri = `${hubNamespace}${hubVersion}/${addressSignature}`;

				// name (§1.2): the card's display/matching name — value tier the value's own name,
				// property tier (qualified included) the property's own name; NO " [qualifier]"
				// suffix (qualifier names carry their own field)
				const cardName = valueNode ? valueName : propertyName;

				const cardProperties = {
					_source: hubName,
					role: EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					name: cardName,

					// ---- ADDRESS (§1.1) — ids only; the only inputs to addressSignature ----
					[A.HUB_NAME]: hubName,
					[HR.HUB_VERSION]: hubVersion,
					[HR.REFERENCE_TIER]: referenceTier,
					[A.DOMAIN_ID]: domainId,
					propertyKey,
					[HR.QUALIFIER_KEYS]: sortedQualifierKeys,

					// ---- IDENTITY (§1.2) — derived from the address ----
					[HR.ADDRESS_SIGNATURE]: addressSignature,
					uri: cardUri,
					[HR.CANONICAL_KEY]: canonicalKey,
				};
				if (hasProse(rangeOptionSetId)) {
					cardProperties[A.RANGE_OPTION_SET_ID] = rangeOptionSetId;
				}
				if (hasProse(rangeClassId)) {
					cardProperties[A.RANGE_CLASS_ID] = rangeClassId;
				}
				if (hasProse(rangeDatatype)) {
					cardProperties[HR.RANGE_DATATYPE] = rangeDatatype;
				}
				if (valueNode) {
					cardProperties.valueKey = valueKey;
				}

				// ---- MEANING (§1.3) — every tuple slot carries its name and its prose ----
				carryProseField({
					cardProperties,
					cardFieldName: 'domainName',
					sourceValue: classNode.properties.name,
				});
				carryProseField({
					cardProperties,
					cardFieldName: 'domainDefinition',
					sourceValue: classNode.properties.definition,
				});
				cardProperties.propertyName = propertyName;
				carryProseField({
					cardProperties,
					cardFieldName: 'propertyDefinition',
					sourceValue: propertyNode.properties.definition,
				});
				carryProseField({
					cardProperties,
					cardFieldName: 'propertyNotation',
					sourceValue: propertyNode.properties.notation,
				});
				carryProseField({
					cardProperties,
					cardFieldName: 'propertyDataType',
					sourceValue: propertyNode.properties.dataType,
				});
				carryProseField({
					cardProperties,
					cardFieldName: 'propertyTextFormat',
					sourceValue: propertyNode.properties.textFormat,
				});
				if (classRangeNode) {
					carryProseField({
						cardProperties,
						cardFieldName: 'rangeClassName',
						sourceValue: classRangeNode.properties.name,
					});
					carryProseField({
						cardProperties,
						cardFieldName: 'rangeClassDefinition',
						sourceValue: classRangeNode.properties.definition,
					});
				}
				if (optionSetNode) {
					carryProseField({
						cardProperties,
						cardFieldName: 'rangeOptionSetName',
						sourceValue: optionSetNode.properties.name,
					});
					carryProseField({
						cardProperties,
						cardFieldName: 'rangeOptionSetDefinition',
						sourceValue: optionSetNode.properties.definition,
					});
				}
				if (valueNode) {
					cardProperties.valueName = valueName;
					carryProseField({
						cardProperties,
						cardFieldName: 'valueDefinition',
						sourceValue: valueNode.properties.definition,
					});
					carryProseField({
						cardProperties,
						cardFieldName: 'valueNotation',
						sourceValue: valueNode.properties.notation,
					});
					carryProseField({
						cardProperties,
						cardFieldName: 'valuePrefLabel',
						sourceValue: valueNode.properties.prefLabel,
					});
				}
				if (sortedQualifierPairs.length) {
					cardProperties.qualifierNames = sortedQualifierPairs.map(
						(onePair) => onePair.qualifierName,
					);
				}

				// ---- PROVENANCE (§1.4) — the always-fields are REQUIRED: a source node with
				// no uri is refused by name, never stamped as an undefined-valued key ----
				const provenanceUriOf = ({ sourceNode, sourceRoleLabel }) => {
					const sourceUri = v1(sourceNode.properties.uri);
					if (!hasProse(sourceUri)) {
						refuse(
							`${moduleName}: REFUSED — ${sourceRoleLabel} node ` +
								`'${sourceNode.stableId}' has no uri (property '${propertyKey}', ` +
								`domain '${domainId}'); §1.4 provenance cannot be stamped.`,
						);
						return undefined;
					}
					return sourceUri;
				};
				const domainUri = provenanceUriOf({
					sourceNode: classNode,
					sourceRoleLabel: 'domain class',
				});
				const propertyUri = provenanceUriOf({
					sourceNode: propertyNode,
					sourceRoleLabel: 'property',
				});
				const valueUri = valueNode
					? provenanceUriOf({ sourceNode: valueNode, sourceRoleLabel: 'value' })
					: undefined;
				const rangeUri = optionSetNode
					? provenanceUriOf({
							sourceNode: optionSetNode,
							sourceRoleLabel: 'range option set',
						})
					: classRangeNode
						? provenanceUriOf({
								sourceNode: classRangeNode,
								sourceRoleLabel: 'range class',
							})
						: undefined;
				if (
					domainUri === undefined ||
					propertyUri === undefined ||
					(valueNode && valueUri === undefined) ||
					((optionSetNode || classRangeNode) && rangeUri === undefined)
				) {
					return; // refusal already recorded; no degraded card
				}
				cardProperties.anchorUri = valueNode ? valueUri : propertyUri;
				cardProperties.domainUri = domainUri;
				cardProperties.propertyUri = propertyUri;
				if (rangeUri !== undefined) {
					cardProperties.rangeUri = rangeUri;
				}
				if (valueNode) {
					cardProperties.valueUri = valueUri;
				}

				// ---- DERIVED (§1.5) — composed last so it reads the card's own fields ----
				cardProperties.embedText = composeEmbedText({
					referenceTier,
					cardProperties,
				});

				nodes.push({
					labels: [
						NODE_LABELS.FORGED_NODE,
						EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					],
					stableId: cardUri,
					role: EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					properties: cardProperties,
				});

				const addEdge = (edgeType, toStableId) => {
					edges.push({
						type: edgeType,
						fromRef: { source: hubName, id: cardUri },
						toRef: { source: hubName, id: toStableId },
						properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL },
					});
				};
				addEdge(CEDS_HUB_EDGE_TYPES.DOMAIN, classNode.stableId);
				addEdge(CEDS_HUB_EDGE_TYPES.PROPERTY, propertyNode.stableId);
				if (optionSetNode) {
					addEdge(CEDS_HUB_EDGE_TYPES.RANGE, optionSetNode.stableId);
				} else if (classRangeNode) {
					addEdge(CEDS_HUB_EDGE_TYPES.RANGE, classRangeNode.stableId);
				}
				if (valueNode) {
					addEdge(CEDS_HUB_EDGE_TYPES.VALUE, valueNode.stableId);
				}
				sortedQualifierPairs.forEach((onePair) => {
					addEdge(CEDS_HUB_EDGE_TYPES.QUALIFIER, onePair.qualifierNode.stableId);
				});
				addEdge(IN_HUB_EDGE_TYPE, hubDefinitionStableId);

				return { stableId: cardUri, addressSignature };
			};

			// ---- PASS 1: property tier (one card per declared domain) + value tier ----
			// skipReport (RULING S-3): a DmeProperty with ZERO declared domains has no tuple —
			// it is SKIPPED BY NAME into an explicit report (like the divergence report), never
			// silently dropped and never refused (forge totality is preserved).
			const skipReport = [];
			let propertyTierCount = 0;
			let valueTierCount = 0;
			nodesByRole[DME_ROLES.PROPERTY].forEach((propertyNode) => {
				const propertyProps = propertyNode.properties;
				const propertyKey = v1(propertyProps.canonicalKey);

				// EVERY DECLARED DOMAIN, shape-agnostically (the incumbent's multi-domain rule:
				// each declared domain is a different idea; addressSignature includes domainId so
				// the per-domain cards are distinct by construction)
				const allDeclaredDomainIds = domainListOf(propertyProps.allDomainIds);
				const declaredDomainIds = allDeclaredDomainIds.length
					? allDeclaredDomainIds
					: domainListOf(propertyProps.domainId);
				if (!declaredDomainIds.length) {
					skipReport.push({
						reason: 'zeroDeclaredDomains',
						role: DME_ROLES.PROPERTY,
						cedsId: v1(propertyProps.cedsId),
						propertyKey,
						name: v1(propertyProps.name),
					});
					return;
				}

				const optionSetNode = optionSetNodeOfProperty[propertyNode.stableId];
				const rangeOptionSetId = optionSetNode
					? v1(optionSetNode.properties.rangeOptionSetId)
					: undefined;
				const rangeClassId = optionSetNode
					? undefined
					: v1(propertyProps.rangeClassId);
				const classRangeNode = rangeClassId
					? classByDomainId[rangeClassId]
					: undefined;
				const rangeDatatype =
					optionSetNode || rangeClassId
						? undefined
						: v1(propertyProps.rangeDatatype);

				declaredDomainIds.forEach((domainId) => {
					const classNode = classByDomainId[domainId];

					const emittedPropertyCard = emitReference({
						referenceTier: REFERENCE_TIER.PROPERTY,
						canonicalKey: propertyKey,
						domainId,
						propertyKey,
						rangeOptionSetId,
						rangeClassId,
						rangeDatatype,
						valueKey: '',
						qualifierPairs: [],
						classNode,
						propertyNode,
						optionSetNode,
						classRangeNode,
					});
					if (emittedPropertyCard) {
						propertyTierCount++;
					}

					if (optionSetNode) {
						const valueNodes =
							valueNodesOfOptionSet[optionSetNode.stableId] || [];
						valueNodes.forEach((valueNode) => {
							const valueKey = v1(valueNode.properties.canonicalKey);
							const emittedValueCard = emitReference({
								referenceTier: REFERENCE_TIER.VALUE,
								canonicalKey: valueKey,
								domainId,
								propertyKey,
								rangeOptionSetId,
								rangeClassId: undefined,
								rangeDatatype: undefined,
								valueKey,
								qualifierPairs: [],
								classNode,
								propertyNode,
								optionSetNode,
								valueNode,
							});
							if (emittedValueCard) {
								valueTierCount++;
							}
						});
					}
				});
			});

			// ---- PASS 2: qualified references (§4.3 identification pattern, stem-matched —
			//      the incumbent's enumeration verbatim) ----
			let qualifiedCount = 0;
			const identificationPatterns = [];
			Object.keys(propertyNodesOfClass).forEach((classStableId) => {
				const classNode = nodeByStableId[classStableId];
				const memberPropertyNodes = propertyNodesOfClass[classStableId];
				memberPropertyNodes.forEach((typePropertyNode) => {
					const typePropertyName = v1(typePropertyNode.properties.name);
					const stemMatch = /^Has (.+) Identifier Type$/.exec(
						typeof typePropertyName === 'string' ? typePropertyName : '',
					);
					if (!stemMatch) {
						return;
					}
					const typeOptionSetNode =
						optionSetNodeOfProperty[typePropertyNode.stableId];
					if (!typeOptionSetNode) {
						return; // qualifier must be enumerated to supply qualifier values
					}
					const stem = stemMatch[1];
					const tokenCandidateNames = [
						`${stem} Identifier`,
						`Has ${stem} Identifier`,
					];
					const tokenNodes = memberPropertyNodes.filter(
						(onePropertyNode) =>
							tokenCandidateNames.indexOf(v1(onePropertyNode.properties.name)) !==
							-1,
					);
					if (tokenNodes.length !== 1) {
						// ambiguous or absent token — record and SKIP (never fabricate a pairing)
						identificationPatterns.push({
							className: v1(classNode.properties.name),
							typeProperty: typePropertyName,
							stem,
							tokenMatchCount: tokenNodes.length,
							skipped: true,
						});
						return;
					}
					const tokenNode = tokenNodes[0];
					const tokenProps = tokenNode.properties;
					const tokenDomainId = v1(tokenProps.domainId);
					const tokenRangeClassId = v1(tokenProps.rangeClassId);
					const tokenRangeClassNode = tokenRangeClassId
						? classByDomainId[tokenRangeClassId]
						: undefined;
					const qualifierValueNodes =
						valueNodesOfOptionSet[typeOptionSetNode.stableId] || [];
					qualifierValueNodes.forEach((qualifierValueNode) => {
						const emittedQualifiedCard = emitReference({
							referenceTier: REFERENCE_TIER.PROPERTY,
							canonicalKey: v1(tokenProps.canonicalKey),
							domainId: tokenDomainId,
							propertyKey: v1(tokenProps.canonicalKey),
							rangeOptionSetId: undefined,
							rangeClassId: tokenRangeClassId,
							rangeDatatype: tokenRangeClassId
								? undefined
								: v1(tokenProps.rangeDatatype),
							valueKey: '',
							qualifierPairs: [
								{
									qualifierKey: v1(qualifierValueNode.properties.canonicalKey),
									qualifierName: v1(qualifierValueNode.properties.name),
									qualifierNode: qualifierValueNode,
								},
							],
							classNode: classByDomainId[tokenDomainId],
							propertyNode: tokenNode,
							classRangeNode: tokenRangeClassNode,
						});
						if (emittedQualifiedCard) {
							qualifiedCount++;
						}
					});
					identificationPatterns.push({
						className: v1(classNode.properties.name),
						typeProperty: typePropertyName,
						stem,
						tokenProperty: v1(tokenProps.name),
						tokenKey: v1(tokenProps.canonicalKey),
						qualifierValueCount: qualifierValueNodes.length,
						skipped: false,
					});
				});
			});

			if (derivationFaults.length) {
				const shownFaults = derivationFaults.slice(0, 10).join('\n');
				callback(
					`${moduleName}.forgeHub: REFUSED — ${derivationFaults.length} derivation ` +
						`fault(s); no degraded card is emitted. First ${Math.min(
							derivationFaults.length,
							10,
						)}:\n${shownFaults}`,
				);
				return;
			}

			// ---- the divergence report (§5): description vs definition on the source nodes ----
			const divergenceReport = [];
			[
				DME_ROLES.CLASS,
				DME_ROLES.PROPERTY,
				DME_ROLES.OPTION_SET,
				DME_ROLES.OPTION_VALUE,
			].forEach((oneRole) => {
				nodesByRole[oneRole].forEach((oneNode) => {
					const sourceDescription = v1(oneNode.properties.description);
					const sourceDefinition = v1(oneNode.properties.definition);
					// 'both exist' means both carry PROSE (hasProse, the module's one existence
					// rule — S-5): null and '' are not prose and cannot diverge from anything
					if (
						hasProse(sourceDescription) &&
						hasProse(sourceDefinition) &&
						String(sourceDescription) !== String(sourceDefinition)
					) {
						divergenceReport.push({
							role: oneRole,
							cedsId: v1(oneNode.properties.cedsId),
							name: v1(oneNode.properties.name),
							description: sourceDescription,
							definition: sourceDefinition,
						});
					}
				});
			});
			divergenceReport.sort((left, right) => {
				const leftSortKey = `${left.role}|${left.cedsId}`;
				const rightSortKey = `${right.role}|${right.cedsId}`;
				return leftSortKey < rightSortKey ? -1 : leftSortKey > rightSortKey ? 1 : 0;
			});

			// ---- the HubDefinition card (§2) — the namespace authority ----
			const slotProfile = {
				cardStructureVersion: 2,
				addressSlots: [
					'hubName',
					'hubVersion',
					'referenceTier',
					'domainId',
					'propertyKey',
					'rangeDatatype|rangeClassId|rangeOptionSetId',
					'valueKey',
					'qualifierKeys',
				],
				identityFields: ['addressSignature', 'uri', 'canonicalKey', 'name'],
				meaningFieldsByTier: {
					property: [
						'domainName',
						'domainDefinition',
						'propertyName',
						'propertyDefinition',
						'propertyNotation',
						'propertyDataType',
						'propertyTextFormat',
						'rangeClassName',
						'rangeClassDefinition',
						'rangeOptionSetName',
						'rangeOptionSetDefinition',
						'qualifierNames',
					],
					value: [
						'domainName',
						'domainDefinition',
						'propertyName',
						'propertyDefinition',
						'propertyNotation',
						'propertyDataType',
						'propertyTextFormat',
						'rangeOptionSetName',
						'rangeOptionSetDefinition',
						'valueName',
						'valueDefinition',
						'valueNotation',
						'valuePrefLabel',
						'qualifierNames',
					],
				},
				provenanceFields: [
					'anchorUri',
					'domainUri',
					'propertyUri',
					'rangeUri',
					'valueUri',
				],
				derivedFields: ['embedText', 'embedding', 'embeddingModelVersion'],
			};
			const rootProps = rootNode.properties;
			const sourceProvenance = JSON.stringify({
				standardKey: v1(rootProps.standardKey),
				snapshotKey: v1(rootProps.snapshotKey),
				publishedVersion: v1(rootProps.publishedVersion),
				sourceVersion: v1(rootProps.version),
				sourceUrl: v1(rootProps.sourceUrl),
				forgeModule: moduleName,
				forgeModuleVersion: FORGE_MODULE_VERSION,
			});
			nodes.push({
				labels: [
					NODE_LABELS.FORGED_NODE,
					EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
				],
				stableId: hubDefinitionStableId,
				role: EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
				properties: {
					_source: hubName,
					role: EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
					name: hubDisplayName,
					uri: hubDefinitionStableId,
					[HD.HUB_NAME]: hubName,
					[HD.DISPLAY_NAME]: hubDisplayName,
					[HD.VERSION]: hubVersion,
					[HD.NAMESPACE]: hubNamespace,
					[HD.CANONICAL_KEY_NAME]: canonicalKeyName,
					[HD.CANONICAL_KEY_MINTED]: canonicalKeyMinted,
					[HD.SLOT_PROFILE]: JSON.stringify(slotProfile),
					[HD.SOURCE_PROVENANCE]: sourceProvenance,
				},
			});

			// ---- deterministic ordering for a byte-stable block ----
			nodes.sort((left, right) =>
				left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1 : 0,
			);
			edges.sort((left, right) => {
				const leftSortKey = `${left.type}|${left.fromRef.id}|${left.toRef.id}`;
				const rightSortKey = `${right.type}|${right.fromRef.id}|${right.toRef.id}`;
				return leftSortKey < rightSortKey ? -1 : leftSortKey > rightSortKey ? 1 : 0;
			});

			callback('', {
				nodes,
				edges,
				divergenceReport,
				skipReport,
				hubDefinitionStableId,
				counts: {
					hubDefinition: 1,
					propertyTier: propertyTierCount,
					valueTier: valueTierCount,
					qualified: qualifiedCount,
					hubReferenceTotal: propertyTierCount + valueTierCount + qualifiedCount,
					nodeTotal: nodes.length,
					edgeTotal: edges.length,
				},
				identificationPatterns,
			});
		};

		return { forgeHub, addressSignatureFor, hubDefinitionStableId };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
