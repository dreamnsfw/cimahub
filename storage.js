import * as fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {relative, resolve, sep, isAbsolute} from 'node:path';
import {dbEnabled, query, transaction} from './database.js';

const workspace = fileURLToPath(new URL('.', import.meta.url));
const dataDirectory = fileURLToPath(new URL('./data/', import.meta.url));
const pathname = value => value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;

// Keep hot documents in this process briefly instead of downloading multi-megabyte
// JSON bodies from PostgreSQL for every page. Other instances see edits within 2s;
// writes through this adapter invalidate their paths immediately.
const documentCache = new Map(), documentReads = new Map();
const documentCacheLifetime = 2000, documentCacheByteLimit = 32 * 1024 * 1024, documentCacheEntryLimit = 128;
let documentCacheBytes = 0, documentRevision = 0, documentDatabase;

function forgetDocument(key) {
  const cached = documentCache.get(key);
  if (cached) documentCacheBytes -= cached.bytes;
  documentCache.delete(key);
  documentReads.delete(key);
  documentRevision++;
}

function rememberDocument(key, body) {
  const now = Date.now();
  // Expired documents must not occupy the size budget indefinitely.
  for (const [path, cached] of documentCache) if (cached.expires <= now) {
    documentCache.delete(path); documentCacheBytes -= cached.bytes;
  }
  const bytes = key.length * 2 + 64 + (body === null ? 0 : Math.max(Buffer.byteLength(body), body.length * 2));
  if (bytes > documentCacheByteLimit) return;
  while (documentCache.size >= documentCacheEntryLimit || documentCacheBytes + bytes > documentCacheByteLimit) {
    const [path, cached] = documentCache.entries().next().value;
    documentCache.delete(path); documentCacheBytes -= cached.bytes;
  }
  documentCache.set(key, {body, bytes, expires: now + (body === null ? 1000 : documentCacheLifetime)});
  documentCacheBytes += bytes;
}

async function documentBody(key) {
  if (documentDatabase !== process.env.DATABASE_URL) {
    documentCache.clear(); documentReads.clear(); documentCacheBytes = 0;
    documentDatabase = process.env.DATABASE_URL; documentRevision++;
  }
  const cached = documentCache.get(key);
  if (cached && cached.expires > Date.now()) {
    documentCache.delete(key); documentCache.set(key, cached);
    return cached.body;
  }
  if (cached) forgetDocument(key);
  if (!documentReads.has(key)) {
    const revision = documentRevision;
    const pending = query('SELECT body FROM data_documents WHERE path=$1', [key]).then(({rows}) => {
      const body = rows.length ? rows[0].body : null;
      if (revision === documentRevision) rememberDocument(key, body);
      return body;
    }).finally(() => { if (documentReads.get(key) === pending) documentReads.delete(key); });
    documentReads.set(key, pending);
  }
  return documentReads.get(key);
}

function dataPath(value, documentsOnly = false) {
  if (!dbEnabled()) return null;
  const path = pathname(value);
  if (typeof path !== 'string') return null;
  const absolute = resolve(path), suffix = relative(dataDirectory, absolute);
  if (suffix === '..' || suffix.startsWith('..' + sep) || isAbsolute(suffix)) return null;
  if (documentsOnly && !/\.(json|tmp)$/i.test(absolute)) return null;
  return relative(workspace, absolute).split(sep).join('/');
}

function filesystemError(code, operation, path) {
  const error = new Error(`${code}: ${code === 'ENOENT' ? 'no such file or directory' : code === 'EEXIST' ? 'file already exists' : 'invalid cross-device link'}, ${operation} '${String(pathname(path))}'`);
  Object.assign(error, {code, syscall: operation, path: pathname(path)});
  return error;
}

function checkSignal(options) {
  if (options?.signal?.aborted) {
    const error = new Error('The operation was aborted', {cause: options.signal.reason});
    Object.assign(error, {name: 'AbortError', code: 'ABORT_ERR'});
    throw error;
  }
}

function fileStats(updated, bytes, directory = false, bigint = false) {
  const date = new Date(updated), numeric = value => bigint ? BigInt(Math.trunc(value)) : value;
  return {
    dev: numeric(0), ino: numeric(0), mode: numeric(directory ? 0o40755 : 0o100644), nlink: numeric(1), uid: numeric(0), gid: numeric(0), rdev: numeric(0),
    size: numeric(bytes), blksize: numeric(4096), blocks: numeric(Math.ceil(bytes / 512)),
    atimeMs: numeric(+date), mtimeMs: numeric(+date), ctimeMs: numeric(+date), birthtimeMs: numeric(+date),
    atime: date, mtime: date, ctime: date, birthtime: date,
    isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false,
    isBlockDevice: () => false, isCharacterDevice: () => false, isFIFO: () => false, isSocket: () => false,
    ...(bigint ? {atimeNs: BigInt(+date) * 1000000n, mtimeNs: BigInt(+date) * 1000000n, ctimeNs: BigInt(+date) * 1000000n, birthtimeNs: BigInt(+date) * 1000000n} : {}),
  };
}

export async function readFile(path, options) {
  const key = dataPath(path, true);
  if (!key) return fs.readFile(path, options);
  checkSignal(options);
  const body = await documentBody(key);
  checkSignal(options);
  if (body === null) throw filesystemError('ENOENT', 'open', path);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return encoding === 'utf8' || encoding === 'utf-8' ? body : encoding ? Buffer.from(body, 'utf8').toString(encoding) : Buffer.from(body, 'utf8');
}

export async function writeFile(path, data, options) {
  const key = dataPath(path, true);
  if (!key) return fs.writeFile(path, data, options);
  checkSignal(options);
  const encoding = typeof options === 'string' ? options : options?.encoding || 'utf8';
  const body = typeof data === 'string' ? Buffer.from(data, encoding).toString('utf8') : Buffer.from(data).toString('utf8');
  const flag = typeof options === 'object' ? options.flag || 'w' : 'w';
  if (!['w', 'w+', 'wx', 'wx+', 'a', 'a+', 'ax', 'ax+'].includes(flag)) throw new TypeError(`Unsupported PostgreSQL document write flag: ${flag}`);
  forgetDocument(key);
  try {
    if (flag.includes('x')) {
      const result = await query('INSERT INTO data_documents(path,body) VALUES($1,$2) ON CONFLICT DO NOTHING', [key, body]);
      if (!result.rowCount) throw filesystemError('EEXIST', 'open', path);
    } else {
      await query(`INSERT INTO data_documents(path,body) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET body=${flag.startsWith('a') ? 'data_documents.body || EXCLUDED.body' : 'EXCLUDED.body'}, updated_at=clock_timestamp()`, [key, body]);
    }
  } finally { forgetDocument(key); }
}

export async function rename(oldPath, newPath) {
  const oldKey = dataPath(oldPath, true), newKey = dataPath(newPath, true);
  if (!oldKey && !newKey) return fs.rename(oldPath, newPath);
  if (!oldKey || !newKey) throw filesystemError('EXDEV', 'rename', oldPath);
  forgetDocument(oldKey); forgetDocument(newKey);
  try {
    return await transaction(async connection => {
      const result = await connection.query('SELECT path FROM data_documents WHERE path=$1 FOR UPDATE', [oldKey]);
      if (!result.rows.length) throw filesystemError('ENOENT', 'rename', oldPath);
      if (oldKey === newKey) return;
      // Move large JSON bodies inside PostgreSQL instead of downloading and then
      // uploading the same body again for every atomic document replacement.
      await connection.query('INSERT INTO data_documents(path,body,updated_at) SELECT $2,body,updated_at FROM data_documents WHERE path=$1 ON CONFLICT(path) DO UPDATE SET body=EXCLUDED.body,updated_at=EXCLUDED.updated_at', [oldKey, newKey]);
      await connection.query('DELETE FROM data_documents WHERE path=$1', [oldKey]);
    });
  } finally { forgetDocument(oldKey); forgetDocument(newKey); }
}

// PostgreSQL documents need no physical directories in a read-only deployment.
export async function mkdir(path, options) {
  if (process.env.VERCEL && dataPath(path)) return;
  return fs.mkdir(path, options);
}

export async function stat(path, options) {
  const key = dataPath(path, true);
  if (!key) return fs.stat(path, options);
  const {rows} = await query('SELECT octet_length(body) AS bytes,updated_at FROM data_documents WHERE path=$1', [key]);
  if (!rows.length) throw filesystemError('ENOENT', 'stat', path);
  return fileStats(rows[0].updated_at, rows[0].bytes, false, options?.bigint);
}

export async function readdir(path, options) {
  const key = dataPath(path);
  if (!key) return fs.readdir(path, options);
  const prefix = key.replace(/\/$/, '') + '/';
  const {rows} = await query('SELECT path FROM data_documents WHERE starts_with(path,$1) ORDER BY path', [prefix]);
  const entries = new Map();
  let diskExists = true;
  try {
    for (const entry of await fs.readdir(path, {withFileTypes: true})) {
      if (entry.isDirectory() || !/\.(json|tmp)$/i.test(entry.name)) entries.set(entry.name, entry);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    diskExists = false;
  }
  if (!diskExists && !rows.length) throw filesystemError('ENOENT', 'scandir', path);
  for (const row of rows) {
    const suffix = row.path.slice(prefix.length), name = suffix.split('/')[0], directory = suffix.includes('/');
    if (!entries.has(name)) entries.set(name, {
      name, parentPath: resolve(pathname(path)), path: resolve(pathname(path)),
      isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false,
      isBlockDevice: () => false, isCharacterDevice: () => false, isFIFO: () => false, isSocket: () => false,
    });
  }
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return [...entries.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(entry => {
    if (options?.withFileTypes) return encoding === 'buffer' ? Object.assign(Object.create(Object.getPrototypeOf(entry)), entry, {name: Buffer.from(entry.name)}) : entry;
    return encoding === 'buffer' ? Buffer.from(entry.name) : entry.name;
  });
}
