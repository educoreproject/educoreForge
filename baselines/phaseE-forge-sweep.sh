#!/usr/bin/env bash
# phaseE-forge-sweep.sh — Phase E work item 1: FRESH FORGES of all 16 real standards with
# embeddings ON (skipEmbedding=false — the production path) via the SIDECAR REUSE path,
# then extractSchema (--tearDown) and save into the CANONICAL store.
#
# ZERO-SPEND POSTURE (Q1 adjudication): every forge runs --embeddingConfigFilePath at the
# KEYLESS scratch ini — a cache miss REFUSES loudly (observed in the Q1 red twin) and can
# never spend. The invoking shell runs env -u ANTHROPIC_API_KEY.
# REUSE CONTRACT (DEVLOG §3.1): every batch must be warm ('0 miss'); any 'embedded ('
# line or nonzero '(N embedding calls)' ABORTS the sweep = the §1.5 STOP.
#
# Containers: gf_pvsEval_<key>, STRICTLY SEQUENTIAL, torn down in-flow by --tearDown
# (the ≤2-Neo4j ceiling, pin (iii); ambient phase containers stay ≤1 during the sweep).
#
# --subject values are the graphs' _source identities (FORMAL casing — graph-fact,
# phaseE-goldenRaw-rootIdentity.jsonl); --owner=:golden matches the golden blocks'
# ownerStamp so candidate content is parity-comparable (G-E2).
set -u

CODE=/Users/tqwhite/Documents/webdev/educoreForge/system/code
FORGER="$CODE/cli/lib.d/forger/forger.js"
REPLAY="$CODE/cli/lib.d/edf-replay/edfReplay.js"
MANIFEST="$CODE/cli/lib.d/manifest-editor/manifestEditor.js"
KEYLESS_INI="$CODE/baselines/keyless-scratch-inis/voyageEmbedding.ini"
BLOCK_DIR="${PHASE_E_BLOCK_DIR:?set PHASE_E_BLOCK_DIR to the block output directory}"
PRODUCED_BY=phaseE:freshForge

mkdir -p "$BLOCK_DIR"
cd "$CODE"

# registryKey subject   (subject == the graph _source / formal standardName casing)
STANDARDS=(
	"case CASE"
	"ceds CEDS"
	"cip CIP"
	"clr CLR"
	"ctdl CTDL"
	"dctap DCTAP"
	"edfi EdFi"
	"eduapi EduAPI"
	"jedx JEDx"
	"lif LIF"
	"medbiquitous MedBiquitous"
	"openbadges OpenBadges"
	"pesc PESC"
	"sedm SEDM"
	"sif SIF"
	"soc SOC"
)

for entry in "${STANDARDS[@]}"; do
	key=${entry%% *}
	subject=${entry##* }
	graph="pvsEval_${key}"
	blockFile="$BLOCK_DIR/phaseE_std_${key}.block"
	forgeLog="$BLOCK_DIR/phaseE_forge_${key}.log"

	echo "=== [$(date -u +%H:%M:%SZ)] FORGE $key (subject $subject) -> $graph ==="
	node "$FORGER" -forge "--standardName=$key" "--destination=$graph" --owner=:golden \
		"--embeddingConfigFilePath=$KEYLESS_INI" > "$forgeLog" 2>&1
	rc=$?
	# reuse statistics for the DEVLOG (supervisor note 1): warm batches vs embedded batches.
	# THE AUTHORITATIVE spend evidence is the caching-embedder per-batch lines — the forge
	# summary's '(N embedding calls)' counts decorated INTERFACE batches, not Voyage API calls
	# [code-fact forgeDctap.js:480-497; verified on the warm twin: '0 miss — warm' + '(1 embedding
	# calls)' in the same run]. The keyless ini is the structural backstop: a real API attempt
	# refuses loudly (the Q1 red twin).
	warmCount=$(grep -c '0 miss — warm' "$forgeLog" || true)
	missCount=$(grep -c ' embedded (' "$forgeLog" || true)
	batchLine=$(grep -o '([0-9]* embedding calls)' "$forgeLog" | tail -1)
	echo "reuse[$key]: warmBatches=$warmCount missBatches=$missCount interfaceBatches=${batchLine:-none} rc=$rc"
	if [ $rc -ne 0 ] || [ "$missCount" -ne 0 ] || [ "$warmCount" -eq 0 ]; then
		echo "SWEEP ABORTED at $key — cache miss, zero warm evidence, or forge failure (the §1.5 STOP). See $forgeLog"
		exit 1
	fi

	echo "--- extractSchema standard ($subject) + tearDown ---"
	node "$REPLAY" -extractSchema "--from=$graph" --selector=standard "--subject=$subject" \
		"--out=$blockFile" --tearDown >> "$forgeLog" 2>&1 || {
		echo "EXTRACT FAILED for $key — container $graph LEFT IN PLACE for diagnosis"; exit 1; }

	echo "--- save block ---"
	node "$MANIFEST" -save "--block=$blockFile" "--producedBy=$PRODUCED_BY" >> "$forgeLog" 2>&1 || {
		echo "SAVE FAILED for $key"; exit 1; }
	echo "=== [$(date -u +%H:%M:%SZ)] $key DONE ==="
done

echo "=== [$(date -u +%H:%M:%SZ)] all 16 saved; blockIds: ==="
node -e "
const db = require('$CODE/node_modules/better-sqlite3')('/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/forgeStore.sqlite3', { readonly: true });
db.prepare(\"SELECT subject, blockId FROM blocks WHERE producedBy='$PRODUCED_BY' ORDER BY subject\").all()
	.forEach((r) => console.log(r.subject, r.blockId));
db.close();
"
echo "=== [$(date -u +%H:%M:%SZ)] SWEEP COMPLETE ==="
