import {readFile,mkdir,writeFile,rename} from './storage.js';
const decode=s=>s.replace(/&amp;/g,'&').replace(/&#0*39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const plain=s=>decode(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
export function safeLink(value) {try {const u=new URL(decode(value)),host=u.hostname.replace(/\.$/,'');return u.protocol==='https:'&&!u.username&&!u.password&&host!=='tiktok.com'&&!host.endsWith('.tiktok.com')&&!/IDofTheMovie|REPLACE_WITH/i.test(u.pathname)&&!/^(localhost|127\.|192\.168\.|10\.|\[)/.test(host)?u.href:null;}catch{return null;}}
// Apply the same media-source policy to saved imports and newly fetched links.
export function filterSourceLinks(record){
  const clean={...record,playback:(record.playback||[]).filter(link=>safeLink(link.url)),downloads:(record.downloads||[]).filter(link=>safeLink(link.url))};
  if(clean.video&&!safeLink(clean.video.embedUrl))delete clean.video;
  return clean;
}
export function sourceQuality(html) {
  const description=plain(html.match(/<div\b[^>]*class=["'][^"']*\bMetaDesc\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');
  return [...new Set((description.match(/\b(?:2160p|1080p|720p|480p|4K|WEB-DL|WEBRip|BluRay|Blu-Ray|BRRip|HDRip|HDTS|HDCAM|HDTV|DVDRip|HD)\b/gi)||[]).map(s=>s.toUpperCase().replace(/(\d)P$/,'$1p')))].join(' ');
}
export function parseDownload(html) {
  const title=plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
  const match=title.match(/^(?:مشاهدة\s+)?فيلم\s+(.+?)\s*\(?((?:19|20)\d{2})\)?(?:\s|$)/);
  const category=html.match(/class="CatsDesc"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
  const excluded=/أنيميشن|أنمي|انمي|animation|anime/.test(category);
  const links=[];
  for(const a of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if(!/class=["'][^"']*\b(?:special-btn|download-btn)\b/.test(a[1]))continue;
    const url=safeLink(a[1].match(/href=["']([^"']+)/)?.[1]||'');
    if(url&&!links.some(l=>l.url===url))links.push({url,label:new URL(url).hostname.replace(/^www\./,'')});
  }
  return {title:match?.[1]?.trim(),year:match?.[2],excluded,downloads:links,quality:sourceQuality(html)};
}
export function parsePlayback(html) {
  const raw=html.match(/\bvar\s+servers\s*=\s*(\[[\s\S]*?\]);/)?.[1];
  if(!raw){
    const holder=html.match(/<div\b[^>]*id=["']Playerholder["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'';
    return [...new Set([...holder.matchAll(/<iframe\b[^>]*src=["']([^"']+)/gi)].map(m=>safeLink(m[1])).filter(Boolean))].map(url=>({url,label:new URL(url).hostname}));
  }
  try{return [...new Set(JSON.parse(raw).map(s=>safeLink(s.match(/src=["']([^"']+)/)?.[1]||'')).filter(Boolean))].map(url=>({url,label:new URL(url).hostname}));}catch{return [];}
}
const normalized=s=>(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function matchMovie(record, results) {
  const matches=results.filter(m=>!m.adult&&!m.genre_ids?.includes(16)&&m.release_date?.slice(0,4)===record.year&&[m.title,m.original_title].some(t=>normalized(t)===normalized(record.title)));
  return matches.length===1?matches[0]:null;
}
export function discoverVideoIds(html) {
  const ids=new Set();
  for(const match of html.matchAll(/<a\b[^>]*\bhref=(["'])(.*?)\1/gi)) {
    try {const url=new URL(decode(match[2]),'https://a.qfilm.tv/');
      if(url.origin==='https://a.qfilm.tv'&&url.pathname==='/watch.php'&&/^[a-z0-9]+$/i.test(url.searchParams.get('vid')||''))ids.add(url.searchParams.get('vid'));
    }catch{}
  }
  return [...ids];
}
export function parseVideoPublication(html, record, now=Date.now()) {
  const subject=parseDownload(html);
  if(subject.title!==record.title||subject.year!==record.year||!/itemtype=["']https?:\/\/schema\.org\/VideoObject["']/i.test(html))return null;
  const properties={};
  for(const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const prop=match[0].match(/\bitemprop=(["'])(.*?)\1/i)?.[2];
    const value=match[0].match(/\bcontent=(["'])(.*?)\1/i)?.[2];
    if(prop&&value!==undefined)properties[prop.toLowerCase()]=decode(value);
  }
  const uploadDate=(properties.uploaddate||'').replace(/([+-]\d{2})(\d{2})$/,'$1:$2');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(uploadDate)||!Number.isFinite(Date.parse(uploadDate))||Date.parse(uploadDate)>now)return null;
  const embedUrl=safeLink(properties.contenturl);
  if(!embedUrl||!record.playback?.some(link=>safeLink(link.url)===embedUrl))return null;
  const thumbnail=safeLink(properties.thumbnailurl);
  if(!thumbnail||!/^https:\/\/a\.qfilm\.tv\/uploads\/thumbs\/[a-z0-9_-]+\.(jpg|png|webp)$/i.test(thumbnail))return null;
  return {verified:true,uploadDate,embedUrl,sourceThumbnail:thumbnail,
    ...(/^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?$/.test(properties.duration||'')?{duration:properties.duration}:{}),
    publicationSource:record.source.replace('/download.php','/watch.php'),checkedAt:new Date(now).toISOString()};
}
let sourceIndex=new Map(),sourceIndexExpires=0,sourceIndexLoad;
export async function movieLinks(id) {
  try {
    if(Date.now()>sourceIndexExpires){
      if(!sourceIndexLoad)sourceIndexLoad=(async()=>{
        const data=JSON.parse(await readFile(new URL('./data/qfilm-import.json',import.meta.url),'utf8'));
        try {const fresh=JSON.parse(await readFile(new URL('./data/qfilm-new-import.json',import.meta.url),'utf8'));data.entries={...data.entries,...fresh.entries};}catch(error){if(error.code!=='ENOENT')throw error;}
        const index=new Map();
        for(const record of Object.values(data.entries||{}))if(record.status==='matched'){
          const list=index.get(record.tmdbId)||[];list.push(record);index.set(record.tmdbId,list);
        }
        sourceIndex=index;sourceIndexExpires=Date.now()+3000;
      })().finally(()=>{sourceIndexLoad=undefined;});
      await sourceIndexLoad;
    }
    let automatic=[];
    if(Number.isSafeInteger(Number(id))&&Number(id)>0){try{automatic=JSON.parse(await readFile(new URL(`./data/auto-movie-links/${Number(id)}.json`,import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')console.warn('Automatic movie links unavailable');}}
    const records=[...(sourceIndex.get(Number(id))||[]),...automatic].map(filterSourceLinks).filter(record=>record.playback.length||record.downloads.length);
    return await Promise.all(records.map(enrichQuality));
  }catch{return [];}
}
const qualityRequests=new Map();
async function enrichQuality(record) {
  if(!record.downloads?.length||record.quality!==undefined)return record;
  const source=new URL(record.source);
  if(source.origin!=='https://a.qfilm.tv'||source.pathname!=='/download.php')return record;
  const vid=source.searchParams.get('vid');
  if(!/^[a-z0-9]+$/i.test(vid||''))return record;
  if(qualityRequests.has(vid))return qualityRequests.get(vid);
  const task=(async()=>{
    const directory=new URL('./data/qfilm-quality/',import.meta.url),file=new URL(`${vid}.json`,directory);
    try {const cached=JSON.parse(await readFile(file,'utf8'));if(Date.now()-Date.parse(cached.checkedAt)<86400000)return {...record,quality:cached.quality};}catch{}
    try {
      const response=await fetch(source,{signal:AbortSignal.timeout(8000)});
      if(!response.ok)return record;
      const parsed=parseDownload(await response.text());
      if(parsed.title!==record.title||parsed.year!==record.year)return record;
      const quality=parsed.quality;
      await mkdir(directory,{recursive:true});
      const temporary=new URL(`${vid}.tmp`,directory);
      await writeFile(temporary,JSON.stringify({quality,checkedAt:new Date().toISOString()}));await rename(temporary,file);
      return {...record,quality};
    }catch{return record;}
  })();
  qualityRequests.set(vid,task);
  try{return await task;}finally{qualityRequests.delete(vid);}
}
