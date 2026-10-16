import {readFile,writeFile,rename} from 'node:fs/promises';
import {parseDownload,parsePlayback,matchMovie} from '../qfilm-import.js';
const file=new URL('../data/qfilm-import.json',import.meta.url);
let state={entries:{}};
try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!process.env.TMDB_API_KEY)throw new Error('TMDB_API_KEY required');
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'CimaHubImport/1.0'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();}
let writes=Promise.resolve();
function save(){writes=writes.then(async()=>{state.updatedAt=new Date().toISOString();await writeFile(new URL('../data/qfilm-import.tmp',import.meta.url),JSON.stringify(state,null,2));await rename(new URL('../data/qfilm-import.tmp',import.meta.url),file);});return writes;}
const locations=xml=>[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].replaceAll('&amp;','&'));
const explicit=process.argv.find(a=>a.startsWith('--vid='))?.split('=')[1];
if(explicit&&!/^[a-z0-9]+$/i.test(explicit))throw new Error('Invalid video ID');
const ids=new Set(explicit?[explicit]:['ccd661dfd','0ddee0912']);
if(!explicit)for(const location of locations(await get('https://a.qfilm.tv/sitemap-index.xml'))){const u=new URL(location);if(u.hostname!=='a.qfilm.tv'||!/^\/uploads\/sitemap-\d+\.xml$/.test(u.pathname))continue;for(const url of locations(await get(u.href))){const parsed=new URL(url);const id=parsed.searchParams.get('vid');if(parsed.pathname==='/watch.php'&&/^[a-z0-9]+$/i.test(id||''))ids.add(id);}}
if(!explicit){
  let discovery={pages:{}};
  const discoveryFile=new URL('../data/qfilm-discovery.json',import.meta.url);
  try{discovery=JSON.parse(await readFile(discoveryFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const cats=locations(await get('https://a.qfilm.tv/sitemap-category.xml')).map(url=>new URL(url).searchParams.get('cat')).filter(cat=>cat&&cat.endsWith('-movies')&&!['anime-movies','adult-movies'].includes(cat)).map(cat=>cat==='english-movies'?'foreign-movies':cat);
  let pageWrites=Promise.resolve();
  async function page(cat,n){
    const key=cat+':'+n;
    let record=discovery.pages[key];
    if(!record||Date.now()-Date.parse(record.checkedAt)>86400000){
      const h=await get('https://a.qfilm.tv/category.php?'+new URLSearchParams({cat,page:String(n)}));
      const pageNumbers=[...h.matchAll(/href=["']([^"']*page=\d+[^"']*)/g)].map(m=>new URL(m[1].replaceAll('&amp;','&'),'https://a.qfilm.tv/')).filter(u=>u.searchParams.get('cat')===cat).map(u=>Number(u.searchParams.get('page')));
      record={ids:[...new Set([...h.matchAll(/watch.php\?vid=([a-z0-9]+)/g)].map(m=>m[1]))],lastPage:Math.max(1,...pageNumbers),checkedAt:new Date().toISOString()};
      discovery.pages[key]=record;
      pageWrites=pageWrites.then(()=>writeFile(discoveryFile,JSON.stringify(discovery)));await pageWrites;
    }
    record.ids.forEach(id=>ids.add(id));return record;
  }
  const pages=[];
  for(const cat of new Set(cats)){const first=await page(cat,1);for(let n=2;n<=first.lastPage;n++)pages.push([cat,n]);}
  let next=0;
  await Promise.all(Array.from({length:3},async()=>{while(next<pages.length){const [cat,n]=pages[next++];await page(cat,n);if(next%100===0)console.log(JSON.stringify({phase:'discovery',pages:next,totalPages:pages.length,discovered:ids.size}));await new Promise(r=>setTimeout(r,200));}}));
}
if(!explicit)state.currentDiscoveryCount=ids.size;
state.discovered=new Set([...Object.keys(state.entries),...ids]).size;
await save();
let count=0;
let completed=0;
const limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.split('=')[1]||Infinity);
const needsImport=r=>!r||r.status==='error'||(r.parserVersion!==2&&(r.status==='no-links'||(r.status==='matched'&&!r.playback?.length)));
const queue=[...ids].filter(vid=>needsImport(state.entries[vid])).slice(0,limit);
let cursor=0;
await Promise.all(Array.from({length:6},async()=>{
while(cursor<queue.length){
  const vid=queue[cursor++];
  if(!needsImport(state.entries[vid]))continue;
  count++;
  try{
    const record=parseDownload(await get(`https://a.qfilm.tv/download.php?vid=${vid}`));
    record.parserVersion=2;
    record.source=`https://a.qfilm.tv/download.php?vid=${vid}`;record.checkedAt=new Date().toISOString();
    if(!record.title||record.excluded)record.status='excluded';
    else {
      record.playback=parsePlayback(await get(`https://a.qfilm.tv/play.php?vid=${vid}`));
      if(!record.downloads.length&&!record.playback.length)record.status='no-links';
      else {
        const params=new URLSearchParams({api_key:process.env.TMDB_API_KEY,query:record.title,year:record.year,language:'en-US',include_adult:'false'});
        const data=JSON.parse(await get('https://api.themoviedb.org/3/search/movie?'+params));
        const movie=matchMovie(record,data.results||[]);
        record.status=movie?'matched':'review';
        if(movie){record.tmdbId=movie.id;record.movieTitle=movie.title;}
      }
    }
    state.entries[vid]=record;
  }catch(error){state.entries[vid]={status:'error',error:error.message,checkedAt:new Date().toISOString()};}
  completed++;
  if(completed%10===0)await save();
  if(completed%100===0||completed===1)console.log(JSON.stringify({processed:Object.keys(state.entries).length,total:state.discovered,counts:Object.values(state.entries).reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})}));
  await new Promise(r=>setTimeout(r,300));
}
}));
await save();
console.log(JSON.stringify({finished:true,processed:Object.keys(state.entries).length,total:state.discovered,counts:Object.values(state.entries).reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})}));
