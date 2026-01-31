import { Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  UpdateTimeOnEditSettings,
  UpdateTimeOnEditSettingsTab,
} from './Settings';
import { formatDate, getActiveFile, hashString, isExcalidrawFile, isFile, isTFile, normalizeIgnoreFolders, parseDate, shouldUpdateValue } from './utils';

export default class UpdateTimeOnSavePlugin extends Plugin {
  // @ts-expect-error the settings are hot loaded at init
  settings: UpdateTimeOnEditSettings;

  activeMdFileGuard(fn: (file: TFile) => void) {
    return (file: TAbstractFile) => {
      if (!document.hasFocus()) {
        return this.log('not focued');
      }
      if (getActiveFile()?.path !== file.path) {
        return this.log('not active file');
      }
      if (!isFile(file)) {
        return this.log('not a file');
      }
      if (file.extension !== 'md') {
        return this.log('not a md file');
      }
      fn(file);
    };
  }

  async onload() {
    this.log('loading plugin IN DEV');

    await this.loadSettings();

    this.setupOnEditHandler();

    this.addSettingTab(new UpdateTimeOnEditSettingsTab(this.app, this));
  }

  async shouldFileBeIgnored(file: TFile): Promise<boolean> {
    if (!file.path) {
      return true;
    }
    if (file.extension != 'md') {
      return true;
    }
    // Canvas files are created as 'Canvas.md',
    // so the plugin will update "frontmatter" and break the file when it gets created
    if (file.name == 'Canvas.md') {
      return true;
    }

    const fileContent = (await this.app.vault.read(file)).trim();

    if (fileContent.length === 0) {
      return true;
    }

    if (this.settings.enableExperimentalHash) {
      const maybeHash = this.settings.fileHashMap[file.path];
      if (maybeHash) {
        const sha = hashString(fileContent);
        if (sha === maybeHash) {
          this.log('Ignoring file because, sha same');
          return true;
        }
      }
    }

    if (isExcalidrawFile(file)) {
      // TODO: maybe add a setting to enable it if users want to have the keys works there
      return true;
    }

    const ignores = normalizeIgnoreFolders(this.settings.ignoreGlobalFolder);
    if (!ignores) {
      return false;
    }

    return ignores.some((ignoreItem) => file.path.startsWith(ignoreItem));
  }

  shouldIgnoreCreated(path: string): boolean {
    if (!this.settings.enableCreateTime) {
      return true;
    }
    return (this.settings.ignoreCreatedFolder || []).some((itemIgnore) =>
      path.startsWith(itemIgnore),
    );
  }

  async getAllFilesPossiblyAffected() {
    const allFiles = this.app.vault.getMarkdownFiles();
    const result = [];

    for (const file of allFiles) {
      if (!(await this.shouldFileBeIgnored(file))) {
        result.push(file);
      }
    }

    return result;
  }

  async populateCacheForFile(file: TFile): Promise<void> {
    const fileContent = (await this.app.vault.read(file)).trim();
    const sha = hashString(fileContent);
    this.settings.fileHashMap[file.path] = sha;
    await this.saveSettings();
  }

  async handleFileChange(
    file: TAbstractFile,
    triggerSource: 'modify' | 'bulk',
  ): Promise<
    { status: 'ok' } | { status: 'error'; error: any } | { status: 'ignored' }
  > {
    if (!isTFile(file)) {
      return { status: 'ignored' };
    }

    if (await this.shouldFileBeIgnored(file)) {
      return { status: 'ignored' };
    }

    try {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter) => {
          this.log('current metadata: ', frontmatter);
          this.log('current stat: ', file.stat);
          const updatedKey = this.settings.headerUpdated;
          const createdKey = this.settings.headerCreated;

          const mTime = parseDate(file.stat.mtime, this.settings.dateFormat);
          const cTime = parseDate(file.stat.ctime, this.settings.dateFormat);

          if (!mTime || !cTime) {
            this.log('Something wrong happen, skipping');
            return;
          }

          if (!frontmatter[createdKey]) {
            if (!this.shouldIgnoreCreated(file.path)) {
              frontmatter[createdKey] = formatDate(
                cTime,
                this.settings.dateFormat,
                this.settings.enableNumberProperties,
              );
            }
          }

          const currentMTimeOnFile = parseDate(
            frontmatter[updatedKey],
            this.settings.dateFormat,
          );

          if (!frontmatter[updatedKey] || !currentMTimeOnFile) {
            this.log('Update updatedKey');
            frontmatter[updatedKey] = formatDate(
              mTime,
              this.settings.dateFormat,
              this.settings.enableNumberProperties,
            );
            return;
          }

          if (
            shouldUpdateValue(
              mTime,
              currentMTimeOnFile,
              this.settings.minMinutesBetweenSaves,
            )
          ) {
            frontmatter[updatedKey] = formatDate(
              mTime,
              this.settings.dateFormat,
              this.settings.enableNumberProperties,
            );
            this.log('Update updatedKey');
            return;
          }
          this.log('Skipping updateKey');
        },
        { ctime: file.stat.ctime, mtime: file.stat.mtime },
      );
      await this.populateCacheForFile(file);
    } catch (e: any) {
      if (e?.name === 'YAMLParseError') {
        const errorMessage = `Update time on edit failed
Malformed frontamtter on this file : ${file.path}

${e.message}`;
        new Notice(errorMessage, 4000);
        console.error(errorMessage);
        return {
          status: 'error',
          error: e,
        };
      }
    }
    return {
      status: 'ok',
    };
  }

  setupOnEditHandler() {
    this.log('Setup handler');

    this.registerEvent(
      this.app.vault.on(
        'modify',
        this.activeMdFileGuard((file) => {
          this.log('TRIGGER FROM MODIFY');
          return this.handleFileChange(file, 'modify');
        }),
      ),
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        const hash = this.settings.fileHashMap[oldPath];
        if (!hash) {
          return;
        }
        this.settings.fileHashMap[file.path] = hash;
        delete this.settings.fileHashMap[oldPath];
        this.saveSettings();
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        const sha = this.settings.fileHashMap[file.path];
        if (!sha) {
          return;
        }
        delete this.settings.fileHashMap[file.path];
        this.saveSettings();
      }),
    );
  }

  onunload() {
    this.log('unloading Update time on edit plugin');
  }

  log(...data: any[]) {
    if (!__DEV_MODE__) {
      return;
    }
    console.log('[UTOE]:', ...data);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
