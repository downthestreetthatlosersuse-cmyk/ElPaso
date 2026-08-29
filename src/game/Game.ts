import * as THREE from "three";
import { sfx } from "./audio";
import { hud } from "./store";

/* internal render resolution — chunky 480i-style pixels */
const W = 640;
const H = 360;
const WORLD_R = 92;

type EnemyKind = "grunt" | "brute" | "spitter";

interface WeaponDef {
  name: string;
  dmg: number;
  rate: number;
  magSize: number;
  spread: number;
  reloadTime: number;
  recoil: number;
  kick: number;
  sound: () => void;
}

const WEAPONS: WeaponDef[] = [
  { name: "RATTLER SMG", dmg: 11, rate: 0.095, magSize: 32, spread: 0.022, reloadTime: 1.5, recoil: 0.34, kick: 0.016, sound: () => sfx.smg() },
  { name: "JUDGE MAGNUM", dmg: 62, rate: 0.42, magSize: 6, spread: 0.005, reloadTime: 1.9, recoil: 1.0, kick: 0.055, sound: () => sfx.magnum() },
];

const ENEMY_DEFS: Record<
  EnemyKind,
  { hp: number; speed: number; dmg: number; score: number; radius: number }
> = {
  grunt: { hp: 26, speed: 3.3, dmg: 8, score: 100, radius: 0.7 },
  spitter: { hp: 44, speed: 2.7, dmg: 12, score: 150, radius: 0.75 },
  brute: { hp: 130, speed: 1.7, dmg: 22, score: 300, radius: 1.2 },
};

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
  parts: { body: THREE.Object3D; armL?: THREE.Object3D; armR?: THREE.Object3D; sac?: THREE.Object3D };
  hitMeshes: THREE.Mesh[];
}

interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  active: boolean;
}

interface Pickup {
  group: THREE.Group;
  kind: "health" | "ammo";
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
  private mags = [32, 6];
  private reserves = [160, 36];
  private shootCd = 0;
  private reloading = false;
  private reloadT = 0;
  private recoil = 0;
  private flashT = 0;
  private switchT = 0;
  private dryT = 0;

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
  private mat: Record<string, THREE.MeshLambertMaterial> = {};
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

    this.initShared();
    this.buildSky();
    this.buildGround();
    this.buildTown();
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
    this.mat.sand = this.lambert(0xc4834b);
    this.mat.sandDark = this.lambert(0xb5743f);
    this.mat.asphalt = this.lambert(0x3a3a46);
    this.mat.white = this.lambert(0xe8ddc8);
    this.mat.dark = this.lambert(0x1c130e);
    this.mat.concrete = this.lambert(0x9a9aa4);
    this.mat.rust = this.lambert(0x8a5a4a);
    this.mat.cactus = this.lambert(0x2e7d32);
    this.mat.rock = this.lambert(0x5a4a60);
    this.mat.wood = this.lambert(0x9a6a30);
    this.mat.metal = this.lambert(0x4a4e58);
    this.mat.mountain = this.lambert(0x3b1f4e);
    this.mat.alienGreen = this.lambert(0x6fdd2f);
    this.mat.alienGreenD = this.lambert(0x47961d);
    this.mat.brutePurple = this.lambert(0x7b2fbe);
    this.mat.bruteDark = this.lambert(0x4e1d7a);
    this.mat.spitter = this.lambert(0xe07028);
    this.mat.spitterD = this.lambert(0x9c4a18);
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

    this.adobeMats = [0xd8a061, 0xc98b52, 0xbf7848, 0xe0b47a].map((c) => this.lambert(c));

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
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(11, 18), this.lambert(0xd8b078));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.018, -30);
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
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.adobeMats[ci]);
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

    this.guns = [smg, mag];
    this.gunGroup.add(smg, mag);
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
  }

  /* ------------------------------------------------ entities */

  private buildEnemy(kind: EnemyKind, x: number, z: number): Enemy {
    const def = ENEMY_DEFS[kind];
    const g = new THREE.Group();
    const hitMeshes: THREE.Mesh[] = [];
    const parts: Enemy["parts"] = { body: g };

    const addShadow = (s: number) => {
      const sh = new THREE.Mesh(this.geo.shadow, this.basic.shadow);
      sh.rotation.x = -Math.PI / 2;
      sh.position.y = 0.03;
      sh.scale.set(s, s, s);
      g.add(sh);
    };

    if (kind === "grunt") {
      const body = new THREE.Mesh(this.geo.gruntBody, this.mat.alienGreen);
      body.position.y = 0.95;
      body.scale.set(1, 1.25, 0.9);
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
        if (s === -1) parts.armL = arm;
        else parts.armR = arm;
      }
      parts.body = body;
      addShadow(1);
    } else if (kind === "brute") {
      const body = new THREE.Mesh(this.geo.bruteBody, this.mat.brutePurple);
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
        if (s === -1) parts.armL = fist;
        else parts.armR = fist;
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
      parts.body = body;
      addShadow(1.1);
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
    };
    for (const m of hitMeshes) m.userData.e = e;
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.hitList.push(...hitMeshes);
    this.enemies.push(e);
    return e;
  }

  private spawnEnemy(kind: EnemyKind) {
    const a = rand(0, Math.PI * 2);
    const r = rand(38, 52);
    const x = Math.max(-WORLD_R, Math.min(WORLD_R, this.pos.x + Math.cos(a) * r));
    const z = Math.max(-WORLD_R + 4, Math.min(WORLD_R, this.pos.z + Math.sin(a) * r));
    const e = this.buildEnemy(kind, x, z);
    const wmul = 1 + (this.wave - 1) * 0.09;
    e.hp = Math.round(ENEMY_DEFS[kind].hp * wmul);
    e.speed = ENEMY_DEFS[kind].speed * (1 + Math.min(this.wave * 0.03, 0.45));
  }

  private spawnAttractCrowd() {
    for (let i = 0; i < 5; i++) this.buildEnemy("grunt", rand(-30, 30), rand(-30, 30));
    this.buildEnemy("brute", 18, -20);
    this.buildEnemy("spitter", -20, -16);
    this.buildEnemy("spitter", 12, 22);
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
    this.burst(this.v1.set(p.x, 1.2, p.z), 0x6fdd2f, e.kind === "brute" ? 22 : 14, 5.5);
    if (e.kind === "brute") sfx.bruteDie();
    else sfx.alienDie();
    if (byPlayer) {
      const sc = e.scoreV;
      const score = hud.get().score + sc;
      const kills = hud.get().kills + 1;
      hud.set({ score, kills });
      this.showText(p.x, 2.2, p.z, `+${sc}`, e.kind === "brute" ? "#ffd23f" : "#8dff3a");
      hud.feed(`${pick(KILL_LINES[e.kind])}  +${sc}`, "#8dff3a");
      if (Math.random() < 0.3) this.dropPickup(p.x, p.z);
    }
    this.hudSync();
  }

  private damageEnemy(e: Enemy, dmg: number, point: THREE.Vector3) {
    if (e.dying) return;
    e.hp -= dmg;
    sfx.squish();
    hud.hit();
    this.burst(point, 0x79e836, 6, 3.5);
    /* knockback */
    const kb = e.kind === "brute" ? 0.04 : 0.16;
    this.v2.copy(point).sub(this.camera.position);
    this.v2.y = 0;
    if (this.v2.lengthSq() > 0.001) {
      this.v2.normalize().multiplyScalar(kb);
      e.group.position.add(this.v2);
    }
    if (e.hp <= 0) this.killEnemy(e, true);
  }

  private dropPickup(x: number, z: number) {
    const wantHealth = this.health < 75;
    const kind: "health" | "ammo" = Math.random() < (wantHealth ? 0.6 : 0.3) ? "health" : "ammo";
    const g = new THREE.Group();
    if (kind === "health") {
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

  private fireTracer(from: THREE.Vector3, to: THREE.Vector3) {
    let tr = this.tracers.find((t) => t.life <= 0);
    if (!tr) tr = this.tracers[0];
    const mid = this.v2.copy(from).add(to).multiplyScalar(0.5);
    tr.mesh.position.copy(mid);
    tr.mesh.lookAt(to);
    tr.mesh.scale.set(1, 1, Math.max(0.5, from.distanceTo(to)));
    tr.mesh.visible = true;
    tr.mat.opacity = 0.9;
    tr.life = 0.07;
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
    this.recoil = Math.min(1.2, this.recoil + w.recoil * 0.55);
    this.flashT = 0.045;
    this.gunLight.intensity = this.weaponIdx === 1 ? 46 : 28;
    this.shake += w.kick;
    w.sound();
    this.casing();
    document.documentElement.style.setProperty("--spr", `${Math.round(6 + this.recoil * 12)}px`);

    /* hitscan */
    const spread = w.spread * (1 + this.recoil * 1.4);
    this.camera.getWorldDirection(this.v1);
    const right = this.v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = this.v3.set(0, 1, 0);
    this.v1.addScaledVector(right, (Math.random() - 0.5) * 2 * spread).addScaledVector(up, (Math.random() - 0.5) * 2 * spread).normalize();
    this.raycaster.set(this.camera.position, this.v1);
    this.raycaster.far = 170;

    const gun = this.guns[this.weaponIdx];
    const muzzleLocal = this.weaponIdx === 1 ? this.v2.set(0, 0.03, -0.52) : this.v2.set(0, 0.01, -0.62);
    /* v2 reused — compute muzzle before raycast results need v2... do it now */
    this.muzzleV.copy(muzzleLocal).applyMatrix4(gun.matrixWorld);

    const targets: THREE.Object3D[] = [...this.hitList, ...this.envMeshes];
    const hits = this.raycaster.intersectObjects(targets, false);
    let end: THREE.Vector3;
    if (hits.length > 0) {
      const h = hits[0];
      end = h.point.clone();
      const e = h.object.userData.e as Enemy | undefined;
      if (e) this.damageEnemy(e, w.dmg, h.point);
      else this.burst(h.point, 0xffb050, 4, 2.5);
    } else {
      end = this.camera.position.clone().addScaledVector(this.v1, 120);
    }
    this.fireTracer(this.muzzleV.clone(), end);
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
    if (i === this.weaponIdx || i < 0 || i > 1) return;
    this.weaponIdx = i;
    this.reloading = false;
    this.switchT = 0.22;
    this.guns[0].visible = i === 0;
    this.guns[1].visible = i === 1;
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
    this.queue = q;
    this.spawnT = 0.6;
    this.waveBreak = -1;
    hud.banner(`WAVE ${n}`, pick(WAVE_LINES));
    sfx.wave();
    this.hudSync();
  }

  private updateWaves(dt: number) {
    if (this.queue.length > 0) {
      this.spawnT -= dt;
      const alive = this.enemies.filter((e) => !e.dying).length;
      if (this.spawnT <= 0 && alive < Math.min(10 + this.wave, 16)) {
        const kind = this.queue.pop()!;
        this.spawnEnemy(kind);
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
    const speed = sprint ? 9 : 6;
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
    const accel = this.onGround ? 14 : 4;
    this.vel.x += (wx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wz - this.vel.z) * Math.min(1, accel * dt);
    this.vel.y -= 22 * dt;
    if (this.keys.has("Space") && this.onGround) {
      this.vel.y = 8.2;
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
      if (!this.onGround && this.vel.y < -6) sfx.land();
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }

    const horiz = Math.hypot(this.vel.x, this.vel.z);
    this.bobT += horiz * dt * 1.7;
    const bobAmp = this.onGround ? Math.min(horiz / 6, 1) : 0;
    const eyeY = 1.7 + Math.sin(this.bobT * 2) * 0.05 * bobAmp;

    this.shake = Math.max(0, this.shake - dt * 2.6);
    const sh = this.shake * this.shake * 0.35;
    this.camera.position.set(
      this.pos.x + rand(-sh, sh),
      eyeY + rand(-sh, sh),
      this.pos.z + rand(-sh, sh)
    );
    this.camera.rotation.set(this.pitch + rand(-sh, sh) * 0.4, this.yaw, rand(-sh, sh) * 0.3);

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
    let rotZ = Math.sin(this.bobT) * Math.min(horiz / 6, 1) * 0.03;
    let rotX = this.recoil * (this.weaponIdx === 1 ? 0.3 : 0.12);
    let z = -this.recoil * 0.1;
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
    gun.position.set(0, y, 0);
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
        const t = e.dieT / 0.28;
        e.group.rotation.y += dt * 11;
        const s = Math.max(0.001, 1 - t);
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
        if (e.kind === "grunt" || e.kind === "brute") {
          if (dist > e.radius + 0.5) {
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
              this.damagePlayer(e.dmg, e.kind === "brute" ? "BRUTE" : "ALIEN GRUNT");
            }
          } else {
            e.parts.body.position.z = 0;
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
      const baseY = e.kind === "brute" ? 0 : Math.abs(Math.sin(e.bobT)) * 0.12;
      e.group.position.y = baseY;
      if (e.parts.armL) e.parts.armL.rotation.x = Math.sin(e.bobT) * 0.7;
      if (e.parts.armR) e.parts.armR.rotation.x = -Math.sin(e.bobT) * 0.7;
    }
  }

  private fireProjectile(from: THREE.Vector3, dmg: number) {
    const p = this.projectiles.find((p) => !p.active);
    if (!p) return;
    p.active = true;
    p.life = 4;
    p.mesh.visible = true;
    p.mesh.position.set(from.x, 1.6, from.z);
    this.v1.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    const d = this.v1.length() || 1;
    this.v1.normalize();
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
        } else {
          this.reserves[0] = Math.min(240, this.reserves[0] + 48);
          this.reserves[1] = Math.min(48, this.reserves[1] + 9);
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
        t.mat.opacity = Math.max(0, (t.life / 0.07) * 0.9);
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
      g.fillStyle = e.kind === "brute" ? "#c05aff" : e.kind === "spitter" ? "#ff9a2a" : "#8dff3a";
      const sz = e.kind === "brute" ? 4 : 3;
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

  private hudSync() {
    hud.set({
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
    this.pos.set(0, 0, 16);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.weaponIdx = 0;
    this.mags = [32, 6];
    this.reserves = [160, 36];
    this.shootCd = 0;
    this.reloading = false;
    this.recoil = 0;
    this.mouseDown = false;
    this.wave = 0;
    this.queue = [];
    this.waveBreak = -1;
    this.guns[0].visible = true;
    this.guns[1].visible = false;
    this.hudSync();
    hud.set({ score: 0, kills: 0, feed: [] });
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
    this.switchWeapon((this.weaponIdx + (e.deltaY > 0 ? 1 : -1) + 2) % 2);
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
    const dt = Math.min(0.05, this.clock.getDelta());

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
    } else if (this.state === "playing") {
      this.updatePlayer(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updatePickups(dt);
      this.updateWaves(dt);
      this.updateParticles(dt);
      this.updateTracers(dt);
      this.updateTexts(dt);
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
