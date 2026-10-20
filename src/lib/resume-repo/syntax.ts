export function maskComments(source: string): string {
  return source.replace(/(^|\n)([^\n]*)/g, (_, prefix: string, line: string) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "%") continue;
      let slashes = 0; for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) slashes++;
      if (!(slashes % 2)) return prefix + line.slice(0, i) + " ".repeat(line.length - i);
    }
    return prefix + line;
  });
}
export function group(source: string, position: number, opener = "{") {
  const closer = opener === "{" ? "}" : "]";
  while (/\s/.test(source[position] ?? "") && position < source.length) position++;
  if (source[position] !== opener) throw new Error("Unsupported LaTeX argument structure");
  const start = position + 1;
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === opener) depth++;
    if (source[i] === closer && --depth === 0) return { start, end: i, next: i + 1, text: source.slice(start, i) };
  }
  throw new Error("Unbalanced LaTeX argument");
}
