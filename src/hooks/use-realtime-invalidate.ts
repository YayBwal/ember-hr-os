import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to postgres_changes on `tables` and invalidate the listed query keys
 * on any change. Use once per page.
 */
export function useRealtimeInvalidate(tables: string[], keys: (string | string[])[]) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel(`rt-${tables.join("-")}-${Math.random().toString(36).slice(2, 8)}`);
    for (const t of tables) {
      channel.on(
        // @ts-expect-error supabase types
        "postgres_changes",
        { event: "*", schema: "public", table: t },
        () => {
          for (const k of keys) {
            qc.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] });
          }
        },
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
