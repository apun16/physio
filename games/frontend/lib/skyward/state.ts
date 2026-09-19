import { ENCOUNTERS, type EnemySpec, type Encounter, zoneAt } from "./encounters";
import { VALID_SLASHES, type GameAction, type SlashDirection } from "./input";

export const WALK_SPEED = 150;
export const SLASH_REACH = 280;
export const ARROW_SPEED = 520;
export const MAX_ARROWS = 10;
export const STRONG_HIT = 0.5;

export type Phase = "intro" | "travel" | "combat" | "victory" | "dead" | "complete";

export type HeroState = {
  x: number;
  hp: number;
  maxHp: number;
  arrows: number;
  shield: boolean;
  bowAim: [number, number];
  bowDraw: number;
  anim: string;
  animT: number;
  invuln: number;
  attackLock: number;
  hurtT: number;
};

export type EnemyState = {
  spec: EnemySpec;
  hp: number;
  x: number;
  windup: number;
  cooldown: number;
  shield: boolean;
  stun: number;
  flash: number;
  phase: number;
  alive: boolean;
  hitReact: number;
  age: number;
};

export type Projectile = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fromHero: boolean;
  life: number;
  power: number;
};

export type SlashTrail = {
  direction: SlashDirection;
  originX: number;
  t: number;
  life: number;
  strong: boolean;
};

export type Impact = {
  x: number;
  y: number;
  t: number;
  life: number;
  blocked: boolean;
  label?: string;
  hurt?: boolean;
};

export type Dialogue = {
  text: string;
  shown: number;
  duration: number;
};

export class JourneyState {
  phase: Phase = "intro";
  hero: HeroState = {
    x: 80,
    hp: 6,
    maxHp: 6,
    arrows: MAX_ARROWS,
    shield: false,
    bowAim: [1, 0],
    bowDraw: 0,
    anim: "idle",
    animT: 0,
    invuln: 0,
    attackLock: 0,
    hurtT: 0
  };
  enemy: EnemyState | null = null;
  cleared = 0;
  elapsed = 0;
  shake = 0;
  projectiles: Projectile[] = [];
  trails: SlashTrail[] = [];
  impacts: Impact[] = [];
  dialogue: Dialogue = {
    text: "* ...The forest. I'll walk. When something steps out, move with me.",
    shown: 0,
    duration: 4.2
  };
  pendingHit: { wait: number; slash: Extract<GameAction, { type: "SwordSlash" }> } | null = null;
  victoryT = 0;
  endT = 0;
  introT = 0;
  zoneAnnounced = "forest";
  lastShieldLine = 0;

  get encounter(): Encounter | null {
    return this.cleared >= ENCOUNTERS.length ? null : ENCOUNTERS[this.cleared];
  }

  apply(actions: GameAction[]) {
    if (this.phase === "dead" || this.phase === "complete") return;
    for (const action of actions) {
      if (action.type === "ShieldState") {
        if (this.hero.attackLock <= 0) {
          this.hero.shield = action.active;
          if (action.active) {
            this.hero.anim = "shield";
            this.hero.animT = 0;
          } else if (this.phase === "combat" && this.hero.bowDraw <= 0) {
            this.hero.anim = "idle";
          }
        }
      } else if (action.type === "BowAim") {
        this.hero.bowAim = [action.x, action.y];
      } else if (action.type === "BowDraw") {
        if (this.hero.attackLock <= 0 && !this.hero.shield) {
          this.hero.bowDraw = Math.max(0, Math.min(1, action.amount));
          if (this.hero.bowDraw > 0.04 && this.phase === "combat") {
            this.hero.anim = this.hero.bowDraw < 0.72 ? "bow_draw" : "bow_hold";
            this.hero.animT = this.hero.bowDraw;
          }
        }
      } else if (action.type === "BowRelease") {
        this.releaseBow();
      } else if (action.type === "SwordSlash") {
        this.startSlash(action);
      }
    }
  }

  update(dt: number) {
    dt = Math.min(dt, 1 / 20);
    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.hero.invuln = Math.max(0, this.hero.invuln - dt);
    this.hero.attackLock = Math.max(0, this.hero.attackLock - dt);
    this.hero.hurtT = Math.max(0, this.hero.hurtT - dt);
    this.hero.animT += dt;
    this.dialogue.shown += dt;
    this.tickFx(dt);
    this.tickPendingHit(dt);
    this.tickProjectiles(dt);

    if (this.phase === "intro") {
      this.introT += dt;
      this.hero.anim = "idle";
      if (this.introT >= 2.8) {
        this.phase = "travel";
        this.dialogue = { text: "* Left foot, right foot. I can do this part.", shown: 0, duration: 4.2 };
      }
      return;
    }
    if (this.phase === "dead") {
      this.endT += dt;
      this.hero.anim = "hurt";
      return;
    }
    if (this.phase === "complete") {
      this.endT += dt;
      this.hero.anim = "victory";
      return;
    }
    if (this.phase === "victory") {
      this.victoryT += dt;
      this.hero.anim = "victory";
      this.hero.shield = false;
      this.hero.bowDraw = 0;
      if (this.victoryT >= 1.35) {
        this.cleared += 1;
        this.enemy = null;
        if (this.cleared >= ENCOUNTERS.length) {
          this.phase = "complete";
          this.dialogue = { text: "* That's the last of them. The woods can rest.", shown: 0, duration: 5 };
        } else {
          this.phase = "travel";
          this.dialogue = { text: "* We keep moving.", shown: 0, duration: 3.5 };
        }
      }
      return;
    }
    if (this.phase === "travel") this.travel(dt);
    else if (this.phase === "combat") this.combat(dt);
  }

  private travel(dt: number) {
    this.hero.x += WALK_SPEED * dt;
    this.hero.anim = "walk";
    this.hero.shield = false;
    this.hero.bowDraw = 0;
    const zone = zoneAt(this.hero.x);
    if (zone.id !== this.zoneAnnounced) {
      this.zoneAnnounced = zone.id;
      this.dialogue = { text: zone.line, shown: 0, duration: 4.2 };
    }
    const next = this.encounter;
    if (next && this.hero.x >= next.x) this.beginEncounter(next);
  }

  private beginEncounter(encounter: Encounter) {
    this.phase = "combat";
    this.hero.anim = "idle";
    this.hero.animT = 0;
    this.enemy = {
      spec: encounter.enemy,
      hp: encounter.enemy.maxHp,
      x: this.hero.x + encounter.enemy.preferredGap,
      windup: 0,
      cooldown: 2.2,
      shield: Boolean(encounter.enemy.hasShield),
      stun: 0,
      flash: 0,
      phase: 1,
      alive: true,
      hitReact: 0,
      age: 0
    };
    this.dialogue = { text: encounter.line, shown: 0, duration: 4.2 };
    this.projectiles = [];
  }

  private combat(dt: number) {
    const enemy = this.enemy;
    if (!enemy || !enemy.alive) {
      this.phase = "victory";
      this.victoryT = 0;
      this.hero.anim = "victory";
      this.dialogue = { text: "* Down. The path opens again.", shown: 0, duration: 3.2 };
      return;
    }
    enemy.age += dt;
    enemy.flash = Math.max(0, enemy.flash - dt);
    enemy.stun = Math.max(0, enemy.stun - dt);
    enemy.hitReact = Math.max(0, enemy.hitReact - dt);
    if (enemy.spec.hasShield) {
      const cycle = (this.elapsed * 0.7) % 2.6;
      enemy.shield = cycle < 1.0 && enemy.windup <= 0;
    }
    if (enemy.stun <= 0) this.enemyAi(dt, enemy);
    if (this.hero.attackLock <= 0 && this.hero.hurtT <= 0) {
      if (this.hero.shield) this.hero.anim = "shield";
      else if (this.hero.bowDraw > 0.04) this.hero.anim = this.hero.bowDraw < 0.72 ? "bow_draw" : "bow_hold";
      else this.hero.anim = "idle";
    }
  }

  private enemyAi(dt: number, enemy: EnemyState) {
    const gap = enemy.x - this.hero.x;
    const wanted = enemy.spec.preferredGap;
    if (gap > wanted + 18) enemy.x -= enemy.spec.moveSpeed * dt;
    else if (gap < wanted - 18) enemy.x += enemy.spec.moveSpeed * 0.7 * dt;
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    if (enemy.windup > 0) {
      enemy.windup -= dt;
      if (enemy.windup <= 0) this.enemyStrike(enemy);
      return;
    }
    if (enemy.cooldown <= 0) {
      enemy.windup = enemy.spec.telegraph;
      enemy.cooldown = enemy.spec.attackPeriod;
      if (enemy.spec.boss) {
        enemy.phase = enemy.hp <= enemy.spec.maxHp * 0.6 ? 2 : 1;
        if (enemy.hp <= enemy.spec.maxHp * 0.32) enemy.phase = 3;
      }
    }
  }

  private enemyStrike(enemy: EnemyState) {
    const ranged =
      Boolean(enemy.spec.ranged) &&
      (enemy.spec.kind === "archer" || (Boolean(enemy.spec.elite) && Math.floor(this.elapsed * 3) % 2 === 0) || (Boolean(enemy.spec.boss) && enemy.phase >= 2));
    if (ranged) {
      this.projectiles.push({
        x: enemy.x - 20,
        y: 42,
        vx: -230,
        vy: enemy.spec.boss ? -20 : 0,
        fromHero: false,
        life: 1.6,
        power: enemy.spec.boss ? 1.4 : 1
      });
      return;
    }
    if (enemy.x - this.hero.x > SLASH_REACH + 60) return;
    this.heroHit(enemy.spec.touchDamage);
  }

  private heroHit(damage: number) {
    if (this.hero.invuln > 0) return;
    if (this.hero.shield) {
      this.impacts.push({ x: this.hero.x + 70, y: 50, t: 0, life: 0.6, blocked: true, label: "BLOCK" });
      if (this.enemy) {
        this.enemy.stun = 0.9;
        this.enemy.x += 36;
      }
      this.shake = Math.max(this.shake, 0.12);
      if (this.elapsed - this.lastShieldLine > 6) {
        this.dialogue = { text: "* Caught it.", shown: 0, duration: 2.8 };
        this.lastShieldLine = this.elapsed;
      }
      return;
    }
    const lost = Math.max(1, Math.round(damage));
    this.hero.hp = Math.max(0, this.hero.hp - lost);
    this.impacts.push({ x: this.hero.x + 40, y: 110, t: 0, life: 0.8, blocked: false, hurt: true, label: `-${lost}` });
    this.hero.invuln = 1.4;
    this.hero.hurtT = 0.4;
    this.hero.anim = "hurt";
    this.hero.animT = 0;
    this.shake = 0.28;
    if (this.hero.hp <= 0) {
      this.phase = "dead";
      this.dialogue = { text: "* ...I can't. Rest, then we try the woods again.", shown: 0, duration: 6 };
    }
  }

  private startSlash(slash: Extract<GameAction, { type: "SwordSlash" }>) {
    if (this.phase !== "combat") return;
    if (!VALID_SLASHES.includes(slash.direction)) return;
    if (this.hero.attackLock > 0 || this.hero.hurtT > 0) return;
    this.hero.shield = false;
    this.hero.bowDraw = 0;
    this.hero.anim = `slash_${slash.direction}`;
    this.hero.animT = 0;
    this.hero.attackLock = 0.3;
    this.trails.push({
      direction: slash.direction,
      originX: this.hero.x + 40,
      t: 0,
      life: 0.28,
      strong: slash.velocity >= STRONG_HIT
    });
    this.pendingHit = { wait: 0.12, slash };
  }

  private tickPendingHit(dt: number) {
    if (!this.pendingHit) return;
    this.pendingHit.wait -= dt;
    if (this.pendingHit.wait > 0) return;
    const slash = this.pendingHit.slash;
    this.pendingHit = null;
    this.resolveSlash(slash);
  }

  private resolveSlash(slash: Extract<GameAction, { type: "SwordSlash" }>) {
    const enemy = this.enemy;
    if (!enemy || !enemy.alive || this.phase !== "combat") return;
    if (enemy.x - this.hero.x > SLASH_REACH) return;
    if (enemy.shield && slash.direction === "horizontal") {
      this.impacts.push({ x: enemy.x - 30, y: 48, t: 0, life: 0.6, blocked: true, label: "BLOCKED" });
      this.dialogue = { text: "* The board ate that one. Go over it.", shown: 0, duration: 3.2 };
      return;
    }
    this.hurtEnemy(this.slashDamage(slash, enemy), slash.velocity >= STRONG_HIT);
  }

  private slashDamage(slash: Extract<GameAction, { type: "SwordSlash" }>, enemy: EnemyState) {
    const velocity = Math.max(0.15, Math.min(1.4, slash.velocity));
    let damage = 1.4 * Math.max(velocity, 0.6);
    if (slash.direction === "vertical") damage *= enemy.shield || enemy.spec.hasShield ? 1.35 : 1.05;
    else if (slash.direction === "diagonal") damage *= 1.15;
    if (enemy.spec.armored) damage *= velocity < STRONG_HIT ? 0.7 : 1.25;
    
    return damage;
  }

  private hurtEnemy(damage: number, strong: boolean) {
    const enemy = this.enemy;
    if (!enemy) return;
    enemy.hp -= damage;
    enemy.flash = 0.18;
    enemy.hitReact = 0.22;
    enemy.x += strong ? 28 : 14;
    this.impacts.push({ x: enemy.x - 20, y: 40, t: 0, life: 0.6, blocked: false, label: strong ? "STRONG!" : "HIT" });
    if (strong) this.shake = Math.max(this.shake, 0.34);
    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.hp = 0;
      if (enemy.spec.boss) this.dialogue = { text: "* It's over. The castle lets us through.", shown: 0, duration: 4 };
    }
  }

  private releaseBow() {
    const draw = this.hero.bowDraw;
    this.hero.bowDraw = 0;
    if (this.phase !== "combat" || draw < 0.38) {
      if (this.hero.attackLock <= 0) this.hero.anim = "idle";
      return;
    }
    if (this.hero.arrows <= 0) {
      this.dialogue = { text: "* Quiver's empty. Blade and board, then.", shown: 0, duration: 3 };
      this.hero.anim = "idle";
      return;
    }
    this.hero.arrows -= 1;
    this.hero.anim = "bow_release";
    this.hero.animT = 0;
    this.hero.attackLock = 0.28;
    const [ax, ay] = this.hero.bowAim;
    const length = Math.max(0.35, Math.hypot(ax, ay));
    this.projectiles.push({
      x: this.hero.x + 70,
      y: 48,
      vx: Math.max(180, (ax / length) * ARROW_SPEED * (0.65 + 0.35 * draw)),
      vy: (ay / length) * ARROW_SPEED * 0.35,
      fromHero: true,
      life: 1.6,
      power: 0.9 + draw * 0.8
    });
  }

  private tickProjectiles(dt: number) {
    const living: Projectile[] = [];
    for (const shot of this.projectiles) {
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.life -= dt;
      if (shot.life <= 0) continue;
      if (shot.fromHero) {
        const enemy = this.enemy;
        if (enemy && enemy.alive && Math.abs(shot.x - enemy.x) < 70 && Math.abs(shot.y - 40) < 100) {
          if (enemy.shield && !enemy.spec.boss) this.impacts.push({ x: enemy.x - 24, y: 44, t: 0, life: 0.6, blocked: true, label: "BLOCKED" });
          else this.hurtEnemy(shot.power * (enemy.spec.ranged ? 1.1 : 0.7), shot.power > 1.2);
          continue;
        }
      } else if (Math.abs(shot.x - (this.hero.x + 40)) < 42 && Math.abs(shot.y - 48) < 70) {
        this.heroHit(shot.power);
        continue;
      }
      living.push(shot);
    }
    this.projectiles = living;
  }

  private tickFx(dt: number) {
    this.trails = this.trails.filter((trail) => {
      trail.t += dt;
      return trail.t < trail.life;
    });
    this.impacts = this.impacts.filter((impact) => {
      impact.t += dt;
      return impact.t < impact.life;
    });
  }
}
