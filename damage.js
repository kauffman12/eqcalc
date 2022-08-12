exports.Classes = { WAR: 2, CLR: 4, PAL: 8, RNG: 16, SHD: 32, DRU: 64, MNK: 128, BRD: 256, ROG: 512, SHM: 1024, NEC: 2048, WIZ: 4096, MAG: 8192, ENC: 16384, BST: 32768, BER: 65536 };

// 250 Luck = 47% -> 50%
// 200 Luck = 42% -> 45%
// 150 Luck = 37% -> 40%
//  80 Luck = 30% -> 33%
//  70 Luck = 29% -> 32%
//  60 Luck = 27% -> 32%
exports.LuckValues = [ [5, 10], [10, 15], [15, 20], [20, 25], [22, 27], [25, 30], [27, 32], [29, 32], [30, 33], [31, 34], [32, 35], [33, 36], [34, 37], [35, 38], [36, 39], [37, 40], [38, 41], [39, 42], [40, 43], [41, 44], [42, 45], [43, 46], [44, 47], [45, 48], [46, 49], [47, 50] ];

exports.MaxHitsTypes = { OUTGOING: 4, MATCHING: 7 };

exports.TickLength = 6000;

exports.roundAsDec32 = (value) => Math.round(+(value.toFixed(7)));

exports.randomInRange = (x, y) =>
{
  let high = x > y ? x : y;
  let low = x < y ? x : y;
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

exports.calculateDamage = (playerLevel, wornSpellDamage, spell, baseDamage, luck, isNuke, ticks, finalEffects) =>
{ 
  // SPA 413 focuses base damage but is rounded differently for DoTs
  let spa413 = finalEffects.spa413 * baseDamage / 100;
  let effectiveDamage = baseDamage + (isNuke ? Math.trunc(spa413) : exports.roundAsDec32(spa413));

  // start adding up damage that will be used in a crit
  let beforeCritDamage = effectiveDamage;

  // damage that does not crit for either Nuke or DoT
  let afterCritDamage = Math.trunc(finalEffects.spa286 / ticks);

  if (isNuke)
  {
    // spell damage will only crit for a Nuke
    beforeCritDamage += Math.trunc(exports.calculateSpellDamage(playerLevel, baseDamage, wornSpellDamage, spell));

    // SPA 302 will crit for a Nuke
    beforeCritDamage += Math.trunc(effectiveDamage * finalEffects.spa302 / 100);

    // SPA 124 does not crit for a Nuke
    afterCritDamage += Math.trunc(effectiveDamage * finalEffects.spa124 / 100);
  }
  else
  {
    // SPA 124 will crit for a DoT 
    beforeCritDamage += Math.trunc(effectiveDamage * finalEffects.spa124 / 100);

    // SPA 461 will crit for a DoT and it will also focus SPA 124
    beforeCritDamage += Math.trunc(beforeCritDamage * finalEffects.spa461 / 100);

    // SPA 302 will crit for a DoT and it will also focus SPA 461 and SPA 124
    beforeCritDamage += Math.trunc(beforeCritDamage * finalEffects.spa302 / 100);
  }

  // SPA 296 amount is based on effective damage
  let spa296 = Math.trunc(finalEffects.spa296 * effectiveDamage / 100);

  // SPA 296, 297, and 303 all crit as well
  beforeCritDamage += spa296 + finalEffects.spa297 + Math.trunc(finalEffects.spa303 / ticks);

  // did the spell crit?
  let critChance = spell.fixedCritChance >= 0 ? spell.fixedCritChance : (isNuke ? finalEffects.nukeCritChance : finalEffects.doTCritChance);

  let crit = Math.random() * 100 <= critChance;
  let lucky = crit && (Math.random() * 100 <= finalEffects.luckChance);

  // add lucky crit multiplier?
  let luckyCritMultiplier = lucky ? exports.randomInRange(exports.LuckValues[luck][0] * 100, exports.LuckValues[luck][1] * 100) / 100 : 0;

  // calculate crit damage
  let critMultiplier = luckyCritMultiplier + (isNuke ? finalEffects.nukeCritMultiplier : finalEffects.doTCritMultiplier);
  let critDamage = crit ? exports.roundAsDec32(beforeCritDamage * critMultiplier / 100) : 0;

  // get total so far
  let total = beforeCritDamage + critDamage + afterCritDamage;

  // SPA 461 for a Nuke will focus all damage to this point
  total += isNuke ? Math.trunc(total * finalEffects.spa461 / 100) : 0;

  // SPA 483 amount is based on effective damage
  let spa483 = Math.trunc(finalEffects.spa483 * effectiveDamage / 100);

  // SPA 462, 483, 484 and 507 are added to the end and not focused by anything else
  total += spa483 + Math.trunc(finalEffects.spa462 / ticks) + Math.trunc(finalEffects.spa484 / ticks);
  total += exports.roundAsDec32(finalEffects.spa507 * effectiveDamage / 1000); // 1000 is correct
  return { amount: total, crit: crit, lucky: lucky };
}

exports.calculateSpellDamage = (playerLevel, baseDamage, wornSpellDamage, spell) =>
{
  let spellDamage = 0;

  if ((playerLevel - spell.level) < 10)
  {
    let totalCastTime = spell.castTime + ((spell.recastTime > spell.lockoutTime) ? spell.recastTime : spell.lockoutTime);
    spellDamage = wornSpellDamage * exports.calculateScalingMultiplier(totalCastTime);
  }

  return spellDamage > baseDamage ? 1 : spellDamage;
}

exports.calculateScalingMultiplier = (castTime) =>
{
  let multiplier = 0.25;

  if (castTime >= 2500 && castTime <= 7000)
  {
    multiplier = (castTime - 1000) / 1000 * 1 / 6;
  }
  else if (castTime > 7000)
  {
    multiplier = castTime / 7000;
  }

  return multiplier;
}

exports.calculateValue = (calc, base1, max, tick, playerLevel) =>
{ 
  // default to base1 or max depending on normal calc values
  let result = (calc === 100 && max > 0 && base1 > max) ? max : base1;

  if (calc !== 0 && calc !== 100 && calc !== 3000) // 3000 unknown?
  {
    let change = 0;

    switch (calc)
    {
      case 101:
        change = playerLevel / 2;
        break;
      case 102:
        change = playerLevel;
        break;
      case 103:
        change = playerLevel * 2;
        break;
      case 104:
        change = playerLevel * 3;
        break;
      case 105:
        change = playerLevel * 4;
        break;
      case 107:
        change = -1 * tick;
        break;
      case 108:
        change = -2 * tick;
        break;
      case 109:
        change = playerLevel / 4;
        break;
      case 110:
        change = playerLevel / 6;
        break;
      case 111:
        change = (playerLevel > 16) ? (playerLevel - 16) * 6 : change;
        break;
      case 112:
        change = (playerLevel > 24) ? (playerLevel - 24) * 8 : change;
        break;
      case 113:
        change = (playerLevel > 34) ? (playerLevel - 34) * 10 : change;
        break;
      case 114:
        change = (playerLevel > 44) ? (playerLevel - 44) * 15 : change;
        break;
      case 115:
        change = (playerLevel > 15) ? (playerLevel - 15) * 7 : change;
        break;
      case 116:
        change = (playerLevel > 24) ? (playerLevel - 24) * 10 : change;
        break;
      case 117:
        change = (playerLevel > 34) ? (playerLevel - 34) * 13 : change;
        break;
      case 118:
        change = (playerLevel > 44) ? (playerLevel - 44) * 20 : change;
        break;
      case 119:
        change = playerLevel / 8;
        break;
      case 120:
        change = -5 * tick;
        break;
      case 121:
        change = playerLevel / 3;
        break;
      case 122:
        change = -12 * tick;
        break;
      case 123:
        change = exports.randomInRange(Math.abs(max), Math.abs(base1));
        break;
      case 124:
        change = (playerLevel > 50) ? playerLevel - 50 : change;
        break;
      case 125:
        change = (playerLevel > 50) ? (playerLevel - 50) * 2 : change;
        break;
      case 126:
        change = (playerLevel > 50) ? (playerLevel - 50) * 3 : change;
        break;
      case 127:
        change = (playerLevel > 50) ? (playerLevel - 50) * 4 : change;
        break;
      case 128:
        change = (playerLevel > 50) ? (playerLevel - 50) * 5 : change;
        break;
      case 129:
        change = (playerLevel > 50) ? (playerLevel - 50) * 10 : change;
        break;
      case 130:
        change = (playerLevel > 50) ? (playerLevel - 50) * 15 : change;
        break;
      case 131:
        change = (playerLevel > 50) ? (playerLevel - 50) * 20 : change;
        break;
      case 132:
        change = (playerLevel > 50) ? (playerLevel - 50) * 25 : change;
        break;
      case 139:
        change = (playerLevel > 30) ? (playerLevel - 30) / 2 : change;
        break;
      case 140:
        change = (playerLevel > 30) ? playerLevel - 30 : change;
        break;
      case 141:
        change = (playerLevel > 30) ? 3 * (playerLevel - 30) / 2 : change;
        break;
      case 142:
        change = (playerLevel > 30) ? 2 * (playerLevel - 60) : change;
        break;
      case 143:
        change = 3 * playerLevel / 4;
        break;
      default:
        if (calc > 0 && calc < 1000)
        {
          change = playerLevel * calc;
        }
        else if (calc >= 1000 && calc < 2000)
        {
          change = tick * (calc - 1000) * -1;
        }
        else if (calc >= 2000)
        {
          change = playerLevel * (calc - 2000);
        }
        break;
    }

    result = Math.abs(base1) + Math.floor(change);

    if (max !== 0 && result > Math.abs(max))
    {
      result = Math.abs(max);
    }

    if (base1 < 0)
    {
      result = -result;
    }
  }

  return result;
}
