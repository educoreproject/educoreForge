#!/usr/bin/env node
// RETAINED DELIBERATELY, AND THE REASON IS A CRITICISM THIS BUILDER LEVELLED AT SOMEONE ELSE.
// DEVLOG-P-pescBridge.md §4 records that the P0 composition test spent 2,621 embedding texts whose
// script and texts were NOT retained, so its winning composition can never be checked byte-for-byte
// against what the forge later emitted. Reporting figures from a script in a scratchpad that gets
// deleted would have been the same failure one order later. So the measurement tools behind the
// numbers in that DEVLOG live here.
//
// THIS IS A MEASUREMENT TOOL, NOT A GATE. No suite runs it, it declares no assertions, and it
// contributes no label to test/redEvidenceLedger.json. Do not read a clean run as certification.
//
// CONNECTION DETAILS GO STALE: any bolt port or password below belonged to a container that existed
// on 2026-08-17 and does not now. Re-resolve with `docker inspect` before re-running; the hub cards
// come from whichever container currently holds the CEDS hub.
// composeManifestFromReferences.js — AZURE_DELTA. TQ's 2026-08-09 ruling: to certify a change in ONE
// standard, compose a manifest from REFERENCES to the existing blocks rather than re-forging the others.
// manifestEditor's header: the manifest refId IS contentAddress.manifestKeyForMembership over the
// membership, which "hashes schemaBlockRefId + position and NOTHING ELSE". So the id is a pure function
// and needs no build at all. The REAL module is called, never a reimplementation of its rule.
const path=require('path');
const contentAddress=require('/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/lib/content-address/content-address')();
const B={
  ceds:'09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9eacec765962fe487c33',
  edfi:'aea6d8dfe7899adef57c5ac3adb6b0df2bfc7e4a4ae859c4fa3893c132c8b304',
  pescOld:'db885ac42b284135a37135a0fb95baf376547fe401530506cc321f36686a9e61',
  pescNew:'045523dc197f4649712b74d3d6b995522106d44fa5c17c17d900205c4ee4a992',
  sif:'d393b0406d08f613f3142711fca5a9f2b0c580e84c4bef3ffd6b18d4eaa2330a',
};
const FROZEN='97c618c20e07c0c612957def69164402d364a98d5dfee865faacae1deace6382';
const MEASURED='7e8372a2f342dffd5999e2e50e00bf69aa83f698ea980849f96ab568e42ab00a';
// recipe order: ceds, edfi, pesc260805, sif
const build=(pescId,offset)=>[
  {blockId:B.ceds,   position: offset===null?null:offset+0},
  {blockId:B.edfi,   position: offset===null?null:offset+1},
  {blockId:pescId,   position: offset===null?null:offset+2},
  {blockId:B.sif,    position: offset===null?null:offset+3},
];
console.log('Searching for the position convention that reproduces BOTH published manifest ids.\n');
[['1-based',1],['0-based',0],['null positions',null]].forEach(([label,offset])=>{
  const oldKey=contentAddress.manifestKeyForMembership(build(B.pescOld,offset));
  const newKey=contentAddress.manifestKeyForMembership(build(B.pescNew,offset));
  const oldOk=oldKey===FROZEN, newOk=newKey===MEASURED;
  console.log(`${label}:`);
  console.log(`  with OLD pesc -> ${oldKey}  ${oldOk?'== FROZEN 97c618c2 ✓':'!= frozen'}`);
  console.log(`  with NEW pesc -> ${newKey}  ${newOk?'== MEASURED 7e8372a2 ✓':'!= measured'}`);
  if(oldOk&&newOk) console.log('  *** THIS CONVENTION REPRODUCES BOTH PUBLISHED IDS ***');
  console.log('');
});
