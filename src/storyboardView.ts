import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownView } from "obsidian";
import * as yaml from "yaml";
import * as path from "path";
import * as fs from "fs";
import { QueueManager } from "./queue";
import { DrawThingsSettings, PlotBeatData } from "./types";
import { CharacterResolver } from "./characterResolver";
import { DEFAULT_PRESETS, parseAspectRatio, roundToMultipleOf64 } from "./presetResolver";
import { LLMClient } from "./llmClient";
import { buildBeatExtractionPrompt, parseBeatsResponse } from "./beatPrompts";
import { BeatReviewModal } from "./beatReviewModal";

export const STORYBOARD_VIEW_TYPE = "drawthings-storyboard-view";

export class StoryboardView extends ItemView {
  private queue: QueueManager;
  private settings: DrawThingsSettings;
  private charResolver: CharacterResolver;
  private llmClient: LLMClient;
  private currentFile: TFile | null = null;
  private unsubscribeQueue: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    queue: QueueManager,
    settings: DrawThingsSettings,
    charResolver: CharacterResolver,
    llmClient: LLMClient
  ) {
    super(leaf);
    this.queue = queue;
    this.settings = settings;
    this.charResolver = charResolver;
    this.llmClient = llmClient;
  }

  getViewType(): string {
    return STORYBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Draw Things Storyboard";
  }

  getIcon(): string {
    return "image";
  }

  async onOpen() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const md = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (md && md.file) {
          this.currentFile = md.file;
        }
        this.refresh();
      })
    );
    this.unsubscribeQueue = this.queue.subscribe(() => this.refresh());
    await this.refresh();
  }

  async onClose() {
    if (this.unsubscribeQueue) {
      this.unsubscribeQueue();
      this.unsubscribeQueue = null;
    }
  }

  updateSettings(settings: DrawThingsSettings) {
    this.settings = settings;
    this.refresh();
  }

  async refresh() {
    const container = this.containerEl.children[1];
    container.empty();

    // Resolve target file robustly
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file) {
      this.currentFile = activeView.file;
    } else if (!this.currentFile) {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && activeFile.extension === "md") {
        this.currentFile = activeFile;
      }
    }

    const file = this.currentFile;
    const root = container.createDiv({ cls: "drawthings-sidebar-root" });

    if (!file) {
      root.createEl("div", { cls: "drawthings-sidebar-empty", text: "No active note selected." });
      return;
    }

    const header = root.createDiv({ cls: "drawthings-sidebar-header" });
    header.createEl("h4", { cls: "drawthings-sidebar-title", text: `🎬 ${file.basename}` });

    let content = "";
    try {
      content = await this.app.vault.read(file);
    } catch (err) {
      root.createEl("div", { cls: "drawthings-sidebar-empty", text: "Could not read note contents." });
      return;
    }

    const beats = this.extractBeatsFromContent(content, file.basename);

    // AI Automation Action Button
    const aiBar = root.createDiv({ cls: "drawthings-sidebar-ai-bar" });
    const btnAiScript = aiBar.createEl("button", {
      cls: "mod-cta drawthings-btn drawthings-btn-full",
      text: "✨ Auto-Script Beats with AI"
    });
    btnAiScript.addEventListener("click", () => {
      this.triggerAiScripting(file, content, btnAiScript);
    });

    if (beats.length === 0) {
      const emptyBox = root.createDiv({ cls: "drawthings-sidebar-empty" });
      emptyBox.createEl("p", { text: "No plot beats found in this note yet." });
      const btnInsert = emptyBox.createEl("button", { cls: "drawthings-btn", text: "+ Insert Blank Beat Template" });
      btnInsert.addEventListener("click", async () => {
        await this.insertTemplate(file);
      });
      return;
    }

    const actionsBar = root.createDiv({ cls: "drawthings-sidebar-actions" });
    const btnGenAll = actionsBar.createEl("button", { cls: "mod-cta drawthings-btn drawthings-btn-sm", text: `⚡ Generate All (${beats.length})` });
    const btnClear = actionsBar.createEl("button", { cls: "mod-warning drawthings-btn drawthings-btn-sm", text: "Clear Queue" });

    btnGenAll.addEventListener("click", async () => {
      new Notice(`Queueing ${beats.length} beats from ${file.basename}...`);
      for (const beat of beats) {
        const job = await this.buildJob(beat, file.path);
        this.queue.enqueue(job);
      }
    });

    btnClear.addEventListener("click", () => {
      this.queue.cancelAll();
    });

    const list = root.createDiv({ cls: "drawthings-sidebar-list" });
    const vaultPath = (this.app.vault.adapter as any).getBasePath ? (this.app.vault.adapter as any).getBasePath() : "";

    for (const beat of beats) {
      const item = list.createDiv({ cls: "drawthings-sidebar-item" });
      const sceneSlug = (beat.scene || file.basename).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const beatSlug = String(beat.beat).padStart(2, "0");
      const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const defaultRel = `${this.settings.outputFolderPattern.replace("{scene}", sceneSlug)}/${beatSlug}_${titleSlug}.png`;
      const rel = beat.output || defaultRel;
      const abs = path.isAbsolute(rel) ? rel : path.join(vaultPath, rel);

      const exists = fs.existsSync(abs);

      const itemTop = item.createDiv({ cls: "drawthings-sidebar-item-top" });
      itemTop.createSpan({ cls: "drawthings-badge beat-badge", text: `Beat ${beat.beat}` });
      itemTop.createSpan({ cls: "drawthings-sidebar-item-title", text: beat.title || "" });

      if (exists) {
        const thumb = item.createDiv({ cls: "drawthings-sidebar-thumb" });
        thumb.createEl("img", {
          attr: { src: `app://local${abs}?t=${Date.now()}` }
        });
        thumb.addEventListener("click", () => window.open(`file://${abs}`));
      }

      const promptSnippet = item.createDiv({ cls: "drawthings-sidebar-prompt", text: beat.prompt });

      const itemBot = item.createDiv({ cls: "drawthings-sidebar-item-bot" });
      const btnItemGen = itemBot.createEl("button", {
        cls: "drawthings-btn drawthings-btn-xs",
        text: exists ? "Regen" : "Generate"
      });

      btnItemGen.addEventListener("click", async () => {
        const job = await this.buildJob(beat, file.path);
        this.queue.enqueue(job);
      });

      const active = this.queue.getJobForBeat(beat.id);
      if (active && (active.status === "running" || active.status === "pending")) {
        itemBot.createSpan({ cls: "drawthings-sidebar-status active", text: active.statusMessage });
      } else if (exists) {
        itemBot.createSpan({ cls: "drawthings-sidebar-status done", text: "Ready" });
      }
    }
  }

  async triggerAiScripting(file: TFile | null, content?: string, buttonEl?: HTMLButtonElement) {
    if (!file) {
      file = this.currentFile || this.app.workspace.getActiveFile();
    }
    if (!file) {
      new Notice("Please select a scene note first.");
      return;
    }

    let origText = "";
    if (buttonEl) {
      origText = buttonEl.innerText;
      buttonEl.disabled = true;
      buttonEl.innerText = "⏳ Crafting Beats with AI...";
    }

    new Notice("🤖 Analyzing scene text & extracting visual beats with AI...");

    try {
      const sceneText = content || (await this.app.vault.read(file));
      const { systemPrompt, userPrompt } = buildBeatExtractionPrompt(
        file.basename,
        sceneText,
        this.settings.targetBeatCount,
        "pure-moonlit",
        ["Alex", "Sofia Adebayo", "Sylvie Beck", "Kikaya", "Petra", "Clara"]
      );

      const response = await this.llmClient.generateCompletion(systemPrompt, userPrompt);
      const parsed = parseBeatsResponse(response, file.basename);

      if (parsed.beats.length === 0) {
        new Notice("No beats were returned by AI.");
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
      new Notice(`❌ AI Beat Extraction failed: ${err.message}`, 8000);
      console.error("AI Beat Extraction error:", err);
    } finally {
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.innerText = origText || "✨ Auto-Script Beats with AI";
      }
    }
  }

  private async insertTemplate(file: TFile | null) {
    if (!file) {
      file = this.currentFile || this.app.workspace.getActiveFile();
    }
    if (!file) {
      new Notice("Please select an active note first.");
      return;
    }

    const template = `\n\n\`\`\`plotbeat\nbeat: 1\ntitle: "The Threshold"\ncharacter: ""\npreset: "pure-moonlit"\nmodel: "${this.settings.defaultModel}"\naspect: "2:3"\nseed: 1001\nprompt: "Key scene beat description here..."\n\`\`\`\n`;

    try {
      // 1. Try active editor if open
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      let inserted = false;
      for (const leaf of leaves) {
        const mdView = leaf.view as MarkdownView;
        if (mdView.file?.path === file.path && mdView.editor) {
          mdView.editor.replaceSelection(template);
          inserted = true;
          break;
        }
      }

      // 2. Otherwise append directly via vault modify
      if (!inserted) {
        const content = await this.app.vault.read(file);
        await this.app.vault.modify(file, content + template);
      }

      new Notice(`Inserted plotbeat template into "${file.basename}"!`);
      await this.refresh();
    } catch (e: any) {
      new Notice(`Failed to insert template: ${e.message}`);
    }
  }

  private extractBeatsFromContent(content: string, defaultScene: string): PlotBeatData[] {
    const beats: PlotBeatData[] = [];

    const plotbeatRegex = /```plotbeat\s*\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;
    while ((match = plotbeatRegex.exec(content)) !== null) {
      try {
        const raw = yaml.parse(match[1]) || {};
        const beat = raw.beat ?? beats.length + 1;
        const scene = raw.scene || defaultScene;
        const title = raw.title || `Beat ${beat}`;
        const id = `${scene}-${beat}-${title}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        beats.push({
          id,
          beat,
          title,
          scene,
          character: raw.character,
          preset: raw.preset,
          model: raw.model || this.settings.defaultModel,
          prompt: raw.prompt || "",
          negative_prompt: raw.negative_prompt || raw.negative,
          width: raw.width,
          height: raw.height,
          aspect: raw.aspect || raw.ratio,
          steps: raw.steps,
          cfg: raw.cfg,
          seed: raw.seed !== undefined ? Number(raw.seed) : undefined,
          image: raw.image,
          strength: raw.strength,
          config_json: raw.config_json,
          output: raw.output
        });
      } catch (e) {}
    }

    const sceneScriptRegex = /```scene-script\s*\n([\s\S]*?)\n```/g;
    while ((match = sceneScriptRegex.exec(content)) !== null) {
      try {
        const raw = yaml.parse(match[1]) || {};
        const scene = raw.scene || defaultScene;
        const preset = raw.preset;
        const model = raw.model || this.settings.defaultModel;
        const seedStart = raw.seed_start !== undefined ? Number(raw.seed_start) : undefined;
        const rawBeats = Array.isArray(raw.beats) ? raw.beats : [];

        rawBeats.forEach((b: any, idx: number) => {
          const beatNum = b.beat !== undefined ? b.beat : idx + 1;
          const title = b.title || `Beat ${beatNum}`;
          const id = `${scene}-${beatNum}-${title}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
          let seed = b.seed;
          if (seed === undefined && seedStart !== undefined) seed = seedStart + idx;

          beats.push({
            id,
            beat: beatNum,
            title,
            scene,
            character: b.character,
            preset: b.preset || preset,
            model: b.model || model,
            prompt: b.prompt || "",
            negative_prompt: b.negative_prompt || b.negative || raw.negative_prompt || raw.negative,
            width: b.width || raw.width,
            height: b.height || raw.height,
            aspect: b.aspect || raw.aspect,
            steps: b.steps || raw.steps,
            cfg: b.cfg || raw.cfg,
            seed: seed !== undefined ? Number(seed) : undefined,
            image: b.image,
            strength: b.strength,
            config_json: b.config_json || raw.config_json,
            output: b.output
          });
        });
      } catch (e) {}
    }

    return beats;
  }

  private async buildJob(beat: PlotBeatData, sourcePath: string) {
    const sceneSlug = (beat.scene || "scene").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const beatSlug = String(beat.beat).padStart(2, "0");
    const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    const presetKey = beat.preset || "";
    const preset = this.settings.presets[presetKey] || DEFAULT_PRESETS[presetKey];
    const model = beat.model || preset?.model || this.settings.defaultModel;

    let width = beat.width;
    let height = beat.height;
    if ((!width || !height) && (beat.aspect || preset?.width)) {
      if (beat.aspect) {
        const dims = parseAspectRatio(beat.aspect);
        if (dims) {
          width = dims.width;
          height = dims.height;
        }
      } else if (preset?.width && preset?.height) {
        width = preset.width;
        height = preset.height;
      }
    }
    width = roundToMultipleOf64(width || this.settings.defaultWidth);
    height = roundToMultipleOf64(height || this.settings.defaultHeight);

    const steps = beat.steps || preset?.steps || this.settings.defaultSteps;
    const cfg = beat.cfg || preset?.cfg || this.settings.defaultCfg;
    const seed = beat.seed !== undefined ? beat.seed : Math.floor(Math.random() * 2000000000);

    let charPrompt = "";
    if (this.settings.enableCharacterResolution && beat.character) {
      charPrompt = await this.charResolver.resolveCharacterPrompt(beat.character, this.settings.characterFolders);
    }

    let effectivePrompt = beat.prompt;
    if (charPrompt && !effectivePrompt.includes(charPrompt)) {
      effectivePrompt = `${charPrompt}, ${effectivePrompt}`;
    }
    if (preset?.promptPrefix && !effectivePrompt.startsWith(preset.promptPrefix)) {
      effectivePrompt = `${preset.promptPrefix} ${effectivePrompt}`;
    }
    if (preset?.promptSuffix && !effectivePrompt.endsWith(preset.promptSuffix)) {
      effectivePrompt = `${effectivePrompt}${preset.promptSuffix}`;
    }

    let effectiveNegative = beat.negative_prompt || "";
    if (preset?.negativePrompt) {
      effectiveNegative = effectiveNegative ? `${preset.negativePrompt}, ${effectiveNegative}` : preset.negativePrompt;
    }

    const vaultPath = (this.app.vault.adapter as any).getBasePath ? (this.app.vault.adapter as any).getBasePath() : "";
    let relOutputPath = beat.output;
    if (!relOutputPath) {
      const folder = this.settings.outputFolderPattern.replace("{scene}", sceneSlug);
      relOutputPath = `${folder}/${beatSlug}_${titleSlug}.png`;
    }

    const absOutputPath = path.isAbsolute(relOutputPath) ? relOutputPath : path.join(vaultPath, relOutputPath);
    const absMetaPath = absOutputPath.replace(/\.[^.]+$/, ".meta.json");

    const cliArgs: string[] = [this.settings.cliPath, "generate"];
    if (this.settings.modelsDir && this.settings.modelsDir.trim()) {
      cliArgs.push("--models-dir", this.settings.modelsDir.trim());
    }
    cliArgs.push("--model", model);
    cliArgs.push("--prompt", effectivePrompt);
    if (effectiveNegative.trim()) {
      cliArgs.push("--negative-prompt", effectiveNegative.trim());
    }
    cliArgs.push("--width", String(width));
    cliArgs.push("--height", String(height));
    cliArgs.push("--steps", String(steps));
    cliArgs.push("--cfg", String(cfg));
    cliArgs.push("--seed", String(seed));
    cliArgs.push("--disable-preview");
    cliArgs.push("--output", absOutputPath);

    if (beat.image) {
      const absInputImg = path.isAbsolute(beat.image) ? beat.image : path.join(vaultPath, beat.image);
      cliArgs.push("--image", absInputImg);
      if (beat.strength !== undefined) {
        cliArgs.push("--strength", String(beat.strength));
      }
    }

    if (beat.config_json || preset?.configJson) {
      cliArgs.push("--config-json", beat.config_json || preset!.configJson!);
    }

    return {
      id: `${beat.id}-${Date.now()}`,
      beatId: beat.id,
      notePath: sourcePath,
      scene: beat.scene || "Scene",
      beatNumber: beat.beat,
      title: beat.title || `Beat ${beat.beat}`,
      prompt: beat.prompt,
      effectivePrompt,
      model,
      seed,
      width,
      height,
      steps,
      cfg,
      outputPath: absOutputPath,
      metaPath: absMetaPath,
      cliArgs,
      status: "pending" as const,
      progress: 0,
      statusMessage: "Queued",
      logs: []
    };
  }
}
