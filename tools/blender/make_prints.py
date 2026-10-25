# Imprimés des t-shirts (remplacent les logos MakeHuman des textures d'origine). Python système + Pillow.
# Usage : python3 make_prints.py  → tools/blender/prints/*.png (fond transparent, 512 px)
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prints')
os.makedirs(OUT, exist_ok=True)
F = '/System/Library/Fonts/Supplemental/'
big = lambda s: ImageFont.truetype(F + 'Impact.ttf', s)
din = lambda s: ImageFont.truetype(F + 'DIN Condensed Bold.ttf', s)


def centered(d, y, text, font, fill):
    w = d.textlength(text, font=font)
    d.text(((512 - w) / 2, y), text, font=font, fill=fill)


def abidjan225(ink='#f4f1ea', accent='#f08a24'):
    im = Image.new('RGBA', (512, 512), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    centered(d, 70, '225', big(230), ink)
    centered(d, 330, 'ABIDJAN', din(96), ink)
    for i, c in enumerate([accent, ink, '#2e9e5b']):  # bandes orange / blanc / vert
        d.rectangle([156 + i * 68, 440, 156 + i * 68 + 60, 456], fill=c)
    return im


def babi(ink='#f4f1ea', accent='#f08a24'):
    im = Image.new('RGBA', (512, 512), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse([96, 60, 416, 380], outline=accent, width=14)
    centered(d, 120, 'BABI', big(150), ink)
    centered(d, 400, 'CÔTE D\'IVOIRE', din(64), ink)
    return im


abidjan225().save(os.path.join(OUT, 'abidjan225.png'))
babi().save(os.path.join(OUT, 'babi.png'))
print('ok', os.listdir(OUT))
