"""Optional maintainer command; fonttools==4.61.1. No runtime font downloads."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf'
SOURCE_SHA256 = '2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc'
source = urlopen(URL, timeout=60).read()
if sha256(source).hexdigest() != SOURCE_SHA256:
    raise ValueError('Upstream changed; review the font and license before changing the pinned hash.')
font = TTFont(BytesIO(source), recalcTimestamp=False)
for weight, variant in [(400, 'Regular'), (700, 'Bold')]:
    output = instantiateVariableFont(font, {'wght': weight}, inplace=False)
    output.recalcTimestamp = False
    names = {1:'Noto Serif JP',2:variant,4:'Noto Serif JP '+variant,6:'NotoSerifJP-'+variant,16:'Noto Serif JP',17:variant}
    for record in output['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    output.save(ROOT / f'public/fonts/NotoSerifJP-{variant}.ttf')
    print(variant, 'generated')
