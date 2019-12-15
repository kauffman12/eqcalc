const Damage = require('./damage.js');

class Effects
{
  constructor()
  {
    // initialize
    let me = this;
    ['doTCritChance', 'doTCritMultiplier', 'nukeCritChance', 'nukeCritMultiplier', 'luckChance'].forEach(prop => me[prop] = 0.0);
    [124, 127, 128, 132, 286, 296, 297, 302, 303, 389, 399, 413, 461, 462, 483, 484, 507].forEach(spa => me['spa' + spa] = 0);
    this.chargedSpellList = [];
    this.spellProcs = [];
    this.hasSpa497 = false;
    this.resetLockouts = false;
  }
}

class EffectsCategory
{
  constructor(spellDB)
  {
    this.spellDB = spellDB;
    this.categories = [];
    this.categoryCache = new Map();
    this.processChecks = null;
    this.processList = null;
  }

  getChargedSpells()
  {
    return this.chargedSpellList;
  }

  buildEffects(spell, inTwincast = false)
  {
    let finalEffects = new Effects();

    // process the spell itself
    this.processSlots(spell, inTwincast, spell.slotList, finalEffects);

    // add up each category of effects
    this.categories.forEach(category =>
    {
      category.forEach((slots) => this.processSlots(spell, inTwincast, slots, finalEffects));
    });

    return finalEffects;
  }

  processSlots(spell, inTwincast, slots, finalEffects)
  {
    let handled340 = false;
    let handled469 = false;

    slots.forEach(slot =>
    {
      switch (slot.spa)
      {
        case 0: case 79: case 470:
          finalEffects.spellProcs.push(slot);
          break;

        case 170:
          finalEffects.nukeCritMultiplier += slot.base1;
          break;

        case 273:
          finalEffects.doTCritChance += slot.base1;
          break;

        case 212: case 294:
          finalEffects.nukeCritChance += slot.base1;
          break;

        case 339:
          if ((!inTwincast || !slot.effect || !slot.effect.hasSpa497) && Math.random() * 100 <= slot.base1)
          {
            finalEffects.spellProcs.push(slot);
          }
          break;

        // only one may proc per spell/effect
        case 340:
          if (!handled340 && Math.random() * 100 <= slot.base1)
          {
            handled340 = true;
            finalEffects.spellProcs.push(slot);
          }
          break;

        case 374:
          if (Math.random() * 100 <= slot.base1)
          {
            finalEffects.spellProcs.push(slot);
          }
          break;

        case 375:
          finalEffects.doTCritMultiplier += slot.base1;
          break;

        case 383:
          if ((!inTwincast || !slot.effect || !slot.effect.hasSpa497) && Math.random() <= Damage.calculateScalingMultiplier(spell.castTime))
          {
            finalEffects.spellProcs.push(slot);
          }
          break;

        case 389:
          finalEffects.resetLockouts = spell.id;
          break;

        // only one may proc per spell/effect
        case 469:
          if (!handled469 && Math.random() * 100 <= slot.base1)
          {
            handled469 = true;
            finalEffects.spellProcs.push(slot);
          }
          break;

        case 124: case 127: case 128: case 132: case 212: case 286: case 296: case 297: case 302: case 303: case 389:
        case 399: case 413: case 461: case 462: case 483: case 484: case 507:
          // bards don't seem to benefit from SPA 124
          if (slot.spa !== 124 || !spell.songCap)
          {
            let value = 0;

            if (slot.base1 > 0)
            {
              if (slot.spa === 128)
              {
                value = spell.beneficial ? slot.base1 : Damage.randomInRange(slot.base2 || 1, slot.base1 || 1);
              }
              else
              {
                value = (slot.base2 === 0 || slot.base1 === slot.base2) ? slot.base1 : Damage.randomInRange(slot.base2, slot.base1);
              }
            }
            else
            {
              if (slot.spa === 128)
              {
                value = slot.base2 === 0 ? slot.base1 : Damage.randomInRange(slot.base1, -1);
              }
              else
              {
                value = slot.base2 !== 0 ? slot.base1 : Damage.randomInRange(slot.base1, slot.base2);
              }
            }

            if (slot.reduceBy > 0)
            {
              value = Math.trunc(value * (1 - slot.reduceBy / 100));
              value = value < 0 ? 0 : value;
            }

            // convert from percent to actual value
            if (slot.spa === 128)
            {
              let calc = Math.trunc(spell.duration * value / 100);
              value = value > 0 ? Math.max(1, calc) : Math.min(-1, calc);
            }

            // update charged map if needed
            if (slot.effect && slot.effect.maxHitsType === Damage.MaxHitsTypes.MATCHING)
            {
              finalEffects.chargedSpellList.push(slot.effect);
            }

            finalEffects['spa' + slot.spa] += value;

            // SPA 127 has a max value
            if (slot.spa === 127 && finalEffects['spa127'] > 50)
            {
              finalEffects['spa127'] = 50;
            }
          }

          break;
      }
    });
  }

  addCategory(effectList, spell, playerClass, cacheId)
  {
    if (cacheId && this.categoryCache.has(cacheId + spell.id))
    {
      this.categories.push(this.categoryCache.get(cacheId + spell.id));
    }
    else
    {
      let category = this.buildCategory(effectList, spell, playerClass);
      this.categories.push(category);

      if (cacheId)
      {
        this.categoryCache.set(cacheId + spell.id, category);
      }
    }
  }

  buildCategory(effectList, spell, playerClass)
  {
    let category = new Map();
    effectList.forEach(effect =>
    {
      this.processChecks = new LimitChecks();
      this.processList = [];

      effect.slotList.forEach(slot =>
      {
        switch (slot.spa)
        {
          // 10 means the slot is empty, 39 is twincast blocker, 148 is stacking related?
          case 10: case 39: case 148:
            break;

          // unhandled limit checks
          case 412: case 415: case 422: case 423: case 486: case 492: case 493:
            console.debug('unhandled limit check ' + slot.spa);
            this.processChecks.unknown = true; // let it pass for now
            break;

          // Crit Damage Modifiers don't follow limit checks, do not require spells to be focusable, and stack
          case 170: case 273: case 294: case 375:
            this.updateCategory(category, slot);
            break;

          // SPAs that follow the normal rules, may or may not support a range of values, and they do not support stacking
          case 124: case 127: case 128: case 132: case 212: case 286: case 296: case 297: case 302: case 303: case 339: case 383: case 389:
          case 399: case 413: case 461: case 462: case 483: case 484: case 507:
            // before going on to a non-limit check, check if previous had passed and start over to handle multiple sections in one spell
            this.debugFailure(this.processUpdates(category), spell, effect);
            this.processList.push({ spa: slot.spa, base1: slot.base1, base2: slot.base2, spell: spell, effect: effect }); // copy values
            break;

          // Limit Checks
          case 134:
            // max level but also handles decay if base2 is set
            let difference = slot.base1 - spell.level;
            this.processChecks.maxLevel = difference >= 0 || (slot.base2 > 0 && slot.base2 < 100);

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
                this.spellDB.findSpaSlot(spell, Math.abs(slot.base1)) === undefined;
            }
            else
            {
              // only include spells with specified SPA
              this.processChecks.currentHp = this.processChecks.currentHp || this.spellDB.findSpaSlot(spell, Math.abs(slot.base1)) !== undefined;
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
            this.processChecks.combatSkills = this.spellDB.findSpaSlot(spell, 193) === undefined;
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
          case 403:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              this.processChecks.spellClass = this.processChecks.spellClass === false ? this.processChecks.spellClass : spell.spellClass !== Math.abs(slot.base1);
            }
            else
            {
              // only include spells with specified id
              this.processChecks.spellClass = this.processChecks.spellClass || spell.spellClass === Math.abs(slot.base1);
            }
            break;
          case 404:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              this.processChecks.spellSubclass = this.processChecks.spellSubclass === false ? this.processChecks.spellSubclass
                : spell.spellSubclass !== Math.abs(slot.base1);
            }
            else
            {
              // only include spells with specified id
              this.processChecks.spellSubclass = this.processChecks.spellSubclass || spell.spellSubclass === Math.abs(slot.base1);
            }
            break;
          case 411: case 485:
            if (slot.base1 < 0)
            {
              // needs to fail if any of the exclude checks match
              this.processChecks.playerClass = this.processChecks.playerClass === false ? this.processChecks.playerClass :
                ((Math.abs(slot.base1) & playerClass) !== playerClass);
            }
            else
            {
              // only include players that match the correct class
              this.processChecks.playerClass = this.processChecks.playerClass || ((slot.base1 & playerClass) === playerClass);
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
          case 460:
            this.processChecks.includeNonFocusable = spell.focusable === 1;
            break;
          case 479:
            // only one check needs to pass
            this.processChecks.maxValue = (this.processChecks.maxValue || this.spellDB.hasSpaWithMaxBase1(spell, slot.base2, slot.base1));
            break;
          case 480:
            // only one check needs to pass
            this.processChecks.minValue = (this.processChecks.minValue || this.spellDB.hasSpaWithMinBase1(spell, slot.base2, slot.base1));
            break;
          case 490: case 511: // not sure if 511 follows this
            this.processChecks.minRecastTime = spell.recastTime >= slot.base1;
            break;
          case 491:
            this.processChecks.maxRecastTime = spell.recastTime <= slot.base1;
            break;
          case 495:
            this.processChecks.maxDuration = spell.duration <= slot.base1;
            break;
          case 497:
            effect.hasSpa497 = true;
            break;
          default:
            this.debugFailure(this.processUpdates(category), spell, effect);
        }
      });

      // process remaining
      this.debugFailure(this.processUpdates(category, true), spell, effect);
    });

    return category;
  }

  processUpdates(category, complete = false)
  {
    let failure = undefined;

    let hasLimits = this.processChecks.hasLimitsToCheck();
    if (this.processList.length > 0 && (hasLimits || complete))
    {
      if (!hasLimits || this.processChecks.passed())
      {
        this.processList.forEach(slot => 
        {
          if (this.processChecks.includeNonFocusable || slot.spell.focusable !== 1)
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
        failure = this.processChecks;
        this.processChecks = new LimitChecks();
        this.processList = [];
      }
    }

    return failure;
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

  clear()
  {
    this.categories = [];
  }

  debugFailure(failure, spell, effect)
  {
    if (failure)
    {
      //console.debug(spell.name + " failed on " + effect.name);
      //console.debug(failure);
    }
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

module.exports = EffectsCategory;