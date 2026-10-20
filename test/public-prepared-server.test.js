import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const directory=await mkdtemp(join(tmpdir(),'cimahub-prepared-'));
const filename=join(directory,'public.sqlite'),db=new DatabaseSync(filename);
db.exec(await readFile(new URL('../db/d1-schema.sql',import.meta.url),'utf8'));
const snapshot={id:700001,media_type:'movie',title:'Prepared Film',original_title:'Prepared Film',original_language:'en',overview:'قصة عربية محفوظة للفيلم.',release_date:'2026-01-01',genres:[],credits:{cast:[],crew:[]},videos:{results:[]},recommendations:{results:[]},movie_presentation_version:1,indexable:true};
db.prepare('INSERT INTO content_items(key,kind,provider_id,slug,name,year,snapshot) VALUES(?,?,?,?,?,?,?)').run('movie:700001','movie',700001,'prepared-film-2026','Prepared Film','2026',JSON.stringify(snapshot));
db.close();
process.env.PUBLIC_DATABASE_PATH=filename;
process.env.D1_GATEWAY_URL='https://worker-fixture.example';process.env.D1_GATEWAY_TOKEN='fixture';
process.env.VERCEL='1';process.env.TMDB_API_KEY='fixture';
const originalFetch=globalThis.fetch;let workerCalls=0,providerCalls=0;
globalThis.fetch=async(input,options)=>{
 const url=new URL(String(input));
 if(url.hostname==='worker-fixture.example'){workerCalls++;throw new TypeError('Worker unavailable');}
 if(url.hostname==='api.themoviedb.org'){providerCalls++;throw new TypeError('Provider unavailable');}
 if(url.hostname!=='127.0.0.1')throw new Error('Unexpected remote request');
 return originalFetch(input,options);
};
const {server}=await import('../server.js');
test('public film, HEAD, assets and sitemap work with Worker and provider unavailable',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const [path,method] of [['/prepared-film-2026/','GET'],['/prepared-film-2026/','HEAD'],['/sitemap-movies-1.xml','GET'],['/analytics.js','GET']]){
   const response=await originalFetch(base+path,{method});assert.equal(response.status,200,path);
   const body=await response.text();if(path==='/prepared-film-2026/'&&method==='GET'){assert.match(body,/Prepared Film/);assert.match(body,/قصة عربية محفوظة/);}
  }
  assert.equal(workerCalls,0);assert.equal(providerCalls,0);
  assert.equal((await originalFetch(base+'/db/public.sqlite')).status,404);
  assert.equal((await originalFetch(base+'/api/admin/session')).status,503);
  assert.ok(workerCalls>0,'administration retains its live database connection');
 }finally{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));}
});
