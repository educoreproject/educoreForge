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
     -deps        List the resolvable standard tokens, versions, and hub group aliases.

OPTIONS
     --recipePath=<path>   The recipe file (a build/golden recipe). Required for -build and
                           -validate. May also be given as a positional (fileList).
     --standardsDatabaseFilePath=<path>
                           Where the harvested schema blocks and the composed manifest are
                           written. REQUIRED for -build; there is NO default, deliberately --
                           a build that does not say where it writes is one edit away from
                           writing the canonical store.
     --vectorize=true|false
                           Whether -build spends real Voyage embedding credit. OPTIONAL, and it
                           DEFAULTS TO true -- the normal gold build vectorizes. Pass
                           --vectorize=false to rehearse a build without spending (the graph is
                           forged and materialized with no embeddings). Only the exact strings
                           'true' and 'false' are accepted; 'yes'/'no'/'1'/'0' are NOT synonyms
                           and are refused by name rather than guessed at.
     -verbose              Emit verbose diagnostic detail on stderr.
     -quiet                Suppress progress; results and errors only.

OUTPUT
     -build:    JSON { manifestId, boltUrl } on stdout (progress on stderr).
     -validate: JSON validation verdict on stdout.
     -deps:     JSON discovery listing on stdout.

EXIT STATUS
     0    the requested action succeeded (a -validate verdict of valid, a completed build)
     1    the recipe was rejected, a required parameter was missing, or the build failed
`;
		return { helpText };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
