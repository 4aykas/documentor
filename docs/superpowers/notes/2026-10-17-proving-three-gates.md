# Proving note: the three-gates flow through the current Mermaid engine

**2026-10-17.** First proving material for the diagram system
(`docs/superpowers/specs/2026-10-17-diagram-system-design.md`, "Proving
material"): the flow of the 2026-10-20 LinkedIn post, written as a
` ```mermaid ` fence (`projects/marketing/posts/2026-10-21-three-gates-revit-agent/graphic/three-gates.md`)
and built with `--theme tebin` after phase 0 (1d0a2bf). Ten nodes, two
decisions, one dashed loop — inside the flowchart budget (9 nodes / 12 edges is
one node over).

What it showed, for phase 1:

1. **The size warning gives the wrong advice for a tall diagram.** The drawing
   is limited by the page height (72 % of the text block), not the column, so
   labels print at 7.2 pt against 10 pt body. The warning says "fewer
   side-by-side boxes or shorter labels would keep them readable"; neither
   helps a top-down chain. `D-SMALL` should say which dimension binds and, for
   height, suggest splitting the chain or turning it left-to-right.
2. **Branches leave a diamond on slanted segments.** dagre with
   `curve: 'linear'` joins a decision's corner to an off-axis box diagonally
   (both decisions here). diagram-design treats a diagonal connector as an
   automatic fail. Candidate: try `curve: 'step'` (or `stepAfter`) across the
   gallery, and if it holds, record it in an ADR amending 0004's neighbour
   rules; a `D-SLANT` check would then guard it.
3. **`:::focus` does nothing yet, silently.** Expected before phase 1; the
   focus rule must also cover the case where the author never declared the
   class.
4. The figure sits at the left of the column at about a third of its width.
   Whether a narrow diagram should centre is a layout question for the themes,
   not a check.
