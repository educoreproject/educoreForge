#!/usr/bin/env bash
# phaseD-syntheticFlow-driver.sh — work item 6, ACT 1 (FORGE) + the mapping/minting flow,
# against the CANONICAL store (the phase's sanctioned writes: p6second artifacts, groups,
# manifests). LLM-free by construction (synthetic parsers use deterministic embeddings;
# the mapping producer is the D-D8 test-scaffolding tool). The invoking shell runs
# env -u ANTHROPIC_API_KEY.
#
# ACT 1  FORGE: p6hub@01, p6second@01, p6second@02 standard blocks into the canonical
#        store (forge -> extractSchema(tearDown) -> save; the addStandard steps 1-3 —
#        deliberately WITHOUT publish: no golden pointer is ever touched).
#        Then: gating manifests + the synthetic mapping blocks at (01,01) and (01,02)
#        + both CURRENT pair-groups (the D-D5 honesty knob on every mint).
# ACT 2  PROMOTE and ACT 3 SHIP run as their own narrated steps AFTER this driver.
#
# Validation containers: gf_pvsD6val_* (fresh names, torn down by --tearDown in-flow).
set -u

CODE=/Users/tqwhite/Documents/webdev/educoreForge/system/code
FORGER="$CODE/cli/lib.d/forger/forger.js"
REPLAY="$CODE/cli/lib.d/edf-replay/edfReplay.js"
MANIFEST="$CODE/cli/lib.d/manifest-editor/manifestEditor.js"
MANAGER="$CODE/cli/lib.d/edf-forge-manager/edfForgeManager.js"
SCRATCH=/private/tmp/claude-501/-Users-tqwhite-Documents-webdev/5b0bbbb9-cad3-4583-9b51-98e12fe16175/scratchpad
P6SECOND_02_SOURCE="$CODE/cli/parserLib/_test/forge-p6second/assets/standardSourceData/02/source.json"

cd "$CODE"

forgeAndSave () {
	local standardName=$1 subject=$2 tag=$3 sourceArg=$4
	local graph="pvsD6val_${tag}"
	local blockFile="$SCRATCH/phaseD_std_${tag}.block"
	echo "=== [$(date -u +%H:%M:%SZ)] FORGE $standardName ($tag) -> $graph ==="
	if [ -n "$sourceArg" ]; then
		node "$FORGER" -forge "--standardName=$standardName" "--destination=$graph" --owner=:golden "--source=$sourceArg" || return 1
	else
		node "$FORGER" -forge "--standardName=$standardName" "--destination=$graph" --owner=:golden || return 1
	fi
	echo "--- extractSchema standard ($subject) + tearDown ---"
	node "$REPLAY" -extractSchema "--from=$graph" --selector=standard "--subject=$subject" "--out=$blockFile" --tearDown || return 1
	echo "--- save block ---"
	node "$MANIFEST" -save "--block=$blockFile" --producedBy=phaseD:syntheticFlow || return 1
}

forgeAndSave p6hub CEDS hub01 "" || { echo 'FORGE hub01 FAILED'; exit 1; }
forgeAndSave p6second synthstd second01 "" || { echo 'FORGE second01 FAILED'; exit 1; }
forgeAndSave p6second synthstd second02 "$P6SECOND_02_SOURCE" || { echo 'FORGE second02 FAILED'; exit 1; }

echo "=== [$(date -u +%H:%M:%SZ)] blockIds ==="
node -e "
const db = require('$CODE/node_modules/better-sqlite3')('/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/forgeStore.sqlite3', { readonly: true });
const rows = db.prepare(\"SELECT blockId, subject, createdAt FROM blocks WHERE producedBy='phaseD:syntheticFlow' ORDER BY createdAt\").all();
rows.forEach(r => console.log(r.subject, r.blockId));
db.close();
"
echo "=== [$(date -u +%H:%M:%SZ)] ACT-1 forge leg done ==="
