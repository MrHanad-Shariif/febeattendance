import { useEffect, useState } from "react";
import client from "@/api/client";

/**
 * <img> for files that need the signed-in user's token (student photos).
 * A plain <img src> can't send the Authorization header, so the file is
 * fetched through the API client and shown from an object URL.
 * Renders `fallback` while loading or if the file can't be fetched.
 */
export function AuthImage({ src, alt = "", className, fallback = null }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!src) {
      setUrl(null);
      return undefined;
    }
    let objectUrl;
    let cancelled = false;
    // photo_url is "/api/uploads/..." but the client's baseURL already ends in /api.
    client
      .get(src.replace(/^\/api/, ""), { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return url ? <img src={url} alt={alt} className={className} /> : fallback;
}
