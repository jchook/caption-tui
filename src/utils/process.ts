import { spawn, type Subprocess } from "bun";

let currentProcess: Subprocess | null = null;

const DEFAULT_VIEWER = "qimgv";

export function getViewer(): string {
  return process.env.CAPTION_VIEWER || DEFAULT_VIEWER;
}

export async function openImage(imagePath: string): Promise<void> {
  await closeCurrentImage();

  const viewer = getViewer();
  currentProcess = spawn([viewer, imagePath], {
    stdout: "ignore",
    stderr: "ignore",
  });
}

export async function closeCurrentImage(): Promise<void> {
  if (currentProcess) {
    try {
      currentProcess.kill();
    } catch {
      // Process may have already exited
    }
    currentProcess = null;
  }
}
