import { App, MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import * as yaml from "yaml";
import * as path from "path";
import * as fs from "fs";
import { DrawThingsSettings, GenerationJob, PlotBeatData } from "./types";
import { QueueManager } from "./queue";
import { CharacterResolver } from "./characterResolver";
import { DEFAULT_PRESETS, parseAspectRatio, roundToMultipleOf64 } from "./presetResolver";

export class PlotbeatProcessor {
  private app: App;
  private settings: DrawThingsSettings;
  private queue: QueueManager;
  private charResolver: CharacterResolver;

  constructor(app: App, settings: DrawThingsSettings, queue: QueueManager, charResolver: CharacterResolver) {
    this.app = app;
    this.settings = settings;
    this.queue = queue;
    this.charResolver = charResolver;
  }

  updateSettings(settings: DrawThingsSettings) {
    this.settings = settings;
  }

  async process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    el.empty();
    const container = el.createDiv({ cls: "drawthings-card-container" });

    let parsed: any;
    try {
      parsed = yaml.parse(source) || {};
    } catch (e) {
      container.createDiv({ cls: "drawthings-error", text: `YAML parsing error: ${e.message}` });
      return;
    }

    const currentFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    const fileBasename = currentFile instanceof TFile ? currentFile.basename : "Scene";

    const beatData = this.normalizeBeatData(parsed, fileBasename, ctx.sourcePath);
    this.renderCard(container, beatData, ctx);
  }

  private normalizeBeatData(raw: any, fileBasename: string, sourcePath: string): PlotBeatData {
    const beat = raw.beat ?? 1;
    const scene = raw.scene || fileBasename || "Scene";
    const title = raw.title || `Beat ${beat}`;
    const id = `${scene}-${beat}-${title}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    return {
      id,
      beat,
      title,
      scene,
      character: raw.character,
      preset: raw.preset,
      model: raw.model || this.settings.defaultModel,
      prompt: raw.prompt || "",
      negative_prompt: raw.negative_prompt || raw.negative || "",
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
    };
  }

  private async resolveJobParameters(beat: PlotBeatData, sourcePath: string): Promise<GenerationJob> {
    const sceneSlug = beat.scene?.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "scene";
    const beatSlug = String(beat.beat).padStart(2, "0");
    const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    // Resolve Preset
    const presetKey = beat.preset || "";
    const preset = this.settings.presets[presetKey] || DEFAULT_PRESETS[presetKey];

    // Model
    const model = beat.model || preset?.model || this.settings.defaultModel;

    // Dimensions
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

    // Steps & CFG
    const steps = beat.steps || preset?.steps || this.settings.defaultSteps;
    const cfg = beat.cfg || preset?.cfg || this.settings.defaultCfg;

    // Seed
    const seed = beat.seed !== undefined ? beat.seed : Math.floor(Math.random() * 2000000000);

    // Character Resolution
    let charPrompt = "";
    if (this.settings.enableCharacterResolution && beat.character) {
      charPrompt = await this.charResolver.resolveCharacterPrompt(beat.character, this.settings.characterFolders);
    }

    // Effective Prompt Assembly
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

    // Effective Negative Prompt
    let effectiveNegative = beat.negative_prompt || "";
    if (preset?.negativePrompt) {
      effectiveNegative = effectiveNegative ? `${preset.negativePrompt}, ${effectiveNegative}` : preset.negativePrompt;
    }

    // Determine Absolute Output Paths
    const vaultPath = (this.app.vault.adapter as any).getBasePath ? (this.app.vault.adapter as any).getBasePath() : "";
    let relOutputPath = beat.output;
    if (!relOutputPath) {
      const folder = this.settings.outputFolderPattern.replace("{scene}", sceneSlug);
      relOutputPath = `${folder}/${beatSlug}_${titleSlug}.png`;
    }

    const absOutputPath = path.isAbsolute(relOutputPath) ? relOutputPath : path.join(vaultPath, relOutputPath);
    const absMetaPath = absOutputPath.replace(/\.[^.]+$/, ".meta.json");

    // CLI Arguments Assembly
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
      status: "pending",
      progress: 0,
      statusMessage: "Queued",
      logs: []
    };
  }

  private renderCard(container: HTMLElement, beat: PlotBeatData, ctx: MarkdownPostProcessorContext): void {
    const card = container.createDiv({ cls: "drawthings-beat-card" });

    // Header
    const header = card.createDiv({ cls: "drawthings-card-header" });
    const headerLeft = header.createDiv({ cls: "drawthings-card-header-left" });

    const beatBadge = headerLeft.createSpan({ cls: "drawthings-badge beat-badge", text: `Beat ${beat.beat}` });
    if (beat.title) {
      headerLeft.createSpan({ cls: "drawthings-beat-title", text: beat.title });
    }

    const headerRight = header.createDiv({ cls: "drawthings-card-header-right" });
    if (beat.character) {
      headerRight.createSpan({ cls: "drawthings-badge char-badge", text: `👤 ${beat.character}` });
    }
    if (beat.preset) {
      headerRight.createSpan({ cls: "drawthings-badge preset-badge", text: `🎨 ${beat.preset}` });
    }
    const statusBadge = headerRight.createSpan({ cls: "drawthings-badge status-badge status-idle", text: "Idle" });

    // Output file resolution
    const vaultPath = (this.app.vault.adapter as any).getBasePath ? (this.app.vault.adapter as any).getBasePath() : "";
    const sceneSlug = beat.scene?.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "scene";
    const beatSlug = String(beat.beat).padStart(2, "0");
    const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const defaultRel = `${this.settings.outputFolderPattern.replace("{scene}", sceneSlug)}/${beatSlug}_${titleSlug}.png`;
    const relOutputPath = beat.output || defaultRel;
    const absOutputPath = path.isAbsolute(relOutputPath) ? relOutputPath : path.join(vaultPath, relOutputPath);

    // Body
    const body = card.createDiv({ cls: "drawthings-card-body" });

    // Image preview area
    const previewArea = body.createDiv({ cls: "drawthings-preview-area" });
    const imgContainer = previewArea.createDiv({ cls: "drawthings-image-wrapper" });

    // Prompt description
    const promptSec = body.createDiv({ cls: "drawthings-prompt-section" });
    promptSec.createEl("p", { cls: "drawthings-prompt-text", text: beat.prompt || "No prompt provided." });

    // Progress bar container (hidden by default)
    const progressContainer = card.createDiv({ cls: "drawthings-progress-container is-hidden" });
    const progressBar = progressContainer.createDiv({ cls: "drawthings-progress-bar" });
    const progressFill = progressBar.createDiv({ cls: "drawthings-progress-fill" });
    const progressStatus = progressContainer.createSpan({ cls: "drawthings-progress-text", text: "Ready" });

    // Actions footer
    const footer = card.createDiv({ cls: "drawthings-card-footer" });
    const actionGroup = footer.createDiv({ cls: "drawthings-action-group" });

    const btnGenerate = actionGroup.createEl("button", { cls: "mod-cta drawthings-btn", text: "🎨 Generate Plate" });
    const btnReroll = actionGroup.createEl("button", { cls: "drawthings-btn", text: "🎲 Re-roll Seed" });
    const btnCopyLink = actionGroup.createEl("button", { cls: "drawthings-btn", text: "📋 Copy Embed" });
    const btnCancel = actionGroup.createEl("button", { cls: "mod-warning drawthings-btn is-hidden", text: "🛑 Cancel" });

    const metaSpecs = footer.createDiv({ cls: "drawthings-meta-specs" });
    metaSpecs.createSpan({ text: `${beat.model || this.settings.defaultModel} • Seed: ${beat.seed ?? "Auto"}` });

    const updateImageDisplay = () => {
      imgContainer.empty();
      if (fs.existsSync(absOutputPath)) {
        statusBadge.className = "drawthings-badge status-badge status-done";
        statusBadge.setText("Generated");
        btnGenerate.setText("🔄 Regenerate");

        // Convert path to Obsidian-safe URI
        const resourceUri = `app://local${absOutputPath}?t=${Date.now()}`;
        const img = imgContainer.createEl("img", {
          cls: "drawthings-preview-img",
          attr: { src: resourceUri, alt: beat.title || "Plot Beat Plate" }
        });

        img.addEventListener("click", () => {
          window.open(`file://${absOutputPath}`);
        });

        btnCopyLink.removeClass("is-hidden");
        btnReroll.removeClass("is-hidden");
      } else {
        statusBadge.className = "drawthings-badge status-badge status-idle";
        statusBadge.setText("Not Generated");
        btnGenerate.setText("🎨 Generate Plate");
        btnCopyLink.addClass("is-hidden");
        btnReroll.addClass("is-hidden");
        imgContainer.createDiv({ cls: "drawthings-placeholder", text: "No plate generated yet." });
      }
    };

    updateImageDisplay();

    // Trigger Generation
    const triggerGeneration = async (seedOverride?: number) => {
      const activeBeat = { ...beat };
      if (seedOverride !== undefined) {
        activeBeat.seed = seedOverride;
      }
      const job = await this.resolveJobParameters(activeBeat, ctx.sourcePath);
      this.queue.enqueue(job);
    };

    btnGenerate.addEventListener("click", () => triggerGeneration());
    btnReroll.addEventListener("click", () => {
      const currentSeed = beat.seed !== undefined ? beat.seed + 1 : Math.floor(Math.random() * 2000000000);
      beat.seed = currentSeed;
      metaSpecs.setText(`${beat.model || this.settings.defaultModel} • Seed: ${currentSeed}`);
      triggerGeneration(currentSeed);
    });

    btnCopyLink.addEventListener("click", () => {
      const embedMarkdown = `![[${relOutputPath}]]`;
      navigator.clipboard.writeText(embedMarkdown);
      new Notice(`Copied: ${embedMarkdown}`);
    });

    btnCancel.addEventListener("click", () => {
      const job = this.queue.getJobForBeat(beat.id);
      if (job) {
        this.queue.cancelJob(job.id);
      }
    });

    // Subscribe to Queue events
    const unsubscribe = this.queue.subscribe((job) => {
      if (job.beatId !== beat.id) return;

      if (job.status === "running") {
        statusBadge.className = "drawthings-badge status-badge status-generating";
        statusBadge.setText(`Generating (${job.progress}%)`);
        progressContainer.removeClass("is-hidden");
        progressFill.style.width = `${job.progress}%`;
        progressStatus.setText(job.statusMessage);
        btnCancel.removeClass("is-hidden");
        btnGenerate.addClass("is-hidden");
        btnReroll.addClass("is-hidden");
      } else if (job.status === "pending") {
        statusBadge.className = "drawthings-badge status-badge status-queued";
        statusBadge.setText("Queued");
        progressContainer.removeClass("is-hidden");
        progressFill.style.width = "5%";
        progressStatus.setText("Waiting in queue...");
        btnCancel.removeClass("is-hidden");
      } else {
        progressContainer.addClass("is-hidden");
        btnCancel.addClass("is-hidden");
        btnGenerate.removeClass("is-hidden");
        updateImageDisplay();
      }
    });

    // Check initial status if already running/pending
    const active = this.queue.getJobForBeat(beat.id);
    if (active && (active.status === "running" || active.status === "pending")) {
      progressContainer.removeClass("is-hidden");
      progressFill.style.width = `${active.progress}%`;
      progressStatus.setText(active.statusMessage);
      statusBadge.setText(active.status === "running" ? `Generating (${active.progress}%)` : "Queued");
      btnCancel.removeClass("is-hidden");
    }
  }
}
