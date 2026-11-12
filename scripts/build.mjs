// Copies app/ to dist/ and stamps the build: the git sha in <meta name="build"> and in the footer (R6),
// and the session into config.js. The session never goes into git.
// Usage: node scripts/build.mjs [sha]   sha: default $GITHUB_SHA, else git HEAD
//        session: $SESSION, else ../session.local.txt
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sha = process.argv[2] || process.env.GITHUB_SHA || execSync('git rev-parse HEAD').toString().trim();
const session =
  process.env.SESSION || (existsSync('../session.local.txt') ? readFileSync('../session.local.txt', 'utf8').trim() : '');
if (!session) throw new Error('No session: set SESSION (a repo secret in CI).');

rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
const stamp = (file, from, to) => writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to));
stamp('dist/index.html', '__BUILD_SHA__', sha);
stamp('dist/config.js', '__SESSION__', session);
console.log(`built dist/ at ${sha}`);
