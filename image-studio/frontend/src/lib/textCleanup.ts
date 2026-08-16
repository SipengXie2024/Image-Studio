// Shared cleanup for LLM text responses that may arrive wrapped in a markdown
// code fence or quotes. Single source for every consumer (prompt suggestion,
// upstream config import) so the stripping rules cannot drift apart.

export function stripWrappedCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```[a-zA-Z0-9-]*\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

export function stripWrappedQuotes(raw: string): string {
  const text = raw.trim();
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "“" && last === "”")) {
    return text.slice(1, -1).trim();
  }
  return text;
}
