export async function checkRateLimit(identifier: string) {
  return { allowed: true, remaining: 100 };
}
