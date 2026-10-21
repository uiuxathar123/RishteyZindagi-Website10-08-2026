"use client";

import { cn } from "@/lib/utils";
import Image from "next/image";
import { Heart } from "lucide-react";
import { useEffect, useState } from "react";

const sizeMap = {
  sm: "h-9 w-9",
  md: "h-12 w-12",
  lg: "h-16 w-16",
  xl: "h-24 w-24",
};

export function Avatar({
  src,
  alt,
  size = "md",
  className,
  fallbackSrc,
}: {
  src?: string;
  alt: string;
  /** Shown instead of the heart when there is no photo (or it fails to load), e.g. the default avatar. */
  fallbackSrc?: string;
  size?: keyof typeof sizeMap;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  // Session-protected photos (served through /bff) must skip the Next image
  // optimiser, which fetches without the session cookie.
  const protectedPhoto = !!src && src.startsWith("/bff/");

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-rz-peach text-rz-navy",
        sizeMap[size],
        className
      )}
    >
      {src && !failed ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="96px"
          unoptimized={protectedPhoto}
          onError={() => setFailed(true)}
          className="object-cover"
        />
      ) : fallbackSrc ? (
        <Image src={fallbackSrc} alt={alt} fill sizes="96px" unoptimized className="object-cover" />
      ) : (
        <Heart className="h-1/2 w-1/2" strokeWidth={1.6} />
      )}
    </div>
  );
}
