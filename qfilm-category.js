import {readFile,writeFile,mkdir,rename,stat} from './storage.js';
import {parseDownload,discoverVideoIds} from './qfilm-import.js';
import {MAX_LISTING_PAGES} from './public/pagination.js';
import {checkSyncDeadline,syncFetchSignal,joinSyncWorkers} from './sync-execution.js';
const source='https://a.qfilm.tv/category.php?cat=adult-movies';
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const runtimeClose=(record,movie)=>record.sourceRuntime&&movie.runtime&&Math.abs(movie.runtime-record.sourceRuntime)<=Math.min(8,Math.max(3,movie.runtime*.07));
export function parseAdultCategory(html){
 const grid=html.match(/<ul\b[^>]*id=["']pm-grid["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1];
 if(grid===undefined)throw new Error('Source category grid is missing');
 const entries=[];
 for(const match of grid.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)){
  const vid=discoverVideoIds(match[1])[0];
  const label=match[1].match(/\btitle=(["'])([\s\S]*?)\1/i)?.[2];
  if(!vid||!label)continue;
  const parsed=parseDownload(`<title>${label}</title>`);
  const cleanLabel=label.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#0*39;|&apos;/g,"'");
  const identity=cleanLabel.match(/^(?:مشاهدة\s+)?فيلم\s+(.+)\s+\(?((?:19|20)\d{2})\)?(?:\s+(?:مترجم|مدبلج|HD|اون|أون)|$)/);
  if(identity){parsed.title=identity[1].trim();parsed.year=identity[2];}
  const duration=match[1].match(/class=["']pm-label-duration["'][^>]*>([\d:]+)</)?.[1];
  const parts=duration?.split(':').map(Number),runtime=parts?.length===3?parts[0]*60+parts[1]+parts[2]/60:parts?.length===2?parts[0]+parts[1]/60:undefined;
  if(parsed.title&&parsed.year)entries.push({vid,title:parsed.title,year:parsed.year,...(runtime?{sourceRuntime:runtime}:{})});
 }
 let pages=1;
 for(const [,href] of html.matchAll(/href=["']([^"']+)["']/gi)){
  try{const url=new URL(href.replaceAll('&amp;','&'),'https://a.qfilm.tv/');if(url.origin==='https://a.qfilm.tv'&&url.pathname==='/category.php'&&url.searchParams.get('cat')==='adult-movies'){const n=Number(url.searchParams.get('page'));if(Number.isInteger(n)&&n>pages&&n<=200)pages=n;}}catch{}
 }
 return {entries,pages};
}
export function matchCategoryMovie(record,movies){
 const matches=movies.filter(m=>!m.adult&&(m.release_date||'').slice(0,4)===record.year&&[m.title,m.original_title].some(t=>normalize(t)===normalize(record.title)));
 const unique=[...new Map(matches.map(m=>[m.id,m])).values()];
 if(unique.length===1)return unique[0];
 const durationMatches=unique.filter(m=>runtimeClose(record,m));
 return durationMatches.length===1?durationMatches[0]:null;
}
export function createAdultCategory({directory=new URL('./data/',import.meta.url),fetcher=fetch,loadMovie,now=Date.now}={}){
 const file=new URL('qfilm-adult-category.json',directory);let state,pending,modified,refreshInterval=5*60*60*1000;
 async function load(){try{const info=await stat(file);if(!state||modified!==info.mtimeMs){state=JSON.parse(await readFile(file,'utf8'));modified=info.mtimeMs;}}catch(e){if(e.code!=='ENOENT')throw e;state||={entries:[],review:[],checkedAt:null};}return state;}
 async function get(page){checkSyncDeadline();const response=await fetcher(source+(page>1?'&page='+page:''),{signal:syncFetchSignal(20000)});if(!response.ok)throw new Error('Category source HTTP '+response.status);return parseAdultCategory(await response.text());}
 async function refresh({maxPages=Infinity}={}){
  if(pending)return pending;
  pending=(async()=>{
   const previous=await load(),first=await get(1),partial=Number.isFinite(maxPages);
   const start=partial?Math.min(Number(previous.refreshCursor)||1,first.pages):1,end=Math.min(first.pages,start+maxPages-1),pages=[];let cursor=start;
   await joinSyncWorkers(Array.from({length:4},async()=>{while(cursor<=end){const page=cursor++;pages.push(page===1?first.entries:(await get(page)).entries);}}));
   const sourceEntries=[...new Map(pages.flat().map(r=>[r.vid,r])).values()];if(!sourceEntries.length)throw new Error('Source category is empty');
   let known={};for(const name of ['qfilm-import.json','qfilm-new-import.json']){try{Object.assign(known,JSON.parse(await readFile(new URL(name,directory),'utf8')).entries||{});}catch(e){if(e.code!=='ENOENT')throw e;}}
   let works=[];try{works=Object.values(JSON.parse(await readFile(new URL('seo-catalog.json',directory),'utf8')).works||{}).filter(w=>w.type==='movie');}catch(e){if(e.code!=='ENOENT')throw e;}
   const previousByVid=new Map(previous.entries.map(r=>[r.vid,r]));
   const mapped=Array(sourceEntries.length);let index=0;
   await joinSyncWorkers(Array.from({length:4},async()=>{while(index<sourceEntries.length){checkSyncDeadline();const i=index++,record=sourceEntries[i],cached=[known[record.vid],previousByVid.get(record.vid)].find(r=>r?.tmdbId&&r.year===record.year&&normalize(r.title)===normalize(record.title));
    let id=cached?.tmdbId;
    if(!id||cached.year!==record.year||normalize(cached.title)!==normalize(record.title)){
     const local=works.filter(w=>w.year===record.year&&normalize(w.name)===normalize(record.title));id=local.length===1?local[0].id:null;
     if(!id&&loadMovie){try{
      const found=await loadMovie('search/movie',new URLSearchParams({query:record.title,year:record.year,language:'en-US',include_adult:'false'}));
      let matches=found.results||[];id=matchCategoryMovie(record,matches)?.id;
      if(!id&&record.sourceRuntime){matches=matches.filter(m=>m.release_date?.slice(0,4)===record.year&&[m.title,m.original_title].some(t=>normalize(t)===normalize(record.title)));const details=await Promise.all(matches.map(m=>loadMovie('movie/'+m.id,new URLSearchParams({language:'en-US'}))));id=matchCategoryMovie(record,details)?.id;}
      if(!id&&record.sourceRuntime){
       const wider=await loadMovie('search/movie',new URLSearchParams({query:record.title,language:'en-US',include_adult:'false'}));
       const candidates=(wider.results||[]).filter(m=>!m.adult&&[m.title,m.original_title].some(t=>normalize(t)===normalize(record.title)));
       if(candidates.length<=6){const details=await Promise.all(candidates.map(m=>loadMovie('movie/'+m.id,new URLSearchParams({language:'en-US'}))));const sameRuntime=details.filter(m=>!m.adult&&runtimeClose(record,m));if(sameRuntime.length===1)id=sameRuntime[0].id;}
       if(!id){
        const yearCandidates=(wider.results||[]).filter(m=>!m.adult&&Math.abs(Number(m.release_date?.slice(0,4))-Number(record.year))<=1).slice(0,6),verified=[];
        for(const candidate of yearCandidates){
         const detail=await loadMovie('movie/'+candidate.id,new URLSearchParams({language:'en-US',append_to_response:'alternative_titles'}));
         const alias=(detail.alternative_titles?.titles||[]).some(t=>normalize(t.title)===normalize(record.title));
         const exactTitle=[detail.title,detail.original_title].some(t=>normalize(t)===normalize(record.title));
         if(!detail.adult&&(exactTitle||alias)&&(runtimeClose(record,detail)||alias&&!exactTitle&&detail.release_date?.slice(0,4)===record.year))verified.push(detail);
        }
        if(verified.length===1)id=verified[0].id;
       }
      }
     }catch{}}
    }
    mapped[i]={...record,...(id?{tmdbId:Number(id)}:{})};
   }}));
   checkSyncDeadline();
   const seenSource=new Set([...(partial&&start>1?previous.refreshSeen||[]:[]),...sourceEntries.map(r=>r.vid)]);
   const combined=partial?[...new Map([...(previous.entries||[]),...(previous.review||[]),...mapped].map(r=>[r.vid,r])).values()].filter(r=>end<first.pages||seenSource.has(r.vid)):mapped;
   const seen=new Set(),entries=combined.filter(r=>r.tmdbId&&!seen.has(r.tmdbId)&&seen.add(r.tmdbId));
   const next={source,checkedAt:new Date(now()).toISOString(),sourcePages:first.pages,sourceCount:partial?combined.length:sourceEntries.length,entries,review:combined.filter(r=>!r.tmdbId),...(partial&&end<first.pages?{refreshCursor:end+1,refreshSeen:[...seenSource]}:{})};
   await mkdir(directory,{recursive:true});const temp=new URL('qfilm-adult-category.tmp',directory);await writeFile(temp,JSON.stringify(next));await rename(temp,file);state=next;return next;
  })().finally(()=>{pending=null;});return pending;
 }
 async function current(){const value=await load();if(!value.checkedAt)return refresh();if(now()-Date.parse(value.checkedAt)>refreshInterval)void refresh().catch(()=>{});return value;}
 return {refresh,setInterval(ms){refreshInterval=ms;},async snapshot(){return structuredClone(await load());},async contains(id){return (await load()).entries.some(r=>r.tmdbId===Number(id));},async listing(page,year){
  const value=await current(),records=value.entries.filter(r=>!year||r.year===year),totalPages=Math.max(1,Math.min(MAX_LISTING_PAGES,Math.ceil(records.length/20)));
  if(page>totalPages)throw Object.assign(new Error('الصفحة غير موجودة'),{status:404});
  const selected=records.slice((page-1)*20,page*20),results=Array(selected.length);let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<selected.length){const index=cursor++,r=selected[index];const movie=await loadMovie('movie/'+r.tmdbId,new URLSearchParams({language:'ar-SA'}));if(movie.adult)continue;results[index]={...movie,media_type:'movie',source_adult_category:true};}}));
  return {page,page_size:20,total_pages:totalPages,total_results:records.length,results:results.filter(Boolean)};
 }};
}
