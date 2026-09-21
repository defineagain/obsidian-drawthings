import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { PlotBeatData, ShootConfig, PromptRefineMode, DrawThingsSettings } from "./types";
import { PromptRefiner } from "./promptRefiner";
import { CharacterResolver } from "./characterResolver";
import { QueueManager } from "./queue";
import { ConfigLookup } from "./configLookup";
import { updatePromptInNoteContent } from "./noteUpdater";
import { buildGenerationJob } from "./jobBuilder";

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

  // DOM element references
  private textArea!: HTMLTextAreaElement;
  private statusEl!: HTMLElement;
  private btnUpdateNote!: HTMLButtonElement;
  private btnQueueGen!: HTMLButtonElement;
  private btnCopy!: HTMLButtonElement;
  private btnReRun!: HTMLButtonElement;

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

    this.currentMode =
      (beat.refine as PromptRefineMode) ||
      shoot.refine_mode ||
      settings.promptRefineMode ||
      "unified";
    if (this.currentMode === "disabled") {
      this.currentMode = "unified";
    }
  }

  onOpen() {
    this.buildUI();
    this.doRefine();
  }

  private buildUI() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("drawthings-refine-modal");

    contentEl.createEl("h3", {
      text: `🧠 Refine Prompt: Beat ${this.beat.beat} ("${this.beat.title || "Beat"}")`
    });

    // Shoot badge & context row
    const contextRow = contentEl.createDiv({ cls: "drawthings-refine-context" });
    contextRow.createSpan({
      cls: "drawthings-badge shoot-badge",
      text: `🎬 Shoot: ${this.shoot.name}`
    });
    if (this.shoot.prompt_anchor) {
      contextRow.createSpan({
        cls: "drawthings-refine-anchor-preview",
        text: `Anchor: ${this.shoot.prompt_anchor.slice(0, 60)}...`
      });
    }

    // Refinement Architecture Selector
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
      .addButton(btn => {
        btn.setButtonText("🔄 Re-run Refinement");
        btn.onClick(() => this.doRefine());
        this.btnReRun = btn.buttonEl;
      });

    // Original Prompt Box
    const originalBox = contentEl.createDiv({ cls: "drawthings-refine-box" });
    originalBox.createEl("h5", { text: "Original Beat Prompt" });
    originalBox.createEl("p", {
      cls: "drawthings-refine-original-text",
      text: this.beat.prompt || "(No prompt specified)"
    });

    // Refined Prompt Display / Editor
    const refinedBox = contentEl.createDiv({ cls: "drawthings-refine-box" });
    refinedBox.createEl("h5", { text: "Refined Visionary Prompt" });

    this.textArea = refinedBox.createEl("textarea", {
      cls: "drawthings-refine-textarea",
      attr: { rows: "10" }
    });
    this.textArea.placeholder = "Refined prompt will appear here...";

    this.textArea.addEventListener("input", () => {
      this.refinedText = this.textArea.value;
    });

    // Live status / feedback element
    this.statusEl = refinedBox.createDiv({ cls: "drawthings-refine-status" });
    this.statusEl.setText("Ready");

    // Action Buttons Row
    const btnRow = contentEl.createDiv({ cls: "drawthings-refine-actions" });

    this.btnUpdateNote = btnRow.createEl("button", {
      cls: "mod-cta drawthings-btn",
      text: "💾 Save to Note"
    });

    this.btnQueueGen = btnRow.createEl("button", {
      cls: "drawthings-btn",
      text: "🎨 Save & Generate Now"
    });

    this.btnCopy = btnRow.createEl("button", {
      cls: "drawthings-btn",
      text: "📋 Copy Text"
    });

    const btnCancel = btnRow.createEl("button", {
      cls: "drawthings-btn",
      text: "Close"
    });

    // Event Handlers
    this.btnUpdateNote.addEventListener("click", async () => {
      const textToSave = this.refinedText.trim() || this.textArea.value.trim();
      if (!textToSave) {
        new Notice("No refined text to save.");
        return;
      }
      await this.saveRefinedPromptToNote(textToSave);
      if (this.onRefined) this.onRefined(textToSave);
      this.close();
    });

    this.btnQueueGen.addEventListener("click", async () => {
      const textToSave = this.refinedText.trim() || this.textArea.value.trim();
      if (!textToSave) {
        new Notice("No refined text to generate.");
        return;
      }

      await this.saveRefinedPromptToNote(textToSave);
      if (this.onRefined) this.onRefined(textToSave);
      this.close();

      try {
        const beatCopy: PlotBeatData = { ...this.beat, prompt: textToSave };
        const job = await buildGenerationJob(
          this.app,
          beatCopy,
          this.noteFile.path,
          this.settings,
          this.configLookup,
          textToSave
        );
        this.queue.enqueue(job);
      } catch (err: any) {
        new Notice(`Failed to enqueue generation: ${err.message}`);
      }
    });

    this.btnCopy.addEventListener("click", async () => {
      const textToCopy = this.refinedText.trim() || this.textArea.value.trim();
      if (!textToCopy) {
        new Notice("No refined text to copy.");
        return;
      }
      const ok = await this.copyToClipboard(textToCopy);
      if (ok) {
        new Notice("📋 Refined prompt copied to clipboard!");
      } else {
        new Notice("⚠️ Failed to copy prompt to clipboard.");
      }
    });

    btnCancel.addEventListener("click", () => {
      this.close();
    });
  }

  private setRefiningState(isRefining: boolean, statusText?: string) {
    this.isRefining = isRefining;

    // Toggle button disabled states safely
    if (this.btnUpdateNote) {
      this.btnUpdateNote.disabled = isRefining;
      if (!isRefining) this.btnUpdateNote.removeAttribute("disabled");
    }
    if (this.btnQueueGen) {
      this.btnQueueGen.disabled = isRefining;
      if (!isRefining) this.btnQueueGen.removeAttribute("disabled");
    }
    if (this.btnCopy) {
      this.btnCopy.disabled = isRefining;
      if (!isRefining) this.btnCopy.removeAttribute("disabled");
    }
    if (this.btnReRun) {
      this.btnReRun.disabled = isRefining;
      if (!isRefining) this.btnReRun.removeAttribute("disabled");
    }
    if (this.textArea) {
      this.textArea.disabled = isRefining;
      if (!isRefining) {
        this.textArea.removeAttribute("disabled");
        this.textArea.value = this.refinedText;
      } else {
        this.textArea.value = "⏳ Synthesizing photographic prompt architecture with AI...";
      }
    }

    if (this.statusEl) {
      this.statusEl.toggleClass("is-refining", isRefining);
      if (statusText) {
        this.statusEl.setText(statusText);
      } else if (isRefining) {
        this.statusEl.setText("⏳ Synthesizing photographic prompt architecture with AI...");
      } else {
        this.statusEl.setText("✅ Prompt refined! You can edit above or save directly to your note.");
      }
    }
  }

  private async doRefine() {
    this.setRefiningState(true);

    try {
      let charPrompt = "";
      if (this.settings.enableCharacterResolution && this.beat.character) {
        charPrompt = await this.charResolver.resolveCharacterPrompt(
          this.beat.character,
          this.settings.characterFolders
        );
      }

      this.refinedText = await this.promptRefiner.refine(this.beat.prompt, {
        mode: this.currentMode,
        promptAnchor: this.shoot.prompt_anchor,
        characterPrompt: charPrompt
      });

      this.setRefiningState(false);
    } catch (err: any) {
      this.refinedText = this.beat.prompt || "";
      this.setRefiningState(false, `❌ Refinement failed: ${err?.message || String(err)}`);
      new Notice(`Refinement failed: ${err?.message || String(err)}`);
    }
  }

  private async saveRefinedPromptToNote(newPrompt: string): Promise<boolean> {
    try {
      const content = await this.app.vault.read(this.noteFile);
      const result = updatePromptInNoteContent(
        content,
        {
          beat: this.beat.beat,
          title: this.beat.title,
          originalPrompt: this.beat.prompt
        },
        newPrompt
      );

      if (result.success) {
        await this.app.vault.modify(this.noteFile, result.newContent);
        new Notice(`💾 Saved refined prompt to "${this.noteFile.basename}"!`);
        return true;
      } else {
        // Fallback: Copy to clipboard and warn user
        await this.copyToClipboard(newPrompt);
        new Notice(
          `⚠️ Could not auto-locate Beat ${this.beat.beat} in note. Copied prompt to clipboard!`,
          7000
        );
        return false;
      }
    } catch (e: any) {
      new Notice(`❌ Failed to update note: ${e.message}`);
      await this.copyToClipboard(newPrompt);
      return false;
    }
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    // Priority 1: Modern clipboard API
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      console.warn("[DrawThings] navigator.clipboard.writeText failed:", e);
    }

    // Priority 2: Fallback textarea execCommand
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.top = "-9999px";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.focus();
      el.select();
      const success = document.execCommand("copy");
      document.body.removeChild(el);
      return success;
    } catch (e) {
      console.error("[DrawThings] execCommand copy failed:", e);
      return false;
    }
  }
}
