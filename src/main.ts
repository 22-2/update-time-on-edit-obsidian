import { Editor, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  type UpdateTimeOnEditSettings,
  UpdateTimeOnEditSettingsTab,
} from './Settings';
import {
  formatDate,
  getActiveFile,
  hashBody,
  isExcalidrawFile,
  isPathIgnored,
  normalizeIgnoreFolders,
  parseDate,
  shouldUpdateValue,
  type DateValue,
} from './utils';

interface FileChangeResult {
  status: 'ok' | 'error' | 'ignored';
  error?: unknown;
}

type FrontMatter = Record<string, unknown>;

// 旧版が data.json に保存していたハッシュ。今はメモリにだけ持つので、読み込み時に捨てる
type LoadedData = Partial<UpdateTimeOnEditSettings> & { fileHashMap?: unknown };

// frontmatter の値のうち、日付として解釈できる型だけを取り出す
function toDateValue(value: unknown): DateValue | undefined {
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return undefined;
}

class UpdateCancelledError extends Error {}

export default class UpdateTimeOnEditPlugin extends Plugin {
  declare settings: UpdateTimeOnEditSettings;
  private readonly DEBOUNCE_DELAY_MS = 3000;
  private readonly EDIT_IDLE_DELAY_MS = 1500;
  private readonly USER_INPUT_WINDOW_MS = 10000;
  private lastUserInputAt = 0;
  private readonly pendingUpdateTimers = new Map<string, number>();
  private readonly lastEditorChangeAt = new Map<string, number>();
  // パス → 本文のハッシュ。「この端末のユーザーが書いたものではない、最後に確認した本文」を表す。
  // 起動をまたいで残す必要が無く、保存すると同期の競合の原因になるため、メモリにだけ持つ。
  private readonly baselineHashes = new Map<string, string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.log('loading plugin');

    this.setupEventHandlers();
    this.addSettingTab(new UpdateTimeOnEditSettingsTab(this.app, this));
    // 起動時に復元されたタブで file-open が発火するとは限らないため、アクティブなファイルを拾う
    this.app.workspace.onLayoutReady(() => {
      const file = getActiveFile(this.app);
      if (file) {
        void this.ensureBaseline(file);
      }
    });
  }

  onunload(): void {
    this.log('unloading Update time on edit plugin');
    for (const filePath of this.pendingUpdateTimers.keys()) {
      this.clearPendingUpdate(filePath);
    }
  }

  // ==================== Settings ====================

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as LoadedData | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    if (loaded && 'fileHashMap' in loaded) {
      delete (this.settings as LoadedData).fileHashMap;
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ==================== Event Handlers ====================

  private setupEventHandlers(): void {
    this.log('Setup handler');
    this.setupUserInputTracking();
    this.setupModifyHandler();
    this.setupEditorChangeHandler();
    this.setupFileOpenHandler();
    this.setupRenameHandler();
    this.setupDeleteHandler();
  }

  private setupModifyHandler(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile) || this.isInvalidFile(file)) {
          return;
        }
        // 外部（同期・AIなど）からの編集は、更新日時の対象にせず基準だけを新しい本文に合わせる。
        // 合わせないと、その後のプロパティだけの編集で更新されてしまう。
        if (!this.hasRecentUserInput()) {
          void this.refreshBaselineIfTracked(file);
          return;
        }
        if (!this.isValidActiveFile(file)) {
          return;
        }
        this.log('TRIGGER FROM MODIFY');
        this.scheduleIdleUpdate(file);
      }),
    );
  }

  private setupEditorChangeHandler(): void {
    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor, view) => {
        const file = view?.file;
        if (!file || !this.isValidActiveFile(file)) {
          return;
        }

        this.lastEditorChangeAt.set(file.path, Date.now());

        if (this.pendingUpdateTimers.has(file.path)) {
          this.log('RESCHEDULE BECAUSE EDITING');
          this.scheduleIdleUpdate(file);
        }
      }),
    );
  }

  private setupFileOpenHandler(): void {
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file) {
          void this.ensureBaseline(file);
        }
      }),
    );
  }

  /**
   * 基準が無いファイルは、開いた時点の内容を基準として記録する。
   * 記録が無いと、未編集でも最初の保存で必ず更新対象になってしまうため。
   */
  private async ensureBaseline(file: TFile): Promise<void> {
    if (!this.settings.enableExperimentalHash) {
      return;
    }
    if (this.isInvalidFile(file) || this.baselineHashes.has(file.path)) {
      return;
    }
    await this.recordBaseline(file);
  }

  private async refreshBaselineIfTracked(file: TFile): Promise<void> {
    if (!this.settings.enableExperimentalHash || !this.baselineHashes.has(file.path)) {
      return;
    }
    await this.recordBaseline(file);
  }

  private setupRenameHandler(): void {
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.moveBaseline(oldPath, file.path);
      }),
    );
  }

  private setupDeleteHandler(): void {
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.baselineHashes.delete(file.path);
      }),
    );
  }

  // ==================== File Guards ====================

  // activeDocument は設定などの別ウィンドウを指すことがあるため、
  // アクティブなマークダウンのタブ自身の document を使う（ポップアウトにも対応）
  private getActiveViewDocument(): Document | undefined {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.containerEl.ownerDocument;
  }

  private isValidActiveFile(file: TFile): boolean {
    if (this.isInvalidFile(file)) {
      this.log('not a vault markdown file');
      return false;
    }

    if (!this.getActiveViewDocument()?.hasFocus()) {
      this.log('not focused');
      return false;
    }

    if (getActiveFile(this.app) !== file) {
      this.log('not active file');
      return false;
    }

    // 開いたまま外部（AIなど）から編集された場合は modify だけが発火するので、
    // 直前にユーザー入力がなければ更新しない
    if (!this.hasRecentUserInput()) {
      this.log('no recent user input (external edit?)');
      return false;
    }

    return true;
  }

  private hasRecentUserInput(): boolean {
    return Date.now() - this.lastUserInputAt < this.USER_INPUT_WINDOW_MS;
  }

  private setupUserInputTracking(): void {
    // Obsidian の自動保存は入力の数秒後に走るため、窓は保存遅延より長くする
    const trackDocument = (doc: Document) => {
      const markInput = () => {
        const file = getActiveFile(this.app);
        if (
          doc !== this.getActiveViewDocument() || !doc.hasFocus() || !file ||
          this.isInvalidFile(file)
        ) {
          return;
        }
        this.lastUserInputAt = Date.now();
      };
      this.registerDomEvent(doc, 'beforeinput', markInput, true);
      this.registerDomEvent(doc, 'keydown', markInput, true);
    };

    trackDocument(document);
    // ポップアウトウィンドウは別の document を持つので、開くたびに追加する
    this.registerEvent(
      this.app.workspace.on('window-open', (_workspaceWindow, win) => {
        trackDocument(win.document);
      }),
    );
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

  private scheduleIdleUpdate(file: TFile): void {
    this.clearPendingUpdate(file.path);

    const timerId = window.setTimeout(() => {
      this.pendingUpdateTimers.delete(file.path);

      if (this.isFileBeingEdited(file.path)) {
        this.log('EDITING IN PROGRESS, DELAYING UPDATE');
        this.scheduleIdleUpdate(file);
        return;
      }

      // 予約から実行までの間にフォーカスやアクティブファイルが変わることがあるため、
      // 実行時にも再確認する
      if (!this.isValidActiveFile(file)) {
        this.log('CONDITIONS CHANGED, CANCEL UPDATE');
        return;
      }

      void this.handleFileChange(file);
    }, this.DEBOUNCE_DELAY_MS);

    this.pendingUpdateTimers.set(file.path, timerId);
  }

  // ==================== File Filtering ====================

  // 読み込みの要らない判定を先に行い、無視するファイルの本文は読まない
  async shouldFileBeIgnored(file: TFile): Promise<boolean> {
    if (this.isInvalidFile(file) || isExcalidrawFile(file)) {
      return true;
    }
    if (this.isPathInIgnoredFolder(file.path)) {
      return true;
    }

    const fileContent = await this.getFileContent(file);
    if (!fileContent) {
      return true;
    }

    return this.isFileUnchanged(file, fileContent);
  }

  private isInvalidFile(file: TFile): boolean {
    if (!file.path || file.extension !== 'md') {
      return true;
    }

    // 外部ファイルも仮想 TFile として vault に登録されることがある。
    // file: URI・絶対パス・親への参照は vault 相対パスではないため除外する。
    if (
      /^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(file.path) ||
      file.path.split(/[/\\]/).includes('..')
    ) {
      return true;
    }
    if (
      file.vault !== this.app.vault ||
      this.app.vault.getAbstractFileByPath(file.path) !== file
    ) {
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

  private isFileUnchanged(file: TFile, fileContent: string): boolean {
    if (!this.settings.enableExperimentalHash) {
      return false;
    }

    const baselineHash = this.baselineHashes.get(file.path);
    if (!baselineHash) {
      return false;
    }

    if (hashBody(fileContent) === baselineHash) {
      this.log('Ignoring file because, sha same');
      return true;
    }

    return false;
  }

  private isPathInIgnoredFolder(path: string): boolean {
    const ignorePatterns = normalizeIgnoreFolders(this.settings.ignoreGlobalFolder);
    return isPathIgnored(path, ignorePatterns);
  }

  private shouldIgnoreCreated(path: string): boolean {
    return !this.settings.enableCreateTime || this.isPathInIgnoredFolder(path);
  }

  // ==================== File Processing ====================

  async handleFileChange(file: TFile): Promise<FileChangeResult> {
    if (!this.isValidActiveFile(file)) {
      return { status: 'ignored' };
    }

    if (await this.shouldFileBeIgnored(file)) {
      return { status: 'ignored' };
    }

    // 内容の読み取りを待つ間にフォーカスが変わる場合もある。
    if (!this.isValidActiveFile(file)) {
      return { status: 'ignored' };
    }

    try {
      await this.updateFileFrontmatter(file);
      await this.recordBaseline(file);
      return { status: 'ok' };
    } catch (e: unknown) {
      if (e instanceof UpdateCancelledError) {
        return { status: 'ignored' };
      }
      return this.handleProcessingError(e, file);
    }
  }

  private async updateFileFrontmatter(file: TFile): Promise<void> {
    if (this.shouldSkipWhenCursorInFrontmatter(file)) {
      // 編集中でも基準は最新に保ちたい
      return;
    }

    await this.app.fileManager.processFrontMatter(
      file,
      (frontmatter) => {
        // processFrontMatter 内の非同期読み取り後にも書き込み条件を確認する。
        if (!this.isValidActiveFile(file)) {
          // コールバックを抜けるだけでは再保存され得るため、処理自体を中断する。
          throw new UpdateCancelledError();
        }
        // Obsidian はフロントマターを常にオブジェクトとして渡す
        this.updateFrontmatterFields(frontmatter as FrontMatter, file);
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
    const cursorAfterFrontmatter = this.getCursorAfterFrontmatter(editor);
    
    // Skip update if cursor is before contentStart (i.e., in frontmatter)
    if (cursorAfterFrontmatter && cursorPos.line < cursorAfterFrontmatter.line) {
      this.log('Skipping frontmatter update because cursor is in frontmatter area');
      return true;
    }

    return false;
  }

  private getCursorAfterFrontmatter(editor: Editor): { line: number; ch: number } | null {
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

  private updateFrontmatterFields(frontmatter: FrontMatter, file: TFile): void {
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

  private updateCreatedField(frontmatter: FrontMatter, filePath: string, cTime: Date): void {
    const createdKey = this.settings.headerCreated;

    if (!frontmatter[createdKey] && !this.shouldIgnoreCreated(filePath)) {
      frontmatter[createdKey] = formatDate(
        cTime,
        this.settings.dateFormat,
      );
    }
  }

  private updateModifiedField(frontmatter: FrontMatter, mTime: Date): void {
    const updatedKey = this.settings.headerUpdated;
    const currentMTimeOnFile = parseDate(
      toDateValue(frontmatter[updatedKey]),
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

  private handleProcessingError(error: unknown, file: TFile): FileChangeResult {
    if (error instanceof Error && error.name === 'YAMLParseError') {
      const errorMessage = `Update time on edit failed
Malformed frontmatter on this file: ${file.path}

${error.message}`;
      new Notice(errorMessage, 4000);
      console.error(errorMessage);
    }
    return { status: 'error', error };
  }

  // ==================== Baseline Management ====================

  private async recordBaseline(file: TFile): Promise<void> {
    if (!this.settings.enableExperimentalHash) {
      return;
    }
    const fileContent = await this.getFileContent(file);
    if (!fileContent) {
      return;
    }

    this.baselineHashes.set(file.path, hashBody(fileContent));
  }

  // フォルダの改名では子ファイルの基準が残らないが、次に開いた時に作り直されるので問題ない
  private moveBaseline(oldPath: string, newPath: string): void {
    const hash = this.baselineHashes.get(oldPath);
    if (!hash) {
      return;
    }

    this.baselineHashes.set(newPath, hash);
    this.baselineHashes.delete(oldPath);
  }

  // ==================== Utilities ====================

  private log(...data: unknown[]): void {
    if (!this.settings.debugLogging) {
      return;
    }
    console.debug('[UTOE]:', ...data);
  }
}
