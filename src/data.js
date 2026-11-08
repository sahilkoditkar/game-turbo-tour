// Static game data: cars, upgrades, career series, AI drivers.

export const CARS = [
  {
    id: 'classic', name: 'Retro 62 Roadster', price: 0,
    desc: 'Long-bonnet 1960s roadster modelled on the Jaguar E-Type: wire wheels, covered headlamps, open cockpit. Your first car: forgiving, sweet-handling and cheap to upgrade.',
    stats: { maxSpeed: 58, accel: 16, grip: 6.8, turn: 1.04, brake: 36 },
    shape: 'classic',
  },
  {
    id: 'raiden', name: 'Raiden RZ', price: 4500,
    desc: 'Twin-turbo 90s Japanese GT modelled on the Toyota Supra Mk4: soft curves, a tall hoop wing and big round tail lamps. A cheap first step up that loves upgrades.',
    stats: { maxSpeed: 62, accel: 18, grip: 7.2, turn: 1.06, brake: 38 },
    shape: 'raiden',
  },
  {
    id: 'muscle', name: 'Thunder V8', price: 9000,
    desc: 'A \'67 Mustang-style fastback with twin racing stripes. Monster straight-line speed, needs respect in the corners.',
    stats: { maxSpeed: 68, accel: 21, grip: 6.4, turn: 0.96, brake: 36 },
    shape: 'muscle',
  },
  {
    id: 'hornet', name: 'Hornet SS', price: 16000,
    desc: 'Modern V8 pony car modelled on the Chevrolet Camaro SS: angry black nose band, SS bonnet bulge, chopped roof, bold twin stripes.',
    stats: { maxSpeed: 71, accel: 22, grip: 7.0, turn: 1.0, brake: 40 },
    shape: 'pony',
  },
  {
    id: 'rally', name: 'Gravel King', price: 19000,
    desc: 'Modelled on the Toyota GR Yaris Rally1 in gravel trim. All-wheel drive; barely slows down on grass and gravel.',
    stats: { maxSpeed: 66, accel: 22, grip: 8.0, turn: 1.08, brake: 40, offroad: 0.88 },
    shape: 'rally',
  },
  {
    id: 'groupb', name: 'Group B Legend', price: 22000,
    desc: 'A 1985 Group B monster modelled on the Audi Sport quattro S1 E2: boxy flares, giant wing, all-wheel drive.',
    stats: { maxSpeed: 69, accel: 24, grip: 7.8, turn: 1.1, brake: 40, offroad: 0.84 },
    shape: 'groupb',
  },
  {
    id: 'mamba', name: 'Mamba GTS', price: 24000,
    desc: 'Front-engine V10 coupe modelled on the Dodge Viper GTS: endless bonnet, double-bubble roof, side pipes and twin stripes. Brutal, and a handful.',
    stats: { maxSpeed: 75, accel: 25, grip: 7.6, turn: 1.0, brake: 42 },
    shape: 'mamba',
  },
  {
    id: 'super', name: 'Vortex S9', price: 26000,
    desc: 'Mid-engine V10 wedge modelled on the Lamborghini Huracán EVO. Sharp, balanced, and very fast.',
    stats: { maxSpeed: 76, accel: 24, grip: 8.4, turn: 1.08, brake: 44 },
    shape: 'super',
  },
  {
    id: 'kaze', name: 'Kaze R1', price: 30000,
    desc: 'Mid-engine V6 coupe modelled on the original Honda NSX: pop-up lamps, glass canopy, full-width tail lights. Light, precise and easy to drive fast.',
    stats: { maxSpeed: 74, accel: 22, grip: 8.4, turn: 1.12, brake: 44 },
    shape: 'kaze',
  },
  {
    id: 'fiamma', name: 'Fiamma V12', price: 40000,
    desc: 'Mid-engine V12 targa modelled on the Ferrari F50: covered headlamps, twin bonnet vents, a full-width wing growing out of the rear wings.',
    stats: { maxSpeed: 79, accel: 25, grip: 8.5, turn: 1.08, brake: 45 },
    shape: 'v12',
  },
  {
    id: 'centro', name: 'Centro GT', price: 50000,
    desc: 'Central-seat V12 hypercar modelled on the McLaren F1: roof snorkel, compact canopy, big side scoops and round lamps in a black tail. The fastest thing with number plates.',
    stats: { maxSpeed: 85, accel: 26, grip: 9.0, turn: 1.12, brake: 47 },
    shape: 'centro',
  },
  {
    id: 'formula', name: 'Turbo F1', price: 60000,
    desc: 'A 2022-rules ground-effect Formula 1 car with halo and 18-inch wheels. The fastest thing on four wheels.',
    stats: { maxSpeed: 90, accel: 27, grip: 9.8, turn: 1.18, brake: 52 },
    shape: 'formula',
  },
];

/**
 * Cars that left the roster, with the car a save that owned one is given instead and the
 * price refunded when it already owns that one (see career.loadProfile).
 */
export const RETIRED_CARS = {
  hatch: { to: 'classic', price: 0 },
  gt: { to: 'hornet', price: 14000 },
  proto: { to: 'fiamma', price: 32000 },
  hyper: { to: 'fiamma', price: 48000 },
};

export const UPGRADES = [
  { id: 'engine', name: 'Engine', desc: '+top speed, +acceleration', maxLevel: 5 },
  { id: 'tires', name: 'Tires', desc: '+cornering grip', maxLevel: 5 },
  { id: 'brakes', name: 'Brakes', desc: '+braking power', maxLevel: 5 },
  { id: 'aero', name: 'Aero kit', desc: '+turn-in response, +high-speed stability', maxLevel: 5 },
];

export function upgradeCost(car, upgradeId, currentLevel) {
  const base = 900 + car.price * 0.045;
  return Math.round((base * Math.pow(currentLevel + 1, 1.45)) / 50) * 50;
}

/** Apply upgrade levels to a car's base stats. */
export function effectiveStats(car, levels = {}) {
  const e = levels.engine || 0, t = levels.tires || 0, b = levels.brakes || 0, a = levels.aero || 0;
  const s = car.stats;
  return {
    maxSpeed: s.maxSpeed * (1 + 0.045 * e),
    accel: s.accel * (1 + 0.07 * e),
    grip: s.grip * (1 + 0.06 * t + 0.02 * a),
    turn: s.turn * (1 + 0.035 * a),
    brake: s.brake * (1 + 0.08 * b),
    offroad: s.offroad,
  };
}

export const PLAYER_COLORS = [
  0xff5a1f, 0x2f7bff, 0x3ddc84, 0xffd23f, 0xb04cff, 0xff4d9d, 0x00d4ff, 0xffffff,
];

export const AI_COLORS = [
  0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0x16a085, 0xd35400, 0x7f8c8d,
  0x2c3e50, 0xe91e63, 0x00bcd4, 0x9e9d24,
];

export const AI_DRIVERS = [
  { name: 'M. Vettore', skill: 1.00 },
  { name: 'K. Raiko', skill: 0.97 },
  { name: 'L. Hamil', skill: 0.99 },
  { name: 'S. Perez-Ortiz', skill: 0.94 },
  { name: 'A. Nakamura', skill: 0.95 },
  { name: 'J. Kowalski', skill: 0.91 },
  { name: 'D. Okafor', skill: 0.93 },
  { name: 'E. Lindqvist', skill: 0.90 },
  { name: 'R. Da Silva', skill: 0.92 },
  { name: 'T. Brennan', skill: 0.88 },
  { name: 'Y. Petrova', skill: 0.89 },
  { name: 'F. Moreau', skill: 0.87 },
];

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export const SERIES = [
  {
    id: 'rookie', name: 'Rookie Cup', tier: 1,
    desc: 'Three short races against club drivers. Win it to earn your Pro licence.',
    aiCount: 5, aiSkill: 0.72, requires: null, requireRank: 3, level: 1,
    prize: [3000, 2200, 1600, 1100, 800, 500],
    bonus: 6000,
    events: [
      { track: 'sunrise', laps: 2 },
      { track: 'coastal', laps: 2 },
      { track: 'alpine', laps: 2 },
    ],
  },
  {
    id: 'pro', name: 'Pro Series', tier: 2,
    desc: 'Longer races, sharper opponents, real prize money.',
    aiCount: 7, aiSkill: 0.9, requires: 'rookie', requireRank: 3, level: 5,
    prize: [6000, 4400, 3200, 2400, 1800, 1200, 800, 500],
    bonus: 15000,
    events: [
      { track: 'desert', laps: 3 },
      { track: 'monza', laps: 2 },
      { track: 'neon', laps: 3 },
      { track: 'interlagos', laps: 2 },
      { track: 'coastal', laps: 3 },
    ],
  },
  {
    id: 'gp', name: 'Grand Prix Championship', tier: 3,
    desc: 'The world championship. Nine elite drivers, six circuits, no mercy.',
    aiCount: 9, aiSkill: 1.0, requires: 'pro', requireRank: 2, level: 8,
    prize: [14000, 10000, 7500, 5500, 4000, 3000, 2200, 1500, 1000, 600],
    bonus: 40000,
    events: [
      { track: 'silverstone', laps: 3 },
      { track: 'alpine', laps: 4 },
      { track: 'monza', laps: 3 },
      { track: 'spa', laps: 3 },
      { track: 'interlagos', laps: 3 },
      { track: 'neon', laps: 4 },
    ],
  },
  {
    id: 'legends', name: 'Legends Endurance', tier: 4,
    desc: 'Long-distance showdown for champions only. Everything you own, on the line.',
    aiCount: 11, aiSkill: 1.06, requires: 'gp', requireRank: 1, level: 12,
    prize: [30000, 20000, 14000, 10000, 8000, 6000, 4500, 3500, 2500, 2000, 1500, 1000],
    bonus: 100000,
    events: [
      { track: 'spa', laps: 5 },
      { track: 'silverstone', laps: 5 },
      { track: 'monza', laps: 6 },
      { track: 'neon', laps: 6 },
    ],
  },
];

export function getCar(id) { return CARS.find(c => c.id === id) || CARS[0]; }
export function getSeries(id) { return SERIES.find(s => s.id === id); }
