import { Notice, Plugin, TAbstractFile, TFile, debounce } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  UpdateTimeOnEditSettings,
  UpdateTimeOnEditSettingsTab,
} from './Settings';
import {
  formatDate,
  getActiveFile,
  hashString,
  isExcalidrawFile,
  isFile,
  isTFile,
  normalizeIgnoreFolders,
  parseDate,
  shouldUpdateValue,
} from './utils';

interface FileChangeResult {
  status: 'ok' | 'error' | 'ignored';
  error?: any;
}

export default class UpdateTimeOnEditPlugin extends Plugin {
  settings!: UpdateTimeOnEditSettings;
  private debouncedModifyHandler?: (file: TFile) => void;
  private readonly DEBOUNCE_DELAY_MS = 3000;

  async onload(): Promise<void> {
    this.log('loading plugin IN DEV');

    await this.loadSettings();
    this.setupEventHandlers();
    this.addSettingTab(new UpdateTimeOnEditSettingsTab(this.app, this));
  }

  onunload(): void {
    this.log('unloading Update time on edit plugin');
  }

  // ==================== Settings ====================

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ==================== Event Handlers ====================

  private setupEventHandlers(): void {
    this.log('Setup handler');
    this.setupModifyHandler();
    this.setupRenameHandler();
    this.setupDeleteHandler();
  }

  private setupModifyHandler(): void {
    this.debouncedModifyHandler = debounce((file: TFile) => {
      this.log('DEBOUNCED TRIGGER');
      void this.handleFileChange(file, 'modify');
    }, this.DEBOUNCE_DELAY_MS);

    this.registerEvent(
      this.app.vault.on('modify', this.createActiveFileGuard((file) => {
        this.log('TRIGGER FROM MODIFY');
        this.debouncedModifyHandler?.(file);
      })),
    );
  }

  private setupRenameHandler(): void {
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.handleFileRename(file, oldPath);
      }),
    );
  }

  private setupDeleteHandler(): void {
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        await this.handleFileDelete(file);
      }),
    );
  }

  // ==================== File Guards ====================

  private createActiveFileGuard(fn: (file: TFile) => void) {
    return (file: TAbstractFile) => {
      if (!this.isValidActiveFile(file)) {
        return;
      }
      fn(file as TFile);
    };
  }

  private isValidActiveFile(file: TAbstractFile): boolean {
    if (!document.hasFocus()) {
      this.log('not focused');
      return false;
    }

    if (getActiveFile(this.app)?.path !== file.path) {
      this.log('not active file');
      return false;
    }

    if (!isFile(file)) {
      this.log('not a file');
      return false;
    }

    if (file.extension !== 'md') {
      this.log('not a md file');
      return false;
    }

    return true;
  }

  // ==================== File Filtering ====================

  async shouldFileBeIgnored(file: TFile): Promise<boolean> {
    if (this.isInvalidFile(file)) {
      return true;
    }

    const fileContent = await this.getFileContent(file);
    if (!fileContent) {
      return true;
    }

    if (await this.isFileUnchanged(file, fileContent)) {
      return true;
    }

    if (isExcalidrawFile(file)) {
      return true;
    }

    return this.isFileInIgnoredFolder(file);
  }

  private isInvalidFile(file: TFile): boolean {
    if (!file.path || file.extension !== 'md') {
      return true;
    }

    // Canvas files are created as 'Canvas.md',
    // so the plugin will update "frontmatter" and break the file when it gets created
    if (file.name === 'Canvas.md') {
      return true;
    }

    return false;
  }

  private async getFileContent(file: TFile): Promise<string | null> {
    try {
      const content = (await this.app.vault.read(file)).trim();
      return content.length === 0 ? null : content;
    } catch {
      return null;
    }
  }

  private async isFileUnchanged(file: TFile, fileContent: string): Promise<boolean> {
    if (!this.settings.enableExperimentalHash) {
      return false;
    }

    const cachedHash = this.settings.fileHashMap[file.path];
    if (!cachedHash) {
      return false;
    }

    const currentHash = hashString(fileContent);
    if (currentHash === cachedHash) {
      this.log('Ignoring file because, sha same');
      return true;
    }

    return false;
  }

  private isFileInIgnoredFolder(file: TFile): boolean {
    const ignores = normalizeIgnoreFolders(this.settings.ignoreGlobalFolder);
    if (!ignores) {
      return false;
    }
    return ignores.some((ignoreItem) => file.path.startsWith(ignoreItem));
  }

  private shouldIgnoreCreated(path: string): boolean {
    if (!this.settings.enableCreateTime) {
      return true;
    }
    return (this.settings.ignoreCreatedFolder || []).some((itemIgnore) =>
      path.startsWith(itemIgnore),
    );
  }

  // ==================== File Processing ====================

  async getAllFilesPossiblyAffected(): Promise<TFile[]> {
    const allFiles = this.app.vault.getMarkdownFiles();
    const result: TFile[] = [];

    for (const file of allFiles) {
      if (!(await this.shouldFileBeIgnored(file))) {
        result.push(file);
      }
    }

    return result;
  }

  async handleFileChange(
    file: TAbstractFile,
    triggerSource: 'modify' | 'bulk',
  ): Promise<FileChangeResult> {
    if (!isTFile(file)) {
      return { status: 'ignored' };
    }

    if (await this.shouldFileBeIgnored(file)) {
      return { status: 'ignored' };
    }

    try {
      await this.updateFileFrontmatter(file);
      await this.populateCacheForFile(file);
      return { status: 'ok' };
    } catch (e: any) {
      return this.handleProcessingError(e, file);
    }
  }

  private async updateFileFrontmatter(file: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(
      file,
      (frontmatter) => {
        this.updateFrontmatterFields(frontmatter, file);
      },
      { ctime: file.stat.ctime, mtime: file.stat.mtime },
    );
  }

  private updateFrontmatterFields(frontmatter: any, file: TFile): void {
    this.log('current metadata: ', frontmatter);
    this.log('current stat: ', file.stat);

    const { mTime, cTime } = this.parseFileTimes(file);
    if (!mTime || !cTime) {
      this.log('Something wrong happen, skipping');
      return;
    }

    this.updateCreatedField(frontmatter, file.path, cTime);
    this.updateModifiedField(frontmatter, mTime);
  }

  private parseFileTimes(file: TFile) {
    return {
      mTime: parseDate(file.stat.mtime, this.settings.dateFormat),
      cTime: parseDate(file.stat.ctime, this.settings.dateFormat),
    };
  }

  private updateCreatedField(frontmatter: any, filePath: string, cTime: Date): void {
    const createdKey = this.settings.headerCreated;

    if (!frontmatter[createdKey] && !this.shouldIgnoreCreated(filePath)) {
      frontmatter[createdKey] = formatDate(
        cTime,
        this.settings.dateFormat,
        this.settings.enableNumberProperties,
      );
    }
  }

  private updateModifiedField(frontmatter: any, mTime: Date): void {
    const updatedKey = this.settings.headerUpdated;
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

    if (this.shouldUpdateModifiedTime(mTime, currentMTimeOnFile)) {
      frontmatter[updatedKey] = formatDate(
        mTime,
        this.settings.dateFormat,
        this.settings.enableNumberProperties,
      );
      this.log('Update updatedKey');
      return;
    }

    this.log('Skipping updateKey');
  }

  private shouldUpdateModifiedTime(mTime: Date, currentMTime: Date): boolean {
    return shouldUpdateValue(
      mTime,
      currentMTime,
      this.settings.minMinutesBetweenSaves,
    );
  }

  private handleProcessingError(error: any, file: TFile): FileChangeResult {
    if (error?.name === 'YAMLParseError') {
      const errorMessage = `Update time on edit failed
Malformed frontmatter on this file: ${file.path}

${error.message}`;
      new Notice(errorMessage, 4000);
      console.error(errorMessage);
    }
    return { status: 'error', error };
  }

  // ==================== Cache Management ====================

  async populateCacheForFile(file: TFile): Promise<void> {
    const fileContent = await this.getFileContent(file);
    if (!fileContent) {
      return;
    }

    const sha = hashString(fileContent);
    this.settings.fileHashMap[file.path] = sha;
    await this.saveSettings();
  }

  private handleFileRename(file: TAbstractFile, oldPath: string): void {
    const hash = this.settings.fileHashMap[oldPath];
    if (!hash) {
      return;
    }

    this.settings.fileHashMap[file.path] = hash;
    delete this.settings.fileHashMap[oldPath];
    void this.saveSettings();
  }

  private async handleFileDelete(file: TAbstractFile): Promise<void> {
    const sha = this.settings.fileHashMap[file.path];
    if (!sha) {
      return;
    }

    delete this.settings.fileHashMap[file.path];
    await this.saveSettings();
  }

  // ==================== Utilities ====================

  private log(...data: any[]): void {
    if (!__DEV_MODE__) {
      return;
    }
    console.log('[UTOE]:', ...data);
  }
}
