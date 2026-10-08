import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

export function StarRating({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          width={size}
          height={size}
          className={cn(i < Math.round(value) ? "fill-rz-gold text-rz-gold" : "fill-transparent text-rz-border")}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}
