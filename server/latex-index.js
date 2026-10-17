'use strict';
// Only definitions leave the filesystem. Source bodies and credentials are never indexed.
function firstComment(line){for(let i=0;i<line.length;i++){if(line[i]!=='%')continue;let n=0;for(let j=i-1;j>=0&&line[j]==='\\';j--)n++;if(n%2===0)return i;}return null;}
function stripComments(text){
 const open=/\\begin\{(verbatim|lstlisting)\*?\}/,close=/\\end\{(verbatim|lstlisting)\*?\}/;
 let raw=false;
 return text.split('\n').map(line=>{
  if(raw){if(close.test(line))raw=false;return line;}
  const begin=open.exec(line),cut=firstComment(line);
  if(begin&&(!cut||begin.index<cut)){raw=!close.test(line);return line;}
  return cut===null?line:line.slice(0,cut);
 }).join('\n');
}
function scanLatex(source){
 const text=stripComments(source),collect=re=>[...text.matchAll(re)].map(m=>m[1]);
 const labels=collect(/\\label\s*\{([^{}\s]+)\}/g);
 const citations=[...collect(/@(?!comment|preamble|string)[a-zA-Z]+\s*[{(]\s*([^,\s{}()]+)\s*,/gi),...collect(/\\bibitem(?:\[[^\]]*\])?\s*\{([^{}\s]+)\}/g)];
 const commands=collect(/\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*\{?\\([a-zA-Z@]+)/g);
 const environments=collect(/\\(?:newenvironment|renewenvironment)\*?\s*\{([^{}\s]+)\}/g);
 return {labels:[...new Set(labels)],citations:[...new Set(citations)],commands:[...new Set(commands)],environments:[...new Set(environments)]};
}
const INDEXABLE=/\.(tex|bib|sty|cls)$/i,FILE_LIMIT=250,TOTAL_BYTES=4000000,CACHE_FILES=512,CACHE_BYTES=33554432;
const yieldNow=()=>new Promise(resolve=>setImmediate(resolve));
const fileCache=new Map();let cachedBytes=0;
const signature=stat=>stat.dev+':'+stat.ino+':'+stat.size+':'+stat.mtimeMs+':'+stat.ctimeMs;
function cacheGet(abs,stat){const hit=fileCache.get(abs);if(!hit||hit.sig!==signature(stat))return null;fileCache.delete(abs);fileCache.set(abs,hit);return hit.index;}
function cachePut(abs,stat,index,bytes){const prev=fileCache.get(abs);if(prev)cachedBytes-=prev.bytes;fileCache.delete(abs);fileCache.set(abs,{sig:signature(stat),index,bytes});cachedBytes+=bytes;
 while(fileCache.size>CACHE_FILES||cachedBytes>CACHE_BYTES){const oldest=fileCache.keys().next().value;if(oldest===undefined)break;cachedBytes-=fileCache.get(oldest).bytes;fileCache.delete(oldest);}}
async function legacyIndex(workspace,args,status,result){
 let bytes=0,count=0;
 for(const file of status.files.filter(f=>INDEXABLE.test(f))){
  if(count++>=FILE_LIMIT||bytes>=TOTAL_BYTES){result.truncated=true;break;}
  try{const {content}=(await workspace.read({projectKey:args.projectKey,filePath:file})).structuredContent;bytes+=Buffer.byteLength(content);if(bytes>TOTAL_BYTES){result.truncated=true;break;}const index=scanLatex(content);for(const key of ['labels','citations','commands','environments'])result[key].push(...index[key]);}catch(e){if(!/ENOENT|1\.5 MB/.test(e.message))throw e;result.truncated=true;}
 }
}
async function batchIndex(workspace,args,status,result){
 const candidates=[];let count=0;
 for(const file of status.files){if(!INDEXABLE.test(file))continue;if(count>=FILE_LIMIT){result.truncated=true;break;}count++;candidates.push(file);}
 const merge=index=>{for(const key of ['labels','citations','commands','environments'])result[key].push(...index[key]);};
 // The 4 MB budget is planned in source order from stat sizes, so cold, warm and mixed caches select the identical file set.
 let bytes=0;const misses=[];
 const stats=await workspace.sourceStats({projectKey:args.projectKey,files:candidates});
 for(let i=0;i<stats.sources.length;i++){
  const source=stats.sources[i];
  if(bytes>=TOTAL_BYTES){result.truncated=true;break;}
  if(source.missing||source.tooLarge){result.truncated=true;continue;}
  if(bytes+source.stat.size>TOTAL_BYTES){result.truncated=true;break;}
  const hit=cacheGet(source.abs,source.stat);
  if(hit)merge(hit);else misses.push(source.filePath);
  bytes+=source.stat.size;
  if((i&63)===63)await yieldNow();
 }
 if(misses.length){
  const read=await workspace.readSources({projectKey:args.projectKey,files:misses});
  for(let i=0;i<read.sources.length;i++){
   const source=read.sources[i];
   if(source.missing||source.tooLarge){result.truncated=true;continue;}
   const index=scanLatex(source.content);
   merge(index);cachePut(source.abs,source.stat,index,source.stat.size);
   if((i&63)===63)await yieldNow();
  }
 }
}
async function projectIndex(workspace,args){
 const status=(await workspace.status(args)).structuredContent,result={files:status.files,labels:[],citations:[],commands:[],environments:[],truncated:false};
 if(typeof workspace.sourceStats==='function'&&typeof workspace.readSources==='function')await batchIndex(workspace,args,status,result);
 else await legacyIndex(workspace,args,status,result);
 for(const key of ['labels','citations','commands','environments'])result[key]=[...new Set(result[key])].sort();
 return {content:[{type:'text',text:'本地 LaTeX 补全索引已读取。'}],structuredContent:result};
}
module.exports={stripComments,scanLatex,projectIndex};
