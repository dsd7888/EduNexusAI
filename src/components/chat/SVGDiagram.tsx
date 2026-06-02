"use client"

import { useMemo } from "react"

interface SVGDiagramProps {
  svgCode: string
  caption?: string
}

function sanitizeSVG(raw: string): string {
  let svg = raw
    // Remove script tags and content
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    // Remove event handlers
    .replace(/\s+on\w+="[^"]*"/gi, "")
    .replace(/\s+on\w+='[^']*'/gi, "")
    // Remove external hrefs (keep internal #refs)
    .replace(/href="(?!#)[^"]*"/gi, 'href="#"')
    .replace(/xlink:href="(?!#)[^"]*"/gi, 'xlink:href="#"')
    // Remove foreignObject
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .trim()

  // Ensure SVG has explicit width/height so it renders in browser —
  // viewBox-only SVGs collapse to 0x0 without a container size hint
  svg = svg.replace(/<svg([^>]*)>/, (_match, attrs: string) => {
    if (/\bwidth=/.test(attrs) && /\bheight=/.test(attrs)) {
      return `<svg${attrs}>`
    }
    const vbMatch = attrs.match(/viewBox="[^"]*\s+(\d+)\s+(\d+)"/)
    const w = vbMatch ? vbMatch[1] : "800"
    const h = vbMatch ? vbMatch[2] : "400"
    return `<svg${attrs} width="${w}" height="${h}">`
  })

  return svg
}

export function SVGDiagram({ svgCode, caption }: SVGDiagramProps) {
  const sanitized = useMemo(() => sanitizeSVG(svgCode), [svgCode])

  console.log(
    "[SVGDiagram] content length:",
    svgCode?.length,
    "preview:",
    svgCode?.slice(0, 80)
  )
  console.log(
    "[SVGDiagram] sanitized length:",
    sanitized?.length,
    "preview:",
    sanitized?.slice(0, 80)
  )

  if (!sanitized || sanitized.length < 50) return null

  return (
    <div className="my-3">
      <div
        className="w-full overflow-hidden rounded-lg bg-white [&>svg]:w-full [&>svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
      {caption && (
        <p className="mt-1.5 text-xs text-slate-500 italic">
          📊 {caption}
        </p>
      )}
    </div>
  )
}

