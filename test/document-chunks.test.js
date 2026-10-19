import test from 'node:test';
import assert from 'node:assert/strict';
import {documentChunks} from '../cloudflare/document-chunks.mjs';
test('document chunks preserve Arabic, emoji and boundary characters with bounded byte sizes',()=>{
 const source=('عنوان عربي 😀 日本語 '+ 'x'.repeat(150)).repeat(4000),parts=documentChunks(source);
 assert.equal(parts.join(''),source);
 assert.ok(parts.every(part=>Buffer.byteLength(part)<=30000));
 assert.ok(parts.every(part=>!part.includes('\ufffd')));
 assert.deepEqual(documentChunks(''),['']);
});
