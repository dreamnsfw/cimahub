export function localImage(path,size='w500') {
  if(!['w185','w300','w500','w780','w1280','original'].includes(size))return '';
  return /^\/[\p{L}\p{N}_-]+\.(?:jpg|png|webp)$/u.test(path||'')?`/uploads/thumbs/${size}/${encodeURIComponent(path.slice(1))}`:'';
}

export function posterPlaceholder(name='',year=''){
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<span class="poster-placeholder media-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/></svg><strong dir="auto">${escape(name)}</strong>${year?`<small>${escape(year)}</small>`:''}</span>`;
}

// Keep the source fallback; browsers select a compressed size for their viewport.
export function responsiveImages(html){
 return html.replace(/<img\b[^>]*>/g,tag=>{
  if(/\bsrcset=/.test(tag)||!/\ssrc="\/uploads\/thumbs\//.test(tag))return tag;
  const source=tag.match(/\ssrc="\/uploads\/thumbs\/(w185|w300|w500|w780|w1280)\/([^"<>]+)"/);if(!source)return tag;
  const hero=/\bhero-image\b/.test(tag),thumb=/width="80"/.test(tag),cover=/\bmovie-cover\b|\bdetail-poster\b/.test(tag);
  const widths=hero?[300,780,1280]:thumb?[185]:[185,300,360,500];
  const sizes=hero?'(max-width: 600px) 100vw, 90vw':thumb?'80px':cover?'(max-width: 600px) 44vw, 220px':'(max-width: 600px) 44vw, (max-width: 1000px) 22vw, 16vw';
  return tag.replace(/\ssrc="[^"]+"/,` src="/uploads/optimized/${source[1]}/${source[2]}" srcset="${widths.map(w=>`/uploads/optimized/w${w}/${source[2]} ${w}w`).join(', ')}" sizes="${sizes}"`);
 });
}
