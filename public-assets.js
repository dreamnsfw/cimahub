import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// An explicit list keeps templates, admin files and uploads behind their handlers.
export const publicAssetPaths = Object.freeze([
  '/app.js', '/navigation.js', '/title-markup.js', '/home-carousel.js',
  '/media-links.js', '/media-images.js', '/filter-controls.js', '/pagination.js',
  '/styles.css', '/favicon.svg', '/fonts/DroidKufi-Regular.ttf', '/fonts/DroidKufi-Regular.woff2', ...['barlow-1','barlow-2','barlow-3','plex-1','plex-2','plex-3','plex-4'].map(name=>'/fonts/'+name+'.woff2')
]);
const allowed = new Set(publicAssetPaths);
const mime = {'.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.woff2':'font/woff2'};
export const publicAssetHeaders = Object.freeze({
  // Stable filenames revalidate in browsers. Vercel caches static files per
  // deployment, so a new deployment immediately supplies the updated bytes.
  'Cache-Control':'public, max-age=0, must-revalidate',
  'Vercel-CDN-Cache-Control':'public, max-age=31536000',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://image.tmdb.org data:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://megamax.me; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
});

export function createPublicAssetHandler(directory = new URL('./public/', import.meta.url)) {
  const root = directory instanceof URL ? fileURLToPath(directory) : path.resolve(directory);
  return async (req, res, pathname) => {
    if (!allowed.has(pathname)) return false;
    if (!['GET','HEAD'].includes(req.method)) {
      res.writeHead(405, {'Allow':'GET, HEAD', 'Cache-Control':'no-store'});
      res.end(); return true;
    }
    let body;
    try { body = await readFile(path.join(root, pathname.slice(1))); }
    catch (error) {
      // A removed asset must not fall through to database-backed page rendering.
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, {'Cache-Control':'no-store'});
      res.end(); return true;
    }
    const etag = '"' + createHash('sha256').update(body).digest('base64url') + '"';
    const headers = {...publicAssetHeaders, 'Content-Type':mime[path.extname(pathname)], 'ETag':etag};
    const matches = String(req.headers?.['if-none-match'] || '').split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*');
    if (matches) { res.writeHead(304, headers); res.end(); return true; }
    res.writeHead(200, {...headers, 'Content-Length':body.length});
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
