#!/usr/bin/env node
'use strict';

// test-cedsHubForge.js — the Phase-1 hermetic suite for the HubReference reimplementation
// (SPEC-hubReimplementation-080326.md §7; WORKORDER Phase 1).
//
// Builds the REAL parsed CEDS base (parser -> forgeCeds, no graph, no build, no network, no
// embedding — the test-hubTupleClosure harness pattern), forges the hub through the NEW
// cedsHubForge, and evaluates the eleven CARD-LOCAL gates (G-1..G-6, G-8..G-12) declared in
// forges/ceds/gates/hubGates.jsonc through the EXISTING gate harness (lib/roundTripGates.js).
//
// THE TWIN DISCIPLINE IS THE POINT. This suite ITSELF injects each gate's named fault,
// shows the gate RED under it, restores the pristine measurements, and shows it GREEN. A
// gate whose twin is not observed red IN THIS SUITE'S OUTPUT reports UNPROVEN and the suite
// fails. No frozen literal anywhere: every expectation is DERIVED from the base by this
// suite's own independent re-derivations (tuple enumeration including the qualified
// stem-match, signature recomputation, §4 recomposition, divergence recount).
//
// The suite also prints: the derived card census (both sides computed), the divergence
// and skip reports (written to test-artifacts/, explicit-empty when none), and a SAMPLE
// DUMP of four complete cards — one property-tier, one value-tier with the full prose
// stack, one qualified, one class-ranged — for the supervisor's back-gate.
//
// Run: node forges/ceds/test/test-cedsHubForge.js [-verbose]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- hermetic Phase-1 gate suite for the cedsHubForge HubReference card

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Forges the local CEDS asset (no embedding), derives the hub through cedsHubForge, and
     evaluates gates G-1..G-6, G-8..G-12 with the twin discipline: every gate is OBSERVED
     going RED under its own injected fault before its green counts. Prints the derived card
     census, writes the prose-divergence report to test-artifacts/, and dumps three sample
     cards. Both sides of every expectation are computed; no frozen literal.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);
const xLog = process.global.xLog;

// embedder EXPLICITLY null (framework contract, forge-framework.js:87-90): the bundle is now
// built at factory time and REFUSES an undefined embedder by name — "silence is not consent
// to spend". This suite forges with skipEmbedding true, so null is the honest statement of
// what it always meant; the pre-migration `{}` relied on the bespoke module never reading the
// value. Behaviour of this suite is unchanged.
const forgeCeds = require('../forgeCeds')({ embedder: null });
const cedsHubForgeFactory = require('../lib/cedsHubForge');
const gatesLib = require('../lib/roundTripGates')();
const vocab = require(path.join(__dirname, '..', '..', '..', 'lib', 'vocabulary', 'vocabulary'));
const { ADDRESS_SIGNATURE_FIELD_ORDER, DME_ROLES, IN_HUB_EDGE_TYPE } = vocab;

const CEDS_SOURCE_PATH = path.join(
	__dirname, '..', 'assets', 'standardSourceData', '01', 'CEDS-Ontology.rdf',
);
// the namespace comes from its ONE declared home — the forger's hub registry row (Phase 2:
// the registry is flipped and its hubNamespace field is the only place the URL lives). The
// suite forging with the registry's value is the point: G-8's sentinel re-forge already
// proves minting FLOWS from the factory argument, so what remains to pin is WHICH value
// production passes — this one.
// PHASE 2a: the registry HUB_FORGE_BY_STANDARD is DELETED. The namespace's ONE home is now this
// kit's own parserDescriptor.ini (hubNamespace=), read through the same resolveBundle the forger
// uses — so this suite still pins WHICH VALUE PRODUCTION PASSES, which is the whole point, and it
// reads it from production's source rather than restating it. A literal here would create the
// second occurrence invariant I8 forbids.
const HUB_NAMESPACE = require(
	path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'forger', 'forger'),
).resolveBundle({ standard: 'ceds' }).hubNamespace;
const DECLARATIONS_PATH = path.join(__dirname, '..', 'gates', 'hubGates.jsonc');
const TEST_ARTIFACTS_DIR = path.join(__dirname, 'test-artifacts');
const DIVERGENCE_REPORT_PATH = path.join(TEST_ARTIFACTS_DIR, 'cedsProseDivergence.json');

// =====================================================================================
// suite-side helpers — the INDEPENDENT half of every two-sided derivation
// =====================================================================================

// the replay engine scalarizes single-element arrays; read shape-agnostically everywhere
const v1 = (arrayOrScalar) =>
	Array.isArray(arrayOrScalar) ? arrayOrScalar[0] : arrayOrScalar;

const valueListOf = (value) =>
	[]
		.concat(value === undefined || value === null ? [] : value)
		.filter((one) => typeof one === 'string' && one.trim() !== '');

const isCarried = (scalar) =>
	scalar !== undefined && scalar !== null && !(typeof scalar === 'string' && scalar === '');

const sha256Hex = (text) =>
	crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// adapter over a THROWING seam, in ONE place (the parseJsonOrFault precedent in
// roundTripGates.js): the factory refuses by throw; the suite needs its message as data.
const refusalMessageOf = (throwingFunction) => {
	let refusalMessage = '';
	try {
		throwingFunction();
	} catch (thrownError) {
		refusalMessage = String(thrownError.message);
	}
	return refusalMessage;
};

const parsedJsonOf = (text) => {
	let parsed;
	let faultMessage = '';
	try {
		parsed = JSON.parse(text);
	} catch (parseError) {
		faultMessage = parseError.message;
	}
	return { parsed, faultMessage };
};

// =====================================================================================
// independent derivation 1 — tuple enumeration INCLUDING the qualified stem-match
// =====================================================================================
// Closure keys: property 'D|P', value 'D|P|V:valueKey', qualified 'D|P|Q:k1+k2' (sorted). The
// qualified tuples are enumerated HERE, independently, closing the 2026-08-02 blind spot in
// which qualified cards collapsed into already-present keys and were invisible to closure.
const deriveExpectedTupleKeys = ({ nodes, edges }) => {
	const nodeByStableId = {};
	const byRole = {};
	const classPropertyNodes = {};
	const optionSetOfProperty = {};
	const valueNodesOfOptionSet = {};
	nodes.forEach((oneNode) => {
		nodeByStableId[oneNode.stableId] = oneNode;
		const role = v1(oneNode.properties.role);
		(byRole[role] = byRole[role] || []).push(oneNode);
	});
	edges.forEach((oneEdge) => {
		const fromNode = nodeByStableId[oneEdge.fromRef.id];
		const toNode = nodeByStableId[oneEdge.toRef.id];
		if (!fromNode || !toNode) {
			return;
		}
		if (oneEdge.type === 'HAS_PROPERTY') {
			(classPropertyNodes[fromNode.stableId] =
				classPropertyNodes[fromNode.stableId] || []).push(toNode);
		} else if (oneEdge.type === 'HAS_OPTION_SET') {
			optionSetOfProperty[fromNode.stableId] = toNode;
		} else if (oneEdge.type === 'HAS_VALUE') {
			(valueNodesOfOptionSet[fromNode.stableId] =
				valueNodesOfOptionSet[fromNode.stableId] || []).push(toNode);
		}
	});

	const propertyPairKeys = new Set();
	const valueTripleKeys = new Set();
	const qualifiedKeys = new Set();

	(byRole[DME_ROLES.PROPERTY] || []).forEach((onePropertyNode) => {
		const propertyProps = onePropertyNode.properties;
		const propertyKey = v1(propertyProps.canonicalKey);
		if (!propertyKey) {
			return;
		}
		const allDeclared = valueListOf(propertyProps.allDomainIds);
		const declaredDomains = allDeclared.length
			? allDeclared
			: valueListOf(propertyProps.domainId);
		const optionSetNode = optionSetOfProperty[onePropertyNode.stableId];
		const valueNodes = optionSetNode
			? valueNodesOfOptionSet[optionSetNode.stableId] || []
			: [];
		declaredDomains.forEach((oneDomainId) => {
			propertyPairKeys.add(`${oneDomainId}|${propertyKey}`);
			valueNodes.forEach((oneValueNode) => {
				const valueKey = v1(oneValueNode.properties.canonicalKey);
				if (valueKey) {
					valueTripleKeys.add(`${oneDomainId}|${propertyKey}|V:${valueKey}`);
				}
			});
		});
	});

	// qualified §4.3: 'Has <X> Identifier Type' (enumerated) qualifies the '<X> Identifier' /
	// 'Has <X> Identifier' token in the SAME class, one tuple per (token, qualifier value)
	Object.keys(classPropertyNodes).forEach((oneClassStableId) => {
		const memberPropertyNodes = classPropertyNodes[oneClassStableId];
		memberPropertyNodes.forEach((oneTypePropertyNode) => {
			const typePropertyName = v1(oneTypePropertyNode.properties.name);
			const stemMatch = /^Has (.+) Identifier Type$/.exec(
				typeof typePropertyName === 'string' ? typePropertyName : '',
			);
			if (!stemMatch) {
				return;
			}
			const typeOptionSetNode = optionSetOfProperty[oneTypePropertyNode.stableId];
			if (!typeOptionSetNode) {
				return;
			}
			const stem = stemMatch[1];
			const tokenCandidateNames = [`${stem} Identifier`, `Has ${stem} Identifier`];
			const tokenNodes = memberPropertyNodes.filter(
				(onePropertyNode) =>
					tokenCandidateNames.indexOf(v1(onePropertyNode.properties.name)) !== -1,
			);
			if (tokenNodes.length !== 1) {
				return;
			}
			const tokenProps = tokenNodes[0].properties;
			const tokenDomainId = v1(tokenProps.domainId);
			const tokenKey = v1(tokenProps.canonicalKey);
			(valueNodesOfOptionSet[typeOptionSetNode.stableId] || []).forEach(
				(oneQualifierValueNode) => {
					const qualifierKey = v1(oneQualifierValueNode.properties.canonicalKey);
					if (qualifierKey) {
						qualifiedKeys.add(`${tokenDomainId}|${tokenKey}|Q:${qualifierKey}`);
					}
				},
			);
		});
	});

	const allKeys = new Set();
	propertyPairKeys.forEach((oneTupleKey) => allKeys.add(oneTupleKey));
	valueTripleKeys.forEach((oneTupleKey) => allKeys.add(oneTupleKey));
	qualifiedKeys.forEach((oneTupleKey) => allKeys.add(oneTupleKey));
	return { propertyPairKeys, valueTripleKeys, qualifiedKeys, allKeys };
};

const closureKeyOfCard = (oneCard) => {
	const p = oneCard.properties;
	const qualifierKeys = p.qualifierKeys || [];
	if (qualifierKeys.length) {
		return `${p.domainId}|${p.propertyKey}|Q:${qualifierKeys.slice().sort().join('+')}`;
	}
	if (p.referenceTier === 'value') {
		return `${p.domainId}|${p.propertyKey}|V:${p.canonicalKey}`;
	}
	return `${p.domainId}|${p.propertyKey}`;
};

// =====================================================================================
// independent derivation 2 — signature recomputation from ADDRESS fields alone (R-P1-1:
// the incumbent inputs, read from vocabulary's registered field order)
// =====================================================================================
const recomputeSignature = ({ cardProperties, hubVersion, definitionFedIntoHash }) => {
	const rangeSlot = isCarried(cardProperties.rangeOptionSetId)
		? cardProperties.rangeOptionSetId
		: isCarried(cardProperties.rangeClassId)
			? cardProperties.rangeClassId
			: isCarried(cardProperties.rangeDatatype)
				? cardProperties.rangeDatatype
				: '';
	const encodeSlot = (slotValue) =>
		slotValue === undefined || slotValue === null ? '' : String(slotValue);
	const fieldValues = {
		hubName: 'CEDS',
		canonicalKey: encodeSlot(cardProperties.canonicalKey),
		domainId: encodeSlot(cardProperties.domainId),
		propertyKey: encodeSlot(cardProperties.propertyKey),
		range: encodeSlot(rangeSlot),
		valueKey: encodeSlot(cardProperties.valueKey),
		qualifierKeys: (cardProperties.qualifierKeys || []).slice().sort().join(','),
		hubVersion,
	};
	const encoded = ADDRESS_SIGNATURE_FIELD_ORDER.map(
		(oneField) => fieldValues[oneField],
	).join('|');
	// the TWIN's corruption: prose enters the hash — exactly the fault G-2 exists to catch
	const encodedMaybeCorrupted = definitionFedIntoHash
		? `${encoded}|${encodeSlot(cardProperties.propertyDefinition)}`
		: encoded;
	return sha256Hex(encodedMaybeCorrupted);
};

// =====================================================================================
// independent derivation 3 — the §4 embedText recomposition from the card's own fields
// =====================================================================================
const recomposeEmbedText = (cardProperties) => {
	const tierSlots =
		cardProperties.referenceTier === 'value'
			? [
					[
						cardProperties.domainName,
						cardProperties.propertyName,
						cardProperties.rangeOptionSetName,
					]
						.filter(isCarried)
						.join(' · '),
					cardProperties.valueName,
					cardProperties.valueDefinition,
					cardProperties.rangeOptionSetDefinition,
				]
			: [
					cardProperties.domainName,
					cardProperties.propertyName,
					cardProperties.propertyDefinition,
					cardProperties.domainDefinition,
				];
	const qualifierSlot = (cardProperties.qualifierNames || []).join(' · ');
	return tierSlots
		.concat([qualifierSlot])
		.filter(isCarried)
		.join(' · ')
		.replace(/\s+/g, ' ')
		.trim();
};

// =====================================================================================
// independent derivation 4 — divergence recount straight off the base
// =====================================================================================
const recountDivergences = (baseNodes) => {
	const divergentRowKeys = [];
	baseNodes.forEach((oneNode) => {
		const role = v1(oneNode.properties.role);
		if (
			[
				DME_ROLES.CLASS,
				DME_ROLES.PROPERTY,
				DME_ROLES.OPTION_SET,
				DME_ROLES.OPTION_VALUE,
			].indexOf(role) === -1
		) {
			return;
		}
		const sourceDescription = v1(oneNode.properties.description);
		const sourceDefinition = v1(oneNode.properties.definition);
		// S-5: 'both exist' means both carry PROSE — null/'' are not prose
		if (
			isCarried(sourceDescription) &&
			isCarried(sourceDefinition) &&
			String(sourceDescription) !== String(sourceDefinition)
		) {
			divergentRowKeys.push(`${role}|${v1(oneNode.properties.cedsId)}`);
		}
	});
	return divergentRowKeys;
};

// =====================================================================================
// the measure computers — each takes the artifacts it judges, so the twin registry can
// re-invoke the SAME computer over a corrupted clone
// =====================================================================================

const computeEmptyStringViolations = ({ cards }) => {
	const violations = [];
	cards.forEach((oneCard) => {
		Object.keys(oneCard.properties).forEach((oneFieldName) => {
			const fieldValue = oneCard.properties[oneFieldName];
			if (fieldValue === '') {
				violations.push(`${oneCard.properties.canonicalKey}.${oneFieldName} is ''`);
			}
			if (Array.isArray(fieldValue) && fieldValue.some((oneEntry) => oneEntry === '')) {
				violations.push(
					`${oneCard.properties.canonicalKey}.${oneFieldName} contains ''`,
				);
			}
		});
	});
	return violations;
};

const computeMeaningCoverageViolations = ({ cards, baseIndexes }) => {
	const violations = [];
	const {
		propertyNodeByKey,
		valueNodeByKey,
		optionSetNodeByRangeOptionSetId,
		classByDomainId,
	} = baseIndexes;
	// two-sided presence: the card carries the field IFF the source carries prose (M-3)
	const twoSided = ({ violations, cardLabel, cardFieldName, cardValue, sourceValue }) => {
		if (isCarried(cardValue) !== isCarried(v1(sourceValue))) {
			violations.push(
				`${cardLabel}: ${cardFieldName} carried=${isCarried(cardValue)} but source ` +
					`has=${isCarried(v1(sourceValue))}`,
			);
		}
	};
	cards.forEach((oneCard) => {
		const p = oneCard.properties;
		const cardLabel = `${p.referenceTier} ${p.canonicalKey} (domain ${p.domainId})`;
		['domainName', 'domainDefinition', 'propertyName'].forEach((oneRequiredField) => {
			if (!isCarried(p[oneRequiredField])) {
				violations.push(`${cardLabel}: missing ${oneRequiredField}`);
			}
		});
		const basePropertyNode = propertyNodeByKey[p.propertyKey];
		if (!basePropertyNode) {
			violations.push(`${cardLabel}: propertyKey resolves to no base DmeProperty`);
			return;
		}
		twoSided({
			violations,
			cardLabel,
			cardFieldName: 'propertyDefinition',
			cardValue: p.propertyDefinition,
			sourceValue: basePropertyNode.properties.definition,
		});
		// M-3: the rest of the §1.3 property stack, two-sided
		twoSided({
			violations,
			cardLabel,
			cardFieldName: 'propertyNotation',
			cardValue: p.propertyNotation,
			sourceValue: basePropertyNode.properties.notation,
		});
		twoSided({
			violations,
			cardLabel,
			cardFieldName: 'propertyDataType',
			cardValue: p.propertyDataType,
			sourceValue: basePropertyNode.properties.dataType,
		});
		twoSided({
			violations,
			cardLabel,
			cardFieldName: 'propertyTextFormat',
			cardValue: p.propertyTextFormat,
			sourceValue: basePropertyNode.properties.textFormat,
		});
		// M-3: class-range prose — carried IFF the rangeClassId resolves AND the class has it
		if (isCarried(p.rangeClassId)) {
			const rangeClassNode = classByDomainId[p.rangeClassId];
			twoSided({
				violations,
				cardLabel,
				cardFieldName: 'rangeClassName',
				cardValue: p.rangeClassName,
				sourceValue: rangeClassNode ? rangeClassNode.properties.name : undefined,
			});
			twoSided({
				violations,
				cardLabel,
				cardFieldName: 'rangeClassDefinition',
				cardValue: p.rangeClassDefinition,
				sourceValue: rangeClassNode ? rangeClassNode.properties.definition : undefined,
			});
		}
		if (p.referenceTier === 'value') {
			if (!isCarried(p.valueName)) {
				violations.push(`${cardLabel}: missing valueName`);
			}
			const optionSetNode = optionSetNodeByRangeOptionSetId[p.rangeOptionSetId];
			if (!optionSetNode) {
				violations.push(`${cardLabel}: rangeOptionSetId resolves to no base DmeOptionSet`);
			} else {
				if (
					isCarried(v1(optionSetNode.properties.name)) !==
					isCarried(p.rangeOptionSetName)
				) {
					violations.push(`${cardLabel}: rangeOptionSetName coverage mismatch`);
				}
				if (
					isCarried(v1(optionSetNode.properties.definition)) !==
					isCarried(p.rangeOptionSetDefinition)
				) {
					violations.push(`${cardLabel}: rangeOptionSetDefinition coverage mismatch`);
				}
			}
			const baseValueNode = valueNodeByKey[p.canonicalKey];
			if (!baseValueNode) {
				violations.push(`${cardLabel}: value canonicalKey resolves to no base DmeOptionValue`);
			} else {
				twoSided({
					violations,
					cardLabel,
					cardFieldName: 'valueDefinition',
					cardValue: p.valueDefinition,
					sourceValue: baseValueNode.properties.definition,
				});
				// M-3: the rest of the §1.3 value stack, two-sided
				twoSided({
					violations,
					cardLabel,
					cardFieldName: 'valueNotation',
					cardValue: p.valueNotation,
					sourceValue: baseValueNode.properties.notation,
				});
				twoSided({
					violations,
					cardLabel,
					cardFieldName: 'valuePrefLabel',
					cardValue: p.valuePrefLabel,
					sourceValue: baseValueNode.properties.prefLabel,
				});
			}
		}
		const qualifierKeys = p.qualifierKeys || [];
		if (qualifierKeys.length) {
			const qualifierNames = p.qualifierNames || [];
			if (qualifierNames.length !== qualifierKeys.length) {
				violations.push(
					`${cardLabel}: qualifierNames length ${qualifierNames.length} != ` +
						`qualifierKeys length ${qualifierKeys.length}`,
				);
			}
		}
	});
	return violations;
};

const computeDivergenceViolations = ({ divergenceReport, baseNodes }) => {
	const violations = [];
	if (!Array.isArray(divergenceReport)) {
		violations.push('divergenceReport is not an array — "no report" must mean "did not run"');
		return violations;
	}
	divergenceReport.forEach((oneRow) => {
		if (String(oneRow.description) === String(oneRow.definition)) {
			violations.push(`row ${oneRow.role}|${oneRow.cedsId}: texts do NOT differ`);
		}
	});
	const independentRowKeys = recountDivergences(baseNodes);
	if (independentRowKeys.length !== divergenceReport.length) {
		violations.push(
			`row count ${divergenceReport.length} != independent recount ${independentRowKeys.length}`,
		);
	}
	const reportedRowKeys = new Set(
		divergenceReport.map((oneRow) => `${oneRow.role}|${oneRow.cedsId}`),
	);
	independentRowKeys.forEach((oneRowKey) => {
		if (!reportedRowKeys.has(oneRowKey)) {
			violations.push(`independent recount has ${oneRowKey}; report does not`);
		}
	});
	return violations;
};

const computeEmbedTextViolations = ({ cards }) => {
	const violations = [];
	cards.forEach((oneCard) => {
		const p = oneCard.properties;
		if (!isCarried(p.embedText)) {
			violations.push(`${p.canonicalKey} (domain ${p.domainId}): embedText absent or empty`);
			return;
		}
		const recomposed = recomposeEmbedText(p);
		if (recomposed !== p.embedText) {
			violations.push(
				`${p.canonicalKey} (domain ${p.domainId}): stored embedText differs from ` +
					`recomposition — stored '${String(p.embedText).slice(0, 80)}' vs ` +
					`recomposed '${recomposed.slice(0, 80)}'`,
			);
		}
	});
	return violations;
};

const computeUriMintingViolations = ({ hubNodes, cards, hubVersion, factoryNamespace }) => {
	const violations = [];
	// M-2: the expected prefix is READ from the FORGED HubDefinition's namespace property —
	// never from a suite literal — and the forged value must equal the factory argument
	const hubDefinitionNode = hubNodes.find((oneNode) => oneNode.role === 'HubDefinition');
	if (!hubDefinitionNode) {
		violations.push('no HubDefinition node — cannot read the namespace authority');
		return violations;
	}
	const forgedNamespace = hubDefinitionNode.properties.namespace;
	if (!isCarried(forgedNamespace)) {
		violations.push('forged HubDefinition.namespace is empty — no namespace authority');
		return violations;
	}
	if (forgedNamespace !== factoryNamespace) {
		violations.push(
			`forged HubDefinition.namespace '${forgedNamespace}' differs from the factory ` +
				`argument '${factoryNamespace}' — forgeHub is not using its argument`,
		);
	}
	cards.forEach((oneCard) => {
		const p = oneCard.properties;
		const expectedUri = `${forgedNamespace}${hubVersion}/${p.addressSignature}`;
		if (p.uri !== expectedUri) {
			violations.push(
				`${p.canonicalKey}: uri '${p.uri}' != namespace+version+signature '${expectedUri}'`,
			);
		}
		if (oneCard.stableId !== p.uri) {
			violations.push(`${p.canonicalKey}: stableId !== uri`);
		}
	});
	const seenStableIds = {};
	hubNodes.forEach((oneNode) => {
		if (seenStableIds[oneNode.stableId]) {
			violations.push(`stableId collision: ${oneNode.stableId}`);
		}
		seenStableIds[oneNode.stableId] = true;
	});
	return violations;
};

const computeHubDefinitionViolations = ({ hubNodes, hubEdges, cards, hubVersion }) => {
	const violations = [];
	const hubDefinitionNodes = hubNodes.filter(
		(oneNode) => oneNode.role === 'HubDefinition',
	);
	if (hubDefinitionNodes.length !== 1) {
		violations.push(`expected exactly 1 HubDefinition, found ${hubDefinitionNodes.length}`);
		return violations;
	}
	const hubDefinitionNode = hubDefinitionNodes[0];
	const hd = hubDefinitionNode.properties;
	if (!isCarried(hd.namespace)) {
		violations.push('HubDefinition.namespace is empty — the namespace authority is blank');
	}
	// S-4: the §2 identity is the point of the new card — assert it, do not spot-check it
	const expectedHubDefinitionId = `${hd.namespace}hubDefinition/CEDS`;
	if (hd.uri !== expectedHubDefinitionId) {
		violations.push(
			`HubDefinition.uri '${hd.uri}' != namespace + 'hubDefinition/CEDS' ` +
				`'${expectedHubDefinitionId}'`,
		);
	}
	if (hubDefinitionNode.stableId !== expectedHubDefinitionId) {
		violations.push(`HubDefinition.stableId != namespace + 'hubDefinition/CEDS'`);
	}
	if (hd.version !== hubVersion) {
		violations.push(
			`HubDefinition.version '${hd.version}' != base-derived hubVersion '${hubVersion}'`,
		);
	}
	if (hd.displayName !== 'Common Education Data Standards') {
		violations.push(`HubDefinition.displayName '${hd.displayName}' incorrect`);
	}
	const { parsed: slotProfile, faultMessage: slotProfileFault } = parsedJsonOf(
		hd.slotProfile,
	);
	if (slotProfileFault) {
		violations.push(`slotProfile does not parse: ${slotProfileFault}`);
	} else {
		const addressSlots = (slotProfile || {}).addressSlots || [];
		// S-4: EVERY address slot, not a sample
		[
			'hubName',
			'hubVersion',
			'referenceTier',
			'domainId',
			'propertyKey',
			'valueKey',
			'qualifierKeys',
		].forEach((oneSlot) => {
			if (addressSlots.indexOf(oneSlot) === -1) {
				violations.push(`slotProfile.addressSlots missing '${oneSlot}'`);
			}
		});
		const addressSlotsJoined = addressSlots.join(' ');
		['rangeDatatype', 'rangeClassId', 'rangeOptionSetId'].forEach((oneRangeShape) => {
			if (addressSlotsJoined.indexOf(oneRangeShape) === -1) {
				violations.push(`slotProfile.addressSlots missing range shape '${oneRangeShape}'`);
			}
		});
		const meaningByTier = (slotProfile || {}).meaningFieldsByTier || {};
		['domainName', 'propertyDefinition'].forEach((oneField) => {
			if (((meaningByTier.property || []).indexOf(oneField)) === -1) {
				violations.push(`slotProfile.meaningFieldsByTier.property missing '${oneField}'`);
			}
		});
		['valueName', 'valuePrefLabel'].forEach((oneField) => {
			if (((meaningByTier.value || []).indexOf(oneField)) === -1) {
				violations.push(`slotProfile.meaningFieldsByTier.value missing '${oneField}'`);
			}
		});
	}
	const { parsed: sourceProvenance, faultMessage: provenanceFault } = parsedJsonOf(
		hd.sourceProvenance,
	);
	if (provenanceFault) {
		violations.push(`sourceProvenance does not parse: ${provenanceFault}`);
	} else if (
		!sourceProvenance ||
		!isCarried(sourceProvenance.standardKey) ||
		!isCarried(sourceProvenance.forgeModule)
	) {
		violations.push('sourceProvenance is not populated (standardKey/forgeModule)');
	}
	const inHubEdges = hubEdges.filter((oneEdge) => oneEdge.type === IN_HUB_EDGE_TYPE);
	if (inHubEdges.length !== cards.length) {
		violations.push(
			`IN_HUB degree ${inHubEdges.length} != card count ${cards.length}`,
		);
	}
	const strayInHub = inHubEdges.filter(
		(oneEdge) => oneEdge.toRef.id !== hubDefinitionNode.stableId,
	);
	if (strayInHub.length) {
		violations.push(`${strayInHub.length} IN_HUB edge(s) target something other than the HubDefinition`);
	}
	return violations;
};

const computeTupleClosureViolations = ({ cards, expectedKeys }) => {
	const violations = [];
	const actualTupleKeyCounts = {};
	cards.forEach((oneCard) => {
		const oneTupleKey = closureKeyOfCard(oneCard);
		actualTupleKeyCounts[oneTupleKey] = (actualTupleKeyCounts[oneTupleKey] || 0) + 1;
	});
	expectedKeys.allKeys.forEach((oneTupleKey) => {
		if (!actualTupleKeyCounts[oneTupleKey]) {
			violations.push(`derivable tuple has NO card: ${oneTupleKey}`);
		}
	});
	Object.keys(actualTupleKeyCounts).forEach((oneTupleKey) => {
		if (!expectedKeys.allKeys.has(oneTupleKey)) {
			violations.push(`card exists for a tuple the base does not declare: ${oneTupleKey}`);
		}
		if (actualTupleKeyCounts[oneTupleKey] > 1) {
			violations.push(`tuple has ${actualTupleKeyCounts[oneTupleKey]} cards: ${oneTupleKey}`);
		}
	});
	return violations;
};

const VESTIGIAL_FIELD_NAMES = [
	'allDomainIds',
	'allDomainNames',
	'domainsComplete',
	'description',
];
const computeVestigialViolations = ({ cards }) => {
	const violations = [];
	cards.forEach((oneCard) => {
		VESTIGIAL_FIELD_NAMES.forEach((oneFieldName) => {
			if (oneCard.properties[oneFieldName] !== undefined) {
				violations.push(
					`${oneCard.properties.canonicalKey} carries vestigial '${oneFieldName}'`,
				);
			}
		});
	});
	return violations;
};

const computeRangeXorViolations = ({ cards }) => {
	const violations = [];
	cards.forEach((oneCard) => {
		const p = oneCard.properties;
		const presentRangeFields = ['rangeDatatype', 'rangeClassId', 'rangeOptionSetId'].filter(
			(oneFieldName) => p[oneFieldName] !== undefined,
		);
		if (presentRangeFields.length !== 1) {
			violations.push(
				`${p.canonicalKey} (domain ${p.domainId}): ${presentRangeFields.length} range ` +
					`field(s) [${presentRangeFields.join(', ')}] — exactly one required`,
			);
		}
	});
	return violations;
};

// G-P1 (incumbent parity) retired at Phase 5 WITH the incumbent it measured — its record
// is the campaign DEVLOG's Phase-1 remediation entry.
const VIOLATION_HARD_CAP = 200;

// =====================================================================================
// G-P2 (S-1) — DECOMPOSITION-EDGE TARGETS, per card, plus the derivable edge total.
// =====================================================================================
const computeEdgeTargetViolations = ({ cards, hubEdges, baseIndexes }) => {
	const violations = [];
	const capped = () => violations.length >= VIOLATION_HARD_CAP;
	const {
		propertyNodeByKey,
		valueNodeByKey,
		optionSetNodeByRangeOptionSetId,
		classByDomainId,
	} = baseIndexes;
	const cardByUri = {};
	cards.forEach((oneCard) => {
		cardByUri[oneCard.stableId] = oneCard;
	});
	const edgesByFromUri = {};
	hubEdges.forEach((oneEdge) => {
		if (oneEdge.type === IN_HUB_EDGE_TYPE) {
			return; // IN_HUB targeting is G-9's assertion
		}
		(edgesByFromUri[oneEdge.fromRef.id] = edgesByFromUri[oneEdge.fromRef.id] || []).push(
			oneEdge,
		);
	});
	let derivableEdgeTotal = 0;
	cards.forEach((oneCard) => {
		if (capped()) {
			return;
		}
		const p = oneCard.properties;
		const cardLabel = `${p.referenceTier} ${p.canonicalKey} (domain ${p.domainId})`;
		const domainClassNode = classByDomainId[p.domainId];
		const propertyNode = propertyNodeByKey[p.propertyKey];
		const rangeTargetNode = isCarried(p.rangeOptionSetId)
			? optionSetNodeByRangeOptionSetId[p.rangeOptionSetId]
			: isCarried(p.rangeClassId)
				? classByDomainId[p.rangeClassId]
				: undefined;
		const valueTargetNode =
			p.referenceTier === 'value' ? valueNodeByKey[p.canonicalKey] : undefined;
		const qualifierTargetIds = (p.qualifierKeys || []).map((oneQualifierKey) => {
			const qualifierNode = valueNodeByKey[oneQualifierKey];
			return qualifierNode ? qualifierNode.stableId : `UNRESOLVED:${oneQualifierKey}`;
		});
		const expectedTargetsByType = {
			HAS_CEDS_DOMAIN: domainClassNode ? [domainClassNode.stableId] : [],
			HAS_CEDS_PROPERTY: propertyNode ? [propertyNode.stableId] : [],
			HAS_CEDS_RANGE: rangeTargetNode ? [rangeTargetNode.stableId] : [],
			HAS_CEDS_VALUE: valueTargetNode ? [valueTargetNode.stableId] : [],
			HAS_CEDS_QUALIFIER: qualifierTargetIds,
		};
		const actualEdges = edgesByFromUri[oneCard.stableId] || [];
		Object.keys(expectedTargetsByType).forEach((oneEdgeType) => {
			const expectedTargets = expectedTargetsByType[oneEdgeType].slice().sort().join('|');
			const actualTargets = actualEdges
				.filter((oneEdge) => oneEdge.type === oneEdgeType)
				.map((oneEdge) => oneEdge.toRef.id)
				.sort()
				.join('|');
			if (expectedTargets !== actualTargets) {
				violations.push(
					`${cardLabel}: ${oneEdgeType} targets [${actualTargets}] != derivable ` +
						`[${expectedTargets}]`,
				);
			}
			derivableEdgeTotal += expectedTargetsByType[oneEdgeType].length;
		});
		derivableEdgeTotal += 1; // the card's IN_HUB edge
	});
	Object.keys(edgesByFromUri).forEach((oneFromUri) => {
		if (!cardByUri[oneFromUri]) {
			violations.push(`decomposition edge(s) from a non-card node: ${oneFromUri}`);
		}
	});
	if (derivableEdgeTotal !== hubEdges.length) {
		violations.push(
			`edge total ${hubEdges.length} != per-card derivable expectation ${derivableEdgeTotal}`,
		);
	}
	return violations;
};

// =====================================================================================
// G-P3 (S-3) — FORGE TOTALITY: every base DmeProperty produced cards or is skipped BY NAME.
// =====================================================================================
const computeForgeTotalityViolations = ({ cards, skipReport, baseNodes }) => {
	const violations = [];
	if (!Array.isArray(skipReport)) {
		violations.push('skipReport is not an array — "no report" must mean "did not run"');
		return violations;
	}
	const propertyKeysWithCards = new Set();
	cards.forEach((oneCard) => {
		propertyKeysWithCards.add(oneCard.properties.propertyKey);
	});
	const skipEntryByPropertyKey = {};
	skipReport.forEach((oneEntry) => {
		skipEntryByPropertyKey[oneEntry.propertyKey] = oneEntry;
	});
	const basePropertyByKey = {};
	baseNodes.forEach((oneNode) => {
		if (v1(oneNode.properties.role) === DME_ROLES.PROPERTY) {
			basePropertyByKey[v1(oneNode.properties.canonicalKey)] = oneNode;
		}
	});
	Object.keys(basePropertyByKey).forEach((onePropertyKey) => {
		const hasCards = propertyKeysWithCards.has(onePropertyKey);
		const skipEntry = skipEntryByPropertyKey[onePropertyKey];
		if (!hasCards && !skipEntry) {
			violations.push(
				`DmeProperty '${onePropertyKey}' produced NO card and NO skip entry — it fell ` +
					`out of the hub silently`,
			);
		}
		if (hasCards && skipEntry) {
			violations.push(`DmeProperty '${onePropertyKey}' has cards AND a skip entry`);
		}
		if (skipEntry) {
			if (skipEntry.reason !== 'zeroDeclaredDomains') {
				violations.push(
					`skip entry '${onePropertyKey}' carries unknown reason '${skipEntry.reason}'`,
				);
			}
			const baseProps = basePropertyByKey[onePropertyKey].properties;
			const declaredCount =
				valueListOf(baseProps.allDomainIds).length ||
				valueListOf(baseProps.domainId).length;
			if (declaredCount !== 0) {
				violations.push(
					`skip entry '${onePropertyKey}' claims zeroDeclaredDomains but the base ` +
						`declares ${declaredCount}`,
				);
			}
		}
	});
	skipReport.forEach((oneEntry) => {
		if (!basePropertyByKey[oneEntry.propertyKey]) {
			violations.push(
				`skip entry names unknown DmeProperty '${oneEntry.propertyKey}'`,
			);
		}
	});
	return violations;
};

// =====================================================================================
// THE FLOW — serial sections, one harness tally
// =====================================================================================

const runRefusalSection = (whenDone) => {
	harness.section('REFUSALS — required input is refused BY NAME, never defaulted');

	const missingVersionMessage = refusalMessageOf(() =>
		cedsHubForgeFactory({ hubNamespace: HUB_NAMESPACE }),
	);
	harness.match('absent hubVersion is refused by name', missingVersionMessage, /hubVersion/);
	const missingNamespaceMessage = refusalMessageOf(() =>
		cedsHubForgeFactory({ hubVersion: '14.0.0.0' }),
	);
	harness.match(
		'absent hubNamespace is refused by name',
		missingNamespaceMessage,
		/hubNamespace/,
	);
	const emptyNamespaceMessage = refusalMessageOf(() =>
		cedsHubForgeFactory({ hubVersion: '14.0.0.0', hubNamespace: '' }),
	);
	harness.match(
		'EMPTY hubNamespace is refused by name (G-9 module half)',
		emptyNamespaceMessage,
		/hubNamespace/,
	);

	const wellFormedForge = cedsHubForgeFactory({
		hubVersion: '14.0.0.0',
		hubNamespace: HUB_NAMESPACE,
	});
	wellFormedForge.forgeHub(null, (malformedError) => {
		harness.rejects(
			'a malformed baseNodeEdges is refused via the R7 callback',
			[malformedError],
			/REFUSED/,
		);
		wellFormedForge.forgeHub({ nodes: [], edges: [] }, (rootlessError) => {
			harness.rejects(
				'a base with no DmeStandardRoot is refused by name',
				[rootlessError],
				/DmeStandardRoot/,
			);
			whenDone();
		});
	});
};

forgeCeds.forge(
	{ sourcePath: CEDS_SOURCE_PATH, skipEmbedding: true },
	(forgeError, base) => {
		if (forgeError) {
			harness.ok('CEDS forge succeeded (local asset, no embedding)', false, String(forgeError));
			harness.report();
			return;
		}

		const rootNode = base.nodes.find(
			(oneNode) => v1(oneNode.properties.role) === DME_ROLES.STANDARD_ROOT,
		);
		const hubVersion = rootNode ? v1(rootNode.properties.version) : undefined;

		runRefusalSection(() => {
			harness.section('THE FORGE — the real base, the real derivation, no I/O');
			harness.ok('the base carries a DmeStandardRoot', !!rootNode, 'no root node');
			harness.ok(
				'hubVersion is DERIVED from the base root, not a literal',
				isCarried(hubVersion),
				`root version '${hubVersion}'`,
			);

			const hubForge = cedsHubForgeFactory({ hubVersion, hubNamespace: HUB_NAMESPACE });
			hubForge.forgeHub({ nodes: base.nodes, edges: base.edges }, (hubError, hub) => {
				harness.ok('forgeHub succeeds against the real corpus', !hubError, String(hubError));
				if (hubError) {
					harness.report();
					return;
				}

				const cards = hub.nodes.filter((oneNode) => oneNode.role === 'HubReference');
				const expectedKeys = deriveExpectedTupleKeys({
					nodes: base.nodes,
					edges: base.edges,
				});

				// base indexes for the coverage computer
				const propertyNodeByKey = {};
				const valueNodeByKey = {};
				const optionSetNodeByRangeOptionSetId = {};
				const classByDomainId = {};
				base.nodes.forEach((oneNode) => {
					const role = v1(oneNode.properties.role);
					if (role === DME_ROLES.PROPERTY) {
						propertyNodeByKey[v1(oneNode.properties.canonicalKey)] = oneNode;
					}
					if (role === DME_ROLES.OPTION_VALUE) {
						valueNodeByKey[v1(oneNode.properties.canonicalKey)] = oneNode;
					}
					if (role === DME_ROLES.OPTION_SET) {
						optionSetNodeByRangeOptionSetId[v1(oneNode.properties.rangeOptionSetId)] =
							oneNode;
					}
					if (role === DME_ROLES.CLASS) {
						classByDomainId[v1(oneNode.properties.domainId)] = oneNode;
					}
				});
				const baseIndexes = {
					propertyNodeByKey,
					valueNodeByKey,
					optionSetNodeByRangeOptionSetId,
					classByDomainId,
				};

				// ---- M-2: sentinel-namespace probe results land here (filled before the
				//      measurement bundle is built) ----
				const SENTINEL_NAMESPACE = 'https://sentinel.example/hub/';
				const sentinelProbeViolations = [];

				// =========================================================================
				// G-2's two RE-FORGE probes — meaning-purity and address-sensitivity, proven
				// against the module itself, not against this suite's own recomputation.
				// NOTE: forgeHub calls back SYNCHRONOUSLY, so everything the probe callbacks
				// invoke is declared BEFORE the probes run (const, no hoisting).
				// =========================================================================
				const addressPurityViolations = [];
				cards.forEach((oneCard) => {
					const recomputed = recomputeSignature({
						cardProperties: oneCard.properties,
						hubVersion,
					});
					if (recomputed !== oneCard.properties.addressSignature) {
						addressPurityViolations.push(
							`${oneCard.properties.canonicalKey}: stored signature != ` +
								`independent ADDRESS-only recomputation`,
						);
					}
				});

				const tamperTargetNode = base.nodes.find(
					(oneNode) =>
						v1(oneNode.properties.role) === DME_ROLES.PROPERTY &&
						isCarried(v1(oneNode.properties.definition)),
				);
				const reForgeWithReplacedNode = (replacementNode, reForgeDone) => {
					const tamperedNodes = base.nodes.map((oneNode) =>
						oneNode === tamperTargetNode ? replacementNode : oneNode,
					);
					hubForge.forgeHub(
						{ nodes: tamperedNodes, edges: base.edges },
						reForgeDone,
					);
				};
				const signatureSetOf = (someNodes) =>
					someNodes
						.filter((oneNode) => oneNode.role === 'HubReference')
						.map((oneNode) => oneNode.properties.addressSignature)
						.sort()
						.join('\n');

				// =========================================================================
				const continueWithMeasurements = () => {
					// N-3: the bundle is a FUNCTION so it can be recomputed AFTER the twin
					// sweep and byte-compared — 'pristine restored' becomes re-measured fact,
					// not an assertion by construction
					const computeMeasurementBundle = () => ({
						hub: {
							cardCountDeltaForgedVsDerived: cards.length - expectedKeys.allKeys.size,
							addressPurityViolations: addressPurityViolations.slice(),
							emptyStringPropertyViolations: computeEmptyStringViolations({ cards }),
							meaningCoverageViolations: computeMeaningCoverageViolations({
								cards,
								baseIndexes,
							}),
							divergenceReportViolations: computeDivergenceViolations({
								divergenceReport: hub.divergenceReport,
								baseNodes: base.nodes,
							}),
							embedTextViolations: computeEmbedTextViolations({ cards }),
							uriMintingViolations: sentinelProbeViolations.concat(
								computeUriMintingViolations({
									hubNodes: hub.nodes,
									cards,
									hubVersion,
									factoryNamespace: HUB_NAMESPACE,
								}),
							),
							hubDefinitionViolations: computeHubDefinitionViolations({
								hubNodes: hub.nodes,
								hubEdges: hub.edges,
								cards,
								hubVersion,
							}),
							tupleClosureViolations: computeTupleClosureViolations({
								cards,
								expectedKeys,
							}),
							vestigialFieldViolations: computeVestigialViolations({ cards }),
							rangeXorViolations: computeRangeXorViolations({ cards }),
							edgeTargetViolations: computeEdgeTargetViolations({
								cards,
								hubEdges: hub.edges,
								baseIndexes,
							}),
							forgeTotalityViolations: computeForgeTotalityViolations({
								cards,
								skipReport: hub.skipReport,
								baseNodes: base.nodes,
							}),
						},
					});
					const measurements = computeMeasurementBundle();

					// =====================================================================
					// THE TWIN REGISTRY — each injects its NAMED fault into a corrupted copy
					// of the real artifacts and re-runs the SAME measure computer over it
					// =====================================================================
					const capViolationList = (violations) => violations.slice(0, 25);
					const withCorruptedHubMeasure = (
						pristineMeasurements,
						measureName,
						corruptedValue,
					) => ({
						...pristineMeasurements,
						hub: { ...pristineMeasurements.hub, [measureName]: corruptedValue },
					});

					const firstQualifiedCard = cards.find(
						(oneCard) => (oneCard.properties.qualifierKeys || []).length,
					);
					const firstDatatypeCard = cards.find(
						(oneCard) => oneCard.properties.rangeDatatype !== undefined,
					);
					const multiDomainPropertyNode = base.nodes.find(
						(oneNode) =>
							v1(oneNode.properties.role) === DME_ROLES.PROPERTY &&
							valueListOf(oneNode.properties.allDomainIds).length > 1,
					);

					const cardsWithReplacedFirst = (corruptedProperties) =>
						[
							{ ...cards[0], properties: corruptedProperties },
						].concat(cards.slice(1));

					const twinRegistry = {
						dropOneDeclaredDomainFromEnumeration: ({ measurements: pristine }) => {
							const declaredDomains = valueListOf(
								multiDomainPropertyNode.properties.allDomainIds,
							);
							const truncatedNode = {
								...multiDomainPropertyNode,
								properties: {
									...multiDomainPropertyNode.properties,
									allDomainIds: declaredDomains.slice(1),
								},
							};
							const corruptedBaseNodes = base.nodes.map((oneNode) =>
								oneNode === multiDomainPropertyNode ? truncatedNode : oneNode,
							);
							const corruptedExpected = deriveExpectedTupleKeys({
								nodes: corruptedBaseNodes,
								edges: base.edges,
							});
							return withCorruptedHubMeasure(
								pristine,
								'cardCountDeltaForgedVsDerived',
								cards.length - corruptedExpected.allKeys.size,
							);
						},
						feedDefinitionIntoHash: ({ measurements: pristine }) => {
							const corruptedViolations = [];
							cards.some((oneCard) => {
								const corrupted = recomputeSignature({
									cardProperties: oneCard.properties,
									hubVersion,
									definitionFedIntoHash: true,
								});
								if (corrupted !== oneCard.properties.addressSignature) {
									corruptedViolations.push(
										`${oneCard.properties.canonicalKey}: definition-fed hash != stored`,
									);
								}
								return corruptedViolations.length >= 25;
							});
							return withCorruptedHubMeasure(
								pristine,
								'addressPurityViolations',
								corruptedViolations,
							);
						},
						stampEmptyDescription: ({ measurements: pristine }) => {
							const corruptedCards = cardsWithReplacedFirst({
								...cards[0].properties,
								description: '',
							});
							return withCorruptedHubMeasure(
								pristine,
								'emptyStringPropertyViolations',
								capViolationList(
									computeEmptyStringViolations({ cards: corruptedCards }),
								),
							);
						},
						skipProseCopyForOneRole: ({ measurements: pristine }) => {
							const corruptedCards = cards.map((oneCard) => {
								const strippedProperties = { ...oneCard.properties };
								delete strippedProperties.domainDefinition;
								return { ...oneCard, properties: strippedProperties };
							});
							return withCorruptedHubMeasure(
								pristine,
								'meaningCoverageViolations',
								capViolationList(
									computeMeaningCoverageViolations({
										cards: corruptedCards,
										baseIndexes,
									}),
								),
							);
						},
						suppressOneDivergenceRow: ({ measurements: pristine }) => {
							const suppressedReport = hub.divergenceReport.slice(1);
							return withCorruptedHubMeasure(
								pristine,
								'divergenceReportViolations',
								capViolationList(
									computeDivergenceViolations({
										divergenceReport: suppressedReport,
										baseNodes: base.nodes,
									}),
								),
							);
						},
						tamperOneStoredEmbedText: ({ measurements: pristine }) => {
							const corruptedCards = cardsWithReplacedFirst({
								...cards[0].properties,
								embedText: `${cards[0].properties.embedText} TAMPERED`,
							});
							return withCorruptedHubMeasure(
								pristine,
								'embedTextViolations',
								capViolationList(computeEmbedTextViolations({ cards: corruptedCards })),
							);
						},
						mintOneUriFromLiteral: ({ measurements: pristine }) => {
							const literalMintedUri = `https://example.invalid/hub/${cards[0].properties.addressSignature}`;
							const corruptedCards = cardsWithReplacedFirst({
								...cards[0].properties,
								uri: literalMintedUri,
							});
							corruptedCards[0] = {
								...corruptedCards[0],
								stableId: literalMintedUri,
							};
							const corruptedHubNodes = hub.nodes.map((oneNode) =>
								oneNode === cards[0] ? corruptedCards[0] : oneNode,
							);
							return withCorruptedHubMeasure(
								pristine,
								'uriMintingViolations',
								capViolationList(
									computeUriMintingViolations({
										hubNodes: corruptedHubNodes,
										cards: corruptedCards,
										hubVersion,
										factoryNamespace: HUB_NAMESPACE,
									}),
								),
							);
						},
						blankTheNamespace: ({ measurements: pristine }) => {
							const corruptedHubNodes = hub.nodes.map((oneNode) =>
								oneNode.role === 'HubDefinition'
									? {
											...oneNode,
											properties: { ...oneNode.properties, namespace: '' },
										}
									: oneNode,
							);
							return withCorruptedHubMeasure(
								pristine,
								'hubDefinitionViolations',
								capViolationList(
									computeHubDefinitionViolations({
										hubNodes: corruptedHubNodes,
										hubEdges: hub.edges,
										cards,
										hubVersion,
									}),
								),
							);
						},
						removeOneQualifiedCard: ({ measurements: pristine }) => {
							const corruptedCards = cards.filter(
								(oneCard) => oneCard !== firstQualifiedCard,
							);
							return withCorruptedHubMeasure(
								pristine,
								'tupleClosureViolations',
								capViolationList(
									computeTupleClosureViolations({
										cards: corruptedCards,
										expectedKeys,
									}),
								),
							);
						},
						stampOneVestigialField: ({ measurements: pristine }) => {
							const corruptedCards = cardsWithReplacedFirst({
								...cards[0].properties,
								allDomainIds: ['C000000'],
							});
							return withCorruptedHubMeasure(
								pristine,
								'vestigialFieldViolations',
								capViolationList(computeVestigialViolations({ cards: corruptedCards })),
							);
						},
						retargetOneDomainEdge: ({ measurements: pristine }) => {
							const firstDomainEdgeIndex = hub.edges.findIndex(
								(oneEdge) => oneEdge.type === 'HAS_CEDS_DOMAIN',
							);
							const pristineDomainEdge = hub.edges[firstDomainEdgeIndex];
							const wrongClassNode = base.nodes.find(
								(oneNode) =>
									v1(oneNode.properties.role) === DME_ROLES.CLASS &&
									oneNode.stableId !== pristineDomainEdge.toRef.id,
							);
							const corruptedEdges = hub.edges.slice();
							corruptedEdges[firstDomainEdgeIndex] = {
								...pristineDomainEdge,
								toRef: { ...pristineDomainEdge.toRef, id: wrongClassNode.stableId },
							};
							return withCorruptedHubMeasure(
								pristine,
								'edgeTargetViolations',
								capViolationList(
									computeEdgeTargetViolations({
										cards,
										hubEdges: corruptedEdges,
										baseIndexes,
									}),
								),
							);
						},
						dropOnePropertysCardsWithoutSkipEntry: ({ measurements: pristine }) => {
							const droppedPropertyKey = cards[0].properties.propertyKey;
							const corruptedCards = cards.filter(
								(oneCard) => oneCard.properties.propertyKey !== droppedPropertyKey,
							);
							return withCorruptedHubMeasure(
								pristine,
								'forgeTotalityViolations',
								capViolationList(
									computeForgeTotalityViolations({
										cards: corruptedCards,
										skipReport: hub.skipReport,
										baseNodes: base.nodes,
									}),
								),
							);
						},
						stampTwoRangeFields: ({ measurements: pristine }) => {
							const corruptedCards = [
								{
									...firstDatatypeCard,
									properties: {
										...firstDatatypeCard.properties,
										rangeClassId: 'C000000',
									},
								},
							].concat(cards.filter((oneCard) => oneCard !== firstDatatypeCard));
							return withCorruptedHubMeasure(
								pristine,
								'rangeXorViolations',
								capViolationList(computeRangeXorViolations({ cards: corruptedCards })),
							);
						},
					};

					harness.section('TWIN PRECONDITIONS — the faults the registry needs really exist');
					harness.ok(
						'a multi-domain property exists to drop a domain from',
						!!multiDomainPropertyNode,
						'none found',
					);
					harness.ok('a qualified card exists to remove', !!firstQualifiedCard, 'none found');
					harness.ok(
						'a datatype-ranged card exists to double-stamp',
						!!firstDatatypeCard,
						'none found',
					);
					harness.ok(
						'the divergence report has a row to suppress',
						hub.divergenceReport.length > 0,
						'report is empty — suppressOneDivergenceRow cannot inject',
					);
					const firstClassRangeCard = cards.find(
						(oneCard) =>
							isCarried(oneCard.properties.rangeClassId) &&
							isCarried(oneCard.properties.rangeClassName),
					);
					harness.ok(
						'a class-range card with range prose exists (M-3 sample)',
						!!firstClassRangeCard,
						'none found',
					);
					harness.ok(
						'the skip report is an explicit array (S-3)',
						Array.isArray(hub.skipReport),
						'skipReport absent',
					);

					// =====================================================================
					gatesLib.loadGateDeclarations({ filePath: DECLARATIONS_PATH }, (loadError, loadResult) => {
						harness.section('GATE DECLARATIONS — data, loaded through the existing harness');
						harness.ok('hubGates.jsonc loads', !loadError, loadError);
						if (loadError) {
							harness.report();
							return;
						}
						// THIS SUITE JUDGES THE hub:-MEASURED DECLARATIONS ONLY (Phase 2). The
						// declarations file also carries the BUILD-SCOPED family-B gates (G-7,
						// G-13), whose build: measures are supplied by test-cedsHubBuildGates.js
						// against the real forger seam — the harness reports any gate it is asked
						// to judge without a supplied measure as UNMEASURED (a failure), so each
						// runner evaluates exactly the declarations whose measures it computes.
						const declarations = {
							...loadResult.declarations,
							gates: loadResult.declarations.gates.filter(
								(oneGate) => oneGate.measure.indexOf('hub:') === 0,
							),
						};
						harness.equal(
							'thirteen card-local gates declared (11 spec + 2 family-P; hub:-measured)',
							declarations.gates.length,
							13,
						);

						gatesLib.runTwins(
							{ declarations, measurements, twinRegistry },
							(twinError, twinResult) => {
								harness.section(
									'THE TWIN SWEEP — every gate OBSERVED going RED under its own injected fault',
								);
								harness.ok('the twin sweep runs', !twinError, twinError);
								if (twinError) {
									harness.report();
									return;
								}
								twinResult.twinReports.forEach((oneReport) => {
									// note(), not just ok(): the twin evidence must be visible in the
									// DEFAULT run output (WORKORDER Phase 1 proof item 1), not only
									// under -verbose
									harness.note(
										`${oneReport.gateId}: twin '${oneReport.twin}' injected -> ` +
											`${
												oneReport.ran && oneReport.gateWentRed
													? 'gate observed RED (pristine bundle re-MEASURED after the sweep — see N-3 assertion)'
													: `TWIN FAILED: ${oneReport.note}`
											}`,
									);
									harness.ok(
										`${oneReport.gateId}: twin '${oneReport.twin}' turned its gate RED`,
										oneReport.ran && oneReport.gateWentRed,
										oneReport.note,
									);
								});

								gatesLib.evaluateSuite(
									{
										declarations,
										measurements,
										observedTwins: twinResult.observedTwins,
									},
									(evalError, evalResult) => {
										harness.section('THE VERDICT — pristine measurements, twins observed');
										harness.ok('the suite evaluates', !evalError, evalError);
										if (evalError) {
											harness.report();
											return;
										}
										const { suiteResult } = evalResult;
										gatesLib.renderSuiteText(
											{ suiteResult, twinReports: twinResult.twinReports },
											(renderError, rendered) => {
												if (!renderError) {
													xLog.status(rendered.text);
												}
												suiteResult.gates.forEach((oneGate) => {
													harness.equal(
														`${oneGate.id} ${oneGate.contract.split(':')[0]}`,
														oneGate.status,
														'PASS',
													);
													if (oneGate.status !== 'PASS') {
														const measureName = oneGate.measure.split(':')[1];
														const violations = measurements.hub[measureName];
														(Array.isArray(violations) ? violations : [violations])
															.slice(0, 5)
															.forEach((oneViolation) =>
																harness.note(`   ${oneViolation}`),
															);
													}
												});
												harness.equal('zero FAIL', suiteResult.failed, 0);
												harness.equal('zero UNMEASURED', suiteResult.unmeasured, 0);
												harness.equal('zero UNPROVEN', suiteResult.unproven, 0);
												harness.ok('suite ACCEPTED', suiteResult.accepted === true);

												// N-3: prove the twin sweep left the artifacts
												// untouched by RE-MEASURING, not by trusting the
												// twins' non-mutating construction
												const postSweepBundle = computeMeasurementBundle();
												harness.ok(
													'N-3: post-sweep re-measure is byte-identical to the pre-sweep bundle',
													JSON.stringify(postSweepBundle) ===
														JSON.stringify(measurements),
													'the twin sweep MUTATED a measured artifact',
												);

												runReportingSections();
											},
										);
									},
								);
							},
						);
					});

					// =====================================================================
					// a FUNCTION DECLARATION deliberately (hoisted): the gates chain above
					// calls this synchronously before a const initializer would have run
					// =====================================================================
					function runReportingSections() {
						harness.section('THE CENSUS — both sides computed, no literal');
						harness.note(
							`derived from base:  property pairs ${expectedKeys.propertyPairKeys.size}, ` +
								`value triples ${expectedKeys.valueTripleKeys.size}, ` +
								`qualified tuples ${expectedKeys.qualifiedKeys.size}, ` +
								`total ${expectedKeys.allKeys.size}`,
						);
						harness.note(
							`forged by module:   property tier ${hub.counts.propertyTier}, ` +
								`value tier ${hub.counts.valueTier}, ` +
								`qualified ${hub.counts.qualified}, ` +
								`total ${hub.counts.hubReferenceTotal}`,
						);
						harness.equal(
							'the two independently computed totals agree',
							hub.counts.hubReferenceTotal,
							expectedKeys.allKeys.size,
						);

						harness.section('THE DIVERGENCE REPORT — written, explicit-empty if none');
						fs.mkdirSync(TEST_ARTIFACTS_DIR, { recursive: true });
						fs.writeFileSync(
							DIVERGENCE_REPORT_PATH,
							JSON.stringify(hub.divergenceReport, null, 2),
						);
						const byRole = {};
						hub.divergenceReport.forEach((oneRow) => {
							byRole[oneRow.role] = (byRole[oneRow.role] || 0) + 1;
						});
						harness.note(
							`${hub.divergenceReport.length} divergence row(s): ` +
								`${JSON.stringify(byRole)} -> ${DIVERGENCE_REPORT_PATH}`,
						);
						const { faultMessage: writtenReportFault } = parsedJsonOf(
							fs.readFileSync(DIVERGENCE_REPORT_PATH, 'utf8'),
						);
						harness.ok(
							'the written report file parses back',
							!writtenReportFault,
							writtenReportFault,
						);
						const SKIP_REPORT_PATH = path.join(
							TEST_ARTIFACTS_DIR,
							'cedsHubSkipReport.json',
						);
						fs.writeFileSync(
							SKIP_REPORT_PATH,
							JSON.stringify(hub.skipReport, null, 2),
						);
						harness.note(
							`${hub.skipReport.length} skip-report row(s) (S-3, explicit-empty ` +
								`when none) -> ${SKIP_REPORT_PATH}`,
						);

						harness.section('SAMPLE DUMP — four complete cards for the supervisor back-gate');
						const samplePropertyCard =
							cards.find(
								(oneCard) =>
									oneCard.properties.canonicalKey === 'P001470' &&
									oneCard.properties.referenceTier === 'property',
							) || cards.find((oneCard) => oneCard.properties.referenceTier === 'property');
						const sampleValueCard = cards.find(
							(oneCard) =>
								oneCard.properties.referenceTier === 'value' &&
								isCarried(oneCard.properties.valueDefinition) &&
								isCarried(oneCard.properties.rangeOptionSetDefinition) &&
								isCarried(oneCard.properties.valueNotation) &&
								isCarried(oneCard.properties.valuePrefLabel),
						);
						const sampleQualifiedCard = firstQualifiedCard;
						const sampleClassRangeCard = firstClassRangeCard;
						harness.ok('a property-tier sample exists', !!samplePropertyCard);
						harness.ok(
							'a value-tier sample with the FULL prose stack exists',
							!!sampleValueCard,
						);
						harness.ok('a qualified sample exists', !!sampleQualifiedCard);
						harness.ok(
							'a class-range sample with range prose exists (M-3)',
							!!sampleClassRangeCard,
						);
						[
							['PROPERTY-TIER SAMPLE', samplePropertyCard],
							['VALUE-TIER SAMPLE (full prose stack)', sampleValueCard],
							['QUALIFIED SAMPLE', sampleQualifiedCard],
							['CLASS-RANGE SAMPLE (rangeClassName/rangeClassDefinition)', sampleClassRangeCard],
						].forEach(([sampleLabel, oneSampleCard]) => {
							if (oneSampleCard) {
								xLog.status(`\n---- ${sampleLabel} ----`);
								xLog.status(JSON.stringify(oneSampleCard, null, 2));
							}
						});

						harness.report();
					}
				};

				// =========================================================================
				// RUN the two G-2 re-forge probes, then hand off to the measurement/gate
				// chain (forgeHub calls back synchronously; the chain continues inside the
				// innermost callback)
				// =========================================================================
				const definitionEditedNode = {
					...tamperTargetNode,
					properties: {
						...tamperTargetNode.properties,
						definition: `${v1(tamperTargetNode.properties.definition)} [MEANING EDIT PROBE]`,
					},
				};
				reForgeWithReplacedNode(definitionEditedNode, (probeOneError, probeOneHub) => {
					if (probeOneError) {
						addressPurityViolations.push(
							`meaning-edit re-forge failed: ${probeOneError}`,
						);
					} else {
						if (signatureSetOf(probeOneHub.nodes) !== signatureSetOf(hub.nodes)) {
							addressPurityViolations.push(
								'editing a DEFINITION changed at least one addressSignature — prose ' +
									'has entered the hash',
							);
						}
						const embedTextChanged = probeOneHub.nodes.some(
							(oneNode, oneIndex) =>
								oneNode.role === 'HubReference' &&
								hub.nodes[oneIndex] &&
								oneNode.properties.embedText !== hub.nodes[oneIndex].properties.embedText,
						);
						if (!embedTextChanged) {
							addressPurityViolations.push(
								'the definition edit is INVISIBLE (no embedText changed) — the probe ' +
									'proves nothing',
							);
						}
					}

					const canonicalKeyEditedNode = {
						...tamperTargetNode,
						properties: {
							...tamperTargetNode.properties,
							canonicalKey: `${v1(tamperTargetNode.properties.canonicalKey)}X`,
						},
					};
					reForgeWithReplacedNode(
						canonicalKeyEditedNode,
						(probeTwoError, probeTwoHub) => {
							if (probeTwoError) {
								addressPurityViolations.push(
									`canonicalKey-edit re-forge failed: ${probeTwoError}`,
								);
							} else if (
								signatureSetOf(probeTwoHub.nodes) === signatureSetOf(hub.nodes)
							) {
								addressPurityViolations.push(
									'editing an ADDRESS field (canonicalKey) changed NO signature — ' +
										'the hash is not reading the address',
								);
							}

							// M-2: SENTINEL-NAMESPACE probe — forge once with a namespace no
							// literal in the module could equal; every card uri AND the
							// HubDefinition.namespace must carry it, proving forgeHub MINTS
							// FROM ITS ARGUMENT rather than from any same-valued constant
							cedsHubForgeFactory({
								hubVersion,
								hubNamespace: SENTINEL_NAMESPACE,
							}).forgeHub(
								{ nodes: base.nodes, edges: base.edges },
								(sentinelError, sentinelHub) => {
									if (sentinelError) {
										sentinelProbeViolations.push(
											`sentinel-namespace re-forge failed: ${sentinelError}`,
										);
									} else {
										const sentinelPrefix = `${SENTINEL_NAMESPACE}${hubVersion}/`;
										const strayUriCount = sentinelHub.nodes.filter(
											(oneNode) =>
												oneNode.role === 'HubReference' &&
												oneNode.properties.uri.indexOf(sentinelPrefix) !== 0,
										).length;
										if (strayUriCount) {
											sentinelProbeViolations.push(
												`${strayUriCount} card uri(s) do NOT carry the sentinel ` +
													`namespace — a literal is leaking into minting`,
											);
										}
										const sentinelHubDefinition = sentinelHub.nodes.find(
											(oneNode) => oneNode.role === 'HubDefinition',
										);
										if (
											!sentinelHubDefinition ||
											sentinelHubDefinition.properties.namespace !==
												SENTINEL_NAMESPACE
										) {
											sentinelProbeViolations.push(
												'HubDefinition.namespace does not carry the sentinel — ' +
													'the namespace authority is not the factory argument',
											);
										}
									}
									continueWithMeasurements();
								},
							);
						},
					);
				});
			});
		});
	},
);
