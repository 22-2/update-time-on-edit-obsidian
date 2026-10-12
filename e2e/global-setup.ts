import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export const PLUGIN_ID = 'update-time-on-edit';
export const PLUGIN_DIR = path.resolve('.e2e-plugin');

// リポジトリ直下には node_modules などがあるため、
// vault へ投入する分（manifest.json・main.js・styles.css）だけを別のフォルダへ集める。
// main.js は `pnpm build` の成果物を使う。
export default async function globalSetup(): Promise<void> {
  await rm(PLUGIN_DIR, { recursive: true, force: true });
  await mkdir(PLUGIN_DIR, { recursive: true });
  for (const name of ['manifest.json', 'main.js', 'styles.css']) {
    await cp(path.resolve(name), path.join(PLUGIN_DIR, name));
  }
}
