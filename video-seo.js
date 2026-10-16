import {readFile,readdir,writeFile,mkdir,rename} from './storage.js';
import {safeLink,parseVideoPublication} from './qfilm-import.js';
import {managedSources} from './managed-content.js';
import {bundledMediaDirectory,mediaCacheDirectory,readCachedMedia} from './media-cache.js';
import {createVideoThumbnailCache,videoThumbnailPath,recoverableVideoThumbnail} from './video-thumbnail-cache.js';

// Dates describe the video's publication, never the film's theatrical release.
export function videoMetadata(record,item,page,origin){
 if(!record||record.verified!==true)return null;
 const embed=safeLink(record.embedUrl),sources=(item.externalSources||[]).flatMap(s=>s.playback||[]);
 if(!embed||!sources.some(s=>safeLink(s.url)===embed))return null;
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(record.uploadDate||'')||!Number.isFinite(Date.parse(record.uploadDate))||Date.parse(record.uploadDate)>Date.now())return null;
 if(!/^\/uploads\/(?:thumbs\/(?:w500|w780|w1280|original)|video-thumbs)\/[-a-z0-9]+\.(?:jpg|png|webp)$/i.test(record.thumbnail||''))return null;
 if(!record.description?.trim())return null;
 return {'@type':'VideoObject','@id':page.canonical+'#video',name:record.name||page.title.replace(/ \| سيما هَب$/,''),description:record.description,thumbnailUrl:[new URL(record.thumbnail,origin).href],uploadDate:record.uploadDate,embedUrl:embed,url:page.canonical,...(/^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?$/.test(record.duration||'')?{duration:record.duration}:{}),inLanguage:record.inLanguage||item.original_language};
}
const pending=new Map();
let thumbnailSources,thumbnailSourcesAt=0,loadingThumbnailSources;
async function thumbnailSourceFor(pathname){
 if(thumbnailSources&&Date.now()-thumbnailSourcesAt<60000)return thumbnailSources.get(pathname);
 if(!loadingThumbnailSources)loadingThumbnailSources=(async()=>{
   const records=[];
   try{records.push(...Object.values(JSON.parse(await readFile(new URL('./data/video-metadata.json',import.meta.url),'utf8'))));}catch(error){if(error.code!=='ENOENT')throw error;}
   const directory=new URL('./data/source-video-metadata/',import.meta.url);
   let files=[];try{files=await readdir(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
   for(const filename of files){
     if(!/^(movie|tv)-\d+(?:-\d+-\d+)?\.json$/.test(filename))continue;
     records.push(JSON.parse(await readFile(new URL(filename,directory),'utf8')));
   }
   thumbnailSources=new Map(records.filter(record=>recoverableVideoThumbnail(record)).map(record=>[record.thumbnail,record.sourceThumbnail]));
   thumbnailSourcesAt=Date.now();
 })().finally(()=>loadingThumbnailSources=null);
 await loadingThumbnailSources;return thumbnailSources.get(pathname);
}
export const readVideoThumbnail=createVideoThumbnailCache({sourceFor:thumbnailSourceFor});
async function localThumbnail(record,item){
 const pathname=videoThumbnailPath(record,item);if(!pathname)return null;
 if(!await readVideoThumbnail(pathname,record.sourceThumbnail))return null;
 thumbnailSources?.set(pathname,record.sourceThumbnail);
 return pathname;
}
export async function loadVideoRecord(key,item){
 try{const manual=JSON.parse(await readFile(new URL('./data/video-metadata.json',import.meta.url),'utf8'));if(Object.hasOwn(manual,key))return manual[key];}catch(error){if(error.code!=='ENOENT')console.warn('Video metadata unavailable');}
 if(!item?.externalSources?.some(source=>source.playback?.some(link=>safeLink(link.url))))return null;
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
   const directory=new URL('./data/source-video-metadata/',import.meta.url),file=new URL(key.replaceAll(':','-')+'.json',directory);
   let cached;try{cached=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
   const sources=item.externalSources.filter(source=>/^https:\/\/a\.qfilm\.tv\/download\.php\?vid=[a-z0-9]+$/i.test(source.source||'')&&source.playback?.some(link=>safeLink(link.url)));
   if(cached&&Date.now()-Date.parse(cached.checkedAt)<86400000&&sources.some(source=>source.playback.some(link=>safeLink(link.url)===cached.embedUrl)))return {...cached,description:item.overview||cached.description};
   for(const source of sources){
     let publication=source.video;
     if(!publication){const response=await fetch(source.source.replace('/download.php','/watch.php'),{signal:AbortSignal.timeout(6000)});if(!response.ok)continue;publication=parseVideoPublication(await response.text(),source);}
     if(!publication)continue;
     const thumbnail=await localThumbnail(publication,item);if(!thumbnail)continue;
     const record={...publication,thumbnail,description:item.overview||`مشاهدة ${item.title||item.name} على سيما هَب.`,inLanguage:item.original_language,checkedAt:new Date().toISOString()};
     await mkdir(directory,{recursive:true});await writeFile(new URL(key.replaceAll(':','-')+'.tmp',directory),JSON.stringify(record));await rename(new URL(key.replaceAll(':','-')+'.tmp',directory),file);return record;
   }
   return null;
 })().catch(()=>null).finally(()=>pending.delete(key));
 pending.set(key,task);return task;
}
export async function publishedVideoEntries(works,pages){
 const records=new Map();
 try{const manual=JSON.parse(await readFile(new URL('./data/video-metadata.json',import.meta.url),'utf8'));for(const [key,value] of Object.entries(manual))records.set(key,value);}catch(error){if(error.code!=='ENOENT')throw error;}
 const directory=new URL('./data/source-video-metadata/',import.meta.url);
 try{for(const filename of await readdir(directory)){
   const match=filename.match(/^(movie|tv)-(\d+)(?:-(\d+)-(\d+))?\.json$/);if(!match)continue;
   const key=`${match[1]}:${match[2]}${match[3]?`:${match[3]}:${match[4]}`:''}`;
   if(!records.has(key))records.set(key,JSON.parse(await readFile(new URL(filename,directory),'utf8')));
 }}catch(error){if(error.code!=='ENOENT')throw error;}
 const result=[];
 for(const [key,record] of records){
   const [type,id,season,episode]=key.split(':'),work=works.find(work=>work.type===type&&String(work.id)===id);
   if(!work?.indexable||record.verified!==true||!safeLink(record.embedUrl)||!record.description||!record.thumbnail||!Number.isFinite(Date.parse(record.uploadDate))||Date.parse(record.uploadDate)>Date.now())continue;
   const managed=await managedSources({id:Number(id),media_type:type},null,{season:Number(season)||0,episode:Number(episode)||0});
   if(managed!==null&&!managed.some(source=>source.playback?.some(link=>safeLink(link.url)===record.embedUrl)))continue;
   const path=`/${work.slug}/${season?`season/${season}/episode/${episode}/`:''}`;
   if(pages.some(page=>page.path===path&&!page.indexable))continue;
   if(!/^\/uploads\/(?:thumbs\/(?:w500|w780|w1280|original)|video-thumbs)\/[-a-z0-9]+\.(jpg|png|webp)$/i.test(record.thumbnail))continue;
   const video=record.thumbnail.startsWith('/uploads/video-thumbs/'),kind=video?'video-thumbs':'thumbs';
   if(!(video&&recoverableVideoThumbnail(record))&&!await readCachedMedia(record.thumbnail.slice(('/uploads/'+kind+'/').length),mediaCacheDirectory(kind),bundledMediaDirectory(kind)))continue;
   result.push({path,name:work.title||work.name,record});
 }
 return result;
}
export function videoSitemapXml(origin,entries){
 const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
 return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${entries.map(({path,name,record})=>`<url><loc>${escape(origin+path)}</loc><video:video><video:thumbnail_loc>${escape(origin+record.thumbnail)}</video:thumbnail_loc><video:title>${escape(name)}</video:title><video:description>${escape(record.description)}</video:description><video:player_loc>${escape(record.embedUrl)}</video:player_loc><video:publication_date>${escape(record.uploadDate)}</video:publication_date></video:video></url>`).join('')}</urlset>`;
}
