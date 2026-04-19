import React from "react";
import StepBar from "./StepBar";

export function generateStaticParams() {
  return [
    { id: "proj_001" },
    { id: "proj_002" },
    { id: "proj_003" },
    { id: "demo_project" },
  ];
}

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <StepBar />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
