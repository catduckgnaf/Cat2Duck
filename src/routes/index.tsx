import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ToduckScreen, ToduckShell } from "@/components/toduck/screen";
import { bootToduck, useToduck } from "@/lib/toduck/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const hydrated = useToduck((s) => s.hasHydrated);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    void bootToduck();
  }, []);

  if (!mounted || !hydrated) return <ToduckShell />;
  return <ToduckScreen />;
}
