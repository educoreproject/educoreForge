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
                  database, no decision store, no LLM, no Voyage. Per pair+generation it reports:
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
                           Where FROZEN inferred-decision blocks are read (a plain build MATERIALIZES
                           them) and written (--rebridge FREEZES a new one). OPTIONAL: it DEFAULTS to a
                           sibling of --standardsDatabaseFilePath ('<name>.decisions<ext>' in the same
                           directory). Pass it to point a build at a canonical decisions database.
     --judgmentCacheFilePath=<path> | --judgmentCacheFilePath=false
                           Where the shared JUDGMENT CACHE lives — every per-source LLM judgment a
                           --rebridge buys is written there THE MOMENT IT IS DECIDED (decided =
                           persisted), keyed (promptHash, model, rendererVersion), so a killed run
                           resumes free and a decided judgment can never be lost with the process.
                           OPTIONAL, ON BY DEFAULT at the canonical dataStores home
                           (system/dataStores/judgmentCache/judgmentCache.sqlite3). Pass a path to
                           redirect it (e.g. a throwaway for a spend test), or 'false' to disable.
     --matchForensicsDirPath=<path> | --matchForensicsDirPath=false
                           Where the FORENSIC MATCH LOG lives — one JSONL record per judgment
                           (live, cache-hit, and dedupe fan-out alike), organized by standard as
                           <dir>/<pairKey>/<generation>.jsonl. OPTIONAL, ON BY DEFAULT at
                           system/dataStores/matchForensics. Pass a path to redirect, or 'false'
                           to disable. A forensics write failure never kills a build (logged loudly
                           and the run continues); the judgment cache is the gate, this is the
                           testimony.
     --rebridge=all | --rebridge=<token>[,<token>...]
                           SCOPE the semantic re-inference. OPTIONAL, DEFAULTS TO NONE: a plain build
                           MATERIALIZES whatever frozen decision blocks already exist (zero LLM, zero
                           Voyage). --rebridge RUNS the inference pre-pass for the named source tokens
                           (or every pair with 'all'), FREEZES the result to the decision store, and
                           materializes it. This is the only mode that spends reranker/embedding credit
                           for inference.
     --vectorize=true|false
                           Whether -build spends real Voyage embedding credit. OPTIONAL, and it
                           DEFAULTS TO true -- the normal gold build vectorizes. Pass
                           --vectorize=false to rehearse a build without spending (the graph is
                           forged and materialized with no embeddings). Only the exact strings
                           'true' and 'false' are accepted; 'yes'/'no'/'1'/'0' are NOT synonyms
                           and are refused by name rather than guessed at.
     --embeddingCacheFilePath=<path>
                           REDIRECT the shared vector cache for this build. OPTIONAL. The standing
                           policy is that forging uses the ONE content-addressed vector cache in
                           dataStores, ON by default -- so a build that omits this shares that cache
                           and pays Voyage only for texts never embedded before (under this model).
                           Name a path to point the build at a DIFFERENT cache, e.g. a throwaway one
                           so a test keeps spending real credit instead of being served free from the
                           warm production cache.
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
     -verbose              Emit verbose diagnostic detail on stderr.
     -quiet                Suppress progress; results and errors only.

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

EXIT STATUS
     0    the requested action succeeded (a -validate verdict of valid, a completed build)
     1    the recipe was rejected, a required parameter was missing, or the build failed
`;
		return { helpText };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
