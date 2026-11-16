// Public Office opening view: the whole building as a pixel-art skyscraper in a small 2.5D city.
// One floor per band, one window per project room, lit while agents are inside (people walk past
// working windows). The sky follows the viewer's clock: sunrise, day, sunset, night.
// Tapping a floor calls onPick; the page then shows that floor's rooms.
//
// Drawing is split in two: everything that does not move (far skyline, neighbours, the tower shell,
// the street) is painted into offscreen canvases and repainted only when the layout or the light
// changes; each frame draws the sky, blits those layers and adds what moves on top.

export interface TowerRoom { agents: number; working: number }
export interface TowerFloor { name: string; rooms: TowerRoom[]; agents: number; working: number }
export interface TowerBrand { name: string; logo?: string }

const WIN_W = 12;
const WIN_H = 13;
const GAP = 4;
const FLOOR_H = 20;
const COLS = 8;
const SHAFT = 16;
const BODY_W = COLS * (WIN_W + GAP) + GAP + SHAFT;
const DEPTH = 32; // side face width; it rises DEPTH/2 towards the back
const SPIRE_H = 52; // roof face, penthouse, mast
const CROWN_H = 40;
const LOBBY_H = 34;
const STREET_H = 46;
const FLAG_W = 36;
const FLAG_H = 24;
const FPS = 12;
const DOOR = 66; // lobby door centre, from the tower's left edge
const BD = 16; // neighbour depth, front row

type RGB = [number, number, number];
type Col = RGB | string;
type Ctx = CanvasRenderingContext2D;

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const css = (c: RGB) => `rgb(${c.map(Math.round).join(',')})`;
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const asRgb = (c: Col): RGB => (typeof c === 'string' ? rgb(c) : c);

const NIGHT: RGB = [11, 16, 48];
const WARM: RGB = [255, 140, 70];
const SHADE: RGB = [30, 22, 84];
const WHITE: RGB = [255, 255, 255];
const NEON = '#d08cff';
const NEON_HI = '#f1dcff';
const TEAL = '#5ff5e0';
const LAMP = '#ffe9a0';
const GLASS_TOP = rgb('#34d6bd');
const GLASS_BOT = rgb('#1493a3');
const NAVY = rgb('#232a66');

// 3x5 pixel font, rows top to bottom, so signs stay sharp at any zoom.
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '.': '000000000000010', '-': '000000111000000',
};

// Sky by hour: [hour, top colour, horizon colour, darkness 0..1]
const SKY: Array<[number, string, string, number]> = [
  [0, '#070b22', '#1c2150', 1],
  [5.3, '#070b22', '#1c2150', 1],
  [6.4, '#3d3f88', '#ff9e6b', 0.5],
  [7.8, '#2f8ff0', '#c6ecff', 0],
  [17.2, '#2f8ff0', '#c6ecff', 0],
  [18.6, '#3b3878', '#ff7a45', 0.5],
  [19.9, '#070b22', '#1c2150', 1],
  [24, '#070b22', '#1c2150', 1],
];

function skyAt(h: number): { top: RGB; low: RGB; dark: number } {
  const i = Math.max(0, SKY.findIndex(([k]) => k > h) - 1);
  const [h0, t0, l0, d0] = SKY[i]!;
  const [h1, t1, l1, d1] = SKY[i + 1] ?? SKY[i]!;
  const k = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  return { top: mix(rgb(t0), rgb(t1), k), low: mix(rgb(l0), rgb(l1), k), dark: d0 + (d1 - d0) * k };
}

/**
 * The light at one hour. Fronts face the viewer, sides face right: the morning sun (left) leaves
 * sides in shade, the evening sun (right) lights them warm. Lights (windows, neon) use raw colours.
 */
interface Light {
  top: RGB; low: RGB; dark: number; warm: number; sun: number;
  tone: (c: Col) => string; side: (c: Col) => string; roof: (c: Col) => string; haze: (c: Col) => string;
}

function lightAt(h: number): Light {
  const { top, low, dark } = skyAt(h);
  const warm = 1 - Math.min(1, Math.abs(dark - 0.5) * 2);
  const sun = h >= 5.8 && h <= 19.2 ? (h - 5.8) / 13.4 : 0.3;
  const memo = (fn: (c: RGB) => RGB) => {
    const cache = new Map<string, string>();
    return (c: Col) => {
      if (typeof c !== 'string') return css(fn(c));
      let v = cache.get(c);
      if (!v) cache.set(c, (v = css(fn(rgb(c)))));
      return v;
    };
  };
  const front = (c: RGB) => mix(mix(c, WARM, warm * (0.34 - 0.22 * sun)), NIGHT, dark * 0.6);
  return {
    top, low, dark, warm, sun,
    tone: memo(front),
    side: memo((c) => mix(mix(mix(c, SHADE, 0.46 - 0.3 * sun), WARM, warm * (0.06 + 0.4 * sun)), NIGHT, dark * 0.6)),
    roof: memo((c) => front(mix(c, WHITE, 0.34))),
    haze: memo((c) => front(mix(c, low, 0.46))),
  };
}

/** Pixel drawing helpers bound to one canvas. */
function pen(c: Ctx) {
  const px = (x: number, y: number, w: number, hh: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), w, hh);
  };
  const disc = (cx: number, cy: number, rx: number, ry: number, col: string) => {
    c.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry || 1))));
      c.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
    }
  };
  /** Pixel text centred on cx; a soft halo first when glow is set. */
  const text = (str: string, cx: number, y: number, col: string, k = 1, glow?: string) => {
    const chars = [...str.toUpperCase()];
    const w = chars.length * 4 * k - k;
    const x0 = Math.round(cx - w / 2);
    const put = (dx: number, dy: number, colour: string) => chars.forEach((ch, i) => {
      const g = GLYPHS[ch];
      if (!g) return;
      for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1') px(x0 + (i * 4 + q) * k + dx, y + r * k + dy, k, k, colour);
    });
    if (glow) {
      const a = c.globalAlpha;
      c.globalAlpha = a * 0.4;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) put(dx, dy, glow);
      c.globalAlpha = a;
    }
    put(0, 0, col);
    return w;
  };
  /** A strip on a side face: w columns starting j0 columns from the face's left edge, rising one row every two. */
  const skew = (edge: number, j0: number, y: number, w: number, hh: number, col: string) => {
    for (let q = 0; q < w; q++) px(edge + j0 + q, y - ((j0 + q) >> 1), 1, hh, col);
  };
  /** Front face with a lit rim, a side face towards the back, a lighter top face. */
  const box = (L: Light, x: number, y: number, w: number, hh: number, face: Col, d: number, haze = false) => {
    const f = asRgb(face);
    const fr = haze ? L.haze : L.tone;
    const hz = (col: RGB) => (haze ? mix(col, L.low, 0.46) : col);
    skew(x + w, 0, y, d, hh, L.side(hz(f)));
    for (let j = 0; j < Math.ceil(d / 2); j++) px(x + j * 2 + 1, y - j - 1, w, 1, L.roof(hz(f)));
    px(x, y, w, hh, fr(f));
    px(x, y, w, 1, fr(mix(f, WHITE, 0.3)));
    px(x, y + 1, 1, hh - 1, fr(mix(f, WHITE, 0.16)));
    px(x + w - 1, y + 1, 1, hh - 1, fr(mix(f, SHADE, 0.14)));
  };
  return { px, disc, text, skew, box };
}

type Kind = 'slab' | 'step' | 'classic' | 'glass' | 'shop';
type Roof = 'racks' | 'dish' | 'tank' | 'ac' | 'garden' | 'pad';
/** A neighbour building. Back-row blocks fade into the haze. */
interface Block { x: number; w: number; h: number; face: string; back: boolean; kind: Kind; sign?: string; signCol?: string; board: boolean; roof: Roof; seed: number }

const FACES = ['#ffc533', '#ff7a4d', '#35c46f', '#f6e6c4', '#ff5f93', '#8f6bff', '#45a8f5', '#ff9a1f', '#e9edf5', '#20c0c9'];
const SIGNS: Array<[string, string]> = [['SHIP', '#ff5a4d'], ['BUILD', '#4dffa0'], ['TEST', '#ffffff'], ['DEPLOY', '#7fd0ff'], ['CODE', '#ffd84d'], ['MERGE', '#d9a6ff'], ['OPEN', '#ff8ad0'], ['24-7', '#ffb347']];
const KINDS: Kind[] = ['slab', 'step', 'shop', 'glass', 'slab', 'classic', 'step', 'shop', 'glass', 'slab'];
const ROOFS: Roof[] = ['racks', 'dish', 'tank', 'ac', 'garden', 'pad', 'racks'];
const SHIRTS = ['#e2483d', '#4670cf', '#f2c94c', '#3fae6b', '#9b59d0', '#f4f4f6', '#ff8ad0', '#20c0c9'];
const SKINS = ['#e0b089', '#a8754f', '#6b4630'];

export class Tower {
  readonly el: HTMLElement;
  brand: TowerBrand | null = null;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private far = document.createElement('canvas');
  private city = document.createElement('canvas');
  private key = ''; // what the offscreen layers were painted for
  private light = lightAt(12);
  private leds: Array<[number, number, string, string, number]> = []; // x, y, on, off, seed
  private labels = document.createElement('div');
  private hint = document.createElement('div');
  private flag = document.createElement('canvas');
  private logo: HTMLImageElement | null = null;
  private floors: TowerFloor[] = [];
  private scale = 3;
  private ox = 0; // tower front face left, in canvas pixels
  private oy = 0; // top of the mast
  private raf = 0;
  private last = 0;
  private hover = -1;
  private stars: Array<[number, number, number]> = [];
  private blocks: Block[] = [];
  private trees: number[] = [];

  constructor(private onPick: (index: number) => void) {
    this.el = document.createElement('section');
    this.el.className = 'tower';
    this.labels.className = 'tower__labels';
    this.hint.className = 'tower__hint';
    this.hint.textContent = 'Tap a floor to go in';
    this.flag.width = FLAG_W;
    this.flag.height = FLAG_H;
    this.el.append(this.canvas, this.labels, this.hint);
    addEventListener('resize', () => this.layout());
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(floors: TowerFloor[]): void {
    this.floors = floors;
    this.el.hidden = false;
    this.el.classList.remove('tower--leaving');
    if (this.brand?.logo && this.logo?.src !== this.brand.logo) {
      this.logo = new Image();
      this.logo.onload = () => {
        this.paintFlag();
        this.key = '';
      };
      this.logo.src = this.brand.logo;
    }
    this.paintFlag();
    this.layout();
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Zooms toward the picked floor and fades out. */
  leave(index: number): void {
    const b = this.labels.children[index] as HTMLElement | undefined;
    if (b) this.el.style.transformOrigin = `${(this.ox + BODY_W / 2) * this.scale}px ${b.offsetTop}px`;
    this.el.classList.add('tower--leaving');
    setTimeout(() => {
      this.el.hidden = true;
      this.el.classList.remove('tower--leaving');
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }, 650);
  }

  private logoReady(): boolean {
    return !!this.logo?.complete && this.logo.naturalWidth > 0;
  }

  /** The flag cloth: brand blue with the logo, drawn once and waved column by column each frame. */
  private paintFlag(): void {
    const f = this.flag.getContext('2d')!;
    f.fillStyle = '#4670cf';
    f.fillRect(0, 0, FLAG_W, FLAG_H);
    f.fillStyle = '#5b86e6';
    f.fillRect(0, 0, FLAG_W, 3);
    f.fillStyle = '#3a5fb4';
    f.fillRect(0, FLAG_H - 3, FLAG_W, 3);
    if (this.logoReady()) f.drawImage(this.logo!, (FLAG_W - 20) / 2, (FLAG_H - 20) / 2, 20, 20);
  }

  private height(): number {
    return SPIRE_H + CROWN_H + this.floors.length * FLOOR_H + LOBBY_H;
  }

  private layout(): void {
    const vw = innerWidth;
    const vh = innerHeight;
    const narrow = vw < 600;
    const labelW = narrow ? 48 : 210; // phones: number and count only
    const fitH = (vh - (narrow ? 130 : 70)) / (this.height() + STREET_H);
    const fitW = (vw - labelW - 24) / (BODY_W + DEPTH);
    const fit = Math.min(fitH, fitW);
    // whole-pixel zoom keeps pixels even; below 2x (phones) quarter steps keep the tower readable
    this.scale = fit >= 2 ? Math.floor(fit) : Math.max(1, Math.floor(fit * 4) / 4);
    const s = this.scale;
    this.canvas.width = Math.ceil(vw / s);
    this.canvas.height = Math.ceil(vh / s);
    this.canvas.style.width = `${this.canvas.width * s}px`;
    this.canvas.style.height = `${this.canvas.height * s}px`;
    const W = this.canvas.width;
    for (const cv of [this.far, this.city]) {
      cv.width = W;
      cv.height = this.canvas.height;
    }
    this.key = '';
    const groupW = (BODY_W + DEPTH) * s + 16 + labelW;
    this.ox = Math.round(((vw - groupW) / 2) / s);
    const ground = this.canvas.height - STREET_H - Math.round((narrow ? 80 : 6) / s);
    this.oy = ground - this.height();
    this.stars = Array.from({ length: 90 }, (_, i) => [hash(i) * W, hash(i + 99) * ground * 0.8, hash(i + 7)]);
    // neighbours fill the width: a hazy back row, then a coloured front row; the tower's spot stays clear
    const th = this.height() - SPIRE_H;
    const blocks: Block[] = [];
    const row = (back: boolean, seed: number) => {
      const d = back ? 10 : BD;
      const clearR = this.ox + BODY_W + DEPTH + (back ? 2 : 8);
      let x = -14 + Math.floor(hash(seed) * 20);
      let n = 0;
      while (x < W + 10) {
        const kind: Kind = back ? 'slab' : KINDS[Math.floor(hash(seed + n * 17) * KINDS.length)]!;
        let w = (kind === 'shop' || kind === 'classic' ? 46 : 34) + Math.floor(hash(seed + n * 3) * 20);
        if (x < clearR && x + w + d + 4 > this.ox) {
          const room = this.ox - d - 4 - x;
          if (room < 30) {
            x = clearR;
            continue;
          }
          w = room;
        }
        const k = hash(seed + n * 7);
        let h = back ? th * (0.52 + k * 0.42) : th * (0.3 + k * 0.34);
        if (kind === 'shop') h = 40 + k * 12;
        if (kind === 'classic') h = 56 + k * 12;
        const sign = !back && kind !== 'classic' && (kind === 'shop' || hash(seed + n * 11) > 0.15) ? SIGNS[(n * 3 + seed) % SIGNS.length] : undefined;
        blocks.push({
          x, w, h: Math.round(Math.max(back ? 70 : 40, h)), back, kind, face: FACES[(n * 3 + seed) % FACES.length]!,
          sign: sign?.[0], signCol: sign?.[1], board: kind !== 'step',
          roof: ROOFS[Math.floor(hash(seed + n * 13) * ROOFS.length)]!, seed: seed + n * 31,
        });
        x += w + (back ? 4 : d + 2) + Math.floor(hash(seed + n * 5) * 8);
        n++;
      }
    };
    row(true, 3);
    row(false, 17);
    this.blocks = blocks;
    this.trees = [];
    for (let x = 8; x < W; x += 22 + Math.floor(hash(x) * 14)) if (Math.abs(x - (this.ox + DOOR)) > 30) this.trees.push(x);
    // labels: one card per floor, top floor first
    this.labels.replaceChildren();
    this.labels.style.left = `${(this.ox + BODY_W + DEPTH) * s + 16}px`;
    this.floors.forEach((f, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tower__floor';
      b.style.top = `${(this.floorY(i) + FLOOR_H / 2) * s}px`;
      const num = document.createElement('span');
      num.className = 'tower__n';
      num.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'tower__name';
      name.textContent = f.name;
      const count = document.createElement('span');
      count.className = 'tower__count';
      count.textContent = f.agents ? `${f.agents}` : '';
      if (f.working) count.classList.add('tower__count--busy');
      b.append(num, name, count);
      b.title = `${f.name}: ${f.agents} ${f.agents === 1 ? 'agent' : 'agents'}, ${f.working} working`;
      b.onmouseenter = () => (this.hover = i);
      b.onmouseleave = () => (this.hover = -1);
      b.onclick = () => this.onPick(i);
      this.labels.append(b);
    });
    const floorAt = (e: MouseEvent) => {
      const x = e.offsetX / s;
      const y = e.offsetY / s;
      if (x < this.ox || x > this.ox + BODY_W + DEPTH) return -1;
      return this.floors.findIndex((_, k) => y >= this.floorY(k) && y < this.floorY(k) + FLOOR_H);
    };
    this.canvas.onclick = (e) => {
      const i = floorAt(e);
      if (i >= 0) this.onPick(i);
    };
    this.canvas.onmousemove = (e) => {
      this.hover = floorAt(e);
      this.canvas.style.cursor = this.hover >= 0 ? 'pointer' : 'default';
    };
  }

  /** Top of floor i (floor 1 sits on the lobby). */
  private floorY(i: number): number {
    return this.oy + SPIRE_H + CROWN_H + (this.floors.length - 1 - i) * FLOOR_H;
  }

  private frame(t: number): void {
    this.raf = requestAnimationFrame((n) => this.frame(n));
    if (t - this.last < 1000 / FPS) return;
    this.last = t;
    this.draw(t / 1000);
  }

  /** Local hour as a fraction; the prototype can pin it with window.__PROTO_HOUR__. */
  private hour(): number {
    const pinned = (window as { __PROTO_HOUR__?: number }).__PROTO_HOUR__;
    if (typeof pinned === 'number') return pinned;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }

  /** Paints what does not move: far skyline, neighbours, the tower shell, the street. */
  private paint(L: Light): void {
    const W = this.city.width;
    const H = this.city.height;
    const { dark } = L;
    const lit = dark > 0.35;
    const ground = this.oy + this.height();
    const sdir = L.sun < 0.5 ? 1 : -1; // shadows fall away from the sun
    this.leds = [];
    const led = (x: number, y: number, on: string, off: string) => this.leds.push([Math.round(x), Math.round(y), on, off, this.leds.length]);

    // ---- far skyline: two haze layers, windows only after dark ----
    const fc = this.far.getContext('2d')!;
    fc.clearRect(0, 0, W, H);
    const F = pen(fc);
    for (const [step, base, span, k, seed] of [[13, 62, 78, 0.22, 31], [10, 28, 58, 0.42, 77]] as const) {
      const col = css(mix(mix(L.low, [70, 96, 160], k), NIGHT, dark * 0.45));
      for (let i = 0, x = -3; x < W; i++, x += step) {
        const hh = base + Math.floor(hash(i + seed) * span);
        F.px(x, ground - hh, step, hh, col);
        if (hash(i * 3 + seed) > 0.6) F.px(x + 2, ground - hh - 4, step - 4, 4, col);
        if (hash(i * 5 + seed) > 0.82) F.px(x + (step >> 1), ground - hh - 12, 1, 12, col);
        if (dark > 0.4) for (let y = ground - hh + 4; y < ground - 4; y += 5) if (hash(i * 13 + y + seed) > 0.78) F.px(x + 2 + Math.floor(hash(y + i) * (step - 5)), y, 2, 2, k < 0.3 ? '#a98a55' : '#e8b45a');
      }
    }

    const c = this.city.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    const P = pen(c);
    const { px, disc, text, skew } = P;
    const box = (x: number, y: number, w: number, hh: number, face: Col, d: number, haze = false) => P.box(L, x, y, w, hh, face, d, haze);
    const alpha = (a: number, fn: () => void) => {
      c.globalAlpha = a;
      fn();
      c.globalAlpha = 1;
    };
    /** A soft parallelogram on the ground, leaning away from the sun. */
    const shadow = (x: number, w: number, len: number) => alpha(0.2, () => {
      for (let j = 0; j < len; j++) px(x + (sdir > 0 ? j * 2 : -j * 2), ground + j, w, 1, '#0a0a32');
    });

    // ---- street: plaza, road with a crosswalk, pavement, grass ----
    px(0, ground, W, 11, L.tone('#ece4d2'));
    for (let x = 0; x < W; x += 10) px(x, ground, 1, 11, L.tone('#d6cdb8'));
    px(0, ground + 5, W, 1, L.tone('#d6cdb8'));
    const dx0 = this.ox + DOOR;
    px(dx0 - 34, ground, 68, 11, L.tone('#f7efdc'));
    for (let k = 0; k < 9; k++) px(dx0 - 32 + k * 8, ground + 2 + (k % 2) * 4, 4, 3, L.tone(k % 2 ? '#c9b6ff' : '#9fe8dc'));
    px(0, ground + 11, W, 2, L.tone('#a39d8c'));
    px(0, ground + 13, W, 20, L.tone('#414556'));
    px(0, ground + 13, W, 1, L.tone('#2f3342'));
    for (let x = 3; x < W; x += 18) px(x, ground + 22, 9, 1, L.tone('#f2e6a0'));
    for (let k = 0; k < 7; k++) px(dx0 - 17 + k * 5, ground + 14, 3, 18, L.tone('#eeeef2'));
    px(0, ground + 33, W, 2, L.tone('#a39d8c'));
    px(0, ground + 35, W, 4, L.tone('#ece4d2'));
    for (let x = 5; x < W; x += 10) px(x, ground + 35, 1, 4, L.tone('#d6cdb8'));
    px(0, ground + 39, W, H - ground - 39, L.tone('#63d14a'));
    px(0, ground + 39, W, 1, L.tone('#8be86a'));
    for (let x = 4; x < W; x += 7) {
      const y = ground + 41 + Math.floor(hash(x) * Math.max(4, H - ground - 44));
      px(x, y, 3, 1, L.tone('#45a83a'));
      if (hash(x * 3) > 0.62) px(x + 1, y - 1, 1, 1, L.tone(['#ff8ad0', '#ffe14d', '#ffffff'][x % 3]!));
    }

    // ---- neighbours ----
    const windows = (b: Block, x: number, top: number, w: number, bottom: number, d: number) => {
      const fr = b.back ? L.haze : L.tone;
      const face = rgb(b.face);
      const n = Math.floor((w - 3) / 8);
      const start = x + Math.round((w - (n * 8 - 3)) / 2);
      for (let wy = top; wy + 7 < bottom; wy += 9) {
        for (let i = 0; i < n; i++) {
          const wx = start + i * 8;
          const on = lit && hash(wx * 7 + wy + b.seed) > 0.42;
          px(wx, wy, 5, 6, on ? (b.back ? '#c9a25a' : hash(wx + wy) > 0.8 ? '#bfe9ff' : '#ffd36b') : fr('#7fc4f2'));
          if (!on) {
            px(wx, wy, 5, 1, fr('#c8ecff'));
            px(wx, wy, 1, 6, fr('#c8ecff'));
          }
          px(wx, wy + 6, 5, 1, fr(mix(face, SHADE, 0.3)));
        }
        if (!b.back) for (const j of [3, 9]) skew(x + w, j, wy, 4, 6, lit && hash(wy * 3 + j + b.seed) > 0.5 ? '#d9a84f' : L.side(b.back ? mix(rgb('#5f9fd0'), L.low, 0.4) : '#5f9fd0'));
      }
      void d;
    };
    const racks = (x: number, base: number, n: number) => {
      for (let k = 0; k < n; k++) {
        box(x + k * 9, base - 8, 7, 8, '#30364a', 4);
        px(x + k * 9 + 1, base - 3, 5, 1, L.tone('#1c2030'));
        px(x + k * 9 + 1, base - 5, 5, 1, L.tone('#1c2030'));
        led(x + k * 9 + 1, base - 7, '#5cff8a', '#1f5a33');
        led(x + k * 9 + 3, base - 7, '#6bc8ff', '#244a66');
        led(x + k * 9 + 5, base - 7, '#ffb347', '#5a3d1c');
      }
    };
    const dish = (cx: number, base: number, r = 6) => {
      px(cx, base - 6, 1, 6, L.tone('#7d8496'));
      px(cx - 2, base, 5, 1, L.tone('#5a6072'));
      disc(cx, base - 7, r, Math.max(2, r >> 1), L.tone('#f4f6fa'));
      disc(cx + 1, base - 7, r - 2, Math.max(1, (r >> 1) - 1), L.tone('#b9c2d6'));
      px(cx + 1, base - 9, 1, 2, L.tone('#5a6072'));
      led(cx + 1, base - 10, '#ff4a4a', '#7a2a2a');
    };
    const tank = (x: number, base: number) => {
      for (const lx of [x + 1, x + 10]) px(lx, base - 5, 1, 5, L.tone('#5a3a24'));
      px(x + 2, base - 3, 8, 1, L.tone('#5a3a24'));
      box(x, base - 15, 12, 10, '#c47a45', 4);
      for (const by of [base - 12, base - 8]) px(x, by, 12, 1, L.tone('#8a5230'));
      for (let r = 0; r < 3; r++) px(x + 1 + r * 2, base - 16 - r, 13 - r * 4, 1, L.tone('#e9a15f'));
    };
    const ac = (x: number, base: number) => {
      box(x, base - 6, 10, 6, '#d5dbe6', 4);
      disc(x + 3, base - 3, 2, 2, L.tone('#6a7286'));
      px(x + 7, base - 5, 2, 1, L.tone('#8f98ad'));
      px(x + 7, base - 3, 2, 1, L.tone('#8f98ad'));
    };
    const board = (cx: number, base: number, word: string, col: string, maxW: number) => {
      const k = word.length * 8 + 6 <= maxW ? 2 : 1;
      const bw = word.length * 4 * k - k + 8;
      const bh = 5 * k + 6;
      const bx = Math.round(cx - bw / 2);
      const by = base - bh - 6;
      for (const lx of [bx + 3, bx + bw - 4]) px(lx, by + bh, 1, 6, L.tone('#6a7286'));
      px(bx + 3, by + bh + 3, bw - 6, 1, L.tone('#6a7286'));
      box(bx, by, bw, bh, '#161830', 3);
      px(bx, by, bw, 1, col);
      px(bx, by + bh - 1, bw, 1, col);
      px(bx, by, 1, bh, col);
      px(bx + bw - 1, by, 1, bh, col);
      text(word, cx, by + 3, col, k, col);
      alpha(0.1 + dark * 0.16, () => px(bx - 2, by - 2, bw + 4, bh + 4, col));
      alpha(dark * 0.22, () => {
        for (let rx = bx + 2; rx < bx + bw - 2; rx += 3) px(rx, ground + 14, 1, 6 + Math.floor(hash(rx) * 12), col); // neon on the wet road
      });
    };
    const roofTop = (b: Block, x: number, y: number, w: number) => {
      const base = y - 4;
      const cx = x + w / 2 + 5;
      if (b.sign && b.board) {
        board(cx, base, b.sign, b.signCol!, w + 10);
        return;
      }
      if (b.roof === 'racks') racks(x + 7, base, Math.max(1, Math.min(4, Math.floor((w - 8) / 9))));
      else if (b.roof === 'dish') {
        dish(cx - 6, base);
        ac(x + w - 12, base + 1);
      } else if (b.roof === 'tank') {
        tank(x + 8, base);
        if (w > 40) ac(x + w - 12, base + 1);
      } else if (b.roof === 'ac') {
        ac(x + 7, base + 1);
        ac(x + 20, base - 1);
        px(x + w - 6, base - 12, 1, 12, L.tone('#7d8496'));
        led(x + w - 6, base - 13, '#ff4a4a', '#7a2a2a');
      } else if (b.roof === 'garden') {
        for (let gx = x + 8; gx < x + w - 2; gx += 8) disc(gx, base - 2, 3, 3, L.tone(gx % 3 ? '#3fae4a' : '#6cd95a'));
        px(cx, base - 9, 1, 8, L.tone('#f4f4f6'));
        for (let r = 0; r < 3; r++) px(cx - 2 - r * 2, base - 11 + r, 5 + r * 4, 1, L.tone(r % 2 ? '#ffffff' : '#ff5a4d'));
      } else {
        disc(cx, base, Math.min(12, w / 2 - 6), 3, L.tone('#4a5068'));
        disc(cx, base, Math.min(9, w / 2 - 9), 2, L.tone('#ffd84d'));
        disc(cx, base, Math.min(8, w / 2 - 10), 1, L.tone('#4a5068'));
        text('H', cx, base - 2, L.tone('#ffffff'));
      }
    };
    const band = (b: Block, x: number, y: number, w: number) => {
      px(x + 3, y, w - 6, 11, L.tone('#161830'));
      px(x + 3, y + 10, w - 6, 1, b.signCol!);
      text(b.sign!, x + w / 2, y + 3, b.signCol!, 1, b.signCol);
      alpha(dark * 0.22, () => {
        for (let rx = x + 4; rx < x + w - 4; rx += 3) px(rx, ground + 14, 1, 6 + Math.floor(hash(rx) * 12), b.signCol!);
      });
    };
    const drawBlock = (b: Block) => {
      const y = ground - b.h;
      if (b.back) {
        box(b.x, y, b.w, b.h, b.face, 10, true);
        windows(b, b.x, y + 6, b.w, ground - 4, 10);
        if (hash(b.seed) > 0.5) {
          px(b.x + b.w / 2 + 3, y - 18, 1, 14, L.haze('#7d8496'));
          led(b.x + b.w / 2 + 3, y - 19, '#ff4a4a', '#7a2a2a');
        }
        return;
      }
      shadow(b.x + (sdir > 0 ? 6 : -4), b.w + BD, 6);
      if (b.kind === 'slab') {
        box(b.x, y, b.w, b.h, b.face, BD);
        const banded = !!b.sign && !b.board;
        if (banded) band(b, b.x, y + 5, b.w);
        windows(b, b.x, y + (banded ? 20 : 6), b.w, ground - 14, BD);
        // shop front
        px(b.x + 3, ground - 12, b.w - 6, 12, lit ? '#ffe1a0' : L.tone('#9fdcf5'));
        px(b.x + 3, ground - 12, b.w - 6, 1, L.tone(mix(rgb(b.face), SHADE, 0.4)));
        for (let mx = b.x + 3; mx < b.x + b.w - 3; mx += 9) px(mx, ground - 12, 1, 12, L.tone(mix(rgb(b.face), SHADE, 0.4)));
        roofTop(b, b.x, y, b.w);
      } else if (b.kind === 'step') {
        const h1 = Math.round(b.h * 0.66);
        const y1 = ground - h1;
        box(b.x, y1, b.w, h1, b.face, BD);
        if (b.sign) band(b, b.x, y1 + 5, b.w);
        windows(b, b.x, y1 + (b.sign ? 20 : 6), b.w, ground - 4, BD);
        const ux = b.x + 8;
        const uw = b.w - 12;
        const uy = y1 - 3 - (b.h - h1);
        const top = css(mix(rgb(b.face), WHITE, 0.25));
        box(ux, uy, uw, b.h - h1, top, 10);
        windows({ ...b, face: top, back: true }, ux, uy + 5, uw, y1 - 5, 10);
        px(ux, uy, uw, 2, L.tone(mix(rgb(b.face), SHADE, 0.25)));
        roofTop({ ...b, board: false }, ux - 3, uy + 1, uw);
      } else if (b.kind === 'glass') {
        const g = rgb(['#3d63e0', '#7a52e8', '#1f9fd6'][b.seed % 3]!);
        box(b.x, y, b.w, b.h, g, BD);
        for (let wy = y + 4; wy < ground - 4; wy += 7) {
          px(b.x + 2, wy, b.w - 4, 4, L.tone(mix(g, rgb('#bfe9ff'), 0.55)));
          px(b.x + 2, wy, b.w - 4, 1, L.tone(mix(g, WHITE, 0.75)));
          if (lit) for (let wx = b.x + 2; wx < b.x + b.w - 6; wx += 6) if (hash(wx * 5 + wy + b.seed) > 0.5) px(wx, wy, 5, 4, '#ffd98a');
          skew(b.x + b.w, 2, wy, BD - 4, 4, L.side(mix(g, rgb('#bfe9ff'), 0.4)));
        }
        for (let wx = b.x + 7; wx < b.x + b.w - 2; wx += 6) px(wx, y + 3, 1, b.h - 3, L.tone(g));
        alpha(0.16, () => {
          for (let j = 0; j < b.h - 2; j++) px(b.x + 3 + ((j * 0.5) % (b.w - 10)), ground - 2 - j, 5, 1, '#ffffff');
        });
        if (b.sign) roofTop(b, b.x, y, b.w);
        else {
          px(b.x + b.w / 2 + 6, y - 22, 1, 16, L.tone('#c3cad9'));
          px(b.x + b.w / 2 + 4, y - 12, 5, 1, L.tone('#8a93a8'));
          led(b.x + b.w / 2 + 6, y - 23, '#ff4a4a', '#7a2a2a');
          ac(b.x + 6, y - 3);
        }
      } else if (b.kind === 'classic') {
        const stone = rgb('#f3e7cf');
        box(b.x, y, b.w, b.h, stone, BD);
        px(b.x, y, b.w, 9, L.tone(mix(stone, SHADE, 0.12)));
        px(b.x, y + 9, b.w, 1, L.tone(mix(stone, SHADE, 0.35)));
        text(['BANK', 'HALL', 'MUSEUM'][b.seed % 3]!, b.x + b.w / 2, y + 2, L.tone('#6a5a44'));
        px(b.x + 2, y + 10, b.w - 4, b.h - 14, L.tone(mix(stone, SHADE, 0.34)));
        for (let cx = b.x + 3; cx + 3 <= b.x + b.w - 2; cx += 8) {
          px(cx, y + 10, 4, b.h - 14, L.tone(stone));
          px(cx, y + 10, 1, b.h - 14, L.tone(mix(stone, WHITE, 0.5)));
          px(cx - 1, y + 10, 6, 1, L.tone(mix(stone, WHITE, 0.3)));
          px(cx - 1, ground - 5, 6, 1, L.tone(mix(stone, WHITE, 0.3)));
          if (cx + 8 + 3 <= b.x + b.w - 2) px(cx + 5, y + 16, 2, b.h - 28, lit ? '#ffd36b' : L.tone('#6aa9d8'));
        }
        px(b.x + b.w / 2 - 4, ground - 16, 8, 12, L.tone('#5a3a24'));
        px(b.x + b.w / 2, ground - 16, 1, 12, L.tone('#3a2416'));
        px(b.x - 1, ground - 4, b.w + 2, 2, L.tone(mix(stone, WHITE, 0.3)));
        px(b.x - 2, ground - 2, b.w + 4, 2, L.tone(mix(stone, SHADE, 0.1)));
        // pediment
        const ph = 9;
        for (let r = 0; r < ph; r++) {
          const half = Math.round(((b.w / 2 + 1) * (r + 1)) / ph);
          px(b.x + b.w / 2 - half, y - ph + r, half * 2, 1, L.tone(mix(stone, WHITE, r === 0 ? 0.6 : 0.2)));
        }
        disc(b.x + b.w / 2, y - 3, 2, 2, L.tone(mix(stone, SHADE, 0.3)));
        px(b.x + b.w / 2, y - ph - 8, 1, 8, L.tone('#c3cad9'));
        px(b.x + b.w / 2 + 1, y - ph - 8, 5, 3, L.tone('#ff5a4d'));
      } else {
        // shop: brick, big front window under a striped awning, billboard on the roof
        box(b.x, y, b.w, b.h, b.face, BD);
        for (let by = y + 4; by < ground - 20; by += 4) px(b.x + 1, by, b.w - 2, 1, L.tone(mix(rgb(b.face), SHADE, 0.16)));
        windows(b, b.x, y + 6, b.w, ground - 22, BD);
        px(b.x + 3, ground - 15, b.w - 6, 15, lit ? '#ffe1a0' : L.tone('#a6e1f7'));
        px(b.x + 4, ground - 14, 2, 10, lit ? '#fff3cf' : L.tone('#e3f6ff'));
        for (let mx = b.x + 3 + Math.floor((b.w - 6) / 3); mx < b.x + b.w - 4; mx += Math.floor((b.w - 6) / 3)) px(mx, ground - 15, 1, 15, L.tone('#3a3f55'));
        px(b.x + b.w - 13, ground - 13, 7, 13, L.tone('#3a3f55'));
        px(b.x + b.w - 12, ground - 12, 5, 8, lit ? '#ffd36b' : L.tone('#7fc4f2'));
        for (let ax = b.x; ax < b.x + b.w + 2; ax += 4) {
          const stripe = (ax - b.x) % 8 === 0 ? b.signCol ?? '#ff5a4d' : '#ffffff';
          px(ax, ground - 21, Math.min(4, b.x + b.w + 2 - ax), 5, L.tone(stripe));
          px(ax, ground - 16, Math.min(4, b.x + b.w + 2 - ax), 1, L.tone(mix(rgb(stripe), SHADE, 0.3)));
        }
        px(b.x, ground - 22, b.w + 2, 1, L.tone('#ffffff'));
        roofTop(b, b.x, y, b.w);
      }
      alpha(0.22, () => px(b.x, ground - 1, b.w, 1, '#0a0a32'));
    };
    for (const b of this.blocks) if (b.back) drawBlock(b);
    for (const b of this.blocks) if (!b.back) drawBlock(b);

    // ---- the tower ----
    const n = this.floors.length;
    const x0 = this.ox;
    const edge = x0 + BODY_W;
    const crownY = this.oy + SPIRE_H;
    const bodyTop = crownY + CROWN_H;
    const lobbyY = bodyTop + n * FLOOR_H;
    // its shadow: on the ground, and across the walls of the neighbours on the far side from the sun
    shadow(x0 + (sdir > 0 ? 8 : -6), BODY_W + DEPTH, 11);
    c.globalCompositeOperation = 'source-atop';
    alpha(0.3, () => {
      for (let d = 0; d < 60; d++) {
        const top = bodyTop + 10 + d * 1.1;
        px(sdir > 0 ? edge + DEPTH + d : x0 - 1 - d, top, 1, Math.max(0, ground - top), '#100a3c');
      }
    });
    c.globalCompositeOperation = 'source-over';

    box(x0, crownY, BODY_W, ground - crownY, NAVY, DEPTH);
    // roof face: slate with a parapet line
    for (let j = 0; j < DEPTH / 2; j++) px(x0 + j * 2 + 1, crownY - j - 1, BODY_W, 1, L.tone(j === 0 || j === DEPTH / 2 - 1 ? '#aab4dc' : '#6f7ab0'));
    const neon = (x: number, y: number, w: number, hh: number, col = NEON) => {
      alpha(0.16 + dark * 0.2, () => px(x - 1, y - 1, w + 2, hh + 2, col));
      px(x, y, w, hh, col);
    };
    // glass floors, lighter towards the top
    for (let i = 0; i < n; i++) {
      const y = this.floorY(i);
      const g = mix(GLASS_BOT, GLASS_TOP, n > 1 ? i / (n - 1) : 1);
      px(x0, y, BODY_W, FLOOR_H, L.tone(g));
      skew(edge, 0, y, DEPTH, FLOOR_H, L.side(g));
    }
    c.save();
    c.beginPath();
    c.rect(x0, bodyTop, BODY_W, n * FLOOR_H);
    c.clip();
    alpha(0.16, () => {
      for (let k = -n * FLOOR_H; k < BODY_W; k += 34) for (let j = 0; j < n * FLOOR_H; j++) px(x0 + k + j * 0.6, lobbyY - j, k % 68 === 0 ? 7 : 3, 1, '#ffffff');
    });
    c.restore();
    // each floor's outside: navy piers between the windows, a navy spandrel with a teal neon line
    // and a lit ledge, the same on the side face (same materials as the crown and the lobby)
    for (let i = 0; i < n; i++) {
      const top = this.floorY(i);
      for (let kk = 0; kk <= COLS; kk++) px(x0 + kk * (WIN_W + GAP), top, GAP, FLOOR_H, L.tone('#2b3478'));
      for (let kk = 0; kk <= COLS; kk++) px(x0 + kk * (WIN_W + GAP), top, 1, FLOOR_H, L.tone('#4752a6'));
      for (let j = 1; j < DEPTH; j += 7) skew(edge, j, top, 2, FLOOR_H, L.side('#2b3478'));
      const y = top + FLOOR_H - 3;
      px(x0, top, BODY_W - SHAFT, 2, L.tone('#2b3478'));
      skew(edge, 0, top, DEPTH, 2, L.side('#2b3478'));
      px(x0, y, BODY_W, 3, L.tone('#262d68'));
      skew(edge, 0, y, DEPTH, 3, L.side('#262d68'));
      neon(x0, y + 1, BODY_W - SHAFT, 1, TEAL);
      skew(edge, 0, y + 1, DEPTH, 1, TEAL);
      px(x0 - 2, y, BODY_W + 2, 1, L.tone('#aab4dc')); // the ledge sticks out past the corner
      px(x0 - 2, y, 2, 3, L.tone('#141840'));
    }
    px(x0, bodyTop, 2, n * FLOOR_H, L.tone(NAVY));
    px(edge - SHAFT, bodyTop, SHAFT, n * FLOOR_H, L.tone('#1b2152'));
    px(edge - SHAFT, bodyTop, 1, n * FLOOR_H, L.tone('#3a4396'));
    skew(edge, DEPTH - 2, bodyTop, 2, n * FLOOR_H, L.side(NAVY));
    // neon: the corner between front and side, the line under the crown
    neon(edge - 1, bodyTop, 2, ground - bodyTop);
    px(edge - 1, bodyTop, 1, ground - bodyTop, NEON_HI);
    px(x0 - 1, bodyTop - 3, BODY_W + 1, 3, L.tone('#141840'));
    skew(edge, 0, bodyTop - 3, DEPTH, 3, L.side('#141840'));
    neon(x0, bodyTop - 2, BODY_W, 1);
    skew(edge, 0, bodyTop - 2, DEPTH, 1, NEON);
    // crown: the sign board on the front, the logo on the side
    px(x0 + 5, crownY + 6, BODY_W - 10, 28, '#0a0c1e');
    neon(x0 + 5, crownY + 6, BODY_W - 10, 1);
    neon(x0 + 5, crownY + 33, BODY_W - 10, 1, TEAL);
    px(x0 + 5, crownY + 6, 1, 28, NEON);
    px(x0 + BODY_W - 6, crownY + 6, 1, 28, NEON);
    const name = (this.brand?.name ?? '').toUpperCase();
    if (name) {
      const k = name.length * 12 <= BODY_W - 22 ? 3 : name.length * 8 <= BODY_W - 18 ? 2 : 1;
      const ty = crownY + 20 - Math.floor((5 * k) / 2);
      alpha(0.5, () => text(name, x0 + BODY_W / 2 + 1, ty + 1, NEON, k));
      text(name, x0 + BODY_W / 2, ty, '#f4fffb', k, TEAL);
    }
    skew(edge, 3, crownY + 5, 26, 31, '#0a0c1e');
    skew(edge, 3, crownY + 5, 26, 1, NEON);
    skew(edge, 3, crownY + 35, 26, 1, TEAL);
    if (this.logoReady()) {
      const img = this.logo!;
      const sw = img.naturalWidth / 24;
      for (let q = 0; q < 24; q++) c.drawImage(img, q * sw, 0, sw, img.naturalHeight, edge + 4 + q, crownY + 8 - ((4 + q) >> 1), 1, 24);
    }
    // roof: AC, penthouse with the mast base, dish, racks
    ac(x0 + 44, crownY - 9);
    dish(edge + 16, crownY - 9, 8);
    const tx = x0 + 60;
    const ty = crownY - 21;
    box(tx, ty, 62, 14, '#2f3a8a', 16);
    for (let wx = tx + 4; wx < tx + 56; wx += 8) px(wx, ty + 4, 5, 6, lit ? '#ffd36b' : L.tone('#8fe9dc'));
    neon(tx, ty + 12, 62, 1, TEAL);
    racks(edge - 30, crownY - 2, 3);
    racks(x0 + 26, crownY - 2, 2);
    const sx = tx + 38;
    box(sx - 6, ty - 9, 12, 5, '#4a56a8', 6);
    px(sx - 2, ty - 16, 5, 8, L.tone('#c3cad9'));
    px(sx - 1, this.oy + 4, 3, ty - 16 - this.oy - 4, L.tone('#dfe5f2'));
    px(sx, this.oy + 2, 1, 4, L.tone('#ffffff'));
    for (const ry of [ty - 18, ty - 24]) px(sx - 3, ry, 7, 1, L.tone('#8a93a8'));
    px(sx - 1, ty - 21, 3, 1, NEON);
    // flag pole
    px(x0 + 12, crownY - 46, 2, 44, L.tone('#e3e7f0'));
    px(x0 + 11, crownY - 48, 4, 2, L.tone('#ffd84d'));
    px(x0 + 10, crownY - 3, 6, 2, L.tone('#8a93a8'));

    // lobby: stone base, canopy with lights, glass doors, warm windows
    px(x0, lobbyY, BODY_W, LOBBY_H, L.tone('#262d68'));
    skew(edge, 0, lobbyY, DEPTH, LOBBY_H, L.side('#262d68'));
    neon(edge - 1, lobbyY, 2, LOBBY_H);
    const warmWin = (x: number, w: number) => {
      px(x, lobbyY + 11, w, 17, '#ffd98a');
      px(x, lobbyY + 24, w, 4, '#e7a94a');
      px(x, lobbyY + 11, w, 1, '#fff3cf');
      for (let mx = x + 9; mx < x + w - 2; mx += 10) px(mx, lobbyY + 11, 1, 17, L.tone('#262d68'));
      disc(x + 5, lobbyY + 21, 2, 3, '#3f9a3a'); // a plant
      px(x + w - 14, lobbyY + 19, 10, 5, '#8a5a3a'); // reception desk
      px(x + w - 11, lobbyY + 15, 2, 4, '#3a2a22');
    };
    warmWin(x0 + 6, 36);
    warmWin(x0 + DOOR + 22, edge - SHAFT - 4 - (x0 + DOOR + 22));
    for (const j of [4, 18]) skew(edge, j, lobbyY + 12, 10, 15, '#e9b24f');
    const dxl = x0 + DOOR - 16;
    px(dxl, lobbyY + 9, 32, LOBBY_H - 9, lit ? '#ffe7b8' : L.tone('#c4f3ff'));
    px(dxl, lobbyY + 9, 32, 2, L.tone('#141840'));
    for (let d = 0; d <= 4; d++) px(dxl + d * 8 - (d === 4 ? 1 : 0), lobbyY + 9, 1, LOBBY_H - 9, L.tone('#141840'));
    for (const hx of [dxl + 14, dxl + 17]) px(hx, lobbyY + 22, 1, 4, L.tone('#ffd84d'));
    alpha(0.3, () => {
      for (let j = 0; j < 12; j++) px(dxl + 2 + j, lobbyY + LOBBY_H - 2 - j * 2, 3, 2, '#ffffff');
    });
    box(x0 - 5, lobbyY + 1, BODY_W + 8, 5, '#8a5cff', 10);
    neon(x0 - 5, lobbyY + 5, BODY_W + 8, 1, TEAL);
    for (let lx = x0 - 2; lx < edge + 2; lx += 9) px(lx, lobbyY + 7, 2, 1, LAMP);
    px(dxl - 4, lobbyY + 6, 40, 3, L.tone('#5a35c8'));
    for (const bx of [dxl - 11, dxl + 36]) {
      box(bx, ground - 5, 7, 5, '#8a5a3a', 3);
      disc(bx + 3, ground - 8, 4, 3, L.tone('#3fae4a'));
      disc(bx + 2, ground - 9, 2, 2, L.tone('#7be06a'));
    }
    px(dxl - 3, ground - 1, 38, 1, L.tone('#ffffff'));
    alpha(0.25, () => px(x0, ground, BODY_W, 1, '#0a0a32'));
    alpha(dark * 0.25, () => {
      for (let rx = x0 + 4; rx < edge; rx += 3) px(rx, ground + 14, 1, 5 + Math.floor(hash(rx) * 13), rx % 2 ? NEON : TEAL);
    });

    // ---- street furniture: lamps with their pools of light, benches, trees ----
    for (let x = 28; x < W; x += 52) {
      if (Math.abs(x - dx0) < 24) continue;
      px(x, ground - 15, 1, 18, L.tone('#4a4f5c'));
      px(x - 1, ground + 2, 3, 1, L.tone('#4a4f5c'));
      px(x, ground - 16, 5, 1, L.tone('#4a4f5c'));
      px(x + 3, ground - 15, 3, 2, lit ? LAMP : L.tone('#dfe3ea'));
      if (lit) {
        alpha(0.22 * dark, () => disc(x + 4, ground + 5, 13, 4, LAMP));
        alpha(0.3 * dark, () => disc(x + 4, ground + 5, 7, 2, LAMP));
        alpha(0.35 * dark, () => disc(x + 4, ground - 14, 3, 3, LAMP));
      }
    }
    for (let x = 60; x < W; x += 104) {
      if (Math.abs(x - dx0) < 40) continue;
      px(x, ground + 1, 10, 1, L.tone('#b5713f'));
      px(x, ground - 1, 10, 1, L.tone('#b5713f'));
      px(x + 1, ground + 2, 1, 2, L.tone('#4a4f5c'));
      px(x + 8, ground + 2, 1, 2, L.tone('#4a4f5c'));
    }
    for (const x of this.trees) {
      const big = hash(x * 9) > 0.5 ? 1 : 0;
      alpha(0.22, () => disc(x + 1 + sdir * 4, ground + 3, 6 + big, 1, '#0a0a32'));
      px(x, ground - 7 - big, 2, 10 + big, L.tone('#7a5236'));
      disc(x + 1, ground - 11 - big, 6 + big, 5 + big, L.tone('#2f8f3a'));
      disc(x, ground - 13 - big, 5, 4, L.tone('#49b84a'));
      disc(x - 1, ground - 15 - big, 3, 2, L.tone('#8be86a'));
    }
  }

  private draw(t: number): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const h = this.hour();
    const key = `${W}|${H}|${this.ox}|${this.oy}|${Math.round(h * 20)}|${this.floors.length}|${this.brand?.name}|${this.logoReady()}`;
    if (key !== this.key) {
      this.key = key;
      this.light = lightAt(h);
      this.paint(this.light);
    }
    const L = this.light;
    const { dark, low: skyLow } = L;
    const sh = L.tone;
    const { px, disc, text, skew } = pen(c);
    const box = (x: number, y: number, w: number, hh: number, face: Col, d: number) => pen(c).box(L, x, y, w, hh, face, d);
    const ground = this.oy + this.height();
    const tick = (rate: number, seed = 0) => Math.floor(t * rate + seed);

    // sky, stars, sun or moon
    const sky = c.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, css(L.top));
    sky.addColorStop(0.55, css(mix(L.top, skyLow, 0.55)));
    sky.addColorStop(1, css(skyLow));
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    c.globalAlpha = dark;
    for (const [x, y, k] of this.stars) {
      if (Math.sin(t * (1 + k * 2) + k * 9) <= -0.3) continue;
      px(x, y, 1, 1, k > 0.8 ? '#fff' : '#9aa3d6');
      if (k > 0.93) {
        px(x - 1, y, 3, 1, '#cfd6ff');
        px(x, y - 1, 1, 3, '#cfd6ff');
      }
    }
    c.globalAlpha = 1;
    const arc = (p: number) => ({ x: W * 0.1 + p * W * 0.8, y: ground - 40 - Math.sin(Math.PI * p) * (ground - 74) });
    if (h >= 5.8 && h <= 19.2) {
      const p = (h - 5.8) / 13.4;
      const { x, y } = arc(p);
      const lowSun = 1 - Math.sin(Math.PI * p) > 0.5;
      const glow = lowSun ? '#ffb070' : '#fff6c8';
      for (const [r, a] of [[34, 0.07], [24, 0.1], [16, 0.16], [11, 0.3]] as const) {
        c.globalAlpha = a;
        disc(x, y, r, r, glow);
      }
      c.globalAlpha = 1;
      disc(x, y, 8, 8, lowSun ? '#ff9a4a' : '#fff1a8');
      disc(x - 1, y - 1, 5, 5, lowSun ? '#ffc27a' : '#fffbe0');
    } else {
      const { x, y } = arc(((h - 19.2 + 24) % 24) / 10.6);
      for (const [r, a] of [[20, 0.06], [12, 0.1]] as const) {
        c.globalAlpha = a;
        disc(x, y, r, r, '#cfd6ff');
      }
      c.globalAlpha = 1;
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
        if (dx * dx + dy * dy <= 49 && (dx - 4) * (dx - 4) + (dy + 1) * (dy + 1) > 30) px(x + dx, y + dy, 1, 1, dx < -4 ? '#fffbe6' : '#f0e8c4');
      }
    }

    // comets: a bright head and a fading tail, two streams with different rhythms
    for (const [period, seed] of [[7, 1], [11, 5]] as const) {
      const cyc = Math.floor(t / period);
      const lt = t % period;
      if (lt > 1.6) continue;
      const hx = W * (0.3 + hash(cyc * 3 + seed) * 0.7) - lt * 80;
      const hy = 4 + hash(cyc * 5 + seed) * ground * 0.25 + lt * 32;
      for (let k = 0; k < 22; k++) {
        c.globalAlpha = (1 - k / 22) * (0.5 + dark * 0.5) * Math.min(1, (1.6 - lt) * 2);
        px(hx + k * 2.5, hy - k, k < 3 ? 2 : 1, k < 2 ? 2 : 1, k < 3 ? '#ffffff' : k < 10 ? '#9fe8ff' : '#c9a6ff');
      }
      c.globalAlpha = 1;
    }

    // clouds in two parallax layers (the far skyline sits between them), tinted by the horizon
    const cloudHi = sh(mix(WHITE, skyLow, 0.12 + L.warm * 0.25));
    const cloudLo = sh(mix([196, 214, 240], skyLow, 0.3 + L.warm * 0.3));
    const cloud = (x: number, y: number, cw: number) => {
      const r = Math.max(3, Math.round(cw / 7));
      disc(x, y + r - 1, cw / 2, 2, cloudLo);
      disc(x - cw / 4, y, cw / 5, r - 1, cloudHi);
      disc(x + cw / 12, y - r / 2, cw / 4, r + 1, cloudHi);
      disc(x + cw / 3, y + 1, cw / 6, r - 2, cloudHi);
      disc(x, y + r - 3, cw / 2 - 2, 2, cloudHi);
    };
    for (let i = 0; i < 6; i++) {
      const cw = 18 + hash(i + 140) * 16;
      cloud(((hash(i + 150) * (W + 80) + t * (0.8 + hash(i + 160))) % (W + 80)) - 40, ground * (0.3 + hash(i + 170) * 0.3), cw);
    }
    c.drawImage(this.far, 0, 0);
    for (let i = 0; i < 7; i++) {
      const cw = 34 + hash(i + 40) * 34;
      cloud(((hash(i + 50) * (W + 120) + t * (2.5 + hash(i + 60) * 3)) % (W + 120)) - 60, 14 + hash(i + 70) * ground * 0.34, cw);
    }
    if (dark < 0.5) {
      for (let i = 0; i < 5; i++) {
        const x = ((t * 9 + i * 13 + hash(i + 300) * W) % (W + 20)) - 10;
        const y = 34 + i * 6 + Math.sin(t + i) * 3;
        const up = tick(6, i) % 2;
        px(x - 2, y - up, 2, 1, sh('#2a2d36'));
        px(x, y, 1, 1, sh('#2a2d36'));
        px(x + 1, y - up, 2, 1, sh('#2a2d36'));
      }
    }

    c.drawImage(this.city, 0, 0);
    for (const [x, y, on, off, seed] of this.leds) px(x, y, 1, 1, hash(seed * 7 + tick(1.5 + (seed % 3))) > 0.42 ? on : off);

    // rockets: lift off from a front-row roof, flame and a smoke trail
    const pads = this.blocks.filter((b) => !b.back);
    if (pads.length) {
      const period = 13;
      const cyc = Math.floor(t / period);
      const lt = t % period;
      if (lt < 6) {
        const pad = pads[Math.floor(hash(cyc + 3) * pads.length)]!;
        const rx = pad.x + pad.w / 2 + 4;
        const pos = (u: number) => ({ x: rx + u * u * 1.5, y: ground - pad.h - 20 - (10 * u + 9 * u * u) });
        for (let k = 18; k >= 1; k--) {
          const u = lt - k * 0.12;
          if (u < 0) continue;
          const p = pos(u);
          c.globalAlpha = 0.6 * (1 - k / 19);
          disc(p.x + 1, p.y + 11, 1 + k / 3, 1 + k / 3, sh(k < 4 ? '#ffd9a0' : '#eeeef2'));
        }
        c.globalAlpha = 1;
        const p = pos(lt);
        const fl = 3 + (tick(12) % 3);
        px(p.x - 1, p.y + 10, 5, fl - 1, '#ffd36b');
        px(p.x, p.y + 10, 3, fl + 1, '#ff9a2a');
        px(p.x + 1, p.y + 10, 1, fl + 3, '#ffffff');
        px(p.x, p.y, 3, 10, sh('#f4f4f6'));
        px(p.x + 2, p.y, 1, 10, sh('#c3cad9'));
        px(p.x + 1, p.y - 2, 1, 2, sh('#e2483d'));
        px(p.x, p.y - 1, 3, 1, sh('#e2483d'));
        px(p.x, p.y + 3, 3, 2, sh('#4670cf'));
        px(p.x - 1, p.y + 7, 1, 3, sh('#e2483d'));
        px(p.x + 3, p.y + 7, 1, 3, sh('#e2483d'));
      }
    }

    // ---- the tower: what moves on its shell ----
    const x0 = this.ox;
    const edge = x0 + BODY_W;
    const crownY = this.oy + SPIRE_H;
    const bodyTop = crownY + CROWN_H;
    const glass = (col: RGB) => css(mix(col, [14, 22, 60], dark * 0.8));
    const shaftX = edge - SHAFT;
    this.floors.forEach((f, i) => {
      const y = this.floorY(i);
      for (let j = 3; j + 5 < DEPTH; j += 7) {
        const on = f.agents > 0 && hash(i * 17 + j) > 0.3;
        skew(edge, j, y + 2, 5, WIN_H, on ? (f.working ? '#f2bd55' : '#c79a52') : glass(mix(skyLow, rgb('#0f5f80'), 0.6)));
        skew(edge, j, y + 2, 5, 1, on ? '#ffe2a0' : glass(mix(skyLow, WHITE, 0.4)));
        skew(edge, j, y + WIN_H - 1, 5, 3, on ? '#c98a3e' : glass(mix(skyLow, rgb('#0f5f80'), 0.75)));
      }
      for (let kk = 0; kk < COLS; kk++) {
        const wx = x0 + GAP + kk * (WIN_W + GAP);
        const wy = y + 2;
        const room = f.rooms[kk];
        if (!room || room.agents <= 0) {
          px(wx, wy, WIN_W, WIN_H, glass(mix(skyLow, rgb('#0f7f93'), room ? 0.22 : 0.6)));
          px(wx, wy, WIN_W, 1, glass(mix(skyLow, WHITE, room ? 0.8 : 0.3)));
          px(wx + 1, wy + 1, 2, WIN_H - 3, glass(mix(skyLow, WHITE, room ? 0.7 : 0.25)));
          px(wx + 4, wy + 1, 1, 4, glass(mix(skyLow, WHITE, room ? 0.5 : 0.15)));
          px(wx, wy + WIN_H - 2, WIN_W, 2, glass(mix(skyLow, rgb('#0f7f93'), room ? 0.4 : 0.7)));
        } else {
          if (dark > 0.3) {
            c.globalAlpha = dark * 0.3;
            px(wx - 1, wy - 1, WIN_W + 2, WIN_H + 2, '#ffd36b');
            c.globalAlpha = 1;
          }
          const flick = hash(i * 31 + kk + tick(0.5)) > 0.97;
          px(wx, wy, WIN_W, WIN_H, room.working ? (flick ? '#f2c25a' : '#ffd86e') : '#e9b46a');
          px(wx, wy, WIN_W, 1, room.working ? '#fff0b8' : '#f3cf95');
          px(wx, wy + WIN_H - 4, WIN_W, 4, room.working ? '#e7a94a' : '#c99350');
          // a desk with a glowing screen, people walking while working, seated otherwise
          px(wx + WIN_W - 5, wy + WIN_H - 8, 3, 2, room.working ? (tick(2, kk) % 5 ? '#6bd8ff' : '#c9f2ff') : '#7a8a99');
          px(wx + WIN_W - 4, wy + WIN_H - 6, 1, 2, '#8a5a3a');
          const people = Math.min(room.agents, 3);
          for (let p = 0; p < people; p++) {
            const working = p < room.working;
            const sp = 0.6 + hash(i * 7 + kk * 3 + p) * 0.8;
            const phase = hash(i + kk * 5 + p * 11) * 6.28;
            const fx = working ? wx + 1 + ((Math.sin(t * sp + phase) + 1) / 2) * (WIN_W - 4) : wx + 1 + p * 3;
            px(fx, wy + 4, 2, 2, '#2a1e1a');
            px(fx, wy + 6, 2, WIN_H - 6, SHIRTS[(i + kk + p * 3) % SHIRTS.length]!);
            px(fx, wy + WIN_H - 3, 2, 3, '#3a2a22');
          }
        }
        px(wx + WIN_W / 2, wy, 1, WIN_H, sh('#2b3478'));
      }
      // elevator door per floor, green when the floor is working
      px(shaftX + 3, y + 2, SHAFT - 6, WIN_H, sh('#2b3470'));
      px(shaftX + SHAFT / 2 - 0.5, y + 2, 1, WIN_H, sh('#0e1428'));
      px(shaftX + SHAFT / 2 - 1, y, 2, 1, f.working ? '#8be28b' : sh('#4a5296'));
      if (i === this.hover) {
        c.globalAlpha = 0.28;
        px(x0, y, BODY_W, FLOOR_H - 3, '#ffffff');
        skew(edge, 0, y, DEPTH, FLOOR_H - 3, '#ffffff');
        c.globalAlpha = 1;
        px(x0 - 3, y, 3, FLOOR_H - 3, '#f08a3c');
      }
    });
    if (this.floors.length) {
      const span = (this.floors.length - 1) * FLOOR_H;
      const cy = bodyTop + (span ? ((Math.sin(t * 0.35) + 1) / 2) * span : 0) + 2;
      px(shaftX + 3, cy, SHAFT - 6, WIN_H, '#ffd36b');
      px(shaftX + 3, cy, SHAFT - 6, 1, '#fff0b8');
      px(shaftX + 6, cy + 4, 2, 2, '#2a1e1a');
      px(shaftX + 6, cy + 6, 2, 7, '#4670cf');
    }
    // a shine sweeps the sign every few seconds
    const sweep = (t % 6) * 90;
    if (sweep < BODY_W + 30) {
      c.save();
      c.beginPath();
      c.rect(x0 + 6, crownY + 7, BODY_W - 12, 26);
      c.clip();
      c.globalAlpha = 0.22;
      for (let j = 0; j < 26; j++) px(x0 - 20 + sweep + j * 0.5, crownY + 33 - j, 7, 1, '#ffffff');
      c.restore();
      c.globalAlpha = 1;
    }
    // mast beacon
    const sx = x0 + 98;
    if (tick(1.5) % 2 === 0) {
      c.globalAlpha = 0.3;
      disc(sx, this.oy + 1, 5, 5, '#ff4a4a');
      c.globalAlpha = 1;
      px(sx - 1, this.oy, 3, 3, '#ff4a4a');
      px(sx, this.oy + 1, 1, 1, '#ffd0d0');
    }
    // flag
    const poleTop = crownY - 46;
    for (let col = 0; col < FLAG_W; col++) {
      const dy = Math.sin(t * 5 - col * 0.4) * (col / FLAG_W) * 2.6;
      c.drawImage(this.flag, col, 0, 1, FLAG_H, x0 + 14 + col, Math.round(poleTop + 1 + dy), 1, FLAG_H);
      if (Math.sin(t * 5 - col * 0.4) > 0.5) {
        c.globalAlpha = 0.12;
        px(x0 + 14 + col, Math.round(poleTop + 1 + dy), 1, FLAG_H, '#ffffff');
        c.globalAlpha = 1;
      }
    }
    if (dark > 0.5) {
      c.globalAlpha = dark * 0.25;
      px(x0 + 14, poleTop - 2, FLAG_W, FLAG_H + 5, '#0b1030');
      c.globalAlpha = 1;
    }

    // ---- street life ----
    const person = (x: number, y: number, i: number, walking: boolean) => {
      const step = walking ? tick(4, i) % 2 : 0;
      c.globalAlpha = 0.2;
      px(x - 1, y + 7, 4, 1, '#0a0a32');
      c.globalAlpha = 1;
      px(x, y - 1, 2, 1, sh(['#2a1e1a', '#5a3a24', '#e9c46a', '#1b1b22'][i % 4]!));
      px(x, y, 2, 2, sh(SKINS[i % 3]!));
      px(x, y + 2, 2, 3, sh(SHIRTS[i % SHIRTS.length]!));
      px(x, y + 5, 2, 1, sh('#2a2d36'));
      px(x + (step ? 0 : 1), y + 6, 1, 1, sh('#2a2d36'));
    };
    const dxc = x0 + DOOR;
    for (let i = 0; i < 16; i++) {
      const x = dxc - 30 + hash(i + 500) * 60;
      person(x, ground - 4 + Math.floor(hash(i + 510) * 6) - (tick(2, i) % 7 === 0 ? 1 : 0), i, false);
    }
    const walkers = Math.round(W / 14);
    for (let i = 0; i < walkers; i++) {
      const sp = 3 + hash(i + 200) * 5;
      const raw = (t * sp + hash(i + 210) * (W + 10)) % (W + 10);
      person(i % 2 ? W + 5 - raw : raw - 5, ground - 3 + (i % 5), i + 3, true);
    }
    // traffic: two lanes, each at one speed so nobody rear-ends
    type Ride = 'car' | 'taxi' | 'police' | 'van' | 'bus';
    const ride = (x: number, y: number, kind: Ride, dir: number, col: string) => {
      const w = kind === 'bus' ? 40 : kind === 'van' ? 24 : 19;
      const fx = (dx: number, ww: number) => (dir > 0 ? x + dx : x + w - dx - ww); // mirror for leftward rides
      c.globalAlpha = 0.25;
      px(x + 1, y + 10, w, 1, '#0a0a32');
      c.globalAlpha = 1;
      const hi = sh(mix(rgb(col), WHITE, 0.35));
      const lo = sh(mix(rgb(col), SHADE, 0.3));
      if (kind === 'bus') {
        px(x, y - 3, w, 12, sh(col));
        px(x, y - 3, w, 1, hi);
        px(x, y + 5, w, 1, sh('#ffffff'));
        px(x, y + 8, w, 1, lo);
        for (let k = 0; k < 6; k++) px(fx(3 + k * 6, 4), y - 1, 4, 4, dark > 0.4 ? '#ffe7b8' : sh('#bfe9ff'));
        px(fx(w - 3, 2), y - 1, 2, 5, sh('#bfe9ff'));
        text('BUS', fx(8, 11) + 5, y - 9, sh('#ffffff'));
      } else if (kind === 'van') {
        px(x, y - 1, w, 10, sh(col));
        px(x, y - 1, w, 1, hi);
        px(x, y + 8, w, 1, lo);
        px(fx(w - 7, 5), y + 1, 5, 3, sh('#bfe9ff'));
        px(fx(3, 10), y + 2, 10, 4, sh('#ff9a1f'));
        px(fx(5, 6), y + 3, 6, 2, sh('#ffffff'));
      } else {
        px(x, y + 3, w, 6, sh(col));
        px(x, y + 3, w, 1, hi);
        px(x, y + 8, w, 1, lo);
        px(x + 4, y, 11, 3, sh(col));
        px(x + 4, y, 11, 1, hi);
        px(x + 5, y + 1, 4, 2, sh('#bfe9ff'));
        px(x + 10, y + 1, 4, 2, sh('#bfe9ff'));
        if (kind === 'taxi') {
          px(x + 8, y - 2, 4, 2, dark > 0.3 ? '#fff3b0' : sh('#ffffff'));
          for (let k = 0; k < w; k += 4) px(x + k, y + 5, 2, 1, sh('#1a1a1f'));
        }
        if (kind === 'police') {
          px(x, y + 5, w, 2, sh('#2f5be0'));
          const flash = tick(6) % 2;
          px(x + 7, y - 2, 3, 2, flash ? '#ff3b3b' : '#7a1f1f');
          px(x + 10, y - 2, 3, 2, flash ? '#1f2f7a' : '#4d8bff');
          c.globalAlpha = 0.25 + dark * 0.25;
          disc(x + (flash ? 8 : 11), y - 1, 4, 3, flash ? '#ff3b3b' : '#4d8bff');
          c.globalAlpha = 1;
        }
      }
      for (const wx of [x + 3, x + w - 7]) {
        px(wx, y + 8, 4, 3, '#16161c');
        px(wx + 1, y + 9, 2, 1, sh('#aab0c0'));
      }
      px(fx(w - 1, 1), y + 4, 1, 2, dark > 0.3 ? '#fff3b0' : sh('#fff3b0'));
      px(fx(0, 1), y + 4, 1, 2, '#ff4a4a');
      if (dark > 0.3) {
        for (let r = 0; r < 8; r++) {
          c.globalAlpha = 0.3 * (1 - r / 8);
          px(fx(w + r, 1), y + 6, 1, 4, LAMP);
        }
        c.globalAlpha = 1;
      }
    };
    const lane = (y: number, dir: number, sp: number, rides: Array<[Ride, string, number]>) => {
      const span = Math.max(W + 60, 300);
      for (const [kind, col, at] of rides) {
        const raw = (t * sp + at * span) % span;
        ride(dir > 0 ? raw - 45 : W + 5 - raw, y, kind, dir, col);
      }
    };
    lane(ground + 12, 1, 30, [['car', '#e2483d', 0], ['taxi', '#ffc533', 0.3], ['police', '#f4f4f6', 0.58], ['car', '#35c46f', 0.82]]);
    lane(ground + 21, -1, 22, [['bus', '#ff7a4d', 0], ['van', '#f4f4f6', 0.42], ['car', '#8f6bff', 0.7]]);
    for (let i = 0; i < Math.round(W / 40); i++) {
      const sp = 3 + hash(i + 700) * 4;
      const raw = (t * sp + hash(i + 710) * (W + 10)) % (W + 10);
      person(i % 2 ? raw - 5 : W + 5 - raw, ground + 30, i + 20, true);
    }

    // sky traffic in front: delivery drones with parcels, a slow blimp
    for (let i = 0; i < 4; i++) {
      const sp = 12 + i * 5;
      const dir = i % 2 ? -1 : 1;
      const raw = (t * sp + hash(i + 80) * (W + 60)) % (W + 60);
      const x = dir > 0 ? raw - 30 : W + 30 - raw;
      const y = 26 + i * ground * 0.1 + Math.sin(t * 2 + i) * 2;
      const spin = tick(12) % 2;
      px(x - 7, y, 15, 1, sh('#2a2d36'));
      px(x - 9, y - 1, 6, 1, sh(spin ? '#c3cad9' : '#5a6072'));
      px(x + 4, y - 1, 6, 1, sh(spin ? '#5a6072' : '#c3cad9'));
      px(x - 2, y + 1, 5, 2, sh('#f4f4f6'));
      px(x - 2, y + 2, 5, 1, sh('#8f6bff'));
      px(x, y + 3, 1, 2, sh('#2a2d36'));
      box(x - 3, y + 5, 6, 5, '#d99a55', 3);
      px(x - 1, y + 5, 2, 5, sh('#b5713f'));
      px(x, y + 1, 1, 1, tick(2) % 2 ? '#ff4a4a' : '#5cff8a');
    }
    {
      const bx = W + 50 - ((t * 5 + W * 0.3) % (W + 110));
      const by = ground * 0.17 + Math.sin(t * 0.5) * 2;
      disc(bx, by, 32, 10, sh('#dfe5f2'));
      disc(bx - 2, by - 2, 29, 7, sh('#ffffff'));
      px(bx - 30, by + 2, 60, 2, sh('#8f6bff'));
      px(bx - 28, by + 4, 56, 1, sh('#5ff5e0'));
      px(bx + 27, by - 12, 5, 9, sh('#8f6bff'));
      px(bx + 27, by + 5, 5, 8, sh('#8f6bff'));
      px(bx + 29, by - 3, 6, 6, sh('#6d4fe0'));
      box(bx - 8, by + 10, 16, 4, '#3a3f4c', 4);
      for (let k = 0; k < 3; k++) px(bx - 6 + k * 5, by + 11, 3, 2, dark > 0.4 ? LAMP : sh('#bfe9ff'));
      text('AGENTS', bx - 2, by - 5, sh('#3a2a8a'));
      if (dark > 0.4) px(bx - 32, by, 1, 1, tick(2) % 2 ? '#ff4a4a' : '#ffffff');
    }
  }
}
