'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto');
const createPreview=require('../server/preview');
const createResource=require('../server/resource-preview');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'overleaf-cache-cleanup-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let checks=0;const pass=n=>{checks++;console.log('PASS '+n);};
const buildId=i=>'f'.repeat(24)+'-'+'b'.repeat(32)+i.toString(16).padStart(4,'0');
const CACHE=path.join(root,'cache'),PDIR=path.join(CACHE,'.previews');
const projectRepo=path.join(root,'proj');fs.mkdirSync(projectRepo);
const mainSource='\\documentclass{article}\\begin{document}cleanup\\end{document}\n';
const workspace={snapshot:async(key,dest)=>{fs.mkdirSync(path.join(dest,'sub'),{recursive:true});fs.writeFileSync(path.join(dest,'main.tex'),mainSource);const digest=crypto.createHash('sha256');digest.update('snap');return {files:['main.tex'],revision:'r',sourceHash:digest.digest('hex'),dirty:false,localPath:projectRepo};}};
const getEntry=async()=>({storageId:'f'.repeat(24),projectId:null,type:'local',name:'Cleanup fixture'});
const run=async(cmd,args)=>{
 if(cmd==='tectonic'){const out=args[args.indexOf('--outdir')+1],stem=path.basename(args.at(-1),'.tex');fs.writeFileSync(path.join(out,stem+'.pdf'),Buffer.from('%PDF-1.4 cleanup'));return {ok:true,out:'',err:''};}
 if(cmd==='pdfinfo')return {ok:true,out:'Pages: 2\nPage size: 595 x 842\n',err:''};
 if(cmd==='pdftoppm'){fs.writeFileSync(args.at(-1)+'.png',Buffer.from([137,80,78,71]));return {ok:true,out:'',err:''};}
 return {ok:true,out:'',err:''};};
const preview=createPreview({CACHE_ROOT:CACHE,getEntry,workspace,run,compilerHelper:false});
async function settle(instance,job){let j=job;const end=Date.now()+15000;while(j.status==='building'&&Date.now()<end){await sleep(50);j=instance.status({buildId:j.buildId}).structuredContent;}return j;}
(async()=>{
 for(let i=0;i<6;i++){const id=buildId(i);fs.mkdirSync(path.join(PDIR,id));fs.writeFileSync(path.join(PDIR,id,'status.json'),JSON.stringify({buildId:id,projectKey:'p1',startedAt:new Date(2026,0,1,0,0,i).toISOString(),status:'ready',pages:1,pdfPath:path.join(PDIR,id,'dummy.pdf'),name:'Seed '+i}));fs.writeFileSync(path.join(PDIR,id,'dummy.pdf'),Buffer.from('%PDF-1.4 seed'));}
 const otherId=buildId(90);fs.mkdirSync(path.join(PDIR,otherId));fs.writeFileSync(path.join(PDIR,otherId,'status.json'),JSON.stringify({buildId:otherId,projectKey:'p2',startedAt:new Date(2025,0,1).toISOString(),status:'ready',pages:1,name:'Other'}));
 fs.mkdirSync(path.join(PDIR,'not-a-build'));
 await preview.page({buildId:buildId(0),page:1});
 let job=(await preview.start({projectKey:'p1',force:true})).structuredContent;
 job=await settle(preview,job);assert.equal(job.status,'ready',job.error);
 const exists=i=>fs.existsSync(path.join(PDIR,buildId(i)));
 assert(!exists(1)&&!exists(2));assert(exists(0)&&exists(3)&&exists(4)&&exists(5));
 assert(fs.existsSync(path.join(PDIR,job.buildId))&&fs.existsSync(path.join(PDIR,otherId))&&fs.existsSync(path.join(PDIR,'not-a-build')));
 pass('a successful build keeps the three newest builds and protects recently viewed ones');
 const corrupt=buildId(80);fs.mkdirSync(path.join(PDIR,corrupt));fs.writeFileSync(path.join(PDIR,corrupt,'status.json'),'not json');
 await assert.rejects(async()=>preview.status({buildId:corrupt}),/预览不存在或已损坏/);
 await assert.rejects(async()=>preview.status({buildId:buildId(77)}),/预览不存在或已损坏/);
 pass('missing or corrupt build statuses ask for a recompile');
 const noMain={snapshot:async(key,dest)=>{fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'a.tex'),'no documentclass here\n');const d=crypto.createHash('sha256');d.update('a');return {files:['a.tex'],revision:'r',sourceHash:d.digest('hex'),dirty:false,localPath:projectRepo};}};
 const p2=createPreview({CACHE_ROOT:path.join(root,'c2'),getEntry,workspace:noMain,run,compilerHelper:false});
 let j2=await settle(p2,(await p2.start({projectKey:'q',force:true})).structuredContent);
 assert.equal(j2.status,'failed');assert(j2.error.includes('未找到含 \\documentclass 的主文件'));
 const twoMains={snapshot:async(key,dest)=>{fs.mkdirSync(dest,{recursive:true});for(const f of ['a.tex','b.tex'])fs.writeFileSync(path.join(dest,f),'\\documentclass{article}\n');const d=crypto.createHash('sha256');d.update('ab');return {files:['a.tex','b.tex'],revision:'r',sourceHash:d.digest('hex'),dirty:false,localPath:projectRepo};}};
 const p3=createPreview({CACHE_ROOT:path.join(root,'c3'),getEntry,workspace:twoMains,run,compilerHelper:false});
 let j3=await settle(p3,(await p3.start({projectKey:'q',force:true})).structuredContent);
 assert.equal(j3.status,'failed');assert(j3.error.includes('无法确定主文件：请将主文件命名为 main.tex'));
 pass('main-file detection separates the no-candidate and ambiguous cases');
 const timeoutJob=buildId(70);fs.mkdirSync(path.join(root,'c4','.previews',timeoutJob),{recursive:true});
 fs.writeFileSync(path.join(root,'c4','.previews',timeoutJob,'status.json'),JSON.stringify({buildId:timeoutJob,projectKey:'p1',startedAt:new Date().toISOString(),status:'ready',pages:1,pdfPath:path.join(root,'c4','dummy.pdf'),name:'T'}));
 fs.writeFileSync(path.join(root,'c4','dummy.pdf'),Buffer.from('%PDF-1.4'));
 const p4=createPreview({CACHE_ROOT:path.join(root,'c4'),getEntry,workspace,run:async(cmd,args)=>cmd==='pdftoppm'?{ok:false,out:'',err:'',timedOut:true,timeoutMs:30000}:run(cmd,args),compilerHelper:false});
 await assert.rejects(()=>p4.page({buildId:timeoutJob,page:1}),/操作超时（30 秒）：pdftoppm/);
 pass('preview command timeouts report the timeout duration and command context');
 const RCACHE=path.join(root,'rcache'),RDIR=path.join(RCACHE,'.resources');
 const projRepo2=path.join(root,'proj2');fs.mkdirSync(projRepo2);fs.mkdirSync(RDIR,{recursive:true});
 const resWorkspace={local:async()=>({repo:projRepo2})};
 const resRun=async(cmd,args)=>{if(cmd==='pdfinfo')return {ok:true,out:'Pages: 1\nPage size: 100 x 100\n',err:''};if(cmd==='pdftoppm'){fs.writeFileSync(args.at(-1)+'.png',Buffer.from([1]));return {ok:true,out:'',err:''};}return {ok:true,out:'',err:''};};
 const resource=createResource({workspace:resWorkspace,run:resRun,CACHE_ROOT:RCACHE,bytesLimit:8000});
 for(let i=0;i<5;i++){const d=path.join(RDIR,'seed'+i);fs.mkdirSync(d);fs.writeFileSync(path.join(d,'source.pdf'),Buffer.alloc(2500,i));fs.utimesSync(d,new Date(Date.now()-3600000*(5-i)),new Date(Date.now()-3600000*(5-i)));}
 fs.writeFileSync(path.join(projRepo2,'doc.pdf'),Buffer.from('%PDF-1.4 resource fixture one'));
 const r1=await resource.preview({projectKey:'t',filePath:'doc.pdf',page:1});
 assert.equal(r1.structuredContent.kind,'pdf');
 assert(!fs.existsSync(path.join(RDIR,'seed0'))&&!fs.existsSync(path.join(RDIR,'seed1')));
 assert(['seed2','seed3','seed4'].every(n=>fs.existsSync(path.join(RDIR,n))));
 pass('resource previews evict the least recently used caches above the byte limit');
 fs.writeFileSync(path.join(projRepo2,'doc2.pdf'),Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(1500,2)]));
 await resource.preview({projectKey:'t',filePath:'doc2.pdf',page:1});
 fs.writeFileSync(path.join(projRepo2,'doc3.pdf'),Buffer.concat([Buffer.from('%PDF-1.4 '),Buffer.alloc(1500,3)]));
 const realRm=fs.rmSync;let threw=false;
 fs.rmSync=function(p,...rest){if(!threw&&String(p).includes(path.join('.resources'))){threw=true;throw Error('simulated cleanup failure');}return realRm.call(fs,p,...rest);};
 try{const r3=await resource.preview({projectKey:'t',filePath:'doc3.pdf',page:1});assert.equal(r3.structuredContent.kind,'pdf');}
 finally{fs.rmSync=realRm;}
 assert(threw);
 pass('a failing cache cleanup never breaks the preview flow');
 fs.mkdirSync('/tmp/overleaf-editor-v060',{recursive:true});
 fs.writeFileSync('/tmp/overleaf-editor-v060/cache-cleanup-results.json',JSON.stringify({passed:true,checks},null,2));
 console.log('ALL '+checks+' CACHE CLEANUP TESTS PASSED');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
