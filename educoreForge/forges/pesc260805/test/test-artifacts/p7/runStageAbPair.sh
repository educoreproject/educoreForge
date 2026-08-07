#!/bin/bash
# runStageAbPair.sh — Phase 7 Deliverable 1 evidence: the SAME bundle built twice through the
# ordinary graphBuilder -build path, differing ONLY in the recipe's roundTripStage opt-in.
#
# WHY A PAIR AND NOT A SINGLE STAGE-ON BUILD. A declared-but-never-invoked stage emits no error,
# no log line and no failing test — it is indistinguishable from a working one by inspection.
# "The build completed and did not complain" is not evidence, because nothing was positioned to
# complain. The control build is what makes the treatment build mean something.
#
# ====================================================================================================
# REVISED 2026-08-07 AFTER F-4 (independent review). THE ORIGINAL VERSION DESTROYED EVIDENCE.
#
# It wrote each attempt to a FIXED path. The first stage-ON run failed early — a scratch Neo4j
# container never authenticated within 90s under contention from six accumulated
# DEV_gb_materialize_* containers — and when the run was retried BY HAND to the same path, the
# failure log was OVERWRITTEN AND IS GONE. What survived was a stage-ON log carrying neither of this
# script's own `=== label ===` markers and no exit code, next to a p7BuildPair.done stamped BEFORE
# the build the log describes. The reviewer caught the provenance mismatch from exactly those tells.
#
# NOTHING IS DELETED INCLUDES FAILURES, and an unretained failure inside a provenance claim is the
# most expensive kind to lose: that log is precisely the artifact telling a successor this pair
# script is unreliable under container pressure.
#
# THE REPAIR IS THAT NO RUN CAN EVER OVERWRITE ANOTHER. Every attempt writes to a path carrying the
# run stamp and the attempt number; a rerun mints a new path rather than reusing one. The exit code
# is captured and recorded in BOTH the per-attempt log and a manifest, so an early failure that
# never reaches the closing marker still leaves a record saying it happened and what it returned.
# ====================================================================================================
#
# Runs SEQUENTIALLY, not concurrently: both builds provision scratch Neo4j containers and a
# concurrent pair would contend for ports, which would confound a difference in the logs with a
# difference in the recipes.
#
# vectorize=false DELIBERATELY (see both recipes): no round-trip assertion reads an embedding, so
# spending Voyage credit here would buy nothing the verdict can use.

set -u

REPO=/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge
STORES=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores
ART="$REPO/forges/pesc260805/test/test-artifacts/p7"

runStamp=$(date '+%Y%m%d-%H%M%S')
manifestPath="$ART/p7BuildPair_${runStamp}.manifest.txt"
echo "runStamp=${runStamp}" > "$manifestPath"

runOneBuild() {
	oneRecipeName="$1"
	oneLabel="$2"
	# THE PATH IS UNIQUE PER RUN. A retry mints a new one; it cannot land on an existing log.
	oneLogPath="$ART/p7Build_${oneLabel}_${runStamp}.log"
	if [ -e "$oneLogPath" ]; then
		echo "REFUSED: ${oneLogPath} already exists; this script never overwrites a run log." \
			| tee -a "$manifestPath"
		return 90
	fi
	{
		echo "=== ${oneLabel}: ${oneRecipeName} — started $(date '+%Y-%m-%d %H:%M:%S') ==="
		jq -nc \
			--arg recipePath "$REPO/recipes/${oneRecipeName}.recipe.jsonc" \
			--arg storePath "$STORES/graphBuilder/pesc260805phase7${oneLabel}_${runStamp}.standardsDatabase.sqlite3" \
			'{switches:{build:true},values:{recipePath:[$recipePath],standardsDatabaseFilePath:[$storePath],vectorize:["false"]}}' \
			| node "$REPO/apps/graph-builder/graphBuilder.js"
	} > "$oneLogPath" 2>&1
	oneExitCode=$?
	# RECORDED IN BOTH PLACES, and written even when the build died before the closing marker.
	echo "=== ${oneLabel} exit=${oneExitCode} — finished $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$oneLogPath"
	echo "${oneLabel} recipe=${oneRecipeName} exit=${oneExitCode} log=$(basename "$oneLogPath")" \
		>> "$manifestPath"
	return $oneExitCode
}

runOneBuild pesc260805Only          stageOff
stageOffExit=$?
runOneBuild pesc260805OnlyRoundTrip stageOn
stageOnExit=$?

echo "PAIR FINISHED $(date '+%Y-%m-%d %H:%M:%S') stageOffExit=${stageOffExit} stageOnExit=${stageOnExit}" \
	>> "$manifestPath"
cat "$manifestPath"
# The script's own exit reflects the pair, so a failed attempt cannot be mistaken for a clean pair
# by a caller that only checks the exit code.
[ "$stageOffExit" -eq 0 ] && [ "$stageOnExit" -eq 0 ]
