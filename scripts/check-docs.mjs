import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const docs=path.join(root,'docs');
let files=0,errors=[];
async function walk(dir){
  for(const e of await readdir(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory()) await walk(p); else if(e.name.endsWith('.md')){
      files++; const text=await readFile(p,'utf8');
      if(!text.trim()) errors.push(`${path.relative(root,p)} is empty`);
      for(const m of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){
        const ref=m[1]; if(ref.startsWith('http')||ref.startsWith('#')) continue;
        const target=path.resolve(path.dirname(p),ref.split('#')[0]);
        try{await readFile(target)}catch{errors.push(`${path.relative(root,p)} -> missing ${ref}`)}
      }
    }
  }
}
await walk(docs);
console.log(JSON.stringify({files,errors,ok:errors.length===0},null,2));
if(errors.length) process.exitCode=1;
