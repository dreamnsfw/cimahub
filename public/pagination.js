export const MAX_LISTING_PAGES=100;
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const arrow=direction=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${direction==='right'?'m8 7 5 5-5 5m6-10 5 5-5 5':'m16 7-5 5 5 5m-6-10-5 5 5 5'}"/></svg>`;
export function pagination(current,total,link){
 total=Math.max(1,Math.min(MAX_LISTING_PAGES,Math.floor(Number(total)||1)));current=Math.max(1,Math.min(total,Math.floor(Number(current)||1)));
 if(total<=1)return '';
 const pages=new Set([1,2,total-1,total]);for(let p=current-2;p<=current+2;p++)pages.add(p);if(current<=3)for(let p=1;p<=5;p++)pages.add(p);
 let previous=0;const numbers=[...pages].filter(p=>p>0&&p<=total).sort((a,b)=>a-b).map(p=>{const gap=previous&&p-previous>1?'<span class="pagination-gap">…</span>':'';previous=p;return gap+(p===current?`<span class="pagination-current" aria-current="page">${p}</span>`:`<a href="${escape(link(p))}" aria-label="الصفحة ${p}">${p}</a>`);}).join('');
 return `<nav class="numbered-pagination" aria-label="ترقيم الصفحات">${current>1?`<a class="pagination-arrow" href="${escape(link(current-1))}" aria-label="الصفحة السابقة" rel="prev">${arrow('right')}</a>`:`<span class="pagination-arrow" aria-disabled="true" aria-label="الصفحة السابقة">${arrow('right')}</span>`}${numbers}${current<total?`<a class="pagination-arrow" href="${escape(link(current+1))}" aria-label="الصفحة التالية" rel="next">${arrow('left')}</a>`:`<span class="pagination-arrow" aria-disabled="true" aria-label="الصفحة التالية">${arrow('left')}</span>`}</nav>`;
}
