import test from 'node:test';
import assert from 'node:assert/strict';
import {homeCarousel,enhanceHomeCarousel} from '../public/home-carousel.js';

const items=Array.from({length:5},(_,i)=>({id:i+1,title:`Movie ${i+1}`,public_path:`/movie-${i+1}/`,backdrop_path:`/movie-${i+1}.jpg`}));

test('the server-rendered banner fetches only its visible background and keeps crawlable work links',()=>{
 const markup=homeCarousel(items),images=[...markup.matchAll(/<img\b[^>]*class="hero-image home-carousel-image"[^>]*>/g)].map(match=>match[0]);
 assert.equal(images.length,5);
 assert.equal(images.filter(image=>/\ssrc=/.test(image)).length,1);
 assert.match(images[0],/src="\/uploads\/thumbs\/w1280\/movie-1.jpg"/);
 assert.match(images[0],/fetchpriority="high" loading="eager"/);
 for(let i=1;i<images.length;i++)assert.match(images[i],new RegExp(`data-src="/uploads/thumbs/w1280/movie-${i+1}.jpg"`));
 for(const item of items)assert.ok(markup.includes(`href="${item.public_path}"`));
 assert.match(markup,/home-carousel-controls[^>]* hidden/);
});

function node(attributes={}){
 const values=new Map(Object.entries(attributes)),listeners=new Map(),classes=new Set();
 return {
  dataset:{},hidden:false,inert:false,isConnected:true,textContent:'',innerHTML:'',
  classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)},
  setAttribute:(name,value)=>values.set(name,value),getAttribute:name=>values.get(name),hasAttribute:name=>values.has(name),
  closest(){return this;},contains(){return false;},
  addEventListener(type,callback,{signal}={}){
   if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback);
   signal?.addEventListener('abort',()=>listeners.get(type).delete(callback),{once:true});
  },
  emit(type,event={}){for(const callback of listeners.get(type)||[])callback(event);}
 };
}

function fixture(t,{reduced=true}={}){
 const oldDocument=globalThis.document,oldMatchMedia=globalThis.matchMedia;
 const element=node(),document=node(),motion=node(),controls=node(),pause=node({'data-carousel-pause':''}),count=node();
 document.hidden=false;motion.matches=reduced;
 const images=items.slice(0,3).map((_,i)=>{
  let ready;const decoded=i===0?Promise.resolve():new Promise(resolve=>{ready=resolve;});
  return {dataset:i?{src:`/uploads/thumbs/w1280/movie-${i+1}.jpg`}:{},src:i?'': '/uploads/thumbs/w1280/movie-1.jpg',decode:()=>decoded,ready:()=>ready?.()};
 });
 const slides=images.map((image,i)=>{const slide=node({'aria-hidden':String(i!==0)});slide.inert=i!==0;slide.classList.toggle('is-active',i===0);slide.querySelector=()=>image;return slide;});
 const dots=slides.map((_,i)=>{const dot=node({'data-carousel-slide':String(i),'aria-pressed':String(i===0)});dot.dataset.carouselSlide=String(i);return dot;});
 const next=node({'data-carousel-next':''}),previous=node({'data-carousel-prev':''});
 element.querySelectorAll=selector=>selector==='.home-carousel-slide'?slides:dots;
 element.querySelector=selector=>selector==='.home-carousel-controls'?controls:selector==='[data-carousel-pause]'?pause:count;
 globalThis.document=document;globalThis.matchMedia=()=>motion;
 t.after(()=>{
  element.isConnected=false;enhanceHomeCarousel({querySelectorAll:()=>[]});
  if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
  if(oldMatchMedia===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=oldMatchMedia;
 });
 enhanceHomeCarousel({querySelectorAll:()=>[element]});
 return {element,images,slides,dots,next,previous,pause,motion,document,controls,count,click:button=>element.emit('click',{target:button})};
}

const flush=async()=>{await Promise.resolve();await Promise.resolve();};

test('navigation downloads just the selected background and retains the current frame until it is ready',async t=>{
 const f=fixture(t);
 assert.equal(f.controls.hidden,false);
 assert.equal(f.images[1].src,'');assert.equal(f.images[2].src,'');
 f.click(f.next);
 assert.equal(f.images[1].src,'/uploads/thumbs/w1280/movie-2.jpg');
 assert.equal(f.images[1].loading,'eager');
 assert.equal(f.images[2].src,'');
 assert.equal(f.slides[0].classList.contains('is-active'),true);
 assert.equal(f.slides[1].inert,true);
 f.images[1].ready();await flush();
 assert.equal(f.slides[0].getAttribute('aria-hidden'),'true');
 assert.equal(f.slides[1].classList.contains('is-active'),true);
 assert.equal(f.slides[1].inert,false);
 assert.equal(f.dots[1].getAttribute('aria-pressed'),'true');
 assert.equal(f.count.textContent,'02 / 03');
 f.click(f.previous);await flush();
 assert.equal(f.slides[0].classList.contains('is-active'),true);
 assert.equal(f.images[2].src,'');
});

test('an older image finishing after a newer selection cannot replace the selected slide',async t=>{
 const f=fixture(t);
 f.click(f.dots[1]);f.click(f.dots[2]);
 f.images[2].ready();await flush();
 assert.equal(f.slides[2].classList.contains('is-active'),true);
 f.images[1].ready();await flush();
 assert.equal(f.slides[2].classList.contains('is-active'),true);
 assert.equal(f.slides[1].classList.contains('is-active'),false);
 assert.equal(f.count.textContent,'03 / 03');
});

test('autoplay defers the next background until the interval and respects pause and visibility',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture(t,{reduced:false});
 t.mock.timers.tick(6999);assert.equal(f.images[1].src,'');
 t.mock.timers.tick(1);assert.ok(f.images[1].src);
 f.images[1].ready();await flush();
 assert.equal(f.slides[1].classList.contains('is-active'),true);
 f.click(f.pause);t.mock.timers.tick(14000);assert.equal(f.images[2].src,'');
 f.click(f.pause);f.document.hidden=true;f.document.emit('visibilitychange');
 t.mock.timers.tick(14000);assert.equal(f.images[2].src,'');
 f.document.hidden=false;f.document.emit('visibilitychange');t.mock.timers.tick(7000);
 assert.ok(f.images[2].src);
});
