import { readFile } from 'node:fs/promises';

const auth = process.env.DATAFORSEO_AUTH;

async function api(endpoint, postData) {
  if (!auth) throw new Error('Set DATAFORSEO_AUTH or use the connected DataForSEO plugin.');
  const response = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(postData)
  });
  if (!response.ok) {
    throw new Error(`DataForSEO HTTP Error: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

export async function getRankedKeywords(target, { locationCode = 2818, languageCode = 'ar', limit = 20 } = {}) {
  const result = await api('dataforseo_labs/google/ranked_keywords/live', [{
    target,
    location_code: locationCode,
    language_code: languageCode,
    limit
  }]);
  const items = result.tasks?.[0]?.result?.[0]?.items || [];
  return items.map(it => ({
    keyword: it.keyword_data?.keyword,
    volume: it.keyword_data?.keyword_info?.search_volume || 0,
    cpc: it.keyword_data?.keyword_info?.cpc || 0,
    difficulty: it.keyword_data?.keyword_properties?.keyword_difficulty || 0,
    rank: it.ranked_serp_element?.serp_item?.rank_group || 0,
    url: it.ranked_serp_element?.serp_item?.url || ''
  }));
}

export async function getKeywordIdeas(keywords, { locationCode = 2818, languageCode = 'ar', limit = 20 } = {}) {
  const kwList = Array.isArray(keywords) ? keywords : [keywords];
  const result = await api('dataforseo_labs/google/keyword_ideas/live', [{
    keywords: kwList,
    location_code: locationCode,
    language_code: languageCode,
    limit
  }]);
  const items = result.tasks?.[0]?.result?.[0]?.items || [];
  return items.map(it => ({
    keyword: it.keyword,
    volume: it.keyword_info?.search_volume || 0,
    cpc: it.keyword_info?.cpc || 0,
    difficulty: it.keyword_properties?.keyword_difficulty || 0
  }));
}

// CLI usage
if (process.argv[1] && process.argv[1].endsWith('dataforseo.mjs')) {
  const command = process.argv[2] || 'help';
  const target = process.argv[3];

  if (command === 'competitor' && target) {
    console.log(`Analyzing competitor rankings for: ${target} (Egypt, ar)...`);
    const kw = await getRankedKeywords(target, { limit: 30 });
    console.table(kw);
  } else if (command === 'ideas' && target) {
    console.log(`Fetching keyword ideas for: ${target}...`);
    const ideas = await getKeywordIdeas(target.split(','), { limit: 30 });
    console.table(ideas);
  } else {
    console.log('Usage:');
    console.log('  node scripts/dataforseo.mjs competitor <domain>   (e.g. qfilm.tv)');
    console.log('  node scripts/dataforseo.mjs ideas <keywords>     (e.g. "افلام اكشن,افلام رعب")');
  }
}
