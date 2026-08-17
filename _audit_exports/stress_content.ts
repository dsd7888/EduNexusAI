/**
 * AU-EXPORTS canonical stress content — the SAME formula-heavy + diagram-heavy +
 * unicode-heavy source pushed through all 5 render engines + PPT, so their
 * outputs can be diffed. Not application code; throwaway audit fixture.
 */

export const FRAC = "\\frac{d^2y}{dx^2} + \\omega^2 y = 0";
export const FORALL = "\\forall x \\in \\mathbb{R},\\ \\exists y : y > x";
export const MATRIX =
  "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\begin{pmatrix} x \\\\ y \\end{pmatrix} = \\begin{pmatrix} 1 \\\\ 0 \\end{pmatrix}";
export const CHEM = "\\ce{2H2 + O2 -> 2H2O}";
export const INTEGRAL = "\\int_a^b f(x)\\,dx = F(b) - F(a)";

// Unicode outside each PDF sanitizer's curated allowlist (Devanagari, emoji,
// therefore/subset/double-arrow symbols, uncommon Greek not in either list).
export const UNICODE_STRESS =
  "Sample text मापदंड 🔬 with symbols: ∴ A ⊂ B, P ⇒ Q, damping ζ and ξ, em—dash, café";

export const LONG_TABLE_MD = `| Trial | Load (N) | Deflection (mm) | Stress (MPa) | Remarks |
|---|---|---|---|---|
| 1 | 100 | 0.42 | 12.5 | within limit |
| 2 | 200 | 0.88 | 25.1 | within limit |
| 3 | 300 | 1.31 | 37.8 | within limit |
| 4 | 400 | 1.79 | 50.2 | near yield |
| 5 | 500 | 2.35 | 62.9 | yield onset |
| 6 | 600 | 3.02 | 75.4 | plastic |
| 7 | 700 | 3.91 | 88.0 | plastic |
| 8 | 800 | 5.20 | 100.6 | necking |
| 9 | 900 | 7.10 | 113.1 | necking |
| 10 | 1000 | 9.85 | 125.7 | fracture |`;

/** A valid, dense (>6 primitive) SVG diagram (a simple RC circuit-style block diagram). */
export const SVG_DIAGRAM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
  <rect x="0" y="0" width="800" height="400" fill="#F8FAFC"/>
  <rect x="100" y="150" width="120" height="60" fill="none" stroke="#0F172A" stroke-width="2"/>
  <text x="160" y="185" font-size="16" text-anchor="middle">R1</text>
  <line x1="220" y1="180" x2="340" y2="180" stroke="#0F172A" stroke-width="2"/>
  <circle cx="380" cy="180" r="40" fill="none" stroke="#0F172A" stroke-width="2"/>
  <text x="380" y="185" font-size="16" text-anchor="middle">C1</text>
  <line x1="420" y1="180" x2="540" y2="180" stroke="#0F172A" stroke-width="2"/>
  <polygon points="540,170 560,180 540,190" fill="#0F172A"/>
  <text x="600" y="185" font-size="16" text-anchor="middle">Vout</text>
</svg>`;

/** A valid, non-trivial Mermaid flowchart. */
export const MERMAID_DIAGRAM = `flowchart TD
  A[Start] --> B{Load > Yield?}
  B -->|Yes| C[Plastic Deformation]
  B -->|No| D[Elastic Region]
  C --> E[Necking]
  E --> F[Fracture]
  D --> G[Return to Origin]`;

export const WORKED_PROBLEM = `A ${UNICODE_STRESS}. Given the table below:
${LONG_TABLE_MD}
Find deflection at 500N using $${FRAC}$.`;

export const WORKED_SOLUTION = `Applying $${INTEGRAL}$ and the boundary condition $${FORALL}$, and the reaction ${CHEM}, we solve the system $${MATRIX}$ to get the deflection.`;
