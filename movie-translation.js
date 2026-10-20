import {mkdir, readFile, writeFile, rename} from './storage.js';
import {createHash} from 'node:crypto';
import {isPublicDatabaseRead} from './d1-client.js';

// MyMemory accepts at most 500 UTF-8 bytes per request. Prefer sentence boundaries.
export function translationChunks(text) {
  const chunks = [];
  let chunk = '';
  for (const word of text.trim().split(/\s+/)) {
    if (Buffer.byteLength(word) > 480) throw new Error('Translation word too long');
    const next = chunk ? `${chunk} ${word}` : word;
    if (Buffer.byteLength(next) > 480) { chunks.push(chunk); chunk = word; }
    else chunk = next;
    if (Buffer.byteLength(chunk) > 250 && /[.!?。！？]$/.test(chunk)) { chunks.push(chunk); chunk = ''; }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function createMovieTranslator({directory = new URL('./data/translations/', import.meta.url), fetcher = fetch} = {}) {
  const pending = new Map();
  const failures = new Map();
  let quotaUntil = 0;
  return async function translate({id, text, language = 'en', cachedOnly = false}) {
    if (!text?.trim() || language === 'ar') return language === 'ar' ? text : '';
    const hash = createHash('sha256').update(`v1:${language}:${text}`).digest('hex');
    const filename = new URL(`${Number(id)}-${hash}.json`, directory);
    try {
      const saved = JSON.parse(await readFile(filename, 'utf8'));
      if (saved.hash === hash && /[\u0600-\u06ff]/u.test(saved.overview)) return saved.overview;
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) console.warn('Movie translation cache read failed'); }
    if (cachedOnly || isPublicDatabaseRead() || quotaUntil > Date.now() || failures.get(hash) > Date.now()) return '';
    if (pending.has(hash)) return pending.get(hash);
    const work = (async () => {
      try {
        const translated = [];
        for (const chunk of translationChunks(text)) {
          const query = new URLSearchParams({q: chunk, langpair: `${language}|ar`});
          const response = await fetcher(`https://api.mymemory.translated.net/get?${query}`, {signal: AbortSignal.timeout(10000)});
          if (!response.ok) throw new Error('Translation service unavailable');
          const data = await response.json();
          if (data.quotaFinished || Number(data.responseStatus) === 429) { quotaUntil = Date.now() + 3600000; throw new Error('Translation quota reached'); }
          const result = data.responseData?.translatedText?.trim();
          if (Number(data.responseStatus) !== 200 || !result || !/[\u0600-\u06ff]/u.test(result)) throw new Error('Invalid translation');
          translated.push(result);
        }
        const overview = translated.join(' ');
        await mkdir(directory, {recursive:true});
        const temporary = new URL(`${Number(id)}-${hash}.tmp`, directory);
        await writeFile(temporary, JSON.stringify({hash, overview, sourceLanguage:language, provider:'MyMemory', translatedAt:new Date().toISOString()}, null, 2));
        await rename(temporary, filename);
        return overview;
      } catch {
        if (failures.size >= 1000) failures.clear();
        failures.set(hash, Date.now() + 60000);
        console.warn(`Arabic story translation deferred for movie ${Number(id)}`);
        return '';
      } finally { pending.delete(hash); }
    })();
    pending.set(hash, work);
    return work;
  };
}
