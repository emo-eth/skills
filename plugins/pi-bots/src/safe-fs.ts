import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export type ContainedFile = {
  path: string;
  exists: boolean;
};

export async function ensureContainedDirectory(root: string, directory: string): Promise<string> {
  const resolved = await requireContainedDirectory(root, directory, true);
  if (resolved === undefined) throw new Error(`pi-bots: failed to create directory ${directory}`);
  return resolved;
}

export async function inspectContainedFile(
  root: string,
  target: string,
  createParents: boolean,
): Promise<ContainedFile> {
  requireLexicalContainment(root, target);
  const directory = await requireContainedDirectory(root, path.dirname(target), createParents);
  if (directory === undefined) return { path: path.join(await realpath(root), path.relative(root, target)), exists: false };
  const resolved = path.join(directory, path.basename(target));
  try {
    const info = await lstat(resolved);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`pi-bots: unsafe non-regular file ${resolved}`);
    return { path: resolved, exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: resolved, exists: false };
    throw error;
  }
}

export async function readContainedFileBounded(
  root: string,
  target: string,
  limitBytes: number,
): Promise<{ content: string; truncated: boolean } | undefined> {
  const file = await inspectContainedFile(root, target, false);
  if (!file.exists) return undefined;
  const handle = await open(file.path, constants.O_RDONLY | NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`pi-bots: unsafe non-regular file ${file.path}`);
    const limit = Math.max(limitBytes, 0);
    const window = Buffer.allocUnsafe(limit + 1);
    const { bytesRead } = await handle.read(window, 0, window.byteLength, 0);
    const truncated = bytesRead > limit;
    const visible = window.subarray(0, Math.min(bytesRead, limit)).toString("utf8");
    const content = truncated && visible.endsWith("\uFFFD") ? visible.slice(0, -1) : visible;
    return { content, truncated };
  } finally {
    await handle.close();
  }
}
export async function readContainedFileTail(
  root: string,
  target: string,
  limitBytes: number,
): Promise<{ content: string; truncated: boolean } | undefined> {
  const file = await inspectContainedFile(root, target, false);
  if (!file.exists) return undefined;
  const handle = await open(file.path, constants.O_RDONLY | NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`pi-bots: unsafe non-regular file ${file.path}`);
    const limit = Math.max(limitBytes, 0);
    const start = Math.max(info.size - limit, 0);
    const window = Buffer.allocUnsafe(Math.min(info.size, limit));
    const { bytesRead } = await handle.read(window, 0, window.byteLength, start);
    let content = window.subarray(0, bytesRead).toString("utf8");
    if (start > 0 && content.startsWith("\uFFFD")) content = content.slice(1);
    return { content, truncated: start > 0 };
  } finally {
    await handle.close();
  }
}


export async function createContainedFileExclusive(root: string, target: string, content: string): Promise<void> {
  const file = await inspectContainedFile(root, target, true);
  if (file.exists) throw alreadyExists(file.path);
  const temporaryTarget = temporaryName(target);
  const temporary = await inspectContainedFile(root, temporaryTarget, true);
  try {
    await writeNewRegularFile(temporary.path, content);
    await link(temporary.path, file.path);
  } finally {
    await rm(temporary.path, { force: true });
  }
}

export async function appendContainedFile(root: string, target: string, content: string): Promise<void> {
  const file = await inspectContainedFile(root, target, true);
  const handle = await open(file.path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`pi-bots: unsafe non-regular file ${file.path}`);
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}

export async function replaceContainedFile(root: string, target: string, content: string): Promise<void> {
  const file = await inspectContainedFile(root, target, true);
  const temporaryTarget = temporaryName(target);
  const temporary = await inspectContainedFile(root, temporaryTarget, true);
  try {
    await writeNewRegularFile(temporary.path, content);
    await rename(temporary.path, file.path);
  } finally {
    await rm(temporary.path, { force: true });
  }
}

export async function removeContainedRegularFile(root: string, target: string): Promise<void> {
  const file = await inspectContainedFile(root, target, false);
  if (file.exists) await rm(file.path);
}

async function writeNewRegularFile(target: string, content: string): Promise<void> {
  const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`pi-bots: unsafe non-regular file ${target}`);
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}

export async function withContainedFileLock<T>(
  root: string,
  target: string,
  run: () => Promise<T>,
  timeoutMs = 5_000,
  staleMs = 60_000,
): Promise<T> {
  requireLexicalContainment(root, target);
  const directory = await ensureContainedDirectory(root, path.dirname(target));
  const resolvedTarget = path.join(directory, path.basename(target));
  const resolvedStaleMs = Math.max(2_000, staleMs);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(resolvedTarget, {
      lockfilePath: `${resolvedTarget}.lock`,
      realpath: false,
      stale: resolvedStaleMs,
      update: Math.max(1_000, Math.floor(resolvedStaleMs / 2)),
      retries: {
        retries: Math.max(0, Math.ceil(timeoutMs / 10)),
        factor: 1,
        minTimeout: 10,
        maxTimeout: 10,
        randomize: false,
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
    throw new Error(`pi-bots: timed out acquiring coordination lock ${resolvedTarget}.lock`);
  }
  try {
    return await run();
  } finally {
    await release();
  }
}

function temporaryName(target: string): string {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
}

function alreadyExists(target: string): Error {
  return Object.assign(new Error(`pi-bots: file already exists ${target}`), { code: "EEXIST" });
}

async function requireContainedDirectory(
  root: string,
  directory: string,
  create: boolean,
): Promise<string | undefined> {
  requireLexicalContainment(root, directory);
  const rootReal = await realpath(path.resolve(root));
  const relative = path.relative(path.resolve(root), path.resolve(directory));
  if (relative === "") return rootReal;
  let current = rootReal;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return undefined;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
      }
      info = await lstat(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`pi-bots: unsafe non-directory path component ${current}`);
    }
  }
  return current;
}

function requireLexicalContainment(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) return;
  throw new Error(`pi-bots: path escapes root ${path.resolve(root)}: ${path.resolve(target)}`);
}
