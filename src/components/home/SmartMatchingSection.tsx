import { Container, Section, SectionHeading } from "@/components/ui/Container";
import { CompatibilityBreakdown, MatchScore } from "@/components/profile/MatchScore";

/** Illustrative values only — shown to explain how a compatibility score reads, never a real member's score. */
const EXAMPLE_BREAKDOWN: Record<string, number> = {
  age: 100,
  religion: 100,
  education: 90,
  profession: 85,
  location: 70,
  income: 60,
};

export function SmartMatchingSection() {
  return (
    <Section className="bg-rz-peach/40">
      <Container>
        <SectionHeading
          eyebrow="Smart Matching"
          title="Recommendations built on real compatibility"
          description="Your stated partner preferences always come first — behavioural signals only ever refine the ranking, never override what you've told us."
        />

        <div className="mx-auto grid max-w-3xl items-center gap-10 rounded-xl border border-rz-border bg-white p-6 shadow-card-sm md:grid-cols-[auto_1fr] md:p-10">
          <div className="flex flex-col items-center gap-3 md:border-r md:border-rz-border md:pr-10">
            <MatchScore value={92} size={128} />
            <p className="text-center font-serif text-lg font-semibold text-rz-navy">Strong Match</p>
            <p className="max-w-[160px] text-center text-xs text-rz-muted">Based on your partner preferences and profile details</p>
          </div>
          <CompatibilityBreakdown scores={EXAMPLE_BREAKDOWN} />
        </div>
        <p className="mt-4 text-center text-xs text-rz-muted">
          Example for illustration only. Your own matches show a score and a breakdown once you set your partner preferences.
        </p>
      </Container>
    </Section>
  );
}
