import { createFileRoute } from "@tanstack/react-router";
import { AcervoShell } from "@/components/acervo-shell";

export const Route = createFileRoute("/")({ component: AcervoShell });
