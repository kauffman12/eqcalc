const MaxHitsTypes =
{
  OUTGOING: 4, MATCHING: 7
}

const NON_CRIT_FOCUS_SPAS = [ 124, 127, 286, 296, 297, 302, 303, 399, 413, 461, 462, 483, 484, 507 ];

class Effects
{
  constructor()
  {
    // initialize
    let me = this;
    [ 'doTCritChance', 'doTCritMultiplier', 'nukeCritChance', 'nukeCritMultiplier' ].forEach(prop => me[prop] = 0.0);
    NON_CRIT_FOCUS_SPAS.forEach(spa => me['spa' + spa] = 0);
  }
}

const Classes =
{
  WAR: 2, CLR: 4, PAL: 8, RNG: 16, SHD: 32, DRU: 64, MNK: 128, BRD: 256, ROG: 512,  SHM: 1024, NEC: 2048,
  WIZ: 4096, MAG: 8192, ENC: 16384, BST: 32768, BER: 65536
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

    for (let i = 0; i < list.length; i++)
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
    this.bestSpellInGroup = new Map();
    this.cache = new Map();

    let aas = require('./data/AA' + playerClass + '.json');
    if (aas && aas.length > 0)
    {
      aas.forEach(aa => this.aas.set(aa.id + '-' + aa.rank, aa));
    }

    let data = require('./data/spells.json');
    if (data && data['spells'])
    {
      this.spells = data['spells'];
      Object.getOwnPropertyNames(this.spells).forEach(id =>
      {
        if (this.spells[id].group > 0)
        {
          let list = this.spellGroups.get(this.spells[id].group) || new Set();
          list.add(id);
          this.spellGroups.set(this.spells[id].group, list);

          let bestSpell = this.bestSpellInGroup.get(this.spells[id].group);
          if (!bestSpell || bestSpell < id)
          {
            this.bestSpellInGroup.set(this.spells[id].group, id);
          }
        }
      });
    }
  }

  getAA(id, rank)
  {
    let result = undefined;
    let key = id + '-' + rank;

    if (this.cache.has(key))
    {
      result = this.cache.get(key);
    }
    else if (this.aas.get(key))
    {
      result = new AA(this.aas.get(key));
      this.cache.set(key, result);
    }

    return result;
  }

  getSpell(id)
  {
    let result = undefined;

    if (this.cache.has(id))
    {
      result = this.cache.get(id);
    }
    else if (this.spells[id])
    {
      result = new Spell(this.spells[id]);
      this.cache.set(id, result);
    }

    return result;
  }
  
  getWorn(id)
  {
    let result = undefined;

    if (this.cache.has(id))
    {
      result = this.cache.get(id);
    }
    else if (this.spells[id])
    {
      result = new Worn(this.spells[id]);
      this.cache.set(id, result);
    }

    return result;
  }

  getBestSpellInGroup(id)
  {
    let best = this.bestSpellInGroup.get(id);
    return best ? this.getSpell(best) : undefined;
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
    this.valueProcessMap = new Map();
    this.chargedSpells = new Map();
    this.currentTime = 0;
  }

  addEffect(id, effect, map)
  {
    if (effect)
    {
      map.set(id, effect);
    }
    else
    {
      console.debug('attempting to add unknown effect ' + id);
    }
  }

  addAA(id, rank)
  {
    this.addEffect(id, SPELLDB.getAA(id, rank), this.passiveAAMap);
  }

  addWorn(id)
  {
    this.addEffect(id, SPELLDB.getWorn(id), this.wornMap);
  }

  addSpell(id)
  {
    this.addEffect(id, SPELLDB.getSpell(id), this.spellMap);
  }

  calculateBaseNukeCritChance()
  {
    return this.baseNukeCritChance + (this.playerClass == Classes.WIZ ? Math.ceil(Math.random() * 3) : 0);
  }

  charge()
  {
    let alreadyCharged = new Map();
    Array.from(this.chargedSpells.values()).forEach(spell => 
    {
      if (!alreadyCharged.has(spell.id) && --spell.remainingHits === 0 && this.spellMap.has(spell.id))
      {
        this.spellMap.delete(spell.id);
      }

      alreadyCharged.set(spell.id, true);
    });
    
    this.chargedSpells.clear();
  }

  buildEffects(spell, initialCast = false)
  {
    let allEffects = new Map();
    this.updateEffectsInCategory(this.passiveAAMap, allEffects, spell);

    let spellCategory = new Map();
    this.updateEffectsInCategory(this.spellMap, spellCategory, spell, initialCast);
    this.addEffectCategory(allEffects, spellCategory);

    let wornCategory = new Map();
    this.updateEffectsInCategory(this.wornMap, wornCategory, spell);
    this.addEffectCategory(allEffects, wornCategory);

    let totalEffects = new Map();
    allEffects.forEach((slots, spa) => totalEffects.set(spa, Array.from(slots.values()).reduce((a, b) => a + b, 0)));

    let finalEffects = new Effects();
    finalEffects.doTCritChance = this.baseDoTCritChance;
    finalEffects.doTCritMultiplier = this.baseDoTCritMultiplier;
    finalEffects.nukeCritChance = this.calculateBaseNukeCritChance();
    finalEffects.nukeCritMultiplier = this.baseNukeCritMultiplier;

    totalEffects.forEach((value, spa) =>
    {
      switch(spa)
      {
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
        default:
          if (NON_CRIT_FOCUS_SPAS.includes(spa))
          {
            finalEffects['spa' + spa] = value;
          }
      }
    });

    // DoT classes have same base 100% but it does not stack with Destructive Cascade
    // unlike Destructive Fury and Nukes
    if (!finalEffects.doTCritMultiplier)
    {
      finalEffects.doTCritMultiplier = 100;
    }

    // charge spells
    this.charge();

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

  updateEffectsInCategory(effectMap, category, spell, initialCast = false)
  {
    effectMap.forEach(effect =>
    {
      let checks = new LimitChecks();

      effect.slotList.forEach(slot =>
      {
        switch(slot.spa)
        {
          // 10 means the slot is empty, 148 is stacking related?
          case 10: case 148:
            break;
         
          // unhandled limit checks
          case 403: case 404: case 412: case 415: case 422: case 423: case 460: case 486: case 492: case 493: case 497: case 511:
            console.debug('unhandled limit check ' + slot.spa);
            checks.unknown = true; // let it pass for now
            break;

          // Crit Damage Modifiers don't follow limit checks and do not require spell to be focusable
          case 170: case 273:
            this.updateCategory(category, slot.spa, slot.num, slot.base1);
            break;

          // Crit Rate Modifiers that don't follow limit checks
          case 294: case 375:
            if (spell.focusable)
            {
              this.updateCategory(category, slot.spa, slot.num, slot.base1);
            }
            break;

          // Crit Rate Modifiers that do follow the normal rules
          case 212:
            // before going on to a non-limit check, check if previous had passed and start over to handle multiple sections in one spell
            checks = this.processUpdates(category, checks, effect) ? new LimitChecks() : checks;
            
            // if base2 is specified than assume a range of values are possible between base1 and base2
            // may as well roll a value here
            if (spell.focusable)
            {
              this.addValue(category, slot, slot.base1);  
            }
            break;

          // Spell Focus - supports a range of values
          case 124: case 127: case 286: case 296: case 297: case 302: case 303: case 399: case 413: case 461: case 462: case 483: case 484: case 507:   
            // before going on to a non-limit check, check if previous had passed and start over to handle multiple sections in one spell
            checks = this.processUpdates(category, checks, effect) ? new LimitChecks() : checks;
 
            // don't attempt anything that would use a charge if we're in a twincast or dot tick
            if (spell.focusable && (slot.spa !== 399 || initialCast))
            {
              // if base2 is specified than assume a range of values are possible between base1 and base2
              // may as well roll a value here
              let value = (slot.base2 === 0) ? slot.base1 : Spell.randomInRange(slot.base2, slot.base1);
              this.addValue(category, slot, value);
            }
            break;

          // Limit Checks
          case 134:
            // max level but also handles decay if base2 is set
            let difference = spell.level - slot.base1;
            checks.maxLevel = difference <= 0 ? true : this.reduceValues(difference * slot.base2);
            break;
          case 135:
            // pass if any resist check matches
            checks.resist = checks.resist || slot.base1 === spell.resist;
            break;
          case 136:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.target = checks.target === false ? checks.target : spell.target !== Math.abs(slot.base1);
            }
            else if (slot.base1)
            {
              // needs to pass if any of the include checks match
              checks.target = checks.target || spell.target === Math.abs(slot.base1);
            }
            break;
          case 137:
            if (slot.base1 < 0)
            {
              // this SPA may appear multiple times
              // exclude spells with specified SPA            
              checks.currentHp = checks.currentHp === false ? checks.currentHp : spell.findSpaValue(Math.abs(slot.base1)) === undefined;
            }
            else
            {
              // only include spells with specified SPA
              checks.currentHp = checks.currentHp || spell.findSpaValue(Math.abs(slot.base1)) !== undefined;
            }
            break;
          case 138:
            // checks for both cases where beneficial spells are required ot detrimental spells are required
            checks.detrimental = (spell.beneficial && slot.base1 === 1) || (!spell.beneficial && slot.base1 !== 1)
            break;
          case 139:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.spell = checks.spell === false ? checks.spell : spell.id !== Math.abs(slot.base1);
            }
            else
            {
              // only include spells with specified id
              checks.spell = checks.spell || spell.id === Math.abs(slot.base1);
            }
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
            checks.combatSkills = spell.findSpaValue(193) === undefined;
            break;
          case 348:
            checks.minMana = spell.manaCost >= slot.base1;
            break;
          case 385:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.spellGroup = checks.spellGroup === false ? checks.spellGroup : !SPELLDB.isSpellInGroup(spell.id, Math.abs(slot.base1));
            }
            else
            {
              // only include spell if it is in the spell group
              checks.spellGroup = checks.spellGroup || SPELLDB.isSpellInGroup(spell.id, slot.base1);
            }
            break;
          case 391:
            checks.maxMana = spell.manaCost <= slot.base1;
            break;
          case 411: case 485:
              if (slot.base1 < 0)
              {
                // needs to fail if any of the exclude checks match
                checks.playerClass = checks.playerClass === false ? checks.playerClass : ((Math.abs(slot.base1) & this.playerClass) !== this.playerClass);
              }
              else
              {
                // only include players that match the correct class
                checks.playerClass = checks.playerClass || ((slot.base1 & this.playerClass) === this.playerClass);
              }            
            break;
          case 414:
              if (slot.base1 < 0)
              {
                // needs to fail if any of the exclude checks match
                checks.spellSkill = checks.spellsKill === false ? checks.spellSkill : spell.skill !== Math.abs(slot.base1);
              }
              else
              {
                // only include spells with specified spell skill
                checks.spellSkill = checks.spellSkill || spell.skill === Math.abs(slot.base1);
              }
            break;
          case 479:
            // only one check needs to pass
            checks.maxValue = (checks.maxValue || spell.hasSpaWithMaxValue(slot.base2, slot.base1));
            break;
          case 480:
            // only one check needs to pass
            checks.minValue = (checks.minValue || spell.hasSpaWithMinValue(slot.base2, slot.base1));
            break;
          case 490:
            checks.minRecastTime = spell.recastTime >= slot.base1;
            break;     
          case 491:
            checks.maxRecastTime = spell.recastTime <= slot.base1;
            break;     
          case 495:
            checks.maxDuration = spell.duration <= slot.base1;
            break;
          default:
            checks = this.processUpdates(category, checks, effect) ? new LimitChecks() : checks;
        }
      });
  
      // process remaining
      this.processUpdates(category, checks, effect, true);
    });
  }

  addValue(category, slot, value)
  {
    let key = slot.num + '-' + slot.spa;
    let updatedValue = this.valueProcessMap.get(key) || {};

    if (updatedValue.max === undefined || updatedValue.max < value)
    {
      let handledSlots = category.get(slot.spa);
      let max = handledSlots ? Math.max(value, handledSlots.get(slot.num) || 0) : value;
      if (!handledSlots || !handledSlots.has(slot.num) || max > handledSlots.get(slot.num))
      {
        updatedValue.spa = slot.spa;
        updatedValue.num = slot.num;
        updatedValue.max = max;
        this.valueProcessMap.set(key, updatedValue);
      }  
    }
  }

  processUpdates(category, checks, effect, complete = false)
  {
    let processed = false;

    let hasLimits = checks.hasLimitsToCheck();
    if (this.valueProcessMap.size > 0 && (hasLimits || complete))
    {
      if (!hasLimits || checks.passed())
      {
        this.valueProcessMap.forEach(updatedValue =>
        {
          this.updateCategory(category, updatedValue.spa, updatedValue.num, updatedValue.max);

          // only attempt to count charges if limits were required to pass
          if (effect.maxHits > 0 && effect.maxHitsType === MaxHitsTypes.MATCHING)
          {
            this.chargedSpells.set(updatedValue.spa + '-' + updatedValue.num, effect);
          }
        });
 
        processed = true;
        this.valueProcessMap.clear();
      }
      else if (hasLimits)
      {
        // limits failed so start over
        processed = true;
        this.valueProcessMap.clear();
      }
    }

    return processed;
  }

  updateCategory(category, spa, num, max)
  {
    let handledSlots = category.get(spa) || new Map();
    if (!handledSlots.has(num) || handledSlots.get(num) < max)
    {
      handledSlots.set(num, max);   
      category.set(spa, handledSlots);  
    }
  }

  reduceValues(amount)
  {
    let anyRemaining = false;
    this.valueProcessMap.forEach(updatedValue =>
    {
      let reduced = Math.trunc(updatedValue.max - (updatedValue.max * amount / 100));
      updatedValue.max = reduced > 0 ? reduced : 0;
      anyRemaining = (reduced > 0) ? true : anyRemaining;
    });

    return anyRemaining;
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

    let finalEffects = state.buildEffects(this, true);
    let doTwincast = finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399;

    this.slotList.forEach(slot =>
    {
      switch(slot.spa)
      {
        case 374:
          let proc374 = SPELLDB.getSpell(slot.base2);

          if (Math.random() * 100 <= slot.base1)
          {
            allResults = allResults.concat(proc374.cast(state));
          }
          break;

        case 470:
          let proc470 = SPELLDB.getBestSpellInGroup(slot.base2);
          if (proc470)
          {
            allResults = allResults.concat(proc470.cast(state));
            console.debug('can not find spell to proc: ' + slot.base2);
          }
          break;

        case 0: case 79:
          let results = [];                 
          let ticks = this.duration === 0 ? 1 : this.duration + 1;
          let isNuke = (this.duration === 0 || slot.spa === 79);
          let count = isNuke ? 1 : ticks;

          // ticks is a custom field that I set to 1 for nukes
          for (let i = 0; i < count; i++)
          {
            // did the spell crit?
            let crit = (Math.random() * 100 <= (isNuke ? finalEffects.nukeCritChance : finalEffects.doTCritChance));
      
            if (i > 0)
            {
              // rebuild after each DoT tick
              finalEffects = state.buildEffects(this, false);
            }
      
            // base damage can increase with time and needs to be calculated per tick
            let baseDamage = Math.abs(this.calculateValue(slot.calc, slot.base1, slot.max, i + 1, state.level));

            // add damage for one hit / tick
            results.push({ damage: this.calculateDamage(state, baseDamage, crit, isNuke, ticks, finalEffects), crit: crit, spa: slot.spa });
      
            if (doTwincast)
            {
              if (isNuke)
              {
                crit = (Math.random() * 100 <= finalEffects.nukeCritChance);
                finalEffects = state.buildEffects(this, false);
                results.push({ damage: this.calculateDamage(state, baseDamage, crit, isNuke, ticks, finalEffects), crit: crit, spa: slot.spa });
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

    if (this.duration > 0)
    {
      state.addSpell(this.id);
    }

    return allResults;
  }

  calculateDamage(state, baseDamage, crit, isNuke, ticks, finalEffects)
  {
    // SPA 413 focuses base damage but is rounded differently for DoTs
    let spa413 = finalEffects.spa413 * baseDamage / 100;
    let effectiveDamage = baseDamage + (isNuke ? Math.trunc(spa413) : Spell.roundAsDec32(spa413));

    // start adding up damage that will be used in a crit
    let beforeCritDamage = effectiveDamage;

    // damage that does not crit for either Nuke or DoT
    let afterCritDamage = Math.trunc(finalEffects.spa286 / ticks);

    if (isNuke)
    {
      // spell damage will only crit for a Nuke
      beforeCritDamage += Math.trunc(this.calculateSpellDamage(state)); 

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

    // SPA 296 increases in effect when SPA 297 is present
    let spa296 = Math.trunc(finalEffects.spa296 * effectiveDamage / 100);
    spa296 *= (finalEffects.spa297 > 0) ? 2 : 1;

    // SPA 296, 297, and 303 all crit as well
    beforeCritDamage += spa296 + finalEffects.spa297 + Math.trunc(finalEffects.spa303 / ticks);    

    // figure out crit damage
    let critMultiplier = isNuke ? finalEffects.nukeCritMultiplier : finalEffects.doTCritMultiplier;
    let critDamage = crit ? Spell.roundAsDec32(beforeCritDamage * critMultiplier / 100) : 0;

    // get total so far
    let total = beforeCritDamage + critDamage + afterCritDamage;

    // SPA 461 for a Nuke will focus all damage to this point
    total += isNuke ? Math.trunc(total * finalEffects.spa461 / 100) : 0;

    // SPA 483 increases in effect when SPA 484 is present
    let spa483 = Math.trunc(finalEffects.spa483 * effectiveDamage / 100);
    spa483 *= (finalEffects.spa484 > 0) ? 2 : 1;

    // SPA 462, 483, 484 and 507 are added to the end and not focused by anything else
    total += spa483 + Math.trunc(finalEffects.spa462 / ticks) + Math.trunc(finalEffects.spa484 / ticks);
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
        value = Math.trunc(level / 2) + 5;
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

  calculateValue(calc, base1, max, tick, level)
  {
    // default to base1 or max depending on normal calc values
    let result = (calc === 100 && max > 0 && base1 > max) ? max : base1;

    if (calc !== 0 && calc !== 100 && calc !== 3000) // 3000 unknown?
    {
      let change = 0;

      switch (calc)
      {
        case 101:
          change = level / 2;
          break;
        case 102:
          change = level;
          break;
        case 103:
          change = level * 2;
          break;
        case 104:
          change = level * 3;
          break;
        case 105:
          change = level * 4;
          break;
        case 107:
          change = -1 * tick;
          break;
        case 108:
          change = -2 * tick;
          break;
        case 109:
          change = level / 4;
          break;
        case 110:
          change = level / 6;
          break;
        case 111:
          change = (level > 16) ? (level - 16) * 6 : change;
          break;
        case 112:
          change = (level > 24) ? (level - 24) * 8 : change;
          break;
        case 113:
          change = (level > 34) ? (level - 34) * 10 : change;
          break;
        case 114:
          change = (level > 44) ? (level - 44) * 15 : change;
          break;
        case 115:
          change = (level > 15) ? (level - 15) * 7 : change;
          break;
        case 116:
          change = (level > 24) ? (level - 24) * 10 : change;
          break;
        case 117:
          change = (level > 34) ? (level - 34) * 13 : change;
          break;
        case 118:
          change = (level > 44) ? (level - 44) * 20 : change;
          break;
        case 119:
          change = level / 8;
          break;
        case 120:
          change = -5 * tick;
          break;
        case 121:
          change = level / 3;
          break;
        case 122:
          change = -12 * tick;
          break;
        case 123:
          change = Spell.randomInRange(Math.abs(max), Math.abs(base1));
          break;
        case 124:
          change = (level > 50) ? level - 50 : change;
          break;
        case 125:
          change = (level > 50) ? (level - 50) * 2 : change;
          break;
        case 126:
          change = (level > 50) ? (level - 50) * 3 : change;
          break;
        case 127:
          change = (level > 50) ? (level - 50) * 4 : change;
          break;
        case 128:
          change = (level > 50) ? (level - 50) * 5 : change;
          break;
        case 129:
          change = (level > 50) ? (level - 50) * 10 : change;
          break;
        case 130:
          change = (level > 50) ? (level - 50) * 15 : change;
          break;
        case 131:
          change = (level > 50) ? (level - 50) * 20 : change;
          break;
        case 132:
          change = (level > 50) ? (level - 50) * 25 : change;
          break;
        case 139:
          change = (level > 30) ? (level - 30) / 2 : change;
          break;
        case 140:
          change = (level > 30) ? level - 30 : change;
          break;
        case 141:
          change = (level > 30) ? 3 * (level - 30) / 2 : change;
          break;
        case 142:
          change = (level > 30) ? 2 * (level - 60) : change;
          break;
        case 143:
          change = 3 * level / 4;
          break;
        default:
          if (calc > 0 && calc < 1000)
          {
            change = level * calc;
          }
          else if (calc >= 1000 && calc < 2000)
          {
            change = tick * (calc - 1000) * -1;
          }
          else if (calc >= 2000)
          {
            change = level * (calc - 2000);
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

  hasSpaWithMaxValue(spa, value)
  {
    let found = this.findSpaValue(spa);
    return found !== undefined && found >= value;
  }

  hasSpaWithMinValue(spa, value)
  {
    let found = this.findSpaValue(spa);
    return found !== undefined && found <= value;
  }

  findSpaValue(spa)
  {
    let result = undefined;

    for (let i = 0; i < this.slotList.length; i++)
    {
      let slot = this.slotList[i];
      
      if (slot.spa === spa)
      {
        result = slot.base1;
        break;
      }
      else if (slot.spa === 470)
      {
        let best = SPELLDB.getBestSpellInGroup(slot.base2);
        result = best ? best.findSpaValue(spa) : undefined;
        break;
      }
    }

    return result;
  }

  static roundAsDec32(value)
  {
    return Math.round(+(value.toFixed(7)));
  }

  static randomInRange(high, low)
  {
    return Math.floor(Math.random() * (high - low + 1)) + low;
  }
}


let SPELLDB = new SpellDatabase(Classes.WIZ);
let state = new PlayerState(115, Classes.WIZ, 3000);
state.addAA(114, 35);      // Fury of Magic
state.addAA(397, 36);      // Destructive Fury
state.addAA(1263, 8);      // Destructive Adept
state.addAA(850, 20);      // Sorc Vengeance
state.addSpell(51502);     // Improved Familiar
state.addSpell(51508);     // Frenzied Devestation
state.addSpell(51090);     // Improved Twincast

//state.addSpell(SPELLDB.getSpell(18882));  // Twincast
//state.addAA(SPELLDB.getAA(1292, 9));
//state.addSpell(SPELLDB.getSpell(31526));
//state.addSpell(SPELLDB.getSpell(58165));
//state.addSpell(SPELLDB.getSpell(51342));
//state.addSpell(SPELLDB.getSpell(56137));
//state.addSpell(SPELLDB.getSpell(51500));
//state.addSpell(SPELLDB.getSpell(51006));
//state.addSpell(SPELLDB.getSpell(51526));

//state.addWorn(SPELLDB.getWorn(49694));    // Eyes of Life and Decay
//state.addWorn(SPELLDB.getWorn(45815));    // WIZ Ethereal Focus 9
//state.addSpell(SPELLDB.getSpell(48965));  // Wizard Spire
//state.addSpell(SPELLDB.getSpell(51185));  // Great Wolf
//state.addSpell(SPELLDB.getSpell(51134));  // Auspice
//state.addSpell(SPELLDB.getSpell(36942));  // Arcane Destruction
//state.addSpell(SPELLDB.getSpell(41195));  // Arcane Fury
//state.addSpell(SPELLDB.getSpell(51538));  // Fury of the Gods
//state.addSpell(SPELLDB.getSpell(51199));  // Season's Wrath
//state.addSpell(SPELLDB.getSpell(55105));  // Sanctity 
//state.addSpell(SPELLDB.getSpell(51006));  // Enc Synergy

let dissident = SPELLDB.getSpell(58149);
let skyfire = SPELLDB.getSpell(56872);
let stormjolt = SPELLDB.getSpell(58164);
for (let i = 0; i < 2; i++ )
{
  console.debug("Cast #" + (i+1));
  console.debug(stormjolt.cast(state));
} 
