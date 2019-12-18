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
    let action = undefined;

    while (this.currentTime <= endTime)
    {
      // reset was issued from cast
      if (this.resetLockouts)
      {
        lockouts = [];
        actionLockTime = 0;

        let resetSpell = this.spellDB.getSpell(this.resetLockouts);
        if (resetSpell)
        {
          this.castQueue.forEach(item =>
          {
            let category = this.effectsBuilder.buildCategory([resetSpell], item.spell, this.playerClass, false);
            item.readyTime = (category.has(389)) ? this.currentTime : item.readyTime;
          });
        }

        this.resetLockouts = undefined;
      }

      if (actionLockTime <= this.currentTime)
      {
        // expire buffs before running actions
        this.buffList = this.buffList.filter(spell => (spell.frozen || spell.expireTime > this.currentTime));

        let info = this.castQueue.find(info => info.readyTime <= this.currentTime && !lockouts.find(lock => lock.timerId === info.spell.timerId));

        if (info)
        {
          let spell = info.spell;
          let preCastEffects = this.getEffects(spell);

          action = {};
          action.spell = spell;
          action.castTime = spell.castTime - Math.trunc(preCastEffects.spa127 * spell.castTime / 100),
          action.startTime = this.currentTime;
          action.hitTime = this.currentTime + action.castTime;
          actionLockTime = action.hitTime + spell.lockoutTime + this.lagTime;
          info.readyTime = Math.max(this.currentTime + info.interval, this.currentTime + action.castTime + spell.recastTime);

          if (spell.timerId)
          {
            lockouts.push({ timerId: spell.timerId, unlockTime: info.readyTime });
          }
        }
      }

      this.currentTime += 100;

      if (action && this.currentTime >= action.hitTime)
      {
        // expire buffs before running actions but his the actual hitTime in this case
        this.buffList = this.buffList.filter(spell => (spell.frozen || spell.expireTime > action.hitTime));

        let result = this.cast(action.spell);
        result.cast = count;
        result.castTime = action.castTime;
        result.hitTime = action.hitTime;
        result.startTime = action.startTime;
        results.push(result);
        count++;
        action = undefined;
      }

      if (this.currentTime % Damage.TickLength === 0 && this.doTQueue.length > 0)
      {
        // expire buffs before running actions
        this.buffList = this.buffList.filter(spell => (spell.frozen || spell.expireTime > this.currentTime));

        this.doTQueue = this.doTQueue.filter(spell => spell.ticksRemaining > 0);
        this.doTQueue.forEach(spell =>
        {
          let slot = this.spellDB.findSpaSlot(spell, 0);
          if (spell.ticksRemaining > 0 && slot)
          {
            // add damage for one hit / tick
            let result = { name: spell.name, hitTime: this.currentTime, tick: (spell.ticks - spell.ticksRemaining) + 1 };

            // ignore feedbacks
            if (!spell.isSelfDamaging())
            {
              // base damage can increase with time and needs to be calculated per tick
              let baseDamage = Math.abs(Damage.calculateValue(slot.calc, slot.base1, slot.max, spell.ticksRemaining, this.level));
              result.damage = Damage.calculateDamage(this.level, this.spellDamage, spell, baseDamage, this.luck, false, spell.ticks, this.getEffects(spell));

              if (spell.doTwincast)
              {
                result.damage.amount *= 2;
                result.damage.twincast = true;
              }

              result.damage.spa = slot.spa;
            }

            results.push(result);
            spell.ticksRemaining--;
          }
        });
      }

      lockouts = lockouts.filter(lock => lock.unlockTime > this.currentTime);
    }

    return results;
  }

  cast(spell, inTwincast)
  {
    let finalEffects = this.getEffects(spell, inTwincast);

    this.resetLockouts = finalEffects.resetLockouts;
    let needTwincast = !inTwincast && finalEffects.spa399 > 0 && Math.random() * 100 <= finalEffects.spa399;

    let result = { name: spell.name };
    this.updateSpellDuration(spell, finalEffects);

    finalEffects.spellProcs.forEach(slot =>
    {
      switch (slot.spa)
      {
        case 0: case 79:
          // execute right away if it's a nuke
          if ((spell.duration === 0 || slot.spa === 79) && !spell.isSelfDamaging())
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

        case 339: case 340: case 374: case 383:
          this.addProc(result, this.spellDB.getSpell(slot.base2), slot.base2);
          break;

        case 469: case 470:
          this.addProc(result, this.spellDB.getBestSpellInGroup(slot.base2), slot.base2);
          break;
      }
    });

    // charge spells
    this.charge(finalEffects.chargedSpellList);

    // recouse is done last before possible twincast
    if (spell.recourseId)
    {
      this.addProc(result, this.spellDB.getSpell(spell.recourseId));
    }

    // if spell has duration that add it to the buff list
    if (spell.duration > 0)
    {
      let found = this.buffList.find(buff => buff.id === spell.id) || spell;
      this.buffList.push(found);
    }

    // twincast if needed
    if (needTwincast && result.damage)
    {
      result.twincast = this.cast(spell, true);
    }

    return result;
  }

  addProc(result, proc, spellId)
  {
    result.procs = result.procs || [];

    if (proc)
    {
      result.procs.push(this.cast(proc));
    }
    else
    {
      result.procs.push({ name: 'Missing Spell (Ignored)', id: spellId });
    }
  }

  updateSpellDuration(spell, finalEffects)
  {
    spell.updateDuration(this.level);

    let extended = spell.duration;
    if (spell.beneficial)
    {
      extended *= (spell.focusable !== 1) ? this.increaseBuffDuration : 1;
    }
    else if (finalEffects && finalEffects.spa128 > 0)
    {
      extended += finalEffects.spa128;
    }

    spell.ticks = spell.ticksRemaining = extended + 1;
    spell.expireTime = this.currentTime + (extended * Damage.TickLength) + Damage.randomInRange(0, Damage.TickLength);
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

  getEffects(spell, inTwincast = false)
  {
    this.effectsBuilder.clear();

    // cache worn and AAs since they don't change
    this.effectsBuilder.addCategory(this.aaList, spell, this.playerClass, 'aaCacheId');
    this.effectsBuilder.addCategory(this.wornList, spell, this.playerClass, 'wornCacheId');
    this.effectsBuilder.addCategory(this.buffList, spell, this.playerClass);

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
  constructor(iterations = 0)
  {
    this.count = 0;
    this.critCount = 0;
    this.luckyCount = 0;
    this.iterations = iterations;
    this.max = 0;
    this.min = 0;
    this.spellCounts = {};
    this.tcCount = 0;
    this.totalDamage = 0;
    this.lastTime = 0;
  }

  add(result, inTwincast = false)
  {
    if (result.damage)
    {
      this.countDamage(result.name, result.damage, inTwincast);
      this.lastTime = result.hitTime || this.lastTime;
    }

    if (result.twincast)
    {
      this.add(result.twincast, true);
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
    this.min = this.min ? Math.min(this.min, damage.amount) : damage.amount;

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
    console.debug("DPS: " + Math.round(this.totalDamage / (this.lastTime / 1000 * this.iterations)));
    console.debug(this.spellCounts);
  }
}

let testMage =
{
  getState: () =>
  {
    let state = new PlayerState(Damage.Classes.MAG, 115, 2000, 0, 100);
    state.addAA(44, 10);       // Quick Damage
    state.addAA(1664, 9);
    state.addWorn(46666);      // Legs haste

    state.addToQueue(60293);
    state.addToQueue(60308);
    state.addToQueue(57046);
    return state;
  },

  updateBuffs: (state) =>
  {
    state.addBuff(58579);     // Cleric Spell Haste
    state.freezeCurrentBuffs();
  }
}

let testWizard =
{
  getState: () =>
  {
    let state = new PlayerState(Damage.Classes.WIZ, 110, 2349, 0, 100);

    // static effects
    state.addAA(114, 35);      // Fury of Magic
    state.addAA(397, 36);      // Destructive Fury
    state.addAA(1292, 11);     // Skyblaze Focus
    state.addAA(1291, 11);     // Rimeblast Focus
    state.addAA(1033, 11);     // Flash Focus
    state.addAA(1031, 11);     // Claw Focus
    state.addAA(1034, 11);     // Cloudburst Focus
    state.addAA(1294, 10);     // Vortex Focus
    state.addAA(44, 10);       // Quick Damage
    state.addAA(1263, 8);      // Destructive Adept
    state.addAA(850, 20);      // Sorc Vengeance
    state.addAA(476, 5);       // Keepers 5
    state.addAA(1405, 5);      // Twincast 5%
    state.addAA(1664, 8);      // Twinproc
    state.addAA(1264, 3);      // Arcane Fusion
    state.addWorn(49694);      // Eyes of Life and Decay
    state.addWorn(45815);      // TBL Raid Robe
    state.addWorn(45949);      // TBL Raid Gloves
    state.addWorn(45945);      // TBL Raid Helm
    state.addWorn(45947);      // TBL Raid Arms
    state.addWorn(46666);      // Legs haste
    state.addWorn(57723);      // Skyfire Type 3
    state.addWorn(57727);      // Cloudburst Type 3
    state.addWorn(57724);      // Claw Type 3
    //state.addWorn(24417);      // TBM belt
    state.addWorn(50833);      // Threads Belt

    // cast queue
    //state.addToQueue(58164);   // Stormjolt
    state.addToQueue(56812);   // Claw of Qunard
    state.addToQueue(56897);   // Braid
    state.addToQueue(56796);   // Cloudburst
    state.addToQueue(56872);   // skyfire
    //state.addToQueue(56774);   // wildflash

    //state.addToQueue(58149);   // dissident
    //state.addToQueue(56848);   // icefloe
    return state;
  },

  updateBuffs: (state) =>
  {
    state.addBuff(58579);     // Cleric Spell Haste
    state.addBuff(51502);     // Improved Familiar
    state.addBuff(49353);     // Dragonmagic Potion
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
    state.freezeCurrentBuffs();
  }
};

let testBard =
{
  getState: () =>
  {
    let state = new PlayerState(Damage.Classes.BRD, 115, 436, 0, 100);

    // static effects
    state.addAA(358, 21);      // Fury of Magic
    state.addAA(259, 12);      // Critical Afflication
    state.addAA(1022, 27);     // Destructive Fury
    state.addAA(942, 28);      // Destructive Cascade
    state.addAA(2161, 8);      // Brusco's Burning Call
    state.addAA(2162, 45);     // Improved Chants
    state.addAA(90, 10);       // Instrument Mastery
    state.addAA(118, 1);       // Singing Mastery
    state.addAA(1254, 6);      // Twinsong

    state.addWorn(46985);      // Restless Focus
    state.addWorn(21238);      // TBL Group Gloves
    state.addWorn(21188);      // TBL Group Helm
    state.addWorn(21138);      // TBL Group Arms
    state.addWorn(46666);      // Legs haste

    // cast queue
    state.addToQueue(59587, 20);   // Sontalak's Chant
    state.addToQueue(59528, 20);   // Malvus's Chant
    state.addToQueue(59501, 20);   // Yelinak's Chant
    state.addToQueue(59479, 20);   // Zlexak's Chant
    //state.addToQueue(59566, 10);   // Sofia's Burning Call II
    state.addToQueue(56175);       // Sathir's Insult

    return state;
  },

  updateBuffs: (state) =>
  {
    state.addBuff(6271);      // Vesagran
    state.addBuff(41287);     // Auspice
    state.addBuff(52268);     // Glyph
    state.addBuff(37139);     // Fierce Eye
    state.addBuff(38189);     // IOG
    state.addBuff(58579);     // Cleric Spell Haste
    state.addBuff(59524);     // Sontalak's Aria
    state.addBuff(52211);     // Season's Wrath
    state.addBuff(59464);     // Aria rk2
    state.addBuff(59280);     // Erupting Sunray
    state.addBuff(46765);     // Masterful Root
    state.addBuff(16848);     // Bard Synergy
  }
};

let tester = testBard;
let state = tester.getState();

let tests = 1;
let runTime = 60;
let counter = new DamageCounter(tests);

for (let i = 0; i < tests; i++)
{
  // clear out any old buffs
  state.resetSpells();

  // add back things that expire
  tester.updateBuffs(state);

  state.run(runTime).forEach(result =>
  {
    console.log(Util.inspect(result, { compact: true, depth: 5, breakLength: 180, colors: true }));
    counter.add(result);
  });
}

counter.printStats();
