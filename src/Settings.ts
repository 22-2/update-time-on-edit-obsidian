import { App, PluginSettingTab, Setting } from 'obsidian';
import UpdateTimeOnSavePlugin from './main';
import { format } from 'date-fns';
import { UpdateAllModal } from './UpdateAllModal';
import { UpdateAllCacheData } from './UpdateAllCacheData';
import { IgnoreRulesModal } from './IgnoreRulesModal';
import { normalizeIgnoreFolders } from './utils';

export interface UpdateTimeOnEditSettings {
  dateFormat: string;
  enableNumberProperties: boolean;
  enableCreateTime: boolean;
  headerUpdated: string;
  headerCreated: string;
  minMinutesBetweenSaves: number;
  // Union because of legacy
  ignoreGlobalFolder?: string | string[];
  ignoreCreatedFolder?: string | string[];

  enableExperimentalHash?: boolean;
  fileHashMap: Record<string, string>;
}

export const DEFAULT_SETTINGS: UpdateTimeOnEditSettings = {
  dateFormat: "yyyy-MM-dd'T'HH:mm",
  enableNumberProperties: false,
  enableCreateTime: true,
  headerUpdated: 'updated',
  headerCreated: 'created',
  minMinutesBetweenSaves: 1,
  ignoreGlobalFolder: [],
  ignoreCreatedFolder: [],
  enableExperimentalHash: true,
  fileHashMap: {},
};

export class UpdateTimeOnEditSettingsTab extends PluginSettingTab {
  plugin: UpdateTimeOnSavePlugin;

  constructor(app: App, plugin: UpdateTimeOnSavePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl('h2', { text: 'Global settings' });

    this.addExcludedFoldersSetting();
    this.addTimeBetweenUpdates();
    this.addDateFormat();
    // this.addEnableNumberProperties();

    // new Setting(this.containerEl)
    //   .setName('Update all files')
    //   .setDesc(
    //     'This plugin will only work on new files, but if you want to update all files in your vault at once, you can do it here.',
    //   )
    //   .addButton((cb) => {
    //     cb.setButtonText('Update all files').onClick(() => {
    //       new UpdateAllModal(this.app, this.plugin).open();
    //     });
    //   });

    containerEl.createEl('h2', { text: 'Updated at' });

    this.addFrontMatterUpdated();

    containerEl.createEl('h2', { text: 'Created at' });

    this.addEnableCreated();
    this.addFrontMatterCreated();
    this.addExcludedCreatedFoldersSetting();

    containerEl.createEl('h2', { text: 'Experimental settings' });

    new Setting(this.containerEl)
      .setName('Enable hash matcher')
      .setDesc(
        'Using a hash system to prevent too many updates happening, especially with sync.',
      )
      .addToggle((cb) =>
        cb
          .setValue(this.plugin.settings.enableExperimentalHash ?? true)
          .onChange(async (newValue) => {
            this.plugin.settings.enableExperimentalHash = newValue;
            await this.saveSettings();
          }),
      )
      .addButton((cb) =>
        cb.setButtonText('Fill initial cache').onClick(() => {
          new UpdateAllCacheData(this.app, this.plugin).open();
        }),
      );
  }

  async saveSettings() {
    await this.plugin.saveSettings();
  }

  addDateFormat(): void {
    this.createDateFormatEditor({
      getValue: () => this.plugin.settings.dateFormat,
      name: 'Date format',
      description: 'The date format for read and write',
      setValue: (newValue) => (this.plugin.settings.dateFormat = newValue),
    });
  }

  createDateFormatEditor({
    description,
    name,
    getValue,
    setValue,
  }: DateFormatArgs) {
    const createDoc = () => {
      const descr = document.createDocumentFragment();
      descr.append(
        description,
        descr.createEl('br'),
        'Check ',
        descr.createEl('a', {
          href: 'https://date-fns.org/v2.25.0/docs/format',
          text: 'date-fns documentation',
        }),
        descr.createEl('br'),
        `Currently: ${format(new Date(), getValue())}`,
        descr.createEl('br'),
        `Obsidian default format for date properties: yyyy-MM-dd'T'HH:mm`,
      );
      return descr;
    };
    let dformat = new Setting(this.containerEl)
      .setName(name)
      .setDesc(createDoc())
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.dateFormat)
          .setValue(getValue())
          .onChange(async (value) => {
            setValue(value);
            dformat.setDesc(createDoc());
            await this.saveSettings();
          }),
      );
  }

  addEnableNumberProperties(): void {
    new Setting(this.containerEl)
      .setName('Enable number property type')
      .setDesc(
        'Assigns numbers to date properties (instead of strings) when using numeric formats, like Unix timestamps.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableNumberProperties)
          .onChange(async (newValue) => {
            this.plugin.settings.enableNumberProperties = newValue;
            await this.saveSettings();
          }),
      );
  }

  addTimeBetweenUpdates(): void {
    new Setting(this.containerEl)
      .setName('Minimum number of minutes between update')
      .setDesc('If your files are updating too often, increase this.')
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.minMinutesBetweenSaves)
          .onChange(async (value) => {
            this.plugin.settings.minMinutesBetweenSaves = value;
            await this.saveSettings();
          })
          .setDynamicTooltip(),
      );
  }

  addEnableCreated(): void {
    new Setting(this.containerEl)
      .setName('Enable the created front matter key update')
      .setDesc('Currently, it is set to now if not present')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCreateTime)
          .onChange(async (newValue) => {
            this.plugin.settings.enableCreateTime = newValue;
            await this.saveSettings();
            this.display();
          }),
      );
  }

  addFrontMatterUpdated(): void {
    new Setting(this.containerEl)
      .setName('Front matter updated name')
      .setDesc('The key in the front matter yaml for the update time.')
      .addText((text) =>
        text
          .setPlaceholder('updated')
          .setValue(this.plugin.settings.headerUpdated ?? '')
          .onChange(async (value) => {
            this.plugin.settings.headerUpdated = value;
            await this.saveSettings();
          }),
      );
  }

  addFrontMatterCreated(): void {
    if (!this.plugin.settings.enableCreateTime) {
      return;
    }
    new Setting(this.containerEl)
      .setName('Front matter created name')
      .setDesc('The key in the front matter yaml for the creation time')
      .addText((text) =>
        text
          .setPlaceholder('updated')
          .setValue(this.plugin.settings.headerCreated ?? '')
          .onChange(async (value) => {
            this.plugin.settings.headerCreated = value;
            await this.saveSettings();
          }),
      );
  }

  addExcludedCreatedFoldersSetting(): void {
    if (!this.plugin.settings.enableCreateTime) {
      return;
    }
    const patterns = normalizeIgnoreFolders(this.plugin.settings.ignoreCreatedFolder);

    const setting = new Setting(this.containerEl)
      .setName('Exclude rules for created property')
      .setDesc(
        'Files matching these gitignore-style patterns will skip created front matter updates.',
      )
      .addButton((btn) =>
        btn.setButtonText('Edit rules').onClick(() => {
          new IgnoreRulesModal(this.app, this.plugin, {
            title: 'Edit created exclusion rules',
            description:
              'One pattern per line. Use !pattern to re-include and # for comments.',
            initialPatterns: this.plugin.settings.ignoreCreatedFolder ?? [],
            onSave: async (newValue) => {
              this.plugin.settings.ignoreCreatedFolder = newValue;
              await this.saveSettings();
              this.display();
            },
          }).open();
        }),
      );

    this.renderPatternsSummary(patterns, setting.settingEl);
  }

  addExcludedFoldersSetting(): void {
    const patterns = this.plugin.getIgnoreFolders();

    const setting = new Setting(this.containerEl)
      .setName('Exclude rules for all updates')
      .setDesc(
        'Gitignore-style patterns. Matching files are ignored for both updated and created timestamps.',
      )
      .addButton((btn) =>
        btn.setButtonText('Edit rules').onClick(() => {
          new IgnoreRulesModal(this.app, this.plugin, {
            title: 'Edit exclusion rules',
            description:
              'One pattern per line. Use !pattern to re-include and # for comments.',
            initialPatterns: this.plugin.settings.ignoreGlobalFolder ?? [],
            onSave: async (newValue) => {
              this.plugin.settings.ignoreGlobalFolder = newValue;
              await this.saveSettings();
              this.display();
            },
          }).open();
        }),
      );

    this.renderPatternsSummary(patterns, setting.settingEl);
  }

  private renderPatternsSummary(patterns: string[], container: HTMLElement): void {
    const summary = container.createDiv({ cls: 'setting-item-description' });

    if (patterns.length === 0) {
      summary.setText('No exclude rules set. All folders are monitored.');
      return;
    }

    const preview = patterns.slice(0, 3).join(', ');
    const suffix = patterns.length > 3 ? `, +${patterns.length - 3} more` : '';
    summary.setText(`Rules (${patterns.length}): ${preview}${suffix}`);
  }
}

type DateFormatArgs = {
  getValue: () => string;
  setValue: (newValue: string) => void;
  name: string;
  description: string;
};
