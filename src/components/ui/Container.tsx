import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full max-w-container px-5 md:px-10 xl:px-14", className)}>
      {children}
    </div>
  );
}

export function Section({
  className,
  children,
  id,
}: {
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cn("py-16 md:py-20", className)}>
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={cn("mb-12 max-w-2xl", align === "center" ? "mx-auto text-center" : "text-left")}>
      {eyebrow && (
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-maroon">
          {eyebrow}
        </p>
      )}
      <h2 className="font-serif text-3xl font-bold text-rz-navy md:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-[15.5px] leading-relaxed text-rz-muted">{description}</p>}
    </div>
  );
}
