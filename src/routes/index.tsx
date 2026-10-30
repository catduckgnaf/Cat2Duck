import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ToduckScreen, ToduckShell } from "@/components/toduck/screen";
import { bootToduck, useToduck } from "@/lib/toduck/store";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const hydrated = useToduck((s) => s.hasHydrated);
  const [mounted, setMounted] = useState(false);
  const { user, isPending } = useCurrentUserState();

  useEffect(() => {
    setMounted(true);
    void bootToduck();
  }, []);

  if (!mounted || !hydrated || (authEnabled && isPending)) return <ToduckShell />;
  if (authEnabled && !user) return <Navigate to="/login" />;
  return <ToduckScreen />;
}
