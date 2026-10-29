// Writes search-engine-readable copies of the credits into index.html.
// The page builds its credits list from CREDITS/DETAILS with JavaScript; crawlers that don't run
// scripts would see none of it. This renders the page in a headless browser and fills two
// marked spots in index.html:
//   <!-- prerender:list -->   the credits list as plain HTML (the page swaps in live rows on load)
//   <!-- prerender:jsonld --> schema.org structured data about Emily and her projects
// Run after changing any credit:  NODE_PATH=$(npm root -g) node tools/prerender.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.emily-furst.com/';
const file = path.join(__dirname, '..', 'index.html');

function fill(html, name, content) {
  const re = new RegExp('(<!-- prerender:' + name + '[^>]*-->)[\\s\\S]*?(<!-- /prerender:' + name + ' -->)');
  if (!re.test(html)) throw new Error('marker prerender:' + name + ' not found');
  return html.replace(re, (m, open, close) => open + content + close);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage();
  await page.goto('file://' + file);

  const { list, data } = await page.evaluate((SITE) => {
    const abs = (u) => (u ? new URL(u, SITE).href : undefined);
    const names = (s) => (s ? s.split(/,\s*|;\s*/).map((n) => n.trim()).filter(Boolean) : undefined);
    const me = { '@id': SITE + '#emily' };

    const person = {
      '@type': 'Person', '@id': SITE + '#emily', name: 'Emily Furst', url: SITE,
      jobTitle: ['Film Editor', 'Assistant Editor'],
      description: document.querySelector('meta[name="description"]').content,
      email: 'mailto:emilyj.furst@gmail.com',
      image: abs('images/emily-furst.jpg'),
      address: { '@type': 'PostalAddress', addressLocality: 'Los Angeles', addressRegion: 'CA', addressCountry: 'US' },
      alumniOf: { '@type': 'CollegeOrUniversity', name: 'Loyola Marymount University' },
      knowsAbout: [...document.querySelectorAll('.skills .tools li')].map((li) => li.textContent),
      sameAs: [...document.querySelectorAll('.links a')].map((a) => a.href),
    };

    // Public, named projects only: unannounced and canceled work stays out of search results
    const works = CREDITS.filter((c) => !/^(Untitled|Unannounced)/.test(c.title)).map((c) => {
      const kind = TRACKS[c.track].kind, parts = c.note.split(' · ');
      const series = /series|two-part/i.test(c.note);
      const w = {
        '@type': kind === 'own' ? 'CreativeWork' : series ? 'TVSeries' : 'Movie',
        name: c.title.replace(/\s+[㐀-鿿]+$/, ''),
        alternateName: /[㐀-鿿]/.test(c.title) ? c.title : undefined,
        description: c.syn || c.about,
        genre: (/documentary|docu-?series/i.test(c.note) ? ['Documentary'] : []).concat(parts.filter((p) => !/short|series|documentary|script|Netflix|HBO|lingual|\//i.test(p))),
        datePublished: typeof c.year === 'number' ? String(c.year) : undefined,
        creativeWorkStatus: typeof c.year === 'number' ? 'Released' : c.year,
        image: abs(c.poster || c.still),
        director: names(c.director) && names(c.director).map((n) => ({ '@type': 'Person', name: n })),
        author: c.writers && c.writers !== c.director ? names(c.writers).map((n) => ({ '@type': 'Person', name: n })) : undefined,
        actor: names(c.starring) && names(c.starring).map((n) => ({ '@type': 'Person', name: n })),
        productionCompany: names(c.companies) && names(c.companies).map((n) => ({ '@type': 'Organization', name: n })),
        award: (c.fests || []).map((f) => f[1]).concat(c.awards ? c.awards.split(/\n+/).filter(Boolean) : []),
        sameAs: c.imdb ? 'https://www.imdb.com/title/' + c.imdb + '/' : undefined,
        contributor: { '@type': 'Role', roleName: c.role, contributor: me },
      };
      if (kind === 'doc' && parts[0] && /Netflix|HBO/.test(parts[0])) w.publisher = { '@type': 'Organization', name: parts[0] };
      return w;
    });

    const site = { '@type': 'WebSite', '@id': SITE + '#site', url: SITE, name: 'Emily Furst', about: me };
    const data = { '@context': 'https://schema.org', '@graph': [person, site, ...works] };
    return { list: document.getElementById('list').innerHTML, data };
  }, SITE);
  await browser.close();

  // Closed rows, no ids that clash with the live rows, no inline handlers
  const rows = list.replace(/ id="c\d+"/g, '').replace(/ open=""/g, '');
  const json = JSON.stringify(data, (k, v) => (Array.isArray(v) && !v.length ? undefined : v), 1).replace(/</g, '\\u003c');
  let html = fs.readFileSync(file, 'utf8');
  html = fill(html, 'list', rows);
  html = fill(html, 'jsonld', '\n<script type="application/ld+json">\n' + json + '\n</script>\n');
  fs.writeFileSync(file, html);
  console.log('prerendered', (rows.match(/<details/g) || []).length, 'credits and', data['@graph'].length - 2, 'works');
})();
