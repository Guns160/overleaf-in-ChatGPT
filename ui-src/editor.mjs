import {basicSetup} from 'codemirror';
import {EditorState,Compartment,Transaction,Prec} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {indentWithTab,undo,redo,toggleLineComment} from '@codemirror/commands';
import {openSearchPanel} from '@codemirror/search';
import {StreamLanguage,HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {autocompletion,startCompletion,acceptCompletion,nextSnippetField,prevSnippetField} from '@codemirror/autocomplete';
import {stex} from '@codemirror/legacy-modes/mode/stex';
import {completionSource} from './completion.mjs';
export function createEditor(parent,onChange,onSave,onCompile,onCursor){
 const access=new Compartment(),font=new Compartment();let silent=false,currentFileId=null,projectIndex={};
 const extensions=[basicSetup,StreamLanguage.define(stex),syntaxHighlighting(HighlightStyle.define([{tag:tags.keyword,color:'#0000ff'},{tag:tags.tagName,color:'#0000ff'},{tag:tags.atom,color:'#0000ff'},{tag:tags.comment,color:'#5c997c'},{tag:tags.string,color:'#4396a8'},{tag:tags.number,color:'#4396a8'},{tag:tags.bracket,color:'#444'}])),
 autocompletion({override:[completionSource(()=>projectIndex)],activateOnTyping:true,activateOnTypingDelay:100,maxRenderedOptions:16,icons:false,closeOnBlur:true}),
 EditorView.contentAttributes.of({'aria-label':'LaTeX 源码',role:'textbox','aria-multiline':'true',autocorrect:'off',autocapitalize:'off',spellcheck:'false'}),
 Prec.high(keymap.of([{key:'Tab',run:view=>!view.state.readOnly&&(acceptCompletion(view)||nextSnippetField(view))},{key:'Shift-Tab',run:prevSnippetField},{key:'Ctrl-Space',run:startCompletion},{key:'Mod-s',run:()=>{onSave();return true;}},{key:'Mod-Enter',run:()=>{onCompile();return true;}}])),keymap.of([indentWithTab]),
 EditorView.lineWrapping,access.of([EditorState.readOnly.of(true),EditorView.editable.of(false)]),font.of([]),
 EditorView.theme({'&':{height:'100%',fontSize:'clamp(14px,1.14vw,23px)',color:'#252525',backgroundColor:'#fff'},'.cm-scroller':{fontFamily:'Menlo,Monaco,Consolas,"Liberation Mono",monospace',lineHeight:'1.65',overflow:'auto'},'.cm-gutters':{backgroundColor:'#f0f0ef',color:'#555',borderRight:'0',minWidth:'3.7em'},'.cm-lineNumbers .cm-gutterElement':{padding:'0 .7em 0 .4em'},'.cm-content':{padding:'0 0 40px'},'.cm-line':{padding:'0 8px'},'&.cm-focused':{outline:'none'},'.cm-activeLine':{backgroundColor:'#f5f8f5'},'.cm-activeLineGutter':{backgroundColor:'#e5ece6'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'#bad5ef'},'.cm-tooltip-autocomplete':{fontSize:'13px',border:'1px solid #bac4ce',borderRadius:'5px',boxShadow:'0 6px 22px #0003'},'.cm-tooltip-autocomplete > ul':{fontFamily:'Menlo,Consolas,monospace',maxWidth:'min(560px,85vw)'},'.cm-tooltip-autocomplete > ul > li':{padding:'5px 9px',color:'#273342'},'.cm-tooltip-autocomplete > ul > li[aria-selected]':{backgroundColor:'#176b42',color:'#fff'},'.cm-completionDetail':{fontStyle:'normal',fontSize:'11px',marginLeft:'20px',opacity:'.7'},'.cm-tooltip':{backgroundColor:'#fff',color:'#273342'},'.cm-search':{fontSize:'12px'},'.cm-snippetField':{backgroundColor:'#c6e6d44d',outline:'1px solid #5c997c66'}}),
 EditorView.updateListener.of(update=>{if(update.docChanged&&!silent)onChange();const s=update.state.selection.main,line=update.state.doc.lineAt(s.head);onCursor(line.number,s.head-line.from+1);})];
 const view=new EditorView({state:EditorState.create({doc:'',extensions}),parent});
 function replace(text){if(view.state.readOnly)return;view.dispatch(view.state.replaceSelection(text),{scrollIntoView:true});view.focus();}
 return {text:()=>view.state.doc.toString(),set(content,{fileId=currentFileId}={}){silent=true;if(fileId!==currentFileId){currentFileId=fileId;view.setState(EditorState.create({doc:content,extensions}));onCursor(1,1);}else view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content},selection:{anchor:0},annotations:Transaction.addToHistory.of(false)});silent=false;},
 editable(value){view.dispatch({effects:access.reconfigure([EditorState.readOnly.of(!value),EditorView.editable.of(value)])});},
 suggestions(index){projectIndex=index||{};},complete(){if(view.state.readOnly)return;view.focus();startCompletion(view);},
 action(name){if(name==='search'){openSearchPanel(view);return;}if(view.state.readOnly)return;({undo,redo,comment:toggleLineComment}[name]||(()=>{}))(view);view.focus();},
 insert:replace,wrap(command,placeholder='text'){const s=view.state.selection.main;replace('\\'+command+'{'+(view.state.sliceDoc(s.from,s.to)||placeholder)+'}');},
 go(position){const p=Math.max(0,Math.min(position,view.state.doc.length));view.dispatch({selection:{anchor:p},effects:EditorView.scrollIntoView(p,{y:'center'})});view.focus();},
 fontSize(size){view.dispatch({effects:font.reconfigure(size?[EditorView.theme({'&':{fontSize:size+'px'}})]:[])});},
 focus:()=>view.focus(),view};
}
