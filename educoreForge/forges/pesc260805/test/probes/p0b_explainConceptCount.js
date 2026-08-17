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
// Why 2,197 and not the ruling's 2,213? Compute the concept count under FOUR rules over one corpus.
// The concept key is (name, typeAsWritten, effectiveDescription), so anything that makes two
// effectiveDescription values EQUAL merges two concepts and lowers the count.
const path=require('path');
process.global={xLog:{status:()=>{},error:e=>console.error(e),result:()=>{},verbose:()=>{}}};
const B='/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/forges/pesc260805';
require(path.join(B,'forgePesc260805'))({embedder:null}).forge({sourcePath:path.join(B,'assets','standardSourceData','01'),skipEmbedding:true},(e,f)=>{
  if(e){console.error(e);process.exit(1);}
  const byId={}; f.nodes.forEach(n=>byId[n.stableId]=n);
  const idx={derivedOnly:{},allTiers:{}};
  f.edges.forEach(ed=>{ if(ed.type!=='RESOLVES_TO')return;
    (idx.allTiers[ed.fromRef.id]=idx.allTiers[ed.fromRef.id]||[]).push(ed.toRef.id);
    if(ed.properties.pescTier==='derived')(idx.derivedOnly[ed.fromRef.id]=idx.derivedOnly[ed.fromRef.id]||[]).push(ed.toRef.id);
  });
  const decls=f.nodes.filter(n=>n.labels.indexOf('PescElementDecl')!==-1&&n.properties.pescTier==='source');
  const eff=(n,edgeIdx,trim)=>{
    const norm=v=>{const s=v==null?'':`${v}`; return trim? s.trim():s;};
    const own=norm(n.properties.description); if(own!=='')return own;
    const t=edgeIdx[n.stableId]||[]; if(t.length!==1)return '';
    const tn=byId[t[0]]; if(!tn)return ''; return norm(tn.properties.description);
  };
  const RULES=[
    ['A. derived-only edges + TRIM   (what the forge does)',       'derivedOnly', true ],
    ['B. derived-only edges + non-empty (no trim)',                 'derivedOnly', false],
    ['C. ALL edges incl. synthetic + TRIM',                         'allTiers',    true ],
    ['D. ALL edges incl. synthetic + non-empty (the report rule)',   'allTiers',    false],
  ];
  RULES.forEach(([label,idxName,trim])=>{
    const seen={};
    decls.forEach(n=>{ const k=JSON.stringify([n.properties.name,n.properties.typeAsWritten,eff(n,idx[idxName],trim)]);
      if(!seen[k]||n.stableId<seen[k])seen[k]=n.stableId; });
    console.log(`${label}: ${Object.keys(seen).length} concepts`);
  });
  console.log('\nthe ruling fixes scope (a′) at 2,213 concepts');
});
