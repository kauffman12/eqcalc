import os.path
import json

DBSpellsFile = 'eqfiles/spells_us.txt'
DBSpellsStrFile = 'eqfiles/spells_us_str.txt'

IGNORE_LIST = [ 'Illusion: ', 'Reserved', 'RESERVED', 'SKU', 'N/A', 'NA ', 'TEST', 'PH', 'Placeholder' ]

IGNORE_CLASSES = [ 2, 4, 8, 16, 32, 128, 256, 512, 32768, 65535 ]

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
  myDB = []
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
      if level <= 250:
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
    entry['group'] = int(data[135])
    entry['fixedCritChance'] = int(data[145])

    slotList = []
    for slot in data[len(data) - 1].strip().split('$'):
      slots = []
      for item in slot.split('|'):
        if item != '':
          slots.append(int(item))
      slotList.append(slots)
    entry['slotList'] = slotList

    myDB.append(entry)

  with open("spells.json", "w") as write_file:
    json.dump(myDB, write_file)
    #json.dump(myDB, write_file, sort_keys=True, indent=2)

else:
  print('%s is missing. No spells will be loaded.' % DBSpellsFile)
