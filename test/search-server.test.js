import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const directory=await mkdtemp(join(tmpdir(),'cimahub-search-'));
const previous={directory:process.env.SEO_DATA_DIR,vercel:process.env.VERCEL,key:process.env.TMDB_API_KEY};
process.env.SEO_DATA_DIR=directory;
process.env.VERCEL='1';
const {server}=await import('../server.js');
for(const [key,value] of [['SEO_DATA_DIR',previous.directory],['VERCEL',previous.vercel]]){
 if(value===undefined)delete process.env[key];else process.env[key]=value;
}
const originalFetch=globalThis.fetch,providerCalls=[];
let base;
before(async()=>{
 process.env.TMDB_API_KEY='search-test-placeholder';
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));
  if(url.hostname!=='api.themoviedb.org')return originalFetch(input,options);
  providerCalls.push(url);
  assert.equal(url.pathname,'/3/search/multi','search must not request work details, credits or translations');
  assert.equal(url.searchParams.get('language'),'en-US');
  const page=Number(url.searchParams.get('page')||1);
  return Response.json({page,total_pages:6,total_results:107,results:[
   {id:page*100+1,media_type:'movie',title:'Spider-Man',original_title:'Spider-Man',original_language:'en',release_date:'2002-05-01',poster_path:'/spider.jpg',genre_ids:[28]},
   {id:page*100+2,media_type:'tv',name:'Spider-Man',original_name:'Spider-Man',original_language:'en',first_air_date:'1994-11-19',genre_ids:[16]},
   {id:page*100+3,media_type:'person',name:'Person'},
   {id:page*100+4,media_type:'movie',title:'Hidden',adult:true}
  ]});
 };
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{
 globalThis.fetch=originalFetch;
 if(previous.key===undefined)delete process.env.TMDB_API_KEY;else process.env.TMDB_API_KEY=previous.key;
 await new Promise(resolve=>server.close(resolve));
 await unlink(join(directory,'seo-catalog.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
 await rmdir(directory);
});

test('search space encodings return results directly without a canonical redirect loop',async()=>{
 for(const query of ['spider%20man','spider+man']){
  const response=await originalFetch(base+'/search/?q='+query+'&page=2',{redirect:'manual'});
  assert.equal(response.status,200,query);assert.equal(response.headers.get('location'),null);
  const html=await response.text();
  assert.match(html,/data-server-rendered="true" data-page-kind="search"/);
  assert.match(html,/نتائج البحث عن «spider man»/);
  assert.match(html,/مشاهدة فيلم Spider-Man 2002 مترجم/);
  assert.match(html,/مسلسل أنمي Spider-Man 1994 مترجم كامل/);
  assert.match(html,/<meta name="robots" content="noindex, follow/);
  assert.match(html,/<link rel="canonical" href="[^"]+\/search\/\?q=spider\+man&amp;page=2"/);
  assert.match(html,/href="\/search\/\?q=spider\+man&amp;page=3"/);
  assert.doesNotMatch(html,/>Person</);assert.doesNotMatch(html,/>Hidden</);
 }
 assert.equal(providerCalls.length,1,'equivalent encodings reuse the same provider result');
 assert.equal(providerCalls[0].searchParams.get('query'),'spider man');
 assert.equal(providerCalls[0].searchParams.get('page'),'2');
});

test('search API keeps provider pagination and excludes person and adult results with one provider call',async()=>{
 const before=providerCalls.length;
 const response=await originalFetch(base+'/api/search?q=spider+man&page=3');
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.page,3);assert.equal(data.total_pages,6);assert.equal(data.total_results,107);
 assert.deepEqual(data.results.map(item=>item.media_type),['movie','tv']);
 assert.match(data.results[0].public_path,/^\/spider-man-2002[^/]*\/$/);
 assert.match(data.results[1].public_path,/^\/spider-man-1994[^/]*\/$/);
 assert.notEqual(data.results[0].public_path,data.results[1].public_path);
 assert.equal(providerCalls.length-before,1);
});

test('normalizing search URLs preserves literal plus signs and Arabic queries',async()=>{
 for(const term of ['spider+man','الرجل العنكبوت']){
  const params=new URLSearchParams({q:term,page:'2'});
  const target='/search/?q='+encodeURIComponent(term)+'&page=2';
  const response=await originalFetch(base+target,{redirect:'manual'});
  assert.equal(response.status,200,term);assert.equal(response.headers.get('location'),null);
  const html=await response.text(),canonical='/search/?'+String(params).replaceAll('&','&amp;');
  assert.ok(html.includes(canonical),term);
  assert.equal(providerCalls.at(-1).searchParams.get('query'),term);
 }
});

test('pagination bounds and invalid searches are rejected before calling the provider',async()=>{
 const before=providerCalls.length;
 for(const target of ['/search/?q=spider%20man&page=101','/search/?q=spider+man&page=1.5'])assert.equal((await originalFetch(base+target)).status,404);
 for(const target of ['/api/search?q=spider+man&page=101','/api/search?q=','/api/search?q='+('x'.repeat(121))])assert.equal((await originalFetch(base+target)).status,400);
 assert.equal(providerCalls.length,before);
});
