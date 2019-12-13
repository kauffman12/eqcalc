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
    this.currentTime = 0;
    this.resetLockouts = undefined;
    this.increaseBuffDuration = 2.0;
    this.lagTime = lagTime;
    this.level = level;
    this.luck = luck;
    this.playerClass = playerClass;
    this.spellDB = new SpellDatabase(playerClass);
    this.spellDamage = spellDamage;
    this.effectsBuilder = new EffectsCategory(this.spellDB);

    this.aaList = [];
    this.buffList = [];
    this.wornList = [];
    this.castQueue = [];
    this.doTQueue = [];
  }

  run(seconds)
  {
    this.currentTime = 0;

    this.buffList.forEach(spell => this.updateSpellDuration(spell));

    this.castQueue.forEach(info => 
    {
      info.spell.updateDuration(this.level);
      info.readyTime = 0;
    });

    let count = 1;
    let endTime = (seconds * 1000);
    let lockouts = [];
    let results = [];
    let actionLockTime = 0;

    while (this.currentTime <= endTime)
    {
      if (this.resetLockouts)
      {
        lockouts = [];
        actionLockTime = 0;

        this.castQueue.forEach(item =>
        {
          let category = this.effectsBuilder.buildCategory([this.resetLockouts], item.spell, this.playerClass);
          item.readyTime = (category.has(389)) ? this.currentTime : item.readyTime;
        });

        this.resetLockouts = undefined;
      }

      if (actionLockTime <= this.currentTime)
      {
        let info = this.castQueue.find(info => info.readyTime <= this.currentTime && !lockouts.find(lock => lock.timerId === info.spell.timerId));

        if (info)
        {
          let spell = info.spell;
          let result = this.cast(spell);
  
          result.cast = count;
          result.startTime = this.currentTime;
          result.hitTime = this.currentTime + result.castTime;
          actionLockTime = result.hitTime + spell.lockoutTime + this.lagTime;
          info.readyTime = Math.max(this.currentTime + info.interval, this.currentTime + result.castTime + spell.recastTime);
  
          if (spell.timerId)
          {
            lockouts.push({ timerId: spell.timerId, unlockTime: info.readyTime });
          }
    
          if (result.hitTime <= endTime)
          {
            results.push(result);
            count++;
          }
        }  
      }

      this.currentTime += 200;

      if (this.currentTime % 6000 === 0)
      {
        this.doTQueue = this.doTQueue.filter(spell => spell.expireTime >= this.currentTime);
        this.doTQueue.forEach(spell =>
        {
          let slot = this.spellDB.findSpaSlot(spell, 0);
          if (spell.ticksRemaining > 0 && slot)
          {
            // base damage can increase with time and needs to be calculated per tick
            let baseDamage = Math.abs(Damage.calculateValue(slot.calc, slot.base1, slot.max, spell.ticksRemaining, this.level));

            // add damage for one hit / tick
            let result = { name: spell.name, hitTime: this.currentTime, tick: (spell.ticks - spell.ticksRemaining) + 1 };
            result.damage = Damage.calculateDamage(this.level, this.spellDamage, spell, baseDamage, this.luck, false, spell.ticks, this.buildEffects(spell, true));

            if (spell.doTwincast)
            {
              result.damage.amount *= 2;
              result.damage.twincast = true;
            }

            result.damage.spa = slot.spa;
            results.push(result);
            spell.ticksRemaining--;
          }
        });
      }
      
      this.buffList = this.buffList.filter(spell => (spell.frozen || spell.expireTime > this.currentTime));
      lockouts = lockouts.filter(lock => lock.unlockTime > this.currentTime);
    }

    return results;
  }

  cast(spell, inTwincast)
  {
    let finalEffects = this.buildEffects(spell, inTwincast);
    let needTwincast = finalEffects.spa399 !== undefined && Math.random() * 100 <= finalEffects.spa399;

    let result = { name: spell.name };
    result.castTime = spell.castTime - Math.trunc(finalEffects.spa127 * spell.castTime / 100);
    this.updateSpellDuration(spell, finalEffects);

    let handled340 = false;
    let handled469 = false;
    spell.slotList.forEach(slot =>
    {
      switch(slot.spa)
      {
        case 340:
            if (!handled340 && Math.random() * 100 <= slot.base1)
            {
              handled340 = this.addProc(result, this.spellDB.getSpell(slot.base2));
            }          
          break;

        case 374:
          if (Math.random() * 100 <= slot.base1)
          {
            this.addProc(result, this.spellDB.getSpell(slot.base2));
          }
          break;

        case 389:
          this.resetLockouts = spell;
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
          if ((spell.duration === 0 || slot.spa === 79))
          {
            // base damage can increase with time and needs to be calculated per tick
            let baseDamage = Math.abs(Damage.calculateValue(slot.calc, slot.base1, slot.max, 1, this.level));

            // add damage for one hit / tick
            result.damage = Damage.calculateDamage(this.level, this.spellDamage, spell, baseDamage, this.luck, true, 1, finalEffects);
            result.damage.spa = slot.spa;
          }
          else if (!inTwincast)
          {
            let foundDot = this.doTQueue.find(dot => dot.id === spell.id) || spell;
            foundDot.doTwincast = needTwincast;
            this.doTQueue.push(foundDot);
          }

          break;
      }
    });

    if (spell.duration > 0)
    {
      let found = this.buffList.find(buff => buff.id === spell.id) || spell;
      this.buffList.push(found);
    }

    // charge spells
    this.charge(finalEffects.chargedSpellList);

    if (spell.recourseId)
    {
      this.addProc(result, this.spellDB.getSpell(spell.recourseId));
    }

    if (needTwincast && result.damage)
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

  updateSpellDuration(spell, finalEffects)
  {
    spell.updateDuration(this.level);

    let extended = spell.duration;
    if (spell.beneficial === 1)
    {
      extended *= spell.focusable ? this.increaseBuffDuration : 1;
    }
    else if (finalEffects && finalEffects.spa128 > 0)
    {
      extended += finalEffects.spa128;
    }

    spell.ticks = spell.ticksRemaining = extended + 1;
    spell.expireTime = this.currentTime + spell.ticks * Damage.TickLength;
    spell.remainingHits = spell.maxHits;    
  }

  charge(chargedSpellList)
  {
    let alreadyCharged = new Map();
    chargedSpellList.forEach(spell => 
    {
      if (!alreadyCharged.has(spell.id) && --spell.remainingHits === 0)
      {
        this.buffList = this.buffList.filter(existing => existing.id !== spell.id);
      }

      alreadyCharged.set(spell.id, true);
    });
  }

  buildEffects(spell, inTwincast)
  {  
    this.effectsBuilder.clear();
    this.effectsBuilder.addCategory(this.aaList, spell, this.playerClass);
    this.effectsBuilder.addCategory(this.buffList, spell, this.playerClass);
    this.effectsBuilder.addCategory(this.wornList, spell, this.playerClass);

    let finalEffects = this.effectsBuilder.buildEffects(spell, inTwincast);
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

  freezeCurrentBuffs()
  {
    this.buffList.forEach(spell => spell.frozen = true);
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
    this.addEffect(id, this.spellDB.getAA(id, rank), this.aaList);
  }

  addWorn(id)
  {
    this.addEffect(id, this.spellDB.getWorn(id), this.wornList);
  }

  addBuff(id)
  {
    this.addEffect(id, this.spellDB.getSpell(id), this.buffList);
  }

  addToQueue(id, interval = 0)
  {
    this.castQueue.push({ spell: this.spellDB.getSpell(id), interval: interval * 1000, readyTime: 0 });
  }

  resetSpells()
  {
    this.buffList = [];
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
    this.spellCounts = {};
    this.tcCount = 0;    
    this.totalDamage = 0;
  }

  add(result)
  {
    if (result.damage)
    {
      this.countDamage(result.name, result.damage);
    }

    if (result.twincast)
    {
      this.countDamage(result.name, result.twincast, true);
    }
  
    if (result.procs)
    {
      result.procs.forEach(proc => this.add(proc));
    }
  }

  countDamage(name, damage, inTwincast = false)
  {
    this.count++;
    this.critCount += damage.crit ? 1 : 0;
    this.luckyCount += damage.lucky ? 1 : 0;
    this.tcCount += (damage.twincast || inTwincast) ? 1 : 0;
    this.totalDamage += damage.amount;
    this.max = Math.max(this.max, damage.amount);
    this.min = this.min ? Math.min(this.min, damage.amount) : damage. amount;
    
    let update = this.spellCounts[name] || 0;
    this.spellCounts[name] = update + 1;
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
    console.debug(this.spellCounts);
  }
}

let testWizard =
{
  getState: () =>
  {
    let state = new PlayerState(Damage.Classes.WIZ, 110, 2000, 0, 100);
  
    // static effects
    state.addAA(114, 35);      // Fury of Magic
    state.addAA(397, 36);      // Destructive Fury
    state.addAA(1292, 11);     // Skyblaze Focus
    state.addAA(1291, 11);     // Rimeblast Focus
    state.addAA(1033, 11);     // Flash Focus
    state.addAA(1031, 11);     // Claw Focus
    state.addAA(1034, 11);     // Cloudburst Focus
    state.addAA(44, 10);       // Quick Damage
    state.addAA(1263, 8);      // Destructive Adept
    state.addAA(850, 20);      // Sorc Vengeance
    state.addAA(476, 5);       // Keepers 5
    state.addAA(1405, 5);      // Twincast 5%
    state.addWorn(49694);      // Eyes of Life and Decay
    state.addWorn(45815);      // TBL Raid Robe
    state.addWorn(45949);      // TBL Raid Gloves
    state.addWorn(45945);      // TBL Raid Helm
    state.addWorn(45947);      // TBL Raid Arms
    state.addWorn(46666);      // Legs haste
    state.addWorn(57723);      // Skyfire Type 3
    state.addWorn(57727);      // Cloudburst Type 3
    state.addWorn(57724);      // Claw Type 3
  
    // cast queue
    state.addToQueue(56812);   // Claw of Qunard
    //state.addToQueue(56897);   // Braid
    state.addToQueue(56796);   // Cloudburst
    state.addToQueue(56872);   // skyfire

    //state.addToQueue(58149);   // dissident
    //state.addToQueue(56848);   // icefloe
    return state;
  },
  
  updateBuffs: (state) =>
  {
    state.addBuff(58579);     // Cleric Spell Haste
    state.addBuff(51502);     // Improved Familiar
    //state.addBuff(18701);     // Twincast Aura rk3
    //state.addBuff(51599);     // IOG
    //state.addBuff(51090);     // Improved Twincast
    //state.addBuff(18882);     // Twincast
    state.freezeCurrentBuffs();
  }
};

let testDruid =
{
  getState: () =>
  {
    let state = new PlayerState(Damage.Classes.DRU, 110, 3000, 0, 100);
  
    // static effects
    state.addAA(215, 30);      // Fury of Magic
    state.addAA(526, 27);      // Critical Afflication
    state.addAA(398, 38);      // Destructive Fury
    state.addAA(3815, 39);     // Destructive Cascade
    state.addAA(2148, 6);      // NBW Focus
    state.addAA(44, 10);       // Quick Damage
    state.addAA(178, 25);      // Forest Walker
    state.addWorn(46666);      // Legs haste
    state.addWorn(57663);      // NBW Type 3
    state.addWorn(46657);      // 26% duration
  
    // cast queue
    state.addToQueue(55882, 120);   // Sunray
    state.addToQueue(56029, 30);   // NBW rk2
    state.addToQueue(55945);       // Roar
    return state;
  },
  
  updateBuffs: (state) =>
  {
    state.addBuff(58579);     // Cleric Spell Haste
    state.addBuff(51599);     // IOG
    //state.addBuff(51090);     // Improved Twincast
  }
};

let tester = testWizard;
let state = tester.getState();

let tests = 1;
let runTime = 500;
let counter = new DamageCounter(runTime, tests);

for (let i = 0; i < tests; i++)
{
  // clear out any old buffs
  state.resetSpells();

  // add back things that expire
  tester.updateBuffs(state);

  state.run(runTime).forEach(result =>
  {
    //console.log(Util.inspect(result, { compact: true, depth: 5, breakLength: 180, colors: true }));
    counter.add(result);
  });

  counter.printStats();
}