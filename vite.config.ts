import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { familyApi } from './server/api';

// The real family lives in data/, a folder this public repository ignores.
// Without it — a fresh clone, CI — the app shows the made-up sample family.
// FAMILY_DIR points anywhere else: `FAMILY_DIR=sample`.
const root = fileURLToPath(new URL('.', import.meta.url));
const familyDir = process.env.FAMILY_DIR
  ? path.resolve(process.env.FAMILY_DIR)
  : path.join(root, existsSync(path.join(root, 'data/family.md')) ? 'data' : 'sample');

// The short commit of the family repository, `-dirty` with uncommitted edits.
// Only a family folder that is a repository of its own has one — the sample
// would otherwise report this repository's commit.
function familyCommit(dir: string): string {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  try {
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync(dir)) return '';
    const commit = git('rev-parse', '--short', 'HEAD');
    return git('status', '--porcelain') ? `${commit}-dirty` : commit;
  } catch {
    // No git, or a repository without a first commit yet.
    return '';
  }
}

// `npm run dev` serves the same api/family and api/edits the production server
// does, so the family can be edited locally too. The made-up sample ships with
// this repository, so it stays read-only unless STAMMBAUM_EDIT=1 says otherwise.
function familyApiPlugin(): Plugin {
  const sample = path.join(root, 'sample');
  const writable = process.env.STAMMBAUM_EDIT === '1' || path.resolve(familyDir) !== sample;
  const api = familyApi({ dataDir: familyDir, user: () => 'local', editors: [], writable });
  return {
    name: 'stammbaum-family-api',
    configureServer: (server) => void server.middlewares.use(api),
    configurePreviewServer: (server) => void server.middlewares.use(api),
  };
}

// The hosted app reads the family live from the server (`src/source/live.ts`)
// and carries none of it in its files. `--mode single` produces one
// self-contained dist-single/index.html with the family, script, styles and photos
// inlined (`src/source/bundled.ts`), so it can be mailed around and opened offline.
export default defineConfig(({ mode }) => ({
  base: './',
  // Printed under the tree, so a build that has gone stale is easy to spot.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __FAMILY_COMMIT__: JSON.stringify(familyCommit(familyDir)),
    // STAMMBAUM_FLAGS=off: country names without flags, and no flag font in the build.
    __FLAGS__: JSON.stringify(process.env.STAMMBAUM_FLAGS !== 'off'),
  },
  resolve: {
    alias: {
      '@family': familyDir,
      '@source': path.join(root, 'src/source', mode === 'single' ? 'bundled.ts' : 'live.ts'),
    },
  },
  server: {
    // A FAMILY_DIR outside the project still has to be served in dev.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), familyDir] },
  },
  build: {
    // A folder of its own, so building the single file leaves the hosted dist/ alone.
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    // Inline every photo as a data: URI in single-file mode.
    assetsInlineLimit: mode === 'single' ? 100 * 1024 * 1024 : 4096,
    target: 'es2022',
  },
  plugins: mode === 'single' ? [tailwindcss(), viteSingleFile()] : [tailwindcss(), familyApiPlugin()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
