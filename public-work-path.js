import {englishWorkName} from './title-language.js';

export function publicWorkSlug(item){
 const name=englishWorkName(item),year=String(item.release_date||item.first_air_date||'').slice(0,4);
 if(!name)return;
 return [name,year].filter(Boolean).join(' ').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,150).replace(/-$/,'')||undefined;
}

// Resolve a newly discovered name without inserting records during a visit.
// Stored slugs are resolved first by the caller, preserving existing URLs.
export function createPublicWorkResolver(load){
 const pending=new Map(),cache=new Map();
 return async slug=>{
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*-(?:19|20)\d{2}$/.test(slug))return null;
  const saved=cache.get(slug);if(saved&&saved.expires>Date.now())return saved.value;
  if(pending.has(slug))return pending.get(slug);
  const work=(async()=>{
   const query=slug.replace(/-\d{4}$/,'').replaceAll('-',' ');
   const data=await load('search/multi',new URLSearchParams({query,language:'en-US',include_adult:'false'}));
   const matches=(data.results||[]).filter(item=>['movie','tv'].includes(item.media_type)&&!item.adult&&publicWorkSlug(item)===slug);
   // Never guess which work owns an ambiguous name.
   const value=matches.length===1?{id:matches[0].id,type:matches[0].media_type,slug}:null;
   if(cache.size>=500)cache.delete(cache.keys().next().value);
   cache.set(slug,{value,expires:Date.now()+(value?300000:60000)});
   return value;
  })().finally(()=>pending.delete(slug));
  pending.set(slug,work);return work;
 };
}
