#!/bin/bash
# phaseC-rekey-driver.sh — the Phase-C canonical run (pairwiseVersionSwitching work items 3+4).
# Shells the REAL CLIs (edf-rekey, edf-forge-manager) in disposition-table order:
#   20 transforms (append-only; dedup makes re-runs idempotent) then 13 pair-group mints.
# ZERO-SPEND shell contract: run with ANTHROPIC_API_KEY unset; neither CLI imports an LLM
# or embedding client (the G-C7 grep gate proves it).
# Usage: phaseC-rekey-driver.sh [<dbPath>]   (dbPath optional; default = the canonical store)
set -u
cd "$(dirname "$0")/.."   # repo root (system/code)

DB_ARG=""
if [ -n "${1:-}" ]; then DB_ARG="--db=$1"; fi
MGR_ENV=""
if [ -n "${1:-}" ]; then export EDF_FORGE_STORE_DB="$1"; fi

REKEY="cli/lib.d/edf-rekey/edfRekey.js"
MGR="cli/lib.d/edf-forge-manager/edfForgeManager.js"

# the 20 golden mapping members, disposition-table order (PHASE-C-DEVLOG §5)
SOURCE_BLOCKS="
5388a1576b2323c2afffc396cef208c994d6d49c2e278e2efe198184969b38f7
172bfa58cfffc4b7414fd1e7255320082d35e8cdcd6dc920ba7083cf0b73bf62
a5b9e462d8572d371f3b50ea12b0154d0e7623869df8d4c9bc7230cb1d886d07
0b0218d0e8ca7bce787312bda69c996917ba95cedab7e14022b2f04042b17091
4cd14d66d1302732ad5b79d9b742ae1304257d9e6c36540757f0503ef1437028
907f73dcfd020250df8e31009a1b3af5de5bd79e6901372e6d18fa9bb063ee78
6b8046f17f7410d1d927b444fa7a82bd07e327a10ff88880dbf78017cfae2ec1
adc6f313184a19ab49cca055f38a5419b6785683fbaebb123228ca547c838807
dcfccc2f1aec4ff5a6bf5bce941d83969bfdb0f3fe73048ae8c3d1887facd4af
5570d920edc59f5db7184f38ce8b0e6b1f6f473bec3490756f49761dedadebdf
a397a721cf95c14d695c8a347f1f95274185101e55974ffcd8d05e68af61b862
d5e3338b62ca883e71f707c1c18a1cbae1ca416f6f7b91ddb1555d601aa962cd
9e5c49a07d348d0fd97f9d74a22d07b215ff5369d0c023cd9a8478cef7f88cb7
8acb9de57277e99905ee3e071da258441ebe10ac97689f8a1c884124fdbddcb0
07f0b78a19cc9dce18282e8b6197bd8505cb89572b1d64777aee556e4bf8d634
b28e9c7136a708bd48069821a946c1adb9dad54811a6b41c22ef3352086be9ad
23890153b36915dd8693169774b9ef028bd429be5f23b1c9f7b1304385731cff
21cbdda40fefa74992a8c1c6deba03a4dd8051b3c0d30c4d69cc5210df8b8d7e
6d5d3272e6eab0a0627fd20f12d3038451d1acd45ebcf6e00632727201ff4f1d
a7c3ec6fb2eca62b476e0bf1a508384d6c14f1b14446ae7fd0672538e844b490
"

PAIRS="CEDS::CASE CEDS::CLR CEDS::CTDL CEDS::EdFi CEDS::JEDx CEDS::LIF CEDS::MedBiquitous CEDS::OpenBadges CEDS::PESC CEDS::SEDM CEDS::SIF CEDS::EduAPI CIP::SOC"

FAILURES=0

echo "=== TRANSFORMS (20, disposition-table order) ==="
for BLOCK in $SOURCE_BLOCKS; do
	node "$REKEY" -transform --sourceBlock="$BLOCK" $DB_ARG 2>/dev/null
	STATUS=$?
	if [ $STATUS -ne 0 ]; then
		echo "TRANSFORM FAILED ($STATUS): $BLOCK" >&2
		FAILURES=$((FAILURES+1))
	fi
done

echo "=== MINTS (13 pairs @ (01,01)) ==="
for PAIR in $PAIRS; do
	node "$MGR" -mintPairGroup --pair="$PAIR" '--versionKey=(01,01)' 2>/dev/null
	STATUS=$?
	if [ $STATUS -ne 0 ]; then
		echo "MINT FAILED ($STATUS): $PAIR" >&2
		FAILURES=$((FAILURES+1))
	fi
done

echo "=== driver complete: failures=$FAILURES ==="
exit $([ $FAILURES -eq 0 ] && echo 0 || echo 1)
