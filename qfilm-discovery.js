import {readFile,writeFile,mkdir,rename} from './storage.js';
import {discoverVideoIds,parseDownload,parsePlayback,parseVideoPublication,matchMovie,safeLink,filterSourceLinks} from './qfilm-import.js';
import {checkSyncDeadline,syncFetchSignal} from './sync-execution.js';

// Discover source additions independently of popularity, vote count and local visits.
export function createQfilmDiscovery({directory=new URL('./data/',import.meta.url),fetcher=fetch,loadMovie,onMovie=async()=>{},now=Date.now,interval=1800000,batchSize=12}={}) {
  const file=new URL('qfilm-new-import.json',directory);
  let state,loading,overrides={},writes=Promise.resolve(),running=false,started=false,timer,controller;
  async function load(){if(state)return state;if(!loading)loading=(async()=>{
    try{state=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={entries:{},jobs:{},nextDiscovery:0};}
    state.jobs||={};state.entries||={};
    let changed=false;
    for(const [vid,record] of Object.entries(state.entries)){
      const clean=filterSourceLinks(record);
      if(JSON.stringify(clean)!==JSON.stringify(record)){state.entries[vid]=clean;changed=true;}
      if(state.jobs[vid]?.status==='available'&&!validSource(clean)){state.jobs[vid].status='waiting';state.jobs[vid].nextAttempt=0;changed=true;}
    }
    if(changed)await save();
    try{overrides=JSON.parse(await readFile(new URL('qfilm-match-overrides.json',directory),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const [vid,override] of Object.entries(overrides))if(override.verified===true&&state.jobs[vid]?.status==='review')state.jobs[vid].nextAttempt=0;
    return state;
  })();return loading;}
  function save(){writes=writes.catch(()=>{}).then(async()=>{await mkdir(directory,{recursive:true});await writeFile(new URL('qfilm-new-import.tmp',directory),JSON.stringify(state));await rename(new URL('qfilm-new-import.tmp',directory),file);});return writes;}
  async function get(url){checkSyncDeadline();const signal=syncFetchSignal(12000);const response=await fetcher(url,{signal:controller?AbortSignal.any([controller.signal,signal]):signal,headers:{'User-Agent':'CimaHubDiscovery/1.0'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.text();}
  const validSource=record=>record.status==='matched'&&[...(record.playback||[]),...(record.downloads||[])].some(link=>safeLink(link.url));
  async function discover(maxPages=Infinity){
    let known={};try{known=JSON.parse(await readFile(new URL('qfilm-import.json',directory),'utf8')).entries||{};}catch(error){if(error.code!=='ENOENT')throw error;}
    const paths=['/',...['foreign','arabic','asian','indian','turkish',String(new Date(now()).getUTCFullYear())].map(cat=>`/category.php?cat=${cat}-movies`)];
    let successes=0;const errors=[];
    const offset=Number(state.discoveryCursor)||0,selected=paths.slice(offset,offset+maxPages);
    for(const path of selected){checkSyncDeadline();try{
      for(const vid of discoverVideoIds(await get('https://a.qfilm.tv'+path))) {
        if(validSource(known[vid]||{})||validSource(state.entries[vid]||{})||state.jobs[vid]?.status==='excluded')continue;
        state.jobs[vid]||={status:'queued',nextAttempt:0,discoveredAt:new Date(now()).toISOString()};
        if(state.jobs[vid].status==='available'){state.jobs[vid].status='waiting';state.jobs[vid].nextAttempt=0;}
      }successes++;
    }catch(error){errors.push({path,message:error.message});if(controller?.signal.aborted)break;}}
    state.discoveryErrors=errors;state.lastDiscovery=new Date(now()).toISOString();
    state.discoveryCursor=offset+selected.length<paths.length?offset+selected.length:0;
    state.nextDiscovery=state.discoveryCursor?now():now()+(successes?interval:300000);await save();
    checkSyncDeadline();return successes?null:errors[0];
  }
  async function importOne(vid,job){
    checkSyncDeadline();
    const record=parseDownload(await get(`https://a.qfilm.tv/download.php?vid=${vid}`));
    if(!record.title||record.excluded){job.status='excluded';return;}
    record.source=`https://a.qfilm.tv/download.php?vid=${vid}`;
    record.playback=parsePlayback(await get(`https://a.qfilm.tv/play.php?vid=${vid}`));
    if(![...record.playback,...record.downloads].some(link=>safeLink(link.url))){job.status='waiting';job.nextAttempt=now()+interval;return;}
    const override=overrides[vid];let movie,matchEvidence;
    if(override?.verified===true&&Number.isSafeInteger(override.tmdbId)&&override.tmdbId>0&&override.title===record.title&&override.year===record.year&&override.evidence?.trim()){
      const candidate=await loadMovie(`movie/${override.tmdbId}`,new URLSearchParams({language:'en-US'}));
      movie=matchMovie(record,[{...candidate,genre_ids:candidate.genres?.map(genre=>genre.id)||candidate.genre_ids}]);
      if(movie)matchEvidence=override.evidence;
    }
    if(!movie){const matches=await loadMovie('search/movie',new URLSearchParams({query:record.title,year:record.year,language:'en-US',include_adult:'false'}));movie=matchMovie(record,matches.results||[]);}
    if(!movie){job.status='review';job.title=record.title;job.year=record.year;job.nextAttempt=now()+86400000;return;}
    let video;try{video=parseVideoPublication(await get(record.source.replace('/download.php','/watch.php')),record,now());}catch{checkSyncDeadline();}
    state.entries[vid]={...record,status:'matched',tmdbId:movie.id,movieTitle:movie.title,parserVersion:2,checkedAt:new Date(now()).toISOString(),...(video?{video}:{}),...(matchEvidence?{matchEvidence}:{})};
    // Publish the record before refreshing the catalog; a presentation failure is retryable.
    await save();checkSyncDeadline();await onMovie({...movie,media_type:'movie'});checkSyncDeadline();
    job.status='available';job.tmdbId=movie.id;job.title=record.title;job.year=record.year;job.nextAttempt=null;
  }
  async function tick({discoverOnly=false,maxJobs=batchSize,maxDiscoveryPages=Infinity,throwOnError=false}={}) {
    if(running)return;running=true;clearTimeout(timer);
    try{checkSyncDeadline();await load();const errors=[];let processed=0;if(!state.nextDiscovery||state.nextDiscovery<=now()){const error=await discover(maxDiscoveryPages);if(error)errors.push(new Error(error.message));}
      if(!discoverOnly){const jobs=Object.entries(state.jobs).filter(([,job])=>!['available','excluded'].includes(job.status)&&job.nextAttempt<=now()).slice(0,maxJobs);
        for(const [vid,job] of jobs){if(controller?.signal.aborted)break;
          checkSyncDeadline();try{await importOne(vid,job);delete job.error;}catch(error){job.status='error';job.error=error.message;job.nextAttempt=now()+300000;errors.push(error);}
          job.lastAttempt=new Date(now()).toISOString();await save();processed++;checkSyncDeadline();
        }
      }
      if(throwOnError&&errors.length)throw errors[0];
      return {processed,discoveryCursor:state.discoveryCursor||0};
    }finally{running=false;if(started){timer=setTimeout(()=>{void tick().catch(error=>console.warn('Source discovery:',error.message));},15000);timer.unref();}}
  }
  return {tick,setInterval(ms){interval=ms;},async snapshot(){await load();await writes;return JSON.parse(JSON.stringify(state));},
    start(){if(started)return;started=true;controller=new AbortController();void tick().catch(error=>console.warn('Source discovery:',error.message));},
    stop(){started=false;clearTimeout(timer);controller?.abort();}
  };
}
