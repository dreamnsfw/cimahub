import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';
import{createOptimizedImageCache}from'../optimized-image.js';import{responsiveImages}from'../public/media-images.js';
test('responsive markup selects optimized viewport-sized images without activating hidden slides',()=>{
 const html=responsiveImages('<img src="/uploads/thumbs/w500/a.jpg" width="300" height="450"><img class="hero-image" src="/uploads/thumbs/w1280/b.jpg"><img data-src="/uploads/thumbs/w1280/c.jpg">');
 assert.match(html,/srcset="[^\"]+w185\/a.jpg 185w/);assert.match(html,/sizes="\(max-width: 600px\) 44vw/);assert.match(html,/w780\/b.jpg 780w/);assert.match(html,/data-src="\/uploads\/thumbs\/w1280\/c.jpg"/);
 assert.equal(responsiveImages(html),html);
});
test('optimized media is real WebP, keeps its aspect ratio and survives a new server instance',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'cimahub-optimized-'));try{
 const input=await sharp({create:{width:500,height:750,channels:3,background:'#a83f55'}}).jpeg().toBuffer();let calls=0;const directory=pathToFileURL(folder+'/');const load=async()=>{calls++;return {body:input};};
 const cache=createOptimizedImageCache({load,directory}),[a,b]=await Promise.all([cache('/uploads/optimized/w185/a.jpg'),cache('/uploads/optimized/w185/a.jpg')]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.type,'image/webp');const meta=await sharp(a.body).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,185);assert.ok(Math.abs(meta.height/185-1.5)<.01);
 const fresh=createOptimizedImageCache({directory,load:()=>{throw Error('Unexpected download');}});assert.deepEqual(await fresh('/uploads/optimized/w185/a.jpg'),a);
 assert.equal(await cache('/uploads/optimized/w999/a.jpg'),null);assert.equal(await cache('/uploads/optimized/w185/../secret.jpg'),null);
 }finally{await rm(folder,{recursive:true,force:true});}
});
