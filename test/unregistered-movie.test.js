import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(name,context,next){return name==='./seo-catalog.js'?{url:'cimahub:unregistered-catalog',shortCircuit:true}:next(name,context);},load(url,context,next){return url==='cimahub:unregistered-catalog'?{format:'module',shortCircuit:true,source:`export const createSeoCatalog=()=>({resolve:async()=>null,decorate:async data=>({...data,public_path:'/unregistered-film-2027/'}),mark:async()=>{},all:async()=>[],pages:async()=>[],collections:async()=>({}),imageSource:async()=>null});`}:next(url,context);}});
const {server}=await import('../server.js');
test('new movies use named URLs, including a direct visit before any listing or numeric page',async()=>{
 const originalFetch=globalThis.fetch,oldKey=process.env.TMDB_API_KEY;
 process.env.TMDB_API_KEY='fixture';
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));
  if(url.hostname==='api.themoviedb.org'){
   const movie={id:1801563,media_type:'movie',title:'Unregistered Film',original_title:'Unregistered Film',original_language:'en',overview:'قصة الفيلم الجديد.',release_date:'2027-01-01',genres:[],credits:{cast:[],crew:[]},keywords:{keywords:[]},videos:{results:[]},recommendations:{results:[]}};
   return Response.json(url.pathname==='/3/search/multi'?{results:[movie]}:movie);
  }
  return originalFetch(input,options);
 };
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await originalFetch(base+'/unregistered-film-2027/',{redirect:'manual'});
  assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
  const html=await response.text();assert.match(html,/<h1[^>]*>[\s\S]*?Unregistered Film/);
  assert.match(html,/<link rel="canonical" href="http:\/\/127\.0\.0\.1:3000\/unregistered-film-2027\/">/);
  assert.doesNotMatch(html,/(?:href|src)="[^"]*undefined/);
  const numeric=await originalFetch(base+'/movie/1801563/',{redirect:'manual'});
  assert.equal(numeric.status,301);assert.equal(numeric.headers.get('location'),'/unregistered-film-2027/');
 }finally{
  globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.TMDB_API_KEY;else process.env.TMDB_API_KEY=oldKey;
  await new Promise(resolve=>server.close(resolve));
 }
});
