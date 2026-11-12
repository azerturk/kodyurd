/** Where a code excerpt should open: the first line that declares behaviour. */
const classic = /\b(?:function|def|class|router|route)\b/i;
const modifiers = "(?:(?:pub(?:\\([a-z]+\\))?|public|private|protected|internal|fileprivate|open|static|final|override|abstract|async|unsafe|extern|export|sealed|inline|suspend)\\s+)*";
const typed = new RegExp(
  `^\\s*${modifiers}(?:func|fn|fun|defp|defmodule|defmacro|struct|trait|impl|interface|enum|object|protocol|extension|actor|proc)\\b`
  + "|^\\s*type\\s+[A-Za-z_]\\w*\\s+(?:struct|interface)\\b"
);
// Languages whose files rarely contain the classic keywords: look for their own first.
const typedFirst = new Set(["go", "rs", "swift", "kt", "kts", "ex", "exs", "zig", "nim"]);
const typedFallback = new Set(["scala", "sc", "dart", "cs", "java", "c", "h", "cc", "cpp", "hpp", "m", "mm", "fs", "hs", "erl", "clj", "lua"]);

/** Zero-based index of the first declaration line, or -1 when the file has none. */
export function declarationLine(file: string, lines: readonly string[]): number {
  const extension = /\.([A-Za-z0-9]+)$/.exec(file)?.[1].toLowerCase() ?? "";
  const first = (pattern: RegExp): number => lines.findIndex((line) => pattern.test(line));
  if (typedFirst.has(extension)) {
    const index = first(typed);
    return index >= 0 ? index : first(classic);
  }
  const index = first(classic);
  return index >= 0 || !typedFallback.has(extension) ? index : first(typed);
}
