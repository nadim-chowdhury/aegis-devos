import path from 'node:path';
import {readdir,readFile} from 'node:fs/promises';
import {readText} from './fs.js';
import {searchMemory,taskMemory} from './memory.js';
import {codeContextForTask} from './code-graph.js';
import type {Task} from '../types.js';

const files=['PROJECT.md','PRODUCT.md','REQUIREMENTS.md','ARCHITECTURE.md','CONSTRAINTS.md','QUALITY.md','SECURITY.md','TESTING.md','ROADMAP.md','STATE.md','CURRENT_TASK.md','DECISIONS.md'];
const sourceDirs=['src','app','pages','components','lib','server','tests'];
const stopWords=new Set(['the','and','for','with','from','that','this','task','implement','create','update','add','fix','feature','page']);

function keywords(task:Task){
  const text=[task.title,task.objective,...task.acceptance_criteria].join(' ').toLowerCase();
  return [...new Set((text.match(/[a-zA-Z][a-zA-Z0-9_-]{2,}/g)||[]).filter(x=>!stopWords.has(x)).slice(0,18))];
}

async function sourceContext(root:string,task:Task,budget:number){
  const keys=keywords(task), hits:Array<{file:string;score:number;text:string}>=[];
  async function walk(dir:string,depth=0){
    if(depth>3||hits.length>=40)return;
    let entries; try{entries=await readdir(dir,{withFileTypes:true})}catch{return;}
    for(const e of entries){
      if(e.name.startsWith('.')||['node_modules','dist','build','coverage'].includes(e.name))continue;
      const full=path.join(dir,e.name);
      if(e.isDirectory()) await walk(full,depth+1);
      else if(/\.(ts|tsx|js|jsx|mjs|cjs|py|dart|go|rs|java|kt)$/.test(e.name)){
        try{const text=await readFile(full,'utf8'); const low=text.toLowerCase(); const score=keys.reduce((n,k)=>n+(low.includes(k)?1:0),0); if(score)hits.push({file:path.relative(root,full),score,text})}catch{}
      }
    }
  }
  for(const d of sourceDirs) await walk(path.join(root,d));
  hits.sort((a,b)=>b.score-a.score||a.file.localeCompare(b.file));
  const chunks:string[]=[]; let used=0;
  for(const h of hits.slice(0,12)){
    const excerpt=h.text.slice(0,Math.min(5000,Math.max(1200,Math.floor(budget/Math.max(1,Math.min(12,hits.length))))));
    const c=`\n===== CODE ${h.file} (relevance ${h.score}) =====\n${excerpt}`; if(used+c.length>budget)break; chunks.push(c);used+=c.length;
  }
  return chunks.join('\n');
}

export async function buildContext(root:string,task:Task,maxChars=50000){
  const chunks:string[]=[]; let total=0;
  for(const name of files){try{const text=await readText(path.join(root,'.ai',name)); const chunk=`\n===== .ai/${name} =====\n${text}`; if(total+chunk.length<=maxChars){chunks.push(chunk);total+=chunk.length}}catch{}}
  const taskText=`${task.title} ${task.objective} ${task.acceptance_criteria.join(' ')}`;
  try{
    const memories=await taskMemory(root,task.id,8);
    const searched=await searchMemory(root,taskText,8);
    const seen=new Set<string>(); const combined=[...memories,...searched].filter((m:any)=>{if(seen.has(m.id))return false;seen.add(m.id);return true});
    if(combined.length){
      const c='\n===== ENGINEERING MEMORY =====\n'+combined.map((m:any)=>`[${m.kind}] ${m.title} | confidence=${m.confidence} | source=${m.source}\n${m.content}`).join('\n\n');
      if(total+c.length<=maxChars){chunks.push(c);total+=c.length;}
    }
  }catch{}
  const graphBudget=Math.max(0,Math.min(7000,maxChars-total-3500));
  if(graphBudget>500){try{const graphHits=await codeContextForTask(root,task,12);if(graphHits.length){const c='\n===== CODE GRAPH CONTEXT =====\n'+graphHits.map((h:any)=>`${h.file_path}${h.name?`::${h.name}`:''} [${h.kind}] line=${h.line} score=${h.score}`).join('\n');if(total+c.length<=maxChars){chunks.push(c);total+=c.length}}}catch{}}
  const remaining=Math.max(0,maxChars-total-1500);
  if(remaining>500){const code=await sourceContext(root,task,remaining);if(code){chunks.push('\n===== RELEVANT CODE CONTEXT =====\n'+code);total+=code.length}}
  const taskChunk=`\n===== TASK =====\n${JSON.stringify(task,null,2)}`; if(total+taskChunk.length<=maxChars)chunks.push(taskChunk);
  return chunks.join('\n');
}
