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

export type LLMProvider = "smart-composer" | "ollama" | "lm-studio" | "anthropic" | "openai" | "gemini" | "custom";

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
  config_json?: string;
  output?: string;
}

export interface SceneScriptData {
  scene: string;
  preset?: string;
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
  model: string;
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  outputPath: string;
  metaPath: string;
  cliArgs: string[];
  status: JobStatus;
  progress: number;
  statusMessage: string;
  logs: string[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
}
