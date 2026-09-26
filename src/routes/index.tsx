import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CadenceScreen, CadenceShell } from "@/components/cadence/screen";
import { bootCadence, useCadence } from "@/lib/cadence/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const hydrated = useCadence((s) => s.hasHydrated);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    void bootCadence();
  }, []);

  if (!mounted || !hydrated) return <CadenceShell />;
  return <CadenceScreen />;
}
