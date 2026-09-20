import { App, MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import * as yaml from "yaml";
import * as path from "path";
import * as fs from "fs";
import { DrawThingsSettings, GenerationJob, PlotBeatData, ShootConfig } from "./types";
import { QueueManager } from "./queue";
import { CharacterResolver } from "./characterResolver";
import { DEFAULT_PRESETS, parseAspectRatio, roundToMultipleOf64 } from "./presetResolver";
import { ConfigLookup } from "./configLookup";
import { PromptRefiner } from "./promptRefiner";
import { PromptRefineModal } from "./refineModal";

export class PlotbeatProcessor {
  private app: App;
  private settings: DrawThingsSettings;
  private queue: QueueManager;
  private charResolver: CharacterResolver;
  private configLookup: ConfigLookup;
  private promptRefiner: PromptRefiner;

  constructor(
    app: App,
    settings: DrawThingsSettings,
    queue: QueueManager,
    charResolver: CharacterResolver,
    configLookup: ConfigLookup,
    promptRefiner: PromptRefiner
  ) {
    this.app = app;
    this.settings = settings;
    this.queue = queue;
    this.charResolver = charResolver;
    this.configLookup = configLookup;
    this.promptRefiner = promptRefiner;
  }

  updateSettings(settings: DrawThingsSettings) {
    this.settings = settings;
    if (this.configLookup) {
      this.configLookup.setModelsDir(settings.modelsDir);
    }
  }

  async process(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    el.empty();
    const container = el.createDiv({ cls: "drawthings-card-container" });

    let parsed: any;
    try {
      parsed = yaml.parse(source) || {};
    } catch (e: any) {
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
      shoot: raw.shoot || raw.preset,
      refine: raw.refine,
      model: raw.model,
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
      prompt_anchor: raw.prompt_anchor,
      config_json: raw.config_json,
      output: raw.output
    };
  }

  private async resolveJobParameters(beat: PlotBeatData, sourcePath: string): Promise<GenerationJob> {
    const sceneSlug = beat.scene?.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "scene";
    const beatSlug = String(beat.beat).padStart(2, "0");
    const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    // 1. Resolve Shoot / Preset via ConfigLookup or Preset
    const shootQuery = beat.shoot || beat.preset || this.settings.activeShoot;
    const shoot = this.configLookup.getShoot(shootQuery);
    const presetKey = beat.preset || "";
    const preset = this.settings.presets[presetKey] || DEFAULT_PRESETS[presetKey];

    // Model
    let model = beat.model || shoot?.model || preset?.model || this.settings.defaultModel;

    // Check LoRA compatibility if shoot defines LoRA
    const effectiveLora = shoot?.lora || "none";
    if (effectiveLora && effectiveLora.toLowerCase() !== "none") {
      const fixed = this.configLookup.checkAndFixModelLoraCompatibility(model, effectiveLora);
      model = fixed.model;
    }

    // Dimensions
    let width = beat.width;
    let height = beat.height;
    if ((!width || !height) && (beat.aspect || shoot?.width || preset?.width)) {
      if (beat.aspect) {
        const dims = parseAspectRatio(beat.aspect);
        if (dims) {
          width = dims.width;
          height = dims.height;
        }
      } else if (shoot?.width && shoot?.height) {
        width = shoot.width;
        height = shoot.height;
      } else if (preset?.width && preset?.height) {
        width = preset.width;
        height = preset.height;
      }
    }
    width = roundToMultipleOf64(width || this.settings.defaultWidth);
    height = roundToMultipleOf64(height || this.settings.defaultHeight);

    // Steps & CFG
    const steps = beat.steps || shoot?.steps || preset?.steps || this.settings.defaultSteps;
    const cfg = beat.cfg || shoot?.cfg || preset?.cfg || this.settings.defaultCfg;

    // Seed
    const seed = beat.seed !== undefined ? beat.seed : Math.floor(Math.random() * 2000000000);

    // Character Resolution
    let charPrompt = "";
    if (this.settings.enableCharacterResolution && beat.character) {
      charPrompt = await this.charResolver.resolveCharacterPrompt(beat.character, this.settings.characterFolders);
    }

    // Check Prompt Refinement
    const shouldRefine = (beat.refine !== false && beat.refine !== "false") &&
      (Boolean(beat.refine) || this.settings.autoRefine || String(shoot?.auto_refine).toLowerCase() === "true");

    let effectivePrompt = beat.prompt;

    if (shouldRefine) {
      const mode = (typeof beat.refine === "string" ? beat.refine : null) || shoot?.refine_mode || this.settings.promptRefineMode || "unified";
      try {
        new Notice(`🧠 Refining Beat ${beat.beat} prompt with ${mode.toUpperCase()} AI...`);
        effectivePrompt = await this.promptRefiner.refine(effectivePrompt, {
          mode: mode as any,
          promptAnchor: beat.prompt_anchor || shoot?.prompt_anchor,
          characterPrompt: charPrompt
        });
      } catch (e: any) {
        console.error("[DrawThings] Auto-refine failed:", e);
      }
    } else {
      if (charPrompt && !effectivePrompt.includes(charPrompt)) {
        effectivePrompt = `${charPrompt}, ${effectivePrompt}`;
      }
      if (preset?.promptPrefix && !effectivePrompt.startsWith(preset.promptPrefix)) {
        effectivePrompt = `${preset.promptPrefix} ${effectivePrompt}`;
      }
      if (preset?.promptSuffix && !effectivePrompt.endsWith(preset.promptSuffix)) {
        effectivePrompt = `${effectivePrompt}${preset.promptSuffix}`;
      }
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

    // Build --config-json overrides (multi-LoRA stack and app settings)
    const configJson = beat.config_json || (shoot ? this.configLookup.buildConfigJson(shoot) : (preset?.configJson || ""));
    if (configJson) {
      cliArgs.push("--config-json", configJson);
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
      shootName: shoot?.name,
      configJson,
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

    const shootQuery = beat.shoot || beat.preset || this.settings.activeShoot;
    const shoot = this.configLookup.getShoot(shootQuery);

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
    if (shoot) {
      headerRight.createSpan({ cls: "drawthings-badge shoot-badge", text: `🎬 ${shoot.name}` });
    } else if (beat.preset) {
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
    const btnRefine = actionGroup.createEl("button", { cls: "drawthings-btn", text: "🧠 Refine Prompt" });
    const btnReroll = actionGroup.createEl("button", { cls: "drawthings-btn", text: "🎲 Re-roll Seed" });
    const btnCopyLink = actionGroup.createEl("button", { cls: "drawthings-btn", text: "📋 Copy Embed" });
    const btnCancel = actionGroup.createEl("button", { cls: "mod-warning drawthings-btn is-hidden", text: "🛑 Cancel" });

    const metaSpecs = footer.createDiv({ cls: "drawthings-meta-specs" });
    metaSpecs.createSpan({ text: `${shoot?.model || beat.model || this.settings.defaultModel} • Seed: ${beat.seed ?? "Auto"}` });

    btnRefine.addEventListener("click", () => {
      const currentFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (currentFile instanceof TFile) {
        new PromptRefineModal(
          this.app,
          beat,
          currentFile,
          shoot,
          this.promptRefiner,
          this.charResolver,
          this.queue,
          this.settings,
          this.configLookup,
          (newPrompt) => {
            beat.prompt = newPrompt;
            promptSec.empty();
            promptSec.createEl("p", { cls: "drawthings-prompt-text", text: newPrompt });
          }
        ).open();
      } else {
        new Notice("Cannot locate active note file.");
      }
    });

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
