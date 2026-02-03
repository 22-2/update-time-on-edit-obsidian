import { App, Modal, Setting, TFolder } from 'obsidian';
import commonPathPrefix from 'common-path-prefix';
import UpdateTimeOnSavePlugin from './main';
import { filterIgnoredFolders, normalizeIgnoreFolders, toPosixPath } from './utils';

type IgnoreRulesModalProps = {
  title: string;
  description: string;
  initialPatterns: string | string[];
  onSave: (patterns: string[]) => Promise<void>;
};

type PreviewData = {
  included: string[];
  excluded: string[];
};

export class IgnoreRulesModal extends Modal {
  private readonly plugin: UpdateTimeOnSavePlugin;
  private readonly modalTitle: string;
  private readonly description: string;
  private readonly onSaveCallback: (patterns: string[]) => Promise<void>;

  private textareaEl?: HTMLTextAreaElement;
  private includePreview?: HTMLDivElement;
  private excludePreview?: HTMLDivElement;
  private patterns: string[] = [];

  constructor(app: App, plugin: UpdateTimeOnSavePlugin, props: IgnoreRulesModalProps) {
    super(app);
    this.plugin = plugin;
    this.modalTitle = props.title;
    this.description = props.description;
    this.onSaveCallback = props.onSave;
    this.patterns = normalizeIgnoreFolders(props.initialPatterns);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('update-time-on-edit--ignore-modal');
    this.modalEl.addClass('update-time-on-edit--ignore-modal-parent');

    this.renderHeader(contentEl);
    this.renderEditor(contentEl);
    this.renderPreviewSections(contentEl);
    this.renderButtons(contentEl);
    this.refreshPreview();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderHeader(container: HTMLElement): void {
    container.createEl('h2', { text: this.modalTitle });
    container.createEl('p', { text: this.description });
  }

  private renderEditor(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: 'update-time-on-edit--ignore-modal__editor' });
    
    this.textareaEl = wrapper.createEl('textarea', {
      text: this.patterns.join('\n'),
      placeholder: 'docs/**\n!docs/keep-me.md\n# Comments are allowed',
    });
    this.textareaEl.rows = 10;
    this.textareaEl.style.width = '100%';
    this.textareaEl.addEventListener('input', () => this.refreshPreview());

    wrapper.createEl('p', {
      text: 'Use micromatch/gitignore syntax. Empty lines and lines starting with # are ignored.',
      cls: 'setting-item-description',
    });
  }

  private renderPreviewSections(container: HTMLElement): void {
    const previewWrapper = container.createDiv({ cls: 'update-time-on-edit--ignore-modal__preview' });
    
    this.includePreview = this.createPreviewSection(previewWrapper, 'Will be monitored');
    this.excludePreview = this.createPreviewSection(previewWrapper, 'Will be excluded');
  }

  private createPreviewSection(container: HTMLElement, title: string): HTMLDivElement {
    const section = container.createDiv({ cls: 'update-time-on-edit--ignore-modal__preview-section' });
    section.createEl('h3', { text: title });
    return section.createDiv({ cls: 'update-time-on-edit--ignore-modal__preview-list' });
  }

  private renderButtons(container: HTMLElement): void {
    new Setting(container)
      .addButton((btn) =>
        btn
          .setButtonText('Save')
          .setCta()
          .onClick(async () => {
            this.patterns = this.getPatternsFromInput();
            await this.onSaveCallback(this.patterns);
            this.close();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText('Cancel').onClick(() => this.close()),
      );
  }

  private getPatternsFromInput(): string[] {
    return this.textareaEl 
      ? normalizeIgnoreFolders(this.textareaEl.value)
      : this.patterns;
  }

  private refreshPreview(): void {
    const patterns = this.getPatternsFromInput();
    const preview = this.buildFolderPreview(patterns);

    this.updatePreviewList(this.includePreview, preview.included);
    this.updatePreviewList(this.excludePreview, preview.excluded);
  }

  private updatePreviewList(container: HTMLDivElement | undefined, entries: string[]): void {
    if (!container) return;
    container.replaceChildren(...this.renderPreviewList(entries));
  }

  private renderPreviewList(entries: string[]): HTMLElement[] {
    if (entries.length === 0) {
      return [this.createPlaceholderElement('None')];
    }

    if (entries.length === 1) {
      return [this.createTextElement(entries[0])];
    }

    return this.renderGroupedEntries(entries);
  }

  private createPlaceholderElement(text: string): HTMLElement {
    const el = document.createElement('div');
    el.addClass('setting-item-description');
    el.setText(text);
    return el;
  }

  private createTextElement(text: string, className?: string): HTMLElement {
    const el = document.createElement('div');
    if (className) {
      el.addClass(className);
    }
    el.setText(text);
    return el;
  }

  private renderGroupedEntries(entries: string[]): HTMLElement[] {
    const grouped = this.groupByCommonPrefix(entries);
    const elements: HTMLElement[] = [];

    for (const [prefix, items] of grouped.entries()) {
      if (prefix) {
        elements.push(
          this.createTextElement(prefix, 'update-time-on-edit--ignore-modal__preview-group-prefix')
        );
      }

      items.forEach((item) => {
        elements.push(
          this.createTextElement(item, 'update-time-on-edit--ignore-modal__preview-item')
        );
      });
    }

    return elements;
  }

  private groupByCommonPrefix(entries: string[]): Map<string, string[]> {
    if (entries.length === 0) {
      return new Map();
    }

    const sorted = [...entries].sort();
    const prefixGroup = new Map<string, string[]>();
    let i = 0;

    while (i < sorted.length) {
      const batch = this.findCommonPrefixBatch(sorted, i);
      
      if (batch.length > 1) {
        const prefix = commonPathPrefix(batch);
        const relativeItems = batch.map((item) => this.stripPrefix(item, prefix));
        prefixGroup.set(prefix, relativeItems);
      } else {
        prefixGroup.set('', batch);
      }
      
      i += batch.length;
    }

    return prefixGroup;
  }

  private findCommonPrefixBatch(sorted: string[], startIndex: number): string[] {
    const current = sorted[startIndex];
    const batch: string[] = [current];
    let j = startIndex + 1;

    while (j < sorted.length) {
      const candidate = sorted[j];
      const common = commonPathPrefix([current, candidate]);
      
      if (common && common !== current && common !== candidate) {
        batch.push(candidate);
        j++;
      } else {
        break;
      }
    }

    return batch;
  }

  private stripPrefix(fullPath: string, prefix: string): string {
    if (!prefix || !fullPath.startsWith(prefix)) {
      return fullPath;
    }
    const relative = fullPath.slice(prefix.length).replace(/^\/+/, '');
    return relative || fullPath;
  }

  private buildFolderPreview(patterns: string[]): PreviewData {
    const folders = this.collectFolderSamples();
    const ignoredSet = new Set(filterIgnoredFolders(folders, patterns));
    const excludedSet = new Set<string>();

    const included: string[] = [];
    const excluded: string[] = [];

    for (const folder of folders) {
      const label = this.getFolderLabel(folder);

      if (ignoredSet.has(folder)) {
        if (!this.hasExcludedAncestor(folder, excludedSet)) {
          excluded.push(label);
          excludedSet.add(folder);
        }
      } else {
        included.push(label);
      }
    }

    return { included, excluded };
  }

  private getFolderLabel(folder: string): string {
    return folder === '' ? '/' : folder;
  }

  private collectFolderSamples(): string[] {
    const folderSet = new Set<string>(['']);

    for (const item of this.plugin.app.vault.getMarkdownFiles()) {
      if (item instanceof TFolder) {
        folderSet.add(toPosixPath(item.path));
      } else {
        folderSet.add(this.extractFolderPath(item.path));
      }
    }

    return Array.from(folderSet).sort((a, b) => a.localeCompare(b));
  }

  private extractFolderPath(filePath: string): string {
    const normalized = toPosixPath(filePath);
    const lastSlashIndex = normalized.lastIndexOf('/');
    return lastSlashIndex === -1 ? '' : normalized.substring(0, lastSlashIndex);
  }

  private hasExcludedAncestor(folder: string, excludedSet: Set<string>): boolean {
    if (!folder) return false;

    const parts = folder.split('/');
    
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      if (excludedSet.has(ancestor)) {
        return true;
      }
    }

    return false;
  }
}
