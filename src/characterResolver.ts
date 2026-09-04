import { App, TFile } from "obsidian";

export class CharacterResolver {
  private app: App;
  private cache: Map<string, string> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  clearCache() {
    this.cache.clear();
  }

  async resolveCharacterPrompt(characterName: string, searchFolders: string[]): Promise<string> {
    if (!characterName || !characterName.trim()) return "";
    const cleanName = characterName.trim();
    const slug = cleanName.toLowerCase().replace(/[\s-]+/g, "_");

    if (this.cache.has(slug)) {
      return this.cache.get(slug) || "";
    }

    // 1. Look for Visuals/Portrait Prompts/<slug>.md or <cleanName>.md
    const files = this.app.vault.getMarkdownFiles();

    // Priority 1: Exact matches in Portrait Prompts
    for (const file of files) {
      const pathLower = file.path.toLowerCase();
      if (pathLower.includes("portrait prompts") || pathLower.includes("portrait_prompts")) {
        const baseName = file.basename.toLowerCase().replace(/[\s-]+/g, "_");
        if (baseName === slug || baseName.includes(slug) || slug.includes(baseName)) {
          const content = await this.app.vault.read(file);
          const prompt = this.extractPromptSection(content);
          if (prompt) {
            this.cache.set(slug, prompt);
            return prompt;
          }
        }
      }
    }

    // Priority 2: Look in Characters/<Name>/SOUL.md or Characters/<Name>.md
    for (const file of files) {
      const pathLower = file.path.toLowerCase();
      const inCharFolder = searchFolders.some(f => pathLower.startsWith(f.toLowerCase()));
      if (inCharFolder) {
        const parts = file.path.split("/");
        const containsName = parts.some(p => p.toLowerCase().replace(/[\s-]+/g, "_").includes(slug) || slug.includes(p.toLowerCase().replace(/[\s-]+/g, "_")));
        if (containsName) {
          const content = await this.app.vault.read(file);
          // Check frontmatter
          const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
          if (frontmatter && frontmatter.character_prompt) {
            const prompt = String(frontmatter.character_prompt).trim();
            this.cache.set(slug, prompt);
            return prompt;
          }

          // Check for prompt section
          const promptSec = this.extractPromptSection(content);
          if (promptSec) {
            this.cache.set(slug, promptSec);
            return promptSec;
          }

          // Check for Physicality table or summary in SOUL.md
          const physicality = this.extractPhysicality(content, cleanName);
          if (physicality) {
            this.cache.set(slug, physicality);
            return physicality;
          }
        }
      }
    }

    return "";
  }

  private extractPromptSection(content: string): string | null {
    // Check ## Prompt
    const promptMatch = content.match(/##\s*Prompt\s*\n+([\s\S]*?)(?=\n##|\n---|$)/i);
    if (promptMatch && promptMatch[1].trim()) {
      return promptMatch[1].trim();
    }
    return null;
  }

  private extractPhysicality(content: string, characterName: string): string | null {
    const lines = content.split("\n");
    const summaryParts: string[] = [];

    // Look for overall body shape or physicality row
    for (const line of lines) {
      if (line.includes("Overall Body Shape") || line.includes("Physicality") || line.includes("Ancestral architecture")) {
        const clean = line.replace(/[*#|–-]+/g, " ").replace(/\s+/g, " ").trim();
        if (clean.length > 10 && !clean.toLowerCase().includes("measurement")) {
          summaryParts.push(clean);
        }
      }
    }

    if (summaryParts.length > 0) {
      return `${characterName} (${summaryParts.slice(0, 2).join(", ")})`;
    }

    return null;
  }
}
