const Utils = require('./utils.js');
const SpellDatabase = require('./spelldb.js');
const { Effects, EffectsCategory } = require('./effects.js');

class PlayerState
{
  constructor(spellDB, level, playerClass, spellDamage)
  {
    this.baseDoTCritChance = 0;
    this.baseDoTCritMultiplier = 0;
    this.baseNukeCritChance = 0;
    this.baseNukeCritMultiplier = 100;
    this.castQueue = [];
    this.chargedSpells = new Map();
    this.currentTime = 0;
    this.level = level;
    this.passiveAAMap = new Map();
    this.playerClass = playerClass;
    this.spellDB = spellDB;
    this.spellDamage = spellDamage;
    this.spellMap = new Map();
    this.wornMap = new Map();
  }

  run(seconds)
  {
    let state = this;
    this.castQueue.forEach(spell =>
    {
      console.debug(state.cast(spell));
    });
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
    let categoryBuilder = new EffectsCategory(this.spellDB);
    let passiveAACategory = categoryBuilder.build(this.passiveAAMap, spell);
    let spellCategory = categoryBuilder.build(this.spellMap, spell);
    let wornCategory = categoryBuilder.build(this.wornMap, spell);

    let finalEffects = new Effects();
    finalEffects.doTCritChance = this.baseDoTCritChance;
    finalEffects.doTCritMultiplier = this.baseDoTCritMultiplier;
    finalEffects.nukeCritChance = Utils.calculateBaseNukeCritChance(this.baseNukeCritChance);
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
              if (slot.effect && slot.effect.maxHitsType === Utils.MaxHitsTypes.MATCHING)
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

  addToQueue(id)
  {
    this.castQueue.push(this.spellDB.getSpell(id));
  }  
}

let spells = new SpellDatabase(Utils.Classes.WIZ);
let state = new PlayerState(spells, 110, Utils.Classes.WIZ, 3000);

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

state.addToQueue(56872);   // skyfire
state.addToQueue(56872);   // skyfire
state.addToQueue(56872);   // skyfire
state.run();