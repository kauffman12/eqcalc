const Damage = require('./damage.js');
const EffectsCategory = require('./effects.js');
const SpellDatabase = require('./spelldb.js');
const Util = require('util');

class PlayerState
{
  constructor(playerClass, level = 115, spellDamage = 0, luck = 0, lagTime = 0)
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
    this.luck = luck;
    this.passiveAAList = [];
    this.playerClass = playerClass;
    this.spellDB = new SpellDatabase(playerClass);
    this.spellDamage = spellDamage;
    this.spellList = [];
    this.wornList = [];
  }

  run(seconds)
  {
    this.currentTime = 0;

    this.spellList.forEach(spell =>
    {
      spell.updateDuration(this.level);
      spell.duration *= (spell.focusable) ? this.increaseBuffDuration : 1;
      spell.expireTime = this.currentTime + spell.duration * 6000;
      spell.remainingHits = spell.maxHits;
    });

    this.castQueue.forEach(info => 
    {
      info.spell.updateDuration(this.level);
      info.readyTime = 0;
    });

    let count = 1;
    let endTime = (seconds * 1000);
    let lockouts = [];
    let results = [];
    while (this.currentTime <= endTime)
    {
      let info = this.castQueue.find(info => info.readyTime <= this.currentTime && !lockouts.find(lock => lock.timerId === info.spell.timerId));

      if (info)
      {
        let spell = info.spell;
        let result = this.cast(spell);
        info.readyTime = this.currentTime + result.castTime + spell.recastTime;

        if (spell.timerId)
        {
          lockouts.push({ timerId: spell.timerId, unlockTime: info.readyTime });
        }

        this.currentTime += result.castTime + spell.lockoutTime + this.lagTime;

        if (this.currentTime <= endTime)
        {
          result.cast = count;
          result.hitTime = this.currentTime;
          results.push(result);
          count++;
        }
      }
      else
      {
        this.currentTime += 200;
      }

      this.spellList = this.spellList.filter(spell => spell.expireTime > this.currentTime);
      lockouts = lockouts.filter(lock => lock.unlockTime > this.currentTime);
    }

    return results;
  }

  cast(spell, inTwincast)
  {
    let finalEffects = this.buildEffects(spell, inTwincast);
    let needTwincast = finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399;

    let result = { name: spell.name };
    result.duration = spell.duration + finalEffects.spa128;
    result.castTime = spell.castTime - Math.trunc(finalEffects.spa127 * spell.castTime / 100);

    let handled469 = false;
    spell.slotList.forEach(slot =>
    {
      switch(slot.spa)
      {
        case 374:
          if (Math.random() * 100 <= slot.base1)
          {
            this.addProc(result, this.spellDB.getSpell(slot.base2));
          }
          break;

        case 469:
          if (!handled469 && Math.random() * 100 <= slot.base1)
          {
            handled469 = this.addProc(result, this.spellDB.getBestSpellInGroup(slot.base2));
          }
          break;

        case 470:
          this.addProc(result, this.spellDB.getBestSpellInGroup(slot.base2));
          break;

        case 0: case 79:
          // execute right away if it's a nuke
          if ((result.duration === 0 || slot.spa === 79))
          {
            // base damage can increase with time and needs to be calculated per tick
            let baseDamage = Math.abs(Damage.calculateValue(slot.calc, slot.base1, slot.max, 1, this.level));

            // add damage for one hit / tick
            result.damage = Damage.calculateDamage(this.level, this.spellDamage, spell, baseDamage, this.luck, true, 1, finalEffects);
            result.damage.spa = slot.spa;
          }
          else
          {

          }

          break;
      }
    });

    if (result.duration > 0)
    {
      this.addSpell(spell.id);
    }

    // charge spells
    this.charge(finalEffects.chargedSpellList);

    if (needTwincast)
    {
      result.twincast = this.cast(spell, true).damage;
    }

    return result;
  }

  addProc(result, proc)
  {
    let added = false;

    if (proc)
    {
      result.procs = result.procs || [];
      result.procs.push(this.cast(proc));
      added = true;
    }

    return added;
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

  buildEffects(spell, inTwincast)
  {  
    let effectsBuilder = new EffectsCategory(this.spellDB);
    effectsBuilder.addCategory(this.passiveAAList, spell);
    effectsBuilder.addCategory(this.spellList, spell);
    effectsBuilder.addCategory(this.wornList, spell);

    let finalEffects = effectsBuilder.buildEffects(inTwincast);
    finalEffects.doTCritChance += this.baseDoTCritChance;
    finalEffects.doTCritMultiplier += this.baseDoTCritMultiplier;
    finalEffects.nukeCritChance += Damage.calculateBaseNukeCritChance(this.playerClass, this.baseNukeCritChance);
    finalEffects.nukeCritMultiplier += this.baseNukeCritMultiplier;

    // update luck chance
    finalEffects.luckChance = this.luck >= 10 ? 50 : this.luck > 0 ? 45 : 0;

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

  resetSpells()
  {
    this.spellList = [];
  }
}

class DamageCounter
{
  constructor(runTime = 0, iterations = 0)
  {
    this.count = 0;
    this.critCount = 0;
    this.luckyCount = 0;
    this.iterations = iterations;
    this.runTime = runTime;
    this.max = 0;
    this.min = 0;
    this.tcCount = 0;    
    this.totalDamage = 0;
  }

  add(result)
  {
    if (result.damage)
    {
      this.countDamage(result.damage);
    }

    if (result.twincast)
    {
      this.countDamage(result.twincast);
    }
  
    if (result.procs)
    {
      result.procs.forEach(proc => this.add(proc));
    }
  }

  countDamage(damage)
  {
    this.count++;
    this.critCount += damage.crit ? 1 : 0;
    this.luckyCount += damage.lucky ? 1 : 0;
    this.tcCount += damage.twincast ? 1 : 0;
    this.totalDamage += damage.total;
    this.max = Math.max(this.max, damage.total);
    this.min = this.min ? Math.min(this.min, damage.total) : damage.total;    
  }

  printStats()
  {
    console.debug("Max: " + this.max);
    console.debug("Min: " + this.min);
    console.debug("Crit Rate: " + ((this.critCount / this.count) * 100).toFixed(2));
    console.debug("Lucky Rate: " + ((this.luckyCount / this.count) * 100).toFixed(2));
    console.debug("TC Rate: " + ((this.tcCount / this.count) * 100 * 2).toFixed(2));    
    console.debug("Total: " + this.totalDamage);
    console.debug("DPS: " + Math.round(this.totalDamage / (this.runTime * this.iterations)));
  }
}

let state = new PlayerState(Damage.Classes.WIZ, 110, 3000, 50, 200);

// static effects
state.addAA(114, 35);      // Fury of Magic
state.addAA(397, 28);      // Destructive Fury
state.addAA(1292, 11);     // Skyblaze Focus
state.addAA(44, 10);       // Quick Damage
state.addAA(1263, 8);      // Destructive Adept
state.addAA(850, 20);      // Sorc Vengeance
state.addAA(476, 5);       // Keepers 5
state.addWorn(46666);      // Legs haste
state.addWorn(57723);      // Skyfire Type 3

// cast queue
state.addToQueue(56897);   // Braid
//state.addToQueue(58149);   // dissident
state.addToQueue(56872);   // skyfire
state.addToQueue(56848);   // icefloe

let tests = 1;
let runTime = 70;
let counter = new DamageCounter(runTime, tests);

for (let i = 0; i < tests; i++)
{
  // clear out any old buffs
  state.resetSpells();

  // things that expire
  state.addSpell(58579);     // Cleric Spell Haste
  state.addSpell(51599);     // IOG
  state.addSpell(51502);     // Improved Familiar
  state.addSpell(51090);     // Improved Twincast

  //state.addSpell(18882);
  //state.addWorn(9522);      // Fire 1 to 25% max level 75

  state.run(runTime).forEach(result =>
  {
    console.log(Util.inspect(result, { compact: true, depth: 5, breakLength: 180, colors: true }));
    counter.add(result);
  });
}