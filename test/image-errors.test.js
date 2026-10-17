import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
// Run the real image fallback registration and startup scan without booting the app.
const start=app.indexOf('function handleImageError(event){'),end=app.indexOf('\nif (main.dataset.serverRendered)',start);
assert.ok(start>=0&&end>start);
const imageFallback=app.slice(start,end);

function scanImages(definitions){
 const images=definitions.map(({src,deferred,loaded=false})=>({
  tagName:'IMG',complete:true,naturalWidth:loaded?1280:0,
  dataset:deferred?{src:deferred}:{},
  getAttribute:name=>name==='src'?src:null,
  classList:{contains:name=>name==='hero-image'},
  remove(){images.splice(images.indexOf(this),1);}
 }));
 const handlers={};
 runInNewContext(imageFallback,{document:{images,addEventListener:(type,handler)=>{handlers[type]=handler;}}});
 return {images,handlers};
}

test('image fallback startup preserves every intentionally deferred carousel background',()=>{
 const {images,handlers}=scanImages([{src:'/first.jpg',loaded:true},...Array.from({length:4},(_,i)=>({deferred:`/later-${i}.jpg`}))]);
 assert.equal(images.length,5,'sourceless images are complete with zero width before any request starts');
 handlers.error({target:images[1]});
 assert.equal(images.length,5,'an unrequested deferred image must remain available for carousel activation');
});

test('image fallback still removes a genuinely failed requested hero at startup and on error',()=>{
 const failed=scanImages([{src:'/broken.jpg'}]);
 assert.equal(failed.images.length,0);
 const loaded=scanImages([{src:'/initially-loaded.jpg',loaded:true}]);
 loaded.handlers.error({target:loaded.images[0]});
 assert.equal(loaded.images.length,0);
});
