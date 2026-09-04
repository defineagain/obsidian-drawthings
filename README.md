# Draw Things Scene Illustrator for Obsidian

An Obsidian desktop plugin designed for novel authors, storytellers, and screenwriters to script scenes, define key visual plot beats, and generate local AI illustrations using the macOS **Draw Things CLI** (`draw-things-cli`).

---

## Features

- **Inline Plot Beat Block (`plotbeat`)**:
  Embed single visual moments directly inside your prose. Renders an interactive card with a **Generate Plate**, **Re-roll Seed**, and **Copy Embed** (`![[...]]`) button.
- **Scene-Level Beat Sheet (`scene-script`)**:
  Define an entire scene arc in one block with a **⚡ Generate All Scene Plates** batch button.
- **Automated AI Plot Beat Scripting**:
  One-click extraction of visual turning points directly from your scene prose into photographic prompts using an inbuilt multi-provider LLM engine (supports OpenRouter, Smart Composer, Local Ollama, Claude, OpenAI, and Gemini).
- **Interactive Beat Review Modal**:
  Review, tweak, and toggle beats before inserting them into your note or sending them straight to the generation queue.
- **Non-blocking Metal GPU Queue**:
  Inference runs asynchronously in the background on Apple Silicon Metal via `draw-things-cli` without ever freezing Obsidian.
- **Character Profile Resolution**:
  Automatically looks up character names (e.g. `Sofia Adebayo`, `Sylvie Beck`) across your vault to inject canonical physical appearance and portrait prompts.
- **Aesthetic Presets**:
  Built-in support for presets like `pure-moonlit` (cool 6500K rain-window chiaroscuro), `turbo-preview` (instant draft renders), `cinematic`, and `editorial-portrait`.
- **Storyboard Sidebar Tab**:
  A dedicated right-ribbon panel tracking all beats in the current active scene file.
- **Archive-Grade Provenance**:
  Automatically saves a `<plate>.meta.json` sidecar alongside each image recording prompt, model, seed, dimensions, and timestamp.

---

## Installation

### Prerequisites
1. **Draw Things App** installed on macOS with at least one model downloaded.
2. **`draw-things-cli`** installed:
   ```bash
   brew install --HEAD drawthingsai/draw-things/draw-things-cli
   ```
   Verified at `/Users/daniel/.local/bin/draw-things-cli`.

### Via Obsidian42 - BRAT (Recommended)
1. In Obsidian, open **Settings > Community Plugins > BRAT**.
2. Click **Add Beta plugin**.
3. Enter the repository URL.
4. Enable **Draw Things Scene Illustrator** in Community Plugins.

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Place them into your vault under `<vault>/.obsidian/plugins/obsidian-drawthings/`.
3. Reload Obsidian and toggle the plugin on.

---

## Usage

### 1. Single Plot Beat in Prose
```markdown
```plotbeat
beat: 1
title: "The Approach"
scene: "SOAS Bar"
character: "Sofia Adebayo"
preset: "pure-moonlit"
model: "z_image_turbo_1.0_q8p.ckpt"
aspect: "2:3"
steps: 12
seed: 1001
prompt: "Sofia Adebayo seated alone at a corner table in the SOAS bar, surrounded by fortresses of philosophy books, severe glasses, wool jumper, looking up as Alex approaches."
```
```

### 2. Multi-Beat Scene Script
```markdown
```scene-script
scene: "SOAS Bar Trigger Arc"
preset: "pure-moonlit"
model: "z_image_turbo_1.0_q8p.ckpt"
aspect: "1024x1536"
seed_start: 1001

beats:
  - beat: 1
    title: "The Threshold"
    character: "Alex"
    prompt: "Alex hesitating at the threshold of the Victorian SOAS bar, rain on glass, cool chiaroscuro lighting."
  - beat: 2
    title: "The Socratic Duel"
    character: "Sofia Adebayo"
    prompt: "Sofia Adebayo seated across the table, fortress of scholastic texts, sharp analytical gaze."
  - beat: 3
    title: "The Conversion"
    character: "Sofia Adebayo"
    prompt: "Close up on Sofia, dilated pupils, academic armor dropping, cool 6500K window rim light."
```
```

### 3. AI Beat Scripting
- Open any scene note.
- Open the **Draw Things Storyboard** in the right ribbon (🖼️ icon).
- Click **✨ Auto-Script Beats with AI**.
- Review the generated beats in the modal and click **Insert** or **⚡ Insert & Queue Generations**!

---

## License
MIT License
