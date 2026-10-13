# Update time on edit plugin

This plugin update on save the metadata of the file with the time it was updated, and the time of creation if there is none (useful for new files).

Here is a list of feature this plugin provides :
- Keep in sync the `mtime` (last modified time) in a property key (default to `updated`)
- Keep in sync the `ctime` (file creation time) in a property key (default to `created`)
- Customize the date format, default to obsidian date format for property display
- Supports string and number property data types, the later being useful for Unix timestamps
- Ignore folder for all update, useful for template files
- Ignore folder for the creation property
- Works on mobile & desktop

This plugin will read the `ctime` and `mtime` from obsidian, and thus, the file system. The header keys are updated only when you edit the body of a note in Obsidian. Changes from an external source (sync, other editors, AI tools) and property-only edits do not update them.

Remember to backup your vault since this plugin will modify files.

## Development

- `pnpm build`: type check and bundle `main.js`
- `pnpm test`: unit tests (Vitest)
- `pnpm test:e2e`: build, then run E2E tests against a real Obsidian with [obsidian-e2e-toolkit](https://github.com/22-2/obsidian-e2e-toolkit) (Playwright). Run `node node_modules/electron/install.js` once if Electron's binary is missing. If `ELECTRON_RUN_AS_NODE` is set in your shell, `playwright.config.ts` unsets it.
- `pnpm lint`
