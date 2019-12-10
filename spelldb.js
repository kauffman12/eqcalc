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
    this.remainingHits = this.maxHits;
    this.actualCastTime = this.castTime;
    this.duration = this.duration2;
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

  findSpaValue(spell, spa)
  {
    let result = undefined;

    for (let i = 0; i < spell.slotList.length; i++)
    {
      let slot = spell.slotList[i];
      
      if (slot.spa === spa)
      {
        result = slot.base1;
        break;
      }
      else if (slot.spa === 470)
      {
        let best = this.getBestSpellInGroup(slot.base2);
        result = best ? this.findSpaValue(best, spa) : undefined;
        break;
      }
    }

    return result;
  }

  hasSpaWithMaxValue(spell, spa, value)
  {
    let found = this.findSpaValue(spell, spa);
    return found !== undefined && found >= value;
  }

  hasSpaWithMinValue(spell, spa, value)
  {
    let found = this.findSpaValue(spell, spa);
    return found !== undefined && found <= value;
  }  

  getAA(id, rank)
  {
    let result = undefined;
    let key = id + '-' + rank;

    if (this.cache.has(key))
    {
      result = this.cache.get(key);
    }
    else if (this.aas.get(key))
    {
      result = new AA(this.aas.get(key));
      this.cache.set(key, result);
    }

    return result;
  }

  getSpell(id)
  {
    let result = undefined;

    if (this.cache.has(id))
    {
      result = this.cache.get(id);
    }
    else if (this.spells[id])
    {
      result = new Spell(this.spells[id]);
      this.cache.set(id, result);
    }

    return result;
  }
  
  getWorn(id)
  {
    let result = undefined;

    if (this.cache.has(id))
    {
      result = this.cache.get(id);
    }
    else if (this.spells[id])
    {
      result = new Worn(this.spells[id]);
      this.cache.set(id, result);
    }

    return result;
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