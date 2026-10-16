import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mediaCacheDirectory,bundledMediaDirectory} from '../media-cache.js';
import {createVideoThumbnailCache,videoThumbnailPath,recoverableVideoThumbnail} from '../video-thumbnail-cache.js';

const bytes=Buffer.from([255,216,255,224,0,0]),record={sourceThumbnail:'https://a.qfilm.tv/uploads/thumbs/source-1.jpg'},pathname=videoThumbnailPath(record,{public_path:'/example-2025/'});
test('serverless caches use temporary storage while local caches keep public paths',()=>{
 assert.equal(fileURLToPath(mediaCacheDirectory('thumbs',{serverless:true})),join(tmpdir(),'cimahub-media','thumbs')+sep);
 assert.equal(mediaCacheDirectory('thumbs',{serverless:false}).href,bundledMediaDirectory('thumbs').href);
});
test('video images regenerate from saved source metadata on a fresh instance',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cimahub-video-cache-'));let calls=0;
 try{
  const metadataFile=join(folder,'metadata.json');await writeFile(metadataFile,JSON.stringify({...record,thumbnail:pathname}));
  const options={sourceFor:async requested=>{const saved=JSON.parse(await readFile(metadataFile,'utf8'));return saved.thumbnail===requested?saved.sourceThumbnail:null;},fetchImage:async url=>{calls++;assert.equal(url,record.sourceThumbnail);return new Response(bytes,{headers:{'content-type':'image/jpeg'}});}};
  const first=createVideoThumbnailCache({...options,directory:pathToFileURL(folder+'/first/')});
  const results=await Promise.all([first(pathname),first(pathname)]);assert.equal(calls,1);assert.deepEqual(results[0].body,bytes);assert.deepEqual(results[1].body,bytes);
  const second=createVideoThumbnailCache({...options,directory:pathToFileURL(folder+'/second/')});
  assert.deepEqual((await second(pathname)).body,bytes);assert.equal(calls,2);
  assert.deepEqual(await readFile(join(folder,'second',pathname.split('/').pop())),bytes);
 }finally{assert.ok(folder.startsWith(join(tmpdir(),'cimahub-video-cache-')));await rm(folder,{recursive:true,force:true});}
});
test('video image requests use bundled files without consulting the remote source',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cimahub-video-cache-'));
 try{
  await mkdir(join(folder,'bundle'));await writeFile(join(folder,'bundle',pathname.split('/').pop()),bytes);
  const cache=createVideoThumbnailCache({directory:pathToFileURL(folder+'/cache/'),bundledDirectory:pathToFileURL(folder+'/bundle/'),sourceFor:()=>{throw new Error('Bundled file must suffice');}});
  assert.deepEqual((await cache(pathname)).body,bytes);
 }finally{assert.ok(folder.startsWith(join(tmpdir(),'cimahub-video-cache-')));await rm(folder,{recursive:true,force:true});}
});
test('video image recovery rejects external hosts, traversal, mismatched image types and invalid bytes',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cimahub-video-cache-'));let calls=0;
 try{
  const directory=pathToFileURL(folder+'/');
  const cache=createVideoThumbnailCache({directory,sourceFor:()=> 'https://example.test/private.jpg',fetchImage:()=>{calls++;throw new Error('Untrusted host requested');}});
  assert.equal(await cache(pathname),null);assert.equal(await cache('/uploads/video-thumbs/../secret.jpg'),null);assert.equal(calls,0);
  assert.equal(videoThumbnailPath({sourceThumbnail:'https://example.test/source.jpg'},{public_path:'/example-2025/'}),null);
  assert.equal(recoverableVideoThumbnail({...record,thumbnail:pathname}),true);
  assert.equal(recoverableVideoThumbnail({...record,thumbnail:pathname.replace(/\.jpg$/,'.png')}),false);
  for(const response of [new Response(bytes,{headers:{'content-type':'image/png'}}),new Response('<html>error</html>',{headers:{'content-type':'image/jpeg'}})]){
   const invalid=createVideoThumbnailCache({directory,sourceFor:()=>record.sourceThumbnail,fetchImage:async()=>response});
   assert.equal(await invalid(pathname),null);
  }
  await assert.rejects(readFile(join(folder,pathname.split('/').pop())),{code:'ENOENT'});
 }finally{assert.ok(folder.startsWith(join(tmpdir(),'cimahub-video-cache-')));await rm(folder,{recursive:true,force:true});}
});
