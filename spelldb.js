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