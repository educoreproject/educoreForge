#!/usr/bin/env bash
# phaseF-act1-driver.sh — THE THREE-ACTS DEMO, ACT 1 (Phase F work item 1): a manifest RIDING
# the pair-group CURRENT pointer at (01,01) resolves the @01 group; the graph builds CONNECTED.
# Runs ENTIRELY on the Phase-F scratch store (supervisor note 2: Acts 1-2 never touch the
# canonical store). One container (gf_pvsFv1), dumped for the G-F1 diff, then STOPPED — the
# briefed ceiling: one demo container at a time beside the live gf_pvsEcand.
# Invoking shell: env -u ANTHROPIC_API_KEY. Usage: phaseF-act1-driver.sh <scratchDbPath> <dumpDir> <logDir>
set -u

CODE=/Users/tqwhite/Documents/webdev/educoreForge/system/code
MANIFEST="$CODE/cli/lib.d/manifest-editor/manifestEditor.js"
REPLAY="$CODE/cli/lib.d/edf-replay/edfReplay.js"
SCRATCH="$1"
DUMPDIR="$2"
LOGDIR="$3"
mkdir -p "$DUMPDIR" "$LOGDIR"

cd "$CODE"

# block resolution BY ROOT STAMP, never insertion order (the Phase-D discipline)
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
});
db.close();
")"
echo "HUB01=$HUB01"; echo "SEC01=$SEC01"
{ [ -z "${HUB01:-}" ] || [ -z "${SEC01:-}" ]; } && { echo 'BLOCK RESOLUTION FAILED'; exit 1; }

echo "=== [$(date -u +%H:%M:%SZ)] ACT 1 — SHIP v1: compose V1 (hub + p6second@01 std + the pair-group SYMBOLICALLY at (01,01), riding CURRENT) ==="
node "$MANIFEST" -combine "--set=$HUB01,$SEC01" "--group=CEDS::synthstd@(01,01)" --label=phaseF-act1-v1 "--db=$SCRATCH" | tee /tmp/phaseF_act1_v1.json
V1=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/phaseF_act1_v1.json','utf8').replace(/^[^{[]*/,'')).manifestKey)")
echo "V1=$V1"

echo "=== [$(date -u +%H:%M:%SZ)] ACT 1 — build V1 into gf_pvsFv1 (raw/--skipFinishing, the cross-manifest comparison method of record) ==="
EDF_FORGE_STORE_DB="$SCRATCH" node "$REPLAY" -buildGraph "--manifest=$V1" --destination=pvsFv1 --owner=:user --skipFinishing > "$LOGDIR/phaseF-act1-build-v1.json" 2> "$LOGDIR/phaseF-act1-build-v1.stderr"
echo "build rc=$?"

echo "=== [$(date -u +%H:%M:%SZ)] ACT 1 — dump V1 for the G-F1 diff (container still up) ==="
EDF_FORGE_STORE_DB="$SCRATCH" node baselines/phaseE-graph-dump.js --graph=pvsFv1 "--outDir=$DUMPDIR" > "$LOGDIR/phaseF-act1-dump-v1.log" 2>&1
echo "dump rc=$?"

docker stop gf_pvsFv1 > /dev/null 2>&1
echo "gf_pvsFv1 stopped (ceiling discipline)"

echo "=== [$(date -u +%H:%M:%SZ)] ACT 1 verdict (expect CONNECTED, 2 written / 0 dangling) ==="
node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('$LOGDIR/phaseF-act1-build-v1.json', 'utf8').replace(/^[^{]*/, ''));
const p = (r.connectReport.pairs || []).find((x) => x.pair.indexOf('CEDS::synthstd') !== -1);
console.log('ACT1:', p.pair, p.verdict, 'written', p.edgesWritten, 'dangling', p.edgesDangling);
console.log(p.verdict === 'CONNECTED' && p.edgesWritten === 2 && p.edgesDangling === 0 ? 'ACT 1: EXACT (rides @01 CURRENT, CONNECTED 2/0)' : 'ACT 1: WRONG SHAPE');
"
echo "=== [$(date -u +%H:%M:%SZ)] ACT 1 done ==="
