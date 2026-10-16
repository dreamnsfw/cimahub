import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isCurrentNavigationLink} from '../public/navigation.js';

test('top-rated film and series destinations are mutually exclusive', () => {
  const films = 'https://cimahub.net/top/', series = films + '?type=tv';
  assert.equal(isCurrentNavigationLink('/top/', films), true);
  assert.equal(isCurrentNavigationLink('/top/?type=tv', films), false);
  assert.equal(isCurrentNavigationLink('/top/', series), false);
  assert.equal(isCurrentNavigationLink('/top/?type=tv', series), true);
});

test('navigation matches equivalent queries without losing filters or pagination', () => {
  assert.equal(isCurrentNavigationLink('/movies/?genre=18&year=2026', 'https://cimahub.net/movies/?year=2026&genre=18'), true);
  assert.equal(isCurrentNavigationLink('/movies/', 'https://cimahub.net/movies/?page=2'), false);
  assert.equal(isCurrentNavigationLink('/top/?type=tv', 'https://cimahub.net/top/?type=movie'), false);
});

test('current navigation cannot match another origin, another section, or an invalid URL', () => {
  assert.equal(isCurrentNavigationLink('https://other.example/series/', 'https://cimahub.net/series/'), false);
  assert.equal(isCurrentNavigationLink('/anime/movies/', 'https://cimahub.net/anime/series/'), false);
  assert.equal(isCurrentNavigationLink('/movies/', 'invalid URL'), false);
});
