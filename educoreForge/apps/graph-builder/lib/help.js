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
     graphBuilder   -retrievalMetrics   (RETIRED: refuses by name)
     graphBuilder   -roundTripCompile --standard=<token> --containerName=<name> [--sourcePath=<path>]
                                   [--outPath=<path>] [--reportPath=<path>]
     graphBuilder   -roundTripGates --standard=<token> --containerName=<name> [--reportJsonPath=<path>]
     graphBuilder   -goldEvalCheck --buildLogDirPath=<the build's run directory>
                                   --manifestRefId=<the manifest -build printed> [--standardsDatabaseFilePath=<its store>]
                                   [--judgedBy=<toolId>[,<toolId>...]]   (COMMA-SEPARATED; one per judge present)
                                   --supersedes=<containerName>[,...]|none [--containerName=<the candidate>]
                                   [--supersedesInventoryDirectoryPath=<dir of <name>.inventory.json>]
     graphBuilder   -stampPromotion --containerName=<the PROMOTED name> --goldEvalCheckLogPath=<its saved output>
                                   --replayLogPath=<the -replay run log>  | --replayBuildLogPath=<a replay build log>
                                   --reforgeEvidencePath=<reforgeCompare -summarize output>
     graphBuilder   -spendLedger [--since=YYYY-MM-DD] [--recipe=<recipeName>] [--lifetimeLedgerFilePath=<path>]
     graphBuilder   -foldStore --sourceFilePath=<a delta or a store> --targetFilePath=<the store of record> [--apply=true]
     graphBuilder   -publishLayer --layerKey=<key> --versionTag=<tag> --sssomPath=<set.sssom.tsv>
                                   --decisionStoreFilePath=<path> --sssomValidatorPath=<sssom-py's sssom binary>
                                   [--authorIri=<edc agent IRI>] [--uriContractFilePath=<path>]
                                   [--layerDefinitionPath=<layer .json>] [--agentDefinitionPath=<agent list .json>]
     graphBuilder   -importLayer --slug=<slug> --versionTag=<tag> --authorIri=<edc agent IRI> --sssomPath=<outside.sssom.tsv>
                                   --prefixMapPath=<declared prefix map .json> --goldCapturePath=<layerPublicationCli capture>
                                   --decisionStoreFilePath=<path> --sssomValidatorPath=<sssom-py's sssom binary>
                                   --importReportPath=<report .json> [--uriContractFilePath=<path>] [--agentDefinitionPath=<path>]
     graphBuilder   -seedUriContractFromRegistryJson --layerRegistryFilePath=<recipes/layers.json>
                                   --agentRegistryFilePath=<recipes/agents.json> [--uriContractFilePath=<a NEW path>]
                                   [--standardsDatabaseFilePath=<the support store holding the decision blocks>]
     graphBuilder   -publishManifest --manifestRefId=<64 hex> --publicLabel=<TQ's label> --registrationStatus=<ISO 11179 status>
                                   [--note=<text>] [--defaultLayerByHubPath=<json>] [--uriContractFilePath=<path>]
                                   [--standardsDatabaseFilePath=<the support store holding the manifest>]
     graphBuilder   -replayOldest [--uriContractFilePath=<path>] [--live=true --exportStoreFilePath=<a NEW scratch store>]
     graphBuilder   -rebuildUriContractIndexes [--verifyOnly=true] [--uriContractFilePath=<path>]
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

                  LAYERS (lane DES, 2026-10-12). A recipe may name a standard's LAYERS:
                  "layers": [{ "standard": "ceds", "layer": "guide" }, ...]. A layer is a
                  separately published companion of the standard (for CEDS: guide = Ontology
                  Guide V14 Appendix A, textRepair = the U+FFFD repairs), declared by the kit
                  in forges/<std>/layers/<layer>/ and
                  built as its OWN block (kind 'layer', subject <std>@<v>_layer_<layer>@<lv>)
                  that requires the standard's base. A layer is produced over a base forged in
                  the same build: naming one for a REUSED base is refused by name. Each layer's
                  roundTripValidator runs in the RT-13 stage as '<std>:<layer>'.
     -validate    Validate a recipe (Layer 1 JSON Schema + Layer 2 semantic/referential).
     -replay      Regenerate a graph FROM A STORED MANIFEST -- open the manifest by refId, resolve
                  its member schema blocks, and materialize them into a fresh DEV_ graph. NO forging,
                  NO bridge runs, NO Voyage/LLM: it rebuilds exactly what a -build already wrote, so a
                  persisted manifest is a reproducibility artifact. Returns
                  { manifestId, boltUrl, memberCount }.
     -deps        List the resolvable standard tokens, versions, and hub group aliases.
     -retrievalMetrics
                  RETIRED 2026-10-06 (campaign P3, W-B-8). It read a pre-framework forensic record shape
                  that no bridge-framework judgment carries; the retrieval evidence now lives in each
                  decision record's retrievalVoteList (decision store). The verb refuses by name; its
                  code is kept in codeAttic/retrieval-metrics/.
     -roundTripGates --standard=<token>
                  RUN THE FIDELITY GATE SUITE THE STANDARD'S BUNDLE DECLARES (parserDescriptor.ini
                  roundTripVerbModule=; the switch was -cedsGates until R5 S9, 2026-10-21). A standard
                  that declares none is refused by name. Today only ceds declares one:
                  --standard=ceds runs the CEDS FIDELITY GATE SUITE -- 46 gates declared as DATA in
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

     --standard=<token>
                  REQUIRED for -roundTripCompile and -roundTripGates, no default: the standard whose
                  bundle declares the verb (e.g. ceds).

     --containerName=<name>
                  REQUIRED for -roundTripGates, no default: gates are always measured AGAINST one
                  materialized graph.

     --reportJsonPath=<path>
                  OPTIONAL for -roundTripGates: the JSON sidecar from -roundTripCompile. Omitting it
                  leaves every report-derived gate UNMEASURED, which the suite reports as a
                  failure rather than passing them by default.

     -roundTripCompile --standard=<token>
                  RUN THE ROUND-TRIP COMPILER THE STANDARD'S BUNDLE DECLARES (parserDescriptor.ini
                  roundTripVerbModule=; the switch was -cedsRoundTrip until R5 S9, 2026-10-21). A
                  standard that declares none is refused by name. Today only ceds declares one:
                  --standard=ceds MEASURES CEDS ROUND-TRIP FIDELITY -- compile a materialized CEDS graph back into
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
                           Where the support store is: the harvested schema blocks and the composed
                           manifest are written (-build) and a stored manifest and its member blocks
                           are read (-replay). Resolved from this flag, else [stores]
                           graphBuilderSupportFilePath in graphBuilder.ini; there is NO code default
                           and silence on both is refused by name. A CONFIGURED path must already
                           exist (a build never creates a store silently; --createStore=true is the
                           one opt-in). An explicit path may name a new file for this run.
     --createStore=true    The ONE run meant to start a store that does not exist yet: admits a
                           configured support store or a vector cache that is not on disk. Any value
                           other than 'true' is refused by name. Never needed for an existing store.
     --basedOnManifestRefId=<refId>
                           OPTIONAL for -build: the stored manifest this build was composed FROM,
                           recorded as the new manifest's parent (lineage). It must already be in
                           the support store; a blank value is refused by name. Omitted, the
                           manifest records that no parent was named.
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
                           OPTIONAL; when omitted it is the support store file itself (the 2026-08-04
                           single-file ruling; it was once a '<name>.decisions<ext>' sibling, no longer).
                           Pass it to point a build at a canonical decisions database.
     --buildLogsDirPath=<dir>
                           The ROOT under which this build's RUN DIRECTORY (<recipeName>_<stamp>/,
                           holding each hub's reports and the round-trip stage verdicts +
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
                           A PAIR token <source>:<hub> (e.g. --rebridge=edfi:ctdl) rebridges only that
                           pairing of a source the recipe pairs with more than one hub; the other
                           pairing materialises its frozen block untouched. A bare <source> keeps its
                           meaning (every pairing of it). A pair token that is malformed, names a hub the
                           recipe does not mint, or names no bridge of the recipe is REFUSED by name.
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
                           mappingSource 'bridge-debug' and mappingConfidence 0, every forensic record names the debug rule
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
     --embeddingCacheOnly=true|false
                           Embedding answered ONLY FROM THE VECTOR CACHE. OPTIONAL, DEFAULTS TO false.
                           With true, a batch carrying any text not in the cache is REFUSED BY NAME,
                           naming its distinct miss count, before any provider call: nothing is sent
                           to Voyage and nothing is spent (a stop, not a bill). The embedding twin of
                           --judgeCacheOnly; with --useDebugJudge it makes a run zero-spend by
                           construction. Read by the embedding client itself (lib/embedding).
     --bridgingOverlayDirPath=<absolute dir>
                           A TEST/SCRATCH SEAM, refused unless the recipe kind is dev. The directory
                           mirrors forges/<bundle>/bridges/<file>.js; each file there REPLACES the
                           tree's standard bridging file of the same path for this run's bridge
                           registry (it never adds one). For a debug run of a pairing nobody has
                           shipped (deCeds R3 P-c). Absent, the tree is read as it stands.
     --judgeCacheOnly=true|false
                           A rebridge that may answer judgments ONLY FROM THE JUDGMENT CACHE. OPTIONAL,
                           DEFAULTS TO false. With true, a cache MISS is REFUSED BY NAME ("JUDGE CACHE
                           MISS under --judgeCacheOnly=true ... refused by name, nothing spent") instead
                           of being asked of the live judge, and the run stops at the first one: use it
                           for a rebuild that is meant to cost nothing (lane REFORGE, 2026-10-08), and to
                           learn BEFORE spending whether a run would spend. PROVIDER-NEUTRAL: it wraps
                           whichever judge [judgeProvider] selects; the cache key and the judge identity
                           are that judge's own. A hit is served and re-verified exactly as without it.
                           REFUSED without an active --rebridge scope (nothing would be judged) and with
                           --useDebugJudge (the debug judge never reads the cache). Only 'true' and
                           'false' are accepted.
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
     --referenceStandardsDatabaseFilePath=<path>   --referenceDecisionStoreFilePath=<path>
     --referenceJudgmentCacheFilePath=<path>       --referenceEmbeddingCacheFilePath=<path>
                           OPTIONAL for -build (EC2/EC3, 2026-10-25). Make this build's own store of that
                           family a DELTA of a store of record, read in place and READ-ONLY: every lookup
                           asks the build's own store first and the reference second, and a write the
                           reference already holds (a hub's base block, its frozen vectors, a cached vector
                           or judgment, a decision block) is not made. The decision store and judgment
                           cache follow the standards database's reference unless named; frozen vectors
                           always do. The delta is STAMPED with its reference (table storeReferenceStamps):
                           it is never opened again without it, and opening refuses by name if the
                           reference is missing or holds fewer rows than when stamped. A delta runs without
                           FOREIGN KEYs and checks a manifest's members over itself and its reference
                           instead (ruling F). Refused: a blank value; a reference that does not exist; a
                           reference for a disabled family; a reference for a store that came from [stores]
                           config (the store of record is never a delta). A new delta vector cache still
                           needs --createStore=true. --embeddingCacheOnly and --judgeCacheOnly are exactly
                           as strict: a miss is a miss in BOTH layers. One difference from a clone: another
                           process may fold rows INTO the reference during the build, so a cache-only run
                           can hit a row that a frozen copy would have refused; the row is the same
                           content-addressed, first-written row either way. Return the delta's rows with
                           -foldStore. A delta is NEVER certified or promoted: -goldEvalCheck refuses a
                           --standardsDatabaseFilePath that is a delta, and -stampPromotion refuses goldEvalCheck
                           evidence that certified one, both by name (golds come only from a store of record or
                           a folded store; BRONZE_CROWN, 2026-10-25).
     --embeddingCacheFilePath=<path> | --embeddingCacheFilePath=false
                           Where the content-addressed VECTOR CACHE (textHash x model -> embedding)
                           is read and written for this build. OPTIONAL. WHEN OMITTED it is [stores]
                           vectorCacheFilePath in graphBuilder.ini: the ONE shared, warm cache every
                           build and standard feeds (W-C-11, 2026-10-06; an absent key is refused by
                           name). The file must EXIST, flag or config: a new cache is a COLD cache and
                           a from-scratch build pays Voyage for every text, so a deliberate new cache
                           (a throwaway for a spend test) also passes --createStore=true. 'false'
                           disables the cache (parsed once, by the orchestrator, into the boolean the
                           embedder obeys; it used to create a file named 'false').
     --containerName=<name>
                           Which MATERIALIZED graph to compile back into RDF/XML. REQUIRED for
                           -roundTripCompile; there is NO default -- a fidelity measurement is always
                           OF one graph, and "whichever graph happens to be running" is exactly the
                           question a default would answer wrongly. The bolt port and the neo4j
                           credential are READ FROM THE CONTAINER ('docker inspect'), never
                           restated here where they could drift from the running truth. The same
                           name replayManager gives a graph (GraphHandle.containerName) -- ONE name
                           across both boundaries.
     --sourcePath=<path>   The CEDS source ontology the emission is measured AGAINST. OPTIONAL for
                           -roundTripCompile: it DEFAULTS to the snapshot the CEDS forge bundle itself
                           reads, forges/ceds/assets/standardSourceData/01/CEDS-Ontology.rdf. A
                           source that does not exist is refused by name -- a measurement without a
                           source is not a smaller measurement, it is no measurement at all.
     --outPath=<path>      Where the compiled RDF/XML is written. OPTIONAL for -roundTripCompile:
                           DEFAULTS to system/dataStores/cedsRoundTrip/<containerName>.emitted.rdf.
                           The emission is kept, not thrown away, so a reported number can always
                           be traced back to the exact document that produced it.
     --reportPath=<path>   Where the readable report is written. OPTIONAL for -roundTripCompile:
                           DEFAULTS to system/dataStores/cedsRoundTrip/<containerName>.roundTrip.txt.
                           The JSON SIDECAR is written beside it with the same stem and a .json
                           extension. The report text and the sidecar are rendered from the SAME
                           report object and never recompute anything, so the two can never
                           disagree about a number.
     -verbose              Emit verbose diagnostic detail on stderr.
     -quiet                Suppress progress; results and errors only.

     -foldStore --sourceFilePath=<path> --targetFilePath=<path> [--apply=true]
                  Return a store's novel rows to the store of record (EC3). READS both, and WITHOUT
                  --apply=true WRITES NOTHING: it prints, per table (blocks, manifests, manifestBlocks,
                  vectors, decisionBlocks, judgmentCacheEntries, judgmentFillingSpend,
                  vectorCacheEntries), the source rows, the target's rows, how many the target lacks
                  (MISSING), how many it holds, and CONFLICTS: the same content address with a different
                  payload, and a decision block for a pair the target holds a block for that is not
                  provably older (the latest block for a pair wins, so order is content). With
                  --apply=true it writes ONLY the target, in ONE transaction: INSERT OR IGNORE of the
                  missing rows in the source's order, after = before + missing checked per table, and
                  PRAGMA foreign_key_check; any failure ROLLS BACK and the target is exactly as it was.
                  REFUSED BY NAME: any conflict (a fold with a conflict is a STOP; nothing is written);
                  a missing file; the same file twice; a target that is itself a delta; a source that
                  is not a graphBuilder store; a held fold lock (/tmp/miloPersistence/
                  educoreForgeStoreFold.lock, one fold per machine). The target's tables are created by
                  their OWNING modules, never by the fold. Exit 0 a clean plan or an applied fold;
                  1 a plan with conflicts, or refused.
     -stampPromotion
                  RUN AFTER A GRAPH IS PROMOTED (renamed to its GNC-001 name). Writes the graph's REAL
                  name into GraphProvenance.graphName (the scratch name is kept as scratchGraphName) and
                  the goldEvalCheck and replay verdicts into BuildAttestation, each READ from the evidence
                  file its run wrote and tied to the graph by the manifestRefId its passport carries;
                  evidence for another manifest is REFUSED. Each row records the evidence path and its
                  sha256. Writes no content node or edge, and proves it: the content census is taken
                  before and after and any difference is refused. All four parameters are REQUIRED
                  (the replay evidence in either of its two forms).
                  THE reforgeDeterminism ROW (lane REFORGE, 2026-10-08) is read from the evidence file
                  apps/graph-builder/tools/reforgeCompare.js -summarize writes: two from-scratch builds
                  (and two replays) compared store by store and graph by graph. It is the ONE row NOT
                  refused for another manifest: the run attests the forge CODE at the head it names,
                  which a later build of that head inherits; its detail says whether this graph's
                  manifest is one the run composed, and names the run and the head.
                  THE replay ROW (lane FIX, 2026-10-09) takes EXACTLY ONE of two evidence kinds:
                    --replayLogPath       the saved output of 'graphBuilder -replay --manifestRefId=<this
                                          graph's manifest>' (about ten minutes). It must name THIS
                                          manifest, carry one 'restore conservation PASS' line and the
                                          run's result with finishXorVerified true; a -replay of another
                                          manifest, a failed replay and a missing log are each REFUSED.
                    --replayBuildLogPath  a replay BUILD log: a plain -build on store copies (about
                                          twenty-five minutes) that composes this manifest with 0
                                          judge calls; it also proves the decision blocks rebuild it.
                  Naming both is refused.
                  The bolt port and credential are read from the container ('docker inspect').

     -publishLayer
                  WRITES. Freezes one SSSOM/TSV mapping set as a version of a REGISTERED mapping layer (mappingLayers ML1-b):
                  the set passes parseSssomTsv and then the real sssom-py ('sssom validate', --sssomValidatorPath); the
                  whole set is frozen into the decision store under layerSet::<layerKey> (its sha256 IS the version's
                  content id) and split, deterministically, into one block per (subject_source, object_source) pair
                  named by the layer's standardList and hubList; the layer registry gains the version as Candidate
                  and the action prints the content id and the edc layer-version URI. IDEMPOTENT: the same bytes under
                  the same tag report alreadyPresent and write nothing new. REFUSED BY NAME: a tag already holding
                  other bytes, these bytes under another tag, an unregistered layer or author, a judge layer, a
                  curated set whose #mapping_provider is not its author, a row source the layer does not list.
                  THE REGISTRY IS uriContract's (ML3.1b): the file named by --uriContractFilePath, else [stores]
                  uriContractFilePath in graphBuilder.ini; it must EXIST (a publish never creates it). The version, every
                  block it is made of and any new agents are appended there, in one transaction, after the decision
                  store holds the blocks. A layer not yet in uriContract needs --layerDefinitionPath (a JSON object:
                  layerKey, displayName, layerKind, authorAgentIri, standardList, hubList); a definition that differs from
                  the stored layer is refused. --agentDefinitionPath is a JSON list of agents to append first (identical =
                  alreadyPresent, different under one IRI = refused). Lists no library and touches no manifest.

     -importLayer
                  WRITES. Makes an OUTSIDE SSSOM/TSV set a new version of the layer imported-<slug> (mappingLayers ML3-c):
                  the real sssom-py validates it ('sssom validate') and parses it ('sssom parse'; its row count is recorded,
                  since a dropped row does not fail validate); every row then resolves, or is REFUSED BY NAME with its own
                  reason: subject_id through the DECLARED prefix map (--prefixMapPath: { "prefixExpansion": { <prefix>:
                  <IRI> } }, never the file's own curie_map) to an EDUcore element IRI whose element the gold holds, at the
                  gold's version; object_id to a HubReference card of the gold (or sssom:NoTermFound); predicate_id to a
                  predicate lib/layer-import/importRules.json admits; record_id unique. The gold is read from a capture
                  file (layerPublicationCli -captureGold), never live. The file's EXACT bytes are frozen in the decision
                  store under layerSet::imported-<slug> (sha256 = the version id); the layer (first time) and the version
                  (Candidate) are appended to the registry. Prints accepted N, refused M; --importReportPath lists every
                  refusal with its reason. IDEMPOTENT: identical bytes report alreadyPresent. A tag holding other bytes,
                  an unregistered author and a file sssom-py rejects are refused. Creates no relationship schema block and
                  touches no graph. The registry is uriContract's and the version is appended there, as for -publishLayer
                  (the layer imported-<slug> is created by the import itself; --agentDefinitionPath adds its author).

     -seedUriContractFromRegistryJson
                  WRITES (CREATES ONE FILE). Moves the mapping-layer registry (--layerRegistryFilePath) and the agent registry
                  (--agentRegistryFilePath) into a NEW uriContract.sqlite (ML3.1 Part B): agents, every layer version with
                  every decision schema block it is made of (read from the support store, never written), every status
                  change; and the derived rows. Built under a temporary name; the registry rebuilt from the tables must
                  equal the JSON row for row and every derived row must verify, else REFUSED and the partial file is left
                  under its temporary name. Refused by name: an existing target (never written over), a field the tables
                  cannot hold, a decision block the support store lacks. The only action that creates a uriContract.

     -publishManifest
                  WRITES. Publishes a stored manifest into uriContract: its identity row (manifestRefId, --publicLabel,
                  both URIs), its ordered members, every member schema block (a member's requires must be members: the
                  closure is published whole), every frozen vector the blocks reference by embeddingRef (exactly those),
                  the node and edge counts its hermetic replay yields (recordedNodeCount / recordedEdgeCount), and its
                  first status row (--registrationStatus; the registration authority and registrar are
                  lib/uri-contract/uriContractRules.json's). A question URI answers from the manifest's own relationship
                  blocks, so defaultLayerByHub is stored as null UNLESS one subject's answer edges toward one hub come
                  from two decision schema blocks; then --defaultLayerByHubPath must pick one per subject
                  ({ <hubSegment>: { decisionBlockHashList } }), and with no such conflict it is refused. Re-publishing the
                  same manifest under the same label is alreadyPresent; a label is never reassigned. --publicLabel and
                  --registrationStatus are REQUIRED (the label is TQ's to choose). Reads the support store, never writes it.

     -replayOldest
                  READ-ONLY (but --live writes a scratch store and a DEV_ graph). THE REPLAY-THE-OLDEST DISCIPLINE (TQ: "a
                  good discipline no matter what"): the OLDEST published manifest in uriContract is replayed hermetically
                  (replay()'s own deserialize and guards, then MERGE semantics) and its node and edge counts must equal
                  the counts recorded at publish, else REFUSED: replayManager must read every block format it has ever
                  written. --live=true --exportStoreFilePath=<NEW path> also exports that manifest's blocks and frozen
                  vectors from uriContract ALONE into the new store and runs the real -replay from it into a DEV_ graph
                  (take /tmp/miloPersistence/dockerProvisionLock first; dispose of the graph with docker rm -f -v).

     -rebuildUriContractIndexes
                  WRITES (fills only). Recomputes every derived row of uriContract (the element index, the answer edges,
                  the layer-version counts) from its write-once source and REFUSES on any difference; writes the derived
                  rows of a source never indexed. It changes and removes nothing. --verifyOnly=true writes nothing.

     -spendLedger
                  WHAT THE BUILDS SPENT (spend ledger lane R1, 2026-10-21). READ-ONLY and FREE.
                  Every -build writes <its run directory>/spendLedger.json — per bridge: units asked,
                  served from cache, abstained, tokens, usd, and what the cache hits saved; per
                  embedding model: batches, texts, misses sent, tokens, usd; and the totals, with the
                  prices it used and their sources — then appends one line to the LIFETIME ledger,
                  [spendLedger].lifetimeLedgerFilePath in graphBuilder.ini. This action reads that
                  lifetime ledger and prints the spend by day, by recipe and by provider:model.
                  --since=YYYY-MM-DD   only builds started on or after that day
                  --recipe=<name>      only that recipe's builds
                  --lifetimeLedgerFilePath=<path>  read this ledger instead of the configured one
                  Prices come from [spendLedger].spendPricingFilePath (spendPricing.ini: one
                  [spendPrice_<label>] section per provider/model, each with priceSource and
                  priceAsOf). A judge or embedding call whose model has no price there is REFUSED
                  by name; a debug-judge unit is $0 with pricedBy 'debug'; a cache hit on a row
                  written before the ledger existed reports its saving as unknown and is counted.
                  -build also takes --spendPricingFilePath / --lifetimeLedgerFilePath to point a
                  build at other files (the hermetic suites point theirs at scratch).

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
                  a relationship block carrying any edge with mappingSource 'bridge-debug' — a
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
                  (judgeIdentity, rendererVersion) pairs over edges whose resolution is 'judged',
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
                  REFUSES BY NAME on: a JUDGED edge carrying no judgeIdentity (the read-side twin of
                  the write-side rule judged => judgeIdentity, since a hand-assembled or pre-rule block
                  cannot be assumed to have met the writer); a judge PRESENT but not named, listing
                  every judgeIdentity FOUND and the block it judged; a judge NAMED but not present (a
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
                  THE STANDARD-INVENTORY GATE (ctdlHub P8; lib/gold-eval-inventory.js). Runs LAST,
                  after conservation. A run whose recipe PERMITS promotion (kind 'golden'), or whose
                  recipe cannot be located, must name what it supersedes:
                  --supersedes=<containerName>[,<containerName>...] or --supersedes=none (alone).
                  The candidate is read LIVE from --containerName=<its running container>, READ-ONLY,
                  and only after its ONE GraphProvenance is shown to name --manifestRefId. Inventory =
                  the distinct _source on :DmeStandardRoot plus the HubDefinition hubNames.
                  Predecessors are read live from their running containers, or -- when
                  --supersedesInventoryDirectoryPath=<dir> is given -- every one from
                  <dir>/<containerName>.inventory.json (the gate's shape: graphName,
                  standardSourceList, hubNameList; or P0's oracleCensus shape: graphLabel,
                  nodeCountBySource, which carries NO hub list). A production graph is checked from
                  such a file; its volume is never mounted. REFUSES BY NAME listing EVERY standard and
                  EVERY hub a predecessor holds that the candidate lacks, and on any dimension a
                  predecessor file does not carry (UNMEASURED is never read as empty). What the
                  candidate ADDS is reported in the payload's inventoryGate, never refused. A recipe
                  whose kind forbids promotion is not required to name a predecessor; the payload
                  says so (inventoryGate.ran false, with the reason).

OUTPUT
     -build:    JSON { manifestId, boltUrl } on stdout (progress on stderr).
     -validate: JSON validation verdict on stdout.
     -replay:   JSON { manifestId, boltUrl, memberCount } on stdout (progress on stderr).
     -deps:     JSON discovery listing on stdout.
     -spendLedger:
                JSON { lifetimeLedgerFilePath, totals, byDay, byRecipe, byProviderModel } on stdout;
                the same spend as readable lines on stderr.
     -roundTripCompile:
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
