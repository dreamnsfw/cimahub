import {escapeHtml as e,movieSections,movieGenres,movieTopicSections,adultMovieCategory,comingSoonMovieCategory} from './movie-seo.js';
import {tvSections,tvGenres,animeTvGenres} from './category-seo.js';

const regionLabels={foreign:'أجنبية',asian:'آسيوية',arabic:'عربية',indian:'هندية',turkish:'تركية'};
const entry=(path,label,options={})=>({path,label,...options});
const section=(title,links,options={})=>({title,links,...options});
let managedTaxonomy=new Map();
export function configureNavigationTaxonomy(items=[]){managedTaxonomy=new Map(items.map(item=>[item.path,item]));}
const managedLinks=items=>items.filter(item=>managedTaxonomy.get(item.path)?.enabled!==false).map(item=>({...item,label:managedTaxonomy.get(item.path)?.label||item.label})).sort((a,b)=>(managedTaxonomy.get(a.path)?.sort_order??0)-(managedTaxonomy.get(b.path)?.sort_order??0));

export function siteNavigationGroups(now=new Date()){
 const year=now.getFullYear();
 const movieTypes=Object.entries(movieGenres).map(([slug,[,label]])=>entry(`/movies/genre/${slug}/`,label,{accessibleLabel:`أفلام ${label}`}));
 const seriesTypes=Object.entries(tvGenres).filter(([slug])=>slug!=='animation');
 const years=Array.from({length:50},(_,index)=>entry(`/movies/year/${year-index}/`,String(year-index),{accessibleLabel:`أفلام ${year-index}`}));
 const groups=[
  {id:'movies-menu',key:'movies',path:'/movies/',label:'أفلام',featured:[
   entry(`/movies/year/${year}/`,`أفلام ${year}`,{className:'nav-year-featured'}),
   entry(comingSoonMovieCategory.path,comingSoonMovieCategory.label),
   entry(adultMovieCategory.path,'أفلام +18')
  ],sections:[
   section('فئات الأفلام',[entry('/movies/','كل الأفلام'),...Object.entries(movieSections).map(([slug])=>entry(`/movies/${slug}/`,`أفلام ${regionLabels[slug]}`)),entry('/anime/movies/','أفلام أنمي')]),
   section('أنواع الأفلام',[...movieTypes,...Object.values(movieTopicSections).map(topic=>entry(topic.path,topic.label,{accessibleLabel:topic.name}))]),
   section('أفلام حسب السنة',years,{years:true})
  ]},
  {id:'series-menu',key:'tv',path:'/series/',label:'مسلسلات',sections:[
   section('فئات المسلسلات',[entry('/series/','كل المسلسلات'),...Object.entries(tvSections).map(([slug,region])=>entry(`/series-category/${slug}/`,`مسلسلات ${regionLabels[region]}`))]),
   section('أنواع المسلسلات',seriesTypes.map(([slug,[,label]])=>entry(`/series-genre/${slug}/`,label,{accessibleLabel:`مسلسلات ${label}`})))
  ]},
  {id:'anime-menu',key:'anime',path:'/anime/movies/',label:'أنمي',sections:[
   section('أفلام أنمي',[entry('/anime/movies/','كل أفلام الأنمي'),...Object.entries(movieGenres).map(([slug,[,label]])=>entry(`/anime/movies/genre/${slug}/`,label,{accessibleLabel:`أفلام أنمي ${label}`}))]),
   section('مسلسلات أنمي',[entry('/anime/series/','كل مسلسلات الأنمي'),...Object.entries(animeTvGenres).map(([slug,[,label]])=>entry(`/anime/series/genre/${slug}/`,label,{accessibleLabel:`مسلسلات أنمي ${label}`}))])
  ]},
  {id:'top-rated-submenu',key:'top',path:'/top/',label:'الأعلى تقييمًا',star:true,sections:[]}
 ];
 return groups.map(group=>({...group,featured:group.featured?managedLinks(group.featured):undefined,sections:group.sections.map(section=>({...section,links:managedLinks(section.links)}))}));
}

function link(item){
 if(managedTaxonomy.get(item.path)?.enabled===false)return '';
 item={...item,label:managedTaxonomy.get(item.path)?.label||item.label};
 const classes=['menu-link',item.className].filter(Boolean).join(' ');
 return `<a class="${e(classes)}" href="${e(item.path)}"${item.accessibleLabel?` aria-label="${e(item.accessibleLabel)}"`:''}><span>${e(item.label)}</span></a>`;
}
const chevron='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
export function renderSiteNavigation(now=new Date()){
 const year=now.getFullYear();
 const groups=siteNavigationGroups(now);
 const links=[
  [entry(`/movies/year/${year}/`,`أفلام ${year}`,{className:'nav-year-featured'}),entry('/movies/foreign/','أفلام أجنبية'),entry(adultMovieCategory.path,'أفلام +18'),entry('/movies/asian/','أفلام آسيوية'),entry('/movies/arabic/','أفلام عربية'),entry('/movies/indian/','أفلام هندية'),entry('/movies/turkish/','أفلام تركية'),...Object.values(movieTopicSections).map(topic=>entry(topic.path,topic.name)),entry(comingSoonMovieCategory.path,comingSoonMovieCategory.label)],
  Object.entries(tvSections).map(([slug,region])=>entry(`/series-category/${slug}/`,`مسلسلات ${regionLabels[region]}`)),
  [entry('/anime/movies/','أفلام أنمي'),entry('/anime/series/','مسلسلات أنمي')],
  [entry('/top/','أفلام'),entry('/top/?type=tv','مسلسلات')]
 ];
 return `<nav id="site-navigation" aria-label="القائمة الرئيسية">${groups.map((group,index)=>`<div class="nav-group"><a href="${group.path}" data-nav="${group.key}">${group.star?'<span class="top-rated-star" aria-hidden="true">★</span>':''}<span>${group.label}</span></a><button type="button" class="nav-expand" aria-label="فئات ${group.label}" aria-expanded="false" aria-controls="${group.id}">${chevron}</button><div class="nav-submenu" id="${group.id}">${links[index].map(link).join('')}</div></div>`).join('')}</nav>`;
}
export function renderSectionsMenu(now=new Date()){
 const groups=siteNavigationGroups(now),seen=new Set(['/']);
 const links=items=>items.filter(item=>{
  if(seen.has(item.path))return false;
  seen.add(item.path);return true;
 }).map(item=>`<a class="sections-link${item.className==='nav-year-featured'?' sections-current-year':''}" href="${e(item.path)}"${item.accessibleLabel?` aria-label="${e(item.accessibleLabel)}"`:''}>${e(item.label)}</a>`).join('');
 const sections=groups.filter(group=>group.sections.length).map(group=>{
  const regular=group.sections.filter(item=>!item.years);
  const content=group.key==='movies'
   ?links([...group.featured.filter(item=>item.className==='nav-year-featured'),...regular[0].links.filter(item=>!item.path.startsWith('/anime/')),...group.featured.filter(item=>item.className!=='nav-year-featured')])+`<h3>${e(regular[1].title)}</h3>`+links(regular[1].links)
   :regular.map((item,index)=>`${group.key==='tv'&&index===0?'':`<h3>${e(item.title)}</h3>`}${links(item.links)}`).join('');
  return `<details class="sections-list sections-group" aria-labelledby="sections-${group.key}"${group.key==='movies'?' data-default-open open':''}><summary id="sections-${group.key}"><span>${e(group.label)}</span>${chevron}</summary><div class="sections-items">${content}</div></details>`;
 }).join('');
 const years=groups[0].sections.find(item=>item.years);
 return `<aside id="sections-menu" class="sections-menu" aria-label="جميع الأقسام" hidden><div class="sections-menu-heading"><button id="mobile-menu-close" type="button" aria-label="إغلاق قائمة الأقسام">×</button></div><a class="sections-link sections-home" href="/">الصفحة الرئيسية</a><a class="sections-link sections-directory" href="/categories/">التصنيفات</a>${sections}<details class="sections-list sections-years"><summary><span>${e(years.title)}</span>${chevron}</summary><div class="sections-year-links">${links(years.links.map(item=>({...item,label:item.accessibleLabel})))}</div></details></aside><button id="mobile-menu-backdrop" class="mobile-menu-backdrop" type="button" aria-label="إغلاق قائمة الأقسام" tabindex="-1" hidden></button>`;
}
export function withSiteNavigation(template,now=new Date()){
 let updated=template.replace(/<nav id="site-navigation"[^>]*>[\s\S]*?<\/nav>/,renderSiteNavigation(now));
 updated=updated.replace(/<aside id="sections-menu"[^>]*>[\s\S]*?<\/aside>/,'').replace(/<button[^>]*id="mobile-menu-backdrop"[^>]*>[\s\S]*?<\/button>/,'');
 updated=updated.replace(/(<button[^>]*id="mobile-menu-toggle"[^>]*)(>)/,(_,attributes,end)=>attributes.replace(/aria-controls="[^"]*"/,'aria-controls="sections-menu"').replace(/aria-label="[^"]*"/,'aria-label="فتح جميع الأقسام"')+end);
 return updated.replace('</header>','</header>'+renderSectionsMenu(now));
}
