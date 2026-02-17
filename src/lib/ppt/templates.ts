export const DEFAULT_TEMPLATE = "default";

export function getTemplate(name: string) {
  return { name, layout: "title-and-content" };
}
