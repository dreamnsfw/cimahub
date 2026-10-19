import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const directory=await mkdtemp(join(tmpdir(),'cimahub-sitemap-response-'));
const previous={directory:process.env.SEO_DATA_DIR,vercel:process.env.VERCEL};
process.env.SEO_DATA_DIR=directory;
process.env.VERCEL='1';
const {handleRequest}=await import('../server.js');
for(const [key,value] of [['SEO_DATA_DIR',previous.directory],['VERCEL',previous.vercel]]){
  if(value===undefined)delete process.env[key];else process.env[key]=value;
}
after(()=>rmdir(directory));

async function response(url,method='GET'){
  const res={headers:{},
    setHeader(key,value){this.headers[key.toLowerCase()]=value;},
    getHeader(key){return this.headers[key.toLowerCase()];},
    writeHead(status,headers={}){this.status=status;for(const [key,value] of Object.entries(headers))this.setHeader(key,value);},
    end(body){this.body=body;}
  };
  await handleRequest({url,method,headers:{}},res);
  return res;
}

test('every sitemap permits native XML viewer styles while blocking scripts and resources',async()=>{
  for(const path of ['/sitemap.xml','/sitemap-base.xml','/sitemap-categories.xml','/sitemap-movies-1.xml','/sitemap-videos.xml']){
    const res=await response(path);
    assert.equal(res.status,200,path);
    assert.match(res.headers['content-type'],/^application\/xml/);
    assert.match(res.body,/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(res.headers['content-security-policy'],/default-src 'none'; style-src 'unsafe-inline';/);
    assert.match(res.headers['content-security-policy'],/img-src data:;/);
    assert.doesNotMatch(res.headers['content-security-policy'],/script-src|https?:/);
    const head=await response(path,'HEAD');
    assert.equal(head.status,200,path);
    assert.equal(head.body,undefined,path);
    assert.equal(head.headers['content-security-policy'],res.headers['content-security-policy']);
  }
});

test('HTML pages and missing sitemap errors keep the strict site policy',async()=>{
  for(const [path,status] of [['/categories/',200],['/sitemap-movies-999.xml',404]]){
    const res=await response(path);
    assert.equal(res.status,status,path);
    assert.match(res.headers['content-type'],/^text\/html/);
    assert.match(res.headers['content-security-policy'],/script-src 'self' https:\/\/www\.googletagmanager\.com; style-src 'self' https:\/\/fonts\.googleapis\.com;/);
    assert.doesNotMatch(res.headers['content-security-policy'],/'unsafe-inline'/);
  }
});
