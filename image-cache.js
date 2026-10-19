import {localImage} from './public/media-images.js';
import {bundledMediaDirectory,mediaCacheDirectory,readCachedMedia,writeCachedMedia} from './media-cache.js';

const mime={jpg:'image/jpeg',png:'image/png',webp:'image/webp'};
const limit=12*1024*1024;
function validImage(bytes,extension){
  if(extension==='jpg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(extension==='png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
}
export function createImageCache(options={}){
  const {directory=mediaCacheDirectory('thumbs'),bundledDirectory=options.directory?null:bundledMediaDirectory('thumbs'),fetchImage=(...args)=>fetch(...args),sourceFor=async name=>'/'+name}=options;
  const pending=new Map(),waiting=[];let active=0;
  async function acquire(){if(active>=4)await new Promise(resolve=>waiting.push(resolve));else active++;}
  function release(){const next=waiting.shift();if(next)next();else active--;}
  return async pathname=>{
    try{pathname=decodeURIComponent(pathname);}catch{return null;}
    const match=pathname.match(/^\/uploads\/thumbs\/(w185|w300|w500|w780|w1280|original)\/([\p{L}\p{N}_-]{1,240}\.(jpg|png|webp))$/u);
    if(!match)return null;
    const [,size,name,extension]=match;
    if(!localImage('/'+name,size))return null;
    const saved=await readCachedMedia(`${size}/${name}`,directory,bundledDirectory);
    if(saved){const format=Object.keys(mime).find(ext=>validImage(saved,ext));if(format)return {body:saved,type:mime[format]};}
    if(pending.has(pathname))return pending.get(pathname);
    const work=(async()=>{
      await acquire();
      try{
        const source=await sourceFor(name);
        if(!/^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(source||''))throw Object.assign(new Error('الصورة غير موجودة'),{status:404});
        for(let attempt=0;attempt<2;attempt++)try{
        const response=await fetchImage(`https://image.tmdb.org/t/p/${size}${source}`,{signal:AbortSignal.timeout(20000),redirect:'error'});
        if(!response.ok)throw Object.assign(new Error('الصورة غير متاحة'),{status:response.status===404?404:502});
        const contentType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        const actual=Object.keys(mime).find(ext=>mime[ext]===contentType||(ext==='jpg'&&contentType==='image/jpg'));
        if(!actual||Number(response.headers.get('content-length'))>limit)throw Object.assign(new Error('Invalid image response'),{code:'IMAGE_RESPONSE_'+String(contentType).replace(/[^a-z]/g,'_')});
        const chunks=[];let length=0;
        for await(const chunk of response.body){length+=chunk.length;if(length>limit)throw new Error('Image too large');chunks.push(chunk);}
        const body=Buffer.concat(chunks);
        if(!validImage(body,actual))throw new Error('Invalid image data');
        await writeCachedMedia(`${size}/${name}`,body,directory);
        return {body,type:mime[actual]};
        }catch(error){if(error.status===404||attempt===1)throw error;}
      }finally{release();}
    })().finally(()=>pending.delete(pathname));
    pending.set(pathname,work);return work;
  };
}
