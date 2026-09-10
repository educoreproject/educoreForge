'use strict';

// help.js — graphBuilder's help text.
//
// This lives in its own module because it is not decoration: THE CONTROL SURFACE IS THE
// CONTRACT. What this text promises, the app owes. It is the document the punch list is
// checked against, and drift between what it says and what the code does is a defect in
// its own right even when the code runs correctly.
//
// Keep it accurate before keeping it pretty.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		const helpText = () => `
NAME
     graphBuilder -- build any graph (up to a full golden) from a recipe, under program control

SYNOPSIS
     graphBuilder   -build    --recipePath=<path> --standardsDatabaseFilePath=<path>
     graphBuilder   -validate --recipePath=<path>
     graphBuilder   -replay   --standardsDatabaseFilePath=<path> --manifestRefId=<refId>
     graphBuilder   -deps
     graphBuilder   -retrievalMetrics --pairKey=<pairKey> [--generation=<generation>]
     graphBuilder   -cedsRoundTrip --containerName=<name> [--sourcePath=<path>]
                                   [--outPath=<path>] [--reportPath=<path>]
     graphBuilder   -cedsGates --containerName=<name> [--reportJsonPath=<path>]
     graphBuilder   -goldEvalCheck --buildLogDirPath=<the build's run directory>
                                   --manifestRefId=<the manifest -build printed> [--standardsDatabaseFilePath=<its store>]
                                   [--judgedBy=<toolId>[,<toolId>...]]   (COMMA-SEPARATED; one per judge present)
     graphBuilder   -help

     ... | graphBuilder                (JSON on stdin REPLACES command-line parameters)

DESCRIPTION
     graphBuilder is the hands-free recipe runner for the educoreForge grand recreation.
     Given a recipe it forges each standard's base graph, builds the declared hub blocks,
     runs each bridge over a materialized dependency graph, composes the manifest, and
     materializes the resulting graph -- returning the new manifest id and the bolt url.
     A golden is simply a MAXIMAL recipe; graphBuilder builds ANY graph a recipe describes.

     graphBuilder is the ONE functional app. The forger, replayManager, bridgeMaker and
     manifestEditor are in-process modules of this app, not separate programs.

     Action flags take a single hyphen; parameters take a double hyphen.

     STATUS: -build drives the REAL components (forger, replayManager, manifestEditor). It
     provisions DEV_* Docker graphs and spends embedding credit. bridgeMaker is still
     stub-bodied, so phase C records empty relationship blocks until bridging lands.

INPUT
     Parameters may be supplied as command-line flags OR as a JSON object on stdin. When
     stdin is not a terminal and carries content, it REPLACES the command-line parameters.
     The JSON mirrors the qtools-parse-command-line shape:
         { "switches": { "build": true },
           "values":   { "recipePath": ["/path/to/recipe.goldenRecipe.jsonc"] },
           "fileList":  [] }

COMMANDS
     -build       Build the graph described by the recipe. Returns { manifestId, boltUrl }.

                  THE ROUND-TRIP STAGE (RT-13). After materialization and the R-1 fidelity
                  gate, -build runs each recipe standard's DECLARED roundTripValidator (the
                  bundle declares it in parserDescriptor.ini beside entryModule -- declared,
                  not sniffed) against the finished product graph, when the recipe opts in
                  with "roundTripStage": true. The DOCUMENTED DEFAULT is false during the
                  big-bang retrofit -- and the default is never silent: every build prints the
                  stage's disposition, names each declared-ABSENT bundle, and lands the stage
                  summary (roundTrip/roundTripStageSummary.json) with the build outputs. A
                  bundle whose descriptor declares a validator that does not exist or load
                  REFUSES the build by name on EVERY build, stage on or off (RT-13.3). A
                  verdict with inventedTotal > 0 FAILS the build; lostTotal > 0 is tolerated
                  and logged (the enrichment meter). GOLD_EVAL certification requires the
                  stage to have run: see -goldEvalCheck.
     -validate    Validate a recipe (Layer 1 JSON Schema + Layer 2 semantic/referential).
     -replay      Regenerate a graph FROM A STORED MANIFEST -- open the manifest by refId, resolve
                  its member schema blocks, and materialize them into a fresh DEV_ graph. NO forging,
                  NO bridge runs, NO Voyage/LLM: it rebuilds exactly what a -build already wrote, so a
                  persisted manifest is a reproducibility artifact. Returns
                  { manifestId, boltUrl, memberCount }.
     -deps        List the resolvable standard tokens, versions, and hub group aliases.
     -retrievalMetrics
                  MEASURE how well candidate selection is working, from the forensic match log
                  a --rebridge already wrote. READ-ONLY and FREE -- no graph, no standards
                  database, no decision store, no LLM, no Voyage. It reads the record shape the
                  RETIRED semantic bridge wrote (cosine ranks, nominations); a bridge-framework
                  judgment (2026-08-16 onward) is a plain choice among a small qualified pool and
                  carries no retrieval rank, so this command does not measure it. Per
                  pair+generation it reports:
                  the WINNER RANK DISTRIBUTION (where the chosen candidate sat once the pool is
                  re-sorted by retrieval cosine -- display order is NOT rank, because the composer
                  appends nominated candidates after the cosine top-K); COSINE TOP-1 ACCURACY;
                  RECALL within the cosine cutoff; RESCUE ATTRIBUTION; the ABSTENTION LINT; and
                  POOL COMPOSITION. Prints a readable report on stdout AND writes a JSON sidecar.

                  RESCUE ATTRIBUTION REPORTS TWO SEPARATE NUMBERS AND WILL NOT CONFLATE THEM.
                  A GENUINE rescue is a winner that carried a nomination AND sat outside the
                  cosine cutoff, so the nomination is the ONLY reason it was in the pool at all.
                  "The winner merely carried a nomination" is the WEAKER claim -- cosine may well
                  have retrieved it anyway. Reporting the second as the first is the specific
                  error this verb was built to end (155 reported where the true count was 20).
     -cedsGates
                  RUN THE CEDS FIDELITY GATE SUITE -- 46 gates declared as DATA in
                  forges/ceds/gates/cedsFidelityGates.jsonc, evaluated against the named
                  container and against the round-trip report.

                  THE VERDICT IS A WORD, NEVER A PERCENTAGE. Acceptance is zero FAIL, zero
                  UNMEASURED and zero UNPROVEN. A tampered emission carrying four fabricated
                  statements still reported 71.936% fidelity -- proven live -- so no percentage
                  participates in any acceptance decision here.

                  EVERY GATE CARRIES A TWIN, a named fault injection that must turn it RED. A
                  gate whose twin has not been observed reports UNPROVEN and can never be PASS:
                  a gate never seen failing is unproven.

                  A RED SUITE DURING ENRICHMENT IS CORRECT and its redness is the work order.
                  There is deliberately no expected-to-fail state; that is masking. An
                  UNMEASURED gate means nobody supplied the measure, which is a FAILURE rather
                  than a skip -- a gate passing because it was never measured is the exact bug
                  the suite exists to prevent, and the reason is printed for each one.

                  READ-ONLY. Every measure is MATCH/RETURN, enforced mechanically before any
                  statement is issued. Exit status 0 only when the suite is ACCEPTED.

     --containerName=<name>
                  REQUIRED for -cedsGates, no default: gates are always measured AGAINST one
                  materialized graph.

     --reportJsonPath=<path>
                  OPTIONAL for -cedsGates: the JSON sidecar from -cedsRoundTrip. Omitting it
                  leaves every report-derived gate UNMEASURED, which the suite reports as a
                  failure rather than passing them by default.

     -cedsRoundTrip
                  MEASURE CEDS ROUND-TRIP FIDELITY -- compile a materialized CEDS graph back into
                  RDF/XML and diff that emission against the source ontology. The CEDS OWL source
                  describes a graph; if our graph represents it faithfully we must be able to
                  compile the graph back into the OWL, so round-trip fidelity is the acceptance
                  criterion for hub completeness and this verb is the measuring stick.

                  THE CRITERION IS SEMANTIC, NOT BYTE-IDENTICAL. Both documents are reduced to
                  canonical statement SETS -- (subject, predicate, object, literal-or-resource,
                  datatype) with prefixes expanded and literal whitespace normalized -- so
                  whitespace, element order, attribute order and prefix choice CANNOT register as
                  differences. A missing or extra STATEMENT can, and does.

                  IT READS LAYER 1 ONLY. The graph carries two layers: CEDS faithfully represented
                  (roles DmeStandardRoot / DmeClass / DmeProperty / DmeOptionSet / DmeOptionValue
                  and the edges SUBCLASS_OF, HAS_OPTION_SET, REFERENCES, HAS_VALUE), and OUR
                  matching index (HubReference / HubDefinition, addressSignature, embeddings,
                  HAS_CEDS_DOMAIN / HAS_CEDS_PROPERTY / HAS_CEDS_RANGE / IN_HUB). CEDS contains no
                  such second layer; emitting any of it would INVENT statements CEDS never made.
                  Every read names its roles explicitly and is scoped _source='CEDS'.

                  READ-ONLY AND FREE: MATCH/RETURN over bolt, no writes to any graph, no forging,
                  no LLM, no Voyage. It writes only its own three artifacts.

                  IT REPORTS LOSS, IT DOES NOT REPAIR IT. The loss is expected to be enormous. A
                  large HONEST diff is the point -- it is the baseline every future enrichment is
                  scored against, and the PER-PREDICATE LOSS TABLE is the enrichment work order.
                  INVENTED statements (emitted but absent from the source) are reported separately
                  and first, because an invention is not a coverage gap: it is an assertion about
                  CEDS that CEDS never made.

OPTIONS
     --recipePath=<path>   The recipe file (a build/golden recipe). Required for -build and
                           -validate. May also be given as a positional (fileList).
     --standardsDatabaseFilePath=<path>
                           Where the harvested schema blocks and the composed manifest are
                           written (-build) and where a stored manifest and its member blocks are
                           read (-replay). REQUIRED for both; there is NO default, deliberately --
                           a build that does not say where it writes is one edit away from
                           writing the canonical store, and a replay must say where it reads.
     --manifestRefId=<refId>
                           The stored manifest to reproduce. REQUIRED for -replay; there is NO
                           default -- there is nothing to open without it. A refId absent from the
                           manifests table, or a member block absent from the blocks table, is
                           refused BY NAME rather than materialized as a partial graph.
     --decisionStoreFilePath=<path>
                           Where FROZEN decision blocks are read (a plain build MATERIALIZES them
                           VERBATIM -- zero judge calls) and written (--rebridge FREEZES a new one).
                           Since 2026-08-16 every mapping bridge is a PLUGIN run by the shared bridge
                           framework (lib/bridge-framework, SPEC-bridgeFramework-v1): the block is
                           content-addressed, records the plugin's declared basis (a published
                           crosswalk or the standard's own text) and, per source subject, whether the
                           mapping was SPECIFIED by the source or JUDGED among candidate cards; a plain
                           build re-verifies the block's input digests, versions and plugin declaration
                           against the run before replaying it. Which block a pair uses is NOT a recipe
                           choice (the retired cacheMode/pinBlockId keys are refused by the schema).
                           OPTIONAL: it DEFAULTS to a sibling of --standardsDatabaseFilePath
                           ('<name>.decisions<ext>' in the same directory). Pass it to point a build at
                           a canonical decisions database.
     --buildLogsDirPath=<dir>
                           The ROOT under which this build's RUN DIRECTORY (<recipeName>_<stamp>/,
                           holding the CEDS hub reports and the round-trip stage verdicts +
                           certification summary) is created. OPTIONAL, DEFAULTS TO the canonical
                           home system/dataStores/buildLogs. Name a scratch root to keep a test or
                           probe build out of the canonical home (the suite does). An empty value
                           is refused by name, never corrected to the default.
     --judgmentCacheFilePath=<path> | --judgmentCacheFilePath=false
                           Where the JUDGMENT CACHE lives — every LLM judgment a --rebridge buys
                           (the judge is asked ONLY when a source subject's assertion admits MORE THAN
                           ONE candidate card; specified one-card mappings cost nothing) is written
                           there THE MOMENT IT IS DECIDED (decided = persisted), keyed (promptHash,
                           model, rendererVersion) and RE-VERIFIED on a hit, so a killed run resumes
                           free and a decided judgment can never be lost with the process.
                           OPTIONAL. WHEN OMITTED it DEFAULTS TO THE OPENED standardsDatabase FILE
                           ITSELF (--standardsDatabaseFilePath) — the single-file ruling of 2026-08-04:
                           the judgment cache lives IN the support store beside the blocks, so a FRESH
                           standardsDatabase is a COLD judgment cache. It does NOT default to
                           system/dataStores/judgmentCache/. To share the warm canonical cache, NAME
                           it: --judgmentCacheFilePath=system/dataStores/judgmentCache/judgmentCache.sqlite3.
                           Pass any other path to redirect (e.g. a throwaway for a spend test), or
                           'false' to disable.
     --matchForensicsDirPath=<path> | --matchForensicsDirPath=false
                           Where the FORENSIC MATCH LOG lives — one JSONL record per judgment
                           (live and cache-hit alike, the prompt inline), organized by pair as
                           <dir>/<pairKey>/<generation>.jsonl; the bridge framework ALSO lands there
                           a MappingReview record when two plugins on one pairing disagree about a
                           source subject, and each frozen block's SSSOM/TSV export at
                           <dir>/<pairKey>/<blockId>.sssom.tsv. OPTIONAL, ON BY DEFAULT at
                           system/dataStores/matchForensics. Pass a path to redirect, or 'false'
                           to disable — a --rebridge REFUSES to run without it (every judgment lands
                           in the trail); a plain build needs it only for the export. A forensics
                           write failure never kills a build (logged loudly and the run continues);
                           the judgment cache is the gate, this is the testimony.
     --rebridge=all | --rebridge=<token>[,<token>...]
                           SCOPE the re-judging. OPTIONAL, DEFAULTS TO NONE: a plain build MATERIALIZES
                           whatever frozen decision blocks already exist (zero LLM, zero Voyage) and
                           reports a zero-edge block with a note where none exists. --rebridge RUNS the
                           named source tokens' bridge plugins through the framework (or every pair with
                           'all'): the plugin walks its source assertions, the framework resolves each
                           against the hub's cards, asks the judge ONLY where more than one card
                           qualifies, FREEZES the result to the decision store, and materializes it.
                           This is the only mode that spends LLM credit; the framework never embeds
                           (no Voyage) and there is no reranking pre-pass.
     --useDebugJudge[=<rule>]
                           Answer this run's judgments MECHANICALLY instead of asking the real
                           reranker, so the whole bridging chain can be exercised at ZERO Opus cost.
                           OPTIONAL, DEFAULTS TO OFF (the real reranker). Bare --useDebugJudge takes
                           the register's default rule. Rules: 'first' (always candidate 1, the top of
                           the retrieval ranking -- DEGENERATE BY DESIGN, so any distribution or
                           convergence measured on the result is an artifact of the rule, not of the
                           pipeline); 'abstain' (never picks -- exercises the abstention and
                           empty-decision paths); 'digest' (a deterministic sha256 of the prompt --
                           varied and reproducible, use it when a non-degenerate spread is wanted).
                           Matched case-insensitively; an unregistered rule is REFUSED BY NAME with
                           the registered rules listed, never corrected to a default.

                           IT NAMES A RULE, NOT STANDARDS. Scoping stays with --rebridge, and one
                           judge serves the whole run. --useDebugJudge WITHOUT an active --rebridge
                           scope is REFUSED: nothing would be judged, so the flag would sit idle while
                           the run looked successful. It does NOT imply --rebridge=all.

                           EVERYTHING IT PRODUCES IS FLAGGED. The frozen block's generation carries the
                           INVALID_DEBUG suffix, every mapping edge it materializes carries
                           provenanceTier 'invalid-debug', every forensic record names the debug rule
                           as its decisionAlgorithm, and every rationale announces itself, so a debug
                           graph is detectable rather than merely documented -- askMilo can be told to
                           accept INVALID_DEBUG deliberately, and will otherwise raise an alarm; the
                           bridge framework's certification check refuses any relationship block that
                           carries such an edge. NOTHING is read from or written to the judgment cache: a debug
                           judgment banked there would later be served to a genuine --rebridge as a
                           free fake answer.

                           IT DOES NOT AFFECT VECTORIZATION. Embedding still happens per --vectorize
                           (default true), so a debug run over never-embedded text still spends Voyage
                           credit; over already-embedded text the shared cache makes it free.
     --subjectListFilePath=<absolute path>
                           THE NAMED SUBJECT SET -- judge EXACTLY the subjects named in a JSON file
                           (a flat array of stableId strings), and nothing else. Where --limit/--offset
                           are for DEBUGGING (any ten will do), this is for MEASUREMENT: the same
                           subjects, every run, so two runs produce numbers that can be compared.
                           Introduced 2026-09-10 for bridge-prompt iteration against a frozen
                           evaluation set (WORKORDER-namedSubjectSet-091026).
                           THE BLOCK IS STAMPED WITH THE LIST'S OWN sha256, not its filename:
                           generation suffix NAMED_SET_<sha256 of the canonical sorted list>. So
                           "did this run judge my set?" is answerable from the block header alone.
                           AN ABSENT ID REFUSES THE WHOLE RUN, by name, quoting the first absent
                           stableId. A measurement set that quietly shrinks produces numbers nobody
                           can compare, and the shrinkage is invisible in the only artifact anyone
                           reads -- the score.
                           CANNOT BE COMBINED with --limit/--offset: the composition has two honest
                           readings and the block header could not say which was meant. Refused by name.
                           THE RESULTING BLOCK IS PARTIAL, exactly as a windowed one is, and
                           materialise refuses to replay it under a differently-narrowed run.
     --limit=<N>  |  --offset=<N>
                           THE DEBUG WINDOW over each bridge's SOURCE SUBJECTS (the plugin's own
                           subject identity -- a source element, or a crosswalk row's subject). Both
                           OPTIONAL and both default to ABSENT (an ordinary full run). --limit=10
                           resolves only ten source subjects; --offset=50 starts at the fifty-first,
                           so a debugging session can skip around a large standard. They compose:
                           --limit=10 --offset=50 resolves subjects 51-60.
                           APPLIED AFTER any standard-specific scope, so with the SIF bridge's
                           sifObjectScope=StudentPersonal a --limit=10 means ten of THAT object's
                           fields, not ten of all 15,620.
                           THE ORDER IS SORTED BY SUBJECT KEY FIRST. A graph read (or a walk) returns
                           no guaranteed order, and an offset over an unstable order would land on
                           different subjects every run — which would make the flag useless for the
                           debugging it exists for. Sorting makes a given window reproducible.
                           ⚠ THE RESULTING DECISION BLOCK IS PARTIAL, and its generation SAYS SO
                           (…-PARTIAL_WINDOW_limit10_offset50). This matters: a block frozen from ten
                           of 214 elements is otherwise indistinguishable from a complete one, and a
                           later plain -build would MATERIALIZE those ten forever and report success —
                           silent under-coverage wearing the appearance of a finished pairing.
                           A malformed value, or a window that selects ZERO elements (an offset at or
                           past the end), is REFUSED BY NAME — never silently corrected, never judged
                           as silence. The refusal happens BEFORE forging, not after.
                           Affects BRIDGING ONLY. It does not limit forging or materialization.
     --vectorize=true|false
                           Whether -build spends real Voyage embedding credit. OPTIONAL, and it
                           DEFAULTS TO true -- the normal gold build vectorizes. Pass
                           --vectorize=false to rehearse a build without spending (the graph is
                           forged and materialized with no embeddings). Only the exact strings
                           'true' and 'false' are accepted; 'yes'/'no'/'1'/'0' are NOT synonyms
                           and are refused by name rather than guessed at.
                           WARNING -- A BLOCK ID FROM A --vectorize=false BUILD IS NOT COMPARABLE
                           TO ONE FROM A VECTORIZED BUILD. A block refId is a content address over
                           the block TEXT, and the block text CONTAINS the embeddings; so the same
                           forge over the same snapshot yields a DIFFERENT id under each flag, and
                           such an id is not a generation of the vectorized lineage. (pureLayer-
                           Fingerprint's dropped-property list is a DIFFERENT hash and is not
                           evidence about this one.) Record the build mode beside any id you
                           publish. Full account: forges/pesc260805/bridgeData/
                           buildModeIdentityRecord.json
     --embeddingCacheFilePath=<path>
                           Where the content-addressed VECTOR CACHE (textHash x model -> embedding)
                           is read and written for this build. OPTIONAL. WHEN OMITTED it DEFAULTS TO
                           THE OPENED standardsDatabase FILE ITSELF (--standardsDatabaseFilePath) —
                           the single-file ruling of 2026-08-04: the vector cache lives IN the support
                           store beside the blocks, so a FRESH standardsDatabase is a COLD cache and a
                           from-scratch build PAYS VOYAGE for every text. It does NOT default to
                           system/dataStores/vectorCache/. To share the warm canonical cache (the one
                           every prior forge run has fed), NAME it:
                           --embeddingCacheFilePath=system/dataStores/vectorCache/vectorCache.sqlite3.
                           Name any other path to point the build at a DIFFERENT cache, e.g. a
                           throwaway so a spend test keeps paying real credit instead of being served
                           free from the warm cache.
     --pairKey=<pairKey>   Which standard pairing to measure, e.g. --pairKey=CEDS::CASE. REQUIRED
                           for -retrievalMetrics; there is NO default -- a measurement is always
                           ABOUT one pairing, and there is no meaningful aggregate across pairings
                           that judge different standards.
     --generation=<generation>
                           Which frozen generation's trail to measure, e.g.
                           --generation=caseEvidenceBridge-evidence-v2. OPTIONAL for
                           -retrievalMetrics: absent, EVERY generation under the pair is measured
                           and reported. Comparing generations side by side is why they are kept
                           side by side; choosing one silently is exactly the question a default
                           would answer wrongly.
     --matchForensicsDirPath=<path>
                           Where the FORENSIC MATCH LOG is READ from -- the same directory -build
                           WRITES with --matchForensicsDirPath (the reader's parameter is named
                           for what it reads, the writer's for what it writes). OPTIONAL for
                           -retrievalMetrics: it DEFAULTS to the same documented canonical home,
                           system/dataStores/matchForensics. Unlike the writer's, this path is
                           never created -- a metrics run against a directory that does not exist
                           has nothing to measure and says so by name.
     --cosineCutoff=<n>    The cosine rank at or within which a candidate would have been
                           retrieved by cosine ALONE -- the composer's own retrieval top-K,
                           restated as an analysis parameter because the log does not record it.
                           OPTIONAL for -retrievalMetrics, DEFAULTS TO 15. It governs RECALL and
                           the GENUINE-rescue test. It does NOT move the rank histogram's bin
                           edges, which are fixed by the measurement contract so numbers stay
                           comparable across runs. Only a positive integer is accepted.
     --abstentionFlagPercent=<n>
                           The share of abstentions above which an abstention-lint phrase probe
                           becomes a FLAGGED SIGNAL. OPTIONAL for -retrievalMetrics, DEFAULTS TO 5
                           (i.e. >5%). Stated as a PERCENT on the command line.
     --sidecarDirPath=<path>
                           Where the JSON sidecar is written. OPTIONAL for -retrievalMetrics:
                           absent, each sidecar is written BESIDE the trail it measures, as
                           <pairDir>/<generation>.retrievalMetrics.json, so a stored number can
                           always be traced back to the trail and the instrument version that
                           produced it.
     --containerName=<name>
                           Which MATERIALIZED graph to compile back into RDF/XML. REQUIRED for
                           -cedsRoundTrip; there is NO default -- a fidelity measurement is always
                           OF one graph, and "whichever graph happens to be running" is exactly the
                           question a default would answer wrongly. The bolt port and the neo4j
                           credential are READ FROM THE CONTAINER ('docker inspect'), never
                           restated here where they could drift from the running truth. The same
                           name replayManager gives a graph (GraphHandle.containerName) -- ONE name
                           across both boundaries.
     --sourcePath=<path>   The CEDS source ontology the emission is measured AGAINST. OPTIONAL for
                           -cedsRoundTrip: it DEFAULTS to the snapshot the CEDS forge bundle itself
                           reads, forges/ceds/assets/standardSourceData/01/CEDS-Ontology.rdf. A
                           source that does not exist is refused by name -- a measurement without a
                           source is not a smaller measurement, it is no measurement at all.
     --outPath=<path>      Where the compiled RDF/XML is written. OPTIONAL for -cedsRoundTrip:
                           DEFAULTS to system/dataStores/cedsRoundTrip/<containerName>.emitted.rdf.
                           The emission is kept, not thrown away, so a reported number can always
                           be traced back to the exact document that produced it.
     --reportPath=<path>   Where the readable report is written. OPTIONAL for -cedsRoundTrip:
                           DEFAULTS to system/dataStores/cedsRoundTrip/<containerName>.roundTrip.txt.
                           The JSON SIDECAR is written beside it with the same stem and a .json
                           extension. The report text and the sidecar are rendered from the SAME
                           report object and never recompute anything, so the two can never
                           disagree about a number.
     -verbose              Emit verbose diagnostic detail on stderr.
     -quiet                Suppress progress; results and errors only.

     -goldEvalCheck
                  THE GOLD_EVAL CERTIFICATION GATE (doctrine RT-13.4), made runnable. Reads
                  the named build run directory's round-trip stage summary and answers PASS
                  only when the stage ran and every declared validator reported with
                  inventedTotal=0 and its verdict artifact present on disk. REFUSES BY NAME
                  when the stage was off, a verdict is missing, or invention is nonzero.
                  Declared-ABSENT bundles are tolerated during the big-bang retrofit and
                  LISTED in the output. INTENDED OPERATIONAL LAW: no DEV build is renamed
                  GOLD_EVAL_<YYMMDD> (GNC-001) without a PASS from this check on its build
                  run directory. READ-ONLY and FREE -- no graph, no docker, no database.
                  THE BRIDGE SIBLING (wired 2026-08-16, B3): the bridge framework supplies this
                  gate's sibling rule for mapping edges (lib/bridge-framework/certificationCheck.js:
                  a relationship block carrying any edge with provenanceTier 'invalid-debug' — a
                  DEBUG-JUDGE block — refuses certification by name). Pass
                  --manifestRefId=<the manifest -build printed> to run it: the manifest's
                  RELATIONSHIP member blocks are read out of the standardsDatabase (the artifact,
                  no container; the store resolves as -replay resolves it — an explicit
                  --standardsDatabaseFilePath wins over the configured support store) and every
                  edge audited. A manifest with zero relationship blocks is REPORTED
                  (mappingBlockList []), never refused.
                  ⟪CHANGED JOB 6b⟫ --manifestRefId IS NOW REQUIRED AND ITS ABSENCE REFUSES. It
                  formerly narrowed the verdict to "FORGE ROUND TRIP ONLY ... MAPPING EDGES
                  UNCERTIFIED" (scope 'forgeRoundTripOnly'), which was honest for the BRIDGE
                  sibling because a forge-only build has no mapping edges to certify. The
                  CONSERVATION audit below has no such honest partial scope — every build harvests
                  blocks — so there is nothing to narrow to and the check refuses instead.
                  THE CONSERVATION AUDIT (JOB 6b). Every member block of the manifest must carry a
                  conservation artifact reading PASS, written by -build at
                  <runDir>/conservation/<schemaBlockRefId>.json beside the round-trip verdicts.
                  The artifact is named by the block's CONTENT ADDRESS, so a rebuild that changes a
                  block leaves no artifact at the looked-up name and a stale PASS from an earlier
                  run of the same recipe cannot pass for this one; the subject rides inside the file
                  and is cross-checked against the name.
                  THE POPULATION IS THE MANIFEST, NEVER THE DIRECTORY. The audit enumerates the
                  manifest's members and demands an artifact for each. It does NOT list
                  conservation/ and check what it finds: a population read FROM the evidence cannot
                  detect its own omission, so a block that was never checked would be
                  indistinguishable from a block with nothing wrong.
                  REFUSES BY NAME on: a member with no artifact; an artifact that does not parse or
                  is not an object; an artifact whose blockRefId disagrees with the filename it sits
                  under; a member harvested under the DECLARED CONSERVATION EXEMPTION (verdict
                  EXEMPT — since JOB 5b no production caller declares it, so its presence means a
                  seam went ungated); any verdict that is neither PASS nor EXEMPT; and a manifest
                  carrying zero members.
                  THERE IS NO 'FAILED' VERDICT AND YOU SHOULD NOT GO LOOKING FOR ONE. A failed
                  conservation comparison REFUSES inside replayManager.harvest and mints no block,
                  so no manifest member can exist for it. The refusal is the enforcement; the
                  artifact is the evidence that the check RAN.
                  THE JUDGE ENUMERATION AND --judgedBy (JOB 6). The verdict ENUMERATES the distinct
                  (mappingTool, mappingToolVersion) pairs over edges whose resolution is 'judged',
                  per relationship block and in aggregate, and prints them. Promotion then requires
                  --judgedBy=<toolId>[,<toolId>...] — a COMMA-SEPARATED list naming each judge
                  present. ⚠ DO NOT REPEAT THE FLAG: a repeated --judgedBy= does NOT accumulate, the
                  parser keeps the LAST value and drops the earlier ones, and the check then refuses
                  naming a judge you did name. (Measured 2026-09-08 against the real resolver: comma
                  works, the JSON-on-stdin envelope accepts a genuine array, the repeated flag does
                  not. The failure is SAFE — a dropped judge reads as an UNNAMED judge and refuses —
                  but it is confusing, so the form is stated here.) The decision about
                  which judge is fit to promote moves from DECLARATION time to PROMOTION time and is
                  made against evidence: the gate shows you what judged the graph and makes you name
                  it back. A toolId is the provider-namespaced identity that reaches the edge --
                  anthropic:claude-opus-4-8, ollama:qwen2.5:32b@<digest12>, debug:<rule>.
                  THE POPULATION IS THE MANIFEST, exactly as it is for conservation. The judges are
                  enumerated from the blocks themselves and NEVER from the judge provider registry:
                  a population read from a registry of what you EXPECT to find cannot detect the
                  judge nobody declared, which is the one a promotion gate exists to surface.
                  REFUSES BY NAME on: a JUDGED edge carrying no mappingTool (the read-side twin of
                  the write-side rule judged => mappingTool, since a hand-assembled or pre-rule block
                  cannot be assumed to have met the writer); a judge PRESENT but not named, listing
                  every mappingTool FOUND and the block it judged; a judge NAMED but not present (a
                  stale promotion command is a defect, not a harmless surplus); and a --judgedBy
                  value that is empty or not a string, which is refused rather than dropped because a
                  dropped value lets a command appear to name a judge it does not name.
                  ZERO JUDGED EDGES IS REPORTED, NEVER REFUSED, and --judgedBy is then not required.
                  An AUTHORED-only bridge (every edge 'specified') and a forge-only manifest both
                  pass exactly as they did before. Note these are different facts: the authored-only
                  bridge proves the rule, because the gate DID audit a block, DID find edges, and
                  still demanded nothing -- which only scoping to resolution='judged' explains.
                  RETIRED JUDGE IDENTITIES are resolved through a DATED ALIAS TABLE
                  (lib/judgeIdentityAliasTable.js) so a graph judged under an older spelling
                  enumerates as ONE judge rather than several spellings of one rule. It is DATA with
                  a dated reason per row -- never a regex and never a general normaliser -- and it
                  RENAMES, never admits or excludes: an identity it does not know passes through
                  untouched and is enumerated under its own name.
                  ORDERING: the invalid-debug block refusal above fires FIRST and is untouched by
                  any of this. A debug-judge graph is refused for being debug-judged, not for how
                  its judges were named.

OUTPUT
     -build:    JSON { manifestId, boltUrl } on stdout (progress on stderr).
     -validate: JSON validation verdict on stdout.
     -replay:   JSON { manifestId, boltUrl, memberCount } on stdout (progress on stderr).
     -deps:     JSON discovery listing on stdout.
     -retrievalMetrics:
                A readable per-pair+generation report on stdout; the machine-readable metrics as
                a JSON sidecar on disk (its path announced on stderr). The report text and the
                sidecar are rendered from the SAME metrics object and never recompute anything,
                so the two can never disagree about a number.
     -cedsRoundTrip:
                The readable fidelity report on stdout AND on disk at --reportPath, its JSON
                sidecar beside it, and the compiled RDF/XML at --outPath (all three paths
                announced on stderr). The report leads with the headline (statements in source /
                emitted / matched / LOST / INVENTED), then INVENTED statements, then the
                per-predicate loss table, the per-entity-kind breakdown, and up to ten concrete
                lost statements per predicate with their subject ids.

EXIT STATUS
     0    the requested action succeeded (a -validate verdict of valid, a completed build)
     1    the recipe was rejected, a required parameter was missing, or the build failed
`;
		return { helpText };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
