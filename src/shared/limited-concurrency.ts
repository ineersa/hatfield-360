/** `map` over `items` with at most `limit` calls running at once; results keep the items' order. */
export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  map: (item: Item) => Promise<Result>
): Promise<Result[]> {
  const results: Result[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      const item = items[index]
      if (item !== undefined) results[index] = await map(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
