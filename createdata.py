import os.path
import json

DBSpellsFile = 'eqfiles/spells_us.txt'
DBSpellsStrFile = 'eqfiles/spells_us_str.txt'

IGNORE_LIST = [ 'Illusion: ', 'MRC - ', 'Reserved', 'RESERVED', 'SKU', 'N/A', 'NA ', 'TEST', 'PH', 'Placeholder' ]

CLASSES = [ 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65535 ]

FOCUS_SPAS = [ 170, 212, 273, 294, 375, 124, 127, 128, 129, 132, 286, 296, 297, 302, 303, 340, 374, 383, 389, 399, 413, 461, 462, 469, 470, 483, 484, 507 ]


dbStrings = dict()
if os.path.isfile(DBSpellsStrFile):
  print('Loading Spell Strings from %s' % DBSpellsStrFile)
  db = open(DBSpellsStrFile, 'r')
  for line in db:
    data = line.split('^')
    id = data[0]
    landOnYou = data[3]
    landOnOther = data[4]
    dbStrings[id] = { 'landsOnYou': landOnYou, 'landsOnOther': landOnOther }

if os.path.isfile(DBSpellsFile):
  print('Loading Spells DB from %s' % DBSpellsFile)
  db = open(DBSpellsFile, 'r')

  parsedSpells = dict()
  parsedSpells['index'] = dict()
  parsedSpells['spells'] = dict()

  for c in CLASSES:
    parsedSpells['index'][c] = []

  for line in db:
    entry = dict()

    data = line.split('^')
    entry['id'] = int(data[0])
    entry['name'] = data[1]

    if len(entry['name']) <= 3:
      continue

    skip = False
    for ignore in IGNORE_LIST:
      if ignore in entry['name']:
        skip = True
        break
    if skip:
      continue

    classMask = 0
    spellLevel = 255
    keepClass = False
    for i in range(38, 38+16):
      level = int(data[i])
      if level <= 254:
        classMask += (1 << (i - 38))
      if level <= 254:
        spellLevel = level

    if spellLevel > 0 and spellLevel < 85:
      continue

    entry['level'] = spellLevel
    entry['classMask'] = classMask << 1
    entry['castTime'] = int(data[8])
    entry['lockoutTime'] = int(data[9])
    entry['recastTime'] = int(data[10])
    entry['duration1'] = int(data[11])
    entry['duration2'] = int(data[12])
    entry['manaCost'] = int(data[14])
    entry['beneficial'] = int(data[30])
    entry['resist'] = int(data[31])
    entry['target'] = int(data[32])
    entry['skill'] = int(data[34])
    entry['recourseId'] = int(data[83])
    entry['timerId'] = int(data[100])
    entry['maxHitsType'] = int(data[104])
    entry['maxHits'] = int(data[105])
    entry['focusable'] = int(data[125])
    entry['songCap'] = int(data[130])
    entry['group'] = int(data[135])
    entry['fixedCritChance'] = int(data[144])
    entry['spellClass'] = int(data[148])
    entry['spellSubclass'] = int(data[149])

    spellFocus = False
    doesDamage = False
    slotList = []
    for slot in data[len(data) - 1].strip().split('$'):
      slots = {}
      split = slot.split('|')
      if len(split) == 6:
        slots["num"] = int(split[0])
        slots["spa"] = int(split[1])
        slots["base1"] = int(split[2])
        slots["base2"] = int(split[3])
        slots["calc"] = int(split[4])
        slots["max"] = int(split[5])
        if (slots["spa"] == 0 or slots["spa"] == 79) and slots["base1"] < 0:
          doesDamage = True
        if slots["spa"] in FOCUS_SPAS:
          spellFocus = True
      slotList.append(slots)
    entry['slotList'] = slotList

    if (doesDamage or spellFocus) and entry['level'] < 255:
      for c in CLASSES:
        if (entry['classMask'] & c) == c:
          parsedSpells['spells'][entry['id']] = entry
          parsedSpells['index'][c].append(entry['id'])

    if (doesDamage or spellFocus) and entry['level'] == 255:
      parsedSpells['spells'][entry['id']] = entry

  with open('data/spells.json', 'w') as write_file:
    json.dump(parsedSpells, write_file)
    #json.dump(parsedSpells, write_file, sort_keys=True, indent=2)

else:
  print('%s is missing. No spells will be loaded.' % DBSpellsFile)
