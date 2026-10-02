#!/bin/bash
# runRealStandardIdentity.sh <outDir> <baseTreeRoot> <branchTreeRoot> <goldStandardsDatabaseFilePath>
#
# Lane C proof P2 (DESIGN-C-candidateRegistry.md §6.4): the goldJevFour recipe rebridged under the DEBUG judge (no judge
# spend), once from each tree, each over its own APFS clone of a certified store, then compared by
# compareRealStandardIdentity.js. One build at a time, one campaign slot, >= 4 GiB free first, neoBrainV2 StartedAt
# logged before and after.
#
# DISPOSAL IS PID-SCOPED (QUIET_ORBIT ruling after the 2026-10-01 incident, the DEVLOG-B V3 pattern). graphBuilder names
# every container it provisions `..._<its own pid>_...`, so ownership is read from the NAME, never from a before/after
# `docker ps` diff: on a shared host other lanes create containers inside the same window, and the diff version of this
# script removed seven of theirs. A volume is removed only if it did not exist before the run, is dangling after it, was
# mounted by one of THIS build's containers, and no other slot holder overlapped the run; otherwise it is listed only.
OUT_DIR=$1; BASE_TREE=$2; BRANCH_TREE=$3; GOLD_STORE=$4
: "${LANE_SESSION_NAME:?name the session holding the slot (LANE_SESSION_NAME), it is written into the slot file}"
LOG=$OUT_DIR/runRealStandardIdentity.log
mkdir -p $OUT_DIR
say() { echo "$(date '+%H:%M:%S') $*" >> $LOG; }
takeSlot() {
	while true; do
		for slotSuffix in 2 3 4 ""; do
			slotFile=/tmp/miloPersistence/dockerProvisionLock$slotSuffix
			if ( set -o noclobber; echo "$LANE_SESSION_NAME lane C P2 $1 $(date '+%Y-%m-%d %H:%M:%S')" > $slotFile ) 2>/dev/null; then
				SLOT_FILE=$slotFile; return 0
			fi
		done
		sleep 30
	done
}
otherSlotHolderPresent() { for slotFile in /tmp/miloPersistence/dockerProvisionLock*; do [ "$slotFile" != "$SLOT_FILE" ] && [ -e "$slotFile" ] && return 0; done; return 1; }
memoryFreeGiB() { docker stats --no-stream --format '{{.MemUsage}}' | awk '{v=$1; if (v ~ /GiB/) {sub(/GiB/,"",v); t+=v} else if (v ~ /MiB/) {sub(/MiB/,"",v); t+=v/1024}} END {printf "%.1f", 31.05-t}'; }
for side in base branch; do
	if [ $side = base ]; then TREE=$BASE_TREE; else TREE=$BRANCH_TREE; fi
	SIDE_DIR=$OUT_DIR/$side; mkdir -p $SIDE_DIR/forensics $SIDE_DIR/buildLogs
	cp -c $GOLD_STORE $SIDE_DIR/$side.standardsDatabase.sqlite3
	takeSlot $side; say "$side: slot $SLOT_FILE; tree $TREE at $(git -C $TREE rev-parse --short HEAD)"
	while [ "$(echo "$(memoryFreeGiB) < 4" | bc)" = 1 ]; do say "$side: waiting, free $(memoryFreeGiB) GiB"; sleep 60; done
	say "$side: free $(memoryFreeGiB) GiB; neoBrainV2 StartedAt $(docker inspect -f '{{.State.StartedAt}}' neoBrainV2)"
	docker volume ls -q | sort > $SIDE_DIR/volumesBefore.txt
	: > $SIDE_DIR/myContainers.txt; : > $SIDE_DIR/myVolumes.txt
	OVERLAPPED=no
	(cd $TREE && exec node --max-old-space-size=20000 apps/graph-builder/graphBuilder.js -build --recipePath=recipes/goldJevFour.recipe.jsonc --vectorize=true --reuseForgedBlocks=true --standardsDatabaseFilePath=$SIDE_DIR/$side.standardsDatabase.sqlite3 --decisionStoreFilePath=$SIDE_DIR/$side.decisions.sqlite3 --judgmentCacheFilePath=$SIDE_DIR/$side.judgmentCache.sqlite3 --matchForensicsDirPath=$SIDE_DIR/forensics --buildLogsDirPath=$SIDE_DIR/buildLogs --embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3 --rebridge=all --useDebugJudge=digest </dev/null > $SIDE_DIR/build.log 2>&1) &
	BUILD_PID=$!
	say "$side: build pid $BUILD_PID"
	while kill -0 $BUILD_PID 2>/dev/null; do
		for containerName in $(docker ps -a --format '{{.Names}}' | grep "_${BUILD_PID}_"); do
			grep -qx "$containerName" $SIDE_DIR/myContainers.txt || echo "$containerName" >> $SIDE_DIR/myContainers.txt
			docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' "$containerName" 2>/dev/null | grep -v '^$' >> $SIDE_DIR/myVolumes.txt
		done
		otherSlotHolderPresent && OVERLAPPED=yes
		sleep 5
	done
	wait $BUILD_PID; BUILD_EXIT=$?
	say "$side: build exit $BUILD_EXIT; my containers: $(tr '\n' ' ' < $SIDE_DIR/myContainers.txt)"
	for containerName in $(docker ps -a --format '{{.Names}}' | grep "_${BUILD_PID}_"); do say "$side: removing my container $containerName"; docker rm -f -v "$containerName" >> $LOG 2>&1; done
	sort -u $SIDE_DIR/myVolumes.txt -o $SIDE_DIR/myVolumes.txt
	docker volume ls -q -f dangling=true | sort > $SIDE_DIR/danglingAfter.txt
	for volumeName in $(comm -12 $SIDE_DIR/myVolumes.txt $SIDE_DIR/danglingAfter.txt | comm -23 - $SIDE_DIR/volumesBefore.txt); do
		if [ $OVERLAPPED = no ]; then docker volume rm $volumeName >> $LOG 2>&1 && say "$side: removed my volume $volumeName"; else echo $volumeName >> $SIDE_DIR/volumesToRemove.txt; say "$side: LEFT my volume $volumeName (another slot holder overlapped)"; fi
	done
	say "$side: neoBrainV2 StartedAt $(docker inspect -f '{{.State.StartedAt}}' neoBrainV2)"
	rm -f $SLOT_FILE; say "$side: released $SLOT_FILE"
done
say DONE
