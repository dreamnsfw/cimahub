import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directoryArtwork} from '../directory-art.js';
import {siteNavigationGroups} from '../site-navigation.js';

test('every shared directory destination gets relevant, CSP-safe decorative artwork', () => {
  const groups = siteNavigationGroups(new Date('2026-10-13T12:00:00Z'));
  const paths = new Set(groups.flatMap(group => [...(group.featured || []), ...group.sections.flatMap(section => section.links)]).map(link => link.path));
  assert.equal(paths.size, 127);
  for (const path of paths) {
    const svg = directoryArtwork(path);
    assert.match(svg, /^<svg class="directory-art" viewBox="0 0 160 100" aria-hidden="true" focusable="false" data-art="[a-z-]+">/);
    assert.doesNotMatch(svg, /data-art="catalog"/, path);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|image|a|use)\b|\b(?:style|id|href|on\w+)\s*=|url\(|<filter\b/i, path);
    assert.ok(svg.endsWith('</g></svg>'), path);
  }
});

test('terminal genre slugs, regional categories and root types resolve independently', () => {
  const key = path => directoryArtwork(path).match(/data-art="([a-z-]+)"/)[1];
  assert.equal(key('/movies/genre/biography/'), 'biography');
  assert.equal(key('/anime/movies/genre/horror/'), 'horror');
  assert.equal(key('/series-genre/sci-fi-fantasy/'), 'sci-fi-fantasy');
  assert.equal(key('/anime/series/genre/war-politics/'), 'war-politics');
  assert.equal(key('/series-category/english-series/'), 'foreign');
  assert.equal(key('/movies/asian/'), 'asian');
  assert.equal(key('/anime/movies/'), 'anime-movies');
  assert.equal(key('/anime/series/'), 'anime-series');
  assert.equal(key('/movies/year/1977/'), 'year');
  assert.equal(key('/movies/18-plus/'), 'adult');
  assert.equal(key('/movies/coming-soon/'), 'upcoming');
  assert.equal(key('/movies/genre/mystery?sort=vote_average.desc'), 'mystery');
});

test('unknown or hostile input cannot become SVG markup', () => {
  for (const path of [undefined, {}, '/unrelated/horror/', '/movies/genre/" onload="evil', 'https://other.example/movies/genre/action/', '/movies/genre/__proto__/']) {
    const svg = directoryArtwork(path);
    assert.match(svg, /data-art="catalog"/);
    assert.doesNotMatch(svg, /onload|evil|other\.example|__proto__/);
  }
});
