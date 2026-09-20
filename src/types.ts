export interface StylePreset {
  name: string;
  description?: string;
  promptPrefix?: string;
  promptSuffix?: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  configJson?: string;
}

export interface ShootLora {
  file: string;
  weight: number;
  version?: string;
  mode?: string;
}

export interface ShootConfig {
  id: string;
  name: string;
  category?: string;
  description?: string;
  model: string;
  loras?: ShootLora[];
  lora?: string;
  lora_weight?: number;
  steps: number;
  width: number;
  height: number;
  cfg: number;
  refine_mode?: PromptRefineMode;
  auto_refine?: boolean | string;
  prompt_anchor?: string;
  raw_configuration?: Record<string, any>;
  is_builtin?: boolean;
  is_drawthings_app?: boolean;
}

export type LLMProvider = "smart-composer" | "ollama" | "lm-studio" | "anthropic" | "openai" | "gemini" | "custom";

export type PromptRefineMode = "unified" | "visionary" | "eni_bible" | "disabled";

export interface DrawThingsSettings {
  cliPath: string;
  modelsDir: string;
  defaultModel: string;
  outputFolderPattern: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultSteps: number;
  defaultCfg: number;
  enableCharacterResolution: boolean;
  characterFolders: string[];
  presets: Record<string, StylePreset>;

  // Shoot & Config Lookup (Alfred Workflow parity)
  activeShoot: string;
  promptRefineMode: PromptRefineMode;
  autoRefine: boolean;
  customConfigsPath?: string;

  // LLM / AI Automation Settings
  llmProvider: LLMProvider;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  targetBeatCount: number;
  customSystemPrompt?: string;
}

export interface PlotBeatData {
  id: string;
  beat: number | string;
  title?: string;
  scene?: string;
  character?: string;
  preset?: string;
  shoot?: string;
  refine?: string | boolean;
  model?: string;
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  aspect?: string; // e.g. "2:3", "16:9", "1:1", "9:16", "3:4", "4:3"
  steps?: number;
  cfg?: number;
  seed?: number;
  image?: string;
  strength?: number;
  loras?: ShootLora[];
  prompt_anchor?: string;
  config_json?: string;
  output?: string;
}

export interface SceneScriptData {
  scene: string;
  preset?: string;
  shoot?: string;
  refine?: string | boolean;
  model?: string;
  aspect?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed_start?: number;
  beats: PlotBeatData[];
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GenerationJob {
  id: string;
  beatId: string;
  notePath: string;
  scene: string;
  beatNumber: string | number;
  title: string;
  prompt: string;
  effectivePrompt: string;
  refinedPrompt?: string;
  shootName?: string;
  model: string;
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  outputPath: string;
  metaPath: string;
  cliArgs: string[];
  configJson?: string;
  status: JobStatus;
  progress: number;
  statusMessage: string;
  logs: string[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

