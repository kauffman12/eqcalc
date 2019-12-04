const Utils = require('./utils.js');
const SpellDatabase = require('./spelldb.js');

const Classes =
{
  WAR: 2, CLR: 4, PAL: 8, RNG: 16, SHD: 32, DRU: 64, MNK: 128, BRD: 256, ROG: 512,  SHM: 1024, NEC: 2048,
  WIZ: 4096, MAG: 8192, ENC: 16384, BST: 32768, BER: 65536
}

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

class PlayerState
{
  constructor(spellDB, level, playerClass, spellDamage)
  {
    this.spellDB = spellDB;
    this.level = level;
    this.playerClass = playerClass;
    this.spellDamage = spellDamage;
    this.baseDoTCritChance = 0;
    this.baseDoTCritMultiplier = 0;
    this.baseNukeCritChance = 0;
    this.baseNukeCritMultiplier = 100;
    this.currentTime = 0;
    this.chargedSpells = new Map();
    this.passiveAAMap = new Map();
    this.spellMap = new Map();
    this.wornMap = new Map();
    this.valueProcessMap = new Map();
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
    this.addEffect(id, this.spellDB.getAA(id, rank), this.passiveAAMap);
  }

  addWorn(id)
  {
    this.addEffect(id, this.spellDB.getWorn(id), this.wornMap);
  }

  addSpell(id)
  {
    this.addEffect(id, this.spellDB.getSpell(id), this.spellMap);
  }

  calculateBaseNukeCritChance()
  {
    return this.baseNukeCritChance + (this.playerClass == Classes.WIZ ? Math.ceil(Math.random() * 3) : 0);
  }

  cast(spell)
  {
    // calculate spell duration based on player level
    spell.duration = Utils.calculateDuration(this.level, spell);

    let allResults = [];
    let finalEffects = this.buildEffects(spell, true);
    let doTwincast = finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399;

    spell.slotList.forEach(slot =>
    {
      switch(slot.spa)
      {
        case 374:
          let proc374 = this.spellDB.getSpell(slot.base2);

          if (Math.random() * 100 <= slot.base1)
          {
            allResults = allResults.concat(this.cast(proc374));
          }
          break;

        case 470:
          let proc470 = this.spellDB.getBestSpellInGroup(slot.base2);
          if (proc470)
          {
            allResults = allResults.concat(this.cast(proc470));
          }
          else
          {
            console.debug('can not find spell to proc: ' + slot.base2);
          }
          break;

        case 0: case 79:
          let results = [];                 
          let ticks = spell.duration === 0 ? 1 : spell.duration + 1;
          let isNuke = (spell.duration === 0 || slot.spa === 79);
          let count = isNuke ? 1 : ticks;

          // ticks is a custom field that I set to 1 for nukes
          for (let i = 0; i < count; i++)
          {     
            if (i > 0)
            {
              // rebuild after each DoT tick
              finalEffects = this.buildEffects(spell, false);
            }
      
            // base damage can increase with time and needs to be calculated per tick
            let baseDamage = Math.abs(Utils.calculateValue(slot.calc, slot.base1, slot.max, i + 1, this.level));

            // add damage for one hit / tick
            let damage = Utils.calculateDamage(this.level, this.spellDamage, spell, baseDamage, isNuke, ticks, finalEffects);
            results.push({ damage: damage.total, crit: damage.crit, spa: slot.spa });
      
            if (doTwincast)
            {
              if (isNuke)
              {
                finalEffects = this.buildEffects(spell, false);
                let damage = Utils.calculateDamage(this.level, this.spellDamage, spell, baseDamage, isNuke, ticks, finalEffects);
                results.push({ damage: damage.total, crit: damage.crit, spa: slot.spa });
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

    if (spell.duration > 0)
    {
      this.addSpell(spell.id);
    }

    return allResults;
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
              let value = (slot.base2 === 0) ? slot.base1 : Utils.randomInRange(slot.base2, slot.base1);
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
              checks.currentHp = checks.currentHp === false ? checks.currentHp : this.spellDB.findSpaValue(spell, Math.abs(slot.base1)) === undefined;
            }
            else
            {
              // only include spells with specified SPA
              checks.currentHp = checks.currentHp || this.spellDB.findSpaValue(spell, Math.abs(slot.base1)) !== undefined;
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
            checks.combatSkills = this.spellDB.findSpaValue(spell, 193) === undefined;
            break;
          case 348:
            checks.minMana = spell.manaCost >= slot.base1;
            break;
          case 385:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              checks.spellGroup = checks.spellGroup === false ? checks.spellGroup : !this.spellDB.isSpellInGroup(spell.id, Math.abs(slot.base1));
            }
            else
            {
              // only include spell if it is in the spell group
              checks.spellGroup = checks.spellGroup || this.spellDB.isSpellInGroup(spell.id, slot.base1);
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
            checks.maxValue = (checks.maxValue || this.spellDB.hasSpaWithMaxValue(spell, slot.base2, slot.base1));
            break;
          case 480:
            // only one check needs to pass
            checks.minValue = (checks.minValue || this.spellDB.hasSpaWithMinValue(spell, slot.base2, slot.base1));
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

let spells = new SpellDatabase(Classes.DRU);
let state = new PlayerState(spells, 115, Classes.DRU, 3000);
state.addSpell(51090);     // Improved Twincast

let nbw = spells.getSpell(56030);
for (let i = 0; i < 20; i++)
{
  console.debug(state.cast(nbw));
}

/*
let spells = new SpellDatabase(Classes.WIZ);
let state = new PlayerState(spells, 115, Classes.WIZ, 3000);
state.addAA(114, 35);      // Fury of Magic
state.addAA(397, 36);      // Destructive Fury
state.addAA(1263, 8);      // Destructive Adept
state.addAA(850, 20);      // Sorc Vengeance
state.addSpell(51502);     // Improved Familiar
state.addSpell(51508);     // Frenzied Devestation
state.addSpell(51090);     // Improved Twincast

//state.addSpell(spells.getSpell(18882));  // Twincast
//state.addAA(spells.getAA(1292, 9));
//state.addSpell(spells.getSpell(31526));
//state.addSpell(spells.getSpell(58165));
//state.addSpell(spells.getSpell(51342));
//state.addSpell(spells.getSpell(56137));
//state.addSpell(spells.getSpell(51500));
//state.addSpell(spells.getSpell(51006));
//state.addSpell(spells.getSpell(51526));

//state.addWorn(spells.getWorn(49694));    // Eyes of Life and Decay
//state.addWorn(spells.getWorn(45815));    // WIZ Ethereal Focus 9
//state.addSpell(spells.getSpell(48965));  // Wizard Spire
//state.addSpell(spells.getSpell(51185));  // Great Wolf
//state.addSpell(spells.getSpell(51134));  // Auspice
//state.addSpell(spells.getSpell(36942));  // Arcane Destruction
//state.addSpell(spells.getSpell(41195));  // Arcane Fury
//state.addSpell(spells.getSpell(51538));  // Fury of the Gods
//state.addSpell(spells.getSpell(51199));  // Season's Wrath
//state.addSpell(spells.getSpell(55105));  // Sanctity 
//state.addSpell(spells.getSpell(51006));  // Enc Synergy

let dissident = spells.getSpell(58149);
let skyfire = spells.getSpell(56872);
let stormjolt = spells.getSpell(58164);
for (let i = 0; i < 2; i++ )
{
  console.debug("Cast #" + (i+1));
  console.debug(state.cast(dissident));
} 
*/