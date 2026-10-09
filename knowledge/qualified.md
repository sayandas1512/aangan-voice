<!--
PLACEHOLDER — this file has not been supplied yet.
Replace with the real qualification rubric before relying on classification
output. Until replaced, lib/integrations/gemini.ts and
agent/gemini-classify.prompt.md will flag every classification as using
the placeholder rubric (see DECISIONS.md, "Open [ASK] items").
-->

# Qualification rubric (PLACEHOLDER)

A lead is classified from the seven collected answers (home/office, area,
size, work type, budget, timeline, contact details).

- **yes** — work type is full interiors or a full renovation, AND a
  reasonably specific area/locality in Pune was given, AND the timeline is
  "soon" (within ~3 months) or "flexible but real".
- **maybe** — partial scope (a few rooms only), OR budget was declined/vague,
  OR timeline is more than 3 months out, OR the area given is outside Pune
  but nearby and plausibly served.
- **no** — work the studio does not do (see services.md), OR clearly outside
  the service area, OR not a genuine enquiry (spam/sales/wrong number), OR
  an existing client issue (handled separately, not a new lead).

This is a placeholder only. Do not treat it as the studio's actual rubric.
