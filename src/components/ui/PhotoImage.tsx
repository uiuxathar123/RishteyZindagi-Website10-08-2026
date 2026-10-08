"use client";

import { cn } from "@/lib/utils";
import { Heart } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * A photo that fills its (relatively positioned) parent. Backend photos are
 * cookie-protected, so they bypass the Next image optimiser (`unoptimized`)
 * and fall back to a neutral placeholder if the file can't be loaded
 * (missing, not yet visible, blocked, or session ended) — never a broken-image icon.
 */
export function PhotoImage({
  src,
  alt,
  className,
  sizes = "(min-width: 1024px) 25vw, 50vw",
  priority,
}: {
  src?: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center bg-rz-peach text-rz-maroon/60", className)} role="img" aria-label={alt}>
        <Heart className="h-1/4 w-1/4" strokeWidth={1.4} />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
