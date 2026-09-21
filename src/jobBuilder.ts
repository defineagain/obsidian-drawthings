import { App } from "obsidian";
import * as path from "path";
import { DrawThingsSettings, GenerationJob, PlotBeatData, ShootConfig } from "./types";
import { ConfigLookup } from "./configLookup";
import { DEFAULT_PRESETS, parseAspectRatio, roundToMultipleOf64 } from "./presetResolver";

/**
 * Resolves a safe filesystem path within the Obsidian vault, defending against
 * directory traversal attacks (e.g. "../../../etc/passwd").
 */
export function resolveSafeVaultPath(
  vaultPath: string,
  userPath: string | undefined,
  defaultRelPath: string
): string {
  const target = userPath && userPath.trim() ? userPath.trim() : defaultRelPath;

  if (!vaultPath) {
    return target;
  }

  const normalized = path.normalize(target);

  if (path.isAbsolute(normalized)) {
    // If user specified an absolute path, only allow if it stays within vaultPath
    if (normalized.startsWith(vaultPath)) {
      return normalized;
    }
    // Confine to vault root
    console.warn(`[DrawThings Security] Absolute path outside vault detected ("${userPath}"). Confining to vault.`);
    const safeFilename = path.basename(normalized);
    return path.join(vaultPath, safeFilename);
  }

  // Relative path: resolve against vaultPath
  const resolved = path.resolve(vaultPath, normalized);
  if (!resolved.startsWith(vaultPath)) {
    console.warn(`[DrawThings Security] Directory traversal detected ("${userPath}"). Confining to vault.`);
    const safeFilename = path.basename(normalized);
    return path.join(vaultPath, safeFilename);
  }

  return resolved;
}

/**
 * Build a complete, validated GenerationJob from PlotBeatData and current settings.
 */
export async function buildGenerationJob(
  app: App,
  beat: PlotBeatData,
  sourcePath: string,
  settings: DrawThingsSettings,
  configLookup: ConfigLookup,
  promptOverride?: string
): Promise<GenerationJob> {
  const sceneSlug = beat.scene?.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "scene";
  const beatSlug = String(beat.beat).padStart(2, "0");
  const titleSlug = (beat.title || "beat").toLowerCase().replace(/[^a-z0-9_-]/g, "_");

  // 1. Resolve Shoot / Preset
  let shoot: ShootConfig | undefined;
  if (beat.shoot) {
    shoot = configLookup.getShoot(beat.shoot);
  } else if (beat.preset) {
    // Only treat beat.preset as a shoot if it matches a shoot in configLookup
    shoot = configLookup.getShoot(beat.preset);
  }
  // Only fall back to settings.activeShoot if NEITHER shoot nor preset was specified on the beat
  if (!shoot && !beat.preset && settings.activeShoot) {
    shoot = configLookup.getShoot(settings.activeShoot);
  }

  const presetKey = beat.preset || "";
  const preset = settings.presets[presetKey] || DEFAULT_PRESETS[presetKey];

  // 2. Model & LoRA compatibility
  // Explicit beat model takes top priority, then shoot model, then preset model, then default
  let model = beat.model || shoot?.model || preset?.model || settings.defaultModel;
  const effectiveLora = shoot?.lora || "none";
  if (effectiveLora && effectiveLora.toLowerCase() !== "none") {
    // If user explicitly specified their own model on the beat, don't let shoot LoRA change model architecture
    const userSpecifiedModel = Boolean(beat.model);
    if (!userSpecifiedModel) {
      const fixed = configLookup.checkAndFixModelLoraCompatibility(model, effectiveLora);
      model = fixed.model;
    }
  }

  // 3. Dimensions
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
  width = roundToMultipleOf64(width || settings.defaultWidth);
  height = roundToMultipleOf64(height || settings.defaultHeight);

  // 4. Steps & CFG
  const steps = beat.steps || shoot?.steps || preset?.steps || settings.defaultSteps;
  const cfg = beat.cfg || shoot?.cfg || preset?.cfg || settings.defaultCfg;

  // 5. Seed
  const seed = beat.seed !== undefined ? beat.seed : Math.floor(Math.random() * 2000000000);

  // 6. Effective Prompt
  const effectivePrompt = promptOverride ? promptOverride.trim() : beat.prompt;

  // 7. Negative Prompt
  let effectiveNegative = beat.negative_prompt || "";
  if (preset?.negativePrompt) {
    effectiveNegative = effectiveNegative
      ? `${preset.negativePrompt}, ${effectiveNegative}`
      : preset.negativePrompt;
  }

  // 8. Output & Metadata Paths
  const vaultPath = (app.vault.adapter as any).getBasePath
    ? (app.vault.adapter as any).getBasePath()
    : "";
  const defaultFolder = settings.outputFolderPattern.replace("{scene}", sceneSlug);
  const defaultRelPath = `${defaultFolder}/${beatSlug}_${titleSlug}.png`;

  const absOutputPath = resolveSafeVaultPath(vaultPath, beat.output, defaultRelPath);
  const absMetaPath = absOutputPath.replace(/\.[^.]+$/, ".meta.json");

  // 9. Assemble CLI Arguments
  const cliArgs: string[] = [settings.cliPath, "generate"];
  if (settings.modelsDir && settings.modelsDir.trim()) {
    cliArgs.push("--models-dir", settings.modelsDir.trim());
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
    const absInputImg = resolveSafeVaultPath(vaultPath, beat.image, beat.image);
    cliArgs.push("--image", absInputImg);
    if (beat.strength !== undefined) {
      cliArgs.push("--strength", String(beat.strength));
    }
  }

  // 10. Build --config-json overrides
  const configJson =
    beat.config_json ||
    (shoot ? configLookup.buildConfigJson(shoot) : preset?.configJson || "");
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
