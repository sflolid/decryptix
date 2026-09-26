// Bundles the Vite build (dist/) into a single self-contained HTML page with
// CSS and JS inlined, for hosting as a claude.ai Artifact preview.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const asset = (href) => readFileSync(join(dist, href.replace(/^\.?\//, '')), 'utf8');

const title = html.match(/<title>(.*?)<\/title>/s)[1];
// Remote stylesheets (Google Fonts) stay as links; the viewer's CSP allows them.
const fontLinks = [...html.matchAll(/<link[^>]+href="https:\/\/fonts\.googleapis\.com[^"]*"[^>]*>/gs)].map((m) => m[0]);
const cssHref = html.match(/<link[^>]+rel="stylesheet"[^>]+href="(\.?\/[^"]+)"/)[1];
const jsSrc = html.match(/<script[^>]+src="([^"]+)"/)[1];
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .trim();

const js = asset(jsSrc).replace(/<\/script/gi, '<\\/script');

const out = `<title>${title}</title>
${fontLinks.join('\n')}
<style>
${asset(cssHref)}
</style>
${body}
<script type="module">
${js}
</script>
`;

writeFileSync(join(dist, 'artifact.html'), out);
console.log(`Wrote ${join(dist, 'artifact.html')} (${(out.length / 1024).toFixed(1)} KB)`);
