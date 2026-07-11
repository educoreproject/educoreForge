#!/usr/bin/env bash
# phaseD-gd1-driver.sh — G-D1 selection-equivalence gate (WORKORDER Phase D):
#   build the DIRECT-composed manifest and the GROUP-composed manifest into two fresh
#   isolated containers, fingerprint both via edf-gate, and compare. Groups must have
#   changed the selecting, not the selected.
#
# Zero-spend posture: ANTHROPIC_API_KEY is unset by the invoking shell (env -u);
# replay makes zero API calls [code-fact]. Store: the CANONICAL (manifests composed
# there per the phase sanction); the built graphs register rows that the phase's
# sanctioned teardown removes afterward.
#
# Containers: gf_pvsD1direct / gf_pvsD1group — FRESH names (preflight verified none
# pre-exist); torn down only by this phase.
set -u

CODE=/Users/tqwhite/Documents/webdev/educoreForge/system/code
REPLAY="$CODE/cli/lib.d/edf-replay/edfReplay.js"
GATE="$CODE/cli/lib.d/edf-gate/edfGate.js"
LOGDIR=/Users/tqwhite/Documents/webdev/educoreForge/system/management/zNotesPlansDocs/pairwiseVersionSwitching-devlogs/logs

DIRECT_MANIFEST=fa6ae5a5203d98ca442ed1a140498ff73218ac2cf360b64bd6664b58b4c3b1c9
GROUP_MANIFEST=030f2fc582866de5498e3f685af7cb36763c4275d0c6730d3b040e92dd5c8406

cd "$CODE"

echo "=== [$(date -u +%H:%M:%SZ)] build DIRECT arm -> pvsD1direct ==="
node --max-old-space-size=8192 "$REPLAY" -buildGraph "--manifest=$DIRECT_MANIFEST" --destination=pvsD1directRaw --owner=:user --skipFinishing > "$LOGDIR/phaseD-gd1raw-build-direct.json" 2> "$LOGDIR/phaseD-gd1raw-build-direct.stderr"
DIRECT_RC=$?
echo "direct build rc=$DIRECT_RC"

echo "=== [$(date -u +%H:%M:%SZ)] build GROUP arm -> pvsD1group ==="
node --max-old-space-size=8192 "$REPLAY" -buildGraph "--manifest=$GROUP_MANIFEST" --destination=pvsD1groupRaw --owner=:user --skipFinishing > "$LOGDIR/phaseD-gd1raw-build-group.json" 2> "$LOGDIR/phaseD-gd1raw-build-group.stderr"
GROUP_RC=$?
echo "group build rc=$GROUP_RC"

if [ $DIRECT_RC -ne 0 ] || [ $GROUP_RC -ne 0 ]; then
	echo "G-D1 BUILDS FAILED (direct=$DIRECT_RC group=$GROUP_RC) — fingerprints not attempted"
	exit 1
fi

echo "=== [$(date -u +%H:%M:%SZ)] fingerprint both ==="
node "$GATE" -fingerprint --graph=pvsD1directRaw > "$LOGDIR/phaseD-gd1raw-fp-direct.json" 2>> "$LOGDIR/phaseD-gd1raw-build-direct.stderr"
node "$GATE" -fingerprint --graph=pvsD1groupRaw  > "$LOGDIR/phaseD-gd1raw-fp-group.json"  2>> "$LOGDIR/phaseD-gd1raw-build-group.stderr"

echo "=== [$(date -u +%H:%M:%SZ)] compare ==="
DFP=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^[^{]*/,'')).fingerprint)" "$LOGDIR/phaseD-gd1raw-fp-direct.json")
GFP=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^[^{]*/,'')).fingerprint)" "$LOGDIR/phaseD-gd1raw-fp-group.json")
echo "direct fp: $DFP"
echo "group  fp: $GFP"
if [ "$DFP" = "$GFP" ]; then
	echo "G-D1 FINGERPRINTS IDENTICAL (byte-equal fingerprint reports)"
else
	echo "G-D1 FINGERPRINT DIFF (see $LOGDIR/phaseD-gd1-fp-*.json)"
	diff "$LOGDIR/phaseD-gd1raw-fp-direct.json" "$LOGDIR/phaseD-gd1raw-fp-group.json" | head -40
fi
echo "=== [$(date -u +%H:%M:%SZ)] done ==="
