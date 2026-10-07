import http from 'node:http';
import path from 'node:path';
import {openDb,dbSummary} from './db.js';
import {listTasks} from './config.js';

export async function dashboard(project:string,port=4317){
 const root=path.resolve(project);
 const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json; charset=utf-8');
  try{
   const db=await openDb(root); const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
   if(url.pathname==='/api/summary'){res.end(JSON.stringify(dbSummary(db)));db.close();return}
   if(url.pathname==='/api/tasks'){res.end(JSON.stringify(await listTasks(root)));db.close();return}
   if(url.pathname==='/api/events'){const rows=db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all();res.end(JSON.stringify(rows));db.close();return}
   db.close();res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Aegis</title><style>body{font:14px system-ui;margin:32px;background:#0b1020;color:#e8ecf1}pre{white-space:pre-wrap;background:#11182b;padding:16px;border-radius:10px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:#11182b;padding:16px;border-radius:10px}</style></head><body><h1>Aegis Control Plane</h1><div id="summary" class="grid"></div><h2>Recent Events</h2><pre id="events">Loading…</pre><script>async function load(){const s=await fetch('/api/summary').then(r=>r.json());document.querySelector('#summary').innerHTML=Object.entries(s).map(([k,v])=>'<div class="card"><b>'+k+'</b><div>'+v+'</div></div>').join('');const e=await fetch('/api/events').then(r=>r.json());document.querySelector('#events').textContent=e.map(x=>x.created_at+'  '+x.type+'  '+x.task_id+'  '+x.payload_json).join('\\n')}load();setInterval(load,3000)</script></body></html>`);
  }catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}));}
 });
 await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));console.log(`[Aegis] dashboard: http://localhost:${port}`);
}
