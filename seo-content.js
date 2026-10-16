import {safeLink} from './qfilm-import.js';
export function hasHD(sources=[]){return sources.some(source=>/\b(?:720p|1080p|2160p|4k|hd|full\s*hd)\b/i.test(source.quality||'')&&!/\b(?:hdcam|hdts|cam|ts)\b/i.test(source.quality||'')&&[...(source.playback||[]),...(source.downloads||[])].some(link=>safeLink(link.url)));}
export function qualityLabel(item){
 const sources=(item.externalSources||[]).filter(source=>hasHD([source]));
 const quality=sources.map(s=>s.quality).join(' ');
 const resolution=/\b(?:2160p|4k)\b/i.test(quality)?'2160p':/\b1080p\b/i.test(quality)?'1080p':/\b720p\b/i.test(quality)?'720p':'';
 return sources.length?['HD',resolution].filter(Boolean).join(' '):'';
}
export const hdSuffix=item=>{const label=qualityLabel(item);return label?' '+label:'';};
export const summary=text=>{const value=String(text||'').replace(/\s+/g,' ').trim();return value.length>165?value.slice(0,162).replace(/\s+\S*$/u,'')+'…':value;};
