import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createMovieTranslator, translationChunks} from '../movie-translation.js';
import {applyMoviePresentation} from '../movie-presentation.js';

test('translation chunks preserve all source words and fit UTF-8 service limit', () => {
  const text = 'A detective follows a mysterious stranger. '.repeat(60);
  const chunks = translationChunks(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => Buffer.byteLength(chunk) <= 480));
  assert.equal(chunks.join(' '), text.trim());
});

test('translation persists, deduplicates simultaneous requests, and invalidates changed source', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cimahub-translations-'));
  const directory = pathToFileURL(folder + '/');
  let calls = 0;
  const fetcher = async () => {calls++; return {ok:true, json:async()=>({responseStatus:200,responseData:{translatedText:'يحقق محقق في قضية غامضة.'}})};};
  try {
    const translate = createMovieTranslator({directory, fetcher});
    const source = {id:1, text:'A detective investigates a mysterious case.'};
    const results = await Promise.all([translate(source),translate(source)]);
    assert.equal(calls,1); assert.equal(results[0],results[1]);
    const restarted = createMovieTranslator({directory, fetcher});
    assert.equal(await restarted({...source,cachedOnly:true}),results[0]);
    assert.equal(calls,1);
    await restarted({...source,text:'A changed story.'}); assert.equal(calls,2);
    const failed = createMovieTranslator({directory,fetcher:async()=>({ok:false})});
    assert.equal(await failed({id:2,text:'An unavailable translation.'}),'');
  } finally { await rm(folder,{recursive:true,force:true}); }
});

test('only missing movie stories request translation; listings use cache and TV/anime stay untouched', async () => {
  const movie={id:1,title:'Movie',overview:'',genre_ids:[18]};
  const calls=[];
  const translate=async input=>{calls.push(input);return 'قصة مترجمة';};
  const load=async()=>({title:'Movie',overview:'English story.'});
  const result=await applyMoviePresentation(movie,'movie/1',load,translate);
  assert.equal(result.overview,'قصة مترجمة'); assert.equal(calls[0].cachedOnly,false);
  await applyMoviePresentation({results:[movie]},'discover/movie',load,translate);
  assert.equal(calls[1].cachedOnly,true);
  await applyMoviePresentation({...movie,overview:'قصة عربية'},'movie/1',load,translate);
  await applyMoviePresentation({...movie,genre_ids:[16]},'movie/1',load,translate);
  await applyMoviePresentation({id:2,name:'TV'},'tv/2',load,translate);
  assert.equal(calls.length,2);
});
