import * as esbuild from "esbuild";
import { createRequire } from "module";
import assert from "assert";

const require = createRequire(import.meta.url);
const yaml = require("yaml");

async function run() {
  const result = await esbuild.build({
    entryPoints: ["src/noteUpdater.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external: ["yaml"]
  });

  const code = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function("module", "exports", "require", code);
  fn(mod, mod.exports, require);

  const {
    formatPromptForYaml,
    updatePromptInBeatLines,
    updateSceneScriptBody,
    updatePlotbeatBody,
    updatePromptInNoteContent
  } = mod.exports;

  console.log("Running unit tests for noteUpdater...");

  // Test 1: formatPromptForYaml
  assert.strictEqual(formatPromptForYaml("hello", "  "), '  prompt: "hello"');
  assert.strictEqual(formatPromptForYaml("line 1\nline 2", "  "), '  prompt: |\n    line 1\n    line 2');
  console.log("✓ Test 1: formatPromptForYaml passed");

  // Test 2: duplicate prompt key removal in beat lines
  const lines = [
    "  - beat: 1",
    "    prompt: |",
    "      first prompt",
    "    title: The Door Opens First",
    "    character: Sofia Adebayo",
    "    prompt: \"second prompt duplicate\"",
    "    seed: 1001"
  ];
  const updatedLines = updatePromptInBeatLines(lines, "Refined prompt\nSecond line");
  const joined = updatedLines.join("\n");
  const promptCount = (joined.match(/prompt:/g) || []).length;
  assert.strictEqual(promptCount, 1, `Expected 1 prompt: key, got ${promptCount}`);

  // Strict YAML parse (uniqueKeys: true default)
  const parsedBeat = yaml.parse("beats:\n" + joined);
  assert.strictEqual(parsedBeat.beats[0].beat, 1);
  assert.strictEqual(parsedBeat.beats[0].title, "The Door Opens First");
  assert.strictEqual(parsedBeat.beats[0].character, "Sofia Adebayo");
  assert.strictEqual(parsedBeat.beats[0].seed, 1001);
  assert.strictEqual(parsedBeat.beats[0].prompt, "Refined prompt\nSecond line\n");
  console.log("✓ Test 2: duplicate prompt key removal passed");

  // Test 3: updateSceneScriptBody with multiple beats
  const script = `scene: Alex and Sofia close the loop
preset: pure-moonlit
beats:
  - beat: 1
    prompt: |
      corrupted 1
    title: The Door Opens First
    character: Sofia Adebayo
    prompt: "corrupted 2"
    seed: 1001
  - beat: 2
    title: "Three Pieces: Breath Speech Exit"
    character: Sofia Adebayo
    prompt: "35mm environmental shot"
    seed: 1002
`;
  const updatedScript = updateSceneScriptBody(script, { beat: 1 }, "Fresh prompt for beat 1\nLine 2");
  assert(updatedScript !== null);
  const parsedScript = yaml.parse(updatedScript);
  assert.strictEqual(parsedScript.beats.length, 2);
  assert.strictEqual(parsedScript.beats[0].prompt, "Fresh prompt for beat 1\nLine 2\n");
  assert.strictEqual(parsedScript.beats[0].seed, 1001);
  assert.strictEqual(parsedScript.beats[1].title, "Three Pieces: Breath Speech Exit");
  assert.strictEqual(parsedScript.beats[1].prompt, "35mm environmental shot");
  console.log("✓ Test 3: updateSceneScriptBody passed");

  // Test 4: updatePlotbeatBody duplicate elimination
  const plotbeat = `beat: 1
title: Standalone
prompt: "Old prompt 1"
character: Alex
prompt: "Old prompt 2"
seed: 999`;
  const updatedPlotbeat = updatePlotbeatBody(plotbeat, "Refined standalone\nWith multi-line");
  const parsedPlotbeat = yaml.parse(updatedPlotbeat);
  assert.strictEqual(parsedPlotbeat.beat, 1);
  assert.strictEqual(parsedPlotbeat.title, "Standalone");
  assert.strictEqual(parsedPlotbeat.prompt, "Refined standalone\nWith multi-line\n");
  assert.strictEqual(parsedPlotbeat.character, "Alex");
  assert.strictEqual(parsedPlotbeat.seed, 999);
  console.log("✓ Test 4: updatePlotbeatBody passed");

  // Test 5: updatePromptInNoteContent end-to-end
  const fullNote = `---
tags:
  - output
---

\`\`\`scene-script
scene: Test
beats:
  - beat: 1
    prompt: |
      old 1
    title: Beat 1
    prompt: "duplicate 2"
    seed: 555
  - beat: 2
    title: Beat 2
    prompt: "prompt 2"
\`\`\`

Note body text here.
`;
  const res = updatePromptInNoteContent(fullNote, { beat: 1 }, "New refined prompt\nSecond line");
  assert.strictEqual(res.success, true);
  assert(res.newContent.includes("Note body text here."));
  const blockMatch = /```scene-script\n([\s\S]*?)\n```/.exec(res.newContent);
  assert(blockMatch !== null);
  const parsedBlock = yaml.parse(blockMatch[1]);
  assert.strictEqual(parsedBlock.beats[0].prompt, "New refined prompt\nSecond line\n");
  assert.strictEqual(parsedBlock.beats[0].title, "Beat 1");
  assert.strictEqual(parsedBlock.beats[0].seed, 555);
  assert.strictEqual(parsedBlock.beats[1].prompt, "prompt 2");
  console.log("✓ Test 5: updatePromptInNoteContent passed");

  console.log("\nAll unit tests passed successfully!");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
