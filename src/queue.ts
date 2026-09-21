import { App, Notice } from "obsidian";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GenerationJob, JobStatus } from "./types";

export type QueueListener = (job: GenerationJob) => void;
export type QueueStatusListener = (activeJob: GenerationJob | null, pendingCount: number) => void;

export class QueueManager {
  private app: App;
  private queue: GenerationJob[] = [];
  private history: GenerationJob[] = [];
  private activeJob: GenerationJob | null = null;
  private currentProcess: ChildProcess | null = null;
  private listeners: Set<QueueListener> = new Set();
  private statusListeners: Set<QueueStatusListener> = new Set();

  constructor(app: App) {
    this.app = app;
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeStatus(listener: QueueStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitJobUpdate(job: GenerationJob) {
    for (const listener of this.listeners) {
      try {
        listener(job);
      } catch (err) {
        console.error("Error in queue listener:", err);
      }
    }
    this.emitStatus();
  }

  private emitStatus() {
    for (const listener of this.statusListeners) {
      try {
        listener(this.activeJob, this.queue.length);
      } catch (err) {
        console.error("Error in status listener:", err);
      }
    }
  }

  getActiveJob(): GenerationJob | null {
    return this.activeJob;
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  getJob(id: string): GenerationJob | undefined {
    if (this.activeJob && this.activeJob.id === id) return this.activeJob;
    const inQueue = this.queue.find(j => j.id === id);
    if (inQueue) return inQueue;
    return this.history.find(j => j.id === id);
  }

  getJobForBeat(beatId: string): GenerationJob | undefined {
    if (this.activeJob && this.activeJob.beatId === beatId) return this.activeJob;
    const inQueue = this.queue.find(j => j.beatId === beatId);
    if (inQueue) return inQueue;
    return this.history.find(j => j.beatId === beatId);
  }

  enqueue(job: GenerationJob): void {
    // Check if this beat is already queued or active
    const existing = this.getJobForBeat(job.beatId);
    if (existing && (existing.status === 'pending' || existing.status === 'running')) {
      new Notice(`Beat "${job.title}" is already in queue or generating.`);
      return;
    }

    this.queue.push(job);
    this.emitJobUpdate(job);
    new Notice(`Queued plate generation: ${job.title || job.scene}`);
    this.processNext();
  }

  cancelJob(jobId: string): void {
    if (this.activeJob && this.activeJob.id === jobId) {
      if (this.currentProcess) {
        try {
          this.currentProcess.kill('SIGTERM');
        } catch (e) {
          console.error("Failed to kill process:", e);
        }
      }
      this.activeJob.status = 'cancelled';
      this.activeJob.statusMessage = 'Cancelled by user';
      this.history.unshift(this.activeJob);
      this.emitJobUpdate(this.activeJob);
      this.activeJob = null;
      this.currentProcess = null;
      new Notice("Plate generation cancelled.");
      this.processNext();
      return;
    }

    const idx = this.queue.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      const removed = this.queue.splice(idx, 1)[0];
      removed.status = 'cancelled';
      removed.statusMessage = 'Cancelled in queue';
      this.history.unshift(removed);
      this.emitJobUpdate(removed);
      new Notice(`Removed from queue: ${removed.title}`);
    }
  }

  cancelAll(): void {
    if (this.currentProcess) {
      try {
        this.currentProcess.kill('SIGTERM');
      } catch (e) {
        console.error("Failed to kill active process:", e);
      }
    }
    if (this.activeJob) {
      this.activeJob.status = 'cancelled';
      this.activeJob.statusMessage = 'Queue cleared';
      this.history.unshift(this.activeJob);
      this.emitJobUpdate(this.activeJob);
      this.activeJob = null;
      this.currentProcess = null;
    }
    while (this.queue.length > 0) {
      const j = this.queue.shift()!;
      j.status = 'cancelled';
      j.statusMessage = 'Queue cleared';
      this.history.unshift(j);
      this.emitJobUpdate(j);
    }
    new Notice("Draw Things generation queue cleared.");
    this.emitStatus();
  }

  private async processNext(): Promise<void> {
    if (this.activeJob !== null || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift()!;
    this.activeJob = job;
    job.status = 'running';
    job.startedAt = Date.now();
    job.progress = 5;
    job.statusMessage = 'Starting Draw Things CLI...';
    this.emitJobUpdate(job);

    try {
      // Ensure target output folder exists
      const targetDir = path.dirname(job.outputPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      await this.runCliJob(job);

      // Verify output file exists
      if (fs.existsSync(job.outputPath)) {
        job.status = 'completed';
        job.progress = 100;
        job.completedAt = Date.now();
        job.statusMessage = 'Completed';

        // Write sidecar metadata JSON
        this.writeSidecarMetadata(job);

        new Notice(`✨ Generated plate: ${path.basename(job.outputPath)}`);
      } else {
        job.status = 'failed';
        job.error = 'CLI exited but output file was not created.';
        job.statusMessage = 'Output file missing';
        new Notice(`❌ Generation failed: output file not found.`);
      }
    } catch (err: any) {
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.error = err?.message || String(err);
        job.statusMessage = 'Error occurred';
        new Notice(`❌ Draw Things CLI error: ${job.error}`);
      }
    } finally {
      this.history.unshift(job);
      this.activeJob = null;
      this.currentProcess = null;
      this.emitJobUpdate(job);
      this.processNext();
    }
  }

  private runCliJob(job: GenerationJob): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cliBin = job.cliArgs[0];
      const args = job.cliArgs.slice(1);

      console.log(`[DrawThings] Spawning: ${cliBin} ${args.join(" ")}`);
      job.logs.push(`> ${cliBin} ${args.join(" ")}`);

      // Spawn child process
      const userLocalBin = path.join(os.homedir(), ".local", "bin");
      const child = spawn(cliBin, args, {
        env: {
          ...process.env,
          PATH: `/usr/local/bin:/opt/homebrew/bin:${userLocalBin}:${process.env.PATH || ""}`
        }
      });

      this.currentProcess = child;

      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        job.logs.push(text);
        this.parseProgress(job, text);
        this.emitJobUpdate(job);
      });

      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        job.logs.push(text);
        this.parseProgress(job, text);
        this.emitJobUpdate(job);
      });

      child.on("error", (err) => {
        reject(err);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else if (job.status === 'cancelled') {
          resolve();
        } else {
          const lastLog = job.logs.slice(-3).join("\n");
          reject(new Error(`Exit code ${code}: ${lastLog}`));
        }
      });
    });
  }

  private parseProgress(job: GenerationJob, text: string): void {
    // Look for step progress e.g. "step 5/12" or "5/12 [====>   ]" or "45%"
    const stepMatch = text.match(/step\s*(\d+)\s*\/\s*(\d+)/i) || text.match(/(\d+)\s*\/\s*(\d+)\s*\[/);
    if (stepMatch) {
      const current = parseInt(stepMatch[1], 10);
      const total = parseInt(stepMatch[2], 10);
      if (total > 0) {
        job.progress = Math.min(99, Math.round((current / total) * 100));
        job.statusMessage = `Sampling step ${current}/${total} (${job.progress}%)`;
        return;
      }
    }

    const pctMatch = text.match(/(\d+)%/);
    if (pctMatch) {
      job.progress = Math.min(99, parseInt(pctMatch[1], 10));
      job.statusMessage = `Generating... ${job.progress}%`;
      return;
    }

    if (text.includes("Loading model") || text.includes("Resolve")) {
      job.statusMessage = "Loading model into Metal GPU...";
    } else if (text.includes("Sampling") || text.includes("Generating")) {
      job.statusMessage = "Sampling image...";
    }
  }

  private writeSidecarMetadata(job: GenerationJob): void {
    try {
      const meta = {
        scene: job.scene,
        beat: job.beatNumber,
        title: job.title,
        prompt: job.prompt,
        effective_prompt: job.effectivePrompt,
        model: job.model,
        seed: job.seed,
        width: job.width,
        height: job.height,
        steps: job.steps,
        cfg: job.cfg,
        output_file: path.basename(job.outputPath),
        generated_at: new Date().toISOString(),
        duration_ms: (job.completedAt || Date.now()) - (job.startedAt || Date.now()),
        generator: "draw-things-cli (Obsidian Scene Illustrator)"
      };

      fs.writeFileSync(job.metaPath, JSON.stringify(meta, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to write sidecar metadata:", e);
    }
  }
}
