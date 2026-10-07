import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import type {Config} from '../types.js';
const run=promisify(exec);

export interface QualityGateResult { name:string; required:boolean; ok:boolean; durationMs:number; output:string; }

export async function quality(project:string,config:Config,names:string[]){
  const results:QualityGateResult[]=[];
  for(const name of names){
    const g=config.quality?.gates?.[name];
    if(!g) continue;
    const required=g.required!==false;
    const started=Date.now();
    try{
      const r=await run(g.command,{cwd:project,maxBuffer:5_000_000});
      results.push({name,required,ok:true,durationMs:Date.now()-started,output:r.stdout+r.stderr});
    }catch(e:any){
      results.push({name,required,ok:false,durationMs:Date.now()-started,output:String(e.stdout||'')+String(e.stderr||e.message)});
      if(required) break;
    }
  }
  return {ok:results.filter(x=>x.required).every(x=>x.ok),results};
}
