import test from 'node:test';
import assert from 'node:assert/strict';
import {matchByStory,extractStory} from '../movie-story-match.js';
const story='جندي سابق شحنة طبية خطيرة عصابة اجرامية طفلة بريئة مطاردات عنيفة';
test('story resolves competing names only with strong distinctive evidence',async()=>{
 const candidates=[{id:1},{id:2}];
 const load=async path=>({overview:path==='movie/1'?story:'عداء رياضي بطولة عالمية مدرب منافسة سباق ميدالية'});
 assert.equal((await matchByStory(story,candidates,load)).id,1);
 assert.equal(await matchByStory(story,candidates,async()=>({overview:story})),null);
});
test('missing competing story does not count as negative evidence',async()=>{
 const load=async path=>({overview:path==='movie/1'?story:''});
 assert.equal(await matchByStory(story,[{id:1},{id:2}],load),null);
});
test('missing Arabic story does not request translation or English fallback',async()=>{
 const languages=[];
 const load=async(path,params)=>{languages.push(params.get('language'));return {overview:''};};
 assert.equal(await matchByStory(story,[{id:1}],load),null);
 assert.deepEqual(languages,['ar-SA']);
 assert.equal(extractStory('<div class="foo StoryBoxText bar"><p>قصة</p></div>').trim(),'قصة');
});
