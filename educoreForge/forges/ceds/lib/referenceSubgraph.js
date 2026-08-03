'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// =====================================================================================
// TOMBSTONE (hubReimplementation Phase 2, 2026-08-03) — THIS MODULE IS RETIRED.
// =====================================================================================
// Superseded by forges/ceds/lib/cedsHubForge.js (SPEC-hubReimplementation-080326.md §1–§5);
// the forger registry (apps/graph-builder/apps/forger/forger.js HUB_FORGE_BY_STANDARD) now
// resolves 'ceds' to the replacement. Nothing below this comment is changed, and the module
// REMAINS FULLY FUNCTIONAL BY DESIGN: gate G-P1 (incumbentParity, test-cedsHubForge.js)
// imports and RUNS this module over the same base to prove signature-for-signature parity,
// and its three suites (test-referenceSubgraph, test-hubTupleClosure,
// test-hubReferenceCountDerived) stay in place and passing. Module and tests are DELETED
// TOGETHER at Phase 5 (WORKORDER Phase 5), when the acceptance run is green.
// =====================================================================================

// referenceSubgraph.js — PURE, deterministic derivation of the HubReference reference subgraph
// (Phase 3; WHITEPAPER §4.3/§4.6/§8, PLAN Phase 3). Input: the deserialized ADDRESSED CEDS hub block
// ({nodes, edges} as returned by replay-block.deserializeBlock — properties are single-element PG-JSON
// arrays). Output: { nodes, edges, counts } in the SAME shape the standard producers emit
// ({labels, stableId, properties} nodes; {type, fromRef, toRef, properties} edges) so the existing
// block-serialization + replay path consumes it unchanged.
//
// PORT PROVENANCE (educoreForge grand-recreation, PLAN Phase 2, 2026-07-23): this module is a
// RELOCATION of the incumbent npm/qtools-graph-forge-core/lib/reference-subgraph/referenceSubgraph.js
// into the recreation tree (forges/ceds/lib/referenceSubgraph.js). The derivation logic is byte-for-byte
// faithful to the incumbent; the ONLY changes are (1) the single vocabulary `require` is repointed at the
// recreation's lib/vocabulary/vocabulary (all destructured constants resolve there unchanged), and
// (2) a thin `forgeHub` seam is exposed that takes a deserialized CEDS base block and returns the hub
// subgraph. The pure `buildReferenceSubgraph` derivation is untouched.
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
} = vocab;

// single-element PG-JSON array -> scalar (the engine does this at MERGE; the producer does it on read).
// domainListOf — every declared domain, whatever shape it was stored in. The replay engine
// scalarizes single-element arrays, so 2,068 of 2,324 property nodes hold allDomainIds as a
// bare string; Array.isArray() would skip them and look like a working fix.
const domainListOf = (value) =>
	[]
		.concat(value === undefined || value === null ? [] : value)
		.filter((one) => typeof one === 'string' && one.trim() !== '');

const v1 = (arrayOrScalar) =>
	Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar;

const sha256Hex = (text) =>
	crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// FORMAL INTERFACE (polyArch2 §3 — the forgeHub seam's contract, documented in one place so a caller
// reads the shape without reading the body).
//
// @typedef {Object} DeserializedCedsBlock — a CEDS base block as replay-block.deserializeBlock returns.
// @property {Array<{stableId:string, properties:Object}>} nodes — each property value a single-element
//     PG-JSON array (unwrapped by v1()); role/domainId/canonicalKey/name/uri/range* live here.
// @property {Array<{type:string, fromRef:{id:string}, toRef:{id:string}}>} edges — HAS_PROPERTY /
//     HAS_OPTION_SET / HAS_VALUE structural edges.
//
// @typedef {Object} HubSubgraph — the derived reference subgraph in producer shape.
// @property {Array<{labels:string[], stableId:string, role:string, properties:Object}>} nodes — the
//     HubReference nodes + the single HubDefinition, sorted by stableId.
// @property {Array<{type:string, fromRef:Object, toRef:Object, properties:Object}>} edges — the
//     HAS_CEDS_* decomposition + IN_HUB edges, sorted by (type, from, to) tuple.
// @property {Object} counts — { hubDefinition, propertyTier, valueTier, qualified, hubReferenceTotal,
//     nodeTotal, edgeTotal }.
// @property {Array<Object>} identificationPatterns — every §4.3 pattern examined, resolved or skipped.
//
// @interface CedsHubForge
// @property {function(DeserializedCedsBlock): HubSubgraph} forgeHub — refuses a malformed block by name.
// @property {function({cedsNodes:Array, cedsEdges:Array}): HubSubgraph} buildReferenceSubgraph — the pure
//     derivation (byte-for-byte faithful to the incumbent; no input guard — call it through forgeHub).
// @property {function(Object): string} addressSignatureFor — the §8 deterministic address signature.
// @property {string} hubDefStableId — the one HubDefinition's stableId.

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

				// ⟪TQ RULING, 2026-08-02⟫ "we absolutely want the higher resolution. It's not even
				// a question. I don't care how many nodes it takes, I want to have a HubReference
				// for EVERY IDEA THAT CEDS CAN REPRESENT."
				//
				// A CEDS property can be declared against SEVERAL domains, and each one is a
				// different idea: a school address is not a student address. This loop used to read
				// props.domainId -- ONE domain -- so the second and third contexts had no card and
				// were unfindable by the matcher no matter how good the judge was. Same class of
				// failure as a candidate that is never in the pool.
				//
				// READ SHAPE-AGNOSTICALLY. The replay engine scalarizes single-element arrays, so
				// 2,068 of 2,324 property nodes store allDomainIds as a bare STRING. An
				// Array.isArray() test here would silently visit one domain for 89% of the corpus
				// and look exactly like a fix.
				//
				// NO COLLISION RISK: addressSignatureFor() already includes domainId, so the cards
				// minted per domain are distinct by construction. The tuple model anticipated this
				// from the start; only this loop had not caught up.
				const declaredDomainIds = domainListOf(props.allDomainIds).length
					? domainListOf(props.allDomainIds)
					: domainListOf(props.domainId);
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

				declaredDomainIds.forEach((domainId) => {
				const classNode = classByDomainId[domainId];

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

		// forgeHub — the recreation seam (PLAN Phase 2). Takes a DESERIALIZED CEDS base block
		// ({nodes, edges} as replay-block.deserializeBlock returns) and derives the hub subgraph
		// by delegating to the pure buildReferenceSubgraph. A missing or malformed block is REFUSED
		// BY NAME rather than silently defaulted — an absent nodes/edges array is a caller bug, not a
		// zero-reference hub (polyArch2 §: no silent default for absent/invalid input).
		const forgeHub = (deserializedBlock) => {
			if (
				!deserializedBlock ||
				!Array.isArray(deserializedBlock.nodes) ||
				!Array.isArray(deserializedBlock.edges)
			) {
				throw new Error(
					`${moduleName}.forgeHub: requires a deserialized block { nodes: [], edges: [] } — ` +
						`got ${JSON.stringify(deserializedBlock)}`,
				);
			}
			return buildReferenceSubgraph({
				cedsNodes: deserializedBlock.nodes,
				cedsEdges: deserializedBlock.edges,
			});
		};

		return { forgeHub, buildReferenceSubgraph, addressSignatureFor, hubDefStableId };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
