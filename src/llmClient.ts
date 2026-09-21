import { App, requestUrl, RequestUrlParam } from "obsidian";
import { DrawThingsSettings, LLMProvider } from "./types";

export interface LLMCompletionOptions {
  providerOverride?: LLMProvider;
  modelOverride?: string;
  endpointOverride?: string;
}

export class LLMClient {
  private app: App;
  private settings: DrawThingsSettings;

  constructor(app: App, settings: DrawThingsSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: DrawThingsSettings) {
    this.settings = settings;
  }

  /**
   * Sanitizes and normalizes OpenRouter endpoint URLs, repairing accidental paste
   * duplications like "https://openrouter.ai/api/v1https://openrouter.ai/api/v1/chat/completions"
   * or missing "/chat/completions" path.
   */
  cleanOpenRouterEndpoint(rawUrl?: string): string {
    let url = (rawUrl || "").trim();
    if (!url) return "https://openrouter.ai/api/v1/chat/completions";

    // If multiple "https://" or "http://" appear, extract the last occurrence onwards
    const lastHttp = url.lastIndexOf("http://");
    const lastHttps = url.lastIndexOf("https://");
    const lastIdx = Math.max(lastHttp, lastHttps);
    if (lastIdx > 0) {
      url = url.slice(lastIdx);
    }

    // Ensure it terminates with /chat/completions
    if (url.endsWith("/api/v1") || url.endsWith("/api/v1/")) {
      url = url.replace(/\/+$/, "") + "/chat/completions";
    }

    return url;
  }

  /**
   * Automatically discovers an active OpenRouter API key from Smart Composer if present.
   */
  detectSmartComposerOpenRouterKey(): string {
    try {
      const scSettings: any = (this.app as any).plugins?.plugins?.["smart-composer"]?.settings;
      if (scSettings && Array.isArray(scSettings.providers)) {
        const found = scSettings.providers.find(
          (p: any) => (p.type === "openrouter" || p.id === "openrouter") && p.apiKey
        );
        if (found?.apiKey) return found.apiKey.trim();
      }
    } catch (e) {
      console.warn("[DrawThings] Failed to inspect Smart Composer in-memory settings:", e);
    }
    return "";
  }

  async testConnection(providerOverride?: LLMProvider): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.generateCompletion(
        "You are an assistant.",
        "Respond with the single word 'READY' and nothing else.",
        { providerOverride }
      );
      if (response && response.trim().length > 0) {
        return { success: true, message: `Connected! Response: "${response.trim().slice(0, 60)}"` };
      }
      return { success: false, message: "Received empty response from LLM." };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err?.message || String(err)}` };
    }
  }

  async generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMCompletionOptions
  ): Promise<string> {
    const provider = options?.providerOverride || this.settings.llmProvider;

    switch (provider) {
      case "openrouter":
        return this.callOpenRouter(
          systemPrompt,
          userPrompt,
          options?.modelOverride,
          options?.endpointOverride
        );
      case "smart-composer":
        return this.callSmartComposerBridge(systemPrompt, userPrompt);
      case "ollama":
        return this.callOllama(systemPrompt, userPrompt);
      case "lm-studio":
        return this.callLmStudio(systemPrompt, userPrompt);
      case "anthropic":
        return this.callAnthropic(systemPrompt, userPrompt);
      case "gemini":
        return this.callGemini(systemPrompt, userPrompt);
      case "openai":
      case "custom":
      default:
        return this.callOpenAICompatible(systemPrompt, userPrompt);
    }
  }

  async callOpenRouter(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    endpointOverride?: string
  ): Promise<string> {
    const rawEndpoint = endpointOverride || this.settings.llmEndpoint || "https://openrouter.ai/api/v1/chat/completions";
    const endpoint = this.cleanOpenRouterEndpoint(rawEndpoint);
    const model =
      modelOverride ||
      (this.settings.llmModel && this.settings.llmModel !== "llama3" && this.settings.llmModel !== "default"
        ? this.settings.llmModel
        : "@preset/glm-5-3-writer");

    // Key lookup: Settings API Key -> Smart Composer Key
    let apiKey = this.settings.llmApiKey ? this.settings.llmApiKey.trim() : "";
    if (!apiKey) {
      apiKey = this.detectSmartComposerOpenRouterKey();
    }

    if (!apiKey) {
      throw new Error(
        "OpenRouter API key missing. Please enter your OpenRouter key (sk-or-...) in Draw Things settings or configure Smart Composer."
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://obsidian.md",
      "X-Title": "Obsidian Draw Things Novel Scene Illustrator"
    };

    const payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7
    };

    const req: RequestUrlParam = {
      url: endpoint,
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    };

    const res = await requestUrl(req);
    const data = res.json;
    if (data?.choices && data.choices.length > 0) {
      const msg = data.choices[0].message;
      const content = msg?.content || msg?.reasoning;
      if (content && typeof content === "string") {
        return content;
      }
    }
    if (data?.error?.message) {
      throw new Error(`OpenRouter Error (${model}): ${data.error.message}`);
    }
    throw new Error(`Unexpected OpenRouter response structure: ${JSON.stringify(data).slice(0, 120)}`);
  }

  private async callSmartComposerBridge(systemPrompt: string, userPrompt: string): Promise<string> {
    // 1. Try to inspect active Smart Composer plugin instance
    let scSettings: any = (this.app as any).plugins?.plugins?.["smart-composer"]?.settings;

    // 2. If not loaded in memory, read data.json directly from vault disk
    if (!scSettings) {
      try {
        const dataPath = ".obsidian/plugins/smart-composer/data.json";
        if (await this.app.vault.adapter.exists(dataPath)) {
          const raw = await this.app.vault.adapter.read(dataPath);
          scSettings = JSON.parse(raw);
        }
      } catch (e) {
        console.error("[DrawThings] Failed to read smart-composer data.json:", e);
      }
    }

    if (scSettings && Array.isArray(scSettings.providers)) {
      const providers = scSettings.providers;
      const openrouter = providers.find((p: any) => (p.type === "openrouter" || p.id === "openrouter") && p.apiKey);
      const anthropic = providers.find((p: any) => (p.type === "anthropic" || p.id === "anthropic") && p.apiKey);
      const openai = providers.find((p: any) => (p.type === "openai" || p.id === "openai") && p.apiKey);
      const gemini = providers.find((p: any) => (p.type === "gemini" || p.id === "gemini") && p.apiKey);
      const ollama = providers.find((p: any) => (p.type === "ollama" || p.id === "ollama"));

      // Priority A: OpenRouter key in Smart Composer
      if (openrouter?.apiKey) {
        return this.callOpenRouter(systemPrompt, userPrompt, this.settings.llmModel || "@preset/glm-5-3-writer");
      }

      // Priority B: Direct Anthropic key in Smart Composer
      if (anthropic?.apiKey) {
        return this.callAnthropicDirect(anthropic.apiKey, "claude-3-5-sonnet-20241022", systemPrompt, userPrompt);
      }

      // Priority C: Direct OpenAI key in Smart Composer
      if (openai?.apiKey) {
        return this.callOpenAIFormat("https://api.openai.com/v1/chat/completions", openai.apiKey, "gpt-4o", systemPrompt, userPrompt);
      }

      // Priority D: Direct Gemini key in Smart Composer
      if (gemini?.apiKey) {
        return this.callGeminiDirect(gemini.apiKey, "gemini-2.0-flash", systemPrompt, userPrompt);
      }

      // Priority E: Local Ollama configured in Smart Composer
      if (ollama) {
        const endpoint = ollama.baseUrl || "http://127.0.0.1:11434/api/chat";
        return this.callOllamaWithEndpoint(endpoint, "llama3", systemPrompt, userPrompt);
      }
    }

    // Fallback: If user supplied API key in Draw Things settings directly
    if (this.settings.llmApiKey && this.settings.llmApiKey.trim().length > 0) {
      if (this.settings.llmApiKey.startsWith("sk-or-")) {
        return this.callOpenRouter(systemPrompt, userPrompt);
      }
      return this.callOpenAICompatible(systemPrompt, userPrompt);
    }

    // Final Fallback: Attempt local Ollama
    return this.callOllama(systemPrompt, userPrompt);
  }

  private async callOllama(systemPrompt: string, userPrompt: string): Promise<string> {
    const endpoint = this.settings.llmEndpoint || "http://127.0.0.1:11434/api/chat";
    const model = this.settings.llmModel || "llama3";
    return this.callOllamaWithEndpoint(endpoint, model, systemPrompt, userPrompt);
  }

  private async callOllamaWithEndpoint(
    endpoint: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      stream: false
    };

    const req: RequestUrlParam = {
      url: endpoint,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    };

    try {
      const res = await requestUrl(req);
      const data = res.json;
      if (data?.message?.content) {
        return data.message.content;
      }
      throw new Error(`Unexpected Ollama response structure: ${JSON.stringify(data).slice(0, 100)}`);
    } catch (e: any) {
      throw new Error(`Could not connect to Ollama at ${endpoint}. Is Ollama running? (${e.message})`);
    }
  }

  private async callLmStudio(systemPrompt: string, userPrompt: string): Promise<string> {
    const endpoint = this.settings.llmEndpoint || "http://127.0.0.1:1234/v1/chat/completions";
    const model = this.settings.llmModel || "default";
    return this.callOpenAIFormat(endpoint, "", model, systemPrompt, userPrompt);
  }

  private async callOpenAICompatible(systemPrompt: string, userPrompt: string): Promise<string> {
    const endpoint = this.settings.llmEndpoint || "https://api.openai.com/v1/chat/completions";
    const model = this.settings.llmModel || "gpt-4o";
    const apiKey = this.settings.llmApiKey;
    return this.callOpenAIFormat(endpoint, apiKey, model, systemPrompt, userPrompt);
  }

  private async callOpenAIFormat(
    endpoint: string,
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey && apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    const payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7
    };

    const req: RequestUrlParam = {
      url: endpoint,
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    };

    const res = await requestUrl(req);
    const data = res.json;
    if (data?.choices && data.choices.length > 0) {
      const msg = data.choices[0].message;
      const content = msg?.content || msg?.reasoning;
      if (content && typeof content === "string") {
        return content;
      }
    }
    if (data?.error?.message) {
      throw new Error(`API Error (${model}): ${data.error.message}`);
    }
    throw new Error(`Unexpected response structure from ${endpoint}: ${JSON.stringify(data).slice(0, 120)}`);
  }

  private async callAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
    const apiKey = this.settings.llmApiKey;
    if (!apiKey) {
      throw new Error("Anthropic API key is required in settings.");
    }
    const model = this.settings.llmModel || "claude-3-5-sonnet-20241022";
    return this.callAnthropicDirect(apiKey, model, systemPrompt, userPrompt);
  }

  private async callAnthropicDirect(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const endpoint = "https://api.anthropic.com/v1/messages";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01"
    };

    const payload = {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    };

    const req: RequestUrlParam = {
      url: endpoint,
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    };

    const res = await requestUrl(req);
    const data = res.json;
    if (data?.content && Array.isArray(data.content) && data.content.length > 0) {
      return data.content.map((c: any) => c.text || "").join("\n");
    }
    if (data?.error?.message) {
      throw new Error(`Anthropic Error: ${data.error.message}`);
    }
    throw new Error(`Unexpected Anthropic response: ${JSON.stringify(data).slice(0, 120)}`);
  }

  private async callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
    const apiKey = this.settings.llmApiKey;
    if (!apiKey) {
      throw new Error("Google Gemini API key is required in settings.");
    }
    const model = this.settings.llmModel || "gemini-2.0-flash";
    return this.callGeminiDirect(apiKey, model, systemPrompt, userPrompt);
  }

  private async callGeminiDirect(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{ parts: [{ text: userPrompt }] }]
    };

    const req: RequestUrlParam = {
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    };

    const res = await requestUrl(req);
    const data = res.json;
    if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content?.parts) {
      return data.candidates[0].content.parts.map((p: any) => p.text || "").join("\n");
    }
    if (data?.error?.message) {
      throw new Error(`Gemini Error: ${data.error.message}`);
    }
    throw new Error(`Unexpected Gemini response: ${JSON.stringify(data).slice(0, 120)}`);
  }
}
