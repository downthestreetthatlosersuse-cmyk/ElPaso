import * as THREE from "three";
import { sfx } from "./audio";
import { hud } from "./store";

/* internal render resolution — chunky 480i-style pixels */
const W = 640;
const H = 360;
const WORLD_R = 92;

type EnemyKind = "grunt" | "brute" | "spitter" | "boss";

interface WeaponDef {
  name: string;
  kind: "hitscan" | "rocket";
  dmg: number;
  rate: number;
  magSize: number;
  spread: number;
  pellets: number;
  reloadTime: number;
  recoil: number;
  kick: number;
  pitchKick: number;
  rollKick: number;
  fovKick: number;
  sound: () => void;
}

const WEAPONS: WeaponDef[] = [
  { name: "RATTLER SMG", kind: "hitscan", dmg: 12, rate: 0.08, magSize: 36, spread: 0.023, pellets: 1, reloadTime: 1.25, recoil: 0.3, kick: 0.013, pitchKick: 1.3, rollKick: 0.5, fovKick: 0.4, sound: () => sfx.smg() },
  { name: "JUDGE MAGNUM", kind: "hitscan", dmg: 70, rate: 0.36, magSize: 6, spread: 0.004, pellets: 1, reloadTime: 1.6, recoil: 1.2, kick: 0.06, pitchKick: 5.0, rollKick: 2.6, fovKick: 1.6, sound: () => sfx.magnum() },
  { name: "PUMPER-8", kind: "hitscan", dmg: 12, rate: 0.68, magSize: 8, spread: 0.058, pellets: 8, reloadTime: 1.9, recoil: 0.95, kick: 0.045, pitchKick: 4.0, rollKick: 2.2, fovKick: 2.0, sound: () => sfx.shotgun() },
  { name: "BOOMSTICK", kind: "rocket", dmg: 150, rate: 0.85, magSize: 1, spread: 0.004, pellets: 1, reloadTime: 2.0, recoil: 1.4, kick: 0.08, pitchKick: 6.2, rollKick: 3.2, fovKick: 2.6, sound: () => sfx.launch() },
];

const ENEMY_DEFS: Record<
  EnemyKind,
  { hp: number; speed: number; dmg: number; score: number; radius: number }
> = {
  grunt: { hp: 26, speed: 4.4, dmg: 8, score: 100, radius: 0.7 },
  spitter: { hp: 44, speed: 3.5, dmg: 12, score: 150, radius: 0.75 },
  brute: { hp: 130, speed: 2.3, dmg: 22, score: 300, radius: 1.2 },
  boss: { hp: 720, speed: 2.5, dmg: 30, score: 1500, radius: 1.9 },
};

const STREAKS: [number, string][] = [
  [2, "DOUBLE KILL"],
  [3, "TRIPLE KILL"],
  [4, "MEGA KILL"],
  [5, "KILLING SPREE"],
  [7, "RAMPAGE"],
  [10, "UNSTOPPABLE"],
];

const WAVE_LINES = [
  "COME GET SOME!",
  "THIS ONE'S FOR EL PASO!",
  "Y'ALL WANT SOME? HUH?!",
  "TIME TO KICK ALIEN AND CHEW BUBBLEGUM.",
  "WELCOME TO THE BORDER, UGLIES.",
  "SUNSET'S COME. SO HAVE YOU. TOO BAD.",
  "MY CITY. MY RULES. MY GUNS.",
];

const KILL_LINES: Record<EnemyKind, string[]> = {
  grunt: ["ALIEN SCUM SPLATTERED", "GREEN GOO EVERYWHERE", "ONE LESS VERDE", "SPLAT. NEXT."],
  spitter: ["SPITTER SPIT HIS LAST", "MOUTH SHUT FOR GOOD", "ACID REFUND ISSUED"],
  brute: ["BRUTE DROPPED", "BIG UGLY, BIG MESS", "THAT ONE'S GONNA STAIN"],
  boss: ["EL JEFE IS DOWN. THE PLAZA IS OURS.", "KING OF THE HORDE? NOT ANYMORE."],
};

interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Enemy {
  kind: EnemyKind;
  group: THREE.Group;
  hp: number;
  speed: number;
  dmg: number;
  scoreV: number;
  radius: number;
  attackCd: number;
  lungeT: number;
  spitCd: number;
  dying: boolean;
  dieT: number;
  bobT: number;
  waypoint: THREE.Vector3 | null;
  parts: { body: THREE.Object3D; armL?: THREE.Object3D; armR?: THREE.Object3D; sac?: THREE.Object3D; cape?: THREE.Object3D };
  hitMeshes: THREE.Mesh[];
  hitPop: number;
  flashT: number;
  baseScale: THREE.Vector3;
  groupBase: number;
  leapT: number;
  leapCd: number;
  leapVX: number;
  leapVZ: number;
  chargeT: number;
  chargeCd: number;
  chargeDX: number;
  chargeDZ: number;
  chargeHit: boolean;
  boss: boolean;
}

interface Decal {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  active: boolean;
}

interface RingFX {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  max: number;
}

interface BeamFX {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  active: boolean;
}

interface Pickup {
  group: THREE.Group;
  kind: "health" | "ammo" | "nuke";
  t: number;
  life: number;
  active: boolean;
}

interface Particle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  grav: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
}

interface FloatText {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  life: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export class Game {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private radar: HTMLCanvasElement | null;

  /* input / state */
  private keys = new Set<string>();
  private mouseDown = false;
  private locked = false;
  state: "menu" | "playing" | "paused" | "gameover" = "menu";

  /* player */
  private pos = new THREE.Vector3(0, 0, 16);
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private onGround = true;
  private health = 100;
  private bobT = 0;
  private shake = 0;
  private weaponIdx = 0;
  private mags = [32, 6, 8, 1];
  private reserves = [160, 36, 32, 9];
  /* killstreak */
  private streakCount = 0;
  private streakT = 0;
  /* rockets */
  private rockets: { g: THREE.Group; vel: THREE.Vector3; active: boolean; life: number; spin: number }[] = [];
  /* feel: fov punch, hitstop, footsteps */
  private fovKick = 0;
  private freeze = 0;
  private stepAcc = 0;
  /* ufo drop event */
  private ufoEvt = -1;
  private ufoEvtSpawned = false;
  private shootCd = 0;
  private reloading = false;
  private reloadT = 0;
  private recoil = 0;
  private flashT = 0;
  private switchT = 0;
  private dryT = 0;
  /* recoil springs */
  private kickP = 0;
  private kickPV = 0;
  private kickR = 0;
  private kickRV = 0;
  private rollSign = 1;
  /* combo */
  private comboCount = 0;
  private comboT = 0;
  /* ambient */
  private weeds: { g: THREE.Group; speed: number; baseZ: number; phase: number }[] = [];
  private ufos: { g: THREE.Group; r: number; a: number; sp: number; h: number; lights: THREE.Mesh[] }[] = [];
  private dust!: THREE.Points;
  private dustBase!: Float32Array;
  private decals: Decal[] = [];
  private rings: RingFX[] = [];
  private beams: BeamFX[] = [];
  /* textures + living props */
  private tex: Record<string, THREE.CanvasTexture> = {};
  private flashMat = new THREE.MeshBasicMaterial({ color: 0xeaffd0 });
  private picadoFlags: THREE.Mesh[] = [];
  private ristras: THREE.Group[] = [];
  private fountainT = 0;

  /* world */
  private colliders: AABB[] = [];
  private envMeshes: THREE.Mesh[] = [];
  private neonMats: THREE.MeshBasicMaterial[] = [];
  private neonTick = 0;

  /* entities */
  private enemies: Enemy[] = [];
  private hitList: THREE.Mesh[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private tracers: Tracer[] = [];
  private texts: FloatText[] = [];
  private particles: Particle[] = [];
  private pMesh!: THREE.InstancedMesh;
  private pIndex = 0;
  private dummy = new THREE.Object3D();

  /* waves */
  private wave = 0;
  private queue: EnemyKind[] = [];
  private spawnT = 0;
  private waveBreak = -1;

  /* viewmodel */
  private gunGroup = new THREE.Group();
  private guns: THREE.Group[] = [];
  private flashMeshes: THREE.Mesh[] = [];
  private gunLight!: THREE.PointLight;
  private muzzleV = new THREE.Vector3();

  /* temps */
  private raycaster = new THREE.Raycaster();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private attractT = 0;

  /* shared geometry / materials */
  private mat: Record<string, THREE.Material> = {};
  private basic: Record<string, THREE.MeshBasicMaterial> = {};
  private geo: Record<string, THREE.BufferGeometry> = {};
  private adobeMats: THREE.MeshLambertMaterial[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.domElement.classList.add("game-canvas");
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(75, W / H, 0.05, 600);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.fog = new THREE.Fog(0xe2703a, 70, 330);

    this.radar = document.getElementById("radar-canvas") as HTMLCanvasElement | null;

    this.buildTextures();
    this.initShared();
    this.buildSky();
    this.buildGround();
    this.buildTown();
    this.buildProps();
    this.buildLights();
    this.buildViewmodels();
    this.initPools();
    this.bindEvents();

    this.spawnAttractCrowd();
    this.hudSync();
    this.loop();
  }

  /* ------------------------------------------------ build */

  private lambert(c: number) {
    return new THREE.MeshLambertMaterial({ color: c });
  }

  private initShared() {
    this.mat.sand = new THREE.MeshLambertMaterial({ map: this.tex.sand });
    this.mat.sandDark = this.lambert(0xb5743f);
    this.mat.asphalt = new THREE.MeshLambertMaterial({ map: this.tex.asphalt });
    this.mat.white = this.lambert(0xe8ddc8);
    this.mat.dark = this.lambert(0x1c130e);
    this.mat.concrete = this.lambert(0x9a9aa4);
    this.mat.rust = this.lambert(0x8a5a4a);
    this.mat.cactus = this.lambert(0x2e7d32);
    this.mat.rock = this.lambert(0x5a4a60);
    this.mat.wood = this.lambert(0x9a6a30);
    this.mat.metal = this.lambert(0x4a4e58);
    this.mat.mountain = this.lambert(0x3b1f4e);
    this.mat.alienGreen = new THREE.MeshLambertMaterial({ map: this.tex.alienGreen });
    this.mat.alienGreenD = this.lambert(0x47961d);
    this.mat.alienBelly = this.lambert(0x9fe85a);
    this.mat.brutePurple = new THREE.MeshLambertMaterial({ map: this.tex.alienPurple });
    this.mat.bruteDark = this.lambert(0x4e1d7a);
    this.mat.spitter = new THREE.MeshLambertMaterial({ map: this.tex.alienOrange });
    this.mat.spitterD = this.lambert(0x9c4a18);
    this.mat.bush = this.lambert(0x3a5a22);
    this.mat.chili = this.lambert(0xc01818);
    this.mat.cape = new THREE.MeshLambertMaterial({ color: 0x3a1050, side: THREE.DoubleSide });
    this.mat.water = new THREE.MeshBasicMaterial({ color: 0x2a8a9a, transparent: true, opacity: 0.78 });
    this.mat.truckRust = this.lambert(0x8a3a2a);
    this.mat.truckBlue = this.lambert(0x3a5a7a);
    this.mat.gunmetal = this.lambert(0x2a2e35);
    this.mat.gundark = this.lambert(0x191c22);
    this.mat.gripwood = this.lambert(0x7a4a20);
    this.mat.brass = this.lambert(0xd8a838);

    this.basic.eye = new THREE.MeshBasicMaterial({ color: 0xc8ff2a });
    this.basic.mouth = new THREE.MeshBasicMaterial({ color: 0x180a20 });
    this.basic.sac = new THREE.MeshBasicMaterial({ color: 0xb4ff3c });
    this.basic.shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
    this.basic.bulb = new THREE.MeshBasicMaterial({ color: 0xffc46a });
    this.basic.stripe = new THREE.MeshBasicMaterial({ color: 0xd8b23a });

    this.adobeMats = [0xfff2dd, 0xf2ddc0, 0xe8d0b0, 0xfff6e6].map(
      (c) => new THREE.MeshLambertMaterial({ map: this.tex.adobe, color: c })
    );
    this.mat.brick = new THREE.MeshLambertMaterial({ map: this.tex.brick });

    this.geo.gruntBody = new THREE.SphereGeometry(0.55, 9, 7);
    this.geo.head = new THREE.SphereGeometry(0.34, 9, 7);
    this.geo.eye = new THREE.SphereGeometry(0.075, 6, 5);
    this.geo.arm = new THREE.ConeGeometry(0.15, 0.55, 6);
    this.geo.bruteBody = new THREE.BoxGeometry(1.5, 1.6, 1.0);
    this.geo.bruteHead = new THREE.BoxGeometry(0.75, 0.6, 0.7);
    this.geo.horn = new THREE.ConeGeometry(0.13, 0.55, 6);
    this.geo.fist = new THREE.BoxGeometry(0.42, 0.42, 0.48);
    this.geo.spitBody = new THREE.ConeGeometry(0.6, 1.4, 8);
    this.geo.sac = new THREE.SphereGeometry(0.3, 8, 6);
    this.geo.shadow = new THREE.CircleGeometry(0.7, 12);
    this.geo.particle = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  }

  /* -------------------------------------------- procedural pixel textures */

  private makePixelTex(size: number, painter: (g: CanvasRenderingContext2D, s: number) => void, rx = 1, ry = 1): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    painter(g, size);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private makeLabel(text: string, wpx: number, hpx: number, bg: string, fg: string, vertical = false): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = wpx;
    c.height = hpx;
    const g = c.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, wpx, hpx);
    g.strokeStyle = fg;
    g.lineWidth = 6;
    g.strokeRect(5, 5, wpx - 10, hpx - 10);
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (vertical) {
      const letters = text.split("");
      const lh = (hpx - 20) / letters.length;
      g.font = `bold ${Math.floor(lh * 0.85)}px monospace`;
      letters.forEach((ch, i) => g.fillText(ch, wpx / 2, 14 + lh * (i + 0.5)));
    } else {
      g.font = `bold ${Math.floor(hpx * 0.5)}px monospace`;
      g.fillText(text, wpx / 2, hpx / 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildTextures() {
    const speckle = (g: CanvasRenderingContext2D, s: number, base: string, cols: string[], n: number) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < n; i++) {
        g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
        g.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), 1, 1);
      }
    };
    this.tex.sand = this.makePixelTex(64, (g, s) => {
      speckle(g, s, "#c4834b", ["#b5743f", "#d09058", "#a86838", "#cf9a66", "#b07040"], 1300);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = "#9c6234";
        g.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), 2, 2);
      }
    }, 42, 42);
    this.tex.asphalt = this.makePixelTex(64, (g, s) => {
      speckle(g, s, "#3a3a46", ["#33333e", "#454553", "#2e2e38", "#40404c"], 1200);
      g.fillStyle = "#26262e";
      for (let i = 0; i < 3; i++) {
        let x = Math.floor(Math.random() * s);
        let y = 0;
        while (y < s) {
          g.fillRect(x, y, 1, 2);
          y += 2;
          x += Math.floor(Math.random() * 3) - 1;
        }
      }
    }, 26, 4);
    this.tex.adobe = this.makePixelTex(64, (g, s) => {
      speckle(g, s, "#d8c4a8", ["#cbb698", "#e2d0b4", "#c2ab8c", "#d0bda0"], 1100);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = "rgba(120,90,60,0.25)";
        g.fillRect(0, Math.floor(Math.random() * s), s, 1);
      }
    });
    this.tex.brick = this.makePixelTex(64, (g, s) => {
      g.fillStyle = "#7c6050";
      g.fillRect(0, 0, s, s);
      const cols = ["#a44a30", "#9c4228", "#b05636", "#983e26"];
      for (let row = 0; row < 8; row++) {
        const off = row % 2 === 0 ? 0 : 4;
        for (let bx = -1; bx < 9; bx++) {
          g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
          g.fillRect(bx * 8 + off + 1, row * 8 + 1, 6, 6);
        }
      }
    }, 3, 2);
    this.tex.plaza = this.makePixelTex(64, (g, s) => {
      g.fillStyle = "#8a6a48";
      g.fillRect(0, 0, s, s);
      for (let cy = 0; cy < 8; cy++) {
        for (let cx = 0; cx < 8; cx++) {
          const v = 168 + Math.floor(Math.random() * 40);
          g.fillStyle = `rgb(${v},${Math.floor(v * 0.72)},${Math.floor(v * 0.48)})`;
          g.fillRect(cx * 8 + 1, cy * 8 + 1, 6, 6);
        }
      }
    }, 5, 5);
    const mottle = (base: string, hi: string, lo: string, dot: string) =>
      this.makePixelTex(32, (g, s) => {
        g.fillStyle = base;
        g.fillRect(0, 0, s, s);
        for (let i = 0; i < 26; i++) {
          g.fillStyle = Math.random() > 0.5 ? hi : lo;
          g.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), 2 + Math.floor(Math.random() * 3), 2 + Math.floor(Math.random() * 3));
        }
        for (let i = 0; i < 40; i++) {
          g.fillStyle = dot;
          g.fillRect(Math.floor(Math.random() * s), Math.floor(Math.random() * s), 1, 1);
        }
      });
    this.tex.alienGreen = mottle("#5fae26", "#79d836", "#47961d", "#2c5e12");
    this.tex.alienPurple = mottle("#6a28a8", "#8b3fd0", "#4e1d7a", "#35124e");
    this.tex.alienOrange = mottle("#c86020", "#e07028", "#9c4a18", "#6e3410");
    this.tex.awning = this.makePixelTex(32, (g, s) => {
      for (let x = 0; x < s; x += 8) {
        g.fillStyle = (x / 8) % 2 === 0 ? "#e8632a" : "#f2e6c8";
        g.fillRect(x, 0, 8, s);
      }
      g.fillStyle = "rgba(60,20,10,0.35)";
      for (let y = 0; y < s; y += 4) g.fillRect(0, y, s, 1);
    });
    this.tex.signElPaso = this.makeLabel("EL PASO", 256, 96, "#1a5a34", "#e8f4e0");
    this.tex.signMotel = this.makeLabel("MOTEL", 96, 256, "#2a1040", "#ff2e88", true);
    this.tex.signTacos = this.makeLabel("TACOS", 160, 64, "#7a2f12", "#ffd23f");
  }

  private buildSky() {
    const geo = new THREE.SphereGeometry(340, 20, 14);
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const horizon = new THREE.Color(0xe2703a);
    const zenith = new THREE.Color(0x1b0b33);
    const c = new THREE.Color();
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i) / 340;
      const t = Math.pow(Math.max(0, y), 0.6);
      c.copy(horizon).lerp(zenith, t);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    this.scene.add(sky);

    /* sun */
    const sc = document.createElement("canvas");
    sc.width = sc.height = 128;
    const g = sc.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, "#fff4cc");
    grad.addColorStop(0.4, "#ffcf70");
    grad.addColorStop(0.75, "rgba(255,140,60,0.55)");
    grad.addColorStop(1, "rgba(255,110,50,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), fog: false, depthWrite: false, transparent: true })
    );
    sun.scale.set(110, 110, 1);
    sun.position.set(-160, 62, -250);
    this.scene.add(sun);

    /* stars */
    const starPos: number[] = [];
    for (let i = 0; i < 160; i++) {
      const a = rand(0, Math.PI * 2);
      const e = rand(0.25, 1.45);
      const r = 320;
      starPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    this.scene.add(
      new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfff2d8, size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75 }))
    );

    /* mountains */
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = rand(175, 225);
      const h = rand(14, 34);
      const m = new THREE.Mesh(new THREE.ConeGeometry(rand(22, 42), h, 5), this.mat.mountain);
      m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
      m.rotation.y = rand(0, 3);
      this.scene.add(m);
    }
  }

  private buildGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(760, 760), this.mat.sand);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    this.envMeshes.push(ground);

    for (let i = 0; i < 26; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(rand(1.5, 5), 10), this.mat.sandDark);
      p.rotation.x = -Math.PI / 2;
      p.position.set(rand(-90, 90), 0.012, rand(-90, 90));
      this.scene.add(p);
    }

    /* roads */
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(260, 9), this.mat.asphalt);
    r1.rotation.x = -Math.PI / 2;
    r1.position.y = 0.02;
    this.scene.add(r1);
    const r2 = new THREE.Mesh(new THREE.PlaneGeometry(9, 230), this.mat.asphalt);
    r2.rotation.x = -Math.PI / 2;
    r2.position.set(0, 0.02, -20);
    this.scene.add(r2);

    /* dashed center lines */
    const dashGeo = new THREE.BoxGeometry(1.5, 0.02, 0.28);
    const dashes = new THREE.InstancedMesh(dashGeo, this.basic.stripe, 110);
    let di = 0;
    for (let x = -120; x <= 120 && di < 80; x += 6.5) {
      this.dummy.position.set(x, 0.035, 0);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      dashes.setMatrixAt(di++, this.dummy.matrix);
    }
    for (let z = -128; z <= 88 && di < 110; z += 6.5) {
      this.dummy.position.set(0, 0.035, z);
      this.dummy.rotation.set(0, Math.PI / 2, 0);
      this.dummy.updateMatrix();
      dashes.setMatrixAt(di++, this.dummy.matrix);
    }
    dashes.count = di;
    this.scene.add(dashes);

    /* plaza */
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(11, 18), new THREE.MeshLambertMaterial({ map: this.tex.plaza }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(14, 0.018, -18);
    this.scene.add(plaza);
  }

  private addCollider(cx: number, cz: number, hw: number, hd: number) {
    this.colliders.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd });
  }

  private buildTown() {
    const B: [number, number, number, number, number, number][] = [
      [-26, -30, 12, 10, 7, 0], [-12, -33, 9, 8, 5.5, 1], [12, -30, 11, 10, 6.5, 2], [27, -33, 10, 9, 8, 3],
      [-31, -8, 10, 9, 6, 2], [31, -8, 10, 9, 5, 0],
      [-30, 13, 11, 10, 7, 1], [-14, 15, 9, 9, 5, 3], [14, 14, 10, 9, 6, 0], [30, 13, 10, 10, 7.5, 2],
      [-49, -31, 9, 9, 5, 3], [49, -30, 9, 9, 6, 1], [-49, 13, 9, 8, 6, 0], [49, 15, 9, 9, 5, 2],
      [-62, -6, 8, 8, 4.5, 1], [62, -6, 8, 8, 5.5, 3],
    ];
    const neonColors = [0xff2e88, 0x2ee6ff, 0xffe14d];
    B.forEach(([x, z, w, d, h, ci], bi) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bi % 7 === 3 ? this.mat.brick : this.adobeMats[ci]);
      body.position.y = h / 2;
      g.add(body);
      this.envMeshes.push(body);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.35, d + 0.5), this.adobeMats[(ci + 1) % 4]);
      lip.position.y = h + 0.1;
      g.add(lip);
      /* door + windows on the road-facing side */
      const face = z < 0 ? 1 : -1;
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.12), this.mat.dark);
      door.position.set(0, 1.15, face * (d / 2 + 0.02));
      g.add(door);
      for (const wx of [-w / 4, w / 4]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.1), this.mat.dark);
        win.position.set(wx, h * 0.62, face * (d / 2 + 0.02));
        g.add(win);
      }
      if (bi % 5 === 1) {
        const nm = new THREE.MeshBasicMaterial({ color: neonColors[bi % 3] });
        const neon = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1, 0.14), nm);
        neon.position.set(0, h * 0.82, face * (d / 2 + 0.05));
        g.add(neon);
        this.neonMats.push(nm);
      }
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.addCollider(x, z, w / 2 + 0.4, d / 2 + 0.4);
    });

    /* mission church */
    const church = new THREE.Group();
    const nave = new THREE.Mesh(new THREE.BoxGeometry(13, 8, 17), this.mat.white);
    nave.position.set(0, 4, -8);
    church.add(nave);
    this.envMeshes.push(nave);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(5.4, 13, 5.4), this.mat.white);
    tower.position.set(0, 6.5, 1.5);
    church.add(tower);
    this.envMeshes.push(tower);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.7, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mat.white);
    dome.position.set(0, 13, 1.5);
    dome.scale.y = 1.25;
    church.add(dome);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.6, 0.22), this.mat.brass);
    crossV.position.set(0, 17.2, 1.5);
    church.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.22), this.mat.brass);
    crossH.position.set(0, 17.4, 1.5);
    church.add(crossH);
    const cdoor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.4, 0.14), this.mat.dark);
    cdoor.position.set(0, 1.7, 4.25);
    church.add(cdoor);
    const roseWin = new THREE.Mesh(new THREE.CircleGeometry(0.8, 10), this.basic.bulb);
    roseWin.position.set(0, 9.5, 4.26);
    church.add(roseWin);
    church.position.set(0, 0, -47);
    this.scene.add(church);
    this.addCollider(0, -55, 7, 8.8);
    this.addCollider(0, -45.5, 3.1, 3.1);

    /* border wall — north edge */
    for (let x = -84; x <= 84; x += 15) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(14.6, 4.6, 1.2), this.mat.concrete);
      seg.position.set(x, 2.3, -88);
      this.scene.add(seg);
      this.envMeshes.push(seg);
      this.addCollider(x, -88, 7.3, 0.9);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(14.6, 0.35, 1.6), this.mat.metal);
      cap.position.set(x, 4.75, -88);
      this.scene.add(cap);
    }

    /* water tower */
    const wt = new THREE.Group();
    for (const [lx, lz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, 7, 0.45), this.mat.metal);
      leg.position.set(lx, 3.5, lz);
      wt.add(leg);
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4, 10), this.mat.rust);
    tank.position.y = 8.5;
    wt.add(tank);
    this.envMeshes.push(tank);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.4, 10), this.mat.metal);
    roof.position.y = 11.2;
    wt.add(roof);
    wt.position.set(58, 0, -58);
    this.scene.add(wt);
    this.addCollider(58, -58, 2.4, 2.4);

    /* cacti */
    const cactusSpots: [number, number][] = [];
    let guard = 0;
    while (cactusSpots.length < 26 && guard++ < 400) {
      const x = rand(-88, 88);
      const z = rand(-82, 88);
      if (Math.abs(z) < 7 || Math.abs(x) < 7) continue;
      if (this.colliders.some((c) => x > c.minX - 2 && x < c.maxX + 2 && z > c.minZ - 2 && z < c.maxZ + 2)) continue;
      cactusSpots.push([x, z]);
    }
    for (const [x, z] of cactusSpots) {
      const c = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, rand(1.6, 2.6), 7), this.mat.cactus);
      const th = (trunk.geometry as THREE.CylinderGeometry).parameters.height;
      trunk.position.y = th / 2;
      c.add(trunk);
      if (Math.random() > 0.35) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.9, 6), this.mat.cactus);
        arm.position.set(0.5, th * 0.55, 0);
        arm.rotation.z = -Math.PI / 3;
        c.add(arm);
      }
      c.position.set(x, 0, z);
      this.scene.add(c);
    }

    /* rocks */
    for (let i = 0; i < 14; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.5, 1.5), 0), this.mat.rock);
      r.position.set(rand(-85, 85), 0.3, rand(-80, 85));
      r.rotation.set(rand(0, 3), rand(0, 3), 0);
      if (Math.abs(r.position.z) < 6 || Math.abs(r.position.x) < 6) r.position.z += 10;
      this.scene.add(r);
    }

    /* crates + barrels for cover */
    const crates: [number, number][] = [[-6, -26], [7, -27], [-8, -34], [9, -12], [-18, -20], [20, -22], [-5, 8], [16, 6]];
    for (const [x, z] of crates) {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), this.mat.wood);
      cr.position.set(x, 0.65, z);
      cr.rotation.y = rand(0, 1);
      this.scene.add(cr);
      this.envMeshes.push(cr);
      this.addCollider(x, z, 0.75, 0.75);
    }
    const barrels: [number, number][] = [[-3, -20], [4, -19], [-12, -12], [12, -18], [24, -8]];
    for (const [x, z] of barrels) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.15, 10), this.lambert(0x5a6a3a));
      b.position.set(x, 0.58, z);
      this.scene.add(b);
      this.envMeshes.push(b);
      this.addCollider(x, z, 0.62, 0.62);
    }

    /* street lamps */
    const lamps: [number, number][] = [[-20, -5.5], [20, -5.5], [-40, 5.5], [40, 5.5], [-5.5, -24], [5.5, -40]];
    for (const [x, z] of lamps) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 6), this.mat.gundark);
      pole.position.set(x, 2.2, z);
      this.scene.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), this.basic.bulb);
      bulb.position.set(x, 4.4, z);
      this.scene.add(bulb);
    }
  }

  private buildProps() {
    /* papel picado banners strung across the plaza and road */
    const flagColors = [0xff6a2a, 0x2ec4b6, 0xffd23f, 0xe8384f, 0x8dff3a];
    const picado = (x1: number, z1: number, x2: number, z2: number, h: number) => {
      const pts: THREE.Vector3[] = [];
      const N = 14;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push(new THREE.Vector3(x1 + (x2 - x1) * t, h - Math.sin(t * Math.PI) * 1.3, z1 + (z2 - z1) * t));
      }
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      this.scene.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x241208 })));
      for (let i = 1; i < N; i++) {
        const fm = new THREE.MeshBasicMaterial({ color: flagColors[i % flagColors.length], side: THREE.DoubleSide });
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.7), fm);
        flag.position.copy(pts[i]).add(this.v1.set(0, -0.38, 0));
        flag.rotation.y = rand(-0.5, 0.5);
        flag.userData.i = this.picadoFlags.length;
        this.picadoFlags.push(flag);
        this.scene.add(flag);
      }
    };
    picado(-11, -23.5, 11, -23.5, 5.6);
    picado(-9, -36.5, 9, -36.5, 5.4);
    picado(-7, 4.8, 7, 4.8, 5.2);

    /* plaza fountain — the heart of the defense */
    const f = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.8, 14), this.mat.concrete);
    basin.position.y = 0.4;
    f.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.12, 14), this.mat.water);
    water.position.y = 0.78;
    f.add(water);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.5, 1.8, 8), this.mat.concrete);
    col.position.y = 1.4;
    f.add(col);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.45, 0.32, 10), this.mat.concrete);
    bowl.position.y = 2.3;
    f.add(bowl);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 10), this.mat.water);
    top.position.y = 2.42;
    f.add(top);
    f.position.set(0, 0, -30);
    this.scene.add(f);
    this.addCollider(0, -30, 3.4, 3.4);

    /* taco carts at the plaza rim */
    const stall = (x: number, z: number, rot: number) => {
      const s = new THREE.Group();
      const cart = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.2), this.mat.wood);
      cart.position.y = 0.75;
      s.add(cart);
      for (const wx of [-0.95, 0.95]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 10), this.mat.gundark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.35, 0.68);
        s.add(wheel);
      }
      const fruitCols = [0xe8384f, 0xffd23f, 0x6cff5a, 0xff9a2a];
      for (let i = 0; i < 8; i++) {
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), this.lambert(fruitCols[i % 4]));
        fruit.position.set(-0.8 + (i % 4) * 0.28, 1.3, -0.25 + Math.floor(i / 4) * 0.25);
        s.add(fruit);
      }
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.5), this.mat.wood);
      crate.position.set(0.85, 1.38, 0.1);
      s.add(crate);
      for (const px of [-1.15, 1.15]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), this.mat.wood);
        pole.position.set(px, 1.6, -0.5);
        s.add(pole);
      }
      const awn = new THREE.Mesh(
        new THREE.PlaneGeometry(2.9, 1.5),
        new THREE.MeshLambertMaterial({ map: this.tex.awning, side: THREE.DoubleSide })
      );
      awn.position.set(0, 2.5, 0.15);
      awn.rotation.x = -1.05;
      s.add(awn);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.6),
        new THREE.MeshBasicMaterial({ map: this.tex.signTacos, side: THREE.DoubleSide })
      );
      sign.position.set(0, 2.35, 0.95);
      s.add(sign);
      s.position.set(x, 0, z);
      s.rotation.y = rot;
      this.scene.add(s);
      this.addCollider(x, z, 1.5, 0.9);
    };
    stall(-8, -22.5, 0.1);
    stall(8.5, -36.5, Math.PI + 0.15);

    /* parked pickups along the curb */
    const truck = (x: number, z: number, rot: number, body: THREE.Material) => {
      const t = new THREE.Group();
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 1.5), body);
      bed.position.set(0.7, 0.85, 0);
      t.add(bed);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.45), body);
      cab.position.set(-1.15, 1.05, 0);
      t.add(cab);
      const hood = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.45), body);
      hood.position.set(-2.3, 0.78, 0);
      t.add(hood);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 1.3), this.mat.dark);
      glass.position.set(-1.15, 1.32, 0);
      t.add(glass);
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 1.55), this.mat.metal);
      bumper.position.set(-2.86, 0.62, 0);
      t.add(bumper);
      for (const wx of [-1.7, 1.5]) {
        for (const wz of [-0.78, 0.78]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 10), this.mat.gundark);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(wx, 0.38, wz);
          t.add(wheel);
        }
      }
      t.position.set(x, 0, z);
      t.rotation.y = rot;
      this.scene.add(t);
      this.addCollider(x, z, 2.6, 1.1);
    };
    truck(-34, 6.2, 0, this.mat.truckRust);
    truck(44, -6.2, Math.PI, this.mat.truckBlue);

    /* benches facing the fountain */
    const bench = (x: number, z: number, rot: number) => {
      const b = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), this.mat.wood);
      seat.position.y = 0.5;
      b.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 0.1), this.mat.wood);
      back.position.set(0, 0.85, -0.24);
      b.add(back);
      for (const lx of [-0.75, 0.75]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.5), this.mat.gundark);
        leg.position.set(lx, 0.25, 0);
        b.add(leg);
      }
      b.position.set(x, 0, z);
      b.rotation.y = rot;
      this.scene.add(b);
      this.addCollider(x, z, 1.0, 0.45);
    };
    bench(-8.4, -30, Math.PI / 2);
    bench(8.4, -30, -Math.PI / 2);
    bench(0, -21.8, 0);

    /* chili ristras by the doorways */
    const ristra = (x: number, z: number) => {
      const r = new THREE.Group();
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4), this.mat.dark);
      cord.position.y = 2.45;
      r.add(cord);
      for (let i = 0; i < 6; i++) {
        const ch = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), this.mat.chili);
        ch.scale.set(1, 1.5, 1);
        ch.position.set(Math.sin(i * 2.4) * 0.05, 2.7 - i * 0.18, 0);
        r.add(ch);
      }
      r.position.set(x, 0, z);
      this.scene.add(r);
      this.ristras.push(r);
    };
    ristra(-1.6, -42.6);
    ristra(1.6, -42.6);
    ristra(-26.5, -24.6);
    ristra(13.5, -24.7);

    /* highway sign at the wall + vertical motel neon */
    const signGrp = new THREE.Group();
    for (const px of [-2.4, 2.4]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 4.6, 6), this.mat.metal);
      pole.position.set(px, 2.3, 0);
      signGrp.add(pole);
    }
    const boardMat = new THREE.MeshBasicMaterial({ map: this.tex.signElPaso });
    const board = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.3, 0.25), boardMat);
    board.position.y = 4.4;
    signGrp.add(board);
    this.neonMats.push(boardMat);
    signGrp.position.set(-38, 0, -82);
    this.scene.add(signGrp);

    const motelMat = new THREE.MeshBasicMaterial({ map: this.tex.signMotel, side: THREE.DoubleSide });
    const motel = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 3.4), motelMat);
    motel.position.set(37.4, 3.2, -8);
    motel.rotation.y = -Math.PI / 2;
    this.scene.add(motel);
    this.neonMats.push(motelMat);

    /* street furniture */
    const hyd = new THREE.Group();
    const hydBody = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.55, 8), this.lambert(0xc02828));
    hydBody.position.y = 0.3;
    hyd.add(hydBody);
    const hydCap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.lambert(0xc02828));
    hydCap.position.y = 0.62;
    hyd.add(hydCap);
    hyd.position.set(-13.5, 0, -5.2);
    this.scene.add(hyd);
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.95, 10), this.mat.metal);
    bin.position.set(35.5, 0.48, 6.5);
    this.scene.add(bin);
    const mbox = new THREE.Group();
    const mboxBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.4), this.lambert(0x2a4a8a));
    mboxBody.position.y = 1.0;
    mbox.add(mboxBody);
    const mboxPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), this.mat.gundark);
    mboxPole.position.y = 0.5;
    mbox.add(mboxPole);
    mbox.position.set(-35.5, 0, 6.8);
    this.scene.add(mbox);

    /* dry bushes tucked against building corners */
    const bushSpots: [number, number][] = [
      [-19, -23.5], [-25, -13.5], [6.5, -24.2], [19.5, -25], [-37, -14.5], [25, -19.5],
      [-44, 7.5], [36.5, 8], [55, -52], [-55, -52], [-5.5, -13.5], [5.5, 8.5],
    ];
    for (const [x, z] of bushSpots) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.42, 0.6), 0), this.mat.bush);
      bush.scale.set(1.25, 0.62, 1.25);
      bush.position.set(x, 0.28, z);
      bush.rotation.y = rand(0, 3);
      this.scene.add(bush);
    }

    /* rubble against the border wall */
    const wallRubble: [number, number, number][] = [[-70, -84.5, 1.6], [-20, -85.5, 1.1], [30, -84.5, 1.8], [65, -85, 1.2], [2, -86, 0.9]];
    for (const [x, z, s] of wallRubble) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this.mat.rock);
      rock.position.set(x, s * 0.4, z);
      rock.rotation.set(rand(0, 3), rand(0, 3), 0);
      this.scene.add(rock);
    }
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xff9a5c, 0x3a1a4a, 0.9));
    const sun = new THREE.DirectionalLight(0xffb066, 1.2);
    sun.position.set(-60, 45, -80);
    this.scene.add(sun);
    this.gunLight = new THREE.PointLight(0xffa640, 0, 16, 2);
    this.gunLight.position.set(0.35, -0.15, -1.2);
    this.camera.add(this.gunLight);
  }

  private makeFlashTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.35, "#ffd88a");
    grad.addColorStop(0.7, "rgba(255,150,40,0.7)");
    grad.addColorStop(1, "rgba(255,120,30,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  private buildViewmodels() {
    const flashTex = this.makeFlashTexture();
    const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

    /* SMG */
    const smg = new THREE.Group();
    const sBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.44), this.mat.gunmetal);
    smg.add(sBody);
    const sBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.32), this.mat.gundark);
    sBarrel.position.set(0, 0.01, -0.34);
    smg.add(sBarrel);
    const sMag = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.18, 0.09), this.mat.gundark);
    sMag.position.set(0, -0.13, -0.05);
    sMag.rotation.x = 0.15;
    smg.add(sMag);
    const sGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.15, 0.09), this.mat.gripwood);
    sGrip.position.set(0, -0.12, 0.16);
    sGrip.rotation.x = -0.3;
    smg.add(sGrip);
    const sSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.04), this.mat.brass);
    sSight.position.set(0, 0.09, -0.42);
    smg.add(sSight);
    const sWood = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.05, 0.2), this.mat.gripwood);
    sWood.position.set(0, -0.045, -0.18);
    smg.add(sWood);
    const sFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), flashMat);
    sFlash.position.set(0, 0.01, -0.62);
    sFlash.visible = false;
    smg.add(sFlash);
    smg.position.set(0.44, -0.4, -0.78);
    this.flashMeshes.push(sFlash);

    /* Magnum */
    const mag = new THREE.Group();
    const mBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.44), this.mat.gunmetal);
    mBarrel.position.set(0, 0.03, -0.18);
    mag.add(mBarrel);
    const mCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.13, 8), this.mat.brass);
    mCyl.rotation.x = Math.PI / 2;
    mCyl.position.set(0, 0.01, 0.02);
    mag.add(mCyl);
    const mFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.2), this.mat.gundark);
    mFrame.position.set(0, 0.01, 0.05);
    mag.add(mFrame);
    const mGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.17, 0.1), this.mat.gripwood);
    mGrip.position.set(0, -0.1, 0.13);
    mGrip.rotation.x = -0.35;
    mag.add(mGrip);
    const mSight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.045, 0.035), this.mat.brass);
    mSight.position.set(0, 0.08, -0.36);
    mag.add(mSight);
    const mFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), flashMat);
    mFlash.position.set(0, 0.03, -0.52);
    mFlash.visible = false;
    mag.add(mFlash);
    mag.position.set(0.44, -0.42, -0.78);
    this.flashMeshes.push(mFlash);

    /* PUMPER-8 shotgun */
    const shotty = new THREE.Group();
    const shBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.52), this.mat.gundark);
    shBarrel.position.set(0, 0.04, -0.2);
    shotty.add(shBarrel);
    const shTube = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.4), this.mat.gunmetal);
    shTube.position.set(0, -0.035, -0.16);
    shotty.add(shTube);
    const shPump = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.085, 0.18), this.mat.gripwood);
    shPump.position.set(0, -0.03, -0.3);
    shotty.add(shPump);
    const shStock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.13, 0.26), this.mat.gripwood);
    shStock.position.set(0, -0.02, 0.24);
    shStock.rotation.x = 0.12;
    shotty.add(shStock);
    const shRec = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.16), this.mat.gunmetal);
    shRec.position.set(0, 0.03, 0.05);
    shotty.add(shRec);
    const shFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), flashMat);
    shFlash.position.set(0, 0.04, -0.58);
    shFlash.visible = false;
    shotty.add(shFlash);
    shotty.position.set(0.44, -0.4, -0.78);
    this.flashMeshes.push(shFlash);

    /* BOOMSTICK rocket launcher */
    const rpg = new THREE.Group();
    const rTube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.62, 10), this.lambert(0x4a5a3a));
    rTube.rotation.x = Math.PI / 2;
    rTube.position.set(0, 0.02, -0.1);
    rpg.add(rTube);
    const rMouth = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.06, 10), this.mat.gundark);
    rMouth.rotation.x = Math.PI / 2;
    rMouth.position.set(0, 0.02, -0.42);
    rpg.add(rMouth);
    const rGrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.08), this.mat.gripwood);
    rGrip.position.set(0, -0.1, 0.06);
    rGrip.rotation.x = -0.3;
    rpg.add(rGrip);
    const rSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.04), this.mat.brass);
    rSight.position.set(0, 0.12, -0.2);
    rpg.add(rSight);
    const rRocket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8), this.mat.metal);
    rRocket.rotation.x = Math.PI / 2;
    rRocket.position.set(0, 0.02, -0.34);
    rpg.add(rRocket);
    const rFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), flashMat);
    rFlash.position.set(0, 0.02, -0.52);
    rFlash.visible = false;
    rpg.add(rFlash);
    rpg.position.set(0.44, -0.44, -0.72);
    this.flashMeshes.push(rFlash);

    this.guns = [smg, mag, shotty, rpg];
    this.gunGroup.add(smg, mag, shotty, rpg);
    shotty.visible = false;
    rpg.visible = false;
    mag.visible = false;
    this.camera.add(this.gunGroup);
  }

  private initPools() {
    /* particles */
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.pMesh = new THREE.InstancedMesh(this.geo.particle, pMat, 320);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    const black = new THREE.Color(0x000000);
    for (let i = 0; i < 320; i++) {
      this.pMesh.setMatrixAt(i, this.dummy.matrix);
      this.pMesh.setColorAt(i, black);
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        color: new THREE.Color(),
        grav: 9,
      });
    }
    this.scene.add(this.pMesh);

    /* projectiles */
    const pGeo = new THREE.SphereGeometry(0.17, 8, 6);
    const pMatB = new THREE.MeshBasicMaterial({ color: 0x9dff3a });
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(pGeo, pMatB);
      m.visible = false;
      this.scene.add(m);
      this.projectiles.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false });
    }

    /* tracers */
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1), mat);
      m.visible = false;
      this.scene.add(m);
      this.tracers.push({ mesh: m, mat, life: 0 });
    }

    /* floating text */
    for (let i = 0; i < 10; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 96;
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(2.4, 0.9, 1);
      sprite.visible = false;
      this.scene.add(sprite);
      this.texts.push({ sprite, mat, tex, canvas, life: 0 });
    }

    /* impact / splat decals */
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 44; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false });
      const mesh = new THREE.Mesh(decalGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.decals.push({ mesh, mat, life: 0, maxLife: 1, active: false });
    }

    /* shockwave rings */
    const ringGeo = new THREE.RingGeometry(0.72, 1, 26);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x8dff3a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat, t: 1, dur: 1, max: 1 });
    }

    /* spawn beams */
    const beamGeo = new THREE.CylinderGeometry(0.7, 0.7, 7, 10, 1, true);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x8dff3a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      this.beams.push({ mesh, mat, t: 1 });
    }

    /* tumbleweeds */
    const weedGeo = new THREE.IcosahedronGeometry(0.5, 0);
    const weedMat = new THREE.MeshBasicMaterial({ color: 0x9a7440, wireframe: true });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const outer = new THREE.Mesh(weedGeo, weedMat);
      g.add(outer);
      const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), weedMat);
      inner.rotation.set(0.6, 0.4, 0);
      g.add(inner);
      g.position.set(rand(-90, 90), 0.5, rand(-80, 80));
      this.scene.add(g);
      this.weeds.push({ g, speed: rand(2.6, 4.6), baseZ: g.position.z, phase: rand(0, 9) });
    }

    /* alien motherships */
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.6, 1.1, 12), this.lambert(0x2e3340));
      g.add(hull);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(1.7, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x6a4aff, transparent: true, opacity: 0.55 })
      );
      dome.position.y = 0.55;
      g.add(dome);
      const lights: THREE.Mesh[] = [];
      for (let l = 0; l < 6; l++) {
        const lm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4a5a }));
        const a = (l / 6) * Math.PI * 2;
        lm.position.set(Math.cos(a) * 4, -0.35, Math.sin(a) * 4);
        g.add(lm);
        lights.push(lm);
      }
      this.scene.add(g);
      this.ufos.push({ g, r: 52 + i * 20, a: i * 2.4, sp: (i === 0 ? 1 : -1) * rand(0.05, 0.08), h: 25 + i * 7, lights });
    }

    /* drifting dust motes */
    const dustCount = 180;
    const dustPos = new Float32Array(dustCount * 3);
    this.dustBase = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = rand(-48, 48);
      dustPos[i * 3 + 1] = rand(0, 9);
      dustPos[i * 3 + 2] = rand(-48, 48);
      this.dustBase[i] = dustPos[i * 3 + 1];
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ color: 0xffc890, size: 0.11, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.scene.add(this.dust);

    /* rockets */
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 8), this.mat.metal);
      g.add(body);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 8), this.lambert(0xd04020));
      tip.position.y = 0.29;
      g.add(tip);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      glow.position.y = -0.27;
      g.add(glow);
      g.visible = false;
      this.scene.add(g);
      this.rockets.push({ g, vel: new THREE.Vector3(), active: false, life: 0, spin: 0 });
    }
  }

  /* ------------------------------------------------ entities */

  private buildEnemy(kind: EnemyKind, x: number, z: number): Enemy {
    const def = ENEMY_DEFS[kind];
    const g = new THREE.Group();
    const hitMeshes: THREE.Mesh[] = [];
    const parts: Enemy["parts"] = { body: g };
    const baseScale = new THREE.Vector3(1, 1, 1);

    const addShadow = (s: number) => {
      const sh = new THREE.Mesh(this.geo.shadow, this.basic.shadow);
      sh.rotation.x = -Math.PI / 2;
      sh.position.y = 0.03;
      sh.scale.set(s, s, s);
      g.add(sh);
    };

    if (kind === "grunt") {
      const body = new THREE.Mesh(this.geo.gruntBody, this.mat.alienGreen);
      /* grunt body base scale set below */
      body.position.y = 0.95;
      body.scale.set(1, 1.25, 0.9);
      baseScale.set(1, 1.25, 0.9);
      g.add(body);
      hitMeshes.push(body);
      const head = new THREE.Mesh(this.geo.head, this.mat.alienGreenD);
      head.position.y = 1.88;
      g.add(head);
      hitMeshes.push(head);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(this.geo.eye, this.basic.eye);
        eye.position.set(0.15 * s, 1.92, 0.26);
        g.add(eye);
        const arm = new THREE.Mesh(this.geo.arm, this.mat.alienGreenD);
        arm.position.set(0.62 * s, 1.05, 0);
        arm.rotation.z = s * 2.4;
        g.add(arm);
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 4), this.mat.alienBelly);
        claw.position.set(0, -0.34, 0);
        claw.rotation.x = Math.PI;
        arm.add(claw);
        if (s === -1) parts.armL = arm;
        else parts.armR = arm;
      }
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), this.mat.alienBelly);
      belly.position.set(0, 0.82, 0.3);
      belly.scale.set(1, 1.15, 0.55);
      g.add(belly);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), this.mat.alienGreenD);
      fin.position.set(0, 1.4, -0.42);
      fin.rotation.x = 0.55;
      g.add(fin);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.1, 8), this.basic.mouth);
      mouth.position.set(0, 1.72, 0.32);
      g.add(mouth);
      for (const s of [-1, 1]) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), this.mat.alienGreenD);
        spike.position.set(0.44 * s, 1.48, -0.05);
        spike.rotation.z = -s * 0.6;
        g.add(spike);
      }
      parts.body = body;
      addShadow(1);
    } else if (kind === "brute" || kind === "boss") {
      const body = new THREE.Mesh(this.geo.bruteBody, kind === "boss" ? this.lambert(0x9c2fde) : this.mat.brutePurple);
      body.position.y = 1.15;
      g.add(body);
      hitMeshes.push(body);
      const head = new THREE.Mesh(this.geo.bruteHead, this.mat.bruteDark);
      head.position.y = 2.25;
      g.add(head);
      hitMeshes.push(head);
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(this.geo.horn, this.mat.bruteDark);
        horn.position.set(0.3 * s, 2.65, 0);
        horn.rotation.z = -s * 0.5;
        g.add(horn);
        const eye = new THREE.Mesh(this.geo.eye, this.basic.eye);
        eye.position.set(0.18 * s, 2.3, 0.34);
        g.add(eye);
        const fist = new THREE.Mesh(this.geo.fist, this.mat.bruteDark);
        fist.position.set(1.05 * s, 1.1, 0.1);
        g.add(fist);
        const knuckle = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 4), this.mat.brass);
        knuckle.position.set(0, 0, 0.3);
        knuckle.rotation.x = Math.PI / 2;
        fist.add(knuckle);
        const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 6), this.mat.bruteDark);
        pauldron.position.set(0.85 * s, 1.98, 0);
        pauldron.scale.set(1, 0.7, 1);
        g.add(pauldron);
        const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 5), this.mat.brass);
        tusk.position.set(0.24 * s, 2.0, 0.33);
        tusk.rotation.z = -s * 0.25;
        g.add(tusk);
      }
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.26), this.mat.bruteDark);
      plate.position.set(0, 1.3, 0.5);
      g.add(plate);
      for (let i = 0; i < 3; i++) {
        const spine = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 5), this.mat.bruteDark);
        spine.position.set(0, 1.95 - i * 0.55, -0.56);
        spine.rotation.x = -0.5;
        g.add(spine);
      }
      parts.body = body;
      addShadow(1.7);
    } else {
      const body = new THREE.Mesh(this.geo.spitBody, this.mat.spitter);
      body.position.y = 0.75;
      g.add(body);
      hitMeshes.push(body);
      const head = new THREE.Mesh(this.geo.head, this.mat.spitterD);
      head.position.y = 1.72;
      head.scale.set(1.1, 1, 1.1);
      g.add(head);
      hitMeshes.push(head);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.17, 8), this.basic.mouth);
      mouth.position.set(0, 1.68, 0.36);
      g.add(mouth);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(this.geo.eye, this.basic.eye);
        eye.position.set(0.2 * s, 1.9, 0.24);
        g.add(eye);
      }
      const sac = new THREE.Mesh(this.geo.sac, this.basic.sac);
      sac.position.set(0, 1.1, -0.42);
      g.add(sac);
      parts.sac = sac;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 5), this.mat.spitterD);
        leg.position.set(Math.cos(a) * 0.45, 0.28, Math.sin(a) * 0.45);
        leg.rotation.z = -Math.cos(a) * 0.9;
        leg.rotation.x = Math.sin(a) * 0.9;
        g.add(leg);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.7, 6), this.mat.spitter);
      tail.position.set(0, 0.55, -0.6);
      tail.rotation.x = -1.9;
      g.add(tail);
      parts.body = body;
      addShadow(1.1);
    }

    if (kind === "boss") {
      for (const s of [-1, 0, 1]) {
        const horn = new THREE.Mesh(this.geo.horn, this.mat.brass);
        horn.position.set(0.32 * s, 2.72, 0.05);
        horn.rotation.z = -s * 0.45;
        g.add(horn);
      }
      const sac = new THREE.Mesh(this.geo.sac, this.basic.sac);
      sac.position.set(0, 1.2, -0.55);
      g.add(sac);
      parts.sac = sac;
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.5), this.mat.cape);
      cape.position.set(0, 1.35, -0.85);
      cape.rotation.x = 0.18;
      g.add(cape);
      parts.cape = cape;
      const belt = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.3, 1.1), this.mat.brass);
      belt.position.set(0, 0.55, 0);
      g.add(belt);
    }

    const e: Enemy = {
      kind,
      group: g,
      hp: def.hp,
      speed: def.speed,
      dmg: def.dmg,
      scoreV: def.score,
      radius: def.radius,
      attackCd: rand(0.3, 1),
      lungeT: 0,
      spitCd: rand(1, 2.2),
      dying: false,
      dieT: 0,
      bobT: rand(0, 6),
      waypoint: null,
      parts,
      hitMeshes,
      hitPop: 0,
      flashT: 0,
      baseScale,
      groupBase: kind === "boss" ? 1.5 : 1,
      leapT: 0,
      leapCd: rand(2, 4),
      leapVX: 0,
      leapVZ: 0,
      chargeT: 0,
      chargeCd: rand(3, 5),
      chargeDX: 0,
      chargeDZ: 0,
      chargeHit: false,
      boss: kind === "boss",
    };
    for (const m of hitMeshes) m.userData.e = e;
    if (kind === "boss") g.scale.set(1.5, 1.5, 1.5);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.hitList.push(...hitMeshes);
    this.enemies.push(e);
    return e;
  }

  private spawnEnemy(kind: EnemyKind, fx?: number, fz?: number) {
    const a = rand(0, Math.PI * 2);
    const r = rand(38, 52);
    const x = fx !== undefined ? fx : Math.max(-WORLD_R, Math.min(WORLD_R, this.pos.x + Math.cos(a) * r));
    const z = fz !== undefined ? fz : Math.max(-WORLD_R + 4, Math.min(WORLD_R, this.pos.z + Math.sin(a) * r));
    const e = this.buildEnemy(kind, x, z);
    const wmul = 1 + (this.wave - 1) * 0.09;
    e.hp = Math.round(ENEMY_DEFS[kind].hp * wmul);
    e.speed = ENEMY_DEFS[kind].speed * (1 + Math.min(this.wave * 0.03, 0.45));
    /* beam-down portal */
    this.spawnBeam(e.group.position);
    this.spawnRing(e.group.position, 0x8dff3a, 3.2, 0.45);
    this.burst(this.v1.set(x, 1.2, z), 0x8dff3a, 8, 3.5);
    sfx.portal();
  }

  private spawnAttractCrowd() {
    for (let i = 0; i < 5; i++) this.buildEnemy("grunt", rand(-30, 30), rand(-30, 30));
    this.buildEnemy("brute", 18, -20);
    this.buildEnemy("spitter", -20, -16);
    this.buildEnemy("spitter", 12, 22);
  }

  private spawnBoss() {
    const a = rand(0, Math.PI * 2);
    const e = this.buildEnemy("boss", Math.cos(a) * 44, -78 + Math.sin(a) * 6);
    e.hp = Math.round(ENEMY_DEFS.boss.hp * (1 + this.wave * 0.04));
    hud.banner("EL JEFE HAS ARRIVED", "BRING THE BOOMSTICK, TEX.");
    sfx.boss();
    const p = e.group.position;
    this.spawnRing(p, 0xc05aff, 9, 0.7);
    const b = this.spawnBeam(p, 0xc05aff);
    b.mesh.scale.set(2.4, 1, 2.4);
    this.shake += 0.5;
    this.hudSync();
  }

  private updateUfo(dt: number) {
    if (this.ufoEvt < 0) return;
    const first = this.ufoEvt === 0;
    this.ufoEvt += dt;
    const u = this.ufos[0];
    if (first) {
      hud.banner("UFO SIGHTED", "DROP ZONE: LA PLAZA");
      sfx.portal();
      const b = this.spawnBeam(this.v3.set(0, 0, -30), 0xb46aff);
      b.mesh.scale.set(2.6, 1, 2.6);
    }
    this.v1.set(0, 16, -30);
    u.g.position.lerp(this.v1, Math.min(1, dt * 2.4));
    u.g.rotation.y += dt * 2.4;
    for (let i = 0; i < u.lights.length; i++) u.lights[i].visible = true;
    if (this.ufoEvt >= 1.1 && !this.ufoEvtSpawned) {
      this.ufoEvtSpawned = true;
      const spots: [number, number][] = [[-6, -25], [6, -26], [-4, -35], [5, -34]];
      for (const [sx, sz] of spots) this.spawnEnemy("grunt", sx, sz);
      this.spawnEnemy("spitter", 0, -22);
      this.spawnRing(this.v2.set(0, 0, -30), 0xb46aff, 8, 0.6);
    }
    if (this.ufoEvt >= 4.4) {
      this.spawnRing(this.v2.set(u.g.position.x, 0, u.g.position.z), 0xb46aff, 6, 0.5);
      sfx.portal();
      this.ufoEvt = -1;
      this.ufoEvtSpawned = false;
    }
  }

  private removeEnemy(e: Enemy) {
    this.scene.remove(e.group);
    this.hitList = this.hitList.filter((m) => !e.hitMeshes.includes(m));
    this.enemies = this.enemies.filter((x) => x !== e);
  }

  private killEnemy(e: Enemy, byPlayer: boolean) {
    if (e.dying) return;
    e.dying = true;
    e.dieT = 0;
    this.hitList = this.hitList.filter((m) => !e.hitMeshes.includes(m));
    const p = e.group.position;
    this.burst(this.v1.set(p.x, 1.2, p.z), 0x6fdd2f, e.kind === "brute" ? 26 : 14, e.kind === "brute" ? 7 : 5.5);
    this.freeze = Math.max(this.freeze, e.boss ? 0.09 : e.kind === "brute" ? 0.05 : 0.028);
    this.fovKick += e.boss ? 2 : e.kind === "brute" ? 1.2 : 0.5;
    /* goo splat decals */
    const splats = e.kind === "brute" ? 3 : 2;
    for (let i = 0; i < splats; i++) {
      this.spawnDecal(
        this.v2.set(p.x + rand(-0.8, 0.8), 0.02, p.z + rand(-0.8, 0.8)),
        this.v3.set(0, 1, 0),
        i === 0 ? 0x4f9a1e : 0x6fdd2f,
        (e.kind === "brute" ? rand(1.5, 2.3) : rand(0.8, 1.4)),
        rand(9, 13)
      );
    }
    if (e.kind === "brute") {
      sfx.bruteDie();
      sfx.boom();
      this.spawnRing(p, 0xb46aff, 7.5, 0.55);
      this.spawnRing(p, 0x8dff3a, 5, 0.4);
      this.shake += 0.75;
    } else {
      sfx.alienDie();
    }
    if (byPlayer) {
      if (this.comboT > 0) this.comboCount++;
      else this.comboCount = 1;
      this.comboT = 2.6;
      const mult = Math.min(this.comboCount, 6);
      const sc = e.scoreV * mult;
      const score = hud.get().score + sc;
      const kills = hud.get().kills + 1;
      hud.set({ score, kills, combo: this.comboCount });
      this.showText(p.x, 2.2, p.z, `+${sc}`, mult > 1 ? "#ff9a2a" : e.kind === "brute" ? "#ffd23f" : "#8dff3a");
      if (mult >= 2) this.showText(p.x, 3.1, p.z, `COMBO x${mult}`, "#ff9a2a");
      hud.feed(`${pick(KILL_LINES[e.kind])}  +${sc}`, "#8dff3a");
      if (Math.random() < 0.3) this.dropPickup(p.x, p.z);
      /* killstreak */
      if (this.streakT > 0) this.streakCount++;
      else this.streakCount = 1;
      this.streakT = 2.4;
      const found = STREAKS.find(([n]) => n === this.streakCount);
      if (found) {
        hud.banner(found[1], this.streakCount >= 5 ? "THE HORDE FEELS IT" : "");
        sfx.fanfare();
      }
      if (e.boss) {
        hud.banner("EL JEFE IS DOWN", "THE PLAZA STANDS. FOR NOW.");
        sfx.fanfare();
        this.spawnRing(p, 0xffd23f, 12, 0.8);
        this.spawnRing(p, 0xc05aff, 8, 0.6);
        this.burst(this.v1.set(p.x, 2.5, p.z), 0xc05aff, 30, 8);
        this.shake += 0.8;
        this.dropPickup(p.x + 1, p.z, "nuke");
        this.dropPickup(p.x - 1, p.z, "ammo");
      }
    }
    this.hudSync();
  }

  private damageEnemy(e: Enemy, dmg: number, point: THREE.Vector3, isHead: boolean) {
    if (e.dying) return;
    e.hp -= dmg;
    e.hitPop = 0.22;
    const bm = e.parts.body as THREE.Mesh;
    bm.userData.origMat = bm.userData.origMat || bm.material;
    bm.material = this.flashMat;
    e.flashT = 0.07;
    if (isHead) {
      sfx.headshot();
      this.showText(point.x, point.y + 0.45, point.z, "HEADSHOT", "#ffd23f");
      this.burst(point, 0xffc840, 9, 4.5);
    } else {
      sfx.squish();
    }
    hud.hit();
    this.burst(point, 0x79e836, isHead ? 8 : 5, 3.5);
    /* knockback */
    const kb = e.kind === "brute" ? 0.04 : 0.16;
    this.v2.copy(point).sub(this.camera.position);
    this.v2.y = 0;
    if (this.v2.lengthSq() > 0.001) {
      this.v2.normalize().multiplyScalar(kb);
      e.group.position.add(this.v2);
    }
    if (e.hp <= 0) this.killEnemy(e, true);
    this.hudSync();
  }

  private dropPickup(x: number, z: number, force?: "health" | "ammo" | "nuke") {
    const wantHealth = this.health < 75;
    const kind: "health" | "ammo" | "nuke" =
      force ?? (Math.random() < 0.1 ? "nuke" : Math.random() < (wantHealth ? 0.6 : 0.3) ? "health" : "ammo");
    const g = new THREE.Group();
    if (kind === "nuke") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.55), this.lambert(0x303038));
      g.add(box);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.77, 0.2, 0.57), this.lambert(0xd8b23a));
      g.add(band);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), this.basic.eye);
      dot.position.set(0, 0.14, 0.28);
      g.add(dot);
    } else if (kind === "health") {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.7), this.lambert(0xe8e8e8));
      g.add(box);
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.14), this.lambert(0xd02020));
      g.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.46, 0.42), this.lambert(0xd02020));
      g.add(c2);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.45, 0.5), this.lambert(0x6a6a30));
      g.add(box);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.77, 0.14, 0.52), this.lambert(0xd8b23a));
      g.add(band);
    }
    g.position.set(x, 0.45, z);
    this.scene.add(g);
    this.pickups.push({ group: g, kind, t: rand(0, 5), life: 25, active: true });
  }

  /* ------------------------------------------------ fx helpers */

  private burst(pos: THREE.Vector3, color: number, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.pIndex];
      this.pIndex = (this.pIndex + 1) % this.particles.length;
      p.active = true;
      p.pos.copy(pos).add(this.v3.set(rand(-0.2, 0.2), rand(-0.2, 0.2), rand(-0.2, 0.2)));
      p.vel.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(speed * 0.4, speed));
      p.maxLife = p.life = rand(0.35, 0.75);
      p.size = rand(0.7, 1.5);
      p.color.set(color);
      p.grav = 10;
    }
  }

  private casing() {
    const p = this.particles[this.pIndex];
    this.pIndex = (this.pIndex + 1) % this.particles.length;
    this.guns[this.weaponIdx].getWorldPosition(this.v1);
    p.active = true;
    p.pos.copy(this.v1);
    const right = this.v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    p.vel.copy(right).multiplyScalar(rand(1.5, 2.6)).add(this.v3.set(0, rand(1.6, 2.4), rand(-0.5, 0.5)));
    p.maxLife = p.life = rand(0.5, 0.8);
    p.size = 0.5;
    p.color.set(0xd8a838);
    p.grav = 14;
  }

  private showText(x: number, y: number, z: number, text: string, color: string) {
    let t = this.texts.find((t) => t.life <= 0);
    if (!t) t = this.texts[0];
    const g = t.canvas.getContext("2d")!;
    g.clearRect(0, 0, 256, 96);
    g.font = "bold 62px VT323, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "#140818";
    g.strokeText(text, 128, 50);
    g.fillStyle = color;
    g.fillText(text, 128, 50);
    t.tex.needsUpdate = true;
    t.sprite.position.set(x, y, z);
    t.sprite.visible = true;
    t.mat.opacity = 1;
    t.life = 1;
  }

  private fireTracer(from: THREE.Vector3, to: THREE.Vector3, thick = 1, color = 0xffe2a8, life = 0.07) {
    let tr = this.tracers.find((t) => t.life <= 0);
    if (!tr) tr = this.tracers[0];
    const mid = this.v2.copy(from).add(to).multiplyScalar(0.5);
    tr.mesh.position.copy(mid);
    tr.mesh.lookAt(to);
    tr.mesh.scale.set(thick, thick, Math.max(0.5, from.distanceTo(to)));
    tr.mesh.visible = true;
    tr.mat.color.set(color);
    tr.mat.opacity = 0.9;
    tr.life = life;
    tr.mesh.userData.maxLife = life;
  }

  private muzzleSmoke(count: number) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.pIndex];
      this.pIndex = (this.pIndex + 1) % this.particles.length;
      p.active = true;
      p.pos.copy(this.muzzleV).add(this.v3.set(rand(-0.05, 0.05), rand(-0.05, 0.05), rand(-0.05, 0.05)));
      p.vel.set(rand(-0.3, 0.3), rand(0.4, 0.9), rand(-0.5, 0.1));
      p.maxLife = p.life = rand(0.3, 0.55);
      p.size = rand(0.5, 0.95);
      p.color.set(0x9a948c);
      p.grav = -1.6;
    }
  }

  private spawnDecal(pos: THREE.Vector3, normal: THREE.Vector3, color: number, size: number, life: number) {
    let d = this.decals.find((d) => !d.active);
    if (!d) d = this.decals[0];
    d.active = true;
    d.life = life;
    d.maxLife = life;
    d.mesh.visible = true;
    d.mesh.position.copy(pos).addScaledVector(normal, 0.035);
    this.v3.copy(pos).add(normal);
    d.mesh.lookAt(this.v3);
    d.mesh.rotateZ(rand(0, Math.PI * 2));
    d.mesh.scale.set(size, size, 1);
    d.mat.color.set(color);
    d.mat.opacity = 0.85;
  }

  private spawnRing(pos: THREE.Vector3, color: number, max: number, dur: number) {
    let r = this.rings.find((r) => r.t >= r.dur);
    if (!r) r = this.rings[0];
    r.t = 0;
    r.dur = dur;
    r.max = max;
    r.mesh.visible = true;
    r.mesh.position.set(pos.x, 0.08, pos.z);
    r.mat.color.set(color);
  }

  private spawnBeam(pos: THREE.Vector3, color = 0x8dff3a): BeamFX {
    let b = this.beams.find((b) => b.t >= 1);
    if (!b) b = this.beams[0];
    b.t = 0;
    b.mesh.visible = true;
    b.mesh.scale.set(1, 1, 1);
    b.mat.color.set(color);
    b.mesh.position.set(pos.x, 3.5, pos.z);
    b.mesh.rotation.y = rand(0, 3);
    return b;
  }

  private updateFX(dt: number) {
    for (const d of this.decals) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      d.mat.opacity = 0.85 * Math.min(1, d.life / (d.maxLife * 0.3));
    }
    for (const r of this.rings) {
      if (r.t >= r.dur) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const s = 0.4 + k * r.max;
      r.mesh.scale.set(s, s, s);
      r.mat.opacity = (1 - k) * 0.85;
      if (k >= 1) r.mesh.visible = false;
    }
    for (const b of this.beams) {
      if (b.t >= 1) continue;
      b.t += dt / 0.5;
      const k = Math.min(1, b.t);
      b.mesh.rotation.y += dt * 3;
      b.mesh.scale.set(1 - k * 0.75, 1, 1 - k * 0.75);
      b.mat.opacity = (1 - k) * 0.5;
      if (k >= 1) b.mesh.visible = false;
    }
  }

  private updateAmbient(dt: number) {
    const t = this.clock.elapsedTime;
    for (const w of this.weeds) {
      w.g.position.x += w.speed * dt;
      w.g.position.z = w.baseZ + Math.sin(t * 0.6 + w.phase) * 2;
      w.g.position.y = 0.5 + Math.abs(Math.sin(t * 3.2 + w.phase)) * 0.3;
      w.g.rotation.x -= (w.speed / 0.5) * dt;
      w.g.rotation.z += dt * 1.4;
      if (w.g.position.x > 98) {
        w.g.position.x = -98;
        w.baseZ = rand(-80, 80);
      }
    }
    for (let ui = 0; ui < this.ufos.length; ui++) {
      const u = this.ufos[ui];
      if (ui === 0 && this.ufoEvt >= 0) continue;
      u.a += u.sp * dt;
      u.g.position.set(Math.cos(u.a) * u.r, u.h + Math.sin(t * 0.8 + u.r) * 1.6, Math.sin(u.a) * u.r);
      u.g.rotation.y = -u.a + Math.PI / 2;
      for (let i = 0; i < u.lights.length; i++) {
        u.lights[i].visible = Math.sin(t * 5 + i * 1.05 + u.r) > 0.1;
      }
    }
    const posAttr = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const y = (this.dustBase[i] + t * 0.28) % 9;
      posAttr.setY(i, y);
      posAttr.setX(i, posAttr.getX(i) + Math.sin(t * 0.5 + i) * 0.002);
    }
    posAttr.needsUpdate = true;
    /* papel picado + ristras flutter */
    for (const fl of this.picadoFlags) {
      fl.rotation.z = Math.sin(t * 2.3 + (fl.userData.i as number) * 0.7) * 0.14;
    }
    for (let i = 0; i < this.ristras.length; i++) {
      this.ristras[i].rotation.z = Math.sin(t * 1.8 + i * 2) * 0.06;
    }
    /* fountain spray */
    this.fountainT -= dt;
    if (this.fountainT <= 0) {
      this.fountainT = 1.3;
      this.burst(this.v1.set(0, 2.6, -30), 0x9fd8e8, 6, 2.4);
    }
  }

  private updateCombo(dt: number) {
    if (this.streakT > 0) {
      this.streakT -= dt;
      if (this.streakT <= 0) this.streakCount = 0;
    }
    if (this.comboCount <= 0) return;
    this.comboT -= dt;
    if (this.comboT <= 0) {
      this.comboCount = 0;
      hud.set({ combo: 0 });
    }
  }

  /* ------------------------------------------------ player / weapons */

  private fire() {
    const w = WEAPONS[this.weaponIdx];
    if (this.reloading || this.switchT > 0) return;
    if (this.shootCd > 0) return;
    if (this.mags[this.weaponIdx] <= 0) {
      if (this.dryT <= 0) {
        sfx.dry();
        this.dryT = 0.3;
        this.tryReload();
      }
      this.shootCd = 0.2;
      return;
    }
    this.mags[this.weaponIdx]--;
    this.shootCd = w.rate;
    this.recoil = Math.min(1.4, this.recoil + w.recoil * 0.55);
    this.flashT = 0.045;
    this.gunLight.intensity = this.weaponIdx === 1 ? 60 : 34;
    this.shake += w.kick;
    /* recoil springs: sustained SMG fire climbs, heavies punch + roll */
    this.kickPV += w.pitchKick * rand(0.85, 1.15);
    if (w.rollKick >= 2) {
      this.rollSign *= -1;
      this.kickRV += w.rollKick * this.rollSign * rand(0.8, 1.2);
      this.shake += w.kind === "rocket" ? 0.2 : 0.12;
    } else {
      this.kickRV += w.rollKick * rand(-1, 1);
    }
    w.sound();
    if (w.kind !== "rocket") this.casing();
    document.documentElement.style.setProperty("--spr", `${Math.round(6 + this.recoil * 14)}px`);
    this.muzzleSmoke(this.weaponIdx === 0 ? 1 : 2);
    this.fovKick += w.fovKick;
    this.gunLight.intensity = w.kind === "rocket" ? 90 : this.gunLight.intensity;

    /* muzzle world position */
    const gun = this.guns[this.weaponIdx];
    const mz = [[0, 0.01, -0.62], [0, 0.03, -0.52], [0, 0.04, -0.58], [0, 0.02, -0.52]][this.weaponIdx];
    this.muzzleV.set(mz[0], mz[1], mz[2]).applyMatrix4(gun.matrixWorld);

    if (w.kind === "rocket") {
      this.launchRocket();
      this.hudSync();
      return;
    }

    /* hitscan — per pellet */
    const baseSpread = w.spread * (1 + this.recoil * 1.4);
    this.camera.getWorldDirection(this.v1);
    const right = this.v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = this.v3.set(0, 1, 0);
    const baseDir = this.v1.clone();
    const dir = new THREE.Vector3();
    for (let pi = 0; pi < w.pellets; pi++) {
      const spread = baseSpread * (w.pellets > 1 ? rand(0.5, 1.25) : 1);
      dir
        .copy(baseDir)
        .addScaledVector(right, (Math.random() - 0.5) * 2 * spread)
        .addScaledVector(up, (Math.random() - 0.5) * 2 * spread)
        .normalize();
      this.raycaster.set(this.camera.position, dir);
      this.raycaster.far = 170;
      const targets: THREE.Object3D[] = [...this.hitList, ...this.envMeshes];
      const hits = this.raycaster.intersectObjects(targets, false);
      let end: THREE.Vector3;
      if (hits.length > 0) {
        const h = hits[0];
        end = h.point.clone();
        const e = h.object.userData.e as Enemy | undefined;
        if (e) {
          const headY = e.kind === "brute" || e.kind === "boss" ? 1.95 : 1.5;
          const isHead = h.point.y > e.group.position.y + headY * e.groupBase;
          this.damageEnemy(e, isHead ? w.dmg * 1.8 : w.dmg, h.point, isHead);
        } else {
          this.burst(h.point, 0xffb050, 4, 3);
          if (h.face) {
            const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
            this.spawnDecal(h.point, n, 0x17100c, rand(0.24, 0.5), rand(5, 8));
          }
        }
      } else {
        end = this.camera.position.clone().addScaledVector(dir, 120);
      }
      if (this.weaponIdx === 1) {
        this.fireTracer(this.muzzleV.clone(), end, 2.4, 0xffb050, 0.1);
      } else if (this.weaponIdx === 2) {
        this.fireTracer(this.muzzleV.clone(), end, 1.5, 0xffc060, 0.06);
      } else {
        this.fireTracer(this.muzzleV.clone(), end, 1, 0xffe2a8, 0.07);
      }
    }
    this.hudSync();
  }

  private tryReload() {
    const w = WEAPONS[this.weaponIdx];
    const i = this.weaponIdx;
    if (this.reloading || this.mags[i] >= w.magSize || this.reserves[i] <= 0) return;
    this.reloading = true;
    this.reloadT = w.reloadTime;
    sfx.reload();
    this.hudSync();
  }

  private finishReload() {
    const w = WEAPONS[this.weaponIdx];
    const i = this.weaponIdx;
    const need = w.magSize - this.mags[i];
    const take = Math.min(need, this.reserves[i]);
    this.mags[i] += take;
    this.reserves[i] -= take;
    this.reloading = false;
    this.hudSync();
  }

  private switchWeapon(i: number) {
    if (i === this.weaponIdx || i < 0 || i > 3) return;
    this.weaponIdx = i;
    this.reloading = false;
    this.switchT = 0.22;
    for (let g = 0; g < this.guns.length; g++) this.guns[g].visible = g === i;
    sfx.switch();
    this.hudSync();
  }

  private damagePlayer(d: number, source: string) {
    if (this.state !== "playing") return;
    this.health = Math.max(0, this.health - d);
    this.shake += 0.5;
    sfx.hurt();
    hud.dmg();
    hud.feed(`HIT BY ${source}  -${d} HP`, "#ff5a5a");
    this.hudSync();
    if (this.health <= 0) this.gameOver();
  }

  private gameOver() {
    this.state = "gameover";
    this.mouseDown = false;
    try {
      document.exitPointerLock();
    } catch {
      /* ignore */
    }
    sfx.gameover();
    hud.saveBest(hud.get().score);
    hud.set({ state: "gameover", health: 0 });
  }

  /* ------------------------------------------------ waves */

  private startWave(n: number) {
    this.wave = n;
    const grunts = Math.min(5 + n * 2, 16);
    const spitters = n >= 2 ? Math.min(1 + Math.floor(n * 0.9), 7) : 0;
    const brutes = n >= 3 ? Math.min(Math.floor((n - 1) / 1.4), 6) : 0;
    const q: EnemyKind[] = [];
    for (let i = 0; i < grunts; i++) q.push("grunt");
    for (let i = 0; i < spitters; i++) q.push("spitter");
    for (let i = 0; i < brutes; i++) q.push("brute");
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    if (n % 5 === 0) q.push("boss");
    this.queue = q;
    this.spawnT = 0.6;
    this.waveBreak = -1;
    hud.banner(`WAVE ${n}`, n % 5 === 0 ? "BOSS WAVE. BRING THE BOOMSTICK." : pick(WAVE_LINES));
    sfx.wave();
    if (n % 3 === 0 && this.ufoEvt < 0) this.ufoEvt = 0;
    this.hudSync();
  }

  private updateWaves(dt: number) {
    if (this.queue.length > 0) {
      this.spawnT -= dt;
      const alive = this.enemies.filter((e) => !e.dying).length;
      if (this.spawnT <= 0 && alive < Math.min(10 + this.wave, 16)) {
        const kind = this.queue.pop()!;
        if (kind === "boss") this.spawnBoss();
        else this.spawnEnemy(kind);
        this.spawnT = Math.max(0.35, 1.15 - this.wave * 0.06);
        this.hudSync();
      }
    } else if (this.enemies.length === 0 && this.waveBreak < 0) {
      this.waveBreak = 3.6;
      const bonus = 250 * this.wave;
      hud.set({ score: hud.get().score + bonus });
      this.health = Math.min(100, this.health + 18);
      this.reserves[0] = Math.min(240, this.reserves[0] + 64);
      this.reserves[1] = Math.min(48, this.reserves[1] + 12);
      this.reserves[2] = Math.min(48, this.reserves[2] + 10);
      this.reserves[3] = Math.min(12, this.reserves[3] + 3);
      hud.banner("WAVE CLEARED", `SECTOR BONUS +${bonus}`);
      sfx.clear();
      this.hudSync();
    } else if (this.waveBreak > 0) {
      this.waveBreak -= dt;
      if (this.waveBreak <= 0) this.startWave(this.wave + 1);
    }
  }

  /* ------------------------------------------------ updates */

  private updatePlayer(dt: number) {
    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const speed = sprint ? 11.5 : 7.6;
    const fwd = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const str = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let wx = fx * fwd + rx * str;
    let wz = fz * fwd + rz * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx = (wx / wl) * speed;
      wz = (wz / wl) * speed;
    }
    const accel = this.onGround ? 19 : 5;
    this.vel.x += (wx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wz - this.vel.z) * Math.min(1, accel * dt);
    this.vel.y -= 22 * dt;
    if (this.keys.has("Space") && this.onGround) {
      this.vel.y = 9;
      this.onGround = false;
      sfx.jump();
    }

    /* integrate + collide per axis */
    const r = 0.6;
    this.pos.x += this.vel.x * dt;
    for (const c of this.colliders) {
      if (this.pos.x > c.minX - r && this.pos.x < c.maxX + r && this.pos.z > c.minZ - r && this.pos.z < c.maxZ + r) {
        this.pos.x = this.vel.x > 0 ? c.minX - r : c.maxX + r;
      }
    }
    this.pos.z += this.vel.z * dt;
    for (const c of this.colliders) {
      if (this.pos.x > c.minX - r && this.pos.x < c.maxX + r && this.pos.z > c.minZ - r && this.pos.z < c.maxZ + r) {
        this.pos.z = this.vel.z > 0 ? c.minZ - r : c.maxZ + r;
      }
    }
    this.pos.x = Math.max(-WORLD_R, Math.min(WORLD_R, this.pos.x));
    this.pos.z = Math.max(-WORLD_R + 2, Math.min(WORLD_R, this.pos.z));
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      if (!this.onGround && this.vel.y < -6) {
        sfx.land();
        this.burst(this.v1.set(this.pos.x, 0.15, this.pos.z), 0xc4a06a, 7, 2.2);
        this.shake += 0.1;
      }
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }

    const horiz = Math.hypot(this.vel.x, this.vel.z);
    this.bobT += horiz * dt * 1.7;
    const bobAmp = this.onGround ? Math.min(horiz / 6, 1) : 0;
    const eyeY = 1.7 + Math.sin(this.bobT * 2) * 0.05 * bobAmp;

    /* recoil springs */
    this.kickPV += (-110 * this.kickP - 13 * this.kickPV) * dt;
    this.kickP = Math.max(-0.12, Math.min(0.34, this.kickP + this.kickPV * dt));
    this.kickRV += (-90 * this.kickR - 11 * this.kickRV) * dt;
    this.kickR += this.kickRV * dt;

    /* fov: sprint stretch + fire punch, springy */
    this.fovKick *= Math.pow(0.0008, dt);
    const fovTarget = 77 + (sprint && horiz > 1 ? 9 : 0) + this.fovKick;
    this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, 16 * dt);
    this.camera.updateProjectionMatrix();

    /* footsteps */
    if (this.onGround && horiz > 2.5) {
      this.stepAcc += horiz * dt;
      if (this.stepAcc > (sprint ? 2.3 : 2.9)) {
        this.stepAcc = 0;
        sfx.step();
        if (Math.random() < 0.35) this.burst(this.v1.set(this.pos.x, 0.05, this.pos.z), 0xc4a06a, 2, 1.1);
      }
    }

    this.shake = Math.max(0, this.shake - dt * 2.6);
    const sh = this.shake * this.shake * 0.35;
    const breathe = Math.sin(this.clock.elapsedTime * 1.7) * 0.01;
    this.camera.position.set(
      this.pos.x + rand(-sh, sh),
      eyeY + breathe + rand(-sh, sh),
      this.pos.z + rand(-sh, sh)
    );
    this.camera.rotation.set(
      this.pitch + this.kickP + breathe * 0.25 + rand(-sh, sh) * 0.4,
      this.yaw,
      this.kickR * 0.06 + rand(-sh, sh) * 0.3
    );

    /* weapon timers */
    this.shootCd -= dt;
    this.dryT -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.flashT -= dt;
    this.switchT -= dt;
    document.documentElement.style.setProperty("--spr", `${Math.round(6 + this.recoil * 12)}px`);
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }
    if (this.mouseDown) this.fire();
  }

  private updateViewmodel(dt: number) {
    const gun = this.gunGroup;
    const horiz = Math.hypot(this.vel.x, this.vel.z);
    const bob = Math.sin(this.bobT * 2) * Math.min(horiz / 6, 1);
    let y = -0.0 + bob * 0.02;
    let rotZ = Math.sin(this.bobT) * Math.min(horiz / 6, 1) * 0.03 + this.kickR * 0.02;
    let rotX = this.recoil * (this.weaponIdx === 1 ? 0.22 : 0.09) + Math.max(0, this.kickP) * 1.6;
    let z = -this.recoil * 0.08 - Math.max(0, this.kickP) * 0.38;
    if (this.reloading) {
      const w = WEAPONS[this.weaponIdx];
      const t = 1 - this.reloadT / w.reloadTime;
      const dip = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
      y -= dip * 0.25;
      rotZ += dip * 0.9;
    }
    if (this.switchT > 0) {
      y -= this.switchT * 1.2;
    }
    gun.position.set(this.kickR * -0.012, y, 0);
    gun.rotation.set(rotX, 0, rotZ);
    for (const gmodel of this.guns) {
      gmodel.position.z = -0.78 + z;
    }
    /* flash + light */
    for (let i = 0; i < this.flashMeshes.length; i++) {
      this.flashMeshes[i].visible = this.flashT > 0 && i === this.weaponIdx;
      if (this.flashMeshes[i].visible) this.flashMeshes[i].rotation.z = rand(0, Math.PI * 2);
    }
    this.gunLight.intensity = Math.max(0, this.gunLight.intensity - dt * 30);
    /* menu: gun hidden */
    this.gunGroup.visible = this.state === "playing" || this.state === "paused";
  }

  private updateEnemies(dt: number) {
    const combat = this.state === "playing";
    for (const e of [...this.enemies]) {
      if (e.dying) {
        e.dieT += dt;
        const t = e.dieT / (e.boss ? 0.6 : 0.28);
        e.group.rotation.y += dt * 11;
        const s = Math.max(0.001, 1 - t) * e.groupBase;
        e.group.scale.set(s, s, s);
        if (t >= 1) this.removeEnemy(e);
        continue;
      }

      const gp = e.group.position;
      let dx: number, dz: number, dist: number;

      if (combat) {
        dx = this.pos.x - gp.x;
        dz = this.pos.z - gp.z;
        dist = Math.hypot(dx, dz);
      } else {
        /* attract wander */
        if (!e.waypoint || Math.hypot(e.waypoint.x - gp.x, e.waypoint.z - gp.z) < 2) {
          e.waypoint = new THREE.Vector3(rand(-32, 32), 0, rand(-32, 32));
        }
        dx = e.waypoint.x - gp.x;
        dz = e.waypoint.z - gp.z;
        dist = Math.hypot(dx, dz);
      }

      /* separation */
      for (const o of this.enemies) {
        if (o === e || o.dying) continue;
        const sx = gp.x - o.group.position.x;
        const sz = gp.z - o.group.position.z;
        const sd = Math.hypot(sx, sz);
        const min = e.radius + o.radius;
        if (sd > 0.001 && sd < min) {
          gp.x += (sx / sd) * (min - sd) * 0.5;
          gp.z += (sz / sd) * (min - sd) * 0.5;
        }
      }

      let moving = true;
      if (combat) {
        if (e.kind === "grunt") {
          if (e.leapT > 0) {
            /* mid-leap */
            e.leapT -= dt;
            gp.x += e.leapVX * dt;
            gp.z += e.leapVZ * dt;
            if (e.leapT <= 0) {
              e.leapT = 0;
              this.burst(this.v1.set(gp.x, 0.2, gp.z), 0xc4a06a, 6, 2.5);
              sfx.land();
              if (dist < 2.2) this.damagePlayer(e.dmg, "LEAPING GRUNT");
            }
          } else {
            e.leapCd -= dt;
            if (dist > 6 && dist < 12.5 && e.leapCd <= 0) {
              e.leapT = 0.5;
              e.leapCd = rand(3.5, 5.5);
              const sp = Math.min(dist / 0.5, 13);
              e.leapVX = (dx / dist) * sp;
              e.leapVZ = (dz / dist) * sp;
              sfx.jump();
            } else if (dist > e.radius + 0.5) {
              gp.x += (dx / dist) * e.speed * dt;
              gp.z += (dz / dist) * e.speed * dt;
            } else {
              moving = false;
              e.attackCd -= dt;
              if (e.attackCd <= 0) {
                e.attackCd = 1.15;
                e.lungeT = 0.3;
              }
            }
            if (e.lungeT > 0) {
              const prev = e.lungeT;
              e.lungeT -= dt;
              const phase = (t: number) => Math.sin(((0.3 - t) / 0.3) * Math.PI);
              e.parts.body.position.z = phase(Math.max(0, e.lungeT)) * 0.45;
              if (prev > 0.15 && e.lungeT <= 0.15 && dist < e.radius + 1.6) {
                this.damagePlayer(e.dmg, "ALIEN GRUNT");
              }
            } else {
              e.parts.body.position.z = 0;
            }
          }
        } else if (e.kind === "brute" || e.kind === "boss") {
          if (e.chargeT > 0) {
            e.chargeT -= dt;
            gp.x += e.chargeDX * e.speed * 3.4 * dt;
            gp.z += e.chargeDZ * e.speed * 3.4 * dt;
            if (!e.chargeHit && dist < e.radius + 1.3) {
              e.chargeHit = true;
              this.damagePlayer(Math.round(e.dmg * 1.5), e.boss ? "EL JEFE" : "BRUTE CHARGE");
              this.shake += 0.45;
            }
            e.parts.body.rotation.z = Math.sin(e.chargeT * 42) * 0.09;
          } else {
            e.parts.body.rotation.z = 0;
            e.chargeCd -= dt;
            if (dist > 9 && dist < 27 && e.chargeCd <= 0) {
              e.chargeT = 0.85;
              e.chargeCd = rand(5, 7);
              e.chargeDX = dx / dist;
              e.chargeDZ = dz / dist;
              e.chargeHit = false;
              sfx.charge();
              this.spawnRing(gp, 0xff5a5a, 3.2, 0.35);
            } else if (dist > e.radius + 0.5) {
              gp.x += (dx / dist) * e.speed * dt;
              gp.z += (dz / dist) * e.speed * dt;
            } else {
              moving = false;
              e.attackCd -= dt;
              if (e.attackCd <= 0) {
                e.attackCd = 1.15;
                e.lungeT = 0.3;
              }
            }
            if (e.lungeT > 0) {
              const prev = e.lungeT;
              e.lungeT -= dt;
              const phase = (t: number) => Math.sin(((0.3 - t) / 0.3) * Math.PI);
              e.parts.body.position.z = phase(Math.max(0, e.lungeT)) * 0.45;
              if (prev > 0.15 && e.lungeT <= 0.15 && dist < e.radius + 1.6) {
                this.damagePlayer(e.dmg, e.boss ? "EL JEFE" : "BRUTE");
              }
            } else {
              e.parts.body.position.z = 0;
            }
          }
          if (e.boss) {
            e.spitCd -= dt;
            if (e.spitCd <= 0 && dist > 8 && dist < 46) {
              e.spitCd = rand(2.6, 3.4);
              for (const off of [-0.35, 0, 0.35]) this.fireProjectile(gp, Math.round(e.dmg * 0.6), off);
            }
          }
          if (e.parts.sac) {
            const pulse = 1 + Math.sin(this.clock.elapsedTime * 5 + gp.x) * 0.18;
            e.parts.sac.scale.set(pulse, pulse, pulse);
          }
        } else {
          /* spitter */
          e.spitCd -= dt;
          if (dist > 17) {
            gp.x += (dx / dist) * e.speed * dt;
            gp.z += (dz / dist) * e.speed * dt;
          } else if (dist < 9) {
            gp.x -= (dx / dist) * e.speed * 0.8 * dt;
            gp.z -= (dz / dist) * e.speed * 0.8 * dt;
          } else {
            moving = false;
            if (e.spitCd <= 0 && dist < 42) {
              e.spitCd = rand(2.2, 3);
              this.fireProjectile(gp, e.dmg);
            }
          }
          if (e.parts.sac) {
            const pulse = 1 + Math.sin(this.clock.elapsedTime * 5 + gp.x) * 0.18;
            e.parts.sac.scale.set(pulse, pulse, pulse);
          }
        }
      }

      if (dist > 0.01) e.group.rotation.y = Math.atan2(dx, dz);
      e.bobT += dt * (moving ? e.speed * 2.2 : 3);
      let baseY = e.kind === "brute" || e.kind === "boss" ? 0 : Math.abs(Math.sin(e.bobT)) * 0.12;
      if (e.leapT > 0) baseY = Math.sin(((0.5 - e.leapT) / 0.5) * Math.PI) * 1.5;
      e.group.position.y = baseY;
      if (e.parts.armL) e.parts.armL.rotation.x = Math.sin(e.bobT) * 0.7;
      if (e.parts.armR) e.parts.armR.rotation.x = -Math.sin(e.bobT) * 0.7;
      /* hit squash pop */
      if (e.hitPop > 0) {
        e.hitPop = Math.max(0, e.hitPop - dt);
        const pop = 1 + (e.hitPop / 0.22) * 0.22;
        e.parts.body.scale.set(e.baseScale.x * pop, e.baseScale.y / pop, e.baseScale.z * pop);
      }
      if (e.flashT > 0) {
        e.flashT -= dt;
        if (e.flashT <= 0) {
          const om = e.parts.body.userData.origMat as THREE.Material | undefined;
          if (om) (e.parts.body as THREE.Mesh).material = om;
        }
      }
      if (e.parts.cape) {
        e.parts.cape.rotation.x = 0.18 + Math.sin(this.clock.elapsedTime * 6 + gp.x) * 0.12 + (moving ? 0.22 : 0);
      }
    }
  }

  private fireProjectile(from: THREE.Vector3, dmg: number, aimOffset = 0) {
    const p = this.projectiles.find((p) => !p.active);
    if (!p) return;
    p.active = true;
    p.life = 4;
    p.mesh.visible = true;
    p.mesh.position.set(from.x, 1.6, from.z);
    this.v1.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    const d = this.v1.length() || 1;
    this.v1.normalize();
    if (aimOffset !== 0) {
      const cos = Math.cos(aimOffset);
      const sin = Math.sin(aimOffset);
      const nx = this.v1.x * cos - this.v1.z * sin;
      this.v1.z = this.v1.x * sin + this.v1.z * cos;
      this.v1.x = nx;
    }
    p.vel.set(this.v1.x * 15, 3.2 + d * 0.06, this.v1.z * 15);
    p.mesh.userData.dmg = dmg;
    sfx.spit();
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life -= dt;
      p.vel.y -= 13 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const mp = p.mesh.position;
      if (mp.y < 0.14) {
        p.active = false;
        p.mesh.visible = false;
        this.burst(mp, 0x8dff3a, 7, 3);
        sfx.splat();
        continue;
      }
      const dx = mp.x - this.pos.x;
      const dz = mp.z - this.pos.z;
      if (Math.hypot(dx, dz) < 0.95 && mp.y < 2.2) {
        p.active = false;
        p.mesh.visible = false;
        this.burst(mp, 0x8dff3a, 8, 3.5);
        this.damagePlayer((p.mesh.userData.dmg as number) || 12, "ACID SPIT");
        continue;
      }
      if (p.life <= 0 || Math.abs(mp.x) > 120 || Math.abs(mp.z) > 120) {
        p.active = false;
        p.mesh.visible = false;
      }
    }
  }

  private launchRocket() {
    const r = this.rockets.find((r) => !r.active);
    if (!r) return;
    r.active = true;
    r.life = 4;
    r.g.visible = true;
    this.camera.getWorldDirection(this.v1);
    this.v1.x += rand(-0.006, 0.006);
    this.v1.y += rand(-0.006, 0.006);
    this.v1.z += rand(-0.006, 0.006);
    this.v1.normalize();
    r.g.position.copy(this.muzzleV);
    r.vel.copy(this.v1).multiplyScalar(48);
    r.g.quaternion.setFromUnitVectors(this.v2.set(0, 1, 0), this.v1);
  }

  private explodeRocket(at: THREE.Vector3) {
    sfx.boom();
    this.shake += 1.0;
    this.spawnRing(at, 0xff9a2a, 8, 0.5);
    this.spawnRing(at, 0xfff2c8, 4.5, 0.3);
    this.burst(at, 0xff9a2a, 22, 8);
    this.burst(at, 0x666666, 12, 4.5);
    this.spawnDecal(this.v3.set(at.x, 0.02, at.z), this.v2.set(0, 1, 0), 0x100c08, 2.6, 14);
    for (const e of [...this.enemies]) {
      if (e.dying) continue;
      const ep = e.group.position;
      const d = Math.hypot(ep.x - at.x, ep.z - at.z);
      if (d < 7.2) {
        const dmg = Math.round(WEAPONS[3].dmg * (1 - (d / 7.2) * 0.55));
        this.damageEnemy(e, dmg, this.v1.set(ep.x, 1.2, ep.z), false);
      }
    }
    /* backblast — respect the blast radius, tex */
    const pd = Math.hypot(this.pos.x - at.x, this.pos.z - at.z);
    if (pd < 7.2) this.damagePlayer(Math.round(22 * (1 - pd / 7.2)), "BOOMSTICK BACKBLAST");
    this.fovKick += 2.2;
  }

  private updateRockets(dt: number) {
    for (const r of this.rockets) {
      if (!r.active) continue;
      r.life -= dt;
      r.vel.y -= 4.5 * dt;
      const prev = this.v2.copy(r.g.position);
      r.g.position.addScaledVector(r.vel, dt);
      /* smoke trail */
      const p = this.particles[this.pIndex];
      this.pIndex = (this.pIndex + 1) % this.particles.length;
      p.active = true;
      p.pos.copy(r.g.position);
      p.vel.set(rand(-0.4, 0.4), rand(0.2, 0.7), rand(-0.4, 0.4));
      p.maxLife = p.life = rand(0.3, 0.55);
      p.size = rand(0.7, 1.2);
      p.color.set(0x8a8a8a);
      p.grav = -1.5;

      const rp = r.g.position;
      let boom: THREE.Vector3 | null = null;
      if (rp.y < 0.18) {
        boom = rp.clone().setY(0.25);
      } else {
        for (const e of this.enemies) {
          if (e.dying) continue;
          const ep = e.group.position;
          const rr = e.radius * e.groupBase + 0.45;
          if (Math.abs(rp.x - ep.x) < rr && Math.abs(rp.z - ep.z) < rr && rp.y < 3.4 * e.groupBase) {
            boom = rp.clone();
            break;
          }
        }
        if (!boom) {
          const step = this.v3.copy(rp).sub(prev);
          const len = step.length();
          if (len > 0.001) {
            this.raycaster.set(prev, step.normalize());
            this.raycaster.far = len + 0.6;
            const hits = this.raycaster.intersectObjects(this.envMeshes, false);
            if (hits.length > 0) boom = hits[0].point.clone();
          }
        }
      }
      if (boom || r.life <= 0) {
        r.active = false;
        r.g.visible = false;
        this.explodeRocket(boom || rp);
      }
    }
  }

  private updatePickups(dt: number) {
    for (const p of [...this.pickups]) {
      if (!p.active) continue;
      p.t += dt;
      p.life -= dt;
      p.group.rotation.y += dt * 2.2;
      p.group.position.y = 0.45 + Math.sin(p.t * 3) * 0.12;
      p.group.visible = p.life > 3 || Math.sin(p.t * 14) > -0.3;
      const dx = p.group.position.x - this.pos.x;
      const dz = p.group.position.z - this.pos.z;
      if (Math.hypot(dx, dz) < 1.5) {
        p.active = false;
        this.scene.remove(p.group);
        this.pickups = this.pickups.filter((x) => x !== p);
        if (p.kind === "health") {
          this.health = Math.min(100, this.health + 25);
          sfx.heal();
          hud.feed("MEDKIT  +25 HP", "#6cff8a");
          this.showText(this.pos.x, 2.4, this.pos.z, "+25 HP", "#6cff8a");
        } else if (p.kind === "nuke") {
          this.nukeBlast();
        } else {
          this.reserves[0] = Math.min(240, this.reserves[0] + 48);
          this.reserves[1] = Math.min(48, this.reserves[1] + 9);
          this.reserves[2] = Math.min(48, this.reserves[2] + 8);
          this.reserves[3] = Math.min(12, this.reserves[3] + 2);
          sfx.pickup();
          hud.feed("AMMO CACHE RESTOCKED", "#ffd23f");
          this.showText(this.pos.x, 2.4, this.pos.z, "AMMO", "#ffd23f");
        }
        this.hudSync();
        continue;
      }
      if (p.life <= 0) {
        p.active = false;
        this.scene.remove(p.group);
        this.pickups = this.pickups.filter((x) => x !== p);
      }
    }
  }

  private updateParticles(dt: number) {
    let any = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.active) {
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
        } else {
          p.vel.y -= p.grav * dt;
          p.pos.addScaledVector(p.vel, dt);
          if (p.pos.y < 0.05) {
            p.pos.y = 0.05;
            p.vel.y *= -0.4;
          }
          any = true;
        }
      }
      if (p.active) {
        const s = p.size * Math.min(1, (p.life / p.maxLife) * 2);
        this.dummy.position.copy(p.pos);
        this.dummy.scale.set(s, s, s);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.pMesh.setMatrixAt(i, this.dummy.matrix);
        this.pMesh.setColorAt(i, p.color);
      } else {
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.pMesh.setMatrixAt(i, this.dummy.matrix);
      }
    }
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
    if (!any) {
      /* keep it cheap when idle */
    }
  }

  private updateTracers(dt: number) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        const max = (t.mesh.userData.maxLife as number) || 0.07;
        t.mat.opacity = Math.max(0, (t.life / max) * 0.9);
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
  }

  private updateTexts(dt: number) {
    for (const t of this.texts) {
      if (t.life > 0) {
        t.life -= dt * 1.1;
        t.sprite.position.y += dt * 1.7;
        t.mat.opacity = Math.max(0, Math.min(1, t.life * 2));
        if (t.life <= 0) t.sprite.visible = false;
      }
    }
  }

  private drawRadar() {
    const c = this.radar;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const S = c.width;
    const cx = S / 2;
    g.clearRect(0, 0, S, S);
    g.fillStyle = "rgba(8,16,8,0.85)";
    g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgba(141,255,58,0.35)";
    g.lineWidth = 1;
    for (const rr of [S * 0.22, S * 0.44]) {
      g.beginPath();
      g.arc(cx, cx, rr, 0, Math.PI * 2);
      g.stroke();
    }
    const k = (S / 2) / 44;
    const fwd = this.v1;
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const rgt = this.v2.set(-fwd.z, 0, fwd.x);
    const dot = (ox: number, oz: number) => {
      const rx = ox - this.pos.x;
      const rz = oz - this.pos.z;
      return [rx * rgt.x + rz * rgt.z, rx * fwd.x + rz * fwd.z];
    };
    for (const e of this.enemies) {
      if (e.dying) continue;
      const [x, y] = dot(e.group.position.x, e.group.position.z);
      const sx = cx + x * k;
      const sy = cx - y * k;
      if (sx < 2 || sx > S - 2 || sy < 2 || sy > S - 2) continue;
      g.fillStyle = e.boss ? "#ffd23f" : e.kind === "brute" ? "#c05aff" : e.kind === "spitter" ? "#ff9a2a" : "#8dff3a";
      const sz = e.boss ? 6 : e.kind === "brute" ? 4 : 3;
      g.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
    }
    for (const p of this.pickups) {
      const [x, y] = dot(p.group.position.x, p.group.position.z);
      const sx = cx + x * k;
      const sy = cx - y * k;
      if (sx < 2 || sx > S - 2 || sy < 2 || sy > S - 2) continue;
      g.fillStyle = "#ffd23f";
      g.beginPath();
      g.arc(sx, sy, 2, 0, Math.PI * 2);
      g.fill();
    }
    /* player wedge */
    g.fillStyle = "#ffd23f";
    g.beginPath();
    g.moveTo(cx, cx - 5);
    g.lineTo(cx - 4, cx + 4);
    g.lineTo(cx + 4, cx + 4);
    g.closePath();
    g.fill();
  }

  /* ------------------------------------------------ flow */

  private nukeBlast() {
    hud.set({ nukeId: hud.get().nukeId + 1 });
    sfx.nuke();
    this.shake += 1.4;
    this.spawnRing(this.pos, 0xfff2c8, 22, 0.9);
    this.spawnRing(this.pos, 0xff9a2a, 14, 0.6);
    this.burst(this.v1.set(this.pos.x, 2, this.pos.z), 0xfff2c8, 30, 9);
    const b = this.spawnBeam(this.v2.set(this.pos.x, 0, this.pos.z), 0xffd23f);
    b.mesh.scale.set(3, 1.4, 3);
    for (const e of [...this.enemies]) if (!e.dying) this.killEnemy(e, true);
    hud.feed("TACTICAL NUKE DETONATED", "#ffd23f");
  }

  private hudSync() {
    const boss = this.enemies.find((e) => e.boss && !e.dying);
    hud.set({
      bossHp: boss ? Math.max(0, Math.min(1, boss.hp / (ENEMY_DEFS.boss.hp * (1 + this.wave * 0.04)))) : 0,
      bossName: boss ? "EL JEFE" : "",
      health: Math.round(this.health),
      mag: this.mags[this.weaponIdx],
      reserve: this.reserves[this.weaponIdx],
      weapon: WEAPONS[this.weaponIdx].name,
      weaponSlot: this.weaponIdx,
      reloading: this.reloading,
      wave: this.wave,
      enemiesLeft: this.enemies.filter((e) => !e.dying).length + this.queue.length,
    });
  }

  reset() {
    for (const e of [...this.enemies]) {
      this.scene.remove(e.group);
    }
    this.enemies = [];
    this.hitList = [];
    for (const p of this.projectiles) {
      p.active = false;
      p.mesh.visible = false;
    }
    for (const p of this.pickups) this.scene.remove(p.group);
    this.pickups = [];
    for (const t of this.tracers) {
      t.life = 0;
      t.mesh.visible = false;
    }
    for (const t of this.texts) {
      t.life = 0;
      t.sprite.visible = false;
    }
    for (const p of this.particles) p.active = false;
    for (const d of this.decals) {
      d.active = false;
      d.mesh.visible = false;
    }
    for (const r of this.rings) {
      r.t = r.dur;
      r.mesh.visible = false;
    }
    for (const b of this.beams) {
      b.t = 1;
      b.mesh.visible = false;
    }
    this.comboCount = 0;
    this.comboT = 0;
    this.kickP = 0;
    this.kickPV = 0;
    this.kickR = 0;
    this.kickRV = 0;
    this.pos.set(0, 0, 16);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.weaponIdx = 0;
    this.mags = [32, 6, 8, 1];
    this.reserves = [160, 36, 32, 9];
    this.shootCd = 0;
    this.reloading = false;
    this.recoil = 0;
    this.mouseDown = false;
    this.wave = 0;
    this.queue = [];
    this.waveBreak = -1;
    this.comboCount = 0;
    this.comboT = 0;
    this.streakCount = 0;
    this.streakT = 0;
    this.ufoEvt = -1;
    this.ufoEvtSpawned = false;
    for (const r of this.rockets) {
      r.active = false;
      r.g.visible = false;
    }
    for (let g = 0; g < this.guns.length; g++) this.guns[g].visible = g === 0;
    this.hudSync();
    hud.set({ score: 0, kills: 0, feed: [], combo: 0 });
  }

  startGame() {
    this.reset();
    this.state = "playing";
    hud.set({ state: "playing" });
    sfx.start();
    this.startWave(1);
    this.requestLock();
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    hud.set({ state: "playing" });
    this.requestLock();
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.mouseDown = false;
    hud.set({ state: "paused" });
  }

  toMenu() {
    this.reset();
    this.state = "menu";
    hud.set({ state: "menu" });
    this.spawnAttractCrowd();
    try {
      document.exitPointerLock();
    } catch {
      /* ignore */
    }
  }

  private requestLock() {
    try {
      const res = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      if (res && typeof res.catch === "function") res.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------ events */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") e.preventDefault();
    this.keys.add(e.code);
    if (this.state !== "playing") return;
    if (e.code === "KeyR") this.tryReload();
    if (e.code === "Digit1") this.switchWeapon(0);
    if (e.code === "Digit2") this.switchWeapon(1);
    if (e.code === "Digit3") this.switchWeapon(2);
    if (e.code === "Digit4") this.switchWeapon(3);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.state !== "playing") return;
    /* pointer-locked: free aim. not locked (e.g. iframe blocked it): drag to aim */
    if (!this.locked && e.buttons !== 1) return;
    this.yaw -= e.movementX * 0.0021;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0021));
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (this.state === "playing") {
      this.mouseDown = true;
      if (!this.locked) this.requestLock();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (this.state !== "playing") return;
    this.switchWeapon((this.weaponIdx + (e.deltaY > 0 ? 1 : -1) + 4) % 4);
  };

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    if (!this.locked && this.state === "playing") this.pause();
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouseDown = false;
    if (this.state === "playing") this.pause();
  };

  private onCtx = (e: Event) => e.preventDefault();

  private bindEvents() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("wheel", this.onWheel);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onLockChange);
    this.container.addEventListener("contextmenu", this.onCtx);
  }

  /* ------------------------------------------------ loop */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = Math.min(0.05, this.clock.getDelta());
    if (this.freeze > 0 && this.state === "playing") {
      this.freeze -= dt;
      dt *= 0.15;
    }

    /* neon flicker */
    this.neonTick -= dt;
    if (this.neonTick <= 0) {
      this.neonTick = rand(0.4, 2.2);
      for (const m of this.neonMats) m.visible = Math.random() > 0.12;
    }

    if (this.state === "menu") {
      this.attractT += dt;
      const t = this.attractT;
      this.camera.position.set(Math.cos(t * 0.11) * 40, 11 + Math.sin(t * 0.21) * 2.5, Math.sin(t * 0.11) * 40);
      this.camera.lookAt(0, 3, -8);
      this.updateEnemies(dt);
      this.updateParticles(dt);
      this.updateFX(dt);
      this.updateAmbient(dt);
    } else if (this.state === "playing") {
      this.updatePlayer(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateRockets(dt);
      this.updatePickups(dt);
      this.updateUfo(dt);
      this.updateWaves(dt);
      this.updateParticles(dt);
      this.updateTracers(dt);
      this.updateTexts(dt);
      this.updateFX(dt);
      this.updateAmbient(dt);
      this.updateCombo(dt);
      this.updateViewmodel(dt);
      this.drawRadar();
    } else {
      /* paused / gameover: hold frame, subtle idle */
      this.updateViewmodel(0);
    }

    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    this.container.removeEventListener("contextmenu", this.onCtx);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
