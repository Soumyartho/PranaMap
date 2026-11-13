import { useSmoothScroll } from "../../controllers/landing/useSmoothScroll";
import { useReveal } from "../../controllers/landing/useReveal";
import { ScrollProgressBar } from "./sections/ScrollProgressBar";
import { Nav } from "./sections/Nav";
import { HeroPortal } from "./sections/HeroPortal";
import { ScrubStatement } from "./sections/ScrubStatement";
import { LoopSection } from "./sections/LoopSection";
import { StatsSection } from "./sections/StatsSection";
import { FeatureWall } from "./sections/FeatureWall";
import { AudienceSection } from "./sections/AudienceSection";
import { ClosingPortal } from "./sections/ClosingPortal";
import { Footer } from "./sections/Footer";

export default function LandingPage() {
  useSmoothScroll();
  useReveal();

  return (
    <>
      <ScrollProgressBar />
      <Nav />
      <main id="top">
        <HeroPortal />
        <ScrubStatement />
        <LoopSection />
        <StatsSection />
        <FeatureWall />
        <AudienceSection />
        <ClosingPortal />
      </main>
      <Footer />
    </>
  );
}
