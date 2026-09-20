import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ShootConfig, ShootLora, PromptRefineMode } from "./types";

export const BUILTIN_SHOOTS: ShootConfig[] = [
  {
    id: "bath_georgian",
    name: "Bath Georgian Editorial",
    category: "Editorial Photography",
    description: "Architectural editorial portraiture in dark oak Georgian study with 35mm lens and honey lighting",
    model: "z_image_turbo_1.0_q8p.ckpt",
    lora: "mystic__lora_f16.ckpt",
    lora_weight: 1.0,
    steps: 8,
    width: 1024,
    height: 1024,
    cfg: 1.0,
    refine_mode: "unified",
    auto_refine: true,
    prompt_anchor: "Bath Georgian study, dark oak paneling, tall sash windows, 35mm lens, Three-Quarter 45 camera position, warm honey 3000K lighting",
    is_builtin: true
  },
  {
    id: "krea_mystic",
    name: "Krea 2 Mystic Fashion",
    category: "High Fashion",
    description: "High fashion styling utilizing Krea 2 Turbo and Mystic Krea2 LoRA for editorial runway aesthetic",
    model: "krea_2_turbo_q8p.ckpt",
    lora: "mystic_krea2_v2_lora_f16.ckpt",
    lora_weight: 1.0,
    steps: 8,
    width: 1024,
    height: 1024,
    cfg: 1.0,
    refine_mode: "unified",
    auto_refine: true,
    prompt_anchor: "high fashion editorial, tailored luxury fabrics, structured silhouette, studio rim lighting",
    is_builtin: true
  },
  {
    id: "vogue_portrait",
    name: "Vogue Italia Studio (3:4)",
    category: "Studio Portrait",
    description: "Vertical 3:4 editorial portrait with Roversi shoulder-forward pose and pure ENI Shoot Bible lighting",
    model: "z_image_turbo_1.0_q8p.ckpt",
    lora: "mystic__lora_f16.ckpt",
    lora_weight: 0.8,
    steps: 8,
    width: 896,
    height: 1152,
    cfg: 1.0,
    refine_mode: "eni_bible",
    auto_refine: true,
    prompt_anchor: "Vogue Italia editorial plate, Paolo Roversi style, 3-layer wardrobe, soft north-facing side daylight, 50mm lens",
    is_builtin: true
  },
  {
    id: "flux2_klein",
    name: "FLUX.2 Klein Editorial (4-Step)",
    category: "Next-Gen Diffusion",
    description: "Ultra-fast high-fidelity FLUX.2 Klein KV model with prompt refinement in just 4 sampling steps",
    model: "flux_2_klein_9b_kv_q8p.ckpt",
    lora: "none",
    lora_weight: 0.0,
    steps: 4,
    width: 1024,
    height: 1024,
    cfg: 1.0,
    refine_mode: "unified",
    auto_refine: true,
    prompt_anchor: "FLUX.2 high-detail editorial aesthetic, crisp photorealistic focus, natural textures, volumetric atmosphere",
    is_builtin: true
  },
  {
    id: "ideogram4_fast",
    name: "Ideogram 4 Fast (8-bit)",
    category: "Typography & Graphic Design",
    description: "Ideogram 4 fast model with superb text rendering, graphic layout, and photorealistic realism",
    model: "ideogram_4_fast_i8x.ckpt",
    lora: "none",
    lora_weight: 0.0,
    steps: 8,
    width: 1024,
    height: 1024,
    cfg: 1.0,
    refine_mode: "unified",
    auto_refine: true,
    prompt_anchor: "crisp graphic clarity, clean typography, precise edges, commercial studio quality",
    is_builtin: true
  },
  {
    id: "analog_35mm",
    name: "35mm Analog Film Realism",
    category: "Analog Film",
    description: "Textured analog film look on 35mm with natural grain, skin pores, and soft daylight contrast",
    model: "z_image_turbo_1.0_q8p.ckpt",
    lora: "mystic__lora_f16.ckpt",
    lora_weight: 0.6,
    steps: 12,
    width: 1152,
    height: 896,
    cfg: 1.5,
    refine_mode: "visionary",
    auto_refine: true,
    prompt_anchor: "35mm film photograph, Kodak Portra 400 texture, natural skin pores, realistic depth of field, subtle film grain",
    is_builtin: true
  },
  {
    id: "dark_fantasy",
    name: "Dark Fantasy & Atmospheric Noir",
    category: "Atmospheric Noir",
    description: "Moody, high-contrast dark fantasy aesthetics with deep shadows, rim backlight, and rich textures",
    model: "z_image_turbo_1.0_q8p.ckpt",
    lora: "mystic__lora_f16.ckpt",
    lora_weight: 1.0,
    steps: 8,
    width: 1024,
    height: 1024,
    cfg: 1.0,
    refine_mode: "visionary",
    auto_refine: true,
    prompt_anchor: "dark fantasy noir, volumetric rim lighting, dramatic chiaroscuro shadows, opulent velvet textures, atmospheric haze",
    is_builtin: true
  },
  {
    id: "raw_speed",
    name: "Raw Direct Speed (No Refine)",
    category: "Minimalist / Speed",
    description: "Fast generation directly executing the exact raw prompt without LLM prompt refinement",
    model: "z_image_turbo_1.0_q8p.ckpt",
    lora: "none",
    lora_weight: 0.0,
    steps: 8,
    width: 1024,
    height: 1024,
    cfg: 1.0,
    refine_mode: "unified",
    auto_refine: false,
    prompt_anchor: "",
    is_builtin: true
  }
];

export class ConfigLookup {
  private customShoots: ShootConfig[] = [];
  private allShoots: ShootConfig[] = [];
  private loraVersionMap: Map<string, string> = new Map();
  private modelsDir: string = "";

  constructor(customModelsDir?: string) {
    this.modelsDir = this.resolveModelsDir(customModelsDir);
    this.reloadConfigs();
  }

  setModelsDir(customModelsDir: string) {
    this.modelsDir = this.resolveModelsDir(customModelsDir);
    this.reloadConfigs();
  }

  getModelsDir(): string {
    return this.modelsDir;
  }

  private resolveModelsDir(customDir?: string): string {
    if (customDir && customDir.trim()) {
      const expanded = this.expandHome(customDir.trim());
      if (fs.existsSync(expanded)) return expanded;
    }

    const appModelsDir = path.join(
      os.homedir(),
      "Library",
      "Containers",
      "com.liuliu.draw-things",
      "Data",
      "Documents",
      "Models"
    );
    if (fs.existsSync(appModelsDir)) {
      return appModelsDir;
    }

    return appModelsDir;
  }

  private expandHome(filepath: string): string {
    if (filepath.startsWith("~/") || filepath === "~") {
      return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
  }

  reloadConfigs(): void {
    this.loadCustomLoraMetadata();
    const dtShoots = this.loadDrawThingsAppConfigs();
    const userShoots = this.loadAlfredCustomShoots();

    const merged: ShootConfig[] = [...BUILTIN_SHOOTS];
    const seenIds = new Set<string>(BUILTIN_SHOOTS.map(s => s.id.toLowerCase()));

    // Add Draw Things App Saved Presets
    for (const dt of dtShoots) {
      if (!seenIds.has(dt.id.toLowerCase())) {
        merged.push(dt);
        seenIds.add(dt.id.toLowerCase());
      }
    }

    // Add Alfred User Shoots
    for (const us of userShoots) {
      if (!seenIds.has(us.id.toLowerCase())) {
        merged.push(us);
        seenIds.add(us.id.toLowerCase());
      }
    }

    this.allShoots = merged;
  }

  private loadCustomLoraMetadata(): void {
    this.loraVersionMap.clear();
    const loraJsonPath = path.join(this.modelsDir, "custom_lora.json");
    if (fs.existsSync(loraJsonPath)) {
      try {
        const raw = fs.readFileSync(loraJsonPath, "utf8");
        const items = JSON.parse(raw);
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item.file && item.version) {
              this.loraVersionMap.set(item.file, item.version);
            }
          }
        }
      } catch (e) {
        console.warn("[ConfigLookup] Failed to parse custom_lora.json:", e);
      }
    }
  }

  findLoraVersion(loraFilename: string, modelFilename: string = ""): string {
    if (this.loraVersionMap.has(loraFilename)) {
      return this.loraVersionMap.get(loraFilename)!;
    }

    const m = modelFilename.toLowerCase();
    const l = loraFilename.toLowerCase();

    if (m.includes("z_image") || m.includes("zit") || l.includes("z_image") || l.includes("zit") || l.includes("mystic__")) {
      return "z_image";
    } else if (m.includes("ideogram") || l.includes("ideogram")) {
      return "ideogram_4";
    } else if (m.includes("flux_2") || m.includes("klein") || l.includes("flux2") || l.includes("klein")) {
      return "flux2_9b";
    } else if (m.includes("flux") || l.includes("flux1")) {
      return "flux1";
    } else if (m.includes("krea") || l.includes("krea")) {
      return "krea_2";
    } else if (m.includes("sdxl") || l.includes("xl")) {
      return "sdxl";
    }

    return "z_image";
  }

  checkAndFixModelLoraCompatibility(modelFilename: string, loraFilename: string): { model: string; lora: string; version: string } {
    if (!loraFilename || loraFilename.toLowerCase() === "none") {
      return { model: modelFilename, lora: "none", version: "" };
    }

    // Auto-remap deprecated mystic_z_lora_f16.ckpt to mystic__lora_f16.ckpt
    let resolvedLora = loraFilename;
    if (resolvedLora === "mystic_z_lora_f16.ckpt") {
      resolvedLora = "mystic__lora_f16.ckpt";
    }

    // Check physical file existence on disk
    const physicalPath = path.join(this.modelsDir, resolvedLora);
    if (!fs.existsSync(physicalPath)) {
      console.warn(`[ConfigLookup] LoRA '${resolvedLora}' not found in ${this.modelsDir}. Disabling LoRA to prevent CLI error.`);
      return { model: modelFilename, lora: "none", version: "" };
    }

    const loraVer = this.findLoraVersion(resolvedLora, modelFilename);
    const mLower = modelFilename.toLowerCase();

    let modelArch = "z_image";
    if (mLower.includes("krea")) {
      modelArch = "krea_2";
    } else if (mLower.includes("flux_2") || mLower.includes("klein")) {
      modelArch = "flux2_9b";
    } else if (mLower.includes("flux")) {
      modelArch = "flux1";
    } else if (mLower.includes("ideogram")) {
      modelArch = "ideogram_4";
    } else if (mLower.includes("sdxl") || mLower.includes("xl")) {
      modelArch = "sdxl";
    }

    if (loraVer !== modelArch) {
      if (loraVer === "krea_2" && modelArch === "z_image") {
        return { model: "krea_2_turbo_q8p.ckpt", lora: resolvedLora, version: "krea_2" };
      } else if (loraVer === "z_image" && modelArch === "krea_2") {
        return { model: "z_image_turbo_1.0_q8p.ckpt", lora: resolvedLora, version: "z_image" };
      } else if (loraVer === "flux2_9b" && modelArch !== "flux2_9b") {
        return { model: "flux_2_klein_9b_kv_q8p.ckpt", lora: resolvedLora, version: "flux2_9b" };
      } else if (loraVer === "ideogram_4" && modelArch !== "ideogram_4") {
        return { model: "ideogram_4_fast_i8x.ckpt", lora: resolvedLora, version: "ideogram_4" };
      } else {
        console.warn(`[ConfigLookup] LoRA '${resolvedLora}' (${loraVer}) incompatible with model '${modelFilename}' (${modelArch}). Disabling LoRA.`);
        return { model: modelFilename, lora: "none", version: loraVer };
      }
    }

    return { model: modelFilename, lora: resolvedLora, version: loraVer };
  }

  private loadDrawThingsAppConfigs(): ShootConfig[] {
    const customConfigsPath = path.join(this.modelsDir, "custom_configs.json");
    const cachePath = path.join(os.homedir(), ".config", "drawthings-alfred", "custom_configs_cache.json");
    let configs: any[] = [];

    if (fs.existsSync(customConfigsPath)) {
      try {
        const raw = fs.readFileSync(customConfigsPath, "utf8");
        configs = JSON.parse(raw);
        // Update cache if possible
        try {
          const cacheDir = path.dirname(cachePath);
          if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(cachePath, JSON.stringify(configs, null, 2), "utf8");
        } catch (e) {}
      } catch (e) {
        console.warn("[ConfigLookup] Could not read custom_configs.json:", e);
      }
    }

    if ((!configs || configs.length === 0) && fs.existsSync(cachePath)) {
      try {
        const raw = fs.readFileSync(cachePath, "utf8");
        configs = JSON.parse(raw);
      } catch (e) {}
    }

    const appShoots: ShootConfig[] = [];
    if (!Array.isArray(configs)) return appShoots;

    for (const item of configs) {
      const name = (item.name || "").trim();
      const cfg = item.configuration || {};
      if (!name || Object.keys(cfg).length === 0) continue;

      const shootId = "dt_" + name.toLowerCase().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
      const model = cfg.model || "z_image_turbo_1.0_q8p.ckpt";
      const steps = parseInt(cfg.steps ?? 8, 10);
      const width = parseInt(cfg.width ?? 1024, 10);
      const height = parseInt(cfg.height ?? 1024, 10);
      const guidance = parseFloat(cfg.guidanceScale ?? 1.0);

      // Parse and validate LoRAs that exist on disk
      const rawLoras: any[] = Array.isArray(cfg.loras) ? cfg.loras : [];
      const validLoras: ShootLora[] = [];
      for (const l of rawLoras) {
        const lFile = l.file || "";
        if (!lFile) continue;
        const exists = fs.existsSync(path.join(this.modelsDir, lFile));
        if (exists) {
          const lWeight = parseFloat(l.weight ?? 1.0);
          const lVer = this.findLoraVersion(lFile, model);
          validLoras.push({
            file: lFile,
            weight: lWeight,
            version: lVer,
            mode: l.mode || "all"
          });
        }
      }

      const firstLora = validLoras.length > 0 ? validLoras[0].file : "none";
      const firstWeight = validLoras.length > 0 ? validLoras[0].weight : 1.0;

      let loraSummary = "No LoRA";
      if (validLoras.length > 1) {
        loraSummary = `${validLoras.length} LoRAs`;
      } else if (validLoras.length === 1) {
        loraSummary = `${validLoras[0].file} (${Math.round(firstWeight * 100) / 100})`;
      }

      appShoots.push({
        id: shootId,
        name: name,
        category: "Draw Things Saved",
        description: `Draw Things saved preset: ${model} | ${loraSummary} | ${width}x${height} | ${steps} steps`,
        model,
        loras: validLoras,
        lora: firstLora,
        lora_weight: firstWeight,
        steps,
        width,
        height,
        cfg: guidance,
        refine_mode: "unified",
        auto_refine: false,
        prompt_anchor: "",
        raw_configuration: cfg,
        is_builtin: false,
        is_drawthings_app: true
      });
    }

    return appShoots;
  }

  private loadAlfredCustomShoots(): ShootConfig[] {
    const shootsFile = path.join(os.homedir(), ".config", "drawthings-alfred", "shoots.json");
    if (!fs.existsSync(shootsFile)) return [];

    try {
      const raw = fs.readFileSync(shootsFile, "utf8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return list.map(s => ({
          ...s,
          is_builtin: false
        }));
      }
    } catch (e) {
      console.warn("[ConfigLookup] Could not read Alfred shoots.json:", e);
    }
    return [];
  }

  getAllShoots(): ShootConfig[] {
    return this.allShoots;
  }

  getShoot(idOrName?: string): ShootConfig {
    if (!idOrName || !idOrName.trim()) {
      return this.allShoots[0] || BUILTIN_SHOOTS[0];
    }

    const clean = idOrName.trim().toLowerCase();

    // 1. Exact match on id or name
    for (const s of this.allShoots) {
      if (s.id.toLowerCase() === clean || s.name.toLowerCase() === clean) {
        return s;
      }
    }

    // 2. Match with/without 'dt_' prefix
    const noPrefix = clean.replace(/^dt_/, "");
    for (const s of this.allShoots) {
      if (s.id.toLowerCase().replace(/^dt_/, "") === noPrefix || s.name.toLowerCase() === noPrefix) {
        return s;
      }
    }

    // 3. Partial substring match
    for (const s of this.allShoots) {
      if (s.id.toLowerCase().includes(clean) || s.name.toLowerCase().includes(clean)) {
        return s;
      }
    }

    return this.allShoots[0] || BUILTIN_SHOOTS[0];
  }

  buildConfigJson(shoot: ShootConfig, extraOverrides?: Record<string, any>): string {
    const loraConfig: Record<string, any> = {};

    // Multi-LoRA stack
    if (shoot.loras && Array.isArray(shoot.loras) && shoot.loras.length > 0) {
      const validList: any[] = [];
      for (const l of shoot.loras) {
        if (l.file && fs.existsSync(path.join(this.modelsDir, l.file))) {
          validList.push({
            file: l.file,
            weight: Number(l.weight ?? 1.0),
            version: l.version || this.findLoraVersion(l.file, shoot.model)
          });
        }
      }
      if (validList.length > 0) {
        loraConfig.loras = validList;
      }
    } else if (shoot.lora && shoot.lora.toLowerCase() !== "none") {
      const fixed = this.checkAndFixModelLoraCompatibility(shoot.model, shoot.lora);
      if (fixed.lora !== "none") {
        loraConfig.loras = [
          {
            file: fixed.lora,
            weight: Number(shoot.lora_weight ?? 1.0),
            version: fixed.version
          }
        ];
      }
    }

    // Extra app configuration parameters (shift, sampler, etc.)
    const rawCfg = shoot.raw_configuration || {};
    if (rawCfg.shift !== undefined && rawCfg.shift !== null) {
      loraConfig.shift = rawCfg.shift;
    }
    if (rawCfg.sampler !== undefined && rawCfg.sampler !== null) {
      loraConfig.sampler = rawCfg.sampler;
    }

    // Merge any extra overrides passed
    if (extraOverrides) {
      Object.assign(loraConfig, extraOverrides);
    }

    return Object.keys(loraConfig).length > 0 ? JSON.stringify(loraConfig) : "";
  }
}
