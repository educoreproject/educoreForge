#!/usr/bin/env bash
# phaseD-syntheticFlow-stage2.sh — work item 6, ACT 1 continued (canonical store):
# gating manifests + the synthetic mapping blocks at (01,01) and (01,02) + BOTH CURRENT
# pair-groups (disclosure 5: the @01 group is Phase F's G-F1 swap-FROM artifact).
# Every mint passes the D-D5 honesty knob (--hubBundleDir=forge-p6hub).
# The three standard blocks are resolved from the store BY ROOT STAMP, never by insertion
# order. Invoking shell: env -u ANTHROPIC_API_KEY.
set -u

CODE=/Users/tqwhite/Documents/webdev/educoreForge/system/code
MANIFEST="$CODE/cli/lib.d/manifest-editor/manifestEditor.js"
MANAGER="$CODE/cli/lib.d/edf-forge-manager/edfForgeManager.js"
STORE=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/forgeStore.sqlite3

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

echo "HUB01=$HUB01"
echo "SEC01=$SEC01"
echo "SEC02=$SEC02"
[ -z "$HUB01" ] || [ -z "$SEC01" ] || [ -z "$SEC02" ] && { echo 'BLOCK RESOLUTION FAILED'; exit 1; }

echo "=== [$(date -u +%H:%M:%SZ)] gating manifest M01 (hub01 + second01) ==="
node "$MANIFEST" -combine "--set=$HUB01,$SEC01" --label=phaseD-synth-gating01 | tee /tmp/phaseD_m01.json
M01=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/phaseD_m01.json','utf8')).manifestKey)")

echo "=== [$(date -u +%H:%M:%SZ)] synthetic mapping @(01,01) ==="
node "$MANAGER" -syntheticNativeMapping "--gatingManifest=$M01" --sourceStandard=synthstd

echo "=== [$(date -u +%H:%M:%SZ)] mint CEDS::synthstd@(01,01) (honesty knob) ==="
node "$MANAGER" -mintPairGroup "--pair=CEDS::synthstd" "--versionKey=(01,01)" --hubBundleDir=forge-p6hub "--note=phaseD item 6: the @01 group (Phase F G-F1 swap-FROM artifact)"

echo "=== [$(date -u +%H:%M:%SZ)] gating manifest M02 (hub01 + second02) ==="
node "$MANIFEST" -combine "--set=$HUB01,$SEC02" --label=phaseD-synth-gating02 | tee /tmp/phaseD_m02.json
M02=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/phaseD_m02.json','utf8')).manifestKey)")

echo "=== [$(date -u +%H:%M:%SZ)] G-D4 NAMED-GAP CAPTURE: offerGroups synthstd@02 BEFORE the (01,02) group exists ==="
LOGDIR=/Users/tqwhite/Documents/webdev/educoreForge/system/management/zNotesPlansDocs/pairwiseVersionSwitching-devlogs/logs
node "$MANIFEST" -offerGroups "--manifest=$M02" --standard=synthstd@02 | tee "$LOGDIR/phaseD-gd4-gap-capture.json"

echo "=== [$(date -u +%H:%M:%SZ)] synthetic mapping @(01,02) ==="
node "$MANAGER" -syntheticNativeMapping "--gatingManifest=$M02" --sourceStandard=synthstd

echo "=== [$(date -u +%H:%M:%SZ)] mint CEDS::synthstd@(01,02) (honesty knob) ==="
node "$MANAGER" -mintPairGroup "--pair=CEDS::synthstd" "--versionKey=(01,02)" --hubBundleDir=forge-p6hub "--note=phaseD item 6: the @02 group (the address-moving delta, DEVLOG §3.2)"

echo "=== [$(date -u +%H:%M:%SZ)] stage-2 done ==="
