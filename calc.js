const Classes =
{
  WAR: 2, CLR: 4, PAL: 8, RNG: 16, SHD: 32, DRU: 64, MNK: 128, BRD: 256, ROG: 512,  SHM: 1024, NEC: 2048,
  WIZ: 4096, MAG: 8192, ENC: 16384, BST: 32768, BER: 65536
}

const Resists =
{
  Unresistable: 0, Magic:1, Fire: 2, Cold: 3, Poison: 4, Disease: 5, Lowest: 6, Average: 7, Physical: 8, Corruption: 9
}

const Skills =
{
  Abjuration: 4, Alteration: 5, Conjuration: 14, Divination: 18, Evocation: 24, General: 98
}

const Targets = 
{
  LineOfSight: 1, CasterAE: 2, CasterGroup: 3, CasterPB: 4, Single: 5, Self: 6, TargetAE: 8, Lifetap: 13, FrontalAE: 44, TargetRingAE: 45
}

class Slot
{
  constructor(num, spa, base1 = 0, base2 = 0, max = 0, calc = 100)
  {
      this.num = num;
      this.spa = spa;
      this.base1 = base1;
      this.base2 = base2;
      this.max = max;
      this.calc = calc;
  }
}

class AA
{
  constructor(name, id, rank, slotList)
  {
    this.name = name;
    this.id = id;
    this.rank = rank;
    this.slotList = slotList;
  }
}

class Worn
{
  constructor(name, id, slotList)
  {
    this.name = name;
    this.id = id;
    this.slotList = slotList;
  }
}

class EffectsState
{
  constructor()
  {
    this.dotCritChance = 0.0;
    this.doTCritMultiplier = 0.0;
    this.nukeCritChance = 0.0;
    this.nukeCritMultiplier = 0.0;
    this.spa124 = 0;
    this.spa127 = 0;
    this.spa286 = 0;
    this.spa296 = 0;
    this.spa297 = 0;
    this.spa302 = 0;
    this.spa303 = 0;
    this.spa399 = 0;
    this.spa413 = 0;
    this.spa461 = 0;
    this.spa462 = 0;
  }
}

class LimitChecks
{
  hasLimitsToCheck()
  {
    return Object.getOwnPropertyNames(this).length > 0;
  }

  passed()
  {
    let list = Object.getOwnPropertyNames(this);

    for (let i=0; i<list.length; i++)
    {
      if (this[list[i]] === false)
      {
        return false;
      }
    }

    return true;
  }  
}

class SpellDatabase
{
  constructor()
  {
    this.spellGroups = new Map();

    let groups = require('./data/spellGroups.json');
    groups.forEach(group => this.addSpellGroup(group.id, group.spells));
  }

  addSpellGroup(groupId, list)
  {
    this.spellGroups.set(groupId, new Set(list));
  }

  isSpellInGroup(spellId, groupId)
  {
    let group = this.spellGroups.get(groupId);
    return (group && group.has(spellId)) === true;
  }
}

class PlayerState
{
  constructor(level, playerClass, spellDamage)
  {
    this.level = level;
    this.playerClass = playerClass;
    this.spellDamage = spellDamage;
    this.baseDoTCritChance = 0;
    this.baseDoTCritMultiplier = 0;
    this.baseNukeCritChance = 0;
    this.baseNukeCritMultiplier = 100;
    this.passiveAAMap = new Map();
    this.wornMap = new Map();
    this.spellMap = new Map();
  }

  addAA(aa)
  {
    this.passiveAAMap.set(aa.id, aa);
  }

  addWorn(worn)
  {
    this.wornMap.set(worn.id, worn);
  }

  addSpell(spell)
  {
    this.spellMap.set(spell.id, spell);
  }

  buildEffects(spell, slot, chargedSpells)
  {
    let allEffects = new Map();
    this.updateEffectsInCategory(this.passiveAAMap, allEffects, spell, slot);

    let spellCategory = new Map();
    this.updateEffectsInCategory(this.spellMap, spellCategory, spell, slot, chargedSpells);
    this.addEffectCategory(allEffects, spellCategory);

    let wornCategory = new Map();
    this.updateEffectsInCategory(this.wornMap, wornCategory, spell, slot);
    this.addEffectCategory(allEffects, wornCategory);

    let totalEffects = new Map();
    allEffects.forEach((slots, spa) => totalEffects.set(spa, Array.from(slots.values()).reduce((a, b) => a + b, 0)));

    let finalEffects = new EffectsState();
    finalEffects.doTCritChance = this.baseDoTCritChance;
    finalEffects.doTCritMultiplier = this.baseDoTCritMultiplier;
    finalEffects.nukeCritChance = this.calculateBaseNukeCritChance();
    finalEffects.nukeCritMultiplier = this.baseNukeCritMultiplier;

    totalEffects.forEach((value, spa) =>
    {
      switch(spa)
      {
        case 124: case 127: case 286: case 296: case 297: case 302: case 303: case 399: case 413: case 461: case 462:
          finalEffects['spa' + spa] = value;
          break;
        case 170:
          finalEffects.nukeCritMultiplier += spell.isNuke() ? value : 0;
          break;
        case 273:
          finalEffects.doTCritChance += spell.isDoT() ? value : 0;
          break;
        case 212: case 294:
          finalEffects.nukeCritChance += spell.isNuke() ? value : 0;
          break;
        case 375:
          finalEffects.doTCritMultiplier += spell.isDoT() ? value : 0;
          break;
      }
    });

    // DoT classes have same base 100% but it does not stack with Destructive Cascade
    // unlike Destructive Fury and Nukes
    if (!finalEffects.doTCritMultiplier)
    {
      finalEffects.doTCritMultiplier = 100;
    }

    return finalEffects;
  }

  addEffectCategory(result, category)
  {
    category.forEach((updates, spa) =>
    {
      let spaSlots = result.get(spa);
      if (!spaSlots)
      {
        result.set(spa, updates);
      }
      else
      {
        updates.forEach((value, num) => spaSlots.set(num, (spaSlots.get(num) || 0) + value));
        result.set(spa, spaSlots);
      }
    });
  }

  calculateBaseNukeCritChance()
  {
    return this.baseNukeCritChance + (this.playerClass == Classes.WIZ ? Math.ceil(Math.random() * 3) : 0);
  }
 
  updateEffectsInCategory(effectMap, category, spell, currentSpellSlot, chargedSpells)
  {
    effectMap.forEach((effect, effectId) =>
    {
      let updatedValue = {};
      let checks = new LimitChecks();

      effect.slotList.forEach(slot =>
      {
        switch(slot.spa)
        {
          // Ignore
          case 119: case 125: case 128: case 129: case 130: case 131: case 132: case 133:
          case 161: case 162: case 279: case 280: case 364:
            // before going on to a non-limit check, check if previous had passed and start over to handle multiple sections in one spell
            if (this.processUpdates(category, updatedValue, checks, effect, chargedSpells))
            {
              updatedValue = {};
              checks = new LimitChecks();
            }
            break;

          // Crit Modifiers
          case 170: case 212: case 273: case 294: case 375:
            // before going on to a non-limit check, check if previous had passed and start over to handle multiple sections in one spell
            if (this.processUpdates(category, updatedValue, checks, effect, chargedSpells))
            {
              updatedValue = {};
              checks = new LimitChecks();
            }
            
            // if base2 is specified than assume a range of values are possible between base1 and base2
            // may as well roll a value here
            this.addValue(category, updatedValue, slot, slot.base1);  
            break;

          // Spell Focus - supports a range of values
          case 124: case 127: case 286: case 296: case 297: case 302: case 303: case 399: case 413: case 461: case 462:        
            // before going on to a non-limit check, check if previous had passed and start over to handle multiple sections in one spell
            if (this.processUpdates(category, updatedValue, checks, effect, chargedSpells))
            {
              updatedValue = {};
              checks = new LimitChecks();
            }
            
            // if base2 is specified than assume a range of values are possible between base1 and base2
            // may as well roll a value here
            let value = (slot.base2 === 0) ? slot.base1 : Math.floor(Math.random() * (slot.base2 - slot.base1 + 1)) + slot.base1;
            this.addValue(category, updatedValue, slot, value);
            break;

          // Limit Checks
          case 134:
            // max level but also handles decay if base2 is set
            let difference = spell.level - slot.base1;
            checks.maxLevel = difference <= 0 ? true : this.reduceValues(updatedValue, difference * slot.base2);
            break;
          case 135:
            // pass if any resist check matches
            checks.resist = checks.resist || slot.base1 === spell.resist;
            break;
          case 136:
            // this SPA may appear multiple times
            // exclude spells with specified target
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.target = checks.target === false ? checks.target : spell.target !== Math.abs(slot.base1);
            }
            // only include spells with specified target
            else if (slot.base1)
            {
              // needs to pass if any of the include checks match
              checks.target = checks.target || spell.target === Math.abs(slot.base1);
            }
            break;
          case 137:
            // result spells have negative value in base1 while heals have a positive value so check for non zero
            checks.currentHp = checks.currentHp || (currentSpellSlot.spa === slot.base1 && currentSpellSlot.base1 !== 0);
            break;
          case 138:
            // checks for both cases where beneficial spells are required ot detrimental spells are required
            checks.detrimental = (spell.beneficial && slot.base1 === 1) || (!spell.beneficial && slot.base1 !== 1)
            break;
          case 140:
            checks.minDuration = spell.duration >= slot.base1;
            break;
          case 141:
            // this SPA always seems to enforce 0 duration spells
            checks.duration = (slot.base1 === 1 && spell.duration === 0);
            break;
          case 142:
            checks.minLevel = spell.level >= slot.base1;
            break;
          case 143:
            checks.minCastTime = spell.castTime >= slot.base1;
            break;
          case 144:
            checks.maxCastTime = spell.castTime <= slot.base1;
            break;
          case 311:
            // exclude combat skills
            checks.combatSkills = currentSpellSlot.spa !== 193;
            break;
          case 348:
            checks.minMana = spell.manaCost >= slot.base1;
            break;
          case 385:
            // check passes if the current spell matches any of the listed spell groups
            // this SPA may appear multiple times
            checks.spellGroup = checks.spellGroup || SPELLS.isSpellInGroup(spell.id, slot.base1);
            break;
          case 411:
            checks.playerClass = (slot.base1 & this.playerClass) === this.playerClass;
            break;
          case 480:
            // only one check needs to pass
            checks.minValue = checks.minValue || (currentSpellSlot.spa === slot.base2 && currentSpellSlot.base1 <= slot.base1);
            break;
          case 495:
            checks.maxDuration = spell.duration <= slot.base1;
            break;
          default:
            console.debug("Unhandled SPA > " + slot.spa);
        }
      });
  
      // processing remaining
      this.processUpdates(category, updatedValue, checks, effect, chargedSpells);
    });
  }

  addValue(category, updatedValue, slot, value)
  {
    let handledSlots = category.get(slot.spa);
    let max = handledSlots ? Math.max(value, handledSlots.get(slot.num) || 0) : value;
    if (!handledSlots || !handledSlots.has(slot.num) || max > handledSlots.get(slot.num))
    {
      updatedValue.spa = slot.spa;
      updatedValue.num = slot.num;
      updatedValue.max = max;
    }
  }

  processUpdates(category, updatedValue, checks, effect, chargedSpells)
  {
    let updated = false;
    if (updatedValue && updatedValue.spa !== undefined && (!checks.hasLimitsToCheck() || checks.passed()))
    {
      this.updateCategory(category, updatedValue);
      updated = true;

      // only attempt to count charges if limits were required to pass
      if (chargedSpells !== undefined && checks.hasLimitsToCheck() && effect.maxHits > 0)
      {
        chargedSpells.set(updatedValue.spa + '-' + updatedValue.num, effect);
      }
    }

    return updated;
  }

  reduceValues(updatedValue, amount)
  {
    let reduced = Spell.truncAsDec32(updatedValue.max - (updatedValue.max * amount / 100));
    updatedValue.max = reduced > 0 ? reduced : 0;
    return reduced > 0 ? true : remaining;
  }

  updateCategory(category, updatedValue)
  {
    let handledSlots = category.get(updatedValue.spa) || new Map();
    handledSlots.set(updatedValue.num, updatedValue.max);   
    category.set(updatedValue.spa, handledSlots);
  }
}

class Spell
{
  constructor(name, id, level, beneficial, manaCost, slotList, maxHits, castTime, recastTime, lockoutTime, duration, resist, target, skill, fixedCritChance)
  {
    this.name = name;
    this.id = id;
    this.level = level;
    this.beneficial = beneficial;
    this.maxHits = maxHits;
    this.remainingHits = maxHits;
    this.manaCost = manaCost;
    this.slotList = slotList;
    this.castTime = castTime;
    this.actualCastTime = castTime;
    this.recastTime = recastTime;
    this.lockoutTime = lockoutTime;
    this.duration = duration;
    this.resist = resist;
    this.target = target;
    this.skill = skill;
    this.fixedCritChance = fixedCritChance;
  }

  cast(state)
  {
    let results = [];

    this.slotList.forEach(slot =>
    {
      switch(slot.spa)
      {
        case 0: case 79: case 127: case 399:
          let chargedSpells = new Map();
          let finalEffects = state.buildEffects(this, slot, chargedSpells);
          console.debug(finalEffects);
        
          if (finalEffects.spa127 !== undefined)
          {
            this.actualCastTime = this.castTime - (this.castTime * finalEffects.spa127 / 100);
          }

          if (slot.spa === 0 || slot.spa === 79)
          {
            // calculate damage for one cast
            results.push(this.calculateDamage(state, slot, finalEffects));

            if (finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399)
            {
              let result = this.calculateDamage(state, slot, finalEffects);
              result.twincast = true;
              results.push(result);
            }
          }

          // apply charges
          Array.from(chargedSpells.values()).forEach(spell => 
          {
            if (--spell.remainingHits === 0 && state.spellMap.has(spell.id))
            {
              state.spellMap.delete(spell.id);
            }
          });
          break;
      }
    });

    return results;
  }

  calculateDamage(state, slot, finalEffects)
  {
    let total = 0;
    let isCrit = false;
    let critChance;
    let critMultiplier;

    let baseDamage = Math.abs(slot.base1);
    let effectiveDamage = baseDamage + Spell.truncAsDec32(finalEffects.spa413 * baseDamage / 100);
    let beforeCritDamage = effectiveDamage + finalEffects.spa297 + finalEffects.spa303;
    beforeCritDamage += Spell.truncAsDec32((finalEffects.spa296 + finalEffects.spa302) * effectiveDamage / 100);

    if (this.duration === 0)
    {
      critChance = finalEffects.nukeCritChance;
      critMultiplier = finalEffects.nukeCritMultiplier;
      beforeCritDamage += Spell.truncAsDec32(this.calculateSpellDamage(state));
      total = beforeCritDamage + Spell.truncAsDec32(effectiveDamage * finalEffects.spa124 / 100);
    }
    else
    {
      critChance = finalEffects.doTCritChance;
      critMultiplier = finalEffects.doTCritMultiplier;
      beforeCritDamage += Spell.roundAsDec32(beforeCritDamage * finalEffects.spa124 / 100);
      total = beforeCritDamage;
    }
    
    total += finalEffects.spa286;

    if (Math.random() * 100 <= critChance)
    {
      isCrit = true;
      total += Spell.roundAsDec32(beforeCritDamage * critMultiplier / 100);
    }

    total += Spell.truncAsDec32(total * finalEffects.spa461 / 100);
    total += finalEffects.spa462;

    return { damage: total, crit: isCrit };
  }

  calculateSpellDamage(state)
  {
    let spellDamage = 0;

    if ((state.level - this.level) < 10)
    {
      let multiplier = 0.2499;
      let totalCastTime = this.castTime + ((this.recastTime > this.lockoutTime) ? this.recastTime : this.lockoutTime);

      if (totalCastTime >= 2500 && totalCastTime <= 7000)
      {
        multiplier = .000167 * (totalCastTime - 1000);
      }
      else if(totalCastTime > 7000)
      {
        multiplier = 1.0 * totalCastTime / 7000;
      }

      spellDamage = state.spellDamage * multiplier;
    }

    return spellDamage;
  }

  isDoT()
  {
    return this.duration > 0;
  }

  isNuke()
  {
    return this.duration === 0;
  }

  static roundAsDec32(value)
  {
    return Math.round(+(value.toFixed(7)));
  }

  static truncAsDec32(value)
  {
    return Math.trunc(+(value.toFixed(7)));
  }
}

let SPELLS = new SpellDatabase();

let twincastAA = new AA('Twincast', 1405, 5, [new Slot(1, 399, 5), new Slot(2, 141, 1), new Slot(3, 138), new Slot(4, 134, 254), new Slot(5, 348, 10), new Slot(6, 137), new Slot(7, 311), new Slot(8, 137, -152), new Slot(9, 137, -39)]);
let quickDamage = new AA('Quick Damage', 44, 10, [new Slot(1, 127, 20), new Slot(2, 137), new Slot(3, 138), new Slot(4, 141, 1), new Slot(5, 143, 3000), new Slot(6, 127, 20), new Slot(7, 385, 16555), new Slot(8, 385, 16655), new Slot(9, 385, 16755), new Slot(10, 127, 20), new Slot(11, 137), new Slot(12, 138), new Slot(13, 141, 1), new Slot(14, 144, 2999), new Slot(15, 134, 253)]);
let eyeOfDecay = new Worn('Eyes of Life and Decay', 129887, [new Slot(1, 413, 10), new Slot(2, 411, 131070), new Slot(3, 134, 110), new Slot(4, 137), new Slot(5, 137, 79), new Slot(6, 137, 100), new Slot(7, 137, 193)]);
let iog = new Spell('Illusions of Grandeur III', 51599, 255, true, 0, [new Slot(4, 273, 13), new Slot(5, 294, 13), new Slot(6, 375, 120), new Slot(12, 170, 160)]);
let arrow = new Spell('Elemental Arrow X', 51152, 255, false, 0, [new Slot(1, 296, 10, 15), new Slot(2, 135, 2), new Slot(3, 135, 3)]);
let fireDamage = new Worn('Fire result 70-120 L115', 45947, [new Slot(1, 124, 70, 120), new Slot(2, 134, 115, 5), new Slot(3, 137), new Slot(5, 138), new Slot(6, 136, -2), new Slot(7, 136, -4), new Slot(8, 136, -8), new Slot(11, 311), new Slot(12, 135, 2)]);
let tdsAria = new Spell('Aria of Maetanrus Rk. II', 44002, 101, true, 150, [new Slot(1, 124, 44, 44), new Slot(2, 119, 25, 0, 25), new Slot(3, 137), new Slot(4, 134, 105, 5), new Slot(5, 138), new Slot(6, 136, -2), new Slot(7, 136, -4), new Slot(8, 136, -8), new Slot(9, 311), new Slot(10, 364, 40), new Slot(11, 279, 40), new Slot(12, 280, 40)]);
let aria = new Spell('Aria of Begalru Rk. III', 56137, 106, true, 173, [new Slot(1, 124, 45, 45), new Slot(2, 119, 25, 0, 25), new Slot(3, 137), new Slot(4, 134, 110, 5), new Slot(5, 138), new Slot(6, 136, -2), new Slot(7, 136, -4), new Slot(8, 136, -8), new Slot(9, 311), new Slot(10, 364, 40), new Slot(11, 279, 40), new Slot(12, 280, 40)]);
let oldAriaAura = new Spell('Aura of Begalru Rk. III', 56230, 106, true, 150, [new Slot(1, 124, 31, 31), new Slot(2, 119, 25, 0, 25), new Slot(3, 137), new Slot(4, 134, 110, 5), new Slot(5, 138), new Slot(6, 136, -2), new Slot(7, 136, -4), new Slot(8, 136, -8), new Slot(9, 311), new Slot(10, 364, 40), new Slot(11, 279, 40), new Slot(12, 280, 40)]);
let qunard = new Spell('Qunard\'s Aria Rk. III', 56191, 108, true, 0, [new Slot(1, 286, 1987), new Slot(2, 137), new Slot(3, 142, 101), new Slot(4, 134, 110, 5), new Slot(5, 138), new Slot(6, 136, -2), new Slot(7, 136, -4), new Slot(8, 136, -8), new Slot(9, 136, -17), new Slot(10, 141, 1), new Slot(11, 348, 10), new Slot(12, 135, 2)]);
let nilsara = new Spell('Nilsara\'s Aria Rk. II', 44056, 103, true, 0, [new Slot(1, 286, 1560), new Slot(2, 137), new Slot(3, 142, 96), new Slot(4, 134, 105, 5), new Slot(5, 138), new Slot(6, 136, -2), new Slot(7, 136, -4), new Slot(8, 136, -8), new Slot(9, 136, -17), new Slot(10, 141, 1), new Slot(11, 348, 10), new Slot(12, 135, 2)]);
let encSynergy = new Spell('Beguiler\'s Synergy II', 51006, 255, true, 0, [new Slot(1, 461, 45, 45), new Slot(2, 135, 1), new Slot(3, 135, 2), new Slot(4, 135, 3), new Slot(5, 134, 249), new Slot(6, 480, -100), new Slot(7, 480, -100, 79)]);
let threads = new Worn('Threads of Potential', 50833, [new Slot(1, 462, 5000), new Slot(2, 137), new Slot(3, 137, 79), new Slot(4, 138), new Slot(5, 348, 100), new Slot(6, 311)]);

let arcaneDestruction = new Spell('Arcane Destruction V', 36942, 254, true, 0, [new Slot(1, 212, 60, 20), new Slot(2, 141, 1), new Slot(3, 138), new Slot(4, 480, -100), new Slot(5, 311), new Slot(6, 348, 10), new Slot(8, 162, 100, 350000, 350000), new Slot(9, 161, 100, 350000, 350000)], 24);
let frenzied = new Spell('Frenzied Devastation XXX', 51508, 254, true, 0, [new Slot(1, 212, 51, 50), new Slot(2, 141, 1), new Slot(3, 138), new Slot(4, 480, -100), new Slot(5, 311), new Slot(6, 348, 10), new Slot(8, 170, 85)], 55);
let newSkyfire = new Spell('New Skyfire Rk. II', 60165, 115, false, 8894, [new Slot(1, 0, -53052, 0, 53052)], 0, 3750, 5500, 1500, 0, Resists.Fire, Targets.Single, Skills.Evocation);
let skyfire = new Spell('Ethereal Skyfire Rk. III', 56872, 110, false, 6196, [new Slot(1, 0, -40421, 0, 40421)], 0, 3750, 5500, 1500, 0, Resists.Fire, Targets.Single, Skills.Evocation);
let skyfireType3 = new Worn('Type 3 FC Ethereal Skyfire', 57723, [new Slot(1, 303, 2887), new Slot(2, 385, 16700)]);
let etherealDamage = new Worn('WIZ Ethereal 9', 45815, [new Slot(1, 302, 9), new Slot(2, 385, 16800), new Slot(3, 385, 16700), new Slot(4, 385, 16600), new Slot(5, 385, 16500)]);
let destructiveAdept = new AA('Destructive Adept', 1263, 8, [new Slot(1, 124, 8), new Slot(2, 138), new Slot(3, 141, 1), new Slot(4, 348, 10)]);
let destructiveFury = new AA('Destructive Fury', 397, 36, [new Slot(1, 170, 325)]);
let furyOfMagic = new AA('Fury of Magic', 114, 35, [new Slot(1, 294, 50, 0)]);
let keepers = new AA('Power of the Keepers', 476, 5, [new Slot(7, 273, 1), new Slot(9, 294, 1)]);
let focusSkyblaze = new AA('Focus: Ethereal Skyblaze', 1292, 11, [new Slot(1, 413, 20), new Slot(2, 385, 16600), new Slot(3, 385, 16700), new Slot(4, 385, 16800)]);
let veng = new AA('Sorcerer\'s Vengeance', 850, 20, [new Slot(1, 286, 4000), new Slot(2, 138), new Slot(3, 134, 254)]);

let pyreShade = new Spell('Pyre of the Shadewarden Rk. II', 56640, 109, false, 3573, [new Slot(1, 0, -4900, 4900, 100)], 0, 3000, 1500, 1500, 5, Resists.Fire, Targets.Single, Skills.Alteration);
let pyreDamage = new Worn('NEC Pyre & Swift Sickness 7', 45782, [new Slot(1, 302, 7), new Slot(2, 385, 9729), new Slot(3, 385, 9744)]);
let criticalAfflication = new AA('Critical Affliction', 628, 33, [new Slot(1, 273, 61)]);
let funeral = new Spell('Funeral Pyre II', 41175, 254, true, 0, [new Slot(7, 124, 40, 40), new Slot(8, 137), new Slot(9, 140, 2), new Slot(10, 138), new Slot(11, 348, 10), new Slot(12, 134, 110)]);
let focusJorbb = new AA('Focus: Pyre of Jorobb', 1072, 11, [new Slot(1, 413, 20), new Slot(2, 385, 9629), new Slot(3, 385, 9729)]);
let focusEssence = new AA('Focus: Hemorrhage Essence', 888, 11, [new Slot(1, 413, 20), new Slot(2, 385, 9606), new Slot(3, 385, 9706)]);
let enhancedDecay = new AA('Enhanced Decay', 613, 7, [new Slot(1, 461, 175), new Slot(2, 137), new Slot(3, 138), new Slot(4, 348, 1), new Slot(5, 140, 3), new Slot(6, 495, 4), new Slot(7, 461, 140), new Slot(8, 137), new Slot(9, 138), new Slot(10, 348, 1), new Slot(11, 140, 5), new Slot(12, 495, 5)]);
let destructiveCascade = new AA('Destructive Cascade', 3815, 39, [new Slot(1, 375, 375)]);
let furyOfMagic2 = new AA('Fury of Magic', 215, 30, [new Slot(1, 294, 57, 0)]);
let destructiveFury2= new AA('Destructive Fury', 398, 38, [new Slot(1, 170, 340)]);
let consume = new Spell('Consume Essence Rk. II', 56546, 106, false, 1906, [new Slot(1, 0, -7104, 0, 7104)], 0, 3200, 1500, 1500, 0, Resists.Magic, Targets.Lifetap, Skills.Alteration);
let burningShadow = new Spell('Burning Shadow Rk. II', 56702, 110, false, 2168, [new Slot(1, 297, 508), new Slot(2, 0, -2753, 0, 2753), new Slot(3, 137), new Slot(4, 138), new Slot(5, 348, 10), new Slot(6, 311), new Slot(7, 136, 13)], 0, 3000, 1500, 1500, 14, Resists.Fire, Targets.Single, Skills.Alteration);


let state = new PlayerState(110, Classes.WIZ, 2041);
state.addAA(twincastAA);
state.addAA(quickDamage);
state.addAA(destructiveFury);
state.addAA(furyOfMagic);
state.addAA(destructiveAdept);
state.addAA(focusSkyblaze);
state.addAA(keepers);
state.addWorn(etherealDamage);
state.addAA(veng);
//state.addWorn(skyfireType3);
//state.addWorn(eyeOfDecay);
//state.addSpell(frenzied);
//state.addSpell(arcaneDestruction);
//state.addSpell(encSynergy);
//state.addWorn(threads);
//state.addSpell(nilsara);
//state.addSpell(aria);
//state.addSpell(qunard);
//state.addSpell(tdsAria);
//state.addSpell(oldAriaAura);
//state.addSpell(arrow);
//state.addSpell(iog);
//state.addWorn(fireDamage);


let result = skyfire.cast(state);
console.debug(result);


/*
let state = new PlayerState(110, Classes.NEC, 183);
state.addAA(destructiveCascade);
state.addAA(focusJorbb);
state.addAA(criticalAfflication);
state.addAA(furyOfMagic2);
state.addAA(destructiveFury2);
state.addAA(focusEssence);
state.addWorn(pyreDamage);
//state.addSpell(burningShadow);
state.addSpell(funeral);
//state.addAA(enhancedDecay);
*/

/*
let count = 80;
let total = 0;
let min = 99999999;
let max = 0;
let totalNonCrit = 0;
let nonCritCount = 0;
let maxNonCrit = 0;

for (let i=0; i<count; i++)
{
  let result = skyfire.cast(state);
  let damage = result.damage;
  total += damage;

  if (!result.crit)
  {
    maxNonCrit = Math.max(maxNonCrit, damage);
    nonCritCount += 1;
    totalNonCrit += damage;
  }

  min = Math.min(min, damage);
  max = Math.max(max, damage);
}

// console.debug(total / count);
// console.debug(totalNonCrit / nonCritCount);
console.debug(min);
//console.debug(maxNonCrit);
console.debug(max);
*/
