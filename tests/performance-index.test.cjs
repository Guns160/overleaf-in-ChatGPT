'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto');
const {performance}=require('perf_hooks');
const createWorkspace=require('../server/workspace');
const {projectIndex}=require('../server/latex-index');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'overleaf-index-perf-'));
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
let checks=0;const pass=n=>{checks++;console.log('PASS '+n);};
const folderA=path.join(root,'Project A'),folderB=path.join(root,'Project B'),folderC=path.join(root,'Project C');
function makeProject(folder,count,tag){
 fs.mkdirSync(path.join(folder,'sections'),{recursive:true});
 let main='\\documentclass{article}\\begin{document}';
 for(let i=0;i<count;i++)main+='\\input{sections/part-'+i+'}';
 main+='\\bibliography{references}\\end{document}\n';
 fs.writeFileSync(path.join(folder,'main.tex'),main);
 for(let i=0;i<count;i++){
  let body='\\section{Part '+i+'}\\label{sec-'+tag+':'+i+'}\\cite{ref-'+tag+'-'+i+'}\n';
  if(i===0)body+='\\newcommand{\\mycmd'+tag+'}{x}\n';
  body+='Generated performance test text.\n'.repeat(20);
  fs.writeFileSync(path.join(folder,'sections','part-'+i+'.tex'),body);
 }
 fs.writeFileSync(path.join(folder,'references.bib'),Array.from({length:count},(_,i)=>'@article{ref-'+tag+'-'+i+',\n title={Generated '+i+'}}\n').join(''));
}
makeProject(folderA,120,'a');makeProject(folderB,120,'b');makeProject(folderC,260,'c');
const entries={
 a:{type:'local',localId:'a'.repeat(24),localPath:folderA,name:'Project A'},
 b:{type:'local',localId:'b'.repeat(24),localPath:folderB,name:'Project B'},
 c:{type:'local',localId:'c'.repeat(24),localPath:folderC,name:'Project C'}
};
const getEntry=async key=>{if(!entries[key])throw Error('unknown '+key);return {...entries[key]};};
const run=async()=>({ok:true,out:'',err:''});
const make=()=>createWorkspace({getEntry,run,root:path.join(root,'projects'),stateRoot:path.join(root,'state'),syncDelayMs:1000000,retryDelayMs:1000000});
const wsA=make(),wsB=make(),wsC=make(),wsD=make(),wsE=make();
const realRead=fs.readFileSync,realOpen=fs.openSync,realMkdir=fs.mkdirSync;let readLog=new Map();
async function countReads(dir,fn){
 readLog=new Map();
 // Node's internal readFileSync opens through fs.openSync, so one read-flag open is one logical source read.
 fs.openSync=function(file,...rest){
  const p=String(file),flag=typeof rest[0]==='string'?rest[0]:(rest[0]&&rest[0].flag)||'r';
  if(p.startsWith(dir+path.sep)&&flag.startsWith('r'))readLog.set(p,(readLog.get(p)||0)+1);
  return realOpen.call(fs,file,...rest);
 };
 try{return await fn();}finally{fs.openSync=realOpen;}
}
const readsOf=p=>readLog.get(p)||0,readsUnder=d=>{let n=0;for(const [p,c] of readLog)if(p.startsWith(d+path.sep))n+=c;return n;};
(async()=>{
 const lockDir=path.join(root,'state','locks');let lockNames=[];
 fs.mkdirSync=function(...args){const p=String(args[0]);if(p.startsWith(lockDir+path.sep))lockNames.push(path.basename(p));return realMkdir.apply(fs,args);};
 try{await wsA.read({projectKey:'a',filePath:'main.tex'});}finally{fs.mkdirSync=realMkdir;}
 assert(lockNames.includes('a'.repeat(24)+'-files'));
 assert(!lockNames.includes('undefined-files'));
 pass('reads lock each local project by its own id instead of a shared undefined-files lock');
 let start=performance.now();const cold=await countReads(folderA,()=>projectIndex(wsA,{projectKey:'a'}));const coldMs=performance.now()-start;
 const coldData=cold.structuredContent;
 assert.equal(coldData.truncated,false);
 assert(coldData.labels.includes('sec-a:0')&&coldData.labels.includes('sec-a:119'));
 assert(coldData.citations.includes('ref-a-0')&&coldData.commands.includes('mycmda'));
 assert.equal(readsUnder(folderA),122);
 pass('cold completion index reads every indexed source once');
 const repeated=[];
 for(let i=0;i<5;i++){
  start=performance.now();
  const again=await countReads(folderA,()=>projectIndex(wsA,{projectKey:'a'}));
  repeated.push(performance.now()-start);
  assert.equal(readsUnder(folderA),0);
  assert.deepEqual(again.structuredContent,coldData);
 }
 const repeatedMs=[...repeated].sort((x,y)=>x-y)[2];
 assert(repeatedMs<coldMs);
 pass('repeated completion index revalidates by stat only, reads no sources, and returns identical data');
 const part3=path.join(folderA,'sections','part-3.tex');
 fs.appendFileSync(part3,'\\label{sec-a:external-inplace}\\newcommand{\\myinplace}{y}\n');
 const inPlace=await countReads(folderA,()=>projectIndex(wsA,{projectKey:'a'}));
 assert(inPlace.structuredContent.labels.includes('sec-a:external-inplace'));
 assert(inPlace.structuredContent.commands.includes('myinplace'));
 assert.equal(readsOf(part3),1);
 pass('external in-place edits invalidate exactly the changed file');
 const part4=path.join(folderA,'sections','part-4.tex'),tmp4=path.join(folderA,'sections','.replace.tmp');
 fs.writeFileSync(tmp4,'\\label{sec-a:atomic}\\newcommand{\\myatomic}{y}\nGenerated replacement.\n');
 fs.renameSync(tmp4,part4);
 const atomic=await countReads(folderA,()=>projectIndex(wsA,{projectKey:'a'}));
 assert(atomic.structuredContent.labels.includes('sec-a:atomic'));
 assert(!atomic.structuredContent.labels.includes('sec-a:4'));
 assert.equal(readsOf(part4),1);
 pass('atomic replacement by another app is detected through the new inode and mtime');
 const part6=path.join(folderA,'sections','part-6.tex'),st6=fs.statSync(part6);
 fs.writeFileSync(part6,realRead.call(fs,part6,'utf8').split('sec-a:6').join('sec-a:F'));
 fs.utimesSync(part6,st6.atime,st6.mtime);
 const restored=await countReads(folderA,()=>projectIndex(wsA,{projectKey:'a'}));
 assert(restored.structuredContent.labels.includes('sec-a:F'));
 assert(!restored.structuredContent.labels.includes('sec-a:6'));
 assert.equal(readsOf(part6),1);
 pass('same-size in-place edits with restored mtime are caught by the ctime signature');
 fs.rmSync(path.join(folderA,'sections','part-5.tex'));
 const staleList={...wsA,status:async args=>{const r=await wsA.status(args);r.structuredContent.files=[...r.structuredContent.files,'sections/part-5.tex'];return r;}};
 const missing=await countReads(folderA,()=>projectIndex(staleList,{projectKey:'a'}));
 assert.equal(missing.structuredContent.truncated,true);
 assert(!missing.structuredContent.labels.includes('sec-a:5'));
 assert.equal(readsOf(path.join(folderA,'sections','part-5.tex')),0);
 pass('files deleted between listing and stat are reported as truncated without any read attempt');
 const big=path.join(folderA,'big.tex');
 fs.writeFileSync(big,'%'.repeat(1600000));
 const tooLarge=await countReads(folderA,()=>projectIndex(wsA,{projectKey:'a'}));
 assert.equal(tooLarge.structuredContent.truncated,true);
 assert.equal(readsOf(big),0);
 pass('files over the 1.5 MB edit limit are skipped by stat before reading');
 const forB=await countReads(folderB,()=>projectIndex(wsB,{projectKey:'b'}));
 assert(forB.structuredContent.labels.includes('sec-b:0'));
 assert(!forB.structuredContent.labels.includes('sec-a:0'));
 const backToA=await countReads(folderA,()=>projectIndex(wsA,{projectKey:'a'}));
 assert.equal(readsUnder(folderA),0);
 assert(backToA.structuredContent.labels.includes('sec-a:0'));
 pass('per-file cache stays isolated between projects and never crosses source folders');
 const outside=path.join(root,'outside-secret.tex');
 fs.writeFileSync(outside,'\\label{sec-outside-leak}\\newcommand{\\myleak}{y}\n');
 fs.symlinkSync(outside,path.join(folderA,'sections','link.tex'));
 const withLink=await countReads(folderA,()=>projectIndex(wsA,{projectKey:'a'}));
 assert(!withLink.structuredContent.files.includes('sections/link.tex'));
 assert(!withLink.structuredContent.labels.includes('sec-outside-leak'));
 await assert.rejects(()=>wsA.readSources({projectKey:'a',files:['sections/link.tex']}),e=>/符号链接/.test(e.message));
 pass('symlinked sources stay outside the file list and direct batch reads reject them');
 const main=path.join(folderA,'main.tex');
 let s1=(await wsA.status({projectKey:'a',filePath:'main.tex'})).structuredContent.fileHash;
 const mainBefore=realRead.call(fs,main,'utf8');
 assert.equal(s1,sha256(mainBefore));
 const tmpMain=main+'.external-tmp';
 fs.writeFileSync(tmpMain,'new main atomic\n');fs.renameSync(tmpMain,main);
 let s2=(await countReads(folderA,()=>wsA.status({projectKey:'a',filePath:'main.tex'}))).structuredContent.fileHash;
 assert.equal(s2,sha256('new main atomic\n'));
 assert.equal(readsOf(main),1);
 await wsA.save({projectKey:'a',filePath:'main.tex',content:'saved by editor\n',expectedHash:s2});
 let s3=(await countReads(folderA,()=>wsA.status({projectKey:'a',filePath:'main.tex'}))).structuredContent.fileHash;
 assert.equal(s3,sha256('saved by editor\n'));
 assert.equal(readsOf(main),0);
 pass('active file hashes follow external atomic replacement and editor saves without going stale');
 const probe=path.join(folderA,'hash-probe.tex');
 fs.writeFileSync(probe,'AAAAAAAAAAAAAAAAAAAA');
 const probeHash1=(await wsA.status({projectKey:'a',filePath:'hash-probe.tex'})).structuredContent.fileHash;
 const probeStat=fs.statSync(probe);
 fs.writeFileSync(probe,'BBBBBBBBBBBBBBBBBBBB');
 fs.utimesSync(probe,probeStat.atime,probeStat.mtime);
 const probeHash2=(await countReads(folderA,()=>wsA.status({projectKey:'a',filePath:'hash-probe.tex'}))).structuredContent.fileHash;
 assert.notEqual(probeHash2,probeHash1);
 assert.equal(probeHash2,sha256('BBBBBBBBBBBBBBBBBBBB'));
 assert.equal(readsOf(probe),1);
 pass('same-size restored-mtime writes also invalidate the active file hash cache');
 const cap=await projectIndex(wsC,{projectKey:'c'});
 assert.equal(cap.structuredContent.truncated,true);
 assert(cap.structuredContent.labels.includes('sec-c:0'));
 assert(cap.structuredContent.citations.includes('ref-c-0'));
 const cFiles=(await wsC.status({projectKey:'c'})).structuredContent.files.filter(f=>/\.(tex|bib|sty|cls)$/i.test(f));
 assert.equal(cFiles.length,262);
 assert.equal(cap.structuredContent.labels.length,248);
 const excluded=cFiles.slice(250).filter(f=>f.startsWith('sections/')).map(f=>'sec-c:'+path.basename(f,'.tex').slice(5));
 assert(excluded.every(label=>!cap.structuredContent.labels.includes(label)));
 pass('the 250-file index bound keeps early files and reports truncation');
 const folderD=path.join(root,'Project D'),folderE=path.join(root,'Project E'),bs=String.fromCharCode(92),nl=String.fromCharCode(10);
 const makeBudgetProject=folder=>{
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder,'main.tex'),bs+'documentclass{article}'+bs+'begin{document}'+bs+'end{document}'+nl);
  for(let i=0;i<10;i++){
   const head=bs+'label{sec-d:'+i+'}'+nl;
   fs.writeFileSync(path.join(folder,'part-0'+i+'.tex'),head+'%'.repeat(460000-head.length));
  }
 };
 makeBudgetProject(folderD);makeBudgetProject(folderE);
 entries.d={type:'local',localId:'d'.repeat(24),localPath:folderD,name:'Project D'};
 entries.e={type:'local',localId:'e'.repeat(24),localPath:folderE,name:'Project E'};
 const coldBudget=await countReads(folderD,()=>projectIndex(wsD,{projectKey:'d'}));
 assert.equal(coldBudget.structuredContent.truncated,true);
 assert.equal(readsUnder(folderD),9);
 assert(coldBudget.structuredContent.labels.includes('sec-d:0'));
 assert(!coldBudget.structuredContent.labels.includes('sec-d:8'));
 assert(!coldBudget.structuredContent.labels.includes('sec-d:9'));
 for(const folder of [folderD,folderE])for(const i of [2,8,9]){
  const file=path.join(folder,'part-0'+i+'.tex');
  fs.writeFileSync(file,realRead.call(fs,file,'utf8').split('sec-d:'+i).join('sec-w:'+i));
 }
 const warmBudget=await countReads(folderD,()=>projectIndex(wsD,{projectKey:'d'}));
 assert.equal(readsOf(path.join(folderD,'part-02.tex')),1);
 assert.equal(readsOf(path.join(folderD,'part-08.tex')),0);
 assert.equal(readsOf(path.join(folderD,'part-09.tex')),0);
 assert.equal(readsUnder(folderD),1);
 const coldBudgetE=await countReads(folderE,()=>projectIndex(wsE,{projectKey:'e'}));
 assert.equal(readsUnder(folderE),9);
 assert.deepEqual(warmBudget.structuredContent,coldBudgetE.structuredContent);
 assert(warmBudget.structuredContent.labels.includes('sec-w:2'));
 assert(!warmBudget.structuredContent.labels.includes('sec-w:8'));
 assert(!warmBudget.structuredContent.labels.includes('sec-d:2'));
 assert(!warmBudget.structuredContent.labels.includes('sec-d:8'));
 assert(!warmBudget.structuredContent.labels.includes('sec-w:9'));
 const legacyBudgetWs={...wsD};delete legacyBudgetWs.sourceStats;delete legacyBudgetWs.readSources;
 const legacyBudget=await projectIndex(legacyBudgetWs,{projectKey:'d'});
 assert.deepEqual(warmBudget.structuredContent,legacyBudget.structuredContent);
 pass('the 4 MB budget matches the legacy per-file path in source order for cold, warm and mixed caches');
 const mock={status:async()=>({structuredContent:{files:['a.tex','refs.bib','photo.png']}}),read:async({filePath})=>({structuredContent:{content:filePath==='a.tex'?'\\label{eq:one}':'@article{key,}'}})};
 const legacy=await projectIndex(mock,{projectKey:'fixture'});
 assert.deepEqual(legacy.structuredContent.labels,['eq:one']);
 assert.deepEqual(legacy.structuredContent.citations,['key']);
 pass('workspaces without the batch readers keep the original per-file index path');
 await wsA.close();await wsB.close();await wsC.close();await wsD.close();await wsE.close();
 const summary={passed:true,checks,fixtureGenerated:true,coldMs:Number(coldMs.toFixed(2)),repeatedMs:Number(repeatedMs.toFixed(2))};
 fs.writeFileSync('/tmp/overleaf-editor-v060/perf-index-results.json',JSON.stringify(summary,null,2));
 console.log('ALL '+checks+' PERFORMANCE INDEX TESTS PASSED; cold '+coldMs.toFixed(2)+'ms, repeated '+repeatedMs.toFixed(2)+'ms');
})().catch(async e=>{await wsA.close();await wsB.close();await wsC.close();await wsD.close();await wsE.close();console.error(e.stack);process.exitCode=1;});
