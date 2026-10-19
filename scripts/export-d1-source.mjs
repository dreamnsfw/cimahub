// Read-only PostgreSQL export. Keep the resulting SQL private: it contains
// account password hashes and source URLs. No destination is changed here.
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2), sourceFlag = args.indexOf('--source-env');
if (sourceFlag < 0 || !args[sourceFlag + 1]) throw new Error('Specify --source-env explicitly; do not silently fall back to an older database.');
const settings = parseEnv(await readFile(args[sourceFlag + 1], 'utf8'));
// Export cursors need a stable session; prefer the direct connection.
const connectionString = settings.DATABASE_URL || settings.DATABASE_URL_POOLED;
if (!connectionString) throw new Error('The selected environment has no database connection.');
const directory = resolve('.runtime/d1-migration');
await mkdir(directory, {recursive: true});
const client = new pg.Client({connectionString, connectionTimeoutMillis: 15000, query_timeout: 60000});
const {appendFile} = await import('node:fs/promises');
const temporary = resolve(directory, 'source.sql.tmp'), destination = resolve(directory, 'source.sql');
const quote = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const jsonFields = new Set(['overrides','snapshot','value','details','data']);
const booleans = new Set(['active','enabled','managed']);
const tables = ['admin_users','content_items','site_settings','content_sources','source_scopes','taxonomy','job_runs','runtime_state','content_parts'];
const manifest = {exportedAt: new Date().toISOString(), source: new URL(connectionString).hostname, tables: {}, documents: 0, seoRecords: 0};

async function insert(table, row) {
  const fields = Object.keys(row), values = fields.map(key => {
    const value = row[key];
    return value instanceof Date ? value.toISOString() : value === null ? null : booleans.has(key) ? Number(value) : jsonFields.has(key) ? JSON.stringify(value) : value;
  });
  const expressions=[];
  for(const value of values){
    if(typeof value!=='string'||Buffer.byteLength(value)<20000){expressions.push(quote(value));continue;}
    if(Buffer.byteLength(value)>1900000)throw new Error(`A ${table} field exceeds the D1 row size; export stopped without truncating it.`);
    const id=randomUUID();let chunk='',bytes=0,ordinal=0;
    for(const character of value){const size=Buffer.byteLength(character);if(bytes+size>30000){await appendFile(temporary,`INSERT INTO __migration_chunks VALUES('${id}',${ordinal++},${quote(chunk)});\n`);chunk='';bytes=0;}chunk+=character;bytes+=size;}
    if(chunk)await appendFile(temporary,`INSERT INTO __migration_chunks VALUES('${id}',${ordinal},${quote(chunk)});\n`);
    expressions.push(`(SELECT group_concat(body,'') FROM (SELECT body FROM __migration_chunks WHERE id='${id}' ORDER BY ordinal))`);
  }
  const sql = `INSERT INTO ${table}(${fields.join(',')}) VALUES(${expressions.join(',')});\n`;
  if (Buffer.byteLength(sql) > 90000) throw new Error(`A ${table} record exceeds the safe D1 import statement size; export stopped without truncating it.`);
  await appendFile(temporary, sql, 'utf8');
}

try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await writeFile(temporary, '-- Private source snapshot. Sessions are deliberately invalidated at migration.\nPRAGMA foreign_keys=ON;\nCREATE TABLE __migration_chunks(id TEXT NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,ordinal));\n', {mode: 0o600});
  for (const table of tables) {
    let count = 0;
    const digest = createHash('sha256');
    await client.query(`DECLARE migration_cursor NO SCROLL CURSOR FOR SELECT * FROM ${table} ORDER BY 1`);
    while (true) {
      const {rows} = await client.query('FETCH FORWARD 20 FROM migration_cursor');
      if (!rows.length) break;
      for (const row of rows) { await insert(table, row); digest.update(JSON.stringify(row)); count++; }
    }
    await client.query('CLOSE migration_cursor');
    manifest.tables[table] = {count, sha256: digest.digest('hex')};
  }
  await client.query('DECLARE migration_cursor NO SCROLL CURSOR FOR SELECT path,body,updated_at FROM data_documents ORDER BY path');
  while (true) {
    const {rows} = await client.query('FETCH FORWARD 1 FROM migration_cursor');
    if (!rows.length) break;
    const row = rows[0];
    if (row.path === 'data/movie-index.json') {
      for(const [id,value] of Object.entries(JSON.parse(row.body)))await insert('movie_index',{id:Number(id),...value});
    } else if (row.path === 'data/seo-catalog.json') {
      const catalog = JSON.parse(row.body);
      for (const namespace of ['works','images','pages','collections']) {
        for (const [key,value] of Object.entries(catalog[namespace] || {})) {
          await insert('seo_records', {namespace,key,value});
          manifest.seoRecords++;
        }
      }
    } else {
      await insert('data_documents', {path:row.path,bytes:Buffer.byteLength(row.body),revision:randomUUID(),updated_at:row.updated_at});
      // Split by Unicode code points to preserve characters at chunk boundaries.
      let chunk = '', bytes = 0, ordinal = 0;
      for (const character of row.body) {
        const size = Buffer.byteLength(character);
        if (bytes + size > 30000) {
          await insert('data_document_chunks', {path:row.path,ordinal:ordinal++,body:chunk}); chunk=''; bytes=0;
        }
        chunk += character; bytes += size;
      }
      if (chunk || !ordinal) await insert('data_document_chunks', {path:row.path,ordinal,body:chunk});
      manifest.documents++;
    }
  }
  await client.query('CLOSE migration_cursor');
  await client.query('COMMIT');
  await appendFile(temporary,'DROP TABLE __migration_chunks;\n');
  await rename(temporary, destination);
  await writeFile(resolve(directory, 'source.manifest.json'), JSON.stringify(manifest,null,2), {mode:0o600});
  console.log(JSON.stringify({output:destination,counts:manifest.tables,documents:manifest.documents,seoRecords:manifest.seoRecords}));
} catch (error) {
  await client.query('ROLLBACK').catch(()=>{});
  // Never print connection strings, password hashes, or row contents.
  console.error(JSON.stringify({error:'D1 source export failed; the destination was not changed.',code:error.code || error.name,...(error.message?.startsWith('A ') ? {detail:error.message} : {})}));
  process.exitCode = 1;
} finally { await client.end(); }
