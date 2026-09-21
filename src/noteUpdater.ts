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
 * Robustly update prompt lines inside an item or block.
 * Strips ANY existing prompt: properties and their scalar lines,
 * preventing duplicate keys under all circumstances.
 */
export function updatePromptInBeatLines(itemLines: string[], newPrompt: string): string[] {
  const firstLine = itemLines.length > 0 ? itemLines[0] : "";
  const listIndentMatch = firstLine.match(/^([ \t]*)-[ \t]+/);
  const listIndent = listIndentMatch ? listIndentMatch[1] : "";
  const defaultPropIndent = listIndentMatch ? listIndent + "  " : "";

  let firstPromptIndex = -1;
  let promptIndent = defaultPropIndent;
  let firstWasDashProp = false;

  const filteredLines: string[] = [];
  let skippingPrompt = false;
  let skippingPromptIndent = 0;

  for (let i = 0; i < itemLines.length; i++) {
    const line = itemLines[i];
    const isBlank = line.trim().length === 0;

    if (skippingPrompt) {
      if (isBlank) {
        continue;
      }
      const currentIndent = (line.match(/^([ \t]*)/)?.[1] ?? "").length;
      if (currentIndent > skippingPromptIndent) {
        continue;
      } else {
        skippingPrompt = false;
      }
    }

    const propMatch = line.match(/^([ \t]*)(prompt:[ \t]*)(.*)$/);
    const dashPropMatch = line.match(/^([ \t]*-[ \t]+)(prompt:[ \t]*)(.*)$/);

    if (propMatch && !dashPropMatch) {
      const indent = propMatch[1];
      if (firstPromptIndex === -1) {
        firstPromptIndex = filteredLines.length;
        promptIndent = indent || defaultPropIndent;
      }
      skippingPrompt = true;
      skippingPromptIndent = indent.length;
      continue;
    } else if (dashPropMatch) {
      if (firstPromptIndex === -1) {
        firstPromptIndex = filteredLines.length;
        promptIndent = defaultPropIndent;
        firstWasDashProp = true;
      }
      skippingPrompt = true;
      skippingPromptIndent = dashPropMatch[1].length;
      continue;
    }

    filteredLines.push(line);
  }

  const isDash = firstPromptIndex === 0 && firstWasDashProp;
  const trimmed = newPrompt.trim();
  const formattedLines: string[] = [];

  if (trimmed.includes("\n")) {
    const head = isDash ? `${listIndent}- prompt: |` : `${promptIndent}prompt: |`;
    formattedLines.push(head);
    const contentIndent = isDash ? listIndent + "    " : promptIndent + "  ";
    const pLines = trimmed.split(/\r?\n/);
    for (const pl of pLines) {
      formattedLines.push(pl.trim().length > 0 ? `${contentIndent}${pl}` : "");
    }
  } else {
    const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const head = isDash ? `${listIndent}- prompt: "${escaped}"` : `${promptIndent}prompt: "${escaped}"`;
    formattedLines.push(head);
  }

  const resultLines = [...filteredLines];
  if (firstPromptIndex !== -1 && firstPromptIndex <= resultLines.length) {
    resultLines.splice(firstPromptIndex, 0, ...formattedLines);
  } else {
    let lastIdx = resultLines.length;
    while (lastIdx > 0 && resultLines[lastIdx - 1].trim().length === 0) {
      lastIdx--;
    }
    resultLines.splice(lastIdx, 0, ...formattedLines);
  }

  return resultLines;
}

/**
 * Line-based updater for ```scene-script blocks.
 */
export function updateSceneScriptBody(body: string, beat: BeatIdentifier, newPrompt: string): string | null {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);

  let beatsLineIdx = -1;
  let beatsIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([ \t]*)beats:[ \t]*$/);
    if (match) {
      beatsLineIdx = i;
      beatsIndent = match[1].length;
      break;
    }
  }

  if (beatsLineIdx === -1) {
    return null;
  }

  interface ScriptBeatItem {
    itemIndent: string;
    startLineIndex: number;
    lines: string[];
  }

  const items: ScriptBeatItem[] = [];
  let currentItem: ScriptBeatItem | null = null;

  for (let i = beatsLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) {
      if (currentItem) {
        currentItem.lines.push(line);
      }
      continue;
    }

    const indentMatch = line.match(/^([ \t]*)/);
    const indentLen = indentMatch ? indentMatch[1].length : 0;
    const listItemMatch = line.match(/^([ \t]*)-[ \t]+(.*)$/);

    if (listItemMatch && indentLen > beatsIndent) {
      if (currentItem) {
        items.push(currentItem);
      }
      currentItem = {
        itemIndent: listItemMatch[1],
        startLineIndex: i,
        lines: [line]
      };
      continue;
    }

    if (indentLen <= beatsIndent) {
      if (currentItem) {
        items.push(currentItem);
        currentItem = null;
      }
      break;
    }

    if (currentItem) {
      currentItem.lines.push(line);
    }
  }

  if (currentItem) {
    items.push(currentItem);
  }

  if (items.length === 0) {
    return null;
  }

  // Find target beat item
  let targetItem: ScriptBeatItem | null = null;
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const itText = it.lines.join("\n");
    let itObj: any = null;
    try {
      const parsedSeq = yaml.parse(itText, { uniqueKeys: false });
      if (Array.isArray(parsedSeq) && parsedSeq.length > 0) {
        itObj = parsedSeq[0];
      }
    } catch {
      // ignore
    }

    const itemBeatNum = itObj?.beat ?? idx + 1;
    const itemTitle = itObj?.title;

    const matchesNum = String(itemBeatNum) === String(beat.beat);
    const matchesTitle =
      beat.title &&
      itemTitle &&
      String(itemTitle).trim().toLowerCase() === beat.title.trim().toLowerCase();

    const beatRegex = new RegExp(`^[ \\t]*(?:-[ \\t]+)?beat:[ \\t]*["']?${beat.beat}["']?\\b`, "m");
    const matchesRegex = beatRegex.test(itText);
    const matchesTextTitle = Boolean(beat.title && itText.includes(beat.title));
    const matchesOrigPrompt = Boolean(
      beat.originalPrompt &&
      beat.originalPrompt.length > 10 &&
      itText.includes(beat.originalPrompt.slice(0, 30))
    );

    if (matchesNum || matchesTitle || matchesRegex || matchesTextTitle || matchesOrigPrompt) {
      targetItem = it;
      break;
    }
  }

  // If no explicit match found but beat number matches array index + 1
  if (!targetItem && typeof beat.beat === "number" && beat.beat >= 1 && beat.beat <= items.length) {
    targetItem = items[beat.beat - 1];
  }

  if (!targetItem) {
    return null;
  }

  const updatedLines = updatePromptInBeatLines(targetItem.lines, newPrompt);
  const allLines = [...lines];
  allLines.splice(targetItem.startLineIndex, targetItem.lines.length, ...updatedLines);
  return allLines.join(newline);
}

/**
 * Line-based updater for ```plotbeat blocks.
 */
export function updatePlotbeatBody(body: string, newPrompt: string): string {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const updatedLines = updatePromptInBeatLines(lines, newPrompt);
  return updatedLines.join(newline);
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
      parsed = yaml.parse(body, { uniqueKeys: false });
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
      } else {
        // Fallback if YAML parse was imperfect
        const beatNumRegex = new RegExp(`^[ \\t]*(?:-[ \\t]+)?beat:[ \\t]*["']?${beat.beat}["']?\\b`, "m");
        if (beatNumRegex.test(blk.body) || (beat.title && blk.body.includes(beat.title))) {
          targetBlock = blk;
          break;
        }
      }
    }
  }

  // If no explicit match found but there is exactly one block, use it
  if (!targetBlock && allBlocks.length === 1) {
    targetBlock = allBlocks[0];
  }

  // STEP 2: Update within the target block
  if (targetBlock) {
    if (targetBlock.type === "plotbeat") {
      const newBody = updatePlotbeatBody(targetBlock.body, newPrompt);
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
      const newBody = updateSceneScriptBody(targetBlock.body, beat, newPrompt);
      if (newBody) {
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
      const before = content.slice(0, snippetIdx);
      const after = content.slice(snippetIdx);
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
