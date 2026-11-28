/** "1 note", "3 notes": a count with its noun, for nouns that take an -s. */
export const countedNoun = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`
