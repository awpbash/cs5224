"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectId } from "@/hooks/useProjectId";

export default function ProjectPage() {
  const id = useProjectId();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/projects/${id}/upload`);
  }, [id, router]);

  return null;
}
