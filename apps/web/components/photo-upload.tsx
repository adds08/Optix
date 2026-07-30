"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getApiUrl } from "@/lib/trpc";
import { photoUrl } from "@/lib/format";
import { Button } from "@/components/ui/button";

/*
  One photo per tool.

  Posted to the API as plain multipart rather than through tRPC, whose transport
  is JSON — a file would have to be base64'd into a request body to travel that
  way, which inflates it by a third and holds the whole thing in memory twice.

  The server is the authority on size and type. The checks here exist to fail in
  a hundred milliseconds instead of after an eight megabyte upload over site
  wifi, which is the difference between a mistake and a wasted afternoon.
*/

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";

export function PhotoUpload({
  assetId,
  photoKey,
  onChange,
}: {
  assetId: string;
  photoKey: string | null | undefined;
  onChange: (key: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Shown immediately from the chosen file, so the picture appears while the
     bytes are still going up. */
  const [preview, setPreview] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const current = preview ?? photoUrl(photoKey);

  async function send(file: File) {
    setError(null);

    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Photos must be a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1048576).toFixed(1)}MB. The limit is 8MB.`);
      return;
    }

    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const body = new FormData();
      body.append("photo", file);
      const token = typeof window !== "undefined" ? localStorage.getItem("sti-session") : null;
      const res = await fetch(`${getApiUrl()}/assets/${assetId}/photo`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The upload did not go through.");
      onChange(data.photoKey ?? null);
      utils.asset.list.invalidate();
      utils.asset.get.invalidate({ id: assetId });
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "The upload did not go through.");
    }
    setBusy(false);
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sti-session") : null;
      const res = await fetch(`${getApiUrl()}/assets/${assetId}/photo`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Could not remove the photo.");
      setPreview(null);
      onChange(null);
      utils.asset.list.invalidate();
      utils.asset.get.invalidate({ id: assetId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the photo.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {current ? (
            <img src={current} alt="" className="size-full object-contain" />
          ) : (
            <Wrench className="size-6 text-muted-foreground/30" aria-hidden />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            /* `capture` is what makes a phone offer the camera rather than only
               the gallery — the case this feature is for. */
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) send(f);
              /* Reset, so choosing the same file twice still fires. */
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
              {current ? "Replace photo" : "Add a photo"}
            </Button>
            {current && !busy ? (
              <Button type="button" size="sm" variant="outline" onClick={clear}>
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 8MB.</p>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
