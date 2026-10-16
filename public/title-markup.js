const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Preserve the title text while isolating a foreign work name in an Arabic heading.
export function workTitleMarkup(title,work){
 const text=String(title??''),name=String(work?.title||work?.name||'');
 if(!name||!/[\p{Script=Latin}]/u.test(name))return escape(text);
 const year=(work.release_date||work.first_air_date||'').slice(0,4);
 const part=year&&text.includes(name+' '+year)?name+' '+year:name;
 const index=text.indexOf(part);
 return index<0?escape(text):escape(text.slice(0,index))+`<bdi dir="ltr">${escape(part)}</bdi>`+escape(text.slice(index+part.length));
}
