import { Hero } from "@/components/home/Hero";
import { QuickBrowse } from "@/components/home/QuickBrowse";
import { TrustStrip } from "@/components/home/TrustStrip";
import { HowItWorks } from "@/components/home/HowItWorks";
import { Experience } from "@/components/home/Experience";
import { SmartMatchingSection } from "@/components/home/SmartMatchingSection";
import { FeaturedProfiles } from "@/components/home/FeaturedProfiles";
import { NRIConnections } from "@/components/home/NRIConnections";
import { Testimonials } from "@/components/home/Testimonials";
import { MembershipPreview } from "@/components/home/MembershipPreview";
import { SafetyTrust } from "@/components/home/SafetyTrust";
import { FAQPreview } from "@/components/home/FAQPreview";
import { ExploreProfiles } from "@/components/home/ExploreProfiles";
import { AppPromotion } from "@/components/home/AppPromotion";
import { FinalCTA } from "@/components/home/FinalCTA";

export default function HomePage() {
  return (
    <>
      <Hero />
      <QuickBrowse />
      <TrustStrip />
      <HowItWorks />
      <Experience />
      <SmartMatchingSection />
      <FeaturedProfiles />
      <NRIConnections />
      <Testimonials />
      <MembershipPreview />
      <SafetyTrust />
      <FAQPreview />
      <ExploreProfiles />
      <AppPromotion />
      <FinalCTA />
    </>
  );
}
