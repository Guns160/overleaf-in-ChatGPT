const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {execFile,execFileSync}=require('child_process'),{promisify}=require('util');
const execute=promisify(execFile);
const create=require('../server/workspace');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(cmd,args,opts={}){try{const r=await execute(cmd,args,{cwd:opts.cwd,env:opts.env||process.env,timeout:opts.timeoutMs||30000,maxBuffer:10000000});return {ok:true,out:r.stdout,err:r.stderr};}catch(e){return {ok:false,out:e.stdout||'',err:e.stderr||e.message,error:e.message};}}
const testRoot=fs.mkdtempSync('/tmp/overleaf-sync-test-'),id='111111111111111111111111',key='test-paper';
const remote=path.join(testRoot,'remote.git'),seed=path.join(testRoot,'seed');
function git(cwd,args){return execFileSync('git',['-c','user.name=Test','-c','user.email=test@localhost','-c','commit.gpgsign=false','-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
fs.mkdirSync(seed);git(seed,['init','-b','main']);fs.writeFileSync(path.join(seed,'main.tex'),'base line\n');fs.writeFileSync(path.join(seed,'notes.txt'),'notes base\n');git(seed,['add','.']);git(seed,['commit','-m','Initial']);git(testRoot,['init','--bare',remote]);git(seed,['remote','add','origin',remote]);git(seed,['push','-u','origin','main']);git(remote,['symbolic-ref','HEAD','refs/heads/main']);
const opts={root:path.join(testRoot,'projects'),stateRoot:path.join(testRoot,'state'),getEntry:async k=>{assert.equal(k,key);return {name:'Sync test paper',projectId:id,keychainAccount:id};},run,remoteForEntry:()=>remote,authForEntry:async()=>process.env,syncDelayMs:1000000,retryDelayMs:1000000};
let workspace=create(opts);let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
async function sync(){await workspace.sync({projectKey:key});return (await workspace.waitIdle(key)).structuredContent.sync;}
async function edit(file,content){const r=(await workspace.read({projectKey:key,filePath:file})).structuredContent;return workspace.save({projectKey:key,filePath:file,content,expectedHash:r.hash});}
function upstream(file){return git(remote,['show','main:'+file]);}
function remoteEdit(file,content){git(seed,['pull','--ff-only']);fs.writeFileSync(path.join(seed,file),content);git(seed,['add','--',file]);git(seed,['commit','-m','Remote edit']);git(seed,['push']);}
(async()=>{
 await workspace.open({projectKey:key});let document=(await workspace.read({projectKey:key,filePath:'main.tex'})).structuredContent;assert.equal(document.content,'base line\n');pass('first open creates a persistent local workspace');
 const saves=await Promise.allSettled(['writer A\n','writer B\n'].map(content=>workspace.save({projectKey:key,filePath:'main.tex',content,expectedHash:document.hash})));assert.equal(saves.filter(r=>r.status==='fulfilled').length,1);pass('concurrent stale writes cannot overwrite a newer local save');
 assert.equal((await sync()).status,'synced');assert.equal(upstream('main.tex'),'writer A');pass('local edits push through non-forced Git synchronization');
 fs.renameSync(remote,remote+'.offline');await edit('main.tex','offline local edit\n');const offline=await sync();assert.equal(offline.status,'offline');assert.equal((await workspace.read({projectKey:key,filePath:'main.tex'})).structuredContent.content,'offline local edit\n');pass('offline save succeeds and retains local content when synchronization fails');
 const snap=await workspace.snapshot(key,path.join(testRoot,'snapshot'));assert.equal(fs.readFileSync(path.join(testRoot,'snapshot/main.tex'),'utf8'),'offline local edit\n');pass('compilation snapshot uses local contents without requiring the remote');
 fs.renameSync(remote+'.offline',remote);assert.equal((await sync()).status,'synced');assert.equal(upstream('main.tex'),'offline local edit');pass('reconnection sends edits preserved while offline');
 remoteEdit('notes.txt','remote notes v2\n');assert.equal((await sync()).status,'synced');assert.equal(git(path.join(opts.root,id),['rev-parse','HEAD']),git(remote,['rev-parse','main']));pass('remote-only update fast-forwards without creating an extra commit');
 await edit('main.tex','local separate change\n');remoteEdit('notes.txt','remote non-overlapping change\n');assert.equal((await sync()).status,'synced');assert.equal(upstream('main.tex'),'local separate change');assert.equal(upstream('notes.txt'),'remote non-overlapping change');pass('non-overlapping remote and local edits merge without loss');
 await edit('main.tex','LOCAL conflict version\n');remoteEdit('main.tex','REMOTE conflict version\n');const c=await sync();assert.equal(c.status,'conflict');assert.equal(fs.readFileSync(path.join(opts.root,id,'main.tex'),'utf8'),'LOCAL conflict version\n');assert.equal(upstream('main.tex'),'REMOTE conflict version');assert(!fs.existsSync(path.join(opts.root,id,'.git/MERGE_HEAD')));pass('conflict preserves both versions and leaves the workspace out of a partial merge');
 const diff=(await workspace.conflictDetails({projectKey:key})).structuredContent;assert(diff.versions[0].local.includes('LOCAL'));assert(diff.versions[0].remote.includes('REMOTE'));pass('conflict review supplies both exact source versions');
 await workspace.resolve({projectKey:key,conflictId:c.conflict.id,choices:{'main.tex':'local'}});await workspace.waitIdle(key);assert.equal(upstream('main.tex'),'LOCAL conflict version');pass('explicit keep-local resolution synchronizes the chosen version');
 await edit('main.tex','LOCAL second conflict\n');remoteEdit('main.tex','REMOTE second conflict\n');const c2=await sync();assert.equal(c2.status,'conflict');await workspace.resolve({projectKey:key,conflictId:c2.conflict.id,choices:{'main.tex':'remote'}});await workspace.waitIdle(key);assert.equal(upstream('main.tex'),'REMOTE second conflict');assert.equal(fs.readFileSync(path.join(opts.root,id,'main.tex'),'utf8'),'REMOTE second conflict\n');pass('explicit use-remote resolution updates the local file');
 await assert.rejects(()=>workspace.save({projectKey:key,filePath:'../outside.tex',content:'x',expectedHash:null}));await assert.rejects(()=>workspace.read({projectKey:key,filePath:'.git/config'}));pass('editor cannot write outside the workspace or read Git internals');
 await workspace.save({projectKey:key,filePath:'sections/new.tex',content:'% new local file\n',expectedHash:null});await sync();assert.equal(upstream('sections/new.tex'),'% new local file');pass('new files are created locally and included in synchronization');
 workspace.close();workspace=create({...opts,syncDelayMs:60});await edit('notes.txt','automatic background sync\n');const deadline=Date.now()+10000;while(Date.now()<deadline&&upstream('notes.txt')!=='automatic background sync')await sleep(100);await workspace.waitIdle(key);assert.equal(upstream('notes.txt'),'automatic background sync');pass('saved content synchronizes automatically in the background');
 await edit('notes.txt','local work survives restart\n');workspace.close();workspace=create(opts);assert.equal((await workspace.read({projectKey:key,filePath:'notes.txt'})).structuredContent.content,'local work survives restart\n');await sync();assert.equal(upstream('notes.txt'),'local work survives restart');pass('pending local work survives closing and reopening the editor');
 await edit('notes.txt','finish in-flight synchronization on close\n');await workspace.sync({projectKey:key});await workspace.close();assert.equal(upstream('notes.txt'),'finish in-flight synchronization on close');pass('closing the backend waits for its active synchronization to finish');
 const finalWs=create({...opts,syncDelayMs:40});
 const fdoc=async file=>(await finalWs.read({projectKey:key,filePath:file})).structuredContent;
 await finalWs.save({projectKey:key,filePath:'notes.txt',content:'wait for in-flight sync\n',expectedHash:(await fdoc('notes.txt')).hash});
 const immediate=await finalWs.sync({projectKey:key});
 assert.equal(immediate.structuredContent.sync.status,'synced');assert.equal(upstream('notes.txt'),'wait for in-flight sync');
 pass('sync waits for an in-flight background cycle instead of returning stale state');
 const repoDir=path.join(opts.root,id);
 fs.writeFileSync(path.join(repoDir,'.local-write-stale'),'junk');
 await finalWs.save({projectKey:key,filePath:'notes.txt',content:'sweep temp files\n',expectedHash:(await fdoc('notes.txt')).hash});
 const sweepDeadline=Date.now()+10000;while(Date.now()<sweepDeadline&&upstream('notes.txt')!=='sweep temp files')await sleep(100);
 await finalWs.waitIdle(key);
 assert(!fs.existsSync(path.join(repoDir,'.local-write-stale')));
 assert(fs.readFileSync(path.join(repoDir,'.git/info/exclude'),'utf8').split('\n').includes('/.local-write-*'));
 pass('stale local-write temporaries are swept and excluded from Git');
 fs.writeFileSync(path.join(repoDir,'data.bin'),Buffer.from('local\0binary\n'));
 await finalWs.sync({projectKey:key});await finalWs.waitIdle(key);
 remoteEdit('data.bin','remote\0binary\n');
 fs.writeFileSync(path.join(repoDir,'data.bin'),Buffer.from('local2\0binary\n'));
 await finalWs.save({projectKey:key,filePath:'main.tex',content:'text conflict alongside binary\n',expectedHash:(await fdoc('main.tex')).hash});
 const binConflict=(await finalWs.sync({projectKey:key})).structuredContent.sync;
 assert.equal(binConflict.status,'conflict');
 const binDiff=(await finalWs.conflictDetails({projectKey:key})).structuredContent;
 const binEntry=binDiff.versions.find(v=>v.filePath==='data.bin');
 assert.match(binEntry.local,/^二进制文件（\d+ 字节）/);assert.match(binEntry.remote,/^二进制文件（\d+ 字节）/);
 assert(!binEntry.local.includes('local2\0binary'));assert(!binEntry.remote.includes('remote\0binary'));
 pass('binary conflict versions get a placeholder instead of raw bytes');
 await finalWs.resolve({projectKey:key,conflictId:binConflict.conflict.id,choices:{'data.bin':'local','main.tex':'local'}});
 await finalWs.waitIdle(key);assert(upstream('data.bin').includes('local2'));
 await finalWs.close();pass('binary conflicts resolve through the normal keep-local flow');
 fs.writeFileSync('/tmp/overleaf-sync-test-result.json',JSON.stringify({checks,testRoot,passed:true},null,2));console.log('ALL '+checks+' WORKSPACE TESTS PASSED');
})().catch(e=>{workspace.close();console.error(e.stack);process.exitCode=1;});
