import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const directory=await mkdtemp(join(tmpdir(),'cimahub-recent-server-'));
process.env.SEO_DATA_DIR=directory;process.env.VERCEL='1';process.env.TMDB_API_KEY='recent-test-placeholder';
const {server}=await import('../server.js');
const originalFetch=globalThis.fetch;
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const movie=id=>({id,title:'Recent Movie '+id,original_title:'Recent Movie '+id,original_language:'en',release_date:day(-2),overview:'قصة الفيلم.',genres:[{id:28}],genre_ids:[28],media_type:'movie'});
const show={id:900,name:'Recent Show',original_name:'Recent Show',original_language:'en',first_air_date:'2005-01-01',overview:'قصة المسلسل.',genres:[{id:18}],seasons:[{season_number:1,air_date:day(-3),episode_count:3}],last_episode_to_air:{season_number:1,episode_number:2,air_date:day(-1)},next_episode_to_air:{season_number:1,episode_number:3,air_date:day(1)}};
let base;
before(async()=>{
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));if(url.hostname!=='api.themoviedb.org')return originalFetch(input,options);
  const path=url.pathname.replace('/3/','');
  if(path==='discover/movie'){const page=Number(url.searchParams.get('page')||1);return Response.json({page,total_pages:2,total_results:40,results:Array.from({length:20},(_,i)=>movie((page-1)*20+i+1))});}
  if(path==='discover/tv')return Response.json({results:[{id:900}]});
  if(path==='tv/900')return Response.json(show);
  if(path==='tv/900/season/1')return Response.json({episodes:[{episode_number:2,air_date:day(-1)},{episode_number:3,air_date:day(1)}]});
  if(/^movie\/\d+$/.test(path))return Response.json(movie(Number(path.split('/')[1])));
  throw new Error('Unexpected provider endpoint '+path);
 };
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{
 globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
 await unlink(join(directory,'seo-catalog.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);
});

test('recent HTML loads twenty cards including actually aired episodes instead of a 502 error',async()=>{
 const r=await originalFetch(base+'/recent/');assert.equal(r.status,200);const html=await r.text();
 assert.equal((html.match(/class="card"/g)||[]).length,20);
 assert.match(html,/Recent Show/);assert.match(html,/الحلقة 2/);assert.doesNotMatch(html,/الحلقة 3/);
 assert.match(html,/name="robots" content="index, follow/);
 assert.doesNotMatch(html,/تعذّر تحميل المحتوى/);
});
test('recent API pagination has a defined page size, disjoint entries and bounded final page',async()=>{
 const pages=[];for(const n of [1,2,3]){const r=await originalFetch(base+'/api/recent?page='+n);assert.equal(r.status,200);const body=await r.json();assert.equal(body.page_size,20);assert.equal(body.total_pages,3);pages.push(body.results);}
 assert.deepEqual(pages.map(x=>x.length),[20,20,1]);
 const ids=pages.flat().map(x=>x.media_type+':'+x.id);assert.equal(new Set(ids).size,41);
 assert.equal((await originalFetch(base+'/recent/?page=4')).status,404);
});
