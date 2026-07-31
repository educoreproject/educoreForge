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
     -verbose              Emit verbose diagnostic detail on stderr.
     -quiet                Suppress progress; results and errors only.

OUTPUT
     -build:    JSON { manifestId, boltUrl } on stdout (progress on stderr).
     -validate: JSON validation verdict on stdout.
     -replay:   JSON { manifestId, boltUrl, memberCount } on stdout (progress on stderr).
     -deps:     JSON discovery listing on stdout.

EXIT STATUS
     0    the requested action succeeded (a -validate verdict of valid, a completed build)
     1    the recipe was rejected, a required parameter was missing, or the build failed
`;
		return { helpText };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
