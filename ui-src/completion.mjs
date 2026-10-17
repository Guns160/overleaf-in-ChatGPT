import {snippetCompletion} from '@codemirror/autocomplete';
import {scanLatex,stripComments} from '../server/latex-index.js';
export const environments=['document','equation','equation*','align','align*','aligned','gather','gather*','multline','multline*','split','cases','matrix','pmatrix','bmatrix','vmatrix','figure','figure*','table','table*','tabular','tabularx','longtable','itemize','enumerate','description','abstract','theorem','lemma','proof','definition','proposition','remark','corollary','center','flushleft','flushright','minipage','verbatim','frame','columns','column','block','alertblock','exampleblock','tikzpicture','subfigure','thebibliography','appendices'];
const packages=['amsmath','amssymb','amsfonts','amsthm','mathtools','bm','graphicx','hyperref','cleveref','geometry','xcolor','booktabs','tabularx','longtable','multirow','array','siunitx','physics','braket','slashed','tikz','pgfplots','subcaption','caption','float','enumitem','natbib','biblatex','ctex','fontspec','unicode-math','inputenc','fontenc','microtype','babel','fancyhdr','titlesec','setspace','listings','minted','verbatim','adjustbox','anyfontsize','times'];
const classes=['article','report','book','letter','beamer','ctexart','ctexrep','ctexbook','revtex4-2','elsarticle','scrartcl','IEEEtran'];
const simple=('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega partial nabla infty sum prod int iint iiint oint lim sin cos tan cot sinh cosh log ln exp det dim min max sup inf sqrt pm mp times cdot div ast star circ bullet oplus otimes leq geq neq approx equiv sim simeq propto ll gg in notin subset subseteq supset supseteq cup cap emptyset forall exists neg land lor to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow mapsto longrightarrow vec hat bar overline underline tilde dot ddot hbar ell Re Im dag dagger langle rangle lvert rvert quad qquad ldots cdots vdots ddots nonumber notag hline toprule midrule bottomrule maketitle tableofcontents appendix clearpage newpage noindent centering smallskip medskip bigskip hfill vfill pause item today printbibliography').split(' ');
const templates=[
 ['documentclass','documentclass[${1:12pt}]{${2:article}}','文档类型'],['usepackage','usepackage{${1:amsmath}}','宏包'],
 ['begin','begin{${1:equation}}\n\t${2}\n\\end{${1:equation}}','环境 · 自动插入 end'],['end','end{${1:equation}}','结束环境'],
 ['frac','frac{${1:numerator}}{${2:denominator}}','分数'],['dfrac','dfrac{${1:numerator}}{${2:denominator}}','展示分数'],['tfrac','tfrac{${1:numerator}}{${2:denominator}}','行内分数'],['sqrt','sqrt{${1:x}}','根式'],
 ['section','section{${1:Title}}','节'],['subsection','subsection{${1:Title}}','小节'],['subsubsection','subsubsection{${1:Title}}','子小节'],['chapter','chapter{${1:Title}}','章'],['paragraph','paragraph{${1:Title}}','段落标题'],
 ['textbf','textbf{${1:text}}','粗体'],['textit','textit{${1:text}}','斜体'],['emph','emph{${1:text}}','强调'],['text','text{${1:text}}','数学中的文字'],['textrm','textrm{${1:text}}','罗马体'],['texttt','texttt{${1:text}}','等宽'],
 ['mathrm','mathrm{${1:d}}','数学直立体'],['mathbf','mathbf{${1:x}}','数学粗体'],['mathcal','mathcal{${1:L}}','花体'],['mathbb','mathbb{${1:R}}','黑板粗体'],['mathsf','mathsf{${1:X}}','无衬线'],['bm','bm{${1:p}}','粗体符号'],
 ['label','label{${1:eq:label}}','定义标签'],['ref','ref{${1:label}}','交叉引用'],['eqref','eqref{${1:eq:label}}','公式引用'],['autoref','autoref{${1:label}}','自动引用'],['cref','cref{${1:label}}','智能引用'],['pageref','pageref{${1:label}}','页码引用'],
 ['cite','cite{${1:key}}','文献引用'],['citep','citep{${1:key}}','括号文献引用'],['citet','citet{${1:key}}','作者文献引用'],['parencite','parencite{${1:key}}','biblatex 引用'],['nocite','nocite{${1:key}}','加入参考文献'],
 ['includegraphics','includegraphics[width=${1:\\linewidth}]{${2:figures/plot.pdf}}','插入图片'],['input','input{${1:sections/introduction}}','导入源文件'],['include','include{${1:chapter}}','导入章节'],['bibliography','bibliography{${1:references}}','BibTeX 文件'],['addbibresource','addbibresource{${1:references.bib}}','biblatex 文件'],['bibliographystyle','bibliographystyle{${1:unsrt}}','参考文献格式'],
 ['caption','caption{${1:Caption}}','图表标题'],['title','title{${1:Title}}','论文标题'],['author','author{${1:Author}}','作者'],['date','date{${1:\\today}}','日期'],['footnote','footnote{${1:text}}','脚注'],['href','href{${1:url}}{${2:text}}','链接'],['url','url{${1:url}}','网址'],
 ['newcommand','newcommand{\\${1:command}}[${2:1}]{${3:definition}}','自定义命令'],['renewcommand','renewcommand{\\${1:command}}{${2:definition}}','重定义命令'],['DeclareMathOperator','DeclareMathOperator{\\${1:Tr}}{${2:Tr}}','数学算符'],
 ['left','left(${1:x}\\right)','伸缩括号'],['overset','overset{${1:above}}{${2:symbol}}','上标记'],['underset','underset{${1:below}}{${2:symbol}}','下标记'],['underbrace','underbrace{${1:expression}}_{${2:text}}','下花括号'],['overbrace','overbrace{${1:expression}}^{${2:text}}','上花括号'],
 ['textcolor','textcolor{${1:red}}{${2:text}}','文字颜色'],['vspace','vspace{${1:1em}}','竖直间距'],['hspace','hspace{${1:1em}}','水平间距'],['frametitle','frametitle{${1:Title}}','幻灯片标题'],['usetheme','usetheme{${1:Boadilla}}','Beamer 主题'],['setlength','setlength{\\${1:parindent}}{${2:0pt}}','设置长度']
];
const commandOptions=templates.map(([label,template,detail])=>snippetCompletion('\\'+template,{label:'\\'+label,type:'function',detail,boost:2}));
for(const name of simple)if(!templates.some(t=>t[0]===name))commandOptions.push({label:'\\'+name,type:'keyword'});
const unique=a=>[...new Set(a)];
function values(names,type='constant',detail=''){return names.map(label=>({label,type,detail}));}
export function completionSource(getProject=()=>({})){let cachedDoc=null,cachedIndex=null;return context=>{
 if(context.state.readOnly)return null;
 const {state,pos}=context,line=state.doc.lineAt(pos),before=line.text.slice(0,pos-line.from);
 if(stripComments(before)!==before)return null;
 const project=getProject()||{},merge=key=>{if(cachedDoc!==state.doc){cachedDoc=state.doc;cachedIndex=scanLatex(state.doc.toString());}return unique([...(cachedIndex[key]||[]),...(project[key]||[])]);};
 const argument=before.match(/\\([A-Za-z]+)\*?(?:\[[^\]]*\]\s*){0,2}\{([^{}]*)$/);
 if(argument){
  const [,command,body]=argument,term=body.split(',').at(-1),from=pos-term.length+term.length-term.trimStart().length;let options;
  if(['ref','eqref','pageref','autoref','cref','Cref','vref'].includes(command))options=values(merge('labels'),'constant','项目标签');
  else if(/^(?:[cC]ite[a-zA-Z]*|parencite|textcite|autocite|nocite|fullcite|footcite)$/.test(command))options=values(merge('citations'),'constant','BibTeX 引用键');
  else if(command==='usepackage')options=values(packages,'namespace','宏包');
  else if(command==='documentclass')options=values(classes,'class','文档类型');
  else if(command==='begin'||command==='end'){
   const names=unique([...environments,...merge('environments')]);
   if(command==='end')return {from,options:values(names,'keyword','结束环境'),validFor:/^[\w*]*$/};
   options=names.map(name=>({label:name,type:'keyword',detail:'环境 · begin / end',apply(view,completion,start,end){const close=view.state.doc.sliceString(end,end+1)==='}'?1:0,tail=view.state.doc.sliceString(end+close);if(tail.trimStart().startsWith('\\end{'+name+'}'))view.dispatch({changes:{from:start,to:end,insert:name}});else snippetCompletion(name+'}\n\t${1}\n\\end{'+name+'}',{label:name}).apply(view,completion,start,end+close);}}));
  }
  else if(['input','include','includegraphics','bibliography','addbibresource'].includes(command)){
   options=values((project.files||[]).filter(f=>command==='includegraphics'?/\.(png|jpe?g|pdf|eps|svg)$/i.test(f):/bibliography|bibresource/.test(command)?/\.bib$/i.test(f):/\.tex$/i.test(f)).map(f=>['input','include','bibliography'].includes(command)?f.replace(/\.(tex|bib)$/i,''):f),'text','项目文件');
  }
  if(options)return {from,options,validFor:/^[^{}\s,]*$/};
 }
 const match=context.matchBefore(/\\[A-Za-z@]*$/);if(!match)return null;
 // An escaped backslash is LaTeX's line break, not a new command.
 let slashes=0;for(let i=match.from-1;i>=line.from&&state.doc.sliceString(i,i+1)==='\\';i--)slashes++;if(slashes%2)return null;
 if(!context.explicit&&match.text.length<2)return null;
 const options=[...commandOptions,...merge('commands').filter(n=>!commandOptions.some(c=>c.label==='\\'+n)).map(n=>({label:'\\'+n,type:'function',detail:'项目自定义命令',boost:5}))];
 return {from:match.from,options,validFor:/^\\[A-Za-z@]*$/};
};}
