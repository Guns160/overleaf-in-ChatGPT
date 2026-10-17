import {createEditor} from './editor.mjs';
import {createResourceViewer,isResource} from './resource-viewer.mjs';
import {outlineEntries} from './outline.mjs';
import {createProjectManager,bindLocalForm} from './projects.mjs';
const $=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state={projects:[],project:null,file:null,hash:null,dirty:false,saving:null,saveError:null,files:[],sync:{},localPath:null,epoch:0,fileEpoch:0,job:null,page:1,pageEpoch:0,compiling:false,rerun:false,uncompiled:false,conflict:null,tabs:[],readOnly:false,asset:false,error:null,draftError:false};
let changes=0;let seq=1,requestedKey=null,ready=false,saveTimer,compileTimer,polling=false,pendingDraft=null;
const rpc=new Map(),expandedFolders=new Set();let outlineTimer,indexTimer,outline=[],pageObserver,scrollFrame;const pageQueue=[],pageLoading=new Set();let pageWorkers=0;
function request(method,params,timeout=90000){const id=seq++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{rpc.delete(id);reject(Error('请求超时，修改仍保留在编辑器中。'));},timeout);rpc.set(id,{resolve,reject,timer});window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});}
function notify(method,params){window.parent.postMessage({jsonrpc:'2.0',method,params},'*');}
window.addEventListener('message',e=>{if(e.source!==window.parent||e.data?.jsonrpc!=='2.0')return;const m=e.data;if(rpc.has(m.id)){const p=rpc.get(m.id);clearTimeout(p.timer);rpc.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return;}if(m.method==='ui/notifications/tool-input'&&m.params?.arguments?.projectKey)requestedKey=m.params.arguments.projectKey;if(m.method==='ui/notifications/tool-result'&&m.params?.structuredContent?.projectKey){requestedKey=m.params.structuredContent.projectKey;if(ready&&state.project?.key!==requestedKey)openProject(requestedKey);}if(m.method==='ui/notifications/host-context-changed')applyHost(m.params);});
async function tool(name,args={},timeout=90000){const r=await request('tools/call',{name:'overleaf.'+name,arguments:args},timeout);if(r.isError)throw Error(r.content?.find(c=>c.type==='text')?.text||'操作失败');return {...r.structuredContent,_meta:r._meta||{}};}
function applyHost(c={}){for(const k of ['top','right','bottom','left'])document.documentElement.style.setProperty('--safe-'+k,(c.safeAreaInsets?.[k]||0)+'px');}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function draftKey(){return 'overleaf-local:draft:'+(state.project?.projectId||state.project?.key)+':'+state.file;}
let draftTimer=null,draftNoticeShown=false;
function storeDraft(){if(!state.file)return;try{localStorage.setItem(draftKey(),JSON.stringify({content:editor.text(),baseHash:state.hash,at:new Date().toISOString()}));if(state.draftError){state.draftError=false;ui();}}catch(_){if(!draftNoticeShown){draftNoticeShown=true;state.draftError=true;ui();}}}
function scheduleDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{draftTimer=null;storeDraft();},900);}
function clearDraft(){try{localStorage.removeItem(draftKey());}catch(_){}}
function context(){request('ui/update-model-context',{structuredContent:{app:'overleaf-local-editor',projectKey:state.project?.key,projectName:state.project?.name,projectId:state.project?.projectId,filePath:state.file,unsaved:state.dirty,syncStatus:state.sync.status,previewPage:state.page,pages:state.job?.pages,compiledSourceHash:state.job?.sourceHash}},2000).catch(()=>{});}
function ui(){
 $('save-state').textContent=state.saving?'正在保存到本地…':state.dirty?'有未保存修改':state.asset?'只读文件预览':state.file?'✓ 已保存到本地':'本地编辑器';
 $('file-status').textContent=state.saveError?'保存失败 · 草稿已保留':state.dirty?'自动保存中…':state.asset?'图片 / PDF · 只读预览':state.file?'UTF-8 · 本地已保存':'本地保存优先';
 $('file-name').textContent=state.file||'选择文件';$('save').disabled=!state.file||state.asset||!!state.saving;$('new-file').disabled=!state.project;$('compile').disabled=!state.project||state.compiling;
 $('compile-label').textContent=state.compiling?'Compiling…':'Recompile';
 $('download-pdf').disabled=state.job?.status!=='ready';$('editing-mode').textContent=state.readOnly?'Read only':'✎ Editing⌄';
 const s=state.sync.status,labels={local:'本地工作副本',local_only:'仅本地',pending:'等待后台同步',syncing:'正在同步',synced:'已同步 Overleaf',offline:'同步待重试',conflict:'同步冲突'};
 $('sync-button').disabled=state.project?.type==='local';$('open-web').disabled=!state.project?.projectId;
 $('show-local').textContent=state.project?.type==='local'?'本地项目 · 无需登录':'本地工作副本 · 后台同步';
 $('sync-state').textContent=labels[s]||'等待连接';$('sync-button').classList.toggle('warn',s==='pending'||s==='conflict');$('sync-button').classList.toggle('offline',s==='offline');
 $('sync-button').title=state.sync.error||(state.sync.lastSyncedAt?'上次同步：'+new Date(state.sync.lastSyncedAt).toLocaleString('zh-CN'):'自动将本地修改同步到 Overleaf');
 $('file-status').title=state.saveError||state.error||'';
 $('notice').hidden=!state.saveError&&!state.draftError&&!state.error&&s!=='conflict'&&s!=='offline';
 if(state.saveError){$('notice-text').textContent=state.saveError;$('review-conflicts').textContent='比较文件版本';}
 else if(s==='conflict'){$('notice-text').textContent='本地和 Overleaf 有冲突，双方修改均已保留。';$('review-conflicts').textContent='查看差异';}
 else if(s==='offline'){$('notice-text').textContent='暂时无法同步，修改已保存在本地。后台将自动重试。';$('review-conflicts').textContent='查看详情';}
 else if(state.draftError){$('notice-text').textContent='本地草稿保存失败（存储空间可能不足）。修改或保存时会自动重试。';$('review-conflicts').textContent='重试保存草稿';}
 else if(state.error){$('notice-text').textContent=state.error;$('review-conflicts').textContent='知道了';}
 const pdf=state.job?.status==='ready';$('page').disabled=!pdf;$('page').value=state.page;$('page').max=state.job?.pages||1;$('pages').textContent='/ '+(pdf?state.job.pages:'—');$('prev').disabled=!pdf||state.page<=1;$('next').disabled=!pdf||state.page>=state.job.pages;
 if(state.uncompiled&&!state.compiling){$('build-status').textContent='有未编译的本地修改';$('build-status').title='重新编译以更新 PDF';}
 const activeTab=$('file-tabs').querySelector('.file-tab.active');if(activeTab)activeTab.classList.toggle('dirty',state.dirty);
}
const editor=createEditor($('editor'),()=>{changes++;state.dirty=true;state.uncompiled=true;state.saveError=null;scheduleDraft();scheduleOutline();ui();clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveCurrent().catch(()=>{}),900);},()=>saveCurrent().catch(()=>{}),()=>compile(true), (line,col)=>{$('cursor').textContent='行 '+line+'，列 '+col;highlightOutline(line);});

const resourceViewer=createResourceViewer({tool,onLoaded(info){if(state.asset&&info.filePath===state.file){state.hash=info.hash;ui();context();}},onError:showError});
async function openResource(file,{skipSave=false}={}){
 if(!skipSave)await saveCurrent();const epoch=++state.fileEpoch,key=state.project.key;if($('workspace').classList.contains('layout-pdf'))layout(window.innerWidth<720?'editor':'split');state.asset=true;state.file=file;state.hash=null;state.dirty=false;state.saveError=null;editor.set('',{fileId:key+':'+file});editor.editable(false);$('editor').hidden=true;$('workspace').classList.add('resource-active');if(!state.tabs.includes(file))state.tabs.push(file);renderTree();renderTabs();renderOutline();ui();context();if(window.innerWidth<650){$('tree-pane').hidden=true;$('workspace').classList.add('no-files');}const info=await resourceViewer.open(key,file);if(epoch!==state.fileEpoch||key!==state.project.key)return;if(info)state.hash=info.hash;ui();
}
function renderTree(){const root={dirs:new Map(),files:[]};for(const file of state.files){let node=root;const parts=file.split('/');for(const name of parts.slice(0,-1)){if(!node.dirs.has(name))node.dirs.set(name,{dirs:new Map(),files:[]});node=node.dirs.get(name);}node.files.push({name:parts.at(-1),path:file});}
 function render(node,parent,prefix=''){for(const [name,child] of node.dirs){const folderPath=prefix?prefix+'/'+name:name;const d=el('details');d.open=expandedFolders.has(folderPath);d.addEventListener('toggle',()=>{if(d.open)expandedFolders.add(folderPath);else expandedFolders.delete(folderPath);});const summary=el('summary',null,name);d.append(summary);const inner=el('div','folder-children');render(child,inner,folderPath);d.append(inner);parent.append(d);}for(const f of node.files){const b=el('button','file'+(f.path===state.file?' active':''));b.title=f.path;b.setAttribute('aria-label',f.path);const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('class','icon file-icon');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',isResource(f.path)?'#i-image':'#i-file');icon.append(use);b.append(icon,el('span',null,f.name));b.onclick=()=>openFile(f.path).catch(showError);parent.append(b);}}$('tree').replaceChildren();render(root,$('tree'));}
function showError(e){const msg=e?.message||String(e);state.error=msg;$('file-status').textContent=msg;$('file-status').title=msg;$('notice-text').textContent=msg;$('review-conflicts').textContent='知道了';$('notice').hidden=false;}
async function saveCurrent(){
 clearTimeout(saveTimer);if(state.saving){await state.saving;if(state.dirty)return saveCurrent();return;}
 if(!state.dirty||!state.file||state.asset)return;
 const key=state.project.key,file=state.file,text=editor.text(),expectedHash=state.hash;storeDraft();
 const task=(async()=>{try{const r=await tool('saveFile',{projectKey:key,filePath:file,content:text,expectedHash});if(state.project.key!==key||state.file!==file)return;state.hash=r.hash;state.sync=r.sync;state.dirty=editor.text()!==text;state.saveError=null;state.error=null;if(!state.dirty){clearDraft();scheduleIndex();if($('auto').checked){clearTimeout(compileTimer);compileTimer=setTimeout(()=>compile(false),1600);}}else storeDraft();context();}
 catch(e){state.saveError=e.message;storeDraft();if(/文件已/.test(e.message))await compareDraft().catch(()=>{});throw e;}finally{state.saving=null;ui();}})();state.saving=task;ui();return task;
}
async function compareDraft(){const disk=await tool('readFile',{projectKey:state.project.key,filePath:state.file});pendingDraft={content:editor.text(),disk};renderDiff($('draft-old'),$('draft-disk'),pendingDraft.content,disk.content);$('draft-dialog').showModal();}
function diffRows(a,b){const A=String(a??'').split('\n'),B=String(b??'').split('\n'),n=A.length,m=B.length;if(n*m>4e6)return null;const w=m+1,dp=new Int32Array((n+1)*w);for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i*w+j]=A[i]===B[j]?dp[(i+1)*w+j+1]+1:Math.max(dp[(i+1)*w+j],dp[i*w+j+1]);const rows=[];let i=0,j=0;while(i<n&&j<m){if(A[i]===B[j]){rows.push({l:A[i],r:B[j]});i++;j++;}else if(dp[(i+1)*w+j]>=dp[i*w+j+1]){rows.push({l:A[i],cls:'del'});i++;}else{rows.push({r:B[j],cls:'add'});j++;}}while(i<n)rows.push({l:A[i++],cls:'del'});while(j<m)rows.push({r:B[j++],cls:'add'});return rows;}
const diffSynced=new WeakSet();
function renderDiff(left,right,oldText,newText){const rows=diffRows(oldText,newText);left.replaceChildren();right.replaceChildren();if(!rows){left.textContent=String(oldText??'');right.textContent=String(newText??'');}else{const shown=rows.length>3000?rows.slice(0,3000):rows;const mk=(cls,text)=>{const d=el('div',cls?'diff-line '+cls:'diff-line');d.textContent=text;return d;};for(const row of shown){left.append(row.l===undefined?el('div','diff-pad'):mk(row.cls,row.l));right.append(row.r===undefined?el('div','diff-pad'):mk(row.cls,row.r));}if(rows.length>3000){left.append(el('div','diff-trunc','… 差异超过 3000 行，已截断显示'));right.append(el('div','diff-trunc','… 差异超过 3000 行，已截断显示'));}}if(!diffSynced.has(left)){diffSynced.add(left);left.addEventListener('scroll',()=>{if(right.scrollTop!==left.scrollTop)right.scrollTop=left.scrollTop;},{passive:true});right.addEventListener('scroll',()=>{if(left.scrollTop!==right.scrollTop)left.scrollTop=right.scrollTop;},{passive:true});}}
function editorExpectedEditable(){return !!(state.file&&!state.asset&&!state.readOnly);}
function viewConsistent(){const asset=!!state.asset;return editor.view.state.readOnly===!editorExpectedEditable()&&$('editor').hidden===asset&&$('workspace').classList.contains('resource-active')===asset;}
function restoreView(){editor.editable(editorExpectedEditable());if(state.asset){$('editor').hidden=true;$('workspace').classList.add('resource-active');}else{$('editor').hidden=false;$('workspace').classList.remove('resource-active');resourceViewer.hide();}ui();}
async function openFile(file,{skipSave=false}={}){
 if(file===state.file&&!skipSave){if(!viewConsistent())restoreView();if(state.asset)resourceViewer.refresh();else editor.focus();return;}
 if(isResource(file)){await openResource(file,{skipSave});return;}
 if(!/\.(tex|bib|bst|bbl|cls|sty|txt|md|json|ya?ml|csv)$/i.test(file)){showError(Error('该文件为图片或二进制资源，当前源码编辑器只编辑文本文件。'));return;}
 if(!skipSave)await saveCurrent();const epoch=++state.fileEpoch,key=state.project.key;editor.editable(false);$('file-status').textContent='正在读取本地文件…';
 let r;try{r=await tool('readFile',{projectKey:key,filePath:file});}finally{if(epoch===state.fileEpoch&&key===state.project?.key)restoreView();}
 if(epoch!==state.fileEpoch||key!==state.project.key)return;
 resourceViewer.hide();state.asset=false;$('workspace').classList.remove('resource-active');$('editor').hidden=false;clearTimeout(draftTimer);
 state.file=file;state.hash=r.hash;state.dirty=false;state.saveError=null;state.error=null;editor.set(r.content,{fileId:key+':'+file});editor.editable(!state.readOnly);if(!state.tabs.includes(file))state.tabs.push(file);renderTree();renderTabs();renderOutline();
 let draft;try{draft=JSON.parse(localStorage.getItem(draftKey())||'null');}catch(_){}
 if(draft&&draft.content!==r.content){
  if(draft.baseHash===r.hash){editor.set(draft.content);state.dirty=true;state.uncompiled=true;saveTimer=setTimeout(()=>saveCurrent().catch(()=>{}),1200);}
  else{pendingDraft={content:draft.content,disk:r};renderDiff($('draft-old'),$('draft-disk'),draft.content,r.content);$('draft-dialog').showModal();}
 }
 if(window.innerWidth<650){$('workspace').classList.add('no-files');$('tree-pane').hidden=true;}ui();context();
}
async function openProject(key){
 const project=state.projects.find(p=>p.key===key);if(!project)return;
 try{await saveCurrent();}catch(e){$('project').value=state.project?.key||key;return;}
 const prev={project:state.project,files:state.files,sync:state.sync};
 clearTimeout(compileTimer);clearTimeout(indexTimer);clearTimeout(draftTimer);resourceViewer.hide();state.asset=false;$('workspace').classList.remove('resource-active');$('editor').hidden=false;const epoch=++state.epoch;state.fileEpoch++;state.pageEpoch++;state.tabs=[];state.page=1;state.error=null;editor.suggestions({});pageObserver?.disconnect();$('pdf-pages').hidden=true;state.project=project;state.file=null;state.hash=null;state.dirty=false;state.job=null;state.compiling=false;state.rerun=false;state.sync={status:'local'};state.uncompiled=false;editor.set('',{fileId:null});editor.editable(false);$('project').value=key;$('tree').replaceChildren(el('div',null,'正在打开本地项目…'));if($('paper'))$('paper').hidden=true;$('placeholder').hidden=false;$('placeholder').textContent='正在准备本地工作副本…';$('compile-log').hidden=true;ui();
 try{const r=await tool('openProject',{projectKey:key});if(epoch!==state.epoch)return;state.files=r.files;state.sync=r.sync;state.localPath=r.localPath;renderTree();try{localStorage.setItem('overleaf-local:last-project',key);}catch(_){}await openFile(state.project.mainFile||(state.files.includes('main.tex')?'main.tex':state.files.find(f=>f.endsWith('.tex'))),{skipSave:true});compile(false);scheduleIndex();ui();context();}
 catch(e){if(epoch!==state.epoch)return;state.project=prev.project;state.files=prev.files;state.sync=prev.sync;$('project').value=prev.project?.key||'';showError(e);ui();const box=el('div','tree-error');box.append(el('p',null,'项目打开失败：'+e.message));const retry=el('button','button','重试打开');retry.onclick=()=>openProject(key);box.append(retry);if(prev.project){renderTree();$('tree').prepend(box);}else $('tree').replaceChildren(box);$('placeholder').hidden=false;$('placeholder').textContent='项目打开失败，可点击文件树中的"重试打开"。';renderTabs();renderOutline();context();}
}
async function refreshStatus(){
 if(!state.project||polling||document.hidden)return;polling=true;const key=state.project.key,file=state.file;
 try{const r=await tool('projectStatus',{projectKey:key,...(file?{filePath:file}:{})});if(key!==state.project.key)return;if(state.error)state.error=null;state.sync=r.sync;state.localPath=r.localPath;if(JSON.stringify(r.files)!==JSON.stringify(state.files)){state.files=r.files;renderTree();scheduleIndex();}
  if(file&&file===state.file&&r.fileHash!==state.hash&&!state.dirty&&!state.saving&&!$('draft-dialog').open){if(state.asset){await resourceViewer.refresh();}else{await openFile(file,{skipSave:true});state.uncompiled=true;if($('auto').checked)compile(false);}}
  ui();
 }catch(e){showError(e);}finally{polling=false;}
}
async function syncNow(){try{await saveCurrent();if(!state.project)return;await tool('syncProject',{projectKey:state.project.key});state.sync={...state.sync,status:'syncing'};ui();setTimeout(refreshStatus,700);}catch(e){showError(e);}}

function scale(){const width=$('zoom').value==='fit'?Math.max(160,$('reader').clientWidth-28):Math.round(816*Number($('zoom').value));$('pdf-pages').style.width=width+'px';}
function queuePage(n,job){if(job!==state.job||pageLoading.has(job.buildId+':'+n))return;const node=$('pdf-pages').querySelector('[data-page="'+n+'"]');if(!node||node.dataset.loaded)return;pageLoading.add(job.buildId+':'+n);pageQueue.push({n,job,node});pumpPages();}
function pumpPages(){while(pageWorkers<2&&pageQueue.length){const {n,job,node}=pageQueue.shift();if(job!==state.job){pageLoading.delete(job.buildId+':'+n);continue;}pageWorkers++;tool('previewPage',{buildId:job.buildId,page:n}).then(r=>{if(job!==state.job||!node.isConnected)return;if(!r._meta.pageDataUrl)throw Error('未收到 PDF 页面');const img=node.querySelector('img');img.src=r._meta.pageDataUrl;img.hidden=false;node.dataset.loaded='true';node.querySelector('.page-loading')?.remove();}).catch(e=>{if(node.isConnected){node.querySelector('.page-loading').textContent='页面载入失败，点击重试';node.onclick=()=>{node.onclick=null;queuePage(n,job);};}showError(e);}).finally(()=>{pageLoading.delete(job.buildId+':'+n);pageWorkers--;pumpPages();});}}
function mountPages(job){pageObserver?.disconnect();pageQueue.length=0;$('pdf-pages').replaceChildren();const nodes=[];for(let n=1;n<=job.pages;n++){const wrapper=el('div','pdf-page');wrapper.dataset.page=n;wrapper.setAttribute('aria-label','PDF 第 '+n+' 页');wrapper.style.aspectRatio=String(job.pageRatio||0.7071);const img=el('img');if(n===1)img.id='paper';img.hidden=true;img.alt='PDF 第 '+n+' 页';wrapper.append(img,el('div','page-loading','正在载入第 '+n+' 页…'));nodes.push(wrapper);}$('pdf-pages').append(...nodes);$('pdf-pages').hidden=false;$('placeholder').hidden=true;scale();pageObserver=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting)queuePage(Number(item.target.dataset.page),job);},{root:$('reader'),rootMargin:'700px 0px'});nodes.forEach(n=>pageObserver.observe(n));}
async function showPage(n){const job=state.job;if(job?.status!=='ready')return;state.page=Math.max(1,Math.min(job.pages,Math.floor(Number(n)||1)));const node=$('pdf-pages').querySelector('[data-page="'+state.page+'"]');if(node){$('reader').scrollTop=node.offsetTop-$('pdf-pages').offsetTop;queuePage(state.page,job);}ui();context();}
$('reader').addEventListener('scroll',()=>{if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;if(!state.job)return;const top=$('reader').getBoundingClientRect().top+30;let active=1;for(const node of $('pdf-pages').children){if(node.getBoundingClientRect().top<=top)active=Number(node.dataset.page);else break;}if(active!==state.page){state.page=active;ui();context();}});},{passive:true});
async function compile(force=false){
 if(!state.project)return;if(state.compiling){state.rerun=true;return;}
 try{await saveCurrent();}catch(_){return;}clearTimeout(compileTimer);
 const epoch=state.epoch,key=state.project.key,compiledChanges=changes;let compilePoll=0;state.compiling=true;state.rerun=false;ui();$('build-status').textContent='正在编译本地文件…';
 try{let job=await tool('startPreview',{projectKey:key,force});while(epoch===state.epoch){
  if(job.status==='ready'){state.job=job;state.uncompiled=changes!==compiledChanges||state.dirty;$('log').textContent=job._meta.compileLog||'';$('compile-log').hidden=!job.hasLog;$('build-status').textContent='本地编译 · '+new Date(job.compiledAt).toLocaleTimeString('zh-CN',{hour12:false});$('build-status').title='来源：本地文件 · '+(String(job.sourceHash||'').slice(0,12)||'来源未知');mountPages(job);await showPage(Math.min(state.page,job.pages));break;}
  if(job.status==='failed'){$('log').textContent=job._meta.compileLog||job.error;$('compile-log').hidden=false;throw Error(job.error||'编译失败');}
  if(compilePoll>=250)throw Error('编译状态等待超过约 5 分钟，已停止轮询。请重新编译。');$('build-status').textContent=job.phase||'正在编译…';await sleep(Math.min(250*(2**compilePoll),1200));compilePoll++;if(epoch!==state.epoch)return;job=await tool('previewStatus',{buildId:job.buildId});
 }}catch(e){if(epoch===state.epoch){$('build-status').textContent='编译失败 · 查看日志';if(!$('log').textContent)$('log').textContent=e.message;$('compile-log').hidden=false;$('compile-log').open=true;if(!state.job){$('placeholder').hidden=false;$('placeholder').textContent='编译未成功。源文件已保存在本地，可查看编译日志。';}}}
 finally{if(epoch===state.epoch){state.compiling=false;ui();if(state.rerun){state.rerun=false;compileTimer=setTimeout(()=>compile(true),300);}}}
}
async function reviewConflicts(){
 if(state.saveError){await compareDraft();return;}
 if(state.draftError){storeDraft();return;}
 if(state.error&&state.sync.status!=='conflict'&&state.sync.status!=='offline'){state.error=null;ui();return;}
 if(state.sync.status!=='conflict'){$('local-path').textContent=state.localPath+'\n\n'+(state.sync.error||'');$('info-dialog').showModal();return;}
 try{await saveCurrent();const r=await tool('conflictDetails',{projectKey:state.project.key});state.conflict=r;$('conflict-content').replaceChildren();for(const v of r.versions){
   const h=el('div','conflict-file');h.append(el('strong',null,v.filePath));const select=el('select');select.dataset.file=v.filePath;select.setAttribute('aria-label',v.filePath+' 冲突选择');select.append(new Option('请选择保留版本',''),new Option('保留本地','local'),new Option('采用 Overleaf','remote'));select.onchange=()=>{$('apply-conflicts').disabled=[...$('conflict-content').querySelectorAll('select')].some(s=>!s.value);};h.append(select);
   const diff=el('div','diff'),left=el('div','diff-column'),right=el('div','diff-column'),leftPre=el('div','diff-pre'),rightPre=el('div','diff-pre');left.append(el('strong',null,'本地文件'),leftPre);right.append(el('strong',null,'Overleaf 文件'),rightPre);if(v.local!=null&&v.remote!=null)renderDiff(leftPre,rightPre,v.local,v.remote);else{leftPre.textContent=v.local??'（该版本已删除文件）';rightPre.textContent=v.remote??'（该版本已删除文件）';}diff.append(left,right);$('conflict-content').append(h,diff);
  }$('apply-conflicts').disabled=true;$('conflicts-dialog').showModal();
 }catch(e){showError(e);}
}
async function applyConflicts(all=null){
 const choices={};for(const s of $('conflict-content').querySelectorAll('select')){choices[s.dataset.file]=all||s.value;}
 for(const id of ['all-local','all-remote','apply-conflicts'])$(id).disabled=true;
 try{await tool('resolveConflicts',{projectKey:state.project.key,conflictId:state.conflict.conflictId,choices});$('conflicts-dialog').close();await refreshStatus();if(state.file)await openFile(state.file,{skipSave:true});if($('auto').checked)compile(false);}
 catch(e){$('notice-text').textContent=e.message;showError(e);}
 finally{for(const id of ['all-local','all-remote','apply-conflicts'])$(id).disabled=false;}
}
function layout(mode){document.querySelectorAll('.menu[open]').forEach(m=>m.open=false);$('workspace').classList.remove('layout-editor','layout-pdf');if(mode!=='split')$('workspace').classList.add('layout-'+mode);document.querySelectorAll('[data-layout]').forEach(b=>b.classList.toggle('active',b.dataset.layout===mode));requestAnimationFrame(scale);}
document.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>layout(b.dataset.layout));
$('toggle-files').onclick=()=>{const hidden=!$('tree-pane').hidden;$('tree-pane').hidden=hidden;$('workspace').classList.toggle('no-files',hidden);requestAnimationFrame(scale);};
$('save').onclick=()=>saveCurrent().catch(showError);$('compile').onclick=()=>compile(true);$('project').onchange=()=>openProject($('project').value).catch(showError);$('sync-button').onclick=syncNow;
$('prev').onclick=()=>showPage(state.page-1);$('next').onclick=()=>showPage(state.page+1);$('page').onchange=()=>showPage($('page').value);$('zoom').onchange=scale;window.addEventListener('resize',()=>{scale();editor.view.requestMeasure();});
$('review-conflicts').onclick=()=>reviewConflicts().catch(showError);$('all-local').onclick=()=>applyConflicts('local');$('all-remote').onclick=()=>applyConflicts('remote');$('apply-conflicts').onclick=()=>applyConflicts();
$('open-web').onclick=()=>state.project&&request('ui/open-link',{url:'https://www.overleaf.com/project/'+state.project.projectId}).catch(showError);
$('show-local').onclick=()=>{$('local-path').textContent=state.localPath||'';$('info-dialog').showModal();};
$('new-file').onclick=async()=>{try{await saveCurrent();$('new-path').value='';$('new-error').textContent='';$('new-dialog').showModal();$('new-path').focus();}catch(e){showError(e);}};
bindLocalForm('new-form','new-file-submit',async e=>{e.preventDefault();try{const file=$('new-path').value.trim();if(!file)throw Error('请输入文件名');await tool('saveFile',{projectKey:state.project.key,filePath:file,content:'',expectedHash:null});$('new-dialog').close();await refreshStatus();await openFile(file);}catch(e){$('new-error').textContent=e.message;}});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('restore-draft').onclick=()=>{if(!pendingDraft)return;clearTimeout(draftTimer);state.hash=pendingDraft.disk.hash;editor.set(pendingDraft.content);state.dirty=true;state.uncompiled=true;state.saveError=null;storeDraft();$('draft-dialog').close();pendingDraft=null;saveTimer=setTimeout(()=>saveCurrent().catch(showError),900);ui();};
$('discard-draft').onclick=()=>{if(!pendingDraft)return;clearTimeout(draftTimer);state.hash=pendingDraft.disk.hash;editor.set(pendingDraft.disk.content);state.dirty=false;state.saveError=null;clearDraft();$('draft-dialog').close();pendingDraft=null;ui();};
window.addEventListener('beforeunload',()=>{clearTimeout(draftTimer);if(state.dirty)storeDraft();});
function setProjects(projects){state.projects=projects;$('project').replaceChildren(...projects.map(p=>new Option(p.name,p.key)));if(state.project&&projects.some(p=>p.key===state.project.key))$('project').value=state.project.key;}
const manager=createProjectManager({tool,request,saveCurrent,onProjects:setProjects,activate:openProject,showError});
const closeTab=async file=>{try{if(file===state.file)await saveCurrent();state.tabs=state.tabs.filter(f=>f!==file);if(file===state.file){if(state.tabs.length)await openFile(state.tabs.at(-1));else{state.file=null;state.hash=null;state.asset=false;resourceViewer.hide();$('workspace').classList.remove('resource-active');$('editor').hidden=false;editor.set('',{fileId:null});editor.editable(false);renderTree();renderOutline();}}renderTabs();ui();}catch(e){showError(e);}};
function renderTabs(){$('file-tabs').replaceChildren();for(const file of state.tabs){const tab=el('div','file-tab'+(file===state.file?' active':''));tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(file===state.file));tab.tabIndex=0;tab.title=file;const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('class','icon');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-file');icon.append(use);const label=el('span',null,file.split('/').at(-1)),dot=el('span','tab-dot'),close=el('button','tab-close','×');close.setAttribute('aria-label','关闭 '+file);tab.append(icon,dot,label,close);tab.onclick=()=>openFile(file).catch(showError);tab.onkeydown=e=>{if(e.key==='Enter'&&e.target===tab)openFile(file).catch(showError);};tab.onmousedown=e=>{if(e.button===1)e.preventDefault();};tab.onauxclick=e=>{if(e.button===1){e.preventDefault();e.stopPropagation();closeTab(file);}};close.onclick=e=>{e.stopPropagation();closeTab(file);};$('file-tabs').append(tab);}}
function renderOutline(){if(state.asset){outline=[];$('outline').replaceChildren(el('div','outline-empty','图片 / PDF 预览'));return;}outline=outlineEntries(editor.text());$('outline').replaceChildren();for(const item of outline){const b=el('button',null,item.title);b.style.paddingLeft=(10+item.level*14)+'px';b.dataset.position=item.position;b.onclick=()=>editor.go(item.position);$('outline').append(b);}if(!outline.length)$('outline').append(el('div','outline-empty',state.file?'当前文件没有章节标题':'选择 LaTeX 文件查看大纲'));}
function scheduleOutline(){clearTimeout(outlineTimer);outlineTimer=setTimeout(renderOutline,220);}
function highlightOutline(line){if(!outline.length)return;const position=editor?.view.state.doc.line(Math.min(line,editor.view.state.doc.lines)).from||0;let active=null;for(const item of outline)if(item.position<=position)active=item;for(const b of $('outline').children)b.classList.toggle('active',!!active&&Number(b.dataset.position)===active.position);}
async function refreshIndex(){if(!state.project)return;const key=state.project.key;try{const r=await tool('completionIndex',{projectKey:key});if(state.project?.key===key)editor.suggestions(r);}catch(e){showError(e);}}
function scheduleIndex(){clearTimeout(indexTimer);indexTimer=setTimeout(refreshIndex,800);}
function setReadonly(value){state.readOnly=value;editor.editable(!!state.file&&!state.asset&&!value);$('readonly-setting').checked=value;try{localStorage.setItem('overleaf-local:readonly',value?'1':'0');}catch(_){}ui();}
function toggleOutline(){$('workspace').classList.toggle('no-outline');}
async function downloadPDF(){if(state.job?.status!=='ready')throw Error('请先编译 PDF。');const r=await tool('exportPreview',{buildId:state.job.buildId});$('export-path').textContent=r.filePath;$('export-dialog').showModal();}
async function command(name){
 const managerActions={'open-local':'open-local','create-local':'create-local','import-remote':'import-remote'};
 if(managerActions[name]){await manager.action(managerActions[name]);return;}
 if(name==='projects'){$('project-manager').click();return;}if(name==='save'){await saveCurrent();return;}if(name==='compile'){compile(true);return;}if(name==='files'){$('toggle-files').click();return;}if(name==='outline'){toggleOutline();return;}if(name==='local'){$('show-local').click();return;}if(name==='settings'){$('settings-dialog').showModal();return;}if(name==='help'){$('help-dialog').showModal();return;}if(name==='upload'){$('upload-input').click();return;}if(name==='download'){await downloadPDF();return;}
 if(!state.file||state.asset)return;
 if(['undo','redo','search','comment'].includes(name)){editor.action(name);return;}if(name==='complete'||name==='symbol'){editor.complete();return;}
 if(state.readOnly)return;
 const wraps={bold:'textbf',italic:'textit',emph:'emph',section:'section',ref:'ref',cite:'cite',label:'label'};
 if(wraps[name]){editor.wrap(wraps[name],name==='section'?'Title':name==='label'?'eq:label':'');if(name==='ref'||name==='cite')editor.complete();return;}
 const inserts={equation:'\\begin{equation}\n  \n\\end{equation}',figure:'\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=\\linewidth]{figures/plot.pdf}\n  \\caption{Caption}\n  \\label{fig:label}\n\\end{figure}',table:'\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{cc}\n    A & B \\\\\n  \\end{tabular}\n  \\caption{Caption}\n\\end{table}',itemize:'\\begin{itemize}\n  \\item \n\\end{itemize}',link:'\\href{https://example.com}{text}'};
 if(inserts[name])editor.insert(inserts[name]);
}
document.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.menu[open]').forEach(m=>m.open=false);command(b.dataset.command).catch(showError);});
document.addEventListener('pointerdown',e=>{for(const menu of document.querySelectorAll('.menu[open]'))if(!menu.contains(e.target))menu.open=false;});
document.querySelectorAll('.menu').forEach(menu=>menu.addEventListener('toggle',()=>{if(menu.open)for(const other of document.querySelectorAll('.menu[open]'))if(other!==menu&&!other.contains(menu))other.open=false;}));
const commands={'rail-search':'search','rail-outline':'outline','rail-help':'help','rail-settings':'settings','tool-complete':'complete','tool-undo':'undo','tool-redo':'redo','tool-link':'link','tool-comment':'comment','tool-label':'label','tool-search':'search','upload-file':'upload','download-pdf':'download'};
for(const [id,name] of Object.entries(commands))$(id).onclick=()=>command(name).catch(showError);
$('close-tree').onclick=()=>$('toggle-files').click();$('new-folder').onclick=()=>{$('new-file').click();$('new-path').placeholder='sections/introduction.tex';};
$('outline-heading').onclick=()=>{$('outline').hidden=!$('outline').hidden;};$('collapse-tree').onclick=()=>{$('tree').hidden=!$('tree').hidden;};
$('toggle-log').onclick=()=>{const show=$('compile-log').hidden;$('compile-log').hidden=!show;$('compile-log').open=show;if(!$('log').textContent)$('log').textContent='尚无编译日志。';};
$('editing-mode').onclick=()=>setReadonly(!state.readOnly);$('readonly-setting').onchange=()=>setReadonly($('readonly-setting').checked);
$('font-size').onchange=()=>{editor.fontSize(Number($('font-size').value)||null);try{localStorage.setItem('overleaf-local:font-size',$('font-size').value);}catch(_){}};
try{const size=localStorage.getItem('overleaf-local:font-size');if(size){$('font-size').value=size;editor.fontSize(Number(size));}}catch(_){}
try{const savedAuto=localStorage.getItem('overleaf-local:auto-compile');if(savedAuto!==null)$('auto').checked=savedAuto!=='0';}catch(_){}
try{const savedReadonly=localStorage.getItem('overleaf-local:readonly');if(savedReadonly!==null)setReadonly(savedReadonly==='1');}catch(_){}
$('auto').onchange=()=>{try{localStorage.setItem('overleaf-local:auto-compile',$('auto').checked?'1':'0');}catch(_){}};
function zoomBy(amount){const fit=($('reader').clientWidth-28)/816,current=$('zoom').value==='fit'?fit:Number($('zoom').value),target=Math.max(.25,Math.min(3,Math.round((current+amount)*100)/100));let option=[...$('zoom').options].find(o=>Number(o.value)===target);if(!option){option=new Option(Math.round(target*100)+'%',String(target));$('zoom').append(option);}$('zoom').value=String(target);scale();}
$('zoom-in').onclick=()=>zoomBy(.1);$('zoom-out').onclick=()=>zoomBy(-.1);
function drag(id,update,measure){$(id).onpointerdown=e=>{const node=e.currentTarget;node.setPointerCapture(e.pointerId);const initial={x:e.clientX,y:e.clientY,...(measure?measure():{width:$('tree-pane').getBoundingClientRect().width,height:$('tree-top').getBoundingClientRect().height})};const move=m=>update(m,initial),end=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',end);};node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);};}
drag('tree-divider',(e,s)=>{$('workspace').style.setProperty('--files',Math.max(180,Math.min(window.innerWidth*.4,s.width+e.clientX-s.x))+'px');scale();});
drag('outline-divider',(e,s)=>{$('tree-pane').style.setProperty('--tree-height',Math.max(80,Math.min($('tree-pane').clientHeight-110,s.height+e.clientY-s.y))+'px');});
drag('divider',(e,s)=>{const width=Math.min(s.total-160,Math.max(180,s.width+e.clientX-s.x));$('panes').style.setProperty('--editor',(Math.min(s.total-168,width)/s.total*100)+'%');scale();},()=>({width:$('editor-pane').getBoundingClientRect().width,total:$('panes').clientWidth}));
$('upload-input').onchange=async()=>{const files=[...$('upload-input').files];$('upload-input').value='';if(!files.length)return;try{await saveCurrent();if(!state.project)return;const done=[],failed=[];for(const file of files){try{if(file.size>1500000)throw Error('超过 1.5 MB 上限');if(!/\.(tex|bib|bst|bbl|cls|sty|txt|md|json|ya?ml|csv)$/i.test(file.name))throw Error('不是支持的文本文件类型');await tool('saveFile',{projectKey:state.project.key,filePath:file.name,content:await file.text(),expectedHash:null});done.push(file.name);}catch(e){failed.push(file.name+'：'+e.message);}}await refreshStatus();scheduleIndex();const box=$('upload-result');box.replaceChildren();box.append(el('p',null,'成功导入 '+done.length+' 个文件'+(failed.length?'，失败 '+failed.length+' 个：':'。')));for(const item of failed)box.append(el('div','upload-fail',item));$('upload-dialog').showModal();}catch(e){showError(e);}};
ui();if(window.innerWidth<720){layout('editor');$('tree-pane').hidden=true;$('workspace').classList.add('no-files');}
(async()=>{try{const host=await request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Overleaf Local Editor',version:'0.6.0'},appCapabilities:{availableDisplayModes:['inline','fullscreen']}});applyHost(host.hostContext);notify('ui/notifications/initialized',{});const r=await tool('bootstrap');setProjects(r.projects);manager.setup(r);ready=true;let saved;try{saved=localStorage.getItem('overleaf-local:last-project');}catch(_){}const key=[requestedKey,saved,r.projects[0]?.key].find(k=>r.projects.some(p=>p.key===k));if(key)await openProject(key);setInterval(refreshStatus,4000);}catch(e){$('file-status').textContent=e.message;$('placeholder').textContent='编辑器连接失败：'+e.message;}})();
