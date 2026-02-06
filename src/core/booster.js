import { CARDS } from "./cards.js";

// odds = { common: 0.78, rare: 0.18, epic: 0.035, legendary: 0.005 }
function rollRarity(odds) {
  const r = Math.random();
  const c = odds.common ?? 0;
  const ra = (odds.rare ?? 0) + c;
  const e = (odds.epic ?? 0) + ra;
  // le reste = legendary
  if (r < c) return "common";
  if (r < ra) return "rare";
  if (r < e) return "epic";
  return "legendary";
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Ouvre un booster en filtrant les cartes par boosterId.
 */
export function openBooster(count, boosterId, odds, allowNames = null) {
  const basePool = CARDS.filter(c => c.booster === boosterId);

  if (basePool.length === 0) {
    console.warn("WARN: Aucune carte trouvée pour booster:", boosterId);
    return [];
  }

  let pool = basePool;
  if (Array.isArray(allowNames) && allowNames.length > 0) {
    const filtered = basePool.filter(c => allowNames.includes(c.name));
    if (filtered.length === 0) {
      console.warn("WARN: Pool filtré vide, fallback sur le pool complet pour:", boosterId);
    } else {
      pool = filtered;
    }
  }

  const byRarity = {
    common: pool.filter(c => c.rarity === "common"),
    rare: pool.filter(c => c.rarity === "rare"),
    epic: pool.filter(c => c.rarity === "epic"),
    legendary: pool.filter(c => c.rarity === "legendary"),
  };

  const out = [];
  for (let i = 0; i < count; i++) {
    let rarity = rollRarity(odds);

    // sécurité : si pas de cartes de cette rareté, on redescend
    let tries = 0;
    while (tries < 10 && (!byRarity[rarity] || byRarity[rarity].length === 0)) {
      rarity = rarity === "legendary" ? "epic"
            : rarity === "epic" ? "rare"
            : "common";
      tries++;
    }

    const chosen = pickRandom(byRarity[rarity] && byRarity[rarity].length ? byRarity[rarity] : pool);
    out.push(chosen);
  }

  return out;
}


