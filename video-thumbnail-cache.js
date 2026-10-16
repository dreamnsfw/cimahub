import {createHash} from 'node:crypto';
import {bundledMediaDirectory,mediaCacheDirectory,readCachedMedia,writeCachedMedia} from './media-cache.js';

const mime={jpg:'image/jpeg',png:'image/png',webp:'image/webp'};
const trustedSource=/^https:\/\/a\.qfilm\.tv\/uploads\/thumbs\/[a-z0-9_-]+\.(jpg|png|webp)$/i;
export function videoThumbnailPath(record,item){
  const slug=item.public_path?.match(/^\/([a-z0-9-]+)\/$/)?.[1],remote=record.sourceThumbnail;
  if(!slug||!trustedSource.test(remote||''))return null;
  return `/uploads/video-thumbs/${slug}-video-${createHash('sha256').update(remote).digest('hex').slice(0,8)}.${remote.split('.').pop().toLowerCase()}`;
}
export function recoverableVideoThumbnail(record){
  const source=trustedSource.exec(record?.sourceThumbnail||''),thumbnail=record?.thumbnail?.match(/^\/uploads\/video-thumbs\/[-a-z0-9]+\.(jpg|png|webp)$/i);
  return Boolean(source&&thumbnail&&source[1].toLowerCase()===thumbnail[1].toLowerCase());
}
export function createVideoThumbnailCache(options={}){
  const {directory=mediaCacheDirectory('video-thumbs'),bundledDirectory=options.directory?null:bundledMediaDirectory('video-thumbs'),sourceFor=async()=>null,fetchImage=(...args)=>fetch(...args)}=options;
  const pending=new Map();
  return async(pathname,source)=>{
    const match=pathname.match(/^\/uploads\/video-thumbs\/([-a-z0-9]+\.(jpg|png|webp))$/i);
    if(!match)return null;
    const [,filename,extension]=match,type=mime[extension.toLowerCase()];
    const saved=await readCachedMedia(filename,directory,bundledDirectory);
    if(saved)return {body:saved,type};
    if(pending.has(pathname))return pending.get(pathname);
    const work=(async()=>{
      const remote=source??await sourceFor(pathname);
      if(!trustedSource.test(remote||'')||remote.split('.').pop().toLowerCase()!==extension.toLowerCase())return null;
      const response=await fetchImage(remote,{redirect:'error',signal:AbortSignal.timeout(6000)});
      if(!response.ok||response.headers.get('content-type')?.split(';')[0].toLowerCase()!==type||Number(response.headers.get('content-length'))>2097152)return null;
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>2097152)return null;chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      if(!(extension.toLowerCase()==='jpg'?body[0]===0xff&&body[1]===0xd8&&body[2]===0xff:extension.toLowerCase()==='png'?body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP'))return null;
      await writeCachedMedia(filename,body,directory);return {body,type};
    })().finally(()=>pending.delete(pathname));
    pending.set(pathname,work);return work;
  };
}
