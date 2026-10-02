import { useEffect, useState } from "react";
import { api, isDemo } from "../lib/api";
import type { User } from "../lib/types";
export function Avatar({ user }: { user: User }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    if (isDemo()) return;
    const c = new AbortController();
    const refresh = () => {
      api<{ data: string | null }>("/users/me/avatar", { signal: c.signal })
        .then((r) => setData(r.data))
        .catch(() => {});
    };
    refresh();
    window.addEventListener("lifehub:avatar", refresh);
    return () => {
      c.abort();
      window.removeEventListener("lifehub:avatar", refresh);
    };
  }, [user.id]);
  return data ? (
    <img className="user-avatar-image" src={data} alt="" />
  ) : (
    <>{user.name.slice(0, 1).toUpperCase()}</>
  );
}
