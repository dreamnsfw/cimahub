import * as fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {relative, resolve, sep, isAbsolute} from 'node:path';
import {dbEnabled, query, transaction} from './database.js';

const workspace = fileURLToPath(new URL('.', import.meta.url));
const dataDirectory = fileURLToPath(new URL('./data/', import.meta.url));
const pathname = value => value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;

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
  const {rows} = await query('SELECT body FROM data_documents WHERE path=$1', [key]);
  if (!rows.length) throw filesystemError('ENOENT', 'open', path);
  const body = Buffer.from(rows[0].body, 'utf8');
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return encoding ? body.toString(encoding) : body;
}

export async function writeFile(path, data, options) {
  const key = dataPath(path, true);
  if (!key) return fs.writeFile(path, data, options);
  checkSignal(options);
  const encoding = typeof options === 'string' ? options : options?.encoding || 'utf8';
  const body = typeof data === 'string' ? Buffer.from(data, encoding).toString('utf8') : Buffer.from(data).toString('utf8');
  const flag = typeof options === 'object' ? options.flag || 'w' : 'w';
  if (!['w', 'w+', 'wx', 'wx+', 'a', 'a+', 'ax', 'ax+'].includes(flag)) throw new TypeError(`Unsupported PostgreSQL document write flag: ${flag}`);
  if (flag.includes('x')) {
    const result = await query('INSERT INTO data_documents(path,body) VALUES($1,$2) ON CONFLICT DO NOTHING', [key, body]);
    if (!result.rowCount) throw filesystemError('EEXIST', 'open', path);
  } else {
    await query(`INSERT INTO data_documents(path,body) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET body=${flag.startsWith('a') ? 'data_documents.body || EXCLUDED.body' : 'EXCLUDED.body'}, updated_at=clock_timestamp()`, [key, body]);
  }
}

export async function rename(oldPath, newPath) {
  const oldKey = dataPath(oldPath, true), newKey = dataPath(newPath, true);
  if (!oldKey && !newKey) return fs.rename(oldPath, newPath);
  if (!oldKey || !newKey) throw filesystemError('EXDEV', 'rename', oldPath);
  return transaction(async connection => {
    const result = await connection.query('SELECT body,updated_at FROM data_documents WHERE path=$1 FOR UPDATE', [oldKey]);
    if (!result.rows.length) throw filesystemError('ENOENT', 'rename', oldPath);
    if (oldKey === newKey) return;
    await connection.query('INSERT INTO data_documents(path,body,updated_at) VALUES($1,$2,$3) ON CONFLICT(path) DO UPDATE SET body=EXCLUDED.body,updated_at=EXCLUDED.updated_at', [newKey, result.rows[0].body, result.rows[0].updated_at]);
    await connection.query('DELETE FROM data_documents WHERE path=$1', [oldKey]);
  });
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
