import { useEffect, useState } from "react";
import { api, isDemo } from "../lib/api";
import type { User } from "../lib/types";
export function Avatar({ user }: { user: User }) {
  const [photo, setPhoto] = useState<{ owner: string; data: string | null } | null>(null);
  const data = photo?.owner === user.id ? photo.data : null;
  useEffect(() => {
    if (isDemo()) return;
    const c = new AbortController();
    let request = 0;
    const refresh = () => {
      const current = ++request;
      api<{ data: string | null }>("/users/me/avatar", { signal: c.signal })
        .then((r) => { if (request === current && !c.signal.aborted) setPhoto({ owner: user.id, data: r.data }); })
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
