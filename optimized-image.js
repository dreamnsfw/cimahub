import sharp from 'sharp';
import {mediaCacheDirectory,readCachedMedia,writeCachedMedia} from './media-cache.js';

export function createOptimizedImageCache({load,directory=mediaCacheDirectory('optimized')}={}){
 const pending=new Map();
 return async pathname=>{
  const match=pathname.match(/^\/uploads\/optimized\/(w185|w300|w360|w500|w780|w1280)\/([\p{L}\p{N}_%-]{1,720}\.(?:jpg|png|webp))$/u);
  if(!match)return null;
  const [,size,name]=match,key=`v1/${size}/${name}.webp`;
  const saved=await readCachedMedia(key,directory);if(saved)return {body:saved,type:'image/webp'};
  if(pending.has(key))return pending.get(key);
  const work=(async()=>{
   const original=await load(`/uploads/thumbs/${size==='w360'?'w500':size}/${name}`);if(!original)return null;
   const body=await sharp(original.body,{limitInputPixels:40_000_000}).rotate().resize({width:Number(size.slice(1)),withoutEnlargement:true}).webp({quality:72,effort:3}).toBuffer();
   await writeCachedMedia(key,body,directory);return {body,type:'image/webp'};
  })().finally(()=>pending.delete(key));pending.set(key,work);return work;
 };
}
