#!/usr/bin/env bash
# phaseD-gd3-driver.sh — ACT 3 (SHIP) + G-D3, the KEYSTONE mismatch proof (work item 6 /
# order Phase D red gates): compose the p6second@01 standard block WITH the @02 pair-group
# -> the build COMPLETES (permit) and the connect report shows the pair PARTIAL with
# EXACTLY 1 dangling (detect; ruling D-D7's precision rider); then the matched composition
# (@02 standard block + @02 group) -> CONNECTED with EXACTLY 0. Both directions witnessed
# on a GENUINE version mismatch. ACT 2 (promote) runs separately, narrated in the DEVLOG.
#
# Containers gf_pvsD3mismatch / gf_pvsD3matched (fresh names); each is STOPPED right after
# its report is captured (the OOM lesson: <=2 phase containers live at once).
# Invoking shell: env -u ANTHROPIC_API_KEY.
set -u

CODE=/Users/tqwhite/Documents/webdev/educoreForge/system/code
MANIFEST="$CODE/cli/lib.d/manifest-editor/manifestEditor.js"
REPLAY="$CODE/cli/lib.d/edf-replay/edfReplay.js"
STORE=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/forgeStore.sqlite3
LOGDIR=/Users/tqwhite/Documents/webdev/educoreForge/system/management/zNotesPlansDocs/pairwiseVersionSwitching-devlogs/logs

cd "$CODE"

eval "$(node -e "
const db = require('$CODE/node_modules/better-sqlite3')('$STORE', { readonly: true });
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
[ -z "$HUB01" ] || [ -z "$SEC01" ] || [ -z "$SEC02" ] && { echo 'BLOCK RESOLUTION FAILED'; exit 1; }

echo "=== [$(date -u +%H:%M:%SZ)] SHIP: mismatch manifest (@01 standard + @02 group) ==="
node "$MANIFEST" -combine "--set=$HUB01,$SEC01" "--group=CEDS::synthstd@(01,02)" --label=phaseD-GD3-mismatch | tee /tmp/phaseD_gd3_mismatch.json
MISMATCH=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/phaseD_gd3_mismatch.json','utf8')).manifestKey)")

echo "=== [$(date -u +%H:%M:%SZ)] SHIP: matched manifest (@02 standard + @02 group) ==="
node "$MANIFEST" -combine "--set=$HUB01,$SEC02" "--group=CEDS::synthstd@(01,02)" --label=phaseD-GD3-matched | tee /tmp/phaseD_gd3_matched.json
MATCHED=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/phaseD_gd3_matched.json','utf8')).manifestKey)")

echo "=== [$(date -u +%H:%M:%SZ)] G-D3 RED ARM: build the MISMATCH (permit) ==="
node "$REPLAY" -buildGraph "--manifest=$MISMATCH" --destination=pvsD3mismatch --owner=:user > "$LOGDIR/phaseD-gd3-build-mismatch.json" 2> "$LOGDIR/phaseD-gd3-build-mismatch.stderr"
MISMATCH_RC=$?
echo "mismatch build rc=$MISMATCH_RC (0 = the build COMPLETES: permit)"
docker stop gf_pvsD3mismatch > /dev/null 2>&1

echo "=== [$(date -u +%H:%M:%SZ)] G-D3 GREEN ARM: build the MATCHED ==="
node "$REPLAY" -buildGraph "--manifest=$MATCHED" --destination=pvsD3matched --owner=:user > "$LOGDIR/phaseD-gd3-build-matched.json" 2> "$LOGDIR/phaseD-gd3-build-matched.stderr"
MATCHED_RC=$?
echo "matched build rc=$MATCHED_RC"
docker stop gf_pvsD3matched > /dev/null 2>&1

echo "=== [$(date -u +%H:%M:%SZ)] VERDICTS (D-D7 precision: mismatch EXACTLY 1 dangling; matched EXACTLY 0) ==="
node -e "
const fs = require('fs');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^[^{]*/, ''));
const mm = read('$LOGDIR/phaseD-gd3-build-mismatch.json');
const mt = read('$LOGDIR/phaseD-gd3-build-matched.json');
const pairOf = (r) => (r.connectReport.pairs || []).find((p) => p.pair.indexOf('CEDS::synthstd') !== -1);
const mmPair = pairOf(mm);
const mtPair = pairOf(mt);
console.log('MISMATCH:', mmPair.pair, mmPair.verdict, 'written', mmPair.edgesWritten, 'dangling', mmPair.edgesDangling, 'samples', JSON.stringify(mmPair.samples));
console.log('MATCHED :', mtPair.pair, mtPair.verdict, 'written', mtPair.edgesWritten, 'dangling', mtPair.edgesDangling);
const redOk = mmPair.verdict === 'PARTIAL' && mmPair.edgesDangling === 1 && mmPair.edgesWritten === 1;
const greenOk = mtPair.verdict === 'CONNECTED' && mtPair.edgesDangling === 0 && mtPair.edgesWritten === 2;
console.log(redOk ? 'G-D3 RED ARM: EXACT (PARTIAL, ==1 dangling, ==1 written)' : 'G-D3 RED ARM: WRONG SHAPE');
console.log(greenOk ? 'G-D3 GREEN ARM: EXACT (CONNECTED, ==0 dangling, ==2 written)' : 'G-D3 GREEN ARM: WRONG SHAPE');
"
echo "=== [$(date -u +%H:%M:%SZ)] G-D3 done ==="
