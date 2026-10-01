import sys
from pathlib import Path
from PIL import Image
files = sys.argv[2:]
cols = 3
sz = 600
rows = (len(files)+cols-1)//cols
sheet = Image.new("RGB", (cols*sz, rows*sz), "white")
for i,f in enumerate(files):
    im = Image.open(f"out/{f}.jpg").resize((sz,sz))
    sheet.paste(im, ((i%cols)*sz, (i//cols)*sz))
sheet.save(sys.argv[1])
