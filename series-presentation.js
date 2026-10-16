import {cleanStory} from './story-language.js';
import {resolveEnglishMetadata} from './title-language.js';
const allowed=s=>!!s&&!/[^\p{Script=Arabic}\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]/u.test(s);
function poster(images){for(const lang of ['en','ar',null]){const matches=(images||[]).filter(i=>i.iso_639_1===lang).sort((a,b)=>(b.vote_average||0)-(a.vote_average||0));if(matches.length)return matches[0].file_path;}return null;}
export async function presentSeries(data,endpoint,load,translate){
 async function item(m){
  const animated=(m.genre_ids||m.genres?.map(g=>g.id)||[]).includes(16);
  const movie=m.media_type==='movie'||(!m.name&&!!m.title);
  if(!m.id||m.media_type==='person'||(movie&&!animated))return m;
  if(movie){
    let en=await load(`movie/${m.id}`,new URLSearchParams({language:'en-US',append_to_response:'images',include_image_language:'en,ar,null'})).catch(()=>m);
    if((m.original_language||en.original_language)!=='ar')en=await resolveEnglishMetadata(m,en,'movie',load);
    const language=m.original_language||en.original_language;
    const name=language==='ar'?(m.original_title||m.title):(en.title||en.original_title||m.title);
    return {...m,overview:await cleanStory(m,en,translate,{cachedOnly:!/^movie\/\d+$/.test(endpoint)}),english_title:en.title,title:name,original_title:name,original_language:language,display_title:['مشاهدة فيلم أنمي',name,(m.release_date||en.release_date||'').slice(0,4),language==='ar'?'':'مترجم'].filter(Boolean).join(' '),poster_path:poster(en.images?.posters)||m.poster_path||en.poster_path,backdrop_path:poster(en.images?.backdrops)||m.backdrop_path||en.backdrop_path,animation_presentation:true};
  }
  if(!m.name&&!m.original_name)return m;
  let en=await load(`tv/${m.id}`,new URLSearchParams({language:'en-US',append_to_response:'images',include_image_language:'en,ar,null'})).catch(()=>m);
  if((m.original_language||en.original_language)!=='ar')en=await resolveEnglishMetadata(m,en,'tv',load);
  const name=((m.original_language||en.original_language)!=='ar'?[en.name,m.original_name,m.name]:[m.original_name,m.name,en.name]).find(allowed)||'مسلسل';
  return {...m,overview:await cleanStory(m,en,translate,{cachedOnly:!/^tv\/\d+$/.test(endpoint)}),english_title:en.name,name,original_name:name,original_language:m.original_language||en.original_language,series_display_title:`${animated?'مسلسل أنمي':'مسلسل'} ${name} ${(m.first_air_date||en.first_air_date||'').slice(0,4)}${(m.original_language||en.original_language)==='ar'?'':' مترجم'} كامل`,poster_path:poster(en.images?.posters)||m.poster_path||en.poster_path,backdrop_path:poster(en.images?.backdrops)||m.backdrop_path||en.backdrop_path,seasons:m.seasons?.map(s=>({...s,name:`الموسم ${s.season_number}`,poster_path:null})),series_presentation:true};
 }
 if(Array.isArray(data.results)){const results=[];for(let i=0;i<data.results.length;i+=4)results.push(...await Promise.all(data.results.slice(i,i+4).map(item)));return {...data,results};}
 if(/^(tv|movie)\/\d+$/.test(endpoint)){const result=await item(data);if(result.recommendations?.results)result.recommendations=await presentSeries(result.recommendations,'discover/tv',load,translate);return result;}
 return data;
}
