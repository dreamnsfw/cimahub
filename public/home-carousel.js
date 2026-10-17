import {localImage} from './media-images.js';
import {mediaLink,mediaType} from './media-links.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg=path=>`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const play=svg('<path d="m9 5 11 7-11 7z"/>');
const pause=svg('<path d="M9 5v14M15 5v14"/>');

export const homeIntroduction=`<header class="page-heading home-introduction"><h1><span class="home-intro-brand">سيما هَب</span><span class="home-intro-separator"> — </span><span class="home-intro-heading">مشاهدة وتحميل أفلام ومسلسلات وأنمي</span></h1><p>مشاهدة وتحميل أحدث الأفلام العربية والأجنبية والمسلسلات وأفلام ومسلسلات الأنمي بجودة عالية HD اون لاين على سيما هَب، مع المواسم والحلقات المترجمة وسيرفرات المشاهدة وروابط التحميل المباشرة.</p></header>`;

export function featuredWorks(items){
 const seen=new Set();
 return items.filter(m=>{
  const key=`${mediaType(m)}-${m.id}`;
  if(m.adult||m.episode_number!=null||m.season_number!=null||!localImage(m.backdrop_path,'w1280')||seen.has(key))return false;
  seen.add(key);return true;
 }).slice(0,5);
}

export function homeCarousel(items){
 const works=featuredWorks(items);
 if(!works.length)return '';
 return `<section class="home-carousel" aria-label="تحت الأضواء" aria-roledescription="عرض شرائح" data-home-carousel>
  <div class="home-carousel-slides">${works.map((m,i)=>{
   const name=m.title||m.name,year=(m.release_date||m.first_air_date||'').slice(0,4);
   const anime=(m.genre_ids||m.genres?.map(g=>g.id)||[]).includes(16),tv=mediaType(m)==='tv';
   const label=anime?(tv?'مسلسل أنمي':'فيلم أنمي'):(tv?'مسلسل':'فيلم');
   return `<div class="home-carousel-slide${i===0?' is-active':''}" role="group" aria-roledescription="شريحة" aria-label="${i+1} من ${works.length}" aria-hidden="${i!==0}"${i!==0?' inert':''}>
    <img class="hero-image home-carousel-image" ${i===0?'src':'data-src'}="${localImage(m.backdrop_path,'w1280')}" alt="" width="1280" height="720" ${i===0?'fetchpriority="high" loading="eager"':'loading="lazy"'}>
    <div class="home-carousel-shade"></div><div class="home-carousel-content">
     <div class="home-carousel-eyebrow"><span></span>تحت الأضواء</div>
     <h2 dir="auto">${escape(name)}</h2>
     <div class="home-carousel-meta"><span>${label}</span>${year?`<span>${escape(year)}</span>`:''}${Number(m.vote_average)>0?`<span class="home-carousel-rating">★ ${Number(m.vote_average).toFixed(1)} <small>TMDB</small></span>`:''}</div>
     <a class="primary home-carousel-watch" href="${escape(mediaLink(m))}">${play} مشاهدة</a>
    </div>
   </div>`;
  }).join('')}</div>
  ${works.length>1?`<div class="home-carousel-controls" role="group" aria-label="التحكم في البانر" hidden>
   <div class="home-carousel-arrows"><button type="button" data-carousel-prev aria-label="العمل السابق">${svg('<path d="m9 6 6 6-6 6"/>')}</button><button type="button" data-carousel-next aria-label="العمل التالي">${svg('<path d="m15 6-6 6 6 6"/>')}</button></div>
   <div class="home-carousel-thumbnails" role="group" aria-label="اختيار العمل">${works.map((m,i)=>`<button type="button" data-carousel-slide="${i}" aria-label="عرض ${escape(m.title||m.name)}" aria-pressed="${i===0}"><img src="${localImage(m.backdrop_path,'w300')}" alt="" width="80" height="45" loading="lazy"></button>`).join('')}</div>
   <span class="home-carousel-count" dir="ltr">01 / ${String(works.length).padStart(2,'0')}</span>
   <button class="home-carousel-pause" type="button" data-carousel-pause aria-label="إيقاف الحركة التلقائية" aria-pressed="false">${pause}</button>
  </div>`:''}
 </section>`;
}

const controllers=new Map();
export function enhanceHomeCarousel(root=document){
 for(const [element,dispose] of controllers)if(!element.isConnected){dispose();controllers.delete(element);}
 for(const element of root.querySelectorAll('[data-home-carousel]')){
  if(controllers.has(element))continue;
  const slides=[...element.querySelectorAll('.home-carousel-slide')],controls=element.querySelector('.home-carousel-controls');
  if(slides.length<2||!controls)continue;
  const dots=[...element.querySelectorAll('[data-carousel-slide]')],pauseButton=element.querySelector('[data-carousel-pause]');
  const abort=new AbortController(),signal=abort.signal,reduced=matchMedia('(prefers-reduced-motion: reduce)'),blocked=new Set();
  let index=0,timer,touchStart,request=0,loading=false;
  if(reduced.matches)blocked.add('motion');
  if(document.hidden)blocked.add('hidden');
  controls.hidden=false;
  const schedule=()=>{
   clearTimeout(timer);element.classList.remove('is-running');
   if(blocked.size||loading||!element.isConnected)return;
   element.classList.add('is-running');
   timer=setTimeout(()=>show(index+1),7000);
  };
  const show=async next=>{
   index=(next+slides.length)%slides.length;
   const current=++request,image=slides[index].querySelector('.home-carousel-image');
   loading=true;schedule();
   // Hidden slides overlap the viewport, so native lazy loading alone fetches them all.
   if(image?.dataset.src){image.loading='eager';image.src=image.dataset.src;delete image.dataset.src;}
   // Keep the current frame visible while the selected background is downloading.
   try{await image?.decode?.();}catch{}
   if(current!==request||!element.isConnected)return;
   loading=false;
   slides.forEach((slide,i)=>{slide.classList.toggle('is-active',i===index);slide.setAttribute('aria-hidden',String(i!==index));slide.inert=i!==index;dots[i].setAttribute('aria-pressed',String(i===index));});
   element.querySelector('.home-carousel-count').textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
   schedule();
  };
  const block=(reason,value)=>{value?blocked.add(reason):blocked.delete(reason);schedule();};
  element.addEventListener('click',event=>{
   const button=event.target.closest('button');if(!button)return;
   if(button.hasAttribute('data-carousel-next'))show(index+1);
   if(button.hasAttribute('data-carousel-prev'))show(index-1);
   if(button.hasAttribute('data-carousel-slide'))show(Number(button.dataset.carouselSlide));
   if(button===pauseButton){
    const paused=!blocked.has('user');block('user',paused);
    button.setAttribute('aria-pressed',String(paused));button.setAttribute('aria-label',paused?'تشغيل الحركة التلقائية':'إيقاف الحركة التلقائية');button.innerHTML=paused?play:pause;
   }
  },{signal});
  element.addEventListener('mouseenter',()=>block('hover',true),{signal});
  element.addEventListener('mouseleave',()=>block('hover',false),{signal});
  element.addEventListener('focusin',()=>block('focus',true),{signal});
  element.addEventListener('focusout',event=>{if(!element.contains(event.relatedTarget))block('focus',false);},{signal});
  element.addEventListener('keydown',event=>{
   if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
   event.preventDefault();show(index+(event.key==='ArrowLeft'?1:-1));
  },{signal});
  element.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'&&!event.target.closest('button,a'))touchStart={x:event.clientX,y:event.clientY};},{signal});
  element.addEventListener('pointerup',event=>{
   if(!touchStart)return;
   const dx=event.clientX-touchStart.x,dy=event.clientY-touchStart.y;touchStart=null;
   if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)show(index+(dx>0?1:-1));
  },{signal});
  element.addEventListener('pointercancel',()=>{touchStart=null;},{signal});
  document.addEventListener('visibilitychange',()=>block('hidden',document.hidden),{signal});
  reduced.addEventListener('change',()=>block('motion',reduced.matches),{signal});
  controllers.set(element,()=>{clearTimeout(timer);abort.abort();});
  schedule();
 }
}
