// Produces two files from the single-file Vite build:
//  release/mushki-woodworks.html  – full offline document (double-click to open)
//  release/artifact.html          – page content for hosting as a claude.ai Artifact
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
mkdirSync('release', { recursive: true });
writeFileSync('release/mushki-woodworks.html', html);

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const headEnd = html.indexOf('</head>');
const scriptStart = html.indexOf('<script type="module"');
const scriptEnd = html.lastIndexOf('</script>', headEnd) + '</script>'.length;
if (scriptStart < 0 || scriptStart > headEnd) throw new Error('module script not found in head');
const script = html.slice(scriptStart, scriptEnd);
if (script.slice(20, -9).includes('</script')) throw new Error('inline script contains </script');
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).trim();

const artifact = [title, ...styles, body, script].join('\n');
writeFileSync('release/artifact.html', artifact);
console.log('offline:', (html.length / 1024).toFixed(0) + ' KB', ' artifact:', (artifact.length / 1024).toFixed(0) + ' KB');
