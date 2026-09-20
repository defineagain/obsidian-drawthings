import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { PlotBeatData, ShootConfig, PromptRefineMode, DrawThingsSettings } from "./types";
import { PromptRefiner } from "./promptRefiner";
import { CharacterResolver } from "./characterResolver";
import { QueueManager } from "./queue";
import { ConfigLookup } from "./configLookup";

export class PromptRefineModal extends Modal {
  private beat: PlotBeatData;
  private noteFile: TFile;
  private shoot: ShootConfig;
  private promptRefiner: PromptRefiner;
  private charResolver: CharacterResolver;
  private queue: QueueManager;
  private settings: DrawThingsSettings;
  private configLookup: ConfigLookup;
  private onRefined?: (newPrompt: string) => void;

  private currentMode: PromptRefineMode = "unified";
  private refinedText: string = "";
  private isRefining: boolean = false;

  constructor(
    app: App,
    beat: PlotBeatData,
    noteFile: TFile,
    shoot: ShootConfig,
    promptRefiner: PromptRefiner,
    charResolver: CharacterResolver,
    queue: QueueManager,
    settings: DrawThingsSettings,
    configLookup: ConfigLookup,
    onRefined?: (newPrompt: string) => void
  ) {
    super(app);
    this.beat = beat;
    this.noteFile = noteFile;
    this.shoot = shoot;
    this.promptRefiner = promptRefiner;
    this.charResolver = charResolver;
    this.queue = queue;
    this.settings = settings;
    this.configLookup = configLookup;
    this.onRefined = onRefined;

    this.currentMode = (beat.refine as PromptRefineMode) || shoot.refine_mode || settings.promptRefineMode || "unified";
    if (this.currentMode === "disabled") {
      this.currentMode = "unified";
    }
  }

  onOpen() {
    this.render();
    this.doRefine();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("drawthings-refine-modal");

    contentEl.createEl("h3", { text: `🧠 Refine Prompt: Beat ${this.beat.beat} ("${this.beat.title || 'Beat'}")` });

    // Shoot badge / context
    const contextRow = contentEl.createDiv({ cls: "drawthings-refine-context" });
    contextRow.createSpan({ cls: "drawthings-badge shoot-badge", text: `🎬 Shoot: ${this.shoot.name}` });
    if (this.shoot.prompt_anchor) {
      contextRow.createSpan({ cls: "drawthings-refine-anchor-preview", text: `Anchor: ${this.shoot.prompt_anchor.slice(0, 60)}...` });
    }

    // Refinement Mode Selector
    new Setting(contentEl)
      .setName("Refinement Architecture Mode")
      .setDesc("Unified Master combines Visionary logic with ENI Shoot Bible 5-part architecture.")
      .addDropdown(dropdown => {
        dropdown
          .addOption("unified", "Unified Master (Visionary + ENI Bible)")
          .addOption("visionary", "Visionary Artist (~500 Words)")
          .addOption("eni_bible", "Pure ENI Shoot Bible (5 Sections)")
          .setValue(this.currentMode)
          .onChange(async (val: PromptRefineMode) => {
            this.currentMode = val;
            await this.doRefine();
          });
      })
      .addButton(btn =>
        btn.setButtonText("🔄 Re-run Refinement").onClick(() => this.doRefine())
      );

    // Original Prompt Display
    const originalBox = contentEl.createDiv({ cls: "drawthings-refine-box" });
    originalBox.createEl("h5", { text: "Original Beat Prompt" });
    originalBox.createEl("p", { cls: "drawthings-refine-original-text", text: this.beat.prompt || "(No prompt)" });

    // Refined Prompt Display / Editor
    const refinedBox = contentEl.createDiv({ cls: "drawthings-refine-box" });
    refinedBox.createEl("h5", { text: "Refined Visionary Prompt" });

    const textArea = refinedBox.createEl("textarea", {
      cls: "drawthings-refine-textarea",
      attr: { rows: "9" }
    });
    textArea.value = this.isRefining ? "⏳ Synthesizing photographic prompt architecture with AI..." : this.refinedText;
    textArea.disabled = this.isRefining;

    textArea.addEventListener("input", () => {
      this.refinedText = textArea.value;
    });

    // Action Buttons
    const btnRow = contentEl.createDiv({ cls: "drawthings-refine-actions" });

    const btnUpdateNote = btnRow.createEl("button", {
      cls: "mod-cta drawthings-btn",
      text: "💾 Save to Note",
      attr: { disabled: this.isRefining ? "true" : undefined }
    });

    const btnQueueGen = btnRow.createEl("button", {
      cls: "drawthings-btn",
      text: "🎨 Save & Generate Now",
      attr: { disabled: this.isRefining ? "true" : undefined }
    });

    const btnCopy = btnRow.createEl("button", {
      cls: "drawthings-btn",
      text: "📋 Copy Text",
      attr: { disabled: this.isRefining ? "true" : undefined }
    });

    const btnCancel = btnRow.createEl("button", {
      cls: "drawthings-btn",
      text: "Close"
    });

    btnUpdateNote.addEventListener("click", async () => {
      if (!this.refinedText || this.refinedText.trim().length === 0) {
        new Notice("No refined text to save.");
        return;
      }
      await this.saveRefinedPromptToNote(this.refinedText.trim());
      if (this.onRefined) this.onRefined(this.refinedText.trim());
      this.close();
    });

    btnQueueGen.addEventListener("click", async () => {
      if (!this.refinedText || this.refinedText.trim().length === 0) {
        new Notice("No refined text to generate.");
        return;
      }
      await this.saveRefinedPromptToNote(this.refinedText.trim());
      if (this.onRefined) this.onRefined(this.refinedText.trim());
      this.close();
      // Enqueue generation
      const beatCopy = { ...this.beat, prompt: this.refinedText.trim() };
      new Notice(`Queued plate generation for Beat ${beatCopy.beat}`);
    });

    btnCopy.addEventListener("click", () => {
      navigator.clipboard.writeText(this.refinedText);
      new Notice("Refined prompt copied to clipboard!");
    });

    btnCancel.addEventListener("click", () => {
      this.close();
    });
  }

  private async doRefine() {
    this.isRefining = true;
    this.render();

    try {
      let charPrompt = "";
      if (this.settings.enableCharacterResolution && this.beat.character) {
        charPrompt = await this.charResolver.resolveCharacterPrompt(this.beat.character, this.settings.characterFolders);
      }

      this.refinedText = await this.promptRefiner.refine(this.beat.prompt, {
        mode: this.currentMode,
        promptAnchor: this.shoot.prompt_anchor,
        characterPrompt: charPrompt
      });
    } catch (err: any) {
      new Notice(`Refinement failed: ${err.message}`);
      this.refinedText = this.beat.prompt;
    } finally {
      this.isRefining = false;
      this.render();
    }
  }

  private async saveRefinedPromptToNote(newPrompt: string): Promise<void> {
    try {
      const content = await this.app.vault.read(this.noteFile);
      // Look for the specific plotbeat block for this beat
      const escapedPrompt = this.beat.prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const promptRegex = new RegExp(`(prompt:\\s*)(["']?${escapedPrompt}["']?)`, "m");

      if (promptRegex.test(content)) {
        // Format prompt nicely for YAML
        const formattedPrompt = newPrompt.includes("\n")
          ? `prompt: |\n  ${newPrompt.split("\n").join("\n  ")}`
          : `prompt: "${newPrompt.replace(/"/g, '\\"')}"`;

        const updated = content.replace(promptRegex, formattedPrompt);
        await this.app.vault.modify(this.noteFile, updated);
        new Notice(`Updated prompt in "${this.noteFile.basename}"!`);
      } else {
        new Notice("Could not auto-locate prompt in note. Copied to clipboard instead.");
        navigator.clipboard.writeText(newPrompt);
      }
    } catch (e: any) {
      new Notice(`Failed to update note: ${e.message}`);
    }
  }
}
