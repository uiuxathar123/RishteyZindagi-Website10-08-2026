"use client";

import { Button } from "@/components/ui/Button";
import { PhotoImage } from "@/components/ui/PhotoImage";
import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { OwnerPhoto } from "@/lib/api/types";
import { photoSrc } from "@/lib/photo";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Limits enforced by the backend (profiles.service.ts). They are mirrored here only as a courtesy — the API is authoritative. */
const MAX_PHOTOS = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_DIMENSION = 200;
const ACCEPT = "image/jpeg,image/png,image/webp";
const ALLOWED_TYPES = new Set(ACCEPT.split(","));

interface UploadItem {
  key: string;
  name: string;
  status: "uploading" | "error";
  error?: string;
}

type Busy = "primary" | "delete" | "move";

function messageOf(e: unknown): string {
  if (isApiError(e)) return e.kind === "validation" || e.kind === "conflict" ? e.message || e.friendlyMessage : e.friendlyMessage;
  return "Something went wrong. Please try again.";
}

async function courtesyCheck(file: File): Promise<string | null> {
  if (!ALLOWED_TYPES.has(file.type)) return "Only JPEG, PNG or WebP images are accepted.";
  if (file.size > MAX_BYTES) return `This photo is larger than ${MAX_BYTES / (1024 * 1024)} MB.`;
  if (file.size === 0) return "This file is empty.";
  try {
    const bmp = await createImageBitmap(file);
    const { width, height } = bmp;
    bmp.close?.();
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) return `Photos must be at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`;
  } catch {
    return "This file couldn’t be read as an image.";
  }
  return null;
}

export function PhotoManager({ photos: initial, onChanged }: { photos: OwnerPhoto[]; onChanged: () => void }) {
  const [photos, setPhotos] = useState<OwnerPhoto[]>(initial);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [itemError, setItemError] = useState<Record<string, string>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const initialKey = JSON.stringify(initial.map((p) => [p.id, p.isPrimary, p.sortOrder]));
  useEffect(() => {
    setPhotos(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  const uploading = uploads.some((u) => u.status === "uploading");
  const anyBusy = Object.keys(busy).length > 0 || uploading;
  const room = MAX_PHOTOS - photos.length;

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setNotice(null);
    let files = Array.from(list);
    if (files.length > room) {
      setNotice(`You can add ${Math.max(room, 0)} more photo${room === 1 ? "" : "s"} (the limit is ${MAX_PHOTOS}); extra files were skipped.`);
      files = files.slice(0, Math.max(room, 0));
    }
    const items: UploadItem[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, status: "uploading" }));
    setUploads((u) => [...u, ...items]);

    let uploadedAny = false;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = items[i].key;
      const problem = await courtesyCheck(file);
      if (problem) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "error", error: problem } : x)));
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("photo", file);
        const { photo } = await api.upload<{ photo: OwnerPhoto }>("/profiles/me/photos", fd);
        uploadedAny = true;
        setPhotos((p) => [...p, photo]);
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "error", error: messageOf(e) } : x)));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
    if (uploadedAny) onChanged();
  }

  async function run(id: string, kind: Busy, fn: () => Promise<void>) {
    setBusy((b) => ({ ...b, [id]: kind }));
    setItemError((e) => {
      const { [id]: _drop, ...rest } = e;
      return rest;
    });
    try {
      await fn();
      onChanged();
    } catch (e) {
      setItemError((m) => ({ ...m, [id]: messageOf(e) }));
    } finally {
      setBusy((b) => {
        const { [id]: _drop, ...rest } = b;
        return rest;
      });
    }
  }

  const makePrimary = (id: string) =>
    run(id, "primary", async () => {
      const r = await api.patch<{ photos: OwnerPhoto[] }>(`/profiles/me/photos/${id}/primary`);
      setPhotos(r.photos);
    });

  const move = (id: string, delta: -1 | 1) =>
    run(id, "move", async () => {
      const from = photos.findIndex((p) => p.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= photos.length) return;
      const order = photos.map((p) => p.id);
      [order[from], order[to]] = [order[to], order[from]];
      const r = await api.patch<{ photos: OwnerPhoto[] }>("/profiles/me/photos/reorder", { photoIds: order });
      setPhotos(r.photos);
    });

  const remove = (id: string) =>
    run(id, "delete", async () => {
      await api.delete(`/profiles/me/photos/${id}`);
      setConfirmId(null);
      // The backend may promote another photo to primary; re-read the list instead of guessing.
      const r = await api.get<{ photos: OwnerPhoto[] }>("/profiles/me/photos");
      setPhotos(r.photos);
    });

  return (
    <div>
      <p className="text-sm text-rz-muted">
        Add up to {MAX_PHOTOS} photos (JPEG, PNG or WebP, up to {MAX_BYTES / (1024 * 1024)} MB each, at least {MIN_DIMENSION}×{MIN_DIMENSION} pixels). Your main photo is the one other members see first, and
        your profile needs at least one photo to be shown in search.
      </p>

      <div aria-live="polite" className="mt-3 space-y-2">
        {notice && <p className="rounded-md border border-rz-gold/40 bg-rz-champagne px-3 py-2 text-sm text-rz-gold-deep">{notice}</p>}
      </div>

      {photos.length === 0 && uploads.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-rz-border bg-rz-ivory px-6 py-10 text-center">
          <p className="font-serif text-lg font-semibold text-rz-navy">No photos yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-rz-muted">A clear, recent photo of your face makes your profile far more likely to be noticed.</p>
          <Button type="button" className="mt-4" icon={<Plus className="h-4 w-4" />} onClick={() => inputRef.current?.click()}>
            Add your first photo
          </Button>
        </div>
      )}

      <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((p, i) => {
          const b = busy[p.id];
          const err = itemError[p.id];
          return (
            <li key={p.id} className="min-w-0">
              <div className={cn("relative aspect-[4/5] overflow-hidden rounded-md border bg-rz-peach", p.isPrimary ? "border-rz-maroon" : "border-rz-border")}>
                <PhotoImage src={photoSrc(p.url, "member")} alt={p.isPrimary ? "Main profile photo" : `Profile photo ${i + 1}`} sizes="(min-width: 768px) 22vw, 45vw" />
                {p.isPrimary && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-rz-maroon px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Star className="h-3 w-3" aria-hidden /> Main photo
                  </span>
                )}
                {p.uploadStatus && p.uploadStatus !== "COMPLETE" && (
                  <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-rz-navy">Processing ({p.uploadStatus.toLowerCase()})</span>
                )}
                {b && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60" role="status" aria-label="Working">
                    <Loader2 className="h-6 w-6 animate-spin text-rz-maroon" />
                  </div>
                )}
              </div>

              {confirmId === p.id ? (
                <div className="mt-2 rounded-md border border-rz-danger/30 bg-rz-danger/5 p-2.5 text-xs text-rz-text" role="alertdialog" aria-label="Confirm delete photo">
                  <p>
                    Delete this photo?
                    {photos.length === 1 && " It’s your only photo — your profile will be hidden from search until you add another."}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" className="!h-8 !px-3 !bg-rz-danger !text-xs" disabled={anyBusy} onClick={() => remove(p.id)}>
                      {b === "delete" ? "Deleting…" : "Delete"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="!h-8 !px-3 !text-xs" disabled={b === "delete"} onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    aria-label="Move photo earlier"
                    disabled={anyBusy || i === 0}
                    onClick={() => move(p.id, -1)}
                    className="rz-focus rounded-md border border-rz-border p-1.5 text-rz-muted hover:text-rz-maroon disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move photo later"
                    disabled={anyBusy || i === photos.length - 1}
                    onClick={() => move(p.id, 1)}
                    className="rz-focus rounded-md border border-rz-border p-1.5 text-rz-muted hover:text-rz-maroon disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  {!p.isPrimary && (
                    <button
                      type="button"
                      disabled={anyBusy}
                      onClick={() => makePrimary(p.id)}
                      className="rz-focus rounded-md border border-rz-border px-2 py-1.5 text-xs font-semibold text-rz-maroon hover:bg-rz-maroon/5 disabled:opacity-40"
                    >
                      Make main
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Delete photo"
                    disabled={anyBusy}
                    onClick={() => setConfirmId(p.id)}
                    className="rz-focus ml-auto rounded-md border border-rz-border p-1.5 text-rz-muted hover:text-rz-danger disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
              {err && (
                <p role="alert" className="mt-1.5 text-xs text-rz-danger">
                  {err}
                </p>
              )}
            </li>
          );
        })}

        {uploads.map((u) => (
          <li key={u.key} className="min-w-0">
            <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-rz-border bg-rz-ivory p-3 text-center">
              {u.status === "uploading" ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-rz-maroon" aria-hidden />
                  <span className="text-xs text-rz-muted" role="status">
                    Uploading…
                  </span>
                </>
              ) : (
                <>
                  <span role="alert" className="text-xs text-rz-danger">
                    {u.error}
                  </span>
                  <button
                    type="button"
                    className="rz-focus rounded text-xs font-semibold text-rz-maroon underline"
                    onClick={() => setUploads((x) => x.filter((i) => i.key !== u.key))}
                  >
                    Dismiss
                  </button>
                </>
              )}
              <span className="max-w-full truncate text-[11px] text-rz-muted">{u.name}</span>
            </div>
          </li>
        ))}

        {room > 0 && (photos.length > 0 || uploads.length > 0) && (
          <li className="min-w-0">
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="rz-focus flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-rz-border text-rz-muted hover:border-rz-maroon/50 hover:text-rz-maroon disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-6 w-6" strokeWidth={1.6} />
              <span className="text-xs font-medium">Add photo</span>
            </button>
          </li>
        )}
      </ul>

      {room <= 0 && <p className="mt-3 text-sm text-rz-muted">You’ve reached the limit of {MAX_PHOTOS} photos. Delete one to add another.</p>}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        aria-label="Choose photos to upload"
        tabIndex={-1}
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  );
}
