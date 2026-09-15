'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// selectCandidateSchema.js — THE select_candidate SCHEMA, DERIVED ONCE AND RENDERED PER DIALECT.
// judgeProviderRegistry JOB 2, 2026-09-07.
//
// ⟪THE PROBLEM THIS SOLVES, AND WHY IT IS NOT COSMETIC⟫ Every judge provider must impose the SAME
// constraint — the model may answer only with a candidate number or NONE, and only with one of the
// contract's confidence categories — but each expresses it in a DIFFERENT dialect. Anthropic forces a
// tool call: `tools: [{name, description, input_schema}]` plus `tool_choice`. Ollama constrains
// generation with `format: <a JSON schema>` and has no tool call at all. If each provider wrote its own
// schema, N providers would hold N restatements of SELECT_CATEGORY_ENUM.
//
// A DRIFTED ENUM FAILS SILENTLY. That is the whole argument. Nothing throws and nothing logs: a provider
// whose enum lost 'weakButReal' simply never emits it, and the judgments quietly stop being able to
// express a category the contract still defines. It would look like a change in the model's behaviour,
// not a bug in ours. The project already solved this one level down — llmClient's CATEGORY_ENUM derives
// from SELECT_CATEGORY_ENUM rather than restating it (boundary review, 2026-07-30) — and this module does
// the same thing one level up, for the whole schema rather than for one field.
//
// WHAT IS DERIVED ONCE AND WHAT IS PER-CALL. Everything that comes from the contract — the category enum,
// the required list, the tool name, every description string — is computed at MODULE LOAD, once. The one
// thing that cannot be is `choiceEnum`: it is the list of candidate numbers for ONE subject and differs on
// every judgment. So the invariant half is built once and the per-subject half is woven in per call. v2's
// "built once at client construction" is satisfied in the only way a per-call enum permits.
//
// SAME-DIRECTORY REQUIRE ONLY. This file requires ./evidenceContracts and nothing else. bridge-maker/lib
// is a FINGERPRINTED directory (decisionBlock.js:69) whose contents are content-addressed into a decision
// block, so a require reaching outside the fingerprint tree would put schema logic where a change to it
// does not move the fingerprint. evidenceContracts.js is standalone data with zero requires of its own
// (verified by JOB 0 and JOB 1), so this dependency is free of construction-time side effects.
//
// NO CLOCK, NO RANDOMNESS. BG-DET conjunct (a) (lib/bridge-framework/test/test-bgReplay.js:776) refuses
// Date.now, new Date, Math.random, process.hrtime and crypto.randomBytes anywhere in bridge-maker/lib,
// for the fingerprint reason above. This module is a pure function of its inputs and needs none of them.
//
// REFUSALS THROW, because every fault this module can have is a CONSTRUCTION fault — an unknown dialect
// or an absent choiceEnum is a programming error at wiring time, not an operational condition that a
// judgment could recover from. Operational faults still travel by callback, in the providers. There is no
// try/catch here and no async: the module is synchronous and pure.
//
// @concept: [[SelectCandidateSchema]]

// SELECT_CATEGORY_ENUM — the SINGLE SOURCE OF TRUTH for the discrete verdict category (evidenceContracts.js
// §5, ⟪A4⟫). This module exists to make sure it stays single.
const { SELECT_CATEGORY_ENUM } = require('./evidenceContracts');

// SELECT_CANDIDATE_TOOL_NAME — the tool's name, held HERE rather than in a provider. llmClient reads it
// from this module instead of declaring its own copy: the name appears on the wire (the tool definition
// and tool_choice) AND in extraction (finding the tool_use block by name), so two spellings of it would
// mean a client that could send a tool it cannot then read back.
const SELECT_CANDIDATE_TOOL_NAME = 'select_candidate';

// ABSTAIN_CATEGORY_NAME — the contract's abstain category, held as the ONE literal in this module so the
// filter below and the description strings cannot spell it two ways.
const ABSTAIN_CATEGORY_NAME = 'none';

// PICK_CATEGORY_ENUM — the categories a PICK may carry. Derived from the contract enum by removing the
// abstain category, never restated. A pick asserts a confidence about a candidate; 'none' is not a
// confidence, so judgeComponent.js refuses a pick that carries it. Filtering at the derivation site means
// the contract gaining or renaming a category cannot silently drift away from what any provider accepts.
const PICK_CATEGORY_ENUM = Object.freeze(
	SELECT_CATEGORY_ENUM.filter((oneCategory) => oneCategory !== ABSTAIN_CATEGORY_NAME),
);

// OFFERED_CATEGORY_ENUM — what the schema OFFERS THE MODEL: the FULL contract enum, abstain category
// included, in contract order.
//
// ⟪2026-09-10, OCEAN_SUMMIT, TQ-authorised⟫ Until this date the schema offered only PICK_CATEGORY_ENUM, on
// the argument that a confidence category is a statement about a pick and an abstention has no pick. The
// argument was sound; its consequence was measured to be a defect. `required` names category
// unconditionally (JOB 0), so an honest abstention could satisfy the schema only by FABRICATING a
// confidence, and the description told the model to omit it — a contract no answer could meet. Measured
// from the forensics trails: on the 2026-08-17 Anthropic run (category then optional) 90 of 173 real
// abstention calls were retried on "missing category", 58 to the six-call ceiling, roughly 354 wasted
// invocations — about a third of every call made; on the JOB 7 Ollama slice (format-constrained) there
// were zero retries but 8 of 8 abstentions carried a forced 'moderate'. Offering 'none' lets an abstention
// satisfy `required` truthfully on both dialects. The pick-only set above is UNCHANGED and still governs
// what a pick may carry; judgeComponent normalises (NONE, none) to reportedCategoryOnAbstain null, which
// it already accepted, and refuses a pick carrying 'none', which it already did.
const OFFERED_CATEGORY_ENUM = Object.freeze(SELECT_CATEGORY_ENUM.slice());

// JUDGMENT_REQUIRED_FIELD_LIST — what a judgment must contain, in one greppable place. JOB 0 named and
// froze this constant when it retired the scalar variant, whose whole defect was that a SECOND, weaker
// required-list existed and was the default. It moves here with the schema, so the list and the properties
// it names are declared together rather than a directory apart.
// ⟪v3⟫ sortedCandidateList is REQUIRED. An optional field is one the model may skip under pressure, and the
// whole point of the v3 prompt is that the ranking happens before the choice; an unfilled ranking would mean the
// procedure was skipped and we would not be able to tell.
const JUDGMENT_REQUIRED_FIELD_LIST = Object.freeze(['choice', 'category', 'rationale', 'sourceElementIdeaList', 'candidateIdeaList', 'sortedCandidateList', 'ideaCoverage']);

// categoryProse — renders a category list as English for a description string: "strong, moderate, or
// weakButReal". DERIVED for the same reason the enum is. The prose in a description is not decoration —
// it is what the model actually reads, and a description naming three categories beside an enum offering
// four is a contradiction the model must resolve on its own. Before JOB 2 this sentence was a hard-coded
// literal in llmClient.js (:318) and was the last hard-coded category string in any provider file.
const categoryProse = (categoryList) => {
	if (categoryList.length === 1) {
		return categoryList[0];
	}
	if (categoryList.length === 2) {
		return `${categoryList[0]} or ${categoryList[1]}`;
	}
	return `${categoryList.slice(0, -1).join(', ')}, or ${categoryList[categoryList.length - 1]}`;
};

// The three description strings, built ONCE at module load from the contract. Their wording is BYTE-FOR-
// BYTE what llmClient emitted before JOB 2 (gate G2-a pins it to a pre-edit capture); only their SOURCE
// changed, from a literal in a provider to a derivation from the contract.
const TOOL_DESCRIPTION =
	'FIRST record sourceElementIdeaList: the distinct ideas the SOURCE ELEMENT refers to. ' +
	'THEN record candidateIdeaList: the same for every candidate. ' +
	'THEN record sortedCandidateList: every CANDIDATE INDEX NUMBER ordered from closest in meaning to furthest. ' +
	'THEN record ideaCoverage for the candidate you are about to choose: which SOURCE ELEMENT nouns it covers and which it misses. ' +
	'THEN record the single best matching CEDS candidate by its number, or NONE if no candidate is a ' +
	'correct match. You MUST ALSO record a discrete confidence CATEGORY (never a numeric ' +
	'probability) and a short RATIONALE — both are REQUIRED on every answer. When choice is NONE, ' +
	`category MUST be ${ABSTAIN_CATEGORY_NAME}: an abstention carries no confidence about any candidate.`;
const CHOICE_DESCRIPTION = 'The chosen candidate number, or the string NONE.';
const CATEGORY_DESCRIPTION =
	`A discrete confidence category for the choice — ${categoryProse(PICK_CATEGORY_ENUM)} for a pick, ` +
	'reflecting how strongly the evidence supports it, never a numeric probability — ' +
	`or exactly ${ABSTAIN_CATEGORY_NAME} when choice is NONE. Always required.`;
const RATIONALE_DESCRIPTION = 'A short rationale (one or two sentences) explaining the choice.';
// ⟪v3, 2026-09-11⟫ SORTED_CANDIDATE_LIST_DESCRIPTION — the judge is now asked to SORT every candidate by semantic
// closeness before choosing, and a procedure with nowhere to put its working is a procedure the model performs
// invisibly or not at all. This field gives the sort a home, and three things follow from it being DECLARED
// rather than described in prose: the model must actually produce the ranking, the ranking is RECORDED on every
// judgment, and a later study of retrieval can ask "was the correct card ranked second or fourteenth?" — the
// question that separates a judgment failure from a retrieval failure, which nothing in this system can
// currently answer.
// ⟪v5, 2026-09-11 — TQ's idea⟫ SOURCE_ELEMENT_IDEA_LIST_DESCRIPTION. TQ, on why candidate 5 beats candidate 14
// for ApplicantProfile.Telephone: "it references not one but two ideas that are part of the source element, ie,
// telephone and person. The chosen one only references one of those."
//
// That is a COVERAGE test, and it fits the shape of the data exactly. A CEDS card is always TWO ideas — a domain
// and a property. An Ed-Fi element is also more than one — the construct that owns it, the element itself, and
// whatever its description names. `Person :: Has Telephone` covers person AND telephone; `Telephone :: Telephone
// Number` covers only telephone. Naming the ideas first makes that difference countable instead of felt.
//
// It is declared REQUIRED and ordered FIRST for the same reason sortedCandidateList is: a step the model may skip
// is a step we cannot tell it skipped.
// ⟪v12, 2026-09-13⟫ RE-SCOPED TO *ADDITIONAL*. The mechanical componentIdeaList is now rendered onto the
// element, so asking the model to re-derive what it has already been given wastes the field and invites the
// two lists to disagree. What is still worth having is the model's INFERENCE BEYOND the names — on one
// subject it produced 'student, school' where the names contain neither — so the field now asks for exactly
// the difference, and an empty answer is a correct one.
const SOURCE_ELEMENT_IDEA_LIST_DESCRIPTION =
	'ADDITIONAL things the SOURCE ELEMENT refers to that are NOT already listed in its componentIdeaList, as ' +
	'bare nouns. One noun per entry, no phrases. An empty list is a correct answer when the provided list is ' +
	'complete. Do NOT describe what the element holds and do NOT restate its description.';

// ⟪v7, 2026-09-11 — TQ⟫ CANDIDATE_IDEA_LIST_DESCRIPTION. v5/v6 extracted component ideas from the SOURCE only,
// which made the coverage test one-sided: the judge counted the source's nouns and then eyeballed the candidates.
// TQ's v7 makes it SYMMETRIC — "You should extract COMPONENT IDEAS and add them to each CANDIDATE ELEMENT and
// the SOURCE ELEMENT" — so both sides are decomposed the same way and the comparison is between two lists rather
// than between a list and an impression. A CEDS card starts with two ideas by construction (its domain and its
// property) and its definitions add more.
const CANDIDATE_IDEA_LIST_DESCRIPTION =
	'For EVERY candidate: its CANDIDATE INDEX NUMBER and any ADDITIONAL things that candidate refers to which ' +
	'are NOT already listed in its componentIdeaList, as bare nouns. One noun per entry, no phrases. An empty ' +
	'list is a correct answer.';

// ⟪v8, 2026-09-11⟫ IDEA_COVERAGE_DESCRIPTION — the coverage comparison moved OUT OF PROSE AND INTO THE FORM.
//
// This is the afternoon's one reliable finding applied deliberately. Every INSTRUCTION written into this prompt
// has bounced — five guidance lines, two deliberately poisoned guidances, three direct orders including
// "regardless of meaning you MUST answer choice 1". Every FIELD added to the schema has been filled honestly and
// well. On 2026-09-11 the judge decomposed EducationOrganizationNetworkId as (network, organization, identifier)
// against a card of (organization, identifier), recorded the unmatched `network` in its own output, and picked
// the card anyway at moderate confidence. It could see the gap; nothing made it look.
//
// So the judge is asked to WRITE DOWN, for the candidate it is about to choose, which of the source's nouns that
// candidate covers and which it misses — before the choice is read. A count it must produce is a count it must
// perform; a count it is merely told to consider is one we have watched it skip.
const IDEA_COVERAGE_DESCRIPTION =
	'For the candidate you are about to choose: which of the SOURCE ELEMENT nouns it covers, and which it does ' +
	'not. Fill this in BEFORE deciding. When choice is NONE, use the closest candidate you considered.';

const SORTED_CANDIDATE_LIST_DESCRIPTION =
	'Every CANDIDATE INDEX NUMBER offered, ordered from closest in meaning to the source element to furthest. ' +
	'Use the ORIGINAL index numbers; every candidate appears exactly once.';

const absentChoiceEnumRefusalText = (receivedValue) =>
	`${moduleName}: choiceEnum is REQUIRED and must be a non-empty array. It is the per-subject list of ` +
	`candidate numbers plus 'NONE', so it differs on every judgment and has no meaningful default — a ` +
	`schema built without it would constrain the model to nothing at all. Refused by name rather than ` +
	`defaulted. (received ${JSON.stringify(receivedValue)})`;

const unknownDialectRefusalText = (receivedDialectName, knownDialectNameList) =>
	`${moduleName}: '${receivedDialectName}' is not a select_candidate schema dialect this module knows. ` +
	`The known dialects are: ${knownDialectNameList.join(', ')}. A dialect is added by adding a row to ` +
	`SCHEMA_DIALECT_REGISTRY, never by a caller rendering the schema itself — that is what keeps the ` +
	`category enum single-sourced. Refused by name, never rendered as the incumbent's dialect.`;

// buildCanonicalSelectCandidateSchema — THE canonical, dialect-free description of what a judgment may
// say. Everything a renderer needs and nothing about how any provider transports it.
//
// KEY ORDER IS LOAD-BEARING HERE. Gate G2-a compares the Anthropic rendering byte-for-byte against a
// capture taken before JOB 2, and JSON.stringify preserves insertion order, so the property order below
// is the pre-edit order and must stay that way. That is not fussiness: the tool DESCRIPTION is part of
// what the model reads, and JOB 0 learned that a description string is exactly the thing that drifts
// unnoticed — so the whole object is pinned, not merely its enum.
const buildCanonicalSelectCandidateSchema = ({ choiceEnum } = {}) => {
	if (!Array.isArray(choiceEnum) || choiceEnum.length === 0) {
		throw new Error(absentChoiceEnumRefusalText(choiceEnum));
	}
	return Object.freeze({
		toolName: SELECT_CANDIDATE_TOOL_NAME,
		toolDescription: TOOL_DESCRIPTION,
		jsonSchema: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				choice: Object.freeze({
					type: 'string',
					// ⟪JOB 3, 2026-09-07 — THE ONE-LINE FIX COBALT_ANCHOR's STAND-DOWN ASKED FOR⟫ slice() then
					// freeze. Object.freeze is SHALLOW, and this was the one enum that arrives per call: writing
					// `enum: choiceEnum` stored THE CALLER'S OWN ARRAY by reference, so a caller that kept its
					// reference could mutate a schema this module calls frozen, after construction, silently.
					// category.enum never had the hole because it is OFFERED_CATEGORY_ENUM, frozen at module load.
					// BOTH halves are load-bearing: slice() severs the shared reference (freezing the caller's
					// own array in place would be a worse bug — this module would be freezing an object it does
					// not own), and freeze stops anything downstream mutating the copy. It moves NO BYTES:
					// JSON.stringify renders a frozen copy identically, which gate G3-e asserts against G2-a's
					// recorded sha256 rather than leaving it as a claim.
					enum: Object.freeze(choiceEnum.slice()),
					description: CHOICE_DESCRIPTION,
				}),
				category: Object.freeze({
					type: 'string',
					enum: OFFERED_CATEGORY_ENUM,
					description: CATEGORY_DESCRIPTION,
				}),
				rationale: Object.freeze({
					type: 'string',
					description: RATIONALE_DESCRIPTION,
				}),
				sourceElementIdeaList: Object.freeze({
					type: 'array',
					items: Object.freeze({ type: 'string' }),
					description: SOURCE_ELEMENT_IDEA_LIST_DESCRIPTION,
				}),
				candidateIdeaList: Object.freeze({
					type: 'array',
					items: Object.freeze({
						type: 'object',
						properties: Object.freeze({
							candidateIndexNumber: Object.freeze({ type: 'string' }),
							ideaList: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
						}),
						required: Object.freeze(['candidateIndexNumber', 'ideaList']),
						additionalProperties: false,
					}),
					description: CANDIDATE_IDEA_LIST_DESCRIPTION,
				}),
				ideaCoverage: Object.freeze({
					type: 'object',
					properties: Object.freeze({
						candidateIndexNumber: Object.freeze({ type: 'string' }),
						sourceNounsCovered: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
						sourceNounsNotCovered: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
					}),
					required: Object.freeze(['candidateIndexNumber', 'sourceNounsCovered', 'sourceNounsNotCovered']),
					additionalProperties: false,
					description: IDEA_COVERAGE_DESCRIPTION,
				}),
				sortedCandidateList: Object.freeze({
					type: 'array',
					items: Object.freeze({ type: 'string' }),
					description: SORTED_CANDIDATE_LIST_DESCRIPTION,
				}),
			}),
			required: JUDGMENT_REQUIRED_FIELD_LIST,
			additionalProperties: false,
		}),
	});
};

// SCHEMA_DIALECT_REGISTRY — the per-provider renderings, as ORDERED DATA walked by name. No switch, no
// conditional chain: adding a provider dialect is a new row here and nothing else in this file changes.
//
// EACH ROW CARRIES BOTH DIRECTIONS, deliberately. `render` puts the canonical schema into the dialect;
// `categoryEnumOf` reads the category enum back OUT of a rendering in that dialect. They are one row
// rather than two parallel maps because two maps keyed the same way are two things that can drift, and a
// dialect with a renderer but no reader would be a dialect no gate could check. Keeping them together
// makes that unconstructible rather than merely unlikely — the same argument JOB 1 made for deriving
// `model` from `name` instead of configuring it.
const SCHEMA_DIALECT_REGISTRY = Object.freeze({
	// ANTHROPIC — a Messages API tool definition. The caller pairs it with
	// tool_choice: {type:'tool', name: SELECT_CANDIDATE_TOOL_NAME} to FORCE the call; the constraint is
	// enforced by the server, not by the prompt, which is the property the whole judge seam rests on.
	anthropic: Object.freeze({
		render: (canonicalSchema) => ({
			name: canonicalSchema.toolName,
			description: canonicalSchema.toolDescription,
			input_schema: canonicalSchema.jsonSchema,
		}),
		categoryEnumOf: (renderedSchema) => renderedSchema.input_schema.properties.category.enum,
	}),
	// OLLAMA — the value of `format` on POST /api/chat: a bare JSON schema, with no tool wrapper and no
	// tool name, because Ollama has no tool call to name. The supervisor's live probe on 2026-09-07
	// confirmed `format` CONSTRAINS the enum fields rather than merely accepting them — a prompt
	// demanding an out-of-enum value got an in-enum value back. The tool name and the tool description
	// are dropped here because the dialect has nowhere to put them, which is precisely why the canonical
	// form keeps them separate from the JSON schema rather than folded into it.
	ollama: Object.freeze({
		render: (canonicalSchema) => canonicalSchema.jsonSchema,
		categoryEnumOf: (renderedSchema) => renderedSchema.properties.category.enum,
	}),
});

const SCHEMA_DIALECT_NAME_LIST = Object.freeze(Object.keys(SCHEMA_DIALECT_REGISTRY));

const dialectRowOrRefuse = (dialectName) => {
	const dialectRow = Object.prototype.hasOwnProperty.call(SCHEMA_DIALECT_REGISTRY, dialectName)
		? SCHEMA_DIALECT_REGISTRY[dialectName]
		: null;
	if (!dialectRow) {
		throw new Error(unknownDialectRefusalText(dialectName, SCHEMA_DIALECT_NAME_LIST));
	}
	return dialectRow;
};

// renderSelectCandidateSchema — the one entry point a provider calls. It never learns which OTHER
// providers exist and no caller ever builds a schema itself.
const renderSelectCandidateSchema = (dialectName, { choiceEnum } = {}) =>
	dialectRowOrRefuse(dialectName).render(buildCanonicalSelectCandidateSchema({ choiceEnum }));

// categoryEnumOfRendering — reads the category enum back out of a rendering. This is how a gate asserts
// "every dialect offers exactly the pick-only categories" without itself knowing where any dialect puts
// them; a test that knew each dialect's shape would be a fourth place the dialects are described.
const categoryEnumOfRendering = (dialectName, renderedSchema) =>
	dialectRowOrRefuse(dialectName).categoryEnumOf(renderedSchema);

module.exports = {
	SELECT_CANDIDATE_TOOL_NAME,
	PICK_CATEGORY_ENUM,
	OFFERED_CATEGORY_ENUM,
	JUDGMENT_REQUIRED_FIELD_LIST,
	SCHEMA_DIALECT_NAME_LIST,
	buildCanonicalSelectCandidateSchema,
	renderSelectCandidateSchema,
	categoryEnumOfRendering,
	unknownDialectRefusalText,
};
