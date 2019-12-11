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
    this.chargedSpellList = [];
    this.currentTime = 0;
    this.increaseBuffDuration = 2.0;
    this.level = level;
    this.passiveAAList = [];
    this.playerClass = playerClass;
    this.spellDB = spellDB;
    this.spellDamage = spellDamage;
    this.spellList = [];
    this.wornList = [];
  }

  run(seconds)
  {
    this.initSpells();

    while (this.currentTime < seconds)
    {
      let me = this;
      this.castQueue.forEach(spell => console.debug(me.cast(spell)));

      this.currentTime += 6;
      this.spellList = this.spellList.filter(spell => spell.expireTime > me.currentTime);
    }
  }

  initSpells()
  {
    let me = this;

    this.spellList.forEach(spell =>
    {
      spell.updateDuration(me.level);
      spell.duration *= (spell.focusable) ? me.increaseBuffDuration : 1;
      spell.expireTime = me.currentTime + spell.duration * 6;
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
    this.chargedSpellList.forEach(spell => 
    {
      if (!alreadyCharged.has(spell.id) && --spell.remainingHits === 0)
      {
        this.spellList = this.spellList.filter(existing => existing.id !== spell.id);
      }

      alreadyCharged.set(spell.id, true);
    });
    
    this.chargedSpellList = [];
  }

  buildEffects(spell)
  {  
    let categoryBuilder = new EffectsCategory(this.spellDB);
    let passiveAACategory = categoryBuilder.build(this.passiveAAList, spell);
    let spellCategory = categoryBuilder.build(this.spellList, spell);
    let wornCategory = categoryBuilder.build(this.wornList, spell);

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
              finalEffects.doTCritMultiplier += slot.base1;
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
                this.chargedSpellList.push(slot.effect);
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

  addEffect(id, effect, list)
  {
    if (effect)
    {
      list.push(effect);
    }
    else
    {
      console.debug('attempting to add unknown effect ' + id);
    }
  }

  addAA(id, rank)
  {
    this.addEffect(id, this.spellDB.getAA(id, rank), this.passiveAAList);
  }

  addWorn(id)
  {
    this.addEffect(id, this.spellDB.getWorn(id), this.wornList);
  }

  addSpell(id)
  {
    this.addEffect(id, this.spellDB.getSpell(id), this.spellList);
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
state.addSpell(51599);     // IOG

state.addToQueue(56872);   // skyfire
state.run(300);