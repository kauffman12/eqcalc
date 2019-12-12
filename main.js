const Utils = require('./utils.js');
const SpellDatabase = require('./spelldb.js');
const EffectsCategory = require('./effects.js');

class PlayerState
{
  constructor(spellDB, level, playerClass, spellDamage)
  {
    this.baseDoTCritChance = 0;
    this.baseDoTCritMultiplier = 0;
    this.baseNukeCritChance = 0;
    this.baseNukeCritMultiplier = 100;
    this.castQueue = [];
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
    this.spellList.forEach(spell =>
    {
      spell.updateDuration(this.level);
      spell.duration *= (spell.focusable) ? this.increaseBuffDuration : 1;
      spell.expireTime = this.currentTime + spell.duration * 6000;
    });

    this.castQueue.forEach(spell => spell.updateDuration(this.level));

    let count = 1;
    while (this.currentTime < (seconds * 1000))
    {
      let spell = this.castQueue[0];
      let result = this.cast(spell);
      result.cast = count++;
      console.debug(result);

      this.currentTime += 6000;
      this.spellList = this.spellList.filter(spell => spell.expireTime > this.currentTime);
    }
  }

  cast(spell)
  {
    let finalEffects = this.buildEffects(spell);

    let results = {};
    results.needTwincast = finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399;
    results.duration = spell.duration + finalEffects.spa128;
    results.castTime = spell.castTime - Math.trunc(finalEffects.spa127 * spell.castTime / 100);

    spell.slotList.forEach(slot =>
    {
      switch(slot.spa)
      {
        case 374:
          let proc374 = this.spellDB.getSpell(slot.base2);

          if (proc374 && Math.random() * 100 <= slot.base1)
          {
            results.procs = results.procs || [];
            results.procs.push(allResults.concat(this.cast(proc374)));
          }
          break;

        case 470:
          let proc470 = this.spellDB.getBestSpellInGroup(slot.base2);

          if (proc470)
          {
            results.procs = results.procs || [];
            results.procs.push(allResults.concat(this.cast(proc470)));
          }
          break;

        case 0: case 79:
          // execute right away if it's a nuke
          if ((results.duration === 0 || slot.spa === 79))
          {
            // base damage can increase with time and needs to be calculated per tick
            let baseDamage = Math.abs(Utils.calculateValue(slot.calc, slot.base1, slot.max, 1, this.level));

            // add damage for one hit / tick
            results.damage = Utils.calculateDamage(this.level, this.spellDamage, spell, baseDamage, true, 1, finalEffects);
            results.damage.spa = slot.spa;
          }
          else
          {

          }

          break;
      }
    });

    if (results.duration > 0)
    {
      this.addSpell(spell.id);
    }

    // charge spells
    this.charge(finalEffects.chargedSpellList);    

    return results;
  }

  charge(chargedSpellList)
  {
    let alreadyCharged = new Map();
    chargedSpellList.forEach(spell => 
    {
      if (!alreadyCharged.has(spell.id) && --spell.remainingHits === 0)
      {
        this.spellList = this.spellList.filter(existing => existing.id !== spell.id);
      }

      alreadyCharged.set(spell.id, true);
    });
  }

  buildEffects(spell)
  {  
    let effectsBuilder = new EffectsCategory(this.spellDB);
    effectsBuilder.addCategory(this.passiveAAList, spell);
    effectsBuilder.addCategory(this.spellList, spell);
    effectsBuilder.addCategory(this.wornList, spell);

    let finalEffects = effectsBuilder.buildEffects();
    finalEffects.doTCritChance = this.baseDoTCritChance;
    finalEffects.doTCritMultiplier = this.baseDoTCritMultiplier;
    finalEffects.nukeCritChance = Utils.calculateBaseNukeCritChance(this.baseNukeCritChance);
    finalEffects.nukeCritMultiplier = this.baseNukeCritMultiplier;

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

state.addAA(114, 35);      // Fury of Magic
state.addAA(397, 28);      // Destructive Fury
state.addAA(1292, 11);     // Skyblaze Focus
state.addAA(44, 10);       // Quick Damage
state.addSpell(58579);     // Cleric Spell Haste
state.addWorn(46666);      // Legs haste
state.addWorn(57723);      // Skyfire Type 3
state.addAA(1263, 8);      // Destructive Adept
state.addAA(850, 20);      // Sorc Vengeance
state.addSpell(51090);     // Improved Twincast
//state.addSpell(51502);    // Improved Familiar
//state.addWorn(9522);      // Fire 1 to 25% max level 75
//state.addSpell(51599);    // IOG

state.addToQueue(56872);   // skyfire
state.run(300);