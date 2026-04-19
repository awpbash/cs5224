// Static params for Next.js static export with dynamic [id] routes.
// In production, this would list real project IDs. For the demo, we
// pre-render a set of known IDs so the SPA shell loads for any of them.
export function generateProjectStaticParams() {
  return [
    { id: "proj_001" },
    { id: "proj_002" },
    { id: "proj_003" },
    { id: "demo_project" },
  ];
}
