export async function getSession() {
  return null;
}

export function requireAuth() {
  return { user: null, error: "unauthorized" };
}
