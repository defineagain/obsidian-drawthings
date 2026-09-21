import * as yaml from "yaml";

export interface BeatIdentifier {
  beat: number | string;
  title?: string;
  originalPrompt?: string;
}

export interface NoteUpdateResult {
  success: boolean;
  newContent: string;
  message: string;
}

/**
 * Format a prompt string cleanly for YAML insertion.
 * Uses YAML block scalar (prompt: |\n  line1\n  line2) for multiline prompts,
 * or a quoted string for single-line prompts.
 */
export function formatPromptForYaml(prompt: string, baseIndent: string = ""): string {
  const trimmed = prompt.trim();
  if (trimmed.includes("\n")) {
    const lineIndent = baseIndent + "  ";
    const indentedLines = trimmed
      .split(/\r?\n/)
      .map(line => (line.trim().length > 0 ? `${lineIndent}${line}` : ""));
    return `${baseIndent}prompt: |\n${indentedLines.join("\n")}`;
  }
  // Single-line prompt
  const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${baseIndent}prompt: "${escaped}"`;
}

/**
 * Robustly locate and replace a prompt in a note's content.
 * Supports:
 * 1. ```plotbeat blocks (matches beat number, title, single-block default, or original prompt text)
 * 2. ```scene-script blocks (locates the specific item in the `beats:` list)
 * 3. Fallback string matching on original prompt text
 */
export function updatePromptInNoteContent(
  content: string,
  beat: BeatIdentifier,
  newPrompt: string
): NoteUpdateResult {
  if (!content) {
    return { success: false, newContent: content, message: "Note content is empty." };
  }

  // Regex to match code blocks ```plotbeat ... ``` or ```scene-script ... ```
  const blockRegex = /(```(?:plotbeat|scene-script)\s*\r?\n)([\s\S]*?)(\r?\n```)/g;
  let blockMatch: RegExpExecArray | null;
  let targetBlock: {
    type: "plotbeat" | "scene-script";
    fullMatch: string;
    prefix: string;
    body: string;
    suffix: string;
    index: number;
  } | null = null;

  const allBlocks: Array<{
    type: "plotbeat" | "scene-script";
    fullMatch: string;
    prefix: string;
    body: string;
    suffix: string;
    index: number;
    parsed: any;
  }> = [];

  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const prefix = blockMatch[1];
    const body = blockMatch[2];
    const suffix = blockMatch[3];
    const isPlotbeat = prefix.includes("plotbeat");
    const type = isPlotbeat ? "plotbeat" : "scene-script";

    let parsed: any = null;
    try {
      parsed = yaml.parse(body);
    } catch {
      // Best effort parse
    }

    allBlocks.push({
      type,
      fullMatch: blockMatch[0],
      prefix,
      body,
      suffix,
      index: blockMatch.index,
      parsed
    });
  }

  // STEP 1: Find the target block
  for (const blk of allBlocks) {
    if (blk.type === "plotbeat") {
      // Check if beat matches
      const bNum = blk.parsed?.beat ?? 1;
      const matchesNum = String(bNum) === String(beat.beat);
      const matchesTitle =
        beat.title &&
        blk.parsed?.title &&
        String(blk.parsed.title).trim().toLowerCase() === beat.title.trim().toLowerCase();
      const matchesOriginalPrompt =
        beat.originalPrompt &&
        blk.body.includes(beat.originalPrompt.slice(0, Math.min(30, beat.originalPrompt.length)));

      if (matchesNum || matchesTitle || matchesOriginalPrompt) {
        targetBlock = blk;
        break;
      }
    } else if (blk.type === "scene-script") {
      // Check if any beat in the scene-script matches
      if (Array.isArray(blk.parsed?.beats)) {
        const foundBeat = blk.parsed.beats.some(
          (b: any, idx: number) =>
            String(b.beat ?? idx + 1) === String(beat.beat) ||
            (beat.title && b.title && String(b.title).trim().toLowerCase() === beat.title.trim().toLowerCase())
        );
        if (foundBeat) {
          targetBlock = blk;
          break;
        }
      }
    }
  }

  // If no explicit match found but there is exactly one plotbeat block, use it
  if (!targetBlock && allBlocks.length === 1 && allBlocks[0].type === "plotbeat") {
    targetBlock = allBlocks[0];
  }

  // STEP 2: Update within the target block
  if (targetBlock) {
    if (targetBlock.type === "plotbeat") {
      // Look for existing prompt: property inside the plotbeat body
      // Matches prompt: and any following indented lines (multiline scalar) or single line
      const promptRegex = /^([ \t]*)(prompt:[ \t]*)(?:.*(?:\r?\n\1[ \t]+.*|\r?\n[ \t]*$)*)/m;
      const promptMatch = promptRegex.exec(targetBlock.body);

      let newBody: string;
      if (promptMatch) {
        const baseIndent = promptMatch[1];
        const formattedPrompt = formatPromptForYaml(newPrompt, baseIndent);
        newBody = targetBlock.body.replace(promptRegex, formattedPrompt);
      } else {
        // No prompt property in this block yet; append it
        const formattedPrompt = formatPromptForYaml(newPrompt, "");
        newBody = targetBlock.body.trimEnd() + "\n" + formattedPrompt + "\n";
      }

      const newFullBlock = targetBlock.prefix + newBody + targetBlock.suffix;
      const newContent =
        content.slice(0, targetBlock.index) +
        newFullBlock +
        content.slice(targetBlock.index + targetBlock.fullMatch.length);

      return {
        success: true,
        newContent,
        message: `Updated Beat ${beat.beat} prompt in \`\`\`plotbeat block.`
      };
    } else if (targetBlock.type === "scene-script") {
      // Locate the specific beat list item in the scene-script beats array
      const body = targetBlock.body;
      // List items start with "- " under beats:
      const beatRegex = new RegExp(
        `(^([ \\t]*)-[ \\t]+(?:[\\s\\S]*?\\r?\\n\\2[ \\t]+)?beat:[ \\t]*["']?${beat.beat}["']?\\b[\\s\\S]*?)(?=(?:\\r?\\n\\2-[ \\t]+)|(?:\\r?\\n[ \\t]*[a-zA-Z0-9_-]+:[ \\t]*)|$)`,
        "m"
      );

      const beatMatch = beatRegex.exec(body);
      if (beatMatch) {
        const beatItemText = beatMatch[1];
        const listIndent = beatMatch[2];
        const propIndent = listIndent + "  ";

        const promptRegex = /^([ \t]*)(prompt:[ \t]*)(?:.*(?:\r?\n\1[ \t]+.*|\r?\n[ \t]*$)*)/m;
        const pMatch = promptRegex.exec(beatItemText);

        let newBeatItemText: string;
        if (pMatch) {
          const baseIndent = pMatch[1];
          const formatted = formatPromptForYaml(newPrompt, baseIndent);
          newBeatItemText = beatItemText.replace(promptRegex, formatted);
        } else {
          const formatted = formatPromptForYaml(newPrompt, propIndent);
          newBeatItemText = beatItemText.trimEnd() + "\n" + formatted + "\n";
        }

        const newBody =
          body.slice(0, beatMatch.index) +
          newBeatItemText +
          body.slice(beatMatch.index + beatItemText.length);

        const newFullBlock = targetBlock.prefix + newBody + targetBlock.suffix;
        const newContent =
          content.slice(0, targetBlock.index) +
          newFullBlock +
          content.slice(targetBlock.index + targetBlock.fullMatch.length);

        return {
          success: true,
          newContent,
          message: `Updated Beat ${beat.beat} prompt in \`\`\`scene-script block.`
        };
      }
    }
  }

  // STEP 3: Fallback - Exact or snippet match of originalPrompt
  if (beat.originalPrompt && beat.originalPrompt.trim().length > 5) {
    const origTrim = beat.originalPrompt.trim();
    if (content.includes(origTrim)) {
      const newContent = content.replace(origTrim, newPrompt.trim());
      return {
        success: true,
        newContent,
        message: "Updated prompt via direct text replacement."
      };
    }

    // Try snippet match (first 40 characters)
    const snippet = origTrim.slice(0, 40);
    const snippetIdx = content.indexOf(snippet);
    if (snippetIdx !== -1) {
      // Find where this prompt line or block ends
      const before = content.slice(0, snippetIdx);
      const after = content.slice(snippetIdx);
      // Replace snippet line
      const afterLines = after.split(/\r?\n/);
      afterLines[0] = newPrompt.trim();
      const newContent = before + afterLines.join("\n");
      return {
        success: true,
        newContent,
        message: "Updated prompt via snippet match."
      };
    }
  }

  return {
    success: false,
    newContent: content,
    message: "Could not auto-locate beat prompt in note."
  };
}
