import os.path
import json

DBSpellsFile = 'eqfiles/spells_us.txt'
DBSpellsStrFile = 'eqfiles/spells_us_str.txt'

IGNORE_LIST = [ 'Illusion: ', 'MRC - ', 'Reserved', 'RESERVED', 'SKU', 'N/A', 'NA ', 'TEST', 'PH', 'Placeholder' ]

CLASSES = [ 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65535 ]

FOCUS_LIST = [ 170, 212, 273, 294, 375, 124, 127, 286, 296, 297, 302, 303, 374, 399, 413, 461, 462, 470, 483, 484, 507 ]


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
    spellLevel = 0
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
    entry['maxHitsType'] = int(data[104])
    entry['maxHits'] = int(data[105])
    entry['focusable'] = int(data[125]) != 1
    entry['group'] = int(data[135])
    entry['fixedCritChance'] = int(data[145])

    spellFocus = False
    doesDamage = False
    slotList = []
    for slot in data[len(data) - 1].strip().split('$'):
      slots = []
      for item in slot.split('|'):
        if item != '':
          slots.append(int(item))
      if len(slots) > 1:
        if (slots[1] == 0 or slots[1] == 79) and slots[2] < 0:
          doesDamage = True
        if slots[1] in FOCUS_LIST:
          spellFocus = True
      slotList.append(slots)
    entry['slotList'] = slotList

    if (doesDamage or spellFocus) and entry['level'] > 0:
      for c in CLASSES:
        if (entry['classMask'] & c) == c:
          parsedSpells['spells'][entry['id']] = entry
          parsedSpells['index'][c].append(entry['id'])

    if spellFocus and entry['level'] == 0:
      parsedSpells['spells'][entry['id']] = entry

  with open('spells.json', 'w') as write_file:
    json.dump(parsedSpells, write_file)
    #json.dump(parsedSpells, write_file, sort_keys=True, indent=2)

else:
  print('%s is missing. No spells will be loaded.' % DBSpellsFile)
