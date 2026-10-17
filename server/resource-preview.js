'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const fsp=fs.promises;
const rasterTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp'};
function safeResourcePath(repo,file){
 if(typeof file!=='string'||!file||path.isAbsolute(file)||file.includes('\0')||file.split(/[\\/]/).some(p=>!p||p==='..'||p.startsWith('.')))throw Error('无效的项目文件路径');
 const abs=path.resolve(repo,file);if(!abs.startsWith(path.resolve(repo)+path.sep))throw Error('文件路径越界');
 for(let current=abs;current!==path.resolve(repo);current=path.dirname(current)){try{if(fs.lstatSync(current).isSymbolicLink())throw Error('不支持预览符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return abs;
}
function rasterMatches(ext,data){
 if(ext==='.png')return data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(ext==='.jpg'||ext==='.jpeg')return data[0]===255&&data[1]===216&&data[2]===255;
 if(ext==='.gif')return /^GIF8[79]a$/.test(data.subarray(0,6).toString());
 if(ext==='.webp')return data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
 if(ext==='.bmp')return data.subarray(0,2).toString()==='BM';return false;
}
module.exports=function createResourcePreview({workspace,run,CACHE_ROOT,bytesLimit=256*1024*1024}){
 const root=path.join(CACHE_ROOT,'.resources'),metadata=new Map(),inflight=new Map();let active=0;const waiting=[];
 function dirBytes(dir){let total=0;for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);try{if(ent.isDirectory())total+=dirBytes(p);else if(ent.isFile())total+=fs.statSync(p).size;}catch(_){}}return total;}
 function evict(){try{const busy=new Set([...inflight.keys()].map(p=>path.dirname(p)));const dirs=[];let total=0;for(const name of fs.readdirSync(root)){const p=path.join(root,name);try{const st=fs.statSync(p);if(!st.isDirectory()||busy.has(p))continue;const bytes=dirBytes(p);dirs.push({name,p,mtime:st.mtimeMs,bytes});total+=bytes;}catch(_){}}dirs.sort((a,b)=>a.mtime-b.mtime);for(const d of dirs){if(total<=bytesLimit)break;try{fs.rmSync(d.p,{recursive:true,force:true});metadata.delete(d.name);total-=d.bytes;}catch(_){}}}catch(e){try{process.stderr.write('[overleaf-panel] 资源缓存清理失败：'+String(e&&e.message||e)+'\n');}catch(_){}}}
 async function limited(fn){if(active>=2)await new Promise(resolve=>waiting.push(resolve));active++;try{return await fn();}finally{active--;waiting.shift()?.();}}
 async function checked(cmd,args){const r=await run(cmd,args,{timeoutMs:30000});if(!r.ok)throw Error(r.error?'未找到 PDF 预览工具，请安装 Poppler。':'无法生成该文件的预览，请检查文件是否损坏或加密。');return r.out;}
 async function preview(args){
  const {repo}=await workspace.local(args.projectKey),abs=safeResourcePath(repo,args.filePath),ext=path.extname(args.filePath).toLowerCase(),isPDF=ext==='.pdf'||ext==='.ai';
  if(!isPDF&&!rasterTypes[ext])throw Error('暂不支持该格式的预览；可使用 PNG、JPEG、GIF、WebP、BMP、PDF 或兼容 PDF 的 AI 文件。');
  const handle=await fsp.open(abs,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let data;
  try{const stat=await handle.stat();if(!stat.isFile())throw Error('请选择项目中的文件');if(stat.size>(isPDF?32000000:12000000))throw Error(isPDF?'该文件超过 32 MB 预览上限。':'该图片超过 12 MB 预览上限，请压缩后再预览。');data=await handle.readFile();if(data.length>(isPDF?32000000:12000000))throw Error('文件超过预览大小上限');}finally{await handle.close();}
  const hash=crypto.createHash('sha256').update(data).digest('hex'),page=Number(args.page??1);
  if(!Number.isSafeInteger(page)||page<1)throw Error('无效的预览页码');
  let mimeType,image,kind,pages=1,width,height;
  if(!isPDF){if(page!==1)throw Error('图片只有一页');if(!rasterMatches(ext,data))throw Error('图片内容与文件格式不符，或文件已损坏。');mimeType=rasterTypes[ext];image=data;kind='image';}
  else{
   if(data.subarray(0,1024).indexOf('%PDF-')<0)throw Error(ext==='.ai'?'该 AI 文件没有内嵌 PDF 预览。请在 Illustrator 中启用“创建 PDF 兼容文件”后保存，或导出 PNG / PDF。':'该文件不是有效的 PDF。');
   const dir=path.join(root,hash),source=path.join(dir,'source.pdf');await fsp.mkdir(dir,{recursive:true,mode:0o700});
   try{await fsp.writeFile(source,data,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
   let info=metadata.get(hash);if(!info){const text=await checked('pdfinfo',[source]),m=/Pages:\s+(\d+)/.exec(text),size=/Page size:\s+([\d.]+) x ([\d.]+)/.exec(text);if(!m)throw Error('无法读取 PDF 页码');info={pages:Number(m[1]),width:size?Number(size[1]):null,height:size?Number(size[2]):null};metadata.set(hash,info);while(metadata.size>40)metadata.delete(metadata.keys().next().value);}
   ({pages,width,height}=info);if(page>pages)throw Error('页码超出范围');const prefix=path.join(dir,'page-'+page),png=prefix+'.png';
   if(!fs.existsSync(png)){if(!inflight.has(png)){const task=limited(async()=>{const tmp=prefix+'-'+crypto.randomUUID();try{await checked('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','1800','-png',source,tmp]);await fsp.rename(tmp+'.png',png);}finally{await fsp.unlink(tmp+'.png').catch(()=>{});}}).finally(()=>inflight.delete(png));inflight.set(png,task);}await inflight.get(png);}
   image=await fsp.readFile(png);mimeType='image/png';kind=ext==='.ai'?'illustrator':'pdf';
   try{fs.utimesSync(dir,new Date(),new Date());}catch(_){}
   evict();
  }
  return {content:[{type:'text',text:'本地文件预览已生成。'}],structuredContent:{filePath:args.filePath,hash,kind,format:ext.slice(1).toUpperCase(),page,pages,bytes:data.length,...(width?{width,height}:{})},_meta:{imageDataUrl:'data:'+mimeType+';base64,'+image.toString('base64')}};
 }
 return {preview};
};
module.exports.safeResourcePath=safeResourcePath;
