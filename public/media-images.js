export function localImage(path,size='w500') {
  if(!['w185','w300','w500','w780','w1280','original'].includes(size))return '';
  return /^\/[\p{L}\p{N}_-]+\.(?:jpg|png|webp)$/u.test(path||'')?`/uploads/thumbs/${size}/${encodeURIComponent(path.slice(1))}`:'';
}

export function posterPlaceholder(name='',year=''){
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<span class="poster-placeholder media-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/></svg><strong dir="auto">${escape(name)}</strong>${year?`<small>${escape(year)}</small>`:''}</span>`;
}
