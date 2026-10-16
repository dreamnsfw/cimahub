import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createImageCache} from '../image-cache.js';
import {localImage} from '../public/media-images.js';

test('local image URLs reject external URLs, traversal and unsupported sizes',()=>{
 assert.equal(localImage('/abc-123.jpg'),'/uploads/thumbs/w500/abc-123.jpg');
 for(const value of ['/../secret.jpg','https://example.com/a.jpg','/a.svg','/nested/a.jpg'])assert.equal(localImage(value),'');
 assert.equal(localImage('/abc.jpg','unknown'),'');
});
test('images persist, concurrent requests share a download, and a fresh cache reads disk',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cimahub-images-'));
 const directory=pathToFileURL(folder+'/'),bytes=Buffer.from([255,216,255,224,0,0]);let calls=0;
 try{
  const cache=createImageCache({directory,fetchImage:async url=>{calls++;assert.equal(url,'https://image.tmdb.org/t/p/w500/example.jpg');return new Response(bytes,{headers:{'content-type':'image/jpeg'}});}});
  const results=await Promise.all([cache('/uploads/thumbs/w500/example.jpg'),cache('/uploads/thumbs/w500/example.jpg')]);
  assert.equal(calls,1);assert.deepEqual(results[0].body,bytes);assert.deepEqual(results[1].body,bytes);
  assert.deepEqual(await readFile(join(folder,'w500/example.jpg')),bytes);
  const restarted=createImageCache({directory,fetchImage:()=>{throw new Error('Must use disk');}});
  assert.deepEqual((await restarted('/uploads/thumbs/w500/example.jpg')).body,bytes);
  assert.equal(await cache('/uploads/thumbs/w500/../secret.jpg'),null);
 }finally{assert.ok(folder.startsWith(join(tmpdir(),'cimahub-images-')));await rm(folder,{recursive:true,force:true});}
});
test('invalid downloaded content is not saved as an image',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cimahub-images-'));
 try{
  const cache=createImageCache({directory:pathToFileURL(folder+'/'),fetchImage:async()=>new Response('<html>error</html>',{headers:{'content-type':'image/jpeg'}})});
  await assert.rejects(cache('/uploads/thumbs/w500/bad.jpg'),/Invalid image data/);
  await assert.rejects(readFile(join(folder,'w500/bad.jpg')),{code:'ENOENT'});
 }finally{assert.ok(folder.startsWith(join(tmpdir(),'cimahub-images-')));await rm(folder,{recursive:true,force:true});}
});
test('read-only bundled images remain available when the writable cache is empty',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cimahub-images-')),bytes=Buffer.from([255,216,255,224,0,0]);
 try{
  await mkdir(join(folder,'bundle/w500'),{recursive:true});await writeFile(join(folder,'bundle/w500/bundled.jpg'),bytes);
  const cache=createImageCache({directory:pathToFileURL(folder+'/cache/'),bundledDirectory:pathToFileURL(folder+'/bundle/'),fetchImage:()=>{throw new Error('Must use bundled image');}});
  assert.deepEqual((await cache('/uploads/thumbs/w500/bundled.jpg')).body,bytes);
  await assert.rejects(readFile(join(folder,'cache/w500/bundled.jpg')),{code:'ENOENT'});
 }finally{assert.ok(folder.startsWith(join(tmpdir(),'cimahub-images-')));await rm(folder,{recursive:true,force:true});}
});
