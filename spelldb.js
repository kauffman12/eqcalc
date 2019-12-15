const Targets = { SELF: 6 }

class AA
{
  constructor(data)
  {
    this.name = data.name;
    this.id = data.id;
    this.rank = data.rank;
    this.slotList = data.slotList;
  }
}

class Worn
{
  constructor(data)
  {
    this.name = data.name;
    this.id = data.id;
    this.slotList = data.slotList;
  }
}

class Spell
{
  constructor(data)
  {
    Object.assign(this, data);
    this.duration = this.duration2;
    this.expireTime = 0;
    this.frozen = false;
    this.doTwincast = false;
    this.remainingHits = this.maxHits;
    this.ticks = 0;
    this.ticksRemaining = 0;
  }

  isSelfDamaging()
  {
    return (!this.beneficial && this.target === Targets.SELF);
  }

  updateDuration(playerLevel)
  {
    let value = 0;
    switch (this.duration1)
    {
      case 0:
        value = 0;
        break;
      case 1:
        value = Math.trunc(playerLevel / 2) || 1;
        break;
      case 2:
        value = Math.trunc(playerLevel / 2) + 5;
        value = value < 6 ? 6 : value;
          break;
      case 3:
        value = playerLevel * 30;
        break;
      case 4:
        value = 50;
        break;
      case 5:
        value = 2;
        break;
      case 6:
        value = Math.trunc(playerLevel / 2);
        break;
      case 7:
        value = playerLevel;
        break;
      case 8:
        value = playerLevel + 10;
        break;
      case 9:
        value = playerLevel * 2 + 10;
        break;
      case 10:
        value = playerLevel * 30 + 10;
        break;
      case 11:
        value = (playerLevel + 3) * 30;
        break;
      case 12:
        value = Math.trunc(playerLevel / 2) || 1;
        break;
      case 13:
        value = playerLevel * 4 + 10;
        break;
      case 14:
        value = playerLevel * 5 + 10;
        break;
      case 15:
        value = (playerLevel * 5 + 50) * 2;
        break;
      case 50:
        value = 72000;
        break;
      case 3600:
        value = 3600;
        break;
      default:
        value = this.duration2;
        break;
    }
  
    this.duration = (this.duration2 > 0 && value > this.duration2) ? this.duration2 : value;
  }  
}

class SpellDatabase
{
  constructor(playerClass)
  {
    this.aas = new Map();
    this.spells = new Map();
    this.spellGroups = new Map();
    this.bestSpellInGroup = new Map();
    this.cache = new Map();

    let aas = require('./data/AA' + playerClass + '.json');
    if (aas && aas.length > 0)
    {
      aas.forEach(aa => this.aas.set(aa.id + '-' + aa.rank, aa));
    }

    let data = require('./data/spells.json');
    if (data && data['spells'])
    {
      this.spells = data['spells'];
      Object.getOwnPropertyNames(this.spells).forEach(prop =>
      {
        let spell = this.spells[prop];
        if (spell && spell.group > 0)
        {
          let list = this.spellGroups.get(spell.group) || new Set();
          list.add(spell.id);
          this.spellGroups.set(spell.group, list);

          let bestSpell = this.bestSpellInGroup.get(spell.group);
          if (!bestSpell || bestSpell < spell.id)
          {
            this.bestSpellInGroup.set(spell.group, spell.id);
          }
        }
      });
    }
  }

  findSpaSlot(spell, spa)
  {
    let result = undefined;

    for (let i = 0; i < spell.slotList.length; i++)
    {
      let slot = spell.slotList[i];
      
      if (slot.spa === spa)
      {
        result = slot;
        break;
      }
    }

    return result;
  }

  hasSpaWithMaxBase1(spell, spa, value)
  {
    let found = this.findSpaSlot(spell, spa);
    return found !== undefined && found.base1 >= value;
  }

  hasSpaWithMinBase1(spell, spa, value)
  {
    let found = this.findSpaSlot(spell, spa);
    return found !== undefined && found.base1 <= value;
  }  

  getAA(id, rank)
  {
    let key = id + '-' + rank;
    return this.aas.has(key) ? new AA(this.aas.get(key)) : undefined;
  }

  getSpell(id)
  {
    return this.spells[id] ? new Spell(this.spells[id]) : undefined;
  }
  
  getWorn(id)
  {
    return this.spells[id] ? new Worn(this.spells[id]) : undefined;
  }

  getBestSpellInGroup(id)
  {
    let best = this.bestSpellInGroup.get(id);
    return best ? this.getSpell(best) : undefined;
  }

  isSpellInGroup(spellId, groupId)
  {
    let group = this.spellGroups.get(groupId);
    return (group && group.has(spellId)) === true;
  }
}

module.exports = SpellDatabase;