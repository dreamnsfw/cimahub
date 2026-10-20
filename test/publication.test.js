import test from 'node:test';
import assert from 'node:assert/strict';
import {publishContent} from '../publication.js';
test('content publication triggers only the configured Vercel hook and reports failures',async()=>{
 let calls=0;
 const hook='https://api.vercel.com/v1/integrations/deploy/project/fixture';
 await publishContent({hook,fetcher:async(url,options)=>{calls++;assert.equal(String(url),hook);assert.equal(options.method,'POST');return {ok:true};}});
 assert.equal(calls,1);
 await assert.rejects(publishContent({hook:'https://unrelated.example/',fetcher:()=>{throw Error('Must not call');}}),/Invalid publication hook/);
 await assert.rejects(publishContent({hook,fetcher:async()=>({ok:false})}),/publication failed/);
});
