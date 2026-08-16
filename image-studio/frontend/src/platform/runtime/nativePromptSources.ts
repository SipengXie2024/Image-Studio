import { ensureBase64FromSource } from "../../lib/images.ts";

export type NativePromptSourceLike = {
  path?: string;
  name?: string;
  imageB64?: string | null;
  imageBlob?: Blob | null;
};

export type NativePromptSourceBridge = {
  importImageFromBase64: (imageB64: string, suggestedName: string) => Promise<{ path?: string }>;
  readNonNativePathAsBase64?: (path: string) => Promise<string>;
  readNativePathAsBase64?: (path: string) => Promise<string>;
};

export function isNativeFilePath(path: string | null | undefined): boolean {
  const value = (path ?? "").trim();
  if (!value) return false;
  if (/^[a-z]:[\\/]/iu.test(value) || value.startsWith("/") || value.startsWith("\\\\")) return true;
  return !/^[a-z][a-z0-9+.-]*:/iu.test(value);
}

function appendPreparedPath(paths: string[], seen: Set<string>, path: string, preserveMultiplicity: boolean): void {
  const value = path.trim();
  if (!value || (!preserveMultiplicity && seen.has(value))) return;
  seen.add(value);
  paths.push(value);
}

export async function prepareNativePromptImagePaths(
  input: {
    sourceImages?: readonly NativePromptSourceLike[];
    imagePaths?: readonly string[];
    imagePath?: string;
  },
  bridge: NativePromptSourceBridge,
): Promise<string[]> {
  const sources: readonly NativePromptSourceLike[] = input.sourceImages?.length
    ? input.sourceImages
    : [...(input.imagePaths ?? []), input.imagePath ?? ""]
      .filter((path) => path.trim())
      .map((path) => ({ path }));
  const paths: string[] = [];
  const seen = new Set<string>();
  const preserveMultiplicity = Boolean(input.sourceImages?.length);

  for (const [index, source] of sources.entries()) {
    const sourcePath = source.path?.trim() ?? "";
    if (isNativeFilePath(sourcePath)) {
      if (!bridge.readNativePathAsBase64) {
        appendPreparedPath(paths, seen, sourcePath, preserveMultiplicity);
        continue;
      }
      const readable = await bridge.readNativePathAsBase64(sourcePath).then((value) => Boolean(value.trim())).catch(() => false);
      if (readable) {
        appendPreparedPath(paths, seen, sourcePath, preserveMultiplicity);
        continue;
      }
    }

    let imageB64 = await ensureBase64FromSource(source);
    if (!imageB64 && sourcePath && bridge.readNonNativePathAsBase64) {
      imageB64 = await bridge.readNonNativePathAsBase64(sourcePath).catch(() => "");
    }
    if (!imageB64) {
      // The readback probe only accepts managed roots, but dialog-picked files
      // live anywhere on disk. Hand the raw path to the host: its upload reader
      // accepts any readable file (same as generation) and surfaces the real
      // filesystem error otherwise.
      if (isNativeFilePath(sourcePath)) {
        appendPreparedPath(paths, seen, sourcePath, preserveMultiplicity);
        continue;
      }
      throw new Error(`无法准备第 ${index + 1} 个图片附件(${source.name?.trim() || sourcePath || "无路径"})`);
    }

    const ordinal = String(index + 1).padStart(3, "0");
    const suggestedName = `${ordinal}-${source.name?.trim() || "image.png"}`;
    const imported = await bridge.importImageFromBase64(imageB64, suggestedName);
    const importedPath = imported.path?.trim() ?? "";
    if (!isNativeFilePath(importedPath)) {
      throw new Error(`第 ${index + 1} 个图片附件未能保存到本地文件`);
    }
    appendPreparedPath(paths, seen, importedPath, preserveMultiplicity);
  }

  return paths;
}
