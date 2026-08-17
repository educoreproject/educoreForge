#!/usr/bin/env node
'use strict';

// p2_idGateOverPrompts.js — LUNAR_PRISM (P2), 2026-08-17. READ-ONLY. RETAINED per O-7.
//
// THE ID-GATE OVER ALL PROMPTS — the P2 deliverable the brief states as: "id-gate over ALL prompts
// (PESC carries no CEDS identifier anywhere — P0 measured `crossRefs` empty on every PESC node on both
// labels — so A HIT IS A REAL FINDING)."
//
// WHAT IT IS FOR. A derived bridge must match on MEANING. If a CEDS identifier were reachable in the
// text the judge is shown for a PESC subject, the judge could match on the IDENTIFIER and the whole
// derived claim would collapse into a crosswalk wearing a judge's clothes — while every gate stayed
// green, because a correct answer arrived by an illegitimate route.
//
// ⚠️ WHAT IS ACTUALLY SCANNED, AND WHY IT IS NOT THE PROMPT STRING ITSELF. **THE RENDERED PROMPT TEXT
// IS NOT RETAINED.** The frozen decision record carries only `judge.promptHash` — a digest — and no
// prompt body; I DUMPED the record's keys and then the interiors of its arrays rather than assuming.
// A hash cannot be searched for a substring. So this gate scans THE ONLY THING A PROMPT CAN BE BUILT
// FROM: the declared `renderingAllowList` property values, read off the real subject nodes in the
// frozen base block. IF NO ALLOW-LISTED VALUE CONTAINS A CEDS IDENTIFIER, NO PROMPT COMPOSED FROM
// THOSE VALUES CAN CONTAIN ONE.
//
// THAT IS A NARROWER CLAIM THAN "every prompt was scanned" AND IT IS STATED AS SUCH RATHER THAN LET
// TO READ AS THE STRONGER ONE. The gap is the renderer itself: this proves the INPUTS are clean, not
// that the renderer adds nothing. The renderer is framework code under a separate gate (BG-BLIND), and
// closing that gap here would need retained prompt bodies, which do not exist.
//
// THE PATTERNS ARE DECLARED AS DATA, each with the reason it identifies CEDS, so a reader can judge the
// gate's reach rather than trust its verdict.
//
// Reads one sqlite store READ-ONLY. No graph, no container, no write.

const { spawnSync } = require('child_process');

const moduleName = 'p2_idGateOverPrompts';
const STORE_DIR = '/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/bridgeAcceptance/pescDerived';
const STANDARDS_STORE = `${STORE_DIR}/pescDerived.standardsDatabase.sqlite3`;
const BASE_BLOCK_SUBJECT = 'pesc260805@aggregate_01_base';

// The SUBJECT-side renderingAllowList of each plugin, copied from the declarations. These are the only
// property values that can reach a prompt for a PESC subject.
const ALLOW_LIST_BY_PLUGIN = {
	pescCedsDerivedPlugin: { label: 'PescElementDecl', nameList: ['name', 'owningTypeName', 'typeAsWritten', 'effectiveDescription'] },
	pescOptionSetCedsDerivedPlugin: { label: 'PescNamedDefinition', nameList: ['name', 'kind', 'description'] },
};

// CEDS IDENTIFIER PATTERNS, DECLARED AS DATA WITH THEIR REASONS.
const CEDS_IDENTIFIER_PATTERN_REGISTRY = {
	cedsElementId: { pattern: /\bC\d{6}\b/, why: "CEDS mints element/class ids of the form C000002 (measured on the live hub: https://w3id.org/CEDStandards/terms/C000002)." },
	cedsNamespaceUri: { pattern: /w3id\.org\/(EDUcore\/)?CEDStandards/i, why: 'the CEDS ontology namespace, and the hub card namespace built on it.' },
	cedsIdPropertyName: { pattern: /cedsId/i, why: "the blinded property's own name; its appearance in a VALUE would mean an identifier had been copied into prose." },
	cedsGlobalId: { pattern: /\bceds[-_ ]?(global)?[-_ ]?id\b/i, why: 'a spelled-out CEDS identifier reference in prose.' },
	hubCardHash: { pattern: /\/hub\/\d+\.\d+\.\d+\.\d+\//, why: 'the hub card address shape carrying the 64-hex CEDS hub id.' },
};

const report = (value) => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const ran = spawnSync('sqlite3', [STANDARDS_STORE], {
	encoding: 'utf8',
	input: `SELECT text FROM blocks WHERE subject = '${BASE_BLOCK_SUBJECT}';`,
	maxBuffer: 1024 * 1024 * 1024,
});

if (ran.status !== 0 || ran.error) {
	report({ probe: moduleName, verdict: 'REFUSED', reason: `sqlite3 exit ${ran.status}: ${ran.error ? ran.error.message : ran.stderr}` });
	process.exitCode = 1;
} else {
	const patternNameList = Object.keys(CEDS_IDENTIFIER_PATTERN_REGISTRY);
	const resultByPlugin = {};
	Object.keys(ALLOW_LIST_BY_PLUGIN).forEach((onePluginName) => {
		resultByPlugin[onePluginName] = {
			subjectLabel: ALLOW_LIST_BY_PLUGIN[onePluginName].label,
			allowListedSubjectPropertyNames: ALLOW_LIST_BY_PLUGIN[onePluginName].nameList,
			nodesScanned: 0,
			valuesScanned: 0,
			valuesPresentByName: {},
			HIT_LIST: [],
			hitCountByPattern: {},
		};
	});

	let rowsParsed = 0;
	ran.stdout.split('\n').forEach((oneLine) => {
		if (oneLine.indexOf('"stableId"') === -1) {
			return;
		}
		let parsed = null;
		try {
			parsed = JSON.parse(oneLine);
		} catch (parseError) {
			return;
		}
		const properties = (parsed && parsed.properties) || {};
		// stableId is a ROW-LEVEL key, not a member of `properties` — DUMPED, not assumed.
		const stableId = typeof parsed.stableId === 'string' ? parsed.stableId : properties.stableId;
		if (typeof stableId !== 'string') {
			return;
		}
		rowsParsed += 1;
		const labelList = Array.isArray(parsed.labels) ? parsed.labels : [];

		Object.keys(ALLOW_LIST_BY_PLUGIN).forEach((onePluginName) => {
			const pluginRow = ALLOW_LIST_BY_PLUGIN[onePluginName];
			if (labelList.indexOf(pluginRow.label) === -1) {
				return;
			}
			const resultRow = resultByPlugin[onePluginName];
			resultRow.nodesScanned += 1;
			pluginRow.nameList.forEach((oneName) => {
				const rawValue = properties[oneName];
				// Block properties may be scalars OR one-element arrays (the shaping wraps them). Both are
				// flattened here — a value hiding inside an array is still a value the renderer would print.
				const valueList = Array.isArray(rawValue) ? rawValue : [rawValue];
				valueList.forEach((oneValue) => {
					if (oneValue === null || oneValue === undefined || oneValue === '') {
						return;
					}
					const valueText = `${oneValue}`;
					resultRow.valuesScanned += 1;
					resultRow.valuesPresentByName[oneName] = (resultRow.valuesPresentByName[oneName] || 0) + 1;
					patternNameList.forEach((onePatternName) => {
						if (CEDS_IDENTIFIER_PATTERN_REGISTRY[onePatternName].pattern.test(valueText)) {
							resultRow.hitCountByPattern[onePatternName] = (resultRow.hitCountByPattern[onePatternName] || 0) + 1;
							if (resultRow.HIT_LIST.length < 20) {
								resultRow.HIT_LIST.push({ stableId, propertyName: oneName, patternName: onePatternName, valueExcerpt: valueText.slice(0, 160) });
							}
						}
					});
				});
			});
		});
	});

	const totalHits = Object.keys(resultByPlugin).reduce((accumulator, oneName) => accumulator + resultByPlugin[oneName].HIT_LIST.length, 0);
	const totalValuesScanned = Object.keys(resultByPlugin).reduce((accumulator, oneName) => accumulator + resultByPlugin[oneName].valuesScanned, 0);
	const everyPluginSawNodes = Object.keys(resultByPlugin).every((oneName) => resultByPlugin[oneName].nodesScanned > 0);

	// AN EMPTY HIT LIST FROM A SCAN THAT EXAMINED NOTHING IS NOT A PASS. The value count is reported
	// beside the hit count for the same reason an assertion count is reported beside a failure count.
	const measurable = rowsParsed > 0 && everyPluginSawNodes && totalValuesScanned > 0;

	report({
		probe: moduleName,
		gate: 'ID-GATE — can a CEDS identifier reach the text a judge is shown for a PESC subject?',
		measuredAgainst: { standardsStore: STANDARDS_STORE, baseBlockNodeRowsParsed: rowsParsed },
		WHAT_WAS_SCANNED:
			'The declared renderingAllowList SUBJECT property values on the real subject nodes in the frozen base block. THE RENDERED PROMPT BODIES ARE NOT RETAINED — the decision record carries only judge.promptHash — so the prompt inputs are scanned rather than the prompts. If no allow-listed value contains a CEDS identifier, no prompt composed from those values can contain one.',
		WHAT_THIS_DOES_NOT_PROVE:
			'That the RENDERER adds nothing of its own. This gate covers the INPUTS. The renderer is framework code under its own gate, and closing that gap here would require retained prompt bodies, which do not exist. Stated rather than implied.',
		patternRegistry: patternNameList.map((oneName) => ({ name: oneName, pattern: String(CEDS_IDENTIFIER_PATTERN_REGISTRY[oneName].pattern), why: CEDS_IDENTIFIER_PATTERN_REGISTRY[oneName].why })),
		...resultByPlugin,
		totalValuesScanned,
		totalHits,
		VERDICT: !measurable
			? 'REFUSED — NOT A CLEAN NEGATIVE. The scan examined zero nodes or zero values for at least one plugin, so an empty hit list means the scan did not run, NOT that nothing is there. Fix the reader before reporting a pass.'
			: totalHits === 0
				? `PASS — ZERO CEDS IDENTIFIERS in ${totalValuesScanned} allow-listed subject values across both plugins. The judge cannot have matched on an identifier it was never shown, for the inputs this gate covers.`
				: `HIT — ${totalHits} allow-listed subject value(s) contain something matching a CEDS identifier pattern. THIS IS A REAL FINDING, not a false positive to be waved off: P0 measured crossRefs EMPTY on every PESC node on both labels, so PESC is not supposed to carry a CEDS identifier anywhere. READ THE ACTUAL MATCHING SUBSTRINGS in HIT_LIST before concluding — a short-acronym pattern can match innocent prose, and a count is not a finding until the matched text has been read.`,
	});
	process.exitCode = measurable && totalHits === 0 ? 0 : 1;
}
