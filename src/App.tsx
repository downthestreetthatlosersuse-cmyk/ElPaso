import { useEffect, useRef, useState } from "react";
import { Game } from "./game/Game";
import { useHud, type Hud } from "./game/store";
import { initAudio } from "./game/audio";

/* ------------------------------------------------ pixel hero face */

const FACE_ROWS = [
  "................",
  "....HHHHHHHH....",
  "...HHHHHHHHHH...",
  "...HhHHHHHHhH...",
  "...SSSSSSSSSS...",
  "..SSSSSSSSSSSS..",
  "..GGGGGGGGGGGG..",
  "..GgGGGGGGGGgG..",
  "..sSSSSSSSSSSs..",
  "...SSSsSSsSSS...",
  "...SSSSMMSSSS...",
  "...SSCCCCSSESS..",
  "....sSSSSSSs....",
  "...JJJJJJJJJJ...",
  "..JJJJJJJJJJJJ..",
  "................",
];

const FACE_COLORS: Record<string, string> = {
  H: "#ffd94f",
  h: "#d8a828",
  S: "#e8b48a",
  s: "#c9895a",
  G: "#171722",
  g: "#3ee6ff",
  M: "#7a3a28",
  C: "#b5652f",
  E: "#ff6a2a",
  J: "#3a6a8a",
};

const BLOOD_SPOTS = new Set(["4,4", "5,12", "8,3", "9,11", "12,6", "7,13"]);

function PixelFace({ hurt }: { hurt: boolean }) {
  const rects: React.ReactNode[] = [];
  FACE_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      const bloody = hurt && BLOOD_SPOTS.has(`${y},${x}`);
      rects.push(
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={bloody ? "#c0182c" : FACE_COLORS[ch] ?? "#000"} />
      );
    }
  });
  return (
    <div className={`border-2 border-[#f28b1d] bg-[#241432] p-1 ${hurt ? "animate-pulse" : ""}`}>
      <svg viewBox="0 0 16 16" width={68} height={68} shapeRendering="crispEdges">
        {rects}
      </svg>
    </div>
  );
}

/* ------------------------------------------------ HUD pieces */

function Crosshair({ h }: { h: Hud }) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute left-1/2 top-1/2" style={{ width: 0, height: 0 }}>
        <span className="absolute bg-[#ffd23f]" style={{ left: -1, top: "calc(-9px - var(--spr))", width: 2, height: 7, boxShadow: "0 0 5px #000" }} />
        <span className="absolute bg-[#ffd23f]" style={{ left: -1, top: "calc(2px + var(--spr))", width: 2, height: 7, boxShadow: "0 0 5px #000" }} />
        <span className="absolute bg-[#ffd23f]" style={{ left: "calc(-9px - var(--spr))", top: -1, width: 7, height: 2, boxShadow: "0 0 5px #000" }} />
        <span className="absolute bg-[#ffd23f]" style={{ left: "calc(2px + var(--spr))", top: -1, width: 7, height: 2, boxShadow: "0 0 5px #000" }} />
        <span className="absolute bg-[#ff5a2a]" style={{ left: -1, top: -1, width: 2, height: 2 }} />
        {h.hitId > 0 && (
          <span
            key={h.hitId}
            className="hitmarker absolute"
            style={{ left: -8, top: -8, width: 16, height: 16, border: "2px solid #ffffff", boxShadow: "0 0 8px rgba(255,255,255,0.6)" }}
          />
        )}
        {h.combo >= 2 && (
          <div
            key={h.combo}
            className="combo-pop absolute left-1/2 font-display text-3xl"
            style={{ top: "calc(50% + 34px)", color: h.combo >= 4 ? "#ff5a2a" : "#ff9a2a", textShadow: "0 2px 0 #4a180c, 0 0 18px rgba(255,120,30,0.7)" }}
          >
            x{Math.min(h.combo, 6)} COMBO
          </div>
        )}
      </div>
    </div>
  );
}

function InGameHud({ h }: { h: Hud }) {
  const hpColor = h.health > 60 ? "#8dff3a" : h.health > 30 ? "#ffd23f" : "#ff3b30";
  return (
    <>
      {/* top-left: radar + wave */}
      <div className="absolute top-3 left-3 flex flex-col gap-2">
        <div className="hud-panel p-2">
          <div className="font-crt text-[#f28b1d] text-sm leading-none mb-1 tracking-widest">TAC-MAP</div>
          <canvas id="radar-canvas" width={132} height={132} className="block" style={{ imageRendering: "pixelated" }} />
        </div>
        <div className="hud-panel px-3 py-2">
          <div className="font-display text-2xl text-[#ffd23f] leading-none">WAVE {String(h.wave).padStart(2, "0")}</div>
          <div className="font-crt text-lg text-[#8dff3a] leading-tight">HOSTILES: {h.enemiesLeft}</div>
        </div>
      </div>

      {/* top-right: score + feed */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
        <div className="hud-panel px-4 py-2 text-right">
          <div className="font-crt text-[#f28b1d] text-sm tracking-widest leading-none">SCORE</div>
          <div className="font-crt text-5xl text-[#ffd23f] leading-none">{h.score}</div>
          <div className="font-crt text-lg text-[#e8d8ff] leading-tight">
            KILLS {h.kills} <span className="text-[#f28b1d]">·</span> BEST {h.best}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 pr-1">
          {h.feed.map((f) => (
            <div key={f.id} className="feed-in font-crt text-lg leading-none px-2 py-1 bg-[rgba(10,4,16,0.7)] border-l-4" style={{ color: f.color, borderColor: f.color }}>
              {f.text}
            </div>
          ))}
        </div>
      </div>

      {/* boss bar */}
      {h.bossHp > 0 && (
        <div className="absolute inset-x-0 top-14 flex justify-center pointer-events-none">
          <div className="hud-panel px-4 py-2 w-[min(560px,80vw)]" style={{ borderColor: "#c05aff" }}>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-xl" style={{ color: "#e08aff", textShadow: "0 2px 0 #3a1050" }}>
                {h.bossName}
              </span>
              <span className="font-crt text-lg text-[#c8b8e8]">{Math.round(h.bossHp * 100)}%</span>
            </div>
            <div className="h-3.5 border-2 border-[#c05aff] bg-black mt-1">
              <div
                className="h-full transition-all duration-150"
                style={{
                  width: `${h.bossHp * 100}%`,
                  background: "linear-gradient(90deg, #7b2fbe, #c05aff)",
                  boxShadow: "0 0 12px rgba(192,90,255,0.8)",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* banner */}
      {h.bannerId > 0 && (
        <div className="absolute inset-x-0 top-[22%] flex justify-center pointer-events-none">
          <div key={h.bannerId} className="banner-anim text-center" style={{ opacity: 0 }}>
            <div className="font-display text-6xl md:text-7xl title-chrome leading-none">{h.bannerText}</div>
            {h.bannerSub && <div className="font-crt text-2xl md:text-3xl text-[#8dff3a] tracking-[0.25em] mt-2">{h.bannerSub}</div>}
          </div>
        </div>
      )}

      <Crosshair h={h} />

      {/* bottom bar */}
      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 pointer-events-none">
        <div className="hud-panel flex items-center gap-3 px-3 py-2">
          <PixelFace hurt={h.health <= 45} />
          <div>
            <div className="font-crt text-[#f28b1d] text-sm tracking-widest leading-none">CONDITION</div>
            <div className="w-44 h-5 border-2 border-[#f28b1d] bg-black mt-1">
              <div className="h-full transition-all duration-200" style={{ width: `${h.health}%`, backgroundColor: hpColor }} />
            </div>
            <div className="font-crt text-3xl leading-none mt-1" style={{ color: hpColor }}>
              {h.health}<span className="text-lg text-[#e8d8ff]"> / 100</span>
            </div>
          </div>
        </div>

        <div className="hidden md:block font-crt text-lg text-[rgba(242,170,90,0.55)] leading-snug text-center">
          HOLD THE PLAZA · R RELOAD · 1-4 / WHEEL WEAPONS · SHIFT SPRINT
          <br />
          <span className="text-[rgba(141,255,58,0.6)]">EL PASO COUNTY · SECTOR 7 · 480i NTSC</span>
        </div>

        <div className="hud-panel px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-1.5">
            {["SMG", "MAG", "SHT", "RKTL"].map((label, i) => (
              <span
                key={label}
                className={`font-crt text-base px-1.5 border ${
                  h.weaponSlot === i
                    ? "border-[#8dff3a] text-[#8dff3a] bg-[rgba(141,255,58,0.12)]"
                    : "border-[#5a3a78] text-[#8a78a8]"
                }`}
                title={`Slot ${i + 1}: ${label}`}
              >
                {i + 1} {label}
              </span>
            ))}
          </div>
          <div className="font-display text-sm text-[#8dff3a] mt-1">{h.weapon}</div>
          <div className="leading-none mt-1">
            <span className="font-crt text-7xl" style={{ color: h.mag === 0 ? "#ff3b30" : "#ffd23f" }}>
              {h.mag}
            </span>
            <span className="font-crt text-3xl text-[#f28b1d]"> / {h.reserve}</span>
          </div>
          {h.reloading ? (
            <div className="blinker font-crt text-xl text-[#ff5a5a] leading-none mt-1">RELOADING…</div>
          ) : h.mag === 0 && h.reserve === 0 ? (
            <div className="blinker font-crt text-xl text-[#ff5a5a] leading-none mt-1">OUT OF AMMO — FIND A CACHE</div>
          ) : h.mag === 0 ? (
            <div className="blinker font-crt text-xl text-[#ff5a5a] leading-none mt-1">PRESS R</div>
          ) : (
            <div className="font-crt text-lg text-[#8a78a8] leading-none mt-1">R = RELOAD</div>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------ screens */

function ControlsPanel() {
  const rows: [string, string][] = [
    ["MOUSE", "AIM · HOLD LMB TO FIRE"],
    ["W A S D", "MOVE"],
    ["SHIFT", "SPRINT"],
    ["SPACE", "JUMP"],
    ["R", "RELOAD"],
    ["1-4 / WHEEL", "SWAP WEAPON"],
    ["ESC", "PAUSE"],
  ];
  return (
    <div className="hud-panel p-4 max-w-sm">
      <div className="font-display text-sm text-[#f28b1d] mb-2 tracking-wider">CONTROLS</div>
      <div className="flex flex-col gap-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3">
            <span className="keycap">{k}</span>
            <span className="font-crt text-lg text-[#e8d8ff] leading-none">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MenuScreen({ h, onStart }: { h: Hud; onStart: () => void }) {
  return (
    <div
      className="absolute inset-0 z-40 overflow-hidden"
      style={{ background: "linear-gradient(180deg, rgba(14,4,20,0.78), rgba(14,4,20,0.42) 45%, rgba(14,4,20,0.85))" }}
    >
      <div className="absolute inset-0 menu-scan opacity-40 pointer-events-none" />
      <div className="relative h-full max-w-6xl mx-auto flex flex-col justify-between px-6 py-6 md:px-12 md:py-10">
        <div className="flex items-center justify-between">
          <div className="font-crt text-lg text-[#f28b1d] tracking-[0.3em]">
            <span className="inline-block w-2 h-2 bg-[#ff3b30] mr-2 neon-flicker" style={{ verticalAlign: "middle" }} />
            CH-3 BORDER FEED · LIVE
          </div>
          <div className="font-crt text-xl text-[#ffd23f]">PERSONAL BEST: {h.best}</div>
        </div>

        <div className="mt-4">
          <div className="font-crt text-2xl text-[#8dff3a] tracking-[0.35em]">DUKE-CLASS DEFENSE PROTOCOL</div>
          <h1 className="font-display title-chrome leading-[0.95] text-6xl md:text-8xl mt-1">EL PASO</h1>
          <h1 className="font-display title-blood leading-[0.95] text-5xl md:text-7xl -skew-x-6 ml-1">MELTDOWN</h1>
          <p className="font-crt text-2xl md:text-3xl text-[#ffd9a8] mt-4 max-w-2xl leading-snug">
            THE ALIEN HORDE CROSSED THE WALL AT SUNSET. THE PLAZA IS THE LAST LINE.
            <span className="text-[#8dff3a]"> SEND THEM BACK IN PIECES.</span>
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-end justify-between gap-6">
          <ControlsPanel />
          <div className="flex flex-col items-start md:items-end gap-3">
            <button className="btn-chunk text-2xl md:text-3xl px-10 py-4 flex items-center gap-3" onClick={onStart}>
              <svg width="22" height="22" viewBox="0 0 22 22">
                <path d="M4 2 L20 11 L4 20 Z" fill="#2a1004" />
              </svg>
              START MISSION
            </button>
            <div className="font-crt text-lg text-[#c8b8e8]">MOUSE LOCKS ON START · ESC PAUSES · SURVIVE THE WAVES</div>
            <div className="flex gap-2 mt-1">
              {[
                ["RATTLER SMG", "#8dff3a"],
                ["JUDGE MAGNUM", "#ffd23f"],
                ["PUMPER-8", "#ff9a2a"],
                ["BOOMSTICK", "#ff5a2a"],
              ].map(([name, col]) => (
                <span key={name} className="font-crt text-base px-2 py-0.5 border" style={{ color: col, borderColor: col, background: "rgba(10,4,16,0.6)" }}>
                  {name}
                </span>
              ))}
            </div>
            <div className="font-crt text-xl text-[#8dff3a] neon-flicker">FIELD TIP: EL JEFE SHOWS UP EVERY 5TH WAVE. THE BOOMSTICK INTRODUCES HIMSELF.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PauseScreen({ onResume, onMenu }: { onResume: () => void; onMenu: () => void }) {
  return (
    <div className="absolute inset-0 z-40 bg-[rgba(10,4,16,0.78)] flex items-center justify-center">
      <div className="hud-panel p-8 max-w-md w-full mx-4">
        <div className="font-display text-5xl title-chrome">PAUSED</div>
        <div className="font-crt text-xl text-[#ffd9a8] mt-2">THE HORDE WAITS FOR NO ONE, TEX.</div>
        <div className="flex flex-col gap-3 mt-6">
          <button className="btn-chunk text-xl px-6 py-3" onClick={onResume}>
            RESUME FIGHTING
          </button>
          <button
            className="font-display text-sm px-6 py-3 border-2 border-[#f28b1d] text-[#f28b1d] hover:bg-[rgba(242,139,29,0.15)] cursor-pointer"
            onClick={onMenu}
          >
            ABORT TO MENU
          </button>
        </div>
        <div className="font-crt text-lg text-[#8a78a8] mt-5">
          R RELOAD · SHIFT SPRINT · 1/2 WEAPONS · WHEEL SWAP
        </div>
      </div>
    </div>
  );
}

const DEATH_QUOTES = [
  "THAT'S ONE UGLY WAY TO GO.",
  "EL PASO WILL REMEMBER YOU. PROBABLY.",
  "THE HORDE WANTS A WORD: OW.",
  "NOT IN MY CITY. NOT LIKE THIS.",
  "GRAVEYARD'S FULL — THEY'LL MAKE ROOM.",
];

function GameOverScreen({ h, onRestart, onMenu }: { h: Hud; onRestart: () => void; onMenu: () => void }) {
  const [quote, setQuote] = useState(DEATH_QUOTES[0]);
  useEffect(() => {
    setQuote(DEATH_QUOTES[Math.floor(Math.random() * DEATH_QUOTES.length)]);
  }, []);
  const newBest = h.score > 0 && h.score >= h.best;
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center"
      style={{ background: "radial-gradient(ellipse at center, rgba(60,4,10,0.72), rgba(14,2,10,0.9))" }}
    >
      <div className="max-w-xl w-full mx-4 text-center">
        <div className="font-crt text-2xl text-[#ff9a8a] tracking-[0.3em]">MISSION FAILED · WAVE {h.wave}</div>
        <div className="font-display text-6xl md:text-7xl title-blood mt-1">YOU ATE DIRT</div>
        <div className="font-crt text-2xl text-[#ffd9a8] mt-2">{quote}</div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-7">
          {[
            ["SCORE", String(h.score)],
            ["KILLS", String(h.kills)],
            ["WAVES", String(Math.max(0, h.wave - 1))],
            ["BEST", String(h.best)],
          ].map(([k, v]) => (
            <div key={k} className="hud-panel px-2 py-3">
              <div className="font-crt text-sm text-[#f28b1d] tracking-widest">{k}</div>
              <div className="font-crt text-4xl text-[#ffd23f] leading-none mt-1">{v}</div>
            </div>
          ))}
        </div>
        {newBest && <div className="blinker font-display text-xl text-[#8dff3a] mt-3">NEW PERSONAL BEST</div>}

        <div className="flex items-center justify-center gap-4 mt-7">
          <button className="btn-chunk text-xl px-8 py-4" onClick={onRestart}>
            RUN IT BACK
          </button>
          <button
            className="font-display text-sm px-6 py-3 border-2 border-[#f28b1d] text-[#f28b1d] hover:bg-[rgba(242,139,29,0.15)] cursor-pointer"
            onClick={onMenu}
          >
            MENU
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------ app */

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const h = useHud();

  useEffect(() => {
    if (!mountRef.current) return;
    const g = new Game(mountRef.current);
    gameRef.current = g;
    return () => {
      g.dispose();
      gameRef.current = null;
    };
  }, []);

  const start = () => {
    initAudio();
    gameRef.current?.startGame();
  };
  const resume = () => {
    initAudio();
    gameRef.current?.resume();
  };
  const toMenu = () => gameRef.current?.toMenu();

  const hudVisible = h.state === "playing" || h.state === "paused";

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden select-none">
      {/* 3D canvas mount */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* HUD layer (always mounted so radar canvas exists) */}
      <div className={`absolute inset-0 z-30 pointer-events-none ${hudVisible ? "" : "invisible"}`}>
        <InGameHud h={h} />
      </div>

      {/* damage + low hp + nuke */}
      {h.dmgId > 0 && h.state === "playing" && <div key={h.dmgId} className="absolute inset-0 dmg-flash pointer-events-none z-30" />}
      {h.state === "playing" && h.health <= 30 && h.health > 0 && <div className="absolute inset-0 lowhp pointer-events-none z-30" />}
      {h.nukeId > 0 && h.state === "playing" && <div key={`n${h.nukeId}`} className="absolute inset-0 nuke-flash pointer-events-none z-30" />}
      {h.boomId > 0 && h.state === "playing" && <div key={`b${h.boomId}`} className="absolute inset-0 boom-flash pointer-events-none z-20" />}

      {/* CRT layers — scanlines/vignette are now in the post shader */}
      <div className="pointer-events-none absolute inset-0 z-[45] overflow-hidden">
        <div className="crt-roll" />
      </div>

      {/* screens */}
      {h.state === "menu" && <MenuScreen h={h} onStart={start} />}
      {h.state === "paused" && <PauseScreen onResume={resume} onMenu={toMenu} />}
      {h.state === "gameover" && <GameOverScreen h={h} onRestart={start} onMenu={toMenu} />}
    </div>
  );
}
