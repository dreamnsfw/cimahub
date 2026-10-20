import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedCache,publicPageCacheKey} from '../shared-cache.js';

test('independent servers share public pages and admin invalidation removes them',async()=>{
 const entries=new Map();
 const store={async get(k){return entries.get(k)?.value;},async set(k,value,options){entries.set(k,{value,options});},async expireTag(tag){for(const [k,e] of entries)if(e.options.tags.includes(tag))entries.delete(k);}};
 const first=createSharedCache({enabled:true,store}),second=createSharedCache({enabled:true,store});
 await first.set('page',{body:'old'},{tags:['cimahub-pages']});
 await first.set('provider',{title:'cached'},{tags:[]});
 assert.deepEqual(await second.get('page'),{body:'old'});
 await second.invalidatePages();assert.equal(await first.get('page'),undefined);
 assert.deepEqual(await first.get('provider'),{title:'cached'});
});
test('cache outages do not break rendering, while failed admin invalidation is reported',async()=>{
 const store={get(){throw Error('offline');},set(){throw Error('offline');},expireTag(){throw Error('offline');}};
 const cache=createSharedCache({enabled:true,store});
 assert.equal(await cache.get('page'),undefined);await cache.set('page','html');
 await assert.rejects(cache.invalidatePages(),/offline/);
});

test('public data preparation never calls the remote runtime cache',async()=>{
 const previous={VERCEL:process.env.VERCEL,CIMAHUB_PREPARING_PUBLIC_DATA:process.env.CIMAHUB_PREPARING_PUBLIC_DATA};
 process.env.VERCEL='1';process.env.CIMAHUB_PREPARING_PUBLIC_DATA='1';
 try{
  const unexpected=()=>{throw Error('Build must not call runtime cache');};
  const cache=createSharedCache({store:{get:unexpected,set:unexpected,expireTag:unexpected}});
  assert.equal(await cache.get('page'),undefined);await cache.set('page','html');await cache.invalidatePages();
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('private routes and search never enter the public HTML cache; deployment, origin and year are isolated',()=>{
 const key=(path,origin='https://cimahub.net',version='one',year=2026)=>publicPageCacheKey(new URL(path,'https://cimahub.net'),origin,version,new Date(year,0,1));
 for(const path of ['/admin/','/api/admin/content','/api/home','/uploads/thumbs/w300/a.jpg','/search/','/search?q=x'])assert.equal(key(path),null);
 assert.notEqual(key('/'),key('/','https://preview.example'));
 assert.notEqual(key('/'),key('/','https://cimahub.net','two'));
 assert.notEqual(key('/'),key('/','https://cimahub.net','one',2027));
 assert.notEqual(key('/movies/?page=2'),key('/movies/'));
});
