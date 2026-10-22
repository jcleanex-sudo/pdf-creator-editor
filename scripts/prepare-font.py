"""Optional maintainer command: python with fonttools==4.61.1. Not needed to run/build the app."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
SOURCE_SHA256 = "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f"
source = urlopen(URL, timeout=60).read()
if sha256(source).hexdigest() != SOURCE_SHA256:
    raise ValueError("Upstream font changed. Review provenance and license before updating the expected hash.")
font = TTFont(BytesIO(source), recalcTimestamp=False)
for weight, variant in [(400, "Regular"), (700, "Bold")]:
    instance = instantiateVariableFont(font, {"wght": weight}, inplace=False)
    instance.recalcTimestamp = False
    if variant == "Bold":
        names = {1: "Noto Sans JP", 2: "Bold", 4: "Noto Sans JP Bold",
                 6: "NotoSansJP-Bold", 16: "Noto Sans JP", 17: "Bold"}
        for record in instance["name"].names:
            if record.nameID in names:
                record.string = names[record.nameID].encode(record.getEncoding())
    target = ROOT / f"public/fonts/NotoSansJP-{variant}.ttf"
    instance.save(target)
    print(target.name, "SHA256", sha256(target.read_bytes()).hexdigest())
