import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'e2e',
		'playwright.config.ts',
		'.e2e-plugin',
		'obsidian-e2e-toolkit-assets',
		'playwright-report',
		'test-results',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'vitest.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// テストと設定ファイルは Obsidian の外（Node 上の Vitest）で動く。
		// window が無いためタイマーや globalThis を直接使い、Obsidian の TFile はモックの実体を型だけ合わせて使う。
		files: ['src/**/*.test.ts', 'test/**/*.ts', 'vitest.config.mts'],
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/no-tfile-tfolder-cast': 'off',
		},
	},
);
