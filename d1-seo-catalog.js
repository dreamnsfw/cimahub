import {createHash} from 'node:crypto';
import {d1Request,prefetchCatalog} from './d1-client.js';
import {englishWorkName} from './title-language.js';
import {publicWorkSlug} from './public-work-path.js';
import {rememberAndApply,resolveManaged,managedWorks} from './managed-content.js';
const slugify=value=>String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,150).replace(/-$/,'');
const get=(namespace,key)=>d1Request('catalog.get',{namespace,key});
const set=(namespace,key,value)=>d1Request('catalog.set',{namespace,key,value});
const list=async namespace=>Object.fromEntries((await d1Request('catalog.list',{namespace})).map(r=>[r.key,JSON.parse(r.value)]));
export function createD1SeoCatalog(){
 let queue=Promise.resolve();
 const serial=work=>{const next=queue.catch(()=>{}).then(work);queue=next;return next;};
 return {
  resolve:resolveManaged,all:managedWorks,
  async pages(){return Object.values(await list('pages'));},
  collections:()=>list('collections'),
  async imageSource(name){return (await get('images',name))?.source;},
  async markCollection(metadata){const url=new URL(metadata.canonical);if(url.search)return;const value={indexable:!metadata.noindex,title:metadata.title,description:metadata.description};const previous=await get('collections',url.pathname);if(JSON.stringify(previous)!==JSON.stringify(value))await set('collections',url.pathname,value);},
  async mark(item,metadata){
   const key=`${item.media_type||(item.name?'tv':'movie')}:${item.id}`,record=await get('works',key);if(!record)return;
   const path=decodeURI(new URL(metadata.canonical).pathname),hash=createHash('sha256').update(JSON.stringify([metadata.title,metadata.description,item.poster_path])).digest('hex');
   const previous=await get('pages',path),next={path,indexable:!metadata.noindex,title:metadata.title,description:metadata.description,poster:item.poster_path,hash,lastmod:previous?.hash===hash?previous.lastmod:new Date().toISOString()};
   if(JSON.stringify(previous)!==JSON.stringify(next))await set('pages',path,next);
   if(path===`/${record.slug}/`){const updated={...record,indexable:!metadata.noindex,title:metadata.title,description:metadata.description};if(JSON.stringify(record)!==JSON.stringify(updated))await set('works',key,updated);}
  },
  // Public rendering is read-only. Background sync can opt into persistence.
  decorate(data,fallbackType,{persist=false}={}){return serial(async()=>{
   const candidates=[];
   function collect(value,fallback){if(!value||typeof value!=='object')return;if(Array.isArray(value.results)){value.results.forEach(v=>collect(v,fallback));return;}const type=value.media_type||fallback||(value.title?'movie':'tv');if(value.id&&['movie','tv'].includes(type)&&(value.title||value.name)){candidates.push({item:value,type,key:type+':'+value.id});if(value.recommendations)collect(value.recommendations,type);}}
   collect(data,fallbackType);await prefetchCatalog('works',candidates.map(c=>c.key));
   const imageNames=[];
   for(const {item,key} of candidates){const record=await get('works',key);for(const [source,role] of [[item.poster_path,'poster'],[item.backdrop_path,'backdrop'],...(item.seasons||[]).map(s=>[s.poster_path,`season-${s.season_number}-poster`])])if(source){imageNames.push(source.slice(1));if(record)imageNames.push(`${record.slug}-${role}.${source.split('.').pop()}`);}}
   await prefetchCatalog('images',imageNames);
   async function visit(item,fallback){
    if(!item||typeof item!=='object')return item;
    if(Array.isArray(item.results))return {...item,results:await Promise.all(item.results.map(value=>visit(value,fallback)))};
    if(!item.id||item.media_type==='person'||(!item.title&&!item.name))return item;
    const type=item.media_type||fallback||(item.title?'movie':'tv');if(!['movie','tv'].includes(type))return item;
    const key=`${type}:${item.id}`,existing=await get('works',key),name=englishWorkName(item)||`${type}-${item.id}`,year=(item.release_date||item.first_air_date||'').slice(0,4);
    let record=existing;
    if(!record){let slug=publicWorkSlug(item)||slugify([name,year].filter(Boolean).join(' '))||`${type}-${item.id}`;if(['admin','movies','series','anime','search','top','recent','categories','api','uploads','seasons','episodes','dmca','terms'].includes(slug))slug+='-'+type;
     const owner=await resolveManaged(slug);if(owner&&(owner.id!==item.id||owner.type!==type))slug+='-'+type+'-'+item.id;
     record={id:item.id,type,slug,name,year,indexable:!!item.overview&&!item.adult};}
    async function image(source,role){
     if(!source)return source;
     if(source.startsWith('/'+record.slug+'-'))return source;
     const prior=await get('images',source.slice(1));if(prior)source=prior.source;
     if(!/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(source))return null;
     const extension=source.split('.').pop(),base=`${record.slug}-${role}`;let file=base+'.'+extension,n=2;
     while(true){const previous=await get('images',file);if(!previous){if(!persist)return source;await set('images',file,{source});break;}if(previous.source===source)break;file=`${base}-${n++}.${extension}`;}
     return '/'+file;
    }
    const result={...item,media_type:type,public_path:`/${record.slug}/`,poster_path:await image(item.poster_path,'poster'),backdrop_path:await image(item.backdrop_path,'backdrop')};
    const updated={...record,poster:result.poster_path};
    if(type==='movie')for(const field of ['certifications','age_rating','adult_audience']){if(item[field]!==undefined)updated[field]=item[field];if(result[field]===undefined&&record[field]!==undefined)result[field]=record[field];}
    if(persist&&JSON.stringify(existing)!==JSON.stringify(updated))await set('works',key,updated);
    if(item.seasons)result.seasons=await Promise.all(item.seasons.map(async s=>({...s,poster_path:await image(s.poster_path,`season-${s.season_number}-poster`)})));
    if(item.recommendations)result.recommendations=await visit(item.recommendations,type);
    return result;
   }
   return rememberAndApply(await visit(data,fallbackType),fallbackType,{persist});
  });}
 };
}
