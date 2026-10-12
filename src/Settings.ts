import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import UpdateTimeOnSavePlugin from './main';
import { UpdateAllCacheData } from './UpdateAllCacheData';
import { IgnoreRulesModal } from './IgnoreRulesModal';
import { moment } from './utils';

export interface UpdateTimeOnEditSettings {
  dateFormat: string;
  enableCreateTime: boolean;
  headerUpdated: string;
  headerCreated: string;
  minMinutesBetweenSaves: number;
  // Union because of legacy
  ignoreGlobalFolder?: string | string[];

  enableExperimentalHash?: boolean;
  fileHashMap: Record<string, string>;
  skipFrontmatterWhenCursorInFrontmatter?: boolean;
  debugLogging?: boolean;
}

export const DEFAULT_SETTINGS: UpdateTimeOnEditSettings = {
  dateFormat: 'YYYY-MM-DDTHH:mm',
  enableCreateTime: true,
  headerUpdated: 'updated',
  headerCreated: 'created',
  minMinutesBetweenSaves: 1,
  ignoreGlobalFolder: [],
  enableExperimentalHash: true,
  fileHashMap: {},
  skipFrontmatterWhenCursorInFrontmatter: true,
  debugLogging: false,
};

export class UpdateTimeOnEditSettingsTab extends PluginSettingTab {
  plugin: UpdateTimeOnSavePlugin;

  constructor(app: App, plugin: UpdateTimeOnSavePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Obsidian 1.13.0 以降で使われる宣言的な定義。display() と同じ項目・保存・副作用を持つ
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'Global',
        items: [
          {
            name: 'Exclude rules for all updates',
            desc: 'Gitignore-style patterns. Matching files are ignored for both updated and created timestamps.',
            render: (setting) => {
              setting.addButton((btn) =>
                btn.setButtonText('Edit rules').onClick(() => this.openIgnoreRulesModal()),
              );
            },
          },
          {
            name: 'Minimum number of minutes between update',
            desc: 'If your files are updating too often, increase this.',
            control: {
              type: 'slider',
              key: 'minMinutesBetweenSaves',
              min: 1,
              max: 30,
              step: 1,
              defaultValue: DEFAULT_SETTINGS.minMinutesBetweenSaves,
            },
          },
          {
            name: 'Date format',
            render: (setting) => this.renderDateFormatSetting(setting),
          },
        ],
      },
      {
        type: 'group',
        heading: 'Updated at',
        items: [
          {
            name: 'Front matter updated name',
            desc: 'The key in the front matter YAML for the update time.',
            control: {
              type: 'text',
              key: 'headerUpdated',
              placeholder: 'Updated',
              defaultValue: DEFAULT_SETTINGS.headerUpdated,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Created at',
        items: [
          {
            name: 'Automatically add "created" front matter if missing',
            desc: 'If enabled, inserts the creation timestamp into the front matter when the configured created key is absent',
            control: {
              type: 'toggle',
              key: 'enableCreateTime',
              defaultValue: DEFAULT_SETTINGS.enableCreateTime,
            },
          },
          {
            name: 'Front matter created name',
            desc: 'The key in the front matter YAML for the creation time',
            visible: () => this.plugin.settings.enableCreateTime,
            control: {
              type: 'text',
              key: 'headerCreated',
              placeholder: 'Created',
              defaultValue: DEFAULT_SETTINGS.headerCreated,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Experimental',
        items: [
          {
            name: 'Enable hash matcher',
            desc: 'Using a hash system to prevent too many updates happening, especially with sync.',
            control: {
              type: 'toggle',
              key: 'enableExperimentalHash',
              defaultValue: true,
            },
          },
          {
            name: 'Initial cache',
            desc: 'Stores the current content of existing files as the baseline for the hash matcher.',
            render: (setting) => {
              setting.addButton((btn) =>
                btn.setButtonText('Fill initial cache').onClick(() => this.openInitialCacheModal()),
              );
            },
          },
          {
            name: 'Skip frontmatter update while editing frontmatter',
            desc: 'When enabled, frontmatter will not be updated if the cursor is inside the frontmatter area (before content starts).',
            control: {
              type: 'toggle',
              key: 'skipFrontmatterWhenCursorInFrontmatter',
              defaultValue: DEFAULT_SETTINGS.skipFrontmatterWhenCursorInFrontmatter,
            },
          },
          {
            name: 'Debug logging',
            desc: 'Print detailed logs to the developer console. Leave disabled in normal use.',
            control: {
              type: 'toggle',
              key: 'debugLogging',
              defaultValue: DEFAULT_SETTINGS.debugLogging,
            },
          },
        ],
      },
    ];
  }

  // Obsidian 1.13.0 より前の版で使われる命令的な実装。getSettingDefinitions() と項目を揃えること
  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl).setName('Global').setHeading();

    this.addExcludedFoldersSetting();
    this.addTimeBetweenUpdates();
    this.addDateFormat();

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

    new Setting(containerEl).setName('Updated at').setHeading();

    this.addFrontMatterUpdated();

    new Setting(containerEl).setName('Created at').setHeading();

    this.addEnableCreated();
    this.addFrontMatterCreated();

    new Setting(containerEl).setName('Experimental').setHeading();

    this.addHashMatcher();
    this.addInitialCache();
    this.addSkipFrontmatterWhenCursorInFrontmatter();
    this.addDebugLogging();
  }

  async saveSettings() {
    await this.plugin.saveSettings();
  }

  // 保存後に呼ぶ再描画は版によって異なるため、呼び出し側が指定する
  openIgnoreRulesModal(onSaved?: () => void): void {
    new IgnoreRulesModal(this.app, this.plugin, {
      title: 'Edit exclusion rules',
      description:
        'One pattern per line. Use !pattern to re-include and # for comments.',
      initialPatterns: this.plugin.settings.ignoreGlobalFolder ?? [],
      onSave: async (newValue) => {
        this.plugin.settings.ignoreGlobalFolder = newValue;
        await this.saveSettings();
        onSaved?.();
      },
    }).open();
  }

  openInitialCacheModal(): void {
    new UpdateAllCacheData(this.app, this.plugin).open();
  }

  // 日付形式は入力に応じて説明文の「Currently」を更新するため、行ごと描画する
  renderDateFormatSetting(setting: Setting): void {
    const updateDescription = (): void => {
      setting.setDesc(this.createDateFormatDescription());
    };
    updateDescription();
    setting.addText((text) =>
      text
        .setPlaceholder(DEFAULT_SETTINGS.dateFormat)
        .setValue(this.plugin.settings.dateFormat)
        .onChange(async (value) => {
          this.plugin.settings.dateFormat = value;
          updateDescription();
          await this.saveSettings();
        }),
    );
  }

  private createDateFormatDescription(): DocumentFragment {
    const descr = createFragment();
    descr.append(
      'The date format for read and write',
      descr.createEl('br'),
      'Check ',
      descr.createEl('a', {
        href: 'https://momentjs.com/docs/#/displaying/format/',
        text: 'Moment documentation',
      }),
      descr.createEl('br'),
      `Currently: ${moment().format(this.plugin.settings.dateFormat)}`,
      descr.createEl('br'),
      `Obsidian default format for date properties: YYYY-MM-DDTHH:mm`,
    );
    return descr;
  }

  addExcludedFoldersSetting(): void {
    new Setting(this.containerEl)
      .setName('Exclude rules for all updates')
      .setDesc(
        'Gitignore-style patterns. Matching files are ignored for both updated and created timestamps.',
      )
      .addButton((btn) =>
        btn.setButtonText('Edit rules').onClick(() => {
          this.openIgnoreRulesModal(() => this.display());
        }),
      );
  }

  addDateFormat(): void {
    this.renderDateFormatSetting(new Setting(this.containerEl).setName('Date format'));
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
      .setName('Automatically add "created" front matter if missing')
      .setDesc('If enabled, inserts the creation timestamp into the front matter when the configured created key is absent')
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
      .setDesc('The key in the front matter YAML for the update time.')
      .addText((text) =>
        text
          .setPlaceholder('Updated')
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
      .setDesc('The key in the front matter YAML for the creation time')
      .addText((text) =>
        text
          .setPlaceholder('Created')
          .setValue(this.plugin.settings.headerCreated ?? '')
          .onChange(async (value) => {
            this.plugin.settings.headerCreated = value;
            await this.saveSettings();
          }),
      );
  }

  addHashMatcher(): void {
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
      );
  }

  addInitialCache(): void {
    new Setting(this.containerEl)
      .setName('Initial cache')
      .setDesc('Stores the current content of existing files as the baseline for the hash matcher.')
      .addButton((btn) =>
        btn.setButtonText('Fill initial cache').onClick(() => this.openInitialCacheModal()),
      );
  }

  addSkipFrontmatterWhenCursorInFrontmatter(): void {
    new Setting(this.containerEl)
      .setName('Skip frontmatter update while editing frontmatter')
      .setDesc(
        'When enabled, frontmatter will not be updated if the cursor is inside the frontmatter area (before content starts).',
      )
      .addToggle((cb) =>
        cb
          .setValue(this.plugin.settings.skipFrontmatterWhenCursorInFrontmatter ?? true)
          .onChange(async (newValue) => {
            this.plugin.settings.skipFrontmatterWhenCursorInFrontmatter = newValue;
            await this.saveSettings();
          }),
      );
  }

  addDebugLogging(): void {
    new Setting(this.containerEl)
      .setName('Debug logging')
      .setDesc('Print detailed logs to the developer console. Leave disabled in normal use.')
      .addToggle((cb) =>
        cb
          .setValue(this.plugin.settings.debugLogging ?? false)
          .onChange(async (newValue) => {
            this.plugin.settings.debugLogging = newValue;
            await this.saveSettings();
          }),
      );
  }
}
