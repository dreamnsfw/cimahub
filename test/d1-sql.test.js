import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {d1Statement,d1Rows} from '../d1-sql.js';
const schema=readFileSync(new URL('../db/d1-schema.sql',import.meta.url),'utf8');
function fixture(){const db=new DatabaseSync(':memory:');db.exec(schema);return db;}
function query(db,sql,params=[]){const s=d1Statement(sql,params);return d1Rows({results:db.prepare(s.sql).all(...s.params)});}

test('D1 preserves JSON nulls, arrays, nested objects and manual title during provider updates',()=>{
 const db=fixture();
 db.prepare('INSERT INTO content_items(key,kind,provider_id,name,slug,overrides,snapshot) VALUES(?,?,?,?,?,?,?)').run('movie:1','movie',1,'Manual','manual','{"title":"Manual"}','{"keep":1,"nested":{"old":1},"nullable":"old"}');
 const sql=`INSERT INTO content_items SELECT * FROM jsonb_to_recordset($1::jsonb)`;
 const [row]=query(db,sql,[JSON.stringify([{key:'movie:1',kind:'movie',provider_id:1,name:'Provider',year:'2026',slug:'provider',snapshot:{nested:{fresh:true},nullable:null,arr:[1,'عربي'],flag:false}}])]);
 assert.equal(row.name,'Manual');assert.equal(row.slug,'manual');
 assert.deepEqual(row.snapshot,{keep:1,nested:{fresh:true},nullable:null,arr:[1,'عربي'],flag:false});
 db.close();
});
test('D1 binds repeated parameters and ANY arrays without interpolating values',()=>{
 const db=fixture();db.prepare('INSERT INTO content_items(key,kind,name) VALUES(?,?,?)').run('movie:1','movie',"O'Brien");
 assert.equal(query(db,'SELECT * FROM content_items WHERE key=ANY($1::text[])', [['movie:1']]).length,1);
 assert.equal(query(db,'SELECT * FROM content_items WHERE name ILIKE $1 OR slug ILIKE $1',["%O'Brien%"]).length,1);
 assert.equal(query(db,'SELECT * FROM content_items WHERE name=$1',["' OR 1=1 --"]).length,0);db.close();
});
test('D1 reset removes only selected overrides and preserves explicit nulls on edits',()=>{
 const db=fixture();db.prepare('INSERT INTO content_items(key,kind,name,overrides) VALUES(?,?,?,?)').run('movie:1','movie','One','{"title":"Manual","noindex":true}');
 let [row]=query(db,'UPDATE content_items SET overrides=overrides || $2::jsonb WHERE key=$1 RETURNING *',['movie:1','{"overview":null}']);assert.deepEqual(row.overrides,{title:'Manual',noindex:true,overview:null});
 [row]=query(db,'UPDATE content_items SET overrides=overrides-$2::text[] WHERE key=$1 RETURNING *',['movie:1',['title']]);assert.deepEqual(row.overrides,{noindex:true,overview:null});db.close();
});
