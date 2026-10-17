"use strict";
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Builds are isolated snapshots. Nothing writes into the Git checkout.
module.exports = function createPreview({ CACHE_ROOT, getEntry, workspace, run, compilerHelper, retainBuilds = 3 }) {
  const root = path.join(CACHE_ROOT, '.previews');
  const running = new Map();
  const rendering = new Map();
  const byProject = new Map();
  const jobCache = new Map();
  const touched = new Map();
  const buildIdPattern = /^[0-9a-f]{24}-[0-9a-f-]{36}$/;
  fs.mkdirSync(root, { recursive: true });

  function save(job) {
    const file = path.join(root, job.buildId, 'status.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(job));
    fs.renameSync(file + '.tmp', file);
  }
  function load(id) {
    if (!buildIdPattern.test(id || '')) throw new Error('无效的预览编号');
    let job;
    try { job = JSON.parse(fs.readFileSync(path.join(root, id, 'status.json'), 'utf8')); }
    catch (_) { throw new Error('预览不存在或已损坏，请重新编译'); }
    if (job.status === 'building' && !running.has(id)) {
      job.status = 'failed';
      job.error = '上次编译被中断，请重新编译。';
    }
    return job;
  }
  function cachedJob(id) {
    const file = path.join(root, id, 'status.json');let st;
    try { st = fs.statSync(file); } catch (_) { jobCache.delete(id); return null; }
    const sig = st.dev+':'+st.ino+':'+st.size+':'+st.mtimeMs+':'+st.ctimeMs, hit = jobCache.get(id);
    if (hit && hit.sig === sig) return interrupted({ ...hit.job }, id);
    let job;
    try { job = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { jobCache.delete(id); return null; }
    jobCache.delete(id);jobCache.set(id, { sig, job });
    if (jobCache.size > 256) jobCache.delete(jobCache.keys().next().value);
    return interrupted({ ...job }, id);
  }
  function interrupted(job, id) {
    if (job.status === 'building' && !running.has(id)) { job.status = 'failed'; job.error = '上次编译被中断，请重新编译。'; }
    return job;
  }
  function latest(key) {
    const jobs = fs.readdirSync(root).filter(n => buildIdPattern.test(n)).map(cachedJob).filter(j => j && j.projectKey === key);
    jobs.sort((a,b) => b.startedAt.localeCompare(a.startedAt));
    return jobs[0] || null;
  }
  function touch(id) { touched.delete(id); touched.set(id, Date.now()); while (touched.size > 8) touched.delete(touched.keys().next().value); }
  function prune(job) {
    try {
      const keep = new Set([job.buildId, ...running.keys(), ...byProject.values(), ...touched.keys()]);
      const builds = [];
      for (const name of fs.readdirSync(root)) {
        if (!buildIdPattern.test(name) || keep.has(name)) continue;
        const saved = cachedJob(name);
        if (saved && saved.projectKey !== job.projectKey) continue;
        builds.push({ name, startedAt: saved ? String(saved.startedAt || '') : '' });
      }
      builds.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      for (const stale of builds.slice(retainBuilds)) fs.rmSync(path.join(root, stale.name), { recursive: true, force: true });
    } catch (e) { try { process.stderr.write('[overleaf-panel] 编译缓存清理失败：' + String(e && e.message || e) + '\n'); } catch (_) {} }
  }
  function helperPath() {
    if(compilerHelper===false)return null;
    if(typeof compilerHelper==='string')return compilerHelper;
    if (process.env.OVERLEAF_LATEX_HELPER) return process.env.OVERLEAF_LATEX_HELPER;
    const base = path.join(os.homedir(), '.codex/plugins/cache/openai-bundled/latex');
    if (fs.existsSync(base)) {
      const versions = fs.readdirSync(base).sort((a,b) => b.localeCompare(a, undefined, { numeric:true }));
      for (const v of versions) {
        const f = path.join(base, v, 'scripts/compile_latex.py');
        if (fs.existsSync(f)) return f;
      }
    }
    return null;
  }
  async function checked(command, args, options) {
    const r = await run(command, args, options);
    if (!r.ok) throw new Error(r.timedOut ? '操作超时（' + Math.round((r.timeoutMs || (options && options.timeoutMs) || 60000) / 1000) + ' 秒）：' + path.basename(command) : (r.err || r.error || r.out || '命令执行失败').slice(-3500));
    return r.out;
  }
  function publicJob(job) {
    const { log, ...visible } = job;
    return { ...visible, hasLog: !!log };
  }
  function result(job) {
    return { content:[{type:'text', text: job.status === 'ready' ? 'PDF 预览已生成，共 ' + job.pages + ' 页。' : (job.error || '正在同步、编译论文。')}], structuredContent:publicJob(job), _meta:{ compileLog:job.log || '' } };
  }

  async function build(job) {
    try {
      const entry = await getEntry(job.projectKey);
      job.phase = '正在准备本地论文副本'; save(job);
      const work = path.join(root, job.buildId);
      const source = path.join(work, 'source');
      const output = path.join(work, 'output');
      fs.mkdirSync(source, {recursive:true});
      fs.mkdirSync(output, {recursive:true});
      const snapshot = await workspace.snapshot(job.projectKey,source);
      const tracked = snapshot.files;
      job.revision=snapshot.revision;job.sourceHash=snapshot.sourceHash;job.dirty=snapshot.dirty;job.localPath=snapshot.localPath;
      let main = entry.mainFile || (tracked.includes('main.tex') ? 'main.tex' : null);
      if(main&&!tracked.includes(main))throw Error('指定的 LaTeX 主文件不存在：'+main);
      if (!main) {
        const roots = tracked.filter(f => f.endsWith('.tex') && /\\documentclass/.test(fs.readFileSync(path.join(source,f),'utf8')));
        if (!roots.length) throw new Error('未找到含 \\documentclass 的主文件。');
        if (roots.length > 1) throw new Error('无法确定主文件：请将主文件命名为 main.tex。');
        main = roots[0];
      }
      job.mainFile = main;
      job.phase = '正在编译 PDF'; save(job);
      const compiler = process.env.OVERLEAF_PREVIEW_COMPILER || 'tectonic';
      let compiled,r;const helper=helperPath();
      if(helper){
        const python=process.env.OVERLEAF_PYTHON||(process.platform==='win32'?'python':'python3');
        r=await run(python,[helper,path.join(source,main),'--compiler',compiler,'--output-directory',output,'--json'],{cwd:source,timeoutMs:240000});
        try{compiled=JSON.parse(r.out);}catch(_){if(!r.error)throw Error((r.err||r.out||'编译器未返回有效结果').slice(-3500));}
      }
      if(!compiled){
        if(compiler!=='tectonic')throw Error('请安装 LaTeX 插件以使用 TeX Live，或在本机安装 Tectonic。');
        const stem=path.basename(main,'.tex');
        r=await run(process.env.OVERLEAF_TECTONIC||'tectonic',['-X','compile','--outdir',output,'--outfmt','pdf','--print','--untrusted',path.basename(main)],{cwd:path.dirname(path.join(source,main)),timeoutMs:240000});
        const pdfPath=path.join(output,stem+'.pdf');
        compiled={compiler:'tectonic',exitCode:r.ok?0:1,pdfPath,pdfExists:fs.existsSync(pdfPath),log:(r.out+r.err).slice(-12000)};
        if(r.error)throw Error('未找到本地编译器。请安装 LaTeX 插件或 Tectonic；PDF 预览还需要 Poppler。');
      }
      job.log = compiled.log || compiled.attempts?.map(a => a.log || a.reason || '').join('\n') || '';
      if (!r.ok || !compiled.pdfExists || compiled.exitCode !== 0) throw new Error(job.log.slice(-3500) || '编译失败，没有可用 PDF');
      job.pdfPath = compiled.pdfPath;
      job.compiler = compiled.compiler;
      const info = await checked('pdfinfo',[job.pdfPath]);
      const pages = /Pages:\s+(\d+)/.exec(info);
      if (!pages) throw new Error('生成文件未通过 PDF 检查');
      job.pages = Number(pages[1]);
      const dimensions=/Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
      job.pageRatio=dimensions?Number(dimensions[1])/Number(dimensions[2]):0.7071;
      job.pdfBytes = fs.statSync(job.pdfPath).size;
      job.compiledAt = new Date().toISOString();
      job.status = 'ready'; job.phase = 'PDF 已就绪';
      save(job);
      prune(job);
    } catch (e) {
      job.status = 'failed'; job.phase = '编译失败'; job.error = e.message; save(job);
    }
  }

  async function start(args) {
    const key = String(args.projectKey || '');
    const entry = await getEntry(key);
    const active = byProject.get(key);
    if (active) return result(load(active));
    const previous = latest(key);
    if (!args.force && previous?.status === 'ready' && previous.sourceHash === (await workspace.snapshot(key)).sourceHash) return result(previous);
    const buildId = (entry.storageId||entry.projectId||entry.localId) + '-' + crypto.randomUUID();
    const job = {buildId,projectKey:key,projectId:entry.projectId||null,type:entry.type||'overleaf',name:entry.name,status:'building',phase:'正在准备本地编译',startedAt:new Date().toISOString()};
    fs.mkdirSync(path.join(root,buildId)); save(job);
    byProject.set(key,buildId);
    // Register before starting so polls cannot mistake a running build for an interrupted one.
    running.set(buildId,true);
    const task = build(job).finally(() => { running.delete(buildId); byProject.delete(key); });
    running.set(buildId,task);
    return result(job);
  }

  async function page(args) {
    const job = load(args.buildId);
    touch(job.buildId);
    const n = Number(args.page);
    if (job.status !== 'ready') throw new Error('PDF 尚未就绪');
    if (!Number.isInteger(n) || n < 1 || n > job.pages) throw new Error('页码超出范围');
    const dir = path.join(root, job.buildId, 'pages');
    fs.mkdirSync(dir,{recursive:true});
    const prefix = path.join(dir, 'page-' + n);
    const png = prefix + '.png';
    if (!fs.existsSync(png)) {
      if (!rendering.has(png)) {
        const task = checked('pdftoppm',['-f',String(n),'-l',String(n),'-singlefile','-scale-to','2000','-png',job.pdfPath,prefix], {timeoutMs:30000}).finally(() => rendering.delete(png));
        rendering.set(png,task);
      }
      await rendering.get(png);
    }
    return {content:[{type:'text',text:'PDF 第 ' + n + '/' + job.pages + ' 页。'}],structuredContent:{buildId:job.buildId,page:n,pages:job.pages},_meta:{pageDataUrl:'data:image/png;base64,'+fs.readFileSync(png).toString('base64')}};
  }
  async function exportPDF(args){
    const job=load(args.buildId);if(job.status!=='ready')throw Error('PDF 尚未就绪');
    const targetRoot=process.env.OVERLEAF_EXPORT_DIRECTORY||path.join(os.homedir(),'Downloads','Overleaf Local');fs.mkdirSync(targetRoot,{recursive:true});
    const title=(job.name||path.basename(job.mainFile,'.tex')).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'paper';
    const stamp=new Date().toISOString().replace(/[:.]/g,'-'),file=path.join(targetRoot,title+'-'+stamp+'-'+crypto.randomBytes(3).toString('hex')+'.pdf');
    fs.copyFileSync(job.pdfPath,file,fs.constants.COPYFILE_EXCL);
    return {content:[{type:'text',text:'PDF 已导出到本地。'}],structuredContent:{filePath:file,bytes:fs.statSync(file).size}};
  }
  return {start, exportPDF, status:args => result(load(args.buildId)), page, latest};
};
