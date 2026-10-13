// Client-safe review indicator; source parsing and Git operations stay server-only.
export function factsChanged(before: string, after: string): boolean {
  const numbers = (text: string) => [...text.matchAll(/\d+(?:\.\d+)?(?:\+|\\?%)?/g)].map((match) => match[0]).sort().join("|");
  return numbers(before) !== numbers(after);
}
