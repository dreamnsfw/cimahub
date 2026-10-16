import {readFile,readdir,writeFile,rename} from './storage.js';

export function createRecentAdditions(directory=new URL('./data/',import.meta.url)) {
  let queue=Promise.resolve();
  const read=async file=>{try{return JSON.parse(await readFile(new URL(file,directory),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}};
  const files=async folder=>{try{return (await readdir(new URL(folder,directory))).filter(f=>f.endsWith('.json'));}catch(e){if(e.code==='ENOENT')return [];throw e;}};
  return (page=1)=>{
    const task=queue.catch(()=>{}).then(async()=>{
      const stored=await read('recent-additions.json'), entries=stored.entries||{}, candidates=new Map();
      const add=(key,item,record)=>{
        if(!(record.playback?.length||record.downloads?.length))return;
        const stamp=record.addedAt||record.checkedAt;
        const date=Number.isFinite(Date.parse(stamp))?stamp:null;
        const previous=candidates.get(key);
        if(!previous||date&&(!previous.source_date||date<previous.source_date))candidates.set(key,{...item,source_date:date});
      };
      for(const r of Object.values((await read('qfilm-import.json')).entries||{}))if(r.status==='matched')add(`movie-${r.tmdbId}`,{id:r.tmdbId,media_type:'movie',title:r.movieTitle||r.title},r);
      for(const file of await files('auto-movie-links/')){
        const records=await read('auto-movie-links/'+file);
        for(const r of Array.isArray(records)?records:[])add(`movie-${Number(file.replace('.json',''))}`,{id:Number(file.replace('.json','')),media_type:'movie',title:r.movieTitle||r.title},r);
      }
      for(const file of await files('series-links/')){
        const series=await read('series-links/'+file);
        for(const [key,r] of Object.entries(series.episodes||{})){
          const [season,episode]=key.split('-').map(Number);
          add(`episode-${series.tmdbId}-${season}-${episode}`,{id:series.tmdbId,media_type:'tv',name:series.title,season_number:season,episode_number:episode},r);
        }
      }
      let changed=false;
      for(const [key,item] of candidates)if(!entries[key]){entries[key]={...item,added_at:stored.initialized?new Date().toISOString():item.source_date||new Date().toISOString()};changed=true;}
      if(changed||!stored.initialized){await writeFile(new URL('recent-additions.tmp',directory),JSON.stringify({initialized:true,entries},null,2));await rename(new URL('recent-additions.tmp',directory),new URL('recent-additions.json',directory));}
      const all=Object.entries(entries).filter(([key])=>candidates.has(key)).sort((a,b)=>b[1].added_at.localeCompare(a[1].added_at)||a[0].localeCompare(b[0])).map(([,item])=>item);
      const total_pages=Math.max(1,Math.ceil(all.length/12));
      page=Math.min(total_pages,Math.max(1,Math.floor(Number(page)||1)));
      return {page,total_pages,total_results:all.length,results:all.slice((page-1)*12,page*12)};
    });
    queue=task;return task;
  };
}
