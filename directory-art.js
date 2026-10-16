// Static decorative scenes: only a known route key reaches the SVG markup.
const scenes = {
  movies: '<path d="M31 31h90v51H31zM31 44h90M31 31l8-14 86 14-4 13M45 20l8 15M66 23l8 15M87 27l8 15M108 30l8 14M68 53l22 10-22 11z"/><path d="M22 64h-8M128 65h13M132 25l5-5"/>',
  series: '<rect x="30" y="26" width="95" height="55" rx="8"/><path d="m57 12 19 14 20-14M59 90h38M76 81v9M44 40h59v28H44zM114 43h1M114 54h1M114 65h1"/>',
  'anime-movies': '<path d="m37 38 5-18 10 9 18-12 19 12 11-9 5 18-3 24-17 17H61L40 62zM41 42l12 7M100 42l-12 7M57 52l10-4M83 48l10 4M70 64q7 6 14 0"/><path d="m118 27 3-9 3 9 9 3-9 3-3 9-3-9-9-3zM110 69l5-5M124 58l5 5"/>',
  'anime-series': '<path d="m32 45 6-22 9 8 15-13 21 10 10-6 9 21-4 24-15 15H57L38 65zM49 51l11-5M78 46l11 5M62 67q7 5 13 0"/><rect x="108" y="41" width="32" height="39" rx="5"/><path d="m119 52 12 8-12 8zM111 30l6 4M134 30l-5 4"/>',
  action: '<circle cx="110" cy="50" r="27"/><circle cx="110" cy="50" r="15"/><path d="M110 13v13M110 75v13M74 50h14M134 50h14M59 14 31 53h21l-5 32 35-45H60z"/>',
  adventure: '<circle cx="78" cy="49" r="33"/><circle cx="78" cy="49" r="24"/><path d="m92 31-8 25-20 13 9-26zM78 9v10M78 79v11M37 49h10M108 49h10M24 75l9-15 10 15M116 82l12-20 14 20"/>',
  comedy: '<path d="M31 24q21-10 43 0v22q-4 24-21 32-18-8-22-32zM42 38q5-7 10 0M59 38q5-7 10 0M42 50q13 19 25 0"/><path d="M83 33q21-10 43 0v22q-4 24-21 32-18-8-22-32zM94 47q5-7 10 0M111 47q5-7 10 0M94 60q13 18 25 0M123 15l5 5M133 28h8"/>',
  crime: '<circle cx="51" cy="58" r="19"/><circle cx="112" cy="58" r="19"/><path d="M67 48q13-11 29 0M34 53l-4-13 11-8M129 52l4-14-10-8M42 57q9-13 18 0M44 64q7-10 14 0M102 58q10-14 20 0M106 65q6-8 12 0M67 16q12-8 23 0M73 23q7-5 12 0"/>',
  drama: '<path d="M26 19h108v66H26zM26 28q17 8 29 31L40 85M134 28q-17 8-29 31l15 26M56 34q23-10 47 0v18q-3 21-24 29-21-8-23-29zM65 46l9 4M86 50l9-4M69 66q10-11 20 0M35 19v-8M125 19v-8"/>',
  fantasy: '<path d="M35 83V42h19v41M35 42l9-18 10 18M54 83V52h43v31M66 52V33h20v19M66 33l10-20 10 20M97 83V42h19v41M97 42l9-18 10 18M66 83V66q10-13 20 0v17M23 83h106M126 55l9-7M128 65l11 3"/><path d="m120 17 2-7 2 7 7 2-7 2-2 7-2-7-7-2z"/>',
  horror: '<path d="M91 16q-15 17 2 32-28 1-29-22 8-10 27-10zM42 84V48q0-21 21-21t21 21v36l-10-8-11 8-11-8zM53 49v7M73 49v7M58 67q5-5 10 0M94 69l7-12 7 12M112 77l7-12 7 12M23 29h7M26 25v8"/>',
  mystery: '<circle cx="66" cy="43" r="25"/><circle cx="66" cy="43" r="16"/><path d="m84 62 28 26 9-9-28-26M60 34q2-8 10-5t4 11l-8 5v6M66 57h.1M121 23v18M114 23h14M121 36h10M30 70l5 6M25 84l6 4"/>',
  romance: '<path d="M79 79 42 43q-18-23 6-30 18-5 31 17 13-22 31-17 24 7 6 30zM43 60l-12 5M113 65l12 6"/><path d="m25 31 3-9 3 9 9 3-9 3-3 9-3-9-9-3zM124 14l4 4M137 34h8M66 86l5 3M92 85l-5 4"/>',
  'sci-fi': '<ellipse cx="81" cy="49" rx="61" ry="15" transform="rotate(-21 81 49)"/><circle cx="81" cy="49" r="29"/><path d="M63 30q11 6 20 1M94 61l9 3M46 18l4 4M125 79l5 4M128 15v12M122 21h12M29 81h7"/>',
  thriller: '<path d="M24 46q54-46 110 0-56 46-110 0z"/><circle cx="79" cy="46" r="17"/><circle cx="79" cy="46" r="6"/><path d="M27 79h24l8-12 10 23 9-17 7 6h49M45 17l-4-8M113 17l5-8"/>',
  documentary: '<rect x="32" y="35" width="72" height="46" rx="6"/><path d="m104 47 24-10v43l-24-11M43 35V23h28v12M75 35V18h20v17M51 58h17M60 49v18"/><circle cx="49" cy="20" r="9"/><circle cx="84" cy="20" r="11"/><path d="M23 60h-9M133 22h8"/>',
  family: '<circle cx="54" cy="36" r="11"/><circle cx="106" cy="36" r="11"/><circle cx="80" cy="54" r="9"/><path d="M32 77V66q0-18 22-18 16 0 21 12M128 77V66q0-18-22-18-16 0-21 12M61 84V76q0-13 19-13t19 13v8M32 84h96M78 15l-6-6M82 15l6-6"/>',
  history: '<path d="M30 82h100M37 72h86M41 35h78M36 29l44-17 44 17zM45 35v37M59 35v37M75 35v37M89 35v37M105 35v37M119 35v37M29 88h102"/><path d="M136 49v22M130 55h12"/>',
  war: '<path d="m81 19 29 10v24q-1 23-29 34-28-11-29-34V29zM81 29v44M69 49h24M36 24l5 4 88 63M31 34l10-12M31 84l94-60 4 4M119 22l12 12M26 88l8-10M126 88l-9-10"/>',
  music: '<path d="M49 73V25l63-13v48M49 39l63-13"/><ellipse cx="37" cy="76" rx="13" ry="9" transform="rotate(-20 37 76)"/><ellipse cx="100" cy="63" rx="13" ry="9" transform="rotate(-20 100 63)"/><path d="M129 48v27M129 48l13 6M74 66v19M74 66l11 4"/><circle cx="67" cy="18" r="3"/>',
  biography: '<path d="M29 25q27-11 50 2 23-13 50-2v57q-28-9-50 1-22-10-50-1zM79 27v56M95 39h20M95 49h20M95 60h13M42 70h23"/><circle cx="53" cy="43" r="8"/><path d="M40 63v-6q0-9 13-9t13 9v6M67 15l5-6M87 15l-5-6"/>',
  'sci-fi-fantasy': '<circle cx="49" cy="33" r="19"/><ellipse cx="49" cy="33" rx="31" ry="7" transform="rotate(-24 49 33)"/><path d="M70 86V55h18v31M70 55l9-16 9 16M88 86V63h25v23M113 86V47h18v39M113 47l9-18 9 18M97 86V75h8v11M25 79l8-12 8 12M71 18h7M75 14v8"/>',
  kids: '<path d="m48 13 25 28-25 28-25-28zM23 41h50M48 13v56M48 69q-15 13 10 18M56 78l-8 3 10 4M99 61V40"/><ellipse cx="99" cy="26" rx="17" ry="21"/><path d="m94 48 5-6 5 6M112 85l11-12M123 73l11 12M121 17h14M128 10v14"/><circle cx="123" cy="84" r="12"/>',
  news: '<rect x="29" y="28" width="89" height="54" rx="5"/><path d="M118 39h14v36q0 7-7 7M40 41h29v20H40zM79 42h27M79 52h27M79 62h20M40 72h66M43 17h46M98 13v9M110 16l7-5"/>',
  reality: '<path d="M32 50q35-31 71 0-36 31-71 0z"/><circle cx="68" cy="50" r="13"/><path d="M21 32V18h22M111 18h21v15M21 69v14h22M111 83h21V69M108 42l24-11v38l-24-11M68 8v9M47 11l4 8M88 11l-4 8"/>',
  soap: '<rect x="27" y="24" width="66" height="57" rx="6"/><path d="M38 39h44M38 50h28M38 61h21M41 14v18M79 14v18M91 23l16 10M105 39l10 6"/><circle cx="110" cy="65" r="22"/><path d="M110 52v14l9 6M74 72l4 5M23 90h113"/>',
  talk: '<rect x="45" y="20" width="22" height="34" rx="11"/><path d="M36 43v8q0 20 20 20t20-20v-8M56 71v14M43 85h26M100 27h29v24h-15l-10 9v-9h-4zM105 36h18M105 43h11M49 32h14M49 41h14"/>',
  'war-politics': '<path d="m45 19 24 9v24q0 20-24 31-24-11-24-31V28zM45 33v33M34 48h22M78 82h59M84 72h47M84 36h47M81 30l27-16 27 16zM89 36v36M100 36v36M115 36v36M126 36v36"/>',
  western: '<path d="M49 48q4-7 5-27 9 6 21 6t21-6q1 20 5 27M25 49q50 27 102 0M37 58q38 13 77 0M47 46h56M130 85V33M130 56h-9q-7 0-7-7V39M130 69h9q7 0 7-7V52M118 85h24M23 85h78"/>',
  foreign: '<circle cx="77" cy="48" r="33"/><ellipse cx="77" cy="48" rx="16" ry="33"/><path d="M44 48h66M49 31h56M49 65h56M77 15v66M17 28h16M124 69h17M119 23l8-8M24 78l8-8"/>',
  asian: '<path d="M32 41q46-8 92 0M22 35q55-27 114 0M41 41v36M115 41v36M30 77h96M55 77V54h45v23M55 54l22-13 23 13M77 54v23M29 88h100"/><circle cx="115" cy="18" r="8"/><path d="M16 62h12M22 56v12"/>',
  arabic: '<path d="M38 84V52q0-16 17-28 17 12 17 28v32M44 24h22M55 12v12M22 84h116M88 84V47q0-12 13-20 13 8 13 20v37M81 47h40M101 17v10M48 84V63q7-10 14 0v21M91 84V61h20M128 26q-12 8 0 16-20 1-20-15 8-6 20-1z"/>',
  indian: '<path d="M26 84h109M35 78V48h20v30M103 78V48h20v30M55 78V45q0-17 24-30 24 13 24 30v33M50 45h58M79 8v7M65 78V58q14-14 28 0v20M40 48l5-11 5 11M108 48l5-11 5 11M23 91h115"/>',
  turkish: '<path d="M50 82V45q0-16 27-25 27 9 27 25v37M44 45h66M77 11v9M64 82V61q13-12 26 0v21M30 82V31M24 31l6-14 6 14M124 82V31M118 31l6-14 6 14M22 82h110"/><path d="M136 18q-11 7 0 14-18 1-18-13 7-5 18-1zM139 35l2-4 2 4 4 1-4 2-2 4-2-4-4-2z"/>',
  upcoming: '<path d="M36 22h88v59H36zM36 39h88M50 12v20M109 12v20M52 52h13M52 65h13M104 64l17 10-17 10z"/><circle cx="110" cy="73" r="20"/><path d="M77 52h11M77 65h7M25 84l-7 5M135 31l7-4"/>',
  adult: '<path d="M36 25h88v56H36zM48 81v7h64v-7M51 43l8-5v29M51 67h16"/><path d="M78 40c-12 0-12 13 0 13 12 0 12-13 0-13zM78 53c-15 0-15 15 0 15 15 0 15-15 0-15zM102 45v16M94 53h16M27 20l-7-7M133 20l7-7M21 53h7M132 53h7"/>',
  year: '<rect x="35" y="20" width="90" height="65" rx="7"/><path d="M35 38h90M54 10v21M105 10v21M50 52h13M74 52h13M99 52h11M50 67h13M74 67h13M99 67h11M23 42h-9M132 73h12"/>',
  catalog: '<rect x="28" y="23" width="103" height="57" rx="7"/><path d="M44 23v57M114 23v57M28 38h16M28 54h16M28 68h16M114 38h17M114 54h17M114 68h17M69 38l24 14-24 14z"/>'
};

const regions = {
  '/movies/foreign': 'foreign', '/series-category/english-series': 'foreign',
  '/movies/asian': 'asian', '/series-category/asian-series': 'asian',
  '/movies/arabic': 'arabic', '/series-category/arabic-series': 'arabic',
  '/movies/indian': 'indian', '/series-category/indian-series': 'indian',
  '/movies/turkish': 'turkish', '/series-category/turkish-series': 'turkish'
};
const roots = {
  '/movies': 'movies', '/series': 'series',
  '/anime/movies': 'anime-movies', '/anime/series': 'anime-series',
  '/movies/18-plus': 'adult', '/movies/coming-soon': 'upcoming'
};

export function directoryArtwork(path) {
  const pathname = typeof path === 'string' ? path.split(/[?#]/, 1)[0].replace(/\/+$/, '') : '';
  const genre = pathname.match(/^\/(?:movies\/genre|series-genre|anime\/(?:movies|series)\/genre)\/([a-z-]+)$/)?.[1];
  const key = Object.hasOwn(roots, pathname) ? roots[pathname]
    : Object.hasOwn(regions, pathname) ? regions[pathname]
    : /^\/movies\/year\/\d{4}$/.test(pathname) ? 'year'
    : genre && Object.hasOwn(scenes, genre) ? genre : 'catalog';
  return `<svg class="directory-art" viewBox="0 0 160 100" aria-hidden="true" focusable="false" data-art="${key}"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${scenes[key]}</g></svg>`;
}
