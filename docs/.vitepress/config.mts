import { defineConfig } from 'vitepress';

const repo = 'https://github.com/indigolain/playwright-ui-coverage';

/**
 * GitHub-style heading anchors (github-slugger's rules), so `page.md#anchor`
 * links work the same on the site and when the docs/ folder is read on GitHub.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

export default defineConfig({
  title: 'playwright-ui-coverage',
  description:
    'See which buttons, links and inputs your Playwright E2E tests actually touch: screenshots with tested/untested overlays.',
  base: '/playwright-ui-coverage/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  // docs/README.md is the table of contents for browsing docs/ on GitHub.
  srcExclude: ['README.md'],
  // Dead links fail the build (VitePress default); .vitepress/check-anchors.mjs checks #anchors.
  markdown: {
    anchor: { slugify },
  },
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/playwright-ui-coverage/favicon.svg' }]],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'CI', link: '/ci/thresholds', activeMatch: '/ci/|/github-actions' },
      { text: 'Reference', link: '/reference/configuration', activeMatch: '/reference/|/coverage-json' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is UI coverage?', link: '/guide/introduction' },
          { text: 'Getting started', link: '/guide/getting-started' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Reading the report', link: '/guide/reading-the-report' },
          { text: 'How it works', link: '/guide/how-it-works' },
          { text: 'Which elements count', link: '/guide/which-elements-count' },
          { text: 'Element identity', link: '/guide/element-identity' },
          { text: 'Element grouping', link: '/guide/element-grouping' },
          { text: 'Links and untested views', link: '/guide/links' },
          { text: 'Views', link: '/guide/views' },
          { text: 'Report-time rules', link: '/guide/rules' },
          { text: 'Screenshots', link: '/guide/screenshots' },
          { text: 'Iframes and shadow DOM', link: '/guide/iframes-shadow-dom' },
          { text: 'Retries and failed tests', link: '/guide/retries' },
          { text: 'Sharding and merge-reports', link: '/guide/sharding' },
          { text: 'Component testing', link: '/guide/component-testing' },
          { text: 'Suggested locators and a11y hints', link: '/guide/locators-and-accessibility' },
          { text: 'Insights and the HTML report', link: '/guide/insights' },
        ],
      },
      {
        text: 'CI',
        items: [
          { text: 'Thresholds', link: '/ci/thresholds' },
          { text: 'Baseline (ratchet)', link: '/ci/baseline' },
          { text: 'Comparing runs and PR comments', link: '/ci/compare' },
          { text: 'GitHub Actions workflow', link: '/github-actions' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Configuration file', link: '/reference/configuration' },
          { text: 'Recording options', link: '/reference/recording-options' },
          { text: 'Reporter options', link: '/reference/settings' },
          { text: 'CLI', link: '/reference/cli' },
          { text: 'coverage.json', link: '/coverage-json' },
          { text: 'Raw data format', link: '/reference/raw-data' },
          { text: 'Compatibility', link: '/reference/compatibility' },
          { text: 'Known limitations', link: '/reference/limitations' },
          { text: 'Contributing', link: '/reference/contributing' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: { message: 'Released under the MIT License.' },
  },
});
