import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDownload,parsePlayback,matchMovie,safeLink,filterSourceLinks} from '../qfilm-import.js';
import {movieContent} from '../movie-seo.js';
import {hasHD} from '../seo-content.js';
import {videoMetadata} from '../video-seo.js';
test('download parser keeps server links only and decodes query strings',()=>{
  const data=parseDownload(`<title>مشاهدة فيلم Example: One (2025) مترجم HD اون لاين</title><a class="download-btn" href="https://example.org/d?id=1&amp;x=2">Server</a><a href="https://ads.example.org">Ad</a><a class="special-btn" href="javascript:alert(1)">Bad</a>`);
  assert.equal(data.title,'Example: One');assert.equal(data.year,'2025');assert.deepEqual(data.downloads,[{url:'https://example.org/d?id=1&x=2',label:'example.org'}]);
  assert.equal(parseDownload('<title>مشاهدة مسلسل Example 2025</title>').title,undefined);
  assert.equal(parseDownload('<title>فيلم Example 2025</title><div class="CatsDesc">أفلام أنيميشن</div>').excluded,true);
});
test('playback parses JSON without executing source JavaScript',()=>{
  const html='var servers = '+JSON.stringify(['<iframe src="https://example.org/embed/1"></iframe>','<iframe src="javascript:alert(1)"></iframe>'])+';';
  assert.equal(parsePlayback(html).length,1);
  assert.deepEqual(parsePlayback('var servers = [evil()];'),[]);
  assert.deepEqual(parsePlayback('<iframe src="https://ads.example.org"></iframe><div id="Playerholder"><iframe src="https://vk.ru/video_ext.php?oid=1&amp;id=2"></iframe></div>'),[{url:'https://vk.ru/video_ext.php?oid=1&id=2',label:'vk.ru'}]);
  assert.equal(safeLink('http://example.org'),null);
});
test('matching requires unique movie title and year, excludes animation and adult entries',()=>{
  const source={title:'Example: One',year:'2025'};const movie={id:1,title:'Example One',release_date:'2025-01-01',genre_ids:[18]};
  assert.equal(matchMovie(source,[movie])?.id,1);
  assert.equal(matchMovie(source,[movie,{...movie,id:2}]),null);
  assert.equal(matchMovie(source,[{...movie,release_date:'2024-01-01'}]),null);
  assert.equal(matchMovie(source,[{...movie,genre_ids:[16]}]),null);
});
test('imported links render safely and never claim a verified quality',()=>{
  const html=movieContent({id:1,title:'Example',externalSources:[{downloads:[{url:'https://example.org/d/1',label:'<script>bad</script>'},{url:'javascript:alert(1)'}]}]});
  assert.match(html,/سيرفرات التحميل/);assert.match(html,/nofollow noopener noreferrer/);
  assert.doesNotMatch(html,/<script>bad|javascript:|1080p|WEB-DL/);
});
test('TikTok clips are rejected from new and saved full-film sources, quality and video metadata',()=>{
  const tiktok='https://www.tiktok.com/player/v1/7651581043241143572',film='https://host.example/embed/film';
  for(const url of [tiktok,'https://vm.tiktok.com/short/','https://WWW.TIKTOK.COM./player/v1/123'])assert.equal(safeLink(url),null);
  const html='var servers = '+JSON.stringify([`<iframe src="${tiktok}"></iframe>`,`<iframe src="${film}"></iframe>`])+';';
  assert.deepEqual(parsePlayback(html),[{url:film,label:'host.example'}]);
  assert.deepEqual(parsePlayback(`<div id="Playerholder"><iframe src="${tiktok}"></iframe></div>`),[]);
  assert.deepEqual(parseDownload(`<title>فيلم Example 2026</title><a class="download-btn" href="${tiktok}">Download</a>`).downloads,[]);
  const clip={quality:'HD 1080p',playback:[{url:tiktok}],video:{verified:true,embedUrl:tiktok}},clean=filterSourceLinks(clip);
  assert.deepEqual(clean.playback,[]);assert.equal(clean.video,undefined);assert.equal(hasHD([clip]),false);
  assert.equal(filterSourceLinks({...clip,playback:[{url:tiktok},{url:film}]}).playback[0].url,film);
  const item={id:1,title:'The Eyes',externalSources:[clip]};
  assert.doesNotMatch(movieContent(item),/tiktok|film-player|سيرفرات المشاهدة/);
  assert.equal(videoMetadata({verified:true,embedUrl:tiktok},item,{canonical:'https://site.example/eyes/'},'https://site.example'),null);
});
