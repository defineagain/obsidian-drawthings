import { PlotBeatData } from "./types";

export function buildBeatExtractionPrompt(
  sceneTitle: string,
  sceneText: string,
  targetCount: number = 4,
  activePreset: string = "pure-moonlit",
  knownCharacters: string[] = []
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are an elite cinematic storyboard director and visual narrative illustrator specializing in high-end photographic scene plates for literary novels.

Your task is to analyze a novel scene and extract exactly ${targetCount} key visual plot beats representing the crucial emotional thresholds, spatial entrances, dramatic climaxes, and turning points.

For each beat, formulate a detailed, photographic image generation prompt:
1. TRANSLATE PSYCHOLOGY INTO PHYSICAL REALITY: Never use abstract literary metaphors (e.g. "armor of intellect", "line of flight"). Convert interior states into visible, physical details: posture, dilated pupils, tense jaw, hand placement, trembling fingers, wet skin, fabric tension.
2. PHOTOGRAPHIC COMPOSITION & CAMERA: Specify lens and framing (e.g., "85mm tight portrait", "35mm environmental medium shot", "low-angle dramatic chiaroscuro").
3. LIGHTING & ENVIRONMENT: Specify the exact light sources (e.g., "cool 6500K blue-grey rain light through sash window, true obsidian shadow, graphite specular rim, no warm fill").
4. CHARACTER ACCURACY: Accurately assign the character's name to the 'character' field if present. Known characters in this universe: ${knownCharacters.join(", ") || "Alex, Sofia Adebayo, Sylvie Beck, Kikaya, Petra, Clara"}.
5. SEEDS: Assign continuous sequential integer seeds starting at 1001 (1001, 1002, 1003...).

You MUST output strictly valid JSON inside a \`\`\`json code fence in the following format:

\`\`\`json
{
  "scene": "${sceneTitle}",
  "preset": "${activePreset}",
  "beats": [
    {
      "beat": 1,
      "title": "Short Beat Title",
      "character": "Character Name",
      "prompt": "Full photographic description with camera, lighting, pose, clothing, and atmosphere...",
      "seed": 1001
    }
  ]
}
\`\`\``;

  const userPrompt = `SCENE TITLE: ${sceneTitle}
TARGET BEAT COUNT: ${targetCount}
PRESET: ${activePreset}

SCENE TEXT TO ANALYZE:
---
${sceneText.slice(0, 12000)}
---

Extract the ${targetCount} key visual beats and return ONLY the JSON block.`;

  return { systemPrompt, userPrompt };
}

export function parseBeatsResponse(rawText: string, sceneFallback: string): { scene: string; preset?: string; beats: PlotBeatData[] } {
  let cleaned = rawText.trim();

  // Strip markdown code fences if present
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  } else {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    } else {
      const firstBracket = cleaned.indexOf("[");
      const lastBracket = cleaned.lastIndexOf("]");
      if (firstBracket !== -1 && lastBracket !== -1) {
        cleaned = cleaned.substring(firstBracket, lastBracket + 1);
      }
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse AI response into JSON: ${err.message}\nResponse snippet: ${rawText.slice(0, 250)}...`);
  }

  let rawBeats: any[] = [];
  let scene = sceneFallback || "Scene";
  let preset = "pure-moonlit";

  if (Array.isArray(parsed)) {
    rawBeats = parsed;
  } else if (parsed && typeof parsed === "object") {
    scene = parsed.scene || sceneFallback || "Scene";
    preset = parsed.preset || "pure-moonlit";
    rawBeats = Array.isArray(parsed.beats) ? parsed.beats : [];
  }

  const beats: PlotBeatData[] = rawBeats.map((b: any, idx: number) => {
    const beatNum = b.beat !== undefined ? b.beat : idx + 1;
    const title = b.title || `Beat ${beatNum}`;
    const id = `${scene}-${beatNum}-${title}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

    return {
      id,
      beat: beatNum,
      title,
      scene,
      character: b.character || "",
      preset: b.preset || preset,
      prompt: b.prompt || "",
      seed: b.seed !== undefined ? Number(b.seed) : 1001 + idx
    };
  });

  return { scene, preset, beats };
}
