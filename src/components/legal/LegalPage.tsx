import { Container, Section } from "@/components/ui/Container";
import { ReactNode } from "react";

export interface LegalSection {
  id: string;
  title: string;
  content: ReactNode;
}

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <Section>
      <Container className="grid gap-12 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-rz-muted">On this page</p>
            <nav className="space-y-2 text-sm">
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="rz-focus block text-rz-muted hover:text-rz-maroon">
                  {s.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="max-w-2xl">
          <h1 className="mb-2 font-serif text-3xl font-bold text-rz-navy md:text-4xl">{title}</h1>
          <p className="mb-8 text-sm text-rz-muted">Last updated: {updated}</p>
          <p className="mb-10 text-[15.5px] leading-relaxed text-rz-text">{intro}</p>

          <div className="space-y-10">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-28">
                <h2 className="mb-3 font-serif text-xl font-semibold text-rz-navy">{s.title}</h2>
                <div className="space-y-3 text-[14.5px] leading-relaxed text-rz-text [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
                  {s.content}
                </div>
              </section>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
