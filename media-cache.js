import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export function bundledMediaDirectory(kind){return new URL(`./public/uploads/${kind}/`,import.meta.url);}
export function mediaCacheDirectory(kind,{serverless=Boolean(process.env.VERCEL),temporaryDirectory=tmpdir()}={}){
  return serverless?pathToFileURL(join(temporaryDirectory,'cimahub-media',kind)+sep):bundledMediaDirectory(kind);
}
export async function readCachedMedia(name,directory,bundledDirectory){
  for(const base of [directory,bundledDirectory]){
    if(!base)continue;
    try{return await readFile(new URL(name,base));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return null;
}
export async function writeCachedMedia(name,body,directory){
  const file=new URL(name,directory),temporary=new URL(`${name}.${randomUUID()}.tmp`,directory);
  try{
    await mkdir(new URL('.',file),{recursive:true});
    await writeFile(temporary,body);await rename(temporary,file);
  }catch(error){
    // A disposable cache must not prevent serving an already validated image.
    if(!['ENOSPC','EDQUOT','EROFS','EACCES','EPERM'].includes(error.code))throw error;
  }finally{await unlink(temporary).catch(()=>{});}
}
