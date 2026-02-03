import { Notice, Plugin, TAbstractFile, TFile, debounce, getFrontMatterInfo } from 'obsidian';
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
  isPathIgnored,
  normalizeIgnoreFolders,
  parseDate,
  shouldUpdateValue,
} from './utils';
import { FileWriteQueue } from './FileWriteQueue';

interface FileChangeResult {
  status: 'ok' | 'error' | 'ignored';
  error?: any;
}

export default class UpdateTimeOnEditPlugin extends Plugin {
  settings!: UpdateTimeOnEditSettings;
  private readonly DEBOUNCE_DELAY_MS = 3000;
  private readonly EDIT_IDLE_DELAY_MS = 1500;
  private readonly pendingUpdateTimers = new Map<string, number>();
  private readonly lastEditorChangeAt = new Map<string, number>();
  private settingsWriteQueue!: FileWriteQueue;
  private debouncedSaveSettings!: () => void;

  async onload(): Promise<void> {
    this.log('loading plugin IN DEV');

    await this.loadSettings();
    this.settingsWriteQueue = new FileWriteQueue();
    
    // Obsidian の debounce を使用して、高頻度な設定保存を制御
    this.debouncedSaveSettings = debounce(
      async () => await this.saveSettings(),
      1000,
      true,
    );

    this.setupEventHandlers();
    this.addSettingTab(new UpdateTimeOnEditSettingsTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.log('unloading Update time on edit plugin');
    await this.settingsWriteQueue.flushAndWait();
  }

  // ==================== Settings ====================

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * 設定をバッチ保存（デバウンス済み）
   * 高頻度な保存リクエストを1秒でまとめて1回の実際の保存にする
   * data.json の FileLocked 問題を軽減
   */
  saveSettingsBatched(): void {
    this.debouncedSaveSettings();
  }

  // ==================== Event Handlers ====================

  private setupEventHandlers(): void {
    this.log('Setup handler');
    this.setupModifyHandler();
    this.setupEditorChangeHandler();
    this.setupRenameHandler();
    this.setupDeleteHandler();
  }

  private setupModifyHandler(): void {
    this.registerEvent(
      this.app.vault.on('modify', this.createActiveFileGuard((file) => {
        this.log('TRIGGER FROM MODIFY');
        this.scheduleIdleUpdate(file, 'modify');
      })),
    );
  }

  private setupEditorChangeHandler(): void {
    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor, view) => {
        const file = view?.file;
        if (!file || file.extension !== 'md') {
          return;
        }

        this.lastEditorChangeAt.set(file.path, Date.now());

        if (this.pendingUpdateTimers.has(file.path)) {
          this.log('RESCHEDULE BECAUSE EDITING');
          this.scheduleIdleUpdate(file, 'modify');
        }
      }),
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

  private isFileBeingEdited(filePath: string): boolean {
    const lastEditAt = this.lastEditorChangeAt.get(filePath);
    if (!lastEditAt) {
      return false;
    }
    return Date.now() - lastEditAt < this.EDIT_IDLE_DELAY_MS;
  }

  private clearPendingUpdate(filePath: string): void {
    const timerId = this.pendingUpdateTimers.get(filePath);
    if (timerId) {
      window.clearTimeout(timerId);
      this.pendingUpdateTimers.delete(filePath);
    }
  }

  private scheduleIdleUpdate(
    file: TFile,
    triggerSource: 'modify' | 'bulk',
  ): void {
    this.clearPendingUpdate(file.path);

    const timerId = window.setTimeout(() => {
      this.pendingUpdateTimers.delete(file.path);

      if (this.isFileBeingEdited(file.path)) {
        this.log('EDITING IN PROGRESS, DELAYING UPDATE');
        this.scheduleIdleUpdate(file, triggerSource);
        return;
      }

      void this.handleFileChange(file, triggerSource);
    }, this.DEBOUNCE_DELAY_MS);

    this.pendingUpdateTimers.set(file.path, timerId);
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

    // Temporary files created by Obsidian start with "Untitled"
    if (file.name.startsWith("Untitled")) {
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
    const ignorePatterns = normalizeIgnoreFolders(this.settings.ignoreGlobalFolder);
    return isPathIgnored(file.path, ignorePatterns);
  }

  private shouldIgnoreCreated(path: string): boolean {
    if (!this.settings.enableCreateTime) {
      return true;
    }
    const ignorePatterns = normalizeIgnoreFolders(this.settings.ignoreGlobalFolder);
    return isPathIgnored(path, ignorePatterns);
  }

  // Returns normalized list of folders to ignore (handles legacy string setting)
  public getIgnoreFolders(): string[] {
    return normalizeIgnoreFolders(this.settings.ignoreGlobalFolder);
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
      if (this.shouldSkipWhenCursorInFrontmatter(file)) {
      // 編集中でもファイル内容のキャッシュは最新に保ちたい
      return;
    }

    await this.app.fileManager.processFrontMatter(
      file,
      (frontmatter) => {
        this.updateFrontmatterFields(frontmatter, file);
      },
      { ctime: file.stat.ctime, mtime: file.stat.mtime },
    );
  }

  private shouldSkipWhenCursorInFrontmatter(file: TFile): boolean {
      // Check if we should skip frontmatter update when cursor is in frontmatter
      if (!this.settings.skipFrontmatterWhenCursorInFrontmatter) {
      return false;
    }
    const activeFile = getActiveFile(this.app);
    if (activeFile?.path !== file.path) {
      return false;
    }
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) {
      return false;
    }
    const cursorPos = editor.getCursor();
    const { contentStart: contentStartLine } = getFrontMatterInfo(editor.getDoc().getValue());
    
    // Skip update if cursor is before contentStart (i.e., in frontmatter)
    if (cursorPos.line < contentStartLine) {
      this.log('Skipping frontmatter update because cursor is in frontmatter area');
      return true;
    }

    return false;
  }

  private getCursorAfterFrontmatter(editor: any): { line: number; ch: number } | null {
    const content = editor.getValue();
    const lines = content.split('\n');
    
    // Check if file starts with frontmatter
    if (!lines[0].startsWith('---')) {
      return { line: 0, ch: 0 };
    }

    // Find the closing frontmatter delimiter
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('---')) {
        return { line: i + 1, ch: 0 };
      }
    }

    // No closing delimiter found
    return null;
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
      );
      return;
    }

    if (this.shouldUpdateModifiedTime(mTime, currentMTimeOnFile)) {
      frontmatter[updatedKey] = formatDate(
        mTime,
        this.settings.dateFormat,
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
    this.saveSettingsBatched();
  }

  private handleFileRename(file: TAbstractFile, oldPath: string): void {
    const hash = this.settings.fileHashMap[oldPath];
    if (!hash) {
      return;
    }

    this.settings.fileHashMap[file.path] = hash;
    delete this.settings.fileHashMap[oldPath];
    this.saveSettingsBatched();
  }

  private async handleFileDelete(file: TAbstractFile): Promise<void> {
    const sha = this.settings.fileHashMap[file.path];
    if (!sha) {
      return;
    }

    delete this.settings.fileHashMap[file.path];
    this.saveSettingsBatched();
  }

  // ==================== Utilities ====================

  private log(...data: any[]): void {
    if (!__DEV_MODE__) {
      return;
    }
    console.log('[UTOE]:', ...data);
  }
}
