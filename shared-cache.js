import {createHash} from 'node:crypto';
import {getCache} from '@vercel/functions';

// Cache failures must never turn an otherwise healthy public page into an error.
export function createSharedCache({enabled=Boolean(process.env.VERCEL),store=getCache({namespace:'cimahub-public-v1',keyHashFunction:key=>key})}={}){
 const key=value=>createHash('sha256').update(value).digest('hex');
 return {
  async get(name){if(!enabled)return;try{return await store.get(key(name));}catch{return undefined;}},
  async set(name,value,{ttl=300,tags=[]}={}){if(!enabled)return;try{await store.set(key(name),value,{ttl,tags});}catch{}},
  async invalidatePages(){if(enabled)await store.expireTag('cimahub-pages');}
 };
}
export function publicPageCacheKey(url,origin,version='local',date=new Date()){
 if(/^\/(?:admin|api|uploads)(?:\/|$)/.test(url.pathname)||url.pathname==='/search/'||url.pathname==='/search')return null;
 return `html:${version}:${origin}:${date.getFullYear()}:${url.pathname}${url.search}`;
}
