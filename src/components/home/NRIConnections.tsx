import { Container, Section } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { MapPin } from "lucide-react";

const REGIONS = [
  { country: "India", cities: "Mumbai · Delhi NCR · Bengaluru · Pune · Ahmedabad" },
  { country: "UAE", cities: "Dubai · Abu Dhabi · Sharjah" },
  { country: "Saudi Arabia", cities: "Riyadh · Jeddah · Dammam" },
  { country: "Qatar", cities: "Doha" },
  { country: "Kuwait", cities: "Kuwait City" },
];

export function NRIConnections() {
  return (
    <Section className="bg-rz-navy text-white">
      <Container className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-rz-gold-soft">
            India + NRI Connections
          </p>
          <h2 className="mb-4 font-serif text-3xl font-bold md:text-4xl">
            Bridging families across India and the Gulf
          </h2>
          <p className="mb-8 max-w-md text-[15.5px] leading-relaxed text-white/70">
            Whether your family is rooted in India or settled abroad, RishteyZindagi makes it easy to
            search across borders without losing sight of community, language and tradition.
          </p>
          <ButtonLink href="/search" variant="primary">
            Browse Profiles
          </ButtonLink>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {REGIONS.map((r) => (
            <div key={r.country} className="rounded-lg border border-white/10 bg-white/5 p-5">
              <p className="mb-1 flex items-center gap-1.5 font-serif text-lg font-semibold">
                <MapPin className="h-4 w-4 text-rz-gold-soft" />
                {r.country}
              </p>
              <p className="text-xs text-white/55">{r.cities}</p>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
