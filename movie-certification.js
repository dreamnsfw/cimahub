// Keep source ratings intact; the +18 collection is an audience category.
export function movieAudience(item,english={}){
 const releases=english.release_dates?.results||item.release_dates?.results;
 if(!releases&&!Array.isArray(item.certifications))return {};
 const values=releases?releases.flatMap(country=>(country.release_dates||[]).map(release=>({country:country.iso_3166_1,certification:String(release.certification||'').trim()}))):item.certifications;
 const unique=new Map(values.filter(r=>/^[A-Z]{2}$/.test(r.country)&&/^[A-Za-z0-9+ -]{1,16}$/.test(r.certification)).map(r=>[r.country+':'+r.certification,{country:r.country,certification:r.certification}]));
 const certifications=[...unique.values()];
 const preferred=certifications.find(r=>r.country==='US'&&r.certification==='NC-17')||certifications.find(r=>r.country==='US'&&r.certification==='R')||certifications.find(r=>r.country==='GB'&&r.certification==='18')||certifications.find(r=>r.country==='US')||certifications.find(r=>r.country==='GB');
 return {certifications,age_rating:preferred||null,adult_audience:certifications.some(r=>r.country==='US'&&['R','NC-17'].includes(r.certification)||r.country==='GB'&&r.certification==='18')};
}
