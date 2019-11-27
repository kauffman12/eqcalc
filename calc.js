const NUM = 0;
const SPA = 1;
const BASE1 = 2;
const BASE2 = 3;
const MAX = 4;
const CALC = 5;

const Classes =
{
  WAR: 2, CLR: 4, PAL: 8, RNG: 16, SHD: 32, DRU: 64, MNK: 128, BRD: 256, ROG: 512,  SHM: 1024, NEC: 2048,
  WIZ: 4096, MAG: 8192, ENC: 16384, BST: 32768, BER: 65536
}

class EffectsState
{
  constructor()
  {
    this.doTCritChance = 0.0;
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
    this.spells = new Map();
    this.spellGroups = new Map();

    let spells = require('./data/spells.json');
    spells.forEach(spell => 
    {
      this.spells.set(spell.id, spell);

      if (spell.group > 0)
      {
        let list = this.spellGroups.get(spell.group) || new Set();
        list.add(spell.id);
        this.spellGroups.set(spell.group, list);
      }
    });
  }

  getSpell(id)
  {
    return new Spell(this.spells.get(id));
  }  

  getWorn(id)
  {
    return new Worn(this.spells.get(id));
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
        switch(slot[SPA])
        {
          case 10:
            break;
          // Ignore
          case 2: case 119: case 125: case 128: case 129: case 130: case 131: case 132: case 133:
          case 161: case 162: case 169: case 216: case 274: case 279: case 280: case 364:
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
            this.addValue(category, updatedValue, slot, slot[BASE1]);  
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
            let value = (slot[BASE2] === 0) ? slot[BASE1] : Math.floor(Math.random() * (slot[BASE2] - slot[BASE1] + 1)) + slot[BASE1];
            this.addValue(category, updatedValue, slot, value);
            break;

          // Limit Checks
          case 134:
            // max level but also handles decay if base2 is set
            let difference = spell.level - slot[BASE1];
            checks.maxLevel = difference <= 0 ? true : this.reduceValues(updatedValue, difference * slot[BASE2]);
            break;
          case 135:
            // pass if any resist check matches
            checks.resist = checks.resist || slot[BASE1] === spell.resist;
            break;
          case 136:
            // this SPA may appear multiple times
            // exclude spells with specified target
            if (slot[BASE1] < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.target = checks.target === false ? checks.target : spell.target !== Math.abs(slot[BASE1]);
            }
            // only include spells with specified target
            else if (slot[BASE1])
            {
              // needs to pass if any of the include checks match
              checks.target = checks.target || spell.target === Math.abs(slot[BASE1]);
            }
            break;
          case 137:
            // result spells have negative value in base1 while heals have a positive value so check for non zero
            checks.currentHp = checks.currentHp || (currentSpellSlot[SPA] === slot[BASE1] && currentSpellSlot[BASE1] !== 0);
            break;
          case 138:
            // checks for both cases where beneficial spells are required ot detrimental spells are required
            checks.detrimental = (spell.beneficial && slot[BASE1] === 1) || (!spell.beneficial && slot[BASE1] !== 1)
            break;
          case 140:
            checks.minDuration = spell.duration >= slot[BASE1];
            break;
          case 141:
            // this SPA always seems to enforce 0 duration spells
            checks.duration = (slot[BASE1] === 1 && spell.duration === 0);
            break;
          case 142:
            checks.minLevel = spell.level >= slot[BASE1];
            break;
          case 143:
            checks.minCastTime = spell.castTime >= slot[BASE1];
            break;
          case 144:
            checks.maxCastTime = spell.castTime <= slot[BASE1];
            break;
          case 311:
            // exclude combat skills
            checks.combatSkills = currentSpellSlot[SPA] !== 193;
            break;
          case 348:
            checks.minMana = spell.manaCost >= slot[BASE1];
            break;
          case 385:
            // check passes if the current spell matches any of the listed spell groups
            // this SPA may appear multiple times
            checks.spellGroup = checks.spellGroup || SPELLS.isSpellInGroup(spell.id, slot[BASE1]);
            break;
          case 411:
            checks.playerClass = (slot[BASE1] & this.playerClass) === this.playerClass;
            break;
          case 480:
            // only one check needs to pass
            checks.minValue = checks.minValue || (currentSpellSlot[SPA] === slot[BASE2] && currentSpellSlot[BASE1] <= slot[BASE1]);
            break;
          case 495:
            checks.maxDuration = spell.duration <= slot[BASE1];
            break;
          default:
            console.debug("Unhandled SPA > " + slot[SPA]);
        }
      });
  
      // processing remaining
      this.processUpdates(category, updatedValue, checks, effect, chargedSpells);
    });
  }

  addValue(category, updatedValue, slot, value)
  {
    let handledSlots = category.get(slot[SPA]);
    let max = handledSlots ? Math.max(value, handledSlots.get(slot[NUM]) || 0) : value;
    if (!handledSlots || !handledSlots.has(slot[NUM]) || max > handledSlots.get(slot[NUM]))
    {
      updatedValue.spa = slot[SPA];
      updatedValue.num = slot[NUM];
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

class AA
{
  constructor(data)
  {
    this.name = data.name;
    this.id = data.id;
    this.rank = data.rank;
    this.slotList = data.slotList;
  }
}

class Worn
{
  constructor(data)
  {
    this.name = data.name;
    this.id = data.id;
    this.slotList = data.slotList;
  }
}

class Spell
{
  constructor(data)
  {
    Object.assign(this, data);
    this.remainingHits = this.maxHits;
    this.actualCastTime = this.castTime;
  }

  cast(state)
  {
    let results = [];
    this.calculateDuration(state.level);

    this.slotList.forEach(slot =>
    {
      switch(slot[SPA])
      {
        case 0: case 127: case 399:
          let chargedSpells = new Map();
          let finalEffects = state.buildEffects(this, slot, chargedSpells);
          console.debug(finalEffects);
        
          if (finalEffects.spa127 !== undefined)
          {
            this.actualCastTime = this.castTime - (this.castTime * finalEffects.spa127 / 100);
          }

          if (slot[SPA] === 0)
          {
            let baseDamage = Math.abs(slot[BASE1]);
            let count = this.duration + 1;

            for (let i = 0; i < count; i++)
            {
              let crit = (Math.random() * 100 <= (this.isNuke() ? finalEffects.nukeCritChance : finalEffects.doTCritChance));

              // calculate damage for one cast
              let damage = this.calculateDamage(state, baseDamage, this.isNuke(), crit, finalEffects);
              results.push({ damage: damage, crit: crit });
  
              if (finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399)
              {
                if (this.isNuke())
                {
                  let twincastCrit = (Math.random() * 100 <= (this.isNuke() ? finalEffects.nukeCritChance : finalEffects.doTCritChance));
                  let twincastDamage = this.calculateDamage(state, baseDamage, this.isNuke(), twincastCrit, finalEffects);
                  results.push({ damage: twincastDamage, crit: twincastCrit, twincast: true });  
                }
                else
                {
                  results[results.length - 1].damage *= 2;
                  results[results.length - 1].twincast = true;
                }
              }
  
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

  calculateDamage(state, baseDamage, nuke, crit, finalEffects)
  {
    let total = 0;
    let critMultiplier;

    let effectiveDamage = baseDamage + Spell.truncAsDec32(finalEffects.spa413 * baseDamage / 100);
    let beforeCritDamage = effectiveDamage + finalEffects.spa297 + finalEffects.spa303;
    beforeCritDamage += Spell.truncAsDec32((finalEffects.spa296 + finalEffects.spa302) * effectiveDamage / 100);

    if (nuke)
    {
      critMultiplier = finalEffects.nukeCritMultiplier;
      beforeCritDamage += Spell.truncAsDec32(this.calculateSpellDamage(state));
      total = beforeCritDamage + Spell.truncAsDec32(effectiveDamage * finalEffects.spa124 / 100);
    }
    else
    {
      critMultiplier = finalEffects.doTCritMultiplier;
      beforeCritDamage += Spell.roundAsDec32(beforeCritDamage * finalEffects.spa124 / 100);
      total = beforeCritDamage;
    }
    
    total += finalEffects.spa286;

    if (crit)
    {
      total += Spell.roundAsDec32(beforeCritDamage * critMultiplier / 100);
    }

    total += Spell.truncAsDec32(total * finalEffects.spa461 / 100);
    total += finalEffects.spa462;
    return total;
  }

  calculateDuration(level)
  {
    let value = 0;
    switch (this.duration1)
    {
      case 0:
        value = 0;
        break;
      case 1:
        value = Math.trunc(level / 2) || value;
        break;
      case 2:
        value = (Math.trunc(level / 2) + 5);
        value = value < 6 ? 6 : value;
          break;
      case 3:
        value = level * 30;
        break;
      case 4:
        value = 50;
        break;
      case 5:
        value = 2;
        break;
      case 6:
        value = Math.trunc(level / 2);
        break;
      case 7:
        value = level;
        break;
      case 8:
        value = level + 10;
        break;
      case 9:
        value = level * 2 + 10;
        break;
      case 10:
        value = level * 30 + 10;
        break;
      case 11:
        value = (level + 3) * 30;
        break;
      case 12:
        value = Math.trunc(level / 2) || 1;
        break;
      case 13:
        value = level * 4 + 10;
        break;
      case 14:
        value = level * 5 + 10;
        break;
      case 15:
        value = (level * 5 + 50) * 2;
        break;
      case 50:
        value = 72000;
        break;
      case 3600:
        value = 3600;
        break;
      default:
        value = this.duration2;
        break;
    }

    this.duration = (this.duration2 > 0 && value > this.duration2) ? this.duration2 : value;
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
    return this.duration2 > 0;
  }

  isNuke()
  {
    return this.duration2 === 0;
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
let state = new PlayerState(110, Classes.DRU, 3000);

state.addWorn(SPELLS.getWorn(57663));    // NBW Type 3 Aug
state.addWorn(SPELLS.getWorn(49694));    // Eyes of Life and Decay
state.addSpell(SPELLS.getSpell(46645));  // Fire Damage 85-123
state.addSpell(SPELLS.getSpell(51134));  // Auspice
state.addSpell(SPELLS.getSpell(18882));  // Twincast
state.addSpell(SPELLS.getSpell(51199));  // Season's Wrath 
state.addSpell(SPELLS.getSpell(56137));  // Aria of Begalru
state.addSpell(SPELLS.getSpell(51599));  // IOG
state.addSpell(SPELLS.getSpell(51005));  // Mage Synergy
state.addSpell(SPELLS.getSpell(56185));  // Akett's Psalm
state.addSpell(SPELLS.getSpell(21661));  // Glyph
state.addSpell(SPELLS.getSpell(51006));  // Enc Synergy

let nbw = SPELLS.getSpell(56030);
let result = nbw.cast(state);
console.debug(result);




/*
let state = new PlayerState(110, Classes.WIZ, 3000);
state.addWorn(SPELLS.getWorn(49694));    // Eyes of Life and Decay
state.addWorn(SPELLS.getWorn(45815));    // WIZ Ethereal Focus 9
state.addSpell(SPELLS.getSpell(51508));  // Frenzied Devestation
state.addSpell(SPELLS.getSpell(18882));  // Twincast
state.addSpell(SPELLS.getSpell(48965));  // Wizard Spire
state.addSpell(SPELLS.getSpell(51185));  // Great Wolf
state.addSpell(SPELLS.getSpell(51134));  // Auspice
state.addSpell(SPELLS.getSpell(36942));  // Arcane Destruction
state.addSpell(SPELLS.getSpell(41195));  // Arcane Fury
state.addSpell(SPELLS.getSpell(51538));  // Fury of the Gods
state.addSpell(SPELLS.getSpell(51199));  // Season's Wrath 
state.addSpell(SPELLS.getSpell(55105));  // Sanctity 

let skyfire = SPELLS.getSpell(56872);
let result = skyfire.cast(state);
console.debug(result);
*/
