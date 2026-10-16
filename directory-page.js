import {escapeHtml as e} from './movie-seo.js';
import {siteNavigationGroups} from './site-navigation.js';
import {directoryArtwork} from './directory-art.js';

export const categoriesPath='/categories/';
const groupNames={movies:'الأفلام',tv:'المسلسلات',anime:'الأنمي'};
const groupIds={movies:'movies',tv:'series',anime:'anime'};
const chevron='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function categoriesPage(origin,now=new Date()){
 const groups=siteNavigationGroups(now).filter(group=>group.sections.length);
 const destinations=[],seen=new Set();
 const links=items=>items.filter(item=>{
  if(seen.has(item.path))return false;
  seen.add(item.path);destinations.push(item);return true;
 }).map(item=>`<li><a class="directory-child${item.className==='nav-year-featured'?' directory-current-year':''}" href="${e(item.path)}"${item.accessibleLabel?` aria-label="${e(item.accessibleLabel)}"`:''}>${directoryArtwork(item.path)}<span class="directory-link-label">${e(item.label)}</span></a></li>`).join('');
 const sections=groups.map(group=>{
  const id='directory-'+groupIds[group.key];
  const featured=group.featured?`<ul class="directory-links directory-featured">${links(group.featured)}</ul>`:'';
  const content=group.sections.map(section=>{
   const items=section.years?section.links.map(item=>({...item,label:item.accessibleLabel})):section.links.filter(item=>group.key!=='movies'||!item.path.startsWith('/anime/'));
   const entries=links(items);
   if(section.years)return `<details class="directory-years"><summary><span>${e(section.title)}</span>${chevron}</summary><ul class="directory-links directory-year-links">${entries}</ul></details>`;
   return `<section class="directory-section"><h3>${e(section.title)}</h3><ul class="directory-links">${entries}</ul></section>`;
  }).join('');
  return `<section class="directory-group" id="${id}" aria-labelledby="${id}-title"><header class="directory-group-heading"><h2 id="${id}-title">${groupNames[group.key]}</h2></header>${featured}${content}</section>`;
 }).join('');
 const canonical=origin+categoriesPath,title='التصنيفات — أقسام الأفلام والمسلسلات والأنمي | سيما هَب';
 const description='دليل تصنيفات سيما هَب للأفلام والمسلسلات والأنمي: أقسام عربية وأجنبية وآسيوية وهندية وتركية، وأنواع الأكشن والرعب والكوميديا والدراما، مع تصنيف الأفلام حسب السنة.';
 const intro='دليل تصنيفات الأفلام والمسلسلات والأنمي على سيما هَب. تصفح أفلام الأكشن والرعب والكوميديا والدراما والرومانسية والخيال العلمي، وأقسام الأفلام الأجنبية والعربية والآسيوية والهندية والتركية. ستجد أيضًا تصنيفات أفلام الأنمي ومسلسلات الأنمي، وأفلام +18 والسيرة الذاتية، مع أرشيف الأفلام حسب سنة الإصدار.';
 const content=`<div class="content category-directory"><nav class="movie-breadcrumb" aria-label="مسار الصفحة"><a href="/">الرئيسية</a> / <span aria-current="page">التصنيفات</span></nav><header class="page-heading"><h1>التصنيفات</h1><p>${intro}</p></header><nav class="directory-jumps" aria-label="أقسام التصنيفات">${groups.map(group=>`<a href="#directory-${groupIds[group.key]}">${groupNames[group.key]}</a>`).join('')}</nav>${sections}</div>`;
 return {items:[],content,metadata:{title,description,canonical,noindex:false,schema:{'@context':'https://schema.org','@graph':[
  {'@type':'CollectionPage','@id':canonical+'#directory',name:'التصنيفات',description,url:canonical,inLanguage:'ar',mainEntity:{'@type':'ItemList',numberOfItems:destinations.length,itemListElement:destinations.map((item,index)=>({'@type':'ListItem',position:index+1,name:item.accessibleLabel||item.label,url:origin+item.path}))}},
  {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'الرئيسية',item:origin+'/'},{'@type':'ListItem',position:2,name:'التصنيفات',item:canonical}]}
 ]}}};
}
