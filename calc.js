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
    this.spa483 = 0;
    this.spa484 = 0;
    this.spa507 = 0;
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
  constructor(playerClass)
  {
    this.aas = new Map();
    this.spells = new Map();
    this.spellGroups = new Map();

    let aas = require('./data/AA' + playerClass + '.json');
    if (aas && aas.length > 0)
    {
      aas.forEach(aa => this.aas.set(aa.id + '-' + aa.rank, aa));
    }

    let spells = require('./data/spells.json');
    if (spells && spells.length > 0)
    {
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
  }

  getAA(id, rank)
  {
    let aa = this.aas.get(id + '-' + rank);
    return aa ? new AA(aa) : undefined;
  }

  getSpell(id)
  {
    let spell = this.spells.get(id);
    return spell ? new Spell(spell) : undefined;
  }  

  getWorn(id)
  {
    let worn = this.spells.get(id);
    return worn ? new Worn(worn) : undefined;
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
    if (aa)
    {
      this.passiveAAMap.set(aa.id, aa);
    }
    else
    {
      console.debug('attempting to add unknown aa');
    }    
  }

  addWorn(worn)
  {
    if (worn)
    {
      this.wornMap.set(worn.id, worn);
    }
    else
    {
      console.debug('attempting to add unknown worn');
    }
  }

  addSpell(spell)
  {
    if (spell)
    {
      this.spellMap.set(spell.id, spell);
    }
    else
    {
      console.debug('attempting to add unknown spell');
    }
  }

  buildEffects(spell, chargedSpells, initialCast = false)
  {
    let allEffects = new Map();
    this.updateEffectsInCategory(this.passiveAAMap, allEffects, spell);

    let spellCategory = new Map();
    this.updateEffectsInCategory(this.spellMap, spellCategory, spell, chargedSpells, initialCast);
    this.addEffectCategory(allEffects, spellCategory);

    let wornCategory = new Map();
    this.updateEffectsInCategory(this.wornMap, wornCategory, spell);
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
        case 124: case 127: case 286: case 296: case 297: case 302: case 303: case 399: 
        case 413: case 461: case 462: case 483: case 484: case 507:
          finalEffects['spa' + spa] = value;
          break;
        case 170:
          finalEffects.nukeCritMultiplier += value;
          break;
        case 273:
          finalEffects.doTCritChance += value;
          break;
        case 212: case 294:
          finalEffects.nukeCritChance += value;
          break;
        case 375:
          finalEffects.doTCritMultiplier += value;
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
 
  updateEffectsInCategory(effectMap, category, spell, chargedSpells, initialCast = false)
  {
    effectMap.forEach((effect, effectId) =>
    {
      let updatedValue = {};
      let checks = new LimitChecks();

      effect.slotList.forEach(slot =>
      {
        switch(slot[SPA])
        {
          // 10 means the slot is empty, 148 is stacking related?
          case 10: case 148:
            break;
         
          // unhandled limit checks
          case 403: case 404: case 412: case 415: case 422: case 423: case 460: case 486: case 492: case 493: case 497: case 511:
            console.debug('unhandled limit check ' + slot[SPA]);
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
          case 124: case 127: case 286: case 296: case 297: case 302: case 303: case 399: case 413: case 461: case 462: case 483: case 484: case 507:   
            // before going on to a non-limit check, check if previous had passed and start over to handle multiple sections in one spell
            if (this.processUpdates(category, updatedValue, checks, effect, chargedSpells))
            {
              updatedValue = {};
              checks = new LimitChecks();
            }

            // don't attempt anything that would use a charge if we're in a twincast or dot tick
            if (slot[SPA] !== 399 || initialCast)
            {
              // if base2 is specified than assume a range of values are possible between base1 and base2
              // may as well roll a value here
              let value = (slot[BASE2] === 0) ? slot[BASE1] : Math.floor(Math.random() * (slot[BASE2] - slot[BASE1] + 1)) + slot[BASE1];
              this.addValue(category, updatedValue, slot, value);
            }
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
            if (slot[BASE1] < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.target = checks.target === false ? checks.target : spell.target !== Math.abs(slot[BASE1]);
            }
            else if (slot[BASE1])
            {
              // needs to pass if any of the include checks match
              checks.target = checks.target || spell.target === Math.abs(slot[BASE1]);
            }
            break;
          case 137:
            if (slot[BASE1] < 0)
            {
              // this SPA may appear multiple times
              // exclude spells with specified SPA            
              checks.currentHp = checks.currentHp === false ? checks.currentHp : !spell.hasSpa(Math.abs(slot[BASE1]));
            }
            else
            {
              // only include spells with specified SPA
              checks.currentHp = checks.currentHp || spell.hasSpa(Math.abs(slot[BASE1]));
            }
            break;
          case 138:
            // checks for both cases where beneficial spells are required ot detrimental spells are required
            checks.detrimental = (spell.beneficial && slot[BASE1] === 1) || (!spell.beneficial && slot[BASE1] !== 1)
            break;
          case 139:
            if (slot[BASE1] < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.spell = checks.spell === false ? checks.spell : spell.id !== Math.abs(slot[BASE1]);
            }
            else
            {
              // only include spells with specified id
              checks.spell = checks.spell || spell.id === Math.abs(slot[BASE1]);
            }
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
            checks.combatSkills = !spell.hasSpa(193);
            break;
          case 348:
            checks.minMana = spell.manaCost >= slot[BASE1];
            break;
          case 385:
            if (slot[BASE1] < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.spellGroup = checks.spellGroup === false ? checks.spellGroup : !SPELLS.isSpellInGroup(spell.id, Math.abs(slot[BASE1]));
            }
            else
            {
              // only include spell if it is in the spell group
              checks.spellGroup = checks.spellGroup || SPELLS.isSpellInGroup(spell.id, slot[BASE1]);
            }
            break;
          case 391:
            checks.maxMana = spell.manaCost <= slot[BASE1];
            break;
          case 411: case 485:
              if (slot[BASE1] < 0)
              {
                // needs to fail if any of the exclude checks match
                checks.playerClass = checks.playerClass === false ? checks.playerClass : ((Math.abs(slot[BASE1]) & this.playerClass) !== this.playerClass);
              }
              else
              {
                // only include players that match the correct class
                checks.playerClass = checks.playerClass || ((slot[BASE1] & this.playerClass) === this.playerClass);
              }            
            break;
          case 414:
              if (slot[BASE1] < 0)
              {
                // needs to fail if any of the exclude checks match
                checks.spellSkill = checks.spellsKill === false ? checks.spellSkill : spell.skill !== Math.abs(slot[BASE1]);
              }
              else
              {
                // only include spells with specified spell skill
                checks.spellSkill = checks.spellSkill || spell.skill === Math.abs(slot[BASE1]);
              }
            break;
          case 479:
            // only one check needs to pass
            checks.maxValue = (checks.maxValue || spell.hasSpaWithMaxValue(slot[BASE2], slot[BASE1]));
            break;
          case 480:
            // only one check needs to pass
            checks.minValue = (checks.minValue || spell.hasSpaWithMinValue(slot[BASE2], slot[BASE1]));
            break;
          case 490:
            checks.minRecastTime = spell.recastTime >= slot[BASE1];
            break;     
          case 491:
            checks.maxRecastTime = spell.recastTime <= slot[BASE1];
            break;     
          case 495:
            checks.maxDuration = spell.duration <= slot[BASE1];
            break;
          default:
            // other focus or damage effects, check if processing is needed
            if (this.processUpdates(category, updatedValue, checks, effect, chargedSpells))
            {
              updatedValue = {};
              checks = new LimitChecks();
            }            
        }
      });
  
      // process remaining
      this.processUpdates(category, updatedValue, checks, effect, chargedSpells);
    });
  }

  addValue(category, updatedValue, slot, value)
  {
    if (updatedValue.max === undefined || updatedValue.max < value)
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
  }

  processUpdates(category, updatedValue, checks, effect, chargedSpells)
  {
    let processed = false;

    if (updatedValue && updatedValue.spa !== undefined)
    {
      if (!checks.hasLimitsToCheck() || checks.passed())
      {
        this.updateCategory(category, updatedValue);
        processed = true;
  
        // only attempt to count charges if limits were required to pass
        if (chargedSpells !== undefined && checks.hasLimitsToCheck() && effect.maxHits > 0)
        {
          chargedSpells.set(updatedValue.spa + '-' + updatedValue.num, effect);
        }  
      }
      else if (checks.hasLimitsToCheck())
      {
        // limits failed so start over
        processed = true;
      }
    }

    return processed;
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
    let allResults = [];
    this.calculateDuration(state.level);

    this.slotList.forEach(slot =>
    {
      switch(slot[SPA])
      {
        case 0: case 79:
          let results = [];
          let chargedSpells = new Map();
          let finalEffects = state.buildEffects(this, chargedSpells, true);
          let doTwincast = finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399;
      
          // apply charges
          this.charge(state, chargedSpells);
        
          // update cast time
          if (finalEffects.spa127 !== undefined)
          {
            this.actualCastTime = this.castTime - (this.castTime * finalEffects.spa127 / 100);
          }
      
          let ticks = this.duration === 0 ? 1 : this.duration + 1;
          let isNuke = (this.duration === 0 || slot[SPA] === 79);
          let count = isNuke ? 1 : ticks;
          // ticks is a custom field that I set to 1 for nukes
          for (let i = 0; i < count; i++)
          {
            // did the spell crit?
            let crit = (Math.random() * 100 <= (this.duration === 0 ? finalEffects.nukeCritChance : finalEffects.doTCritChance));
      
            if (i > 0)
            {
              // rebuild and charge after each DoT tick
              finalEffects = state.buildEffects(this, chargedSpells, false);
              this.charge(state, chargedSpells);
            }
      
            // add damage for one hit / tick
            results.push({ damage: this.calculateDamage(state, Math.abs(slot[BASE1]), crit, isNuke, ticks, finalEffects), crit: crit, spa: slot[SPA] });
      
            if (doTwincast)
            {
              if (isNuke)
              {
                crit = (Math.random() * 100 <= finalEffects.nukeCritChance);
                finalEffects = state.buildEffects(this, chargedSpells, false);
                this.charge(state, chargedSpells);
                results.push({ damage: this.calculateDamage(state, Math.abs(slot[BASE1]), crit, isNuke, ticks, finalEffects), crit: crit, spa: slot[SPA] });
              }
              else
              {
                // just double the results when it's a DoT
                results[results.length -1].damage *= 2;
              }
      
              results[results.length -1].twincast = true;
            }
          }

          allResults.push(results);
          break;
      }
    });

    return allResults;
  }

  calculateDamage(state, baseDamage, crit, isNuke, ticks, finalEffects)
  {
    //console.debug(finalEffects);

    // effective damage is used in other calcuations
    let effectiveDamage = baseDamage + Spell.truncAsDec32(finalEffects.spa413 * baseDamage / 100);
    
    // damage that will crit for both Nuke and DoT
    let beforeCritDamage = effectiveDamage + Spell.truncAsDec32(finalEffects.spa302 * effectiveDamage / 100);

    // damage that will crit for both Nuke and DoT but is not always focused by SPA 461
    let beforeCritDamage2 = Spell.truncAsDec32(finalEffects.spa296 * effectiveDamage / 100) +
      finalEffects.spa297 + Spell.truncAsDec32(finalEffects.spa303 / ticks);

    // damage that does not crit for either Nuke or DoT
    let afterCritDamage = Spell.truncAsDec32(finalEffects.spa286 / ticks);

    if (isNuke)
    {
      // spell damage will only crit for a Nuke
      beforeCritDamage += Spell.truncAsDec32(this.calculateSpellDamage(state));

      // SPA 124 does not crit for a Nuke
      afterCritDamage += Spell.truncAsDec32(effectiveDamage * finalEffects.spa124 / 100);
    }
    else
    {
      // SPA 124 does crit for a DoT
      beforeCritDamage += Spell.truncAsDec32(beforeCritDamage * finalEffects.spa124 / 100);
    }
   
    // compute crit damage in two pieces to support SPA 461
    let critMultiplier = isNuke ? finalEffects.nukeCritMultiplier : finalEffects.doTCritMultiplier;
    let critDamage = crit ? Spell.roundAsDec32((beforeCritDamage + beforeCritDamage2) * critMultiplier / 100) : 0;

    // get total so far
    let total = beforeCritDamage + beforeCritDamage2 + critDamage + afterCritDamage;

    // SPA 461 is based on total damage for Nukes
    if (isNuke)
    {
      total += Spell.truncAsDec32(total * finalEffects.spa461 / 100);
    }
    // SPA 461 does not count standard after crit damage when dealing with DoTs
    else
    {
      let crit461Damage = crit ? Spell.truncAsDec32(beforeCritDamage * critMultiplier / 100) : 0;
      total += Spell.truncAsDec32(beforeCritDamage * finalEffects.spa461 / 100) + Spell.truncAsDec32(crit461Damage * finalEffects.spa461 / 100);
    }

    // SPA 462, 483, 484 and 507 are added to the very end
    total += Spell.truncAsDec32(finalEffects.spa462 / ticks);
    total += Spell.truncAsDec32(finalEffects.spa483 * (finalEffects.spa484 > 0 ? 2 : 1) * effectiveDamage / 100);
    total += Spell.truncAsDec32(finalEffects.spa484 / ticks);
    total += Spell.roundAsDec32(finalEffects.spa507 * effectiveDamage / 1000); // 1000 is correct

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
        multiplier = totalCastTime / 7001;
      }

      spellDamage = state.spellDamage * multiplier;
    }

    return spellDamage;
  }

  charge(state, chargedSpells)
  {
    Array.from(chargedSpells.values()).forEach(spell => 
    {
      if (--spell.remainingHits === 0 && state.spellMap.has(spell.id))
      {
        //state.spellMap.delete(spell.id);
      }
    });
    
    chargedSpells.clear();
  }

  hasSpa(spa)
  {
    return this.slotList.filter(slot => slot[SPA] === spa).length > 0;
  }

  hasSpaWithMaxValue(spa, value)
  {
    return this.slotList.filter(slot => slot[SPA] === spa && slot[BASE1] >= value).length > 0;
  }

  hasSpaWithMinValue(spa, value)
  {
    return this.slotList.filter(slot => slot[SPA] === spa && slot[BASE1] <= value).length > 0;
  }

  static ceilAsDec32(value)
  {
    return Math.ceil(+(value.toFixed(7)));
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


let SPELLS = new SpellDatabase(Classes.ENC);
let state = new PlayerState(110, Classes.ENC, 1397);
state.addAA(SPELLS.getAA(398, 38));      // Destructive Fury
state.addAA(SPELLS.getAA(3718, 11));      // Critical Afflication
state.addAA(SPELLS.getAA(215, 30));      // Fury of Magic
state.addAA(SPELLS.getAA(3815, 39));     // Destructive Cascade
//state.addSpell(SPELLS.getSpell(58212)); // Dissident
//state.addAA(SPELLS.getAA(1313, 9));
//state.addAA(SPELLS.getAA(1315, 11));
//state.addAA(SPELLS.getAA(1052, 9));
//state.addAA(SPELLS.getAA(1051, 5));
state.addAA(SPELLS.getAA(1015, 2));
//state.addWorn(SPELLS.getWorn(50833));
state.addWorn(SPELLS.getWorn(45764));
//state.addSpell(SPELLS.getSpell(51342));
//state.addWorn(SPELLS.getWorn(50582));
state.addSpell(SPELLS.getSpell(51184));
//state.addSpell(SPELLS.getSpell(57169));
//state.addSpell(SPELLS.getSpell(50974));
state.addSpell(SPELLS.getSpell(56136));
//state.addSpell(SPELLS.getSpell(56184));
//state.addSpell(SPELLS.getSpell(57190));
state.addWorn(SPELLS.getWorn(50576));

let theSpell = SPELLS.getSpell(44980);
//let theSpell = SPELLS.getSpell(57287);
for (let i = 0; i < 300; i++) console.debug(theSpell.cast(state));

/*
let min = 99999999;
for (let i = 0; i < 500; i++)
{
  let data = temp.cast(state);
  data.forEach(one => one.forEach(two =>
  {
    min = Math.min(min, two.damage);
    console.debug(two);
  }));
}
console.debug(temp.cast(state));
*/


/*
let SPELLS = new SpellDatabase(Classes.DRU);
let state = new PlayerState(110, Classes.DRU, 1065);

state.addAA(SPELLS.getAA(3815, 39));     // Destructive Cascade
state.addAA(SPELLS.getAA(398, 38));      // Destructive Fury
state.addAA(SPELLS.getAA(526, 27));      // Critical Afflication
state.addAA(SPELLS.getAA(215, 30));      // Fury of Magic
state.addWorn(SPELLS.getWorn(57663));    // NBW Type 3 Aug
state.addAA(SPELLS.getAA(2148, 6));      // NBW Focus AA
state.addAA(SPELLS.getAA(178, 25));      // Wrath of the Forest Walker
state.addAA(SPELLS.getAA(958, 2));       // Enhanced Maladies
state.addSpell(SPELLS.getSpell(51599));  // IOG
state.addSpell(SPELLS.getSpell(56185));  // Akett's Psalm
state.addSpell(SPELLS.getSpell(51342));   // Fierce Eye
state.addSpell(SPELLS.getSpell(41860));  // Destructive Vortex
state.addSpell(SPELLS.getSpell(56137));  // Aria of Begalru

//state.addSpell(SPELLS.getSpell(51006));  // Enc Synergy
//state.addSpell(SPELLS.getSpell(51184));  // Great Wolf
//state.addSpell(SPELLS.getSpell(51598));  // Chromatic Haze
//state.addSpell(SPELLS.getSpell(55882));  // Overwhelming Sunray II
//state.addAA(SPELLS.getAA(1405, 5));      // Twincast AA
//state.addSpell(SPELLS.getSpell(51090));  // Improved Twincast
//state.addWorn(SPELLS.getWorn(49694));    // Eyes of Life and Decay
//state.addSpell(SPELLS.getSpell(46645));  // Fire Damage 85-123
//state.addSpell(SPELLS.getSpell(51134));  // Auspice
//state.addSpell(SPELLS.getSpell(51199));  // Season's Wrath 
//state.addSpell(SPELLS.getSpell(51005));  // Mage Synergy
//state.addSpell(SPELLS.getSpell(21661));  // Glyph


let nbw = SPELLS.getSpell(56030);

for (let i = 0; i < 1; i++)
{
  let result = nbw.cast(state);
  console.debug(result);  
}

*/


/*
let SPELLS = new SpellDatabase(Classes.WIZ);
let state = new PlayerState(115, Classes.WIZ, 227);
state.addAA(SPELLS.getAA(114, 35));      // Fury of Magic
state.addAA(SPELLS.getAA(397, 1));
state.addAA(SPELLS.getAA(1292, 9));
state.addWorn(SPELLS.getWorn(45814));
state.addAA(SPELLS.getAA(850, 4));
state.addAA(SPELLS.getAA(1263, 3));
state.addSpell(SPELLS.getSpell(31526));
state.addWorn(SPELLS.getWorn(50833));
state.addSpell(SPELLS.getSpell(58165));
state.addSpell(SPELLS.getSpell(51342));
state.addSpell(SPELLS.getSpell(56137));
//state.addSpell(SPELLS.getSpell(51500));
state.addSpell(SPELLS.getSpell(51006));
state.addSpell(SPELLS.getSpell(51526));


//state.addWorn(SPELLS.getWorn(49694));    // Eyes of Life and Decay
//state.addWorn(SPELLS.getWorn(45815));    // WIZ Ethereal Focus 9
//state.addSpell(SPELLS.getSpell(51508));  // Frenzied Devestation
//state.addSpell(SPELLS.getSpell(18882));  // Twincast
//state.addSpell(SPELLS.getSpell(48965));  // Wizard Spire
//state.addSpell(SPELLS.getSpell(51185));  // Great Wolf
//state.addSpell(SPELLS.getSpell(51134));  // Auspice
//state.addSpell(SPELLS.getSpell(36942));  // Arcane Destruction
//state.addSpell(SPELLS.getSpell(41195));  // Arcane Fury
//state.addSpell(SPELLS.getSpell(51538));  // Fury of the Gods
//state.addSpell(SPELLS.getSpell(51199));  // Season's Wrath 
//state.addSpell(SPELLS.getSpell(55105));  // Sanctity 
//state.addSpell(SPELLS.getSpell(51006));  // Enc Synergy

let skyfire = SPELLS.getSpell(56871);
for (let i = 0; i < 700; i++) console.debug(skyfire.cast(state));
*/