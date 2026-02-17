export async function embedChunks(chunks: string[]) {
  return chunks.map(() => new Float32Array(0));
}
