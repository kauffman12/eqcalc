const Utils = require('./utils.js');
const SpellDatabase = require('./spelldb.js');
const EffectsCategory = require('./effects.js');

class PlayerState
{
  constructor(playerClass, level = 115, spellDamage = 0, lagTime = 0)
  {
    this.baseDoTCritChance = 0;
    this.baseDoTCritMultiplier = 0;
    this.baseNukeCritChance = 0;
    this.baseNukeCritMultiplier = 100;
    this.castQueue = [];
    this.currentTime = 0;
    this.increaseBuffDuration = 2.0;
    this.lagTime = lagTime;
    this.level = level;
    this.passiveAAList = [];
    this.playerClass = playerClass;
    this.spellDB = new SpellDatabase(playerClass);
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

    this.castQueue.forEach(info => info.spell.updateDuration(this.level));

    let count = 1;
    let lockouts = [];
    while (this.currentTime < (seconds * 1000))
    {
      let info = this.castQueue.find(info => info.readyTime <= this.currentTime && !lockouts.find(lock => lock.timerId === info.spell.timerId));

      if (info)
      {
        let spell = info.spell;
        let results = this.cast(spell);
        results.cast = count;
        results.name = spell.name;
        results.time = this.currentTime;
        console.debug(results);
 
        if (results.needTwincast)
        {
          let twincast = this.cast(spell);
          twincast.cast = count;
          twincast.name = spell.name;
          twincast.damage.twincast = true;
          console.debug(twincast);
        }

        info.readyTime = this.currentTime + results.actualCastTime + spell.recastTime;

        if (spell.timerId)
        {
          lockouts.push({ timerId: spell.timerId, unlockTime: info.readyTime });
        }

        count++;
        this.currentTime += results.actualCastTime + spell.lockoutTime + this.lagTime;
      }
      else
      {
        this.currentTime += 100;
      }

      this.spellList = this.spellList.filter(spell => spell.expireTime > this.currentTime);
      lockouts = lockouts.filter(lock => lock.unlockTime > this.currentTime);
    }
  }

  cast(spell)
  {
    let finalEffects = this.buildEffects(spell);

    let results = {};
    results.needTwincast = finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399;
    results.duration = spell.duration + finalEffects.spa128;
    results.actualCastTime = spell.castTime - Math.trunc(finalEffects.spa127 * spell.castTime / 100);

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
    chargedSpellList.forEach(data => 
    {
      if (!alreadyCharged.has(data.spell.id) && --data.remainingHits === 0)
      {
        this.spellList = this.spellList.filter(existing => existing.id !== data.spell.id);
      }

      alreadyCharged.set(data.spell.id, true);
    });
  }

  buildEffects(spell)
  {  
    let effectsBuilder = new EffectsCategory(this.spellDB);
    effectsBuilder.addCategory(this.passiveAAList, spell);
    effectsBuilder.addCategory(this.spellList, spell);
    effectsBuilder.addCategory(this.wornList, spell);

    let finalEffects = effectsBuilder.buildEffects();
    finalEffects.doTCritChance += this.baseDoTCritChance;
    finalEffects.doTCritMultiplier += this.baseDoTCritMultiplier;
    finalEffects.nukeCritChance += Utils.calculateBaseNukeCritChance(this.baseNukeCritChance);
    finalEffects.nukeCritMultiplier += this.baseNukeCritMultiplier;

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
    this.castQueue.push({ spell: this.spellDB.getSpell(id), readyTime: 0 });
  }  
}

let state = new PlayerState(Utils.Classes.WIZ, 110, 3000, 100);
state.addAA(114, 35);      // Fury of Magic
state.addAA(397, 28);      // Destructive Fury
state.addAA(1292, 11);     // Skyblaze Focus
state.addAA(44, 10);       // Quick Damage
state.addSpell(58579);     // Cleric Spell Haste
state.addWorn(46666);      // Legs haste
state.addWorn(57723);      // Skyfire Type 3
state.addAA(1263, 8);      // Destructive Adept
state.addAA(850, 20);      // Sorc Vengeance
//state.addSpell(51090);     // Improved Twincast
state.addSpell(51502);    // Improved Familiar
//state.addWorn(9522);      // Fire 1 to 25% max level 75
//state.addSpell(51599);    // IOG

//state.addToQueue(56872);   // skyfire
//state.addToQueue(56848);   // icefloe
state.addToQueue(56796);   // cloudburst
state.addToQueue(56851);   // flashburn
state.run(30);