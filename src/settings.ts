import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import { exec } from "child_process";
import { DrawThingsSettings, LLMProvider } from "./types";
import { DEFAULT_PRESETS } from "./presetResolver";
import type DrawThingsPlugin from "./main";

export const DEFAULT_SETTINGS: DrawThingsSettings = {
  cliPath: "/Users/daniel/.local/bin/draw-things-cli",
  modelsDir: "",
  defaultModel: "z_image_turbo_1.0_q8p.ckpt",
  outputFolderPattern: "Visuals/Scene Plates/{scene}",
  defaultWidth: 1024,
  defaultHeight: 1536,
  defaultSteps: 12,
  defaultCfg: 1.5,
  enableCharacterResolution: true,
  characterFolders: ["Characters", "Visuals/Character Visuals", "Visuals/Portrait Prompts"],
  presets: DEFAULT_PRESETS,

  // Shoot & Config Lookup (Alfred workflow parity)
  activeShoot: "dt_krea_ultra_real",
  promptRefineMode: "unified",
  autoRefine: false,

  // LLM settings
  llmProvider: "openrouter",
  llmEndpoint: "https://openrouter.ai/api/v1/chat/completions",
  llmApiKey: "",
  llmModel: "@preset/glm-5-3-writer",
  targetBeatCount: 4,
  customSystemPrompt: ""
};

export class DrawThingsSettingTab extends PluginSettingTab {
  plugin: DrawThingsPlugin;
  private detectedModels: string[] = [
    "z_image_turbo_1.0_q8p.ckpt",
    "flux_2_klein_9b_kv_q8p.ckpt",
    "flux_2_klein_9b_f16.ckpt",
    "krea_2_turbo_q8p.ckpt",
    "krea_2_raw_q8p.ckpt",
    "seedvr2_7b_q8p.ckpt",
    "ideogram_4_q6p.ckpt",
    "ideogram_4_fast_i8x.ckpt"
  ];

  constructor(app: App, plugin: DrawThingsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Draw Things Novel Scene Illustrator" });

    // ==========================================
    // 1. AI PLOT BEAT AUTOMATION (NEW)
    // ==========================================
    containerEl.createEl("h3", { text: "✨ AI Plot Beat Automation" });
    containerEl.createEl("p", {
      text: "Automatically extract dramatic visual turning points from scene prose into photographic prompts.",
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("AI LLM Engine Provider")
      .setDesc("Select which provider to use for analyzing scene text and scripting beats.")
      .addDropdown(dropdown => {
        dropdown
          .addOption("openrouter", "⚡ OpenRouter (Fast Cloud: @preset/glm-5-3-writer)")
          .addOption("smart-composer", "Smart Composer (Auto-Detect)")
          .addOption("ollama", "Local Ollama (Offline / Free)")
          .addOption("lm-studio", "LM Studio (Local)")
          .addOption("anthropic", "Anthropic Claude (Sonnet / Opus)")
          .addOption("openai", "OpenAI (GPT-4o / GPT-5)")
          .addOption("gemini", "Google Gemini (2.0 Flash / Pro)")
          .addOption("custom", "Custom OpenAI-Compatible Endpoint")
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (val: LLMProvider) => {
            this.plugin.settings.llmProvider = val;
            if (val === "openrouter") {
              this.plugin.settings.llmEndpoint = "https://openrouter.ai/api/v1/chat/completions";
              this.plugin.settings.llmModel = "@preset/glm-5-3-writer";
            } else if (val === "ollama") {
              this.plugin.settings.llmEndpoint = "http://127.0.0.1:11434/api/chat";
              this.plugin.settings.llmModel = "llama3";
            } else if (val === "lm-studio") {
              this.plugin.settings.llmEndpoint = "http://127.0.0.1:1234/v1/chat/completions";
              this.plugin.settings.llmModel = "default";
            } else if (val === "anthropic") {
              this.plugin.settings.llmEndpoint = "https://api.anthropic.com/v1/messages";
              this.plugin.settings.llmModel = "claude-3-5-sonnet-20241022";
            } else if (val === "openai") {
              this.plugin.settings.llmEndpoint = "https://api.openai.com/v1/chat/completions";
              this.plugin.settings.llmModel = "gpt-4o";
            } else if (val === "gemini") {
              this.plugin.settings.llmEndpoint = "";
              this.plugin.settings.llmModel = "gemini-2.0-flash";
            }
            await this.plugin.saveSettings();
            this.display();
          });
      })
      .addButton(btn =>
        btn.setButtonText("Test LLM Connection").onClick(async () => {
          new Notice("Testing connection to LLM...");
          const res = await this.plugin.llmClient.testConnection();
          if (res.success) {
            new Notice(`✅ ${res.message}`);
          } else {
            new Notice(`❌ ${res.message}`);
          }
        })
      );

    new Setting(containerEl)
      .setName("LLM Model Name")
      .setDesc(
        this.plugin.settings.llmProvider === "openrouter"
          ? "OpenRouter model or preset identifier (e.g. @preset/glm-5-3-writer, anthropic/claude-3.5-sonnet, openai/gpt-4o-mini)."
          : "Model identifier (e.g. llama3, claude-3-5-sonnet-20241022, gpt-4o, gemini-2.0-flash)."
      )
      .addText(text =>
        text
          .setPlaceholder(this.plugin.settings.llmProvider === "openrouter" ? "@preset/glm-5-3-writer" : "Model ID")
          .setValue(this.plugin.settings.llmModel)
          .onChange(async val => {
            this.plugin.settings.llmModel = val.trim();
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.llmProvider !== "ollama" && this.plugin.settings.llmProvider !== "lm-studio") {
      const isOR = this.plugin.settings.llmProvider === "openrouter";
      new Setting(containerEl)
        .setName(isOR ? "OpenRouter API Key" : "API Key")
        .setDesc(
          isOR
            ? "Your OpenRouter API key (sk-or-v1-...). If left blank, will automatically detect your key from Smart Composer."
            : "Secret API key for the chosen cloud provider."
        )
        .addText(text => {
          text.inputEl.type = "password";
          text
            .setPlaceholder(isOR ? "sk-or-v1-..." : "sk-...")
            .setValue(this.plugin.settings.llmApiKey)
            .onChange(async val => {
              this.plugin.settings.llmApiKey = val.trim();
              await this.plugin.saveSettings();
            });
        });
    }

    if (
      this.plugin.settings.llmProvider === "openrouter" ||
      this.plugin.settings.llmProvider === "custom" ||
      this.plugin.settings.llmProvider === "ollama" ||
      this.plugin.settings.llmProvider === "lm-studio"
    ) {
      new Setting(containerEl)
        .setName(this.plugin.settings.llmProvider === "openrouter" ? "OpenRouter Endpoint URL" : "Custom Endpoint URL")
        .setDesc(
          this.plugin.settings.llmProvider === "openrouter"
            ? "Default: https://openrouter.ai/api/v1/chat/completions (auto-cleans pasted duplicates)."
            : "HTTP URL for the API endpoint."
        )
        .addText(text =>
          text
            .setPlaceholder(
              this.plugin.settings.llmProvider === "openrouter"
                ? "https://openrouter.ai/api/v1/chat/completions"
                : "http://127.0.0.1:11434/api/chat"
            )
            .setValue(this.plugin.settings.llmEndpoint)
            .onChange(async val => {
              let cleanVal = val.trim();
              if (this.plugin.settings.llmProvider === "openrouter") {
                cleanVal = this.plugin.llmClient.cleanOpenRouterEndpoint(cleanVal);
              }
              this.plugin.settings.llmEndpoint = cleanVal;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Default Target Beat Count")
      .setDesc("How many key visual beats to extract per scene (default: 4).")
      .addSlider(slider =>
        slider
          .setLimits(2, 12, 1)
          .setValue(this.plugin.settings.targetBeatCount)
          .setDynamicTooltip()
          .onChange(async val => {
            this.plugin.settings.targetBeatCount = val;
            await this.plugin.saveSettings();
          })
      );

    // Prompt Refinement (Alfred workflow parity)
    containerEl.createEl("h3", { text: "🧠 Prompt Refinement (Visionary Artist + ENI Shoot Bible)" });
    containerEl.createEl("p", {
      text: "Transform beats into 5-part architectural photographic descriptions, identical to the Alfred workflow.",
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("Default Prompt Refinement Mode")
      .setDesc("Unified Master combines Visionary logic with ENI Shoot Bible 5-part architecture.")
      .addDropdown(dropdown => {
        dropdown
          .addOption("unified", "Unified Master (Visionary + ENI Bible)")
          .addOption("visionary", "Visionary Artist (~500 Words)")
          .addOption("eni_bible", "Pure ENI Shoot Bible (5 Sections)")
          .addOption("disabled", "Disabled (Raw Beat Prompts)")
          .setValue(this.plugin.settings.promptRefineMode)
          .onChange(async (val: any) => {
            this.plugin.settings.promptRefineMode = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Auto-Refine Prompts on Generation")
      .setDesc("Automatically run prompts through the chosen AI refinement architecture before executing Draw Things CLI.")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoRefine)
          .onChange(async val => {
            this.plugin.settings.autoRefine = val;
            await this.plugin.saveSettings();
          })
      );

    // ==========================================
    // 2. SHOOT TYPES & APP CONFIGS (ALFRED WORKFLOW)
    // ==========================================
    containerEl.createEl("h3", { text: "🎬 Shoot Types & App Configurations (Alfred Workflow Lookup)" });
    containerEl.createEl("p", {
      text: "Saved configuration sets discovered from Draw Things app container (custom_configs.json) and Alfred shoots.",
      cls: "setting-item-description"
    });

    const shoots = this.plugin.configLookup ? this.plugin.configLookup.getAllShoots() : [];
    const activeShoot = this.plugin.configLookup ? this.plugin.configLookup.getShoot(this.plugin.settings.activeShoot) : null;

    new Setting(containerEl)
      .setName("Active Default Shoot Type")
      .setDesc("Global preset configuration used when beats or scene scripts don't specify an explicit shoot.")
      .addDropdown(dropdown => {
        for (const s of shoots) {
          const badge = s.is_drawthings_app ? "📱 " : (s.is_builtin ? "🎬 " : "⚙️ ");
          dropdown.addOption(s.id, `${badge}${s.name}`);
        }
        dropdown.setValue(this.plugin.settings.activeShoot);
        dropdown.onChange(async val => {
          this.plugin.settings.activeShoot = val;
          await this.plugin.saveSettings();
          this.display();
        });
      })
      .addButton(btn =>
        btn.setButtonText("🔄 Reload Draw Things Presets").onClick(() => {
          if (this.plugin.configLookup) {
            this.plugin.configLookup.reloadConfigs();
            new Notice(`Scanned Draw Things container: found ${this.plugin.configLookup.getAllShoots().length} configurations.`);
            this.display();
          }
        })
      );

    if (activeShoot) {
      const infoBox = containerEl.createDiv({ cls: "drawthings-shoot-info-card" });
      infoBox.createEl("h4", { text: `Active Shoot Specs: ${activeShoot.name}` });
      if (activeShoot.description) {
        infoBox.createEl("p", { text: activeShoot.description, cls: "drawthings-shoot-desc" });
      }
      const loraCount = activeShoot.loras ? activeShoot.loras.length : (activeShoot.lora && activeShoot.lora !== "none" ? 1 : 0);
      const loraText = loraCount > 1
        ? `${loraCount} LoRAs (${activeShoot.loras!.map(l => `${l.file} @ ${l.weight}`).join(", ")})`
        : (activeShoot.lora && activeShoot.lora !== "none" ? `${activeShoot.lora} (${activeShoot.lora_weight ?? 1.0})` : "None");

      const specsList = infoBox.createEl("ul", { cls: "drawthings-shoot-specs-list" });
      specsList.createEl("li", { text: `Base Model: ${activeShoot.model}` });
      specsList.createEl("li", { text: `Dimensions: ${activeShoot.width} x ${activeShoot.height}` });
      specsList.createEl("li", { text: `Inference Steps: ${activeShoot.steps} | CFG: ${activeShoot.cfg}` });
      specsList.createEl("li", { text: `Active LoRAs: ${loraText}` });
      if (activeShoot.prompt_anchor) {
        specsList.createEl("li", { text: `Prompt Style Anchor: "${activeShoot.prompt_anchor}"` });
      }
    }

    // ==========================================
    // 3. DRAW THINGS CLI SETTINGS
    // ==========================================
    containerEl.createEl("h3", { text: "🎨 Draw Things Local Engine" });

    new Setting(containerEl)
      .setName("Draw Things CLI Executable Path")
      .setDesc("Absolute path to the draw-things-cli binary on macOS.")
      .addText(text =>
        text
          .setPlaceholder("/Users/daniel/.local/bin/draw-things-cli")
          .setValue(this.plugin.settings.cliPath)
          .onChange(async value => {
            this.plugin.settings.cliPath = value.trim();
            await this.plugin.saveSettings();
          })
      )
      .addButton(btn =>
        btn.setButtonText("Test CLI").onClick(() => {
          this.testCliConnection();
        })
      );

    new Setting(containerEl)
      .setName("Custom Models Directory")
      .setDesc("Leave empty to use official Draw Things models directory (~/Library/Containers/com.liuliu.draw-things/Data/Documents/Models).")
      .addText(text =>
        text
          .setPlaceholder("Default official directory")
          .setValue(this.plugin.settings.modelsDir)
          .onChange(async value => {
            this.plugin.settings.modelsDir = value.trim();
            await this.plugin.saveSettings();
          })
      );

    const modelSetting = new Setting(containerEl)
      .setName("Default Inference Model")
      .setDesc("Primary model used for scene illustrations (e.g. fast Z-Image Turbo or FLUX.2 Klein).")
      .addDropdown(dropdown => {
        const allModels = Array.from(new Set([this.plugin.settings.defaultModel, ...this.detectedModels]));
        for (const m of allModels) {
          dropdown.addOption(m, m);
        }
        dropdown.setValue(this.plugin.settings.defaultModel);
        dropdown.onChange(async val => {
          this.plugin.settings.defaultModel = val;
          await this.plugin.saveSettings();
        });
      })
      .addButton(btn =>
        btn.setButtonText("Detect Downloaded Models").onClick(() => {
          this.detectModels(modelSetting);
        })
      );

    new Setting(containerEl)
      .setName("Scene Plates Output Folder")
      .setDesc("Vault folder pattern for saving generated plates. Use {scene} for the scene name.")
      .addText(text =>
        text
          .setPlaceholder("Visuals/Scene Plates/{scene}")
          .setValue(this.plugin.settings.outputFolderPattern)
          .onChange(async val => {
            this.plugin.settings.outputFolderPattern = val.trim() || "Visuals/Scene Plates/{scene}";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable Character Profile Lookups")
      .setDesc("Automatically resolve character names in plot beats against notes in your character and portrait prompt folders.")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.enableCharacterResolution)
          .onChange(async val => {
            this.plugin.settings.enableCharacterResolution = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Character Search Folders")
      .setDesc("Comma-separated folder paths to search for character profiles and visual canon.")
      .addText(text =>
        text
          .setPlaceholder("Characters, Visuals/Character Visuals, Visuals/Portrait Prompts")
          .setValue(this.plugin.settings.characterFolders.join(", "))
          .onChange(async val => {
            this.plugin.settings.characterFolders = val
              .split(",")
              .map(s => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Default Sampling Settings" });

    new Setting(containerEl)
      .setName("Default Dimensions (Width x Height)")
      .setDesc("Multiples of 64 pixels (e.g. 1024 x 1536 for 2:3 portrait plate).")
      .addText(text =>
        text
          .setPlaceholder("Width")
          .setValue(String(this.plugin.settings.defaultWidth))
          .onChange(async val => {
            const n = parseInt(val, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.defaultWidth = n;
              await this.plugin.saveSettings();
            }
          })
      )
      .addText(text =>
        text
          .setPlaceholder("Height")
          .setValue(String(this.plugin.settings.defaultHeight))
          .onChange(async val => {
            const n = parseInt(val, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.defaultHeight = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default Sampling Steps")
      .setDesc("Steps for default inference (8-12 for Turbo models, 16-25 for FLUX).")
      .addSlider(slider =>
        slider
          .setLimits(4, 50, 1)
          .setValue(this.plugin.settings.defaultSteps)
          .setDynamicTooltip()
          .onChange(async val => {
            this.plugin.settings.defaultSteps = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default CFG / Guidance Scale")
      .setDesc("Guidance strength (1.5 - 2.0 recommended for modern distilled/turbo models).")
      .addSlider(slider =>
        slider
          .setLimits(1.0, 10.0, 0.5)
          .setValue(this.plugin.settings.defaultCfg)
          .setDynamicTooltip()
          .onChange(async val => {
            this.plugin.settings.defaultCfg = val;
            await this.plugin.saveSettings();
          })
      );
  }

  private testCliConnection() {
    const cli = this.plugin.settings.cliPath;
    exec(`"${cli}" --version`, (err, stdout, stderr) => {
      if (err) {
        new Notice(`❌ CLI test failed: ${stderr || err.message}`);
      } else {
        const out = stdout.trim() || stderr.trim();
        new Notice(`✅ Draw Things CLI connection verified! Output:\n${out}`);
      }
    });
  }

  private detectModels(setting: Setting) {
    const cli = this.plugin.settings.cliPath;
    new Notice("Detecting downloaded models from Draw Things...");
    exec(`"${cli}" models list --downloaded-only`, (err, stdout) => {
      if (err) {
        new Notice(`Failed to list models: ${err.message}`);
        return;
      }
      const lines = stdout.split("\n");
      const found: string[] = [];
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9._-]+\.ckpt)/);
        if (match) {
          found.push(match[1]);
        }
      }
      if (found.length > 0) {
        this.detectedModels = found;
        new Notice(`Found ${found.length} downloaded models!`);
        this.display();
      } else {
        new Notice("No downloaded models found in CLI output.");
      }
    });
  }
}
