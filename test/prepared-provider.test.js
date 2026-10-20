import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparedProviderResponse,preparedWorkRoute} from '../public-database.js';
test('prepared provider replies survive an unavailable provider and missing replies remain distinguishable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cimahub-provider-'));process.env.PUBLIC_DATABASE_PATH=join(directory,'public.sqlite');
 const db=new DatabaseSync(process.env.PUBLIC_DATABASE_PATH);db.exec('CREATE TABLE prepared_provider_responses(key TEXT PRIMARY KEY,body TEXT NOT NULL)');
 db.prepare('INSERT INTO prepared_provider_responses VALUES(?,?)').run('tv/42/season/1?language=ar-SA',JSON.stringify({season_number:1,episodes:[{episode_number:1,name:'الحلقة الأولى'}]}));
 db.exec("CREATE TABLE prepared_work_routes(slug TEXT,type TEXT,id INTEGER);INSERT INTO prepared_work_routes VALUES('translated-name-2026','tv',42),('ambiguous-2026','tv',43),('ambiguous-2026','movie',44)");db.close();
 assert.equal(preparedProviderResponse('tv/42/season/1?language=ar-SA').episodes[0].name,'الحلقة الأولى');
 assert.equal(preparedProviderResponse('tv/42/season/2?language=ar-SA'),undefined);
 assert.equal(preparedWorkRoute('translated-name-2026').id,42);
 assert.equal(preparedWorkRoute('ambiguous-2026'),undefined);
});
