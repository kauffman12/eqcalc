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

class Effects
{
  constructor()
  {
    // initialize
    let me = this;
    [ 'doTCritChance', 'doTCritMultiplier', 'nukeCritChance', 'nukeCritMultiplier' ].forEach(prop => me[prop] = 0.0);
    [ 124, 127, 128, 132, 286, 296, 297, 302, 303, 399, 413, 461, 462, 483, 484, 507 ].forEach(spa => me['spa' + spa] = 0);
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
    this.processChecks = null;
    this.processList = null;
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
    let allResults = [];

    // calculate spell duration based on player level before continuing with limit checks
    spell.updateDuration(this.level);

    let finalEffects = this.buildEffects(spell);
    let doTwincast = finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399;

    spell.slotList.forEach(slot =>
    {
      switch(slot.spa)
      {
        case 374:
          let proc374 = this.spellDB.getSpell(slot.base2);

          if (proc374 && Math.random() * 100 <= slot.base1)
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
          let extendedDuration = spell.duration + finalEffects.spa128;
          let ticks = extendedDuration === 0 ? 1 : extendedDuration + 1;
          let isNuke = (extendedDuration === 0 || slot.spa === 79);
          let count = isNuke ? 1 : ticks;

          // ticks is a custom field that I set to 1 for nukes
          for (let i = 0; i < count; i++)
          {     
            if (i > 0)
            {
              // rebuild after each DoT tick
              finalEffects = this.buildEffects(spell);
            }
      
            // base damage can increase with time and needs to be calculated per tick
            let baseDamage = Math.abs(Utils.calculateValue(slot.calc, slot.base1, slot.max, i + 1, this.level));

            // add damage for one hit / tick
            let damage = Utils.calculateDamage(this.level, this.spellDamage, spell, baseDamage, isNuke, ticks, finalEffects);
            results.push({ damage: damage.total, crit: damage.crit, spa: slot.spa, tick: (i + 1) });
      
            if (doTwincast)
            {
              if (isNuke)
              {
                finalEffects = this.buildEffects(spell);
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

    // charge spells
    this.charge();    

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

  buildEffects(spell)
  {  
    let passiveAACategory = new Map();
    this.addEffectsInCategory(this.passiveAAMap, passiveAACategory, spell);

    let spellCategory = new Map();
    this.addEffectsInCategory(this.spellMap, spellCategory, spell);

    let wornCategory = new Map();
    this.addEffectsInCategory(this.wornMap, wornCategory, spell);

    let finalEffects = new Effects();
    finalEffects.doTCritChance = this.baseDoTCritChance;
    finalEffects.doTCritMultiplier = this.baseDoTCritMultiplier;
    finalEffects.nukeCritChance = this.calculateBaseNukeCritChance();
    finalEffects.nukeCritMultiplier = this.baseNukeCritMultiplier;
    
    [passiveAACategory, spellCategory, wornCategory].forEach(category =>
    {
      category.forEach((slots, spa) =>
      {
        slots.forEach(slot =>
        {
          switch(slot.spa)
          {
            case 170: 
              finalEffects.nukeCritMultiplier += slot.base1;
              break;
            case 273:
              finalEffects.doTCritChance += slot.base1;
              break;
            case 212: case 294:
              finalEffects.nukeCritChance += slot.base1;
              break;
            case 375:
              finalEffects.doTCritMultiplier += value;
              break;
    
            case 124: case 127: case 128: case 132: case 212: case 286: case 296: case 297: case 302: case 303: 
            case 399: case 413: case 461: case 462: case 483: case 484: case 507:
              let value = 0;
 
              if (slot.base1 > 0)
              {
                if (spa === 128)
                {
                  value = spell.beneficial ? slot.base1 : Utils.randomInRange(slot.base2 || 1, slot.base1 || 1);                  
                }
                else
                {
                  value = (slot.base2 === 0 || slot.base1 === slot.base2) ? slot.base1 : Utils.randomInRange(slot.base2, slot.base1);
                }
              }
              else
              {
                if (spa === 128)
                {
                  value = slot.base2 === 0 ? slot.base1 : Utils.randomInRange(slot.base1, -1);
                }
                else
                {
                  value = slot.base2 !== 0 ? slot.base1 : Utils.randomInRange(slot.base1, slot.base2);
                }
              }
  
              if (slot.reduceBy > 0)
              {
                value = Math.trunc(value * (1 - slot.reduceBy / 100));
                value = value < 0 ? 0 : value;
              }

              // convert from percent to actual value
              if (spa === 128)
              {
                let calc = Math.trunc(spell.duration * value / 100);
                value = value > 0 ? Math.max(1, calc) : Math.min(-1, calc);
              }

              // update charged map if needed
              if (slot.effect && slot.effect.maxHitsType === MaxHitsTypes.MATCHING)
              {
                this.chargedSpells.set(slot.spa, slot.effect);
              }
  
              finalEffects['spa' + spa] += value;
              break;
          }  
        });
      });      
    });

    // DoT classes have same base 100% but it does not stack with Destructive Cascade
    // unlike Destructive Fury and Nukes
    if (!finalEffects.doTCritMultiplier)
    {
      finalEffects.doTCritMultiplier = 100;
    }

    return finalEffects;
  }

  addEffectsInCategory(effectMap, category, spell)
  {
    effectMap.forEach(effect =>
    {
      this.processChecks = new LimitChecks();
      this.processList = [];
  
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
            this.processChecks.unknown = true; // let it pass for now
            break;

          // Crit Damage Modifiers don't follow limit checks, do not require spells to be focusable, and stack
          case 170: case 273:
            this.updateCategory(category, slot);
            break;

          // Crit Rate Modifiers that don't follow limit checks, do require spells be focusable, and stack
          case 294: case 375:
            if (spell.focusable)
            {
              this.updateCategory(category, slot);
            }
            break;

          // SPAs that follow the normal rules, may or may not support a range of values, and they do not support stacking
          case 124: case 127: case 128: case 132: case 212: case 286: case 296: case 297: case 302: case 303: 
          case 399: case 413: case 461: case 462: case 483: case 484: case 507:
            // before going on to a non-limit check, check if previous had passed and start over to handle multiple sections in one spell
            this.processUpdates(category);
            this.processList.push({ spa: slot.spa, base1: slot.base1, base2: slot.base2, spell: spell, effect: effect }); // copy values
            break;

          // Limit Checks
          case 134:
            // max level but also handles decay if base2 is set
            let difference = slot.base1 - spell.level;
            this.processChecks.maxLevel = difference >= 0 || slot.base2 < 100;

            if (difference < 0)
            {
              this.processList.forEach(item => item.reduceBy = Math.abs(difference * slot.base2));
            }
            break;
          case 135:
            // pass if any resist check matches
            this.processChecks.resist = this.processChecks.resist || slot.base1 === spell.resist;
            break;
          case 136:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              this.processChecks.target = this.processChecks.target === false ? this.processChecks.target : spell.target !== Math.abs(slot.base1);
            }
            else if (slot.base1)
            {
              // needs to pass if any of the include checks match
              this.processChecks.target = this.processChecks.target || spell.target === Math.abs(slot.base1);
            }
            break;
          case 137:
            if (slot.base1 < 0)
            {
              // this SPA may appear multiple times
              // exclude spells with specified SPA            
              this.processChecks.currentHp = this.processChecks.currentHp === false ? this.processChecks.currentHp : 
                this.spellDB.findSpaValue(spell, Math.abs(slot.base1)) === undefined;
            }
            else
            {
              // only include spells with specified SPA
              this.processChecks.currentHp = this.processChecks.currentHp || this.spellDB.findSpaValue(spell, Math.abs(slot.base1)) !== undefined;
            }
            break;
          case 138:
            // checks for both cases where beneficial spells are required ot detrimental spells are required
            this.processChecks.detrimental = (spell.beneficial && slot.base1 === 1) || (!spell.beneficial && slot.base1 !== 1)
            break;
          case 139:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              this.processChecks.spell = this.processChecks.spell === false ? this.processChecks.spell : spell.id !== Math.abs(slot.base1);
            }
            else
            {
              // only include spells with specified id
              this.processChecks.spell = this.processChecks.spell || spell.id === Math.abs(slot.base1);
            }
            break;
          case 140:
            this.processChecks.minDuration = spell.duration >= slot.base1;
            break;
          case 141:
            // this SPA always seems to enforce 0 duration spells
            this.processChecks.duration = (slot.base1 === 1 && spell.duration === 0);
            break;
          case 142:
            this.processChecks.minLevel = spell.level >= slot.base1;
            break;
          case 143:
            this.processChecks.minCastTime = spell.castTime >= slot.base1;
            break;
          case 144:
            this.processChecks.maxCastTime = spell.castTime <= slot.base1;
            break;
          case 311:
            // exclude combat skills
            this.processChecks.combatSkills = this.spellDB.findSpaValue(spell, 193) === undefined;
            break;
          case 348:
            this.processChecks.minMana = spell.manaCost >= slot.base1;
            break;
          case 385:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              this.processChecks.spellGroup = this.processChecks.spellGroup === false ? this.processChecks.spellGroup : 
                !this.spellDB.isSpellInGroup(spell.id, Math.abs(slot.base1));
            }
            else
            {
              // only include spell if it is in the spell group
              this.processChecks.spellGroup = this.processChecks.spellGroup || this.spellDB.isSpellInGroup(spell.id, slot.base1);
            }
            break;
          case 391:
            this.processChecks.maxMana = spell.manaCost <= slot.base1;
            break;
          case 411: case 485:
              if (slot.base1 < 0)
              {
                // needs to fail if any of the exclude checks match
                this.processChecks.playerClass = this.processChecks.playerClass === false ? this.processChecks.playerClass : 
                  ((Math.abs(slot.base1) & this.playerClass) !== this.playerClass);
              }
              else
              {
                // only include players that match the correct class
                this.processChecks.playerClass = this.processChecks.playerClass || ((slot.base1 & this.playerClass) === this.playerClass);
              }            
            break;
          case 414:
              if (slot.base1 < 0)
              {
                // needs to fail if any of the exclude checks match
                this.processChecks.spellSkill = this.processChecks.spellsKill === false ? this.processChecks.spellSkill : spell.skill !== Math.abs(slot.base1);
              }
              else
              {
                // only include spells with specified spell skill
                this.processChecks.spellSkill = this.processChecks.spellSkill || spell.skill === Math.abs(slot.base1);
              }
            break;
          case 479:
            // only one check needs to pass
            this.processChecks.maxValue = (this.processChecks.maxValue || this.spellDB.hasSpaWithMaxValue(spell, slot.base2, slot.base1));
            break;
          case 480:
            // only one check needs to pass
            this.processChecks.minValue = (this.processChecks.minValue || this.spellDB.hasSpaWithMinValue(spell, slot.base2, slot.base1));
            break;
          case 490:
            this.processChecks.minRecastTime = spell.recastTime >= slot.base1;
            break;     
          case 491:
            this.processChecks.maxRecastTime = spell.recastTime <= slot.base1;
            break;     
          case 495:
            this.processChecks.maxDuration = spell.duration <= slot.base1;
            break;
          default:
            this.processUpdates(category);
        }
      });
  
      // process remaining
      this.processUpdates(category, true);
    });
  }

  processUpdates(category, complete = false)
  {
    let hasLimits = this.processChecks.hasLimitsToCheck();
    if (this.processList.length > 0 && (hasLimits || complete))
    {
      if (!hasLimits || this.processChecks.passed())
      {
        this.processList.forEach(slot => 
        {
          if (slot.spell.focusable)
          {
            this.updateCategory(category, slot, false);
          }
        });
 
        this.processChecks = new LimitChecks();
        this.processList = [];
      }
      else if (hasLimits)
      {
        // limits failed so start over
        this.processChecks = new LimitChecks();
        this.processList = [];
      }
    }
  }  

  updateCategory(category, next, stackable = true)
  {
    let updateNextValue = true;
    let key = stackable ? next.num : -1;
    let handledSlots = category.get(next.spa) || new Map();
    let prev = handledSlots.get(key);

    if (prev)
    {
      let prevValue = (prev.base1 < 0) ? Math.min(prev.base1, prev.base2) : Math.max(prev.base1, prev.base2);
      let nextValue = (prev.base1 < 0) ? Math.min(next.base1, next.base2) : Math.max(next.base1, next.base2);
      updateNextValue = (prevValue < 0 || nextValue < 0) ? (nextValue < prevValue) : (nextValue > prevValue);
    }

    if (updateNextValue)
    {
      handledSlots.set(key, next);
      category.set(next.spa, handledSlots);  
    }

    return updateNextValue;
  }
}
let spells = new SpellDatabase(Classes.WIZ);
let state = new PlayerState(spells, 110, Classes.WIZ, 3000);

//state.addSpell(30618);
//state.addSpell(41175);
//state.addWorn(46657);

state.addAA(114, 35);      // Fury of Magic
state.addAA(397, 28);      // Destructive Fury
state.addAA(1292, 11);     // Skyblaze Focus
state.addWorn(57723);      // Skyfire Type 3
//state.addAA(1263, 8);      // Destructive Adept
state.addAA(850, 20);       // Sorc Vengeance
//state.addSpell(51502);     // Improved Familiar
//state.addWorn(9522);      // Fire 1 to 25% max level 75
state.addSpell(51090);     // Improved Twincast

let dissident = spells.getSpell(58149);
let skyfire = spells.getSpell(56872);
let stormjolt = spells.getSpell(58164);

let spell = spells.getSpell(56695);
for (let i = 0; i < 20; i++ )
{
  console.debug(state.cast(skyfire));
}