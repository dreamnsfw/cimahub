import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listingContent,movieMetadata,movieSections,parseMovieListing} from '../movie-seo.js';
import {movieIdentityTitle} from '../movie-presentation.js';

const listing=path=>parseMovieListing(new URL(path,'https://cimahub.net'));
const december=new Date(2026,11,31,23,59,59);

test('the same imported movie listings and regional metadata roll into the new year without restarting',t=>{
  t.mock.timers.enable({apis:['Date'],now:december});
  const paths=['/movies/','/movies/genre/action/',...Object.keys(movieSections).map(key=>`/movies/${key}/`)];
  const checkYear=year=>{
    for(const path of paths){
      const page=listing(path);
      assert.match(page.title,new RegExp(`\\b${year}\\b`),path+' title');
      assert.match(page.description,new RegExp(`\\b${year}\\b`),path+' description');
      assert.doesNotMatch(page.title,new RegExp(`\\b${year-1}\\b`),path+' stale title');
    }
    for(const section of Object.values(movieSections)){
      assert.equal(typeof section.title,'string');
      assert.equal(typeof section.description,'string');
      assert.match(section.title,new RegExp(`\\b${year}\\b`));
      assert.match(section.description,new RegExp(`\\b${year}\\b`));
    }
  };
  checkYear(2026);
  assert.equal(listing('/movies/year/2028/'),null);
  t.mock.timers.tick(2000);
  checkYear(2027);
  assert.equal(listing('/movies/year/2028/').params.get('primary_release_year'),'2028');
  assert.equal(listing('/movies/year/2029/'),null);
});

test('an explicit listing date controls regional metadata and the permitted year range consistently',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(2040,0,1)});
  for(const path of ['/movies/','/movies/genre/horror/',...Object.keys(movieSections).map(key=>`/movies/${key}/`)]){
    const page=parseMovieListing(new URL(path,'https://cimahub.net'),december);
    assert.match(page.title,/\b2026\b/,path);
    assert.match(page.description,/\b2026\b/,path);
    assert.doesNotMatch(page.title,/2040/,path);
  }
  assert.ok(parseMovieListing(new URL('https://cimahub.net/movies/year/2027/'),december));
  assert.equal(parseMovieListing(new URL('https://cimahub.net/movies/year/2028/'),december),null);
});

test('year filters and related year links refresh while the 2026 archive remains a 2026 archive',t=>{
  t.mock.timers.enable({apis:['Date'],now:december});
  const archiveBefore=listing('/movies/year/2026/');
  const before=listingContent(archiveBefore,{results:[],total_pages:1});
  assert.match(before,/<option value="2026" selected>2026<\/option>/);
  assert.doesNotMatch(before,/href="\/movies\/year\/2027\/"/);
  t.mock.timers.tick(2000);
  const archiveAfter=listing('/movies/year/2026/');
  assert.equal(archiveAfter.title,archiveBefore.title);
  assert.equal(archiveAfter.description,archiveBefore.description);
  assert.equal(archiveAfter.heading,'أفلام سنة 2026');
  assert.equal(archiveAfter.params.get('primary_release_year'),'2026');
  const after=listingContent(archiveAfter,{results:[],total_pages:1});
  assert.match(after,/<option value="2027" >2027<\/option>/);
  assert.match(after,/<option value="2026" selected>2026<\/option>/);
  assert.match(after,/href="\/movies\/year\/2027\/">أفلام 2027<\/a>/);
});

test('movie titles and metadata retain the film release year across the calendar rollover',t=>{
  t.mock.timers.enable({apis:['Date'],now:december});
  const metadata=year=>{
    const movie={id:year,title:'Example',original_language:'en',release_date:`${year}-01-01`,genres:[]};
    return movieMetadata({...movie,display_title:movieIdentityTitle(movie)},'https://cimahub.net');
  };
  for(const year of [2026,2027]){
    assert.match(metadata(year).title,new RegExp(`\\b${year}\\b`));
    assert.match(metadata(year).description,new RegExp(`\\b${year}\\b`));
  }
  const olderTitle=metadata(2026).title;
  t.mock.timers.tick(2000);
  assert.equal(metadata(2026).title,olderTitle);
  assert.match(metadata(2026).description,/\b2026\b/);
  assert.match(metadata(2027).title,/\b2027\b/);
  assert.match(metadata(2027).description,/\b2027\b/);
});
