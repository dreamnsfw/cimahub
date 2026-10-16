export function televisionUpdates(shows,today,since=''){
  const episodes=[],seasons=[];
  for(const show of shows){
    const base={id:show.id,name:show.name,original_name:show.original_name,poster_path:show.poster_path,original_language:show.original_language,first_air_date:show.first_air_date,genres:show.genres,media_type:'tv'};
    const episode=show.last_episode_to_air;
    if(episode?.air_date&&episode.air_date>=since&&episode.air_date<=today&&episode.season_number>0&&!upcomingEpisode(episode,show.next_episode_to_air))episodes.push({...base,...{episode_number:episode.episode_number,season_number:episode.season_number,air_date:episode.air_date,episode_name:episode.name}});
    const season=(show.seasons||[]).filter(s=>s.season_number>0&&s.episode_count>0&&s.air_date&&s.air_date>=since&&s.air_date<=today).sort((a,b)=>b.air_date.localeCompare(a.air_date))[0];
    if(season)seasons.push({...base,season_number:season.season_number,air_date:season.air_date,poster_path:season.poster_path||show.poster_path});
  }
  const newest=list=>list.sort((a,b)=>b.air_date.localeCompare(a.air_date)||b.id-a.id);
  return {episodes:newest(episodes),seasons:newest(seasons)};
}
// A scheduled episode remains upcoming even when its calendar date is today.
function upcomingEpisode(episode,next){return !!next&&(episode.season_number>next.season_number||episode.season_number===next.season_number&&episode.episode_number>=next.episode_number);}
export function createLatestTV(load){
  let cached,expires=0,pending;
  return async()=>{
    if(cached&&Date.now()<expires)return cached;
    if(pending)return pending;
    pending=(async()=>{
      const today=new Date().toISOString().slice(0,10);
      const since=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
      const pages=await Promise.all([1,2].map(page=>load('discover/tv',new URLSearchParams({language:'ar-SA',include_adult:'false',without_genres:'16,10763,10764,10767','air_date.gte':since,'air_date.lte':today,sort_by:'popularity.desc',page:String(page)}))));
      const ids=[...new Set(pages.flatMap(p=>p.results||[]).map(m=>m.id))];
      const shows=[];let cursor=0;
      await Promise.all(Array.from({length:4},async()=>{while(cursor<ids.length){const id=ids[cursor++];try{const show={...await load(`tv/${id}`,new URLSearchParams({language:'ar-SA'}))};
        const seasons=(show.seasons||[]).filter(s=>s.season_number>0&&s.air_date&&s.air_date<=today).sort((a,b)=>b.season_number-a.season_number);
        for(const season of seasons){
          try {const data=await load(`tv/${id}/season/${season.season_number}`,new URLSearchParams({language:'ar-SA'}));
            const aired=(data.episodes||[]).filter(e=>e.episode_number>0&&e.air_date&&e.air_date<=today&&!upcomingEpisode({...e,season_number:season.season_number},show.next_episode_to_air)).sort((a,b)=>b.air_date.localeCompare(a.air_date)||b.episode_number-a.episode_number);
            if(aired.length){const candidate={...aired[0],season_number:season.season_number};const previous=show.last_episode_to_air;if(!previous?.air_date||candidate.air_date>previous.air_date||(candidate.air_date===previous.air_date&&(candidate.season_number>previous.season_number||candidate.season_number===previous.season_number&&candidate.episode_number>previous.episode_number)))show.last_episode_to_air=candidate;break;}
          } catch {break;}
        }
        shows.push(show);}catch{}}}));
      if(!shows.length)throw new Error('تعذّر تحميل آخر الحلقات والمواسم');
      cached=televisionUpdates(shows,today,since);expires=Date.now()+300000;return cached;
    })().finally(()=>{pending=null;});
    return pending;
  };
}
