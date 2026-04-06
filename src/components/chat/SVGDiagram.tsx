"use client"

import React, { useMemo } from "react"

interface SVGDiagramProps {
  svgCode: string
  caption?: string
}

function sanitizeSVG(svg: string): string {
  return svg
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
}

export function SVGDiagram({ svgCode, caption }: SVGDiagramProps) {
  const sanitized = useMemo(() => sanitizeSVG(svgCode), [svgCode])

  if (!sanitized || sanitized.length < 50) return null

  return (
    <div className="my-3">
      <div
        className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-3"
        style={{ maxWidth: "100%" }}
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

