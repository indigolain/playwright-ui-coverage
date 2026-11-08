// Fails the docs build when a link points at a #anchor that doesn't exist, or
// when README.md / docs/README.md link to a file that doesn't exist.
// VitePress already fails on links to missing pages; this covers the part
// after `#`, so renaming a heading can't silently break links to it.
// Runs on the built HTML in docs/.vitepress/dist/ (after `vitepress build`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const base = '/playwright-ui-coverage/';

const pages = new Map(); // dist-relative .html path -> { html, ids }
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.html')) {
      const html = fs.readFileSync(file, 'utf8');
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      pages.set(path.relative(dist, file).split(path.sep).join('/'), { html, ids });
    }
  }
};
walk(dist);

/** The built page a site path points at, e.g. `guide/views` -> `guide/views.html`. */
const pageOf = (p) => {
  if (p === '' || p.endsWith('/')) return `${p}index.html`;
  return p.endsWith('.html') ? p : `${p}.html`;
};

const problems = [];
let checked = 0;
for (const [page, { html }] of pages) {
  // Only the page content, not the theme's navigation.
  const content = html.match(/<main[\s\S]*<\/main>/)?.[0] ?? '';
  for (const [, href] of content.matchAll(/<a [^>]*href="([^"]*#[^"]*)"/g)) {
    const [target, hash] = href.split('#');
    if (!hash || /^[a-z]+:/i.test(target) || target.startsWith('//')) continue; // external link
    let file;
    if (target === '') file = page;
    else if (target.startsWith(base)) file = pageOf(target.slice(base.length));
    else if (target.startsWith('/')) {
      problems.push(`${page}: ${href}: outside the site base ${base}`);
      continue;
    } else file = pageOf(path.posix.normalize(path.posix.join(path.posix.dirname(page), target)));
    checked++;
    const id = decodeURIComponent(hash);
    const found = pages.get(file);
    if (!found) problems.push(`${page}: ${href}: no page ${file}`);
    else if (!found.ids.has(id)) problems.push(`${page}: ${href}: no #${id} in ${file}`);
  }
}

// The repository README and docs/README.md aren't site pages: check that their relative links point at files.
const docsDir = path.join(dist, '..', '..');
for (const readme of [path.join(docsDir, '..', 'README.md'), path.join(docsDir, 'README.md')]) {
  const text = fs.readFileSync(readme, 'utf8');
  for (const [, target] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    checked++;
    if (!fs.existsSync(path.join(path.dirname(readme), target)))
      problems.push(`${path.relative(path.join(docsDir, '..'), readme)}: ${target}: no such file`);
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} link(s) to missing anchors:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ links: all ${checked} #anchor and README links resolve (${pages.size} pages)`);
