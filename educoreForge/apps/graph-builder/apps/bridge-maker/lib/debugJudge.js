'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// debugJudge.js — the DEBUG JUDGE REGISTER and its rule modules: free, flagged stand-ins for the
// paid reranker. The sibling of lib/llmClient.js — the two are the only things in this tree that
// answer `rerank`, satisfying the identical call contract
//   rerank({ systemPrompt, userPrompt, choiceEnum, requireJudgment }, cb) -> cb('', { choice, category, rationale, ... })
// so lib.d/evidenceSelect.js cannot tell them apart at the seam. build.js selects between them at
// resolveInferenceConfig (the real-vs-stub FACTORY seam); this module is what an operator gets when
// --useDebugJudge is given.
//
// WHY THIS EXISTS. A bridging run is a long chain — walk -> compose -> ⟪A3⟫ gate -> render -> SELECT
// -> normalize -> freeze -> replay -> write — of which exactly ONE step costs money. Everything else
// is our own code, and that is where defects live. Paying Opus per element to exercise the plumbing
// is both slow and expensive, so the plumbing has historically gone unexercised: the 2026-07-31
// blind-judge defect (the judge never received the source element) was a PROMPT-CONSTRUCTION fault,
// entirely upstream of the model, and it survived a full ten-standard run costing ~25M input tokens
// before a rationale audit found it. A free judge makes that class of run repeatable at zero cost.
//
// IT IS NOT AN ATTEMPT TO APPROXIMATE OPUS. Its value is REMOVING INTELLIGENCE AS A VARIABLE: when a
// run misbehaves and the judge was a rule we wrote, the fault is definitively in the plumbing.
//
// ⟪THE REGISTER — tqii, 2026-08-10⟫. --useDebugJudge names a RULE, not a list of standards:
// `--useDebugJudge=first` (the default), `=abstain`, and later `=useOllama`. SCOPING IS NOT THIS
// FLAG'S JOB — --rebridge=std1,std2 scopes which pairs are judged, exactly as it always has, and the
// debug judge simply answers for whatever gets judged. ONE JUDGE PER RUN; tqii: "I have no intention
// of allowing different standards to use different debugging judges." The register is an EXPLICIT
// MAP (tqii: "I just don't want to see a bunch of if statements"), deliberately NOT the three-scope
// directory search the bridge-algorithm plugins use — there will be two or three judges, not twenty,
// and the whole point of this module is to be obviously inspectable. An unknown rule name is REFUSED
// BY NAME and the refusal LISTS the registered rules; there is no default fallback rule.
//
// ⟪CALLBACK-SHAPED SO AN ASYNC RULE DROPS IN — tqii, 2026-08-10: "all things should be async so make
// sure your 'first' module is async enough so it will support ollama later"⟫. The requirement is met
// by the CONTRACT, not by artificial deferral: every rule answers through a callback, so registering
// a genuinely asynchronous rule (useOllama, an HTTP call to the local server) changes nothing about
// this module's shape or any caller's code.
//
// THE RULES ANSWER SYNCHRONOUSLY AND THAT IS CORRECT HERE. An earlier draft wrapped every delivery in
// setImmediate to keep the stub from being "easier to satisfy" than a network client. tqii refused it
// as a hack and he was right: this pipeline is qtools-asynchronous-pipe-plus throughout
// (pipeRunner/taskListPlus in genericBridge), judgments are dispatched by lib/boundedRunner, and
// boundedRunner ALREADY GUARANTEES what the deferral was defending — its own header: "a fully-
// synchronous oneItem (the hermetic-test case, and any degenerate pure item) is dispatched
// ITERATIVELY — the dispatchLoopActive latch turns would-be recursion into one while loop, so 15,620
// synchronous completions never build 15,620 stack frames." The synchronous-recursion crash this
// tree really suffered (RangeError at ~680 batches, 2026-08-03, Arm A) was in the OLD vectorizer's
// taskListPlus chain at 0ebd5b8, and the fix was put in the RUNNER, where it belongs, rather than
// pushed onto every item to defend itself. Deferring here would have been a local workaround for an
// architectural guarantee that already exists.
//
// ⟪NO CACHE PARTICIPATION — THE HAZARD THIS MODULE MUST NOT CREATE⟫. The shared judgment cache is
// keyed (promptHash, model, rendererVersion) and is consulted BEFORE any API call. A debug judgment
// written into it under a real-looking model identifier would be served to a later GENUINE
// --rebridge, which would render a byte-identical prompt, hit the cache, and report a successful
// judged run that never consulted a model — silently, durably, and very hard to diagnose. tqii,
// 2026-08-10: "100%. No debug values in the cache." These modules therefore do no caching of any
// kind, and stamp a `model` identifier that could not collide with a real one even if something
// upstream tried to cache them.
//
// FLAGGING. Every answer carries decisionAlgorithm = INVALID_DEBUG, and every rationale announces
// itself as debug in its first words. These records land in the forensic match log, which is the
// evidence base for the bridge-quality evaluation; a plausible-sounding fake rationale sitting in
// that corpus is a trap someone will eventually read as real. THIS APPLIES TO useOllama TOO
// (tqii's ruling): a local model's judgments are untrusted-because-unvalidated rather than
// untrusted-because-fake, but nothing downstream should have to know the difference.
//
// EDGE FLAGGING IS BY PROPERTY, NOT BY RELATIONSHIP TYPE (tqii's disposition, 2026-08-10, after
// `labels(r)` was confirmed to refuse a relationship on this tree's Neo4j 5.26.27: a relationship
// carries a TYPE, not labels). A distinct type such as CLOSE_MATCH_INVALID_DEBUG would be indexed
// and cheap to detect, but debug edges would then stop answering MATCH ()-[:CLOSE_MATCH]->() and a
// DME mapping query would return EMPTY rather than FLAGGED — silence teaches a reader nothing.
//
// PURE (every rule registered today): no network, no filesystem, no graph, no clock, no randomness.
// Callback-shaped throughout, per the R7 house ruling. Input faults refuse BY NAME through the
// callback — the same idiom llmClient.rerank uses — never a silent default.
//
// @concept: [[DebugJudge]]

const crypto = require('crypto');

// SELECT_CATEGORY_ENUM — the SINGLE SOURCE OF TRUTH for the discrete verdict category
// (evidenceContracts.js §5, ⟪A4⟫). Required here so PICK_CATEGORIES DERIVES from the contract rather
// than restating the strings as a second, driftable literal — the same boundary-review discipline
// llmClient.js documents at its own require site.
const { SELECT_CATEGORY_ENUM } = require('./evidenceContracts');

// PICK_CATEGORIES — the categories a judge may assert ABOUT A PICK. 'none' is excluded by
// construction: abstention is expressed as choice 'NONE', never as a category on a chosen candidate
// (llmClient.js's CATEGORY_ENUM makes the identical exclusion, for the identical reason).
const PICK_CATEGORIES = Object.freeze(SELECT_CATEGORY_ENUM.filter((oneCategory) => oneCategory !== 'none'));

// THE DEBUG FLAG. Carried on every answer, and thence onto every node and edge the answer produces,
// so a debug graph is DETECTABLE rather than merely documented. Deliberately shouty; deliberately
// contains 'INVALID'.
const DEBUG_MARK = 'INVALID_DEBUG';

// DEFAULT_RULE — tqii, 2026-08-10 ("default: highest, at least for now", renamed to 'first' at his
// direction in the same exchange). Named here once; build.js reads it rather than restating it.
const DEFAULT_RULE = 'first';

// promptDigest — a stable unsigned integer from text. sha256 for determinism and standard-library
// availability, NOT for any security property; 13 hex digits stay inside the safe-integer range.
const promptDigest = (text) => {
	const hex = crypto.createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 13);
	return parseInt(hex, 16);
};

// ABSTAIN_SLOTS — how many digest buckets the 'digest' rule reserves for "no candidate". Non-zero by
// requirement: a rule that never abstains leaves the abstention path — most of the real corpus, and
// the path whose rationales exposed the 2026-07-31 defect — completely unexercised.
const ABSTAIN_SLOTS = 2;

// ---------------------------------------------------------------------
// THE RULES. Each is (poolSize, userPrompt) -> { choice, category, how } and is PURE. The asynchrony
// and the shared refusal wall live ONCE, in moduleFunction below, rather than being restated in
// every rule. Adding a rule is adding one entry to RULE_REGISTER.
// ---------------------------------------------------------------------

// 'first' — take the top-ranked candidate. Retrieval has already ordered the pool by cosine, so
// candidate 1 is the best available guess and this is the cheapest defensible answer.
// KNOWN AND ACCEPTED PROPERTY: it is DEGENERATE BY DESIGN. Every source edges to whatever retrieval
// ranked first, so any convergence or distribution measurement taken on the resulting graph is an
// artifact of THIS RULE rather than of the pipeline under test. Correct for exercising plumbing;
// wrong for anything else — use 'digest' when a varied distribution is wanted.
const ruleFirst = () => ({
	choice: '1',
	category: PICK_CATEGORIES[0],
	how: 'took candidate 1, the top of the retrieval ranking, unconditionally',
});

// 'abstain' — never pick. Exercises the abstention path, the freezer's empty-decision handling, and
// proves that a run producing no edges completes cleanly rather than being mistaken for a failure.
const ruleAbstain = () => ({
	choice: 'NONE',
	category: 'none',
	how: 'abstained unconditionally',
});

// 'digest' — a sha256 of the prompt, modulo (poolSize + ABSTAIN_SLOTS). Deterministic but VARIED, so
// downstream counts, convergence queries and the forensics lint have a non-degenerate distribution
// to work on. Category comes from an independent slice of the digest so it does not correlate with
// ordinal (a corpus where candidate 1 is always 'strong' would hand the downstream a structure that
// is an artifact of this rule). Chosen over any name-comparison rule because the judge receives ONLY
// a rendered prompt STRING and a list of ordinals — never structured source or candidate data — so a
// "smarter" rule would have to parse the renderer's output format, in a subsystem where the renderer
// version changes as a normal event (v2 -> v5 in four days).
const ruleDigest = (poolSize, userPrompt) => {
	const bucket = promptDigest(userPrompt) % (poolSize + ABSTAIN_SLOTS);
	if (bucket >= poolSize) {
		return {
			choice: 'NONE',
			category: 'none',
			how: `digest bucket ${bucket} fell in the ${ABSTAIN_SLOTS} reserved abstain buckets`,
		};
	}
	const category = PICK_CATEGORIES[promptDigest(`category:${userPrompt}`) % PICK_CATEGORIES.length];
	return {
		choice: `${bucket + 1}`,
		category,
		how: `digest bucket ${bucket} of ${poolSize + ABSTAIN_SLOTS} selected candidate ${bucket + 1}`,
	};
};

// RULE_REGISTER — THE EXPLICIT MAP. One entry per rule; no conditionals anywhere in the dispatch.
// A new rule (useOllama) is a new entry here and nothing else changes: because every rule answers
// through a CALLBACK, the register can hold a genuinely ASYNCHRONOUS rule without altering this
// module's contract or any caller's code.
const RULE_REGISTER = Object.freeze({
	first: {
		rule: ruleFirst,
		description: 'always candidate 1 (top of the retrieval ranking); degenerate by design',
	},
	abstain: {
		rule: ruleAbstain,
		description: 'never picks; exercises the abstention and empty-decision paths',
	},
	digest: {
		rule: ruleDigest,
		description: 'deterministic sha256 of the prompt; varied, non-degenerate distribution',
	},
});

const REGISTERED_RULE_NAMES = Object.freeze(Object.keys(RULE_REGISTER));

// modelIdentifierFor — what a judge reports as its `model`. Names the RULE so a forensics reader can
// tell WHICH stand-in produced a record, and carries the debug flag so it could never be mistaken
// for a real model identifier even if something upstream tried to cache it.
const modelIdentifierFor = (ruleName) => `debugJudge-${ruleName}-v1-${DEBUG_MARK}`;

// rationaleFor — self-announcing prose. EVERY rationale states, in its first words, that no
// intelligence was applied. This is the human-facing half of the flagging: the graph carries the
// decisionAlgorithm property, and the forensics carry this sentence.
const rationaleFor = ({ ruleName, poolSize, how, choice, category }) =>
	`DEBUG JUDGE (${DEBUG_MARK}) — NO INTELLIGENCE WAS APPLIED AND THIS IS NOT A JUDGMENT. ` +
	`Rule '${ruleName}' over a pool of ${poolSize}: ${how}` +
	(choice === 'NONE' ? '. ' : `, reported with category '${category}'. `) +
	`Nothing about the source element or any candidate was read, compared, or weighed. Any edge or ` +
	`abstention carrying this rationale is a plumbing artifact and must never be used as evidence of ` +
	`a mapping.`;

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ ruleName = DEFAULT_RULE } = {}) => {
		const { xLog } = process.global;

		// §6 CONFIGURATION FAULT, refused BY NAME AT CONSTRUCTION — the same discipline llmClient
		// applies to a missing key. An unknown rule must fail before a build begins, not deep inside a
		// callback after a container has been provisioned, and the refusal LISTS what is available
		// rather than leaving an operator to guess.
		if (!Object.prototype.hasOwnProperty.call(RULE_REGISTER, ruleName)) {
			throw new Error(
				`${moduleName}: unknown debug judge rule '${ruleName}'. Registered rules are: ` +
					`${REGISTERED_RULE_NAMES.join(', ')}. There is no default fallback rule — a misspelled rule ` +
					`must refuse, never silently become another rule.`,
			);
		}

		const registryEntry = RULE_REGISTER[ruleName];
		const modelIdentifier = modelIdentifierFor(ruleName);

		xLog.status(
			`[${moduleName}] DEBUG JUDGE ACTIVE, rule '${ruleName}' (${registryEntry.description}). ` +
				`Judgments are mechanical, not intelligent. Every resulting node and edge is flagged ` +
				`${DEBUG_MARK}. Model identifier: ${modelIdentifier}. Nothing is read from or written to any ` +
				`judgment cache.`,
		);

		// rerank — the contract llmClient.rerank satisfies, satisfied here without a network call.
		// Answers and refusals alike travel by callback; an asynchronous rule registered later needs no
		// change here (see the callback-shape note in this file's header).
		const rerank = ({ systemPrompt, userPrompt, choiceEnum, requireJudgment } = {}, callback) => {
			void systemPrompt; // accepted for contract parity; a rule that reads no prompt cannot read this one either.

			const refuse = (message) => {
				callback(message);
			};

			if (requireJudgment !== undefined && typeof requireJudgment !== 'boolean') {
				refuse(
					`${moduleName}.rerank: requireJudgment must be a boolean when given (got ` +
						`${JSON.stringify(requireJudgment)}) — there is no default coercion.`,
				);
				return;
			}
			if (typeof userPrompt !== 'string' || !userPrompt.length) {
				refuse(
					`${moduleName}.rerank: userPrompt must be a non-empty string — rules may digest it, and an ` +
						`absent prompt has no deterministic answer. There is no default.`,
				);
				return;
			}
			if (!Array.isArray(choiceEnum) || choiceEnum.length < 2) {
				refuse(
					`${moduleName}.rerank: choiceEnum must be an array of at least two entries (N ordinals ` +
						`plus 'NONE'), got ${JSON.stringify(choiceEnum)} — there is no default.`,
				);
				return;
			}
			// evidenceSelect composes choiceEnum as ['1'..'N','NONE'], so the pool is everything but the
			// trailing abstain token. DERIVED from that shape rather than assumed, and refused by name if
			// the shape is not what this module was built against.
			if (choiceEnum[choiceEnum.length - 1] !== 'NONE') {
				refuse(
					`${moduleName}.rerank: choiceEnum must end with 'NONE' (the abstain token), got ` +
						`${JSON.stringify(choiceEnum[choiceEnum.length - 1])} — this module derives the pool size ` +
						`from that shape and will not guess it.`,
				);
				return;
			}

			const poolSize = choiceEnum.length - 1;
			const { choice, category, how } = registryEntry.rule(poolSize, userPrompt);

			callback('', {
				choice,
				model: modelIdentifier,
				attempts: 1,
				category,
				rationale: rationaleFor({ ruleName, poolSize, how, choice, category }),
				// usage is null, NOT zero: no tokens were consumed because no request was made, and a
				// literal 0 would read in the forensics as "a call that happened to cost nothing".
				usage: null,
				stopReason: null,
				retryReasons: [],
				decisionAlgorithm: DEBUG_MARK,
			});
		};

		return { rerank, model: modelIdentifier, ruleName, keySource: 'none', decisionAlgorithm: DEBUG_MARK };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
// Static, instance-independent exports — a hermetic test exercises the REAL rules and the REAL
// constants without constructing a judge, and build.js / the flagging layer read DEBUG_MARK,
// DEFAULT_RULE and REGISTERED_RULE_NAMES from here rather than restating any of them as literals.
module.exports.RULE_REGISTER = RULE_REGISTER;
module.exports.REGISTERED_RULE_NAMES = REGISTERED_RULE_NAMES;
module.exports.DEFAULT_RULE = DEFAULT_RULE;
module.exports.DEBUG_MARK = DEBUG_MARK;
module.exports.PICK_CATEGORIES = PICK_CATEGORIES;
module.exports.ABSTAIN_SLOTS = ABSTAIN_SLOTS;
module.exports.promptDigest = promptDigest;
module.exports.modelIdentifierFor = modelIdentifierFor;

// ⟪skipAI FLAGGING HELPERS⟫ shared by every evidence bridge so the mark's spelling and the
// generation-suffix convention exist ONCE. They were briefly triplicated across the three bridges;
// three copies of a convention is three chances for it to drift, and a half-updated convention is
// worse than none. The mark travels TWO ways because a plain build has no judge to ask:
//   REBRIDGE   -> debugMarkFromLlmClient(kit): read off the injected judge, then suffixed into the
//                 frozen block's generation by generationWithDebugMark, so the block SELF-DESCRIBES.
//   MATERIALIZE -> debugMarkFromGeneration(block.generation): read back OUT of the loaded block.
// Without the second path a plain build replaying a debug block would write FAKE EDGES CARRYING NO
// FLAG — silent, because replay re-examines nothing.
module.exports.debugMarkFromLlmClient = (kit) => {
	const client = (kit && kit.inferenceConfig && kit.inferenceConfig.llmClient) || null;
	return client && client.decisionAlgorithm === DEBUG_MARK ? DEBUG_MARK : undefined;
};
module.exports.debugMarkFromGeneration = (generation) =>
	typeof generation === 'string' && generation.indexOf(DEBUG_MARK) !== -1 ? DEBUG_MARK : undefined;
module.exports.generationWithDebugMark = (generation, debugMark) =>
	debugMark ? `${generation}-${debugMark}` : generation;
