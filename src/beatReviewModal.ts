import { App, Modal, Notice, MarkdownView, TFile } from "obsidian";
import * as yaml from "yaml";
import { PlotBeatData, DrawThingsSettings, SceneScriptData } from "./types";
import { QueueManager } from "./queue";

export class BeatReviewModal extends Modal {
  private sceneName: string;
  private preset: string;
  private beats: PlotBeatData[];
  private targetFile: TFile;
  private queue: QueueManager;
  private settings: DrawThingsSettings;
  private selectedBeats: Set<number> = new Set();

  constructor(
    app: App,
    sceneName: string,
    preset: string,
    beats: PlotBeatData[],
    targetFile: TFile,
    queue: QueueManager,
    settings: DrawThingsSettings
  ) {
    super(app);
    this.sceneName = sceneName;
    this.preset = preset;
    this.beats = beats;
    this.targetFile = targetFile;
    this.queue = queue;
    this.settings = settings;

    // Default select all
    this.beats.forEach((_, idx) => this.selectedBeats.add(idx));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("drawthings-modal-container");

    const header = contentEl.createDiv({ cls: "drawthings-modal-header" });
    header.createEl("h2", { text: `✨ AI Plot Beats: ${this.sceneName}` });
    header.createEl("p", {
      text: `Review, edit, or select the visual beats below before inserting into "${this.targetFile.basename}".`,
      cls: "drawthings-modal-subtitle"
    });

    const listEl = contentEl.createDiv({ cls: "drawthings-modal-beat-list" });

    this.beats.forEach((beat, idx) => {
      const card = listEl.createDiv({ cls: "drawthings-modal-beat-card" });

      const topRow = card.createDiv({ cls: "drawthings-modal-beat-top" });
      const leftCol = topRow.createDiv({ cls: "drawthings-modal-beat-left" });

      const cb = leftCol.createEl("input", { type: "checkbox" });
      cb.checked = this.selectedBeats.has(idx);
      cb.addEventListener("change", () => {
        if (cb.checked) this.selectedBeats.add(idx);
        else this.selectedBeats.delete(idx);
      });

      leftCol.createSpan({ cls: "drawthings-badge beat-badge", text: `Beat ${beat.beat}` });

      const titleInput = leftCol.createEl("input", {
        type: "text",
        cls: "drawthings-modal-title-input",
        value: beat.title || `Beat ${beat.beat}`
      });
      titleInput.addEventListener("input", () => {
        beat.title = titleInput.value;
      });

      const rightCol = topRow.createDiv({ cls: "drawthings-modal-beat-right" });
      const charInput = rightCol.createEl("input", {
        type: "text",
        cls: "drawthings-modal-char-input",
        placeholder: "Character",
        value: beat.character || ""
      });
      charInput.addEventListener("input", () => {
        beat.character = charInput.value;
      });

      const seedInput = rightCol.createEl("input", {
        type: "number",
        cls: "drawthings-modal-seed-input",
        value: String(beat.seed || 1001 + idx)
      });
      seedInput.addEventListener("input", () => {
        beat.seed = Number(seedInput.value);
      });

      const promptArea = card.createEl("textarea", {
        cls: "drawthings-modal-prompt-textarea",
        text: beat.prompt
      });
      promptArea.rows = 3;
      promptArea.addEventListener("input", () => {
        beat.prompt = promptArea.value;
      });
    });

    // Action Buttons
    const footer = contentEl.createDiv({ cls: "drawthings-modal-footer" });
    const btnGroup = footer.createDiv({ cls: "drawthings-modal-buttons" });

    const btnInsertScriptTop = btnGroup.createEl("button", {
      cls: "mod-cta drawthings-btn",
      text: "📥 Insert Scene Script (Top)"
    });
    btnInsertScriptTop.addEventListener("click", () => {
      this.insertSceneScript(true);
    });

    const btnInsertScriptBottom = btnGroup.createEl("button", {
      cls: "drawthings-btn",
      text: "📥 Insert Scene Script (Bottom)"
    });
    btnInsertScriptBottom.addEventListener("click", () => {
      this.insertSceneScript(false);
    });

    const btnInsertInline = btnGroup.createEl("button", {
      cls: "drawthings-btn",
      text: "📄 Insert as Inline Beats"
    });
    btnInsertInline.addEventListener("click", () => {
      this.insertInlinePlotbeats();
    });

    const btnQueueNow = btnGroup.createEl("button", {
      cls: "mod-cta drawthings-btn drawthings-btn-highlight",
      text: "⚡ Insert & Queue Generations"
    });
    btnQueueNow.addEventListener("click", () => {
      this.insertSceneScript(false);
      this.queueSelectedBeats();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private getFilteredBeats(): PlotBeatData[] {
    return this.beats.filter((_, idx) => this.selectedBeats.has(idx));
  }

  private async insertSceneScript(atTop: boolean) {
    const activeBeats = this.getFilteredBeats();
    if (activeBeats.length === 0) {
      new Notice("No beats selected.");
      return;
    }

    const scriptObj = {
      scene: this.sceneName,
      preset: this.preset,
      model: this.settings.defaultModel,
      aspect: "1024x1536",
      seed_start: activeBeats[0]?.seed || 1001,
      beats: activeBeats.map(b => ({
        beat: b.beat,
        title: b.title,
        character: b.character || undefined,
        prompt: b.prompt,
        seed: b.seed
      }))
    };

    const yamlStr = yaml.stringify(scriptObj);
    const block = `\n\`\`\`scene-script\n${yamlStr}\`\`\`\n`;

    const content = await this.app.vault.read(this.targetFile);
    let newContent = "";

    if (atTop) {
      // If frontmatter exists, insert after frontmatter
      const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
      if (fmMatch) {
        newContent = content.slice(0, fmMatch[0].length) + block + content.slice(fmMatch[0].length);
      } else {
        newContent = block + content;
      }
    } else {
      newContent = content + "\n\n" + block;
    }

    await this.app.vault.modify(this.targetFile, newContent);
    new Notice(`Inserted scene script block into ${this.targetFile.basename}!`);
    this.close();
  }

  private async insertInlinePlotbeats() {
    const activeBeats = this.getFilteredBeats();
    if (activeBeats.length === 0) {
      new Notice("No beats selected.");
      return;
    }

    let blocks = "\n\n## Visual Scene Plates\n";
    for (const b of activeBeats) {
      const beatObj = {
        beat: b.beat,
        title: b.title,
        scene: this.sceneName,
        character: b.character || undefined,
        preset: this.preset,
        model: this.settings.defaultModel,
        aspect: "2:3",
        seed: b.seed,
        prompt: b.prompt
      };
      blocks += `\n\`\`\`plotbeat\n${yaml.stringify(beatObj)}\`\`\`\n`;
    }

    const content = await this.app.vault.read(this.targetFile);
    await this.app.vault.modify(this.targetFile, content + blocks);
    new Notice(`Inserted ${activeBeats.length} inline plotbeats into ${this.targetFile.basename}!`);
    this.close();
  }

  private async queueSelectedBeats() {
    const activeBeats = this.getFilteredBeats();
    const vaultPath = (this.app.vault.adapter as any).getBasePath ? (this.app.vault.adapter as any).getBasePath() : "";
    const sceneSlug = this.sceneName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    for (const beat of activeBeats) {
      const beatSlug = String(beat.beat).padStart(2, "0");
      const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const relOutputPath = `${this.settings.outputFolderPattern.replace("{scene}", sceneSlug)}/${beatSlug}_${titleSlug}.png`;
      const absOutputPath = `${vaultPath}/${relOutputPath}`;
      const absMetaPath = absOutputPath.replace(/\.[^.]+$/, ".meta.json");

      const cliArgs = [
        this.settings.cliPath,
        "generate",
        "--model",
        this.settings.defaultModel,
        "--prompt",
        beat.prompt,
        "--width",
        String(this.settings.defaultWidth),
        "--height",
        String(this.settings.defaultHeight),
        "--steps",
        String(this.settings.defaultSteps),
        "--cfg",
        String(this.settings.defaultCfg),
        "--seed",
        String(beat.seed || 1001),
        "--disable-preview",
        "--output",
        absOutputPath
      ];

      this.queue.enqueue({
        id: `${beat.id}-${Date.now()}`,
        beatId: beat.id,
        notePath: this.targetFile.path,
        scene: this.sceneName,
        beatNumber: beat.beat,
        title: beat.title || `Beat ${beat.beat}`,
        prompt: beat.prompt,
        effectivePrompt: beat.prompt,
        model: this.settings.defaultModel,
        seed: beat.seed || 1001,
        width: this.settings.defaultWidth,
        height: this.settings.defaultHeight,
        steps: this.settings.defaultSteps,
        cfg: this.settings.defaultCfg,
        outputPath: absOutputPath,
        metaPath: absMetaPath,
        cliArgs,
        status: "pending",
        progress: 0,
        statusMessage: "Queued",
        logs: []
      });
    }

    new Notice(`Queued ${activeBeats.length} plates for generation!`);
  }
}
