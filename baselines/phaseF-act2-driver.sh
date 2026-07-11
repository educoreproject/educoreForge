#!/usr/bin/env bash
# phaseF-act2-driver.sh — THE THREE-ACTS DEMO, ACT 2 (Phase F work item 1): THE VERSION SWITCH.
# Runs AFTER the live promote beat (descriptor defaultSnapshot 01->02, its own narrated act —
# spec §15-6: forge, promote, ship are three deliberate acts; defaults never drive graph
# generation, manifests do). Composes V2 swapping ONLY the p6second constituents to @02
# (std block + pair-group at (01,02), riding that key's CURRENT), rebuilds, dumps for G-F1;
# then composes the DELIBERATE MISMATCH (@01 std + @02 group) for G-F2: build COMPLETES
# (permit) + report PARTIAL with EXACTLY 1 dangling naming the moved address (detect).
# Scratch store only; one container at a time. Invoking shell: env -u ANTHROPIC_API_KEY.
# Usage: phaseF-act2-driver.sh <scratchDbPath> <dumpDir> <logDir>
set -u

CODE=/Users/tqwhite/Documents/webdev/educoreForge/system/code
MANIFEST="$CODE/cli/lib.d/manifest-editor/manifestEditor.js"
REPLAY="$CODE/cli/lib.d/edf-replay/edfReplay.js"
SCRATCH="$1"
DUMPDIR="$2"
LOGDIR="$3"
mkdir -p "$DUMPDIR" "$LOGDIR"

cd "$CODE"

eval "$(node -e "
const db = require('$CODE/node_modules/better-sqlite3')('$SCRATCH', { readonly: true });
const rows = db.prepare(\"SELECT blockId, subject, text FROM blocks WHERE producedBy='phaseD:syntheticFlow'\").all();
const stampOf = (text) => {
  for (const line of text.split('\n').slice(1)) {
    if (!line || line.indexOf('DmeStandardRoot') === -1) continue;
    let p; try { p = JSON.parse(line); } catch (e) { continue; }
    if (p.kind !== 'node' || (p.labels||[]).indexOf('DmeStandardRoot') === -1) continue;
    const v = (p.properties||{}).snapshotKey;
    return Array.isArray(v) ? v[0] : v;
  }
  return null;
};
rows.forEach(r => {
  const snap = stampOf(r.text);
  if (r.subject === 'CEDS' && snap === '01') console.log('HUB01=' + r.blockId);
  if (r.subject === 'synthstd' && snap === '01') console.log('SEC01=' + r.blockId);
  if (r.subject === 'synthstd' && snap === '02') console.log('SEC02=' + r.blockId);
});
db.close();
")"
echo "HUB01=$HUB01"; echo "SEC01=$SEC01"; echo "SEC02=$SEC02"
{ [ -z "${HUB01:-}" ] || [ -z "${SEC01:-}" ] || [ -z "${SEC02:-}" ]; } && { echo 'BLOCK RESOLUTION FAILED'; exit 1; }

echo "=== [$(date -u +%H:%M:%SZ)] ACT 2 — SHIP v2: compose V2 swapping ONLY the p6second constituents to @02 (std + group at (01,02), riding CURRENT) ==="
node "$MANIFEST" -combine "--set=$HUB01,$SEC02" "--group=CEDS::synthstd@(01,02)" --label=phaseF-act2-v2 "--db=$SCRATCH" | tee /tmp/phaseF_act2_v2.json
V2=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/phaseF_act2_v2.json','utf8').replace(/^[^{[]*/,'')).manifestKey)")
echo "V2=$V2"

echo "=== [$(date -u +%H:%M:%SZ)] ACT 2 — build V2 into gf_pvsFv2 (raw) ==="
EDF_FORGE_STORE_DB="$SCRATCH" node "$REPLAY" -buildGraph "--manifest=$V2" --destination=pvsFv2 --owner=:user --skipFinishing > "$LOGDIR/phaseF-act2-build-v2.json" 2> "$LOGDIR/phaseF-act2-build-v2.stderr"
echo "build rc=$?"

echo "=== [$(date -u +%H:%M:%SZ)] ACT 2 — dump V2 (container still up) ==="
EDF_FORGE_STORE_DB="$SCRATCH" node baselines/phaseE-graph-dump.js --graph=pvsFv2 "--outDir=$DUMPDIR" > "$LOGDIR/phaseF-act2-dump-v2.log" 2>&1
echo "dump rc=$?"

docker stop gf_pvsFv2 > /dev/null 2>&1
echo "gf_pvsFv2 stopped (ceiling discipline)"

echo "=== [$(date -u +%H:%M:%SZ)] ACT 2 verdict (expect CONNECTED, 2 written / 0 dangling — the switch itself is clean) ==="
node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('$LOGDIR/phaseF-act2-build-v2.json', 'utf8').replace(/^[^{]*/, ''));
const p = (r.connectReport.pairs || []).find((x) => x.pair.indexOf('CEDS::synthstd') !== -1);
console.log('ACT2 V2:', p.pair, p.verdict, 'written', p.edgesWritten, 'dangling', p.edgesDangling);
console.log(p.verdict === 'CONNECTED' && p.edgesWritten === 2 && p.edgesDangling === 0 ? 'ACT 2 V2: EXACT (rides @02, CONNECTED 2/0)' : 'ACT 2 V2: WRONG SHAPE');
"

echo "=== [$(date -u +%H:%M:%SZ)] G-F1 — the switch delta, asserted confined to the p6second pair ==="
node baselines/phaseF-gf1-delta-assert.js "--dumpDir=$DUMPDIR" | tee "$LOGDIR/phaseF-gf1-delta.log"
echo "G-F1 assert rc=$?"

echo "=== [$(date -u +%H:%M:%SZ)] G-F2 RED — compose the DELIBERATE MISMATCH (@01 std + @02 group) ==="
node "$MANIFEST" -combine "--set=$HUB01,$SEC01" "--group=CEDS::synthstd@(01,02)" --label=phaseF-gf2-mismatch "--db=$SCRATCH" | tee /tmp/phaseF_gf2_mm.json
MM=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/phaseF_gf2_mm.json','utf8').replace(/^[^{[]*/,'')).manifestKey)")
echo "MM=$MM"

echo "=== [$(date -u +%H:%M:%SZ)] G-F2 — build the mismatch into gf_pvsFmm (PERMIT expected: rc=0) ==="
EDF_FORGE_STORE_DB="$SCRATCH" node "$REPLAY" -buildGraph "--manifest=$MM" --destination=pvsFmm --owner=:user --skipFinishing > "$LOGDIR/phaseF-gf2-build-mm.json" 2> "$LOGDIR/phaseF-gf2-build-mm.stderr"
MM_RC=$?
echo "mismatch build rc=$MM_RC (0 = the build COMPLETES: permit)"
docker stop gf_pvsFmm > /dev/null 2>&1
echo "gf_pvsFmm stopped (ceiling discipline)"

echo "=== [$(date -u +%H:%M:%SZ)] G-F2 verdict (DETECT: PARTIAL, EXACTLY 1 written / 1 dangling, sample names urn:p6second:S200101) ==="
node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('$LOGDIR/phaseF-gf2-build-mm.json', 'utf8').replace(/^[^{]*/, ''));
const p = (r.connectReport.pairs || []).find((x) => x.pair.indexOf('CEDS::synthstd') !== -1);
console.log('G-F2:', p.pair, p.verdict, 'written', p.edgesWritten, 'dangling', p.edgesDangling, 'samples', JSON.stringify(p.samples));
const named = JSON.stringify(p.samples).indexOf('urn:p6second:S200101') !== -1;
const shape = p.verdict === 'PARTIAL' && p.edgesWritten === 1 && p.edgesDangling === 1;
console.log(shape && named ? 'G-F2: EXACT (permit + detect; the moved address NAMED)' : 'G-F2: WRONG SHAPE');
"
echo "=== [$(date -u +%H:%M:%SZ)] ACT 2 + G-F1 + G-F2 done ==="
