import {readFile,mkdir,writeFile,rename} from './storage.js';
import {parseDownload,parsePlayback,safeLink} from './qfilm-import.js';
import {usesMoviePresentation} from './movie-presentation.js';
import {checkSyncDeadline,syncFetchSignal,joinSyncWorkers} from './sync-execution.js';

const norm=s=>(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function searchCandidates(html,movie) {
  const names=new Set([movie.title,movie.original_title].filter(Boolean).map(norm));
  const found=new Set();
  for(const anchor of html.matchAll(/<a\b([^>]*)>/gi)){
    const title=anchor[1].match(/\btitle=(["'])([\s\S]*?)\1/)?.[2];
    const href=anchor[1].match(/\bhref=(["'])([\s\S]*?)\1/)?.[2];
    if(!title||!href)continue;
    const record=parseDownload(`<title>${title}</title>`);
    if(!names.has(norm(record.title))||record.year!==movie.release_date?.slice(0,4))continue;
    try{const url=new URL(href.replaceAll('&amp;','&'),'https://a.qfilm.tv/');const id=url.searchParams.get('vid');if(url.origin==='https://a.qfilm.tv'&&/^\/(watch|play|download)\.php$/.test(url.pathname)&&/^[a-z0-9]+$/i.test(id||''))found.add(id);}catch{}
  }
  return [...found].slice(0,20);
}

export function createLinkSync({directory=new URL('./data/',import.meta.url),loadMovie,fetcher=fetch,now=Date.now}={}) {
  const queueFile=new URL('movie-link-queue.json',directory);
  const resultsDirectory=new URL('auto-movie-links/',directory);
  let state={jobs:{}},loaded=false,loading,writes=Promise.resolve(),busy=false,timer,started=false;
  let legacy={},legacyUntil=0;
  async function init(){if(loaded)return;if(!loading)loading=(async()=>{try{state=JSON.parse(await readFile(queueFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}if(state.matchingVersion!=='site-title-year-v1'){for(const job of Object.values(state.jobs))if(!['available','excluded'].includes(job.status))job.nextAttempt=0;state.matchingVersion='site-title-year-v1';}loaded=true;})();await loading;}
  async function save(){writes=writes.catch(()=>{}).then(async()=>{await mkdir(directory,{recursive:true});const tmp=new URL('movie-link-queue.tmp',directory);await writeFile(tmp,JSON.stringify(state,null,2));await rename(tmp,queueFile);});return writes;}
  async function existing(){if(now()>legacyUntil){try{legacy=JSON.parse(await readFile(new URL('qfilm-import.json',directory),'utf8')).entries||{};}catch(e){if(e.code!=='ENOENT')throw e;legacy={};}legacyUntil=now()+30000;}return legacy;}
  async function get(url){checkSyncDeadline();const r=await fetcher(url,{signal:syncFetchSignal(12000),headers:{'User-Agent':'CimaHubLinkSync/1.0'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();}
  async function enqueue(movies){
    await init();let changed=false;
    for(const movie of movies){
      if(!movie||!Number.isSafeInteger(Number(movie.id))||Number(movie.id)<1||movie.adult||!usesMoviePresentation(movie,'movie'))continue;
      const id=String(movie.id);
      if(!state.jobs[id]){state.jobs[id]={id:Number(id),title:movie.title||movie.original_title||'',status:'queued',nextAttempt:0};changed=true;}
    }
    if(changed)await save();
    if(started)void tick().catch(e=>console.warn('Link sync deferred:',e.message));
  }
  async function resolve(job,{maxCandidates=20}={}){
    checkSyncDeadline();
    try{const saved=JSON.parse(await readFile(new URL(`${job.id}.json`,resultsDirectory),'utf8'));if(saved.some(r=>[...(r.playback||[]),...(r.downloads||[])].some(l=>safeLink(l.url)))){job.status='available';job.nextAttempt=now()+86400000;return;}}catch(e){if(e.code!=='ENOENT')throw e;}
    const records=await existing();
    if(Object.values(records).some(r=>r.status==='matched'&&r.tmdbId===job.id&&[...(r.playback||[]),...(r.downloads||[])].some(l=>safeLink(l.url)))){job.status='available';job.nextAttempt=now()+86400000;return;}
    const movie=await loadMovie(`movie/${job.id}`,new URLSearchParams({language:'en-US'}));
    if(movie.adult||!usesMoviePresentation(movie,'movie')){job.status='excluded';job.nextAttempt=null;return;}
    job.title=movie.title;job.year=movie.release_date?.slice(0,4);
    if(!job.year){job.status='waiting';job.nextAttempt=now()+21600000;return;}
    const names=new Set([movie.title,movie.original_title].map(norm));
    const ids=new Set(Object.entries(records).filter(([,r])=>names.has(norm(r.title))&&r.year===job.year&&!r.excluded).map(([id])=>id));
    for(const name of [...new Set([movie.title,movie.original_title].filter(Boolean))]){
      const html=await get('https://a.qfilm.tv/search.php?'+new URLSearchParams({keywords:name}));
      searchCandidates(html,movie).forEach(id=>ids.add(id));
    }
    const found=[];
    const candidates=[...ids].slice(0,20),offset=Number(job.sourceCursor)||0,selected=candidates.slice(offset,offset+maxCandidates);
    for(const initialId of selected){
      checkSyncDeadline();
      let id=initialId,record,html;
      for(let hop=0;hop<3;hop++){
        checkSyncDeadline();
        record=parseDownload(await get(`https://a.qfilm.tv/download.php?vid=${id}`));
        if(record.excluded||!names.has(norm(record.title))||record.year!==job.year){record=null;break;}
        if(records[id]?.status==='matched'&&records[id].tmdbId!==job.id){record=null;break;}
        html=await get(`https://a.qfilm.tv/play.php?vid=${id}`);
        const next=html.match(/class=["']xtgo["'][^>]*href=["']play\.php\?vid=([a-z0-9]+)/)?.[1];
        if(next&&next!==id&&hop<2){id=next;continue;}break;
      }
      if(!record)continue;
      record.matchEvidence='Exact site movie title and release year';
      record.playback=parsePlayback(html);
      if(!record.playback.length&&!record.downloads.length)continue;
      found.push({...record,status:'matched',tmdbId:job.id,source:`https://a.qfilm.tv/download.php?vid=${id}`,checkedAt:new Date(now()).toISOString()});
    }
    if(found.length){
      await mkdir(resultsDirectory,{recursive:true});
      const file=new URL(`${job.id}.json`,resultsDirectory),tmp=new URL(`${job.id}.tmp`,resultsDirectory);
      await writeFile(tmp,JSON.stringify(found,null,2));await rename(tmp,file);
      delete job.sourceCursor;job.status='available';job.sources=found.length;job.nextAttempt=now()+86400000;
    }else if(offset+selected.length<candidates.length){job.sourceCursor=offset+selected.length;job.status='queued';job.nextAttempt=0;}
    else{delete job.sourceCursor;job.status='waiting';job.nextAttempt=now()+21600000;}
  }
  async function tick({maxJobs=12,maxCandidates=20,throwOnError=false}={}){
    if(busy)return;clearTimeout(timer);busy=true;
    try{
      checkSyncDeadline();
      await init();
      const jobs=Object.values(state.jobs).filter(j=>j.status!=='excluded'&&j.nextAttempt!==null&&j.nextAttempt<=now()).sort((a,b)=>a.nextAttempt-b.nextAttempt).slice(0,maxJobs);
      let cursor=0;const errors=[];
      await joinSyncWorkers(Array.from({length:2},async()=>{while(cursor<jobs.length){checkSyncDeadline();const job=jobs[cursor++];try{await resolve(job,{maxCandidates});delete job.error;}catch(error){job.status='error';job.error=error.message;job.nextAttempt=now()+1800000;errors.push(error);}job.lastAttempt=new Date(now()).toISOString();await save();checkSyncDeadline();}}));
      if(throwOnError&&errors.length)throw errors[0];
      return {processed:jobs.length,remaining:Object.values(state.jobs).filter(job=>job.status==='queued').length};
    }finally{busy=false;if(started){timer=setTimeout(()=>{void tick().catch(e=>console.warn('Link sync deferred:',e.message));},1000);timer.unref();}}
  }
  return {enqueue,tick,async snapshot(){await init();await writes;return JSON.parse(JSON.stringify(state));},
    async start(){if(started)return;started=true;await init();try{const index=JSON.parse(await readFile(new URL('movie-index.json',directory),'utf8'));await enqueue(Object.keys(index).map(id=>({id:Number(id),media_type:'movie'})));}catch(e){if(e.code!=='ENOENT')console.warn('Link sync seed:',e.message);}void tick().catch(e=>console.warn('Link sync deferred:',e.message));},
    stop(){started=false;clearTimeout(timer);}
  };
}
