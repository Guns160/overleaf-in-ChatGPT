'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{execFile}=require('child_process'),{promisify}=require('util');
const execute=promisify(execFile),root=fs.mkdtempSync(path.join(os.tmpdir(),'overleaf-assets-test-')),project=path.join(root,'project');fs.cpSync(path.join(__dirname,'fixtures','asset-project'),project,{recursive:true});
let rendered=0;async function run(cmd,args,options={}){if(cmd==='pdftoppm')rendered++;try{const r=await execute(cmd,args,{timeout:options.timeoutMs||30000,maxBuffer:12000000});return {ok:true,out:r.stdout,err:r.stderr};}catch(e){return {ok:false,out:e.stdout||'',err:e.stderr||e.message,error:e.code==='ENOENT'?e.message:undefined};}}
const resource=require('../server/resource-preview')({CACHE_ROOT:path.join(root,'cache'),workspace:{local:async key=>{if(key!=='test')throw Error('unknown project');return {repo:project};}},run});
const preview=(file,page=1)=>resource.preview({projectKey:'test',filePath:file,page});let checks=0;async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
 const original=fs.readFileSync(path.join(project,'figures/fig1.png'));
 await check('PNG shows as read-only image',async()=>{const r=await preview('figures/fig1.png');assert.equal(r.structuredContent.kind,'image');assert(r._meta.imageDataUrl.startsWith('data:image/png;base64,'));assert.deepEqual(Buffer.from(r._meta.imageDataUrl.split(',')[1],'base64'),original);});
 await check('PDF renders page 1 with correct page count',async()=>{const r=await preview('figures/fig2_1.pdf');assert.equal(r.structuredContent.pages,2);assert.equal(r.structuredContent.kind,'pdf');assert(r._meta.imageDataUrl.startsWith('data:image/png;base64,'));});
 await check('PDF repeated preview reuses rendered page',async()=>{const before=rendered;await preview('figures/fig2_1.pdf');assert.equal(rendered,before);});
 await check('concurrent PDF page requests render once',async()=>{const before=rendered;const r=await Promise.all([preview('figures/fig2_1.pdf',2),preview('figures/fig2_1.pdf',2)]);assert.equal(rendered,before+1);assert.equal(r[0]._meta.imageDataUrl,r[1]._meta.imageDataUrl);assert.equal(r[0].structuredContent.page,2);});
 await check('PDF-compatible AI renders',async()=>{const r=await preview('figures/B0.ai');assert.equal(r.structuredContent.kind,'illustrator');assert.equal(r.structuredContent.pages,1);});
 await check('legacy AI gives actionable message',()=>assert.rejects(()=>preview('figures/B0bar.ai'),/没有内嵌 PDF/));
 await check('PDF page out of range is rejected',()=>assert.rejects(()=>preview('figures/fig2_1.pdf',3),/页码超出/));
 await check('invalid page values are rejected',async()=>{for(const n of [0,-1,1.5,NaN])await assert.rejects(()=>preview('figures/fig2_1.pdf',n),/页码/);});
 await check('PNG wrong magic cannot serve executable content',async()=>{fs.writeFileSync(path.join(project,'figures/fake.png'),'<svg onload="alert(1)"></svg>');await assert.rejects(()=>preview('figures/fake.png'),/内容与文件格式不符/);});
 await check('unsupported SVG is not injected into DOM',async()=>{fs.writeFileSync(path.join(project,'figures/unsafe.svg'),'<svg/>');await assert.rejects(()=>preview('figures/unsafe.svg'),/暂不支持/);});
 await check('path traversal hidden files absolute and NUL rejected',async()=>{for(const file of ['../outside.png','.git/config','/etc/passwd','figures/'+String.fromCharCode(0)+'.png'])await assert.rejects(()=>preview(file),/路径|无效/);});
 await check('symlink file and symlink parent rejected',async()=>{fs.symlinkSync(path.join(project,'figures/fig1.png'),path.join(project,'figures/link.png'));fs.symlinkSync(path.join(project,'figures'),path.join(project,'shortcut'));await assert.rejects(()=>preview('figures/link.png'),/符号链接/);await assert.rejects(()=>preview('shortcut/fig1.png'),/符号链接/);});
 await check('large file size checked before reading',async()=>{const file=path.join(project,'figures/large.png');fs.writeFileSync(file,'');fs.truncateSync(file,12000001);await assert.rejects(()=>preview('figures/large.png'),/12 MB/);});
 await check('PDF external replacement invalidates preview cache',async()=>{const a=await preview('figures/fig2_2.pdf');fs.copyFileSync(path.join(project,'figures/fig2_1.pdf'),path.join(project,'figures/fig2_2.pdf'));const b=await preview('figures/fig2_2.pdf');assert.notEqual(a.structuredContent.hash,b.structuredContent.hash);assert.equal(b.structuredContent.pages,2);});
 await check('unknown project cannot access preview cache',()=>assert.rejects(()=>resource.preview({projectKey:'other',filePath:'figures/fig1.png'}),/unknown/));
 await check('preview leaves original source bytes unchanged',async()=>assert.deepEqual(fs.readFileSync(path.join(project,'figures/fig1.png')),original));
 fs.writeFileSync('/tmp/overleaf-editor-v060/resource-results.json',JSON.stringify({passed:true,checks,rendered},null,2));console.log('ALL '+checks+' RESOURCE PREVIEW CHECKS PASSED');
})().catch(e=>{console.error(e);process.exitCode=1;});
