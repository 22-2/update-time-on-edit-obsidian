import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import UpdateTimeOnSavePlugin from './main';
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
  skipFrontmatterWhenCursorInFrontmatter: true,
  debugLogging: false,
};

export class UpdateTimeOnEditSettingsTab extends PluginSettingTab {
  plugin: UpdateTimeOnSavePlugin;

  constructor(app: App, plugin: UpdateTimeOnSavePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

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
            desc: 'Compares the body (front matter excluded) with its content when the file was opened or last synced, and skips the update if it has not changed. Prevents needless updates from sync or property-only edits.',
            control: {
              type: 'toggle',
              key: 'enableExperimentalHash',
              defaultValue: true,
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

  async saveSettings() {
    await this.plugin.saveSettings();
  }

  openIgnoreRulesModal(): void {
    new IgnoreRulesModal(this.app, this.plugin, {
      title: 'Edit exclusion rules',
      description:
        'One pattern per line. Use !pattern to re-include and # for comments.',
      initialPatterns: this.plugin.settings.ignoreGlobalFolder ?? [],
      onSave: async (newValue) => {
        this.plugin.settings.ignoreGlobalFolder = newValue;
        await this.saveSettings();
      },
    }).open();
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
}
