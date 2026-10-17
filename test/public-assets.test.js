import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {createPublicAssetHandler,publicAssetPaths,publicAssetHeaders} from '../public-assets.js';

const state = {calls:0};
globalThis[Symbol.for('cimahub.public-assets.database')] = state;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database.js') return {url:'cimahub-public-assets:database', shortCircuit:true};
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'cimahub-public-assets:database') return {format:'module', shortCircuit:true, source:`
      const fail=async()=>{globalThis[Symbol.for('cimahub.public-assets.database')].calls++;throw new Error('database unavailable');};
      export const dbEnabled=()=>true;
      export const initializeDatabase=fail,query=fail,transaction=fail,closeDatabase=async()=>{};
    `};
    return next(url, context);
  }
});
const {handleRequest} = await import('../server.js');

function response() {
  return {statusCode:200, headers:{},
    setHeader(key,value) { this.headers[key.toLowerCase()] = value; },
    getHeader(key) { return this.headers[key.toLowerCase()]; },
    writeHead(status,headers={}) { this.statusCode=status;for(const [key,value] of Object.entries(headers))this.setHeader(key,value); },
    end(body) { this.body=body; }
  };
}
const request = (url,method='GET',headers={}) => ({url,method,headers});

test('public assets remain available without database initialization or settings reads', async () => {
  const before = state.calls;
  for (const pathname of publicAssetPaths) {
    const res=response(); await handleRequest(request(pathname+'?v=deployment'),res);
    assert.equal(res.statusCode,200,pathname);
    assert.ok(res.body.length,pathname);
    assert.match(res.getHeader('content-type'),/javascript|css|svg|font/);
    for(const [key,value] of Object.entries(publicAssetHeaders))assert.equal(res.getHeader(key),value,pathname);
  }
  assert.equal(state.calls,before,'static files must not contact PostgreSQL');
});

test('stable asset names revalidate with ETags and HEAD omits the body',async()=>{
  const first=response();await handleRequest(request('/styles.css'),first);
  const head=response();await handleRequest(request('/styles.css','HEAD'),head);
  assert.equal(head.statusCode,200);assert.equal(head.body,undefined);
  assert.equal(head.getHeader('content-length'),first.body.length);
  const cached=response();await handleRequest(request('/styles.css','GET',{'if-none-match':'W/'+first.getHeader('etag')}),cached);
  assert.equal(cached.statusCode,304);assert.equal(cached.body,undefined);
  assert.equal(cached.getHeader('etag'),first.getHeader('etag'));
  assert.doesNotMatch(cached.getHeader('cache-control'),/immutable/);
});

test('missing known assets return an uncached 404 without falling through',async()=>{
  const serve=createPublicAssetHandler(new URL('./no-public-assets/',import.meta.url));
  const before=state.calls,res=response();
  assert.equal(await serve(request('/styles.css'),res,'/styles.css'),true);
  assert.equal(res.statusCode,404);assert.equal(res.getHeader('cache-control'),'no-store');
  assert.equal(state.calls,before);
});

test('asset allowlist rejects private files, traversal and mutations',async()=>{
  const serve=createPublicAssetHandler();
  for(const pathname of ['/.env','/server.js','/public/styles.css','/admin/admin.js','/api/admin/settings','/index.html','/if.php','/fonts/../../database.js','/%2e%2e/server.js']){
    assert.equal(await serve(request(pathname),response(),pathname),false,pathname);
  }
  const before=state.calls,res=response();await handleRequest(request('/styles.css','POST'),res);
  assert.equal(res.statusCode,405);assert.equal(res.getHeader('cache-control'),'no-store');
  assert.equal(state.calls,before);
});

test('database failures on pages and private APIs remain uncached',async()=>{
  for(const pathname of ['/','/admin/','/api/admin/settings']){
    const res=response();await handleRequest(request(pathname),res);
    assert.equal(res.statusCode,503,pathname);assert.equal(res.getHeader('cache-control'),'no-store',pathname);
    assert.equal(res.getHeader('vercel-cdn-cache-control'),undefined,pathname);
  }
});

test('Vercel serves exactly the public allowlist before its function catchall',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.outputDirectory,'public');
  const [assets,...rest]=config.routes,pattern=new RegExp(assets.src);
  assert.deepEqual(assets.methods,['GET','HEAD']);assert.equal(assets.dest,'/$1');
  assert.deepEqual(assets.headers,publicAssetHeaders);
  for(const pathname of publicAssetPaths){
    assert.equal(pattern.test(pathname),true,pathname);
    assert.equal(pathname.replace(pattern,assets.dest),pathname,pathname);
    assert.ok((await readFile(new URL('../public'+pathname,import.meta.url))).length,pathname);
  }
  for(const pathname of ['/','/index.html','/admin/','/admin/admin.css','/admin/admin.js','/api/home','/api/admin/settings','/uploads/poster.jpg','/.env','/missing.js','/stylesXcss','/fonts/../server.js'])assert.equal(pattern.test(pathname),false,pathname);
  assert.deepEqual(rest,[{src:'/(.*)',dest:'/api/index.mjs'}]);
  assert.ok(!config.routes.some(route=>route.handle==='filesystem'));
});
