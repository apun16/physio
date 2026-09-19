export type EnemyKind = "goblin" | "shield_beast" | "archer" | "armored" | "elite" | "boss";

export type EnemySpec = {
  kind: EnemyKind;
  title: string;
  maxHp: number;
  touchDamage: number;
  attackPeriod: number;
  telegraph: number;
  moveSpeed: number;
  preferredGap: number;
  hasShield?: boolean;
  ranged?: boolean;
  armored?: boolean;
  elite?: boolean;
  boss?: boolean;
};

export type Zone = {
  id: string;
  name: string;
  start: number;
  end: number;
  skyTop: [number, number, number];
  skyBot: [number, number, number];
  grass: [number, number, number];
  bgSet: "normal" | "autumn" | "winter" | "castle";
  ground: "grass" | "autumn" | "stone";
  line: string;
};

export type Encounter = {
  x: number;
  zoneId: string;
  enemy: EnemySpec;
  line: string;
};

export const GOBLIN: EnemySpec = {
  kind: "goblin",
  title: "Forest Scamp",
  maxHp: 2,
  touchDamage: 1,
  attackPeriod: 3.6,
  telegraph: 1.1,
  moveSpeed: 55,
  preferredGap: 150
};

export const SHIELD_BEAST: EnemySpec = {
  kind: "shield_beast",
  title: "Oakhide Brute",
  maxHp: 3,
  touchDamage: 1,
  attackPeriod: 3.6,
  telegraph: 1.1,
  moveSpeed: 40,
  preferredGap: 165,
  hasShield: true
};

export const ARCHER: EnemySpec = {
  kind: "archer",
  title: "Hollowbow Scout",
  maxHp: 2,
  touchDamage: 1,
  attackPeriod: 3.2,
  telegraph: 1.0,
  moveSpeed: 35,
  preferredGap: 310,
  ranged: true
};

export const ARMORED: EnemySpec = {
  kind: "armored",
  title: "Ashen Knight",
  maxHp: 4,
  touchDamage: 1,
  attackPeriod: 3.0,
  telegraph: 1.0,
  moveSpeed: 70,
  preferredGap: 155,
  armored: true
};

export const ELITE: EnemySpec = {
  kind: "elite",
  title: "Crimson Captain",
  maxHp: 5,
  touchDamage: 1,
  attackPeriod: 2.9,
  telegraph: 1.0,
  moveSpeed: 62,
  preferredGap: 180,
  hasShield: true,
  ranged: true,
  elite: true
};

export const BOSS: EnemySpec = {
  kind: "boss",
  title: "Horned Warlord",
  maxHp: 8,
  touchDamage: 1,
  attackPeriod: 2.8,
  telegraph: 1.1,
  moveSpeed: 48,
  preferredGap: 190,
  hasShield: true,
  ranged: true,
  armored: true,
  boss: true
};

export const ZONES: Zone[] = [
  { id: "forest", name: "Hyrule Fringe", start: 0, end: 1900, skyTop: [110, 186, 230], skyBot: [255, 232, 150], grass: [62, 140, 58], bgSet: "normal", ground: "grass", line: "* The woods open. I will keep walking. You keep me armed." },
  { id: "deep", name: "Deepwood", start: 1900, end: 3800, skyTop: [48, 78, 92], skyBot: [120, 150, 90], grass: [36, 92, 48], bgSet: "normal", ground: "grass", line: "* The canopy thickens. They will hide behind bark and board." },
  { id: "range", name: "Amber Clearing", start: 3800, end: 5400, skyTop: [176, 122, 72], skyBot: [255, 196, 110], grass: [120, 92, 40], bgSet: "autumn", ground: "autumn", line: "* Open ground. Distance is their friend." },
  { id: "approach", name: "Castle Road", start: 5400, end: 7000, skyTop: [92, 108, 138], skyBot: [188, 196, 210], grass: [78, 86, 92], bgSet: "winter", ground: "stone", line: "* The hill wears a crown of stone. Their swings are quicker now." },
  { id: "castle", name: "Gate Hall", start: 7000, end: 8600, skyTop: [28, 22, 36], skyBot: [64, 42, 48], grass: [48, 36, 40], bgSet: "castle", ground: "stone", line: "* Echoes in the corridor. An old captain waits." },
  { id: "boss", name: "Throne of Night", start: 8600, end: 10200, skyTop: [18, 14, 28], skyBot: [70, 24, 36], grass: [32, 24, 30], bgSet: "castle", ground: "stone", line: "* One more door." }
];

export const ENCOUNTERS: Encounter[] = [
  { x: 720, zoneId: "forest", enemy: GOBLIN, line: "* Something small and angry. A clean slash will do." },
  { x: 1550, zoneId: "forest", enemy: GOBLIN, line: "* Another one. Same motion. Smoother this time." },
  { x: 2500, zoneId: "deep", enemy: SHIELD_BEAST, line: "* It will catch a flat cut. Lift the blade and come down." },
  { x: 3450, zoneId: "deep", enemy: SHIELD_BEAST, line: "* Wait for the board to dip, then cut, or go over it." },
  { x: 4600, zoneId: "range", enemy: ARCHER, line: "* Don't chase blindly. Guard, or draw." },
  { x: 6200, zoneId: "approach", enemy: ARMORED, line: "* Fast steel. A weak tap rings off the armor." },
  { x: 7800, zoneId: "castle", enemy: ELITE, line: "* Shield, bow, and blade. Match whatever it offers." },
  { x: 9200, zoneId: "boss", enemy: BOSS, line: "* The warlord. Survive the storm, then strike true." }
];

export function zoneAt(x: number): Zone {
  return ZONES.find((zone) => x >= zone.start && x < zone.end) ?? ZONES[ZONES.length - 1];
}

export function nextEncounter(x: number, cleared: number): Encounter | null {
  if (cleared >= ENCOUNTERS.length) return null;
  return ENCOUNTERS[cleared];
}
