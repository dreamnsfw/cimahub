import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanStory,cleanCredits,hasEastAsianText,hasUnsupportedText} from '../story-language.js';

test('known Japanese work names become their English name without rewriting the story',async()=>{
 const story=await cleanStory({overview:'تدور أحداث 妖獣都市 في مدينة غامضة.',original_title:'妖獣都市'},{title:'Wicked City'});
 assert.equal(story,'تدور أحداث Wicked City في مدينة غامضة.');
});
test('unknown Japanese names use a complete translated synopsis instead of deleting words',async()=>{
 const item={id:1,overview:'يقابل البطل 太郎 في المدينة.'},english={overview:'The hero meets Taro in the city.'};
 assert.equal(await cleanStory(item,english,async()=> 'يلتقي البطل تارو في المدينة.'),'يلتقي البطل تارو في المدينة.');
 assert.equal(await cleanStory(item,english,async()=>''),english.overview);
 assert.equal(await cleanStory(item,{},async()=>''),'');
 assert.equal(hasEastAsianText('Wicked City مدينة غامضة'),false);
});

test('Greek and other original scripts use documented credit names while Arabic and Latin stay intact',()=>{
 const credits={cast:[{id:1,name:'Γιάγκος Ραυτόπουλος',character:'Γιαγκόναν'},{id:2,name:'ممثل عربي'},{id:3,name:'Latin Name'},{id:4,name:'Имя'}]};
 const result=cleanCredits(credits,{cast:[{id:1,name:'Yagos Raftopoulos',character:'Yagonan'}]});
 assert.deepEqual(result.cast.map(p=>p.name),['Yagos Raftopoulos','ممثل عربي','Latin Name']);assert.equal(result.cast[0].character,'Yagonan');
 assert.equal(hasUnsupportedText('Γιαγκόναν'),true);assert.equal(hasUnsupportedText('Yagonan قصة الفيلم'),false);
});
