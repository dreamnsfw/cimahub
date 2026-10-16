import {readFile,writeFile,rename} from 'node:fs/promises';
import {parseDownload,parsePlayback} from '../qfilm-import.js';
const file=new URL('../data/qfilm-import.json',import.meta.url);
const state=JSON.parse(await readFile(file,'utf8'));
if(!process.env.TMDB_API_KEY)throw new Error('TMDB_API_KEY required');
const normalize=s=>(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[^\p{L}\p{N}]/gu,'');
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();}
async function tmdb(endpoint,params={}){return JSON.parse(await get('https://api.themoviedb.org/3/'+endpoint+'?'+new URLSearchParams({...params,api_key:process.env.TMDB_API_KEY})));}
let writes=Promise.resolve();
function save(){writes=writes.then(async()=>{state.updatedAt=new Date().toISOString();const temp=new URL('../data/qfilm-import.tmp',import.meta.url);await writeFile(temp,JSON.stringify(state,null,2));await rename(temp,file);});return writes;}
const queue=Object.entries(state.entries).filter(([,r])=>['review','no-links'].includes(r.status)&&r.resolutionVersion!==1);
let cursor=0,completed=0,added=0;
await Promise.all(Array.from({length:5},async()=>{
  while(cursor<queue.length){
    const [vid,record]=queue[cursor++];
    try {
      if(record.status==='no-links'){
        const fresh=parseDownload(await get(`https://a.qfilm.tv/download.php?vid=${vid}`));
        if(fresh.title!==record.title||fresh.year!==record.year)throw new Error('Source identity changed');
        record.downloads=fresh.downloads;record.quality=fresh.quality;
        record.playback=parsePlayback(await get(`https://a.qfilm.tv/play.php?vid=${vid}`));
        if(!record.downloads.length&&!record.playback.length){record.resolutionVersion=1;continue;}
      }
      // Search without a year filter: festival and theatrical release years may differ.
      const language=/[\u0600-\u06ff]/.test(record.title)?'ar-SA':'en-US';
      const search=await tmdb('search/movie',{query:record.title,language,include_adult:'false'});
      const candidates=(search.results||[]).filter(m=>!m.adult&&!m.genre_ids?.includes(16)&&Math.abs(Number(m.release_date?.slice(0,4))-Number(record.year))<=2).slice(0,8);
      const accepted=[];
      for(const m of candidates){
        let exact=[m.title,m.original_title].some(t=>normalize(t)===normalize(record.title));
        const primaryYear=m.release_date?.slice(0,4);
        let detail;
        if(!exact){
          detail=await tmdb(`movie/${m.id}`,{language,append_to_response:'alternative_titles,translations,release_dates'});
          exact=[...(detail.alternative_titles?.titles||[]).map(t=>t.title),...(detail.translations?.translations||[]).map(t=>t.data?.title)].some(t=>normalize(t)===normalize(record.title));
        }
        if(!exact)continue;
        let validYear=primaryYear===record.year;
        if(!validYear){detail ||= await tmdb(`movie/${m.id}`,{language,append_to_response:'release_dates'});validYear=(detail.release_dates?.results||[]).some(country=>country.release_dates?.some(r=>r.release_date?.slice(0,4)===record.year));}
        if(validYear)accepted.push(m);
      }
      if(accepted.length===1){const m=accepted[0];record.status='matched';record.tmdbId=m.id;record.movieTitle=m.title;record.matchEvidence='Exact localized/alternative title and verified release year';added++;}
      else {record.status='review';record.reviewReason=accepted.length?'ambiguous':'no-confirmed-match';}
      record.resolutionVersion=1;record.resolvedAt=new Date().toISOString();delete record.resolutionError;
    }catch(error){record.resolutionError=error.message;}
    finally {completed++;if(completed%20===0)await save();if(completed%100===0)console.log(JSON.stringify({completed,total:queue.length,added}));}
    await new Promise(r=>setTimeout(r,200));
  }
}));
await save();
console.log(JSON.stringify({finished:true,completed,total:queue.length,added,uniqueMovies:new Set(Object.values(state.entries).filter(r=>r.status==='matched').map(r=>r.tmdbId)).size}));
