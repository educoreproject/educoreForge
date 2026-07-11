#!/usr/bin/env bash
# phaseD-gd1-driver.sh — G-D1 selection-equivalence gate, RUN 1 (finishing ON — retained
# as the honest record of the method discovery): the Wave-B self-documentation finisher
# materializes the MANIFEST RECIPE into the graph as :ForgedNode content, so two different
# manifests (originals vs pair-keyed twins) can never fingerprint identical with finishing
# on — replay-level counts were already identical (85,018 nodes / 275,679 edges both arms).
# The gate's contract is REPLAYED CONTENT equality; phaseD-gd1raw-driver.sh is the run of
# record (both arms --skipFinishing, fingerprint VALUES compared).
#
# Zero-spend posture: ANTHROPIC_API_KEY unset by the invoking shell; replay makes zero
# API calls [code-fact]. Containers gf_pvsD1direct / gf_pvsD1group — fresh names, torn
# down only by this phase.
set -u

CODE=/Users/tqwhite/Documents/webdev/educoreForge/system/code
REPLAY="$CODE/cli/lib.d/edf-replay/edfReplay.js"
GATE="$CODE/cli/lib.d/edf-gate/edfGate.js"
LOGDIR=/Users/tqwhite/Documents/webdev/educoreForge/system/management/zNotesPlansDocs/pairwiseVersionSwitching-devlogs/logs

DIRECT_MANIFEST=fa6ae5a5203d98ca442ed1a140498ff73218ac2cf360b64bd6664b58b4c3b1c9
GROUP_MANIFEST=030f2fc582866de5498e3f685af7cb36763c4275d0c6730d3b040e92dd5c8406

cd "$CODE"

echo "=== [$(date -u +%H:%M:%SZ)] build DIRECT arm -> pvsD1direct ==="
node --max-old-space-size=8192 "$REPLAY" -buildGraph "--manifest=$DIRECT_MANIFEST" --destination=pvsD1direct --owner=:user > "$LOGDIR/phaseD-gd1-build-direct.json" 2> "$LOGDIR/phaseD-gd1-build-direct.stderr"
DIRECT_RC=$?
echo "direct build rc=$DIRECT_RC"

echo "=== [$(date -u +%H:%M:%SZ)] build GROUP arm -> pvsD1group ==="
node --max-old-space-size=8192 "$REPLAY" -buildGraph "--manifest=$GROUP_MANIFEST" --destination=pvsD1group --owner=:user > "$LOGDIR/phaseD-gd1-build-group.json" 2> "$LOGDIR/phaseD-gd1-build-group.stderr"
GROUP_RC=$?
echo "group build rc=$GROUP_RC"

if [ $DIRECT_RC -ne 0 ] || [ $GROUP_RC -ne 0 ]; then
	echo "G-D1 BUILDS FAILED (direct=$DIRECT_RC group=$GROUP_RC) — fingerprints not attempted"
	exit 1
fi

echo "=== [$(date -u +%H:%M:%SZ)] fingerprint both ==="
node "$GATE" -fingerprint --graph=pvsD1direct > "$LOGDIR/phaseD-gd1-fp-direct.json" 2>> "$LOGDIR/phaseD-gd1-build-direct.stderr"
node "$GATE" -fingerprint --graph=pvsD1group  > "$LOGDIR/phaseD-gd1-fp-group.json"  2>> "$LOGDIR/phaseD-gd1-build-group.stderr"

echo "=== [$(date -u +%H:%M:%SZ)] compare ==="
if diff -q "$LOGDIR/phaseD-gd1-fp-direct.json" "$LOGDIR/phaseD-gd1-fp-group.json" > /dev/null 2>&1; then
	echo "G-D1 FINGERPRINTS IDENTICAL (byte-equal fingerprint reports)"
else
	echo "G-D1 FINGERPRINT DIFF (see $LOGDIR/phaseD-gd1-fp-*.json)"
	diff "$LOGDIR/phaseD-gd1-fp-direct.json" "$LOGDIR/phaseD-gd1-fp-group.json" | head -40
fi
echo "=== [$(date -u +%H:%M:%SZ)] done ==="
