import { Plugin, WorkspaceLeaf, Notice, MarkdownView, TFile } from "obsidian";
import { DrawThingsSettings } from "./types";
import { DEFAULT_SETTINGS, DrawThingsSettingTab } from "./settings";
import { QueueManager } from "./queue";
import { CharacterResolver } from "./characterResolver";
import { PlotbeatProcessor } from "./plotbeatProcessor";
import { SceneScriptProcessor } from "./sceneScriptProcessor";
import { StoryboardView, STORYBOARD_VIEW_TYPE } from "./storyboardView";
import { LLMClient } from "./llmClient";
import { buildBeatExtractionPrompt, parseBeatsResponse } from "./beatPrompts";
import { BeatReviewModal } from "./beatReviewModal";
import { ConfigLookup } from "./configLookup";
import { PromptRefiner } from "./promptRefiner";
import { PromptRefineModal } from "./refineModal";

export default class DrawThingsPlugin extends Plugin {
  settings: DrawThingsSettings = DEFAULT_SETTINGS;
  queue: QueueManager;
  charResolver: CharacterResolver;
  llmClient: LLMClient;
  configLookup: ConfigLookup;
  promptRefiner: PromptRefiner;
  plotbeatProcessor: PlotbeatProcessor;
  sceneScriptProcessor: SceneScriptProcessor;
  private statusBarEl: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.queue = new QueueManager(this.app);
    this.charResolver = new CharacterResolver(this.app);
    this.llmClient = new LLMClient(this.app, this.settings);
    this.configLookup = new ConfigLookup(this.settings.modelsDir);
    this.promptRefiner = new PromptRefiner(this.llmClient);

    this.plotbeatProcessor = new PlotbeatProcessor(
      this.app,
      this.settings,
      this.queue,
      this.charResolver,
      this.configLookup,
      this.promptRefiner
    );

    this.sceneScriptProcessor = new SceneScriptProcessor(
      this.app,
      this.settings,
      this.queue,
      this.charResolver,
      this.configLookup,
      this.promptRefiner
    );

    // Register Views
    this.registerView(STORYBOARD_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      return new StoryboardView(
        leaf,
        this.queue,
        this.settings,
        this.charResolver,
        this.llmClient,
        this.configLookup,
        this.promptRefiner
      );
    });

    // Register Markdown Code Block Processors
    this.registerMarkdownCodeBlockProcessor("plotbeat", (source, el, ctx) => {
      return this.plotbeatProcessor.process(source, el, ctx);
    });

    this.registerMarkdownCodeBlockProcessor("scene-script", (source, el, ctx) => {
      return this.sceneScriptProcessor.process(source, el, ctx);
    });

    // Status Bar Item
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar(null, 0);

    this.queue.subscribeStatus((activeJob, pendingCount) => {
      this.updateStatusBar(activeJob, pendingCount);
    });

    // Ribbon Icon
    this.addRibbonIcon("image", "Draw Things Storyboard", () => {
      this.activateStoryboardView();
    });

    // Commands
    this.addCommand({
      id: "open-storyboard-view",
      name: "Open Storyboard View",
      callback: () => {
        this.activateStoryboardView();
      }
    });

    this.addCommand({
      id: "auto-script-scene-beats",
      name: "Auto-Script Scene Beats with AI (Active Note)",
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) {
          new Notice("Please open a scene note first.");
          return;
        }
        const file = view.file;
        const content = await this.app.vault.read(file);
        new Notice("🤖 Analyzing scene text & extracting visual beats with AI...");
        try {
          const { systemPrompt, userPrompt } = buildBeatExtractionPrompt(
            file.basename,
            content,
            this.settings.targetBeatCount,
            "pure-moonlit",
            ["Alex", "Sofia Adebayo", "Sylvie Beck", "Kikaya", "Petra", "Clara"]
          );

          const response = await this.llmClient.generateCompletion(systemPrompt, userPrompt);
          const parsed = parseBeatsResponse(response, file.basename);

          if (parsed.beats.length === 0) {
            new Notice("No beats returned by AI.");
            return;
          }

          new BeatReviewModal(
            this.app,
            parsed.scene,
            parsed.preset || "pure-moonlit",
            parsed.beats,
            file,
            this.queue,
            this.settings
          ).open();
        } catch (err: any) {
          new Notice(`❌ AI Beat Extraction failed: ${err.message}`);
          console.error(err);
        }
      }
    });

    this.addCommand({
      id: "generate-beat-from-selection",
      name: "Generate Single Plot Beat from Selection (AI)",
      editorCallback: async (editor, view) => {
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) {
          new Notice("Please select scene prose in the editor first.");
          return;
        }
        new Notice("🤖 Crafting visual prompt from selected text...");
        try {
          const { systemPrompt, userPrompt } = buildBeatExtractionPrompt(
            view.file?.basename || "Scene",
            selected,
            1,
            "pure-moonlit",
            ["Alex", "Sofia Adebayo", "Sylvie Beck", "Kikaya", "Petra", "Clara"]
          );

          const response = await this.llmClient.generateCompletion(systemPrompt, userPrompt);
          const parsed = parseBeatsResponse(response, view.file?.basename || "Scene");

          if (parsed.beats.length > 0) {
            const beat = parsed.beats[0];
            const block = `\n\`\`\`plotbeat\nbeat: 1\ntitle: "${beat.title}"\ncharacter: "${beat.character || ""}"\npreset: "pure-moonlit"\nmodel: "${this.settings.defaultModel}"\naspect: "2:3"\nseed: ${beat.seed || 1001}\nprompt: "${beat.prompt.replace(/"/g, '\\"')}"\n\`\`\`\n`;
            editor.replaceSelection(selected + "\n" + block);
            new Notice("Inserted plotbeat block!");
          }
        } catch (err: any) {
          new Notice(`❌ AI Beat generation failed: ${err.message}`);
        }
      }
    });

    this.addCommand({
      id: "insert-plotbeat-template",
      name: "Insert Blank Plot Beat Template",
      editorCallback: (editor) => {
        const template = `\n\`\`\`plotbeat\nbeat: 1\ntitle: "The Threshold"\ncharacter: ""\npreset: "pure-moonlit"\nprompt: "Key scene moment description..."\n\`\`\`\n`;
        editor.replaceSelection(template);
      }
    });

    this.addCommand({
      id: "insert-scene-script-template",
      name: "Insert Blank Scene Script Template",
      editorCallback: (editor) => {
        const template = `\n\`\`\`scene-script\nscene: "Scene Name"\npreset: "pure-moonlit"\nmodel: "${this.settings.defaultModel}"\naspect: "1024x1536"\nseed_start: 1001\n\nbeats:\n  - beat: 1\n    title: "Beat One"\n    character: ""\n    prompt: "Prompt for beat 1..."\n  - beat: 2\n    title: "Beat Two"\n    character: ""\n    prompt: "Prompt for beat 2..."\n\`\`\`\n`;
        editor.replaceSelection(template);
      }
    });

    this.addCommand({
      id: "clear-generation-queue",
      name: "Clear Generation Queue & Stop Current Job",
      callback: () => {
        this.queue.cancelAll();
      }
    });

    this.addCommand({
      id: "reload-drawthings-configs",
      name: "Reload Draw Things Configurations & Shoots",
      callback: () => {
        this.configLookup.reloadConfigs();
        const count = this.configLookup.getAllShoots().length;
        new Notice(`Scanned Draw Things container: found ${count} configurations.`);
      }
    });

    this.addCommand({
      id: "refine-active-beat-prompt",
      name: "Refine Beat Prompts in Active Note (Visionary / ENI Bible)",
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file) {
          new Notice("Please open a note with plot beats first.");
          return;
        }
        const file = view.file;
        const content = await this.app.vault.read(file);
        const match = /```plotbeat\s*\n([\s\S]*?)\n```/.exec(content);
        if (!match) {
          new Notice("No ```plotbeat block found in active note.");
          return;
        }
        try {
          const yaml = await import("yaml");
          const raw = yaml.parse(match[1], { uniqueKeys: false }) || {};
          const shoot = this.configLookup.getShoot(raw.shoot || raw.preset || this.settings.activeShoot);
          new PromptRefineModal(
            this.app,
            {
              id: `cmd-${raw.beat || 1}-${Date.now()}`,
              beat: raw.beat || 1,
              title: raw.title,
              prompt: raw.prompt || "",
              character: raw.character,
              shoot: raw.shoot,
              preset: raw.preset,
              model: raw.model,
              width: raw.width,
              height: raw.height,
              aspect: raw.aspect || raw.ratio,
              steps: raw.steps,
              cfg: raw.cfg,
              seed: raw.seed !== undefined ? Number(raw.seed) : undefined,
              output: raw.output,
              image: raw.image,
              strength: raw.strength,
              config_json: raw.config_json
            },
            file,
            shoot,
            this.promptRefiner,
            this.charResolver,
            this.queue,
            this.settings,
            this.configLookup
          ).open();
        } catch (e: any) {
          new Notice(`Failed to parse beat: ${e.message}`);
        }
      }
    });

    // Settings Tab
    this.addSettingTab(new DrawThingsSettingTab(this.app, this));
  }

  async onunload() {
    this.queue.cancelAll();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.llmClient.updateSettings(this.settings);
    if (this.configLookup) {
      this.configLookup.setModelsDir(this.settings.modelsDir);
    }
    if (this.promptRefiner) {
      this.promptRefiner.updateClient(this.llmClient);
    }
    this.plotbeatProcessor.updateSettings(this.settings);
    this.sceneScriptProcessor.updateSettings(this.settings);
  }

  private updateStatusBar(activeJob: any, pendingCount: number) {
    if (!this.statusBarEl) return;
    this.statusBarEl.empty();

    if (activeJob) {
      const progressTxt = activeJob.progress > 0 ? ` (${activeJob.progress}%)` : "";
      this.statusBarEl.createSpan({
        cls: "drawthings-status-bar-active",
        text: `🎨 DT: [${activeJob.title || activeJob.scene}] Generating${progressTxt}`
      });
      if (pendingCount > 0) {
        this.statusBarEl.createSpan({
          cls: "drawthings-status-bar-pending",
          text: ` +${pendingCount} queued`
        });
      }
    } else if (pendingCount > 0) {
      this.statusBarEl.createSpan({
        text: `🎨 DT: ${pendingCount} queued`
      });
    } else {
      this.statusBarEl.createSpan({
        text: "🎨 DT: Ready"
      });
    }
  }

  private async activateStoryboardView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(STORYBOARD_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: STORYBOARD_VIEW_TYPE,
          active: true
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}
