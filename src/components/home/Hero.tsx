import styles from "./Hero.module.css";
import { AnniversaryNumeral } from "./AnniversaryNumeral";
import { HeroSearchForm } from "./HeroSearchForm";
import Image from "next/image";
import { ShieldCheck, Sparkles, Globe, Lock } from "lucide-react";

const TRUST_ITEMS = [
  { icon: ShieldCheck, label: "Verified Profiles" },
  { icon: Lock, label: "Safe & Secure" },
  { icon: Globe, label: "India + NRI Connections" },
  { icon: Sparkles, label: "Smart Recommendations" },
];

export function Hero() {
  return (
    <section className={styles.heroRoot} aria-label="RishteyZindagi 10 year anniversary">
      <div className={styles.background} aria-hidden="true" />
      <div className={styles.hills} aria-hidden="true">
        <span className={`${styles.hill} ${styles.hill1}`} />
        <span className={`${styles.hill} ${styles.hill2}`} />
        <span className={`${styles.hill} ${styles.hill3}`} />
      </div>
      <div className={styles.overlay} aria-hidden="true" />

      <div className={styles.floral} aria-hidden="true">
        <div className={styles.branch}>
          <svg viewBox="0 0 220 200" fill="none">
            <path d="M4 4c30 10 55 34 66 62 9 22 10 46 4 70" stroke="#8C7048" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx="34" cy="26" r="9" fill="#F6C9D2" />
            <circle cx="50" cy="14" r="6.5" fill="#F3D9DE" />
            <circle cx="60" cy="56" r="8" fill="#F6C9D2" />
            <circle cx="78" cy="46" r="5.5" fill="#F3D9DE" />
            <circle cx="82" cy="86" r="7" fill="#F1BFC9" />
            <circle cx="18" cy="12" r="4.5" fill="#FBEAE0" />
          </svg>
        </div>
        <div className={styles.petals}>
          {[
            { left: "8%", pd: "17s", delay: "0s", dx: "50px", pw: "16px" },
            { left: "24%", pd: "21s", delay: "2.4s", dx: "-30px", pw: "14px" },
            { left: "47%", pd: "15s", delay: "4.6s", dx: "60px", pw: "20px" },
            { left: "62%", pd: "19s", delay: "1.1s", dx: "-40px", pw: "15px" },
            { left: "77%", pd: "16s", delay: "5.8s", dx: "40px", pw: "19px" },
            { left: "88%", pd: "20s", delay: "3s", dx: "-50px", pw: "14px" },
            { left: "95%", pd: "18s", delay: "0.7s", dx: "30px", pw: "18px" },
          ].map((p, i) => (
            <span
              key={i}
              className={styles.petal}
              style={
                {
                  left: p.left,
                  "--pw": p.pw,
                  "--pd": p.pd,
                  "--pdelay": p.delay,
                  "--pdx": p.dx,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>

      <div className={styles.container}>
        <div className={styles.searchCard}>
          <h1 id="rz-search-heading" className={styles.searchHeading}>Find Your Life Partner</h1>
          <p className={styles.searchDesc}>
            Search profiles by age, religion, location and mother tongue. Log in to see photos and connect.
          </p>

          <HeroSearchForm />
        </div>

        <div className={styles.couple}>
          <div className={styles.coupleGlow} aria-hidden="true" />
          <div className={styles.coupleFrame}>
            {/* Pexels License — free for commercial use. Photo: "Romantic
                Couple in Traditional Attire on Steps" by Dhanush N,
                https://www.pexels.com/photo/37181698/ — swap for an
                approved brand asset with no other changes needed. */}
            <Image
              src="https://images.pexels.com/photos/37181698/pexels-photo-37181698.jpeg?auto=compress&cs=tinysrgb&w=900&h=1200&fit=crop"
              alt="Bride and groom in traditional Indian attire sitting together outdoors, smiling"
              fill
              sizes="(min-width: 768px) 33vw, 62vw"
              priority
              className="object-cover"
              style={{ objectPosition: "50% 18%" }}
            />
          </div>
        </div>

        <div className={styles.anniversary}>
          <div className={styles.celebrating}>Celebrating</div>
          <div className={styles.yearsRange}>2016 – 2026</div>

          <div className={styles.ringWrap}>
            <div className={styles.ringBase} aria-hidden="true" />
            <div className={styles.ringBase2} aria-hidden="true" />
            <div className={styles.ringSweep} aria-hidden="true" />
            <div className={styles.ringInner} aria-hidden="true" />

            <div className={styles.sparkles} aria-hidden="true">
              {[
                ["2%", "46%", "6px", "0s"],
                ["10%", "80%", "8px", "0.4s"],
                ["32%", "95%", "6px", "0.8s"],
                ["60%", "93%", "7px", "1.2s"],
                ["82%", "76%", "6px", "1.6s"],
                ["92%", "48%", "8px", "2s"],
                ["82%", "20%", "6px", "2.4s"],
                ["58%", "4%", "7px", "2.8s"],
                ["30%", "3%", "6px", "3.2s"],
                ["8%", "16%", "8px", "3.6s"],
              ].map(([top, left, sz, delay], i) => (
                <span
                  key={i}
                  className={styles.spark}
                  style={{ top, left, "--sz": sz, "--sdelay": delay } as React.CSSProperties}
                />
              ))}
            </div>

            <div className={styles.ringAccents} aria-hidden="true">
              <span className={styles.ringStar} style={{ top: "-4%", left: "22%", "--rsz": "8px", "--rsdelay": "0.3s" } as React.CSSProperties} />
              <span className={styles.ringStar} style={{ bottom: "2%", right: "-2%", "--rsz": "10px", "--rsdelay": "1.4s" } as React.CSSProperties} />
              <span className={styles.ringFlare} style={{ top: "-8%", right: "14%", "--rfz": "52px", "--rfdelay": "0s" } as React.CSSProperties} />
              <span className={styles.ringFlare} style={{ bottom: "-6%", left: "10%", "--rfz": "40px", "--rfdelay": "2.4s" } as React.CSSProperties} />
              <span className={styles.ringPetal} style={{ top: "8%", right: "-6%", "--rpw": "14px", "--rprot": "24deg", "--rpdelay": "0.8s" } as React.CSSProperties} />
              <span className={styles.ringPetal} style={{ bottom: "16%", left: "-8%", "--rpw": "12px", "--rprot": "-18deg", "--rpdelay": "2s" } as React.CSSProperties} />
            </div>

            <div className={styles.badgeContent}>
              <AnniversaryNumeral className={styles.numeralWrap} />
              <span className={styles.years}>Years</span>
            </div>
          </div>

          <span className="sr-only">
            RishteyZindagi is celebrating 10 years, from 2016 to 2026, of bringing hearts together.
          </span>

          <p className={styles.eyebrow}>Of Bringing Hearts Together</p>
          <p className={styles.lead}>
            A decade of trust and countless beautiful beginnings.
          </p>
          <p className={styles.thanks}>Thank you for being a part of our journey.</p>

          <ul className={styles.trust}>
            {TRUST_ITEMS.map(({ icon: Icon, label }) => (
              <li key={label} className={styles.trustItem}>
                <span className={styles.trustIcon}>
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <span className={styles.trustLabel}>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
