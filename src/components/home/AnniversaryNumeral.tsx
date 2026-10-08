/**
 * A "supreme" 3D-style "10" numeral matching the approved reference:
 * bold glossy red numerals with a metallic gold bevel edge, a gold ribbon
 * threading through the "0", and a small couple/heart mark sitting inside
 * the "0"'s hole. Built as one SVG (not live text) so the ribbon can
 * genuinely pass behind the "1" and appear to thread through the "0" —
 * paint order does the work: ribbon → "1" → "0" ring → icon-in-hole.
 */
export function AnniversaryNumeral({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 380 260" className={className} role="img" aria-label="10">
      <defs>
        <linearGradient id="rzNumRed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D8324F" />
          <stop offset="45%" stopColor="#A51E3B" />
          <stop offset="100%" stopColor="#6E1226" />
        </linearGradient>
        <linearGradient id="rzNumGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FCEFC7" />
          <stop offset="35%" stopColor="#D9A94B" />
          <stop offset="70%" stopColor="#B8863A" />
          <stop offset="100%" stopColor="#8C651F" />
        </linearGradient>
        <linearGradient id="rzRibbon" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0%" stopColor="#8C651F" />
          <stop offset="20%" stopColor="#EFCB7E" />
          <stop offset="50%" stopColor="#C99A45" />
          <stop offset="80%" stopColor="#EFCB7E" />
          <stop offset="100%" stopColor="#8C651F" />
        </linearGradient>
        <filter id="rzNumShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#7A1730" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Ribbon shadow (depth) */}
      <path
        d="M -20 156 C 60 136, 140 176, 220 156 C 300 136, 340 156, 400 146
           L 400 182 C 340 192, 300 172, 220 192 C 140 212, 60 172, -20 192 Z"
        fill="#6E4B14"
        opacity="0.45"
        transform="translate(2,6)"
      />
      {/* Ribbon */}
      <path
        d="M -20 150 C 60 130, 140 170, 220 150 C 300 130, 340 150, 400 140
           L 400 176 C 340 186, 300 166, 220 186 C 140 206, 60 166, -20 186 Z"
        fill="url(#rzRibbon)"
        stroke="#7A5A18"
        strokeWidth="1.5"
      />
      {/* Ribbon tail notches */}
      <path d="M -20 150 L -34 168 L -20 186 Z" fill="#8C651F" />
      <path d="M 400 140 L 414 158 L 400 176 Z" fill="#8C651F" />

      {/* Numeral "1" */}
      <g filter="url(#rzNumShadow)">
        <polygon
          points="86,44 22,100 22,132 86,96"
          fill="url(#rzNumRed)"
          stroke="url(#rzNumGold)"
          strokeWidth="9"
          strokeLinejoin="round"
        />
        <rect
          x="58" y="44" width="60" height="180" rx="14"
          fill="url(#rzNumRed)"
          stroke="url(#rzNumGold)"
          strokeWidth="9"
          strokeLinejoin="round"
        />
      </g>

      {/* Numeral "0" — a stroked rounded-rect ring so it has a real hole */}
      <g filter="url(#rzNumShadow)">
        <rect x="168" y="34" width="168" height="196" rx="72" fill="none" stroke="url(#rzNumGold)" strokeWidth="62" />
        <rect x="168" y="34" width="168" height="196" rx="72" fill="none" stroke="url(#rzNumRed)" strokeWidth="46" />
      </g>

      {/* Couple / heart mark inside the "0" (drawn after the ring, on top
          of the ribbon segment that shows through the hole) */}
      <g transform="translate(252,132)">
        <circle cx="-12" cy="-24" r="9" fill="#A51E3B" />
        <circle cx="12" cy="-24" r="9" fill="#C99A45" />
        <path
          d="M0 22 C -22 6, -20 -14, -4 -14 C 2 -14, 0 -6, 0 -2
             C 0 -6, -2 -14, 4 -14 C 20 -14, 22 6, 0 22 Z"
          fill="url(#rzNumGold)"
        />
      </g>
    </svg>
  );
}
