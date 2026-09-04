import { StylePreset } from "./types";

export const DEFAULT_PRESETS: Record<string, StylePreset> = {
  "pure-moonlit": {
    name: "Pure Moonlit",
    description: "Cool 6500K rain-window chiaroscuro, graphite highlights, obsidian shadows",
    promptSuffix: ", only key light is cool blue-grey light of rain-streaked sash-window at 6500K, cool fill, cool rim, true moonlit chiaroscuro, specular highlights icy-blue or graphite, Kodak Portra 400 film aesthetic, shallow depth of field, 85mm lens, sharp focus on subject, authentic film grain",
    negativePrompt: "warm lighting, amber glow, brass tones, yellow lamp, 3d render, cartoon, oversaturated, blurry, plastic skin, smooth airbrushed",
    width: 1024,
    height: 1536,
    steps: 12,
    cfg: 1.5
  },
  "turbo-preview": {
    name: "Turbo Preview",
    description: "Ultra-fast preview generation using Z-Image Turbo",
    model: "z_image_turbo_1.0_q8p.ckpt",
    width: 1024,
    height: 1024,
    steps: 8,
    cfg: 1.5,
    promptSuffix: ", clear cinematic details, photorealistic lighting"
  },
  "cinematic": {
    name: "Cinematic Wide",
    description: "16:9 cinematic anamorphic frame with dramatic lighting",
    width: 1344,
    height: 768,
    steps: 16,
    cfg: 2.0,
    promptSuffix: ", 35mm anamorphic film still, moody cinematic lighting, masterpiece, photorealistic, Panavision lens flare, shallow depth of field"
  },
  "editorial-portrait": {
    name: "Editorial Portrait",
    description: "Close/medium portrait with natural skin texture and 85mm lens",
    width: 1024,
    height: 1536,
    steps: 16,
    cfg: 2.0,
    promptSuffix: ", editorial portrait photography, 85mm f/1.4 lens, natural skin texture with visible pores and fine micro-detail, soft catchlight in eyes, masterpiece, professional magazine quality"
  }
};

export function parseAspectRatio(aspectStr: string, baseDimension: number = 1024): { width: number; height: number } | null {
  if (!aspectStr) return null;
  const parts = aspectStr.trim().split(/[:x×/]/);
  if (parts.length !== 2) return null;
  const wRatio = parseFloat(parts[0]);
  const hRatio = parseFloat(parts[1]);
  if (isNaN(wRatio) || isNaN(hRatio) || wRatio <= 0 || hRatio <= 0) return null;

  // If actual dimensions given like 1024x1536
  if (wRatio >= 256 && hRatio >= 256) {
    return {
      width: roundToMultipleOf64(wRatio),
      height: roundToMultipleOf64(hRatio)
    };
  }

  // Calculate based on aspect ratio
  if (wRatio === hRatio) {
    return { width: 1024, height: 1024 };
  } else if (wRatio < hRatio) {
    // Portrait (e.g. 2:3 -> 1024 x 1536)
    const w = baseDimension;
    const h = roundToMultipleOf64(baseDimension * (hRatio / wRatio));
    return { width: w, height: h };
  } else {
    // Landscape (e.g. 3:2 -> 1536 x 1024, 16:9 -> 1344 x 768)
    const h = baseDimension > 896 ? 768 : baseDimension;
    const w = roundToMultipleOf64(h * (wRatio / hRatio));
    return { width: w, height: h };
  }
}

export function roundToMultipleOf64(n: number): number {
  return Math.max(64, Math.round(n / 64) * 64);
}
