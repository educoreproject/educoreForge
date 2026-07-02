'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// referenceSubgraph.js — PURE, deterministic derivation of the HubReference reference subgraph
// (Phase 3; WHITEPAPER §4.3/§4.6/§8, PLAN Phase 3). Input: the deserialized ADDRESSED CEDS hub block
// ({nodes, edges} as returned by replay-block.deserializeBlock — properties are single-element PG-JSON
// arrays). Output: { nodes, edges, counts } in the SAME shape the standard producers emit
// ({labels, stableId, properties} nodes; {type, fromRef, toRef, properties} edges) so the existing
// block-serialization + replay path consumes it unchanged.
//
// MATERIALIZES one HubReference per distinct canonical ADDRESS:
//   - property tier : one per DmeProperty (3-slot tuple: domain→property→range).
//   - value tier    : one per (enumerated-property, option-value) PAIR (4-slot tuple). Option sets are
//                     SHARED across properties, so this is keyed by the FULL (property,value) address —
//                     the same option value under a different property is a DISTINCT address (and a
//                     distinct HubReference). canonicalKey is therefore INTENTIONALLY non-unique among
//                     value-tier refs; uniqueness is the composite (hubName, addressSignature).
//   - qualified     : §4.3 identification pattern. A class carrying a 'Has <X> Identifier Type'
//                     enumerated qualifier property qualifies its '<X> Identifier' / 'Has <X> Identifier'
//                     TOKEN property (same <X> stem) by each value of the type property's option set.
//                     One qualified property-tier HubReference per (token property × type value), in
//                     ADDITION to the token's unqualified base ref. Stem-match avoids mis-qualifying a
//                     co-resident identifier (e.g. Learning Resource Identifier in the Organization class).
//
// Each HubReference decomposes onto the EXISTING hub structural nodes via HAS_CEDS_* edges (§4.6) and
// IN_HUB onto the one HubDefinition. Every emitted node carries :ForgedNode + a deterministic stableId
// (minted from the addressSignature, the §8 stable hash); every emitted edge carries provenanceTier.
// MUST NOT modify any pre-existing node/edge — additive new-node-type only.
//
// PURE + synchronous + deterministic: no Neo4j, no async, no Date/random. camelCase only.
//
// @concept: [[HubReference]]
// @concept: [[ReferenceSubgraph]]

const crypto = require('crypto');
const path = require('path');

const vocab = require(path.join(__dirname, '..', 'vocabulary', 'vocabulary'));
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
} = vocab;

// single-element PG-JSON array -> scalar (the engine does this at MERGE; the producer does it on read).
const v1 = (arrayOrScalar) =>
	Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar;

const sha256Hex = (text) =>
	crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({
		hubName = 'CEDS',
		hubVersion,
		hubDisplayName = 'Common Education Data Standards',
		hubNamespace,
		canonicalKeyName = 'CEDS Global ID',
		canonicalKeyMinted = false,
		sourceProvenance,
	} = {}) => {
		// addressSignature — the §8 deterministic stable hash over EXACTLY the registered field order.
		// 'range' = rangeOptionSetId (enumerated) ELSE rangeClassId (object/association reference to a CEDS
		// class) ELSE rangeDatatype (scalar); the three are mutually exclusive (a reference carries exactly
		// one range shape — INVESTIGATION-rangelessHubs-070126.md), so folding all three into the single
		// 'range' signature slot preserves determinism + uniqueness exactly as the two-shape form did (Gate
		// 19). qualifierKeys are SORTED; an empty slot encodes as ''. One source of truth (the registry field
		// order) so any validator matches.
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
				canonicalKey: canonicalKey || '',
				domainId: domainId || '',
				propertyKey: propertyKey || '',
				range: rangeOptionSetId || rangeClassId || rangeDatatype || '',
				valueKey: valueKey || '',
				qualifierKeys: (qualifierKeys || []).slice().sort().join(','),
				hubVersion: hubVersion || '',
			};
			const encoded = ADDRESS_SIGNATURE_FIELD_ORDER.map(
				(oneField) => fieldValues[oneField],
			).join('|');
			return sha256Hex(encoded);
		};

		const hubDefStableId = `cedsHubDefinition:${hubName}`;

		// =====================================================================
		// buildReferenceSubgraph — PURE. (deserialized CEDS block) -> { nodes, edges, counts }.
		// =====================================================================
		const buildReferenceSubgraph = ({ cedsNodes, cedsEdges }) => {
			const nodes = [];
			const edges = [];

			// ---- index the hub structural nodes ----
			const nodeByStableId = {};
			const propertiesByRole = {
				DmeClass: [],
				DmeProperty: [],
				DmeOptionSet: [],
				DmeOptionValue: [],
			};
			const classByDomainId = {};
			cedsNodes.forEach((oneNode) => {
				nodeByStableId[oneNode.stableId] = oneNode;
				const role = v1(oneNode.properties.role);
				if (propertiesByRole[role]) {
					propertiesByRole[role].push(oneNode);
				}
				if (role === 'DmeClass') {
					classByDomainId[v1(oneNode.properties.domainId)] = oneNode;
				}
			});

			// ---- structural maps from the hub edges ----
			const propOptionSetNode = {}; // property stableId -> option-set node (HAS_OPTION_SET)
			const optionSetValueNodes = {}; // option-set stableId -> [value nodes] (HAS_VALUE)
			const classPropertyNodes = {}; // class stableId -> [property nodes] (HAS_PROPERTY)
			cedsEdges.forEach((oneEdge) => {
				const fromNode = nodeByStableId[oneEdge.fromRef.id];
				const toNode = nodeByStableId[oneEdge.toRef.id];
				if (!fromNode || !toNode) {
					return;
				}
				if (oneEdge.type === 'HAS_PROPERTY') {
					(classPropertyNodes[fromNode.stableId] =
						classPropertyNodes[fromNode.stableId] || []).push(toNode);
				} else if (oneEdge.type === 'HAS_OPTION_SET') {
					propOptionSetNode[fromNode.stableId] = toNode;
				} else if (oneEdge.type === 'HAS_VALUE') {
					(optionSetValueNodes[fromNode.stableId] =
						optionSetValueNodes[fromNode.stableId] || []).push(toNode);
				}
			});

			// ---- emit one HubReference + its decomposition edges ----
			const emitReference = ({
				referenceTier,
				canonicalKey,
				domainId,
				propertyKey,
				rangeOptionSetId,
				rangeClassId,
				rangeDatatype,
				valueKey,
				qualifierKeys,
				label,
				anchorUri,
				classNode,
				propertyNode,
				optionSetNode,
				classRangeNode,
				valueNode,
				qualifierNodes,
			}) => {
				const sortedQualifierKeys = (qualifierKeys || []).slice().sort();
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
				const stableId = `cedsHubRef:${addressSignature}`;

				const properties = {
					_id: stableId,
					_source: hubName,
					role: 'HubReference',
					name: label || canonicalKey,
					uri: stableId,
					[A.HUB_NAME]: hubName,
					[HR.HUB_VERSION]: hubVersion,
					[HR.CANONICAL_KEY]: canonicalKey,
					[HR.REFERENCE_TIER]: referenceTier,
					[HR.ADDRESS_SIGNATURE]: addressSignature,
					[HR.QUALIFIER_KEYS]: sortedQualifierKeys,
					[A.DOMAIN_ID]: domainId,
					propertyKey,
				};
				if (rangeOptionSetId) {
					properties[A.RANGE_OPTION_SET_ID] = rangeOptionSetId;
				}
				if (rangeClassId) {
					properties[A.RANGE_CLASS_ID] = rangeClassId;
				}
				if (rangeDatatype) {
					properties[HR.RANGE_DATATYPE] = rangeDatatype;
				}
				if (valueKey) {
					properties.valueKey = valueKey;
				}
				if (anchorUri) {
					properties[HR.ANCHOR_URI] = anchorUri;
				}

				nodes.push({
					labels: [
						NODE_LABELS.FORGED_NODE,
						EQUIVALENCE_NODE_LABELS.HUB_REFERENCE,
					],
					stableId,
					role: 'HubReference',
					properties,
				});

				const addEdge = (type, toStableId) => {
					edges.push({
						type,
						fromRef: { source: hubName, id: stableId },
						toRef: { source: hubName, id: toStableId },
						properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL },
					});
				};
				if (classNode) {
					addEdge(CEDS_HUB_EDGE_TYPES.DOMAIN, classNode.stableId);
				}
				if (propertyNode) {
					addEdge(CEDS_HUB_EDGE_TYPES.PROPERTY, propertyNode.stableId);
				}
				if (optionSetNode) {
					addEdge(CEDS_HUB_EDGE_TYPES.RANGE, optionSetNode.stableId);
				} else if (classRangeNode) {
					// object/association property whose range IS a CEDS class (e.g. 'Has Assessment' -> Assessment) —
					// the same HAS_CEDS_RANGE edge family, targeting a CedsClass node instead of a DmeOptionSet.
					addEdge(CEDS_HUB_EDGE_TYPES.RANGE, classRangeNode.stableId);
				}
				if (valueNode) {
					addEdge(CEDS_HUB_EDGE_TYPES.VALUE, valueNode.stableId);
				}
				(qualifierNodes || []).forEach((oneQualifierNode) => {
					addEdge(CEDS_HUB_EDGE_TYPES.QUALIFIER, oneQualifierNode.stableId);
				});
				addEdge(IN_HUB_EDGE_TYPE, hubDefStableId);

				return { stableId, addressSignature };
			};

			// ---- PASS 1: property-tier (one per DmeProperty) + value-tier (per property×value pair) ----
			let propertyTierCount = 0;
			let valueTierCount = 0;
			propertiesByRole.DmeProperty.forEach((propertyNode) => {
				const props = propertyNode.properties;
				const propertyKey = v1(props.canonicalKey);
				const domainId = v1(props.domainId);
				const classNode = classByDomainId[domainId];
				const optionSetNode = propOptionSetNode[propertyNode.stableId];
				const rangeOptionSetId = optionSetNode
					? v1(optionSetNode.properties.rangeOptionSetId)
					: undefined;
				// class-range (object/association property, e.g. 'Has Assessment' -> Assessment): resolved via
				// classByDomainId — a DmeClass's own domainId IS its canonical class id, the same id space
				// rangeClassId is stamped in (forgeCeds.js). Mutually exclusive with an option-set range.
				const rangeClassId = optionSetNode ? undefined : v1(props.rangeClassId);
				const rangeClassNode = rangeClassId ? classByDomainId[rangeClassId] : undefined;
				const rangeDatatype =
					optionSetNode || rangeClassId ? undefined : v1(props.rangeDatatype);

				// property-tier base reference (qualifierKeys empty)
				emitReference({
					referenceTier: REFERENCE_TIER.PROPERTY,
					canonicalKey: propertyKey,
					domainId,
					propertyKey,
					rangeOptionSetId,
					rangeClassId,
					rangeDatatype,
					valueKey: '',
					qualifierKeys: [],
					label: v1(props.name),
					anchorUri: v1(props.uri),
					classNode,
					propertyNode,
					optionSetNode,
					classRangeNode: rangeClassNode,
				});
				propertyTierCount++;

				// value-tier references — one per option value of THIS property's set (full address)
				if (optionSetNode) {
					const valueNodes =
						optionSetValueNodes[optionSetNode.stableId] || [];
					valueNodes.forEach((valueNode) => {
						const valueKey = v1(valueNode.properties.canonicalKey);
						emitReference({
							referenceTier: REFERENCE_TIER.VALUE,
							canonicalKey: valueKey, // anchor is the value (§8)
							domainId,
							propertyKey,
							rangeOptionSetId,
							rangeDatatype: undefined,
							valueKey,
							qualifierKeys: [],
							label: v1(valueNode.properties.name),
							anchorUri: v1(valueNode.properties.uri),
							classNode,
							propertyNode,
							optionSetNode,
							valueNode,
						});
						valueTierCount++;
					});
				}
			});

			// ---- PASS 2: qualified references (§4.3 identification pattern, stem-matched) ----
			let qualifiedCount = 0;
			const identificationPatterns = [];
			Object.keys(classPropertyNodes).forEach((classStableId) => {
				const classNode = nodeByStableId[classStableId];
				const memberProps = classPropertyNodes[classStableId];
				// find the 'Has <X> Identifier Type' ENUMERATED qualifier property(ies) in this class
				memberProps.forEach((typePropNode) => {
					const typeName = v1(typePropNode.properties.name) || '';
					const stemMatch = /^Has (.+) Identifier Type$/.exec(typeName);
					if (!stemMatch) {
						return;
					}
					const typeOptionSetNode = propOptionSetNode[typePropNode.stableId];
					if (!typeOptionSetNode) {
						return; // qualifier must be enumerated to supply qualifier values
					}
					const stem = stemMatch[1];
					// stem-match the TOKEN property in the SAME class: '<stem> Identifier' or 'Has <stem> Identifier'
					const tokenCandidates = [`${stem} Identifier`, `Has ${stem} Identifier`];
					const tokenNodes = memberProps.filter((oneProp) =>
						tokenCandidates.indexOf(v1(oneProp.properties.name)) !== -1,
					);
					if (tokenNodes.length !== 1) {
						// ambiguous or absent token — record and SKIP (never fabricate a qualifier pairing)
						identificationPatterns.push({
							className: v1(classNode.properties.name),
							typeProperty: typeName,
							stem,
							tokenMatchCount: tokenNodes.length,
							skipped: true,
						});
						return;
					}
					const tokenNode = tokenNodes[0];
					const tokenProps = tokenNode.properties;
					// token property's own range (rare for an identifier token to be class-ranged, but handled
					// uniformly with the base property-tier pass above — same three-shape resolution).
					const tokenRangeClassId = v1(tokenProps.rangeClassId);
					const tokenRangeClassNode = tokenRangeClassId
						? classByDomainId[tokenRangeClassId]
						: undefined;
					const qualifierValueNodes =
						optionSetValueNodes[typeOptionSetNode.stableId] || [];
					qualifierValueNodes.forEach((qualifierValueNode) => {
						const qualifierKey = v1(qualifierValueNode.properties.canonicalKey);
						emitReference({
							referenceTier: REFERENCE_TIER.PROPERTY, // token is non-enumerated -> 3-slot, qualified
							canonicalKey: v1(tokenProps.canonicalKey),
							domainId: v1(tokenProps.domainId),
							propertyKey: v1(tokenProps.canonicalKey),
							rangeOptionSetId: undefined,
							rangeClassId: tokenRangeClassId,
							rangeDatatype: tokenRangeClassId ? undefined : v1(tokenProps.rangeDatatype),
							valueKey: '',
							qualifierKeys: [qualifierKey],
							label: `${v1(tokenProps.name)} [${v1(qualifierValueNode.properties.name)}]`,
							anchorUri: v1(tokenProps.uri),
							classNode: classByDomainId[v1(tokenProps.domainId)],
							propertyNode: tokenNode,
							classRangeNode: tokenRangeClassNode,
							qualifierNodes: [qualifierValueNode],
						});
						qualifiedCount++;
					});
					identificationPatterns.push({
						className: v1(classNode.properties.name),
						typeProperty: typeName,
						stem,
						tokenProperty: v1(tokenProps.name),
						tokenKey: v1(tokenProps.canonicalKey),
						qualifierValueCount: qualifierValueNodes.length,
						skipped: false,
					});
				});
			});

			// ---- the HubDefinition node (one per hub) ----
			const slotProfile = {
				domain: { idKind: 'classId', durable: false },
				property: { idKind: 'canonicalKey', durable: true },
				range: { idKind: 'optionSetId|classId|datatype', durable: false },
				value: { idKind: 'canonicalKey', durable: true },
			};
			nodes.push({
				labels: [
					NODE_LABELS.FORGED_NODE,
					EQUIVALENCE_NODE_LABELS.HUB_DEFINITION,
				],
				stableId: hubDefStableId,
				role: 'HubDefinition',
				properties: {
					_id: hubDefStableId,
					_source: hubName,
					role: 'HubDefinition',
					name: hubDisplayName,
					uri: hubDefStableId,
					[HD.HUB_NAME]: hubName,
					[HD.DISPLAY_NAME]: hubDisplayName,
					[HD.VERSION]: hubVersion,
					[HD.NAMESPACE]: hubNamespace || '',
					[HD.CANONICAL_KEY_NAME]: canonicalKeyName,
					[HD.CANONICAL_KEY_MINTED]: canonicalKeyMinted,
					[HD.SLOT_PROFILE]: JSON.stringify(slotProfile),
					[HD.SOURCE_PROVENANCE]: sourceProvenance || '',
				},
			});

			// ---- deterministic ordering for a byte-stable block (sort nodes by stableId, edges by tuple) ----
			nodes.sort((a, b) => (a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0));
			edges.sort((a, b) => {
				const ka = `${a.type}|${a.fromRef.id}|${a.toRef.id}`;
				const kb = `${b.type}|${b.fromRef.id}|${b.toRef.id}`;
				return ka < kb ? -1 : ka > kb ? 1 : 0;
			});

			return {
				nodes,
				edges,
				hubDefStableId,
				counts: {
					hubDefinition: 1,
					propertyTier: propertyTierCount,
					valueTier: valueTierCount,
					qualified: qualifiedCount,
					hubReferenceTotal:
						propertyTierCount + valueTierCount + qualifiedCount,
					nodeTotal: nodes.length,
					edgeTotal: edges.length,
				},
				identificationPatterns,
			};
		};

		return { buildReferenceSubgraph, addressSignatureFor, hubDefStableId };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
