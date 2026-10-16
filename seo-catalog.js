import {readFile,writeFile,mkdir,rename} from './storage.js';
import {createHash} from 'node:crypto';
import {englishWorkName} from './title-language.js';
import {dbEnabled} from './database.js';
import {rememberAndApply,resolveManaged,managedWorks} from './managed-content.js';

export const slugify=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,150).replace(/-$/,'');
const reserved=new Set(['admin','movies','movie','series','anime','categories','top','recent','episodes','seasons','search','dmca','terms','api','uploads']);
export function createSeoCatalog(directory=new URL('./data/',import.meta.url)){
 const file=new URL('seo-catalog.json',directory);let state,queue=Promise.resolve();
 async function load(){if(!state){try{state=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={works:{},images:{}};}state.pages||={};let changed=false;for(const record of Object.values(state.works)){if('aliases' in record){delete record.aliases;changed=true;}}if(changed)await persist();}return state;}
 const serial=work=>{const next=queue.catch(()=>{}).then(work);queue=next;return next;};
 async function persist(){await mkdir(directory,{recursive:true});await writeFile(new URL('seo-catalog.tmp',directory),JSON.stringify(state));await rename(new URL('seo-catalog.tmp',directory),file);}
 return {
  async resolve(slug){if(dbEnabled())return resolveManaged(slug);await queue;const data=await load();return Object.values(data.works).find(item=>item.slug===slug);},
  async all(){if(dbEnabled())return managedWorks();await queue;return Object.values((await load()).works);},
  async pages(){await queue;return Object.values((await load()).pages);},
  async collections(){await queue;return (await load()).collections||{};},
  markCollection(metadata){return serial(async()=>{
   await load();state.collections||={};
   const url=new URL(metadata.canonical);if(url.search)return;
   const next={indexable:!metadata.noindex,title:metadata.title,description:metadata.description};
   if(JSON.stringify(state.collections[url.pathname])!==JSON.stringify(next)){state.collections[url.pathname]=next;await persist();}
  });},
  async imageSource(name){await queue;return (await load()).images[name]?.source;},
  mark(item,metadata){return serial(async()=>{await load();const record=state.works[`${item.media_type|| (item.name?'tv':'movie')}:${item.id}`];if(record){const path=decodeURI(new URL(metadata.canonical).pathname);const hash=createHash('sha256').update(JSON.stringify([metadata.title,metadata.description,item.poster_path])).digest('hex');const previous=state.pages[path];state.pages[path]={path,indexable:!metadata.noindex,title:metadata.title,description:metadata.description,poster:item.poster_path,hash,lastmod:previous?.hash===hash?previous.lastmod:new Date().toISOString()};if(path===`/${record.slug}/`){record.indexable=!metadata.noindex;record.description=metadata.description;record.title=metadata.title;}await persist();}});},
  decorate(data,fallbackType){return serial(async()=>{
   await load();let changed=false;
   function visit(item,fallback){
    if(!item||typeof item!=='object')return item;
    if(Array.isArray(item.results))return {...item,results:item.results.map(m=>visit(m,fallback))};
    if(!item.id||item.media_type==='person'||(!item.title&&!item.name))return item;
    const type=item.media_type||fallback||(item.title?'movie':'tv');if(!['movie','tv'].includes(type))return item;
    const english=englishWorkName(item);
    const key=`${type}:${item.id}`,name=english||`${type}-${item.id}`;
    const year=(item.release_date||item.first_air_date||'').slice(0,4);
    let record=state.works[key];
    if(!record||/[^a-z0-9-]/.test(record.slug)||((record.name===`${type}-${item.id}`||record.name==='Untitled')&&english)||(name!==record.name&&/^\d+$/.test(name))){
     const previous=record;
     let slug=slugify([name,year].filter(Boolean).join(' ')).replace(/[^a-z0-9-]/g,'')||`${type}-${item.id}`;
     const exists=value=>reserved.has(value)||Object.values(state.works).some(r=>r.slug===value);
     if(exists(slug))slug+='-'+(type==='tv'?'series':'film');
     if(exists(slug))slug+='-'+createHash('sha256').update(key).digest('hex').slice(0,8).replace(/[0-9]/g,n=>String.fromCharCode(103+Number(n)));
     record=state.works[key]={...previous,id:item.id,type,slug,name,year,indexable:previous?.indexable??(!!item.overview&&!item.adult)};
     if(previous){for(const [page,value] of Object.entries(state.pages)){if(page.startsWith(`/${previous.slug}/`)){const next=page.replace(`/${previous.slug}/`,`/${slug}/`);state.pages[next]={...value,path:next};delete state.pages[page];}}}
     changed=true;
    }
    function namedImage(source,role){
     if(!source)return source;
     if(state.images[source.slice(1)]){if(source.startsWith('/'+record.slug+'-'))return source;source=state.images[source.slice(1)].source;}
     if(!/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(source))return null;
     const extension=source.split('.').pop(),base=`${record.slug}-${role}`;
     let filename=`${base}.${extension}`,revision=2;
     while(state.images[filename]&&state.images[filename].source!==source)filename=`${base}-${revision++}.${extension}`;
     if(!state.images[filename]){state.images[filename]={source};changed=true;}
     return '/'+filename;
    }
    const result={...item,media_type:type,public_path:`/${record.slug}/`,poster_path:namedImage(item.poster_path,'poster'),backdrop_path:namedImage(item.backdrop_path,'backdrop')};
    if(record.poster!==result.poster_path){record.poster=result.poster_path;changed=true;}
    if(type==='movie')for(const field of ['certifications','age_rating','adult_audience']){
     if(item[field]!==undefined&&JSON.stringify(record[field])!==JSON.stringify(item[field])){record[field]=item[field];changed=true;}
     if(result[field]===undefined&&record[field]!==undefined)result[field]=record[field];
    }
    if(item.seasons)result.seasons=item.seasons.map(s=>({...s,poster_path:namedImage(s.poster_path,`season-${s.season_number}-poster`)}));
    if(item.recommendations)result.recommendations=visit(item.recommendations,type);
    return result;
   }
   const result=visit(data,fallbackType);if(changed)await persist();return rememberAndApply(result,fallbackType);
  });},
 };
}
