import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workTitleMarkup} from '../public/title-markup.js';

test('mixed Arabic titles isolate the foreign name and matching release year without changing the text',()=>{
 const title='مشاهدة فيلم X-Men: Days of Future Past 2014 مترجم';
 const html=workTitleMarkup(title,{title:'X-Men: Days of Future Past',release_date:'2014-05-15'});
 assert.equal(html,'مشاهدة فيلم <bdi dir="ltr">X-Men: Days of Future Past 2014</bdi> مترجم');
 assert.equal(html.replace(/<\/?bdi\b[^>]*>/g,''),title);
 assert.equal(workTitleMarkup('مشاهدة فيلم الفيل الأزرق 2014',{title:'الفيل الأزرق',release_date:'2014-07-28'}),'مشاهدة فيلم الفيل الأزرق 2014');
});

test('untrusted work names and surrounding title text are escaped inside and outside the direction wrapper',()=>{
 const name='Bad </bdi><img src=x onerror="evil()"> & O\'Reilly';
 const html=workTitleMarkup('<script>prefix</script> '+name+' suffix',{title:name});
 assert.equal(html,'&lt;script&gt;prefix&lt;/script&gt; <bdi dir="ltr">Bad &lt;/bdi&gt;&lt;img src=x onerror=&quot;evil()&quot;&gt; &amp; O&#39;Reilly</bdi> suffix');
 assert.doesNotMatch(html,/<(?:img|script)\b/);
 assert.equal((html.match(/<bdi\b/g)||[]).length,1);
 assert.equal((html.match(/<\/bdi>/g)||[]).length,1);
 assert.equal(workTitleMarkup('<img src=x>',{title:'Unrelated'}),'&lt;img src=x&gt;');
});
