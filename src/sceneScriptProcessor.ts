import { App, MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import * as yaml from "yaml";
import * as path from "path";
import * as fs from "fs";
import { DrawThingsSettings, GenerationJob, PlotBeatData, SceneScriptData, ShootConfig } from "./types";
import { QueueManager } from "./queue";
import { CharacterResolver } from "./characterResolver";
import { DEFAULT_PRESETS, parseAspectRatio, roundToMultipleOf64 } from "./presetResolver";
import { ConfigLookup } from "./configLookup";
import { PromptRefiner } from "./promptRefiner";
import { PromptRefineModal } from "./refineModal";

export class SceneScriptProcessor {
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
    const container = el.createDiv({ cls: "drawthings-scene-container" });

    let parsed: any;
    try {
      parsed = yaml.parse(source) || {};
    } catch (e: any) {
      container.createDiv({ cls: "drawthings-error", text: `YAML parsing error: ${e.message}` });
      return;
    }

    const currentFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    const fileBasename = currentFile instanceof TFile ? currentFile.basename : "Scene";

    const sceneData = this.normalizeSceneData(parsed, fileBasename);
    this.renderSceneDeck(container, sceneData, ctx);
  }

  private normalizeSceneData(raw: any, fileBasename: string): SceneScriptData {
    const scene = raw.scene || fileBasename || "Scene";
    const preset = raw.preset;
    const shoot = raw.shoot || raw.preset;
    const refine = raw.refine;
    const model = raw.model || this.settings.defaultModel;
    const aspect = raw.aspect || raw.ratio;
    const seedStart = raw.seed_start !== undefined ? Number(raw.seed_start) : undefined;

    const rawBeats = Array.isArray(raw.beats) ? raw.beats : [];
    const beats: PlotBeatData[] = rawBeats.map((b: any, index: number) => {
      const beatNum = b.beat !== undefined ? b.beat : index + 1;
      const title = b.title || `Beat ${beatNum}`;
      const id = `${scene}-${beatNum}-${title}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

      let seed = b.seed;
      if (seed === undefined && seedStart !== undefined) {
        seed = seedStart + index;
      }

      return {
        id,
        beat: beatNum,
        title,
        scene,
        character: b.character,
        preset: b.preset || preset,
        shoot: b.shoot || shoot,
        refine: b.refine !== undefined ? b.refine : refine,
        model: b.model || model,
        prompt: b.prompt || "",
        negative_prompt: b.negative_prompt || b.negative || raw.negative_prompt || raw.negative,
        width: b.width || raw.width,
        height: b.height || raw.height,
        aspect: b.aspect || aspect,
        steps: b.steps || raw.steps,
        cfg: b.cfg || raw.cfg,
        seed: seed !== undefined ? Number(seed) : undefined,
        image: b.image,
        strength: b.strength,
        prompt_anchor: b.prompt_anchor || raw.prompt_anchor,
        config_json: b.config_json || raw.config_json,
        output: b.output
      };
    });

    return {
      scene,
      preset,
      shoot,
      refine,
      model,
      aspect,
      width: raw.width,
      height: raw.height,
      steps: raw.steps,
      cfg: raw.cfg,
      seed_start: seedStart,
      beats
    };
  }

  private async buildJobForBeat(beat: PlotBeatData, sourcePath: string): Promise<GenerationJob> {
    const sceneSlug = beat.scene?.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "scene";
    const beatSlug = String(beat.beat).padStart(2, "0");
    const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    // 1. Resolve Shoot / Preset
    const shootQuery = beat.shoot || beat.preset || this.settings.activeShoot;
    const shoot = this.configLookup.getShoot(shootQuery);
    const presetKey = beat.preset || "";
    const preset = this.settings.presets[presetKey] || DEFAULT_PRESETS[presetKey];

    let model = beat.model || shoot?.model || preset?.model || this.settings.defaultModel;

    // LoRA compatibility
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

    const steps = beat.steps || shoot?.steps || preset?.steps || this.settings.defaultSteps;
    const cfg = beat.cfg || shoot?.cfg || preset?.cfg || this.settings.defaultCfg;
    const seed = beat.seed !== undefined ? beat.seed : Math.floor(Math.random() * 2000000000);

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

  private renderSceneDeck(container: HTMLElement, sceneData: SceneScriptData, ctx: MarkdownPostProcessorContext): void {
    const deck = container.createDiv({ cls: "drawthings-scene-deck" });

    const shootQuery = sceneData.shoot || sceneData.preset || this.settings.activeShoot;
    const shoot = this.configLookup.getShoot(shootQuery);

    // Scene Top Bar
    const topBar = deck.createDiv({ cls: "drawthings-scene-topbar" });
    const topBarLeft = topBar.createDiv({ cls: "drawthings-scene-topbar-left" });
    topBarLeft.createEl("h3", { cls: "drawthings-scene-title", text: `🎬 ${sceneData.scene}` });

    const topBarRight = topBar.createDiv({ cls: "drawthings-scene-topbar-right" });
    if (shoot) {
      topBarRight.createSpan({ cls: "drawthings-badge shoot-badge", text: `🎬 ${shoot.name}` });
    } else if (sceneData.preset) {
      topBarRight.createSpan({ cls: "drawthings-badge preset-badge", text: `🎨 ${sceneData.preset}` });
    }
    topBarRight.createSpan({ cls: "drawthings-badge model-badge", text: `📦 ${shoot?.model || sceneData.model || this.settings.defaultModel}` });
    const countBadge = topBarRight.createSpan({ cls: "drawthings-badge count-badge", text: `0 / ${sceneData.beats.length} Generated` });

    // Action Controls
    const controls = deck.createDiv({ cls: "drawthings-scene-controls" });
    const btnGenerateAll = controls.createEl("button", { cls: "mod-cta drawthings-btn", text: "⚡ Generate All Scene Plates" });
    const btnCancelAll = controls.createEl("button", { cls: "mod-warning drawthings-btn", text: "🛑 Stop Queue" });

    // Grid of Beats
    const grid = deck.createDiv({ cls: "drawthings-storyboard-grid" });

    const vaultPath = (this.app.vault.adapter as any).getBasePath ? (this.app.vault.adapter as any).getBasePath() : "";
    const sceneSlug = sceneData.scene.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    const refreshCounter = () => {
      let done = 0;
      for (const beat of sceneData.beats) {
        const beatSlug = String(beat.beat).padStart(2, "0");
        const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
        const defaultRel = `${this.settings.outputFolderPattern.replace("{scene}", sceneSlug)}/${beatSlug}_${titleSlug}.png`;
        const rel = beat.output || defaultRel;
        const abs = path.isAbsolute(rel) ? rel : path.join(vaultPath, rel);
        if (fs.existsSync(abs)) done++;
      }
      countBadge.setText(`${done} / ${sceneData.beats.length} Generated`);
    };

    refreshCounter();

    // Render Beat Cards in Grid
    for (const beat of sceneData.beats) {
      const beatCard = grid.createDiv({ cls: "drawthings-grid-card" });
      const beatSlug = String(beat.beat).padStart(2, "0");
      const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      const defaultRel = `${this.settings.outputFolderPattern.replace("{scene}", sceneSlug)}/${beatSlug}_${titleSlug}.png`;
      const rel = beat.output || defaultRel;
      const abs = path.isAbsolute(rel) ? rel : path.join(vaultPath, rel);

      const cardHead = beatCard.createDiv({ cls: "drawthings-grid-card-head" });
      cardHead.createSpan({ cls: "drawthings-badge beat-badge", text: `Beat ${beat.beat}` });
      if (beat.character) {
        cardHead.createSpan({ cls: "drawthings-badge char-badge", text: beat.character });
      }

      const imgWrapper = beatCard.createDiv({ cls: "drawthings-grid-thumb-wrapper" });
      const titleEl = beatCard.createDiv({ cls: "drawthings-grid-title", text: beat.title || `Beat ${beat.beat}` });
      const promptEl = beatCard.createDiv({ cls: "drawthings-grid-prompt", text: beat.prompt });

      const cardFoot = beatCard.createDiv({ cls: "drawthings-grid-card-foot" });
      const btnGen = cardFoot.createEl("button", { cls: "drawthings-btn drawthings-btn-sm", text: "Generate" });
      const btnRefine = cardFoot.createEl("button", { cls: "drawthings-btn drawthings-btn-sm", text: "🧠 Refine" });
      const statusSpan = cardFoot.createSpan({ cls: "drawthings-grid-status", text: "Pending" });

      const updateCardState = () => {
        imgWrapper.empty();
        if (fs.existsSync(abs)) {
          statusSpan.setText("✓ Ready");
          statusSpan.className = "drawthings-grid-status status-ready";
          btnGen.setText("Regen");
          const resourceUri = `app://local${abs}?t=${Date.now()}`;
          const img = imgWrapper.createEl("img", {
            cls: "drawthings-grid-img",
            attr: { src: resourceUri, alt: beat.title || "Plate" }
          });
          img.addEventListener("click", () => window.open(`file://${abs}`));
        } else {
          statusSpan.setText("Missing");
          statusSpan.className = "drawthings-grid-status status-missing";
          btnGen.setText("Generate");
          imgWrapper.createDiv({ cls: "drawthings-thumb-placeholder", text: "No Image" });
        }
      };

      updateCardState();

      btnGen.addEventListener("click", async () => {
        const job = await this.buildJobForBeat(beat, ctx.sourcePath);
        this.queue.enqueue(job);
      });

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
              promptEl.setText(newPrompt);
            }
          ).open();
        } else {
          new Notice("Cannot locate active note file.");
        }
      });

      this.queue.subscribe((job) => {
        if (job.beatId === beat.id) {
          if (job.status === "running") {
            statusSpan.setText(`${job.progress}%`);
            statusSpan.className = "drawthings-grid-status status-active";
          } else if (job.status === "pending") {
            statusSpan.setText("Queued");
          } else {
            updateCardState();
            refreshCounter();
          }
        }
      });
    }

    btnGenerateAll.addEventListener("click", async () => {
      new Notice(`Enqueuing ${sceneData.beats.length} beats for "${sceneData.scene}"...`);
      for (const beat of sceneData.beats) {
        const job = await this.buildJobForBeat(beat, ctx.sourcePath);
        this.queue.enqueue(job);
      }
    });

    btnCancelAll.addEventListener("click", () => {
      this.queue.cancelAll();
    });
  }
}
