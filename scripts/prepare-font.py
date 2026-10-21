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
regular = instantiateVariableFont(font, {"wght": 400}, inplace=False)
regular.recalcTimestamp = False
target = ROOT / "public/fonts/NotoSansJP-Regular.ttf"
regular.save(target)
print(target.name, "SHA256", sha256(target.read_bytes()).hexdigest())
